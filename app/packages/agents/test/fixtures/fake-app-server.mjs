import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

// Wire fixtures follow the local codex-cli 0.154.0 schema. test/* is fixture-only.
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const result = (id, value) => send({ id, result: value });
const error = (id, code, message) => send({ id, error: { code, message } });
const notify = (method, params) => send({ method, params });
const threads = new Map();
const serverRequests = new Map();
const received = [];
const protocolTasks = new Map();
const protocolMode = process.env.ENSEMBLE_FAKE_PROTOCOL;
const fence = report => '```ensemble-report\n' + JSON.stringify(report) + '\n```';
function reportItem(thread, turn, id, text) {
  const item = { type: 'agentMessage', id, text };
  turn.items.push(item);
  const params = { threadId: thread.id, turnId: turn.id, item, completedAtMs: Date.now() };
  notify('item/completed', params);
  if (process.env.ENSEMBLE_FAKE_DUPLICATE) notify('item/completed', params);
}
let initialized = false;
let nextThread = 0;
let nextTurn = 0;
let nextRequest = 0;

function threadResponse(thread) {
  return { thread, model: 'fake', modelProvider: 'fake', cwd: thread.cwd,
    approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'workspaceWrite' } };
}
function finish(thread, turn, status = 'completed') {
  if (turn.status !== 'inProgress') return;
  if (status === 'failed') turn.error = { message: 'fake model failure' };
  const item = { type: 'agentMessage', id: `item-${turn.id}`, text: 'fake answer', phase: 'final_answer' };
  turn.items.push(item);
  turn.status = status;
  notify('item/completed', { threadId: thread.id, turnId: turn.id, item, completedAtMs: Date.now() });
  notify('turn/completed', { threadId: thread.id, turn });
  if (process.env.ENSEMBLE_FAKE_DUPLICATE) notify('turn/completed', { threadId: thread.id, turn });
}
function request(method, params) {
  // Alternate numeric and string IDs, independently of the client's request space.
  const n = ++nextRequest;
  const id = n % 2 ? `server-${n}` : n;
  return new Promise(resolve => { serverRequests.set(id, resolve); send({ id, method, params }); });
}
async function approvals(thread, turn) {
  const common = { threadId: thread.id, turnId: turn.id, itemId: 'approval-item', startedAtMs: Date.now() };
  const requests = [
    ['item/commandExecution/requestApproval', common],
    ['item/fileChange/requestApproval', common],
    ['item/permissions/requestApproval', { ...common, cwd: thread.cwd, permissions: {} }],
    ['item/tool/requestUserInput', { ...common, isBlocking: true, questions: [] }],
    ['mcpServer/elicitation/request', { threadId: thread.id, serverName: 'fake' }],
    ['applyPatchApproval', { callId: 'patch', conversationId: thread.id, fileChanges: {} }],
    ['execCommandApproval', { callId: 'exec', conversationId: thread.id, command: ['echo', 'hello'], cwd: thread.cwd, parsedCmd: [] }],
    ['test/unknownServerRequest', {}],
  ];
  const answers = await Promise.all(requests.map(async ([method, params]) => ({ method, response: await request(method, params) })));
  notify('test/serverAnswers', answers);
  finish(thread, turn);
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', async line => {
  const message = JSON.parse(line);
  received.push(message);
  notify('test/wire', message);
  if (!message.method) {
    serverRequests.get(message.id)?.(message);
    serverRequests.delete(message.id);
    return;
  }
  const { id, method, params = {} } = message;
  if ('jsonrpc' in message) { error(id, -32600, 'Unexpected jsonrpc field'); return; }
  if (method === 'initialized') { initialized = true; return; }
  switch (method) {
    case 'initialize':
      result(id, { userAgent: 'fake', codexHome: process.cwd(), platformFamily: 'windows', platformOs: 'windows' }); break;
    case 'thread/start': {
      if (!initialized) { error(id, -32000, 'Not initialized'); break; }
      const thread = { id: `thread-${++nextThread}`, cwd: params.cwd ?? process.cwd(), turns: [],
        cliVersion: '0.154.0', createdAt: 0, updatedAt: 0, ephemeral: false, modelProvider: 'fake',
        preview: '', projectId: null, sessionId: 'fake-session', source: 'appServer', status: { type: 'idle' },
        developerInstructions: params.developerInstructions };
      threads.set(thread.id, thread);
      result(id, threadResponse(thread)); break;
    }
    case 'thread/resume':
    case 'thread/read': {
      const thread = threads.get(params.threadId);
      if (!thread) { error(id, -32602, 'Thread not found'); break; }
      const copy = { ...thread, turns: (method === 'thread/read' ? params.includeTurns : !params.excludeTurns) ? thread.turns : [] };
      result(id, method === 'thread/read' ? { thread: copy } : threadResponse(copy)); break;
    }
    case 'turn/start': {
      const thread = threads.get(params.threadId);
      if (!thread) { error(id, -32602, 'Thread not found'); break; }
      const turn = { id: `turn-${++nextTurn}`, status: 'inProgress', items: [] };
      thread.turns.push(turn);
      result(id, { turn });
      notify('turn/started', { threadId: thread.id, turn });
      if (protocolMode) {
        const text = params.input[0].text;
        const taskId = /"taskId":\s*"([^"]+)"/.exec(text)?.[1] ?? 'task';
        protocolTasks.set(turn.id, { taskId });
        reportItem(thread, turn, `progress-${turn.id}`, 'Working on the first section.');
        // Result modes: the agent writes its file into the thread's workspace and reports it at once.
        const version = Number(/"planVersion":\s*(\d+)/.exec(text)?.[1] ?? 1);
        const results = { result: `alternatives-${taskId}.md`, linked: 'link/secret.md', big: 'big.md', missing: 'missing.md' };
        if (protocolMode in results) {
          if (protocolMode === 'result') writeFileSync(path.join(thread.cwd, results.result), `# 대안 비교 (${taskId})\n| 대안 | 특징 |\n|---|---|\n| A | 가입 흐름 |\n`);
          if (protocolMode === 'big') writeFileSync(path.join(thread.cwd, 'big.md'), 'x'.repeat(3 * 1024 * 1024));
          reportItem(thread, turn, `result-${turn.id}`, fence({ type: 'result_report', taskId, planVersion: version,
            summary: '대안 2개를 표로 정리했습니다', files: [{ path: results[protocolMode], description: '대안 비교표' }] }));
          finish(thread, turn);
        }
        if (protocolMode === 'fail') finish(thread, turn, 'failed');
        if (protocolMode === 'instructions') reportItem(thread, turn, `dev-${turn.id}`, `developer: ${thread.developerInstructions ?? ''}`);
        if (protocolMode === 'crash') setTimeout(() => process.exit(3), 20);
        if (protocolMode === 'errors') {
          reportItem(thread, turn, `bad-${turn.id}`, '```ensemble-report\nnot json\n```');
          reportItem(thread, turn, `question-${turn.id}`, fence({ type: 'question', taskId, question: 'Which color?', options: ['blue', 'green'] }));
        }
      } else if (params.input[0].text !== 'hold') void approvals(thread, turn);
      break;
    }
    case 'turn/steer': {
      const turn = threads.get(params.threadId)?.turns.at(-1);
      if (!turn || turn.status !== 'inProgress' || turn.id !== params.expectedTurnId) {
        error(id, -32602, 'No matching active turn'); break;
      }
      if (protocolMode) {
        const thread = threads.get(params.threadId);
        const taskId = protocolTasks.get(turn.id).taskId;
        const version = Number(/"planVersion":\s*(\d+)/.exec(params.input[0].text)?.[1] ?? 2);
        reportItem(thread, turn, `ack-${turn.id}`, fence({ type: 'acknowledge_update', updateId: params.clientUserMessageId,
          planVersion: version, applied: ['interests'], dropped: protocolMode === 'bad-ack' ? [] : ['결제', 'payment.md'] }));
        reportItem(thread, turn, `result-${turn.id}`, fence({ type: 'result_report', taskId, planVersion: version,
          summary: 'Updated onboarding', files: [{ path: protocolMode === 'bad-result' ? 'payment.md' : protocolMode === 'unsafe-path' ? '../outside.md' : 'onboarding.md', description: 'Onboarding' }] }));
        // Notifications intentionally precede the steer response.
        finish(thread, turn);
      }
      result(id, { turnId: turn.id }); break;
    }
    case 'turn/interrupt': {
      const thread = threads.get(params.threadId);
      const turn = thread?.turns.find(turn => turn.id === params.turnId);
      if (!turn) { error(id, -32602, 'Turn not found'); break; }
      finish(thread, turn, 'interrupted'); result(id, {}); break;
    }
    case 'test/echo':
      notify('test/interleaved', { value: params.value });
      setTimeout(() => result(id, params.value), params.delay ?? 0); break;
    case 'test/received': result(id, received.slice(0, -1)); break;
    case 'test/context': result(id, { cwd: process.cwd(), value: process.env.CODEX_TEST_VALUE }); break;
    case 'test/handler': result(id, await request('test/custom', {})); break;
    case 'test/hang': break;
    case 'test/exit': process.stderr.write('secret-token C:/private/path ' + 'x'.repeat(8000), () => process.exit(7)); break;
    case 'test/malformed': process.stdout.write('not json\n'); break;
    case 'test/chunked': {
      const wire = JSON.stringify({ id, result: 'split 한글' }) + '\r\n';
      process.stdout.write(wire.slice(0, 9));
      setTimeout(() => process.stdout.write(wire.slice(9)), 5); break;
    }
    default: error(id, -32601, 'Method not found');
  }
});
