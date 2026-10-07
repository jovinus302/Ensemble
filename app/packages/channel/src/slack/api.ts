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
  constructor(readonly code: string, readonly retryable: boolean) {
    super(`Slack API error: ${code}`);
    this.name = 'SlackApiError';
  }
}

export function slackErrorCode(error: unknown): string {
  return error instanceof SlackApiError ? error.code : 'unexpected_error';
}

type SlackResponse = { ok: boolean; error?: string; [key: string]: unknown };
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

  async postMessage({ channel, text, threadTs }: { channel: string; text: string; threadTs?: string }) {
    const body = await this.call('chat.postMessage', { method: 'POST', json: { channel, text, ...(threadTs ? { thread_ts: threadTs } : {}), unfurl_links: false, unfurl_media: false } });
    return { channel: String(body.channel), ts: String(body.ts) };
  }

  private async call(method: string, init: { method: 'GET' | 'POST'; json?: unknown }): Promise<SlackResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${method}`, {
        method: init.method,
        headers: { Authorization: `Bearer ${this.#token}`, ...(init.json !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
        ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new SlackApiError((error as Error)?.name === 'TimeoutError' ? 'timeout' : 'network_error', true);
    }
    if (response.status === 429) throw new SlackApiError('ratelimited', true);
    if (!response.ok) throw new SlackApiError(`http_${response.status}`, response.status >= 500);
    let body: SlackResponse;
    try { body = await response.json() as SlackResponse; } catch { throw new SlackApiError('invalid_response', true); }
    if (!body.ok) throw new SlackApiError(typeof body.error === 'string' ? body.error : 'unknown_error', false);
    return body;
  }
}

export interface SlackEnvConfig {
  botToken: string;
  signingSecret: string;
  teamId: string;
  channelId: string;
  /** Optional; when absent the host asks auth.test. */
  botUserId?: string;
  /** Slack user/bot id → Space member id, from `U1=owner,B2=research-agent`. */
  users: Record<string, string>;
}

/** Reads the Slack settings. Values are returned to the caller only; nothing here prints them. */
export function slackConfigFromEnv(env: Record<string, string | undefined> = process.env): { ok: true; config: SlackEnvConfig } | { ok: false; missing: string[] } {
  const value = (name: string) => env[name]?.trim() || undefined;
  const required = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_TEAM_ID', 'SLACK_CHANNEL_ID'] as const;
  const missing = required.filter((name) => !value(name));
  if (missing.length) return { ok: false, missing };
  const users: Record<string, string> = {};
  for (const pair of (value('SLACK_USER_MAP') ?? '').split(',')) {
    const [slackId, memberId] = pair.split('=').map((part) => part.trim());
    if (slackId && memberId) users[slackId] = memberId;
  }
  const botUserId = value('SLACK_BOT_USER_ID');
  return { ok: true, config: { botToken: value('SLACK_BOT_TOKEN')!, signingSecret: value('SLACK_SIGNING_SECRET')!, teamId: value('SLACK_TEAM_ID')!, channelId: value('SLACK_CHANNEL_ID')!, ...(botUserId ? { botUserId } : {}), users } };
}
