// Shared behavior switch for the fake PM CLIs. FAKE_CLI_MODES is a comma-separated sequence (one mode per
// call, the last one repeats); FAKE_CLI_STATE counts calls; FAKE_CLI_RECORD collects args and stdin.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export async function start() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  const args = process.argv.slice(2);
  const modes = (process.env.FAKE_CLI_MODES ?? 'normal').split(',');
  const state = process.env.FAKE_CLI_STATE;
  const call = state && existsSync(state) ? Number(readFileSync(state, 'utf8')) : 0;
  if (state) writeFileSync(state, String(call + 1));
  if (process.env.FAKE_CLI_RECORD) appendFileSync(process.env.FAKE_CLI_RECORD, JSON.stringify({ args, input }) + '\n');
  const outputs = process.env.FAKE_CLI_OUTPUTS ? JSON.parse(process.env.FAKE_CLI_OUTPUTS) : [{ ok: true }];
  return { args, input, mode: modes[Math.min(call, modes.length - 1)], output: outputs[Math.min(call, outputs.length - 1)] };
}
export const out = value => process.stdout.write(JSON.stringify(value) + '\n');
export const hang = () => setTimeout(() => {}, 60_000);
