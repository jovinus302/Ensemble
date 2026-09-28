// 렌더된 DOM·픽셀·회귀 증거를 판정한다. motion-remotion에서 실행.
import {readFile, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir = 'review/v4-pm-motion';
const frames = JSON.parse(await readFile(`${dir}/frames.json`, 'utf8'));
const at = n => {const f = frames.find(f => f.frame === n); assert(f, `${n}f 관찰 누락`); return f;};
const has = (n, id) => at(n).events.some(e => e.id === id);
const results = [];
const check = (name, fn) => {fn(); results.push({name, verdict:'PASS'});};
check('착지 직후 PM 답장과 지휘 중', () => {
  assert(!has(209,'opening-reply')); assert(has(222,'opening-reply')); assert(at(222).pmActive);
  assert(has(270,'goal')); assert(has(270,'opening-reply'));
});
check('부족 → 보완 → 인계 → 제작의 순서', () => {
  for (const [before, after, id] of [[869,890,'draft-r2'],[929,950,'handoff-checked'],[989,1010,'agent-started']]) {assert(!has(before,id)); assert(has(after,id));}
  assert(has(830,'missing-input')); assert(has(1010,'draft-r2')); assert(has(1010,'handoff-checked'));
});
check('사람의 대화와 권한 결정 뒤 PM 조율', () => {
  assert(has(1070,'holiday')); assert(!has(1070,'impact'));
  assert(has(1115,'deadline-question')); assert(!has(1115,'impact'));
  assert(has(1180,'impact')); assert(has(1235,'time-commitment')); assert(has(1280,'scope-excluded'));
  assert(!has(1280,'change')); assert(has(1345,'change'));
  assert(has(790,'scope-included'));
});
check('변경 전달·확인과 결과 반영 분리', () => {
  assert(has(1412,'update-sent')); assert(!has(1412,'update-ack'));
  assert(has(1445,'update-ack')); assert(!has(1445,'result-compared'));
  assert.match(at(1445).roadmap,/결과 반영 대기/);
  assert(has(1478,'result-r3')); assert(!has(1478,'result-compared'));
  assert(has(1510,'result-r3')); assert(has(1510,'result-compared'));
  assert.match(at(1510).events.find(e=>e.id==='result-r3').text,/결제 흐름 제외/);
  assert.match(at(1510).roadmap,/변경 결과 반영 확인/);
});
const oldY = at(830).events.find(e=>e.id==='missing-input').y;
const newY = at(890).events.find(e=>e.id==='missing-input').y;
check('새 메시지 이후 이전 대화가 위로 이동하고 누적 유지', () => {
  assert(newY < oldY); assert(has(890,'draft-r2')); assert(has(890,'missing-input'));
  assert(at(890).scroll > at(830).scroll);
  assert.equal(at(830).sha256,at(869).sha256);
  assert.equal(at(890).sha256,at(929).sha256);
});
check('중앙 카피 2초와 마지막 2초 정지', () => {
  assert.equal(at(120).sha256,at(150).sha256); assert.equal(at(150).sha256,at(179).sha256);
  assert.equal(at(1650).sha256,at(1680).sha256); assert.equal(at(1680).sha256,at(1709).sha256);
  const h=at(150).headlines;
  assert(Math.abs((Math.min(...h.map(x=>x.rect[0]))+Math.max(...h.map(x=>x.rect[2])))/2-960)<1);
  assert(Math.abs((Math.min(...h.map(x=>x.rect[1]))+Math.max(...h.map(x=>x.rect[3])))/2-540)<1);
});
const rotationFrames=at(0).audit.rotation.filter(x=>Math.abs(x.pose.ry)>=5&&Math.abs(x.pose.ry)<=25).length;
check('회전 통과와 기능 비트 정면', () => {
  assert(rotationFrames<=12);
  for(const f of frames.filter(f=>f.frame>=210&&f.frame<1530)) assert.deepEqual([f.pose.rx,f.pose.ry,f.pose.rz],[0,0,0]);
  for(const s of at(0).audit.segments) {
    const sample=frames.find(f=>f.frame>s.start+6&&f.frame<s.end-6&&f.headlines.length);
    const text=sample.headlines.map(x=>x.text).join(' ');
    assert([...text].length<=18);
    assert((s.end-s.start-12)/30>=Math.max(1.2,text.split(' ').length/3+.5));
  }
});
const readable=frames.filter(f=>f.frame>=210&&f.frame<1530);
const bodyMin=Math.min(...readable.flatMap(f=>f.texts.filter(t=>t.role==='body').map(t=>t.font)));
const secondaryMin=Math.min(...readable.flatMap(f=>f.texts.filter(t=>t.role==='secondary').map(t=>t.font)));
const chipMin=Math.min(...readable.flatMap(f=>f.chips.map(c=>c.height)));
const anchors=readable.filter(f=>f.anchorError!==null);
check('가독성·콜아웃·부상 투영', () => {
  assert(bodyMin>=20); assert(secondaryMin>=18); assert(chipMin>=36);
  assert(readable.every(f=>!f.calloutOverlap&&f.texts.every(t=>!t.overflow)));
  assert(anchors.some(f=>f.hero.rise>0&&f.hero.rise<1)); assert(anchors.some(f=>f.hero.rise===1));
  assert(anchors.every(f=>f.anchorError<=1));
});
const regression=JSON.parse(await readFile(`${dir}/regression.json`,'utf8'));
check('기존 v4 4장·v4-pm 9장 픽셀 회귀',()=>{assert.equal(regression.length,13);assert(regression.every(r=>r.identical));});
await writeFile(`${dir}/verification.json`,JSON.stringify({verdict:'PASS',sampledFrames:frames.length,results,measurements:{oldMessageYBefore:oldY,oldMessageYAfter:newY,upwardPixels:oldY-newY,rotationIntermediateFrames:rotationFrames,bodyMin,secondaryMin,heroChipHeightMin:chipMin,anchorMax:Math.max(...anchors.map(f=>f.anchorError))}},null,2));
console.log(JSON.stringify({verdict:'PASS',checks:results.length,frames:frames.length,bodyMin,secondaryMin,chipMin,rotationFrames}));
