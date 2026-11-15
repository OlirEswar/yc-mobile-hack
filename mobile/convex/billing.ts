import { v } from 'convex/values';
import { WhopClient, WhopEnvironment } from '@whop/sdk';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import { getSession } from './lib/auth';

/** Reactive. Whether this install has bought the Colony Pass. */
export const status = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<{ premium: boolean }> => {
    const session = await getSession(ctx, sessionToken);
    return { premium: session?.premium === true };
  },
});

export const sessionIdForToken = internalQuery({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => (await getSession(ctx, sessionToken))?._id ?? null,
});

/** Creates a Whop checkout for the Colony Pass, tagged with the session id, and returns its URL. */
export const createCheckout = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<{ purchaseUrl: string }> => {
    const sessionId = await ctx.runQuery(internal.billing.sessionIdForToken, { sessionToken });
    if (!sessionId) throw new Error('Unknown session');
    const apiKey = process.env.WHOP_API_KEY;
    if (!apiKey) throw new Error('Set WHOP_API_KEY');
    const client = new WhopClient({
      token: apiKey,
      environment: process.env.WHOP_ENVIRONMENT === 'production' ? WhopEnvironment.Production : WhopEnvironment.Sandbox,
    });
    const checkout = await client.checkoutConfigurations.create({
      variant: { title: 'Colony Pass', billing_type: 'one_time', initial_price: 4.99, currency: 'usd' },
      metadata: { sessionId },
    });
    if (!checkout.purchase_url) throw new Error('Whop returned no purchase_url');
    return { purchaseUrl: checkout.purchase_url };
  },
});

/** Called by the /whop webhook on payment.succeeded. Ignores unknown or stale session ids. */
export const markPremium = internalMutation({
  args: { sessionId: v.string(), paymentId: v.string() },
  handler: async (ctx, { sessionId, paymentId }): Promise<boolean> => {
    const id = ctx.db.normalizeId('sessions', sessionId);
    const session = id ? await ctx.db.get(id) : null;
    if (!session) return false;
    await ctx.db.patch(session._id, { premium: true, premiumPaymentId: paymentId });
    return true;
  },
});
