// Lockable boxes and cases (data-boxes.js): what is inside one, its lock and the tools that open it, opening it and
// taking things out of it. The gun cases (riflecase, pistolcase) are boxes too: gunsafes.js rollGunCase makes them here.
//
// - Inside: item.contents (items) and item.sup (supplies: rounds), rolled when the box is found (rollBoxContents, on the
//   finder's hashed dice). Nobody knows what is in a box until it is opened (item.opened): the inventory shows only its
//   weight, the box's own plus all it holds (inventory.js itemLoad counts both), so the weight tells a full box from an
//   empty one, and a heavy gun case most likely holds a gun.
// - The lock (data-boxes.js BOX_LOCKS): a box found locked (item.locked) opens to the right tool only, carried by the
//   one who opens it or lying in the same storage (the armory, the team's cargo): lockpicks or a blade or a pry bar or
//   a power tool for a cheap lock, a pry bar or a power tool for a steel one. Out of a fight it is free and silent;
//   in a raid it takes actions and Heat (locks.js openCaseAct). Forcing breaks the lock (item.forced): the box stays
//   an open box.
// - The window (ui/boxview.js): an opened box lists what it holds; Take moves one thing out (an item onto the one who
//   holds the box when it fits, else into the storage where it is; rounds into the stores or the cargo), Take all
//   everything. Nothing here uses the world's random numbers.
import { GEAR, SUPPLIES, supWeight } from "./data.js";
import { BOX_LOCKS, BOX_HOLDS, BOX_FINDS } from "./data-boxes.js";
import { lootItem, itemAt, parseLoc, placeOfLoc, storageFor, carriedSpots, stow } from "./inventory.js";
import { survivorById, baseById } from "./world.js";
import { hash01 } from "./skills.js";
import { countOf, amountOf } from "./itemstack.js"; // makeshift picks: a stack
import { itemKeyOf, foundItems, stowItems } from "./supitems.js"; // a box carried: its rounds and supplies onto the one carrying it (2026-10-20)
import { siteSource, areaSource } from "./itemcond.js";
import { WEAPONS } from "./combat.js"; // a blade: a melee weapon that cuts or stabs (call-time only)
import { rollGunStash, caseSource } from "./gunsafes.js"; // a gun case's gun (call-time only: gunsafes.js calls back here)
export { BOX_LOCKS, BOX_HOLDS, BOX_FINDS };

export const isBox = (item) => !!(item && GEAR[item.key] && GEAR[item.key].box);
export const boxSpec = (item) => (isBox(item) ? GEAR[item.key].box : null);
// Not opened yet: what it holds is unknown.
export const isSealed = (item) => isBox(item) && !item.opened;
// Something in it (items or supplies).
export const boxHolds = (item) => !!(item && ((item.contents && item.contents.some(Boolean)) || Object.values(item.sup || {}).some((v) => v > 0)));
// A box's own weight, empty (its description and tooltip say it).
export const boxEmptyKg = (item) => (GEAR[item.key] ? GEAR[item.key].weight : 0);
// The weight of the supplies in a box (the items count through itemLoad's contents).
export const boxSupKg = (item) => Object.entries((item && item.sup) || {}).reduce((a, [k, v]) => a + (v > 0 ? supWeight(k) * v : 0), 0);

// ---------- what is inside ----------
const pickW = (w, u, real = true) => {
  const keys = Object.keys(w).filter((k) => !real || GEAR[k] || SUPPLIES[k]);
  let tot = 0;
  for (const k of keys) tot += w[k];
  let r = u * tot;
  for (const k of keys) { r -= w[k]; if (r < 0) return k; }
  return keys[keys.length - 1] || null;
};
const between = (lo, hi, u) => lo + Math.floor(u * (hi - lo + 1));
// The round a gun takes, plain (its calibre's FMJ, else the first round of it).
const roundFor = (gun) => {
  const cal = WEAPONS[gun] && WEAPONS[gun].cal;
  if (!cal) return null;
  if (SUPPLIES[`a_${cal}_fmj`]) return `a_${cal}_fmj`;
  return Object.keys(SUPPLIES).find((k) => k.startsWith(`a_${cal}_`)) || null;
};
// Fills a box: { contents, sup, what } on roll(...k) (a hash01 closure: its own dice). kind: the box's key; siteType:
// where it was found (a gun case's gun and the condition of what is in it go by it).
export function rollBoxContents(roll, kind, siteType, source = null) {
  const spec = GEAR[kind] && GEAR[kind].box;
  const T = spec && BOX_HOLDS[spec.holds];
  const out = { contents: [], sup: {}, what: "empty" };
  if (!T) return out;
  const what = pickW(T.kinds, roll("what"), false);
  out.what = what;
  const src = source || caseSource(siteType);
  if (what === "gun") {
    const s = rollGunStash(roll, GEAR[kind].gunCase ? kind : "pistolcase", siteType); // gunsafes.js: the gun, its magazines, a little ammo
    out.contents = s.gear;
    out.sup = s.sup;
  } else if (what === "rounds" && T.ammo) {
    const k = pickW(T.ammo, roll("ammo"));
    const [lo, hi] = T.rounds || [20, 50];
    if (k) out.sup[k] = between(lo, hi, roll("n"));
    if (roll("ammo2") < 0.3) { const k2 = pickW(T.ammo, roll("ammo2k")); if (k2) out.sup[k2] = (out.sup[k2] || 0) + between(lo, hi, roll("n2")); }
  } else if (what === "items" && T.items) {
    const [lo, hi] = T.n || [1, 1];
    const n = between(lo, hi, roll("items"));
    for (let i = 0; i < n; i++) { const k = pickW(T.items, roll("item", i)); if (k && GEAR[k]) out.contents.push(lootItem(k, src, roll("itemq", i))); }
  } else if (what === "pistol" && T.pistols) {
    const g = pickW(T.pistols, roll("pistol"));
    if (g && GEAR[g]) {
      out.contents.push(lootItem(g, src, roll("pistolq")));
      const r = roundFor(g);
      if (r) out.sup[r] = between(6, 30, roll("pistoln"));
    }
    if (T.items && roll("pistolplus") < 0.5) { const k = pickW(T.items, roll("pistolitem")); if (k && GEAR[k]) out.contents.push(lootItem(k, src, roll("pistolitemq"))); }
  }
  return out;
}
// A box with what it holds, found at siteType. roll: a hash01 closure. source: the condition's source (itemcond.js;
// default: the box's place, a home's).
export function makeBox(kind, roll, siteType, source = null) {
  const src = source || caseSource(siteType);
  const item = lootItem(kind, src, roll("case"));
  const c = rollBoxContents(roll, kind, siteType, src);
  item.contents = c.contents;
  item.sup = c.sup;
  const spec = GEAR[kind].box;
  if (spec && roll("locked") < spec.locked) item.locked = true;
  return item;
}

// ---------- the lock and the tools ----------
const isPicks = (it) => (it.key === "crowbar" && !(Number.isFinite(it.dur) && it.dur <= 0)) || (it.key === "makeshiftpick" && countOf(it) >= 1);
const isPry = (it) => !!(GEAR[it.key] && (GEAR[it.key].pry || it.key === "crowbar"));
const isPower = (it) => it.key === "powerdrill" || it.key === "anglegrinder";
const BLADE_CLASS = ["blade", "pierce", "chop"];
const isBlade = (it) => { const w = WEAPONS[it.key]; return !!(w && w.melee && BLADE_CLASS.includes(w.mclass)) || ["knife", "machete", "sawmachete", "pipespear"].includes(it.key); };
const TOOL_OF = { picks: isPicks, blade: isBlade, pry: isPry, power: isPower };
export const TOOL_WORDS = { picks: "lockpicks", blade: "a blade", pry: "a pry bar", power: "a power drill or an angle grinder" };
// The tool that opens this box among the items given (the opener's things, the storage's), the lock's order first:
// { kind, item } or null. An unlocked box needs none: { kind: null, item: null }.
export function boxTool(box, items) {
  const spec = boxSpec(box);
  if (!spec || !box.locked) return { kind: null, item: null };
  const L = BOX_LOCKS[spec.lock] || BOX_LOCKS.cheap;
  for (const kind of L.tools) { const it = items.find((x) => x && TOOL_OF[kind](x)); if (it) return { kind, item: it }; }
  return null;
}
export const lockWords = (box) => { const L = BOX_LOCKS[(boxSpec(box) || {}).lock] || BOX_LOCKS.cheap; return `${L.name}: ${L.tools.map((t) => TOOL_WORDS[t]).join(", ")}`; };
// What opening it takes in a fight: actions and Heat by the tool.
export function boxCost(box, tool) {
  const L = BOX_LOCKS[(boxSpec(box) || {}).lock] || BOX_LOCKS.cheap;
  if (!box.locked) return { ap: 1, heat: 0 };
  return { ap: L.ap, heat: (tool && L.heat[tool.kind]) ?? 1 };
}
// Opens it (the lock forced or picked when locked). The contents stay in it: the window shows them.
export function openBox(box, tool = null) {
  if (box.locked) { box.locked = false; box.forced = tool ? tool.kind : "force"; }
  box.opened = true;
  return box;
}
// What a box holds, in words ("Hunting rifle (85%), 12 .308 SP"); "unknown" while sealed.
export function boxText(box, force = false) {
  if (!isBox(box)) return "";
  if (isSealed(box) && !force) return "unknown until it is opened";
  const bits = (box.contents || []).filter(Boolean).map((c) => `${c.name}${c.quality != null && c.quality < 1 ? ` (${Math.round(c.quality * 100)}%)` : ""}`);
  for (const [k, v] of Object.entries(box.sup || {})) if (v > 0) bits.push(`${v} ${(SUPPLIES[k] && SUPPLIES[k].name) || k}`);
  return bits.length ? bits.join(", ") : "empty";
}

// ---------- out of a fight: open it from the inventory or the storage, take things out ----------
// Who can open the box at loc and with what: the one holding it, the one asked for (sid), anyone at the place, with
// their carried things and the place's storage. { ok, why, box, tool, who, st }.
export function openPlan(state, loc, sid = null) {
  const box = itemAt(state, loc);
  if (!isBox(box)) return { ok: false, why: "That is not a box or a case." };
  if (state.combat && !state.combat.over) return { ok: false, why: "In a raid, open it from the raid panel (it takes actions).", box };
  const place = placeOfLoc(state, loc);
  const st = place ? storageFor(state, place) : null;
  if (!st) return { ok: false, why: "Out of reach.", box };
  const L = parseLoc(loc);
  const people = [];
  const add = (s) => { if (s && s.alive && !people.includes(s)) people.push(s); };
  if (L.o === "s") add(survivorById(state, L.id));
  if (sid != null) add(survivorById(state, sid));
  const [kind, id] = place.split(":");
  for (const s of state.survivors) if (s.alive && s.location && ((kind === "base" && s.location.kind === "base" && s.location.baseId === Number(id)) || (kind === "party" && s.location.kind === "party" && s.location.partyId === Number(id)))) add(s);
  const shelf = (st.list || []).filter((x) => x && x !== box);
  for (const s of people) {
    const t = boxTool(box, [...carriedSpots(s).map((x) => x.item).filter((x) => x !== box), ...shelf]);
    if (t) return { ok: true, why: "", box, tool: t, who: s, st };
  }
  if (!people.length) { const t = boxTool(box, shelf); if (t) return { ok: true, why: "", box, tool: t, who: null, st }; }
  return { ok: false, why: `Locked with ${lockWords(box)}. Nobody here has one.`, box, st };
}
// Opens the box at loc (free and silent out of a fight). Returns { ok, msg }.
export function openBoxAt(state, loc, sid = null) {
  const o = openPlan(state, loc, sid);
  if (!o.ok) return { ok: false, msg: o.why };
  const locked = !!o.box.locked;
  openBox(o.box, o.tool);
  const how = locked ? `${o.who ? `${o.who.name.split(" ")[0]} ` : ""}${o.tool.kind === "picks" ? "picks" : "forces"} the ${o.box.name.toLowerCase()} open with the ${o.tool.item.name.toLowerCase()}` : `The ${o.box.name.toLowerCase()} opens`;
  return { ok: true, msg: `${how}: ${boxHolds(o.box) ? boxText(o.box) : "empty"}.` };
}
// Where what comes out of the box at loc goes: { person (the holder, items first onto them), st (the storage), sup (the
// supplies' map: the base's stores or the cargo) }.
function outlet(state, loc) {
  const place = placeOfLoc(state, loc);
  const st = place ? storageFor(state, place) : null;
  if (!st) return null;
  const L = parseLoc(loc);
  const person = L.o === "s" ? survivorById(state, L.id) : null;
  const sup = st.o === "armory" ? (baseById(state, st.id) || {}).stock : st.party && (st.party.cargo.supplies || (st.party.cargo.supplies = {}));
  return { person, st, sup };
}
// Takes one thing out of the opened box at loc: { i } an item by its index in the box, { sup: key } a supply. Returns the
// message ("" when there was nothing to take).
export function takeFromBox(state, loc, what) {
  const box = itemAt(state, loc);
  if (!isBox(box) || isSealed(box)) return "It is not open.";
  const out = outlet(state, loc);
  if (!out) return "Out of reach.";
  if (what && what.sup) {
    const k = what.sup, v = Math.floor((box.sup || {})[k] || 0);
    if (v <= 0) return "";
    const name = (SUPPLIES[k] && SUPPLIES[k].name) || k;
    // A box someone carries: what has an item form (rounds as boxes, water, meds, a food) goes onto them like the gun
    // beside it (the user's report 2026-10-20: a case's pistol came onto the survivor, its rounds only into the stores),
    // as far as it fits; the rest into the stores.
    let on = 0;
    if (out.person && out.person.alive && itemKeyOf(k)) {
      const items = foundItems(state, k, v);
      const left = stowItems(out.person, items);
      on = v - left.reduce((a, it) => a + amountOf(it), 0);
    }
    if (on < v && !out.sup) { if (on > 0) { box.sup[k] = v - on; return `${out.person.name.split(" ")[0]} takes ${on} ${name}: no room for the rest.`; } return "Nowhere to put it."; }
    if (on < v) out.sup[k] = (out.sup[k] || 0) + (v - on);
    delete box.sup[k];
    if (on >= v) return `${out.person.name.split(" ")[0]} takes ${v} ${name}.`;
    return on > 0 ? `${out.person.name.split(" ")[0]} takes ${on} ${name}; ${v - on} into ${out.st.name}.` : `${v} ${name} into ${out.st.name}.`;
  }
  const i = what ? what.i : -1;
  const it = box.contents && box.contents[i];
  if (!it) return "";
  box.contents.splice(i, 1);
  const on = out.person && out.person.alive ? stow(out.person, it) : "";
  if (on) return `${out.person.name.split(" ")[0]} takes the ${it.name}.`;
  out.st.list.push(it);
  return `The ${it.name} into ${out.st.name}.`;
}
// Everything out of it. Returns the messages joined.
export function takeAllFromBox(state, loc) {
  const box = itemAt(state, loc);
  if (!isBox(box) || isSealed(box)) return "It is not open.";
  const msgs = [];
  for (const k of Object.keys(box.sup || {})) { const m = takeFromBox(state, loc, { sup: k }); if (m) msgs.push(m); }
  while (box.contents && box.contents.length) { const m = takeFromBox(state, loc, { i: 0 }); if (!m) break; msgs.push(m); }
  return msgs.join(" ") || "It is empty.";
}
// A base's armory or a team's cargo (the autopilot, a group's own): every box that holds something and opens to a tool
// there is opened and emptied into it (the gun cases' old rule, gunsafes.js openCasesIn). Returns what came out.
export function openBoxesIn(list, sup) {
  if (!Array.isArray(list) || !sup) return [];
  const got = [];
  for (const it of list.slice()) {
    if (!isBox(it) || !boxHolds(it)) continue;
    const t = boxTool(it, list.filter((x) => x && x !== it));
    if (!t) continue;
    openBox(it, t);
    for (const c of it.contents || []) if (c) { list.push(c); got.push(c.name); }
    for (const [k, v] of Object.entries(it.sup || {})) if (v > 0) { sup[k] = (sup[k] || 0) + v; got.push(`${v} ${k}`); }
    it.contents = [];
    it.sup = {};
  }
  return got;
}

// ---------- where the new boxes turn up (their own dice, after everything else) ----------
// One search hour's roll at a site (loot.js rollAnyModFind, last).
export function rollBoxFind(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? BOX_FINDS.site[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "boxfind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pickW(site.items, hash01(state.seed, "boxpick", tileId, state.hour, salt));
  if (!key) return null;
  const roll = (...k) => hash01(state.seed, "boxin", tileId, state.hour, salt, ...k);
  return makeBox(key, roll, t.loc.type, siteSource(t.loc.type));
}
// One raid container's roll (loot.js rollAreaMod, last).
export function rollAreaBox(state, tileId, areaType, salt = "") {
  const a = BOX_FINDS.area[areaType];
  if (!a || hash01(state.seed, "areabox", tileId, salt) >= a.p) return null;
  const key = pickW(a.items, hash01(state.seed, "areaboxpick", tileId, salt));
  if (!key) return null;
  const t = state.tiles[tileId];
  const site = t && t.loc ? t.loc.type : null;
  const roll = (...k) => hash01(state.seed, "areaboxin", tileId, salt, ...k);
  return makeBox(key, roll, site, areaSource(areaType, site));
}
