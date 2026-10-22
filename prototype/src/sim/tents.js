// @ts-check
// Tents (the user's request 2026-10-20; the numbers in data-tents.js): tent bags found as loot, carried in the arms, a
// cart or a vehicle's trunk, pitched at a camp for beds under cover and storage out of the weather, a quicker camp on
// an expedition, the hardcore start's bags, and the AI bands and groups using them by the same rules.
//
// THE BAGS. GEAR tent1, tent2, tent4 (data-tents.js TENT_GEAR): one tent each, of the TENT_TYPES type of the same key.
//   In arms only, or a cart's bed, the team's cargo (the trunk when it has a vehicle) or a base's armory (inventory.js
//   isCarryable `arms`; the four-person tent's duffle takes both arms: twoHands).
//
// SET UP CAMP (staging.js pitchArrive; parties.js pitchHoursFor for the planner's estimates). campPitchHours: the
//   three hours of clearing the camp's 10 × 10 and setting it up (buildings.js CAMP.setupHours; the user's request
//   2026-10-22), bags or none: the clearing is the work. pitchHours: the hour of tarps and bedrolls on the road (a
//   band's camp at the day's end, CAMP.tarpHours) comes down to TENTS.PITCH_FULL (30 minutes) when its bags
//   (teamTentBags: the cargo, what each one carries in the arms, a cart's or a pack's contents) sleep everyone, by the
//   share they sleep when they sleep only some.
//
// AT A BASE (a camp: staging.js makeCamp; any base: the base map, the governor). Every bag the team brought to a new
//   camp is pitched (pitchArmoryBags, after settleInto put it in the camp's armory). A pitched tent is a BASE MAP PIECE
//   (the pt-int merge, 2026-10-20): a record { type: "tent", tent: kind, item, day } in base.buildings, put up through
//   basemap.js pitchTent (placed by hand from the base map's Build list, Tents: pitchStoredBag; else the game's auto
//   layout round the fire) and struck through basemap.js strikeTent (the base map's Strike: buildings.js demolish). The
//   bag it came out of rides on it (item), so striking gives the same bag back. Its sleepers are beds once (buildings.js
//   tentBeds in baseBeds; a camp has no beds of its own, CAMP.beds 0) and each sleeper's mood follows its kind (beds.js
//   bedSlots, data-tents.js TENT_TYPES mood); its storage is room out of the weather once, as the base keeps its goods:
//   kg in basestorage.js storageOf (a "tent" container keyed b:<id>: the goods in it do not weather) and days of food
//   in storage.js storeSpaces (the Tents dry room).
//   Daily (campTentsDaily, staging.js campsHour): bags packed in the camp's armory are pitched while someone sleeps
//   rough (the governor does the same at any base it runs: beds.js governBeds, before its Makeshift tents and its
//   furniture). Sleeping rough itself is beds.js's one rule (bedLine), never counted here.
//   Strike camp (staging.js strikeCamp) strikes every tent back into its bag first and packs the bags before the rest
//   of the armory; a camp removed any other way (gone after its days alone) leaves its tents in its cache as bags. A
//   tent left pitched when a team leaves stays at the camp. An old save's base.tents list becomes map pieces
//   (migrateTentList, save.js).
//
// ON THE ROAD (nightmarch.js Make camp until dawn; orders.js rest task "camp"): the bags go up for the night
//   (roadTentLine says so); whoever they do not sleep sleeps rough, TENTS.ROAD_ROUGH over the night's hours
//   (roadTentsHour).
//
// HARDCORE (hardcore-start.js setupHardcoreStart): TENTS.HARDCORE one-person tent bags a starting survivor, in the
//   car's trunk (the team's cargo), or in the arms on foot (hardcoreTents).
//
// LOOT (their own dice: nothing else a search finds changed). The hour-by-hour search (scavenge.js: rollTentFind by the
//   site or POI kind, TENT_FINDS), a raid's containers (combat.js: rollAreaTent by the raid area, AREA_TENTS), and the
//   AI's raids on points of interest (grouppois.js raidPoiAsGroup: rollGroupTent by the POI's kind, as many search
//   hours as the pool it took).
//
// AI PARITY (docs/adr/0001-ai-parity.md; coarse and daily):
//   - Nomad bands and raider bands from beyond the border carry tent bags on their shelf (b.wares: weighed by their
//     carry rule, nomads.js bandRoom; tradeable), set out with some by their kit (bandTentKit, BAND_TENTS: survivalists
//     and preppers sleep everyone, looters and raiders some, drifters' shelters are makeshift), and find more by the
//     same loot (rollGroupTent). At a camp (bandTentCamp, daily): their bags are pitched; the share of their heads they
//     do not sleep sleeps rough, which slows their recruiting as sleeping rough slows a group's growth
//     (groupworks.js CROWDED_GROWTH, by the share); their pitched tents keep the fresh food they hold (bandSpoilMult:
//     foods.js ageCoarse × TENTS.SPOIL on that share). Quicker camps: a band's walking day ends with the pitching, so
//     the time its bags save is walked (bandPitchSaved: nomads.js move, the day's last hour).
//   - The AI groups keep the bags they find on their shelf (f.wares: arsenal.js keepItem) and pitch them at their camps:
//     the bags' sleepers count as quarters for the people at their camp bases (groupworks.js served "beds";
//     groupTentSleepers).
//   - Abstract: the hardcore bands on the road (hardcore-groups.js: no items at all), the groups' parties on the road,
//     the raiders' pace, and a group's tents' storage (their stores have no weather).
import { GEAR } from "./data.js";
import { TENT_TYPES, TENTS, TENT_FINDS, AREA_TENTS, BAND_TENTS } from "./data-tents.js";
import { hash01 } from "./skills.js"; // call-time only
import { lootItem, newItem } from "./inventory.js"; // call-time only
import { siteSource, areaSource } from "./itemcond.js"; // call-time only
import { partyMembers } from "./parties.js"; // call-time only (the import cycle)
import { atBase, hourOfDay, log, localId } from "./world.js"; // call-time only
import { CAMP, isCamp, baseBeds, tentBeds, tentKind } from "./buildings.js"; // call-time only
import { pitchTent, strikeTent, AI_CAMP_TENTS } from "./basemap.js"; // call-time only: a pitched tent is a base map piece
import { bedAssignments } from "./beds.js"; // call-time only: who sleeps in which bed (the one assignment)
import { weatherAt } from "./weather.js"; // call-time only
import { FOODS, unitsOf } from "./foods.js"; // call-time only
export { TENT_TYPES, TENTS, TENT_S, TENT_BAGS } from "./data-tents.js";

const WET = new Set(["rain", "storm", "snow", "blizzard"]);
const r2 = (v) => Math.round(v * 100) / 100;
/** @param {Record<string, number>} items @param {number} u */
function pickW(items, u) {
  const tot = Object.values(items).reduce((a, w) => a + w, 0);
  let x = u * tot;
  for (const [k, w] of Object.entries(items)) { x -= w; if (x < 0) return k; }
  return Object.keys(items).pop() || null;
}

// ---------- the bags and the types ----------
/** A tent bag (GEAR tent1, tent2, tent4). @param {any} it */
export const isTentBag = (it) => !!(it && GEAR[it.key] && GEAR[it.key].tent && TENT_TYPES[GEAR[it.key].tent] && TENT_TYPES[GEAR[it.key].tent].bag);
/** The tent type a bag pitches (its key). @param {any} it */
export const bagType = (it) => (isTentBag(it) ? GEAR[it.key].tent : null);
/** People a bag sleeps. @param {any} it */
export const bagSleepers = (it) => (isTentBag(it) ? TENT_TYPES[bagType(it)].sleepers : 0);
/** Kg a bag's tent keeps out of the weather. @param {any} it */
export const bagStoreKg = (it) => (isTentBag(it) ? TENT_TYPES[bagType(it)].storeKg : 0);
/** @param {any[]} list */
export const sleepersOf = (list) => (list || []).reduce((a, it) => a + bagSleepers(it), 0);
/** @param {any[]} list */
export const storeKgOf = (list) => (list || []).reduce((a, it) => a + bagStoreKg(it), 0);
// "a two-person tent and two one-person tents" (bags or pitched records).
/** @param {string[]} types */
export function tentsText(types) {
  /** @type {Record<string, number>} */
  const n = {};
  for (const t of types) n[t] = (n[t] || 0) + 1;
  const words = ["", "a", "two", "three", "four", "five", "six"];
  const parts = Object.keys(TENT_TYPES).filter((t) => n[t]).sort((a, b) => TENT_TYPES[b].sleepers - TENT_TYPES[a].sleepers).map((t) => { const nm = TENT_TYPES[t].name.toLowerCase(); return n[t] === 1 ? `a ${nm}` : `${words[n[t]] || n[t]} ${nm}s`; });
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ---------- pitched at a base: on the base map ----------
// A pitched tent is a base map piece (the pt-int merge, 2026-10-20): a record { type: "tent", tent: kind, item, day } in
// base.buildings, placed through basemap.js pitchTent (by hand, or the game's auto layout round the fire), drawn,
// fought over (softcover.js) and moved like anything else. The bag it came out of rides on the record (item), so
// striking it gives the same bag back. Its sleepers are beds once (buildings.js tentBeds, in baseBeds; each sleeper's
// mood by its kind: beds.js bedSlots), its storage room once (basestorage.js: a "tent" container; storage.js: the
// Tents dry room). tentsOf gives views of them: { id, type (its kind), item, day, rec }.
/** The tents standing at a base (base.buildings records), as views. @param {any} base @returns {{ id: number, type: string, item: any, day: number, rec: any }[]} */
export const tentsOf = (base) => ((base && base.buildings) || []).filter((b) => b && b.type === "tent").map((b) => ({ id: b.id, type: tentKind(b), item: b.item || null, day: b.day || 0, rec: b }));
/** Beds under cover the pitched tents give (their sleepers): buildings.js tentBeds, the one count. */
export { tentBeds };
/** Kg the standing tents keep out of the weather (a broken one nothing). @param {any} base */
export const tentStoreKg = (base) => ((base && base.buildings) || []).reduce((a, b) => a + (b && b.type === "tent" && !b.broken ? TENT_TYPES[tentKind(b)].storeKg : 0), 0);
/** Days of food the pitched tents keep dry (storage.js storeSpaces: a day of food is about a kilo, carry.js FOOD_KG). @param {any} base */
export const tentFoodDays = (base) => tentStoreKg(base);
/**
 * Pitch a tent of a type at a base: a map piece (basemap.js pitchTent: at [x, y, r] placed by hand, else the game's
 * auto layout). item: the bag it came out of (kept for the strike), none for a makeshift tent. Returns its view, or
 * null (an unknown type, a spot that does not fit).
 * @param {any} state @param {any} base @param {string} type @param {any} [item] @param {number[]|null} [at]
 */
export function pitchTentAtBase(state, base, type, item = null, at = null) {
  if (!base || !TENT_TYPES[type]) return null;
  const r = pitchTent(state, base, type, at);
  if (!r || r.error || !r.tent) return null;
  if (item) { delete item.store; r.tent.item = item; } // containers.js: an assignment to a container goes with it out of the stores
  if (item && item.tentHp != null) { if (item.tentHp < 100) r.tent.tentHp = Math.max(0, item.tentHp); delete item.tentHp; } // tentfight.js: a bag taken off a torn tent stands torn (softcover.js mendTents)
  r.tent.day = state ? Math.floor(state.hour / 24) + 1 : 0;
  return tentsOf(base).find((t) => t.id === r.tent.id) || null;
}
/** A bag pitched at a base (pitchTentAtBase with its type and the bag). @param {any} state @param {any} base @param {any} item @param {number[]|null} [at] */
export const pitchBagAtBase = (state, base, item, at = null) => (isTentBag(item) ? pitchTentAtBase(state, base, bagType(item), item, at) : null);
/**
 * Strike the tent `id` at a base (off the base and its map: basemap.js strikeTent). Returns its bag (the one it came
 * out of; a new one if it had none), or null for a makeshift tent (nothing to pack) or no such tent. The caller puts the
 * bag where it goes.
 * @param {any} state @param {any} base @param {number} id
 */
export function strikeTentAtBase(state, base, id) {
  const rec = ((base && base.buildings) || []).find((b) => b.id === id && b.type === "tent");
  if (!rec) return null;
  const r = strikeTent(state, base, id);
  if (!r || r.error) return null;
  const T = TENT_TYPES[r.kind];
  if (!(T && T.bag)) return null;
  const bag = rec.item && typeof rec.item === "object" ? rec.item : newItem(r.kind);
  if (rec.tentHp != null && rec.tentHp < 100) bag.tentHp = Math.max(0, rec.tentHp); else delete bag.tentHp; // its wear goes into the bag (tentfight.js: a damaged bag)
  return bag;
}
/** Strikes every tent at a base; returns the bags. @param {any} state @param {any} base */
export function strikeTents(state, base) {
  const bags = [];
  for (const t of tentsOf(base)) { const it = strikeTentAtBase(state, base, t.id); if (it) bags.push(it); }
  return bags;
}
/**
 * A bag in the stores pitched where the base map's ghost is (basemap.js layoutAct build on "bag:<kind>"), or placed by
 * the game (at null). Returns the view, or { error }.
 * @param {any} state @param {any} base @param {string} kind @param {number[]|null} [at]
 */
export function pitchStoredBag(state, base, kind, at = null) {
  const bag = armoryBags(base).find((x) => bagType(x.item) === kind);
  if (!bag) return { error: `No ${TENT_TYPES[kind] ? TENT_TYPES[kind].name.toLowerCase() : "tent"} bag in the stores` };
  const view = pitchBagAtBase(state, base, bag.item, at);
  if (!view) return { error: "It does not fit there" };
  takeBag(base, bag);
  return view;
}
/** Bags of a kind in a base's stores (the base map's Build list, Tents). @param {any} base @param {string} kind */
export const bagsInStores = (base, kind) => armoryBags(base).filter((x) => bagType(x.item) === kind).length;
// Off the armory (or out of the cart, bag or case it was in).
/** @param {any} base @param {any} x */
function takeBag(base, x) {
  if (x.inner) x.list[/** @type {number} */ (x.j)] = null;
  else { const i = base.armory.indexOf(x.item); if (i >= 0) base.armory.splice(i, 1); }
}
// An old save's base.tents (the tentkit branch's own list, before the merge): each one a map piece now, its bag kept.
/** @param {any} state */
export function migrateTentList(state) {
  for (const base of (state && state.bases) || []) {
    if (!base || !Array.isArray(base.tents)) continue;
    for (const t of base.tents) {
      if (!t || !TENT_TYPES[t.type] || base.id < 0) continue;
      const r = pitchTent(state, base, t.type);
      if (r && r.tent) { if (t.item) r.tent.item = t.item; if (t.day) r.tent.day = t.day; }
    }
    delete base.tents;
    delete base.tentSeq;
  }
}

// ---------- a camp ----------
// The bags in a base's armory (top level, and one level into a cart, a bag or a case): [{ item, list, i }].
/** @param {any} base */
function armoryBags(base) {
  const out = [];
  const armory = base.armory || [];
  armory.forEach((it, i) => {
    if (isTentBag(it)) out.push({ item: it, list: armory, i });
    else if (it && Array.isArray(it.contents)) it.contents.forEach((c, j) => { if (isTentBag(c)) out.push({ item: c, list: it.contents, j, inner: true }); });
  });
  return out;
}
/**
 * Pitches bags from a base's armory: all of them (need Infinity), or enough to sleep `need` more (the smallest bag that
 * does it, else the biggest, again). Returns the records pitched.
 * @param {any} state @param {any} base @param {number} [need]
 */
export function pitchArmoryBags(state, base, need = Infinity) {
  const bags = armoryBags(base);
  const pick = [];
  if (need === Infinity) pick.push(...bags);
  else {
    let left = need;
    const pool = [...bags];
    while (left > 0 && pool.length) {
      pool.sort((a, b) => bagSleepers(a.item) - bagSleepers(b.item));
      const k = pool.findIndex((x) => bagSleepers(x.item) >= left);
      const x = pool.splice(k >= 0 ? k : pool.length - 1, 1)[0];
      pick.push(x);
      left -= bagSleepers(x.item);
    }
  }
  const recs = [];
  for (const x of pick) {
    const rec = pitchBagAtBase(state, base, x.item); // a map piece the game places (basemap.js pitchTent)
    if (!rec) continue;
    takeBag(base, x);
    recs.push(rec);
  }
  return recs;
}
/** Beds under cover at a base (a camp has none of its own, CAMP.beds 0: its tents and any bunks). @param {any} base */
export const roofBeds = (base) => baseBeds(base);
/**
 * Who sleeps where at a camp: { people, covered, rough: the people without a bed (beds.js bedAssignments, the one
 * assignment), tents, storeKg, packed (bags still in the armory) }.
 * @param {any} state @param {any} base
 */
export function campSleep(state, base) {
  const a = bedAssignments(state, base);
  const people = [...a.keys()].map((id) => state.survivors.find((s) => s.id === id)).filter(Boolean);
  const rough = people.filter((s) => !a.get(s.id));
  return { people: people.length, covered: people.length - rough.length, rough, tents: tentsOf(base), storeKg: tentStoreKg(base), packed: armoryBags(base).map((x) => x.item) };
}
/**
 * A camp's day (staging.js campsHour): bags packed in its armory go up while someone sleeps rough (free: before the
 * governor's builds). The mood of sleeping rough is beds.js's one rule (bedLine, relations.js), not here. Returns how
 * many still sleep rough.
 * @param {any} state @param {any} base
 */
export function campTentsDaily(state, base) {
  if (!isCamp(base)) return 0;
  let S = campSleep(state, base);
  if (S.rough.length && S.packed.length) {
    const recs = pitchArmoryBags(state, base, S.rough.length);
    if (recs.length) log(state, `${base.name}: ${tentsText(recs.map((r) => r.type))} went up from the stores.`, "info");
    S = campSleep(state, base);
  }
  base.slept = { day: Math.floor(state.hour / 24), rough: S.rough.length, covered: S.covered };
  return S.rough.length;
}

// ---------- a team ----------
/** The tent bags a team has: in its cargo (the trunk), in someone's arms, in a cart's or a pack's contents. @param {any} state @param {any} p */
export function teamTentBags(state, p) {
  const out = [];
  /** @param {any} it */
  const take = (it) => { if (!it) return; if (isTentBag(it)) out.push(it); else if (Array.isArray(it.contents)) for (const c of it.contents) if (isTentBag(c)) out.push(c); };
  for (const it of (p && p.cargo && p.cargo.gear) || []) take(it);
  for (const s of p ? partyMembers(state, p) : []) { const g = /** @type {any} */ (s.gear || {}); take(g.carry); take(g.backpack); }
  return out;
}
/** @param {any} state @param {any} p */
export const teamTentSleepers = (state, p) => sleepersOf(teamTentBags(state, p));
/** Hours to pitch on the road for `heads` people whose bags sleep `sleepers` (CAMP.tarpHours down to TENTS.PITCH_FULL). @param {number} heads @param {number} sleepers */
export function pitchHours(heads, sleepers) {
  const full = CAMP.tarpHours;
  if (!(heads > 0) || !(sleepers > 0)) return full;
  return r2(full - (full - TENTS.PITCH_FULL) * Math.min(1, sleepers / heads));
}
/** Set up camp's hours for this team (staging.js pitchArrive, parties.js pitchHoursFor): CAMP.setupHours. @param {any} state @param {any} p */
export const campPitchHours = (state, p) => CAMP.setupHours;
/** "1 hour", "30 minutes". @param {number} h */
export const hoursText = (h) => (h >= 1 - 1e-9 && Math.abs(h - Math.round(h)) < 1e-9 ? `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}` : `${Math.round(h * 60)} minutes`);
// Make camp until dawn (nightmarch.js): the line for the card. "" without people.
/** @param {any} state @param {any} p */
export function roadTentLine(state, p) {
  const heads = partyMembers(state, p).length;
  if (!heads) return "";
  const bags = teamTentBags(state, p), sl = sleepersOf(bags);
  if (!bags.length) return " No tents: they sleep rough round the fire.";
  const up = `${tentsText(bags.map(bagType)).replace(/^./, (c) => c.toUpperCase())} go${bags.length === 1 ? "es" : ""} up`;
  return sl >= heads ? ` ${up}: everyone sleeps under cover.` : ` ${up}: ${sl} of ${heads} sleep under cover, the rest sleep rough.`;
}
/**
 * An hour of rest on the road (orders.js campHour): in the night's hours, whoever the bags do not sleep loses
 * TENTS.ROAD_ROUGH over the night (×WET on a wet night). Returns how many slept rough.
 * @param {any} state @param {any} p
 */
export function roadTentsHour(state, p) {
  const h = hourOfDay(state);
  if (!(h >= 22 || h < 6)) return 0;
  const people = partyMembers(state, p).slice().sort((a, b) => (a.health || 0) - (b.health || 0) || a.id - b.id);
  const rough = people.slice(Math.min(people.length, teamTentSleepers(state, p)));
  const tile = p.path && p.path[p.idx] != null ? p.path[p.idx] : p.dest;
  const w = tile != null ? weatherAt(state, tile) : null;
  const loss = (TENTS.ROAD_ROUGH / 8) * (w && WET.has(w.key) ? TENTS.WET : 1);
  for (const s of rough) s.mood = Math.max(0, (s.mood || 0) - loss);
  return rough.length;
}

// ---------- hardcore ----------
/**
 * The hardcore start's bags: TENTS.HARDCORE one-person tents a survivor, in the car's trunk (the team's cargo), or in
 * each one's arms on foot (the cargo when the arms are full). No dice. Returns the bags.
 * @param {any} state @param {any} p @param {any[]} people
 */
export function hardcoreTents(state, p, people) {
  const bags = [];
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  for (const s of people) for (let i = 0; i < TENTS.HARDCORE; i++) {
    const it = newItem("tent1");
    bags.push(it);
    if (!p.vehicle && s.gear && !s.gear.carry) s.gear.carry = it;
    else p.cargo.gear.push(it);
  }
  return bags;
}

// ---------- loot ----------
/**
 * A tent bag in the hour-by-hour search of a site or a POI (scavenge.js; TENT_FINDS by its kind, its own dice), or null.
 * @param {any} state @param {number} tileId @param {string} kind @param {number} left the pool left (0-1) @param {number} [mult] @param {string} [salt]
 */
export function rollTentFind(state, tileId, kind, left, mult = 1, salt = "") {
  const f = TENT_FINDS[kind];
  if (!f) return null;
  const loot = Math.max(0.1, Math.min(1, left ?? 1));
  if (hash01(state.seed, "tentfind", tileId, state.hour, salt) >= f.p * loot * mult) return null;
  const key = pickW(f.items, hash01(state.seed, "tentpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(kind), hash01(state.seed, "tentdur", tileId, state.hour, salt)) : null;
}
/**
 * A tent bag in a raid's container (combat.js; AREA_TENTS by the area, its own dice), or null.
 * @param {any} state @param {number} tileId @param {string} areaType @param {string|null} site @param {string} [salt]
 */
export function rollAreaTent(state, tileId, areaType, site, salt = "") {
  const a = AREA_TENTS[areaType];
  if (!a || hash01(state.seed, "areatent", tileId, salt) >= a.p) return null;
  const key = pickW(a.items, hash01(state.seed, "areatentpick", tileId, salt));
  return key ? lootItem(key, areaSource(areaType, site), hash01(state.seed, "areatentdur", tileId, salt)) : null;
}
// The pool a search hour takes (scavenge.js searchHour: 0.05 at full pace): an AI raid that took `took` of a pool is
// that many search hours.
const HOUR_TAKE = 0.05;
/**
 * A tent bag in an AI raid on a POI (grouppois.js raidPoiAsGroup; TENT_FINDS by its kind, as many search hours as it
 * took, its own dice), or null.
 * @param {any} state @param {any} who @param {number} tileId @param {number} poi @param {string|null} kind @param {number} took @param {number} pool
 */
export function rollGroupTent(state, who, tileId, poi, kind, took, pool) {
  const f = kind ? TENT_FINDS[kind] : null;
  if (!f || !(took > 0)) return null;
  const hours = took / HOUR_TAKE, p1 = f.p * Math.max(0.1, Math.min(1, pool ?? 1));
  const chance = Math.min(0.9, 1 - Math.pow(1 - p1, hours));
  const id = localId(state, who && typeof who === "object" ? who.id : who); // the world's own numbering: the same seed, the same dice
  if (hash01(state.seed, "grouptent", id, tileId, poi, state.hour) >= chance) return null;
  const key = pickW(f.items, hash01(state.seed, "grouptentpick", id, tileId, poi, state.hour));
  return key ? lootItem(key, siteSource(kind), hash01(state.seed, "grouptentdur", id, tileId, poi, state.hour)) : null;
}

// ---------- AI bands: nomads, raiders from beyond the border ----------
/** The bags a band carries (on its shelf, b.wares). @param {any} b */
export const bandTentBags = (b) => ((b && b.wares) || []).filter(isTentBag);
/**
 * The bags a band sets out with (BAND_TENTS by its kit; its own dice, hashed: no draw): enough to sleep the kit's share
 * of its heads, its preferred bags biggest first. Returns the items (the caller puts them on its shelf).
 * @param {any} state @param {string} kit @param {number|string} serial @param {number} heads
 */
export function bandTentKit(state, kit, serial, heads) {
  const K = BAND_TENTS[kit];
  if (!K || !(K.share > 0) || !(heads > 0)) return [];
  let need = Math.round(heads * K.share);
  const out = [];
  for (let i = 0; need > 0 && i < 12; i++) {
    const u = hash01(state.seed, "bandtent", kit, serial, i);
    // The biggest that does not sleep more than are left, now and then one size down.
    let k = K.bags.findIndex((t) => TENT_TYPES[t].sleepers <= need);
    if (k < 0) k = K.bags.length - 1;
    if (u < 0.3 && k < K.bags.length - 1) k++;
    const type = K.bags[k];
    out.push(lootItem(type, "survivor", [state.seed, "bandtentq", kit, serial, i]));
    need -= TENT_TYPES[type].sleepers;
  }
  return out;
}
/** Hours of walking a band's bags save it at the day's end (CAMP.tarpHours less its pitching). @param {any} b @param {number} heads */
export const bandPitchSaved = (b, heads) => r2(CAMP.tarpHours - pitchHours(heads, sleepersOf(bandTentBags(b))));
/**
 * A band's camp, coarse and daily (nomads.js bandDay, visitors.js raiderDay): its bags pitched, the share of its heads
 * they sleep, the rest sleeping rough. A drifters' band builds makeshift shelters (no bag, no storage) for everyone.
 * Kept on the band (b.tentCamp) for the panels and the tests. Returns it.
 * @param {any} b @param {number} heads @param {boolean} camping
 */
export function bandTentCamp(b, heads, camping) {
  const bags = bandTentBags(b);
  const makeshift = b.kit === "drifters";
  const sleepers = makeshift ? Math.max(heads, sleepersOf(bags)) : sleepersOf(bags);
  const rec = { camping: !!camping, bags: bags.length, sleepers, heads, rough: camping ? Math.max(0, heads - sleepers) : 0, storeKg: camping ? storeKgOf(bags) : 0 };
  b.tentCamp = rec;
  return rec;
}
/** The share of a band's heads sleeping rough at its camp (0 on the road, as the camp rule reads it). @param {any} b */
export const bandRoughShare = (b) => { const c = b && b.tentCamp; return c && c.camping && c.heads > 0 ? Math.min(1, c.rough / c.heads) : 0; };
/**
 * × a band's coarse food aging (foods.js ageCoarse) today: the share of its fresh food its pitched tents hold ages at
 * TENTS.SPOIL. 1 on the road or without tents.
 * @param {any} b @param {boolean} camping
 */
export function bandSpoilMult(b, camping) {
  if (!camping) return 1;
  const kg = storeKgOf(bandTentBags(b));
  if (!(kg > 0)) return 1;
  let fresh = 0;
  for (const [k, q] of Object.entries((b && b.stock) || {})) if (FOODS[k] && !FOODS[k].stable && q > 0) fresh += unitsOf(k, q); // days of food, about a kilo each
  if (!(fresh > 0)) return 1;
  const share = Math.min(1, kg / fresh);
  return 1 - share * (1 - TENTS.SPOIL);
}

// ---------- AI groups ----------
/**
 * The tents an AI group's camp stands with on a battle map (conquest.js, the fight at it): its real tents, the bags on
 * its shelf (biggest first, enough to sleep the people there), else AI_CAMP_TENTS makeshift tents of sticks and tarps
 * (basemap.js). Returns the kinds (TENT_TYPES keys).
 * @param {any} f @param {number} people
 */
export const groupCampTents = (f, people) => groupCampTentItems(f, people).map((x) => x.kind);
/** The same as groupCampTents with the bag each one is ({ kind, item }; item null for a makeshift one): tentfight.js takes the very bag off their shelf. @param {any} f @param {number} people */
export function groupCampTentItems(f, people) {
  const bags = ((f && f.wares) || []).filter((it) => it && it.withParty == null && isTentBag(it)).sort((a, b) => bagSleepers(b) - bagSleepers(a));
  if (!bags.length) return Array(AI_CAMP_TENTS).fill(null).map(() => ({ kind: "makeshift", item: null }));
  const out = [];
  let left = Math.max(1, people || 0);
  for (const it of bags) { if (left <= 0) break; out.push({ kind: bagType(it), item: it }); left -= bagSleepers(it); }
  return out;
}
/** People the tent bags on a group's shelf sleep (groupworks.js: quarters at its camps). @param {any} f */
export const groupTentSleepers = (f) => sleepersOf(((f && f.wares) || []).filter((it) => it && it.withParty == null));
