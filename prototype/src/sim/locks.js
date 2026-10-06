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
import { GEAR, LOCATIONS, SUPPLIES } from "./data.js";
import { log, skill, survivorById, day } from "./world.js";
import { hash01, gainXp, hasPerk, anyPerk } from "./skills.js";
import { newItem, allItems } from "./inventory.js";
import { rollBlueprint, bpOfItem } from "./blueprints.js";
import { CELL } from "./combat.js";

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
};
export const PICK = { base: 0.55, perStealth: 0.04, perDiff: 0.15, quiet: 0.1, heat: 1, xpWin: 6, xpMiss: 2 };
export const FORCE = { base: 0.85, perMech: 0.015, perDiff: 0.2, heat: 6, radius: 8, noise: 2 };
export const SMASH = { base: 0.5, perDiff: 0.2, heat: 10, radius: 11, noise: 3, maxDiff: 2, ap: 2 };
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
  return `${t.loc.name} ${KEY_WORD[t.loc.type] || "key"}`;
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
  out.key = hasKey(state, site) ? { ok: true, chance: 1, ap: 1, label: "Key", why: "" } : { ok: false, chance: 0, ap: 1, label: "Key", why: `No key for ${b.place} on the key ring.` };
  const picks = picksOf(s);
  const pc = clamp(PICK.base + PICK.perStealth * (s ? skill(s, "stealth") : 0) - PICK.perDiff * (def.diff - 1) + (u.quiet || (s && hasPerk(s, "quiethands")) ? PICK.quiet : 0), 0.05, 0.95);
  out.pick = picks ? { ok: true, chance: pc, ap: 1, label: "Pick", why: "" } : { ok: false, chance: pc, ap: 1, label: "Pick", why: "Needs lockpicks (the Crowbar and lockpicks item) on this person." };
  if (!def.force) out.force = { ok: false, chance: 0, ap: 1, label: "Force", why: `A ${def.name.toLowerCase()} cannot be forced: pick it or use a key.` };
  else if (barOf(s)) out.force = { ok: true, chance: clamp(FORCE.base + FORCE.perMech * (s ? skill(s, "mechanics") : 0) - FORCE.perDiff * (def.diff - 1), 0.05, 0.95), ap: 1, label: "Force", crowbar: true, why: "" };
  else if (def.diff <= SMASH.maxDiff) out.force = { ok: u.ap >= SMASH.ap, chance: clamp(SMASH.base - SMASH.perDiff * (def.diff - 1), 0.05, 0.95), ap: SMASH.ap, label: "Smash", why: u.ap >= SMASH.ap ? "" : "Smashing it takes both actions." };
  else out.force = { ok: false, chance: 0, ap: 1, label: "Force", why: "Too solid to smash without a crowbar." };
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
  const type = t && t.loc ? t.loc.type : null;
  const roll = (...k) => hash01(state.seed, "lock", b.tileId, state.hour, ...k);
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
      c.label = `${area.name}: ${LOCKS[c.lockKind].name.toLowerCase()}`;
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
  const doors = (a.doors || []).filter(([x, y]) => b.cells[idx(x, y)] && b.cells[idx(x, y)].k === "open");
  if (!doors.length || doors.some(([x, y]) => b.units.some((u) => !u.dead && u.x === x && u.y === y))) return false;
  const old = doors.map(([x, y]) => b.cells[idx(x, y)].k);
  for (const [x, y] of doors) b.cells[idx(x, y)].k = "door";
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
  doors.forEach(([x, y], i) => { b.cells[idx(x, y)].k = old[i]; });
  return false;
}
// Cell kinds a unit can stand on (combat.js CELL walk: true; read when called, the modules load in a circle).
const WALK = { has: (k) => !!(CELL[k] && CELL[k].walk) };

// ---------- what is locked next to a unit ----------
// Targets: { ref: "c<id>" | "d<id>", x, y, lock, name, box?, door? }.
// Containers and doors carry f (their storey, buildingmaps.js): only the active floor's are next to anyone on it.
const onFloor = (b, o) => (o.f || 0) === (b.floor || 0);
export function lockedNear(b, u) {
  if (!b.raid) return [];
  const near = (o) => (o.f || 0) === (u.f || 0) && Math.max(Math.abs(u.x - o.x), Math.abs(u.y - o.y)) <= 1;
  const out = [];
  for (const c of b.raid.containers) if (c.lock && !c.lock.open && !c.searched && near(c)) out.push({ ref: `c${c.id}`, x: c.x, y: c.y, lock: c.lock, name: LOCKS[c.lock.kind].name, box: c });
  for (const d of b.raid.doors || []) if (!d.lock.open && near(d)) out.push({ ref: `d${d.id}`, x: d.x, y: d.y, lock: d.lock, name: LOCKS[d.lock.kind].name, door: d });
  return out;
}
export function lockAt(b, x, y) {
  if (!b.raid) return null;
  const d = (b.raid.doors || []).find((q) => q.x === x && q.y === y && onFloor(b, q));
  if (d) return { ref: `d${d.id}`, x, y, lock: d.lock, name: LOCKS[d.lock.kind].name, door: d };
  const c = b.raid.containers.find((q) => q.x === x && q.y === y && q.lock && onFloor(b, q));
  return c ? { ref: `c${c.id}`, x, y, lock: c.lock, name: LOCKS[c.lock.kind].name, box: c } : null;
}
const targetOf = (b, ref) => {
  if (!b.raid || typeof ref !== "string") return null;
  const id = Number(ref.slice(1));
  if (ref[0] === "c") { const c = b.raid.containers.find((q) => q.id === id); return c && c.lock ? { ref, x: c.x, y: c.y, lock: c.lock, name: LOCKS[c.lock.kind].name, box: c } : null; }
  const d = (b.raid.doors || []).find((q) => q.id === id);
  return d ? { ref, x: d.x, y: d.y, lock: d.lock, name: LOCKS[d.lock.kind].name, door: d } : null;
};
export const lockedMsg = (box) => `The ${LOCKS[box.lock.kind].name.toLowerCase()} is locked: open it first (key, lockpicks or force).`;

// ---------- opening (combat.js combatAct "open") ----------
// act: { unit, target: "c<id>" | "d<id>", method: "key" | "pick" | "force" }. H: { say, alertNear, fx } from combat.js.
// Returns an error ("" when the action happened, success or not).
export function openLock(state, b, u, act, H) {
  const t = targetOf(b, act.target);
  if (!t || t.lock.open) return "Nothing locked there.";
  if (Math.max(Math.abs(u.x - t.x), Math.abs(u.y - t.y)) > 1) return "Move next to it first.";
  const odds = openOdds(state, b, u, t.lock);
  const o = odds[act.method];
  if (!o) return "Unknown way to open it.";
  if (!o.ok) return o.why;
  const R = b.raid;
  const s = survivorById(state, u.sid);
  const def = LOCKS[t.lock.kind];
  const lower = def.name.toLowerCase();
  t.lock.tries = (t.lock.tries || 0) + 1;
  const roll = act.method === "key" ? 0 : hash01(state.seed, "open", b.tileId, b.turn, t.ref, t.lock.tries, u.id);
  const ok = roll < o.chance;
  u.ap = Math.max(0, u.ap - o.ap);
  if (act.method === "pick") {
    R.heat = Math.min(100, R.heat + PICK.heat);
    const picks = picksOf(s);
    if (s) gainXp(state, s, "stealth", ok ? PICK.xpWin : PICK.xpMiss);
    if (picks && s && wearPicks(s, picks)) H.say(b, `${u.name}'s lockpicks snap: the crowbar and picks are worn out.`, "danger");
    H.say(b, ok ? `${u.name} picks the ${lower} (${Math.round(o.chance * 100)}%).` : `${u.name} works the pins of the ${lower}, but it holds (${Math.round(o.chance * 100)}%). Try again or force it.`, ok ? "good" : "info");
  } else if (act.method === "force") {
    const smash = !o.crowbar;
    const P = smash ? SMASH : FORCE;
    R.heat = Math.min(100, R.heat + P.heat);
    b.noise = (b.noise || 0) + P.noise;
    H.say(b, ok ? `${u.name} ${smash ? "smashes" : "forces"} the ${lower} open with a crash (${Math.round(o.chance * 100)}%).` : `${u.name} ${smash ? "kicks at" : "heaves on"} the ${lower}, but it holds (${Math.round(o.chance * 100)}%).`, ok ? "good" : "danger");
    H.alertNear(b, t.x, t.y, P.radius, "The noise wakes everything nearby.");
  } else {
    H.say(b, `${u.name} unlocks the ${lower} with the ${keyName(state, b.tileId)}.`, "good");
  }
  if (ok) {
    t.lock.open = true;
    t.lock.how = act.method === "force" && !o.crowbar ? "smash" : act.method;
    if (t.door) {
      // An opened door: open floor on the street map; an open door in a building (buildingmaps.js, no longer two
      // storeys of sight-blocking).
      const openCell = (dc) => { dc.k = R.interior ? "odoor" : "open"; dc.f = "floor"; delete dc.t; };
      const cellsOf = (d) => (b.floors && b.floors[d.f || 0] ? b.floors[d.f || 0].cells : b.cells); // the door's own storey (buildingmaps.js)
      openCell(cellsOf(t.door)[t.y * b.w + t.x]);
      b.losCache.fill(0);
      const area = t.door.area != null ? R.areas[t.door.area] : null;
      // Every door of the room opens with the same key; a forced door is just broken.
      if (act.method === "key") for (const d of R.doors) if (d.area === t.door.area && !d.lock.open) { d.lock.open = true; d.lock.how = "key"; openCell(cellsOf(d)[d.y * b.w + d.x]); }
      if (area) H.say(b, `The ${area.name.toLowerCase()} is open.`, "info");
      else H.say(b, "The way out is open.", "info");
    }
    H.fx(b, { type: "loot", to: [t.x, t.y], text: "unlocked" });
  } else H.fx(b, { type: "loot", to: [t.x, t.y], text: "locked" });
  return "";
}

// ---------- loot (combat.js searchBox, when a container's contents are rolled) ----------
// Extras by lock kind: [supply, chance, lo, hi] and gear [key, chance].
const LOCK_LOOT = {
  cash:     { sup: [["ammo", 0.6, 6, 15], ["meds", 0.15, 1, 1]], gear: [["pistol", 0.1], ["knife", 0.1]], key: 0.2 },
  gear:     { sup: [["ammo", 0.4, 5, 12]], gear: [["vest", 0.1], ["bikehelmet", 0.1], ["kneeguards", 0.1], ["backpack", 0.1]], key: 0.1 },
  meds:     { sup: [["meds", 0.95, 3, 6]], gear: [["surgkit", 0.1], ["bandagekit", 0.2]], key: 0.08 },
  evidence: { sup: [["ammo", 0.8, 10, 25]], gear: [["pistol", 0.3], ["shotgun", 0.15], ["lockbook", 0.1], ["riothelmet", 0.1]], key: 0.3 },
  cargo:    { sup: [["food", 0.5, 4, 10], ["parts", 0.5, 1, 3], ["fuel", 0.25, 1, 3]], gear: [["assaultpack", 0.05]], key: 0.05 },
  guns:     { sup: [["ammo", 0.95, 20, 40]], gear: [["pistol", 0.4], ["shotgun", 0.3], ["huntrifle", 0.25], ["ar", 0.1]], key: 0.1 },
  safe:     { sup: [["meds", 0.25, 1, 2], ["ammo", 0.5, 10, 20]], gear: [["nvg", 0.05], ["milradio", 0.05]], key: 0.3 },
  crash:    { sup: [["meds", 0.45, 1, 3], ["ammo", 0.5, 10, 30]], gear: [["ar", 0.1], ["plate", 0.08], ["nvg", 0.06], ["milradio", 0.06], ["assaultpack", 0.08]], key: 0 },
};
const BP_MULT = { lock: 4, room: 2, plain: 0.5 };
const ZBODY_KEY = 0.04; // a key to a nearby place on one of the dead (their own house, a car, a shop)
// sup / gear: what the normal roll put in (changed in place). Returns nothing; keys go to R.foundKeys.
export function lockedLoot(state, b, u, box, sup, gear) {
  const R = b.raid;
  if (!R) return;
  R.foundKeys = R.foundKeys || [];
  const roll = (...k) => hash01(state.seed, "lloot", b.tileId, state.hour, box.id, ...k);
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
  const mult = lk ? 1.5 : box.room ? 1.3 : 1;
  if (mult > 1) for (const k of Object.keys(sup)) sup[k] = Math.max(1, Math.round(sup[k] * mult));
  if (lk) {
    const L = LOCK_LOOT[lk.loot] || LOCK_LOOT.cash;
    L.sup.forEach(([k, p, lo, hi], i) => {
      if (!SUPPLIES[k] || roll("s", i) >= p) return;
      sup[k] = (sup[k] || 0) + lo + Math.floor(roll("q", i) * (hi - lo + 1));
    });
    L.gear.forEach(([k, p], i) => { if (GEAR[k] && roll("g", i) < p) gear.push(newItem(k, 1)); });
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
    if (!SUPPLIES[k] || roll("s", i) >= pp) return;
    const q = lo + Math.floor(roll("q", i) * (hi - lo + 1));
    e.found.supplies[k] = (e.found.supplies[k] || 0) + q;
    bits.push(`${q} ${k}`);
  });
  L.gear.forEach(([k, pp], i) => { if (GEAR[k] && roll("g", i) < pp) { const it = newItem(k, 1); e.found.gear.push(it); bits.push(it.name); } });
  const bp2 = rollBlueprint(state, e.tile, BP_MULT.lock, `shl${e.hours}`);
  if (bp2) { e.found.gear.push(bp2); bits.push(bp2.name); }
  if (L.key && roll("lkey") < L.key) {
    const tile = keyFor(state, e.tile, `hl${e.hours}`);
    if (tile != null && addKey(state, tile, `found in a ${lower} at ${t.loc.name}`)) bits.push(`a key (${keyName(state, tile)})`);
  }
  const verb = how === "key" ? "unlocked" : how === "pick" ? "picked" : how === "force" ? "forced (loud)" : "smashed open (loud)";
  return ` ${verb[0].toUpperCase()}${verb.slice(1)} a ${lower}: ${bits.length ? bits.join(", ") : "nothing much inside"}.`;
}
export { bpOfItem };
