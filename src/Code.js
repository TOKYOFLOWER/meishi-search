/**
 * 名刺人脈検索システム  ―  Code.js  (clasp push 時に Code.gs)
 * ------------------------------------------------------------------
 * データ: 非公開スプレッドシート / UI・API: GAS HtmlService
 * 公開領域(GitHub等)に個人情報・APIキーを一切置かない設計。
 * スプレッドシートはIDで直接開くため、バインド/スタンドアロン両対応。
 * ------------------------------------------------------------------
 */

// ====== 設定 ======
var SPREADSHEET_ID = '1gy6viELdXZnGWcNbPGqKmdJjrrteBE7dI1RhS-r8OVY'; // 名刺人脈DB
var SHEET_NAME = '名刺DB';
var RESULT_LIMIT = 200;
var HEADER = ['id', '会社名', '部署名', '役職', '役職レベル', '氏名', '姓', '名', '業種',
  'メール', '郵便番号', '都道府県', '市区町村', '住所', '会社TEL', '携帯', 'Fax', 'URL',
  '名刺交換日', '取込日'];
// 任意: 許可メール(空ならデプロイの「アクセスできるユーザー」設定に従う)
var ALLOWLIST = [
  // 'tomy@example.com',
];

function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

// ====== 初期セットアップ(エディタから1回 Run でも可) ======
function setup() {
  ensureSheet_();
  Logger.log('名刺DBシートを準備しました。データを取り込んでください。');
  return 'ok';
}
function ensureSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// ====== HTML ======
function doGet(e) {
  if (!checkAccess_()) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;text-align:center">アクセス権がありません。</div>');
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('名刺検索 | 銀座東京フラワー')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// ====== アクセス制御 ======
function checkAccess_() {
  if (!ALLOWLIST || ALLOWLIST.length === 0) return true;
  var me = (Session.getActiveUser().getEmail() || '').toLowerCase();
  return ALLOWLIST.map(function (s) { return s.toLowerCase(); }).indexOf(me) >= 0;
}

// ====== 読み込み ======
function getSheet_() {
  var sh = ss_().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('シート「' + SHEET_NAME + '」がありません。setup() を実行してください');
  return sh;
}
function readAll_() {
  var values = getSheet_().getDataRange().getValues();
  var header = values.shift() || HEADER;
  return { header: header, rows: values };
}
function colIndex_(header) {
  var m = {}; header.forEach(function (h, i) { m[String(h).trim()] = i; }); return m;
}

// ====== フィルタ選択肢 ======
function getFilters() {
  if (!checkAccess_()) throw new Error('権限なし');
  var d = readAll_(), c = colIndex_(d.header);
  var prefs = {}, inds = {}, roles = {};
  d.rows.forEach(function (r) {
    var p = r[c['都道府県']]; if (p) prefs[p] = (prefs[p] || 0) + 1;
    var ind = r[c['業種']]; if (ind) inds[ind] = (inds[ind] || 0) + 1;
    var rl = r[c['役職レベル']]; if (rl) roles[rl] = (roles[rl] || 0) + 1;
  });
  var sortByCount = function (o) {
    return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; })
      .map(function (k) { return { name: k, count: o[k] }; });
  };
  return { total: d.rows.length, prefs: sortByCount(prefs),
    industries: sortByCount(inds), roles: sortByCount(roles) };
}

// ====== 検索 ======
function searchCards(q) {
  if (!checkAccess_()) throw new Error('権限なし');
  q = q || {};
  var kw = (q.keyword || '').trim().toLowerCase();
  var pref = q.pref || '', ind = q.industry || '', role = q.roleLevel || '';
  var d = readAll_(), c = colIndex_(d.header);
  var fields = ['会社名', '氏名', '住所', 'メール', '部署名', '役職'];
  var fIdx = fields.map(function (f) { return c[f]; }).filter(function (i) { return i != null; });

  var hits = [];
  for (var i = 0; i < d.rows.length; i++) {
    var r = d.rows[i];
    if (pref && r[c['都道府県']] !== pref) continue;
    if (ind && r[c['業種']] !== ind) continue;
    if (role && r[c['役職レベル']] !== role) continue;
    if (kw) {
      var blob = fIdx.map(function (j) { return String(r[j] || ''); }).join(' ').toLowerCase();
      if (blob.indexOf(kw) < 0) continue;
    }
    hits.push(r);
    if (hits.length >= RESULT_LIMIT) break;
  }
  var pick = function (r, name) {
    var v = r[c[name]];
    if (v instanceof Date) return Utilities.formatDate(v, 'JST', 'yyyy/MM/dd');
    return v == null ? '' : String(v);
  };
  var items = hits.map(function (r) {
    return {
      id: pick(r, 'id'), company: pick(r, '会社名'), dept: pick(r, '部署名'),
      title: pick(r, '役職'), roleLevel: pick(r, '役職レベル'), name: pick(r, '氏名'),
      industry: pick(r, '業種'), email: pick(r, 'メール'), pref: pick(r, '都道府県'),
      address: pick(r, '住所'), telCompany: pick(r, '会社TEL'), mobile: pick(r, '携帯'),
      url: pick(r, 'URL'), exchanged: pick(r, '名刺交換日')
    };
  });
  return { count: items.length, limited: hits.length >= RESULT_LIMIT, items: items };
}

/* ==================================================================
 *  追加取込: EightのCSV(生・SJIS可)を名寄せして追記
 *  ▼ スタンドアロンGAS: スクリプトプロパティ DRIVE_CSV_ID にDriveの
 *     CSVファイルIDを設定し、エディタで runImport を Run
 *  ▼ バインドGAS: スプレッドシートのメニュー「名刺DB」からも可
 * ================================================================== */
function runImport() {
  var id = PropertiesService.getScriptProperties().getProperty('DRIVE_CSV_ID');
  if (!id) throw new Error('スクリプトプロパティ「DRIVE_CSV_ID」にDriveのCSVファイルIDを設定してください');
  var n = importEightCsv(id);
  Logger.log(n + ' 件を新規追加しました');
  return n;
}

function onOpen() { // バインド時のみ有効
  try {
    SpreadsheetApp.getUi().createMenu('名刺DB')
      .addItem('① 初期セットアップ', 'setup')
      .addItem('② Eight CSVを取り込む（名寄せ追記）', 'promptImport')
      .addToUi();
  } catch (e) {}
}
function promptImport() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Eight CSV取込', 'DriveのCSVファイルIDを貼り付け', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  try {
    var n = importEightCsv(res.getResponseText().trim());
    ui.alert('取込完了', n + ' 件を新規追加（重複は自動スキップ）。', ui.ButtonSet.OK);
  } catch (err) { ui.alert('エラー', String(err), ui.ButtonSet.OK); }
}

function importEightCsv(fileId) {
  var sh = ensureSheet_();
  var d = readAll_(), c = colIndex_(d.header);
  var existing = {}, lastNum = 0;
  d.rows.forEach(function (r) {
    existing[[r[c['会社名']], r[c['姓']], r[c['名']]].join('|')] = true;
    var m = String(r[c['id']]).match(/^M(\d+)$/);
    if (m) lastNum = Math.max(lastNum, parseInt(m[1], 10));
  });

  var blob = DriveApp.getFileById(fileId).getBlob();
  var text;
  try { text = blob.getDataAsString('Shift_JIS'); }
  catch (e) { text = blob.getDataAsString('UTF-8'); }
  var rows = Utilities.parseCsv(text);
  if (rows.length < 2) return 0;
  var eh = colIndex_(rows[0]);
  var col = function (r, name) { return eh[name] != null ? (r[eh[name]] || '') : ''; };

  var today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
  var append = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var company = col(r, '会社名'), sei = col(r, '姓'), mei = col(r, '名');
    var key = [company, sei, mei].join('|');
    if (existing[key]) continue;
    existing[key] = true; lastNum++;
    var addr = col(r, '住所'), pc = splitAddr_(addr);
    append.push([
      'M' + ('00000' + lastNum).slice(-5),
      company, col(r, '部署名'), col(r, '役職'), roleLevel_(col(r, '役職')),
      (sei + ' ' + mei).trim(), sei, mei,
      industry_(company + ' ' + col(r, '部署名') + ' ' + col(r, '役職') + ' ' + col(r, 'URL')),
      col(r, 'e-mail'), col(r, '郵便番号'), pc[0], pc[1], addr,
      col(r, 'TEL会社'), col(r, '携帯電話'), col(r, 'Fax'), col(r, 'URL'),
      col(r, '名刺交換日'), today
    ]);
  }
  if (append.length) {
    sh.getRange(sh.getLastRow() + 1, 1, append.length, append[0].length).setValues(append);
  }
  return append.length;
}

// ====== 派生ロジック ======
function splitAddr_(a) {
  a = String(a || '').trim();
  var m = a.match(/^(東京都|北海道|(?:京都|大阪)府|(?:神奈川|和歌山|鹿児島|..)県)/);
  if (!m) return ['', ''];
  var pref = m[1], rest = a.slice(pref.length);
  var m2 = rest.match(/^(.+?[市区町村郡])/);
  return [pref, m2 ? m2[1] : ''];
}
function industry_(text) {
  text = String(text || '');
  var rules = [
    ['花卉・園芸', /花|フラワー|florist|園芸|植木|造園|グリーン|ガーデン|苗|種苗/i],
    ['不動産・建設', /不動産|土地|住宅|ハウス|ホーム|建設|工務|建築|リフォーム|ゼネコン|設計/i],
    ['医療・ヘルスケア', /クリニック|医院|病院|歯科|薬局|整骨|接骨|治療|介護|福祉|デンタル/i],
    ['士業', /税理士|会計|弁護士|社労士|行政書士|司法書士|法律|特許|労務/i],
    ['飲食', /飲食|レストラン|居酒屋|カフェ|食堂|フード|キッチン|料理|ダイニング|酒場/i],
    ['美容', /美容|サロン|エステ|ヘア|ネイル|理容|ビューティ/i],
    ['IT・デジタル', /システム|ソフト|テクノロ|デジタル|DX|ＩＴ|web|ウェブ|アプリ|データ|クラウド|AI/i],
    ['EC・通販', /通販|楽天|ネットショップ|Eコマース|ＥＣ|モール|ショッピング/i],
    ['広告・マーケ', /広告|マーケ|ＰＲ|制作|デザイン|メディア|プロモ|クリエイ/i],
    ['金融', /保険|証券|銀行|信用金庫|ファイナンス|投資|リース/i],
    ['物流', /物流|運送|配送|ロジ|運輸|倉庫/i],
    ['製造', /製造|工業|メーカー|製作所|産業|加工/i],
    ['卸・商社', /卸|商事|商会|貿易|問屋|商店|物産/i],
    ['教育', /教育|学校|学院|スクール|塾|大学|研修/i]
  ];
  for (var i = 0; i < rules.length; i++) if (rules[i][1].test(text)) return rules[i][0];
  return 'その他';
}
function roleLevel_(t) {
  t = String(t || '');
  if (/代表|社長|会長|ＣＥＯ|CEO|オーナー|頭取|理事長|院長|園長/.test(t)) return '経営者';
  if (/取締役|役員|執行|常務|専務|CFO|CTO|COO/.test(t)) return '役員';
  if (/本部長|事業部長|部長|局長|支店長|工場長/.test(t)) return '部長';
  if (/課長|係長|マネ|主任|リーダー|店長|室長|チーフ/.test(t)) return '管理職';
  if (t.trim() === '') return '不明';
  return '担当';
}
