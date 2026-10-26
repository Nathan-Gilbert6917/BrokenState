// @ts-check
// A camp inside a POI: its rooms Cleared or Not cleared, the dead kept per room, Defend waves out of the rooms, and
// the way out (the heat epic #64 §4 "Rooms are Cleared or Not cleared" and "Cut off", issue #71; the user's request
// 2026-10-26: "Add the fog rule, cleared and not cleared rooms for use in defend zombie wave events and for when you
// actively go back into the map to clear the zombies. … getting encircled. The survivors cannot leave if they are
// encircled with the camp. Let's say we are in a building and we are on the second floor but we are running from
// zombies in the first floor and set up camp in the second floor how do we handle this? … how do we determine if they
// are able to leave so we can block some base actions like gathering etc as they can't leave the raid."; the rules
// confirmed the same day, climbing out and arrivals fighting in among them).
//
// ZONES (zonesOf, the camp's record base.poiCamp, poicamp.js): every room of the POI's building on every floor (P.rm;
// an older record, before #71, only the camp floor's P.rooms) and the yard's open areas: the ground floor's cells
// outside the rooms in blocks of YARD_BLOCK × YARD_BLOCK ("the yard (north-west)"). A cell inside a room (off its
// walls) is that room's; a room's wall line (its doors and gaps) and an upper floor's cells outside every room belong
// to no zone (a threshold: passable when seen).
// CLEARED OR NOT CLEARED (roomState, no threat number): Cleared when the room is seen (SEEN_SHARE of its floor seen by
// your side, or cleared in a fight by the numbers: P.cz) and holds none of the dead (P.zd); Not cleared when it is
// fogged or the dead are seen or known in it. Builds and fittings go only in Cleared rooms and on seen, empty yard
// (poicamp.js poiPlaceWhy; build mode on the raid map; a build site in a room that turns Not cleared stops, its progress
// kept; a queued build there waits: buildings.js constructionHour).
// THE DEAD PER ROOM (P.zd = { zone id: n }, syncRooms): the POI's surviving dead (deadpop.js poiDead) live in its Not
// cleared rooms and always sum to it: read, the rooms are put right against the pool. More in the pool than in the
// rooms (a daily refill, the tile's trickle that broke in, a wave that got in) go into the Not cleared rooms nearest the
// map's edge first, each up to HOLD (a dead a HOLD_CELLS cells of its floor, at least HOLD_MIN) before the next, never
// into the camp's own room while any other will do; fewer (kills by the numbers, another group's raid) come off the
// rooms holding the most. Kills in a fight come off the very rooms they came out of (roomsKilled). Settling in, the dead
// left on the map go into the rooms they stand in (deadFromMap).
// DEFEND WAVES OUT OF THE ROOMS (roomWave, campattack.js waveSource): the grounds' part of a wave comes out of the Not
// cleared rooms by their route to the camp (a search over the floors joined by their stairs): an open route first; a
// shut or barricaded door on the way (a closed, barred or locked door, boards, a barricade) costs DOOR steps and lets
// out at most DOOR_SLOW of that room's dead in one wave (at least 1). The wave records its rooms (w.rooms); on the camp's
// map (fort.js fortDefence → placeFromRooms) those dead start in their rooms (a room on another floor: at the stairs),
// the tile's trickle at the edges. The kills come off their rooms (settleWave → roomsKilled); a fight lost lets the
// trickle's survivors in (into the POI: Not cleared rooms nearest the edge).
// GOING BACK IN: any raid on the camp's POI map (Clear the dead from the base grounds, a team fighting its way in, a
// raid on the place) opens it with the rooms as they stand (poicamp.js poiCampRaidStart → roomsOnRaid: the POI's dead
// on the map put in their rooms); what your people see is kept, the dead killed come off their rooms, and the team can
// leave at any time keeping what it cleared (poiCampAfterRaid → roomsAfterRaid). Headless (a fight by the numbers) the
// kills come off the rooms on the blocked route first, and a room emptied that way counts as seen (P.cz).
// THE WAY OUT (wayOut, cached as P.way = { open, climb, through, why ("dead known" or "fogged"), h }): a walkable route from the camp's 5 × 5 to an exit
// (any map edge cell of the ground floor, or a ground-floor door or gap to the outside) through Cleared rooms, seen
// thresholds and seen, empty yard only; a breadth-first search over the floors joined by their stairs. Without a route,
// a climb: a window from a reached cell onto seen, empty ground (an upper floor's window needs a rope, a siege ladder or
// knotted sheets: a bed at the camp; a ground-floor window is vaulted), which counts for people on foot but not for
// furniture, heavy loads or vehicles (way.climb). `through` names the Not cleared room on the nearest walkable route.
// Worked out when the camp is done, after every grounds attack, after every clearing fight (and Break out, and a team
// fighting in) and after the daily recalculation (poiRoomsDaily) — never every hour; the cache is read otherwise. A
// change says so in the log and on a card ("Way out: cut off" / "Way out: open").
// CUT OFF (cutOffWhy): the camp still stands; its people rest, eat, craft, cook, build and place fittings in Cleared
// rooms, barricade and fight the waves. Blocked, greyed with "Cut off: the way out runs through <room> (dead known)":
// the land jobs out of the map (wood, forage, hunt, fish, stone, water, scavenging: their *WorkWhy, so the activity line
// and the governor skip them), hauling (hauling.js), every team leaving (parties.js launchExpedition: teams, supply
// runs, Hunt the dead, field works, the governor's trips). A climb out lets people on foot go (the land jobs, a team on
// foot) but not a vehicle or hauling. Felling marked on the camp's own map is not leaving it and goes on.
// ARRIVALS (fightIn, parties.js returnHome): a team coming home to a cut-off camp fights its way in: in the browser a
// raid on the POI map from the edge (Settle in once safe moves it in; the camp counts as standing on that map); headless
// a fight by the numbers against the dead on the blocked route (handler "poiFightIn"), then home.
// BREAK OUT (breakOut, a camp order: the Camp tab's button, the governor when cut off with fighters home): a fight on the
// camp's map with whoever is home at the camp against the dead of the rooms on the blocked route (handler
// "poiBreakOut"), to fight a route open.
// THE AI (docs/adr/0001): the same functions read any base with a poiCamp record; the governor (autopilot.js) obeys the
// blocks through the same checks and breaks out when cut off. The AI groups set up no POI camps of their own (#70 gave
// them none), so nothing of theirs is ever cut off.
// SAVES: P.zd, P.cz, P.way, and (#71's snapshot, P.v 2) P.rm, P.fl, P.seenF, P.stairs are plain data on base.poiCamp; a
// record from before #71 (v 1: the camp's floor only) has its rooms seeded from the pool on first read (deterministic:
// by the edge order) and its stairs counted as exits (the floor below was never kept).
// Deterministic: no dice outside battles (orders by distance and id).
/** @import { State } from "./types" */
import { CELL, startCombat, registerCombatHandler, say } from "./combat.js"; // (call-time only)
import { poiDead, killDead, putBack, drawFromTile } from "./deadpop.js"; // (call-time only)
import { log, addCard, atBase, homeAt } from "./world.js"; // (call-time only)
import { poiCellAt, poiSeenMask, unseenRle, seenRle, isPoiCamp, POICAMP } from "./poicamp.js"; // (call-time only)
import { takeDead } from "./campscout.js"; // (call-time only)
import { fightNow } from "./defences.js"; // (call-time only)
import { siteThreat } from "./siteclear.js"; // (call-time only)
import { partyMembers, awaitOrders, startReturn, teamName } from "./parties.js"; // (call-time only)
import { startScavenge } from "./scavenge.js"; // (call-time only)

export const POIROOMS = {
  SEEN_SHARE: 0.6,   // a room (or a yard block) is seen when this share of its floor is seen
  YARD_BLOCK: 8,     // the yard's open areas: blocks of this many cells a side
  HOLD_CELLS: 6,     // a room takes one of the dead a HOLD_CELLS cells of its floor before the next room takes them
  HOLD_MIN: 2,
  DOOR: 8,           // a shut or barricaded door on a wave's route: this many steps more
  DOOR_SLOW: 0.5,    // at most this share of a room's dead come out through a shut door in one wave (at least 1)
  FIGHT_MAX: 20,     // the most in a Break out or a fight in (a battle's most)
  V: 2,              // base.poiCamp's record version with every floor (poicamp.js snapshot)
  WAY_OPEN: "Way out: open", WAY_CUT: "Way out: cut off", BREAK: "Break out",
};
const Q = POIROOMS;
// Cells people get through on the way out: walkable, or a door or barricade of their own they open or pull down.
const PEOPLE_THROUGH = new Set(["barricade", "boarded"]);
// A shut door on a wave's route (the dead batter it): closed, barred, locked, boarded, barricaded.
const SHUT = new Set(["idoor", "bdoor", "door", "boarded", "barricade"]);
const WINDOWS = new Set(["window", "smashed"]);
const STAIRS = (k) => k === "stairs";

// ---------- the record's floors ----------
/** One floor's cells as a palette and a char a cell (the snapshot's own packing). @param {any[]} cells */
export function packFloor(cells) {
  const pal = [], idx = new Map();
  let s = "";
  for (const c of cells) {
    const key = `${c.k}|${c.f || ""}|${c.mhp || ""}|${c.h ?? ""}|${c.ter ? 1 : ""}`;
    let i = idx.get(key);
    if (i == null) { i = pal.length; pal.push(key); idx.set(key, i); }
    s += String.fromCharCode(48 + i);
  }
  return { pal, cells: s };
}
/** The floors the record knows: the camp's floor, and (#71) the others. @param {any} P */
export const floorsOf = (P) => [...new Set([P.f || 0, ...Object.keys(P.fl || {}).map(Number)])].sort((a, c) => a - c);
const hasFloor = (P, f) => f === (P.f || 0) || !!(P.fl && P.fl[f]);
/** The kind of cell (x, y) on floor f ("" off the map or an unknown floor). @param {any} P @param {number} f @param {number} x @param {number} y */
export function kindAt(P, f, x, y) {
  if (x < 0 || y < 0 || x >= P.w || y >= P.h) return "";
  if (f === (P.f || 0)) { const c = poiCellAt(P, x, y); return c ? c.k : ""; }
  const F = P.fl && P.fl[f];
  if (!F) return "";
  const code = F.cells.charCodeAt(y * P.w + x) - 48;
  return String(F.pal[code] || "open").split("|")[0];
}
const seenCache = new Map();
/** What your side has seen of floor f (0/1 a cell). @param {any} P @param {number} f */
export function seenOn(P, f) {
  if (f === (P.f || 0)) return poiSeenMask(P);
  const s = (P.seenF && P.seenF[f]) || "";
  const key = `${P.w}x${P.h}:${s}`;
  let a = seenCache.get(key);
  if (!a) { a = unseenRle(s, P.w * P.h); if (seenCache.size > 64) seenCache.clear(); seenCache.set(key, a); }
  return a;
}

// ---------- the zones ----------
const zoneCache = new WeakMap();
// The building's rooms on every floor the record knows.
const roomsList = (P) => (Array.isArray(P.rm) ? P.rm : (P.rooms || []).map((r) => ({ ...r, f: P.f || 0 })));
const DIRS = [["north-west", "north", "north-east"], ["west", "middle", "east"], ["south-west", "south", "south-east"]];
/**
 * The record's zones: { list: [{ id, f, kind: "room" | "yard", name, cells: [index], edge (cells to the map's edge),
 * n (its floor's cells) }], at: { [f]: Int32Array } (a cell's zone index; −1 none, −2 a room's wall line) }.
 * @param {any} P
 */
export function zonesOf(P) {
  const key = `${P.w}x${P.h}:${roomsList(P).length}:${floorsOf(P).join(",")}`;
  const c = zoneCache.get(P);
  if (c && c.key === key) return c.Z;
  const W = P.w, H = P.h, N = W * H, list = [], at = {};
  for (const f of floorsOf(P)) at[f] = new Int32Array(N).fill(-1);
  const edgeOf = (x, y) => Math.min(x, y, W - 1 - x, H - 1 - y);
  for (const r of roomsList(P)) {
    const f = r.f || 0;
    if (!at[f]) continue;
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) if (x >= 0 && y >= 0 && x < W && y < H && at[f][y * W + x] === -1) at[f][y * W + x] = -2;
  }
  for (const r of roomsList(P)) {
    const f = r.f || 0;
    if (!at[f]) continue;
    const z = { id: `r${f}_${r.x0}_${r.y0}`, f, kind: "room", name: r.name || "a room", cells: [], edge: 1e9, n: 0 };
    const zi = list.length;
    for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (at[f][i] >= 0) continue; // two rooms over one cell: the first keeps it
      at[f][i] = zi; z.cells.push(i); z.edge = Math.min(z.edge, edgeOf(x, y));
    }
    if (!z.cells.length) continue;
    z.n = z.cells.length;
    list.push(z);
  }
  // The yard: the ground floor's open ground outside the rooms, in blocks.
  if (at[0]) {
    const B = Q.YARD_BLOCK, by = new Map();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (at[0][i] !== -1) continue;
      const k = kindAt(P, 0, x, y);
      if (!k || k === "void" || !CELL[k] || (!CELL[k].walk && !PEOPLE_THROUGH.has(k))) continue;
      const bk = `${Math.floor(x / B)}_${Math.floor(y / B)}`;
      let z = by.get(bk);
      if (!z) {
        const dir = DIRS[Math.min(2, Math.floor((y / H) * 3))][Math.min(2, Math.floor((x / W) * 3))];
        z = { id: `y${bk}`, f: 0, kind: "yard", name: `the yard (${dir})`, cells: [], edge: 1e9, n: 0, zi: list.length };
        by.set(bk, z); list.push(z);
      }
      at[0][i] = z.zi; z.cells.push(i); z.edge = Math.min(z.edge, edgeOf(x, y));
    }
    for (const z of by.values()) { z.n = z.cells.length; delete z.zi; }
  }
  const Z = { list, at, byId: new Map(list.map((z) => [z.id, z])) };
  zoneCache.set(P, { key, Z });
  return Z;
}
/** The zone of cell (x, y) on floor f, or null. @param {any} P @param {number} f @param {number} x @param {number} y */
export function zoneAt(P, f, x, y) {
  const Z = zonesOf(P), a = Z.at[f];
  if (!a || x < 0 || y < 0 || x >= P.w || y >= P.h) return null;
  const zi = a[y * P.w + x];
  return zi >= 0 ? Z.list[zi] : null;
}
const deadIn = (P, z) => Math.max(0, (P.zd && P.zd[z.id]) || 0);
/** Has your side seen this zone (SEEN_SHARE of it, or cleared it in a fight by the numbers)? @param {any} P @param {any} z */
export function zoneSeen(P, z) {
  if (Array.isArray(P.cz) && P.cz.includes(z.id)) return true;
  const s = seenOn(P, z.f);
  let n = 0;
  for (const i of z.cells) if (s[i]) n++;
  return n >= Math.max(1, Math.ceil(z.n * Q.SEEN_SHARE));
}
/** "cleared" or "not" (fogged, or the dead seen or known there). @param {any} P @param {any} z */
export const roomState = (P, z) => (zoneSeen(P, z) && !deadIn(P, z) ? "cleared" : "not");
/** Every zone with its state and its dead: [{ id, f, kind, name, state, dead }]. @param {any} state @param {any} base */
export function roomsView(state, base) {
  if (!isPoiCamp(base)) return [];
  syncRooms(state, base);
  const P = base.poiCamp;
  return zonesOf(P).list.map((z) => ({ id: z.id, f: z.f, kind: z.kind, name: z.name, state: roomState(P, z), dead: deadIn(P, z), seen: zoneSeen(P, z) }));
}
/**
 * The camp's base map view (basemap.js viewBattle): the cells of Not cleared rooms and of the yard with the dead tinted
 * as no-build ground (c.nb) with the reason (c.nc, the hover). @param {any} b the view @param {any} base
 */
export function markNotCleared(b, base) {
  const P = base.poiCamp, F = b.deployPlan && b.deployPlan.fort;
  if (!P || !F) return 0;
  let n = 0;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const why = cellClearWhy(P, P.f || 0, x - F.ox + P.at[0], y - F.oy + P.at[1]);
    if (!why) continue;
    const c = b.cells[y * b.w + x];
    c.nb = 1; c.nc = why; n++;
  }
  return n;
}
/** Is a cell where a build may go (a Cleared room, or seen, empty yard; a threshold when seen)? "" or why not. */
export function cellClearWhy(P, f, x, y) {
  const z = zoneAt(P, f, x, y);
  if (!z) return "";
  if (z.kind === "yard") return deadIn(P, z) ? `Not cleared: the dead are out in ${z.name}` : "";
  return roomState(P, z) === "cleared" ? "" : `Not cleared: ${z.name} (${deadIn(P, z) ? "dead known" : "fogged"})`;
}
// The camp's own zones: those under its 5 × 5 (kept on the record while it is read: the search asks for every cell).
const campCache = new WeakMap();
function campZones(P) {
  const Z = zonesOf(P), key = `${P.at[0]},${P.at[1]},${P.f || 0}`, c = campCache.get(P);
  if (c && c.key === key && c.Z === Z) return c.set;
  const out = new Set(), h = POICAMP.HALF;
  for (let dy = -h; dy <= h; dy++) for (let dx = -h; dx <= h; dx++) { const z = zoneAt(P, P.f || 0, P.at[0] + dx, P.at[1] + dy); if (z) out.add(z.id); }
  campCache.set(P, { key, Z, set: out });
  return out;
}

// ---------- the dead per room ----------
const holdOf = (z) => Math.max(Q.HOLD_MIN, Math.floor(z.n / Q.HOLD_CELLS));
/** n more of the dead into the zones nearest the map's edge (Not cleared first, never the camp's while others will do). */
function addDead(P, n, only = null) {
  if (!(n > 0)) return;
  const Z = zonesOf(P), camp = campZones(P);
  if (!P.zd) P.zd = {};
  let pool = (only || Z.list).filter((z) => !camp.has(z.id));
  if (!pool.length) pool = only || Z.list;
  if (!pool.length) return;
  const nc = (z) => (roomState(P, z) === "cleared" ? 1 : 0);
  pool = pool.slice().sort((a, c) => nc(a) - nc(c) || a.edge - c.edge || (a.id < c.id ? -1 : a.id > c.id ? 1 : 0));
  for (const z of pool) { if (n <= 0) break; const q = Math.min(n, Math.max(0, holdOf(z) - deadIn(P, z))); if (q > 0) { P.zd[z.id] = deadIn(P, z) + q; n -= q; } }
  for (let i = 0; n > 0; i = (i + 1) % pool.length, n--) P.zd[pool[i].id] = deadIn(P, pool[i]) + 1; // every room full: one each round
}
/** n of the dead off the zones holding the most (ties by id). */
function removeDead(P, n) {
  if (!P.zd) return;
  for (; n > 0; n--) {
    let best = null;
    for (const [id, v] of Object.entries(P.zd)) if (v > 0 && (!best || v > best[1] || (v === best[1] && id < best[0]))) best = [id, v];
    if (!best) break;
    if (best[1] <= 1) delete P.zd[best[0]]; else P.zd[best[0]] = best[1] - 1;
  }
}
/**
 * The rooms put right against the POI's pool (deadpop.js poiDead): the dead per zone always sum to it, and a POI
 * camp's grounds (campscout.js base.grounds) are the same count. Returns the total.
 * @param {any} state @param {any} base
 */
export function syncRooms(state, base) {
  if (!isPoiCamp(base)) return 0;
  const P = base.poiCamp, Z = zonesOf(P);
  if (!P.zd) P.zd = {};
  for (const id of Object.keys(P.zd)) if (!Z.byId.has(id) || !(P.zd[id] > 0)) delete P.zd[id];
  const have = Object.values(P.zd).reduce((a, v) => a + v, 0);
  const want = Math.max(0, Math.round(poiDead(state, base.tile, base.poi) || 0));
  if (have > want) removeDead(P, have - want);
  else if (have < want) addDead(P, want - have);
  if (base.grounds) base.grounds.dead = want;
  else if (want > 0) base.grounds = { dead: want, dead0: want, known: true, blind: false, poi: base.poi, next: state.hour + 6, waves: 0, killed: 0, raids: 0 };
  return want;
}
/** Kills off the rooms they came out of ({ id: n } in order), as many as killed. @param {any} base @param {Record<string, number>} rooms @param {number} killed */
export function roomsKilled(base, rooms, killed) {
  const P = base && base.poiCamp;
  if (!P || !rooms || !(killed > 0)) return 0;
  if (!P.zd) P.zd = {};
  let left = Math.round(killed);
  for (const [id, n] of Object.entries(rooms)) {
    if (left <= 0) break;
    const q = Math.min(left, n, P.zd[id] || 0);
    if (q > 0) { P.zd[id] -= q; if (!(P.zd[id] > 0)) delete P.zd[id]; left -= q; }
  }
  return Math.round(killed) - left;
}
// A zone emptied in a fight by the numbers counts as seen (the team went through it).
function markCleared(P, ids) {
  if (!Array.isArray(P.cz)) P.cz = [];
  for (const id of ids) if (!(P.zd && P.zd[id] > 0) && !P.cz.includes(id)) P.cz.push(id);
}
/**
 * The camp done (poicamp.js foundPoiCamp): the dead on the map go into the rooms they stand in (the rest of the POI's by
 * the edge order); each is tagged with its room, so a kill later in the raid comes off it. @param {any} state @param {any} base @param {any} b the battle
 */
export function deadFromMap(state, base, b) {
  const P = base.poiCamp;
  if (!P || P.zd) return;
  P.zd = {};
  for (const u of b.units || []) {
    if (u.side !== "enemy" || u.kind !== "zombie" || u.dead || u.left || u.fled) continue;
    const z = zoneAt(P, u.f || 0, u.x, u.y);
    if (z) { P.zd[z.id] = (P.zd[z.id] || 0) + 1; u.room = z.id; } // tagged: killed later in this raid, off this room
  }
  b.poiRooms = { baseId: base.id, placed: 0 };
  syncRooms(state, base);
}

// ---------- routes over the floors ----------
// The neighbours of a cell: four ways on its floor, and the floor above or below up the same stairs.
function* steps(P, f, i) {
  const W = P.w, x = i % W, y = (i - x) / W;
  if (x > 0) yield [f, i - 1];
  if (x < W - 1) yield [f, i + 1];
  if (y > 0) yield [f, i - W];
  if (y < P.h - 1) yield [f, i + W];
  if (STAIRS(kindAt(P, f, x, y))) for (const g of [f - 1, f + 1]) if (hasFloor(P, g) && STAIRS(kindAt(P, g, x, y))) yield [g, i];
}
const walkFor = (k) => !!k && k !== "void" && !!CELL[k] && (CELL[k].walk || PEOPLE_THROUGH.has(k));
const startCells = (P) => {
  const out = [], h = POICAMP.HALF, f = P.f || 0;
  for (let dy = -h; dy <= h; dy++) for (let dx = -h; dx <= h; dx++) { const x = P.at[0] + dx, y = P.at[1] + dy; if (x >= 0 && y >= 0 && x < P.w && y < P.h) out.push([f, y * P.w + x]); }
  return out;
};
// An exit of the map from (f, i): a ground-floor edge cell, a ground-floor door or gap of a room's wall onto the yard;
// an older record's stairs off its one floor (the floor below was never kept).
function exitAt(P, f, i) {
  const W = P.w, x = i % W, y = (i - x) / W;
  if (f === 0 && hasFloor(P, 0)) {
    if (x === 0 || y === 0 || x === W - 1 || y === P.h - 1) return true;
    const Z = zonesOf(P);
    if (Z.at[0][i] === -2) for (const [g, j] of steps(P, 0, i)) if (g === 0 && Z.at[0][j] >= 0 && Z.list[Z.at[0][j]].kind === "yard") return true;
    return false;
  }
  return !hasFloor(P, 0) && STAIRS(kindAt(P, f, x, y)) && f > 0 && !hasFloor(P, f - 1);
}
/**
 * Can people get through (f, i) on the way out: walkable, and a Cleared room, a seen threshold, or seen, empty yard (the
 * camp's own room is theirs: always; a yard block under the camp is yard like any other).
 */
function clearCell(P, f, i, Z) {
  const x = i % P.w, y = (i - x) / P.w;
  if (!walkFor(kindAt(P, f, x, y))) return false;
  const zi = Z.at[f] ? Z.at[f][i] : -1;
  const seen = seenOn(P, f)[i] === 1;
  if (zi < 0) return seen;
  const z = Z.list[zi];
  if (z.kind === "room" && campZones(P).has(z.id)) return true;
  if (z.kind === "yard") return seen && !deadIn(P, z);
  return roomState(P, z) === "cleared";
}
// The climb kit at the camp: a rope or a siege ladder in the armory or on someone home, or knotted sheets (a bed).
function climbKit(state, base) {
  const has = (it) => it && (it.key === "rope" || it.key === "ladder");
  if ((base.armory || []).some(has)) return true;
  if ((base.buildings || []).some((x) => x && /bed|bunk|cot/.test(String(x.type)))) return true;
  try { for (const s of atBase(state, base.id)) if (Object.values(s.gear || {}).some(has) || (s.pack || []).some(has)) return true; } catch { /* a test's bare base */ }
  return false;
}
// A window next to a reached cell onto seen, empty ground (the ground floor's cell at the window's far side).
function climbFrom(P, f, i, kit) {
  const W = P.w, x = i % W, y = (i - x) / W, Z = zonesOf(P);
  if (f > 0 && !kit) return false;
  if (!hasFloor(P, 0)) return false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const wx = x + dx, wy = y + dy;
    if (!WINDOWS.has(kindAt(P, f, wx, wy))) continue;
    const ox = wx + dx, oy = wy + dy;
    if (ox < 0 || oy < 0 || ox >= W || oy >= P.h) return true; // the window over the map's edge
    const j = oy * W + ox, zi = Z.at[0][j];
    if (zi >= 0 && Z.list[zi].kind === "yard" && seenOn(P, 0)[j] && !deadIn(P, Z.list[zi]) && walkFor(kindAt(P, 0, ox, oy))) return true;
  }
  return false;
}
/**
 * Works the way out out (the search; not cached): { open, climb, through (a Not cleared room's name on the nearest
 * walkable route, or null) }. @param {any} state @param {any} base
 */
export function computeWay(state, base) {
  const P = base.poiCamp, Z = zonesOf(P), N = P.w * P.h;
  const kit = climbKit(state, base);
  const seen = new Map();
  const mark = (f, i) => { let a = seen.get(f); if (!a) { a = new Uint8Array(N); seen.set(f, a); } if (a[i]) return false; a[i] = 1; return true; };
  const q = [];
  for (const [f, i] of startCells(P)) if (mark(f, i)) q.push([f, i]);
  let climb = false;
  for (let k = 0; k < q.length; k++) {
    const [f, i] = q[k];
    if (exitAt(P, f, i)) return { open: true, climb: false, through: null };
    if (!climb && climbFrom(P, f, i, kit)) climb = true;
    for (const [g, j] of steps(P, f, i)) if (clearCell(P, g, j, Z) && mark(g, j)) q.push([g, j]);
  }
  const bl = blockedBy(P, Z);
  return { open: false, climb, through: bl ? bl.name : null, ...(bl ? { why: bl.why } : {}) };
}
// The Not cleared room on the nearest walkable route out (no states read), or null when no route out exists at all.
function blockedBy(P, Z) {
  const N = P.w * P.h, prev = new Map(), q = [];
  const key = (f, i) => f * N + i;
  for (const [f, i] of startCells(P)) { const k = key(f, i); if (!prev.has(k)) { prev.set(k, -1); q.push([f, i]); } }
  for (let k = 0; k < q.length; k++) {
    const [f, i] = q[k];
    if (exitAt(P, f, i)) {
      const path = [];
      for (let c = key(f, i); c !== -1; c = prev.get(c)) path.push(c);
      path.reverse();
      for (const c of path) { const g = Math.floor(c / N), j = c % N, zi = Z.at[g] ? Z.at[g][j] : -1; if (zi >= 0 && !clearCell(P, g, j, Z)) return { name: Z.list[zi].name, why: deadIn(P, Z.list[zi]) ? "dead known" : "fogged" }; }
      for (const c of path) { const g = Math.floor(c / N), j = c % N; if (!clearCell(P, g, j, Z)) return { name: "unknown ground", why: "fogged" }; }
      return null;
    }
    for (const [g, j] of steps(P, f, i)) { const kk = key(g, j); if (!prev.has(kk) && walkFor(kindAt(P, g, j % P.w, Math.floor(j / P.w)))) { prev.set(kk, key(f, i)); q.push([g, j]); } }
  }
  return null;
}
/** The way out (cached; worked out when missing). @param {any} state @param {any} base */
export function wayOut(state, base) {
  if (!isPoiCamp(base)) return { open: true, climb: false, through: null };
  const P = base.poiCamp;
  if (!P.way) { syncRooms(state, base); P.way = { ...computeWay(state, base), h: state.hour }; }
  return P.way;
}
const okFor = (w, heavy) => !!w && (w.open || (w.climb && !heavy));
/**
 * The way out worked out again (the camp done, a grounds attack, a clearing fight, the daily recalculation): the log
 * and a card when it changes. @param {any} state @param {any} base @param {string} [why]
 */
export function refreshWay(state, base, why = "") {
  if (!isPoiCamp(base)) return null;
  const P = base.poiCamp, old = P.way || null;
  syncRooms(state, base);
  const w = { ...computeWay(state, base), h: state.hour };
  P.way = w;
  if (old && okFor(old, false) !== okFor(w, false)) {
    const text = okFor(w, false) ? `${Q.WAY_OPEN} at ${base.name}${w.open ? "" : " (a climb out of a window: people on foot only)"}: its people can leave the place again.` : `${Q.WAY_CUT} at ${base.name}: ${wayText(w).replace(/^Cut off: /, "")}. Nobody can leave the place (the land jobs, teams, hauling) until a route is cleared or they ${Q.BREAK.toLowerCase()}.`;
    log(state, text, okFor(w, false) ? "good" : "danger");
    addCard(state, { title: okFor(w, false) ? Q.WAY_OPEN : Q.WAY_CUT, text: `${text}${why ? ` (${why})` : ""}`, mapBase: base.id, choices: [{ label: "OK", default: true, resolve: () => "" }] });
  } else if (old && old.open !== w.open && w.climb) log(state, `${base.name}: the way out is a climb out of a window now (people on foot only: no furniture, heavy loads or vehicles).`, "info");
  return w;
}
// "Cut off: the way out runs through the kitchen (dead known)".
function wayText(w) {
  if (!w.through) return "Cut off: no walkable way out of the building";
  return `Cut off: the way out runs through ${w.through} (${w.why || "dead known"})`;
}
/**
 * Why nobody can leave this base's map now ("" when they can; any base that is not a POI camp: ""). heavy: furniture,
 * heavy loads or a vehicle (a climb out does not do for those). @param {any} state @param {any} base @param {{ heavy?: boolean }} [o]
 */
export function cutOffWhy(state, base, o = {}) {
  if (!base || !base.poiCamp || base.poi == null) return "";
  const w = wayOut(state, base);
  if (okFor(w, !!o.heavy)) return "";
  if (w.climb && o.heavy) return "Cut off for loads: the only way out is a climb out of a window (people on foot, no furniture, heavy loads or vehicles)";
  return wayText(w);
}
/** The Camp tab's line: { text, cls, why }. @param {any} state @param {any} base */
export function wayView(state, base) {
  if (!isPoiCamp(base)) return null;
  const w = wayOut(state, base), rooms = roomsView(state, base);
  const nc = rooms.filter((r) => r.state !== "cleared"), dead = rooms.reduce((a, r) => a + r.dead, 0);
  const text = w.open ? Q.WAY_OPEN : w.climb ? `${Q.WAY_OPEN} (a climb: on foot only)` : `${Q.WAY_CUT}: ${wayText(w).replace(/^Cut off: /, "")}`;
  return { text, cls: w.open ? "good" : w.climb ? "warn" : "danger", cut: !okFor(w, false), climb: !w.open && w.climb, rooms, why: `${rooms.length - nc.length} of ${rooms.length} rooms and yard areas Cleared; ${nc.length} Not cleared${dead ? `, about ${dead} of the dead in them` : ""}.` };
}

// ---------- waves out of the rooms ----------
// The cost of the route from the camp to every zone: doors × 1000 + steps (a search over the floors; the dead go
// through walls nowhere, a shut door costs DOOR more and counts as a door on the way).
function routeCosts(P) {
  const N = P.w * P.h, Z = zonesOf(P), best = new Map(), cost = new Map();
  const key = (f, i) => f * N + i;
  const heap = []; // [cost, f, i], a binary heap on cost
  const push = (e) => { heap.push(e); for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; for (let k = 0; ;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (const [f, i] of startCells(P)) { cost.set(key(f, i), 0); push([0, f, i]); }
  while (heap.length) {
    const [c0, f, i] = pop();
    if (c0 > (cost.get(key(f, i)) ?? Infinity)) continue;
    const zi = Z.at[f] ? Z.at[f][i] : -1;
    if (zi >= 0 && !best.has(zi)) best.set(zi, c0);
    for (const [g, j] of steps(P, f, i)) {
      const k = kindAt(P, g, j % P.w, Math.floor(j / P.w));
      if (!k || k === "void" || !CELL[k] || (!CELL[k].walk && !SHUT.has(k) && !PEOPLE_THROUGH.has(k))) continue;
      const c = c0 + 1 + (SHUT.has(k) ? 1000 + Q.DOOR : 0);
      if (c < (cost.get(key(g, j)) ?? Infinity)) { cost.set(key(g, j), c); push([c, g, j]); }
    }
  }
  return best;
}
/**
 * The grounds' part of a wave out of the Not cleared rooms (campattack.js waveSource): up to g of the dead, open routes
 * first, a room behind a shut door letting out DOOR_SLOW of its dead. Returns { rooms: { id: n }, total }.
 * @param {any} state @param {any} base @param {number} g
 */
export function roomWave(state, base, g) {
  syncRooms(state, base);
  const P = base.poiCamp, Z = zonesOf(P), costs = routeCosts(P);
  const cand = Z.list.map((z, zi) => ({ z, c: costs.get(zi) })).filter((e) => deadIn(P, e.z) > 0 && e.c != null);
  cand.sort((a, c) => a.c - c.c || (a.z.id < c.z.id ? -1 : 1));
  /** @type {Record<string, number>} */
  const rooms = {};
  let total = 0;
  for (const { z, c } of cand) {
    if (total >= g) break;
    const d = deadIn(P, z), shut = c >= 1000;
    const q = Math.min(g - total, shut ? Math.max(1, Math.floor(d * Q.DOOR_SLOW)) : d);
    if (q > 0) { rooms[z.id] = q; total += q; }
  }
  return { rooms, total };
}
/**
 * The defence on the camp's map (fort.js fortDefence, its units): the wave's dead from the rooms start in their rooms
 * (a room on another floor: at the stairs), the rest stay where the map put them (the edges). The battle's own dice.
 * @param {any} b @param {any} F the fort @param {any} base @param {Record<string, number>} rooms @param {any} rng
 */
export function placeFromRooms(b, F, base, rooms, rng) {
  const P = base.poiCamp;
  if (!P || !rooms) return 0;
  const Z = zonesOf(P), f0 = P.f || 0;
  const toMap = (i) => [i % P.w - P.at[0] + F.ox, Math.floor(i / P.w) - P.at[1] + F.oy];
  const free = (x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * b.w + x].k] && CELL[b.cells[y * b.w + x].k].walk && !b.units.some((u) => !u.dead && u.side === "player" && u.x === x && u.y === y);
  const stairs = [];
  for (let i = 0; i < P.w * P.h; i++) if (STAIRS(kindAt(P, f0, i % P.w, Math.floor(i / P.w)))) stairs.push(i);
  const dead = b.units.filter((u) => u.side === "enemy" && u.kind === "zombie" && !u.boss);
  let k = 0, moved = 0;
  for (const [id, n] of Object.entries(rooms)) {
    const z = Z.byId.get(id);
    if (!z) { k += n; continue; }
    const spots = (z.f === f0 ? z.cells : stairs).map(toMap).filter(([x, y]) => free(x, y));
    for (let j = 0; j < n && k < dead.length; j++, k++) {
      const u = dead[k];
      const open = spots.filter(([x, y]) => !b.units.some((o) => o !== u && !o.dead && o.x === x && o.y === y));
      if (!open.length) continue;
      const [x, y] = open[rng.int(0, open.length - 1)];
      u.x = x; u.y = y; u.room = id; moved++;
    }
  }
  return moved;
}

// ---------- going back in: the raid on the POI's map ----------
/**
 * A raid on the camp's POI map starts (poicamp.js poiCampRaidStart): the POI's dead on the map put in their rooms as
 * they stand (each unit tagged u.room), Cleared rooms known ground. @param {any} state @param {any} b @param {any} base
 */
export function roomsOnRaid(state, b, base) {
  if (!isPoiCamp(base)) return;
  syncRooms(state, base);
  const P = base.poiCamp, Z = zonesOf(P);
  // What was seen of every floor is known again (the record's floors into the raid's).
  if (b.poiCamp) for (const f of floorsOf(P)) if (f !== (P.f || 0) && P.seenF && P.seenF[f] && !b.poiCamp.seen[f]) b.poiCamp.seen[f] = P.seenF[f];
  const dead = b.units.filter((u) => u.side === "enemy" && u.kind === "zombie" && !u.boss && !u.dormant);
  const want = [];
  for (const z of Z.list) for (let j = 0; j < deadIn(P, z); j++) want.push(z);
  want.sort((a, c) => a.edge - c.edge || (a.id < c.id ? -1 : 1));
  const taken = new Set(b.units.filter((u) => !u.dead).map((u) => `${u.f || 0}:${u.x}:${u.y}`));
  let k = 0;
  for (const u of dead) {
    if (k >= want.length) break;
    const z = want[k++];
    if (b.floors && !b.floors[z.f]) continue;
    const cells = z.cells.filter((i) => { const x = i % P.w, y = Math.floor(i / P.w), c = b.floors ? b.floors[z.f].cells[i] : b.cells[i]; return c && CELL[c.k] && CELL[c.k].walk && !taken.has(`${z.f}:${x}:${y}`) && x < b.w && y < b.h; });
    if (!cells.length) continue;
    const i = cells[(k * 7919) % cells.length];
    taken.delete(`${u.f || 0}:${u.x}:${u.y}`);
    u.x = i % P.w; u.y = Math.floor(i / P.w); u.room = z.id;
    if (b.floors) { u.f = z.f; u.away = z.f !== (b.floor || 0); }
    taken.add(`${z.f}:${u.x}:${u.y}`);
  }
  b.poiRooms = { baseId: base.id, placed: k };
}
/**
 * The raid on the camp's map ended (poicamp.js poiCampAfterRaid): the kills off the rooms they were in (scaled as
 * deadpop.js scales a big map's kills), the rooms put right against the pool, the way out worked out again.
 * @param {any} state @param {any} b @param {any} base
 */
export function roomsAfterRaid(state, b, base) {
  if (!isPoiCamp(base)) return;
  const P = base.poiCamp;
  if (b.poiRooms && b.poiRooms.baseId === base.id) {
    /** @type {Record<string, number>} */
    const killed = {};
    for (const u of b.units) if (u.room && u.dead) killed[u.room] = (killed[u.room] || 0) + 1;
    roomsKilled(base, killed, Object.values(killed).reduce((a, v) => a + v, 0));
  }
  refreshWay(state, base, "after the fight on the place's map");
  return P.way;
}

// ---------- by the numbers: clearing, fighting in, breaking out ----------
// The Not cleared zones on the nearest route out, then the rest by route from the camp: [{ z, n }] up to `max` dead.
function routeDead(state, base, max) {
  syncRooms(state, base);
  const P = base.poiCamp, Z = zonesOf(P), costs = routeCosts(P);
  const block = (wayOut(state, base).through || "");
  const cand = Z.list.map((z, zi) => ({ z, c: costs.get(zi) ?? 1e9 })).filter((e) => deadIn(P, e.z) > 0);
  cand.sort((a, c) => (a.z.name === block ? 0 : 1) - (c.z.name === block ? 0 : 1) || a.c - c.c || (a.z.id < c.z.id ? -1 : 1));
  /** @type {Record<string, number>} */
  const out = {};
  let n = 0;
  for (const { z } of cand) { if (n >= max) break; const q = Math.min(max - n, deadIn(P, z)); out[z.id] = q; n += q; }
  return { rooms: out, total: n };
}
/**
 * Kills by the numbers on the POI camp (Clear the dead from the base grounds headless, a fight in, Break out): off the
 * rooms given (or the route's), the POI and the tile; a zone emptied counts as seen. Returns the kills.
 * @param {any} state @param {any} base @param {number} k @param {Record<string, number>} [rooms]
 */
export function roomsCleared(state, base, k, rooms = null) {
  if (!isPoiCamp(base) || !(k > 0)) return 0;
  const P = base.poiCamp, r = rooms || routeDead(state, base, k).rooms;
  const got = roomsKilled(base, r, k);
  markCleared(P, Object.keys(r));
  if (got) takeDead(state, base, got); // off the grounds, the POI and the tile (deadpop.js killDead)
  refreshWay(state, base, "after a clearing fight");
  return got;
}
/** Why the camp's people cannot break out now ("" when they can). @param {any} state @param {any} base */
export function breakOutProblem(state, base) {
  if (!isPoiCamp(base)) return "Only at a camp inside a place (a POI).";
  if (state.combat) return "Not during a fight.";
  if (!cutOffWhy(state, base)) return "The way out is open.";
  if (!homeAt(state, base.id).length) return "Nobody is home.";
  if (!routeDead(state, base, 1).total) return "None of the dead to fight: the way out is under the fog (survey the place or raid it).";
  return "";
}
/**
 * Break out (a camp order): a fight on the camp's map, whoever is home at the camp against the dead in the rooms on the
 * blocked route (handler "poiBreakOut"). "" or why not. @param {any} state @param {number} baseId
 */
export function breakOut(state, baseId) {
  const base = (state.bases || []).find((x) => x.id === baseId);
  const why = breakOutProblem(state, base);
  if (why) return why;
  const r = routeDead(state, base, Q.FIGHT_MAX), th = siteThreat(state, base.tile);
  log(state, `${base.name}'s people ${Q.BREAK.toLowerCase()}: ${r.total} of the dead in ${Object.keys(r.rooms).map((id) => zonesOf(base.poiCamp).byId.get(id).name).join(", ")} stand between the camp and the way out.`, "info");
  fightNow(state, {
    tile: base.tile, baseId: base.id, enemy: { kind: "zombies", count: r.total, power: th.power || 2, mix: th.mix || null, name: "the dead in the rooms" },
    ambush: null, canRetreat: true, handler: "poiBreakOut", layout: "baseDefence", downedLive: 0.4, deploy: true,
    context: { baseId: base.id, dead: r.total, raiders: 0, wave: r.total, rooms: r.rooms, breakOut: true },
  });
  return "";
}
registerCombatHandler("poiBreakOut", (state, result, setup) => {
  const c = setup.context, base = (state.bases || []).find((x) => x.id === c.baseId);
  if (!base) return;
  const killed = result.outcome === "victory" ? c.wave : Math.min(c.wave, result.enemiesKilled || 0);
  const k = roomsCleared(state, base, killed, c.rooms);
  const w = wayOut(state, base);
  log(state, `${base.name}: ${result.outcome === "victory" ? "the break out held" : "the break out was driven back"}, ${k} of the dead killed. ${okFor(w, false) ? Q.WAY_OPEN : `${Q.WAY_CUT} still`}.`, result.outcome === "victory" ? "good" : "danger");
});
/**
 * A team coming home to a cut-off camp fights its way in (parties.js returnHome): in the browser a raid on the POI's map
 * from the edge; headless a fight by the numbers against the dead on the blocked route. Returns true when it did.
 * @param {any} state @param {any} p @param {any} base
 */
export function fightIn(state, p, base) {
  if (!p || p.owner !== "player" || p.foughtIn === state.hour || !cutOffWhy(state, base)) return false;
  const tile = base.tile;
  log(state, `${teamName(state, p)} reach ${base.name}, but the way in is cut off: they fight their way in (${wayOut(state, base).through || "the place"}).`, "danger");
  if (!state.autoCombat && typeof window !== "undefined") {
    p.poi = base.poi; p.dest = tile; p.phase = "engaged";
    startScavenge(state, p); // the raid on the POI's map from the edge: the camp stands on it (poicamp.js poiCampRaidStart), Settle in once safe moves them in
    return true;
  }
  const r = routeDead(state, base, Q.FIGHT_MAX), th = siteThreat(state, tile);
  if (!r.total) { p.foughtIn = state.hour; return false; }
  p.phase = "engaged";
  startCombat(state, { tile, partyId: p.id, enemy: { kind: "zombies", count: r.total, power: th.power || 2, mix: th.mix || null, name: "the dead in the way" }, ambush: null, canRetreat: true, handler: "poiFightIn", layout: "siteClear", context: { partyId: p.id, tile, baseId: base.id, wave: r.total, rooms: r.rooms } });
  return true;
}
registerCombatHandler("poiFightIn", (state, result, setup) => {
  const c = setup.context;
  const p = state.parties.find((x) => x.id === c.partyId), base = (state.bases || []).find((x) => x.id === c.baseId);
  const killed = result.outcome === "victory" ? c.wave : Math.min(c.wave, result.enemiesKilled || 0);
  const k = base ? roomsCleared(state, base, killed, c.rooms) : 0;
  if (!p || !state.parties.includes(p) || !partyMembers(state, p).length) return;
  if (result.outcome === "victory") {
    p.foughtIn = state.hour; // through: home, whatever the rooms beyond
    log(state, `${teamName(state, p)} fought their way into ${base ? base.name : "the camp"} (${k} of the dead killed).`, "good");
    startReturn(state, p);
  } else awaitOrders(state, p, `Driven back from ${base ? base.name : "the camp"} after killing ${k} of the dead: the way in is still cut off.`, { failed: true });
});

// ---------- the day ----------
/** After the daily recalculation (world.js, after deadpop.js deadPopDaily): every POI camp's rooms and way out. @param {any} state */
export function poiRoomsDaily(state) {
  for (const base of state.bases || []) if (isPoiCamp(base)) refreshWay(state, base, "the dead moved in the night");
}
/** The governor (autopilot.js): a cut-off camp with fighters home breaks out. Returns true when it did. @param {any} state */
export function govBreakOut(state) {
  if (state.combat) return false;
  for (const base of state.bases || []) {
    if (!isPoiCamp(base) || !cutOffWhy(state, base)) continue;
    if (homeAt(state, base.id).length >= 2 && !breakOutProblem(state, base)) { breakOut(state, base.id); return true; }
  }
  return false;
}
const liveCache = new WeakMap();
/**
 * The camp's record as the rooms stand during a raid on its map (build mode): the dead killed this raid off the rooms
 * they were in, what your people have seen this raid on the camp's floor added. A copy (cached by the battle's turn and
 * kills); the base's record is untouched. @param {any} b @param {any} P
 */
export function liveRecord(b, P) {
  const R = b && b.poiCamp;
  if (!R || !b.poiRooms) return P;
  const dead = b.units.filter((u) => u.room && u.dead);
  const seen = (R.seen && R.seen[P.f || 0]) || "";
  const key = `${b.turn}:${dead.length}:${seen.length}:${P.seen.length}:${JSON.stringify(P.zd || {})}`;
  const c = liveCache.get(b);
  if (c && c.key === key && c.P === P) return c.rec;
  const zd = { ...(P.zd || {}) };
  for (const u of dead) if (zd[u.room] > 0) { zd[u.room]--; if (!zd[u.room]) delete zd[u.room]; }
  const N = P.w * P.h, a = unseenRle(P.seen, N), s2 = unseenRle(seen, N);
  for (let i = 0; i < N; i++) if (s2[i]) a[i] = 1;
  const rec = { ...P, zd, seen: seenRle(a) };
  liveCache.set(b, { key, P, rec });
  return rec;
}
/** Seen cells of every floor of a raid into the record (poicamp.js poiCampAfterRaid). @param {any} P @param {any} R the raid's record @param {number} N */
export function mergeSeenFloors(P, R, N) {
  for (const [fs, rle] of Object.entries(R.seen || {})) {
    const f = Number(fs);
    if (f === (P.f || 0) || !rle) continue;
    if (!P.seenF) P.seenF = {};
    const a = unseenRle(P.seenF[f] || "", N), c = unseenRle(rle, N);
    for (let i = 0; i < N; i++) if (c[i]) a[i] = 1;
    P.seenF[f] = seenRle(a);
  }
}
