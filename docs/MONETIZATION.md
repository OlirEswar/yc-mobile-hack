# How Living World makes money

Three lines, in order of importance. The free game is complete on its own: everything Patron buys is
something that costs us money to serve, so the price stays honest and nobody has to pay to play.

1. **Patron subscription, $4.99 a month.** The main revenue.
2. **One-time packs.** New towns, art themes and challenge scenarios, for players who won't subscribe.
3. **Chronicle export.** A shareable illustrated history of a town. The basic version is free and
   counts as marketing, not revenue.

## 1. Patron

| Perk | Free | Patron | Why it costs money | Status |
|---|---|---|---|---|
| Thoughts per day | 20 | 60 | Each thought is one LLM call planning a colonist's next move | **Live in this branch** |
| Worlds | 1 | 3 (proposed) | Each world is a stored colony and its own tick loop | Not built: one world per session today |
| Town cap | 120 (proposed) | 160 (proposed) | More colonists means more agents to tick and more thoughts competing for the budget | Not built: `MAX_POPULATION` is a constant |
| Offline catch-up | none | up to 8 h (proposed) | The world keeps ticking, and thinking, while the app is closed | Not built: the loop stops when the heartbeat goes stale |

A "thought" is the world's `llm.budgetPerDay`: how many LLM-planned decisions the colony gets per
simulated day before colonists fall back to rule-based plans. The world never waits for a model, so a
free world is never stuck, only less surprising.

Note the reserves in `DEFAULT_LLM_CONFIG`: `focusReserve` (6) and `crisisReserve` (8) come out of the
same budget. On free that leaves 6 thoughts for ordinary planning, which is probably too few. Shrink
the reserves for free worlds or scale them with the budget when the cognition queue lands.

### How it works

- `shared/plans.ts` holds the plan table and the price. Both backend and client import it.
- `billing:createCheckout` creates a Whop checkout for a monthly renewal variant on the Patron product,
  with the session id in its metadata. Whop copies that metadata onto the membership.
- `/whop` (`convex/http.ts`) listens for `membership.activated` and `membership.deactivated`.
  `billing:setPatron` stores the membership id on the session and writes the plan's thought budget
  into the session's world. Deactivation only counts for the membership that is currently active.
- `billing:status` returns `{ plan }` reactively, so the HUD switches from "Become a Patron" to
  "Patron" as soon as the webhook lands.
- A world seeded later (when the old one was retired) gets the session's current plan budget.

### Setup

Convex environment variables:

| Name | Value |
|---|---|
| `WHOP_API_KEY` | Company API key |
| `WHOP_ENVIRONMENT` | `sandbox` or `production` |
| `WHOP_WEBHOOK_SECRET` | Secret of the webhook below |
| `WHOP_PATRON_PRODUCT_ID` | The Patron product (`prod_…`). Whop refuses renewal variants without one. |

In the Whop dashboard, point a webhook at `<convex site url>/whop` and subscribe it to
`membership.activated` and `membership.deactivated`.

### Before charging real money

- **Identity.** A plan belongs to a session, and a session belongs to a device id in local storage.
  Reinstalling or switching phones loses Patron. Players need an account (or a "restore purchase" flow
  that looks up their Whop membership by email) before launch.
- **App store rules.** Selling a subscription for in-app features through an external checkout is
  restricted on iOS and Google Play outside the regions that allow external purchase links. Check the
  current rules per store and region; native in-app purchase may be required for some markets.

## 2. One-time packs

Packs are pure content, with no ongoing cost, so a one-time price is the right shape.

| Pack | What it is in code |
|---|---|
| New town | A new colony preset in `shared/colony.ts` plus a seed in `convex/seed/` |
| Art theme | An alternative asset manifest swapped in by `src/art/` |
| Challenge scenario | A seed with fixed starting conditions and a goal, such as "survive a 30-day drought" |

To build: a `purchases` table keyed by session and pack id, one-time Whop variants
(`billing_type: 'one_time'`, the shape the earlier Colony Pass used), and `payment.succeeded` handling
in `/whop` that records the purchase. Patron does not include packs, so the two lines don't
cannibalise each other.

## 3. Chronicle export

The chronicle already stores every salient event with its cause chain (`chronicle:feed`,
`chronicle:chain`). Export turns that into an illustrated "history of my town": the big moments, who
caused what, and portraits of the colonists involved, rendered as an image or short page made for
posting.

- The basic export is free and carries the game's name and a link. It is the growth loop.
- A richer export (longer histories, generated illustrations, custom covers) can be a Patron perk
  later, since generated art has a real per-export cost.

## Order of work

1. Patron subscription with the thought budget (this branch).
2. Account or restore-purchase flow, so a subscription survives a reinstall.
3. The remaining Patron perks as their systems land: worlds, town cap, offline catch-up.
4. Free chronicle export.
5. The first pack, probably a challenge scenario, since it reuses the existing colony.
