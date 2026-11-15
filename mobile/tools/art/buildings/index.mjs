/** Every building painter, keyed by LocationId. */
import { paintCanteen, paintMarket, paintPlaza } from './civic.mjs';
import { paintDepot, paintHydroponics, paintMedbay, paintWorkshop } from './core.mjs';
import { paintHabitatA, paintHabitatB } from './homes.mjs';
import { paintDamage } from './damage.mjs';
import { paintIceWells, paintLandingPad, paintObservatory, paintQuarry, paintSolarFarm } from './sites.mjs';

const PAINTERS = {
  plaza: paintPlaza,
  market: paintMarket,
  canteen: paintCanteen,
  hydroponics: paintHydroponics,
  depot: paintDepot,
  workshop: paintWorkshop,
  medbay: paintMedbay,
  habitat_a: paintHabitatA,
  habitat_b: paintHabitatB,
  ice_wells: paintIceWells,
  quarry: paintQuarry,
  solar_farm: paintSolarFarm,
  observatory: paintObservatory,
  landing_pad: paintLandingPad,
};

/** Paints one building's base, overlay and damaged layers. */
export function paintBuilding(id, seed) {
  const b = PAINTERS[id]();
  paintDamage(b, seed);
  return b;
}
