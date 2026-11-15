/**
 * The society layer's plan steps (docs/STORY_SPEC.md 8). Plain data with no imports, so engine/core.ts
 * can merge it into STEP_SPECS without an import cycle. The society module (convex/society) executes
 * them through startSocietyStep / finishSocietyStep; the LLM validator checks them by arg name.
 */
export const SOCIETY_STEP_SPECS = {
  found_org: { args: ['kind', 'name'], about: 'Found an organization: company, guild, cult, gang, militia, party, school, troupe or breakaway (a defector colony with its own rules).' },
  join_org: { args: ['orgId'], about: 'Ask to join an organization whose member or leader is present.' },
  leave_org: { args: ['orgId'], about: 'Quit an organization, quietly or loudly.' },
  recruit: { args: ['agentId', 'orgId'], about: 'Try to bring someone at the same location into your organization.' },
  preach: { args: ['topic'], about: 'Speak publicly for a creed, cause or organization; sways listeners by charisma and status.' },
  org_action: { args: ['orgId', 'action'], about: 'Act for your organization: "meeting", "dues", "raid", "protect", "trade_deal", "ritual", "expel", "declare_rules".' },
  study: { args: ['skill', 'ticks'], about: 'Study a skill at the Observatory school, from a teacher, or alone.' },
  teach: { args: ['agentId', 'skill'], about: 'Teach someone a skill you know.' },
  apply_job: { args: ['occupation'], about: 'Apply for a different job; hiring depends on skill, openings and who is hiring.' },
  build: { args: ['structureKey'], about: 'Work on building a structure from STRUCTURES (needs resources and possibly a discovery).' },
  experiment: { args: ['ticks'], about: 'Tinker, research or experiment toward a discovery from DISCOVERIES.' },
  create_art: { args: ['kind'], about: 'Make art: mural, song, poem, sculpture, play, holo or story. Quality depends on skill, mood and inspiration.' },
  perform: { args: ['ticks'], about: 'Perform or show work to whoever is present at the canteen or plaza.' },
  adopt_pet: { args: ['species'], about: 'Take in a pet (cat, dog, lab rat, cricket colony, gecko) if one is available and they can feed it.' },
  care: { args: ['targetId'], about: 'Look after a child or pet: feed, teach, play, comfort.' },
  propose: { args: ['agentId'], about: 'Ask a partner to marry or to raise a child together.' },
} as const;
