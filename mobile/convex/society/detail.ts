/**
 * The society layer as the player and the LLM see it: words, not numbers. societyDetail gives the
 * society fields of AgentDetail (the integrator spreads it into agents:get); societyContext is a
 * short text summary for prompts; societyLookup lists what the LLM may name in society steps.
 */
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { OCCUPATIONS } from '../../shared/colony';
import type { AgentDetail, OrganizationKind } from '../../shared/types';
import { ORG_KINDS } from '../../shared/society';
import { META_KEY, standingLabel } from './store';
import type { Meta } from './store';
import { MASTERY, skillLabel } from './work';

type Reader = Pick<QueryCtx, 'db'>;
type SocietyFields = Pick<AgentDetail, 'organizations' | 'family' | 'pets' | 'obsession' | 'works' | 'standingLabel' | 'education'>;

async function metaOf(ctx: Reader, worldId: Id<'worlds'>): Promise<Partial<Meta> | null> {
  const row = await ctx.db.query('organizations').withIndex('by_world_status', (q) => q.eq('worldId', worldId).eq('status', 'system')).first();
  return row?.key === META_KEY ? (row.state as Partial<Meta>) : null;
}

const listWords = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

function educationWords(mind: Doc<'minds'>): string | undefined {
  const ed = mind.society?.education;
  const child = mind.ageBand === 'child';
  if (!ed) return child ? 'at school at the Observatory' : undefined;
  const parts: string[] = [];
  if (ed.mastered.length) parts.push('has mastered ' + listWords(ed.mastered.map(skillLabel)));
  if (ed.studying) {
    const level = mind.skills[ed.studying] ?? 0;
    const how = level >= MASTERY * 0.8 ? 'close to mastering' : level >= MASTERY * 0.45 ? 'getting good at' : 'learning';
    parts.push(how + ' ' + skillLabel(ed.studying));
  }
  return parts.length ? (child ? 'at school, ' : '') + parts.join('; ') : undefined;
}

/** The society fields of AgentDetail for one colonist. */
export async function societyDetail(ctx: Reader, agent: Doc<'agents'>, mind: Doc<'minds'> | null): Promise<SocietyFields> {
  const s = mind?.society;
  if (!mind || !s) return {};
  const organizations: NonNullable<SocietyFields['organizations']> = [];
  for (const id of s.orgIds) {
    const o = await ctx.db.get(id);
    if (!o || o.status !== 'active') continue;
    const role = o.leaderId === agent._id ? (o.founderId === agent._id ? 'founder' : 'leader') : o.officerIds.includes(agent._id) ? 'officer' : 'member';
    organizations.push({ id: o._id, name: o.name, kind: o.kind as OrganizationKind, role });
  }
  const partner = s.partnerId ? await ctx.db.get(s.partnerId) : null;
  const pets = (await ctx.db.query('pets').withIndex('by_owner', (q) => q.eq('ownerId', agent._id)).take(5)).filter((p) => p.alive).map((p) => ({ name: p.name, species: p.species.replace(/_/g, ' ') }));
  const works = (await ctx.db.query('works').withIndex('by_creator', (q) => q.eq('creatorId', agent._id)).order('desc').take(5)).map((w) => ({ id: w._id, title: w.title, kind: w.kind, fame: Math.round(w.fame * 100) / 100 }));
  const meta = await metaOf(ctx, agent.worldId);
  const scandal = meta?.scandals?.[agent._id] !== undefined;
  return {
    organizations,
    family: { partnerId: s.partnerId, partnerName: partner?.name, parentIds: s.parentIds, childIds: s.childIds },
    pets,
    obsession: s.obsession ? 'obsessed with ' + s.obsession.text : undefined,
    works,
    standingLabel: standingLabel(s.status, s.fame, { ageBand: mind.ageBand, scandal, artist: (mind.skills.art ?? 0) >= 30 }),
    education: educationWords(mind),
  };
}

/** A few lines about someone's place in society, for LLM prompts (plans, monologue, answers). */
export async function societyContext(ctx: Reader, agent: Doc<'agents'>, mind: Doc<'minds'> | null): Promise<string> {
  const d = await societyDetail(ctx, agent, mind);
  if (!mind?.society) return '';
  const lines: string[] = [];
  if (d.standingLabel) lines.push('Standing: ' + d.standingLabel + '.');
  for (const o of d.organizations ?? []) {
    const org = await ctx.db.get(o.id as Id<'organizations'>);
    lines.push('Belongs to ' + o.name + ' (' + (ORG_KINDS[o.kind]?.label ?? o.kind) + ', ' + o.role + (org ? ', creed: "' + org.creed + '"' : '') + (org?.rules?.length ? ', rules: ' + org.rules.join(', ') : '') + ').');
  }
  if (d.family?.partnerName) lines.push('Partner: ' + d.family.partnerName + '.');
  const kids: string[] = [];
  for (const id of d.family?.childIds ?? []) {
    const c = await ctx.db.get(id as Id<'agents'>);
    if (c) kids.push(c.name + (c.alive ? '' : ' (dead)'));
  }
  if (kids.length) lines.push('Children: ' + kids.join(', ') + '.');
  if (mind.ageBand === 'child') lines.push('A child of the colony; goes to school and plays, does not work.');
  if (d.pets?.length) lines.push('Pets: ' + d.pets.map((p) => p.name + ' the ' + p.species).join(', ') + '.');
  if (d.obsession) lines.push('Is ' + d.obsession + '; it drives nearly everything they do.');
  if (d.works?.length) lines.push('Their works: ' + d.works.map((w) => '"' + w.title + '" (' + w.kind + (w.fame >= 0.5 ? ', famous' : '') + ')').join(', ') + '.');
  if (d.education) lines.push('Education: ' + d.education + '.');
  const jobs = mind.society.jobHistory.slice(-3).map((j) => OCCUPATIONS.find((o) => o.id === j.occupation)?.label.toLowerCase() ?? j.occupation);
  if (jobs.length > 1) lines.push('Career so far: ' + jobs.join(', then ') + '.');
  return lines.join('\n');
}

/** What a colonist may name in society steps: organizations, their pets and children, what is known. */
export async function societyLookup(ctx: Reader, agent: Doc<'agents'>, mind: Doc<'minds'> | null) {
  const orgs = await ctx.db.query('organizations').withIndex('by_world_status', (q) => q.eq('worldId', agent.worldId).eq('status', 'active')).take(30);
  const pets = (await ctx.db.query('pets').withIndex('by_owner', (q) => q.eq('ownerId', agent._id)).take(5)).filter((p) => p.alive);
  const children: { id: string; name: string }[] = [];
  for (const id of mind?.society?.childIds ?? []) {
    const c = await ctx.db.get(id);
    if (c?.alive) children.push({ id: c._id, name: c.name });
  }
  const meta = await metaOf(ctx, agent.worldId);
  return {
    orgs: orgs.map((o) => ({ id: o._id as string, name: o.name, kind: o.kind, member: o.memberIds.includes(agent._id), leader: o.leaderId === agent._id })),
    pets: pets.map((p) => ({ id: p._id as string, name: p.name })),
    children,
    discovered: meta?.discovered ?? [],
  };
}
