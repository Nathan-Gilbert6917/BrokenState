// @ts-check
// What the AI groups build at their bases (barestart): a group's base starts bare, as yours does, and the group puts
// up what it needs, one job at a time, by its needs and goals. The groups are abstract (factions.js: people and
// stores, no buildings of their own), so their works are counts per base: f.works[tile] = { water, farms, beds,
// walls, bench, store }, and f.job = { tile, type, left, paid } is the one job under way.
//
// - The jobs (WORKS): scrap and a part for the bench, paid from the group's stores when the job starts, and work in
//   crew-days. The crew is the group's people / CREW a day (at least 1), so a group of 20 puts up a field in about a
//   day and a wall point in two. Short of the scrap, they salvage their own: the job takes SALVAGE × the work and
//   costs nothing, so a poor group is slow, never stuck.
// - What they choose (nextWork), first match, at their main base and then their other bases:
//   water (wells, barrels) while it serves fewer than everyone (ever "short": they have no tank to fall back on), at
//   summer's thirst from late spring (SUMMER_LEAD);
//   fields while the food is short (under FOOD_SHORT days of eating) and the fields feed fewer than everyone;
//   quarters while people sleep rough (beds for fewer than everyone);
//   walls while they are threatened (THREAT: the dead within reach, a hive near, raided lately, an aggressive group
//   within reach) and the walls are under their goal;
//   the rest of the fields; a bench once the necessities are up (they make ammo and gear every day);
//   a storehouse once their stores fill (a stock at STORE_FULL of what it can hold);
//   walls up to their goal (the fortress and the military want theirs, others a home wall and a fence at their outposts).
//   A sick bay (sickbayWork, at the main base, after the jail's first step; the four tiers of your hospital: infirmary,
//   field hospital, clinic, trauma hospital; f.works[tile].sickbay = the tier): the infirmary once quarters are up and
//   the group has wounded or SICKBAY_FIRST people; each next tier after the workshop, once the group is big enough
//   (SICKBAY[].pop ÷ its heal lean, groupcare.js GROUP_PRIORITIES) and its doctor good enough (SICKBAY[].doc, groupcare.js f.med: the clinic
//   needs a Medicine 6 doctor and the trauma hospital a 10, as yours). It speeds their healing (groupcare.js healRate,
//   CARE.BAY) and sets how their doctor trains their medics (medicTraining, the tier's teach, ward, gap).
//   A jail (groupjails.js jailWork, after water, fields and quarters): makeshift cells, holding cells, a jailhouse at
//   the main base, early for raiders, the military, the fortress and groups at war, once they hold someone for the
//   rest, after the fields for communes; a full one is upgraded. Their prisoners work the job too (f.prisonWork).
// - What the works do, small next to what the group is (people, arms, stores):
//   walls: conquest.js nativeWalls (what your assault faces) is the walls built, up to its goal (WALL_GOAL: 7 for
//   fortresses and the military, 4 at a main base, 1 elsewhere: the old fixed walls); and a raid or a horde on the
//   group (factions.js resolveRaidOnFaction) meets defence 8 × (0.5 + 0.5 × walls / goal) on top of their fighters,
//   which was a flat 8 before;
//   water and fields: their food from the land is × (FIELDS_MIN + (1 − FIELDS_MIN) × how provisioned they are);
//   quarters: people sleeping rough slow the group's growth (CROWDED_GROWTH × the chance);
//   bench: their workshops make WORKSHOP_MIN of the ammo, scrap, fuel and meds without one;
//   storehouse: their stores hold STORE_CAP of the usual caps without one;
//   outpost camps (2026-10-09, parity with your outpost camp, buildings.js outpost_up): a base a group founds from
//   nothing (factions.js expansion; not one it moves into, groupworld.js occupyAbandoned) starts as a camp
//   (f.works[tile].camp): its defence × CAMP.DEF and nothing else built there until CAMP (its materials and work) is done,
//   the first job at that base;
//   animal pens (2026-10-09, your animal pen's parity): at a base with walls and fields, after the fields for
//   everyone, PENS.max a base; each adds PENS.food food a day (penFood, factions.js), winter or not.
// - Old saves (no state.groupWorks) and the hardcore military (an army base built before the fall) count as built
//   up: none of this changes them. tools/barestarttest.js.
import { day } from "./world.js";
import { season, THIRST } from "./weather.js"; // summer water: the season and its thirst
import { weightOf, medOf } from "./groupcare.js"; // the type profiles; the group's doctor (a clinic needs a good one)
import { jailWork, jailBuilt, GROUP_JAIL } from "./groupjails.js";
import { groupFieldDefence, groupFieldWells } from "./fieldworks.js"; // the groups' field works: towers, wells // jailhouse: the groups' jails (abstract tiers)

/** @typedef {{ water?: number, farms?: number, beds?: number, walls?: number, bench?: number, store?: number, sickbay?: number, pens?: number, camp?: number }} Works */

export const GROUP_WORKS = {
  WORKS: {
    water: { name: "a well", cost: { scrap: 3 }, work: 3 },
    farms: { name: "fields", cost: { scrap: 4 }, work: 4 },
    beds:  { name: "quarters", cost: { scrap: 8 }, work: 4 },
    walls: { name: "a wall", cost: { scrap: 6 }, work: 6 },
    bench: { name: "a workshop", cost: { scrap: 6, parts: 1 }, work: 4 },
    store: { name: "a storehouse", cost: { scrap: 7 }, work: 5 },
    pens: { name: "an animal pen", cost: { scrap: 4 }, work: 3 },
  },
  CREW: 6, SALVAGE: 2,
  SERVES: { water: 10, farms: 8, beds: 8 }, // people one of each serves
  WALL_GOAL: { typed: 7, home: 4, open: 1 }, WALLED_TYPES: ["fortress", "military"], // as conquest.js CONQUEST.WALLS (the old fixed walls)
  FOOD_SHORT: 8, STORE_FULL: 0.9,
  FIELDS_MIN: 0.94, CROWDED_GROWTH: 0.7, WORKSHOP_MIN: 0.85, STORE_CAP: 0.85,
  THREAT: { HORDE: 6, HIVE: 10, RAIDED: 30, GROUP: 14 },
  WALL_DEF: 8, // the flat defence a group base had, now half of it bare and all of it behind the walls' goal
  // Sick bays by tier (sickbayWork): cost, work in crew-days, the people it waits for (÷ the heal lean) and the doctor's
  // Medicine it needs. Your hospitals cost 15 scrap + 2 meds up to 70 scrap, 8 parts, 12 meds; the groups' works are
  // scaled to their stores as the rest of WORKS (a well 3 scrap).
  // SICKBAY[0] is tier 1 (the infirmary); SICKBAY_FIRST: the people that want an infirmary with nobody wounded.
  SICKBAY: [
    { name: "an infirmary", cost: { scrap: 5, meds: 1 }, work: 3, pop: 0, doc: 0 },
    { name: "a field hospital", cost: { scrap: 8, parts: 1, meds: 2 }, work: 5, pop: 10, doc: 0 },
    { name: "a clinic", cost: { scrap: 12, parts: 2, meds: 3 }, work: 7, pop: 16, doc: 6 },
    { name: "a trauma hospital", cost: { scrap: 18, parts: 3, meds: 4 }, work: 10, pop: 25, doc: 10 },
  ],
  SICKBAY_FIRST: 6,
  // Animal pens (farming.js PEN, your animal pen: the same option, coarse): a base with walls and fields puts up one
  // (after the fields for everyone); each brings PENS.food food a day on top of their fields, every season.
  PENS: { max: 1, food: 2 },
  // An outpost camp's step up (yours: 12 scrap, a part, 36 work-hours; scaled as the rest of WORKS) and the camp's
  // defence share until then.
  CAMP: { name: "the outpost camp established", cost: { scrap: 10, buildmat: 1 }, work: 3, DEF: 0.5 }, // yours: 20 scrap, 2 building materials, 20 work-hours
  BUILDMAT_SCRAP: 3, // building materials made from scrap when short (crafting.js buildmat, as yours)
  // Summer water (summer-water 2026-10-10, parity with your governor's summer store, autopilot.js SUMMER_STORE): from
  // SUMMER_LEAD days before summer and through it a group wants its wells for everyone at summer's thirst
  // (weather.js THIRST.summer: a well serves SERVES.water / 1.3 people then), so the extra well goes up in late spring;
  // in summer its water serves that many fewer (provisioned). Abstract: they keep no water stock, so there is no store
  // to fill, no cisterns or barrels, and no thirst; short water only trims their food from the land (FIELDS_MIN).
  SUMMER_LEAD: 21,
};
const W = GROUP_WORKS;

// This world's groups build (a new world sets state.groupWorks); old saves and the hardcore military are built up.
export const groupsBuild = (state, f) => !!state && !!state.groupWorks && !!f && !f.hcMilitary;
/** @returns {Works} */
export function worksAt(f, tile) {
  if (!f.works) f.works = {};
  return f.works[tile] || (f.works[tile] = {});
}
const n = (w, k) => (w && w[k]) || 0;
const mainOf = (f) => f.bases[0];
// The people living at a base: the main base twice a share (conquest.js peopleAt's weights).
function peopleAt(f, tile) {
  const i = f.bases.indexOf(tile);
  if (i < 0) return 0;
  const w = f.bases.length - 1 + 2;
  return Math.max(1, Math.round((f.pop * (i === 0 ? 2 : 1)) / w));
}
// Summer's thirst while it is summer (now), or summer and its last SUMMER_LEAD days of spring (ahead: the wells they plan).
function summerThirst(state, ahead) {
  if (!state || !season || !THIRST) return 1;
  const s = season(state);
  return s.key === "summer" || (ahead && s.key === "spring" && s.daysLeft < W.SUMMER_LEAD) ? THIRST.summer : 1;
}
const wanted = (f, tile, k, state = null) => Math.ceil((peopleAt(f, tile) * (k === "water" ? summerThirst(state, true) : 1)) / W.SERVES[k]);
export function wallGoal(f, tile) {
  if (weightOf(f, "walled", W.WALLED_TYPES.includes(f.type) ? 1 : 0) >= 1) return W.WALL_GOAL.typed; // groupcare.js GROUP_PRIORITIES walled
  return mainOf(f) === tile ? W.WALL_GOAL.home : W.WALL_GOAL.open;
}
// Walls standing at a group's base (conquest.js nativeWalls): the goal itself where they do not build.
export function groupWalls(state, f, tile) {
  const goal = wallGoal(f, tile);
  if (!groupsBuild(state, f)) return goal;
  return Math.min(goal, n(f.works && f.works[tile], "walls"));
}
// 0–1: how far the walls are toward their goal (resolveRaidOnFaction's defence).
export const wallShare = (state, f, tile) => groupWalls(state, f, tile) / Math.max(1, wallGoal(f, tile));
// The flat defence of a group base against a raid or a horde (factions.js resolveRaidOnFaction).
export const groupBaseDefence = (state, f, tile) => (groupsBuild(state, f) ? W.WALL_DEF * (0.5 + 0.5 * wallShare(state, f, tile)) * (isCamp(f, tile) ? W.CAMP.DEF : 1) : W.WALL_DEF) * groupFieldDefence(state, f, tile); // fieldworks.js: their manned watch towers nearby
// A base of theirs still a camp (founded from nothing and not yet established).
export const isCamp = (f, tile) => !!(f && f.works && f.works[tile] && f.works[tile].camp);
// A group's new base founded from nothing starts as a camp (factions.js expansion; this world's groups build).
export function pitchCamp(state, f, tile) { if (groupsBuild(state, f)) worksAt(f, tile).camp = 1; }

// Summed over the group's bases: how many people its water, fields and quarters serve.
function served(f, k, state = null) {
  return f.bases.reduce((a, t) => a + n(f.works && f.works[t], k) * W.SERVES[k], 0) + (k === "water" && state ? groupFieldWells(state, f) * W.SERVES.water : 0); // fieldworks.js: their field wells
}
// 0–1: water and fields for everyone.
export function provisioned(state, f) {
  if (!groupsBuild(state, f)) return 1;
  const p = Math.max(1, f.pop);
  return (Math.min(1, served(f, "water", state) / (p * summerThirst(state, false))) + Math.min(1, served(f, "farms") / p)) / 2;
}
// Food a day from their animal pens (PENS): 0 where they do not build (old saves, the hardcore military).
export const penFood = (state, f) => (groupsBuild(state, f) ? f.bases.reduce((a, t) => a + Math.min(W.PENS.max, n(f.works && f.works[t], "pens")), 0) * W.PENS.food : 0);
export const fieldsFactor = (state, f) => W.FIELDS_MIN + (1 - W.FIELDS_MIN) * provisioned(state, f);
export const sleepingRough = (state, f) => groupsBuild(state, f) && served(f, "beds") < f.pop;
export const growthFactor = (state, f) => (sleepingRough(state, f) ? W.CROWDED_GROWTH : 1);
const hasAny = (f, k) => f.bases.some((t) => n(f.works && f.works[t], k) > 0);
export const workshopFactor = (state, f) => (!groupsBuild(state, f) || hasAny(f, "bench") ? 1 : W.WORKSHOP_MIN);
export const storeFactor = (state, f) => (!groupsBuild(state, f) || hasAny(f, "store") ? 1 : W.STORE_CAP);

// Is this base threatened (walls go up ahead of the rest)?
export function threatened(state, f, tile) {
  const g = state.grid, T = W.THREAT, today = day(state);
  if ((state.hordes || []).some((h) => g.distance(h.tile, tile) <= T.HORDE)) return true;
  if ((state.hives || []).some((h) => g.distance(h.tile, tile) <= T.HIVE)) return true; // a destroyed hive leaves the list (hives.js)
  if (f.hitDay != null && today - f.hitDay <= T.RAIDED) return true;
  return state.factions.some((o) => o !== f && o.alive && weightOf(o, "threat", 0) > 0 && o.bases.some((b) => g.distance(b, tile) <= T.GROUP)); // GROUP_PRIORITIES threat
}
// Their stores are filling up (a storehouse): any capped stock near its cap (factionsDaily's caps), or a big larder.
function storesFull(state, f) {
  const p = Math.max(1, f.pop), c = storeFactor(state, f), s = f.stock || {};
  return (s.scrap || 0) >= p * 10 * c * W.STORE_FULL || (s.ammo || 0) >= p * 30 * c * W.STORE_FULL || (s.food || 0) >= p * 20;
}

// The sick bay's tier at a group's bases (the best of them; 0 = none).
export const sickbayTier = (f) => Math.max(0, ...(f.bases || []).map((t) => n(f.works && f.works[t], "sickbay")));
// The next sick bay step at the main base, or null. upper: the tiers above the infirmary (after the workshop).
function sickbayWork(state, f, upper) {
  const tile = mainOf(f);
  const t = n(worksAt(f, tile), "sickbay");
  const next = W.SICKBAY[t]; // the tier above t
  if (!next) return null;
  if (!upper) {
    if (t > 0 || !((f.wounded || 0) > 0 || f.pop >= W.SICKBAY_FIRST)) return null;
    return { tile, type: "sickbay", why: "a sick bay for the wounded", def: next };
  }
  if (t === 0) return null;
  if (f.pop < next.pop / Math.max(0.3, weightOf(f, "heal")) || medOf(f).doc < next.doc) return null;
  return { tile, type: "sickbay", why: `${next.name} (the sick bay upgraded)`, def: next };
}

// The next job a group would start: { tile, type, why } or null (all built).
export function nextWork(state, f) {
  if (!groupsBuild(state, f) || !f.bases.length) return null;
  const foodShort = (f.stock.food || 0) < f.pop * W.FOOD_SHORT;
  for (const tile of f.bases) {
    const w = worksAt(f, tile);
    if (n(w, "camp")) return { tile, type: "camp", why: "an outpost camp to establish", def: W.CAMP }; // nothing else there before it
    const goal = wallGoal(f, tile);
    if (n(w, "water") < wanted(f, tile, "water", state)) return { tile, type: "water", why: summerThirst(state, true) > 1 && n(w, "water") >= wanted(f, tile, "water") ? "water for the summer" : "water" };
    if (foodShort && n(w, "farms") < wanted(f, tile, "farms")) return { tile, type: "farms", why: "food is short" };
    if (n(w, "beds") < wanted(f, tile, "beds")) return { tile, type: "beds", why: "people sleep rough" };
    if (tile === mainOf(f)) { const jail = jailWork(state, f); if (jail) return jail; }
    if (tile === mainOf(f)) { const sb = sickbayWork(state, f, false); if (sb) return sb; }
    if (n(w, "walls") < goal && threatened(state, f, tile)) return { tile, type: "walls", why: "threatened" };
    if (n(w, "farms") < wanted(f, tile, "farms")) return { tile, type: "farms", why: "fields for everyone" };
    if (n(w, "walls") > 0 && n(w, "farms") > 0 && n(w, "pens") < W.PENS.max) return { tile, type: "pens", why: "food behind the walls" };
    if (tile === mainOf(f)) { const jail = jailWork(state, f, true); if (jail) return jail; } // communes: later
    if (tile === mainOf(f)) {
      if (!hasAny(f, "bench")) return { tile, type: "bench", why: "a workshop for their gear and ammo" };
      if (!hasAny(f, "store") && storesFull(state, f)) return { tile, type: "store", why: "the stores are full" };
      const sb = sickbayWork(state, f, true);
      if (sb) return sb;
    }
  }
  for (const tile of f.bases) if (n(worksAt(f, tile), "walls") < wallGoal(f, tile)) return { tile, type: "walls", why: "walls" };
  return null;
}

// A day of building for one group (factions.js factionsDaily).
export function groupWorksDaily(state, f) {
  if (!groupsBuild(state, f)) return;
  // A job at a base they no longer hold is dropped (the materials are lost with the base).
  if (f.job && !f.bases.includes(f.job.tile)) f.job = null;
  if (!f.job) {
    const next = nextWork(state, f);
    if (!next) return;
    const def = next.def || W.WORKS[next.type]; // a jail step brings its own (groupjails.js STEPS)
    // Short of building materials: made from their scrap, as you would (crafting.js buildmat).
    const bmShort = Math.max(0, (def.cost.buildmat || 0) - (f.stock.buildmat || 0));
    if (bmShort && (f.stock.scrap || 0) >= bmShort * W.BUILDMAT_SCRAP + (def.cost.scrap || 0)) { f.stock.scrap -= bmShort * W.BUILDMAT_SCRAP; f.stock.buildmat = (f.stock.buildmat || 0) + bmShort; }
    const can = Object.entries(def.cost).every(([k, v]) => (f.stock[k] || 0) >= v);
    if (can) for (const [k, v] of Object.entries(def.cost)) f.stock[k] -= v;
    f.job = { tile: next.tile, type: next.type, left: def.work * (can ? 1 : W.SALVAGE), paid: can };
  }
  f.job.left -= Math.max(1, f.pop / W.CREW) + (f.prisonWork || 0) / W.CREW; // their prisoners work too (groupjails.js)
  if (f.job.left > 0) return;
  if (f.job.type === "jail") jailBuilt(state, f, f.job.tile);
  else if (f.job.type === "camp") delete worksAt(f, f.job.tile).camp; // established
  else { const w = worksAt(f, f.job.tile); w[f.job.type] = n(w, f.job.type) + 1; }
  f.built = (f.built || 0) + 1;
  f.job = null;
}

const jailStepName = (f) => { const t = (f.jails && f.jails[f.job.tile]) || 0; return (GROUP_JAIL.STEPS[t + 1] || GROUP_JAIL.STEPS[1]).name; };
// "water, 2 fields, quarters for 16, walls 2/4 · building a wall" (the Groups tab).
export function worksText(state, f) {
  if (!groupsBuild(state, f) || !f.bases.length) return "";
  const t = { water: 0, farms: 0, beds: 0, bench: 0, store: 0 };
  for (const b of f.bases) for (const k of Object.keys(t)) t[k] += n(f.works && f.works[b], k);
  const main = mainOf(f);
  const bits = [];
  if (t.water) bits.push(t.water > 1 ? `${t.water} wells` : "a well");
  if (t.farms) bits.push(t.farms > 1 ? `${t.farms} fields` : "a field");
  if (t.beds) bits.push(`quarters for ${t.beds * W.SERVES.beds}`);
  bits.push(`walls ${groupWalls(state, f, main)}/${wallGoal(f, main)}`);
  if (t.bench) bits.push("a workshop");
  if (t.store) bits.push("a storehouse");
  const bay = sickbayTier(f);
  if (bay) bits.push(W.SICKBAY[Math.min(W.SICKBAY.length, bay) - 1].name);
  const camps = f.bases.filter((b) => isCamp(f, b)).length;
  if (camps) bits.push(`${camps === 1 ? "an outpost camp" : `${camps} outpost camps`} not yet established`);
  const jobName = () => (f.job.type === "jail" ? jailStepName(f) : f.job.type === "camp" ? W.CAMP.name : f.job.type === "sickbay" ? (W.SICKBAY[n(worksAt(f, f.job.tile), "sickbay")] || W.SICKBAY[W.SICKBAY.length - 1]).name : W.WORKS[f.job.type].name);
  const job = f.job ? ` · building ${jobName()}` : "";
  return `${bits.join(", ")}${job}`;
}
