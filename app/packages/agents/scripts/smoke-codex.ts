import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { CodexSessionConnector } from '../src/codex/connector.ts';
import { updateInstructions, validateAck, validateResult, type AcknowledgeUpdate, type ResultReport, type TaskInstructionsInput, type UpdateInstructionsInput } from '../src/protocol.ts';
import type { SessionEvent } from '../src/session.ts';

const startedAt = Date.now();
const agentId = `prototype-${startedAt}`;
const workspace = path.join(homedir(), 'ensemble-agent-workspaces', 'smoke', agentId);
const reportPath = path.join(workspace, 'smoke-run.json');
const steps: { step: string; elapsedMs: number; detail: unknown }[] = [];
const record = (step: string, detail: unknown) => {
  const entry = { step, elapsedMs: Date.now() - startedAt, detail };
  steps.push(entry); console.log(JSON.stringify(entry));
};
const connector = new CodexSessionConnector();
const task: TaskInstructionsInput = {
  taskId: 'smoke-flow', planVersion: 1,
  goalSummary: { text: '사용 흐름 문서를 가입, 온보딩, 대시보드, 결제 섹션으로 만드세요.', sourceId: 'smoke-goal' },
  taskTitle: { text: '한국어 사용 흐름을 섹션별 Markdown 파일로 단계적으로 작성', sourceId: 'smoke-plan-v1' },
  handoffConditions: [{ text: '가입.md, 온보딩.md, 대시보드.md, 결제.md 파일을 한 번에 하나씩 작성하고 마지막에 result_report를 제출하세요. 각 섹션은 3~5개의 사용자 행동과 화면 반응을 포함해야 합니다.', sourceId: 'smoke-acceptance' }],
  decisions: [{ text: '한 파일 작성 후 다음 단계로 넘어가세요. 진행 중 계획 변경 메시지가 오면 먼저 acknowledge_update를 보고하고 변경된 인계 조건을 따르세요.', sourceId: 'smoke-rules' }],
  inputs: [], openQuestions: [],
};
const update: UpdateInstructionsInput = { updateId: `smoke-update-${startedAt}`, fromVersion: 1, toVersion: 2,
  keep: ['가입', '대시보드'], change: ["온보딩에 '관심 분야 선택' 추가"], drop: ['결제'], reason: '결제 섹션은 다음 단계로 미룹니다.' };
let ack: AcknowledgeUpdate | undefined;
let result: ResultReport | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let updateAttempt: Promise<{ sent: boolean; reason?: string }> | undefined;
const completed = new Map<string, SessionEvent & { type: 'turn' }>();
const waiters = new Map<string, (event: SessionEvent & { type: 'turn' }) => void>();
let currentTurn: string | undefined;
let requestUpdate = false;
const sendUpdate = () => {
  if (updateAttempt) return;
  if (!currentTurn) { requestUpdate = true; return; }
  updateAttempt = connector.sendUpdate(agentId, update).then(value => { record('steer', value); return value; });
  // Keep the original rejection for the awaited path without unhandled rejections.
  void updateAttempt.catch(() => undefined);
};
const waitForTurn = (turnId: string) => completed.has(turnId)
  ? Promise.resolve(completed.get(turnId)!)
  : new Promise<SessionEvent & { type: 'turn' }>(resolve => waiters.set(turnId, resolve));
connector.onEvent(event => {
  if (event.type === 'turn') {
    record('turn', { turnId: event.turnId, status: event.status });
    if (event.status === 'started' && !timer && !updateAttempt) timer = setTimeout(sendUpdate, 750);
    if (event.status !== 'started') { completed.set(event.turnId, event); waiters.get(event.turnId)?.(event); }
  } else if (event.type === 'reply') {
    record('agent_message', { itemId: event.itemId, characters: event.text.length });
    sendUpdate();
  } else if (event.type === 'parse_error') record('parse_error', event.error.reason);
  else if (event.report.type === 'acknowledge_update') {
    ack = event.report;
    record('acknowledgement', { report: ack, validation: validateAck(ack, { updateId: update.updateId, planVersion: 2, drop: update.drop }) });
  } else if (event.report.type === 'result_report') {
    result = event.report; record('result_report', result);
  } else record('question', event.report);
});

let timeout: ReturnType<typeof setTimeout> | undefined;
let success = false;
try {
  await mkdir(workspace, { recursive: true });
  await Promise.race([
    (async () => {
      const session = await connector.startSession(agentId, 'smoke'); record('session', session);
      currentTurn = await connector.startTask(agentId, task); record('start', { turnId: currentTurn });
      if (requestUpdate) sendUpdate();
      // Wait until the 750ms timer or first agent message attempts steering.
      while (!updateAttempt) await new Promise(resolve => setTimeout(resolve, 25));
      const steered = await updateAttempt;
      if (!steered.sent) {
        const terminal = await waitForTurn(currentTurn);
        record('fallback', { reason: steered.reason, previousStatus: terminal.status, action: 'Deliver update in the next turn' });
        currentTurn = await connector.startTask(agentId, { ...task, planVersion: 2,
          handoffConditions: [{ text: "가입.md, 온보딩.md, 대시보드.md만 보고하고 온보딩에 관심 분야 선택을 넣으세요. 결제는 제외합니다.", sourceId: 'smoke-v2' }],
          inputs: [{ text: updateInstructions(update), sourceId: update.updateId }] });
      }
      const terminal = await waitForTurn(currentTurn);
      const files = (await readdir(workspace)).filter(file => file !== 'smoke-run.json');
      const ackValidation = ack ? validateAck(ack, { updateId: update.updateId, planVersion: 2, drop: update.drop }) : { ok: false, reasons: ['No acknowledgement received'] };
      const resultValidation = result ? validateResult(result, { taskId: task.taskId, planVersion: 2, dropped: [...update.drop, ...(ack?.dropped ?? [])] }) : { ok: false, reasons: ['No result report received'] };
      const paymentFiles = files.filter(file => /결제|payment/i.test(file));
      const paymentAccountedFor = paymentFiles.every(file => ack?.dropped.some(dropped => dropped === file || dropped === file.replace(/\.md$/, '')));
      const onboarding = await readFile(path.join(workspace, '온보딩.md'), 'utf8').catch(() => '');
      const interestsPresent = onboarding.includes('관심 분야');
      const reportedFilesExist = result ? (await Promise.all(result.files.map(async file => {
        const relative = path.relative(workspace, path.resolve(workspace, file.path));
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
        return readFile(path.join(workspace, file.path)).then(() => true, () => false);
      }))).every(Boolean) : false;
      record('verification', { steered: steered.sent, ackValidation, resultValidation, files, paymentFiles, paymentAccountedFor, interestsPresent, reportedFilesExist, turnStatus: terminal.status });
      success = steered.sent && ackValidation.ok && resultValidation.ok && paymentAccountedFor && interestsPresent && reportedFilesExist && terminal.status === 'completed';
    })(),
    new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Smoke exceeded 240 seconds')), 240_000); }),
  ]);
} catch (error) {
  record('failure', error instanceof Error ? error.message : String(error));
} finally {
  if (timer) clearTimeout(timer);
  if (timeout) clearTimeout(timeout);
  await connector.stop();
  const summary = { success, workspace, elapsedMs: Date.now() - startedAt, steps };
  await mkdir(workspace, { recursive: true });
  await writeFile(reportPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify({ ...summary, steps: undefined, reportPath }));
  if (!success) process.exitCode = 1;
}
