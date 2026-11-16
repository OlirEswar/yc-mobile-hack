/**
 * The society layer's options for the planner. Each is scored on the planner's scale (about 0.3
 * routine, 0.6 a real want, 1+ urgent or obsessive) from persona, traits, status, organizations,
 * family and free time, so people visibly found things, study, build, make art, court and scheme.
 */
import type { Doc } from '../_generated/dataModel';
import { STRUCTURE_BY_KEY, ORG_KINDS } from '../../shared/society';
import type { StructureDef } from '../../shared/society';
import { clamp } from '../lib/rng';
import { PRIMARY_SKILL } from '../seed/build';
import { firstName, isLocation, locName, personalTick, stormAt } from '../engine/conditions';
import { encodeStep, loadAgent, loadMind, tiesOf } from '../engine/core';
import type { AgentDoc, MindDoc, StepType, Tx } from '../engine/core';
import { ACCUSABLE } from '../engine/social';
import { availableDiscoveries, canBuildHere } from './craft';
import { isArtist } from './culture';
import type { SocietyChoice } from './hooks';
import { obsessionChoice } from './obsession';
import { canFound, foundingDesire, kindAffinity, orgHome, orgState, orgsOf } from './orgs';
import { DAY, INFANT_TICKS, activeOrgs, cacheOf, loadMeta, roll, societyOf } from './store';
import { jobWanted, skillLabel } from './work';

const SHIFT_START = 12;
const LUNCH = [36, 42];
const SHIFT_END = 66;
/** Free-time pursuits yield a little to plain company, more so the lonelier someone is: talk is how news travels. */
const PASTIME_DAMP = 0.08;

class Steps {
  steps: string[] = [];
  labels: string[] = [];
  constructor(private tx: Tx, public loc: string, private news?: string) {}
  go(to: string): this {
    if (to !== this.loc && isLocation(to)) {
      this.steps.push(encodeStep('go', to));
      this.labels.push('Walking to ' + locName(to));
      this.loc = to;
    }
    return this;
  }
  add(type: StepType, args: (string | number)[], label: string): this {
    this.steps.push(encodeStep(type, ...args));
    this.labels.push(label);
    return this;
  }
  /** A word with whoever is around afterwards: people at gatherings talk, and talk carries news. */
  chat(label: string): this {
    return this.add('talk', this.news ? ['any', this.news] : ['any'], (this.news ? 'Passing on the latest talk' : label) + ' at ' + locName(this.loc));
  }
  get blocked(): boolean {
    return stormAt(this.tx.world, this.loc) > 0;
  }
}

/** The juiciest thing this person has heard, which they will bring up wherever people gather. */
const hotTopic = (a: AgentDoc): string | undefined => a.topics.find((k) => ACCUSABLE.has(k.split(':')[0]) || k.startsWith('scarcity') || k.startsWith('hero'));

const choice = (score: number, intent: string, plan: Steps, trigger?: string, routine = false): SocietyChoice | null =>
  plan.blocked || plan.steps.length === 0 ? null : { score, routine, intent, steps: plan.steps, labels: plan.labels, trigger: trigger ?? (routine ? undefined : intent) };

type StructureRow = Doc<'structures'>;
const structureCache = new WeakMap<Tx, StructureRow[]>();
async function structures(tx: Tx): Promise<StructureRow[]> {
  const cached = structureCache.get(tx);
  if (cached) return cached;
  const rows = await tx.ctx.db.query('structures').withIndex('by_world', (q) => q.eq('worldId', tx.world._id)).take(100);
  structureCache.set(tx, rows);
  return rows;
}

export async function choicesFor(tx: Tx, a: AgentDoc, mind: MindDoc, free: boolean): Promise<SocietyChoice[]> {
  const s = societyOf(tx, a, mind);
  if (mind.ageBand === 'child') return childChoices(tx, a, mind);
  const out: (SocietyChoice | null)[] = [];
  const p = personalTick(a, tx.tick);
  const shift = p >= SHIFT_START && p < SHIFT_END && !(p >= LUNCH[0] && p < LUNCH[1]);
  const r = (salt: string) => roll(tx, a.seq, 'ch' + salt);
  const ob = s.obsession;
  if (ob && (free || (shift && r('obshift') < ob.intensity * 0.45))) out.push(await obsessionChoice(tx, a, mind));
  const orgs = await orgsOf(tx, mind);
  out.push(...(await needsThroughOrgs(tx, a, orgs)));
  const company = orgs.find((o) => o.kind === 'company');
  if (shift && company && a.occupation === 'resident') {
    out.push(choice(0.66, 'Working a shift for ' + company.name, new Steps(tx, a.locationId, hotTopic(a)).go(orgHome(company)).add('org_action', [company._id, 'work'], 'Working for ' + company.name), undefined, true));
  }
  if (!free) return out.filter((c): c is SocietyChoice => !!c);
  const pastimesFrom = out.length;

  const meta = await loadMeta(tx);
  const t = a.traits;
  const v = mind.values;
  for (const org of orgs) out.push(...(await orgChoices(tx, a, mind, org, r)));

  // founding
  if (r('found') < 0.25 && !orgs.some((o) => o.leaderId === a._id) && tx.tick - meta.lastFoundTick > DAY * 0.6) {
    const want = foundingDesire(a, mind, tx.world.econ.rationLevel);
    if (want && (await canFound(tx, want.kind))) {
      const home = want.kind === 'company' || want.kind === 'school' ? a.workLocationId ?? ORG_KINDS[want.kind].home : want.kind === 'breakaway' ? a.workLocationId ?? 'quarry' : ORG_KINDS[want.kind].home;
      const label = { cult: 'Gathering the faithful', company: 'Setting up a company', militia: 'Raising a militia', gang: 'Putting a crew together', troupe: 'Starting a troupe', guild: 'Founding a guild', party: 'Founding a party', school: 'Opening a school', breakaway: 'Declaring independence' }[want.kind] ?? 'Founding something new';
      out.push(choice(want.score + 0.18, label + ' at ' + locName(home), new Steps(tx, a.locationId, hotTopic(a)).go(home).add('found_org', [want.kind, ''], label), 'wants to found a ' + want.kind));
    }
  }
  // joining an organization that fits
  if (r('join') < 0.05 && s.orgIds.length < 2) {
    const fit = (await activeOrgs(tx)).filter((o) => !o.memberIds.includes(a._id) && o.kind !== 'company').map((o) => ({ o, f: kindAffinity(o.kind, a, mind) })).sort((x, y) => y.f - x.f)[0];
    if (fit && fit.f > 0.55) out.push(choice(0.3 + fit.f * 0.3, 'Going to ask about joining ' + fit.o.name, new Steps(tx, a.locationId, hotTopic(a)).go(orgHome(fit.o)).add('join_org', [fit.o._id], 'Asking to join ' + fit.o.name).chat('Meeting the others')));
  }
  // jobs
  const wanted = r('job') < 0.3 ? jobWanted(a, mind, tx.world.vacancies.map((x) => x.occupation)) : null;
  if (wanted) {
    const label = wanted.replace(/_/g, ' ');
    out.push(choice(0.48 + t.ambition * 0.2 + (a.occupation === 'resident' ? 0.2 : 0), 'Going to ask for work as a ' + label, new Steps(tx, a.locationId, hotTopic(a)).go('plaza').add('apply_job', [wanted], 'Applying to be a ' + label), a.occupation === 'resident' ? 'out of work' : 'better suited to ' + label));
  }
  // study
  const studyScore = 0.26 + t.curiosity * 0.25 + (a.occupation === 'resident' ? 0.12 : 0) + (mind.ageBand === 'young' ? 0.1 : 0) + (s.education?.studying ? 0.05 : 0);
  if (r('study') < 0.5) {
    const skill = s.education?.studying ?? (t.curiosity > 0.6 ? 'science' : PRIMARY_SKILL[a.occupation] ?? 'craft');
    out.push(choice(studyScore, 'Studying ' + skillLabel(skill) + ' in my free hours', new Steps(tx, a.locationId, hotTopic(a)).go('observatory').add('study', [skill, 9], 'Studying ' + skillLabel(skill) + ' at the Observatory school').chat('Comparing notes'), undefined, true));
  }
  // research
  if (r('exp') < 0.5 && availableDiscoveries(meta.discovered).length > 0 && (t.curiosity > 0.5 || a.occupation === 'researcher')) {
    const place = a.occupation === 'researcher' ? 'observatory' : a.workLocationId ?? 'observatory';
    out.push(choice(0.3 + t.curiosity * 0.3 + (a.occupation === 'researcher' ? 0.12 : 0), 'Tinkering with an idea at ' + locName(place), new Steps(tx, a.locationId, hotTopic(a)).go(place).add('experiment', [9], 'Experimenting at ' + locName(place))));
  }
  // art
  const lastWork = isArtist(mind) || (mind.skills.art ?? 0) >= 20 ? await tx.ctx.db.query('works').withIndex('by_creator', (q) => q.eq('creatorId', a._id)).order('desc').first() : undefined;
  if (lastWork !== undefined) {
    const kind = (mind.skills.art ?? 0) >= 50 && t.sociability > 0.5 ? 'song' : t.curiosity > 0.6 ? 'mural' : 'poem';
    const where = kind === 'mural' ? (a.homeLocationId === 'habitat_a' ? 'canteen' : 'plaza') : a.locationId;
    if (!lastWork || tx.tick - lastWork.createdTick > DAY / 2 || s.inspiration > 0.7) out.push(choice(0.26 + s.inspiration * 0.5 + (mind.skills.art ?? 0) / 400, s.inspiration > 0.5 ? 'Something has to come out: making a ' + kind : 'Working on a new ' + kind, new Steps(tx, a.locationId, hotTopic(a)).go(where).add('create_art', [kind], 'Making a ' + kind + ' at ' + locName(where)).chat('Showing it to someone'), s.inspiration > 0.5 ? 'inspired' : undefined));
    if (p >= SHIFT_END && p < SHIFT_END + 24 && r('perf') < 0.6 && tx.tick - (meta.performed[a._id] ?? -1000) > DAY / 2) {
      out.push(choice(0.38 + s.fame * 0.3 + t.sociability * 0.12, 'Performing for whoever is at the canteen tonight', new Steps(tx, a.locationId, hotTopic(a)).go('canteen').add('perform', [4], 'Performing at the Airlock Canteen').chat('Talking with the crowd'), undefined, s.fame < 0.3));
    }
  }
  // building
  if (r('build') < 0.35) out.push(await buildChoice(tx, a, mind, orgs.flatMap((o) => o.territory ?? []), meta));
  // pets
  const pets = await tx.ctx.db.query('pets').withIndex('by_owner', (q) => q.eq('ownerId', a._id)).take(3);
  const pet = pets.find((x) => x.alive);
  if (pet && r('pet') < 0.3) out.push(choice(0.33 + v.family * 0.1 + a.needs.social / 400, 'Spending time with ' + pet.name, new Steps(tx, a.locationId, hotTopic(a)).go(a.homeLocationId).add('care', [pet._id], 'Playing with ' + pet.name), undefined, true));
  if (!pet && meta.strays > 0 && (t.empathy > 0.55 || a.needs.social > 65) && r('adopt') < 0.15) {
    out.push(choice(0.36 + t.empathy * 0.15 + a.needs.social / 300, 'Taking in one of the strays from the depot', new Steps(tx, a.locationId, hotTopic(a)).go('depot').add('adopt_pet', ['cat'], 'Taking in a stray')));
  }
  // family and romance
  out.push(...(await familyChoices(tx, a, mind, r, tx.tick - meta.lastProposalTick > DAY / 3)));
  const lonely = a.needs.social / 400;
  return out.map((c, i) => (c && i >= pastimesFrom && c.score < 0.9 ? { ...c, score: c.score - PASTIME_DAMP - lonely } : c)).filter((c): c is SocietyChoice => !!c);
}

async function needsThroughOrgs(tx: Tx, a: AgentDoc, orgs: Doc<'organizations'>[]): Promise<(SocietyChoice | null)[]> {
  const helpers = orgs.filter((o) => ['guild', 'cult', 'gang', 'breakaway', 'company'].includes(o.kind));
  const res: 'food' | 'water' = a.needs.thirst >= a.needs.hunger ? 'water' : 'food';
  const need = Math.max(a.needs.hunger, a.needs.thirst);
  const breakaways = (await activeOrgs(tx)).filter((o) => o.kind === 'breakaway' && o.rules?.includes('open_door') && !o.memberIds.includes(a._id));
  const org = helpers[0] ?? breakaways[0];
  if (!org || need < 58 || a.inv[res] >= 1) return [];
  const urgency = (need - 50) / 40;
  const plan = new Steps(tx, a.locationId, hotTopic(a)).go(orgHome(org)).add('org_action', [org._id, 'aid'], 'Asking ' + org.name + ' for ' + res).add(res === 'food' ? 'eat' : 'drink', [], res === 'food' ? 'Eating' : 'Drinking');
  return [choice(urgency * 1.1 + 0.12, 'Going to ' + org.name + ' for ' + res + ': they look after their own', plan, (res === 'water' ? 'thirsty' : 'hungry') + ', and ' + org.name + ' shares')];
}

async function orgChoices(tx: Tx, a: AgentDoc, mind: MindDoc, org: Doc<'organizations'>, r: (s: string) => number): Promise<(SocietyChoice | null)[]> {
  const out: (SocietyChoice | null)[] = [];
  const lead = org.leaderId === a._id;
  const home = orgHome(org);
  const t = a.traits;
  const st = orgState(org);
  const ritual = org.kind === 'cult' || org.kind === 'troupe' || org.kind === 'breakaway';
  if (tx.tick - (st.lastMeetingTick ?? -1000) > DAY / 2 && r('meet' + org._id) < 0.45) {
    out.push(choice(0.38 + (lead ? 0.15 : 0) + t.sociability * 0.1, (ritual ? 'Joining the ' : 'Going to the ') + (ritual ? 'gathering' : 'meeting') + ' of ' + org.name, new Steps(tx, a.locationId, hotTopic(a)).go(home).add('org_action', [org._id, ritual ? 'ritual' : 'meeting'], ritual ? 'At the gathering of ' + org.name : 'At a meeting of ' + org.name).chat('Lingering after the ' + (ritual ? 'gathering' : 'meeting')), undefined, !lead));
  }
  if (!lead) return out;
  if (org.kind === 'breakaway' && !org.rules?.length) out.push(choice(0.95, 'Declaring the rules of ' + org.name + ' at ' + locName(home), new Steps(tx, a.locationId, hotTopic(a)).go(home).add('org_action', [org._id, 'declare_rules'], 'Declaring the rules of ' + org.name), 'ready to declare independence'));
  if (org.memberIds.length < 9 && r('recruit') < 0.3) {
    const target = await recruitTarget(tx, a, org);
    if (target) out.push(choice(0.42 + t.ambition * 0.2 + (org.memberIds.length < 3 ? 0.15 : 0), 'Trying to win ' + target.name + ' over to ' + org.name, new Steps(tx, a.locationId, hotTopic(a)).go(target.locationId).add('recruit', [target._id, org._id], 'Recruiting ' + firstName(target.name) + ' for ' + org.name)));
  }
  if ((org.kind === 'cult' || org.kind === 'party' || org.kind === 'breakaway') && r('preach') < 0.4) {
    out.push(choice(0.4 + t.sociability * 0.2, 'Preaching for ' + org.name + ' in the plaza', new Steps(tx, a.locationId, hotTopic(a)).go('plaza').add('preach', [org._id], 'Preaching for ' + org.name).chat('Arguing with the listeners')));
  }
  if (org.kind === 'militia' && r('patrol') < 0.5) out.push(choice(0.44 + t.stubbornness * 0.15, 'Patrolling the depot with ' + org.name, new Steps(tx, a.locationId, hotTopic(a)).go('depot').add('org_action', [org._id, 'protect'], 'On patrol at the depot')));
  if (org.kind === 'gang') {
    const stores = st.stores ?? { food: 0, water: 0 };
    if (stores.food + stores.water < 6 && r('raid') < 0.35) out.push(choice(0.4 + (1 - t.empathy) * 0.3, 'Leading ' + org.name + ' on a quiet visit to the depot', new Steps(tx, a.locationId, hotTopic(a)).go('depot').add('org_action', [org._id, 'raid'], 'Raiding the depot')));
    const mark = (await activeOrgs(tx)).find((o) => o.kind === 'company' || o.kind === 'guild');
    if (mark && r('racket') < 0.25) out.push(choice(0.42 + (1 - t.empathy) * 0.2, 'Paying ' + mark.name + ' a visit about protection', new Steps(tx, a.locationId, hotTopic(a)).go(orgHome(mark)).add('org_action', [org._id, 'protect'], 'Leaning on ' + mark.name)));
  }
  if ((org.kind === 'militia' || org.kind === 'breakaway') && org.rivalIds.length && r('raidrival') < 0.2) {
    const rival = (await activeOrgs(tx)).find((o) => org.rivalIds.includes(o._id));
    if (rival) out.push(choice(0.48 + t.stubbornness * 0.2, 'Taking the fight to ' + rival.name, new Steps(tx, a.locationId, hotTopic(a)).go(orgHome(rival)).add('org_action', [org._id, 'raid'], 'Raiding ' + rival.name)));
  }
  if (org.kind === 'company' && r('deal') < 0.15) {
    const partner = (await activeOrgs(tx)).find((o) => o._id !== org._id && o.leaderId && (o.kind === 'guild' || o.kind === 'company') && !org.rivalIds.includes(o._id));
    const leader = partner?.leaderId ? await loadAgent(tx, partner.leaderId) : null;
    if (partner && leader?.alive && isLocation(leader.locationId) && !leader.move) out.push(choice(0.45 + t.ambition * 0.15, 'Offering ' + partner.name + ' a deal', new Steps(tx, a.locationId, hotTopic(a)).go(leader.locationId).add('org_action', [org._id, 'trade_deal'], 'Negotiating with ' + leader.name)));
  }
  return out;
}

async function recruitTarget(tx: Tx, a: AgentDoc, org: Doc<'organizations'>): Promise<AgentDoc | null> {
  const ties = await tiesOf(tx, a._id, 12);
  let best: { b: AgentDoc; s: number } | null = null;
  for (const t of ties.filter((x) => x.toAlive && x.affinity > -0.1 && !org.memberIds.includes(x.toAgentId)).slice(0, 4)) {
    const b = await loadAgent(tx, t.toAgentId);
    const bm = b ? await loadMind(tx, b) : null;
    if (!b?.alive || !bm || bm.ageBand === 'child' || b.move || b.activity === 'sleeping' || !isLocation(b.locationId) || stormAt(tx.world, b.locationId) > 0) continue;
    const s = kindAffinity(org.kind, b, bm) + t.affinity * 0.5;
    if (!best || s > best.s) best = { b, s };
  }
  return best && best.s > 0.35 ? best.b : null;
}

/** What someone would build: what their persona, organization or skills call for. */
async function buildChoice(tx: Tx, a: AgentDoc, mind: MindDoc, territories: string[], meta: Awaited<ReturnType<typeof loadMeta>>): Promise<SocietyChoice | null> {
  const rows = await structures(tx);
  const mine = rows.find((s) => s.builtTick === undefined && s.builderIds.includes(a._id));
  if (mine) return choice(0.55 + a.traits.stubbornness * 0.1, 'Getting on with the ' + mine.name, new Steps(tx, a.locationId, hotTopic(a)).go(mine.locationId).add('build', [mine.key], 'Building the ' + mine.name + ' at ' + locName(mine.locationId)));
  const orgs = await orgsOf(tx, mind);
  const wish: StructureDef[] = [];
  const add = (key: string) => STRUCTURE_BY_KEY[key] && wish.push(STRUCTURE_BY_KEY[key]);
  for (const o of orgs.filter((x) => x.leaderId === a._id)) {
    if (o.kind === 'cult') add(meta.built.some((b) => b.orgId === o._id && b.key === 'long_dark_shrine') ? 'chapel' : 'long_dark_shrine');
    if (o.kind === 'militia') add('militia_armory');
    if (o.kind === 'troupe') add('theatre_stage');
    if (o.kind === 'gang') add('black_market_cache');
    if (o.kind === 'breakaway') add('barricade');
    if (o.kind === 'school') add('school_room');
    if (o.kind === 'guild') add('greenhouse_dome');
    if (o.kind === 'company') add(o.state && orgHome(o) === 'ice_wells' ? 'drill_rig' : 'recycler');
  }
  if ((mind.skills.farming ?? 0) >= 40 || mind.persona?.strategies.includes('grow')) add('grow_rack');
  if ((mind.society?.childIds.length ?? 0) > 0) add('playground');
  if (a.traits.empathy > 0.7) add('pet_shelter');
  if (a.mood === 'grieving' || a.mood === 'sombre') add('memorial_wall');
  if ((mind.skills.engineering ?? 0) >= 50 && a.traits.ambition > 0.5) for (const k of ['water_reclaimer', 'drill_rig', 'recycler', 'solar_extension', 'clinic_annex', 'telescope_upgrade', 'signal_dish', 'greenhouse_dome', 'school_room']) add(k);
  for (const def of wish) {
    const loc = def.key === 'barricade' ? territories[0] : def.locations.includes(a.homeLocationId as never) ? a.homeLocationId : def.locations[0];
    if (!loc || !canBuildHere(meta, def.key, loc, territories)) continue;
    if (meta.built.some((b) => b.key === def.key && b.loc === loc) && !['grow_rack', 'statue'].includes(def.key)) continue;
    if (def.key === 'grow_rack' && meta.built.some((b) => b.key === 'grow_rack' && b.ownerId === a._id)) continue;
    if (rows.some((s) => s.key === def.key && s.locationId === loc && s.builtTick === undefined)) continue;
    return choice(0.42 + a.traits.ambition * 0.2, 'Building a ' + def.name + ' at ' + locName(loc), new Steps(tx, a.locationId, hotTopic(a)).go(loc).add('build', [def.key], 'Starting a ' + def.name));
  }
  return null;
}

async function familyChoices(tx: Tx, a: AgentDoc, mind: MindDoc, r: (s: string) => number, mayPropose: boolean): Promise<(SocietyChoice | null)[]> {
  const out: (SocietyChoice | null)[] = [];
  const s = mind.society!;
  const v = mind.values;
  for (const id of s.childIds.slice(0, 3)) {
    const child = await loadAgent(tx, id);
    if (!child?.alive || child.move || !isLocation(child.locationId)) continue;
    const cm = await loadMind(tx, child);
    if (cm?.ageBand !== 'child') continue;
    if (r('care' + id) < 0.35 || child.needs.hunger > 60 || child.needs.thirst > 60) {
      out.push(choice(0.42 + v.family * 0.25 + (child.needs.hunger > 60 || child.needs.thirst > 60 ? 0.3 : 0), 'Looking after ' + firstName(child.name), new Steps(tx, a.locationId, hotTopic(a)).go(child.locationId).add('care', [child._id], 'Looking after ' + firstName(child.name)), undefined, true));
    }
    if ((mind.skills[PRIMARY_SKILL[a.occupation] ?? 'craft'] ?? 0) >= 45 && r('teach' + id) < 0.2) {
      out.push(choice(0.4 + v.family * 0.15, 'Teaching ' + firstName(child.name) + ' the trade', new Steps(tx, a.locationId, hotTopic(a)).go(child.locationId).add('teach', [child._id, PRIMARY_SKILL[a.occupation] ?? 'craft'], 'Teaching ' + firstName(child.name))));
    }
    break;
  }
  if (mind.ageBand === 'elder' || r('romance') > 0.3) return out;
  const ties = await tiesOf(tx, a._id, 10);
  if (s.partnerId) {
    if (s.childIds.length < 2 && v.family > 0.55 && r('kid') < 0.25) {
      const partner = await loadAgent(tx, s.partnerId);
      if (partner?.alive && isLocation(partner.locationId) && !partner.move) out.push(choice(0.38 + v.family * 0.2, 'Talking to ' + firstName(partner.name) + ' about a child', new Steps(tx, a.locationId, hotTopic(a)).go(partner.locationId).add('propose', [partner._id], 'Asking ' + firstName(partner.name) + ' about a child')));
    }
    return out;
  }
  const crush = ties.find((t) => t.toAlive && t.kind !== 'family' && t.kind !== 'rival' && t.affinity >= 0.35);
  if (!crush) return out;
  const b = await loadAgent(tx, crush.toAgentId);
  const bm = b ? await loadMind(tx, b) : null;
  if (!b?.alive || !bm || bm.ageBand === 'child' || bm.society?.partnerId || b.move || !isLocation(b.locationId) || b.activity === 'sleeping') return out;
  const plan = new Steps(tx, a.locationId, hotTopic(a)).go(b.locationId);
  if (mayPropose && crush.affinity >= 0.65 && crush.trust >= 0.4 && r('propose') < 0.25) out.push(choice(clamp(0.45 + v.family * 0.25, 0, 0.8), 'Asking ' + b.name + ' to be my partner', plan.add('propose', [b._id], 'Proposing to ' + firstName(b.name)), 'in love with ' + b.name));
  else if (crush.affinity < 0.65) out.push(choice(0.34 + a.traits.sociability * 0.15, 'Finding an excuse to see ' + b.name, plan.add('talk', [b._id], 'Flirting with ' + firstName(b.name)), undefined, true));
  return out;
}

async function childChoices(tx: Tx, a: AgentDoc, mind: MindDoc): Promise<SocietyChoice[]> {
  const age = tx.tick - (mind.society?.bornTick ?? 0);
  const p = personalTick(a, tx.tick);
  const out: (SocietyChoice | null)[] = [];
  if (age < INFANT_TICKS) {
    out.push(choice(3, 'A baby, sleeping and feeding', new Steps(tx, a.locationId, hotTopic(a)).go(a.homeLocationId).add('rest', [6], 'Asleep in a cot'), undefined, true));
    return out.filter((c): c is SocietyChoice => !!c);
  }
  const shift = p >= SHIFT_START && p < SHIFT_END && !(p >= LUNCH[0] && p < LUNCH[1]);
  const r = roll(tx, a.seq, 'childplay');
  if (shift) {
    const skill = a.traits.curiosity > 0.55 ? 'science' : r < 0.5 ? 'craft' : 'art';
    const plan = new Steps(tx, a.locationId, hotTopic(a)).go('observatory');
    const school = (await activeOrgs(tx)).find((o) => o.kind === 'school' && orgHome(o) === 'observatory');
    if (school && !school.memberIds.includes(a._id)) plan.add('join_org', [school._id], 'Enrolling at ' + school.name);
    plan.add('study', [skill, 9], 'At school: ' + skillLabel(skill));
    out.push(choice(0.9, 'Going to school at the Observatory', plan, undefined, true));
  } else if (p < 96) {
    const where = r < 0.5 ? 'plaza' : a.homeLocationId;
    const games = ['Playing tag in the plaza', 'Building a regolith fort', 'Chasing a cat through the tubes', 'Drawing on the walls with chalk'];
    out.push(choice(0.5 + a.traits.sociability * 0.2, 'Playing', new Steps(tx, a.locationId, hotTopic(a)).go(where).add('rest', [4], games[Math.floor(r * games.length)]).add('talk', ['any'], 'Telling someone a very long story'), undefined, true));
  }
  return out.filter((c): c is SocietyChoice => !!c);
}

export { cacheOf };
