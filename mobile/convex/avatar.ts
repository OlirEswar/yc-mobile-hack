/**
 * Avatars: a colonist modelled on the player. The player imports digested material about
 * themself, a model (or keyword rules) turns it into a profile, and the profile steps off a shuttle
 * as a colonist who plans and talks like them. The player can then tell it what they want.
 */
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { TICKS_PER_DAY } from '../shared/colony';
import type { AvatarProfile, AvatarPublic, AvatarResult, NewCharacterInput, PersonaSourceKind } from '../shared/types';
import { planDirective } from './avatar/directive';
import { MAX_SOURCES, SOURCE_KINDS, SOURCE_MAX_CHARS, SOURCE_MIN_CHARS, normalizeProfile, profileRequest, rulesProfile, scrub } from './avatar/profile';
import { chat, providerConfig } from './cognition/provider';
import { parseJson } from './cognition/validate';
import { beginTx, commitTx, emitEvent, enqueueCognition, loadAgent, loadMind, setPlan, touch, touchMind } from './engine/core';
import { authorizeWorld, getSession } from './lib/auth';
import { avatarIn, playerName, playersIn } from './lib/players';
import { createCharacter } from './powers/arrival';
import { isFailure } from './powers/common';

const SYNTH_WINDOW_MS = 10 * 60_000;
const SYNTHS_PER_WINDOW = 6;
/** Directives shown per world; three times as many are kept across worlds. */
const MAX_DIRECTIVES = 5;
const DIRECTIVE_TTL_TICKS = 2 * TICKS_PER_DAY;
/** What a fresh avatar carries off the shuttle. */
const STARTING = { credits: 60, food: 4, water: 4 };

const fail = (message: string): AvatarResult => ({ ok: false, message });

async function personaOf(ctx: QueryCtx | MutationCtx, sessionId: Id<'sessions'>) {
  return await ctx.db
    .query('personas')
    .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
    .first();
}

async function sourcesOf(ctx: QueryCtx | MutationCtx, sessionId: Id<'sessions'>) {
  return await ctx.db
    .query('personaSources')
    .withIndex('by_session', (q) => q.eq('sessionId', sessionId))
    .collect();
}

/** The player's sources, profile, avatar in the current world and recent directives. */
export const mine = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<AvatarPublic | null> => {
    const session = await getSession(ctx, sessionToken);
    if (!session) return null;
    const persona = await personaOf(ctx, session._id);
    const sources = await sourcesOf(ctx, session._id);
    const avatar = await avatarIn(ctx, session._id, session.worldId);
    return {
      sources: sources.map((s) => ({ id: s._id, kind: s.kind as PersonaSourceKind, label: s.label, chars: s.text.length, preview: s.text.slice(0, 160), addedAt: s.addedAt })),
      profile: persona?.profile as AvatarProfile | undefined,
      profileSource: persona?.profileSource as AvatarPublic['profileSource'],
      agentId: avatar?._id,
      directives: (persona?.directives ?? []).filter((d) => d.worldId === session.worldId).slice(0, MAX_DIRECTIVES).map((d) => ({ text: d.text, tick: d.tick, worldId: d.worldId })),
    };
  },
});

/** Stores one digested source after scrubbing contact details and links. */
export const addSource = mutation({
  args: { sessionToken: v.string(), source: v.object({ kind: v.string(), label: v.string(), text: v.string() }) },
  handler: async (ctx, { sessionToken, source }): Promise<AvatarResult> => {
    const session = await getSession(ctx, sessionToken);
    if (!session) return fail('This session is not recognised.');
    if (!(SOURCE_KINDS as readonly string[]).includes(source.kind)) return fail('Unknown source kind.');
    const label = scrub(source.label).replace(/\s+/g, ' ').slice(0, 60).trim();
    if (label.length < 1) return fail('Give the source a label.');
    const text = scrub(source.text);
    if (text.length < SOURCE_MIN_CHARS) return fail('That is too short to learn anything from. Add at least ' + SOURCE_MIN_CHARS + ' characters.');
    if (text.length > SOURCE_MAX_CHARS) return fail('That is too long. Keep it under ' + SOURCE_MAX_CHARS + ' characters.');
    if ((await sourcesOf(ctx, session._id)).length >= MAX_SOURCES) return fail('You can keep ' + MAX_SOURCES + ' sources. Remove one first.');
    await ctx.db.insert('personaSources', { sessionId: session._id, kind: source.kind, label, text, addedAt: Date.now() });
    return { ok: true };
  },
});

export const removeSource = mutation({
  args: { sessionToken: v.string(), sourceId: v.string() },
  handler: async (ctx, { sessionToken, sourceId }): Promise<AvatarResult> => {
    const session = await getSession(ctx, sessionToken);
    if (!session) return fail('This session is not recognised.');
    const id = ctx.db.normalizeId('personaSources', sourceId);
    const doc = id ? await ctx.db.get(id) : null;
    if (!doc || doc.sessionId !== session._id) return fail('That source does not exist.');
    await ctx.db.delete(doc._id);
    return { ok: true };
  },
});

/** Reserves a synthesis call under the rate limit and returns the material for it. */
export const beginSynthesis = internalMutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<{ ok: true; sessionId: Id<'sessions'>; sources: { kind: string; label: string; text: string }[] } | { ok: false; message: string }> => {
    const session = await getSession(ctx, sessionToken);
    if (!session) return { ok: false, message: 'This session is not recognised.' };
    const sources = await sourcesOf(ctx, session._id);
    if (sources.length === 0) return { ok: false, message: 'Add at least one source about yourself first.' };
    const now = Date.now();
    const persona = await personaOf(ctx, session._id);
    const recent = (persona?.synthTimes ?? []).filter((t) => now - t < SYNTH_WINDOW_MS);
    if (recent.length >= SYNTHS_PER_WINDOW) return { ok: false, message: 'That is a lot of rebuilding. Try again in a few minutes.' };
    if (persona) await ctx.db.patch(persona._id, { synthTimes: [...recent, now] });
    else await ctx.db.insert('personas', { sessionId: session._id, directives: [], synthTimes: [now], updatedAt: now });
    return { ok: true, sessionId: session._id, sources: sources.map((s) => ({ kind: s.kind, label: s.label, text: s.text })) };
  },
});

export const storeProfile = internalMutation({
  args: { sessionId: v.id('sessions'), profile: v.any(), profileSource: v.string() },
  handler: async (ctx, { sessionId, profile, profileSource }) => {
    const persona = await personaOf(ctx, sessionId);
    const fields = { profile: profile as AvatarProfile, profileSource, updatedAt: Date.now() };
    if (persona) await ctx.db.patch(persona._id, fields);
    else await ctx.db.insert('personas', { sessionId, directives: [], synthTimes: [], ...fields });
  },
});

/**
 * Builds the profile from every source: with the LLM when one is configured, falling back to
 * keyword rules when there is no key or the call fails. Any field the model gets wrong is taken
 * from the rules profile, so the result always passes the same check as a player's edit.
 */
export const synthesize = action({
  args: { sessionToken: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { sessionToken, name }): Promise<AvatarResult> => {
    const begun = await ctx.runMutation(internal.avatar.beginSynthesis, { sessionToken });
    if (!begun.ok) return fail(begun.message);
    const wanted = name?.trim() ? name.trim().slice(0, 40) : undefined;
    const rules = rulesProfile(begun.sources.map((s) => s.text), wanted);
    let profile: AvatarProfile = rules;
    let profileSource: 'llm' | 'rules' = 'rules';
    const config = providerConfig();
    if (config) {
      try {
        const result = await chat(config, profileRequest(begun.sources, wanted));
        const normalized = normalizeProfile(parseJson(result.text), rules);
        if (typeof normalized !== 'string') {
          profile = wanted ? { ...normalized, name: rules.name } : normalized;
          profileSource = 'llm';
        }
      } catch {
        // The rules profile stands.
      }
    }
    await ctx.runMutation(internal.avatar.storeProfile, { sessionId: begun.sessionId, profile, profileSource });
    return { ok: true, profile, profileSource };
  },
});

/** Saves a profile the player edited. */
export const saveProfile = mutation({
  args: { sessionToken: v.string(), profile: v.any() },
  handler: async (ctx, { sessionToken, profile }): Promise<AvatarResult> => {
    const session = await getSession(ctx, sessionToken);
    if (!session) return fail('This session is not recognised.');
    const checked = normalizeProfile(profile);
    if (typeof checked === 'string') return fail(checked);
    const persona = await personaOf(ctx, session._id);
    const fields = { profile: checked, profileSource: 'player', updatedAt: Date.now() };
    if (persona) await ctx.db.patch(persona._id, fields);
    else await ctx.db.insert('personas', { sessionId: session._id, directives: [], synthTimes: [], ...fields });
    return { ok: true, profile: checked, profileSource: 'player' };
  },
});

/**
 * Puts the avatar into the player's current world at the Landing Pad, through the same arrival as
 * the create_character power. Other players' living avatars there become friends, and the avatar's
 * first LLM plan is asked for in the focus lane, so it sets out to find its kind of people.
 */
export const spawn = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<AvatarResult> => {
    const auth = await authorizeWorld(ctx, sessionToken);
    if (!auth) return fail('This session is not recognised.');
    const { session, world } = auth;
    const persona = await personaOf(ctx, session._id);
    const profile = persona?.profile as AvatarProfile | undefined;
    if (!persona || !profile) return fail('Build your character first.');
    const existing = await avatarIn(ctx, session._id, world._id);
    if (existing?.alive) return fail(existing.name + ' is already in this colony.');

    const friends: Doc<'agents'>[] = [];
    for (const other of await playersIn(ctx, world)) {
      if (other._id === session._id) continue;
      const avatar = await avatarIn(ctx, other._id, world._id);
      if (avatar?.alive && friends.length < 3) friends.push(avatar);
    }
    const input: NewCharacterInput = {
      name: profile.name,
      spriteId: profile.spriteId,
      ageBand: profile.ageBand,
      occupation: profile.occupation,
      homeLocationId: profile.homeLocationId,
      traits: profile.traits,
      values: profile.values,
      backstory: profile.backstory,
      startingResources: STARTING,
      goals: profile.goals,
      relationships: friends.map((f) => ({ toAgentId: f._id, kind: 'friend' as const })),
    };
    const tx = beginTx(ctx, world);
    const parsed = await createCharacter.parse(tx, input);
    if (isFailure(parsed)) return fail(parsed.message);
    const { createdAgentId } = await createCharacter.apply(tx, parsed);
    const arrivalEventId = tx.eventIds[tx.eventIds.length - 1];
    const agent = (await loadAgent(tx, createdAgentId!))!;
    const owner = await playerName(ctx, session);
    agent.ownerSessionId = session._id;
    agent.ownerName = owner;
    agent.activityLabel = 'Just arrived as ' + owner + "'s avatar";
    touch(tx, agent);
    const mind = (await loadMind(tx, agent))!;
    mind.avatarPersona = { summary: profile.summary, interests: profile.interests, speechStyle: profile.speechStyle, habits: profile.habits };
    touchMind(tx, mind);

    if (friends.length > 0) {
      const names = friends.map((f) => f.name.split(' ')[0]);
      await emitEvent(tx, {
        category: 'social',
        eventType: 'reunion',
        actorId: agent._id,
        participantIds: friends.map((f) => f._id),
        locationId: 'landing_pad',
        summary: agent.name + ' found ' + (names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]) + ', friends from back home, already settled in the colony.',
        salience: 0.7,
        causationEventId: arrivalEventId,
        visibility: 'public',
      });
    }
    // The arrival queued a normal plan job; ask for it sooner and with the reason that matters.
    const job = await ctx.db
      .query('cognitionJobs')
      .withIndex('by_agent_status', (q) => q.eq('agentId', agent._id).eq('status', 'queued'))
      .first();
    const trigger = 'Just arrived as the avatar of ' + owner + ', and wants to find people here who share their interests';
    if (job) await ctx.db.patch(job._id, { lane: 'focus', priority: 0.9, trigger });
    else await enqueueCognition(tx, agent, { kind: 'plan', trigger, priority: 0.9, lane: 'focus', eventId: arrivalEventId });
    await commitTx(tx);
    return { ok: true, agentId: agent._id };
  },
});

/**
 * Tells the avatar what its player wants. The wish becomes the avatar's top goal and its private
 * directive, the avatar starts a keyword plan at once, and the LLM is asked for a better one.
 */
export const direct = mutation({
  args: { sessionToken: v.string(), text: v.string() },
  handler: async (ctx, args): Promise<AvatarResult> => {
    const auth = await authorizeWorld(ctx, args.sessionToken);
    if (!auth) return fail('This session is not recognised.');
    const { session, world } = auth;
    const text = scrub(args.text).replace(/\s+/g, ' ').replace(/[.!]+$/, '');
    if (text.length < 3 || text.length > 140) return fail('Say it in 3 to 140 characters.');
    const found = await avatarIn(ctx, session._id, world._id);
    if (!found) return fail('Drop your avatar into the colony first.');
    if (!found.alive) return fail(found.name + ' is dead.');

    const tx = beginTx(ctx, world);
    const agent = (await loadAgent(tx, found._id))!;
    const mind = (await loadMind(tx, agent))!;
    mind.goals = mind.goals.filter((g) => !(g.source === 'owner' && g.status === 'active'));
    const goalId = 'g' + mind.nextGoalSeq;
    mind.nextGoalSeq += 1;
    mind.goals.unshift({
      id: goalId,
      kind: 'custom',
      description: text,
      priority: 0.9,
      source: 'owner',
      status: 'active',
      createdAtTick: tx.tick,
      expiresAtTick: tx.tick + DIRECTIVE_TTL_TICKS,
      predicate: 'none',
    });
    mind.directive = { text, tick: tx.tick };
    mind.stateVersion += 1;
    touchMind(tx, mind);

    const owner = agent.ownerName ?? (await playerName(ctx, session));
    const { eventId } = await emitEvent(tx, {
      category: 'intervention',
      eventType: 'directive',
      actorId: agent._id,
      locationId: agent.locationId,
      summary: owner + ' asked ' + agent.name.split(' ')[0] + ' to ' + text.charAt(0).toLowerCase() + text.slice(1) + '.',
      salience: 0.5,
      visibility: 'private',
    });
    const planned = planDirective(text, agent);
    await setPlan(tx, agent, { ...planned, source: 'local_planner', goalId, causeEventId: eventId, trigger: owner + ' asked: "' + text + '"', now: true });
    await enqueueCognition(tx, agent, { kind: 'plan', trigger: 'Their player ' + owner + ' asked them: "' + text + '"', priority: 1, lane: 'focus', eventId });
    await commitTx(tx);

    const persona = await personaOf(ctx, session._id);
    if (persona) {
      const directives = [{ text, tick: tx.tick, worldId: world._id }, ...persona.directives].slice(0, MAX_DIRECTIVES * 3);
      await ctx.db.patch(persona._id, { directives, updatedAt: Date.now() });
    }
    return { ok: true, agentId: agent._id };
  },
});

/** Deletes every source and the profile. Spawned avatars stay as ordinary colonists. */
export const forget = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<AvatarResult> => {
    const session = await getSession(ctx, sessionToken);
    if (!session) return fail('This session is not recognised.');
    for (const s of await sourcesOf(ctx, session._id)) await ctx.db.delete(s._id);
    const persona = await personaOf(ctx, session._id);
    if (persona) await ctx.db.delete(persona._id);
    const owned = await ctx.db
      .query('agents')
      .withIndex('by_owner', (q) => q.eq('ownerSessionId', session._id))
      .collect();
    for (const a of owned) {
      const world = await ctx.db.get(a.worldId);
      if (!world) continue;
      const tx = beginTx(ctx, world);
      const agent = (await loadAgent(tx, a._id))!;
      agent.ownerSessionId = undefined;
      agent.ownerName = undefined;
      touch(tx, agent);
      const mind = await loadMind(tx, agent);
      if (mind) {
        mind.avatarPersona = undefined;
        mind.directive = undefined;
        touchMind(tx, mind);
      }
      await commitTx(tx);
    }
    return { ok: true };
  },
});

