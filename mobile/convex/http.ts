import { httpRouter } from 'convex/server';
import { unwrapWebhook } from '@whop/sdk/helpers';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';

type WhopEvent = { type: string; data: { id: string; metadata: Record<string, unknown> | null } };

const http = httpRouter();

http.route({
  path: '/whop',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    let event: WhopEvent;
    try {
      event = unwrapWebhook<WhopEvent>(await request.text(), {
        headers: Object.fromEntries(request.headers),
        key: process.env.WHOP_WEBHOOK_SECRET,
      });
    } catch {
      return new Response('Invalid signature', { status: 401 });
    }
    const sessionId = event.data?.metadata?.sessionId;
    if (event.type === 'payment.succeeded' && typeof sessionId === 'string') {
      await ctx.runMutation(internal.billing.markPremium, { sessionId, paymentId: event.data.id });
    }
    return new Response('OK', { status: 200 });
  }),
});

export default http;
