// The three Slack Web API calls the PM Agent needs (auth.test, conversations.replies, chat.postMessage),
// behind an interface so tests use the in-memory fake. The token stays in a private field and is never
// put into an error, a log line or a ledger record; errors carry Slack's error code only.

export interface SlackThreadMessage {
  ts: string;
  threadTs?: string;
  user?: string;
  botId?: string;
  subtype?: string;
  text: string;
}

export interface SlackApi {
  authTest(): Promise<{ userId: string; botId?: string; teamId: string }>;
  /** The thread's messages, oldest first, starting with the root. At most `limit` of the latest are returned. */
  conversationsReplies(input: { channel: string; ts: string; limit?: number }): Promise<SlackThreadMessage[]>;
  postMessage(input: { channel: string; text: string; threadTs?: string }): Promise<{ channel: string; ts: string }>;
}

/** A Slack call that failed. `code` is Slack's `error` (e.g. not_in_channel, missing_scope) or a transport code. */
export class SlackApiError extends Error {
  /** For missing_scope: the scope Slack says is needed. */
  readonly needed?: string;
  constructor(readonly code: string, readonly retryable: boolean, needed?: string) {
    super(`Slack API error: ${code}${needed ? ` (needed: ${needed})` : ''}`);
    this.name = 'SlackApiError';
    if (needed) this.needed = needed;
  }
}

export function slackErrorCode(error: unknown): string {
  return error instanceof SlackApiError ? error.code : 'unexpected_error';
}

export type SlackResponse = { ok: boolean; error?: string; [key: string]: unknown };
const MAX_REPLY_PAGES = 5;

export class SlackWebApi implements SlackApi {
  readonly #token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: { token: string; fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number }) {
    if (!options.token) throw new Error('Slack bot token is required');
    this.#token = options.token;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://slack.com/api';
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async authTest() {
    const body = await this.call('auth.test', { method: 'POST' });
    return { userId: String(body.user_id), teamId: String(body.team_id), ...(typeof body.bot_id === 'string' ? { botId: body.bot_id } : {}) };
  }

  async conversationsReplies({ channel, ts, limit = 50 }: { channel: string; ts: string; limit?: number }) {
    const messages: SlackThreadMessage[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_REPLY_PAGES; page++) {
      const query = new URLSearchParams({ channel, ts, limit: String(Math.min(200, Math.max(limit, 1))) });
      if (cursor) query.set('cursor', cursor);
      const body = await this.call(`conversations.replies?${query}`, { method: 'GET' });
      for (const m of (body.messages as Record<string, unknown>[] | undefined) ?? []) {
        messages.push({ ts: String(m.ts), text: typeof m.text === 'string' ? m.text : '',
          ...(typeof m.thread_ts === 'string' ? { threadTs: m.thread_ts } : {}), ...(typeof m.user === 'string' ? { user: m.user } : {}),
          ...(typeof m.bot_id === 'string' ? { botId: m.bot_id } : {}), ...(typeof m.subtype === 'string' ? { subtype: m.subtype } : {}) });
      }
      cursor = (body.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || undefined;
      if (!body.has_more || !cursor) break;
    }
    // Keep the root for context, then the latest replies.
    const keep = Math.max(2, limit);
    return messages.length <= keep ? messages : [messages[0]!, ...messages.slice(-(keep - 1))];
  }

  /** Not part of SlackApi: used by the live runner's --check to confirm channel access. */
  async conversationsInfo(channel: string): Promise<{ id: string; name?: string; isMember?: boolean }> {
    const body = await this.call(`conversations.info?${new URLSearchParams({ channel })}`, { method: 'GET' });
    const c = body.channel as { id?: string; name?: string; is_member?: boolean } | undefined;
    return { id: String(c?.id ?? channel), ...(c?.name ? { name: c.name } : {}), ...(typeof c?.is_member === 'boolean' ? { isMember: c.is_member } : {}) };
  }

  async postMessage({ channel, text, threadTs }: { channel: string; text: string; threadTs?: string }) {
    const body = await this.call('chat.postMessage', { method: 'POST', json: { channel, text, ...(threadTs ? { thread_ts: threadTs } : {}), unfurl_links: false, unfurl_media: false } });
    return { channel: String(body.channel), ts: String(body.ts) };
  }

  private call(method: string, init: { method: 'GET' | 'POST'; json?: unknown }): Promise<SlackResponse> {
    return slackCall({ token: this.#token, fetch: this.fetchImpl, baseUrl: this.baseUrl, timeoutMs: this.timeoutMs }, method, init);
  }
}

/** One Web API call. Shared by the bot client and Socket Mode's apps.connections.open (app token). */
export async function slackCall(auth: { token: string; fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number }, method: string, init: { method: 'GET' | 'POST'; json?: unknown }): Promise<SlackResponse> {
  let response: Response;
  try {
    response = await (auth.fetch ?? fetch)(`${auth.baseUrl ?? 'https://slack.com/api'}/${method}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${auth.token}`, ...(init.json !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
      signal: AbortSignal.timeout(auth.timeoutMs ?? 10_000),
    });
  } catch (error) {
    throw new SlackApiError((error as Error)?.name === 'TimeoutError' ? 'timeout' : 'network_error', true);
  }
  if (response.status === 429) throw new SlackApiError('ratelimited', true);
  if (!response.ok) throw new SlackApiError(`http_${response.status}`, response.status >= 500);
  let body: SlackResponse;
  try { body = await response.json() as SlackResponse; } catch { throw new SlackApiError('invalid_response', true); }
  if (!body.ok) throw new SlackApiError(typeof body.error === 'string' ? body.error : 'unknown_error', false, typeof body.needed === 'string' ? body.needed : undefined);
  return body;
}

export interface SlackEnvConfig {
  botToken: string;
  /** Socket Mode app-level token (xapp-, connections:write). */
  appToken?: string;
  /** Events API over HTTP only; Socket Mode does not need it. */
  signingSecret?: string;
  /** SLACK_CHANNEL_ID, or SLACK_TEST_CHANNEL_ID as an alias. */
  channelId: string;
  /** Optional; resolved with auth.test when absent. */
  teamId?: string;
  botUserId?: string;
  /** Slack user/bot id → Space member id, from `U1=owner,B2=research-agent`. Empty means the fallback applies. */
  users: Record<string, string>;
  /** The Slack user the PM mentions for the goal's decider when SLACK_USER_MAP does not name one. */
  ownerUserId?: string;
}

/** Reads the Slack settings. Values are returned to the caller only; nothing here prints them. */
export function slackConfigFromEnv(env: Record<string, string | undefined> = process.env): { ok: true; config: SlackEnvConfig } | { ok: false; missing: string[] } {
  const value = (name: string) => env[name]?.trim() || undefined;
  const channelId = value('SLACK_CHANNEL_ID') ?? value('SLACK_TEST_CHANNEL_ID');
  const missing = [...(value('SLACK_BOT_TOKEN') ? [] : ['SLACK_BOT_TOKEN']), ...(channelId ? [] : ['SLACK_CHANNEL_ID (or SLACK_TEST_CHANNEL_ID)'])];
  if (missing.length) return { ok: false, missing };
  const users: Record<string, string> = {};
  for (const pair of (value('SLACK_USER_MAP') ?? '').split(',')) {
    const [slackId, memberId] = pair.split('=').map((part) => part.trim());
    if (slackId && memberId) users[slackId] = memberId;
  }
  const optional = { appToken: value('SLACK_APP_TOKEN'), signingSecret: value('SLACK_SIGNING_SECRET'), teamId: value('SLACK_TEAM_ID'), botUserId: value('SLACK_BOT_USER_ID'), ownerUserId: value('SLACK_OWNER_USER_ID') };
  return { ok: true, config: { botToken: value('SLACK_BOT_TOKEN')!, channelId: channelId!, users,
    ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)) } };
}
