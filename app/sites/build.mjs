import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['sites/main.tsx'], outfile: 'dist/client/app.js', bundle: true, write: false, minify: true, jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_ENSEMBLE_POLLING': '"true"' } });
const assets = Object.fromEntries(result.outputFiles.map(file => ['/' + path.basename(file.path), { body: file.text, type: file.path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' }]));
assets['/favicon.svg'] = { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#286c56"/><path d="M10 8h13v4h-9v3h8v3h-8v3h9v4H10z" fill="white"/></svg>' };
assets['/'] = { type: 'text/html; charset=utf-8', body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ensemble</title><meta name="description" content="사람과 AI 에이전트가 함께 일하는 프로젝트 공간"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>' };
await mkdir(path.join(root, 'dist/server'), { recursive: true });
await build({ absWorkingDir: root, stdin: { contents: `import { createWorker } from './sites/worker.mjs'; export default createWorker(${JSON.stringify(assets)});`, resolveDir: root, sourcefile: 'site-entry.mjs' }, bundle: true, minify: true, format: 'esm', platform: 'browser', outfile: path.join(root, 'dist/server/index.js') });
console.log('Sites Worker built from existing Ensemble components.');
