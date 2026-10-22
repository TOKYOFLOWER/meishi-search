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
// 名刺画像（Drive 非公開フォルダの fileId を名刺DB 末尾列に保持。画像本体はシートに置かない）
var IMAGE_COLS = ['imageFrontId', 'imageFrontThumbId', 'imageBackId', 'imageBackThumbId'];
var IMAGE_FOLDER_NAME = 'meishi-images';
var IMAGE_FOLDER_PROP = 'IMAGE_FOLDER_ID';
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

// ====== Eight風UI: デバイストークン・軽量リスト・サムネ配信 ======
var THUMB_COL = 'thumbFileId'; // 名刺DB末尾列（幅480px/JPEG70%のサムネfileId）
var DEVICES_SHEET = 'devices';
var DEVICES_HEADER = ['token_hash', 'device_label', 'created_at', 'last_seen', 'revoked'];
var TOKEN_TTL_DAYS = 180; // last_seenからの有効期限（延長あり）
var AUTH_CACHE_SEC = 600; // トークン検証OKの結果を10分キャッシュ（last_seen書き込み頻度を抑える）
var THUMB_MAX_IDS = 30; // getThumbs 1回あたりの最大件数

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
    var authRes = authAny_(body);
    if (!authRes.ok) {
      Utilities.sleep(800); // 総当たり対策の軽い遅延
      out = { ok: false, error: authRes.error || 'auth' };
    } else if (body.action === 'ping') {
      out = { ok: true };
    } else if (body.action === 'login') {
      out = login_(body);
    } else if (body.action === 'logout') {
      out = logout_(body);
    } else if (body.action === 'listLite') {
      out = listLite_(body);
    } else if (body.action === 'listDelta') {
      out = listDelta_(body);
    } else if (body.action === 'searchText') {
      out = searchText_(body);
    } else if (body.action === 'deleteCards') {
      out = deleteCards_(body);
    } else if (body.action === 'restoreCards') {
      out = restoreCards_(body);
    } else if (body.action === 'listTrash') {
      out = listTrash_(body);
    } else if (body.action === 'purgeCards') {
      out = purgeCards_(body);
    } else if (body.action === 'getThumbs') {
      out = getThumbs_(body);
    } else if (body.action === 'setThumb') {
      out = setThumb_(body);
    } else if (body.action === 'filters') {
      out = { ok: true, data: getFilters() };
    } else if (body.action === 'search') {
      out = { ok: true, data: searchCards(body.q || {}) };
    } else if (body.action === 'addCard') {
      out = addCardToSheet(body.card || {});
    } else if (body.action === 'bootstrap') {
      out = bootstrap_(body);
    } else if (body.action === 'cardImage') {
      out = cardImage_(body);
    } else if (body.action === 'attachImages') {
      out = attachImages_(body);
    } else if (body.action === 'cardsWithoutImage') {
      out = { ok: true, data: cardsWithoutImage_() };
    } else if (body.action === 'cardsWithoutThumb') {
      out = { ok: true, data: cardsWithoutThumb_() };
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

// token があればデバイストークン認証、無ければ従来の user/pass 直送方式（後方互換）
function authAny_(body) {
  if (body && body.token) return auth_(body);
  return authOk_(body && body.user, body && body.pass) ? { ok: true } : { ok: false, error: 'auth' };
}

/* ---- デバイストークン（Eight風UI: 永続ログイン） ---- */
function ensureDevicesSheet_() {
  return ensureSheetWithHeader_(DEVICES_SHEET, DEVICES_HEADER).sheet;
}
function sha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s || ''), Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length < 2 ? '0' + v : v;
  }).join('');
}
function genDeviceToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}
// devices シートを token_hash で検索。見つかれば {sheet, rowNum(1始まり), header, c, values}
function findDeviceByHash_(tokenHash) {
  var sh = ensureDevicesSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  var lastCol = sh.getLastColumn();
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var c = colIndex_(header);
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][c['token_hash']] || '') === tokenHash) {
      return { sheet: sh, rowNum: i + 2, header: header, c: c, values: values[i] };
    }
  }
  return null;
}
// action=login: authAny_ で user/pass 検証済みの上でトークンを新規発行
function login_(body) {
  var label = String((body && (body.deviceLabel || body.device_label)) || '').trim() || 'device';
  var token = genDeviceToken_();
  var sh = ensureDevicesSheet_();
  var now = nowStamp_();
  sh.appendRow([sha256Hex_(token), label, now, now, false]);
  return { ok: true, data: { token: token } };
}
// action=logout: 該当行を revoked=true に
function logout_(body) {
  var token = String((body && body.token) || '').trim();
  if (!token) return { ok: false, error: 'missing_token' };
  var found = findDeviceByHash_(sha256Hex_(token));
  if (found) {
    found.sheet.getRange(found.rowNum, found.c['revoked'] + 1).setValue(true);
    try { CacheService.getScriptCache().remove('authtok:' + sha256Hex_(token)); } catch (e) { /* noop */ }
  }
  return { ok: true };
}
// 共通ガード: token のハッシュ照合＋期限(last_seenから180日)＋revoked確認。OKならlast_seen更新(10分キャッシュ)
function auth_(payload) {
  var token = String((payload && payload.token) || '').trim();
  if (!token) return { ok: false, error: 'AUTH' };
  var hash = sha256Hex_(token);
  var cache = CacheService.getScriptCache();
  var cacheKey = 'authtok:' + hash;
  if (cache.get(cacheKey) === '1') return { ok: true };
  var found = findDeviceByHash_(hash);
  if (!found) return { ok: false, error: 'AUTH' };
  if (isTrue_(found.values[found.c['revoked']])) return { ok: false, error: 'AUTH' };
  var lastSeenRaw = found.values[found.c['last_seen']];
  var lastSeenDate = lastSeenRaw instanceof Date ? lastSeenRaw : new Date(String(lastSeenRaw || '').replace(' ', 'T'));
  if (isNaN(lastSeenDate.getTime())) lastSeenDate = new Date(0);
  var ageDays = (Date.now() - lastSeenDate.getTime()) / 86400000;
  if (ageDays > TOKEN_TTL_DAYS) return { ok: false, error: 'AUTH' };
  found.sheet.getRange(found.rowNum, found.c['last_seen'] + 1).setValue(nowStamp_());
  cache.put(cacheKey, '1', AUTH_CACHE_SEC);
  return { ok: true };
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
var CARD_LIST_COLS = ['id', '会社名', '部署名', '役職', '役職レベル', '氏名', '業種', '都道府県', '名刺交換日', '取込日', 'importBatchId', 'deletedAt'];
// 論理削除(ゴミ箱): 名刺DB末尾の deletedAt 列に日時が入っている行は「削除済み」。空＝有効。
var DELETED_COL = 'deletedAt';
function isDeletedRow_(r, c) {
  return c[DELETED_COL] !== undefined && String(r[c[DELETED_COL]] == null ? '' : r[c[DELETED_COL]]).trim() !== '';
}
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
// pickExchanged_と同じ結果を返すが、Utilities.formatDate(GAS API境界を跨ぐ呼び出し)を使わない高速版。
// JSTはUTC+9固定(夏時間なし)なので +9h してUTC系メソッドで取り出せば正確に一致する。
// listLiteのように数千行をmapする箇所で使う(1行ごとのAPI呼び出しコストが積み上がるため)。
function pickExchangedFast_(v) {
  if (v instanceof Date) {
    var t = v.getTime();
    if (isNaN(t)) return '';
    var jst = new Date(t + 9 * 3600000);
    var y = jst.getUTCFullYear(), m = jst.getUTCMonth() + 1, day = jst.getUTCDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
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
  var total = 0;
  d.rows.forEach(function (r) {
    if (isDeletedRow_(r, c)) return;
    total++;
    var p = r[c['都道府県']]; if (p) prefs[p] = (prefs[p] || 0) + 1;
    var ind = r[c['業種']]; if (ind) inds[ind] = (inds[ind] || 0) + 1;
    var rl = r[c['役職レベル']]; if (rl) roles[rl] = (roles[rl] || 0) + 1;
  });
  var sortByCount = function (o) {
    return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; })
      .map(function (k) { return { name: k, count: o[k] }; });
  };
  return { total: total, prefs: sortByCount(prefs),
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
    if (isDeletedRow_(r, c)) continue;
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

/* === 重複候補（取込時に既存行と「似ている」ものへタグを付ける。登録自体は止めない） === */
var DUP_TAG = '重複候補';
// 異体字を代表字へ寄せる（髙/高 など）。姓名の1字違い判定の前に適用する
var VARIANT_MAP_ = { '髙': '高', '﨑': '崎', '德': '徳', '邊': '辺', '邉': '辺', '澤': '沢', '濱': '浜', '齋': '斎', '齊': '斎',
  '櫻': '桜', '嶋': '島', '國': '国', '廣': '広', '兒': '児', '龍': '竜', '惠': '恵', '眞': '真', '槇': '槙', '渕': '淵', '髮': '髪' };
function normNameVariant_(s) {
  s = normKey_(s);
  return s.replace(/[髙﨑德邊邉澤濱齋齊櫻嶋國廣兒龍惠眞槇渕髮]/g, function (ch) { return VARIANT_MAP_[ch] || ch; });
}
function splitSeiMei_(name, sei, mei) {
  sei = String(sei || '').trim(); mei = String(mei || '').trim();
  if (!sei && !mei) {
    var parts = String(name || '').trim().split(/[\s　]+/).filter(function (x) { return x !== ''; });
    sei = parts.length ? parts[0] : '';
    mei = parts.length > 1 ? parts.slice(1).join(' ') : '';
  }
  return { sei: normNameVariant_(sei), mei: normNameVariant_(mei) };
}
function digitsOnly_(v) { return String(v || '').replace(/\D/g, ''); }

// 索引（メール / 電話 / 姓）。rows は readAll_().rows、c は colIndex_。行番号はシート上の行(添字+2)
function buildDupIndex_(rows, c) {
  var idx = { email: {}, tel: {}, sei: {}, info: {} };
  var add = function (map, key, rowNum) { if (!key) return; (map[key] = map[key] || []).push(rowNum); };
  rows.forEach(function (r, i) {
    var rowNum = i + 2;
    var sm = splitSeiMei_(r[c['氏名']], r[c['姓']], r[c['名']]);
    idx.info[rowNum] = { name: String(r[c['氏名']] || '').trim(), id: String(r[c['id']] || ''), sei: sm.sei, mei: sm.mei, co: normKey_(r[c['会社名']]) };
    add(idx.email, normKey_(r[c['メール']]), rowNum);
    [r[c['会社TEL']], r[c['携帯']]].forEach(function (t) { var d = digitsOnly_(t); if (d.length >= 6) add(idx.tel, d, rowNum); });
    add(idx.sei, sm.sei, rowNum);
  });
  return idx;
}

// (a)メール一致 (b)電話一致(携帯、またはどちらかの会社名が空。同社で姓名とも違う場合は除外) (c)姓一致かつ名が同字数で相違1字以下(名2字以上のとき。0字相違=表記ゆれのみ)
// 戻り値: [{row, name, reasons:[...]}]（自分自身 selfRow は除く）
function findDupCandidates_(rec, idx, selfRow) {
  var found = {};
  var hit = function (rowNum, reason) {
    if (rowNum === selfRow) return;
    var f = found[rowNum] || (found[rowNum] = { row: rowNum, name: idx.info[rowNum].name, reasons: [] });
    if (f.reasons.indexOf(reason) < 0) f.reasons.push(reason);
  };
  var em = normKey_(rec.email);
  if (em && idx.email[em]) idx.email[em].forEach(function (n) { hit(n, 'メール'); });
  var sm = splitSeiMei_(rec.name, rec.sei, rec.mei);
  var recCo = normKey_(rec.company);
  // 電話一致は「携帯番号(070/080/090)」か「どちらかの会社名が空」の場合だけ。
  // 同じ会社で姓も名も違う(同僚が代表番号を共有など)場合は付けない
  [rec.tel, rec.mobile].forEach(function (t) {
    var d = digitsOnly_(t);
    if (d.length < 6 || !idx.tel[d]) return;
    var isMobile = /^0[789]0/.test(d);
    idx.tel[d].forEach(function (n) {
      var o = idx.info[n];
      if (recCo && recCo === o.co && sm.sei !== o.sei && sm.mei !== o.mei) return;
      if (isMobile || !recCo || !o.co) hit(n, '電話');
    });
  });
  if (sm.sei && idx.sei[sm.sei]) {
    idx.sei[sm.sei].forEach(function (n) {
      var o = idx.info[n];
      if (o.mei.length !== sm.mei.length) return;
      var diff = 0;
      for (var i = 0; i < sm.mei.length; i++) if (sm.mei.charAt(i) !== o.mei.charAt(i)) diff++;
      if (diff === 0 || (diff === 1 && sm.mei.length >= 2)) hit(n, diff === 0 ? '同姓同名(表記ゆれ)' : '姓同一・名1字違い');
    });
  }
  return Object.keys(found).map(function (k) { return found[k]; }).sort(function (a, b) { return a.row - b.row; });
}

// 人物管理に「重複候補」タグ＋メモ追記（ロックは呼び出し側で取得済み前提。冪等）
function addDupTagToPerson_(personD, pIdxMap, contactId, candidates, nextNewRowRef) {
  var header = personD.header, rec = {}, rowNum;
  var stamp = nowStamp_();
  if (pIdxMap.hasOwnProperty(contactId)) {
    header.forEach(function (h, i2) { rec[h] = personD.rows[pIdxMap[contactId]][i2]; });
    rowNum = pIdxMap[contactId] + 2;
  } else {
    header.forEach(function (h) { rec[h] = ''; });
    rec.contactId = contactId; rec.organized = false; rec.createdAt = stamp;
    rowNum = nextNewRowRef.n++;
  }
  var tags = parseTags_(rec.tags);
  var memo = String(rec.memo == null ? '' : rec.memo);
  var changed = false;
  if (tags.indexOf(DUP_TAG) < 0) { tags.push(DUP_TAG); rec.tags = normalizeTags_(tags.join(',')); changed = true; }
  candidates.forEach(function (cand) {
    var line = DUP_TAG + ': 行' + cand.row + ' ' + cand.name;
    if (memo.indexOf(line) < 0) { memo += (memo ? '\n' : '') + line; changed = true; }
  });
  if (!changed) return false;
  rec.memo = memo; rec.updatedAt = stamp;
  writeSheetRow_(personD.sheet, header, rowNum, rec, personDateFields_());
  return true;
}

// 会社名なし名刺の重複判定。戻り値: 既存行の添字(rows内) / 見つからなければ undefined
function findNoCompanyDup_(rows, c, nameKey, email, tels) {
  var digits = function (v) { return String(v || '').replace(/\D/g, ''); };
  var newEmail = normKey_(email);
  var newTels = tels.map(digits).filter(function (x) { return x.length >= 6; });
  var hasContact = !!newEmail || newTels.length > 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (normKey_(r[c['氏名']]) !== nameKey && normKey_(r[c['姓']], r[c['名']]) !== nameKey) continue;
    if (!hasContact) {
      if (!String(r[c['会社名']] || '').trim()) return i;
      continue;
    }
    if (newEmail && normKey_(r[c['メール']]) === newEmail) return i;
    var exTels = [digits(r[c['会社TEL']]), digits(r[c['携帯']])];
    for (var k = 0; k < newTels.length; k++) {
      if (exTels.indexOf(newTels[k]) >= 0) return i;
    }
  }
  return undefined;
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
  var listThumbB64 = String(card.listThumb || '').trim(); // 一覧表示用サムネ(幅480px/JPEG70%)。base64はここではDriveに未保存

  if (!name) return { ok: false, error: 'missing_required' }; // 氏名が空なら拒否（会社名は空でも登録する）

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
    var dupIdx;
    if (company) {
      dupIdx = existingKeys[newKeyA];
      if (dupIdx === undefined) dupIdx = existingKeys[newKeyB];
    } else {
      // 会社名なし: 正規化氏名＋(メール or TEL/携帯 のいずれか一致)。連絡先が全く無ければ 正規化氏名＋会社名空 で判定
      dupIdx = findNoCompanyDup_(d.rows, c, normKey_(name), email, [tel, mobile]);
    }
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

    // 一覧表示用サムネ: base64をDrive(既存の私的フォルダ)に保存し、fileIdをthumbFileId列に記録
    if (listThumbB64) {
      try {
        var thumbName = (sourceFile ? sourceFile.replace(/\.[^.]+$/, '') : newId) + '_thumb.jpg';
        var thumbFileId = saveImageFile_(getImageFolder_(), thumbName, listThumbB64);
        if (c[THUMB_COL] === undefined) {
          sh.getRange(1, header.length + 1).setValue(THUMB_COL);
          header = header.slice();
          header.push(THUMB_COL);
        }
        record[THUMB_COL] = thumbFileId;
      } catch (e) {
        Logger.log('addCard: 一覧用サムネの保存に失敗（登録は継続）: ' + newId + ' ' + e);
      }
    }

    var row = header.map(function (h) {
      var key = String(h).trim();
      return record.hasOwnProperty(key) ? record[key] : '';
    });

    var newRowNum = sh.getLastRow() + 1;
    // 重複候補の判定は追記前の既存行に対して行う（索引でO(行数)。失敗しても登録は継続）
    var dupCands = [];
    try { dupCands = findDupCandidates_({ company: company, name: name, sei: sei, mei: mei, email: email, tel: tel, mobile: mobile }, buildDupIndex_(d.rows, c), -1); }
    catch (e) { Logger.log('addCard: 重複候補の判定に失敗（登録は継続）: ' + e); }
    sh.getRange(newRowNum, 1, 1, row.length).setValues([row]);
    if (dupCands.length) {
      try {
        setupSnsBulkColumns_();
        var pd = readSheet_(PERSON_SHEET), pm = {};
        pd.rows.forEach(function (r, i) { pm[String(r[pd.c['contactId']])] = i; });
        addDupTagToPerson_(pd, pm, newId, dupCands, { n: pd.sheet.getLastRow() + 1 });
      } catch (e) { Logger.log('addCard: 重複候補タグの付与に失敗（登録は継続）: ' + newId + ' ' + e); }
    }
    invalidateBootstrapCache_();
    var imageIds = null;
    if (card.images) {
      try { imageIds = saveCardImages_(newId, card.images); }
      catch (e) { Logger.log('addCard: 画像保存に失敗（登録は継続）: ' + newId + ' ' + e); }
    }
    return { ok: true, duplicate: false, row: newRowNum, id: newId, images: imageIds, dupCandidates: dupCands.length ? dupCands : undefined };
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
  // --- 会社名なしのケース（追記・重複判定・行削除まで自己完結） ---
  var nc = { company: '', name: '無所属 テスト花子', kana: 'Hanako', title: 'セラピスト', email: 'nc-test@example.com',
             tel: '', mobile: '090-9999-0001', source_file: '_test_nc.png' };
  var createdIds = [];
  var n1 = addCardToSheet(nc);
  checks.push({ name: 'nc_add_ok', ok: !!(n1.ok && !n1.duplicate), detail: JSON.stringify(n1) });
  if (n1.ok && !n1.duplicate) {
    createdIds.push(n1.id);
    var sh2 = getSheet_();
    var h2 = sh2.getRange(1, 1, 1, sh2.getLastColumn()).getValues()[0];
    var c2 = colIndex_(h2);
    var r2 = sh2.getRange(n1.row, 1, 1, h2.length).getValues()[0];
    checks.push({ name: 'nc_company_empty', ok: String(r2[c2['会社名']]).trim() === '' && String(r2[c2['氏名']]) === nc.name, detail: String(r2[c2['会社名']]) });
    checks.push({ name: 'nc_derived_empty_ok', ok: String(r2[c2['役職レベル']] == null ? '' : r2[c2['役職レベル']]) !== 'undefined', detail: String(r2[c2['業種']]) });
    var n2 = addCardToSheet(nc); // 同一メール → 重複
    checks.push({ name: 'nc_dup_same_email', ok: !!(n2.ok && n2.duplicate && n2.row === n1.row), detail: JSON.stringify(n2) });
    var nc2 = JSON.parse(JSON.stringify(nc)); nc2.email = ''; // メール無し・同一携帯 → 重複
    var n3 = addCardToSheet(nc2);
    checks.push({ name: 'nc_dup_same_mobile', ok: !!(n3.ok && n3.duplicate && n3.row === n1.row), detail: JSON.stringify(n3) });
    var nc3 = JSON.parse(JSON.stringify(nc)); nc3.email = 'other@example.com'; nc3.mobile = '090-9999-0002'; // 連絡先が全て異なる → 別人
    var n4 = addCardToSheet(nc3);
    checks.push({ name: 'nc_not_dup_other_contact', ok: !!(n4.ok && !n4.duplicate), detail: JSON.stringify(n4) });
    if (n4.ok && !n4.duplicate) createdIds.push(n4.id);
    var nc4 = { company: '', name: '無所属 テスト花子', source_file: '_test_nc2.png' }; // 連絡先なし → 氏名＋会社名空で重複
    var n5 = addCardToSheet(nc4);
    checks.push({ name: 'nc_dup_name_only', ok: !!(n5.ok && n5.duplicate), detail: JSON.stringify(n5) });
    if (n5.ok && !n5.duplicate) createdIds.push(n5.id);
  }
  // --- 重複候補タグ: (a)メール (b)電話 (c)姓同一・名1字違い(異体字含む) と「別人には付かない」 ---
  var dupIds = [];
  var dupTagsOf = function (id) {
    var pd = readSheet_(PERSON_SHEET), i = findRowByContactId_(pd, id);
    return i < 0 ? '' : String(pd.rows[i][pd.c['tags']] || '');
  };
  var dupMemoOf = function (id) {
    var pd = readSheet_(PERSON_SHEET), i = findRowByContactId_(pd, id);
    return i < 0 ? '' : String(pd.rows[i][pd.c['memo']] || '');
  };
  var base = addCardToSheet({ company: '甲社', name: '重複試験 太郎', email: 'dupbase@example.com', tel: '03-1111-2222', mobile: '090-1111-3333', source_file: '_dup0.png' });
  if (base.ok && !base.duplicate) {
    dupIds.push(base.id);
    checks.push({ name: 'dup_base_no_tag', ok: dupTagsOf(base.id).indexOf('重複候補') < 0, detail: dupTagsOf(base.id) });
    var ta = addCardToSheet({ company: '乙社', name: '全然違う 花', email: 'DUPBASE@example.com', source_file: '_dupa.png' }); // (a) メール一致
    if (ta.ok && !ta.duplicate) dupIds.push(ta.id);
    checks.push({ name: 'dup_a_email', ok: !!(ta.ok && !ta.duplicate && dupTagsOf(ta.id).indexOf('重複候補') >= 0 && dupMemoOf(ta.id).indexOf('重複候補: 行' + base.row + ' 重複試験 太郎') >= 0), detail: dupTagsOf(ta.id) + ' | ' + dupMemoOf(ta.id) });
    var tb = addCardToSheet({ company: '丙社', name: '別名 次郎', mobile: '090(1111)3333', source_file: '_dupb.png' }); // (b) 携帯一致(数字のみ。会社違い・氏名違いでも付く)
    if (tb.ok && !tb.duplicate) dupIds.push(tb.id);
    checks.push({ name: 'dup_b_mobile_tag', ok: !!(tb.ok && dupTagsOf(tb.id).indexOf('重複候補') >= 0), detail: dupTagsOf(tb.id) });
    var tb2 = addCardToSheet({ company: '丙社', name: '三田 三郎', tel: '03(1111)2222', source_file: '_dupb2.png' }); // 固定電話一致・両社とも会社名あり → 付かない
    if (tb2.ok && !tb2.duplicate) dupIds.push(tb2.id);
    checks.push({ name: 'dup_b_landline_with_companies_no_tag', ok: !!(tb2.ok && dupTagsOf(tb2.id).indexOf('重複候補') < 0), detail: dupTagsOf(tb2.id) });
    var tb3 = addCardToSheet({ company: '甲社', name: '四方 史朗', tel: '03-1111-2222', source_file: '_dupb3.png' }); // 同社の同僚が代表番号を共有 → 付かない
    if (tb3.ok && !tb3.duplicate) dupIds.push(tb3.id);
    checks.push({ name: 'dup_b_same_company_colleague_no_tag', ok: !!(tb3.ok && dupTagsOf(tb3.id).indexOf('重複候補') < 0), detail: dupTagsOf(tb3.id) });
    var tb4 = addCardToSheet({ company: '', name: '無所属 五郎', tel: '03-1111-2222', source_file: '_dupb4.png' }); // 会社名なし側 + 固定電話一致 → 付く
    if (tb4.ok && !tb4.duplicate) dupIds.push(tb4.id);
    checks.push({ name: 'dup_b_landline_company_empty_tag', ok: !!(tb4.ok && dupTagsOf(tb4.id).indexOf('重複候補') >= 0), detail: dupTagsOf(tb4.id) });
    var tc = addCardToSheet({ company: '丁社', name: '重複試験 太朗', source_file: '_dupc.png' }); // (c) 姓同一・名1字違い
    if (tc.ok && !tc.duplicate) dupIds.push(tc.id);
    checks.push({ name: 'dup_c_one_char', ok: !!(tc.ok && dupTagsOf(tc.id).indexOf('重複候補') >= 0), detail: dupTagsOf(tc.id) });
    var tv1 = addCardToSheet({ company: '戊社', name: '髙橋 重複子', source_file: '_dupv1.png' });
    if (tv1.ok && !tv1.duplicate) dupIds.push(tv1.id);
    var tv2 = addCardToSheet({ company: '己社', name: '高橋 重複子', source_file: '_dupv2.png' }); // 異体字は同一扱い
    if (tv2.ok && !tv2.duplicate) dupIds.push(tv2.id);
    checks.push({ name: 'dup_c_variant', ok: !!(tv2.ok && dupTagsOf(tv2.id).indexOf('重複候補') >= 0), detail: dupTagsOf(tv2.id) });
    var tn1 = addCardToSheet({ company: '庚社', name: '重複試験 花子', source_file: '_dupn1.png' }); // 名2字違い → 別人
    if (tn1.ok && !tn1.duplicate) dupIds.push(tn1.id);
    checks.push({ name: 'dup_other_person_no_tag', ok: !!(tn1.ok && dupTagsOf(tn1.id).indexOf('重複候補') < 0), detail: dupTagsOf(tn1.id) });
    var tn2 = addCardToSheet({ company: '辛社', name: '別姓 太郎', email: 'someone@example.com', tel: '06-9999-8888', source_file: '_dupn2.png' }); // 姓違い・連絡先違い
    if (tn2.ok && !tn2.duplicate) dupIds.push(tn2.id);
    checks.push({ name: 'dup_other_person_no_tag2', ok: !!(tn2.ok && dupTagsOf(tn2.id).indexOf('重複候補') < 0), detail: dupTagsOf(tn2.id) });
  } else {
    checks.push({ name: 'dup_base_added', ok: false, detail: JSON.stringify(base) });
  }
  if (dupIds.length) { deleteTestRows_(dupIds); Logger.log('削除(重複候補テスト): ' + dupIds.join(',')); }

  var n6 = addCardToSheet({ company: 'テスト株式会社', name: '' });
  checks.push({ name: 'name_empty_rejected', ok: !!(n6 && n6.ok === false && n6.error === 'missing_required'), detail: JSON.stringify(n6) });
  if (createdIds.length) {
    deleteTestRows_(createdIds);
    Logger.log('削除(会社名なしテスト): ' + createdIds.join(','));
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
  [BATCH_COL].concat(IMAGE_COLS).concat([THUMB_COL]).forEach(function (col) {
    if (cardsC[col] !== undefined) return;
    cardsSh.getRange(1, cardsHeaderVals.length + 1).setValue(col);
    cardsHeaderVals = cardsHeaderVals.concat([col]);
    cardsC[col] = cardsHeaderVals.length - 1;
    added.push(col);
  });

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
  var total = 0;
  var deletedSet = {};

  var newIds = {};
  cardsD.rows.forEach(function (r) {
    if (isDeletedRow_(r, cc)) { deletedSet[String(r[cc['id']])] = true; return; }
    total++;
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
  var followCount = Object.keys(followDueSet_(pm, hm)).filter(function (id) { return !deletedSet[id]; }).length;
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
    if (isDeletedRow_(r, c)) return;
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
 *  名刺画像（Drive 非公開フォルダに保存し、認証付き action でのみ配信）
 * ================================================================== */
// 冪等: Drive に meishi-images フォルダを用意し、ID をスクリプトプロパティに保存する（共有設定は変更しない）
function setupImageFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(IMAGE_FOLDER_PROP);
  if (id) {
    try { DriveApp.getFolderById(id); return id; } catch (e) { /* 消えている場合は作り直す */ }
  }
  var it = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(IMAGE_FOLDER_NAME);
  id = folder.getId();
  props.setProperty(IMAGE_FOLDER_PROP, id);
  Logger.log('画像フォルダ: ' + IMAGE_FOLDER_NAME + ' (' + id + ')');
  return id;
}
function getImageFolder_() { return DriveApp.getFolderById(setupImageFolder_()); }

// base64(JPEG) を Drive に保存して fileId を返す
function saveImageFile_(folder, name, b64) {
  var bytes = Utilities.base64Decode(String(b64 || ''));
  if (!bytes || !bytes.length) throw new Error('empty image: ' + name);
  var blob = Utilities.newBlob(bytes, 'image/jpeg', name);
  return folder.createFile(blob).getId();
}
function trashFile_(id) {
  if (!id) return;
  try { DriveApp.getFileById(String(id)).setTrashed(true); } catch (e) { /* noop */ }
}
// images = {front:{full,thumb}, back?:{full,thumb}} を保存し、名刺DB の画像4列に fileId を書く。
// 既に fileId がある列を上書きする場合は旧ファイルをゴミ箱へ。戻り値は4列の fileId。
function saveCardImages_(contactId, images) {
  images = images || {};
  var d = readCards_(['id'].concat(IMAGE_COLS)), c = colIndex_(d.header);
  var rowIdx = -1;
  for (var i = 0; i < d.rows.length; i++) { if (String(d.rows[i][c['id']]) === contactId) { rowIdx = i; break; } }
  if (rowIdx < 0) throw new Error('not_found: ' + contactId);
  if (IMAGE_COLS.some(function (col) { return c[col] === undefined; })) {
    setupSnsBulkColumns_();
    d = readCards_(['id'].concat(IMAGE_COLS)); c = colIndex_(d.header);
  }
  var folder = getImageFolder_();
  var sh = getSheet_();
  var cur = d.rows[rowIdx];
  var out = {};
  var plan = [
    ['imageFrontId', images.front && images.front.full, '_front.jpg'],
    ['imageFrontThumbId', images.front && images.front.thumb, '_front_thumb.jpg'],
    ['imageBackId', images.back && images.back.full, '_back.jpg'],
    ['imageBackThumbId', images.back && images.back.thumb, '_back_thumb.jpg']
  ];
  var any = false;
  plan.forEach(function (pl) {
    var col = pl[0], b64 = pl[1], suffix = pl[2];
    var oldId = String(cur[c[col]] || '');
    if (!b64) { out[col] = oldId; return; }
    var newId = saveImageFile_(folder, contactId + suffix, b64);
    sh.getRange(rowIdx + 2, c[col] + 1).setValue(newId);
    if (oldId && oldId !== newId) trashFile_(oldId);
    out[col] = newId;
    any = true;
  });
  if (!any) throw new Error('no_images');
  return out;
}

// 既存行に画像だけ後付け（バックフィル用）
function attachImages_(input) {
  input = input || {};
  var id = String(input.contactId || input.id || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  var images = input.images || {};
  var hasAny = (images.front && (images.front.full || images.front.thumb)) || (images.back && (images.back.full || images.back.thumb));
  if (!hasAny) return { ok: false, error: 'no_images' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ids;
    try { ids = saveCardImages_(id, images); }
    catch (e) {
      var msg = String(e);
      if (msg.indexOf('not_found') >= 0) return { ok: false, error: 'not_found' };
      if (msg.indexOf('no_images') >= 0) return { ok: false, error: 'no_images' };
      Logger.log('attachImages: ' + id + ' ' + msg);
      return { ok: false, error: 'drive_error' };
    }
    return { ok: true, data: { contactId: id, imageFrontId: ids.imageFrontId || '', imageFrontThumbId: ids.imageFrontThumbId || '', imageBackId: ids.imageBackId || '', imageBackThumbId: ids.imageBackThumbId || '' } };
  } finally {
    lock.releaseLock();
  }
}

// 画像を base64 で返す（認証済みの人しか呼べない。fileId が無ければ image:null）
function cardImage_(input) {
  input = input || {};
  var id = String(input.contactId || input.id || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  var side = input.side === 'back' ? 'back' : 'front';
  var size = input.size === 'full' ? 'full' : 'thumb';
  var d = readCards_(['id'].concat(IMAGE_COLS)), c = colIndex_(d.header);
  var row = null;
  for (var i = 0; i < d.rows.length; i++) { if (String(d.rows[i][c['id']]) === id) { row = d.rows[i]; break; } }
  if (!row) return { ok: false, error: 'not_found' };
  var g = function (col) { return c[col] !== undefined ? String(row[c[col]] || '').trim() : ''; };
  var hasFront = !!(g('imageFrontId') || g('imageFrontThumbId'));
  var hasBack = !!(g('imageBackId') || g('imageBackThumbId'));
  var col = (side === 'front' ? 'imageFront' : 'imageBack') + (size === 'full' ? 'Id' : 'ThumbId');
  var fileId = g(col);
  // サムネが無く full だけある（またはその逆）場合はもう一方で代替
  if (!fileId) fileId = g((side === 'front' ? 'imageFront' : 'imageBack') + (size === 'full' ? 'ThumbId' : 'Id'));
  if (!fileId) return { ok: true, data: { image: null, mime: 'image/jpeg', hasFront: hasFront, hasBack: hasBack } };
  try {
    var blob = DriveApp.getFileById(fileId).getBlob();
    return { ok: true, data: { image: Utilities.base64Encode(blob.getBytes()), mime: blob.getContentType() || 'image/jpeg', hasFront: hasFront, hasBack: hasBack } };
  } catch (e) {
    Logger.log('cardImage: 取得失敗 ' + id + ' ' + col + ' ' + e);
    return { ok: true, data: { image: null, mime: 'image/jpeg', hasFront: hasFront, hasBack: hasBack, error: 'drive_error' } };
  }
}

// 画像未登録で備考に元ファイル名（scan:<name>）がある人物の一覧（バックフィル用）
function cardsWithoutImage_() {
  var d = readCards_(['id', '備考', 'imageFrontId', 'imageFrontThumbId', DELETED_COL]), c = colIndex_(d.header);
  var items = [];
  if (c['備考'] === undefined) return { items: items };
  d.rows.forEach(function (r) {
    if (isDeletedRow_(r, c)) return;
    var front = c['imageFrontId'] !== undefined ? String(r[c['imageFrontId']] || '').trim() : '';
    var thumb = c['imageFrontThumbId'] !== undefined ? String(r[c['imageFrontThumbId']] || '').trim() : '';
    if (front || thumb) return;
    var biko = String(r[c['備考']] || '');
    var m = biko.match(/^scan:([^\/]+?)(?:\s*\/|$)/);
    if (!m) return;
    var name = m[1].trim();
    if (!name) return;
    items.push({ contactId: String(r[c['id']]), sourceFile: name });
  });
  return { items: items };
}

// 一覧用サムネ(thumbFileId)が未登録で備考に元ファイル名(scan:<name>)がある人物の一覧（backfill用）
function cardsWithoutThumb_() {
  var d = readCards_(['id', '備考', THUMB_COL, DELETED_COL]), c = colIndex_(d.header);
  var items = [];
  if (c['備考'] === undefined) return { items: items };
  d.rows.forEach(function (r) {
    if (isDeletedRow_(r, c)) return;
    var thumb = c[THUMB_COL] !== undefined ? String(r[c[THUMB_COL]] || '').trim() : '';
    if (thumb) return;
    var biko = String(r[c['備考']] || '');
    var m = biko.match(/^scan:([^\/]+?)(?:\s*\/|$)/);
    if (!m) return;
    var name = m[1].trim();
    if (!name) return;
    items.push({ contactId: String(r[c['id']]), sourceFile: name });
  });
  return { items: items };
}

// 1x1 JPEG（テスト用ダミー画像）
var TEST_JPEG_B64_ = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
// 画像テスト: (a) attachImages → 4列に fileId (b) cardImage thumb/full が返る (c) fileId 空で image:null。テスト行・ファイルは削除
function test_image_() {
  var checks = [];
  var testIds = [], fileIds = [];
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
    var idA = 'M' + ('00000' + (lastNum + 1)).slice(-5);
    var idB = 'M' + ('00000' + (lastNum + 2)).slice(-5);
    testIds.push(idA, idB);
    var mk = function (id, nm) {
      var record = { 'id': id, '会社名': 'テスト株式会社_image', '氏名': nm, '姓': 'テスト', '名': nm.split(' ')[1], '取込日': today, 'importBatchId': 'test-image', '備考': 'scan:_test_' + id + '.jpg / メモ' };
      return header.map(function (h) { return record.hasOwnProperty(h) ? record[h] : ''; });
    };
    var startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, 2, header.length).setValues([mk(idA, 'テスト 画像あり'), mk(idB, 'テスト 画像なし')]);

    var images = { front: { full: TEST_JPEG_B64_, thumb: TEST_JPEG_B64_ }, back: { full: TEST_JPEG_B64_, thumb: TEST_JPEG_B64_ } };
    var r1 = attachImages_({ contactId: idA, images: images });
    checks.push({ name: 'attach_ok', ok: !!r1.ok, detail: JSON.stringify(r1) });
    if (r1.ok) {
      IMAGE_COLS.forEach(function (col) { if (r1.data[col]) fileIds.push(r1.data[col]); });
      checks.push({ name: 'attach_4_ids', ok: IMAGE_COLS.every(function (col) { return !!r1.data[col]; }), detail: JSON.stringify(r1.data) });
      var d2 = readCards_(['id'].concat(IMAGE_COLS)), c2 = colIndex_(d2.header);
      var rowA = d2.rows.filter(function (r) { return String(r[c2['id']]) === idA; })[0];
      checks.push({ name: 'sheet_4_cols_set', ok: !!rowA && IMAGE_COLS.every(function (col) { return !!String(rowA[c2[col]] || ''); }), detail: rowA ? JSON.stringify(IMAGE_COLS.map(function (col) { return rowA[c2[col]]; })) : 'row missing' });
    }
    var t1 = cardImage_({ contactId: idA, side: 'front', size: 'thumb' });
    checks.push({ name: 'cardImage_thumb', ok: t1.ok && !!t1.data.image && t1.data.hasFront && t1.data.hasBack, detail: JSON.stringify({ ok: t1.ok, len: t1.ok && t1.data.image ? t1.data.image.length : 0, mime: t1.ok ? t1.data.mime : '' }) });
    var t2 = cardImage_({ contactId: idA, side: 'back', size: 'full' });
    checks.push({ name: 'cardImage_full_back', ok: t2.ok && !!t2.data.image, detail: JSON.stringify({ ok: t2.ok, len: t2.ok && t2.data.image ? t2.data.image.length : 0 }) });
    var t3 = cardImage_({ contactId: idB, side: 'front', size: 'thumb' });
    checks.push({ name: 'cardImage_none_is_null', ok: t3.ok && t3.data.image === null && t3.data.hasFront === false, detail: JSON.stringify(t3) });
    var w = cardsWithoutImage_();
    var wb = w.items.filter(function (x) { return x.contactId === idB; })[0];
    var wa = w.items.filter(function (x) { return x.contactId === idA; })[0];
    checks.push({ name: 'withoutImage_lists_B_only', ok: !!wb && wb.sourceFile === '_test_' + idB + '.jpg' && !wa, detail: JSON.stringify({ wa: wa, wb: wb }) });
    var r2 = attachImages_({ contactId: 'M99999', images: images });
    checks.push({ name: 'attach_not_found', ok: !r2.ok && r2.error === 'not_found', detail: JSON.stringify(r2) });
    var r3 = attachImages_({ contactId: idB, images: {} });
    checks.push({ name: 'attach_no_images', ok: !r3.ok && r3.error === 'no_images', detail: JSON.stringify(r3) });
  } catch (e) {
    checks.push({ name: 'exception', ok: false, detail: String(e) });
  } finally {
    fileIds.forEach(trashFile_);
    deleteTestRows_(testIds);
  }
  var pass = checks.length > 0 && checks.every(function (x) { return x.ok; });
  var result = { pass: pass, checks: checks };
  Logger.log(JSON.stringify(result));
  return result;
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
  bumpListVersion_();
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
function bootCachePut_(key, data, ttlSec) {
  try {
    var json = JSON.stringify(data);
    var v = 'js:' + json;
    if (v.length > BOOT_CACHE_MAX) {
      v = 'gz:' + Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json)).getBytes());
    }
    if (v.length > BOOT_CACHE_MAX) return false; // 圧縮しても入らない: キャッシュせず継続
    CacheService.getScriptCache().put(key, v, ttlSec || BOOT_CACHE_SEC);
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
 *  Eight風UI: 軽量リスト（listLite / listDelta）＋ サムネ配信（getThumbs / setThumb）
 * ================================================================== */
// version = PropertiesServiceで管理する単調増加カウンタ(ミリ秒タイムスタンプ)。
// DriveApp.getLastUpdated()は別サービス呼び出しで数秒かかることがあるため使わない。
// 名刺DBを書き換えるactionは全てinvalidateBootstrapCache_()経由でbumpListVersion_()を呼ぶ。
var LIST_VERSION_PROP = 'LIST_VERSION';
function listLiteVersion_() {
  var p = PropertiesService.getScriptProperties();
  var v = p.getProperty(LIST_VERSION_PROP);
  if (!v) { v = String(Date.now()); p.setProperty(LIST_VERSION_PROP, v); }
  return v;
}
function bumpListVersion_() {
  try { PropertiesService.getScriptProperties().setProperty(LIST_VERSION_PROP, String(Date.now())); } catch (e) { /* noop */ }
}
// キー名は短縮。フロントで展開して検索用文字列を1回だけ作る。空の項目はキーごと省略して転送量を抑える。
//   id,n(氏名),c(会社),t(役職),d(交換日),th(サムネ)
//   k(よみ=備考の「かな:」),e(メール),p(電話=会社TEL+携帯を数字のみに),a(都道府県+市区),
//   i(業種),ev(接触履歴のイベント名・重複除去、スペース区切り),tg(タグ名の配列)
// 削除済み(deletedAt あり)の行は items に含めず、id を deletedIds に集める。
function buildListLite_() {
  var d = readCards_(['id', '氏名', '会社名', '役職', '名刺交換日', THUMB_COL, 'メール', '会社TEL', '携帯',
    '都道府県', '市区町村', '業種', '備考', DELETED_COL]);
  var c = colIndex_(d.header);
  var pm = loadPersonMap_(), hm = loadHistoryMap_();
  var evById = {};
  Object.keys(hm.byId).forEach(function (id) {
    var seen = {}, names = [];
    hm.byId[id].forEach(function (r) {
      var en = String(r[hm.c['eventName']] || '').trim();
      if (en && !seen[en]) { seen[en] = true; names.push(en); }
    });
    if (names.length) evById[id] = names.join(' ');
  });
  var S = function (r, name) { return c[name] !== undefined ? String(r[c[name]] == null ? '' : r[c[name]]) : ''; };
  var items = [], deletedIds = [];
  d.rows.forEach(function (r) {
    var id = String(r[c['id']] || '');
    if (isDeletedRow_(r, c)) { if (id) deletedIds.push(id); return; }
    var o = {
      id: id,
      n: String(r[c['氏名']] || ''),
      c: String(r[c['会社名']] || ''),
      t: String(r[c['役職']] || ''),
      d: pickExchangedFast_(r[c['名刺交換日']]),
      th: c[THUMB_COL] !== undefined ? String(r[c[THUMB_COL]] || '') : ''
    };
    var km = S(r, '備考').match(/かな:(.*)$/);
    if (km && km[1].trim()) o.k = km[1].trim();
    var em = S(r, 'メール').trim(); if (em) o.e = em;
    var tel = (S(r, '会社TEL').replace(/\D/g, '') + ' ' + S(r, '携帯').replace(/\D/g, '')).trim(); if (tel) o.p = tel;
    var ad = (S(r, '都道府県') + S(r, '市区町村')).trim(); if (ad) o.a = ad;
    var ind = S(r, '業種').trim(); if (ind) o.i = ind;
    if (evById[id]) o.ev = evById[id];
    var pr = pm.byId[id];
    if (pr) { var tg = parseTags_(pr[pm.c['tags']]); if (tg.length) o.tg = tg; }
    items.push(o);
  });
  return { items: items, deletedIds: deletedIds };
}
// 3,862件だと数百KBになりCacheServiceの1値100KB上限に収まらない(gzipしても収まらないことが多い)ため、
// 無駄なgzip試行で実行時間を浪費しないようキャッシュはせず毎回シートから組み立てる。
function listLiteData_() {
  var b = buildListLite_();
  return { items: b.items, deletedIds: b.deletedIds, version: listLiteVersion_() };
}
function listLite_(body) {
  var d = listLiteData_();
  return { ok: true, data: { items: d.items, deletedIds: d.deletedIds, version: d.version } };
}
function listDelta_(body) {
  var since = String((body && body.sinceVersion) || '');
  var version = listLiteVersion_();
  if (since && since === version) return { ok: true, data: { changed: false, version: version } };
  var d = listLiteData_();
  return { ok: true, data: { changed: true, items: d.items, deletedIds: d.deletedIds, version: d.version } };
}
// ids(最大30) → {id: base64jpeg}。id は listLite が返す thumbFileId（既存の私的Driveフォルダのファイル）
function getThumbs_(body) {
  var ids = Array.isArray(body && body.ids) ? body.ids : [];
  ids = ids.slice(0, THUMB_MAX_IDS).map(function (x) { return String(x || '').trim(); }).filter(function (x) { return x; });
  var out = {};
  ids.forEach(function (fid) {
    try {
      var blob = DriveApp.getFileById(fid).getBlob();
      out[fid] = Utilities.base64Encode(blob.getBytes());
    } catch (e) {
      Logger.log('getThumbs: 取得失敗 ' + fid + ' ' + e);
    }
  });
  return { ok: true, data: out };
}
// id(名刺DBのcontactId) + thumbFileId(既知のDriveファイルID) または thumbB64(未保存のbase64、
// この場合はここでDriveへ保存してfileIdを得る)を受けて thumbFileId 列に書き込む（backfill用）
function setThumb_(body) {
  var id = String((body && (body.id || body.contactId)) || '').trim();
  var thumbFileId = String((body && body.thumbFileId) || '').trim();
  var thumbB64 = String((body && body.thumbB64) || '').trim();
  if (!id || (!thumbFileId && !thumbB64)) return { ok: false, error: 'missing_params' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var d = readCards_(['id']), c = colIndex_(d.header);
    var rowIdx = -1;
    for (var i = 0; i < d.rows.length; i++) { if (String(d.rows[i][c['id']]) === id) { rowIdx = i; break; } }
    if (rowIdx < 0) return { ok: false, error: 'not_found' };
    if (!thumbFileId) {
      var thumbName = String((body && body.sourceFile) || id).replace(/\.[^.]+$/, '') + '_thumb.jpg';
      thumbFileId = saveImageFile_(getImageFolder_(), thumbName, thumbB64);
    }
    var sh = getSheet_();
    var lastCol = sh.getLastColumn();
    var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var c2 = colIndex_(header);
    if (c2[THUMB_COL] === undefined) {
      sh.getRange(1, header.length + 1).setValue(THUMB_COL);
      c2[THUMB_COL] = header.length;
    }
    sh.getRange(rowIdx + 2, c2[THUMB_COL] + 1).setValue(thumbFileId);
    invalidateBootstrapCache_();
    return { ok: true, data: { thumbFileId: thumbFileId } };
  } finally {
    lock.releaseLock();
  }
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
    if (isDeletedRow_(r, c)) return false;
    if (batchId) return c[BATCH_COL] !== undefined && String(r[c[BATCH_COL]] || '') === batchId;
    var iso = isoDate_(r[c['取込日']]);
    return !!iso && iso >= windowStart && iso <= today;
  };

  var targets = [];
  if (scope === 'ids') {
    var idSet = {};
    (input.ids || []).forEach(function (x) { idSet[String(x)] = true; });
    d.rows.forEach(function (r, idx) { if (idSet[String(r[c['id']])] && !isDeletedRow_(r, c)) targets.push({ row: idx + 2, r: r }); });
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

    // 適用と同時に整理済みにする（既存の markOrganized と同じ人物管理の organized 更新を、対象IDにまとめて適用）
    var organizedCount = 0;
    if (input.markOrganized) {
      var personD = readSheet_(PERSON_SHEET);
      var pHeader = personD.header, pIdx = {};
      personD.rows.forEach(function (r, i) { pIdx[String(r[personD.c['contactId']])] = i; });
      var nextNew = personD.sheet.getLastRow() + 1;
      var stamp = nowStamp_();
      t.targets.forEach(function (x) {
        var id = String(x.r[c['id']]);
        var rec = {}, rowNum;
        if (pIdx.hasOwnProperty(id)) {
          pHeader.forEach(function (h, i2) { rec[h] = personD.rows[pIdx[id]][i2]; });
          rowNum = pIdx[id] + 2;
        } else {
          pHeader.forEach(function (h) { rec[h] = ''; });
          rec.contactId = id; rec.createdAt = stamp;
          rowNum = nextNew++;
        }
        rec.organized = true; rec.updatedAt = stamp;
        writeSheetRow_(personD.sheet, pHeader, rowNum, rec, personDateFields_());
        organizedCount++;
      });
    }

    invalidateBootstrapCache_();
    var label = formatContactLabel_(eventName, iso);
    Logger.log('bulkContactApply: ' + t.targets.length + '件 / 交換日更新 ' + updatedDateCount + ' / 履歴作成 ' + createdHistoryCount + ' / 重複 ' + skippedDupCount + ' / ' + (Date.now() - t0) + 'ms');
    return { ok: true, data: { targetCount: t.targets.length, updatedDateCount: updatedDateCount, createdHistoryCount: createdHistoryCount, skippedDupCount: skippedDupCount, label: label, organizedCount: organizedCount } };
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

    // 整理済みフラグ: 指定なしでは触らず、markOrganized:true で対象IDだけ organized=true になる
    var orgOf = function (id) {
      var pd = readSheet_(PERSON_SHEET), i = findRowByContactId_(pd, id);
      return i < 0 ? null : isTrue_(pd.rows[i][pd.c['organized']]);
    };
    checks.push({ name: 'organized_untouched_without_flag', ok: orgOf(ids[0]) !== true, detail: String(orgOf(ids[0])) });
    var res3 = bulkContactApply_({ scope: 'ids', ids: [ids[0], ids[1]], date: '2026/09/08', eventName: 'テストイベント', overwrite: false, markOrganized: true });
    checks.push({ name: 'organized_count_2', ok: res3.ok && res3.data.organizedCount === 2, detail: JSON.stringify(res3) });
    checks.push({ name: 'organized_flag_applied', ok: orgOf(ids[0]) === true && orgOf(ids[1]) === true, detail: String(orgOf(ids[0])) + '/' + String(orgOf(ids[1])) });
    checks.push({ name: 'organized_other_untouched', ok: orgOf(ids[2]) !== true, detail: String(orgOf(ids[2])) });

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

/* ==================================================================
 *  一時関数: Eight風UI改修前のスプレッドシート丸ごとバックアップ
 *  GASエディタで runBackupSheet を選択して手動実行する。完了後は両方削除してよい。
 *  （backupSheet_は末尾_のためprivate扱いとなりエディタの実行ドロップダウンに出ない）
 * ================================================================== */
function backupSheet_() {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  var copy = DriveApp.getFileById(SPREADSHEET_ID).makeCopy('名刺DB_backup_' + stamp);
  Logger.log('バックアップ作成: ' + copy.getName() + ' (' + copy.getId() + ')');
  return copy.getId();
}
function runBackupSheet() { return backupSheet_(); }


/* ==================================================================
 *  メモ・履歴の本文検索（searchText）
 * ================================================================== */
// フロントの正規化(NFKC→小文字→カタカナをひらがな→空白・ハイフン・括弧除去)と同じ手順
function normSearch_(s) {
  s = String(s == null ? '' : s);
  try { s = s.normalize('NFKC'); } catch (e) { /* noop */ }
  s = s.toLowerCase().replace(/[ァ-ヶ]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0x60); });
  return s.replace(/[\s　()\[\]{}<>「」『』【】〔〕〈〉《》\-‐-―−－]/g, '');
}
// 接触履歴(memo/eventName)・人物管理(memo/needs/nextAction)の本文を部分一致で検索し、名刺IDの配列だけ返す。
// スペース区切りの複数語は AND（名刺ごとに本文をまとめて判定）。上限200件。削除済み名刺は除外。
function searchText_(body) {
  var raw = String((body && body.q) || '').trim();
  if (!raw) return { ok: true, data: { ids: [], limited: false } };
  var words = raw.split(/[\s　]+/).map(normSearch_).filter(function (w) { return w; });
  if (!words.length) return { ok: true, data: { ids: [], limited: false } };
  var blobs = {}, order = [];
  var add = function (id, text) {
    if (!id || !text) return;
    if (blobs[id] === undefined) { blobs[id] = []; order.push(id); }
    blobs[id].push(normSearch_(text));
  };
  var hm = loadHistoryMap_();
  Object.keys(hm.byId).forEach(function (id) {
    hm.byId[id].forEach(function (r) {
      add(id, String(r[hm.c['memo']] || '') + ' ' + String(r[hm.c['eventName']] || ''));
    });
  });
  var pm = loadPersonMap_();
  pm.rows.forEach(function (r) {
    var id = String(r[pm.c['contactId']]);
    ['memo', 'needs', 'nextAction'].forEach(function (f) {
      if (pm.c[f] !== undefined) add(id, String(r[pm.c[f]] || ''));
    });
  });
  var cd = readCards_(['id', DELETED_COL]), cc = colIndex_(cd.header);
  var alive = {};
  cd.rows.forEach(function (r) { if (!isDeletedRow_(r, cc)) alive[String(r[cc['id']])] = true; });
  var ids = [], limited = false;
  for (var i = 0; i < order.length; i++) {
    var id = order[i];
    if (!alive[id]) continue;
    var text = blobs[id].join(' ');
    var ok = words.every(function (w) { return text.indexOf(w) >= 0; });
    if (!ok) continue;
    if (ids.length >= RESULT_LIMIT) { limited = true; break; }
    ids.push(id);
  }
  return { ok: true, data: { ids: ids, limited: limited } };
}

/* ==================================================================
 *  削除（ゴミ箱方式）: deleteCards / restoreCards / listTrash / purgeCards
 *  論理削除 = 名刺DB末尾 deletedAt 列に日時を入れる。purge だけが行・履歴・画像に触る。
 *  書き込み系は LockService で直列化し、完了後に bootstrap キャッシュ破棄＋一覧 version を更新する。
 * ================================================================== */
var PURGE_MAX_IDS = 100; // 1回の purgeCards で処理する最大件数（行削除が重いため）

// deletedAt 列が無ければ末尾に追加し、列全体をプレーンテキスト書式にする。0始まりの列番号を返す
function ensureDeletedCol_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var c = colIndex_(header);
  if (c[DELETED_COL] !== undefined) return c[DELETED_COL];
  sh.getRange(1, header.length + 1).setValue(DELETED_COL);
  sh.getRange(1, header.length + 1, Math.max(sh.getMaxRows(), 2), 1).setNumberFormat('@');
  return header.length;
}
// GASエディタから手動実行用（列だけ先に作る。deleteCards でも自動作成されるので必須ではない）
function setupDeletedColumn() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var idx = ensureDeletedCol_(getSheet_());
    Logger.log('deletedAt 列: ' + (idx + 1) + ' 列目');
    return idx + 1;
  } finally { lock.releaseLock(); }
}
function idsFromBody_(body, max) {
  var arr = Array.isArray(body && body.ids) ? body.ids : [];
  var seen = {}, out = [];
  arr.forEach(function (x) { var s = String(x == null ? '' : x).trim(); if (s && !seen[s]) { seen[s] = true; out.push(s); } });
  return max ? out.slice(0, max) : out;
}

// 論理削除/復元の共通処理。value = 日時 or ''
function setDeletedAt_(ids, value) {
  var sh = getSheet_();
  var col = ensureDeletedCol_(sh);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { changed: 0, notFound: ids.length, skipped: 0 };
  var n = lastRow - 1;
  var idHeader = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var idCol = colIndex_(idHeader)['id'];
  var idVals = sh.getRange(2, idCol + 1, n, 1).getValues();
  var delRange = sh.getRange(2, col + 1, n, 1);
  var delVals = delRange.getValues();
  var want = {}; ids.forEach(function (x) { want[x] = true; });
  var changed = 0, skipped = 0, found = {};
  for (var i = 0; i < n; i++) {
    var id = String(idVals[i][0]);
    if (!want[id]) continue;
    found[id] = true;
    var cur = String(delVals[i][0] == null ? '' : delVals[i][0]).trim();
    if (value === '' ? cur === '' : cur !== '') { skipped++; continue; } // 既に目的の状態
    delVals[i][0] = value;
    changed++;
  }
  if (changed) delRange.setValues(delVals);
  var notFound = ids.filter(function (x) { return !found[x]; }).length;
  return { changed: changed, notFound: notFound, skipped: skipped };
}
function deleteCards_(body) {
  var ids = idsFromBody_(body, 500);
  if (!ids.length) return { ok: false, error: 'missing_ids' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var r = setDeletedAt_(ids, nowStamp_());
    invalidateBootstrapCache_();
    return { ok: true, data: { deleted: r.changed, notFound: r.notFound, alreadyDeleted: r.skipped } };
  } finally { lock.releaseLock(); }
}
function restoreCards_(body) {
  var ids = idsFromBody_(body, 500);
  if (!ids.length) return { ok: false, error: 'missing_ids' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var r = setDeletedAt_(ids, '');
    invalidateBootstrapCache_();
    return { ok: true, data: { restored: r.changed, notFound: r.notFound } };
  } finally { lock.releaseLock(); }
}
// ゴミ箱の一覧 {id,n,c,t,deletedAt}（新しく削除した順）
function listTrash_(body) {
  var d = readCards_(['id', '氏名', '会社名', '役職', DELETED_COL]), c = colIndex_(d.header);
  var items = [];
  d.rows.forEach(function (r) {
    if (!isDeletedRow_(r, c)) return;
    var v = r[c[DELETED_COL]];
    var at = v instanceof Date ? Utilities.formatDate(v, 'JST', 'yyyy-MM-dd HH:mm:ss') : String(v).trim();
    items.push({ id: String(r[c['id']] || ''), n: String(r[c['氏名']] || ''), c: String(r[c['会社名']] || ''),
      t: String(r[c['役職']] || ''), deletedAt: at });
  });
  items.sort(function (a, b) { return a.deletedAt < b.deletedAt ? 1 : (a.deletedAt > b.deletedAt ? -1 : 0); });
  return { ok: true, data: { items: items } };
}
// ゴミ箱内(deletedAt あり)の行だけを対象にする。1件でもゴミ箱外のIDが混ざっていれば全体を拒否する。
// 名刺DBの行を削除、Drive の画像/サムネは setTrashed(true)（Driveのゴミ箱に30日残る）、
// 接触履歴・人物管理の該当行（contactId がゴミ箱内の名刺のもの）を削除する。
function purgeCards_(body) {
  var ids = idsFromBody_(body, 0);
  if (!ids.length) return { ok: false, error: 'missing_ids' };
  if (ids.length > PURGE_MAX_IDS) return { ok: false, error: 'too_many', max: PURGE_MAX_IDS };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = getSheet_();
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var c = colIndex_(header);
    if (c[DELETED_COL] === undefined || lastRow < 2) return { ok: false, error: 'not_in_trash', count: ids.length };
    var all = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var want = {}; ids.forEach(function (x) { want[x] = true; });
    var targets = []; // {row, id, files[]}
    var foundIds = {};
    for (var i = 0; i < all.length; i++) {
      var id = String(all[i][c['id']]);
      if (!want[id]) continue;
      if (!isDeletedRow_(all[i], c)) return { ok: false, error: 'not_in_trash', count: 1 };
      var files = [];
      IMAGE_COLS.concat([THUMB_COL]).forEach(function (name) {
        if (c[name] !== undefined) { var f = String(all[i][c[name]] || '').trim(); if (f) files.push(f); }
      });
      targets.push({ row: i + 2, id: id, files: files });
      foundIds[id] = true;
    }
    var missing = ids.filter(function (x) { return !foundIds[x]; });
    if (missing.length) return { ok: false, error: 'not_in_trash', count: missing.length };

    // 0) 完全削除の前に、当日分のシート丸ごとバックアップを確保する（無ければ作成。失敗したら何も削除しない）
    var bk = ensurePrepurgeBackup_();
    if (!bk.ok) return { ok: false, error: 'backup_failed' };

    // 1) 接触履歴の行を削除（下から）
    var histRemoved = 0;
    var hsh = ss_().getSheetByName(HISTORY_SHEET);
    if (hsh && hsh.getLastRow() >= 2) {
      var hh = hsh.getRange(1, 1, 1, hsh.getLastColumn()).getValues()[0];
      var hci = colIndex_(hh)['contactId'];
      var hv = hsh.getRange(2, hci + 1, hsh.getLastRow() - 1, 1).getValues();
      var hrows = [];
      for (var j = 0; j < hv.length; j++) { if (foundIds[String(hv[j][0])]) hrows.push(j + 2); }
      histRemoved = hrows.length;
      deleteRowsDesc_(hsh, hrows);
    }

    // 2) 人物管理の行を削除（名刺と contactId で1対1。ゴミ箱内の名刺に紐づく行だけ）
    var personRemoved = 0;
    var psh = ss_().getSheetByName(PERSON_SHEET);
    if (psh && psh.getLastRow() >= 2) {
      var ph = psh.getRange(1, 1, 1, psh.getLastColumn()).getValues()[0];
      var pci = colIndex_(ph)['contactId'];
      var pv = psh.getRange(2, pci + 1, psh.getLastRow() - 1, 1).getValues();
      var prows = [];
      for (var k = 0; k < pv.length; k++) { if (foundIds[String(pv[k][0])]) prows.push(k + 2); }
      personRemoved = prows.length;
      deleteRowsDesc_(psh, prows);
    }

    // 3) 名刺DBの行を削除（下から）
    deleteRowsDesc_(sh, targets.map(function (t) { return t.row; }));

    // 4) Drive の画像・サムネをゴミ箱へ（行削除後。失敗しても処理は継続）
    var filesTrashed = 0, fileErrors = 0;
    targets.forEach(function (t) {
      t.files.forEach(function (fid) {
        try { DriveApp.getFileById(fid).setTrashed(true); filesTrashed++; }
        catch (e) { fileErrors++; Logger.log('purge: 画像のゴミ箱移動に失敗 ' + fid + ' ' + e); }
      });
    });
    invalidateBootstrapCache_();
    return { ok: true, data: { purged: targets.length, historyRowsRemoved: histRemoved,
      personRowsRemoved: personRemoved, filesTrashed: filesTrashed, fileErrors: fileErrors } };
  } finally { lock.releaseLock(); }
}
// 完全削除前の自動バックアップ「名刺DB_backup_prepurge_YYYYMMDD」。同じ日は既存のものを使い回す。
// 新規作成したファイルIDは Script Properties の LAST_PREPURGE_BACKUP に記録する。
function ensurePrepurgeBackup_() {
  try {
    var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
    var name = '名刺DB_backup_prepurge_' + stamp;
    var it = DriveApp.getFilesByName(name);
    if (it.hasNext()) return { ok: true, created: false, id: it.next().getId() };
    var copy = DriveApp.getFileById(SPREADSHEET_ID).makeCopy(name);
    var id = copy.getId();
    PropertiesService.getScriptProperties().setProperty('LAST_PREPURGE_BACKUP', id);
    Logger.log('完全削除前バックアップ作成: ' + name + ' (' + id + ')');
    return { ok: true, created: true, id: id };
  } catch (e) {
    Logger.log('完全削除前バックアップに失敗: ' + e);
    return { ok: false };
  }
}
// 行番号の配列（1始まり）を、連続する範囲ごとにまとめて下から削除する
function deleteRowsDesc_(sh, rows) {
  rows = rows.slice().sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < rows.length) {
    var end = rows[i], start = end;
    while (i + 1 < rows.length && rows[i + 1] === start - 1) { start = rows[++i]; }
    sh.deleteRows(start, end - start + 1);
    i++;
  }
}
