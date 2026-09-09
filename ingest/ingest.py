#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
名刺画像取り込みスクリプト（ScanSnap -> Claude OCR -> GAS Web App）

ScanSnap が E:\\namecardscan に保存した名刺画像/PDFを走査し、
Claude (Anthropic API) で情報を抽出したうえで GAS Web App に送信する。
送信結果に応じてファイルを done/ または error/ に振り分ける。

使い方:
    python ingest.py --once            # 1回だけ走査（既定動作）
    python ingest.py --watch           # 60秒間隔で無限ループ（Ctrl+Cで終了）
    python ingest.py --dry-run         # GASに送らず抽出結果を標準出力に表示
    python ingest.py --file <path>     # 指定した1ファイルのみ処理
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import logging
import os
import re
import shutil
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import anthropic
import requests
from dotenv import load_dotenv
from PIL import Image, ImageOps

try:
    import pymupdf  # PDFレンダリング用。ingest/README.mdの手順でインストールする。
except ImportError:  # pragma: no cover - 未インストール環境向けフォールバック
    pymupdf = None

# --------------------------------------------------------------------------
# 定数
# --------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
ENV_PATH = SCRIPT_DIR / ".env"
STATE_PATH = SCRIPT_DIR / "state.json"
LOG_DIR = SCRIPT_DIR / "logs"

TARGET_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}
WRITE_IN_PROGRESS_SECONDS = 10  # 書込中とみなすmtime猶予秒数
WATCH_INTERVAL_SECONDS = 60
IMAGE_SIZE_WARN_BYTES = 5 * 1024 * 1024  # 5MB

# 名刺画像(表裏サムネイル)の生成設定
CARD_IMAGE_LONG_EDGE_FULL = 1200
CARD_IMAGE_LONG_EDGE_THUMB = 320
CARD_IMAGE_QUALITY_FULL = 80
CARD_IMAGE_QUALITY_THUMB = 70
CARD_IMAGE_QUALITY_FALLBACKS = [80, 65, 50, 40]  # 合計サイズ超過時に順に下げる品質
CARD_IMAGE_TOTAL_SIZE_LIMIT = 1_000_000  # base64文字列の合計上限(バイト)
CARD_IMAGE_PDF_DPI = 150

# GAS に送る際にリトライしない（=最終的なエラーとして扱う）エラーコード
GAS_NON_RETRYABLE_ERRORS = {"auth", "missing_required"}

RETRY_DELAYS_SECONDS = [5, 15, 45]  # API呼び出し・GAS送信共通のリトライ間隔

MEDIA_TYPE_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".pdf": "application/pdf",
}

# 名刺JSONに期待するキー（GASに送るcardのうちOCR由来のもの）
CARD_KEYS = [
    "company", "name", "kana", "department", "title",
    "email", "tel", "mobile", "fax", "postal", "address", "url", "memo",
]

SYSTEM_PROMPT = """\
あなたは名刺OCRの専門家です。与えられた名刺の画像またはPDFから情報を正確に抽出し、
JSONオブジェクトのみを返してください。説明文やコードフェンスは不要です。

出力するJSONのキーは次の通りです。
- company: 会社名
- name: 氏名（姓と名の間に半角スペースを1つ入れる）
- kana: ふりがな、またはローマ字表記（記載があれば）
- department: 部署名
- title: 役職
- email: メールアドレス
- tel: 電話番号（数字とハイフンのみ）
- mobile: 携帯電話番号（数字とハイフンのみ）
- fax: FAX番号（数字とハイフンのみ）
- postal: 郵便番号（"123-4567"形式）
- address: 住所（都道府県から書く）
- url: ウェブサイトのURL
- memo: 名刺に書かれたその他の情報（資格、SNSアカウント、キャッチコピー等）を短くまとめる
- confidence: 抽出結果全体の確信度（0〜1の数値）
- notes: 読み取りに関する補足事項があれば記載する文字列（無ければ空文字）

ルール:
- 日本語面と英語面の両方が写っている場合は、日本語表記の情報を優先すること。
- 読み取れない項目は空文字列にすること。
- PDFで複数ページが含まれる場合は、同一名刺の表面・裏面として情報を統合すること。
- 出力はJSONオブジェクトのみとし、前後に説明文やMarkdownのコードフェンスを付けないこと。
"""

USER_PROMPT = (
    "この名刺（画像またはPDF）から情報を抽出し、指定されたJSON形式で出力してください。"
    "PDFで複数ページがある場合は、同一名刺の表裏として1つの結果に統合してください。"
)


# --------------------------------------------------------------------------
# 設定
# --------------------------------------------------------------------------

@dataclass
class Config:
    """スクリプト全体の設定値。パスワード・APIキーはログに出さないこと。"""
    gas_url: str
    app_user: str
    app_pass: str
    watch_dir: Path
    model: str


def load_config() -> Config:
    """ingest/.env を読み込み、設定値を組み立てる。

    ANTHROPIC_API_KEY は python-dotenv がデフォルト(override=False)で
    既存の環境変数を上書きしないため、.env に無ければ既存の環境変数の値が
    そのまま使われる。Anthropic SDK 自体が os.environ から自動で読む。
    """
    load_dotenv(dotenv_path=ENV_PATH, override=False)

    gas_url = os.environ.get("GAS_URL", "").strip()
    app_user = os.environ.get("APP_USER", "")
    app_pass = os.environ.get("APP_PASS", "")
    watch_dir = Path(os.environ.get("WATCH_DIR", r"E:\namecardscan"))
    model = os.environ.get("MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6"

    return Config(
        gas_url=gas_url,
        app_user=app_user,
        app_pass=app_pass,
        watch_dir=watch_dir,
        model=model,
    )


# --------------------------------------------------------------------------
# ロギング
# --------------------------------------------------------------------------

def setup_logging() -> logging.Logger:
    """ingest/logs/ingest_YYYYMMDD.log と標準出力の両方にログを出す。"""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / f"ingest_{datetime.now().strftime('%Y%m%d')}.log"

    logger = logging.getLogger("ingest")
    logger.setLevel(logging.INFO)
    logger.propagate = False

    if not logger.handlers:
        formatter = logging.Formatter(
            fmt="%(asctime)s [%(levelname)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)

        stream_handler = logging.StreamHandler(sys.stdout)
        stream_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)

    return logger


# --------------------------------------------------------------------------
# 対象ファイルの走査
# --------------------------------------------------------------------------

def is_target_file(path: Path) -> bool:
    """拡張子が対象(.jpg/.jpeg/.png/.pdf、大文字小文字無視)かどうか。"""
    return path.suffix.lower() in TARGET_EXTENSIONS


def list_target_files(watch_dir: Path) -> list[Path]:
    """watch_dir 直下（再帰しない）の対象ファイルを名前順で返す。

    done/ や error/ はサブディレクトリなので、直下のみを見る glob("*") で
    自然に除外される。
    """
    if not watch_dir.exists():
        return []
    files = [p for p in watch_dir.glob("*") if p.is_file() and is_target_file(p)]
    return sorted(files, key=lambda p: p.name)


def is_file_writing(path: Path) -> bool:
    """mtimeが現在時刻から10秒以内なら書込中とみなす。"""
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return True
    return (time.time() - mtime) < WRITE_IN_PROGRESS_SECONDS


# --------------------------------------------------------------------------
# 処理済み管理 (state.json)
# --------------------------------------------------------------------------

def load_state(state_path: Path) -> dict[str, Any]:
    """state.jsonを読み込む。存在しない/壊れている場合は空の状態を返す。"""
    if not state_path.exists():
        return {"files": {}}
    try:
        with open(state_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if "files" not in data:
            data["files"] = {}
        return data
    except (OSError, json.JSONDecodeError):
        return {"files": {}}


def save_state(state_path: Path, state: dict[str, Any]) -> None:
    """state.jsonを一時ファイル経由でアトミックに書き込む。"""
    tmp_path = state_path.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, state_path)


def sha256_of_file(path: Path) -> str:
    """ファイルのSHA256ハッシュ値(16進文字列)を計算する。"""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------------------
# Claude による名刺抽出
# --------------------------------------------------------------------------

class ExtractionError(Exception):
    """名刺抽出に失敗したことを表す例外。raw_textにAPIの生レスポンスを保持する。"""

    def __init__(self, message: str, raw_text: str = ""):
        super().__init__(message)
        self.raw_text = raw_text


def build_content_block(path: Path) -> dict[str, Any]:
    """画像またはPDFファイルからAnthropic APIに渡すcontentブロックを組み立てる。"""
    ext = path.suffix.lower()
    media_type = MEDIA_TYPE_BY_EXT.get(ext)
    if media_type is None:
        raise ExtractionError(f"未対応の拡張子です: {ext}")

    size = path.stat().st_size
    if media_type.startswith("image/") and size > IMAGE_SIZE_WARN_BYTES:
        # Pillowに依存せずそのまま送る。API側の制限に掛かればエラーとして扱われる。
        logging.getLogger("ingest").info(
            "画像サイズが5MBを超えています(%d bytes)。そのまま送信します: %s",
            size, path.name,
        )

    with open(path, "rb") as f:
        data_b64 = base64.standard_b64encode(f.read()).decode("ascii")

    block_type = "document" if media_type == "application/pdf" else "image"
    return {
        "type": block_type,
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": data_b64,
        },
    }


def _prepare_pil_image(img: Image.Image) -> Image.Image:
    """EXIFの回転を反映し、RGBA/PなどをRGBに変換する。"""
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")
    return img


def _load_card_page_images(path: Path) -> list[Image.Image]:
    """名刺ファイルからページ画像(PIL Image)のリストを返す。

    画像(jpg/jpeg/png)は表面のみの1枚、PDFは1ページ目=表面・2ページ目=裏面として
    最大2枚を返す(3ページ目以降は無視する)。
    """
    ext = path.suffix.lower()
    if ext in (".jpg", ".jpeg", ".png"):
        with Image.open(path) as im:
            im.load()
            return [_prepare_pil_image(im)]

    if ext == ".pdf":
        if pymupdf is None:
            raise RuntimeError("pymupdfが未インストールのためPDFから画像を生成できません")
        zoom = CARD_IMAGE_PDF_DPI / 72.0
        matrix = pymupdf.Matrix(zoom, zoom)
        images: list[Image.Image] = []
        with pymupdf.open(str(path)) as doc:
            for page_index in range(min(2, doc.page_count)):
                page = doc.load_page(page_index)
                pix = page.get_pixmap(matrix=matrix)
                mode = "RGBA" if pix.alpha else "RGB"
                pil_img = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
                images.append(_prepare_pil_image(pil_img))
        return images

    raise ValueError(f"未対応の拡張子です: {ext}")


def _resize_to_long_edge(img: Image.Image, long_edge: int) -> Image.Image:
    """長辺がlong_edge以下になるよう縮小する(既に小さければそのまま)。"""
    width, height = img.size
    scale = long_edge / max(width, height)
    if scale >= 1:
        return img
    new_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return img.resize(new_size, Image.LANCZOS)


def _encode_jpeg_b64(img: Image.Image, quality: int) -> str:
    """PIL画像をJPEGエンコードし、標準base64文字列(dataプレフィックスなし)で返す。"""
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return base64.standard_b64encode(buf.getvalue()).decode("ascii")


def _render_card_side(img: Image.Image, quality: int, thumb_quality: int) -> dict[str, str]:
    """1面(表 or 裏)分の full/thumb base64 を生成する。"""
    full_img = _resize_to_long_edge(img, CARD_IMAGE_LONG_EDGE_FULL)
    thumb_img = _resize_to_long_edge(img, CARD_IMAGE_LONG_EDGE_THUMB)
    return {
        "full": _encode_jpeg_b64(full_img, quality),
        "thumb": _encode_jpeg_b64(thumb_img, thumb_quality),
    }


def _card_images_total_size(images: dict[str, dict[str, str]]) -> int:
    """imagesに含まれるbase64文字列の合計文字数(≒バイト数)を返す。"""
    return sum(len(v) for side in images.values() for v in side.values())


def build_card_images(path: Path) -> Optional[dict[str, dict[str, str]]]:
    """名刺ファイルから表裏の縮小画像(base64)を組み立てる。

    戻り値: {"front": {"full": b64, "thumb": b64}, "back": {...}}(裏面がある場合のみback付き)。
    画像/PDFの読み込みや変換に失敗した場合はNoneを返し、警告ログのみ出す
    (カード登録自体は続行させるため、ここでは例外を送出しない)。
    """
    logger = logging.getLogger("ingest")
    try:
        pages = _load_card_page_images(path)
    except Exception as exc:
        logger.warning("名刺画像の生成に失敗しました(カード登録は続行します): %s: %s", path.name, exc)
        return None

    if not pages:
        return None

    side_names = ["front", "back"]
    raw_pages = list(zip(side_names, pages[:2]))

    images: Optional[dict[str, dict[str, str]]] = None
    try:
        for quality in CARD_IMAGE_QUALITY_FALLBACKS:
            thumb_quality = min(CARD_IMAGE_QUALITY_THUMB, quality)
            images = {
                side_name: _render_card_side(page_img, quality, thumb_quality)
                for side_name, page_img in raw_pages
            }
            if _card_images_total_size(images) <= CARD_IMAGE_TOTAL_SIZE_LIMIT:
                break

        if images is not None and _card_images_total_size(images) > CARD_IMAGE_TOTAL_SIZE_LIMIT:
            if "back" in images:
                images["back"].pop("full", None)
        if images is not None and _card_images_total_size(images) > CARD_IMAGE_TOTAL_SIZE_LIMIT:
            images.pop("back", None)
    except Exception as exc:
        logger.warning("名刺画像の生成に失敗しました(カード登録は続行します): %s: %s", path.name, exc)
        return None

    return images


def strip_json_fence(text: str) -> str:
    """```json ... ``` のようなコードフェンスを剥がし、{ }の範囲を切り出す。"""
    stripped = text.strip()
    stripped = re.sub(r"^```(?:json)?\s*\n?", "", stripped)
    stripped = re.sub(r"\n?```\s*$", "", stripped)
    stripped = stripped.strip()

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end < start:
        return stripped
    return stripped[start:end + 1]


def is_retryable_anthropic_error(exc: Exception) -> bool:
    """429/5xx または接続エラーであればリトライ対象と判定する。"""
    if isinstance(exc, anthropic.APIConnectionError):
        return True
    if isinstance(exc, anthropic.APIStatusError):
        return exc.status_code == 429 or exc.status_code >= 500
    return False


def call_claude(client: anthropic.Anthropic, model: str, content_block: dict[str, Any]) -> str:
    """Claudeに1回だけリクエストを送り、テキスト部分を連結して返す。

    stop_reasonがrefusalの場合はExtractionErrorを送出する。
    """
    resp = client.messages.create(
        model=model,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": [content_block, {"type": "text", "text": USER_PROMPT}],
        }],
    )

    if resp.stop_reason == "refusal":
        raise ExtractionError("refusal")

    text = "".join(b.text for b in resp.content if b.type == "text")
    return text


def call_claude_with_retry(client: anthropic.Anthropic, model: str, content_block: dict[str, Any]) -> str:
    """Claude呼び出しを最大3回までリトライする(429/5xx/接続エラーのみ)。

    SDK自体もmax_retries=2で内部リトライするため、ここでの追加リトライは
    ネットワーク瞬断など長めの障害に対する保険。
    """
    logger = logging.getLogger("ingest")
    last_exc: Optional[Exception] = None

    for attempt in range(len(RETRY_DELAYS_SECONDS)):
        try:
            return call_claude(client, model, content_block)
        except ExtractionError:
            raise  # refusalなどはリトライしない
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
            last_exc = exc
            if not is_retryable_anthropic_error(exc):
                raise ExtractionError(f"API呼び出しに失敗しました: {exc}") from exc
            if attempt < len(RETRY_DELAYS_SECONDS) - 1:
                delay = RETRY_DELAYS_SECONDS[attempt]
                logger.info("Claude API呼び出しに失敗。%d秒後にリトライします(%d/%d)", delay, attempt + 1, len(RETRY_DELAYS_SECONDS))
                time.sleep(delay)

    raise ExtractionError(f"API呼び出しに失敗しました(リトライ上限): {last_exc}") from last_exc


def extract_card_from_file(client: anthropic.Anthropic, model: str, path: Path) -> tuple[Optional[dict[str, Any]], str]:
    """名刺ファイルからClaudeで情報を抽出する。

    戻り値: (抽出結果の辞書 または None, APIの生レスポンステキスト)
    company/nameが両方空、JSONパース失敗の場合はExtractionErrorを送出する。
    """
    content_block = build_content_block(path)

    raw_text = ""
    try:
        raw_text = call_claude_with_retry(client, model, content_block)
    except ExtractionError as exc:
        exc.raw_text = exc.raw_text or raw_text
        raise

    if not raw_text or not raw_text.strip():
        raise ExtractionError("Claudeからのレスポンスが空です", raw_text=raw_text)

    json_text = strip_json_fence(raw_text)
    try:
        parsed = json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise ExtractionError(f"JSONパースに失敗しました: {exc}", raw_text=raw_text) from exc

    if not isinstance(parsed, dict):
        raise ExtractionError("Claudeの応答がJSONオブジェクトではありません", raw_text=raw_text)

    company = str(parsed.get("company") or "").strip()
    name = str(parsed.get("name") or "").strip()
    if not company and not name:
        raise ExtractionError("company/nameが両方とも空です", raw_text=raw_text)

    return parsed, raw_text


# --------------------------------------------------------------------------
# GAS への送信
# --------------------------------------------------------------------------

class GasError(Exception):
    """GASへの送信に失敗したことを表す例外。"""


# attachImages固有の「リトライしても無駄」なエラー(共通のauth/missing_requiredに追加)
ATTACH_IMAGES_NON_RETRYABLE_ERRORS = GAS_NON_RETRYABLE_ERRORS | {"not_found", "no_images"}


def post_gas(
    cfg: Config,
    action: str,
    payload: dict[str, Any],
    non_retryable_errors: Optional[set[str]] = None,
) -> dict[str, Any]:
    """GAS Web Appにaction/payloadを送信し、レスポンスのJSONを返す共通関数。

    最大3回リトライする。ただしGASが返すerrorがnon_retryable_errors(既定は
    GAS_NON_RETRYABLE_ERRORS)に含まれる場合はリトライせず、その時点で例外を送出する。
    """
    logger = logging.getLogger("ingest")
    if non_retryable_errors is None:
        non_retryable_errors = GAS_NON_RETRYABLE_ERRORS

    body_dict: dict[str, Any] = {"user": cfg.app_user, "pass": cfg.app_pass, "action": action}
    body_dict.update(payload)
    body = json.dumps(body_dict, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "text/plain;charset=utf-8"}

    last_error = "不明なエラー"

    for attempt in range(len(RETRY_DELAYS_SECONDS)):
        try:
            resp = requests.post(cfg.gas_url, data=body, headers=headers, timeout=60)
        except requests.RequestException as exc:
            last_error = f"通信エラー: {exc}"
        else:
            if resp.status_code != 200:
                last_error = f"HTTPステータス異常: {resp.status_code}"
            else:
                try:
                    result = resp.json()
                except ValueError:
                    last_error = "レスポンスのJSONパースに失敗"
                else:
                    if result.get("ok"):
                        return result
                    error_code = result.get("error", "")
                    if error_code in non_retryable_errors:
                        raise GasError(f"GASエラー(リトライ不要): {error_code}")
                    last_error = f"GASエラー: {error_code or result}"

        if attempt < len(RETRY_DELAYS_SECONDS) - 1:
            delay = RETRY_DELAYS_SECONDS[attempt]
            logger.info("GAS送信に失敗。%d秒後にリトライします(%d/%d): %s", delay, attempt + 1, len(RETRY_DELAYS_SECONDS), last_error)
            time.sleep(delay)

    raise GasError(f"GAS送信に失敗しました(リトライ上限): {last_error}")


def send_to_gas(cfg: Config, card: dict[str, Any]) -> dict[str, Any]:
    """GAS Web Appにカード情報を送信し、レスポンスのJSONを返す(action=addCard)。

    最大3回リトライする。ただしGASが返すerrorが"auth"や"missing_required"の
    場合はリトライせず、その時点で例外を送出する。
    """
    return post_gas(cfg, "addCard", {"card": card})


# --------------------------------------------------------------------------
# ファイル移動
# --------------------------------------------------------------------------

def unique_dest_path(dest_dir: Path, filename: str) -> Path:
    """移動先に同名ファイルがあれば _1, _2 ... を付けて重複を避ける。"""
    dest_dir.mkdir(parents=True, exist_ok=True)
    candidate = dest_dir / filename
    if not candidate.exists():
        return candidate

    stem = Path(filename).stem
    suffix = Path(filename).suffix
    i = 1
    while True:
        candidate = dest_dir / f"{stem}_{i}{suffix}"
        if not candidate.exists():
            return candidate
        i += 1


def move_to_done(path: Path, watch_dir: Path, duplicate: bool, now: datetime) -> Path:
    """成功したファイルを WATCH_DIR/done/YYYYMM/ に移動する。"""
    yyyymm = now.strftime("%Y%m")
    dest_dir = watch_dir / "done" / yyyymm
    filename = f"dup_{path.name}" if duplicate else path.name
    dest = unique_dest_path(dest_dir, filename)
    shutil.move(str(path), str(dest))
    return dest


def move_to_error(path: Path, watch_dir: Path, reason: str, raw_text: str, now: datetime) -> Path:
    """失敗したファイルを WATCH_DIR/error/ に移動し、同名+.logを残す。"""
    dest_dir = watch_dir / "error"
    dest = unique_dest_path(dest_dir, path.name)
    shutil.move(str(path), str(dest))

    log_path = dest.with_suffix(dest.suffix + ".log")
    log_lines = [
        f"日時: {now.strftime('%Y-%m-%d %H:%M:%S')}",
        f"理由: {reason}",
        "生レスポンス(先頭2000文字):",
        (raw_text or "")[:2000],
    ]
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines) + "\n")

    return dest


# --------------------------------------------------------------------------
# 1ファイルの処理
# --------------------------------------------------------------------------

def process_file(
    client: anthropic.Anthropic,
    cfg: Config,
    state: dict[str, Any],
    path: Path,
    dry_run: bool,
    skip_write_check: bool,
) -> str:
    """1ファイルを処理する。戻り値は 'ok' | 'dup' | 'error' | 'skip'。"""
    logger = logging.getLogger("ingest")

    if not skip_write_check and is_file_writing(path):
        logger.info("skip | %s | 書込中のため次回", path.name)
        return "skip"

    file_hash = sha256_of_file(path)
    now = datetime.now()
    if not dry_run and file_hash in state["files"]:
        prev = state["files"][file_hash]
        prev_result = prev.get("result")
        if prev_result in ("ok", "dup"):
            # 同一内容のファイルは Claude/GAS を呼ばず、重複として done/ に退避する
            # （監視フォルダに残り続けて毎回スキップされるのを防ぐ）
            move_to_done(path, cfg.watch_dir, True, now)
            logger.info("dup | %s | 同一ファイル(sha256一致)のため再処理せず done/dup_ へ移動 | row=%s",
                        path.name, prev.get("row"))
            return "dup"
        # 以前 error だったものは再処理する（error/ から戻された場合を想定）
        logger.info("retry | %s | 以前の結果=%s のため再処理します", path.name, prev_result)

    mtime = path.stat().st_mtime
    file_size = path.stat().st_size
    scanned_at = datetime.fromtimestamp(mtime).isoformat(timespec="seconds")

    def record_state(result: str, row: Optional[int]) -> None:
        state["files"][file_hash] = {
            "name": path.name, "size": file_size,
            "mtime": mtime, "sha256": file_hash,
            "result": result, "row": row, "at": now.isoformat(timespec="seconds"),
        }

    try:
        parsed, raw_text = extract_card_from_file(client, cfg.model, path)
    except ExtractionError as exc:
        reason = str(exc)
        logger.info("error | %s | 抽出失敗: %s", path.name, reason)
        if not dry_run:
            move_to_error(path, cfg.watch_dir, reason, exc.raw_text, now)
            record_state("error", None)
        return "error"

    card = {key: str(parsed.get(key) or "") for key in CARD_KEYS}
    card["source_file"] = path.name
    card["scanned_at"] = scanned_at
    card["batch_id"] = "scan-" + now.strftime("%Y%m%d")

    images = build_card_images(path)
    if images is not None:
        card["images"] = images

    if dry_run:
        print(json.dumps(parsed, ensure_ascii=False, indent=2))
        if images is not None:
            # 画像本体は表示せず、base64文字列の長さ(バイト数相当)だけ出す
            sizes = {side: {k: len(v) for k, v in sides.items()} for side, sides in images.items()}
            print(json.dumps({"images_base64_length": sizes}, ensure_ascii=False, indent=2))
        logger.info("ok(dry-run) | %s | %s | %s", path.name, card["company"], card["name"])
        return "ok"

    try:
        result = send_to_gas(cfg, card)
    except GasError as exc:
        reason = str(exc)
        logger.info("error | %s | GAS送信失敗: %s", path.name, reason)
        move_to_error(path, cfg.watch_dir, reason, raw_text, now)
        record_state("error", None)
        return "error"

    duplicate = bool(result.get("duplicate"))
    row = result.get("row")
    move_to_done(path, cfg.watch_dir, duplicate, now)

    status = "dup" if duplicate else "ok"
    logger.info("%s | %s | %s | %s | row=%s", status, path.name, card["company"], card["name"], row)

    record_state(status, row)
    return status


# --------------------------------------------------------------------------
# 走査ループ
# --------------------------------------------------------------------------

def run_scan_once(client: anthropic.Anthropic, cfg: Config, dry_run: bool) -> bool:
    """WATCH_DIR直下を1回走査して処理する。戻り値: 抽出に失敗したファイルが1件でもあればFalse。"""
    logger = logging.getLogger("ingest")
    state = load_state(STATE_PATH)
    files = list_target_files(cfg.watch_dir)

    if not files:
        logger.info("対象ファイルはありません: %s", cfg.watch_dir)
        return True

    all_ok = True
    for path in files:
        try:
            result = process_file(client, cfg, state, path, dry_run=dry_run, skip_write_check=False)
        except Exception as exc:  # 予期しない例外はログに残して次のファイルへ
            logger.exception("予期しないエラー: %s: %s", path.name, exc)
            result = "error"
        if result == "error":
            all_ok = False

    if not dry_run:
        save_state(STATE_PATH, state)

    return all_ok


def run_watch(client: anthropic.Anthropic, cfg: Config) -> None:
    """60秒間隔で無限ループし、Ctrl+Cで終了する。"""
    logger = logging.getLogger("ingest")
    logger.info("監視モードを開始します: %s (間隔=%d秒)", cfg.watch_dir, WATCH_INTERVAL_SECONDS)
    try:
        while True:
            run_scan_once(client, cfg, dry_run=False)
            time.sleep(WATCH_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        logger.info("Ctrl+Cを検知したため監視モードを終了します")


def run_single_file(client: anthropic.Anthropic, cfg: Config, file_path: Path, dry_run: bool) -> bool:
    """--file指定時の単一ファイル処理。戻り値: 成功したかどうか。"""
    logger = logging.getLogger("ingest")
    if not file_path.exists():
        logger.error("ファイルが見つかりません: %s", file_path)
        return False
    if not is_target_file(file_path):
        logger.error("対象外の拡張子です: %s", file_path)
        return False

    state = load_state(STATE_PATH)
    try:
        result = process_file(client, cfg, state, file_path, dry_run=dry_run, skip_write_check=True)
    except Exception as exc:
        logger.exception("予期しないエラー: %s: %s", file_path.name, exc)
        return False

    if not dry_run:
        save_state(STATE_PATH, state)

    return result in ("ok", "dup")


# --------------------------------------------------------------------------
# バックフィル(画像未登録の名刺にscan元ファイルから画像を後付けする)
# --------------------------------------------------------------------------

_NUMBERED_SUFFIX_RE = re.compile(r"_(\d+)$")


def _find_source_file(watch_dir: Path, source_file: str) -> Optional[Path]:
    """sourceFileに対応する実ファイルを WATCH_DIR/done/**(再帰) と WATCH_DIR/error/ から探す。

    完全一致を優先し、無ければ unique_dest_path が付けた連番(stem_N.suffix)も候補にする。
    dup_ 接頭辞のファイル(重複扱いで退避されたもの)は対象外。
    見つからなければNoneを返す。
    """
    if not source_file:
        return None

    done_dir = watch_dir / "done"
    error_dir = watch_dir / "error"

    candidates: list[Path] = []
    if done_dir.exists():
        candidates.extend(p for p in done_dir.rglob("*") if p.is_file())
    if error_dir.exists():
        candidates.extend(p for p in error_dir.glob("*") if p.is_file())
    candidates = [p for p in candidates if not p.name.startswith("dup_")]

    for p in candidates:
        if p.name == source_file:
            return p

    stem = Path(source_file).stem
    suffix = Path(source_file).suffix
    numbered: list[tuple[int, Path]] = []
    for p in candidates:
        if p.suffix != suffix or not p.stem.startswith(stem + "_"):
            continue
        m = _NUMBERED_SUFFIX_RE.search(p.stem[len(stem):])
        if m:
            numbered.append((int(m.group(1)), p))
    if numbered:
        numbered.sort(key=lambda t: t[0])
        return numbered[0][1]

    return None


def run_backfill(cfg: Config, dry_run: bool) -> bool:
    """GASのcardsWithoutImageを取得し、見つかったscan元ファイルから画像をattachImagesで紐付ける。

    戻り値: 失敗(見つからない/attachImages失敗)が1件もなければTrue。
    """
    logger = logging.getLogger("ingest")

    try:
        result = post_gas(cfg, "cardsWithoutImage", {})
    except GasError as exc:
        logger.error("バックフィル対象の取得に失敗しました: %s", exc)
        return False

    items = result.get("data", {}).get("items", [])
    if not items:
        logger.info("バックフィル対象はありません")
        return True

    resolved: list[tuple[dict[str, Any], Optional[Path]]] = []
    for item in items:
        source_file = str(item.get("sourceFile", ""))
        found = _find_source_file(cfg.watch_dir, source_file)
        resolved.append((item, found))

    found_count = sum(1 for _, p in resolved if p is not None)
    missing_count = len(resolved) - found_count

    if dry_run:
        logger.info("対象 %d件 / 紐付け可能 %d件 / 見つからない %d件", len(resolved), found_count, missing_count)
        for item, path in resolved:
            contact_id = item.get("contactId", "")
            source_file = item.get("sourceFile", "")
            if path is not None:
                logger.info("  found   | %s | %s | %s", contact_id, source_file, path)
            else:
                logger.info("  missing | %s | %s | (未検出)", contact_id, source_file)
        return True

    success_count = 0
    fail_count = 0
    for item, path in resolved:
        contact_id = str(item.get("contactId", ""))
        source_file = item.get("sourceFile", "")

        if path is None:
            logger.info("skip | %s | %s | ファイルが見つかりません", contact_id, source_file)
            fail_count += 1
            continue

        images = build_card_images(path)
        if images is None:
            logger.info("skip | %s | %s | 画像の生成に失敗しました", contact_id, source_file)
            fail_count += 1
            continue

        try:
            post_gas(
                cfg, "attachImages",
                {"contactId": contact_id, "images": images},
                non_retryable_errors=ATTACH_IMAGES_NON_RETRYABLE_ERRORS,
            )
        except GasError as exc:
            logger.info("error | %s | %s | attachImages失敗: %s", contact_id, source_file, exc)
            fail_count += 1
            continue

        logger.info("ok | %s | %s", contact_id, source_file)
        success_count += 1

    logger.info("バックフィル完了: 成功 %d件 / 失敗 %d件", success_count, fail_count)
    return fail_count == 0


# --------------------------------------------------------------------------
# エントリーポイント
# --------------------------------------------------------------------------

def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ScanSnapで取り込んだ名刺画像をClaudeで読み取り、GASのスプレッドシートに登録します。",
    )
    parser.add_argument("--once", action="store_true", help="監視フォルダを1回だけ走査する(既定動作)")
    parser.add_argument("--watch", action="store_true", help="60秒間隔で無限ループする(Ctrl+Cで終了)")
    parser.add_argument("--dry-run", action="store_true", help="GASに送信せず、抽出結果のJSONを標準出力に表示する")
    parser.add_argument("--file", type=str, default=None, help="監視フォルダ外のファイルも含め、指定した1ファイルのみ処理する")
    parser.add_argument(
        "--backfill", action="store_true",
        help="画像が未登録の名刺に、scan元ファイル(done/error配下)から表裏画像を紐付ける(GASのattachImages)",
    )
    return parser.parse_args(argv)


def check_config(cfg: Config, require_gas: bool) -> Optional[str]:
    """必須設定が揃っているかを確認し、不足があればエラーメッセージを返す。"""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return "ANTHROPIC_API_KEYが設定されていません(.envを確認してください)"
    if require_gas:
        if not cfg.gas_url:
            return "GAS_URLが設定されていません(.envを確認してください)"
        if not cfg.app_user or not cfg.app_pass:
            return "APP_USER/APP_PASSが設定されていません(.envを確認してください)"
    return None


def main(argv: Optional[list[str]] = None) -> int:
    # Windowsコンソールの文字化け対策
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

    args = parse_args(argv)
    cfg = load_config()
    logger = setup_logging()

    # --backfill はdry-run時もcardsWithoutImage取得でGASに接続するため、常にGAS設定が必要
    require_gas = args.backfill or not args.dry_run
    err = check_config(cfg, require_gas=require_gas)
    if err:
        logger.error(err)
        return 1

    if args.backfill:
        ok = run_backfill(cfg, dry_run=args.dry_run)
        return 0 if ok else 1

    client = anthropic.Anthropic(max_retries=2)

    if args.file:
        ok = run_single_file(client, cfg, Path(args.file), dry_run=args.dry_run)
        return 0 if ok else 1

    if args.watch:
        run_watch(client, cfg)
        return 0

    # --dry-run 単独 または --once(既定) または何も指定なし
    all_ok = run_scan_once(client, cfg, dry_run=args.dry_run)
    if args.dry_run:
        return 0 if all_ok else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
