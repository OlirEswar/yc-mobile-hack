/**
 * Live prompt check against the real model, skipped unless LLM_LIVE=1 and LLM_API_KEY are set:
 *   LLM_LIVE=1 LLM_API_KEY=... npx vitest run convex/cognition.live.test.ts
 * Builds a few dramatic situations on the seeded colony, runs real plan and speech jobs end to end,
 * and prints the prompt size, the answer and what was committed.
 */
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { beginTx, commitTx, emitEvent, killAgent, learnBelief, loadAgent, touch } from './engine/core';
import type { AgentDoc, Tx } from './engine/core';
import { modules } from './test.setup';

const live = process.env.LLM_LIVE === '1' && Boolean(process.env.LLM_API_KEY);

test.skipIf(!live)(
  'the prompt produces legal, in-character plans and lines',
  async () => {
    const t = convexTest(schema, modules);
    const { worldId: raw } = await t.mutation(api.session.bootstrap, { deviceId: 'device-live-llm' });
    const ids = await t.run(async (ctx) => {
      const worldId = ctx.db.normalizeId('worlds', raw)!;
      const world = (await ctx.db.get(worldId))!;
      // Sol 2, midday, three days into a drought, emergency rations.
      await ctx.db.patch(worldId, {
        tick: 150,
        prices: { food: 5, water: 6, parts: 5, medicine: 9 },
        econ: { ...world.econ, rationLevel: 2 },
        llm: { ...world.llm, enabled: true },
        activeEffects: [{ id: 'e1', type: 'drought', locationIds: [], severity: 0.7, startTick: 100, endTick: 500, label: 'Drought: the ice wells are running dry' }],
      });
      const tx = beginTx(ctx, (await ctx.db.get(worldId))!);
      const agents = await ctx.db.query('agents').withIndex('by_world_seq', (q) => q.eq('worldId', worldId)).collect();
      const by = (name: string) => agents.find((a) => a.name === name)!._id;
      const place = async (id: Id<'agents'>, loc: string, patch: Partial<AgentDoc> = {}) => {
        const a = (await loadAgent(tx, id))!;
        Object.assign(a, { locationId: loc, activity: 'idle', activityLabel: 'Taking a break', move: undefined }, patch);
        touch(tx, a);
        return a;
      };
      const priya = await place(by('Priya Raghunathan'), 'canteen', { needs: { hunger: 45, thirst: 58, fatigue: 30, safety: 30, social: 40 } });
      const joao = await place(by('Joao Ferreira'), 'canteen');
      const dmitri = await place(by('Dmitri Volkov'), 'depot', { activity: 'working', activityLabel: 'Counting the reserve' });
      await place(by('Marcus Bell'), 'depot');
      await place(by('Lucia Navarro'), 'canteen', { activity: 'working', activityLabel: 'Cooking the midday meal' });
      const elias = await place(by('Elias Thorne'), 'habitat_a', { needs: { hunger: 70, thirst: 82, fatigue: 40, safety: 45, social: 30 }, inv: { food: 0, water: 0, parts: 0, medicine: 0, credits: 9 } });
      const wren = await place(by('Wren Thorne'), 'habitat_a', { needs: { hunger: 75, thirst: 85, fatigue: 30, safety: 50, social: 30 } });
      const tobias = await place(by('Tobias Okafor'), 'market');
      const soledad = await place(by('Soledad Marchetti'), 'market', { activity: 'trading', activityLabel: 'Haggling over water', interactingWithId: tobias._id });

      await rumor(tx, priya, dmitri, joao, 'canteen');
      const { eventId } = await emitEvent(tx, {
        category: 'economy', eventType: 'ration_cut', summary: 'The council cut water rations to emergency levels as the ice wells ran dry.', salience: 0.8, visibility: 'public',
        witnesses: [priya._id, dmitri._id, elias._id, joao._id],
      });
      const household = elias.householdId ? (await ctx.db.get(elias.householdId))! : null;
      if (household) await ctx.db.patch(household._id, { pantry: { food: 1, water: 0 } });
      await emitEvent(tx, { category: 'health', eventType: 'thirst', summary: 'Wren Thorne fainted from thirst in Habitat Ring A.', salience: 0.6, actorId: wren._id, locationId: 'habitat_a', witnesses: [elias._id], causationEventId: eventId });
      await killAgent(tx, tobias, { cause: 'suit breach during the storm at the Landing Pad', summary: 'Tobias Okafor died when his suit breached at the Landing Pad.' });
      await commitTx(tx);
      return { worldId, priya: priya._id, dmitri: dmitri._id, elias: elias._id, lucia: by('Lucia Navarro'), soledad: soledad._id, joao: joao._id };
    });

    const scenarios: { name: string; agentId: Id<'agents'>; trigger: string; detail?: string }[] = [
      { name: 'Priya hears the rumor', agentId: ids.priya, trigger: 'Joao Ferreira just told her Dmitri Volkov is hoarding water at the depot', detail: 'Rations were cut to emergency this morning' },
      { name: 'Dmitri under suspicion', agentId: ids.dmitri, trigger: 'Word reached him that people at the canteen say he hoards water', detail: 'The reserve is shrinking and the council wants answers' },
      { name: 'Elias and a fainting child', agentId: ids.elias, trigger: 'His daughter Wren fainted from thirst and the pantry is empty', detail: 'Water costs 6 credits and he has 9' },
      { name: 'Lucia loses Tobias', agentId: ids.lucia, trigger: 'Tobias Okafor died in a suit breach at the Landing Pad' },
    ];
    for (const s of scenarios) {
      const report = await t.action(internal.cognition.debugPlan, { agentId: s.agentId, trigger: s.trigger, detail: s.detail });
      console.log(
        '\n===== ' + s.name + ' =====\n' +
          JSON.stringify({ outcome: report.outcome, promptChars: report.promptChars, approxPromptTokens: report.approxPromptTokens, tokensIn: report.tokensIn, tokensOut: report.tokensOut, latencyMs: report.latencyMs, dropped: report.dropped, plan: report.plan, raw: report.raw }, null, 2),
      );
      if (s === scenarios[0]) console.log('----- prompt (user part) -----\n' + report.prompt?.user);
      expect(report.outcome).toBe('done: committed');
    }

    const jobId = await t.run(async (ctx) => {
      const world = (await ctx.db.get(ids.worldId))!;
      const soledad = (await ctx.db.get(ids.soledad))!;
      const mind = (await ctx.db.get(soledad.mindId!))!;
      // Tobias is dead; she now talks with Joao instead.
      await ctx.db.patch(ids.soledad, { interactingWithId: ids.joao, locationId: 'market' });
      return await ctx.db.insert('cognitionJobs', {
        worldId: world._id, agentId: ids.soledad, kind: 'speech', trigger: 'Joao asks what a cup of water costs today', priority: 0.8, status: 'queued', lane: 'focus', enqueuedTick: world.tick, mindVersion: mind.stateVersion, attempts: 0,
      });
    });
    await t.action(internal.cognition.drain, { worldId: ids.worldId });
    const speech = await t.run(async (ctx) => ({ job: (await ctx.db.get(jobId))!, soledad: (await ctx.db.get(ids.soledad))! }));
    console.log('\n===== Soledad speech =====\n' + JSON.stringify({ status: speech.job.status, outcome: speech.job.outcome, line: speech.soledad.speech, raw: speech.job.trace?.raw }, null, 2));
    expect(speech.job.status).toBe('done');
  },
  180_000,
);

async function rumor(tx: Tx, hearer: AgentDoc, subject: AgentDoc, teller: AgentDoc, locationId: string) {
  const { eventId } = await emitEvent(tx, {
    category: 'social', eventType: 'conversation', summary: teller.name + ' told ' + hearer.name + ' that ' + subject.name + ' is hoarding water at the depot.', salience: 0.55, actorId: teller._id, participantIds: [hearer._id], locationId,
  });
  await learnBelief(tx, hearer, { kind: 'hoarding', text: subject.name + ' is secretly hoarding water at the depot.', valence: -1, confidence: 0.6, sourceType: 'told', subjectAgentId: subject._id, subjectName: subject.name, sourceAgentId: teller._id, sourceName: teller.name, originEventId: eventId });
  // Overheard: the subject learns that people talk about him.
  await learnBelief(tx, subject, { kind: 'custom', worldKey: 'gossip_about_me', text: 'People at the canteen are saying I hoard water.', valence: 0, confidence: 0.7, sourceType: 'told' });
}
