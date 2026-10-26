// @ts-check
// A camp inside a point of interest, set up mid-raid (the heat epic #64 §4, issue #70; the user's requests
// 2026-10-26: "allow the player to create and start camps with in POIs without needing to clear out all the
// zombies/raiders first … survey a tile Discover a POI raid it and see a good spot you want to set up camp and do so";
// "When camping on a POI it will be the POi map itself so AI groups raiding that POI will also see your base"; "The POI
// map does not expand for camps or bases … You can utilize the building to place interior utilities and farm on the
// yard of the building but can't build too much beyond"; "A tile can hold more than one base but only One base per POI
// and one normal base"; "You set up a camp from survivors being within a 5x5 grid selected when a survivor action for
// set up camp … all the supplies needed must be within the inventories of the survivors within the 5x5. Then at least
// one survivor needs to use actions each turn to set up the campsite"; "no zombie in 5 turns with a overlay showing the
// tick down of being 'safe' … The 5 countdown is after the camp setup is finished"; the addendum, build mode during a
// raid: "While in raid and it is your turn and no zombies insight you can enter build mode to build up your base in
// areas you have seen and that are cleared such as making beds or defenses. These can be worked on by using actions
// each turn by your survivors and multiple of them assisting makes it go quicker.").
//
// SET UP CAMP, a survivor's order on a raid map of a POI (act "campSetup", { unit, x, y }: the fire in the middle cell of
// the 5 × 5, POICAMP.SIZE): setupProblem says why not:
//   - the POI already has a base (one base per POI: yours or a group's, poiBaseAt), the tile is a hive, a group's base
//     tile or a city's crawl tile (staging.js campProblem's rules for any camp);
//   - every cell of the 5 × 5 seen (the raid's fog: seenOf, every cell your people have seen on that floor this raid and
//     in the raids before, kept with the camp), walkable, off walls, furniture and stairs, on one floor (the floor the
//     picker looks at);
//   - no hostile inside it;
//   - the supplies inside the square: CAMP.fireCost (the fire's 5 wood + 8 stone) in the inventories of your survivors
//     standing inside the 5 × 5 (squareSupplies: what they carry loose, the supply stacks in their pockets and pack, and
//     their share of the team's packs when the team came on foot: raidloot.js u.share); what people outside it carry
//     does not count. They are taken when the work starts (takeSupplies) and stay with the site.
// The work (act "campWork", { unit }): POICAMP.AP_PER_HOUR actions a work-hour (a turn is ten minutes, two actions a
// survivor: twelve an hour), the camp fire's CAMP.fireHours (a POI map has no tile land to clear). Each survivor inside
// the 5 × 5 spends the actions they have left; more workers, faster; a turn with nobody working leaves the progress
// where it is. A hostile inside the 5 × 5 stops the work (nothing lost) until it is killed or pushed out.
// ABANDONED (the raid ends with the work not done: everyone left, the site overrun): the half-built camp and its
// supplies stay in the POI's ledger (poi.cont.camp = { mapId, f, at, work, total, paid }), and the next raid on that
// POI's map picks it up from there (poiCampRaidStart).
// THE BASE IS OFFICIAL the moment the work finishes (foundPoiCamp): a camp (buildings.js isCamp) on the tile with
// base.poi = i and base.poiCamp (below); the log, the "A new home" card, the State Map, the save, AI groups see it as any
// base. The raid map does not close: it is the camp's first defence; anyone who leaves by an edge from now on is the
// team on the tile, not the camp's.
// SETTLE IN and the "safe" countdown (poiCampTurn, at the start of each of your turns once the camp is done): b.poiCamp
// .safe counts POICAMP.SAFE_TURNS (5) down to 0 while no hostile is seen by any of your survivors nor inside the 5 × 5;
// one in sight resets it to 5 ("Not safe: the dead in sight"). At 0, Settle in (act "settleIn"): everyone still on the
// map moves in as the camp's residents (u.settled; scavenge.js afterRaid → poiCampAfterRaid: parties.js settleInto,
// the team's load into its stores) and the raid ends; the camp's base map opens (staging.js askLayout "camp", the
// "Open the build map" prompt). The dead still on the map stay the camp's grounds (poiCampAfterRaid: base.grounds from
// the POI's dead, deadpop.js poiDead; campscout.js runs the attacks). If everyone leaves instead the camp stands empty.
// THE CAMP'S MAP IS THE POI'S MAP (base.poiCamp, the one place it lives; #71 extends it with the rooms' states):
//   base.poiCamp = { v, poi, mapId, f, at: [x, y] (the fire's cell on the POI map), w, h, pal: [cell kinds],
//     cells (a char a cell, an index into pal: k|f|mhp|h|ter), rooms: [{ x0, y0, w, h, name }] (the building's rooms on
//     that floor, walls included), seen (run lengths of the cells your side has seen, unseenRle / seenRle) }
//   Grid coordinates on the base map are cells from the fire (basemap.js originOf [0, 0]): POI cell = grid + at.
//   basemap.js reads it: gridBox (the map's own extent), buildBaseMap (the POI's cells laid as the map's ground and
//   walls, the whole map, nothing past its edge), landFor (no tile land), placeProblemAt (poiPlaceWhy), viewBattle
//   (poiKnownMask: the fog). buildings.js placeProblem greys a build that fits nowhere ("No room on this map").
// THE POI MAP NEVER GROWS (poiPlaceWhy): every cell of a footprint on the map, seen ("Unknown ground"), off the
// building's walls, its furniture and stairs; fittings (FOOT fit) only in the building's rooms (or a general building
// put up in the yard; basemap.js fittingRoom finds room in the rooms); indoor props in a room or the yard; everything
// else in the yard; a building (a house-kind footprint) bigger than POICAMP.YARD_AREA cells ("only small builds fit in
// the yard": a hut or a step up's house, not a lodge or a barn) is refused. Nothing past the map's edge: no NO_BUILD
// margin, no wall band. The Build list greys a build that fits nowhere on the seen map (poiFits: "No room on this map").
// BASES ON A TILE: at most one base per POI (poiBaseAt) plus one normal base (normalBaseAt: staging.js campProblem /
// campOption, a base with no poi).
// OTHER GROUPS (poiCampFoundBy, grouppois.js raidPoiAsGroup): a group raiding a POI with your camp finds your base; a
// group at war-footing (factions.js launchRaidOnBase) raids it, fought on the POI's map (the base defence on
// buildBaseMap); anyone else turns away; nobody loots it by the numbers. It is marked as your base in their knowledge
// (base.poiCamp.knownBy).
// BUILD MODE ON THE RAID MAP (the addendum; act "buildMode" on / off, "campBuild" { type, x, y, r }, "buildWork"
// { unit, site }): on a raid of your POI camp's map once the camp is done, your turn, no hostile in sight (closed at the
// start of a turn one is: "Build mode closed: the dead in sight"); a build goes on seen, cleared cells (no dead seen or
// known there: units in sight, the last-seen ghosts) under the same limits (basemap.js placeProblemAt on the camp's
// base) and queues a site (b.poiCamp.sites); a survivor inside or next to its footprint spends actions on it
// (buildings.js hours × AP_PER_HOUR); its materials come from the camp's stores, then your survivors on the map, taken
// when its work starts; a hostile in its footprint stops it. Finished, it stands at once (a barricade, spikes, a bed
// laid on the map) and counts for the camp (buildings.js addBuilding, its spot kept). When the raid ends an unfinished
// site goes into the camp's construction queue at its spot with its progress (buildings.js constructionHour ends it).
// HEADLESS AND THE AUTOPILOT (botPoiCamp, combat.js autoRaidTurn): the same rules: a team told to camp here
// (setup.raid.camp) picks the game's own spot (bestSquare) when the governor's rule allows (govPoiCampOk: the POI's dead
// low or below, deadpop.js deadBand, and the team able to answer Defend), its people inside work, and it settles in at 0.
// Its build mode builds nothing of its own (sites placed by the player are worked).
// Deterministic: no dice at all (the spot by score, ties by position).
/** @import { State } from "./types" */
import { CELL, playerVision, playerSees, setFloor, activeAny, active, unitById, endCalledOff, say } from "./combat.js"; // (call-time only)
import { CAMP, BUILDINGS, canBuild, addBuilding, queueBuild } from "./buildings.js"; // (call-time only)
import { FOOT, rectOf, dimsOf, placeProblemAt, occupancy } from "./basemap.js"; // (call-time only)
import { poiAt, poiName, poiLedger, isSitePoi } from "./pois.js"; // (call-time only)
import { raidMapId } from "./poicont.js"; // (call-time only)
import { poiDead, deadBand } from "./deadpop.js"; // (call-time only)
import { crawlTile } from "./citycrawl.js"; // (call-time only)
import { newId, log, addCard, day, hub, survivorById, atBase } from "./world.js"; // (call-time only)
import { partyMembers, tileLabel, settleInto, takeSupply } from "./parties.js"; // (call-time only)
import { recomputeOwnership, attitude, launchRaidOnBase } from "./factions.js"; // (call-time only)
import { askLayout, buildMapChoice, shelterText } from "./staging.js"; // (call-time only)
import { carriedSpots } from "./inventory.js"; // (call-time only)
import { stockKeyOf } from "./supitems.js"; // (call-time only)
import { amountOf } from "./itemstack.js"; // (call-time only)
import { keyWord } from "./water.js"; // (call-time only)

export const POICAMP = {
  SIZE: 5, HALF: 2,          // the camp's square (basescatter.js SITE.SIZE), the fire in its middle cell
  AP_PER_HOUR: 12,           // a work-hour in actions (a turn is ten minutes, two actions a survivor)
  SAFE_TURNS: 5,             // turns with no hostile in sight before Settle in
  YARD_AREA: 20,             // the biggest building in the yard in cells (a hut, a step up's house; not a lodge or a barn)
  SEEN_V: 1,                 // base.poiCamp's record version
  LABEL: "Set up camp", WORK: "Work on the camp", SETTLE: "Settle in", BUILD: "Build mode",
  NO_ROOM: "No room on this map", UNKNOWN: "Unknown ground: nobody of yours has seen it (raid the POI or survey it)",
};

// ---------- bases on a tile ----------
/** Your base in POI i of a tile, or null. @param {any} state @param {number} tile @param {number} i */
export const poiBaseAt = (state, tile, i) => (state.bases || []).find((b) => b.tile === tile && b.poi === i) || null;
/** Your normal base on a tile (the tile's own 500 × 500 map, no POI), or null. @param {any} state @param {number} tile */
export const normalBaseAt = (state, tile) => (state.bases || []).find((b) => b.tile === tile && b.poi == null) || null;
/** Is this base a camp inside a POI? @param {any} base */
export const isPoiCamp = (base) => !!(base && base.poiCamp && base.poi != null);

// ---------- the raid's fog, kept ----------
// A floor's cells: the floor record's on a building with storeys, else the map's.
const cellsOn = (b, f) => (b.floors && b.floors[f] ? b.floors[f].cells : b.cells);
const floorOf = (b) => b.floor || 0;
/** Run lengths of a 0/1 array, starting with a run of 0: "12,5,30". @param {ArrayLike<number>} a */
export function seenRle(a) {
  const out = [];
  let v = 0, n = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] ? 1 : 0; if (x === v) n++; else { out.push(n); v = x; n = 1; } }
  out.push(n);
  return out.join(",");
}
/** The 0/1 array of a run-length string (seenRle), N cells. @param {string} s @param {number} N */
export function unseenRle(s, N) {
  const a = new Uint8Array(N);
  if (!s) return a;
  let i = 0, v = 0;
  for (const part of String(s).split(",")) { const n = Number(part) || 0; if (v) a.fill(1, i, Math.min(N, i + n)); i += n; v ^= 1; }
  return a;
}
// The raid's own record (b.poiCamp; plain data, saved with the battle): created on a POI raid.
function campRec(b) {
  if (!b.poiCamp) b.poiCamp = { tile: b.tileId, poi: b.setup.raid.poi, mapId: raidMapId(b), seen: {}, sites: [], build: false };
  return b.poiCamp;
}
/** Is this battle a raid on a POI's map (where a camp can be set up)? @param {any} b */
export const poiRaid = (b) => !!(b && b.raid && !b.over && b.setup && b.setup.raid && b.setup.raid.poi != null && !b.layout && !b.site);
/**
 * What your side has seen of floor f (0/1 a cell): what it saw before (kept on the battle, and the camp's own record),
 * plus what it sees now (combat.js playerVision on that floor). @param {any} b @param {number} [f]
 */
export function seenOf(b, f = floorOf(b)) {
  const R = campRec(b), N = b.w * b.h;
  let a = R.seen[f] ? unseenRle(R.seen[f], N) : new Uint8Array(N);
  const view = floorOf(b);
  const swap = !!b.floors && f !== view;
  if (swap) setFloor(b, f);
  try { const vis = playerVision(b); for (let i = 0; i < N; i++) if (vis[i]) a[i] = 1; } finally { if (swap) setFloor(b, view); }
  R.seen[f] = seenRle(a);
  return a;
}
// Every floor where your people stand: what they see now added to what was seen (each of your turns and actions).
export function noteSeen(b) {
  if (!poiRaid(b)) return;
  const floors = new Set([floorOf(b)]);
  for (const u of b.units) if (u.side === "player" && activeAny(u)) floors.add(u.f || 0);
  for (const f of floors) seenOf(b, f);
}

// ---------- the 5 × 5 ----------
/** The square's cells round its fire. @param {number} x @param {number} y */
export function squareCells(x, y) {
  const out = [];
  for (let dy = -POICAMP.HALF; dy <= POICAMP.HALF; dy++) for (let dx = -POICAMP.HALF; dx <= POICAMP.HALF; dx++) out.push([x + dx, y + dy]);
  return out;
}
const inSquare = (at, x, y) => Math.abs(x - at[0]) <= POICAMP.HALF && Math.abs(y - at[1]) <= POICAMP.HALF;
// A cell a camp (or a build) may stand on: walkable, not a wall, furniture or a container, not the stairs or a ladder.
const groundOk = (c) => !!c && !!CELL[c.k] && CELL[c.k].walk && !CELL[c.k].climb && c.k !== "void" && c.k !== "water";
/** Hostiles on floor f inside the square round at. @param {any} b @param {number[]} at @param {number} f */
export const hostilesIn = (b, at, f) => b.units.filter((u) => (u.side === "enemy" || (u.side === "third" && u.hostile)) && activeAny(u) && !u.dormant && (u.f || 0) === f && inSquare(at, u.x, u.y));
/** Hostiles any of your survivors see now. @param {any} b */
export const hostilesSeen = (b) => b.units.filter((u) => u.side === "enemy" && activeAny(u) && !u.dormant && playerSees(b, u));
// Your survivors on floor f inside the square.
const peopleIn = (b, at, f) => b.units.filter((u) => u.side === "player" && active(u) && u.sid != null && u.vol == null && (u.f || 0) === f && inSquare(at, u.x, u.y));

// ---------- supplies in the square ----------
const need = () => ({ ...CAMP.fireCost });
// How much of supply k one survivor holds on the map: carried loose (raidloot.js u.haul), the stacks in their pockets
// and pack (supitems.js), and their share of the team's packs on foot (u.share of the team's packed supplies).
function unitHas(state, b, u, k, p, shareAll) {
  const s = survivorById(state, u.sid);
  let n = (u.haul && u.haul.sup && u.haul.sup[k]) || 0;
  if (s) for (const sp of carriedSpots(s)) if (stockKeyOf(sp.item) === k) n += amountOf(sp.item);
  if (p && shareAll > 0 && u.share > 0) n += teamHas(p, k) * (u.share / shareAll);
  return n;
}
const teamHas = (p, k) => Math.max(0, (p.supplies && p.supplies[k]) || 0) + Math.max(0, (p.cargo && p.cargo.supplies && p.cargo.supplies[k]) || 0);
const raidTeam = (state, b) => (b.setup ? state.parties.find((x) => x.id === b.setup.partyId) || null : null);
const sharesOf = (b) => b.units.filter((u) => u.side === "player").reduce((a, u) => a + (u.share || 0), 0);
/**
 * The camp's needs against what your survivors inside the square hold: { need, have, short, people } (short: what is
 * missing, {} when nothing is). @param {any} state @param {any} b @param {number[]} at @param {number} [f]
 */
export function squareSupplies(state, b, at, f = floorOf(b)) {
  const p = raidTeam(state, b), all = sharesOf(b);
  const people = peopleIn(b, at, f);
  const want = need(), have = {}, short = {};
  for (const k of Object.keys(want)) {
    have[k] = Math.floor(people.reduce((a, u) => a + unitHas(state, b, u, k, p, all), 0) + 1e-9);
    if (have[k] < want[k]) short[k] = want[k] - have[k];
  }
  return { need: want, have, short, people };
}
// Takes n of supply k off the people (loose first, then the stacks they carry, then their share of the team's packs);
// returns how many it got.
function takeFrom(state, b, people, k, n) {
  const p = raidTeam(state, b), all = sharesOf(b);
  let left = n;
  for (const u of people) {
    if (left <= 0) break;
    if (u.haul && u.haul.sup && u.haul.sup[k] > 0) { const q = Math.min(left, u.haul.sup[k]); u.haul.sup[k] -= q; if (u.haul.sup[k] <= 1e-9) delete u.haul.sup[k]; left -= q; }
    const s = survivorById(state, u.sid);
    if (s && left > 0) for (const sp of carriedSpots(s)) {
      if (left <= 0) break;
      if (stockKeyOf(sp.item) !== k) continue;
      const q = Math.min(left, amountOf(sp.item));
      if (q <= 0) continue;
      sp.item.dur = amountOf(sp.item) - q;
      if (sp.item.dur <= 0) sp.take();
      left -= q;
    }
    if (left > 0 && p && all > 0 && u.share > 0) left -= takeSupply(p, k, Math.min(left, teamHas(p, k) * (u.share / all)));
  }
  return n - Math.max(0, left);
}

// ---------- why not ----------
/** Why a camp cannot go in POI i of this tile at all ("" when it can). @param {any} state @param {number} tile @param {number} i */
export function poiCampProblem(state, tile, i) {
  const t = state.tiles[tile];
  if (!t || !poiAt(t, i)) return "No such place.";
  if (t.hive) return "Not on a hive.";
  if (poiBaseAt(state, tile, i)) return `${poiBaseAt(state, tile, i).name} stands in this place already: one base a place.`;
  if (crawlTile(t)) return "Not on a city's crawl tile (its blocks are crawled, not settled).";
  if (state.factions.some((f) => f.alive && f.bases.includes(tile))) return "Another group's base is on this tile.";
  return "";
}
/**
 * Why a camp cannot be set up with its fire at (x, y) on the floor looked at ("" when it can). With a unit: they must
 * stand inside the square. @param {any} state @param {any} b @param {any} u @param {number} x @param {number} y
 */
export function setupProblem(state, b, u, x, y) {
  if (!poiRaid(b)) return "Only on a raid map of a place (a POI).";
  const R = campRec(b);
  if (R.done) return "The camp stands already.";
  if (R.at) return "The camp is being set up already: work on it.";
  const why = poiCampProblem(state, b.tileId, R.poi);
  if (why) return why;
  if (u && (u.side !== "player" || !active(u))) return "That survivor cannot act.";
  const f = floorOf(b);
  if (u && (u.f || 0) !== f) return "Look at their floor first.";
  const cells = cellsOn(b, f), seen = seenOf(b, f);
  for (const [cx, cy] of squareCells(x, y)) {
    if (cx < 0 || cy < 0 || cx >= b.w || cy >= b.h) return "The 5 × 5 runs off the map.";
    const i = cy * b.w + cx;
    if (!seen[i]) return "Every cell of the 5 × 5 must be seen: part of it is under the fog.";
    const c = cells[i];
    if (c && CELL[c.k] && CELL[c.k].climb) return "Off the stairs: the 5 × 5 must be on one floor.";
    if (!groundOk(c)) return `On ${c && CELL[c.k] ? CELL[c.k].name.toLowerCase() : "nothing"}: every cell must be open floor or ground.`;
  }
  if (hostilesIn(b, [x, y], f).length) return "A hostile is inside the 5 × 5: kill it or push it out first.";
  if (u && !inSquare([x, y], u.x, u.y)) return `${u.name} must stand inside the 5 × 5.`;
  const sup = squareSupplies(state, b, [x, y], f);
  if (!sup.people.length) return "Nobody of yours stands inside the 5 × 5.";
  const short = Object.entries(sup.short);
  if (short.length) return `Short inside the 5 × 5: ${short.map(([k, n]) => `${n} ${keyWord(k)}`).join(", ")} (only what the people standing in it carry counts).`;
  return "";
}
/** The setup's work total in actions. */
export const setupTotal = () => Math.max(1, Math.ceil(CAMP.fireHours * POICAMP.AP_PER_HOUR));

// ---------- the orders ----------
/** Starts the setup: the supplies taken off the people inside, the site kept with the POI's ledger. "" or why not. */
export function startSetup(state, b, u, x, y) {
  const why = setupProblem(state, b, u, x, y);
  if (why) return why;
  const R = campRec(b), f = floorOf(b);
  const sup = squareSupplies(state, b, [x, y], f);
  const paid = {};
  for (const [k, n] of Object.entries(sup.need)) paid[k] = takeFrom(state, b, sup.people, k, n);
  R.at = [x, y]; R.f = f; R.work = 0; R.total = setupTotal(); R.paid = paid; R.workTurn = null; R.workers = [];
  keepHalfBuilt(state, b);
  say(b, `${u ? u.name : "Your people"} start${u ? "s" : ""} setting up camp here: ${Object.entries(paid).map(([k, n]) => `${n} ${keyWord(k)}`).join(", ")} for the camp fire. ${R.total} actions of work: anyone inside the 5 × 5 can work on it.`, "good");
  workSetup(state, b, u);
  return "";
}
/** Why a survivor cannot work on the setup now ("" when they can). @param {any} b @param {any} u */
export function workProblem(b, u) {
  const R = b.poiCamp;
  if (!R || !R.at || R.done) return "No camp being set up here.";
  if (!u || u.side !== "player" || !active(u)) return "That survivor cannot act.";
  if ((u.f || 0) !== R.f || !inSquare(R.at, u.x, u.y)) return "Only from inside the camp's 5 × 5.";
  if (!(u.ap > 0)) return "No action left.";
  if (hostilesIn(b, R.at, R.f).length) return "Interrupted: a hostile is inside the 5 × 5. Kill it or push it out (nothing is lost).";
  return "";
}
/** A survivor spends the actions they have left on the setup. "" or why not. */
export function workSetup(state, b, u) {
  const why = workProblem(b, u);
  if (why) return why;
  const R = b.poiCamp;
  const ap = u.ap;
  u.ap = 0; u.hunker = false;
  if (R.workTurn !== b.turn) { R.workTurn = b.turn; R.workers = []; }
  if (!R.workers.includes(u.id)) R.workers.push(u.id);
  R.work = Math.min(R.total, R.work + ap);
  b.acted = true;
  if (R.work >= R.total) foundPoiCamp(state, b);
  else { keepHalfBuilt(state, b); say(b, `${u.name} works on the camp: ${R.work}/${R.total}.`, "info"); }
  return "";
}
// The half-built camp in the POI's ledger (poi.cont.camp), so a raid that ends now leaves it there.
function keepHalfBuilt(state, b) {
  const R = b.poiCamp, t = state.tiles[b.tileId];
  const c = poiLedger(t, R.poi);
  if (!c) return;
  if (R.done) { delete c.camp; return; }
  c.camp = { mapId: R.mapId, f: R.f, at: R.at.slice(), work: R.work, total: R.total, paid: { ...R.paid } };
}

// ---------- the base ----------
// The POI's map as plain data on the camp's base (the header's base.poiCamp).
function snapshot(b, R) {
  const cells = cellsOn(b, R.f), pal = [], idx = new Map();
  let s = "";
  for (const c of cells) {
    const key = `${c.k}|${c.f || ""}|${c.mhp || ""}|${c.h ?? ""}|${c.ter ? 1 : ""}`;
    let i = idx.get(key);
    if (i == null) { i = pal.length; pal.push(key); idx.set(key, i); }
    s += String.fromCharCode(48 + i);
  }
  const rooms = (b.raid.areas || []).filter((a) => a && !a.outdoor && a.x0 != null && a.w > 2 && a.h > 2 && (a.f || 0) === R.f).map((a) => ({ x0: a.x0, y0: a.y0, w: a.w, h: a.h, name: a.name || a.type || "Room" }));
  return { v: POICAMP.SEEN_V, poi: R.poi, mapId: R.mapId, f: R.f, at: R.at.slice(), w: b.w, h: b.h, pal, cells: s, rooms, seen: R.seen[R.f] || "", knownBy: [] };
}
/** The POI map's cell at (x, y) of a camp's record, as a map cell { k, f, hp, mhp, h, ter }, or null. */
export function poiCellAt(P, x, y) {
  if (!P || x < 0 || y < 0 || x >= P.w || y >= P.h) return null;
  const code = P.cells.charCodeAt(y * P.w + x) - 48;
  const [k, f, mhp, h, ter] = String(P.pal[code] || "open||||").split("|");
  return { k, ...(f ? { f } : {}), ...(mhp ? { hp: Number(mhp), mhp: Number(mhp) } : {}), ...(h !== "" ? { h: Number(h) } : {}), ...(ter ? { ter: 1 } : {}) };
}
/** Is (x, y) inside one of the building's rooms (not on its walls)? */
export const poiIndoor = (P, x, y) => (P.rooms || []).some((a) => x > a.x0 && x < a.x0 + a.w - 1 && y > a.y0 && y < a.y0 + a.h - 1);
// The seen cells of a camp's record (cached by the string).
const seenCache = new Map();
export function poiSeenMask(P) {
  const key = `${P.w}x${P.h}:${P.seen}`;
  let a = seenCache.get(key);
  if (!a) { a = unseenRle(P.seen, P.w * P.h); if (seenCache.size > 64) seenCache.clear(); seenCache.set(key, a); }
  return a;
}
/** The camp is done: the base stands (the header's THE BASE IS OFFICIAL). Returns the base. */
export function foundPoiCamp(state, b) {
  const R = b.poiCamp, tile = b.tileId, t = state.tiles[tile];
  R.done = true; R.work = R.total;
  seenOf(b, R.f);
  const hubNow = hub(state);
  const name = campName(state, t, R.poi);
  const base = {
    id: newId(), tile, type: hubNow ? "outpost" : "hub", name, poi: R.poi,
    stock: { water: 0, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, stone: 0, buildmat: 0, metalsheet: 0, propane: 0, raw: 0 },
    radio: false, watchtower: false, buildings: [], construction: [], armory: [],
    tier: 0, camp: true, fire: true, campDay: day(state), lastPresent: state.hour, tentsSet: true,
    plan: { plots: [], origin: [0, 0], fresh: true, fireSpot: [0, 0, 0] }, // the fire in the 5 × 5's middle: grid (0, 0) is POI cell at
    land: { v: 3, n: 1, cleared: {}, looted: {}, off: true }, // no tile land: the POI's own map is the ground (basemap.js landFor)
    poiCamp: snapshot(b, R),
  };
  state.bases.push(base);
  R.baseId = base.id;
  R.safe = POICAMP.SAFE_TURNS;
  const c = poiLedger(t, R.poi);
  if (c) delete c.camp;
  recomputeOwnership(state);
  const p = raidTeam(state, b);
  log(state, `${p ? partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", ") : "Your people"} set up camp in the ${poiName(t, R.poi).toLowerCase()} at ${tileLabel(state, tile)}: ${base.name} stands (the camp fire of ${Object.entries(R.paid || {}).map(([k, n]) => `${n} ${keyWord(k)}`).join(" and ")}). Its map is the place's own map: it never grows. Settle in once no hostile has been in sight for ${POICAMP.SAFE_TURNS} turns.`, "good");
  addCard(state, { title: "A new home", text: `Day ${day(state)}: ${base.name} stands in the ${poiName(t, R.poi).toLowerCase()} at ${tileLabel(state, tile)}. The raid goes on: this is its first defence. Settle in once no hostile has been in sight for ${POICAMP.SAFE_TURNS} turns; anyone who leaves by an edge stays a team on the tile. Its map is the place's own: the building's rooms take fittings, its yard crop plots and small builds, and nothing goes past the map's edge. ${shelterText()}`, mapBase: base.id, choices: [{ label: "OK", default: true, resolve: () => "" }, buildMapChoice(base)] });
  say(b, `${base.name} stands: the base is yours. Safe in ${R.safe}: Settle in once no hostile has been in sight for ${POICAMP.SAFE_TURNS} turns.`, "good");
  return base;
}
// "Bungalow Camp" (the place's name, a camp's word), unique.
function campName(state, t, i) {
  const place = isSitePoi(t, i) ? t.loc.name : poiName(t, i);
  let name = `${place} Camp`;
  for (let n = 2; state.bases.some((x) => x.name === name); n++) name = `${place} Camp ${n}`;
  return name;
}

// ---------- the turn: the safe countdown, build mode ----------
/** Start of your turn (combat.js startPlayerTurn): the fog kept, the countdown, build mode closed by a sighting. */
export function poiCampTurn(state, b) {
  if (!poiRaid(b)) return;
  noteSeen(b);
  const R = b.poiCamp;
  if (!R || !R.done) return;
  const seen = hostilesSeen(b).length > 0 || hostilesIn(b, R.at, R.f).length > 0;
  if (seen) {
    if (R.safe !== POICAMP.SAFE_TURNS) say(b, "Not safe: the dead in sight. Safe in 5.", "danger");
    R.safe = POICAMP.SAFE_TURNS;
    if (R.build) { R.build = false; say(b, "Build mode closed: the dead in sight.", "danger"); }
  } else if (R.safe > 0) {
    R.safe--;
    say(b, R.safe ? `Safe in ${R.safe}.` : `Safe: ${POICAMP.SETTLE} (everyone still on the map moves in).`, R.safe ? "info" : "good");
  }
}
/** The countdown's words for the overlay and the top strip ("" when there is no camp done). @param {any} b */
export function safeText(b) {
  const R = b && b.poiCamp;
  if (!R || !R.done) return "";
  if (R.safe > 0) return hostilesSeen(b).length || hostilesIn(b, R.at, R.f).length ? "Not safe: the dead in sight" : `Safe in ${R.safe}`;
  return `Safe: ${POICAMP.SETTLE}`;
}
/** Why Settle in cannot be given now ("" when it can). */
export function settleProblem(state, b) {
  const R = b && b.poiCamp;
  if (!poiRaid(b) || !R || !R.done) return "No camp of yours stands on this map.";
  if (b.phase !== "player") return "Wait for your turn.";
  if (!state.bases.some((x) => x.id === R.baseId)) return "The camp is gone.";
  if (R.safe > 0) return `Not safe yet: ${safeText(b).toLowerCase()} (${POICAMP.SAFE_TURNS} turns with no hostile in sight).`;
  if (!b.units.some((u) => u.side === "player" && active(u))) return "Nobody of yours is on the map.";
  return "";
}
/** Settle in: everyone still on the map moves in, the raid ends. "" or why not. */
export function settleIn(state, b) {
  const why = settleProblem(state, b);
  if (why) return why;
  const R = b.poiCamp;
  R.settled = true;
  for (const u of b.units) if (u.side === "player" && activeAny(u) && !u.aboard) { u.left = true; u.settled = true; }
  say(b, "Everyone on the map settles into the camp.", "good");
  endCalledOff(state); // the raid ends with everyone out (combat.js endRaid)
  return "";
}

// ---------- the raid's start and end ----------
/** A raid on a POI's map starts (combat.js createRaid, after poicont.js poiRaidStart): the half-built camp, or the camp. */
export function poiCampRaidStart(state, b) {
  if (!b || !b.raid || !b.setup || !b.setup.raid || b.setup.raid.poi == null) return;
  const i = b.setup.raid.poi, t = state.tiles[b.tileId], p = poiAt(t, i);
  if (!p) return;
  const base = poiBaseAt(state, b.tileId, i), mapId = raidMapId(b);
  const half = p.cont && p.cont.camp && p.cont.camp.mapId === mapId ? p.cont.camp : null;
  if (!base && !half) return;
  const R = campRec(b);
  if (base && base.poiCamp && base.poiCamp.mapId === mapId && base.poiCamp.w === b.w && base.poiCamp.h === b.h) {
    R.at = base.poiCamp.at.slice(); R.f = base.poiCamp.f; R.done = true; R.baseId = base.id; R.total = R.work = setupTotal(); R.safe = POICAMP.SAFE_TURNS; R.paid = {}; R.old = true;
    R.seen[R.f] = base.poiCamp.seen || "";
  } else if (half) {
    R.at = half.at.slice(); R.f = half.f; R.work = half.work; R.total = half.total; R.paid = { ...half.paid }; R.workers = [];
    say(b, `Your half-built camp is here as it was left: ${R.work}/${R.total}. Work on it from inside its 5 × 5.`, "info");
  }
}
/**
 * The raid ends (scavenge.js afterRaid, every way it ends): the half-built camp kept in the ledger, what was seen kept
 * with the camp, unfinished build sites into its queue, and the settled moving in. Returns the base when the team (or
 * some of it) settled in.
 */
export function poiCampAfterRaid(state, b, p) {
  const R = b && b.poiCamp;
  if (!R) return null;
  if (R.at && !R.done) keepHalfBuilt(state, b);
  const base = R.done ? state.bases.find((x) => x.id === R.baseId) : null;
  if (!base) return null;
  if (base.poiCamp && R.seen[R.f]) base.poiCamp.seen = seenRle(orMasks(unseenRle(base.poiCamp.seen, b.w * b.h), unseenRle(R.seen[R.f], b.w * b.h)));
  sitesToQueue(state, b, base);
  if (!R.settled || !p || !state.parties.includes(p)) return null;
  const ids = new Set(b.units.filter((u) => u.settled && !u.dead).map((u) => u.sid));
  const members = partyMembers(state, p);
  const stay = members.filter((s) => ids.has(s.id));
  if (!stay.length) return null;
  if (stay.length === members.length) settleInto(state, p, base); // the whole team moves in, its load into the stores
  else {
    for (const s of stay) { s.location = { kind: "base", baseId: base.id }; s.role = "scavenge"; }
    p.members = p.members.filter((id) => !ids.has(id));
  }
  base.lastPresent = state.hour;
  groundsFromPoi(state, base);
  askLayout(state, base, "camp"); // Open the build map (ui/buildmap.js)
  if (p.owner === "player") state.campOpen = base.id;
  log(state, `${stay.map((s) => s.name.split(" ")[0]).join(", ")} settle${stay.length === 1 ? "s" : ""} into ${base.name}.`, "good");
  return base;
}
const orMasks = (a, c) => { for (let i = 0; i < a.length; i++) if (c[i]) a[i] = 1; return a; };
// The POI's surviving dead as the camp's grounds (campscout.js base.grounds; #69 times the attacks, #71 keeps them by
// room): the count from deadpop.js poiDead, known (the raid saw the place).
function groundsFromPoi(state, base) {
  const n = poiDead(state, base.tile, base.poi);
  if (!(n > 0)) return;
  const g = base.grounds || {};
  base.grounds = { ...g, dead: n, dead0: g.dead0 || n, known: true, blind: false, poi: base.poi, next: g.next != null ? g.next : state.hour + 6, waves: g.waves || 0, killed: g.killed || 0, raids: g.raids || 0 };
}

// ---------- the camp's map never grows ----------
/**
 * Why a footprint cannot stand at `at` on a POI camp's map ("" when it can): basemap.js placeProblemAt asks it first.
 * occ: the base map's occupancy (a fitting may stand on a general building's floor put up in the yard).
 * @param {any} base @param {any} it @param {number[]} at @param {any} [occ]
 */
export function poiPlaceWhy(base, it, at, occ = null) {
  const P = base.poiCamp;
  if (!P) return "";
  const r = rectOf(it, at), seen = poiSeenMask(P);
  if (it.kind === "house" && r.w * r.h > POICAMP.YARD_AREA) return `${POICAMP.NO_ROOM} (only small builds fit in the yard)`;
  for (let gy = r.y0; gy < r.y0 + r.h; gy++) for (let gx = r.x0; gx < r.x0 + r.w; gx++) {
    const x = gx + P.at[0], y = gy + P.at[1];
    if (x < 0 || y < 0 || x >= P.w || y >= P.h) return `${POICAMP.NO_ROOM} (past its edge)`;
    if (!seen[y * P.w + x]) return POICAMP.UNKNOWN;
    const c = poiCellAt(P, x, y);
    if (c && CELL[c.k] && CELL[c.k].climb) return "On the stairs";
    if (!groundOk(c)) return `On ${c && CELL[c.k] ? CELL[c.k].name.toLowerCase() : "nothing"} (the building's walls and furniture stay)`;
    const hosted = !!(occ && occ.floor && occ.floor.has((gy + 2048) * 4096 + (gx + 2048)));
    const indoor = poiIndoor(P, x, y);
    if (it.fit && !indoor && !hosted) return "Only inside the building's rooms";
    if (!it.fit && !it.indoor && it.kind !== "vehicle" && indoor) return "Not inside the building: its rooms take fittings and indoor things";
  }
  return "";
}
const fitCache = new Map();
/** Does a build of this type fit anywhere on the camp's map (empty, seen ground)? (the Build list's "No room on this map") */
export function poiFits(base, type) {
  const P = base && base.poiCamp, f = FOOT[type];
  if (!P || !f) return true;
  const key = `${base.id}:${P.seen.length}:${P.seen.slice(0, 40)}:${type}`;
  if (fitCache.has(key)) return fitCache.get(key);
  const it = { ...f, type, key: null };
  let ok = false;
  for (let r = 0; r < (f.w === f.h ? 1 : 2) && !ok; r++) {
    const [w, h] = dimsOf(it, r);
    for (let y = -P.at[1]; y + h <= P.h - P.at[1] && !ok; y++) for (let x = -P.at[0]; x + w <= P.w - P.at[0] && !ok; x++) if (!poiPlaceWhy(base, it, [x, y, r])) ok = true;
  }
  if (fitCache.size > 2000) fitCache.clear();
  fitCache.set(key, ok);
  return ok;
}
/** Room left on the camp's map (siteinfo.js / the camp's panels): { yard, rooms, unknown } in cells. */
export function poiRoomLeft(state, base) {
  const P = base && base.poiCamp;
  if (!P) return null;
  const seen = poiSeenMask(P), occ = occupancy(state, base);
  let yard = 0, rooms = 0, unknown = 0;
  for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
    if (!seen[y * P.w + x]) { unknown++; continue; }
    const c = poiCellAt(P, x, y);
    if (!groundOk(c)) continue;
    const gx = x - P.at[0], gy = y - P.at[1], k = (gy + 2048) * 4096 + (gx + 2048);
    if (occ.foot.has(k) || inSquare(P.at, x, y)) continue;
    if (poiIndoor(P, x, y)) rooms++; else yard++;
  }
  return { yard, rooms, unknown };
}
export const roomWords = (r) => (r ? `room left on the map: ${r.yard} cells of yard, ${r.rooms} in the rooms${r.unknown ? `, ${r.unknown} unknown (fogged)` : ""}` : "");
/** The fog of a POI camp's base map view (basemap.js viewBattle): 1 where seen, in the view's cells. */
export function poiKnownMask(b, base) {
  const P = base.poiCamp, F = b.deployPlan && b.deployPlan.fort;
  if (!P || !F) return null;
  const seen = poiSeenMask(P), m = new Uint8Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const px = x - F.ox + P.at[0], py = y - F.oy + P.at[1];
    if (px >= 0 && py >= 0 && px < P.w && py < P.h && seen[py * P.w + px]) m[y * b.w + x] = 1;
  }
  return m;
}
/** A survey of the POI opens the whole map (survey.js; pois.js revealPois). */
export function poiCampSurveyed(state, tile) {
  for (const base of state.bases) if (base.tile === tile && base.poiCamp) base.poiCamp.seen = seenRle(new Uint8Array(base.poiCamp.w * base.poiCamp.h).fill(1));
}

// ---------- build mode on the raid map ----------
const campBase = (state, b) => (b && b.poiCamp && b.poiCamp.done ? state.bases.find((x) => x.id === b.poiCamp.baseId) || null : null);
/** Why build mode cannot open now ("" when it can). */
export function buildModeProblem(state, b) {
  if (!poiRaid(b)) return "Only on a raid map of your camp's place.";
  if (!campBase(state, b)) return "Only once the camp stands (set it up first).";
  if (b.phase !== "player") return "Only on your turn.";
  if (hostilesSeen(b).length) return "Not with the dead in sight.";
  return "";
}
export function setBuildMode(state, b, on) {
  if (on) { const why = buildModeProblem(state, b); if (why) return why; }
  b.poiCamp.build = !!on;
  return "";
}
// Map cell → the camp's grid (only on the camp's floor).
const toGrid = (R, x, y) => [x - R.at[0], y - R.at[1]];
/** Why a build of `type` cannot go with its top-left at map (x, y), turned r ("" when it can). */
export function buildPlaceProblem(state, b, type, x, y, r = 0) {
  const R = b.poiCamp, base = campBase(state, b);
  if (!R || !R.build) return "Open build mode first.";
  if (!base) return "No camp here.";
  if (floorOf(b) !== R.f) return "Only on the camp's floor.";
  const f = FOOT[type], def = BUILDINGS[type];
  if (!f || !def) return "That cannot be built on the map.";
  if (def.furniture) return "Furniture is set from the stores on the camp's map.";
  const chk = buildCheck(state, b, type);
  if (!chk.ok) return chk.reason || "Not here.";
  const it = { ...f, type, key: null, label: def.name };
  const at = [...toGrid(R, x, y), r & 3];
  const rect = rectOf(it, at), seen = seenOf(b, R.f);
  const occ = occupancy(state, base);
  for (const s of R.sites) markSite(occ, s);
  const why = placeProblemAt(base, it, at[0], at[1], at[2], occ);
  if (why) return why;
  const ghosts = Object.values(b.ghosts || {});
  for (let gy = rect.y0; gy < rect.y0 + rect.h; gy++) for (let gx = rect.x0; gx < rect.x0 + rect.w; gx++) {
    const mx = gx + R.at[0], my = gy + R.at[1];
    if (!seen[my * b.w + mx]) return POICAMP.UNKNOWN;
    if (b.units.some((u) => u.side === "enemy" && !u.dead && (u.f || 0) === R.f && u.x === mx && u.y === my && playerSees(b, u)) || ghosts.some((g) => g[0] === mx && g[1] === my && (g[3] || 0) === R.f)) return "Not cleared: the dead were seen there";
    if (b.units.some((u) => !u.dead && !u.left && !u.aboard && (u.f || 0) === R.f && u.x === mx && u.y === my)) return "Someone stands there";
  }
  return "";
}
/**
 * buildings.js canBuild for a build in build mode: its materials counted from the camp's stores and your survivors on
 * the map together (what siteMaterials takes them from). @param {any} state @param {any} b @param {string} type
 */
export function buildCheck(state, b, type) {
  const base = campBase(state, b);
  if (!base) return { ok: false, reason: "No camp here." };
  const people = b.units.filter((u) => u.side === "player" && active(u) && u.sid != null && u.vol == null), p = raidTeam(state, b), all = sharesOf(b);
  const keep = base.stock, stock = { ...keep };
  for (const k of Object.keys((BUILDINGS[type] && BUILDINGS[type].cost) || {})) stock[k] = Math.max(0, stock[k] || 0) + people.reduce((a, u) => a + unitHas(state, b, u, k, p, all), 0);
  base.stock = stock;
  try { return /** @type {any} */ (canBuild(state, base, type)); } finally { base.stock = keep; }
}
// A site's cells in an occupancy (so two sites do not overlap).
function markSite(occ, s) {
  const r = rectOf(FOOT[s.type], s.at);
  for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) occ.foot.set((y + 2048) * 4096 + (x + 2048), "c:site");
}
/** Places a build site (top-left at map x, y). "" or why not. */
export function placeBuildSite(state, b, type, x, y, r = 0) {
  const why = buildPlaceProblem(state, b, type, x, y, r);
  if (why) return why;
  const R = b.poiCamp, def = BUILDINGS[type];
  const site = { id: newId(), type, at: [...toGrid(R, x, y), r & 3], total: Math.max(1, Math.ceil((def.hours || 1) * POICAMP.AP_PER_HOUR)), work: 0, paid: null, cost: { ...(def.cost || {}) } };
  R.sites.push(site);
  say(b, `${def.name}: a build site staked out (${site.total} actions of work; its materials are taken when the work starts).`, "info");
  return "";
}
/** The map cells of a site. */
export const siteCells = (b, s) => { const r = rectOf(FOOT[s.type], s.at), out = []; for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) out.push([x + b.poiCamp.at[0], y + b.poiCamp.at[1]]); return out; };
const nextTo = (cells, u) => cells.some(([x, y]) => Math.max(Math.abs(x - u.x), Math.abs(y - u.y)) <= 1);
/** The sites a survivor can work from where they stand. */
export const sitesNear = (b, u) => (b.poiCamp && b.poiCamp.sites ? b.poiCamp.sites.filter((s) => (u.f || 0) === b.poiCamp.f && nextTo(siteCells(b, s), u)) : []);
// The materials of a site: the camp's stores first, then your survivors on the map. { got, short }.
function siteMaterials(state, b, base, s, take) {
  const short = {};
  const people = b.units.filter((u) => u.side === "player" && active(u) && u.sid != null && u.vol == null);
  for (const [k, n] of Object.entries(s.cost)) {
    if (!(n > 0)) continue;
    const store = Math.max(0, base.stock[k] || 0);
    const onMap = people.reduce((a, u) => a + unitHas(state, b, u, k, raidTeam(state, b), sharesOf(b)), 0);
    if (store + onMap + 1e-9 < n) { short[k] = Math.ceil(n - store - onMap); continue; }
    if (!take) continue;
    const a = Math.min(n, store);
    base.stock[k] = store - a;
    if (n - a > 0) takeFrom(state, b, people, k, n - a);
  }
  return short;
}
/** Why a survivor cannot work on a site now ("" when they can). */
export function buildWorkProblem(state, b, u, s) {
  const base = campBase(state, b);
  if (!base || !s) return "No build site here.";
  if (!u || u.side !== "player" || !active(u)) return "That survivor cannot act.";
  if (!(u.ap > 0)) return "No action left.";
  if (!nextTo(siteCells(b, s), u) || (u.f || 0) !== b.poiCamp.f) return "Stand inside or next to the site.";
  const cells = siteCells(b, s);
  if (b.units.some((e) => (e.side === "enemy" || (e.side === "third" && e.hostile)) && activeAny(e) && (e.f || 0) === b.poiCamp.f && cells.some(([x, y]) => x === e.x && y === e.y))) return "Stopped: a hostile is in the site. Kill it or push it out (nothing is lost).";
  if (!s.paid) { const short = Object.entries(siteMaterials(state, b, base, s, false)); if (short.length) return `Short: ${short.map(([k, n]) => `${n} ${keyWord(k)}`).join(", ")} (the camp's stores and your people on the map)`; }
  return "";
}
/** A survivor spends the actions they have left on a site (the one next to them, or act.site). "" or why not. */
export function workBuild(state, b, u, siteId = null) {
  const s = siteId != null ? (b.poiCamp && b.poiCamp.sites.find((x) => x.id === siteId)) : sitesNear(b, u)[0];
  const why = buildWorkProblem(state, b, u, s);
  if (why) return why;
  const base = campBase(state, b);
  if (!s.paid) { siteMaterials(state, b, base, s, true); s.paid = { ...s.cost }; }
  s.work = Math.min(s.total, s.work + u.ap);
  if (s.turn !== b.turn) { s.turn = b.turn; s.workers = []; }
  if (!s.workers.includes(u.id)) s.workers.push(u.id);
  u.ap = 0; u.hunker = false; b.acted = true;
  if (s.work >= s.total) finishSite(state, b, base, s);
  else say(b, `${u.name} works on the ${BUILDINGS[s.type].name.toLowerCase()}: ${s.work}/${s.total}.`, "info");
  return "";
}
// A site finished on the map: the building stands at its spot (and on the battle map at once, where it is a cell kind).
function finishSite(state, b, base, s) {
  b.poiCamp.sites = b.poiCamp.sites.filter((x) => x !== s);
  const nb = addBuilding(base, s.type);
  if (nb) nb.at = s.at.slice();
  const f = FOOT[s.type];
  if (f && f.k && CELL[f.k]) for (const [x, y] of siteCells(b, s)) { const c = cellsOn(b, b.poiCamp.f)[y * b.w + x]; if (c && groundOk(c)) { c.k = f.k; if (f.k === "barricade") { c.hp = c.mhp = 60; } } }
  say(b, `${BUILDINGS[s.type].name} finished: it stands at ${base.name}.`, "good");
}
// The raid ended with sites unfinished: into the camp's construction queue at their spots.
function sitesToQueue(state, b, base) {
  for (const s of (b.poiCamp.sites || [])) {
    const def = BUILDINGS[s.type];
    if (s.paid) base.construction.push({ id: newId(), type: s.type, progress: Math.round(((def.hours || 1) * s.work / s.total) * 100) / 100, hours: def.hours || 1, cost: { ...s.paid }, at: s.at.slice() });
    else { const n = base.construction.length; queueBuild(state, base, s.type); const job = base.construction.length > n ? base.construction[base.construction.length - 1] : null; if (job) job.at = s.at.slice(); }
  }
  b.poiCamp.sites = [];
}

// ---------- the order dispatcher (combat.js combatAct) ----------
export const POICAMP_ACTS = new Set(["campSetup", "campWork", "settleIn", "buildMode", "campBuild", "buildWork"]);
/** combat.js combatAct: the camp's orders. "" or why not. */
export function poiCampAct(state, b, act) {
  if (!poiRaid(b)) return "Only on a raid map of a place (a POI).";
  if (b.phase !== "player") return "Wait for your turn.";
  const u = act.unit != null ? unitById(b, act.unit) : null;
  if (act.type === "settleIn") return settleIn(state, b);
  if (act.type === "buildMode") return setBuildMode(state, b, act.on !== false);
  if (act.type === "campBuild") return placeBuildSite(state, b, act.build, act.x, act.y, act.r || 0);
  if (act.type === "campSetup") return startSetup(state, b, u, act.x, act.y);
  if (act.type === "campWork") return workSetup(state, b, u);
  if (act.type === "buildWork") return workBuild(state, b, u, act.site ?? null);
  return "";
}

// ---------- the autopilot and the governor ----------
/** The governor's rule (#64 §4): a camp in a POI only when its dead are low or fewer and the team can answer Defend. */
export function govPoiCampOk(state, tile, i, fighters) {
  if (poiCampProblem(state, tile, i)) return false;
  return deadBand(state, tile, i).band <= 1 && fighters >= 2;
}
/** The game's own 5 × 5 for a raid: the valid spot nearest your people's middle (no dice), or null. */
export function bestSquare(state, b) {
  const mine = b.units.filter((u) => u.side === "player" && active(u) && (u.f || 0) === floorOf(b));
  if (!mine.length) return null;
  const mx = mine.reduce((a, u) => a + u.x, 0) / mine.length, my = mine.reduce((a, u) => a + u.y, 0) / mine.length;
  const cand = [];
  for (let y = POICAMP.HALF; y < b.h - POICAMP.HALF; y++) for (let x = POICAMP.HALF; x < b.w - POICAMP.HALF; x++) cand.push([Math.hypot(x - mx, y - my), x, y]);
  cand.sort((a, c) => a[0] - c[0] || a[2] - c[2] || a[1] - c[1]);
  for (const [, x, y] of cand.slice(0, 400)) {
    const cells = cellsOn(b, floorOf(b)), seen = seenOf(b);
    if (squareCells(x, y).every(([cx, cy]) => seen[cy * b.w + cx] && groundOk(cells[cy * b.w + cx])) && !hostilesIn(b, [x, y], floorOf(b)).length) return [x, y];
  }
  return null;
}
/**
 * The battle AI on your side (combat.js autoRaidTurn): the setup worked by whoever is inside, sites worked, Settle in at 0.
 * A team told to camp here (setup.raid.camp) under the governor's rule starts it on the game's spot round it.
 * Returns true when the team holds at its camp this turn (nothing in sight): the raid AI is not run.
 */
export function botPoiCamp(state, b) {
  if (!poiRaid(b)) return false;
  const R = campRec(b);
  if (R.done && !settleProblem(state, b)) { settleIn(state, b); return true; }
  if (!R.at && b.setup.raid.camp) {
    const mine = b.units.filter((u) => u.side === "player" && active(u));
    if (govPoiCampOk(state, b.tileId, R.poi, mine.length)) {
      const at = bestSquare(state, b);
      const u = at ? mine.find((m) => inSquare(at, m.x, m.y)) || null : null;
      if (at && u && !setupProblem(state, b, u, at[0], at[1])) startSetup(state, b, u, at[0], at[1]);
    }
  }
  if (R.at && !R.done) for (const u of b.units) if (u.side === "player" && !workProblem(b, u)) workSetup(state, b, u);
  if (R.done) for (const u of b.units) if (u.side === "player" && active(u) && u.ap > 0 && sitesNear(b, u).length && !buildWorkProblem(state, b, u, sitesNear(b, u)[0])) workBuild(state, b, u);
  // A team sent to camp here holds at its camp while nothing is in sight (the raid's search and its way out are not
  // its job now); with the dead in sight the battle AI fights as ever.
  return !!(b.setup.raid.camp && R.at && !hostilesSeen(b).length);
}

// ---------- other groups find your camp ----------
/**
 * Another group raiding POI i finds your camp there (grouppois.js raidPoiAsGroup): true when it does (no loot by the
 * numbers then). The place is marked as your base in their knowledge (base.poiCamp.knownBy); a group (factions.js)
 * hostile to you raids the base (launchRaidOnBase: fought on the POI's map), at most once a day a camp. Others (visitor
 * bands, nomads, hardcore bands) turn away.
 */
export function poiCampFoundBy(state, who, tile, i) {
  const base = poiBaseAt(state, tile, i);
  if (!base) return false;
  const P = base.poiCamp;
  const id = who && who.id != null ? who.id : null;
  if (P && id != null) { if (!Array.isArray(P.knownBy)) P.knownBy = []; if (!P.knownBy.includes(id)) P.knownBy.push(id); }
  const f = who && Array.isArray(who.bases) && who.alive && state.factions.includes(who) ? who : null;
  if (f && base.foundBy !== day(state) && attitude(f) === "Hostile") {
    base.foundBy = day(state);
    launchRaidOnBase(state, f, base);
  }
  return true;
}
// For the panels: everyone of yours at the camp now.
export const poiCampPeople = (state, base) => atBase(state, base.id);
