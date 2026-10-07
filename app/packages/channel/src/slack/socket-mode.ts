// Slack Socket Mode transport: no public URL. apps.connections.open (app-level token, connections:write)
// returns a single-use WebSocket URL; every envelope is acknowledged with its envelope_id at once, and
// `events_api` payloads (the same event_callback the HTTP endpoint receives) go to the same handler.
// Slack sends `disconnect` before rotating a connection; any close reconnects with backoff until stop().
import { slackCall, SlackApiError } from './api.ts';
import type { SlackEventCallback } from './events.ts';

/** The part of a WebSocket the client uses; Node's global WebSocket satisfies it, tests use a fake. */
export interface SlackSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export type SocketModeLog =
  | { step: 'connecting'; attempt: number }
  | { step: 'connected' }
  | { step: 'hello'; connections?: number }
  | { step: 'disconnect'; reason: string }
  | { step: 'closed'; reconnectInMs: number | null }
  | { step: 'open_failed'; error: string; reconnectInMs: number | null }
  | { step: 'acked'; envelopeId: string; type: string }
  | { step: 'handler_failed'; envelopeId: string; error: string };

export interface SocketModeOptions {
  /** Returns a fresh wss:// URL (apps.connections.open). */
  openUrl: () => Promise<string>;
  createSocket?: (url: string) => SlackSocket;
  onEvent: (envelope: SlackEventCallback, meta: { retryNum?: number; retryReason?: string }) => unknown;
  onLog?: (entry: SocketModeLog) => void;
  /** Delay before reconnect attempt n (1-based). Default 1s, doubling, at most 30s. */
  reconnectDelayMs?: (attempt: number) => number;
}

/** apps.connections.open with the app-level token. The token never leaves this call. */
export async function openSocketModeUrl(appToken: string, options: { fetch?: typeof fetch; baseUrl?: string } = {}): Promise<string> {
  const body = await slackCall({ token: appToken, ...options }, 'apps.connections.open', { method: 'POST' });
  if (typeof body.url !== 'string') throw new SlackApiError('invalid_response', true);
  return body.url;
}

export class SlackSocketModeClient {
  private socket?: SlackSocket;
  private stopped = true;
  private failures = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: SocketModeOptions) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect(true);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000, 'stopped');
  }

  private delay(): number {
    return this.options.reconnectDelayMs?.(this.failures) ?? Math.min(30_000, 1000 * 2 ** Math.max(0, this.failures - 1));
  }

  private schedule(): number | null {
    if (this.stopped) return null;
    this.failures++;
    const wait = this.delay();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.connect(); }, wait);
    return wait;
  }

  /** `initial`: a fatal token/scope error rejects start(); later attempts log it and stop. */
  private async connect(initial = false): Promise<void> {
    if (this.stopped) return;
    this.options.onLog?.({ step: 'connecting', attempt: this.failures + 1 });
    let url: string;
    try {
      url = await this.options.openUrl();
    } catch (error) {
      const code = error instanceof SlackApiError ? error.code : 'unexpected_error';
      // A revoked or wrong app token will not fix itself.
      const fatal = ['invalid_auth', 'not_authed', 'not_allowed_token_type', 'missing_scope', 'account_inactive', 'token_revoked'].includes(code);
      this.options.onLog?.({ step: 'open_failed', error: code, reconnectInMs: fatal ? null : this.schedule() });
      if (fatal) { this.stopped = true; if (initial) throw error; }
      return;
    }
    if (this.stopped) return;
    const socket = (this.options.createSocket ?? ((u: string) => new WebSocket(u) as unknown as SlackSocket))(url);
    this.socket = socket;
    socket.addEventListener('open', () => this.options.onLog?.({ step: 'connected' }));
    socket.addEventListener('message', (event) => this.message(socket, event.data));
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return; // An old connection replaced after `disconnect`.
      this.socket = undefined;
      this.options.onLog?.({ step: 'closed', reconnectInMs: this.schedule() });
    });
    socket.addEventListener('error', () => { /* `close` follows and reconnects. */ });
  }

  private message(socket: SlackSocket, data: unknown): void {
    let frame: { type?: string; envelope_id?: string; payload?: unknown; retry_attempt?: number; retry_reason?: string; reason?: string; num_connections?: number };
    try { frame = JSON.parse(typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf8')); } catch { return; }
    if (frame.type === 'hello') {
      this.failures = 0;
      this.options.onLog?.({ step: 'hello', ...(typeof frame.num_connections === 'number' ? { connections: frame.num_connections } : {}) });
      return;
    }
    if (frame.type === 'disconnect') {
      // Slack is rotating this connection: open the next one now, then let this one go.
      this.options.onLog?.({ step: 'disconnect', reason: frame.reason ?? 'unknown' });
      if (this.socket === socket) this.socket = undefined;
      socket.close(1000, 'disconnect');
      if (frame.reason === 'link_disabled') { this.stopped = true; return; }
      void this.connect();
      return;
    }
    if (!frame.envelope_id) return;
    // Acknowledge first: Slack redelivers envelopes that are not acknowledged within a few seconds.
    socket.send(JSON.stringify({ envelope_id: frame.envelope_id }));
    this.options.onLog?.({ step: 'acked', envelopeId: frame.envelope_id, type: frame.type ?? 'unknown' });
    if (frame.type !== 'events_api') return;
    const payload = frame.payload as SlackEventCallback | undefined;
    if (!payload || payload.type !== 'event_callback' || !payload.event) return;
    const meta = { ...(typeof frame.retry_attempt === 'number' && frame.retry_attempt > 0 ? { retryNum: frame.retry_attempt } : {}), ...(frame.retry_reason ? { retryReason: frame.retry_reason } : {}) };
    void Promise.resolve().then(() => this.options.onEvent(payload, meta)).catch((error: unknown) =>
      this.options.onLog?.({ step: 'handler_failed', envelopeId: frame.envelope_id!, error: (error as Error)?.name ?? 'Error' }));
  }
}
