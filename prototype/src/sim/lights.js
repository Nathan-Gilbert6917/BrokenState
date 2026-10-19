// Lights: what your people carry to see in the dark. Seven:
//   headlamp   0.2 kg  strapped on, hands free (counts wherever it is carried); a wide beam 8 tiles ahead
//   windlight  0.4 kg  a wind-up flashlight in the off hand: no batteries, a dim beam 7 tiles ahead
//   flashlight 0.3 kg  in the off hand; a beam 9 tiles ahead
//   tacflash   0.35 kg a military flashlight in the off hand: the longest, narrowest beam, 12 tiles
//   torch      0.7 kg  in the off hand; a pool of light 4 tiles all round, an open flame seen from further off; made
//                      from firewood, no batteries
//   lantern    1.2 kg  in the off hand; a pool 5 tiles all round
//   spotlight  3.5 kg  in the off hand; 11 tiles down a broad beam, seen from far away
// In battle (vision.js) a beam shines the way its carrier faces and is what they see by at night (sight: its length,
// beam: its half-angle in degrees); a pool lights all round them (pool: its radius); the dark around stays the
// night's own (vision.js DARK, by the hour). sight is also the light's single number for everything else (u.sight
// at night, the survey, the brighter of two).
// At night (raids, base battles: stealth.js) a light switched on sets how far its carrier sees (7 without one, 13 by
// day, 12 down the cone with night vision on) and how much further off the guards notice them (`seen`, added to the
// night detection range; an enemy person who sees it knows they are there: combat.js lightSpotted); a light switched
// off counts as none (vision.js activeLight; the battle's Light on / off, free); a
// rummage in the dark without one is heard further and cuts hands more often (search.js). A survey's night hours keep
// `survey` of the daylight odds with the team's best light (survey.js; 0.35 without). Teams take lights from the
// armory when they set out: the planner's Lights line (parties.js launchExpedition opts.lights) and the autopilot's and
// crews' trips (kit.js packTripKit): one each, the lightest first, and only lights that will work (an off-hand light
// only for someone whose off hand is free; a headlamp for anyone).
import { GEAR } from "./data.js";
import { EQUIP_SLOTS, packOf, stow } from "./inventory.js";
import { helmetLight } from "./helmets.js";
import { SURV_LIGHTS } from "./data-survival.js"; // the angle-head flashlight, the solar lantern

export const LIGHTS = {
  headlamp:   { sight: 8,  seen: 1, survey: 0.42, free: true,  cone: 3.5, beam: 30, name: "headlamp" },
  windlight:  { sight: 7,  seen: 2, survey: 0.4,  free: false, cone: 3.5, beam: 24, name: "wind-up flashlight" },
  flashlight: { sight: 9,  seen: 3, survey: 0.5,  free: false, cone: 4.5, beam: 20, name: "flashlight" },
  tacflash:   { sight: 12, seen: 3, survey: 0.6,  free: false, cone: 4.5, beam: 15, name: "military flashlight" },
  torch:      { sight: 9,  seen: 4, survey: 0.45, free: false, round: true, cone: 3.5, pool: 4, name: "torch" },
  lantern:    { sight: 10, seen: 4, survey: 0.55, free: false, round: true, cone: 4.5, pool: 5, name: "lantern" },
  spotlight:  { sight: 11, seen: 6, survey: 0.7,  free: false, cone: 7.5, beam: 18, name: "spotlight" },
};
Object.assign(LIGHTS, SURV_LIGHTS); // survival gear (data-survival.js): an angle-head flashlight (hands free), a solar lantern
// The order a team packs them in (lightest first) and the order "best" is judged in (brightest first).
export const LIGHT_KEYS = Object.keys(LIGHTS).sort((a, b) => (GEAR[a]?.weight || 0) - (GEAR[b]?.weight || 0));
const brighter = (a, b) => (!a ? b : !b ? a : LIGHTS[b].sight > LIGHTS[a].sight ? b : a);

// Everything a person carries (worn, pockets, pack).
function carriedItems(s) {
  if (!s) return [];
  const out = [];
  for (const slot of EQUIP_SLOTS) if (s.gear && s.gear[slot]) out.push(s.gear[slot]);
  for (const it of s.pockets || []) if (it) out.push(it);
  for (const it of packOf(s) || []) if (it) out.push(it);
  return out;
}

// The light a person has working: the off-hand one, or a headlamp carried anywhere; the brighter of the two.
// Returns the key or null.
export function lightOf(s) {
  if (!s || !s.gear) return null;
  const tool = s.gear.tool;
  let best = tool && LIGHTS[tool.key] ? tool.key : null;
  for (const it of carriedItems(s)) if (LIGHTS[it.key] && LIGHTS[it.key].free) best = brighter(best, it.key);
  const gun = s.gear.weapon; // a weapon light on the gun (gunmods.js): a flashlight that leaves the off hand free
  if (gun && gun.mods && gun.mods.tactical && gun.mods.tactical.key === "weaponlight" && LIGHTS.flashlight) best = brighter(best, "flashlight");
  if (helmetLight(s) && LIGHTS.flashlight) best = brighter(best, "flashlight"); // a helmet light (helmets.js): a flashlight, hands free
  return best;
}
export const hasLight = (s) => !!lightOf(s);

// The best survey light among a team's kit keys (survey.js: the people's things and the cargo).
export function surveyLight(keys) {
  let v = 0;
  for (const k of keys) if (LIGHTS[k]) v = Math.max(v, LIGHTS[k].survey);
  return v;
}

// One light each from the base armory for those without a working one, the lightest that will work for them.
// Returns the names of what went along; `into` (an array) also gets the items (unpackLights puts them back).
export function packLights(base, crew, into = null) {
  if (!base || !base.armory) return [];
  const out = [];
  for (const s of crew) {
    if (hasLight(s)) continue;
    const handFree = !(s.gear && s.gear.tool);
    for (const key of LIGHT_KEYS) {
      if (!LIGHTS[key].free && !handFree) continue;
      const i = base.armory.findIndex((it) => it && it.key === key);
      if (i < 0) continue;
      const it = base.armory[i];
      if (!stow(s, it)) continue;
      if (!hasLight(s)) { unstow(s, it); continue; } // went into a pocket where it does not help
      base.armory.splice(i, 1);
      out.push(it.name);
      if (into) into.push(it);
      break;
    }
  }
  return out;
}
// Puts lights packed with packLights(…, into) back in the armory (a launch that failed after packing).
export function unpackLights(base, crew, items) {
  for (const it of items) for (const s of crew) unstow(s, it);
  base.armory.push(...items);
}
// Takes an item back off a person (packLights trying a light that would not work where it went).
function unstow(s, it) {
  for (const slot of EQUIP_SLOTS) if (s.gear[slot] === it) s.gear[slot] = null;
  if (s.pockets) { const i = s.pockets.indexOf(it); if (i >= 0) s.pockets[i] = null; }
  const pk = packOf(s);
  if (pk) { const i = pk.indexOf(it); if (i >= 0) pk[i] = null; }
}

// What packLights would take for this crew from this armory, without moving anything (the planner's Lights line).
// Returns { names, kg }.
export function lightsPreview(base, crew) {
  const pool = [...((base && base.armory) || [])];
  const names = [];
  let kg = 0;
  for (const s of crew) {
    if (hasLight(s)) continue;
    const handFree = !(s.gear && s.gear.tool);
    for (const key of LIGHT_KEYS) {
      if (!LIGHTS[key].free && !handFree) continue;
      const i = pool.findIndex((it) => it && it.key === key);
      if (i < 0) continue;
      names.push(pool[i].name);
      kg += GEAR[key].weight || 0;
      pool.splice(i, 1);
      break;
    }
  }
  return { names, kg: Math.round(kg * 10) / 10 };
}
// How many of a crew have a working light now.
export const litCount = (crew) => crew.filter(hasLight).length;
