# TASK_pages.md ― GitHub Pages版（ログイン認証付き検索UI）への移行

## 目的
スマホ最適化された検索画面をGitHub Pagesで公開しつつ、個人情報は一切公開しない。
画面（ガワ）だけPagesに置き、データは非公開のGAS/スプレッドシートに残す。
ID/パスはGAS側で照合し、一致時のみ結果を返す。

## セキュリティ設計（要点）
- GitHub Pages = HTML/CSS/JSのみ。**個人情報・パスワードは置かない**
- データは GAS Web App（doPost API）経由でのみ取得。**ID/パス照合に成功した時だけ返る**
- ID/パスは GAS のスクリプトプロパティ `APP_USER` / `APP_PASS`（サーバー側）
- 検索エンジン除外：`noindex` メタ ＋ `robots.txt`（※隠すだけ。本当の鍵はパスワード）
- 総当たり対策：認証失敗時に0.8秒の遅延。**パスワードは長めに**

## 変更ファイル
```
meishi-search/
├── index.html      ← 新規(直下)。Pagesのトップ。ログイン+検索
├── robots.txt      ← 新規。検索エンジン除外
├── .nojekyll       ← 新規。静的HTMLをそのまま配信
└── src/
    ├── Code.js          ← 差し替え。doPost API + ID/パス照合。doGetは案内のみ
    └── appsscript.json  ← 差し替え。webapp.access = ANYONE_ANONYMOUS
```

## 手順

### 1. ファイル配置
上記4ファイルを配置（index.html / robots.txt / .nojekyll は**リポジトリ直下**）。

### 2. GASにID/パスを登録（ブラウザ・1回）
Apps Script → ⚙️ プロジェクトの設定 → スクリプト プロパティ → プロパティを追加：
- `APP_USER` = 好きなID
- `APP_PASS` = 長めのパスワード（これが唯一の鍵）

### 3. 反映 & 再デプロイ
```bash
clasp push -f
```
→ Apps Script：デプロイ ▼ → **デプロイを管理** → 既存デプロイの ✏️ →
　「アクセスできるユーザー」= **全員** ／「バージョン」= **新バージョン** → **デプロイ**
　（既存デプロイを編集＝URLは不変。index.html側の修正不要）

> なぜ「全員」にするか：GitHub Pagesのブラウザから fetch で呼ぶには、匿名アクセス可
> （ANYONE_ANONYMOUS）が必要。ただしデータはID/パス照合を通った時だけ返るため、
> 「全員がURLに到達できるが、鍵が無いと何も取れない」状態になる。

### 4. GitHubへ
```bash
git add .
git status      # data/ と *.csv が含まれないことを必ず確認
git commit -m "feat: GitHub Pages版(ログイン認証付き検索UI)"
git push
```

### 5. 確認
- 1〜2分後 https://tokyoflower.github.io/meishi-search/ を開く
- ログイン画面 → 手順2のID/パス → 「登録 3,799件」表示で成功
- スマホのホーム画面に追加して常用

## 完了判定
- [ ] Pagesのトップがログイン画面（READMEではない）
- [ ] 正しいID/パスでログイン → 検索できる／電話・メール・地図が動く
- [ ] 誤ったパスでは「違います」と出てデータが表示されない
- [ ] GAS の /exec を直接開いても、データではなく案内ページが出る
- [ ] GitHubに data/・*.csv が無い

## 補足（任意）
- ログイン保持はセッション単位（タブを閉じると再ログイン）。常時保持にしたい場合は
  index.html の sessionStorage を localStorage に変更（端末にパスが残る点に注意）
- さらに堅くするなら：パスワードを定期変更、IP制限が必要なら別途検討
