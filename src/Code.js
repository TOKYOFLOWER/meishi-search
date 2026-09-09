/**
 * 名刺人脈検索システム  ―  Code.js  (clasp push 時に Code.gs)
 * ------------------------------------------------------------------
 * データ: 非公開スプレッドシート
 * 画面 : GitHub Pages(公開・ガワのみ) から ID/パス付きで本APIを呼ぶ
 * 認証 : スクリプトプロパティ APP_USER / APP_PASS でサーバー側照合
 * → 正しいID/パスが無い限り、データは1件も返さない
 * 公開領域(GitHub)には個人情報・パスワードを一切置かない設計。
 * ------------------------------------------------------------------
 */

// ====== 設定 ======
var SPREADSHEET_ID = '1gy6viELdXZnGWcNbPGqKmdJjrrteBE7dI1RhS-r8OVY'; // 名刺人脈DB
var SHEET_NAME = '名刺DB';
var RESULT_LIMIT = 200;
var PAGES_URL = 'https://tokyoflower.github.io/meishi-search/'; // 検索画面(GitHub Pages)
var HEADER = ['id', '会社名', '部署名', '役職', '役職レベル', '氏名', '姓', '名', '業種',
  'メール', '郵便番号', '都道府県', '市区町村', '住所', '会社TEL', '携帯', 'Fax', 'URL',
  '名刺交換日', '取込日'];

// ====== CRM第1段階＋追加要件: シート・列定義 ======
var PERSON_SHEET = '人物管理';
var HISTORY_SHEET = '接触履歴';
var BATCH_COL = 'importBatchId';
var PERSON_HEADER = ['contactId', 'organized', 'importance', 'relationship', 'tags', 'needs',
  'canIntroduce', 'wantIntroduce', 'nextAction', 'nextActionDate', 'memo',
  'facebookUrl', 'instagramUrl', 'linkedinUrl', 'xUrl', 'youtubeUrl', 'otherSnsUrl',
  'snsCheckedAt', 'createdAt', 'updatedAt'];
var HISTORY_HEADER = ['contactId', 'contactDate', 'eventName', 'contactType', 'memo',
  'followUp', 'followDate', 'createdAt'];
// 整理モードのクイックタグ（初期12件）。tags action はこれ＋人物管理 tags の DISTINCT を返す
var QUICK_TAGS = ['守成クラブ', '経営者', '要フォロー', '花需要', '法人ギフト', 'EC', 'IT', 'AI',
  '業務効率化', '販売代理店候補', '協業候補', '紹介者'];
var CRM_FIELDS = ['importance', 'relationship', 'tags', 'needs', 'canIntroduce',
  'wantIntroduce', 'nextAction', 'nextActionDate', 'memo'];
var SNS_PLATFORM_COL = {
  facebook: 'facebookUrl', instagram: 'instagramUrl', linkedin: 'linkedinUrl',
  x: 'xUrl', youtube: 'youtubeUrl', other: 'otherSnsUrl'
};
var SNS_DOMAIN_RULES = {
  facebook: /(^|\.)facebook\.com$|(^|\.)fb\.com$/i,
  instagram: /(^|\.)instagram\.com$/i,
  linkedin: /(^|\.)linkedin\.com$/i,
  x: /(^|\.)x\.com$|(^|\.)twitter\.com$/i,
  youtube: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i
};

var SS_CACHE_ = null;
function ss_() { // 1回の実行内では openById を1度だけ（各 action が複数シートを読むため）
  if (!SS_CACHE_) SS_CACHE_ = SpreadsheetApp.openById(SPREADSHEET_ID);
  return SS_CACHE_;
}

/* ==================================================================
 *  Web エントリポイント
 * ================================================================== */

// GETで /exec を開いても、データは出さない。検索画面へ案内するだけ。
function doGet(e) {
  var html = '<!DOCTYPE html><meta charset="utf-8">' +
    '<meta name="robots" content="noindex,nofollow">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font-family:sans-serif;max-width:520px;margin:60px auto;padding:0 20px;text-align:center;color:#20241f">' +
    '<h2 style="color:#14342a">名刺検索</h2>' +
    '<p>検索はこちらの画面から行います。</p>' +
    '<p><a href="' + PAGES_URL + '" style="display:inline-block;background:#b5552f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px">検索画面をひらく</a></p>' +
    '</div>';
  return HtmlService.createHtmlOutput(html).setTitle('名刺検索')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// GitHub Pages からの API 本体（ID/パス照合 → データ）
function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!authOk_(body.user, body.pass)) {
      Utilities.sleep(800); // 総当たり対策の軽い遅延
      out = { ok: false, error: 'auth' };
    } else if (body.action === 'ping') {
      out = { ok: true };
    } else if (body.action === 'filters') {
      out = { ok: true, data: getFilters() };
    } else if (body.action === 'search') {
      out = { ok: true, data: searchCards(body.q || {}) };
    } else if (body.action === 'addCard') {
      out = addCardToSheet(body.card || {});
    } else if (body.action === 'bootstrap') {
      out = bootstrap_(body);
    } else if (body.action === 'stats') {
      out = { ok: true, data: computeStats_() };
    } else if (body.action === 'newCards') {
      out = { ok: true, data: getNewCards_(body) };
    } else if (body.action === 'person') {
      out = getPerson_(body);
    } else if (body.action === 'savePerson') {
      out = savePersonToSheet_(body);
    } else if (body.action === 'markOrganized') {
      out = markOrganizedInSheet_(body);
    } else if (body.action === 'addContact') {
      out = addContactToSheet_(body);
    } else if (body.action === 'eventNames') {
      out = { ok: true, data: getEventNames_() };
    } else if (body.action === 'tags') {
      out = { ok: true, data: getTags_() };
    } else if (body.action === 'snsMarkChecked') {
      out = snsMarkCheckedInSheet_(body);
    } else if (body.action === 'bulkContactPreview') {
      out = bulkContactPreview_(body);
    } else if (body.action === 'bulkContactApply') {
      out = bulkContactApply_(body);
    } else if (body.action === 'snsDetectFromSite') {
      out = snsDetectFromSite_(body);
    } else if (body.action === 'snsSearchLinks') {
      out = snsSearchLinks_(body);
    } else if (body.action === 'snsSave') {
      out = snsSaveToSheet_(body);
    } else if (body.action === 'snsRemove') {
      out = snsRemoveFromSheet_(body);
    } else {
      out = { ok: false, error: 'unknown_action' };
    }
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// ====== 認証 ======
function authOk_(user, pass) {
  var p = PropertiesService.getScriptProperties();
  var U = p.getProperty('APP_USER'), P = p.getProperty('APP_PASS');
  if (!P) return false; // 未設定なら全拒否(安全側)
  return String(user || '') === String(U || '') && String(pass || '') === String(P);
}

/* ==================================================================
 *  データ層
 * ================================================================== */
function ensureSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function getSheet_() {
  var sh = ss_().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('シート「' + SHEET_NAME + '」がありません');
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
// 名刺DB のうち names の列だけを読む（ヘッダ1行 + 連続する列ブロックごとに getValues）。
// 戻り値の rows は全ヘッダ幅の疎な配列（読んでいない列は ''）なので c[name] で従来どおり参照できる。
var CARD_LIST_COLS = ['id', '会社名', '部署名', '役職', '役職レベル', '氏名', '業種', '都道府県', '名刺交換日', '取込日', 'importBatchId'];
function readCards_(names) {
  var sh = getSheet_();
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { header: HEADER, rows: [] };
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var c = colIndex_(header);
  var idx = [];
  names.forEach(function (n) { if (c[n] !== undefined) idx.push(c[n]); });
  idx.sort(function (a, b) { return a - b; });
  var n = lastRow - 1;
  var rows = [];
  for (var i = 0; i < n; i++) { var empty = []; for (var j = 0; j < header.length; j++) empty.push(''); rows.push(empty); }
  if (n <= 0 || !idx.length) return { header: header, rows: rows };
  // 近い列（間隔3以内）は1ブロックにまとめて読む
  var blocks = [];
  idx.forEach(function (i2) {
    var b = blocks[blocks.length - 1];
    if (b && i2 - b[1] <= 3) b[1] = i2; else blocks.push([i2, i2]);
  });
  blocks.forEach(function (b) {
    var w = b[1] - b[0] + 1;
    var vals = sh.getRange(2, b[0] + 1, n, w).getValues();
    for (var r = 0; r < n; r++) for (var k = 0; k < w; k++) rows[r][b[0] + k] = vals[r][k];
  });
  return { header: header, rows: rows };
}

// 人物管理／接触履歴シートの読み取り（{sheet, header, rows, c}）。シートが無ければ例外。
function readSheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」がありません');
  var values = sh.getDataRange().getValues();
  var header = values.shift() || [];
  return { sheet: sh, header: header, rows: values, c: colIndex_(header) };
}

/* ==================================================================
 *  日付ユーティリティ
 * ================================================================== */
// Date/文字列('2026/09/08' '2026.9.8' '2026-9-8' 等)を 'yyyy-MM-dd'(JST) に正規化。
// YYMMDD6桁など区切りの無い形式・不正日付は '' を返す。
function isoDate_(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, 'JST', 'yyyy-MM-dd');
  }
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var m = s.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (!m) return '';
  var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), da = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
  var dt = new Date(y, mo - 1, da);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== da) return '';
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + da).slice(-2);
}
function nowStamp_() {
  return Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd HH:mm:ss');
}
// 表示ラベル: 'イベント名 YYMMDD'（イベント名が空ならYYMMDDのみ）。内部保存には使わない。
function formatContactLabel_(eventName, iso) {
  var ymd = '';
  var s = String(iso || '');
  var parts = s.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    ymd = parts[0].slice(2) + parts[1] + parts[2];
  }
  var name = String(eventName == null ? '' : eventName).trim();
  return name ? (name + ' ' + ymd) : ymd;
}
// 名刺交換日等、Dateまたは文字列を 'yyyy-MM-dd'(Dateの場合) / そのまま(文字列の場合) で返す表示用整形
function pickExchanged_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'JST', 'yyyy-MM-dd');
  return v == null ? '' : String(v);
}
function isTrue_(v) {
  if (v === true) return true;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true';
}
// tags(配列 or カンマ区切り文字列)を trim・空除去した配列にする
function parseTags_(v) {
  if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(function (x) { return x; });
  return String(v == null ? '' : v).split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
}
// trim・空除去・重複除去してカンマ区切り文字列にする(保存用)
function normalizeTags_(v) {
  var arr = parseTags_(v);
  var seen = {}, out = [];
  arr.forEach(function (t) { if (t && !seen[t]) { seen[t] = true; out.push(t); } });
  return out.join(',');
}
// 'yyyy-MM-dd' 文字列に days 日を加算した 'yyyy-MM-dd' を返す(カレンダー計算。タイムゾーンに依存しない)
function addDaysIso_(iso, days) {
  var parts = iso.split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, 'JST', 'yyyy-MM-dd');
}
function defaultCrm_() {
  return {
    organized: false, importance: '', relationship: '', tags: [], needs: '',
    canIntroduce: '', wantIntroduce: '', nextAction: '', nextActionDate: '', memo: ''
  };
}
function crmFromRow_(row, c) {
  return {
    organized: isTrue_(row[c['organized']]),
    importance: row[c['importance']] || '',
    relationship: row[c['relationship']] || '',
    tags: parseTags_(row[c['tags']]),
    needs: row[c['needs']] || '',
    canIntroduce: row[c['canIntroduce']] || '',
    wantIntroduce: row[c['wantIntroduce']] || '',
    nextAction: row[c['nextAction']] || '',
    nextActionDate: pickExchanged_(row[c['nextActionDate']]),
    memo: row[c['memo']] || ''
  };
}
function personDateFields_() { return ['nextActionDate', 'snsCheckedAt', 'createdAt', 'updatedAt']; }
function historyDateFields_() { return ['contactDate', 'followDate', 'createdAt']; }

// header順の1行を書き込む。日付列は書式を'@'(プレーンテキスト)にしてから setValues することで
// '2026-09-08' 等の文字列がDateへ自動変換されるのを防ぐ。
function writeSheetRow_(sheet, header, rowNum, record, dateFields) {
  var values = header.map(function (h) { return record.hasOwnProperty(h) ? record[h] : ''; });
  dateFields.forEach(function (f) {
    var idx = header.indexOf(f);
    if (idx >= 0) sheet.getRange(rowNum, idx + 1).setNumberFormat('@');
  });
  sheet.getRange(rowNum, 1, 1, header.length).setValues([values]);
}

// 人物管理／接触履歴の該当contactId行を探して{header,c,rowIdx,rows}を返す簡易ヘルパー
function findRowByContactId_(d, id) {
  for (var i = 0; i < d.rows.length; i++) {
    if (String(d.rows[i][d.c['contactId']]) === id) return i;
  }
  return -1;
}

function getFilters(pre) {
  var d = (pre && pre.cards) || readCards_(CARD_LIST_COLS), c = colIndex_(d.header);
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

function searchCards(q) {
  q = q || {};
  var kw = (q.keyword || '').trim().toLowerCase();
  var pref = q.pref || '', ind = q.industry || '', role = q.roleLevel || '';
  var eventName = String(q.eventName || '').trim();
  var contactFrom = String(q.contactFrom || '').trim();
  var contactTo = String(q.contactTo || '').trim();
  var tag = String(q.tag || '').trim();
  var followDue = !!q.followDue; // 要フォロー期限到来（nextActionDate<=今日 or followUp かつ followDate<=今日）
  var hasContactFilter = !!(eventName || contactFrom || contactTo || tag || followDue);

  var d = readAll_(), c = colIndex_(d.header);
  var fields = ['会社名', '氏名', '住所', 'メール', '部署名', '役職'];
  var fIdx = fields.map(function (f) { return c[f]; }).filter(function (i) { return i != null; });

  // 追加条件(イベント名/接触期間/タグ)が指定された時だけ接触履歴・人物管理を結合して対象idを絞る
  var allowedIds = null, pm = null, hm = null;
  if (hasContactFilter) {
    pm = loadPersonMap_();
    hm = loadHistoryMap_();
    if (eventName || contactFrom || contactTo) {
      var kwEv = eventName.toLowerCase();
      allowedIds = {};
      Object.keys(hm.byId).forEach(function (id) {
        var matchAny = hm.byId[id].some(function (r) {
          var name = String(r[hm.c['eventName']] || '').toLowerCase();
          var cd = String(r[hm.c['contactDate']] || '');
          if (eventName && name.indexOf(kwEv) < 0) return false;
          if (contactFrom && cd < contactFrom) return false;
          if (contactTo && cd > contactTo) return false;
          return true;
        });
        if (matchAny) allowedIds[id] = true;
      });
    }
    if (tag) {
      var tagAllowed = {};
      pm.rows.forEach(function (r) {
        if (parseTags_(r[pm.c['tags']]).indexOf(tag) >= 0) tagAllowed[String(r[pm.c['contactId']])] = true;
      });
      if (allowedIds) {
        Object.keys(allowedIds).forEach(function (id) { if (!tagAllowed[id]) delete allowedIds[id]; });
      } else {
        allowedIds = tagAllowed;
      }
    }
    if (followDue) {
      var dueSet = followDueSet_(pm, hm);
      if (allowedIds) {
        Object.keys(allowedIds).forEach(function (id) { if (!dueSet[id]) delete allowedIds[id]; });
      } else {
        allowedIds = dueSet;
      }
    }
  }

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
    if (allowedIds && !allowedIds[String(r[c['id']])]) continue;
    hits.push(r);
    if (hits.length >= RESULT_LIMIT) break;
  }
  var pick = function (r, name) {
    var v = r[c[name]];
    if (v instanceof Date) return Utilities.formatDate(v, 'JST', 'yyyy/MM/dd');
    return v == null ? '' : String(v);
  };
  var items = hits.map(function (r) {
    var id = pick(r, 'id');
    var tags = [], lastEvent = '';
    if (hasContactFilter) {
      var pr = pm.byId[id];
      tags = pr ? parseTags_(pr[pm.c['tags']]) : [];
      var hist = histSorted_(hm, id);
      if (hist.length) lastEvent = formatContactLabel_(hist[0][hm.c['eventName']], pickExchanged_(hist[0][hm.c['contactDate']]));
    }
    return {
      id: id, company: pick(r, '会社名'), dept: pick(r, '部署名'),
      title: pick(r, '役職'), roleLevel: pick(r, '役職レベル'), name: pick(r, '氏名'),
      industry: pick(r, '業種'), email: pick(r, 'メール'), pref: pick(r, '都道府県'),
      address: pick(r, '住所'), telCompany: pick(r, '会社TEL'), mobile: pick(r, '携帯'),
      url: pick(r, 'URL'), exchanged: pick(r, '名刺交換日'),
      tags: tags, lastEvent: lastEvent
    };
  });
  return { count: items.length, limited: hits.length >= RESULT_LIMIT, items: items };
}

// 人物管理/接触履歴の読み取り(無ければ空扱い)。検索・集計等の読み取り専用処理から利用する。
function loadPersonMap_() {
  var byId = {};
  var c = colIndex_(PERSON_HEADER);
  var rows = [];
  try {
    var d = readSheet_(PERSON_SHEET);
    c = d.c; rows = d.rows;
    rows.forEach(function (r) { byId[String(r[c['contactId']])] = r; });
  } catch (e) { /* シート未作成: 空のまま */ }
  return { c: c, byId: byId, rows: rows };
}
function loadHistoryMap_() {
  var byId = {};
  var c = colIndex_(HISTORY_HEADER);
  try {
    var d = readSheet_(HISTORY_SHEET);
    c = d.c;
    d.rows.forEach(function (r) {
      var id = String(r[c['contactId']]);
      if (!byId[id]) byId[id] = [];
      byId[id].push(r);
    });
  } catch (e) { /* シート未作成: 空のまま */ }
  return { c: c, byId: byId, sorted: {} };
}
// 指定 contactId の履歴を新しい順（contactDate 降順→createdAt 降順）で返す。必要な id だけ並び替える（遅延・メモ化）
function histSorted_(hm, id) {
  if (hm.sorted[id]) return hm.sorted[id];
  var c = hm.c;
  var arr = (hm.byId[id] || []).slice().sort(function (a, b) {
    var ad = pickExchanged_(a[c['contactDate']]), bd = pickExchanged_(b[c['contactDate']]);
    if (ad !== bd) return ad < bd ? 1 : -1;
    var ac = String(a[c['createdAt']] || ''), bc = String(b[c['createdAt']] || '');
    return ac < bc ? 1 : (ac > bc ? -1 : 0);
  });
  hm.sorted[id] = arr;
  return arr;
}

/* ==================================================================
 *  追加取込(EightのCSVを名寄せ追記) ― バインド時はメニュー / 任意は runImport
 * ================================================================== */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('名刺DB')
      .addItem('① 初期セットアップ', 'setup')
      .addItem('② Eight CSVを取り込む（名寄せ追記）', 'promptImport')
      .addToUi();
  } catch (e) {}
}
function setup() { ensureSheet_(); Logger.log('名刺DBシートを準備しました'); return 'ok'; }
function promptImport() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Eight CSV取込', 'DriveのCSVファイルIDを貼り付け', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  try { var n = importEightCsv(res.getResponseText().trim());
    ui.alert('取込完了', n + ' 件を追加（重複は自動スキップ）。', ui.ButtonSet.OK);
  } catch (err) { ui.alert('エラー', String(err), ui.ButtonSet.OK); }
}
function runImport() {
  var id = PropertiesService.getScriptProperties().getProperty('DRIVE_CSV_ID');
  if (!id) throw new Error('スクリプトプロパティ DRIVE_CSV_ID にDriveのCSVファイルIDを設定してください');
  var n = importEightCsv(id); Logger.log(n + ' 件追加'); return n;
}
function importEightCsv(fileId) {
  var sh = ensureSheet_();
  var d = readAll_(), c = colIndex_(d.header);
  var header = d.header;
  var existing = {}, lastNum = 0;
  d.rows.forEach(function (r) {
    existing[[r[c['会社名']], r[c['姓']], r[c['名']]].join('|')] = true;
    var m = String(r[c['id']]).match(/^M(\d+)$/);
    if (m) lastNum = Math.max(lastNum, parseInt(m[1], 10));
  });
  var blob = DriveApp.getFileById(fileId).getBlob();
  var text;
  try { text = blob.getDataAsString('Shift_JIS'); } catch (e) { text = blob.getDataAsString('UTF-8'); }
  var rows = Utilities.parseCsv(text);
  if (rows.length < 2) return 0;
  var eh = colIndex_(rows[0]);
  var col = function (r, name) { return eh[name] != null ? (r[eh[name]] || '') : ''; };
  var today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
  var batchId = 'eight-' + Utilities.formatDate(new Date(), 'JST', 'yyyyMMdd-HHmm');
  var append = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var company = col(r, '会社名'), sei = col(r, '姓'), mei = col(r, '名');
    var key = [company, sei, mei].join('|');
    if (existing[key]) continue;
    existing[key] = true; lastNum++;
    var addr = col(r, '住所'), pc = splitAddr_(addr);
    var record = {
      'id': 'M' + ('00000' + lastNum).slice(-5),
      '会社名': company, '部署名': col(r, '部署名'), '役職': col(r, '役職'),
      '役職レベル': roleLevel_(col(r, '役職')),
      '氏名': (sei + ' ' + mei).trim(), '姓': sei, '名': mei,
      '業種': industry_(company + ' ' + col(r, '部署名') + ' ' + col(r, '役職') + ' ' + col(r, 'URL')),
      'メール': col(r, 'e-mail'), '郵便番号': col(r, '郵便番号'), '都道府県': pc[0], '市区町村': pc[1],
      '住所': addr, '会社TEL': col(r, 'TEL会社'), '携帯': col(r, '携帯電話'), 'Fax': col(r, 'Fax'),
      'URL': col(r, 'URL'), '名刺交換日': col(r, '名刺交換日'), '取込日': today,
      'importBatchId': batchId
    };
    append.push(header.map(function (h) {
      var key2 = String(h).trim();
      return record.hasOwnProperty(key2) ? record[key2] : '';
    }));
  }
  if (append.length) sh.getRange(sh.getLastRow() + 1, 1, append.length, header.length).setValues(append);
  return append.length;
}

/* === 名刺スキャン取込 (addCard) === */
// 正規化キー: 空白(半角/全角)除去 → 全角記号/英数を半角化 → 小文字化
function normKey_() {
  var s = '';
  for (var i = 0; i < arguments.length; i++) s += String(arguments[i] || '');
  s = s.replace(/[\s　]+/g, '');
  s = s.replace(/[！-～]/g, function (ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  });
  return s.toLowerCase();
}

function addCardToSheet(card) {
  card = card || {};
  var company = String(card.company || '').trim();
  var name = String(card.name || '').trim();
  var kana = String(card.kana || '').trim();
  var department = String(card.department || '').trim();
  var title = String(card.title || '').trim();
  var email = String(card.email || '').trim();
  var tel = String(card.tel || '').trim();
  var mobile = String(card.mobile || '').trim();
  var fax = String(card.fax || '').trim();
  var postal = String(card.postal || '').trim();
  var address = String(card.address || '').trim();
  var url = String(card.url || '').trim();
  var memo = String(card.memo || '').trim();
  var sourceFile = String(card.source_file || '').trim();
  var scannedAt = String(card.scanned_at || '').trim();

  if (!company || !name) return { ok: false, error: 'missing_required' }; // どちらかが空なら拒否

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = ensureSheet_();
    var d = readAll_();
    var header = d.header;
    var c = colIndex_(header);

    // 姓/名の分割（全角/半角スペース区切り。無ければ姓=name,名=''）
    var nameParts = name.split(/[\s　]+/).filter(function (x) { return x !== ''; });
    var sei = nameParts.length ? nameParts[0] : '';
    var mei = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    // 重複判定: 既存行の(会社名+姓+名) と (会社名+氏名) の両方のキーを集め、
    // 新規カードの(会社名+姓+名) / (会社名+name) のいずれかと一致すれば重複
    var existingKeys = {};
    d.rows.forEach(function (r, idx) {
      var exCompany = r[c['会社名']];
      var exSei = r[c['姓']];
      var exMei = r[c['名']];
      var exName = r[c['氏名']];
      var kA = normKey_(exCompany, exSei, exMei);
      var kB = normKey_(exCompany, exName);
      if (kA && existingKeys[kA] === undefined) existingKeys[kA] = idx;
      if (kB && existingKeys[kB] === undefined) existingKeys[kB] = idx;
    });
    var newKeyA = normKey_(company, sei, mei);
    var newKeyB = normKey_(company, name);
    var dupIdx = existingKeys[newKeyA];
    if (dupIdx === undefined) dupIdx = existingKeys[newKeyB];
    if (dupIdx !== undefined) {
      return { ok: true, duplicate: true, row: dupIdx + 2 };
    }

    // id発番: importEightCsv と同じ方式（既存最大 M番号+1）
    var lastNum = 0;
    d.rows.forEach(function (r) {
      var m = String(r[c['id']]).match(/^M(\d+)$/);
      if (m) lastNum = Math.max(lastNum, parseInt(m[1], 10));
    });
    var newId = 'M' + ('00000' + (lastNum + 1)).slice(-5);

    var pc = splitAddr_(address);
    var rl = roleLevel_(title);
    var ind = industry_(company + ' ' + department + ' ' + title + ' ' + url);
    var today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
    // 名刺交換日はスキャン日ではないので取込時は空欄にし、新着画面の「交換情報を一括設定」で入れる
    // （scanned_at は互換のため受け取るが交換日には使わない）
    var exchanged = '';

    var record = {
      'id': newId,
      '会社名': company,
      '部署名': department,
      '役職': title,
      '役職レベル': rl,
      '氏名': name,
      '姓': sei,
      '名': mei,
      '業種': ind,
      'メール': email,
      '郵便番号': postal,
      '都道府県': pc[0],
      '市区町村': pc[1],
      '住所': address,
      '会社TEL': tel,
      '携帯': mobile,
      'Fax': fax,
      'URL': url,
      '名刺交換日': exchanged,
      '取込日': today
    };

    // 備考列: 実シートのヘッダに無ければ末尾に列を追加
    var BIKO = '備考';
    if (c[BIKO] === undefined) {
      sh.getRange(1, header.length + 1).setValue(BIKO);
      header = header.slice();
      header.push(BIKO);
    }
    var bikoVal = 'scan:' + sourceFile;
    if (memo) bikoVal += ' / ' + memo;
    if (kana) bikoVal += ' / かな:' + kana;
    record[BIKO] = bikoVal;

    // importBatchId列があれば値を入れる(card.batch_idがあればそれ、無ければscan-YYYYMMDD)
    var batchId = String(card.batch_id || '').trim() || ('scan-' + Utilities.formatDate(new Date(), 'JST', 'yyyyMMdd'));
    record[BATCH_COL] = batchId;

    var row = header.map(function (h) {
      var key = String(h).trim();
      return record.hasOwnProperty(key) ? record[key] : '';
    });

    var newRowNum = sh.getLastRow() + 1;
    sh.getRange(newRowNum, 1, 1, row.length).setValues([row]);
    invalidateBootstrapCache_();
    return { ok: true, duplicate: false, row: newRowNum, id: newId };
  } finally {
    lock.releaseLock();
  }
}

// 手動テスト用（GASエディタから実行）: ダミーカードを1件追加し、追加できたら削除する
function test_addCard_() {
  var card = {
    company: 'テスト株式会社',
    name: '取込 太郎',
    kana: 'トリコミ タロウ',
    department: '営業部',
    title: '営業部長',
    email: 'test@example.com',
    tel: '03-0000-0000',
    mobile: '090-0000-0000',
    fax: '',
    postal: '104-0061',
    address: '東京都中央区銀座1-1-1',
    url: 'https://example.com',
    memo: 'テスト用メモ',
    source_file: '_test.png',
    scanned_at: Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd')
  };
  var checks = [];
  var res = addCardToSheet(card);
  Logger.log(JSON.stringify(res));
  checks.push({ name: 'addCard_ok', ok: !!(res.ok && !res.duplicate), detail: JSON.stringify(res) });
  if (res.ok && !res.duplicate) {
    var sh = getSheet_();
    var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var c = colIndex_(header);
    var row = sh.getRange(res.row, 1, 1, header.length).getValues()[0];
    var ex = String(row[c['名刺交換日']] == null ? '' : row[c['名刺交換日']]).trim();
    var imp = isoDate_(row[c['取込日']]);
    checks.push({ name: 'exchanged_is_empty', ok: ex === '', detail: JSON.stringify(ex) });
    checks.push({ name: 'importedAt_is_today', ok: imp === Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd'), detail: imp });
    checks.push({ name: 'batchId_set', ok: c['importBatchId'] === undefined || /^scan-\d{8}$/.test(String(row[c['importBatchId']])), detail: String(row[c['importBatchId']]) });
    deleteTestRows_([res.id]);
    Logger.log('削除: id ' + res.id);
  } else if (res.ok && res.duplicate) {
    Logger.log('重複として検出されました（row ' + res.row + '）。削除は行いません。');
  }
  var result = { pass: checks.every(function (x) { return x.ok; }), checks: checks };
  Logger.log(JSON.stringify(result));
  return result;
}

/* ==================================================================
 *  CRM第1段階＋追加要件: シート・列セットアップ
 * ================================================================== */
// 冪等。名刺DBにimportBatchIdが無ければ末尾追加。人物管理/接触履歴が無ければ作成、
// あれば不足列だけ末尾追加。日付系列(名刺交換日を除く)は列全体を表示形式'@'にする。
function setupSnsBulkColumns_() {
  var added = [];

  // 名刺DB: importBatchId列
  var cardsSh = ensureSheet_();
  var lastCol = Math.max(cardsSh.getLastColumn(), 1);
  var cardsHeaderVals = cardsSh.getRange(1, 1, 1, lastCol).getValues()[0];
  var cardsC = colIndex_(cardsHeaderVals);
  if (cardsC[BATCH_COL] === undefined) {
    cardsSh.getRange(1, cardsHeaderVals.length + 1).setValue(BATCH_COL);
    cardsHeaderVals = cardsHeaderVals.concat([BATCH_COL]);
    added.push(BATCH_COL);
  }

  var personRes = ensureSheetWithHeader_(PERSON_SHEET, PERSON_HEADER);
  var histRes = ensureSheetWithHeader_(HISTORY_SHEET, HISTORY_HEADER);
  added = added.concat(personRes.added).concat(histRes.added);

  // 列全体の書式設定は重いので、シート新規作成時・列追加時だけ行う（各書き込み時はセル単位で '@' を設定）
  if (personRes.created || personRes.added.length) setColumnPlainText_(personRes.sheet, personRes.header, personDateFields_());
  if (histRes.created || histRes.added.length) setColumnPlainText_(histRes.sheet, histRes.header, historyDateFields_());

  return { cards: cardsHeaderVals, persons: personRes.header, histories: histRes.header, added: added };
}

// シートが無ければ作成しヘッダ+固定行(frozen row)。あれば不足列だけ末尾追加。
function ensureSheetWithHeader_(name, header) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  var added = [];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.setFrozenRows(1);
    return { sheet: sh, header: header.slice(), added: added, created: true };
  }
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var curHeader = sh.getLastRow() > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var existing = {};
  curHeader.forEach(function (h) { existing[String(h).trim()] = true; });
  header.forEach(function (h) { if (!existing[h]) added.push(h); });
  if (added.length) {
    sh.getRange(1, curHeader.length + 1, 1, added.length).setValues([added]);
  }
  if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  return { sheet: sh, header: curHeader.concat(added), added: added, created: false };
}

function setColumnPlainText_(sh, header, names) {
  var c = colIndex_(header);
  var maxRows = Math.max(sh.getMaxRows(), 2);
  names.forEach(function (name) {
    var idx = c[name];
    if (idx === undefined) return;
    sh.getRange(1, idx + 1, maxRows, 1).setNumberFormat('@');
  });
}

/* ==================================================================
 *  stats / newCards / person / savePerson / markOrganized / addContact / eventNames
 * ================================================================== */
// pre = {cards, pm, hm}（bootstrap から渡す事前読込。無ければ各自読む）
function computeStats_(pre) {
  var t0 = Date.now();
  var days = 7;
  var cardsD = (pre && pre.cards) || readCards_(CARD_LIST_COLS), cc = colIndex_(cardsD.header);
  var today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
  var windowStart = addDaysIso_(today, -(days - 1));
  var total = cardsD.rows.length;

  var newIds = {};
  cardsD.rows.forEach(function (r) {
    var iso = isoDate_(r[cc['取込日']]);
    if (iso && iso >= windowStart && iso <= today) newIds[String(r[cc['id']])] = true;
  });
  var newCount = Object.keys(newIds).length;

  var pm = (pre && pre.pm) || loadPersonMap_();
  var unorganizedCount = 0;
  Object.keys(newIds).forEach(function (id) {
    var pr = pm.byId[id];
    var organized = pr ? isTrue_(pr[pm.c['organized']]) : false;
    if (!organized) unorganizedCount++;
  });

  var hm = (pre && pre.hm) || loadHistoryMap_();
  var followCount = Object.keys(followDueSet_(pm, hm)).length;
  Logger.log('stats: ' + (Date.now() - t0) + 'ms');

  return { total: total, newCount: newCount, unorganizedCount: unorganizedCount, followCount: followCount, days: days };
}

function getNewCards_(input, pre) {
  var t0 = Date.now();
  input = input || {};
  var days = parseInt(input.days, 10);
  if ([1, 3, 7, 30].indexOf(days) < 0) days = 7;
  var onlyUnorganized = !!input.onlyUnorganized;
  var d = (pre && pre.cards) || readCards_(CARD_LIST_COLS), c = colIndex_(d.header);
  var today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
  var windowStart = addDaysIso_(today, -(days - 1));
  var pm = (pre && pre.pm) || loadPersonMap_();
  var hm = (pre && pre.hm) || loadHistoryMap_();

  var matched = [];
  d.rows.forEach(function (r) {
    var iso = isoDate_(r[c['取込日']]);
    if (!iso || iso < windowStart || iso > today) return;
    var id = String(r[c['id']]);
    var pr = pm.byId[id];
    var organized = pr ? isTrue_(pr[pm.c['organized']]) : false;
    if (onlyUnorganized && organized) return;
    var tags = pr ? parseTags_(pr[pm.c['tags']]) : [];
    var snsChecked = pr ? !!String(pr[pm.c['snsCheckedAt']] || '').trim() : false;
    var hist = histSorted_(hm, id);
    var lastEvent = '';
    if (hist.length) lastEvent = formatContactLabel_(hist[0][hm.c['eventName']], pickExchanged_(hist[0][hm.c['contactDate']]));
    matched.push({
      iso: iso, id: id,
      summary: {
        id: id, name: r[c['氏名']] || '', company: r[c['会社名']] || '',
        dept: r[c['部署名']] || '', title: r[c['役職']] || '', roleLevel: r[c['役職レベル']] || '',
        industry: r[c['業種']] || '', importedAt: iso,
        exchanged: pickExchanged_(r[c['名刺交換日']]),
        batchId: c[BATCH_COL] !== undefined ? (r[c[BATCH_COL]] || '') : '',
        organized: organized, tags: tags, snsChecked: snsChecked, lastEvent: lastEvent
      }
    });
  });
  matched.sort(function (a, b) {
    if (a.iso !== b.iso) return a.iso < b.iso ? 1 : -1;
    return a.id < b.id ? 1 : (a.id > b.id ? -1 : 0);
  });
  Logger.log('newCards: ' + matched.length + '件 ' + (Date.now() - t0) + 'ms');
  return { count: matched.length, days: days, items: matched.map(function (m) { return m.summary; }) };
}

function getPerson_(input) {
  input = input || {};
  var id = String(input.id || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  var d = readAll_(), c = colIndex_(d.header);
  var row = null;
  for (var i = 0; i < d.rows.length; i++) {
    if (String(d.rows[i][c['id']]) === id) { row = d.rows[i]; break; }
  }
  if (!row) return { ok: false, error: 'not_found' };
  var g = function (name) { return c[name] !== undefined ? (row[c[name]] == null ? '' : row[c[name]]) : ''; };
  var card = {
    id: id, company: g('会社名'), dept: g('部署名'), title: g('役職'), roleLevel: g('役職レベル'),
    name: g('氏名'), industry: g('業種'), email: g('メール'), postal: g('郵便番号'),
    pref: g('都道府県'), city: g('市区町村'), address: g('住所'), telCompany: g('会社TEL'),
    mobile: g('携帯'), fax: g('Fax'), url: g('URL'),
    exchanged: pickExchanged_(row[c['名刺交換日']]),
    importedAt: pickExchanged_(row[c['取込日']]),
    batchId: c[BATCH_COL] !== undefined ? g(BATCH_COL) : '',
    biko: c['備考'] !== undefined ? g('備考') : ''
  };

  var crm = defaultCrm_();
  var sns = { facebookUrl: '', instagramUrl: '', linkedinUrl: '', xUrl: '', youtubeUrl: '', otherSnsUrl: '', snsCheckedAt: '' };
  var personD = null;
  try { personD = readSheet_(PERSON_SHEET); } catch (e) { personD = null; }
  if (personD) {
    var pc = personD.c;
    var idx = findRowByContactId_(personD, id);
    if (idx >= 0) {
      var pr = personD.rows[idx];
      crm = crmFromRow_(pr, pc);
      Object.keys(sns).forEach(function (key) { sns[key] = pr[pc[key]] || ''; });
    }
  }

  var histories = [];
  var histD = null;
  try { histD = readSheet_(HISTORY_SHEET); } catch (e) { histD = null; }
  if (histD) {
    var hc = histD.c;
    histories = histD.rows
      .filter(function (r) { return String(r[hc['contactId']]) === id; })
      .map(function (r) {
        return {
          contactDate: pickExchanged_(r[hc['contactDate']]), eventName: r[hc['eventName']] || '',
          contactType: r[hc['contactType']] || '', memo: r[hc['memo']] || '',
          followUp: isTrue_(r[hc['followUp']]), followDate: pickExchanged_(r[hc['followDate']]),
          createdAt: r[hc['createdAt']] || '',
          label: formatContactLabel_(r[hc['eventName']], pickExchanged_(r[hc['contactDate']]))
        };
      })
      .sort(function (a, b) {
        if (a.contactDate !== b.contactDate) return a.contactDate < b.contactDate ? 1 : -1;
        return a.createdAt < b.createdAt ? 1 : (a.createdAt > b.createdAt ? -1 : 0);
      });
  }

  return { ok: true, data: { card: card, crm: crm, sns: sns, histories: histories } };
}

function savePersonToSheet_(input) {
  input = input || {};
  var id = String(input.id || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    setupSnsBulkColumns_();
    var personD = readSheet_(PERSON_SHEET);
    var header = personD.header;
    var rowIdx = findRowByContactId_(personD, id);
    var now = nowStamp_();
    var record;
    if (rowIdx < 0) {
      record = {}; header.forEach(function (h) { record[h] = ''; });
      record.contactId = id; record.organized = false; record.createdAt = now;
    } else {
      record = {}; header.forEach(function (h, i2) { record[h] = personD.rows[rowIdx][i2]; });
    }
    var crmInput = input.crm || {};
    CRM_FIELDS.forEach(function (key) {
      if (!crmInput.hasOwnProperty(key)) return;
      if (key === 'tags') {
        record.tags = normalizeTags_(crmInput.tags);
      } else if (key === 'nextActionDate') {
        var v = String(crmInput.nextActionDate || '').trim();
        record.nextActionDate = v ? isoDate_(v) : '';
      } else {
        record[key] = String(crmInput[key] == null ? '' : crmInput[key]);
      }
    });
    var organized = input.hasOwnProperty('organized') ? !!input.organized : true;
    record.organized = organized;
    record.updatedAt = now;

    var rowNum = rowIdx < 0 ? personD.sheet.getLastRow() + 1 : rowIdx + 2;
    writeSheetRow_(personD.sheet, header, rowNum, record, personDateFields_());
    invalidateBootstrapCache_();
    return { ok: true, data: { id: id, organized: organized, updatedAt: now } };
  } finally {
    lock.releaseLock();
  }
}

function markOrganizedInSheet_(input) {
  input = input || {};
  var id = String(input.id || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  var organized = !!input.organized;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    setupSnsBulkColumns_();
    var personD = readSheet_(PERSON_SHEET);
    var header = personD.header;
    var rowIdx = findRowByContactId_(personD, id);
    var now = nowStamp_();
    var record;
    if (rowIdx < 0) {
      record = {}; header.forEach(function (h) { record[h] = ''; });
      record.contactId = id; record.createdAt = now;
    } else {
      record = {}; header.forEach(function (h, i2) { record[h] = personD.rows[rowIdx][i2]; });
    }
    record.organized = organized;
    record.updatedAt = now;
    var rowNum = rowIdx < 0 ? personD.sheet.getLastRow() + 1 : rowIdx + 2;
    writeSheetRow_(personD.sheet, header, rowNum, record, personDateFields_());
    invalidateBootstrapCache_();
    return { ok: true, data: { id: id, organized: organized } };
  } finally {
    lock.releaseLock();
  }
}

function addContactToSheet_(input) {
  input = input || {};
  var id = String(input.id || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  var iso = isoDate_(input.contactDate);
  if (!iso) return { ok: false, error: 'bad_date' };
  var eventName = String(input.eventName || '').trim();
  var contactType = String(input.contactType || '').trim() || 'その他';
  var memo = String(input.memo || '').trim();
  var followUp = !!input.followUp;
  var followDate = input.followDate ? isoDate_(input.followDate) : '';
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    setupSnsBulkColumns_();
    var histD = readSheet_(HISTORY_SHEET);
    var hc = histD.c, header = histD.header;
    var dupKey = [id, iso, eventName, contactType].join('|');
    var isDup = histD.rows.some(function (r) {
      return [String(r[hc['contactId']]), pickExchanged_(r[hc['contactDate']]), String(r[hc['eventName']]), String(r[hc['contactType']])].join('|') === dupKey;
    });
    var label = formatContactLabel_(eventName, iso);
    if (isDup) return { ok: true, data: { created: false, duplicate: true, label: label } };
    var now = nowStamp_();
    var record = {
      contactId: id, contactDate: iso, eventName: eventName, contactType: contactType,
      memo: memo, followUp: followUp, followDate: followDate, createdAt: now
    };
    var rowNum = histD.sheet.getLastRow() + 1;
    writeSheetRow_(histD.sheet, header, rowNum, record, historyDateFields_());
    invalidateBootstrapCache_();
    return { ok: true, data: { created: true, duplicate: false, label: label } };
  } finally {
    lock.releaseLock();
  }
}

// 要フォローの contactId 集合:
//   人物管理.nextActionDate <= 今日、または 人物管理.tags に「要フォロー」を含む、
//   または 接触履歴.followUp=TRUE かつ followDate <= 今日
var FOLLOW_TAG = '要フォロー';
function followDueSet_(pm, hm) {
  var today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
  var set = {};
  pm.rows.forEach(function (r) {
    var id = String(r[pm.c['contactId']]);
    var nd = isoDate_(r[pm.c['nextActionDate']]);
    if (nd && nd <= today) set[id] = true;
    if (parseTags_(r[pm.c['tags']]).indexOf(FOLLOW_TAG) >= 0) set[id] = true;
  });
  Object.keys(hm.byId).forEach(function (id) {
    var due = hm.byId[id].some(function (r) {
      if (!isTrue_(r[hm.c['followUp']])) return false;
      var fd = isoDate_(r[hm.c['followDate']]);
      return !!fd && fd <= today;
    });
    if (due) set[id] = true;
  });
  return set;
}

// タグ候補: 初期12件（QUICK_TAGS、quick:true）＋人物管理 tags の DISTINCT（出現回数降順）
function getTags_(pre) {
  var counts = {};
  var pm = (pre && pre.pm) || loadPersonMap_();
  pm.rows.forEach(function (r) {
    parseTags_(r[pm.c['tags']]).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
  });
  var items = QUICK_TAGS.map(function (t) { return { name: t, count: counts[t] || 0, quick: true }; });
  var extra = Object.keys(counts).filter(function (t) { return QUICK_TAGS.indexOf(t) < 0; });
  extra.sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); });
  extra.forEach(function (t) { items.push({ name: t, count: counts[t], quick: false }); });
  return { items: items };
}

// 候補なしで「SNS確認済み」にする（snsCheckedAt=now のみ。URL列は触らない）
function snsMarkCheckedInSheet_(input) {
  input = input || {};
  var id = String(input.id || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    setupSnsBulkColumns_();
    var personD = readSheet_(PERSON_SHEET);
    var header = personD.header;
    var rowIdx = findRowByContactId_(personD, id);
    var now = nowStamp_();
    var record = {};
    if (rowIdx < 0) {
      header.forEach(function (h) { record[h] = ''; });
      record.contactId = id; record.organized = false; record.createdAt = now;
    } else {
      header.forEach(function (h, i2) { record[h] = personD.rows[rowIdx][i2]; });
    }
    record.snsCheckedAt = now;
    record.updatedAt = now;
    var rowNum = rowIdx < 0 ? personD.sheet.getLastRow() + 1 : rowIdx + 2;
    writeSheetRow_(personD.sheet, header, rowNum, record, personDateFields_());
    invalidateBootstrapCache_();
    return { ok: true, data: { id: id, snsCheckedAt: now } };
  } finally {
    lock.releaseLock();
  }
}

function getEventNames_(pre) {
  var hc, rowsAll;
  if (pre && pre.hm) {
    hc = pre.hm.c; rowsAll = [];
    Object.keys(pre.hm.byId).forEach(function (id) { rowsAll = rowsAll.concat(pre.hm.byId[id]); });
  } else {
    var histD;
    try { histD = readSheet_(HISTORY_SHEET); } catch (e) { return { items: [] }; }
    hc = histD.c; rowsAll = histD.rows;
  }
  var counts = {}, latest = {};
  rowsAll.forEach(function (r) {
    var name = String(r[hc['eventName']] || '').trim();
    if (!name) return;
    counts[name] = (counts[name] || 0) + 1;
    var cd = pickExchanged_(r[hc['contactDate']]);
    if (!latest[name] || cd > latest[name]) latest[name] = cd;
  });
  var items = Object.keys(counts).map(function (name) { return { name: name, count: counts[name] }; });
  items.sort(function (a, b) {
    if (a.count !== b.count) return b.count - a.count;
    var la = latest[a.name] || '', lb = latest[b.name] || '';
    return la < lb ? 1 : (la > lb ? -1 : 0);
  });
  return { items: items.slice(0, 30) };
}

/* ==================================================================
 *  bootstrap（初期表示用: stats + newCards + tags + eventNames + filters を1回の読込で）＋ CacheService
 * ================================================================== */
var BOOT_CACHE_SEC = 120;
var BOOT_CACHE_MAX = 100000; // CacheService の 1 値あたり上限 100KB
function bootCacheKey_(days, onlyUnorganized) { return 'bootstrap:v1:' + days + ':' + (onlyUnorganized ? 1 : 0); }
function bootCacheKeysAll_() {
  var keys = [];
  [1, 3, 7, 30].forEach(function (d) { keys.push(bootCacheKey_(d, true)); keys.push(bootCacheKey_(d, false)); });
  return keys;
}
// 書き込み系 action の末尾で呼ぶ（整理直後に古い件数・一覧が出ないように）
function invalidateBootstrapCache_() {
  try { CacheService.getScriptCache().removeAll(bootCacheKeysAll_()); } catch (e) { /* noop */ }
}
function bootCacheGet_(key) {
  try {
    var v = CacheService.getScriptCache().get(key);
    if (!v) return null;
    if (v.indexOf('gz:') === 0) {
      var bytes = Utilities.base64Decode(v.slice(3));
      v = Utilities.ungzip(Utilities.newBlob(bytes)).getDataAsString();
    } else if (v.indexOf('js:') === 0) {
      v = v.slice(3);
    }
    return JSON.parse(v);
  } catch (e) { return null; }
}
function bootCachePut_(key, data) {
  try {
    var json = JSON.stringify(data);
    var v = 'js:' + json;
    if (v.length > BOOT_CACHE_MAX) {
      v = 'gz:' + Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json)).getBytes());
    }
    if (v.length > BOOT_CACHE_MAX) return false; // 圧縮しても入らない: キャッシュせず継続
    CacheService.getScriptCache().put(key, v, BOOT_CACHE_SEC);
    return true;
  } catch (e) { return false; }
}
function bootstrap_(input) {
  input = input || {};
  var t0 = Date.now();
  var days = parseInt(input.days, 10);
  if ([1, 3, 7, 30].indexOf(days) < 0) days = 7;
  var onlyUnorganized = input.hasOwnProperty('onlyUnorganized') ? !!input.onlyUnorganized : true;
  var key = bootCacheKey_(days, onlyUnorganized);
  var cached = bootCacheGet_(key);
  if (cached) {
    cached.cached = true;
    Logger.log('bootstrap(cache): ' + (Date.now() - t0) + 'ms');
    return { ok: true, data: cached };
  }
  // 各シート1回ずつ読む
  var pre = { cards: readCards_(CARD_LIST_COLS), pm: loadPersonMap_(), hm: loadHistoryMap_() };
  var nc = getNewCards_({ days: days, onlyUnorganized: onlyUnorganized }, pre);
  nc.onlyUnorganized = onlyUnorganized;
  var data = {
    stats: computeStats_(pre),
    newCards: nc,
    tags: getTags_(pre),
    eventNames: getEventNames_(pre),
    filters: getFilters(pre),
    cached: false,
    generatedAt: nowStamp_()
  };
  bootCachePut_(key, data);
  Logger.log('bootstrap: ' + (Date.now() - t0) + 'ms');
  return { ok: true, data: data };
}

/* ==================================================================
 *  名刺交換日・イベントの一括設定 (bulkContactPreview / bulkContactApply)
 * ================================================================== */
// scope: 'batch'=batchId指定ならimportBatchId一致、無ければ取込日がdays日以内(既定7)。
//        'unset'=同じ窓 かつ 名刺交換日が空。'ids'=指定id群。
function resolveBulkTargets_(input) {
  var d = readAll_(), c = colIndex_(d.header);
  var today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
  var days = parseInt(input.days, 10);
  if (!(days > 0)) days = 7;
  var windowStart = addDaysIso_(today, -(days - 1));
  var batchId = input.batchId ? String(input.batchId).trim() : '';
  var scope = input.scope;

  var inWindow = function (r) {
    if (batchId) return c[BATCH_COL] !== undefined && String(r[c[BATCH_COL]] || '') === batchId;
    var iso = isoDate_(r[c['取込日']]);
    return !!iso && iso >= windowStart && iso <= today;
  };

  var targets = [];
  if (scope === 'ids') {
    var idSet = {};
    (input.ids || []).forEach(function (x) { idSet[String(x)] = true; });
    d.rows.forEach(function (r, idx) { if (idSet[String(r[c['id']])]) targets.push({ row: idx + 2, r: r }); });
  } else if (scope === 'unset') {
    d.rows.forEach(function (r, idx) {
      if (!inWindow(r)) return;
      if (String(r[c['名刺交換日']] || '').trim() === '') targets.push({ row: idx + 2, r: r });
    });
  } else {
    d.rows.forEach(function (r, idx) { if (inWindow(r)) targets.push({ row: idx + 2, r: r }); });
  }
  return { targets: targets, c: c, header: d.header, sheet: getSheet_() };
}

function bulkContactPreview_(input) {
  input = input || {};
  var iso = isoDate_(input.date);
  if (!iso) return { ok: false, error: 'bad_date' };
  var eventName = String(input.eventName || '').trim();
  if (!eventName) return { ok: false, error: 'bad_event' };
  var t = resolveBulkTargets_(input);
  var c = t.c;
  var targetIds = t.targets.map(function (x) { return String(x.r[c['id']]); });

  var willOverwriteCount = 0;
  t.targets.forEach(function (x) {
    var raw = String(x.r[c['名刺交換日']] || '').trim();
    var exIso = isoDate_(x.r[c['名刺交換日']]);
    if (raw !== '' && exIso !== iso) willOverwriteCount++;
  });

  var alreadyHistoryCount = 0;
  var histD = null;
  try { histD = readSheet_(HISTORY_SHEET); } catch (e) { histD = null; }
  if (histD) {
    var hc = histD.c;
    var existingKeys = {};
    histD.rows.forEach(function (r) {
      existingKeys[[String(r[hc['contactId']]), pickExchanged_(r[hc['contactDate']]), String(r[hc['eventName']]), String(r[hc['contactType']])].join('|')] = true;
    });
    targetIds.forEach(function (id) {
      if (existingKeys[[id, iso, eventName, '名刺交換'].join('|')]) alreadyHistoryCount++;
    });
  }

  return { ok: true, data: { targetCount: targetIds.length, willOverwriteCount: willOverwriteCount, alreadyHistoryCount: alreadyHistoryCount, targetIds: targetIds } };
}

function bulkContactApply_(input) {
  input = input || {};
  var iso = isoDate_(input.date);
  if (!iso) return { ok: false, error: 'bad_date' };
  var eventName = String(input.eventName || '').trim();
  if (!eventName) return { ok: false, error: 'bad_event' };
  var overwrite = !!input.overwrite;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    setupSnsBulkColumns_();
    var t0 = Date.now();
    var t = resolveBulkTargets_(input); // 名刺DB は readAll_ で1回だけ読む
    var c = t.c, sheet = t.sheet;
    var exCol = c['名刺交換日'] + 1;

    // 交換日: メモリ上で書き込み対象行を決め、連続する行のまとまり（ラン）ごとに1回の setValues で書く
    // （対象外の行には触れない。新着は末尾に固まるので通常1回で済む）
    var writeRows = [];
    t.targets.forEach(function (x) {
      var raw = String(x.r[c['名刺交換日']] || '').trim();
      var exIso = isoDate_(x.r[c['名刺交換日']]);
      if (raw === '' || (overwrite && exIso !== iso)) writeRows.push(x.row);
    });
    writeRows.sort(function (a, b) { return a - b; });
    var updatedDateCount = writeRows.length;
    var runStart = -1, runLen = 0;
    var flushRun = function () {
      if (runLen <= 0) return;
      var vals = [];
      for (var k = 0; k < runLen; k++) vals.push([iso]);
      sheet.getRange(runStart, exCol, runLen, 1).setNumberFormat('@').setValues(vals);
    };
    writeRows.forEach(function (row) {
      if (runStart >= 0 && row === runStart + runLen) { runLen++; return; }
      flushRun(); runStart = row; runLen = 1;
    });
    flushRun();

    var histD = readSheet_(HISTORY_SHEET);
    var hc = histD.c, header = histD.header;
    var existingKeys = {};
    histD.rows.forEach(function (r) {
      existingKeys[[String(r[hc['contactId']]), pickExchanged_(r[hc['contactDate']]), String(r[hc['eventName']]), String(r[hc['contactType']])].join('|')] = true;
    });
    var now = nowStamp_();
    var createdHistoryCount = 0, skippedDupCount = 0;
    var appendRows = [];
    t.targets.forEach(function (x) {
      var id = String(x.r[c['id']]);
      var key = [id, iso, eventName, '名刺交換'].join('|');
      if (existingKeys[key]) { skippedDupCount++; return; }
      existingKeys[key] = true;
      var record = { contactId: id, contactDate: iso, eventName: eventName, contactType: '名刺交換', memo: '', followUp: false, followDate: '', createdAt: now };
      appendRows.push(header.map(function (h) { return record.hasOwnProperty(h) ? record[h] : ''; }));
      createdHistoryCount++;
    });
    if (appendRows.length) {
      var startRow = histD.sheet.getLastRow() + 1;
      historyDateFields_().forEach(function (f) {
        var idx = header.indexOf(f);
        if (idx >= 0) histD.sheet.getRange(startRow, idx + 1, appendRows.length, 1).setNumberFormat('@');
      });
      histD.sheet.getRange(startRow, 1, appendRows.length, header.length).setValues(appendRows);
    }

    invalidateBootstrapCache_();
    var label = formatContactLabel_(eventName, iso);
    Logger.log('bulkContactApply: ' + t.targets.length + '件 / 交換日更新 ' + updatedDateCount + ' / 履歴作成 ' + createdHistoryCount + ' / 重複 ' + skippedDupCount + ' / ' + (Date.now() - t0) + 'ms');
    return { ok: true, data: { targetCount: t.targets.length, updatedDateCount: updatedDateCount, createdHistoryCount: createdHistoryCount, skippedDupCount: skippedDupCount, label: label } };
  } finally {
    lock.releaseLock();
  }
}

/* ==================================================================
 *  SNSアカウント確認
 * ================================================================== */
function detectSnsPlatform_(url) {
  var m = url.match(/^https?:\/\/([^\/]+)/i);
  if (!m) return null;
  var host = m[1].toLowerCase().replace(/^www\./, '');
  if (host === 'facebook.com' || host === 'fb.com' || /\.facebook\.com$/.test(host) || /\.fb\.com$/.test(host)) return 'facebook';
  if (host === 'instagram.com' || /\.instagram\.com$/.test(host)) return 'instagram';
  if (host === 'linkedin.com' || /\.linkedin\.com$/.test(host)) return 'linkedin';
  if (host === 'x.com' || host === 'twitter.com' || /\.x\.com$/.test(host) || /\.twitter\.com$/.test(host)) return 'x';
  if (host === 'youtube.com' || host === 'youtu.be' || /\.youtube\.com$/.test(host)) return 'youtube';
  return null;
}

// HTML内のhref="..."/href='...'からSNSリンク候補を抽出する純関数(保存しない・fetchしない)。
var SNS_EXCLUDE_RE = /(sharer|share|intent|login|signup|dialog|plugins|hashtag|search|policies|help|privacy|terms|legal|about)/i;
function extractSnsCandidates_(html, baseUrl) {
  html = String(html || '');
  var re = /href\s*=\s*["']([^"']+)["']/gi;
  var m, seen = {}, results = [];
  while ((m = re.exec(html))) {
    var url = m[1];
    if (/^\/\//.test(url)) {
      url = 'https:' + url;
    } else if (/^\//.test(url)) {
      var base = String(baseUrl || '').replace(/\/+$/, '');
      var hostMatch = base.match(/^(https?:\/\/[^\/]+)/i);
      if (!hostMatch) continue;
      url = hostMatch[1] + url;
    }
    if (!/^https?:\/\//i.test(url)) continue;

    var platform = detectSnsPlatform_(url);
    if (!platform) continue;

    var clean = url.split('#')[0].split('?')[0].replace(/\/+$/, '');
    var pathMatch = clean.match(/^https?:\/\/[^\/]+(\/.*)?$/i);
    var path = pathMatch && pathMatch[1] ? pathMatch[1] : '';
    if (SNS_EXCLUDE_RE.test(path)) continue;
    if (path === '' || path === '/') continue;

    if (platform === 'x') clean = clean.replace(/^https?:\/\/(www\.)?twitter\.com/i, 'https://x.com');

    if (seen[clean]) continue;
    seen[clean] = true;
    results.push({ platform: platform, url: clean });
  }
  var countByPlatform = {}, limited = [];
  results.forEach(function (item) {
    countByPlatform[item.platform] = (countByPlatform[item.platform] || 0) + 1;
    if (countByPlatform[item.platform] <= 3) limited.push(item);
  });
  return limited;
}

function snsDetectFromSite_(input) {
  input = input || {};
  var id = String(input.id || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  var d = readAll_(), c = colIndex_(d.header);
  var row = null;
  for (var i = 0; i < d.rows.length; i++) { if (String(d.rows[i][c['id']]) === id) { row = d.rows[i]; break; } }
  if (!row) return { ok: false, error: 'not_found' };
  var rawUrl = String(row[c['URL']] || '').trim();
  if (!rawUrl) return { ok: true, data: { siteUrl: '', candidates: [] } };
  var siteUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : ('https://' + rawUrl);

  var html;
  try {
    var resp = UrlFetchApp.fetch(siteUrl, {
      muteHttpExceptions: true, followRedirects: true,
      validateHttpsCertificates: false,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) return { ok: true, data: { siteUrl: siteUrl, candidates: [], error: 'fetch_failed' } };
    html = resp.getContentText();
  } catch (e) {
    return { ok: true, data: { siteUrl: siteUrl, candidates: [], error: 'fetch_failed' } };
  }

  var raw = extractSnsCandidates_(html, siteUrl);
  var candidates = raw.map(function (x) {
    return { platform: x.platform, url: x.url, source: '公式サイト', sourceUrl: siteUrl };
  });
  return { ok: true, data: { siteUrl: siteUrl, candidates: candidates } };
}

function snsSearchLinks_(input) {
  input = input || {};
  var id = String(input.id || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  var d = readAll_(), c = colIndex_(d.header);
  var row = null;
  for (var i = 0; i < d.rows.length; i++) { if (String(d.rows[i][c['id']]) === id) { row = d.rows[i]; break; } }
  if (!row) return { ok: false, error: 'not_found' };
  var name = String(row[c['氏名']] || '').trim();
  var company = String(row[c['会社名']] || '').trim();
  var query = (name + ' ' + company).trim();
  var defs = [
    { platform: 'facebook', label: 'Facebook', native: 'https://www.facebook.com/search/top?q=' },
    { platform: 'instagram', label: 'Instagram', native: null },
    { platform: 'linkedin', label: 'LinkedIn', native: 'https://www.linkedin.com/search/results/all/?keywords=' },
    { platform: 'x', label: 'X', native: 'https://x.com/search?q=' }
  ];
  var links = defs.map(function (def) {
    return {
      platform: def.platform, label: def.label,
      google: 'https://www.google.com/search?q=' + encodeURIComponent(query + ' ' + def.label),
      native: def.native === null ? null : (def.native + encodeURIComponent(query))
    };
  });
  return { ok: true, data: { query: query, links: links } };
}

function snsSaveToSheet_(input) {
  input = input || {};
  var id = String(input.id || '').trim();
  var platform = String(input.platform || '').trim();
  var url = String(input.url || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  if (SNS_PLATFORM_COL[platform] === undefined) return { ok: false, error: 'bad_platform' };
  if (!/^https:\/\//i.test(url)) return { ok: false, error: 'bad_url' };
  if (platform !== 'other') {
    var hostMatch = url.match(/^https:\/\/([^\/]+)/i);
    var host = hostMatch ? hostMatch[1].toLowerCase() : '';
    if (!SNS_DOMAIN_RULES[platform].test(host)) return { ok: false, error: 'bad_domain' };
  }
  var col = SNS_PLATFORM_COL[platform];

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    setupSnsBulkColumns_();
    var personD = readSheet_(PERSON_SHEET);
    var header = personD.header;
    var rowIdx = findRowByContactId_(personD, id);
    var now = nowStamp_();
    var record;
    if (rowIdx < 0) {
      record = {}; header.forEach(function (h) { record[h] = ''; });
      record.contactId = id; record.organized = false; record.createdAt = now;
    } else {
      record = {}; header.forEach(function (h, i2) { record[h] = personD.rows[rowIdx][i2]; });
    }
    record[col] = url;
    record.snsCheckedAt = now;
    record.updatedAt = now;
    var rowNum = rowIdx < 0 ? personD.sheet.getLastRow() + 1 : rowIdx + 2;
    writeSheetRow_(personD.sheet, header, rowNum, record, personDateFields_());
    invalidateBootstrapCache_();
    return { ok: true, data: { id: id, platform: platform, url: url, snsCheckedAt: now } };
  } finally {
    lock.releaseLock();
  }
}

function snsRemoveFromSheet_(input) {
  input = input || {};
  var id = String(input.id || '').trim();
  var platform = String(input.platform || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  if (SNS_PLATFORM_COL[platform] === undefined) return { ok: false, error: 'bad_platform' };
  var col = SNS_PLATFORM_COL[platform];

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    setupSnsBulkColumns_();
    var personD = readSheet_(PERSON_SHEET);
    var header = personD.header;
    var rowIdx = findRowByContactId_(personD, id);
    if (rowIdx < 0) return { ok: true, data: { id: id, platform: platform } };
    var now = nowStamp_();
    var record = {}; header.forEach(function (h, i2) { record[h] = personD.rows[rowIdx][i2]; });
    record[col] = '';
    record.updatedAt = now; // snsCheckedAtは残す
    writeSheetRow_(personD.sheet, header, rowIdx + 2, record, personDateFields_());
    invalidateBootstrapCache_();
    return { ok: true, data: { id: id, platform: platform } };
  } finally {
    lock.releaseLock();
  }
}

/* ==================================================================
 *  テスト (STEP2/3の成功判定。GASエディタから実行。本番では一時 action 経由で実行済み)
 * ================================================================== */
// テスト用: 各シートからテストID群に一致する行を（行番号降順で）削除する。行番号を保持せず毎回読み直す。
function deleteTestRows_(ids) {
  var idSet = {};
  ids.forEach(function (x) { idSet[String(x)] = true; });
  [[HISTORY_SHEET, 'contactId'], [PERSON_SHEET, 'contactId'], [SHEET_NAME, 'id']].forEach(function (pair) {
    try {
      var sh = ss_().getSheetByName(pair[0]);
      if (!sh) return;
      var values = sh.getDataRange().getValues();
      var c = colIndex_(values.shift() || []);
      var rows = [];
      values.forEach(function (r, idx) { if (idSet[String(r[c[pair[1]]])]) rows.push(idx + 2); });
      rows.sort(function (a, b) { return b - a; }).forEach(function (row) { sh.deleteRow(row); });
    } catch (e) { /* noop */ }
  });
}

function test_bulk_() {
  var checks = [];
  var testIds = [];
  try {
    setupSnsBulkColumns_();
    var sh = getSheet_();
    var d = readAll_(), c = colIndex_(d.header);
    var header = d.header;
    var lastNum = 0;
    d.rows.forEach(function (r) {
      var m = String(r[c['id']]).match(/^M(\d+)$/);
      if (m) lastNum = Math.max(lastNum, parseInt(m[1], 10));
    });
    var today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
    var names = ['テスト 太郎', 'テスト 二郎', 'テスト 三郎'];
    var ids = testIds;
    var appendRows = [];
    names.forEach(function (nm, idx) {
      lastNum++;
      var id = 'M' + ('00000' + lastNum).slice(-5);
      ids.push(id);
      var parts = nm.split(/[\s　]+/);
      var record = {
        'id': id, '会社名': 'テスト株式会社_bulk', '部署名': '', '役職': '', '役職レベル': '',
        '氏名': nm, '姓': parts[0], '名': parts[1] || '', '業種': '', 'メール': '',
        '郵便番号': '', '都道府県': '', '市区町村': '', '住所': '', '会社TEL': '', '携帯': '', 'Fax': '',
        'URL': '', '名刺交換日': idx === 2 ? '2020-01-01' : '', '取込日': today,
        'importBatchId': 'test-bulk'
      };
      appendRows.push(header.map(function (h) { return record.hasOwnProperty(h) ? record[h] : ''; }));
    });
    var startRow = sh.getLastRow() + 1;
    ['名刺交換日', '取込日'].forEach(function (f) {
      var idx = header.indexOf(f);
      if (idx >= 0) sh.getRange(startRow, idx + 1, appendRows.length, 1).setNumberFormat('@');
    });
    sh.getRange(startRow, 1, appendRows.length, header.length).setValues(appendRows);

    var res1 = bulkContactApply_({ scope: 'ids', ids: ids, date: '2026/09/08', eventName: 'テストイベント', overwrite: false });
    checks.push({ name: 'apply1_createdHistoryCount', ok: res1.ok && res1.data.createdHistoryCount === 3, detail: JSON.stringify(res1) });
    checks.push({ name: 'apply1_updatedDateCount', ok: res1.ok && res1.data.updatedDateCount === 2, detail: JSON.stringify(res1) });

    var res2 = bulkContactApply_({ scope: 'ids', ids: ids, date: '2026/09/08', eventName: 'テストイベント', overwrite: false });
    checks.push({ name: 'apply2_createdHistoryCount', ok: res2.ok && res2.data.createdHistoryCount === 0, detail: JSON.stringify(res2) });
    checks.push({ name: 'apply2_skippedDupCount', ok: res2.ok && res2.data.skippedDupCount === 3, detail: JSON.stringify(res2) });

    var d2 = readAll_(), c2 = colIndex_(d2.header);
    var saburoRow = null;
    d2.rows.forEach(function (r) { if (String(r[c2['id']]) === ids[2]) saburoRow = r; });
    var saburoExchanged = saburoRow ? isoDate_(saburoRow[c2['名刺交換日']]) : null;
    checks.push({ name: 'saburo_exchanged_unchanged', ok: saburoExchanged === '2020-01-01', detail: String(saburoExchanged) });

    checks.push({ name: 'isoDate_slash', ok: isoDate_('2026/09/08') === '2026-09-08', detail: isoDate_('2026/09/08') });
    checks.push({ name: 'isoDate_yymmdd_reject', ok: isoDate_('260908') === '', detail: JSON.stringify(isoDate_('260908')) });
    checks.push({ name: 'formatContactLabel', ok: formatContactLabel_('守成 青山デイライト', '2026-09-08') === '守成 青山デイライト 260908', detail: formatContactLabel_('守成 青山デイライト', '2026-09-08') });

  } catch (e) {
    checks.push({ name: 'exception', ok: false, detail: String(e) });
  } finally {
    deleteTestRows_(testIds);
  }
  var pass = checks.length > 0 && checks.every(function (x) { return x.ok; });
  var result = { pass: pass, checks: checks };
  Logger.log(JSON.stringify(result));
  return result;
}

// 要フォロー判定テスト: (a)日付のみ (b)タグのみ (c)両方なし の3件で該当が 2 件になること。終了後にテスト行を削除
function test_follow_() {
  var checks = [];
  var testIds = [];
  try {
    setupSnsBulkColumns_();
    var sh = getSheet_();
    var d = readAll_(), c = colIndex_(d.header);
    var header = d.header;
    var lastNum = 0;
    d.rows.forEach(function (r) {
      var m = String(r[c['id']]).match(/^M(\d+)$/);
      if (m) lastNum = Math.max(lastNum, parseInt(m[1], 10));
    });
    var today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
    var yesterday = addDaysIso_(today, -1);
    var cases = [
      { name: 'テスト 日付', crm: { nextActionDate: yesterday, tags: [] } },
      { name: 'テスト タグ', crm: { nextActionDate: '', tags: [FOLLOW_TAG] } },
      { name: 'テスト なし', crm: { nextActionDate: '', tags: [] } }
    ];
    var appendRows = [];
    cases.forEach(function (cs) {
      lastNum++;
      var id = 'M' + ('00000' + lastNum).slice(-5);
      testIds.push(id);
      cs.id = id;
      var record = { 'id': id, '会社名': 'テスト株式会社_follow', '氏名': cs.name, '姓': 'テスト', '名': cs.name.split(' ')[1], '取込日': today, 'importBatchId': 'test-follow' };
      appendRows.push(header.map(function (h) { return record.hasOwnProperty(h) ? record[h] : ''; }));
    });
    var startRow = sh.getLastRow() + 1;
    var idxToday = header.indexOf('取込日');
    if (idxToday >= 0) sh.getRange(startRow, idxToday + 1, appendRows.length, 1).setNumberFormat('@');
    sh.getRange(startRow, 1, appendRows.length, header.length).setValues(appendRows);

    cases.forEach(function (cs) {
      var r = savePersonToSheet_({ id: cs.id, crm: cs.crm, organized: false });
      checks.push({ name: 'save_' + cs.name, ok: !!r.ok, detail: JSON.stringify(r) });
    });

    var set = followDueSet_(loadPersonMap_(), loadHistoryMap_());
    var hit = testIds.filter(function (id) { return !!set[id]; });
    checks.push({ name: 'follow_count_is_2', ok: hit.length === 2, detail: JSON.stringify(hit) });
    checks.push({ name: 'date_case_hit', ok: !!set[cases[0].id], detail: cases[0].id });
    checks.push({ name: 'tag_case_hit', ok: !!set[cases[1].id], detail: cases[1].id });
    checks.push({ name: 'none_case_not_hit', ok: !set[cases[2].id], detail: cases[2].id });

    var st = computeStats_();
    checks.push({ name: 'stats_followCount_ge_2', ok: st.followCount >= 2, detail: JSON.stringify(st) });
    var sr = searchCards({ followDue: true });
    var found = sr.items.filter(function (it) { return testIds.indexOf(it.id) >= 0; }).map(function (it) { return it.id; });
    checks.push({ name: 'search_followDue_hits_2', ok: found.length === 2, detail: JSON.stringify(found) });
  } catch (e) {
    checks.push({ name: 'exception', ok: false, detail: String(e) });
  } finally {
    deleteTestRows_(testIds);
  }
  var pass = checks.length > 0 && checks.every(function (x) { return x.ok; });
  var result = { pass: pass, checks: checks };
  Logger.log(JSON.stringify(result));
  return result;
}

function test_sns_() {
  var checks = [];
  var testIds = [];
  try {
    var html = '<html><body>' +
      '<a href="https://www.facebook.com/tanaka.taro">FB</a>' +
      '<a href="https://www.facebook.com/sharer/sharer.php?u=https://example.com">Share</a>' +
      "<a href='https://instagram.com/tanaka_taro/'>IG</a>" +
      '<a href="https://twitter.com/taro_tanaka">X</a>' +
      '<a href="https://www.youtube.com/channel/UCxxxxxx">YT</a>' +
      '<a href="//www.facebook.com/sharer.php?u=xxx">RelShare</a>' +
      '</body></html>';
    var candidates = extractSnsCandidates_(html, 'https://example.com');
    var byPlatform = {};
    candidates.forEach(function (x) { byPlatform[x.platform] = (byPlatform[x.platform] || 0) + 1; });
    checks.push({ name: 'sns_facebook_count', ok: byPlatform.facebook === 1, detail: JSON.stringify(candidates) });
    checks.push({ name: 'sns_instagram_count', ok: byPlatform.instagram === 1, detail: JSON.stringify(candidates) });
    checks.push({ name: 'sns_x_count', ok: byPlatform.x === 1, detail: JSON.stringify(candidates) });
    checks.push({ name: 'sns_youtube_count', ok: byPlatform.youtube === 1, detail: JSON.stringify(candidates) });
    var xItem = candidates.filter(function (x) { return x.platform === 'x'; })[0];
    checks.push({ name: 'sns_x_normalized', ok: !!xItem && xItem.url.indexOf('https://x.com/') === 0, detail: xItem && xItem.url });

    setupSnsBulkColumns_();
    var sh = getSheet_();
    var d = readAll_(), c = colIndex_(d.header);
    var header = d.header;
    var lastNum = 0;
    d.rows.forEach(function (r) {
      var m = String(r[c['id']]).match(/^M(\d+)$/);
      if (m) lastNum = Math.max(lastNum, parseInt(m[1], 10));
    });
    var id = 'M' + ('00000' + (lastNum + 1)).slice(-5);
    testIds.push(id);
    var today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
    var record = {
      'id': id, '会社名': 'テスト株式会社_sns', '氏名': 'テスト SNS子', '姓': 'テスト', '名': 'SNS子',
      '取込日': today, 'importBatchId': 'test-sns'
    };
    var row = header.map(function (h) { return record.hasOwnProperty(h) ? record[h] : ''; });
    var newRowNum = sh.getLastRow() + 1;
    var idxToday = header.indexOf('取込日');
    if (idxToday >= 0) sh.getRange(newRowNum, idxToday + 1).setNumberFormat('@');
    sh.getRange(newRowNum, 1, 1, row.length).setValues([row]);

    var r1 = snsSaveToSheet_({ id: id, platform: 'instagram', url: 'https://example.com/x' });
    checks.push({ name: 'snsSave_bad_domain', ok: !r1.ok && r1.error === 'bad_domain', detail: JSON.stringify(r1) });
    var r2 = snsSaveToSheet_({ id: id, platform: 'instagram', url: 'http://instagram.com/abc' });
    checks.push({ name: 'snsSave_bad_url', ok: !r2.ok && r2.error === 'bad_url', detail: JSON.stringify(r2) });

    var r3 = snsSaveToSheet_({ id: id, platform: 'instagram', url: 'https://www.instagram.com/abc/' });
    checks.push({ name: 'snsSave_ok', ok: r3.ok, detail: JSON.stringify(r3) });
    var p1 = getPerson_({ id: id });
    checks.push({ name: 'person_instagramUrl_set', ok: p1.ok && p1.data.sns.instagramUrl === 'https://www.instagram.com/abc/', detail: JSON.stringify(p1) });
    checks.push({ name: 'person_snsCheckedAt_nonempty', ok: p1.ok && !!String(p1.data.sns.snsCheckedAt || '').trim(), detail: JSON.stringify(p1) });

    var r4 = snsRemoveFromSheet_({ id: id, platform: 'instagram' });
    checks.push({ name: 'snsRemove_ok', ok: r4.ok, detail: JSON.stringify(r4) });
    var p2 = getPerson_({ id: id });
    checks.push({ name: 'person_instagramUrl_cleared', ok: p2.ok && p2.data.sns.instagramUrl === '', detail: JSON.stringify(p2) });

  } catch (e) {
    checks.push({ name: 'exception', ok: false, detail: String(e) });
  } finally {
    deleteTestRows_(testIds);
  }
  var pass = checks.length > 0 && checks.every(function (x) { return x.ok; });
  var result = { pass: pass, checks: checks };
  Logger.log(JSON.stringify(result));
  return result;
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
