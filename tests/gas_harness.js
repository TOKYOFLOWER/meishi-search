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
const api = new Function('SpreadsheetApp','Utilities','Logger','LockService', src + '\nreturn { setupSnsBulkColumns_, test_bulk_, test_addCard_, test_follow_, test_sns_, searchCards, getPerson_ };');
const g = api(SpreadsheetApp, Utilities, Logger, LockService);
const rows = () => Object.keys(sheets).map((n) => n + '=' + (sheets[n].data.length - 1)).join(' ');
console.log('setup:', JSON.stringify(g.setupSnsBulkColumns_().added), '| rows', rows());
for (const t of ['test_bulk_', 'test_addCard_', 'test_follow_', 'test_sns_']) {
  const before = rows();
  const r = g[t]();
  console.log(t, r.pass ? 'PASS' : 'FAIL', r.checks.map((c) => (c.ok ? 'OK:' : 'NG:') + c.name + (c.ok ? '' : ' -> ' + c.detail)).join(' | '));
  console.log('   rows before/after:', before, '/', rows());
}
console.log('既存行の交換日(Date)保持:', sheets['名刺DB'].data[1][18] instanceof Date, '| 既存行2 交換日:', JSON.stringify(sheets['名刺DB'].data[2][18]));
console.log(logs.filter((l) => l.indexOf('bulkContactApply:') === 0).join(' || '));
