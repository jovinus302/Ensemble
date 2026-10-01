import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, copyFile } from 'node:fs/promises';
const appRoot = process.env.BENCH_APP_ROOT;
if (!appRoot) throw new Error('BENCH_APP_ROOT must point to the installed Ensemble app directory');
const require = createRequire(resolve(appRoot, 'package.json'));
const { build } = require('esbuild');
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/App.jsx'], bundle: true, outfile: 'dist/app.js', format: 'esm', define: { __BENCH_TASK__: JSON.stringify(process.env.BENCH_TASK || 'B') }, jsx: 'automatic', nodePaths: [resolve(appRoot, 'node_modules')] });
await copyFile('index.html', 'dist/index.html');

