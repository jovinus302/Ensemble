// Local browser QA. Use an existing Playwright installation; no provider calls.
const { chromium } = require(process.env.ENSEMBLE_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const output = path.resolve('../docs/qa/pm-handoff-2026-10-05');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], api = [], external = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', r => { if (r.url().includes('/api/')) api.push(r.url()); if (!r.url().startsWith('http://127.0.0.1:3497') && !r.url().startsWith('data:')) external.push(r.url()); });
    const click = name => page.getByRole('button', { name, exact: true }).click();
    const phase = name => page.locator(`.th[data-phase="${name}"]`).waitFor();
    const shot = async name => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true }); };
    const work = async () => { await click('내 Coding Agent와 작업하기'); await phase('draft'); };
    const share = async () => { await click('T-1에 결과와 근거 공유'); await phase('review'); };
    const reset = async () => { await click('처음부터'); await phase('assigned'); };
    await page.goto('http://127.0.0.1:3497/handoff'); await phase('assigned');
    await shot('desktop-assignment');
    await work();
    assert.match(await page.getByLabel('팀 작업 상태').innerText(), /팀에 공유된 산출물 없음/);
    assert.equal(await page.locator('.fd-message').count(), 2);
    await click('공유할 결과 미리보기'); await page.getByRole('dialog').waitFor(); await shot('desktop-artifact');
    await page.keyboard.press('Tab'); assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: '공유할 결과 미리보기', exact: true }).evaluate(el => el === document.activeElement), true);
    // Two physical clicks in one event turn: same-version share is accepted once.
    await page.getByRole('button', { name: 'T-1에 결과와 근거 공유', exact: true }).dblclick(); await phase('review');
    assert.equal(await page.locator('.fd-message.own').count(), 2);
    await page.waitForTimeout(1600); await phase('review');
    await shot('desktop-review');
    await page.getByRole('button', { name: '검토 승인 · 다음 담당에게', exact: true }).dblclick(); await phase('handed');
    assert.equal(await page.locator('.fd-message.agent').count(), 1); await shot('desktop-handoff');
    await reset(); await work(); await share(); await click('수정 요청 · 포커스 복귀'); await phase('changes');
    assert.equal(await page.locator('.fd-message.agent').count(), 0);
    await page.getByText('이전 버전 확인 · v1', { exact: true }).click();
    await click('이전 검토 승인 시도'); await phase('changes');
    await click('내 Agent와 수정하기'); await phase('draft');
    await click('이전 결과 재공유 시도'); await phase('draft');
    assert.match(await page.locator('.th-notice').innerText(), /이전 결과/);
    await share(); await click('이전 검토 승인 시도'); await phase('review');
    await shot('desktop-revision'); await click('검토 승인 · 다음 담당에게'); await phase('handed');
    assert.match(await page.locator('.th-ready').innerText(), /v2/);
    // Cancel and reset during each asynchronous phase, then wait past its callback.
    for (const mode of ['working', 'checking']) {
      for (const interrupt of ['진행 취소', '처음부터']) {
        await reset();
        if (mode === 'checking') { await work(); await click('T-1에 결과와 근거 공유'); await phase('checking'); }
        else { await click('내 Coding Agent와 작업하기'); await phase('working'); }
        await click(interrupt); await page.waitForTimeout(1700);
        await phase(mode === 'checking' && interrupt === '진행 취소' ? 'draft' : 'assigned');
        if (mode === 'checking' && interrupt === '진행 취소') {
          await share(); assert.equal(await page.locator('.fd-message.own').count(), 2);
        }
      }
    }
    // Browser Back/Forward across route departure while a callback is pending.
    await reset(); await click('내 Coding Agent와 작업하기');
    await page.getByRole('link', { name: 'Pages 데모 ↗' }).click();
    await page.waitForURL('**/demo', { waitUntil: 'networkidle' }); await page.goBack({ waitUntil: 'networkidle' }); await phase('assigned');
    await page.waitForTimeout(1700); await phase('assigned');
    await page.goForward({ waitUntil: 'networkidle' }); await page.waitForURL('**/demo', { waitUntil: 'networkidle' }); await page.goBack({ waitUntil: 'networkidle' }); await phase('assigned');
    await page.reload(); await phase('assigned');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 }); await reset(); await work(); await share();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
      await shot(`mobile-${width}-review`); await click('검토 승인 · 다음 담당에게'); await phase('handed');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await shot(`mobile-${width}-handoff`);
    }
    assert.deepEqual(errors, []); assert.deepEqual(api, []); assert.deepEqual(external, []);
    const result = { passed: true, browser: await browser.version(), checks: ['normal handoff', 'private output not shared automatically', 'review gate waits', 'reject and revise', 'duplicate share and approval', 'stale result and stale approval', 'cancel/reset during work and PM check', 'cancel and reshare deduplicated', 'browser Back/Forward with pending callback', 'reload resets', '1440px desktop and 390px/320px mobile'], errors, api, external };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
