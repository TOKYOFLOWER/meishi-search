#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_card_images() のテスト(標準unittest、ネットワーク不要)。

- make_sample.py で生成したPNGから表面のみの画像が作られ、full/thumbが規定サイズ以下になること。
- PyMuPDFで生成した2ページのダミーPDFから表裏(front/back)が作られること。

実行方法:
    ingest\\.venv\\Scripts\\python.exe -m unittest ingest.tests.test_images
"""

from __future__ import annotations

import base64
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

# 「ingest」ディレクトリ配下には ingest.py(スクリプト)と tests/(パッケージ名衝突しうる
# 名前空間パッケージ)が同居しているため、`-m unittest ingest.tests.test_images` と
# `-m unittest tests.test_images` のどちらで実行されても安定するよう、
# sys.path 経由の import ではなくファイルパス指定でモジュールを読み込む。
SCRIPT_DIR = Path(__file__).resolve().parent.parent  # ingest/


def _load_module_from_path(name: str, file_path: Path):
    spec = importlib.util.spec_from_file_location(name, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"モジュールを読み込めません: {file_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclassの型解決などがsys.modules参照するため事前に登録する
    spec.loader.exec_module(module)
    return module


ingest = _load_module_from_path("meishi_ingest_script", SCRIPT_DIR / "ingest.py")
_make_sample = _load_module_from_path("meishi_make_sample", SCRIPT_DIR / "tests" / "make_sample.py")
make_sample_card = _make_sample.make_sample_card

try:
    import pymupdf
except ImportError:  # pragma: no cover
    pymupdf = None

FULL_MAX_BYTES = 200 * 1024
THUMB_MAX_BYTES = 30 * 1024


def _decoded_len(b64_text: str) -> int:
    """base64文字列をデコードした際の生バイト数を返す。"""
    return len(base64.standard_b64decode(b64_text))


class BuildCardImagesFromPngTest(unittest.TestCase):
    """画像(PNG)からの表面のみの生成を確認する。"""

    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.png_path = Path(self.tmpdir.name) / "_test_card.png"
        make_sample_card(self.png_path)

    def test_front_only_and_size_limits(self) -> None:
        images = ingest.build_card_images(self.png_path)
        self.assertIsNotNone(images)
        assert images is not None  # for type-checkers
        self.assertIn("front", images)
        self.assertNotIn("back", images)
        self.assertIn("full", images["front"])
        self.assertIn("thumb", images["front"])

        full_bytes = _decoded_len(images["front"]["full"])
        thumb_bytes = _decoded_len(images["front"]["thumb"])
        self.assertLessEqual(full_bytes, FULL_MAX_BYTES,
                              f"full画像が大きすぎます: {full_bytes} bytes")
        self.assertLessEqual(thumb_bytes, THUMB_MAX_BYTES,
                              f"thumb画像が大きすぎます: {thumb_bytes} bytes")


class BuildCardImagesFailureTest(unittest.TestCase):
    """存在しないファイルなどでも例外を送出せずNoneを返すことを確認する。"""

    def test_missing_file_returns_none(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            missing = Path(tmpdir) / "not_exists.png"
            result = ingest.build_card_images(missing)
        self.assertIsNone(result)


@unittest.skipIf(pymupdf is None, "pymupdfが未インストールのためスキップ")
class BuildCardImagesFromPdfTest(unittest.TestCase):
    """2ページのダミーPDFから表裏(front/back)が作られることを確認する。"""

    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.pdf_path = Path(self.tmpdir.name) / "_test_card.pdf"
        self._make_dummy_pdf(self.pdf_path, pages=2)

    @staticmethod
    def _make_dummy_pdf(out_path: Path, pages: int) -> None:
        doc = pymupdf.open()
        try:
            for i in range(pages):
                page = doc.new_page(width=600, height=350)
                page.insert_text((50, 50), f"Test Card Page {i + 1}", fontsize=24)
            doc.save(str(out_path))
        finally:
            doc.close()

    def test_front_and_back_present(self) -> None:
        images = ingest.build_card_images(self.pdf_path)
        self.assertIsNotNone(images)
        assert images is not None
        self.assertIn("front", images)
        self.assertIn("back", images)
        for side in ("front", "back"):
            self.assertIn("full", images[side])
            self.assertIn("thumb", images[side])
            self.assertLessEqual(_decoded_len(images[side]["full"]), FULL_MAX_BYTES)
            self.assertLessEqual(_decoded_len(images[side]["thumb"]), THUMB_MAX_BYTES)


if __name__ == "__main__":
    unittest.main()
