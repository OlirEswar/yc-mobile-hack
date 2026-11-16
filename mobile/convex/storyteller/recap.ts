/**
 * The follow view's recap: one or two sentences that tell a viewer who just arrived who this person
 * is and what they are in the middle of right now. Rule-built on every read, so it is never stale.
 */
import type { Doc } from '../_generated/dataModel';

const first = (name: string): string => name.split(' ')[0];
const lower = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const stop = (s: string): string => (/[.!?]$/.test(s.trim()) ? s.trim() : s.trim() + '.');
const clip = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…');

export function buildRecap(agent: Doc<'agents'>, mind: Doc<'minds'> | null, storylines: Doc<'storylines'>[]): string {
  const name = first(agent.name);
  const p = mind?.persona;
  if (!agent.alive) {
    const cause = mind?.death?.cause;
    return stop(name + (p ? ', ' + lower(p.epithet) + ',' : '') + ' is dead' + (cause ? ': ' + cause : '')) + ' The people around the body are still reacting.';
  }
  const want = p?.want ? lower(p.want.replace(/[.!]+$/, '')) : undefined;
  const who = p
    ? name + ' is ' + lower(p.epithet.replace(/[.!]+$/, '')) + (want ? (/^(to|wants|needs) /.test(want) ? ' who ' + (want.startsWith('to ') ? 'wants ' : '') + want : '; what they want: ' + want) : '')
    : name + ' is a ' + agent.occupation.replace(/_/g, ' ') + ' of the colony';
  const hot = storylines.filter((s) => s.participantIds.includes(agent._id) && ['climax', 'rising', 'brewing'].includes(s.status)).sort((a, b) => b.tension - a.tension || b.lastBeatTick - a.lastBeatTick)[0];
  const beat = hot ? hot.beats[hot.beats.length - 1]?.text ?? hot.premise : undefined;
  const goal = mind?.goals.filter((g) => g.status === 'active').sort((a, b) => b.priority - a.priority)[0];
  const aim = mind?.plan?.intent ?? goal?.description;
  const now = beat ? stop(clip(beat, 150)) + (aim ? ' Right now: ' + stop(clip(lower(aim), 90)) : '') : aim ? 'Right now: ' + stop(clip(lower(aim), 120)) : stop('Right now: ' + lower(agent.activityLabel));
  return clip(stop(who), 170) + ' ' + now;
}
