import { beforeEach, expect, it, vi } from 'vitest';
const app = vi.hoisted(() => ({
  state: vi.fn(async (me = 'owner') => ({ me, busy: false })),
  listeners: new Set<() => void>(),
  run: async (action: () => Promise<unknown>) => action(),
  message: vi.fn(async () => ({ accepted: true, messageId: 'm' })), startFree: vi.fn(), startScenario: vi.fn(), scenarioNext: vi.fn(), attachment: vi.fn(),
  pm: { decideCard: vi.fn(), setAvailability: vi.fn() },
}));
vi.mock('../../../apps/web/lib/runtime', async importOriginal => ({ ...await importOriginal<typeof import('../../../apps/web/lib/runtime')>(), getRuntime: () => app }));
import { GET, POST } from '../../../apps/web/app/api/[...path]/route.ts';
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
