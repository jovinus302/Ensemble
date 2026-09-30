import { expect, it, vi } from 'vitest';
const app = vi.hoisted(() => ({ startScenario: vi.fn(), scenarioNext: vi.fn(), state: vi.fn(async () => ({})), run: async (fn: () => Promise<void>) => fn() }));
vi.mock('../../../apps/web/lib/runtime', async importOriginal => ({ ...await importOriginal<typeof import('../../../apps/web/lib/runtime')>(), getRuntime: () => app }));
import { POST } from '../../../apps/web/app/api/[...path]/route.ts';
it.each(['scene-1-3', 'scene-1-3-continuous'])('routes %s to the continuous script', async name => {
  const response = await POST(new Request('http://localhost/api/scenario/start', { method: 'POST', body: JSON.stringify({ name }) }), { params: Promise.resolve({ path: ['scenario', 'start'] }) });
  expect(response.status).toBe(200);
  expect(app.startScenario).toHaveBeenLastCalledWith('scene-1-3-continuous', false);
});
