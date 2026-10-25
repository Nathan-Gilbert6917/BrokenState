// Who is inside a multi-storey building, by floor (docs/multi-storey-crawl.md phase 3), in the city crawl (citycrawl.js
// enterPlace, once the raid's map is built: placeFolk):
//   survivors barricaded upstairs - in apartments, offices, hospitals, schools and motels of two storeys or more, a small
//                        neutral group (wanderers.js newNeutralGroup: real people, remembered by the daily simulation) holds
//                        an upper-floor room, its one door barricaded from inside (a "door" cell with hit points, c.barred).
//                        When one of yours reaches the door or sees them a card is raised over the fight (card.battle:
//                        ui.js shows it; the raid bot answers it by the choices' ai weights): talk (Speech: what they know
//                        of their floor - the dead marked on the map, the places to search - and a little food and water
//                        from people who are not desperate), ask them to join (Leadership and their mood: they take the
//                        back stairs and wait on the street - the recruit card when the team is out, folkAfterPlace),
//                        leave them be, or force the door (the barricade comes down, they turn hostile and fire first).
//   raiders holed up   - the place's raiders (citycrawl.js RAIDERS) hold an upper-floor room in offices, apartments and
//                        police stations, one of them a watcher on the floor below by the stairwell (he stands his post),
//                        their stash (a crate with their kit, ammunition and food) in the room. Deeper blocks arm them better.
//   nests              - from block NEST.from in a building of NEST.storeys or more: a cluster of the special dead around
//                        a knot of hive flesh on the top floor, keeping still (u.nesting: combat.js patrol) until noise
//                        (alertNear through the floors), Heat NEST.heat or the sight of you wakes them. The top floor's
//                        containers are richer (c.rich: combat.js searchBox), gear among it.
// What the block card knows of a place's upper floors (place.known: a Look around on the block, citycrawl.js lookAround,
// or having been inside) is its hint under the storey count (folkHint). What a place holds is rolled with the city's own
// dice when the block is made (rollFolk), so the same building holds the same people every visit; the placing and the
// cards use the world's dice like any card.
// Everything new lives on plain data: place.folk / place.known on the crawl, b.raid.folk in the raid (snapshotBuilding
// keeps it), u.folk / u.nesting / u.watcher on units, c.barred / c.nest on cells, c.rich / c.contents on containers.
import { GEAR } from "./data.js";
import { addCard, skill } from "./world.js";
import { partyMembers, bestSkill } from "./parties.js";
import { say, setFloor, enemyUnit, KITS, WEAPONS, active, activeAny, canSee, fire } from "./combat.js";
import { BMAP, placeOccupantGroups } from "./buildingmaps.js";
import { newNeutralGroup, talkChance, groupById } from "./wanderers.js";
import { applyZType } from "./zombietypes.js";
import { lootItem } from "./inventory.js";
import { spend } from "./itemcond.js";
import { gainXp, USE } from "./skills.js";
import { haulOf } from "./raidloot.js";
import { thirdSideHit } from "./thirdside.js";
import { offerRecruits } from "./recruits.js";
import { talker } from "./conflicts.js";
import { sortFind } from "./ammo.js"; // rounds by calibre
import { swapGun } from "./gundist.js"; // the gun distribution: which gun a raider holds or stashes

export const FOLK = {
  SURVIVORS: {
    types: ["apartments", "offices", "hospital", "school", "motel"],
    // A place of 2+ storeys holds them: base + perBlock a block deeper − perDanger a danger level (placeDanger 1–5) over the first.
    base: 0.12, perBlock: 0.05, perDanger: 0.03, min: 0.03, max: 0.45,
    power: 2.4,            // their power on the map
    door: "locked",        // the barricade's hit points: BMAP.DOOR[door]
    // Asking them to join: base + perLead × the team's best Leadership + their mood + talked (after a good talk), at most max.
    join: { base: 0.2, perLead: 0.03, talked: 0.2, refused: -0.1, max: 0.9, mood: { desperate: 0.15, friendly: 0.1, wary: 0 } },
    gift: { food: [2, 4], water: [2, 4] }, // what a good talk brings out through the barricade (not from the desperate)
  },
  RAIDERS: {
    types: ["offices", "apartments", "police"],
    strongFrom: 4, strongPer: 0.12, strongMax: 0.6, // from block strongFrom each raider carries a strong weapon with strongPer × (block − strongFrom + 1)
    armorFrom: 3, armorPer: 0.1, armorMax: 0.5,     // ... and wears a vest likewise
    stash: { ammo: [10, 30], food: [2, 6], water: [1, 4], gear: [1, 2], perBlocks: 4, finds: 0.6 }, // the stash: ammo, food, water, gear (+1 every perBlocks blocks), a pocket find
  },
  NEST: {
    from: 4, storeys: 4,                             // a block from `from` in a building of `storeys`+ floors
    chance: 0.2, perBlock: 0.08, max: 0.6,           // chance + perBlock a block deeper
    count: [3, 5], more: 0.5, cap: 8,                // the special dead around the knot: count + more × (block − from)
    rich: 1.4,                                       // the top floor's containers × this (combat.js searchBox)
    heat: 55,                                        // Heat at which the nest stirs on its own
  },
  LOOK: { base: 0.55, perScout: 0.07, max: 0.95, hours: 1 }, // Look around: each place's upper floors read with base + perScout × best Scouting
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (c) => `${Math.round(c * 100)}%`;
const first = (name) => String(name).split(" ")[0];
const names = (list) => (list.length <= 1 ? list.map(first).join("") : `${list.slice(0, -1).map(first).join(", ")} and ${first(list[list.length - 1])}`);
const I = (b, x, y) => y * b.w + x;
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const cellsOf = (b, f) => (b.floors ? b.floors[f].cells : b.cells);
const area = (r) => (r.w - 2) * (r.h - 2);
const roomsOn = (b, f) => b.raid.areas.filter((a) => !a.outdoor && a.role && (a.f || 0) === f);
const inRoom = (r, x, y) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1;
const standing = (u) => !u.dead && !u.left && !u.fled && !u.off;
const takenAt = (b, f, x, y) => b.units.some((u) => standing(u) && (u.f || 0) === f && u.x === x && u.y === y);
const unitsIn = (b, r) => b.units.filter((u) => standing(u) && (u.f || 0) === (r.f || 0) && inRoom(r, u.x, u.y));
const stairsIn = (b, r) => (b.raid.stairs || []).some(([x, y]) => inRoom(r, x, y));
const roomUsed = (b, r) => !!b.raid.folk && [b.raid.folk.nest, b.raid.folk.survivors, b.raid.folk.raiders].some((x) => x && x.room === r.id);
// Free floor cells inside a room on its floor (open floor with nobody on it).
function freeCells(b, room) {
  const f = room.f || 0, cells = cellsOf(b, f), out = [];
  for (let y = room.y0 + 1; y < room.y0 + room.h - 1; y++) for (let x = room.x0 + 1; x < room.x0 + room.w - 1; x++) if (cells[I(b, x, y)].k === "open" && !takenAt(b, f, x, y)) out.push([x, y]);
  return out;
}
// Free open cells next to a stairwell (8 ways) on floor f.
function stairSide(b, f) {
  const cells = cellsOf(b, f), out = [];
  for (const [sx, sy] of b.raid.stairs || []) for (const [dx, dy] of DIRS8) {
    const x = sx + dx, y = sy + dy;
    if (x > 0 && y > 0 && x < b.w - 1 && y < b.h - 1 && cells[I(b, x, y)].k === "open" && !takenAt(b, f, x, y)) out.push([x, y]);
  }
  return out;
}
const roomAt = (b, f, x, y) => roomsOn(b, f).find((r) => inRoom(r, x, y)) || null;
const clearLos = (b, f) => { const F = b.floors[f]; if (F && F.losCache) F.losCache.fill(0); };
const floorName = (b, f) => (b.floors && b.floors[f] ? b.floors[f].name.toLowerCase() : "upper floor");
// "on floor 3" / "on the top floor" / "on the ground floor".
const onFloor = (b, f) => { const n = floorName(b, f); return /^floor \d/.test(n) ? `on ${n}` : `on the ${n}`; };

// ---------- what a place holds (citycrawl.js genBlock, the city's dice) ----------
// o: { key (the building type), n (the block), storeys, danger (placeDanger level 1–5), raiders (the place has raiders) }.
export function rollFolk(rng, o) {
  const out = { survivors: false, raidersUp: false, nest: false };
  const S = FOLK.SURVIVORS, N = FOLK.NEST, K = FOLK.RAIDERS;
  if (o.storeys >= 2 && S.types.includes(o.key)) out.survivors = rng.chance(clamp(S.base + S.perBlock * (o.n - 1) - S.perDanger * ((o.danger || 1) - 1), S.min, S.max));
  if (o.raiders && o.storeys >= 2 && K.types.includes(o.key)) out.raidersUp = true;
  if (o.n >= N.from && o.storeys >= N.storeys) out.nest = rng.chance(Math.min(N.max, N.chance + N.perBlock * (o.n - N.from)));
  return out;
}
// The block card's hint for a place the team has looked at (null: nothing known yet).
export function folkHint(place) {
  if (!place || !place.known) return null;
  const f = place.folk || {};
  const bits = [];
  if (f.nest) bits.push("something nests above");
  if (f.raidersUp && place.raiders) bits.push("voices and a watcher on the stairs");
  if (f.survivors) bits.push("lights were seen upstairs");
  return bits.length ? bits.join("; ") : "nothing stirs upstairs";
}
// After the team has been inside: what the card says follows what is still up there.
export function noteFolk(place, b) {
  const F = b && b.raid && b.raid.folk;
  if (!place || !F) return;
  const alive = (test) => b.units.some((u) => test(u) && standing(u));
  place.folk = {
    ...(place.folk || {}),
    survivors: !!F.survivors && alive((u) => u.folk === "survivors"),
    raidersUp: !!F.raiders && !!F.raiders.up && alive((u) => u.side === "enemy" && u.kind === "human" && (u.f || 0) > 0),
    nest: !!F.nest && alive((u) => u.nesting),
  };
}

// ---------- placing (citycrawl.js enterPlace, a fresh building) ----------
// deps.kind(rng): a kind of special dead for the nest (citycrawl.js crawlKind). Returns b.raid.folk.
export function placeFolk(state, b, place, n, deps = {}) {
  const R = b.raid;
  if (!R) return null;
  R.folk = null;
  if (!b.floors || b.floors.length < 2) return null;
  const folk = place.folk || {};
  R.folk = { survivors: null, raiders: null, nest: null, place: place.id, block: n };
  if (folk.nest) R.folk.nest = makeNest(state, b, n, deps.kind);
  if (folk.survivors) R.folk.survivors = barricadeSurvivors(state, b);
  R.folk.raiders = holeUpRaiders(state, b, n, !!folk.raidersUp);
  return R.folk;
}

// The nest: a knot of hive flesh in the biggest room of the top floor, the special dead around it, keeping still.
function makeNest(state, b, n, kindFn) {
  const rng = state.rng, R = b.raid, N = FOLK.NEST;
  const top = b.floors.length - 1;
  const room = roomsOn(b, top).filter((r) => !r.locked && area(r) >= 6).sort((a, c) => area(c) - area(a))[0];
  if (!room) return null;
  const cells = cellsOf(b, top);
  // An inner cell with floor on every side: nothing is cut off by the knot.
  const free = freeCells(b, room);
  const inner = free.filter(([x, y]) => NEXT4.every(([dx, dy]) => cells[I(b, x + dx, y + dy)].k === "open"));
  const spot = rng.pick(inner) || rng.pick(free);
  if (!spot) return null;
  const c = cells[I(b, spot[0], spot[1])];
  c.k = "hivewall"; c.nest = true;
  const power = ((b.setup.enemy && b.setup.enemy.groups) || []).find((g) => g.kind === "zombies")?.power || 3;
  const count = Math.min(N.cap, rng.int(N.count[0], N.count[1]) + Math.floor((n - N.from) * N.more));
  const near = freeCells(b, room).sort((p, q) => Math.hypot(p[0] - spot[0], p[1] - spot[1]) - Math.hypot(q[0] - spot[0], q[1] - spot[1]));
  let zn = b.units.filter((u) => u.kind === "zombie").length, placed = 0;
  for (let i = 0; i < count; i++) {
    const cell = near.shift();
    if (!cell) break;
    const u = enemyUnit(b, rng, "zombies", power, ++zn);
    applyZType(u, kindFn ? kindFn(rng) : "runner", false, power);
    u.f = top; u.away = top !== (b.floor || 0);
    u.x = cell[0]; u.y = cell[1]; u.home = [cell[0], cell[1]];
    u.aware = false; u.nesting = true; u.pod = 700;
    b.units.push(u);
    placed++;
  }
  b.enemyStart = (b.enemyStart || 0) + placed;
  // Nobody has picked over the nest's floor: its containers hold more, gear among it.
  for (const box of R.containers) if ((box.f || 0) === top && box.kind !== "body") box.rich = N.rich;
  clearLos(b, top);
  return { room: room.id, f: top, x: spot[0], y: spot[1], count: placed, awake: false };
}
// Wakes the nest (Heat, or the card's log line when noise did it).
export function wakeNest(b, why) {
  const N = b.raid && b.raid.folk && b.raid.folk.nest;
  let n = 0;
  for (const u of b.units) if (u.nesting && !u.aware && activeAny(u)) { u.aware = true; n++; }
  if (N) N.awake = true;
  if (n && why) say(b, why, "danger");
  return n;
}

// Survivors barricaded in an upper-floor room with one door (not the nest's floor).
function barricadeSurvivors(state, b) {
  const rng = state.rng, R = b.raid, S = FOLK.SURVIVORS;
  const nestF = R.folk.nest ? R.folk.nest.f : -1;
  const cand = [];
  for (let f = 1; f < b.floors.length; f++) {
    if (f === nestF) continue;
    for (const r of roomsOn(b, f)) if (!r.locked && !r.hub && !r.entry && r.doors && r.doors.length === 1 && area(r) >= 4 && !roomUsed(b, r) && !stairsIn(b, r) && freeCells(b, r).length >= 2) cand.push(r);
  }
  // A room a scene left barricaded with nobody dead inside first (interiorscenes.js: area.scene.alive), then an empty
  // room, then the higher one (people fled upward).
  const held = (r) => (r.scene && r.scene.alive ? 1 : 0);
  cand.sort((a, c) => held(c) - held(a) || unitsIn(b, a).length - unitsIn(b, c).length || (c.f || 0) - (a.f || 0));
  const room = cand[0];
  if (!room) return null;
  const f = room.f || 0;
  // The dead already in it were never behind the barricade: out onto the floor.
  for (const u of unitsIn(b, room)) {
    const spots = roomsOn(b, f).filter((r) => r !== room && !r.locked).flatMap((r) => freeCells(b, r));
    const spot = rng.pick(spots);
    if (spot) { u.x = spot[0]; u.y = spot[1]; u.home = spot.slice(); u.wp = null; }
  }
  const g = newNeutralGroup(state, b.tileId, rng);
  const people = g.people.map((s) => ({
    kit: "survivors", weapon: s.gear.weapon && WEAPONS[s.gear.weapon.key] ? s.gear.weapon.key : "fists", power: S.power, name: s.name,
    hp: s.health < 60 ? Math.round(40 + s.health * 0.4) : undefined,
  }));
  const grp = { side: "neutral", kind: "neutral", people, room: room.id, aware: false, name: "the survivors upstairs", wid: g.wid };
  const before = new Set(b.units);
  placeOccupantGroups(state, b, [grp]);
  const units = b.units.filter((u) => !before.has(u));
  for (const u of units) u.folk = "survivors";
  // The door, barricaded from inside: furniture piled against it. Their room's containers are theirs (the bot leaves them).
  const cells = cellsOf(b, f);
  const doors = room.doors.map((d) => d.slice());
  for (const [x, y] of doors) { const c = cells[I(b, x, y)]; c.k = "door"; c.hp = c.mhp = BMAP.DOOR[S.door]; c.barred = true; delete c.roll; delete c.under; delete c.boards; delete c.frame; delete c.moved; } // a scene's boards or piece in the frame: their barricade now
  for (const box of R.containers) if ((box.f || 0) === f && box.area === room.id) { box.barred = true; box.botSkip = true; }
  clearLos(b, f);
  return { room: room.id, f, doors, wid: g.wid, mood: g.mood, names: g.people.map((s) => s.name), count: units.length, met: false, state: "holding" };
}

// The raiders: better armed deeper in; upstairs (offices, apartments, police) with a watcher by the stairs below; their stash.
function holeUpRaiders(state, b, n, up) {
  const rng = state.rng, R = b.raid, K = FOLK.RAIDERS;
  const raiders = b.units.filter((u) => u.side === "enemy" && u.kind === "human" && u.kit === "raiders" && !u.occupant && !u.party && standing(u)); // party: another group's people passing through (parley.js)
  if (!raiders.length) return null;
  if (n >= K.strongFrom) {
    const p = Math.min(K.strongMax, K.strongPer * (n - K.strongFrom + 1));
    // (the list's pick, kitPick, decides who is upgraded: the gun they hold may be another of its band, gundist.js)
    for (const u of raiders) if (!KITS.raiders.strong.includes(u.kitPick || u.weapon) && rng.chance(p)) { u.kitPick = rng.pick(KITS.raiders.strong); u.weapon = swapGun("kit:raiders", u.kitPick, rng); u.weaponName = WEAPONS[u.weapon].name; }
  }
  if (n >= K.armorFrom) {
    const p = Math.min(K.armorMax, K.armorPer * (n - K.armorFrom + 1));
    for (const u of raiders) if (!u.armorKey && rng.chance(p)) { u.armorKey = "vest"; u.armor = 1 - GEAR.vest.power * 0.06; }
  }
  let room = null, watcher = false;
  if (up) {
    const cand = [];
    for (let f = 1; f < b.floors.length; f++) {
      if (R.folk.nest && f === R.folk.nest.f) continue;
      for (const r of roomsOn(b, f)) if (!r.locked && !r.hub && !r.entry && area(r) >= 6 && !roomUsed(b, r) && !stairsIn(b, r) && freeCells(b, r).length >= raiders.length + 1) cand.push(r);
    }
    // The biggest room on the lowest upper floor: they want the stairs near.
    cand.sort((a, c) => (a.f || 0) - (c.f || 0) || area(c) - area(a));
    room = cand[0] || null;
  }
  let stash = null;
  if (room) {
    const f = room.f || 0;
    stash = makeStash(state, b, room, n); // before the raiders take its cells: a wall spot for the crate (with them on it a small room had none)
    const home = [room.x0 + Math.floor(room.w / 2), room.y0 + Math.floor(room.h / 2)];
    for (const u of raiders) {
      const c = rng.pick(freeCells(b, room));
      if (!c) break;
      u.x = c[0]; u.y = c[1]; u.f = f; u.away = f !== (b.floor || 0); u.home = home.slice(); u.wp = null;
    }
    if (raiders.length > 1) {
      // (A flag, not his id: restoreBuilding renumbers units when the team comes back in; the unit carries u.watcher.)
      const w = raiders[raiders.length - 1];
      const c = rng.pick(stairSide(b, f - 1));
      if (c) { w.x = c[0]; w.y = c[1]; w.f = f - 1; w.away = (f - 1) !== (b.floor || 0); w.home = c.slice(); w.watcher = true; watcher = true; }
    }
  }
  const lead = raiders[0];
  const stashRoom = room || roomAt(b, lead.f || 0, lead.home ? lead.home[0] : lead.x, lead.home ? lead.home[1] : lead.y) || roomAt(b, lead.f || 0, lead.x, lead.y);
  if (!room && stashRoom) stash = makeStash(state, b, stashRoom, n);
  squattersUp(state, b, n, stashRoom);
  return { room: stashRoom ? stashRoom.id : null, f: stashRoom ? stashRoom.f || 0 : 0, up: !!room, watcher, stash: stash ? stash.id : null, count: raiders.length };
}
// Armed squatters the wanderers brought in (buildingmaps.js placeOccupantGroups, u.occupant "hostile") who hold an
// upper-floor room (wanderers.js interiorOccupants puts them there in offices, flats and police stations): a watcher
// by the stairwell below and a stash in their room, like the raiders.
function squattersUp(state, b, n, except) {
  const rng = state.rng;
  const pods = new Map();
  for (const u of b.units) if (u.side === "enemy" && u.kind === "human" && u.occupant === "hostile" && standing(u) && (u.f || 0) > 0) (pods.get(u.pod) || pods.set(u.pod, []).get(u.pod)).push(u);
  for (const list of pods.values()) {
    const u0 = list[0];
    const room = roomAt(b, u0.f || 0, u0.home ? u0.home[0] : u0.x, u0.home ? u0.home[1] : u0.y) || roomAt(b, u0.f || 0, u0.x, u0.y);
    if (!room || room === except || roomUsed(b, room)) continue;
    const f = room.f || 0;
    if (list.length > 1 && !list.some((u) => u.watcher)) {
      const w = list[list.length - 1];
      const c = rng.pick(stairSide(b, f - 1));
      if (c) { w.x = c[0]; w.y = c[1]; w.f = f - 1; w.away = (f - 1) !== (b.floor || 0); w.home = c.slice(); w.watcher = true; }
    }
    if (!b.raid.containers.some((x) => x.stash && x.area === room.id)) makeStash(state, b, room, n);
  }
}
// The raiders' stash: a crate against the room's wall (three open sides, so nothing is cut off), its contents rolled now.
function makeStash(state, b, room, n) {
  const rng = state.rng, R = b.raid, K = FOLK.RAIDERS.stash;
  const f = room.f || 0, cells = cellsOf(b, f);
  const spots = freeCells(b, room).filter(([x, y]) => {
    const nb = NEXT4.map(([dx, dy]) => cells[I(b, x + dx, y + dy)]);
    return nb.filter((c) => c.k === "wall").length === 1 && nb.filter((c) => c.k === "open").length === 3 && !R.containers.some((c) => (c.f || 0) === f && Math.abs(c.x - x) + Math.abs(c.y - y) <= 1);
  });
  const spot = rng.pick(spots);
  if (!spot) return null;
  cells[I(b, spot[0], spot[1])].k = "crate";
  const kit = KITS.raiders;
  const sup = { ammo: rng.int(K.ammo[0], K.ammo[1]), food: rng.int(K.food[0], K.food[1]), water: rng.int(K.water[0], K.water[1]) };
  sortFind(sup, "raider", "stash", room.id, f, spot[0], spot[1]); // ammo.js: the raiders' rounds, by calibre
  const gear = [];
  const g = rng.int(K.gear[0], K.gear[1]) + Math.floor(n / K.perBlocks);
  for (let i = 0; i < g; i++) gear.push(lootItem(swapGun("body:raiders", rng.pick(kit.loot), rng), "raider", spend(rng))); // itemcond.js: raiders' kit; gundist.js: which gun
  if (rng.chance(K.finds)) gear.push(lootItem(rng.pick(kit.finds), "raider", rng));
  const id = Math.max(0, ...R.containers.map((x) => x.id || 0)) + 1;
  const box = { id, x: spot[0], y: spot[1], f, area: room.id, kind: "crate", searched: false, label: `${room.name}: raiders' stash`, stash: true, contents: { sup, gear } };
  R.containers.push(box);
  return box;
}

// ---------- during the raid (combat.js: after a player's action, at the start of each player turn) ----------
export function folkTick(state, b) {
  const R = b.raid, F = R && R.folk;
  if (!F || b.over) return;
  const S = F.survivors;
  if (S && !S.met && S.state === "holding") {
    const mine = b.units.filter((u) => u.side === "player" && activeAny(u) && (u.f || 0) === S.f);
    if (mine.length) {
      const atDoor = mine.some((u) => S.doors.some(([x, y]) => Math.max(Math.abs(u.x - x), Math.abs(u.y - y)) <= 1));
      let seen = false;
      if (!atDoor) {
        const theirs = b.units.filter((u) => u.folk === "survivors" && u.side === "third" && activeAny(u));
        const view = b.floor || 0;
        if (view !== S.f) setFloor(b, S.f);
        seen = mine.some((u) => theirs.some((t) => canSee(b, u, t)));
        if ((b.floor || 0) !== view) setFloor(b, view);
      }
      if (atDoor || seen) { S.met = true; survivorCard(state, b, S, atDoor); }
    }
  }
  const N = F.nest;
  if (N && !N.awake) {
    if (R.heat >= FOLK.NEST.heat) wakeNest(b, "The Heat has reached the top floor: something stirs up there.");
    else if (b.units.some((u) => u.nesting && u.aware && activeAny(u))) { N.awake = true; say(b, "The nest on the top floor is stirring.", "danger"); }
  }
}

// ---------- the card ----------
const MOOD = {
  wary: "They sound tired and very careful.",
  friendly: "One of them laughs, shakily: \"Living people. Hell.\"",
  desperate: "They sound half-starved; the voice cracks.",
};
const lookOf = (n) => (n === 1 ? "one person" : n === 2 ? "two people" : `${["", "", "", "three", "four", "five", "six"][n] || n} people`);
function survivorCard(state, b, S, atDoor, again = false) {
  const p = state.parties.find((x) => x.id === b.setup.partyId);
  if (!p) return;
  const g = groupById(state, S.wid);
  const room = b.raid.areas.find((a) => a.id === S.room);
  const where = `${room ? room.name : "a room"} ${onFloor(b, S.f)}`;
  const live = (fn) => (st) => (st.combat === b && !b.over ? fn(st) : "Too late: the building is behind you.");
  const text = again
    ? `${names(S.names)} ${S.names.length === 1 ? "waits" : "wait"} behind the barricade in ${where}.${S.state === "talked" ? " You have talked." : " They want nothing to do with you."}`
    : atDoor
      ? `The door of ${where} is barricaded from inside: furniture piled against it. A voice behind it: "Don't try it. We're armed." ${S.count === 1 ? "One person holds" : `${lookOf(S.count)} hold`} the room: ${S.names.join(", ")}. ${MOOD[S.mood] || ""}`
      : `People in ${where}: ${S.names.join(", ")}, holed up behind a barricaded door. They have seen you too. "Don't try it. We're armed." ${MOOD[S.mood] || ""}`;
  const talk = g ? talkChance(state, p, g) : 0.3;
  const join = joinChance(state, p, S);
  const armed = b.units.filter((u) => u.folk === "survivors" && activeAny(u) && WEAPONS[u.weapon] && !WEAPONS[u.weapon].melee).length;
  const choices = [];
  if (!again) choices.push({
    label: "Talk to them", hint: `Speech: about ${pct(talk)} they talk through the door. They know this floor (the dead marked on the map, the places to search); people who are not desperate spare a little food and water`,
    ai: () => 1, resolve: live((st) => talkTo(st, b, S, g, p, talk)),
  });
  choices.push({
    label: "Ask them to join", hint: `Leadership, and they are ${S.mood}${S.state === "talked" ? " and have talked with you" : ""}: about ${pct(join)} they take the back stairs down and wait for you on the street (the recruit card when you are out). Otherwise they hold out here`,
    ai: () => 0.6, resolve: live((st) => askThem(st, b, S, p, join)),
  });
  choices.push({
    label: "Leave them be", hint: "They keep their room and their door. Nobody shoots", ai: () => 0.3,
    resolve: live(() => { S.state = "left"; say(b, `You leave ${S.names.length === 1 ? first(S.names[0]) : "them"} to it.`, "info"); return "You leave them to it."; }),
  });
  choices.push({
    label: "Force the door", hint: `Break the barricade down and go in: they fight back, and ${armed ? `${armed} gun${armed === 1 ? "" : "s"} fire${armed === 1 ? "s" : ""}` : "they fight"} first. What they have is yours after`,
    ai: () => 0, resolve: live((st) => forceDoor(st, b, S)),
  });
  addCard(state, { title: again ? "The survivors upstairs" : "Survivors barricaded upstairs", text, where: b.place, partyId: p.id, battle: true, folk: "survivors", choices });
}
function joinChance(state, p, S) {
  const J = FOLK.SURVIVORS.join;
  return clamp(J.base + J.perLead * bestSkill(state, p, "leadership") + (J.mood[S.mood] || 0) + (S.state === "talked" ? J.talked : 0) + (S.state === "refused" ? J.refused : 0), 0.05, J.max);
}
function talkTo(st, b, S, g, p, chance) {
  const who = talker(st, p);
  const met = () => { if (g) { g.talked = true; g.met += 1; g.lastMet = st.hour; } };
  if (st.rng.chance(chance)) {
    if (who) gainXp(st, who, "speech", USE.talk + USE.talkWon);
    met();
    S.state = "talked";
    const told = tellFloor(b, S);
    let gift = "";
    if (S.mood !== "desperate") {
      const G = FOLK.SURVIVORS.gift;
      const u = b.units.filter((x) => x.side === "player" && activeAny(x) && (x.f || 0) === S.f).sort((a, c) => doorDist(S, a) - doorDist(S, c))[0] || b.units.find((x) => x.side === "player" && activeAny(x));
      if (u) {
        const food = st.rng.int(G.food[0], G.food[1]), water = st.rng.int(G.water[0], G.water[1]);
        const h = haulOf(u);
        h.sup.food = (h.sup.food || 0) + food; h.sup.water = (h.sup.water || 0) + water;
        b.raid.found.food = (b.raid.found.food || 0) + food; b.raid.found.water = (b.raid.found.water || 0) + water;
        gift = ` They pass ${food} days of food and ${water} water out through a gap in the barricade; ${first(u.name)} takes it.`;
      }
    }
    say(b, `They talk, through the door. ${told}${gift}`, "good");
    survivorCard(st, b, S, true, true); // and then: ask them along, or leave them to it
    return `They talk. ${told}${gift}`;
  }
  if (who) gainXp(st, who, "speech", USE.talk);
  met();
  S.state = "refused";
  say(b, `"Walk on." They want nothing to do with you.`, "info");
  survivorCard(st, b, S, true, true);
  return "They want nothing to do with you. The door stays barred.";
}
const doorDist = (S, u) => Math.min(...S.doors.map(([x, y]) => Math.hypot(u.x - x, u.y - y)));
// What they know of their floor: the dead on it marked on the map (last-seen ghosts), the places to search named.
function tellFloor(b, S) {
  const R = b.raid, f = S.f;
  const dead = b.units.filter((u) => u.side === "enemy" && (u.f || 0) === f && activeAny(u));
  const g = b.ghosts || (b.ghosts = {});
  for (const e of dead) g[e.id] = [e.x, e.y, b.turn, f];
  const boxes = R.containers.filter((c) => (c.f || 0) === f && c.kind !== "body" && !c.searched && !c.barred);
  for (const c of boxes) c.known = true;
  const rooms = [...new Set(boxes.map((c) => R.areas[c.area] && R.areas[c.area].name))].filter(Boolean).slice(0, 5);
  const locked = roomsOn(b, f).filter((r) => r.locked).length;
  return `What they know of ${/^floor \d/.test(floorName(b, f)) ? floorName(b, f) : `the ${floorName(b, f)}`}: ${boxes.length} place${boxes.length === 1 ? "" : "s"} to search${rooms.length ? ` (${rooms.join(", ")})` : ""}, ${dead.length ? `${dead.length} of the dead about (marked on the map)` : "none of the dead about"}${locked ? `, ${locked === 1 ? "a locked room" : `${locked} locked rooms`}` : ""}.`;
}
function askThem(st, b, S, p, chance) {
  const lead = [...partyMembers(st, p)].sort((a, c) => skill(c, "leadership") - skill(a, "leadership") || a.id - c.id)[0];
  const n = S.names.length;
  if (st.rng.chance(chance)) {
    if (lead) gainXp(st, lead, "leadership", USE.talk + USE.talkWon);
    S.state = "joining";
    for (const u of b.units) if (u.folk === "survivors" && activeAny(u)) { u.left = true; u.ap = 0; }
    const line = `${names(S.names)} ${n === 1 ? "takes" : "take"} the back stairs down with what ${n === 1 ? "they" : "they"} can carry: ${n === 1 ? "they" : "they"} will wait for you on the street.`;
    say(b, line, "good");
    return line;
  }
  if (lead) gainXp(st, lead, "leadership", USE.talk);
  S.state = "stay";
  say(b, `They would rather hold out here. "We've made it this far."`, "info");
  return "They would rather hold out where they are.";
}
// The barricade comes down: the group turns on you (thirdside.js) and whoever has a gun fires first.
function forceDoor(st, b, S) {
  const R = b.raid, f = S.f;
  const cells = cellsOf(b, f);
  for (const [x, y] of S.doors) { const c = cells[I(b, x, y)]; if (c.barred) { c.k = "doorway"; c.hp = 0; delete c.barred; } }
  for (const box of R.containers) if (box.barred) { delete box.barred; delete box.botSkip; }
  clearLos(b, f);
  S.state = "forced";
  const theirs = b.units.filter((u) => u.folk === "survivors" && u.side === "third" && activeAny(u));
  const mine = b.units.filter((u) => u.side === "player" && activeAny(u) && (u.f || 0) === f).sort((a, c) => doorDist(S, a) - doorDist(S, c));
  const by = mine[0] || b.units.find((u) => u.side === "player" && activeAny(u));
  if (theirs.length && by) thirdSideHit(b, theirs[0], by);
  const view = b.floor || 0;
  if (view !== f) setFloor(b, f);
  let shots = 0;
  for (const a of theirs) {
    if (!active(a) || !WEAPONS[a.weapon] || WEAPONS[a.weapon].melee) continue;
    const t = mine.filter((x) => active(x) && canSee(b, a, x)).sort((x, y) => Math.hypot(x.x - a.x, x.y - a.y) - Math.hypot(y.x - a.x, y.y - a.y))[0];
    if (!t) continue;
    fire(b, a, t);
    shots++;
  }
  if ((b.floor || 0) !== view) setFloor(b, view);
  say(b, `The barricade comes down.${shots ? ` ${shots} shot${shots === 1 ? "" : "s"} come through the doorway before anyone is in.` : " Nobody inside has a gun to meet you with."}`, "danger");
  return shots ? `The barricade comes down; they fire first (${shots} shot${shots === 1 ? "" : "s"}).` : "The barricade comes down. They fight back.";
}

// ---------- after the raid (citycrawl.js afterPlace) ----------
// The survivors who agreed to come: the recruit card for the team, on the street.
export function folkAfterPlace(state, p, b) {
  const F = b && b.raid && b.raid.folk;
  const S = F && F.survivors;
  if (!S || S.state !== "joining") return null;
  S.state = "offered";
  const g = groupById(state, S.wid);
  const list = g ? g.people.filter((s) => !s.dead && s.alive !== false) : [];
  if (!list.length) return null;
  for (const s of list) { s.pending = true; delete s.gone; }
  if (g) { g.met += 1; g.lastMet = state.hour; if (p.crawl) g.tile = p.crawl.tile; }
  const n = list.length;
  return offerRecruits(state, list, {
    source: "crawl", partyId: p.id,
    title: n === 1 ? `${first(list[0].name)} waits on the street` : "They wait for you on the street",
    intro: `${names(list.map((s) => s.name))} came down from ${/^floor \d/.test(floorName(b, S.f)) ? floorName(b, S.f) : `the ${floorName(b, S.f)}`} with ${n === 1 ? "a bag" : "their bags"} and ${n === 1 ? "waits" : "wait"} by the door.`,
  });
}

// ---------- the bots (combat.js autoRaidTurn) and the end of a battle (finishCombat) ----------
// A card raised over the fight is answered by its choices' ai weights (the raid bot cannot click).
export function resolveBattleCards(state) {
  let n = 0;
  for (let guard = 0; guard < 10; guard++) {
    const i = state.cards.findIndex((c) => c && c.battle);
    if (i < 0) break;
    const card = state.cards.splice(i, 1)[0];
    const opts = card.choices.filter((c) => !(typeof c.disabled === "function" ? c.disabled(state) : c.disabled));
    const weight = (c) => (typeof c.ai === "function" ? c.ai(state) : c.ai || 0);
    const pick = opts.sort((a, c) => weight(c) - weight(a))[0];
    if (pick) pick.resolve(state);
    n++;
  }
  return n;
}
// The fight is over: a card about it has nothing to ask any more.
export function dropBattleCards(state) {
  if (!state.cards) return;
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i] && state.cards[i].battle) state.cards.splice(i, 1);
}
