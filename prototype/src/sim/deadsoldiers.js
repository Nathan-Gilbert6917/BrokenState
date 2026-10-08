// The dead who still wear their armour: soldiers (ZTYPES.soldier, a plate carrier and a combat helmet) and riot
// police (ZTYPES.riot, hard-shell riot gear). Their stats as special dead are in hiveconst.js ZTYPES; this module has
// what is theirs alone (every number in MILDEAD):
// - Armour by weapon (armorVs, called by combat.js damage): × the damage a hit does, by the weapon that struck.
//   A soldier's plates stop pistol rounds and blades (×0.4–0.5); rifles get through better (×0.7–0.75); blunt blows
//   still break what is under the plate (bat ×0.85, sledge ×1). Fire and pipe bombs ignore it (fire ×1, blast ×0.85).
//   A critical hit always gets through (a round under the helmet's rim, a blade in a gap), and so does a blade from
//   behind or on one that has not noticed you (a knife to the base of the skull). Riot gear is the other way round:
//   blows and blades glance off, buckshot mostly, rifle rounds go straight through.
// - Where they are (siteDeadMix): the share of them among the dead at a site, as a horde's mix ({ soldier: 0.45 }),
//   turned into units by zombietypes.js battleTypes. National Guard bases and army helicopter wrecks are full of
//   them, the ground right around a military site (the cordon's checkpoints) has a few, a fallen military base
//   (hardcore) most of all; police stations and prisons have riot police, city centres a few. Anywhere else a lone
//   soldier now and then (RARE). Deterministic (no world dice): the same site has the same dead.
// - Hordes crossing a military site pick a few of them up (hordeMilitaryPickup).
// - What their bodies hold (bodyLoot): worn-out armour, a helmet, rounds, now and then a rifle, a radio or a smoke
//   grenade; riot police their helmet, guards, a baton, cuffs.
import { LOCATIONS } from "./data.js";
import { hash01 } from "./skills.js";
import { mergeMix } from "./zombietypes.js";
import { swarmArmor } from "./carriers.js";
import { truckDeadShare } from "./miltrucks.js";
import { ammoPen, CALIBERS } from "./data-ammo.js";
import { roundOf, AR } from "./armour.js";
import { WEAPONS } from "./combat.js";

export const MILDEAD = {
  // × damage by weapon key (combat.js WEAPONS); other: anything not listed of that kind (shot / melee).
  ARMOR: {
    soldier: {
      shot: 0.6, melee: 0.6, bash: 0.8, fire: 1, blast: 0.85, trap: 0.8,
      w: {
        pistol: 0.5, revolver: 0.6, shotgun: 0.6, pipegun: 0.6, crossbow: 0.5, compbow: 0.45, xbow: 0.55,
        huntrifle: 0.75, leverrifle: 0.7, carbine: 0.75, ar: 0.75, acid: 1, // rifles: was 0.9 / 0.8 / 0.85 / 0.85 (the hunting rifle all but a full counter)
        fists: 0.55, knife: 0.4, machete: 0.5, sawmachete: 0.5, springmachete: 0.55, pipespear: 0.45, spear: 0.45, fireaxe: 0.75, pulleybow: 0.45,
        bat: 0.85, spikedbat: 0.8, nailbat: 0.8, prybar: 0.85, sledge: 1, baton: 0.75, claws: 0.7,
      },
    },
    riot: {
      shot: 0.8, melee: 0.55, bash: 0.6, fire: 0.9, blast: 0.9, trap: 0.7,
      w: {
        pistol: 0.7, revolver: 0.8, shotgun: 0.75, pipegun: 0.75, crossbow: 0.7, compbow: 0.65, xbow: 0.7,
        huntrifle: 1, leverrifle: 1, carbine: 1, ar: 1, acid: 1,
        fists: 0.4, knife: 0.45, machete: 0.55, sawmachete: 0.55, springmachete: 0.6, pipespear: 0.5, spear: 0.5, fireaxe: 0.65, pulleybow: 0.65,
        bat: 0.6, spikedbat: 0.6, nailbat: 0.6, prybar: 0.6, sledge: 0.8, baton: 0.5, claws: 0.6,
      },
    },
  },
  // Weapons not in the tables above (the overhaul's guns and melee weapons): by calibre, by melee class (w.mclass).
  CAL: {
    soldier: { "22lr": 0.35, "9mm": 0.5, "45acp": 0.5, "357": 0.6, "12ga": 0.6, "556": 0.75, "762x39": 0.75, "308": 0.8, "3030": 0.7, "50bmg": 1 },
    riot: { "22lr": 0.5, "9mm": 0.7, "45acp": 0.7, "357": 0.7, "12ga": 0.75, "556": 1, "762x39": 1, "308": 1, "3030": 1, "50bmg": 1 },
  },
  MCLASS: {
    soldier: { blade: 0.45, pierce: 0.85, chop: 0.7, blunt: 0.85, heavy: 1 },
    riot: { blade: 0.5, pierce: 0.75, chop: 0.6, blunt: 0.6, heavy: 0.8 },
  },
  // Their plates wear (plateDur 1 → 0, a dead soldier's or riot cop's own): the plate as a piece (armour.js wear rule),
  // and how far the round's penetration over the weapon's common round moves the multiplier (PEN_SPAN a step).
  PLATE: { soldier: { dmax: 45, mat: "ceramic" }, riot: { dmax: 25, mat: "hard" } }, PEN_SPAN: 40, PEN_CLAMP: [0.2, 1.6],
  // Blades that find the gap from behind or on the unaware (armour ignored).
  STAB: ["knife", "machete", "sawmachete", "springmachete", "pipespear", "spear", "fireaxe"],
  // Share among a site's dead, by site type; NEAR: within 1 tile of a military site (the cordon), ROAD: within 2 on a
  // road (the abandoned checkpoints); FALLEN: a fallen military base (hardcore) and the tiles around it.
  SITE: { military: { soldier: 0.45 }, crash_mil: { soldier: 0.5 }, convoy: { soldier: 0.55 }, police: { riot: 0.3 }, prison: { riot: 0.2 }, city: { riot: 0.05 } },
  NEAR: 0.15, ROAD: 0.08, FALLEN: [0.6, 0.3],
  CHECKPOINT: 0.5, // a city crawl's barricaded checkpoint (citycrawl.js): the soldiers who held it
  RARE: 0.03, // a lone soldier among the dead anywhere else (per site and week)
  // Hordes: crossing a military site, its soldiers join up to this share (no more once it has as many).
  HORDE_ADD: 0.06, HORDE_MAX: 0.15,
  // The hour-by-hour search (scavenge.js): + threat per point of the mix's extra weight; a won fight leaves one of
  // them to search at share × SEARCH_BODY (at most 80%).
  SEARCH_THREAT: 4, SEARCH_BODY: 1.2,
  // Bodies: [key, chance, quality range] for items; [supply, chance, lo, hi] for supplies.
  BODY: {
    soldier: {
      armor: [["plate", 0.15, [0.3, 0.55]], ["vest", 0.3, [0.35, 0.6]]], // one or the other
      items: [["milhelmet", 0.35, [0.4, 0.7]], ["ar", 0.04, [0.4, 0.6]], ["carbine", 0.03, [0.4, 0.6]], ["milradio", 0.05, [0.5, 0.8]], ["smokegren", 0.06, [1, 1]], ["flare", 0.05, [1, 1]], ["bandagekit", 0.08, [0.6, 1]], ["assaultpack", 0.05, [0.4, 0.6]], ["instcoffee", 0.06, [1, 1]], ["chocolate", 0.06, [1, 1]]],
      sup: [["a_556_fmj", 0.6, 3, 10], ["a_556_ap", 0.15, 10, 20], ["meds", 0.08, 1, 1]], // 5.56 rounds (ammo.js); the second: a rifle magazine of armour-piercing
    },
    riot: {
      armor: [["vest", 0.15, [0.35, 0.6]]],
      items: [["riothelmet", 0.35, [0.4, 0.7]], ["riotarms", 0.15, [0.4, 0.7]], ["riotlegs", 0.12, [0.4, 0.7]], ["baton", 0.12, [0.6, 0.9]], ["cuffs", 0.15, [1, 1]], ["pistol", 0.04, [0.4, 0.6]], ["flashlight", 0.06, [0.6, 0.9]]],
      sup: [["a_12ga_beanbag", 0.3, 3, 8]], // their riot gun's less-lethal shells (ammo.js; police and prisons only)
    },
  },
  // More on them now and then, by dice of their own (a hash of the body's dice position: no draw, so the rest of the
  // body is as it was): a soldier's flashbang, a riot cop's smoke grenade or flashbang (throwables.js FLASH).
  BODY_EXTRA: {
    soldier: [["flashbang", 0.05, [1, 1]]],
    riot: [["smokegren", 0.05, [1, 1]], ["flashbang", 0.03, [1, 1]]],
  },
};
export const ARMORED = Object.keys(MILDEAD.ARMOR);
const round = (v) => Math.round(v * 1000) / 1000;

// × the damage a hit does to one of them. hit: { how: "shot" | "melee" | "fire" | "blast", crit, sneak }; a: the
// attacker (its weapon). No hit info (traps, a spike pit): MILDEAD trap.
export function armorVs(t, a, hit) {
  if (t.ztype === "swarm") return swarmArmor(hit, a); // carriers.js: a worm swarm (a single bullet goes through it; a shotgun catches it)
  const A = t.ztype ? MILDEAD.ARMOR[t.ztype] : null;
  if (!A) return t.armor;
  if (!hit) return A.trap;
  if (hit.how === "fire") return A.fire;
  if (hit.how === "blast") return A.blast;
  if (hit.crit || hit.sneak) return 1;
  const w = a && a.weapon;
  if (hit.how === "bash") return A.bash; // a gun butt
  const m = baseVs(t.ztype, w, hit);
  // The round against what the weapon's common round does (section 2): AP gets through better, HP worse; and the
  // plates wear (plateDur): m' = 1 − (1 − m) × clamp(1 − (pen − penCommon) / 40, 0.2, 1.6) × plateDur^0.5.
  const W = WEAPONS[w];
  let k = 1;
  if (hit.how === "shot" && W && W.cal && CALIBERS[W.cal]) {
    const pen = roundOf(a, hit).pen, common = ammoPen(W.cal, CALIBERS[W.cal].base);
    k = Math.max(MILDEAD.PEN_CLAMP[0], Math.min(MILDEAD.PEN_CLAMP[1], 1 - (pen - common) / MILDEAD.PEN_SPAN));
  }
  const dur = Math.max(0, Math.min(1, t.plateDur ?? 1));
  return round(Math.min(1, 1 - (1 - m) * k * Math.sqrt(dur)));
}
// × by weapon key, else by calibre, else by melee class, else the kind's shot / melee figure.
function baseVs(kind, w, hit) {
  const A = MILDEAD.ARMOR[kind];
  if (A.w[w] != null) return A.w[w];
  const W = WEAPONS[w];
  if (W && W.cal && MILDEAD.CAL[kind] && MILDEAD.CAL[kind][W.cal] != null && hit.how === "shot") return MILDEAD.CAL[kind][W.cal];
  if (W && W.mclass && MILDEAD.MCLASS[kind] && MILDEAD.MCLASS[kind][W.mclass] != null && hit.how === "melee") return MILDEAD.MCLASS[kind][W.mclass];
  return hit.how === "melee" ? A.melee : A.shot;
}
// A hit on one of them (combat.js damage, real hits only): their plates lose durability by the armour.js wear rule
// (raw × the round's ad × material / 10 / the plate's dmax), half of it when the hit mostly got through. Crits and
// blades in the gap do not touch the plate.
export function wearPlate(t, a, hit, raw) {
  const P = t && MILDEAD.PLATE[t.ztype];
  if (!P || !hit || hit.crit || hit.sneak || !(hit.how === "shot" || hit.how === "melee" || hit.how === "bash") || !(raw > 0)) return 0;
  const r = roundOf(a, hit);
  const ad = r.ad === "bite" ? AR.BITE_AD[P.mat] : r.ad;
  const m = armorVs(t, a, hit);
  const loss = (raw * ad * (AR.WEAR[P.mat] ?? 1)) / 10 / P.dmax * (m >= 0.85 ? 0.5 : 1);
  t.plateDur = round(Math.max(0, (t.plateDur ?? 1) - loss));
  return loss;
}
// A blade from behind (the half it does not face) or on one that has not noticed you finds the gap.
export function stabsGap(a, t) {
  if (!MILDEAD.ARMOR[t.ztype] || !a || !MILDEAD.STAB.includes(a.weapon)) return false;
  if (!t.aware) return true;
  const f = t.face || [0, 0];
  return (f[0] || f[1]) ? (a.x - t.x) * f[0] + (a.y - t.y) * f[1] < 0 : false;
}

// ---------- where they are ----------
const locType = (t) => (t && t.loc ? t.loc.type : null);
const isMilSite = (t) => locType(t) === "military" || locType(t) === "crash_mil" || locType(t) === "convoy";
// The fallen military base of a hardcore game (hardcore-groups.js keeps it in state.hardcore.groups.military).
function fallenBase(state) {
  const m = state.hardcore && state.hardcore.groups && state.hardcore.groups.military;
  return m && m.fell && m.tile != null ? m.tile : null;
}
// The share of the armoured dead among a site's dead: { soldier: 0.45 } or { riot: 0.3 } or null.
export function siteDeadMix(state, tileId) {
  const t = state.tiles[tileId];
  if (!t) return null;
  const g = state.grid;
  const out = {};
  const add = (k, v) => { out[k] = Math.max(out[k] || 0, v); };
  const site = MILDEAD.SITE[locType(t)];
  if (site) for (const k in site) add(k, site[k]);
  const trucks = truckDeadShare(state, tileId); // miltrucks.js: Army trucks nobody has opened yet, their crews about them
  if (trucks) add("soldier", trucks);
  const fb = fallenBase(state);
  if (fb != null && g) {
    const d = fb === tileId ? 0 : g.distance(fb, tileId);
    if (d <= 1) add("soldier", MILDEAD.FALLEN[d]);
  }
  if (!out.soldier && g) {
    const mil = (state.militaryIds || []).concat((state.tiles || []).filter((x) => x && locType(x) === "crash_mil").map((x) => x.id));
    let near = 99;
    for (const id of mil) if (id !== tileId) near = Math.min(near, g.distance(id, tileId));
    if (near <= 1) add("soldier", MILDEAD.NEAR);
    else if (near <= 2 && t.road) add("soldier", MILDEAD.ROAD);
  }
  if (!Object.keys(out).length && hash01(state.seed, "milrare", tileId, Math.floor((state.hour || 0) / (24 * 7))) < MILDEAD.RARE) add("soldier", 0.2);
  return Object.keys(out).length ? out : null;
}
// The armoured share only of a horde's mix (a horde met on the road brings the soldiers it picked up).
export function armoredOf(mix) {
  if (!mix) return null;
  const out = {};
  for (const k of ARMORED) if (mix[k] > 0) out[k] = mix[k];
  return Object.keys(out).length ? out : null;
}
// Two mixes as one (the larger share of each kind).
export function maxMix(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const out = { ...a };
  for (const k in b) out[k] = Math.max(out[k] || 0, b[k]);
  return out;
}

// A horde entering a tile (hordes.js onHordeEnter): at a military site some of its dead soldiers fall in.
export function hordeMilitaryPickup(state, h) {
  const t = state.tiles[h.tile];
  if (!t || !(isMilSite(t) || fallenBase(state) === h.tile)) return false;
  // Somebody's base stands there (yours, or a group's still holding it): no dead soldiers lying about to join.
  if (state.bases.some((b) => b.tile === h.tile) || state.factions.some((f) => f.alive && f.bases.includes(h.tile))) return false;
  const have = (h.mix && h.mix.soldier) || 0;
  if (have >= MILDEAD.HORDE_MAX) return false;
  const add = Math.min(MILDEAD.HORDE_ADD, MILDEAD.HORDE_MAX - have);
  const n = Math.max(1, Math.round(h.size * add));
  h.mix = mergeMix(h.mix, h.size - n, { soldier: 1 }, n);
  if (h.mix) for (const k in h.mix) h.mix[k] = round(h.mix[k]);
  h.mix.soldier = Math.min(MILDEAD.HORDE_MAX, h.mix.soldier);
  return true;
}

// ---------- their bodies ----------
// What one of them carries: { sup: { ammo: 6 }, gear: [items] } (newItem: a function(key, quality, rng): inventory.js
// armouredItem, the quality from this table and the wear from itemcond.js "armoured"). null: not armoured.
// plateDur: what their plates had left when they fell (wearPlate; null: never hit): the body armour's durability × it.
export function bodyLoot(rng, kind, newItem, plateDur = null) {
  const B = MILDEAD.BODY[kind];
  if (!B) return null;
  const sup = {}, gear = [];
  const q = ([lo, hi]) => Math.round((lo + rng.next() * (hi - lo)) * 100) / 100;
  const worn = (it) => { if (plateDur != null && it.dur != null) it.dur = Math.max(1, Math.round(it.dur * Math.max(0, Math.min(1, plateDur)))); return it; };
  for (const [k, p, range] of B.armor) if (rng.chance(p)) { gear.push(worn(newItem(k, q(range), rng))); break; }
  for (const [k, p, range] of B.items) if (rng.chance(p)) gear.push(newItem(k, q(range), rng));
  for (const [k, p, lo, hi] of B.sup) if (rng.chance(p)) sup[k] = (sup[k] || 0) + rng.int(lo, hi);
  bodyExtras(rng && Number.isFinite(rng.state) ? rng.state : 0, kind, newItem, gear);
  return { sup, gear };
}
// MILDEAD.BODY_EXTRA: at, the body's dice position (read, never moved).
function bodyExtras(at, kind, newItem, gear) {
  (MILDEAD.BODY_EXTRA[kind] || []).forEach(([k, p, range], i) => {
    if (hash01(at, "bodyextra", kind, k, i) >= p) return;
    const q = ([lo, hi]) => Math.round((lo + hash01(at, "bodyextraq", kind, i) * (hi - lo)) * 100) / 100;
    const rng = [at, kind, k, i]; // the condition's dice (itemcond.js): a hash, not the world's
    gear.push(newItem(k, q(range), rng));
  });
}
export const siteName = (t) => (t && t.loc ? LOCATIONS[t.loc.type].name : "");
