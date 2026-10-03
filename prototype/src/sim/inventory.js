// Survivor inventory: RPG-style equipment slots, pockets and a pack, plus bodies to loot after a battle.
// s.gear stays the source of truth for what is worn or held, so combat, medical and crafting keep reading it:
//   weapon = Hands (main weapon), tool = Off hand (a tool in use: med kit, radio, goggles, crowbar),
//   armor = Body, head / arms / legs = more armor (power adds up, see armorPower),
//   backpack = a pack; the pack item's own `contents` array holds more items (slots from GEAR[key].slots).
// s.pockets = POCKETS slots for small items (GEAR[key].small). Items in pockets and packs do nothing until
// equipped, and they do not use the team's carry space (the pack is the limit); items in a team's cargo take
// ITEM_LOAD each. Supplies (food, water, ammo, meds, scrap...) are not kept per person: a team pools them
// (party supplies and cargo), a base keeps them in stock. Bodies hold supply stacks that go straight there.
//
// Locations are short strings so the UI can keep them in data attributes:
//   "s:<survivorId>:<slot>"  "s:<id>:pocket:<i>"  "s:<id>:pack:<i>"   a living survivor
//   "armory:<baseId>:list[:<i>]"  "cargo:<partyId>:list[:<i>]"       storage (a base armory, a team's cargo)
//   "body:<bodyIndex>:<slot>[:<i>]"  "body:<bodyIndex>:sup:<key>"     bodies of the battle that just ended
// Items only move between people, storage and bodies at the same place (one base, or one team).
import { GEAR, SUPPLIES } from "./data.js";
import { survivorById, baseById, day, newId } from "./world.js";
import { partyCapacity, cargoLoad, unitsThatFit } from "./parties.js";

export const POCKETS = 4;
export const ITEM_LOAD = 3;     // carry space one item takes in a team's cargo
export const ARMOR_CAP = 5.5;   // armor power from all worn pieces counts up to this (plate carrier alone is 4)
export const ARMOR_SLOTS = ["head", "armor", "arms", "legs"];
export const EQUIP_SLOTS = ["weapon", "tool", "head", "armor", "arms", "legs", "backpack"];
export const SLOT_NAMES = { weapon: "Hands", tool: "Off hand", head: "Head", armor: "Body", arms: "Arms", legs: "Legs", backpack: "Backpack", pocket: "Pocket", pack: "Pack" };
const INV_VERSION = 1;

// Odd things the dead still carry (a zombie body has one now and then).
const ZOMBIE_FINDS = ["knife", "knife", "bandagekit", "pistol", "padding"];

export function newItem(key, quality = 1) {
  const d = GEAR[key];
  const item = { key, name: d.name, quality };
  if (d.dur) item.dur = d.dur;
  if (d.slots) ensurePack(item);
  return item;
}

// ---------- the model ----------
export const isSmall = (key) => !!(GEAR[key] && GEAR[key].small);
export const packSize = (item) => (item && GEAR[item.key] && GEAR[item.key].slots) || 0;
export const carryOf = (item) => (item && GEAR[item.key] && GEAR[item.key].carry) || 0;
export const itemLoad = (item) => ITEM_LOAD * (1 + (item && item.contents ? item.contents.filter(Boolean).length : 0));

export function ensurePack(item) {
  const n = packSize(item);
  if (!n) return null;
  if (!Array.isArray(item.contents)) item.contents = [];
  while (item.contents.length < n) item.contents.push(null);
  return item.contents;
}
export const packOf = (s) => (s && s.gear && s.gear.backpack ? ensurePack(s.gear.backpack) : null);

// Adds the new slots to a survivor (or a body) made before them and moves old gear to where it belongs now:
// the improvised backpack was a tool, arm guards were body armor, and the old "Football pads and helmet"
// becomes pads (body) plus a helmet (head). Safe to call any number of times.
export function ensureInv(s) {
  if (!s) return s;
  const g = s.gear || (s.gear = {});
  for (const k of EQUIP_SLOTS) if (g[k] === undefined) g[k] = null;
  if (!Array.isArray(s.pockets)) s.pockets = [];
  while (s.pockets.length < POCKETS) s.pockets.push(null);
  if (g.backpack) ensurePack(g.backpack);
  if (s.invV === INV_VERSION) return s;
  s.invV = INV_VERSION;
  for (const k of EQUIP_SLOTS) {
    const it = g[k];
    if (!it || it.key !== "sportspads" || it.name !== "Football pads and helmet") continue;
    it.name = GEAR.sportspads.name;
    if (it.dur != null) it.dur = Math.min(it.dur, GEAR.sportspads.dur);
    if (!g.head) { g.head = newItem("footballhelmet", it.quality || 1); if (it.dur != null) g.head.dur = Math.min(GEAR.footballhelmet.dur, it.dur); }
  }
  for (const k of EQUIP_SLOTS) {
    const it = g[k];
    const want = it && GEAR[it.key] ? GEAR[it.key].slot : null;
    if (!it || !want || want === k) continue;
    if (!g[want]) { g[want] = it; g[k] = null; }
    else if (isSmall(it.key) && s.pockets.indexOf(null) >= 0) { s.pockets[s.pockets.indexOf(null)] = it; g[k] = null; }
    // Otherwise it stays where it was: it still works there.
  }
  if (g.backpack) ensurePack(g.backpack);
  return s;
}

// Armor from everything worn (body, head, arms, legs), capped. Damage taken is multiplied by armorMult.
export function armorPower(s) {
  const g = s && s.gear;
  if (!g) return 0;
  let p = 0;
  for (const k of ARMOR_SLOTS) if (g[k] && GEAR[g[k].key]) p += GEAR[g[k].key].power;
  return Math.min(ARMOR_CAP, p);
}
export const armorMult = (s) => 1 - armorPower(s) * 0.06;

// Extra carry space a person brings to a team: the pack (and an old-style backpack still in the tool slot).
export function carryBonus(s) {
  const g = s && s.gear;
  if (!g) return 0;
  return carryOf(g.backpack) + (g.tool && GEAR[g.tool.key] && GEAR[g.tool.key].slot === "backpack" ? carryOf(g.tool) : 0);
}

// The armor key the sprite draws on the body: body armor, else arm guards.
export function spriteArmorKey(s) {
  const g = s && s.gear;
  if (!g) return null;
  return (g.armor && g.armor.key) || (g.arms && g.arms.key) || null;
}

// Every item a person has on them (worn, held, pockets; a pack counts as one item with its contents inside).
export function allItems(s) {
  ensureInv(s);
  return [...EQUIP_SLOTS.map((k) => s.gear[k]), ...s.pockets].filter(Boolean);
}
// Takes everything off a person (captured, for example) and returns it.
export function stripAll(s) {
  const items = allItems(s);
  for (const k of EQUIP_SLOTS) s.gear[k] = null;
  s.pockets = s.pockets.map(() => null);
  return items;
}

// Puts an item in the first place it fits on a person: its own slot if empty, else a pocket, else the pack.
// Returns the location string, or "" when nothing is free.
export function stow(s, item, prefix = `s:${s.id}`) {
  ensureInv(s);
  const slot = GEAR[item.key].slot;
  if (!s.gear[slot]) { s.gear[slot] = item; return `${prefix}:${slot}`; }
  if (isSmall(item.key)) {
    const i = s.pockets.indexOf(null);
    if (i >= 0) { s.pockets[i] = item; return `${prefix}:pocket:${i}`; }
  }
  const pk = packOf(s);
  if (pk && !packSize(item)) {
    const i = pk.indexOf(null);
    if (i >= 0) { pk[i] = item; return `${prefix}:pack:${i}`; }
  }
  return "";
}

// Why an item cannot go in a slot ("" when it can).
export function fitReason(item, slot) {
  const d = GEAR[item.key];
  if (!d) return "Unknown item.";
  if (slot === "pocket") return d.small ? "" : `The ${item.name} is too big for a pocket.`;
  if (slot === "pack") return packSize(item) ? "A pack does not fit inside a pack." : "";
  if (EQUIP_SLOTS.includes(slot)) return d.slot === slot ? "" : `The ${item.name} goes in ${SLOT_NAMES[d.slot]}, not ${SLOT_NAMES[slot]}.`;
  return "";
}

// ---------- locations ----------
export function parseLoc(str) {
  const [o, id, slot, i] = String(str).split(":");
  return { o, id: Number(id), slot: slot || "list", i: i == null || i === "" ? null : slot === "sup" ? i : Number(i) };
}

// Bodies of the battle that just ended (only while its result screen is open).
export const battleBodies = (state) => (state.combat && state.combat.over && state.combat.bodies) || [];

// Who holds the items at a location: a living survivor, or a body (an enemy, or a fallen survivor's remains).
function holderAt(state, loc) {
  if (loc.o === "s") {
    const s = survivorById(state, loc.id);
    return s && s.alive ? ensureInv(s) : null;
  }
  if (loc.o === "body") {
    const body = battleBodies(state)[loc.id];
    if (!body) return null;
    return ensureInv(body.sid != null ? survivorById(state, body.sid) : body);
  }
  return null;
}

// "base:<id>" or "party:<id>" for a location; items only move within one place.
export function personPlace(s) {
  if (!s || !s.alive || !s.location) return null;
  if (s.location.kind === "base") return `base:${s.location.baseId}`;
  if (s.location.kind === "party") return `party:${s.location.partyId}`;
  return null; // captive, on a trade route: nobody can reach their things
}
export function battlePlace(b) {
  if (!b || !b.setup) return null;
  return b.setup.partyId ? `party:${b.setup.partyId}` : b.setup.baseId ? `base:${b.setup.baseId}` : null;
}
function placeOf(state, loc) {
  if (loc.o === "s") return personPlace(survivorById(state, loc.id));
  if (loc.o === "armory") return `base:${loc.id}`;
  if (loc.o === "cargo") return `party:${loc.id}`;
  if (loc.o === "body") return battlePlace(state.combat);
  return null;
}

// Where loose items go at a place: the base armory or the team's cargo. { o, id, list, name } or null.
export function storageFor(state, place) {
  if (!place) return null;
  const [kind, idStr] = place.split(":");
  const id = Number(idStr);
  if (kind === "base") {
    const b = baseById(state, id);
    return b ? { o: "armory", id, list: b.armory, name: `${b.name}'s armory` } : null;
  }
  const p = state.parties.find((x) => x.id === id);
  if (!p) return null;
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  return { o: "cargo", id, list: p.cargo.gear, name: "the team's cargo", party: p, state };
}

// A handle on one location: get / set / remove (and put for storage lists).
function ref(state, loc) {
  if (loc.o === "armory" || loc.o === "cargo") {
    const st = storageFor(state, `${loc.o === "armory" ? "base" : "party"}:${loc.id}`);
    if (!st) return null;
    const list = st.list;
    return { list, st, get: () => (loc.i != null ? list[loc.i] || null : null), remove: (it) => { const i = list.indexOf(it); if (i >= 0) list.splice(i, 1); }, put: (it) => list.push(it) };
  }
  const h = holderAt(state, loc);
  if (!h) return null;
  let arr, key;
  if (loc.slot === "pocket" || loc.slot === "pack") {
    arr = loc.slot === "pocket" ? h.pockets : packOf(h);
    key = loc.i;
    if (!arr || key == null || key < 0 || key >= arr.length) return null;
  } else if (EQUIP_SLOTS.includes(loc.slot)) {
    arr = h.gear;
    key = loc.slot;
  } else return null;
  return { h, get: () => arr[key] || null, set: (it) => (arr[key] = it), remove: () => (arr[key] = null) };
}

export function itemAt(state, str) {
  const r = ref(state, parseLoc(str));
  return r ? r.get() : null;
}

// Room in a team's cargo for an item coming in (freed = load leaving at the same time, lost = carry space lost).
function roomCheck(st, item, freed = 0, lost = 0) {
  if (!st || st.o !== "cargo") return "";
  const p = st.party;
  const cap = partyCapacity(st.state, p) - lost;
  const load = cargoLoad(p.cargo) - freed;
  return load + itemLoad(item) <= cap + 1e-9 ? "" : `No room in the team's cargo for the ${item.name} (load ${Math.round(load)} of ${cap}).`;
}

// Something left a body: it counts as battle loot, and a fallen survivor's things leave their death site too.
function taken(state, loc, item) {
  if (loc.o !== "body") return;
  const b = state.combat;
  if (b && b.result) b.result.loot.gear.push(item);
  const body = battleBodies(state)[loc.id];
  if (body && body.sid != null) unlistFromSites(state, item);
}
function unlistFromSites(state, item) {
  for (const site of [...state.deathSites]) {
    const i = site.items.findIndex((e) => e.item === item);
    if (i < 0) continue;
    site.items.splice(i, 1);
    if (!site.items.length) state.deathSites.splice(state.deathSites.indexOf(site), 1);
  }
}

// Moves an item from one location to another. A full target swaps: the item already there goes back where
// the moved one came from if it fits there, else into storage. Returns a message ("" when nothing happened).
export function moveItem(state, fromStr, toStr) {
  if (fromStr === toStr) return "";
  const from = parseLoc(fromStr), to = parseLoc(toStr);
  const A = ref(state, from), B = ref(state, to);
  if (!A || !B) return "That slot is not there any more.";
  const place = placeOf(state, from);
  if (!place || place !== placeOf(state, to)) return "Items only move between people at the same base or on the same team.";
  if (to.o === "body") return "Bodies are only for taking from.";
  const item = A.get();
  if (!item) return "Nothing there.";
  const store = storageFor(state, place);
  const lostFrom = from.slot === "backpack" ? carryOf(item) : 0;

  if (B.list) {
    if (A.list) return "";
    const err = roomCheck(store, item, 0, lostFrom);
    if (err) return err;
    A.remove(item);
    B.put(item);
    taken(state, from, item);
    return `${item.name} → ${store.name}.`;
  }
  const why = fitReason(item, to.slot);
  if (why) return why;
  if (to.slot === "pack" && from.o === to.o && from.id === to.id && from.slot === "backpack") return "A pack does not fit inside itself.";
  const cur = B.get();
  if (cur && !A.list && from.o !== "body" && !fitReason(cur, from.slot)) {
    // Straight swap between two slots.
    A.set(cur);
    B.set(item);
    return `Swapped the ${item.name} and the ${cur.name}.`;
  }
  if (cur) {
    if (!store) return "No room for the item already there.";
    const lost = to.slot === "backpack" ? carryOf(cur) - carryOf(item) : 0;
    const err = roomCheck(store, cur, A.list ? itemLoad(item) : 0, lost + lostFrom);
    if (err) return err;
    A.remove(item);
    B.set(item);
    store.list.push(cur);
    taken(state, from, item);
    return `${item.name} in ${SLOT_NAMES[to.slot]}; the ${cur.name} went to ${store.name}.`;
  }
  A.remove(item);
  B.set(item);
  taken(state, from, item);
  return `${item.name} → ${SLOT_NAMES[to.slot]}.`;
}

// Quick move (click an item twice): storage or a body → onto this person; on a person → into storage.
export function quickMove(state, fromStr, sid) {
  const from = parseLoc(fromStr);
  const item = itemAt(state, fromStr);
  if (!item) return "Nothing there.";
  const s = survivorById(state, sid);
  if (from.o === "s" && from.id === sid || !s) return toStorage(state, fromStr);
  ensureInv(s);
  const slot = GEAR[item.key].slot;
  const tries = [`s:${sid}:${slot}`];
  if (isSmall(item.key)) s.pockets.forEach((x, i) => { if (!x) tries.push(`s:${sid}:pocket:${i}`); });
  const pk = packOf(s);
  if (pk && !packSize(item)) pk.forEach((x, i) => { if (!x) tries.push(`s:${sid}:pack:${i}`); });
  // An empty spot first; else swap into the item's own slot.
  const empty = tries.find((t) => !itemAt(state, t));
  return moveItem(state, fromStr, empty || tries[0]);
}

// Unequip / put away: into the base armory or the team's cargo.
export function toStorage(state, fromStr) {
  const from = parseLoc(fromStr);
  const st = storageFor(state, placeOf(state, from));
  if (!st) return "There is nowhere to put it here.";
  return moveItem(state, fromStr, `${st.o}:${st.id}:list`);
}

// ---------- bodies ----------
// A body after a battle: { name, kind: "human" | "zombie" | "ally", uid (battle unit), kit, sid (fallen survivor),
// gear, pockets, supplies }. A fallen survivor's body is the survivor's own inventory (their things are also
// listed at the death site, see world.killSurvivor); an enemy body has its own.
export function enemyBody(rng, u, kit) {
  const body = ensureInv({ name: u.name, kind: u.kind, uid: u.id, kit: u.kit || null, supplies: {} });
  const add = (k, n) => { if (n > 0) body.supplies[k] = (body.supplies[k] || 0) + n; };
  if (u.kind === "zombie") {
    if (rng.chance(0.12)) add("ammo", rng.int(2, 6));
    if (rng.chance(0.05)) add("meds", 1);
    if (rng.chance(0.06)) stow(body, newItem(rng.pick(ZOMBIE_FINDS), rng.pick([0.5, 0.7, 0.85])), "");
    return body;
  }
  add("ammo", rng.int(3, 10));
  if (rng.chance(0.25)) add("food", rng.int(1, 3));
  if (rng.chance(0.15)) add("meds", 1);
  if (rng.chance(0.3)) add("scrap", rng.int(1, 2));
  // What they fought with, worse for wear.
  if (GEAR[u.weapon]) body.gear.weapon = newItem(u.weapon, rng.pick([0.4, 0.55, 0.7, 0.85]));
  if (u.armorKey && GEAR[u.armorKey]) body.gear.armor = newItem(u.armorKey, rng.pick([0.4, 0.55, 0.7]));
  if (kit && kit.pack && rng.chance(kit.pack[1])) body.gear.backpack = newItem(kit.pack[0], rng.pick([0.7, 0.85]));
  if (kit && rng.chance(0.12)) stow(body, newItem(rng.pick(kit.loot), rng.pick([0.7, 0.85, 1])), "");
  return body;
}
export const allyBody = (s, u) => ({ name: s.name, kind: "ally", uid: u ? u.id : null, sid: s.id, supplies: {} });

// The inventory of a body (an enemy body itself, or the fallen survivor).
export const bodyHolder = (state, body) => ensureInv(body.sid != null ? survivorById(state, body.sid) : body);
export function bodyEmpty(state, body) {
  const h = bodyHolder(state, body);
  return !h || (!allItems(h).length && !Object.values(body.supplies).some((v) => v > 0));
}

// Takes a supply stack from a body: into the team's cargo (as much as fits) or the base stock.
export function takeSupply(state, bi, key) {
  const b = state.combat;
  const body = battleBodies(state)[bi];
  const qty = body ? Math.floor(body.supplies[key] || 0) : 0;
  if (!qty) return "";
  const st = storageFor(state, battlePlace(b));
  if (!st) return "";
  let n = qty;
  if (st.o === "cargo") {
    const p = st.party;
    n = Math.min(qty, unitsThatFit(partyCapacity(state, p) - cargoLoad(p.cargo), key));
    if (n > 0) p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) + n;
  } else {
    const base = baseById(state, st.id);
    base.stock[key] = (base.stock[key] || 0) + n;
  }
  if (n <= 0) return `No room in the team's cargo for ${SUPPLIES[key].name.toLowerCase()}.`;
  body.supplies[key] -= n;
  if (body.supplies[key] <= 0) delete body.supplies[key];
  if (b.result) b.result.loot.supplies[key] = (b.result.loot.supplies[key] || 0) + n;
  return `Took ${n} ${SUPPLIES[key].name.toLowerCase()}${n < qty ? ` (${qty - n} did not fit)` : ""}.`;
}

// Takes everything that fits from one body: supplies first, then items, most valuable first.
// Returns { got: [names], left: count of things that did not fit }.
export function takeAllBody(state, bi) {
  const body = battleBodies(state)[bi];
  const out = { got: [], left: 0 };
  if (!body) return out;
  for (const key of Object.keys(body.supplies)) {
    const before = Math.floor(body.supplies[key] || 0);
    takeSupply(state, bi, key);
    const after = Math.floor(body.supplies[key] || 0);
    if (before > after) out.got.push(`${before - after} ${SUPPLIES[key].name.toLowerCase()}`);
    if (after > 0) out.left++;
  }
  const h = bodyHolder(state, body);
  if (!h) return out;
  const locs = [...EQUIP_SLOTS.map((k) => `body:${bi}:${k}`), ...h.pockets.map((_, i) => `body:${bi}:pocket:${i}`)]
    .filter((l) => itemAt(state, l))
    .sort((x, y) => worth(itemAt(state, y)) - worth(itemAt(state, x)));
  const st = storageFor(state, battlePlace(state.combat));
  for (const l of locs) {
    const item = itemAt(state, l);
    const msg = st ? moveItem(state, l, `${st.o}:${st.id}:list`) : "";
    if (itemAt(state, l) === item) out.left++;
    else out.got.push(item.name);
    void msg;
  }
  return out;
}
const worth = (item) => GEAR[item.key].value * (item.quality || 1) + (item.contents ? item.contents.filter(Boolean).reduce((a, c) => a + worth(c), 0) : 0);

// Every body at once (headless battles do this as soon as they end; the "Take all" button too).
export function takeAllBodies(state) {
  const out = { got: [], left: 0 };
  battleBodies(state).forEach((_, i) => {
    const r = takeAllBody(state, i);
    out.got.push(...r.got);
    out.left += r.left;
  });
  return out;
}

// Closing the battle: whatever is still on enemy bodies stays where they fell (a death site on that tile,
// stripped by scavengers over the days like any other; a recovery mission can fetch it). A fallen survivor's
// things are at their death site already.
export function leaveBodies(state, b) {
  const items = [];
  for (const body of b.bodies || []) {
    if (body.sid != null) continue;
    for (const [k, v] of Object.entries(body.supplies)) if (v >= 1) items.push({ kind: "supply", key: k, name: SUPPLIES[k].name, qty: Math.floor(v), value: Math.floor(v) * SUPPLIES[k].value });
    for (const it of allItems(body)) items.push({ kind: "gear", key: it.key, name: it.name, qty: 1, value: Math.round(worth(it)), item: it });
    body.supplies = {};
    stripAll(body);
  }
  b.bodies = [];
  if (!items.length || b.tileId == null) return 0;
  const who = `${b.setup.enemy.name || b.setup.enemy.kind}'s dead`;
  let site = state.deathSites.find((d) => d.tile === b.tileId);
  if (site) {
    site.items.push(...items);
    if (!site.names.includes(who)) site.names.push(who);
  } else state.deathSites.push({ id: newId(), tile: b.tileId, items, day: day(state), names: [who], lastConfirmed: day(state) });
  return items.length;
}
