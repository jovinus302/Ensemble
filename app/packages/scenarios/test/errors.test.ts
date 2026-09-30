import { expect, it, vi } from 'vitest';
import { PlanDraftingError } from '@ensemble/orchestrator';
import { MemoryLedgerStore } from '@ensemble/store';
import { advanceScript, type ScriptHost, type ScriptProgress } from '../src/script.ts';
import { draftFailureDetail } from '../src/errors.ts';

it('T4 records the specific broken estimate rule in Korean and keeps raw detail in server logs', async () => {
  const store = new MemoryLedgerStore();
  await store.append([{ projectId: 'p', targetProductId: 'p', actor: { kind: 'system', id: 'test' }, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } }]);
  const progress: ScriptProgress = { step: 0, anchors: {} };
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const host = { pm: { startFreeProject: async () => ({ failure: new PlanDraftingError('계획 규칙(담당자, 의존 관계, 예상 시간)을 지키지 못했습니다', 'Invalid estimate') }) }, read: () => store.read(), recordStop: vi.fn() } as unknown as ScriptHost;
  try {
    await expect(advanceScript(host, [{ as: 'owner', text: '예약 서비스', action: 'goal' }], progress)).rejects.toThrow('예상 시간은 0 이상');
    expect(progress.stopped).not.toContain('Invalid estimate');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('예상 시간'), 'Invalid estimate');
    expect(host.recordStop).toHaveBeenCalledWith(progress.stopped);
    expect(draftFailureDetail('provider secret payload')).not.toContain('secret');
  } finally { log.mockRestore(); }
});
