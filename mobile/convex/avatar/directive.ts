/**
 * The rule-based answer to a player's directive: a short plan the avatar starts at once, read from
 * keywords. The LLM, when configured, is asked for a better plan in the same breath and replaces
 * this one if it arrives in time.
 */
import { LOCATIONS, LOCATION_IDS, TRADED_RESOURCES } from '../../shared/colony';
import type { LocationId } from '../../shared/colony';
import { encodeStep } from '../engine/core';

type Planned = { intent: string; steps: string[]; labels: string[] };

/** Words that name a place, checked in order; the first match wins. */
const PLACE_WORDS: [RegExp, LocationId][] = [
  [/\b(med ?bay|clinic|doctor|medic|medicine|hospital|sick|heal)\b/i, 'medbay'],
  [/\b(market|exchange|stall|shop|trade|trading|buy|sell|bargain)\b/i, 'market'],
  [/\b(canteen|bar|drink|eat|food|meal|dinner|lunch|breakfast|coffee|hang ?out|party)\b/i, 'canteen'],
  [/\b(hydroponics?|farm|garden|plants?|grow)\b/i, 'hydroponics'],
  [/\b(depot|reserve|supplies|ration|quartermaster)\b/i, 'depot'],
  [/\b(workshop|works|fabricat\w*|printer|forge|build|repair|fix)\b/i, 'workshop'],
  [/\b(ice ?wells?|water|drill)\b/i, 'ice_wells'],
  [/\b(quarry|regolith|dig)\b/i, 'quarry'],
  [/\b(solar|panels?|power)\b/i, 'solar_farm'],
  [/\b(observatory|telescope|stars|research|science|lab)\b/i, 'observatory'],
  [/\b(landing ?pad|shuttle|dock|arrivals?)\b/i, 'landing_pad'],
  [/\b(plaza|council|commons|petition|vote|politics|speech)\b/i, 'plaza'],
];

/** The place a directive is about: a place name, then a keyword. */
export function placeIn(text: string): LocationId | undefined {
  const lower = text.toLowerCase();
  const named = LOCATION_IDS.find((id) => lower.includes(LOCATIONS[id].name.toLowerCase()) || lower.includes(id.replace('_', ' ')));
  return named ?? PLACE_WORDS.find(([re]) => re.test(text))?.[1];
}

export function planDirective(text: string, a: { name: string; locationId: string; homeLocationId: string; workLocationId?: string }): Planned {
  const first = a.name.split(' ')[0];
  const steps: string[] = [];
  const labels: string[] = [];
  const go = (to: string) => {
    if (to === a.locationId && steps.length === 0) return;
    steps.push(encodeStep('go', to));
    labels.push('Walk to ' + (LOCATIONS[to as LocationId]?.name ?? to));
  };
  const add = (step: string, label: string) => {
    steps.push(step);
    labels.push(label);
  };
  const resource = TRADED_RESOURCES.find((r) => new RegExp('\\b' + r + '\\b', 'i').test(text));

  if (/\b(sleep|nap|bed|rest|relax|chill)\b/i.test(text)) {
    go(a.homeLocationId);
    add(encodeStep(/sleep|bed|nap/i.test(text) ? 'sleep' : 'rest', /sleep|bed/i.test(text) ? 36 : 12), 'Get some rest at home');
  } else if (/\b(work|shift|job)\b/i.test(text) && a.workLocationId) {
    go(a.workLocationId);
    add(encodeStep('work', 24), 'Put in a long shift');
  } else if (/\b(buy|stock up|get some)\b/i.test(text)) {
    go('market');
    add(encodeStep('buy', resource ?? 'food', 3), 'Buy ' + (resource ?? 'food') + ' at the Exchange');
  } else if (/\b(sell)\b/i.test(text)) {
    go('market');
    add(encodeStep('sell', resource ?? 'parts', 2), 'Sell ' + (resource ?? 'parts') + ' at the Exchange');
  } else if (/\b(eat|meal|dinner|lunch|breakfast|food)\b/i.test(text)) {
    go('canteen');
    add(encodeStep('eat'), 'Eat at the canteen');
  } else if (/\b(drink|thirsty)\b/i.test(text)) {
    go('canteen');
    add(encodeStep('drink'), 'Get a drink at the canteen');
  } else if (/\b(repair|fix)\b/i.test(text)) {
    const place = placeIn(text.replace(/\b(repair|fix)\b/gi, '')) ?? 'workshop';
    go(place);
    add(encodeStep('repair', place), 'Repair ' + LOCATIONS[place].name);
  } else if (/\b(council|petition|vote|campaign|politic\w*)\b/i.test(text)) {
    const topic = /\b(share|open|everyone|ration)\b/i.test(text) ? 'rations_open' : /\b(trade|market|prices?)\b/i.test(text) ? 'trade' : /\b(guard|lock|save)\b/i.test(text) ? 'rations_guard' : 'seat';
    go('plaza');
    add(encodeStep('petition', topic), 'Speak at the council');
  } else if (/\b(explore|tour|look around|wander|see everything)\b/i.test(text)) {
    for (const place of ['observatory', 'market', 'hydroponics'] as LocationId[]) {
      go(place);
      add(encodeStep('rest', 2), 'Look around ' + LOCATIONS[place].name);
    }
  } else {
    const place = placeIn(text) ?? (/\b(friends?|meet|talk|people|social|chat)\b/i.test(text) ? 'canteen' : 'plaza');
    go(place);
    add(encodeStep('rest', 6), (/\b(friends?|meet|talk|people|social|chat)\b/i.test(text) ? 'Meet people at ' : 'Spend time at ') + LOCATIONS[place].name);
  }
  return { intent: first + ' does what their player asked: ' + text, steps, labels };
}
