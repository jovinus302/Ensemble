// Live Slack <-> Space run over Socket Mode (issue #79, EXPERIMENT). No public URL needed.
//   npm run live:slack -- --check                       auth.test, token scopes, channel access, Socket Mode open
//   npm run live:slack                                   Flow A: mention the app in a thread of the test channel
//   npm run live:slack -- --trigger-blocker "<text>"     Flow B: a personal-agent blocker lands in the Space
//   npm run live:slack -- --trigger-result "<text>"      Flow B: a personal-agent result lands in the Space
// Options: --pm template|env (default env, template when no model credentials), --minutes <n> (stop after n
// minutes), --response-timeout-minutes <n> (default 60), --data <sqlite file> (default app/data/slack-live.db).
// Settings come from .env.local (app/ or the repo root) and .env; values are never printed, only key names.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { project, externalConversation, type NewLedgerEvent } from '@ensemble/core';
import { loadEnv, modelFor, pmRuntimeFromEnv, type LlmProvider } from '@ensemble/llm';
import { SqliteLedgerStore } from '@ensemble/store';
import { openSocketModeUrl, slackCall, slackConfigFromEnv, SlackApiError, SlackSocketModeClient, SlackWebApi } from '@ensemble/channel';
import { SlackCoordinator, slackBindingFromConfig } from '../src/slack-coordination.ts';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const repoRoot = resolve(appRoot, '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

// --- settings, loaded without printing values ---------------------------------------------------
const loaded: string[] = [];
for (const file of [join(appRoot, '.env.local'), join(repoRoot, '.env.local')]) {
  // process.loadEnvFile keeps values already set, so app/.env.local wins over the repo root's.
  if (existsSync(file)) { process.loadEnvFile(file); loaded.push(relative(repoRoot, file)); }
}
const dotEnv = loadEnv(appRoot);
if (dotEnv) loaded.push(relative(repoRoot, dotEnv));
const SECRET_KEYS = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET', 'ANTHROPIC_API_KEY'];
const secrets = SECRET_KEYS.map(k => process.env[k]?.trim()).filter((v): v is string => !!v && v.length >= 8);
function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('[redacted]');
  return out.replace(/\bx(?:ox[abposr]|app)-[A-Za-z0-9-]+/g, '[redacted]').replace(/wss:\/\/[^"\s]+/g, 'wss://[redacted]');
}
function log(step: string, data: Record<string, unknown> = {}) {
  console.log(redact(JSON.stringify({ at: new Date().toISOString(), ...data, step })));
}
const present = Object.fromEntries(['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_CHANNEL_ID', 'SLACK_TEST_CHANNEL_ID', 'SLACK_TEAM_ID', 'SLACK_BOT_USER_ID', 'SLACK_USER_MAP', 'SLACK_OWNER_USER_ID'].map(k => [k, !!process.env[k]?.trim()]));
log('env', { files: loaded, present });

const env = slackConfigFromEnv();
if (!env.ok) { log('config_missing', { missing: env.missing }); process.exit(2); }
const config = env.config;
const api = new SlackWebApi({ token: config.botToken });
const errorOf = (error: unknown) => error instanceof SlackApiError ? { error: error.code, ...(error.needed ? { needed: error.needed } : {}) } : { error: (error as Error)?.name ?? 'Error' };

// --- --check ------------------------------------------------------------------------------------
if (flag('--check')) {
  const REQUIRED = ['app_mentions:read', 'channels:history', 'chat:write'];
  let ok = true;
  try {
    // auth.test through fetch so the granted scopes (x-oauth-scopes header) can be listed; the token is not echoed.
    const response = await fetch('https://slack.com/api/auth.test', { method: 'POST', headers: { Authorization: `Bearer ${config.botToken}` } });
    const body = await response.json() as { ok: boolean; error?: string; team_id?: string; user_id?: string; bot_id?: string };
    const scopes = (response.headers.get('x-oauth-scopes') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!body.ok) { ok = false; log('check_auth', { ok: false, error: body.error }); }
    else {
      const missing = REQUIRED.filter(s => !scopes.includes(s));
      if (missing.length) ok = false;
      log('check_auth', { ok: true, teamId: body.team_id, botUserId: body.user_id, botId: body.bot_id, scopes, missingScopes: missing,
        note: 'groups:history is needed only for a private channel' });
    }
  } catch (error) { ok = false; log('check_auth', { ok: false, ...errorOf(error) }); }
  try {
    const info = await api.conversationsInfo(config.channelId);
    if (info.isMember === false) ok = false;
    log('check_channel', { ok: info.isMember !== false, channelId: info.id, name: info.name, botIsMember: info.isMember, ...(info.isMember === false ? { fix: '/invite the app in the channel' } : {}) });
  } catch (error) { ok = false; log('check_channel', { ok: false, ...errorOf(error) }); }
  try {
    await slackCall({ token: config.botToken }, `conversations.history?${new URLSearchParams({ channel: config.channelId, limit: '1' })}`, { method: 'GET' });
    log('check_history', { ok: true });
  } catch (error) { ok = false; log('check_history', { ok: false, ...errorOf(error) }); }
  if (!config.appToken) { ok = false; log('check_socket_mode', { ok: false, error: 'SLACK_APP_TOKEN missing' }); }
  else {
    try { await openSocketModeUrl(config.appToken); log('check_socket_mode', { ok: true, note: 'apps.connections.open succeeded (connections:write); URL not used' }); }
    catch (error) { ok = false; log('check_socket_mode', { ok: false, ...errorOf(error), hint: 'Socket Mode on + app-level token with connections:write' }); }
  }
  log('check_done', { ok, notChecked: ['chat:write by posting', 'event subscriptions app_mention / message.channels (only visible when events arrive)'] });
  process.exit(ok ? 0 : 1);
}

// --- Space (own SQLite ledger, separate from the web app's) ---------------------------------------
if (!config.appToken) { log('config_missing', { missing: ['SLACK_APP_TOKEN (Socket Mode)'] }); process.exit(2); }
const dataFile = resolve(option('--data') ?? join(appRoot, 'data', 'slack-live.db'));
mkdirSync(dirname(dataFile), { recursive: true });
const store = new SqliteLedgerStore(dataFile);
const context = { projectId: 'slack-live', targetProductId: 'slack-live' };
if (!(await store.read({ projectId: context.projectId })).length) {
  const actor = { kind: 'human' as const, id: 'owner' };
  const seed: NewLedgerEvent[] = [
    { ...context, actor, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '담당자' } },
    { ...context, actor, type: 'member_joined', payload: { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent', role: '사용자 인터뷰 정리' } },
    { ...context, actor, type: 'goal_set', payload: { text: option('--goal') ?? '온보딩 개선안을 이번 주에 확정한다', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...context, actor, type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'Slack 실험용 초기 계획', approvedBy: 'owner', sourceMessageIds: [], tasks: [
      { id: 'research', title: '사용자 인터뷰 정리', assignee: 'research-agent', dependsOn: [], handoffConditions: ['인터뷰 5건 요약'] },
      { id: 'design', title: '온보딩 화면 시안', assignee: 'owner', dependsOn: ['research'], handoffConditions: [] },
    ] } },
    { ...context, actor, type: 'decision_recorded', payload: { decisionId: 'live-d1', summary: '첫 버전은 이메일 가입만 지원한다', sourceMessageIds: [], approvedBy: 'owner', changeKinds: [] } },
  ];
  await store.append(seed);
  log('space_seeded', { projectId: context.projectId, dataFile: relative(repoRoot, dataFile) });
} else log('space_loaded', { projectId: context.projectId, dataFile: relative(repoRoot, dataFile) });

// --- PM model -------------------------------------------------------------------------------------
let llm: LlmProvider;
let model = modelFor('pm');
const templateOnly: LlmProvider = { async complete() { throw new Error('template mode'); } };
if (option('--pm') === 'template') { llm = templateOnly; log('pm', { mode: 'template', reason: '--pm template' }); }
else {
  const runtime = process.env.ENSEMBLE_PM_RUNTIME?.trim() || 'api';
  if (runtime === 'api' && !process.env.ANTHROPIC_API_KEY) { llm = templateOnly; log('pm', { mode: 'template', reason: 'no ANTHROPIC_API_KEY for ENSEMBLE_PM_RUNTIME=api' }); }
  else {
    llm = pmRuntimeFromEnv().llm;
    model = modelFor('pm', runtime === 'codex' ? 'codex' : 'anthropic');
    log('pm', { mode: 'model', runtime, model });
  }
}

// --- coordinator + Socket Mode ---------------------------------------------------------------------
const binding = await slackBindingFromConfig(config, api);
log('binding', { teamId: binding.teamId, channelId: binding.channelId, botUserId: binding.botUserId, botId: binding.botId, users: Object.keys(binding.users).length,
  unmappedHumans: binding.unmappedHumans, ownerUserId: binding.ownerUserId ?? null });
const timeoutMinutes = Number(option('--response-timeout-minutes') ?? 60);
const coordinator = new SlackCoordinator({ store, llm, model, api, binding, context, responseTimeoutMs: timeoutMinutes * 60_000,
  proactive: { triggers: ['agent_blocker', 'agent_result', 'decision_followup'] },
  onProgress: entry => log(`slack.${entry.step}`, entry as unknown as Record<string, unknown>) });
const socket = new SlackSocketModeClient({
  openUrl: () => openSocketModeUrl(config.appToken!),
  onEvent: async (envelope, meta) => { await coordinator.receive(envelope, meta); },
  onLog: entry => log(`socket.${entry.step}`, entry as unknown as Record<string, unknown>),
});

let stopping = false;
const expiry = setInterval(() => { void coordinator.expireOverdue().catch(error => log('expire_failed', errorOf(error))); }, 60_000);
async function stop(reason: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(expiry);
  socket.stop();
  const status = await coordinator.status();
  const requests = [...status.requests.values()].map(r => ({ requestId: r.request.requestId, reason: r.request.reason, status: r.status, ts: r.request.source.messageTs, replyTs: r.reply?.source.messageTs }));
  log('stopped', { reason, messages: status.messages.length, requests, failures: status.failures.map(f => ({ stage: f.stage, operation: f.operation, error: f.error })) });
  store.close();
  process.exit(0);
}
process.on('SIGINT', () => { void stop('SIGINT'); });
process.on('SIGTERM', () => { void stop('SIGTERM'); });

try { await socket.start(); }
catch (error) { log('socket_start_failed', errorOf(error)); store.close(); process.exit(1); }

// Flow B: record a personal agent's blocker/result in the Space, then let the PM raise it in Slack first.
const blocker = option('--trigger-blocker'), result = option('--trigger-result');
if (blocker || result) {
  const at = new Date().toISOString();
  const event: NewLedgerEvent = blocker
    ? { ...context, actor: { kind: 'system', id: 'session-runner' }, type: 'task_blocked', at, payload: { taskId: 'research', reason: blocker } }
    : { ...context, actor: { kind: 'agent', id: 'research-agent' }, type: 'result_submitted', at, payload: { taskId: 'research', resultId: `live-result-${Date.now()}`, planVersion: project(await store.read({ projectId: context.projectId })).plan?.version ?? 1, summary: result!, artifactIds: [] } };
  const [recorded] = await store.append([event]);
  log('space_change_recorded', { type: recorded!.type, ledgerEventId: recorded!.id, taskId: 'research' });
  const outcomes = await coordinator.syncSpaceChanges();
  log('proactive_done', { outcomes });
}
const minutes = Number(option('--minutes') ?? 0);
if (minutes > 0) setTimeout(() => { void stop(`--minutes ${minutes}`); }, minutes * 60_000);
const conversation = externalConversation(await store.read({ projectId: context.projectId }));
log('ready', { waitingRequests: [...conversation.requests.values()].filter(r => r.status === 'awaiting_response').length,
  hint: 'Flow A: mention the app in a thread of the test channel. Flow B: answer in the thread the PM started. Ctrl+C prints the summary.' });
