/**
 * The iteration-2 steps, one scene at a time: two or more colonists placed together, traits set so
 * the outcome under test is the one the rules choose, a plan committed, and the tick run.
 */
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import schema from './schema';
import { adjustRelationship, beginTx, commitTx, encodeStep, learnBelief, loadAgent, loadMind, setPlan, touch, touchMind } from './engine/core';
import type { AgentDoc, Tx } from './engine/core';
import { testPersonas } from './engine/devtools';
import { ledgerOf } from './engine/ledger';
import { advance } from './engine/step';
import { modules } from './test.setup';

type Traits = AgentDoc['traits'];
const CALM: Traits = { ambition: 0.5, empathy: 0.5, caution: 0.5, curiosity: 0.5, sociability: 0.5, stubbornness: 0.5 };

async function colony(deviceId: string) {
  const t = convexTest(schema, modules);
  const { worldId } = await t.mutation(api.session.bootstrap, { deviceId });
  const id = worldId as Id<'worlds'>;
  await t.run((ctx) => testPersonas(ctx, id));
  return { t, worldId: id };
}

/** Runs a scene in one transaction: cast(...) places people, play(...) commits steps and runs ticks. */
async function scene(t: Awaited<ReturnType<typeof colony>>['t'], worldId: Id<'worlds'>, body: (s: Scene) => Promise<void>): Promise<void> {
  await t.run(async (ctx) => {
    const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
    const all = await ctx.db
      .query('agents')
      .withIndex('by_world_seq', (q) => q.eq('worldId', worldId))
      .collect();
    await body(new Scene(ctx, tx, all.filter((a) => a.alive && a.occupation !== 'security')));
    await commitTx(tx);
  });
}

class Scene {
  used = 0;
  constructor(
    public ctx: MutationCtx,
    public tx: Tx,
    private pool: Doc<'agents'>[],
  ) {}
  /** The next unused colonist, placed at loc, awake and idle for a while, with these traits and goods. */
  async cast(loc: string, traits: Partial<Traits> = {}, inv: Partial<AgentDoc['inv']> = {}, occupation?: string): Promise<AgentDoc> {
    const doc = occupation ? this.pool.find((a, i) => i >= this.used && a.occupation === occupation)! : this.pool[this.used];
    this.used += 1;
    const a = (await loadAgent(this.tx, doc._id))!;
    a.locationId = loc;
    a.move = undefined;
    a.activity = 'idle';
    a.busyUntilTick = this.tx.tick + 60;
    a.cur = undefined;
    a.q = [];
    a.traits = { ...CALM, ...traits };
    a.inv = { food: 0, water: 0, parts: 0, medicine: 0, credits: 0, ...inv };
    a.needs = { hunger: 20, thirst: 20, fatigue: 10, safety: 0, social: 30 };
    touch(this.tx, a);
    return a;
  }
  async play(a: AgentDoc, steps: string[], ticks = 1): Promise<void> {
    await setPlan(this.tx, a, { intent: 'test', source: 'llm', steps, labels: steps, now: true });
    await advance(this.tx, ticks);
  }
  async events(type: string, actor?: AgentDoc): Promise<Doc<'events'>[]> {
    const ids = new Set(this.tx.eventIds.map(String));
    const all = await this.ctx.db.query('events').collect();
    return all.filter((e) => ids.has(e._id) && e.eventType === type && (!actor || e.actorId === actor._id || e.participantIds.includes(actor._id)));
  }
  async mind(a: AgentDoc) {
    return (await loadMind(this.tx, a))!;
  }
  belief(a: AgentDoc, key: string) {
    return this.ctx.db
      .query('beliefs')
      .withIndex('by_agent_key', (q) => q.eq('agentId', a._id).eq('key', key))
      .first();
  }
  async tie(from: AgentDoc, to: AgentDoc, delta: Parameters<typeof adjustRelationship>[3]) {
    return adjustRelationship(this.tx, from, to, delta);
  }
}

describe('livelihood steps', () => {
  test('grow, scavenge, hide and the stash', async () => {
    const { t, worldId } = await colony('device-livelihood');
    await scene(t, worldId, async (s) => {
      const grower = await s.cast('habitat_a', {}, { water: 2 });
      grower.homeLocationId = 'habitat_a';
      await s.play(grower, [encodeStep('grow', 12)], 13);
      expect(grower.inv.water).toBe(1);
      expect(grower.inv.food).toBeGreaterThan(0.5);
      expect(await s.events('harvest', grower)).toHaveLength(1);

      const astray = await s.cast('plaza', {}, { water: 2 });
      await s.play(astray, [encodeStep('grow', 12)]);
      expect(astray.activityLabel).toMatch(/No grow rack/);

      const digger = await s.cast('quarry', { curiosity: 1, caution: 1 });
      await s.play(digger, [encodeStep('scavenge', 'quarry')], 5);
      const found = [...(await s.events('scavenge', digger)), ...(await s.events('rare_find', digger)), ...(await s.events('injury', digger))];
      expect(found).toHaveLength(1);
      const indoors = await s.cast('market');
      await s.play(indoors, [encodeStep('scavenge', 'market')]);
      expect(indoors.activityLabel).toMatch(/nothing to scavenge/);

      const hoarder = await s.cast('habitat_b', {}, { water: 5 });
      hoarder.homeLocationId = 'habitat_b';
      await s.play(hoarder, [encodeStep('hide', 'water', 4), encodeStep('drink'), encodeStep('drink')], 4);
      const stash = ledgerOf(await s.mind(hoarder)).stash;
      expect(hoarder.inv.water).toBe(0);
      expect(stash.water).toBe(3);
    });
  }, 120_000);

  test('beg, borrow, repay and barter', async () => {
    const { t, worldId } = await colony('device-debts');
    await scene(t, worldId, async (s) => {
      const giver = await s.cast('canteen', { empathy: 1 }, { food: 6, credits: 80, parts: 0 });
      const beggar = await s.cast('canteen', {}, { credits: 0, parts: 4 });
      await s.play(beggar, [encodeStep('beg', giver._id, 'food')]);
      expect(beggar.inv.food).toBe(1);
      expect(await s.events('charity', beggar)).toHaveLength(1);

      const empty = await s.cast('canteen', { empathy: 1 }, {});
      await s.play(beggar, [encodeStep('beg', empty._id, 'water')]);
      expect(await s.events('begging', beggar)).toHaveLength(1);

      await s.tie(giver, beggar, { trust: 0.8, affinity: 0.8 });
      await s.play(beggar, [encodeStep('borrow', giver._id, 'credits', 20)]);
      expect(beggar.inv.credits).toBe(20);
      const owes = ledgerOf(await s.mind(beggar)).owes;
      expect(owes).toHaveLength(1);
      expect(owes[0]).toMatchObject({ to: giver._id, res: 'credits', qty: 20 });
      expect((await s.belief(giver, 'debt:' + beggar._id))?.text).toMatch(/owes/);

      await s.play(beggar, [encodeStep('repay', giver._id)]);
      expect(ledgerOf(await s.mind(beggar)).owes).toHaveLength(0);
      expect(giver.inv.credits).toBe(80);
      expect(await s.events('debt_repaid', beggar)).toHaveLength(1);
      await s.play(beggar, [encodeStep('repay', giver._id)]);
      expect(beggar.activityLabel).toMatch(/Owed .* nothing/);

      await s.play(beggar, [encodeStep('barter', giver._id, 'parts', 3, 'food', 1)]);
      expect(await s.events('barter', beggar)).toHaveLength(1);
      expect(beggar.inv.parts).toBe(1);
      await s.play(beggar, [encodeStep('barter', giver._id, 'parts', 1, 'food', 4)]);
      expect(await s.events('barter_refused', beggar)).toHaveLength(1);
    });
  }, 120_000);

  test('smuggling at the pad leaves a deed and can be seen', async () => {
    const { t, worldId } = await colony('device-smuggle');
    await scene(t, worldId, async (s) => {
      const runner = await s.cast('landing_pad', { caution: 0 }, { parts: 4, credits: 0 });
      await s.play(runner, [encodeStep('smuggle', 'parts', 4)]);
      expect(runner.inv.parts).toBe(0);
      expect(runner.inv.credits).toBeGreaterThan(15);
      expect((await s.mind(runner)).ledger?.deeds.smuggler).toBe(1);
      expect(await s.events('smuggling', runner)).toHaveLength(1);
      const lost = await s.cast('plaza', {}, { parts: 4 });
      await s.play(lost, [encodeStep('smuggle', 'parts', 4)]);
      expect(lost.activityLabel).toMatch(/Landing Pad/);
    });
  }, 120_000);
});

describe('intrigue steps', () => {
  test('a bribe buys silence from the greedy and outrage from the honest', async () => {
    const { t, worldId } = await colony('device-bribe');
    await scene(t, worldId, async (s) => {
      const briber = await s.cast('plaza', {}, { credits: 100 });
      const greedy = await s.cast('plaza', { empathy: 0, ambition: 1, caution: 0 }, { credits: 5 });
      (await s.mind(greedy)).values = { ...(await s.mind(greedy)).values, wealth: 1, harmony: 0 };
      touchMind(s.tx, await s.mind(greedy));
      await s.play(briber, [encodeStep('bribe', greedy._id, 30, 'silence')]);
      expect(greedy.inv.credits).toBe(35);
      expect((await s.mind(greedy)).ledger?.favors.some((f) => f.forId === briber._id && f.kind === 'silence')).toBe(true);
      expect((await s.belief(briber, 'corrupt:' + greedy._id))?.confidence).toBe(1);
      // The bribed colonist now holds their tongue.
      await learnBelief(s.tx, greedy, { kind: 'thief', text: briber.name + ' has been stealing.', valence: -1, confidence: 0.9, sourceType: 'observed', subjectAgentId: briber._id, subjectName: briber.name });
      await s.play(greedy, [encodeStep('accuse', briber._id, 'thief:' + briber._id)]);
      expect(greedy.activityLabel).toMatch(/paid for silence/);

      const honest = await s.cast('plaza', { empathy: 1, ambition: 0, caution: 1 }, { credits: 100 });
      (await s.mind(honest)).values = { ...(await s.mind(honest)).values, wealth: 0, harmony: 1 };
      await s.play(briber, [encodeStep('bribe', honest._id, 10, 'silence')]);
      expect(await s.events('bribe_refused', briber)).toHaveLength(1);
      expect((await s.belief(honest, 'briber:' + briber._id))?.confidence).toBeGreaterThan(0.8);
    });
  }, 120_000);

  test('blackmail needs leverage; a frightened mark pays', async () => {
    const { t, worldId } = await colony('device-blackmail');
    await scene(t, worldId, async (s) => {
      const schemer = await s.cast('canteen', { ambition: 1, empathy: 0 }, { credits: 0 });
      const mark = await s.cast('canteen', { stubbornness: 0, caution: 1, ambition: 0, empathy: 1 }, { credits: 100 });
      await s.play(schemer, [encodeStep('blackmail', mark._id, 'affair:' + mark._id)]);
      expect(schemer.activityLabel).toMatch(/nothing on/);
      const mm = await s.mind(mark);
      mm.persona = { ...mm.persona!, secret: { kind: 'affair', text: mark.name + ' is seeing a neighbour in secret.' } };
      touchMind(s.tx, mm);
      await learnBelief(s.tx, schemer, { kind: 'affair', text: mark.name + ' is seeing a neighbour in secret.', valence: -0.8, confidence: 0.9, sourceType: 'observed', subjectAgentId: mark._id, subjectName: mark.name });
      await s.play(schemer, [encodeStep('blackmail', mark._id, 'affair:' + mark._id)]);
      expect(mark.inv.credits).toBe(60);
      expect(schemer.inv.credits).toBe(40);
      const [e] = await s.events('blackmail', schemer);
      expect((e.facts as { outcome: string }).outcome).toBe('pay');
      expect((await s.belief(mark, 'blackmailer:' + schemer._id))?.confidence).toBe(1);
    });
  }, 120_000);

  test('a lie plants a false belief that an investigation traces back to the liar', async () => {
    const { t, worldId } = await colony('device-lie');
    await scene(t, worldId, async (s) => {
      const liar = await s.cast('canteen');
      const listener = await s.cast('canteen', { caution: 0 });
      const victim = await s.cast('workshop', {}, { credits: 10 });
      await s.tie(listener, victim, { affinity: -0.3 });
      await s.play(liar, [encodeStep('lie', listener._id, victim._id, 'corrupt')]);
      const [lie] = await s.events('lie', liar);
      const belief = await s.belief(listener, 'corrupt:' + victim._id);
      expect(belief?.originEventId).toBe(lie._id);
      expect((await s.mind(liar)).ledger?.deeds.liar).toBe(1);
      await s.play(listener, [encodeStep('investigate', victim._id)], 5);
      expect(await s.events('liar_exposed', liar)).toHaveLength(1);
      expect((await s.belief(listener, 'liar:' + liar._id))?.confidence).toBeGreaterThan(0.8);
    });
  }, 120_000);

  test('eavesdropping can uncover a secret, and confessing it ends it', async () => {
    const { t, worldId } = await colony('device-eavesdrop');
    await scene(t, worldId, async (s) => {
      const snoop = await s.cast('canteen', { curiosity: 1 });
      const keeper = await s.cast('canteen', { caution: 0 });
      const km = await s.mind(keeper);
      km.persona = { ...km.persona!, secret: { kind: 'saboteur', text: keeper.name + ' wrecked the drill housing during the Long Dark.' } };
      touchMind(s.tx, km);
      for (let i = 0; i < 12 && !(await s.belief(snoop, 'saboteur:' + keeper._id)); i++) {
        keeper.busyUntilTick = s.tx.tick + 20;
        await s.play(snoop, [encodeStep('eavesdrop', keeper._id)], 3);
      }
      expect((await s.belief(snoop, 'saboteur:' + keeper._id))?.sourceType).toBe('observed');
      expect(await s.events('secret_overheard', snoop)).toHaveLength(1);

      await s.play(keeper, [encodeStep('confess', 'secret')]);
      expect(km.persona?.secret?.exposedAtTick).toBe(s.tx.tick);
      expect(await s.events('secret_exposed', keeper)).toHaveLength(1);
      await s.play(keeper, [encodeStep('confess', 'secret')]);
      expect(keeper.activityLabel).toMatch(/nothing to confess/);
    });
  }, 120_000);

  test('sabotage damages a site, leaves a deed and an equipment failure caused by it', async () => {
    const { t, worldId } = await colony('device-sabotage');
    await scene(t, worldId, async (s) => {
      const saboteur = await s.cast('workshop', { ambition: 1 });
      await s.play(saboteur, [encodeStep('sabotage', 'workshop')]);
      expect(s.tx.world.damage.workshop).toBeGreaterThan(0.1);
      expect((await s.mind(saboteur)).ledger?.deeds.saboteur).toBe(1);
      const [sab] = await s.events('sabotage', saboteur);
      const failure = (await s.events('equipment_failure')).find((e) => e.causationEventId === sab._id);
      expect(failure).toBeDefined();
      const home = await s.cast('habitat_a');
      await s.play(home, [encodeStep('sabotage', 'habitat_a')]);
      expect(home.activityLabel).toMatch(/Nothing worth breaking/);
    });
  }, 120_000);
});

describe('bonds', () => {
  test('confide passes a secret on; court becomes a romance, and an affair is caught', async () => {
    const { t, worldId } = await colony('device-bonds');
    await scene(t, worldId, async (s) => {
      const teller = await s.cast('canteen');
      const friend = await s.cast('canteen', { empathy: 1, sociability: 0 });
      const stranger = await s.cast('canteen');
      const tm = await s.mind(teller);
      tm.persona = { ...tm.persona!, secret: { kind: 'coward', text: teller.name + ' hid in an airlock during the Long Dark.' } };
      touchMind(s.tx, tm);
      await s.tie(teller, stranger, { trust: -2, affinity: -2 });
      await s.play(teller, [encodeStep('confide', stranger._id, 'secret')]);
      expect(teller.activityLabel).toMatch(/open up/);
      await s.tie(teller, friend, { trust: 0.8, affinity: 0.7 });
      await s.play(teller, [encodeStep('confide', friend._id, 'secret')]);
      expect((await s.belief(friend, 'coward:' + teller._id))?.sourceAgentId).toBe(teller._id);

      const suitor = await s.cast('canteen', { sociability: 1 });
      const beloved = await s.cast('canteen', { sociability: 1, caution: 0 });
      await s.tie(suitor, beloved, { affinity: 0.6, kind: 'acquaintance' });
      await s.tie(beloved, suitor, { affinity: 0.9, kind: 'acquaintance' });
      for (let i = 0; i < 14 && (await s.events('romance', suitor)).length === 0; i++) {
        beloved.busyUntilTick = s.tx.tick + 20;
        await s.play(suitor, [encodeStep('court', beloved._id)], 2);
      }
      const [romance] = await s.events('romance', suitor);
      expect(romance).toBeDefined();
      const tie = await s.ctx.db
        .query('relationships')
        .withIndex('by_from_to', (q) => q.eq('fromAgentId', beloved._id).eq('toAgentId', suitor._id))
        .first();
      expect(tie?.kind).toBe('romance');

      const tempter = await s.cast('canteen', { sociability: 1 });
      await s.tie(beloved, tempter, { affinity: 0.95, kind: 'acquaintance' });
      await s.tie(tempter, beloved, { affinity: 0.8, kind: 'acquaintance' });
      const bm = await s.mind(beloved);
      bm.values = { ...bm.values, harmony: 0 };
      touchMind(s.tx, bm);
      for (let i = 0; i < 14 && (await s.events('affair', tempter)).length === 0; i++) {
        beloved.busyUntilTick = s.tx.tick + 20;
        suitor.busyUntilTick = s.tx.tick + 20;
        await s.play(tempter, [encodeStep('court', beloved._id)], 2);
      }
      expect(await s.events('affair', tempter)).toHaveLength(1);
      expect(await s.events('jealousy', suitor)).toHaveLength(1);
      expect((await s.belief(suitor, 'affair:' + beloved._id))?.sourceType).toBe('observed');
    });
  }, 120_000);

  test('comfort, threats that collect a debt or start a fight, and reconciliation', async () => {
    const { t, worldId } = await colony('device-threaten');
    await scene(t, worldId, async (s) => {
      const kind = await s.cast('medbay');
      const mourner = await s.cast('medbay');
      mourner.mood = 'grieving';
      mourner.needs.safety = 60;
      await s.play(kind, [encodeStep('comfort', mourner._id)]);
      expect(mourner.needs.safety).toBeLessThan(40);
      expect(await s.events('comfort', kind)).toHaveLength(1);

      const lender = await s.cast('plaza', { ambition: 1, empathy: 0 }, { credits: 50 });
      const debtor = await s.cast('plaza', { stubbornness: 0, caution: 1 }, { credits: 0 });
      await s.tie(lender, debtor, { trust: 0.9, affinity: 0.9 });
      await s.play(debtor, [encodeStep('borrow', lender._id, 'credits', 15)]);
      expect(ledgerOf(await s.mind(debtor)).owes).toHaveLength(1);
      await s.play(lender, [encodeStep('threaten', debtor._id)]);
      expect(await s.events('threat', lender)).toHaveLength(1);
      expect(ledgerOf(await s.mind(debtor)).owes).toHaveLength(0);
      expect(lender.inv.credits).toBe(50);

      const brawler = await s.cast('plaza', { stubbornness: 1, caution: 0 });
      const bully = await s.cast('plaza', { ambition: 0, empathy: 1 });
      await s.play(bully, [encodeStep('threaten', brawler._id)]);
      expect(await s.events('fight', bully)).toHaveLength(1);
      expect(bully.health).toBeLessThan(100);

      const sorry = await s.cast('plaza');
      const hurt = await s.cast('plaza', { empathy: 1, stubbornness: 0 });
      await s.tie(hurt, sorry, { affinity: -0.5, kind: 'rival' });
      const hm = await s.mind(hurt);
      hm.values = { ...hm.values, harmony: 1 };
      await s.play(sorry, [encodeStep('reconcile', hurt._id)]);
      expect(await s.events('reconciliation', sorry)).toHaveLength(1);
      const healed = await s.ctx.db
        .query('relationships')
        .withIndex('by_from_to', (q) => q.eq('fromAgentId', hurt._id).eq('toAgentId', sorry._id))
        .first();
      expect(healed?.kind).toBe('acquaintance');
    });
  }, 120_000);
});

describe('collective action', () => {
  test('a rally with enough supporters calls a strike that stops work until the council answers', async () => {
    const { t, worldId } = await colony('device-strike');
    await scene(t, worldId, async (s) => {
      const leader = await s.cast('plaza');
      leader.factionId = 'union';
      const crowd: AgentDoc[] = [];
      for (let i = 0; i < 8; i++) {
        const w = await s.cast('plaza');
        w.factionId = 'union';
        await s.tie(w, leader, { affinity: 0.8, trust: 0.5 });
        crowd.push(w);
      }
      await s.play(leader, [encodeStep('rally', 'strike')]);
      expect(await s.events('rally_quorum', leader)).toHaveLength(1);
      expect(s.tx.world.sim?.strike?.leaderId).toBe(leader._id);
      expect(crowd.some((w) => w.q.some((step) => step.startsWith('strike')) || w.cur?.startsWith('strike'))).toBe(true);
      await s.play(crowd[0], [encodeStep('strike', 6)]);
      expect(crowd[0].activityLabel).toMatch(/On strike/);
      await advance(s.tx, 18);
      const answered = [...(await s.events('strike_won')), ...(await s.events('crackdown'))];
      expect(answered).toHaveLength(1);
      const sittingOut = await s.cast('plaza');
      await s.play(sittingOut, [encodeStep('rally', 'strike')]);
      expect(sittingOut.activityLabel).toMatch(/forced the issue|already out/);
    });
  }, 120_000);
});

describe('robustness', () => {
  test('malformed new steps from an LLM plan never throw and fail with a reason', async () => {
    const { t, worldId } = await colony('device-robust');
    const bad = [
      encodeStep('grow', 'x'),
      encodeStep('scavenge', 'atlantis'),
      encodeStep('beg', 'nobody', 'gold'),
      encodeStep('borrow', 'nobody', 'gold', 'many'),
      encodeStep('repay', 'nobody'),
      encodeStep('barter', 'nobody', 'food', 'x', 'food', 1),
      encodeStep('bribe', 'nobody', 'lots', 'everything'),
      encodeStep('blackmail', 'nobody', 'thief:nobody'),
      encodeStep('lie', 'nobody', 'nobody', 'witch'),
      encodeStep('confide', 'nobody'),
      encodeStep('court', 'nobody'),
      encodeStep('comfort', 'nobody'),
      encodeStep('threaten', 'nobody'),
      encodeStep('sabotage', 'the moon'),
      encodeStep('smuggle', 'souls', 2),
      encodeStep('rally', 'anarchy'),
      encodeStep('reconcile', 'nobody'),
      encodeStep('eavesdrop', 'nobody'),
      encodeStep('hide', 'souls', 2),
      encodeStep('confess', 'everything'),
    ];
    await scene(t, worldId, async (s) => {
      const a = await s.cast('canteen');
      for (const step of bad) {
        await s.play(a, [step, encodeStep('wait', 2)]);
        expect(a.q).toEqual([]);
        expect(a.activityLabel).not.toBe('Deciding what to do');
      }
    });
  }, 120_000);
});
