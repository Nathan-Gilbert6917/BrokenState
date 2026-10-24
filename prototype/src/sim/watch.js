// The watch roster (a base's Defence tab): who stands guard at which hours, by name, whatever their role says.
//
// base.watch = { preset, shifts: [{ name, from, to, ids: [survivor id…] }] }   (no base.watch: no roster)
//   from / to: hours of the day (to may wrap past midnight: 22 → 6 is 22:00–06:00; from === to is all day).
//   ids: the people on that shift. Someone can stand more than one shift.
//
// Every hour the people on the shift that covers it, at that base and fit (not in a hospital bed, not badly hurt or
// ill: work.js healthRest; any illness by the Work tab's "Sick people rest", sickrest.js), stand guard (role "guard": they count in the walls' hold limit, defences.js guardHold,
// guard the cells, put down someone who turns, worm.js):
//   - People on work priorities (work.js planBase): the watch comes after health and the emergencies (a raid sends
//     everyone with Guard set to the walls anyway) and before the role's schedule, so a night watch replaces the
//     night's sleep; the task reads "On watch: Night (22–06)".
//   - Manual people (watchHour, after the stewards): their role is set to guard for the shift and given back after
//     (s.watchWas = { role, station, base }). At midnight they count at their own job (watchDayRoles), as people on
//     priorities on a guard watch do (work.js workDayRoles).
//   - Pinned people and anyone away from the base are left alone. The dev autopilot (which sets every role) skips the
//     Manual part: it keeps its own night watch (autopilot.js govWatch, base.watch.gov) and puts it on guard itself.
// A watch in someone's sleep hours keeps them up (sleep.js: tiredness; off a long watch they sleep in). At night a
// base with nobody awake on watch is caught asleep by an attack, and one with the watch up sees it coming sooner
// (surpriseAt, lookoutsSpot below).
import { atBase, baseById, hourOfDay, skill, isNight, baseVision, localId } from "./world.js";
import { manned, armoryDefence } from "./defences.js";
import { isManaged, healthRest } from "./work.js";
import { hash01 } from "./skills.js";
import { tiredLevel, TIRED } from "./sleep.js";
import { towerSees, towerSawText } from "./fieldworks.js"; // a manned watch tower out on the base's land
import { alarmOn } from "./electric.js"; // the perimeter alarm with power (2026-10-24): its sensors watch the approaches at night (call-time only)
import { ALARM } from "./data-power.js"; // ... this far out

export const WATCH_PRESETS = {
  two:   { name: "Two 12-hour watches", shifts: [["Day", 6, 18], ["Night", 18, 6]] },
  three: { name: "Three 8-hour watches", shifts: [["Morning", 6, 14], ["Evening", 14, 22], ["Night", 22, 6]] },
  four:  { name: "Four 6-hour watches", shifts: [["Dawn", 0, 6], ["Morning", 6, 12], ["Afternoon", 12, 18], ["Evening", 18, 0]] },
  night: { name: "Night watch only", shifts: [["Night", 20, 6]] },
};
export const SHIFT_MAX = 6; // a base's shifts (added by hand)

const hh = (h) => String(((h % 24) + 24) % 24).padStart(2, "0");
export const shiftText = (sh) => `${hh(sh.from)}–${hh(sh.to)}`;
export const shiftHours = (sh) => (sh.to === sh.from ? 24 : (sh.to - sh.from + 24) % 24);
export const inShift = (sh, h) => (sh.from === sh.to ? true : sh.from < sh.to ? h >= sh.from && h < sh.to : h >= sh.from || h < sh.to);

// The roster's shifts covering hour h (all of them: a person may stand two).
export const shiftsAt = (base, h) => (base && base.watch ? base.watch.shifts.filter((sh) => inShift(sh, h)) : []);
// The shift this person stands at hour h at this base, or null.
export function watchShift(base, s, h) {
  if (!base || !base.watch || !s) return null;
  return base.watch.shifts.find((sh) => inShift(sh, h) && sh.ids.includes(s.id)) || null;
}
// On watch now: rostered for this hour, here, alive, fit and not pinned.
export function onWatchNow(state, base, s, h = hourOfDay(state)) {
  if (!s || !s.alive || s.pinned || s.inBed || s.location.kind !== "base" || s.location.baseId !== base.id) return null;
  if (healthRest(s, state)) return null; // the ill rest too (sickrest.js)
  return watchShift(base, s, h);
}

// ---------- editing (the Defence tab) ----------
export function setWatchPreset(state, base, key) {
  if (!key || key === "none") { delete base.watch; return `${base.name}: no watch roster.`; }
  const p = WATCH_PRESETS[key];
  if (!p) return "";
  // People keep a shift that matches by name or by hours (switching two to three watches keeps the night watch).
  const old = base.watch ? base.watch.shifts : [];
  const shifts = p.shifts.map(([name, from, to]) => {
    const was = old.find((o) => o.name === name) || old.find((o) => o.from === from && o.to === to);
    return { name, from, to, ids: was ? was.ids.slice() : [] };
  });
  base.watch = { preset: key, shifts };
  return `${base.name}: ${p.name.toLowerCase()}.`;
}
export function addShift(state, base, from = 22, to = 6) {
  if (!base.watch) base.watch = { preset: null, shifts: [] };
  if (base.watch.shifts.length >= SHIFT_MAX) return `At most ${SHIFT_MAX} watches.`;
  base.watch.shifts.push({ name: `Watch ${base.watch.shifts.length + 1}`, from: clampH(from), to: clampH(to), ids: [] });
  base.watch.preset = null;
  return "";
}
export function removeShift(state, base, i) {
  if (!base.watch || !base.watch.shifts[i]) return "";
  base.watch.shifts.splice(i, 1);
  base.watch.preset = null;
  if (!base.watch.shifts.length) delete base.watch;
  return "";
}
const clampH = (h) => Math.max(0, Math.min(23, Math.round(Number(h) || 0)));
export function setShiftHours(state, base, i, from, to) {
  const sh = base.watch && base.watch.shifts[i];
  if (!sh) return "";
  if (from != null) sh.from = clampH(from);
  if (to != null) sh.to = clampH(to);
  base.watch.preset = null;
  return "";
}
export function renameShift(state, base, i, name) {
  const sh = base.watch && base.watch.shifts[i];
  const clean = String(name || "").trim().slice(0, 20);
  if (sh && clean) sh.name = clean;
}
// On or off a shift.
export function toggleWatch(state, base, i, sid) {
  const sh = base.watch && base.watch.shifts[i];
  if (!sh) return "";
  const s = state.survivors.find((x) => x.id === Number(sid));
  if (!s) return "";
  const k = sh.ids.indexOf(s.id);
  if (k >= 0) sh.ids.splice(k, 1); else sh.ids.push(s.id);
  return `${s.name.split(" ")[0]} ${k >= 0 ? "is off" : "stands"} the ${sh.name.toLowerCase()} watch (${shiftText(sh)}).`;
}
// Spread the people here over the shifts, best shots first, round the shifts in turn (perShift each, else as even
// as it goes). Night shifts first: the dark is when the walls need eyes.
export function fillWatch(state, base, perShift = 0, pick = null) {
  if (!base.watch || !base.watch.shifts.length) return "Pick a roster first.";
  const people = (pick || atBase(state, base.id).filter((s) => !s.pinned)).slice().sort((a, b) => skill(b, "shooting") - skill(a, "shooting") || a.id - b.id);
  const order = base.watch.shifts.map((sh, i) => ({ sh, i, night: [22, 23, 0, 1, 2, 3, 4].some((h) => inShift(sh, h)) })).sort((a, b) => b.night - a.night || a.i - b.i);
  for (const { sh } of order) sh.ids = [];
  const n = perShift || Math.max(1, Math.floor(people.length / Math.max(1, order.length * 3))); // about a third of them on the roster, at least one a watch
  let k = 0;
  for (let round = 0; round < n; round++) for (const { sh } of order) { if (k >= people.length) break; sh.ids.push(people[k++].id); }
  return `${base.name}: ${k} on the watch roster, ${n} a watch.`;
}
// People no longer with us leave the roster (dead, gone from the group).
export function pruneWatch(state, base) {
  if (!base.watch) return;
  for (const sh of base.watch.shifts) sh.ids = sh.ids.filter((id) => { const s = state.survivors.find((x) => x.id === id); return s && s.alive; });
}

// ---------- coverage ----------
// Per hour of the day: how many of the rostered stand watch (here and fit now) and the names; gaps are hours with a
// shift and nobody, or no shift at all.
export function watchCoverage(state, base) {
  const out = [];
  for (let h = 0; h < 24; h++) {
    const who = [];
    for (const sh of shiftsAt(base, h)) for (const id of sh.ids) {
      const s = state.survivors.find((x) => x.id === id);
      if (s && onWatchNow(state, base, s, h) && !who.includes(s)) who.push(s);
    }
    out.push({ h, n: who.length, who, shifts: shiftsAt(base, h) });
  }
  return out;
}
// Why someone on the roster is not standing it now ("" = they are, or would at their hours).
export function watchWhy(state, base, s) {
  if (!s.alive) return "dead";
  if (s.pinned) return "pinned (keeps their job)";
  if (s.location.kind !== "base" || s.location.baseId !== base.id) return "away from this base";
  if (s.inBed) return "in a hospital bed";
  return healthRest(s, state);
}

// ---------- the hourly pass for Manual people (world.js, after the stewards) ----------
export function watchHour(state) {
  const h = hourOfDay(state);
  const manualOk = !state.autopilot; // the dev autopilot sets every role itself
  for (const s of state.survivors) {
    if (!s.watchWas) continue;
    const base = baseById(state, s.watchWas.base);
    const still = manualOk && base && !isManaged(state, s) && onWatchNow(state, base, s, h);
    if (still) continue;
    // Off watch (or moved to priorities, pinned, away): their own job back, unless someone gave them another meanwhile.
    if (s.alive && s.role === "guard" && !isManaged(state, s)) { s.role = s.watchWas.role; s.station = s.watchWas.station ?? null; }
    delete s.watchWas;
  }
  if (!manualOk) return;
  for (const base of state.bases) {
    if (!base.watch) continue;
    pruneWatch(state, base);
    for (const s of atBase(state, base.id)) {
      if (isManaged(state, s) || s.watchWas) continue;
      const sh = onWatchNow(state, base, s, h);
      if (!sh) continue;
      if (s.role !== "guard") { s.watchWas = { role: s.role, station: s.station ?? null, base: base.id }; s.role = "guard"; s.station = null; }
    }
  }
}
// Midnight (world.js, with work.js workDayRoles): Manual people on watch count at their own job in the day's work.
// watchHour puts them back on watch at the end of the hour. The governor's watchers likewise (s.govWatch: the job
// they had, autopilot.js planRoles 1a, which puts them back on watch).
export function watchDayRoles(state) {
  for (const s of state.survivors) {
    if (!s.govWatch) continue;
    if (s.alive && s.role === "guard") { s.role = s.govWatch.role; s.station = s.govWatch.station ?? null; }
    delete s.govWatch;
  }
  for (const s of state.survivors) {
    if (!s.watchWas || !s.alive || isManaged(state, s) || s.role !== "guard") continue;
    s.role = s.watchWas.role;
    s.station = s.watchWas.station ?? null;
    delete s.watchWas;
  }
}

// One line for the base's overview / the Defence tab: "On watch now: Ann, Bo (Night 22–06) · gaps 14–16".
export function watchLine(state, base) {
  if (!base.watch) return "";
  const cov = watchCoverage(state, base);
  const now = cov[hourOfDay(state)];
  const gaps = [];
  for (let h = 0; h < 24; h++) if (!cov[h].n) { if (gaps.length && gaps[gaps.length - 1][1] === h) gaps[gaps.length - 1][1] = h + 1; else gaps.push([h, h + 1]); }
  if (gaps.length > 1 && gaps[0][0] === 0 && gaps[gaps.length - 1][1] === 24) { const last = gaps.pop(); gaps[0][0] = last[0]; }
  const names = now.who.map((s) => s.name.split(" ")[0]);
  return `${names.length ? `On watch now: ${names.join(", ")}` : "Nobody on watch now"}${gaps.length ? ` · no watch ${gaps.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(", ")}` : " · watched round the clock"}`;
}

// ---------- readiness when an attack hits ----------
// The base as the attack finds it: manned (defences manned for a warned raid or horde: base.alert, defences.js
// manned), the ids of the people standing guard there right now (fit, not in a bed: the watch roster, Guard on
// priorities, a fixed guard, the emergency's guards), and whether it is night. The State Map's warnings and surprise
// (an unwatched night) and the battle map's start (who is already at a post) read this.
// alert: how awake the watch is (each watcher 1, an exhausted one TIRED.ALERT: sleep.js); dozing: the exhausted ones.
export function readiness(state, base) {
  const guards = base ? atBase(state, base.id).filter((s) => s.alive && s.role === "guard" && !s.inBed && !healthRest(s)) : [];
  const dozing = guards.filter((s) => tiredLevel(s) >= 2);
  return {
    manned: !!base && (!!base.alert || manned(state, base)), watchers: guards.map((s) => s.id), night: isNight(state),
    alert: guards.length - dozing.length * (1 - TIRED.ALERT), dozing: dozing.map((s) => s.id),
  };
}

// ---------- unwatched nights and the watch's early warning ----------
// An attack that reaches a base at night (20:00–06:00) when nobody is awake on watch there (readiness: no watchers, or
// only exhausted ones who doze off: with alert a below 1 they are caught with chance 1 − a) and the defences are not
// manned gets the first move. A tripwire alarm in the armory wakes everyone (no surprise), and so does a perimeter
// alarm with power (2026-10-24, data-power.js ALARM: both through defences.js armoryDefence alarm; the perimeter alarm's
// sensors also spot anything within ALARM.tiles of the base at night with nobody on watch, lookoutsSpot below). By day,
// or with someone awake on watch, nothing changes.
//   Raids by the numbers (factions.js, visitors.js, prisoners.js rescues): the walls do not count (they were over them
//     before anyone woke: defences.js raidTier) and everyone but the guards counts SURPRISE.ASLEEP of their combat
//     power instead of 0.8 (factions.js baseDefense) unless the base is put on alert after all ("Prepare defenses").
//   Hordes by the numbers (defences.js hordeAttackBase): the defence buildings' bonus to the hold limit counts
//     SURPRISE.HORDE_DEFENCE (half: nobody manned the barricades or lit the floodlights); the guards add nothing (none).
//   Battles (a raid defended in person, a horde's break-in): setup.ambush "enemy" (their free volley, your people 1
//     action in the first turn: combat.js) and setup.context.surprise = true (the battle map's start: who is at a post).
export const SURPRISE = { ASLEEP: 0.5, HORDE_DEFENCE: 0.5 };
// { why } when an attack arriving now catches the base asleep, else null. The why opens the log line or card.
export function surpriseAt(state, base) {
  if (!base) return null;
  const r = readiness(state, base);
  if (!r.night || r.manned || r.alert >= 1) return null;
  if (armoryDefence(base).alarm) return null; // the tripwire's bells, or the perimeter alarm's siren (electric.js alarmOn)
  if (r.alert > 0 && hash01(state.seed, "doze", state.hour, localId(state, base.id)) < r.alert) return null;
  const names = r.dozing.map((id) => { const s = state.survivors.find((x) => x.id === id); return s ? s.name.split(" ")[0] : "?"; });
  return { why: names.length ? `${names.join(" and ")} dozed off on watch at ${base.name}, worn out` : `Nobody was on watch at ${base.name}` };
}
// The lookouts' warning of a raid or a horde coming for a base (parties.js, visitors.js, defences.js hordeWarnings):
// is it spotted on `tile`, at most `range` tiles out? seen: the tile is in sight (state.live: the bases' view, teams on
// the radio; visitors add the radio's coverage).
//   Someone awake on watch (readiness alert 1 or more) or the defences manned: WATCH_WARN.tiles further out, and the
//     lookouts on the walls see WATCH_WARN.day tiles past the base's view by day and WATCH_WARN.night past it at night
//     (1 → 3 tiles), in sight or not. A watchtower's extra view (world.js baseVision) adds to it by day.
//   Nobody awake on watch: by day as before (in sight, within range); at night nobody at the base sees it come, only a
//     team on the radio (or another base) beyond the base's own night view.
export const WATCH_WARN = { tiles: 2, day: 1, night: 2 };
export function lookoutsSpot(state, base, tile, range, seen = state.live.has(tile)) {
  if (!base) return false;
  const d = state.grid.distance(tile, base.tile);
  if (d <= range + WATCH_WARN.tiles + 2 && towerSees(state, base, tile)) return true; // fieldworks.js: lookouts on a manned watch tower of this base saw it
  const r = readiness(state, base);
  if (r.night && d <= ALARM.tiles && alarmOn(base)) return true; // the perimeter alarm's sensors on the approaches (electric.js), watch or no watch
  if (r.manned || r.alert >= 1) return d <= range + WATCH_WARN.tiles && (seen || d <= baseVision(base, state) + (r.night ? WATCH_WARN.night : WATCH_WARN.day));
  if (d > range || !seen) return false;
  return !r.night || d > baseVision(base, state);
}
// The watch's early warning, for the warning cards: a line when only the watch saw it (out of sight, or out of the
// usual range), else "".
export function watchSawText(state, base, tile, range, seen = state.live.has(tile)) {
  const tower = base ? towerSawText(state, base, tile) : ""; // fieldworks.js
  if (tower) return tower;
  if (!base || (seen && state.grid.distance(tile, base.tile) <= range)) return "";
  const r = readiness(state, base);
  if (r.manned || r.alert >= 1) return " The watch on the walls saw them early.";
  return r.night && state.grid.distance(tile, base.tile) <= ALARM.tiles && alarmOn(base) ? " The perimeter alarm's sensors picked them up on the approaches." : "";
}
