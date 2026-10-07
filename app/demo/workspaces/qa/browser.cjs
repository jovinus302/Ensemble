const { chromium } = require(process.env.ENSEMBLE_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.ENSEMBLE_DEMO_URL || 'http://127.0.0.1:3000';
const out = path.resolve(__dirname, '../../../../.local/qa/workspaces');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.ENSEMBLE_BROWSER || 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [], api = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) api.push(url.pathname);
      if (url.origin !== new URL(base).origin && /^https?:/.test(url.protocol)) external.push(url.href);
    });
    const rail = page.getByRole('complementary', { name: '프로젝트 맥락 보조 뷰' });
    const nav = page.getByRole('navigation', { name: '작업 공간 선택' });
    const choose = name => nav.getByRole('button', { name: new RegExp(name) }).click();
    const share = () => page.getByRole('button', { name: '결과를 프로젝트에 공유', exact: true }).click();
    const connect = () => page.getByRole('button', { name: '결정을 프로젝트에 연결', exact: true }).click();
    const reset = () => page.getByRole('button', { name: '처음부터', exact: true }).click();
    await page.goto(base + '/demo');
    await page.getByRole('heading', { name: '맥락을 이해하고,' }).waitFor();
    assert.match(await rail.innerText(), /0 \/ 2 연결/);
    await page.screenshot({ path: path.join(out, 'desktop-initial.png'), fullPage: true });
    await choose('디자인'); await share();
    assert.match(await rail.innerText(), /1 \/ 2 연결/);
    await choose('개발'); await share();
    assert.match(await rail.innerText(), /2 \/ 2 연결/);
    assert.equal(await page.getByRole('button', { name: '✓ 프로젝트에 연결됨', exact: true }).isDisabled(), true);
    await choose('Slack'); await connect();
    await choose('미팅'); await connect();
    assert.equal(await rail.getByRole('button', { name: /작업으로/ }).count(), 2);
    await rail.getByRole('button', { name: '개발 작업으로 →' }).click();
    assert.match(await page.locator('.wd-work-title').innerText(), /로그인 기능/);
    assert.equal(await page.locator('.wd-work-title').evaluate(el => el === document.activeElement), true);
    assert.match(await page.locator('.wd-code').innerText(), /resetForm/);
    await page.getByRole('button', { name: '결정을 반영한 결과 확인', exact: true }).click();
    assert.doesNotMatch(await page.locator('.wd-code').innerText(), /resetForm/);
    assert.match(await rail.innerText(), /산출물 v2 · 결정 반영 확인/);
    assert.match(await rail.innerText(), /산출물 v1 · 미팅 결정 반영 필요/);
    const artifactButton = rail.getByRole('button', { name: /로그인 구현.*v2/ });
    await artifactButton.click();
    await page.getByRole('dialog').waitFor();
    assert.match(await page.getByRole('dialog').innerText(), /미팅|리뷰 결정 01/);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').isVisible(), false);
    assert.equal(await artifactButton.evaluate(el => el === document.activeElement), true);
    await page.getByRole('button', { name: '보조 뷰 숨기기' }).click();
    assert.equal(await rail.isVisible(), false);
    await choose('디자인');
    await page.getByRole('button', { name: '결정을 반영한 결과 확인', exact: true }).click();
    assert.match(await page.locator('.wd-login').innerText(), /hello@example.com/);
    await page.getByRole('button', { name: '보조 뷰 보기' }).click();
    assert.match(await rail.innerText(), /최종 검토는 아직 남아/);
    assert.equal(await rail.getByRole('button', { name: /작업으로/ }).count(), 0);
    await page.screenshot({ path: path.join(out, 'desktop-connected.png'), fullPage: true });
    await rail.getByRole('button', { name: /로그인 리뷰 · 결정 01/ }).click();
    assert.match(await page.locator('.wd-work-title').innerText(), /리뷰/);
    await reset();
    assert.match(await rail.innerText(), /0 \/ 2 연결/);
    // Meeting before work: cannot mark an unshared artifact as reflected.
    await choose('미팅'); await connect(); await choose('개발');
    assert.equal(await page.getByRole('button', { name: '결정을 반영한 결과 확인', exact: true }).isDisabled(), true);
    await share();
    assert.equal(await page.getByRole('button', { name: '결정을 반영한 결과 확인', exact: true }).isEnabled(), true);
    await page.reload();
    assert.match(await rail.innerText(), /0 \/ 2 연결/);
    // Other share order and keyboard-only source selection.
    await share();
    await nav.getByRole('button', { name: /디자인/ }).focus(); await page.keyboard.press('Enter');
    await share();
    assert.match(await rail.innerText(), /2 \/ 2 연결/);
    for (const width of [390, 760, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow at ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await choose('미팅'); await connect(); await choose('디자인');
    await page.getByRole('button', { name: '결정을 반영한 결과 확인', exact: true }).click();
    await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
    await rail.getByRole('button', { name: /로그인 디자인.*v2/ }).click();
    assert.equal(await page.getByRole('dialog').isVisible(), true);
    await page.getByRole('button', { name: '산출물 닫기' }).click();
    for (const old of ['/demo/design-to-code', '/demo/marketing-campaign', '/demo/pm-coordination', '/s27', '/handoff']) {
      await page.goto(base + old);
      await page.waitForURL(base + '/demo');
      await page.getByRole('heading', { name: '맥락을 이해하고,' }).waitFor();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(api, []);
    assert.deepEqual(external, []);
    console.log('PASS: independent sharing, provenance, pending revisions, artifact content, keyboard, reset/reload, mobile, legacy URLs; no API/external requests or page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
