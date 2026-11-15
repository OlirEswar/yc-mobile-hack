/** Every god power by type, each as one parse-then-apply step for interventions:apply. */
import type { PowerType } from '../../shared/types';
import type { Tx } from '../engine/core';
import { createCharacter } from './arrival';
import { grant, kill } from './colonists';
import { isFailure } from './common';
import type { Power, PowerFailure, PowerOutcome } from './common';
import { drought, storm } from './environment';
import { rumor, whisper } from './ideas';

export type PowerRun = (tx: Tx, raw: unknown) => Promise<PowerOutcome | PowerFailure>;

/** Parses the raw params and, only when they are valid, applies the power. */
function runner<P>(power: Power<P>): PowerRun {
  return async (tx, raw) => {
    const params = await power.parse(tx, raw);
    return isFailure(params) ? params : await power.apply(tx, params as P);
  };
}

export const POWERS: Record<PowerType, PowerRun> = {
  drought: runner(drought),
  storm: runner(storm),
  grant: runner(grant),
  kill: runner(kill),
  whisper: runner(whisper),
  rumor: runner(rumor),
  create_character: runner(createCharacter),
};
