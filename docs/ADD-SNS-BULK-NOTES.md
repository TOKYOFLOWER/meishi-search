# 作業メモ：SNSアカウント確認＋名刺交換情報の一括設定（＋CRM第1段階の土台）

作成: 2026-09-09　着手前コミット: `06e5a06`　バックアップ: `backup/20260909_1026/`

## STEP 0: 現状把握（判明事項）

### 重要な前提の食い違い

指示書は「第1段階（人物管理シート・接触履歴シート・新着整理画面・タグ/メモ）が実装済み」を前提にしていたが、
リポジトリにも GAS 本番（`clasp -u tokyoflower pull` で取得し `src/Code.js` と完全一致を確認）にも **第1段階は未実装**。
docs/ も存在しなかった。ユーザーから第1段階仕様書と追加要件の全文が提供されたため、
**追加要件が依存する第1段階の土台（人物管理・接触履歴・新着名刺・新着整理・人物詳細）を同時に実装する**方針とした。

### 既存実装の要点（src/Code.js 413行）

| 項目 | 内容 |
|---|---|
| doPost action | `ping` / `filters` / `search`(q: keyword,pref,industry,roleLevel) / `addCard`(card) / それ以外 `unknown_action` |
| 認証 | `authOk_(user, pass)`：スクリプトプロパティ APP_USER / APP_PASS と照合。失敗時 800ms 遅延 |
| シート | `名刺DB` のみ。HEADER = id, 会社名, 部署名, 役職, 役職レベル, 氏名, 姓, 名, 業種, メール, 郵便番号, 都道府県, 市区町村, 住所, 会社TEL, 携帯, Fax, URL, 名刺交換日, 取込日 (+ `備考` は addCard が無ければ末尾追加) |
| 列アクセス | `colIndex_(header)` でヘッダ名→添字。ハードコード列番号なし（importEightCsv の append 配列は HEADER 順に依存） |
| id | `M00001` 形式。既存最大+1 |
| 名刺交換日 | addCard: `scanned_at` の先頭10文字（無ければ今日）。Eight CSV: CSV の「名刺交換日」列そのまま。日付は Date 型/文字列が混在し得る（search では Date→`yyyy/MM/dd`） |
| 取込日 | addCard / importEightCsv とも `yyyy-MM-dd` 文字列で today |
| 新着判定 | **存在しない**。第1段階仕様どおり `取込日` の期間（1/3/7/30日）で判定する |
| 整理ステータス | **存在しない** → 人物管理シートに `organized` を持つ |
| 取込バッチID | **存在しない** → `名刺DB` 末尾に `importBatchId` を追加（addCard: `scan-YYYYMMDD`、Eight CSV: `eight-YYYYMMDD-HHmm`） |
| 接触履歴 contactType | シート自体が無い。既存値なし → 今回 `名刺交換` を基本値、手動追加では 名刺交換/面談/電話/メール/紹介/その他 |
| 排他 | addCard は `LockService.getScriptLock()` |
| ingest/ingest.py | `addCard` に `scanned_at`(ファイル mtime ISO) と `source_file` を送る。バッチIDは送っていない → `batch_id`（`scan-YYYYMMDD`）を追加送信（GAS 側は未指定でも同じ既定値を採用） |

### index.html（270行、GitHub Pages）

- 画面: `#login`（ID/パス）→ `#app`（header／検索 panel：キーワード・都道府県・業種・役職 select・クイックチップ／結果カード）
- `api(action, extra)`：`GAS_URL` へ `text/plain` POST。sessionStorage `meishi_creds` に資格情報
- 検索は keyword/pref/industry/roleLevel が全部空なら送信しない

### 名称の読み替え表（要件書 → 既存実装）

| 要件書 | 実装 |
|---|---|
| 人物管理シート（名刺情報の主体） | `名刺DB` シート（既存列は変更しない）＋ CRM/SNS 情報は新シート `人物管理`（contactId = 名刺DB.id） |
| 接触履歴シート | 新シート `接触履歴` |
| 名刺交換日 | `名刺DB.名刺交換日`（'YYYY-MM-DD' 文字列で保存） |
| 「今回取り込んだ新着」 | `取込日` が指定期間内（既定 7日）。`importBatchId` 一致でも指定可 |
| 未整理 | `人物管理` に行が無い、または organized ≠ TRUE |
| contactId | `名刺DB.id`（M00001） |

## シート設計（列は末尾追加のみ。既存列の削除・並べ替え禁止）

### 名刺DB（既存）
末尾に `importBatchId` を追加（無い場合のみ）。

### 人物管理（新規）
`contactId, organized, importance, relationship, tags, needs, canIntroduce, wantIntroduce, nextAction, nextActionDate, memo, facebookUrl, instagramUrl, linkedinUrl, xUrl, youtubeUrl, otherSnsUrl, snsCheckedAt, createdAt, updatedAt`
- 1 contactId 1行（upsert）。organized は TRUE/FALSE。tags はカンマ区切り文字列。
- nextActionDate は 'YYYY-MM-DD'、snsCheckedAt/createdAt/updatedAt は 'YYYY-MM-DD HH:mm:ss'。日付列は書式 `@`（文字列）。

### 接触履歴（新規）
`contactId, contactDate, eventName, contactType, memo, followUp, followDate, createdAt`
- contactDate/followDate 'YYYY-MM-DD'。followUp TRUE/FALSE。重複判定キー = contactId+contactDate+eventName+contactType。

## API 契約（doPost。全 action が APP_USER/APP_PASS 認証必須。応答 `{ok:true,data:…}` / `{ok:false,error:'…'}`）

既存: `ping` `filters` `search` `addCard`（挙動不変。search は q に条件が増えるだけ）

| action | 入力 | 出力 data |
|---|---|---|
| `stats` | なし | `{total, newCount, unorganizedCount, followCount, days:7}` |
| `newCards` | `{days:1\|3\|7\|30, onlyUnorganized:bool}` | `{count, days, items:[summary]}`（取込日降順・id降順） |
| `person` | `{id}` | `{card, crm, sns, histories}` |
| `savePerson` | `{id, crm:{importance,relationship,tags,needs,canIntroduce,wantIntroduce,nextAction,nextActionDate,memo}, organized?}` | `{id, organized, updatedAt}`（crm に含まれるキーだけ更新。organized 未指定なら true） |
| `markOrganized` | `{id, organized:bool}` | `{id, organized}` |
| `addContact` | `{id, contactDate, eventName, contactType, memo, followUp, followDate}` | `{created:bool, duplicate:bool, label}` |
| `eventNames` | なし | `{items:[{name,count}]}` 出現回数降順 最大30 |
| `tags` | なし | `{items:[{name,count,quick}]}` 初期12件（quick:true）＋人物管理 tags の DISTINCT（出現回数降順） |
| `snsMarkChecked` | `{id}` | `{id, snsCheckedAt}` 候補なしで確認済みにする（URL列は変更しない） |
| `bulkContactPreview` | `{scope:'batch'\|'unset'\|'ids', batchId?, days?, ids?, date, eventName}` | `{targetCount, willOverwriteCount, alreadyHistoryCount, targetIds}` |
| `bulkContactApply` | 同上 + `overwrite:bool` | `{targetCount, updatedDateCount, createdHistoryCount, skippedDupCount, label}` |
| `snsDetectFromSite` | `{id}` | `{siteUrl, candidates:[{platform,url,source:'公式サイト',sourceUrl}], error?}` 保存しない |
| `snsSearchLinks` | `{id}` | `{query, links:[{platform,label,google,native}]}`（native は Instagram null） |
| `snsSave` | `{id, platform, url}` | `{id, platform, url, snsCheckedAt}` https 必須・該当ドメインのみ |
| `snsRemove` | `{id, platform}` | `{id, platform}` |

- summary = `{id, name, company, dept, title, roleLevel, industry, importedAt, exchanged, batchId, organized, tags:[], snsChecked, lastEvent}`
- card = `{id, company, dept, title, roleLevel, name, industry, email, postal, pref, city, address, telCompany, mobile, fax, url, exchanged, importedAt, batchId, biko}`
- crm = `{organized, importance, relationship, tags:[], needs, canIntroduce, wantIntroduce, nextAction, nextActionDate, memo}`
- sns = `{facebookUrl, instagramUrl, linkedinUrl, xUrl, youtubeUrl, otherSnsUrl, snsCheckedAt}`
- histories[] = `{contactDate, eventName, contactType, memo, followUp, followDate, createdAt, label}` 新しい順
- platform = `facebook|instagram|linkedin|x|youtube|other`
- scope: `batch` = batchId 指定なら importBatchId 一致、無ければ 取込日 が days 日以内（既定7）。`unset` = 同じ窓（days/batchId 指定時）かつ 名刺交換日 空。`ids` = 指定 id 群
- date は 'YYYY-MM-DD' に正規化（'2026/09/08' '2026.9.8' も受理）。不正なら `error:'bad_date'`
- 表示ラベル `formatContactLabel_(eventName, iso)` → `守成 青山デイライト 260908`（内部保存には使わない）
- 検索 q 追加: `eventName`（部分一致）, `contactFrom`, `contactTo`（'YYYY-MM-DD'）, `tag`（完全一致）, `followDue:true`（要フォロー期限到来）。
- 要フォロー（stats.followCount／search followDue）の定義: 人物管理.nextActionDate ≤ 今日、または 人物管理.tags に「要フォロー」を含む、または 接触履歴.followUp=TRUE かつ followDate ≤ 今日（`followDueSet_`。検証は `test_follow_`：日付のみ／タグのみ／両方なし の3件で該当2件）。指定時のみ接触履歴/人物管理を結合。従来パラメータのみの挙動は不変。items に `tags:[]`, `lastEvent` を追加

一時 action（本番実行後に削除）: `_setupColumns`（列追加）／`_runTests`（test_bulk_ と test_sns_ を実行し結果を返す）

## 2026-09-09 名刺画像の保存と表示

- 名刺DB 末尾に `imageFrontId, imageFrontThumbId, imageBackId, imageBackThumbId`（Drive fileId。`setupSnsBulkColumns_` で冪等追加）
- Drive フォルダ `meishi-images`（`setupImageFolder_` が作成／再利用し、スクリプトプロパティ `IMAGE_FOLDER_ID` に保存。共有設定は変更しない）。ファイル名 `{contactId}_front.jpg` `_front_thumb.jpg` `_back.jpg` `_back_thumb.jpg`。上書き時は旧ファイルをゴミ箱へ
- appsscript.json に `oauthScopes`（spreadsheets / drive / script.external_request）を明示 → **デプロイ後に再承認が必要**（GAS エディタで `setupImageFolder_` を実行して承認）
- action:
  - `addCard` は `card.images = {front:{full,thumb}, back?:{full,thumb}}`（base64 JPEG）を受け取ると保存。無い／失敗でも登録は成功（応答に `images` を追加、既存キー不変）
  - `attachImages` `{contactId, images}` → `{contactId, imageFrontId, imageFrontThumbId, imageBackId, imageBackThumbId}`。`not_found` / `no_images` / `drive_error`
  - `cardImage` `{contactId, side:'front'|'back', size:'thumb'|'full'}` → `{image: base64|null, mime, hasFront, hasBack}`（fileId が無ければ `image:null`）
  - `cardsWithoutImage` → `{items:[{contactId, sourceFile}]}`（imageFrontId が空で備考が `scan:<元ファイル名>` の人物）
- bootstrap / newCards / search / person の応答に画像データは含めない（`CARD_LIST_COLS` に画像列を入れていない）
- ingest.py: `build_card_images()` で縮小画像を生成し addCard に同梱。`--backfill [--dry-run]` で cardsWithoutImage → `E:\namecardscan\done\**` / `error\` から元ファイルを探し attachImages
- フロント: 人物詳細・整理モードで `cardImage(thumb)` を非同期（オーバーレイなし）取得しサムネ表示、タップで full を取得して拡大モーダル。取得済みはメモリキャッシュ、整理モードでは次の1人を先読み
- 検証: `test_image_`（ハーネス: attach→4列に fileId、cardImage thumb/full、fileId 空で null、cardsWithoutImage、not_found / no_images）合格。実 Drive での動作はデプロイ後に GAS エディタで `test_image_` を実行して確認

## 2026-09-09 初期表示の高速化（bootstrap 1本化＋CacheService）

- 新 action `bootstrap` `{days?:1|3|7|30(既定7), onlyUnorganized?:bool(既定true)}` → `{stats, newCards(+onlyUnorganized), tags, eventNames, filters, cached, generatedAt}`。各シートの getValues は1回ずつ（名刺DB は必要列だけ2ブロック、人物管理・接触履歴は全列1回）。個別 action（stats / newCards / tags / eventNames / filters / ping）は契約不変で存続
- CacheService（スクリプトキャッシュ）に 120 秒キャッシュ。キー `bootstrap:v1:{days}:{0|1}`。100KB 超は gzip+base64、それでも超える場合はキャッシュせず動作継続。書き込み系 action（savePerson / markOrganized / addContact / bulkContactApply / snsSave / snsRemove / snsMarkChecked / addCard）の末尾で全キーを削除
- 読取範囲: `readCards_(CARD_LIST_COLS)` で名刺DB の判定・表示列（id〜業種・都道府県・名刺交換日・取込日・importBatchId）だけを読む。接触履歴の並び替えは必要な contactId だけ遅延（`histSorted_`）。`ss_()` は実行内で openById を1回にメモ化
- フロント: ログイン／自動ログインで bootstrap を1回だけ呼び、filters・eventNames・tags・stats・新着一覧（既定条件）を同時に描画。新着画面の初回は bootstrap の一覧を使い、条件変更・書き込み後は newCards を再取得
- 計測（tests/gas_perf.js、4,000行ダミー。時間はスタブ上の目安で、主指標は読取回数）:

| | GAS 呼び出し本数 | getValues 回数 | 読取セル数 | openById |
|---|---|---|---|---|
| 改修前（ping+filters+eventNames+tags+stats） | 5 | 9 | 約330,000 | 9 |
| 改修後 bootstrap（未キャッシュ） | 1 | 5 | 約86,000 | 1 |
| 改修後 bootstrap（キャッシュ命中） | 1 | 0 | 0 | 0 |

- 検証: bootstrap の結果が個別5本の結果と JSON 一致、書き込み後にキャッシュが消えて次の bootstrap が最新（未整理 -1）を返す。既存テスト4本も全合格

## 2026-09-09 追加変更（処理中オーバーレイ／一括処理高速化／取込時交換日の空欄化）

- index.html: `showBusy(message)` / `hideBusy()` を `api()` に組み込み、全 API 呼び出しで自動表示・finally で必ず非表示。一括設定モーダルは送信中ボタン無効化＋二重送信防止
- Code.js `bulkContactApply_`: 名刺DB は1回読み、交換日は書き込み対象行を連続ランごとに1回の `setValues`（対象外行には触れない）、接触履歴は末尾に1回の `setValues`。重複判定は既存履歴を1回読んで Set 化。Logger に処理時間を出力
- Code.js `addCardToSheet`: 名刺交換日を空欄で登録（従来はスキャン日／取込日を入れていた）。取込日・importBatchId は従来どおり。既存行は変更しない。`scanned_at` は互換のため受け取るが未使用
- 検証: GAS の SpreadsheetApp をメモリ上でスタブした Node ハーネス（tests/gas_harness.js（実行: node tests/gas_harness.js。非連続行の検証は tests/gas_harness_bulk_runs.js））で `test_bulk_` `test_addCard_` `test_follow_` `test_sns_` が全項目合格、テスト行の残留なし、既存行の値不変を確認。実シートでの再実行はデプロイ後に GAS エディタから

## 追加列一覧（すべて末尾追加。既存列の削除・並べ替えなし）

| シート | 追加列 | 備考 |
|---|---|---|
| 名刺DB | `importBatchId` | addCard: `scan-YYYYMMDD`（ingest.py が `batch_id` を送信）／Eight CSV: `eight-YYYYMMDD-HHmm` |
| 名刺DB | `imageFrontId, imageFrontThumbId, imageBackId, imageBackThumbId` | Drive（meishi-images）の fileId。画像本体は置かない |
| 人物管理（新規） | `contactId, organized, importance, relationship, tags, needs, canIntroduce, wantIntroduce, nextAction, nextActionDate, memo, facebookUrl, instagramUrl, linkedinUrl, xUrl, youtubeUrl, otherSnsUrl, snsCheckedAt, createdAt, updatedAt` | contactId = 名刺DB.id。日付列は書式 `@` |
| 接触履歴（新規） | `contactId, contactDate, eventName, contactType, memo, followUp, followDate, createdAt` | 重複キー contactId+contactDate+eventName+contactType |

列追加は `setupSnsBulkColumns_()`（冪等）で実施。書き込み系 action は毎回これを呼ぶので、シートを誤って消しても次の書き込みで再作成される。

## 追加 action 一覧

`bootstrap` `cardImage` `attachImages` `cardsWithoutImage` `stats` `newCards` `person` `savePerson` `markOrganized` `addContact` `eventNames` `tags` `snsMarkChecked` `bulkContactPreview` `bulkContactApply` `snsDetectFromSite` `snsSearchLinks` `snsSave` `snsRemove`（入出力は上の契約表）。
一時 action `_setupColumns` / `_runTests` は 2026-09-09 に本番（デプロイ @9）で各1回実行し、結果は列追加 OK（2回目は追加なし）・test_bulk_ 8/8 合格・test_sns_ 12/12 合格。実行後にコードから削除して push 済み（`setupSnsBulkColumns_` / `test_bulk_` / `test_sns_` は GAS エディタから実行可能）。
削除版のデプロイ（`clasp -u tokyoflower deploy -i <既存ID> -d "SNS/一括設定 追加"`）は権限判定でブロックされたため、最終レポートの手順で再実行が必要（それまで @9 には認証必須の一時 action が残る）。

## ロールバック手順

- **コード**: `git checkout 06e5a06 -- src index.html ingest/ingest.py` → `clasp -u tokyoflower push -f` → `clasp -u tokyoflower deploy -i AKfycbypcs3Kz4DYFcQtLwRxY4bSPM0ZO_6bjpNwCC1cEPWs8hNer1qWKtRVxTWB9j3aQOHz-g -d "rollback"`（デプロイIDは index.html の GAS_URL と同じもの。新規デプロイは作らない）
- **シート**: 追加列は末尾追加のみなので、`名刺DB` の `importBatchId` 列を削除すれば元に戻る。`人物管理` `接触履歴` シートは丸ごと削除可（旧コードは参照しない）。接触履歴の一括生成行は `createdAt`（同一タイムスタンプ）と `eventName` で特定してフィルタ削除できる。名刺交換日の一括更新は、空欄だった行に書き込んだもの（上書き確認をした場合のみ既存値を変更）
- **着手前ファイル一式**: `backup/20260909_1026/`（Code.js, appsscript.json, index.html, README.md, ingest.py）

## 変更ファイル

`src/Code.js`（API・列セットアップ・テスト）／`index.html`（新着・整理・人物詳細・SNS確認・一括設定・イベント検索）／`ingest/ingest.py`（batch_id 送信）／`README.md`（運用手順）／`docs/CRM-ADD-SNS-BULK.md`（要件書）／`docs/ADD-SNS-BULK-NOTES.md`（本書）
