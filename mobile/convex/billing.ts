import { v } from 'convex/values';
import { WhopClient, WhopEnvironment } from '@whop/sdk';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import { getSession, planOf } from './lib/auth';
import { OFFER_IDS, OFFERS, PLANS, type OfferId, type PlanId } from '../shared/plans';

const offerV = v.union(...OFFER_IDS.map((id) => v.literal(id)));

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

/** Creates a Whop checkout for one store offer, tagged with the session id and offer id, and returns its URL. */
export const createCheckout = action({
  args: { sessionToken: v.string(), offer: offerV },
  handler: async (ctx, { sessionToken, offer }): Promise<{ purchaseUrl: string }> => {
    const sessionId = await ctx.runQuery(internal.billing.sessionIdForToken, { sessionToken });
    if (!sessionId) throw new Error('Unknown session');
    const apiKey = process.env.WHOP_API_KEY;
    const productId = process.env.WHOP_PATRON_PRODUCT_ID;
    if (!apiKey || !productId) throw new Error('Set WHOP_API_KEY and WHOP_PATRON_PRODUCT_ID');
    const client = new WhopClient({
      token: apiKey,
      environment: process.env.WHOP_ENVIRONMENT === 'production' ? WhopEnvironment.Production : WhopEnvironment.Sandbox,
    });
    const o = OFFERS[offer];
    const checkout = await client.checkoutConfigurations.create({
      variant:
        o.kind === 'patron'
          ? {
              product_id: productId,
              title: o.title,
              billing_type: 'renewal',
              billing_period: o.billingPeriodDays,
              initial_price: o.priceUsd,
              renewal_price: o.priceUsd,
              currency: 'usd',
            }
          : { title: o.title, billing_type: 'one_time', initial_price: o.priceUsd, currency: 'usd' },
      metadata: { sessionId, offer },
    });
    if (!checkout.purchase_url) throw new Error('Whop returned no purchase_url');
    return { purchaseUrl: checkout.purchase_url };
  },
});

/**
 * Called by the /whop webhook on membership.activated and membership.deactivated. Switches the
 * session's plan and applies its thought budget to the session's world. A deactivation only counts
 * for the membership that is currently active, so switching monthly to annual is safe in either
 * event order. Ignores unknown or stale session ids.
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

/**
 * Called by the /whop webhook on payment.succeeded for a thought top-up. Banks the thoughts on the
 * session's world once per payment, so webhook retries never credit twice.
 */
export const creditTopUp = internalMutation({
  args: { sessionId: v.string(), paymentId: v.string(), offer: offerV },
  handler: async (ctx, { sessionId, paymentId, offer }): Promise<boolean> => {
    const o = OFFERS[offer as OfferId];
    if (o.kind !== 'thoughts') return false;
    const id = ctx.db.normalizeId('sessions', sessionId);
    const session = id ? await ctx.db.get(id) : null;
    if (!session) return false;
    const seen = await ctx.db
      .query('purchases')
      .withIndex('by_payment', (q) => q.eq('paymentId', paymentId))
      .first();
    if (seen) return false;
    await ctx.db.insert('purchases', { sessionId: session._id, paymentId, offer, createdAt: Date.now() });
    const world = await ctx.db.get(session.worldId);
    if (world && !world.deleted) {
      await ctx.db.patch(world._id, { llm: { ...world.llm, bonusThoughts: (world.llm.bonusThoughts ?? 0) + o.thoughts } });
    }
    return true;
  },
});
