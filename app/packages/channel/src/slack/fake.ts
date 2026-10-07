// In-memory Slack for tests: threads, posted messages, and scripted failures. It does not model Slack's
// delivery; tests send events to the coordinator themselves.
import { SlackApiError, type SlackApi, type SlackThreadMessage } from './api.ts';

export class FakeSlackApi implements SlackApi {
  readonly posts: { channel: string; text: string; threadTs?: string; ts: string }[] = [];
  readonly replyReads: { channel: string; ts: string }[] = [];
  /** Error codes the next calls fail with, consumed in order. */
  readonly fail: { replies: string[]; post: string[] } = { replies: [], post: [] };
  private readonly threads = new Map<string, SlackThreadMessage[]>();
  private clock = 1_790_000_000;

  constructor(readonly identity: { userId: string; botId: string; teamId: string }) {}

  nextTs(): string { this.clock += 1; return `${this.clock}.000100`; }

  /** Adds a message as if someone wrote it in Slack; returns it. */
  add(channel: string, message: Omit<SlackThreadMessage, 'ts'> & { ts?: string }): SlackThreadMessage {
    const full: SlackThreadMessage = { ...message, ts: message.ts ?? this.nextTs() };
    const root = full.threadTs ?? full.ts;
    const key = `${channel}:${root}`;
    this.threads.set(key, [...(this.threads.get(key) ?? []), full]);
    return full;
  }

  async authTest() { return { ...this.identity }; }

  async conversationsReplies({ channel, ts, limit = 50 }: { channel: string; ts: string; limit?: number }) {
    this.replyReads.push({ channel, ts });
    const code = this.fail.replies.shift();
    if (code) throw new SlackApiError(code, false);
    const messages = this.threads.get(`${channel}:${ts}`);
    if (!messages) throw new SlackApiError('thread_not_found', false);
    return messages.slice(-limit).map((m) => ({ ...m }));
  }

  async postMessage({ channel, text, threadTs }: { channel: string; text: string; threadTs?: string }) {
    const code = this.fail.post.shift();
    if (code) throw new SlackApiError(code, false);
    const posted = this.add(channel, { text, user: this.identity.userId, botId: this.identity.botId, ...(threadTs ? { threadTs } : {}) });
    this.posts.push({ channel, text, ts: posted.ts, ...(threadTs ? { threadTs } : {}) });
    return { channel, ts: posted.ts };
  }
}
