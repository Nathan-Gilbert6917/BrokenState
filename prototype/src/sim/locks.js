// Locks, keys and locked rooms in raids (suggestions-2 #8). Some raid containers are locked (lockbox, locker, drug
// cabinet, evidence locker, sealed crate, gun cage, safe, cargo case) and some buildings have a locked room: every
// door of the building is a locked door cell that blocks movement and sight until it is opened. Locked things hold
// better loot: supplies ×1.5 (×1.3 in a locked room), extras by kind, blueprints four times as often (twice in a
// locked room) and keys.
//
// Opening (combat.js combatAct "open", next to it, odds in the raid panel):
//   key     a key for this site on your key ring (state.keys): sure, 1 action, silent.
//   pick    lockpicks (the "Crowbar and lockpicks" item on the unit): 55% + 4% a Stealth point − 15% a difficulty step
//           above 1 (+10% Quiet Hands), 5–95%; 1 action an attempt, Heat +1, the picks lose 1 use; Stealth XP 6 on a
//           success, 2 on a miss. A safe can only be picked or keyed.
//   force   with the crowbar (or a pry weapon: a crowbar, fire axe or sledgehammer, barOf): 85% + 1.5% a
//           Mechanics point − 20% a step, 1 action, loud: Heat +6 and it wakes
//           everything within 8 tiles. Without one (kick, smash): 50% − 20% a step, both actions, Heat +10, wakes
//           everything within 11; only difficulty 1–2.
// Keys are named for a site ("Dunmore Police Station key") and open every lock there. They turn up on human bodies
// (12%), in containers (3%), locked ones (by kind, up to 30%) and in hour-by-hour searches; they are for a site
// near where they were found. A key found in a raid joins the hub's key ring when someone gets out; it is never cargo.
// The headless search (scavenge.js searchHour) has the same locks in abstract form (lockedSearchHour).
// Rolls use hash01 (skills.js), never the world's random numbers.
import { keyWord } from "./water.js"; // supplies as words: "9mm FMJ", "rounds"
import { GEAR, LOCATIONS, SUPPLIES } from "./data.js";
import { log, skill, survivorById, day } from "./world.js";
import { hash01, gainXp, hasPerk, anyPerk } from "./skills.js";
import { lootItem, allItems } from "./inventory.js";
import { lockSource } from "./itemcond.js";
const siteTypeAt = (state, tileId) => { const t = state.tiles && state.tiles[tileId]; return t && t.loc ? t.loc.type : null; }; // lockSource: a gun store's cages
import { rollBlueprint, bpOfItem } from "./blueprints.js";
import { BMAP } from "./buildingmaps.js"; // a locked door's strength (call-time only: safe in the import cycle)
import { CELL, nearBox, inBox } from "./combat.js"; // nearBox / inBox: a container may cover several cells (a car)
import { addFindVia } from "./ammo.js"; // rounds by calibre
import { say as sayB, fx as fxB, setFloor } from "./combat.js"; // gun safes: a charge that goes off at the start of a turn (safeTurn)
import { THROWABLES } from "./stealth.js";
import { landEffect } from "./throwables.js";
import { toolSource } from "./gunsafes.js";
import { rollGunStash, TIER_STASH, blastContents, rollAreaGunFinds, CAR_CASE, rollGunCase, SEARCH_TOOLS, isGunCase, openCase, CASE } from "./gunsafes.js";
import { haulOf } from "./raidloot.js";
import { swapGun } from "./gundist.js"; // the gun distribution: which gun a locked container holds
// What rounds a locked thing holds (ammo.js themes), by its loot kind.
const LOCK_AMMO = { guns: "guns", evidence: "police", miltruck: "military", crash: "military", safe: "home", cash: "home", gear: "home", car: "home" };

// diff: 1–4. force: can be forced at all. loot: extras inside (LOCK_LOOT).
export const LOCKS = {
  lockbox:  { name: "Lockbox", diff: 1, force: true, loot: "cash" },
  locker:   { name: "Locked locker", diff: 1, force: true, loot: "gear" },
  drugs:    { name: "Drug cabinet", diff: 2, force: true, loot: "meds" },
  evidence: { name: "Evidence locker", diff: 2, force: true, loot: "evidence" },
  crate:    { name: "Sealed crate", diff: 2, force: true, loot: "cargo" },
  case:     { name: "Locked cargo case", diff: 2, force: true, loot: "crash" },
  cage:     { name: "Gun cage", diff: 3, force: true, loot: "guns" },
  safe:     { name: "Safe", diff: 4, force: false, loot: "safe" },
  door:     { name: "Locked door", diff: 2, force: true },
  vault:    { name: "Steel security door", diff: 3, force: true },
  // A car left locked on the road or a bridge (combat.js AREAS.roadcars / wreck). No site key opens it: pick the door
  // lock, pry it with a crowbar (loud) or shatter the glass (glass: the no-crowbar way, both actions, loudest, SMASH).
  car:      { name: "Locked car", diff: 1, force: true, loot: "car", glass: true, nokey: true },
  // An Army truck's cargo bed, chained and padlocked (combat.js AREAS.miltrucks, miltrucks.js). No site key opens it.
  cargobed: { name: "Padlocked cargo bed", diff: 2, force: true, loot: "miltruck", nokey: true },
};
export const PICK = { base: 0.55, perStealth: 0.04, perDiff: 0.15, quiet: 0.1, heat: 1, xpWin: 6, xpMiss: 2 };
export const FORCE = { base: 0.85, perMech: 0.015, perDiff: 0.2, heat: 6, radius: 8, noise: 2 };
export const SMASH = { base: 0.5, perDiff: 0.2, heat: 10, radius: 11, noise: 3, maxDiff: 2, ap: 2, glassBonus: 0.4 }; // glassBonus: a car window nearly always gives
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Which containers lock, by raid area: [box kinds, lock kind, chance].
const RULES = {
  house: [["cabinet", "locker"], "lockbox", 0.12], farmhouse: [["cabinet", "locker"], "lockbox", 0.1], cabin: [["locker"], "lockbox", 0.15],
  lockers: [["locker"], "locker", 0.3], barracks: [["locker"], "locker", 0.35], garage: [["locker"], "locker", 0.15], workshop: [["locker"], "locker", 0.15],
  pharmacy: [["cabinet"], "drugs", 0.35], clinic: [["cabinet", "locker"], "drugs", 0.3], lab: [["cabinet"], "drugs", 0.25],
  office: [["cabinet"], "safe", 0.08], control: [["cabinet"], "safe", 0.12], cellblock: [["locker", "cabinet"], "evidence", 0.3],
  armory: [["locker", "crate"], "cage", 0.45], gunshop: [["locker", "counter"], "cage", 0.4],
  warehouse: [["crate"], "crate", 0.12], hangar: [["crate", "locker"], "crate", 0.2], motorpool: [["crate", "locker"], "crate", 0.2],
  milwreck: [["crate"], "case", 0.45], medwreck: [["crate"], "case", 0.4], newswreck: [["crate"], "case", 0.35],
  fuselage: [["crate", "locker"], "case", 0.4], cargodrop: [["crate"], "case", 0.25],
  // The cars on the road and in a wreck pile: some were locked when their people left them (or died in them).
  roadcars: [["car"], "car", 0.4], wreck: [["car"], "car", 0.2],
};
// Chance of a locked room at a site (one building with every door locked), by site type.
const ROOM = {
  police: 0.6, pharmacy: 0.5, gunstore: 0.5, military: 0.6, hospital: 0.4, clinic: 0.3, prison: 0.5, warehouse: 0.3, factory: 0.3,
  univ: 0.35, office: 0.3, airport: 0.3, dam: 0.35, autoshop: 0.2, supermarket: 0.2, hardware: 0.25, firestation: 0.25, crash_cargo: 0.5,
};
const VAULT_AREAS = ["armory", "gunshop"];
// Keys are cut for these site types.
export const KEY_SITES = ["police", "pharmacy", "gunstore", "military", "hospital", "clinic", "prison", "warehouse", "factory", "univ", "office", "airport", "dam", "hardware", "supermarket", "firestation", "autoshop"];
const KEY_WORD = { police: "evidence room key", pharmacy: "back room key", gunstore: "gun cage key", military: "arms vault key", hospital: "pharmacy store key", clinic: "drug store key", prison: "cell block keys", warehouse: "loading bay key", factory: "office key", univ: "lab key", office: "manager's key", airport: "hangar key", dam: "control room key", hardware: "stockroom key", supermarket: "stockroom key", firestation: "station key", autoshop: "shop key" };

// ---------- the key ring ----------
export const keyRing = (state) => state.keys || (state.keys = []);
export const hasKey = (state, tile) => keyRing(state).some((k) => k.tile === tile);
export function keyName(state, tile) {
  const t = state.tiles[tile];
  if (!t || !t.loc) return "A key";
  const word = KEY_WORD[t.loc.type] || "key";
  const first = word.split(" ")[0];
  return word !== "key" && new RegExp(` ${first}$`, "i").test(t.loc.name) ? `${t.loc.name} ${word.slice(first.length + 1)}` : `${t.loc.name} ${word}`; // "Auto shop key", not "Auto shop shop key"
}
export function addKey(state, tile, how = "") {
  if (hasKey(state, tile)) return false;
  keyRing(state).push({ tile, name: keyName(state, tile), day: day(state), how });
  log(state, `🔑 ${keyName(state, tile)} is on the key ring now${how ? ` (${how})` : ""}: it opens the locks there.`, "good");
  return true;
}
// A key for a site near `tile` (this one or another lockable site within 25 tiles you have no key for), or null.
export function keyFor(state, tile, salt) {
  const g = state.grid;
  const here = state.tiles[tile];
  const cands = [];
  if (here && here.loc && KEY_SITES.includes(here.loc.type) && !hasKey(state, tile)) cands.push(tile, tile);
  for (const id of g.within(tile, 25)) {
    const t = state.tiles[id];
    if (id === tile || !t.loc || !KEY_SITES.includes(t.loc.type) || hasKey(state, id)) continue;
    cands.push(id);
  }
  if (!cands.length) return null;
  return cands[Math.floor(hash01(state.seed, "keyfor", tile, state.hour, salt) * cands.length) % cands.length];
}

// ---------- tools on a person ----------
function itemsOf(s) {
  if (!s) return [];
  const items = allItems(s);
  const pack = s.gear && s.gear.backpack && s.gear.backpack.contents ? s.gear.backpack.contents.filter(Boolean) : [];
  return [...items, ...pack];
}
export const picksOf = (s) => itemsOf(s).find((it) => it.key === "crowbar" && !(Number.isFinite(it.dur) && it.dur <= 0)) || null;
// Something to force a lock with: the lockpicks' crowbar, or a pry weapon (data.js GEAR pry: a crowbar, a fire axe,
// a sledgehammer) carried anywhere on the person.
export const barOf = (s) => picksOf(s) || itemsOf(s).find((it) => GEAR[it.key] && GEAR[it.key].pry) || null;
// Wears the picks one use; removes them when they are worn out. Returns true if they snapped.
function wearPicks(s, it) {
  if (!Number.isFinite(it.dur)) return false;
  it.dur -= 1;
  if (it.dur > 0) return false;
  for (const k of Object.keys(s.gear || {})) if (s.gear[k] === it) s.gear[k] = null;
  if (s.pockets) s.pockets = s.pockets.map((x) => (x === it ? null : x));
  const pack = s.gear && s.gear.backpack;
  if (pack && pack.contents) pack.contents = pack.contents.map((x) => (x === it ? null : x));
  return true;
}

// ---------- odds ----------
// For a unit (battle unit u with u.sid) and a lock: { key, pick, force } each { ok, chance, why, ap, label }.
export function openOdds(state, b, u, lock) {
  const def = LOCKS[lock.kind] || LOCKS.door;
  const s = survivorById(state, u.sid);
  const site = b.tileId;
  const out = {};
  // A site's key opens every lock at the site; a car on the road has its own keys, long gone (nokey).
  out.key = def.nokey ? { ok: false, chance: 0, ap: 1, label: "Key", why: "Whoever had the keys to this car took them." }
    : hasKey(state, site) ? { ok: true, chance: 1, ap: 1, label: "Key", why: "" } : { ok: false, chance: 0, ap: 1, label: "Key", why: `No key for ${b.place} on the key ring.` };
  const picks = picksOf(s);
  const pc = clamp(PICK.base + PICK.perStealth * (s ? skill(s, "stealth") : 0) - PICK.perDiff * (def.diff - 1) + (u.quiet || (s && hasPerk(s, "quiethands")) ? PICK.quiet : 0), 0.05, 0.95);
  out.pick = picks ? { ok: true, chance: pc, ap: 1, label: "Pick", why: "" } : { ok: false, chance: pc, ap: 1, label: "Pick", why: "Needs lockpicks (the Crowbar and lockpicks item) on this person." };
  if (!def.force) out.force = { ok: false, chance: 0, ap: 1, label: "Force", why: `A ${def.name.toLowerCase()} cannot be forced: pick it or use a key.` };
  else if (barOf(s)) out.force = { ok: true, chance: clamp(FORCE.base + FORCE.perMech * (s ? skill(s, "mechanics") : 0) - FORCE.perDiff * (def.diff - 1), 0.05, 0.95), ap: 1, label: "Force", crowbar: true, why: "" };
  // Without a crowbar: kick it in, or on a car shatter a window and reach in (glass): both actions and the loudest way.
  else if (def.diff <= SMASH.maxDiff) out.force = { ok: u.ap >= SMASH.ap, chance: clamp(SMASH.base - SMASH.perDiff * (def.diff - 1) + (def.glass ? SMASH.glassBonus : 0), 0.05, 0.95), ap: SMASH.ap, label: def.glass ? "Break glass" : "Smash", glass: !!def.glass, why: u.ap >= SMASH.ap ? "" : `${def.glass ? "Breaking the glass" : "Smashing it"} takes both actions.` };
  else out.force = { ok: false, chance: 0, ap: 1, label: "Force", why: "Too solid to smash without a crowbar." };
  if (def.tier) safeOdds(state, b, u, lock, def, s, out); // gun safes: combination, crack, bypass, drill, grind, blow (below)
  return out;
}

// ---------- the raid map (combat.js createRaid → lockRaid) ----------
// Locked containers and a locked room, decided once the map and the units are placed. H: the combat helpers.
export function lockRaid(state, b) {
  const R = b.raid;
  if (!R || R.locksDone) return;
  R.locksDone = true;
  R.doors = R.doors || [];
  R.foundKeys = R.foundKeys || [];
  const t = state.tiles[b.tileId];
  // A point of interest (poicont.js R.poiDice): its kind, and dice keyed by it instead of the hour (the same locks every visit).
  const type = (R.poiDice && b.setup && b.setup.raid && b.setup.raid.kind) || (t && t.loc ? t.loc.type : null);
  const roll = (...k) => hash01(state.seed, "lock", b.tileId, R.poiDice ?? state.hour, ...k);
  placeGunSafes(state, b, type, roll); // gun safes (below): before the other locks, so a safe is not also a cage
  // Crash-site containers are named for what they are.
  for (const c of R.containers) {
    const area = R.areas[c.area];
    if (!area) continue;
    if (["milwreck", "medwreck", "newswreck", "cargodrop", "fuselage"].includes(area.type)) {
      if (c.kind === "car") c.label = `${area.name}: wreckage`;
      else if (c.kind === "crate") c.label = `${area.name}: cargo case`;
    }
    // A building's map (buildingmaps.js) locks some containers by its own dice (a gun cage, a drug cabinet, a safe).
    if (c.lockKind && LOCKS[c.lockKind]) {
      c.lock = { kind: c.lockKind, open: false, tries: 0 };
      c.label = `${c.truck ? c.label.split(":")[0] : area.name}: ${LOCKS[c.lockKind].name.toLowerCase()}`; // an Army truck keeps its name
      continue;
    }
    const rule = RULES[area.type];
    if (!rule || !rule[0].includes(c.kind)) continue;
    let kind = rule[1], p = rule[2];
    if (type === "police" && area.type === "office" && c.kind === "cabinet") { kind = "evidence"; p = 0.3; }
    if (roll("c", c.id) >= p) continue;
    c.lock = { kind, open: false, tries: 0 };
    c.label = `${area.name}: ${LOCKS[kind].name.toLowerCase()}`;
  }
  // A locked room: every door of one building with containers, if that really seals it off.
  // A building's map comes with its locked rooms and exits (R.doors, buildingmaps.js); the street map gets one by chance.
  const pRoom = (type && ROOM[type]) ?? 0.15;
  if (!R.interior && roll("room") < pRoom) {
    const cands = R.areas.filter((a) => !a.outdoor && a.doors && a.doors.length && R.containers.some((c) => c.area === a.id));
    const start = cands.length ? Math.floor(roll("which") * cands.length) % cands.length : 0;
    for (let i = 0; i < cands.length; i++) {
      const a = cands[(start + i) % cands.length];
      if (sealRoom(b, a)) {
        const kind = VAULT_AREAS.includes(a.type) ? "vault" : "door";
        for (const [x, y] of a.doors) R.doors.push({ id: R.doors.length + 1, x, y, area: a.id, lock: { kind, open: false, tries: 0 } });
        for (const c of R.containers) if (c.area === a.id) c.room = true;
        a.locked = true;
        break;
      }
    }
  }
  const nBox = R.containers.filter((c) => c.lock).length;
  const roomIds = [...new Set(R.doors.filter((d) => d.area != null && R.areas[d.area]).map((d) => d.area))];
  const exitDoors = R.doors.filter((d) => d.area == null).length;
  const bits = [];
  if (nBox) bits.push(`${nBox} locked container${nBox === 1 ? "" : "s"}`);
  if (roomIds.length) bits.push(roomIds.length === 1 ? `a locked room (${R.areas[roomIds[0]].name})` : `locked rooms (${roomIds.map((i) => R.areas[i].name).join(", ")})`);
  if (exitDoors) bits.push(`${exitDoors === 1 ? "a locked way out" : `${exitDoors} locked door cells on the ways out`}`);
  if (bits.length) b.log.push({ turn: b.turn, k: "info", text: `${bits.join(" and ")} here. Open them from next to them: key, lockpicks or force.${hasKey(state, b.tileId) ? ` You have the ${keyName(state, b.tileId)}.` : ""}` });
}
// Locks a building's doors if that cuts its containers off from the entry; otherwise leaves the map as it was.
function sealRoom(b, a) {
  const W = b.w, H = b.h;
  const idx = (x, y) => y * W + x;
  const doors = (a.doors || []).filter(([x, y]) => b.cells[idx(x, y)] && ["open", "idoor", "odoor"].includes(b.cells[idx(x, y)].k)); // its doors (combat.js genRaidMap: closed ones)
  if (!doors.length || doors.some(([x, y]) => b.units.some((u) => !u.dead && u.x === x && u.y === y))) return false;
  const old = doors.map(([x, y]) => b.cells[idx(x, y)].k);
  const hp0 = doors.map(([x, y]) => [b.cells[idx(x, y)].hp, b.cells[idx(x, y)].mhp]);
  for (const [x, y] of doors) { const c = b.cells[idx(x, y)]; c.k = "door"; c.hp = c.mhp = BMAP.DOOR.locked; } // locked: as strong as any locked door (BMAP.DOOR)
  // Flood from the entry zone over walkable cells (doors and walls are not).
  const z = b.raid.zones[0];
  const seen = new Uint8Array(W * H);
  const walk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && WALK.has(b.cells[idx(x, y)].k);
  const q = [];
  for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) if (walk(x, y)) { seen[idx(x, y)] = 1; q.push(idx(x, y)); }
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (walk(nx, ny) && !seen[idx(nx, ny)]) { seen[idx(nx, ny)] = 1; q.push(idx(nx, ny)); }
    }
  }
  const inside = b.raid.containers.filter((c) => c.area === a.id);
  const cut = inside.every((c) => ![[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => seen[idx(c.x + dx, c.y + dy)] && walk(c.x + dx, c.y + dy)));
  if (cut) { a.doors = doors; b.losCache.fill(0); return true; }
  doors.forEach(([x, y], i) => { const c = b.cells[idx(x, y)]; c.k = old[i]; c.hp = hp0[i][0]; c.mhp = hp0[i][1]; if (c.hp == null) delete c.hp; if (c.mhp == null) delete c.mhp; });
  return false;
}
// Cell kinds a unit can stand on (combat.js CELL walk: true; read when called, the modules load in a circle).
const WALK = { has: (k) => !!(CELL[k] && CELL[k].walk) };

// ---------- what is locked next to a unit ----------
// Targets: { ref: "c<id>" | "d<id>", x, y, lock, name, box?, door? }.
// Containers and doors carry f (their storey, buildingmaps.js): only the active floor's are next to anyone on it.
const onFloor = (b, o) => (o.f || 0) === (b.floor || 0);
// The locked doors: a raid's (R.doors), or a field map's houses' (combat.js genMap FIELD_DOOR: b.doors, no containers).
export const doorsOf = (b) => (b.raid ? b.raid.doors : b.doors) || [];
const boxesOf = (b) => (b.raid ? b.raid.containers : []);
export function lockedNear(b, u) {
  const near = (o) => (o.f || 0) === (u.f || 0) && Math.max(Math.abs(u.x - o.x), Math.abs(u.y - o.y)) <= 1;
  const out = [];
  for (const c of boxesOf(b)) if (c.lock && !c.lock.open && !c.searched && nearBox(u, c)) out.push({ ref: `c${c.id}`, x: c.x, y: c.y, lock: c.lock, name: LOCKS[c.lock.kind].name, box: c });
  for (const d of doorsOf(b)) if (!d.lock.open && near(d)) out.push({ ref: `d${d.id}`, x: d.x, y: d.y, lock: d.lock, name: LOCKS[d.lock.kind].name, door: d });
  return out;
}
export function lockAt(b, x, y) {
  const d = doorsOf(b).find((q) => q.x === x && q.y === y && onFloor(b, q));
  if (d) return { ref: `d${d.id}`, x, y, lock: d.lock, name: LOCKS[d.lock.kind].name, door: d };
  const c = boxesOf(b).find((q) => inBox(q, x, y) && q.lock && onFloor(b, q));
  return c ? { ref: `c${c.id}`, x, y, lock: c.lock, name: LOCKS[c.lock.kind].name, box: c } : null;
}
const targetOf = (b, ref) => {
  if (typeof ref !== "string") return null;
  const id = Number(ref.slice(1));
  if (ref[0] === "c") { const c = boxesOf(b).find((q) => q.id === id); return c && c.lock ? { ref, x: c.x, y: c.y, lock: c.lock, name: LOCKS[c.lock.kind].name, box: c } : null; }
  const d = doorsOf(b).find((q) => q.id === id);
  return d ? { ref, x: d.x, y: d.y, lock: d.lock, name: LOCKS[d.lock.kind].name, door: d } : null;
};
export const lockedMsg = (box) => `The ${LOCKS[box.lock.kind].name.toLowerCase()} is locked: open it first (key, lockpicks or force).`;

// ---------- opening (combat.js combatAct "open") ----------
// act: { unit, target: "c<id>" | "d<id>", method: "key" | "pick" | "force" }. H: { say, alertNear, fx } from combat.js.
// Returns an error ("" when the action happened, success or not).
export function openLock(state, b, u, act, H) {
  if (typeof act.target === "string" && act.target[0] === "k") return openCaseAct(state, b, u, act, H); // a gun case (below)
  const t = targetOf(b, act.target);
  if (!t || t.lock.open) return "Nothing locked there.";
  if (t.box ? !nearBox(u, t.box) : Math.max(Math.abs(u.x - t.x), Math.abs(u.y - t.y)) > 1) return "Move next to it first."; // a car: next to any of its cells
  const odds = openOdds(state, b, u, t.lock);
  const o = odds[act.method];
  if (!o) return "Unknown way to open it.";
  if (!o.ok) return o.why;
  if (SAFE_METHODS.includes(act.method)) return openSafe(state, b, u, t, o, act, H); // gun safes (below)
  const R = b.raid; // null on a field map (b.doors): no Heat there, the noise still carries
  const heat = (n) => { if (R) R.heat = Math.min(100, R.heat + n); };
  const s = survivorById(state, u.sid);
  const def = LOCKS[t.lock.kind];
  const lower = def.name.toLowerCase();
  t.lock.tries = (t.lock.tries || 0) + 1;
  const roll = act.method === "key" ? 0 : hash01(state.seed, "open", b.tileId, b.turn, t.ref, t.lock.tries, u.id);
  const ok = roll < o.chance;
  u.ap = Math.max(0, u.ap - o.ap);
  if (act.method === "pick") {
    heat(PICK.heat);
    const picks = picksOf(s);
    if (s) gainXp(state, s, "stealth", ok ? PICK.xpWin : PICK.xpMiss);
    if (picks && s && wearPicks(s, picks)) H.say(b, `${u.name}'s lockpicks snap: the crowbar and picks are worn out.`, "danger");
    H.say(b, ok ? `${u.name} picks the ${lower} (${Math.round(o.chance * 100)}%).` : `${u.name} works the pins of the ${lower}, but it holds (${Math.round(o.chance * 100)}%). Try again or force it.`, ok ? "good" : "info");
  } else if (act.method === "force") {
    const smash = !o.crowbar;
    const P = smash ? SMASH : FORCE;
    heat(P.heat);
    b.noise = (b.noise || 0) + P.noise;
    if (o.glass) H.say(b, ok ? `${u.name} shatters the car's window with a crash and reaches in (${Math.round(o.chance * 100)}%).` : `${u.name} hits the car's window; it cracks and holds (${Math.round(o.chance * 100)}%).`, ok ? "good" : "danger");
    else H.say(b, ok ? `${u.name} ${smash ? "smashes" : "forces"} the ${lower} open with a crash (${Math.round(o.chance * 100)}%).` : `${u.name} ${smash ? "kicks at" : "heaves on"} the ${lower}, but it holds (${Math.round(o.chance * 100)}%).`, ok ? "good" : "danger");
    H.alertNear(b, t.x, t.y, P.radius, o.glass ? "Breaking glass carries down the road: the dead nearby turn toward it." : "The noise wakes everything nearby.");
  } else {
    H.say(b, `${u.name} unlocks the ${lower} with the ${keyName(state, b.tileId)}.`, "good");
  }
  if (ok) {
    t.lock.open = true;
    t.lock.how = act.method === "force" && !o.crowbar ? "smash" : act.method;
    if (t.door) {
      // An opened door swings open (odoor; no longer two storeys of sight-blocking, buildingmaps.js): in a building, on
      // the street map (its houses' doors: combat.js genRaidMap) and in a field map's houses.
      const openCell = (dc) => { dc.k = "odoor"; dc.f = "floor"; delete dc.t; };
      const cellsOf = (d) => (b.floors && b.floors[d.f || 0] ? b.floors[d.f || 0].cells : b.cells); // the door's own storey (buildingmaps.js)
      openCell(cellsOf(t.door)[t.y * b.w + t.x]);
      b.losCache.fill(0);
      const area = R && t.door.area != null ? R.areas[t.door.area] : null;
      // Every door of the room opens with the same key; a forced door is just broken.
      if (act.method === "key" && R) for (const d of R.doors) if (d.area === t.door.area && !d.lock.open) { d.lock.open = true; d.lock.how = "key"; openCell(cellsOf(d)[d.y * b.w + d.x]); }
      if (area) H.say(b, `The ${area.name.toLowerCase()} is open.`, "info");
      else H.say(b, R ? "The way out is open." : "The door is open.", "info");
    }
    H.fx(b, { type: "loot", to: [t.x, t.y], text: "unlocked", how: fxHow(act.method, o) });
  } else H.fx(b, { type: "loot", to: [t.x, t.y], text: "locked", how: fxHow(act.method, o) });
  return "";
}
// How it was tried, for the sound of it (ui/sfx-doors.js doorLoot): key, pick, pry (a crowbar), kick (no tool), glass.
const fxHow = (method, o) => (method === "force" ? (o && o.glass ? "glass" : o && o.crowbar ? "pry" : "kick") : method);

// ---------- loot (combat.js searchBox, when a container's contents are rolled) ----------
// Extras by lock kind: [supply, chance, lo, hi] and gear [key, chance].
const LOCK_LOOT = {
  cash:     { sup: [["ammo", 0.6, 6, 15], ["meds", 0.15, 1, 1]], gear: [["pistol", 0.1], ["knife", 0.1]], key: 0.2 },
  gear:     { sup: [["ammo", 0.4, 5, 12]], gear: [["vest", 0.1], ["bikehelmet", 0.1], ["kneeguards", 0.1], ["backpack", 0.1]], key: 0.1 },
  meds:     { sup: [["meds", 0.95, 3, 6]], gear: [["surgkit", 0.1], ["bandagekit", 0.2], ["tourniquet", 0.2]], key: 0.08 },
  evidence: { sup: [["ammo", 0.8, 10, 25]], gear: [["pistol", 0.3], ["shotgun", 0.15], ["lockbook", 0.1], ["riothelmet", 0.1], ["flashbang", 0.2], ["smokegren", 0.15]], key: 0.3 }, // flashbangs, smoke: the SWAT kit (throwables.js FLASH)
  cargo:    { sup: [["food", 0.5, 4, 10], ["parts", 0.5, 1, 3], ["fuel", 0.25, 1, 3]], gear: [["assaultpack", 0.05]], key: 0.05 },
  guns:     { sup: [["ammo", 0.95, 20, 40]], gear: [["pistol", 0.4], ["shotgun", 0.3], ["huntrifle", 0.25], ["ar", 0.1]], key: 0.1 },
  safe:     { sup: [["meds", 0.25, 1, 2], ["ammo", 0.5, 10, 20]], gear: [["nvg", 0.05], ["milradio", 0.05]], key: 0.3 },
  crash:    { sup: [["meds", 0.45, 1, 3], ["ammo", 0.5, 10, 30]], gear: [["ar", 0.1], ["plate", 0.08], ["nvg", 0.06], ["milradio", 0.06], ["assaultpack", 0.08], ["flashbang", 0.08]], key: 0 },
  // A locked car: what its people packed to flee with, still in the back seat and the glovebox.
  miltruck: { sup: [["ammo", 0.5, 10, 25]], gear: [["frag", 0.1], ["smokegren", 0.1], ["flashbang", 0.08]], key: 0 }, // a padlocked Army truck: the good crates went in the back
  car:      { sup: [["fuel", 0.5, 1, 3], ["food", 0.4, 2, 4], ["water", 0.35, 1, 3], ["ammo", 0.2, 4, 10], ["meds", 0.1, 1, 1]], gear: [["pistol", 0.08], ["flashlight", 0.1], ["bottle", 0.1], ["slingbag", 0.05], ["backpack", 0.04], ["binoculars", 0.03], ["revolver", 0.03]], key: 0.05 },
};
const BP_MULT = { lock: 4, room: 2, plain: 0.5 };
const ZBODY_KEY = 0.04; // a key to a nearby place on one of the dead (their own house, a car, a shop)
// sup / gear: what the normal roll put in (changed in place). Returns nothing; keys go to R.foundKeys.
export function lockedLoot(state, b, u, box, sup, gear) {
  const R = b.raid;
  if (!R) return;
  R.foundKeys = R.foundKeys || [];
  const roll = (...k) => hash01(state.seed, "lloot", b.tileId, R.poiDice ?? state.hour, box.id, ...k); // a point of interest's: the same every visit (poicont.js)
  comboNotes(b, u, box); // gun safes: a note with a safe's combination in this container or on this body (below)
  const giveKey = (p, why) => {
    if (roll("key", why) >= p) return;
    const tile = keyFor(state, b.tileId, `${box.id}${why}`);
    if (tile == null || R.foundKeys.includes(tile)) return;
    R.foundKeys.push(tile);
    b.log.push({ turn: b.turn, k: "good", text: `${u.name} finds a key: the ${keyName(state, tile)}. It goes on the key ring when you get out.` });
  };
  if (box.kind === "body") {
    if (box.kit) giveKey(0.12, "body");
    else if (box.zombie) giveKey(ZBODY_KEY, "zbody"); // one of the dead still has their keys (combat.js searchBox)
    return;
  }
  const lk = box.lock ? LOCKS[box.lock.kind] : null;
  if (lk && lk.tier) return gunSafeLoot(state, b, u, box, sup, gear, lk, giveKey); // a gun safe: gunsafes.js rollGunStash, no ×1.5 (below)
  gear.push(...areaGunFinds(state, b, box, lk)); // drills, grinders, gun cases (gunsafes.js GUN_FINDS; their own dice)
  const mult = lk ? 1.5 : box.room ? 1.3 : 1;
  if (mult > 1) for (const k of Object.keys(sup)) sup[k] = Math.max(1, Math.round(sup[k] * mult));
  if (lk) {
    const L = LOCK_LOOT[lk.loot] || LOCK_LOOT.cash;
    L.sup.forEach(([k, p, lo, hi], i) => {
      if ((!SUPPLIES[k] && k !== "food") || roll("s", i) >= p) return; // food: days of it, typed with the box (combat.js typeFind)
      sup[k] = (sup[k] || 0) + lo + Math.floor(roll("q", i) * (hi - lo + 1));
    });
    L.gear.forEach(([k, p], i) => { if (GEAR[k] && roll("g", i) < p) gear.push(lootItem(swapGun(`lock:${lk.loot}`, k, [roll("gs", i)]), lockSource(lk.loot, siteTypeAt(state, b.tileId)), roll("gd", i))); }); // itemcond.js: a gun cage keeps its guns well (a gun store's as the Army's)
    giveKey(L.key, "lock");
  } else giveKey(0.03, "plain");
  const bp = rollBlueprint(state, b.tileId, (lk ? BP_MULT.lock : box.room ? BP_MULT.room : BP_MULT.plain) * (u.scavBonus ? 2 : 1), `box${box.id}`);
  if (bp) gear.push(bp);
}

// When the raid ends (combat.js endRaid): keys found go on the key ring if anyone got out.
export function raidLocksEnd(state, b) {
  const R = b.raid;
  if (!R || !b.result) return;
  const keys = R.foundKeys || [];
  if (!keys.length) return;
  if (b.result.outcome !== "extracted") { b.summary.push(`The key${keys.length > 1 ? "s" : ""} found here ${keys.length > 1 ? "were" : "was"} lost with the team.`); return; }
  for (const tile of keys) if (addKey(state, tile, `found at ${b.place}`)) b.summary.push(`Key ring: + ${keyName(state, tile)}.`);
  b.result.raid.keys = keys.slice();
}

// ---------- the AI's raid team (combat.js autoRaidTurn) ----------
// The open action worth taking next to this unit, or null. Locks it will not try are marked botSkip (and the
// containers behind a skipped door with them).
export function autoLock(state, b, u) {
  const R = b.raid;
  for (const t of lockedNear(b, u)) {
    if ((t.box && t.box.botSkip) || (t.door && t.door.botSkip)) continue;
    if (t.box && LOCKS[t.lock.kind] && LOCKS[t.lock.kind].tier) { const a = autoSafe(state, b, u, t); if (a) return a; continue; } // gun safes (below)
    const o = openOdds(state, b, u, t.lock);
    let m = null;
    if (o.key.ok) m = "key";
    else if (o.pick.ok && o.pick.chance >= 0.3 && R.heat < 50 && (t.lock.tries || 0) < 4) m = "pick";
    else if (o.force.ok && o.force.chance >= 0.4 && R.heat < (o.force.crowbar ? 40 : 30) && (t.lock.tries || 0) < 3 && u.ap >= o.force.ap) m = "force";
    if (!m) {
      if (t.box) t.box.botSkip = true;
      if (t.door) for (const d of R.doors) if (d.area === t.door.area) { d.botSkip = true; for (const c of R.containers) if (c.area === d.area && c.room) c.botSkip = true; }
      continue;
    }
    return { type: "open", unit: u.id, target: t.ref, method: m };
  }
  return null;
}
// Extra cells for the AI to walk to: next to locked doors it has not given up on.
export function lockTargets(b) {
  const out = [];
  const W = b.w, H = b.h;
  for (const d of (b.raid && b.raid.doors) || []) {
    if (d.lock.open || d.botSkip || !onFloor(b, d)) continue; // this storey's doors
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = d.x + dx, y = d.y + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && WALK.has(b.cells[y * W + x].k)) out.push([x, y]);
    }
  }
  return out;
}
// Containers the AI is done with: searched, or locked away for good.
export const botDone = (c) => c.searched || !!c.botSkip;

// ---------- the hour-by-hour search (scavenge.js searchHour) ----------
// How often a search hour turns up something locked, by site type (× loot left).
const SEARCH_LOCK = {
  police: 0.35, gunstore: 0.3, pharmacy: 0.3, military: 0.4, hospital: 0.3, clinic: 0.2, prison: 0.3, univ: 0.25, office: 0.2,
  warehouse: 0.2, factory: 0.2, airport: 0.2, dam: 0.2, crash_mil: 0.5, crash_med: 0.5, crash_cargo: 0.5, crash_news: 0.4, airdrop: 0.4,
};
const SEARCH_KIND = {
  police: "evidence", gunstore: "cage", pharmacy: "drugs", military: "cage", hospital: "drugs", clinic: "drugs", prison: "evidence",
  univ: "safe", office: "safe", warehouse: "crate", factory: "safe", airport: "crate", dam: "safe", crash_mil: "case", crash_med: "case",
  crash_cargo: "case", crash_news: "case", airdrop: "case",
};
// e: the engagement; members: the team. Adds finds to e.found, Heat to e.heat. Returns a line for the log ("" if none).
export function lockedSearchHour(state, e, p, members) {
  const t = state.tiles[e.tile];
  if (!t || !t.loc || !members.length) return "";
  const roll = (...k) => hash01(state.seed, "slock", e.tile, state.hour, e.hours, ...k);
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  const bits = [];
  // A key in a drawer now and then.
  if (roll("key") < 0.025 * loot) {
    const tile = keyFor(state, e.tile, `h${e.hours}`);
    if (tile != null && addKey(state, tile, `found searching ${t.loc.name}`)) bits.push(`a key (${keyName(state, tile)})`);
  }
  // A blueprint on the shelves (blueprints.js; locked ones below are likelier).
  const bp = rollBlueprint(state, e.tile, (anyPerk(members, "treasure") ? 2 : 1) * BP_MULT.plain * 2, `sh${e.hours}`);
  if (bp) { e.found.gear.push(bp); bits.push(bp.name); }
  const pLock = (SEARCH_LOCK[t.loc.type] ?? 0.1) * loot;
  if (roll("lock") >= pLock) return bits.length ? ` Also found ${bits.join(" and ")}.` : "";
  const kind = SEARCH_KIND[t.loc.type] || (roll("k") < 0.5 ? "lockbox" : "locker");
  const def = LOCKS[kind];
  const best = (k) => members.reduce((a, s) => (skill(s, k) > skill(a, k) ? s : a), members[0]);
  const picker = members.filter((s) => picksOf(s)).sort((a, b) => skill(b, "stealth") - skill(a, "stealth"))[0] || null;
  let how = null, chance = 0, heat = 0;
  if (hasKey(state, e.tile)) { how = "key"; chance = 1; }
  else if (picker && e.approach !== "loud") {
    how = "pick";
    chance = clamp(PICK.base + PICK.perStealth * skill(picker, "stealth") - PICK.perDiff * (def.diff - 1) + (hasPerk(picker, "quiethands") ? PICK.quiet : 0), 0.05, 0.95);
    chance = 1 - (1 - chance) ** 2; // two tries in the hour
    heat = PICK.heat * 2;
    gainXp(state, picker, "stealth", PICK.xpWin);
  } else if (def.force && (picker || members.some((s) => barOf(s)))) { how = "force"; chance = clamp(FORCE.base + FORCE.perMech * skill(best("mechanics"), "mechanics") - FORCE.perDiff * (def.diff - 1), 0.05, 0.95); heat = 8; }
  else if (def.force && def.diff <= SMASH.maxDiff) { how = "smash"; chance = clamp(SMASH.base - SMASH.perDiff * (def.diff - 1), 0.05, 0.95); heat = 12; }
  e.heat = Math.min(100, e.heat + heat);
  const lower = def.name.toLowerCase();
  if (!how) return ` A ${lower} could not be opened (lockpicks or a key needed).${bits.length ? ` Also found ${bits.join(" and ")}.` : ""}`;
  if (roll("open") >= chance) return ` A ${lower} held against ${how === "pick" ? "the lockpicks" : how === "key" ? "the key" : "a crowbar"}${heat >= 8 ? " (loud)" : ""}.${bits.length ? ` Also found ${bits.join(" and ")}.` : ""}`;
  // Inside.
  const L = LOCK_LOOT[def.loot] || LOCK_LOOT.cash;
  L.sup.forEach(([k, pp, lo, hi], i) => {
    if ((!SUPPLIES[k] && k !== "food") || roll("s", i) >= pp) return; // food: days of it, typed this hour (scavenge.js typeFound)
    const q = lo + Math.floor(roll("q", i) * (hi - lo + 1));
    if (k === "ammo") addFindVia((kk, qq) => { e.found.supplies[kk] = (e.found.supplies[kk] || 0) + qq; return qq; }, LOCK_AMMO[def.loot] || "home", q, "lock", e.tile, e.hours, i); // ammo.js: rounds by calibre
    else e.found.supplies[k] = (e.found.supplies[k] || 0) + q;
    bits.push(`${q} ${keyWord(k)}`);
  });
  L.gear.forEach(([k, pp], i) => { if (GEAR[k] && roll("g", i) < pp) { const it = lootItem(swapGun(`lock:${def.loot}`, k, [roll("gs", i)]), lockSource(def.loot, siteTypeAt(state, e.tile)), roll("gd", i)); e.found.gear.push(it); bits.push(it.name); } });
  const bp2 = rollBlueprint(state, e.tile, BP_MULT.lock, `shl${e.hours}`);
  if (bp2) { e.found.gear.push(bp2); bits.push(bp2.name); }
  if (L.key && roll("lkey") < L.key) {
    const tile = keyFor(state, e.tile, `hl${e.hours}`);
    if (tile != null && addKey(state, tile, `found in ${/^[aeiou]/i.test(lower) ? "an" : "a"} ${lower} at ${t.loc.name}`)) bits.push(`a key (${keyName(state, tile)})`);
  }
  const verb = how === "key" ? "unlocked" : how === "pick" ? "picked" : how === "force" ? "forced (loud)" : "smashed open (loud)";
  return ` ${verb[0].toUpperCase()}${verb.slice(1)} ${/^[aeiou]/i.test(lower) ? "an" : "a"} ${lower}: ${bits.length ? bits.join(", ") : "nothing much inside"}.`;
}
export { bpOfItem };

// ======================================================================================
// Gun safes (docs/weapons-overhaul-plan.md section 19; what is inside: gunsafes.js)
// ======================================================================================
// Three tiers of a new container kind, "gunsafe" (1 × 1, it stays where it stands): a gun cabinet (cheap: a key lock,
// pried with a crowbar or picked), a gun safe (mid: a dial or a keypad, the site key fits its override lock) and an
// armoury safe (high: a keypad or a dial, no keyhole). Placed by lockRaid (placeGunSafes): an existing container of the
// area becomes the safe (its cell turns into the safe's), so the map's layout and the world's dice do not change.
//
// Ways in (openOdds adds them; openLock → openSafe):
//   combo   the combination (a note found this raid in another container of the building or, now and then, on a
//           body; for a gun cabinet its little key on a tag): sure, 1 action, silent.
//   key     the site key (cheap and mid only), as any lock.
//   pick    the gun cabinet's key lock only (the PICK odds).
//   force   the gun cabinet only, with a crowbar or a pry weapon (the FORCE odds, Heat +6, wakes within 8).
//   crack   a dial, Stealth 6+: 0.04 a Stealth point − 0.10 a tier above the cheap one, 5–60%; both actions, Heat +1,
//           Stealth XP like a pick.
//   bypass  a keypad: 1 parts (generic "parts" stand in for electronics until the parts split lands) from the team's
//           supplies, 0.30 + 0.05 a Mechanics point − 0.15 a tier above the mid one, 5–95%; 1 action, silent; the part
//           is used on a success, half the time on a miss.
//   drill   a power drill: 1 + 0.05 a Mechanics point of progress an action, sure once it adds up (cheap 2, mid 6,
//           high 12; lock.prog, shared by everyone who works on it); noise 1 an action (Heat about +1 each) and it wakes
//           everything within 8 tiles once a turn; the bits wear one use per safe (3).
//   grind   an angle grinder: twice the drill's progress, noise 1.5 an action, wakes within 11; at night the sparks
//           are seen (u.sparks: stealth.js detectRange +2 for the grinder's user that turn).
//   blow    a pipe bomb or a frag grenade set on the door (1 action): it goes off at the start of the next player turn
//           (safeTurn) with the thrown one's blast (Heat +10, wakes within 14, hurts within 1.5): open for sure (cheap,
//           mid) or 70% (high), and the contents are damaged (gunsafes.js blastContents).
// The noise numbers follow the section's Heat sums (a mid safe drilled ≈ 10 Heat over 3 turns, a high one ≈ 19 over
// 6): Heat climbs 1.2 a turn plus the noise (combat.js raidTurn).
Object.assign(LOCKS, {
  gunsafe1: { name: "Gun cabinet", diff: 2, force: true, loot: "gunsafe", tier: 1 },
  gunsafe2: { name: "Gun safe", diff: 4, force: false, loot: "gunsafe", tier: 2, nopick: true },
  gunsafe3: { name: "Armoury safe", diff: 5, force: false, loot: "gunsafe", tier: 3, nopick: true, nokey: true },
});
export const SAFE_TIER_NAMES = { 1: "cheap", 2: "mid", 3: "high" };
const SAFE_METHODS = ["combo", "crack", "bypass", "drill", "grind", "blow"];
export const SAFE = {
  dial: { 1: 0, 2: 0.5, 3: 0.3 }, // the chance it has a dial (else a keypad; the cheap one has a key lock)
  combo: { 1: 0.25, 2: 0.15, 3: 0.08 }, comboBody: 0.05, // the chance its combination is written down somewhere here; on a body
  crack: { minStealth: 6, perStealth: 0.04, perTier: 0.1, min: 0.05, max: 0.6, ap: 2, heat: 1, xpWin: 6, xpMiss: 2 },
  bypass: { base: 0.3, perMech: 0.05, perTier: 0.15, min: 0.05, max: 0.95, part: "parts", missUse: 0.5, ap: 1 },
  drill: { need: { 1: 2, 2: 6, 3: 12 }, perMech: 0.05, noise: 1, radius: 8, ap: 1 },
  grind: { mult: 2, noise: 1.5, radius: 11, sparks: 2, ap: 1 },
  blow: { odds: { 1: 1, 2: 1, 3: 0.7 }, keys: ["pipebomb", "frag"], ap: 1 },
  turnHeat: 1.2, // combat.js raidTurn: Heat a turn before the noise
  // The raid bot (autoSafe): bypass at these odds, crack with this Stealth under this Heat and so many tries, drill or
  // grind only while the Heat at the end stays under heatCap and nothing aware is within enemyNear tiles; never blow.
  bot: { bypass: 0.4, crackStealth: 8, crackHeat: 40, crackTries: 3, bypassTries: 3, heatCap: 35, enemyNear: 8 },
  // The hour-by-hour search (gunSearchHour): Heat for drilling (high-tier safes more), a crack, a blast (only under blowMax).
  search: { drillHeat: 8, drillHeatHigh: 15, crackHeat: 1, blowHeat: 10, blowMax: 30, forceHeat: 8 },
};
// Where gun safes stand: raid area type → [[lock kind, chance], ...] by the site type (one roll an area: the first
// listed is the likelier tier's slice). On a building's own map (buildingmaps.js) the shops' offices and the armories
// carry their own room.gunSafe = [kind, chance] instead, and the homes roll once a building.
const CITY_SITES = ["city", "apartments", "office", "mall", "hospital", "univ", "supermarket", "pharmacy", "school"];
const SAFE_RULES = {
  house: (site) => [["gunsafe1", site === "motel" ? 0.03 : CITY_SITES.includes(site) ? 0.02 : 0.06]],
  farmhouse: (site) => [["gunsafe2", site === "ranch" ? 0.12 : 0], ["gunsafe1", 0.15]],
  cabin: (site) => [["gunsafe2", site === "lodge" ? 0.12 : 0.08], ["gunsafe1", 0.2]],
  armory: (site) => [["gunsafe3", site === "police" ? 0.3 : site === "prison" ? 0.25 : site === "military" ? 0.35 : 0]],
  office: (site) => [["gunsafe2", site === "gunstore" ? 0.5 : site === "police" ? 0.3 : 0]],
  milwreck: () => [["gunsafe3", 0.1]],
};
export const safeRules = (areaType, site) => (SAFE_RULES[areaType] ? SAFE_RULES[areaType](site).filter(([, p]) => p > 0) : []);
const HOME_AREAS = ["cabin", "farmhouse", "house"]; // a building map's homes: the first of these it has decides the rule
const SAFE_BOX = { locker: 0, cabinet: 1, crate: 2, shelf: 3, counter: 4 }; // which container becomes the safe, best first
const siteOf = (state, tile) => (state.tiles[tile] && state.tiles[tile].loc ? state.tiles[tile].loc.type : null);
const safeTier = (lock) => (lock && LOCKS[lock.kind] && LOCKS[lock.kind].tier) || 0;
export const isGunSafe = (lock) => safeTier(lock) > 0;

// ---------- placing them (lockRaid) ----------
export function placeGunSafes(state, b, site, roll) { // exported for tools/gunsafetest.js
  const R = b.raid;
  R.combos = R.combos || [];
  const free = (c) => c.kind in SAFE_BOX && !c.lock;
  const rank = (c) => SAFE_BOX[c.kind] + (c.lockKind ? 10 : 0); // a container the building locked anyway: last
  const pickBox = (list, salt) => {
    const cands = list.filter(free);
    if (!cands.length) return null;
    const best = Math.min(...cands.map(rank));
    const top = cands.filter((c) => rank(c) === best);
    return top[Math.floor(roll("gsbox", salt) * top.length) % top.length];
  };
  const tryRules = (rules, salt) => {
    const r = roll("gs", salt);
    let acc = 0;
    for (const [kind, p] of rules) { acc += p; if (r < acc) return kind; }
    return null;
  };
  const placed = [];
  if (R.interior) {
    // A building's map: the rooms that carry their own (buildingmaps.js room.gunSafe), then one roll for a home.
    for (const a of R.areas) {
      if (!a.gunSafe || !LOCKS[a.gunSafe[0]]) continue;
      const byArea = safeRules(a.type, site).find(([k]) => k === a.gunSafe[0]); // an armory: the site's rate (police, prison, base)
      if (roll("gsroom", a.id) >= (a.type === "armory" && byArea ? byArea[1] : a.gunSafe[1])) continue;
      const c = pickBox(R.containers.filter((q) => q.area === a.id), `r${a.id}`);
      if (c) placed.push(makeGunSafe(b, c, a.gunSafe[0], roll, a));
    }
    const homeType = HOME_AREAS.find((t) => R.areas.some((a) => a.type === t));
    const kind = homeType ? tryRules(safeRules(homeType, site), "home") : null;
    if (kind) {
      const homes = R.areas.filter((a) => a.type === homeType);
      const pref = homes.filter((a) => ["bedroom", "gunroom", "bunk"].includes(a.role));
      const inAreas = (list) => R.containers.filter((q) => list.some((a) => a.id === q.area));
      const c = (pref.length && pickBox(inAreas(pref), "home")) || pickBox(inAreas(homes), "home2");
      if (c) placed.push(makeGunSafe(b, c, kind, roll, R.areas[c.area]));
    }
  } else {
    for (const a of R.areas) {
      const kind = tryRules(safeRules(a.type, site), `a${a.id}`);
      if (!kind) continue;
      const c = pickBox(R.containers.filter((q) => q.area === a.id), `a${a.id}`);
      if (c) placed.push(makeGunSafe(b, c, kind, roll, a));
    }
  }
  // The combination, written down somewhere in the building (or on one of the people who lived here).
  for (const c of placed) {
    const tier = safeTier(c.lock);
    if (roll("combo", c.id) >= SAFE.combo[tier]) continue;
    const same = R.containers.filter((q) => q !== c && q.kind !== "body" && q.kind !== "car" && q.kind !== "pump" && q.kind !== "gunsafe" && (R.interior || q.area === c.area));
    const onBody = !same.length || roll("cbody", c.id) < SAFE.comboBody;
    const dd = (k) => String(Math.floor(roll("code", c.id, k) * 100)).padStart(2, "0");
    c.lock.note = { code: `${dd(1)}-${dd(2)}-${dd(3)}`, at: onBody ? "body" : same[Math.floor(roll("cwhere", c.id) * same.length) % same.length].id };
  }
  if (placed.length) b.log.push({ turn: b.turn, k: "info", text: `${placed.length === 1 ? `A ${LOCKS[placed[0].lock.kind].name.toLowerCase()} stands` : `${placed.length} gun safes stand`} here (${placed.map((c) => (R.areas[c.area] ? R.areas[c.area].name : "")).filter(Boolean).join(", ")}): guns inside, if you can get in. Find the combination, crack or bypass it, drill or grind it (loud), or blow it.` });
}
// An existing container becomes a gun safe of this kind (its cell too).
function makeGunSafe(b, c, kind, roll, area) {
  const def = LOCKS[kind];
  const cells = b.floors && b.floors[c.f || 0] ? b.floors[c.f || 0].cells : b.cells;
  const cell = cells && cells[c.y * b.w + c.x];
  if (cell && cell.k in SAFE_BOX) cell.k = "gunsafe";
  c.kind = "gunsafe";
  delete c.lockKind;
  const mech = def.tier === 1 ? "key" : roll("mech", c.id) < SAFE.dial[def.tier] ? "dial" : "keypad";
  c.lock = { kind, open: false, tries: 0, mech, ref: `c${c.id}` };
  c.label = `${area ? area.name : "Room"}: ${def.name.toLowerCase()}`;
  c.botSkip = false;
  return c;
}
// "Gun safe, mid tier, dial" (the tooltip).
export function safeLine(lock) {
  const def = lock && LOCKS[lock.kind];
  if (!def || !def.tier) return "";
  return `${def.name}, ${SAFE_TIER_NAMES[def.tier]} tier, ${lock.mech === "key" ? "key lock" : lock.mech || "dial"}`;
}

// ---------- the odds (openOdds) ----------
// Supplies the team has in the raid (its packed supplies, the cargo, what everyone carries loose: combat.js pools).
const poolCount = (b, k) => (b.pools || []).reduce((a, p) => a + Math.max(0, (p && p[k]) || 0), 0);
function poolTake(b, k, n = 1) {
  for (const p of b.pools || []) {
    if (!p || !(p[k] > 0)) continue;
    const t = Math.min(n, p[k]);
    p[k] -= t;
    n -= t;
    if (n <= 0) return true;
  }
  return n <= 0;
}
const toolOn = (s, flag) => itemsOf(s).find((it) => GEAR[it.key] && GEAR[it.key][flag] && !(Number.isFinite(it.dur) && it.dur <= 0)) || null;
const bombOn = (s) => itemsOf(s).find((it) => SAFE.blow.keys.includes(it.key)) || null;
// Progress an action with this tool (drill units: a grinder counts double).
export const safeRate = (s, grind = false) => (1 + SAFE.drill.perMech * (s ? skill(s, "mechanics") : 0)) * (grind ? SAFE.grind.mult : 1);
const r1 = (v) => Math.round(v * 10) / 10;
function safeOdds(state, b, u, lock, def, s, out) {
  const tier = def.tier, R = b.raid || {};
  const lower = def.name.toLowerCase();
  const mech = lock.mech || (tier === 1 ? "key" : "dial");
  // The combination (or the cabinet's little key on its tag).
  const known = (R.combos || []).includes(lock.ref);
  const cl = tier === 1 ? "Its key" : "Combination";
  out.combo = known ? { ok: true, chance: 1, ap: 1, label: cl, why: "", heat: 0, wake: 0, turns: 1 }
    : { ok: false, chance: 0, ap: 1, label: cl, why: `No ${tier === 1 ? "key for it" : "note with the combination"} found yet: one may be in another container here, or on a body.` };
  if (def.nokey) out.key = { ok: false, chance: 0, ap: 1, label: "Key", why: `An ${lower} has no keyhole: a ${mech} only.` };
  if (def.nopick) out.pick = { ok: false, chance: 0, ap: 1, label: "Pick", why: `Nothing to pick on a ${mech}: ${mech === "dial" ? "crack the dial" : "bypass the keypad"}, drill it, or blow it.` };
  if (!def.force) out.force = { ok: false, chance: 0, ap: 1, label: "Force", why: `A ${lower} cannot be pried: crack, bypass, drill, grind or blow it.` };
  else if (out.force && !out.force.crowbar) out.force = { ok: false, chance: 0, ap: 1, label: "Force", why: `Too solid to kick in: pry the ${lower} with a crowbar or a pry weapon.` };
  if (out.force && out.force.ok) Object.assign(out.force, { heat: FORCE.heat, wake: FORCE.radius, turns: 1 });
  if (out.pick && out.pick.ok) Object.assign(out.pick, { heat: PICK.heat, wake: 0, turns: 1 });
  // Crack the dial.
  const st = s ? skill(s, "stealth") : 0;
  const C = SAFE.crack;
  const cc = clamp(C.perStealth * st - C.perTier * (tier - 1), C.min, C.max);
  out.crack = mech !== "dial" ? { ok: false, chance: 0, ap: C.ap, label: "Crack", gate: "mech", why: `No dial to crack: it has a ${mech === "key" ? "key lock" : "keypad"}.` }
    : st < C.minStealth ? { ok: false, chance: cc, ap: C.ap, label: "Crack", gate: "skill", why: `Feeling the dial turn needs Stealth ${C.minStealth} (${s ? s.name.split(" ")[0] : "they"} ${s ? "has" : "have"} ${st}).` }
    : { ok: u.ap >= C.ap, chance: cc, ap: C.ap, label: "Crack", heat: C.heat, wake: 0, turns: 1, gate: u.ap >= C.ap ? "" : "ap", why: u.ap >= C.ap ? "" : "Cracking a dial takes the whole turn (both actions)." };
  // Bypass the keypad.
  const B = SAFE.bypass;
  const mk = s ? skill(s, "mechanics") : 0;
  const bc = clamp(B.base + B.perMech * mk - B.perTier * (tier - 2), B.min, B.max);
  const parts = poolCount(b, B.part);
  out.bypass = mech !== "keypad" ? { ok: false, chance: 0, ap: B.ap, label: "Bypass", why: `No keypad to bypass: it has a ${mech === "key" ? "key lock" : "dial"}.` }
    : parts < 1 ? { ok: false, chance: bc, ap: B.ap, label: "Bypass", why: "Needs 1 parts (wiring to short the keypad) in the team's supplies." }
    : { ok: true, chance: bc, ap: B.ap, label: "Bypass", heat: 0, wake: 0, turns: 1, why: "" };
  // Drill or grind it: sure, by progress.
  const need = SAFE.drill.need[tier], prog = lock.prog || 0;
  for (const [m, noise, wake] of [["drill", SAFE.drill.noise, SAFE.drill.radius], ["grind", SAFE.grind.noise, SAFE.grind.radius]]) {
    const tool = toolOn(s, m);
    const rate = safeRate(s, m === "grind");
    const actions = Math.max(1, Math.ceil((need - prog) / rate - 1e-9));
    const turns = Math.ceil(actions / 2);
    out[m] = { ok: !!tool, chance: 1, ap: 1, label: m === "drill" ? "Drill" : "Grind", rate, need, prog: r1(prog), actions, turns, heat: noise, wake, turnHeat: r1(SAFE.turnHeat + noise * 2),
      why: tool ? "" : `Needs ${m === "drill" ? "a cordless power drill" : "an angle grinder"} on this person.` };
  }
  // Blow it.
  const bomb = bombOn(s);
  out.blow = lock.armed ? { ok: false, chance: SAFE.blow.odds[tier], ap: 1, label: "Blow", why: "A charge is already set on it: get clear." }
    : bomb ? { ok: true, chance: SAFE.blow.odds[tier], ap: SAFE.blow.ap, label: "Blow", heat: (THROWABLES[bomb.key] && THROWABLES[bomb.key].heat) || 10, wake: bomb.key === "frag" ? 12 : 14, turns: 1, item: bomb.key, why: "" }
    : { ok: false, chance: SAFE.blow.odds[tier], ap: 1, label: "Blow", why: "Needs a pipe bomb or a frag grenade on this person." };
  return out;
}

// ---------- opening (openLock → openSafe) ----------
function openSafe(state, b, u, t, o, act, H) {
  const R = b.raid;
  const s = survivorById(state, u.sid);
  const lock = t.lock, def = LOCKS[lock.kind];
  const lower = def.name.toLowerCase();
  if (act.method === "blow") {
    const bomb = bombOn(s);
    if (!bomb || !takeItem(s, bomb)) return "Needs a pipe bomb or a frag grenade on this person.";
    lock.tries = (lock.tries || 0) + 1;
    u.ap = Math.max(0, u.ap - o.ap);
    lock.armed = { key: bomb.key, by: u.id, turn: b.turn };
    (R.charges || (R.charges = [])).push({ ref: t.ref, key: bomb.key, by: u.id, turn: b.turn });
    H.say(b, `${u.name} sets the ${bomb.name.toLowerCase()} against the ${lower}'s hinges: it goes off at the start of next turn. Get clear (it hurts anyone within a tile and a half)!`, "danger");
    H.fx(b, { type: "loot", to: [t.x, t.y], text: "charge set" });
    return "";
  }
  lock.tries = (lock.tries || 0) + 1;
  u.ap = Math.max(0, u.ap - o.ap);
  const roll = (k) => hash01(state.seed, "open", b.tileId, b.turn, t.ref, lock.tries, u.id, k);
  const p = (v) => `${Math.round(v * 100)}%`;
  let ok = false;
  if (act.method === "combo") {
    ok = true;
    H.say(b, def.tier === 1 ? `${u.name} opens the ${lower} with its own key.` : `${u.name} dials the combination from the note: the ${lower} swings open.`, "good");
  } else if (act.method === "crack") {
    lock.cracks = (lock.cracks || 0) + 1;
    R.heat = Math.min(100, R.heat + SAFE.crack.heat);
    ok = roll("crack") < o.chance;
    if (s) gainXp(state, s, "stealth", ok ? SAFE.crack.xpWin : SAFE.crack.xpMiss);
    H.say(b, ok ? `${u.name} feels the last wheel drop: the ${lower} is cracked (${p(o.chance)}).` : `${u.name} works the dial of the ${lower} for the whole turn, but loses the count (${p(o.chance)}).`, ok ? "good" : "info");
  } else if (act.method === "bypass") {
    lock.bypasses = (lock.bypasses || 0) + 1;
    ok = roll("bypass") < o.chance;
    const used = ok || roll("part") < SAFE.bypass.missUse;
    if (used) poolTake(b, SAFE.bypass.part, 1);
    H.say(b, ok ? `${u.name} opens up the keypad and shorts the lock: the ${lower} clicks open (${p(o.chance)}).` : `${u.name} shorts the wrong wires on the keypad (${p(o.chance)})${used ? ": the part is burnt out" : ""}.`, ok ? "good" : "info");
  } else if (act.method === "drill" || act.method === "grind") {
    const G = act.method === "grind";
    const tool = toolOn(s, G ? "grind" : "drill");
    lock.prog = r1((lock.prog || 0) + o.rate);
    b.noise = (b.noise || 0) + (G ? SAFE.grind.noise : SAFE.drill.noise);
    if (G) u.sparks = b.turn; // stealth.js detectRange: the sparks are seen at night
    if (lock.alerted !== b.turn) { lock.alerted = b.turn; H.alertNear(b, t.x, t.y, G ? SAFE.grind.radius : SAFE.drill.radius, G ? "The grinder's scream carries: everything nearby turns toward it." : "The whine of the drill carries: everything nearby turns toward it."); }
    ok = lock.prog >= o.need - 1e-9;
    H.say(b, ok ? `${u.name} ${G ? "cuts through the bolts" : "drills out the lock"}: the ${lower} is open.` : `${u.name} ${G ? "grinds at" : "drills into"} the ${lower}: ${G ? "cutting" : "drilling"} ${lock.prog}/${o.need}.`, ok ? "good" : "info");
    if (ok && tool && s && wearPicks(s, tool)) H.say(b, `${u.name}'s ${G ? "cutting discs are" : "drill bits are"} used up: the ${tool.name.toLowerCase()} is spent.`, "danger");
  }
  if (ok) {
    lock.open = true;
    lock.how = act.method;
    H.fx(b, { type: "loot", to: [t.x, t.y], text: "unlocked", how: act.method });
  } else H.fx(b, { type: "loot", to: [t.x, t.y], text: act.method === "drill" || act.method === "grind" ? `${lock.prog}/${o.need}` : "locked", how: act.method });
  return "";
}
// Takes one item off a person (pocket, pack, a slot). Returns true if it was there.
function takeItem(s, it) {
  if (!s || !it) return false;
  for (const k of Object.keys(s.gear || {})) if (s.gear[k] === it) { s.gear[k] = null; return true; }
  const i = (s.pockets || []).indexOf(it);
  if (i >= 0) { s.pockets[i] = null; return true; }
  const pack = s.gear && s.gear.backpack && s.gear.backpack.contents;
  const j = pack ? pack.indexOf(it) : -1;
  if (j >= 0) { pack[j] = null; return true; }
  return false;
}
// The start of each player turn (combat.js startPlayerTurn): the charges set last turn go off.
export function safeTurn(state, b) {
  const R = b && b.raid;
  if (!R || !R.charges || !R.charges.length) return;
  const due = R.charges.filter((c) => c.turn < b.turn);
  R.charges = R.charges.filter((c) => c.turn >= b.turn);
  for (const c of due) {
    const t = targetOf(b, c.ref);
    if (!t || !t.box) continue;
    const T = THROWABLES[c.key] || THROWABLES.pipebomb;
    const by = b.units.find((x) => x.id === c.by) || b.units.find((x) => x.side === "player");
    const def = LOCKS[t.lock.kind];
    const lower = def.name.toLowerCase();
    t.lock.armed = null;
    const f = t.box.f || 0, view = b.floor || 0;
    if (b.floors && f !== view) setFloor(b, f); // the blast is on the safe's storey
    R.heat = Math.min(100, R.heat + (T.heat || 10));
    const extra = by ? landEffect(b, by, T, t.x, t.y) : "";
    if (b.floors && f !== view) setFloor(b, view);
    const ok = hash01(state.seed, "blow", b.tileId, b.turn, c.ref) < SAFE.blow.odds[def.tier];
    if (ok) { t.lock.open = true; t.lock.how = "blow"; t.lock.blown = true; }
    sayB(b, `BOOM: the charge on the ${lower} goes off. ${ok ? "The door hangs off its hinges: whatever is inside took some of it." : "The door buckles but holds."} ${extra}`.trim(), ok ? "good" : "danger");
    fxB(b, { type: "loot", to: [t.x, t.y], text: ok ? "blown open" : "holds" });
  }
}

// ---------- what is inside (lockedLoot) ----------
// A note with a combination (or a cabinet key on a tag) in this container or on this body.
function comboNotes(b, u, box) {
  const R = b.raid;
  for (const c of R.containers) {
    const n = c.lock && c.lock.note;
    if (!n || n.found || c.lock.open) continue;
    if (!(n.at === box.id || (n.at === "body" && box.kind === "body" && box.kit))) continue;
    n.found = true;
    (R.combos || (R.combos = [])).push(c.lock.ref);
    const where = R.areas[c.area] ? R.areas[c.area].name.toLowerCase() : "building";
    b.log.push({ turn: b.turn, k: "good", text: safeTier(c.lock) === 1 ? `${u.name} finds a small key on a tag: "gun cabinet, ${where}".` : `${u.name} finds a note: ${n.code}, for the ${LOCKS[c.lock.kind].name.toLowerCase()} in the ${where}.` });
  }
}
function gunSafeLoot(state, b, u, box, sup, gear, lk, giveKey) {
  const roll = (...k) => hash01(state.seed, "gsafe", b.tileId, b.raid.poiDice ?? state.hour, box.id, ...k);
  const st = rollGunStash(roll, TIER_STASH[lk.tier], siteOf(state, b.tileId), { box });
  gear.push(...st.gear);
  for (const [k, v] of Object.entries(st.sup)) sup[k] = (sup[k] || 0) + v;
  if (box.lock.blown && blastContents(gear, sup)) b.log.push({ turn: b.turn, k: "info", text: `The blast got into the ${lk.name.toLowerCase()}: the guns are knocked about, some of the ammo is gone and anything glass is in pieces.` });
  giveKey(st.key, "lock");
  for (let i = 0; i < st.bp; i++) { const bp = rollBlueprint(state, b.tileId, BP_MULT.lock * (u.scavBonus ? 2 : 1), `box${box.id}s${i}`); if (bp) gear.push(bp); }
}
// Tools and gun cases in a raid container (gunsafes.js GUN_FINDS), and a case in a locked car's trunk.
function areaGunFinds(state, b, box, lk) {
  const area = b.raid.areas[box.area];
  if (!area) return [];
  const site = siteOf(state, b.tileId);
  const roll = (...k) => hash01(state.seed, "gfind", b.tileId, b.raid.poiDice ?? state.hour, box.id, ...k);
  const out = rollAreaGunFinds(roll, area.type, site);
  if (lk && lk.loot === "car" && roll("carcase") < CAR_CASE) out.push(rollGunCase((...k) => roll("cc", ...k), roll("cck") < 0.6 ? "pistolcase" : "riflecase", site));
  return out;
}

// ---------- gun cases in a raid (openLock → openCaseAct) ----------
// Cases this unit can open now: in an opened container next to them ("kb<id>.<i>"), carried loose ("kh<i>"), in a
// pocket ("kq<i>") or the pack ("kp<i>"). [{ ref, item, where }].
const caseFull = (it) => (it.contents && it.contents.some(Boolean)) || Object.values(it.sup || {}).some((v) => v > 0) || !!it.locked;
export function caseTargets(state, b, u) {
  const out = [];
  if (!b.raid || !u || u.side !== "player") return out;
  const add = (it, ref, where) => { if (isGunCase(it) && caseFull(it)) out.push({ ref, item: it, where }); };
  for (const c of b.raid.containers) if (c.contents && nearBox(u, c)) c.contents.gear.forEach((it, i) => add(it, `kb${c.id}.${i}`, c.label));
  (u.haul ? u.haul.gear : []).forEach((it, i) => add(it, `kh${i}`, "carried"));
  const s = survivorById(state, u.sid);
  if (s) {
    (s.pockets || []).forEach((it, i) => add(it, `kq${i}`, "pocket"));
    const pk = s.gear && s.gear.backpack && s.gear.backpack.contents;
    (pk || []).forEach((it, i) => add(it, `kp${i}`, "pack"));
  }
  return out;
}
// What opening a case takes: { ok, why, ap, heat, tool }.
export function caseOdds(state, b, u, item) {
  const s = survivorById(state, u.sid);
  const tool = item.locked ? barOf(s) || itemsOf(s).find((it) => CASE.blades.includes(it.key)) || null : null;
  if (item.locked && !tool) return { ok: false, ap: CASE.raidAp, heat: 0, why: "A locked case needs a blade or a crowbar to open." };
  if (u.ap < CASE.raidAp) return { ok: false, ap: CASE.raidAp, heat: 0, why: "No actions left this turn." };
  return { ok: true, ap: CASE.raidAp, heat: item.locked ? CASE.raidHeat : 0, tool, why: "" };
}
function openCaseAct(state, b, u, act, H) {
  const c = caseTargets(state, b, u).find((x) => x.ref === act.target);
  if (!c) return "No gun case there.";
  const o = caseOdds(state, b, u, c.item);
  if (!o.ok) return o.why;
  u.ap -= o.ap;
  const locked = !!c.item.locked;
  if (o.heat) b.raid.heat = Math.min(100, b.raid.heat + o.heat);
  // What is inside goes where the case is: back into the container, or loose on the one who carries it.
  const m = /^kb(\d+)\./.exec(act.target);
  const box = m ? b.raid.containers.find((q) => q.id === Number(m[1])) : null;
  const dest = box ? box.contents : haulOf(u);
  const got = openCase(c.item, dest.gear, dest.sup);
  H.say(b, `${u.name} ${locked ? `prises the ${c.item.name.toLowerCase()} open with the ${o.tool.name.toLowerCase()} (Heat +${o.heat})` : `opens the ${c.item.name.toLowerCase()}`}: ${got.length ? got.join(", ") : "empty"}.`, "good");
  H.fx(b, { type: "loot", to: [u.x, u.y], text: "case open" });
  return "";
}

// ---------- the AI's raid team (autoLock → autoSafe) ----------
// The projected Heat at the end of drilling or grinding: R.heat + turns × (1.2 + the noise of a turn's two actions).
export const drillEndHeat = (b, o) => b.raid.heat + o.turns * (SAFE.turnHeat + o.heat * 2);
function autoSafe(state, b, u, t) {
  const R = b.raid, lock = t.lock;
  const o = openOdds(state, b, u, lock);
  const s = survivorById(state, u.sid);
  const A = SAFE.bot;
  const go = (m) => ({ type: "open", unit: u.id, target: t.ref, method: m });
  if (lock.armed) return null; // a charge is set on it: wait for it
  if (o.key.ok) return go("key");
  if (o.combo.ok) return go("combo");
  if (o.pick.ok && o.pick.chance >= 0.3 && R.heat < 50 && (lock.tries || 0) < 4) return go("pick");
  if (o.force.ok && o.force.chance >= 0.4 && R.heat < 40 && (lock.tries || 0) < 3 && u.ap >= o.force.ap) return go("force");
  if (o.bypass.ok && o.bypass.chance >= A.bypass && (lock.bypasses || 0) < A.bypassTries) return go("bypass");
  const crackable = (o.crack.ok || o.crack.gate === "ap") && s && skill(s, "stealth") >= A.crackStealth && R.heat < A.crackHeat && (lock.cracks || 0) < A.crackTries;
  if (crackable) return o.crack.ok ? go("crack") : null; // one action left this turn: crack it next turn
  // Drill or grind, whichever ends the job under the Heat cap, and only with nothing aware close by.
  const enemyNear = b.units.some((e) => e.side === "enemy" && e.aware && !e.dead && !e.left && !e.down && (e.f || 0) === (u.f || 0) && Math.hypot(e.x - t.x, e.y - t.y) <= A.enemyNear);
  if (!enemyNear) {
    const fits = ["grind", "drill"].filter((m) => o[m].ok && drillEndHeat(b, o[m]) < A.heatCap).sort((m1, m2) => drillEndHeat(b, o[m1]) - drillEndHeat(b, o[m2]));
    if (fits.length) return go(fits[0]);
  } else if ((lock.prog || 0) > 0 && R.heat < A.heatCap) return null; // half drilled: come back once it is quiet
  t.box.botSkip = true; // never blown (it would wreck what is inside)
  return null;
}

// ---------- the hour-by-hour search (scavenge.js searchHour → gunSearchHour) ----------
// A gun safe at these site types, a chance an hour × loot left: [[kind, chance], ...].
export const SEARCH_SAFE = {
  town: [["gunsafe1", 0.02]], motel: [["gunsafe1", 0.01]], city: [["gunsafe1", 0.006]], apartments: [["gunsafe1", 0.006]],
  farm: [["gunsafe1", 0.05]], ranch: [["gunsafe2", 0.03], ["gunsafe1", 0.05]], cabin: [["gunsafe2", 0.02], ["gunsafe1", 0.06]],
  lodge: [["gunsafe2", 0.04], ["gunsafe1", 0.04]], ranger: [["gunsafe1", 0.03]],
  gunstore: [["gunsafe2", 0.08]], police: [["gunsafe3", 0.04], ["gunsafe2", 0.03]], prison: [["gunsafe3", 0.04]], military: [["gunsafe3", 0.05]], crash_mil: [["gunsafe3", 0.03]],
};
// Tools on a workbench and a gun safe now and then (their own dice). The team picks its best way into a safe: a key
// (cheap, mid), a crowbar (cheap), a drill or a grinder (Heat +8, an armoury safe +15), a safecracker on a dial (Heat
// +1), else a pipe bomb or a frag grenade while Heat is under 30 (Heat +10, the contents damaged); otherwise it stays
// shut. Adds to e.found and e.heat. Returns a line for the log ("" if nothing).
export function gunSearchHour(state, e, p, members) {
  const t = state.tiles[e.tile];
  if (!t || !t.loc || !members.length) return "";
  const site = t.loc.type;
  const roll = (...k) => hash01(state.seed, "gsearch", e.tile, state.hour, e.hours, ...k);
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  let line = "";
  const tools = [];
  for (const [k, pp] of Object.entries(SEARCH_TOOLS[site] || {})) if (GEAR[k] && roll("tool", k) < pp * loot) { const it = lootItem(k, toolSource(site), roll("toolq", k)); e.found.gear.push(it); tools.push(it.name); }
  if (tools.length) line += ` On a workbench: ${tools.join(" and ")}.`;
  let acc = 0;
  const r = roll("safe");
  const pick = (SEARCH_SAFE[site] || []).find(([, pp]) => (acc += pp * loot) > r);
  if (pick) line += searchSafe(state, e, members, pick[0], roll, site);
  return line;
}
function searchSafe(state, e, members, kind, roll, site) {
  const def = LOCKS[kind], tier = def.tier, lower = def.name.toLowerCase();
  const mech = tier === 1 ? "key" : roll("mech") < SAFE.dial[tier] ? "dial" : "keypad";
  const S = SAFE.search;
  const withItem = (fn) => { for (const s of members) { const it = itemsOf(s).find(fn); if (it) return [s, it]; } return null; };
  const cutter = withItem((it) => GEAR[it.key] && (GEAR[it.key].grind || GEAR[it.key].drill) && !(Number.isFinite(it.dur) && it.dur <= 0));
  const cracker = members.filter((s) => skill(s, "stealth") >= SAFE.crack.minStealth).sort((a, c) => skill(c, "stealth") - skill(a, "stealth"))[0] || null;
  const bomb = withItem((it) => SAFE.blow.keys.includes(it.key));
  let how = null, chance = 0, heat = 0;
  if (!def.nokey && hasKey(state, e.tile)) { how = "key"; chance = 1; }
  else if (def.force && members.some((s) => barOf(s))) { how = "force"; chance = clamp(FORCE.base + FORCE.perMech * Math.max(...members.map((s) => skill(s, "mechanics"))) - FORCE.perDiff * (def.diff - 1), 0.05, 0.95); heat = S.forceHeat; }
  else if (cutter) { how = GEAR[cutter[1].key].grind ? "grind" : "drill"; chance = 1; heat = tier >= 3 ? S.drillHeatHigh : S.drillHeat; }
  else if (mech === "dial" && cracker) { how = "crack"; chance = clamp(SAFE.crack.perStealth * skill(cracker, "stealth") - SAFE.crack.perTier * (tier - 1), SAFE.crack.min, SAFE.crack.max); heat = S.crackHeat; gainXp(state, cracker, "stealth", SAFE.crack.xpWin); }
  else if (bomb && e.heat < S.blowMax) { how = "blow"; chance = SAFE.blow.odds[tier]; heat = S.blowHeat; takeItem(bomb[0], bomb[1]); }
  e.heat = Math.min(100, e.heat + heat);
  const A = /^[aeiou]/i.test(lower) ? "An" : "A";
  if (!how) return ` ${A} ${lower} (${mech === "key" ? "key lock" : mech}) stays shut: it needs a drill, a grinder${mech === "dial" ? " or a safecracker (Stealth 6)" : ""}.`;
  if (roll("sopen") >= chance) return ` ${A} ${lower} held against ${how === "crack" ? "the safecracker" : how === "force" ? "the crowbar" : "the blast"}${heat >= 8 ? " (loud)" : ""}.`;
  if ((how === "drill" || how === "grind") && cutter) wearPicks(cutter[0], cutter[1]);
  const st = rollGunStash((...k) => roll("st", ...k), TIER_STASH[tier], site);
  if (how === "blow") blastContents(st.gear, st.sup);
  const bits = [];
  for (const it of st.gear) { e.found.gear.push(it); bits.push(it.name); }
  for (const [k, v] of Object.entries(st.sup)) if (v > 0) { e.found.supplies[k] = (e.found.supplies[k] || 0) + v; bits.push(`${v} ${keyWord(k)}`); }
  const verb = { key: "Unlocked", force: "Pried open (loud)", drill: "Drilled open (loud)", grind: "Cut open (loud)", crack: "Cracked", blow: "Blew open (loud)" }[how];
  return ` ${verb} ${A.toLowerCase()} ${lower}: ${bits.length ? bits.join(", ") : "nothing inside"}.`;
}
