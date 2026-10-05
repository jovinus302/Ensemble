import { getRuntime, RuntimeError, type Upload } from '../../../lib/runtime';
import { TaskResolutionError } from '@ensemble/orchestrator';
import type { ExternalResultArtifact, ResultVia } from '@ensemble/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
class InputError extends Error {}
function memberAuthorized(request: Request, memberId: string): boolean {
  const token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return false;
  const configured = process.env.ENSEMBLE_MEMBER_TOKENS;
  if (configured === undefined) return token === 'dev-token';
  try {
    const tokens: unknown = JSON.parse(configured);
    return !!tokens && typeof tokens === 'object' && !Array.isArray(tokens)
      && Object.hasOwn(tokens, memberId) && (tokens as Record<string, unknown>)[memberId] === token;
  } catch { return false; }
}
function resultArtifacts(value: unknown): ExternalResultArtifact[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InputError('Invalid artifacts.');
  return value.map(a => {
    if (!a || typeof a !== 'object') throw new InputError('Invalid artifact.');
    if (a.kind === 'url') return { kind: 'url', name: text(a.name, 'name'), uri: text(a.uri, 'uri') };
    if (a.kind === 'file') return { kind: 'file', ...uploads([a])[0]! };
    throw new InputError('Invalid artifact kind.');
  });
}
function resultVia(value: unknown): ResultVia | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Invalid result source.');
  const via = value as Record<string, unknown>;
  if (!['ide', 'slack', 'knox', 'cli', 'ensemble'].includes(via.channel as string) || (via.agent !== undefined && typeof via.agent !== 'string')) throw new InputError('Invalid result source.');
  return { channel: via.channel as ResultVia['channel'], ...(typeof via.agent === 'string' ? { agent: via.agent } : {}) };
}

async function submitResult(request: Request, taskId: string) {
  let parsed: unknown;
  try { parsed = await request.json(); } catch { throw new InputError('Invalid JSON body.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InputError('Invalid result.');
  const body = parsed as Record<string, unknown>, memberId = text(body.memberId, 'memberId');
  if (!memberAuthorized(request, memberId)) return json({ error: { code: 'unauthorized', message: 'Invalid member token.' } }, 401);
  const input = { memberId, summary: text(body.summary, 'summary'), artifacts: resultArtifacts(body.artifacts), via: resultVia(body.via) };
  const app = getRuntime();
  try { return json(await app.run(() => app.pm.submitExternalResult(taskId, input))); }
  catch (error) {
    if (error instanceof TaskResolutionError) return json({ error: { code: error.code, message: error.message } }, error.status);
    throw error;
  }
}
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
    if (route === 'archives') return json(await app.archives());
    if (parts[0] === 'archives' && parts.length === 2) return json(await app.archivedState(parts[1]!, new URL(request.url).searchParams.get('me') ?? 'owner'));
    if (route === 'state') return json(await app.state(new URL(request.url).searchParams.get('me') ?? 'owner'));
    if (parts[0] === 'tasks' && parts.length === 2) return json(await app.task(parts[1]!, new URL(request.url).searchParams.get('me') ?? 'owner'));
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
    if (parts[0] === 'tasks' && parts.length === 3 && parts[2] === 'result') return await submitResult(request, parts[1]!);
    const resolving = parts[0] === 'tasks' && parts.length === 3 && parts[2] === 'resolve';
    const commenting = parts[0] === 'tasks' && parts.length === 3 && parts[2] === 'comments';
    const deciding = parts[0] === 'decisions' && parts.length === 2;
    if (!resolving && !commenting && !deciding && !['messages', 'availability', 'free/start', 'scenario/start', 'scenario/next', 'scenario/retry', 'scenario/skip'].includes(route) && !(parts[0] === 'cards' && parts.length === 2)) return json({ error: { code: 'not_found', message: '요청한 경로를 찾지 못했습니다.' } }, 404);
    let parsed: unknown;
    try { parsed = await request.json(); } catch { throw new InputError('요청 내용을 읽을 수 없습니다.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InputError('요청 형식이 올바르지 않습니다.');
    const body = parsed as Record<string, unknown>;
    const app = getRuntime();
    const me = typeof body.me === 'string' ? body.me : typeof body.memberId === 'string' ? body.memberId : typeof body.authorId === 'string' ? body.authorId : 'owner';
    if (resolving) {
      if (body.action !== 'accept' && body.action !== 'retry' && body.action !== 'recheck') throw new InputError('작업 해결 방법을 선택해 주세요.');
      if (body.note !== undefined && typeof body.note !== 'string') throw new InputError('메모는 글로 입력해 주세요.');
      return json(await app.resolveTask(parts[1]!, body.action, me, body.note as string | undefined), 202);
    }
    if (commenting) {
      // The commenter must name themselves: a comment is the person's own words in the work thread.
      const author = text(body.me, 'me');
      if (typeof body.text !== 'string' || !body.text.trim()) throw new InputError('댓글 내용을 입력해 주세요.');
      return json(await app.comment(parts[1]!, author, body.text), 202);
    }
    if (deciding) {
      const answerer = text(body.me, 'me');
      if (!['approve', 'choose', 'edit', 'reject', 'answer'].includes(body.action as string)) throw new InputError('답하는 방법을 선택해 주세요.');
      if (body.optionId !== undefined && typeof body.optionId !== 'string') throw new InputError('선택지 형식이 올바르지 않습니다.');
      if (body.edits !== undefined && (!body.edits || typeof body.edits !== 'object' || Array.isArray(body.edits))) throw new InputError('고칠 내용 형식이 올바르지 않습니다.');
      if (body.text !== undefined && typeof body.text !== 'string') throw new InputError('답은 글로 입력해 주세요.');
      if (body.action === 'choose' && !body.optionId) throw new InputError('선택지를 골라 주세요.');
      if (body.action === 'edit' && !body.edits) throw new InputError('고칠 내용을 입력해 주세요.');
      if (body.action === 'answer' && !(body.text as string | undefined)?.trim()) throw new InputError('답을 입력해 주세요.');
      const action = body.action as 'approve' | 'choose' | 'edit' | 'reject' | 'answer';
      await app.run(() => app.decide(parts[1]!, answerer, { action, ...(body.optionId ? { optionId: body.optionId as string } : {}), ...(body.edits ? { edits: body.edits as Record<string, unknown> } : {}), ...(typeof body.text === 'string' ? { text: body.text } : {}) }));
      return json(await app.state(answerer));
    }
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
