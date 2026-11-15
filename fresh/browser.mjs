// Отдельное окно Chrome для работы с 1С:Фреш: свой профиль (<WORK>/profile) и порт
// DevTools 9333 только на localhost. Chrome запускается отдельным процессом (detached), поэтому
// падение или завершение любого скрипта окно не закрывает; закрывает его только человек.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** Рабочая папка: профиль Chrome, снимки, журналы. По умолчанию папка .work рядом со скриптами. */
export const WORK = process.env.FRESH_ODATA_HOME || join(here, '.work');
export const PORT = 9333;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));

const alive = async () => {
  try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; }
};

/** Подключается к окну; если его нет — запускает Chrome с адресом url. Возвращает { browser, context }. */
export async function openBrowser(url = 'about:blank') {
  if (!(await alive())) {
    if (!CHROME) throw new Error('Chrome не найден');
    const profile = join(WORK, 'profile');
    mkdirSync(profile, { recursive: true });
    const child = spawn(CHROME, [
      `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1',
      '--start-maximized', '--no-first-run', '--no-default-browser-check', url,
    ], { detached: true, stdio: 'ignore', cwd: WORK });
    child.unref();
    for (let i = 0; i < 60 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  return { browser, context: browser.contexts()[0] };
}
