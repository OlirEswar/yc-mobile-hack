/**
 * The society already in motion at Sol 1: six smaller organizations (the three factions are not
 * organizations), a famous artist and striving ones with existing works, pets, couples and their
 * children (one about to come of age), the basics already discovered and research under way.
 * The seed owner calls seedSociety(ctx, worldId, agentIds) at the end of seedWorld.
 */
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { SPRITE_VARIANTS } from '../../shared/colony';
import { CHILD_NAMES, DISCOVERIES, ORG_KINDS } from '../../shared/society';
import { clamp, round2, sequence } from '../lib/rng';
import { adjustRelationship, beginTx, commitTx, loadAgent, loadHousehold, loadMind, touch, touchMind } from '../engine/core';
import type { AgentDoc, MindDoc } from '../engine/core';
import { insertPerson, marry } from './family';
import { insertOrg, loadMeta, saveMeta, societyOf } from './store';

type P = { a: AgentDoc; mind: MindDoc };
const DAY = 144;

export type SeedSocietyOptions = {
  /** Insert the three seeded children (raises the population above 100). Defaults to true. */
  children?: boolean;
};

export async function seedSociety(ctx: MutationCtx, worldId: Id<'worlds'>, agentIds: Id<'agents'>[], options: SeedSocietyOptions = {}): Promise<void> {
  const world = await ctx.db.get(worldId);
  if (!world) return;
  if (await ctx.db.query('organizations').withIndex('by_world_status', (q) => q.eq('worldId', worldId).eq('status', 'active')).first()) return;
  const tx = beginTx(ctx, world);
  const next = sequence(world.seed ^ 0x50c1e7);
  const people: P[] = [];
  for (const id of agentIds) {
    const a = await loadAgent(tx, id);
    const mind = a ? await loadMind(tx, a) : null;
    if (a?.alive && mind) {
      societyOf(tx, a, mind);
      people.push({ a, mind });
    }
  }
  const meta = await loadMeta(tx);
  const used = new Set<string>();
  const best = (filter: (p: P) => boolean, score: (p: P) => number, take = 1): P[] => {
    const out = people.filter((p) => !used.has(p.a._id) && filter(p)).sort((x, y) => score(y) - score(x)).slice(0, take);
    for (const p of out) used.add(p.a._id);
    return out;
  };
  const adult = (p: P) => p.mind.ageBand !== 'child';
  const t = (p: P) => p.a.traits;

  // ----- artists and their works -----
  const [star] = best((p) => adult(p) && !p.a.role && p.mind.ageBand !== 'elder', (p) => t(p).sociability + t(p).curiosity + (p.a.occupation === 'cook' || p.a.occupation === 'resident' ? 0.4 : 0));
  const strivers = best((p) => adult(p) && !p.a.role, (p) => t(p).curiosity * 0.7 + t(p).sociability * 0.3 + next() * 0.4, 3);
  const works: { by: P; title: string; kind: string; about: string; quality: number; fame: number; loc?: string; ago: number }[] = [];
  if (star) {
    star.mind.skills.art = 84;
    star.mind.society!.fame = 0.75;
    star.mind.society!.status = round2(clamp(star.mind.society!.status + 18, 0, 100));
    works.push(
      { by: star, title: 'The Long Dark', kind: 'mural', about: 'A mural of the winter the reactor failed: eleven figures walking into the dark, the dome lights going out one by one.', quality: 0.91, fame: 0.82, loc: 'canteen', ago: 900 },
      { by: star, title: 'Eleven Lamps', kind: 'song', about: 'A song for the eleven dead of the Long Dark, sung at every memorial since.', quality: 0.86, fame: 0.7, ago: 600 },
      { by: star, title: 'Ice Daughters', kind: 'play', about: 'A play about two sisters who work the ice wells and love the same man.', quality: 0.7, fame: 0.38, ago: 140 },
    );
  }
  const striverWorks = [
    { title: 'Rack Light', kind: 'poem', about: 'A poem about the purple light of the grow racks at night.' },
    { title: 'Quarry Blues', kind: 'song', about: 'A song about dust in the lungs and credits that never add up.' },
    { title: "My Mother's Hands", kind: 'mural', about: 'A small mural of a mother mending a suit glove.', loc: 'habitat_b' },
  ];
  strivers.forEach((p, i) => {
    p.mind.skills.art = 34 + Math.round(next() * 16);
    p.mind.society!.fame = round2(0.04 + next() * 0.1);
    works.push({ by: p, ...striverWorks[i], quality: round2(0.35 + next() * 0.2), fame: round2(0.03 + next() * 0.08), ago: 20 + Math.round(next() * 60) });
  });
  for (const w of works) {
    await ctx.db.insert('works', { worldId, creatorId: w.by.a._id, title: w.title, kind: w.kind, about: w.about, quality: w.quality, fame: w.fame, locationId: w.loc, createdTick: -w.ago * DAY / 10 });
    touchMind(tx, w.by.mind);
  }

  // ----- organizations -----
  const org = async (kind: string, name: string, creed: string, leader: P | undefined, members: P[], treasury: number, extra: Record<string, unknown> = {}, ageDays = 200) => {
    if (!leader) return null;
    const all = [leader, ...members.filter((m) => m !== leader)];
    const o = await insertOrg(tx, {
      worldId,
      key: kind + '-seed',
      name,
      kind,
      creed,
      founderId: leader.a._id,
      leaderId: leader.a._id,
      officerIds: members.slice(0, 1).map((m) => m.a._id),
      memberIds: all.map((p) => p.a._id),
      treasury,
      reputation: kind === 'gang' ? -0.25 : kind === 'school' ? 0.35 : 0.05,
      status: 'active',
      foundedTick: -ageDays * DAY,
      rivalIds: [],
      state: { home: extra.home ?? ORG_KINDS[kind].home, ...extra },
    });
    for (const p of all) {
      p.mind.society!.orgIds.push(o._id);
      p.mind.society!.status = round2(clamp(p.mind.society!.status + (p === leader ? 8 : 1), 0, 100));
      touchMind(tx, p.mind);
    }
    return o;
  };
  const miners = (p: P) => p.a.occupation === 'ice_miner' || p.a.occupation === 'quarry_hand';
  const [boss] = best((p) => adult(p) && p.a.occupation === 'ice_miner' && !p.a.role, (p) => t(p).ambition + p.a.skill / 100);
  const company = await org('company', 'Deepcut Ice Co.', 'Better tools, better pay, no council middlemen.', boss, best((p) => adult(p) && miners(p) && !p.a.role, (p) => p.mind.values.wealth + next() * 0.3, 3), 260, { home: 'ice_wells' }, 120);
  const [grower] = best((p) => p.a.occupation === 'hydroponicist', (p) => p.a.skill / 100 + t(p).empathy);
  await org('guild', "The Green Ring Growers' Guild", 'No grower goes hungry while a rack stands.', grower, best((p) => p.a.occupation === 'hydroponicist' || p.a.occupation === 'cook', (p) => t(p).empathy + next() * 0.3, 4), 80, { home: 'hydroponics', stores: { food: 10, water: 6 } }, 900);
  const [prophet] = best((p) => adult(p) && !p.a.role && (p.mind.ageBand === 'elder' || p.a.occupation === 'resident' || p.a.occupation === 'cook'), (p) => t(p).sociability + t(p).stubbornness);
  const cult = await org('cult', 'The Vigil of the Long Dark', 'The eleven who died in the Long Dark are still watching, and they are owed.', prophet, best((p) => adult(p) && !p.a.role, (p) => (1 - t(p).caution) * 0.5 + t(p).curiosity * 0.3 + (p.mind.ageBand === 'elder' ? 0.3 : 0) + next() * 0.2, 3), 40, { home: 'habitat_a' }, 600);
  const [crewBoss] = best((p) => adult(p) && !p.a.role && ['dock_hand', 'trader', 'hauler', 'resident'].includes(p.a.occupation), (p) => (1 - t(p).empathy) + t(p).ambition);
  const gang = await org('gang', 'The Pad Rats', 'Take care of your own; the council never will.', crewBoss, best((p) => adult(p) && !p.a.role && p.a.traits.empathy < 0.5 && p.mind.ageBand !== 'elder', (p) => 1 - t(p).empathy + next() * 0.2, 2), 30, { home: 'landing_pad', stores: { food: 3, water: 4 } }, 300);
  await org('troupe', 'The Airlock Players', 'Laugh, or the dark wins.', star, [...strivers.slice(0, 2), ...best((p) => adult(p) && t(p).sociability > 0.6, (p) => t(p).sociability, 1)], 25, { home: 'canteen' }, 700);
  const [teacher] = best((p) => p.a.occupation === 'researcher', (p) => p.a.skill / 100 + t(p).empathy);
  const students = best((p) => p.mind.ageBand === 'young', (p) => t(p).curiosity, 3);
  const school = await org('school', 'The Observatory School', 'Every child should know how the colony works.', teacher, students, 50, { home: 'observatory' }, 1500);
  if (gang && company) {
    gang.rivalIds.push(company._id);
    company.rivalIds.push(gang._id);
    await ctx.db.patch(gang._id, { rivalIds: gang.rivalIds });
    await ctx.db.patch(company._id, { rivalIds: company.rivalIds });
  }
  if (cult && school) {
    cult.rivalIds.push(school._id);
    await ctx.db.patch(cult._id, { rivalIds: cult.rivalIds });
  }

  // ----- couples, their children, a pregnancy -----
  const households = await ctx.db.query('households').withIndex('by_world', (q) => q.eq('worldId', worldId)).collect();
  const couples: [P, P][] = [];
  for (const h of households) {
    if (couples.length >= 6 || !/household$/.test(h.name) || h.memberIds.length < 3) continue;
    const members = h.memberIds.map((id) => people.find((p) => p.a._id === id)).filter((p): p is P => !!p);
    const grownups = members.filter((p) => p.mind.ageBand === 'adult');
    if (grownups.length < 2) continue;
    const [x, y] = grownups;
    await marry(tx, x.a, x.mind, y.a, y.mind, { quiet: true });
    couples.push([x, y]);
    for (const kid of members.filter((p) => p.mind.ageBand === 'young')) {
      kid.mind.society!.parentIds.push(x.a._id, y.a._id);
      x.mind.society!.childIds.push(kid.a._id);
      y.mind.society!.childIds.push(kid.a._id);
      touchMind(tx, kid.mind);
    }
  }
  if (options.children !== false) {
    const ages = [2.4 * DAY, 1.3 * DAY, 0.3 * DAY];
    for (const [i, [x, y]] of couples.slice(0, 3).entries()) {
      const r = () => next();
      const blend = (u: number, v: number) => round2(clamp((u + v) / 2 + (r() - 0.5) * 0.3, 0.02, 0.98));
      const traits = {} as AgentDoc['traits'];
      for (const k of Object.keys(x.a.traits) as (keyof AgentDoc['traits'])[]) traits[k] = blend(x.a.traits[k], y.a.traits[k]);
      const values = {} as MindDoc['values'];
      for (const k of Object.keys(x.mind.values) as (keyof MindDoc['values'])[]) values[k] = blend(x.mind.values[k], y.mind.values[k]);
      const first = CHILD_NAMES[(i * 7 + Math.floor(r() * 5)) % CHILD_NAMES.length];
      const name = first + ' ' + x.a.name.split(' ').slice(-1)[0];
      const age = ages[i];
      const { a: child } = await insertPerson(tx, {
        name,
        spriteId: 'civilian_' + Math.floor(r() * SPRITE_VARIANTS),
        ageBand: 'child',
        occupation: 'resident',
        homeLocationId: x.a.homeLocationId,
        locationId: x.a.homeLocationId,
        householdId: x.a.householdId,
        traits,
        values,
        skills: { craft: 8 + Math.round(age / DAY * 3), persuasion: 12, science: Math.round(traits.curiosity * 15) },
        background: 'Born in the colony to ' + x.a.name + ' and ' + y.a.name + '.',
        persona: { epithet: 'the child of ' + x.a.name.split(' ')[0] + ' and ' + y.a.name.split(' ')[0], want: 'to go out on the surface like the grown-ups', need: 'to be taken seriously', fear: 'the Long Dark stories', flaw: 'never stops asking why', voice: 'Talks fast, asks everything, repeats what the grown-ups say.', strategies: ['beg', 'charm'], arc: { stage: 'setup', note: 'A colony child on the edge of growing up.' }, key: false },
        dayOffset: x.a.dayOffset,
        parentIds: [x.a._id, y.a._id],
        bornTick: -Math.round(age),
        mood: 'content',
        activity: 'sleeping',
        activityLabel: 'Asleep at home',
      });
      child.busyUntilTick = 1 + (child.seq % 5);
      touch(tx, child);
      for (const parent of [x, y]) {
        parent.mind.society!.childIds.push(child._id);
        touchMind(tx, parent.mind);
        await adjustRelationship(tx, parent.a, child, { affinity: 0.85, trust: 0.7, kind: 'family' });
        await adjustRelationship(tx, child, parent.a, { affinity: 0.8, trust: 0.8, kind: 'family' });
      }
      meta.children.push(child._id);
    }
  }
  const expecting = couples[3] ?? couples[0];
  if (expecting) meta.pregnancies.push({ carrierId: expecting[0].a._id, partnerId: expecting[1].a._id, dueTick: Math.round(0.9 * DAY) });

  // ----- pets -----
  const petDefs = [
    { name: 'Biscuit', species: 'cat' },
    { name: 'Regolith', species: 'dog' },
    { name: 'Subject Nine', species: 'lab_rat', job: 'researcher' },
    { name: 'Sticky', species: 'gecko' },
    { name: 'Mooncake', species: 'cat' },
  ];
  const owners = new Set<string>();
  for (const def of petDefs) {
    const owner = people.filter((p) => adult(p) && !owners.has(p.a._id) && (!def.job || p.a.occupation === def.job)).sort((x, y) => t(y).empathy + y.mind.values.family * 0.5 - t(x).empathy - x.mind.values.family * 0.5)[0];
    if (!owner) continue;
    owners.add(owner.a._id);
    const id = await ctx.db.insert('pets', { worldId, ownerId: owner.a._id, name: def.name, species: def.species, alive: true, bornTick: -Math.round((2 + next() * 8) * DAY), bond: round2(0.5 + next() * 0.4) });
    meta.pets.push(id);
  }

  // ----- knowledge -----
  const known = [
    { key: 'nutrient_film', who: grower },
    { key: 'sintered_tools', who: people.find((p) => p.a.occupation === 'fabricator') },
    { key: 'regolith_lung_treatment', who: people.find((p) => p.a.occupation === 'medic') },
    { key: 'ration_ledgers', who: people.find((p) => p.a.occupation === 'quartermaster') },
  ];
  for (const k of known) {
    meta.discovered.push(k.key);
    await ctx.db.insert('discoveries', { worldId, key: k.key, tick: -Math.round((20 + next() * 300) * DAY), discovererIds: k.who ? [k.who.a._id] : [] });
  }
  for (const d of DISCOVERIES.filter((x) => x.tier === 0)) await ctx.db.insert('discoveries', { worldId, key: d.key, tick: -19 * 365 * DAY / 10, discovererIds: [] });
  const research = [
    { key: 'thermal_drill_bits', progress: 6.5, by: [boss, ...people.filter((p) => p.a.occupation === 'ice_miner').slice(0, 1)] },
    { key: 'regolith_pigment', progress: 5, by: [star] },
    { key: 'fungal_protein', progress: 4, by: [grower] },
    { key: 'basalt_fiber', progress: 3, by: people.filter((p) => p.a.occupation === 'fabricator').slice(0, 2) },
    { key: 'apprenticeship', progress: 7, by: [teacher] },
  ];
  for (const r of research) await ctx.db.insert('research', { worldId, key: r.key, progress: r.progress, contributorIds: r.by.filter((p): p is P => !!p).map((p) => p.a._id) });

  // ----- landmarks -----
  const wallId = await ctx.db.insert('structures', { worldId, key: 'memorial_wall', name: 'memorial wall for the eleven', locationId: 'plaza', builderIds: prophet ? [prophet.a._id] : [], ownerOrgId: cult?._id, progress: 1, builtTick: -1200 * DAY / 10 });
  meta.built.push({ id: wallId, key: 'memorial_wall', loc: 'plaza', ownerId: prophet?.a._id, orgId: cult?._id });
  if (grower) {
    const home = (await loadHousehold(tx, grower.a.householdId))?.homeLocationId ?? 'habitat_a';
    const rackId = await ctx.db.insert('structures', { worldId, key: 'grow_rack', name: 'private grow rack', locationId: home, builderIds: [grower.a._id], progress: 1, builtTick: -30 * DAY });
    meta.built.push({ id: rackId, key: 'grow_rack', loc: home, ownerId: grower.a._id });
  }
  meta.nextEventTick = 4 * 6;
  await saveMeta(tx);
  await commitTx(tx);
}

