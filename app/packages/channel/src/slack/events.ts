// Slack Events API intake: request verification, the url_verification handshake, and which events the
// PM acts on. The host must answer within three seconds, so it acknowledges here and processes later.
// Events the PM never acts on: its own messages, unmapped bots, edits/deletes/joins, other workspaces or
// channels, and root messages that do not mention it (an invitation is not permission to watch everything).
import { verifySlackSignature } from './signature.ts';

export interface SlackMessageEvent {
  type: string;
  channel: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  event_ts?: string;
  channel_type?: string;
}
export interface SlackEventCallback {
  type: 'event_callback';
  team_id: string;
  api_app_id?: string;
  event_id: string;
  event_time: number;
  event: SlackMessageEvent;
}
export interface SlackUrlVerification { type: 'url_verification'; challenge: string }

export interface SlackHttpResult {
  status: number;
  body: string;
  contentType: string;
  /** A verified event to process after acknowledging. */
  envelope?: SlackEventCallback;
  /** X-Slack-Retry-Num / X-Slack-Retry-Reason on a redelivery. */
  retryNum?: number;
  retryReason?: string;
}

interface HeaderSource { get(name: string): string | null }
const json = (status: number, value: unknown): SlackHttpResult => ({ status, body: JSON.stringify(value), contentType: 'application/json' });

/** Verifies and parses one Events API request. Never echoes secrets; a bad signature gets 401 and no detail beyond the reason code. */
export function handleSlackEventsRequest(input: { rawBody: string; headers: HeaderSource; signingSecret: string; now?: Date }): SlackHttpResult {
  const verified = verifySlackSignature({ signingSecret: input.signingSecret, timestamp: input.headers.get('x-slack-request-timestamp'),
    signature: input.headers.get('x-slack-signature'), rawBody: input.rawBody, ...(input.now ? { now: input.now } : {}) });
  if (!verified.ok) return json(401, { error: verified.reason });
  let body: unknown;
  try { body = JSON.parse(input.rawBody); } catch { return json(400, { error: 'invalid_json' }); }
  if (!body || typeof body !== 'object') return json(400, { error: 'invalid_body' });
  const envelope = body as { type?: unknown; challenge?: unknown };
  if (envelope.type === 'url_verification' && typeof envelope.challenge === 'string') return { status: 200, body: envelope.challenge, contentType: 'text/plain' };
  if (envelope.type !== 'event_callback' || !isEventCallback(body)) return json(200, { ok: true, ignored: 'unsupported_envelope' });
  const retry = input.headers.get('x-slack-retry-num');
  const retryReason = input.headers.get('x-slack-retry-reason');
  return { ...json(200, { ok: true }), envelope: body, ...(retry && /^\d+$/.test(retry) ? { retryNum: Number(retry) } : {}), ...(retryReason ? { retryReason } : {}) };
}

function isEventCallback(body: unknown): body is SlackEventCallback {
  const b = body as Partial<SlackEventCallback>;
  return typeof b.team_id === 'string' && typeof b.event_id === 'string' && !!b.event && typeof b.event.type === 'string'
    && typeof b.event.channel === 'string' && typeof b.event.ts === 'string';
}

export interface SlackRouteBinding {
  teamId: string;
  channelId: string;
  botUserId: string;
  botId?: string;
  /** Bot or user ids of personal agents mapped into the Space; other bots are ignored. */
  agentAccounts?: ReadonlySet<string>;
}
export type SlackIgnoreReason = 'unbound_team' | 'unbound_channel' | 'self' | 'unmapped_bot' | 'unsupported_subtype' | 'unsupported_type' | 'not_threaded' | 'mention_via_app_mention';
export type SlackRoute = { action: 'mention' | 'thread_message'; event: SlackMessageEvent; authorId: string } | { action: 'ignore'; reason: SlackIgnoreReason };

/** Message subtypes that are someone actually writing. Edits, deletes, joins and the like are not acted on. */
const WRITTEN_SUBTYPES = new Set([undefined, 'thread_broadcast', 'bot_message', 'file_share']);

export function routeSlackEvent(envelope: SlackEventCallback, binding: SlackRouteBinding): SlackRoute {
  const event = envelope.event;
  if (envelope.team_id !== binding.teamId) return { action: 'ignore', reason: 'unbound_team' };
  if (event.channel !== binding.channelId) return { action: 'ignore', reason: 'unbound_channel' };
  if (event.type !== 'app_mention' && event.type !== 'message') return { action: 'ignore', reason: 'unsupported_type' };
  // Own messages first: they come back as `message` events (and `bot_message`) after every post.
  if (event.user === binding.botUserId || (event.bot_id !== undefined && event.bot_id === binding.botId)) return { action: 'ignore', reason: 'self' };
  if (!WRITTEN_SUBTYPES.has(event.subtype)) return { action: 'ignore', reason: 'unsupported_subtype' };
  const authorId = event.user ?? event.bot_id;
  if (!authorId) return { action: 'ignore', reason: 'unsupported_subtype' };
  const bot = event.bot_id !== undefined || event.subtype === 'bot_message';
  if (bot && !binding.agentAccounts?.has(authorId) && !(event.bot_id && binding.agentAccounts?.has(event.bot_id))) return { action: 'ignore', reason: 'unmapped_bot' };
  if (event.type === 'app_mention') return { action: 'mention', event, authorId };
  // A mention also arrives as a `message` event; app_mention handles it once.
  if (event.text?.includes(`<@${binding.botUserId}>`)) return { action: 'ignore', reason: 'mention_via_app_mention' };
  if (!event.thread_ts || event.thread_ts === event.ts) return { action: 'ignore', reason: 'not_threaded' };
  return { action: 'thread_message', event, authorId };
}

/** Remembers recent event ids so a redelivery (X-Slack-Retry-Num) is not processed twice in one process. */
export class SlackEventDeduper {
  private readonly seen = new Map<string, true>();
  constructor(private readonly max = 2000) {}
  /** True when the id was already seen; otherwise remembers it. */
  check(eventId: string): boolean {
    if (this.seen.has(eventId)) return true;
    this.seen.set(eventId, true);
    if (this.seen.size > this.max) this.seen.delete(this.seen.keys().next().value!);
    return false;
  }
}

/** Slack ts ("1712345678.123456") to ISO-8601. */
export function slackTsToIso(ts: string): string {
  const [seconds, micros = '0'] = ts.split('.');
  return new Date(Number(seconds) * 1000 + Math.floor(Number(micros.padEnd(6, '0').slice(0, 6)) / 1000)).toISOString();
}

/** Removes the PM's own mention from a message so the question reads naturally. */
export function stripMention(text: string, botUserId: string): string {
  return text.replaceAll(`<@${botUserId}>`, '').replace(/\s+/g, ' ').trim();
}
