import { expect, test } from 'vitest';
import type { Id } from './_generated/dataModel';
import type { PlanContext } from './cognition/context';
import { validatePlan, validateThought } from './cognition/validate';

const id = (n: number) => ('agent' + n) as Id<'agents'>;

const context: PlanContext = {
  kind: 'plan',
  tick: 100,
  agentId: id(0),
  name: 'Ines Duarte',
  identity: 'an adult Quartermaster of the Founders\' Compact',
  background: 'Runs the depot.',
  personality: 'cautious',
  values: 'family first',
  mood: 'tense',
  condition: 'healthy',
  inventory: '2 water; 40 credits',
  credits: 40,
  inv: { food: 1, water: 2, parts: 0, medicine: 0, credits: 40 },
  locationId: 'depot',
  homeLocationId: 'habitat_a',
  doing: 'Counting tanks',
  clock: 'Sol 1, 10:00',
  world: [],
  goals: [],
  beliefs: [
    { ref: 'b1', key: 'thief:agent1', kind: 'thief', text: 'Dmitri steals parts.', confidence: 0.7, sourceType: 'observed', subjectId: id(1) },
    { ref: 'b2', key: 'scarcity', kind: 'scarcity', text: 'Water is running out.', confidence: 0.8, sourceType: 'inference' },
  ],
  memories: [],
  trigger: 'test',
  people: [
    { ref: 'p1', id: id(1), name: 'Dmitri Volkov', occupation: 'Engineer', alive: true, present: true, usualPlace: 'workshop' },
    { ref: 'p2', id: id(2), name: 'Old Tomas', occupation: 'Farmer', alive: false, present: false, usualPlace: 'hydroponics' },
    { ref: 'p3', id: id(3), name: 'Mira Okafor', occupation: 'Medic', alive: true, present: false, usualPlace: 'medbay' },
  ],
  followed: true,
  secret: { ref: 's1', key: 'embezzler:agent0', text: 'Skims water.', exposed: false },
  society: [],
  storylines: [],
  thoughts: [],
};

/** Validates a single step and returns its encoding, or the reason it was dropped. */
function check(type: string, args: string[]): string {
  const result = validatePlan({ intent: 'x', goal: null, speech: null, thought: null, steps: [{ type, args, label: '' }] }, context);
  return result.ok ? result.plan.steps[0] : 'dropped: ' + result.dropped.join('; ');
}

test.each([
  ['grow', ['6'], 'grow|6'],
  ['grow', ['99'], 'grow|24'],
  ['scavenge', ['ice_wells'], 'scavenge|ice_wells'],
  ['beg', ['p3', 'water'], 'beg|agent3|water'],
  ['borrow', ['p1', 'credits', '250'], 'borrow|agent1|credits|100'],
  ['repay', ['p1'], 'repay|agent1'],
  ['barter', ['p1', 'water', '2', 'parts', '3'], 'barter|agent1|water|2|parts|3'],
  ['bribe', ['p1', '30', 'silence'], 'bribe|agent1|30|silence'],
  ['blackmail', ['p1', 'b1'], 'blackmail|agent1|thief:agent1'],
  ['lie', ['p3', 'p1', 'saboteur'], 'lie|agent3|agent1|saboteur'],
  ['lie', ['p3', 'p2', 'coward'], 'lie|agent3|agent2|coward'],
  ['confide', ['p3'], 'confide|agent3'],
  ['confide', ['p3', 's1'], 'confide|agent3|embezzler:agent0'],
  ['court', ['p3'], 'court|agent3'],
  ['comfort', ['p1'], 'comfort|agent1'],
  ['threaten', ['p1'], 'threaten|agent1'],
  ['sabotage', ['workshop'], 'sabotage|workshop'],
  ['smuggle', ['medicine', '4'], 'smuggle|medicine|4'],
  ['rally', ['recall_chair'], 'rally|recall_chair'],
  ['strike', ['12'], 'strike|12'],
  ['reconcile', ['p1'], 'reconcile|agent1'],
  ['eavesdrop', ['p1'], 'eavesdrop|agent1'],
  ['hide', ['water', '2'], 'hide|water|2'],
  ['confess', ['s1'], 'confess|embezzler:agent0'],
  ['confess', ['b2'], 'confess|scarcity'],
])('accepts %s(%s)', (type, args, expected) => {
  expect(check(type, args)).toBe(expected);
});

test.each([
  ['grow', ['soon']],
  ['scavenge', ['canteen']],
  ['scavenge', ['mars']],
  ['beg', ['p3', 'parts']],
  ['beg', ['p2', 'water']],
  ['borrow', ['p9', 'water', '2']],
  ['borrow', ['p1', 'gold', '2']],
  ['repay', ['p2']],
  ['barter', ['p1', 'water', '2', 'water', '3']],
  ['barter', ['p1', 'water', '0', 'food', '3']],
  ['bribe', ['p1', '30', 'promotion']],
  ['blackmail', ['p3', 'b1']],
  ['blackmail', ['p1', 's1']],
  ['lie', ['p3', 'p3', 'thief']],
  ['lie', ['p3', 'p1', 'witch']],
  ['confide', ['p2']],
  ['confide', ['p3', 'b9']],
  ['court', ['p2']],
  ['threaten', ['nobody']],
  ['sabotage', ['atlantis']],
  ['smuggle', ['credits', '5']],
  ['rally', ['seat']],
  ['strike', ['-3']],
  ['eavesdrop', ['p2']],
  ['hide', ['gold', '2']],
  ['confess', ['b7']],
  ['confess', []],
])('rejects %s(%s)', (type, args) => {
  expect(check(type, args)).toMatch(/^dropped/);
});

test('a thought keeps one clean line and a short lowercase mood', () => {
  expect(validateThought({ thought: '  "If he counts the tanks | I am done."\n', mood: 'Very Anxious Indeed And More Words Here' })).toEqual({
    ok: true,
    text: 'If he counts the tanks I am done.',
    mood: 'very anxious indeed and…',
  });
  expect(validateThought({ thought: '' })).toMatchObject({ ok: false });
});

test('only the followed colonist keeps a thought from a plan answer', () => {
  const answer = { intent: 'x', goal: null, speech: null, thought: 'Keep counting.', steps: [{ type: 'rest', args: ['2'], label: 'Rest' }] };
  expect(validatePlan(answer, context)).toMatchObject({ ok: true, plan: { thought: 'Keep counting.' } });
  const other = validatePlan(answer, { ...context, followed: false });
  expect(other.ok && other.plan.thought).toBeUndefined();
});
