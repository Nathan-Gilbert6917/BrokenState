// @ts-check
// Appliances at the base (#19, part of the interiors epic #7; 2026-10-25, the user's request in data-appliances.js; the
// numbers are there). One rule for every appliance, by the catalogue's `use` (fridge, freezer, stove, oven, microwave):
//
// SETTING AND PICKING UP. Each kind is a set piece in the fridge's mould (data-power.js POWER_BUILDINGS furniture + set,
//   fit): its item lies in the armory (placedItemKey: f_<kind>, the fridge's own key "fridge"), the base map's Build
//   list sets it on a general building's floor (electric.js setPlaced / setPlacedAt), Demolish picks it up again whole
//   (electric.js pickUpPlaced). The ones that draw power are in the Power group, the range and the oven in Fittings.
//
// THE HOOK-UP (power.js POWER_USERS: chest_freezer, cold_case, range, microwave). Set, a powered appliance draws its need
//   from the base's grid as the fridge does (the generators, the sun and the battery banks; served in POWER_USERS'
//   order, switched on the Power card under "Appliances": base.powerOff[id]). The cold ones draw all day; the range and
//   the microwave only while a cook's bill here wants cooking today (rangeWanted, cookingWanted). Unpowered they still
//   stand: a fridge, a freezer or a cold case off is a cupboard. The grid has no wiring of its own for them (the breaker
//   panel's CIRCUITS are the buildings' lights and climate): a decision, the base's power reaches every floor.
//
// THE COLD ROOMS (coldRooms: storage.js storeSpaces). A chest freezer: COLD.chest_freezer.room days of food at the
//   walk-in freezer's rate (0.05×) while powered; a cold case: its room at 0.3×. Off (no power, switched off, short of
//   power), each is a pantry (its room at room temperature: the walk-in's thaw; the Food tab's food rooms show the
//   "(off)" row, ui/food.js, and the Power card why); broken, it holds nothing.
//
// COOKING (cooking.js STATIONS.range). A range set and not broken is a cooking station of its own, its bills on the
//   Farming tab's Cooking card. It burns no wood: rangeFuel is "power" while a range here is served, else "propane"
//   while RANGE.propane is in the stores (a gas range runs without the grid; RANGE.propane a batch, cooking.js
//   makeBatch), else "" and the station is idle (rangeStatus: buildings.js stationStatus for a range). One cook at a range
//   a day (cooking.js rangeCrew: the best Cooking at home who is not on the Kitchen's crew, RANGE.hours), one range in
//   use for every RANGE.per people living here. An oven anywhere here lets the range bake (COOK_RECIPES oven: true:
//   bread); an oven and a working range in the same building cook ×OVEN.boost as fast at the range (ovenBoost). A
//   powered microwave: ×MICROWAVE.boost on a meal's time at every station here (cookBoost: reheating, no recipes). The
//   Kitchen (buildings.js canteen) stays the base's hot-meal service; a range is the cheaper way to a cook's station.
//
// WHERE THEY COME FROM. Lifted in a raid (#12) and brought home in a vehicle (#7's extraction ticket), the State Map's
//   finds (data-power.js POWER_FINDS: the range at a third of the fridge's weight), a raid's kitchen cabinets (the
//   fridge: AREA_POWER). Propane: rollPropane / rollAreaPropane (their own dice).
//
// THE GOVERNOR (govAppliances, electric.js governPower): sets the stored appliances where a general building has floor,
//   the fridges first, then the freezers, the cold cases, the ranges, the ovens, the microwaves. The ones that draw power
//   wait for a source (a generator, a solar array or a battery bank); the range and the oven do not (propane). A stored
//   range that can be set is set before a Kitchen is wished for (rangeWaits: autopilot.js buildWishes).
//
// AI GROUPS (docs/adr/0001-ai-parity.md). Their bases are base objects (groupbases.js): groupAppliancesDaily sets what
//   lies in their armory by the same setPlaced, in the governor's order (groupbases.js syncBuildings leaves a set piece
//   alone: it is not one of their works). Their power is the coarse day budget (groupworks.js groupMachinesDaily,
//   grouppower.js powerDayBudget): each powered appliance is a user there (groupApplianceUsers, after the sealer as in
//   POWER_USERS) and is on for the day (rec.groupOn) when served GRID.onShare of its hours. Their food (factions.js
//   ageCoarse) keeps in the on appliances' rooms at the same factors (groupColdRooms). Their cooking is coarse (no
//   stations: cooking.js groupCookDaily), so a range set at their base stands as yours does but cooks nothing for them
//   yet; they bring appliances home only from vehicle raids once #7's extraction ticket carries them.
import { APPLIANCE_TYPES, COLD, RANGE, OVEN, MICROWAVE, PROPANE_FINDS, AREA_PROPANE } from "./data-appliances.js";
import { FRIDGE, POWER_BUILDINGS } from "./data-power.js";
import { isPowered } from "./power.js"; // (call-time only: the modules load in a circle)
import { placedInStores, canSetPlaced, setPlaced, generatorsOrSources } from "./electric.js"; // (call-time only)
import { fittingsIn } from "./basemap.js"; // (call-time only)
import { BUILDINGS } from "./buildings.js"; // (call-time only)
import { homesOf } from "./groupbases.js"; // (call-time only)
import { FOODS } from "./foods.js";
import { hash01 } from "./skills.js";

export { COLD, RANGE, OVEN, MICROWAVE };
// Every appliance's building type, the fridge first: the governor's order too.
export const APPLIANCES = ["fridge", ...APPLIANCE_TYPES];
const ORDER = ["fridge", "chest_freezer", "freezer_case", "island_freezer", "cold_case", "meat_case", "range", "oven", "microwave"];
/** @param {string} type */
export const isAppliance = (type) => APPLIANCES.includes(type);
/** The catalogue's use of a set appliance (fridge, freezer, stove, oven, microwave). @param {string} type */
export const useOf = (type) => (type === "fridge" ? "fridge" : POWER_BUILDINGS[type] ? POWER_BUILDINGS[type].use || "" : "");
/** Does it draw power (the range: it also cooks on propane)? @param {string} type */
export const drawsPower = (type) => !!(POWER_BUILDINGS[type] && POWER_BUILDINGS[type].grid);
/** Pieces of a type set here and not broken. @param {any} base @param {string} type */
export const workingAt = (base, type) => ((base && base.buildings) || []).filter((b) => b.type === type && !b.broken);
/** How many appliances of a type or a use are set here, not broken and powered (fridgesOn's general form). @param {any} base @param {string} key */
export const appliancesOn = (base, key) => ((base && base.buildings) || []).filter((b) => (b.type === key || (isAppliance(b.type) && useOf(b.type) === key)) && !b.broken && isPowered(base, b)).length;

// ---------- the cold rooms (storage.js storeSpaces) ----------
// [{ key, name, kind, cap }]: the chest freezers and the cold cases (and a store's freezers and butcher's cases) on (their own kind and rate) and off (a pantry).
// A broken one holds nothing (as the fridge). on(b): powered; a group's base reads rec.groupOn (groupMachinesDaily).
/** @param {any} base */
export function coldRooms(base) {
  const out = [];
  for (const type of Object.keys(COLD)) { // the chest freezer, the cold case, a store's freezer case, island freezer and butcher's case (issue #22)
    const list = workingAt(base, type);
    if (!list.length) continue;
    const C = COLD[type], on = list.filter((b) => (base.group ? !!b.groupOn : isPowered(base, b))).length;
    if (on) out.push({ key: type, name: C.name, kind: C.kind, cap: on * C.room });
    if (list.length - on) out.push({ key: `${type}off`, name: `${C.name} (off)`, kind: "dry", cap: (list.length - on) * C.room });
  }
  return out;
}
// A group's on cold rooms for its coarse aging (foods.js ageCoarse cold): [{ room, factor }], the fridges too.
/** @param {any} state @param {any} f */
export function groupColdRooms(state, f) {
  const out = [];
  for (const h of Object.values(homesOf(state, f))) {
    for (const b of h.buildings || []) {
      if (b.broken || !b.groupOn) continue;
      if (b.type === "fridge") out.push({ room: FRIDGE.room, factor: FRIDGE.factor });
      else if (COLD[b.type]) out.push({ room: COLD[b.type].room, factor: COLD[b.type].factor });
    }
  }
  return out;
}

// ---------- the range, the oven, the microwave (cooking.js) ----------
/** The ranges set here and not broken (the station: cooking.js hasStation). @param {any} base */
export const rangesUp = (base) => workingAt(base, "range");
/** An oven set here and not broken: the range bakes. @param {any} base */
export const ovenAt = (base) => workingAt(base, "oven").length > 0;
/** What the range cooks on today: "power" (a range here served), "propane" (enough in the stores for a batch) or "". @param {any} state @param {any} base */
export function rangeFuel(state, base) {
  const list = rangesUp(base);
  if (!list.length) return "";
  if (list.some((b) => isPowered(base, b))) return "power";
  return (base.stock.propane || 0) + 1e-9 >= RANGE.propane ? "propane" : "";
}
// A live bill (not paused, not done) at a station here: the range's (cooking wanted at it) or any station's.
const liveBills = (S) => !!S && Array.isArray(S.bills) && S.bills.some((b) => !b.paused && !(b.mode === "count" && (b.done || 0) >= (b.n || 0)));
/** Does the range draw power now (power.js userWants): a live bill at it. @param {any} state @param {any} base */
export const rangeWanted = (state, base) => !!(base && base.cooking) && liveBills(base.cooking.range);
/** Does the microwave draw (power.js userWants): a live bill at any station here. @param {any} state @param {any} base */
export const cookingWanted = (state, base) => !!(base && base.cooking) && Object.values(base.cooking).some((S) => S && typeof S === "object" && liveBills(S));
// The general building a set piece stands in (its id), or null: rec.host when it was placed by hand, else where the
// auto layout put it (basemap.js fittingsIn).
function hostOfRec(state, base, rec) {
  if (rec.host != null) return rec.host;
  for (const g of base.buildings) {
    if (!BUILDINGS[g.type] || !BUILDINGS[g.type].general) continue;
    if (fittingsIn(state, base, g.id).some((o) => o.rec === rec)) return g.id;
  }
  return null;
}
/** ×OVEN.boost at the range when an oven and a working range stand in the same building, else 1. @param {any} state @param {any} base */
export function ovenBoost(state, base) {
  const ovens = workingAt(base, "oven"), ranges = rangesUp(base);
  if (!ovens.length || !ranges.length) return 1;
  const homes = new Set(ranges.map((r) => hostOfRec(state, base, r)).filter((h) => h != null));
  return ovens.some((o) => { const h = hostOfRec(state, base, o); return h != null && homes.has(h); }) ? OVEN.boost : 1;
}
/** A powered microwave here (it reheats the meals). @param {any} base */
export const microwaveOn = (base) => workingAt(base, "microwave").some((b) => isPowered(base, b));
/**
 * How much faster a batch of recipe R goes at station `key` here (cooking.js runStation divides its hours by it): the
 * oven beside a range (×OVEN.boost at the range), a powered microwave (×MICROWAVE.boost on a meal's time anywhere).
 * @param {any} state @param {any} base @param {string} key @param {any} R
 */
export function cookBoost(state, base, key, R) {
  let k = 1;
  if (key === "range") k *= ovenBoost(state, base);
  if (R && FOODS[R.out] && FOODS[R.out].group === "meal" && microwaveOn(base)) k *= MICROWAVE.boost;
  return k;
}
/**
 * The range's status (buildings.js stationStatus for a range; the Cooking card): { running, idle, reason, fuel }.
 * @param {any} state @param {any} base @param {any} [rec]
 */
export function rangeStatus(state, base, rec = null) {
  if (rec && rec.broken) return { running: false, idle: true, broken: true, reason: "Broken: needs repair (Repairs tab)", fuel: "" };
  if (!rangesUp(base).length) return { running: false, idle: true, reason: "No kitchen range set here", fuel: "" };
  const fuel = rangeFuel(state, base);
  if (!fuel) return { running: false, idle: true, reason: `No power and no propane: it cooks on ${RANGE.need} power, or ${RANGE.propane} propane a batch off the grid`, fuel };
  return { running: true, idle: false, reason: fuel === "power" ? "Cooking on the grid (no wood)" : `Cooking on propane (${RANGE.propane} a batch, ${Math.floor((base.stock.propane || 0) * 10) / 10} here)`, fuel };
}
/** One line for a set appliance (the setting message). @param {string} type */
export function applianceLine(type) {
  if (type === "fridge") return `${FRIDGE.room} days of cold food room while it has power (${FRIDGE.need})`;
  if (COLD[type]) return `${COLD[type].room} days of food room at ${COLD[type].factor}× its shelf while it has power (${COLD[type].need})`;
  if (type === "range") return `a cooking station: ${RANGE.need} power while it cooks, or ${RANGE.propane} propane a batch; no wood`;
  if (type === "oven") return `the range bakes; ×${OVEN.boost} with a range in the same building`;
  if (type === "microwave") return `×${MICROWAVE.boost} on a meal's time while it has power (${MICROWAVE.need})`;
  return "";
}

// ---------- the governor (electric.js governPower) and the Kitchen wish ----------
/**
 * Set the stored appliances where a general building has floor, in ORDER; the ones that draw power (not the range) only
 * once a source stands here. Returns the log lines.
 * @param {any} state @param {any} base
 */
export function govAppliances(state, base) {
  const out = [];
  const powered = generatorsOrSources(base);
  for (const t of ORDER) {
    if (t !== "range" && drawsPower(t) && !powered) continue;
    for (let guard = 0; guard < 12 && placedInStores(base, t) && canSetPlaced(state, base, t).ok; guard++) {
      const r = setPlaced(state, base, t);
      if (r.err) break;
      out.push(r.msg);
    }
  }
  return out;
}
/** A range in the stores that can be set now: the governor sets it before it wishes for a Kitchen. @param {any} state @param {any} base */
export const rangeWaits = (state, base) => placedInStores(base, "range") > 0 && canSetPlaced(state, base, "range").ok;

// ---------- the AI groups (see the header) ----------
/**
 * Set what lies in each of the group's armories by your rule (setPlaced), in the governor's order. Returns the pieces set.
 * @param {any} state @param {any} f
 */
export function groupAppliancesDaily(state, f) {
  let n = 0;
  for (const h of Object.values(homesOf(state, f))) {
    if (!h.armory || !h.armory.some((it) => it && APPLIANCES.some((t) => it.key === (POWER_BUILDINGS[t].item || t)))) continue;
    for (const t of ORDER) {
      for (let guard = 0; guard < 12 && placedInStores(h, t) && canSetPlaced(state, h, t).ok; guard++) {
        if (setPlaced(state, h, t).err) break;
        n++;
      }
    }
  }
  return n;
}
/**
 * The powered appliances at a group's base as users of its day budget (grouppower.js gridUsers' shape: { k, need,
 * want }, k their own: appl<id>), with rec for the day's on.
 * @param {any} h a group's base object
 */
export function groupApplianceUsers(h) {
  const out = [];
  for (const b of (h && h.buildings) || []) {
    if (!isAppliance(b.type) || b.broken) continue;
    const need = b.type === "fridge" ? FRIDGE.need : COLD[b.type] ? COLD[b.type].need : 0; // their cooking is coarse: the range and the microwave draw nothing for them
    if (need > 0) out.push({ k: `appl${b.id}`, need, want: () => true, rec: b });
  }
  return out;
}

// ---------- propane (data-appliances.js PROPANE_FINDS, AREA_PROPANE; their own dice) ----------
/**
 * Propane found this search hour (kind: the point of interest searched, when it has its own row), or 0.
 * @param {any} state @param {number} tileId @param {string|null} kind @param {number} [mult] @param {string} [salt]
 */
export function rollPropane(state, tileId, kind, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const w = (kind && PROPANE_FINDS[kind]) || (t && t.loc ? PROPANE_FINDS[t.loc.type] : null);
  if (!w) return 0;
  const loot = Math.max(0.1, Math.min(1, t ? t.loot ?? 1 : 1));
  if (hash01(state.seed, "propane", tileId, state.hour, salt) >= w[0] * loot * mult) return 0;
  return w[1] + Math.floor(hash01(state.seed, "propaneqty", tileId, state.hour, salt) * (w[2] - w[1] + 1));
}
/**
 * Propane in a raid's container (a grill's bottle by a house, a hardware store's cage), or 0.
 * @param {any} state @param {number} tileId @param {string} areaType @param {string} [salt]
 */
export function rollAreaPropane(state, tileId, areaType, salt = "") {
  const w = AREA_PROPANE[areaType];
  if (!w || hash01(state.seed, "areapropane", tileId, salt) >= w[0]) return 0;
  return w[1] + Math.floor(hash01(state.seed, "areapropaneqty", tileId, salt) * (w[2] - w[1] + 1));
}
