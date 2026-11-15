/**
 * TEMPORARY STUB written by the storyteller owner so the LLM validator compiles before the society
 * owner's real module lands. The society owner replaces this file; keep the signature.
 * Resolves the args of a society step (STEP_SPECS from society/steps.ts) to stored values and a
 * fallback label, or returns why they are invalid.
 */
export type SocietyLookup = {
  here: string;
  living: (value: string) => { id: string; name: string } | undefined;
  person: (value: string) => { id: string; name: string; alive: boolean } | undefined;
};

export function validateSocietyArgs(_type: string, _args: string[], _lookup: SocietyLookup): { args: string[]; label: string } | string {
  return 'not supported yet';
}
