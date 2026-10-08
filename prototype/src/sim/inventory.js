// @ts-check
// Survivor inventory: RPG-style equipment slots, pockets and a pack, plus bodies to loot after a battle.
// s.gear stays the source of truth for what is worn or held, so combat, medical and crafting keep reading it:
//   weapon = Hands (main weapon), tool = Off hand (a tool in use: med kit, radio, goggles, crowbar),
//   armor = Body, head / arms / legs = more armor (power adds up, see armorPower),
//   backpack = a pack; the pack item's own `contents` array holds more items (slots from GEAR[key].slots).
// s.pockets = POCKETS slots for small items (GEAR[key].small). Items in pockets and packs do nothing until
// equipped. Everything has a weight (data.js GEAR weight, kg): what a person wears, holds and keeps in pockets and pack is
// part of their load, and the team's cargo and supplies are shared out among them (load.js). Pockets and pack
// slots only say where a thing is kept; weight is the limit. Bulky things (a bicycle) only go in storage.
// Supplies (food, water, ammo, meds, scrap...) are not kept per person: a team pools them
// (party supplies and cargo), a base keeps them in stock. Bodies hold supply stacks that go straight there.
//
// Locations are short strings so the UI can keep them in data attributes:
//   "s:<survivorId>:<slot>"  "s:<id>:pocket:<i>"  "s:<id>:pack:<i>"   a living survivor
//   "armory:<baseId>:list[:<i>]"  "cargo:<partyId>:list[:<i>]"       storage (a base armory, a team's cargo)
//   "body:<bodyIndex>:<slot>[:<i>]"  "body:<bodyIndex>:sup:<key>"     bodies of the battle that just ended
// Items only move between people, storage and bodies at the same place (one base, or one team).
import { fitMod, removeMod, modFitReason, isGunmod, takesMods } from "./gunmods.js";
import { GEAR, SUPPLIES } from "./data.js";
import { survivorById, baseById, day, newId } from "./world.js";
import { partyCapacity, poolLoad, cargoRoom, unitsThatFit } from "./parties.js";
import { bodyLoot } from "./deadsoldiers.js";
import { condition, kitSource, spend } from "./itemcond.js"; // the condition loot comes in (one roller for every source)
import { MEDS } from "./medfinds.js"; // how rare meds are
import { burnOf, burnShare } from "./woodcutting.js"; // the firewood an item makes (call-time only: safe in the import cycle)

export const POCKETS = 4;
export const ARMOR_CAP = 5.5;   // armor power from all worn pieces counts up to this (plate carrier alone is 4)
export const ARMOR_SLOTS = ["head", "armor", "arms", "legs"];
export const EQUIP_SLOTS = ["weapon", "tool", "head", "armor", "arms", "legs", "backpack"];
export const SLOT_NAMES = { weapon: "Hands", tool: "Off hand", head: "Head", armor: "Body", arms: "Arms", legs: "Legs", backpack: "Backpack", pocket: "Pocket", pack: "Pack", cargo: "Cargo" };
const INV_VERSION = 1;

// Odd things the dead still carry in their pockets (a zombie body has one now and then).
export const ZOMBIE_FINDS = ["knife", "knife", "bandagekit", "pistol", "padding", "phone", "phone", "photos", "goldring", "watch", "smokes", "lighters", "candy", "batteries", "baton"];
// Some of the dead still wear a bag (ZOMBIE_PACK of them): a sling bag or a school backpack with a few things inside.
export const ZOMBIE_PACK = 0.08;
export const ZOMBIE_PACKS = ["slingbag", "slingbag", "backpack"];
export const ZOMBIE_PACK_STUFF = ["chocolate", "candy", "phone", "photos", "novel", "magazines", "batteries", "lighters", "toiletpaper", "bandagekit", "knife", "flashlight", "smokes", "instcoffee", "cards", "soap"];

// worn: found or starting gear comes part-worn, FOUND_DUR / START_DUR of its uses left (data.js GEAR dur). Pass the
// rng in hand (its position is hashed with the item, so the roll moves none of the world's random numbers) or a
// number 0–1 from a hash of its own. Counts (tablets, toiletries, count stacks such as boxes of rounds) and items
// that do not wear stay full.
// Loot and trade stock no longer use FOUND_DUR: they go through lootItem (itemcond.js rollCondition, by source).
export const FOUND_DUR = { lo: 0.3, hi: 1 };   // a bare newItem with a roll: from nearly done to as good as new
export const START_DUR = { lo: 0.55, hi: 1 };  // what people start the game (or join) with: looked after
export function newItem(key, quality = 1, worn = null, range = FOUND_DUR) {
  const d = GEAR[key];
  const item = { key, name: d.name, quality };
  if (d.dur) item.dur = d.dur;
  if (worn != null && d.dur && !d.tabs && !d.groom && !d.count) {
    const u = typeof worn === "number" ? worn : mix01(worn.state, key, quality);
    item.dur = Math.max(1, Math.round(d.dur * (range.lo + (range.hi - range.lo) * u)));
  }
  if (d.slots) ensurePack(item);
  return item;
}
// A piece of loot or trade stock: the kind from its source's list (the caller's), the condition from the source
// (itemcond.js COND_SOURCES: "military", "shop", "raider", "merchant"...). roll: an Rng (its position is hashed, no
// draw), a number 0–1 or a list of parts. opts.quality: a quality fixed by the caller (only the wear is rolled).
export const lootItem = (key, source, roll, opts) => condition(newItem(key, 1), source, roll, opts);
// The armoured dead's kit (deadsoldiers.js bodyLoot's maker): their table's quality, the wear by itemcond.js "armoured".
export const armouredItem = (key, quality, rng) => lootItem(key, "armoured", rng, { quality });
// 0–1 from an rng's position and the item (FNV-1a and a final mix): no draw from the rng itself.
function mix01(...parts) {
  let h = 2166136261 >>> 0;
  for (const c of parts.join("|")) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---------- the model ----------
export const isSmall = (key) => !!(GEAR[key] && GEAR[key].small);
export const packSize = (item) => (item && GEAR[item.key] && GEAR[item.key].slots) || 0;
export const carryOf = (item) => (item && GEAR[item.key] && GEAR[item.key].carry) || 0;
export const isBulky = (key) => !!(GEAR[key] && GEAR[key].bulky);
// What an item weighs (kg): its own weight, and a pack also what is inside it.
// A count stack (GEAR count: true, item.dur = how many are left: a box of rounds) weighs its share left.
export const itemKg = (item) => {
  const d = item && GEAR[item.key];
  if (!d || !Number.isFinite(d.weight)) return 1;
  return d.count && d.dur && Number.isFinite(item.dur) ? d.weight * Math.max(0, item.dur) / d.dur : d.weight;
};
// A gun also weighs its fitted attachments (gunmods.js: item.mods).
export const itemLoad = (item) => itemKg(item) + (item && item.contents ? item.contents.filter(Boolean).reduce((a, c) => a + itemLoad(c), 0) : 0) + modsKg(item);
const modsKg = (item) => (item && item.mods ? Object.values(item.mods).reduce((a, m) => a + (m ? itemKg(m) : 0), 0) : 0);

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

// Armor one piece gives: its listed power scaled by condition (item.quality). A piece at 100% gives it all,
// at 60% it gives 80%, at 40% 70%: worn-out armor still protects, just less.
export const itemArmor = (item) => (item && GEAR[item.key] ? GEAR[item.key].power * (0.5 + 0.5 * Math.max(0, Math.min(1, item.quality ?? 1))) : 0);

// Armor from everything worn (body, head, arms, legs), capped. Damage taken is multiplied by armorMult.
export function armorPower(s) {
  const g = s && s.gear;
  if (!g) return 0;
  let p = 0;
  for (const k of ARMOR_SLOTS) p += itemArmor(g[k]);
  return Math.min(ARMOR_CAP, p);
}
export const armorMult = (s) => 1 - armorPower(s) * 0.06;

// Kg a person's pack adds to their max load (load.js maxLoad), and an old-style backpack still in the tool slot.
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
  if (EQUIP_SLOTS.includes(slot) && !s.gear[slot]) { s.gear[slot] = item; return `${prefix}:${slot}`; } // books (slot "pack") are never worn
  if (isSmall(item.key)) {
    const i = s.pockets.indexOf(null);
    if (i >= 0) { s.pockets[i] = item; return `${prefix}:pocket:${i}`; }
  }
  const pk = packOf(s);
  if (pk && !packSize(item) && !isBulky(item.key)) {
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
  if (slot === "pack") return packSize(item) ? "A pack does not fit inside a pack." : d.bulky ? `The ${item.name} is too big for a pack: it goes in the cargo.` : "";
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
// Takes the item at a location away for good (a treat used up, comforts.js). Returns it, or null.
export function removeAt(state, str) {
  const r = ref(state, parseLoc(str));
  const it = r ? r.get() : null;
  if (it) r.remove(it);
  return it;
}
export const placeOfLoc = (state, loc) => placeOf(state, typeof loc === "string" ? parseLoc(loc) : loc);

// ---------- gun attachments (gunmods.js) ----------
// Who and what storage can reach a gun at a location: { holder (a survivor or null), st (storageFor or null) }. A body's
// gun is out of reach (take it first). sid: the person whose inventory is open (a gun in storage, their pockets).
function modReach(state, gunStr, sid = null) {
  const loc = parseLoc(gunStr);
  if (loc.o === "body") return null;
  const place = placeOf(state, loc);
  const holder = loc.o === "s" ? survivorById(state, loc.id) : sid != null ? survivorById(state, sid) : null;
  const near = holder && place && personPlace(holder) === place ? holder : null;
  return { holder: loc.o === "s" ? holder : near, st: place ? storageFor(state, place) : null };
}
// Loose attachments within reach that fit the gun at gunStr: the holder's pockets and pack, then the storage at the
// place. [{ loc, item }].
export function modChoices(state, gunStr, sid = null) {
  const gun = itemAt(state, gunStr);
  const r = gun && takesMods(gun.key) ? modReach(state, gunStr, sid) : null;
  if (!r) return [];
  const out = [];
  const fits = (it) => it && isGunmod(it.key) && !modFitReason(gun, it);
  if (r.holder) {
    const pre = `s:${r.holder.id}`;
    ensureInv(r.holder);
    r.holder.pockets.forEach((it, i) => { if (fits(it)) out.push({ loc: `${pre}:pocket:${i}`, item: it }); });
    (packOf(r.holder) || []).forEach((it, i) => { if (fits(it)) out.push({ loc: `${pre}:pack:${i}`, item: it }); });
  }
  if (r.st) r.st.list.forEach((it, i) => { if (fits(it)) out.push({ loc: `${r.st.o}:${r.st.id}:list:${i}`, item: it }); });
  return out;
}
// Fits the loose attachment at modStr to the gun at gunStr. What was on that mount goes where the new one came from.
// Returns a message.
export function fitModAt(state, gunStr, modStr) {
  const gun = itemAt(state, gunStr), mod = itemAt(state, modStr);
  if (!gun || !mod) return "Nothing to fit.";
  if (gun === mod) return "That is the gun.";
  const why = modFitReason(gun, mod);
  if (why) return why;
  if (!modReach(state, gunStr) || parseLoc(modStr).o === "body") return "Take them off the body first.";
  if (placeOf(state, parseLoc(gunStr)) !== placeOf(state, parseLoc(modStr))) return "The gun and the attachment are not in the same place.";
  const r = ref(state, parseLoc(modStr));
  if (!r) return "Nothing to fit.";
  r.remove(mod);
  const res = fitMod(gun, mod);
  if (res.old) { if (r.put) r.put(res.old); else r.set(res.old); }
  return `${mod.name} fitted to the ${gun.name}${res.old ? ` (the ${res.old.name} came off)` : ""}.`;
}
// Takes the attachment off a gun's mount: into the armory or the team's cargo where there is one, else onto the
// holder (pocket or pack). Returns a message.
export function unfitModAt(state, gunStr, mount, sid = null) {
  const gun = itemAt(state, gunStr);
  if (!gun || !gun.mods || !gun.mods[mount]) return "Nothing fitted there.";
  const r = modReach(state, gunStr, sid);
  if (!r) return "Take the gun off the body first.";
  const mod = gun.mods[mount];
  if (r.st) { removeMod(gun, mount); r.st.list.push(mod); return `${mod.name} taken off the ${gun.name}: into ${r.st.name}.`; }
  if (r.holder) {
    removeMod(gun, mount);
    if (stow(r.holder, mod)) return `${mod.name} taken off the ${gun.name}: ${r.holder.name.split(" ")[0]} carries it.`;
    fitMod(gun, mod);
  }
  return `No room for the ${mod.name}: free a pocket or a pack slot first.`;
}

// ---------- breaking things down for firewood (data.js GEAR burnShare; woodcutting.js burnOf: by its weight) ----------
// What breaking down the item at a location would give: { ok, reason, item, wood, place }. Items in a base's armory, a
// team's cargo, or a pocket or pack of someone at a base or on a team (not what is worn or held: take it off first;
// not a body's).
export function breakDownInfo(state, str) {
  const loc = parseLoc(str);
  const item = itemAt(state, str);
  const wood = burnOf(item); // woodcutting.js: floor(weight × burnShare / 0.1 kg)
  const place = placeOf(state, loc);
  let reason = "";
  if (!item) reason = "Nothing there.";
  else if (!(wood > 0)) reason = burnShare(item.key) > 0 ? `Too little of the ${item.name} burns to make firewood.` : `The ${item.name} will not burn.`;
  else if (loc.o === "body") reason = "Take it first.";
  else if (loc.o === "s" && EQUIP_SLOTS.includes(loc.slot)) reason = "Take it off first.";
  else if (!place) reason = "Out of reach.";
  return { ok: !reason, reason, item, wood, place };
}
// Breaks it down: the item is gone and its firewood goes into the base's stores or the team's cargo supplies (a team's
// camp fire burns it like any firewood carried). No time: it is kindling. Returns the message.
export function breakDownAt(state, str) {
  const info = breakDownInfo(state, str);
  if (!info.ok) return info.reason;
  const [kind, idStr] = info.place.split(":");
  const id = Number(idStr);
  let where;
  if (kind === "base") {
    const b = baseById(state, id);
    if (!b) return "Out of reach.";
    b.stock.wood = Math.max(0, b.stock.wood || 0) + info.wood;
    where = `${b.name}'s firewood`;
  } else {
    const p = state.parties.find((x) => x.id === id);
    if (!p) return "Out of reach.";
    p.cargo = p.cargo || { supplies: {}, gear: [] };
    p.cargo.supplies.wood = Math.max(0, p.cargo.supplies.wood || 0) + info.wood;
    where = "the team's firewood";
  }
  removeAt(state, str);
  unlistFromSites(state, info.item);
  return `Broke down the ${info.item.name} for firewood: +${info.wood} to ${where}.`;
}
// Marks an armory item for the water boiler (worm.js): "burn" (it may burn it even if it is not junk), "keep" (never),
// or null (junk burns while the base allows it). Returns the message.
export function setFireMark(state, str, mark) {
  const loc = parseLoc(str);
  const item = itemAt(state, str);
  if (!item || loc.o !== "armory") return "";
  if (mark === "burn" || mark === "keep") item.fire = mark; else delete item.fire;
  return item.fire === "burn" ? `The water boiler may burn the ${item.name} when the firewood runs short.` : item.fire === "keep" ? `The ${item.name} is kept from the fire.` : `The ${item.name}: no mark (junk burns while the base allows it).`;
}

// Can a team take on `gained` kg (an item from a body) while losing `lost` kg of max load (a pack taken off)?
// Moving things between its people and its cargo weighs nothing extra: the team's load is one pool (load.js).
function roomCheck(st, item, gained = 0, lost = 0) {
  if (!st || st.o !== "cargo" || (gained <= 0 && lost <= 0)) return "";
  const p = st.party;
  const cap = partyCapacity(st.state, p) - lost;
  const load = poolLoad(p);
  return load + gained <= cap + 1e-9 ? "" : `Too heavy: the team cannot carry the ${item.name} as well (${item ? `${Math.round(itemLoad(item) * 10) / 10} kg; ` : ""}load ${Math.round(load)} of ${Math.round(cap)} kg).`;
}

// Something left a body: it counts as battle loot, and a fallen survivor's things leave their death site too.
function taken(state, loc, item) {
  if (loc.o !== "body") return;
  const b = state.combat;
  if (b && b.result) b.result.loot.gear.push(item);
  const body = battleBodies(state)[loc.id];
  if (body && body.sid != null) unlistFromSites(state, item);
}
// (A site whose body got up and walked off, carriers.js, stays on the map with nothing on it: site.walked.)
export function unlistFromSites(state, item) {
  for (const site of [...state.deathSites]) {
    const i = site.items.findIndex((e) => e.item === item);
    if (i < 0) continue;
    site.items.splice(i, 1);
    if (!site.items.length && !(site.walked && site.walked.length)) state.deathSites.splice(state.deathSites.indexOf(site), 1);
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
  // Taken from a body, it adds to what the team carries; between people and cargo it weighs the same.
  const gained = from.o === "body" ? itemLoad(item) : 0;

  if (B.list) {
    if (A.list) return "";
    const err = roomCheck(store, item, gained, lostFrom);
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
  if (gained || lostFrom) {
    // Onto a person from a body (the team gets heavier), or a worn pack moved (its wearer's max load drops).
    const gain = to.slot === "backpack" ? (cur ? carryOf(cur) : 0) - carryOf(item) : 0;
    const err = roomCheck(store, item, gained, lostFrom + gain);
    if (err) return err;
  }
  if (cur && !A.list && from.o !== "body" && !fitReason(cur, from.slot)) {
    // Straight swap between two slots.
    A.set(cur);
    B.set(item);
    return `Swapped the ${item.name} and the ${cur.name}.`;
  }
  if (cur) {
    if (!store) return "No room for the item already there.";
    const lost = to.slot === "backpack" ? carryOf(cur) - carryOf(item) : 0;
    const err = roomCheck(store, cur, 0, lost + lostFrom);
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
  const tries = EQUIP_SLOTS.includes(slot) ? [`s:${sid}:${slot}`] : []; // books (slot "pack") go in the pack
  if (isSmall(item.key)) s.pockets.forEach((x, i) => { if (!x) tries.push(`s:${sid}:pocket:${i}`); });
  const pk = packOf(s);
  if (pk && !packSize(item) && !isBulky(item.key)) pk.forEach((x, i) => { if (!x) tries.push(`s:${sid}:pack:${i}`); });
  if (isBulky(item.key) && !tries.length) return from.o === "body" || from.o === "s" ? toStorage(state, fromStr) : `The ${item.name} only goes in storage.`;
  // An empty spot first; else swap into the item's own slot.
  const empty = tries.find((t) => !itemAt(state, t));
  if (!tries.length) return `No pack slot for the ${item.name}: ${s.name.split(" ")[0]} needs a pack with room.`;
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
    // A dead soldier or riot cop (deadsoldiers.js): worn armour, a helmet, rounds, now and then more.
    const mil = u.ztype ? bodyLoot(rng, u.ztype, armouredItem) : null;
    if (mil) {
      for (const [k, n] of Object.entries(mil.sup)) add(k, n);
      for (const it of mil.gear) stow(body, it, ""); // (a second rifle with nowhere to go stays on the ground)
      return body;
    }
    if (rng.chance(0.12)) add("ammo", rng.int(2, 6));
    if (rng.chance(0.05)) add("meds", 1);
    if (rng.chance(0.06)) stow(body, lootItem(rng.pick(ZOMBIE_FINDS), "survivor", spend(rng)), "");
    if (rng.chance(ZOMBIE_PACK)) {
      const pack = lootItem(rng.pick(ZOMBIE_PACKS), "survivor", spend(rng));
      const n = rng.int(1, Math.min(3, pack.contents.length));
      for (let i = 0; i < n; i++) pack.contents[i] = lootItem(rng.pick(ZOMBIE_PACK_STUFF), "survivor", spend(rng));
      body.gear.backpack = pack;
    }
    return body;
  }
  add("ammo", rng.int(3, 10));
  if (rng.chance(0.25)) add("food", rng.int(1, 3));
  if (rng.chance(MEDS.BODY_HUMAN)) add("meds", 1); // medfinds.js
  if (rng.chance(0.3)) add("scrap", rng.int(1, 2));
  // What they fought with, worse for wear: how worse goes by who they were (itemcond.js KIT_SOURCE).
  const src = u.kit ? kitSource(u.kit) : kit ? "raider" : "survivor"; // no kit named: the callers arm them as raiders
  // A group's people (arsenal.js armFromArsenal) carry their group's own items: the very gun, parts and wear.
  if (u.arsItem && u.arsItem.key === u.weapon) { spend(rng); body.gear.weapon = u.arsItem; }
  else if (GEAR[u.weapon]) body.gear.weapon = lootItem(u.weapon, src, spend(rng));
  if (body.gear.weapon) carryMods(u, body.gear.weapon); // gunmods.js: the attachments on their gun come with it
  const worn = (u.arsArmour || []).find((it) => it.key === u.armorKey);
  if (worn) { spend(rng); body.gear.armor = worn; }
  else if (u.armorKey && GEAR[u.armorKey]) body.gear.armor = lootItem(u.armorKey, src, spend(rng));
  for (const it of u.arsArmour || []) if (it !== worn && GEAR[it.key] && !body.gear[GEAR[it.key].slot]) body.gear[GEAR[it.key].slot] = it; // a helmet, arm or leg guards
  if (kit && kit.pack && rng.chance(kit.pack[1])) body.gear.backpack = lootItem(kit.pack[0], src, spend(rng));
  if (kit && rng.chance(0.12)) stow(body, lootItem(rng.pick(kit.loot), src, spend(rng)), "");
  if (kit && kit.finds && rng.chance(0.2)) stow(body, lootItem(rng.pick(kit.finds), src, rng), ""); // pockets: smokes, a ring (combat.js KITS finds)
  for (const it of carriedThrowables(u, src)) stow(body, it, ""); // a flashbang or a smoke grenade they never threw
  return body;
}
// What a soldier or a guard carried into the fight and never threw (combat.js enemyUnit u.throwables: throwables.js
// FLASH_KIT): on the body, through itemcond.js like any loot (its own dice: no draw).
export const BODY_THROWABLES = ["flashbang", "smokegren"];
export function carriedThrowables(u, src) {
  const out = [];
  if (!u || !u.throwables) return out;
  for (const k of BODY_THROWABLES) for (let i = 0; i < (u.throwables[k] || 0); i++) out.push(lootItem(k, src, [u.id, k, i]));
  return out;
}
// The attachments a battle unit's gun carried (combat.js enemyUnit: u.modItems, for the gun it was given) onto the gun
// item looted from it. Only while the unit still holds that gun (u.gmWeapon), and each part only where it fits.
export function carryMods(u, gun) {
  if (!u || !u.modItems || u.gmWeapon !== gun.key) return;
  for (const m of Object.values(u.modItems)) if (m) fitMod(gun, m);
  u.modItems = null; // looted once
}
// One of the dead searched where it fell in a raid (combat.js searchBox): what the person had on them, kept modest
// (bodies are a bonus; the buildings are the loot). A dead soldier or riot cop: their kit (deadsoldiers.js).
// { sup, gear }. ZBODY: chances of each kind of find.
export const ZBODY = {
  ammo: [0.08, 2, 6], food: [0.12, 1, 1], meds: [0.05, 1, 1], scrap: [0.06, 1, 1],
  find: 0.3, FINDS: ["phone", "phone", "lighters", "smokes", "candy", "chocolate", "goldring", "watch", "photos", "batteries", "bandagekit", "knife", "cigarettes", "cards", "deodorant", "lipbalm"],
  pistol: 0.02, bag: 0.03,
};
export function deadBodyFinds(rng, ztype) {
  const mil = ztype ? bodyLoot(rng, ztype, armouredItem) : null;
  if (mil) return mil;
  const sup = {}, gear = [];
  for (const k of ["ammo", "food", "meds", "scrap"]) { const [p, lo, hi] = ZBODY[k]; if (rng.chance(p)) sup[k] = rng.int(lo, hi); }
  if (rng.chance(ZBODY.find)) { const k = rng.pick(ZBODY.FINDS); if (GEAR[k]) gear.push(lootItem(k, "survivor", GEAR[k].makeshift ? rng : spend(rng))); }
  if (rng.chance(ZBODY.pistol)) { gear.push(lootItem("pistol", "survivor", spend(rng))); sup.ammo = (sup.ammo || 0) + rng.int(3, 8); }
  if (rng.chance(ZBODY.bag)) gear.push(lootItem(rng.pick(ZOMBIE_PACKS), "survivor", spend(rng)));
  return { sup, gear };
}
export const allyBody = (s, u) => ({ name: s.name, kind: "ally", uid: u ? u.id : null, sid: s.id, supplies: {} });

// The inventory of a body (an enemy body itself, or the fallen survivor).
export const bodyHolder = (state, body) => ensureInv(body.sid != null ? survivorById(state, body.sid) : body);
export function bodyEmpty(state, body) {
  const h = bodyHolder(state, body);
  return !h || (!allItems(h).length && !Object.values(body.supplies).some((v) => v > 0));
}

// Takes a supply stack from a body: into the team's cargo (as much as fits) or the base stock.
// want: at most that many of the stack (1 to all; the loot screen's 1 / half buttons).
export function takeSupply(state, bi, key, want = Infinity) {
  const b = state.combat;
  const body = battleBodies(state)[bi];
  const qty = body ? Math.floor(body.supplies[key] || 0) : 0;
  if (!qty) return "";
  const st = storageFor(state, battlePlace(b));
  if (!st) return "";
  let n = Math.min(qty, Number.isFinite(want) ? Math.max(1, Math.floor(want)) : qty);
  const asked = n;
  if (st.o === "cargo") {
    const p = st.party;
    n = Math.min(asked, unitsThatFit(cargoRoom(state, p), key));
    if (n > 0) p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) + n;
  } else {
    const base = baseById(state, st.id);
    base.stock[key] = (base.stock[key] || 0) + n;
  }
  if (n <= 0) return `No room in the team's cargo for ${SUPPLIES[key].name.toLowerCase()}.`;
  body.supplies[key] -= n;
  if (body.supplies[key] <= 0) delete body.supplies[key];
  if (b.result) b.result.loot.supplies[key] = (b.result.loot.supplies[key] || 0) + n;
  return `Took ${n} ${SUPPLIES[key].name.toLowerCase()}${n < asked ? ` (${asked - n} did not fit)` : n < qty ? ` (${qty - n} left)` : ""}.`;
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
const worth = (item) => GEAR[item.key].value * (item.quality || 1) + (item.contents ? item.contents.filter(Boolean).reduce((a, c) => a + worth(c), 0) : 0) + (item.mods ? Object.values(item.mods).reduce((a, m) => a + (m && GEAR[m.key] ? worth(m) : 0), 0) : 0); // a gun's attachments (gunmods.js) too

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
  // The site's name on the map: "The dead" for zombies, "Red Hand raiders' dead" for people.
  const en = b.setup.enemy || {};
  const label = String(en.name || en.kind || "strangers");
  const who = en.kind === "zombies" || /^(the )?(dead|zombies)$/i.test(label) ? "The dead" : `${label}${/s$/i.test(label) ? "'" : "'s"} dead`;
  let site = state.deathSites.find((d) => d.tile === b.tileId);
  if (site) {
    site.items.push(...items);
    if (!site.names.includes(who)) site.names.push(who);
  } else state.deathSites.push({ id: newId(), tile: b.tileId, items, day: day(state), names: [who], lastConfirmed: day(state) });
  return items.length;
}
