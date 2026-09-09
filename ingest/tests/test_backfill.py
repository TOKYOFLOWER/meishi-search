#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
--backfill (run_backfill / _find_source_file) のテスト(標準unittest、requests.postをモック)。

実行方法:
    ingest\\.venv\\Scripts\\python.exe -m unittest ingest.tests.test_backfill
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parent.parent  # ingest/


def _load_module_from_path(name: str, file_path: Path):
    spec = importlib.util.spec_from_file_location(name, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"モジュールを読み込めません: {file_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ingest = _load_module_from_path("meishi_ingest_script_backfill", SCRIPT_DIR / "ingest.py")
_make_sample = _load_module_from_path("meishi_make_sample_backfill", SCRIPT_DIR / "tests" / "make_sample.py")
make_sample_card = _make_sample.make_sample_card


class FakeResponse:
    """requests.Responseの最低限のスタブ。"""

    def __init__(self, json_data: dict, status_code: int = 200):
        self._json_data = json_data
        self.status_code = status_code

    def json(self):
        return self._json_data


def _make_cfg(watch_dir: Path) -> "ingest.Config":
    return ingest.Config(
        gas_url="https://example.com/exec",
        app_user="user1",
        app_pass="pass1",
        watch_dir=watch_dir,
        model="dummy-model",
    )


class FindSourceFileTest(unittest.TestCase):
    """_find_source_file の探索ロジックを確認する。"""

    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.watch_dir = Path(self.tmpdir.name)
        (self.watch_dir / "done" / "202609").mkdir(parents=True)
        (self.watch_dir / "error").mkdir(parents=True)

    def test_exact_match_in_done(self) -> None:
        target = self.watch_dir / "done" / "202609" / "2026-09-08_001.jpg"
        target.write_bytes(b"dummy")
        found = ingest._find_source_file(self.watch_dir, "2026-09-08_001.jpg")
        self.assertEqual(found, target)

    def test_numbered_suffix_match(self) -> None:
        # unique_dest_pathが付けた連番ファイルだけが存在するケース
        target = self.watch_dir / "done" / "202609" / "2026-09-08_002_1.jpg"
        target.write_bytes(b"dummy")
        found = ingest._find_source_file(self.watch_dir, "2026-09-08_002.jpg")
        self.assertEqual(found, target)

    def test_error_dir_match(self) -> None:
        target = self.watch_dir / "error" / "2026-09-08_003.jpg"
        target.write_bytes(b"dummy")
        found = ingest._find_source_file(self.watch_dir, "2026-09-08_003.jpg")
        self.assertEqual(found, target)

    def test_dup_prefixed_file_is_ignored(self) -> None:
        (self.watch_dir / "done" / "202609" / "dup_2026-09-08_004.jpg").write_bytes(b"dummy")
        found = ingest._find_source_file(self.watch_dir, "2026-09-08_004.jpg")
        self.assertIsNone(found)

    def test_not_found(self) -> None:
        found = ingest._find_source_file(self.watch_dir, "not_exists.jpg")
        self.assertIsNone(found)


class RunBackfillTest(unittest.TestCase):
    """run_backfill のdry-run/本実行の挙動をrequests.postをモックして確認する。"""

    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.watch_dir = Path(self.tmpdir.name)
        (self.watch_dir / "done" / "202609").mkdir(parents=True)
        (self.watch_dir / "error").mkdir(parents=True)
        self.cfg = _make_cfg(self.watch_dir)

        # 見つかる分: PNGを実際に置いてbuild_card_imagesが動くようにする
        found_path = self.watch_dir / "done" / "202609" / "2026-09-08_001.jpg"
        # make_sample_card はPNG想定だが拡張子はGAS側の元ファイル名を模すためjpgのまま保存する
        make_sample_card(found_path)

        self.items = [
            {"contactId": "M03862", "sourceFile": "2026-09-08_001.jpg"},
            {"contactId": "M03999", "sourceFile": "2026-09-09_999.jpg"},  # 見つからない
        ]

    def _cards_without_image_response(self):
        return FakeResponse({"ok": True, "data": {"items": self.items}})

    def test_dry_run_does_not_call_attach_images(self) -> None:
        with patch("meishi_ingest_script_backfill.requests.post") as mock_post:
            mock_post.return_value = self._cards_without_image_response()
            ok = ingest.run_backfill(self.cfg, dry_run=True)

        self.assertTrue(ok)
        # cardsWithoutImage の1回だけ呼ばれ、attachImagesは呼ばれない
        self.assertEqual(mock_post.call_count, 1)
        sent_body = json.loads(mock_post.call_args.kwargs["data"])
        self.assertEqual(sent_body["action"], "cardsWithoutImage")

    def test_real_run_calls_attach_images_only_for_found(self) -> None:
        attach_response = FakeResponse({
            "ok": True,
            "data": {"contactId": "M03862", "imageFrontId": "f1", "imageFrontThumbId": "ft1"},
        })

        call_log = []

        def fake_post(url, data=None, headers=None, timeout=None):
            body = json.loads(data)
            call_log.append(body["action"])
            if body["action"] == "cardsWithoutImage":
                return self._cards_without_image_response()
            if body["action"] == "attachImages":
                return attach_response
            raise AssertionError(f"unexpected action: {body['action']}")

        with patch("meishi_ingest_script_backfill.requests.post", side_effect=fake_post) as mock_post:
            ok = ingest.run_backfill(self.cfg, dry_run=False)

        self.assertFalse(ok)  # 1件見つからないためFalse
        self.assertEqual(call_log.count("cardsWithoutImage"), 1)
        # 見つかった1件分だけattachImagesが呼ばれる(見つからない分は呼ばれない)
        self.assertEqual(call_log.count("attachImages"), 1)
        self.assertEqual(mock_post.call_count, 2)

    def test_missing_file_is_skipped_without_network_call_for_it(self) -> None:
        # 全件見つからない場合、attachImagesは一度も呼ばれない
        self.items = [{"contactId": "M09999", "sourceFile": "not_exists.jpg"}]
        call_log = []

        def fake_post(url, data=None, headers=None, timeout=None):
            body = json.loads(data)
            call_log.append(body["action"])
            return self._cards_without_image_response()

        with patch("meishi_ingest_script_backfill.requests.post", side_effect=fake_post):
            ok = ingest.run_backfill(self.cfg, dry_run=False)

        self.assertFalse(ok)
        self.assertNotIn("attachImages", call_log)


if __name__ == "__main__":
    unittest.main()
