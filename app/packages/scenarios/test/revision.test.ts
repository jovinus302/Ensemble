import { expect, it, vi } from 'vitest';
import type { LlmProvider } from '@ensemble/llm';
import { createRevisionGenerator, type RevisionInput } from '../src/index.ts';

const input: RevisionInput = { title: '인터뷰', handoffConditions: ['각 참여자의 예약 빈도'], request: '각 참여자의 예약 빈도를 보완해 주세요.', previous: [{ name: 'notes.txt', mimeType: 'text/plain', content: '시연용 가상 고객 A의 기존 노트' }] };
it('sends only human-visible material through the injected provider and returns its supplement', async () => {
  const complete = vi.fn<LlmProvider['complete']>(async () => ({ text: '기존 노트\nA: 주 1회', toolCalls: [], model: 'fake', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 } }));
  expect(await createRevisionGenerator({ complete }, 'test-model')(input)).toContain('A: 주 1회');
  const request = complete.mock.calls[0]![0];
  expect(request.model).toBe('test-model');
  expect(JSON.parse(request.messages[0]!.content)).toEqual(input);
  expect(request.system).toContain('요청된 부족 부분만');
});
it.each(['empty', 'truncated'])('rejects %s model material instead of attaching it', async kind => {
  const llm: LlmProvider = { complete: async () => ({ text: kind === 'empty' ? ' ' : 'partial', stopReason: kind === 'truncated' ? 'max_tokens' : 'end_turn', toolCalls: [], model: 'fake', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 } }) };
  await expect(createRevisionGenerator(llm, 'fake')(input)).rejects.toThrow('비었거나 잘렸습니다');
});
