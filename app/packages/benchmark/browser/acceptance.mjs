import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Supported display dates: ISO YYYY-MM-DD and English named months (June 17, 2030;
 * 17 June 2030), with optional weekday and abbreviated month. Numeric slash dates
 * and arbitrary Date.parse strings are deliberately unsupported/ambiguous.
 * Time: HH:mm or h:mm AM/PM. Guests must be explicitly labeled guests/people/party.
 * Multiple recognized values must agree: a correct hidden/fallback date cannot
 * excuse an incorrect displayed date. Only visible confirmation innerText is used.
 */
export function confirmationMatches(text, expected) {
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const dates = [...text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)].map(m => `${m[1]}-${m[2]}-${m[3]}`);
  const month = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?';
  const iso = (y, m, d) => `${y}-${String(months.indexOf(m.slice(0,3).toLowerCase()) + 1).padStart(2,'0')}-${String(Number(d)).padStart(2,'0')}`;
  for (const m of text.matchAll(new RegExp(`\\b${month}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi'))) dates.push(iso(m[3],m[1],m[2]));
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})\\s+${month},?\\s+(\\d{4})\\b`, 'gi'))) dates.push(iso(m[3],m[2],m[1]));
  const times = [...text.matchAll(/\b(\d{1,2}):(\d{2})(?:\s*(AM|PM))?\b/gi)].map(m => {
    let h = Number(m[1]); if (Number(m[2]) > 59 || (m[3] ? h < 1 || h > 12 : h > 23)) return 'invalid';
    if (m[3]) h = h % 12 + (m[3].toUpperCase() === 'PM' ? 12 : 0);
    return `${String(h).padStart(2,'0')}:${m[2]}`;
  });
  // Count-before-label must stay on one line; otherwise "19:00\nGuests\n6"
  // would accidentally interpret the time's minutes as a guest count.
  const guests = [...text.matchAll(/\b(\d+)[ \t]+(?:guests?|people|persons?)\b/gi)].map(m => Number(m[1]));
  for (const m of text.matchAll(/\b(?:guests?|people|persons?|party(?:\s+size)?)(?:\s*[:\-]?\s*)(\d+)\b/gi)) guests.push(Number(m[1]));
  return dates.length > 0 && dates.every(d => d === expected.date) && times.length > 0 && times.every(t => t === expected.time)
    && guests.length > 0 && guests.every(n => n === Number(expected.guests));
}

/** Real browser checks; contains no provider calls. Artifacts use neutral filenames. */
export async function inspect(url, { task = 'A', checkpoint = false, outputDir, signal } = {}) {
  const modulePath = process.env.BENCH_PLAYWRIGHT;
  const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright');
  const browser = await chromium.launch({ headless: true });
  const checks = []; const errors = [];
  const abort = () => { void browser.close(); }; signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const createPage = async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const allowedOrigin = new URL(url).origin;
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === allowedOrigin) return route.continue();
    errors.push('Blocked request outside local fixture origin'); return route.abort('blockedbyclient');
  });
  if (typeof context.routeWebSocket !== 'function') { await browser.close(); throw new Error('Browser environment requires Playwright WebSocket routing for network isolation'); }
  await context.routeWebSocket('**/*', socket => {
    errors.push('Blocked WebSocket request'); socket.close();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  // HTTP fixture failures are intentionally exercised; only unrelated console errors fail.
  page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource: the server responded with a status of (409|503)/.test(msg.text())) errors.push(msg.text()); });
  return { context, page };
  };
  let { context, page } = await createPage();
  let used = false;
  const control = id => page.getByTestId(id);
  const check = async (id, operation) => { try { await operation(); checks.push({ id, pass: true }); } catch (error) { checks.push({ id, pass: false, detail: String(error.message) }); } };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  // A fresh scenario resets every storage backend; reload within a scenario retains it.
  const fresh = async () => { if (used) { await context.close(); ({ context, page } = await createPage()); } used = true; await page.goto(url); };
  const setGuests = async n => { const tag = await control('guests').evaluate(el => el.tagName); if (tag === 'SELECT') await control('guests').selectOption(String(n)); else await control('guests').fill(String(n)); };
  const fill = async (date, time, guests) => { await control('date').fill(date); await setGuests(guests); const tag = await control('time').evaluate(el => el.tagName); if (tag === 'SELECT') await control('time').selectOption(time); else await control('time').fill(time); };
  const confirmation = async (date, time, guests) => {
    await control('confirmation').waitFor({ state: 'visible' });
    assert(confirmationMatches(await control('confirmation').innerText(), { date, time, guests }), 'Visible confirmation date/time/guests do not match the reservation');

  };
  const restoredControls = async (date, time, guests) => {
    await control('edit').click();
    assert(await control('date').inputValue() === date && await control('time').inputValue() === time && Number(await control('guests').inputValue()) === guests,
      'Restored edit controls do not match the saved reservation');
  };
  const submitReservation = async (date, time, guests) => {
    const [request] = await Promise.all([
      page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === '/api/reservations'),
      control('submit').click(),
    ]);
    const payload = request.postDataJSON();
    assert(payload?.date === date && payload?.time === time && Number(payload?.guests) === guests, 'Saved API request date/time/guests do not match');
  };
  try {
    await check('checkpoint.selection', async () => { await fresh(); await fill('2030-06-17', '17:00', 6); assert(await control('date').inputValue() === '2030-06-17' && await control('time').inputValue() === '17:00' && await control('guests').inputValue() === '6', 'Inputs must retain real selections'); });
    if (!checkpoint) {
      await check('required-fields.blocked', async () => { await fresh(); await control('submit').click(); await page.waitForTimeout(400); assert(!await control('confirmation').isVisible(), 'Empty date/time confirmed'); });
      await check('party.one-through-six', async () => { await fresh(); for (let n = 1; n <= 6; n++) { await setGuests(n); assert(await control('guests').inputValue() === String(n), `Party size ${n} unavailable`); } });
      for (const [id, date, time, pattern] of [['sold-out', '2030-06-15', '19:00', /sold|full|만석/i], ['service-error', '2030-06-16', '18:00', /error|unavailable|try|오류|다시/i]]) {
        await check(id, async () => { await fresh(); await fill(date, time, 2); await control('submit').click(); await control('message').filter({ hasText: pattern }).waitFor(); assert(!await control('confirmation').isVisible(), 'Failure must not confirm reservation'); });
      }
      await check('confirmation.persistence', async () => {
        for (const [date, time, guests] of [['2030-06-17','19:00',6], ['2030-06-18','20:00',3]]) {
          await fresh(); await fill(date,time,guests); await submitReservation(date,time,guests);
          await confirmation(date,time,guests); await page.reload(); await confirmation(date,time,guests);
          // Editing is a Task B requirement; do not silently add it to Task A.
          if (task === 'B') await restoredControls(date,time,guests);
        }
      });
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
        await check('change.eight-evening-and-edit', async () => { await fresh(); await fill('2030-06-17','18:00',8); await submitReservation('2030-06-17','18:00',8); await confirmation('2030-06-17','18:00',8); await restoredControls('2030-06-17','18:00',8); await fill('2030-06-18','20:00',7); await submitReservation('2030-06-18','20:00',7); await confirmation('2030-06-18','20:00',7); await page.reload(); await confirmation('2030-06-18','20:00',7); await restoredControls('2030-06-18','20:00',7); });
      }
      for (const width of [390, 1440]) await check(`viewport.${width}`, async () => { await fresh(); await page.setViewportSize({ width, height: 900 }); await fill('2030-06-17','19:00',2); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal document overflow'); for (const id of ['date','time','guests','submit']) { const box = await control(id).boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= width, `${id} clipped`); } if (outputDir) { await mkdir(outputDir, { recursive: true }); await page.screenshot({ path: resolve(outputDir, `viewport-${width}.png`), fullPage: true }); } });
    }
    checks.push({ id: 'console.clean', pass: errors.length === 0, ...(errors.length ? { detail: errors.join('\n') } : {}) });
  } finally { signal?.removeEventListener('abort', abort); await browser.close(); }
  return { checks, passed: checks.every(check => check.pass) };
}
