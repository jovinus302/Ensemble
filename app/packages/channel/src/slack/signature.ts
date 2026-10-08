// Slack request signing (v0): HMAC-SHA256 of `v0:<timestamp>:<raw body>` with the app's signing secret,
// compared in constant time. Requests older or newer than five minutes are refused to stop replays.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SLACK_SIGNATURE_WINDOW_SECONDS = 5 * 60;

export type SlackSignatureResult = { ok: true } | { ok: false; reason: 'missing_headers' | 'stale_timestamp' | 'bad_signature' };

export function slackSignature(signingSecret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
}

export function verifySlackSignature(input: { signingSecret: string; timestamp: string | null; signature: string | null; rawBody: string; now?: Date }): SlackSignatureResult {
  const { signingSecret, timestamp, signature, rawBody } = input;
  if (!signingSecret || !timestamp || !signature) return { ok: false, reason: 'missing_headers' };
  if (!/^\d+$/.test(timestamp)) return { ok: false, reason: 'stale_timestamp' };
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > SLACK_SIGNATURE_WINDOW_SECONDS) return { ok: false, reason: 'stale_timestamp' };
  const expected = Buffer.from(slackSignature(signingSecret, timestamp, rawBody));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}
