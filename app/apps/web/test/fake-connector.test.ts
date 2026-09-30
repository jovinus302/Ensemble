import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { SessionEvent, TaskInstructionsInput } from '@ensemble/agents';
import { FakeConnector } from '../lib/fake-connector';

const input: TaskInstructionsInput = { taskId: 'prototype', planVersion: 1, goalSummary: { text: '시연', sourceId: 'goal' }, taskTitle: { text: '가입과 결제', sourceId: 'plan' }, handoffConditions: [{ text: '가입과 결제', sourceId: 'plan' }], decisions: [], inputs: [], openQuestions: [] };
it('submits real demo HTML and acknowledges scope changes before submitting a payment-free v2', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fake-web-'));
  const connector = new FakeConnector(root, undefined, undefined, 5);
  const events: SessionEvent[] = [];
  connector.onEvent(e => events.push(e));
  try {
    const session = await connector.startSession('prototype-agent', 'p');
    await connector.startTask('prototype-agent', input);
    await new Promise(r => setTimeout(r, 30));
    const report = events.find(e => e.type === 'report' && e.report.type === 'result_report');
    expect(report?.type === 'report' && report.report.type === 'result_report').toBe(true);
    if (report?.type !== 'report' || report.report.type !== 'result_report') throw new Error('missing report');
    const html = await readFile(path.join(session.workspace, report.report.files[0]!.path), 'utf8');
    expect(html).toContain('시연용 가상 자료'); expect(html).toContain('모의 결제'); expect(html).toContain('예약 확인');
    const update = { updateId: 'scope', fromVersion: 1, toVersion: 2, keep: ['가입'], change: ['결제 제외'], drop: ['결제'], reason: '사용자 결정' };
    expect(await connector.sendUpdate('prototype-agent', update)).toMatchObject({ sent: false });
    const continued = await connector.continueTask('prototype-agent', { taskId: input.taskId, planVersion: 2, task: input, update });
    expect(continued).not.toBe(report.turnId);
    await new Promise(r => setTimeout(r, 30));
    const reports = events.flatMap(e => e.type === 'report' ? [e.report] : []);
    expect(reports[1]).toMatchObject({ type: 'acknowledge_update', updateId: 'scope', planVersion: 2, dropped: ['결제'] });
    const next = reports[2];
    if (next?.type !== 'result_report') throw new Error('missing changed report');
    expect(next.planVersion).toBe(2);
    const changed = await readFile(path.join(session.workspace, next.files[0]!.path), 'utf8');
    expect(changed).not.toContain('>모의 결제</button>'); expect(changed).not.toContain('data-screen="payment"'); expect(changed).not.toContain('<h2>결제'); expect(changed).toContain('예약 확인');
    expect(changed).toContain('제외: 결제 화면과 모의 결제 버튼');
  } finally { await connector.stop(); await rm(root, { recursive: true, force: true }); }
});
