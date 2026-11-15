/**
 * The rule-based planner. When an agent has nothing queued it scores every option open to them,
 * from their needs, their personal schedule, their goals (seeded, LLM-made or whispered), their
 * beliefs about others, their traits and values, their faction and the state of the colony, then
 * commits the best one with setPlan as a short plan with a specific intent and step labels.
 * It never waits for the LLM; when a decision is worth more thought it also asks for cognition.
 */
import { BASE_PRICES, BONUS_AT, CUT_AT, RESERVE_FLOOR } from '../lib/constants';
import { clamp, rand, round2 } from '../lib/rng';
import type { CognitionRequest } from './core';
import {
  droughtSeverity,
  firstName,
  isLocation,
  locName,
  personalTick,
  reserveDays,
  reserveRatio,
  scarcityCause,
  shelterFrom,
  stock,
  stormAt,
} from './conditions';
import {
  adjustRelationship,
  emitEvent,
  encodeStep,
  enqueueCognition,
  learnBelief,
  loadAgent,
  loadFactions,
  loadHousehold,
  loadMind,
  setPlan,
  touch,
  touchMind,
} from './core';
import type { AgentDoc, BeliefDoc, EventId, FactionDoc, HouseholdDoc, MindDoc, RelationshipDoc, StepType, Tx } from './core';
import { simState } from './state';
import { ACCUSABLE, ACCUSE_KINDS, beliefsOf, effectiveConfidence, getBelief, markActed } from './social';
import { workLabel } from './text';

type Goal = MindDoc['goals'][number];

/** Everything the planner looks at, read once per decision. */
type Ctx = {
  tx: Tx;
  a: AgentDoc;
  mind: MindDoc;
  p: number;
  day: number;
  beliefs: BeliefDoc[];
  ties: RelationshipDoc[];
  household: HouseholdDoc | null;
  factions: FactionDoc[];
  drought: number;
  /** In the personal work shift. */
  shift: boolean;
  /** Awake and off shift. */
  free: boolean;
};

type Choice = {
  score: number;
  /** routine plans need no "why" panel entry; the rest set a trigger. */
  routine: boolean;
  intent: string;
  steps: string[];
  labels: string[];
  trigger?: string;
  goalId?: string;
  causeEventId?: EventId;
  /** Asks the LLM to think again about this decision. */
  llm?: CognitionRequest;
};

/** Builds a step list while tracking where the agent will be. */
class Plan {
  steps: string[] = [];
  labels: string[] = [];
  constructor(public loc: string) {}
  go(to: string, label?: string): this {
    if (to !== this.loc) {
      this.steps.push(encodeStep('go', to));
      this.labels.push(label ?? 'Walk to ' + locName(to));
      this.loc = to;
    }
    return this;
  }
  add(type: StepType, args: (string | number)[], label: string): this {
    this.steps.push(encodeStep(type, ...args));
    this.labels.push(label);
    return this;
  }
}

/** Standing at which someone who wants a council seat asks for one. */
const SEAT_STANDING = 9;
const SHIFT_START = 12;
const LUNCH = [36, 42];
const SHIFT_END = 66;
const BEDTIME = 96;

export async function planFor(tx: Tx, a: AgentDoc): Promise<void> {
  const mind = await loadMind(tx, a);
  if (!mind) {
    await setPlan(tx, a, { intent: 'Taking a moment', source: 'routine', steps: [encodeStep('rest', 3)], labels: ['Resting'] });
    return;
  }
  const p = personalTick(a, tx.tick);
  const lunch = p >= LUNCH[0] && p < LUNCH[1];
  const shift = p >= SHIFT_START && p < SHIFT_END && !lunch;
  const ties = await tx.ctx.db
    .query('relationships')
    .withIndex('by_from_strength', (q) => q.eq('fromAgentId', a._id))
    .order('desc')
    .take(16);
  const c: Ctx = {
    tx,
    a,
    mind,
    p,
    day: Math.floor(tx.tick / 144),
    beliefs: (await beliefsOf(tx, a._id)).map((b) => ({ ...b, confidence: effectiveConfidence(b, tx.tick) })),
    ties,
    household: await loadHousehold(tx, a.householdId),
    factions: await loadFactions(tx),
    drought: droughtSeverity(tx.world),
    shift,
    free: p < BEDTIME && !shift,
  };

  const choices: (Choice | null)[] = [shelter(c), sleep(c), await work(c), leisure(c), await politics(c)];
  for (const res of ['water', 'food'] as const) choices.push(await supply(c, res));
  for (const g of mind.goals) if (g.status === 'active') choices.push(await goalChoice(c, g));
  choices.push(...(await beliefChoices(c)));
  choices.push(await duty(c));
  choices.push(await mischief(c));
  choices.push({ score: 0.05, routine: true, intent: 'Taking a breather', steps: [encodeStep('rest', 3)], labels: ['Taking a breather at ' + locName(a.locationId)] });

  let best: Choice | null = null;
  let bestScore = -Infinity;
  choices.forEach((choice, i) => {
    if (!choice || choice.steps.length === 0) return;
    const score = choice.score + rand(tx.world.seed, tx.tick, a.seq, 'choice' + i) * 0.1;
    if (score > bestScore) {
      best = choice;
      bestScore = score;
    }
  });
  const chosen = best as unknown as Choice;
  await setPlan(tx, a, {
    intent: chosen.intent,
    source: chosen.routine ? 'routine' : 'local_planner',
    steps: chosen.steps,
    labels: chosen.labels,
    goalId: chosen.goalId,
    causeEventId: chosen.causeEventId,
    trigger: chosen.routine ? undefined : chosen.trigger ?? chosen.intent,
  });
  touchMind(tx, mind);
  if (chosen.llm) await enqueueCognition(tx, a, chosen.llm);
  if (tx.world.focusAgentId === a._id && (!chosen.routine || p < 6)) {
    await enqueueCognition(tx, a, {
      kind: 'plan',
      trigger: p < 6 ? 'followed by the player: starting a new day' : 'followed by the player: ' + chosen.intent,
      priority: 0.9,
      lane: 'focus',
    });
  }
}

// ---------- body and schedule ----------

function shelter(c: Ctx): Choice | null {
  if (stormAt(c.tx.world, c.a.locationId) <= 0) return null;
  const to = shelterFrom(c.a.locationId);
  return {
    score: 5,
    routine: false,
    intent: 'Getting out of the storm at ' + locName(c.a.locationId) + ' before it kills me',
    steps: [encodeStep('flee', to), encodeStep('rest', 3)],
    labels: ['Running for cover at ' + locName(to), 'Catching breath at ' + locName(to)],
    trigger: 'caught outside in the storm',
    causeEventId: c.tx.world.causes.storm,
  };
}

function sleep(c: Ctx): Choice | null {
  const { a, p } = c;
  const night = p >= BEDTIME;
  if (!night && a.needs.fatigue < 85) return null;
  const ticks = night ? Math.min(144 - p, 54) : 12;
  const plan = new Plan(a.locationId).go(a.homeLocationId, 'Heading home to ' + locName(a.homeLocationId)).add('sleep', [ticks], night ? 'Sleeping at home' : 'Napping at home');
  return {
    score: night ? 0.95 : 0.6 + (a.needs.fatigue - 85) / 30,
    routine: night,
    intent: night ? 'Heading home to sleep' : 'Too exhausted to keep going; going home for a nap',
    trigger: night ? undefined : 'exhausted',
    ...plan,
  };
}

async function work(c: Ctx): Promise<Choice | null> {
  const { a, p, tx } = c;
  if (!c.shift || !a.workLocationId) return null;
  const end = p < LUNCH[0] ? LUNCH[0] : SHIFT_END;
  const ticks = clamp(end - p, 1, 18);
  if (stormAt(tx.world, a.workLocationId) > 0) {
    const safe = shelterFrom(a.workLocationId);
    return {
      score: 0.6,
      routine: false,
      intent: 'Waiting out the storm instead of working at ' + locName(a.workLocationId),
      ...new Plan(a.locationId).go(safe).add('rest', [Math.min(ticks, 6)], 'Sheltering at ' + locName(safe) + ' until the storm passes'),
      trigger: 'storm over ' + locName(a.workLocationId),
      causeEventId: tx.world.causes.storm,
    };
  }
  const resident = a.occupation === 'resident';
  return {
    score: (resident ? 0.42 : 0.62) + 0.1 * c.mind.values.wealth + (a.role ? 0.05 : 0),
    routine: true,
    intent: workLabel(a) + (p < LUNCH[0] ? ' until lunch' : ' until the shift ends'),
    ...new Plan(a.locationId).go(a.workLocationId, 'Walking to work at ' + locName(a.workLocationId)).add('work', [ticks], workLabel(a)),
  };
}

function leisure(c: Ctx): Choice | null {
  const { a, p, tx } = c;
  if (!c.free) return null;
  const social = a.needs.social;
  const r = rand(tx.world.seed, tx.tick, a.seq, 'venue');
  const shopper = a.inv.credits > 40 && r < 0.12 + c.mind.values.wealth * 0.1;
  const venue = shopper ? 'market' : a.traits.sociability > 0.45 || social > 70 ? (r < 0.65 ? 'canteen' : 'plaza') : a.homeLocationId;
  const hot = a.topics.find((k) => {
    const b = c.beliefs.find((x) => x.key === k);
    return b && b.confidence >= 0.4 && (ACCUSABLE.has(b.kind) || b.kind === 'scarcity' || b.kind === 'hero' || b.kind === 'custom');
  });
  const gossip = hot && rand(tx.world.seed, tx.tick, a.seq, 'gossip') < 0.3 + a.traits.sociability * 0.6;
  const plan = new Plan(a.locationId).go(venue, venue === a.homeLocationId ? 'Going home to unwind' : 'Heading to ' + locName(venue) + ' for some company');
  if (shopper) plan.add('buy', [r < 0.08 ? 'water' : 'food', 1], 'Browsing the stalls on the concourse');
  plan.add('talk', gossip ? ['any', hot!] : ['any'], gossip ? 'Sharing the latest talk at ' + locName(venue) : 'Chatting at ' + locName(venue));
  plan.add('rest', [6], 'Lingering at ' + locName(venue));
  if (a.traits.sociability > 0.75) plan.add('talk', ['any'], 'Catching up with someone else at ' + locName(venue));
  return {
    score: 0.32 + social / 160 + a.traits.sociability * 0.18 - (p < SHIFT_START ? 0.1 : 0),
    routine: !gossip,
    intent: gossip ? 'Off to ' + locName(venue) + ' to talk about what everyone is saying' : venue === a.homeLocationId ? 'Unwinding at home' : 'Spending free time at ' + locName(venue),
    ...plan,
  };
}

// ---------- needs: water and food ----------

function mealtime(p: number): boolean {
  return p < 8 || (p >= LUNCH[0] && p < LUNCH[1]) || (p >= SHIFT_END && p < SHIFT_END + 18);
}

/** How the agent gets the food or water they need, cheapest honest way first. */
async function supply(c: Ctx, res: 'food' | 'water'): Promise<Choice | null> {
  const { a, tx, household, p } = c;
  const need = res === 'water' ? a.needs.thirst : a.needs.hunger;
  const urgency = need < 50 ? 0 : (need - 50) / 40;
  const meal = mealtime(p) && need > 30 && c.free ? 0.55 : 0;
  const score = Math.max(urgency * 1.1, meal);
  if (score <= 0) return null;
  const verb = res === 'food' ? 'eat' : 'drink';
  const consume = res === 'food' ? 'Eating' : 'Drinking';
  const plan = new Plan(a.locationId);
  const base = { score, routine: urgency < 0.5, causeEventId: undefined as EventId | undefined };
  if (a.inv[res] >= 1) return { ...base, intent: res === 'food' ? 'Eating from my own supplies' : 'Having a drink from my flask', ...plan.add(verb, [], consume + ' from own supplies') };

  const fee = Math.max(1, Math.round(tx.world.prices[res] * 0.5));
  const canteen = stock(tx.world, 'canteen', res) >= 1 && a.inv.credits >= fee;
  const sociable = canteen && meal > 0 && p >= LUNCH[0] && a.traits.sociability > 0.5 && a.inv.credits > 15;
  if (household && household.pantry[res] >= 1 && !sociable) {
    return { ...base, intent: 'Heading home to ' + verb + ' from the household pantry', ...plan.go(a.homeLocationId, 'Going home').add(verb, [], consume + ' at home') };
  }
  const rationOpen = household && household.rationDay <= c.day && stock(tx.world, 'depot', res) >= 1;
  if (rationOpen) {
    plan.go('depot', 'Walking to the Supply Depot').add('ration', [], 'Collecting the household ration').go(a.homeLocationId, 'Carrying the ration home').add(verb, [], consume + ' at home');
    return { ...base, intent: "Collecting today's household ration at the Supply Depot", ...plan };
  }
  if (canteen) {
    return { ...base, intent: res === 'food' ? 'Going to the Airlock Canteen for a meal' : 'Going to the Airlock Canteen for a drink', ...plan.go('canteen').add(verb, [], consume + ' at the canteen') };
  }
  const price = tx.world.prices[res];
  const scared = (await getBelief(tx, a._id, 'scarcity:water')) !== null || c.drought > 0;
  const qty = scared ? 3 + Math.round(a.traits.caution * 3) : 2;
  const marketHas = stock(tx.world, 'depot', res) > RESERVE_FLOOR[res] || price > BASE_PRICES[res];
  if (marketHas && a.inv.credits >= Math.ceil(price * 1.3)) {
    const high = price >= BASE_PRICES[res] * 1.6;
    const intent = 'Walking to the Exchange to buy ' + res + (high ? ' even at ' + Math.round(price * 10) / 10 + ' credits' : '') + (scared ? ' before prices rise again' : '');
    plan.go('market', 'Walking to the Exchange Concourse').add('buy', [res, qty], 'Buying ' + qty + ' ' + res).add(verb, [], consume + ' at the Exchange');
    return { ...base, routine: !high && !scared, intent, ...plan, trigger: high ? res + ' costs ' + Math.round(price * 10) / 10 + ' credits' : undefined, causeEventId: high ? scarcityCause(tx.world, res) : undefined };
  }
  if (urgency < 0.35) return null;

  const friend = c.ties.find((t) => t.toAlive && t.affinity >= 0.35 && t.kind !== 'rival' && !household?.memberIds.includes(t.toAgentId));
  const friendDoc = friend ? await loadAgent(tx, friend.toAgentId) : null;
  const theft = await theftChoice(c, res, need);
  if (theft) return theft;
  if (friendDoc && friendDoc.alive && friendDoc.activity !== 'sleeping' && isLocation(friendDoc.locationId) && stormAt(tx.world, friendDoc.locationId) === 0) {
    plan.go(friendDoc.locationId, 'Looking for ' + friendDoc.name).add('talk', [friendDoc._id, 'ask:' + res], 'Asking ' + friendDoc.name + ' for ' + res);
    return {
      ...base,
      routine: false,
      intent: 'Going to ask ' + friendDoc.name + ' for ' + res + '. There is none left at home and no credits to buy it',
      ...plan,
      trigger: (res === 'water' ? 'thirsty' : 'hungry') + ' with an empty pantry and ' + Math.floor(a.inv.credits) + ' credits',
      causeEventId: scarcityCause(tx.world, res),
    };
  }
  return null;
}

/**
 * Whether a desperate (or simply unscrupulous) person steals. Empathy and caution hold people
 * back; hunger, ambition and dependants at home push them over.
 */
async function theftChoice(c: Ctx, res: 'food' | 'water', need: number): Promise<Choice | null> {
  const { a, tx, mind } = c;
  if (a.occupation === 'security' || a.occupation === 'quartermaster') return null;
  const t = a.traits;
  const dependants = c.household ? c.household.memberIds.length - 1 : 0;
  const willing =
    ((need - 68) / 30) * (1.15 - t.empathy * 0.7) * (1.15 - t.caution * 0.6) + t.ambition * 0.1 + (dependants > 0 ? mind.values.family * 0.15 : 0) - mind.values.harmony * 0.15;
  if (rand(tx.world.seed, tx.tick, a.seq, 'steal') >= willing) return null;
  const plan = new Plan(a.locationId);
  const night = c.p >= SHIFT_END + 12;
  let intent: string;
  if (stock(tx.world, 'depot', res) >= 3) {
    plan.go('depot', 'Slipping over to the Supply Depot').add('steal', ['depot', res, 2 + Math.round(t.ambition * 2)], 'Taking ' + res + ' while nobody watches');
    intent = 'Slipping into the Supply Depot to take ' + res + ' nobody will miss';
  } else {
    const mark = c.ties.filter((r) => r.toAlive && r.kind !== 'family' && r.kind !== 'friend').sort((x, y) => x.affinity - y.affinity)[0];
    const victim = mark ? await loadAgent(tx, mark.toAgentId) : null;
    if (!victim?.householdId || victim.householdId === a.householdId) return null;
    plan.go(victim.homeLocationId, 'Heading to ' + locName(victim.homeLocationId)).add('steal', ['pantry:' + victim.householdId, res, 2], 'Raiding the pantry of ' + victim.name + "'s household");
    intent = 'Raiding the pantry of ' + victim.name + "'s household while they are out";
  }
  const why = (res === 'water' ? 'desperately thirsty' : 'starving') + (night ? ' in the middle of the night' : '') + ' with nothing left at home';
  return {
    score: 0.6 + need / 200,
    routine: false,
    intent,
    ...plan,
    trigger: why,
    causeEventId: scarcityCause(tx.world, res),
    llm: { kind: 'plan', trigger: why, priority: 0.75, lane: 'crisis' },
  };
}

/**
 * Petty crime with no need behind it: now and then, someone with little empathy and a taste for
 * more helps themselves to the depot or a disliked neighbour's pantry after dark.
 */
async function mischief(c: Ctx): Promise<Choice | null> {
  const { a, tx, mind } = c;
  const t = a.traits;
  if (!c.free || c.p < SHIFT_END + 6 || t.empathy > 0.4 || (t.ambition < 0.55 && mind.values.wealth < 0.6) || a.occupation === 'security' || a.occupation === 'quartermaster') return null;
  if (rand(tx.world.seed, tx.tick, a.seq, 'mischief') > 0.02 + (1 - t.caution) * 0.03) return null;
  const res = rand(tx.world.seed, tx.tick, a.seq, 'loot') < 0.5 ? 'water' : 'food';
  const grudge = c.ties.filter((r) => r.toAlive && r.affinity < -0.2).sort((x, y) => x.affinity - y.affinity)[0];
  const victim = grudge ? await loadAgent(tx, grudge.toAgentId) : null;
  const plan = new Plan(a.locationId);
  let intent: string;
  if (victim?.householdId && victim.householdId !== a.householdId && victim.locationId !== victim.homeLocationId) {
    plan.go(victim.homeLocationId, 'Strolling over to ' + locName(victim.homeLocationId)).add('steal', ['pantry:' + victim.householdId, res, 2], 'Lifting ' + res + ' from ' + firstName(victim.name) + "'s pantry");
    intent = 'Getting back at ' + victim.name + ' by lifting a little from their pantry while they are out';
  } else {
    plan.go('depot', 'Wandering over to the Supply Depot').add('steal', ['depot', res, 2], 'Pocketing ' + res + ' from the depot shelves');
    intent = 'Pocketing a little extra from the depot shelves; nobody counts that closely';
  }
  return { score: 0.75, routine: false, intent, ...plan, trigger: victim ? 'a grudge against ' + victim.name : 'saw a chance to take more than a fair share' };
}

// ---------- goals ----------

async function goalChoice(c: Ctx, g: Goal): Promise<Choice | null> {
  const status = await goalStatus(c, g);
  if (status !== 'active') {
    g.status = status;
    if (status === 'satisfied' && g.kind !== 'survive') {
      await emitEvent(c.tx, {
        category: 'social',
        eventType: 'goal_reached',
        actorId: c.a._id,
        participantIds: g.targetAgentId ? [g.targetAgentId] : [],
        summary: c.a.name + ' achieved what they set out to do: ' + g.description.charAt(0).toLowerCase() + g.description.slice(1) + '.',
        salience: g.source === 'divine' ? 0.6 : 0.4,
        causationEventId: g.originEventId,
      });
    }
    return null;
  }
  const weight = g.priority * (c.free ? 0.85 : 0.3) + (g.source === 'divine' ? 0.35 : 0);
  const choice = await goalAction(c, g, weight);
  if (!choice) return null;
  choice.goalId = g.id;
  choice.causeEventId ??= g.originEventId;
  if (g.source === 'divine' && g.createdAtTick >= c.tx.tick - 12) {
    choice.llm = { kind: 'plan', trigger: 'a new conviction: ' + g.description, priority: 0.85, lane: 'crisis', eventId: g.originEventId };
  }
  return choice;
}

async function goalStatus(c: Ctx, g: Goal): Promise<string> {
  const { a, tx } = c;
  if (g.expiresAtTick !== undefined && tx.tick >= g.expiresAtTick) return 'abandoned';
  const target = g.targetAgentId ? await loadAgent(tx, g.targetAgentId) : null;
  if (g.targetAgentId && target && !target.alive && g.kind !== 'investigate') return 'abandoned';
  const q = g.targetQuantity ?? 0;
  switch (g.predicate) {
    case 'credits_at_least':
      return a.inv.credits >= q ? 'satisfied' : 'active';
    case 'affinity_at_least': {
      const r = c.ties.find((t) => t.toAgentId === g.targetAgentId);
      return r && r.affinity >= q ? 'satisfied' : 'active';
    }
    case 'standing_at_least':
      return a.standing >= q ? 'satisfied' : 'active';
    case 'on_council':
      return a.occupation === 'councilor' ? 'satisfied' : 'active';
    case 'member_of_faction':
      return a.factionId === g.targetFaction ? 'satisfied' : 'active';
    case 'occupation_is':
      return a.occupation === g.targetOccupation ? 'satisfied' : 'active';
    case 'belief_resolved': {
      if (!g.targetAgentId) return 'active';
      const settled = c.beliefs.some((b) => b.subjectAgentId === g.targetAgentId && ((b.kind === 'innocent' && b.confidence > 0.6) || (b.sourceType === 'observed' && ACCUSABLE.has(b.kind) && b.confidence > 0.85)));
      return settled ? 'satisfied' : 'active';
    }
    default:
      return 'active';
  }
}

async function goalAction(c: Ctx, g: Goal, weight: number): Promise<Choice | null> {
  const drive = g.drive ?? '';
  const p = g.predicate;
  if (drive === 'befriend' || p === 'affinity_at_least' || g.kind === 'improve_relationship') return befriend(c, g, weight);
  if (drive === 'undercut') return undercut(c, g, weight);
  if (drive === 'get_rich' || p === 'credits_at_least' || g.kind === 'earn_wealth') return getRich(c, g, weight);
  if (drive === 'seek_power' || ['standing_at_least', 'on_council', 'is_chair', 'rations_full_and_leader'].includes(p) || g.kind === 'gain_influence') return seekPower(c, g, weight);
  if (drive === 'guard_reserve' || p === 'reserve_healthy') return guardReserve(c, weight);
  if (drive === 'repair' || p === 'no_damage') return repairs(c, weight + 0.15);
  if (drive === 'suspect_hoarding' || drive === 'hoarding' || p === 'belief_resolved' || g.kind === 'investigate') return investigateGoal(c, g, weight);
  if (drive === 'distrust' || g.kind === 'avoid_person') return distrust(c, g, weight);
  if (drive === 'share') return share(c, weight);
  if (p === 'target_safe' || g.kind === 'protect_person') return protect(c, g, weight);
  if (p === 'member_of_faction' || g.kind === 'join_faction') return joinFaction(c, g, weight);
  if (p === 'occupation_is' || g.kind === 'change_job') return changeJob(c, g, weight);
  if (p === 'medbay_medicine_at_least' && c.free && c.a.workLocationId === 'medbay' && c.a.needs.fatigue < 55) {
    return {
      score: weight * 0.6,
      routine: false,
      intent: 'Working late at the Med Bay to build up the medicine stock before the next storm',
      ...new Plan(c.a.locationId).go('medbay').add('work', [12], 'Preparing medicine at the Med Bay'),
    };
  }
  return null;
}

/** Where to find someone right now, if they can be reached and talked to. */
async function findable(c: Ctx, id: string | undefined): Promise<AgentDoc | null> {
  if (!id) return null;
  const b = await loadAgent(c.tx, id as AgentDoc['_id']);
  if (!b || !b.alive || b.activity === 'sleeping' || stormAt(c.tx.world, b.locationId) > 0) return null;
  return b;
}

async function befriend(c: Ctx, g: Goal, weight: number): Promise<Choice | null> {
  if (!c.free) return null;
  const b = await findable(c, g.targetAgentId);
  if (!b) return null;
  const plan = new Plan(c.a.locationId).go(b.locationId, 'Looking for ' + b.name + ' at ' + locName(b.locationId)).add('talk', [b._id], 'Talking with ' + b.name);
  const gift = c.a.inv.food >= 3 && c.a.traits.empathy > 0.5;
  if (gift) plan.add('give', [b._id, 'food', 1], 'Sharing some food with ' + b.name);
  const rival = c.ties.find((t) => t.toAgentId === b._id)?.kind === 'rival';
  return {
    score: weight * 0.75 + 0.05,
    routine: false,
    intent: rival ? 'Trying to make peace with ' + b.name + ' at ' + locName(b.locationId) : 'Looking for ' + b.name + ' at ' + locName(b.locationId) + ' because I want us to be closer',
    ...plan,
    trigger: g.description,
  };
}

async function getRich(c: Ctx, g: Goal, weight: number): Promise<Choice | null> {
  const { a, tx } = c;
  if (!c.free || a.needs.fatigue > 60) return null;
  const water = tx.world.prices.water;
  const scarce = c.drought > 0 || c.beliefs.some((b) => b.key === 'scarcity:water' && b.confidence > 0.5);
  if (a.occupation === 'trader') {
    const smear = await smearRival(c, weight);
    if (smear) return smear;
    return { score: weight * 0.7, routine: false, intent: 'Staying late at the stall to catch the evening trade. ' + g.description, ...new Plan(a.locationId).go('market').add('work', [12], 'Working the evening trade on the concourse'), trigger: g.description };
  }
  if (a.inv.water >= 6 && water >= BASE_PRICES.water * 1.8) {
    const n = Math.floor(a.inv.water - 2);
    return {
      score: weight * 0.9 + 0.1,
      routine: false,
      intent: 'Selling my spare water at the Exchange while it fetches ' + Math.round(water * 10) / 10 + ' credits',
      ...new Plan(a.locationId).go('market').add('sell', ['water', n], 'Selling ' + n + ' water'),
      trigger: 'water price is ' + Math.round(water * 10) / 10,
      causeEventId: scarcityCause(tx.world, 'water'),
    };
  }
  if (scarce && a.inv.credits >= water * 5 && a.traits.empathy < 0.5 && a.inv.water < 8 && water < BASE_PRICES.water * 1.8) {
    return {
      score: weight * 0.85,
      routine: false,
      intent: 'Buying up water at the Exchange now, to resell when the price climbs',
      ...new Plan(a.locationId).go('market').add('buy', ['water', 5], 'Buying 5 water to hold'),
      trigger: 'expects water to run short',
      causeEventId: scarcityCause(tx.world, 'water'),
    };
  }
  if (!a.workLocationId || stormAt(tx.world, a.workLocationId) > 0) return null;
  return {
    score: weight * 0.55,
    routine: false,
    intent: 'Working a double shift to ' + g.description.charAt(0).toLowerCase() + g.description.slice(1),
    ...new Plan(a.locationId).go(a.workLocationId).add('work', [12], workLabel(a) + ' (overtime)'),
  };
}

/** An unscrupulous trader losing customers to a cheaper rival starts a whisper about them. */
async function smearRival(c: Ctx, weight: number): Promise<Choice | null> {
  const { a, tx } = c;
  if (a.traits.empathy > 0.45 || a.traits.ambition < 0.7) return null;
  for (const t of c.ties) {
    if (t.kind !== 'rival' || !t.toAlive) continue;
    const rival = await loadAgent(tx, t.toAgentId);
    if (!rival || rival.occupation !== 'trader' || (rival.markup ?? 1) >= (a.markup ?? 0)) continue;
    const key = 'untrustworthy:' + rival._id;
    const existing = await getBelief(tx, a._id, key);
    if (existing?.acted !== undefined && tx.tick - existing.acted < 288) return null;
    const { eventId } = await emitEvent(tx, {
      category: 'social',
      eventType: 'smear',
      actorId: a._id,
      participantIds: [rival._id],
      locationId: 'market',
      summary: a.name + ', losing customers to ' + rival.name + "'s lower prices, has started telling people " + firstName(rival.name) + ' waters down what he sells.',
      salience: 0.55,
      visibility: 'private',
    });
    await learnBelief(tx, a, {
      kind: 'untrustworthy',
      text: rival.name + ' waters down the water he sells.',
      valence: -1,
      confidence: 0.75,
      sourceType: 'inference',
      subjectAgentId: rival._id,
      subjectName: rival.name,
      originEventId: eventId,
    });
    const belief = await getBelief(tx, a._id, key);
    if (belief) await markActed(tx, belief);
    return {
      score: weight * 0.9 + 0.15,
      routine: false,
      intent: 'Making sure the canteen hears that ' + rival.name + ' waters down his stock',
      ...new Plan(a.locationId).go('canteen').add('talk', ['any', key], 'Whispering about ' + rival.name).add('talk', ['any', key], 'Whispering about ' + rival.name + ' to someone else'),
      trigger: 'losing customers to ' + rival.name,
      causeEventId: eventId,
    };
  }
  return null;
}

/** A trader cuts their margin below a rival's to win the rival's customers. */
async function undercut(c: Ctx, g: Goal, weight: number): Promise<Choice | null> {
  const { a, tx } = c;
  const rival = g.targetAgentId ? await loadAgent(tx, g.targetAgentId) : null;
  if (rival?.alive && rival.markup !== undefined && (a.markup ?? 0.2) >= rival.markup && rival.markup > 0.06) {
    a.markup = round2(Math.max(0.05, rival.markup - 0.05));
    touch(tx, a);
    await emitEvent(tx, {
      category: 'economy',
      eventType: 'price_war',
      actorId: a._id,
      participantIds: [rival._id],
      locationId: 'market',
      summary: a.name + ' chalked up lower prices than ' + rival.name + "'s across the concourse, going after her customers.",
      salience: 0.42,
    });
  }
  if (!c.free || a.needs.fatigue > 65) return null;
  return {
    score: weight * 0.65,
    routine: false,
    intent: 'Keeping the stall open late, cheaper than ' + (rival?.name ?? 'the competition'),
    ...new Plan(a.locationId).go('market').add('work', [12], 'Selling cheap on the concourse'),
    trigger: g.description,
  };
}

async function seekPower(c: Ctx, g: Goal, weight: number): Promise<Choice | null> {
  const { a, tx } = c;
  if (!c.free) return null;
  const sim = await simState(tx);
  const pending = (topic: string) => sim.petitions.some((x) => x.agentId === a._id && x.topic === topic);
  if (g.predicate === 'rations_full_and_leader' && tx.world.econ.rationLevel > 0 && !pending('rations_open')) {
    return {
      score: weight + 0.2,
      routine: false,
      intent: 'Going to the Commons Plaza to demand the council restore full rations for the crews',
      ...new Plan(a.locationId).go('plaza').add('petition', ['rations_open'], 'Demanding full rations before the council'),
      trigger: 'rations cut to level ' + tx.world.econ.rationLevel,
      causeEventId: tx.world.causes.rations,
    };
  }
  const wantsSeat = g.predicate === 'on_council' || (g.source === 'divine' && g.drive === 'seek_power');
  if (wantsSeat && a.occupation !== 'councilor' && a.standing >= SEAT_STANDING && !pending('seat')) {
    return {
      score: weight + 0.1,
      routine: false,
      intent: 'Asking the council for a seat. ' + g.description,
      ...new Plan(a.locationId).go('plaza').add('petition', ['seat'], 'Asking the council for a seat'),
      trigger: 'standing has grown to ' + Math.round(a.standing * 10) / 10,
    };
  }
  const venue = a.factionId === 'union' ? 'canteen' : 'plaza';
  return {
    score: weight * 0.7,
    routine: false,
    intent: 'Canvassing at ' + locName(venue) + ' for support. ' + g.description,
    ...new Plan(a.locationId).go(venue).add('talk', ['any', 'campaign'], 'Canvassing for support').add('talk', ['any', 'campaign'], 'Canvassing someone else'),
    trigger: g.description,
  };
}

async function guardReserve(c: Ctx, weight: number): Promise<Choice | null> {
  const { a, tx } = c;
  const level = tx.world.econ.rationLevel;
  const days = Math.min(reserveDays(tx.world, 'water'), reserveDays(tx.world, 'food'));
  const sim = await simState(tx);
  if (level >= 2 || reserveRatio(tx.world) >= CUT_AT.guard[level] + 0.1 || sim.petitions.some((x) => x.agentId === a._id && x.topic === 'rations_guard')) return null;
  return {
    score: weight + 0.25,
    routine: false,
    intent: 'Going to the council to demand ration cuts: the reserve is down to ' + Math.round(days * 10) / 10 + ' days',
    ...new Plan(a.locationId).go('plaza').add('petition', ['rations_guard'], 'Urging the council to cut rations'),
    trigger: 'depot reserve at ' + Math.round(days * 10) / 10 + ' days',
    causeEventId: scarcityCause(tx.world, 'water'),
  };
}

/** Engineers go to the worst damage they can reach, with parts from the depot. */
function repairs(c: Ctx, score: number): Choice | null {
  const { a, tx } = c;
  if (stock(tx.world, 'depot', 'parts') < 2 || (!c.free && !c.shift)) return null;
  const worst = Object.entries(tx.world.damage)
    .filter(([loc, d]) => d > 0.01 && stormAt(tx.world, loc) === 0)
    .sort((x, y) => y[1] - x[1])[0];
  if (!worst) return null;
  const [loc, d] = worst;
  return {
    score,
    routine: false,
    intent: 'Heading to ' + locName(loc) + ' to repair the damage (' + Math.round(d * 100) + '%) before it costs the colony more',
    ...new Plan(a.locationId).go(loc).add('repair', [loc], 'Repairing ' + locName(loc)).add('repair', [loc], 'Repairing ' + locName(loc)),
    trigger: locName(loc) + ' damaged',
    causeEventId: tx.world.causes.storm,
  };
}

async function investigateGoal(c: Ctx, g: Goal, weight: number): Promise<Choice | null> {
  const { a, tx } = c;
  if (!c.free || !g.targetAgentId) return null;
  const b = await loadAgent(tx, g.targetAgentId);
  if (!b?.alive) return null;
  const kind = g.drive && ACCUSABLE.has(g.drive) ? g.drive : 'hoarding';
  let belief = c.beliefs.find((x) => x.key === kind + ':' + b._id);
  if (belief?.acted !== undefined && tx.tick - belief.acted < 288) return null;
  if (g.source !== 'divine' && rand(tx.world.seed, tx.tick, a.seq, 'probe') > 0.25) return null;
  if (!belief) {
    await learnBelief(tx, a, {
      kind,
      text: b.name + ' might be hiding supplies.',
      valence: -1,
      confidence: 0.45,
      sourceType: g.source === 'divine' ? 'divine' : 'inference',
      subjectAgentId: b._id,
      subjectName: b.name,
      originEventId: g.originEventId,
      private: true,
    });
    belief = (await getBelief(tx, a._id, kind + ':' + b._id)) ?? undefined;
  }
  const where = b.workLocationId && stormAt(tx.world, b.workLocationId) === 0 ? b.workLocationId : b.locationId;
  return {
    score: weight * 0.8 + 0.05,
    routine: false,
    intent: 'Going to ' + locName(where) + ' to find out whether ' + b.name + ' really ' + (kind === 'hoarding' ? 'is keeping supplies back' : 'did it'),
    ...new Plan(a.locationId).go(where).add('investigate', [b._id], 'Asking around about ' + b.name),
    trigger: g.description,
    causeEventId: belief?.originEventId ?? g.originEventId,
  };
}

async function distrust(c: Ctx, g: Goal, weight: number): Promise<Choice | null> {
  const { a, tx } = c;
  if (!c.free || !g.targetAgentId) return null;
  const belief = c.beliefs.filter((b) => b.subjectAgentId === g.targetAgentId && b.valence < 0).sort((x, y) => y.confidence - x.confidence)[0];
  if (!belief || (belief.acted !== undefined && tx.tick - belief.acted < 144)) return null;
  await markActed(tx, belief);
  const target = await loadAgent(tx, g.targetAgentId);
  if (target) await adjustRelationship(tx, a, target, { trust: -0.1 });
  return {
    score: weight * 0.8,
    routine: false,
    intent: 'Warning people at the canteen about ' + (belief.subjectName ?? 'someone'),
    ...new Plan(a.locationId).go('canteen').add('talk', ['any', belief.key], 'Warning someone about ' + belief.subjectName).add('talk', ['any', belief.key], 'Warning someone else'),
    trigger: g.description,
    causeEventId: belief.originEventId,
  };
}

/** Gives to the neediest person they know, buying something to give if they have nothing. */
async function share(c: Ctx, weight: number): Promise<Choice | null> {
  const { a, tx } = c;
  if (!c.free) return null;
  let needy: AgentDoc | null = null;
  let worst = 55;
  for (const t of c.ties.slice(0, 8)) {
    if (!t.toAlive || c.household?.memberIds.includes(t.toAgentId)) continue;
    const b = await findable(c, t.toAgentId);
    const need = b ? Math.max(b.needs.thirst, b.needs.hunger) : 0;
    if (b && need > worst) {
      needy = b;
      worst = need;
    }
  }
  if (!needy) return null;
  const res = needy.needs.thirst >= needy.needs.hunger ? 'water' : 'food';
  const plan = new Plan(a.locationId);
  if (a.inv[res] < 2) {
    if (a.inv.credits < tx.world.prices[res] * 3) return null;
    plan.go('market').add('buy', [res, 2], 'Buying ' + res + ' to give away');
  }
  plan.go(needy.locationId, 'Looking for ' + needy.name).add('give', [needy._id, res, 2], 'Giving ' + res + ' to ' + needy.name);
  return { score: weight + 0.1, routine: false, intent: 'Bringing ' + res + ' to ' + needy.name + '. Those with plenty should give to those without', ...plan, trigger: needy.name + ' is going without' };
}

async function protect(c: Ctx, g: Goal, weight: number): Promise<Choice | null> {
  const { a, tx } = c;
  const b = g.targetAgentId ? await findable(c, g.targetAgentId) : null;
  if (!b || b._id === a._id) return null;
  const res = b.needs.thirst >= b.needs.hunger ? 'water' : 'food';
  const need = Math.max(b.needs.thirst, b.needs.hunger);
  const own = res === 'water' ? a.needs.thirst : a.needs.hunger;
  if (need < 55 || b.inv[res] >= 1 || own > need - 10 || own >= 75) return null;
  const plan = new Plan(a.locationId);
  if (a.inv[res] < 1) {
    if (a.inv.credits >= tx.world.prices[res] * 2.5) plan.go('market').add('buy', [res, 2], 'Buying ' + res + ' for ' + b.name);
    else if (stock(tx.world, 'depot', res) >= 3 && (await theftChoice(c, res, need + 15))) {
      plan.go('depot').add('steal', ['depot', res, 2], 'Taking ' + res + ' from the depot for ' + b.name);
    } else return null;
  }
  plan.go(b.locationId, 'Finding ' + b.name).add('give', [b._id, res, 1], 'Giving ' + res + ' to ' + b.name);
  const stealing = plan.steps.some((s) => s.startsWith('steal'));
  return {
    score: weight + need / 150,
    routine: false,
    intent: stealing ? 'Taking ' + res + ' from the depot for ' + b.name + ', who has had nothing all day' : 'Getting ' + res + ' to ' + b.name + ' before anything else',
    ...plan,
    trigger: b.name + ' is ' + (res === 'water' ? 'thirsty' : 'hungry'),
    causeEventId: scarcityCause(tx.world, res),
  };
}

async function joinFaction(c: Ctx, g: Goal, weight: number): Promise<Choice | null> {
  if (!c.free) return null;
  const faction = c.factions.find((f) => f.key === g.targetFaction);
  const leader = await findable(c, faction?.leaderAgentId);
  if (!faction || !leader) return null;
  return {
    score: weight * 0.6,
    routine: false,
    intent: 'Finding ' + leader.name + ' to ask about joining the ' + faction.name,
    ...new Plan(c.a.locationId).go(leader.locationId, 'Looking for ' + leader.name).add('talk', [leader._id, 'join'], 'Asking to join the ' + faction.name),
    trigger: g.description,
  };
}

/** A dock hand or hauler with savings opens a stall; other job changes wait for a vacancy. */
async function changeJob(c: Ctx, g: Goal, weight: number): Promise<Choice | null> {
  const { a, tx } = c;
  if (g.targetOccupation !== 'trader' || a.inv.credits < 150 || !c.free) return null;
  const old = a.workLocationId;
  a.occupation = 'trader';
  a.workLocationId = 'market';
  a.markup = round2(0.1 + a.traits.ambition * 0.15);
  touch(tx, a);
  await emitEvent(tx, {
    category: 'economy',
    eventType: 'new_stall',
    actorId: a._id,
    locationId: 'market',
    summary: a.name + ' left ' + locName(old ?? 'plaza') + ' and opened a stall of their own on the Exchange Concourse.',
    salience: 0.6,
  });
  return { score: weight + 1, routine: false, intent: 'Opening my own stall on the Exchange at last', ...new Plan(a.locationId).go('market').add('work', [6], 'Setting up the new stall'), trigger: g.description };
}

// ---------- beliefs and politics ----------

/**
 * What the agent does about the bad things they believe of others. Security and the curious look
 * into it; the stubborn and the bold accuse; loyalty to one's own leader and a love of harmony
 * hold people back; scarcity and faction lines push them on.
 */
async function beliefChoices(c: Ctx): Promise<Choice[]> {
  const { a, tx } = c;
  const out: Choice[] = [];
  const t = a.traits;
  const security = a.occupation === 'security';
  if (!c.free && !(security && c.shift)) return out;
  const pressure = c.drought > 0 || tx.world.econ.rationLevel > 0 ? 0.12 : 0;
  const accused = (await simState(tx)).accused ?? {};
  for (const b of c.beliefs) {
    if (!b.subjectAgentId || b.subjectAgentId === a._id || b.valence >= 0 || !ACCUSABLE.has(b.kind) || b.confidence < 0.45) continue;
    // People act on a belief once, and again only when something new has reinforced it since.
    if (b.acted !== undefined && b.lastReinforcedTick <= b.acted) continue;
    const subject = await loadAgent(tx, b.subjectAgentId);
    if (!subject?.alive) continue;
    const affinity = c.ties.find((r) => r.toAgentId === subject._id)?.affinity ?? 0;
    const ownLeader = c.factions.some((f) => f.key === a.factionId && f.leaderAgentId === subject._id);
    const rivalFaction = subject.factionId && a.factionId && subject.factionId !== a.factionId ? 0.12 : 0;
    const observed = b.sourceType === 'observed';
    // The curious and security look into things; most people only now and then.
    const minded = security || rand(tx.world.seed, tx.tick, a.seq, 'probe:' + b.key) < t.curiosity * 0.5;
    const investigate = b.kind === 'untrustworthy' || !minded ? 0 : b.confidence * (0.1 + 0.45 * t.curiosity + (security ? 0.45 : 0)) * (observed ? 0.2 : 1);
    const accuse =
      (b.confidence - 0.35) * (0.4 + 0.6 * t.stubbornness + 0.5 * (1 - t.caution)) +
      rivalFaction +
      pressure +
      (security && observed ? 0.4 : 0) -
      0.3 * c.mind.values.harmony -
      (ownLeader ? 0.25 : 0) -
      Math.max(0, affinity) * 0.5 -
      // Someone accused in public today has been dealt with, as far as most people are concerned.
      (tx.tick - (accused[subject._id] ?? -1000) < 144 ? 0.35 : 0);
    const source = b.sourceName ? ', heard from ' + b.sourceName : observed ? ', saw it with my own eyes' : '';
    const trigger = 'believes ' + b.text.replace(/\.$/, '') + ' (' + Math.round(b.confidence * 100) + '% sure' + source + ')';
    if (ACCUSE_KINDS.has(b.kind) && b.confidence >= 0.55 && accuse >= investigate && accuse > 0.15 && subject.activity !== 'sleeping' && stormAt(tx.world, subject.locationId) === 0) {
      out.push({
        score: accuse + 0.2,
        routine: false,
        intent: 'Confronting ' + subject.name + ' at ' + locName(subject.locationId) + ' about ' + (b.kind === 'hoarding' ? 'the hoarding' : b.kind === 'thief' ? 'the stealing' : b.kind === 'suspect' ? 'the death' : 'what they did'),
        ...new Plan(a.locationId).go(subject.locationId, 'Going to find ' + subject.name).add('accuse', [subject._id, b.key], 'Confronting ' + subject.name),
        trigger,
        causeEventId: b.originEventId ?? b.truthEventId,
      });
    } else if (investigate > 0.15) {
      const where = subject.workLocationId && stormAt(tx.world, subject.workLocationId) === 0 ? subject.workLocationId : subject.locationId;
      out.push({
        score: investigate + 0.15,
        routine: false,
        intent: 'Going to ' + locName(where) + ' to find out if it is true that ' + b.text.charAt(0).toLowerCase() + b.text.slice(1).replace(/\.$/, ''),
        ...new Plan(a.locationId).go(where).add('investigate', [subject._id], 'Asking around about ' + subject.name),
        trigger,
        causeEventId: b.originEventId,
      });
    }
  }
  return out;
}

/** Ration politics: the open-handed petition against cuts, the cautious for them. */
async function politics(c: Ctx): Promise<Choice | null> {
  const { a, tx } = c;
  if (!c.free) return null;
  const level = tx.world.econ.rationLevel;
  const sim = await simState(tx);
  const days = Math.min(reserveDays(tx.world, 'water'), reserveDays(tx.world, 'food'));
  const open = c.beliefs.find((b) => b.key === 'policy_open');
  const guard = c.beliefs.find((b) => b.key === 'policy_guard');
  const short = c.household ? c.household.pantry.water < c.household.memberIds.length : false;
  const recent = (b?: BeliefDoc) => b?.acted !== undefined && tx.tick - b.acted < 144;
  let topic: string | null = null;
  let belief: BeliefDoc | undefined;
  let score = 0;
  if (open && (level > 0 || reserveRatio(tx.world) > BONUS_AT) && !recent(open)) {
    topic = 'rations_open';
    belief = open;
    score = open.confidence * (level > 0 ? 0.5 : 0.35) + (short ? 0.15 : 0) + (a.factionId === 'union' ? 0.08 : 0) + c.drought * 0.1;
  } else if (guard && level < 2 && reserveRatio(tx.world) < CUT_AT.guard[level] && !recent(guard)) {
    topic = 'rations_guard';
    belief = guard;
    score = guard.confidence * 0.5 + (a.factionId === 'founders' ? 0.08 : 0) + (CUT_AT.guard[level] - reserveRatio(tx.world)) * 0.5;
  }
  if (!topic || !belief || sim.petitions.some((x) => x.agentId === a._id && x.topic === topic)) return null;
  // Once a couple of voices have carried a cause to the council, most people leave it to them.
  const voices = sim.petitions.filter((x) => x.topic === topic).length;
  if (voices >= 4 || (voices >= 2 && a.traits.stubbornness < 0.8)) return null;
  await markActed(tx, belief);
  const intent = topic === 'rations_open' ? 'Going to the Commons Plaza to speak against the ration cuts' : 'Going to the Commons Plaza to urge ration cuts before the reserve runs out';
  return {
    score,
    routine: false,
    intent,
    ...new Plan(a.locationId).go('plaza').add('petition', [topic], topic === 'rations_open' ? 'Speaking against the ration cuts' : 'Urging ration cuts'),
    trigger: topic === 'rations_open' ? 'rations cut to level ' + level : 'reserve down to ' + Math.round(days * 10) / 10 + ' days',
    causeEventId: topic === 'rations_open' ? tx.world.causes.rations : scarcityCause(tx.world, 'water'),
  };
}

/** Role duties beyond the shift itself: security answers open cases, engineers fix damage. */
async function duty(c: Ctx): Promise<Choice | null> {
  const { a, tx } = c;
  if (a.occupation === 'fabricator' || a.occupation === 'solar_tech') return repairs(c, c.shift ? 0.85 : 0.45);
  const enforcer = a.occupation === 'security' || c.mind.goals.some((g) => g.drive === 'enforce' && g.status === 'active');
  if (!enforcer || (!c.shift && !c.free)) return null;
  const sim = await simState(tx);
  // Officers share the caseload: the chief takes every case, the others about half.
  if (a.role !== 'security_chief' && rand(tx.world.seed, tx.tick, a.seq, 'case') < 0.5) return null;
  for (const kase of sim.cases) {
    let suspectId = kase.suspectId;
    if (!suspectId) {
      suspectId = c.beliefs
        .filter((b) => b.subjectAgentId && b.subjectAgentId !== a._id && (b.kind === 'thief' || b.kind === 'hoarding') && b.confidence >= 0.3)
        .sort((x, y) => y.confidence - x.confidence)[0]?.subjectAgentId;
    }
    const suspect = await findable(c, suspectId);
    if (!suspect) continue;
    const held = c.beliefs.find((b) => b.key === 'thief:' + suspect._id);
    if (held?.acted !== undefined && held.lastReinforcedTick <= held.acted) continue;
    const known = held && held.confidence >= 0.8 ? held : undefined;
    const score = (c.shift ? 0.8 : 0.5) + (a.role === 'security_chief' ? 0.1 : 0);
    if (known) {
      return {
        score,
        routine: false,
        intent: 'Going to ' + locName(suspect.locationId) + ' to confront ' + suspect.name + ' over the theft',
        ...new Plan(a.locationId).go(suspect.locationId, 'Tracking down ' + suspect.name).add('accuse', [suspect._id, known.key], 'Confronting ' + suspect.name),
        trigger: 'open theft case',
        causeEventId: kase.eventId,
      };
    }
    const where = isLocation(kase.locationId) && stormAt(tx.world, kase.locationId) === 0 ? kase.locationId : suspect.locationId;
    return {
      score,
      routine: false,
      intent: 'Working the theft case at ' + locName(where) + '; ' + suspect.name + ' is the first name on the list',
      ...new Plan(a.locationId).go(where).add('investigate', [suspect._id], 'Asking around about ' + suspect.name),
      trigger: 'open theft case',
      causeEventId: kase.eventId,
    };
  }
  return null;
}

