// The watch roster (a base's Defence tab): who stands guard at which hours, by name, whatever their role says.
//
// base.watch = { preset, shifts: [{ name, from, to, ids: [survivor id…] }] }   (no base.watch: no roster)
//   from / to: hours of the day (to may wrap past midnight: 22 → 6 is 22:00–06:00; from === to is all day).
//   ids: the people on that shift. Someone can stand more than one shift.
//
// Every hour the people on the shift that covers it, at that base and fit (not in a hospital bed, not badly hurt or
// ill: work.js healthRest), stand guard (role "guard": they count in the walls' hold limit, defences.js guardHold,
// guard the cells, put down someone who turns, worm.js):
//   - People on work priorities (work.js planBase): the watch comes after health and the emergencies (a raid sends
//     everyone with Guard set to the walls anyway) and before the role's schedule, so a night watch replaces the
//     night's sleep; the task reads "On watch: Night (22–06)".
//   - Manual people (watchHour, after the stewards): their role is set to guard for the shift and given back after
//     (s.watchWas = { role, station, base }). At midnight they count at their own job (watchDayRoles), as people on
//     priorities on a guard watch do (work.js workDayRoles).
//   - Pinned people and anyone away from the base are left alone. The dev autopilot (which sets every role) skips the
//     Manual part.
import { atBase, baseById, hourOfDay, skill } from "./world.js";
import { isManaged, healthRest } from "./work.js";

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
  if (healthRest(s)) return null;
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
  return healthRest(s);
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
// watchHour puts them back on watch at the end of the hour.
export function watchDayRoles(state) {
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
