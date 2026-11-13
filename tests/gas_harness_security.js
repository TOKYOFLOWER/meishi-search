// セキュリティ強化（画像取得の限定・認証強化・数式インジェクション対策）の検証ハーネス。
// GAS の Code.js をメモリ上のシート/Drive/Cache スタブで実行する（実データには一切触れない）。
const fs = require('fs');
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const Utilities = {
  formatDate(d, tz, fmt) {
    const y = d.getFullYear(), M = pad(d.getMonth() + 1), D = pad(d.getDate()), h = pad(d.getHours()), m = pad(d.getMinutes()), s = pad(d.getSeconds());
    return fmt.replace('yyyy', y).replace('MM', M).replace('dd', D).replace('HH', h).replace('mm', m).replace('ss', s);
  },
  sleep() {}
};
const logs = [];
const Logger = { log: (x) => logs.push(String(x)) };
const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
const props = {};
const PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) };
let cacheStore = {};
const CacheService = { getScriptCache: () => ({ get: (k) => (k in cacheStore ? cacheStore[k] : null), put: (k, v) => { cacheStore[k] = String(v); }, remove: (k) => { delete cacheStore[k]; }, removeAll: (ks) => ks.forEach((k) => delete cacheStore[k]) }) };

// ---- Drive スタブ: 親フォルダを持つ。getFileById の呼び出しを記録 ----
const driveFiles = {}, driveFolders = {}; let driveSeq = 0;
const driveReads = [];
function makeFile(id, blob, parentId) {
  return {
    getId: () => id, getBlob: () => blob, setTrashed: (t) => { driveFiles[id].trashed = t; }, trashed: false, blob,
    getParents: () => { const arr = parentId ? [driveFolders[parentId]] : []; let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
  };
}
function makeFolder(name) {
  const id = 'folder' + (++driveSeq);
  const f = { getId: () => id, getName: () => name, createFile: (blob) => { const fid = 'file' + (++driveSeq); driveFiles[fid] = makeFile(fid, blob, id); return driveFiles[fid]; } };
  driveFolders[id] = f; return f;
}
const DriveApp = {
  getFoldersByName: (name) => { const arr = Object.values(driveFolders).filter((f) => f.getName() === name); let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; },
  createFolder: (name) => makeFolder(name),
  getFolderById: (id) => { if (!driveFolders[id]) throw new Error('no folder'); return driveFolders[id]; },
  getFileById: (id) => {
    driveReads.push(id);
    if (id === 'SSID') return { getParents: () => ({ hasNext: () => true, next: () => ({ n: 'parent' }) }), makeCopy: (name) => ({ getName: () => name, getId: () => 'copy1' }) };
    if (!driveFiles[id] || driveFiles[id].trashed) throw new Error('no file');
    return driveFiles[id];
  }
};
Utilities.base64Decode = (str) => Buffer.from(String(str), 'base64');
Utilities.base64Encode = (bytes) => Buffer.from(bytes).toString('base64');
Utilities.newBlob = (bytes, mime, name) => ({ getBytes: () => bytes, getContentType: () => mime, getName: () => name });
Utilities.getUuid = () => require('crypto').randomUUID();
Utilities.DigestAlgorithm = { SHA_256: 'sha256' }; Utilities.Charset = { UTF_8: 'utf8' };
Utilities.computeDigest = (alg, str) => Array.from(require('crypto').createHash('sha256').update(String(str), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b));

// ---- シートスタブ ----
function makeSheet(name) {
  const s = { name, data: [], frozen: 0, fmt: {}, textCells: {} };
  function range(r, c, nr, nc) {
    const stripFor = (cell) => name.indexOf('_formula_test_') === 0 && s.fmt[cell] !== '@'; // 実Sheetsの「先頭 ' は非テキスト書式セルでは値に含まれない」挙動の模倣（テスト用シートのみ）
    return {
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = s.data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
      setValues(v) {
        for (let i = 0; i < v.length; i++) {
          while (s.data.length < r + i) s.data.push([]);
          const row = s.data[r - 1 + i];
          for (let j = 0; j < v[i].length; j++) {
            while (row.length < c + j) row.push('');
            let x = v[i][j];
            if (typeof x === 'string' && x.charAt(0) === "'" && stripFor((r + i) + ',' + (c + j))) { x = x.slice(1); s.textCells[(r + i) + ',' + (c + j)] = true; } // 先頭 ' で強制テキスト化されたセル
            row[c - 1 + j] = x;
          }
        }
        return this;
      },
      setValue(x) { return this.setValues([[x]]); },
      getValue() { return this.getValues()[0][0]; },
      getFormula() { const v = this.getValues()[0][0]; return typeof v === 'string' && v.charAt(0) === '=' && !s.textCells[r + ',' + c] ? v : ''; },
      setNumberFormat(f) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.fmt[(r + i) + ',' + (c + j)] = f; return this; }
    };
  }
  s.getLastRow = () => s.data.length;
  s.getLastColumn = () => s.data.reduce((m, r) => Math.max(m, r.length), 0);
  s.getMaxRows = () => Math.max(s.data.length, 1000);
  s.getFrozenRows = () => s.frozen; s.setFrozenRows = (n) => { s.frozen = n; };
  s.getDataRange = () => range(1, 1, Math.max(s.data.length, 1), s.getLastColumn() || 1);
  s.getRange = (r, c, nr, nc) => range(r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc);
  s.deleteRow = (r) => { s.data.splice(r - 1, 1); };
  s.appendRow = (r) => { s.data.push(r.slice()); };
  return s;
}
const sheets = {};
const ss = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = makeSheet(n)),
  deleteSheet: (sh) => { delete sheets[sh.name]; }
};
const SpreadsheetApp = { openById: () => ss };
const HEADER = ['id','会社名','部署名','役職','役職レベル','氏名','姓','名','業種','メール','郵便番号','都道府県','市区町村','住所','会社TEL','携帯','Fax','URL','名刺交換日','取込日','備考','importBatchId'];
const db = (sheets['名刺DB'] = makeSheet('名刺DB'));
db.data.push(HEADER.slice());
db.data.push(['M00001','既存商事','','代表取締役','経営者','既存 太郎','既存','太郎','その他','','','東京都','中央区','東京都中央区銀座1-1','','','','https://example.com', '2025-01-15', '2025-01-20', '', '']);
db.data.push(['M00002','既存商事','','','担当','既存 花子','既存','花子','その他','','','','','','','','','', '', '2025-01-20', '', '']);

const fetchCalls = [];
let fetchImpl = () => ({ code: 200, body: '{}' });
const UrlFetchApp = { fetch: (url, opts) => { fetchCalls.push({ url, opts }); const r = fetchImpl(url, opts); return { getResponseCode: () => r.code, getContentText: () => r.body }; } };
const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => s }) };

const rawSrc = fs.readFileSync('X:/projects/meishi-search/src/Code.js', 'utf8');
const body = rawSrc.replace("'1gy6viELdXZnGWcNbPGqKmdJjrrteBE7dI1RhS-r8OVY'", "'SSID'");
const api = new Function('SpreadsheetApp', 'Utilities', 'Logger', 'LockService', 'PropertiesService', 'CacheService', 'DriveApp', 'UrlFetchApp', 'ContentService',
  body + '\nreturn { doPost, safeCell_, unlockPasswordLogin, testFormulaSafe, setupScanFeature, getThumbs_, INGEST_ACTIONS, PW_FAIL_MAX };');
const g = api(SpreadsheetApp, Utilities, Logger, LockService, PropertiesService, CacheService, DriveApp, UrlFetchApp, ContentService);

let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'NG  ') + name + (ok ? '' : ' -> ' + detail)); };
const JPG = Buffer.from('fakejpeg').toString('base64');
props.APP_USER = 'u'; props.APP_PASS = 'p'; props.ANTHROPIC_API_KEY = 'sk-test';
const raw = (o) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(o) } }));
const idp = (o) => raw(Object.assign({ user: 'u', pass: 'p' }, o));         // ID/パス
const bad = (o) => raw(Object.assign({ user: 'u', pass: 'WRONG' }, o));     // 誤パス
const withTok = (tok, o) => raw(Object.assign({ token: tok }, o));
const resetAuthState = () => { cacheStore = {}; };
const isAuth = (r) => r.ok === false && r.error === 'auth' && r.data === undefined;

// 端末トークン（ID/パスの login で取得）
const tok = idp({ action: 'login', deviceLabel: 'sec-test' }).data.token;

/* ===================== STEP1: 画像取得の限定 ===================== */
// drafts シートがまだ無い状態: 未登録IDは Drive に触れない
let r = withTok(tok, { action: 'getThumbs', ids: ['unknownA'] });
check('S1 drafts 無し・未登録IDは結果に含まれない', r.ok && Object.keys(r.data).length === 0, JSON.stringify(r));
check('S1 drafts 無し・未登録IDで getFileById を呼んでいない', driveReads.indexOf('unknownA') < 0, driveReads.join());

fetchImpl = () => ({ code: 200, body: JSON.stringify({ content: [{ type: 'tool_use', name: 'record_card', input: { company: '=HYPERLINK("http://evil","x")', name: '山田 花子', kana: '', department: '', title: '', email: '', tel: '', mobile: '+81-90-1111-2222', fax: '', postal: '', address: '', url: '', memo: '@memo', confidence: 0.9, notes: '' } }] }) });
g.setupScanFeature();
const folderId = props.IMAGE_FOLDER_ID;
check('S1 画像フォルダのIDがプロパティに入っている', !!folderId && !!driveFolders[folderId], folderId);
const folder = driveFolders[folderId];
const mkIn = () => folder.createFile(Utilities.newBlob(Buffer.from('img'), 'image/jpeg', 'x.jpg')).getId();
const regFront = mkIn(), regThumb = mkIn(), regBack = mkIn(), unregInFolder = mkIn();
const outsideFolder = makeFolder('other');
driveFiles.fileOUT = makeFile('fileOUT', Utilities.newBlob(Buffer.from('secret'), 'image/jpeg', 'o.jpg'), outsideFolder.getId());
const dbHdr = sheets['名刺DB'].data[0];
const colOf = (n) => dbHdr.indexOf(n);
const rowM1 = sheets['名刺DB'].data[1];
while (rowM1.length < dbHdr.length) rowM1.push('');
rowM1[colOf('imageBackId')] = regBack;
rowM1[colOf('thumbFileId')] = regThumb;
rowM1[colOf('imageFrontId')] = regFront;
// 画像列が一部しか無い行・列が無い場合も落ちないことの確認は readCards_ の未存在列(undefined)分岐で担保される

// drafts: scanCard で frontImageId / thumbImageId を登録
const sc = withTok(tok, { action: 'scanCard', clientId: 'sec-1', front: JPG, thumb: JPG });
check('S1 scanCard で draft 作成', sc.ok && sc.data.draft.frontImageId && sc.data.draft.thumbImageId, JSON.stringify(sc));
const dFront = sc.data.draft.frontImageId, dThumb = sc.data.draft.thumbImageId;

driveReads.length = 0;
r = withTok(tok, { action: 'getThumbs', ids: ['unknownB', 'fileOUT', unregInFolder, 'SSID'] });
check('S1 シート未登録のID(フォルダ内ファイル含む)は結果に含まれない', r.ok && Object.keys(r.data).length === 0, JSON.stringify(r));
check('S1 未登録IDで DriveApp.getFileById が呼ばれていない', driveReads.length === 0, driveReads.join());
driveReads.length = 0;
r = withTok(tok, { action: 'getThumbs', ids: [regThumb, regFront, regBack, 'unknownC'] });
check('S1 名刺DB 登録済み(thumbFileId/IMAGE_COLS)は従来どおり base64 が返る', r.ok && r.data[regThumb] === Buffer.from('img').toString('base64') && r.data[regFront] && r.data[regBack] && !('unknownC' in r.data), JSON.stringify(r));
check('S1 登録済みだけ Drive を読む', driveReads.sort().join() === [regThumb, regFront, regBack].sort().join(), driveReads.join());
r = withTok(tok, { action: 'getThumbs', ids: [dFront, dThumb] });
check('S1 drafts の frontImageId/thumbImageId 登録済みも返る', r.ok && !!r.data[dFront] && !!r.data[dThumb], JSON.stringify(r));
r = withTok(tok, { action: 'getThumbs', ids: [] });
check('S1 ids 空は空オブジェクト', r.ok && Object.keys(r.data).length === 0, JSON.stringify(r));

// setThumb
const thumbBefore = () => sheets['名刺DB'].data[1][colOf('thumbFileId')];
let before = thumbBefore();
r = withTok(tok, { action: 'setThumb', id: 'M00001', thumbFileId: 'fileOUT' });
check('S1 フォルダ外ファイルIDの setThumb は bad_file', r.ok === false && r.error === 'bad_file', JSON.stringify(r));
check('S1 bad_file のときシートは変化しない', thumbBefore() === before, thumbBefore());
r = withTok(tok, { action: 'setThumb', id: 'M00001', thumbFileId: 'no-such-file' });
check('S1 取得できないファイルIDは bad_file', r.error === 'bad_file' && thumbBefore() === before, JSON.stringify(r));
const savedProp = props.IMAGE_FOLDER_ID; delete props.IMAGE_FOLDER_ID;
r = withTok(tok, { action: 'setThumb', id: 'M00001', thumbFileId: unregInFolder });
check('S1 IMAGE_FOLDER_ID 未設定は bad_file', r.error === 'bad_file' && thumbBefore() === before, JSON.stringify(r));
props.IMAGE_FOLDER_ID = savedProp;
r = withTok(tok, { action: 'setThumb', id: 'M00001', thumbFileId: unregInFolder });
check('S1 画像フォルダ内ファイルの setThumb は ok・シート更新', r.ok === true && thumbBefore() === unregInFolder, JSON.stringify(r));
r = withTok(tok, { action: 'setThumb', id: 'M00001', thumbB64: JPG, sourceFile: 'a.jpg' });
check('S1 thumbB64 経路は従来どおり ok', r.ok === true && !!driveFiles[r.data.thumbFileId] && thumbBefore() === r.data.thumbFileId, JSON.stringify(r));

/* ===================== STEP2: 認証 ===================== */
resetAuthState();
check('S2 ID/パスで listLite は auth', isAuth(idp({ action: 'listLite' })), '');
check('S2 ID/パスで login は成功(token)', !!idp({ action: 'login', deviceLabel: 't2' }).data.token, '');
check('S2 ID/パスで ping は ok', idp({ action: 'ping' }).ok === true, '');
check('S2 ID/パスで savePerson/getThumbs/cardImage も auth', ['savePerson', 'getThumbs', 'cardImage', 'search', 'person', 'purgeCards'].every((a) => isAuth(idp({ action: a, id: 'M00001' }))), '');
check('S2 端末トークンで listLite は通る', withTok(tok, { action: 'listLite' }).ok === true, '');

// INGEST_KEY 未設定（移行期間）
delete props.INGEST_KEY;
let n0 = sheets['名刺DB'].data.length;
r = idp({ action: 'addCard', card: { company: '移行商事', name: '移行 太郎' } });
check('S2 INGEST_KEY 未設定: ID/パスで addCard 可', r.ok === true && sheets['名刺DB'].data.length === n0 + 1, JSON.stringify(r));
check('S2 INGEST_KEY 未設定: ID/パスで cardsWithoutImage/cardsWithoutThumb 可', idp({ action: 'cardsWithoutImage' }).ok === true && idp({ action: 'cardsWithoutThumb' }).ok === true, '');
check('S2 INGEST_KEY 未設定: ingestKey だけ送っても auth', isAuth(raw({ action: 'addCard', ingestKey: 'K', card: { company: 'x', name: 'y z' } })), '');
check('S2 INGEST_KEY 未設定: ID/パスでも listLite は auth', isAuth(idp({ action: 'listLite' })), '');

// INGEST_KEY 設定
props.INGEST_KEY = 'KEY-123';
n0 = sheets['名刺DB'].data.length;
r = raw({ action: 'addCard', ingestKey: 'KEY-123', card: { company: '取込商事', name: '取込 次郎' } });
check('S2 INGEST_KEY 設定: ingestKey で addCard 可', r.ok === true && sheets['名刺DB'].data.length === n0 + 1, JSON.stringify(r));
check('S2 ingestKey で attachImages/setThumb/cardsWithout* は認証を通る(auth ではない)', ['attachImages', 'setThumb', 'cardsWithoutImage', 'cardsWithoutThumb', 'ping'].every((a) => raw({ action: a, ingestKey: 'KEY-123' }).error !== 'auth'), '');
check('S2 ingestKey で listLite は auth', isAuth(raw({ action: 'listLite', ingestKey: 'KEY-123' })), '');
check('S2 ingestKey で login/savePerson/getThumbs/deleteCards は auth', ['login', 'savePerson', 'getThumbs', 'deleteCards'].every((a) => isAuth(raw({ action: a, ingestKey: 'KEY-123' }))), '');
check('S2 INGEST_KEY 設定: ID/パスで addCard は auth', isAuth(idp({ action: 'addCard', card: { company: 'z', name: 'z z' } })), '');
check('S2 ingestKey 不一致＋正しいID/パスで addCard は auth', isAuth(raw({ action: 'addCard', ingestKey: 'WRONG', user: 'u', pass: 'p', card: { company: 'z', name: 'z z' } })), '');
check('S2 ingestKey 不一致＋正しいID/パスで login は可', !!raw({ action: 'login', ingestKey: 'WRONG', user: 'u', pass: 'p', deviceLabel: 'x' }).data.token, '');
check('S2 ingestKey が文字列でない(配列/数値)は不一致扱い', isAuth(raw({ action: 'addCard', ingestKey: ['KEY-123'] })) && isAuth(raw({ action: 'addCard', ingestKey: 0 })), '');
check('S2 ingest 移行期間の併送(ingestKey一致＋ID/パス)で addCard 可', raw({ action: 'addCard', ingestKey: 'KEY-123', user: 'u', pass: 'p', card: { company: '併送商事', name: '併送 三郎' } }).ok === true, '');
check('S2 INGEST_ACTIONS の内容', g.INGEST_ACTIONS.slice().sort().join() === ['addCard', 'attachImages', 'cardsWithoutImage', 'cardsWithoutThumb', 'ping', 'setThumb'].sort().join(), g.INGEST_ACTIONS.join());

// ロック
resetAuthState();
const wrongs = []; for (let i = 0; i < g.PW_FAIL_MAX; i++) wrongs.push(bad({ action: 'login' }).error);
check('S2 誤パス10回はすべて auth(10回目でロックが立つ)', wrongs.every((e) => e === 'auth'), wrongs.join());
r = idp({ action: 'login' });
check('S2 10回失敗後は正しいパスでも locked', r.ok === false && r.error === 'locked', JSON.stringify(r));
check('S2 locked 中も ping(ID/パス) は locked', idp({ action: 'ping' }).error === 'locked', '');
check('S2 locked 中も端末トークンでは通る(listDelta)', withTok(tok, { action: 'listDelta', sinceVersion: '' }).ok === true, '');
check('S2 locked 中も ingestKey では通る(INGEST_KEY設定時)', raw({ action: 'cardsWithoutImage', ingestKey: 'KEY-123' }).ok === true, '');
check('S2 locked 中も ingestKey 不一致+ID/パスは locked', raw({ action: 'addCard', ingestKey: 'BAD', user: 'u', pass: 'p' }).error === 'locked', '');
g.unlockPasswordLogin();
r = idp({ action: 'login', deviceLabel: 'after-unlock' });
check('S2 unlockPasswordLogin() 後は login 成功', r.ok === true && !!r.data.token, JSON.stringify(r));
check('S2 unlockPasswordLogin は Logger.log する', logs.some((l) => l.indexOf('ロック') >= 0), '');
check('S2 unlockPasswordLogin の戻り値は ok', g.unlockPasswordLogin() === 'ok', '');

resetAuthState();
for (let i = 0; i < 9; i++) bad({ action: 'ping' });
check('S2 9回失敗ではまだロックされない', idp({ action: 'ping' }).ok === true, '');
for (let i = 0; i < 9; i++) bad({ action: 'ping' });
check('S2 成功ログインで失敗カウンタが消える(9回→成功→9回でもロックされない)', idp({ action: 'ping' }).ok === true && !('pwlock' in cacheStore), JSON.stringify(cacheStore));

resetAuthState();
let noCredOk = true;
for (let i = 0; i < 60; i++) { const rr = raw({ action: 'login' }); if (!isAuth(rr)) noCredOk = false; }
for (let i = 0; i < 60; i++) { const rr = raw({ action: 'login', user: '', pass: '' }); if (!isAuth(rr)) noCredOk = false; }
check('S2 認証情報なしは何十回送っても auth のまま・カウントされない', noCredOk && !('pwfail' in cacheStore) && !('pwlock' in cacheStore), JSON.stringify(cacheStore));
check('S2 認証情報なしの後でも正しいID/パスで login 可', idp({ action: 'login', deviceLabel: 'z' }).ok === true, '');
check('S2 token 認証の失敗(無効トークン)はロックに数えない', (() => { resetAuthState(); for (let i = 0; i < 30; i++) withTok('bogus', { action: 'listLite' }); return idp({ action: 'ping' }).ok === true; })(), '');

// doPost の例外
r = JSON.parse(g.doPost({ postData: { contents: '{not json' } }));
check('S2 不正JSONは server_error・例外メッセージを含まない', r.ok === false && r.error === 'server_error' && JSON.stringify(r).indexOf('JSON') < 0 && JSON.stringify(r).indexOf('Unexpected') < 0, JSON.stringify(r));
check('S2 server_error はログに詳細を残す', logs.some((l) => l.indexOf('doPost:') === 0), logs.slice(-3).join('|'));
const savedDb = sheets['名刺DB']; delete sheets['名刺DB'];
r = withTok(tok, { action: 'listLite' });
sheets['名刺DB'] = savedDb;
check('S2 action 内の例外も server_error・シート名などを含まない', r.ok === false && r.error === 'server_error' && JSON.stringify(r).indexOf('シート') < 0, JSON.stringify(r));
check('S2 Code.js に validateHttpsCertificates が含まれない', rawSrc.indexOf('validateHttpsCertificates') < 0, '');

/* ===================== STEP3: 数式インジェクション ===================== */
const same = (a, b) => (a === b) || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime());
['=1+1', '+81-90-0000-0000', '-1', '@x', '\tx', '\nx', '\rx', '=HYPERLINK("http://e","x")'].forEach((v) => {
  check('S3 safeCell_ ' + JSON.stringify(v) + " は ' 付き", g.safeCell_(v) === "'" + v, JSON.stringify(g.safeCell_(v)));
});
const dt = new Date(2026, 0, 2);
[['abc', 'abc'], ['03-1234-5678', '03-1234-5678'], ['', ''], [42, 42], [-5, -5], [true, true], [false, false], [null, null], [undefined, undefined], [dt, dt], ["'=x", "'=x"], [' =x', ' =x']].forEach((p) => {
  const out = g.safeCell_(p[0]);
  check('S3 safeCell_ そのまま ' + (p[0] instanceof Date ? 'Date' : JSON.stringify(p[0])), same(out, p[1]) && typeof out === typeof p[1], String(out));
});

// 経路確認（スタブは ' を文字として保持するので ' 始まりを見る）
const dbCol = (n) => sheets['名刺DB'].data[0].indexOf(n);
const lastDbRow = () => sheets['名刺DB'].data[sheets['名刺DB'].data.length - 1];
r = withTok(tok, { action: 'addCard', card: { company: '=HYPERLINK("http://evil","x")', name: '罠 太郎', mobile: '+81-90-0000-0000', department: '-dept', title: '@t', memo: '=memo', email: '=e@x' } });
const cardRow = lastDbRow();
check('S3 addCard: 会社名 =… は \'= で始まる', r.ok && String(cardRow[dbCol('会社名')]).indexOf("'=") === 0, JSON.stringify(cardRow));
check('S3 addCard: 携帯 +81… は \'+ で始まる', String(cardRow[dbCol('携帯')]).indexOf("'+81") === 0, cardRow[dbCol('携帯')]);
check('S3 addCard: 部署名(-)・役職(@)・メール(=)・備考(scan:..=memo は先頭がscanなので対象外)', String(cardRow[dbCol('部署名')]).indexOf("'-") === 0 && String(cardRow[dbCol('役職')]).indexOf("'@") === 0 && String(cardRow[dbCol('メール')]).indexOf("'=") === 0, JSON.stringify(cardRow));
check('S3 addCard: id・取込日は変化しない', /^M\d{5}$/.test(cardRow[dbCol('id')]) && /^\d{4}-\d{2}-\d{2}$/.test(cardRow[dbCol('取込日')]), JSON.stringify([cardRow[dbCol('id')], cardRow[dbCol('取込日')]]));
const addedId = cardRow[dbCol('id')];
const devs = sheets.devices.data;
idp({ action: 'login', deviceLabel: '=cmd|calc' });
check('S3 login: deviceLabel =… は \'= で始まる', devs[devs.length - 1][1] === "'=cmd|calc", JSON.stringify(devs[devs.length - 1]));
idp({ action: 'login', deviceLabel: 'iPhone 15' });
check('S3 login: 通常ラベルはそのまま', devs[devs.length - 1][1] === 'iPhone 15', JSON.stringify(devs[devs.length - 1]));

const pc = (sheet, n) => sheets[sheet].data[0].indexOf(n);
const rowOf = (sheet, id) => sheets[sheet].data.filter((x, i) => i > 0 && x[0] === id).pop();
r = withTok(tok, { action: 'savePerson', id: 'M00001', crm: { memo: '=memo', needs: '+needs', nextAction: '-na', tags: ['@tag'] } });
let prow = rowOf('人物管理', 'M00001');
check('S3 savePerson: memo/needs/nextAction が \' 付き', r.ok && String(prow[pc('人物管理', 'memo')]).indexOf("'=") === 0 && String(prow[pc('人物管理', 'needs')]).indexOf("'+") === 0 && String(prow[pc('人物管理', 'nextAction')]).indexOf("'-") === 0, JSON.stringify(prow));
check('S3 savePerson: createdAt 等のシステム値はそのまま', /^\d{4}-\d{2}-\d{2} /.test(prow[pc('人物管理', 'createdAt')]) && prow[pc('人物管理', 'organized')] === true, JSON.stringify(prow));
r = withTok(tok, { action: 'updateNickname', id: 'M00002', nickname: '=nick' });
prow = rowOf('人物管理', 'M00002');
check('S3 updateNickname: nickname が \'= で始まる', r.ok && String(prow[pc('人物管理', 'nickname')]).indexOf("'=") === 0, JSON.stringify(prow));
r = withTok(tok, { action: 'addContact', id: 'M00001', contactDate: '2026-10-01', eventName: '=ev', memo: '-memo', contactType: '@type' });
const hrow = sheets['接触履歴'].data[sheets['接触履歴'].data.length - 1];
const hc = (n) => sheets['接触履歴'].data[0].indexOf(n);
check('S3 addContact: eventName/memo/contactType が \' 付き', r.ok && String(hrow[hc('eventName')]).indexOf("'=") === 0 && String(hrow[hc('memo')]).indexOf("'-") === 0 && String(hrow[hc('contactType')]).indexOf("'@") === 0, JSON.stringify(hrow));
check('S3 addContact: contactDate(iso)・createdAt はそのまま', hrow[hc('contactDate')] === '2026-10-01' && /^\d{4}-\d{2}-\d{2} /.test(hrow[hc('createdAt')]), JSON.stringify(hrow));
r = withTok(tok, { action: 'snsSave', id: 'M00001', platform: 'instagram', url: 'https://www.instagram.com/abc/' });
prow = rowOf('人物管理', 'M00001');
check('S3 snsSave: https URL は変化しない(もともと危険文字で始まらない)', r.ok && prow[pc('人物管理', 'instagramUrl')] === 'https://www.instagram.com/abc/', JSON.stringify(r));
r = withTok(tok, { action: 'bulkContactApply', scope: 'ids', ids: ['M00001', 'M00002'], date: '2026/09/08', eventName: '=EVENT', overwrite: false });
const brows = sheets['接触履歴'].data.filter((x) => x[hc('eventName')] === "'=EVENT");
check('S3 bulkContactApply: 履歴行の eventName が \'= で始まる(2件)', r.ok && brows.length === 2, JSON.stringify(r) + brows.length);
// confirmDraft 経由（scanCard の抽出結果 company=「=HYPERLINK…」, mobile=「+81…」, memo=「@memo」）
const draftId = sc.data.draft.draftId;
r = withTok(tok, { action: 'confirmDraft', draftId, card: sc.data.draft.extracted, eventName: '+EV', force: true });
const cdRow = lastDbRow();
check('S3 confirmDraft: 会社名・携帯が \' 付きで名刺DB に入る', r.ok && String(cdRow[dbCol('会社名')]).indexOf("'=") === 0 && String(cdRow[dbCol('携帯')]).indexOf("'+81") === 0, JSON.stringify([r, cdRow]));
check('S3 confirmDraft: 画像列の fileId・名刺交換日はそのまま', cdRow[dbCol('imageFrontId')] === dFront && cdRow[dbCol('thumbFileId')] === dThumb && /^\d{4}-\d{2}-\d{2}$/.test(cdRow[dbCol('名刺交換日')]), JSON.stringify(cdRow));
const dh = sheets['接触履歴'].data[sheets['接触履歴'].data.length - 1];
check('S3 confirmDraft: 接触履歴のイベント名 +EV が \' 付き', dh[hc('eventName')] === "'+EV", JSON.stringify(dh));
// scanCard 時の draft 行（OCR 由来の extractedJson は JSON なので影響なし／eventName は safeCell_）
const sc2 = withTok(tok, { action: 'scanCard', clientId: 'sec-2', front: JPG, thumb: JPG, eventName: '=EVT' });
const drow = sheets.drafts.data.filter((x) => x[1] === 'sec-2')[0];
check('S3 scanCard: draft の eventName が \' 付き・fileId はそのまま', sc2.ok && drow[sheets.drafts.data[0].indexOf('eventName')] === "'=EVT" && drow[sheets.drafts.data[0].indexOf('frontImageId')] === sc2.data.draft.frontImageId, JSON.stringify(drow));
// updateDraft_ 経由（retry でエラーメッセージ等）
fetchImpl = () => ({ code: 400, body: '=bad' });
const sc3 = withTok(tok, { action: 'scanCard', clientId: 'sec-3', front: JPG, thumb: JPG });
const d3 = sheets.drafts.data.filter((x) => x[1] === 'sec-3')[0];
check('S3 scanCard 失敗時の draft status/errorMessage(HTTP… 始まり)は変化しない', sc3.ok && d3[sheets.drafts.data[0].indexOf('status')] === 'error' && /HTTP 400/.test(d3[sheets.drafts.data[0].indexOf('errorMessage')]), JSON.stringify(d3));

// testFormulaSafe（一時シート作成→検証→必ず削除）
const before2 = Object.keys(sheets).sort().join();
const tf = g.testFormulaSafe();
check('S3 testFormulaSafe: 4セルを判定して返す・一時シートは削除される', tf && tf.cells.length === 4 && Object.keys(sheets).sort().join() === before2, JSON.stringify(tf));
check('S3 testFormulaSafe: 一般書式セル(A1,A2)は数式にならず元の文字列で読める', tf.cells[0].ok && tf.cells[1].ok, JSON.stringify(tf));
check('S3 testFormulaSafe: ok と textFormatExact を返す', tf.ok === true && typeof tf.textFormatExact === 'boolean', JSON.stringify(tf));
check('S3 testFormulaSafe: Logger に結果を出す', logs.some((l) => l.indexOf('testFormulaSafe:') === 0), '');
// 注: B1/B2(テキスト書式)の結果は実 Sheets でしか判定できない。スタブでは非テキスト書式のみ ' 除去を模倣している。

console.log(fails ? '\nFAILED: ' + fails : '\nALL PASS');
process.exit(fails ? 1 : 0);
