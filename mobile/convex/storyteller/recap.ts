/**
 * The follow view's recap: two clean sentences (about 180 characters) that tell a viewer who just
 * arrived who this person is and what they are in the middle of right now. Rule-built on every read.
 */
import type { Doc } from '../_generated/dataModel';

const first = (name: string): string => name.split(' ')[0];
const lower = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const bare = (s: string): string => s.trim().replace(/[.!?…]+$/, '');

/** Shortens at a clause or word boundary, never mid-word and never with an ellipsis. */
function fit(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '), cut.lastIndexOf(' and '), cut.lastIndexOf(' to '));
  return bare(at > max * 0.5 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(' ')));
}

export function buildRecap(agent: Doc<'agents'>, mind: Doc<'minds'> | null, storylines: Doc<'storylines'>[]): string {
  const name = first(agent.name);
  const p = mind?.persona;
  const epithet = p ? lower(bare(p.epithet)).replace(/^the /, 'the ') : 'a ' + agent.occupation.replace(/_/g, ' ');
  if (!agent.alive) return name + ', ' + fit(epithet, 70) + ', is dead: ' + fit(lower(bare(mind?.death?.cause ?? 'nobody saw how')), 60) + '. The people around the body are still reacting.';
  let want = p?.want ? lower(bare(p.want)).replace(/^to /, '') : '';
  const who = fit(name + ' is ' + epithet, 85);
  const one = want ? fit(who + (/^(a|an|the|my|her|his|their|some|one) /.test(want) ? ', and wants ' : ', out to ') + want, 120) + '.' : who + '.';
  const dull = ['idle', 'walking', 'sleeping', 'resting'].includes(agent.activity);
  const beat = storylines
    .filter((s) => s.participantIds.includes(agent._id) && ['climax', 'rising', 'brewing'].includes(s.status))
    .sort((a, b) => b.lastBeatTick - a.lastBeatTick)
    .map((s) => s.beats[s.beats.length - 1]?.text)
    .find((t) => !!t && t.includes(name) && t.length <= 190 - one.length);
  const doing = bare(agent.activityLabel).replace(new RegExp('^' + name + ' '), '');
  const two = dull && beat ? bare(beat) + '.' : agent.activity === 'sleeping' ? 'Asleep for now, with all of it waiting in the morning.' : fit('Right this minute: ' + lower(doing), 190 - one.length).replace(/^Right this minute: /, 'Now ' ) + '.';
  return one + ' ' + two.charAt(0).toUpperCase() + two.slice(1);
}
