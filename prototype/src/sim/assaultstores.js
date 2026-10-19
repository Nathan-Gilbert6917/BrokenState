// Their stores on the map of an assault (2026-10-19, the user's request: "have AI groups build storage units etc so the
// player can raid their supplies"). When you storm a group's base (conquest.js "baseAssault", the fort map: fort.js
// fortAssault), what that base really holds is on the map, in its storage, as at your own base (basemap.js makeStores):
//
// THE GOODS (assaultGoods): that base's own stock (groupbases.js homeAt: an outpost's own, the main base's f.stock), and
// at the main base the group's spare kit (loadouts.js spareKit: what it owns and nobody carries; arsenal.js keeps it
// there) with anything in the base's own armory list (a base of yours they hold). Water and raw water stay in their
// tanks; what a defender on this map carries is on them, not in a store (arsenal.js b.arsUsed, u.arsItem).
//
// THE CONTAINERS (layAssaultStores, the map phase, before anything else is placed): basestorage.js storageOf of their
// base, measured as yours is (the core by tier, every storage building by STORE_KG), laid on the yard the assault map
// generates (interior.js): the core is their main house (the hall, the bunk shack, a bunkhouse or barracks), a
// storehouse their Storehouse block, a root cellar or cold store the shed; every other storage building a stack of
// crates in the yard (a storage box 1 × 1, crates 2 × 1, a storage shed 2 × 2, a warehouse 3 × 3: BLOCK), as near the
// middle as there is open ground all round it, no door within two cells. An unbroken armory: its gun cage and ammo
// lockers, locked (basemap.js ARMORY_LOCK). What their room does not hold lies on piles in the yard (basemap.js PILE,
// outsideOf: one a PILE.KG, at most PILE.MAX). No dice: the same base lays the same way.
//
// THE CONTENTS (stockAssaultStores, the units phase, last): makeStores spreads the goods over the containers by room
// (the battle's rng), each container then one of the battle's loot containers too (raidloot.js lootLayer, kind
// "store": the same object in b.stores and b.fieldLoot, so the save keeps it as one): its items are the group's own
// item objects. Your people take from one standing next to it (the store's card or a click: the search window,
// raidloot.js raidMove): into their carried finds (u.haul) or their pockets and pack, under every rule of a raid's
// search (personalRoom, the hands: carry.js handsTakeRefusal, HAUL's time). A pile is quicker: HAUL counts its kg
// STEAL.PILE times lighter (c.haulRate), as raiders grab twice as much a turn from one. A locked container is taken
// from only once its lock is battered open (combatAct "forceStore": basemap.js forceLock, one blow, the whole turn,
// loud: a pry tool twice as hard), as raiders do at yours.
//
// THE END (assaultStoresEnd, combat.js endBattle before ground.js groundEnd): what left their containers is gone from
// that base (its stock by key: basemap.js takeStock; their kit off the books: arsenal.js removeFromArsenal; an armory
// item out of the list), except what stays with them: on a defeat everything your people carry from their stores; on
// a retreat or a win, what those who do not come home carry (the dead, the left behind, the taken); and unless you won,
// what was put down on their ground. Your people who come home bring theirs home (groundEnd: the team's cargo, as a
// field battle's finds). Then conquest.js captureBase gives half of what is left, never of what you already took.
// The autopilot and a fight by the numbers (autoResolveCombat) have no map: nothing here.
import { factionById, survivorById } from "./world.js"; // call-time only (the import cycle)
import { homeAt } from "./groupbases.js";
import { spareKit } from "./loadouts.js";
import { removeFromArsenal } from "./arsenal.js";
import { storageOf } from "./basestorage.js";
import { makeStores, outsideOf, takeStock, forceLock, lockedBox, PILE, STEAL, ARMORY_LOCK } from "./basemap.js";
import { SUPPLIES } from "./data.js";
import { CELL, active, nearRect } from "./combat.js";
import { fieldLayer, lootLayer } from "./raidloot.js";
import { fieldReady } from "./ground.js";
import { keyWord } from "./water.js";

// A storage building with no block of its own on the generated yard: crates of this size (w × h).
export const BLOCK = { storebox: [1, 1], crates: [2, 1], freezer: [2, 1], coldstore: [2, 2], cellar: [2, 2], shed: [2, 2], storehouse: [3, 2], warehouse: [3, 3], core: [3, 2], gear: [2, 1], ammo: [2, 1] };
const HOUSES = ["hall", "shack", "bunkhouse", "barracks"]; // the core: their main house first
const AS_BLOCK = { storehouse: "storehouse", cellar: "shed", coldstore: "shed" }; // a storage building as a structure of the generated yard (interior.js STRUCTURES key)
const NOT_STORED = new Set(["water", "rawwater"]);
const DOOR_GAP = 2; // no crate within this many cells of a door

// ---------- the goods ----------
const tileOf = (setup) => (typeof setup.tile === "object" && setup.tile ? setup.tile.id : setup.tile);
/**
 * The group's base being stormed and what it holds: { f, h, tile, view } (view: a base in the player's shape for
 * storageOf / makeStores: their buildings, their stock without water, the items in their stores), or null.
 * except: items not to count (carried by a defender on this map).
 * @param {any} state @param {any} setup @param {Set<any> | null} except
 */
export function assaultGoods(state, setup, except = null) {
  const e = (setup && setup.enemy) || {};
  const fid = e.factionId ?? (setup && setup.context && setup.context.factionId);
  const f = fid != null ? factionById(state, fid) : null;
  const tile = tileOf(setup);
  const h = f ? homeAt(state, f, tile) : null;
  if (!h) return null;
  const stock = {};
  for (const [k, q] of Object.entries(h.stock || {})) if (typeof q === "number" && q >= 1 && SUPPLIES[k] && !NOT_STORED.has(k)) stock[k] = Math.floor(q);
  const items = [];
  for (const it of [...(h.stock === f.stock ? spareKit(f) : []), ...(h.armory || [])]) if (it && !items.includes(it) && !(except && except.has(it))) items.push(it);
  const view = { id: -1, tile, type: h.type, tier: h.tier, camp: h.camp, group: true, fid: f.id, name: h.name, buildings: h.buildings || [], construction: [], stock, armory: items };
  return { f, h, tile, view };
}

// ---------- the map phase: the containers ----------
/**
 * Lays their storage on the assault's yard (F: fort.js buildFort's record of the generated yard): F.stores, the crates
 * on F.cells. Returns how many containers (0: no group base there, or nothing to keep goods in).
 * @param {any} state @param {any} setup @param {any} F
 */
export function layAssaultStores(state, setup, F) {
  const G = assaultGoods(state, setup);
  if (!G || !F || !F.cells) return 0;
  const st = storageOf(state, G.view);
  const W = F.W, cells = F.cells;
  const at = (x, y) => cells[y * W + x];
  const yard = (x, y) => x >= F.x0 && y >= F.y0 && x < F.x0 + F.yw && y < F.y0 + F.yh;
  const doors = F.doors || [];
  const nearDoor = (x, y) => doors.some(([dx, dy]) => Math.max(Math.abs(dx - x), Math.abs(dy - y)) <= DOOR_GAP);
  // Free for a block: open ground (no floor, not indoors, no door near) under it, walkable ground all round it.
  const fits = (x0, y0, w, h) => {
    for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) {
      if (!yard(x, y) || (F.indoor && F.indoor[y * W + x])) return false;
      const c = at(x, y);
      if (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h) { if (c.k !== "open" || c.f === "floor" || nearDoor(x, y)) return false; }
      else if (!CELL[c.k] || !CELL[c.k].walk) return false;
    }
    return true;
  };
  const cx = F.x0 + Math.floor(F.yw / 2), cy = F.y0 + Math.floor(F.yh / 2), R = Math.max(F.yw, F.yh);
  const spot = (w, h) => {
    for (let d = 0; d <= R; d++) for (let y = cy - d; y <= cy + d; y++) for (let x = cx - d; x <= cx + d; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== d) continue;
      if (fits(x, y, w, h)) return [x, y];
    }
    return null;
  };
  const push = (s) => { F.stores.push({ id: F.stores.length + 1, weight: 1, bid: null, room: 0, ...s }); return true; };
  const block = (size, s) => {
    const [w, h] = size;
    const p = spot(w, h);
    if (!p) return false;
    for (let y = p[1]; y < p[1] + h; y++) for (let x = p[0]; x < p[0] + w; x++) { const c = at(x, y); c.k = "crate"; c.v = (x + y) % 2 ? 1 : 2; c.store = true; delete c.h; delete c.t; if (s.pile) c.pile = true; }
    return push({ x: p[0], y: p[1], w, h, ...s });
  };
  const used = new Set();
  const structure = (keys) => {
    const s = (F.buildings || []).find((x) => keys.includes(x.key) && !used.has(x));
    if (s) used.add(s);
    return s || null;
  };
  // The containers, as storageOf counts them (a car of theirs is not storage here; an opened case lies in the armory).
  const names = new Map();
  for (const c of st.containers) names.set(c.name, (names.get(c.name) || 0) + 1);
  const seen = new Map();
  const labelOf = (name) => { const n = (seen.get(name) || 0) + 1; seen.set(name, n); return names.get(name) > 1 ? `${name} ${n}` : name; };
  for (const c of st.containers) {
    if (c.kind === "core") {
      const s = structure(HOUSES) || (F.buildings || []).find((x) => !x.roof && !used.has(x));
      if (s) { used.add(s); push({ label: s.name, x: s.x0, y: s.y0, w: s.w, h: s.h, room: c.cap }); }
      else block(BLOCK.core, { label: c.name, room: c.cap });
      continue;
    }
    if (c.kind !== "building") continue;
    const bid = Number(String(c.key).slice(2));
    const rec = G.h.buildings.find((x) => x.id === bid);
    if (c.type === "armory") {
      // The gun cage and the ammo lockers, locked unless the armory is broken (basemap.js pushStore).
      const locked = !(rec && rec.broken);
      for (const [holds, what] of [["gear", "gun cage"], ["ammo", "ammo lockers"]]) block(BLOCK[holds], { label: `${c.name} ${what}`, bid, holds, ...(locked ? { lock: { hp: ARMORY_LOCK.HP, mhp: ARMORY_LOCK.HP, open: false } } : {}) });
      continue;
    }
    const s = AS_BLOCK[c.type] ? structure([AS_BLOCK[c.type]]) : null;
    const label = labelOf(c.name);
    if (s) push({ label, x: s.x0, y: s.y0, w: s.w, h: s.h, bid, room: c.cap });
    else block(BLOCK[c.type] || [2, 1], { label, bid, room: c.cap });
  }
  // What their room does not hold: piles in the yard (basemap.js layPiles), one a PILE.KG, at most PILE.MAX.
  const out = outsideOf(state, G.view);
  if (out) {
    const n = Math.max(1, Math.min(PILE.MAX, Math.ceil(out.kg / PILE.KG)));
    let laid = 0;
    for (let i = 0; i < n; i++) if (block([PILE.W, PILE.H], { label: n > 1 ? `${PILE.LABEL} ${laid + 1}` : PILE.LABEL, pile: true, weight: 0 })) laid++;
  }
  F.assaultStores = true;
  return F.stores.length;
}

// ---------- the units phase: the contents ----------
/**
 * Fills the containers laid in the map phase with their goods (makeStores, the battle's rng) and makes each one a loot
 * container of the battle (kind "store"). Sets b.stores and b.assaultStores (what was in them, for the end).
 * @param {any} state @param {any} b @param {any} F @param {any} rng
 */
export function stockAssaultStores(state, b, F, rng) {
  if (!F || !F.assaultStores || !F.stores || !F.stores.length) return null;
  // What a defender on this map carries is on them (arsenal.js armFromArsenal: the issue, its extras).
  const carried = new Set(b.arsUsed || []);
  for (const u of b.units) if (u.side === "enemy") for (const it of [u.arsItem, ...(u.arsArmour || [])]) if (it) carried.add(it);
  const G = assaultGoods(state, b.setup, carried);
  if (!G) return null;
  const S = makeStores(state, G.view, F, rng);
  if (!S) return null;
  fieldReady(b, state); // ground.js: your people's carried finds (u.haul) and the loot layer
  const L = fieldLayer(b);
  const sup = {}, items = [];
  for (const c of S.containers) {
    const gear = c.gear.map((g) => G.view.armory[g.ai]).filter(Boolean);
    c.id = b.nextId++;
    c.kind = "store";
    c.f = 0;
    c.contents = { sup: c.sup, gear };
    c.gear = gear; // the same list: the card (storeContents) reads names off it
    c.searched = false; c.partial = true;
    if (c.pile) c.haulRate = STEAL.PILE; // quicker to haul off a pile (raidloot.js HAUL)
    for (const [k, n] of Object.entries(c.sup)) sup[k] = (sup[k] || 0) + n;
    items.push(...gear);
    L.containers.push(c);
  }
  b.stores = S;
  b.assaultStores = { fid: G.f.id, tile: G.tile, sup, items, done: false };
  return S;
}

// ---------- forcing a lock ----------
/**
 * combatAct "forceStore" { unit, store? }: one of yours next to a locked container of theirs batters its lock (basemap.js
 * forceLock: a blow with what they hold, a pry tool twice as hard), the rest of the turn. Returns "" or why not.
 * @param {any} state @param {any} b @param {any} u @param {any} act
 */
export function forceStoreAct(state, b, u, act) {
  if (!b.assaultStores || !b.stores) return "Nothing locked here to force.";
  if (b.phase === "deploy") return "Start the assault first.";
  if (!u || u.side !== "player" || u.kind !== "human" || !active(u)) return "Pick one of your people.";
  const boxes = b.stores.containers.filter((c) => lockedBox(c) && nearRect(c, u.x, u.y) && (c.f || 0) === (u.f || 0));
  const box = act.store != null ? boxes.find((c) => c.id === Number(act.store)) : boxes[0];
  if (!box) return "Stand next to one of their locked containers to force it.";
  if ((u.ap || 0) < 1) return "No actions left this turn.";
  forceLock(b, u, box);
  u.ap = 0; u.hunker = false; u.ow = false;
  u.face = [Math.sign(box.x - u.x), Math.sign(box.y - u.y)];
  return "";
}
// The locked containers of theirs a unit can force now (the store card's button).
export const forceTargets = (b, u) => (b && b.assaultStores && b.stores && u ? b.stores.containers.filter((c) => lockedBox(c) && nearRect(c, u.x, u.y)) : []);

// ---------- the end of the fight ----------
// Does this one of yours come home with what they carry (ground.js groundEnd's rule)?
const comesHome = (state, u) => { const s = survivorById(state, u.sid); return !!(s && s.alive && !u.dead && !u.lostBehind && !u.nlTaken); };
const words = (sup, gear) => [...Object.entries(sup).filter(([, n]) => n >= 1).map(([k, n]) => `${Math.floor(n)} ${keyWord(k)}`), ...gear.map((it) => it.name)];
const list = (parts) => (parts.length > 4 ? `${parts.slice(0, 4).join(", ")} and more` : parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "");
/**
 * combat.js endBattle, before ground.js groundEnd: what you took from their stores leaves them; what stays with them is
 * taken out of your people's hands (and off their ground) first. Returns lines for the battle's summary.
 * @param {any} state @param {any} b @param {string} outcome
 */
export function assaultStoresEnd(state, b, outcome) {
  const A = b && b.assaultStores;
  if (!A || A.done) return [];
  A.done = true;
  const f = factionById(state, A.fid);
  const h = f ? homeAt(state, f, A.tile) : null;
  const L = lootLayer(b);
  // What left their containers.
  const left = {}, kept = new Set();
  for (const c of (b.stores && b.stores.containers) || []) {
    if (!c.contents) continue;
    for (const [k, n] of Object.entries(c.contents.sup)) left[k] = (left[k] || 0) + Math.max(0, n);
    for (const it of c.contents.gear) kept.add(it);
  }
  const gone = {};
  for (const [k, n] of Object.entries(A.sup)) { const g = Math.max(0, Math.floor(n - (left[k] || 0))); if (g > 0) gone[k] = g; }
  const goneItems = new Set(A.items.filter((it) => !kept.has(it)));
  // What stays with them: out of the hands of those who do not come home (all of yours on a defeat), off their ground
  // unless you won. It never left their stock; it is not "found" any more.
  const back = { sup: {}, gear: [] };
  const giveBack = (sup, gear) => {
    for (const k of Object.keys(sup)) {
      const n = Math.min(Math.floor(sup[k] || 0), gone[k] || 0);
      if (n <= 0) continue;
      sup[k] -= n; gone[k] -= n; back.sup[k] = (back.sup[k] || 0) + n;
      if (L && L.found[k]) { L.found[k] = Math.max(0, L.found[k] - n); if (!L.found[k]) delete L.found[k]; }
    }
    for (let i = gear.length - 1; i >= 0; i--) {
      const it = gear[i];
      if (!goneItems.has(it)) continue;
      gear.splice(i, 1); goneItems.delete(it); back.gear.push(it);
      if (L) { const j = L.foundGear.indexOf(it); if (j >= 0) L.foundGear.splice(j, 1); }
    }
  };
  for (const u of b.units) if (u.side === "player" && u.haul && (outcome === "defeat" || !comesHome(state, u))) giveBack(u.haul.sup, u.haul.gear);
  if (outcome !== "victory" && L) for (const c of L.containers) if (c.kind === "ground" && c.contents) giveBack(c.contents.sup, c.contents.gear);
  // The rest is gone from that base: its stock by key, their kit off the books, an armory item out of its list.
  const took = { sup: {}, gear: [] };
  for (const [k, n] of Object.entries(gone)) {
    if (!(n > 0)) continue;
    const q = h ? takeStock(h, k, n) : 0;
    if (q > 0) took.sup[k] = q;
  }
  for (const it of goneItems) {
    if (f && f.arsenal && f.arsenal.items.includes(it)) removeFromArsenal(f, it, "taken");
    else if (h && Array.isArray(h.armory) && h.armory.includes(it)) h.armory.splice(h.armory.indexOf(it), 1);
    took.gear.push(it);
  }
  A.took = { sup: took.sup, gear: took.gear.map((it) => it.name) };
  A.back = { sup: back.sup, gear: back.gear.map((it) => it.name) };
  const lines = [];
  const t = words(took.sup, took.gear), r = words(back.sup, back.gear);
  const who = f ? f.name : "them";
  if (t.length) lines.push(`Taken from ${who}'s stores: ${list(t)}.`);
  if (r.length) lines.push(`Left with ${who}: ${list(r)} that your people had taken from their stores.`);
  return lines;
}
