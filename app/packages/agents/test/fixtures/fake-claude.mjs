// Fake `claude -p --output-format stream-json` CLI for ClaudeSessionConnector tests.
// ENSEMBLE_FAKE_CLAUDE selects the behavior: normal (default), errors, fail, hang, api-error, late, ask.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const mode = process.env.ENSEMBLE_FAKE_CLAUDE ?? 'normal';
const args = process.argv.slice(2);
const resumed = args.includes('--resume');
const sessionId = resumed ? randomUUID() : args[args.indexOf('--session-id') + 1];

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

const line = value => JSON.stringify(value) + '\n';
const out = value => process.stdout.write(line(value));
out({ type: 'system', subtype: 'init', session_id: sessionId });

const fence = value => '```ensemble-report\n' + JSON.stringify(value) + '\n```';
const taskId = /작업 ID[:\s]+([\w-]+)/.exec(input)?.[1] ?? 'task';
const updateId = /변경 ID: (\S+)/.exec(input)?.[1];
const version = Number(/버전 \d+ → (\d+)/.exec(input)?.[1] ?? /계획 버전[:\s()]*(\d+)/.exec(input)?.[1] ?? 1);
const reply = blocks => ({ type: 'assistant', session_id: sessionId, message: { id: `msg-${randomUUID()}`, content: [{ type: 'text', text: [`[session:${resumed ? 'resume' : 'new'}]`, ...blocks].join('\n') }] } });
const success = { type: 'result', subtype: 'success', is_error: false, result: '완료', session_id: sessionId };
const normal = () => [
  ...(updateId ? [fence({ type: 'acknowledge_update', updateId, planVersion: version, applied: ['반영'], dropped: ['결제'] })] : []),
  fence({ type: 'result_report', taskId, planVersion: version, summary: '완료', files: [{ path: 'out.md', description: '결과 파일' }] }),
];

if (mode === 'hang') {
  setTimeout(() => {}, 60_000); // Stays alive until the connector kills it.
} else if (mode === 'fail') {
  process.stderr.write('model unavailable');
  out({ type: 'result', subtype: 'error_during_execution', session_id: sessionId });
  process.exit(1);
} else if (mode === 'api-error') {
  // The real CLI reports API/model errors as a synthetic assistant message and a "success" result flagged is_error.
  process.stderr.write('[claude-code:unrecognized_model] {"model":"zzz"}');
  const text = "There's an issue with the selected model (zzz). It may not exist or you may not have access to it.";
  out({ type: 'assistant', session_id: sessionId, error: 'model_not_found', is_api_error_message: true,
    message: { id: 'synthetic-1', model: '<synthetic>', content: [{ type: 'text', text }] } });
  out({ type: 'result', subtype: 'success', is_error: true, result: text, session_id: sessionId });
  process.exit(1);
} else if (mode === 'late') {
  // A non-fatal auth warning on stderr, then the final records reach stdout only after this process exited:
  // a grandchild holds the inherited stdout and writes them, the last one without a trailing newline.
  process.stderr.write('claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set.\n');
  const tail = line(reply(normal())) + JSON.stringify(success);
  spawn(process.execPath, ['-e', `setTimeout(() => process.stdout.write(${JSON.stringify(tail)}), 400)`], { stdio: ['ignore', 'inherit', 'ignore'], detached: true, windowsHide: true }); // Detached: it outlives this process.
  process.exit(0);
} else if (mode === 'ask' && !updateId) {
  // A slow first turn that ends on a question, leaving the task running; a turn carrying an update finishes it.
  await new Promise(resolve => setTimeout(resolve, Number(process.env.ENSEMBLE_FAKE_CLAUDE_DELAY_MS ?? 1000)));
  out(reply([fence({ type: 'question', taskId, question: '어떤 틀로 쓸까요?', options: ['A', 'B'] })]));
  out(success);
} else {
  const blocks = mode === 'errors'
    ? ['```ensemble-report\n{broken\n```', fence({ type: 'question', taskId, question: '어떤 틀로 쓸까요?', options: ['A', 'B'] })]
    : normal();
  out(reply(blocks));
  out(success);
}
