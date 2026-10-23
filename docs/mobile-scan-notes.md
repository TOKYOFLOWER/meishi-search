# 名刺スマホ撮影登録 ― 調査メモ（Step 1）

作成: 2026-10-24 / ブランチ: feature/mobile-scan / 基準: GAS デプロイ @27 (nickname)

## ingest.py（読むだけ・変更しない）
- モデル: `cfg.model`（.env）。`tool_use` を `tool_choice` で強制（ツール名 `record_card`）、`max_tokens=2048`。
- 出力スキーマ（全て string、required）: `company, name, kana, department, title, email, tel, mobile, fax, postal, address, url, memo` ＋ `confidence`(number 0–1) ＋ `notes`(string)。
- プロンプト: SYSTEM_PROMPT（項目定義 ＋ ルール「日本語面優先／読めない項目は空文字／PDF複数ページは表裏統合」）。USER_PROMPT は「この名刺から情報を抽出しJSONで出力」。
- 氏名(`name`)が空は ExtractionError（会社名は空でも登録可）。
- 画像仕様: 本体 長辺1200px・JPEG品質80、表裏サムネ 長辺320px・品質70。
  **一覧用サムネ（thumbFileId）は表面のみ・幅480px・JPEG品質70**。→ 撮影機能のサムネはこの仕様（幅480/0.70）で canvas 生成する。
- GAS への POST: `Content-Type: text/plain;charset=utf-8`、body は JSON `{user, pass, action:"addCard", card:{...CARD_KEYS, source_file, scanned_at, batch_id, images?, listThumb?}}`。3回リトライ（5/15/45秒）、`auth`/`missing_required` は即時失敗。

## GAS（src/Code.js）
- ルーティング: `doPost` 内の `body.action` の if-else チェーン。先頭で `authAny_(body)` を必ず通る。
- 認証: `token`（端末トークン。devices シートに SHA-256 ハッシュ、last_seen から180日、10分キャッシュ）があればそれ、無ければ user/pass（Script Properties の APP_USER/APP_PASS）。失敗時 `{ok:false,error:'auth'|'AUTH'}`、800ms遅延。
- CORS 回避: フロントは `Content-Type: text/plain;charset=utf-8` の POST（プリフライト回避）。レスポンスは JSON の ContentService。
- addCard (`addCardToSheet`): 氏名必須。ScriptLock 取得後、重複判定 → id採番(M00001形式) → 行追記 → 重複候補タグ付与 → `invalidateBootstrapCache_()` → 画像保存。
  - 重複判定（登録を止める）: 会社名あり＝正規化(会社+姓+名)または(会社+氏名)一致、会社名なし＝氏名＋(メール or TEL/携帯)一致。一致時 `{ok:true,duplicate:true,row}` を返し**追記しない**。
  - 重複候補（登録は止めない・人物管理に「重複候補」タグ）: `findDupCandidates_`（メール一致／電話一致／同姓・名1字違い）。
  - 名刺交換日は取込時は空欄（一括設定画面で後入力）。イベント名は 接触履歴(contactType=名刺交換) に保存。
- bootstrap: `bootstrap_` が stats/newCards/tags/eventNames/filters を返す。CacheService キー `bootstrap:v1:<days>:<0|1>`（120秒）。書き込み系は `invalidateBootstrapCache_()`（キー削除＋LIST_VERSION更新）。
- 画像: Drive フォルダ `meishi-images`（Script Property `IMAGE_FOLDER_ID`）。名刺DB の末尾列 `imageFrontId, imageFrontThumbId, imageBackId, imageBackThumbId, thumbFileId` に fileId を保持。`saveCardImages_` / `attachImages_`。
  **既存の `cardImage` アクションは既に `side: front|back` と `hasFront/hasBack` に対応済み**（後方互換拡張は不要）。裏面列も既存。
- シート列参照: すべて**ヘッダー名参照**（`colIndex_`）。列の追加は末尾のみ。
- appsscript.json: oauthScopes に `script.external_request` が既にある（変更不要）。UrlFetchApp は未使用だったため初回実行で承認ダイアログが出る可能性あり → setupScanFeature で1回呼んで承認を発生させる。

## フロント（index.html）
- 単一HTMLのSPA。ハッシュルーティング（`route()` / `showView()`、`data-view` の `<section>`）。ビュー: home/new/review/person/sns/settings。
- IndexedDB: DB名 `meishi`、`IDB_VERSION=2`、ストア `list`・`thumbs`（`idbOpen` の onupgradeneeded）。→ v3 にして新ストア `scanQueue` を追加（既存ストアは触らない）。
- ローディング: `showBusy(msg)` / `hideBusy()`（カウンタ式）、`api(action, extra, {silent, busyMessage})`。`BUSY_MESSAGES` に action 別の既定文言。
- 詳細画面の画像: `renderCardImageBox` → `fetchCardImage(id, side, size)`（`cardImage` アクション）。裏面があれば表/裏チップで切替済み、タップで拡大モーダル。→ Step3-6「詳細画面の表/裏切替」は**既存実装で充足**。
- 一覧更新: `eightReloadFromServer()`。
- Service Worker / manifest: **リポジトリに存在しない**（grep 0件）→ キャッシュ名更新は不要。

## 設計判断
- 画像の本登録: drafts 作成時に Drive へ保存済みの fileId を、本登録時に名刺DBの画像列へ**直接リンク**（再アップロードしない）。imageFrontThumbId/imageBackThumbId にはドラフトのサムネを流用。
- `confirmDraft` は重複を `force` なしでは保存せず候補を返す（完全一致の `duplicate` と、`findDupCandidates_` の類似候補の両方）。`force` 時に完全一致で弾かれないよう、`addCardToSheet` に `card.force` を後方互換で追加（未指定時の挙動は不変）。
- `scanCard` は Claude 呼び出し（数十秒）中にロックを保持しない。draft 行作成のみロック下で行い、`clientId` で冪等化。
- `drafts` シート未作成時は `not_setup` を返し、setupScanFeature（バックアップ付き）の実行を強制する。
- bootstrap の `draftCount` はキャッシュ対象外（毎回計算して差し込む）。
