const error = (code, message, status) => Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });

// Only these public app endpoints can cross the PC boundary.
export function allowedApi(path, method) {
  if (method === 'GET') return /^\/api\/(state|archives|archives\/[\w-]+|attachments\/[\w-]+)$/.test(path);
  if (method === 'POST') return /^\/api\/(messages|availability|free\/start|scenario\/(start|next|retry|skip)|cards\/[\w-]+|tasks\/[\w-]+\/resolve)$/.test(path);
  return false;
}

export async function proxyApi(request, env, send = fetch) {
  const url = new URL(request.url);
  // The owner explicitly chose public shared access; platform audience controls apply.
  if (!allowedApi(url.pathname, request.method)) return error('not_found', '요청한 경로를 찾지 못했습니다.', 404);
  if (request.method === 'POST' && (request.headers.get('origin') !== url.origin || !request.headers.get('content-type')?.startsWith('application/json'))) {
    return error('forbidden', '이 화면에서 다시 요청해 주세요.', 403);
  }
  if (!env.ENSEMBLE_BACKEND_URL || !env.ENSEMBLE_BACKEND_TOKEN) return error('offline', '실행 서버가 연결되지 않았습니다.', 503);
  const backend = new URL(env.ENSEMBLE_BACKEND_URL);
  if (backend.protocol !== 'https:' || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) return error('offline', '실행 서버 연결 설정을 확인해 주세요.', 503);
  const target = new URL(url.pathname + url.search, backend);
  try {
    const upstream = await send(target, {
      method: request.method, redirect: 'manual', signal: request.signal,
      headers: { Authorization: `Bearer ${env.ENSEMBLE_BACKEND_TOKEN}`, ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(request.method === 'POST' ? { body: request.body } : {}),
    });
    if (upstream.status >= 300 && upstream.status < 400 || upstream.status >= 500) return error('offline', 'PC 실행 서버에 연결하지 못했어요. 서버와 연결 프로그램을 확인해 주세요.', 503);
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const key of ['content-type', 'content-disposition']) if (upstream.headers.has(key)) headers.set(key, upstream.headers.get(key));
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch { return error('offline', 'PC 실행 서버에 연결하지 못했어요. 서버와 연결 프로그램을 확인해 주세요.', 503); }
}

export function createWorker(assets) {
  return { async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return proxyApi(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const asset = assets[url.pathname];
    if (!asset) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : asset.body, { headers: { 'Content-Type': asset.type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' } });
  } };
}
