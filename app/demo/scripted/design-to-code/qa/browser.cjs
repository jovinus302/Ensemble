// Actual local Chromium clicks. Point ENSEMBLE_PLAYWRIGHT_PATH at an existing installation.
const { chromium } = require(process.env.ENSEMBLE_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
(async () => {
 const base = process.env.ENSEMBLE_DEMO_URL || 'http://127.0.0.1:3497';
 const output=path.resolve(__dirname, '../../../../../.local/qa/handoff'); fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}); page.setDefaultTimeout(12000);
  const errors=[],api=[],external=[],checks=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(r.url().includes('/api/'))api.push(r.url());if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(r.url());});
  const click=name=>page.getByRole('button',{name,exact:true}).click();
  const phase=p=>page.locator(`.hf[data-phase="${p}"]`).waitFor();
  const shot=async name=>{await page.waitForTimeout(450);await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});};
  const overflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const reset=async()=>{await click('처음부터');await phase('discussion');};
  const agree=async(choice='resend',privacy=false)=>{await click(choice==='resend'?'60초 안내 후 재발송하죠':'기존 로그인으로 돌아가죠');await phase('proposal');if(privacy)await click('이메일도 가려주세요');await click('이 안에 동의해요');await phase('consent');await click('구현 가능해요 · 합의');await phase('ux-ready');};
  const ux=async()=>{await click('내 UX Agent와 초안 만들기');await phase('ux-draft');assert.match(await page.locator('.hf-current-label').innerText(),/아직 변경 없음/);await click('UX 초안을 팀에 공유');await phase('code-ready');};
  const code=async(version=1,focus=false)=>{await click(`내 Coding Agent와 ${version>1?'수정하기':'구현하기'}`);await phase('code-draft');await page.getByRole('checkbox').setChecked(focus);await page.getByRole('button',{name:`구현 v${version} 팀에 공유`,exact:true}).dblclick();await phase('qa-ready');await click('공유된 구현 기준 확인');await phase(focus?'review':'changes');};
  await page.goto(base + '/demo/design-to-code');await phase('discussion');await overflow();
  assert.equal(await page.locator('.hf-message.pm').count(),0,'PM does not speak before discussion');
  assert.equal(await page.locator('.hf-sidebar .person img').count(),2);
  assert.equal(await page.locator('.hf-avatar img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)),true);
  await shot('ux-discussion');
  await click('기존 로그인으로 돌아가죠');await phase('proposal');await click('다른 경로도 비교해요');await phase('discussion');
  assert.equal(await page.getByRole('button',{name:'내 UX Agent와 초안 만들기',exact:true}).count(),0);
  await click('60초 안내 후 재발송하죠');await click('이메일도 가려주세요');await phase('proposal');
  assert.match(await page.locator('.hf-card.proposal').last().innerText(),/이메일 가리기/);
  await page.locator('.hf-card.proposal').last().locator('summary').click();assert.match(await page.locator('.hf-card.proposal').last().innerText(),/공용 화면/);await page.locator('.hf-card.proposal').last().locator('summary').click();await shot('ux-consensus');
  await click('이 안에 동의해요');await phase('consent');await page.waitForTimeout(1300);await phase('consent');
  await page.getByRole('button',{name:'구현 가능해요 · 합의',exact:true}).dblclick();await phase('ux-ready');
  await ux();assert.match(await page.locator('.hf-state .hf-preview').innerText(),/s\*\*\*@example.com/);assert.match(await page.locator('.hf-state .hf-preview').innerText(),/60초/);
  await code(1,false);assert.equal(await page.locator('.hf-card.qa.fail').count(),1);await shot('ux-qa-feedback');
  await click('QA 근거를 받아 보완하기');await phase('code-ready');
  await page.locator('.hf-stale summary').click();await click('이전 검토 승인 시도');await phase('code-ready');
  await click('내 Coding Agent와 수정하기');await phase('code-draft');
  await click('이전 결과 재공유 시도');await phase('code-draft');assert.match(await page.locator('.hf-notice').innerText(),/이전 v1/);
  await click('공유 전 결과 보기 ↗');await page.getByRole('dialog').waitFor();await click('오류 후 포커스 확인');
  await page.locator('.hf-dialog .hf-recovery:focus').waitFor();
  assert.equal(await page.getByRole('button',{name:'새 링크 다시 받기',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'공유 전 결과 보기 ↗',exact:true}).and(page.locator(':focus')).waitFor();
  assert.equal(await page.getByRole('button',{name:'공유 전 결과 보기 ↗',exact:true}).evaluate(el=>el===document.activeElement),true);
  await click('구현 v2 팀에 공유');await click('공유된 구현 기준 확인');await phase('review');
  await click('버튼 문구 수정 요청');await phase('code-ready');await code(3,true);
  assert.match(await page.locator('.hf-state .hf-preview').innerText(),/새 로그인 링크 받기/);await shot('ux-artifact-review');
  await page.getByRole('button',{name:'이 버전 승인 · 다음 일로',exact:true}).dblclick();await phase('handed');assert.equal(await page.locator('.hf-card.handoff').count(),1);
  await click('이전 상태');await phase('review');await click('다음 상태');await phase('handed');await shot('ux-handoff');
  checks.push('human discussion, objection, privacy constraint, both consents','shared UX -> Coding -> failing QA -> scoped repair','human revision changes artifact, current-version approval only','double agreement/share/approval','old result/approval blocked','preview keyboard focus and Escape restoration','undo/redo preserves decisions/artifact');
  // Each asynchronous stage is interrupted and then observed beyond its callback deadline.
  for(const target of ['ux','code','qa'])for(const interruption of ['진행 취소','처음부터']){
   await reset();await agree();if(target!=='ux')await ux();if(target==='qa'){await click('내 Coding Agent와 구현하기');await phase('code-draft');await click('구현 v1 팀에 공유');}
   await click(target==='ux'?'내 UX Agent와 초안 만들기':target==='code'?'내 Coding Agent와 구현하기':'공유된 구현 기준 확인');await phase(target+'-running');await click(interruption);await page.waitForTimeout(1250);await phase(interruption==='처음부터'?'discussion':target+'-ready');
  }
  await reset();await agree('login');await ux();await code(1,true);assert.match(await page.locator('.hf-state .hf-preview').innerText(),/로그인으로 돌아가기/);assert.doesNotMatch(await page.locator('.hf-state .hf-preview').innerText(),/60초/);
  await click('이 버전 승인 · 다음 일로');await phase('handed');checks.push('alternate login route artifact','cancel/reset invalidate UX/Coding/QA callbacks');
  await reset();await agree();await click('내 UX Agent와 초안 만들기');await page.getByRole('link',{name:'PM 조율 데모 ↗'}).click();await page.waitForURL('**/demo/pm-coordination',{waitUntil:'networkidle'});await page.goBack({waitUntil:'networkidle'});await phase('discussion');await page.waitForTimeout(1250);await phase('discussion');await page.goForward({waitUntil:'networkidle'});await page.goBack({waitUntil:'networkidle'});await phase('discussion');checks.push('browser Back/Forward during callback');
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await reset();await agree('resend',true);await overflow();await ux();await code(1,true);await overflow();await shot(`ux-mobile-${width}`);await click('이 버전 승인 · 다음 일로');await phase('handed');await overflow();}
  await page.setViewportSize({width:720,height:500});await reset();await agree();await overflow();await shot('ux-zoom-200-equivalent');checks.push('390/320 mobile full flow, no horizontal overflow','200% equivalent 720px reflow, readable Korean wrapping');
  const fallback=await browser.newPage({viewport:{width:1440,height:1000}});await fallback.route('**/*-generated*.png',r=>r.abort());await fallback.goto(base + '/demo/design-to-code');await fallback.getByRole('img',{name:'이지윤 사진 대체 아바타'}).first().waitFor();assert.equal(await fallback.locator('.hf-avatar.person img').count(),0);await fallback.close();checks.push('portrait load failure fallback and accessible names');
  assert.deepEqual(errors,[]);assert.deepEqual(api,[]);assert.deepEqual(external,[]);
  const result={passed:true,browser:await browser.version(),checks,errors,api,external};fs.writeFileSync(path.join(output,'ux-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
