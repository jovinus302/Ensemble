import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { allowedApi } from './worker.mjs';

export function createGateway(token, backend = 'http://127.0.0.1:3410') {
  if (typeof token !== 'string' || token.length < 32) throw new Error('A strong gateway token is required');
  const expected = Buffer.from(`Bearer ${token}`);
  return http.createServer((req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401); res.end('Unauthorized'); return; }
    const url = new URL(req.url, 'http://localhost');
    if (!allowedApi(url.pathname, req.method)) { res.writeHead(404); res.end('Not found'); return; }
    if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415); res.end(); return; }
    const target = new URL(url.pathname + url.search, backend);
    const upstream = http.request(target, { method: req.method, headers: { ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}) } }, response => {
      const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      for (const key of ['content-type', 'content-disposition']) if (response.headers[key]) headers[key] = response.headers[key];
      res.writeHead(response.statusCode, headers); response.pipe(res);
    });
    upstream.setTimeout(120_000, () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":{"code":"offline","message":"실행 서버에 연결하지 못했습니다."}}'); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { token } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  createGateway(token).listen(3411, '127.0.0.1', () => console.log('Authenticated Ensemble gateway listening on 127.0.0.1:3411'));
}
