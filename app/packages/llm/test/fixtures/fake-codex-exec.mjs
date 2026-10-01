// Fake `codex exec --json -o <file> [--output-schema <file>] -` for CodexCliProvider tests.
// Modes: normal, warn (non-fatal error items and stderr), invalid (non-JSON final message), fail, hang.
import { readFileSync, writeFileSync } from 'node:fs';
import { hang, out, start } from './fake-cli-common.mjs';

const { args, mode, output } = await start();
const value = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
out({ type: 'thread.started', thread_id: 'thread-fake' });
out({ type: 'turn.started' });

// Like the real API: strict structured output rejects open objects and optional properties.
const strictError = schema => {
  if (schema && typeof schema === 'object') {
    if (schema.properties) {
      if (schema.additionalProperties !== false) return "'additionalProperties' is required to be supplied and to be false";
      if (JSON.stringify([...(schema.required ?? [])].sort()) !== JSON.stringify(Object.keys(schema.properties).sort())) return "'required' must include every property";
    }
    if (schema.oneOf) return "'oneOf' is not permitted";
    for (const child of Object.values(schema)) { const error = strictError(child); if (error) return error; }
  }
  return undefined;
};
const schemaFile = value('--output-schema');
const schemaError = schemaFile && strictError(JSON.parse(readFileSync(schemaFile, 'utf8')));

if (mode === 'hang') hang();
else if (mode === 'fail' || schemaError) {
  const message = schemaError ? `Invalid schema for response_format 'codex_output_schema': ${schemaError}` : 'model unavailable';
  process.stderr.write('codex failed\n');
  out({ type: 'error', message });
  out({ type: 'turn.failed', error: { message } });
  process.exit(1);
} else {
  if (mode === 'warn') {
    process.stderr.write('WARNING: clamping hook timeout\n');
    out({ type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Model metadata not found' } });
  }
  const text = mode === 'invalid' ? '분류 결과는 chat입니다' : typeof output === 'string' ? output : JSON.stringify(output);
  writeFileSync(value('-o'), text);
  out({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text } });
  out({ type: 'turn.completed', usage: { input_tokens: 120, cached_input_tokens: 0, output_tokens: 7 } });
}
