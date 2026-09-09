// 非連続行への一括適用（ラン分割）の検証
const fs = require('fs');
const src = fs.readFileSync('X:/projects/meishi-search/src/Code.js', 'utf8');
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const Utilities = { formatDate(d, tz, fmt) { return fmt.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate())).replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())).replace('ss', pad(d.getSeconds())); }, sleep() {} };
const Logger = { log() {} };
const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
let setValuesCalls = 0;
function makeSheet(name) {
  const s = { name, data: [], frozen: 0 };
  function range(r, c, nr, nc) { return {
    getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = s.data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
    setValues(v) { setValuesCalls++; for (let i = 0; i < v.length; i++) { while (s.data.length < r + i) s.data.push([]); const row = s.data[r - 1 + i]; for (let j = 0; j < v[i].length; j++) { while (row.length < c + j) row.push(''); row[c - 1 + j] = v[i][j]; } } return this; },
    setValue(x) { return this.setValues([[x]]); }, setNumberFormat() { return this; } }; }
  s.getLastRow = () => s.data.length; s.getLastColumn = () => s.data.reduce((m, r) => Math.max(m, r.length), 0);
  s.getMaxRows = () => 1000; s.getFrozenRows = () => s.frozen; s.setFrozenRows = (n) => { s.frozen = n; };
  s.getDataRange = () => range(1, 1, Math.max(s.data.length, 1), s.getLastColumn() || 1);
  s.getRange = (r, c, nr, nc) => range(r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc);
  s.deleteRow = (r) => { s.data.splice(r - 1, 1); }; return s;
}
const sheets = {}; const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n)) };
const HEADER = ['id','会社名','部署名','役職','役職レベル','氏名','姓','名','業種','メール','郵便番号','都道府県','市区町村','住所','会社TEL','携帯','Fax','URL','名刺交換日','取込日','備考','importBatchId'];
const db = (sheets['名刺DB'] = makeSheet('名刺DB')); db.data.push(HEADER.slice());
for (let i = 1; i <= 5; i++) { const r = HEADER.map(() => ''); r[0] = 'M0000' + i; r[1] = '会社' + i; r[5] = '氏名' + i; r[19] = '2026-09-09'; db.data.push(r); }
db.data[1][18] = '2020-01-01'; // M00001 は交換日あり
const g = new Function('SpreadsheetApp','Utilities','Logger','LockService', src + '\nreturn { bulkContactApply_ };')({ openById: () => ss }, Utilities, Logger, LockService);
setValuesCalls = 0;
const r = g.bulkContactApply_({ scope: 'ids', ids: ['M00001','M00002','M00004','M00005'], date: '2026/09/08', eventName: 'ラン検証', overwrite: false });
const ex = db.data.slice(1).map((row) => row[0] + '=' + JSON.stringify(row[18]));
console.log('result', JSON.stringify(r.data), '| setValues呼出回数(交換日ラン+履歴+ヘッダ作成)', setValuesCalls);
console.log('交換日:', ex.join(' '), '| 期待: M00001=2020-01-01(不変) M00002=iso M00003=""(対象外) M00004,M00005=iso');
console.log('履歴件数', sheets['接触履歴'].data.length - 1);
