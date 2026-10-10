// Tactical combat screen: canvas battle map plus the side panel. Reads state.combat; all rules live in sim/combat.js.
import { PAL } from "./palette.js"; // good / bad colours (the colour-blind-safe set swaps them: ui/display.js)
import {
  volRefusal, VOL_ORDERS, MAP_W, MAP_H, CELL, COVER_DEF, active, unitAt, unitById, evacAt, reachable, pathTo, shotOdds, meleeOdds, retreatPlan, retreatRefusal,
  canSee, canSeeAt, coverSides, isRanged, adjacent, meleeReach, canFire, ammoLeft, arrowsLeft, medsLeft, combatAct, enemyStep, playerSees,
  hasMag, magLabel, magEmpty, magShown, reloadRefusal, fireRefusal, hasShots,
  vehicleTurret, TURRET, RIDE, turretRounds, los, autoResolveCombat, finishCombat, closeCombat, zoneAt, boxAt, searchableNear, nearBox, boxCenter, DRIVE, RAMMING, aboardCount, evacRefusal, AREAS, areaHint, HEAT_NAMES,
  playerVision, enemyGhosts, heightAt, HEIGHT, sightRange, structureName, barredCell, doorHeld, WEAPONS, CRIT_MULT, hitMult,
} from "../sim/combat.js";
import * as SIM from "../sim/combat.js";
import { magsLine, spareRounds, reloadText, isShellGun, shellsInPack, getShellsRefusal, shellsLine, SHELLS } from "../sim/mags.js"; // magazines as items (section 15): spares, what a Reload does
import { plateSwapPlan, PLATE_AP } from "../sim/carrykit.js"; // a broken plate swapped from the pack (2 actions)
import { loadsFor } from "../sim/ammo.js"; // the reload chooser: the types of the gun's calibre to hand // setFloor and stairOptions (docs/multi-storey-crawl.md), looked up when present
import { MILDEAD, armorVs, stabsGap } from "../sim/deadsoldiers.js";
import { windowsNear, BMAP, peekOptions, closeOptions, braceOptions } from "../sim/buildingmaps.js";
import { INTERIOR } from "../sim/interior.js";
import { clearEnough } from "../sim/battlesize.js";
import { SUPPLIES, GEAR } from "../sim/data.js";
import { rescueOptions } from "../sim/rescueraid.js"; // a rescue raid on a group's base: captives, the cell, the armory
import { subdueOdds, canSubdue, throwablesOf, THROWABLES, THROW_KEYS, dragable, heldDown, STEALTH } from "../sim/stealth.js";
import { flashCells, flashReach, stunLabel, FRAG, BLAST, SMOKE } from "../sim/throwables.js"; // a flashbang's reach and stun; the throw preview
import { glLabel, glName, glRange, glLoads, glRounds, roundLabel, launchRefusal, glReloadRefusal, backblastCells, enclosedAt, LAUNCH, GL_HE, ROCKET } from "../sim/launchers.js"; // grenade launchers and rockets (section 13)
import { LIGHTS } from "../sim/lights.js";
import { LISTEN } from "./soundcues.js"; // deafened: the battle is heard muffled through the selected unit's ears
import { earStatus, visorState } from "../sim/hearing.js"; // deaf and dazed chips, the Visor toggle (sim/helmets.js)
import { canPlace, LIT_ZONES } from "../sim/deploy.js";
import { planFor, planStale, planKey, PLAN_MAPS, plansOf, currentPlan, planTags, startText, roleOf, PLAN, PLAN_WHO, PLAN_WHEN, PLAN_ROLES } from "../sim/defenceplan.js"; // the base's defence plans (the deploy step, the drill)
import { roomText, totalRoom } from "../sim/prisoners.js"; // jailhouse: prisoner room at your bases
import { bodyEmpty } from "../sim/inventory.js";
import { CALIBERS, AMMO_TYPES } from "../sim/data-ammo.js"; // the rounds a reload can take (the ammo chooser)
import { atVehicle, personalLoad, trunkInfo } from "../sim/raidloot.js";
import { SEARCH, quickable, quickRefusal, quickRadius, quickHurtPct } from "../sim/search.js";
export const QUICK_MARK = "#7fb8e6"; // a container rummaged through but not searched in full (both views)
import { unitCanvas, canvasURL, spriteImg } from "./sprites.js";
import { lockPanel, raidKeyLine, lockPreview } from "./locks.js";
import { carPanel, carPreview } from "./carpanel.js"; // cars on the map: get in, keys, hotwire, inspect, claim (sim/foundcars.js)
import { ZTYPES } from "../sim/hiveconst.js";
import { ACID, acidAt } from "../sim/acid.js";
import { ladderTargets, pushable, pushChance, ramTargets, ramOf, dropTargets, RAM, LADDER, DROP } from "../sim/siege.js";
import { herded, sensesOf } from "../sim/decoys.js";
import { crushable, tappable, liftable, carriedBy, carHere, endangered, imminent, bodyAt as humanBodyAt, bodyName, unitBodyLoad, carRoom } from "../sim/carriers.js"; // the Carrier: bodies in danger, the risen, bodies carried, shot or burnt
import { recText, handsKg, carriedNear, handsBusy, armsText } from "../sim/carry.js"; // supplies carried in the arms in a fight: Drop carried (free), Pick up load
import { statusIcons } from "./status.js"; // the survivor behind a unit: low mood, starving, thirsty, infected, sick (its own hit points are the bar)
import { barkFrame } from "./barks.js"; // combat barks: short speech bubbles over the units' heads
import { ingestMarks } from "./battlemarks.js"; // blood, brass and scorch read off each action's fx before the short fx list drops them
import { iso, drawIso, project, isoPick, isoRotate, isoZoom, isoPan, isoEdge, isoCenterOn, isoOnScreen, setRoofs, floorsOf, floorNo, onFloor, ISO_ZOOMS, LV, liftOf } from "./isoview.js";
import { keyAction, keyLabel, actionsOfCode, KEY_BY_ID } from "./keymap.js"; // the key table (Menu → Controls)
import { isMedic, healRefusal, healAmount, reviveRefusal, reviveOdds, liftRefusal, dropRefusal, dragging, finishRefusal, finishOdds, handsOdds, MEDIC, vehicleOf, pullTargets, pullRefusal, layInStab, selfKit, selfOdds, selfStabRefusal } from "../sim/medics.js"; // medics, dragging the downed, finishing a downed enemy, pulling one out of a vehicle
import { groundButtons, groundCbAct, groundClick } from "./ground.js"; // bodies searched where they fell, things on the ground (sim/ground.js)
import { nlButtons, nlAskHtml, nlCbAct, nlMapClick, nlOdds, nlConeMask, nlPreview, nlTags, nlStatus } from "./nonlethal.js"; // tasers, pepper spray, pulled blows, surrender (sim/nonlethal.js)
// Ground-ring colors of a hive's special dead (sim/zombietypes.js); ordinary dead keep the green ring.
const ZRING = { runner: "#ffb43b", brute: "#c8c4b0", spitter: "#9ad63a", screamer: "#c99ae0", crawler: "#6ab0c8", shepherd: "#e8e2ff", soldier: "#a8b878", riot: "#8aa0c8", carrier: "#e6d8a8", swarm: "#f0e4c0", boneback: "#d8b48a", climber: "#8fd0a0", flinger: "#e8a0c8", sower: "#e8e070", nightmare: "#e0506e", sleeper: "#b0d8ff" };

// Battle size; raids use a bigger map. Set from the battle in sync().
let W = MAP_W, H = MAP_H;
const ENEMY_STEP_MS = 420;

export const cui = { battle: null, sel: null, mode: "move", hover: null, msg: "", lastStep: 0, anim: new Map(), cache: { key: "" }, autoPlay: false, pickedDown: null }; // autoPlay: the AI plays your side (cb-autoplay); pickedDown: one of the downed picked in the roster (autoSelect keeps them)
LISTEN.sel = () => cui.sel; // ui/soundcues.js: whose ears the battle is heard through
// ui/gunsfx.js: where on screen a sound is (pan, distance from the middle) and what your people see (out of sight: muffled).
LISTEN.cam = () => { if (!iso.cw) return null; const [x0, y0] = project(0, 0, 0), [x1, y1] = project(1, 0, 0); return { cw: iso.cw, ch: iso.ch, S: Math.hypot(x1 - x0, y1 - y0) / Math.hypot(16, 8), project }; };
LISTEN.vis = () => (cui.cache && cui.cache.vis) || null;
let canvas = null, ctx = null;

export function initCombatUI(cv) {
  canvas = cv;
  ctx = cv.getContext("2d");
}

// The battle view (ui/isoview.js): isometric, the only one (there is no top-down battle view).

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
const alive = (u) => !u.dead && !u.down && !u.left && !u.fled && (!u.off || u.aboard); // aboard the vehicle: off the map but still yours to order
// A cell's rules, with a stand-in for `void` (outside the footprint on an upper floor) until the sim knows it.
const VOIDDEF = { walk: false, cover: 0, los: false, name: "Open air" };
const CDEF = (c) => CELL[c.k] || VOIDDEF;

// ---------- helpers ----------
const players = (b) => b.units.filter((u) => u.side === "player" && u.vol == null); // yours to order (volunteers are not: sim/combat.js volunteerTurn)
const allSide = (b) => b.units.filter((u) => u.side === "player"); // your side, volunteers too (heal, revive, drag)
const VOL_COLOR = "#c9a2ff"; // volunteers' ring, name and tag (ui/isoview.js the same)
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (u) => Math.max(0, Math.min(1, u.hp / u.maxHp));
const hpColor = (f) => (f > 0.6 ? PAL.good : f > 0.3 ? PAL.mid : PAL.bad);

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
  cui.autoPlay = !!(b.setup && b.setup.watch); // a new battle starts in your hands (a fight you only watch plays itself: sim/volunteers.js)
  for (const f of b.fx) cui.anim.set(f.seq, performance.now());
  autoSelect(b);
}

function autoSelect(b) {
  const cur = cui.sel != null ? unitById(b, cui.sel) : null;
  if (cur && cur.side === "player" && alive(cur) && cur.ap > 0) return;
  if (cur && cur.side === "player" && cur.down && !cur.dead && b.phase === "player" && (cui.pickedDown === cur.id || !selfStabRefusal(b, cur))) return; // sim/medics.js: one of the downed picked in the roster (their panel: stabilize yourself)
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
// A rescue raid's actions for the selected unit (sim/rescueraid.js rescueOptions): the ropes, cut free, the cell's
// lock, the jailer's keys, weapons off bodies and out of their armory.
function rescueButtons(state, b, u, btn) {
  return rescueOptions(state, b, u).map((o) => btn(`rescue:${o.op}`, esc(o.label), o.tip, o.ok)).join("");
}

// A unit's weapon with its magazine (sim/combat.js magazines): "9mm pistol 7/15", flagged when it needs a reload.
function gunText(b, u) {
  return gunOnly(b, u) + launcherText(b, u);
}
// A launcher beside the gun (sim/launchers.js): your own with its rounds ("M79 1/1 HE"); theirs only what it is (R10:
// never what it is loaded with).
function launcherText(b, u) {
  if (!u || !u.gl || u.dead) return "";
  if (u.side !== "player") return ` · <span class="warn">${esc(glName(u.gl))}</span>`;
  const empty = !u.gl.oneShot && Math.min(u.gl.mag, glRounds(b, u, u.gl.load)) < 1;
  return ` · <b>${esc(glLabel(b, u))}</b>${empty ? ` <span class="danger">empty — reload (${esc(keyLabel("battle.launch", 1) || "Shift+L")})</span>` : ""}`;
}
function gunOnly(b, u) {
  const m = magLabel(b, u);
  const jam = u.jam && !u.dead ? ' <b class="danger" data-tip="Jammed: Unjam clears it (or a Reload, for a double feed).">JAMMED</b>' : "";
  if (!m) return esc(u.weaponName) + jam;
  if (jam || u.side === "player") return `${esc(u.weaponName)} <b>${m}</b>${u.side === "player" ? ownGunTag(u) + magsTag(b, u) : ""}${jam}${gunFlag(b, u)}`; // an enemy's line: the gun and its parts, never its ammo (section 20, R10)
  const flag = u.side === "player" && isRanged(u) && !u.dead && magShown(b, u) < (WEAPONS[u.weapon].ammo || 1)
    ? (reloadRefusal(b, u) ? ' <span class="danger">Out of ammo</span>' : ' <span class="danger">Empty — reload (I)</span>') : "";
  return `${esc(u.weaponName)} <b>${m}</b>${flag}`; // (a jammed gun: the line above, with its JAMMED badge)
}
// Swap plate (sim/carrykit.js): shown while a worn carrier has a broken, missing or badly worn plate.
function plateButton(state, b, u, btn) {
  const s = u.side === "player" && u.sid != null ? (state.survivors || []).find((x) => x.id === u.sid) : null;
  const p = s ? plateSwapPlan(s) : null;
  if (!p || /No plate carrier|sound/.test(p.why)) return "";
  return btn("plate", "Swap plate", p.why ? `A plate in the carrier is broken or worn. ${p.why}` : `${PLATE_AP} actions: a spare plate from the pack into the carrier's ${p.side} pocket (a broken one is dropped).`, !p.why && u.ap >= PLATE_AP);
}
// The spare magazines a fighter of yours carries (sim/mags.js): "+3 mags", "2 clips".
function magsTag(b, u) {
  const t = magsLine(b, u);
  return t ? ` <span class="muted" data-tip="${esc(`Spare magazines: a Reload takes the next loaded one (1 action from a rig pouch or a pocket, 2 from the pack); with none left it tops up the one in the gun (2 actions). ${spareRounds(b, u)} rounds in them.`)}">${esc(t)}</span>` : "";
}
function gunFlag(b, u) {
  return u.side === "player" && isRanged(u) && !u.dead && magShown(b, u) < (WEAPONS[u.weapon].ammo || 1)
    ? (reloadRefusal(b, u) ? ' <span class="danger">Out of ammo</span>' : ' <span class="danger">Empty — reload (I)</span>') : "";
}
// Your own gun: the round it is loaded with (a kind other than the standard) and its fire mode.
function ownGunTag(u) {
  const c = CALIBERS[WEAPONS[u.weapon] && WEAPONS[u.weapon].cal];
  const load = u.load && c && u.load !== c.base && AMMO_TYPES[u.load] ? ` <span class="muted">${esc(AMMO_TYPES[u.load].name)}</span>` : "";
  const modes = unitModes(u);
  return `${load}${modes.length > 1 ? ` <span class="muted">[${esc(MODE_NAME[curMode(u)] || curMode(u))}]</span>` : ""}`;
}

// ---------- threat preview ----------
// The enemies you see, per battle revision: whether each can shoot (a gun and rounds) and where one action's walk
// takes it (then a blow). Unseen ones are not counted: the preview never tells you what your people do not know.
function threats(b, v) {
  if (v.threatKey === v.key) return v.threatList;
  const list = [];
  for (const e of b.units) {
    if (e.side !== "enemy" || !active(e) || e.ko || !v.seen.has(e.id) || !onFloor(b, e)) continue;
    list.push({ e, ranged: isRanged(e) && hasShots(b, e), reach: reachable(b, e, e.mob) }); // an empty gun reloads and shoots
  }
  v.threatKey = v.key;
  v.threatList = list;
  return list;
}
// Who could hit someone standing at (x, y) in the enemy's next turn, from where they stand now: a gun with the tile in
// sight (the odds against the selected unit standing there, its cover from that side), or a walk of one action to
// a cell next to it and a blow. [{ e, shot: chance or null, blow }]
export function threatAt(b, v, x, y) {
  if (b.over || b.phase !== "player") return [];
  const u = v.u && active(v.u) ? v.u : null;
  const stand = u ? { ...u, x, y, hunker: false } : null;
  const out = [];
  for (const T of threats(b, v)) {
    const e = T.e;
    let shot = null;
    if (T.ranged && canSeeAt(b, e, x, y)) shot = stand ? shotOdds(b, e, stand).chance : 0;
    let blow = false;
    if (shot == null) {
      for (let dy = -1; dy <= 1 && !blow; dy++) for (let dx = -1; dx <= 1 && !blow; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if ((e.x === nx && e.y === ny) || isFinite(T.reach.dist[ny * W + nx])) blow = true;
      }
    }
    if (shot != null || blow) out.push({ e, shot, blow });
  }
  return out;
}
function threatHtml(b, v, x, y, who = "") {
  if (b.over || b.phase !== "player") return "";
  const list = threatAt(b, v, x, y);
  if (!list.length) return `<br><span class="good small">Threat${who}: none of the enemies you see can shoot this tile or reach it next turn.</span>`;
  const shots = list.filter((t) => t.shot != null).sort((a, c) => c.shot - a.shot);
  const blows = list.filter((t) => t.blow);
  const nm = (e) => `${esc(e.name)}${e.aware ? "" : " (unaware)"}`;
  const parts = [];
  if (shots.length) parts.push(`can shoot it: ${shots.map((t) => `${nm(t.e)}${v.u ? ` <b class="${t.shot >= 50 ? "danger" : t.shot >= 25 ? "warn" : "muted"}">${t.shot}%</b>` : ""}`).join(", ")}`);
  if (blows.length) parts.push(`can reach it and strike: ${blows.length > 3 ? `${blows.length} of them (${blows.slice(0, 3).map((t) => nm(t.e)).join(", ")}…)` : blows.map((t) => nm(t.e)).join(", ")}`);
  return `<br><span class="small"><b class="danger">Threat${who}</b> (enemies you see, from where they stand): ${parts.join("; ")}.</span>`;
}

// ---------- input ----------
function cellFromPx(px, py) {
  const c = cui.battle ? isoPick(cui.battle, px, py) : null;
  return c ? { x: c.x, y: c.y } : null;
}

export function combatMouse(state, px, py) {
  const b = state.combat;
  if (!b) return;
  sync(b);
  // Dragging pans the isometric view (the click it started is not made).
  if (cui.drag) {
    const d = cui.drag;
    if (!d.moved && Math.hypot(px - d.x0, py - d.y0) > 6) d.moved = true;
    if (d.moved) { isoPan(b, px - d.px, py - d.py); d.px = px; d.py = py; return; }
  }
  if (canvas) isoEdge(px, py, canvas.clientWidth, canvas.clientHeight, performance.now());
  const c = cellFromPx(px, py);
  cui.hover = c ? { ...c, px, py } : null;
  const el = typeof document !== "undefined" && document.getElementById("cbprev");
  if (el) el.innerHTML = previewHtml(b, state);
}
export function combatLeave() { cui.hover = null; cui.drag = null; isoEdge(null); }

// The mouse on the battle map (main.js): in the isometric view a press that moves pans the view and a press that
// does not is a click (left: the usual click; right: cancel the current action).
// Returns true when the press was a click main.js should act on now.
export function combatPress(state, px, py, button) {
  if (!state.combat) return false;
  cui.drag = { x0: px, y0: py, px, py, moved: false, button };
  return false; // the click is made on the release (combatRelease)
}
export function combatRelease(state, px, py) {
  const d = cui.drag;
  cui.drag = null;
  if (!state.combat || !d) return null;
  return d.moved ? "drag" : d.button === 0 ? "click" : d.button === 2 ? "cancel" : null;
}
export function combatWheel(state, px, py, dy) {
  const b = state.combat;
  if (!b) return false;
  sync(b);
  isoZoom(b, dy < 0 ? 1 : -1, px, py);
  return true;
}
// Selecting a unit that is off screen brings the camera to it.
function follow(b) {
  const u = selUnit(b);
  followFloor(b, u);
  if (u && !isoOnScreen(b, u.x, u.y)) isoCenterOn(b, u.x, u.y);
}

function act(state, a) {
  const b = state.combat;
  const err = combatAct(state, a);
  if (b) ingestMarks(b, performance.now());
  cui.msg = err || "";
  cui.pickedDown = null; // a downed one picked in the roster stays picked only until something is done
  if (!err && a.type !== "end") {
    const u = unitById(b, a.unit);
    if (u && u.side === "player") followFloor(b, u); // Go up / Go down: the view goes with them
    if (!u || !active(u) || u.ap < 1 || ["throw", "drag", "tie", "subdue", "taser", "pepper", "execute", "surrender", "peek", "close", "brace", "doubletap", "pickup", "crush", "goup", "godown", "drive", "loadRam", "unloadRam", "board", "disembark", "turn", "heal", "revive", "dragAlly", "dropAlly", "finish", "pullOut", "suppress", "throwspear", "unjam", "launch", "glreload"].includes(a.type)) cui.mode = "move";
    cui.ammoAsk = null;
  }
  autoSelect(b);
  return !err;
}

export function combatClick(state, px, py) {
  const b = state.combat;
  if (!b || b.over) return;
  sync(b);
  // The marker of a unit on another floor (ui/isoview.js): jump to that floor (and select them if they are yours).
  if (floorsOf(b)) {
    const p = isoPick(b, px, py);
    const t = p && p.unit != null ? unitById(b, p.unit) : null;
    if (t && t.f != null && t.f !== floorNo(b)) {
      setViewFloor(b, t.f);
      if (t.side === "player" && t.vol == null && alive(t)) { cui.sel = t.id; cui.mode = "move"; cui.msg = ""; }
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
  if (u && active(u) && groundClick(state, b, u, c, cui, act)) return; // ui/ground.js: the body picked to search
  // The team's vehicle (sim/combat.js driveTo): Drive, then click where it goes.
  if (u && active(u) && u.ap > 0 && cui.mode === "drive") return void act(state, { type: "drive", unit: u.id, x: c.x, y: c.y });
  // A tank trap next to the unit (sim/combat.js CELL.tanktrap, a bridge barricade's): a blow at it.
  if (u && active(u) && u.ap > 0 && cui.mode === "move" && !who && b.cells[c.y * W + c.x].k === "tanktrap" && Math.max(Math.abs(u.x - c.x), Math.abs(u.y - c.y)) <= 1) return void act(state, { type: "melee", unit: u.id, x: c.x, y: c.y });
  // The stealth kit (sim/stealth.js): throw at a tile, drag a body (pick it, then where to), tie up the knocked out.
  if (u && active(u) && u.ap > 0 && cui.mode === "throw") return void act(state, { type: "throw", unit: u.id, item: cui.throwKey, x: c.x, y: c.y });
  // Suppressing fire at an enemy or a spot, a spear thrown at a tile (the weapons overhaul: the sim says why not).
  if (u && active(u) && u.ap > 0 && cui.mode === "suppress") return void act(state, { type: "suppress", unit: u.id, x: c.x, y: c.y, ...(who && who.side === "enemy" && v.seen.has(who.id) ? { target: who.id } : {}) });
  if (u && active(u) && u.ap > 0 && cui.mode === "throwspear") return void act(state, { type: "throwspear", unit: u.id, x: c.x, y: c.y, ...(who && who.side === "enemy" && v.seen.has(who.id) ? { target: who.id } : {}) });
  if (u && active(u) && u.ap > 0 && cui.mode === "launch") return void act(state, { type: "launch", unit: u.id, x: c.x, y: c.y }); // sim/launchers.js: the sim says why not
  if (u && active(u) && u.ap > 0 && nlMapClick(state, b, u, c, cui, act)) return; // pepper spray toward a tile (ui/nonlethal.js)
  if (u && active(u) && u.ap > 0 && cui.mode === "drag") {
    if (cui.dragId == null) {
      const body = bodyAt(b, c.x, c.y);
      if (!body || !adjacent(u, body)) { cui.msg = "Click a body, someone knocked out or a downed teammate right next to you."; return; }
      if (body.side === "player" && !body.dead) return void act(state, { type: "dragAlly", unit: u.id, target: body.id }); // sim/medics.js: dragged along
      cui.dragId = body.id;
      cui.msg = `Now click where to drag ${body.dead ? `${body.name}'s body` : body.name} (up to ${STEALTH.DRAG} tiles).`;
      return;
    }
    const id = cui.dragId;
    cui.dragId = null;
    return void act(state, { type: "drag", unit: u.id, target: id, x: c.x, y: c.y });
  }
  if (u && active(u) && u.ap > 0 && cui.mode === "tie") {
    const t = b.units.find((o) => o.side === "enemy" && heldDown(o) && !o.fled && o.x === c.x && o.y === c.y); // knocked out, surrendered, down (sim/stealth.js heldDown)
    if (t) return void act(state, { type: "tie", unit: u.id, target: t.id });
  }
  // The worm (sim/carriers.js): a body clicked for Double tap, Pick up body or Crush skull.
  if (u && active(u) && u.ap > 0 && (cui.mode === "doubletap" || cui.mode === "pickup" || cui.mode === "crush")) {
    const body = humanBodyAt(b, c.x, c.y);
    if (!body) { cui.msg = cui.mode === "doubletap" ? "Click a body in sight to put a round through its head." : cui.mode === "pickup" ? "Click a body right next to you to pick it up." : "Click a body right next to you to crush its skull."; return; }
    return void act(state, { type: cui.mode, unit: u.id, target: body.id });
  }
  // sim/medics.js: Heal, Revive and Drag ally take the teammate clicked; Finish the downed enemy clicked.
  if (u && active(u) && u.ap > 0 && ["heal", "revive", "dragAlly"].includes(cui.mode) && who && who.side === "player") return void act(state, { type: cui.mode, unit: u.id, target: who.id });
  if (u && active(u) && u.ap > 0 && cui.mode === "finish" && who && who.side === "enemy" && who.down && !who.dead) return void act(state, { type: "finish", unit: u.id, target: who.id });
  if (who && who.side === "player") {
    if (cui.mode === "meds" && u && (who === u || adjacent(u, who))) return void act(state, { type: "meds", unit: u.id, target: who.id });
    if (who.vol != null) { cui.msg = volRefusal(who); return; } // sim/volunteers.js: their own group's orders
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
  if (who && who.side === "enemy" && who.down && !who.dead && playerSees(b, who)) return void attack(state, u, who); // sim/medics.js: a downed enemy (never finished by a plain click)
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

// Why a ranged weapon cannot shoot: a bow or crossbow is out of arrows, a gun out of ammo.
const outOf = (u) => (WEAPONS[u.weapon] && WEAPONS[u.weapon].arrows ? "Out of arrows" : "Out of ammo");
// The arrows to hand (sim/combat.js arrowsLeft), shown next to the ammo when anyone shoots a bow or there are arrows.
const ARROWS_TIP = "Arrows (and crossbow bolts) carried: the team's packed and found ones, or the base's stock. A bow or crossbow uses 1 a shot; with none it can only fight in melee. After a won fight about half the arrows shot are picked up again; after a loss or a retreat none.";
function arrowsChip(b) {
  const n = Math.floor(arrowsLeft(b));
  const bows = b.units.some((x) => x.side === "player" && !x.dead && WEAPONS[x.weapon] && WEAPONS[x.weapon].arrows);
  return bows || n > 0 ? `<span data-tip="${esc(ARROWS_TIP)}" class="${bows && n < 1 ? "warn" : ""}">Arrows <b>${n}</b></span>` : "";
}

function attack(state, u, t) {
  const b = state.combat;
  if (cui.mode === "taser") return void act(state, { type: "taser", unit: u.id, target: t.id }); // ui/nonlethal.js
  // A downed enemy (sim/medics.js): only Finish kills them; a plain click says so.
  if (t.side === "enemy" && t.down && !t.dead) {
    if (cui.mode === "finish") return void act(state, { type: "finish", unit: u.id, target: t.id });
    cui.msg = `${t.name} is down${t.ko ? " (out cold)" : t.stab ? " (stabilized)" : " and bleeding"}. Finish them (${keyLabel("battle.finish", 1) || "Shift+K"}) to kill them for good${t.ko || t.wounded ? ", tie them up (T) to take them prisoner" : ""}, or leave them.`;
    return;
  }
  if (cui.mode === "subdue") {
    if (!canSubdue(u, t, b)) { cui.msg = "Subdue needs them right next to you."; return; }
    return void act(state, { type: "subdue", unit: u.id, target: t.id });
  }
  const wantMelee = cui.mode === "melee" || (!canFire(b, u) && meleeReach(b, u, t));
  if (wantMelee) {
    if (!adjacent(u, t)) { cui.msg = "Melee needs the target right next to you."; return; }
    return void act(state, { type: "melee", unit: u.id, target: t.id });
  }
  if (!isRanged(u)) { cui.msg = `${u.name} has no gun. Move next to the target and use Melee.`; return; }
  if (!canFire(b, u)) { cui.msg = magEmpty(b, u) && !reloadRefusal(b, u) ? `${fireRefusal(b, u)} Press I or Reload.` : `${outOf(u)}. Melee only.`; return; }
  if (!canSee(b, u, t)) { cui.msg = "No line of sight from here."; return; }
  act(state, { type: "shoot", unit: u.id, target: t.id });
}

// ---------- the weapons overhaul's gun orders (docs/weapons-overhaul-plan.md section 20) ----------
// Fire mode (free), Unjam, Suppress (a targeting mode with a cone), Throw spear (a targeting mode with its reach) and the
// ammo chooser a Reload opens when more than one kind of the gun's round is to hand. The sim acts are combatAct
// "firemode" (act.mode), "unjam", "suppress" (act.target or act.x / act.y), "throwspear" (act.x / act.y) and "reload"
// (act.ammo); each button shows only when the unit can have that order (a gun with fire modes, a jam, a spear), and a
// refusal from the sim shows in the panel like any other.
const MODE_ORDER = ["single", "burst", "auto"];
export const MODE_NAME = { single: "Single", burst: "Burst", auto: "Auto" };
// The fire modes of a unit's gun (u.modes, else its WEAPONS entry's), single first.
export function unitModes(u) {
  const w = (u && WEAPONS[u.weapon]) || {};
  const m = (u && u.modes) || w.modes;
  const list = Array.isArray(m) ? m : m && typeof m === "object" ? Object.keys(m) : [];
  return [...MODE_ORDER.filter((x) => list.includes(x)), ...list.filter((x) => !MODE_ORDER.includes(x))];
}
export const curMode = (u) => { const l = unitModes(u); return u.mode && l.includes(u.mode) ? u.mode : l[0] || "single"; };
// A gun that can lay down suppressing fire: one with a burst or automatic mode (or marked for it).
const canSuppressUI = (u) => isRanged(u) && !WEAPONS[u.weapon].arrows && (unitModes(u).some((m) => m !== "single") || !!WEAPONS[u.weapon].suppress);
// A spear in hand (data-guns.js throw: the tiles it flies; reach 2 or throwRange as before): it can be thrown.
const spearOf = (u) => { const w = WEAPONS[u.weapon]; return !!(w && w.melee && (w.throw || w.throwRange || (w.reach || 0) >= 2)); };
const spearRange = (u) => { const w = WEAPONS[u.weapon]; return (w && (w.throw || w.throwRange)) || SIM.SPEAR_RANGE || 5; };
// Your spear on the ground (sim/combat.js b.spears, the thrower's u.spearOut): picked up from next to it for 1 action.
const spearDown = (b, u) => (u.spearOut && b.spears ? b.spears.find((x) => x.owner === u.id) || null : null);
export const OVERWATCH_TIP = "Ends the turn. Reacts to every enemy that moves in range until your next turn or the magazine runs dry (each a reaction shot at −15 aim, in the gun's fire mode: a big magazine makes the best overwatch gun). Needs a loaded gun.";

// The kinds of round for the unit's gun to hand: [{ type, n, name }] (sim/ammo.js loadsFor: its side's boxes and pools,
// the loaded type first; only the types there are rounds of).
export function ammoToHand(state, b, u) {
  const c = CALIBERS[WEAPONS[u.weapon] && WEAPONS[u.weapon].cal];
  if (!c || u.side !== "player" || !isRanged(u)) return [];
  return loadsFor(b, u).filter((x) => x.n > 0).map((x) => ({ type: x.type, n: Math.floor(x.n), name: `${c.name} ${x.name}` }));
}
const loadOf = (u) => { const c = CALIBERS[WEAPONS[u.weapon] && WEAPONS[u.weapon].cal]; return u.load || (c ? c.base : null); };
cui.ammoAsk = null; // the unit whose Reload chooser is open
cui.ammoPick = {};  // uid -> the kind of round picked for its next reload

function gunButtons(state, b, u, btn) {
  if (!active(u)) return "";
  let html = "";
  const key = (id, def) => keyLabel(id, 1) || def;
  const modes = unitModes(u);
  const vs = visorState(u); // sim/helmets.js: a visor to raise or lower (free)
  if (vs) html += btn("visor", vs === "down" ? "Visor up" : "Visor down", vs === "down" ? "Free: raise the visor. No aim or sight lost to it (or to its fog), but the face is bare: bites and blows to it do their full damage." : "Free: lower the visor over the face: bites and blows to the face count much less (a ballistic visor stops bullets too), at a little aim (a ballistic visor 2 and a tile of sight; 3 more fogged up in the cold or the rain).", true, key("battle.visor", "Shift+Y"));
  if (isRanged(u) && modes.length > 1) {
    const m = curMode(u), next = modes[(modes.indexOf(m) + 1) % modes.length];
    html += btn("firemode", `Fire: ${MODE_NAME[m] || m}`, `Free: switch the fire mode (${modes.map((x) => MODE_NAME[x] || x).join(" → ")}). Now ${m}; next ${next}. Single: 1 round, the best aim. Burst: 2–3 rounds, each its own roll at a little less aim. Auto: 10–15 rounds, worse aim, the best for suppressing and overwatch. Overwatch reactions fire in this mode.`, true, key("battle.firemode", "Shift+F"));
  }
  if (u.jam) {
    const ap = u.jam.ap || 1;
    html += btn("unjam", '<span class="danger">Unjam</span>', `${ap} action${ap === 1 ? "" : "s"}: clear the jam${u.jam.kind ? ` (${u.jam.kind === "double" ? "a double feed: a Reload clears it too" : u.jam.kind === "hard" ? "a hard jam: it wears the gun" : "a stovepipe"})` : ""}. The gun cannot fire until it is cleared.`, u.ap >= ap, key("battle.unjam", "Shift+J"));
  }
  if (canSuppressUI(u)) html += btn("suppress", "Suppress", "1 action: a stream of fire at an enemy or a spot (click it; the cone shows on the map). Everyone living in the cone keeps their head down until their next turn ends: −20 aim, no overwatch, they hunker. No effect on the dead. Hungry for rounds: automatic guns and machine guns do it best.", u.ap > 0 && canFire(b, u), key("battle.suppress", "Shift+O"));
  const sp = spearDown(b, u);
  if (sp) { const why = SIM.pickSpearRefusal ? SIM.pickSpearRefusal(b, u) : ""; html += btn("pickspear", "Pick up spear", `1 action: pick up the ${esc(sp.name.toLowerCase())} ${u.name.split(" ")[0]} threw, from next to it (walking onto it picks it up for free).${why ? ` ${why}` : ""}`, u.ap > 0 && !why, key("battle.pickspear", "Shift+P")); }
  if (u.gl) html += launchButtons(b, u, btn, key);
  if (spearOf(u)) html += btn("throwspear", "Throw spear", `1 action: throw the ${u.weaponName} at a tile up to ${spearRange(u)} away (click it): its melee damage on a hit. ${u.name.split(" ")[0]} fights with what is left (fists or a sidearm) until it is picked up again; it is picked up after a won fight.`, u.ap > 0, key("battle.throwspear", "Shift+G"));
  return html;
}
// A grenade launcher or a rocket (sim/launchers.js): Launch (a targeting mode; an empty one is reloaded instead, 1
// action) and, with more than one kind of 40 mm to hand, the round the next reload takes (free).
cui.glPick = {}; // uid -> the kind of 40 mm picked for the launcher's next reload
function launchButtons(b, u, btn, key) {
  const g = u.gl;
  const k = key("battle.launch", "Shift+L");
  const name = glName(g);
  let html = "";
  if (g.mag < 1 && !g.oneShot) {
    const t = cui.glPick[u.id] || g.load;
    const why = glReloadRefusal(b, u, t);
    html += btn("launch", '<span class="danger">Reload launcher</span>', `1 action: load the ${esc(name)} with ${esc(roundLabel(t))} (${g.cap > 1 ? `${g.cap} rounds` : "a round"}).${why ? ` ${why}` : ""}`, u.ap > 0 && !why, k);
  } else {
    const range = g.load === "buck" ? LAUNCH.BUCK.range : glRange(g);
    const tip = g.cal === "rocket"
      ? `Ends the turn: fire the ${esc(name)} straight at a tile it sees, up to ${range} away (click it): ${ROCKET.impact.join("–")} on the spot, ${ROCKET.dmg.join("–")} within 2; breaks gates, doors, wall sections, a ram, vehicles. Nothing arms inside ${LAUNCH.ARM} tiles (the red ring). The backblast (orange) hurts anyone 2 tiles behind; fired from inside a room it hurts the shooter too.${g.oneShot ? " A rocket tube fires once." : ""}`
      : g.load === "he" ? `Ends the turn: lob a 40 mm HE grenade up to ${range} tiles (click a tile you or a teammate sees, over walls too): ${GL_HE.impact.join("–")} on the spot, ${GL_HE.dmg.join("–")} within a tile and a half. It does not arm inside ${LAUNCH.ARM} tiles (the red ring).`
      : g.load === "buck" ? `Ends the turn: buckshot at an enemy up to ${range} tiles off (click them): ${LAUNCH.BUCK.dmg.join("–")}, best within ${LAUNCH.BUCK.opt}.`
      : g.load === "smoke" ? `Ends the turn: lob a 40 mm smoke round up to ${range} tiles: a cloud there for a few turns.` : `Ends the turn: lob a 40 mm flare up to ${range} tiles: it lights everything within 7 tiles.`;
    html += btn("launch", `Launch: ${esc(glLabel(b, u))}`, tip, u.ap > 0, k);
  }
  const loads = glLoads(b, u);
  if (loads.length > 1) {
    const cur = cui.glPick[u.id] || g.load;
    const i = loads.findIndex((x) => x.type === cur);
    const nx = loads[(i + 1) % loads.length];
    html += btn("glround", `Round: ${esc(roundLabel(cur))}`, `Free: the kind of round the launcher's next reload takes (${loads.map((x) => `${roundLabel(x.type)} ${x.n}`).join(", ")}); next ${roundLabel(nx.type)}. A reload with another kind than the loaded one swaps it (1 action).`, true);
    if (g.mag >= 1 && cur !== g.load) html += btn("glreload", "Swap the round", `1 action: unload the ${esc(roundLabel(g.load))} and load ${esc(roundLabel(cur))}.`, u.ap > 0 && !glReloadRefusal(b, u, cur));
  }
  return html;
}
// The Reload chooser: one button per kind of round to hand (the picked one marked); I reloads the picked one.
function ammoChooser(state, b, u) {
  if (!u || cui.ammoAsk !== u.id || !active(u)) return "";
  const list = ammoToHand(state, b, u);
  if (list.length < 2) return "";
  const pick = cui.ammoPick[u.id] || loadOf(u);
  return `<div class="small cbmsg cbammo" data-tip="${esc(`Reload with which round? ${keyLabel("battle.ammocycle", 1) || "Shift+I"} picks the next, I (or Reload) loads the picked one.`)}">Reload with: ${list.map((x) => `<button class="mini${x.type === pick ? " active" : ""}" data-action="cb-act" data-v="reload" data-k="${x.type}" data-tip="${esc(`${x.name}: ${x.n} to hand${x.type === loadOf(u) ? " (loaded now)" : ""}. 1 action.`)}">${esc(AMMO_TYPES[x.type] ? AMMO_TYPES[x.type].name : x.type)} <span class="muted">${x.n}</span></button>`).join(" ")} <button class="mini" data-action="cb-act" data-v="ammoclose" data-tip="Close">✕</button></div>`;
}
// The panel orders of this section (combatAction "cb-act"); true when handled.
function gunOrder(state, b, u, v, d) {
  if (v === "firemode") {
    const l = unitModes(u);
    if (l.length < 2) { cui.msg = isRanged(u) ? "This gun fires one way only." : "No gun."; return true; }
    act(state, { type: "firemode", unit: u.id, mode: d.mode && l.includes(d.mode) ? d.mode : l[(l.indexOf(curMode(u)) + 1) % l.length] });
    return true;
  }
  if (v === "visor") { if (!visorState(u)) { cui.msg = "No visor to raise or lower."; return true; } act(state, { type: "visor", unit: u.id }); return true; }
  if (v === "unjam") { if (!u.jam) { cui.msg = "The gun is not jammed."; return true; } act(state, { type: "unjam", unit: u.id }); return true; }
  if (v === "suppress") {
    if (!canSuppressUI(u)) { cui.msg = "Suppressing fire needs a gun with a burst or automatic mode."; return true; }
    cui.mode = cui.mode === "suppress" ? "move" : "suppress";
    cui.msg = cui.mode === "suppress" ? "Click an enemy or a spot to suppress: the cone shows who keeps their head down." : "";
    return true;
  }
  if (v === "throwspear") {
    if (!spearOf(u)) { cui.msg = "Only a spear can be thrown."; return true; }
    cui.mode = cui.mode === "throwspear" ? "move" : "throwspear";
    cui.msg = cui.mode === "throwspear" ? `Click a tile up to ${spearRange(u)} away to throw the ${u.weaponName}.` : "";
    return true;
  }
  if (v === "pickspear") { act(state, { type: "pickspear", unit: u.id }); return true; }
  // A launcher (sim/launchers.js): Launch toggles the targeting mode; an empty one is reloaded instead.
  if (v === "launch") {
    if (!u.gl) { cui.msg = "No grenade launcher or rocket: an M79, M32, AT4 or RPG in the hands or carried, or an M203 under the rifle."; return true; }
    if (u.gl.mag < 1 && !u.gl.oneShot) { act(state, { type: "glreload", unit: u.id, ammo: cui.glPick[u.id] || null }); return true; }
    cui.mode = cui.mode === "launch" ? "move" : "launch";
    cui.msg = cui.mode === "launch" ? `Click where to fire the ${glName(u.gl)} (${u.gl.cal === "rocket" ? "a tile it sees" : u.gl.load === "buck" ? "an enemy" : "a tile someone of yours sees"}). The red ring: too close to arm.` : "";
    return true;
  }
  if (v === "glreload") { if (u.gl) act(state, { type: "glreload", unit: u.id, ammo: cui.glPick[u.id] || null }); return true; }
  if (v === "glround") {
    const loads = u.gl ? glLoads(b, u) : [];
    if (loads.length < 2) { cui.msg = "Only one kind of round for the launcher to hand."; return true; }
    const cur = cui.glPick[u.id] || u.gl.load;
    const nx = loads[(loads.findIndex((x) => x.type === cur) + 1) % loads.length];
    cui.glPick[u.id] = nx.type;
    cui.msg = `The launcher's next reload: ${roundLabel(nx.type)} (${nx.n} to hand).`;
    return true;
  }
  if (v === "ammoclose") { cui.ammoAsk = null; return true; }
  if (v === "getshells") { act(state, { type: "getshells", unit: u.id }); return true; } // sim/mags.js SHELLS: a shotgun's shells out of the pack
  if (v === "reload") {
    if (d.k) { act(state, { type: "reload", unit: u.id, ammo: d.k }); return true; }
    const list = ammoToHand(state, b, u);
    if (list.length < 2) return false; // one kind (or none): a plain reload
    if (cui.ammoAsk === u.id) { act(state, { type: "reload", unit: u.id, ammo: cui.ammoPick[u.id] || loadOf(u) }); return true; }
    cui.ammoAsk = u.id;
    if (!list.some((x) => x.type === cui.ammoPick[u.id])) cui.ammoPick[u.id] = list.some((x) => x.type === loadOf(u)) ? loadOf(u) : list[0].type;
    cui.msg = "Reload with which round? Pick one below, or press I again for the one marked.";
    return true;
  }
  if (v === "ammocycle") {
    const list = ammoToHand(state, b, u);
    if (list.length < 2) { cui.msg = list.length ? `Only ${list[0].name} to hand for the ${u.weaponName}.` : "No other rounds for this gun to hand."; return true; }
    const cur = cui.ammoAsk === u.id ? cui.ammoPick[u.id] || loadOf(u) : loadOf(u);
    const i = list.findIndex((x) => x.type === cur);
    const nx = list[(i + 1) % list.length];
    cui.ammoAsk = u.id;
    cui.ammoPick[u.id] = nx.type;
    cui.msg = `Next reload: ${nx.name} (${nx.n} to hand). Press I to load it.`;
    return true;
  }
  return false;
}

// The cells a targeting mode covers: 1 in reach / in the cone, 2 the target cell. Suppress: a cone of ±25° from the
// unit toward the hovered cell, out to 2 tiles past it (14 at most), on cells your people can see (the sim's
// suppressCone when it has one); throw spear: every seen cell within its range.
export function aimArea(b, u, vis, h, mode) {
  const w = b.w, hgt = b.h;
  const band = new Uint8Array(w * hgt);
  if (!u) return band;
  if (mode === "launch") return launchArea(b, u, vis, h, band);
  if (mode === "throwspear") {
    const r = spearRange(u);
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      if ((x === u.x && y === u.y) || !vis[y * w + x]) continue;
      if (Math.hypot(x - u.x, y - u.y) <= r + 0.25) band[y * w + x] = 1;
    }
    if (h && band[h.y * w + h.x]) band[h.y * w + h.x] = 2;
    return band;
  }
  if (mode !== "suppress" || !h || (h.x === u.x && h.y === u.y)) return band;
  if (typeof SIM.suppressCone === "function") {
    for (const c of SIM.suppressCone(b, u, h.x, h.y) || []) { const [x, y] = Array.isArray(c) ? c : [c.x, c.y]; if (x >= 0 && y >= 0 && x < w && y < hgt) band[y * w + x] = 1; }
  } else {
    const ang = Math.atan2(h.y - u.y, h.x - u.x), reach = Math.min(14, Math.hypot(h.x - u.x, h.y - u.y) + 2);
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
      if ((x === u.x && y === u.y) || !vis[y * w + x]) continue;
      const d = Math.hypot(x - u.x, y - u.y);
      if (d > reach) continue;
      let da = Math.abs(Math.atan2(y - u.y, x - u.x) - ang);
      if (da > Math.PI) da = 2 * Math.PI - da;
      if (da <= (25 * Math.PI) / 180 || d < 1.5) band[y * w + x] = 1;
    }
  }
  band[h.y * w + h.x] = 2;
  return band;
}
// A launcher's targeting (sim/launchers.js): 1 in reach, 3 too close to arm (the red ring), 4 the backblast cone, 5
// the hovered spot's blast, 2 the hovered spot. vis: the cells your side sees.
function launchArea(b, u, vis, h, band) {
  const g = u.gl;
  if (!g) return band;
  const w = b.w, hgt = b.h;
  const range = g.load === "buck" ? LAUNCH.BUCK.range : glRange(g);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    if (x === u.x && y === u.y) continue;
    const d = Math.hypot(x - u.x, y - u.y);
    if (d > range + 0.25) continue;
    if (d < LAUNCH.ARM && (g.load === "he" || g.cal === "rocket")) band[y * w + x] = 3;
    else if (vis[y * w + x]) band[y * w + x] = 1;
  }
  if (h && !(h.x === u.x && h.y === u.y)) {
    const blast = g.cal === "rocket" ? ROCKET : g.load === "he" ? GL_HE : null;
    if (blast && Math.hypot(h.x - u.x, h.y - u.y) >= LAUNCH.ARM) for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - h.x, y - h.y) <= blast.r + 1e-6 && band[y * w + x] !== 3) band[y * w + x] = 5;
    if (g.cal === "rocket") for (const [x, y] of backblastCells(b, u, h.x, h.y)) band[y * w + x] = 4;
    band[h.y * w + h.x] = 2;
  }
  return band;
}
const LAUNCH_FILL = { 1: "rgba(140,200,255,0.12)", 2: "rgba(255,120,60,0.45)", 3: "rgba(255,60,60,0.22)", 4: "rgba(255,160,40,0.35)", 5: "rgba(255,120,60,0.25)" };
// The fill of a targeting band's cell (suppress, throw spear: one colour; launch: by its meaning).
const aimFill = (mode, k) => (mode === "launch" ? LAUNCH_FILL[k] || "rgba(0,0,0,0)" : mode === "suppress" ? "rgba(255,140,60,0.22)" : "rgba(140,200,255,0.16)");
function launchPreview(b, u, h) {
  const g = u.gl;
  if (!g) return "";
  const why = launchRefusal(b, u, h.x, h.y);
  const d = Math.hypot(h.x - u.x, h.y - u.y);
  if (why) return `<span class="warn">${esc(why)}</span>`;
  const dud = d < LAUNCH.ARM && (g.load === "he" || g.cal === "rocket");
  const blast = g.cal === "rocket" ? ROCKET : GL_HE;
  const caught = b.units.filter((t) => active(t) && !t.off && Math.hypot(t.x - h.x, t.y - h.y) <= blast.r + 1e-6);
  const mine = caught.filter((t) => t.side === "player"), theirs = caught.filter((t) => t.side !== "player");
  const behind = g.cal === "rocket" ? b.units.filter((t) => t !== u && t.side === "player" && active(t) && backblastCells(b, u, h.x, h.y).some(([x, y]) => x === t.x && y === t.y)) : [];
  const parts = [];
  if (dud) parts.push(`<span class="warn">Too close: it will not arm (${LAUNCH.DUD.join("–")} on whoever is on the spot, no blast).</span>`);
  else if (g.load === "he" || g.cal === "rocket") parts.push(`${theirs.length ? `catches ${theirs.length} of them` : "nobody of theirs in the blast"}${mine.length ? ` · <span class="danger">and ${mine.length} of yours!</span>` : ""}`);
  if (behind.length) parts.push(`<span class="danger">backblast on ${behind.map((t) => esc(t.name)).join(", ")}</span>`);
  if (g.cal === "rocket" && enclosedAt(b, u.x, u.y)) parts.push('<span class="danger">fired inside: the backblast hurts the shooter (and costs an action next turn)</span>');
  return `<b>Fire the ${esc(glName(g))}</b> here (${Math.round(d)} tiles): ${parts.join(" · ")} <span class="muted">Click to fire (ends the turn${g.cal === "rocket" ? "" : "; a tile off now and then"}).</span>`;
}
function aimPreview(b, u, h) {
  if (cui.mode === "launch") return launchPreview(b, u, h);
  const v = view(b);
  const band = aimArea(b, u, v.vis, h, cui.mode);
  if (cui.mode === "throwspear") return band[h.y * b.w + h.x] ? `<b>Throw the ${esc(u.weaponName)}</b> here (1 action). <span class="muted">Range ${spearRange(u)}; it lands on this tile.</span>` : `<span class="warn">Out of reach: a spear flies ${spearRange(u)} tiles at most.</span>`;
  const living = b.units.filter((t) => t.side === "enemy" && active(t) && v.seen.has(t.id) && band[t.y * b.w + t.x]);
  const people = living.filter((t) => t.kind !== "zombie");
  return `<b>Suppress</b>: ${people.length ? `${people.length} in the cone keep${people.length === 1 ? "s" : ""} their head down (−20 aim, no overwatch until their turn ends)` : "nobody living in the cone"}${living.length > people.length ? ` · <span class="muted">the dead do not care</span>` : ""}. <span class="muted">Click to fire (1 action, a stream of rounds).</span>`;
}

// The Help paragraph (ui/ui.js helpText), with the keys as they are bound now.
export function BATTLE_GUNS_HELP() {
  const k = (id, def) => `<b>${esc(keyLabel(id, 1) || def)}</b>`;
  return `<b>Fire modes, jams and suppressing fire:</b> automatic guns have fire modes, switched with <i>Fire</i> (${k("battle.firemode", "Shift+F")}, free): single (1 round, the best aim), burst (2–3 rounds, each its own roll) and auto (10–15 rounds, worse aim). A gun can jam: its line says JAMMED and <i>Unjam</i> (${k("battle.unjam", "Shift+J")}) clears it (1 or 2 actions; a Reload clears a double feed); revolvers and bolt, lever, pump and double guns misfire instead (the round is lost). <i>Suppress</i> (${k("battle.suppress", "Shift+O")}) fires a stream at an enemy or a spot: everyone living in the cone shown on the map keeps their head down until their turn ends (−20 aim, no overwatch); the dead do not care. A spear can be thrown (${k("battle.throwspear", "Shift+G")}, 4–5 tiles); walk onto it or <i>Pick up spear</i> from next to it (${k("battle.pickspear", "Shift+P")}, 1 action), and after a won fight it comes back anyway. <i>Overwatch</i> reacts to every enemy that moves in range until your next turn or the magazine runs dry. When more than one kind of round for a gun is to hand, Reload asks which (${k("battle.ammocycle", "Shift+I")} picks the next). You see an enemy's gun and its parts, never what it is loaded with: you learn that from what it does.`;
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

// The view's keys (by the key table, ui/keymap.js "battle"; these are the defaults): PageUp / PageDown change the
// floor in a building with storeys; , and . turn the view, + and − zoom, V centers on the selected unit, B shows or
// hides the roofs, W A S D or the arrow keys pan (held: iso.keys holds the direction, ui/isoview.js).
const PAN_DIR = { "bview.panUp": "ArrowUp", "bview.panDown": "ArrowDown", "bview.panLeft": "ArrowLeft", "bview.panRight": "ArrowRight" };
function viewKey(state, b, e, k) {
  if (k === "bview.floorUp" || k === "bview.floorDown") {
    if (!floorsOf(b)) return false;
    const up = k === "bview.floorUp";
    if (!setViewFloor(b, floorNo(b) + (up ? 1 : -1))) cui.msg = up ? "This is the top floor." : "This is the ground floor.";
    return true;
  }
  if (PAN_DIR[k]) { iso.keys.add(PAN_DIR[k]); return true; }
  if (k === "bview.rotLeft" || k === "bview.rotRight") { isoRotate(b, k === "bview.rotRight" ? 1 : -1); return true; }
  if (k === "bview.zoomIn" || k === "bview.zoomOut") { isoZoom(b, k === "bview.zoomIn" ? 1 : -1); return true; }
  if (k === "bview.roofs") { setRoofs(!iso.roofs); return true; }
  if (k === "bview.center") { const u = selUnit(b); if (u) isoCenterOn(b, u.x, u.y); return true; }
  return false;
}
// A pan key let go: whatever modifiers are down now, the direction it held stops.
export function combatKeyUp(state, e) {
  for (const id of actionsOfCode(e.code, "battle")) if (PAN_DIR[id]) iso.keys.delete(PAN_DIR[id]);
}

export function combatKey(state, e) {
  const b = state.combat;
  if (!b) return false;
  sync(b);
  const k = keyAction(e, "battle"); // ui/keymap.js
  if (viewKey(state, b, e, k)) return true;
  const confirm = k === "battle.confirm", space = k === "battle.endTurn";
  if (b.over) {
    if (confirm || space) { closeCombat(state); return true; }
    return false;
  }
  // Deploy step: Enter starts the fight (Space only says so: it is too easy to press by habit here).
  if (b.phase === "deploy") {
    if (b.drill) { if (confirm || space) cui.msg = "A drill: place your people, then Save as plan, or Close the drill."; return confirm || space; } // a base drill (no fight to start)
    if (confirm) { act(state, { type: "start" }); return true; }
    if (space) { cui.msg = `Place your defenders, then press ${keyLabel("battle.confirm", 1) || "Enter"} or Start the fight.`; return true; }
  }
  const team = players(b).filter((u) => alive(u)); // on any floor: the view follows (followFloor)
  if (k === "battle.next" || k === "battle.prev") {
    const ready = team.filter((u) => u.ap > 0);
    const list = ready.length ? ready : team;
    const i = list.findIndex((u) => u.id === cui.sel);
    if (list.length) cui.sel = list[(i + (k === "battle.prev" ? list.length - 1 : 1)) % list.length].id;
    cui.mode = "move";
    follow(b);
    return true;
  }
  const un = /^battle\.unit([1-9])$/.exec(k || "");
  if (un) {
    const u = players(b)[Number(un[1]) - 1];
    if (u && alive(u)) { cui.sel = u.id; cui.mode = "move"; follow(b); }
    return true;
  }
  // The retreat confirm: Enter gives the order, Space does nothing (too easy to press by habit), Esc closes it.
  if (retreatAskOpen(b) && confirm) { combatAction(state, "cb-retreat", { v: "go" }); return true; }
  if (retreatAskOpen(b) && space) { cui.msg = `Press ${keyLabel("battle.confirm", 1) || "Enter"} or Sound the retreat to give the order, Esc to keep fighting.`; return true; }
  if (fallAskOpen(b) && confirm) { combatAction(state, "cb-fallback", { v: "go" }); return true; }
  if (space || confirm) { requestEndTurn(state, space ? "space" : "enter"); return true; }
  if (e.code === "Escape") { cui.mode = "move"; cui.msg = ""; cui.endAsk = null; cui.retreatAsk = null; cui.fallAsk = null; cui.dragId = null; return true; }
  if (k === "battle.autoplay") { combatAction(state, "cb-autoplay", {}); return true; } // the AI plays your side
  if (b.phase === "deploy") return false;
  if (k === "battle.retreatAll") { combatAction(state, b.tier && b.tier.map === "wall" ? "cb-fallback" : "cb-retreat", { v: "ask" }); return true; }
  if (k === "battle.clear") { combatAction(state, "cb-clear", {}); return true; } // the area is clear enough (sim/battlesize.js)
  // The unit's orders (shoot, melee…; search, a quick rummage (sim/search.js, raids only) and drag are on Shift: W A S D pan).
  const o = k && KEY_BY_ID.get(k);
  if (o && o.v && (o.v !== "quick" || b.raid)) { combatAction(state, "cb-act", { v: o.v }); return true; }
  return false;
}

// Panel buttons (data-action="cb-…").
export function combatAction(state, key, d) {
  const b = state.combat;
  if (!b) return;
  sync(b);
  const u = selUnit(b);
  if (key === "cb-close") return void closeCombat(state, { take: d.take !== "0" });
  if (key === "cb-volorder") { const err = combatAct(state, { type: "volOrder", unit: Number(d.id), order: d.v, target: u ? u.id : null }); cui.msg = err || ""; return; } // sim/combat.js volOrder: Free, Hold here, Follow the selected one
  // The view bar (ui/isoview.js).
  if (key === "cb-view") {
    if (d.v === "rotl" || d.v === "rotr") isoRotate(b, d.v === "rotr" ? 1 : -1);
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
  // The AI plays your side from here on (combatTick), or you take back control.
  if (key === "cb-autoplay") {
    if (b.over || b.drill) return; // a drill has nothing to play
    cui.autoPlay = !cui.autoPlay;
    cui.lastStep = 0;
    cui.msg = cui.autoPlay ? "The AI is playing your side. Shift+A or Take back control to play again." : "Your side is yours again.";
    return;
  }
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
  if (key === "cb-sel") { cui.sel = Number(d.id); cui.pickedDown = cui.sel; cui.mode = "move"; cui.msg = ""; follow(b); return; }
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
    if (d.v === "plan" || d.v === "savePlan" || d.v === "endDrill" || d.v === "newPlan" || d.v === "deletePlan") return void act(state, { type: d.v }); // sim/defenceplan.js
    if (d.v === "roles") return void act(state, { type: "roles", by: d.z }); // every post by role / by name
    if (d.v === "role" && u) return void act(state, { type: "role", unit: u.id, role: d.z || null }); // the selected one's post
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
  if (typeof v === "string" && v.startsWith("rescue:")) return void act(state, { type: "rescue", unit: u.id, op: v.slice(7) }); // sim/rescueraid.js
  if (groundCbAct(state, b, u, v, cui, act)) return; // ui/ground.js: Search a body (a field battle), Ground
  if (v === "search" && b.raid) return void openSearch(state, b, u, null, { full: true });
  if (v === "quick" && b.raid) return void openSearch(state, b, u, null, { quick: true }); // sim/search.js: the rummage
  if (v === "evac" || v === "evacStop") return void act(state, { type: v }); // sim/combat.js evacTurn: everyone to the way out
  if (v === "cab") return void act(state, { type: "cab", unit: u.id }); // sim/combat.js fireCab: their vehicle's cab and hull
  if (v === "board" || v === "disembark" || v === "turn" || v === "gunner") return void act(state, { type: v, unit: u.id }); // sim/combat.js boardVehicle / disembark / turnVehicle / manTurret
  if (v === "drive") { // sim/combat.js driveTo: pick where it goes
    if (!b.vehicle) { cui.msg = "You came on foot: there is no vehicle here."; return; }
    if (!u.aboard && !atVehicle(b, u)) { cui.msg = "Stand next to the vehicle (or get in) to drive it."; return; }
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
  if (nlCbAct(state, b, u, v, cui, act)) return; // tasers, pepper spray, pulled blows, Execute, Surrender, Take them alive (ui/nonlethal.js)
  // The stealth kit (sim/stealth.js).
  if (v === "subdue") {
    const near = b.units.filter((t) => canSubdue(u, t, b));
    if (near.length === 1) return void act(state, { type: "subdue", unit: u.id, target: near[0].id });
    cui.mode = cui.mode === "subdue" ? "move" : "subdue";
    cui.msg = near.length ? "Click the person next to you to subdue." : "Subdue needs a person right next to you.";
    return;
  }
  if (v === "tie") {
    const ko = b.units.filter((t) => t.side === "enemy" && heldDown(t) && !t.tied && !t.fled && adjacent(u, t)); // sim/stealth.js heldDown: out cold, hands up, down
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
    cui.msg = `Click a tile up to ${THROWABLES[k].range} away to throw ${THROWABLES[k].label}.${k === "flashbang" ? " The lit cells are the ones its flash reaches (bright: within a tile, two actions lost)." : ""}`;
    return;
  }
  if (v === "drag") {
    // One Drag (Shift+D): a downed teammate is taken hold of and dragged along (sim/medics.js: half speed, no shooting,
    // Shift+D again puts them down); a body or a prisoner is pulled up to STEALTH.DRAG tiles (sim/stealth.js).
    if (dragging(b, u)) return void act(state, { type: "dropAlly", unit: u.id });
    const mates = allSide(b).filter((o) => o.down && !o.dead && !o.left && !o.off && !o.surr && o.draggedBy == null && adjacent(u, o));
    const others = b.units.filter((o) => o.side !== "player" && adjacent(u, o) && dragable(o) && !o.left && !o.fled);
    if (mates.length === 1 && !others.length) return void act(state, { type: "dragAlly", unit: u.id, target: mates[0].id });
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
    if (!seen.length) { cui.msg = !isRanged(u) ? "Double tap needs a gun: crush the skull from next to the body instead (U)." : !canFire(b, u) ? (magEmpty(b, u) && !reloadRefusal(b, u) ? "Double tap needs a loaded gun: reload first (I)." : "Double tap needs a gun with ammo (a bow with arrows) and free hands.") : "No body in sight that could still get up."; return; }
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
  if (v === "dropCarried" || v === "dropAllCarried" || v === "pickCarried") return void act(state, { type: v, unit: u.id }); // sim/carry.js
  // A building's doors (sim/buildingmaps.js): with one door next to the unit act at once, else click the door.
  if (v === "peek" || v === "close" || v === "brace") {
    const list = v === "peek" ? peekOptions(b, u) : v === "close" ? closeOptions(b, u) : braceOptions(b, u);
    if (list.length === 1) return void act(state, { type: v, unit: u.id, x: list[0].x, y: list[0].y });
    if (!list.length) { cui.msg = v === "peek" ? "Stand right next to a door or doorway to peek through it." : v === "close" ? "Stand next to an open door with nobody in the doorway." : "Stand next to a closed door to brace it."; return; }
    cui.mode = cui.mode === v ? "move" : v;
    cui.msg = `Click the door to ${v === "peek" ? "peek through" : v}.`;
    return;
  }
  // sim/medics.js: Heal, Revive, Drag ally / Put down / Into the vehicle, Finish.
  if (v === "heal") {
    const near = allSide(b).filter((o) => o !== u && active(o) && adjacent(u, o) && o.hp < o.maxHp);
    if (!near.length) return void act(state, { type: "heal", unit: u.id, target: u.id });
    cui.mode = cui.mode === "heal" ? "move" : "heal";
    cui.msg = cui.mode === "heal" ? "Click yourself or a hurt teammate next to you to treat." : "";
    return;
  }
  if (v === "revive") {
    const near = allSide(b).filter((o) => o.down && !o.dead && !o.left && !o.off && adjacent(u, o));
    if (!near.length) { cui.msg = reviveRefusal(b, u, null) || "Revive needs a downed teammate next to you."; return; }
    if (near.length === 1) return void act(state, { type: "revive", unit: u.id, target: near[0].id });
    cui.mode = cui.mode === "revive" ? "move" : "revive";
    cui.msg = cui.mode === "revive" ? "Click the downed teammate to revive." : "";
    return;
  }
  if (v === "dragAlly") {
    if (dragging(b, u)) return void act(state, { type: "dropAlly", unit: u.id });
    const near = allSide(b).filter((o) => o.down && !o.dead && !o.left && !o.off && o.draggedBy == null && adjacent(u, o));
    if (!near.length) { cui.msg = "Drag ally needs a downed teammate right next to you."; return; }
    if (near.length === 1) return void act(state, { type: "dragAlly", unit: u.id, target: near[0].id });
    cui.mode = cui.mode === "dragAlly" ? "move" : "dragAlly";
    cui.msg = cui.mode === "dragAlly" ? "Click the downed teammate to drag." : "";
    return;
  }
  if (v === "dropVehicle") return void act(state, { type: "dropAlly", unit: u.id, into: "vehicle" });
  if (v === "finish") {
    const foes = b.units.filter((t) => t.side === "enemy" && t.down && !t.dead && !t.off && playerSees(b, t) && !finishRefusal(b, u, t));
    if (!foes.length) { cui.msg = "Finish needs a downed enemy next to you, or one in sight with a loaded gun."; return; }
    if (foes.length === 1) return void act(state, { type: "finish", unit: u.id, target: foes[0].id });
    cui.mode = cui.mode === "finish" ? "move" : "finish";
    cui.msg = cui.mode === "finish" ? "Click the downed enemy to finish (dead for good)." : "";
    return;
  }
  if (v === "meds") {
    const others = allSide(b).filter((o) => o !== u && !o.dead && !o.left && adjacent(u, o) && (o.down ? !o.stab : o.hp < o.maxHp));
    if (!others.length) return void act(state, { type: "meds", unit: u.id, target: u.id });
    cui.mode = "meds";
    cui.msg = "Click yourself or an adjacent teammate to treat.";
    return;
  }
  if (gunOrder(state, b, u, v, d)) return; // fire mode, unjam, suppress, throw spear, the ammo a reload takes
  act(state, { type: v, unit: u.id });
}

// Enemy phase plays out one unit at a time so the player can follow it. Returns true when the panel needs a refresh.
export function combatTick(state, now) {
  const b = state.combat;
  if (!b) return false;
  sync(b);
  if (isRedeploy(b) && cui.autoRedeploy) { act(state, { type: "start" }); return true; }
  // The AI plays your side (cb-autoplay): your turn (and a deploy step) at the enemy turn's pace, until you take back
  // control. It may sound the retreat from a fight it judges lost, as the autopilot does.
  if (cui.autoPlay && !b.over && (b.phase === "player" || b.phase === "deploy")) {
    if (now - cui.lastStep < ENEMY_STEP_MS) return false;
    cui.lastStep = now;
    cui.endAsk = cui.retreatAsk = cui.fallAsk = null;
    cui.mode = "move";
    SIM.autoPlayerTurn(state);
    ingestMarks(b, now);
    cui.sel = null;
    if (state.combat === b && b.phase === "player") autoSelect(b);
    return true;
  }
  if (b.over || b.phase !== "enemy") return false;
  if (now - cui.lastStep < ENEMY_STEP_MS) return false;
  cui.lastStep = now;
  // Skip quickly past enemies the player cannot see doing nothing visible.
  for (let i = 0; i < 30 && b.phase === "enemy" && !b.over; i++) {
    const before = b.fxSeq;
    const u = enemyStep(state);
    ingestMarks(b, now);
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
  html += b.drill ? `<div class="cbhead"><div class="cbtitle">Defence drill at ${esc(((state.bases.find((x) => x.id === b.setup.baseId)) || {}).name || b.place)}</div>
    <div class="small muted">Nobody to fight: place your people where they should stand when this base is attacked, then Save as plan. The clock stands still.</div></div>` : b.raid ? raidHead(state, b, phase) : `<div class="cbhead">
    <div class="cbtitle">Battle at ${esc(b.place)}</div>
    <div class="small muted">Against ${esc(e.name || e.kind)} · Turn ${b.turn} · ${phase}</div>
    <div class="small cbsupply"><span data-tip="Rounds carried, every calibre: each gun fires only rounds of its own calibre and loaded type (Reload with another type switches it). Each shot uses 1 (assault rifle bursts use 2). Each gun also holds a magazine that Reload (1 action) fills from this; a magazine never counts more rounds than are left here. With no ammo your people can only fight in melee. Bows and crossbows shoot arrows instead.">Ammo <b>${Math.floor(ammoLeft(b))}</b></span>
      ${arrowsChip(b)}
      <span data-tip="Meds carried. One treats a wound or stabilizes someone who is down.">Meds <b>${Math.floor(medsLeft(b))}</b></span>
      ${b.infection >= 0.1 ? `<span class="warn" data-tip="This area is infected. Gunfire draws more of the dead from the map edge.">Infected ${Math.round(b.infection * 100)}%</span>` : ""}</div>
    ${tierHtml(b)}
  </div>`;

  html += `<h3>Your team</h3><div class="cbroster">`;
  players(b).forEach((p, i) => {
    const status = p.roseAs != null ? "Turned: one of the dead" : p.burnt ? "Dead, burnt" : p.inVehicle ? "Dead, in the car" : p.carriedBy != null ? "Dead, carried" : p.crushed ? "Dead, will not get up" : imminent(b, p) ? "Dead: a Carrier is on them, crush the skull (U) or shoot (J)" : endangered(b, p) ? "Dead: a Carrier is near" : p.dead ? "Dead" : p.left ? "Got away" : p.down ? (nlStatus(b, p) || (p.stab ? "Down, stabilized" : `Down, bleeding out (${p.bleed})${selfNote(b, p)}`)) + (p.draggedBy != null ? `, dragged by ${(unitById(b, p.draggedBy) || {}).name || "someone"}` : "") :
      [p.tied && !p.down && p.captive ? "Tied up (captive)" : p.captive && !p.tied ? "Freed captive" : "", nlStatus(b, p), ...earStatus(p), p.late ? (b.tier && b.tier.map === "wall" ? "Not on watch: at the back, out after the attackers move" : "Not on watch: in the buildings, out after the attackers move") : "", p.jam ? "JAMMED" : "", p.stun ? cap1(stunLabel(p.stun)) : "", p.ow ? "Overwatch" : "", p.suppressed > 0 ? "Suppressed" : "", p.spearOut ? "Spear thrown" : "", p.hunker ? "Hunkered" : "", p.dragging != null ? `Dragging ${(unitById(b, p.dragging) || {}).name || "someone"}` : "", handsBusy(p) ? `Hands full (${armsText(p)})` : "", p.shaken ? `Shaken (−${MEDIC.REVIVE.SHAKEN} aim)` : "", evacAt(b, p.x, p.y) && b.evacCols ? "In evac zone" : ""].filter(Boolean).join(", ");
    const cls = ["cbunit", p.id === cui.sel ? "on" : "", !alive(p) ? "out" : p.ap === 0 ? "done" : ""].join(" ");
    const pips = alive(p) ? `<span class="ap">${"<i class=on></i>".repeat(p.ap)}${"<i></i>".repeat(2 - p.ap)}</span>` : "";
    // A building with storeys: everyone's floor (dimmer when it is not the one shown).
    const fl = floorsOf(b) && p.f != null ? ` <span class="cbfl${p.f === floorNo(b) ? "" : " off"}" data-tip="${esc(`${p.name.split(" ")[0]} is on ${floorLabel(b, p.f).toLowerCase()}${p.f === floorNo(b) ? " (shown)" : ": selecting them shows that floor"}.`)}">F${p.f + 1}</span>` : "";
    html += `<div class="${cls}" data-action="cb-sel" data-id="${p.id}" data-tip="${esc(`${p.name}. Weapon: ${p.weaponName}${hasMag(p) ? ` (${magLabel(b, p)} loaded)` : ""}. Aim ${Math.round(p.aim)}.${selfTip(b, p)} Press ${i + 1} or Tab to select.`)}">
      <div class="spread"><span>${spriteImg(canvasURL(unitCanvas(state, b, p, cui.salt)), 1.5)}<span class="muted">${i + 1}</span> <b>${esc(p.name)}</b>${medicBadge(p)}${p.sid != null && alive(p) ? statusIcons(state, state.survivors.find((s) => s.id === p.sid), { skip: ["health"] }) : ""}${fl}</span>${pips}</div>
      <div class="bar"><i style="width:${pct(p) * 100}%;background:${hpColor(pct(p))}"></i></div>
      <div class="small muted">${gunText(b, p)} · ${Math.round(p.hp)} hp${status ? ` · <span class="${p.down || p.dead ? "danger" : ""}">${status}</span>` : ""}${p.gunner ? ' · <span class="warn">on the turret</span>' : p.aboard ? ' · <span class="good">in the vehicle</span>' : ""}</div>
    </div>`;
  });
  html += `</div>`;
  // Volunteers from an allied group (sim/volunteers.js): on your side, not yours to order.
  const vols = allSide(b).filter((p) => p.vol != null);
  if (vols.length) {
    const watched = !!b.setup.watch;
    html += watched ? `<h3 data-tip="${esc("Your people lent to another group: you watch their fight; the group's AI moves them (and the group's own fighters), nobody takes your orders.")}">Your people with ${esc(b.setup.watch.group)} <span class="muted small">(you watch)</span></h3><div class="cbroster">`
      : `<h3 data-tip="${esc("Volunteers from an allied group: their own group's orders. They act on their own at the end of your turn, follow the Evac and the retreat, and leave with your people. Give one a simple order (Free, Hold here, Follow the one you have selected): they still act on their own within it.")}">Volunteers <span class="muted small">(their own orders)</span></h3><div class="cbroster">`;
    for (const p of vols) {
      const st = p.dead ? "Dead" : p.left ? "Got away" : p.down ? (p.stab ? "Down, stabilized" : `Down, bleeding out (${p.bleed})`) : [p.ow ? "Overwatch" : "", p.hunker ? "Hunkered" : "", p.jam ? "JAMMED" : ""].filter(Boolean).join(", ");
      html += `<div class="cbunit vol ${!alive(p) ? "out" : ""}" data-tip="${esc(`Volunteer from ${p.volGroup || "an allied group"}: their own orders. ${p.name}. Weapon: ${p.weaponName}.`)}">
      <div class="spread"><span>${spriteImg(canvasURL(unitCanvas(state, b, p, cui.salt)), 1.5)}<span class="vol-tag">VOL</span> <b style="color:${VOL_COLOR}">${esc(p.name)}</b></span><span class="small muted">${esc(p.volGroup || "")}</span></div>
      <div class="bar"><i style="width:${pct(p) * 100}%;background:${hpColor(pct(p))}"></i></div>
      <div class="small muted">${gunText(b, p)} · ${Math.round(p.hp)} hp${st ? ` · <span class="${p.down || p.dead ? "danger" : ""}">${st}</span>` : ""}</div>
      ${!watched && alive(p) && b.phase === "player" ? `<div class="row small volorders">${Object.entries(VOL_ORDERS).map(([k, l]) => `<button class="mini ${(p.volOrder || "free") === k ? "active" : ""}" data-action="cb-volorder" data-id="${p.id}" data-v="${k}" data-tip="${esc(k === "free" ? "Their own judgement (the default)" : k === "hold" ? "Stay where they are: shoot from there, else watch" : `Keep with the one you have selected${u && u.vol == null ? ` (${u.name})` : ""}: shoot from where they stand when there is a fair shot, else move up`)}"${k === "follow" && !(u && u.vol == null) ? " disabled" : ""}>${l}${k === "follow" && p.volOrder === "follow" && p.volLead != null ? ` ${esc(((unitById(b, p.volLead) || {}).name || "").split(" ")[0])}` : ""}</button>`).join("")}</div>` : ""}
    </div>`;
    }
    html += `</div>`;
  }

  if (b.over) return html + resultHtml(state, b);
  if (b.phase === "deploy") return html + deployPanel(state, b, u);
  if (b.raid && b.raid.choose) html += chooseHtml(b);
  if (retreatAskOpen(b)) html += retreatConfirmHtml(b, askPlan(b)); // right under the team, where it is seen
  // Looking at another floor than the selected unit's (PageUp / PageDown, the Floor control): say so, with the way back.
  if (u && alive(u) && floorsOf(b) && u.f != null && u.f !== floorNo(b)) {
    html += `<div class="small muted cbmsg">Showing ${floorLabel(b, floorNo(b)).toLowerCase()}; ${esc(u.name.split(" ")[0])} is on ${floorLabel(b, u.f).toLowerCase()}. <button class="mini" data-action="cb-view" data-v="fgo" data-tip="Back to the selected unit's floor (V also centers on them).">Go to ${esc(u.name.split(" ")[0])}</button></div>`;
  }

  if (u && u.tied && !u.dead && b.phase === "player") { // a captive still tied up on a rescue raid (sim/rescueraid.js)
    const btn = (v, label, tip, ok, key) => `<button class="${cui.mode === v ? "active" : ""}" data-action="cb-act" data-v="${v}" ${ok ? "" : "disabled"} data-tip="${esc(tip)}">${label}${key ? ` <span class="key">${key}</span>` : ""}</button>`;
    html += `<h3>${esc(u.name)} · tied up · ${u.ap} action${u.ap === 1 ? "" : "s"}</h3><div class="cbactions">${rescueButtons(state, b, u, btn)}</div>`;
  } else if (u && u.side === "player" && u.down && !u.dead && !u.left && b.phase === "player") { // sim/medics.js: down, a tourniquet or a trauma kit in reach
    html += selfStabHtml(b, u);
  } else if (u && (active(u) || u.aboard) && b.phase === "player") { // aboard the vehicle: Drive, Turn, Get out, Extract
    const ap = u.ap;
    const gun = isRanged(u), ammo = canFire(b, u);
    const foesAdj = b.units.some((t) => t.side === "enemy" && active(t) && meleeReach(b, u, t)); // not across a wall's corner
    const btn = (v, label, tip, ok, key) => `<button class="${cui.mode === v ? "active" : ""}" data-action="cb-act" data-v="${v}" ${ok ? "" : "disabled"} data-tip="${esc(tip)}">${label}${key ? ` <span class="key">${key}</span>` : ""}</button>`;
    html += `<h3>${esc(u.name)} · ${ap} action${ap === 1 ? "" : "s"}</h3><div class="cbactions">
      ${btn("move", "Move", "Click a blue tile to move (1 action) or a yellow tile to dash (2 actions).", ap > 0)}
      ${b.evacOrder ? btn("evacStop", "Stop evac", "Call off the Evac: your people stay where they are and take orders again.", true) : btn("evac", "Evac", `Everyone still standing heads for the way out with the actions they have: ${b.raid ? "the extraction zones" : "the evac strip"}${b.vehicle ? ", or a free seat in the vehicle (in it counts as out)" : ""}, whichever is nearer. Arriving, they ${b.raid ? "extract" : "slip away"}${b.vehicle ? " or get in" : ""}. The order stands: each turn starts with the next leg until everyone is out or you call it off. The downed are not carried (Sound the retreat carries them).`, !evacRefusal(b))}
      ${btn("shoot", "Shoot", gun ? (ammo ? `Fire at a visible enemy. Ends this unit's turn. Hover an enemy to see the hit chance.${hasMag(u) ? ` ${esc(u.weaponName)}: ${magLabel(b, u)} loaded.` : ""}` : fireRefusal(b, u)) : "No usable gun.", ap > 0 && ammo, "F")}
      ${gun && SIM.cabTarget(b, u) ? (() => { const tg = SIM.cabTarget(b, u), o = SIM.cabOdds(b, u, tg), who = SIM.cabSeat(b, tg.v); return btn("cab", "Shoot the cab", `Fire at their ${esc(tg.v.name || tg.v.kind)} (${o.chance}% a round): each hit wears it (heavy and armour-piercing rounds; ${SIM.HULL.PEN + 1}+ penetration) and half get in at the windscreen${tg.v.up && tg.v.up.plating ? " (less with the plate)" : ""}, at ${who ? "whoever is at the wheel" : "nobody: the cab is empty"}${tg.v.up && tg.v.up.glass ? " through bulletproof glass" : ""}. A driver down stops it. Ends this unit's turn.`, ap > 0 && ammo); })() : ""}
      ${gun && hasMag(u) ? btn("reload", magEmpty(b, u) && !reloadRefusal(b, u) ? '<span class="danger">Reload</span>' : "Reload", `${esc(u.weaponName)} (${magLabel(b, u)} now). ${reloadText(b, u)}${reloadRefusal(b, u) ? ` ${reloadRefusal(b, u)}` : ""}${u.gunner ? " The turret's belt: both actions." : ""}${ammoToHand(state, b, u).length > 1 ? ` More than one kind of round for it is to hand: Reload asks which (${keyLabel("battle.ammocycle", 1) || "Shift+I"} picks the next).` : ""}`, ap >= (u.gunner ? TURRET.RELOAD_AP : 1) && (!reloadRefusal(b, u) || ammoToHand(state, b, u).length > 1) && !shellsInPack(b, u), "I") : ""}
      ${gun && isShellGun(u) && (shellsInPack(b, u) || !getShellsRefusal(b, u)) ? btn("getshells", shellsInPack(b, u) ? '<span class="danger">Get shells</span>' : "Get shells", `1 action: up to ${SHELLS.GRAB} shells out of the pack, loose at hand (pockets), ready to load. ${shellsLine(b, u)}.${getShellsRefusal(b, u) ? ` ${getShellsRefusal(b, u)}` : ""}`, ap >= 1 && !getShellsRefusal(b, u)) : ""}
      ${gunButtons(state, b, u, btn)}
      ${plateButton(state, b, u, btn)}
      ${btn("melee", "Melee", "Strike an adjacent enemy. Silent: it does not alert others or draw zombies. Ends the turn.", ap > 0 && foesAdj, "E")}
      ${btn("overwatch", "Overwatch", OVERWATCH_TIP, ap > 0 && ammo, "O")}
      ${btn("hunker", "Hunker down", `Ends the turn. +${COVER_DEF[1]} defense on top of cover until your next turn. Only helps when in cover.`, ap > 0, "H")}
      ${b.vehicle ? btn("drive", "Drive", `Both actions, from inside or next to the ${b.vehicle.kind === "truck" ? "truck" : "car"}: click where to drive it, up to ${DRIVE.RANGE} cells. It drives through people (anyone in the way is hit for ${RAMMING.HIT[0]}–${RAMMING.HIT[1]}, the dead ${RAMMING.ZOMBIE_HIT[0]}–${RAMMING.ZOMBIE_HIT[1]}, and shoved aside) and light obstacles (fences, crates, sandbags, barricades, tank traps: broken, at a cost to the vehicle's condition); walls, trees, other cars, water, railings and trenches stop it. Loud: the unaware within ${DRIVE.RADIUS} tiles hear the engine${b.raid ? `, Heat +${DRIVE.HEAT}` : ""}. Whoever is aboard rides along, the loot and the siege ram too; extract from a zone it stands at to keep it.`, ap >= DRIVE.AP && (u.aboard || atVehicle(b, u)), "V") : ""}
      ${b.vehicle && !u.aboard ? btn("board", "Get in", `1 action, from next to it: ride in the ${b.vehicle.kind} (${b.vehicle.seats || 4} seats, ${aboardCount(b)} aboard). Inside you are off the map (not a target, not drawn, no shooting) and can drive, turn, get out, or extract with it from a zone it stands at.`, ap > 0 && atVehicle(b, u) && aboardCount(b) < (b.vehicle.seats || 4)) : ""}
      ${u.aboard ? btn("disembark", "Get out", "1 action: out onto a free cell round the vehicle.", ap > 0) : ""}
      ${u.aboard && vehicleTurret(b) ? btn("gunner", u.gunner ? "Get down" : "Man the turret", u.gunner ? "1 action: off the turret and back down inside (not a target any more)." : `1 action: up behind the ${vehicleTurret(b) === "m2hb" ? "M2" : "machine gun"} on the roof. Then Shoot (F) fires it: a 3-round burst from its belt (${b.vehicle.belt ?? "full"}, a new belt is both actions) out of the team's ammo (${Math.floor(turretRounds(b))}), a level up, aim +6, through cover, very loud (it wakes the whole map${b.raid ? `, Heat +${TURRET.HEAT} a burst` : ""}), and whoever it lands near shoots −${TURRET.PIN} next turn. Overwatch works from it. After the vehicle drives or turns this turn the turret fires at −${RIDE.TURRET} (−${RIDE.DRIVER} for a gunner who turned it). The gunner is the one rider they can shoot: half cover${b.vehicle.up && b.vehicle.up.plating >= 2 ? " (full: plate ×2)" : " (full behind plate ×2)"}. Downed, they drop back inside.`, ap > 0, "⇧T") : ""}
      ${b.vehicle ? btn("turn", "Turn", "1 action, from inside or next to it: a quarter turn at the same corner (it needs open ground with nobody on it on the cells it turns onto).", ap > 0 && (u.aboard || atVehicle(b, u))) : ""}
      ${btn("meds", "Use meds", `1 action and 1 meds: heal yourself or an adjacent teammate, or stabilize someone who is down so they survive. With no meds left, someone down can still be stabilized by hand (${handsOdds(u)}%: pressure and a belt; it can be tried again).`, ap > 0 && (medsLeft(b) > 0 || players(b).some((o) => o.down && !o.dead && !o.left && !o.stab && adjacent(u, o))), "M")}
      ${medicButtons(state, b, u, btn)}
      ${floorButtons(b, u, btn)}
      ${bodyButtons(state, b, u, btn)}
      ${groundButtons(state, b, u, btn)}
      ${stealthButtons(state, b, u, btn)}
      ${nlButtons(state, b, u, btn, cui)}
      ${siegeButtons(b, u, btn)}
      ${b.evacCols ? btn("retreat", "Retreat", "This unit leaves the battle. Only from the green evac strip. A downed teammate lying on the strip is carried out with the last one to leave; anyone else who is down and left behind is lost. To pull everyone out at once, Sound the retreat (Shift+R).", ap > 0 && evacAt(b, u.x, u.y), "R") : ""}
      ${b.raid ? raidButtons(state, b, u, btn) + lockPanel(state, b, u) : ""}
      ${b.rescue ? rescueButtons(state, b, u, btn) : ""}
      ${carPanel(state, b, u)}
    </div>${ammoChooser(state, b, u)}`;
    html += nlAskHtml(b, cui); // Execute / Surrender: asked first (ui/nonlethal.js)
  } else if (b.phase === "enemy") html += `<h3>Enemy turn</h3><div class="small muted">Watch the map. Your turn comes next.</div>`;

  html += `<div id="cbprev" class="cbprev">${previewHtml(b, state)}</div>`;
  if (cui.msg) html += `<div class="small warn cbmsg">${esc(cui.msg)}</div>`;

  const v = view(b);
  const seen = [...b.units.filter((t) => v.seen.has(t.id)), ...b.units.filter((t) => t.side === "enemy" && t.down && !t.dead && !t.off && playerSees(b, t))]; // sim/medics.js: the downed too (Finish)
  if (seen.length && u && active(u)) {
    html += `<h3>Enemies in sight</h3><div class="cbtargets">`;
    for (const t of seen) {
      const o = odds(b, u, t);
      const tip = o ? `${t.name}: ${o.label}. Click to attack with ${u.name}.` : `${t.name}: ${u.name} cannot hit them from here.`;
      html += `<button class="cbtarget" data-action="cb-target" data-id="${t.id}" ${o && o.ok && b.phase === "player" && u.ap > 0 ? "" : "disabled"} data-tip="${esc(tip)}">
        <span>${spriteImg(canvasURL(unitCanvas(state, b, t, cui.salt)), 1.5)}${esc(t.name)}${t.down ? ` <span class="muted">(${t.surr ? "gave up" : "down"}${t.ko ? ", out cold" : t.surr ? "" : t.stab ? ", stabilized" : `, bleeding ${t.bleed || 0}`}${t.tied ? ", tied" : ""})</span>` : t.aware ? "" : ' <span class="warn">(unaware)</span>'}${t.kind === "human" && t.weaponName ? ` <span class="small muted">${esc(t.weaponName)}</span>` : ""}${t.stun ? ` <span class="good">(${esc(t.stun.dazed ? "dazed" : "stunned")})</span>` : ""}${t.jam ? ' <b class="danger">JAMMED</b>' : ""}${t.suppressed > 0 ? ' <span class="warn">suppressed</span>' : ""}${isMedic(t) && !t.down ? ' <span class="danger" data-tip="A medic: revives and drags their downed, heals the hurt.">✚</span>' : ""}</span><span class="small">${Math.round(t.hp)} hp${o && o.ok ? ` · <b>${o.chance}%</b>` : ""}</span></button>`;
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
    <button class="${cui.autoPlay ? "active" : ""}" data-action="cb-autoplay" data-tip="${esc(cui.autoPlay ? "Stop the AI: your side waits for your orders again from your next turn. (Shift+A)" : "Hand your side to the AI for the rest of the battle: it plays each of your turns (moves, shots, searches, the retreat if it judges the fight lost) while you watch. Take back control any time. (Shift+A)")}">${cui.autoPlay ? "✋ Take back control" : "🤖 AI plays my side"}</button>
    <button class="primary" data-action="cb-end" ${b.phase === "player" && !cui.autoPlay ? "" : "disabled"} data-tip="End your turn. Units with actions left do nothing.${cui.confirmEnd ? " While any unit still has actions, the first press asks; press again (or Enter) to end." : ""} (Space or Enter)">End turn</button>
    ${!b.raid && !b.acted && b.turn === 1 ? `<button data-action="cb-auto" data-tip="Skip the tactical battle and resolve it instantly by the numbers. Only before you act on turn 1.">Auto-resolve</button>` : ""}
    ${restartBtn(state, b)}
  </div>
  <div class="small muted" style="margin-top:0.3rem"><button class="${cui.confirmEnd ? "active" : ""}" data-action="cb-confirm" data-tip="When on, Space or End turn asks once while units still have actions (Enter always ends at once). Remembered in this browser.">${cui.confirmEnd ? "✔" : "✗"} Ask before ending a turn with actions left</button></div>`;
  return html;
}

// The view bar: turn, zoom, center, roofs; in a building with storeys the floor shown (`Floor 2 of 5 ▲ ▼`).
export function viewBar(b = cui.battle) {
  const btn = (v, label, tip, active = false) => `<button class="mini${active ? " active" : ""}" data-action="cb-view" data-v="${v}" data-tip="${esc(tip)}">${label}</button>`;
  let html = `<div class="cbview">`;
  html += btn("rotl", "⟲", "Turn the view a quarter to the left (,)") + btn("rotr", "⟳", "Turn the view a quarter to the right (.)");
  html += btn("zout", "−", "Zoom out (− or the mouse wheel)") + btn("zin", "+", "Zoom in (+ or the mouse wheel)");
  html += btn("center", "◎", "Center on the selected unit (V). Drag the map, hold W A S D or the arrow keys, or push the mouse to the edge to pan.");
  html += btn("roofs", iso.roofs ? "Roofs ✔" : "Roofs ✗", "Roofs on the buildings (B). A building with one of your people, an enemy you see or the mouse inside is always shown cut away; off shows every one that way.", iso.roofs);
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
  const left = R.containers.filter((c) => !c.searched && c.kind !== "body" && c.kind !== "ground").length;
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
      <span data-tip="Rounds carried, every calibre: each gun fires only rounds of its own calibre and loaded type (Reload with another type switches it). Each shot uses 1 (assault rifle bursts use 2). Reload (1 action) fills a gun's magazine from this. Bows and crossbows shoot arrows instead.">Ammo <b>${Math.floor(ammoLeft(b))}</b></span>
      ${arrowsChip(b)}
      <span data-tip="Meds carried. One treats a wound or stabilizes someone who is down.">Meds <b>${Math.floor(medsLeft(b))}</b></span>
      <span data-tip="Containers not yet searched">Left to search <b>${left}</b></span>
    </div>
    <div class="small muted" style="margin-top:0.3rem">${found.length ? `Found: ${esc(found.join(", "))}` : "Nothing found yet."}</div>
    ${sel && sel.side === "player" && active(sel) && quickable(searchableNear(b, sel)).length ? `<div class="small muted" style="margin-top:0.25rem" data-tip="${esc(`Shift+Q, no action (once a turn): heard ${quickRadius(b, sel)} tiles off, Heat +${SEARCH.quick.heat}. The cut costs a few health and needs dressing (meds); less likely with Scavenging or Stealth, more in the dark without a light.`)}">Quick search: shows ${Math.round(SEARCH.quick.reveal[0] * 100)}–${Math.round(SEARCH.quick.reveal[1] * 100)}%, loud, ${quickHurtPct(state, b, sel)} chance of cutting yourself</div>` : ""}
    ${(R.hasVehicle ?? R.vehicleZone >= 0) ? `<div class="small warn" style="margin-top:0.25rem" data-tip="Leave from another zone and the vehicle stays here, marked on the map. It can be driven (Drive) and extracts with whoever leaves from the zone it stands at.">${R.vehicleZone >= 0 ? "Your vehicle stands at an extraction zone. Extract there to keep it." : "Your vehicle stands away from the zones: drive it back to one before extracting, or it stays behind."}</div>` : ""}
    ${b.night ? `<div class="small warn" style="margin-top:0.25rem" data-tip="At night guards see ${STEALTH.NIGHT_SIGHT} tiles (the dead ${STEALTH.NIGHT_ZOMBIE_SIGHT}) and notice you from closer. Your people see ${STEALTH.NIGHT_SIGHT} too, more with a light, and the light is seen from further off: ${Object.values(LIGHTS).map((L) => `a ${L.name} ${L.sight} (+${L.seen})`).join(", ")}; all the way with night vision goggles. A headlamp works from anywhere on them; the others in the off hand. A quick rummage without a light is heard ${SEARCH.quick.dark} tiles further (a full search is 1 action either way).">Night raid: short sight both ways. ${players(b).filter((p) => p.light || p.nvg).length} of ${players(b).length} have a light or night vision.</div>` : ""}
    ${raidKeyLine(state, b)}
  </div>`;
}

function raidButtons(state, b, u, btn) {
  const near = searchableNear(b, u);
  const z = zoneAt(b, u.x, u.y);
  const zone = z >= 0 ? b.raid.zones[z] : null;
  // sim/search.js: the full search (1 action, everything shows) and the quick rummage (no action, part of it, loud).
  const sb = near.find((c) => !c.contents || c.quick) || near[0];
  const searchTip = sb ? `Search ${sb.label.toLowerCase()} (${!sb.contents || sb.quick ? `${SEARCH.ap} action` : "already searched: free"}${sb.quick ? ": it was only rummaged through, a full search turns up the rest" : ""}). Everything inside shows, quietly; pick what to take. ${sb.kind === "body" ? "" : areaHint(b.raid.areas[sb.area].type)}` : "Stand next to an unsearched container (yellow box marker) to search it.";
  const qb = quickable(near)[0];
  const Q = SEARCH.quick;
  const qWhy = quickRefusal(b, u, qb || near[0]);
  const quickTip = `Rummage in a hurry: no action (needs one left; once a turn), so it fits between two moves. Only ${Math.round(Q.reveal[0] * 100)}–${Math.round(Q.reveal[1] * 100)}% of what is inside turns up; a full search there later finds the rest. Loud: Heat +${Q.heat}, and the unaware dead and guards within ${quickRadius(b, u)} tiles come to look${b.raid.interior ? " (walls and closed doors muffle it)" : ""}${quickRadius(b, u) > Q.radius ? "; fumbling in the dark without a light carries further" : ""}. Hands going fast: ${quickHurtPct(state, b, u)} chance of cutting yourself (broken glass, a rusty can, a needle): a few health and a cut that needs dressing. Less with Scavenging or Stealth, more in the dark without a light.${qWhy ? ` ${qWhy}` : ""}`;
  const exTip = zone ? (zone.vehicle ? "Leave the raid in your vehicle. Everyone who extracts here keeps it." : (b.raid.hasVehicle ?? b.raid.vehicleZone >= 0) ? "Leave the raid on foot from here. If nobody extracts at the vehicle, it is left behind." : "Leave the raid from this zone.") :
    "Move into a green extraction zone first. Anyone still on the map when the last person leaves is lost.";
  const veh = b.raid.hasVehicle ?? b.raid.vehicleZone >= 0;
  const vehTip = atVehicle(b, u) ? "Free: open the vehicle. Drag what you carry into it to free your hands, or take things out." : "Walk to the vehicle (its zone, or next to it) to load or unload it.";
  let html = `${btn("search", "Search", searchTip, u.ap > 0 && near.length > 0, "⇧S")}${btn("quick", "Quick search", quickTip, !qWhy, "⇧Q")}${veh ? btn("vehicle", "Vehicle", vehTip, atVehicle(b, u), "N") : ""}${btn("extract", zone && zone.vehicle ? "Extract (vehicle)" : "Extract", exTip, u.ap > 0 && !!zone, "X")}`;
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
// ---------- medics (sim/medics.js) ----------
// Stabilizing oneself (sim/medics.js selfStabilize): the downed one's note in the roster, its tip, and their panel with
// the button (greyed with the reason when it cannot be tried).
const selfLabel = (u) => { const k = selfKit(u); return k ? `${k.key === "tourniquet" ? "Tourniquet" : k.name} ${selfOdds(u, k.key)}%` : ""; };
function selfNote(b, u) {
  const why = selfStabRefusal(b, u);
  if (!why) return `: can stabilize themselves (${selfLabel(u)})`;
  return u.selfTry === b.turn && !u.stab && selfKit(u) ? ", tried to stabilize themselves" : "";
}
function selfTip(b, u) {
  if (!u.down || u.dead || u.stab || u.ko || u.surr) return "";
  const k = selfKit(u);
  if (k) return ` Down with ${k.key === "tourniquet" ? "a tourniquet" : `the ${k.name.toLowerCase()}`} in reach: they can save themselves, ${selfOdds(u, k.key)}% a try (select them: Stabilize yourself), and try by themselves at the end of the turn.`;
  return u.selfPack ? ` Their ${u.selfPack.toLowerCase()} is in the pack: out of reach lying down.` : "";
}
function selfStabHtml(b, u) {
  const why = selfStabRefusal(b, u);
  const k = selfKit(u);
  const label = k ? `${k.key === "tourniquet" ? "Tourniquet" : esc(k.name)}: stabilize yourself (${selfOdds(u, k.key)}%)` : "Stabilize yourself";
  const R = MEDIC.SELF;
  const tip = `The one thing someone down can do, once a turn: stop their own bleeding with a tourniquet (${R.tourniquet.BASE}% + ${R.tourniquet.MED} a point of Medicine, at most ${R.tourniquet.MAX}%) or a field trauma kit (${R.traumakit.BASE}% + ${R.traumakit.MED}, at most ${R.traumakit.MAX}%) in the off hand, a pocket or a rig pouch (not the pack: out of reach lying down). Stopped: stabilized, still down (a medic gets them up), the item's use spent. Failed: nothing spent, try again next turn. Not tried by the end of the turn: they try by themselves.${why ? ` ${why}` : ""}`;
  const cond = u.stab ? "stabilized" : u.ko ? "out cold" : u.surr ? "gave up" : `bleeding out (${u.bleed} turn${u.bleed === 1 ? "" : "s"} left)`;
  return `<h3>${esc(u.name)} · down, ${cond}</h3><div class="cbactions"><button data-action="cb-act" data-v="selfStab" ${why ? "disabled" : ""} data-tip="${esc(tip)}">${label}</button></div>${why ? `<div class="small muted">${esc(why)}</div>` : ""}`;
}
// The roster's medic badge: a small cross, with the kit and its uses left.
function medicBadge(p) {
  if (!isMedic(p)) return "";
  const left = p.kitLeft === Infinity ? null : Math.max(0, p.kitLeft - (p.kitUses || 0));
  const tip = `Medic: ${p.medKit.name}${left == null ? "" : `, ${left} use${left === 1 ? "" : "s"} left`}, Medicine ${Math.round(p.medicine)}. Heal (${keyLabel("battle.heal", 1) || "Shift+H"}) and Revive (${keyLabel("battle.revive", 1) || "Shift+V"}).`;
  return ` <span class="good cbmedic" data-tip="${esc(tip)}">✚</span>`;
}
// Heal and Revive (a med kit makes a medic; Revive shown disabled with the reason without one), Drag ally / Put down /
// Into the vehicle, Finish a downed enemy.
function medicButtons(state, b, u, btn) {
  let html = "";
  const ap = u.ap;
  const medic = isMedic(u);
  const kitTip = medic ? `${u.name.split(" ")[0]}'s ${u.medKit.name}, Medicine ${Math.round(u.medicine)}` : "";
  if (medic) {
    const hurtNear = allSide(b).filter((o) => active(o) && (o === u || adjacent(u, o)) && o.hp < o.maxHp).sort((a, c) => a.hp - c.hp)[0];
    const why = hurtNear ? healRefusal(b, u, hurtNear) : "Nobody hurt next to them.";
    html += btn("heal", "Heal", `1 action, 1 meds and a use of the kit (${kitTip}): a medic's treatment, +${healAmount(u, hurtNear || u)} health on themselves or a teammate next to them (plain meds: less).${why ? ` ${why}` : ""}`, ap > 0 && !why, keyLabel("battle.heal", 1) || "Shift+H");
  }
  const downNear = allSide(b).filter((o) => o.down && !o.dead && !o.left && !o.off && adjacent(u, o));
  const anyDown = allSide(b).some((o) => o.down && !o.dead && !o.left && !o.off);
  if (medic || anyDown) {
    const t = downNear[0] || null;
    const why = reviveRefusal(b, u, t);
    const p = t && medic ? reviveOdds(u, t) : null;
    html += btn("revive", p != null ? `Revive ${p}%` : "Revive", `Both actions, 1 meds and a use of the kit: get a downed teammate next to them back on their feet, ${MEDIC.REVIVE.HP.map((x) => Math.round(x * 100)).join("–")}% health, acting from their next turn, shaken (−${MEDIC.REVIVE.SHAKEN} aim for the rest of the battle). ${MEDIC.REVIVE.BASE}% + ${MEDIC.REVIVE.MED} a point of Medicine + ${MEDIC.REVIVE.KIT} a point of the kit's bonus (+${MEDIC.REVIVE.STAB} if already stabilized), at most ${MEDIC.REVIVE.MAX}%. A failed try still stabilizes them. Only with a med kit (bandage, trauma or surgical) and meds: anyone else can stabilize (Use meds).${why ? ` ${why}` : ""}`, !why, keyLabel("battle.revive", 1) || "Shift+V");
  }
  const held = dragging(b, u);
  if (held) {
    html += btn("dragAlly", "Put down", `Free: lay ${held.name} down where they are, behind ${u.name.split(" ")[0]}. In cover, out of the line of fire, or on the evac strip (carried out with the last one to leave).`, true, keyLabel("battle.drag", 1) || "Shift+D");
    if (b.vehicle) {
      // sim/medics.js layInStab: a bleeding ally is stabilized on the way in (1 action) when there is an action left.
      const stab = layInStab(b, u, held), bleeding = !held.stab && !held.ko && !held.surr;
      const note = !bleeding ? "" : stab === "meds" ? ` ${held.name} is bleeding: stabilized on the way in (1 action, 1 meds).` : stab === "hands" ? ` ${held.name} is bleeding and there are no meds: ${u.name.split(" ")[0]} tries to stop it by hand on the way in (1 action, ${handsOdds(u)}%); if that fails they bleed on inside.` : ` Warning: ${held.name} is bleeding and ${u.name.split(" ")[0]} has no action left to stabilize them: inside they bleed out (${held.bleed || 0} turn${held.bleed === 1 ? "" : "s"} left) unless someone pulls them out (${keyLabel("battle.pullOut", 1) || "Shift+U"}) and treats them.`;
      html += btn("dropVehicle", bleeding && stab !== "meds" ? "Into vehicle ⚠" : "Into vehicle", `${bleeding && stab ? "From" : "Free, from"} next to the vehicle: lay ${held.name} in it (a seat). In the vehicle counts as carried out.${note}`, !dropRefusal(b, u, "vehicle"));
    }
  } else if (downNear.length) {
    const t = downNear.find((o) => o.draggedBy == null) || downNear[0];
    const why = liftRefusal(b, u, t);
    html += btn("dragAlly", "Drag ally", `Free: take hold of ${t.name} and drag them: moving at half speed (both actions can go on moving), no shooting. Out of the line of fire: raiders finish the downed they can see, and the dead go for them. Put them down (${keyLabel("battle.drag", 1) || "Shift+D"}) in cover, on the evac strip, or in the vehicle.${why ? ` ${why}` : ""}`, ap > 0 && !why, keyLabel("battle.drag", 1) || "Shift+D");
  }
  const foes = b.units.filter((t) => t.side === "enemy" && t.down && !t.dead && !t.off && playerSees(b, t));
  if (foes.length) {
    const ok = foes.filter((t) => !finishRefusal(b, u, t));
    const t = ok[0] || foes[0];
    html += btn("finish", "Finish", `1 action: kill a downed enemy for good (no revive, no prisoner): a blow from next to them, sure and silent, or one round (${MEDIC.FINISH.BASE}% out to ${MEDIC.FINISH.FROM} tiles, −${MEDIC.FINISH.PER} a tile past it; the noise of a shot). A plain click never does it. ${ok.length ? `${t.name}: ${finishOdds(u, t, b)}%.` : finishRefusal(b, u, t)}`, ap > 0 && ok.length > 0, keyLabel("battle.finish", 1) || "Shift+K");
  }
  // Pull out (sim/medics.js): someone down inside a vehicle (a rider of yours, one of theirs in their Humvee: driver, rider or gunner) is
  // out of reach until someone standing next to it pulls them out.
  const inCar = b.units.filter((o) => (o.side === "player" || playerSees(b, o)) && vehicleOf(b, o));
  if (inCar.length) {
    const t = pullTargets(b, u)[0] || inCar[0];
    const why = pullRefusal(b, u, t);
    html += btn("pullOut", "Pull out", `${MEDIC.PULL.AP} actions, standing next to the vehicle: pull ${t.name} (down inside${t.side === "player" ? "" : ", theirs"}) out onto a free cell next to you both, where they can be revived, stabilized, dragged${t.side === "player" ? "" : ", tied up or finished"} as anyone on the ground. Down in a vehicle nobody can treat them, and the bleeding bleed on.${why ? ` ${why}` : ""}`, !why, keyLabel("battle.pullOut", 1) || "Shift+U");
  }
  return html;
}

function bodyButtons(state, b, u, btn) {
  let html = "";
  // sim/carry.js: the team's supplies carried in the arms (no weapon until set down), and loads set down nearby.
  if (handsBusy(u)) html += btn("dropCarried", "Drop carried", `Free: ${u.name.split(" ")[0]} sets down ${armsText(u)} (${Math.round(handsKg(u) * 10) / 10} kg) on this cell, and can shoot and fight again. Won, the team picks it all up after the fight; retreating, it stays on the ground of this tile.`, true);
  if (handsBusy(u) && b.units.filter((x) => x.side === "player" && handsBusy(x)).length > 1) html += btn("dropAllCarried", "All drop carried", "Free: everyone of yours sets down what they carry in their arms.", true);
  if (carriedNear(b, u).length) html += btn("pickCarried", "Pick up load", `1 action: take ${[recText(carriedNear(b, u).reduce((a, c) => { for (const [k, q] of Object.entries(c.sup || {})) a[k] = (a[k] || 0) + q; return a; }, {})), ...carriedNear(b, u).filter((c) => c.item).map((c) => `the ${c.item.name}`)].filter(Boolean).join(", ")} back in the arms (hands full again: no weapon; one bag at a time).`, u.ap > 0 && u.carrying == null && u.dragging == null);
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
  const near = b.units.filter((t) => canSubdue(u, t, b));
  const so = near.length ? subdueOdds(b, u, near[0]) : null;
  const subTip = so ? `${so.label} (${near[0].name}). Ends the turn. Takedowns work on the unaware and on anyone at 30% health or less; a knocked-out enemy wakes in 4–6 turns unless tied up, and after a won fight comes home as a prisoner.`
    : "Takedown or a non-lethal blow on a person right next to you: knocks them out instead of killing. Best from behind, from cover, with a club and with Stealth.";
  const ko = b.units.filter((t) => t.side === "enemy" && heldDown(t) && !t.tied && !t.fled && adjacent(u, t)); // sim/stealth.js heldDown: out cold, hands up (sim/nonlethal.js), down (sim/medics.js)
  const bodies = b.units.filter((o) => adjacent(u, o) && dragable(o) && !o.left && !o.fled);
  const have = throwablesOf(state, b, u);
  const kinds = THROW_KEYS.filter((k) => have[k]);
  let html = btn("subdue", "Subdue", subTip, ap > 0 && near.length > 0, "C");
  html += btn("tie", ko.some((t) => t.surr) ? "Tie (take prisoner)" : "Tie up", `1 action: tie up someone knocked out or who has surrendered next to you. Tied, they do not wake up, and after the fight they are your prisoner (in a raid, drag them into an extraction zone and leave from it). ${roomText(state)}`, ap > 0 && ko.length > 0, "T");
  html += btn("drag", "Drag", `1 action: drag a body, someone knocked out or a downed teammate up to ${STEALTH.DRAG} tiles (out of a patrol's sight: a guard who sees a body raises the alarm).`, ap > 0 && bodies.length > 0, "⇧D");
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
  if (D.attackers) { // the fort map (sim/fort.js): staging an assault on their walls
    let html = `<h3>Stage the assault</h3>
      <div class="small muted">Click one of your people, then a green cell: anywhere in the open ground round their walls, on any side. The gates are in the middle of each wall (barred: the ram, or batter them); ladders go up the wall sections; grenades over it. Your vehicle can be driven up to the wall and rammed through light obstacles.</div>
      <div class="cbactions" style="margin-top:0.4rem"><button data-action="cb-deploy" data-v="defaults" data-tip="Back to where they started: the west side.">Default positions</button></div>`;
    html += `<div id="cbprev" class="cbprev">${previewHtml(b)}</div>`;
    if (cui.msg) html += `<div class="small warn cbmsg">${esc(cui.msg)}</div>`;
    html += `<h3>Log</h3><div class="cblog" id="cblog">${b.log.slice(-20).map((l) => `<div class="k-${l.k}"><span class="t">T${l.turn}</span>${esc(l.text)}</div>`).join("")}</div>`;
    html += `<div class="cbfoot"><button class="primary" data-action="cb-deploy" data-v="start" data-tip="Everyone is in place: the assault begins. (Enter)">Start the assault</button>
      ${!b.acted && b.turn === 1 ? `<button data-action="cb-auto" data-tip="Skip the tactical battle and resolve it instantly by the numbers.">Auto-resolve</button>` : ""}</div>`;
    return html;
  }
  const holders = players(b).filter((p) => p.post === "gate").map((p) => p.name);
  const towers = players(b).filter((p) => p.post === "tower").map((p) => p.name);
  let html = `<h3>${b.drill ? `Drill · ${D.fort ? "the plan holds from any side" : "facing an attack from the east (it turns with the attack)"}` : `Deploy · the attack comes from the ${esc(D.side || "east")}`}</h3>
    <div class="small muted">Click a defender, then a green cell to place them: on the walkway behind the wall (▲ height 1: shoot down over the wall, +5 aim, half cover; up the ladders), on a tower (▲▲ height 2: full cover, +10 aim, the widest view), in the gate or a breach (orange: whoever stands there holds it and blocks the way), or anywhere inside. The attackers batter the wall and the gate (hit points) and come through the openings.</div>
    ${startLine(state, b)}<div class="small" style="margin-top:0.3rem">${D.walled ? `Holding the gate: <b>${holders.length ? esc(holders.join(", ")) : "nobody"}</b>${towers.length ? ` · On the towers: <b>${esc(towers.join(", "))}</b>` : ""}` : "No walls built here: defenders stand in the yard behind the barricades."}</div>
    <div class="cbactions" style="margin-top:0.4rem">
      <button data-action="cb-deploy" data-v="gate" ${u && D.walled ? "" : "disabled"} data-tip="${esc(u ? `Put ${u.name} in the gate (or a breach) to hold it.` : "Pick a defender first.")}">Hold the gate${u ? `: ${esc(u.name.split(" ")[0])}` : ""}</button>
      <button data-action="cb-deploy" data-v="defaults" data-tip="Back to the default posts: the toughest fighters in the gate (with 7+ defenders), the best shots on the towers, the rest in a line well back from the openings.">Default positions</button>
    </div>${planRow(state, b)}`;
  if (D.floodlit) {
    html += `<div class="small" style="margin-top:0.4rem" data-tip="The floodlights light a third of the approach: shots at anything in the light get +${b.floodAim}${D.night ? " (night)" : " (day)"}.">Floodlights (+${b.floodAim} to hit in the light):</div><div class="cbactions">
      ${Object.entries(LIT_ZONES).map(([z, name]) => `<button class="${D.lit === z ? "active" : ""}" data-action="cb-deploy" data-v="flood" data-z="${z}" data-tip="Aim the floodlights ${name.toLowerCase()} (as the defenders see it).">${name}</button>`).join("")}</div>`;
  }
  html += `<div id="cbprev" class="cbprev">${previewHtml(b, state)}</div>`;
  if (cui.msg) html += `<div class="small warn cbmsg">${esc(cui.msg)}</div>`;
  html += `<h3>Log</h3><div class="cblog" id="cblog">${b.log.slice(-20).map((l) => `<div class="k-${l.k}"><span class="t">T${l.turn}</span>${esc(l.text)}</div>`).join("")}</div>`;
  html += b.drill ? drillFoot(state, b) : `<div class="cbfoot"><button class="primary" data-action="cb-deploy" data-v="start" data-tip="Everyone is in place: the fight begins. (Enter)">Start the fight</button>
    ${!b.acted && b.turn === 1 ? `<button data-action="cb-auto" data-tip="Skip the tactical battle and resolve it instantly by the numbers.">Auto-resolve</button>` : ""}</div>`;
  return html;
}

// Who was at a post when the attack hit (sim/defenceplan.js openStart): one line under the deploy step's title.
function startLine(state, b) {
  const t = startText(state, b);
  if (!t || b.drill) return "";
  const R = b.deploy.ready;
  return `<div class="small ${R.manned || !R.late.length ? "good" : "warn"}" style="margin-top:0.3rem" data-tip="${esc("Who stands at a post when an attack hits: everyone after a warning (Prepare defenses, a horde warning); otherwise only the people on guard right now (the watch roster in the base's Defence tab, guards). The rest start in the buildings and cannot act until the attackers have moved once (with nobody on watch the attackers move first). They cannot be placed now.")}">${esc(t)}</div>`;
}
// The base's defence plans in the deploy step and the drill (sim/defenceplan.js): which plan (a picker: the one that
// fits the attack was taken up by itself), back to its posts, keep these as the plan; posts by role; in a drill, new,
// rename, tags and delete.
function planRow(state, b) {
  const key = planKey(b);
  if (!key) return "";
  const plan = planFor(state, b), stale = planStale(state, b), cur = currentPlan(state, b);
  const base = state.bases.find((x) => x.id === b.setup.baseId);
  const list = plansOf(base);
  const where = PLAN_MAPS[key];
  const u = selUnit(b);
  const name = cur ? `"${cur.name}"` : "this base's";
  const pick = list.length ? `<select data-action="dplan-pick"${tipA(b.drill ? "The plan this drill edits" : "The plan for this fight: the one that fits the attack best (who attacks, day or night) was taken up by itself. Pick another to take up its posts, or none for the default posts.")}>
      ${b.drill ? "" : `<option value="0" ${cur ? "" : "selected"}>No plan (default posts)</option>`}
      ${list.map((p) => `<option value="${p.id}" ${cur && cur.id === p.id ? "selected" : ""}>${esc(p.name)} · ${esc(planTags(p))}${p.maps[key] ? "" : " · not planned here"}</option>`).join("")}</select>` : "";
  let html = `<div class="cbactions" style="margin-top:0.3rem">${pick}
      ${b.drill ? "" : `<button data-action="cb-deploy" data-v="plan" ${plan ? "" : "disabled"} data-tip="${esc(plan ? `Back to the ${name} plan for ${where} (made on day ${plan.day}): everyone in it to their planned post. The plan was taken up by itself as the attack began; this undoes your changes.` : stale || "No plan for this map yet: place everyone, then Save as plan (or plan it ahead in the base's Defence tab).")}">Planned posts</button>`}
      <button ${b.drill ? 'class="primary" ' : ""}data-action="cb-deploy" data-v="savePlan" data-tip="${esc(`Keep where everyone stands now as the ${cur ? name : "base's first"} plan for ${where}: from the next attack on, they take up these posts by themselves in the deploy step (and in fights played out without you).${plan ? " Replaces its posts here." : ""}`)}">Save as plan</button>
    </div>`;
  if (b.drill) {
    html += `<div class="cbactions" style="margin-top:0.3rem">
      ${cur ? `<input class="dshname" data-action="dplan-name" value="${esc(cur.name)}" maxlength="${PLAN.NAME}"${tipA("Rename this plan")}>
      <select data-action="dplan-who"${tipA("Taken up by itself when these attack (a plan for this attacker beats one for any)")}>${Object.entries(PLAN_WHO).map(([k, v]) => `<option value="${k}" ${cur.who === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
      <select data-action="dplan-when"${tipA("Taken up by itself at this time (a plan for night or day beats one for both)")}>${Object.entries(PLAN_WHEN).map(([k, v]) => `<option value="${k}" ${cur.when === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>` : ""}
      <button data-action="cb-deploy" data-v="newPlan" ${list.length < PLAN.MAX ? "" : "disabled"} data-tip="${esc(list.length < PLAN.MAX ? "A new plan from where everyone stands now (name and tag it, then move people and Save as plan): e.g. one for hordes, one for raiders, one for the night." : `At most ${PLAN.MAX} plans.`)}">New plan</button>
      ${cur ? `<button data-action="cb-deploy" data-v="deletePlan" data-tip="${esc(`Forget the "${cur.name}" plan.`)}">Delete plan</button>` : ""}
    </div>`;
  }
  // Posts by name or by role: the selected one, or everyone.
  const roleBtn = (z, label, t) => `<button class="mini ${u && (u.planRole || "") === z ? "active" : ""}" data-action="cb-deploy" data-v="role" data-z="${z}" ${u && !u.late ? "" : "disabled"} data-tip="${esc(t)}">${label}</button>`;
  const first = u ? u.name.split(" ")[0] : "they";
  html += `<div class="cbactions small" style="margin-top:0.3rem"><span class="muted">${u ? `${esc(first)}'s post:` : "A post:"}</span>
      ${roleBtn("", "This person", "Saved as this person's post: they take it whenever they are here.")}
      ${Object.entries(PLAN_ROLES).map(([z, v]) => roleBtn(z, v, `Saved as a post by role: whoever fits it best takes it (${z === "shooter" ? "the best shot with a gun that reaches" : z === "close" ? "the toughest with a melee weapon or a shotgun" : "anyone left"}), so it is filled when ${first} ${u ? "is" : "are"} away or gone, or by a newcomer. Posts by name are filled first.`)).join("")}
      <button class="mini" data-action="cb-deploy" data-v="roles" data-z="role" data-tip="Every post by role, from who stands there now (best shot, close fighter or anyone). Save as plan to keep it.">All by role</button>
      <button class="mini" data-action="cb-deploy" data-v="roles" data-z="name" data-tip="Every post by name. Save as plan to keep it.">All by name</button></div>`;
  if (u && u.planRole) html += `<div class="small muted">${esc(first)} stands a post by role (${esc(PLAN_ROLES[u.planRole].toLowerCase())}; ${esc(first)} is a ${esc(PLAN_ROLES[roleOf(u)].toLowerCase())}).</div>`;
  if (stale && !b.drill) html += `<div class="small muted">${esc(stale)}</div>`;
  return html;
}
const tipA = (t) => ` data-tip="${esc(t)}"`;
// A drill's foot: nothing to start, only to save and close.
function drillFoot(state, b) {
  const plan = planFor(state, b), cur = currentPlan(state, b);
  return `<div class="cbfoot"><button data-action="cb-deploy" data-v="endDrill" data-tip="${esc(plan ? "Close the drill. The plans are kept as last saved." : "Close the drill. Nothing was saved for this map: the default posts are used.")}">Close the drill</button>
    <span class="small muted">${plan ? `"${esc(cur.name)}" saved (day ${plan.day}, ${plan.posts.length} posts${plan.posts.some((p) => p[3]) ? `, ${plan.posts.filter((p) => p[3]).length} by role` : ""}).` : "Not saved yet."}</span></div>`;
}
// The plan picker, the name and the tags (selects and a text box: ui/defence.js DEFENCE_CHANGE routes them here).
export function planChange(state, kind, value) {
  const b = state.combat;
  if (!b || b.phase !== "deploy") return;
  const cur = currentPlan(state, b);
  if (kind === "pick") return void act(state, { type: "pickPlan", id: Number(value) || 0 });
  if (kind === "name") return void act(state, { type: "renamePlan", name: value });
  if (kind === "who" || kind === "when") return void act(state, { type: "tagPlan", who: kind === "who" ? value : cur && cur.who, when: kind === "when" ? value : cur && cur.when });
}

// ---------- a base battle's tiers (sim/deploy.js, sim/interior.js) ----------
// One line under the battle's title: which tier the fight is in, the wall and the gate (hit points), the breaches,
// how many attackers are inside or still outside.
export function tierHtml(b) {
  const T = b.tier;
  if (!T) return "";
  const attSide = T.map === "fort" && T.attackers === "player" ? "player" : "enemy"; // the fort map (sim/fort.js): on an assault the attackers are yours
  const foes = b.units.filter((u) => u.side === attSide && active(u));
  if (T.map === "wall" || (T.map === "fort" && T.stage === "wall")) {
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
  let html = `<h3>${after ? "Redeploy · falling back" : b.drill ? "Drill · facing an attack from the east (it turns with the attack)" : `Deploy · the attack comes from the ${esc(D.side || "east")}`}</h3>
    <div class="small muted">${after ? "Your people have left the wall. Place them on the green cells (near where they were, away from the attackers):" : "No walls here: the attackers come straight over the yard. Place your defenders on the green cells:"} in the buildings (barred doors, half cover at the windows), on an upper floor or a flat roof (▲ height 1: further sight, +5 aim down, half cover), on a tower (▲▲), or behind the barricades.</div>${after ? "" : startLine(state, b)}
    <div class="cbactions" style="margin-top:0.4rem">
      <button data-action="cb-deploy" data-v="defaults" data-tip="The default posts: the best shots on the towers, upper floors and roofs, then at the windows; close fighters inside by the doors; the rest behind cover in the yard.">Default positions</button>
      ${after ? `<button class="${cui.autoRedeploy ? "active" : ""}" data-action="cb-redeploy" data-tip="When on, falling back skips this step: your people take the default posts and the fight goes on at once. Remembered in this browser.">${cui.autoRedeploy ? "✔" : "✗"} Skip this next time</button>` : ""}
    </div>${planRow(state, b)}`;
  if (D.floodlit) {
    html += `<div class="small" style="margin-top:0.4rem" data-tip="The floodlights light a third of the yard: shots at anything in the light get +${b.floodAim}${D.night ? ", and at night your people see what stands in it" : ""}.">Floodlights (+${b.floodAim} to hit in the light):</div><div class="cbactions">
      ${Object.entries(LIT_ZONES).map(([z, name]) => `<button class="${D.lit === z ? "active" : ""}" data-action="cb-deploy" data-v="flood" data-z="${z}" data-tip="Aim the floodlights ${name.toLowerCase()} (as the defenders see it).">${name}</button>`).join("")}</div>`;
  }
  html += `<div id="cbprev" class="cbprev">${previewHtml(b, state)}</div>`;
  if (cui.msg) html += `<div class="small warn cbmsg">${esc(cui.msg)}</div>`;
  html += `<h3>Log</h3><div class="cblog" id="cblog">${b.log.slice(-20).map((l) => `<div class="k-${l.k}"><span class="t">T${l.turn}</span>${esc(l.text)}</div>`).join("")}</div>`;
  html += b.drill ? drillFoot(state, b) : `<div class="cbfoot"><button class="primary" data-action="cb-deploy" data-v="start" data-tip="Everyone is in place: the fight goes on. (Enter)">${after ? "Hold the yard" : "Start the fight"}</button>
    ${!b.acted && b.turn === 1 ? `<button data-action="cb-auto" data-tip="Skip the tactical battle and resolve it instantly by the numbers.">Auto-resolve</button>` : ""}</div>`;
  void u;
  return html;
}

// ---------- prisoners on the result screen (sim/prisoners.js) ----------
function prisonersHtml(state, b) {
  const list = (b.result && b.result.prisoners) || [];
  if (!list.length) return "";
  const leave = !!b.leavePrisoners;
  const room = totalRoom(state);
  const over = Math.max(0, list.length - room);
  return `<div class="small" style="margin-top:0.5rem"><b>Prisoners:</b> ${esc(list.map((p) => `${p.name} (${p.group})`).join(", "))}. ${leave ? "You will leave them tied up here." : b.setup.baseId != null ? "They go into the jail (1 food and 1 water a day each)." : "They walk home with the team, tied (on foot each slows it 10%, and they may slip away)."}</div>
    <div class="small ${over && !leave ? "warn" : "muted"}">${esc(roomText(state))}${over && !leave ? ` ${over} more than your jails hold: for ${over === 1 ? "that one" : "each of them"} you choose once you take them: release, execute or ask to join on the spot.` : ""}</div>
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
    ${prisonersHtml(state, b)}
    <button class="primary" style="margin-top:0.7rem;width:100%" data-action="cb-close" data-tip="Return to the State Map. The team then waits for orders.">Continue</button>
    ${restartBtn(state, b, "margin-top:0.4rem;width:100%")}
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
      ${r.arrowsUsed ? `<div>Arrows shot</div><div>${r.arrowsUsed}${r.arrowsBack ? ` (${r.arrowsBack} picked up again)` : " (none picked up)"}</div>` : ""}
      <div>${bodies ? "Taken" : "Loot"}</div><div>${loot.length ? esc(loot.join(", ")) : "nothing"}</div>
      ${bodies ? `<div>Bodies</div><div>${bodies} with things on them</div>` : ""}
    </div>
    ${b.summary.length ? `<div class="small muted" style="margin-top:0.4rem">${b.summary.map(esc).join("<br>")}</div>` : ""}
    ${prisonersHtml(state, b)}
    ${bodies ? `<button style="margin-top:0.7rem;width:100%" data-action="loot-open" data-tip="Search the dead one by one: see what each carries and move it to your people or the cargo.">Loot the bodies (${bodies})</button>
    <button class="primary" style="margin-top:0.4rem;width:100%" data-action="cb-close" data-take="1" data-tip="Take everything that fits (supplies first, then the most valuable items) and return to the State Map. (Enter)">Take all and continue</button>
    <button style="margin-top:0.4rem;width:100%" data-action="cb-close" data-take="0" data-tip="Return to the State Map. What is left on the bodies stays where they fell: a death site scavengers strip over the next days.">Leave the rest and continue</button>` :
    `<button class="primary" style="margin-top:0.7rem;width:100%" data-action="cb-close" data-tip="Close the battle and return to the State Map.">Continue</button>`}
    ${restartBtn(state, b, "margin-top:0.4rem;width:100%")}
  </div>
  <h3>Log</h3><div class="cblog" id="cblog">${b.log.slice(-40).map((l) => `<div class="k-${l.k}"><span class="t">T${l.turn}</span>${esc(l.text)}</div>`).join("")}</div>`;
}

// The battle-start save of this battle (ui/settings.js doBattleSave): Restart battle loads it (after a confirm).
// Never in an Ironman game (no going back).
const restartable = (state, b) => !!(b && b.saveOk && b.saveKey && !state.ironman);
const restartBtn = (state, b, style = "") => (restartable(state, b) ? `<button${style ? ` style="${style}"` : ""} data-action="set-battlereload" data-tip="Load the save made as this battle started and play it again from the beginning (asks first). Everything since it began is lost.">↺ Restart battle</button>` : "");

// Odds for the selected unit against a target: shot if it can, melee if adjacent.
function odds(b, u, t) {
  const nlo = nlOdds(b, u, t, cui); // the taser (ui/nonlethal.js)
  if (nlo) return nlo;
  if (t.side === "enemy" && t.down && !t.dead) { // sim/medics.js: Finish (downed)
    const why = finishRefusal(b, u, t);
    const p = finishOdds(u, t, b);
    return { ok: !why, chance: p, finish: true, label: why ? `Finish (downed): ${why}` : `Finish (downed): ${p}%, ${SIM.meleeReach(b, u, t) ? "a blow from next to them" : "one round"}: dead for good, no revive, no prisoner. Use Finish (${keyLabel("battle.finish", 1) || "Shift+K"}); a plain click does not` };
  }
  if (cui.mode === "subdue") {
    if (!canSubdue(u, t, b)) return { ok: false, label: t.kind === "zombie" ? "The dead cannot be subdued" : "Subdue needs them right next to you" };
    const o = subdueOdds(b, u, t);
    return { ...o, ok: true, label: o.label };
  }
  if ((cui.mode === "melee" || !canFire(b, u)) && meleeReach(b, u, t)) {
    const o = meleeOdds(b, u, t);
    return { ...o, ok: true, label: `Melee ${o.chance}% to hit, ${o.dmg[0]}–${o.dmg[1]} damage, ${o.crit}% crit (×${CRIT_MULT})` };
  }
  if (!canFire(b, u)) return { ok: false, label: isRanged(u) ? (magEmpty(b, u) && !reloadRefusal(b, u) ? "Empty: reload first (I)" : outOf(u)) : "No gun: move next to them and use Melee" };
  if (!canSee(b, u, t)) return { ok: false, label: "No line of sight" };
  const o = shotOdds(b, u, t);
  const cover = o.cover === 2 ? "in full cover" : o.cover === 1 ? "in half cover" : o.flanked ? "FLANKED" : t.kind === "zombie" || !t.aware || t.surprised ? "caught in the open" : "exposed";
  // sim/combat.js shotOdds notes: a bipod rested on cover, firing from a vehicle that moved, a light round's drop at range,
  // handloads, a helmet's visor, a headset's callout, dazed by a bang.
  const notes = o.notes && o.notes.length ? `; ${o.notes.join(", ")}` : "";
  return { ...o, ok: true, label: `${o.chance}% to hit, ${o.dmg[0]}–${o.dmg[1]} damage, ${o.crit}% crit (×${CRIT_MULT}), ${cover}${t.hunker ? ", hunkered" : ""}${notes}` };
}


function previewHtml(b, state = null) {
  const h = cui.hover;
  const u = selUnit(b);
  if (!h) return `<span class="muted">Hover a tile or enemy for details.</span>`;
  if (u && (cui.mode === "suppress" || cui.mode === "throwspear" || cui.mode === "launch")) return aimPreview(b, u, h); // the weapons overhaul's targeting
  const v = view(b);
  const t = unitAt(b, h.x, h.y);
  const nlp = nlPreview(b, t && (t.side === "player" || v.vis[h.y * W + h.x]) ? t : null, h, u, cui); // the pepper cone, hands up, your knocked out (ui/nonlethal.js)
  if (nlp) return nlp;
  if (t && t.side === "enemy" && v.seen.has(t.id)) {
    const o = u && active(u) ? odds(b, u, t) : null;
    const stealthy = (t.investigate ? ' · <span class="warn">going to look at a noise</span>' : "") + (t.stun ? ` · <span class="good">${esc(stunLabel(t.stun))}: no overwatch</span>` : ""); // a flashbang (sim/throwables.js)
    // What it follows (sim/decoys.js), a Shepherd's pack, the siege kit it carries (sim/siege.js).
    const sense = t.kind === "zombie" ? (herded(b, t) ? ' · <span class="danger">herded by a Shepherd: decoys and fire do not work on it</span>' : ` · <span class="muted">follows ${sensesOf(b, t).join(" and ") || "nothing"}</span>`) : "";
    const kit = t.ram != null && ramOf(b, t) ? ' · <span class="warn">carrying the ram (no cover)</span>' : t.ladder ? ' · <span class="warn">carrying a ladder</span>' : t.throwables && Object.values(t.throwables).some((n) => n > 0) ? ` · <span class="warn">has ${esc(Object.entries(t.throwables).filter(([, n]) => n > 0).map(([k, n]) => `${n > 1 ? `${n} ` : ""}${GEAR[k] ? GEAR[k].name.toLowerCase() : k}${n > 1 ? "s" : ""}`).join(", "))}</span>` : b.cells[t.y * W + t.x].k === "siegeladder" ? ' · <span class="warn">on a ladder (exposed)</span>' : "";
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
    return `<b>${esc(t.name)}</b> <span class="muted">${gunText(b, t)} · ${Math.round(t.hp)}/${t.maxHp} hp</span>${stealthy}${sense}${kit}${zt}${turned}<br>${o ? (o.ok ? `<span class="${o.chance >= 65 ? "good" : o.chance >= 35 ? "warn" : "danger"}">${esc(o.label)}</span>` : `<span class="muted">${esc(o.label)}</span>`) : ""}`;
  }
  // The third side (sim/thirdside.js): survivors keeping to themselves, soldiers fighting the dead.
  if (t && t.side === "third" && v.seen.has(t.id)) return `<b>${esc(t.name)}</b> <span class="muted">${esc(t.weaponName)} · ${Math.round(t.hp)}/${t.maxHp} hp</span><br><span class="small">${t.team === "military" ? "A soldier: fights the dead and anyone who attacks them, not you unless you fire on them." : "A survivor keeping to themselves: they defend themselves or run. Talk to them after the fight."} Click twice to attack.</span>`;
  // The knocked out (sim/stealth.js).
  if (t && t.side === "enemy" && t.ko && v.vis[h.y * W + h.x]) return `<b>${esc(t.name)}</b> · ${t.tied ? "tied up: your prisoner if you win" : `out cold, wakes in about ${Math.max(1, t.wake - b.turn)} turn${t.wake - b.turn === 1 ? "" : "s"}: Tie up (T) from next to them`}. <span class="muted">Drag (Shift+D) moves them out of sight.</span>`;
  if (t && t.side === "player" && t.vol != null) return `<b style="color:${VOL_COLOR}">${esc(t.name)}</b> <span class="muted">${Math.round(t.hp)}/${t.maxHp} hp · ${gunText(b, t)}</span><br><span class="small">Volunteer from ${esc(t.volGroup || "an allied group")}: their own orders. They act on their own at the end of your turn.</span>`; // sim/volunteers.js
  if (t && t.side === "player") {
    if (b.phase === "deploy") return `<b>${esc(t.name)}</b> <span class="muted">${Math.round(t.hp)} hp · ${esc(t.weaponName)}${t.post === "gate" ? " · holds the gate" : t.post === "tower" ? " · on a tower" : ""}</span>`;
    const hh = heightAt(b, t.x, t.y);
    const thr = active(t) ? threatHtml(b, v, t.x, t.y, ` to ${esc(t.name.split(" ")[0])}`) : "";
    return `<b>${esc(t.name)}</b> <span class="muted">${Math.round(t.hp)} hp · ${gunText(b, t)}${t.light ? ` · ${LIGHTS[t.light]?.name || "light"}` : ""}${t.nvg ? " · night vision" : ""}${t.optic ? ` · optics +${t.optic}` : ""}${t.suppressor ? ` · ${t.supFitted ? "" : "carried "}suppressor${GEAR[t.suppressor.key] && GEAR[t.suppressor.key].dur ? ` (${t.suppressor.dur ?? GEAR[t.suppressor.key].dur} shots)` : ""}` : ""} · sees ${Math.round(sightRange(b, t))} tiles</span>${hh ? `<br><span class="good">${"▲".repeat(hh)} On high ground (height ${hh}): +${HEIGHT.SIGHT * hh} sight, +${Math.min(HEIGHT.MAX_AIM, HEIGHT.AIM * hh)} aim at anything lower, half cover against shooters below.</span>` : ""}${thr}`;
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
  if (ghost && ghost.heard) return `<b>Heard something</b> <span class="muted">here on turn ${ghost.turn}: moving or firing, out of sight. Your people hear what they cannot see within a few tiles (ear protection and helmets change how far; nothing while deafened).</span>`;
  if (ghost) return `<b>${esc(ghost.name)}</b> <span class="muted">last seen here on turn ${ghost.turn}. Nobody sees this tile now: it may have moved.</span>`;
  if (b.phase === "deploy") {
    const k = b.cells[h.y * W + h.x].k;
    const where = k === "gate" ? "The gate: whoever stands here holds it." : k === "breach" ? "A breach in the wall: whoever stands here holds it." : k === "tower" ? "A watchtower (▲▲ height 2): full cover from anything not next to it, +10 aim down, +4 sight: the widest view." : k === "walkway" ? "The walkway (▲ height 1): shoot down over the wall, +5 aim, +2 sight, half cover against shooters below." : k === "loft" ? "An upper floor (▲ height 1): shoot down through the windows." : k === "roof" ? "A flat roof (▲ height 1): +2 sight, +5 aim down, half cover against shooters below." : k === "ladder" || k === "stairs" ? `${k === "ladder" ? "A ladder" : "Stairs"}: the way up (climbing costs 1 move a level, the dead 2).` : "";
    if (canPlace(b, h.x, h.y)) return `${where ? `<b>${where}</b> ` : ""}Click to place ${selUnit(b) ? esc(selUnit(b).name) : "the selected defender"} here.`;
    if (b.lit && b.lit[h.y * W + h.x]) return "Floodlit: shots at anything here get the light's bonus.";
  }
  const lure = (b.lures || []).find((l) => l.x === h.x && l.y === h.y);
  if (lure) return `<b>${esc(GEAR[lure.key].name)}</b>: ${lure.key === "noisemaker" ? `still ringing (${lure.turns} turn${lure.turns === 1 ? "" : "s"})` : "where it landed"}. Guards and the dead nearby come to look.`;
  if (state && !(b.raid && boxAt(b, h.x, h.y))) { const carText = carPreview(state, b, h.x, h.y); if (carText) return carText; } // ui/carpanel.js: a car or Army truck (not a raid container: that has its own line)
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
        : near ? `Click or press Shift+S to search (${SEARCH.ap} action, quiet, everything shows). Shift+Q: a quick rummage (no action, ${Math.round(SEARCH.quick.reveal[0] * 100)}–${Math.round(SEARCH.quick.reveal[1] * 100)}% of it, heard ${quickRadius(b, u)} tiles off, Heat +${SEARCH.quick.heat}${state ? `, ${quickHurtPct(state, b, u)} chance of cutting yourself` : ""}).` : "Move next to it to search.";
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
  return s + threatHtml(b, v, h.x, h.y);
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
  drawIsoView(state, b, now, cw, ch); // the battle map is isometric only (ui/isoview.js)
  barkFrame(ctx, state, b, now, barkView(b, now, cw, ch)); // combat barks over the units' heads (ui/barks.js)
  drawBanner(b, cw, 40);
}
// What ui/barks.js needs to place the bubbles: who your people see (the drawing's fog), where a unit's head is (over its
// labels in the iso view, sliding with its move), the text size (the zoom and the UI size).
function barkView(b, now, cw, ch) {
  const v = view(b), S = ISO_ZOOMS[iso.zoom] || 2;
  const ui = typeof document !== "undefined" && document.documentElement ? Number(document.documentElement.style.getPropertyValue("--ui-scale")) || 1 : 1;
  const visible = (t) => t.side === "player" || (active(t) ? v.seen.has(t.id) : !!v.vis[t.y * b.w + t.x]);
  const head = (t) => {
    if (!onFloor(b, t) || t.left || t.fled || t.off) return null;
    const [x, y] = animTile(b, t, now);
    const big = t.boss ? 1.35 : t.ztype === "brute" ? 1.15 : 1, fs = Math.max(10, Math.round(3.4 * S));
    const [X, Y] = project(x + 0.5, y + 0.5, heightAt(b, t.x, t.y) * LV + liftOf(b) + (t.down || t.dead ? 10 : 30 * big));
    return [X, Y - 6 - fs - 6]; // over the health bar and the tags (ui/isoview.js drawLabels)
  };
  return { visible, head, w: cw, h: ch, sel: cui.sel, top: 40, font: Math.min(30, Math.max(16, 3.6 * S)) * ui };
}

// Throw mode (sim/stealth.js): the cells in range (k 0), and for the hovered spot in range where it would reach: a
// flashbang's flash (k 1; 2 within a tile: sim/throwables.js flashCells), a grenade's blast or a smoke cloud (k 1).
// caught: the living it would catch there (a flashbang: those it would stun). null when not throwing.
function throwPreview(b, u) {
  if (cui.mode !== "throw" || !u || !active(u) || !cui.throwKey || !THROWABLES[cui.throwKey]) return null;
  const T = THROWABLES[cui.throwKey];
  if (T.self) return null;
  const inRange = (x, y) => Math.hypot(x - u.x, y - u.y) <= T.range + 0.01;
  const cells = [];
  for (let y = Math.max(0, u.y - T.range); y <= Math.min(H - 1, u.y + T.range); y++) for (let x = Math.max(0, u.x - T.range); x <= Math.min(W - 1, u.x + T.range); x++) if (inRange(x, y)) cells.push([x, y, 0]);
  const h = cui.hover;
  const caught = [];
  if (h && h.x >= 0 && h.y >= 0 && h.x < W && h.y < H && inRange(h.x, h.y)) {
    const v = view(b);
    if (T.fx === "flash") {
      for (const [x, y, near] of flashCells(b, h.x, h.y)) cells.push([x, y, near ? 2 : 1]);
      for (const t of b.units) if (t.kind === "human" && active(t) && (t.side === "player" || v.seen.has(t.id)) && flashReach(b, h.x, h.y, t.x, t.y)) caught.push(t);
    } else if (T.fx) {
      const r = T.fx === "frag" ? FRAG.r : T.fx === "blast" ? BLAST.r : T.fx === "smoke" ? SMOKE.r : T.fx === "fire" ? 1.5 : 0;
      for (let y = h.y - Math.ceil(r); y <= h.y + Math.ceil(r); y++) for (let x = h.x - Math.ceil(r); x <= h.x + Math.ceil(r); x++) if (x >= 0 && y >= 0 && x < W && y < H && Math.hypot(x - h.x, y - h.y) <= r + 1e-6) cells.push([x, y, 1]);
    }
  }
  return { cells, caught };
}
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

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
    threat: (x, y) => threatAt(b, v, x, y), // the threat preview: lines from whoever could hit the hovered tile
    cone: nlConeMask(b, v.u, cui), // the pepper spray's cone toward the hovered tile (ui/nonlethal.js)
    throwMarks: throwPreview(b, v.u), // throw mode: the range and the reach of the hovered spot (sim/throwables.js)
  });
  // Suppressing fire's cone, a thrown spear's reach: ground diamonds over the scene (isoview.js project).
  if (v.u && (cui.mode === "suppress" || cui.mode === "throwspear" || cui.mode === "launch")) {
    const band = aimArea(b, v.u, v.vis, cui.hover, cui.mode);
    for (const code of cui.mode === "launch" ? [1, 3, 5, 4, 2] : [1, 2]) {
      ctx.fillStyle = cui.mode === "launch" ? aimFill("launch", code) : cui.mode === "suppress" ? "rgba(255,140,60,0.22)" : "rgba(140,200,255,0.18)";
      ctx.beginPath();
      for (let i = 0; i < band.length; i++) {
        if (!band[i] || (cui.mode === "launch" ? band[i] !== code : code !== 1)) continue;
        const x = i % b.w, y = (i / b.w) | 0;
        const pts = [project(x, y), project(x + 1, y), project(x + 1, y + 1), project(x, y + 1)];
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < 4; k++) ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.closePath();
      }
      ctx.fill();
    }
  }
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


// The phase banner at the top of the map.
function drawBanner(b, cw, cs) {
  const heatTag = b.raid ? ` · HEAT ${HEAT_NAMES[Math.min(3, Math.floor(b.raid.heat / 25))].toUpperCase()}` : "";
  const nightTag = b.night ? " · NIGHT" : "";
  const tierTag = b.tier ? (b.tier.map === "wall" ? " · THE WALLS" : b.tier.stage === "buildings" ? " · LAST STAND" : " · THE YARD") : "";
  const floorTag = floorsOf(b) ? ` · ${floorLabel(b, floorNo(b)).toUpperCase()}` : "";
  const label = b.over ? (b.result.outcome === "victory" ? "VICTORY" : b.result.outcome === "extracted" ? "GOT OUT" : b.result.outcome === "retreat" ? "RETREATED" : "DEFEAT") :
    b.phase === "deploy" ? (b.drill ? `DEFENCE DRILL · ${planKey(b) === "fort" ? "PLAN YOUR POSTS" : "FACING AN ATTACK FROM THE EAST"}` : b.deploy && b.deploy.attackers ? "STAGE THE ASSAULT · ANY SIDE OF THEIR WALLS" : b.tier && b.tier.fellBackTurn != null ? "REDEPLOY · FALL BACK TO THE YARD" : `DEPLOY · THEY COME FROM THE ${String((b.deploy && b.deploy.side) || "east").toUpperCase()}`) :
    b.phase === "player" ? `YOUR TURN · ${b.turn}${heatTag}${tierTag}${nightTag}${floorTag}` : `ENEMY TURN${heatTag}${tierTag}${nightTag}${floorTag}`;
  const col = b.over ? (b.result.outcome === "victory" || b.result.outcome === "extracted" ? PAL.good : PAL.bad) : b.phase === "deploy" ? "#e0a84f" : b.phase === "player" ? "#8fb4e0" : PAL.bad;
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

