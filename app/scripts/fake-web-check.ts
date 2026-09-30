// Real WebRuntime, default demo agents and API handlers, deterministic PM fixture.
// Usage: [ENSEMBLE_HTTP_PORT=3601] [ENSEMBLE_HTTP_REPORT_DIR=<dir>] npx tsx scripts/fake-web-check.ts
// The port must be free (stop any Next dev server on it). Artifacts remain outside the repo.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { WebRuntime } from '../apps/web/lib/runtime.ts';
import { GET, POST } from '../apps/web/app/api/[...path]/route.ts';
import { setup } from '../packages/scenarios/test/continuous-fixture.ts';

const port = Number(process.env.ENSEMBLE_HTTP_PORT ?? 3601);
const output = path.resolve(process.env.ENSEMBLE_HTTP_REPORT_DIR ?? path.join(homedir(), 'ensemble-agent-workspaces/fake-web-check'));
mkdirSync(output, { recursive: true });
const fixture = await setup(false);
await fixture.pm.stop();
const app = new WebRuntime({ dataDir: path.join(output, `data-${Date.now()}`), llm: fixture.llm, generateRevision: fixture.host.generateRevision });
const globalRuntime = globalThis as typeof globalThis & { ensembleRuntime?: WebRuntime };
globalRuntime.ensembleRuntime = app;
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
    const params = Promise.resolve({ path: new URL(request.url).pathname.replace(/^\/api\//, '').split('/') });
    const response = await (req.method === 'POST' ? POST(request, { params }) : GET(request, { params }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: String(error) })); }
});
try {
  await app.state();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  process.env.ENSEMBLE_HTTP_URL = `http://127.0.0.1:${port}`;
  process.env.ENSEMBLE_HTTP_REPORT_DIR = output;
  await import('./http-server-check.ts');
  const result = JSON.parse(readFileSync(path.join(output, 'http-result.json'), 'utf8'));
  if (result.prototypeStatus !== 'checked') throw new Error(`Final prototype must be checked, received ${result.prototypeStatus}`);
  const events = await app.store.read({ projectId: app.meta.projectId });
  writeFileSync(path.join(output, 'ledger.json'), JSON.stringify(events, null, 2));
  console.log('PASS: scenes 1→3, skipped=0, prototype=checked');
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await app.stop();
  fixture.store.close();
  delete globalRuntime.ensembleRuntime;
}
