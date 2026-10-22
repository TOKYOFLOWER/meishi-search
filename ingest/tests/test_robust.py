#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ingest.py の堅牢化(構造化出力・多重起動ロック・使用中ファイル移動)の単体テスト。
Claude APIやGASには接続しない(モック応答のみ)。

実行:
    .venv\\Scripts\\python.exe tests\\test_robust.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import ingest  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_sample  # noqa: E402

QUOTE_MEMO = 'モノづくりカンパニー／キャッチコピー:「"モノ"を通じて生活を豊かに」'
CARD_INPUT = {
    "company": "モノライフ合同会社", "name": "井手 剛", "kana": "Tsuyoshi Ide", "department": "",
    "title": "代表/CEO", "email": "ide@example.com", "tel": "070-0000-0000", "mobile": "", "fax": "",
    "postal": "343-0025", "address": "埼玉県越谷市大沢1306-10", "url": "https://example.com",
    "memo": QUOTE_MEMO, "confidence": 0.98, "notes": "",
}


def fake_client(content_blocks):
    resp = types.SimpleNamespace(stop_reason="tool_use", content=content_blocks)
    messages = types.SimpleNamespace(create=mock.Mock(return_value=resp))
    return types.SimpleNamespace(messages=messages)


class StructuredOutputTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.img = Path(self.tmp.name) / "card.png"
        make_sample.make_sample_card(self.img)

    def tearDown(self):
        self.tmp.cleanup()

    def test_tool_use_with_double_quotes(self):
        block = types.SimpleNamespace(type="tool_use", name=ingest.CARD_TOOL_NAME, input=dict(CARD_INPUT))
        client = fake_client([block])
        parsed, raw = ingest.extract_card_from_file(client, "dummy-model", self.img)
        self.assertEqual(parsed["memo"], QUOTE_MEMO)
        kwargs = client.messages.create.call_args.kwargs
        self.assertEqual(kwargs["tool_choice"], {"type": "tool", "name": ingest.CARD_TOOL_NAME})
        self.assertEqual(kwargs["tools"][0]["name"], ingest.CARD_TOOL_NAME)

    def test_text_fallback_with_broken_json_is_repaired(self):
        broken = ('{"company": "モノライフ合同会社", "name": "井手 剛", "title": "代表", '
                  '"memo": "キャッチコピー:「"モノ"を通じて」", "confidence": 0.9, "notes": ""}')
        block = types.SimpleNamespace(type="text", text=broken)
        client = fake_client([block])
        if ingest.json_repair is None:
            self.skipTest("json-repair 未インストール")
        parsed, _ = ingest.extract_card_from_file(client, "dummy-model", self.img)
        self.assertEqual(parsed["name"], "井手 剛")


class LockTest(unittest.TestCase):
    def test_lock_blocks_second_run_and_releases(self):
        with tempfile.TemporaryDirectory() as d:
            lock = Path(d) / "ingest.lock"
            self.assertTrue(ingest.acquire_lock(lock))
            self.assertFalse(ingest.acquire_lock(lock))  # 自分のPIDが生存 → スキップ
            ingest.release_lock(lock)
            self.assertFalse(lock.exists())

    def test_dead_pid_lock_is_discarded(self):
        with tempfile.TemporaryDirectory() as d:
            lock = Path(d) / "ingest.lock"
            lock.write_text("999999 %d\n" % int(__import__("time").time()), encoding="utf-8")
            self.assertTrue(ingest.acquire_lock(lock))
            ingest.release_lock(lock)

    def test_stale_lock_is_discarded(self):
        with tempfile.TemporaryDirectory() as d:
            lock = Path(d) / "ingest.lock"
            old = __import__("time").time() - ingest.LOCK_STALE_SECONDS - 10
            lock.write_text("%d %d\n" % (os.getpid(), old), encoding="utf-8")
            self.assertTrue(ingest.acquire_lock(lock))
            ingest.release_lock(lock)


class SafeMoveTest(unittest.TestCase):
    def test_busy_file_is_not_copied(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "a.pdf"
            src.write_bytes(b"x")
            dest = Path(d) / "error" / "a.pdf"
            dest.parent.mkdir()
            busy = PermissionError(13, "in use")
            busy.winerror = 32
            with mock.patch.object(ingest.os, "replace", side_effect=busy), \
                    mock.patch.object(ingest.time, "sleep") as slept:
                with self.assertRaises(ingest.MoveBusyError):
                    ingest.safe_move(src, dest)
                self.assertEqual(slept.call_count, ingest.MOVE_RETRY_COUNT - 1)
            self.assertTrue(src.exists())
            self.assertFalse(dest.exists())

    def test_normal_move(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "a.pdf"
            src.write_bytes(b"x")
            dest = Path(d) / "b.pdf"
            ingest.safe_move(src, dest)
            self.assertTrue(dest.exists())
            self.assertFalse(src.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
