// 4,000行相当のダミーで stats / newCards / tags / eventNames / bootstrap の getValues 回数・セル数・所要時間を計測
// 実行: node tests/gas_perf.js   （GAS の SpreadsheetApp/CacheService をメモリ上でスタブ。時間は目安、呼出回数とセル数が主指標）
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../src/Code.js', 'utf8');
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const Utilities = {
  formatDate(d, tz, fmt) { return fmt.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate())).replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())).replace('ss', pad(d.getSeconds())); },
  sleep() {},
  gzip(blob) { return { getBytes() { return blob.getBytes(); } }; },
  ungzip(blob) { return { getDataAsString() { return blob.getDataAsString(); } }; },
  base64Encode(bytes) { return 'b64:' + bytes; },
  base64Decode(s) { return s.slice(4); },
  newBlob(s) { return { getBytes() { return s; }, getDataAsString() { return s; } }; }
};
const logs = []; const Logger = { log: (x) => logs.push(String(x)) };
const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
const cacheStore = {};
const CacheService = { getScriptCache: () => ({
  get: (k) => (k in cacheStore ? cacheStore[k] : null),
  put: (k, v) => { if (String(v).length > 100000) throw new Error('too big'); cacheStore[k] = v; },
  remove: (k) => { delete cacheStore[k]; },
  removeAll: (ks) => ks.forEach((k) => delete cacheStore[k])
}) };
const stat = { getValues: 0, cells: 0, openById: 0 };
function makeSheet(name) {
  const s = { name, data: [], frozen: 0 };
  function range(r, c, nr, nc) { return {
    getValues() { stat.getValues++; stat.cells += nr * nc; const out = []; for (let i = 0; i < nr; i++) { const row = s.data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
    setValues(v) { for (let i = 0; i < v.length; i++) { while (s.data.length < r + i) s.data.push([]); const row = s.data[r - 1 + i]; for (let j = 0; j < v[i].length; j++) { while (row.length < c + j) row.push(''); row[c - 1 + j] = v[i][j]; } } return this; },
    setValue(x) { return this.setValues([[x]]); }, setNumberFormat() { return this; } }; }
  s.getLastRow = () => s.data.length; s.getLastColumn = () => s.data.reduce((m, r) => Math.max(m, r.length), 0);
  s.getMaxRows = () => Math.max(s.data.length, 1000); s.getFrozenRows = () => s.frozen; s.setFrozenRows = (n) => { s.frozen = n; };
  s.getDataRange = () => range(1, 1, Math.max(s.data.length, 1), s.getLastColumn() || 1);
  s.getRange = (r, c, nr, nc) => range(r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc);
  s.deleteRow = (r) => { s.data.splice(r - 1, 1); }; return s;
}
const sheets = {}; const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n)) };
const SpreadsheetApp = { openById: () => { stat.openById++; return ss; } };
const HEADER = ['id','会社名','部署名','役職','役職レベル','氏名','姓','名','業種','メール','郵便番号','都道府県','市区町村','住所','会社TEL','携帯','Fax','URL','名刺交換日','取込日','備考','importBatchId'];
const today = new Date(); const iso = (d) => Utilities.formatDate(d, 'JST', 'yyyy-MM-dd');
const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
const db = (sheets['名刺DB'] = makeSheet('名刺DB')); db.data.push(HEADER.slice());
const prefs = ['東京都','神奈川県','新潟県','長野県'], inds = ['花卉・園芸','IT・デジタル','その他','士業'], roles = ['経営者','担当','部長'];
for (let i = 1; i <= 4000; i++) {
  const r = HEADER.map(() => ''); const id = 'M' + ('00000' + i).slice(-5);
  r[0] = id; r[1] = '会社' + i; r[3] = '役職'; r[4] = roles[i % 3]; r[5] = '氏名 ' + i; r[8] = inds[i % 4]; r[11] = prefs[i % 4]; r[13] = prefs[i % 4] + '市区町村' + i;
  r[17] = 'https://example.com/' + i; r[18] = i % 5 === 0 ? '' : daysAgo(400 + i);
  r[19] = i > 3900 ? daysAgo((4000 - i) % 10) : daysAgo(100 + i);
  r[21] = i > 3900 ? 'scan-' + daysAgo((4000 - i) % 10).split('-').join('') : '';
  db.data.push(r);
}
const pm = (sheets['人物管理'] = makeSheet('人物管理'));
pm.data.push(['contactId','organized','importance','relationship','tags','needs','canIntroduce','wantIntroduce','nextAction','nextActionDate','memo','facebookUrl','instagramUrl','linkedinUrl','xUrl','youtubeUrl','otherSnsUrl','snsCheckedAt','createdAt','updatedAt']);
for (let i = 1; i <= 500; i++) { const id = 'M' + ('00000' + (3500 + i)).slice(-5); pm.data.push([id, i % 3 === 0, '高', '知人', i % 4 === 0 ? '経営者,要フォロー' : (i % 7 === 0 ? '自由タグ' + (i % 5) : '経営者'), '', '', '', '', i % 6 === 0 ? daysAgo(1) : '', '', '', '', '', '', '', '', i % 2 ? '2026-09-01 10:00:00' : '', '2026-09-01 10:00:00', '2026-09-01 10:00:00']); }
const hm = (sheets['接触履歴'] = makeSheet('接触履歴'));
hm.data.push(['contactId','contactDate','eventName','contactType','memo','followUp','followDate','createdAt']);
const evs = ['守成 青山デイライト','守成 青山夜会','守成 二部会','異業種交流会'];
for (let i = 1; i <= 1500; i++) { const id = 'M' + ('00000' + (2500 + i)).slice(-5); hm.data.push([id, daysAgo(i % 90), evs[i % 4], '名刺交換', '', i % 10 === 0, i % 10 === 0 ? daysAgo(2) : '', '2026-09-01 10:00:00']); }
const tail = '\nreturn { computeStats_, getNewCards_, getTags_, getEventNames_, getFilters, savePersonToSheet_, bootstrap_: (typeof bootstrap_ === "function") ? bootstrap_ : null };';
const g = new Function('SpreadsheetApp','Utilities','Logger','LockService','CacheService', src + tail)(SpreadsheetApp, Utilities, Logger, LockService, CacheService);
function measure(label, fn) { stat.getValues = 0; stat.cells = 0; stat.openById = 0; const t0 = process.hrtime.bigint(); const r = fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; console.log(label.padEnd(30), 'getValues', String(stat.getValues).padStart(2), 'cells', String(stat.cells).padStart(7), 'openById', String(stat.openById).padStart(2), 'ms', ms.toFixed(1)); return r; }
const results = {};
results.stats = measure('stats', () => g.computeStats_());
results.newCards = measure('newCards(7,未整理)', () => g.getNewCards_({ days: 7, onlyUnorganized: true }));
results.tags = measure('tags', () => g.getTags_());
results.eventNames = measure('eventNames', () => g.getEventNames_());
results.filters = measure('filters', () => g.getFilters());
if (g.bootstrap_) {
  const b1 = measure('bootstrap(初回・未キャッシュ)', () => g.bootstrap_({ days: 7, onlyUnorganized: true }));
  const b2 = measure('bootstrap(キャッシュ)', () => g.bootstrap_({ days: 7, onlyUnorganized: true }));
  const d1 = b1.ok ? b1.data : b1, d2 = b2.ok ? b2.data : b2;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const expectNew = Object.assign({}, results.newCards, { onlyUnorganized: true });
  console.log('bootstrap == 個別5本:', ['stats','newCards','tags','eventNames','filters'].map((k) => k + '=' + same(d1[k], k === 'newCards' ? expectNew : results[k])).join(' '), '| cached:', d1.cached, '->', d2.cached, '| bytes', JSON.stringify(d1).length);
  const before = d2.stats.unorganizedCount;
  g.savePersonToSheet_({ id: d2.newCards.items[0].id, crm: { tags: ['経営者'] }, organized: true });
  const b3 = g.bootstrap_({ days: 7, onlyUnorganized: true }); const d3 = b3.ok ? b3.data : b3;
  console.log('書き込み後: cached', d3.cached, '| 未整理', before, '->', d3.stats.unorganizedCount, (d3.stats.unorganizedCount === before - 1 && d3.cached === false) ? 'OK(最新)' : 'NG');
} else {
  console.log('(bootstrap_ 未実装: 改修前の計測)');
}
console.log(logs.filter((l) => l.indexOf('ms') >= 0).slice(-8).join('\n'));
