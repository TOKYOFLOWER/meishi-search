# TASK.md ― 名刺検索アプリを完成させる（Claude Code 実行用ランブック）

あなた（Claude Code）は、このプロジェクトを **CLIで完成まで実行** してください。
人間のブラウザ操作が必要なのは「Googleログイン承認」など3点だけです（理由は末尾）。
それ以外（push / deploy / git）は全て自動で実行し、最後にWebアプリURLを報告してください。

## 既存の状況（すべて作成・配置済み）
- ローカル: `X:\projects\meishi-search`（このフォルダ）
- GASプロジェクト: 名刺検索アプリ
  scriptId: `1K6cWdK30iEUfgT-FESrZuZe7fa_Cl8iKwFvJPiPRY9g35U0hcnnQdjZu`
- スプレッドシート: 名刺人脈DB
  id: `1gy6viELdXZnGWcNbPGqKmdJjrrteBE7dI1RhS-r8OVY`（Code.jsに埋込済）
- GitHub: `https://github.com/TOKYOFLOWER/meishi-search.git`
- `data/` に個人情報CSV在中 → **GitHubへは絶対にpushしない**（.gitignoreで除外済）

## ファイル構成
```
meishi-search/
├── .clasp.json      # scriptId設定済み
├── .claspignore     # src外をpushしない
├── .gitignore       # data/ と *.csv を除外
├── src/             # clasp push対象
│   ├── appsscript.json   # webapp: 実行=自分 / アクセス=自分のみ
│   ├── Code.js           # 検索API・名寄せ取込（openById方式）
│   └── Index.html        # スマホUI
└── data/
    ├── 名刺DB_初期データ.csv     # 整形済み3,799件（初回投入用）
    └── Eight…sjis.csv            # 生データ（今後の追加用）
```

---

## あなたが実行する手順（CLI・自動）

### 1. 前提チェック
```bash
node -v
clasp -v            # 無ければ: npm install -g @google/clasp
clasp login --status
```
- `clasp login --status` が未ログインなら、**ここで停止**して人間に
  「`clasp login` を実行してブラウザ認証してください」と依頼する（自動化不可）。

### 2. 構成の健全性チェック
```bash
# scriptId が設定されているか
grep -q "1K6cWdK30iEUfgT" .clasp.json && echo "clasp ok"
# Code.js が openById 版か（SPREADSHEET_ID 行があること）
grep -q "SPREADSHEET_ID" src/Code.js && echo "code ok"
# .gitignore が data/ と csv を除外しているか
grep -q "data/" .gitignore && grep -q "\*.csv" .gitignore && echo "gitignore ok"
```
- いずれか NG なら修正してから次へ。

### 3. コードをGASへ反映
```bash
clasp push -f
```
- 既定の `コード.gs` は置き換わり、`Code.gs` と `Index.html` が反映される。

### 4. Webアプリとして公開し、URLを生成
```bash
clasp deploy --description "v1 名刺検索"
clasp deployments
```
- 最新の deploymentId（`AKfyc...`）を取得し、URLを組み立てて表示する：
  `https://script.google.com/macros/s/<deploymentId>/exec`
- `appsscript.json` の設定により「自分として実行 / 自分のみアクセス」で公開される。

### 5. GitHubへ反映（個人情報の混入チェックを必須化）
```bash
git init
git add .
git status            # ← data/ と *.csv が "含まれていない" ことを必ず確認
```
- **もし data/ や .csv がステージされていたら、中止して人間に報告**（.gitignore不備）。
- 問題なければ続行：
```bash
git commit -m "init: 名刺検索アプリ（個人データ除外）"
git branch -M main
git remote add origin https://github.com/TOKYOFLOWER/meishi-search.git
git push -u origin main
```

### 6. 完了報告
- 手順4で生成した **Web App URL** を提示。
- 「人間が行う残り3ステップ（下記）」を案内。

---

## 人間が行う残りステップ（ブラウザ・各1回のみ）

- **A. clasp未ログインなら** `clasp login`（手順1で停止した場合のみ）
- **B. 認可**: 手順4のURLを本人のGoogleアカウントで開き、初回の「承認」を許可
- **C. データ投入**:
  スプレッドシート「名刺人脈DB」のタブ名を **`名刺DB`** にして、
  **ファイル > インポート** で `data/名刺DB_初期データ.csv` を
  「**現在のシートを置き換える**」で読み込む（3,799件）

> 今後の追加（残り約2,500件）は、生Eight CSVをDriveにアップ →
> スクリプトプロパティ `DRIVE_CSV_ID` にファイルIDを設定し、エディタで `runImport` を実行
> （バインドGASならメニュー「名刺DB > ②」）。

---

## なぜ B・C は自動化できないか
Googleのログイン同意画面・OAuth認可は、セキュリティ上スクリプト（CLI）から操作できません。
ここだけは本人がブラウザで1回クリックする必要があります。逆に言えば、それ以外は全自動です。

## 完了判定
- [ ] スマホでURLが開き、ヘッダに「登録 3,799件」
- [ ] キーワード／都道府県／業種で結果が絞れる
- [ ] カードの 電話／メール／地図 がスマホで起動
- [ ] GitHubリポジトリに `data/`・`*.csv` が存在しない（個人情報が出ていない）
