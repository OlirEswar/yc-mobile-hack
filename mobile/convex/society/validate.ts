/**
 * Validation of LLM-proposed society steps. validateSocietyArgs resolves each argument to something
 * real (an organization, a living person, a pet, a skill, a structure the colony can build) and
 * returns the stored args with a fallback label, or the reason it is invalid. SOCIETY_ARG_KINDS
 * describes each argument for the prompt.
 */
import { OCCUPATIONS } from '../../shared/colony';
import { ART_KINDS, BREAKAWAY_RULE_KEYS, ORG_ACTIONS, ORG_KIND_KEYS, PET_SPECIES, STRUCTURE_BY_KEY, STUDY_SKILLS } from '../../shared/society';
import { SOCIETY_STEP_SPECS } from './steps';

export type SocietyStepType = keyof typeof SOCIETY_STEP_SPECS;

/** Argument kinds and their allowed values, for the prompt. */
export const SOCIETY_ARG_KINDS: Record<SocietyStepType, Record<string, string>> = {
  found_org: { kind: 'one of ' + ORG_KIND_KEYS.join(', '), name: 'a short name, or "" to let the colony name it' },
  join_org: { orgId: 'an organization id from the list' },
  leave_org: { orgId: 'an organization id you belong to' },
  recruit: { agentId: 'a person present', orgId: 'an organization you belong to' },
  preach: { topic: 'an organization id you belong to, or a cause in a few words' },
  org_action: { orgId: 'an organization you belong to', action: 'one of ' + ORG_ACTIONS.join(', ') + ' (expel, trade_deal and declare_rules need the leader; declare_rules is for breakaways, rules are chosen from ' + BREAKAWAY_RULE_KEYS.join(', ') + ')' },
  study: { skill: 'one of ' + STUDY_SKILLS.join(', '), ticks: '2 to 18' },
  teach: { agentId: 'a person present who knows less', skill: 'one of ' + STUDY_SKILLS.join(', ') },
  apply_job: { occupation: 'one of ' + OCCUPATIONS.filter((o) => !['resident', 'councilor', 'quartermaster'].includes(o.id)).map((o) => o.id).join(', ') },
  build: { structureKey: 'one of ' + Object.keys(STRUCTURE_BY_KEY).join(', ') + ' (some need a discovery)' },
  experiment: { ticks: '2 to 18' },
  create_art: { kind: 'one of ' + ART_KINDS.map((k) => k.key).join(', ') + ' (holo needs holography, sculpture needs regolith printing)' },
  perform: { ticks: '2 to 6' },
  adopt_pet: { species: 'one of ' + PET_SPECIES.map((s) => s.key).join(', ') },
  care: { targetId: 'your child (person id) or your pet (pet id)' },
  propose: { agentId: 'a person present: your love, or your partner (to raise a child together)' },
  fight: { agentId: 'a person present' },
  duel: { agentId: 'a person present you have a feud with' },
  rob: { agentId: 'a person present' },
  extort: { agentId: 'a person present' },
  vandalize: { locationId: 'the location you are at' },
  intimidate: { agentId: 'a person present' },
  gamble: { ticks: '1 to 3' },
  carouse: { ticks: '1 to 3' },
  dance: { ticks: '1 to 3' },
  ritual: { orgId: 'an organization you lead' },
  pray: { ticks: '1 to 3' },
  chase: { agentId: 'a person present' },
  kiss: { agentId: 'a person present' },
  cry: { ticks: '1 to 3' },
  celebrate: { ticks: '1 to 3' },
  spy: { agentId: 'a person present' },
  gloat: { agentId: 'a person present' },
  rush: { agentId: 'a person present' },
  inspect: { agentId: 'a person present' },
  loot: { locationId: 'the location you are at' },
};

export type SocietyLookup = {
  /** A living person the colonist was shown, by ref, id or name. */
  living: (value: string) => { id: string; name: string } | undefined;
  /** Active organizations (see societyLookup in ./detail). */
  orgs: { id: string; name: string; kind: string; member: boolean; leader: boolean }[];
  pets: { id: string; name: string }[];
  children: { id: string; name: string }[];
  discovered: string[];
};

const clampInt = (value: string | undefined, lo: number, hi: number): number | null => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(hi, Math.max(lo, n)) : null;
};

/** Resolves one society step's args to stored values and a fallback label, or says why it is invalid. */
export function validateSocietyArgs(type: string, raw: string[], l: SocietyLookup): { args: string[]; label: string } | string {
  if (!(type in SOCIETY_STEP_SPECS)) return 'not a society step';
  const args = raw.map((a) => String(a ?? '').trim());
  const org = (value: string, mine: boolean) => {
    const v = value.toLowerCase();
    const o = l.orgs.find((x) => x.id === value || x.name.toLowerCase() === v);
    return o && (!mine || o.member) ? o : undefined;
  };
  switch (type as SocietyStepType) {
    case 'found_org': {
      if (!ORG_KIND_KEYS.includes(args[0])) return 'unknown organization kind';
      const name = (args[1] ?? '').replace(/[|\n\r\t]+/g, ' ').slice(0, 40);
      return { args: [args[0], name], label: 'Found a ' + args[0] };
    }
    case 'join_org':
    case 'leave_org': {
      const o = org(args[0], type === 'leave_org');
      if (!o) return 'unknown organization';
      if (type === 'join_org' && o.member) return 'already a member';
      return { args: [o.id], label: (type === 'join_org' ? 'Join ' : 'Leave ') + o.name };
    }
    case 'recruit': {
      const who = l.living(args[0]);
      const o = org(args[1] ?? '', true) ?? l.orgs.find((x) => x.member);
      if (!who) return 'unknown or dead person';
      if (!o) return 'not a member of any organization';
      return { args: [who.id, o.id], label: 'Recruit ' + who.name + ' for ' + o.name };
    }
    case 'preach': {
      const o = org(args[0] ?? '', true);
      const topic = o ? o.id : (args[0] ?? '').replace(/[|\n\r\t]+/g, ' ').slice(0, 80);
      if (!topic) return 'nothing to preach';
      return { args: [topic], label: o ? 'Preach for ' + o.name : 'Preach' };
    }
    case 'org_action': {
      const o = org(args[0], true);
      if (!o) return 'not a member of that organization';
      if (!(ORG_ACTIONS as readonly string[]).includes(args[1])) return 'unknown action';
      if (['expel', 'declare_rules', 'trade_deal'].includes(args[1]) && !o.leader) return 'only the leader can do that';
      if (args[1] === 'declare_rules' && o.kind !== 'breakaway') return 'only a breakaway declares rules';
      if (args[1] === 'work' && o.kind !== 'company') return 'only a company has shifts';
      return { args: [o.id, args[1]], label: args[1].replace('_', ' ') + ' with ' + o.name };
    }
    case 'study':
    case 'teach': {
      const skill = type === 'study' ? args[0] : args[1];
      if (!(STUDY_SKILLS as readonly string[]).includes(skill)) return 'unknown skill';
      if (type === 'study') {
        const n = clampInt(args[1], 2, 18) ?? 9;
        return { args: [skill, String(n)], label: 'Study ' + skill };
      }
      const who = l.living(args[0]);
      if (!who) return 'unknown or dead person';
      return { args: [who.id, skill], label: 'Teach ' + who.name + ' ' + skill };
    }
    case 'apply_job': {
      const occ = OCCUPATIONS.find((o) => o.id === args[0] && !['resident', 'councilor', 'quartermaster'].includes(o.id));
      if (!occ) return 'unknown occupation';
      return { args: [occ.id], label: 'Apply to be a ' + occ.label.toLowerCase() };
    }
    case 'build': {
      const def = STRUCTURE_BY_KEY[args[0]];
      if (!def) return 'unknown structure';
      if (def.requires && !l.discovered.includes(def.requires)) return 'needs a discovery first';
      return { args: [def.key], label: 'Build a ' + def.name };
    }
    case 'experiment':
    case 'perform': {
      const n = clampInt(args[0], 2, type === 'perform' ? 6 : 18);
      if (n === null) return 'bad tick count';
      return { args: [String(n)], label: type === 'perform' ? 'Perform' : 'Experiment' };
    }
    case 'create_art': {
      const k = ART_KINDS.find((x) => x.key === args[0] && (!x.requires || l.discovered.includes(x.requires)));
      if (!k) return 'unknown or unavailable art kind';
      return { args: [k.key], label: 'Make a ' + k.label };
    }
    case 'adopt_pet': {
      const s = PET_SPECIES.find((x) => x.key === args[0] && (!x.requires || l.discovered.includes(x.requires)));
      if (!s) return 'unknown or unavailable species';
      return { args: [s.key], label: 'Adopt a ' + s.label };
    }
    case 'care': {
      const v = args[0].toLowerCase();
      const pet = l.pets.find((p) => p.id === args[0] || p.name.toLowerCase() === v);
      if (pet) return { args: [pet.id], label: 'Look after ' + pet.name };
      const child = l.children.find((c) => c.id === args[0] || c.name.toLowerCase() === v) ?? (() => {
        const who = l.living(args[0]);
        return who ? l.children.find((c) => c.id === who.id) : undefined;
      })();
      if (!child) return 'not your child or pet';
      return { args: [child.id], label: 'Look after ' + child.name };
    }
    case 'propose': {
      const who = l.living(args[0]);
      if (!who) return 'unknown or dead person';
      return { args: [who.id], label: 'Propose to ' + who.name };
    }
    case 'fight': case 'duel': case 'rob': case 'extort': case 'intimidate': case 'chase': case 'kiss': case 'spy': case 'gloat': case 'rush': case 'inspect': {
      const who = l.living(args[0]);
      if (!who) return 'unknown or dead person';
      return { args: [who.id], label: type.charAt(0).toUpperCase() + type.slice(1) + ' ' + who.name };
    }
    case 'gamble': case 'carouse': case 'dance': case 'pray': case 'cry': case 'celebrate': {
      const n = clampInt(args[0] || '2', 1, 3) ?? 2;
      return { args: [String(n)], label: type.charAt(0).toUpperCase() + type.slice(1) };
    }
    case 'ritual': {
      const o = org(args[0], true);
      if (!o) return 'not your organization';
      return { args: [o.id], label: 'Lead a rite of ' + o.name };
    }
    case 'vandalize': case 'loot':
      return { args: [''], label: type === 'loot' ? 'Loot what is here' : 'Smash things up here' };
  }
  return 'not supported';
}
