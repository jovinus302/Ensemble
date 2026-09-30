import { expect, it, vi } from 'vitest';
const app = vi.hoisted(() => ({ resolveTask: vi.fn(async () => ({ accepted: true })), startScenario: vi.fn(), scenarioNext: vi.fn(), state: vi.fn(async () => ({})), run: async (fn: () => Promise<void>) => fn() }));
vi.mock('../../../apps/web/lib/runtime', async importOriginal => ({ ...await importOriginal<typeof import('../../../apps/web/lib/runtime')>(), getRuntime: () => app }));
import { POST } from '../../../apps/web/app/api/[...path]/route.ts';
it.each(['scene-1-3', 'scene-1-3-continuous'])('routes %s to the continuous script', async name => {
  const response = await POST(new Request('http://localhost/api/scenario/start', { method: 'POST', body: JSON.stringify({ name }) }), { params: Promise.resolve({ path: ['scenario', 'start'] }) });
  expect(response.status).toBe(200);
  expect(app.startScenario).toHaveBeenLastCalledWith('scene-1-3-continuous', false);
});
it.each(['accept', 'retry', 'recheck'])('accepts a stalled task %s request with 202', async action => {
  const response = await POST(new Request('http://localhost/api/tasks/task/resolve', { method: 'POST', body: JSON.stringify({ action, me: 'owner', note: '이대로 확인해 주세요' }) }), { params: Promise.resolve({ path: ['tasks', 'task', 'resolve'] }) });
  expect(response.status).toBe(202);
  expect(app.resolveTask).toHaveBeenLastCalledWith('task', action, 'owner', '이대로 확인해 주세요');
});
it('rejects invalid resolution actions in Korean', async () => {
  const response = await POST(new Request('http://localhost/api/tasks/task/resolve', { method: 'POST', body: JSON.stringify({ action: 'skip' }) }), { params: Promise.resolve({ path: ['tasks', 'task', 'resolve'] }) });
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/[가-힣]/);
});
