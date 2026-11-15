/**
 * The almanac query (contract path 'society/api:overview'): the colony's organizations, discoveries,
 * landmarks, famous works and notable people, as story rather than statistics.
 */
import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { DISCOVERY_BY_KEY } from '../../shared/society';
import type { DiscoveryPublic, OrganizationKind, OrganizationPublic, SocietyOverview, StructurePublic, WorkPublic } from '../../shared/types';
import type { LocationId } from '../../shared/colony';
import { asWorldId } from '../lib/auth';

const EMPTY: SocietyOverview = { organizations: [], discoveries: [], structures: [], works: [], notables: [] };

function toOrg(o: Doc<'organizations'>): OrganizationPublic {
  return {
    id: o._id,
    name: o.name,
    kind: o.kind as OrganizationKind,
    creed: o.creed,
    leaderId: o.leaderId,
    memberIds: o.memberIds,
    foundedTick: o.foundedTick,
    status: o.status === 'active' ? 'active' : 'disbanded',
    territory: o.territory as LocationId[] | undefined,
    rules: o.rules,
    rivalIds: o.rivalIds,
  };
}

export const overview = query({
  args: { worldId: v.string() },
  handler: async (ctx, args): Promise<SocietyOverview> => {
    const worldId = asWorldId(ctx, args.worldId);
    if (!worldId) return EMPTY;
    const active = await ctx.db.query('organizations').withIndex('by_world_status', (q) => q.eq('worldId', worldId).eq('status', 'active')).take(30);
    const gone = await ctx.db.query('organizations').withIndex('by_world_status', (q) => q.eq('worldId', worldId).eq('status', 'disbanded')).order('desc').take(10);
    const organizations = [...active.sort((x, y) => y.memberIds.length - x.memberIds.length), ...gone].map(toOrg);

    const found = await ctx.db.query('discoveries').withIndex('by_world_key', (q) => q.eq('worldId', worldId)).take(120);
    const discoveries: DiscoveryPublic[] = found
      .filter((d) => (DISCOVERY_BY_KEY[d.key]?.tier ?? 0) > 0)
      .sort((x, y) => y.tick - x.tick)
      .map((d) => ({ key: d.key, name: DISCOVERY_BY_KEY[d.key].name, effect: DISCOVERY_BY_KEY[d.key].effect, tick: d.tick, discovererIds: d.discovererIds, eventId: d.eventId }));

    const built = await ctx.db.query('structures').withIndex('by_world', (q) => q.eq('worldId', worldId)).take(100);
    const structures: StructurePublic[] = built
      .sort((x, y) => (y.builtTick ?? Infinity) - (x.builtTick ?? Infinity))
      .map((s) => ({ id: s._id, key: s.key, name: s.name, locationId: s.locationId as LocationId, builderIds: s.builderIds, progress: Math.round(s.progress * 100) / 100, builtTick: s.builtTick }));

    const names = new Map<string, string>();
    const nameOf = async (id: Id<'agents'>): Promise<string> => {
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? 'someone');
      return names.get(id)!;
    };
    const top = await ctx.db.query('works').withIndex('by_world_fame', (q) => q.eq('worldId', worldId)).order('desc').take(12);
    const works: WorkPublic[] = [];
    for (const w of top) works.push({ id: w._id, title: w.title, kind: w.kind, creatorId: w.creatorId, creatorName: await nameOf(w.creatorId), fame: Math.round(w.fame * 100) / 100, createdTick: w.createdTick, about: w.about });

    const notables: SocietyOverview['notables'] = [];
    const add = async (agentId: Id<'agents'> | undefined, why: string) => {
      if (!agentId || notables.length >= 12 || notables.some((n) => n.agentId === agentId)) return;
      const a = await ctx.db.get(agentId);
      if (a?.alive) notables.push({ agentId, name: a.name, for: why });
    };
    for (const w of top.filter((x) => x.fame >= 0.35).slice(0, 3)) await add(w.creatorId, 'the ' + (w.kind === 'mural' ? 'painter' : w.kind === 'song' ? 'songwriter' : 'author') + ' of "' + w.title + '"');
    for (const o of active.slice(0, 5)) await add(o.leaderId, (o.founderId === o.leaderId ? 'founder of ' : 'leader of ') + o.name);
    for (const d of discoveries.slice(0, 3)) await add(d.discovererIds[0] as Id<'agents'> | undefined, 'who worked out ' + d.name.toLowerCase());
    for (const s of built.filter((x) => x.key === 'statue' && x.builtTick !== undefined)) await add(s.builderIds[0], 'who raised the ' + s.name);
    return { organizations, discoveries, structures, works, notables };
  },
});
