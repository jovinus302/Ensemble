import { getRuntime, RuntimeError, type Upload } from '../../../lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
class InputError extends Error {}
function text(value: unknown, _field: string): string { if (typeof value !== 'string' || !value.trim()) throw new InputError('필수 입력 항목이 비어 있습니다.'); return value; }
function uploads(value: unknown): Upload[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InputError('첨부 목록 형식이 올바르지 않습니다.');
  return value.map(a => {
    if (!a || typeof a !== 'object') throw new InputError('첨부 형식이 올바르지 않습니다.');
    const name = text(a.name, 'name'), mimeType = text(a.mimeType, 'mimeType');
    if (typeof a.contentBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.contentBase64)) throw new InputError('첨부 데이터를 읽을 수 없습니다.');
    return { name, mimeType, contentBase64: a.contentBase64 };
  });
}
function errorResponse(error: unknown) {
  // Provider exceptions may contain request details: never serialize them to the browser/log.
  return json({ error: { code: error instanceof RuntimeError ? error.code : error instanceof InputError ? 'invalid_input' : 'request_failed', message: error instanceof RuntimeError || error instanceof InputError ? error.message : '요청을 처리하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도해 주세요.' } }, error instanceof RuntimeError ? error.status : error instanceof InputError ? 400 : 500);
}

export async function GET(request: Request, context: Context) {
  try {
    const parts = (await context.params).path, route = parts.join('/'), app = getRuntime();
    if (route === 'state') return json(await app.state(new URL(request.url).searchParams.get('me') ?? 'owner'));
    if (route === 'events') {
      let cleanup = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          const changed = () => controller.enqueue(encoder.encode('event: changed\ndata: {}\n\n'));
          const timer = setInterval(() => controller.enqueue(encoder.encode(': heartbeat\n\n')), 15000);
          cleanup = () => { clearInterval(timer); app.listeners.delete(changed); request.signal.removeEventListener('abort', abort); };
          const abort = () => { cleanup(); controller.close(); };
          app.listeners.add(changed); request.signal.addEventListener('abort', abort, { once: true }); changed();
          if (request.signal.aborted) abort();
        }, cancel() { cleanup(); },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
    }
    if (parts[0] === 'attachments' && parts.length === 2) {
      const file = await app.attachment(parts[1]!);
      if (!file) return json({ error: { code: 'attachment_not_found', message: '첨부 파일을 찾지 못했습니다.' } }, 404);
      const inline = /\.(txt|md)$/i.test(file.name);
      return new Response(new Uint8Array(file.data), { headers: { 'Content-Type': inline ? 'text/plain; charset=utf-8' : 'application/octet-stream', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'X-Content-Type-Options': 'nosniff' } });
    }
    return json({ error: { code: 'not_found', message: '요청한 경로를 찾지 못했습니다.' } }, 404);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const parts = (await context.params).path, route = parts.join('/');
    if (!['messages', 'availability', 'free/start', 'scenario/start', 'scenario/next', 'scenario/retry', 'scenario/skip'].includes(route) && !(parts[0] === 'cards' && parts.length === 2)) return json({ error: { code: 'not_found', message: '요청한 경로를 찾지 못했습니다.' } }, 404);
    let parsed: unknown;
    try { parsed = await request.json(); } catch { throw new InputError('요청 내용을 읽을 수 없습니다.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InputError('요청 형식이 올바르지 않습니다.');
    const body = parsed as Record<string, unknown>;
    const app = getRuntime();
    const me = typeof body.me === 'string' ? body.me : typeof body.memberId === 'string' ? body.memberId : typeof body.authorId === 'string' ? body.authorId : 'owner';
    if (body.confirmReplace !== undefined && typeof body.confirmReplace !== 'boolean') throw new InputError('프로젝트 교체 확인 값이 올바르지 않습니다.');
    if (route === 'messages') {
      const author = text(body.authorId, 'authorId');
      if (typeof body.text !== 'string') throw new InputError('메시지 내용을 입력해 주세요.');
      const attachments = uploads(body.attachments);
      if (!body.text.trim() && !attachments.length) throw new InputError('메시지나 첨부를 입력해 주세요.');
      return json(await app.message(author, body.text, attachments), 202);
    }
    if (route === 'scenario/next') {
      return json(await app.launchScenario(), 202);
    }
    if (route === 'scenario/retry' || route === 'scenario/skip') {
      await app.scenarioRecover(route === 'scenario/skip');
      return json(await app.state(me));
    }
    await app.run(async () => {
      if (route === 'availability') {
        const member = text(body.memberId, 'memberId');
        if (typeof body.weeklyHours !== 'number' || !Number.isFinite(body.weeklyHours) || body.weeklyHours < 0) throw new InputError('주간 가용 시간은 0 이상의 숫자로 입력해 주세요.');
        await app.pm.setAvailability(member, body.weeklyHours);
      } else if (parts[0] === 'cards') {
        if (typeof body.approve !== 'boolean') throw new InputError('승인 여부를 선택해 주세요.');
        await app.pm.decideCard(parts[1]!, text(body.memberId, 'memberId'), body.approve);
      } else if (route === 'free/start') {
        const goal = text(body.goal, 'goal');
        if (body.deadline !== undefined && (typeof body.deadline !== 'string' || !Number.isFinite(Date.parse(body.deadline)))) throw new InputError('기한을 올바른 날짜로 입력해 주세요.');
        await app.startFree(goal, body.deadline as string | undefined, me, body.confirmReplace === true);
      } else if (route === 'scenario/start') {
        const name = text(body.name, 'name');
        await app.startScenario(name === 'scene-1-3' ? 'scene-1-3-continuous' : name, body.confirmReplace === true);
      }

    });
    return json(await app.state(me));
  } catch (error) { return errorResponse(error); }
}
