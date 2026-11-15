import { v } from 'convex/values';
import { WhopClient, WhopEnvironment } from '@whop/sdk';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import { getSession, planOf } from './lib/auth';
import { PATRON_BILLING_PERIOD_DAYS, PATRON_PRICE_USD, PLANS, type PlanId } from '../shared/plans';

/** Reactive. This install's plan. */
export const status = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<{ plan: PlanId }> => {
    const session = await getSession(ctx, sessionToken);
    return { plan: session ? planOf(session) : 'free' };
  },
});

export const sessionIdForToken = internalQuery({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => (await getSession(ctx, sessionToken))?._id ?? null,
});

/** Creates a Whop checkout for the monthly Patron subscription, tagged with the session id, and returns its URL. */
export const createCheckout = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<{ purchaseUrl: string }> => {
    const sessionId = await ctx.runQuery(internal.billing.sessionIdForToken, { sessionToken });
    if (!sessionId) throw new Error('Unknown session');
    const apiKey = process.env.WHOP_API_KEY;
    const productId = process.env.WHOP_PATRON_PRODUCT_ID;
    if (!apiKey || !productId) throw new Error('Set WHOP_API_KEY and WHOP_PATRON_PRODUCT_ID');
    const client = new WhopClient({
      token: apiKey,
      environment: process.env.WHOP_ENVIRONMENT === 'production' ? WhopEnvironment.Production : WhopEnvironment.Sandbox,
    });
    const checkout = await client.checkoutConfigurations.create({
      variant: {
        product_id: productId,
        title: 'Patron',
        billing_type: 'renewal',
        billing_period: PATRON_BILLING_PERIOD_DAYS,
        initial_price: PATRON_PRICE_USD,
        renewal_price: PATRON_PRICE_USD,
        currency: 'usd',
      },
      metadata: { sessionId },
    });
    if (!checkout.purchase_url) throw new Error('Whop returned no purchase_url');
    return { purchaseUrl: checkout.purchase_url };
  },
});

/**
 * Called by the /whop webhook on membership.activated and membership.deactivated. Switches the
 * session's plan and applies its thought budget to the session's world. A deactivation only counts
 * for the membership that is currently active. Ignores unknown or stale session ids.
 */
export const setPatron = internalMutation({
  args: { sessionId: v.string(), membershipId: v.string(), active: v.boolean() },
  handler: async (ctx, { sessionId, membershipId, active }): Promise<boolean> => {
    const id = ctx.db.normalizeId('sessions', sessionId);
    const session = id ? await ctx.db.get(id) : null;
    if (!session) return false;
    if (!active && session.patronMembershipId !== membershipId) return false;
    await ctx.db.patch(session._id, { patronMembershipId: active ? membershipId : undefined });
    const world = await ctx.db.get(session.worldId);
    if (world && !world.deleted) {
      const budgetPerDay = PLANS[active ? 'patron' : 'free'].thoughtsPerDay;
      await ctx.db.patch(world._id, {
        llm: { ...world.llm, budgetPerDay },
        config: { ...world.config, llm: { ...world.config.llm, budgetPerDay } },
      });
    }
    return true;
  },
});
