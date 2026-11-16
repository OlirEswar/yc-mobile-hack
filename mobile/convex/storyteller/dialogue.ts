/**
 * Real conversations for the followed colonist and the people around them: a 4 to 8 line exchange
 * between two colonists, written by rules at once and by the LLM when it answers, revealed one line
 * per tick on AgentLite.speech while both stay in place, and ending in an outcome the engine applies.
 */
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { TICKS_PER_DAY } from '../../shared/colony';
import { hash32 } from '../lib/rng';
import { adjustRelationship, emitEvent, encodeStep, enqueueCognition, heldBeliefs, interrupt, learnBelief, loadAgent, loadMind, tieTo, touch } from '../engine/core';
import type { AgentDoc, Tx } from '../engine/core';
import { debtsTo } from '../engine/ledger';
import { providerConfig } from '../cognition/provider';

export const DIALOGUE_STEPS = new Set(['talk', 'confide', 'court', 'comfort', 'threaten', 'intimidate', 'accuse', 'barter', 'bribe', 'blackmail', 'beg', 'borrow', 'repay', 'reconcile', 'recruit', 'extort', 'kiss', 'lie', 'help', 'give', 'gamble', 'carouse']);
export const OUTCOMES = ['warmer', 'colder', 'promise', 'secret', 'fight', 'refusal', 'none'] as const;
export type Outcome = (typeof OUTCOMES)[number];
type Line = { speakerId: Id<'agents'>; text: string };

const first = (name: string): string => name.split(' ')[0];
const pick = <T,>(items: T[], salt: number): T => items[(salt >>> 0) % items.length];

export async function liveDialogues(tx: Tx): Promise<Doc<'dialogues'>[]> {
  return await tx.ctx.db.query('dialogues').withIndex('by_world_live', (q) => q.eq('worldId', tx.world._id).eq('live', true)).take(80);
}

export async function inDialogue(tx: Tx, id: Id<'agents'>): Promise<boolean> {
  return (await liveDialogues(tx)).some((d) => d.aId === id || d.bId === id);
}

/** The rules version: specific to the kind of exchange and what lies between them. */
async function ruleLines(tx: Tx, a: AgentDoc, b: AgentDoc, kind: string): Promise<{ lines: Line[]; outcome: Outcome }> {
  const s = hash32(a.seq, b.seq, tx.tick);
  const A = (text: string): Line => ({ speakerId: a._id, text });
  const B = (text: string): Line => ({ speakerId: b._id, text });
  const an = first(a.name);
  const bn = first(b.name);
  const ab = await tieTo(tx, a._id, b._id);
  const ba = await tieTo(tx, b._id, a._id);
  const owesA = debtsTo(await loadMind(tx, b), a._id)[0];
  const news = (await heldBeliefs(tx, a._id)).filter((x) => x.subjectAgentId && x.subjectAgentId !== b._id && x.confidence >= 0.4).sort((x, y) => y.lastReinforcedTick - x.lastReinforcedTick)[0];
  const warm = (ba?.affinity ?? 0) > 0.25;
  const hostile = ['threaten', 'intimidate', 'accuse', 'extort', 'blackmail'].includes(kind);
  if (hostile) {
    const why = owesA ? 'the ' + owesA.res + ' you owe me' : kind === 'blackmail' ? 'what I know about you' : kind === 'extort' ? 'what this corner costs' : kind === 'accuse' ? 'what you did' : 'the way you have been talking about me';
    const gives = b.traits.caution > 0.55 && !warm;
    return {
      outcome: gives ? 'refusal' : b.traits.stubbornness > 0.6 ? 'fight' : 'colder',
      lines: [
        A(pick(['We need to talk about ' + why + ', ' + bn + '. Now, not later.', bn + '. Sit down. We are going to settle ' + why + '.', 'Do not walk away from me, ' + bn + '. Not this time.'], s)),
        B(pick(['I have nothing to say to you, ' + an + '. You know that.', 'Keep your voice down. People are watching us.', 'You have got some nerve, coming at me here.'], s >> 3)),
        A(pick(['Then just listen. I have been patient, and patience is running out on this rock.', 'I remember the Long Dark too. I remember who helped and who hid. You hid.', 'Everybody up here owes somebody. Today you owe me.'], s >> 5)),
        B(gives ? pick(['Fine. Fine. You will get what you want. Just stay away from my family.', 'All right. But this is the last time, ' + an + '. I swear it.'], s >> 7) : pick(['Try it. See how many friends you have left by supper.', 'You think I am scared of you? I have buried better people than you.'], s >> 7)),
        A(gives ? 'Good. See how easy that was? Nobody has to know.' : 'Remember you said that. Remember it when it comes back to you.'),
        ...(gives ? [] : [B(pick(['Get out of my sight.', 'We will see whose story they believe.'], s >> 9))]),
      ],
    };
  }
  if (['court', 'kiss', 'comfort', 'confide', 'reconcile'].includes(kind)) {
    const tender = kind === 'comfort' ? 'grief' : kind === 'reconcile' ? 'sorry' : kind === 'confide' ? 'secret' : 'love';
    const lines =
      tender === 'love'
        ? [A(pick(['You stayed late again. I was hoping you would.', 'Can I tell you something stupid?', 'I keep finding reasons to walk past your door, ' + bn + '.'], s)), B(pick(['You are terrible at pretending this is an accident.', 'Only if it is the kind of stupid that makes me laugh.', 'I noticed. I was starting to hope you would say something.'], s)), A('When the lights flicker at night, you are the first thing I think of. That has to mean something.'), B(warm ? pick(['It means something. Come here before I lose my nerve.', 'Then stop thinking and stay a while.'], s >> 5) : pick(['It might. But not here, and not yet.', 'I like you, ' + an + '. I just do not trust anyone up here.'], s >> 5)), ...(warm ? [A('I am not going anywhere.')] : [A('Then I will wait. I am good at waiting.')])]
        : tender === 'grief'
          ? [A('Hey. I heard. I am so sorry, ' + bn + '.'), B(pick(['Everyone keeps saying that. Nobody knows what to do with their hands.', 'I keep turning to tell them something, and they are not there.'], s)), A('You do not have to be strong in front of me. I was there in the Long Dark. I know what it does to you.'), B(pick(['I keep thinking I should have done something.', 'Just sit with me a bit. Do not say anything clever.'], s >> 3)), A('As long as you need. I am not going anywhere.')]
          : tender === 'secret'
            ? [A(pick(['Can I trust you with something? Really trust you?', 'I need to tell someone or I am going to crack.'], s)), B('You know you can. What is going on?'), A(news ? 'It is about ' + (news.subjectName ?? 'someone') + '. ' + news.text + ' I have not told anyone else.' : 'I have been doing things I am not proud of to keep my household fed. If the council finds out, I am finished.'), B(pick(['That stays between us. I swear on the eleven lamps.', 'God. All right. Then we are in this together now.'], s >> 3)), A('Thank you. I did not know how much I needed to say that out loud.')]
            : [A(pick(['I said things I should not have, ' + bn + '. I am sorry.', 'I hate this. I hate that we stopped talking.'], s)), B(pick(['You hurt me, ' + an + '. You know that.', 'Took you long enough.'], s >> 3)), A('I know. I am not asking you to forget it. Just let me start fixing it.'), B(warm || b.traits.empathy > 0.5 ? 'All right. One more chance. Do not waste it.' : 'Words are cheap up here. Show me.')];
    return { outcome: kind === 'confide' ? 'secret' : warm || b.traits.empathy > 0.5 ? 'warmer' : 'refusal', lines };
  }
  if (['borrow', 'beg', 'repay', 'bribe', 'barter', 'give', 'help'].includes(kind)) {
    const repay = kind === 'repay';
    return {
      outcome: repay || warm ? 'promise' : 'refusal',
      lines: repay
        ? [A('Here. Every credit of it. I told you I was good for it.'), B(pick(['I was starting to think I would have to come looking for you.', 'Huh. Honestly, I did not think I would see it again.'], s)), A('I do not like owing people. Not up here. Not after what debts did to my family.'), B('Then we are square. And for what it is worth, ' + an + ', thank you.')]
        : [A(pick(['I would not ask if I had any other choice, ' + bn + '.', 'I need help. I am not proud of it.'], s)), B(pick(['How bad is it?', 'Everyone needs help this month. What makes you special?'], s >> 3)), A('The pantry is empty and the ration line keeps getting shorter. I will pay you back. I swear it on my household.'), B(warm ? pick(['All right. But I am writing it down, and I will remember.', 'Take it. Pay me back when the wells come back.'], s >> 5) : pick(['I have heard that before. From you, actually.', 'Ask the council. That is what they are for, supposedly.'], s >> 5)), ...(warm ? [A('You will not regret it.')] : [A('Right. I will remember this too.')])],
    };
  }
  if (kind === 'recruit') {
    return {
      outcome: warm ? 'promise' : 'refusal',
      lines: [A('You feel it too, do you not? Something is wrong with this colony.'), B('Everybody feels it. Not everybody wants to join something because of it.'), A('We look after our own. Food when the depot is empty, people at your back when it goes bad. You would not be alone anymore.'), B(warm ? 'And what do you want from me in return?' : 'I have seen what your people do at night, ' + an + '.'), A(warm ? 'Loyalty. That is all. Come to the next gathering.' : 'Then you have seen who is still standing in the morning.'), B(warm ? 'Maybe. I will think about it.' : 'I will take my chances on my own.')],
    };
  }
  // gossip and talk
  const topic = news ? news.text.replace(/[.!]$/, '') : undefined;
  return {
    outcome: topic && (news?.valence ?? 0) < 0 ? 'secret' : 'warmer',
    lines: [
      A(pick(['There you are. You look like you have not slept, ' + bn + '.', bn + '! Sit, sit. You will not believe what I heard.', 'Got a minute? I need someone sane to talk to.'], s)),
      B(pick(['Sleep? Up here? Tell me what is going on.', 'I have nothing but minutes. Go on.', 'Sane is a stretch. But fine.'], s)),
      A(topic ? 'You know what people are saying? ' + topic + '. And I think it is true.' : pick(['The ration line was a war this morning. Somebody is going to get hurt soon.', 'Nobody talks about the Long Dark anymore, but everyone is acting like it is coming back.'], s >> 5)),
      B(topic ? pick(['Keep your voice down. If that gets around, someone is going to do something about it.', 'I do not believe it. Not unless I see it myself.', 'I knew it. I knew something was off.'], s >> 7) : pick(['Then we stick together. You and me.', 'You worry too much. That is why I like you.'], s >> 7)),
      A(pick(['I am only telling you. Promise me.', 'Just watch your back. That is all I am saying.', 'Something is coming. I can feel it in the walls.'], s >> 9)),
      B(pick(['I promise. Now get me a cup before I change my mind.', 'I always do.', 'Then we had better be ready for it.'], s >> 11)),
    ],
  };
}

/** Ticks a conversation waits for the model's words before falling back on the rules version. */
const HOLD_TICKS = 3;

/** True when the model is able to write conversations right now. */
export function modelWrites(tx: Tx): boolean {
  const llm = tx.world.llm;
  return providerConfig() !== null && llm.enabled && !((llm.disabledUntil ?? 0) > Date.now());
}

/** Starts a conversation for an interaction step that touches the followed colonist or their orbit. Returns its length in ticks, or 0. */
export async function startDialogue(tx: Tx, a: AgentDoc, kind: string): Promise<number> {
  if (!DIALOGUE_STEPS.has(kind) || !a.interactingWithId) return 0;
  const focus = tx.world.focusAgentId;
  const orbit = tx.world.orbitIds ?? [];
  const b = await loadAgent(tx, a.interactingWithId);
  if (!b?.alive || b.move || b.activity === 'sleeping' || b.locationId !== a.locationId) return 0;
  // The followed colonist's circle always talks in full; everyone else does whenever the model can write it.
  const close = a._id === focus || b._id === focus || (orbit.includes(a._id) && orbit.includes(b._id));
  const watched = close || orbit.includes(a._id) || orbit.includes(b._id);
  if (!close && !modelWrites(tx)) return 0;
  const live = await liveDialogues(tx);
  if (live.some((d) => [d.aId, d.bId].some((id) => id === a._id || id === b._id))) return 0;
  const { lines, outcome } = await ruleLines(tx, a, b, kind);
  // While the model can answer, nobody says a canned line: they hold a beat until the real words arrive.
  const thinking = modelWrites(tx);
  const id = await tx.ctx.db.insert('dialogues', { worldId: tx.world._id, live: true, aId: a._id, bId: b._id, aName: a.name, bName: b.name, kind, lines, shown: thinking ? 0 : 1, startTick: tx.tick, source: 'rules', outcome, applied: false });
  a.speech = thinking ? undefined : lines[0].text;
  b.speech = undefined;
  b.interactingWithId = a._id;
  b.activity = 'talking';
  b.activityLabel = 'Talking with ' + a.name;
  const end = tx.tick + lines.length + 1 + (thinking ? HOLD_TICKS : 0);
  if (b.cur && !b.cur.startsWith('talk|')) b.q = [b.cur, ...b.q].slice(0, 24);
  b.cur = encodeStep('talk', a._id);
  b.curStartTick = tx.tick;
  b.busyUntilTick = Math.max(b.busyUntilTick, end);
  touch(tx, b);
  touch(tx, a);
  const llm = tx.world.llm;
  const mind = await loadMind(tx, a);
  if (llm.enabled && mind && !((llm.disabledUntil ?? 0) > Date.now())) {
    await tx.ctx.db.insert('cognitionJobs', { worldId: tx.world._id, agentId: a._id, kind: 'dialogue', trigger: kind, detail: id, priority: 0.92, status: 'queued', lane: a._id === focus || b._id === focus ? 'focus' : watched ? 'orbit' : 'normal', enqueuedTick: tx.tick, mindVersion: mind.stateVersion, attempts: 0 });
    llm.queued += 1;
    await tx.ctx.scheduler.runAfter(0, internal.cognition.drain, { worldId: tx.world._id });
  }
  return lines.length + 1 + (thinking ? HOLD_TICKS : 0);
}

async function applyOutcome(tx: Tx, d: Doc<'dialogues'>, a: AgentDoc, b: AgentDoc): Promise<void> {
  const o = (d.outcome ?? 'none') as Outcome;
  const both = async (delta: { affinity?: number; trust?: number; fear?: number }) => {
    await adjustRelationship(tx, a, b, delta);
    await adjustRelationship(tx, b, a, delta);
  };
  if (o === 'warmer') await both({ affinity: 0.12, trust: 0.08 });
  if (o === 'promise') await both({ trust: 0.15, affinity: 0.05 });
  if (o === 'colder' || o === 'refusal') await both({ affinity: -0.12, trust: -0.1 });
  if (o === 'secret') {
    await both({ trust: 0.12 });
    await learnBelief(tx, b, { kind: 'custom', text: first(a.name) + ' told me: ' + (d.summary ?? d.lines[2]?.text ?? 'something they swore me to keep'), valence: 0, confidence: 0.7, sourceType: 'told', subjectAgentId: a._id, subjectName: a.name, sourceAgentId: a._id, sourceName: a.name, private: true });
  }
  if (o === 'fight' && a.alive && b.alive && a.locationId === b.locationId) {
    await both({ affinity: -0.2 });
    interrupt(tx, a, [encodeStep('fight', b._id)]);
  }
  const last = d.lines[d.lines.length - 1];
  await emitEvent(tx, {
    category: 'social',
    eventType: o === 'fight' ? 'argument' : 'dialogue',
    actorId: a._id,
    participantIds: [b._id],
    locationId: a.locationId,
    summary: d.summary ?? first(a.name) + ' and ' + first(b.name) + ' talked it out' + (o === 'fight' ? ', and it ended in fists.' : o === 'refusal' ? '; ' + first(b.name) + ' said no.' : o === 'promise' ? ' and came to an understanding.' : o === 'colder' ? ', and it left things worse.' : '.') + (last ? ' Last word: "' + last.text + '"' : ''),
    salience: o === 'fight' ? 0.6 : o === 'secret' || o === 'promise' ? 0.45 : 0.35,
    visibility: 'local',
  });
  // What was said changes what both of them do next: each thinks again with the conversation fresh.
  const said = d.summary ?? (last ? first(d.lines.length % 2 === 0 ? b.name : a.name) + ' said: "' + last.text + '"' : undefined);
  for (const [x, y] of [[b, a], [a, b]] as const) {
    if (!x.alive || (o === 'fight' && x === a)) continue;
    const near = tx.world.focusAgentId === x._id ? 'focus' : o !== 'none' && o !== 'warmer' ? 'crisis' : tx.world.orbitIds?.includes(x._id) ? 'orbit' : 'normal';
    await enqueueCognition(tx, x, { kind: 'plan', trigger: 'just talked with ' + y.name + ' and it ended ' + (o === 'none' ? 'unresolved' : o === 'warmer' ? 'warmly' : o === 'colder' ? 'badly' : o === 'promise' ? 'in a promise' : o === 'secret' ? 'with a secret shared' : o === 'refusal' ? 'in a refusal' : 'in a fight'), detail: said, priority: 0.7, lane: near });
  }
}

/** Reveals the next line of every live conversation; ends the ones that are over or broken off. */
export async function dialogueTick(tx: Tx): Promise<void> {
  for (const d of await liveDialogues(tx)) {
    const a = await loadAgent(tx, d.aId);
    const b = await loadAgent(tx, d.bId);
    const together = !!a?.alive && !!b?.alive && !a.move && !b.move && a.locationId === b.locationId;
    if (!a || !b || !together || d.shown >= d.lines.length || tx.tick - d.startTick > 20) {
      if (a && b && together && !d.applied) await applyOutcome(tx, d, a, b);
      await tx.ctx.db.patch(d._id, { live: false, applied: true });
      continue;
    }
    if (d.source === 'rules' && d.shown === 0 && tx.tick - d.startTick < HOLD_TICKS && modelWrites(tx)) continue;
    const line = d.lines[d.shown];
    const speaker = line.speakerId === a._id ? a : b;
    const listener = speaker === a ? b : a;
    speaker.speech = line.text;
    speaker.interactingWithId = listener._id;
    listener.speech = undefined;
    listener.interactingWithId = speaker._id;
    const end = tx.tick + (d.lines.length - d.shown) + 1;
    for (const x of [a, b]) {
      if (x.busyUntilTick < end) x.busyUntilTick = end;
      touch(tx, x);
    }
    await tx.ctx.db.patch(d._id, { shown: d.shown + 1 });
  }
}

/** The LLM's version arrives: it replaces the rules lines if little has been said yet, and its outcome stands. */
export async function commitDialogue(tx: Tx, dialogueId: Id<'dialogues'>, out: { lines: { speaker: string; text: string }[]; outcome: string; summary?: string }): Promise<string | null> {
  const d = await tx.ctx.db.get(dialogueId);
  if (!d) return 'dialogue gone';
  const lines = out.lines.map((l) => ({ speakerId: l.speaker === 'A' ? d.aId : d.bId, text: l.text }));
  if (!d.live || d.applied || d.shown > 3) {
    await tx.ctx.db.patch(d._id, { lines, source: 'llm', summary: out.summary, shown: lines.length });
    return 'arrived after the conversation; stored';
  }
  await tx.ctx.db.patch(d._id, { lines, source: 'llm', outcome: out.outcome, summary: out.summary, shown: 0, startTick: tx.tick });
  return null;
}

/** The newest conversations of a colonist, as the follow view shows them (live ones only as far as they have got). */
export async function recentDialogues(db: QueryCtx['db'], agentId: Id<'agents'>): Promise<{ withId: string; withName: string; lines: { speakerId: string; text: string }[]; tick: number }[]> {
  const rows = [
    ...(await db.query('dialogues').withIndex('by_a', (q) => q.eq('aId', agentId)).order('desc').take(3)),
    ...(await db.query('dialogues').withIndex('by_b', (q) => q.eq('bId', agentId)).order('desc').take(3)),
  ];
  return rows
    .sort((x, y) => y.startTick - x.startTick)
    .slice(0, 3)
    .map((d) => {
      const mine = d.aId === agentId;
      return { withId: mine ? d.bId : d.aId, withName: mine ? d.bName : d.aName, lines: d.lines.slice(0, d.live ? d.shown : d.lines.length), tick: d.startTick };
    });
}

export const DIALOGUE_STALE_TICKS = 4;
export const DIALOGUE_DAY = TICKS_PER_DAY;
