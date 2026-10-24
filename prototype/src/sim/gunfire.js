// @ts-check
// How guns fire (docs/weapons-overhaul-plan.md sections 14 and 20): fire modes, jams and misfires, suppressing fire's
// cone, over-penetration's line, the sniper's AI sense. combat.js fire() / combatAct / aiUnit / moveAlong call these;
// the numbers are all here.
//
// Fire modes (act "firemode", u.mode / u.modes): WEAPONS[k].modes = { single, burst, auto }: { rounds, aim } (rounds a
// trigger pull, the mode's aim for that gun: data-guns.js, the roster's shape). Also read: { single: 1, burst: 2 }
// (rounds only, the aim from FIRE_MODES) and a list of names (rounds then from w.burst / w.auto or FIRE_MODES). A gun
// without modes (semi-automatic, single only) fires w.ammo rounds with one roll, as it always did. Each round of a
// burst or a stream rolls its own hit at the mode's aim, worse by the recoil (FIRE_MODES) every round after the first. A unit starts in the mode that fires what its gun fired before
// modes (the assault rifle's 2-round shot is its burst), else burst, else single.
//
// Jams (u.jam = { kind, ap }): per round, jam = rel% × quality × condition × ammo × mods × weather × fouling, capped at 12%:
//   quality 1 + 2 × (1 − q) (q: the gun's quality; enemies u.q 0.4–0.85), condition 1 + (1 − dur / durMax) (enemies u.cond),
//   ammo: factory 1, handloads 2.5 − 1.5 × hq, old 3 (u.loadCond / u.loadHq: the loaded box's cond), × the type's jam,
//   mods: × each attachment's jam (gunmods.js gunMods jam), weather: rain or mud 1.3, a storm 1.5 (outdoors only),
//   fouling: 1 + min(0.5, item.fouled / 400) (rounds fired since it was cleaned).
// A trigger pull of n rounds jams with 1 − (1 − p)^n at a random round: the rounds before it fire, that one is lost.
// Kinds: stovepipe 70% (Unjam 1 action), double feed 25% (Unjam 2, or a Reload clears it: the magazine dropped), hard
// jam 5% (2 actions, −0.05 quality). Revolvers, double-barrels, bolt, lever and pump guns misfire instead: the round
// is a dud and the action is lost, no jam.
import { itemDur, itemDurMax } from "./crafting.js";
import { AMMO_TYPES, RELOAD_FX } from "./data-ammo.js";
import { bareType } from "./rounds.js";
import { noteHandLoad, noteHandQ } from "./reloading.js"; // the bench's handloads: the round fired next and its make
import { WEAPON_PLATFORM } from "./data-gunmods.js";
import { unitMods, gunMods, modRange, NO_MODS } from "./gunmods.js";
import { weather } from "./weather.js";
import { battleDice } from "./armour.js";
import { hash01 } from "./skills.js";
import { COND_SOURCES, kitSource } from "./itemcond.js";
import { WEAPONS, CELL, magIn, magCap, loadMag, reload, reloadRefusal, say, isRanged, canSeeAt, unitAt, sightRange } from "./combat.js";
import { isStacked } from "./mags.js"; // call-time only (the import cycle through combat.js)

export const FIRE_MODES = {
  single: { name: "Single", aim: 0, recoil: 0, rounds: 1 },
  burst: { name: "Burst", aim: -10, recoil: -10, rounds: 3 },
  auto: { name: "Full auto", aim: -20, recoil: -3, rounds: 12 },
};
export const MODE_ORDER = ["single", "burst", "auto"];

// The modes a weapon has, as { mode: rounds } (null: a gun without modes, or no gun).
export function gunModes(w) {
  if (!w || w.melee || !w.modes) return null;
  /** @type {Record<string, number>} */
  const out = {};
  if (Array.isArray(w.modes)) {
    for (const m of w.modes) if (FIRE_MODES[m]) out[m] = m === "single" ? 1 : w[m] || FIRE_MODES[m].rounds;
  } else for (const m of MODE_ORDER) {
    const v = w.modes[m];
    const n = v && typeof v === "object" ? v.rounds : v; // { rounds, aim } (the roster's shape) or a number of rounds
    if (n) out[m] = Math.max(1, Math.round(n));
  }
  if (!Object.keys(out).length) return null;
  return out;
}
// The unit's modes (names, in order): ["single"] for a gun without modes, [] for no gun.
export function modesOf(u) {
  const w = WEAPONS[u.weapon];
  if (!w || w.melee || !isRanged(u)) return [];
  const m = gunModes(w);
  return m ? MODE_ORDER.filter((k) => m[k]) : ["single"];
}
function defaultMode(w) {
  const m = gunModes(w);
  if (!m) return "single";
  if (w.mode0 && m[w.mode0]) return w.mode0;
  const same = MODE_ORDER.find((k) => m[k] === (w.ammo || 1));
  return same || (m.burst ? "burst" : m.single ? "single" : MODE_ORDER.find((k) => m[k]) || "single");
}
// u.modes / u.mode for the weapon held now (a new weapon: its default mode).
export function syncModes(u) {
  if (!u || u.modesW === u.weapon) return u;
  u.modesW = u.weapon;
  u.modes = modesOf(u);
  const w = WEAPONS[u.weapon];
  u.mode = u.modes.includes(u.mode) ? u.mode : w ? defaultMode(w) : "single";
  if (!u.modes.includes(u.mode)) u.mode = u.modes[0] || "single";
  return u;
}
export const modeOf = (u) => (syncModes(u), u.mode || "single");
// Rounds a trigger pull fires in a mode (without modes: w.ammo, one roll).
export function modeRounds(u, mode = modeOf(u)) {
  const w = WEAPONS[u.weapon];
  const m = gunModes(w);
  if (!m) return w ? w.ammo || 0 : 0;
  return m[mode] || m.single || w.ammo || 1;
}
// Hit rolls a trigger pull makes (a gun without modes: one, whatever its rounds).
export const modeRolls = (u, mode = modeOf(u)) => (gunModes(WEAPONS[u.weapon]) ? modeRounds(u, mode) : 1);
// The aim a mode starts at for a weapon (w.modes[mode].aim; else FIRE_MODES'; single: 0).
export function gunModeAim(w, mode) {
  const v = w && w.modes && !Array.isArray(w.modes) ? w.modes[mode] : null;
  if (v && typeof v === "object" && Number.isFinite(v.aim)) return v.aim;
  return mode === "single" ? 0 : (FIRE_MODES[mode] || FIRE_MODES.single).aim;
}
// Aim of round k (0 = the first) in a mode (w: the weapon, for its own mode aim; else FIRE_MODES').
export const modeAim = (mode, k = 0, w = null) => { const M = FIRE_MODES[mode] || FIRE_MODES.single; return mode === "single" ? gunModeAim(w, "single") : gunModeAim(w, mode) + k * M.recoil; };
// Why the unit cannot take that mode ("" when it can).
export function modeRefusal(u, mode) {
  if (!FIRE_MODES[mode]) return "Unknown fire mode.";
  const list = modesOf(u);
  if (!list.length) return "No gun.";
  if (!list.includes(mode)) return `The ${(u.weaponName || WEAPONS[u.weapon].name)} has no ${FIRE_MODES[mode].name.toLowerCase()} mode.`;
  return "";
}

// ---------- jams ----------
export const JAM = {
  CAP: 0.12,
  KINDS: [{ kind: "stovepipe", p: 0.7, ap: 1, name: "stovepipe" }, { kind: "double", p: 0.25, ap: 2, name: "double feed" }, { kind: "hard", p: 0.05, ap: 2, name: "hard jam" }],
  HARD_Q: 0.05, Q_MIN: 0.4,
  COND: 1, // × 1 + COND × (1 − dur / durMax): a worn gun (section 25 durability) jams more, up to twice as often
  ENEMY_COND: [0.3, 1], // an enemy gun's durability share (own dice; the looted gun keeps it)
  AMMO: { factory: 1, old: 3 }, HAND: [2.5, 1.5], // handloads: 2.5 − 1.5 × hq
  WX: { rain: 1.3, snow: 1.3, storm: 1.5, blizzard: 1.5 }, MUD: 0.5, // mud at least this deep counts as rain
  FOUL: 400, FOUL_MAX: 0.5,
  ENEMY_Q: [0.4, 0.85], DEFAULT_Q: 0.7,
};
// Guns that misfire rather than jam: revolvers, double-barrels, bolt, lever and pump actions (and the single-shot pipe gun).
export const MISFIRE_KEYS = new Set(["revolver", "shotgun", "huntrifle", "leverrifle", "pipegun", "dbshotgun", "sawnoff", "sniper"]);
export const MISFIRE_PLATFORMS = new Set(["revolver", "pump", "bolt", "lever", "dbl", "double", "break", "single", "pipe"]);
export function misfires(key) {
  const w = WEAPONS[key];
  if (w && w.misfire != null) return !!w.misfire;
  return MISFIRE_KEYS.has(key) || MISFIRE_PLATFORMS.has(WEAPON_PLATFORM[key]);
}
export const jamKind = (kind) => JAM.KINDS.find((k) => k.kind === kind) || JAM.KINDS[0];

// The gun's quality 0–1 (q): your gun's quality (never above a qmax); others u.q.
export function gunQ(u) {
  const it = u.item;
  if (!it) return u.q ?? JAM.DEFAULT_Q;
  return Math.max(0, Math.min(1, it.quality ?? 1, it.qmax ?? 1));
}
// The gun's condition 0–1 (c): durability left of its own maximum (crafting.js itemDur / itemDurMax); others u.cond.
export function gunCond(u) {
  const it = u.item;
  if (!it) return u.cond ?? 1;
  const d = itemDur(it), m = itemDurMax(it);
  return d == null || !m ? 1 : Math.max(0, Math.min(1, d / m));
}
// The gun looted from an enemy body (inventory.js enemyBody): the quality and condition it fought in.
export function lootGun(u, item) {
  if (!u || !item || u.weapon !== item.key) return;
  if (u.q != null) item.quality = u.q;
  const m = itemDurMax(item);
  if (u.cond != null && m) item.dur = Math.max(1, Math.round(m * u.cond));
}
// An enemy's gun condition, rolled on its own dice (combat.js enemyUnit; the gun looted from them keeps it). With
// their kit (combat.js KITS), in the ranges of the bodies that kit leaves (itemcond.js kitSource, COND_SOURCES: a
// soldier's rifle looked after, a raider's not), as every other looted item; with none, JAM.ENEMY_Q / ENEMY_COND.
const kitRange = (kit, key, fallback) => (kit && COND_SOURCES[kitSource(kit)] ? COND_SOURCES[kitSource(kit)][key] : fallback);
export const enemyGunQ = (seed, id, kit = null) => { const [lo, hi] = kitRange(kit, "q", JAM.ENEMY_Q); return Math.round((lo + (hi - lo) * hash01("enemygunq", seed, id)) * 100) / 100; };
export const enemyGunCond = (seed, id, kit = null) => { const [lo, hi] = kitRange(kit, "d", JAM.ENEMY_COND); return Math.round((lo + (hi - lo) * hash01("enemyguncond", seed, id)) * 100) / 100; };
export function ammoJam(u) {
  const c = u.loadCond || "factory";
  let f = c === "hand" ? JAM.HAND[0] - JAM.HAND[1] * Math.max(0, Math.min(1, u.loadHq ?? 0.5)) : JAM.AMMO[c] ?? 1;
  if (c === "hand") f *= (1 + (RELOAD_FX.BLACK_JAM - 1) * (u.loadBp || 0)) * (1 + (RELOAD_FX.MATCH_JAM - 1) * (u.loadMp || 0)); // reloading.js: black powder, match-head primers (their share)
  const t = u.load && AMMO_TYPES[bareType(u.load)]; // (a load of another calibre: "223:fmj", rounds.js)
  return f * ((t && t.jam) || 1);
}
export function modJam(u) {
  const gm = unitMods(u);
  if (gm !== NO_MODS) return gm.jam ?? 1;
  const mods = u.item ? u.item.mods : u.modItems;
  return mods ? gunMods({ key: u.weapon, mods }).jam ?? 1 : 1; // gunmods.js: × each part's jam (section 5: suppressors 1.2–1.4, drum 1.5, oil filter 1.5)
}
export const foulOf = (u) => (u.item ? u.item.fouled : u.fouled) || 0;
export const foulJam = (u) => 1 + Math.min(JAM.FOUL_MAX, foulOf(u) / JAM.FOUL);
// Outdoors the weather counts (b.jamWx, noted once a battle: noteJamWeather); inside a building it does not.
export function weatherJam(b, u) {
  if (!b || !b.jamWx || b.jamWx === 1) return 1;
  const c = b.cells && b.w ? b.cells[u.y * b.w + u.x] : null;
  return c && c.f === "floor" ? 1 : b.jamWx;
}
export function jamWeather(state, b) {
  if (!state || !b || b.tileId == null) return 1;
  let w;
  try { w = weather(state, state.hour, b.tileId); } catch { return 1; }
  if (!w) return 1;
  return JAM.WX[w.key] || (w.mud >= JAM.MUD ? JAM.WX.rain : 1);
}
export function noteJamWeather(state, b) {
  if (b && b.jamWx == null) b.jamWx = jamWeather(state, b);
  if (b && b.handQ == null) noteHandQ(state, b); // reloading.js: the colony's handload makes, once a battle
  if (b && b.units) for (const u of b.units) if (u.side === "player" && !u.dead) noteHandLoad(b, u); // the marks for the next round (aim, noise)
}
// Per-round jam (or misfire) chance of this unit's gun now.
export function jamChance(b, u) {
  const w = WEAPONS[u.weapon];
  if (!w || w.melee || !w.rel) return 0;
  const fq = 1 + 2 * (1 - gunQ(u)), fc = 1 + JAM.COND * (1 - gunCond(u));
  return Math.min(JAM.CAP, (w.rel / 100) * fq * fc * ammoJam(u) * modJam(u) * weatherJam(b, u) * foulJam(u)) * (b && b.failures != null ? b.failures : 1); // worldcfg.js: the run's Failures dial (on the battle)
}
// One trigger pull of n rounds: { fired, spent, jam: kind | null, misfire }.
export function rollTrigger(b, u, n) {
  if (u.side === "player") noteHandLoad(b, u); // reloading.js: a handload next? its make sets u.loadCond / loadHq
  const p = jamChance(b, u);
  if (!(p > 0) || n <= 0) return { fired: n, spent: n, jam: null, misfire: false };
  const pn = 1 - Math.pow(1 - p, n);
  if (battleDice(b, "jam") >= pn) return { fired: n, spent: n, jam: null, misfire: false };
  if (misfires(u.weapon)) return { fired: 0, spent: 1, jam: null, misfire: true };
  const k = Math.min(n - 1, Math.floor(battleDice(b, "jamat") * n));
  const r = battleDice(b, "jamkind");
  let acc = 0, kind = JAM.KINDS[0].kind;
  for (const J of JAM.KINDS) { acc += J.p; if (r < acc) { kind = J.kind; break; } }
  return { fired: k, spent: k + 1, jam: kind, misfire: false };
}
// The gun jams (fire): u.jam, a hard jam costs condition, overwatch ends.
export function jamGun(b, u, kind) {
  const J = jamKind(kind);
  u.jam = { kind: J.kind, ap: J.ap };
  u.ow = false;
  if (J.kind === "hard") {
    if (u.item) { const q = u.item.quality ?? 1; u.item.quality = Math.round(Math.max(Math.min(q, JAM.Q_MIN), q - JAM.HARD_Q) * 100) / 100; }
    else if (u.q != null) u.q = Math.round(Math.max(Math.min(u.q, JAM.Q_MIN), u.q - JAM.HARD_Q) * 100) / 100;
  }
}
export const jamLabel = (u) => (u && u.jam ? `Jammed (${jamKind(u.jam.kind).name})` : "");
export const jamRefusal = (u) => (u && u.jam ? `${jamLabel(u)}: Unjam (J)${u.jam.kind === "double" ? " or Reload" : ""}, ${u.jam.ap} action${u.jam.ap === 1 ? "" : "s"}.` : "");
// Rounds through the gun since it was cleaned.
export function foul(u, n) {
  if (!(n > 0)) return;
  if (u.item) u.item.fouled = (u.item.fouled || 0) + n;
  else u.fouled = (u.fouled || 0) + n;
}
export const unjamRefusal = (u) => (!u.jam ? "The gun is not jammed." : "");
// Unjam (act "unjam"): its actions, as many as the unit has (a 2-action jam can be worked at over two turns).
export function unjam(b, u) {
  if (!u.jam) return false;
  const J = jamKind(u.jam.kind);
  const spend = Math.max(0, Math.min(u.ap, u.jam.ap));
  u.ap -= spend;
  u.jam.ap -= spend;
  u.hunker = false;
  if (u.jam.ap <= 0) { u.jam = null; say(b, `${u.name} clears the ${J.name}.`, "info"); return true; }
  say(b, `${u.name} works at the ${J.name} (${u.jam.ap} more action${u.jam.ap === 1 ? "" : "s"}).`, "info");
  return false;
}
// Reload with a double feed: the magazine is dropped and a fresh one goes in (the caller's reload fills it). False when
// it cannot be (not a double feed, nothing to load).
export function jamReload(b, u) {
  if (!u.jam || u.jam.kind !== "double") return false;
  const keep = magIn(u);
  const phys = isStacked(u); // physical rounds (mags.js, the same test as reloadRefusal's): the magazine comes out with what is in it; reloadPlan lets a swap through on a double feed. Otherwise (a person whose gun in hand has no magazines tracked) the counter is emptied, or a full one would refuse the reload
  if (!phys) loadMag(u, 0);
  if (reloadRefusal(b, u)) { if (!phys) loadMag(u, keep); return false; }
  u.jam = null;
  say(b, `${u.name} rips the magazine out to clear the double feed.`, "info");
  return true;
}
// The AI's (both sides', the bots') jam: a double feed by a reload when it can, else Unjam with what actions it has.
export function aiUnjam(b, u) {
  if (!u.jam || u.ap < 1) return false;
  if (u.jam.kind === "double" && jamReload(b, u)) { reload(b, u); return true; }
  unjam(b, u);
  return true;
}

// ---------- the AI's fire mode ----------
// Enemies and the third side: a burst at a target (single at long range, or for a marksman), a stream on overwatch with
// a big magazine; single when the magazine is short of a burst. Your side keeps the mode you set.
export function aiMode(b, u, t, opts = {}) {
  const list = modesOf(u);
  if (list.length < 2) return;
  const w = WEAPONS[u.weapon];
  const left = magIn(u);
  const fits = (m) => list.includes(m) && left >= modeRounds(u, m);
  let mode = "single";
  if (w.sniper) mode = "single";
  else if (opts.reaction && fits("auto") && magCap(u) >= 60) mode = "auto";
  else if (fits("burst") && !(t && Math.hypot(u.x - t.x, u.y - t.y) > modRange(w, unitMods(u)).opt + 4 && list.includes("single"))) mode = "burst";
  else if (!list.includes("single") && fits("auto")) mode = "auto";
  if (!list.includes(mode)) mode = list[0];
  u.mode = mode;
}

// ---------- suppressing fire ----------
export const SUPPRESS = { AIM: 20, CONE: 25, CONE_AUTO: 32, RANGE: 8, HIT: 1 / 3, TURNS: 1 };
// Rounds a burst of suppressing fire takes: a full-auto stream, else two bursts (0: the gun cannot).
export function suppressRounds(u) {
  const m = gunModes(WEAPONS[u.weapon]);
  if (!m || !(m.burst || m.auto)) return 0;
  return m.auto ? m.auto : m.burst * 2;
}
export const suppressWide = (u) => { const m = gunModes(WEAPONS[u.weapon]); return !!(m && m.auto); };
// Why the unit cannot suppress now ("" when it can). fireRefusal: combat.js's (no gun, empty, out of ammo, jammed).
export function suppressRefusal(b, u, fireWhy) {
  if (!isRanged(u)) return "No gun.";
  if (u.jam) return jamRefusal(u);
  if (!suppressRounds(u)) return "Suppressing fire needs a gun that fires bursts or full auto.";
  if (fireWhy) return fireWhy;
  const need = Math.min(suppressRounds(u), modeRounds(u, "burst") || 2);
  if (magIn(u) < need) return "Too few rounds loaded for suppressing fire: reload first.";
  return "";
}
// The people in the cone from the shooter toward (x, y): living, human, in its sight and range, among its foes.
export function coneTargets(b, a, x, y, foes) {
  const w = WEAPONS[a.weapon];
  const half = ((suppressWide(a) ? SUPPRESS.CONE_AUTO : SUPPRESS.CONE) * Math.PI) / 180;
  const range = Math.min(sightRange(b, a), modRange(w, unitMods(a)).opt + SUPPRESS.RANGE);
  const dx = x - a.x, dy = y - a.y, d0 = Math.hypot(dx, dy);
  if (!d0) return [];
  return foes.filter((o) => {
    if (o.kind !== "human" || o.ztype || o.dead || o.down) return false;
    const ox = o.x - a.x, oy = o.y - a.y, d = Math.hypot(ox, oy);
    if (!d || d > range) return false;
    const cos = (ox * dx + oy * dy) / (d * d0);
    return cos >= Math.cos(half) && canSeeAt(b, a, o.x, o.y);
  });
}
// The aim point that pins the most people (an enemy's choice): { x, y, n } or null.
export function bestCone(b, a, foes) {
  let best = null;
  for (const t of foes) {
    if (t.kind !== "human" || t.ztype || !canSeeAt(b, a, t.x, t.y)) continue;
    const n = coneTargets(b, a, t.x, t.y, foes).filter((o) => !o.suppressed).length;
    if (n && (!best || n > best.n)) best = { x: t.x, y: t.y, n, t };
  }
  return best;
}

// ---------- over-penetration ----------
export const OVERPEN = { MULT: 0.6, RANGE: 8 };
// Cover a .50 or AP round goes through (crates, fences, car doors, the inside of a building's furniture and doors).
export const LIGHT_COVER = new Set(["crate", "fence", "car", "shelf", "cabinet", "counter", "table", "bed", "hay", "window", "rail", "barrel", "pump", "bars", "idoor", "odoor", "door", "rack", "locker", "tanktrap", "well"]);
// The next unit along the line from the shooter through t (either side): { unit, pierced } or null. Anything solid in
// between stops the round; light cover only when pierce (.50 or AP).
export function nextInLine(b, a, t, pierce) {
  const dx = t.x - a.x, dy = t.y - a.y, d = Math.hypot(dx, dy);
  if (!d) return null;
  const ux = dx / d, uy = dy / d;
  let pierced = false, lx = t.x, ly = t.y;
  for (let s = 0.25; s <= OVERPEN.RANGE; s += 0.25) {
    const cx = Math.floor(t.x + 0.5 + ux * s), cy = Math.floor(t.y + 0.5 + uy * s);
    if (cx === lx && cy === ly) continue;
    lx = cx; ly = cy;
    if (cx < 0 || cy < 0 || cx >= b.w || cy >= b.h) return null;
    const o = unitAt(b, cx, cy);
    if (o && o !== a && o !== t && !o.dead && !o.down && !o.left && !o.off) return { unit: o, pierced };
    const c = b.cells[cy * b.w + cx], C = CELL[c.k];
    if (!C) return null;
    if (C.cover > 0 || C.los || c.t) {
      if (pierce && LIGHT_COVER.has(c.k)) { pierced = true; continue; }
      return null;
    }
  }
  return null;
}
// The chance a hit carries on (AMMO_TYPES overpen by calibre: .50 always).
export function overpenChance(cal, type) {
  const T = type && AMMO_TYPES[type];
  return (T && T.overpen && cal && T.overpen[cal]) || 0;
}
export const piercesCover = (cal, type) => cal === "50bmg" || type === "ap" || type === "api";
// Heavy weapons' bracing (the roster agent's fields): brace = aim if the shooter moved this turn (a sniper rifle, the
// .50); heavy.brace = aim when the gun is rested (the machine gun on its bipod: on half cover next to the shooter in
// the shot's line, combat.js restCell; the bipod rule, user request 2026-10-08).
export function braceAim(b, a, rested = false) {
  const w = WEAPONS[a.weapon];
  if (!w || !b) return 0;
  const moved = a.movedT != null && a.movedT === b.turn;
  let v = 0;
  if (typeof w.brace === "number" && moved) v += w.brace;
  // A heavy gun rested (the machine gun's bipod): at least heavy.brace, not on top of a bipod's (gunmods.js
  // situationalAim adds the fitted or built-in bipod's brace, data-gunmods.js m249 builtin).
  if (w.heavy && typeof w.heavy.brace === "number" && rested) v += Math.max(0, w.heavy.brace - (unitMods(a).brace || 0));
  return v;
}
// The sniper's sense of a cell: far (10–15 tiles) from the nearest foe is good, close is bad.
export function sniperCell(nearest) {
  if (nearest >= 10 && nearest <= 15) return 10;
  if (nearest > 15) return 4;
  return nearest < 7 ? -(7 - nearest) * 4 : 0;
}
export const isSniper = (u) => !!(u && WEAPONS[u.weapon] && WEAPONS[u.weapon].sniper);
