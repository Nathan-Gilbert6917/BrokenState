// @ts-check
// Saving and loading a whole world. Pure simulation: no DOM, no storage, no clock (ui/saves.js stores the result).
//
// A save is the state written as a graph, not a tree: everything the sim keeps is written once, whatever shape it
// has, so nothing has to be listed by hand and a module that adds a field to the state is saved with it.
// - Plain objects and arrays as JSON. Maps, Sets, typed arrays (the timelapse's Uint16 / Uint8 frames, base64),
//   the seeded generators (Rng: their position in the sequence) and the hex grid are tagged objects.
// - An object reachable from two places is written once and referenced after that, so links survive a load:
//   an item worn by a survivor and listed at a death site, the chronicle's frames sharing one list of bases, a
//   battle's supply pools that are the team's own supplies, state.rng and the battle's rng, memorial moments.
// - The chronicle's WeakMaps / WeakSet (keyed by hordes and parties) are written as the entries for the objects
//   still in the world (exactly what a WeakMap can still answer for).
// - undefined, NaN, ±Infinity and -0 keep their values (JSON would turn them into null or 0).
// - The id counter (world.js newId) is saved, so a loaded world hands out the same ids as the original.
// What cannot be saved: an open event card. Its choices are code (closures over the moment the card was made),
// so saving waits until the card is answered (saveBlocker). Battles, raids, the deploy step, searches and trade
// windows are plain data and are saved as they are, mid-turn included.
//
// Tags (the key "$" marks one; a plain object that has its own "$" key is wrapped in an "O" tag):
//   { $: "D", i, v }  first sight of a shared object (id i, v its usual form) · { $: "R", i }  a reference to it
//   { $: "M", e: [[k, v]…] } Map · { $: "S", e: […] } Set · { $: "WM", e } WeakMap · { $: "WS", e } WeakSet
//   { $: "T", t: "Uint16Array", b: base64 } typed array · { $: "Rng", s } · { $: "Grid", w, h } · { $: "O", v }
//   { $: "u" } undefined · { $: "N", v: "NaN" | "Infinity" | "-Infinity" | "-0" }
import { migrateAllMods } from "./gunmods.js"; // old saves: gun parts onto the attachment slots
import { migrateAmmo, findRounds, kindTheme } from "./ammo.js"; // old saves: generic ammo into rounds by calibre
import { sanitizeLibrary } from "./custombg.js"; // a save's custom backgrounds: their old generic ammo as rounds
import { migrateKit } from "./carrykit.js"; // old saves: carriers' plates, spare magazines
import { Rng } from "./rng.js";
import { HexGrid } from "./hex.js";
import { peekNextId, setNextId, day, hub, alive, fillCrafting, fillMelee } from "./world.js";
import { WORLD_SIZES, worldSizeOf } from "./worldsize.js";
import { WOOD_UNITS, GEAR } from "./data.js"; // firewood was a 3 kg bundle: older saves are scaled to 0.1 kg units
import { makeLosCache, SparseLos } from "./combat.js";
import { CRAFT_BOOKS, tech } from "./blueprints.js"; // craft books read before they unlocked anything // the line-of-sight cache of a loaded battle (sparse on a big yard)
import { saveSummary, campaignKey } from "./savesummary.js"; // the save list's one-line summary and campaign groups
import { noteLootAge } from "./itemcond.js"; // the years since the fall, for loot rolled after a load
/** @import { State } from "./types" */
/**
 * A save (serializeState; a save file is it as JSON): the world's encoded graph, the id counter and the save list's summary.
 * @typedef {{ format: string, v: number, game: string, nextId: number, meta: ReturnType<typeof saveMeta>, state: any }} SaveFile
 */

export const SAVE_FORMAT = "broken-state-save";
// Bump when the state changes in a way an older save cannot just be loaded into, and add a migration below.
export const SAVE_VERSION = 1;
export const GAME_VERSION = "0.2.0";

// Migrations by the version they upgrade from: MIGRATIONS[n](save) turns a version-n save into version n + 1
// (save.state is the encoded graph; decode, fix, encode again if that is easier). Version 1 is the first.
const MIGRATIONS = {};

export class SaveError extends Error {
  constructor(message, code = "error", path = "") {
    super(message);
    this.name = "SaveError";
    this.code = code;
    this.path = path;
  }
}

// Why the world cannot be saved right now (a message for the player), or "" when it can.
/** @param {State} state */
export function saveBlocker(state) {
  if (!state) return "There is no game to save.";
  if (state.cards && state.cards.length) {
    const c = state.cards[0];
    return `A card is waiting for an answer${c && c.title ? ` ("${c.title}")` : ""}. Answer it, then save: a card's choices cannot be written to a save.`;
  }
  return "";
}

// A short description of a world for the save list (no clock: the caller adds the time it was saved).
/** @param {State} state */
export function saveMeta(state) {
  const h = hub(state);
  return {
    day: day(state), hour: state.hour % 24, hub: h ? h.name : "", survivors: alive(state).length,
    seed: state.seed, groups: (state.factions || []).length, gameOver: !!state.gameOver, victory: !!state.victory,
    autopilot: !!state.autopilot, world: worldSizeOf(state), // "world", not "size": the save list keeps the byte size under that key (ui/saves.js)
    mode: state.mode === "hardcore" ? "hardcore" : "normal", // hardcore.js: the save list says which
    ironman: !!state.ironman, // ui/saves.js: an Ironman game's own slot
    ...(state.mode === "hardcore" && Number.isFinite(state.startPeople) ? { startPeople: state.startPeople } : {}), // hardcore.js START_PEOPLE: the save list says when it was not three
    summary: saveSummary(state), camp: campaignKey(state), // "Day 143 · 31 people · winter · …"; the campaign the save list groups it under
  };
}

// The world as a JSON-safe object. opts.dropCards: write the world without its open cards (the game-over autosave;
// a run that has ended has nothing left to answer). Throws a SaveError when something in it cannot be saved.
/** @param {State} state @param {{ dropCards?: boolean }} [opts] @returns {SaveFile} */
export function serializeState(state, { dropCards = false } = {}) {
  const why = saveBlocker(state);
  if (why && !(dropCards && state && state.cards && state.cards.length)) throw new SaveError(why, "card", ".cards");
  const root = dropCards && state.cards.length ? { ...state, cards: [] } : state;
  // A battle's line-of-sight cache is only a cache (combat.js makeLosCache: up to tens of MB on a big yard or a fort map):
  // left out of the save and made fresh on load, the floors' too (the cells and reach they alias stay shared).
  const lean = root.combat && root.combat.losCache ? { ...root, combat: { ...root.combat, losCache: null, floors: Array.isArray(root.combat.floors) ? root.combat.floors.map((F) => ({ ...F, losCache: null })) : root.combat.floors } } : root;
  return {
    format: SAVE_FORMAT, v: SAVE_VERSION, game: GAME_VERSION,
    nextId: peekNextId(), meta: saveMeta(state),
    state: encodeGraph(lean),
  };
}

// Is this a save this version can load? { ok, why }.
/** @param {any} save @returns {{ ok: boolean, why: string }} */
export function checkSave(save) {
  if (!save || typeof save !== "object" || save.format !== SAVE_FORMAT || !save.state) return { ok: false, why: "This is not a Broken State save." };
  const v = Number(save.v);
  if (!Number.isInteger(v) || v < 1) return { ok: false, why: "This save has no version number; it cannot be loaded." };
  if (v > SAVE_VERSION) return { ok: false, why: `This save was made by a newer version of the game (save format ${v}; this version reads up to ${SAVE_VERSION}).` };
  for (let n = v; n < SAVE_VERSION; n++) if (!MIGRATIONS[n]) return { ok: false, why: `This save is too old to load (save format ${v}; this version reads ${SAVE_VERSION}).` };
  return { ok: true, why: "" };
}

// A live world from a save object (serializeState's result, after JSON.parse). Old versions are migrated first.
// Sets the id counter (world.js), so call it only for the world that is about to be played.
/** @param {SaveFile} save @returns {State} */
export function deserializeState(save) {
  const chk = checkSave(save);
  if (!chk.ok) throw new SaveError(chk.why, "version");
  let s = save;
  for (let n = Number(s.v); n < SAVE_VERSION; n++) s = MIGRATIONS[n](s);
  let state;
  try {
    state = decodeGraph(s.state);
  } catch (e) {
    throw new SaveError(`The save is damaged and cannot be loaded (${e.message}).`, "damaged");
  }
  if (!state || !Array.isArray(state.tiles) || !state.grid || !Array.isArray(state.bases)) throw new SaveError("The save is damaged and cannot be loaded (no map or bases).", "damaged");
  setNextId(Number(s.nextId));
  // The world size (worldsize.js): a save from before sizes is a Normal 64 × 42 map (worked out from its grid).
  if (!WORLD_SIZES[state.worldSize]) state.worldSize = worldSizeOf(state); // a custom size stays "custom" (its grid says how big)
  if (state.mode !== "hardcore") state.mode = "normal"; // saves from before the modes (hardcore.js)
  noteLootAge(state); // itemcond.js: loot rolled after the load is as old as this world (shops and homes, COND_AGE)
  // Starting people (hardcore.js START_PEOPLE): a hardcore save from before the choice started with three (its start's
  // backgrounds name them); a normal start has none.
  if (state.mode === "hardcore" && !Number.isFinite(state.startPeople)) {
    const bg = state.hardcore && state.hardcore.start && state.hardcore.start.backgrounds;
    state.startPeople = bg && Object.keys(bg).length ? Object.keys(bg).length : 3;
  }
  // needs.js: saves from before the hunger and thirst gauges start everyone full.
  for (const sv of state.survivors || []) { if (!Number.isFinite(sv.hunger)) sv.hunger = 100; if (!Number.isFinite(sv.thirst)) sv.thirst = 100; }
  // Crafting (data.js SKILLS, crafting.js): people in a save from before the skill start at 0.7 × their Mechanics
  // (appearance.js CRAFT_START.oldSave), their skill floor too; anyone else carrying skills (prisoners, visitors,
  // children grown later) is filled the same way the first time world.js skill() or skills.js ensureSkills sees them.
  for (const sv of state.survivors || []) fillCrafting(sv); // only where it is missing: a newer save loads unchanged
  // Melee (data.js SKILLS, world.js fillMelee): the same for people from before it: half their Shooting plus 0-6 by a
  // hash of their name (appearance.js meleeOldSave), their floor too, and no perk point for milestones already passed.
  for (const sv of state.survivors || []) fillMelee(sv);
  // Craft books (blueprints.js CRAFT_BOOKS): one someone had already read to the end before they unlocked anything
  // (Small Engine Repair) counts as read.
  for (const sv of state.survivors || []) for (const [k, h] of Object.entries(sv.books || {})) {
    if (CRAFT_BOOKS[k] && GEAR[k] && GEAR[k].book && h >= GEAR[k].book.hours - 1e-9 && !tech(state).known.includes(k)) tech(state).known.push(k);
  }
  // woodcutting.js: saves from before firewood (no state.woodcutting) start every base with none, and the work roles
  // get the Cut wood job at the priority they give foraging. Worlds made since carry the mark, so they load unchanged.
  if (!state.woodcutting) {
    for (const b of state.bases || []) if (b.stock && !Number.isFinite(b.stock.wood)) b.stock.wood = 0;
    for (const r of (state.work && state.work.roles) || []) if (r.pri && r.pri.wood == null && r.pri.forage > 0) r.pri.wood = r.pri.forage;
    state.woodcutting = 1;
  }
  // Firewood of 0.1 kg (data.js SUPPLIES.wood; it was a 3 kg bundle): a save from before (woodcutting mark under 2)
  // has every firewood amount scaled by WOOD_UNITS (scaleSavedWood), once: the mark goes to 2.
  if (!(state.woodcutting >= 2)) {
    scaleSavedWood(state, WOOD_UNITS);
    state.woodcutting = 2;
  }
  // water.js: saves from before purified and un-purified water (no state.rawWater) keep all their water as purified
  // water; un-purified water starts at 0 everywhere (bases, teams' supplies and cargo, the staging camp's stores), and
  // the water a team carried marked unboiled (worm.js's old p.wormWater) becomes un-purified water (cargo first) at
  // its eggs. Other groups keep their single water pool (trade.js poolKey).
  if (!state.rawWater) {
    for (const b of state.bases || []) if (b.stock && !Number.isFinite(b.stock.rawwater)) b.stock.rawwater = 0;
    for (const p of state.parties || []) {
      for (const o of [p.supplies, p.cargo && p.cargo.supplies]) if (o && !Number.isFinite(o.rawwater)) o.rawwater = 0;
      let unsafe = Math.max(0, Number(p.wormWater) || 0);
      for (const o of [p.cargo && p.cargo.supplies, p.supplies]) {
        if (!o || !(unsafe > 0)) continue;
        const q = Math.min(unsafe, Math.max(0, o.water || 0));
        o.water -= q; o.rawwater += q; unsafe -= q;
      }
      delete p.wormWater;
    }
    if (state.staging && state.staging.stores && !Number.isFinite(state.staging.stores.rawwater)) state.staging.stores.rawwater = 0;
    state.rawWater = 1;
  }
  // Rounds by calibre (ammo.js, the weapons overhaul): a save from before (no state.ammoCal) has every generic ammo
  // stock of yours split across the calibres of the guns that holder owns (9mm and 12 gauge with none), the same total.
  if (!state.ammoCal) { migrateAmmo(state); state.ammoCal = 1; }
  // All ammo by calibre (2026-10-09, user request: "All ammo should be based on caliber"): a save from before has its
  // generic ammo settled again in every holder of yours, its custom backgrounds' generic ammo as the rounds of their
  // guns, and the rewards of the jobs on offer or under way as the rounds the group's kind keeps.
  if (state.ammoCal < 2) {
    migrateAmmo(state);
    if (state.customBackgrounds) state.customBackgrounds = sanitizeLibrary(state.customBackgrounds);
    for (const j of (state.jobs && state.jobs.list) || []) {
      const r = j.reward;
      if (!r || !r.supplies || !(r.supplies.ammo >= 1) || j.status === "done") continue;
      const f = (state.factions || []).find((x) => x.id === j.fid);
      const n = Math.floor(r.supplies.ammo);
      delete r.supplies.ammo;
      for (const [k, q] of Object.entries(findRounds(kindTheme(f ? f.type : null), n, "jobreward", j.id))) r.supplies[k] = (r.supplies[k] || 0) + q;
    }
    state.ammoCal = 2;
  }
  // A stock amount that is NaN is 0: before 7212b81 a team packing a supply its base had no key for (firewood on a
  // hardcore hub) made the base's stock NaN, and saves of that time carry it (tools/savecorpustest.js found it).
  const unNaN = (o) => { if (o) for (const k of Object.keys(o)) if (Number.isNaN(o[k])) o[k] = 0; };
  for (const b of state.bases || []) unNaN(b.stock);
  for (const p of state.parties || []) { unNaN(p.supplies); unNaN(p.cargo && p.cargo.supplies); }
  // gunmods.js: guns from before the attachment slots (four mounts) have their parts moved to their slots (the laser to
  // tactical, the foregrip to grip) and a sight that now needs a mount gets one. Once: state.gunSlots.
  if (!(state.gunSlots >= 1)) { migrateAllMods(state); state.gunSlots = 1; }
  // carrykit.js: carry kit (wave 2): plate carriers from before get their two plates, your people's guns their spare
  // magazines. Once: state.kitV.
  if (!(state.kitV >= 2)) migrateKit(state);
  // vehicles.js fleets: a team's vehicles as a list (p.vehicleIds) with the lead one in p.vehicleId; a save from before
  // has the one vehicleId, which becomes a list of one. Once: state.fleetV.
  if (!(state.fleetV >= 1)) {
    for (const p of state.parties || []) if (!Array.isArray(p.vehicleIds) && p.vehicleId != null) p.vehicleIds = [p.vehicleId];
    state.fleetV = 1;
  }
  // alliance.js memberLand: a member's land counts a year after it joined (alliance.joined); a member in a save without
  // its join day is counted as joining on the day the save is loaded (its land counts a year later).
  if (state.alliance && Array.isArray(state.alliance.members)) {
    const A = state.alliance, d = Math.floor((state.hour || 0) / 24) + 1;
    if (!A.joined || typeof A.joined !== "object") A.joined = {};
    for (const id of A.members) if (A.joined[id] == null) A.joined[id] = d;
  }
  if (state.governor) state.governor.busy = false; // never saved mid-call, but a damaged flag would stop the autopilot for good
  // A raid in a building with storeys (combat.js setFloor): b.cells / b.reach / b.losCache alias the active floor's
  // arrays. The graph writes a shared object once, so the aliases come back pointing at the same arrays; this re-points
  // them all the same (a save edited by hand, an older encoder), and the "away" flags follow the active floor.
  const b = state.combat;
  // A big yard's sparse line-of-sight cache (combat.js SparseLos) comes back as a plain Map: a fresh one (it is only a cache).
  if (b && (!b.losCache || (b.losCache instanceof Map && !(b.losCache instanceof SparseLos)))) b.losCache = makeLosCache(b.w, b.h);
  for (const F of (b && b.floors) || []) if (F.losCache instanceof Map && !(F.losCache instanceof SparseLos)) F.losCache = null;
  if (b && Array.isArray(b.floors) && b.floors.length) {
    const F = b.floors[b.floor || 0] || b.floors[0];
    b.floor = b.floors.indexOf(F);
    if (!F.losCache) F.losCache = makeLosCache(b.w, b.h);
    b.cells = F.cells; b.reach = F.reach; b.losCache = F.losCache;
    for (const u of b.units || []) u.away = (u.f || 0) !== b.floor;
  }
  return state;
}

// Firewood amounts × k (a save from before firewood was 0.1 kg a unit): every number kept under the key "wood" anywhere
// in the world (bases' stock and the day's heating and boiler figures, teams' supplies and cargo and a Cut wood order's
// haul, groups', caravans', visitors' and the staging camp's stores, sites, containers and bodies, trades and deals;
// an object reached twice is scaled once), except the work roles' priorities and minimums that share the key (pri,
// over, a role's min); a Cut wood order's left-behind, the day's cut, the boiler's items' worth and the economy's
// tallies too. The groups' markets (prices per firewood) are made afresh. state.wood (the land's levels) is not an amount.
/** @param {State} state @param {number} k */
export function scaleSavedWood(state, k) {
  const seen = new Set();
  const walk = (o, key, parent) => {
    if (!o || typeof o !== "object" || seen.has(o) || ArrayBuffer.isView(o) || o instanceof WeakMap || o instanceof WeakSet) return;
    seen.add(o);
    if (key === "pri" || key === "over" || (key === "min" && parent && parent.pri)) return; // work.js roles: priorities, not firewood
    if (o instanceof Map) { for (const v of o.values()) walk(v, "", o); return; }
    if (o instanceof Set || Array.isArray(o)) { for (const v of o) walk(v, "", o); return; }
    for (const name of Object.keys(o)) {
      const v = o[name];
      if (name === "wood" && typeof v === "number" && Number.isFinite(v)) o[name] = v * k;
      else walk(v, name, o);
    }
  };
  walk(state, "", null);
  const times = (o, name) => { if (o && Number.isFinite(o[name])) o[name] *= k; };
  for (const b of state.bases || []) { times(b, "woodToday"); times(b.boilerBurn, "itemWood"); }
  for (const p of state.parties || []) if (p.task && p.task.type === "wood") times(p.task.got, "left");
  for (const name of ["heatWood", "woodCut", "woodField"]) times(state.econStats, name);
  for (const f of state.factions || []) delete f.market; // trade.js marketOf makes it again at today's prices
}

// String forms (a save file is this JSON).
/** @param {State} state */
/** @param {State} state @param {{ dropCards?: boolean }} [opts] @returns {string} */
export const saveToString = (state, opts) => JSON.stringify(serializeState(state, opts));
/** @param {string} text @returns {State} */
export const loadFromString = (text) => deserializeState(JSON.parse(text));

// ---------- the graph encoder ----------
const TYPED = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
const isPlain = (v) => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };
const keyLabel = (k) => (typeof k === "string" && /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${typeof k === "string" ? JSON.stringify(k) : String(k)}]`);

/** @param {any} root @returns {any} */
export function encodeGraph(root) {
  // Pass 1: how often each object is reached, and anything that cannot be written.
  const count = new Map();
  const weaks = [];
  const path = [];
  const fail = (what) => { throw new SaveError(`${what} at state${path.join("")} cannot be saved.`, what === "Code" ? "function" : "type", path.join("")); };
  const visit = (v) => {
    const t = typeof v;
    if (t === "function") fail("Code");
    if (t === "symbol" || t === "bigint") fail(`A ${t}`);
    if (v === null || t !== "object") return;
    const n = count.get(v);
    if (n !== undefined) { count.set(v, n + 1); return; }
    count.set(v, 1);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) { path.push(`[${i}]`); visit(v[i]); path.pop(); }
      for (const k of Object.keys(v)) if (!(String(+k >>> 0) === k && (+k >>> 0) < v.length)) { path.push(keyLabel(k)); fail("A property on a list"); }
      return;
    }
    if (ArrayBuffer.isView(v)) { if (!TYPED[v.constructor.name]) fail(`A ${v.constructor.name}`); return; }
    if (v instanceof Rng || v instanceof HexGrid) return;
    if (v instanceof WeakMap || v instanceof WeakSet) { weaks.push(v); return; }
    if (v instanceof Map) { for (const [k, x] of v) { path.push(`{${String(k)}}`); visit(k); visit(x); path.pop(); } return; }
    if (v instanceof Set) { let i = 0; for (const x of v) { path.push(`{#${i++}}`); visit(x); path.pop(); } return; }
    if (!isPlain(v)) fail(`An object of class ${v.constructor ? v.constructor.name : "?"}`);
    for (const k of Object.keys(v)) {
      const d = Object.getOwnPropertyDescriptor(v, k);
      path.push(keyLabel(k));
      if (d && (d.get || d.set)) fail("Code (a getter)");
      visit(d.value);
      path.pop();
    }
    if (Object.getOwnPropertySymbols(v).length) fail("A symbol key");
  };
  visit(root);
  // WeakMaps and WeakSets: the entries for objects in the world. The keys become shared, so they are written once.
  const weakKeys = new Map();
  if (weaks.length) {
    const objs = [...count.keys()];
    for (const w of weaks) weakKeys.set(w, objs.filter((o) => w.has(o)));
    for (const [w, keys] of weakKeys) for (const o of keys) {
      count.set(o, count.get(o) + 1);
      if (w instanceof WeakMap) { path.length = 0; path.push(".(weak map value)"); visit(w.get(o)); }
    }
  }
  // Pass 2: the encoded tree, shared objects as D (first sight) and R (after).
  const ids = new Map();
  let next = 0;
  const enc = (v) => {
    const t = typeof v;
    if (t === "number") {
      if (Number.isFinite(v)) return v === 0 && 1 / v < 0 ? { $: "N", v: "-0" } : v;
      return { $: "N", v: String(v) };
    }
    if (v === undefined) return { $: "u" };
    if (v === null || t !== "object") return v;
    const id = ids.get(v);
    if (id !== undefined) return { $: "R", i: id };
    if (count.get(v) > 1) {
      const i = next++;
      ids.set(v, i);
      return { $: "D", i, v: body(v) };
    }
    return body(v);
  };
  const body = (v) => {
    if (Array.isArray(v)) {
      const out = new Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = enc(v[i]);
      return out;
    }
    if (ArrayBuffer.isView(v)) return { $: "T", t: v.constructor.name, b: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (v instanceof Rng) return { $: "Rng", s: v.state };
    if (v instanceof HexGrid) return { $: "Grid", w: v.width, h: v.height };
    if (v instanceof Map) { const e = []; for (const [k, x] of v) e.push([enc(k), enc(x)]); return { $: "M", e }; }
    if (v instanceof Set) { const e = []; for (const x of v) e.push(enc(x)); return { $: "S", e }; }
    if (v instanceof WeakMap) return { $: "WM", e: weakKeys.get(v).map((k) => [enc(k), enc(v.get(k))]) };
    if (v instanceof WeakSet) return { $: "WS", e: weakKeys.get(v).map((k) => enc(k)) };
    const out = {};
    for (const k of Object.keys(v)) out[k] = enc(v[k]);
    return Object.prototype.hasOwnProperty.call(v, "$") ? { $: "O", v: out } : out;
  };
  return enc(root);
}

// ---------- the graph decoder (the same walk, in the same order) ----------
/** @param {any} data @returns {any} */
export function decodeGraph(data) {
  const refs = [];
  const put = (o, k, x) => {
    if (k === "__proto__") Object.defineProperty(o, k, { value: x, enumerable: true, writable: true, configurable: true });
    else o[k] = x;
  };
  const fillObj = (src, out) => { for (const k of Object.keys(src)) put(out, k, dec(src[k])); return out; };
  const fillArr = (src, out) => { for (let i = 0; i < src.length; i++) out[i] = dec(src[i]); return out; };
  const dec = (e) => {
    if (e === null || typeof e !== "object") return e;
    if (Array.isArray(e)) return fillArr(e, new Array(e.length));
    return e.$ === undefined ? fillObj(e, {}) : tagged(e, null);
  };
  // reg: the id this value is registered under (a D tag), before anything inside it is read (cycles).
  const tagged = (e, reg) => {
    const keep = (x) => { if (reg != null) refs[reg] = x; return x; };
    switch (e.$) {
      case "u": return undefined;
      case "N": return e.v === "-0" ? -0 : Number(e.v);
      case "R":
        if (!(e.i in refs)) throw new Error(`reference ${e.i} before its object`);
        return refs[e.i];
      case "D": {
        const v = e.v;
        if (Array.isArray(v)) return fillArr(v, (refs[e.i] = new Array(v.length)));
        if (v === null || typeof v !== "object") throw new Error("a shared value that is not an object");
        if (v.$ === undefined) return fillObj(v, (refs[e.i] = {}));
        return tagged(v, e.i);
      }
      case "O": return fillObj(e.v, keep({}));
      case "M": { const m = keep(new Map()); for (const [k, x] of e.e) m.set(dec(k), dec(x)); return m; }
      case "S": { const s = keep(new Set()); for (const x of e.e) s.add(dec(x)); return s; }
      case "WM": { const m = keep(new WeakMap()); for (const [k, x] of e.e) m.set(dec(k), dec(x)); return m; }
      case "WS": { const s = keep(new WeakSet()); for (const x of e.e) s.add(dec(x)); return s; }
      case "T": {
        const C = TYPED[e.t];
        if (!C) throw new Error(`unknown array type ${e.t}`);
        const bytes = b64ToBytes(e.b);
        return keep(new C(bytes.buffer, bytes.byteOffset, bytes.byteLength / C.BYTES_PER_ELEMENT));
      }
      case "Rng": { const r = new Rng(0); r.state = e.s; return keep(r); } // the exact number: it grows past 32 bits (rng.js)
      case "Grid": return keep(new HexGrid(e.w, e.h));
      default: throw new Error(`unknown tag ${String(e.$)}`);
    }
  };
  return dec(data);
}

// ---------- base64 (no Buffer / btoa: the same in the browser and in node) ----------
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64I = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64I[B64.charCodeAt(i)] = i;
/** @param {Uint8Array} u8 @returns {string} */
export function bytesToB64(u8) {
  const parts = [];
  const CH = 3 * 4096;
  for (let o = 0; o < u8.length; o += CH) {
    const end = Math.min(u8.length, o + CH);
    let s = "";
    for (let i = o; i < end; i += 3) {
      const a = u8[i], b = i + 1 < end ? u8[i + 1] : 0, c = i + 2 < end ? u8[i + 2] : 0;
      const n = (a << 16) | (b << 8) | c;
      s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < end ? B64[(n >> 6) & 63] : "=") + (i + 2 < end ? B64[n & 63] : "=");
    }
    parts.push(s);
  }
  return parts.join("");
}
/** @param {string} s @returns {Uint8Array} */
export function b64ToBytes(s) {
  const str = String(s).replace(/[^A-Za-z0-9+/]/g, "");
  const n = Math.floor((str.length * 3) / 4);
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < str.length; i += 4) {
    const a = B64I[str.charCodeAt(i)], b = B64I[str.charCodeAt(i + 1)];
    const c = i + 2 < str.length ? B64I[str.charCodeAt(i + 2)] : 0, d = i + 3 < str.length ? B64I[str.charCodeAt(i + 3)] : 0;
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < n) out[o++] = (v >> 16) & 255;
    if (o < n) out[o++] = (v >> 8) & 255;
    if (o < n) out[o++] = v & 255;
  }
  return out;
}
