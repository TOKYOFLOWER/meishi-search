// GAS の Code.js をメモリ上のシートスタブで実行し、test_* を回す簡易ハーネス（バックスラッシュ不使用）
const fs = require('fs');
const src = fs.readFileSync('X:/projects/meishi-search/src/Code.js', 'utf8');
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
// Drive / Properties / Cache のスタブ（画像テスト用。メモリ上のフォルダ・ファイル）
const props = {};
const PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) };
const cacheStore = {};
const CacheService = { getScriptCache: () => ({ get: (k) => (k in cacheStore ? cacheStore[k] : null), put: (k, v) => { cacheStore[k] = v; }, remove: (k) => { delete cacheStore[k]; }, removeAll: (ks) => ks.forEach((k) => delete cacheStore[k]) }) };
const driveFiles = {}, driveFolders = {}; let driveSeq = 0;
function makeFile(id, blob) { return { getId: () => id, getBlob: () => blob, setTrashed: (t) => { driveFiles[id].trashed = t; }, trashed: false, blob }; }
function makeFolder(name) { const id = 'folder' + (++driveSeq); const f = { getId: () => id, getName: () => name, createFile: (blob) => { const fid = 'file' + (++driveSeq); driveFiles[fid] = makeFile(fid, blob); return driveFiles[fid]; } }; driveFolders[id] = f; return f; }
const DriveApp = {
  getFoldersByName: (name) => { const arr = Object.values(driveFolders).filter((f) => f.getName() === name); let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; },
  createFolder: (name) => makeFolder(name),
  getFolderById: (id) => { if (!driveFolders[id]) throw new Error('no folder'); return driveFolders[id]; },
  getFileById: (id) => { if (!driveFiles[id] || driveFiles[id].trashed) throw new Error('no file'); return driveFiles[id]; }
};
Utilities.base64Decode = (str) => Buffer.from(String(str), 'base64');
Utilities.base64Encode = (bytes) => Buffer.from(bytes).toString('base64');
Utilities.newBlob = (bytes, mime, name) => ({ getBytes: () => bytes, getContentType: () => mime, getName: () => name });
function makeSheet(name) {
  const s = { name, data: [], frozen: 0 };
  function range(r, c, nr, nc) {
    return {
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = s.data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
      setValues(v) { for (let i = 0; i < v.length; i++) { while (s.data.length < r + i) s.data.push([]); const row = s.data[r - 1 + i]; for (let j = 0; j < v[i].length; j++) { while (row.length < c + j) row.push(''); row[c - 1 + j] = v[i][j]; } } return this; },
      setValue(x) { return this.setValues([[x]]); },
      setNumberFormat() { return this; }
    };
  }
  s.getLastRow = () => s.data.length;
  s.getLastColumn = () => s.data.reduce((m, r) => Math.max(m, r.length), 0);
  s.getMaxRows = () => Math.max(s.data.length, 1000);
  s.getFrozenRows = () => s.frozen; s.setFrozenRows = (n) => { s.frozen = n; };
  s.getDataRange = () => range(1, 1, Math.max(s.data.length, 1), s.getLastColumn() || 1);
  s.getRange = (r, c, nr, nc) => range(r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc);
  s.deleteRow = (r) => { s.data.splice(r - 1, 1); };
  return s;
}
const sheets = {};
const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n)) };
const SpreadsheetApp = { openById: () => ss };
const HEADER = ['id','会社名','部署名','役職','役職レベル','氏名','姓','名','業種','メール','郵便番号','都道府県','市区町村','住所','会社TEL','携帯','Fax','URL','名刺交換日','取込日','備考','importBatchId'];
const db = (sheets['名刺DB'] = makeSheet('名刺DB'));
db.data.push(HEADER.slice());
db.data.push(['M00001','既存商事','','代表取締役','経営者','既存 太郎','既存','太郎','その他','','','東京都','中央区','東京都中央区銀座1-1','','','','https://example.com', new Date(2025, 0, 15), '2025-01-20', '', '']);
db.data.push(['M00002','既存商事','','','担当','既存 花子','既存','花子','その他','','','','','','','','','', '', '2025-01-20', '', '']);
// ---- ここから スマホ撮影登録(scanCard/confirmDraft等)の検証 ----
Utilities.getUuid = () => require('crypto').randomUUID();
const fetchCalls = [];
let fetchImpl = () => ({ code: 200, body: '{}' });
const UrlFetchApp = { fetch: (url, opts) => { fetchCalls.push({ url, opts }); const r = fetchImpl(url, opts); return { getResponseCode: () => r.code, getContentText: () => r.body }; } };
const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => s }) };
const copies = [];
DriveApp.getFileById = ((orig) => (id) => {
  if (id === 'SSID') return { getParents: () => ({ hasNext: () => true, next: () => ({ n: 'parent' }) }), makeCopy: (name, folder) => { copies.push({ name, folder }); return { getName: () => name, getId: () => 'copy1' }; } };
  return orig(id);
})(DriveApp.getFileById);
const body = fs.readFileSync('X:/projects/meishi-search/src/Code.js', 'utf8').replace("'1gy6viELdXZnGWcNbPGqKmdJjrrteBE7dI1RhS-r8OVY'", "'SSID'");
const api = new Function('SpreadsheetApp', 'Utilities', 'Logger', 'LockService', 'PropertiesService', 'CacheService', 'DriveApp', 'UrlFetchApp', 'ContentService',
  body + '\nreturn { setupScanFeature, countPendingDrafts_, doPost, testScanIdempotency, bootstrap_ };');
const g = api(SpreadsheetApp, Utilities, Logger, LockService, PropertiesService, CacheService, DriveApp, UrlFetchApp, ContentService);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log((ok ? 'OK  ' : 'NG  ') + name + (ok ? '' : ' -> ' + detail)); };
const JPG = Buffer.from('fakejpeg').toString('base64');
props.APP_USER = 'u'; props.APP_PASS = 'p'; props.ANTHROPIC_API_KEY = 'sk-test';
const post = (o) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(Object.assign({ user: 'u', pass: 'p' }, o)) } }));

// 0) 未セットアップ
check('setup前は not_setup', post({ action: 'scanCard', clientId: 'x', front: JPG }).error === 'not_setup', '');
check('setup前の listDrafts は空', post({ action: 'listDrafts' }).data.items.length === 0, '');
check('認証なしは拒否', JSON.parse(g.doPost({ postData: { contents: JSON.stringify({ action: 'scanCard' }) } })).error === 'auth', '');

// 1) setupScanFeature
const s = g.setupScanFeature();
check('バックアップ名 meishi_backup_yyyyMMdd_HHmm・元と同じフォルダ', /^meishi_backup_\d{8}_\d{4}$/.test(copies[0] && copies[0].name) && copies[0].folder.n === 'parent', JSON.stringify(copies));
check('drafts シート作成(12列)', sheets.drafts && sheets.drafts.data[0].length === 12 && sheets.drafts.data[0][0] === 'draftId', '');
const hdr = sheets['名刺DB'].data[0].slice();
check('画像列(表裏)を末尾に追加・既存22列は不変', hdr.slice(0, 22).join() === HEADER.join() && ['imageFrontId', 'imageFrontThumbId', 'imageBackId', 'imageBackThumbId', 'thumbFileId'].every((c) => hdr.indexOf(c) >= 22), hdr.join());
check('UrlFetchApp を1回呼ぶ', fetchCalls.length === 1 && fetchCalls[0].url.indexOf('api.anthropic.com') > 0, '');
g.setupScanFeature();
check('setup 2回目も drafts/列は重複しない', sheets.drafts.data[0].length === 12 && sheets['名刺DB'].data[0].length === hdr.length, '');

// 2) scanCard 実APIパス（UrlFetchApp スタブ）。表裏2枚
const extracted = { company: '新規商事', name: '山田 花子', kana: 'やまだ はなこ', department: '', title: '代表', email: 'hanako@new.example', tel: '03-1111-2222', mobile: '', fax: '', postal: '', address: '東京都港区1-1', url: '', memo: '', confidence: 0.93, notes: '' };
fetchImpl = () => ({ code: 200, body: JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'record_card', input: extracted }] }) });
fetchCalls.length = 0;
const r1 = post({ action: 'scanCard', clientId: 'c-1', front: JPG, back: JPG, thumb: JPG, exchangeDate: '2026-10-20', eventName: '守成 青山' });
check('scanCard → extracted', r1.ok && r1.data.draft.status === 'extracted' && r1.data.draft.extracted.name === '山田 花子' && r1.data.draft.hasBack, JSON.stringify(r1));
const sent = JSON.parse(fetchCalls[0].opts.payload);
check('API: model/tool_choice/表裏順/両面プロンプト/キーヘッダ', sent.model === 'claude-sonnet-4-6' && sent.tool_choice.name === 'record_card' && sent.messages[0].content.filter((x) => x.type === 'image').length === 2 && sent.messages[0].content[0].text === '【表面】' && sent.system.indexOf('矛盾する場合は表面を優先') > 0 && fetchCalls[0].opts.headers['x-api-key'] === 'sk-test', '');
const r1b = post({ action: 'scanCard', clientId: 'c-1', front: JPG, back: JPG, thumb: JPG });
check('同一clientId再送 → existing・API再呼出なし・行は1つ', r1b.data.existing === true && fetchCalls.length === 1 && sheets.drafts.data.length === 2 && r1b.data.draft.draftId === r1.data.draft.draftId, '');
post({ action: 'scanCard', clientId: 'c-2', front: JPG, thumb: JPG });
const sentSingle = JSON.parse(fetchCalls[1].opts.payload);
check('片面は画像1枚・両面用の追記なし', sentSingle.messages[0].content.filter((x) => x.type === 'image').length === 1 && sentSingle.system.indexOf('矛盾する場合') < 0, '');

// 3) 失敗 → error・画像保持・retry
fetchImpl = () => ({ code: 400, body: '{"error":"bad"}' });
const r3 = post({ action: 'scanCard', clientId: 'c-3', front: JPG, thumb: JPG });
check('API失敗 → error + errorMessage + 画像保持', r3.ok && r3.data.draft.status === 'error' && /HTTP 400/.test(r3.data.draft.errorMessage) && !!r3.data.draft.frontImageId, JSON.stringify(r3));
let n429 = 0;
fetchImpl = () => (++n429 < 3 ? { code: 429, body: 'slow' } : { code: 200, body: JSON.stringify({ content: [{ type: 'tool_use', name: 'record_card', input: Object.assign({}, extracted, { name: '再 読取' }) }] }) });
const rr = post({ action: 'retryDraft', draftId: r3.data.draft.draftId });
check('retryDraft(429×2→成功)', rr.ok && rr.data.draft.status === 'extracted' && rr.data.draft.extracted.name === '再 読取' && n429 === 3, JSON.stringify(rr));
check('listDrafts は extracted/error のみ・件数', post({ action: 'listDrafts' }).data.items.length === 3 && g.countPendingDrafts_() === 3, '');

// 4) draftImage
const di = post({ action: 'draftImage', draftId: r1.data.draft.draftId, side: 'back' });
check('draftImage 裏面', di.ok && di.data.image === JPG, JSON.stringify(di).slice(0, 80));

// 5) confirmDraft: 重複 → 候補（保存しない）→ force
const dupCard = Object.assign({}, extracted, { company: '既存商事', name: '既存 太郎' });
const beforeRows = sheets['名刺DB'].data.length;
const c1 = post({ action: 'confirmDraft', draftId: r1.data.draft.draftId, card: dupCard });
check('完全一致の重複は force なしで保存せず候補を返す', c1.ok && c1.data.needsConfirm && c1.data.candidates[0].id === 'M00001' && sheets['名刺DB'].data.length === beforeRows, JSON.stringify(c1));
const c2 = post({ action: 'confirmDraft', draftId: r1.data.draft.draftId, card: Object.assign({}, extracted, { company: '新規商事', name: '既存 太朗', email: '' }) });
check('類似候補(姓同一・名1字違い)も候補として返す', c2.ok && c2.data.needsConfirm && c2.data.candidates.some((x) => x.reasons.join().indexOf('名1字違い') >= 0), JSON.stringify(c2));
const c3 = post({ action: 'confirmDraft', draftId: r1.data.draft.draftId, card: extracted, exchangeDate: '2026-10-21', eventName: '守成 青山' });
const row = sheets['名刺DB'].data[sheets['名刺DB'].data.length - 1];
const col = (n) => sheets['名刺DB'].data[0].indexOf(n);
check('本登録: cardId・氏名・表裏画像ID・サムネ・交換日', c3.ok && c3.data.cardId === 'M00003' && row[col('氏名')] === '山田 花子' && !!row[col('imageFrontId')] && !!row[col('imageBackId')] && !!row[col('thumbFileId')] && row[col('名刺交換日')] === '2026-10-21', JSON.stringify([c3, row]));
check('接触履歴(名刺交換・イベント名)が作られる', sheets['接触履歴'] && sheets['接触履歴'].data.some((r) => r[0] === 'M00003' && r[1] === '2026-10-21' && r[2] === '守成 青山' && r[3] === '名刺交換'), JSON.stringify(sheets['接触履歴'] && sheets['接触履歴'].data));
check('draft が confirmed + cardId', (() => { const d = sheets.drafts.data.find((r) => r[0] === r1.data.draft.draftId); return d[2] === 'confirmed' && d[11] === 'M00003'; })(), '');
const c4 = post({ action: 'confirmDraft', draftId: r1.data.draft.draftId, card: extracted });
check('confirmDraft 再実行は冪等（二重登録しない）', c4.ok && c4.data.already && sheets['名刺DB'].data.length === beforeRows + 1, JSON.stringify(c4));
const d2 = post({ action: 'scanCard', clientId: 'c-4', front: JPG, thumb: JPG });
const f1 = post({ action: 'confirmDraft', draftId: d2.data.draft.draftId, card: dupCard, force: true });
check('force=true なら完全一致でも登録', f1.ok && !f1.data.needsConfirm && sheets['名刺DB'].data.length === beforeRows + 2, JSON.stringify(f1));

// 6) discard / 件数
const dd = post({ action: 'discardDraft', draftId: r3.data.draft.draftId });
const st = sheets.drafts.data.find((r) => r[0] === r3.data.draft.draftId)[2];
check('discardDraft は status のみ変更(行は残る)', dd.ok && st === 'discarded' && sheets.drafts.data.length === 5, sheets.drafts.data.length);
check('confirmed の破棄は拒否', post({ action: 'discardDraft', draftId: r1.data.draft.draftId }).error === 'already_confirmed', '');
check('countPendingDrafts_ 反映(c-2のみ未確認)', g.countPendingDrafts_() === 1, g.countPendingDrafts_());

// 7) 組込テスト関数・既存addCardの挙動
check('testScanIdempotency (同一clientIdで2回→drafts 1行)', g.testScanIdempotency() === true, '');
check('addCard 既存挙動: duplicate は従来どおり行番号を返し追記しない', (() => { const n = sheets['名刺DB'].data.length; const r = post({ action: 'addCard', card: { company: '既存商事', name: '既存 花子' } }); return r.ok && r.duplicate === true && r.row === 3 && sheets['名刺DB'].data.length === n; })(), '');
console.log(fails ? '\nFAILED: ' + fails : '\nALL PASS');
process.exit(fails ? 1 : 0);
