// Fake `claude -p --output-format json [--json-schema <schema>]` for ClaudeCliProvider tests.
// Modes: normal, warn (stderr noise), invalid (no structured output, non-JSON result), is_error, fail, hang.
import { hang, out, start } from './fake-cli-common.mjs';

const { args, mode, output } = await start();
const structured = args.includes('--json-schema');
const base = { type: 'result', session_id: 'session-fake', uuid: 'uuid-fake', usage: { input_tokens: 100, output_tokens: 9 }, modelUsage: { 'claude-haiku-fake': {} } };

if (mode === 'hang') hang();
else if (mode === 'fail') {
  process.stderr.write('Error: not logged in\n');
  process.exit(1);
} else if (mode === 'is_error') {
  out({ ...base, subtype: 'success', is_error: true, result: 'API Error: 529 overloaded' });
  process.exit(1);
} else {
  if (mode === 'warn') process.stderr.write('[warn] slow filesystem\n');
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  if (mode === 'invalid') out({ ...base, subtype: 'success', is_error: false, result: '분류 결과는 chat입니다', stop_reason: 'end_turn' });
  else out({ ...base, subtype: 'success', is_error: false, result: text, stop_reason: structured ? 'tool_use' : 'end_turn', ...(structured ? { structured_output: output } : {}) });
}
