import { beforeEach, expect, it, vi } from 'vitest';
const app = vi.hoisted(() => ({
  state: vi.fn(async (me = 'owner') => ({ me, busy: false })),
  listeners: new Set<() => void>(),
  run: async (action: () => Promise<unknown>) => action(),
  message: vi.fn(async () => ({ accepted: true, messageId: 'm' })), startFree: vi.fn(), startScenario: vi.fn(), scenarioNext: vi.fn(), attachment: vi.fn(),
  task: vi.fn(async (_id: string, _me?: string): Promise<unknown> => ({})), comment: vi.fn(async (_id: string, _me: string, _text: string): Promise<unknown> => ({ accepted: true, messageId: 'c' })),
  decide: vi.fn(async (_id: string, _me: string, _answer: unknown): Promise<void> => {}),
  pm: { decideCard: vi.fn(), setAvailability: vi.fn() },
}));
vi.mock('../../../apps/web/lib/runtime', async importOriginal => ({ ...await importOriginal<typeof import('../../../apps/web/lib/runtime')>(), getRuntime: () => app }));
import { GET, POST } from '../../../apps/web/app/api/[...path]/route.ts';
import { RuntimeError } from '../../../apps/web/lib/runtime.ts';
const context = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });
const request = (path: string, body: unknown) => new Request(`http://localhost/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); app.listeners.clear(); });

it('routes decisions only with boolean approval and returns the acting member view', async () => {
  expect((await POST(request('cards/id', { memberId: 'designer', approve: 'yes' }), context('cards/id'))).status).toBe(400);
  expect(app.pm.decideCard).not.toHaveBeenCalled();
  const response = await POST(request('cards/id', { memberId: 'designer', approve: true }), context('cards/id'));
  expect(app.pm.decideCard).toHaveBeenCalledWith('id', 'designer', true);
  expect(await response.json()).toEqual({ me: 'designer', busy: false });
});

it('preserves attachment bytes and selected free-project decider', async () => {
  const attachment = { name: 'binary.bin', mimeType: 'application/octet-stream', contentBase64: Buffer.from([0, 255, 128, 1]).toString('base64') };
  await POST(request('messages', { authorId: 'owner', text: 'File', attachments: [attachment] }), context('messages'));
  expect(app.message).toHaveBeenCalledWith('owner', 'File', [attachment]);
  await POST(request('free/start', { me: 'designer', goal: 'Goal', deadline: '2026-10-07' }), context('free/start'));
  expect(app.startFree).toHaveBeenCalledWith('Goal', '2026-10-07', 'designer', false);
});

it('SSE emits changed and removes the subscriber on disconnect', async () => {
  const controller = new AbortController();
  const response = await GET(new Request('http://localhost/api/events', { signal: controller.signal }), context('events'));
  expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: changed');
  expect(app.listeners.size).toBe(1);
  for (const listener of app.listeners) listener();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: changed');
  controller.abort();
  expect(app.listeners.size).toBe(0);
});

it('does not expose provider error details', async () => {
  app.message.mockRejectedValueOnce(new Error('private provider diagnostic'));
  const response = await POST(request('messages', { authorId: 'owner', text: 'Hello' }), context('messages'));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private provider diagnostic');
});

it('MD2 GET tasks/:id returns the work detail, 404 for an unknown work item', async () => {
  app.task.mockResolvedValueOnce({ item: { id: 't1' }, activity: [], comments: [] });
  const ok = await GET(new Request('http://localhost/api/tasks/t1'), context('tasks/t1'));
  expect(ok.status).toBe(200);
  expect(app.task).toHaveBeenCalledWith('t1', 'owner');
  expect(await ok.json()).toEqual({ item: { id: 't1' }, activity: [], comments: [] });
  app.task.mockRejectedValueOnce(new RuntimeError('task_not_found', '작업을 찾지 못했습니다.', 404));
  const missing = await GET(new Request('http://localhost/api/tasks/nope'), context('tasks/nope'));
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: { code: 'task_not_found', message: '작업을 찾지 못했습니다.' } });
});

it('MD2 POST tasks/:id/comments records the comment as the named person (202), with 400/403/404', async () => {
  const accepted = await POST(request('tasks/t1/comments', { me: 'designer', text: '버튼은 짧게' }), context('tasks/t1/comments'));
  expect(accepted.status).toBe(202);
  expect(app.comment).toHaveBeenCalledWith('t1', 'designer', '버튼은 짧게');
  expect(await accepted.json()).toEqual({ accepted: true, messageId: 'c' });
  expect((await POST(request('tasks/t1/comments', { me: 'designer', text: '  ' }), context('tasks/t1/comments'))).status).toBe(400);
  expect((await POST(request('tasks/t1/comments', { text: '이름 없음' }), context('tasks/t1/comments'))).status).toBe(400);
  expect(app.comment).toHaveBeenCalledTimes(1);
  app.comment.mockRejectedValueOnce(new RuntimeError('forbidden', '이 프로젝트의 사람만 작업에 댓글을 남길 수 있습니다.', 403));
  expect((await POST(request('tasks/t1/comments', { me: 'research-agent', text: '확인' }), context('tasks/t1/comments'))).status).toBe(403);
  app.comment.mockRejectedValueOnce(new RuntimeError('task_not_found', '작업을 찾지 못했습니다.', 404));
  expect((await POST(request('tasks/nope/comments', { me: 'owner', text: '확인' }), context('tasks/nope/comments'))).status).toBe(404);
});

it('MD2 POST decisions/:id passes the answer to the runtime and returns the answering member view, with 400/403/404', async () => {
  const response = await POST(request('decisions/r1', { me: 'owner', action: 'answer', text: '이메일만' }), context('decisions/r1'));
  expect(response.status).toBe(200);
  expect(app.decide).toHaveBeenCalledWith('r1', 'owner', { action: 'answer', text: '이메일만' });
  expect(await response.json()).toEqual({ me: 'owner', busy: false });
  await POST(request('decisions/r1', { me: 'owner', action: 'edit', optionId: 'apply', edits: { include: ['결제 화면'] } }), context('decisions/r1'));
  expect(app.decide).toHaveBeenLastCalledWith('r1', 'owner', { action: 'edit', optionId: 'apply', edits: { include: ['결제 화면'] } });
  for (const body of [{ me: 'owner', action: 'maybe' }, { action: 'approve' }, { me: 'owner', action: 'choose' }, { me: 'owner', action: 'answer', text: ' ' }, { me: 'owner', action: 'edit', edits: [] }]) {
    expect((await POST(request('decisions/r1', body), context('decisions/r1'))).status).toBe(400);
  }
  expect(app.decide).toHaveBeenCalledTimes(2);
  app.decide.mockRejectedValueOnce(new RuntimeError('forbidden', '결정을 요청받은 사람만 답할 수 있어요.', 403));
  const forbidden = await POST(request('decisions/r1', { me: 'designer', action: 'approve' }), context('decisions/r1'));
  expect(forbidden.status).toBe(403);
  expect(await forbidden.json()).toEqual({ error: { code: 'forbidden', message: '결정을 요청받은 사람만 답할 수 있어요.' } });
  app.decide.mockRejectedValueOnce(new RuntimeError('decision_not_found', '결정 요청을 찾지 못했습니다.', 404));
  expect((await POST(request('decisions/nope', { me: 'owner', action: 'approve' }), context('decisions/nope'))).status).toBe(404);
});
