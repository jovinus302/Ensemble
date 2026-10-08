// #81: the Space participation routes reach the person's own folders, so they answer only the local machine.
// The server itself binds 127.0.0.1 (`npm run dev`/`start`); this check is the second line for a server started on another
// address, a proxy in front of it, DNS rebinding (a foreign Host) and cross-site pages in the person's browser (a foreign Origin).
// A remote client that forges every header still cannot connect to a loopback-bound server.

const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;
/** localhost, 127.0.0.0/8 and ::1 (with or without brackets, IPv4-mapped included). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || LOOPBACK_V4.test(host);
}
const hostOf = (value: string) => { try { return new URL(`http://${value}`).hostname; } catch { return undefined; } };

/** Returns why the request is refused, or null for a request from this machine. */
export function localOnlyRefusal(request: Request): string | null {
  const host = request.headers.get('host') ?? new URL(request.url).host;
  const hostname = hostOf(host);
  if (!hostname || !isLoopbackHost(hostname)) return '개인 Agent 연결 경로는 이 컴퓨터(localhost)에서만 쓸 수 있습니다.';
  // Next fills x-forwarded-for with the socket address when absent; any non-loopback hop means the caller is elsewhere.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded && forwarded.split(',').some(a => !isLoopbackHost(a))) return '다른 컴퓨터에서 온 요청은 받지 않습니다.';
  // Browsers send Origin on cross-origin requests; only the dashboard's own origin may call these routes from a page.
  const origin = request.headers.get('origin');
  if (origin) {
    let originHost: string | undefined;
    try { originHost = new URL(origin).host; } catch { originHost = undefined; }
    if (originHost !== host) return '다른 사이트에서 보낸 요청은 받지 않습니다.';
  }
  return null;
}

/** The agent's connection token from `Authorization: Bearer <token>`. */
export function bearerToken(request: Request): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '');
  return match?.[1];
}
