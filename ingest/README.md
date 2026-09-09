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

## 名刺画像

- 取込時（`--once` / `--watch` / `--file`）に、抽出に使った画像ファイルから表面（PDFで2ページ目があれば裏面も）の
  縮小画像を作り、`addCard` 送信時に一緒に GAS へ送ります。GAS 側は Drive の非公開フォルダに保存します。
  - full（長辺1200px, JPEG品質80）と thumb（長辺320px, JPEG品質70）の2種類。
  - 送信データの合計サイズが大きい場合は品質を自動的に下げ、それでも大きければ裏面のfull→裏面全体の順に落とします。
  - 画像の生成に失敗しても（PDFの読み取り不可などでも）カード登録自体は止めず、警告ログを出して続行します。
  - `--dry-run` では画像本体は表示せず、full/thumbのサイズだけを表示します。
- 元画像（`E:\namecardscan` 配下）は書き換えません。

### 過去分の画像バックフィル（`--backfill`）

まだ画像が登録されていない名刺（GAS側で imageFrontId が空のもの）に対して、備考の `scan:<元ファイル名>` を手掛かりに
`done\` / `error\` から元ファイルを探し、後から画像を紐付けます。

```
.venv\Scripts\python.exe ingest.py --backfill --dry-run   REM 対象件数・紐付け可否だけ確認（送信しない）
.venv\Scripts\python.exe ingest.py --backfill              REM 実際にGASへ画像を送信して紐付ける
```

- `--dry-run` を付けても GAS への問い合わせ（対象一覧の取得）自体は行いますが、画像の送信は行いません。
- `done\` は再帰的に、`error\` は直下を探します。ファイル名が完全一致しない場合は、取込時に重複回避で付いた
  連番（`stem_1.jpg` など）も候補にします。`dup_` が付いたファイル（重複扱いで退避されたもの）は対象外です。
- 元ファイルが見つからない、または画像生成・送信に失敗した分はログに出してスキップし、次に進みます。

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
.venv\Scripts\python.exe ingest.py --backfill --dry-run REM 画像未登録の名刺の紐付け可否を確認
.venv\Scripts\python.exe ingest.py --backfill           REM 画像未登録の名刺に過去分の画像を紐付ける
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
