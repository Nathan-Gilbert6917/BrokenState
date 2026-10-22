// Tactical combat screen: canvas battle map plus the side panel. Reads state.combat; all rules live in sim/combat.js.
// A raid on a site (b.raid) has no side panel (the user's request 2026-10-18, raidLayout): what the panel carried is a
// strip at the top of the map (renderRaidTop: the place, the turn, Heat, the floor shown, the supplies; at the right the
// Menu, the view's buttons and the Log button), cards over the map (renderRaidCards: the choices before you go in, the
// building to search, the result, the hover details, a warning) and the log in its own small window (ui/logwindow.js,
// renderRaidLog). main.js writes them into #cbtop, #cbcards, #cblogbody and #cblogfoot.
import { keyWord } from "../sim/water.js"; // supplies as words: "9mm FMJ", "rounds"
import { PAL } from "./palette.js"; // good / bad colours (the colour-blind-safe set swaps them: ui/display.js)
import {
  volRefusal, VOL_ORDERS, MAP_W, MAP_H, CELL, COVER_DEF, active, unitAt, unitById, evacAt, reachable, pathTo, shotOdds, meleeOdds, retreatPlan, retreatRefusal,
  canSee, canSeeAt, coverSides, isRanged, adjacent, meleeReach, canFire, ammoLeft, arrowsLeft, medsLeft, combatAct, enemyStep, playerSees,
  hasMag, magLabel, magEmpty, magShown, reloadRefusal, fireRefusal, hasShots,
  vehicleTurret, TURRET, RIDE, turretRounds, los, autoResolveCombat, finishCombat, closeCombat, zoneAt, boxAt, searchableNear, nearBox, boxCenter, DRIVE, RAMMING, aboardCount, evacRefusal, AREAS, areaHint, HEAT_NAMES,
  playerVision, enemyGhosts, vehicleExit, heightAt, HEIGHT, sightRange, structureName, barredCell, doorHeld, WEAPONS, CRIT_MULT, hitMult, vaultsNear,
} from "../sim/combat.js";
import * as SIM from "../sim/combat.js";
import { drawOptions, drawPlan, DRAW_AP } from "../sim/holsters.js"; // the side arm and melee slots (Draw side arm, Draw melee, Main weapon)
import { magsLine, spareRounds, reloadText, isShellGun, shellsInPack, getShellsRefusal, shellsLine, SHELLS, tracksMags, reloadPlan, reloadOptions, gunStackText, isStacked, MAGS } from "../sim/mags.js";
import { kitWarnings, kitWarnDue } from "../sim/kitcheck.js"; // the kit check before the first move: empty guns, no healing, the hurt // magazines as items (section 15): spares, what a Reload does
import { plateSwapPlan, PLATE_AP } from "../sim/carrykit.js"; // a broken plate swapped from the pack (2 actions)
import { loadsFor, roundName } from "../sim/ammo.js"; // the reload chooser: the types of the gun's calibre to hand // setFloor and stairOptions (docs/multi-storey-crawl.md), looked up when present
import { MILDEAD, armorVs, stabsGap } from "../sim/deadsoldiers.js";
import { windowsNear, BMAP, peekOptions, closeOptions, braceOptions, DOOR_KINDS } from "../sim/buildingmaps.js";
import { WINDOW, windowsBy, windowState, windowWord, openRefusal, isWindow, windowOpen } from "../sim/windows.js"; // the map's windows: check, open, close, break (the user's request 2026-10-17)
import { WIRE, cutTargets, cutRefusal, cutterOf } from "../sim/wire.js"; // Cut wire (the user's request 2026-10-19)
import { SHOVE, BOARD, CRAWL, shoveTargets, shoveDests, shoveRefusal, shovePlan, tallPiece, canShove, shoveable, pieceName, boardTargets, boardRefusal, boardsOf, tearTargets, isBoarded, boardedName, boardedUnder, targetWord } from "../sim/barricade.js"; // furniture shoved in the way, doors and windows boarded up (the user's request 2026-10-18)
import { INTERIOR } from "../sim/interior.js";
import { PARLEY, parleyStatus, parleyGroupsSeen, callOutRefusal, callOutTargets } from "../sim/parley.js"; // other groups on a raid's map: Call out, hostile or not (the user's request 2026-10-20)
import * as PARLEY_SIM from "../sim/parley.js"; // the exports that may not be there yet (shoutCost), looked up when present
import { ALLY_ORDER, ALLY_ORDERS, allyOrderTargets, allyOrderRefusal, allyOdds, allyOrderOf, allyOrdersShown } from "../sim/allyorders.js"; // orders to allies on a raid's map (the user's request 2026-10-21)
import * as ALLY_SIM from "../sim/allyorders.js"; // the exports that may not be there yet (allyIntel: Tell me what you see), looked up when present
import { TENT_TAKE, tentsNear, strikeRefusal, slashTargets, slashRefusal, goesLeft, tentWord, tentWear } from "../sim/tentfight.js"; // Take down and Slash at a tent (the user's request 2026-10-20)
import { clearEnough } from "../sim/battlesize.js";
import { SUPPLIES, GEAR } from "../sim/data.js";
import { rescueOptions } from "../sim/rescueraid.js"; // a rescue raid on a group's base: captives, the cell, the armory
import { PUSH, pushTargets, pushRefusal, pushOdds, pushHazard } from "../sim/shoving.js"; // a foe shoved back a tile or flat on their back (the user's request 2026-10-20)
import { subdueOdds, canSubdue, throwablesOf, THROWABLES, THROW_KEYS, dragable, heldDown, STEALTH } from "../sim/stealth.js";
import { flashCells, flashReach, stunLabel, FRAG, BLAST, SMOKE } from "../sim/throwables.js"; // a flashbang's reach and stun; the throw preview
import { glLabel, glName, glRange, glLoads, glRounds, roundLabel, launchRefusal, glReloadRefusal, backblastCells, enclosedAt, LAUNCH, GL_HE, ROCKET } from "../sim/launchers.js"; // grenade launchers and rockets (section 13)
import { LIGHTS } from "../sim/lights.js";
import { VISION, viewWedges, faceAng, hasFront, setFacing, nightWord, darkSight, activeLight, nvgOn, nvgSight, facesBox, faceRefusal } from "../sim/vision.js"; // facing, view cones, sneaking (the user's request 2026-10-12)
import { noticeRange, earshot } from "../sim/stealth.js";
import { switchOptions, switchAt, roomAt, roomLit, INDOOR } from "../sim/indoorlight.js"; // a raid's dark rooms and light switches
import { keyHint as hintFor } from "./inputmode.js"; // the chip's words by the device in use (a finger, a controller)
import { LISTEN } from "./soundcues.js"; // deafened: the battle is heard muffled through the selected unit's ears
import { earStatus, visorState } from "../sim/hearing.js"; // deaf and dazed chips, the Visor toggle (sim/helmets.js)
import { noiseGhosts } from "../sim/crossfire.js"; // shots and blasts heard out of sight: markers in the fog with a guess of the sound
import { canPlace, LIT_ZONES } from "../sim/deploy.js";
import { layoutPanel, layoutHover, storeHover, storesHtml } from "./basemap.js"; // the base map's layout mode, the stores on the map
import { ghostAt, itemAtCell, storeAt, FOOT, keyOptions, keyTargets, KEY_AP, landPieceAt, gridOfCell } from "../sim/basemap.js"; // keyOptions: the defenders' keys (Lock, Unlock)
import { BUILDINGS, demolishRefund, TENTS, tentKind } from "../sim/buildings.js"; // layout mode's Demolish: the question names the building and the refund
import { ask } from "./confirm.js"; // one confirmation style (the base map's Demolish asks as the Construction tab's does)
const refundWords = (rec) => { const t = Object.entries(demolishRefund(rec) || {}).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${k}`).join(", "); return t ? ` (${t})` : ""; };
import { planFor, planStale, planKey, PLAN_MAPS, plansOf, currentPlan, planTags, startText, roleOf, PLAN, PLAN_WHO, PLAN_WHEN, PLAN_ROLES } from "../sim/defenceplan.js"; // the base's defence plans (the deploy step, the drill)
import { roomText, totalRoom } from "../sim/prisoners.js"; // jailhouse: prisoner room at your bases
import { bodyEmpty, itemLoad } from "../sim/inventory.js";
import { fieldReady } from "../sim/ground.js";
import { CALIBERS, AMMO_TYPES } from "../sim/data-ammo.js"; // the rounds a reload can take (the ammo chooser)
import { atVehicle, personalLoad, trunkInfo, trunkVehicle } from "../sim/raidloot.js";
import { SEARCH, quickable, quickRefusal, quickRadius, quickHurtPct } from "../sim/search.js";
export const QUICK_MARK = "#7fb8e6"; // a container rummaged through but not searched in full (both views)
import { unitCanvas, canvasURL, spriteImg } from "./sprites.js";
import { lockPanel, raidKeyLine, lockPreview } from "./locks.js";
import { lockAt, openOdds } from "../sim/locks.js"; // a click on a locked door (lockedDoorClick)
import { carPanel, carPreview } from "./carpanel.js"; // cars on the map: get in, keys, hotwire, inspect, claim (sim/foundcars.js)
import { ZTYPES } from "../sim/hiveconst.js";
import { ACID, acidAt } from "../sim/acid.js";
import { ladderTargets, pushable, pushChance, ramTargets, ramOf, dropTargets, RAM, LADDER, DROP } from "../sim/siege.js";
import { herded, sensesOf } from "../sim/decoys.js";
import { crushable, tappable, liftable, carriedBy, carHere, endangered, imminent, bodyAt as humanBodyAt, bodyName, unitBodyLoad, carRoom } from "../sim/carriers.js"; // the Carrier: bodies in danger, the risen, bodies carried, shot or burnt
import { holdsCart, cartsNear, takeRefusal, boxKg, cartSpec, parkCells } from "../sim/carts.js"; // a wheelbarrow, a hand cart in a fight: Let go, Take cart, Load cart
import { recText, handsKg, carriedNear, handsBusy, armsText, cartSupOf, handsCount, HANDS_MAX, handsTakeRefusal } from "../sim/carry.js"; // supplies, a bag or finds carried in the hands in a fight: Drop carried (free), Set over cover, Pick up load
import { statusIcons } from "./status.js"; // the survivor behind a unit: low mood, starving, thirsty, infected, sick (its own hit points are the bar)
import { barkFrame } from "./barks.js"; // combat barks: short speech bubbles over the units' heads
import { ingestMarks } from "./battlemarks.js"; // blood, brass and scorch read off each action's fx before the short fx list drops them
import { iso, drawIso, project, isoPick, isoRotate, isoZoom, isoPan, isoEdge, isoCenterOn, isoOnScreen, setRoofs, floorsOf, floorNo, onFloor, ISO_ZOOMS, LV, liftOf } from "./isoview.js";
import { keyAction, keyLabel, actionsOfCode, KEY_BY_ID } from "./keymap.js"; // the key table (Menu → Controls)
import { isMedic, healRefusal, healAmount, reviveRefusal, reviveOdds, liftRefusal, dropRefusal, dragging, finishRefusal, finishOdds, handsOdds, MEDIC, vehicleOf, pullTargets, pullRefusal, layInStab, selfKit, selfOdds, selfStabRefusal } from "../sim/medics.js"; // medics, dragging the downed, finishing a downed enemy, pulling one out of a vehicle
import { groundButtons, groundCbAct, groundClick } from "./ground.js"; // bodies searched where they fell, things on the ground (sim/ground.js)
import { nlButtons, nlAskHtml, nlCbAct, nlMapClick, nlOdds, nlConeMask, nlPreview, nlTags, nlStatus } from "./nonlethal.js"; // tasers, pepper spray, pulled blows, surrender (sim/nonlethal.js)
import { LOGWIN, logAction } from "./logwindow.js"; // the raid's log as a small window over the map (shown, folded, moved, resized)
import { raidCompact, RAIDUI } from "./responsive.js"; // a phone or an upright tablet: the raid's strip as one row, its cards a sheet (never on a desktop)
import { planAsideHtml, planAction, planChip, planUI } from "./raidplan.js"; // the plan put aside to look at the site: the card over the map and the chip in the strip (the window itself: ui.js pickModal)
import { planOpen, botPlan } from "../sim/raidplan.js";
import { hudPaint, hudSync, toggleHud, hitBreakdown, breakdownHtml, hitTone } from "./battlehud.js"; // the weapon panel, the squad strip, the big hit chances (user requests 2026-10-09)
import { barHtml } from "./battlebar.js"; // the bottom bar: the selected one's card, the orders, the turn controls (user request 2026-10-12)
import { devText, keyHint as say, padHtml, kh } from "./hints.js"; // the prompts and hints in the words of the device in use (a finger, a controller)
import { softWord } from "../sim/softcover.js"; // bushes and tents: what they hide, that they stop no bullets
import { watchCanvas } from "./pictures.js"; // the battle canvas reports a lost GPU context (the kept pictures would be blank)
import { planOf, moveAt } from "./moveanim.js"; // walking: each move walked out at the mover's pace, a unit's moves one after the other
// Ground-ring colors of a hive's special dead (sim/zombietypes.js); ordinary dead keep the green ring.
const ZRING = { runner: "#ffb43b", brute: "#c8c4b0", spitter: "#9ad63a", screamer: "#c99ae0", crawler: "#6ab0c8", shepherd: "#e8e2ff", soldier: "#a8b878", riot: "#8aa0c8", carrier: "#e6d8a8", swarm: "#f0e4c0", boneback: "#d8b48a", climber: "#8fd0a0", flinger: "#e8a0c8", sower: "#e8e070", nightmare: "#e0506e", digger: "#b08a5a", melter: "#c8f04a", husk: "#d8c09a", tripper: "#e2a02f", darkwalker: "#9a9ab8", sleeper: "#b0d8ff" };

// Battle size; raids use a bigger map. Set from the battle in sync().
let W = MAP_W, H = MAP_H;
const ENEMY_STEP_MS = 420;
// The enemy's next one goes once the last one seen walking is this far along its walk (the walks overlap a little, so a
// horde does not file past one at a time), never later than WALK_WAIT_MAX ms after it set off.
const WALK_WAIT = 0.6, WALK_WAIT_MAX = 2000;

export const cui = { battle: null, sel: null, mode: "move", hover: null, msg: "", lastStep: 0, anim: new Map(), movesSeen: 0, walkUntil: 0, cache: { key: "" }, autoPlay: false, pickedDown: null, facePick: null, cones: false, handAsk: null, handReq: null, shoveAsk: null }; // handAsk: the Hand over chooser open for this unit; handReq: { sid, mate } the two-doll window asked for (ui/inventory.js takeLootReq); shoveAsk: { uid, x, y } the piece picked for Shove, its destinations offered (sim/barricade.js)
// The view cones of everyone (yours and the enemies you see), on or off (Alt+C, the view bar), kept per machine.
const CONES_KEY = "bs.battle.cones";
try { cui.cones = typeof localStorage !== "undefined" && localStorage.getItem(CONES_KEY) === "1"; } catch { cui.cones = false; }
export function setCones(on) { cui.cones = !!on; try { if (typeof localStorage !== "undefined") localStorage.setItem(CONES_KEY, on ? "1" : "0"); } catch { /* private mode */ } } // autoPlay: the AI plays your side (cb-autoplay); pickedDown: one of the downed picked in the roster (autoSelect keeps them)
LISTEN.sel = () => cui.sel; // ui/soundcues.js: whose ears the battle is heard through
// ui/gunsfx.js: where on screen a sound is (pan, distance from the middle) and what your people see (out of sight: muffled).
LISTEN.cam = () => { if (!iso.cw) return null; const [x0, y0] = project(0, 0, 0), [x1, y1] = project(1, 0, 0); return { cw: iso.cw, ch: iso.ch, S: Math.hypot(x1 - x0, y1 - y0) / Math.hypot(16, 8), project }; };
LISTEN.vis = () => (cui.cache && cui.cache.vis) || null;
let canvas = null, ctx = null;

export function initCombatUI(cv) {
  canvas = cv;
  ctx = cv.getContext("2d");
  watchCanvas(cv); // ui/pictures.js: a lost GPU context coming back drops every kept picture, so the figures and the ground are drawn again
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
// One of the cells the team's own drivable vehicle covers (sim/combat.js b.vehicle).
const inTeamVehicle = (b, x, y) => { const v = b.vehicle; return !!v && x >= v.x && y >= v.y && x < v.x + v.w && y < v.y + v.h; };

// ---------- helpers ----------
const players = (b) => b.units.filter((u) => u.side === "player" && u.vol == null); // yours to order (volunteers are not: sim/combat.js volunteerTurn)
// Before going in (sim/raidplan.js: the plan open) the team is not on the map yet. A captive of yours on a rescue raid
// (sim/rescueraid.js u.captive) is there already, tied up in their base: shown and yours to order (acting with them
// goes in as things stand, the one way in a base has).
const holding = (b) => !!b && planOpen(b) && !b.over;
const held = (b, u) => holding(b) && !!u && u.side === "player" && !u.captive;
const allSide = (b) => b.units.filter((u) => u.side === "player"); // your side, volunteers too (heal, revive, drag)
const VOL_COLOR = "#c9a2ff"; // volunteers' ring, name and tag (ui/isoview.js the same)
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (u) => Math.max(0, Math.min(1, u.hp / u.maxHp));
const hpColor = (f) => (f > 0.6 ? PAL.good : f > 0.3 ? PAL.mid : PAL.bad);

// New battle: reset the screen state.
function sync(b) {
  W = b.w; H = b.h;
  if (cui.battle === b) return;
  const again = !!(cui.battle && cui.battle.setup === b.setup); // the same fight made again (a building picked, sim/raidplan.js: a side, a scout, the night)
  cui.battle = b;
  cui.sel = null;
  cui.mode = "move";
  cui.msg = "";
  cui.hover = null;
  cui.allyAsk = null;
  cui.tapAsk = null; cui.tapFace = null; // a finger's held order (combatTap) was the last battle's
  cui.anim.clear();
  cui.movesSeen = b.fxSeq || 0; // what was logged before is not walked again (stampMoves)
  cui.walkUntil = 0;
  if (!again) cui.salt = Math.floor(Math.random() * 9973); // varies zombie / enemy looks between battles (the same fight made again keeps them)
  cui.lastStep = performance.now();
  if (!again) cui.autoPlay = !!(b.setup && b.setup.watch); // a new battle starts in your hands (a fight you only watch plays itself: sim/volunteers.js)
  for (const f of b.fx) cui.anim.set(f.seq, performance.now());
  autoSelect(b, false); // the battle's opening camera stays as the view sets it
}

function autoSelect(b, center = true) {
  const cur = cui.sel != null ? unitById(b, cui.sel) : null;
  if (cur && cur.side === "player" && alive(cur) && cur.ap > 0) return;
  if (cur && cur.side === "player" && cur.down && !cur.dead && b.phase === "player" && (cui.pickedDown === cur.id || !selfStabRefusal(b, cur))) return; // sim/medics.js: one of the downed picked in the roster (their panel: stabilize yourself)
  const hold = holding(b);
  if (hold && cur && held(b, cur)) cui.sel = null; // the team is not on the map yet: nobody of it is picked
  const next = players(b).find((u) => alive(u) && u.ap > 0 && !held(b, u));
  cui.sel = next ? next.id : cur && alive(cur) && !held(b, cur) ? cur.id : null;
  cui.mode = "move";
  if (cui.sel != null && (!cur || cui.sel !== cur.id)) { // a new pick: the view goes to its floor, and the camera to them
    followFloor(b);
    const nu = selUnit(b);
    if (center && b.phase === "player" && nu && !nu.off) isoCenterOn(b, nu.x, nu.y);
  }
}

// Cached per battle revision: what the player sees, and where the selected unit can go.
function view(b) {
  const key = `${b.rev}:${cui.sel}:${floorNo(b)}`;
  if (cui.cache.key === key) return cui.cache;
  // Fog of war (sim/combat.js playerVision): what your people see now, by height, light, night and optics; the
  // enemies they see; ghosts where unseen ones were last seen.
  // Before going in (sim/raidplan.js: the plan open): the team is not on the map yet, so nothing is seen and nobody of
  // theirs; the scout's marks (b.ghosts, the fog's memory) are all the team knows.
  const hold = holding(b);
  const eyes = hold ? b.units.filter((e) => e.side === "player" && e.captive && active(e)) : []; // a rescue raid's captives see from where they are held
  const vis = hold ? heldVision(b, eyes) : playerVision(b);
  const u = selUnit(b);
  const reach = u && active(u) && u.ap > 0 && b.phase === "player" && !held(b, u) ? reachable(b, u, SIM.moveMob(u) * u.ap, { manual: true }) : null; // an order by hand may walk into fire
  const seen = new Set((hold ? b.units.filter((e) => e.side !== "player" && active(e) && eyes.some((eye) => canSeeAt(b, eye, e.x, e.y)))
    : b.units.filter((e) => e.side !== "player" && active(e) && (b.over || playerSees(b, e)))).map((e) => e.id)); // the enemy and the third side (sim/thirdside.js)
  const ghosts = b.over ? [] : hold ? planGhosts(b) : enemyGhosts(b).concat(noiseGhosts(b)); // sim/crossfire.js: shots and blasts heard, not seen, with a guess
  const known = rememberSeen(b, vis);
  cui.cache = { key, vis, reach, seen, u, ghosts, known };
  return cui.cache;
}
// What the captives see while the plan is open (the team's eyes are not on the map yet).
function heldVision(b, eyes) {
  const vis = new Uint8Array(b.w * b.h);
  if (!eyes.length) return vis;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) for (const e of eyes) if ((e.x === x && e.y === y) || canSeeAt(b, e, x, y)) { vis[y * b.w + x] = 1; break; }
  return vis;
}
// The scout's marks while the plan is open (sim/raidplan.js applyScout: b.ghosts), whoever of theirs the team placed by
// the sim would see from the zone: nobody is there yet.
function planGhosts(b) {
  const out = [];
  for (const e of b.units) {
    const g = b.ghosts && b.ghosts[e.id];
    if (!g || e.side !== "enemy" || e.dead || e.left || e.fled || e.off) continue;
    if (b.floors && (g[3] || 0) !== (b.floor || 0)) continue;
    out.push({ id: e.id, x: g[0], y: g[1], turn: g[2], f: g[3] || 0, kind: e.kind, name: e.name, unit: e, heard: !!g[4] });
  }
  return out;
}
// What your people have ever seen on each floor of this battle (the fog of war indoors, ui/isoview.js): the cells,
// and each container's state when last seen (its marker under the fog shows that, not what it is now). Kept on the
// battle as plain data so a save keeps it (b.seenMemo[floor] = { cells: "0101…" one character a cell, boxes: { id:
// state } }); the drawing reads a byte array made from it (kept here, rebuilt after a load).
const MEMO = new WeakMap(); // b → { [floor]: { cells: Uint8Array, boxes: Map } }: the working copy
function rememberSeen(b, vis) {
  const saved = b.seenMemo || (b.seenMemo = {});
  let m = MEMO.get(b);
  if (!m) MEMO.set(b, (m = {}));
  const f = floorNo(b);
  let k = m[f];
  if (!k || k.cells.length !== vis.length) {
    k = m[f] = { cells: new Uint8Array(vis.length), boxes: new Map() };
    const sv = saved[f];
    if (sv && typeof sv.cells === "string" && sv.cells.length === vis.length) for (let i = 0; i < vis.length; i++) k.cells[i] = sv.cells.charCodeAt(i) === 49 ? 1 : 0;
    if (sv && sv.boxes) for (const [id, snap] of Object.entries(sv.boxes)) k.boxes.set(Number(id), snap);
  }
  let fresh = !saved[f];
  for (let i = 0; i < vis.length; i++) if (vis[i] && !k.cells[i]) { k.cells[i] = 1; fresh = true; }
  let boxes = false;
  if (b.raid) for (const c of b.raid.containers) {
    if ((c.f || 0) !== f) continue;
    let now = false;
    for (let y = c.y; y < c.y + (c.h || 1) && !now; y++) for (let x = c.x; x < c.x + (c.w || 1); x++) if (vis[y * b.w + x]) { now = true; break; }
    if (!now) continue;
    const snap = { searched: !!c.searched, quick: !!c.quick, partial: !!c.partial, lock: c.lock ? { ...c.lock } : null };
    const old = k.boxes.get(c.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(snap)) { k.boxes.set(c.id, snap); boxes = true; }
  }
  if (fresh || boxes) saved[f] = { cells: Array.from(k.cells, (v) => (v ? "1" : "0")).join(""), boxes: Object.fromEntries(k.boxes) };
  return k;
}
// Your own base (its yard, its buildings, a fall back to them): known inside out, no fog indoors.
const ownGround = (b) => !!b.tier || (!b.raid && b.setup && b.setup.baseId != null && !b.setup.afield); // afield (sim/loneattack.js): one of the base's people attacked out on the land

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
// The belt (sim/holsters.js; the user's request 2026-10-21): the side arm or the melee weapon drawn, or the slung main
// weapon taken back, DRAW_AP (1 action) each; a button for each holster with something in it and the sling.
export const DRAW_V = { sidearm: "drawside", melee: "drawmelee", main: "drawmain" };
const DRAW_SLOT = { drawside: "sidearm", drawmelee: "melee", drawmain: "main" };
function holsterButtons(state, b, u, btn) {
  const s = u.side === "player" && u.sid != null ? (state.survivors || []).find((x) => x.id === u.sid) : null;
  if (!s || u.aboard) return "";
  const held = s.gear && s.gear.weapon;
  for (const o of drawOptions(s)) {
    const why = SIM.drawRefusal(b, u, s, o.slot);
    const label = o.slot === "sidearm" ? "Draw side arm" : o.slot === "melee" ? "Draw melee" : "Main weapon";
    const what = o.slot === "main" ? `take the slung ${esc(o.item.name)} back in the hands` : `draw the ${esc(o.item.name)} from the ${o.slot === "sidearm" ? "side arm" : "melee"} slot`;
    const put = drawPlan(s, o.slot).put;
    const away = held && put ? ` The ${esc(held.name)} ${put === "slung" ? "is slung (Main weapon takes it back)" : `goes back in the ${put === "sidearm" ? "side arm" : "melee"} slot`}.` : "";
    const use = o.slot === "melee" ? " A melee weapon strikes the enemy right next to them (Melee, V) and makes no noise: for when the rounds run out or the dead are too close." : o.slot === "sidearm" ? " A handgun with what is in it (one carried into the fight is loaded from the rounds they carry); Reload as usual." : "";
    btn(DRAW_V[o.slot], label, `${DRAW_AP} action: ${what}.${away}${use}`, !why, "", { why, ap: DRAW_AP });
  }
  return "";
}
// The spare magazines a fighter of yours carries (sim/mags.js): "+3 mags", "2 clips".
function magsTag(b, u) {
  const t = magsLine(b, u);
  return t ? ` <span class="muted" data-tip="${esc(`Spare magazines: a Reload takes the next loaded one (1 action from a rig pouch or a pocket, 2 from the pack); with none left it loads rounds by hand, up to ${MAGS.LOOSE} a Reload, from what they carry. ${spareRounds(b, u)} rounds in them.`)}">${esc(t)}</span>` : "";
}
function gunFlag(b, u) {
  return u.side === "player" && isRanged(u) && !u.dead && magShown(b, u) < (WEAPONS[u.weapon].ammo || 1)
    ? (reloadRefusal(b, u) ? ' <span class="danger">Out of ammo</span>' : ' <span class="danger">Empty — reload (I)</span>') : "";
}
// Your own gun: the round it is loaded with (a kind other than the standard) and its fire mode.
function ownGunTag(u) {
  const c = CALIBERS[WEAPONS[u.weapon] && WEAPONS[u.weapon].cal];
  const load = u.load && c && u.load !== c.base && (AMMO_TYPES[u.load] || String(u.load).includes(":")) ? ` <span class="muted">${esc(AMMO_TYPES[u.load] ? AMMO_TYPES[u.load].name : roundName(WEAPONS[u.weapon].cal, u.load))}</span>` : ""; // (another calibre: ".223 Rem FMJ")
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
  if (padForce) return { x: padForce.x, y: padForce.y }; // a controller's press: its cursor's cell, whatever stands in front of it on the screen
  const c = cui.battle ? isoPick(cui.battle, px, py) : null;
  return c ? { x: c.x, y: c.y } : null;
}

// edge false: a tap (main.js touchGestures) shows what is under the finger, but a finger near the edge does not pan.
export function combatMouse(state, px, py, edge = true) {
  const b = state.combat;
  if (!b) return;
  sync(b);
  // Dragging pans the isometric view (the click it started is not made).
  if (cui.drag) {
    const d = cui.drag;
    if (!d.moved && Math.hypot(px - d.x0, py - d.y0) > 6) d.moved = true;
    if (d.moved) { isoPan(b, px - d.px, py - d.py); d.px = px; d.py = py; return; }
  }
  if (canvas && edge) isoEdge(px, py, canvas.clientWidth, canvas.clientHeight, performance.now());
  const c = cellFromPx(px, py);
  cui.hover = c ? { ...c, px, py } : null;
  const el = typeof document !== "undefined" && document.getElementById("cbprev");
  if (el) { el.innerHTML = previewHtml(b, state); el.classList.toggle("empty", !cui.hover); } // a raid's card over the map hides while nothing is hovered (styles.css)
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
  if (!d.moved && d.button === 2 && allyBack()) { cui.redraw = true; return null; } // Ally orders: back a step, not out (main.js cancelAction would drop it all)
  return d.moved ? "drag" : d.button === 0 ? "click" : d.button === 2 ? "cancel" : null;
}
// A finger dragging the battle map (main.js touchGestures): the view goes with it, as a mouse drag pans it.
export function combatPan(state, dx, dy) {
  const b = state.combat;
  if (!b) return;
  sync(b);
  isoPan(b, dx, dy);
}
export function combatWheel(state, px, py, dy) {
  const b = state.combat;
  if (!b) return false;
  sync(b);
  isoZoom(b, dy < 0 ? 1 : -1, px, py);
  return true;
}

// ---------- a finger's tap: first the preview, then the order (main.js touchGestures; never the mouse) ----------
// A mouse sees what a click would do before it clicks (the hover: the path and its cost, the hit chance, a grenade's
// blast); a finger only lands. So a tap that would send an order (anything combatClick hands to act: a move, a shot,
// a throw, a search, a door, an ally's order...) is tried first with act() catching the order (dry), the screen put
// back as it was, and the order held in cui.tapAsk: the hover's preview stays on the map and a chip over it names the
// order (the hover card's own words). The same cell again, or the chip's ✓, sends it as the mouse's click would; another
// cell moves the preview there; ✕, a long press, another unit or mode, or anything happening (b.rev) drops it. A tap that
// sends nothing (selecting one of yours, picking a mode's target step, opening a searched container) is made at once.
// Options → "Battles: confirm taps" (touch screens only) turns it off.
const TAP_KEY = "bs.battle.tapConfirm";
try { cui.tapConfirm = typeof localStorage === "undefined" || localStorage.getItem(TAP_KEY) !== "0"; } catch { cui.tapConfirm = true; }
export function setTapConfirm(on) { cui.tapConfirm = !!on; cui.tapAsk = null; cui.tapFace = null; try { localStorage.setItem(TAP_KEY, on ? "1" : "0"); } catch { /* private mode */ } }
cui.tapAsk = null;  // { x, y, ox, oy, a, html, key }: the order a tap holds; ox / oy: the finger off the cell's foot, art px
cui.tapFace = null; // { x, y, ox, oy, html, key }: a move's tile picked by a tap, its facing still to pick (facemove)
// Free and harmless: made at once. checkwindow learns how a window opens (sim/windows.js: no action, nothing heard).
const TAP_NOW = new Set(["checkwindow"]);
const TAP_VERB = { move: "Move", shoot: "Shoot", melee: "Strike", throw: "Throw", suppress: "Suppress", throwspear: "Throw spear", launch: "Fire", pepper: "Pepper spray", drag: "Drag", dragAlly: "Drag", tie: "Tie up", doubletap: "Double tap", pickup: "Pick up body", crush: "Crush skull", heal: "Heal", revive: "Revive", finish: "Finish", meds: "Meds for", parkCart: "Park the cart", drive: "Drive", search: "Search", searchBody: "Search the body", lights: "Flip the lights", keylock: "Lock", keyunlock: "Unlock", open: "Open", peek: "Peek", close: "Close the door", brace: "Brace the door", openwindow: "Open the window", closewindow: "Close the window", breakwindow: "Break the window", climb: "Climb through", boardup: "Board up", teardown: "Tear down", cutwire: "Cut the wire", strike: "Strike", slashtent: "Slash the tent", shove: "Shove", shoveFoe: "Shove", callout: "Call out to", allyorder: "Ally order", overwatch: "Overwatch this way", face: "Face this way", taser: "Taser", subdue: "Subdue", place: "Place" };
// What a held preview depends on: any of it changing drops it (the chip would name another order).
const tapKey = (b) => [b.setup && b.setup.tile, cui.sel, cui.mode, b.rev, b.turn, b.phase, !!b.over, floorNo(b), iso.rot, iso.straight, cui.throwKey, cui.dragId, cui.facePick ? `${cui.facePick.x},${cui.facePick.y}` : "", cui.allyAsk ? JSON.stringify(cui.allyAsk) : "", cui.shoveAsk ? `${cui.shoveAsk.x},${cui.shoveAsk.y}` : ""].join("|");
// An order compared with the one previewed (a facing angle within a hundredth: the view may have moved a pixel).
const tapSig = (a) => JSON.stringify(a, (k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v));
// The tapped point, kept on the map: art px off the cell's foot, and back to screen px with the view as it is now.
function tapAnchor(c, px, py) {
  const S = ISO_ZOOMS[iso.zoom] || 2, [X, Y] = project(c.x + 0.5, c.y + 0.5, 0);
  return { x: c.x, y: c.y, ox: (px - X) / S, oy: (py - Y) / S };
}
function tapPoint(q) {
  const S = ISO_ZOOMS[iso.zoom] || 2, [X, Y] = project(q.x + 0.5, q.y + 0.5, 0);
  return [X + q.ox * S, Y + q.oy * S];
}
// combatClick with act() catching the order: the order it would send, the screen put back as it was before; or null:
// it sends none, and the click is made (a unit selected, a mode's next step, a window opened).
function tapProbe(state, px, py) {
  const keep = { ...cui };
  dry = { a: null };
  let a = null;
  try { combatClick(state, px, py); } finally { a = dry.a; dry = null; }
  if (!a) return null;
  for (const k of Object.keys(cui)) if (!(k in keep)) delete cui[k];
  for (const k of Object.keys(keep)) if (k !== "cache") cui[k] = keep[k];
  return a;
}
// The chip's words: the order and whom or where (its first line), the hit chance or the cost (the hover card's own).
function tapHtml(state, b, a) {
  const u = unitById(b, a.unit), t = a.target != null && typeof a.target === "number" ? unitById(b, a.target) : null, v = view(b);
  const who = t ? ` ${esc(t.name)}` : "";
  let head = `<b>${esc(TAP_VERB[a.type] || cap1(String(a.type)))}${who}</b>`, body = "";
  if (t && u && t.side !== "player" && ["shoot", "melee", "taser", "subdue", "shoveFoe", "finish"].includes(a.type)) {
    const o = odds(b, u, t);
    if (o && o.ok && o.chance != null) head += ` <b class="cbbig ${hitTone(o.chance)}">${o.chance}%</b>`;
    body = o ? esc(o.ok && o.chance != null ? String(o.label).replace(`${o.chance}% `, "") : o.label) : ""; // "to hit, 15–22 damage, …": the number is in the head
  } else if (a.type === "move" && u) {
    if (a.face != null) head = "<b>Move, then face this way</b>";
    body = moveWord(b, u, v, a.x, a.y) || "Out of reach.";
  } else if (a.type === "face") body = "Free (it needs an action left): the cone shows what they will watch.";
  else if (a.type === "overwatch") body = esc(OVERWATCH_TIP.split(". ")[0] + ".") + " Only what moves in the cone draws a reaction.";
  else if (a.type === "throw" && u && THROWABLES[a.item]) {
    const T = THROWABLES[a.item], tp = throwPreview(b, u), area = new Set(tp ? tp.cells.filter((c) => c[2]).map(([x, y]) => y * W + x) : []);
    const inIt = b.units.filter((o) => active(o) && !o.off && (area.has(o.y * W + o.x) || (tp && tp.caught.includes(o))) && (o.side === "player" || v.seen.has(o.id)));
    const mine = inIt.filter((o) => o.side === "player").length, theirs = inIt.length - mine;
    head = `<b>Throw ${esc(T.label || (GEAR[a.item] || {}).name || a.item)}</b>`;
    body = Math.hypot(a.x - u.x, a.y - u.y) > T.range + 0.01 ? `<span class="warn">Out of reach: ${T.range} tiles at most.</span>` : area.size || (tp && tp.caught.length) ? `${theirs ? `catches ${theirs} of them` : "nobody of theirs in it"}${mine ? ` · <span class="danger">and ${mine} of yours!</span>` : ""}` : `lands ${Math.round(Math.hypot(a.x - u.x, a.y - u.y))} tiles off`;
  } else body = String(previewHtml(b, state)).split("<br>")[0]; // the hover card's first line: the aim, the ally's order, the door...
  if (a.type === "search" || a.type === "searchBody") head += ` <span class="muted">${a.quick ? "a quick rummage: no action, heard nearby" : `${SEARCH.ap} action`}</span>`;
  return `<div class="tc-head">${head}</div>${body ? `<div class="tc-body">${body}</div>` : ""}`;
}
// main.js: a finger's tap on the battle map (after combatMouse put the hover there). always: confirm whatever Options
// say (a controller's A: combatPadA).
export function combatTap(state, px, py, always = false) {
  const b = state.combat;
  if (!b) return;
  sync(b);
  const c = cellFromPx(px, py), p = cui.tapAsk, f = cui.tapFace;
  cui.tapAsk = null; cui.tapFace = null;
  if (!(cui.tapConfirm || always) || b.over || b.layout || b.phase !== "player" || !c) return void combatClick(state, px, py); // the base map's layout and the deploy step place things, and take them back
  if (p && p.key === tapKey(b) && c.x === p.x && c.y === p.y) return void tapGo(state, b, p, px, py);
  // A move's tile tapped again: they go, facing the way they walk (the mouse's second click on the tile itself).
  if (cui.mode === "facemove" && cui.facePick && c.x === cui.facePick.x && c.y === cui.facePick.y) return void combatClick(state, px, py);
  const third = cui.thirdAsk;
  const a = tapProbe(state, px, py);
  if (!a) { // made: and a move's tile picked shows its cost and how to go on
    const u = selUnit(b), fp = cui.facePick;
    if (cui.mode === "facemove" && fp && u) cui.tapFace = { ...tapAnchor(fp, px, py), key: tapKey(b), html: `<div class="tc-head"><b>Move here</b></div><div class="tc-body">${moveWord(b, u, view(b), fp.x, fp.y)} ${hintFor({ key: `Tap the tile again to go; elsewhere, the way ${esc(u.name.split(" ")[0])} should face there; ✕, another tile.`, pad: `Ⓐ on it again to go; the cursor elsewhere and Ⓐ, the way ${esc(u.name.split(" ")[0])} should face there; Ⓑ, another tile.` })}</div>` };
    return;
  }
  // Attacking the third side already takes two clicks, the first one saying what it costs (sim/thirdside.js).
  if (TAP_NOW.has(a.type) || (third != null && a.target === third)) return void combatClick(state, px, py);
  cui.tapAsk = { ...tapAnchor(c, px, py), a: tapSig(a), html: tapHtml(state, b, a), key: tapKey(b) };
  if (f && cui.mode === "facemove") cui.tapFace = f; // the way to face previewed: ✕ goes back to the move's own chip
  cui.msg = "";
}
// The order held, sent: the click made again at the tapped point (where it is now: the view may have moved), as long as
// it still sends the order previewed; else that one is previewed instead.
function tapGo(state, b, p, px, py) {
  const [X, Y] = tapPoint(p), c = cellFromPx(X, Y);
  if (c && c.x === p.x && c.y === p.y) { px = X; py = Y; }
  const a = tapProbe(state, px, py);
  if (!a) return;
  if (tapSig(a) !== p.a) { cui.tapAsk = { ...p, a: tapSig(a), html: tapHtml(state, b, a), key: tapKey(b) }; return; }
  combatClick(state, px, py);
}
// The chip's buttons (main.js "cb-tap"): go (✓) or no (✕).
export function combatTapChip(state, v) {
  const b = state.combat;
  if (!b) return;
  sync(b);
  const p = cui.tapAsk, f = cui.tapFace;
  cui.tapAsk = null;
  if (p && p.key === tapKey(b)) {
    if (v === "go") { cui.tapFace = null; const [X, Y] = tapPoint(p); tapGo(state, b, p, X, Y); }
    else cui.hover = null;
    return;
  }
  cui.tapFace = null;
  if (f && f.key === tapKey(b) && cui.mode === "facemove") {
    const u = selUnit(b), fp = cui.facePick;
    cui.mode = "move"; cui.facePick = null; cui.msg = "";
    if (v === "go" && u && fp) act(state, { type: "move", unit: u.id, x: fp.x, y: fp.y }); // the tile itself: the way they walk
  }
}
// Each frame (hudFrame): the chip over the tapped point, inside the map between the top and the orders bar; the
// preview drawn from the hover kept on that point while the view moves. Dropped once what it showed has changed.
let tapEl, tapShown = "";
function tapFrame(b, cw, ch, bottom) {
  if (cui.tapAsk && cui.tapAsk.key !== tapKey(b)) cui.tapAsk = null;
  if (cui.tapFace && cui.tapFace.key !== tapKey(b)) cui.tapFace = null;
  const q = cui.tapAsk || cui.tapFace;
  if (!q && !tapShown) return;
  if (tapEl === undefined || (tapEl && !tapEl.isConnected)) {
    const wrap = typeof document !== "undefined" && document.getElementById ? document.getElementById("cbmapwrap") : null;
    tapEl = wrap ? document.getElementById("cbtapask") || wrap.appendChild(Object.assign(document.createElement("div"), { id: "cbtapask" })) : null;
  }
  if (!tapEl) return;
  if (!q) { tapEl.hidden = true; tapEl.innerHTML = ""; tapShown = ""; return; }
  const ask = q === cui.tapAsk;
  const html = `${q.html}<div class="tc-foot"><span class="tc-hint">${ask ? hintFor({ key: "Tap again to confirm", pad: "Ⓐ again to confirm · Ⓑ no" }) : ""}</span><button class="mini tc-no" data-action="cb-tap" data-v="no" data-tip="${ask ? "Not this" : "Pick another tile"}">✕</button><button class="mini tc-go" data-action="cb-tap" data-v="go">${ask ? "Confirm ✓" : "Go ✓"}</button></div>`;
  if (html !== tapShown) { tapEl.innerHTML = html; tapShown = html; tapEl.hidden = false; }
  const [X, Y] = tapPoint(q);
  if (ask && cui.hover && cui.hover.x === q.x && cui.hover.y === q.y) { cui.hover.px = X; cui.hover.py = Y; }
  // On the far side of the tapped point from the unit (the path, the line of fire or the cone between them stays in
  // sight), over it when that is a tie; the other side if there is no room; never off the map's visible part.
  const w = tapEl.offsetWidth, h = tapEl.offsetHeight, m = 8, gap = 30, u = selUnit(b);
  const uy = u ? project(u.x + 0.5, u.y + 0.5, 0)[1] : Y + 1;
  const up = Y - gap - h, down = Y + gap, fitsUp = up >= m, fitsDown = down + h <= ch - bottom - m;
  const top = uy < Y - 4 ? (fitsDown || !fitsUp ? down : up) : (fitsUp || !fitsDown ? up : down);
  tapEl.style.left = `${Math.round(Math.max(m, Math.min(cw - w - m, X - w / 2)))}px`;
  tapEl.style.top = `${Math.round(Math.max(m, Math.min(ch - bottom - h - m, top)))}px`;
}

// ---------- a controller (main.js's battle layer; ui/gamepad.js) ----------
// A cell cursor the left stick or the D-pad moves a cell at a time, the way the screen goes (up is up the screen however
// the view is turned). The hover a mouse would give is kept on it, so the path and its cost, the hit chance, the cone
// and the blast show for that cell as under the mouse. A is a finger's tap that always asks first (combatTap, always:
// the first A previews with the chip, the second sends), B steps back as Esc does, LB / RB go through your people as
// Shift+Tab / Tab. All of it only while the controller is the device in use (ui/inputmode.js): main.js turns the cursor
// off (combatPadOff) as soon as the mouse, a key or a finger is used.
export const padCur = { on: false, x: -1, y: -1, b: null, shown: "" };
let padForce = null; // { x, y }: the cell a controller's press is for (cellFromPx)
const padPt = (b, x, y) => project(x + 0.5, y + 0.5, hz(b, x, y) * LV + liftOf(b));
function padHover(state, b) {
  const [px, py] = padPt(b, padCur.x, padCur.y);
  cui.hover = { x: padCur.x, y: padCur.y, px, py };
  const key = `${padCur.x},${padCur.y}|${b.rev}|${cui.sel}|${cui.mode}`;
  if (key === padCur.shown) return;
  padCur.shown = key;
  const el = typeof document !== "undefined" && document.getElementById("cbprev");
  if (el) { el.innerHTML = previewHtml(b, state); el.classList.toggle("empty", false); } // as combatMouse writes it
}
// The cursor on: on the selected one of yours, else the cell in the middle of the screen.
export function combatPadOn(state) {
  const b = state.combat;
  if (!b || !canvas) return false;
  sync(b);
  if (padCur.on && padCur.b === b) return false;
  const u = selUnit(b), mid = isoPick(b, canvas.clientWidth / 2, canvas.clientHeight / 2, { noUnits: true });
  const at = u && !u.off && onFloor(b, u) ? u : mid || { x: b.w >> 1, y: b.h >> 1 };
  Object.assign(padCur, { on: true, x: at.x, y: at.y, b, shown: "" });
  padHover(state, b);
  return true;
}
export function combatPadOff() {
  if (!padCur.on) return;
  padCur.on = false; padCur.b = null;
  cui.hover = null;
  cui.tapAsk = null; cui.tapFace = null; // the chips are a pad's and a finger's: a mouse never sees one
}
// One step of the cursor toward screen direction (dx, dy): the neighbouring cell whose middle lies most that way.
// Near the edge of what is in view (or under the orders bar) the camera goes to it.
export function combatPadMove(state, dx, dy) {
  const b = state.combat;
  if (!b || !padCur.on || !canvas) return;
  sync(b);
  const [X0, Y0] = project(padCur.x + 0.5, padCur.y + 0.5, 0), n = Math.hypot(dx, dy) || 1;
  let best = null, bd = 0.55;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const x = padCur.x + i, y = padCur.y + j;
    if ((!i && !j) || x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    const [X, Y] = project(x + 0.5, y + 0.5, 0), ox = X - X0, oy = Y - Y0, d = (ox * dx + oy * dy) / ((Math.hypot(ox, oy) || 1) * n);
    if (d > bd + 1e-6) { bd = d; best = [x, y]; }
  }
  if (!best) return;
  [padCur.x, padCur.y] = best;
  cui.tapAsk = null; // the preview held was for the cell left (a move's tile picked keeps its chip: the facing is picked next)
  padHover(state, b);
  const [X, Y] = padPt(b, padCur.x, padCur.y), m = 70, cw = canvas.clientWidth, ch = canvas.clientHeight - (iso.bottomInset || 0);
  if (X < m || Y < m || X > cw - m || Y > ch - m) isoCenterOn(b, padCur.x, padCur.y);
}
// Each frame: the hover stays on the cursor while the view moves under it (a pan, a zoom, the camera following).
export function combatPadFrame(state) {
  const b = state.combat;
  if (!b || !padCur.on) return;
  if (padCur.b !== b) { padCur.on = false; combatPadOn(state); return; } // another battle (the same fight made again)
  padHover(state, b);
}
// A: what a click on the cursor's cell would do, asked first when it sends an order.
export function combatPadA(state) {
  const b = state.combat;
  if (!b || !padCur.on) return;
  sync(b);
  padHover(state, b);
  const [px, py] = padPt(b, padCur.x, padCur.y);
  padForce = { x: padCur.x, y: padCur.y };
  try { combatTap(state, px, py, true); } finally { padForce = null; }
  padCur.shown = "";
}
// B: the order asked about dropped, a move's tile let go, else Esc. True when something was dropped.
export function combatPadB(state) {
  const b = state.combat;
  if (!b) return false;
  sync(b);
  if (cui.tapAsk) { cui.tapAsk = null; return true; }
  if (cui.tapFace) { combatTapChip(state, "no"); return true; }
  return battleEsc();
}
// LB / RB: the previous or next of yours with actions left; the cursor goes to them.
export function combatPadCycle(state, d) {
  const b = state.combat;
  if (!b || b.over) return;
  sync(b);
  if (holding(b) && !(selUnit(b) && selUnit(b).captive)) return;
  cycleUnit(b, d);
  const u = selUnit(b);
  if (u && !u.off && padCur.on) { padCur.x = u.x; padCur.y = u.y; cui.tapAsk = null; padHover(state, b); }
}
// Y: End turn as its button (asks while anyone has actions; again ends it), Start the fight on the deploy step, Close
// on the result.
export function combatPadEnd(state) {
  const b = state.combat;
  if (!b) return;
  sync(b);
  if (holding(b) && !(selUnit(b) && selUnit(b).captive)) return;
  if (b.over) return void closeCombat(state);
  if (b.phase === "deploy") { if (!b.layout && !b.drill) act(state, { type: "start" }); return; }
  requestEndTurn(state, "button");
}
// LT / RT: a zoom step about the cursor.
export function combatPadZoom(state, d) {
  const b = state.combat;
  if (!b) return;
  const [px, py] = padCur.on ? padPt(b, padCur.x, padCur.y) : [canvas ? canvas.clientWidth / 2 : 0, canvas ? canvas.clientHeight / 2 : 0];
  combatWheel(state, px, py, d);
}

// Selecting a unit that is off screen brings the camera to it.
function follow(b) {
  const u = selUnit(b);
  followFloor(b, u);
  if (u && !isoOnScreen(b, u.x, u.y)) isoCenterOn(b, u.x, u.y);
}

let dry = null; // tapProbe: { a } while a finger's tap is tried out; the order a click would send is caught here, not sent
function act(state, a) {
  if (dry) { dry.a = a; return false; } // "refused": what the click does after a sent order (a window opened) is not done
  const b = state.combat;
  const err = combatAct(state, a);
  if (b) ingestMarks(b, performance.now());
  cui.msg = err || "";
  cui.pickedDown = null; // a downed one picked in the roster stays picked only until something is done
  if (!err && a.type !== "end") {
    const u = unitById(b, a.unit);
    if (u && u.side === "player") followFloor(b, u); // Go up / Go down: the view goes with them
    if (!u || !active(u) || u.ap < 1 || ["throw", "drag", "tie", "subdue", "shoveFoe", "taser", "pepper", "execute", "surrender", "peek", "close", "brace", "checkwindow", "openwindow", "closewindow", "breakwindow", "shove", "boardup", "teardown", "cutwire", "strike", "slashtent", "keylock", "keyunlock", "doubletap", "pickup", "crush", "goup", "godown", "drive", "loadRam", "unloadRam", "board", "disembark", "turn", "heal", "revive", "dragAlly", "dropAlly", "finish", "pullOut", "suppress", "throwspear", "unjam", "launch", "glreload", "face", "overwatch", "callout", "allyorder"].includes(a.type)) cui.mode = "move";
    cui.ammoAsk = null;
    cui.shoveAsk = null; // the Shove chooser (sim/barricade.js) closes once anything is done
    if (a.type !== "face") cui.handAsk = null; // the Hand over chooser stays open across the free Face toward the mate
  }
  autoSelect(b);
  return !err;
}

// An order from outside the battle panel (ui/itemmenu.js: the item menu's Reload, Use meds, a bite): as a button would.
export const battleOrder = (state, a) => act(state, a);

export function combatClick(state, px, py) {
  const b = state.combat;
  if (!b || b.over) return;
  sync(b);
  if (holding(b) && !(selUnit(b) && selUnit(b).captive)) { cui.msg = "Nobody is on the map yet: pick the side to go in from in the plan (Back to the plan, or Esc)."; return; } // sim/raidplan.js: looking at the site before going in (a captive of yours can still act)
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
  if (b.layout) return void layoutClick(state, b, px, py); // the base map (sim/basemap.js): placing things
  if (b.phase === "deploy") return void deployClick(state, b, px, py);
  if (b.phase !== "player") { cui.msg = "Wait for the enemy turn to finish."; return; }
  const c = cellFromPx(px, py);
  if (!c) { if (allyMode()) cui.msg = "Off the map: click a tile on it."; return; }
  const v = view(b);
  const u = selUnit(b);
  const who = unitAt(b, c.x, c.y);
  // vision.js: the way to face. After a move's tile is picked (facemove), Face (face) and Overwatch (overwatch): the
  // click picks the direction from where they stand (or will stand); the tile itself keeps the way they walk.
  if (u && active(u) && (cui.mode === "facemove" || cui.mode === "face" || cui.mode === "overwatch")) {
    const fp = cui.mode === "facemove" ? cui.facePick : null;
    if (cui.mode === "facemove" && (!fp || fp.uid !== u.id || fp.rev !== b.rev)) { cui.mode = "move"; cui.facePick = null; }
    else {
      const from = fp || u, ang = mouseAngle(b, from.x, from.y, px, py);
      if (cui.mode === "facemove") { cui.mode = "move"; cui.facePick = null; return void act(state, { type: "move", unit: u.id, x: fp.x, y: fp.y, ...(ang != null ? { face: ang } : {}) }); }
      if (cui.mode === "face") { if (ang == null) { cui.msg = "Click away from them, the way they should face."; return; } return void act(state, { type: "face", unit: u.id, face: ang }); }
      return void act(state, { type: "overwatch", unit: u.id, ...(ang != null ? { face: ang } : {}) });
    }
  }
  if (allyMode()) return void allyClick(state, b, u, c, who); // Ally orders (sim/allyorders.js): the ally, then what the order needs
  if (u && active(u) && groundClick(state, b, u, c, cui, act)) return; // ui/ground.js: the body picked to search
  // sim/carts.js Park cart: click the free cell next to the pusher to leave the cart on (a doorway to plug, cover).
  if (u && active(u) && cui.mode === "parkCart") { cui.mode = "move"; return void act(state, { type: "parkCart", unit: u.id, x: c.x, y: c.y }); }
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
    if (cui.mode === "handover" && u && who !== u) return void openHandover(state, b, u, who); // sim/combat.js handoverTargets: the mate clicked
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
  // Lock or Unlock picked with several locks in reach (sim/basemap.js keyAct): the door, the gate or the container clicked.
  if (u && active(u) && (cui.mode === "keylock" || cui.mode === "keyunlock")) return void act(state, { type: cui.mode, unit: u.id, x: c.x, y: c.y });
  // A store on a base map (sim/basemap.js): a click on the building (its walls, roof or crates) shows what is in it; a
  // store of theirs on an assault (sim/assaultstores.js) with the selected one of yours next to it, its lock open: the
  // search window on it (taking costs hauling time, as a raid's search).
  if (b.stores && !who) {
    const sc = storeAt(b, c.x, c.y);
    if (sc && !CDEF(b.cells[c.y * W + c.x]).walk) {
      if (sc.contents && u && active(u) && nearBox(u, sc) && !(sc.lock && !sc.lock.open)) { cui.storeView = sc.id; cui.lootReq = { uid: u.id, box: sc.id }; cui.msg = ""; return; }
      cui.storeView = cui.storeView === sc.id ? null : sc.id; cui.msg = ""; return;
    }
  }
  // A field battle the team's vehicle came along to (sim/raidloot.js trunkVehicle): a click on it opens its trunk, the
  // same window as a raid's (no action; hauling in and out costs the usual time).
  if (!b.raid && b.vehicle && u && active(u) && inTeamVehicle(b, c.x, c.y) && (trunkVehicle(state, b) || b.vehicle.blownUp)) {
    if (b.vehicle.blownUp) { cui.msg = "The vehicle is a burnt-out wreck."; return; }
    if (atVehicle(b, u)) { cui.lootReq = { uid: u.id, box: null }; return; }
    cui.msg = "Walk next to the vehicle to load or unload it.";
    return;
  }
  if (!u || !active(u) || u.ap < 1) { cui.msg = "Pick a unit that still has actions."; return; }
  // Call out (sim/parley.js): the person clicked names the group to call to (never a shot; the sim says why not).
  if (cui.mode === "callout") {
    if (who && who.side !== "player" && active(who) && v.seen.has(who.id)) return void callOut(state, b, u, who);
    cui.mode = "move"; cui.msg = "";
    return;
  }
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
  // A door picked for Peek, Close door or Brace (sim/buildingmaps.js); a window picked for a window order (sim/windows.js).
  if (u && active(u) && ["peek", "close", "brace", "checkwindow", "openwindow", "closewindow", "breakwindow", "boardup", "teardown", "cutwire", "strike", "slashtent"].includes(cui.mode)) return void act(state, { type: cui.mode, unit: u.id, x: c.x, y: c.y });
  // Shove (sim/barricade.js): the piece clicked opens its destinations; with a piece picked, a destination clicked shoves it there.
  if (u && active(u) && (cui.mode === "shove" || (cui.shoveAsk && cui.shoveAsk.uid === u.id))) return void shoveClick(state, b, u, c);
  // A window right next to the selected unit (sim/windows.js): the next thing to do with it (check it, open it, climb through).
  if (isWindow(b.cells[c.y * W + c.x]) && windowsBy(b, u).some((o) => o.x === c.x && o.y === c.y)) return void windowClick(state, b, u, c);
  // A locked door (sim/locks.js: a raid's, a field map's houses'): a click tries it. A closed door is walked through
  // like any cell (it swings open: sim/combat.js openDoor).
  const lk = lockAt(b, c.x, c.y);
  if (lk && lk.door && !lk.lock.open) return void lockedDoorClick(state, b, u, lk);
  if (b.raid) {
    // A light switch next to the selected unit (sim/indoorlight.js): flip it.
    const sw = switchAt(b, c.x, c.y);
    if (sw && switchOptions(b, u).includes(sw)) return void act(state, { type: "lights", unit: u.id, area: sw.id });
    if (sw) { cui.msg = "Stand next to the switch, inside the room or in its doorway, to flip it."; return; }
    const box = boxAt(b, c.x, c.y);
    if (box && !box.searched && (!CDEF(b.cells[c.y * W + c.x]).walk || (u.x === c.x && u.y === c.y))) {
      if (nearBox(u, box)) return void openSearch(state, b, u, box);
      cui.msg = "Move next to it to search.";
      return;
    }
  }
  if (cui.mode !== "move") { cui.mode = "move"; cui.msg = ""; return; }
  // vision.js: a move takes two clicks, where to and the way to face there (the cone follows the mouse).
  if (v.reach && isFinite(v.reach.dist[c.y * W + c.x]) && v.reach.dist[c.y * W + c.x] > 0) {
    cui.facePick = { uid: u.id, x: c.x, y: c.y, rev: b.rev };
    cui.mode = "facemove";
    cui.msg = `Now click the way ${u.name.split(" ")[0]} will face there: the cone shows what they will watch${b.night ? " and see in the dark" : ""}. The tile itself: the way they walk. Right-click or Esc: pick another tile.`;
  } else cui.msg = "Out of reach.";
}

// A click on a window next to the selected unit (sim/windows.js): not checked yet, check it (free); closed and
// openable from here, open it (1 action); open or broken on a building's map, climb through (sim/buildingmaps.js
// windowsNear); else what it takes (break it, or vault through it with a move).
function windowClick(state, b, u, c) {
  const cell = b.cells[c.y * W + c.x], s = windowState(cell), o = windowsBy(b, u).find((w) => w.x === c.x && w.y === c.y);
  if (!s || !o) return;
  if (!s.broken && !s.open && !s.known) return void act(state, { type: "checkwindow", unit: u.id, x: c.x, y: c.y });
  if (!s.broken && !s.open) {
    const why = openRefusal(b, u, cell, o.inside);
    if (!why && u.ap >= WINDOW.OPEN_AP) return void act(state, { type: "openwindow", unit: u.id, x: c.x, y: c.y });
    cui.msg = why || NO_AP;
    return;
  }
  if (b.raid && b.raid.interior && windowsNear(b, u).some((w) => w.x === c.x && w.y === c.y)) return void act(state, { type: "climb", unit: u.id, x: c.x, y: c.y });
  cui.msg = `The window is ${s.broken ? "broken" : "open"}: move to a tile beyond it to vault through it${s.broken ? "" : `, or Close window (${WINDOW.OPEN_AP} action)`}.`;
}
// A click on a locked door: from right next to it the surest way in it offers (the key, then lockpicks, then force: the
// combatAct "open" the panel's buttons send); from further off, or with no way in, what it takes.
function lockedDoorClick(state, b, u, t) {
  if (Math.max(Math.abs(u.x - t.x), Math.abs(u.y - t.y)) > 1) { cui.msg = `${t.name}: move right next to it to open it (key, lockpicks or force).`; return; }
  const o = openOdds(state, b, u, t.lock);
  const m = ["key", "pick", "force"].find((k) => o[k] && o[k].ok && u.ap >= o[k].ap);
  if (!m) { cui.msg = `${t.name}: ${u.name.split(" ")[0]} has no way in right now. ${o.pick.why} ${o.force.why || (u.ap < o.force.ap ? "Forcing it takes more actions than are left." : "")}`.trim(); return; }
  act(state, { type: "open", unit: u.id, target: t.ref, method: m });
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

// The base map's layout mode (sim/basemap.js): a click builds the picked type there, puts the picked thing down,
// selects a placed one (a second click on the selected one lifts it: moving stays two clicks), or looks into a store.
function layoutClick(state, b, px, py) {
  const c = cellFromPx(px, py);
  if (!c) return;
  if (b.layout.pickType) return void act(state, { type: "build", x: c.x, y: c.y });
  if (b.layout.pick) return void act(state, { type: "put", x: c.x, y: c.y });
  const e = itemAtCell(state, b, c.x, c.y);
  if (e && e.at) {
    if (b.layout.sel === e.it.key) return void act(state, { type: "lift", key: e.it.key });
    cui.storeView = null;
    return void act(state, { type: "select", key: e.it.key });
  }
  const sc = storeAt(b, c.x, c.y);
  if (sc) { cui.storeView = cui.storeView === sc.id ? null : sc.id; cui.msg = ""; return; }
  // A hole the dead dug (sim/tunnels.js): its card, to queue Fill tunnel.
  if ((b.tunnels || []).some((t) => t.open && ((t.a[0] === c.x && t.a[1] === c.y) || (t.b[0] === c.x && t.b[1] === c.y)))) { cui.storeView = null; return void act(state, { type: "tunnel", x: c.x, y: c.y }); }
  // A piece of the land (sim/basescatter.js: a tree, a bush, a wreck…): its card, to queue its clearing.
  const [gx, gy] = gridOfCell(b, c.x, c.y);
  if (landPieceAt(state, state.bases.find((o) => o.id === b.layout.baseId), gx, gy).length) { cui.storeView = null; return void act(state, { type: "land", x: c.x, y: c.y }); }
  if (b.layout.land) b.layout.land = null;
  if (b.layout.sel) return void act(state, { type: "select", key: null }); // open ground: deselect
  cui.msg = "Pick something to build from the Build list, or a placed thing from the lists, then click where it goes; click a placed thing to select it, again to move it.";
}
// Deploy step (sim/deploy.js): click a defender to pick them, then a green cell to put them there.
function deployClick(state, b, px, py) {
  const c = cellFromPx(px, py);
  if (!c) return;
  const who = unitAt(b, c.x, c.y);
  if (who && who.side === "player" && who.id !== cui.sel) { cui.sel = who.id; cui.msg = ""; return; }
  if (b.stores && !who) { const sc = storeAt(b, c.x, c.y); if (sc && !CDEF(b.cells[c.y * W + c.x]).walk) { cui.storeView = cui.storeView === sc.id ? null : sc.id; cui.msg = ""; return; } } // a store's contents (sim/basemap.js)
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
  if (cui.mode === "callout") return void callOut(state, b, u, t); // a target picked on the strip while calling out
  if (cui.mode === "taser") return void act(state, { type: "taser", unit: u.id, target: t.id }); // ui/nonlethal.js
  // A downed enemy (sim/medics.js): only Finish kills them; a plain click says so.
  if (t.side === "enemy" && t.down && !t.dead) {
    if (cui.mode === "finish") return void act(state, { type: "finish", unit: u.id, target: t.id });
    cui.msg = `${t.name} is down${t.ko ? " (out cold)" : t.stab ? " (stabilized)" : " and bleeding"}. Finish them (${keyLabel("battle.finish", 1) || "Shift+K"}) to kill them for good${t.ko || t.wounded ? ", tie them up (T) to take them prisoner" : ""}, or leave them.`;
    return;
  }
  if (cui.mode === "shoveFoe") return void act(state, { type: "shoveFoe", unit: u.id, target: t.id }); // sim/shoving.js: the sim says why not
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
  return loadsFor(b, u).filter((x) => x.n > 0).map((x) => ({ type: x.type, n: Math.floor(x.n), name: x.full || `${c.name} ${x.name}`, short: x.name })); // (another calibre the gun takes: ".223 Rem FMJ")
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
      : g.load === "buck" ? `Ends the turn: buckshot at an enemy up to ${range} tiles off (click them): ${LAUNCH.BUCK.dmg.join("–")}, best within ${LAUNCH.BUCK.opt}; the shot spreads past ${AMMO_TYPES.buck.spreadFull} tiles (less damage each tile further).`
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
// The Reload picker (2026-10-18 user request: "when you click reload show a box for all ammo/mags relative to the gun
// the survivor holds and you can choose which ones to use"): every spare magazine (with what is in it) and every round
// stack the survivor carries that the gun takes (sim/mags.js reloadOptions), each with its place and cost. A magazine
// loads with one click (a swap). Rounds are picked into a plan (cui.rlPlan[uid]: [{ i, n }], up to MAGS.LOOSE a
// Reload) in the order they should fire (the first picked is the chamber; ▲ ▼ reorder, ✕ drops one); Load fires it.
// A unit from a save made before physical rounds gets the old chooser (one button a kind of round).
cui.rlPlan = {}; // uid -> the rounds picked for the next Reload, in firing order
const whereWord = (w) => (w === "pack" ? "pack" : w === "rig" ? "rig" : w === "pocket" ? "pocket" : w);
function planRuns(b, u) {
  const o = reloadOptions(b, u);
  const plan = (cui.rlPlan[u.id] || []).filter((e) => o.rounds.some((r) => r.i === e.i) && e.n > 0);
  cui.rlPlan[u.id] = plan;
  return { o, plan, total: plan.reduce((a, e) => a + e.n, 0) };
}
function reloadPicker(state, b, u) {
  if (!u || cui.ammoAsk !== u.id || !active(u)) return "";
  if (!isStacked(u)) return ammoChooser(state, b, u);
  const { o, plan, total } = planRuns(b, u);
  const cal = CALIBERS[WEAPONS[u.weapon] && WEAPONS[u.weapon].cal];
  const name = (r) => r.name;
  const B = (v, label, tip, extra = "", cls = "mini") => `<button class="${cls}" data-action="cb-act" data-v="${v}" ${extra} data-tip="${esc(tip)}">${label}</button>`;
  let html = `<div class="small cbmsg cbammo cbreload" data-tip="${esc(`Reload ${u.weaponName}: pick a spare magazine (a swap: the one in the gun goes where it lay, with what is in it) or rounds by hand (up to ${o.per} a Reload, in the order they should fire: the first picked is in the chamber). Only what ${u.name.split(" ")[0]} carries: a pocket or the rig 1 action, the pack both. ${keyLabel("battle.reload", 1) || "I"} loads the rounds picked (or the next loaded magazine, else the chamber's round from the nearest place).`)}">`;
  html += `<div><b>Reload ${esc(u.weaponName)}</b> <span class="muted">${magLabel(b, u)}${o.curText ? `: ${esc(o.curText)}` : ""} · room for ${o.room}</span> ${B("ammoclose", "✕", "Close")}</div>`;
  if (o.box) {
    html += `<div class="rlrow"><span class="muted">Magazines:</span> ${o.mags.length ? o.mags.map((m) => `${B("reload", `${esc(m.name)} <span class="muted">${m.n}/${m.cap}${m.text ? `: ${esc(m.text)}` : ""} · ${whereWord(m.where)} · ${m.cost} action${m.cost === 1 ? "" : "s"}</span>`, m.why || `Swap it in (${m.cost} action${m.cost === 1 ? "" : "s"}): ${m.text || "empty"}. The magazine in the gun goes into the ${whereWord(m.where)} with what is in it.`, `data-mag="${m.j}"${m.why || u.ap < m.cost ? " disabled" : ""}`)}`).join(" ") : '<span class="muted">none that fit</span>'}</div>`;
  }
  if (o.clips.length) html += `<div class="rlrow"><span class="muted">Clips:</span> ${o.clips.map((c) => B("reload", `${esc(c.name)} <span class="muted">${whereWord(c.where)} · ${c.cost} action${c.cost === 1 ? "" : "s"}</span>`, c.why || `Fill the gun at once with the chamber's round out of what they carry (${c.cost} action${c.cost === 1 ? "" : "s"}); used once a fight.`, `data-clip="${c.i}"${c.why || u.ap < c.cost ? " disabled" : ""}`)).join(" ")}</div>`;
  const left = Math.max(0, Math.min(o.per, o.room) - total);
  html += `<div class="rlrow"><span class="muted">Rounds${o.box ? " (by hand, into the magazine in the gun)" : ""}, up to ${o.per} a Reload:</span> `;
  if (!o.rounds.length) html += `<span class="muted">none for it on ${esc(u.name.split(" ")[0])} (pockets, rig, pack)</span>`;
  for (const r of o.rounds) {
    const used = plan.filter((e) => e.i === r.i).reduce((a, e) => a + e.n, 0);
    const free = Math.max(0, Math.min(r.n - used, left));
    html += `<span class="rlsrc"><span${r.where === "pack" ? ' class="muted"' : ""}>${esc(name(r))} ×${r.n - used}${r.loose ? "" : " (boxed)"} · ${whereWord(r.where)} · ${r.cost} action${r.cost === 1 ? "" : "s"}</span> ${[1, 3, o.per].filter((k, j, a) => k <= free && a.indexOf(k) === j).map((k) => B("rladd", `+${k}`, `Pick ${k} of these into the Reload (the order picked is the firing order).`, `data-i="${r.i}" data-n="${k}"`)).join("")}${free > 0 && free !== 1 && free !== 3 && free !== o.per ? B("rladd", `+${free}`, `Pick ${free} (what is left of the ${o.per}).`, `data-i="${r.i}" data-n="${free}"`) : ""}</span> `;
  }
  html += `</div>`;
  if (plan.length) {
    const cost = plan.some((e) => o.rounds.find((r) => r.i === e.i).where === "pack") ? MAGS.SOURCE_AP.pack : MAGS.SOURCE_AP.hand;
    html += `<div class="rlrow"><span class="muted">Picked (chamber first):</span> ${plan.map((e, j) => { const r = o.rounds.find((x) => x.i === e.i); return `<span class="rlpick">${esc(r.short || r.name)} ×${e.n} ${j > 0 ? B("rlup", "▲", "Fire sooner", `data-j="${j}"`) : ""}${j < plan.length - 1 ? B("rldown", "▼", "Fire later", `data-j="${j}"`) : ""}${B("rldel", "✕", "Drop it from the pick", `data-j="${j}"`)}</span>`; }).join(" ")} `;
    html += B("reload", `Load ${total} (${cost} action${cost === 1 ? "" : "s"})`, `Reload with these ${total} rounds in this order: ${plan.map((e) => `${o.rounds.find((x) => x.i === e.i).short} ×${e.n}`).join(", ")}.${cost > 1 ? " Both actions: some are in the pack." : ""}`, `data-plan="1"${u.ap < cost ? " disabled" : ""}`, "mini primary");
    html += ` ${B("rlclear", "Clear", "Drop the pick.")}</div>`;
  } else {
    const p = reloadPlan(b, u);
    html += `<div class="rlrow muted">${esc(p.why ? p.why : `${keyLabel("battle.reload", 1) || "I"} with nothing picked: ${reloadText(b, u).split(" Reload opens")[0]}`)}</div>`;
  }
  return html + `</div>`;
}
// The old chooser (a unit from a save made before physical rounds): one button per kind of round to hand.
function ammoChooser(state, b, u) {
  if (!u || cui.ammoAsk !== u.id || !active(u)) return "";
  const list = ammoToHand(state, b, u);
  if (list.length < 2) return "";
  const pick = cui.ammoPick[u.id] || loadOf(u);
  return `<div class="small cbmsg cbammo" data-tip="${esc(`Reload with which round? ${keyLabel("battle.ammocycle", 1) || "Shift+I"} picks the next, I (or Reload) loads the picked one.`)}">Reload with: ${list.map((x) => `<button class="mini${x.type === pick ? " active" : ""}" data-action="cb-act" data-v="reload" data-k="${x.type}" data-tip="${esc(`${x.name}: ${x.n} to hand${x.type === loadOf(u) ? " (loaded now)" : ""}. ${tracksMags(u) ? (reloadPlan(b, u, x.type).cost === 1 ? "1 action" : `${reloadPlan(b, u, x.type).cost} actions`) : "1 action"}.`)}">${esc(x.short || (AMMO_TYPES[x.type] ? AMMO_TYPES[x.type].name : x.type))} <span class="muted">${x.n}</span></button>`).join(" ")} <button class="mini" data-action="cb-act" data-v="ammoclose" data-tip="Close">✕</button></div>`;
}

// ---------- Hand over (sim/combat.js handoverTargets, combatAct "handover"; 2026-10-17 user request) ----------
// The teammate right next to the selected unit, in its view cone, trades with it: both their kits open side by side
// (ui/inventory.js, the two-doll window; cui.handReq → takeLootReq), 1 action a move for the acting unit (either way),
// nothing for the mate. One mate: the window opens at once; several: a chooser over the orders (or click the mate on
// the map); a mate next to them but out of the cone: the button turns to "Face <name>" (the free Face act toward them).
const handKey = () => keyLabel("battle.handover", 1) || "Alt+H";
function handoverButton(state, b, u, btn) {
  const ap = u.ap;
  const targets = SIM.handoverTargets(b, u), unfaced = SIM.handoverUnfaced(b, u);
  if (!targets.length && unfaced.length) {
    const m = unfaced[0];
    btn("handover", `Face ${esc(m.name.split(" ")[0])}`, `Free (with an action left): ${m.name} is right next to ${u.name.split(" ")[0]} but out of their view cone. Turn to face them; then Hand over (${handKey()}) opens both their kits side by side (${SIM.HANDOVER_AP} action a move).`, ap > 0, handKey(), { why: ap > 0 ? "" : "Turning needs an action left (it costs none).", ap: 0 });
    return;
  }
  const names = targets.map((t) => t.name.split(" ")[0]).join(", ");
  btn("handover", "Hand over", `${SIM.HANDOVER_AP} action a move: ${u.name.split(" ")[0]}'s kit and a teammate's side by side, the one right next to them in their view cone${names ? ` (${names})` : ""}. A thing given to them or taken from them (a pocket, a pack slot, a rig pouch, the hands, the off hand) costs ${u.name.split(" ")[0]} ${SIM.HANDOVER_AP} action; the teammate spends nothing. A gun handed over counts at once in the other's hands, as do rounds and magazines. In a raid's search window things still pass between neighbours for free.`,
    ap >= SIM.HANDOVER_AP && targets.length > 0, handKey(), { why: !targets.length ? "Nobody of yours right next to them in their view cone to trade with." : ap < SIM.HANDOVER_AP ? NO_AP : "", on: cui.handAsk === u.id || cui.mode === "handover", ap: SIM.HANDOVER_AP });
}
// ---------- barricades (sim/barricade.js) ----------
// Shove (a piece of furniture a tile, both actions), Board up (boards and nails across a door or window) and Tear down.
function barricadeButtons(state, b, u, btn) {
  const first = u.name.split(" ")[0], ap = u.ap;
  const pieces = shoveTargets(b, u);
  const sWhy = shoveRefusal(b, u, state);
  const names = [...new Set(pieces.map((p) => pieceName(p.c)))].join(", ");
  const plan = pieces.length ? shovePlan(state, b, u, pieces[0].x, pieces[0].y) : null;
  const helper = plan && plan.helper ? plan.helper.name.split(" ")[0] : "";
  btn("shove", "Shove", `${helper ? `${SHOVE.HELP_AP} action each, with ${helper} lending a hand` : `${SHOVE.AP} actions alone (${SHOVE.HELP_AP} each with a teammate right next to the piece)`}: ${first} shoves the ${names || "shelf, cabinet, counter, table, bed, crate, locker, rack, barrel, hay or sandbags"} right next to them one tile: pushed onto a free cell beside it (open floor, or a broken or open door's frame to plug it), or pulled onto their own cell while they step back. Lockers and tall shelving take two people, or one with a Strong back or Melee ${SHOVE.STRONG_MELEE}+. In a doorway or a corridor it blocks the way: the dead crawl over half cover (a table, a shelf, crates: +${CRAWL.COST} tiles, a walker's whole turn) and batter a tall piece or go round; people vault half cover. The scrape is heard ${SHOVE.RADIUS} tiles off.${pieces.length > 1 ? " Several pieces next to them: click the one." : ""}`,
    !sWhy, "", { why: sWhy, ap: plan ? plan.ap : SHOVE.AP, on: cui.mode === "shove" || (cui.shoveAsk && cui.shoveAsk.uid === u.id) });
  const targets = boardTargets(b, u), boards = boardsOf(state, u, b);
  if (targets.length || boards) {
    const bWhy = boardRefusal(state, b, u);
    const what = [...new Set(targets.map((t) => t.word))].join(", ");
    btn("boardup", "Board up", `${BOARD.AP} actions and a bundle of boards and nails${boards ? "" : " (none carried)"}: ${first} nails boards across the ${what || "closed door, doorway or window"} next to them, from either side${boards && boards.where === "vehicle" ? " (the bundle out of the team's vehicle)" : " (a bundle in the team's vehicle counts from next to it)"}. ${BOARD.HP} hit points a layer (up to ${BOARD.MAX}) on top of a closed door's own, no sight or way through: the dead and raiders batter it. Loud: the unaware within ${BOARD.RADIUS} tiles turn toward the hammering${b.raid ? `, Heat +${BOARD.HEAT}` : ""}.${targets.length > 1 ? " Several next to them: click the one." : ""}`,
      !bWhy, "", { why: bWhy, ap: BOARD.AP, on: cui.mode === "boarded" });
  }
  // Cut wire (sim/wire.js): shown next to wire; refused (with why) without a cutter.
  const wires = cutTargets(b, u);
  if (wires.length) {
    const cut = cutterOf(state, u), cWhy = cutRefusal(state, b, u);
    btn("cutwire", "Cut wire", `${WIRE.AP} action${cut ? ` (${first} ${cut.how.replace(/\bit\b/, "the wire")})` : ""}: the ${wires.some((w) => w.c.razor) ? "razor wire" : "barbed wire"} next to ${first} is cut away, open ground from then on. Wire stops the dead for the turn and snags anyone who walks into it without a cutter (the rest of their turn and a few cuts); with one they cut through as they go. A little noise (heard ${WIRE.RADIUS} tiles off).${wires.length > 1 ? " Several next to them: click the one." : ""}`,
      !cWhy, "", { why: cWhy, ap: WIRE.AP, on: cui.mode === "cutwire" });
  }
  const tears = tearTargets(b, u);
  if (tears.length) btn("teardown", "Tear down", `${BOARD.TEAR.ap} actions: ${first} pries the boards off the ${[...new Set(tears.map((t) => boardedName(t.c).toLowerCase()))].join(", ")} next to them, from either side: the door or window as it was, shut. About half the bundles come off whole (into the kit, or on the ground at their feet); the rest are splintered. Quieter than nailing them up (heard ${BOARD.TEAR.radius} tiles off).${tears.length > 1 ? " Several next to them: click the one." : ""}`,
    ap >= BOARD.TEAR.ap, "", { why: NO_AP, ap: BOARD.TEAR.ap, on: cui.mode === "teardown" });
}
// ---------- tents (sim/tentfight.js) ----------
// Take down (both actions a go, a couple of turns: the bag into the arms) and Slash (one action), shown next to a tent.
function tentButtons(state, b, u, btn) {
  const near = tentsNear(b, u);
  if (!near.length) return;
  const first = u.name.split(" ")[0];
  const t = near.find((n) => n.t.workBy === u.id)?.t || near[0].t;
  const w = tentWear(b, t), left = goesLeft(t);
  const sWhy = strikeRefusal(b, u);
  const what = w.burned || w.share <= TENT_TAKE.WRECKED ? "slashed to rags: only scrap and canvas come of it" : t.kind === "makeshift" ? "a makeshift one: its poles and tarp give a little wood and scrap" : `its bag goes into ${first}'s arms (on the ground if the hands are full)${w.share < 0.999 ? `, torn (${Math.round(w.share * 100)}% left)` : ""}`;
  btn("strike", "Take down", `${TENT_TAKE.AP} actions a go: ${first} takes down the ${tentWord(t)} next to them${near.length > 1 ? " (several here: click the one)" : ""}: ${left} go${left === 1 ? "" : "es"} left (two people share the work). ${what}; what was stored in it stays where it stood, to search. The rattle of the poles is heard ${TENT_TAKE.RADIUS} tiles off${b.raid ? ` (Heat +${TENT_TAKE.HEAT} a go)` : ""}. Taken off its owner for good.`,
    !sWhy, "", { why: sWhy, ap: TENT_TAKE.AP, on: cui.mode === "strike" });
  const cuts = slashTargets(b, u);
  if (cuts.length) {
    const cWhy = slashRefusal(b, u);
    btn("slashtent", "Slash", `${TENT_TAKE.SLASH_AP} action: ${first} slashes the canvas next to them (10–16 a cut; a cell at 0 is torn open and hides nobody). A torn tent taken down gives a damaged bag; slashed to rags, only scrap and canvas.${cuts.length > 1 ? " Several cells: click the one." : ""}`,
      !cWhy, "", { why: cWhy, ap: TENT_TAKE.SLASH_AP, on: cui.mode === "slashtent" });
  }
}
// The chooser over the orders once a piece is picked: a button for each place it can go (the cell clicked on the map works too).
function shoveChooser(state, b, u) {
  if (!u || !cui.shoveAsk || cui.shoveAsk.uid !== u.id || !active(u)) return "";
  const { x, y } = cui.shoveAsk;
  const c = b.cells[y * b.w + x];
  if (!shoveable(c)) return "";
  const dests = shoveDests(b, u, x, y);
  const plan = shovePlan(state, b, u, x, y);
  const cost = plan.helper ? `${SHOVE.HELP_AP} action each, ${esc(plan.helper.name.split(" ")[0])} helping` : `${SHOVE.AP} actions`;
  if (plan.why) return `<div class="small cbmsg cbammo">Shove the ${esc(pieceName(c))}: <span class="muted">${esc(plan.why)}</span> <button class="mini" data-action="cb-act" data-v="shoveclose" data-tip="Close">✕</button></div>`;
  return `<div class="small cbmsg cbammo" data-tip="${esc(`Where does the ${pieceName(c)} go? Pushed onto a free cell beside it (open floor or a door frame), or pulled onto ${u.name.split(" ")[0]}'s own cell (they step back). Or click the cell on the map. ${cost}.`)}">Shove the ${esc(pieceName(c))} (${cost}): ${dests.length ? dests.map((d) => `<button class="mini" data-action="cb-act" data-v="shove" data-k="${x},${y},${d.x},${d.y}" data-tip="${esc(`${d.word[0].toUpperCase()}${d.word.slice(1)}: ${cost}.`)}">${esc(d.word[0].toUpperCase() + d.word.slice(1))}</button>`).join(" ") : `<span class="muted">nowhere: no free cell beside it, no room behind ${esc(u.name.split(" ")[0])}</span>`} <button class="mini" data-action="cb-act" data-v="shoveclose" data-tip="Close">✕</button></div>`;
}
// The Shove order (combatAction "cb-act" v "shove"; d.k: "px,py,tx,ty" from the chooser, or "px,py" for the piece).
function shoveCbAct(state, b, u, d) {
  const why = shoveRefusal(b, u, state);
  if (why) { cui.msg = why; cui.shoveAsk = null; if (cui.mode === "shove") cui.mode = "move"; return; }
  const k = d && d.k != null && d.k !== "" ? String(d.k).split(",").map(Number) : null;
  if (k && k.length >= 4) return void act(state, { type: "shove", unit: u.id, x: k[0], y: k[1], tx: k[2], ty: k[3] });
  const pieces = shoveTargets(b, u);
  const pick = k && k.length >= 2 ? pieces.find((p) => p.x === k[0] && p.y === k[1]) : pieces.length === 1 ? pieces[0] : null;
  if (pick) return void openShove(state, b, u, pick);
  const open = cui.mode !== "shove";
  cui.mode = open ? "shove" : "move";
  cui.shoveAsk = null;
  cui.msg = open ? `Which piece? Click the ${[...new Set(pieces.map((p) => pieceName(p.c)))].join(" or the ")} on the map.` : "";
}
// A piece picked: its destinations offered (the chooser), one of them doing it at once when it is the only one.
function openShove(state, b, u, p) {
  const dests = shoveDests(b, u, p.x, p.y);
  if (dests.length === 1) return void act(state, { type: "shove", unit: u.id, x: p.x, y: p.y, tx: dests[0].x, ty: dests[0].y });
  cui.shoveAsk = { uid: u.id, x: p.x, y: p.y };
  cui.mode = "shove";
  cui.msg = dests.length ? `Where does the ${pieceName(p.c)} go? Click a cell beside it on the map, or pick above the orders.` : `Nowhere to shove the ${pieceName(p.c)}: no free open cell beside it, and no room behind ${u.name.split(" ")[0]} to pull it.`;
}
// A map click in Shove mode: the piece (its destinations), or the destination of the piece picked.
function shoveClick(state, b, u, c) {
  const cell = b.cells[c.y * b.w + c.x];
  if (cui.shoveAsk && cui.shoveAsk.uid === u.id) {
    const { x, y } = cui.shoveAsk;
    if (shoveDests(b, u, x, y).some((d) => d.x === c.x && d.y === c.y)) return void act(state, { type: "shove", unit: u.id, x, y, tx: c.x, ty: c.y });
  }
  const p = shoveTargets(b, u).find((o) => o.x === c.x && o.y === c.y);
  if (p) return void openShove(state, b, u, p);
  cui.msg = shoveable(cell) ? `Stand right next to the ${pieceName(cell)} (not diagonally) to shove it.` : "Click a piece of furniture right next to them, or a cell beside the one picked.";
}
// The chooser over the orders when more than one mate is in reach: a button each (the mate clicked on the map works too).
function handChooser(state, b, u) {
  if (!u || cui.handAsk !== u.id || !active(u)) return "";
  const targets = SIM.handoverTargets(b, u);
  if (!targets.length) return "";
  return `<div class="small cbmsg cbammo" data-tip="${esc(`Hand over to whom? Each is right next to ${u.name.split(" ")[0]} in their view cone; or click them on the map.`)}">Hand over with: ${targets.map((t) => `<button class="mini" data-action="cb-act" data-v="handover" data-k="${t.id}" data-tip="${esc(`${t.name}: both kits side by side, ${SIM.HANDOVER_AP} action a move for ${u.name.split(" ")[0]}.`)}">${esc(t.name.split(" ")[0])}</button>`).join(" ")} <button class="mini" data-action="cb-act" data-v="handclose" data-tip="Close">✕</button></div>`;
}
// The two-doll window for u and the mate t (sim/combat.js handoverRefusal says why not).
function openHandover(state, b, u, t) {
  const why = SIM.handoverRefusal(b, u, t);
  if (why) { cui.msg = why; return; }
  cui.handReq = { sid: u.sid, mate: t.sid };
  cui.handAsk = null;
  cui.mode = "move";
  cui.msg = "";
}
// The Hand over order (combatAction "cb-act" v "handover", d.k: the mate's unit id from the chooser).
function handoverCbAct(state, b, u, d) {
  const targets = SIM.handoverTargets(b, u);
  if (!targets.length) {
    const un = SIM.handoverUnfaced(b, u);
    if (un.length) { if (act(state, { type: "face", unit: u.id, faceX: un[0].x, faceY: un[0].y })) cui.msg = `${u.name.split(" ")[0]} turns to face ${un[0].name}. Hand over (${handKey()}) again opens their kits side by side.`; return; }
    cui.msg = "Nobody of yours right next to them in their view cone to trade with."; cui.handAsk = null; cui.mode = "move";
    return;
  }
  if (u.ap < SIM.HANDOVER_AP) { cui.msg = NO_AP; return; }
  const pick = d.k != null && d.k !== "" ? targets.find((t) => t.id === Number(d.k)) : targets.length === 1 ? targets[0] : null;
  if (pick) return void openHandover(state, b, u, pick);
  const open = cui.handAsk !== u.id;
  cui.handAsk = open ? u.id : null;
  cui.mode = open ? "handover" : "move";
  cui.msg = open ? `Hand over to whom? Click ${targets.map((t) => t.name.split(" ")[0]).join(" or ")} on the map, or pick them above the orders.` : "";
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
  if (v === "kitok") { b.kitWarnSeen = true; return true; } // sim/kitcheck.js: the kit check before the first move, put aside
  if (v === "getshells") { act(state, { type: "getshells", unit: u.id }); return true; } // sim/mags.js SHELLS: a shotgun's shells out of the pack (other sides' rule; yours load straight in)
  if (v === "rladd" || v === "rlup" || v === "rldown" || v === "rldel" || v === "rlclear") { // the picker's pick of rounds (sim/mags.js reloadOptions)
    const { o, plan, total } = planRuns(b, u);
    if (v === "rlclear") cui.rlPlan[u.id] = [];
    else if (v === "rladd") {
      const i = Number(d.i), n = Math.max(1, Math.floor(Number(d.n) || 1));
      const r = o.rounds.find((x) => x.i === i);
      if (!r) { cui.msg = "Those rounds are not on them any more."; return true; }
      const used = plan.filter((e) => e.i === i).reduce((a, e) => a + e.n, 0);
      const q = Math.min(n, r.n - used, Math.max(0, Math.min(o.per, o.room) - total));
      if (q < 1) { cui.msg = total >= Math.min(o.per, o.room) ? `${Math.min(o.per, o.room)} is the most one Reload puts in by hand.` : "None left to pick."; return true; }
      const last = plan[plan.length - 1];
      if (last && last.i === i) last.n += q; else plan.push({ i, n: q });
    } else {
      const j = Number(d.j);
      if (!(j >= 0 && j < plan.length)) return true;
      if (v === "rldel") plan.splice(j, 1);
      else if (v === "rlup" && j > 0) [plan[j - 1], plan[j]] = [plan[j], plan[j - 1]];
      else if (v === "rldown" && j < plan.length - 1) [plan[j + 1], plan[j]] = [plan[j], plan[j + 1]];
    }
    cui.ammoAsk = u.id;
    return true;
  }
  if (v === "reload") {
    if (isStacked(u)) { // sim/mags.js: a magazine, a clip, the rounds picked, or (I again) the plain reload
      if (d.mag != null && d.mag !== "") { if (act(state, { type: "reload", unit: u.id, mag: Number(d.mag) })) { cui.ammoAsk = null; cui.rlPlan[u.id] = []; } return true; }
      if (d.clip != null && d.clip !== "") { if (act(state, { type: "reload", unit: u.id, clip: Number(d.clip) })) { cui.ammoAsk = null; cui.rlPlan[u.id] = []; } return true; }
      const { o, plan } = planRuns(b, u);
      if (d.plan || (cui.ammoAsk === u.id && plan.length)) { if (act(state, { type: "reload", unit: u.id, rounds: plan.map((e) => ({ i: e.i, n: e.n })) })) { cui.ammoAsk = null; cui.rlPlan[u.id] = []; } return true; }
      if (d.k) { if (act(state, { type: "reload", unit: u.id, ammo: d.k })) cui.ammoAsk = null; return true; }
      if (cui.ammoAsk === u.id) { const t = cui.ammoPick[u.id] && cui.ammoPick[u.id] !== loadOf(u) ? cui.ammoPick[u.id] : null; if (act(state, { type: "reload", unit: u.id, ammo: t })) { cui.ammoAsk = null; cui.ammoPick[u.id] = null; } return true; } // I again: the plain reload (or the round Next round picked)
      if (!o.mags.length && !o.clips.length && !o.rounds.length) return false; // nothing to pick from: the plain reload says why
      cui.ammoAsk = u.id;
      cui.msg = `Reload: pick a magazine or rounds below, or press ${keyLabel("battle.reload", 1) || "I"} again for the next loaded magazine (else the chamber's round from the nearest place).`;
      return true;
    }
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

// An order's key hint. key: its default hint; an order in the key table (battle.<v>) shows the key it is bound to now
// (Menu → Controls), Shift as ⇧.
const keyHint = (v, key) => (key && KEY_BY_ID.has(`battle.${v}`) ? keyLabel(`battle.${v}`, 1).replace(/Shift\+/g, "⇧") : key);

// ---------- the selected unit's orders (the bottom bar draws them: ui/battlebar.js) ----------
// Every order button of the selected unit, as data: [{ v, label, tip, ok, key, on, why?, ap?, k?, id? }]. The order
// builders below (gunButtons, medicButtons, raidButtons, ui/nonlethal.js nlButtons, ui/ground.js groundButtons …) are
// called with a btn(v, label, tip, ok, key, x) that records the button instead of writing it; x: { why: the reason it
// is greyed, ap: its cost when it is not the table's (ui/battlebar.js COST), k / id: the data-k / data-id it carries }.
// A button runs combatAction("cb-act", { v, k, id }), the same code its key runs (combatKey). extra: the context panels
// that go with the orders (a lock, a car, the reload chooser, the Execute / Surrender question), over the bar's orders.
const NO_AP = "No actions left this turn.";
export function unitOrders(state, b, u) {
  const list = [];
  const btn = (v, label, tip, ok, key, x = null) => { list.push({ v, label, tip, ok: !!ok, key: keyHint(v, key) || "", on: cui.mode === v, ...(x || {}) }); return ""; };
  const out = { list, extra: "", head: "" };
  if (!b || !u || b.over || b.phase !== "player" || u.side !== "player" || u.vol != null) return out;
  if (u.tied && !u.dead) { // a captive still tied up on a rescue raid (sim/rescueraid.js)
    out.head = "tied up";
    rescueButtons(state, b, u, btn);
    return out;
  }
  if (u.down && !u.dead && !u.left) { // sim/medics.js: down, a tourniquet or a trauma kit in reach
    const why = selfStabRefusal(b, u);
    out.head = `down, ${u.stab ? "stabilized" : u.ko ? "out cold" : u.surr ? "gave up" : `bleeding out (${u.bleed} turn${u.bleed === 1 ? "" : "s"} left)`}`;
    btn("selfStab", selfStabLabel(u), selfStabTip(why), !why, "", { why, ap: 0 });
    return out;
  }
  if (!(active(u) || u.aboard)) return out; // aboard the vehicle: Drive, Turn, Get out, Extract
  const ap = u.ap;
  const gun = isRanged(u), ammo = canFire(b, u);
  const foesAdj = b.units.some((t) => t.side === "enemy" && active(t) && meleeReach(b, u, t)); // not across a wall's corner
  const noAp = ap > 0 ? "" : NO_AP;
  const fireWhy = gun ? (ammo ? noAp : fireRefusal(b, u) || outOf(u)) : "No usable gun: fists, a blade or a club fight in melee.";
  btn("move", "Move", `Click a blue tile to move (1 action) or a yellow tile to dash (2 actions), then click the way to face there.${u.sneaking ? " Sneaking: slower, and silent." : ` A dash is heard ${VISION.DASH_NOISE} tiles off (the dead come to look); a plain move only now and then a scuff.`}${SIM.canVault(u) ? ` The path may vault half cover (a fence, crates, a car): +${SIM.VAULT.COST} tiles, a scuff, and ${SIM.VAULT.COST} tiles less of movement after it this turn${u.vaulted ? ` (winded now: ${u.vaulted} less)` : ""}.${handsBusy(u) ? ` With the hands full (${esc(armsText(u))}) the whole crossing costs double: +${2 + 2 * SIM.VAULT.COST} tiles, and never through a closed window.` : ""}` : ""}${handsBusy(u) ? " Hands full: closed doors stay shut to them." : ""}`, ap > 0, "", { why: noAp });
  btn("face", "Face", `Free (with an action left): turn where they stand. The cone is what they watch${b.night ? ` and all they see in the dark (${darkSight(b)} tiles ahead at ${nightWord(b)}, more down a flashlight's beam)` : ""}: an overwatch reacts only in it, and loot is searched only facing it.`, ap > 0, "⇧W", { why: ap > 0 ? "" : "Turning needs an action left (it costs none)." });
  btn("sneak", u.sneaking ? "Stop sneaking" : "Sneak", u.sneaking ? "Free: back to walking pace (a dash is heard, a plain move now and then)." : `Free: keep low. ${Math.round(VISION.SNEAK_MOB * 100)}% of the pace, no sound at all, and the enemy cannot see them behind half or full cover facing them (from further than a tile). Not while an aware enemy has eyes on them; a loud shot ends it (a suppressed one or a bow does not).`, ap > 0 || u.sneaking, "⇧Z", { why: "Sneaking needs an action left (it costs none).", on: !!u.sneaking });
  if (u.light) btn("light", activeLight(u) ? "Light off" : "Light on", lightTip(b, u), !u.aboard && !u.gunner, "Alt+L", { on: !!activeLight(u), why: "Get out of the vehicle first." }); // sim/combat.js switchAct
  if (u.nvg) btn("nvg", nvgOn(u) ? "NVG off" : "NVG on", nvgTip(b, u), !u.aboard && !u.gunner, "Alt+N", { on: nvgOn(u), why: "Get out of the vehicle first." });
  if (b.evacOrder) btn("evacStop", "Stop evac", "Call off the Evac: your people stay where they are and take orders again.", true, "", { on: true });
  else { const why = evacRefusal(b); btn("evac", "Evac", `Everyone still standing heads for the way out with the actions they have: ${b.raid ? "the extraction zones" : "the evac strip"}${b.vehicle ? ", or a free seat in the vehicle (in it counts as out)" : ""}, whichever is nearer. Arriving, they ${b.raid ? "extract" : "slip away"}${b.vehicle ? " or get in" : ""}. The order stands: each turn starts with the next leg until everyone is out or you call it off. The downed are not carried (Sound the retreat carries them).${b.raid && b.units.some((t) => t.ally && active(t)) ? " Allies are told to retreat too (they may not heed it)." : ""}`, !why, "", { why }); }
  btn("shoot", "Shoot", gun ? (ammo ? `Fire at a visible enemy. Ends this unit's turn. Hover an enemy to see the hit chance.${hasMag(u) ? ` ${esc(u.weaponName)}: ${magLabel(b, u)} loaded.` : ""}` : fireRefusal(b, u)) : "No usable gun.", ap > 0 && ammo, "F", { why: fireWhy });
  if (gun && SIM.cabTarget(b, u)) { const tg = SIM.cabTarget(b, u), o = SIM.cabOdds(b, u, tg), who = SIM.cabSeat(b, tg.v); btn("cab", "Shoot the cab", `Fire at their ${esc(tg.v.name || tg.v.kind)} (${o.chance}% a round): each hit wears it (heavy and armour-piercing rounds; ${SIM.HULL.PEN + 1}+ penetration) and half get in at the windscreen${tg.v.up && tg.v.up.plating ? " (less with the plate)" : ""}, at ${who ? "whoever is at the wheel" : "nobody: the cab is empty"}${tg.v.up && tg.v.up.glass ? " through bulletproof glass" : ""}. A driver down stops it. Ends this unit's turn.`, ap > 0 && ammo, "", { why: fireWhy }); }
  if (gun && hasMag(u)) {
    // mags.js reloadPlan: the source decides the cost (a magazine or rounds from a pocket or the rig 1 action, from the pack both; the tip names it: reloadText).
    const why = reloadRefusal(b, u), opts = isStacked(u) && !u.gunner ? reloadOptions(b, u) : null, more = opts ? opts.mags.length + opts.clips.length + opts.rounds.length > 0 : ammoToHand(state, b, u).length > 1, need = u.gunner ? TURRET.RELOAD_AP : tracksMags(u) ? reloadPlan(b, u).cost : 1;
    const stack = gunStackText(b, u);
    btn("reload", magEmpty(b, u) && !why ? '<span class="danger">Reload</span>' : "Reload", `${esc(u.weaponName)} (${magLabel(b, u)} now${stack ? `: ${esc(stack)}` : ""}). ${reloadText(b, u)}${why ? ` ${why}` : ""}${u.gunner ? " The turret's belt: both actions." : ""}${more && !opts ? ` More than one kind of round for it is to hand: Reload asks which (${keyLabel("battle.ammocycle", 1) || "Shift+I"} picks the next).` : ""}`, (opts ? more && ap > 0 : ap >= need && (!why || more)), "I",
      { why: opts ? (more ? (ap > 0 ? "" : NO_AP) : why) : why && !more ? why : ap < need ? NO_AP : "", ap: need, on: cui.ammoAsk === u.id }); // (one action left and the rounds in the pack: reloadRefusal's "both actions" reason)
  }
  const kinds = gun ? ammoToHand(state, b, u) : [];
  if (kinds.length > 1) btn("ammocycle", "Next round", `Free: the kind of round the next Reload loads (${kinds.map((x) => `${x.short || x.name} ${x.n}`).join(", ")}); then Reload (${keyLabel("battle.reload", 1) || "I"}) loads it.`, true, "⇧I", { ap: 0 });
  if (gun && isShellGun(u) && (shellsInPack(b, u) || !getShellsRefusal(b, u))) btn("getshells", shellsInPack(b, u) ? '<span class="danger">Get shells</span>' : "Get shells", `1 action: up to ${SHELLS.GRAB} shells out of the pack, loose at hand (pockets), ready to load for 1 action a Reload (a Reload straight from the pack takes both actions). ${shellsLine(b, u)}.${getShellsRefusal(b, u) ? ` ${getShellsRefusal(b, u)}` : ""}`, ap >= 1 && !getShellsRefusal(b, u), "", { why: getShellsRefusal(b, u) || noAp });
  gunButtons(state, b, u, btn);
  holsterButtons(state, b, u, btn); // sim/holsters.js: Draw side arm, Draw melee, Main weapon
  plateButton(state, b, u, btn);
  btn("melee", "Melee", "Strike an adjacent enemy. Silent: it does not alert others or draw zombies. Ends the turn.", ap > 0 && foesAdj, "E", { why: noAp || (foesAdj ? "" : "No enemy right next to them (not across a wall's corner).") });
  { // sim/shoving.js: a foe right next to them shoved back a tile or flat on their back
    const near = pushTargets(b, u), why = pushRefusal(b, u), po = near.length === 1 ? pushOdds(b, u, near[0]) : null, hz = near.length === 1 ? pushHazard(b, u, near[0]) : "";
    btn("shoveFoe", po ? `Shove foe (${po.chance}%)` : "Shove foe", `${PUSH.AP} action: shove someone or one of the dead right next to ${u.name.split(" ")[0]} (arms free). It lands about ${PUSH.BASE}% of the time (better for a good hand-to-hand fighter, a Strong back, a Bulldozer, a target unaware or reeling; worse on the armoured dead, and on a target hunkered down or bracing a door): pushed back a tile, straight away, or knocked flat on their back, always when a wall or someone is behind them (the one behind may go down too), after a fall or through a window. Flat on their back: no overwatch, blows at them +${PUSH.FLOOR_AIM}, and getting up takes their next turn's first action. Shoved into the flames, acid, a trench, a pit or a mine they get what is there; off a walkway or ladder they fall (${PUSH.FALL[0]}–${PUSH.FALL[1]} a level); through a window the glass cuts them and the crash is heard. Brutes, wall-breakers and bosses do not budge. One of the dead that has hold of someone lets go when shoved off or floored. Enemy people shove too.${hz ? ` Behind them now: ${hz}.` : ""}${u.heldBy != null ? " Something has hold of them: shove it off to move again." : ""}${near.length > 1 ? " Several next to them: click the one." : ""}`, !why, "", { why, ap: PUSH.AP });
  }
  btn("overwatch", "Overwatch", `${OVERWATCH_TIP} Click the way to watch: only what moves in its cone draws a reaction.`, ap > 0 && ammo, "O", { why: fireWhy });
  btn("hunker", "Hunker down", `Ends the turn. +${COVER_DEF[1]} defense on top of cover until your next turn. Only helps when in cover.`, ap > 0, "H", { why: noAp });
  if (b.vehicle) btn("drive", "Drive", `Both actions, from inside or next to the ${b.vehicle.kind === "truck" ? "truck" : "car"}: click where to drive it, up to ${DRIVE.RANGE} cells. It drives through people (anyone in the way is hit for ${RAMMING.HIT[0]}–${RAMMING.HIT[1]}, the dead ${RAMMING.ZOMBIE_HIT[0]}–${RAMMING.ZOMBIE_HIT[1]}, and shoved aside) and light obstacles (fences, crates, sandbags, barricades, tank traps: broken, at a cost to the vehicle's condition); walls, trees, other cars, water, railings and trenches stop it. Loud: the unaware within ${DRIVE.RADIUS} tiles hear the engine${b.raid ? `, Heat +${DRIVE.HEAT}` : ""}. Whoever is aboard rides along, the loot and the siege ram too; extract from a zone it stands at to keep it.`, ap >= DRIVE.AP && (u.aboard || atVehicle(b, u)), "", { why: ap < DRIVE.AP ? "Driving takes both actions." : "Stand next to the vehicle (or get in) to drive it.", ap: DRIVE.AP });
  if (b.vehicle && !u.aboard) btn("board", "Get in", `1 action, from next to it: ride in the ${b.vehicle.kind} (${b.vehicle.seats || 4} seats, ${aboardCount(b)} aboard). Inside you are off the map (not a target, not drawn, no shooting) and can drive, turn, get out, or extract with it from a zone it stands at.`, ap > 0 && atVehicle(b, u) && aboardCount(b) < (b.vehicle.seats || 4), "", { why: noAp || (!atVehicle(b, u) ? "Stand next to the vehicle to get in." : "Every seat is taken.") });
  if (u.aboard) btn("disembark", "Get out", "1 action: out onto a free cell round the vehicle.", ap > 0, "", { why: noAp });
  if (u.aboard && vehicleTurret(b)) btn("gunner", u.gunner ? "Get down" : "Man the turret", u.gunner ? "1 action: off the turret and back down inside (not a target any more)." : `1 action: up behind the ${vehicleTurret(b) === "m2hb" ? "M2" : "machine gun"} on the roof. Then Shoot (F) fires it: a 3-round burst from its belt (${b.vehicle.belt ?? "full"}, a new belt is both actions) out of the team's ammo (${Math.floor(turretRounds(b))}), a level up, aim +6, through cover, very loud (it wakes the whole map${b.raid ? `, Heat +${TURRET.HEAT} a burst` : ""}), and whoever it lands near shoots −${TURRET.PIN} next turn. Overwatch works from it. After the vehicle drives or turns this turn the turret fires at −${RIDE.TURRET} (−${RIDE.DRIVER} for a gunner who turned it). The gunner is the one rider they can shoot: half cover${b.vehicle.up && b.vehicle.up.plating >= 2 ? " (full: plate ×2)" : " (full behind plate ×2)"}. Downed, they drop back inside.`, ap > 0, "⇧T", { why: noAp, on: !!u.gunner });
  if (b.vehicle) btn("turn", "Turn", "1 action, from inside or next to it: a quarter turn at the same corner (it needs open ground with nobody on it on the cells it turns onto).", ap > 0 && (u.aboard || atVehicle(b, u)), "", { why: noAp || "Stand next to the vehicle (or get in) to turn it." });
  if (!b.raid && b.vehicle && trunkVehicle(state, b) && !u.aboard) btn("vehicle", "Vehicle", atVehicle(b, u) ? "Free: open the vehicle (or click it). Put what you carry in it to free your hands, or take the team's things out. Hauling takes the usual time: the first kg a turn are free, then actions." : "Walk next to the vehicle to load or unload it.", atVehicle(b, u), "N", { why: "Walk next to the vehicle to load or unload it." });
  const medsOk = medsLeft(b) > 0 || players(b).some((o) => o.down && !o.dead && !o.left && !o.stab && adjacent(u, o));
  btn("meds", "Use meds", `1 action and 1 meds: heal yourself or an adjacent teammate, or stabilize someone who is down so they survive. With no meds left, someone down can still be stabilized by hand (${handsOdds(u)}%: pressure and a belt; it can be tried again).`, ap > 0 && medsOk, "M", { why: noAp || (medsOk ? "" : "No meds left, and nobody down next to them to stabilize by hand.") });
  medicButtons(state, b, u, btn);
  floorButtons(b, u, btn);
  bodyButtons(state, b, u, btn);
  groundButtons(state, b, u, btn);
  handoverButton(state, b, u, btn); // sim/combat.js handoverTargets: trade with the teammate next to them in their cone
  stealthButtons(state, b, u, btn);
  nlButtons(state, b, u, btn, cui);
  siegeButtons(b, u, btn);
  if (b.evacCols) btn("retreat", "Retreat", "This unit leaves the battle. Only from the green evac strip. A downed teammate lying on the strip is carried out with the last one to leave; anyone else who is down and left behind is lost. To pull everyone out at once, Sound the retreat (Shift+R).", ap > 0 && evacAt(b, u.x, u.y), "R", { why: noAp || "Only from the green evac strip." });
  if (b.raid) { raidButtons(state, b, u, btn); callButton(state, b, u, btn); allyButton(state, b, u, btn); }
  else { doorButtons(b, u, btn, true); windowButtons(b, u, btn); } // a field map's houses (sim/combat.js genMap): with a door or a window next to them
  keyButtons(b, u, btn); // sim/basemap.js: the defenders' keys on their base's map
  barricadeButtons(state, b, u, btn); // sim/barricade.js: Shove, Board up, Tear down
  tentButtons(state, b, u, btn); // sim/tentfight.js: Take down, Slash
  if (b.rescue) rescueButtons(state, b, u, btn);
  out.extra = lockPanel(state, b, u) + carPanel(state, b, u) + reloadPicker(state, b, u) + handChooser(state, b, u) + shoveChooser(state, b, u) + nlAskHtml(b, cui); // Execute / Surrender: asked first (ui/nonlethal.js)
  return out;
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
// floor in a building with storeys; Q and E (or , and .) turn the view an eighth (ui/isoview.js isoRotate), + and − zoom, Home centers on the selected unit, B shows or
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
  if (k === "bview.cones") { setCones(!cui.cones); return true; } // vision.js: everyone's view cones
  if (k === "bview.center") { const u = selUnit(b); if (u) isoCenterOn(b, u.x, u.y); return true; }
  if (k === "bview.hud") { toggleHud(); return true; } // ui/battlehud.js: fold or open the squad strip
  if (k === "bview.log") { if (raidLayout(b)) logAction("toggle"); return raidLayout(b); } // ui/logwindow.js: a raid's log window shown or hidden
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
  if (holding(b) && !(selUnit(b) && selUnit(b).captive)) return true; // sim/raidplan.js: before going in (the window, or the site looked at): no orders, no turn to end (Esc: main.js closeTopLayer → planEsc)
  const confirm = k === "battle.confirm", space = k === "battle.endTurn";
  if (b.over) {
    if (confirm || space) { closeCombat(state); return true; }
    return false;
  }
  // Deploy step: Enter starts the fight (Space only says so: it is too easy to press by habit here).
  if (b.phase === "deploy") {
    if (b.layout) { // the base map (sim/basemap.js): R turns the pick, Esc puts it down (then deselects)
      if (e.code === "KeyR") { act(state, { type: "rotate" }); return true; }
      if (e.code === "Escape") { if (b.layout.pickType) act(state, { type: "pickType", bt: null }); else if (b.layout.pick) act(state, { type: "pick", key: null }); else if (b.layout.sel) act(state, { type: "select", key: null }); cui.storeView = null; cui.msg = ""; return true; }
      if (confirm || space) { cui.msg = "The base map: pick something and click where it goes, or Close the map."; return true; }
    }
    if (b.drill) { if (confirm || space) cui.msg = "A drill: place your people, then Save as plan, or Close the drill."; return confirm || space; } // a base drill (no fight to start)
    if (confirm) { act(state, { type: "start" }); return true; }
    if (space) { cui.msg = `Place your defenders, then press ${keyLabel("battle.confirm", 1) || "Enter"} or Start the fight.`; return true; }
  }
  if (k === "battle.next" || k === "battle.prev") { cycleUnit(b, k === "battle.prev" ? -1 : 1); return true; }
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
  if (e.code === "Escape") return battleEsc();
  if (k === "battle.autoplay") { combatAction(state, "cb-autoplay", {}); return true; } // the AI plays your side
  if (k === "battle.inventory") { combatAction(state, "cb-inv", {}); return true; } // the selected survivor's kit (read-only)
  if (b.phase === "deploy") return false;
  if (k === "battle.retreatAll") { combatAction(state, b.tier && b.tier.map === "wall" ? "cb-fallback" : "cb-retreat", { v: "ask" }); return true; }
  if (k === "battle.clear") { combatAction(state, "cb-clear", {}); return true; } // the area is clear enough (sim/battlesize.js)
  // The unit's orders (shoot, melee…; search, a quick rummage (sim/search.js, raids only) and drag are on Shift: W A S D pan).
  const o = k && KEY_BY_ID.get(k);
  if (o && o.v && (o.v !== "quick" || b.raid)) { combatAction(state, "cb-act", { v: o.v }); return true; }
  return false;
}

// Tab / Shift+Tab (and a controller's RB / LB): the next or previous of yours with actions left (everyone, when
// nobody has any), on any floor: the view follows (followFloor).
function cycleUnit(b, d) {
  const team = players(b).filter((u) => alive(u));
  const ready = team.filter((u) => u.ap > 0);
  const list = ready.length ? ready : team;
  const i = list.findIndex((u) => u.id === cui.sel);
  if (list.length) cui.sel = list[(i + (d < 0 ? list.length - 1 : 1)) % list.length].id;
  cui.mode = "move";
  follow(b);
}
// Esc in a battle (and a controller's B): a tray shut, Ally orders back a step, else whatever was being picked dropped.
function battleEsc() {
  if (cui.barTray != null) { cui.barTray = null; return true; }
  if (allyBack()) return true;
  cui.allyAsk = null; cui.mode = "move"; cui.msg = ""; cui.endAsk = null; cui.retreatAsk = null; cui.fallAsk = null; cui.dragId = null; cui.handAsk = null; cui.shoveAsk = null;
  return true;
}

// Panel buttons (data-action="cb-…").
export function combatAction(state, key, d, ui = null) { // ui: main.js's screen state (the plan's kit windows open on it)
  const b = state.combat;
  if (!b) return;
  sync(b);
  const u = selUnit(b);
  if (key === "cb-close") return void closeCombat(state, { take: d.take !== "0" });
  // The inventory of the selected survivor (or d.id's): ui/inventory.js takeLootReq opens it, read-only.
  if (key === "cb-inv") { const t = d.id != null ? unitById(b, Number(d.id)) : u; if (t && t.side === "player" && t.sid != null && t.vol == null) cui.invReq = t.sid; else cui.msg = "Select one of your people to see what they carry."; return; }
  if (key === "cb-volorder") { const err = combatAct(state, { type: "volOrder", unit: Number(d.id), order: d.v, target: u ? u.id : null }); cui.msg = err || ""; return; } // sim/combat.js volOrder: Free, Hold here, Follow the selected one
  // The view bar (ui/isoview.js).
  if (key === "cb-view") {
    if (d.v === "rotl" || d.v === "rotr") isoRotate(b, d.v === "rotr" ? 1 : -1);
    else if (d.v === "roofs") setRoofs(!iso.roofs);
    else if (d.v === "cones") setCones(!cui.cones);
    else if (d.v === "zin" || d.v === "zout") isoZoom(b, d.v === "zin" ? 1 : -1);
    else if (d.v === "center" && u) { followFloor(b, u); isoCenterOn(b, u.x, u.y); }
    // A building with storeys: the Floor control (▲ ▼), or back to the selected unit's floor.
    else if (d.v === "fup" || d.v === "fdown") { if (!setViewFloor(b, floorNo(b) + (d.v === "fup" ? 1 : -1))) cui.msg = d.v === "fup" ? "This is the top floor." : "This is the ground floor."; }
    else if (d.v === "fgo" && u) followFloor(b, u);
    else if (d.v === "hud") toggleHud(); // ui/battlehud.js: the squad strip's fold button
    return;
  }
  // The bottom bar (ui/battlebar.js): All / Ready only, a group's tray open or closed (an order given from a tray closes it).
  if (key === "cb-bar") { if (d.v === "all") setBarAll(!cui.barAll); else if (d.v === "tray") cui.barTray = cui.barTray === Number(d.g) ? null : Number(d.g); return; }
  if (d && d.tray) cui.barTray = null;
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
  if (key === "cb-sel") {
    cui.sel = Number(d.id); cui.pickedDown = cui.sel; cui.mode = "move"; cui.msg = "";
    const p = d.center ? selUnit(b) : null; // the squad strip (ui/battlehud.js): the view goes to them, on screen or not
    if (p && !p.off && p.x >= 0) { followFloor(b, p); isoCenterOn(b, p.x, p.y); } else follow(b);
    return;
  }
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
  if (key === "cb-store") { cui.storeView = d.id ? Number(d.id) : null; cui.msg = ""; return; } // a store on the base map (sim/basemap.js)
  // A store of theirs on an assault's map (sim/assaultstores.js): the search window on it, or a blow at its lock.
  if (key === "cb-store-take") { if (!u) { cui.msg = "Pick one of your people next to it."; return; } cui.lootReq = { uid: u.id, box: Number(d.id) }; cui.msg = ""; return; }
  if (key === "cb-store-force") { if (!u) { cui.msg = "Pick one of your people next to it."; return; } return void act(state, { type: "forceStore", unit: u.id, store: Number(d.id) }); }
  if (key === "cb-deploy") {
    if (b.layout) { // the base map's layout mode (sim/basemap.js layoutAct; the panel: ui/basemap.js layoutPanel)
      if (d.v === "pick") return void act(state, { type: "pick", key: d.k || null });
      if (d.v === "rotate" || d.v === "endLayout") return void act(state, { type: d.v });
      if (d.v === "lift" || d.v === "unplace") return void act(state, { type: d.v, key: d.k });
      if (d.v === "select") return void act(state, { type: "select", key: d.k || null }); // a placed thing's card
      if (d.v === "pickType") return void act(state, { type: "pickType", bt: d.bt || null }); // a type to build: the ghost is its footprint
      if (d.v === "link" || d.v === "unlink") return void act(state, { type: d.v, a: d.a, b: d.b }); // a doorway between two buildings
      if (d.v === "clear") return void act(state, { type: "clear", clump: d.clump === "1", mode: d.mode || "clear" }); // the land's card (sim/basescatter.js)
      if (d.v === "landClose") { b.layout.land = null; return; }
      if (d.v === "tunnel") return void act(state, { type: "tunnel", id: d.id }); // sim/tunnels.js: a hole's card (from the list)
      if (d.v === "tunnelClose") { b.layout.tunnel = null; return; }
      if (d.v === "fillTunnel") return void act(state, { type: "fillTunnel", id: d.id });
      if (d.v === "unfill") return void act(state, { type: "unfill", id: d.id });
      if (d.v === "unclear") return void act(state, { type: "unclear", id: d.id });
      if (d.v === "demolish") { // a standing building asks first (ui/confirm.js, as the Construction tab's Demolish); a queued job is only cancelled
        const base = state.bases.find((x) => x.id === b.layout.baseId), rec = base && d.k && d.k.startsWith("b:") ? base.buildings.find((x) => x.id === Number(d.k.slice(2))) : null;
        if (rec && ui && !(BUILDINGS[rec.type] && BUILDINGS[rec.type].furniture) && !(rec.type === "tent" && TENTS[tentKind(rec)].bag) && ask(ui, d, "cb-deploy", { kind: "demolish", title: `Pull down ${BUILDINGS[rec.type] ? BUILDINGS[rec.type].name : "this building"} at ${base.name}?`, text: `It is gone for good${FOOT[rec.type] && FOOT[rec.type].general ? ", and whatever stands inside it with it" : ""}. About half its scrap and parts come back${refundWords(rec)}.`, yes: "Pull it down" })) return;
        return void act(state, { type: "demolish", key: d.k });
      }
      return;
    }
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
  // Before going in (sim/raidplan.js): the side, a scout, the night, Go in.
  if (key === "cb-log") return void logAction(d.v); // ui/logwindow.js: the raid's log window shown, folded or hidden
  if (key === "cb-plan") { cui.msg = planAction(state, d, ui) || ""; return; } // ui/raidplan.js: the window's buttons (map / back: the window put aside, or back)
  // A site with several buildings (sim/buildingmaps.js): which one to explore, or the street.
  if (key === "cb-act" && d.v === "building") return void act(state, { type: "building", id: d.k });
  if (key !== "cb-act" || !u) return;
  const v = d.v;
  if (allyCbAct(state, b, u, v, d)) return; // Ally orders (sim/allyorders.js): open, the card's buttons
  if (typeof v === "string" && v.startsWith("rescue:")) return void act(state, { type: "rescue", unit: u.id, op: v.slice(7) }); // sim/rescueraid.js
  if (groundCbAct(state, b, u, v, cui, act)) return; // ui/ground.js: Search a body (a field battle), Ground
  if (v === "search" && b.raid) return void openSearch(state, b, u, null, { full: true });
  if (v === "quick" && b.raid) return void openSearch(state, b, u, null, { quick: true }); // sim/search.js: the rummage
  if (DRAW_SLOT[v]) return void act(state, { type: "draw", unit: u.id, slot: DRAW_SLOT[v] }); // sim/holsters.js: the side arm, the melee weapon, the slung gun back
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
  if (v === "vehicle" && !b.raid && b.vehicle) { // a field battle (sim/raidloot.js trunkVehicle)
    if (!trunkVehicle(state, b)) { cui.msg = b.vehicle.blownUp ? "The vehicle is a burnt-out wreck." : "There is no vehicle here to open."; return; }
    if (!atVehicle(b, u)) { cui.msg = "Walk next to the vehicle to load or unload it."; return; }
    cui.lootReq = { uid: u.id, box: null };
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
  // vision.js: Face (pick the way, free), Sneak (on / off, free), Overwatch (pick the way to watch; again: as they face).
  if (v === "face") { cui.mode = cui.mode === "face" ? "move" : "face"; cui.msg = cui.mode === "face" ? `Click the way ${u.name.split(" ")[0]} should face (free; it needs an action left). The cone is what they watch${b.night ? " and see in the dark" : ""}: a guard is noticed and an overwatch reacts only in it, and loot is searched only facing it.` : ""; return; }
  if (v === "sneak") return void act(state, { type: "sneak", unit: u.id });
  if (v === "handover") return void handoverCbAct(state, b, u, d); // sim/combat.js handoverTargets: the two-doll window, the chooser, or the free Face toward the mate
  if (v === "handclose") { cui.handAsk = null; if (cui.mode === "handover") cui.mode = "move"; cui.msg = ""; return; }
  // sim/barricade.js: Shove (the piece, then where), Board up and Tear down (the door or window next to them).
  if (v === "shove") return void shoveCbAct(state, b, u, d);
  if (v === "shoveclose") { cui.shoveAsk = null; if (cui.mode === "shove") cui.mode = "move"; cui.msg = ""; return; }
  if (v === "boardup" || v === "teardown") {
    const list = v === "boardup" ? boardTargets(b, u) : tearTargets(b, u);
    const why = v === "boardup" ? boardRefusal(state, b, u) : "";
    if (why && (!list.length || !boardsOf(state, u))) { cui.msg = why; return; }
    if (list.length === 1) return void act(state, { type: v, unit: u.id, x: list[0].x, y: list[0].y });
    if (!list.length) { cui.msg = v === "boardup" ? "Stand right next to a closed door, a doorway or a window (not diagonally)." : "Stand right next to boards (not diagonally) to tear them down."; return; }
    cui.mode = cui.mode === v ? "move" : v;
    cui.msg = cui.mode === v ? (v === "boardup" ? "Click the door, doorway or window to board up." : "Click the boards to tear down.") : "";
    return;
  }
  if (v === "strike" || v === "slashtent") { // sim/tentfight.js: the tent next to them (several: click the one)
    const why = v === "strike" ? strikeRefusal(b, u) : slashRefusal(b, u);
    if (why) { cui.msg = why; return; }
    const many = v === "strike" ? tentsNear(b, u).length > 1 && !tentsNear(b, u).some((n) => n.t.workBy === u.id) : new Set(slashTargets(b, u).map((o) => (o.t ? o.t.id : -1))).size > 1;
    if (!many) return void act(state, { type: v, unit: u.id });
    cui.mode = cui.mode === v ? "move" : v;
    cui.msg = cui.mode === v ? (v === "strike" ? "Click the tent to take down." : "Click the tent to slash.") : "";
    return;
  }
  if (v === "cutwire") { // sim/wire.js: the wire next to them (several: click the one)
    const list = cutTargets(b, u), why = cutRefusal(state, b, u);
    if (why) { cui.msg = why; return; }
    if (list.length === 1) return void act(state, { type: "cutwire", unit: u.id, x: list[0].x, y: list[0].y });
    cui.mode = cui.mode === v ? "move" : v;
    cui.msg = cui.mode === v ? "Click the wire to cut." : "";
    return;
  }
  if (v === "lights") return void act(state, { type: "lights", unit: u.id }); // sim/indoorlight.js: the switch in reach (the sim says why not)
  if (v === "light" || v === "nvg") { if (v === "light" ? u.light : u.nvg) return void act(state, { type: v, unit: u.id }); cui.msg = v === "light" ? `${u.name.split(" ")[0]} has no light.` : `${u.name.split(" ")[0]} has no night vision.`; return; } // sim/combat.js switchAct: free, even with no actions left
  if (v === "overwatch") {
    if (cui.mode === "overwatch") return void act(state, { type: "overwatch", unit: u.id });
    if (!canFire(b, u)) return void act(state, { type: "overwatch", unit: u.id }); // the sim says why not
    cui.mode = "overwatch";
    cui.msg = `Click the way to watch: ${u.name.split(" ")[0]} reacts only to what moves in the cone. ${keyLabel("battle.overwatch", 1) || "O"} again: the way they face now.`;
    return;
  }
  if (v === "shoot" || v === "melee") { cui.mode = cui.mode === v ? "move" : v; cui.msg = v === "shoot" ? "Click a visible enemy to shoot." : "Click an adjacent enemy to strike."; return; }
  if (nlCbAct(state, b, u, v, cui, act)) return; // tasers, pepper spray, pulled blows, Execute, Surrender, Take them alive (ui/nonlethal.js)
  // Call out (sim/parley.js): one group to call to, at once; more, click whom (the targets are marked on the map).
  if (v === "callout") {
    const ts = callTargets(state, b, u);
    if (ts.length === 1) return void callOut(state, b, u, ts[0]);
    if (!ts.length) { cui.mode = "move"; cui.msg = callWhy(state, b, u); return; }
    cui.mode = cui.mode === "callout" ? "move" : "callout";
    cui.msg = cui.mode === "callout" ? `Click someone of the group to call out to (${groupNames(b, ts)}). Esc: cancel.` : "";
    return;
  }
  if (v === "shoveFoe") { // sim/shoving.js
    const near = pushTargets(b, u);
    if (near.length === 1) return void act(state, { type: "shoveFoe", unit: u.id, target: near[0].id });
    if (!near.length) { cui.msg = pushRefusal(b, u); return; }
    cui.mode = cui.mode === "shoveFoe" ? "move" : "shoveFoe";
    cui.msg = "Click who to shove, right next to them.";
    return;
  }
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
  if (v === "dropCarried" || v === "dropAllCarried" || v === "pickCarried" || v === "setOver") return void act(state, { type: v, unit: u.id }); // sim/carry.js
  if (v === "letGoCart" || v === "takeCart") return void act(state, { type: v, unit: u.id }); // sim/carts.js
  if (v === "parkCart") { cui.mode = cui.mode === "parkCart" ? "move" : "parkCart"; cui.msg = cui.mode === "parkCart" ? "Click one of the highlighted cells beside them (left, right, in front or behind) to park the cart on: half cover in the way (people shove it or go round, the dead crawl over it). 1 action." : ""; return; }
  if (v === "loadCart") { const c = cartsNear(b, u)[0]; fieldReady(b, state); if (c) cui.lootReq = { uid: u.id, box: c.id }; else cui.lootReq = { uid: u.id, box: null }; return; } // sim/carts.js: the search window on the cart (or the one pushed: its grid on the person)
  // A window next to the unit (sim/windows.js): with one window next to them act at once, else click the window.
  if (v === "checkwindow" || v === "openwindow" || v === "closewindow" || v === "breakwindow") {
    const list = windowsBy(b, u);
    if (list.length === 1) return void act(state, { type: v, unit: u.id, x: list[0].x, y: list[0].y });
    if (!list.length) { cui.msg = "Stand right next to a window (not diagonally)."; return; }
    cui.mode = cui.mode === v ? "move" : v;
    cui.msg = `Click the window to ${v === "checkwindow" ? "check" : v === "openwindow" ? "open" : v === "closewindow" ? "close" : "break"}.`;
    return;
  }
  // The defenders' keys (sim/basemap.js keyAct): with one lock to work act at once, else click the one.
  if (v === "keylock" || v === "keyunlock") {
    const list = keyTargets(b, u, v === "keylock");
    if (list.length === 1) return void act(state, { type: v, unit: u.id, x: list[0].x, y: list[0].y });
    if (!list.length) { cui.msg = v === "keylock" ? "Stand next to an unlocked door, the open gate or an unlocked container of the base." : "Stand next to a locked door, the gate or a locked container of the base."; return; }
    cui.mode = cui.mode === v ? "move" : v;
    cui.msg = `Click the ${list.map((o) => o.name).filter((n, i, a) => a.indexOf(n) === i).join(" or ")} to ${v === "keylock" ? "lock" : "unlock"}.`;
    return;
  }
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
  stampMoves(b, now); // the moves your orders made since the last frame (before the footsteps read them: ui/audio.js)
  if (cui.redraw) { cui.redraw = false; return true; } // the cards again (a right click's step back in Ally orders)
  if (isRedeploy(b) && cui.autoRedeploy) { act(state, { type: "start" }); return true; }
  // The AI plays your side (cb-autoplay): your turn (and a deploy step) at the enemy turn's pace, until you take back
  // control. It may sound the retreat from a fight it judges lost, as the autopilot does.
  if (cui.autoPlay && !b.over && (b.phase === "player" || b.phase === "deploy")) {
    if (now - cui.lastStep < ENEMY_STEP_MS || now < cui.walkUntil) return false;
    cui.lastStep = now;
    cui.endAsk = cui.retreatAsk = cui.fallAsk = null;
    cui.mode = "move";
    if (planOpen(b)) { botPlan(state, b); return true; } // sim/raidplan.js: a good scout first, the night if near and the team is stealthy
    const before = b.fxSeq;
    SIM.autoPlayerTurn(state);
    walkWait(b, stampMoves(b, now), before, now);
    ingestMarks(b, now);
    cui.sel = null;
    if (state.combat === b && b.phase === "player") autoSelect(b, false); // playing itself: the camera is left alone
    return true;
  }
  if (b.over || b.phase !== "enemy") return false;
  if (now - cui.lastStep < ENEMY_STEP_MS || now < cui.walkUntil) return false;
  cui.lastStep = now;
  // Skip quickly past enemies the player cannot see doing nothing visible.
  for (let i = 0; i < 30 && b.phase === "enemy" && !b.over; i++) {
    const before = b.fxSeq;
    const u = enemyStep(state);
    const end = stampMoves(b, now);
    ingestMarks(b, now);
    if (!u) break;
    // Pause only when something happened that the player can see (and, when it walked where you see it, while it walks).
    if (b.fx.some((f) => f.seq > before && (f.type !== "move" || playerSees(b, u)))) { if (playerSees(b, u)) walkWait(b, end, before, now); break; }
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
  const phase = b.over ? `<b>${(b.result.raid && b.result.raid.calledOff) || b.result.calledOff ? "Called off" : b.result.outcome === "victory" ? "Victory" : b.result.outcome === "extracted" ? "Got out" : b.result.outcome === "retreat" ? "Retreated" : "Defeat"}</b>` :
    b.phase === "deploy" ? `<b class="warn">Deploy</b>` : b.phase === "player" ? `<b class="good">Your turn</b>` : `<b class="danger">Enemy turn</b>`;
  // The menu (ui/settings.js): save the battle as it stands, load, options. The battle waits while it is open.
  let html = `<button class="mini cbmenu" data-action="set-open" data-tip="Menu: save the battle as it stands, load, options">⚙ Menu</button>${viewBar(b)}`;
  if (b.layout) return html + layoutPanel(state, b, cui, `<div id="cbprev" class="cbprev">${previewHtml(b, state)}</div>`); // the base map (sim/basemap.js, ui/basemap.js)
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

  if (planOpen(b) && !b.over) html += planAsideHtml(state, b); // sim/raidplan.js: before going in, the window put aside to look at the site (the window itself: ui.js pickModal)
  html += `<h3>Your team</h3><div class="cbroster">`; // the 🎒 Inventory of the selected one: the bottom bar (ui/battlebar.js)
  players(b).forEach((p, i) => {
    const status = p.roseAs != null ? "Turned: one of the dead" : p.burnt ? "Dead, burnt" : p.inVehicle ? "Dead, in the car" : p.carriedBy != null ? "Dead, carried" : p.crushed ? "Dead, will not get up" : imminent(b, p) ? "Dead: a Carrier is on them, crush the skull (U) or shoot (J)" : endangered(b, p) ? "Dead: a Carrier is near" : p.dead ? "Dead" : p.left ? "Got away" : p.down ? (nlStatus(b, p) || (p.stab ? "Down, stabilized" : `Down, bleeding out (${p.bleed})${selfNote(b, p)}`)) + (p.draggedBy != null ? `, dragged by ${(unitById(b, p.draggedBy) || {}).name || "someone"}` : "") :
      [p.tied && !p.down && p.captive ? "Tied up (captive)" : p.captive && !p.tied ? "Freed captive" : "", nlStatus(b, p), ...earStatus(p), p.late ? (b.tier && b.tier.map === "wall" ? "Not on watch: at the back, out after the attackers move" : "Not on watch: in the buildings, out after the attackers move") : "", p.jam ? "JAMMED" : "", p.stun ? cap1(stunLabel(p.stun)) : "", p.ow ? "Overwatch" : "", p.suppressed > 0 ? "Suppressed" : "", p.spearOut ? "Spear thrown" : "", p.hunker ? "Hunkered" : "", p.dragging != null ? `Dragging ${(unitById(b, p.dragging) || {}).name || "someone"}` : "", handsBusy(p) ? `${handsCount(p) >= HANDS_MAX ? "Both hands" : "Hands"} full (${armsText(p)})` : "", p.shaken ? `Shaken (−${MEDIC.REVIVE.SHAKEN} aim)` : "", evacAt(b, p.x, p.y) && b.evacCols ? "In evac zone" : ""].filter(Boolean).join(", ");
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
  if (kitWarnDue(state, b)) html += kitWarnHtml(state, b); // sim/kitcheck.js: empty guns, no healing, the hurt, before the first move
  if (b.night && !b.raid && b.phase !== "deploy") html += nightHtml(b); // sim/vision.js: the dark, by the hour
  if (b.stores) html += storesHtml(b, cui, u); // the stores on the base map (sim/basemap.js); an assault's: Take, Force lock (sim/assaultstores.js)
  // Looking at another floor than the selected unit's (PageUp / PageDown, the Floor control): say so, with the way back.
  if (u && alive(u) && floorsOf(b) && u.f != null && u.f !== floorNo(b)) {
    html += `<div class="small muted cbmsg">Showing ${floorLabel(b, floorNo(b)).toLowerCase()}; ${esc(u.name.split(" ")[0])} is on ${floorLabel(b, u.f).toLowerCase()}. <button class="mini" data-action="cb-view" data-v="fgo" data-tip="Back to the selected unit's floor (V also centers on them).">Go to ${esc(u.name.split(" ")[0])}</button></div>`;
  }

  // The selected unit's orders, and what goes with them (a lock, a car, the reload chooser, the Execute / Surrender
  // question), are on the bottom bar (renderCombatBar, ui/battlebar.js).

  html += `<div id="cbprev" class="cbprev">${previewHtml(b, state)}</div>`;
  if (cui.msg) html += `<div class="small warn cbmsg">${padHtml(esc(devText(cui.msg, "battle")))}</div>`;

  const v = view(b);
  const seen = [...b.units.filter((t) => v.seen.has(t.id)), ...b.units.filter((t) => t.side === "enemy" && t.down && !t.dead && !t.off && playerSees(b, t))]; // sim/medics.js: the downed too (Finish)
  if (seen.length && u && active(u)) {
    html += `<h3>Enemies in sight</h3><div class="cbtargets">`;
    for (const t of seen) {
      const o = odds(b, u, t);
      const tip = o ? `${t.name}: ${o.label}. Click to attack with ${u.name}.` : `${t.name}: ${u.name} cannot hit them from here.`;
      html += `<button class="cbtarget" data-action="cb-target" data-id="${t.id}" ${o && o.ok && b.phase === "player" && u.ap > 0 ? "" : "disabled"} data-tip="${esc(tip)}">
        <span>${spriteImg(canvasURL(unitCanvas(state, b, t, cui.salt)), 1.5)}${esc(t.name)}${t.down ? ` <span class="muted">(${t.surr ? "gave up" : "down"}${t.ko ? ", out cold" : t.surr ? "" : t.stab ? ", stabilized" : `, bleeding ${t.bleed || 0}`}${t.tied ? ", tied" : ""})</span>` : t.aware ? "" : ' <span class="warn">(unaware)</span>'}${t.kind === "human" && t.weaponName ? ` <span class="small muted">${esc(t.weaponName)}</span>` : ""}${t.stun ? ` <span class="good">(${esc(t.stun.dazed ? "dazed" : "stunned")})</span>` : ""}${t.jam ? ' <b class="danger">JAMMED</b>' : ""}${t.suppressed > 0 ? ' <span class="warn">suppressed</span>' : ""}${isMedic(t) && !t.down ? ' <span class="danger" data-tip="A medic: revives and drags their downed, heals the hurt.">✚</span>' : ""}</span><span class="small">${Math.round(t.hp)} hp${o && o.ok ? ` · <b class="${hitTone(o.chance)}">${o.chance}%</b>` : ""}</span></button>`;
    }
    html += `</div>`;
  }

  html += `<h3>Log</h3><div class="cblog" id="cblog">${b.log.slice(-40).map((l) => `<div class="k-${l.k}"><span class="t">T${l.turn}</span>${esc(l.text)}</div>`).join("")}</div>`;
  // The turn controls (End turn, Sound the retreat, AI plays my side …) and their questions: the bottom bar (renderCombatBar).
  html += `<div class="small muted" style="margin-top:0.3rem"><button class="${cui.confirmEnd ? "active" : ""}" data-action="cb-confirm" data-tip="When on, Space or End turn asks once while units still have actions (Enter always ends at once). Remembered in this browser.">${cui.confirmEnd ? "✔" : "✗"} Ask before ending a turn with actions left</button></div>`;
  return html;
}

// ---------- the bottom bar (ui/battlebar.js) ----------
// The selected one's card and everyone's tabs, the orders (unitOrders), the turn controls with their questions (the
// end turn, the retreat, the fall back to the yard), the weapon and the turn. main.js writes it into #cbbar.
// All: the bar shows the orders that cannot be given now too, greyed (off by default: ready only), kept per machine.
// barTray: the group whose tray is open (Esc or an order given from it closes it).
const BAR_ALL_KEY = "bs.battle.barAll";
try { cui.barAll = typeof localStorage !== "undefined" && localStorage.getItem(BAR_ALL_KEY) === "1"; } catch { cui.barAll = false; }
cui.barTray = null;
export function setBarAll(on) { cui.barAll = !!on; try { if (typeof localStorage !== "undefined") localStorage.setItem(BAR_ALL_KEY, on ? "1" : "0"); } catch { /* private mode */ } }
function endAskHtml(b) {
  const n = unitsWithActions(b);
  return `<div class="small warn cbmsg cbconfirm"><b>${n} unit${n === 1 ? " still has" : "s still have"} actions</b> — ${hintFor({ key: `press ${esc(keyLabel("battle.endTurn", 1) || "Space")} again or ${esc(keyLabel("battle.confirm", 1) || "Enter")} to end the turn (Esc to keep playing)`, pad: "press Ⓨ again to end the turn (Ⓑ to keep playing)" })}.
    <div style="margin-top:0.3rem"><button data-action="cb-end" data-now="1" data-tip="End the turn now; units with actions left do nothing.">End turn now</button>
    <button data-action="cb-confirm" data-tip="Stop asking: Space and End turn end the turn at once (turn it back on with the checkbox below the log).">Don't ask again</button></div></div>`;
}
export function renderCombatBar(state, { flat = false } = {}) {
  const b = state.combat;
  if (!b) return "";
  sync(b);
  autoSelect(b);
  if (b.over) return "";
  const u = selUnit(b);
  if (holding(b) && !(u && u.captive)) return ""; // sim/raidplan.js: nobody is on the map before going in: no orders, no turn controls (a captive of yours: theirs)
  const ord = unitOrders(state, b, u);
  const k = (id, d = "") => keyLabel(id, 1) || d;
  const wallMap = !!(b.tier && b.tier.map === "wall");
  const noRetreat = b.evacCols && !b.raid && !wallMap ? retreatRefusal(b) : null;
  const deploy = b.phase === "deploy";
  const controls = [{ act: "cb-end", ic: "⏭️", label: "End turn", primary: true, ok: b.phase === "player" && !cui.autoPlay, key: k("battle.endTurn", "Space"), pad: "Y", why: cui.autoPlay ? "The AI is playing your side." : b.phase === "enemy" ? "The enemy is moving." : deploy ? "Start the fight first (the panel)." : "",
    tip: `End your turn. Units with actions left do nothing.${cui.confirmEnd ? " While any unit still has actions, the first press asks; press again (or Enter) to end." : ""}` }];
  if (wallMap && !deploy) controls.push({ act: "cb-fallback", v: "ask", ic: "🏃", label: "Fall back to the yard", wide: true, ok: !retreatRefusal(b), why: retreatRefusal(b), on: fallAskOpen(b), key: k("battle.retreatAll"), tip: "Everyone climbs down off the wall and falls back into the yard and the buildings (the second map). The attackers get the next turn and pour in through the openings." });
  if (noRetreat != null && !deploy) controls.push({ act: "cb-retreat", v: "ask", ic: "🏳️", label: "Sound the retreat", ok: !noRetreat, why: noRetreat, on: retreatAskOpen(b), key: k("battle.retreatAll"), tip: "Everyone still standing runs for the evac strip at once (shows each one's odds first). Those on the strip get out safely; the others make an escape check; downed teammates next to someone are carried." });
  if (b.phase === "player" && clearEnough(b)) controls.push({ act: "cb-clear", ic: "🏁", label: "Area clear: finish", ok: true, wide: true, key: k("battle.clear"), tip: "Only a couple of the enemy are left, far off and unaware (or running): the area is clear enough. End the fight as a win and leave them be; or keep playing to hunt them down." });
  if (!b.drill) controls.push({ act: "cb-autoplay", ic: cui.autoPlay ? "✋" : "🤖", label: cui.autoPlay ? "Take back control" : "AI plays my side", ok: true, on: cui.autoPlay, key: k("battle.autoplay"), tip: cui.autoPlay ? "Stop the AI: your side waits for your orders again from your next turn." : "Hand your side to the AI for the rest of the battle: it plays each of your turns (moves, shots, searches, the retreat if it judges the fight lost) while you watch. Take back control any time." });
  if (!b.raid && !b.acted && b.turn === 1 && !b.drill) controls.push({ act: "cb-auto", ic: "⏩", label: "Auto-resolve", ok: true, tip: "Skip the tactical battle and resolve it instantly by the numbers. Only before you act on turn 1." });
  if (restartable(state, b)) controls.push({ act: "set-battlereload", ic: "↺", label: "Restart battle", ok: true, tip: "Load the save made as this battle started and play it again from the beginning (asks first). Everything since it began is lost." });
  const ask = retreatAskOpen(b) ? retreatConfirmHtml(b, askPlan(b)) : fallAskOpen(b) ? fallBackConfirmHtml(b) : endAskOpen(b) ? endAskHtml(b) : "";
  return barHtml({ state, b, u, team: players(b), orders: ord.list, head: ord.head, extra: ord.extra, controls, ask, all: cui.barAll, tray: cui.barTray, flat, cones: cui.cones, autoPlay: cui.autoPlay, salt: cui.salt });
}
// The panel and the bar together: what the battle screen shows (the tools read the screen's buttons from it), with
// every order of the selected unit on the bar (greyed ones too, none in a tray).
export const renderCombatScreen = (state) => (raidLayout(state.combat) ? renderRaidTop(state) + renderRaidCards(state) + renderRaidLog(state) + renderRaidLogFoot(state) : renderCombatPanel(state)) + renderCombatBar(state, { flat: true });

// ---------- a raid without the side panel ----------
// A raid on a site (sim/scavenge.js startScavenge, sim/combat.js createRaid) is played with the whole screen as the map
// (styles.css #combat.noside). Every other battle (a field fight, a base's defence, a drill) keeps the side panel.
export const raidLayout = (b) => !!(b && b.raid && !b.drill);
const logLines = (b, n) => b.log.slice(-n).map((l) => `<div class="k-${l.k}"><span class="t">T${l.turn}</span>${esc(l.text)}</div>`).join("");

// The strip along the top of the map (#cbtop). In the middle: the place, the turn and the clock, Heat with its bar, the
// floor shown (▲ ▼) in a building with storeys, what is carried and left to search, the ways out, the keys, the night.
// At the right: ⚙ Menu, the view's buttons (turn, zoom, center, Roofs, Cones) and 📜 Log.
export function renderRaidTop(state) {
  const b = state.combat;
  if (!raidLayout(b)) return "";
  sync(b);
  autoSelect(b);
  const R = b.raid;
  const party = state.parties.find((x) => x.id === b.setup.partyId);
  const sel = selUnit(b);
  const me = sel && sel.side === "player" && party ? personalLoad(state, sel) : null;
  const trunk = party ? trunkInfo(state, b) : null;
  const stage = Math.min(3, Math.floor(R.heat / 25));
  const left = R.containers.filter((c) => !c.searched && c.kind !== "body" && c.kind !== "ground").length;
  const found = [...Object.entries(R.found).map(([k, n]) => `${n} ${keyWord(k)}`), ...R.foundGear.map((g) => g.name)];
  const I = R.interior;
  const street = !!(I && R.plan && R.plan.street);
  const exits = I && R.plan ? (street ? R.zones.map((z) => (z.name || z.side).toLowerCase()) : ["the front", ...(R.plan.exits || []).filter((e) => e.zone >= 0).map((e) => e.name.toLowerCase())]) : [];
  const waiting = I && R.occupants ? R.occupants.waiting.reduce((a, w) => a + w.count, 0) : 0;
  const phase = b.over ? `<span class="ct-phase ${b.result.outcome === "extracted" ? "player" : "enemy"}">${b.result.raid && b.result.raid.calledOff ? "Called off" : b.result.outcome === "extracted" ? "Got out" : "Nobody made it out"}</span>` : b.phase === "player" ? `<span class="ct-phase player">Your turn</span>` : `<span class="ct-phase enemy">Enemy turn</span>`;
  let mid = `<div class="ct-box"><span class="ct-title" data-tip="${esc(I ? `Scavenging the ${I.name.toLowerCase()} at ${b.place}.` : `Scavenging ${b.place}.`)}">${I ? `${esc(I.name)} · ` : ""}${esc(b.place)}</span>
    <span class="ct-sub" data-tip="Six turns are about an hour on the map clock.">Turn ${b.turn} · ${Math.floor((b.turn - 1) / 6)}h ${((b.turn - 1) % 6) * 10}m in</span> ${phase}
    <span class="ct-heat" data-tip="Heat rises every turn and faster with gunfire and car alarms. Each new stage (Stirring 25, Swarming 50, Overrun 75) brings a wave of the dead from the map edges.">Heat <b>${HEAT_NAMES[stage]}</b> <span class="muted">${Math.round(R.heat)}</span><span class="heat"><i style="left:${Math.min(100, R.heat)}%"></i></span></span>`;
  const F = floorsOf(b);
  if (F) {
    const f = floorNo(b), name = F[f] && F[f].name ? ` (${F[f].name})` : "";
    const fb = (v, label, tip, on) => `<button class="mini" data-action="cb-view" data-v="${v}" ${on ? "" : "disabled"} data-tip="${esc(tip)}">${label}</button>`;
    mid += `<span class="ct-floor" data-tip="${esc(`The floor shown${name}. PageUp / PageDown or ▲ ▼ change it; selecting a unit shows its floor; clicking the marker of someone on another floor jumps there. Below the floor shown the building is its outer walls; above it is cut away, the roof only on the top floor.`)}">${esc(floorLabel(b, f))} ${fb("fup", "▲", f < F.length - 1 ? `Show the floor above (PageUp): ${floorLabel(b, f + 1).toLowerCase()}.` : "This is the top floor.", f < F.length - 1)}${fb("fdown", "▼", f > 0 ? `Show the floor below (PageDown): ${floorLabel(b, f - 1).toLowerCase()}.` : "This is the ground floor.", f > 0)}</span>`;
  }
  mid += `</div>`;
  // The second line: what is carried, the ammo and meds, what is left, the finds, the ways out, the vehicle, the night, the keys.
  const supply = `<div class="ct-box cbsupply" style="gap:0.2rem 0.75rem;margin:0">
    ${me ? `<span data-tip="${esc(`What ${sel.name.split(" ")[0]} carries: worn and held ${Math.round(me.worn)} kg${me.share ? `, their share of the team's supplies ${Math.round(me.share)} kg` : ""}, finds carried loose ${Math.round(me.haul)} kg. Each survivor carries their own finds; anything that does not fit stays in the container.${trunk ? " Unload at the vehicle (N) to free them up." : ""}`)}">${esc(sel.name.split(" ")[0])} <b class="${me.room < 2 ? "warn" : ""}">${Math.round(me.load)}/${Math.round(me.max)} kg</b></span>` : ""}
    ${trunk ? `<span data-tip="${esc(`${trunk.name}: what is in it (the team's supplies and cargo) and how much more it takes${trunk.bike ? "" : ", counting everything your people carry, because the car takes all of it home"}.`)}">${trunk.bike ? "Racks" : "Vehicle"} <b>${Math.max(0, Math.round(trunk.space))} kg free</b></span>` : ""}
    <span data-tip="Rounds carried, every calibre: each gun fires only rounds of its own calibre and loaded type (Reload with another type switches it). Each shot uses 1 (assault rifle bursts use 2). Reload (1 action) fills a gun's magazine from this. Bows and crossbows shoot arrows instead.">Ammo <b>${Math.floor(ammoLeft(b))}</b></span>
    ${arrowsChip(b)}
    <span data-tip="Meds carried. One treats a wound or stabilizes someone who is down.">Meds <b>${Math.floor(medsLeft(b))}</b></span>
    <span data-tip="${esc(`Containers not yet searched. ${found.length ? `Found so far: ${found.join(", ")}.` : "Nothing found yet."}`)}">Left to search <b>${left}</b></span>
    ${found.length ? `<span class="ct-sub" data-tip="${esc(`Found so far: ${found.join(", ")}. Each survivor carries their own finds.`)}">Found <b>${found.length}</b></span>` : ""}
    ${I ? `<span class="ct-sub" data-tip="${esc(`Ways out: ${exits.join(", ")}. ${street ? "Both ends of the street and the back gardens are green extraction zones. Each house has its own doors and stairs; locked doors (padlocks) open like any lock, from either side." : "Every way out has a green extraction zone outside it. Locked doors (padlocks) open like any lock, from either side."}`)}">Ways out <b>${exits.length}</b></span>${waiting ? `<span class="warn" data-tip="People inside who have not shown themselves yet.">${waiting} other people inside</span>` : ""}` : ""}
    ${(R.hasVehicle ?? R.vehicleZone >= 0) ? `<span class="warn" data-tip="Leave from another zone and the vehicle stays here, marked on the map. It can be driven (Drive) and extracts with whoever leaves from the zone it stands at.">${R.vehicleZone >= 0 ? "Vehicle at a zone" : "Vehicle away from the zones"}</span>` : ""}
    ${b.night ? `<span class="warn" data-tip="${esc(`Night (${nightWord(b)}): everyone on foot sees down a cone the way they face, ${darkSight(b)} tiles ahead in the dark and only the cells right around them; a light is a beam the way its carrier faces, seen from far off. ${keyLabel("battle.light", 1) || "Light on / off"}, ${keyLabel("battle.nvg", 1) || "NVG on / off"}.`)}">Night, ${esc(nightWord(b))}: ${darkSight(b)} tiles</span>` : ""}
    ${raidKeyLine(state, b, { inline: true })}
    ${sel && sel.side === "player" && active(sel) && quickable(searchableNear(b, sel)).length ? `<span class="ct-sub" data-tip="${esc(`Shift+Q, no action (once a turn): heard ${quickRadius(b, sel)} tiles off, Heat +${SEARCH.quick.heat}. Only ${Math.round(SEARCH.quick.reveal[0] * 100)}–${Math.round(SEARCH.quick.reveal[1] * 100)}% of what is inside turns up; ${quickHurtPct(state, b, sel)} chance of cutting yourself (less likely with Scavenging or Stealth, more in the dark without a light).`)}">Quick search: loud, ${quickHurtPct(state, b, sel)} cut</span>` : ""}
    ${planOpen(b) && !b.over && planUI.map ? planChip(b) : ""}
  </div>`;
  mid += supply;
  const groups = b.over ? "" : groupChips(b); // sim/parley.js: the other groups seen, hostile or not
  mid += groups;
  if (raidCompact()) return raidTopCompact(b, { phase, stage, F, supply, groups });
  // The right: the Menu, the view, the Log.
  const right = `<div class="ct-box"><button class="mini cbmenu" data-action="set-open" data-tip="Menu: save the battle as it stands, load, options">⚙ Menu</button>${viewBar(b, { floor: false })}<button class="mini${LOGWIN.open ? " active" : ""}" data-action="cb-log" data-v="toggle" data-tip="${esc(`Show or hide the log (${keyLabel("bview.log") || "Shift+M"}). It is a small window: drag its title to move it, its corner to resize it, – to fold it to the title.`)}">📜 Log</button></div>`;
  return `<div class="ct-mid">${mid}</div><div class="ct-right">${right}</div>`;
}

// The strip on a phone or a tablet held upright (ui/responsive.js raidCompact; a desktop never comes here): one row of
// finger-sized buttons so the map keeps the screen. The place, the turn and Heat on one button that drops down the
// rest (what is carried, the ammo, what is left, the ways out, the groups seen: the desktop's second line); the floor
// ▲ ▼ in a building with storeys (the turn and whose it is are on the orders bar under the map); 📜 the log, a drawer, with how many lines came in since it was last open; ⋯ the
// Menu and the view (turn, zoom, center, Roofs, Cones), which a finger needs less often (it pans and pinches).
// The drop-downs open from RAIDUI (responsive.js toggles it on a tap, data-rs, and closes it on a tap elsewhere).
function raidTopCompact(b, { phase, stage, F, supply, groups }) {
  const R = b.raid, I = R.interior;
  const nGroups = (groups.match(/class="ct-group/g) || []).length;
  if (RAIDUI.logOf !== b.setup) { RAIDUI.logOf = b.setup; RAIDUI.logSeen = b.log.length; } // a new raid: nothing new yet
  if (b.over && RAIDUI.overOf !== b.setup) { RAIDUI.overOf = b.setup; if (LOGWIN.open) LOGWIN.open = false; } // the result's sheet, not the log over it (not saved)
  if (LOGWIN.open) RAIDUI.logSeen = b.log.length;
  const fresh = Math.max(0, b.log.length - RAIDUI.logSeen);
  const time = `Turn ${b.turn} · ${Math.floor((b.turn - 1) / 6)}h ${((b.turn - 1) % 6) * 10}m in`;
  let row = `<button class="rs-ctstat${RAIDUI.info ? " active" : ""}" data-rs="info" aria-expanded="${RAIDUI.info}" aria-controls="rs-ctinfo" data-tip="The raid: what is carried, the ammo and meds, what is left to search, the ways out, the groups seen">
    <span class="ct-title">${I ? `${esc(I.name)} · ` : ""}${esc(b.place)}</span>
    <span class="rs-ctline">${b.over ? `${phase} ` : ""}<span class="ct-heat">Heat <b>${HEAT_NAMES[stage]}</b><span class="heat"><i style="left:${Math.min(100, R.heat)}%"></i></span></span>${nGroups ? `<i class="rs-ctgr">👥 ${nGroups}</i>` : ""}</span></button>`;
  if (F) {
    const f = floorNo(b);
    const fb = (v, label, tip, on) => `<button data-action="cb-view" data-v="${v}" ${on ? "" : "disabled"} aria-label="${esc(tip)}" data-tip="${esc(tip)}">${label}</button>`;
    row += `<span class="ct-floor rs-ctfloor" data-tip="${esc(`${floorLabel(b, f)}: the floor shown.`)}"><b>F${f + 1}</b>${fb("fup", "▲", f < F.length - 1 ? `Show the floor above: ${floorLabel(b, f + 1).toLowerCase()}.` : "This is the top floor.", f < F.length - 1)}${fb("fdown", "▼", f > 0 ? `Show the floor below: ${floorLabel(b, f - 1).toLowerCase()}.` : "This is the ground floor.", f > 0)}</span>`;
  }
  row += `<button class="rs-ctlog${LOGWIN.open ? " active" : ""}" data-action="cb-log" data-v="${LOGWIN.open ? "close" : "show"}" aria-label="Log" aria-expanded="${LOGWIN.open}" data-tip="The log: what happened, turn by turn">📜${fresh && !LOGWIN.open ? `<b class="rs-badge">${fresh > 99 ? "99+" : fresh}</b>` : ""}</button>`;
  row += `<button class="rs-ctmore${RAIDUI.view ? " active" : ""}" data-rs="view" aria-label="Menu and view" aria-expanded="${RAIDUI.view}" aria-controls="rs-ctview" data-tip="The Menu and the view: turn, zoom, center, Roofs, Cones">⋯</button>`;
  let html = `<div class="ct-mid rs-ct">${row}</div>`;
  if (RAIDUI.info) html += `<div class="rs-ctdrop" id="rs-ctinfo"><div class="ct-box"><span class="ct-sub">${time}</span>${phase}</div>${supply}${groups}</div>`;
  if (RAIDUI.view) html += `<div class="rs-ctdrop rs-ctview" id="rs-ctview"><div class="ct-box"><button class="cbmenu" data-action="set-open" data-tip="Menu: save the battle as it stands, load, options">⚙ Menu</button>${viewBar(b, { floor: false })}</div></div>`;
  return html;
}

// The cards over the map (#cbcards), in the middle under the strip: the dialogue before you go in (unless put aside),
// the building to search, a warning (cui.msg), the floor shown against the selected one's, the hover details, the result.
export function renderRaidCards(state) {
  const b = state.combat;
  if (!raidLayout(b)) return "";
  sync(b);
  autoSelect(b);
  const u = selUnit(b);
  if (raidCompact()) return raidCardsCompact(state, b, u);
  let html = "";
  if (b.over) return `<div class="cbcard">${raidResultCard(state, b)}</div>`;
  if (planOpen(b) && planUI.map) html += `<div class="cbcard">${planAsideHtml(state, b)}</div>`; // ui/raidplan.js: the window put aside to look at the site (the window itself: ui.js pickModal)
  if (b.raid.choose) html += `<div class="cbcard">${chooseHtml(b)}</div>`;
  if (kitWarnDue(state, b)) html += `<div class="cbcard">${kitWarnHtml(state, b)}</div>`; // sim/kitcheck.js: empty guns, no healing, the hurt, before anyone goes in
  html += allyCard(state, b); // Ally orders (sim/allyorders.js): the orders for the ally picked
  if (cui.msg) html += `<div class="cbcard ct-toast small warn">${padHtml(esc(devText(cui.msg, "battle")))}</div>`;
  if (u && alive(u) && floorsOf(b) && u.f != null && u.f !== floorNo(b)) {
    html += `<div class="cbcard small muted">Showing ${floorLabel(b, floorNo(b)).toLowerCase()}; ${esc(u.name.split(" ")[0])} is on ${floorLabel(b, u.f).toLowerCase()}. <button class="mini" data-action="cb-view" data-v="fgo" data-tip="Back to the selected unit's floor (Home also centers on them).">Go to ${esc(u.name.split(" ")[0])}</button></div>`;
  }
  // The hover details, written straight into the box as the mouse moves (combatMouse): hidden while nothing is hovered.
  if (!planOpen(b) || planUI.map) html += `<div id="cbprev" class="cbprev${cui.hover ? "" : " empty"}">${previewHtml(b, state)}</div>`;
  return html;
}
// The cards on a phone or a tablet held upright (ui/responsive.js raidCompact): one sheet, from the bottom of the map
// (upright) or its right edge (a phone on its side), with a handle that folds it to one line naming what is in it,
// so the map can be looked at with a choice still open. A card that was not there before opens it again. The
// warning toast and the details of what a finger is on (#cbprev, the tap's preview) stay outside it, always shown.
function raidCardsCompact(state, b, u) {
  const cards = []; // [title, html, its own .cbcard already]
  if (b.over) {
    const r = b.result;
    cards.push([r.raid && r.raid.calledOff ? "Called off" : r.outcome === "extracted" ? "Got out" : "Nobody made it out", raidResultCard(state, b)]);
  } else {
    if (planOpen(b) && planUI.map) cards.push(["Looking at the site", planAsideHtml(state, b)]);
    if (b.raid.choose) cards.push(["Where do you go in?", chooseHtml(b)]);
    if (kitWarnDue(state, b)) cards.push(["Before you go in", kitWarnHtml(state, b)]);
    const ally = allyCard(state, b);
    if (ally) cards.push(["Ally orders", ally, true]); // its own card already (.cbcard.cbally)
    if (u && alive(u) && floorsOf(b) && u.f != null && u.f !== floorNo(b)) cards.push([`${u.name.split(" ")[0]} is on another floor`, `<div class="small muted">Showing ${floorLabel(b, floorNo(b)).toLowerCase()}; ${esc(u.name.split(" ")[0])} is on ${floorLabel(b, u.f).toLowerCase()}. <button class="mini" data-action="cb-view" data-v="fgo" data-tip="Back to the selected unit's floor.">Go to ${esc(u.name.split(" ")[0])}</button></div>`]);
  }
  const key = cards.map((c) => c[0]).join("|");
  if (key !== RAIDUI.cardsKey) { if (cards.some((c) => !RAIDUI.cardsKey.split("|").includes(c[0]))) RAIDUI.cardsMin = false; RAIDUI.cardsKey = key; }
  const min = RAIDUI.cardsMin;
  let html = "";
  if (cards.length) {
    const label = `${esc(cards[0][0])}${cards.length > 1 ? ` <span class="muted">+${cards.length - 1}</span>` : ""}`;
    html += `<div class="rs-sheet${min ? " min" : ""}${b.over ? " rs-over" : ""}"><button class="rs-sheeth" data-rs="sheet" aria-expanded="${!min}" data-tip="${min ? "Open the cards" : "Fold the cards to look at the map"}"><span class="rs-grab" aria-hidden="true"></span><span class="rs-sheett">${label}</span><span class="rs-sheetc" aria-hidden="true">${min ? "▴" : "▾"}</span></button>`;
    if (!min) html += `<div class="rs-sheetb">${cards.map((c) => (c[2] ? c[1] : `<div class="cbcard">${c[1]}</div>`)).join("")}</div>`;
    html += `</div>`;
  }
  if (cui.msg && !b.over) html += `<div class="cbcard ct-toast small warn">${padHtml(esc(devText(cui.msg, "battle")))}</div>`;
  if (!b.over && (!planOpen(b) || planUI.map)) html += `<div id="cbprev" class="cbprev${cui.hover ? "" : " empty"}">${previewHtml(b, state)}</div>`;
  return html;
}

// The log window's lines (#cblogbody) and its footer (#cblogfoot: the ask-before-ending toggle that sat under the panel's log).
export function renderRaidLog(state) {
  const b = state.combat;
  return raidLayout(b) ? logLines(b, 80) : "";
}
export function renderRaidLogFoot(state) {
  const b = state.combat;
  if (!raidLayout(b) || b.over) return "";
  return `<button class="mini ${cui.confirmEnd ? "active" : ""}" data-action="cb-confirm" data-tip="When on, Space or End turn asks once while units still have actions (Enter always ends at once). Remembered in this browser.">${cui.confirmEnd ? "✔" : "✗"} Ask before ending a turn with actions left</button>`;
}

// The view bar: turn, zoom, center, roofs; in a building with storeys the floor shown (`Floor 2 of 5 ▲ ▼`).
export function viewBar(b = cui.battle, { floor = true } = {}) {
  const btn = (v, label, tip, active = false) => `<button class="mini${active ? " active" : ""}" data-action="cb-view" data-v="${v}" data-tip="${esc(tip)}">${label}</button>`;
  let html = `<div class="cbview">`;
  const kl = (id, def) => keyLabel(id) || def; // as bound now (Menu → Controls)
  const turn = "Eight views: the four diagonal ones and, between them, four looking straight down the rows and columns (corridors and the tiles behind walls)";
  html += btn("rotl", "⟲", `Turn the view an eighth to the left (${kl("bview.rotLeft", "Q")}). ${turn}.`) + btn("rotr", "⟳", `Turn the view an eighth to the right (${kl("bview.rotRight", "E")}). ${turn}.`);
  html += btn("zout", "−", `Zoom out (${kl("bview.zoomOut", "−")} or the mouse wheel)`) + btn("zin", "+", `Zoom in (${kl("bview.zoomIn", "+")} or the mouse wheel)`);
  html += btn("center", "◎", `Center on the selected unit (${kl("bview.center", "Home")}). Drag the map, hold W A S D or the arrow keys, or push the mouse to the edge to pan.`);
  html += btn("roofs", iso.roofs ? "Roofs ✔" : "Roofs ✗", `Roofs on the buildings (${kl("bview.roofs", "B")}). A building is shown cut away only with the selected survivor inside it (inside, you see only the rooms your people see; the rest is fogged, what was seen before greyed with what was there then); off shows every one cut away, still fogged.`, iso.roofs);
  html += btn("cones", cui.cones ? "Cones ✔" : "Cones ✗", `View cones (${kl("bview.cones", "Alt+C")}): what each of your people watches and, for the enemies you see, how near an unaware one notices the selected unit in its cone (orange; the dashed ring: what it hears behind it) or where an aware one is looking (red). The selected unit's own cone is always shown.`, cui.cones);
  const F = floor && b && floorsOf(b);
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
  const found = [...Object.entries(R.found).map(([k, n]) => `${n} ${keyWord(k)}`), ...R.foundGear.map((g) => g.name)];
  // A building's own map (sim/buildingmaps.js): its name, its ways out, people inside who are not placed yet.
  const I = R.interior;
  const street = !!(I && R.plan && R.plan.street); // a street of houses (sim/buildingmaps.js streetMap): its ways out are the map's zones
  const exits = I && R.plan ? (street ? R.zones.map((z) => (z.name || z.side).toLowerCase()) : ["the front", ...(R.plan.exits || []).filter((e) => e.zone >= 0).map((e) => e.name.toLowerCase())]) : [];
  const waiting = I && R.occupants ? R.occupants.waiting.reduce((a, w) => a + w.count, 0) : 0;
  return `<div class="cbhead">
    <div class="cbtitle">Scavenging ${I ? `the ${esc(I.name.toLowerCase())} · ` : ""}${esc(b.place)}</div>
    ${I ? `<div class="small muted" data-tip="${street ? "Both ends of the street and the back gardens are green extraction zones. Each house has its own doors and stairs; locked doors (padlocks) open like any lock, from either side." : "Every way out has a green extraction zone outside it. Locked doors (padlocks) open like any lock, from either side."}">Ways out: ${esc(exits.join(", "))}${waiting ? ` · <span class="warn">${waiting} other people inside</span>` : ""}</div>` : ""}
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
    ${b.night ? nightHtml(b) : ""}
    ${raidKeyLine(state, b)}
  </div>`;
}

// ---------- other groups on a raid's map (sim/parley.js) ----------
// A group's status as your people see it: null for your own, the dead, anyone in no group, and outside raids.
const groupOf = (b, t) => (b && b.raid && t ? parleyStatus(b, t) : null);
// The hover text's first word on one of the third side: by their group's status when they have one (allied, a standoff).
function thirdWord(b, t) {
  const g = groupOf(b, t);
  if (g && g.allied) return "Fighting beside you: the dead and hostile groups are their foes too. They never shoot your people.";
  if (g && g.standoff) return "Guns up, holding their fire: they wait for your answer.";
  return t.team === "military" ? "A soldier: fights the dead and anyone who attacks them, not you unless you fire on them." : `A survivor keeping to themselves: they defend themselves or run.${g ? "" : " Talk to them after the fight."}`;
}
const groupNames = (b, ts) => [...new Set(ts.map((t) => (groupOf(b, t) || {}).name).filter(Boolean))].join(", ") || "another group";
// Whom u can call out to now, one per group (kept per map change: the map marks them every frame in callout mode).
function callTargets(state, b, u) {
  if (!b || !b.raid || !u || u.side !== "player") return [];
  const key = `${b.rev}:${b.turn}:${b.phase}:${u.id}:${u.x},${u.y}:${u.ap}`;
  if (cui.callCache && cui.callCache.b === b && cui.callCache.key === key) return cui.callCache.list;
  const list = (callOutTargets(state, b, u) || []).filter(Boolean);
  cui.callCache = { b, key, list };
  return list;
}
// Why u cannot call out now: the sim's reason about the nearest one of another group in sight, or nobody in sight.
function callWhy(state, b, u) {
  if (u.ap < 1) return NO_AP;
  const v = view(b), d = (t) => Math.max(Math.abs(t.x - u.x), Math.abs(t.y - u.y));
  const near = b.units.filter((t) => t.side !== "player" && active(t) && v.seen.has(t.id) && groupOf(b, t)).sort((p, q) => d(p) - d(q))[0];
  return (near && callOutRefusal(state, b, u, near)) || "Nobody of another group in sight: survivors, soldiers or a hostile group's people.";
}
// The person clicked (or any of their group in sight): the call goes to the one of that group u can call to.
function callOut(state, b, u, t) {
  const g = groupOf(b, t), ts = callTargets(state, b, u);
  const to = ts.find((x) => x.id === t.id) || (g && ts.find((x) => { const o = groupOf(b, x); return o && o.key === g.key; })) || t;
  act(state, { type: "callout", unit: u.id, target: to.id });
}
// What a shout costs (sim/parley.js shoutCost when it is there: its reach, Heat and how risky it is here; else PARLEY's numbers).
const SHOUT_RISK = { low: "little risk now", some: "some risk now: the dead are close to stirring", high: "a real risk now: it is enough to bring more of the dead" };
function shoutText(state, b) {
  let c = null;
  try { c = typeof PARLEY_SIM.shoutCost === "function" ? PARLEY_SIM.shoutCost(state, b) : null; } catch { c = null; }
  const r = c && c.radius != null ? c.radius : PARLEY && PARLEY.SHOUT, heat = c && c.heat != null ? c.heat : PARLEY && PARLEY.HEAT;
  if (!r) return "";
  return ` The shout is heard ${r} tiles off${heat ? ` (Heat +${heat})` : ""}: the dead and the unaware come to look${c && SHOUT_RISK[c.risk] ? `; ${SHOUT_RISK[c.risk]}` : ""}.`;
}
function callButton(state, b, u, btn) {
  const ts = callTargets(state, b, u), me = esc(u.name.split(" ")[0]);
  const shout = shoutText(state, b);
  btn("callout", "Call out", `1 action: ${me} shouts to ${ts.length ? esc(groupNames(b, ts)) : "another group in sight"} to talk, friendly or not: hold your fire, both walk away, trade, ask them to join, ask what they know, or attack them while they listen. The odds go by how hostile they are and ${me}'s Speech.${shout}${ts.length > 1 ? " More than one group in sight: click the one to call to." : ""}`,
    ts.length > 0, "Alt+O", { why: ts.length ? "" : callWhy(state, b, u), on: cui.mode === "callout" });
}
// The group line of the hover text: who they are with, the stance your people see, hostile now or not (and Call out).
function groupLine(state, b, t) {
  const g = groupOf(b, t);
  if (!g) return "";
  const u = selUnit(b), ts = state && u && u.side === "player" && active(u) ? callTargets(state, b, u) : [];
  const can = ts.some((x) => { const o = groupOf(b, x); return o && o.key === g.key; });
  const how = !can ? "" : cui.mode === "callout" ? " · <b>Click to call out to them.</b>" : ` · Call out (${esc(keyLabel("battle.callout", 1) || "Alt+O")}) to talk.`;
  const now = g.active ? `<span class="danger">Actively hostile</span>` : g.allied ? `<span class="good">Fighting beside you</span>` : `<span class="good">Not hostile</span>`;
  const leave = groupLeave(g);
  return `<br><span class="small"><b style="color:${esc(g.color || "")}">${esc(cap1(g.name))}</b> — ${esc(cap1(g.shown || "unknown"))} group · ${esc(g.label)} · ${now}${leave ? ` · <span class="warn">${esc(leave)}</span>` : ""}${g.tell ? ` · <span class="warn"><b>${TELL_MARK}</b> Something is off about them.</span>` : ""}${how}</span>`;
}
// A walk-away (sim/parley.js parleyStatus leaveBy / goes): your people's countdown to be out of their sight, or theirs leaving.
const groupLeave = (g) => (!g || !g.leaving ? "" : g.goes === "you" && g.leaveBy != null ? `Leave their sight: ${g.leaveBy} turn${g.leaveBy === 1 ? "" : "s"}` : g.goes === "them" ? "Leaving" : "");
// The mark of a tell (parleyStatus.tell: one of yours saw through them, and they give themselves away now). Only the sim's flag.
const TELL_MARK = "!";
// What each word of the indicator means (the strip's chips).
const GROUP_WORD = {
  Hostile: "They shoot your people on sight.", Unaware: "They have not seen your people yet.", Standoff: "Guns up, nobody firing yet: they wait for an answer.",
  Truce: "Both sides hold their fire. Either side can break it.", Peaceful: "They keep to themselves; they fight back if attacked.", Leaving: "Both sides keep apart until one of you is gone.",
  Allied: "They fight beside you: the dead and hostile groups are their foes too. Nobody of yours shoots them, and they never shoot yours.",
};
// The raid's strip: a chip for each group your people have seen, hostile now or not.
function groupChips(b) {
  const gs = (b.raid && parleyGroupsSeen(b)) || [];
  if (!gs.length) return "";
  const call = keyLabel("battle.callout", 1) || "Alt+O";
  const ordered = gs.some((g) => g.allied) ? allyOrderCount(b) : null; // Ally orders: how many of an allied group are under orders
  return `<div class="ct-box cbgroups">${gs.map((g) => {
    const leave = groupLeave(g);
    // Not shooting yet is not peace: a pod that has not seen you, or holds its fire waiting for an answer, is a warning.
    const wary = !g.active && (g.label === "Unaware" || g.label === "Standoff");
    const word = g.active ? "HOSTILE" : g.allied ? "ALLIED" : leave ? leave.toUpperCase() : wary ? `NOT FIRING · ${g.label.toUpperCase()}` : "NOT HOSTILE";
    const cls = g.active ? " hostile" : g.allied ? " allied" : leave || wary ? " leaving" : "";
    const leaveTip = leave ? (g.goes === "you" ? ` You agreed to walk away from their ground: ${g.leaveBy} turn${g.leaveBy === 1 ? "" : "s"} left for your people to be out of their sight, or they open fire.` : " They agreed to pack up and leave the map.") : "";
    const n = ordered && g.allied ? ordered.get(g.key) || 0 : 0;
    const tip = `${cap1(g.name)}: ${g.label}. ${GROUP_WORD[g.label] || ""}${leaveTip}${g.tell ? " Something is off about them: one of yours does not trust them." : ""} They show as a ${g.shown || "unknown"} group${g.count ? `, ${g.count} seen` : ""}. Call out (${call}) to talk to them, whatever their stance.${g.allied ? ` Ally orders (${keyLabel("battle.allyorder", 1) || "Alt+A"}): tell one of them within ${ALLY_ORDER.RANGE} tiles what to do${n ? `; ${n} under your orders now` : ""}.` : ""}`;
    return `<span class="ct-group${cls}" data-tip="${esc(tip)}"><i style="background:${esc(g.color || "")}"></i>${esc(cap1(g.name))} <span class="muted">${esc(cap1(g.shown || ""))}</span> <b>${esc(word)}</b>${n ? ` <span class="ct-ordered">🫡${n}</span>` : ""}${g.tell ? `<em class="tell">${TELL_MARK}</em>` : ""}</span>`;
  }).join("")}</div>`;
}

// ---------- orders to allies on a raid's map (sim/allyorders.js) ----------
// Ally orders (Alt+A): one of yours tells an ally (sim/parley.js u.ally) within ALLY_ORDER.RANGE tiles what to do; they
// may not heed it. The ally: the one in reach at once, more: click one (cui.mode "allypick", those in reach marked, the
// reach shaded). Then the card of orders over the map ("allymenu": each with the odds they heed it, Whole group, Cancel),
// then what the order needs ("allytarget"): an enemy your people see, any tile (the fog too: you do not see what they
// see), the way to watch (the cone from the ally). Esc and a right click go back a step. cui.allyAsk = { uid, ally,
// kind, group, many }. Only allies your people see now are offered and marked; the markers you set show wherever they are.
export const ALLY_COLOR = "#4fe08a"; // sim/parley.js's Allied
cui.allyAsk = null;
const ALLY_MODES = new Set(["allypick", "allymenu", "allytarget"]);
const allyMode = () => ALLY_MODES.has(cui.mode);
const allyDef = (kind) => ALLY_ORDERS.find((o) => o.kind === kind) || null;
const oddsPct = (p) => (typeof p === "number" && isFinite(p) ? `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%` : "");
const allyOddsOf = (state, b, u, a, order) => (state ? oddsPct(allyOdds(state, b, u, a, order)) : "");
const tilesOff = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
// Whom u can give an order to now, those your people see (kept per map change: the map marks them every frame).
function allyTargets(state, b, u) {
  if (!b || !b.raid || !u || u.side !== "player" || !active(u) || u.ap < 1) return [];
  const v = view(b), key = `${v.key}:${b.turn}:${b.phase}:${u.id}:${u.x},${u.y}:${u.ap}`;
  if (cui.allyCache && cui.allyCache.b === b && cui.allyCache.key === key) return cui.allyCache.list;
  const list = (allyOrderTargets(state, b, u) || []).filter((t) => t && active(t) && v.seen.has(t.id));
  cui.allyCache = { b, key, list };
  return list;
}
// Why u cannot give an order now: no actions, no allies, none in sight, none in reach, else the sim's reason.
function allyWhy(state, b, u) {
  if (u.ap < 1) return NO_AP;
  const v = view(b), allies = b.units.filter((t) => t.ally && active(t));
  if (!allies.length) return "No allies here: call out to a group and ask them to fight with you.";
  const near = allies.filter((t) => v.seen.has(t.id)).sort((p, q) => tilesOff(u, p) - tilesOff(u, q))[0];
  if (!near) return "No ally in sight of your people.";
  const me = u.name.split(" ")[0];
  if (tilesOff(u, near) > ALLY_ORDER.RANGE || (near.f ?? 0) !== (u.f ?? 0)) return `No ally within ${ALLY_ORDER.RANGE} tiles of ${me} (the nearest, ${near.name}, is ${Math.round(tilesOff(u, near))} off${(near.f ?? 0) !== (u.f ?? 0) ? ", on another floor" : ""}).`;
  return allyOrderRefusal(state, b, u, near, { kind: "hold" }) || `No ally can take an order from ${me} now.`;
}
// The flow as it stands, or null (another unit selected, the ally gone, out of the ally modes).
function allyNow(b) {
  const ask = cui.allyAsk, u = b && selUnit(b);
  if (!ask || !allyMode() || !u || u.id !== ask.uid || !active(u) || b.phase !== "player" || b.over) return null;
  const a = ask.ally != null ? unitById(b, ask.ally) : null;
  if (ask.ally != null && (!a || !active(a) || !a.ally)) return null;
  return { u, a, ask, o: ask.kind ? allyDef(ask.kind) : null };
}
function allyClose() { cui.allyAsk = null; if (allyMode()) cui.mode = "move"; }
function allyOpen(u, a, many) {
  const was = cui.allyAsk;
  cui.allyAsk = { uid: u.id, ally: a.id, kind: null, group: !!(was && was.uid === u.id && was.group), many: !!many };
  cui.mode = "allymenu"; cui.msg = "";
}
const allyPickMsg = (ts) => `Click the ally to give an order to (${ts.length} within ${ALLY_ORDER.RANGE} tiles, marked). Esc: cancel.`;
// Esc, a right click: back a step (the target to the card, the card to picking the ally, else out). False: not in the flow.
function allyBack() {
  if (!allyMode()) return false;
  const ask = cui.allyAsk;
  cui.msg = "";
  if (cui.mode === "allytarget" && ask) { ask.kind = null; cui.mode = "allymenu"; }
  else if (cui.mode === "allymenu" && ask && ask.many) { ask.ally = null; cui.mode = "allypick"; cui.msg = "Click the ally to give an order to. Esc: cancel."; }
  else allyClose();
  return true;
}
// An order in words: "Move to (12, 30)", "Attack Rook", "Overwatch toward (4, 9)" (the target named only while your people see it).
function allyWhat(b, o) {
  const at = o.x != null && o.y != null ? ` (${o.x}, ${o.y})` : "";
  const t = o.targetId != null ? unitById(b, o.targetId) : null;
  if (o.kind === "attack") return `Attack ${t && active(t) && view(b).seen.has(t.id) ? t.name : "their target"}`;
  if (o.kind === "move") return `Move to${at}`;
  if (o.kind === "push") return `Push to${at}`;
  if (o.kind === "retreat") return `Retreat${at ? ` by${at}` : ""}`;
  if (o.kind === "overwatch") return `Overwatch${Array.isArray(o.face) ? ` toward (${o.face[0]}, ${o.face[1]})` : ""}`;
  return `${o.label || (allyDef(o.kind) || {}).label || o.kind}${o.kind === "free" ? "" : at}`;
}
// The order sent (act "allyorder": the sim may refuse it, the refusal shows; given, the odds they heed it show).
function allySend(state, b, f, o, extra) {
  const { u, a, ask } = f;
  const order = { kind: o.kind, ...extra, ...(ask.group ? { group: true } : {}) };
  const p = allyOddsOf(state, b, u, a, order);
  const what = allyWhat(b, { kind: o.kind, label: o.label, x: extra.x, y: extra.y, targetId: extra.target, face: extra.face });
  if (!act(state, { type: "allyorder", unit: u.id, ally: a.id, order })) return;
  cui.allyAsk = null;
  cui.msg = `${u.name.split(" ")[0]} tells ${ask.group ? `${a.name}'s group` : a.name}: ${what}.${p ? ` ${p} they heed it.` : ""}`;
}
// The button, the key and the card's buttons (combatAction "cb-act": allyorder, allykind (d.k), allygroup, allypick (d.k), allyclose).
function allyCbAct(state, b, u, v, d) {
  if (v === "allyorder") {
    if (allyMode()) { allyClose(); cui.msg = ""; return true; }
    const ts = allyTargets(state, b, u);
    if (!ts.length) { cui.mode = "move"; cui.msg = allyWhy(state, b, u); return true; }
    if (ts.length === 1) { allyOpen(u, ts[0], false); return true; }
    cui.allyAsk = { uid: u.id, ally: null, kind: null, group: false, many: true };
    cui.mode = "allypick"; cui.msg = allyPickMsg(ts);
    return true;
  }
  if (v !== "allykind" && v !== "allygroup" && v !== "allypick" && v !== "allyclose") return false;
  if (v === "allyclose") { allyClose(); cui.msg = ""; return true; }
  const f = allyNow(b);
  if (!f) { allyClose(); return true; }
  if (v === "allypick") { const ts = allyTargets(state, b, u), a = ts.find((t) => t.id === Number(d.k)); if (a) allyOpen(u, a, ts.length > 1); return true; }
  if (!f.a) return true;
  if (v === "allygroup") { f.ask.group = !f.ask.group; return true; }
  const o = allyDef(d.k);
  if (!o) return true;
  if (!o.need) { allySend(state, b, f, o, {}); return true; }
  f.ask.kind = o.kind;
  cui.mode = "allytarget";
  const name = f.a.name.split(" ")[0];
  cui.msg = o.need === "unit" ? `Click an enemy your people see for ${name} to go after. Esc: back to the orders.`
    : o.need === "face" ? `Click the way ${name} should watch: the cone shows it from where they stand. Esc: back to the orders.`
    : `Click where ${name} should ${o.kind === "push" ? "push to" : "go"}: any tile, the fog too (you do not see what they see). Esc: back to the orders.`;
  return true;
}
// A click on the map in the flow: the ally (picking, or another one in reach while the card is open), then the target.
function allyClick(state, b, u, c, who) {
  const f = allyNow(b);
  if (!f) { allyClose(); return; }
  if (cui.mode !== "allytarget") {
    const ts = allyTargets(state, b, u), a = who && ts.find((t) => t.id === who.id);
    if (a) return void allyOpen(u, a, f.ask.many || ts.length > 1);
    if (cui.mode === "allymenu") { allyClose(); cui.msg = ""; return; }
    cui.msg = allyPickMsg(ts);
    return;
  }
  const { a, o } = f;
  if (!a || !o) { allyClose(); return; }
  if (o.need === "unit") {
    if (who && who.side === "enemy" && active(who) && view(b).seen.has(who.id)) return void allySend(state, b, f, o, { target: who.id });
    cui.msg = `Click an enemy your people see for ${a.name.split(" ")[0]} to go after. Esc: back to the orders.`;
    return;
  }
  if (o.need === "face") {
    if (c.x === a.x && c.y === a.y) { cui.msg = `Click away from ${a.name.split(" ")[0]}, the way they should watch.`; return; }
    return void allySend(state, b, f, o, { face: [c.x, c.y] });
  }
  allySend(state, b, f, o, { x: c.x, y: c.y }); // a cell: any, fog or not (the sim says why not)
}
function allyButton(state, b, u, btn) {
  const ts = allyTargets(state, b, u), me = esc(u.name.split(" ")[0]);
  btn("allyorder", "Ally orders", `1 action: ${me} tells an ally within ${ALLY_ORDER.RANGE} tiles what to do: attack a target, move or push to a tile (the fog too: you do not see what they see), overwatch a cone, hold, follow, cover ${me}, retreat off the map, or fight as they see fit. They may not heed it: the odds show on each order.${ts.length > 1 ? " More than one in reach: click the one." : ""}`,
    ts.length > 0, "Alt+A", { why: ts.length ? "" : allyWhy(state, b, u), on: allyMode() });
}
// The card over the map: the orders for the ally picked, each with the odds they heed it; Whole group; the others in reach; Cancel.
function allyCard(state, b) {
  const f = allyNow(b);
  if (!f || !f.a || cui.mode !== "allymenu") return "";
  const { u, a, ask } = f, me = u.name.split(" ")[0];
  const ts = allyTargets(state, b, u), mates = ts.filter((t) => t.pk != null && t.pk === a.pk).length, g = groupOf(b, a);
  const cur = allyOrderOf(b, a);
  const rows = ALLY_ORDERS.map((o) => {
    const order = { kind: o.kind, ...(ask.group ? { group: true } : {}) }, p = allyOddsOf(state, b, u, a, order);
    const why = o.need ? "" : allyOrderRefusal(state, b, u, a, order) || ""; // an order that needs a pick: the sim says on the pick
    const need = o.need === "unit" ? " Then click the enemy." : o.need === "cell" ? " Then click the tile (any, the fog too)." : o.need === "face" ? " Then click the way to watch." : "";
    return `<button class="mini${cur && cur.kind === o.kind ? " active" : ""}" data-action="cb-act" data-v="allykind" data-k="${esc(o.kind)}" ${why ? "disabled " : ""}data-tip="${esc(`${o.tip}.${need}${p ? ` ${p} they heed it.` : ""}${why ? ` Not now: ${why}` : ""}`)}">${esc(o.label)}${p ? ` <b>${esc(p)}</b>` : ""}</button>`;
  }).join(" ");
  const others = ts.length > 1 ? `<div class="small muted">In reach: ${ts.map((t) => `<button class="mini${t.id === a.id ? " active" : ""}" data-action="cb-act" data-v="allypick" data-k="${t.id}" data-tip="${esc(`Orders for ${t.name}.`)}">${esc(t.name.split(" ")[0])}</button>`).join(" ")}</div>` : "";
  return `<div class="cbcard cbally"><div><b style="color:${ALLY_COLOR}">🫡 Orders for ${esc(a.name)}</b> <span class="muted small">${g ? `${esc(cap1(g.name))} · ` : ""}${esc(me)} gives it (1 action) · they may not heed it${cur ? ` · now: ${esc(allyWhat(b, cur))}` : ""}</span></div>
    <div class="cbally-orders">${rows}</div>${others}
    <div class="small"><button class="mini${ask.group ? " active" : ""}" data-action="cb-act" data-v="allygroup" data-tip="${esc(`The order goes to every one of ${g ? cap1(g.name) : `${a.name}'s group`} within ${ALLY_ORDER.RANGE} tiles of ${me} (${mates} now).`)}">${ask.group ? "✔" : "✗"} Whole group${mates > 1 ? ` (${mates})` : ""}</button> <button class="mini" data-action="cb-act" data-v="allyclose" data-tip="Close without giving an order (Esc).">Cancel</button></div></div>`;
}
// The hover line of an ally: the order your people gave them (as they know it), and the key.
function allyLine(state, b, t) {
  if (!t || !t.ally || !b.raid) return "";
  const o = allyOrderOf(b, t), by = o && o.by != null ? unitById(b, o.by) : null;
  const u = selUnit(b), can = state && u && u.side === "player" && active(u) && allyTargets(state, b, u).some((x) => x.id === t.id);
  const how = cui.mode === "allypick" && can ? " · <b>Click to give them an order.</b>" : can ? ` · Ally orders (${esc(keyLabel("battle.allyorder", 1) || "Alt+A")})` : "";
  const now = o ? `Orders: ${esc(allyWhat(b, o))}${by ? ` · given by ${esc(by.name.split(" ")[0])}` : ""} · ${o.heeded ? '<span class="good">heeded</span>' : '<span class="warn">not heeded</span>'}` : "No orders: their own call";
  return `<br><span class="small" style="color:${ALLY_COLOR}">${o && o.icon ? `${esc(o.icon)} ` : ""}${now}</span><span class="small">${how}</span>`;
}
// The hover card while picking what the order needs: the tile or the way (and the odds), or the enemy (the rest as usual).
function allyPreview(state, b, h) {
  const f = allyNow(b);
  if (!f || !f.a || !f.o || cui.mode !== "allytarget") return "";
  const { u, a, o } = f, name = esc(a.name.split(" ")[0]), extra = f.ask.group ? { group: true } : {};
  if (o.need === "unit") {
    const t = unitAt(b, h.x, h.y);
    if (!t || t.side !== "enemy" || !active(t) || !view(b).seen.has(t.id)) return "";
    const p = allyOddsOf(state, b, u, a, { kind: o.kind, target: t.id, ...extra });
    return `<b>${esc(o.label)} ${esc(t.name)}</b> <span class="muted">· ${name}</span>${p ? ` · <b class="cbbig">${esc(p)}</b> they heed it` : ""}<br><span class="small muted">Click to give the order. Esc: back to the orders.</span>`;
  }
  const order = o.need === "face" ? { kind: o.kind, face: [h.x, h.y], ...extra } : { kind: o.kind, x: h.x, y: h.y, ...extra };
  const p = h.x === a.x && h.y === a.y && o.need === "face" ? "" : allyOddsOf(state, b, u, a, order);
  return `<b>${esc(allyWhat(b, { kind: o.kind, label: o.label, x: order.x, y: order.y, face: order.face }))}</b> <span class="muted">· ${name}</span>${p ? ` · <b class="cbbig">${esc(p)}</b> they heed it` : ""}<br><span class="small muted">${o.need === "face" ? "The cone from where they stand." : "Any tile, the fog too: you do not see what they see."} Click to give the order. Esc: back to the orders.</span>`;
}
// How many of each allied group are under your orders (the strip's chips): group key → count.
function allyOrderCount(b) {
  const out = new Map();
  for (const o of allyOrdersShown(b) || []) {
    const a = o && unitById(b, o.allyId);
    if (a && a.pk != null && active(a)) out.set(a.pk, (out.get(a.pk) || 0) + 1);
  }
  return out;
}
// The map's marks (ui/isoview.js drawAllyMarks): the orders given (a flag on the tile to go to, a dashed line from an
// ally your people see, a crosshair on a target they see, the order's icon by the badge, the overwatch cone: kept per map
// change), and while picking: the allies in reach and the reach, the ally picked, the tile under the mouse.
function allyMarks(state, b, v) {
  const key = `${v.key}:${b.turn}:${b.phase}:${(b.log || []).length}`;
  if (!cui.allyShown || cui.allyShown.b !== b || cui.allyShown.key !== key) {
    const flags = [], cross = [], cones = [], icons = new Map(), f = floorNo(b);
    for (const o of allyOrdersShown(b) || []) {
      const a = o && unitById(b, o.allyId);
      if (!a || a.dead || a.left || a.fled) continue;
      const seen = active(a) && v.seen.has(a.id) && onFloor(b, a);
      const from = seen ? [a.x + (a.size || 1) / 2, a.y + (a.size || 1) / 2] : null;
      if (o.x != null && o.y != null && (!floorsOf(b) || (a.f ?? f) === f)) flags.push({ x: o.x, y: o.y, kind: o.kind, from, retreat: o.kind === "retreat" }); // set by you: shown wherever it is
      const t = o.targetId != null ? unitById(b, o.targetId) : null;
      if (t && active(t) && v.seen.has(t.id) && onFloor(b, t)) cross.push({ x: t.x, y: t.y, size: t.size || 1, from });
      if (!seen) continue;
      if (o.icon) icons.set(a.id, String(o.icon));
      if (Array.isArray(o.face) && (o.face[0] !== a.x || o.face[1] !== a.y)) cones.push({ a, face: o.face });
    }
    cui.allyShown = { b, key, flags, cross, cones, icons, intel: allyIntelShown(b, v) };
  }
  const S = cui.allyShown, out = { flags: S.flags, cross: S.cross, icons: S.icons, intel: S.intel, pick: null, ring: null, hover: null, color: ALLY_COLOR };
  const fl = allyNow(b);
  if (!fl) return out;
  const { u, a, o, ask } = fl;
  out.ring = { x: u.x, y: u.y, r: ALLY_ORDER.RANGE };
  const ts = allyTargets(state, b, u);
  out.pick = !a ? ts : ask.group ? ts.filter((t) => t.id === a.id || (t.pk != null && t.pk === a.pk)) : [a];
  const h = cui.hover;
  if (a && o && h && o.need === "cell") out.hover = { x: h.x, y: h.y, from: [a.x + 0.5, a.y + 0.5], kind: o.kind };
  if (a && o && h && o.need === "unit") { const t = unitAt(b, h.x, h.y); if (t && t.side === "enemy" && active(t) && v.seen.has(t.id)) out.hover = { x: t.x, y: t.y, size: t.size || 1, from: [a.x + 0.5, a.y + 0.5], unit: true }; }
  return out;
}
// Tell me what you see (sim/allyorders.js allyIntel): what an ally told your people is in the fog, as they told it (it
// does not move with what is there): only on cells your people do not see now, on the floor shown.
function allyIntelShown(b, v) {
  const list = typeof ALLY_SIM.allyIntel === "function" ? ALLY_SIM.allyIntel(b) || [] : [];
  const f = floorNo(b), F = floorsOf(b);
  return list.filter((m) => m && Number.isInteger(m.x) && Number.isInteger(m.y) && m.x >= 0 && m.y >= 0 && m.x < b.w && m.y < b.h && !v.vis[m.y * b.w + m.x] && (!F || (m.f ?? 0) === f));
}
// The hover text of the marks on a cell in the fog: who told it, when, what.
function allyIntelHover(b, v, x, y) {
  if (!b.raid || v.vis[y * b.w + x]) return "";
  const here = allyIntelShown(b, v).filter((m) => m.x === x && m.y === y);
  return here.map((m) => {
    const by = typeof m.by === "number" ? unitById(b, m.by) : null, who = by ? by.name : typeof m.by === "string" ? m.by : "an ally";
    return `<b style="color:${ALLY_COLOR}">?</b> Told by ${esc(who)}${m.turn != null ? ` on turn ${m.turn}` : ""}: ${esc(m.label || m.kind || "something")}. <span class="muted">Not seen by your people.</span>`;
  }).join("<br>");
}
// The overwatch cones of the allies your people see (green, dashed: theirs), and the way being picked for one.
const allyConeR = (b, a) => Math.min(sightAt(b, a), WEAPONS[a.weapon] ? (WEAPONS[a.weapon].opt || 8) + 8 : 16);
const allyWedge = (b, a, ang) => ({ round: false, near: 0, ang, wedges: [{ r: allyConeR(b, a), half: VISION.HALF }] });
function drawAllyCones(b) {
  for (const c of cui.allyShown && cui.allyShown.b === b ? cui.allyShown.cones : []) drawCone(b, c.a.x, c.a.y, allyWedge(b, c.a, Math.atan2(c.face[1] - c.a.y, c.face[0] - c.a.x)), "rgba(79,224,138,0.07)", "rgba(79,224,138,0.7)", true);
  const f = allyNow(b), h = cui.hover;
  if (f && f.a && f.o && f.o.need === "face" && h && (h.x !== f.a.x || h.y !== f.a.y)) drawCone(b, f.a.x, f.a.y, allyWedge(b, f.a, Math.atan2(h.y - f.a.y, h.x - f.a.x)), "rgba(79,224,138,0.16)", "rgba(130,240,170,0.95)");
}

function raidButtons(state, b, u, btn) {
  const near = searchableNear(b, u);
  const z = zoneAt(b, u.x, u.y);
  const zone = z >= 0 ? b.raid.zones[z] : null;
  // sim/search.js: the full search (1 action, everything shows) and the quick rummage (no action, part of it, loud).
  const sb = near.find((c) => !c.contents || c.quick) || near[0];
  const searchTip = sb ? `Search ${sb.label.toLowerCase()} (${!sb.contents || sb.quick ? `${SEARCH.ap} action` : "already searched: free"}${sb.quick ? ": it was only rummaged through, a full search turns up the rest" : ""}). Everything inside shows, quietly; pick what to take. ${sb.kind === "body" || !b.raid.areas[sb.area] ? "" : areaHint(b.raid.areas[sb.area].type)}` : "Stand next to an unsearched container (yellow box marker) to search it.";
  const qb = quickable(near)[0];
  const Q = SEARCH.quick;
  const qWhy = quickRefusal(b, u, qb || near[0]);
  const quickTip = `Rummage in a hurry: no action (needs one left; once a turn), so it fits between two moves. Only ${Math.round(Q.reveal[0] * 100)}–${Math.round(Q.reveal[1] * 100)}% of what is inside turns up; a full search there later finds the rest. Loud: Heat +${Q.heat}, and the unaware dead and guards within ${quickRadius(b, u)} tiles come to look${b.raid.interior ? " (walls and closed doors muffle it)" : ""}${quickRadius(b, u) > Q.radius ? "; fumbling in the dark without a light carries further" : ""}. Hands going fast: ${quickHurtPct(state, b, u)} chance of cutting yourself (broken glass, a rusty can, a needle): a few health and a cut that needs dressing. Less with Scavenging or Stealth, more in the dark without a light.${qWhy ? ` ${qWhy}` : ""}`;
  const byCar = vehicleExit(b, u);
  const exTip = byCar ? "Leave the raid in your vehicle from right beside it (any cell around it). Everyone who extracts at the vehicle keeps it." : zone ? (zone.vehicle ? "Leave the raid in your vehicle. Everyone who extracts here keeps it." : (b.raid.hasVehicle ?? b.raid.vehicleZone >= 0) ? "Leave the raid on foot from here. If nobody extracts at the vehicle, it is left behind." : "Leave the raid from this zone.") :
    "Move into a green extraction zone first. Anyone still on the map when the last person leaves is lost.";
  const veh = b.raid.hasVehicle ?? b.raid.vehicleZone >= 0;
  const vehTip = atVehicle(b, u) ? "Free: open the vehicle. Drag what you carry into it to free your hands, or take things out." : "Walk to the vehicle (its zone, or next to it) to load or unload it.";
  const searchWhy = !sb ? "Stand next to an unsearched container (yellow box marker) to search it." : !facesBox(u, sb) ? faceRefusal(sb.label ? `the ${sb.label.toLowerCase()}` : "it") : u.ap > 0 ? "" : NO_AP; // the sim's own (sim/combat.js "search")
  let html = `${btn("search", "Search", searchTip, !searchWhy, "⇧S", { why: searchWhy, ap: sb && sb.contents && !sb.quick ? 0 : SEARCH.ap })}${btn("quick", "Quick search", quickTip, !qWhy, "⇧Q", { why: qWhy })}${veh ? btn("vehicle", "Vehicle", vehTip, atVehicle(b, u), "N") : ""}${btn("extract", byCar || (zone && zone.vehicle) ? "Extract (vehicle)" : "Extract", exTip, u.ap > 0 && (!!zone || byCar), "X")}`;
  // A building's doors and windows (sim/buildingmaps.js): peek, close, brace; climb through a window next to you.
  if (b.raid.interior) {
    const first = u.name.split(" ")[0];
    html += doorButtons(b, u, btn);
    html += windowButtons(b, u, btn);
    const wins = windowsNear(b, u), quiet = wins.length && windowOpen(b.cells[wins[0].y * W + wins[0].x]);
    html += btn("climb", "Climb window", wins.length ? (quiet ? `${BMAP.CLIMB.ap} action, quiet: ${first} climbs through the ${b.cells[wins[0].y * W + wins[0].x].k === "smashed" ? "broken" : "open"} window next to them to the other side.` : `${BMAP.CLIMB.ap} action: smash the window next to ${first} and climb through to the other side. Loud: Heat +${BMAP.CLIMB.heat}, and it wakes everything within ${BMAP.CLIMB.radius} tiles; the window stays broken after. Open it first (Open window, if it is unlocked) for a quiet climb.`) : "Stand right next to a window (not diagonally) with room on the far side to climb through it (quiet through an open or broken one, loud through a closed one).", u.ap >= BMAP.CLIMB.ap && wins.length > 0, "L");
  } else { html += doorButtons(b, u, btn, true); html += windowButtons(b, u, btn); } // the street map's houses (sim/combat.js genRaidMap): with a door or a window next to them
  // A light switch in reach (sim/indoorlight.js): the room's lights on or off.
  const sws = switchOptions(b, u);
  if (sws.length) {
    const a = sws[0];
    html += btn("lights", a.on ? "Lights off" : "Lights on", `${INDOOR.AP} action, quiet: switch the lights ${a.on ? "off" : "on"} in the ${a.name.toLowerCase()}. ${a.on ? `Dark again${!b.night && !a.dark ? " (by day the windows still light it)" : ""}: it is seen only as at night, down the cone or a light's beam.` : `Lit, it is seen as by day by everyone, yours and theirs: whoever stands in it can be noticed, and a guard in it sees all round.`}`, u.ap >= INDOOR.AP, "⌥K");
  }
  return html;
}
// Peek, Close door, Brace door (sim/buildingmaps.js doorAct): always on a building's map; elsewhere (the street map, a
// field map's houses: sim/combat.js genMap) only while a door or doorway is next to the unit.
function doorButtons(b, u, btn, onlyNear = false) {
  const first = u.name.split(" ")[0];
  const peeks = peekOptions(b, u), closes = closeOptions(b, u), braces = braceOptions(b, u);
  if (onlyNear && !peeks.length && !closes.length && !braces.length) return "";
  const P = BMAP.PEEK;
  return btn("peek", "Peek", peeks.length ? (u.peekTurn === b.turn ? `${first} has already peeked this turn.` : `Free, once a turn: ${first} looks through the door or doorway next to them and sees the room beyond (out to ${P.range} tiles, until the end of the turn) without stepping in. An unaware guard facing the door may catch it (${Math.round(P.notice * 100)}% − ${Math.round(P.perStealth * 100)}% a Stealth point), the dead right behind it ${Math.round(P.deadNotice * 100)}%.`) : "Stand right next to a door or doorway (not diagonally) to peek through it.", peeks.length > 0 && u.peekTurn !== b.turn, "K")
    + btn("close", "Close door", closes.length ? `1 action: shut the open door next to ${first} (quiet${b.raid ? `; a roller door is loud: Heat +${BMAP.ROLLER.heat}` : ""}). A shut door blocks sight; the dead must batter it down (${BMAP.DOOR.inner} hit points an inner door, a turn or more each blow), people stop to open it.` : "Stand next to an open door (not diagonally) with nobody in the doorway to shut it.", u.ap > 0 && closes.length > 0, "Q")
    + btn("brace", "Brace door", braces.length ? `The rest of the turn: ${first} puts a shoulder to the closed door next to them. People cannot open it (they must break it) and it takes half of each blow, until ${first} moves.` : "Stand next to a closed door (not diagonally) to brace it.", u.ap > 0 && braces.length > 0, "Y");
}

// Lock and Unlock (sim/basemap.js keyOptions, keyAct): on their own base's map the defenders hold the keys to its
// buildings' doors, the gate and the armory's gun cage and ammo lockers; shown while one is next to the unit (a door or
// the gate not diagonally), from inside or out.
function keyButtons(b, u, btn) {
  const opts = keyOptions(b, u);
  if (!opts.length) return "";
  const first = u.name.split(" ")[0];
  const names = (list) => list.map((o) => `the ${o.name}`).filter((n, i, a) => a.indexOf(n) === i).join(", ");
  const toLock = opts.filter((o) => !o.locked), toOpen = opts.filter((o) => o.locked);
  const why = u.ap >= KEY_AP ? "" : NO_AP;
  if (toOpen.length) btn("keyunlock", "Unlock", `${KEY_AP} action, quiet: ${first} unlocks ${names(toOpen)} with the base's key.${toOpen.some((o) => o.what === "door") ? " An unlocked door is an ordinary one: anyone opens it by walking in, raiders too (the dead still batter it), and it stays open behind whoever went through until it is shut." : ""}${toOpen.some((o) => o.what === "gate") ? " The gate unbarred stands open to everyone, the dead too." : ""}${toOpen.some((o) => o.what === "box") ? " An unlocked container is taken from without battering." : ""}${toOpen.length > 1 ? " Several: click the one." : ""}`, !why, "", { ap: KEY_AP, why });
  if (toLock.length) btn("keylock", "Lock", `${KEY_AP} action, quiet: ${first} ${toLock.some((o) => o.what === "door") ? "shuts and " : ""}locks ${names(toLock)} again, with nobody in the doorway or gateway. Locked, raiders have to batter it open; your own people still go through a locked door.${toLock.length > 1 ? " Several: click the one." : ""}`, !why, "", { ap: KEY_AP, why });
  return "";
}
// What the hover says of a base's own lock (sim/basemap.js keyAct): locked or not, and how to change it.
function keyNote(c) {
  if (!c || !c.keyed || !(c.hp > 0)) return "";
  if (c.k === "gate") return c.bar ? " Barred: your people unbar it with Unlock (1 action, next to it)." : ' <span class="warn">Unbarred: open to everyone, the dead too.</span> Lock (1 action, next to it, nobody in the gateway) bars it again.';
  if (c.k === "bdoor") return " Locked: your people hold the key (Unlock, 1 action, from either side).";
  if (c.k === "idoor" || c.k === "odoor") return ' <span class="warn">Unlocked: anyone opens it, raiders too.</span> Lock (1 action, from either side, nobody in the doorway) shuts and locks it.';
  return "";
}
// Check, open, close or break the window next to the unit (sim/windows.js windowAct): shown while one is right next to
// them (not diagonally), in any building (a raid's, the street's houses, a field map's). Trying a window that has not
// been checked opens it or says why not (locked from the inside, fixed) for free, as a check does.
function windowButtons(b, u, btn) {
  const wins = windowsBy(b, u);
  if (!wins.length) return "";
  const first = u.name.split(" ")[0];
  const w = wins[0], s = windowState(w.c), word = windowWord(w.c);
  const many = wins.length > 1 ? " Several windows next to them: click the one." : "";
  const checked = s.broken || s.open || s.known;
  btn("checkwindow", "Check window", checked ? `The window is ${word}.` : `Free: ${first} tries the window next to them: unlocked (it opens from either side), locked (it opens from the inside only) or fixed (it never opens: only breaks).${many}`, !checked, "", { ap: 0, why: checked ? `Checked already: ${word}.` : "" });
  if (s.open) btn("closewindow", "Close window", `${WINDOW.OPEN_AP} action, quiet: slide the ${s.broken ? "broken " : ""}window shut.${many}`, !s.broken && u.ap >= WINDOW.OPEN_AP, "", { ap: WINDOW.OPEN_AP, why: s.broken ? "The window is broken: it cannot be closed." : NO_AP });
  else {
    const why = s.known ? openRefusal(b, u, w.c, w.inside) : "";
    btn("openwindow", "Open window", why || `${WINDOW.OPEN_AP} action, quiet: slide the window open${s.known ? "" : " if it is unlocked (or locked and " + first + " is inside; a window that will not open says why, for free)"}. Open, it is climbed or vaulted through quietly, and a throw passes it.${many}`, !why && u.ap >= WINDOW.OPEN_AP, "", { ap: WINDOW.OPEN_AP, why: why || NO_AP });
  }
  if (!s.broken) btn("breakwindow", "Break window", `${WINDOW.BREAK.ap} action: smash the glass. Loud: ${b.raid ? `Heat +${WINDOW.BREAK.heat}, ` : ""}the unaware within ${WINDOW.BREAK.radius} tiles wake. The sill stays half cover; the window is vaulted or climbed through after. (A move vaulting through a closed window breaks it the same way, and the glass cuts: ${WINDOW.HURT[0]}–${WINDOW.HURT[1]}.)${many}`, u.ap >= WINDOW.BREAK.ap, "", { ap: WINDOW.BREAK.ap, why: NO_AP });
  return "";
}

// A site with several buildings (sim/buildingmaps.js): pick the one to explore before anyone acts, or the street.
// The kit check before the first move (sim/kitcheck.js, 2026-10-18 user requests): who goes in with an empty gun (a
// button opens their Inventory to reload it first: cb-inv), no healing on the team, who is hurt. Proceed puts it aside
// for this fight (b.kitWarnSeen); it goes by itself once nothing is left to say.
function kitWarnHtml(state, b) {
  const w = kitWarnings(state, b);
  if (!w.any) return "";
  const li = [];
  for (const e of w.empty) li.push(`<li>${esc(e.text)} <button class="mini" data-action="cb-inv" data-id="${e.uid}" data-tip="${esc(`Open ${e.name}'s Inventory: right-click the gun for Reload, or drop rounds onto a spare magazine. Each move or reload costs their actions this turn.`)}">Open ${esc(e.name.split(" ")[0])}'s inventory</button></li>`);
  if (w.heal) li.push(`<li>${esc(w.heal)}</li>`);
  for (const h of w.hurt) li.push(`<li>${esc(h.text)}</li>`);
  return `<div class="small cbmsg cbconfirm cbkitwarn"><b class="warn">Before you go in</b><ul>${li.join("")}</ul>
    <div style="margin-top:0.35rem"><button class="primary" data-action="cb-act" data-v="kitok" data-tip="Go in as you are: this card is put aside for the fight.">Proceed</button></div></div>`;
}
function chooseHtml(b) {
  const list = b.raid.choose || [];
  return `<div class="small cbmsg cbconfirm"><b class="good">Where do you go in?</b> Several buildings stand at ${esc(b.place)}. Each has its own map: rooms, doors, windows and its own ways out. Or search the street (this map). The choice is gone once anyone acts.
    <div class="cbactions" style="margin-top:0.35rem">${list.map((o) => `<button data-action="cb-act" data-v="building" data-k="${esc(o.id)}" data-tip="${esc(`${o.name}${o.size ? ` (${o.size}, ${o.rooms} rooms)` : ""}. ${o.hint}${o.map ? ` The map: ${o.map.replace(/\+$/, "")} tiles${/\+$/.test(o.map) ? " at least (the floor plan and the grounds round it)" : ""}.` : ""}`)}">${esc(o.name)}${o.size || o.map ? ` <span class="muted">${esc([o.size, o.map].filter(Boolean).join(", "))}</span>` : ""}</button>`).join("")}</div></div>`;
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
// Stabilize yourself (the downed one's order in the bottom bar): its label and tip.
function selfStabLabel(u) {
  const k = selfKit(u);
  return k ? `${k.key === "tourniquet" ? "Tourniquet" : esc(k.name)}: stabilize yourself (${selfOdds(u, k.key)}%)` : "Stabilize yourself";
}
function selfStabTip(why) {
  const R = MEDIC.SELF;
  return `The one thing someone down can do, once a turn: stop their own bleeding with a tourniquet (${R.tourniquet.BASE}% + ${R.tourniquet.MED} a point of Medicine, at most ${R.tourniquet.MAX}%) or a field trauma kit (${R.traumakit.BASE}% + ${R.traumakit.MED}, at most ${R.traumakit.MAX}%) in the off hand, a pocket or a rig pouch (not the pack: out of reach lying down). Stopped: stabilized, still down (a medic gets them up), the item's use spent. Failed: nothing spent, try again next turn. Not tried by the end of the turn: they try by themselves.${why ? ` ${why}` : ""}`;
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

// The team's supplies in the cart a unit pushes (sim/carry.js cartSupOf), kg.
const cartSupKg = (state, b, u) => { const p = b.setup && b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) : null; const m = p ? cartSupOf(state, p) : null; return (m && m[u.sid]) || 0; };
function bodyButtons(state, b, u, btn) {
  let html = "";
  // sim/carry.js: the team's supplies carried in the arms (no weapon until set down), and loads set down nearby.
  // sim/carts.js: a wheelbarrow or a hand cart: let go (free), take it back (1 action), load it from the bodies and piles round it.
  if (holdsCart(u)) html += btn("parkCart", "Park cart", `1 action: put the ${u.bag.name.toLowerCase()} on one of the cells beside ${u.name.split(" ")[0]} (left, right, in front or behind; highlighted): it stands on that cell as half cover (nobody stands on it: people shove it, both actions, or go round; the dead crawl over it, a walker's whole turn; a brute smashes it in one blow, a vehicle drives through it). Plug a doorway with it. What is in it stays in it: Load cart or Take cart to get at it.${parkCells(b, u).length ? "" : " No free cell beside them."}`, parkCells(b, u).length > 0 && u.ap >= 1);
  if (u.cartHelp != null && !holdsCart(u)) html += btn("letGoCart", "Let go", `Free: ${u.name.split(" ")[0]} stops helping pull the cart: hands free (the pusher goes a tile slower a move again).`, true);
  if (holdsCart(u)) html += btn("letGoCart", "Let go", `Free: ${u.name.split(" ")[0]} lets go of the ${u.bag.name.toLowerCase()} (${Math.round((itemLoad(u.bag) + cartSupKg(state, b, u)) * 10) / 10} kg with what is in it): the emergency drop: it stands on the free cell beside them nearest the enemy (left, right, in front or behind; under their feet if none is free) with everything in it, and ${u.name.split(" ")[0]} can shoot and fight again. Anyone next to it can load or unload it; Take cart (1 action) to push it on. Won, it comes back after the fight; on an evac or a retreat only a cart someone is pushing leaves with them.`, true);
  { const c = cartsNear(b, u)[0]; if (c) { const why = takeRefusal(state, b, u, c); html += btn("takeCart", "Take cart", `1 action, next to it: ${u.name.split(" ")[0]} takes the ${c.cart.name.toLowerCase()} (${Math.round((itemLoad(c.cart) + boxKg(c)) * 10) / 10} kg with what is in it) and pushes it: hands full (no weapon) until it is let go, a tile less a move. It leaves with its pusher on an evac.${why ? ` ${why}` : ""}`, !why); html += btn("loadCart", "Load cart", `Free to open: load or unload the ${c.cart.name.toLowerCase()} next to ${u.name.split(" ")[0]} (${Math.round(boxKg(c) * 10) / 10} of ${cartSpec(c.cart).cap} kg). Drag things from bodies, piles or ${u.name.split(" ")[0]} into it: taking things off a body or the ground is hauling time as usual.`, true); } }
  const first = u.name.split(" ")[0];
  if (handsBusy(u) && !holdsCart(u)) html += btn("dropCarried", "Drop carried", `Free: ${first} sets down ${armsText(u)} (${Math.round(handsKg(u) * 10) / 10} kg) on this cell, and can shoot, reload, open doors and fight again. Won, the team picks its own loads up after the fight${u.haul ? "; finds set down are picked up again from the ground (Ground)" : ""}; retreating, it stays on the ground of this tile.`, true);
  if (handsBusy(u) && b.units.filter((x) => x.side === "player" && handsBusy(x)).length > 1) html += btn("dropAllCarried", "All drop carried", "Free: everyone of yours sets down what they carry in their hands.", true);
  // Set over cover (sim/carry.js setOverCover): the load onto the far side of the half cover they face (1 action).
  if (handsBusy(u) && !holdsCart(u) && u.cartHelp == null) {
    const vs = vaultsNear(b, u);
    const fx = u.face ? Math.round(u.face[0]) : 0, fy = u.face ? Math.round(u.face[1]) : 0;
    const faced = vs.find((v) => v.x - u.x === fx && v.y - u.y === fy) || (vs.length === 1 ? vs[0] : null);
    html += btn("setOver", "Set over cover", vs.length ? `1 action: ${first} sets ${armsText(u)} down on the far side of the ${(faced || vs[0]).name.toLowerCase()}${faced ? "" : " they face (Face is free: turn to the cover first)"}, where anyone can pick it up later from the ground (Ground, Pick up load). Then vault over after it with free hands (+${SIM.VAULT.COST} tiles) instead of +${2 + 2 * SIM.VAULT.COST} with the load.` : "Stand right next to half cover (a fence, sandbags, crates, a counter...) with room on the far side to set the load down beyond it.", u.ap > 0 && !!faced, "", { why: u.ap > 0 ? (vs.length ? "Face the half cover to set it over (Face is free)." : "No half cover with room beyond it next to them.") : NO_AP, ap: 1 });
  }
  if (carriedNear(b, u).length) { const whyTake = handsTakeRefusal(u, "the load"); html += btn("pickCarried", "Pick up load", `1 action: take ${[recText(carriedNear(b, u).reduce((a, c) => { for (const [k, q] of Object.entries(c.sup || {})) a[k] = (a[k] || 0) + q; return a; }, {})), ...carriedNear(b, u).filter((c) => c.item).map((c) => `the ${c.item.name}`)].filter(Boolean).join(", ")} back in the arms (hands full again: no weapon, no doors; one bag at a time).${whyTake ? ` ${whyTake}` : ""}`, u.ap > 0 && u.carrying == null && u.dragging == null && !whyTake, "", { why: whyTake || (u.ap > 0 ? "" : NO_AP) }); }
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
  if (!kinds.length) html += btn("throw", "Throw", "Bottles, noise makers and firecrackers pull unaware guards and the dead to where they land. Nobody here carries one (search kitchens and houses, or craft them).", false, "G", { why: "Nothing to throw: bottles, noise makers and firecrackers come from searching and crafting." });
  for (const k of kinds) {
    const T = THROWABLES[k];
    const what = T.fx || T.decoy ? GEAR[k].desc : T.self ? `1 action: blow ${T.label} where ${u.name.split(" ")[0]} stands. Unaware guards and the dead within ${T.radius} tiles come to look. Not used up.`
      : `1 action: throw ${T.label} up to ${T.range} tiles. Unaware guards and the dead within ${T.radius} tiles go to look (3 turns)${T.turns > 1 ? `; it keeps ringing for ${T.turns} turns` : ""}${T.heat ? `; Heat +${T.heat} in a raid` : ""}.${b.raid ? " The dead that find raiders where it landed fall on them: land one next to their group while nobody of theirs has seen you, and let them fight it out." : ""}`;
    const label = k === "emptymag" ? "empty magazine" : GEAR[k].name.toLowerCase();
    const text = k === "emptymag" ? `1 action: throw an empty spare magazine up to ${T.range} tiles: it clatters where it lands, and unaware guards and the dead within ${T.radius} tiles go to look. The magazine lies there; after a won fight it is picked up again.` : what;
    html += btn("throw", `${T.self ? "Blow" : "Throw"} ${esc(label)}${T.keep ? "" : ` (${have[k]})`}`, `${text} ${T.keep ? "" : `${have[k]} left.`}`, ap > 0, k === kinds[0] ? "G" : "", { k, on: cui.mode === "throw" && cui.throwKey === k, why: ap > 0 ? "" : NO_AP });
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
  if (dt.length) html += btn("drop", `Drop rock on ${esc(dt[0].name)}`, `Drop a rock from the wall on ${dt[0].name} below (${DROP.CHANCE}%: ${DROP.DMG[0]}–${DROP.DMG[1]}; on a ram's crew one more of them is hit). Ends the turn.`, ap > 0, "", { id: dt[0].id });
  return html;
}

// ---------- the deploy step (sim/deploy.js) ----------
function deployPanel(state, b, u) {
  const D = b.deploy || {};
  if (D.interior) return interiorDeployPanel(state, b, u, D);
  if (D.attackers) { // the fort map (sim/fort.js): staging an assault on their walls
    let html = `<h3>Stage the assault</h3>
      <div class="small muted">${say({ key: "Click", touch: "Tap", pad: `${kh("A")} on` })} one of your people, then a green cell: anywhere in the open ground round their walls, on any side. The gates are in the middle of each wall (barred: the ram, or batter them); ladders go up the wall sections; grenades over it. Your vehicle can be driven up to the wall and rammed through light obstacles.</div>
      <div class="cbactions" style="margin-top:0.4rem"><button data-action="cb-deploy" data-v="defaults" data-tip="Back to where they started: the west side.">Default positions</button></div>`;
    html += `<div id="cbprev" class="cbprev">${previewHtml(b)}</div>`;
    if (cui.msg) html += `<div class="small warn cbmsg">${padHtml(esc(devText(cui.msg, "battle")))}</div>`;
    html += `<h3>Log</h3><div class="cblog" id="cblog">${b.log.slice(-20).map((l) => `<div class="k-${l.k}"><span class="t">T${l.turn}</span>${esc(l.text)}</div>`).join("")}</div>`;
    html += `<div class="cbfoot"><button class="primary" data-action="cb-deploy" data-v="start" data-tip="Everyone is in place: the assault begins. (Enter)">Start the assault</button>
      ${!b.acted && b.turn === 1 ? `<button data-action="cb-auto" data-tip="Skip the tactical battle and resolve it instantly by the numbers.">Auto-resolve</button>` : ""}</div>`;
    return html;
  }
  const holders = players(b).filter((p) => p.post === "gate").map((p) => p.name);
  const towers = players(b).filter((p) => p.post === "tower").map((p) => p.name);
  let html = `<h3>${b.drill ? `Drill · ${D.fort ? "the plan holds from any side" : "facing an attack from the east (it turns with the attack)"}` : `Deploy · the attack comes from the ${esc(D.side || "east")}`}</h3>
    <div class="small muted">${say({ key: "Click", touch: "Tap", pad: `${kh("A")} on` })} a defender, then a green cell to place them: on a wall stand or the walkway behind the wall (▲ height 1: shoot down over the wall, +5 aim, half cover; up the ladders), on a tower (▲▲ height 2: full cover, +10 aim, the widest view), in the gate or a breach (orange: whoever stands there holds it and blocks the way), or anywhere inside. The attackers batter the wall and the gate (hit points) and come through the openings.</div>
    ${startLine(state, b)}<div class="small" style="margin-top:0.3rem">${D.walled ? `Holding the gate: <b>${holders.length ? esc(holders.join(", ")) : "nobody"}</b>${towers.length ? ` · On the towers: <b>${esc(towers.join(", "))}</b>` : ""}` : "No walls built here: defenders stand in the yard behind the barricades."}</div>
    <div class="cbactions" style="margin-top:0.4rem">
      <button data-action="cb-deploy" data-v="gate" ${u && D.walled ? "" : "disabled"} data-tip="${esc(u ? `Put ${u.name} in the gate (or a breach) to hold it.` : "Pick a defender first.")}">Hold the gate${u ? `: ${esc(u.name.split(" ")[0])}` : ""}</button>
      <button data-action="cb-deploy" data-v="defaults" data-tip="Back to the default posts: the toughest fighters in the gate (with 7+ defenders), the best shots on the towers, the rest in a line well back from the openings.">Default positions</button>
    </div>${planRow(state, b)}`;
  if (!D.floodlit && D.spots && D.spots.length) html += `<div class="small" style="margin-top:0.4rem" data-tip="The mounted spotlights stand where they were set on the base map (on a wall stand they reach further) and light the ground round them while they have power: shots at anything in the light get +${b.floodAim}, and your people see what stands in it.">🔦 ${D.spots.length} spotlight${D.spots.length === 1 ? "" : "s"} lit where they stand (+${b.floodAim} to hit in the light).</div>`;
  if (D.floodlit && D.fixedLit) html += `<div class="small" style="margin-top:0.4rem" data-tip="The floodlights stand where they were placed on the base map and light the ground round them: shots at anything in the light get +${b.floodAim}${D.night ? ", and at night your people see what stands in it" : ""}.">Floodlights lit where they stand (+${b.floodAim} to hit in the light).</div>`;
  else if (D.floodlit) {
    html += `<div class="small" style="margin-top:0.4rem" data-tip="The floodlights light a third of the approach: shots at anything in the light get +${b.floodAim}${D.night ? " (night)" : " (day)"}.">Floodlights (+${b.floodAim} to hit in the light):</div><div class="cbactions">
      ${Object.entries(LIT_ZONES).map(([z, name]) => `<button class="${D.lit === z ? "active" : ""}" data-action="cb-deploy" data-v="flood" data-z="${z}" data-tip="Aim the floodlights ${name.toLowerCase()} (as the defenders see it).">${name}</button>`).join("")}</div>`;
  }
  html += `<div id="cbprev" class="cbprev">${previewHtml(b, state)}</div>`;
  if (cui.msg) html += `<div class="small warn cbmsg">${padHtml(esc(devText(cui.msg, "battle")))}</div>`;
  html += storesHtml(b, cui); // the stores on the base map (sim/basemap.js)
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
  if (cui.msg) html += `<div class="small warn cbmsg">${padHtml(esc(devText(cui.msg, "battle")))}</div>`;
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

function raidResult(state, b) { return `${raidResultCard(state, b)}<h3>Log</h3><div class="cblog" id="cblog">${logLines(b, 40)}</div>`; }
function raidResultCard(state, b) {
  const r = b.result;
  const R = r.raid;
  const names = (ids) => ids.map((id) => esc((state.survivors.find((s) => s.id === id) || { name: "?" }).name)).join(", ");
  const loot = [...Object.entries(r.loot.supplies).map(([k, n]) => `${n} ${keyWord(k)}`), ...r.loot.gear.map((g) => g.name)];
  return `<div class="cbresult ${r.outcome === "extracted" ? "victory" : "defeat"}">
    <h2>${r.raid && r.raid.calledOff ? "Called off" : r.outcome === "extracted" ? "Got out" : "Nobody made it out"}</h2>
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
  </div>`;
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
  if (cui.mode === "shoveFoe") { // sim/shoving.js
    const why = pushRefusal(b, u, t);
    if (why) return { ok: false, label: why };
    const o = pushOdds(b, u, t);
    const hz = pushHazard(b, u, t);
    return { ok: true, chance: o.chance, label: `Shove ${o.chance}%: pushed back a tile, or flat on their back (${Math.round(o.knock * 100)}%, sure with no room behind them)${hz ? `. Behind them: ${hz}` : ""}` };
  }
  if (cui.mode === "subdue") {
    if (!canSubdue(u, t, b)) return { ok: false, label: t.kind === "zombie" ? "The dead cannot be subdued" : "Subdue needs them right next to you" };
    const o = subdueOdds(b, u, t);
    return { ...o, ok: true, label: o.label };
  }
  if ((cui.mode === "melee" || !canFire(b, u)) && meleeReach(b, u, t)) {
    const o = meleeOdds(b, u, t);
    return { ...o, ok: true, kind: "melee", label: `Melee ${o.chance}% to hit, ${o.dmg[0]}–${o.dmg[1]} damage, ${o.crit}% crit (×${CRIT_MULT})` };
  }
  if (!canFire(b, u)) return { ok: false, label: isRanged(u) ? (magEmpty(b, u) && !reloadRefusal(b, u) ? "Empty: reload first (I)" : outOf(u)) : "No gun: move next to them and use Melee" };
  if (!canSee(b, u, t)) return { ok: false, label: "No line of sight" };
  const o = shotOdds(b, u, t);
  const cover = o.cover === 2 ? "in full cover" : o.cover === 1 ? "in half cover" : o.flanked ? "FLANKED" : t.kind === "zombie" || !t.aware || t.surprised ? "caught in the open" : "exposed";
  // sim/combat.js shotOdds notes: a bipod rested on cover, firing from a vehicle that moved, a light round's drop at range,
  // handloads, a helmet's visor, a headset's callout, dazed by a bang.
  const notes = o.notes && o.notes.length ? `; ${o.notes.join(", ")}` : "";
  return { ...o, ok: true, kind: "shot", label: `${o.chance}% to hit, ${o.dmg[0]}–${o.dmg[1]} damage, ${o.crit}% crit (×${CRIT_MULT}), ${cover}${t.hunker ? ", hunkered" : ""}${notes}` };
}


// What a move to (x, y) costs, for the hover card and a finger's confirm chip (combatTap): "Move: 1 action, …." ("" out
// of reach). Half cover vaulted on the way there (sim/combat.js VAULT): "Vault" in the title, the cost and the scuff.
function moveWord(b, u, v, x, y) {
  const d = v.reach ? v.reach.dist[y * W + x] : Infinity;
  if (!(isFinite(d) && d > 0)) return "";
  const vaults = pathTo(v.reach, x, y).filter(([px, py]) => !CELL[b.cells[py * W + px].k].walk && SIM.vaultable(b, b.cells[py * W + px])).length;
  return `${vaults ? "Vault and " : ""}${d <= SIM.moveMob(u) ? `${vaults ? "move" : "Move"}: 1 action${u.sneaking ? ", silent (sneaking)" : vaults ? ", a scuff heard nearby" : ", a small chance of a scuff heard nearby"}` : `${vaults ? "dash" : "Dash"}: 2 actions${u.sneaking ? ", silent (sneaking)" : `, loud: heard ${VISION.DASH_NOISE} tiles off`}`}${vaults ? ` (over half cover: +${SIM.VAULT.COST * vaults} tiles, and ${SIM.VAULT.COST * vaults} less of movement for the rest of the turn)` : ""}.`;
}

// The hover details in the words of the device in use (ui/hints.js: "Click or press Shift+S to search" → a finger's
// tap, a controller's Ⓐ); the very same HTML with the mouse.
function previewHtml(b, state = null) {
  return padHtml(devText(previewText(b, state), "battle"));
}
function previewText(b, state = null) {
  const h = cui.hover;
  const u = selUnit(b);
  if (!h) return `<span class="muted">${say({ key: "Hover a tile or enemy for details.", touch: "Tap a tile or enemy for details.", pad: "Move the cursor onto a tile or enemy for details." })}</span>`;
  if (b.layout && state) return layoutHover(state, b, h, ghostAt(state, b, h.x, h.y)); // the base map (ui/basemap.js)
  if (b.stores && !unitAt(b, h.x, h.y)) { const sc = storeAt(b, h.x, h.y); if (sc && (b.phase === "deploy" || !CDEF(b.cells[h.y * W + h.x]).walk)) return storeHover(sc); } // a store on the base map
  if (u && (cui.mode === "suppress" || cui.mode === "throwspear" || cui.mode === "launch")) return aimPreview(b, u, h); // the weapons overhaul's targeting
  const ap = allyMode() ? allyPreview(state, b, h) : ""; // Ally orders: the tile, the way or the enemy picked, the odds they heed it
  if (ap) return ap;
  const ih = allyIntelHover(b, view(b), h.x, h.y); // Tell me what you see: what an ally told your people is there
  if (ih) return ih;
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
    const zt = t.ztype && ZTYPES[t.ztype] ? `<br><span class="small">${ZTYPES[t.ztype].answers ? `<b>Bred against ${esc(ZTYPES[t.ztype].answers)}.</b> ` : ""}${esc(ZTYPES[t.ztype].special)}${t.ztype === "spitter" && t.cd > 0 ? " Spits again next turn." : ""}${t.windup != null ? ` Winding up to throw at ${esc((b.units.find((o) => o.id === t.windup) || {}).name || "someone")}.` : t.ztype === "flinger" && t.cd > 0 ? " Throws again soon." : ""}${t.ztype === "nightmare" && t.screamCd > 0 ? ` Screams again in ${t.screamCd} turn${t.screamCd > 1 ? "s" : ""}.` : ""}${ar}${bp} <span class="good">Counter: ${esc(ZTYPES[t.ztype].counter)}</span></span>` : "";
    // One of the risen (sim/carriers.js): who it was, and the armour it still wears.
    const turned = t.turned ? `<br><span class="small danger">${esc(t.turned.name)}, got up as one of the dead${t.armor < 0.99 ? `, still in their armour (a hit does ${Math.round(t.armor * 100)}%)` : ""}. Put down, what they had on is on the body.</span>` : "";
    return `<b>${esc(t.name)}</b> <span class="muted">${gunText(b, t)} · ${Math.round(t.hp)}/${t.maxHp} hp</span>${stealthy}${sense}${kit}${zt}${turned}${groupLine(state, b, t)}<br>${o ? (o.ok ? `<span class="${hitTone(o.chance)}"><b class="cbbig">${o.chance}%</b> ${esc(o.label)}</span>${breakdownHtml(hitBreakdown(b, u, t, o))}` : `<span class="muted">${esc(o.label)}</span>`) : ""}`;
  }
  // The third side (sim/thirdside.js): survivors keeping to themselves, soldiers fighting the dead.
  if (t && t.side === "third" && v.seen.has(t.id)) return `<b>${esc(t.name)}</b> <span class="muted">${esc(t.weaponName)} · ${Math.round(t.hp)}/${t.maxHp} hp</span><br><span class="small">${thirdWord(b, t)} Click twice to attack.</span>${groupLine(state, b, t)}${allyLine(state, b, t)}`;
  // The knocked out (sim/stealth.js).
  if (t && t.side === "enemy" && t.ko && v.vis[h.y * W + h.x]) return `<b>${esc(t.name)}</b> · ${t.tied ? "tied up: your prisoner if you win" : `out cold, wakes in about ${Math.max(1, t.wake - b.turn)} turn${t.wake - b.turn === 1 ? "" : "s"}: Tie up (T) from next to them`}. <span class="muted">Drag (Shift+D) moves them out of sight.</span>`;
  if (t && t.side === "player" && t.vol != null) return `<b style="color:${VOL_COLOR}">${esc(t.name)}</b> <span class="muted">${Math.round(t.hp)}/${t.maxHp} hp · ${gunText(b, t)}</span><br><span class="small">Volunteer from ${esc(t.volGroup || "an allied group")}: their own orders. They act on their own at the end of your turn.</span>`; // sim/volunteers.js
  if (t && t.side === "player") {
    if (b.phase === "deploy") return `<b>${esc(t.name)}</b> <span class="muted">${Math.round(t.hp)} hp · ${esc(t.weaponName)}${t.post === "gate" ? " · holds the gate" : t.post === "tower" ? " · on a tower" : ""}</span>`;
    const hh = heightAt(b, t.x, t.y);
    const thr = active(t) ? threatHtml(b, v, t.x, t.y, ` to ${esc(t.name.split(" ")[0])}`) : "";
    return `<b>${esc(t.name)}</b> <span class="muted">${Math.round(t.hp)} hp · ${gunText(b, t)}${t.light ? ` · ${LIGHTS[t.light]?.name || "light"}${activeLight(t) ? "" : " (off)"}` : ""}${t.nvg ? ` · night vision${nvgOn(t) ? "" : " (off)"}` : ""}${t.optic ? ` · optics +${t.optic}` : ""}${t.suppressor ? ` · ${t.supFitted ? "" : "carried "}suppressor${GEAR[t.suppressor.key] && GEAR[t.suppressor.key].dur ? ` (${t.suppressor.dur ?? GEAR[t.suppressor.key].dur} shots)` : ""}` : ""} · sees ${Math.round(sightRange(b, t))} tiles</span>${hh ? `<br><span class="good">${"▲".repeat(hh)} On high ground (height ${hh}): +${HEIGHT.SIGHT * hh} sight, +${Math.min(HEIGHT.MAX_AIM, HEIGHT.AIM * hh)} aim at anything lower, half cover against shooters below.</span>` : ""}${thr}`;
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
  if (ghost && ghost.noise) return `<b>${esc(ghost.label)} heard</b> <span class="muted">${ghost.age ? `${ghost.age} turn${ghost.age === 1 ? "" : "s"} ago` : "this turn"}${ghost.n > 1 ? `, ${ghost.n} times` : ""}, somewhere about here, out of sight: ${esc(ghost.guess)}. The dead hear it too${b.raid ? " (Heat), and while nobody of theirs has seen you they go to look there, not for you" : ""}.</span>`;
  if (ghost && ghost.heard) return `<b>Heard something</b> <span class="muted">here on turn ${ghost.turn}: moving or firing, out of sight. Your people hear what they cannot see within a few tiles (ear protection and helmets change how far; nothing while deafened).</span>`;
  if (ghost) return `<b>${esc(ghost.name)}</b> <span class="muted">last seen here on turn ${ghost.turn}. Nobody sees this tile now: it may have moved.</span>`;
  if (b.phase === "deploy") {
    const k = b.cells[h.y * W + h.x].k;
    const where = k === "gate" ? "The gate: whoever stands here holds it." : k === "breach" ? "A breach in the wall: whoever stands here holds it." : k === "tower" ? "A watchtower (▲▲ height 2): full cover from anything not next to it, +10 aim down, +4 sight: the widest view." : k === "walkway" ? "The walkway (▲ height 1): shoot down over the wall, +5 aim, +2 sight, half cover against shooters below." : k === "stand" ? "A wall stand (▲ height 1, its own ladder): see and shoot over a wall next to it, +5 aim down, +2 sight, half cover against shooters below." : k === "loft" ? "An upper floor (▲ height 1): shoot down through the windows." : k === "roof" ? "A flat roof (▲ height 1): +2 sight, +5 aim down, half cover against shooters below." : k === "ladder" || k === "stairs" ? `${k === "ladder" ? "A ladder" : "Stairs"}: the way up (climbing costs 1 move a level, the dead 2).` : "";
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
      const hint = box.kind === "ground" ? "Put down or dropped here." // ground.js: a pile, in no room
        : box.kind !== "body" ? (b.raid.areas[box.area] ? areaHint(b.raid.areas[box.area].type) + "." : "")
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
  // A light switch (sim/indoorlight.js).
  const sw = b.raid ? switchAt(b, h.x, h.y) : null;
  if (sw) {
    const reach = u && active(u) && switchOptions(b, u).includes(sw);
    return `<b>Light switch: ${sw.on ? "on" : "off"}</b> · ${esc(sw.name)}<br><span class="muted">${reach ? `Click or press ${esc(keyLabel("battle.lights", 1) || "Alt+K")} to flip it (${INDOOR.AP} action, quiet).` : "From next to it, inside the room or in its doorway: click it or Lights to flip it (1 action, quiet)."} ${sw.on ? "Lit, the room is seen as by day by both sides." : `Off, the room is dark${!b.night && !sw.dark ? " but for the daylight through its windows" : ""}: seen only as at night, down the cone or a light's beam.`}</span>`;
  }
  // A window (sim/windows.js): its state once checked ("?" before), what to do with it from next to it.
  if (isWindow(cobj)) {
    const s = windowState(cobj), word = windowWord(cobj);
    const near = u && active(u) && windowsBy(b, u).some((o) => o.x === h.x && o.y === h.y);
    const hp = cobj.mhp ? ` · <span class="${cobj.hp / cobj.mhp < 0.5 ? "danger" : "muted"}">${Math.round(cobj.hp)}/${cobj.mhp}</span>` : "";
    const vaultNote = u && !SIM.canVault(u) ? `Could be vaulted through, not by ${esc(u.name.split(" ")[0])} now (pushing a cart, carrying or dragging a body, or down).` : u && handsBusy(u) && !s.open ? `Not through a closed window with the hands full: breaking it takes a hand.` : `A move may vault through it (+${u && handsBusy(u) ? 2 + 2 * SIM.VAULT.COST : SIM.VAULT.COST} tiles${u && handsBusy(u) ? ", twice the movement with the hands full" : ""}, winded after)${s.open ? "" : `: crashing through a closed one is loud and cuts (${WINDOW.HURT[0]}–${WINDOW.HURT[1]}, +${WINDOW.SMASH_COST} tile)`}.`;
    const how = s.broken ? `The frame is empty: climbed through (quiet) or vaulted through. ${vaultNote}`
      : s.open ? `Open: climbed through (quiet) or vaulted through, and a throw passes it. Close window: ${WINDOW.OPEN_AP} action, quiet. ${vaultNote}`
      : !s.known ? `State unknown: click it or Check window from next to it (free) to learn whether it is unlocked, locked (opens from the inside only) or fixed (only breaks). ${vaultNote}`
      : s.lock === "none" ? `Unlocked: Open window from either side (${WINDOW.OPEN_AP} action, quiet). ${vaultNote}`
      : s.lock === "locked" ? `Locked: Open window from the inside only (${WINDOW.OPEN_AP} action, quiet); from outside, Break window (loud) or vault through. ${vaultNote}`
      : `Fixed: it does not open. Break window (${WINDOW.BREAK.ap} action, loud: ${b.raid ? `Heat +${WINDOW.BREAK.heat}, ` : ""}wakes what is within ${WINDOW.BREAK.radius} tiles) or vault through. ${vaultNote}`;
    return `<b>${s.broken ? "Broken window" : s.open ? "Open window" : "Window"}</b>${s.broken || s.open ? "" : ` · <span class="${s.known ? "muted" : "warn"}">${esc(word)}</span>`}${hp}: half cover at the sill; you see and shoot through it. Cannot stand here.<br><span class="muted">${how}${near ? "" : " Stand right next to it (not diagonally) for the window orders."}</span>`;
  }
  // A closed or open door: any building's (a raid's street map, a field map's houses: sim/combat.js genMap), not only
  // a building's own map. A locked one has its own text (ui/locks.js lockPreview, above).
  if (!b.raid) { const lockText = lockPreview(b, u, h.x, h.y); if (lockText) return lockText; }
  if (cobj.k === "idoor" || cobj.k === "odoor") {
    const shut = cobj.k === "idoor";
    const held = shut && doorHeld(b, cobj) ? unitById(b, cobj.held) : null;
    const hp = cobj.mhp ? ` · <span class="${cobj.hp / cobj.mhp < 0.5 ? "danger" : "muted"}">${Math.round(cobj.hp)}/${cobj.mhp}</span>` : "";
    // The door's kind (sim/buildingmaps.js DOOR_KINDS): its name, and what it is (seen through, flimsy, a crash).
    const K = cobj.dk && DOOR_KINDS[cobj.dk] ? DOOR_KINDS[cobj.dk] : null;
    const kindName = cobj.roll ? "Roller door" : K ? K.name : "Door";
    const kindNote = K ? ` ${esc(K.name)}: ${esc(K.desc)}${K.see ? "; seen through even shut" : ""}${K.glass ? "; broken, it goes with a crash that wakes the unaware nearby" : ""}.` : "";
    return shut
      ? `<b>${esc(kindName)} (closed)</b>${hp}${held ? ` · <span class="good">braced by ${esc(held.name)}</span>` : ""}<br><span class="muted">${K && K.see ? "Blocks the way, not sight." : "Blocks sight."} Click it to walk through: your people open it as they go${cobj.roll ? " (loud: Heat +" + BMAP.ROLLER.heat + ")" : " (quiet)"}; other people stop to open it; the dead must batter it down. Peek (K) through it from next to it.${kindNote}${keyNote(cobj)}</span>`
      : `<b>${esc(kindName)} (open)</b>${hp}<br><span class="muted">Close door (${esc(keyLabel("battle.close", 1) || "Shift+E")}) from next to it: 1 action, quiet${cobj.roll ? " (a roller door: loud)" : ""}. A shut door ${K && K.see ? "slows the dead (it is seen through)" : "stops sight and slows the dead"}.${kindNote}${keyNote(cobj)}</span>`;
  }
  // Something the attackers batter (sim/combat.js bash): a wall section, the gate, a barred door, a window.
  const struct = cobj.mhp ? ` <span class="${cobj.hp / cobj.mhp < 0.5 ? "danger" : "warn"}">${Math.round(cobj.hp)}/${cobj.mhp} hit points</span>${barredCell(cobj) ? " · barred to the attackers (your people pass)" : ""}.${keyNote(cobj)}` : "";
  // Boards nailed across a door or a window (sim/barricade.js): what is under them, the layers, Tear down from next to it.
  if (isBoarded(cobj)) return `<b>${esc(boardedName(cobj))}</b>${struct}<br><span class="muted">${cobj.boards || 1} layer${(cobj.boards || 1) === 1 ? "" : "s"} of boards over the ${esc(boardedUnder(cobj))}: full cover, no sight or way through for anyone until the dead or raiders batter it down (then the ${boardedUnder(cobj) === "window" ? "window is broken" : "door is broken in"}). Tear down (${BOARD.TEAR.ap} actions, from next to it, either side) gives it back; Board up again adds a layer (up to ${BOARD.MAX}).</span>`;
  // Half cover a person can vault (sim/combat.js VAULT, vaultable, canVault): the path may go over it, never end on it.
  const vaultWord = !cell.walk && SIM.vaultable(b, cobj) ? (u && !SIM.canVault(u) ? ` <span class="muted">Could be vaulted, not by ${esc(u.name.split(" ")[0])} now (pushing a cart, carrying or dragging a body, or down; and not the dead).</span>` : ` <span class="muted">Can be vaulted: a move may go over it at +${u && handsBusy(u) ? `${2 + 2 * SIM.VAULT.COST} tiles (twice the movement with the hands full)` : `${SIM.VAULT.COST} tiles`} (never end on it), a scuff heard nearby, and ${SIM.VAULT.COST} tiles less of movement for the rest of the turn.${cell.cover === 1 && cobj.k !== "window" ? ` The dead crawl over it at +${CRAWL.COST} tiles.` : ""}</span>`) : "";
  // A piece of furniture that can be shoved (sim/barricade.js): from right next to it, both actions.
  const shoveWord = shoveable(cobj) ? ` <span class="muted">Can be shoved a tile (Shove, ${SHOVE.AP} actions alone or ${SHOVE.HELP_AP} each with a helper${tallPiece(cobj) ? `; two people, or a Strong back or Melee ${SHOVE.STRONG_MELEE}+` : ""}, from right next to it${cobj.moved ? "; moved already" : ""}${cobj.frame ? "; standing in a door frame" : ""}): in a doorway it blocks the way${cell.cover === 2 ? ": the dead batter it (its hit points) or go round" : ""}.</span>` : "";
  if (!cell.walk) return `<b>${cobj.mhp ? structureName(cobj) : cell.name}</b>: ${cell.cover === 2 ? "full cover" : cell.cover === 1 ? "half cover" : "no cover"}${cell.los || cobj.t ? ", blocks sight from the ground" : ""}. Cannot stand here.${struct}${vaultWord}${shoveWord}`;
  const sides = coverSides(b, h.x, h.y);
  const best = Math.max(...sides);
  let s = best === 2 ? "Full cover next to this tile." : best === 1 ? "Half cover next to this tile." : "No cover here.";
  if (v.reach && u) {
    const d = v.reach.dist[h.y * W + h.x];
    const mw = moveWord(b, u, v, h.x, h.y);
    if (mw) s = `${mw} ${s}`;
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
  if (cobj.mine) s += ` <span class="warn">One of your mines</span><span class="muted">: your people step round it; a raider or one of the dead who steps here sets it off (a pipe bomb's blast).</span>`; // sim/mines.js
  if (cobj.k === "spikes") s += ` <b>Spike pit</b><span class="muted">: the dead are impaled and blunder on; raiders and anyone else not of yours fall in, hurt, and stop there. Your people know where the pits are.</span>`; // sim/combat.js SPIKES
  const soft = softWord(cobj); // sim/softcover.js
  if (soft) s += ` <span class="muted">${soft}</span>`;
  if (cobj.k === "wire") s += ` <b>${cobj.razor ? "Razor wire" : "Barbed wire"}</b><span class="muted">: the dead stop for the turn${cobj.razor ? " and are cut" : ""}; the living are snagged (the rest of the turn, a few cuts) unless they carry a cutter (Cut wire).</span>`; // sim/wire.js
  if (b.tier && b.tier.indoor && b.tier.indoor[h.y * W + h.x]) s += ` Inside ${esc((b.tier.buildings || []).find((x) => x.cells.some(([cx, cy]) => cx === h.x && cy === h.y))?.name || "a building")}.`;
  if (room) s += ` ${esc(room.name)}${room.type ? ` (${esc(areaHint(room.type).replace(/^Likely: /, "likely ").toLowerCase())})` : ""}.`;
  // A raid's dark room (sim/indoorlight.js): a barn, a storeroom by day, any room at night with its lights off.
  const lroom = b.indoor ? roomAt(b, h.x, h.y) : null;
  if (lroom && !roomLit(b, lroom)) s += ` <span class="warn">Dark inside</span><span class="muted">: seen only as at night (${INDOOR.DARK} tiles down the cone, more down a light's beam, night vision the day's sight)${lroom.sw ? "; its light switch is by the door" : "; no power here"}.</span>`;
  else if (lroom && lroom.on && b.night) s += ' <span class="good">Lights on</span><span class="muted">: seen as by day, by both sides.</span>';
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
  // Before going in (sim/raidplan.js: the plan open) the team is not on the map: no squad strip, no hit chances, no barks.
  hudFrame(state, b, cw, ch, holding(b)); // ui/battlehud.js: the big hit chances, your people off screen, the strip and the weapon panel
  if (!holding(b)) barkFrame(ctx, state, b, now, barkView(b, now, cw, ch)); // combat barks over the units' heads (ui/barks.js)
  if (!raidLayout(b)) drawBanner(b, cw, 40); // a raid's top strip carries the turn, Heat and the floor (renderRaidTop)
}
// The battle HUD (ui/battlehud.js): the enemy under the mouse and its odds, the hit chances over the enemies (the
// isometric view's own small labels and hover bubble are left out: these replace them), your people in number-key order.
let hudEl;
function hudFrame(state, b, cw, ch, hold = false) {
  const v = view(b), u = v.u;
  const h = cui.hover;
  const t = h && u && active(u) && b.phase === "player" && !b.over && !held(b, u) ? unitAt(b, h.x, h.y) : null;
  const hoverT = t && t.side === "enemy" && active(t) && v.seen.has(t.id) ? t : null;
  const hoverO = hoverT ? odds(b, u, hoverT) : null;
  const list = hold ? players(b).filter((p) => p.captive) : players(b); // hold: nobody of yours on the map yet but a rescue raid's captives (sim/raidplan.js)
  const sel = held(b, u) ? null : cui.sel;
  if (hudEl === undefined || (hudEl && !hudEl.isConnected)) hudEl = typeof document !== "undefined" && document.getElementById ? document.getElementById("cbhud") : null;
  const bottom = barInset();
  const avoid = hudSync(hudEl, { state, b, list, sel, salt: cui.salt, cw, ch, hoverT, hoverO, mode: cui.mode });
  hudPaint(ctx, b, { cw, ch, hits: hitLabels(b, v), hoverT, hoverO, mode: cui.mode, list, sel, avoid, bottom });
  tapFrame(b, cw, ch, bottom); // a finger's tap held for a confirm: its chip (combatTap)
}
// The bottom bar's height over the map (ui/battlebar.js, #cbbar): the compass, the edge arrows, the squad strip and the
// target card keep clear of it (iso.bottomInset, the CSS variable --cbbar-h on the map's box).
let barEl, barShown = -1;
function barInset() {
  if (barEl === undefined || (barEl && !barEl.isConnected)) barEl = typeof document !== "undefined" && document.getElementById ? document.getElementById("cbbar") : null;
  const h = barEl && barEl.firstElementChild ? Math.round(barEl.firstElementChild.offsetHeight || 0) : 0;
  if (h !== barShown) {
    barShown = h;
    iso.bottomInset = h;
    if (barEl && barEl.parentElement && barEl.parentElement.style) barEl.parentElement.style.setProperty("--cbbar-h", `${h}px`);
  }
  return h;
}
const NO_HITS = new Map();
const noBubble = () => {};
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

// The night line (sim/vision.js): how far anyone sees ahead in the dark at this hour, the lights.
function nightHtml(b) {
  const lit = players(b).filter((p) => activeLight(p) || nvgOn(p)).length;
  const keys = `${keyLabel("battle.light", 1) || "Light on / off"}, ${keyLabel("battle.nvg", 1) || "NVG on / off"}`;
  const tip = `Night (${nightWord(b)}): everyone on foot sees down a cone the way they face, ${darkSight(b)} tiles ahead in the dark and only the cells right around them; the dead see ${STEALTH.NIGHT_ZOMBIE_SIGHT} all round. A light is a beam the way its carrier faces: ${Object.values(LIGHTS).map((L) => `a ${L.name} ${L.round ? `a pool ${L.pool} all round` : `${L.sight} ahead`} (seen +${L.seen})`).join(", ")}; whoever has one switched on is seen from far off by anyone facing it, and a raider, a soldier or anyone else of theirs (not the dead) who sees it knows you are there: their group is alerted. Night vision: ${LIGHTS.tacflash.sight} tiles down the cone (as far as a military flashlight), and no light at all to be seen by. Lights and night vision switch on and off for free, even with no actions left (${keys}); someone with both starts with the goggles on and the light off. Off, they see only what the dark lets them. Guards notice you from closer, and only in their own cone (behind them they hear you; sneaking, not at all). Soldiers carry military flashlights, other people now and then a flashlight. A quick rummage without a light or night vision on is heard ${SEARCH.quick.dark} tiles further.`;
  return `<div class="small warn" style="margin-top:0.25rem" data-tip="${esc(tip)}">Night, ${esc(nightWord(b))}: ${darkSight(b)} tiles ahead in the dark, more down a light's beam, ${LIGHTS.tacflash.sight} with night vision. ${lit} of ${players(b).length} have a light or night vision on.</div>`;
}
// What a light does, for the button (sim/vision.js, sim/combat.js lightSpotted): a beam or a pool to see by, but seen.
const lampText = (L) => (L.round ? `a pool of light ${L.pool} tiles all round` : `${L.sight} tiles down its beam`);
function lightTip(b, u) {
  const L = LIGHTS[u.light] || LIGHTS.flashlight, on = !!activeLight(u);
  const dark = nvgOn(u) ? `night vision's ${nvgSight(u)} tiles down the cone` : b.night ? `the dark: ${darkSight(b)} tiles ahead at ${nightWord(b)}` : "the dark";
  return `Free (even with no actions left): switch the ${L.name} ${on ? "off" : "on"}. On: ${lampText(L)} to see by, but whoever carries a light is seen from far off by anyone facing it (noticed ${L.seen} tiles further), and any raider or soldier who sees it knows they are there and alerts their group. Off: ${dark}, and nothing to give them away.${u.sneaking && !on ? " Sneaking with a light on: the light still shows over cover." : ""}${b.night ? "" : " It counts at night (by day it changes nothing)."}`;
}
function nvgTip(b, u) {
  const on = nvgOn(u), lamp = activeLight(u) ? LIGHTS[activeLight(u)] : null;
  return `Free (even with no actions left): night vision ${on ? "off (flipped up)" : "on"}. On: ${nvgSight(u)} tiles down the cone (as far as a military flashlight), and no light to give them away. Off: ${lamp ? `the ${lamp.name}'s ${lampText(lamp)}` : b.night ? `the dark: ${darkSight(b)} tiles ahead at ${nightWord(b)}` : "the dark"}.${on && lamp ? ` Their ${lamp.name} is on as well: it gives them away whatever the goggles do.` : ""}${b.night ? "" : " It counts at night (by day it changes nothing)."}`;
}

// ---------- view cones (sim/vision.js) ----------
// How far a unit sees from (x, y) (sim/combat.js sightRange, read off this battle's own size).
const hz = (b, x, y) => (x >= 0 && y >= 0 && x < b.w && y < b.h && b.cells[y * b.w + x] ? heightAt(b, x, y) : 0);
const sightAt = (b, o, x = o.x, y = o.y) => o.sight + HEIGHT.SIGHT * hz(b, x, y) + (o.optic || 0) + (o.vsight || 0);
// The way from the middle of (x, y) toward the mouse at (px, py), in map radians (null when the mouse is on the
// tile's own middle): the ground's projection turned back.
function mouseAngle(b, x, y, px, py) {
  const z = hz(b, x, y) * LV + liftOf(b);
  const [X0, Y0] = project(x + 0.5, y + 0.5, z), [X1, Y1] = project(x + 1.5, y + 0.5, z), [X2, Y2] = project(x + 0.5, y + 1.5, z);
  const ax = X1 - X0, ay = Y1 - Y0, bx = X2 - X0, by = Y2 - Y0, mx = px - X0, my = py - Y0;
  const det = ax * by - bx * ay;
  if (!det) return null;
  const dx = (mx * by - bx * my) / det, dy = (ax * my - mx * ay) / det;
  return Math.hypot(dx, dy) < 0.45 ? null : Math.atan2(dy, dx);
}
// A cone on the ground: its wedges (sim/vision.js viewWedges) from the middle of (x, y), and the ring all round.
function drawCone(b, x, y, view, fill, stroke, dashed = false) {
  const z = hz(b, x, y) * LV + liftOf(b) + 1, cx = x + 0.5, cy = y + 0.5;
  ctx.save();
  ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1.5;
  if (dashed) ctx.setLineDash([5, 4]);
  const shapes = view.round ? [{ r: view.near, half: Math.PI }] : view.wedges;
  for (const w of shapes) {
    if (!(w.r > 0)) continue;
    ctx.beginPath();
    const full = w.half >= Math.PI - 1e-6, n = Math.max(6, Math.ceil(w.half * 2 * w.r / 0.5));
    if (!full) { const [X, Y] = project(cx, cy, z); ctx.moveTo(X, Y); }
    for (let i = 0; i <= n; i++) {
      const a = view.ang - w.half + (2 * w.half * i) / n;
      const [X, Y] = project(cx + Math.cos(a) * w.r, cy + Math.sin(a) * w.r, z);
      if (full && i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  if (!view.round && view.near > 0) {
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2, [X, Y] = project(cx + Math.cos(a) * view.near, cy + Math.sin(a) * view.near, z); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
// What a unit's cone shows: one of yours, what they watch (and see at night); an enemy you see, unaware: how near it
// notices the selected one in its cone (and hears them out of it, dashed); aware: what it watches.
function coneOf(b, t, sel) {
  const sight = (o) => sightAt(b, o);
  if (t.side !== "player" && !t.aware && sel) {
    const near = (o) => noticeRange(b, o, sel);
    const v = viewWedges(b, t, sight, near);
    return { view: v, hear: !v.round && hasFront(t) ? earshot(t, sel, near(t)) : 0 };
  }
  return { view: viewWedges(b, t, sight), hear: 0 };
}
function drawCones(b, v) {
  const u = v.u, sel = u && u.side === "player" ? u : null;
  const shown = (t) => onFloor(b, t) && !t.dead && !t.down && !t.left && !t.fled && !t.off && t.x >= 0 && t.y >= 0 && t.x < b.w && t.y < b.h && !held(b, t); // held: not on the map yet (sim/raidplan.js)
  if (cui.cones) {
    for (const t of b.units) {
      if (!shown(t) || (t.side !== "player" && !v.seen.has(t.id)) || t === u) continue;
      const c = coneOf(b, t, sel);
      if (t.side === "player") drawCone(b, t.x, t.y, c.view, "rgba(110,170,255,0.08)", "rgba(140,190,255,0.45)");
      else {
        const warm = !t.aware;
        drawCone(b, t.x, t.y, c.view, warm ? "rgba(255,190,80,0.12)" : "rgba(255,90,80,0.1)", warm ? "rgba(255,200,100,0.7)" : "rgba(255,110,100,0.6)");
        if (c.hear > 0) drawCone(b, t.x, t.y, { round: true, near: c.hear, ang: 0, wedges: [] }, "rgba(255,190,80,0.04)", "rgba(255,200,100,0.45)", true);
      }
    }
  }
  if (!u || !shown(u) || u.side !== "player") return;
  // The selected one: always, faintly; picking a way (a move's second click, Face, Overwatch): where the mouse points.
  const h = cui.hover, fp = cui.mode === "facemove" ? cui.facePick : null;
  const picking = (fp && fp.uid === u.id) || ((cui.mode === "face" || cui.mode === "overwatch") && u.ap > 0);
  if (picking && h && h.px != null) {
    const at = fp || u, ang = mouseAngle(b, at.x, at.y, h.px, h.py);
    const ghost = { ...u, x: at.x, y: at.y };
    if (ang != null) setFacing(ghost, ang);
    else if (fp) { const path = v.reach ? pathTo(v.reach, fp.x, fp.y) : []; const p = path[path.length - 1], q = path.length > 1 ? path[path.length - 2] : [u.x, u.y]; if (p && q) setFacing(ghost, Math.atan2(p[1] - q[1], p[0] - q[0])); }
    const view = viewWedges(b, ghost, (o) => sightAt(b, o, at.x, at.y));
    if (cui.mode === "overwatch" && !view.round) view.wedges = [{ r: Math.min(sightAt(b, u), (WEAPONS[u.weapon] ? (WEAPONS[u.weapon].opt || 8) + 8 : 16)), half: VISION.HALF }];
    drawCone(b, at.x, at.y, view, "rgba(140,200,255,0.16)", "rgba(170,215,255,0.95)");
    return;
  }
  if (hasFront(u)) drawCone(b, u.x, u.y, viewWedges(b, u, (o) => sightAt(b, o)), "rgba(140,200,255,0.06)", "rgba(170,215,255,0.5)");
}

// The isometric view (ui/isoview.js) with what it needs from here.
function drawIsoView(state, b, now, cw, ch) {
  const v = view(b);
  const plan = retreatAskOpen(b) ? askPlan(b) : null;
  const fp = cui.mode === "facemove" && cui.facePick && v.u && cui.facePick.uid === v.u.id ? cui.facePick : null; // a move's tile picked: its path stays drawn while the way to face is picked
  const hold = held(b, v.u); // sim/raidplan.js: before going in nobody of yours is on the map (no selected one, no cones; a rescue raid's captives are there)
  drawIso(ctx, cw, ch, state, b, now, {
    known: v.known, allKnown: ownGround(b), // the fog of war indoors (ui/isoview.js)
    v, u: hold ? null : v.u, sel: hold ? null : cui.sel, mode: fp ? "move" : cui.mode, hover: fp ? { x: fp.x, y: fp.y } : cui.hover, salt: cui.salt,
    animPos: (t, n) => { const [x, y] = animTile(b, t, n), h = (t.size || 1) / 2; return [x + h, y + h]; }, // a 2 × 2 boss stands on its footprint's centre
    moveOf: (t, n) => moveNow(b, t, n), // walking: the step it is on and how far along (its heading and stride: ui/moveanim.js)
    fxAge: (f, n) => { if (!cui.anim.has(f.seq)) cui.anim.set(f.seq, n); return Math.max(0, n - cui.anim.get(f.seq)); },
    unitAt: (x, y) => unitAt(b, x, y), pathTo, odds, bubble: noBubble, // the hover card is ui/battlehud.js's
    hits: NO_HITS, retreatOpen: !!plan, plan, // the hit chances over the enemies are ui/battlehud.js's (hudPaint)
    threat: (x, y) => threatAt(b, v, x, y), // the threat preview: lines from whoever could hit the hovered tile
    callout: cui.mode === "callout" && v.u && !hold ? callTargets(state, b, v.u) : null, // Call out: whom it can be called to (sim/parley.js)
    allyMarks: b.raid && !hold ? allyMarks(state, b, v) : null, // Ally orders (sim/allyorders.js): the markers you set, the allies in reach while picking
    cone: nlConeMask(b, v.u, cui), // the pepper spray's cone toward the hovered tile (ui/nonlethal.js)
    throwMarks: throwPreview(b, v.u), // throw mode: the range and the reach of the hovered spot (sim/throwables.js)
    ghost: b.layout && cui.hover ? ghostAt(state, b, cui.hover.x, cui.hover.y) : null, // the base map: the pick's footprint under the mouse (sim/basemap.js)
  });
  if (!b.over && b.phase !== "deploy" && !hold) drawCones(b, v); // sim/vision.js: the view cones (the selected one's, the toggle's, the way being picked)
  if (b.raid && !b.over && !hold) drawAllyCones(b); // Ally orders: an ally's overwatch cone, the way being picked for one
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
    b.phase === "deploy" ? (b.layout ? "BASE MAP · PLACE YOUR BUILDINGS AND DEFENCES" : b.drill ? `DEFENCE DRILL · ${planKey(b) === "fort" ? "PLAN YOUR POSTS" : "FACING AN ATTACK FROM THE EAST"}` : b.deploy && b.deploy.attackers ? "STAGE THE ASSAULT · ANY SIDE OF THEIR WALLS" : b.tier && b.tier.fellBackTurn != null ? "REDEPLOY · FALL BACK TO THE YARD" : `DEPLOY · THEY COME FROM THE ${String((b.deploy && b.deploy.side) || "east").toUpperCase()}`) :
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



// Units walk their moves (ui/moveanim.js): where one is now, in cells (fractions while it moves).
function animTile(b, t, now) {
  const m = moveNow(b, t, now);
  return m ? [m.x, m.y] : [t.x, t.y];
}
// The move a unit is walking at now and how far along it is (moveAt: x, y, dir, dist, gait), or null standing. A
// move not set off yet (after the unit's moves before it: stampMoves) is the one before it still being walked.
function moveNow(b, t, now) {
  for (let i = b.fx.length - 1; i >= 0; i--) {
    const f = b.fx[i];
    if (f.type !== "move" || f.unit !== t.id) continue;
    if (!cui.anim.has(f.seq)) cui.anim.set(f.seq, now);
    const el = now - cui.anim.get(f.seq);
    if (el < 0) continue; // still to come
    return moveAt(b, t, f, el);
  }
  return null;
}
// The moves logged since the last look, timed: each one sets off now, or when the same unit's move before it ends
// (two actions spent moving, the enemy's whole turn: walked one after the other, not the last one alone). The plan
// keeps the wait (delay) for the footsteps (ui/sfx-steps.js). Returns when the last of them ends.
function stampMoves(b, now) {
  let end = now;
  if (!b.fx || (cui.movesSeen || 0) >= (b.fxSeq || 0)) return end;
  const last = new Map(); // unit -> when its latest move ends
  for (const f of b.fx) {
    if (f.type !== "move") continue;
    const u = unitById(b, f.unit), p = planOf(b, u, f);
    if (f.seq <= (cui.movesSeen || 0)) { if (cui.anim.has(f.seq)) last.set(f.unit, cui.anim.get(f.seq) + p.total); continue; }
    const start = Math.max(now, last.get(f.unit) || 0);
    cui.anim.set(f.seq, start);
    p.delay = start - now;
    last.set(f.unit, start + p.total);
    end = Math.max(end, start + p.total);
  }
  cui.movesSeen = b.fxSeq;
  return end;
}
// The enemy's (or the autopilot's) next one waits for the walk just logged where you can see it (WALK_WAIT).
function walkWait(b, end, before, now) {
  let from = Infinity;
  for (const f of b.fx) if (f.type === "move" && f.seq > before && cui.anim.has(f.seq)) from = Math.min(from, cui.anim.get(f.seq));
  if (from === Infinity || end <= now) return;
  cui.walkUntil = Math.min(from + WALK_WAIT_MAX, from + (end - from) * WALK_WAIT);
}

