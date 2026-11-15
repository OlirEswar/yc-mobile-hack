/**
 * What a player's plan buys and what the store sells. Free is the complete game; Patron and top-ups
 * pay for the things that cost money to serve. The strategy behind these numbers is in
 * docs/MONETIZATION.md.
 */
export type PlanId = 'free' | 'patron';

export type PlanLimits = {
  /** LLM-planned colonist decisions per simulated day, the world's `llm.budgetPerDay`. */
  thoughtsPerDay: number;
};

export const PLANS: Record<PlanId, PlanLimits> = {
  free: { thoughtsPerDay: 20 },
  patron: { thoughtsPerDay: 60 },
};

export type OfferId = 'patron_monthly' | 'patron_annual' | 'thoughts_100';

export type Offer = { title: string; priceUsd: number } & (
  | { kind: 'patron'; billingPeriodDays: number }
  /** One-time. Banked thoughts are spent only after the day's budget runs out, and never expire. */
  | { kind: 'thoughts'; thoughts: number }
);

/** Whop refuses prices under $1.00. Top-ups cost about five times more per thought than Patron. */
export const OFFERS: Record<OfferId, Offer> = {
  patron_monthly: { kind: 'patron', title: 'Patron', priceUsd: 4.99, billingPeriodDays: 30 },
  patron_annual: { kind: 'patron', title: 'Patron (annual)', priceUsd: 39.99, billingPeriodDays: 365 },
  thoughts_100: { kind: 'thoughts', title: '100 Thoughts', priceUsd: 1.99, thoughts: 100 },
};

export const OFFER_IDS = Object.keys(OFFERS) as OfferId[];
