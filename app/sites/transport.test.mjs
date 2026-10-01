import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { proxyApi } from './worker.mjs';
import { createGateway } from './gateway.mjs';

const env = { ENSEMBLE_BACKEND_URL: 'https://example.test', ENSEMBLE_BACKEND_TOKEN: 'x'.repeat(40) };
const request = (path, init = {}) => new Request('https://site.test' + path, { headers: { 'oai-authenticated-user-id': 'user' }, ...init });
test('worker rejects foreign-origin and arbitrary paths without contacting PC', async () => {
  const send = () => { throw new Error('must not fetch'); };
  assert.equal((await proxyApi(request('/api/other'), env, send)).status, 404);
  assert.equal((await proxyApi(request('/api/messages', { method: 'POST', headers: { 'oai-authenticated-user-id': 'user', origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' }), env, send)).status, 403);
});
test('worker injects only its token and preserves download bytes; errors are sanitized', async () => {
  const response = await proxyApi(new Request('https://site.test/api/attachments/file'), env, async (url, init) => {
    assert.equal(url.href, 'https://example.test/api/attachments/file');
    assert.equal(init.headers.Authorization, 'Bearer ' + env.ENSEMBLE_BACKEND_TOKEN);
    assert.equal(init.headers.cookie, undefined);
    return new Response(new Uint8Array([0, 255, 12]), { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="test.bin"', 'set-cookie': 'private=value' } });
  });
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 255, 12]));
  assert.equal(response.headers.get('set-cookie'), null);
  const failed = await proxyApi(request('/api/state'), env, async () => { throw new Error('secret diagnostic'); });
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('secret diagnostic'));
});
test('gateway blocks unauthorized requests and forwards JSON bytes without forwarding token', async () => {
  const backend = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined);
    res.setHeader('Content-Type', 'application/json'); req.pipe(res);
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const gateway = createGateway(env.ENSEMBLE_BACKEND_TOKEN, `http://127.0.0.1:${backend.address().port}`);
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const base = `http://127.0.0.1:${gateway.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/state')).status, 401);
    const headers = { authorization: 'Bearer ' + env.ENSEMBLE_BACKEND_TOKEN, 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/_next/dev', { headers })).status, 404);
    const body = JSON.stringify({ text: '한글', attachments: [{ contentBase64: 'AP8=' }] });
    const response = await fetch(base + '/api/messages', { method: 'POST', headers, body });
    assert.equal(response.status, 200); assert.equal(await response.text(), body);
  } finally { gateway.closeAllConnections(); backend.closeAllConnections(); gateway.close(); backend.close(); }
});
