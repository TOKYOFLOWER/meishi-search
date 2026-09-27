# Eight風UI改修（2026-09-27）バックアップ・ロールバック手順

feature/eight-ui ブランチでの改修（デバイストークン永続ログイン・listLite/listDelta軽量一覧・サムネ配信・
Eight風一覧UI）開始前に取得したバックアップと、切り戻し手順。

## バックアップの所在

- **git**: `backup/pre-eight-ui-20260927` ブランチ（`origin` に push 済み）。フロント・GAS(src)・ingest が
  同一リポジトリのため、これで3つ全体のスナップショットになる。
- **GAS（clasp pull結果）**: `backup/20260927/src/`（Code.js / Index.html / appsscript.json。`.gitignore` で
  コミット対象外）。
- **スプレッドシート（名刺DB本体の複製）**: `名刺DB_backup_20260927`
  （Google Drive ファイルID: `1dTUGA3rBQBMKfdaLBxPfVF7xapn_QrCiUwDSw53lWWs`）。
  `src/Code.js` の一時関数 `backupSheet_()`（実行用ラッパー `runBackupSheet()`）を GAS エディタで手動実行して作成。

## ロールバック手順

- **フロント/GAS(src)/ingest（git）**:
  ```
  git checkout backup/pre-eight-ui-20260927
  git push -f origin main
  ```
- **GAS（デプロイを戻す場合）**: `backup/20260927/src/` の内容を `src/` に戻し、
  `clasp -u tokyoflower push -f` → `clasp -u tokyoflower deploy -i AKfycbypcs3Kz4DYFcQtLwRxY4bSPM0ZO_6bjpNwCC1cEPWs8hNer1qWKtRVxTWB9j3aQOHz-g`
  （デプロイIDは変えない）。
- **スプレッドシート（データを戻す場合）**: `名刺DB_backup_20260927`（ID: `1dTUGA3rBQBMKfdaLBxPfVF7xapn_QrCiUwDSw53lWWs`）
  の内容を本体スプレッドシート（`1gy6viELdXZnGWcNbPGqKmdJjrrteBE7dI1RhS-r8OVY`）に戻す。今回の改修で追加された
  `devices` シートと `thumbFileId` 列を削除すれば、既存列は変更していないため元の状態に戻る。

## 後片付け

- `backupSheet_()` / `runBackupSheet()`（`src/Code.js`）は動作確認が一通り終わったら削除してよい一時関数。
