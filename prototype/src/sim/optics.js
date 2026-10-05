// Optics: binoculars, monoculars, a spotting scope, a thermal imager and a telescope (data.js GEAR optics).
//
// Carried by anyone on a team (hands, pockets, pack, or the team's cargo), the best item counts in full and the next
// best adds a quarter of its bonus (never more than OPTICS.cap on the look). What they do:
//   look   × the odds of spotting hidden places and finds: the Survey mission (survey.js), Look around and a recon's
//          look (parties.js survey), capped at OPTICS.cap
//   reach  tiles further a survey looks well (its odds fall off with the distance from the team)
//   sight  tiles more the team sees on the map (parties.js sightRadius): hordes, raiders and places sooner
//   spot   + the chance the team sees the other side first on the road (conflicts.js spotFirstChance), more for a
//          thermal at night
//   night / fog  what is left of the dark's and the fog's penalty when the team looks (1 = none): a thermal 0.9
//   still  a spotting scope works only while the team stays put (surveying, looking around, camping, waiting)
//   base   a telescope in a base's armory: +1 tile of the base's view, +2 with a watchtower (world.js baseVision)
// In a battle a thermal monocular in the off hand sees at night like night vision goggles (stealth.js).
// Nothing here uses random numbers.
import { GEAR } from "./data.js";
import { carriedAll } from "./comforts.js";

export const OPTICS = { second: 0.25, cap: 1.75, maxReach: 2, maxSight: 1, maxSpot: 0.15 };
export const OPTIC_KEYS = Object.keys(GEAR).filter((k) => GEAR[k].optics && !GEAR[k].optics.base);

// Every optics item the people carry and the cargo holds (keys, best first by look).
export function opticsCarried(members, cargo = null) {
  const keys = [];
  for (const s of members || []) for (const it of carriedAll(s)) if (it && GEAR[it.key] && GEAR[it.key].optics && !GEAR[it.key].optics.base) keys.push(it.key);
  for (const it of (cargo && cargo.gear) || []) if (it && GEAR[it.key] && GEAR[it.key].optics && !GEAR[it.key].optics.base) keys.push(it.key);
  return keys.sort((a, b) => (GEAR[b].optics.look || 1) - (GEAR[a].optics.look || 1) || a.localeCompare(b));
}

// What the team's optics add now. still: the team stays put (a spotting scope works); night / fog: the conditions.
// Returns { look, reach, sight, spot, night, fog, items, best, text }.
export function opticsFor(members, cargo = null, { still = false, night = false, fog = false } = {}) {
  const usable = [...new Set(opticsCarried(members, cargo))].filter((k) => still || !GEAR[k].optics.still);
  const out = { look: 1, reach: 0, sight: 0, spot: 0, night: null, fog: null, items: usable, best: usable[0] || null, text: "" };
  if (!usable.length) return out;
  const o = (k) => GEAR[k].optics;
  // The best for looking, and a quarter of the next one.
  const byLook = [...usable].sort((a, b) => (o(b).look || 1) - (o(a).look || 1));
  out.look = Math.min(OPTICS.cap, (o(byLook[0]).look || 1) + (byLook[1] ? ((o(byLook[1]).look || 1) - 1) * OPTICS.second : 0));
  out.reach = Math.min(OPTICS.maxReach, Math.max(...usable.map((k) => o(k).reach || 0)));
  out.sight = Math.min(OPTICS.maxSight, Math.max(...usable.map((k) => o(k).sight || 0)));
  const nightEye = usable.filter((k) => o(k).night != null);
  out.night = nightEye.length ? Math.max(...nightEye.map((k) => o(k).night)) : null;
  const fogEye = usable.filter((k) => o(k).fog != null);
  out.fog = fogEye.length ? Math.max(...fogEye.map((k) => o(k).fog)) : null;
  // Spotting the other side first: in the dark only a thermal helps much (and more than by day).
  const spotOf = (k) => (night ? (o(k).night != null ? (o(k).spot || 0) * 2 : (o(k).spot || 0) * 0.3) : (o(k).spot || 0));
  out.spot = Math.min(OPTICS.maxSpot, Math.max(...usable.map(spotOf)));
  // By day binoculars show a tile further; at night only a thermal does, and fog takes it away unless thermal.
  if (night || fog) out.sight = usable.some((k) => o(k).night != null) ? out.sight || 1 : 0;
  out.text = `${GEAR[out.best].name.toLowerCase()}${usable.length > 1 ? ` (+${usable.length - 1} more)` : ""}`;
  return out;
}

// In battle: tiles of sight an optic adds to whoever carries it (anywhere on them). By day binoculars and a spotting
// scope +3, a monocular or a thermal +2; at night only a thermal (+2; it also sees in the dark from the off hand).
export const BATTLE_OPTICS = { binoculars: 3, spotscope: 3, monocular: 2, thermal: 2 };
export function battleOptic(s, night = false) {
  let best = 0;
  for (const it of carriedAll(s)) {
    const v = it && BATTLE_OPTICS[it.key];
    if (v && (!night || GEAR[it.key].optics.night != null)) best = Math.max(best, v);
  }
  return best;
}

// A telescope in the base's armory: tiles added to its view.
export function baseOpticsSight(base) {
  if (!base || !base.armory || !base.armory.length) return 0;
  let best = 0;
  for (const it of base.armory) {
    const b = it && GEAR[it.key] && GEAR[it.key].optics && GEAR[it.key].optics.base;
    if (b) best = Math.max(best, base.watchtower ? b.tower || b.sight : b.sight);
  }
  return best;
}
