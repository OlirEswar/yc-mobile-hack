/**
 * Live check of the followed-colonist experience against the real model, skipped unless LLM_LIVE=1
 * and LLM_API_KEY are set:
 *   LLM_LIVE=1 LLM_API_KEY=... npx vitest run convex/storyteller.live.test.ts
 * Follows Dmitri Volkov through a drama-heavy hour (a secret, a debt, a suspicious rival) and prints
 * his monologue, an LLM plan and two answers to the player's questions.
 */
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { adjustRelationship, beginTx, commitTx, emitEvent, encodeStep, learnBelief, loadAgent, setPlan, touch } from './engine/core';
import type { Tx } from './engine/core';
import { directorTick } from './storyteller/director';
import { modules } from './test.setup';

const live = process.env.LLM_LIVE === '1' && Boolean(process.env.LLM_API_KEY);

type Persona = NonNullable<Doc<'minds'>['persona']>;

const PERSONAS: Record<string, Persona> = {
  'Dmitri Volkov': {
    epithet: 'the quartermaster who keeps two ledgers',
    want: 'Keep the depot reserve above the red line and his family fed',
    need: 'To admit he cannot hold the colony together alone',
    fear: 'Being exposed as the thief he hunts',
    flaw: 'Pride that will not ask for help',
    voice: 'Terse, precise, counts things when nervous, dry gallows humour',
    secret: { kind: 'embezzler', text: 'Since the Long Dark he has sold reserve water to shuttle crews to pay off a debt to Soledad Marchetti, and kept a second ledger to hide it.' },
    strategies: ['work', 'scheme', 'trade'],
    arc: { stage: 'rising', note: 'Hana has started asking about the ledgers' },
    key: true,
  },
  'Hana Yilmaz': {
    epithet: 'the union firebrand who wants the chair',
    want: 'Open the reserve and replace Imani as chair',
    need: 'To learn that winning is not the same as being right',
    fear: 'Becoming the kind of leader she despises',
    flaw: 'Believes the worst of the Compact',
    voice: 'Fast, warm with friends, cutting in debate',
    strategies: ['charm', 'work', 'scheme'],
    arc: { stage: 'rising', note: 'Smells corruption at the depot' },
    key: true,
  },
  'Soledad Marchetti': {
    epithet: 'the trader who collects on every favour',
    want: 'A monopoly on the shuttle trade',
    need: 'Someone she does not have to buy',
    fear: 'Dying poor, like her mother in the Long Dark',
    flaw: 'Treats people as ledger entries',
    voice: 'Velvet, patient, never raises her voice',
    strategies: ['trade', 'smuggle', 'scheme'],
    arc: { stage: 'rising', note: 'Dmitri is late on his payments' },
    key: true,
  },
};

test.skipIf(!live)(
  'the followed colonist thinks, plans and answers in character',
  async () => {
    const t = convexTest(schema, modules);
    const { worldId: raw, sessionToken } = await t.mutation(api.session.bootstrap, { deviceId: 'device-live-storyteller' });
    const worldId = raw as Id<'worlds'>;
    const ids = await t.run(async (ctx) => {
      const world = (await ctx.db.get(worldId))!;
      await ctx.db.patch(worldId, { tick: 200, speed: 0, loop: { ...world.loop, running: false }, llm: { ...world.llm, enabled: true } });
      const agents = await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', worldId)).collect();
      const by = (name: string) => agents.find((a) => a.name === name)!;
      for (const [name, persona] of Object.entries(PERSONAS)) await ctx.db.patch(by(name).mindId!, { persona });
      const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
      const [dmitri, hana, soledad] = await Promise.all(['Dmitri Volkov', 'Hana Yilmaz', 'Soledad Marchetti'].map(async (n) => (await loadAgent(tx, by(n)._id))!));
      for (const [a, loc] of [[dmitri, 'depot'], [hana, 'depot'], [soledad, 'market']] as const) {
        Object.assign(a, { locationId: loc, move: undefined, activity: 'working', activityLabel: 'Working', q: [] });
        touch(tx, a);
      }
      await adjustRelationship(tx, dmitri, soledad, { obligation: 0.7, fear: 0.4 });
      await adjustRelationship(tx, soledad, dmitri, { affinity: -0.3 });
      await adjustRelationship(tx, hana, dmitri, { affinity: -0.5, trust: -0.4 });
      await learnBelief(tx, hana, { kind: 'embezzler', text: 'Dmitri Volkov is skimming the reserve.', valence: -1, confidence: 0.6, sourceType: 'inference', subjectAgentId: dmitri._id, subjectName: dmitri.name });
      tx.world.focusAgentId = dmitri._id;
      await commitTx(tx);
      await ctx.db.insert('storylines', {
        worldId,
        key: 'seed:two-ledgers',
        title: 'Two Ledgers',
        premise: 'The quartermaster counts every crate twice, and somebody is still selling the colony\'s water.',
        status: 'rising',
        tension: 0.55,
        participantIds: [dmitri._id, hana._id, soledad._id],
        beats: [{ tick: 150, text: 'Hana Yilmaz asked the council to audit the depot ledgers.' }],
        origin: 'seed',
        createdTick: 0,
        lastBeatTick: 150,
        state: { kind: 'secret' },
      });
      return { dmitri: dmitri._id, hana: hana._id, soledad: soledad._id };
    });

    const step = async (label: string, emit: (tx: Tx) => Promise<unknown>, by = 1) => {
      await t.run(async (ctx) => {
        const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
        tx.tick += by;
        tx.world.tick = tx.tick;
        const first = tx.eventIds.length;
        await emit(tx);
        await directorTick(tx, first);
        await commitTx(tx);
      });
      await t.action(internal.cognition.drain, { worldId });
      await t.finishInProgressScheduledFunctions();
      const jobs = await t.run((ctx) => ctx.db.query('cognitionJobs').order('desc').take(1));
      console.log('\n== ' + label + ' -> ' + jobs[0]?.kind + ' job ' + jobs[0]?.status + ' (' + jobs[0]?.outcome + ')');
    };

    await step('Hana reads the manifest', (tx) =>
      emitEvent(tx, { category: 'social', eventType: 'eavesdrop', actorId: ids.hana, participantIds: [ids.dmitri], locationId: 'depot', summary: "Hana Yilmaz was caught reading the depot manifest over Dmitri Volkov's shoulder.", salience: 0.6 }),
    );
    await step('a new decision', async (tx) => {
      const d = (await loadAgent(tx, ids.dmitri))!;
      await setPlan(tx, d, { intent: 'Back to the count.', source: 'routine', steps: [encodeStep('work', 12)], labels: ['Count the reserve'] });
    }, 2);
    await step('Soledad calls in the debt', (tx) =>
      emitEvent(tx, {
        category: 'social',
        eventType: 'threaten',
        actorId: ids.soledad,
        participantIds: [ids.dmitri],
        locationId: 'depot',
        summary: 'Soledad Marchetti sent word to Dmitri Volkov: the shuttle crew wants its water tonight, or the council hears who has been supplying them.',
        salience: 0.75,
      }),
    3);
    await step('a decision after the threat', async (tx) => {
      const d = (await loadAgent(tx, ids.dmitri))!;
      await setPlan(tx, d, { intent: 'Finish the shift.', source: 'routine', steps: [encodeStep('work', 12)], labels: ['Finish the shift at the depot'] });
    });
    await step('a quiet hour', async () => {}, 5);

    const { thoughts, plan } = await t.run(async (ctx) => ({
      thoughts: await ctx.db.query('thoughts').withIndex('by_agent_tick', (q) => q.eq('agentId', ids.dmitri)).collect(),
      plan: (await ctx.db.get((await ctx.db.get(ids.dmitri))!.mindId!))!.plan,
    }));
    console.log('\nMONOLOGUE');
    for (const th of thoughts) console.log('- [' + th.source + (th.mood ? ', ' + th.mood : '') + '] ' + th.text);
    console.log('\nPLAN (' + plan?.source + '): ' + plan?.intent);
    plan?.steps.forEach((s, i) => console.log('  ' + s + '  // ' + plan.labels[i]));

    for (const question of ['Why do you count every crate twice?', 'What do you owe Soledad?']) {
      const answer = await t.action(api.focus.ask, { sessionToken, worldId, agentId: ids.dmitri, question });
      console.log('\nQ: ' + question + '\nA: ' + (answer.ok ? answer.turn.answer : answer.code + ' ' + answer.message));
      await new Promise((resolve) => setTimeout(resolve, 3100));
    }
    expect(thoughts.length).toBeGreaterThan(1);
  },
  180_000,
);
