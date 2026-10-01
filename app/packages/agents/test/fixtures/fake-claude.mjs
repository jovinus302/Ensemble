// Fake `claude -p --output-format stream-json` CLI for ClaudeSessionConnector tests.
// ENSEMBLE_FAKE_CLAUDE selects the behavior: normal (default), errors, fail, hang.
import { randomUUID } from 'node:crypto';

const mode = process.env.ENSEMBLE_FAKE_CLAUDE ?? 'normal';
const args = process.argv.slice(2);
const resumed = args.includes('--resume');
const sessionId = resumed ? randomUUID() : args[args.indexOf('--session-id') + 1];

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

const out = value => process.stdout.write(JSON.stringify(value) + '\n');
out({ type: 'system', subtype: 'init', session_id: sessionId });

if (mode === 'hang') {
  setTimeout(() => {}, 60_000); // Stays alive until the connector kills it.
} else if (mode === 'fail') {
  process.stderr.write('model unavailable');
  out({ type: 'result', subtype: 'error_during_execution', session_id: sessionId });
  process.exit(1);
} else {
  const fence = value => '```ensemble-report\n' + JSON.stringify(value) + '\n```';
  const taskId = /작업 ID[:\s]+([\w-]+)/.exec(input)?.[1] ?? 'task';
  const updateId = /변경 ID: (\S+)/.exec(input)?.[1];
  const version = Number(/버전 \d+ → (\d+)/.exec(input)?.[1] ?? /계획 버전[:\s()]*(\d+)/.exec(input)?.[1] ?? 1);
  const blocks = mode === 'errors'
    ? ['```ensemble-report\n{broken\n```', fence({ type: 'question', taskId, question: '어떤 틀로 쓸까요?', options: ['A', 'B'] })]
    : [
        ...(updateId ? [fence({ type: 'acknowledge_update', updateId, planVersion: version, applied: ['반영'], dropped: ['결제'] })] : []),
        fence({ type: 'result_report', taskId, planVersion: version, summary: '완료', files: [{ path: 'out.md', description: '결과 파일' }] }),
      ];
  const text = [`[session:${resumed ? 'resume' : 'new'}]`, ...blocks].join('\n');
  out({ type: 'assistant', session_id: sessionId, message: { id: 'msg-1', content: [{ type: 'text', text }] } });
  out({ type: 'result', subtype: 'success', result: '완료', session_id: sessionId });
}
