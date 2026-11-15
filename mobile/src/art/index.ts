/**
 * The single place the client gets its art from. Everything else imports MANIFEST from here and
 * reads sizes and positions from it.
 *
 * To switch between placeholder and real art, change the one import below:
 *   placeholder: import { PLACEHOLDER_MANIFEST as ART } from '../dev/placeholderArt/manifest';
 *   real art:    import { MANIFEST as ART } from '../../assets/game/manifest';
 */
import type { AssetManifest } from '../../shared/assets';
import { MANIFEST as ART } from '../../assets/game/manifest';

export const MANIFEST: AssetManifest = ART;

/** Client-owned UI art that is not part of the art contract: one row of activity emotes. */
export const EMOTES = {
  source: require('../ui/assets/emotes.png') as number,
  /** Cell size in the sheet; each cell is a small bubble with a tail. */
  width: 20,
  height: 24,
  /** Column of each emote in the sheet. */
  columns: {
    working: 0,
    eating: 1,
    drinking: 2,
    sleeping: 3,
    resting: 4,
    talking: 5,
    trading: 6,
    giving: 7,
    helping: 8,
    stealing: 9,
    investigating: 10,
    fleeing: 11,
    mourning: 12,
  } as Record<string, number>,
};
