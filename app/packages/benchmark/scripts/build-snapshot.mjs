// Host-owned validation build. No worker plugins, configuration or commands.
import { createRequire } from 'node:module';
import { mkdir, copyFile, realpath } from 'node:fs/promises';
import path from 'node:path';
const appRoot = process.env.BENCH_APP_ROOT;
if (!appRoot) throw new Error('BENCH_APP_ROOT must point to the installed Ensemble app directory');
const require = createRequire(path.resolve(appRoot, 'package.json'));
const { build } = require('esbuild');
const snapshotRoot = await realpath(process.cwd());
const dependencies = await realpath(path.join(appRoot, 'node_modules'));
const inside = (root, file) => { const relative = path.relative(root, file); return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/App.jsx'], bundle: true, outfile: 'dist/app.js', format: 'esm',
  define: { __BENCH_TASK__: JSON.stringify(process.env.BENCH_TASK || 'B') }, jsx: 'automatic', nodePaths: [path.join(appRoot, 'node_modules')],
  plugins: [{ name: 'captured-submission-only', setup(builder) {
    builder.onLoad({ filter: /.*/, namespace: 'file' }, async args => {
      const actual = await realpath(args.path);
      if (!inside(snapshotRoot, actual) && !inside(dependencies, actual)) throw new Error('Import outside captured submission or installed dependencies');
      return undefined;
    });
  } }],
});
await copyFile('index.html', 'dist/index.html');
