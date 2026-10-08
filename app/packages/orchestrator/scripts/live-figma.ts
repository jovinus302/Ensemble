// Issue #78: the real Figma comment round trip, in separate non-interactive phases.
//   --phase=preflight  read-only: GET /v1/me, file/frame metadata, comment counts. Writes nothing.
//   --phase=post       share + inspect + deliver ONE real comment. Requires ENSEMBLE_FIGMA_LIVE=1.
//   --phase=poll       read the PM comment's thread once from the persisted ledger and record new replies
//                      (also the relayed decision's thread, when --phase=relay ran).
//   --phase=relay      record FIGMA_TEST_DECISION as a Space decision, then relayDecision → inspect → deliver one
//                      top-level comment on the frame. Requires ENSEMBLE_FIGMA_LIVE=1.
//   --phase=mentions   human comments with @ensemble/@pm_agent anywhere in the file. Without ENSEMBLE_FIGMA_LIVE=1 it only
//                      lists them with a preview of the answer (no Figma write); with it, records and answers them in-thread.
//   --phase=share      a designer Agent reports its canvas change into the Space (FIGMA_SHARE_SUMMARY; a claim), then the
//                      PM re-reads the file version. Ledger only; Figma is read, never written.
//   --phase=thread     read-only: print one comment thread (FIGMA_THREAD_ID = root comment id).
// Env (the worktree-root .env.local and app/.env.local are loaded first; already-set variables win; values are never printed):
//   FIGMA_ACCESS_TOKEN or FIGMA_TOKEN   token (scopes: current_user:read, file_content:read, file_comments:read, file_comments:write)
//   FIGMA_TEST_FILE_URL                 a figma.com link, or
//   FIGMA_TEST_FILE_KEY [+ FIGMA_TEST_NODE_ID]   without a node id the first top-level FRAME of the first page is used
//   FIGMA_TEST_QUESTION, FIGMA_TEST_GOAL (optional), ENSEMBLE_FIGMA_LIVE_DIR (default <worktree>/.local/figma-live, git-ignored)
//   FIGMA_TEST_DECISION (relay; mentions/share also record it when set)
//   FIGMA_SHARE_SUMMARY, FIGMA_SHARE_BY (default designer-claude), FIGMA_SHARE_LINK, FIGMA_SHARE_REQUEST_ID, FIGMA_SHARE_MENTION_ID (share)
//   FIGMA_THREAD_ID (thread)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NewLedgerEvent } from '@ensemble/core';
import { SqliteLedgerStore } from '@ensemble/store';
import {
  FigmaApiError, FigmaBridge, FigmaRestClient, composeMentionAnswer, figmaChangeReports, figmaMentionItems, figmaSpaceItems, mentionIdFor, mentionQuery,
  nodeIdFromUrl, parseFigmaLink, pmCommentIds, spaceContextItems,
} from '../src/figma/index.ts';

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
const PHASES = 'preflight|post|poll|relay|mentions|share|thread';
const phase = new RegExp(`^--phase=(${PHASES})$`).exec(process.argv.slice(2).find(a => a.startsWith('--phase=')) ?? '')?.[1]
  ?? fail(`Usage: live-figma.ts --phase=${PHASES}`);
const live = process.env.ENSEMBLE_FIGMA_LIVE === '1';
if (loaded.length) console.log(`env loaded from .env.local: ${[...new Set(loaded)].join(', ')}`);
if (!process.env.FIGMA_ACCESS_TOKEN && !process.env.FIGMA_TOKEN) fail('FIGMA_ACCESS_TOKEN or FIGMA_TOKEN is not set.');
if ((phase === 'post' || phase === 'relay') && !live) fail(`Refusing --phase=${phase} without ENSEMBLE_FIGMA_LIVE=1 (it posts a real Figma comment).`);

const client = FigmaRestClient.fromEnv();
const directory = process.env.ENSEMBLE_FIGMA_LIVE_DIR ?? join(root, '.local', 'figma-live');
const statePath = join(directory, 'state.json');
const ledgerPath = join(directory, 'ledger.sqlite');
const context = { projectId: 'live-figma', targetProductId: 'design' };
interface Target { fileKey: string; nodeId: string; frameName?: string; url: string }
interface LiveState { requestId?: string; relayRequestId?: string; decisionId?: string; fileKey?: string; nodeId?: string; url?: string }

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

const readState = async (): Promise<LiveState> => existsSync(statePath) ? JSON.parse(await readFile(statePath, 'utf8')) as LiveState : {};
const saveState = async (patch: LiveState) => writeFile(statePath, JSON.stringify({ ...await readState(), ...patch }, null, 2), 'utf8');

/** The Space decision from FIGMA_TEST_DECISION, recorded as a real `decision_recorded` (read by project().decisions). */
function decisionSeed(): { decisionId: string; event: NewLedgerEvent } | undefined {
  const summary = process.env.FIGMA_TEST_DECISION?.trim();
  if (!summary) return undefined;
  const decisionId = `live-decision-${createHash('sha256').update(summary).digest('hex').slice(0, 10)}`;
  return { decisionId, event: { ...context, actor: { kind: 'human', id: 'owner' }, idempotencyKey: `seed:decision:${decisionId}`, type: 'decision_recorded',
    payload: { decisionId, summary, sourceMessageIds: [], approvedBy: 'owner', changeKinds: [] } } };
}

async function openLedger(extra: NewLedgerEvent[] = []): Promise<{ store: SqliteLedgerStore; bridge: FigmaBridge }> {
  await mkdir(directory, { recursive: true });
  const store = new SqliteLedgerStore(ledgerPath);
  const actor = { kind: 'human' as const, id: 'owner' };
  const seed: NewLedgerEvent[] = [
    { ...context, actor, idempotencyKey: 'seed:owner', type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: 'Owner' } },
    { ...context, actor, idempotencyKey: 'seed:designer', type: 'member_joined', payload: { memberId: 'designer', kind: 'human', displayName: 'Designer' } },
    { ...context, actor, idempotencyKey: 'seed:designer-agent', type: 'member_joined', payload: { memberId: 'designer-agent', kind: 'agent', displayName: 'Designer Agent' } },
    { ...context, actor, idempotencyKey: 'seed:goal', type: 'goal_set', payload: { text: process.env.FIGMA_TEST_GOAL ?? 'Figma 댓글 왕복 feasibility 확인', decider: 'owner', delegation: { pmMayApply: [] } } },
    ...(decisionSeed() ? [decisionSeed()!.event] : []),
    ...extra,
  ];
  await store.append(seed);
  return { store, bridge: new FigmaBridge({ ...context, store, client }) };
}
const report = async (store: SqliteLedgerStore) => {
  const events = await store.read();
  await writeFile(join(directory, `report-${phase}.json`), JSON.stringify({
    ledgerPath, items: figmaSpaceItems(events), mentions: figmaMentionItems(events), changes: [...figmaChangeReports(events).values()],
    events: events.filter(e => e.type.startsWith('figma_')),
  }, null, 2), 'utf8');
};
const line = (text: string, max = 200) => text.replace(/\s+/g, ' ').slice(0, max);

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
    await saveState({ requestId, ...target });
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
} else if (phase === 'poll') {
  const state = await readState();
  if (!state.requestId && !state.relayRequestId) fail(`No request in ${statePath}; run --phase=post or --phase=relay first.`);
  const { store, bridge } = await openLedger();
  try {
    for (const requestId of [state.requestId, state.relayRequestId].filter((id): id is string => !!id)) {
      const polled = await bridge.pollReplies(requestId);
      const view = polled.view;
      console.log(`poll ${requestId}: status=${view.status} new=${polled.newReplies} skippedOwn=${polled.skippedOwn} duplicates=${polled.duplicates} problem=${view.problem?.detail ?? '-'}`);
      for (const r of view.replies) console.log(`reply ${r.commentId} (parent ${r.parentId}) by ${r.author.handle}/${r.author.id}: ${line(r.message)}`);
      for (const f of view.followUps) console.log(`follow-up ${f.followUpId}: verification=${f.verification} reports=${f.reports.length}`);
    }
    await report(store);
  } finally { store.close(); }
} else if (phase === 'relay') {
  const seed = decisionSeed() ?? fail('Set FIGMA_TEST_DECISION (the Space decision text to relay).');
  const target = await resolveTarget();
  const { store, bridge } = await openLedger();
  try {
    const { requestId, duplicate } = await bridge.relayDecision({ url: target.url, decisionId: seed.decisionId });
    await saveState({ relayRequestId: requestId, decisionId: seed.decisionId });
    console.log(`decision=${seed.decisionId} (decision_recorded) request=${requestId}${duplicate ? ' (existing)' : ''}`);
    let view = await bridge.view(requestId);
    if (!view.delivery) {
      view = await bridge.inspect(requestId);
      console.log(`inspect: status=${view.status} version=${view.inspection?.version ?? '-'} problem=${view.problem?.detail ?? '-'}`);
      if (['inspected', 'delivery_failed', 'delivery_unknown', 'delivering'].includes(view.status)) view = await bridge.deliver(requestId);
    }
    console.log(`relay: status=${view.status} commentId=${view.delivery?.commentId ?? '-'} (top-level on frame ${target.nodeId}) reconciled=${view.delivery?.reconciled ?? '-'} problem=${view.problem?.detail ?? '-'}`);
    await report(store);
    if (!view.delivery) process.exitCode = 1;
  } finally { store.close(); }
} else if (phase === 'mentions') {
  const target = await resolveTarget();
  const { store, bridge } = await openLedger();
  try {
    const items = spaceContextItems(await store.read());
    console.log(`space items: goals=${items.filter(i => i.kind === 'goal').length} decisions=${items.filter(i => i.kind === 'decision').length} open=${items.filter(i => i.kind === 'open').length}`);
    if (!live) {
      const scan = await bridge.scanMentions(target.fileKey);
      console.log(`mentions (dry run: nothing posted to Figma, no mention recorded): new=${scan.fresh.length} skippedOwn=${scan.skippedOwn} duplicates=${scan.duplicates}`);
      for (const c of scan.fresh) {
        const mentionId = mentionIdFor(target.fileKey, c.id);
        console.log(`mention ${mentionId} comment=${c.id} root=${c.parentId ?? c.id} by ${c.user.handle}/${c.user.id}: ${line(c.message)}`);
        const preview = composeMentionAnswer(context.projectId, { mentionId, query: mentionQuery(c.message) }, items);
        console.log(`  would answer (${preview.selection}) citing ${preview.citedItemIds.join(', ') || '-'}`);
      }
      console.log('Set ENSEMBLE_FIGMA_LIVE=1 to record and answer them.');
    } else {
      const polled = await bridge.pollMentions(target.fileKey);
      console.log(`mentions: new=${polled.newMentions} skippedOwn=${polled.skippedOwn} duplicates=${polled.duplicates} answered=${polled.answered} problem=${polled.problem ?? '-'}`);
      for (const m of polled.mentions) {
        console.log(`mention ${m.mentionId} comment=${m.commentId} root=${m.rootId} by ${m.author.handle}/${m.author.id} status=${m.status} answer=${m.answer?.commentId ?? '-'} reconciled=${m.answer?.reconciled ?? '-'} problem=${m.problem?.detail ?? '-'}`);
        console.log(`  query: ${line(m.query)}`);
        if (m.answer) console.log(`  cited (${m.answer.selection}): ${m.answer.citedItemIds.join(', ') || '-'}`);
      }
    }
    await report(store);
  } finally { store.close(); }
} else if (phase === 'share') {
  const summary = process.env.FIGMA_SHARE_SUMMARY?.trim() || fail('Set FIGMA_SHARE_SUMMARY (what the designer Agent changed on the canvas).');
  const by = process.env.FIGMA_SHARE_BY?.trim() || 'designer-claude';
  const state = await readState();
  const member: NewLedgerEvent = { ...context, actor: { kind: 'human', id: 'owner' }, idempotencyKey: `seed:${by}`, type: 'member_joined', payload: { memberId: by, kind: 'agent', displayName: by } };
  const { store, bridge } = await openLedger([member]);
  try {
    const requestId = process.env.FIGMA_SHARE_REQUEST_ID?.trim() || state.relayRequestId || state.requestId;
    const fileKey = state.fileKey ?? (requestId ? (await bridge.view(requestId)).fileKey : undefined);
    const mentionId = process.env.FIGMA_SHARE_MENTION_ID?.trim() || (await bridge.mentions(fileKey)).filter(m => m.answer).at(-1)?.mentionId;
    const reported = await bridge.reportChange({ by, summary, ...(process.env.FIGMA_SHARE_LINK ? { url: process.env.FIGMA_SHARE_LINK } : {}),
      ...(requestId ? { requestId } : {}), ...(mentionId ? { mentionId } : {}) });
    console.log(`report ${reported.reportId}: by=${reported.by} verification=${reported.verification} request=${reported.requestId ?? '-'} mention=${reported.mentionId ?? '-'} baseline=${reported.baseline ? `${reported.baseline.version} @ ${reported.baseline.lastModified}` : '-'}`);
    console.log(`  summary: ${line(reported.summary)}`);
    const rechecked = await bridge.recheckChange(reported.reportId);
    console.log(`recheck: verification=${rechecked.recheck?.verification} baselineVersion=${rechecked.recheck?.baselineVersion ?? '-'} observedVersion=${rechecked.recheck?.observedVersion} lastModified=${rechecked.recheck?.observedLastModified} observedAt=${rechecked.recheck?.observedAt}`);
    await report(store);
  } finally { store.close(); }
} else {
  const threadId = process.env.FIGMA_THREAD_ID?.trim() || fail('Set FIGMA_THREAD_ID (the root comment id of the thread).');
  const target = await resolveTarget();
  const comments = await client.comments(target.fileKey);
  const own = existsSync(ledgerPath) ? await (async () => { const s = new SqliteLedgerStore(ledgerPath); try { return pmCommentIds(await s.read()); } finally { s.close(); } })() : new Set<string>();
  const thread = comments.filter(c => c.id === threadId || c.parentId === threadId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!thread.length) fail(`No comment ${threadId} in this file.`);
  for (const c of thread) {
    console.log(`--- ${c.id}${c.parentId ? ` (reply to ${c.parentId})` : ' (root)'} by ${c.user.handle}/${c.user.id} at ${c.createdAt} pm=${own.has(c.id) ? 'yes (ledger id)' : 'no'}`);
    console.log(c.message);
  }
  console.log('thread: read-only, nothing written.');
}
}
// Short failure line instead of a stack: kind, HTTP status and Figma's message only (never the token).
await run().catch((error: unknown) => {
  console.error(`${phase} failed: ${error instanceof FigmaApiError ? `${error.kind}${error.status ? ` ${error.status}` : ''}: ` : ''}${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
