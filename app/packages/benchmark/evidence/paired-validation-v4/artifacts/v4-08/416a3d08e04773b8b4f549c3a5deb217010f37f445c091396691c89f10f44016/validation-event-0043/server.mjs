import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/reservations') {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error('Request too large'); }
      const data = JSON.parse(body);
      const key = `${data.date}T${data.time}`;
      const status = key === '2030-06-15T19:00' ? 409 : key === '2030-06-16T18:00' ? 503 : 200;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { id: 'fixture-reservation', ...data } : { error: status === 409 ? 'This time is sold out.' : 'Reservation service unavailable. Please try again.' }));
    } catch { res.writeHead(400); res.end('{"error":"Invalid request"}'); }
    return;
  }
  const file = req.url === '/' ? 'index.html' : req.url === '/app.js' ? 'app.js' : null;
  if (!file) { res.writeHead(404); res.end(); return; }
  try { res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(await readFile(resolve('dist', file))); }
  catch { res.writeHead(500); res.end('Run npm run build first'); }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Booking fixture server: http://127.0.0.1:${server.address().port}`));
