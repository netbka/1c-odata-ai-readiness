// Подключается к окну select-all.mjs (localhost:9333), сохраняет peek.png и печатает,
// что видно в дереве «Состав»: группы, число строк, отмеченные, открыто ли окно.
// Необязательный аргумент — JS-выражение, которое выполнить в странице.
import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { WORK } from './browser.mjs';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find((p) => p.url().includes('1cfresh.com')) || browser.contexts()[0].pages()[0];
await page.screenshot({ path: join(WORK, 'peek.png') });
const info = await page.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight - 2; };
  const dialogs = [...document.querySelectorAll('.framePress')].filter(vis).map((e) => e.innerText.trim()).filter(Boolean);
  const bodies = [...document.querySelectorAll('.gridBody')].filter((b) => b.getBoundingClientRect().height > 0);
  const out = bodies.map((b) => {
    const lines = [...b.querySelectorAll('.gridLine')].filter(vis);
    return {
      lines: lines.length,
      groups: lines.filter((l) => !l.querySelector('.checkbox')).map((l) => l.innerText.trim().split('\n')[0]).slice(0, 20),
      items: lines.filter((l) => l.querySelector('.checkbox')).length,
      checked: lines.filter((l) => /\bselect\b/.test(l.querySelector('.checkbox')?.className || '')).length,
    };
  });
  return { url: location.href.slice(0, 80), buttons: dialogs.slice(0, 10), grids: out };
});
console.log(JSON.stringify(info, null, 1));
if (process.argv[2]) console.log(await page.evaluate(process.argv[2]));
process.exit(0); // просто отключиться: browser.close() мог бы закрыть окно скрипта
