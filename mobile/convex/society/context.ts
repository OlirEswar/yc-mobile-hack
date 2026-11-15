/**
 * TEMPORARY STUB written by the storyteller owner so prompts can include society context before the
 * society owner's real module lands. The society owner replaces this file; keep the signature.
 * Returns short lines in words, never numbers: organizations, family, pets, status in words,
 * obsession, works, education, e.g. "Founded the Rust Choir, a troupe that sings in the tubes".
 */
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function societyContext(_ctx: QueryCtx, _agent: Doc<'agents'>, _mind: Doc<'minds'>): Promise<string[]> {
  return [];
}
