// 완성 MP4를 다시 만들지 않고 전체 디코딩·대표 화면을 검증한다.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir='review/v4-pm-motion', ff='node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe';
const run=args=>{const p=spawnSync(ff,args,{encoding:'utf8',windowsHide:true});assert.equal(p.status,0,p.stderr);return p;};
run(['-v','error','-i','out/pitch-v4-pm.mp4','-c:v','rawvideo','-f','null','-']);
const info=JSON.parse(await readFile(`${dir}/video.json`,'utf8'));
info.fullDecode={codec:'rawvideo',exitCode:0};
assert.equal(createHash('sha256').update(await readFile('out/pitch-v4-pm.mp4')).digest('hex'),info.sha256);
await mkdir(`${dir}/video-frames`,{recursive:true});
info.extractedFrames=[];
for(const f of [150,195,270,366,700,830,880,890,1010,1180,1280,1445,1510,1638,1709]){
  const file=`${dir}/video-frames/f${f}.png`;
  run(['-y','-v','error','-i','out/pitch-v4-pm.mp4','-vf',`trim=start_frame=${f}:end_frame=${f+1}`,'-fps_mode','passthrough','-frames:v','1','-update','1',file]);
  info.extractedFrames.push({frame:f,sha256:createHash('sha256').update(await readFile(file)).digest('hex')});
}
await writeFile(`${dir}/video.json`,JSON.stringify(info,null,2));
console.log('전체 1710f 디코딩 통과 · 실제 MP4에서 15장 추출 완료');
