// Tactical combat screen: canvas battle map plus the side panel. Reads state.combat; all rules live in sim/combat.js.
import {
  MAP_W, MAP_H, CELL, COVER_DEF, active, unitAt, unitById, evacAt, reachable, pathTo, shotOdds, meleeOdds, retreatPlan, retreatRefusal,
  canSee, coverSides, isRanged, adjacent, canFire, ammoLeft, medsLeft, combatAct, enemyStep, playerSees,
  los, autoResolveCombat, finishCombat, closeCombat, zoneAt, boxAt, searchableNear, nearBox, boxCenter, DRIVE, AREAS, areaHint, HEAT_NAMES,
  playerVision, enemyGhosts, heightAt, HEIGHT, sightRange, structureName, barredCell, doorHeld, WEAPONS, CRIT_MULT, hitMult,
} from "../sim/combat.js";
import * as SIM from "../sim/combat.js"; // setFloor and stairOptions (docs/multi-storey-crawl.md), looked up when present
import { MILDEAD, armorVs, stabsGap } from "../sim/deadsoldiers.js";
import { windowsNear, BMAP, peekOptions, closeOptions, braceOptions } from "../sim/buildingmaps.js";
import { INTERIOR } from "../sim/interior.js";
import { clearEnough } from "../sim/battlesize.js";
import { SUPPLIES, GEAR } from "../sim/data.js";
import { subdueOdds, canSubdue, throwablesOf, THROWABLES, THROW_KEYS, dragable, searchCost, STEALTH } from "../sim/stealth.js";
import { canPlace, LIT_ZONES } from "../sim/deploy.js";
import { partyCapacity, cargoLoad, poolLoad } from "../sim/parties.js";
import { bodyEmpty } from "../sim/inventory.js";
import { atVehicle, personalLoad, trunkInfo } from "../sim/raidloot.js";
import { SEARCH, quickable, quickRefusal, quickRadius } from "../sim/search.js";
export const QUICK_MARK = "#7fb8e6"; // a container rummaged through but not searched in full (both views)
import { unitCanvas, unitFacing, drawSprite, canvasURL, spriteImg } from "./sprites.js";
import { unitDownCanvas, drawDowned, downScale, corpseCanvas } from "./downsprites.js";
import { lockPanel, raidKeyLine, lockPreview, drawLocks } from "./locks.js";
import { ZTYPES, CARRIER } from "../sim/hiveconst.js";
import { ACID, acidAt } from "../sim/acid.js";
import { thirdRing } from "../sim/thirdside.js";
import { ladderTargets, pushable, pushChance, ramTargets, ramOf, dropTargets, battleOverlays, RAM, LADDER, DROP } from "../sim/siege.js";
import { herded, sensesOf } from "../sim/decoys.js";
import { crushable, tappable, liftable, carriedBy, carHere, endangered, imminent, bodyAt as humanBodyAt, bodyName, unitBodyLoad, carRoom } from "../sim/carriers.js"; // the Carrier: bodies in danger, the risen, bodies carried, shot or burnt
import { iso, drawIso, isoPick, isoRotate, isoZoom, isoPan, isoEdge, isoCenterOn, isoOnScreen, setRoofs, floorsOf, floorNo, onFloor } from "./isoview.js";
// Ground-ring colors of a hive's special dead (sim/zombietypes.js); ordinary dead keep the green ring.
const ZRING = { runner: "#ffb43b", brute: "#c8c4b0", spitter: "#9ad63a", screamer: "#c99ae0", crawler: "#6ab0c8", shepherd: "#e8e2ff", soldier: "#a8b878", riot: "#8aa0c8", carrier: "#e6d8a8", swarm: "#f0e4c0", boneback: "#d8b48a", climber: "#8fd0a0", flinger: "#e8a0c8", sower: "#e8e070", nightmare: "#e0506e", sleeper: "#b0d8ff" };

// Battle size; raids use a bigger map. Set from the battle in sync().
let W = MAP_W, H = MAP_H;
const ENEMY_STEP_MS = 420;

export const cui = { battle: null, sel: null, mode: "move", hover: null, msg: "", lastStep: 0, anim: new Map(), cache: { key: "" } };
let canvas = null, ctx = null;
const geo = { cs: 40, ox: 0, oy: 0 };

export function initCombatUI(cv) {
  canvas = cv;
  ctx = cv.getContext("2d");
}

// The battle view (ui/isoview.js): "iso" (isometric, the default) or "top" (the flat top-down grid below). Options
// → Display → Battle view, I in a battle, or the panel's view bar; remembered in this browser.
const VIEW_KEY = "brokenstate.battleView";
cui.view = (() => { try { return typeof localStorage !== "undefined" && localStorage.getItem(VIEW_KEY) === "top" ? "top" : "iso"; } catch { return "iso"; } })();
export function setBattleView(v) {
  cui.view = v === "top" ? "top" : "iso";
  try { localStorage.setItem(VIEW_KEY, cui.view); } catch { /* this session only */ }
}
const isIso = () => cui.view !== "top";

// ---------- floors (docs/multi-storey-crawl.md) ----------
// A building with storeys: b.floors, b.floor the active one, u.f a unit's floor; sim/combat.js setFloor swaps the
// aliases (until it lands, the same swap is done here). The view follows the selected unit's floor; PageUp /
// PageDown and the view bar's Floor control change it by hand. Every battle without b.floors is untouched.
export function setViewFloor(b, f) {
  const F = floorsOf(b);
  if (!F) return false;
  f = Math.max(0, Math.min(F.length - 1, f | 0));
  if (f === floorNo(b)) return false;
  if (typeof SIM.setFloor === "function") SIM.setFloor(b, f);
  else { b.floor = f; b.cells = F[f].cells; b.reach = F[f].reach; b.losCache = F[f].losCache; }
  cui.cache.key = ""; // what is seen and where the selected unit can go are the floor's
  cui.hover = null;
  return true;
}
// To the selected unit's floor (or the unit given).
function followFloor(b, u = selUnit(b)) {
  if (u && u.f != null && floorsOf(b) && u.f !== floorNo(b)) setViewFloor(b, u.f);
}
// On a stairwell: which way the unit can go (the sim's stairOptions when present, else the cell's kind).
function stairsOf(b, u) {
  const F = floorsOf(b);
  if (!F || !u) return { up: false, down: false };
  if (typeof SIM.stairOptions === "function") { const o = SIM.stairOptions(b, u) || {}; return { up: !!o.up, down: !!o.down }; }
  const onStairs = b.cells[u.y * W + u.x].k === "stairs" && onFloor(b, u);
  return { up: onStairs && floorNo(b) < F.length - 1, down: onStairs && floorNo(b) > 0 };
}
const floorLabel = (b, f) => `Floor ${f + 1} of ${floorsOf(b).length}`;
// Still in the fight, whatever floor they are on (sim/combat.js active() counts a unit on another floor as off the
// map for the active floor; the team list, Tab and the number keys must still reach them).
const alive = (u) => !u.dead && !u.down && !u.left && !u.fled && !u.off;
// A cell's rules, with a stand-in for `void` (outside the footprint on an upper floor) until the sim knows it.
const VOIDDEF = { walk: false, cover: 0, los: false, name: "Open air" };
const CDEF = (c) => CELL[c.k] || VOIDDEF;

// ---------- helpers ----------
const players = (b) => b.units.filter((u) => u.side === "player");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (u) => Math.max(0, Math.min(1, u.hp / u.maxHp));
const hpColor = (f) => (f > 0.6 ? "#6cc48a" : f > 0.3 ? "#e0a84f" : "#e2685f");

// New battle: reset the screen state.
function sync(b) {
  W = b.w; H = b.h;
  if (cui.battle === b) return;
  cui.battle = b;
  cui.sel = null;
  cui.mode = "move";
  cui.msg = "";
  cui.hover = null;
  cui.anim.clear();
  cui.salt = Math.floor(Math.random() * 9973); // varies zombie / enemy looks between battles
  cui.lastStep = performance.now();
  for (const f of b.fx) cui.anim.set(f.seq, performance.now());
  autoSelect(b);
}

function autoSelect(b) {
  const cur = cui.sel != null ? unitById(b, cui.sel) : null;
  if (cur && cur.side === "player" && alive(cur) && cur.ap > 0) return;
  const next = players(b).find((u) => alive(u) && u.ap > 0);
  cui.sel = next ? next.id : cur && alive(cur) ? cur.id : null;
  cui.mode = "move";
  if (cui.sel != null && (!cur || cui.sel !== cur.id)) followFloor(b); // a new pick: the view goes to its floor
}

// Cached per battle revision: what the player sees, and where the selected unit can go.
function view(b) {
  const key = `${b.rev}:${cui.sel}:${floorNo(b)}`;
  if (cui.cache.key === key) return cui.cache;
  // Fog of war (sim/combat.js playerVision): what your people see now, by height, light, night and optics; the
  // enemies they see; ghosts where unseen ones were last seen.
  const vis = playerVision(b);
  const u = selUnit(b);
  const reach = u && active(u) && u.ap > 0 && b.phase === "player" ? reachable(b, u, u.mob * u.ap, { manual: true }) : null; // an order by hand may walk into fire
  const seen = new Set(b.units.filter((e) => e.side !== "player" && active(e) && (b.over || playerSees(b, e))).map((e) => e.id)); // the enemy and the third side (sim/thirdside.js)
  const ghosts = b.over ? [] : enemyGhosts(b);
  cui.cache = { key, vis, reach, seen, u, ghosts };
  return cui.cache;
}

const selUnit = (b) => (cui.sel != null ? unitById(b, cui.sel) : null);

// ---------- input ----------
function cellFromPx(px, py) {
  if (isIso() && cui.battle) { const c = isoPick(cui.battle, px, py); return c ? { x: c.x, y: c.y } : null; }
  const x = Math.floor((px - geo.ox) / geo.cs), y = Math.floor((py - geo.oy) / geo.cs);
  return x >= 0 && y >= 0 && x < W && y < H ? { x, y } : null;
}

export function combatMouse(state, px, py) {
  const b = state.combat;
  if (!b) return;
  sync(b);
  // Dragging pans the isometric view (the click it started is not made).
  if (cui.drag && isIso()) {
    const d = cui.drag;
    if (!d.moved && Math.hypot(px - d.x0, py - d.y0) > 6) d.moved = true;
    if (d.moved) { isoPan(b, px - d.px, py - d.py); d.px = px; d.py = py; return; }
  }
  if (isIso() && canvas) isoEdge(px, py, canvas.clientWidth, canvas.clientHeight, performance.now());
  const c = cellFromPx(px, py);
  cui.hover = c ? { ...c, px, py } : null;
  const el = typeof document !== "undefined" && document.getElementById("cbprev");
  if (el) el.innerHTML = previewHtml(b);
}
export function combatLeave() { cui.hover = null; cui.drag = null; isoEdge(null); }

// The mouse on the battle map (main.js): in the isometric view a press that moves pans the view and a press that
// does not is a click (left: the usual click; right: cancel the current action); the top-down view clicks at once.
// Returns true when the press was a click main.js should act on now.
export function combatPress(state, px, py, button) {
  if (!state.combat) return false;
  if (!isIso()) return button === 0;
  cui.drag = { x0: px, y0: py, px, py, moved: false, button };
  return false;
}
export function combatRelease(state, px, py) {
  const d = cui.drag;
  cui.drag = null;
  if (!state.combat || !isIso() || !d) return null;
  return d.moved ? "drag" : d.button === 0 ? "click" : d.button === 2 ? "cancel" : null;
}
export function combatWheel(state, px, py, dy) {
  const b = state.combat;
  if (!b || !isIso()) return false;
  sync(b);
  isoZoom(b, dy < 0 ? 1 : -1, px, py);
  return true;
}
// Selecting a unit that is off screen brings the camera to it.
function follow(b) {
  const u = selUnit(b);
  followFloor(b, u);
  if (u && isIso() && !isoOnScreen(b, u.x, u.y)) isoCenterOn(b, u.x, u.y);
}

function act(state, a) {
  const b = state.combat;
  const err = combatAct(state, a);
  cui.msg = err || "";
  if (!err && a.type !== "end") {
    const u = unitById(b, a.unit);
    if (u && u.side === "player") followFloor(b, u); // Go up / Go down: the view goes with them
    if (!u || !active(u) || u.ap < 1 || ["throw", "drag", "tie", "subdue", "peek", "close", "brace", "doubletap", "pickup", "crush", "goup", "godown", "drive", "loadRam", "unloadRam"].includes(a.type)) cui.mode = "move";
  }
  autoSelect(b);
  return !err;
}

export function combatClick(state, px, py) {
  const b = state.combat;
  if (!b || b.over) return;
  sync(b);
  // The marker of a unit on another floor (ui/isoview.js): jump to that floor (and select them if they are yours).
  if (isIso() && floorsOf(b)) {
    const p = isoPick(b, px, py);
    const t = p && p.unit != null ? unitById(b, p.unit) : null;
    if (t && t.f != null && t.f !== floorNo(b)) {
      setViewFloor(b, t.f);
      if (t.side === "player" && alive(t)) { cui.sel = t.id; cui.mode = "move"; cui.msg = ""; }
      return;
    }
  }
  if (b.phase === "deploy") return void deployClick(state, b, px, py);
  if (b.phase !== "player") { cui.msg = "Wait for the enemy turn to finish."; return; }
  const c = cellFromPx(px, py);
  if (!c) return;
  const v = view(b);
  const u = selUnit(b);
  const who = unitAt(b, c.x, c.y);
  // The team's vehicle (sim/combat.js driveTo): Drive, then click where it goes.
  if (u && active(u) && u.ap > 0 && cui.mode === "drive") return void act(state, { type: "drive", unit: u.id, x: c.x, y: c.y });
  // A tank trap next to the unit (sim/combat.js CELL.tanktrap, a bridge barricade's): a blow at it.
  if (u && active(u) && u.ap > 0 && cui.mode === "move" && !who && b.cells[c.y * W + c.x].k === "tanktrap" && Math.max(Math.abs(u.x - c.x), Math.abs(u.y - c.y)) <= 1) return void act(state, { type: "melee", unit: u.id, x: c.x, y: c.y });
  // The stealth kit (sim/stealth.js): throw at a tile, drag a body (pick it, then where to), tie up the knocked out.
  if (u && active(u) && u.ap > 0 && cui.mode === "throw") return void act(state, { type: "throw", unit: u.id, item: cui.throwKey, x: c.x, y: c.y });
  if (u && active(u) && u.ap > 0 && cui.mode === "drag") {
    if (cui.dragId == null) {
      const body = bodyAt(b, c.x, c.y);
      if (!body || !adjacent(u, body)) { cui.msg = "Click a body, someone knocked out or a downed teammate right next to you."; return; }
      cui.dragId = body.id;
      cui.msg = `Now click where to drag ${body.dead ? `${body.name}'s body` : body.name} (up to ${STEALTH.DRAG} tiles).`;
      return;
    }
    const id = cui.dragId;
    cui.dragId = null;
    return void act(state, { type: "drag", unit: u.id, target: id, x: c.x, y: c.y });
  }
  if (u && active(u) && u.ap > 0 && cui.mode === "tie") {
    const t = b.units.find((o) => o.side === "enemy" && o.ko && !o.dead && o.x === c.x && o.y === c.y);
    if (t) return void act(state, { type: "tie", unit: u.id, target: t.id });
  }
  // The worm (sim/carriers.js): a body clicked for Double tap, Pick up body or Crush skull.
  if (u && active(u) && u.ap > 0 && (cui.mode === "doubletap" || cui.mode === "pickup" || cui.mode === "crush")) {
    const body = humanBodyAt(b, c.x, c.y);
    if (!body) { cui.msg = cui.mode === "doubletap" ? "Click a body in sight to put a round through its head." : cui.mode === "pickup" ? "Click a body right next to you to pick it up." : "Click a body right next to you to crush its skull."; return; }
    return void act(state, { type: cui.mode, unit: u.id, target: body.id });
  }
  if (who && who.side === "player") {
    if (cui.mode === "meds" && u && (who === u || adjacent(u, who))) return void act(state, { type: "meds", unit: u.id, target: who.id });
    cui.sel = who.id;
    cui.mode = "move";
    cui.msg = "";
    return;
  }
  // Raids (sim/raidloot.js): a container already gone through, or the vehicle, opens the search window (no action).
  if (b.raid && u && active(u)) {
    const box = boxAt(b, c.x, c.y);
    if (box && box.contents && nearBox(u, box) && (!CDEF(b.cells[c.y * W + c.x]).walk || (u.x === c.x && u.y === c.y))) return void openSearch(state, b, u, box);
    if (b.cells[c.y * W + c.x].k === "vehicle" && (b.raid.hasVehicle ?? b.raid.vehicleZone >= 0)) {
      if (atVehicle(b, u)) { cui.lootReq = { uid: u.id, box: null }; return; }
      cui.msg = "Walk to the vehicle to load or unload it.";
      return;
    }
  }
  if (!u || !active(u) || u.ap < 1) { cui.msg = "Pick a unit that still has actions."; return; }
  if (who && who.side === "enemy" && active(who) && v.seen.has(who.id)) return void attack(state, u, who);
  // The third side (sim/thirdside.js): attacking them takes a second click, and turns them (or all the soldiers) on you.
  if (who && who.side === "third" && active(who) && v.seen.has(who.id)) {
    if (cui.thirdAsk === who.id) { cui.thirdAsk = null; return void attack(state, u, who); }
    cui.thirdAsk = who.id;
    cui.msg = who.team === "military" ? `${who.name} is a soldier, not your enemy. Click again to attack: every soldier here will fight back, and their group will not forget it.` : `${who.name} is not with the enemy. Click again to attack them: their group will fight back.`;
    return;
  }
  // Raids: click a container next to the selected unit to search it.
  // A door picked for Peek, Close door or Brace (sim/buildingmaps.js).
  if (u && active(u) && ["peek", "close", "brace"].includes(cui.mode)) return void act(state, { type: cui.mode, unit: u.id, x: c.x, y: c.y });
  if (b.raid) {
    // A window right next to the selected unit (sim/buildingmaps.js): climb through it.
    if (b.raid.interior && b.cells[c.y * W + c.x].k === "window" && windowsNear(b, u).some((o) => o.x === c.x && o.y === c.y)) return void act(state, { type: "climb", unit: u.id, x: c.x, y: c.y });
    const box = boxAt(b, c.x, c.y);
    if (box && !box.searched && (!CDEF(b.cells[c.y * W + c.x]).walk || (u.x === c.x && u.y === c.y))) {
      if (nearBox(u, box)) return void openSearch(state, b, u, box);
      cui.msg = "Move next to it to search.";
      return;
    }
  }
  if (cui.mode !== "move") { cui.mode = "move"; cui.msg = ""; return; }
  if (v.reach && isFinite(v.reach.dist[c.y * W + c.x]) && v.reach.dist[c.y * W + c.x] > 0) act(state, { type: "move", unit: u.id, x: c.x, y: c.y });
  else cui.msg = "Out of reach.";
}

// Search: the first look costs the action and rolls what is inside (sim/combat.js searchBox); then the search window
// (ui/inventory.js) opens over the battle to take things by hand. Nothing inside: no window, the log says so.
// full: S or the Search button also does the full search (1 action) of one only rummaged through (sim/search.js);
// a click on the map opens a rummaged one for free (its window has the full-search button). quick: the rummage.
function openSearch(state, b, u, box, { full = false, quick = false } = {}) {
  const near = searchableNear(b, u);
  box = box || (quick ? quickable(near)[0] : near.find((c) => !c.contents || c.quick) || near[0]);
  if (!box) { cui.msg = quick ? "Stand next to something nobody has opened yet (yellow ? marker) to rummage through it." : "Stand next to an unsearched container (yellow box marker) to search it."; return; }
  if (quick) { if (!act(state, { type: "search", unit: u.id, box: box.id, open: true, quick: true })) return; }
  else if ((!box.contents || (full && box.quick)) && !act(state, { type: "search", unit: u.id, box: box.id, open: true })) return;
  const n = box.contents ? box.contents.gear.length + Object.values(box.contents.sup).filter((v) => v >= 1).length : 0;
  if (n || atVehicle(b, u) || box.partial || box.quick) cui.lootReq = { uid: u.id, box: box.id };
  else cui.msg = `Nothing useful in the ${box.kind === "body" ? box.label : box.label.toLowerCase()}.`;
}

// A body, someone knocked out or a downed teammate on a tile (things Drag can move).
function bodyAt(b, x, y) {
  return b.units.find((o) => o.x === x && o.y === y && !o.fled && !o.left && dragable(o)) || null;
}

// Deploy step (sim/deploy.js): click a defender to pick them, then a green cell to put them there.
function deployClick(state, b, px, py) {
  const c = cellFromPx(px, py);
  if (!c) return;
  const who = unitAt(b, c.x, c.y);
  if (who && who.side === "player" && who.id !== cui.sel) { cui.sel = who.id; cui.msg = ""; return; }
  const u = selUnit(b);
  if (!u) { cui.msg = "Click one of your people first."; return; }
  act(state, { type: "place", unit: u.id, x: c.x, y: c.y });
}

function attack(state, u, t) {
  const b = state.combat;
  if (cui.mode === "subdue") {
    if (!canSubdue(u, t)) { cui.msg = "Subdue needs them right next to you."; return; }
    return void act(state, { type: "subdue", unit: u.id, target: t.id });
  }
  const wantMelee = cui.mode === "melee" || (!canFire(b, u) && adjacent(u, t));
  if (wantMelee) {
    if (!adjacent(u, t)) { cui.msg = "Melee needs the target right next to you."; return; }
    return void act(state, { type: "melee", unit: u.id, target: t.id });
  }
  if (!isRanged(u)) { cui.msg = `${u.name} has no gun. Move next to the target and use Melee.`; return; }
  if (!canFire(b, u)) { cui.msg = "Out of ammo. Melee only."; return; }
  if (!canSee(b, u, t)) { cui.msg = "No line of sight from here."; return; }
  act(state, { type: "shoot", unit: u.id, target: t.id });
}

// ---------- ending the turn (review U-18) ----------
// Space is pause on the State Map, so a habitual Space must not throw away a turn: while units still have
// actions, the first Space (or End turn click) asks in the panel and a second Space, a second click or Enter
// ends it. The question lapses as soon as anything happens on the map (b.rev) or the turn changes. It can be
// switched off (the panel's checkbox), remembered in the browser when storage works.
const CONFIRM_KEY = "brokenstate.confirmEndTurn";
cui.confirmEnd = (() => { try { return typeof localStorage === "undefined" || localStorage.getItem(CONFIRM_KEY) !== "0"; } catch { return true; } })();
cui.endAsk = null; // { turn, rev } of the open question
export const unitsWithActions = (b) => players(b).filter((u) => active(u) && u.ap > 0).length;

// Pure rule (fieldtest): what a press does. key "space" | "enter" | "button"; asked: a question is open for
// this turn and nothing happened since. Returns "end" or "ask".
export function endTurnDecision({ left, asked, confirm, key }) {
  if (!confirm || left <= 0 || key === "enter" || asked) return "end";
  return "ask";
}

export function requestEndTurn(state, key) {
  const b = state.combat;
  if (!b || b.over || b.phase !== "player") return "";
  const asked = !!cui.endAsk && cui.endAsk.turn === b.turn && cui.endAsk.rev === b.rev;
  const left = unitsWithActions(b);
  if (endTurnDecision({ left, asked, confirm: cui.confirmEnd, key }) === "ask") {
    cui.endAsk = { turn: b.turn, rev: b.rev, left };
    return "ask";
  }
  cui.endAsk = null;
  act(state, { type: "end" });
  return "end";
}

// After falling back to the yard (sim/interior.js) the battle opens a short redeploy. With this on, your people keep
// the default posts and the fight goes straight on (remembered in this browser).
const REDEPLOY_KEY = "brokenstate.autoRedeploy";
cui.autoRedeploy = (() => { try { return typeof localStorage !== "undefined" && localStorage.getItem(REDEPLOY_KEY) === "1"; } catch { return false; } })();
export function setAutoRedeploy(on) {
  cui.autoRedeploy = !!on;
  try { localStorage.setItem(REDEPLOY_KEY, on ? "1" : "0"); } catch { /* storage blocked: this session only */ }
}
const isRedeploy = (b) => !!(b && b.phase === "deploy" && b.tier && b.tier.map === "interior" && b.tier.fellBackTurn != null);

export function setConfirmEnd(on) {
  cui.confirmEnd = !!on;
  cui.endAsk = null;
  try { localStorage.setItem(CONFIRM_KEY, on ? "1" : "0"); } catch { /* storage blocked: this session only */ }
}

const endAskOpen = (b) => !!cui.endAsk && cui.endAsk.turn === b.turn && cui.endAsk.rev === b.rev && b.phase === "player" && !b.over;

// ---------- sounding the retreat (sim/combat.js soundRetreat) ----------
// The button (or Shift+R) opens a confirm in the panel with each unit's odds of getting out and who carries whom;
// Sound the retreat (or Enter) gives the order, Keep fighting (or Esc) closes it. It lapses when anything happens.
cui.retreatAsk = null; // { turn, rev, leave: [downed unit ids the player chose not to carry] }
cui.fallAsk = null; // { turn, rev } of the open "fall back to the yard?" question (the wall map)
export const fallAskOpen = (b) => !!cui.fallAsk && cui.fallAsk.turn === b.turn && cui.fallAsk.rev === b.rev && b.phase === "player" && !b.over && !!b.tier && b.tier.map === "wall";
export const retreatAskOpen = (b) => !!cui.retreatAsk && cui.retreatAsk.turn === b.turn && cui.retreatAsk.rev === b.rev && b.phase === "player" && !b.over;
let planCache = { key: "", plan: null };
function askPlan(b) {
  const leave = (cui.retreatAsk && cui.retreatAsk.leave) || [];
  const key = `${b.rev}:${leave.join(",")}`;
  if (planCache.key !== key || planCache.b !== b) planCache = { key, b, plan: retreatPlan(b, leave) };
  return planCache.plan;
}
const oddsClass = (c) => (c >= 75 ? "good" : c >= 45 ? "warn" : "danger");

// The confirm: per unit the odds (hover for the sum), carrying, the chance of being lost; the downed and who
// carries them (a button to leave them instead); what the retreat costs. Pure HTML from the plan (fieldtest-safe).
export function retreatConfirmHtml(b, plan) {
  const n = plan.units.length;
  const rows = plan.units.map((p) => {
    const lost = Math.round((1 - p.chance / 100) * p.lostIfCaught * 100);
    const tip = p.safe ? (p.onStrip ? "On the strip with nobody next to them: gets out." : "Nobody close, in sight or next to them: gets out.")
      : `100 ${p.parts.map(([l, v]) => `${v > 0 ? "+" : "−"} ${Math.abs(v)} ${l}`).join(" ")} = ${p.chance}% (between 5 and 95). If caught: ${Math.max(1, p.pinned)} blow${p.pinned > 1 ? "s" : ""} of 18–32 before armor${p.lostIfCaught ? `, ${Math.round(p.lostIfCaught * 100)}% that it puts them down and they are left behind` : "; they would tear free and get out hurt"}${p.carrying != null ? ", and whoever they carry is dropped" : ""}.`;
    return `<div class="spread" data-tip="${esc(tip)}"><span>${esc(p.name)}${p.carryingName ? ` <span class="muted small">carrying ${esc(p.carryingName)}</span>` : ""}</span>
      <span>${lost ? `<span class="danger small">${lost}% lost</span> ` : ""}<b class="${p.safe ? "good" : oddsClass(p.chance)}">${p.safe ? "safe" : `${p.chance}%`}</b></span></div>`;
  }).join("");
  const downed = plan.downed.map((d) => {
    const fate = d.onStrip ? `<span class="good">on the strip: carried out</span>` : d.by ? `<span class="good">carried by ${esc(d.by)}</span>` : d.left && d.canCarry ? `<span class="danger">left behind</span>` : `<span class="danger">nobody next to them: left behind</span>`;
    const toggle = d.canCarry ? ` <button class="mini" data-action="cb-retreat" data-v="toggle" data-id="${d.id}" data-tip="${esc(d.left ? `Carry ${d.name} out (slower: the carrier's odds drop).` : `Leave ${d.name} behind: the carrier runs free. Someone downed and left behind is lost.`)}">${d.left ? "Carry" : "Leave"}</button>` : "";
    return `<div class="spread small"><span>${esc(d.name)} <span class="muted">(down, ${d.stab ? "stabilized: lives if carried out" : "bleeding: about half pull through if carried out"})</span></span><span>${fate}${toggle}</span></div>`;
  }).join("");
  const behind = plan.downed.filter((d) => !d.onStrip && !d.by).length;
  return `<div class="small cbmsg cbconfirm cbretreat"><b class="danger">Sound the retreat?</b> Everyone still standing runs for the evac strip now. Each one's chance to get away is below (hover it for why); the caught take a blow from each enemy next to them, and anyone it puts down is left behind.
    <div class="cbodds" style="margin:0.35rem 0">${rows}${downed ? `<div class="muted small" style="margin-top:0.25rem">Downed:</div>${downed}` : ""}</div>
    <div class="small">Expected out: <b>${plan.expected.toFixed(1)}</b> of ${n} standing${plan.lost >= 0.05 ? ` · likely lost when caught: <b class="danger">${plan.lost.toFixed(1)}</b>` : ""}${behind ? ` · left behind: <b class="danger">${behind}</b>` : ""}. The fight counts as a retreat: no bodies to loot, and the enemy keeps the field.</div>
    <div style="margin-top:0.35rem"><button class="primary" data-action="cb-retreat" data-v="go" data-tip="Give the order. (Enter)">Sound the retreat</button>
    <button data-action="cb-retreat" data-v="cancel" data-tip="Close this and keep fighting. (Esc)">Keep fighting</button></div></div>`;
}

// The view's keys: I switches isometric / top-down; PageUp / PageDown change the floor in a building with storeys
// (both views); in the isometric view , and . turn it, + and − zoom, V centers on the selected unit, B shows or
// hides the roofs, the arrow keys pan (held).
const PAN_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
function viewKey(state, b, e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.code === "KeyI" && !e.shiftKey) { setBattleView(isIso() ? "top" : "iso"); return true; }
  if (e.code === "PageUp" || e.code === "PageDown") {
    if (!floorsOf(b)) return false;
    if (!setViewFloor(b, floorNo(b) + (e.code === "PageUp" ? 1 : -1))) cui.msg = e.code === "PageUp" ? "This is the top floor." : "This is the ground floor.";
    return true;
  }
  if (!isIso()) return false;
  if (PAN_KEYS.has(e.code)) { iso.keys.add(e.code); return true; }
  if (e.code === "Comma" || e.code === "Period") { isoRotate(b, e.code === "Period" ? 1 : -1); return true; }
  if (e.code === "Equal" || e.code === "NumpadAdd") { isoZoom(b, 1); return true; }
  if (e.code === "Minus" || e.code === "NumpadSubtract") { isoZoom(b, -1); return true; }
  if (e.code === "KeyB" && !e.shiftKey) { setRoofs(!iso.roofs); return true; }
  if (e.code === "KeyV" && !e.shiftKey) { const u = selUnit(b); if (u) isoCenterOn(b, u.x, u.y); return true; }
  return false;
}
export function combatKeyUp(state, e) {
  if (PAN_KEYS.has(e.code)) iso.keys.delete(e.code);
}

export function combatKey(state, e) {
  const b = state.combat;
  if (!b) return false;
  sync(b);
  if (viewKey(state, b, e)) return true;
  if (b.over) {
    if (e.code === "Enter" || e.code === "Space") { closeCombat(state); return true; }
    return false;
  }
  // Deploy step: Enter starts the fight (Space only says so: it is too easy to press by habit here).
  if (b.phase === "deploy") {
    if (e.code === "Enter" || e.code === "NumpadEnter") { act(state, { type: "start" }); return true; }
    if (e.code === "Space") { cui.msg = "Place your defenders, then press Enter or Start the fight."; return true; }
  }
  const team = players(b).filter((u) => alive(u)); // on any floor: the view follows (followFloor)
  if (e.code === "Tab") {
    const ready = team.filter((u) => u.ap > 0);
    const list = ready.length ? ready : team;
    const i = list.findIndex((u) => u.id === cui.sel);
    if (list.length) cui.sel = list[(i + (e.shiftKey ? list.length - 1 : 1)) % list.length].id;
    cui.mode = "move";
    follow(b);
    return true;
  }
  if (/^Digit[1-9]$/.test(e.code)) {
    const u = players(b)[Number(e.code.slice(5)) - 1];
    if (u && alive(u)) { cui.sel = u.id; cui.mode = "move"; follow(b); }
    return true;
  }
  // The retreat confirm: Enter gives the order, Space does nothing (too easy to press by habit), Esc closes it.
  if (retreatAskOpen(b) && (e.code === "Enter" || e.code === "NumpadEnter")) { combatAction(state, "cb-retreat", { v: "go" }); return true; }
  if (retreatAskOpen(b) && e.code === "Space") { cui.msg = "Press Enter or Sound the retreat to give the order, Esc to keep fighting."; return true; }
  if (fallAskOpen(b) && (e.code === "Enter" || e.code === "NumpadEnter")) { combatAction(state, "cb-fallback", { v: "go" }); return true; }
  if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") { requestEndTurn(state, e.code === "Space" ? "space" : "enter"); return true; }
  if (e.code === "Escape") { cui.mode = "move"; cui.msg = ""; cui.endAsk = null; cui.retreatAsk = null; cui.fallAsk = null; cui.dragId = null; return true; }
  if (b.phase === "deploy") return false;
  if (e.code === "KeyR" && e.shiftKey) { combatAction(state, b.tier && b.tier.map === "wall" ? "cb-fallback" : "cb-retreat", { v: "ask" }); return true; }
  if (e.code === "KeyC" && e.shiftKey) { combatAction(state, "cb-clear", {}); return true; } // the area is clear enough (sim/battlesize.js)
  if (e.code === "KeyS" && e.shiftKey && b.raid) { combatAction(state, "cb-act", { v: "quick" }); return true; } // a quick rummage (sim/search.js)
  const map = { KeyF: "shoot", KeyE: "melee", KeyM: "meds", KeyO: "overwatch", KeyH: "hunker", KeyR: "retreat", KeyS: "search", KeyN: "vehicle", KeyX: "extract", KeyC: "subdue", KeyT: "tie", KeyG: "throw", KeyD: "drag", KeyL: "climb", KeyK: "peek", KeyQ: "close", KeyY: "brace", KeyU: "crush", KeyJ: "doubletap", KeyP: "pickup", KeyZ: "stowbody" };
  if (map[e.code]) { combatAction(state, "cb-act", { v: map[e.code] }); return true; }
  return false;
}

// Panel buttons (data-action="cb-…").
export function combatAction(state, key, d) {
  const b = state.combat;
  if (!b) return;
  sync(b);
  const u = selUnit(b);
  if (key === "cb-close") return void closeCombat(state, { take: d.take !== "0" });
  // The view bar (ui/isoview.js).
  if (key === "cb-view") {
    if (d.v === "iso" || d.v === "top") setBattleView(d.v);
    else if (d.v === "rotl" || d.v === "rotr") isoRotate(b, d.v === "rotr" ? 1 : -1);
    else if (d.v === "roofs") setRoofs(!iso.roofs);
    else if (d.v === "zin" || d.v === "zout") isoZoom(b, d.v === "zin" ? 1 : -1);
    else if (d.v === "center" && u) { followFloor(b, u); isoCenterOn(b, u.x, u.y); }
    // A building with storeys: the Floor control (▲ ▼), or back to the selected unit's floor.
    else if (d.v === "fup" || d.v === "fdown") { if (!setViewFloor(b, floorNo(b) + (d.v === "fup" ? 1 : -1))) cui.msg = d.v === "fup" ? "This is the top floor." : "This is the ground floor."; }
    else if (d.v === "fgo" && u) followFloor(b, u);
    return;
  }
  if (key === "cb-auto") {
    if (b.acted || b.turn > 1) return;
    state.combat = null;
    finishCombat(state, b.setup, autoResolveCombat(state, b.setup));
    return;
  }
  if (key === "cb-end") return void requestEndTurn(state, d.now ? "enter" : "button");
  if (key === "cb-confirm") return void setConfirmEnd(!cui.confirmEnd);
  // Sounding the retreat: ask (the confirm), toggle carrying a downed teammate, go, cancel.
  if (key === "cb-retreat") {
    if (d.v === "cancel") { cui.retreatAsk = null; return; }
    const err = retreatRefusal(b);
    if (err) { cui.retreatAsk = null; cui.msg = err; return; }
    if (d.v === "ask") { cui.retreatAsk = retreatAskOpen(b) ? null : { turn: b.turn, rev: b.rev, leave: [] }; cui.endAsk = null; cui.msg = ""; return; }
    if (!retreatAskOpen(b)) return;
    if (d.v === "toggle") {
      const id = Number(d.id), L = cui.retreatAsk.leave;
      cui.retreatAsk.leave = L.includes(id) ? L.filter((x) => x !== id) : [...L, id];
      return;
    }
    if (d.v === "go") {
      const leave = cui.retreatAsk.leave;
      cui.retreatAsk = null;
      act(state, { type: "soundRetreat", leave });
    }
    return;
  }
  if (key === "cb-sel") { cui.sel = Number(d.id); cui.mode = "move"; cui.msg = ""; follow(b); return; }
  // Only a couple of far-off stragglers left (sim/battlesize.js clearEnough): call the fight won.
  if (key === "cb-clear") { if (clearEnough(b)) act(state, { type: "callClear" }); else cui.msg = "There are still enemies close by or coming."; return; }
  // A base's wall map (sim/interior.js): everyone off the walls, into the yard and the buildings.
  if (key === "cb-fallback") {
    if (d.v === "ask") { cui.fallAsk = fallAskOpen(b) ? null : { turn: b.turn, rev: b.rev }; cui.msg = ""; return; }
    if (d.v === "cancel") { cui.fallAsk = null; return; }
    cui.fallAsk = null;
    return void act(state, { type: "fallBack" });
  }
  if (key === "cb-redeploy") return void setAutoRedeploy(!cui.autoRedeploy);
  // Deploy step (sim/deploy.js): start, default positions, the selected defender to the gate, floodlight aim.
  if (key === "cb-deploy") {
    if (d.v === "start") return void act(state, { type: "start" });
    if (d.v === "defaults") return void act(state, { type: "defaults" });
    if (d.v === "flood") return void act(state, { type: "flood", zone: d.z });
    if (d.v === "gate" && u) return void act(state, { type: "gate", unit: u.id });
    return;
  }
  // The result screen: take the knocked out home as prisoners, or leave them tied up (sim/prisoners.js).
  if (key === "cb-prison") { if (b.over) b.leavePrisoners = d.v === "leave"; return; }
  if (key === "cb-target") {
    const t = unitById(b, Number(d.id));
    if (u && t) attack(state, u, t);
    return;
  }
  // A site with several buildings (sim/buildingmaps.js): which one to explore, or the street.
  if (key === "cb-act" && d.v === "building") return void act(state, { type: "building", id: d.k });
  if (key !== "cb-act" || !u) return;
  const v = d.v;
  if (v === "search" && b.raid) return void openSearch(state, b, u, null, { full: true });
  if (v === "quick" && b.raid) return void openSearch(state, b, u, null, { quick: true }); // sim/search.js: the rummage
  if (v === "drive") { // sim/combat.js driveTo: pick where it goes
    if (!b.vehicle) { cui.msg = "You came on foot: there is no vehicle here."; return; }
    if (!atVehicle(b, u)) { cui.msg = "Stand next to the vehicle to drive it."; return; }
    if (u.ap < DRIVE.AP) { cui.msg = "Driving takes both actions."; return; }
    cui.mode = "drive"; cui.msg = `Click where to drive the ${b.vehicle.kind === "truck" ? "truck" : "car"} (open ground, up to ${DRIVE.RANGE} cells).`;
    return;
  }
  if (v === "vehicle" && b.raid) {
    if (!(b.raid.hasVehicle ?? b.raid.vehicleZone >= 0)) { cui.msg = "You came on foot: there is no vehicle here."; return; }
    if (!atVehicle(b, u)) { cui.msg = "Walk to the vehicle (its zone, or next to it) to load or unload it."; return; }
    cui.lootReq = { uid: u.id, box: null };
    return;
  }
  // R is the retreat key of a normal battle. A raid has no retreat strip: say how to leave instead.
  if (v === "retreat" && b.raid) { cui.msg = "In a raid you leave by extracting: move into a green extraction zone and press X."; return; }
  if (v === "move") { cui.mode = "move"; return; }
  if (v === "shoot" || v === "melee") { cui.mode = cui.mode === v ? "move" : v; cui.msg = v === "shoot" ? "Click a visible enemy to shoot." : "Click an adjacent enemy to strike."; return; }
  // The stealth kit (sim/stealth.js).
  if (v === "subdue") {
    const near = b.units.filter((t) => canSubdue(u, t));
    if (near.length === 1) return void act(state, { type: "subdue", unit: u.id, target: near[0].id });
    cui.mode = cui.mode === "subdue" ? "move" : "subdue";
    cui.msg = near.length ? "Click the person next to you to subdue." : "Subdue needs a person right next to you.";
    return;
  }
  if (v === "tie") {
    const ko = b.units.filter((t) => t.side === "enemy" && t.ko && !t.tied && !t.dead && adjacent(u, t));
    if (ko.length === 1) return void act(state, { type: "tie", unit: u.id, target: ko[0].id });
    cui.mode = ko.length ? "tie" : "move";
    cui.msg = ko.length ? "Click the one to tie up." : "Tie up someone knocked out, right next to you.";
    return;
  }
  if (v === "throw") {
    const have = throwablesOf(state, b, u);
    const k = d.k && have[d.k] ? d.k : THROW_KEYS.find((x) => have[x]);
    if (!k) { cui.msg = "Nothing to throw: bottles, noise makers and firecrackers come from searching and crafting."; return; }
    if (THROWABLES[k].self) return void act(state, { type: "throw", unit: u.id, item: k, x: u.x, y: u.y }); // the deer call: blown where they stand
    cui.mode = "throw";
    cui.throwKey = k;
    cui.msg = `Click a tile up to ${THROWABLES[k].range} away to throw ${THROWABLES[k].label}.`;
    return;
  }
  if (v === "drag") {
    cui.mode = cui.mode === "drag" ? "move" : "drag";
    cui.dragId = null;
    const near = b.units.filter((o) => adjacent(u, o) && dragable(o) && !o.left && !o.fled);
    if (cui.mode === "drag" && near.length === 1) { cui.dragId = near[0].id; cui.msg = `Click where to drag ${near[0].dead ? `${near[0].name}'s body` : near[0].name} (up to ${STEALTH.DRAG} tiles).`; }
    else cui.msg = cui.mode === "drag" ? "Click the body (or someone down) next to you, then where to drag it." : "";
    return;
  }
  if (v === "drop") return void act(state, { type: "drop", unit: u.id, target: Number(d.id) }); // rocks from the walls (sim/siege.js)
  // The worm (sim/carriers.js): Crush skull and Pick up body next to the unit, Double tap in sight; the one in most
  // danger first, or a click to choose when several are there.
  if (v === "crush") {
    const near = crushable(b, u);
    const c = near.find((o) => imminent(b, o)) || near.find((o) => endangered(b, o));
    if (!near.length) { cui.msg = "Crush skull needs a body right next to you."; return; }
    if (c || near.length === 1) return void act(state, { type: "crush", unit: u.id, target: (c || near[0]).id });
    cui.mode = cui.mode === "crush" ? "move" : "crush";
    cui.msg = cui.mode === "crush" ? "Click the body whose skull to crush." : "";
    return;
  }
  if (v === "doubletap") {
    const seen = tappable(b, u);
    if (!seen.length) { cui.msg = !isRanged(u) ? "Double tap needs a gun: crush the skull from next to the body instead (U)." : !canFire(b, u) ? "Double tap needs a gun with ammo and free hands." : "No body in sight that could still get up."; return; }
    const c = seen.find((o) => imminent(b, o)) || seen.find((o) => endangered(b, o));
    if (c || seen.length === 1) return void act(state, { type: "doubletap", unit: u.id, target: (c || seen[0]).id });
    cui.mode = cui.mode === "doubletap" ? "move" : "doubletap";
    cui.msg = cui.mode === "doubletap" ? "Click the body to shoot (1 action, 1 round, the noise of a shot)." : "";
    return;
  }
  if (v === "pickup") {
    if (carriedBy(b, u)) return void act(state, { type: "dropbody", unit: u.id });
    const near = liftable(b, u);
    if (!near.length) { cui.msg = "Pick up needs a body right next to you."; return; }
    if (near.length === 1) return void act(state, { type: "pickup", unit: u.id, target: near[0].id });
    cui.mode = cui.mode === "pickup" ? "move" : "pickup";
    cui.msg = cui.mode === "pickup" ? "Click the body to pick up." : "";
    return;
  }
  if (v === "stowbody") return void act(state, { type: "stowbody", unit: u.id });
  // A building's doors (sim/buildingmaps.js): with one door next to the unit act at once, else click the door.
  if (v === "peek" || v === "close" || v === "brace") {
    const list = v === "peek" ? peekOptions(b, u) : v === "close" ? closeOptions(b, u) : braceOptions(b, u);
    if (list.length === 1) return void act(state, { type: v, unit: u.id, x: list[0].x, y: list[0].y });
    if (!list.length) { cui.msg = v === "peek" ? "Stand right next to a door or doorway to peek through it." : v === "close" ? "Stand next to an open door with nobody in the doorway." : "Stand next to a closed door to brace it."; return; }
    cui.mode = cui.mode === v ? "move" : v;
    cui.msg = `Click the door to ${v === "peek" ? "peek through" : v}.`;
    return;
  }
  if (v === "meds") {
    const others = players(b).filter((o) => o !== u && !o.dead && !o.left && adjacent(u, o) && (o.down ? !o.stab : o.hp < o.maxHp));
    if (!others.length) return void act(state, { type: "meds", unit: u.id, target: u.id });
    cui.mode = "meds";
    cui.msg = "Click yourself or an adjacent teammate to treat.";
    return;
  }
  act(state, { type: v, unit: u.id });
}

// Enemy phase plays out one unit at a time so the player can follow it. Returns true when the panel needs a refresh.
export function combatTick(state, now) {
  const b = state.combat;
  if (!b) return false;
  sync(b);
  if (isRedeploy(b) && cui.autoRedeploy) { act(state, { type: "start" }); return true; }
  if (b.over || b.phase !== "enemy") return false;
  if (now - cui.lastStep < ENEMY_STEP_MS) return false;
  cui.lastStep = now;
  // Skip quickly past enemies the player cannot see doing nothing visible.
  for (let i = 0; i < 30 && b.phase === "enemy" && !b.over; i++) {
    const before = b.fxSeq;
    const u = enemyStep(state);
    if (!u) break;
    // Pause only when something happened that the player can see.
    if (b.fx.some((f) => f.seq > before && (f.type !== "move" || playerSees(b, u)))) break;
  }
  if (b.phase === "player") { cui.sel = null; autoSelect(b); }
  return true;
}

// ---------- panel ----------
export function renderCombatPanel(state) {
  const b = state.combat;
  if (!b) return "";
  sync(b);
  autoSelect(b);
  const e = b.setup.enemy;
  const u = selUnit(b);
  const phase = b.over ? `<b>${b.result.outcome === "victory" ? "Victory" : b.result.outcome === "extracted" ? "Got out" : b.result.outcome === "retreat" ? "Retreated" : "Defeat"}</b>` :
    b.phase === "deploy" ? `<b class="warn">Deploy</b>` : b.phase === "player" ? `<b class="good">Your turn</b>` : `<b class="danger">Enemy turn</b>`;
  // The menu (ui/settings.js): save the battle as it stands, load, options. The battle waits while it is open.
  let html = `<button class="mini cbmenu" data-action="set-open" data-tip="Menu: save the battle as it stands, load, options">⚙ Menu</button>${viewBar(b)}`;
  html += b.raid ? raidHead(state, b, phase) : `<div class="cbhead">
    <div class="cbtitle">Battle at ${esc(b.place)}</div>
    <div class="small muted">Against ${esc(e.name || e.kind)} · Turn ${b.turn} · ${phase}</div>
    <div class="small cbsupply"><span data-tip="Ammo carried. Each shot uses 1 (assault rifle bursts use 2). With no ammo your people can only fight in melee.">Ammo <b>${Math.floor(ammoLeft(b))}</b></span>
      <span data-tip="Meds carried. One treats a wound or stabilizes someone who is down.">Meds <b>${Math.floor(medsLeft(b))}</b></span>
      ${b.infection >= 0.1 ? `<span class="warn" data-tip="This area is infected. Gunfire draws more of the dead from the map edge.">Infected ${Math.round(b.infection * 100)}%</span>` : ""}</div>
    ${tierHtml(b)}
  </div>`;

  html += `<h3>Your team</h3><div class="cbroster">`;
  players(b).forEach((p, i) => {
    const status = p.roseAs != null ? "Turned: one of the dead" : p.burnt ? "Dead, burnt" : p.inVehicle ? "Dead, in the car" : p.carriedBy != null ? "Dead, carried" : p.crushed ? "Dead, will not get up" : imminent(b, p) ? "Dead: a Carrier is on them, crush the skull (U) or shoot (J)" : endangered(b, p) ? "Dead: a Carrier is near" : p.dead ? "Dead" : p.left ? "Got away" : p.down ? (p.stab ? "Down, stabilized" : `Down, bleeding out (${p.bleed})`) :
      [p.ow ? "Overwatch" : "", p.hunker ? "Hunkered" : "", evacAt(b, p.x, p.y) && b.evacCols ? "In evac zone" : ""].filter(Boolean).join(", ");
    const cls = ["cbunit", p.id === cui.sel ? "on" : "", !alive(p) ? "out" : p.ap === 0 ? "done" : ""].join(" ");
    const pips = alive(p) ? `<span class="ap">${"<i class=on></i>".repeat(p.ap)}${"<i></i>".repeat(2 - p.ap)}</span>` : "";
    // A building with storeys: everyone's floor (dimmer when it is not the one shown).
    const fl = floorsOf(b) && p.f != null ? ` <span class="cbfl${p.f === floorNo(b) ? "" : " off"}" data-tip="${esc(`${p.name.split(" ")[0]} is on ${floorLabel(b, p.f).toLowerCase()}${p.f === floorNo(b) ? " (shown)" : ": selecting them shows that floor"}.`)}">F${p.f + 1}</span>` : "";
    html += `<div class="${cls}" data-action="cb-sel" data-id="${p.id}" data-tip="${esc(`${p.name}. Weapon: ${p.weaponName}. Aim ${Math.round(p.aim)}. Press ${i + 1} or Tab to select.`)}">
      <div class="spread"><span>${spriteImg(canvasURL(unitCanvas(state, b, p, cui.salt)), 1.5)}<span class="muted">${i + 1}</span> <b>${esc(p.name)}</b>${fl}</span>${pips}</div>
      <div class="bar"><i style="width:${pct(p) * 100}%;background:${hpColor(pct(p))}"></i></div>
      <div class="small muted">${esc(p.weaponName)} · ${Math.round(p.hp)} hp${status ? ` · <span class="${p.down || p.dead ? "danger" : ""}">${status}</span>` : ""}</div>
    </div>`;
  });
  html += `</div>`;

  if (b.over) return html + resultHtml(state, b);
  if (b.phase === "deploy") return html + deployPanel(state, b, u);
  if (b.raid && b.raid.choose) html += chooseHtml(b);
  if (retreatAskOpen(b)) html += retreatConfirmHtml(b, askPlan(b)); // right under the team, where it is seen
  // Looking at another floor than the selected unit's (PageUp / PageDown, the Floor control): say so, with the way back.
  if (u && alive(u) && floorsOf(b) && u.f != null && u.f !== floorNo(b)) {
    html += `<div class="small muted cbmsg">Showing ${floorLabel(b, floorNo(b)).toLowerCase()}; ${esc(u.name.split(" ")[0])} is on ${floorLabel(b, u.f).toLowerCase()}. <button class="mini" data-action="cb-view" data-v="fgo" data-tip="Back to the selected unit's floor (V also centers on them).">Go to ${esc(u.name.split(" ")[0])}</button></div>`;
  }

  if (u && active(u) && b.phase === "player") {
    const ap = u.ap;
    const gun = isRanged(u), ammo = canFire(b, u);
    const foesAdj = b.units.some((t) => t.side === "enemy" && active(t) && adjacent(u, t));
    const btn = (v, label, tip, ok, key) => `<button class="${cui.mode === v ? "active" : ""}" data-action="cb-act" data-v="${v}" ${ok ? "" : "disabled"} data-tip="${esc(tip)}">${label}${key ? ` <span class="key">${key}</span>` : ""}</button>`;
    html += `<h3>${esc(u.name)} · ${ap} action${ap === 1 ? "" : "s"}</h3><div class="cbactions">
      ${btn("move", "Move", "Click a blue tile to move (1 action) or a yellow tile to dash (2 actions).", ap > 0)}
      ${btn("shoot", "Shoot", gun ? (ammo ? "Fire at a visible enemy. Ends this unit's turn. Hover an enemy to see the hit chance." : "Out of ammo.") : "No usable gun.", ap > 0 && ammo, "F")}
      ${btn("melee", "Melee", "Strike an adjacent enemy. Silent: it does not alert others or draw zombies. Ends the turn.", ap > 0 && foesAdj, "E")}
      ${btn("overwatch", "Overwatch", "Ends the turn. Takes a reaction shot (-15 aim) at the first enemy that moves in sight.", ap > 0 && ammo, "O")}
      ${btn("hunker", "Hunker down", `Ends the turn. +${COVER_DEF[1]} defense on top of cover until your next turn. Only helps when in cover.`, ap > 0, "H")}
      ${b.vehicle ? btn("drive", "Drive", `Both actions, from next to the ${b.vehicle.kind === "truck" ? "truck" : "car"}: click where to drive it (open ground only, up to ${DRIVE.RANGE} cells, nobody in the way; tank traps, railings, cars and walls stop it). Loud: the unaware within ${DRIVE.RADIUS} tiles hear the engine${b.raid ? `, Heat +${DRIVE.HEAT}` : ""}. What is loaded in it rides along, the siege ram too; extract from a zone it stands at to keep it.`, ap >= DRIVE.AP && atVehicle(b, u), "V") : ""}
      ${btn("meds", "Use meds", "1 action and 1 meds: heal yourself or an adjacent teammate, or stabilize someone who is down so they survive.", ap > 0 && medsLeft(b) > 0, "M")}
      ${floorButtons(b, u, btn)}
      ${bodyButtons(state, b, u, btn)}
      ${stealthButtons(state, b, u, btn)}
      ${siegeButtons(b, u, btn)}
      ${b.evacCols ? btn("retreat", "Retreat", "This unit leaves the battle. Only from the green evac strip. A downed teammate lying on the strip is carried out with the last one to leave; anyone else who is down and left behind is lost. To pull everyone out at once, Sound the retreat (Shift+R).", ap > 0 && evacAt(b, u.x, u.y), "R") : ""}
      ${b.raid ? raidButtons(b, u, btn) + lockPanel(state, b, u) : ""}
    </div>`;
  } else if (b.phase === "enemy") html += `<h3>Enemy turn</h3><div class="small muted">Watch the map. Your turn comes next.</div>`;

  html += `<div id="cbprev" class="cbprev">${previewHtml(b)}</div>`;
  if (cui.msg) html += `<div class="small warn cbmsg">${esc(cui.msg)}</div>`;

  const v = view(b);
  const seen = b.units.filter((t) => v.seen.has(t.id));
  if (seen.length && u && active(u)) {
    html += `<h3>Enemies in sight</h3><div class="cbtargets">`;
    for (const t of seen) {
      const o = odds(b, u, t);
      const tip = o ? `${t.name}: ${o.label}. Click to attack with ${u.name}.` : `${t.name}: ${u.name} cannot hit them from here.`;
      html += `<button class="cbtarget" data-action="cb-target" data-id="${t.id}" ${o && o.ok && b.phase === "player" && u.ap > 0 ? "" : "disabled"} data-tip="${esc(tip)}">
        <span>${spriteImg(canvasURL(unitCanvas(state, b, t, cui.salt)), 1.5)}${esc(t.name)}${t.aware ? "" : ' <span class="warn">(unaware)</span>'}</span><span class="small">${Math.round(t.hp)} hp${o && o.ok ? ` · <b>${o.chance}%</b>` : ""}</span></button>`;
    }
    html += `</div>`;
  }

  html += `<h3>Log</h3><div class="cblog" id="cblog">${b.log.slice(-40).map((l) => `<div class="k-${l.k}"><span class="t">T${l.turn}</span>${esc(l.text)}</div>`).join("")}</div>`;
  if (endAskOpen(b)) {
    const n = unitsWithActions(b);
    html += `<div class="small warn cbmsg cbconfirm"><b>${n} unit${n === 1 ? " still has" : "s still have"} actions</b> — press Space again or Enter to end the turn (Esc to keep playing).
      <div style="margin-top:0.3rem"><button data-action="cb-end" data-now="1" data-tip="End the turn now; units with actions left do nothing.">End turn now</button>
      <button data-action="cb-confirm" data-tip="Stop asking: Space and End turn end the turn at once (turn it back on with the checkbox below the log).">Don't ask again</button></div></div>`;
  }
  const wallMap = !!(b.tier && b.tier.map === "wall");
  const noRetreat = b.evacCols && !b.raid && !wallMap ? retreatRefusal(b) : null;
  if (fallAskOpen(b)) html += fallBackConfirmHtml(b);
  html += `<div class="cbfoot">
    ${wallMap ? `<button class="${fallAskOpen(b) ? "active" : ""}" data-action="cb-fallback" data-v="ask" ${retreatRefusal(b) ? "disabled" : ""} data-tip="${esc(retreatRefusal(b) || "Everyone climbs down off the wall and falls back into the yard and the buildings (the second map). The attackers get the next turn and pour in through the openings. (Shift+R)")}">Fall back to the yard</button>` : ""}
    ${noRetreat != null ? `<button class="${retreatAskOpen(b) ? "active" : ""}" data-action="cb-retreat" data-v="ask" ${noRetreat ? "disabled" : ""} data-tip="${esc(noRetreat || "Everyone still standing runs for the evac strip at once (shows each one's odds first). Those on the strip get out safely; the others make an escape check; downed teammates next to someone are carried. (Shift+R)")}">Sound the retreat</button>` : ""}
    ${b.phase === "player" && clearEnough(b) ? `<button class="primary" data-action="cb-clear" data-tip="Only a couple of the enemy are left, far off and unaware (or running): the area is clear enough. End the fight as a win and leave them be; or keep playing to hunt them down. (Shift+C)">Area clear: finish</button>` : ""}
    <button class="primary" data-action="cb-end" ${b.phase === "player" ? "" : "disabled"} data-tip="End your turn. Units with actions left do nothing.${cui.confirmEnd ? " While any unit still has actions, the first press asks; press again (or Enter) to end." : ""} (Space or Enter)">End turn</button>
    ${!b.raid && !b.acted && b.turn === 1 ? `<button data-action="cb-auto" data-tip="Skip the tactical battle and resolve it instantly by the numbers. Only before you act on turn 1.">Auto-resolve</button>` : ""}
  </div>
  <div class="small muted" style="margin-top:0.3rem"><button class="${cui.confirmEnd ? "active" : ""}" data-action="cb-confirm" data-tip="When on, Space or End turn asks once while units still have actions (Enter always ends at once). Remembered in this browser.">${cui.confirmEnd ? "✔" : "✗"} Ask before ending a turn with actions left</button></div>`;
  return html;
}

// The view bar: switch the view; in the isometric view turn, zoom, center, roofs; in a building with storeys the
// floor shown (`Floor 2 of 5 ▲ ▼`, both views).
export function viewBar(b = cui.battle) {
  const on = isIso();
  const btn = (v, label, tip, active = false) => `<button class="mini${active ? " active" : ""}" data-action="cb-view" data-v="${v}" data-tip="${esc(tip)}">${label}</button>`;
  let html = `<div class="cbview">${btn(on ? "top" : "iso", on ? "▦ Top-down" : "◇ Isometric", on ? "Show the battle as the flat top-down grid (I). Options → Display → Battle view keeps it." : "Show the battle in the isometric (pseudo-3D) view (I).")}`;
  if (on) {
    html += btn("rotl", "⟲", "Turn the view a quarter to the left (,)") + btn("rotr", "⟳", "Turn the view a quarter to the right (.)");
    html += btn("zout", "−", "Zoom out (− or the mouse wheel)") + btn("zin", "+", "Zoom in (+ or the mouse wheel)");
    html += btn("center", "◎", "Center on the selected unit (V). Drag the map, hold the arrow keys or push the mouse to the edge to pan.");
    html += btn("roofs", iso.roofs ? "Roofs ✔" : "Roofs ✗", "Roofs on the buildings (B). A building with one of your people, an enemy you see or the mouse inside is always shown cut away; off shows every one that way.", iso.roofs);
  }
  const F = b && floorsOf(b);
  if (F) {
    const f = floorNo(b), name = F[f] && F[f].name ? ` (${F[f].name})` : "";
    html += `<span class="cbfloor" data-tip="${esc(`The floor shown${name}. PageUp / PageDown or ▲ ▼ change it; selecting a unit shows its floor; clicking the marker of someone on another floor jumps there. Below the floor shown the building is its outer walls; above it is cut away, the roof only on the top floor; outside, the ground lies below, dimmed.`)}">${esc(floorLabel(b, f))}</span>`;
    html += btn("fup", "▲", f < F.length - 1 ? `Show the floor above (PageUp): ${floorLabel(b, f + 1).toLowerCase()}.` : "This is the top floor.") + btn("fdown", "▼", f > 0 ? `Show the floor below (PageDown): ${floorLabel(b, f - 1).toLowerCase()}.` : "This is the ground floor.");
  }
  return `${html}</div>`;
}

// A building with storeys: Go up / Go down for a unit standing on a stairwell (sim/combat.js stairOptions and the
// goup / godown actions: 1 action, the unit keeps its x, y on the floor above or below).
function floorButtons(b, u, btn) {
  const F = floorsOf(b);
  if (!F) return "";
  const s = stairsOf(b, u), f = u.f ?? floorNo(b), first = u.name.split(" ")[0];
  if (!s.up && !s.down) return "";
  let html = "";
  if (f < F.length - 1) html += btn("goup", "Go up", s.up ? `1 action: ${first} climbs the stairs to ${floorLabel(b, f + 1).toLowerCase()} and the view follows. Nobody may be standing on the stairwell up there.` : "Stand on a stairwell to go up.", u.ap > 0 && s.up);
  if (f > 0) html += btn("godown", "Go down", s.down ? `1 action: ${first} takes the stairs down to ${floorLabel(b, f - 1).toLowerCase()} and the view follows. Nobody may be standing on the stairwell down there.` : "Stand on a stairwell to go down.", u.ap > 0 && s.down);
  return html;
}

// ---------- raid panel pieces ----------
function raidHead(state, b, phase) {
  const R = b.raid;
  const party = state.parties.find((x) => x.id === b.setup.partyId);
  // kg (sim/raidloot.js): the selected survivor's own load, and the vehicle's.
  const sel = selUnit(b);
  const me = sel && sel.side === "player" && party ? personalLoad(state, sel) : null;
  const trunk = party ? trunkInfo(state, b) : null;
  const stage = Math.min(3, Math.floor(R.heat / 25));
  const left = R.containers.filter((c) => !c.searched && c.kind !== "body").length;
  const found = [...Object.entries(R.found).map(([k, n]) => `${n} ${k}`), ...R.foundGear.map((g) => g.name)];
  // A building's own map (sim/buildingmaps.js): its name, its ways out, people inside who are not placed yet.
  const I = R.interior;
  const exits = I && R.plan ? (R.plan.exits || []).filter((e) => e.zone >= 0).map((e) => e.name.toLowerCase()) : [];
  const waiting = I && R.occupants ? R.occupants.waiting.reduce((a, w) => a + w.count, 0) : 0;
  return `<div class="cbhead">
    <div class="cbtitle">Scavenging ${I ? `the ${esc(I.name.toLowerCase())} · ` : ""}${esc(b.place)}</div>
    ${I ? `<div class="small muted" data-tip="Every way out has a green extraction zone outside it. Locked doors (padlocks) open like any lock, from either side.">Ways out: the front${exits.length ? `, ${esc(exits.join(", "))}` : ""}${waiting ? ` · <span class="warn">${waiting} other people inside</span>` : ""}</div>` : ""}
    <div class="small muted">Turn ${b.turn} · about ${Math.floor((b.turn - 1) / 6)}h ${((b.turn - 1) % 6) * 10}m in · ${phase}</div>
    <div class="small" style="margin-top:0.35rem" data-tip="Heat rises every turn and faster with gunfire and car alarms. Each new stage (Stirring 25, Swarming 50, Overrun 75) brings a wave of the dead from the map edges.">Heat: <b>${HEAT_NAMES[stage]}</b> (${Math.round(R.heat)})</div>
    <div class="heat" style="margin:0.25rem 0 0.4rem"><i style="left:${Math.min(100, R.heat)}%"></i></div>
    <div class="small cbsupply">
      ${me ? `<span data-tip="${esc(`What ${sel.name.split(" ")[0]} carries: worn and held ${Math.round(me.worn)} kg${me.share ? `, their share of the team's supplies ${Math.round(me.share)} kg` : ""}, finds carried loose ${Math.round(me.haul)} kg. Each survivor carries their own finds; anything that does not fit stays in the container.${trunk ? " Unload at the vehicle (N) to free them up." : ""}`)}">${esc(sel.name.split(" ")[0])} <b class="${me.room < 2 ? "warn" : ""}">${Math.round(me.load)}/${Math.round(me.max)} kg</b></span>` : ""}
      ${trunk ? `<span data-tip="${esc(`${trunk.name}: what is in it (the team's supplies and cargo) and how much more it takes${trunk.bike ? "" : ", counting everything your people carry, because the car takes all of it home"}.`)}">${trunk.bike ? "Racks" : "Vehicle"} <b>${Math.max(0, Math.round(trunk.space))} kg free</b></span>` : ""}
      <span data-tip="Ammo carried. Each shot uses 1 (assault rifle bursts use 2).">Ammo <b>${Math.floor(ammoLeft(b))}</b></span>
      <span data-tip="Meds carried. One treats a wound or stabilizes someone who is down.">Meds <b>${Math.floor(medsLeft(b))}</b></span>
      <span data-tip="Containers not yet searched">Left to search <b>${left}</b></span>
    </div>
    <div class="small muted" style="margin-top:0.3rem">${found.length ? `Found: ${esc(found.join(", "))}` : "Nothing found yet."}</div>
    ${(R.hasVehicle ?? R.vehicleZone >= 0) ? `<div class="small warn" style="margin-top:0.25rem" data-tip="Leave from another zone and the vehicle stays here, marked on the map. It can be driven (Drive) and extracts with whoever leaves from the zone it stands at.">${R.vehicleZone >= 0 ? "Your vehicle stands at an extraction zone. Extract there to keep it." : "Your vehicle stands away from the zones: drive it back to one before extracting, or it stays behind."}</div>` : ""}
    ${b.night ? `<div class="small warn" style="margin-top:0.25rem" data-tip="At night guards see ${STEALTH.NIGHT_SIGHT} tiles (the dead ${STEALTH.NIGHT_ZOMBIE_SIGHT}) and notice you from closer. Your people see ${STEALTH.NIGHT_SIGHT} too: ${STEALTH.LIGHT_SIGHT} with a flashlight in the off hand (but the light is seen from ${STEALTH.LIGHT_DETECT} tiles further), all the way with night vision goggles. A quick rummage without a light is heard ${SEARCH.quick.dark} tiles further (a full search is 1 action either way).">Night raid: short sight both ways. ${players(b).filter((p) => p.light || p.nvg).length} of ${players(b).length} have a light or night vision.</div>` : ""}
    ${raidKeyLine(state, b)}
  </div>`;
}

function raidButtons(b, u, btn) {
  const near = searchableNear(b, u);
  const z = zoneAt(b, u.x, u.y);
  const zone = z >= 0 ? b.raid.zones[z] : null;
  // sim/search.js: the full search (1 action, everything shows) and the quick rummage (no action, part of it, loud).
  const sb = near.find((c) => !c.contents || c.quick) || near[0];
  const searchTip = sb ? `Search ${sb.label.toLowerCase()} (${!sb.contents || sb.quick ? `${SEARCH.ap} action` : "already searched: free"}${sb.quick ? ": it was only rummaged through, a full search turns up the rest" : ""}). Everything inside shows, quietly; pick what to take. ${sb.kind === "body" ? "" : areaHint(b.raid.areas[sb.area].type)}` : "Stand next to an unsearched container (yellow box marker) to search it.";
  const qb = quickable(near)[0];
  const Q = SEARCH.quick;
  const qWhy = quickRefusal(b, u, qb || near[0]);
  const quickTip = `Rummage in a hurry: no action (needs one left; once a turn), so it fits between two moves. Only ${Math.round(Q.reveal[0] * 100)}–${Math.round(Q.reveal[1] * 100)}% of what is inside turns up; a full search there later finds the rest. Loud: Heat +${Q.heat}, and the unaware dead and guards within ${quickRadius(b, u)} tiles come to look${b.raid.interior ? " (walls and closed doors muffle it)" : ""}${quickRadius(b, u) > Q.radius ? "; fumbling in the dark without a light carries further" : ""}.${qWhy ? ` ${qWhy}` : ""}`;
  const exTip = zone ? (zone.vehicle ? "Leave the raid in your vehicle. Everyone who extracts here keeps it." : (b.raid.hasVehicle ?? b.raid.vehicleZone >= 0) ? "Leave the raid on foot from here. If nobody extracts at the vehicle, it is left behind." : "Leave the raid from this zone.") :
    "Move into a green extraction zone first. Anyone still on the map when the last person leaves is lost.";
  const veh = b.raid.hasVehicle ?? b.raid.vehicleZone >= 0;
  const vehTip = atVehicle(b, u) ? "Free: open the vehicle. Drag what you carry into it to free your hands, or take things out." : "Walk to the vehicle (its zone, or next to it) to load or unload it.";
  let html = `${btn("search", "Search", searchTip, u.ap > 0 && near.length > 0, "S")}${btn("quick", "Quick search", quickTip, !qWhy, "⇧S")}${veh ? btn("vehicle", "Vehicle", vehTip, atVehicle(b, u), "N") : ""}${btn("extract", zone && zone.vehicle ? "Extract (vehicle)" : "Extract", exTip, u.ap > 0 && !!zone, "X")}`;
  // A building's doors and windows (sim/buildingmaps.js): peek, close, brace; climb through a window next to you.
  if (b.raid.interior) {
    const first = u.name.split(" ")[0];
    const peeks = peekOptions(b, u), closes = closeOptions(b, u), braces = braceOptions(b, u);
    const P = BMAP.PEEK;
    html += btn("peek", "Peek", peeks.length ? (u.peekTurn === b.turn ? `${first} has already peeked this turn.` : `Free, once a turn: ${first} looks through the door or doorway next to them and sees the room beyond (out to ${P.range} tiles, until the end of the turn) without stepping in. An unaware guard facing the door may catch it (${Math.round(P.notice * 100)}% − ${Math.round(P.perStealth * 100)}% a Stealth point), the dead right behind it ${Math.round(P.deadNotice * 100)}%.`) : "Stand right next to a door or doorway (not diagonally) to peek through it.", peeks.length > 0 && u.peekTurn !== b.turn, "K");
    html += btn("close", "Close door", closes.length ? `1 action: shut the open door next to ${first} (quiet; a roller door is loud: Heat +${BMAP.ROLLER.heat}). A shut door blocks sight; the dead must batter it down (${BMAP.DOOR.inner} hit points an inner door, a turn or more each blow), people stop to open it.` : "Stand next to an open door (not diagonally) with nobody in the doorway to shut it.", u.ap > 0 && closes.length > 0, "Q");
    html += btn("brace", "Brace door", braces.length ? `The rest of the turn: ${first} puts a shoulder to the closed door next to them. People cannot open it (they must break it) and it takes half of each blow, until ${first} moves.` : "Stand next to a closed door (not diagonally) to brace it.", u.ap > 0 && braces.length > 0, "Y");
    const wins = windowsNear(b, u);
    html += btn("climb", "Climb window", wins.length ? `${BMAP.CLIMB.ap} action: smash the window next to ${first} and climb through to the other side. Loud: Heat +${BMAP.CLIMB.heat}, and it wakes everything within ${BMAP.CLIMB.radius} tiles; the window stays open after.` : "Stand right next to a window (not diagonally) with room on the far side to climb through it (loud).", u.ap >= BMAP.CLIMB.ap && wins.length > 0, "L");
  }
  return html;
}

// A site with several buildings (sim/buildingmaps.js): pick the one to explore before anyone acts, or the street.
function chooseHtml(b) {
  const list = b.raid.choose || [];
  return `<div class="small cbmsg cbconfirm"><b class="good">Where do you go in?</b> Several buildings stand at ${esc(b.place)}. Each has its own map: rooms, doors, windows and its own ways out. Or search the street (this map). The choice is gone once anyone acts.
    <div class="cbactions" style="margin-top:0.35rem">${list.map((o) => `<button data-action="cb-act" data-v="building" data-k="${esc(o.id)}" data-tip="${esc(`${o.name}${o.size ? ` (${o.size}, ${o.rooms} rooms)` : ""}. ${o.hint}`)}">${esc(o.name)}${o.size ? ` <span class="muted">${o.size}</span>` : ""}</button>`).join("")}</div></div>`;
}

// ---------- the worm (sim/carriers.js) ----------
// The body buttons: Crush skull (U) and Pick up body (P) with a body next to the unit, Double tap (J) with one in
// sight and a gun in hand; carrying a body, Put down (P) and, at the team's car, Put body in car (Z).
function bodyButtons(state, b, u, btn) {
  let html = "";
  const held = carriedBy(b, u);
  const near = crushable(b, u), seen = tappable(b, u), lift = liftable(b, u);
  const danger = (c) => (imminent(b, c) ? " A Carrier is on it: it gets up at the end of this turn otherwise." : endangered(b, c) ? " A Carrier is near, or the worm is in it: it will get up when one reaches it." : "");
  if (near.length) {
    const c = near.find((o) => imminent(b, o)) || near.find((o) => endangered(b, o)) || near[0];
    html += btn("crush", "Crush skull", `1 action, silent: crush the skull of ${bodyName(c)} next to ${u.name.split(" ")[0]}, so the worm cannot raise it. Whatever it carries stays to loot.${danger(c)}`, u.ap > 0, "U");
  }
  if (seen.length) {
    const c = seen.find((o) => imminent(b, o)) || seen.find((o) => endangered(b, o)) || seen[0];
    html += btn("doubletap", "Double tap", `1 action, 1 round, the noise of a shot: put a round through the head of ${bodyName(c)} from here (line of sight), so the worm cannot raise it.${seen.length > 1 ? ` ${seen.length} bodies in sight: the one in most danger, or click one.` : ""}${danger(c)}`, u.ap > 0, "J");
  }
  if (held) {
    html += btn("pickup", "Put body down", `1 action: lay ${bodyName(held)} down in front of ${u.name.split(" ")[0]}. Carrying it: half the move distance, no shooting.`, u.ap > 0, "P");
    html += btn("stowbody", "Put body in car", carHere(state, b, u) ? `1 action: lay ${bodyName(held)} in the team's car. It weighs ${Math.round(unitBodyLoad(state, b, held))} kg of the team's load (${Math.max(0, Math.round(carRoom(state, b)))} kg free) until it is buried or burned. It cannot get up there and comes home: bury it (its things to the armory) or burn it on the base's Armory tab.` : b.raid ? "Carry the body to the team's vehicle (its zone, or next to it) first." : "Carry the body onto the green evac strip, where the team's car waits (a team on foot or on bikes has no car).", u.ap > 0 && carHere(state, b, u), "Z");
  } else if (lift.length) {
    const c = lift.find((o) => imminent(b, o)) || lift.find((o) => endangered(b, o)) || lift[0];
    html += btn("pickup", "Pick up body", `1 action: heave ${bodyName(c)} over ${u.name.split(" ")[0]}'s shoulder. Carrying it: half the move distance, no shooting; a carried body cannot get up. Put it down (P) or in the team's car (Z) to bring it home.${danger(c)}`, u.ap > 0, "P");
  }
  return html;
}

// ---------- the stealth kit (sim/stealth.js) ----------
function stealthButtons(state, b, u, btn) {
  const ap = u.ap;
  const near = b.units.filter((t) => canSubdue(u, t));
  const so = near.length ? subdueOdds(b, u, near[0]) : null;
  const subTip = so ? `${so.label} (${near[0].name}). Ends the turn. Takedowns work on the unaware and on anyone at 30% health or less; a knocked-out enemy wakes in 4–6 turns unless tied up, and after a won fight comes home as a prisoner.`
    : "Takedown or a non-lethal blow on a person right next to you: knocks them out instead of killing. Best from behind, from cover, with a club and with Stealth.";
  const ko = b.units.filter((t) => t.side === "enemy" && t.ko && !t.tied && !t.dead && adjacent(u, t));
  const bodies = b.units.filter((o) => adjacent(u, o) && dragable(o) && !o.left && !o.fled);
  const have = throwablesOf(state, b, u);
  const kinds = THROW_KEYS.filter((k) => have[k]);
  let html = btn("subdue", "Subdue", subTip, ap > 0 && near.length > 0, "C");
  html += btn("tie", "Tie up", "1 action: tie up someone knocked out next to you. Tied, they do not wake up, and after the fight they are your prisoner (in a raid, drag them into an extraction zone and leave from it).", ap > 0 && ko.length > 0, "T");
  html += btn("drag", "Drag", `1 action: drag a body, someone knocked out or a downed teammate up to ${STEALTH.DRAG} tiles (out of a patrol's sight: a guard who sees a body raises the alarm).`, ap > 0 && bodies.length > 0, "D");
  if (!kinds.length) html += btn("throw", "Throw", "Bottles, noise makers and firecrackers pull unaware guards and the dead to where they land. Nobody here carries one (search kitchens and houses, or craft them).", false, "G");
  for (const k of kinds) {
    const T = THROWABLES[k];
    const what = T.fx || T.decoy ? GEAR[k].desc : T.self ? `1 action: blow ${T.label} where ${u.name.split(" ")[0]} stands. Unaware guards and the dead within ${T.radius} tiles come to look. Not used up.`
      : `1 action: throw ${T.label} up to ${T.range} tiles. Unaware guards and the dead within ${T.radius} tiles go to look (3 turns)${T.turns > 1 ? `; it keeps ringing for ${T.turns} turns` : ""}${T.heat ? `; Heat +${T.heat} in a raid` : ""}.`;
    html += `<button class="${cui.mode === "throw" && cui.throwKey === k ? "active" : ""}" data-action="cb-act" data-v="throw" data-k="${k}" ${ap > 0 ? "" : "disabled"} data-tip="${esc(`${what} ${T.keep ? "" : `${have[k]} left.`}`)}">${T.self ? "Blow" : "Throw"} ${esc(GEAR[k].name.toLowerCase())}${T.keep ? "" : ` (${have[k]})`}${k === kinds[0] ? ' <span class="key">G</span>' : ""}</button>`;
  }
  return html;
}

// ---------- siege kit (sim/siege.js): ladders, the ram, rocks from the walls ----------
function siegeButtons(b, u, btn) {
  const ap = u.ap;
  let html = "";
  const lt = ladderTargets(b, u);
  if (u.ladder > 0 || lt.length) html += btn("ladder", "Set ladder", `1 action: set ${u.ladder > 0 ? "the ladder you carry" : "the fallen ladder"} against the wall section next to you; then anyone can climb it onto the walkway (exposed while on it: +10 to be hit, no cover). Defenders can push it off.${lt.length ? "" : " Stand at the foot of a wall section first."}`, ap > 0 && lt.length > 0);
  const pl = pushable(b, u);
  if (pl.length) html += btn("push", `Push ladder (${pushChance(b, u, pl[0])}%)`, `1 action: shove the enemy's ladder off the wall (${LADDER.PUSH}% + a fifth of melee aim + Tough or Brave, −15 with someone on it). Whoever is on it falls (${LADDER.FALL[0]}–${LADDER.FALL[1]} damage).`, ap > 0);
  const r = ramOf(b, u);
  if (r && r.lead === u.id) html += btn("ram", "Swing ram", `Bring the ram's crew to bear on the barred gate or door right in front: ${RAM.DMG[0]}–${RAM.DMG[1]} damage per carrier next to the lead (${RAM.MIN}–${RAM.CREW}). Ends the crew's turn.`, ap > 0 && ramTargets(b, u).length > 0);
  if (r) html += btn("dropRam", "Set ram down", "Let go of the ram: the crew can shoot and take cover again. Anyone can take it up again with someone next to them.", true);
  if (b.vehicle && atVehicle(b, u)) { // the ram into or out of the team's vehicle (sim/siege.js loadRam / unloadRam)
    if (r || (b.rams || []).some((x) => x.dropped && x.side === u.side && Math.max(Math.abs(x.x - u.x), Math.abs(x.y - u.y)) <= 1)) html += btn("loadRam", "Load ram", "1 action: the ram into the vehicle (the crew is free of it). It rides along wherever the vehicle is driven.", ap > 0);
    if ((b.rams || []).some((x) => x.inVehicle && x.side === u.side)) html += btn("unloadRam", "Unload ram", `1 action: the ram out of the vehicle onto the ground next to you; then Take up ram with ${RAM.MIN}+ people standing together.`, ap > 0);
  }
  else if ((b.rams || []).some((x) => x.dropped && x.side === u.side && Math.max(Math.abs(x.x - u.x), Math.abs(x.y - u.y)) <= 1)) html += btn("takeRam", "Take up ram", `Take the ram up with whoever of yours stands next to you (it needs ${RAM.MIN}). It moves at ${RAM.MOB} tiles an action.`, ap > 0);
  const dt = dropTargets(b, u);
  if (dt.length) html += `<button data-action="cb-act" data-v="drop" data-id="${dt[0].id}" ${ap > 0 ? "" : "disabled"} data-tip="${esc(`Drop a rock from the wall on ${dt[0].name} below (${DROP.CHANCE}%: ${DROP.DMG[0]}–${DROP.DMG[1]}; on a ram's crew one more of them is hit). Ends the turn.`)}">Drop rock on ${esc(dt[0].name)}</button>`;
  return html;
}

// ---------- the deploy step (sim/deploy.js) ----------
function deployPanel(state, b, u) {
  const D = b.deploy || {};
  if (D.interior) return interiorDeployPanel(state, b, u, D);
  const holders = players(b).filter((p) => p.post === "gate").map((p) => p.name);
  const towers = players(b).filter((p) => p.post === "tower").map((p) => p.name);
  let html = `<h3>Deploy · the attack comes from the ${esc(D.side || "east")}</h3>
    <div class="small muted">Click a defender, then a green cell to place them: on the walkway behind the wall (▲ height 1: shoot down over the wall, +5 aim, half cover; up the ladders), on a tower (▲▲ height 2: full cover, +10 aim, the widest view), in the gate or a breach (orange: whoever stands there holds it and blocks the way), or anywhere inside. The attackers batter the wall and the gate (hit points) and come through the openings.</div>
    <div class="small" style="margin-top:0.3rem">${D.walled ? `Holding the gate: <b>${holders.length ? esc(holders.join(", ")) : "nobody"}</b>${towers.length ? ` · On the towers: <b>${esc(towers.join(", "))}</b>` : ""}` : "No walls built here: defenders stand in the yard behind the barricades."}</div>
    <div class="cbactions" style="margin-top:0.4rem">
      <button data-action="cb-deploy" data-v="gate" ${u && D.walled ? "" : "disabled"} data-tip="${esc(u ? `Put ${u.name} in the gate (or a breach) to hold it.` : "Pick a defender first.")}">Hold the gate${u ? `: ${esc(u.name.split(" ")[0])}` : ""}</button>
      <button data-action="cb-deploy" data-v="defaults" data-tip="Back to the default posts: the toughest fighters in the gate (with 7+ defenders), the best shots on the towers, the rest in a line well back from the openings.">Default positions</button>
    </div>`;
  if (D.floodlit) {
    html += `<div class="small" style="margin-top:0.4rem" data-tip="The floodlights light a third of the approach: shots at anything in the light get +${b.floodAim}${D.night ? " (night)" : " (day)"}.">Floodlights (+${b.floodAim} to hit in the light):</div><div class="cbactions">
      ${Object.entries(LIT_ZONES).map(([z, name]) => `<button class="${D.lit === z ? "active" : ""}" data-action="cb-deploy" data-v="flood" data-z="${z}" data-tip="Aim the floodlights ${name.toLowerCase()} (as the defenders see it).">${name}</button>`).join("")}</div>`;
  }
  html += `<div id="cbprev" class="cbprev">${previewHtml(b)}</div>`;
  if (cui.msg) html += `<div class="small warn cbmsg">${esc(cui.msg)}</div>`;
  html += `<h3>Log</h3><div class="cblog" id="cblog">${b.log.slice(-20).map((l) => `<div class="k-${l.k}"><span class="t">T${l.turn}</span>${esc(l.text)}</div>`).join("")}</div>`;
  html += `<div class="cbfoot"><button class="primary" data-action="cb-deploy" data-v="start" data-tip="Everyone is in place: the fight begins. (Enter)">Start the fight</button>
    ${!b.acted && b.turn === 1 ? `<button data-action="cb-auto" data-tip="Skip the tactical battle and resolve it instantly by the numbers.">Auto-resolve</button>` : ""}</div>`;
  return html;
}

// ---------- a base battle's tiers (sim/deploy.js, sim/interior.js) ----------
// One line under the battle's title: which tier the fight is in, the wall and the gate (hit points), the breaches,
// how many attackers are inside or still outside.
export function tierHtml(b) {
  const T = b.tier;
  if (!T) return "";
  const foes = b.units.filter((u) => u.side === "enemy" && active(u));
  if (T.map === "wall") {
    let gate = 0, gateMax = 0, wall = 0, wallMax = 0, low = 1, breaches = 0;
    for (const c of b.cells) {
      if (c.k === "gate" && c.mhp) { gate += c.hp || 0; gateMax += c.mhp; if (!barredCell(c)) breaches++; }
      if (c.k === "palisade" && c.mhp) { wall += c.hp; wallMax += c.mhp; low = Math.min(low, c.hp / c.mhp); }
      if (c.k === "breach") breaches++;
    }
    const inside = foes.filter((f) => T.interior[f.y * b.w + f.x]).length;
    const need = Math.max(INTERIOR.BREACH_MIN, Math.ceil(foes.length * INTERIOR.BREACH_FRAC));
    const tip = `Tier 1 of 3: the walls. Shooters on the walkway (height 1) and the towers (height 2) see over the wall and aim down at the attackers; the wall sections and the gate have hit points and the attackers batter them. Once ${need} of them are inside the wall (or any are and nobody holds the wall line), the fight moves to the yard and the buildings; or fall back there yourself (Shift+R). Weakest wall section: ${Math.round(low * 100)}%.`;
    return `<div class="small cbtier" data-tip="${esc(tip)}"><b>Tier 1 · The walls</b> · gate <b class="${gateMax && gate / gateMax < 0.5 ? "danger" : ""}">${gateMax ? `${Math.round(gate)}/${gateMax}` : "open"}</b> · wall ${wallMax ? `${Math.round((wall / wallMax) * 100)}%` : "–"} · ${breaches} breach${breaches === 1 ? "" : "es"} · <span class="${inside ? "warn" : ""}">${inside} inside</span></div>`;
  }
  const waiting = b.units.filter((u) => u.off && !u.dead).length;
  const yard = foes.filter((f) => T.interior[f.y * b.w + f.x] && !T.indoor[f.y * b.w + f.x]).length;
  const last = T.stage === "buildings";
  const tip = last ? "Tier 3 of 3: the last stand. Barred doors and windows have hit points: the dead claw them in, raiders shoot the locks. Inside your people have full cover from the walls and half cover at the windows, and an upper floor (height 1) aims down. If everyone falls, the base is overrun; the green strip is the back gate (abandoning the base)."
    : `Tier 2 of 3: the yard. Barricades, sandbags, wells and the base's buildings are cover; the buildings can be entered (doors) and their upper floors and flat roofs climbed. The yard is lost once ${INTERIOR.YARD_LOST}× as many attackers as defenders still outside the buildings (at least 3) stand in it: then the last stand.`;
  return `<div class="small cbtier" data-tip="${esc(tip)}"><b class="${last ? "danger" : ""}">${last ? "Tier 3 · Last stand in the buildings" : "Tier 2 · The yard"}</b> · ${yard} in the yard${waiting ? ` · ${waiting} still outside the wall` : ""}</div>`;
}

function fallBackConfirmHtml(b) {
  const out = b.units.filter((u) => u.side === "enemy" && active(u) && !b.tier.interior[u.y * b.w + u.x]).length;
  return `<div class="small cbmsg cbconfirm"><b class="danger">Fall back to the yard?</b> Everyone climbs down off the wall and falls back into the yard and the buildings: a short redeploy, then the attackers move first and the ${out} still outside pour in through the openings. Downed people stay where they lie.
    <div style="margin-top:0.35rem"><button class="primary" data-action="cb-fallback" data-v="go" data-tip="Give the order. (Enter)">Fall back</button>
    <button data-action="cb-fallback" data-v="cancel" data-tip="Close this and hold the wall. (Esc)">Hold the wall</button></div></div>`;
}

// The deploy step on the yard and buildings map: a base without walls, or the redeploy after falling back.
function interiorDeployPanel(state, b, u, D) {
  const after = b.tier && b.tier.fellBackTurn != null;
  let html = `<h3>${after ? "Redeploy · falling back" : `Deploy · the attack comes from the ${esc(D.side || "east")}`}</h3>
    <div class="small muted">${after ? "Your people have left the wall. Place them on the green cells (near where they were, away from the attackers):" : "No walls here: the attackers come straight over the yard. Place your defenders on the green cells:"} in the buildings (barred doors, half cover at the windows), on an upper floor or a flat roof (▲ height 1: further sight, +5 aim down, half cover), on a tower (▲▲), or behind the barricades.</div>
    <div class="cbactions" style="margin-top:0.4rem">
      <button data-action="cb-deploy" data-v="defaults" data-tip="The default posts: the best shots on the towers, upper floors and roofs, then at the windows; close fighters inside by the doors; the rest behind cover in the yard.">Default positions</button>
      ${after ? `<button class="${cui.autoRedeploy ? "active" : ""}" data-action="cb-redeploy" data-tip="When on, falling back skips this step: your people take the default posts and the fight goes on at once. Remembered in this browser.">${cui.autoRedeploy ? "✔" : "✗"} Skip this next time</button>` : ""}
    </div>`;
  if (D.floodlit) {
    html += `<div class="small" style="margin-top:0.4rem" data-tip="The floodlights light a third of the yard: shots at anything in the light get +${b.floodAim}${D.night ? ", and at night your people see what stands in it" : ""}.">Floodlights (+${b.floodAim} to hit in the light):</div><div class="cbactions">
      ${Object.entries(LIT_ZONES).map(([z, name]) => `<button class="${D.lit === z ? "active" : ""}" data-action="cb-deploy" data-v="flood" data-z="${z}" data-tip="Aim the floodlights ${name.toLowerCase()} (as the defenders see it).">${name}</button>`).join("")}</div>`;
  }
  html += `<div id="cbprev" class="cbprev">${previewHtml(b)}</div>`;
  if (cui.msg) html += `<div class="small warn cbmsg">${esc(cui.msg)}</div>`;
  html += `<h3>Log</h3><div class="cblog" id="cblog">${b.log.slice(-20).map((l) => `<div class="k-${l.k}"><span class="t">T${l.turn}</span>${esc(l.text)}</div>`).join("")}</div>`;
  html += `<div class="cbfoot"><button class="primary" data-action="cb-deploy" data-v="start" data-tip="Everyone is in place: the fight goes on. (Enter)">${after ? "Hold the yard" : "Start the fight"}</button>
    ${!b.acted && b.turn === 1 ? `<button data-action="cb-auto" data-tip="Skip the tactical battle and resolve it instantly by the numbers.">Auto-resolve</button>` : ""}</div>`;
  void u;
  return html;
}

// ---------- prisoners on the result screen (sim/prisoners.js) ----------
function prisonersHtml(b) {
  const list = (b.result && b.result.prisoners) || [];
  if (!list.length) return "";
  const leave = !!b.leavePrisoners;
  return `<div class="small" style="margin-top:0.5rem"><b>Prisoners:</b> ${esc(list.map((p) => `${p.name} (${p.group})`).join(", "))}. ${leave ? "You will leave them tied up here." : b.setup.baseId != null ? "They go into the cells (1 food and 1 water a day each)." : "They walk home with the team, tied (on foot each slows it 10%, and they may slip away)."}</div>
    <div class="cbactions" style="margin-top:0.3rem">
      <button class="${leave ? "" : "active"}" data-action="cb-prison" data-v="take" data-tip="Take them: question them for intel, ransom them, trade them back for goodwill or slowly win them over (the Prisoners tab of the base).">Take them</button>
      <button class="${leave ? "active" : ""}" data-action="cb-prison" data-v="leave" data-tip="Leave them tied up here. Their group hears of the mercy (goodwill +2).">Leave them</button>
    </div>`;
}

function raidResult(state, b) {
  const r = b.result;
  const R = r.raid;
  const names = (ids) => ids.map((id) => esc((state.survivors.find((s) => s.id === id) || { name: "?" }).name)).join(", ");
  const loot = [...Object.entries(r.loot.supplies).map(([k, n]) => `${n} ${k}`), ...r.loot.gear.map((g) => g.name)];
  return `<div class="cbresult ${r.outcome === "extracted" ? "victory" : "defeat"}">
    <h2>${r.outcome === "extracted" ? "Got out" : "Nobody made it out"}</h2>
    <div class="kv small">
      <div>Made it out</div><div>${R.extractedIds.length ? names(R.extractedIds) : "nobody"}</div>
      <div>Dead or left behind</div><div class="${r.survivorsDead.length ? "danger" : ""}">${r.survivorsDead.length ? names(r.survivorsDead) : "none"}</div>
      <div>Wounded</div><div>${r.survivorsHurt.length ? names(r.survivorsHurt) : "none"}</div>
      <div>Searched</div><div>${R.searched} of ${R.total} containers</div>
      <div>Loot</div><div>${loot.length ? esc(loot.join(", ")) : "nothing"}</div>
      <div>Time</div><div>${r.turns} turns (about ${R.hours}h on the map clock)</div>
      ${R.hadVehicle ? `<div>Vehicle</div><div class="${R.vehicleKept ? "good" : "danger"}">${R.vehicleKept ? "Kept" : "Left behind at the site"}</div>` : ""}
      <div>Killed</div><div>${r.enemiesKilled}${r.extraKilled ? ` (+${r.extraKilled} drawn by Heat)` : ""}</div>
    </div>
    ${b.summary.length ? `<div class="small muted" style="margin-top:0.4rem">${b.summary.map(esc).join("<br>")}</div>` : ""}
    ${prisonersHtml(b)}
    <button class="primary" style="margin-top:0.7rem;width:100%" data-action="cb-close" data-tip="Return to the State Map. The team then waits for orders.">Continue</button>
  </div>
  <h3>Log</h3><div class="cblog" id="cblog">${b.log.slice(-40).map((l) => `<div class="k-${l.k}"><span class="t">T${l.turn}</span>${esc(l.text)}</div>`).join("")}</div>`;
}

function resultHtml(state, b) {
  if (b.raid) return raidResult(state, b);
  const r = b.result;
  const title = r.outcome === "victory" ? "Victory" : r.outcome === "retreat" ? "You got out" : "Defeat";
  const names = (ids) => ids.map((id) => esc((state.survivors.find((s) => s.id === id) || { name: "?" }).name)).join(", ");
  const loot = [
    ...Object.entries(r.loot.supplies).map(([k, n]) => `${n} ${(SUPPLIES[k] ? SUPPLIES[k].name : k).toLowerCase()}`),
    ...r.loot.gear.map((g) => g.name),
  ];
  // Bodies still holding something (sim/inventory.js); looting happens in the "Loot the bodies" screen.
  const bodies = (b.bodies || []).filter((x) => !bodyEmpty(state, x)).length;
  return `<div class="cbresult ${r.outcome}">
    <h2>${title}</h2>
    <div class="kv small">
      <div>Enemies killed</div><div>${r.enemiesKilled}${r.extraKilled ? ` (+${r.extraKilled} drawn by noise)` : ""}</div>
      <div>Enemies left</div><div>${r.enemiesLeft}</div>
      <div>Wounded</div><div>${r.survivorsHurt.length ? names(r.survivorsHurt) : "none"}</div>
      <div>Dead</div><div class="${r.survivorsDead.length ? "danger" : ""}">${r.survivorsDead.length ? names(r.survivorsDead) : "none"}</div>
      ${r.retreatOrder ? `<div>Retreat</div><div>sounded ${r.retreatOrder.by === "ai" ? "by your people" : "by you"} on turn ${r.retreatOrder.turn}</div>
      <div>Got out</div><div class="good">${r.retreatOrder.escaped.length ? names(r.retreatOrder.escaped) : "nobody"}</div>
      ${r.retreatOrder.caught.length ? `<div>Caught</div><div class="warn">${names(r.retreatOrder.caught)}</div>` : ""}` : ""}
      ${r.carriedIds && r.carriedIds.length ? `<div>Carried out</div><div class="good">${names(r.carriedIds)}</div>` : ""}
      <div>Ammo used</div><div>${r.ammoUsed}</div>
      <div>${bodies ? "Taken" : "Loot"}</div><div>${loot.length ? esc(loot.join(", ")) : "nothing"}</div>
      ${bodies ? `<div>Bodies</div><div>${bodies} with things on them</div>` : ""}
    </div>
    ${b.summary.length ? `<div class="small muted" style="margin-top:0.4rem">${b.summary.map(esc).join("<br>")}</div>` : ""}
    ${prisonersHtml(b)}
    ${bodies ? `<button style="margin-top:0.7rem;width:100%" data-action="loot-open" data-tip="Search the dead one by one: see what each carries and move it to your people or the cargo.">Loot the bodies (${bodies})</button>
    <button class="primary" style="margin-top:0.4rem;width:100%" data-action="cb-close" data-take="1" data-tip="Take everything that fits (supplies first, then the most valuable items) and return to the State Map. (Enter)">Take all and continue</button>
    <button style="margin-top:0.4rem;width:100%" data-action="cb-close" data-take="0" data-tip="Return to the State Map. What is left on the bodies stays where they fell: a death site scavengers strip over the next days.">Leave the rest and continue</button>` :
    `<button class="primary" style="margin-top:0.7rem;width:100%" data-action="cb-close" data-tip="Close the battle and return to the State Map.">Continue</button>`}
  </div>
  <h3>Log</h3><div class="cblog" id="cblog">${b.log.slice(-40).map((l) => `<div class="k-${l.k}"><span class="t">T${l.turn}</span>${esc(l.text)}</div>`).join("")}</div>`;
}

// Odds for the selected unit against a target: shot if it can, melee if adjacent.
function odds(b, u, t) {
  if (cui.mode === "subdue") {
    if (!canSubdue(u, t)) return { ok: false, label: t.kind === "zombie" ? "The dead cannot be subdued" : "Subdue needs them right next to you" };
    const o = subdueOdds(b, u, t);
    return { ...o, ok: true, label: o.label };
  }
  if ((cui.mode === "melee" || !canFire(b, u)) && adjacent(u, t)) {
    const o = meleeOdds(b, u, t);
    return { ...o, ok: true, label: `Melee ${o.chance}% to hit, ${o.dmg[0]}–${o.dmg[1]} damage, ${o.crit}% crit (×${CRIT_MULT})` };
  }
  if (!canFire(b, u)) return { ok: false, label: isRanged(u) ? "Out of ammo" : "No gun: move next to them and use Melee" };
  if (!canSee(b, u, t)) return { ok: false, label: "No line of sight" };
  const o = shotOdds(b, u, t);
  const cover = o.cover === 2 ? "in full cover" : o.cover === 1 ? "in half cover" : o.flanked ? "FLANKED" : t.kind === "zombie" || !t.aware || t.surprised ? "caught in the open" : "exposed";
  return { ...o, ok: true, label: `${o.chance}% to hit, ${o.dmg[0]}–${o.dmg[1]} damage, ${o.crit}% crit (×${CRIT_MULT}), ${cover}${t.hunker ? ", hunkered" : ""}` };
}

function previewHtml(b) {
  const h = cui.hover;
  const u = selUnit(b);
  if (!h) return `<span class="muted">Hover a tile or enemy for details.</span>`;
  const v = view(b);
  const t = unitAt(b, h.x, h.y);
  if (t && t.side === "enemy" && v.seen.has(t.id)) {
    const o = u && active(u) ? odds(b, u, t) : null;
    const stealthy = t.investigate ? ' · <span class="warn">going to look at a noise</span>' : "";
    // What it follows (sim/decoys.js), a Shepherd's pack, the siege kit it carries (sim/siege.js).
    const sense = t.kind === "zombie" ? (herded(b, t) ? ' · <span class="danger">herded by a Shepherd: decoys and fire do not work on it</span>' : ` · <span class="muted">follows ${sensesOf(b, t).join(" and ") || "nothing"}</span>`) : "";
    const kit = t.ram != null && ramOf(b, t) ? ' · <span class="warn">carrying the ram (no cover)</span>' : t.ladder ? ' · <span class="warn">carrying a ladder</span>' : t.throwables && Object.values(t.throwables).some((n) => n > 0) ? ' · <span class="warn">has grenades</span>' : b.cells[t.y * W + t.x].k === "siegeladder" ? ' · <span class="warn">on a ladder (exposed)</span>' : "";
    // A hive's special dead (sim/zombietypes.js): what it does and what beats it.
    // The armoured dead (sim/deadsoldiers.js): how much of the selected unit's weapon gets through.
    const ar = t.ztype && MILDEAD.ARMOR[t.ztype] && u && active(u) ? (() => {
      const melee = !!(WEAPONS[u.weapon] && WEAPONS[u.weapon].melee);
      const m = armorVs(t, u, { how: melee ? "melee" : "shot" });
      return ` <span class="${m >= 0.8 ? "good" : m >= 0.55 ? "warn" : "danger"}">Armour: ${Math.round(m * 100)}% of ${esc(u.weaponName)}'s damage gets through${stabsGap(u, t) ? ` (a blade from behind or unseen: all of it)` : ""}; critical hits always do.</span>`;
    })() : "";
    // A Boneback (sim/middead.js): how much of a hit from where the selected unit stands gets past its plates.
    const bp = t.ztype === "boneback" && u && active(u) ? (() => { const m = hitMult(t, u, { how: "shot" }) / (t.armor || 1); return ` <span class="${m >= 0.8 ? "good" : "danger"}">${m >= 0.8 ? `${esc(u.name.split(" ")[0])} has its flank: every hit counts.` : `It faces ${esc(u.name.split(" ")[0])}: ${Math.round(m * 100)}% of a hit gets through. Hit it from the side or behind.`}</span>`; })() : "";
    const zt = t.ztype && ZTYPES[t.ztype] ? `<br><span class="small">${esc(ZTYPES[t.ztype].special)}${t.ztype === "spitter" && t.cd > 0 ? " Spits again next turn." : ""}${t.windup != null ? ` Winding up to throw at ${esc((b.units.find((o) => o.id === t.windup) || {}).name || "someone")}.` : t.ztype === "flinger" && t.cd > 0 ? " Throws again soon." : ""}${t.ztype === "nightmare" && t.screamCd > 0 ? ` Screams again in ${t.screamCd} turn${t.screamCd > 1 ? "s" : ""}.` : ""}${ar}${bp} <span class="good">Counter: ${esc(ZTYPES[t.ztype].counter)}</span></span>` : "";
    // One of the risen (sim/carriers.js): who it was, and the armour it still wears.
    const turned = t.turned ? `<br><span class="small danger">${esc(t.turned.name)}, got up as one of the dead${t.armor < 0.99 ? `, still in their armour (a hit does ${Math.round(t.armor * 100)}%)` : ""}. Put down, what they had on is on the body.</span>` : "";
    return `<b>${esc(t.name)}</b> <span class="muted">${esc(t.weaponName)} · ${Math.round(t.hp)}/${t.maxHp} hp</span>${stealthy}${sense}${kit}${zt}${turned}<br>${o ? (o.ok ? `<span class="${o.chance >= 65 ? "good" : o.chance >= 35 ? "warn" : "danger"}">${esc(o.label)}</span>` : `<span class="muted">${esc(o.label)}</span>`) : ""}`;
  }
  // The third side (sim/thirdside.js): survivors keeping to themselves, soldiers fighting the dead.
  if (t && t.side === "third" && v.seen.has(t.id)) return `<b>${esc(t.name)}</b> <span class="muted">${esc(t.weaponName)} · ${Math.round(t.hp)}/${t.maxHp} hp</span><br><span class="small">${t.team === "military" ? "A soldier: fights the dead and anyone who attacks them, not you unless you fire on them." : "A survivor keeping to themselves: they defend themselves or run. Talk to them after the fight."} Click twice to attack.</span>`;
  // The knocked out (sim/stealth.js).
  if (t && t.side === "enemy" && t.ko && v.vis[h.y * W + h.x]) return `<b>${esc(t.name)}</b> · ${t.tied ? "tied up: your prisoner if you win" : `out cold, wakes in about ${Math.max(1, t.wake - b.turn)} turn${t.wake - b.turn === 1 ? "" : "s"}: Tie up (T) from next to them`}. <span class="muted">Drag (D) moves them out of sight.</span>`;
  if (t && t.side === "player") {
    if (b.phase === "deploy") return `<b>${esc(t.name)}</b> <span class="muted">${Math.round(t.hp)} hp · ${esc(t.weaponName)}${t.post === "gate" ? " · holds the gate" : t.post === "tower" ? " · on a tower" : ""}</span>`;
    const hh = heightAt(b, t.x, t.y);
    return `<b>${esc(t.name)}</b> <span class="muted">${Math.round(t.hp)} hp · ${esc(t.weaponName)}${t.light ? " · flashlight" : ""}${t.nvg ? " · night vision" : ""}${t.optic ? ` · optics +${t.optic}` : ""}${t.suppressor ? ` · suppressor (${t.suppressor.dur ?? GEAR.suppressor.dur} shots)` : ""} · sees ${Math.round(sightRange(b, t))} tiles</span>${hh ? `<br><span class="good">${"▲".repeat(hh)} On high ground (height ${hh}): +${HEIGHT.SIGHT * hh} sight, +${Math.min(HEIGHT.MAX_AIM, HEIGHT.AIM * hh)} aim at anything lower, half cover against shooters below.</span>` : ""}`;
  }
  // A human body (sim/carriers.js): its state, and what can be done with it.
  const body = v.vis[h.y * W + h.x] ? humanBodyAt(b, h.x, h.y) : null;
  if (body) {
    const state_ = body.burnt ? '<span class="muted">burnt: nothing left to loot</span>' : body.crushed ? '<span class="good">will not get up</span>' : imminent(b, body) ? '<span class="danger">a Carrier is on it: it gets up at the end of this turn</span>' : endangered(b, body) ? '<span class="warn">in danger: a Carrier is near, or the worm is in it</span>' : '<span class="muted">could get up if a Carrier reaches it</span>';
    const near = u && active(u) && Math.max(Math.abs(u.x - body.x), Math.abs(u.y - body.y)) <= 1;
    const acts = body.burnt ? "" : `<br><span class="small muted">${[!body.crushed ? `Crush skull (U${near ? "" : ", from next to it"})` : "", !body.crushed ? "Double tap (J, a gun in sight: 1 round, noise)" : "", `Pick up body (P${near ? "" : ", from next to it"})`].filter(Boolean).join(" · ")}. Fire on its tile destroys the body and everything on it; a crushed skull keeps the loot.</span>`;
    return `<b>${esc(bodyName(body))}</b> · ${state_}${acts}`;
  }
  // A last-seen ghost (sim/combat.js enemyGhosts): where an enemy was when your people last saw it.
  const ghost = (v.ghosts || []).find((g) => g.x === h.x && g.y === h.y && !v.vis[h.y * W + h.x]);
  if (ghost) return `<b>${esc(ghost.name)}</b> <span class="muted">last seen here on turn ${ghost.turn}. Nobody sees this tile now: it may have moved.</span>`;
  if (b.phase === "deploy") {
    const k = b.cells[h.y * W + h.x].k;
    const where = k === "gate" ? "The gate: whoever stands here holds it." : k === "breach" ? "A breach in the wall: whoever stands here holds it." : k === "tower" ? "A watchtower (▲▲ height 2): full cover from anything not next to it, +10 aim down, +4 sight: the widest view." : k === "walkway" ? "The walkway (▲ height 1): shoot down over the wall, +5 aim, +2 sight, half cover against shooters below." : k === "loft" ? "An upper floor (▲ height 1): shoot down through the windows." : k === "roof" ? "A flat roof (▲ height 1): +2 sight, +5 aim down, half cover against shooters below." : k === "ladder" || k === "stairs" ? `${k === "ladder" ? "A ladder" : "Stairs"}: the way up (climbing costs 1 move a level, the dead 2).` : "";
    if (canPlace(b, h.x, h.y)) return `${where ? `<b>${where}</b> ` : ""}Click to place ${selUnit(b) ? esc(selUnit(b).name) : "the selected defender"} here.`;
    if (b.lit && b.lit[h.y * W + h.x]) return "Floodlit: shots at anything here get the light's bonus.";
  }
  const lure = (b.lures || []).find((l) => l.x === h.x && l.y === h.y);
  if (lure) return `<b>${esc(GEAR[lure.key].name)}</b>: ${lure.key === "noisemaker" ? `still ringing (${lure.turns} turn${lure.turns === 1 ? "" : "s"})` : "where it landed"}. Guards and the dead nearby come to look.`;
  if (b.raid) {
    const lockText = lockPreview(b, u, h.x, h.y); // ui/locks.js: a locked container or door
    if (lockText) return lockText;
    const box = boxAt(b, h.x, h.y);
    if (box) {
      const hint = box.kind !== "body" ? areaHint(b.raid.areas[box.area].type) + "."
        : !box.zombie ? "Ammo, maybe food, meds or their gear."
        : box.ztype === "soldier" ? "A dead soldier: worn body armour, a helmet, rounds, now and then a rifle or a radio."
        : box.ztype === "riot" ? "A dead riot cop: the riot helmet and guards, a baton, cuffs, a few rounds."
        : box.ztype === "spitter" ? "What was on them, if you mind the acid still dripping from the sac."
        : "What they had on them when they turned: small things, now and then a pistol.";
      const near = u && nearBox(u, box);
      // sim/search.js: rummaged through (more may be hidden) is its own state.
      const where = box.searched ? "searched" : box.quick ? "rummaged through in a hurry: a full search may turn up more" : box.partial ? "something left inside (no room last time)" : "not searched";
      const how = box.quick ? (near ? `Click to open what turned up (free); S searches it in full (${SEARCH.ap} action).` : "Move next to it to search it in full.")
        : near ? `Click or press S to search (${SEARCH.ap} action, quiet, everything shows). Shift+S: a quick rummage (no action, ${Math.round(SEARCH.quick.reveal[0] * 100)}–${Math.round(SEARCH.quick.reveal[1] * 100)}% of it, heard ${quickRadius(b, u)} tiles off, Heat +${SEARCH.quick.heat}).` : "Move next to it to search.";
      return `<b>${esc(box.label)}</b> · ${where}<br><span class="muted">${hint}</span>${box.searched ? "" : `<br>${how}`}`;
    }
    const z = zoneAt(b, h.x, h.y);
    if (z >= 0) return `<b>${b.raid.zones[z].vehicle ? "Vehicle extraction zone" : "Extraction zone"}</b><br><span class="muted">Stand here and press X to leave the raid.${b.raid.zones[z].vehicle ? " Leaving here keeps your vehicle." : b.raid.vehicleZone >= 0 ? " Leaving here without anyone taking the vehicle leaves it behind." : ""}</span>`;
  }
  const cobj = b.cells[h.y * W + h.x];
  const cell = CDEF(cobj);
  // A building with storeys (floorsOf): outside the footprint on an upper floor, and the stairwells.
  if (cobj.k === "void") return `<b>Open air</b>: outside the building, ${floorNo(b)} floor${floorNo(b) === 1 ? "" : "s"} up. The ground lies below (dimmed); the street is on the ground floor (PageDown).`;
  if (floorsOf(b) && cobj.k === "stairs") {
    const F = floorsOf(b), f = floorNo(b);
    const ways = [f < F.length - 1 ? `up to ${floorLabel(b, f + 1).toLowerCase()}` : "", f > 0 ? `down to ${floorLabel(b, f - 1).toLowerCase()}` : ""].filter(Boolean).join(" or ");
    const here = u && alive(u) && u.x === h.x && u.y === h.y && onFloor(b, u);
    return `<b>Stairwell</b>: the same cell on every floor. ${here ? `${esc(u.name.split(" ")[0])} stands on it: <b>Go up</b> / <b>Go down</b> in the actions (1 action)` : `Stand on it to go ${ways} (1 action, the dead 2)`}. Nobody may be standing on the stairwell on the floor you go to.${!v.vis[h.y * W + h.x] ? " Not in sight right now." : ""}`;
  }
  // A building's map (sim/buildingmaps.js): windows to climb, doors, the room under the mouse.
  const room = b.raid && b.raid.interior ? b.raid.areas.find((a) => !a.outdoor && h.x > a.x0 && h.x < a.x0 + a.w - 1 && h.y > a.y0 && h.y < a.y0 + a.h - 1) : null;
  if (b.raid && b.raid.interior && cobj.k === "window") return `<b>Window</b>: half cover; you see through it. Cannot stand here.<br><span class="muted">From right next to it (not diagonally): Climb window (L) smashes it and climbs through. Loud: Heat +${BMAP.CLIMB.heat}, wakes what is within ${BMAP.CLIMB.radius} tiles.</span>`;
  if (b.raid && b.raid.interior && (cobj.k === "idoor" || cobj.k === "odoor")) {
    const shut = cobj.k === "idoor";
    const held = shut && doorHeld(b, cobj) ? unitById(b, cobj.held) : null;
    const hp = cobj.mhp ? ` · <span class="${cobj.hp / cobj.mhp < 0.5 ? "danger" : "muted"}">${Math.round(cobj.hp)}/${cobj.mhp}</span>` : "";
    return shut
      ? `<b>${cobj.roll ? "Roller door (closed)" : "Closed door"}</b>${hp}${held ? ` · <span class="good">braced by ${esc(held.name)}</span>` : ""}<br><span class="muted">Blocks sight. Your people open it by walking through${cobj.roll ? " (loud: Heat +" + BMAP.ROLLER.heat + ")" : " (quiet)"}; other people stop to open it; the dead must batter it down. Peek (K) through it from next to it.</span>`
      : `<b>${cobj.roll ? "Roller door (open)" : "Open door"}</b>${hp}<br><span class="muted">Close door (Q) from next to it: 1 action, quiet${cobj.roll ? " (a roller door: loud)" : ""}. A shut door stops sight and slows the dead.</span>`;
  }
  // Something the attackers batter (sim/combat.js bash): a wall section, the gate, a barred door, a window.
  const struct = cobj.mhp ? ` <span class="${cobj.hp / cobj.mhp < 0.5 ? "danger" : "warn"}">${Math.round(cobj.hp)}/${cobj.mhp} hit points</span>${barredCell(cobj) ? " · barred to the attackers (your people pass)" : ""}.` : "";
  if (!cell.walk) return `<b>${cobj.mhp ? structureName(cobj) : cell.name}</b>: ${cell.cover === 2 ? "full cover" : cell.cover === 1 ? "half cover" : "no cover"}${cell.los || cobj.t ? ", blocks sight from the ground" : ""}. Cannot stand here.${struct}`;
  const sides = coverSides(b, h.x, h.y);
  const best = Math.max(...sides);
  let s = best === 2 ? "Full cover next to this tile." : best === 1 ? "Half cover next to this tile." : "No cover here.";
  if (v.reach && u) {
    const d = v.reach.dist[h.y * W + h.x];
    if (isFinite(d) && d > 0) s = `${d <= u.mob ? "Move: 1 action" : "Dash: 2 actions"}. ${s}`;
    // A spitter's acid (sim/acid.js) on the way there.
    if (isFinite(d) && d > 0 && !acidAt(b, h.x, h.y) && pathTo(v.reach, h.x, h.y).some(([x, y]) => acidAt(b, x, y)) && u.acidT !== b.turn) s += ` <span class="danger">The way there crosses acid: ${ACID.pool[0]}–${ACID.pool[1]} damage.</span>`;
  }
  // A spitter's acid pool (sim/acid.js).
  const pool = acidAt(b, h.x, h.y);
  if (pool) s = `<b class="danger">Acid</b> <span class="muted">(${pool.turns} turn${pool.turns === 1 ? "" : "s"} left)</span>: ${ACID.pool[0]}–${ACID.pool[1]} damage to the living who step in or start their turn in it (once a turn; armour stops only half as much). The dead walk through it unharmed.${u && u.acidT === b.turn ? " <span class=\"muted\">Already burned this turn.</span>" : ""} ${s}`;
  if (evacAt(b, h.x, h.y)) s += b.tier ? (b.tier.map === "wall" ? " The back gate: one person can slip away from here (the team falls back to the yard instead: Shift+R)." : " The back gate: leaving from here abandons the base.") : " Evac zone: you can retreat from here (a downed teammate dragged here goes with the last one out).";
  const hh = heightAt(b, h.x, h.y);
  if (hh) s += ` ${"▲".repeat(hh)} ${cell.name}, height ${hh}: +${HEIGHT.SIGHT * hh} sight, +${Math.min(HEIGHT.MAX_AIM, HEIGHT.AIM * hh)} aim at anything lower, half cover against shooters below.`;
  else if (cell.climb) s += ` ${cell.name}: the way up (climbing costs ${HEIGHT.CLIMB} move a level, the dead ${HEIGHT.CLIMB_DEAD}).`;
  if (cobj.mhp) s += ` ${structureName(cobj)}:${struct}`;
  if (b.tier && b.tier.indoor && b.tier.indoor[h.y * W + h.x]) s += ` Inside ${esc((b.tier.buildings || []).find((x) => x.cells.some(([cx, cy]) => cx === h.x && cy === h.y))?.name || "a building")}.`;
  if (room) s += ` ${esc(room.name)}${room.type ? ` (${esc(areaHint(room.type).replace(/^Likely: /, "likely ").toLowerCase())})` : ""}.`;
  if (!v.vis[h.y * W + h.x]) s += " Not in sight right now.";
  return s;
}

// ---------- drawing ----------
const FLOOR = { grass: "#36432c", field: "#4a4a2c", dirt: "#4a4234", gravel: "#47464a", road: "#2f3135", deck: "#4d4e4b", floor: "#3b3129", rubble: "#423e3b" };
// A building's floors by room (sim/buildingmaps.js c.fl).
const ROOM_FLOOR = { wood: "#3b3129", tile: "#4c4a44", conc: "#3e3d3b", carpet: "#3a2f34", dirt: "#40372b" };

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function drawCombat(state, now) {
  const b = state.combat;
  if (!b || !canvas) return;
  sync(b);
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch) return;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (isIso()) {
    drawIsoView(state, b, now, cw, ch);
    drawBanner(b, cw, 40);
    return;
  }
  const cs = Math.max(16, Math.floor(Math.min((cw - 24) / W, (ch - 60) / H)));
  geo.cs = cs;
  geo.ox = Math.floor((cw - cs * W) / 2);
  geo.oy = Math.floor((ch - cs * H) / 2) + 16;
  const { ox, oy } = geo;
  const v = view(b);
  const u = v.u;

  ctx.fillStyle = "#0d0f12";
  ctx.fillRect(0, 0, cw, ch);

  // Ground and objects.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = b.cells[y * W + x];
    const px = ox + x * cs, py = oy + y * cs;
    if (c.k === "void") { ctx.fillStyle = VOID_TOP; ctx.fillRect(px, py, cs, cs); continue; } // outside the footprint on an upper floor (floorsOf)
    ctx.fillStyle = (c.f === "floor" && c.fl && ROOM_FLOOR[c.fl]) || (c.deck ? FLOOR.deck : FLOOR[c.f]) || FLOOR.grass; // deck: a bridge's concrete (sim/combat.js layRoad)
    ctx.fillRect(px, py, cs, cs);
    const n = hash(x, y);
    if (c.f === "grass" || c.f === "field") { ctx.fillStyle = `rgba(255,255,255,${0.02 + n * 0.03})`; ctx.fillRect(px + n * cs * 0.6, py + ((n * 7) % 1) * cs * 0.6, cs * 0.25, cs * 0.25); }
    if (c.f === "road" && y % 2 === 0 && x % 2 === 0) { ctx.fillStyle = "#6b6a4a"; ctx.fillRect(px + cs * 0.2, py + cs - 1, cs * 0.6, 2); }
    drawObject(c.k === "siegeladder" ? "palisade" : c.k, px, py, cs, n, c); // a siege ladder is drawn over its wall (drawSiegeTop)
    // Raised ground (verticality): lighter the higher it is.
    const hh = c.h ?? CDEF(c).h ?? 0;
    if (hh && CDEF(c).walk) { ctx.fillStyle = `rgba(255,236,190,${0.08 * hh})`; ctx.fillRect(px, py, cs, cs); }
  }
  // Grid.
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x++) { ctx.moveTo(ox + x * cs + 0.5, oy); ctx.lineTo(ox + x * cs + 0.5, oy + H * cs); }
  for (let y = 0; y <= H; y++) { ctx.moveTo(ox, oy + y * cs + 0.5); ctx.lineTo(ox + W * cs, oy + y * cs + 0.5); }
  ctx.stroke();

  drawHeights(b, cs); // edges of raised ground, ▲ marks, the hit points of walls, gates, doors and windows
  if (b.tier && b.tier.buildings) drawBuildingNames(b, cs);

  // Evac strip.
  if (b.evacCols && b.evacMask) {
    // A base battle's way out, on the side away from the attack (sim/deploy.js).
    ctx.fillStyle = "rgba(108,196,138,0.16)";
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.evacMask[y * W + x]) ctx.fillRect(ox + x * cs, oy + y * cs, cs, cs);
  } else if (b.evacCols) {
    ctx.fillStyle = "rgba(108,196,138,0.16)";
    ctx.fillRect(ox, oy, b.evacCols * cs, H * cs);
    ctx.strokeStyle = "rgba(108,196,138,0.7)";
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(ox + 1, oy + 1, b.evacCols * cs - 2, H * cs - 2);
    ctx.setLineDash([]);
    ctx.fillStyle = "#6cc48a";
    ctx.font = `600 ${Math.round(cs * 0.28)}px Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("EVAC", ox + b.evacCols * cs / 2, oy - 6);
  }

  if (b.raid) drawRaidOverlay(b, cs);
  drawBaseOverlay(b, cs); // the deploy step and floodlights (sim/deploy.js)

  // Fog: tiles none of your people can see (darker on a night raid).
  ctx.fillStyle = b.night ? "rgba(3,5,14,0.7)" : "rgba(5,6,8,0.5)";
  for (let i = 0; i < W * H; i++) if (!v.vis[i]) ctx.fillRect(ox + (i % W) * cs, oy + ((i / W) | 0) * cs, cs, cs);
  // Seen only through a peek this turn (sim/buildingmaps.js): a warm tint and its outline.
  if (v.vis.some((q) => q === 2)) {
    ctx.fillStyle = "rgba(255,214,120,0.10)";
    for (let i = 0; i < W * H; i++) if (v.vis[i] === 2) ctx.fillRect(ox + (i % W) * cs, oy + ((i / W) | 0) * cs, cs, cs);
    const band = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) band[i] = v.vis[i] === 2 ? 1 : 0;
    ctx.setLineDash([4, 4]); outline(band, (k) => k === 1, "rgba(255,214,120,0.7)"); ctx.setLineDash([]);
  }
  if (b.night) drawLights(b, cs); // flashlight cones (sim/stealth.js)
  drawLures(b, cs, now); // thrown bottles, noise makers, firecrackers; fire, smoke, decoys
  drawSiegeTop(b, cs, now, v.vis); // ladders, rams, a Shepherd's aura (sim/siege.js battleOverlays)

  // Movement range: blue = 1 action, yellow = dash.
  if (v.reach && cui.mode === "move" && u) {
    const bands = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) { const d = v.reach.dist[i]; bands[i] = isFinite(d) ? (d <= u.mob ? 1 : 2) : 0; }
    bands[u.y * W + u.x] = 1;
    for (let i = 0; i < W * H; i++) {
      if (!bands[i]) continue;
      ctx.fillStyle = bands[i] === 1 ? "rgba(80,150,255,0.20)" : "rgba(255,200,60,0.14)";
      ctx.fillRect(ox + (i % W) * cs, oy + ((i / W) | 0) * cs, cs, cs);
    }
    outline(bands, (k) => k >= 1 && u.ap >= 2, "rgba(255,200,60,0.85)");
    outline(bands, (k) => k === 1, "rgba(110,175,255,0.95)");
  }

  // Treat targets.
  if (cui.mode === "meds" && u) {
    for (const p of players(b)) if (!p.dead && !p.left && (p === u || adjacent(u, p))) {
      ctx.strokeStyle = "#6cc48a"; ctx.lineWidth = 2;
      ctx.strokeRect(ox + p.x * cs + 3, oy + p.y * cs + 3, cs - 6, cs - 6);
    }
  }

  // Hovered tile: path, cover shields.
  const h = cui.hover;
  if (h) {
    const hc = CDEF(b.cells[h.y * W + h.x]);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox + h.x * cs + 1, oy + h.y * cs + 1, cs - 2, cs - 2);
    if (hc.walk) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = h.x + dx, y = h.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= H || !CDEF(b.cells[y * W + x]).walk) continue;
        if ((dx || dy) && unitAt(b, x, y)) continue;
        shields(b, x, y, dx || dy ? 0.55 : 1);
      }
    }
    if (v.reach && u && cui.mode === "move" && !unitAt(b, h.x, h.y) && isFinite(v.reach.dist[h.y * W + h.x])) {
      const path = pathTo(v.reach, h.x, h.y);
      ctx.strokeStyle = path.some(([x, y]) => acidAt(b, x, y)) ? "#9ad63a" : v.reach.dist[h.y * W + h.x] <= u.mob ? "#8fc1ff" : "#ffd166"; // green: through a spitter's acid (sim/acid.js)
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(ox + (u.x + 0.5) * cs, oy + (u.y + 0.5) * cs);
      for (const [x, y] of path) ctx.lineTo(ox + (x + 0.5) * cs, oy + (y + 0.5) * cs);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Bodies on the ground (sim/sleepers.js): drawn like the fallen, dimmer where nobody sees now.
  for (const c of b.corpses || []) if (onFloor(b, c)) drawDowned(ctx, corpseCanvas(c), ox + (c.x + 0.5) * cs, oy + (c.y + 0.5) * cs + cs * 0.06, [cs, 0], [0, cs], { facing: c.seed % 2 ? 1 : -1, scale: 1.05, alpha: v.vis[c.y * W + c.x] ? 0.92 : 0.5 });
  // Units (dead and down first); on another floor of a building with storeys only a marker (below).
  const order = b.units.filter((x) => !x.left && !x.fled && !x.off && onFloor(b, x)).sort((a, c) => (active(a) ? 1 : 0) - (active(c) ? 1 : 0));
  for (const t of order) {
    if (t.side !== "player" && !(active(t) ? v.seen.has(t.id) : v.vis[t.y * W + t.x])) continue;
    const pos = animPos(b, t, now);
    drawUnit(state, b, t, pos[0], pos[1], cs, t.id === cui.sel);
  }
  if (floorsOf(b)) drawFloorMarkers(b, v, cs);
  // Last-seen ghosts (fog of war): faded where an enemy nobody sees now was last seen.
  for (const g of v.ghosts || []) {
    if (v.vis[g.y * W + g.x] || !onFloor(b, g)) continue;
    drawGhost(state, b, g, ox + (g.x + 0.5) * cs, oy + (g.y + 0.5) * cs, cs);
  }

  // The retreat confirm is open: each unit's odds of getting out over its head.
  if (retreatAskOpen(b)) {
    ctx.font = `700 ${Math.max(10, Math.round(cs * 0.3))}px Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    for (const p of askPlan(b).units) {
      const t = unitById(b, p.id);
      const label = p.safe ? "SAFE" : `${p.chance}%`;
      const col = p.safe || p.chance >= 75 ? "#6cc48a" : p.chance >= 45 ? "#e0a84f" : "#e2685f";
      const x = ox + (t.x + 0.5) * cs, y = oy + t.y * cs + 2;
      const tw = ctx.measureText(label).width + 10, th = Math.max(14, cs * 0.36);
      ctx.fillStyle = "rgba(15,17,20,0.88)";
      roundRect(x - tw / 2, y - th, tw, th, 4);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillText(label, x, y - th * 0.28);
    }
  }

  // Line of fire to the hovered enemy.
  if (h && u && active(u) && b.phase === "player") {
    const t = unitAt(b, h.x, h.y);
    if (t && t.side === "enemy" && active(t) && v.seen.has(t.id)) {
      const o = odds(b, u, t);
      const col = !o.ok ? "#9aa0a8" : o.chance >= 65 ? "#6cc48a" : o.chance >= 35 ? "#e0a84f" : "#e2685f";
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      if (!o.ok) ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(ox + (u.x + 0.5) * cs, oy + (u.y + 0.5) * cs);
      ctx.lineTo(ox + (t.x + 0.5) * cs, oy + (t.y + 0.5) * cs);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ox + (t.x + 0.5) * cs, oy + (t.y + 0.5) * cs, cs * 0.46, 0, Math.PI * 2);
      ctx.stroke();
      bubble(h.px + 14, h.py - 8, o.ok ? [`${o.chance}%`, `${o.dmg[0]}–${o.dmg[1]} dmg`, o.flanked ? "FLANKED" : o.cover ? (o.cover === 2 ? "Full cover" : "Half cover") : ""] : [o.label], col, cw);
    }
  }

  drawFx(b, now, cs);
  drawBanner(b, cw, cs);
}

// The isometric view (ui/isoview.js) with what it needs from here.
function drawIsoView(state, b, now, cw, ch) {
  const v = view(b);
  const plan = retreatAskOpen(b) ? askPlan(b) : null;
  drawIso(ctx, cw, ch, state, b, now, {
    v, u: v.u, sel: cui.sel, mode: cui.mode, hover: cui.hover, salt: cui.salt,
    animPos: (t, n) => { const [x, y] = animTile(b, t, n); return [x + 0.5, y + 0.5]; },
    fxAge: (f, n) => { if (!cui.anim.has(f.seq)) cui.anim.set(f.seq, n); return n - cui.anim.get(f.seq); },
    unitAt: (x, y) => unitAt(b, x, y), pathTo, odds, bubble,
    hits: hitLabels(b, v), retreatOpen: !!plan, plan,
  });
}
// The selected unit's hit chance against every enemy in sight (the isometric view shows it over their heads).
function hitLabels(b, v) {
  const key = `${v.key}:${cui.mode}`;
  if (v.hitsKey === key) return v.hits;
  const u = v.u, out = new Map();
  if (u && active(u) && u.ap > 0 && b.phase === "player" && !b.over) {
    for (const t of b.units) {
      if (t.side !== "enemy" || !active(t) || !v.seen.has(t.id)) continue;
      const o = odds(b, u, t);
      if (o && o.ok) out.set(t.id, o);
    }
  }
  v.hitsKey = key; v.hits = out;
  return out;
}

// The top-down view of a building with storeys: units on other floors as a faint ▲ / ▼ marker with the floor at
// their x, y (the isometric view: ui/isoview.js), and the stairwells' arrows.
const VOID_TOP = "#111317";
function drawFloorMarkers(b, v, cs) {
  const { ox, oy } = geo;
  ctx.font = `700 ${Math.max(9, Math.round(cs * 0.3))}px Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  const f0 = floorNo(b), F = floorsOf(b);
  for (const t of b.units) {
    const tf = t.f || 0;
    if (t.left || t.fled || t.off || t.dead || tf === f0) continue;
    if (t.side !== "player" && !v.seen.has(t.id)) continue;
    const px = ox + t.x * cs, py = oy + t.y * cs;
    ctx.strokeStyle = t.side === "player" ? "rgba(143,193,255,0.7)" : "rgba(255,143,133,0.7)";
    ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.strokeRect(px + 3, py + 3, cs - 6, cs - 6);
    ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillText(`${tf > f0 ? "▲" : "▼"}${tf + 1}`, px + cs / 2, py + cs * 0.62);
  }
  const sel = selUnit(b);
  const up = f0 < F.length - 1, down = f0 > 0;
  ctx.font = `700 ${Math.max(8, Math.round(cs * 0.26))}px Segoe UI, sans-serif`;
  for (let i = 0; i < W * H; i++) {
    if (b.cells[i].k !== "stairs" || !v.vis[i]) continue;
    const x = i % W, y = (i / W) | 0;
    ctx.fillStyle = sel && sel.x === x && sel.y === y && onFloor(b, sel) ? "#ffe296" : "rgba(255,226,150,0.55)";
    ctx.fillText(`${up ? "▲" : ""}${down ? "▼" : ""}`, ox + (x + 0.5) * cs, oy + (y + 0.5) * cs + cs * 0.1);
  }
}

// The phase banner at the top of the map.
function drawBanner(b, cw, cs) {
  const heatTag = b.raid ? ` · HEAT ${HEAT_NAMES[Math.min(3, Math.floor(b.raid.heat / 25))].toUpperCase()}` : "";
  const nightTag = b.night ? " · NIGHT" : "";
  const tierTag = b.tier ? (b.tier.map === "wall" ? " · THE WALLS" : b.tier.stage === "buildings" ? " · LAST STAND" : " · THE YARD") : "";
  const floorTag = floorsOf(b) ? ` · ${floorLabel(b, floorNo(b)).toUpperCase()}` : "";
  const label = b.over ? (b.result.outcome === "victory" ? "VICTORY" : b.result.outcome === "extracted" ? "GOT OUT" : b.result.outcome === "retreat" ? "RETREATED" : "DEFEAT") :
    b.phase === "deploy" ? (b.tier && b.tier.fellBackTurn != null ? "REDEPLOY · FALL BACK TO THE YARD" : `DEPLOY · THEY COME FROM THE ${String((b.deploy && b.deploy.side) || "east").toUpperCase()}`) :
    b.phase === "player" ? `YOUR TURN · ${b.turn}${heatTag}${tierTag}${nightTag}${floorTag}` : `ENEMY TURN${heatTag}${tierTag}${nightTag}${floorTag}`;
  const col = b.over ? (b.result.outcome === "victory" || b.result.outcome === "extracted" ? "#6cc48a" : "#e2685f") : b.phase === "deploy" ? "#e0a84f" : b.phase === "player" ? "#8fb4e0" : "#e2685f";
  ctx.font = `700 ${Math.max(13, Math.round(cs * 0.36))}px Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  const tw = ctx.measureText(label).width + 28;
  ctx.fillStyle = "rgba(15,17,20,0.9)";
  roundRect(cw / 2 - tw / 2, 6, tw, Math.max(24, cs * 0.6), 8);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.fillText(label, cw / 2, 6 + Math.max(24, cs * 0.6) / 2 + 5);
}

// Raid map extras: extraction zones, area names, and markers on containers.
function drawRaidOverlay(b, cs) {
  const { ox, oy } = geo;
  const R = b.raid;
  ctx.textAlign = "center";
  R.zones.forEach((z) => {
    ctx.fillStyle = z.vehicle ? "rgba(90,160,255,0.18)" : "rgba(108,196,138,0.18)";
    ctx.fillRect(ox + z.x0 * cs, oy + z.y0 * cs, z.w * cs, z.h * cs);
    ctx.strokeStyle = z.vehicle ? "rgba(140,190,255,0.9)" : "rgba(108,196,138,0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(ox + z.x0 * cs + 1, oy + z.y0 * cs + 1, z.w * cs - 2, z.h * cs - 2);
    ctx.setLineDash([]);
    ctx.font = `700 ${Math.max(9, Math.round(cs * 0.3))}px Segoe UI, sans-serif`;
    ctx.fillStyle = z.vehicle ? "#a9cbff" : "#6cc48a";
    const ty = z.y0 === 0 ? oy + (z.y0 + z.h) * cs + cs * 0.35 : oy + z.y0 * cs - 4;
    ctx.fillText(z.vehicle ? "VEHICLE · EXTRACT" : z.name ? `${z.name.toUpperCase()} · EXTRACT` : "EXTRACT", ox + (z.x0 + z.w / 2) * cs, ty);
  });
  ctx.font = `600 ${Math.max(9, Math.round(cs * 0.3))}px Segoe UI, sans-serif`;
  for (const a of R.areas) {
    if (a.noLabel || !onFloor(b, a)) continue; // halls and corridors (sim/buildingmaps.js); rooms of other floors
    // A building's rooms (sim/buildingmaps.js): the name inside the room, at its top.
    const x = ox + (a.x0 + a.w / 2) * cs, y = oy + a.y0 * cs + (a.outdoor ? cs * 0.4 : R.interior ? cs * 1.4 : -3);
    const name = a.locked && !(R.doors || []).some((d) => d.area === a.id && d.lock.open) ? `🔒 ${a.name}` : a.name;
    const w = ctx.measureText(name).width + 10;
    ctx.fillStyle = "rgba(15,17,20,0.75)";
    ctx.fillRect(x - w / 2, y - cs * 0.32, w, cs * 0.4);
    ctx.fillStyle = "#e6d8b8";
    ctx.fillText(name, x, y);
  }
  for (const c of R.containers) {
    if (!onFloor(b, c)) continue; // R.containers holds every floor's (floorsOf)
    const [bx, by] = boxCenter(c); // a car covers several cells: its marker over the middle one
    const px = ox + Math.round(bx) * cs, py = oy + Math.round(by) * cs;
    // A fallen unit's body (uid) is its own picture (ui/downsprites.js), drawn with the units: only its marker here.
    if (c.kind === "body" && c.uid == null) {
      ctx.fillStyle = c.searched ? "rgba(120,110,100,0.5)" : "#6b5a44";
      roundRect(px + cs * 0.22, py + cs * 0.55, cs * 0.56, cs * 0.3, 4); ctx.fill();
    }
    const s = cs * 0.24;
    // Searched ✓ grey · rummaged through, more may be hidden … blue (sim/search.js) · things left orange · not yet ? yellow.
    ctx.fillStyle = c.searched ? "rgba(60,64,70,0.9)" : c.quick ? QUICK_MARK : c.partial ? "#e08a4f" : "#ffd166";
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1;
    roundRect(px + cs - s - 2, py + 2, s, s, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c.searched ? "#9aa0a8" : "#1a1a1a";
    ctx.font = `700 ${Math.max(8, Math.round(s * 0.8))}px Segoe UI, sans-serif`;
    ctx.fillText(c.searched ? "✓" : c.quick ? "…" : "?", px + cs - s / 2 - 2, py + 2 + s * 0.8);
  }
  drawLocks(ctx, b, ox, oy, cs); // ui/locks.js: locked doors and padlocks
}

// A base's battle map (sim/deploy.js): the floodlit area, and while deploying the cells defenders may take
// (green), the gate and breaches (orange) and an arrow on the side the attack comes from.
function drawBaseOverlay(b, cs) {
  const { ox, oy } = geo;
  if (b.lit && b.floodAim) {
    ctx.fillStyle = "rgba(255,236,150,0.16)";
    for (let i = 0; i < W * H; i++) if (b.lit[i]) ctx.fillRect(ox + (i % W) * cs, oy + ((i / W) | 0) * cs, cs, cs);
  }
  const D = b.deploy;
  if (!D || b.phase !== "deploy") return;
  const band = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) band[i] = canPlace(b, i % W, (i / W) | 0) ? 1 : 0;
  ctx.fillStyle = "rgba(108,196,138,0.13)";
  for (let i = 0; i < W * H; i++) if (band[i]) ctx.fillRect(ox + (i % W) * cs, oy + ((i / W) | 0) * cs, cs, cs);
  outline(band, (k) => k === 1, "rgba(108,196,138,0.8)");
  ctx.strokeStyle = "#e0a84f";
  ctx.lineWidth = 2.5;
  for (const [x, y] of [...D.gate, ...D.breaches]) ctx.strokeRect(ox + x * cs + 2, oy + y * cs + 2, cs - 4, cs - 4);
  // The arrow: on the edge they come from, pointing in.
  const dir = { east: [1, 0], west: [-1, 0], north: [0, -1], south: [0, 1] }[D.side] || [1, 0];
  const s = cs * 0.5;
  const ax = ox + (W / 2) * cs + dir[0] * ((W / 2) * cs - s * 1.4), ay = oy + (H / 2) * cs + dir[1] * ((H / 2) * cs - s * 1.4);
  ctx.fillStyle = "#e2685f";
  ctx.beginPath();
  ctx.moveTo(ax - dir[0] * s * 0.2, ay - dir[1] * s * 0.2);
  ctx.lineTo(ax + dir[0] * s + dir[1] * s * 0.7, ay + dir[1] * s + dir[0] * s * 0.7);
  ctx.lineTo(ax + dir[0] * s - dir[1] * s * 0.7, ay + dir[1] * s - dir[0] * s * 0.7);
  ctx.closePath();
  ctx.fill();
}

// Verticality and structures: a dark drop edge where raised ground meets lower ground, ▲ (▲▲) on raised cells,
// and a hit-point bar on a wall section, the gate, a door or a window once it has been hit (the gate always).
function drawHeights(b, cs) {
  const { ox, oy } = geo;
  const hOf = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : heightAt(b, x, y));
  ctx.lineWidth = Math.max(2, cs * 0.07);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = b.cells[y * W + x];
    const hh = hOf(x, y);
    const px = ox + x * cs, py = oy + y * cs;
    if (hh && CDEF(c).walk) {
      ctx.strokeStyle = "rgba(10,8,6,0.75)";
      ctx.beginPath();
      if (hOf(x, y + 1) < hh) { ctx.moveTo(px, py + cs - 1); ctx.lineTo(px + cs, py + cs - 1); }
      if (hOf(x + 1, y) < hh) { ctx.moveTo(px + cs - 1, py); ctx.lineTo(px + cs - 1, py + cs); }
      if (hOf(x, y - 1) < hh) { ctx.moveTo(px, py + 1); ctx.lineTo(px + cs, py + 1); }
      if (hOf(x - 1, y) < hh) { ctx.moveTo(px + 1, py); ctx.lineTo(px + 1, py + cs); }
      ctx.stroke();
      ctx.fillStyle = "rgba(255,226,150,0.85)";
      ctx.font = `700 ${Math.max(8, Math.round(cs * 0.22))}px Segoe UI, sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText("▲".repeat(hh), px + 2, py + Math.max(9, cs * 0.24));
    }
    if (c.mhp && (c.hp < c.mhp || c.k === "gate")) {
      const f = Math.max(0, c.hp / c.mhp);
      ctx.fillStyle = "rgba(15,17,20,0.85)"; ctx.fillRect(px + cs * 0.1, py + cs - 6, cs * 0.8, 4);
      ctx.fillStyle = f > 0.6 ? "#6cc48a" : f > 0.3 ? "#e0a84f" : "#e2685f"; ctx.fillRect(px + cs * 0.1, py + cs - 6, cs * 0.8 * f, 4);
    }
  }
}

// The base's buildings by name on the yard and buildings map (sim/interior.js).
function drawBuildingNames(b, cs) {
  const { ox, oy } = geo;
  ctx.font = `600 ${Math.max(9, Math.round(cs * 0.26))}px Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  for (const s of b.tier.buildings) {
    if (!s.cells.length) continue;
    const xs = s.cells.map((c) => c[0]), ys = s.cells.map((c) => c[1]);
    const x = ox + ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * cs, y = oy + Math.min(...ys) * cs + cs * 0.05;
    const w = ctx.measureText(s.name).width + 8;
    ctx.fillStyle = "rgba(15,17,20,0.72)";
    ctx.fillRect(x - w / 2, y - cs * 0.02, w, cs * 0.32);
    ctx.fillStyle = "#e6d8b8";
    ctx.fillText(s.name, x, y + cs * 0.24);
  }
}

// A ghost: a faded silhouette with "?" and the turn it was last seen.
function drawGhost(state, b, g, cx, cy, cs) {
  ctx.globalAlpha = 0.32;
  drawSprite(ctx, unitCanvas(state, b, g.unit, cui.salt), cx, cy, cs, { facing: unitFacing(b, g.unit), lying: false, alpha: 1 });
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,143,133,0.55)";
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(cx, cy + cs * 0.31, cs * 0.36, cs * 0.13, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `700 ${Math.max(9, Math.round(cs * 0.24))}px Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,209,102,0.9)";
  ctx.fillText(`? T${g.turn}`, cx, cy - cs * 0.3);
}

// Flashlight cones on a night raid: each light carrier lights a wedge the way it faces.
function drawLights(b, cs) {
  const { ox, oy } = geo;
  for (const u of players(b)) {
    if (!u.light || !active(u)) continue;
    const f = u.face && (u.face[0] || u.face[1]) ? u.face : [1, 0];
    const a = Math.atan2(f[1], f[0]);
    const cx = ox + (u.x + 0.5) * cs, cy = oy + (u.y + 0.5) * cs, r = cs * 4.5;
    ctx.fillStyle = "rgba(255,240,170,0.16)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a - 0.45, a + 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,240,170,0.12)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r * 0.55, a - 0.3, a + 0.3);
    ctx.closePath();
    ctx.fill();
  }
}

// Thrown things where they landed: the item, and rings while the noise lasts.
function drawLures(b, cs, now) {
  const { ox, oy } = geo;
  // Flames, smoke and flare light (sim/throwables.js): soft discs over the ground, flickering.
  const ph2 = ((now || 0) % 900) / 900;
  const disc = (c, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(ox + (c.x + 0.5) * cs, oy + (c.y + 0.5) * cs, cs * (c.r + 0.5), 0, Math.PI * 2); ctx.fill(); };
  const OV = battleOverlays(b);
  for (const c of OV.flares) disc(c, "rgba(255,90,70,0.10)");
  // A spitter's acid (sim/acid.js): a bubbling green puddle a cell, fading as it dries up.
  const ph3 = ((now || 0) % 1600) / 1600;
  for (const c of OV.acid) {
    const px = ox + c.x * cs, py = oy + c.y * cs, a = c.fade;
    ctx.fillStyle = `rgba(100,180,40,${0.2 * a})`;
    ctx.fillRect(px, py, cs, cs);
    ctx.fillStyle = `rgba(150,222,60,${0.5 * a})`;
    ctx.beginPath(); ctx.ellipse(px + cs * 0.5, py + cs * 0.52, cs * 0.44, cs * 0.34, ((c.x * 0.7 + c.y * 0.3) % 1) * Math.PI, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 3; k++) {
      const t = (ph3 + k / 3 + c.x * 0.37 + c.y * 0.21) % 1;
      const bx = px + cs * (0.25 + ((k * 0.31 + c.x * 0.13) % 0.5)), by = py + cs * (0.3 + ((k * 0.23 + c.y * 0.17) % 0.45));
      ctx.strokeStyle = `rgba(215,255,130,${(1 - t) * 0.85 * a})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(bx, by, cs * (0.03 + t * 0.07), 0, Math.PI * 2); ctx.stroke();
    }
  }
  // Burning cells (one each, sim/throwables.js): the cell glows, tongues of flame flicker in it.
  for (const c of OV.fires) {
    const px = ox + c.x * cs, py = oy + c.y * cs;
    ctx.fillStyle = `rgba(255,${100 + Math.round(60 * Math.sin((ph2 + c.x * 0.13 + c.y * 0.07) * Math.PI * 2))},30,0.5)`;
    ctx.fillRect(px, py, cs, cs);
    for (let i = 0; i < 4; i++) {
      const fl = (ph2 * 3 + i * 0.29 + c.x * 0.11) % 1, fx0 = px + cs * (0.2 + i * 0.2), h = cs * (0.3 + 0.25 * Math.sin(fl * Math.PI)) * (c.turns > 1 ? 1 : 0.7);
      ctx.fillStyle = i % 2 ? "rgba(255,200,70,0.9)" : "rgba(255,110,40,0.85)";
      ctx.beginPath(); ctx.moveTo(fx0 - cs * 0.09, py + cs * 0.85); ctx.quadraticCurveTo(fx0, py + cs * 0.85 - h * 1.2, fx0 + cs * 0.09, py + cs * 0.85); ctx.closePath(); ctx.fill();
    }
  }
  // Smoke: a smoke grenade's pale cloud; a fire's dark column (it blocks sight through it).
  for (const c of OV.smoke) {
    if (c.thick) { ctx.fillStyle = "rgba(30,28,30,0.38)"; ctx.beginPath(); ctx.arc(ox + (c.x + 0.6) * cs, oy + (c.y + 0.25) * cs, cs * 0.42, 0, Math.PI * 2); ctx.fill(); continue; }
    disc(c, "rgba(200,205,210,0.45)");
  }
  for (const c of OV.flares) drawThrowable("flare", ox + (c.x + 0.5) * cs, oy + (c.y + 0.5) * cs, cs);
  for (const l of OV.decoys) {
    const cx = ox + (l.x + 0.5) * cs, cy = oy + (l.y + 0.5) * cs;
    const ph = ((now || 0) % 1200) / 1200;
    const kind = l.sense.includes("heat") && !l.sense.includes("light") ? "heat" : l.sense.includes("light") ? "light" : "noise";
    const col = kind === "heat" ? [255, 122, 74] : kind === "light" ? [255, 242, 192] : [255, 209, 102];
    ctx.strokeStyle = `rgba(${col.join(",")},${0.55 * (1 - ph)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, cs * (0.4 + ph * 1.4), 0, Math.PI * 2); ctx.stroke();
    if (l.decoy) { ctx.setLineDash([3, 6]); ctx.strokeStyle = `rgba(${col.join(",")},0.3)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, cs * l.radius, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    drawThrowable(l.key, cx, cy, cs);
  }
}

// Siege objects (sim/siege.js battleOverlays): a ladder against the wall (or lying at its foot), a ram at its lead,
// a ladder on a carrier's back, a Shepherd's aura.
function drawSiegeTop(b, cs, now, vis) {
  const { ox, oy } = geo;
  const OV = battleOverlays(b);
  const ph = ((now || 0) % 1600) / 1600;
  for (const a of OV.auras) {
    if (vis && !vis[a.y * W + a.x]) continue;
    const cx = ox + (a.x + 0.5) * cs, cy = oy + (a.y + 0.5) * cs;
    ctx.fillStyle = "rgba(200,190,255,0.07)"; ctx.beginPath(); ctx.arc(cx, cy, cs * (a.r + 0.5), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(232,226,255,0.7)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -ph * 22;
    ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }
  const ladder = (x0, y0, x1, y1, w, col) => {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, px = (-dy / len) * w, py = (dx / len) * w;
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, cs * 0.07); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x0 + px, y0 + py); ctx.lineTo(x1 + px, y1 + py); ctx.moveTo(x0 - px, y0 - py); ctx.lineTo(x1 - px, y1 - py); ctx.stroke();
    ctx.lineWidth = Math.max(1.5, cs * 0.05);
    for (let k = 1; k <= 4; k++) { const t = k / 5; ctx.beginPath(); ctx.moveTo(x0 + dx * t + px, y0 + dy * t + py); ctx.lineTo(x0 + dx * t - px, y0 + dy * t - py); ctx.stroke(); }
    ctx.lineCap = "butt";
  };
  for (const l of OV.ladders) {
    const [dx, dy] = l.dir;
    if (l.up) ladder(ox + (l.fx + 0.5 - dx * 0.1) * cs, oy + (l.fy + 0.5 - dy * 0.1) * cs, ox + (l.wx + 0.5 + dx * 0.35) * cs, oy + (l.wy + 0.5 + dy * 0.35) * cs, cs * 0.17, l.side === "enemy" ? "#c08a50" : "#d4a86a");
    else ladder(ox + (l.fx + 0.5 + dy * 0.45) * cs, oy + (l.fy + 0.5 - dx * 0.45) * cs, ox + (l.fx + 0.5 - dy * 0.45) * cs, oy + (l.fy + 0.5 + dx * 0.45) * cs, cs * 0.14, "rgba(160,120,80,0.8)");
  }
  for (const m of OV.rams) {
    if (m.x < 0 || (vis && !vis[m.y * W + m.x])) continue;
    const f = m.target ? [Math.sign(m.target[0] - m.x), Math.sign(m.target[1] - m.y)] : m.face && (m.face[0] || m.face[1]) ? m.face : [1, 0];
    const x0 = ox + (m.x + 0.5 - f[0] * 0.8) * cs, y0 = oy + (m.y + 0.5 - f[1] * 0.8) * cs, x1 = ox + (m.x + 0.5 + f[0] * 0.6) * cs, y1 = oy + (m.y + 0.5 + f[1] * 0.6) * cs;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#5b3d22"; ctx.lineWidth = cs * 0.24; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = "#7d5a34"; ctx.lineWidth = cs * 0.08; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.lineCap = "butt";
    ctx.fillStyle = "#9aa0a8"; ctx.beginPath(); ctx.arc(x1, y1, cs * 0.14, 0, Math.PI * 2); ctx.fill();
  }
  for (const c of OV.carried) {
    const x = ox + c.x * cs, y = oy + c.y * cs;
    ladder(x + cs * 0.15, y + cs * 0.85, x + cs * 0.85, y + cs * 0.15, cs * 0.09, "rgba(192,138,80,0.9)");
  }
}

// A thrown item, small, at (cx, cy): a green bottle, a bell on a timer, a red string of firecrackers.
function drawThrowable(key, cx, cy, cs) {
  const s = cs * 0.22;
  if (key === "bottle") {
    ctx.fillStyle = "#3f7a4a"; roundRect(cx - s * 0.45, cy - s * 0.3, s * 0.9, s * 1.3, s * 0.25); ctx.fill();
    ctx.fillStyle = "#3f7a4a"; ctx.fillRect(cx - s * 0.18, cy - s * 0.85, s * 0.36, s * 0.6);
    ctx.fillStyle = "rgba(200,255,210,0.5)"; ctx.fillRect(cx - s * 0.3, cy - s * 0.15, s * 0.14, s * 0.8);
  } else if (key === "gamecall") {
    ctx.fillStyle = "#8a6a44"; ctx.beginPath(); ctx.moveTo(cx - s * 0.8, cy - s * 0.15); ctx.lineTo(cx + s * 0.6, cy - s * 0.45); ctx.lineTo(cx + s * 0.6, cy + s * 0.45); ctx.lineTo(cx - s * 0.8, cy + s * 0.15); ctx.closePath(); ctx.fill();
  } else if (key === "flare") {
    ctx.fillStyle = "#c8362e"; ctx.fillRect(cx - s * 0.2, cy - s * 0.8, s * 0.4, s * 1.4);
    ctx.fillStyle = "#ffe08a"; ctx.beginPath(); ctx.arc(cx, cy - s * 0.9, s * 0.35, 0, Math.PI * 2); ctx.fill();
  } else if (key === "frag") {
    ctx.fillStyle = "#4f5a3a"; ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.55, s * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8a8f96"; ctx.fillRect(cx - s * 0.2, cy - s * 0.95, s * 0.4, s * 0.3);
  } else if (key === "alarmclock") {
    ctx.fillStyle = "#c9a548"; ctx.beginPath(); ctx.arc(cx, cy, s * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f0ead8"; ctx.beginPath(); ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c9a548"; ctx.beginPath(); ctx.arc(cx - s * 0.5, cy - s * 0.6, s * 0.22, 0, Math.PI * 2); ctx.arc(cx + s * 0.5, cy - s * 0.6, s * 0.22, 0, Math.PI * 2); ctx.fill();
  } else if (key === "pocketradio") {
    ctx.fillStyle = "#3a3f48"; roundRect(cx - s * 0.7, cy - s * 0.45, s * 1.4, s * 0.9, s * 0.15); ctx.fill();
    ctx.fillStyle = "#9aa0a8"; ctx.beginPath(); ctx.arc(cx - s * 0.25, cy, s * 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#9aa0a8"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx + s * 0.5, cy - s * 0.45); ctx.lineTo(cx + s * 0.8, cy - s * 1.1); ctx.stroke();
  } else if (key === "handwarmer" || key === "heatpack") {
    ctx.fillStyle = key === "heatpack" ? "#e8e2d4" : "#d86a3a"; roundRect(cx - s * 0.6, cy - s * 0.45, s * 1.2, s * 0.9, s * 0.2); ctx.fill();
    ctx.fillStyle = "#ff7a4a"; ctx.fillRect(cx - s * 0.1, cy - s * 0.3, s * 0.2, s * 0.6); ctx.fillRect(cx - s * 0.3, cy - s * 0.1, s * 0.6, s * 0.2);
  } else if (key === "pipebomb") {
    ctx.fillStyle = "#6a6a68"; ctx.fillRect(cx - s * 0.8, cy - s * 0.3, s * 1.6, s * 0.6);
    ctx.fillStyle = "#3a3a38"; ctx.fillRect(cx - s * 0.9, cy - s * 0.4, s * 0.2, s * 0.8); ctx.fillRect(cx + s * 0.7, cy - s * 0.4, s * 0.2, s * 0.8);
  } else if (key === "molotov") {
    ctx.fillStyle = "#7a5a2a"; roundRect(cx - s * 0.45, cy - s * 0.3, s * 0.9, s * 1.3, s * 0.25); ctx.fill();
    ctx.fillStyle = "#ff9a3a"; ctx.beginPath(); ctx.arc(cx, cy - s * 0.85, s * 0.3, 0, Math.PI * 2); ctx.fill();
  } else if (key === "smokegren") {
    ctx.fillStyle = "#5a6a54"; roundRect(cx - s * 0.45, cy - s * 0.7, s * 0.9, s * 1.4, s * 0.3); ctx.fill();
    ctx.fillStyle = "#c9c9c0"; ctx.fillRect(cx - s * 0.15, cy - s * 0.95, s * 0.3, s * 0.3);
  } else if (key === "noisemaker") {
    ctx.fillStyle = "#c9b048"; ctx.beginPath(); ctx.arc(cx, cy, s * 0.7, Math.PI, 0); ctx.lineTo(cx + s * 0.8, cy + s * 0.3); ctx.lineTo(cx - s * 0.8, cy + s * 0.3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#e6e2d8"; ctx.fillRect(cx - s * 0.5, cy + s * 0.3, s, s * 0.45);
    ctx.fillStyle = "#1a1a1a"; ctx.fillRect(cx - s * 0.05, cy + s * 0.38, s * 0.1, s * 0.3);
  } else {
    ctx.fillStyle = "#c8362e";
    for (let i = 0; i < 4; i++) ctx.fillRect(cx - s * 0.9 + i * s * 0.48, cy - s * 0.25 + (i % 2) * s * 0.2, s * 0.32, s * 0.5);
    ctx.strokeStyle = "#e0a84f"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy - s * 0.2); ctx.stroke();
  }
}

function outline(bands, test, color) {
  const { cs, ox, oy } = geo;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < W * H; i++) {
    if (!test(bands[i])) continue;
    const x = i % W, y = (i / W) | 0, px = ox + x * cs, py = oy + y * cs;
    const out = (nx, ny) => nx < 0 || ny < 0 || nx >= W || ny >= H || !test(bands[ny * W + nx]);
    if (out(x, y - 1)) { ctx.moveTo(px, py); ctx.lineTo(px + cs, py); }
    if (out(x, y + 1)) { ctx.moveTo(px, py + cs); ctx.lineTo(px + cs, py + cs); }
    if (out(x - 1, y)) { ctx.moveTo(px, py); ctx.lineTo(px, py + cs); }
    if (out(x + 1, y)) { ctx.moveTo(px + cs, py); ctx.lineTo(px + cs, py + cs); }
  }
  ctx.stroke();
}

// Shield icons on the sides of a tile that have cover. Solid = full, half-filled = half.
function shields(b, x, y, alpha) {
  const { cs, ox, oy } = geo;
  const sides = coverSides(b, x, y);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const s = cs * (alpha < 1 ? 0.22 : 0.3);
  ctx.globalAlpha = alpha;
  sides.forEach((c, i) => {
    if (!c) return;
    const [dx, dy] = dirs[i];
    const cx = ox + (x + 0.5 + dx * 0.32) * cs, cy = oy + (y + 0.5 + dy * 0.32) * cs;
    shieldPath(cx, cy, s);
    ctx.fillStyle = "rgba(15,20,30,0.85)";
    ctx.fill();
    ctx.save();
    shieldPath(cx, cy, s);
    ctx.clip();
    ctx.fillStyle = "#4aa3ff";
    if (c === 2) ctx.fillRect(cx - s, cy - s, s * 2, s * 2);
    else ctx.fillRect(cx - s, cy, s * 2, s);
    ctx.restore();
    shieldPath(cx, cy, s);
    ctx.strokeStyle = "#cfe6ff";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function shieldPath(cx, cy, s) {
  ctx.beginPath();
  ctx.moveTo(cx - s / 2, cy - s / 2);
  ctx.lineTo(cx + s / 2, cy - s / 2);
  ctx.lineTo(cx + s / 2, cy);
  ctx.quadraticCurveTo(cx + s / 2, cy + s * 0.4, cx, cy + s / 2);
  ctx.quadraticCurveTo(cx - s / 2, cy + s * 0.4, cx - s / 2, cy);
  ctx.closePath();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function bubble(x, y, lines, color, cw) {
  lines = lines.filter(Boolean);
  ctx.font = "600 13px Segoe UI, sans-serif";
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16, hgt = lines.length * 17 + 8;
  if (x + w > cw - 4) x = x - w - 28;
  ctx.fillStyle = "rgba(15,17,20,0.95)";
  roundRect(x, y - hgt, w, hgt, 6);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = "left";
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? color : l === "FLANKED" ? "#ffd166" : "#e6e2d8";
    ctx.fillText(l, x + 8, y - hgt + 18 + i * 17);
  });
}

function drawObject(k, px, py, cs, n, cell = null) {
  if (k === "open") return;
  const cx = px + cs / 2, cy = py + cs / 2;
  ctx.lineWidth = 1;
  switch (k) {
    case "wall":
      ctx.fillStyle = "#24211e"; ctx.fillRect(px, py, cs, cs);
      ctx.fillStyle = cell && cell.t === 2 ? "#8c8070" : "#a39787"; ctx.fillRect(px + 1, py + 1, cs - 2, cs - 4);
      ctx.fillStyle = "#c2b6a4"; ctx.fillRect(px + 1, py + 1, cs - 2, cs * 0.18);
      break;
    case "window":
      ctx.fillStyle = "#24211e"; ctx.fillRect(px, py, cs, cs);
      ctx.fillStyle = "#a39787"; ctx.fillRect(px + 1, py + 1, cs - 2, cs - 4);
      ctx.fillStyle = "#8fc1e0"; ctx.fillRect(px + cs * 0.2, py + cs * 0.2, cs * 0.6, cs * 0.6);
      ctx.strokeStyle = "#3d3832"; ctx.strokeRect(px + cs * 0.2, py + cs * 0.2, cs * 0.6, cs * 0.6);
      break;
    case "tree":
      ctx.fillStyle = "#24361f"; ctx.beginPath(); ctx.arc(cx + 2, cy + 2, cs * 0.44, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = n > 0.5 ? "#3c5e30" : "#365a2c"; ctx.beginPath(); ctx.arc(cx, cy, cs * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.beginPath(); ctx.arc(cx - cs * 0.12, cy - cs * 0.12, cs * 0.18, 0, Math.PI * 2); ctx.fill();
      break;
    case "boulder": case "rock": {
      const r = k === "boulder" ? 0.42 : 0.3;
      ctx.fillStyle = k === "boulder" ? "#77736d" : "#85817a";
      ctx.beginPath(); ctx.ellipse(cx, cy + cs * 0.05, cs * r, cs * r * 0.8, n * 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#45423e"; ctx.stroke();
      break;
    }
    case "car": case "truck": case "vehicle": {
      const colors = ["#7a3b34", "#3b5a7a", "#6b6b6b", "#7a6a34", "#3f6b4a"];
      if (cell && cell.car) {
        // One cell's share of a 2 × 3–4 cell car (sim/combat.js placeCar): the body in car-local units (a along, c across),
        // clipped to this cell, so the cells meet into one car; glass over the cabin, wheels at the corners. The team's
        // own vehicle ("vehicle", combat.js placeVehicle) is the blue one.
        const { i, j, L, ax, kind, v, body: bodyKind } = cell.car, big = kind === "truck" || bodyKind === "truck";
        const body = kind === "vehicle" ? "#2f5d8a" : big ? "#5a4030" : colors[v % colors.length];
        const parts = big ? [[0.1, 1.35, 0.15, 1.85, body], [0.25, 1.3, 0.3, 1.7, "#2a221c"], [1.5, L - 0.1, 0.1, 1.9, "#3a3a3c"]]
          : [[0.1, L - 0.1, 0.15, 1.85, body], ...(L === 3 ? [[0.9, 2.1, 0.3, 1.7, "#9fc0d8"]] : v % 2 ? [[0.8, 3.7, 0.3, 1.7, "#9fc0d8"]] : [[0.8, 2.0, 0.3, 1.7, "#9fc0d8"], [2.2, 3.8, 0.3, 1.7, "#3a3a3c"]])];
        for (const a of big ? [0.7, L - 1.4, L - 0.6] : [0.6, L - 0.6]) for (const c of [0.2, 1.8]) parts.unshift([a - 0.3, a + 0.3, c - 0.22, c + 0.22, "#1e1e20"]);
        for (const [a0, a1, c0, c1, col] of parts) {
          const A0 = Math.max(a0, i) - i, A1 = Math.min(a1, i + 1) - i, C0 = Math.max(c0, j) - j, C1 = Math.min(c1, j + 1) - j;
          if (A1 - A0 <= 0.02 || C1 - C0 <= 0.02) continue;
          const [fx0, fx1, fy0, fy1] = ax === "x" ? [A0, A1, C0, C1] : [C0, C1, A0, A1];
          ctx.fillStyle = col;
          ctx.fillRect(px + fx0 * cs, py + fy0 * cs, (fx1 - fx0) * cs, (fy1 - fy0) * cs);
        }
        break;
      }
      if (k === "vehicle") { // a one-cell vehicle (bikes, or no room for the car in the zone)
        ctx.fillStyle = "#2f5d8a";
        roundRect(px + cs * 0.05, py + cs * 0.15, cs * 0.9, cs * 0.7, cs * 0.14); ctx.fill();
        ctx.strokeStyle = "#a9cbff"; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = "#cfe3f7"; ctx.fillRect(px + cs * 0.6, py + cs * 0.25, cs * 0.2, cs * 0.5);
        break;
      }
      ctx.fillStyle = k === "truck" ? "#4a3a2e" : colors[Math.floor(n * colors.length)];
      roundRect(px + cs * 0.08, py + cs * 0.18, cs * 0.84, cs * 0.64, cs * 0.12); ctx.fill();
      ctx.strokeStyle = "#1f1f1f"; ctx.stroke();
      ctx.fillStyle = k === "truck" ? "#2a221c" : "#9fc0d8";
      ctx.fillRect(px + cs * 0.55, py + cs * 0.26, cs * 0.18, cs * 0.48);
      if (k === "truck") { ctx.fillStyle = "rgba(255,120,40,0.25)"; ctx.fillRect(px + cs * 0.15, py + cs * 0.3, cs * 0.3, cs * 0.4); }
      break;
    }
    case "tanktrap": { // a bridge barricade's tank trap (sim/deploy.js): a steel hedgehog
      ctx.strokeStyle = "#5e626a"; ctx.lineWidth = Math.max(2, cs * 0.12); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(px + cs * 0.2, py + cs * 0.2); ctx.lineTo(px + cs * 0.8, py + cs * 0.8); ctx.moveTo(px + cs * 0.8, py + cs * 0.2); ctx.lineTo(px + cs * 0.2, py + cs * 0.8); ctx.moveTo(cx, py + cs * 0.15); ctx.lineTo(cx, py + cs * 0.85); ctx.stroke();
      ctx.lineCap = "butt";
      if (cell && cell.hp > 0 && cell.mhp && cell.hp < cell.mhp) { ctx.fillStyle = "#ffd166"; ctx.fillRect(px + cs * 0.1, py + cs - 3, cs * 0.8 * (cell.hp / cell.mhp), 2); }
      break;
    }
    case "rail": // a bridge's railing (sim/combat.js layRoad): steel rails on a kerb
      ctx.fillStyle = "#6c6b66"; ctx.fillRect(px, cy - cs * 0.1, cs, cs * 0.2);
      ctx.strokeStyle = "#9aa0a6"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, cy - cs * 0.3); ctx.lineTo(px + cs, cy - cs * 0.3); ctx.moveTo(px, cy - cs * 0.18); ctx.lineTo(px + cs, cy - cs * 0.18);
      ctx.moveTo(px + cs * 0.15, cy - cs * 0.34); ctx.lineTo(px + cs * 0.15, cy); ctx.moveTo(px + cs * 0.5, cy - cs * 0.34); ctx.lineTo(px + cs * 0.5, cy); ctx.moveTo(px + cs * 0.85, cy - cs * 0.34); ctx.lineTo(px + cs * 0.85, cy); ctx.stroke();
      break;
    case "fence":
      ctx.strokeStyle = "#8a6a44"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, cy - cs * 0.12); ctx.lineTo(px + cs, cy - cs * 0.12); ctx.moveTo(px, cy + cs * 0.12); ctx.lineTo(px + cs, cy + cs * 0.12);
      ctx.moveTo(px + cs * 0.2, cy - cs * 0.25); ctx.lineTo(px + cs * 0.2, cy + cs * 0.25); ctx.moveTo(px + cs * 0.8, cy - cs * 0.25); ctx.lineTo(px + cs * 0.8, cy + cs * 0.25); ctx.stroke();
      break;
    case "sandbag":
      ctx.fillStyle = "#a08a5c";
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(px + cs * (0.2 + i * 0.3), cy, cs * 0.17, cs * 0.14, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = "#5a4c30"; ctx.stroke();
      break;
    case "hay":
      ctx.fillStyle = "#c9a74a"; ctx.beginPath(); ctx.arc(cx, cy, cs * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#8a7030"; ctx.beginPath(); ctx.arc(cx, cy, cs * 0.2, 0, Math.PI * 2); ctx.stroke();
      break;
    case "crate":
      ctx.fillStyle = "#7a5a34"; ctx.fillRect(px + cs * 0.18, py + cs * 0.18, cs * 0.64, cs * 0.64);
      ctx.strokeStyle = "#3e2c18"; ctx.strokeRect(px + cs * 0.18, py + cs * 0.18, cs * 0.64, cs * 0.64);
      ctx.beginPath(); ctx.moveTo(px + cs * 0.18, py + cs * 0.18); ctx.lineTo(px + cs * 0.82, py + cs * 0.82); ctx.moveTo(px + cs * 0.82, py + cs * 0.18); ctx.lineTo(px + cs * 0.18, py + cs * 0.82); ctx.stroke();
      break;
    case "pump":
      ctx.fillStyle = "#a33a2e"; ctx.fillRect(px + cs * 0.3, py + cs * 0.15, cs * 0.4, cs * 0.7);
      ctx.fillStyle = "#e6e2d8"; ctx.fillRect(px + cs * 0.36, py + cs * 0.24, cs * 0.28, cs * 0.16);
      break;
    case "shelf":
      ctx.fillStyle = "#5a4630"; ctx.fillRect(px + cs * 0.1, py + cs * 0.2, cs * 0.8, cs * 0.6);
      ctx.fillStyle = "#8a6c48"; for (let i = 0; i < 3; i++) ctx.fillRect(px + cs * 0.14, py + cs * (0.26 + i * 0.18), cs * 0.72, cs * 0.06);
      break;
    case "locker":
      ctx.fillStyle = "#56626e"; ctx.fillRect(px + cs * 0.15, py + cs * 0.1, cs * 0.7, cs * 0.8);
      ctx.strokeStyle = "#2a3038"; ctx.strokeRect(px + cs * 0.15, py + cs * 0.1, cs * 0.7, cs * 0.8);
      ctx.beginPath(); ctx.moveTo(cx, py + cs * 0.1); ctx.lineTo(cx, py + cs * 0.9); ctx.stroke();
      break;
    case "cabinet": case "counter":
      ctx.fillStyle = k === "counter" ? "#7a6a58" : "#6a5440"; ctx.fillRect(px + cs * 0.1, py + cs * 0.25, cs * 0.8, cs * 0.5);
      ctx.strokeStyle = "#3a2c20"; ctx.strokeRect(px + cs * 0.1, py + cs * 0.25, cs * 0.8, cs * 0.5);
      break;
    // Base defences and the inside of a hive (sim/defences.js, sim/hives.js).
    case "barricade":
      ctx.fillStyle = "#5a4a36"; ctx.fillRect(px + cs * 0.06, py + cs * 0.22, cs * 0.88, cs * 0.56);
      ctx.fillStyle = "#8a6a44"; for (let i = 0; i < 3; i++) ctx.fillRect(px + cs * 0.08, py + cs * (0.26 + i * 0.17), cs * 0.84, cs * 0.09);
      ctx.strokeStyle = "#2a2018"; ctx.strokeRect(px + cs * 0.06, py + cs * 0.22, cs * 0.88, cs * 0.56);
      ctx.fillStyle = "#9a9a92"; ctx.fillRect(px + cs * 0.6, py + cs * 0.12, cs * 0.3, cs * 0.16); // a slab of sheet metal on top
      break;
    case "spikes":
      ctx.fillStyle = "#2a2018"; ctx.fillRect(px + cs * 0.1, py + cs * 0.1, cs * 0.8, cs * 0.8);
      ctx.fillStyle = "#c9b48a";
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const sx = px + cs * (0.22 + i * 0.28), sy = py + cs * (0.24 + j * 0.27); ctx.beginPath(); ctx.moveTo(sx, sy - cs * 0.1); ctx.lineTo(sx + cs * 0.06, sy + cs * 0.06); ctx.lineTo(sx - cs * 0.06, sy + cs * 0.06); ctx.closePath(); ctx.fill(); }
      break;
    case "wire": // barbed wire from the armory (sim/defences.js armoryDefence)
      ctx.strokeStyle = "#9a9a92"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) { const x0 = px + cs * (i / 4); ctx.moveTo(x0, py + cs * 0.3); ctx.lineTo(x0 + cs * 0.12, py + cs * 0.7); }
      ctx.moveTo(px, cy - cs * 0.1); ctx.lineTo(px + cs, cy - cs * 0.1); ctx.moveTo(px, cy + cs * 0.12); ctx.lineTo(px + cs, cy + cs * 0.12);
      ctx.stroke();
      break;
    case "beartrap":
      ctx.strokeStyle = "#6a6a64"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, cs * 0.26, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.moveTo(cx + Math.cos(a) * cs * 0.26, cy + Math.sin(a) * cs * 0.26); ctx.lineTo(cx + Math.cos(a) * cs * 0.16, cy + Math.sin(a) * cs * 0.16); } ctx.stroke();
      break;
    case "trench":
      ctx.fillStyle = "#241c14"; ctx.fillRect(px, py + cs * 0.2, cs, cs * 0.6);
      ctx.fillStyle = "#4a3a28"; ctx.fillRect(px, py + cs * 0.2, cs, cs * 0.08); ctx.fillRect(px, py + cs * 0.72, cs, cs * 0.08);
      ctx.fillStyle = "#8a6a44"; ctx.fillRect(px + cs * 0.3, py + cs * 0.1, cs * 0.06, cs * 0.25); ctx.fillRect(px + cs * 0.66, py + cs * 0.1, cs * 0.06, cs * 0.25); // stakes
      break;
    // A base's wall line on a break-in map (sim/deploy.js).
    case "palisade":
      ctx.fillStyle = "#3a2e22"; ctx.fillRect(px, py, cs, cs);
      ctx.fillStyle = "#7a5f40"; for (let i = 0; i < 4; i++) ctx.fillRect(px + cs * (0.05 + i * 0.24), py + cs * 0.06, cs * 0.18, cs * 0.88);
      ctx.fillStyle = "#9a7a52"; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(px + cs * (0.05 + i * 0.24), py + cs * 0.1); ctx.lineTo(px + cs * (0.14 + i * 0.24), py); ctx.lineTo(px + cs * (0.23 + i * 0.24), py + cs * 0.1); ctx.fill(); }
      ctx.fillStyle = "#5a5a58"; ctx.fillRect(px, py + cs * 0.42, cs, cs * 0.1); // a sheet-metal brace
      break;
    case "gate":
      ctx.fillStyle = "#5a4630"; ctx.fillRect(px + cs * 0.02, py, cs * 0.16, cs); ctx.fillRect(px + cs * 0.82, py, cs * 0.16, cs);
      if (cell && barredCell(cell)) {
        // Shut and barred (sim/deploy.js): planks across, a steel bar.
        ctx.fillStyle = "#7a5f40"; ctx.fillRect(px + cs * 0.18, py + cs * 0.04, cs * 0.64, cs * 0.92);
        ctx.fillStyle = "#5a4630"; for (let i = 0; i < 3; i++) ctx.fillRect(px + cs * (0.24 + i * 0.2), py + cs * 0.04, cs * 0.04, cs * 0.92);
        ctx.fillStyle = "#8a8a86"; ctx.fillRect(px + cs * 0.1, py + cs * 0.45, cs * 0.8, cs * 0.1);
      } else {
        ctx.save(); ctx.translate(px + cs * 0.2, py + cs * 0.1); ctx.rotate(0.5);
        ctx.fillStyle = "#7a5f40"; ctx.fillRect(0, 0, cs * 0.5, cs * 0.14); ctx.restore(); // a gate leaf hanging off its hinge
      }
      break;
    // Verticality and the base's buildings (sim/deploy.js, sim/interior.js).
    case "walkway": case "loft":
      ctx.fillStyle = k === "walkway" ? "#6a5238" : "#5e4a36"; ctx.fillRect(px, py, cs, cs);
      ctx.strokeStyle = "rgba(20,14,8,0.6)"; ctx.lineWidth = 1;
      ctx.beginPath(); for (let i = 1; i < 4; i++) { ctx.moveTo(px + (cs * i) / 4, py); ctx.lineTo(px + (cs * i) / 4, py + cs); } ctx.stroke();
      break;
    case "roof":
      ctx.fillStyle = "#4b4c50"; ctx.fillRect(px, py, cs, cs);
      ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(px + n * cs * 0.6, py + ((n * 3) % 1) * cs * 0.6, cs * 0.3, cs * 0.3);
      break;
    case "ladder":
      ctx.strokeStyle = "#a4875c"; ctx.lineWidth = Math.max(2, cs * 0.07);
      ctx.beginPath(); ctx.moveTo(px + cs * 0.3, py + cs * 0.05); ctx.lineTo(px + cs * 0.3, py + cs * 0.95); ctx.moveTo(px + cs * 0.7, py + cs * 0.05); ctx.lineTo(px + cs * 0.7, py + cs * 0.95);
      for (let i = 0; i < 4; i++) { ctx.moveTo(px + cs * 0.3, py + cs * (0.18 + i * 0.22)); ctx.lineTo(px + cs * 0.7, py + cs * (0.18 + i * 0.22)); }
      ctx.stroke();
      break;
    case "stairs":
      ctx.fillStyle = "#5e4a36"; for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? "#6e573f" : "#56432f"; ctx.fillRect(px + cs * 0.08, py + cs * (0.08 + i * 0.21), cs * 0.84, cs * 0.21); }
      break;
    // A building's map (sim/buildingmaps.js): doors closed and open (a roller door's slats), tall shelving, tables,
    // beds, cell bars.
    case "idoor":
      ctx.fillStyle = "#24211e"; ctx.fillRect(px, py, cs, cs);
      if (cell && cell.roll) { ctx.fillStyle = "#6c737a"; ctx.fillRect(px + 1, py + cs * 0.1, cs - 2, cs * 0.8); ctx.fillStyle = "#454b51"; for (let i = 1; i < 4; i++) ctx.fillRect(px + 1, py + cs * (0.1 + i * 0.2), cs - 2, 1.5); }
      else { ctx.fillStyle = "#8a6a44"; ctx.fillRect(px + cs * 0.12, py + cs * 0.12, cs * 0.76, cs * 0.76); ctx.fillStyle = "#c9c0a8"; ctx.fillRect(px + cs * 0.66, py + cs * 0.46, cs * 0.08, cs * 0.08); }
      break;
    case "odoor":
      ctx.fillStyle = "#24211e"; ctx.fillRect(px, py, cs * 0.12, cs); ctx.fillRect(px + cs * 0.88, py, cs * 0.12, cs);
      if (!(cell && cell.roll)) { ctx.save(); ctx.translate(px + cs * 0.15, py + cs * 0.15); ctx.rotate(0.75); ctx.fillStyle = "#8a6a44"; ctx.fillRect(0, 0, cs * 0.6, cs * 0.1); ctx.restore(); }
      break;
    case "rack":
      ctx.fillStyle = "#3a3f44"; ctx.fillRect(px + cs * 0.06, py + cs * 0.16, cs * 0.88, cs * 0.68);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = ["#7a3b34", "#3b5a7a", "#7a6a34", "#3f6b4a"][(i + Math.floor(n * 4)) % 4]; ctx.fillRect(px + cs * (0.1 + i * 0.21), py + cs * 0.24, cs * 0.16, cs * 0.52); }
      break;
    case "table":
      ctx.fillStyle = "#8a6a44"; ctx.fillRect(px + cs * 0.16, py + cs * 0.16, cs * 0.68, cs * 0.68);
      ctx.strokeStyle = "#4e3a26"; ctx.strokeRect(px + cs * 0.16, py + cs * 0.16, cs * 0.68, cs * 0.68);
      break;
    case "bed":
      ctx.fillStyle = "#4e3a26"; ctx.fillRect(px + cs * 0.12, py + cs * 0.06, cs * 0.76, cs * 0.88);
      ctx.fillStyle = "#8a8678"; ctx.fillRect(px + cs * 0.16, py + cs * 0.1, cs * 0.68, cs * 0.8);
      ctx.fillStyle = "#c9c4b4"; ctx.fillRect(px + cs * 0.2, py + cs * 0.12, cs * 0.6, cs * 0.18);
      break;
    case "bars":
      ctx.strokeStyle = "#8a939c"; ctx.lineWidth = Math.max(1.5, cs * 0.06);
      ctx.beginPath(); for (let i = 0; i < 4; i++) { ctx.moveTo(px + cs * (0.15 + i * 0.23), py); ctx.lineTo(px + cs * (0.15 + i * 0.23), py + cs); } ctx.moveTo(px, cy); ctx.lineTo(px + cs, cy); ctx.stroke();
      break;
    case "bdoor": case "doorway":
      ctx.fillStyle = "#24211e"; ctx.fillRect(px, py, cs, cs);
      if (k === "bdoor") {
        ctx.fillStyle = "#7a5432"; ctx.fillRect(px + cs * 0.12, py + cs * 0.12, cs * 0.76, cs * 0.76);
        ctx.fillStyle = "#8a8a86"; ctx.fillRect(px + cs * 0.08, py + cs * 0.44, cs * 0.84, cs * 0.12); // the bar
      } else {
        ctx.fillStyle = "#3b3129"; ctx.fillRect(px + cs * 0.12, py + cs * 0.12, cs * 0.76, cs * 0.76);
        ctx.save(); ctx.translate(px + cs * 0.15, py + cs * 0.2); ctx.rotate(0.6); ctx.fillStyle = "#6a4a2c"; ctx.fillRect(0, 0, cs * 0.55, cs * 0.12); ctx.restore();
      }
      break;
    case "smashed":
      ctx.fillStyle = "#24211e"; ctx.fillRect(px, py, cs, cs);
      ctx.fillStyle = "#a39787"; ctx.fillRect(px + 1, py + 1, cs - 2, cs * 0.16); ctx.fillRect(px + 1, py + cs * 0.82, cs - 2, cs * 0.16);
      ctx.fillStyle = "rgba(143,193,224,0.55)"; for (let i = 0; i < 4; i++) ctx.fillRect(px + cs * (0.15 + ((n * 7 + i * 0.31) % 0.7)), py + cs * (0.25 + i * 0.12), cs * 0.07, cs * 0.05);
      break;
    case "rubble":
      ctx.fillStyle = "#5a4c3a";
      for (let i = 0; i < 6; i++) { const n2 = (n * 5 + i * 0.29) % 1; ctx.fillRect(px + cs * (0.08 + n2 * 0.7), py + cs * (0.1 + ((n2 * 7) % 1) * 0.75), cs * 0.18, cs * 0.12); }
      break;
    case "well":
      ctx.fillStyle = "#6e6a64"; ctx.beginPath(); ctx.arc(px + cs / 2, py + cs / 2, cs * 0.36, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1f2a33"; ctx.beginPath(); ctx.arc(px + cs / 2, py + cs / 2, cs * 0.22, 0, Math.PI * 2); ctx.fill();
      break;
    case "barrel":
      for (const [dx, dy] of [[0.3, 0.35], [0.68, 0.4], [0.48, 0.7]]) { ctx.fillStyle = "#3f6e8a"; ctx.beginPath(); ctx.arc(px + cs * dx, py + cs * dy, cs * 0.17, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#1f3644"; ctx.stroke(); }
      break;
    case "breach":
      ctx.fillStyle = "#6b5a44";
      for (let i = 0; i < 5; i++) { const n2 = (n * 7 + i * 0.37) % 1; ctx.fillRect(px + cs * (0.1 + n2 * 0.7), py + cs * (0.1 + ((n2 * 5) % 1) * 0.75), cs * 0.16, cs * 0.12); }
      ctx.strokeStyle = "#3a2e22"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px + cs * 0.15, py); ctx.lineTo(px + cs * 0.3, py + cs * 0.25); ctx.moveTo(px + cs * 0.85, py + cs); ctx.lineTo(px + cs * 0.7, py + cs * 0.75); ctx.stroke();
      break;
    case "tower":
      ctx.fillStyle = "#4a3a28"; ctx.fillRect(px + cs * 0.08, py + cs * 0.08, cs * 0.84, cs * 0.84);
      ctx.strokeStyle = "#8a6a44"; ctx.lineWidth = 2; ctx.strokeRect(px + cs * 0.08, py + cs * 0.08, cs * 0.84, cs * 0.84);
      ctx.beginPath(); ctx.moveTo(px + cs * 0.08, py + cs * 0.08); ctx.lineTo(px + cs * 0.92, py + cs * 0.92); ctx.moveTo(px + cs * 0.92, py + cs * 0.08); ctx.lineTo(px + cs * 0.08, py + cs * 0.92); ctx.stroke();
      break;
    case "hivewall":
      ctx.fillStyle = "#3a161c"; ctx.fillRect(px, py, cs, cs);
      ctx.fillStyle = n > 0.5 ? "#6a2a30" : "#5a2a2e"; ctx.beginPath(); ctx.ellipse(cx, cy, cs * 0.46, cs * 0.42, n * 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ff5a3a"; ctx.beginPath(); ctx.arc(cx + cs * (n - 0.5) * 0.4, cy - cs * 0.08, cs * 0.08, 0, Math.PI * 2); ctx.fill(); // a glowing pod
      ctx.strokeStyle = "#8a1c22"; ctx.beginPath(); ctx.moveTo(px + cs * 0.1, cy + cs * 0.2); ctx.lineTo(px + cs * 0.9, cy + cs * 0.1); ctx.stroke();
      break;
    case "water":
      ctx.fillStyle = "#2c4f6b"; ctx.fillRect(px, py, cs, cs);
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.beginPath(); ctx.moveTo(px + cs * 0.15, py + cs * (0.3 + n * 0.4)); ctx.lineTo(px + cs * 0.55, py + cs * (0.3 + n * 0.4)); ctx.stroke();
      break;
  }
}

// A small word over a unit (a Flinger winding up, someone panicking, a Sleeper's letter).
function tag(x, y, text, col, cs) {
  ctx.font = `800 ${Math.max(9, Math.round(cs * 0.2))}px Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = col;
  ctx.fillText(text, x, y);
}
// Units are procedural sprites (ui/sprites.js) standing on a ring in their side's color.
function drawUnit(state, b, t, cx, cy, cs, selected) {
  const r = cs * 0.34;
  const zombie = t.kind === "zombie";
  let ring = t.side === "player" ? "#8fc1ff" : t.side === "third" ? thirdRing(t) : zombie ? (t.ztype ? ZRING[t.ztype] || "#b5d36a" : "#b5d36a") : "#ff8f85";
  const facing = unitFacing(b, t);
  if (t.ztype === "sleeper") {
    // A spotted Sleeper (sim/sleepers.js): its body is drawn with the others; a dashed ring and its letter mark it.
    if (t.dead) return;
    ctx.strokeStyle = selected ? "#e0a84f" : ring;
    ctx.lineWidth = selected ? 3 : 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.ellipse(cx, cy + cs * 0.08, cs * 0.46, cs * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    tag(cx - cs * 0.3, cy - cs * 0.22, t.short, ring, cs);
    return;
  }
  if (t.dead) {
    // The body lying where it fell (ui/downsprites.js: its own picture per kind; pockets out once searched).
    drawDowned(ctx, unitDownCanvas(state, b, t, cui.salt), cx, cy + cs * 0.06, [cs, 0], [0, cs], { facing, scale: downScale(t), alpha: 0.92 });
    if (endangered(b, t)) {
      // A body in danger (sim/carriers.js): a pale "!" while a Carrier is near or the worm is in it (red: it gets up
      // at the end of this turn), until it gets up, burns or its skull is crushed.
      ctx.font = `800 ${Math.round(cs * 0.3)}px Segoe UI, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText("!", cx, cy - cs * 0.12);
      ctx.fillStyle = imminent(b, t) ? "#ff8f85" : ZRING.carrier;
      ctx.fillText("!", cx, cy - cs * 0.12);
    }
    if (t.side === "player") {
      ctx.strokeStyle = "#8fc1ff";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - r * 0.4, cy - r * 0.4); ctx.lineTo(cx + r * 0.4, cy + r * 0.4); ctx.moveTo(cx + r * 0.4, cy - r * 0.4); ctx.lineTo(cx - r * 0.4, cy + r * 0.4); ctx.stroke();
    }
    return;
  }
  if (t.down) ring = t.ko ? (t.tied ? "#c9a74a" : "#9aa0a8") : t.stab ? "#6cc48a" : "#e2685f"; // ko: knocked out (sim/stealth.js)
  const spent = t.side === "player" && t.ap === 0 && b.phase === "player" && !t.down;
  // Ground ring (side color) and shadow.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.ellipse(cx + 1, cy + cs * 0.33, cs * 0.34, cs * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = selected ? "#e0a84f" : ring;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.globalAlpha = spent ? 0.5 : 1;
  ctx.beginPath(); ctx.ellipse(cx, cy + cs * 0.31, cs * 0.38, cs * 0.14, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  if (selected) {
    ctx.strokeStyle = "rgba(224,168,79,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2); ctx.stroke();
  }
  const big = t.boss ? 1.3 : t.ztype === "brute" || t.ztype === "boneback" ? 1.15 : 1; // bosses, brutes and Bonebacks stand taller
  if (t.down) drawDowned(ctx, unitDownCanvas(state, b, t, cui.salt), cx, cy + cs * 0.08, [cs, 0], [0, cs], { facing, scale: downScale(t) }); // curled up, wounded or out cold
  else drawSprite(ctx, unitCanvas(state, b, t, cui.salt), cx, cy - (big - 1) * cs * 0.4, cs * big, { facing, lying: false, alpha: spent ? 0.6 : 1 });
  if (t.ztype && !t.down) {
    // The kind's letter in its ring color (an elite one gets a star).
    ctx.font = `800 ${Math.round(cs * 0.2)}px Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    const label = `${t.short}${t.elite ? "★" : ""}`;
    ctx.strokeText(label, cx - cs * 0.3, cy - cs * 0.3);
    ctx.fillStyle = ring;
    ctx.fillText(label, cx - cs * 0.3, cy - cs * 0.3);
  }
  // A Flinger winding up (sim/middead.js): a dashed arc to whoever it is about to throw at; someone a Nightmare's
  // scream panicked: PANIC over their head (they run next turn).
  if (t.windup != null) {
    const m = b.units.find((o) => o.id === t.windup);
    if (m) {
      const mx = cx + (m.x - t.x) * cs, my = cy + (m.y - t.y) * cs;
      ctx.strokeStyle = ZRING.flinger; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(cx, cy - cs * 0.3); ctx.quadraticCurveTo((cx + mx) / 2, Math.min(cy, my) - cs * 1.2, mx, my); ctx.stroke();
      ctx.setLineDash([]);
    }
    tag(cx, cy - cs * 0.62, "WINDS UP", ZRING.flinger, cs);
  }
  if (t.terror && !t.down) tag(cx, cy - cs * 0.62, "PANIC", ZRING.nightmare, cs);
  if (t.down && t.tied) {
    // Tied up: rope around the wrists and ankles of the lying prisoner.
    ctx.strokeStyle = "#c9a74a";
    ctx.lineWidth = Math.max(2, cs * 0.06);
    for (const dx of [-0.24, 0.2]) { ctx.beginPath(); ctx.ellipse(cx + cs * dx, cy + cs * 0.12, cs * 0.07, cs * 0.16, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - cs * 0.24, cy + cs * 0.12); ctx.quadraticCurveTo(cx, cy + cs * 0.3, cx + cs * 0.2, cy + cs * 0.12); ctx.stroke();
  }
  if (t.down) {
    ctx.fillStyle = ring;
    ctx.font = `800 ${Math.round(cs * (t.ko ? 0.24 : 0.3))}px Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(t.ko ? (t.tied ? "TIED" : "ZZ") : t.stab ? "+" : "!", cx, cy - cs * 0.12);
  }
  // On raised ground (verticality): ▲ by the ring.
  const hh = heightAt(b, t.x, t.y);
  if (hh && !t.down) {
    ctx.font = `800 ${Math.max(9, Math.round(cs * 0.24))}px Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffe296";
    ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.lineWidth = 3;
    ctx.strokeText("▲".repeat(hh), cx + r + 2, cy + cs * 0.32);
    ctx.fillText("▲".repeat(hh), cx + r + 2, cy + cs * 0.32);
  }
  // Health bar.
  const bw = cs * 0.72, bx = cx - bw / 2, by = cy + cs * 0.42;
  ctx.fillStyle = "#1a1d22"; ctx.fillRect(bx, by, bw, 4);
  ctx.fillStyle = hpColor(pct(t)); ctx.fillRect(bx, by, bw * pct(t), 4);
  // Action pips.
  if (t.side === "player" && active(t) && b.phase === "player") {
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = i < t.ap ? "#8fc1ff" : "#2c3139";
      ctx.beginPath(); ctx.arc(cx + r * 0.75 + i * 7 - 3, cy - r - 2, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Status tags.
  const tags = [];
  if (t.ow) tags.push(["OW", "#e0a84f"]);
  if (t.hunker) tags.push(["HD", "#4aa3ff"]);
  if (t.side === "enemy" && !t.aware && !t.ko) tags.push(t.investigate ? ["??", "#e0a84f"] : ["?", "#ffd166"]); // ??: going to look at a noise
  if (t.side === "player" && t.post && b.phase === "deploy") tags.push([t.post === "gate" ? "G" : t.post === "wall" ? "W" : "T", "#e0a84f"]);
  if (t.surprised) tags.push(["!", "#ffd166"]);
  ctx.font = `700 ${Math.max(9, Math.round(cs * 0.2))}px Segoe UI, sans-serif`;
  tags.forEach(([txt, col], i) => {
    const tx = cx - r - 2 + i * cs * 0.32, ty = cy - r - 4;
    ctx.fillStyle = "rgba(15,17,20,0.9)";
    roundRect(tx - cs * 0.14, ty - cs * 0.12, cs * 0.28, cs * 0.22, 3); ctx.fill();
    ctx.fillStyle = col;
    ctx.fillText(txt, tx, ty + cs * 0.05);
  });
}

// Units slide along their last move: where one is now, in cells (fractions while it moves).
function animTile(b, t, now) {
  for (let i = b.fx.length - 1; i >= 0; i--) {
    const f = b.fx[i];
    if (f.type !== "move" || f.unit !== t.id) continue;
    if (!cui.anim.has(f.seq)) cui.anim.set(f.seq, now);
    const per = 70, el = now - cui.anim.get(f.seq), total = f.path.length * per;
    if (el >= total) break;
    const pts = [f.from, ...f.path];
    const k = el / per, s = Math.floor(k), fr = k - s;
    const a = pts[s], c = pts[Math.min(pts.length - 1, s + 1)];
    return [a[0] + (c[0] - a[0]) * fr, a[1] + (c[1] - a[1]) * fr];
  }
  return [t.x, t.y];
}
function animPos(b, t, now) {
  const { cs, ox, oy } = geo;
  const [x, y] = animTile(b, t, now);
  return [ox + (x + 0.5) * cs, oy + (y + 0.5) * cs];
}

function drawFx(b, now, cs) {
  const { ox, oy } = geo;
  for (const f of b.fx) {
    if (f.type === "move" || f.seq < b.fxSeq - 8) continue;
    if (!cui.anim.has(f.seq)) cui.anim.set(f.seq, now);
    const el = now - cui.anim.get(f.seq);
    if (el > 1400) continue;
    const tx = ox + (f.to[0] + 0.5) * cs, ty = oy + (f.to[1] + 0.5) * cs;
    if (f.type === "shot" && el < 600) {
      const a = 1 - el / 600;
      ctx.strokeStyle = f.acid ? `rgba(154,214,58,${a})` : f.hit ? `rgba(255,180,80,${a})` : `rgba(200,200,200,${a * 0.7})`; // acid: a spitter (sim/zombietypes.js)
      ctx.lineWidth = f.hit ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(ox + (f.from[0] + 0.5) * cs, oy + (f.from[1] + 0.5) * cs);
      ctx.lineTo(tx + (f.hit ? 0 : cs * 0.3), ty + (f.hit ? 0 : -cs * 0.2));
      ctx.stroke();
    }
    // A throw (sim/stealth.js): the item flies in an arc and lands; the lure ring stays (drawLures).
    if (f.type === "throw") {
      if (el < 500) {
        const k = el / 500, fx0 = ox + (f.from[0] + 0.5) * cs, fy0 = oy + (f.from[1] + 0.5) * cs;
        const px = fx0 + (tx - fx0) * k, py = fy0 + (ty - fy0) * k - Math.sin(k * Math.PI) * cs * 1.2;
        ctx.strokeStyle = "rgba(255,209,102,0.35)"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(fx0, fy0); ctx.quadraticCurveTo((fx0 + tx) / 2, (fy0 + ty) / 2 - cs * 2.4, tx, ty); ctx.stroke(); ctx.setLineDash([]);
        drawThrowable(f.item, px, py, cs);
      }
      continue;
    }
    const a = Math.max(0, 1 - el / 1400);
    const text = f.text ? f.text : f.type === "loot" ? f.text : f.type === "heal" ? "+" : f.hit ? `${f.crit ? "CRIT " : ""}-${f.dmg}` : "MISS";
    ctx.font = `800 ${Math.round(cs * (f.crit ? 0.36 : 0.3))}px Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = f.type === "loot" ? `rgba(255,209,102,${a})` : f.type === "heal" ? `rgba(108,196,138,${a})` : f.acid ? `rgba(170,230,70,${a})` : f.hit ? `rgba(255,${f.crit ? 210 : 110},90,${a})` : `rgba(210,210,210,${a})`;
    ctx.strokeStyle = `rgba(0,0,0,${a})`;
    ctx.lineWidth = 3;
    const y = ty - cs * 0.5 - (el / 1400) * cs * 0.6;
    ctx.strokeText(text, tx, y);
    ctx.fillText(text, tx, y);
  }
}
