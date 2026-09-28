// motion-remotion에서 실행: node review/v4-pm-motion/render.mjs frames|video|regression
import {bundle} from '@remotion/bundler';
import {openBrowser, selectComposition, renderStill, renderMedia} from '@remotion/renderer';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const mode = process.argv[2] ?? 'frames';
assert(['frames', 'video', 'regression'].includes(mode));
const dir = 'review/v4-pm-motion';
await mkdir(`${dir}/frames`, {recursive: true});
const serveUrl = await bundle({entryPoint: 'src/index.ts'});
const browser = await openBrowser('chrome', {logLevel:'error'});
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
try {
  if (mode === 'frames') {
    const selected = process.argv[3]?.split(',').map(Number);
    const frames = selected ?? [0,58,86,120,150,179,180,190,195,200,209,210,222,270,329,355,366,440,470,505,516,620,655,700,760,790,830,869,890,929,950,989,1010,1049,1070,1115,1165,1180,1235,1280,1345,1380,1412,1445,1478,1510,1530,1545,1575,1610,1629,1650,1680,1709];
    const results = selected ? (await json(`${dir}/frames.json`).catch(() => [])).filter(x => !selected.includes(x.frame)) : [];
    const composition = await selectComposition({serveUrl, id: 'PitchV4PM', puppeteerInstance: browser});
    for (const frame of frames) {
      let measurement;
      const inputProps = {measure: true, debugProjection: [355,366,505,516,655].includes(frame)};
      await renderStill({logLevel:'error', serveUrl, composition: {...composition, props: inputProps}, puppeteerInstance: browser, frame, output: `${dir}/frames/f${frame}.png`, imageFormat: 'png', inputProps,
        onBrowserLog: log => {if (log.text.startsWith('V4PMMOTION ')) measurement = JSON.parse(log.text.slice('V4PMMOTION '.length));}});
      assert(measurement, `${frame} 관찰 누락`);
      results.push({...measurement, sha256: await digest(`${dir}/frames/f${frame}.png`)});
      await writeFile(`${dir}/frames.json`, JSON.stringify(results.sort((a,b) => a.frame-b.frame), null, 2));
      console.log(JSON.stringify({frame, scroll: measurement.scroll, hero: measurement.hero, anchor: measurement.anchorError, events: [...new Set(measurement.events.map(e => e.id))]}));
    }
  }
  if (mode === 'video') {
    const composition = await selectComposition({serveUrl, id: 'PitchV4PM', puppeteerInstance: browser});
    await mkdir('out', {recursive: true});
    let last = -1;
    await renderMedia({serveUrl, composition, puppeteerInstance: browser, codec: 'h264', outputLocation: 'out/pitch-v4-pm.mp4', imageFormat: 'png', crf: 18, pixelFormat: 'yuv420p', concurrency: 4, inputProps: {measure: false, debugProjection: false}, onProgress: p => {const step = Math.floor(p.progress * 20); if (step !== last) {last = step; console.log(`렌더 ${step * 5}% · ${p.renderedFrames}/1710f`);}}});
    const ffprobe = 'node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe';
    const probe = spawnSync(ffprobe, ['-v','error','-show_streams','-show_format','-of','json','out/pitch-v4-pm.mp4'], {encoding:'utf8', windowsHide:true});
    assert.equal(probe.status, 0, probe.stderr);
    const metadata = JSON.parse(probe.stdout);
    await writeFile(`${dir}/video.json`, JSON.stringify({metadata, sha256: await digest('out/pitch-v4-pm.mp4')}, null, 2));
    const v = metadata.streams.find(s => s.codec_type === 'video');
    assert.equal(v.width,1920); assert.equal(v.height,1080); assert.equal(v.r_frame_rate,'30/1'); assert.equal(Number(v.nb_frames),1710); assert.equal(Number(v.duration),57);
    const decoded = spawnSync('node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe', ['-v','error','-i','out/pitch-v4-pm.mp4','-c:v','rawvideo','-f','null','-'], {encoding:'utf8',windowsHide:true});
    assert.equal(decoded.status, 0, decoded.stderr);
    await writeFile(`${dir}/video.json`, JSON.stringify({metadata, sha256: await digest('out/pitch-v4-pm.mp4'), fullDecode: {codec:'rawvideo', exitCode:decoded.status}}, null, 2));
    console.log('MP4 1920×1080 / 30fps / 1710f / 57초 / 전체 디코딩 통과');
  }
  if (mode === 'regression') {
    const baseline = await json(`${dir}/still-baseline.json`);
    const results = [];
    for (const id of ['StyleFrameV4PM','StyleFrameV4']) {
      const composition = await selectComposition({serveUrl, id, puppeteerInstance: browser});
      const cases = id === 'StyleFrameV4PM' ? baseline : ['SF1a','SF1b','SF2','SF3'].map(id => ({id}));
      for (const item of cases) {
        const output = `${dir}/frames/regression-${id}-${item.id}.png`;
        const inputProps = {still:item.id,heroRise:1,measure:false,debugProjection:false};
        await renderStill({serveUrl, composition: {...composition, props: inputProps}, puppeteerInstance: browser, output, imageFormat:'png', inputProps});
        const actual = await digest(output), expected = item.sha256 ?? await digest(`review/v4/${item.id}.png`);
        results.push({composition:id,still:item.id,sha256:actual,expected,identical:actual===expected});
        await writeFile(`${dir}/regression.json`,JSON.stringify(results,null,2));
        assert.equal(actual,expected,`${id} ${item.id} 픽셀 회귀`);
        console.log(`${id} ${item.id} 동일`);
      }
    }
  }
} finally {await browser.close({silent:true});}
