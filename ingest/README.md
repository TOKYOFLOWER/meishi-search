# 名刺スキャン自動取り込み（ScanSnap → Claude → 名刺DB）

ScanSnap が `E:\namecardscan` に保存した名刺画像／PDF を、Claude で読み取り、
GAS の Web App（`addCard` アクション）経由でスプレッドシート「名刺DB」に追記します。

## 日常の使い方

1. ScanSnap で名刺をスキャンし、保存先を `E:\namecardscan` にする（jpg / jpeg / png / pdf）。
   PDF が複数ページの場合は 1 枚の名刺の表裏として扱います。
2. Windows タスクスケジューラの `meishi-ingest` が 15 分ごとに `run_ingest.bat` を実行します。
   スキャンから最長 15 分でシートに反映されます。
3. 処理結果によりファイルが移動します。
   - 新規登録: `E:\namecardscan\done\YYYYMM\<元ファイル名>`
   - 重複（同じ会社名＋氏名が既にある、または同一ファイルの再投入）: `done\YYYYMM\dup_<元ファイル名>`
   - 失敗: `E:\namecardscan\error\<元ファイル名>` と同名の `.log`（理由と Claude の生応答）

シートには `備考` 列（無ければ自動追加）に `scan:<元ファイル名>` が入るので、取り込み元を追えます。
`importBatchId` には `scan-YYYYMMDD` が入ります。`名刺交換日` は取込時には入れません（スキャン日≠交換日のため）。検索画面の「交換情報を一括設定」で入れてください。

## error\ フォルダの扱い

- `.log` を開いて理由を確認します。よくある原因は「会社名も氏名も読めない」「JSON パース失敗」「GAS 認証失敗（.env の APP_USER / APP_PASS）」です。
- 画像を撮り直す、または `.env` を直したうえで、ファイルを `E:\namecardscan` 直下に戻せば次回に再処理されます
  （前回 error だったファイルは sha256 が同じでも再処理します）。
- 手で登録済みなら、ファイルは削除して構いません。

## 手動実行

```
cd /d X:\projects\meishi-search\ingest
run_ingest.bat                                         REM 監視フォルダを 1 回走査
.venv\Scripts\python.exe ingest.py --dry-run           REM 送信せず抽出結果だけ表示
.venv\Scripts\python.exe ingest.py --file <パス>       REM 1 ファイルだけ処理
.venv\Scripts\python.exe ingest.py --watch             REM 60 秒間隔で常駐（Ctrl+C で終了）
```

ログは `ingest\logs\ingest_YYYYMMDD.log`（1 ファイル 1 行: 結果 / ファイル名 / 会社名 / 氏名 / 行番号）。
処理済みの記録は `ingest\state.json`（sha256 単位）。

## 停止・再開・削除

```
schtasks /End    /TN "meishi-ingest"       REM 実行中なら止める
schtasks /Change /TN "meishi-ingest" /DISABLE
schtasks /Change /TN "meishi-ingest" /ENABLE
schtasks /Delete /TN "meishi-ingest" /F    REM 登録を消す
```

再登録:

```
schtasks /Create /TN "meishi-ingest" /TR "X:\projects\meishi-search\ingest\run_ingest.bat" /SC MINUTE /MO 15 /F
```

## 初期セットアップ（別 PC に移すとき）

```
cd /d X:\projects\meishi-search\ingest
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
```

`.env` に以下を記入します（Git には含めません）。

| キー | 内容 |
|---|---|
| ANTHROPIC_API_KEY | Anthropic の API キー |
| GAS_URL | Web App の `/exec` URL（index.html と同じ） |
| APP_USER / APP_PASS | GAS のスクリプトプロパティと同じ値 |
| WATCH_DIR | 監視フォルダ（既定 `E:\namecardscan`） |
| MODEL | 読み取りに使うモデル（既定 `claude-sonnet-4-6`） |

テスト画像の生成（Pillow が必要: `.venv\Scripts\pip install -r tests\requirements-dev.txt`）:

```
.venv\Scripts\python.exe tests\make_sample.py                 REM E:\namecardscan\_test_card.png
.venv\Scripts\python.exe tests\make_sample.py --variant 1 --out E:\namecardscan\_test_card_v1.png
```

## GAS 側（src/Code.js）

- `doPost` の `action: "addCard"` が `addCardToSheet(card)` を呼びます。
- 重複判定は会社名＋姓＋名（および会社名＋氏名）を、空白除去・全角→半角・小文字化して比較します。
- 都道府県／市区町村、業種、役職レベルは Eight CSV 取り込みと同じ関数で派生します。
- GAS エディタで `test_addCard_` を実行すると、ダミー 1 件を追記して即削除する自己完結テストができます。
- 更新手順: `clasp -u tokyoflower push -f` → `clasp -u tokyoflower deploy -i <既存デプロイID> -d "<説明>"`
  （デプロイ ID を変えると index.html の URL が無効になるので、必ず `-i` で既存 ID を指定）。
