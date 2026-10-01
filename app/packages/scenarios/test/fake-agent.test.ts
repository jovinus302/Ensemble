import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { Report, SessionEvent, TaskInstructionsInput } from '@ensemble/agents';
import { FakeConnector, FakePmLlm, readableNote, shortGoal } from '../../../apps/web/lib/fake-connector.ts';

// The demo transport (ENSEMBLE_PM_RUNTIME=fake): what it shows people must read like a person wrote it.
const input = (taskId: string, title: string): TaskInstructionsInput => ({
  taskId, planVersion: 1, taskTitle: { text: title, sourceId: 'plan:1' }, handoffConditions: [{ text: '비교한 서비스와 출처 후보 목록', sourceId: 'plan:1' }],
  decisions: [], inputs: [], conversation: [], exclusions: [], limits: [],
} as unknown as TaskInstructionsInput);

it('names each work item\'s result file after its work, never after an internal version key, and keeps them apart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-fake-files-'));
  const connector = new FakeConnector(root, undefined, () => true, 0);
  const results: Report[] = [];
  connector.onEvent((event: SessionEvent) => { if (event.type === 'report' && event.report.type === 'result_report') results.push(event.report); });
  try {
    const session = await connector.startSession('research-agent', 'p');
    for (const [taskId, title] of [['research-1', '비슷한 서비스 비교'], ['research-2', '사용자 반응 가설 정리'], ['research-1', '비슷한 서비스 비교']] as const) {
      const before = results.length;
      await connector.startTask('research-agent', input(taskId, title));
      for (let i = 0; i < 100 && results.length === before; i++) await new Promise(r => setTimeout(r, 5));
    }
    const files = results.map(r => r.type === 'result_report' ? r.files[0]!.path : '');
    expect(files).toEqual(['비슷한 서비스 비교.md', '사용자 반응 가설 정리.md', '비슷한 서비스 비교 (2).md']);
    expect((await readdir(session.workspace)).sort()).toEqual([...files].sort());
  } finally { await connector.stop(); await rm(root, { recursive: true, force: true }); }
});

it('echoes change lines as they read, and never a serialized structure', () => {
  expect(readableNote('범위에서 제외: 결제')).toBe('범위에서 제외: 결제');
  expect(readableNote('{"id":"prototype","title":"프로토타입 (결제 제외)","baseTitle":"프로토타입","exclusions":["결제"],"limits":[]}')).toBe('범위에서 제외: 결제');
  expect(readableNote('{"id":"x"')).toBeUndefined();
  expect(readableNote('  ')).toBeUndefined();
});

it('shortens the goal on a word boundary', () => {
  expect(shortGoal('시연용 가상 자료입니다. 2주 안에 소규모 제품팀을 위한 고객 인터뷰 예약 서비스 Interview Loop의 고객 반응을 확인하자.')).toBe('2주 안에 소규모 제품팀을 위한 고객 인터뷰 예약');
  expect(shortGoal('인터뷰 예약 서비스 시제품')).toBe('인터뷰 예약 서비스 시제품');
});

it('the demo PM recommends the smallest offered answer, with a reason', async () => {
  const response = await new FakePmLlm().complete({ model: 'fake', forceTool: 'recommend_answer', tools: [], system: '', messages: [{ role: 'user', content: JSON.stringify({ facts: { question: '로그인 방식은?', options: ['이메일과 소셜 로그인', '이메일만'] } }) }] });
  expect(response.toolCalls[0]?.input).toMatchObject({ optionIndex: 1 });
  expect(String(response.toolCalls[0]?.input.rationale)).toContain('이메일만');
});
