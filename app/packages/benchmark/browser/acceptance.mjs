import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Real browser checks; contains no provider calls. Artifacts use neutral filenames. */
export async function inspect(url, { task = 'A', checkpoint = false, outputDir, signal } = {}) {
  const modulePath = process.env.BENCH_PLAYWRIGHT;
  const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright');
  const browser = await chromium.launch({ headless: true });
  const checks = []; const errors = [];
  const abort = () => { void browser.close(); }; signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const context = await browser.newContext(); const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  // HTTP fixture failures are intentionally exercised; only unrelated console errors fail.
  page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource: the server responded with a status of (409|503)/.test(msg.text())) errors.push(msg.text()); });
  const control = id => page.getByTestId(id);
  const check = async (id, operation) => { try { await operation(); checks.push({ id, pass: true }); } catch (error) { checks.push({ id, pass: false, detail: String(error.message) }); } };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const fresh = async () => { await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.reload(); };
  const setGuests = async n => { const tag = await control('guests').evaluate(el => el.tagName); if (tag === 'SELECT') await control('guests').selectOption(String(n)); else await control('guests').fill(String(n)); };
  const fill = async (date, time, guests) => { await control('date').fill(date); await setGuests(guests); const tag = await control('time').evaluate(el => el.tagName); if (tag === 'SELECT') await control('time').selectOption(time); else await control('time').fill(time); };
  const confirmation = async (date, time, guests) => { await control('confirmation').waitFor({ state: 'visible' }); const text = await control('confirmation').innerText(); assert(text.includes(date) && text.includes(time) && new RegExp(`\\b${guests}\\b`).test(text), 'Confirmation does not match selected reservation'); };
  try {
    await check('checkpoint.selection', async () => { await fresh(); await fill('2030-06-17', '17:00', 6); assert(await control('date').inputValue() === '2030-06-17' && await control('time').inputValue() === '17:00' && await control('guests').inputValue() === '6', 'Inputs must retain real selections'); });
    if (!checkpoint) {
      await check('required-fields.blocked', async () => { await fresh(); await control('submit').click(); await page.waitForTimeout(400); assert(!await control('confirmation').isVisible(), 'Empty date/time confirmed'); });
      await check('party.one-through-six', async () => { await fresh(); for (let n = 1; n <= 6; n++) { await setGuests(n); assert(await control('guests').inputValue() === String(n), `Party size ${n} unavailable`); } });
      for (const [id, date, time, pattern] of [['sold-out', '2030-06-15', '19:00', /sold|full|만석/i], ['service-error', '2030-06-16', '18:00', /error|unavailable|try|오류|다시/i]]) {
        await check(id, async () => { await fresh(); await fill(date, time, 2); await control('submit').click(); await control('message').filter({ hasText: pattern }).waitFor(); assert(!await control('confirmation').isVisible(), 'Failure must not confirm reservation'); });
      }
      await check('confirmation.persistence', async () => { await fresh(); await fill('2030-06-17', '19:00', 6); await control('submit').click(); await confirmation('2030-06-17','19:00',6); await page.reload(); await confirmation('2030-06-17','19:00',6); });
      await check('invalid-party.blocked', async () => { await fresh(); await fill('2030-06-17','19:00',2); const n = task === 'B' ? 9 : 7; const tag = await control('guests').evaluate(el => el.tagName); if (tag === 'SELECT') { assert(await control('guests').locator(`option[value="${n}"]:not([disabled])`).count() === 0, 'Invalid party size remains selectable'); return; } await setGuests(n); await control('submit').click(); await page.waitForTimeout(400); assert(!await control('confirmation').isVisible(), 'Invalid party size confirmed'); });
      if (task === 'B') {
        await check('change.large-party-early-blocked', async () => {
          for (const guests of [7, 8]) {
            await fresh(); await control('date').fill('2030-06-17'); await setGuests(guests);
            const tag = await control('time').evaluate(el => el.tagName);
            if (tag === 'SELECT' && await control('time').locator('option[value="17:00"]:not([disabled])').count() === 0) continue;
            if (tag === 'SELECT') await control('time').selectOption('17:00'); else await control('time').fill('17:00');
            await control('submit').click(); await page.waitForTimeout(400);
            assert(!await control('confirmation').isVisible(), `${guests} guests confirmed before 18:00`);
          }
        });
        await check('change.six-to-seven-clears-time', async () => { await fresh(); await fill('2030-06-17','17:00',6); await setGuests(7); assert(await control('time').inputValue() === '', 'Early selection was not cleared'); assert(/18|6|이후|later/i.test(await control('message').innerText()), 'Missing explanation for cleared time'); });
        await check('change.eight-evening-and-edit', async () => { await fresh(); await fill('2030-06-17','18:00',8); await control('submit').click(); await confirmation('2030-06-17','18:00',8); await control('edit').click(); await fill('2030-06-18','20:00',7); await control('submit').click(); await confirmation('2030-06-18','20:00',7); await page.reload(); await confirmation('2030-06-18','20:00',7); });
      }
      for (const width of [390, 1440]) await check(`viewport.${width}`, async () => { await page.setViewportSize({ width, height: 900 }); await fresh(); await fill('2030-06-17','19:00',2); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal document overflow'); for (const id of ['date','time','guests','submit']) { const box = await control(id).boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= width, `${id} clipped`); } if (outputDir) { await mkdir(outputDir, { recursive: true }); await page.screenshot({ path: resolve(outputDir, `viewport-${width}.png`), fullPage: true }); } });
    }
    checks.push({ id: 'console.clean', pass: errors.length === 0, ...(errors.length ? { detail: errors.join('\n') } : {}) });
  } finally { signal?.removeEventListener('abort', abort); await browser.close(); }
  return { checks, passed: checks.every(check => check.pass) };
}

