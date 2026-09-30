import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { SessionEvent, TaskInstructionsInput } from '@ensemble/agents';
import { FakeConnector, prototypeHtml } from '../lib/fake-connector';

const input: TaskInstructionsInput = { taskId: 'prototype', planVersion: 1, goalSummary: { text: '시연', sourceId: 'goal' }, taskTitle: { text: '가입과 결제', sourceId: 'plan' }, handoffConditions: [{ text: '가입과 결제', sourceId: 'plan' }], decisions: [], inputs: [], openQuestions: [] };
it.each([{ exclusions: ['결제 화면과 모의 결제 버튼'], limits: [] }, { exclusions: [], limits: ['가입·시간 선택·예약 확인까지'] }])('uses scope lists without rewriting conditions: %j', async scope => {
  const root = await mkdtemp(path.join(tmpdir(), 'fake-scope-'));
  const connector = new FakeConnector(root, undefined, undefined, 5, async () => ({ title: '시연', handoffConditions: ['가입과 시간 선택과 결제', '실제 개인정보 저장 금지'], ...scope }));
  const events: SessionEvent[] = [];
  connector.onEvent(e => events.push(e));
  try {
    const session = await connector.startSession('prototype-agent', 'p');
    await connector.startTask('prototype-agent', input);
    await new Promise(r => setTimeout(r, 40));
    const report = events.find(e => e.type === 'report' && e.report.type === 'result_report');
    if (report?.type !== 'report' || report.report.type !== 'result_report') throw new Error('missing report');
    const html = await readFile(path.join(session.workspace, report.report.files[0]!.path), 'utf8');
    expect(html).not.toContain('data-screen="payment"');
    expect(html).not.toContain('>모의 결제</button>');
    expect(html).toContain('시간 선택');
    expect(html).toContain('실제 개인정보 저장 금지');
  } finally { await connector.stop(); await rm(root, { recursive: true, force: true }); }
});
it('addresses each condition without claiming a real access date or dropping mixed payment conditions', () => {
  const conditions = ['개인정보·외부 API 없음 체크리스트', '결제 제외, 가입 오류·재입력 및 예약 확인 유지', '실제 접속 날짜와 최신 가격 확인'];
  const html = prototypeHtml({ ...input, handoffConditions: conditions.map(text => ({ text, sourceId: 'v2' })) }, true);
  expect(html).toContain('<h2>인계 조건 확인</h2>');
  for (const condition of conditions) expect(html).toContain(condition);
  expect(html).toContain('시연용: 실제 확인 없음');
  expect(html).toContain('fetch');
  expect(html).not.toContain("'payment':'모형'");
});
it('documents local demo button behavior for the actual PM condition instead of claiming missing evidence', () => {
  const html = prototypeHtml({ ...input, handoffConditions: [{ text: '모의 버튼으로만 구성됨', sourceId: 'v2' }] }, true);
  expect(html).toContain('모든 동작 버튼은 로컬 화면 상태만 바꾸는 시연용 모의 버튼입니다.');
  expect(html).not.toContain('이 조건에 대한 별도 근거는 만들지 않았으며');
  expect(html).toContain("b.onclick=()=>show(b.dataset.go)");
  expect(html).not.toContain("'payment':'모형'");
});
it('reads current plan conditions before producing the updated artifact', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fake-current-'));
  const connector = new FakeConnector(root, undefined, undefined, 5, async () => ({ title: '예약 시연', handoffConditions: ['외부 API 없음 체크리스트', '결제 제외, 가입 오류·재입력 유지'] }));
  const events: SessionEvent[] = [];
  connector.onEvent(e => events.push(e));
  try {
    const session = await connector.startSession('prototype-agent', 'p');
    await connector.startTask('prototype-agent', input);
    await connector.sendUpdate('prototype-agent', { updateId: 'v2', fromVersion: 1, toVersion: 2, keep: [], change: ['결제 제외'], drop: ['결제'], reason: '범위 축소' });
    await new Promise(r => setTimeout(r, 40));
    const report = events.find(e => e.type === 'report' && e.report.type === 'result_report');
    if (report?.type !== 'report' || report.report.type !== 'result_report') throw new Error('missing report');
    const html = await readFile(path.join(session.workspace, report.report.files[0]!.path), 'utf8');
    expect(html).toContain('외부 API 없음 체크리스트');
    expect(html).toContain('결제 제외, 가입 오류·재입력 유지');
    expect(html).not.toContain('### 1. 가입과 결제');
    expect(report.report.planVersion).toBe(2);
  } finally { await connector.stop(); await rm(root, { recursive: true, force: true }); }
});
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
