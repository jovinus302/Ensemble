const {chromium}=require(process.env.ENSEMBLE_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const base=process.env.ENSEMBLE_DEMO_URL||'http://127.0.0.1:3000';
(async()=>{const browser=await chromium.launch({channel:process.env.ENSEMBLE_BROWSER||'msedge',headless:true});try{
const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(base+'/demo?mock=1');await page.getByRole('heading',{name:'작업과 담당',exact:true}).waitFor();
const state=await (await page.request.get(base+'/api/state?me=owner')).json();
assert.match(await page.locator('.pd-note').first().innerText(),new RegExp('작업 Agent: '+state.connection.worker));
assert.equal(await page.getByRole('navigation',{name:'작업 공간 선택'}).count(),0);
assert.equal(await page.locator('.pd-task').count(),state.work?.items.length??0);
assert.equal(await page.locator('.pd-metrics strong').first().innerText(),String(state.work?.items.length??0));
const artifacts=[...new Map(state.messages.flatMap(m=>m.attachments).map(a=>[a.id,a])).values()];
for(const a of artifacts){await page.getByRole('link',{name:a.name+' ↗',exact:true}).waitFor();const response=await page.request.get(base+a.url);assert.equal(response.ok(),true);assert.ok((await response.body()).length>0);}
const out=path.resolve(__dirname,'../../../../.local/qa/dashboard');fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
for(const width of [390,760,1024]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));}
await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
for(const route of ['/s27','/handoff','/demo/design-to-code','/demo/marketing-campaign','/demo/pm-coordination']){await page.goto(base+route);await page.waitForURL('**/demo');}
await page.route('**/api/state*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'검증용 연결 실패'}})}));
await page.reload();await page.locator('.pm-dashboard [role=alert]').waitFor();assert.equal(await page.locator('.pd-task').count(),0);
assert.deepEqual(errors,[]);console.log('PASS: real state API, mock disabled, dashboard only, responsive layouts, redirects, server error without fixtures');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
