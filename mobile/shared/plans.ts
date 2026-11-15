/**
 * What a player's plan buys. Free is the complete game; Patron pays for the things that cost money
 * to serve. The strategy behind these numbers is in docs/MONETIZATION.md.
 */
export type PlanId = 'free' | 'patron';

export const PATRON_PRICE_USD = 4.99;
export const PATRON_BILLING_PERIOD_DAYS = 30;

export type PlanLimits = {
  /** LLM-planned colonist decisions per simulated day, the world's `llm.budgetPerDay`. */
  thoughtsPerDay: number;
};

export const PLANS: Record<PlanId, PlanLimits> = {
  free: { thoughtsPerDay: 20 },
  patron: { thoughtsPerDay: 60 },
};
