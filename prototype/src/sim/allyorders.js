// Orders to allies in a raid (the user's request 2026-10-21): one of your people may tell an allied survivor (parley.js
// "Fight with us": u.ally, a third-side unit) within ALLY_ORDER.RANGE tiles what to do: attack a target, move to a
// cell (any cell, the fog of war too: you do not see what they see), push to a cell and fight what is there, overwatch
// a cone, hold, follow, cover you, retreat (try to get off the map), or act on their own again. They may ignore it.
// When your team evacuates, every ally is told to retreat.
//   giving one  - combatAct {type:"allyorder", unit, ally, order: { kind, target?, x?, y?, face?: [x, y], group? }}: a
//                 shout or a gesture, 1 action of the one who gives it (allyOrderRefusal: active with an action; the
//                 ally allied, able to act, on the same floor, within RANGE tiles; an attack's target one of the dead
//                 or the enemy's people your side sees now; a move's or a push's cell anywhere on the map, fogged or
//                 not: the sim takes the nearest cell the ally can get to (resolveCell); an overwatch's cell to face
//                 and a gun). group: every ally of that group within RANGE of the one giving it, a roll each (a move
//                 or a push spreads them over the free cells nearest the one picked). Leadership XP for each order.
//   ignored     - allyOdds: base[kind] + lead × (Leadership − 8) + speech × (Speech − 8) of the one giving it, + the
//                 group's fighting-together credit (parley.js foughtBonus × fought), − h × its hostility, − danger ×
//                 the order's danger (dangerOf, 0..1: a target much stronger than them, a boss, in among the dead or
//                 many of the enemy's people, far off; a cell near threats, in the open; staying near threats), − hurt
//                 × the share of their health gone (a retreat: + instead), 5–95% ("free" is always heeded). A roll a
//                 order (a hash of b.parley.seed, the ally and b.aorders, the count of orders given). Heeded: a log
//                 line, u.aorder set; ignored: a log line and nothing else changes (the old order stands).
//                 A treacherous group (parley.js, not unmasked) always "agrees" (u.aorder.fake: shown as heeded, and
//                 they go on doing what they want until the trap is sprung: parley.js hostile drops the order).
//   the AI      - combat.js aiUnit (allyTurn, before thirdside.js thirdPlan): attack - after the target with the
//                 usual AI (thirdside.js thirdFoes narrowed by allyFoes: the target and whatever is next to them), back
//                 to their own call once it is down or lost LOST turns; move - walk to the cell (only fighting what is
//                 next to them on the way), then hold it, firing at what they see; push - walk there, firing on what
//                 is near the cell (within PUSH.R) when the shot is fair, then the usual AI against that; overwatch -
//                 face the cell and watch (u.ow, kept through the enemy's turn: allyKeepsWatch in endPlayerTurn), only
//                 fighting what is next to them; hold - stay put and fire at what they see; follow - keep within
//                 FOLLOW.far tiles of the one who gave it; cover - the same, firing first at what threatens them
//                 (within COVER.r of them); retreat - to the nearest way out (an extraction zone, the map's edge; the
//                 stairs down first) and off the map (u.left, u.aleft: out alive, not fled). An order stands until it
//                 is done or replaced; one that cannot be carried out (target gone, no way through for STUCK turns)
//                 ends with a log line.
//   info        - Tell me what you see: no standing order, a snapshot (tellIntel) of what the ally sees now (canSeeAt
//                 from them, within their view cone and the cells next to them, on their floor): every thing on a
//                 cell your side does not see becomes a mark in b.intel.marks ({ x, y, f, kind, label, turn, by }:
//                 the dead, people, unsearched containers, bodies, things on the ground, doors (locked, open), windows,
//                 vehicles), drawn as "?" shadows in the fog (allyIntel). The fog is not revealed; a mark never moves;
//                 it goes once your side sees its cell (allyIntelTick: after each action, at your turn's start); a new
//                 one replaces the marks inside that ally's view; a log line counts what they told. A treacherous
//                 ally says nothing worth having.
//   evac        - combatAct "evac", the raid bot deciding to leave (autoRaidTurn R.botOut) and the raid ending with
//                 your people out (checkEnd): every ally without a retreat order is told to retreat (allyEvac: + EVAC
//                 to the odds, no action, no range: they see you go), one log line.
//   after       - endRaid (parley.js parleyEnd → allyOrdersEnd): the orders cleared off every unit; each group's
//                 record keeps its count (rec.aorders: given, heeded, dead: their people who died under an order of
//                 yours, out: those who got off the map by one); result.parley[].orders; parleyGoodwill →
//                 allyOrdersGoodwill: GOODWILL.dead a death (at most GOODWILL.max) off their group's goodwill, a
//                 wanderer group's fought memory down by GOODWILL.fought each.
//   the map     - allyOrderOf / allyOrdersShown: the orders your people gave and know of (a heeded one, a treacherous
//                 group's fake one too): the move marker, the overwatch cone, the icon (ALLY_ORDER.ICON).
// Plain data only (u.aorder, u.aleft, b.aorders, b.intel, rec.aorders); every roll a hash. A battle with no allies takes
// exactly the old paths (every hook is behind u.aorder, u.ally or b.parley).
// THIS FILE IS THE CONTRACT the UI is written against (ui/combat.js, ui/isoview.js, ui/battlebar.js): keep the
// exported names and the shapes they return.
import { say, active, activeAny, canSee, canSeeAt, playerSees, playerVision, setFloor, unitById, moveAlong, reachable, pathTo, distField, bestShot, fire, strike, meleeReach, canFire, isRanged, coverSides, moveMob, zoneAt, moveToFloor, reloadAI, CELL } from "./combat.js";
import { stairTop } from "./buildingmaps.js"; // the cell of a stair run that changes floor (call-time only)
import { faceToward, inArc, hasFront, VISION } from "./vision.js";
import { lootLayer } from "./raidloot.js";
import { doorsOf } from "./locks.js";
import { thirdFoes } from "./thirdside.js";
import { foughtBonus } from "./parley.js";
import { survivorById, skill, factionById } from "./world.js";
import { hash01, hasPerk, gainXp } from "./skills.js";
import { changeGoodwill } from "./factions.js";
import { groupById } from "./wanderers.js";

export const ALLY_ORDER = {
  RANGE: 5, // tiles between the one giving the order and the ally
  AP: 1, // the order's cost (a shout, a gesture)
  ODDS: {
    base: { attack: 0.75, move: 0.85, push: 0.7, overwatch: 0.85, hold: 0.9, follow: 0.85, cover: 0.8, info: 0.95, retreat: 0.85, free: 1 },
    lead: 0.03, speech: 0.01, // a point of the giver's Leadership / Speech over 8
    fought: 1, // × parley.js foughtBonus (fighting side by side, this battle and before: up to PARLEY.ODDS.foughtMax)
    h: 0.005, // a point of the group's hostility (the one it shows)
    danger: 0.6, // × dangerOf (0..1)
    hurt: 0.3, // × the share of their health gone (a retreat: added)
    evac: 0.3, // your team pulling out: they do not want to stay behind alone
    min: 0.05, max: 0.95,
  },
  // dangerOf: the dead (dead) and the enemy's people up and fighting (people) within `r` tiles of the target or the
  // cell, each; a target stronger than them (strong × (its health / theirs − 1), at most strongMax), a boss or a big
  // one of the dead (big); a target more than farFrom tiles off (far a tile, at most farMax); a cell with threats near
  // and no cover (open); a push expects a fight (push ×); staying near threats (stay ×, within `r` of them).
  DANGER: { r: 4, dead: 0.08, people: 0.12, strong: 0.15, strongMax: 0.3, big: 0.3, farFrom: 8, far: 0.02, farMax: 0.2, open: 0.15, push: 0.6, stay: 0.5 },
  XP: { give: 2, heeded: 2 }, // Leadership XP for an order given, more when heeded
  LOST: 3, // an attack's target out of their sight this many turns: they give it up
  STUCK: 2, // turns without getting any nearer: the move (push, retreat) is given up
  PUSH: { r: 5, fair: 45, leash: 3 }, // a push fights what is within r tiles of the cell (on the way, a shot at fair % or better), and goes back to it from more than leash tiles off
  FOLLOW: { far: 3, near: 2 }, // follow and cover: more than `far` tiles off, they close to within `near`
  COVER: { r: 5 }, // cover: the threats within r tiles of the one they cover come first
  GOODWILL: { dead: -2, max: -6, fought: 1 }, // after the raid: a death under your orders (at most max); a wanderer group's fought memory
  ICON: { attack: "⚔", move: "➜", push: "»", overwatch: "◔", hold: "■", follow: "↟", cover: "⛨", info: "?", retreat: "⇱", free: "" },
};

// The orders, in menu order. need: what the order needs picked on the map ("unit" an enemy your side sees, "cell"
// any cell, fog or not, "face" a cell to face (the cone), null nothing). icon: ALLY_ORDER.ICON.
export const ALLY_ORDERS = [
  { kind: "attack", label: "Attack", need: "unit", tip: "Go after this target" },
  { kind: "move", label: "Move", need: "cell", tip: "Go to this spot and hold it" },
  { kind: "push", label: "Push to", need: "cell", tip: "Advance to this spot and fight whatever is there" },
  { kind: "overwatch", label: "Overwatch", need: "face", tip: "Hold and fire on what moves in this cone" },
  { kind: "hold", label: "Hold", need: null, tip: "Stay where you are" },
  { kind: "follow", label: "Follow me", need: null, tip: "Stay close to the one who gave the order" },
  { kind: "cover", label: "Cover me", need: null, tip: "Stay close and shoot what threatens the one who gave the order" },
  { kind: "info", label: "Tell me what you see", need: null, tip: "They tell you what they can see: marked in your fog of war, not updated" },
  { kind: "retreat", label: "Retreat", need: null, tip: "Get off the map by the nearest way out" },
  { kind: "free", label: "Own call", need: null, tip: "Fight as you see fit" },
].map((o) => ({ ...o, icon: ALLY_ORDER.ICON[o.kind] }));

const clamp = (v, a, c) => Math.max(a, Math.min(c, v));
const dist = (a, c) => Math.hypot(a.x - c.x, a.y - c.y);
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const first = (n) => String(n || "").split(" ")[0];
const kindOf = (k) => ALLY_ORDERS.find((o) => o.kind === k) || null;
const isAlly = (a) => !!a && a.side === "third" && !!a.ally;
const recOf = (b, u) => (b && b.parley && u && u.pk ? b.parley.groups.find((g) => g.key === u.pk) || null : null);
const roll = (b, ...k) => hash01(b.parley ? b.parley.seed : 0, "aorder", ...k);
const inBounds = (b, x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < b.w && y < b.h;
const walkAt = (b, i) => !!CELL[b.cells[i].k] && !!CELL[b.cells[i].k].walk;
const takenAt = (b, x, y, me) => b.units.some((o) => o !== me && !o.dead && !o.left && !o.fled && !o.off && (o.f || 0) === (me.f || 0) && o.x === x && o.y === y);
// The dead, and the enemy's people up and fighting: what an ally fears (and fights: thirdside.js thirdFoes).
const threat = (o) => active(o) && o.side === "enemy" && (o.kind === "zombie" || !!o.aware);
const enemyOf = (t) => !!t && t.side === "enemy" && !t.surr && !t.tied && !t.dormant;

// ---------- who may give which order ----------
// The allies unit u (yours) can give an order to now: active allies within RANGE, the same floor, the nearest first.
export function allyOrderTargets(state, b, u) {
  if (!b || !u || u.side !== "player" || !active(u) || u.ap < ALLY_ORDER.AP) return [];
  return b.units.filter((a) => isAlly(a) && active(a) && (a.f || 0) === (u.f || 0) && dist(u, a) <= ALLY_ORDER.RANGE).sort((p, q) => dist(u, p) - dist(u, q) || p.id - q.id);
}

// Why u cannot give this order to ally a: "" when it can. order = { kind, target?, x?, y?, face?: [x, y], group? }
// (group: the order goes to every ally of a's group within RANGE of u).
export function allyOrderRefusal(state, b, u, a, order) {
  if (!b || b.over) return "The fight is over.";
  if (!u || u.side !== "player" || !active(u)) return "That unit cannot act.";
  if (u.ap < ALLY_ORDER.AP) return "No action left.";
  if (!a || a === u || a.side === "player") return "Give an order to whom?";
  if (!isAlly(a)) return `${first(a.name)} is not fighting with you: only an ally takes an order.`;
  if (!active(a)) return `${first(a.name)} cannot act now.`;
  if ((a.f || 0) !== (u.f || 0)) return `${first(a.name)} is on another floor.`;
  if (dist(u, a) > ALLY_ORDER.RANGE) return `${first(a.name)} is too far off to hear ${first(u.name)} (${ALLY_ORDER.RANGE} tiles at most).`;
  const o = order || {};
  const K = kindOf(o.kind);
  if (!K) return "Which order?";
  if (K.need === "unit") {
    const t = o.target != null ? unitById(b, o.target) : null;
    if (!t || !active(t)) return "Attack what? Pick one of the dead or the enemy's people.";
    if (!enemyOf(t)) return t.side === "third" ? "They are not your enemy." : "Pick one of the dead or the enemy's people.";
    if ((t.f || 0) !== (a.f || 0)) return "That target is on another floor.";
    if (!playerSees(b, t)) return "Your people cannot see that target.";
  }
  if (K.need === "cell") {
    if (!inBounds(b, o.x, o.y)) return "Pick a spot on the map.";
    if (!resolveCell(b, a, o.x, o.y)) return `${first(a.name)} cannot get anywhere near there.`;
  }
  if (K.need === "face") {
    const f = o.face;
    if (!Array.isArray(f) || !inBounds(b, f[0], f[1])) return "Pick the way to watch.";
    if (f[0] === a.x && f[1] === a.y) return "Pick a spot away from them to watch.";
    if (!isRanged(a)) return `${first(a.name)} has no gun to watch with.`;
  }
  return "";
}

// The allies an order to a reaches: a alone, or (group) every ally of its group u may give it to.
function reached(state, b, u, a, order) {
  if (!order || !order.group) return [a];
  return [a, ...allyOrderTargets(state, b, u).filter((x) => x !== a && x.pk && x.pk === a.pk)];
}

// ---------- the odds ----------
// How dangerous the order is for ally a, 0..1 (DANGER). Only what they or your people can see counts.
function dangerOf(b, a, order) {
  const D = ALLY_ORDER.DANGER, o = order || {};
  const seen = b.units.filter((e) => threat(e) && (e.f || 0) === (a.f || 0) && (canSee(b, a, e) || playerSees(b, e)));
  const near = (x, y, r, but = null) => { let s = 0; for (const e of seen) if (e !== but && Math.hypot(e.x - x, e.y - y) <= r) s += e.kind === "zombie" ? D.dead : D.people; return s; };
  let d = 0;
  if (o.kind === "attack") {
    const t = o.target != null ? unitById(b, o.target) : null;
    if (!t) return 0;
    d += near(t.x, t.y, D.r, t);
    d += clamp(((t.hp || 1) / Math.max(1, a.hp) - 1) * D.strong, 0, D.strongMax);
    if (t.boss || ["brute", "wallbreaker", "broodmother", "boneback"].includes(t.ztype)) d += D.big;
    d += clamp((dist(a, t) - D.farFrom) * D.far, 0, D.farMax);
  } else if (o.kind === "move" || o.kind === "push") {
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return 0;
    const n = near(o.x, o.y, D.r);
    d += n * (o.kind === "push" ? D.push : 1);
    if (n > 0 && inBounds(b, o.x, o.y) && !coverSides(b, o.x, o.y).some((c) => c)) d += D.open;
  } else if (o.kind !== "retreat" && o.kind !== "free" && o.kind !== "info") d += near(a.x, a.y, D.r) * D.stay;
  return clamp(d, 0, 1);
}

// The chance a heeds this order from u (0..1). u may be null (the team's call: allyEvac).
export function allyOdds(state, b, u, a, order) {
  if (!b || !a) return 0;
  const O = ALLY_ORDER.ODDS, o = order || {};
  if (o.kind === "free") return 1;
  const s = u && u.sid != null ? survivorById(state, u.sid) : null;
  const lead = s ? skill(s, "leadership") : 4, speech = s ? skill(s, "speech") + (hasPerk(s, "smooth") ? 2 : 0) : 4;
  const rec = recOf(b, a);
  const hostility = rec ? (rec.treacherous && !rec.unmasked ? rec.lie : rec.hostility) || 0 : 30;
  const hurt = 1 - clamp((a.hp || 0) / Math.max(1, a.maxHp || a.hp || 1), 0, 1);
  let c = (O.base[o.kind] ?? 0.7) + O.lead * (lead - 8) + O.speech * (speech - 8) - O.h * hostility - O.danger * dangerOf(b, a, o);
  if (rec) c += O.fought * foughtBonus(state, rec);
  c += o.kind === "retreat" ? O.hurt * hurt : o.kind === "info" ? 0 : -O.hurt * hurt;
  return clamp(c, O.min, O.max);
}

// ---------- giving it ----------
// The nearest cell to (x, y) ally a can stand on and walk to (any cell asked, fog or not): [x, y] or null. taken: cell
// indices already given to another ally (a group's move).
function resolveCell(b, a, x, y, taken = null) {
  if (!inBounds(b, x, y)) return null;
  const field = distField(b, [[a.x, a.y]], null); // walking distance from them (the map, not who stands where)
  let best = -1, bd = Infinity, bf = Infinity;
  for (let i = 0; i < b.w * b.h; i++) {
    if (!isFinite(field[i]) || !walkAt(b, i) || (taken && taken.has(i))) continue;
    const cx = i % b.w, cy = (i / b.w) | 0;
    if (takenAt(b, cx, cy, a) && !(cx === a.x && cy === a.y)) continue;
    const d = Math.hypot(cx - x, cy - y);
    if (d < bd - 1e-9 || (Math.abs(d - bd) < 1e-9 && field[i] < bf)) { best = i; bd = d; bf = field[i]; }
  }
  return best < 0 ? null : [best % b.w, (best / b.w) | 0];
}

const HEED = {
  attack: (A, I, T) => `${A} nods and goes after ${T}.`,
  move: (A) => `${A} nods and moves up.`,
  push: (A) => `${A} nods: "Pushing up."`,
  overwatch: (A) => `${A} nods and takes up a watch.`,
  hold: (A) => `${A} nods and holds there.`,
  follow: (A, I) => `${A} nods and falls in behind ${I}.`,
  cover: (A, I) => `${A}: "I've got you, ${I}."`,
  retreat: (A) => `${A} nods and heads for the way out.`,
  free: (A) => `${A}: "My call, then."`,
};
const IGNORE = [
  (A) => `${A} shakes their head: "Not a chance."`,
  (A) => `"No way," ${A} says, and does not budge.`,
  (A, I) => `${A} hears ${I} out and ignores it.`,
];

// One ally given the order (rolled): true when heeded. opts: { bonus: added to the odds, quiet: no log line, cell:
// the resolved cell (a group's move) }.
function give(state, b, u, a, order, opts = {}) {
  const O = ALLY_ORDER.ODDS, kind = order.kind;
  const n = (b.aorders = (b.aorders || 0) + 1);
  const rec = recOf(b, a);
  if (rec) rec.aorders = rec.aorders || { given: 0, heeded: 0, dead: 0, out: 0 };
  if (rec) rec.aorders.given++;
  const fake = !!rec && rec.treacherous && !rec.unmasked; // they agree to anything
  const odds = kind === "free" ? 1 : clamp(allyOdds(state, b, u, a, order) + (opts.bonus || 0), O.min, O.max);
  const A = first(a.name), I = u ? first(u.name) : "your people";
  b.rev = (b.rev || 0) + 1;
  if (!(fake || kind === "free" || roll(b, a.id, n) < odds)) {
    if (!opts.quiet) say(b, IGNORE[Math.floor(roll(b, "line", a.id, n) * IGNORE.length)](A, I), "info");
    return false;
  }
  if (rec) rec.aorders.heeded++;
  if (kind === "free") { delete a.aorder; if (!opts.quiet) say(b, HEED.free(A, I), "info"); return true; }
  if (kind === "info") { tellIntel(b, a, fake); return true; } // what they see, marked in your fog (the order they hold stands)
  const t = order.target != null ? unitById(b, order.target) : null;
  const o = { kind, by: u ? u.id : null, since: b.turn || 0, x: null, y: null, ask: null, target: null, face: null, group: !!order.group, fake, there: false, stuck: 0, best: null, seenAt: b.turn || 0 };
  if (kind === "attack" && t) o.target = t.id;
  if (kind === "move" || kind === "push") { const c = opts.cell || resolveCell(b, a, order.x, order.y); if (!c) return false; o.x = c[0]; o.y = c[1]; o.ask = [order.x, order.y]; }
  if (kind === "overwatch") o.face = [order.face[0], order.face[1]];
  if (kind === "retreat") { const c = wayOut(b, a); if (c) { o.x = c[0]; o.y = c[1]; } }
  a.aorder = o;
  a.ow = false;
  if (kind === "overwatch" && !fake) { faceToward(a, o.face[0], o.face[1]); if (canFire(b, a)) a.ow = true; } // on watch at once (kept through the enemy's turn)
  if (!opts.quiet) say(b, HEED[kind](A, I, t ? t.name : "the target"), "info");
  return true;
}

// combatAct "allyorder": u gives the order to ally a (and its group, order.group). Returns "" or why not.
export function allyOrder(state, b, u, act) {
  const a = act && act.ally != null ? unitById(b, act.ally) : null;
  const order = (act && act.order) || {};
  const why = allyOrderRefusal(state, b, u, a, order);
  if (why) return why;
  u.ap -= ALLY_ORDER.AP;
  u.hunker = false;
  const list = reached(state, b, u, a, order);
  const taken = new Set();
  let heeded = 0;
  for (const x of list) {
    let cell = null;
    if (order.kind === "move" || order.kind === "push") { cell = resolveCell(b, x, order.x, order.y, taken); if (!cell) continue; taken.add(cell[1] * b.w + cell[0]); }
    if (give(state, b, u, x, order, { cell })) heeded++;
  }
  const s = u.sid != null ? survivorById(state, u.sid) : null;
  if (s) gainXp(state, s, "leadership", ALLY_ORDER.XP.give + (heeded ? ALLY_ORDER.XP.heeded : 0));
  return "";
}

// Your team pulls out (combatAct "evac", the raid bot leaving, the raid over with your people out): every ally not
// already retreating is told to (EVAC on the odds; no action, no range). One log line.
export function allyEvac(state, b) {
  if (!b || !b.parley) return 0;
  const allies = b.units.filter((a) => isAlly(a) && active(a) && !(a.aorder && a.aorder.kind === "retreat"));
  if (!allies.length) return 0;
  const lead = (p) => { const s = p.sid != null ? survivorById(state, p.sid) : null; return s ? skill(s, "leadership") : 0; };
  const caller = b.units.filter((p) => p.side === "player" && activeAny(p)).sort((p, q) => lead(q) - lead(p) || p.id - q.id)[0] || null;
  const go = [], stay = [];
  for (const a of allies) (give(state, b, caller, a, { kind: "retreat" }, { bonus: ALLY_ORDER.ODDS.evac, quiet: true }) ? go : stay).push(first(a.name));
  const list = (xs) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  if (go.length) say(b, `Your allies pull out with you: ${list(go)} head${go.length === 1 ? "s" : ""} for the way out.`, "info");
  if (stay.length) say(b, `${list(stay)} stay${stay.length === 1 ? "s" : ""} behind to fight on.`, "info");
  return go.length;
}

// ---------- the ally's turn (combat.js aiUnit) ----------
// What an ally with an order fights (thirdside.js thirdFoes, all: its usual foes): an attack the target and whatever is
// next to them; a push what is near the cell (and next to them); anything else all of them.
export function allyFoes(b, u, all) {
  const o = u.aorder;
  if (!o || o.fake || !u.ally) return all;
  const close = all.filter((f) => cheb(u.x, u.y, f.x, f.y) <= 1);
  if (o.kind === "attack") {
    const t = o.target != null ? unitById(b, o.target) : null;
    return t && active(t) ? [t, ...close.filter((f) => f !== t)] : all;
  }
  if (o.kind === "push" && o.x != null) return all.filter((f) => close.includes(f) || Math.hypot(f.x - o.x, f.y - o.y) <= ALLY_ORDER.PUSH.r);
  return all;
}

// endPlayerTurn: an ally on an overwatch order keeps watching through the enemy's turn (the others' watch ends).
export const allyKeepsWatch = (u) => !!(u && u.ow && u.ally && u.side === "third" && u.aorder && u.aorder.kind === "overwatch" && !u.aorder.fake);

function endOrder(b, u, line) {
  delete u.aorder;
  if (line) say(b, line, "info");
  b.rev = (b.rev || 0) + 1;
}

// Step by step (an action each, moveMob tiles) toward the goal cells: the cell nearest them by the walking field it can
// stand on. Stops within `near` tiles (Chebyshev) of the first goal, or when no step gets nearer. Returns true when
// it moved.
function goTo(b, u, goals, near = 0, keep = 0) {
  if (!goals.length) return false;
  const field = distField(b, goals, null);
  const [gx, gy] = goals[0];
  let moved = false;
  for (let k = 0; k < 4 && u.ap > keep && active(u); k++) {
    if (goals.length === 1 && cheb(u.x, u.y, gx, gy) <= near) break;
    const r = reachable(b, u, moveMob(u));
    const here = field[u.y * b.w + u.x];
    let best = -1;
    for (const i of r.reached) {
      if (!isFinite(r.dist[i]) || r.dist[i] <= 0 || !isFinite(field[i])) continue;
      if (best < 0 || field[i] < field[best] || (field[i] === field[best] && r.dist[i] < r.dist[best])) best = i;
    }
    if (best < 0 || !(field[best] < here)) break;
    u.ap -= 1;
    u.hunker = false;
    moveAlong(b, u, pathTo(r, best % b.w, (best / b.w) | 0));
    moved = true;
  }
  return moved;
}
// Fight from where they stand: a shot at the best of foes, a blow at one next to them, an empty gun reloaded. True
// when it did something (the turn's attack ends it).
function standFight(b, u, foes) {
  for (let step = 0; step < 3 && u.ap > 0 && active(u); step++) {
    const live = foes.filter((f) => active(f));
    if (!live.length) return false;
    const adj = live.filter((f) => meleeReach(b, u, f));
    if (!canFire(b, u)) {
      if (isRanged(u) && !u.jam && reloadAI(b, u)) continue;
      if (adj.length) { strike(b, u, adj[0]); u.ap = 0; return true; }
      return false;
    }
    const shot = bestShot(b, u, live);
    if (shot) { fire(b, u, shot.t); u.ap = 0; return true; }
    if (adj.length) { strike(b, u, adj[0]); u.ap = 0; return true; }
    return false;
  }
  return false;
}
// The end of a turn spent holding: on watch with a gun that can fire (the watch ends with the enemy's turn as theirs does).
function watch(b, u) {
  if (u.ap > 0 && canFire(b, u) && !u.stun) u.ow = true;
  u.ap = 0;
}
const adjFoes = (b, u, foes) => foes.filter((f) => active(f) && cheb(u.x, u.y, f.x, f.y) <= 1);
// Getting nearer: the order's best walking distance so far (o.best); STUCK turns with none: false (given up).
function progress(b, u, o, d) {
  if (o.best == null || d < o.best - 0.01) { o.best = d; o.stuck = 0; return true; }
  o.stuck = (o.stuck || 0) + 1;
  return o.stuck < ALLY_ORDER.STUCK;
}

// The way out for a retreat: the nearest cell of an extraction zone or of the map's edge by walking (upstairs: the
// stairs). [x, y] or null.
function exitCells(b, u) {
  if ((u.f || 0) > 0) return (b.raid && b.raid.stairs ? b.raid.stairs : []).filter(([x, y]) => inBounds(b, x, y) && walkAt(b, y * b.w + x));
  const out = [];
  if (b.raid) for (const z of b.raid.zones) for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) if (inBounds(b, x, y) && walkAt(b, y * b.w + x)) out.push([x, y]);
  for (let x = 0; x < b.w; x++) for (const y of [0, b.h - 1]) if (walkAt(b, y * b.w + x)) out.push([x, y]);
  for (let y = 1; y < b.h - 1; y++) for (const x of [0, b.w - 1]) if (walkAt(b, y * b.w + x)) out.push([x, y]);
  return out;
}
function wayOut(b, u) {
  const cells = exitCells(b, u);
  if (!cells.length) return null;
  const field = distField(b, [[u.x, u.y]], null);
  let best = null, bd = Infinity;
  for (const c of cells) { const d = field[c[1] * b.w + c[0]]; if (d < bd) { bd = d; best = c; } }
  return best;
}
const atExit = (b, u) => !(u.f || 0) && (zoneAt(b, u.x, u.y) >= 0 || u.x === 0 || u.y === 0 || u.x === b.w - 1 || u.y === b.h - 1);

// combat.js aiUnit, before thirdside.js thirdPlan: an ally with an order plays it. True when the turn is done; false:
// the usual AI goes on with the actions left (an attack: thirdFoes narrowed by allyFoes).
export function allyTurn(b, u) {
  const o = u.aorder;
  if (!o) return false;
  if (!isAlly(u)) { delete u.aorder; return false; }
  if (o.fake) return false; // a treacherous group: their own call, whatever they said
  const A = first(u.name);
  const all = thirdFoes(b, u, true);
  switch (o.kind) {
    case "attack": {
      const t = o.target != null ? unitById(b, o.target) : null;
      if (!t || !active(t) || !enemyOf(t) || (t.f || 0) !== (u.f || 0)) { endOrder(b, u, t && (t.dead || t.down) ? `${A}: "${first(t.name)} is down." Back to their own call.` : `${A} has lost the target and goes back to their own call.`); return false; }
      if (canSee(b, u, t)) o.seenAt = b.turn || 0;
      else if ((b.turn || 0) - (o.seenAt ?? o.since) >= ALLY_ORDER.LOST) { endOrder(b, u, `${A} has lost sight of ${first(t.name)} and goes back to their own call.`); return false; }
      return false; // the usual AI, against the target (allyFoes)
    }
    case "move": case "push": {
      const push = o.kind === "push";
      if (o.there && cheb(u.x, u.y, o.x, o.y) > (push ? ALLY_ORDER.PUSH.leash : 1)) { o.there = false; o.best = null; } // off it (shoved; a push fighting too far off): back to it
      if (!o.there) {
        const adj = adjFoes(b, u, all);
        if (adj.length && !push && standFight(b, u, adj)) return true; // cornered on the way
        if (push) { // on the way: a fair shot at what is near the cell
          const near = allyFoes(b, u, all);
          const shot = near.length ? bestShot(b, u, near) : null;
          if (shot && shot.o.chance >= ALLY_ORDER.PUSH.fair) { fire(b, u, shot.t); u.ap = 0; return true; }
        }
        goTo(b, u, [[o.x, o.y]]);
        const there = (u.x === o.x && u.y === o.y) || (cheb(u.x, u.y, o.x, o.y) <= 1 && takenAt(b, o.x, o.y, u));
        if (there) { o.there = true; o.stuck = 0; say(b, `${A} is in position.`, "info"); b.rev = (b.rev || 0) + 1; }
        else if (!progress(b, u, o, distField(b, [[o.x, o.y]], null)[u.y * b.w + u.x])) { endOrder(b, u, `${A} cannot get through to the spot and gives up on it.`); return false; }
      }
      if (!active(u) || u.ap <= 0) { u.ap = 0; return true; }
      if (push && o.there) return false; // the usual AI against what is near the cell
      if (!standFight(b, u, push ? allyFoes(b, u, all) : all)) watch(b, u);
      u.ap = 0;
      return true;
    }
    case "overwatch": {
      const adj = adjFoes(b, u, all);
      if (adj.length && standFight(b, u, adj)) return true;
      if (!canFire(b, u) && isRanged(u) && !u.jam) reloadAI(b, u);
      faceToward(u, o.face[0], o.face[1]);
      if (canFire(b, u) && !u.stun) u.ow = true;
      else if (!isRanged(u) || (!u.jam && !canFire(b, u) && u.ap > 0)) { endOrder(b, u, `${A} has nothing left to fire and stops watching.`); u.ap = 0; return true; }
      u.ap = 0;
      return true;
    }
    case "hold": {
      if (!standFight(b, u, all)) watch(b, u);
      u.ap = 0;
      return true;
    }
    case "follow": case "cover": {
      const p = o.by != null ? unitById(b, o.by) : null;
      if (!p || !activeAny(p) || p.left) { endOrder(b, u, `${A} has nobody to ${o.kind === "cover" ? "cover" : "follow"} now and goes back to their own call.`); return false; }
      const adj = adjFoes(b, u, all);
      if (adj.length && standFight(b, u, adj)) return true;
      if ((p.f || 0) === (u.f || 0) && cheb(u.x, u.y, p.x, p.y) > ALLY_ORDER.FOLLOW.far) goTo(b, u, [[p.x, p.y]], ALLY_ORDER.FOLLOW.near);
      if (!active(u) || u.ap <= 0) { u.ap = 0; return true; }
      const first_ = o.kind === "cover" ? all.filter((f) => (f.f || 0) === (p.f || 0) && Math.hypot(f.x - p.x, f.y - p.y) <= ALLY_ORDER.COVER.r) : [];
      if (!(first_.length && standFight(b, u, first_)) && !standFight(b, u, all)) watch(b, u);
      u.ap = 0;
      return true;
    }
    case "retreat": {
      if (atExit(b, u)) return leave(b, u);
      if ((u.f || 0) > 0 && stairTop(b.cells[u.y * b.w + u.x])) { moveToFloor(b, u, (u.f || 0) - 1); u.ap = 0; return true; } // a stair run's top step (buildingmaps.js)
      const cells = exitCells(b, u);
      const before = [u.x, u.y];
      if (cells.length) goTo(b, u, cells);
      const c = wayOut(b, u);
      if (c) { o.x = c[0]; o.y = c[1]; }
      if (active(u) && atExit(b, u)) return leave(b, u);
      if (u.x === before[0] && u.y === before[1]) {
        const adj = adjFoes(b, u, all);
        if (adj.length && standFight(b, u, adj)) return true; // cornered
        if (!progress(b, u, o, Infinity) || !cells.length) { endOrder(b, u, `${A} cannot find a way out and fights on.`); return false; }
      } else { o.stuck = 0; }
      u.ap = 0;
      return true;
    }
    default:
      delete u.aorder;
      return false;
  }
}
function leave(b, u) {
  u.left = true; u.aleft = true; u.ap = 0; u.ow = false; u.hunker = false;
  say(b, `${u.name} gets off the map.`, "info");
  b.rev = (b.rev || 0) + 1;
  return true;
}

// ---------- Tell me what you see (info) ----------
// A snapshot of what ally a sees now (canSeeAt from them: range, light, line of sight; only within their view cone,
// VISION.HALF either side of their facing, and the cells next to them; the dead's all round), on their floor. Each
// thing on a cell your side does not see now becomes a mark in b.intel.marks: { x, y, f, kind, label, turn, by }
// (kind: zombie, person, container, item, body, door, window, vehicle). The marks inside this view replace the ones
// there before (any ally's); the rest stay. A mark never moves (a unit marked where it stood); it goes once your side
// sees its cell (allyIntelTick) and with the battle (allyOrdersEnd). The fog itself is not touched.
const INTEL_DOOR = { door: "a locked door", idoor: "a door", odoor: "an open door", bdoor: "a barred door", doorway: "a broken door" };
const INTEL_WINDOW = { window: "a window", smashed: "a broken window" };
const article = (w) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);
const boxLabel = (c) => { const w = String(c.label || c.kind || "container").split(": ").pop().toLowerCase().replace(/^(a|an|the) /, ""); return c.lock && !c.lock.open ? `a locked ${w}` : article(w); };
function viewOf(b, a) {
  const cone = hasFront(a);
  const seen = new Set();
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const near = cheb(a.x, a.y, x, y) <= 1;
    if (!near && cone && !inArc(a, x, y, VISION.HALF)) continue;
    if ((x === a.x && y === a.y) || canSeeAt(b, a, x, y)) seen.add(y * b.w + x);
  }
  return seen;
}
function snapshot(b, a) {
  const seen = viewOf(b, a), vis = playerVision(b), f = a.f || 0, turn = b.turn || 0, out = [], had = new Set();
  const fog = (x, y) => inBounds(b, x, y) && seen.has(y * b.w + x) && !vis[y * b.w + x];
  const add = (x, y, kind, label) => { const k = `${x},${y},${kind}`; if (had.has(k)) return; had.add(k); out.push({ x, y, f, kind, label, turn, by: a.id }); };
  for (const t of b.units) {
    if (t === a || t.dead || t.left || t.fled || t.off || (t.f || 0) !== f || t.side === "player" || !fog(t.x, t.y) || !canSee(b, a, t)) continue;
    if (t.kind === "zombie") add(t.x, t.y, "zombie", t.boss ? "something big" : "one of the dead");
    else if (t.kind === "human") add(t.x, t.y, "person", "a person");
  }
  const L = lootLayer(b);
  for (const c of (L && L.containers) || []) {
    if ((c.f || 0) !== f || c.searched || c.cart) continue;
    let at = null;
    for (let y = c.y; y < c.y + (c.h || 1) && !at; y++) for (let x = c.x; x < c.x + (c.w || 1) && !at; x++) if (fog(x, y)) at = [x, y];
    if (!at) continue;
    if (c.kind === "body") add(at[0], at[1], "body", "a body");
    else if (c.kind === "ground") add(at[0], at[1], "item", "something on the ground");
    else if (c.kind === "car" || c.kind === "miltruck") add(at[0], at[1], "vehicle", c.kind === "car" ? "a car" : "a truck");
    else add(at[0], at[1], "container", boxLabel(c));
  }
  const locked = new Set(doorsOf(b).filter((d) => (d.f || 0) === f && d.lock && !d.lock.open).map((d) => d.y * b.w + d.x));
  for (const i of seen) {
    const x = i % b.w, y = (i / b.w) | 0;
    if (vis[i]) continue;
    const k = b.cells[i].k;
    if (INTEL_DOOR[k]) add(x, y, "door", k === "idoor" && locked.has(i) ? "a locked door" : INTEL_DOOR[k]);
    else if (INTEL_WINDOW[k]) add(x, y, "window", INTEL_WINDOW[k]);
  }
  const hv = b.raidHumvee;
  if (hv && !hv.gone && !f) { for (let y = hv.y; y < hv.y + (hv.h || 1); y++) for (let x = hv.x; x < hv.x + (hv.w || 1); x++) if (fog(x, y)) { add(x, y, "vehicle", "their vehicle"); y = Infinity; break; } }
  return { seen, marks: out };
}
const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const num = (n) => NUM[n] || String(n);
const SAY = {
  zombie: (n) => (n === 1 ? "one of the dead" : `${num(n)} of the dead`), person: (n) => (n === 1 ? "someone" : `${num(n)} people`),
  door: (n) => (n === 1 ? "a door" : `${num(n)} doors`), window: (n) => (n === 1 ? "a window" : `${num(n)} windows`),
  container: (n) => (n === 1 ? "something to search" : `${num(n)} things to search`), item: (n) => (n === 1 ? "something on the ground" : `${num(n)} piles on the ground`),
  body: (n) => (n === 1 ? "a body" : `${num(n)} bodies`), vehicle: (n) => (n === 1 ? "a vehicle" : `${num(n)} vehicles`),
};
function tellIntel(b, a, fake = false) {
  const A = first(a.name);
  const view = b.floors ? b.floor || 0 : null;
  if (b.floors && (a.f || 0) !== view) setFloor(b, a.f || 0);
  try {
    const I = b.intel || (b.intel = { marks: [] });
    if (fake) { say(b, `${A}: "Quiet out there."`, "info"); return; } // a treacherous ally tells you nothing worth having
    const { seen, marks } = snapshot(b, a);
    const f = a.f || 0;
    I.marks = I.marks.filter((m) => m.f !== f || !seen.has(m.y * b.w + m.x)).concat(marks);
    const n = {};
    for (const m of marks) n[m.kind] = (n[m.kind] || 0) + 1;
    const parts = Object.keys(SAY).filter((k) => n[k]).map((k) => SAY[k](n[k]));
    const list = parts.length < 3 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    say(b, parts.length ? `${A}: "${list[0].toUpperCase()}${list.slice(1)}."` : `${A}: "Nothing you can't see already."`, "info");
    b.rev = (b.rev || 0) + 1;
  } finally { if (b.floors && (b.floor || 0) !== view) setFloor(b, view); }
}
// The marks your allies told you of (the "?" shadows in your fog of war): [{ x, y, f, kind, label, turn, by }].
export function allyIntel(b) {
  return b && b.intel && !b.over ? b.intel.marks.map((m) => ({ ...m })) : [];
}
// combat.js, after each action and at the start of your turn: the marks on cells your side sees now are dropped (the
// real view replaces them). Only the floor looked at (the others when they are).
export function allyIntelTick(b) {
  if (!b || !b.intel || !b.intel.marks.length) return;
  const vis = playerVision(b), f = b.floor || 0;
  const keep = b.intel.marks.filter((m) => m.f !== f || !vis[m.y * b.w + m.x]);
  if (keep.length !== b.intel.marks.length) { b.intel.marks = keep; b.rev = (b.rev || 0) + 1; }
}

// ---------- the map (the UI) ----------
// An ally's order as your people know it, for the map: null, or { kind, label, icon, x, y, targetId, face: [x, y] |
// null, by: unit id, since: turn, heeded: bool }. x, y: where it goes (move, push, retreat's way out), else null.
export function allyOrderOf(b, a) {
  if (!b || !isAlly(a) || !activeAny(a) || !a.aorder) return null;
  const o = a.aorder, K = kindOf(o.kind);
  if (!K) return null;
  return {
    kind: o.kind, label: K.label, icon: ALLY_ORDER.ICON[o.kind] || "",
    x: o.x ?? null, y: o.y ?? null, targetId: o.target ?? null, face: o.face ? [o.face[0], o.face[1]] : null,
    by: o.by ?? null, since: o.since ?? 0, heeded: true,
  };
}

// Every ally with an order your people gave and know of (for the map's markers and cones):
// [{ allyId, ...allyOrderOf(b, ally), from: [x, y] }].
export function allyOrdersShown(b) {
  if (!b || !b.units) return [];
  const out = [];
  for (const a of b.units) {
    const o = a.aorder ? allyOrderOf(b, a) : null;
    if (o) out.push({ allyId: a.id, ...o, from: [a.x, a.y] });
  }
  return out;
}

// ---------- after the raid ----------
// parley.js parleyEnd (endRaid): each group's count of its people who died under an order of yours and who got out by
// one (rec.aorders), and every order off the units.
export function allyOrdersEnd(b) {
  if (!b || !b.units) return;
  for (const u of b.units) {
    const rec = u.pk ? recOf(b, u) : null;
    if (rec && (u.aorder || u.aleft)) {
      const R = rec.aorders || (rec.aorders = { given: 0, heeded: 0, dead: 0, out: 0 });
      if (u.dead && u.aorder && !u.aorder.fake) R.dead++;
      if (u.aleft && !u.dead) R.out++;
    }
    delete u.aorder;
  }
  if (b.intel) b.intel = null; // the marks go with the battle
}
// parley.js parleyGoodwill: their people who died following your orders cost a little goodwill (GOODWILL), and a
// wanderer group remembers it.
export function allyOrdersGoodwill(state, result) {
  const G = ALLY_ORDER.GOODWILL;
  for (const r of (result && result.parley) || []) {
    const n = r.orders ? r.orders.dead || 0 : 0;
    if (!n || r.brokeTruce) continue;
    const f = r.factionId != null ? factionById(state, r.factionId) : null;
    if (f && f.alive) changeGoodwill(state, f, Math.max(G.max, n * G.dead), "their people died following your orders");
    const g = r.wid != null ? groupById(state, r.wid) : null;
    if (g) g.fought = Math.max(0, (g.fought || 0) - n * G.fought);
  }
}
