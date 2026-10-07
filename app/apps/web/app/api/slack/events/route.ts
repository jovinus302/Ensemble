// Slack Events API endpoint (issue #79, EXPERIMENT). Verifies the v0 signature on the raw body, answers the
// url_verification challenge, and acknowledges events at once (Slack waits three seconds) while the PM
// handles them after the response. Without SLACK_* settings the endpoint reports itself unconfigured.
import { after } from 'next/server';
import { handleSlackEventsRequest, slackConfigFromEnv } from '@ensemble/orchestrator';
import { getRuntime } from '../../../../lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // The runtime loads the nearest .env first, where SLACK_* settings may live.
  const app = getRuntime();
  const env = slackConfigFromEnv();
  if (!env.ok) return Response.json({ error: 'slack_not_configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const rawBody = await request.text();
  const result = handleSlackEventsRequest({ rawBody, headers: request.headers, signingSecret: env.config.signingSecret });
  const envelope = result.envelope;
  if (envelope) {
    after(async () => {
      try {
        const outcome = await (await app.slack())?.receive(envelope, { retryNum: result.retryNum });
        // Outcomes hold ids and reason codes only.
        if (outcome) console.info('[ensemble:slack]', JSON.stringify({ eventId: envelope.event_id, retryNum: result.retryNum, outcome }));
      } catch (error) {
        // Provider errors may carry request details: log the kind only.
        console.error('[ensemble:slack] 이벤트를 처리하지 못했습니다', (error as Error)?.name ?? 'Error');
      }
    });
  }
  return new Response(result.body, { status: result.status, headers: { 'Content-Type': result.contentType, 'Cache-Control': 'no-store' } });
}
