// @ts-check
// Beds as furniture (2026-10-20, the user's request: "Cots 1x2 mood debuff, Beds 1x2, bunkbeds 1x2 mood debuff and
// large beds 2x2 mood buff can be created and set in buildings to add beds for a base"). The numbers are
// data-beds.js (BED_SPEC: size, sleepers, mood; BED_GEAR: the items; BED_CRAFTS: the recipes).
//
// THE PIECE. A cot, a bed, a bunk bed or a large bed is an item while it is in the stores (the base's armory) or on
// the move (bulky, both arms: the In arms slot, a cart, the team's cargo, a vehicle): crafted at a crafting bench
// (crafting.js CRAFTS), found now and then where people slept (rollBedFind: BED_FINDS, scavenge.js), traded as any
// item. It becomes a placed thing when it is SET inside a general building (a hut, cabin, lodge, hall or barn):
//   - on the base map (the view's Build list, group Furniture: basemap.js buildMenu / layoutAct build ->
//     setFurnitureAt): its footprint follows the mouse over the building's floor, R turns it, a click sets it there;
//   - from the Construction tab or the governor (buildings.js queueBuild -> setFurniture): set with no spot, and the
//     auto layout puts it on the first free floor of a building with room (basemap.js autoLayout's fittings).
// A set piece is a record in base.buildings of its own type (BUILDINGS fit + furniture: data-beds.js BED_BUILDINGS)
// keeping the item it was (rec.item: its condition comes back with it). It is a fitting in every way the base map
// knows (basemap.js FOOT: only on a general building's floor, never in a doorway, a way to it from the door, moved
// with its building, the auto layout's), and on the battle map it is bed cells (combat.js CELL bed: half cover;
// barricade.js FURNITURE bed: shoved, battered to rubble). Demolish picks it up (pickUpFurniture: back in the stores,
// whole); a building pulled down has its furniture carried out into the stores first (buildings.js demolish).
// Why on the base map and not a building's slot count (the brief's option a): general buildings already have floor
// cells the map view reaches (occ.floor), the fittings already stand on them, so a piece of furniture is one more
// fitting and the map, the battle map and the auto layout need no new rule.
//
// THE BEDS. A base's beds (buildings.js baseBeds) are its plain beds (plainBeds: the camp's bedrolls, the shelter's
// and the base's own, a bunkhouse's or barracks' bunks, the bunk beds fitting) plus its furniture's sleepers
// (furnitureBeds), less the children's. Each person sleeps in a bed of their own (bedAssignments): the beds sorted best
// first by their mood (a large bed, a bed or a plain bed, a bunk bed or the bunk beds fitting, a cot; the children
// take the worst), the people in order (the leader, then by id), one each. Their mood a day follows the bed
// (bedLine, relations.js moodFactors: a cot −1, a bunk −0.5, a large bed +1); nobody without a bed: they sleep rough
// (BED_MOOD.rough a day, on top of the base's crowding, morale.js). Away on a team: no line.
//
// THE OLD MAKESHIFT COTS (buildings.js cots: a shelter's build, +2 beds) are retired: never built again (canBuild:
// RETIRED_WHY), and a save's built cots are each two Cots set at that base (migrateCots, save.js), placed by the game.
//
// THE GOVERNOR (autopilot.js governBase, the morning's plan: governBeds): a base it runs sets the furniture lying in
// its stores where a building has room, and while the base sleeps more people than it has beds and a building has
// floor for one, queues a bunk bed (else a cot) at the bench when its scrap and wood cover it with some to spare.
//
// AI GROUPS (docs/adr/0001-ai-parity.md; coarse, as their works): their furniture is a count a base
// (f.works[tile].cot / bed / bunkbed / bigbed), crafted from their stock at your recipes' costs (BED_CRAFTS), one
// piece a day at most (groupBedsDaily, groupworks.js groupWorksDaily), set in the general building they put up for it
// (the "hall" work: your Lodge, hallWork / hallDef: at the main base once they are BEDS_AI.pop strong and can spare
// the cost), BEDS_AI.room cells of floor a hall. People sleeping rough at a base with a hall get a bunk bed (or a cot);
// with everyone in a bed, large beds while they can spare the wood and scrap. Their beds are their quarters'
// (groupworks.js SERVES.beds a quarters) and the furniture's sleepers (furnSleepers: groupworks.js served and
// nextWork count both); their people's mood follows the same bed values (groupBedMorale: the beds filled best first,
// the mean a head × BEDS_AI.morale off their desertion pressure, groupcare.js desertPressure, as hot meals' is).
// Their bases' map (groupbases.js WORKS_BUILDING: the hall a Lodge, each piece itself) is laid out by the same auto
// layout, the furniture on the Lodge's floor.
import { BED_SPEC, BED_KINDS, BED_MOOD, BED_FINDS, BED_CRAFTS, BEDS_AI } from "./data-beds.js";
import { BUILDINGS, BEDS, addBuilding, count, plainBeds, baseBeds } from "./buildings.js"; // (call-time only: the modules load in a circle)
import { fittingRoom, placeItem, refreshBaseMap } from "./basemap.js"; // (call-time only)
import { makeItem, canCraft, queueCraft, craftQueue } from "./crafting.js"; // (call-time only)
import { residents } from "./world.js";
import { hash01 } from "./skills.js";
import { pickWeighted } from "./loot.js"; // (call-time only)
import { lootItem } from "./inventory.js";
import { siteSource } from "./itemcond.js";
import { GROUP_WORKS, groupsBuild, canPayParts, payParts, groupPeopleAt } from "./groupworks.js"; // (call-time only)
import { homesOf, syncBuildings } from "./groupbases.js"; // their bases as base objects: the hall's floor (call-time only)

const HOSTS = "a hut, cabin, lodge, hall or barn";
const nameOf = (type) => (BED_SPEC[type] ? BED_SPEC[type].name : BUILDINGS[type] ? BUILDINGS[type].name : type);
const lower = (type) => nameOf(type).toLowerCase();
const bedsWord = (n) => `${n} bed${n === 1 ? "" : "s"}`;
/** @param {string} type */
export const isFurniture = (type) => !!BED_SPEC[type];

// ---------- the beds a base has ----------
/** The beds the furniture set at a base adds (buildings.js baseBeds adds it to the plain beds). @param {any} base */
export const furnitureBeds = (base) => ((base && base.buildings) || []).reduce((a, b) => a + (BED_SPEC[b.type] && !b.broken ? BED_SPEC[b.type].sleepers : 0), 0);
/** Pieces of this kind in a base's stores (its armory). @param {any} base @param {string} type */
export const furnitureInStores = (base, type) => ((base && base.armory) || []).filter((it) => it && it.key === type).length;
/** The furniture set at a base, by kind: { cot: 2, bigbed: 1 }. @param {any} base */
export function furnitureSet(base) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const b of (base && base.buildings) || []) if (BED_SPEC[b.type]) out[b.type] = (out[b.type] || 0) + 1;
  return out;
}

// ---------- setting a piece and picking it up ----------
// Why it cannot be set at this base now ("" when it can): a general building standing with free floor for it.
/** @param {any} base @param {string} type */
export function furnitureProblem(base, type) {
  if (!BED_SPEC[type]) return "Not a piece of furniture";
  if (fittingRoom(null, base, type)) return "";
  const s = BED_SPEC[type];
  return `Needs a building to stand in with ${s.w} × ${s.h} of free floor (${HOSTS})`;
}
// buildings.js canBuild for a piece of furniture: one in the stores, and a building with room for it.
/** @returns {{ ok: boolean, reason?: string, short?: boolean }} */
export function canSetFurniture(state, base, type) {
  if (!BED_SPEC[type]) return { ok: false, reason: "Not a piece of furniture" };
  if (!furnitureInStores(base, type)) return { ok: false, short: true, reason: `No ${lower(type)} in the stores: craft one at the bench (Crafting) or bring one home` };
  const where = furnitureProblem(base, type);
  if (where) return { ok: false, reason: where };
  return { ok: true };
}
// The makeshift cots are retired (buildings.js canBuild, the def's retired: the item that replaced it).
export const RETIRED_WHY = (def) => `Superseded: craft a ${lower(def.retired)} at the bench and set it inside a building (the base map's Build list, Furniture)`;

// Take one from the stores and set it: at = [x, y, r] on the map (placed by hand), else the game places it. The best
// kept one first. Returns { rec, key, msg } or { err }.
export function setFurniture(state, base, type, at = null) {
  const chk = canSetFurniture(state, base, type);
  if (!chk.ok) return { err: chk.reason || "It cannot be set here now." };
  const list = base.armory.map((it, i) => [it, i]).filter(([it]) => it && it.key === type).sort(([a], [b]) => (b.quality || 0) - (a.quality || 0));
  const [item, idx] = list[0];
  base.armory.splice(idx, 1);
  delete item.store; // containers.js: an assignment to a container goes with it out of the stores
  const rec = addBuilding(base, type);
  rec.item = item;
  const key = `b:${rec.id}`;
  if (at) {
    const err = placeItem(state, base, key, at[0], at[1], at[2] || 0);
    if (err) { base.buildings.splice(base.buildings.indexOf(rec), 1); base.armory.splice(idx, 0, item); return { err }; }
  }
  const n = BED_SPEC[type].sleepers;
  return { rec, key, msg: `${nameOf(type)} set ${at ? "there" : "inside a building with room (placed by the game)"}: +${bedsWord(n)} at ${base.name} (${baseBeds(base)} in all).` };
}
// The base map's Build on a piece of furniture (basemap.js layoutAct build): set where the ghost is. Returns an error or "".
export function setFurnitureAt(state, b, base, type, g) {
  const L = b.layout;
  const r = setFurniture(state, base, type, g.at);
  if (r.err) return r.err;
  L.msg = r.msg;
  L.sel = r.key;
  if (!furnitureInStores(base, type)) L.pickType = null; // none left to set
  refreshBaseMap(state);
  return "";
}
// Demolish on a set piece (buildings.js demolish), or its building pulled down: back into the stores, whole.
export function pickUpFurniture(state, base, rec) {
  const i = base.buildings.indexOf(rec);
  if (i >= 0) base.buildings.splice(i, 1);
  const item = rec.item && typeof rec.item === "object" ? rec.item : makeItem(rec.type, 0.8);
  base.armory.push(item);
  const n = BED_SPEC[rec.type] ? BED_SPEC[rec.type].sleepers : 0;
  return `${nameOf(rec.type)} picked up and put back in the stores (−${bedsWord(n)}: ${baseBeds(base)} at ${base.name}).`;
}

// ---------- who sleeps where ----------
// Every bed at a base, best first: { kind, mood } (kind: a furniture type, "bunks" for the bunk beds fitting, "plain"
// for the rest). The children's beds (base.kidBeds) are the worst ones.
export function bedSlots(base) {
  const slots = [];
  for (const b of base.buildings || []) { const s = BED_SPEC[b.type]; if (s && !b.broken) for (let i = 0; i < s.sleepers; i++) slots.push({ kind: b.type, mood: s.mood }); }
  const bunks = count(base, "bunks") * BEDS.bunks;
  const plain = Math.max(0, plainBeds(base) - bunks);
  for (let i = 0; i < bunks; i++) slots.push({ kind: "bunks", mood: BED_MOOD.bunks });
  for (let i = 0; i < plain; i++) slots.push({ kind: "plain", mood: BED_MOOD.plain });
  slots.sort((a, b) => b.mood - a.mood); // stable: the furniture before the plain beds of the same mood
  slots.length = Math.max(0, slots.length - (base.kidBeds || 0));
  return slots;
}
// Who sleeps in which bed: Map(survivor id -> slot, or null sleeping rough). The people whose home it is (world.js
// residents), but not those in a hospital bed (medical.js inBed): the leader first, then by id.
export function bedAssignments(state, base) {
  const slots = bedSlots(base);
  const people = residents(state, base.id).filter((s) => !s.inBed).sort((a, b) => (b.leader ? 1 : 0) - (a.leader ? 1 : 0) || a.id - b.id);
  const out = new Map();
  people.forEach((s, i) => out.set(s.id, slots[i] || null));
  return out;
}
const slotWord = (slot) => (slot.kind === "bunks" ? "in a bunk bed (the bunk beds fitting)" : slot.kind === "plain" ? "in a bed" : BED_SPEC[slot.kind].word);
// The mood line for where someone sleeps tonight (relations.js moodFactors, applied there each morning), or null (a
// plain bed, a hospital bed, away from home).
export function bedLine(state, s, base) {
  if (!base || !s) return null;
  const a = bedAssignments(state, base);
  if (!a.has(s.id)) return null;
  const slot = a.get(s.id);
  if (!slot) return { label: `Sleeps rough: no bed for them (${a.size} people for ${baseBeds(base)} beds)`, v: BED_MOOD.rough, tip: "Set more beds inside the base's buildings (craft cots, beds, bunk beds or large beds), or build a bunkhouse" };
  if (!slot.mood) return null;
  return { label: `Sleeps ${slotWord(slot)}`, v: slot.mood, tip: slot.mood > 0 ? "A large bed: a good night's sleep" : "A cot or a bunk is no real rest: a bed or a large bed would do better" };
}
// The base window's line: "2 cots, 1 large bed (4 beds)" or "".
export function furnitureText(base) {
  const set = furnitureSet(base);
  const parts = BED_KINDS.filter((k) => set[k]).map((k) => `${set[k]} ${lower(k)}${set[k] === 1 ? "" : "s"}`);
  return parts.length ? `${parts.join(", ")} (${bedsWord(furnitureBeds(base))})` : "";
}

// ---------- old saves ----------
// The retired makeshift cots (buildings.js cots: +2 beds each) become two Cots set at that base each, placed by the
// game (inside a building with room, else counted off the map). Idempotent: nothing left to do once done.
export function migrateCots(state) {
  let n = 0;
  for (const base of state.bases || []) {
    if (!base || !Array.isArray(base.buildings)) continue;
    for (const old of base.buildings.filter((b) => b.type === "cots")) {
      base.buildings.splice(base.buildings.indexOf(old), 1);
      for (let i = 0; i < BEDS.cots; i++) { const rec = addBuilding(base, "cot"); rec.item = makeItem("cot", 0.8); if (old.wear) rec.wear = old.wear; n++; }
    }
  }
  return n;
}

// ---------- loot ----------
// A loose bed or cot found on a search this hour (BED_FINDS by the place's kind: a site or a point of interest; its
// own dice, as the carts'), or null.
export function rollBedFind(state, tileId, kind, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = BED_FINDS[kind];
  if (!t || !site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "bedfind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pickWeighted(site.items, hash01(state.seed, "bedpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(kind), hash01(state.seed, "beddur", tileId, state.hour, salt)) : null;
}

// ---------- the governor ----------
// Spare: what a base keeps back from a furniture craft (scrap for repairs and builds, wood for the stove).
export const GOV_BEDS = { keepScrap: 15, keepWood: 120 };
// The morning's plan at a base the governor runs (autopilot.js governBase): furniture in the stores set inside a
// building with room; short of beds, a bunk bed (else a cot) queued at the bench. Returns the lines to say.
export function governBeds(state, base) {
  const out = [];
  for (const type of BED_KINDS) {
    while (furnitureInStores(base, type) && canSetFurniture(state, base, type).ok) {
      const r = setFurniture(state, base, type);
      if (r.err) break;
      out.push(r.msg);
    }
  }
  if (craftQueue(base).some((j) => BED_SPEC[j.recipe])) return out; // one at a time
  const people = residents(state, base.id).length;
  if (people <= baseBeds(base)) return out;
  for (const type of ["bunkbed", "cot"]) {
    const c = BED_CRAFTS[type].in;
    if ((base.stock.scrap || 0) < (c.scrap || 0) + GOV_BEDS.keepScrap || (base.stock.wood || 0) < (c.wood || 0) + GOV_BEDS.keepWood) continue;
    if (furnitureProblem(base, type) || !canCraft(state, base, type).ok) continue;
    out.push(`${people} people for ${baseBeds(base)} beds at ${base.name}: ${queueCraft(state, base, type)}`);
    break;
  }
  return out;
}

// ---------- AI groups (see the header) ----------
const nW = (w, k) => (w && w[k]) || 0;
/** The sleepers of a base's furniture (its works). @param {any} w */
export const furnSleepers = (w) => BED_KINDS.reduce((a, k) => a + nW(w, k) * BED_SPEC[k].sleepers, 0);
const furnCells = (w) => BED_KINDS.reduce((a, k) => a + nW(w, k) * BED_SPEC[k].w * BED_SPEC[k].h, 0);
/** The floor a base's halls give furniture (cells). @param {any} w */
export const hallRoom = (w) => nW(w, "hall") * BEDS_AI.room;
/** Their hall work: your Lodge (BUILDINGS.gen_lodge), its cost, its hours as crew-days (groupworks.js storeDef's rule). */
export function hallDef() {
  const B = BUILDINGS.gen_lodge;
  return { name: "a lodge for beds", cost: { ...B.cost }, work: Math.max(1, Math.round(B.hours / GROUP_WORKS.CREW_HOURS)) };
}
const canPay = (f, cost, keep = {}) => Object.entries(cost).every(([k, v]) => (k === "parts" ? canPayParts(f, v, "free") : ((f.stock && f.stock[k]) || 0) >= v + (keep[k] || 0)));
const pay = (f, cost) => { for (const [k, v] of Object.entries(cost)) { if (k === "parts") payParts(f, v, "free"); else f.stock[k] -= v; } };
const keepOf = (f) => ({ scrap: BEDS_AI.keep * Math.max(1, f.pop), wood: 2 * Math.max(1, f.pop) });
// A hall at their main base (groupworks.js nextWork, after the main base's other works), or null: none yet, big enough
// (BEDS_AI.pop), and the Lodge's cost to spare (as your canBuild: paid when the job starts).
export function hallWork(state, f, tile) {
  if (!groupsBuild(state, f) || tile !== f.bases[0] || f.pop < BEDS_AI.pop) return null;
  const w = f.works && f.works[tile];
  if (nW(w, "hall") || nW(w, "camp")) return null;
  const def = hallDef();
  if (!canPay(f, def.cost, { scrap: BEDS_AI.keep * f.pop })) return null;
  return { tile, type: "hall", why: "a lodge to set beds in", def };
}
// A day's furniture for one group: at most one piece, at the first base with a hall and floor left for it (your rule:
// basemap.js fittingRoom on their base as a base object, its buildings in step with their works; BEDS_AI.room cells
// a hall at most): people sleeping rough there get a bunk bed (else a cot; paid whatever they keep back), else a large
// bed while the large beds sleep fewer than everyone there and they can spare it. Returns { tile, type } or null.
export function groupBedsDaily(state, f) {
  if (!groupsBuild(state, f) || !f.stock || !f.bases.some((t) => nW(f.works && f.works[t], "hall"))) return null;
  syncBuildings(state, f);
  const homes = homesOf(state, f);
  for (const tile of f.bases) {
    const w = f.works && f.works[tile];
    if (!nW(w, "hall") || !homes[tile] || homes[tile].real) continue;
    const free = hallRoom(w) - furnCells(w);
    const people = groupPeopleAt(f, tile);
    const rough = nW(w, "beds") * GROUP_WORKS.SERVES.beds + furnSleepers(w) < people;
    const want = rough ? ["bunkbed", "cot"] : nW(w, "bigbed") * BED_SPEC.bigbed.sleepers < people ? ["bigbed"] : [];
    for (const type of want) {
      const s = BED_SPEC[type], cost = BED_CRAFTS[type].in;
      if (s.w * s.h > free || !canPay(f, cost, rough ? {} : keepOf(f)) || !fittingRoom(state, homes[tile], type)) continue;
      pay(f, cost);
      w[type] = nW(w, type) + 1;
      return { tile, type };
    }
  }
  return null;
}
// Their people's mood from their beds (see the header): × BEDS_AI.morale, the mean bed mood a head (rough sleepers 0:
// groupworks.js growthFactor already weighs people sleeping rough).
export function groupBedMorale(state, f) {
  if (!groupsBuild(state, f) || !(f.pop > 0)) return 0;
  let sum = 0;
  for (const tile of f.bases) {
    const w = f.works && f.works[tile];
    let left = groupPeopleAt(f, tile);
    const tiers = [[nW(w, "bigbed") * 2, BED_SPEC.bigbed.mood], [nW(w, "bed") + nW(w, "beds") * GROUP_WORKS.SERVES.beds, BED_MOOD.plain], [nW(w, "bunkbed") * 2, BED_SPEC.bunkbed.mood], [nW(w, "cot"), BED_SPEC.cot.mood]];
    for (const [beds, mood] of tiers) { const k = Math.min(left, beds); sum += k * mood; left -= k; }
  }
  return BEDS_AI.morale * (sum / f.pop);
}
