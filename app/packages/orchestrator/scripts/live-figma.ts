// Issue #78: the real Figma comment round trip, in separate non-interactive phases.
//   --phase=preflight  read-only: GET /v1/me, file/frame metadata, comment counts. Writes nothing.
//   --phase=post       share + inspect + deliver ONE real comment. Requires ENSEMBLE_FIGMA_LIVE=1.
//   --phase=poll       read the PM comment's thread once from the persisted ledger and record new replies.
// Env (the worktree-root .env.local and app/.env.local are loaded first; already-set variables win; values are never printed):
//   FIGMA_ACCESS_TOKEN or FIGMA_TOKEN   token (scopes: current_user:read, file_content:read, file_comments:read, file_comments:write)
//   FIGMA_TEST_FILE_URL                 a figma.com link, or
//   FIGMA_TEST_FILE_KEY [+ FIGMA_TEST_NODE_ID]   without a node id the first top-level FRAME of the first page is used
//   FIGMA_TEST_QUESTION, FIGMA_TEST_GOAL (optional), ENSEMBLE_FIGMA_LIVE_DIR (default <worktree>/.local/figma-live, git-ignored)
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NewLedgerEvent } from '@ensemble/core';
import { SqliteLedgerStore } from '@ensemble/store';
import { FigmaApiError, FigmaBridge, FigmaRestClient, figmaSpaceItems, nodeIdFromUrl, parseFigmaLink } from '../src/figma/index.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const loaded: string[] = [];
for (const file of [join(root, '.env.local'), join(root, 'app', '.env.local')]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith('#')) continue;
    const [, key, raw] = match as unknown as [string, string, string];
    if (process.env[key] !== undefined) continue;
    process.env[key] = /^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
    loaded.push(key);
  }
}
const fail = (message: string): never => { console.error(message); process.exit(2); };
const phase = /^--phase=(preflight|post|poll)$/.exec(process.argv.slice(2).find(a => a.startsWith('--phase=')) ?? '')?.[1]
  ?? fail('Usage: live-figma.ts --phase=preflight|post|poll');
if (loaded.length) console.log(`env loaded from .env.local: ${[...new Set(loaded)].join(', ')}`);
if (!process.env.FIGMA_ACCESS_TOKEN && !process.env.FIGMA_TOKEN) fail('FIGMA_ACCESS_TOKEN or FIGMA_TOKEN is not set.');
if (phase === 'post' && process.env.ENSEMBLE_FIGMA_LIVE !== '1') fail('Refusing --phase=post without ENSEMBLE_FIGMA_LIVE=1 (it posts a real Figma comment).');

const client = FigmaRestClient.fromEnv();
const directory = process.env.ENSEMBLE_FIGMA_LIVE_DIR ?? join(root, '.local', 'figma-live');
const statePath = join(directory, 'state.json');
const ledgerPath = join(directory, 'ledger.sqlite');
const context = { projectId: 'live-figma', targetProductId: 'design' };
interface Target { fileKey: string; nodeId: string; frameName?: string; url: string }

async function resolveTarget(): Promise<Target> {
  let fileKey: string | undefined;
  let nodeId: string | undefined;
  if (process.env.FIGMA_TEST_FILE_URL) {
    const link = parseFigmaLink(process.env.FIGMA_TEST_FILE_URL) ?? fail('FIGMA_TEST_FILE_URL is not a figma.com file link.');
    fileKey = link.fileKey; nodeId = link.nodeId;
  } else if (process.env.FIGMA_TEST_FILE_KEY) {
    fileKey = process.env.FIGMA_TEST_FILE_KEY.trim();
    if (process.env.FIGMA_TEST_NODE_ID) nodeId = nodeIdFromUrl(process.env.FIGMA_TEST_NODE_ID.trim()) ?? fail('FIGMA_TEST_NODE_ID is not a node id like 1:2 or 1-2.');
  } else fail('Set FIGMA_TEST_FILE_URL or FIGMA_TEST_FILE_KEY.');
  let frameName: string | undefined;
  if (!nodeId) {
    const frame = await client.firstFrame(fileKey!);
    if (!frame) fail('No node id given and the first page has no top-level FRAME.');
    nodeId = frame!.id; frameName = frame!.name;
    console.log(`frame (auto: first top-level FRAME of first page): id=${nodeId} name=${frameName}`);
  }
  const url = `https://www.figma.com/design/${fileKey}/ensemble-live?node-id=${nodeId!.replaceAll(':', '-')}`;
  if (!parseFigmaLink(url)) fail(`File key does not look like a Figma file key.`);
  return { fileKey: fileKey!, nodeId: nodeId!, ...(frameName ? { frameName } : {}), url };
}

async function openLedger(): Promise<{ store: SqliteLedgerStore; bridge: FigmaBridge }> {
  await mkdir(directory, { recursive: true });
  const store = new SqliteLedgerStore(ledgerPath);
  const actor = { kind: 'human' as const, id: 'owner' };
  const seed: NewLedgerEvent[] = [
    { ...context, actor, idempotencyKey: 'seed:owner', type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: 'Owner' } },
    { ...context, actor, idempotencyKey: 'seed:designer', type: 'member_joined', payload: { memberId: 'designer', kind: 'human', displayName: 'Designer' } },
    { ...context, actor, idempotencyKey: 'seed:designer-agent', type: 'member_joined', payload: { memberId: 'designer-agent', kind: 'agent', displayName: 'Designer Agent' } },
    { ...context, actor, idempotencyKey: 'seed:goal', type: 'goal_set', payload: { text: process.env.FIGMA_TEST_GOAL ?? 'Figma 댓글 왕복 feasibility 확인', decider: 'owner', delegation: { pmMayApply: [] } } },
  ];
  await store.append(seed);
  return { store, bridge: new FigmaBridge({ ...context, store, client }) };
}
const report = async (store: SqliteLedgerStore) => writeFile(join(directory, `report-${phase}.json`), JSON.stringify({
  ledgerPath, items: figmaSpaceItems(await store.read()), events: (await store.read()).filter(e => e.type.startsWith('figma_')),
}, null, 2), 'utf8');

async function run(): Promise<void> {
if (phase === 'preflight') {
  const me = await client.me();
  console.log(`account: handle=${me.handle} id=${me.id}`);
  const target = await resolveTarget();
  const file = await client.file(target.fileKey, [target.nodeId]);
  const node = file.nodes[target.nodeId];
  console.log(`file: name=${file.name} version=${file.version} lastModified=${file.lastModified}`);
  console.log(`frame: id=${target.nodeId} ${node ? `found name=${node.name} type=${node.type}` : 'NOT FOUND'}`);
  const comments = await client.comments(target.fileKey);
  console.log(`comments: total=${comments.length} onFrame=${comments.filter(c => !c.parentId && c.nodeId === target.nodeId).length} byThisAccount=${comments.filter(c => c.user.id === me.id).length}`);
  console.log('preflight: read-only, nothing written.');
} else if (phase === 'post') {
  const target = await resolveTarget();
  const { store, bridge } = await openLedger();
  try {
    const { requestId, duplicate } = await bridge.shareLink({ url: target.url, sharedBy: 'designer-agent', onBehalfOf: 'designer',
      question: process.env.FIGMA_TEST_QUESTION ?? '이 프레임의 주요 버튼 문구를 확정해도 될까요?' });
    await writeFile(statePath, JSON.stringify({ requestId, ...target }, null, 2), 'utf8');
    console.log(`request=${requestId}${duplicate ? ' (existing)' : ''} ledger=${ledgerPath}`);
    let view = await bridge.view(requestId);
    if (!view.delivery) {
      view = await bridge.inspect(requestId);
      console.log(`inspect: status=${view.status} version=${view.inspection?.version ?? '-'} nodes=${JSON.stringify(view.inspection?.nodes ?? [])} problem=${view.problem?.detail ?? '-'}`);
      if (['inspected', 'delivery_failed', 'delivery_unknown', 'delivering'].includes(view.status)) view = await bridge.deliver(requestId);
    }
    console.log(`deliver: status=${view.status} commentId=${view.delivery?.commentId ?? '-'} reconciled=${view.delivery?.reconciled ?? '-'} problem=${view.problem?.detail ?? '-'}`);
    if (view.delivery) console.log('Next: reply to that comment in Figma (untagged text), then run --phase=poll.');
    await report(store);
    if (!view.delivery) process.exitCode = 1;
  } finally { store.close(); }
} else {
  if (!existsSync(statePath)) fail(`No ${statePath}; run --phase=post first.`);
  const { requestId } = JSON.parse(await readFile(statePath, 'utf8')) as { requestId: string };
  const { store, bridge } = await openLedger();
  try {
    const polled = await bridge.pollReplies(requestId);
    const view = polled.view;
    console.log(`poll: status=${view.status} new=${polled.newReplies} skippedOwn=${polled.skippedOwn} duplicates=${polled.duplicates} problem=${view.problem?.detail ?? '-'}`);
    for (const r of view.replies) console.log(`reply ${r.commentId} (parent ${r.parentId}) by ${r.author.handle}/${r.author.id}: ${r.message.slice(0, 200)}`);
    for (const f of view.followUps) console.log(`follow-up ${f.followUpId}: verification=${f.verification} reports=${f.reports.length}`);
    await report(store);
  } finally { store.close(); }
}
}
// Short failure line instead of a stack: kind, HTTP status and Figma's message only (never the token).
await run().catch((error: unknown) => {
  console.error(`${phase} failed: ${error instanceof FigmaApiError ? `${error.kind}${error.status ? ` ${error.status}` : ''}: ` : ''}${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
