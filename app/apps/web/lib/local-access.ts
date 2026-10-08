// #81: Ensemble's API reaches the person's own folders and shows their Space, so every API route answers only the local
// machine (re-review N2: the dashboard state carries the same Space data as the `space/…` routes).
// The server itself binds 127.0.0.1 (`npm run dev`/`start`); this check is the second line for a server started on another
// address, a proxy in front of it, DNS rebinding (a foreign Host) and cross-site pages in the person's browser (a foreign Origin).
// A remote client that forges every header still cannot connect to a loopback-bound server.

const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;
/** localhost, 127.0.0.0/8 and ::1 (with or without brackets, IPv4-mapped included). Used for socket addresses (X-Forwarded-For). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || LOOPBACK_V4.test(host);
}
/** The names a browser on this machine uses for the dashboard. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const portOf = (url: URL) => url.port || (url.protocol === 'https:' ? '443' : '80');

/**
 * Returns why the request is refused, or null for a request from this machine. `request.url` is what Next builds from the
 * address and port the server is bound to (not from the Host header), so it names this server.
 */
export function localOnlyRefusal(request: Request): string | null {
  const server = new URL(request.url);
  const host = request.headers.get('host') ?? server.host;
  let named: URL | undefined;
  try { named = new URL(`${server.protocol}//${host}`); } catch { named = undefined; }
  // Only localhost, 127.0.0.1 or [::1] on this server's own port: a rebinding name or another local port is refused.
  if (!named || named.username || named.password || named.pathname !== '/' || !LOCAL_HOSTS.has(named.hostname) || portOf(named) !== portOf(server)) {
    return 'Ensemble은 이 컴퓨터(localhost)에서만 쓸 수 있습니다.';
  }
  // Next fills x-forwarded-for with the socket address when absent; any non-loopback hop means the caller is elsewhere.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded && forwarded.split(',').some(a => !isLoopbackHost(a))) return '다른 컴퓨터에서 온 요청은 받지 않습니다.';
  // Browsers send Origin on cross-origin requests; only the dashboard's own origin (scheme, host and port) may call from a page.
  const origin = request.headers.get('origin');
  if (origin !== null) {
    let from: string | undefined;
    try { from = new URL(origin).origin; } catch { from = undefined; }
    if (from !== named.origin) return '다른 사이트에서 보낸 요청은 받지 않습니다.';
  }
  return null;
}

/** The agent's connection token from `Authorization: Bearer <token>`. */
export function bearerToken(request: Request): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '');
  return match?.[1];
}
