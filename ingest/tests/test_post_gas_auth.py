#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""post_gas の認証情報(ingestKey / user・pass)の載せ方と locked の扱いのテスト。GASには接続しない。"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import ingest  # noqa: E402


class _Resp:
    def __init__(self, data, status=200):
        self._d, self.status_code = data, status

    def json(self):
        return self._d


def _cfg(**kw):
    base = dict(gas_url="https://example.com/exec", app_user="", app_pass="",
                watch_dir=Path("."), model="m")
    base.update(kw)
    return ingest.Config(**base)


def _post_body(cfg):
    sent = []

    def fake(url, data=None, headers=None, timeout=None):
        sent.append(json.loads(data))
        return _Resp({"ok": True})

    with mock.patch.object(ingest.requests, "post", side_effect=fake):
        ingest.post_gas(cfg, "ping", {})
    return sent[0]


class PostGasAuthTest(unittest.TestCase):
    def test_ingest_key_only(self):
        b = _post_body(_cfg(ingest_key="K"))
        self.assertEqual(b, {"action": "ping", "ingestKey": "K"})

    def test_both(self):
        b = _post_body(_cfg(ingest_key="K", app_user="u", app_pass="p"))
        self.assertEqual(b, {"action": "ping", "ingestKey": "K", "user": "u", "pass": "p"})

    def test_user_pass_only(self):
        b = _post_body(_cfg(app_user="u", app_pass="p"))
        self.assertEqual(b, {"action": "ping", "user": "u", "pass": "p"})

    def test_locked_not_retried(self):
        calls = []

        def fake(url, data=None, headers=None, timeout=None):
            calls.append(1)
            return _Resp({"ok": False, "error": "locked"})

        with mock.patch.object(ingest.requests, "post", side_effect=fake):
            with self.assertRaises(ingest.GasError):
                ingest.post_gas(_cfg(ingest_key="K"), "ping", {})
        self.assertEqual(len(calls), 1)

    def test_check_config(self):
        with mock.patch.dict(ingest.os.environ, {"ANTHROPIC_API_KEY": "x"}):
            self.assertIsNone(ingest.check_config(_cfg(ingest_key="K"), True))
            self.assertIsNone(ingest.check_config(_cfg(app_user="u", app_pass="p"), True))
            self.assertIsNotNone(ingest.check_config(_cfg(), True))


if __name__ == "__main__":
    unittest.main()
