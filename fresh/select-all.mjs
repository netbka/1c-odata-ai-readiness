#!/usr/bin/env node
// Отмечает все объекты на вкладке «Состав» формы «Настройка автоматического REST-сервиса»
// (стандартный интерфейс OData) в приложении 1С:Фреш.
//
// Почему не скрипт в консоли браузера: веб-клиент 1С игнорирует события с isTrusted=false,
// поэтому element.click() и dispatchEvent из страницы ничего не отмечают. Здесь клики и клавиши
// идут через протокол DevTools (Playwright), и 1С принимает их как настоящие.
//
// Запуск:
//   node select-all.mjs https://<узел>.1cfresh.com/a/<конфигурация>/<область>
// Откроется Chrome с отдельным профилем (.work/profile) отдельным процессом: окно не
// закрывается, когда скрипт завершается или падает. При первом запуске
// войдите в 1С:Фреш в этом окне; форма откроется по ссылке, скрипт сам нажмёт «Состав»
// и «Загрузить метаданные», затем отметит все объекты и подтвердит окна «Зависимости объекта».
// Логин и пароль REST-пользователя на вкладке «Авторизация» и кнопку «Сохранить» скрипт
// не трогает: это делает человек.

import { openBrowser, WORK } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appUrl = (process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
const FORM = '#e1cib/app/Обработка.НастройкаСтандартногоИнтерфейсаOData';

// Сначала то, от чего зависят другие (перечисления, ПВХ, планы счетов), потом остальное:
// так окон «Зависимости объекта» меньше.
const ORDER = [
  'Перечисление', 'Перечисления', 'Планы видов характеристик', 'Планы счетов', 'Планы видов расчета',
  'Константы', 'Справочники', 'Документы', 'Журналы документов',
  'Регистры сведений', 'Регистры накопления', 'Регистры бухгалтерии', 'Регистры расчета',
  'Бизнес-процессы', 'Задачи', 'Планы обмена',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Окна, где правильный ответ — «Нет»: 1С исключает объекты или теряет несохранённые изменения.
const DECLINE = /исключ|снят|удал|убра|потер/i;

// Снимок видимой части дерева «Состав». Выполняется в странице.
function snapshotInPage(groupNames) {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight - 2;
  };
  const center = (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  // Кнопки окон: .framePress в окнах зависимостей, .press в вопросах платформы («Загрузить метаданные заново?»).
  const btns = [...document.querySelectorAll('.framePress, a.press')].filter(vis);
  const yes = btns.find((e) => /^(Да|Yes|Разрешить)$/.test(e.innerText.trim()));
  if (yes) {
    const no = btns.find((e) => /^(Нет|No|Запретить)$/.test(e.innerText.trim()));
    // Текст окна: ближайший предок кнопки с заметным текстом.
    let box = yes, text = '';
    for (let i = 0; i < 12 && box; i++) { box = box.parentElement; text = (box?.innerText || '').trim(); if (text.length > 25) break; }
    return { dialog: { yes: center(yes), no: no ? center(no) : null, text: text.replace(/\s+/g, ' ').slice(0, 300) }, lines: [] };
  }

  // Нужная таблица: видимый gridBody, где есть галочки или строки-группы из списка.
  const bodies = [...document.querySelectorAll('.gridBody')].filter((b) => b.getBoundingClientRect().height > 0);
  const textOf = (l) => (l.querySelector('.gridBoxText')?.innerText || l.innerText || '').trim().split('\n')[0];
  const body = bodies.find((b) =>
    [...b.querySelectorAll('.gridLine')].some((l) => l.querySelector('.checkbox') || groupNames.includes(textOf(l))),
  );
  if (!body) return { dialog: null, lines: [], noGrid: true };

  // Видимая область таблицы: пересечение рамок предков с обрезкой (overflow). Строки под нижним
  // краем таблицы есть в DOM, но обрезаны — их считать нельзя (в «Рознице» таблица ниже окна не доходит).
  let top = 0, bottom = innerHeight - 2;
  for (let a = body; a && a !== document.body; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.overflowY !== 'visible' || cs.overflow !== 'visible') {
      const r = a.getBoundingClientRect();
      if (r.height > 0) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
    }
  }
  const inGrid = (e) => { const r = e.getBoundingClientRect(); return r.top >= top - 1 && r.bottom <= bottom + 1; };
  const lines = [...body.querySelectorAll('.gridLine')]
    .filter((l) => vis(l) && inGrid(l))
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    .map((l) => {
      const cb = l.querySelector('.checkbox');
      const text = textOf(l);
      const toggle = cb ? null : l.querySelector('.gridBoxImg > .dIB');
      const title = l.querySelector('.gridBoxText') || l;
      return {
        text,
        group: !cb,
        checked: cb ? /\bselect\b/.test(cb.className) : null,
        cb: cb ? center(cb) : null,
        toggle: toggle ? center(toggle) : null,
        row: center(title),
        current: /\bselect\b/.test(l.className),
      };
    });
  return { dialog: null, lines };
}

async function main() {
  // Окно Chrome живёт отдельно от скрипта (browser.mjs): завершение скрипта его не закрывает.
  const { context: ctx } = await openBrowser();
  const page = ctx.pages().find((p) => appUrl && p.url().startsWith(appUrl))
    || ctx.pages().find((p) => p.url() === 'about:blank') || (await ctx.newPage());
  await page.bringToFront();
  page.on('dialog', (d) => d.accept().catch(() => {})); // «Покинуть сайт?» и подобные

  const snap = () => page.evaluate(snapshotInPage, ORDER);
  const click = async (p) => { await page.mouse.click(p.x, p.y); };

  if (!(appUrl && page.url().startsWith(appUrl))) await page.goto(appUrl ? `${appUrl}/ru_RU/${FORM}` : 'https://1cfresh.com/my');
  log(appUrl
    ? 'Если попросит, войдите в 1С:Фреш в открывшемся окне. Жду форму «Настройка автоматического REST-сервиса»…'
    : 'Адрес приложения не передан: откройте приложение и форму вручную. Жду форму…');

  // Ждём форму, жмём «Состав» и «Загрузить метаданные», пока не появятся группы.
  const deadline = Date.now() + 15 * 60_000;
  let lastDiag = 0, lastLoad = 0;
  for (;;) {
    if (Date.now() > deadline) { log('Форма не появилась за 15 минут; окно оставляю открытым.'); process.exit(2); }
    const s = await snap().catch((e) => ({ lines: [], err: String(e).slice(0, 120) }));
    if (Date.now() - lastDiag > 10_000) {
      lastDiag = Date.now();
      log('диагностика:', page.url().slice(0, 90), 'строк:', s.lines.length, s.noGrid ? 'таблицы нет' : '', s.err || '');
      await page.screenshot({ path: join(WORK, 'state.png') }).catch(() => {});
    }
    // Окно: добавить зависимые объекты — «Да»; исключить объекты или потерять несохранённые изменения — «Нет».
    if (s.dialog) {
      const decline = DECLINE.test(s.dialog.text);
      if (decline && !s.dialog.no) { log('Окно без кнопки «Нет»:', s.dialog.text.slice(0, 160), '— ответьте в окне сами; скрипт останавливается.'); process.exit(3); }
      log('Окно:', s.dialog.text.slice(0, 120), '→', decline ? 'Нет' : 'Да');
      await click(decline ? s.dialog.no : s.dialog.yes); await sleep(1500); continue;
    }
    if (s.lines.some((l) => l.group && ORDER.includes(l.text))) break;
    // Таблица есть, но прокручена внутрь группы: в начало дерева.
    if (s.lines.length) { await click(s.lines[0].row); await page.keyboard.press('Control+Home'); await sleep(1500); continue; }
    // После входа Фреш открывает личный кабинет: вернуться к форме, если не на странице входа.
    const onLogin = await page.locator('input[type=password]').first().isVisible().catch(() => false);
    if (appUrl && !onLogin && !page.url().startsWith(appUrl)) {
      log('Открываю форму по ссылке…');
      await page.goto(`${appUrl}/ru_RU/${FORM}`).catch(() => {});
      await sleep(15000);
      continue;
    }
    // Фреш может открыть поверх формы «Новое в версии…»: переключиться на вкладку формы.
    const tab = page.locator('.openedItemTitle', { hasText: 'Настройка автоматического REST-сервиса' }).first();
    if (await tab.isVisible().catch(() => false)) { await tab.click().catch(() => {}); await sleep(800); }
    // Вкладка «Состав»: у заголовков вкладок 1С бывает пустой textContent, ищем и по title/aria.
    if (!(await page.getByText('Загрузить метаданные', { exact: true }).filter({ visible: true }).first().isVisible().catch(() => false))) {
      const pt = await page.evaluate(() => {
        // Подпись вкладки бывает в CSS ::before, а id вкладки — thpage_formN_Состав.
        const byId = [...document.querySelectorAll('[id^="thpage_"][id$="_Состав"]')].find((e) => e.getBoundingClientRect().width > 0);
        if (byId) { const r = byId.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
        const t = [...document.querySelectorAll('.tabsItemTitle, .tabsItem, [class*="tabsItem"]')].find((e) => {
          const r = e.getBoundingClientRect();
          const txt = [e.textContent, e.getAttribute('title'), e.getAttribute('aria-label'), e.parentElement?.getAttribute('title')].join(' ');
          return r.width > 0 && r.height > 0 && /Состав/.test(txt);
        });
        if (!t) return null;
        const r = t.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }).catch(() => null);
      if (pt) { await click(pt); await sleep(1500); continue; }
      else { const el = page.getByText('Состав', { exact: true }).first(); if (await el.isVisible().catch(() => false)) { await el.click().catch(() => {}); await sleep(1500); } }
    }
    // «Загрузить метаданные» — один раз в минуту: загрузка в большой базе идёт долго.
    const load = page.getByText('Загрузить метаданные', { exact: true }).filter({ visible: true }).first();
    if (Date.now() - lastLoad > 60_000 && (await load.isVisible().catch(() => false))) {
      lastLoad = Date.now();
      log('Нажимаю «Загрузить метаданные»…');
      const box = await load.boundingBox().catch(() => null);
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(8000);
    }
    await sleep(2000);
  }
  log('Дерево объектов найдено.');

  const dialogTexts = new Set();
  const handleDialog = async (s) => {
    if (!s.dialog) return false;
    const d = s.dialog;
    const removing = DECLINE.test(d.text);
    const key = d.text.replace(/«[^»]*»|"[^"]*"/g, '…').slice(0, 120);
    if (!dialogTexts.has(key)) { dialogTexts.add(key); log(`  окно (${removing ? 'Нет' : 'Да'}): ${d.text.slice(0, 200)}`); }
    if (removing && !d.no) { log('  окно без кнопки «Нет» — ответьте в окне сами; скрипт останавливается.'); process.exit(3); }
    await click(removing ? d.no : d.yes);
    for (let i = 0; i < 50; i++) { await sleep(150); if (!(await snap()).dialog) break; }
    return true;
  };

  // Отметить одну строку по имени и дождаться результата (или окна зависимостей).
  const tick = async (text) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let s = await snap();
      if (await handleDialog(s)) s = await snap();
      const l = s.lines.find((x) => !x.group && x.text === text);
      if (!l) return false; // ушла из видимой области; доберём на следующем проходе
      if (l.checked) return false; // уже отмечена (например, как зависимость) — не считаем
      // Прямо перед кликом: под точкой та же строка и галочка снята (таблица могла сдвинуться).
      const hit = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        const line = el?.closest('.gridLine');
        const cb = line?.querySelector('.checkbox');
        const t = (line?.querySelector('.gridBoxText')?.innerText || line?.innerText || '').trim().split('\n')[0];
        return { t, checked: cb ? /\bselect\b/.test(cb.className) : null };
      }, l.cb);
      if (hit.t !== text || hit.checked !== false) { await sleep(300); continue; }
      await click(l.cb);
      for (let i = 0; i < 25; i++) {
        await sleep(120);
        const t = await snap();
        if (t.dialog) { await handleDialog(t); continue; }
        const m = t.lines.find((x) => !x.group && x.text === text);
        if (m?.checked) return true;
      }
    }
    log('  не удалось отметить:', text);
    return false;
  };

  let firstGroup = null; // текст первой строки дерева, когда все группы свёрнуты
  const toTop = async () => {
    for (let i = 0; i < 4; i++) {
      const s = await snap();
      if (await handleDialog(s)) continue;
      if (firstGroup && s.lines[0]?.text === firstGroup) return true;
      if (s.lines[0]) await click(s.lines[0].row);
      await page.keyboard.press('Control+Home');
      await sleep(700);
      if (!firstGroup) return true;
      const t = await snap();
      if (t.lines[0]?.text === firstGroup) return true;
      if (t.lines[0]) { await page.mouse.move(t.lines[0].row.x, t.lines[0].row.y); await page.mouse.wheel(0, -200000); await sleep(800); }
    }
    log('  не удалось вернуться в начало дерева');
    return false;
  };

  const setExpanded = async (name, want) => {
    await toTop();
    for (let i = 0; i < 3; i++) {
      const s = await snap();
      const idx = s.lines.findIndex((l) => l.group && l.text === name);
      if (idx < 0) return false;
      const expanded = !!s.lines[idx + 1] && !s.lines[idx + 1].group;
      if (expanded === want) return true;
      await click(s.lines[idx].toggle);
      await sleep(want ? 2000 : 800);
    }
    const s = await snap();
    const idx = s.lines.findIndex((l) => l.group && l.text === name);
    const ok = idx >= 0 && (!!s.lines[idx + 1] && !s.lines[idx + 1].group) === want;
    if (!ok) {
      log(`  группа «${name}» не ${want ? 'раскрылась' : 'свернулась'}`);
      await page.screenshot({ path: join(WORK, `fail-${name}.png`) }).catch(() => {});
    }
    return ok;
  };

  // Свернуть все группы, чтобы увидеть полный список групп.
  for (let pass = 0; pass < 20; pass++) {
    await toTop();
    const s = await snap();
    const idx = s.lines.findIndex((l, i) => l.group && s.lines[i + 1] && !s.lines[i + 1].group);
    if (idx < 0) break;
    await click(s.lines[idx].toggle);
    await sleep(700);
  }

  let total = 0;
  const present = (await snap()).lines.filter((l) => l.group).map((l) => l.text);
  firstGroup = present[0] || null;
  log('Группы:', present.join(', '));
  const groups = [...ORDER.filter((g) => present.includes(g)), ...present.filter((g) => !ORDER.includes(g))];

  for (const name of groups) {
    if (!(await setExpanded(name, true))) { log('Группа не найдена:', name); continue; }
    let s = await snap();
    const g = s.lines.find((l) => l.group && l.text === name);
    await click(g.row);
    let count = 0, lastSeen = null, stuck = 0;
    const seen = new Set(), wasChecked = new Set(), fails = new Map();
    let repeats = 0;
    for (;;) {
      s = await snap();
      if (await handleDialog(s)) continue;
      const gi = s.lines.findIndex((l) => l.group && l.text === name);
      const start = gi < 0 ? 0 : gi + 1;
      let end = s.lines.findIndex((l, i) => i >= start && l.group);
      const reachedNext = end >= 0;
      if (!reachedNext) end = s.lines.length;
      for (const l of s.lines.slice(start, end)) {
        if (!seen.has(l.text) && l.checked) wasChecked.add(l.text);
        seen.add(l.text);
      }
      const todo = s.lines.slice(start, end).filter((l) => !l.checked && (fails.get(l.text) || 0) < 2);
      for (const l of todo) {
        if (await tick(l.text)) count++;
        else if (!(await snap()).lines.find((x) => x.text === l.text && x.checked)) fails.set(l.text, (fails.get(l.text) || 0) + 1);
      }
      if (todo.length && ++repeats < 6) continue; // перепроверить ту же страницу
      repeats = 0;
      if (reachedNext) break;
      const last = s.lines[s.lines.length - 1];
      if (last.text === lastSeen && ++stuck >= 3) break; // конец списка: PageDown больше не двигает
      if (last.text !== lastSeen) stuck = 0;
      lastSeen = last.text;
      // Курсор на последнюю видимую строку группы и PageDown (быстрые серии стрелок 1С теряет).
      const own = s.lines.slice(start, end).filter((l) => !l.group);
      const anchor = own[own.length - 1] || last;
      await click(anchor.row);
      await sleep(300);
      await page.keyboard.press('PageDown');
      await sleep(900);
    }
    total += count;
    const failed = [...fails].filter(([, n]) => n >= 2).map(([t]) => t);
    log(`${name}: строк ${seen.size}, уже было отмечено ${wasChecked.size}, отмечено сейчас ${count}` +
      (failed.length ? `, не отметились ${failed.length}: ${failed.slice(0, 5).join('; ')}` : ''));
    await setExpanded(name, false);
  }

  log(`Готово, отмечено объектов: ${total}.`);

  // Вкладка «Авторизация»: включить отдельного пользователя и поставить курсор в поле пароля.
  // Пароль вводит человек; скрипт его не знает и не вводит.
  try {
    const authTab = page.locator('[id^="thpage_"][id$="_Авторизация"]').first();
    if (await authTab.isVisible().catch(() => false)) await authTab.click({ timeout: 5000 });
    else await page.getByText('Авторизация', { exact: true }).first().click({ timeout: 5000 });
    await sleep(800);
    const flag = page.getByText('Создать для использования автоматического REST-сервиса отдельные имя пользователя и пароль').first();
    // Если поля имени и пароля уже видны, отдельный пользователь включён: не трогать флажок/переключатель
    // (в «Рознице» это переключатель, и его состояние по классу .checkbox не читается).
    const enabled = await page.getByText('Имя пользователя:', { exact: true }).first().isVisible().catch(() => false);
    const box = enabled ? null : await flag.boundingBox();
    if (box) {
      // Галочка стоит слева от подписи.
      const checked = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)?.closest('.checkbox, [class*="check"]');
        return el ? /\bselect\b/.test(el.className) : null;
      }, { x: box.x - 8, y: box.y + box.height / 2 });
      if (checked === false || checked === null) await page.mouse.click(box.x - 8, box.y + box.height / 2);
      await sleep(800);
    }
    const pass = page.getByText('Пароль:', { exact: true }).first();
    const pb = await pass.boundingBox();
    if (pb) await page.mouse.click(pb.x + pb.width + 60, pb.y + pb.height / 2);
    log('Открыта вкладка «Авторизация». Введите пароль и подтверждение, затем «Сохранить и закрыть».');
  } catch (e) {
    log('Вкладку «Авторизация» открыть не удалось:', String(e).slice(0, 120));
    log('Вручную: «Авторизация» — флажок отдельного пользователя, пароль, «Сохранить и закрыть».');
  }
  log('Скрипт закончил. Окно остаётся открытым.');
  process.exit(0);
}

main().catch((e) => { console.error(e); log('Ошибка; окно остаётся открытым.'); process.exit(1); });
