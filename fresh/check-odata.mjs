// Сколько объектов опубликовано в стандартном интерфейсе OData приложения 1С:Фреш.
// Логин и пароль берутся из файла .env рядом со скриптом (FRESH_1C_USER_ODATA / FRESH_1C_PASS_ODATA) и не выводятся.
import { readFileSync } from 'node:fs';
function readEnv() {
  try { return readFileSync(process.env.FRESH_ODATA_ENV || new URL('./.env', import.meta.url), 'utf8'); }
  catch { console.error('Нет файла с логином и паролем OData (.env): положите FRESH_1C_USER_ODATA и FRESH_1C_PASS_ODATA или укажите путь в FRESH_ODATA_ENV'); process.exit(2); }
}
if (!process.argv[2]) { console.error('Укажите адрес приложения: node check-odata.mjs https://<узел>.1cfresh.com/a/<конфигурация>/<область>'); process.exit(2); }
const env = Object.fromEntries(readEnv()
  .split(/\r?\n/).map((l) => l.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/)).filter(Boolean)
  .map(([, k, v]) => [k, v.replace(/^(['"])(.*)\1$/, '$2')]));
const user = (env['FRESH_1C_USER_ODATA'] ?? env['1C_FRESH_USER_ODATA']), pass = (env['FRESH_1C_PASS_ODATA'] ?? env['1C_FRESH_PASS_ODATA']);
if (!user || !pass) { console.error('нет FRESH_1C_USER_ODATA/FRESH_1C_PASS_ODATA в .env'); process.exit(2); }
const base = process.argv[2].replace(/\/+$/, '') + '/odata/standard.odata/';
const auth = 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
const r = await fetch(base + '?$format=json', { headers: { Authorization: auth, Accept: 'application/json' } });
console.log('HTTP', r.status, r.headers.get('content-type'));
const text = await r.text();
if (!r.ok) { console.log(text.slice(0, 400)); process.exit(1); }
const sets = JSON.parse(text).value.map((v) => v.name || v.url);
const by = {};
for (const s of sets) { const p = s.split('_')[0]; by[p] = (by[p] || 0) + 1; }
console.log('наборов:', sets.length);
console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join('\n'));
const probe = sets.find((s) => s === 'Catalog_Контрагенты') ? 'Catalog_Контрагенты' : sets.find((s) => s.startsWith('Catalog_'));
if (probe) {
  const q = await fetch(base + encodeURIComponent(probe) + '?$format=json&$top=3&$select=Ref_Key,Description', { headers: { Authorization: auth } });
  const j = q.ok ? await q.json() : null;
  console.log(`проба ${probe}: HTTP ${q.status}, строк ${j?.value?.length ?? '-'}`);
}
