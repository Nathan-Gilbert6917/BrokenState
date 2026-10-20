// @ts-check
// Tents (the user's request 2026-10-20; the numbers in data-tents.js): tent bags found as loot, carried in the arms, a
// cart or a vehicle's trunk, pitched at a camp for beds under cover and storage out of the weather, a quicker camp on
// an expedition, the hardcore start's bags, and the AI bands and groups using them by the same rules.
//
// THE BAGS. GEAR tent1, tent2, tent4 (data-tents.js TENT_GEAR): one tent each, of the TENT_TYPES type of the same key.
//   In arms only, or a cart's bed, the team's cargo (the trunk when it has a vehicle) or a base's armory (inventory.js
//   isCarryable `arms`; the four-person tent's duffle takes both arms: twoHands).
//
// SET UP CAMP (staging.js pitchArrive; parties.js pitchHoursFor for the planner's estimates). campPitchHours: the hour
//   of tarps and bedrolls (buildings.js CAMP.setupHours) comes down to TENTS.PITCH_FULL (30 minutes) when the team's
//   bags (teamTentBags: the cargo, what each one carries in the arms, a cart's or a pack's contents) sleep everyone,
//   by the share they sleep when they sleep only some.
//
// AT A CAMP (a base: staging.js makeCamp). Every bag the team brought is pitched (pitchArmoryBags, after settleInto put
//   it in the camp's armory). A pitched tent is a record on the base (base.tents: { id, type, item, day }): the bag it
//   came out of is kept on it (item), so striking gives the same bag back. The tents' sleepers are beds under cover
//   (tentBeds: buildings.js baseBeds adds them on top of the camp's bedrolls, CAMP.beds); its storage is room out of
//   the weather twice over, as the base keeps its goods: kg in basestorage.js storageOf (a "tent" container: the goods
//   in it do not weather) and days of food in storage.js storeSpaces (a dry room: food keeps as in a pantry).
//   Daily (campTentsDaily, staging.js campsHour): bags packed in the camp's armory are pitched while someone sleeps
//   rough; whoever has no bed under cover (tents and bunks: roofBeds) sleeps rough round the fire, TENTS.ROUGH_MOOD a
//   day (×WET on a wet day). The bedrolls still count as room for crowding (morale.js), so it is a mild cost.
//   Strike camp (staging.js strikeCamp) strikes every tent back into its bag first and packs the bags before the rest
//   of the armory; a camp removed any other way (gone after its days alone) leaves its tents in its cache as bags. A
//   tent left pitched when a team leaves stays at the camp.
//
// THE SEAM FOR THE BASE MAP (the baseview branch places tent pieces on a base's grid): pitchTentAtBase(state, base,
//   type, item?) records a tent of a type on a base (its sleepers and storage through base.tents) and returns the
//   record; strikeTentAtBase(state, base, id) takes it down and returns its bag (null for a makeshift tent). Placing it
//   on the map is the merge's job: these two are the calls to point at it.
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
import { CAMP, isCamp, baseBeds } from "./buildings.js"; // call-time only (buildings.js reads tentBeds)
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

// ---------- pitched at a base: the seam ----------
/** The tents pitched at a base (base.tents). @param {any} base @returns {{ id: number, type: string, item: any, day: number }[]} */
export const tentsOf = (base) => (base && Array.isArray(base.tents) ? base.tents : []);
/** Beds under cover the pitched tents give (their sleepers). @param {any} base */
export const tentBeds = (base) => tentsOf(base).reduce((a, t) => a + (TENT_TYPES[t.type] ? TENT_TYPES[t.type].sleepers : 0), 0);
/** Kg the pitched tents keep out of the weather. @param {any} base */
export const tentStoreKg = (base) => tentsOf(base).reduce((a, t) => a + (TENT_TYPES[t.type] ? TENT_TYPES[t.type].storeKg : 0), 0);
/** Days of food the pitched tents keep dry (storage.js storeSpaces: a day of food is about a kilo, carry.js FOOD_KG). @param {any} base */
export const tentFoodDays = (base) => tentStoreKg(base);
/**
 * THE SEAM: pitch a tent of a type at a base. Records it on the base (base.tents) so its sleepers are beds
 * (buildings.js baseBeds) and its storage is room out of the weather (basestorage.js, storage.js). item: the bag it
 * came out of (kept for the strike), none for a makeshift tent. Returns the record, or null for an unknown type.
 * @param {any} state @param {any} base @param {string} type @param {any} [item]
 */
export function pitchTentAtBase(state, base, type, item = null) {
  if (!base || !TENT_TYPES[type]) return null;
  if (!Array.isArray(base.tents)) base.tents = [];
  base.tentSeq = (base.tentSeq || 0) + 1;
  const rec = { id: base.tentSeq, type, item: item || null, day: state ? Math.floor(state.hour / 24) + 1 : 0 };
  base.tents.push(rec);
  return rec;
}
/** A bag pitched at a base (pitchTentAtBase with its type and the bag). @param {any} state @param {any} base @param {any} item */
export const pitchBagAtBase = (state, base, item) => (isTentBag(item) ? pitchTentAtBase(state, base, bagType(item), item) : null);
/**
 * THE SEAM: strike the tent `id` at a base. Returns its bag (the one it came out of; a new one if it had none), or null
 * for a makeshift tent (nothing to pack) or no such tent. The caller puts the bag where it goes.
 * @param {any} state @param {any} base @param {number} id
 */
export function strikeTentAtBase(state, base, id) {
  const list = tentsOf(base);
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const [rec] = list.splice(i, 1);
  const T = TENT_TYPES[rec.type];
  return T && T.bag ? rec.item || newItem(rec.type) : null;
}
/** Strikes every tent at a base; returns the bags. @param {any} state @param {any} base */
export function strikeTents(state, base) {
  const bags = [];
  for (const rec of [...tentsOf(base)]) { const it = strikeTentAtBase(state, base, rec.id); if (it) bags.push(it); }
  return bags;
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
    if (x.inner) x.list[/** @type {number} */ (x.j)] = null; else { const i = base.armory.indexOf(x.item); if (i >= 0) base.armory.splice(i, 1); }
    const rec = pitchBagAtBase(state, base, x.item);
    if (rec) recs.push(rec);
  }
  return recs;
}
/** Beds under a roof at a camp: the tents' and the bunks' (baseBeds less the bedrolls round the fire). @param {any} base */
export const roofBeds = (base) => (isCamp(base) ? Math.max(0, baseBeds(base) - CAMP.beds) : baseBeds(base));
/**
 * Who sleeps where at a camp: { people, covered, rough: survivors without a bed under cover (the hurt get one first),
 * tents, storeKg, packed (bags still in the armory) }.
 * @param {any} state @param {any} base
 */
export function campSleep(state, base) {
  const people = atBase(state, base.id).slice().sort((a, b) => (a.health || 0) - (b.health || 0) || a.id - b.id);
  const covered = Math.min(people.length, roofBeds(base));
  return { people: people.length, covered, rough: people.slice(covered), tents: tentsOf(base), storeKg: tentStoreKg(base), packed: armoryBags(base).map((x) => x.item) };
}
/**
 * A camp's day (staging.js campsHour): bags packed in its armory go up while someone sleeps rough; whoever still has
 * no bed under cover loses TENTS.ROUGH_MOOD mood (×WET on a wet day). Returns how many slept rough.
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
  const w = weatherAt(state, base.tile);
  const loss = TENTS.ROUGH_MOOD * (w && WET.has(w.key) ? TENTS.WET : 1);
  for (const s of S.rough) s.mood = Math.max(0, (s.mood || 0) - loss);
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
/** Hours to pitch for `heads` people whose bags sleep `sleepers` (CAMP.setupHours down to TENTS.PITCH_FULL). @param {number} heads @param {number} sleepers */
export function pitchHours(heads, sleepers) {
  const full = CAMP.setupHours;
  if (!(heads > 0) || !(sleepers > 0)) return full;
  return r2(full - (full - TENTS.PITCH_FULL) * Math.min(1, sleepers / heads));
}
/** Set up camp's hours for this team (staging.js pitchArrive, parties.js pitchHoursFor). @param {any} state @param {any} p */
export const campPitchHours = (state, p) => pitchHours(partyMembers(state, p).length, teamTentSleepers(state, p));
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
/** Hours of walking a band's bags save it at the day's end (CAMP.setupHours less its pitching). @param {any} b @param {number} heads */
export const bandPitchSaved = (b, heads) => r2(CAMP.setupHours - pitchHours(heads, sleepersOf(bandTentBags(b))));
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
/** People the tent bags on a group's shelf sleep (groupworks.js: quarters at its camps). @param {any} f */
export const groupTentSleepers = (f) => sleepersOf(((f && f.wares) || []).filter((it) => it && it.withParty == null));
