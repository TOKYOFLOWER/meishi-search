#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
テスト用の名刺風サンプル画像を生成するスクリプト。

Pillowを使い、横1000x縦600の白背景の画像にテスト用の名刺情報を描画して保存する。
ingest.py の動作確認(--dry-run等)に使うことを想定している。

使い方:
    python make_sample.py                # E:\\namecardscan\\_test_card.png に生成
    python make_sample.py --out path.png # 出力先を変更
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional

from PIL import Image, ImageDraw, ImageFont

# Windowsコンソールの文字化け対策
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

WIDTH = 1000
HEIGHT = 600

# 上から順に探すフォント候補(日本語表示に対応したものを優先)
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\meiryo.ttc",
    r"C:\Windows\Fonts\msgothic.ttc",
    r"C:\Windows\Fonts\YuGothM.ttc",
    r"C:\Windows\Fonts\NotoSansJP-VF.ttf",
]

LINES = [
    "テスト株式会社",
    "営業部 営業部長",
    "取込 太郎",
    "TEL 03-1234-5678",
    "Email taro.torikomi@example.com",
    "〒104-0061 東京都中央区銀座1-1-1",
    "https://example.com",
]


def find_font_path() -> Optional[str]:
    """フォント候補を順番に探し、最初に見つかったパスを返す。見つからなければNone。"""
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return path
    return None


def load_font(size: int) -> ImageFont.FreeTypeFont:
    """候補フォントを順に試し、使えるものをTrueTypeフォントとして読み込む。

    どれも見つからない場合はPillowのデフォルトビットマップフォントにフォールバックする
    (日本語は文字化けする可能性があるが、テスト画像生成自体は継続する)。
    """
    font_path = find_font_path()
    if font_path is not None:
        return ImageFont.truetype(font_path, size)
    print("警告: 日本語フォントが見つからないため、デフォルトフォントを使用します。")
    return ImageFont.load_default()


def make_sample_card(out_path: Path, variant: int = 0) -> None:
    """名刺風のサンプル画像を作成してout_pathに保存する。

    variant を 1 以上にすると右下に小さな灰色の点を描き、文字内容は同じまま
    画像のバイト列(sha256)だけを変える。GAS側の重複判定テストに使う。
    """
    image = Image.new("RGB", (WIDTH, HEIGHT), color="white")
    draw = ImageDraw.Draw(image)
    if variant > 0:
        x = WIDTH - 40 - (variant % 20) * 3
        draw.rectangle((x, HEIGHT - 20, x + 2, HEIGHT - 18), fill=(200, 200, 200))

    title_font = load_font(48)
    body_font = load_font(32)

    y = 60
    for i, line in enumerate(LINES):
        font = title_font if i == 0 else body_font
        draw.text((60, y), line, fill="black", font=font)
        y += 70

    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path)
    print(f"サンプル画像を生成しました: {out_path}")


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="テスト用の名刺風サンプル画像を生成します。")
    parser.add_argument(
        "--out",
        type=str,
        default=r"E:\namecardscan\_test_card.png",
        help="出力先ファイルパス(既定: E:\\namecardscan\\_test_card.png)",
    )
    parser.add_argument(
        "--variant", type=int, default=0,
        help="1以上でsha256だけが異なる同内容の画像を生成する(重複判定テスト用)",
    )
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args()
    make_sample_card(Path(args.out), variant=args.variant)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
