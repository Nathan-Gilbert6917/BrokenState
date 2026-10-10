// Sleep and tiredness: s.tired, the hours of sleep a person owes (0 = rested).
//
// Every hour (world.js tickHour, after the hour's jobs are set) everyone at a base gains TIRED.AWAKE (1) awake or
// loses TIRED.SLEEP (3) asleep, never below 0 (up to TIRED.MAX). A normal day (16 hours up, 8 asleep) peaks at 16
// and is back to 0 by morning: nobody is ever Tired from it.
//   Asleep: the role's Sleep hours for people on work priorities whose role has some (work.js SCHED "s"); everyone
//   else (Manual people, roles without Sleep hours, pinned people) sleeps the default night, TIRED.NIGHT (22–06).
//   Resting hurt or ill (work.js healthRest, a hospital bed; resting sick, sickrest.js) counts as asleep.
//   Awake: everything else, and above all the watch roster (watch.js): a watch that falls in someone's sleep hours
//   keeps them up. Nothing else does: fixed guards, Guard on priorities, emergencies and a manned wall are taken to
//   sleep in turns, as before (so a game that never uses a roster is never Tired by it).
//   Sleeping in: someone who comes off a watch that ran into their sleep hours (its last hour was one), owing at least
//   TIRED.SLEEP_IN, sleeps until rested (s.sleepIn), whatever their sleep hours: people on priorities are put to bed
//   for it (work.js planBase: "Sleeping off the watch"), for Manual people it is counted the same way (their job, like
//   their night's sleep, stays as it is). After a 22–06 watch that is about 06–14; a day watch (06–14, 14–22) has none.
//   Away from a base (a team, a crew, a captive): no more tired, and TIRED.AWAY (2) an hour off in the default night,
//   or any hour while they still owe the sleep of a watch (s.sleepIn: sent out right after it, they doze on the way).
// Tired (TIRED.TIRED, 24 owed: a whole day up): aim −5 in battle (combat.js playerUnit), mood −0.1 an hour.
// Exhausted (TIRED.EXHAUSTED, 36): aim −12, mood −0.3 an hour; on guard they count half in the walls' hold limit
// (defences.js guardHold) and half as alert on watch (watch.js readiness: two exhausted watchers are one awake one;
// one alone dozes off half the time). A steady 22–06 watch, slept off each morning, owes about 18–21 by its end.
import { hourOfDay, baseById } from "./world.js";
import { roleOf, isManaged, schedAt, healthRest } from "./work.js";
import { onWatchNow, watchShift } from "./watch.js";

export const TIRED = {
  AWAKE: 1, SLEEP: 3, AWAY: 2, NIGHT: [22, 6], MAX: 72,
  TIRED: 24, EXHAUSTED: 36, SLEEP_IN: 2,
  AIM: [0, -5, -12], MOOD: [0, 0.1, 0.3], // by level: rested, Tired, Exhausted
  GUARD: 0.5, ALERT: 0.5, // an exhausted guard in the hold limit, an exhausted watcher's alertness
};
export const TIRED_WORDS = ["Rested", "Tired", "Exhausted"];

// 0 rested, 1 Tired, 2 Exhausted.
export const tiredLevel = (s) => { const t = (s && s.tired) || 0; return t >= TIRED.EXHAUSTED ? 2 : t >= TIRED.TIRED ? 1 : 0; };
export const tiredAim = (s) => TIRED.AIM[tiredLevel(s)];
const defaultNight = (h) => h >= TIRED.NIGHT[0] || h < TIRED.NIGHT[1];
// Is hour h one of this person's sleep hours (their role's Sleep hours, else the default night)?
export function sleepHour(state, s, h) {
  const role = isManaged(state, s) ? roleOf(state, s) : null;
  if (role && typeof role.sched === "string" && role.sched.length === 24 && role.sched.includes("s")) return schedAt(role, h) === "s";
  return defaultNight(h);
}
// Sleeping off a watch at hour h: already (s.sleepIn), or just off one that ran into their sleep hours, owing sleep.
export function sleepingIn(state, base, s, h = hourOfDay(state)) {
  if (!base || !s) return false;
  if (s.sleepIn) return true;
  const prev = (h + 23) % 24;
  return (s.tired || 0) >= TIRED.SLEEP_IN && sleepHour(state, s, prev) && !!onWatchNow(state, base, s, prev) && !onWatchNow(state, base, s, h);
}

// The hourly pass (world.js tickHour, last).
export function tiredHour(state) {
  const h = hourOfDay(state);
  for (const s of state.survivors) {
    if (!s.alive) continue;
    const t = s.tired || 0;
    if (s.location.kind !== "base") {
      if (t > 0 && (defaultNight(h) || s.sleepIn)) s.tired = Math.max(0, t - TIRED.AWAY);
      if (s.sleepIn && !(s.tired > 0)) delete s.sleepIn;
      continue;
    }
    const base = baseById(state, s.location.baseId);
    const watching = !!base && !!onWatchNow(state, base, s, h);
    if (watching) delete s.sleepIn;
    else if (base && sleepingIn(state, base, s, h)) s.sleepIn = true;
    const asleep = !watching && (!!s.sleepIn || !!healthRest(s, state) || sleepHour(state, s, h));
    const next = asleep ? Math.max(0, t - TIRED.SLEEP) : Math.min(TIRED.MAX, t + TIRED.AWAKE);
    if (next || s.tired) s.tired = next;
    if (asleep && next <= 0) delete s.sleepIn;
    const lv = tiredLevel(s);
    if (lv) s.mood = Math.max(0, (s.mood || 0) - TIRED.MOOD[lv]);
  }
}

// What standing the base's roster does to this person over a few days (the Defence tab's warnings): the most sleep
// they come to owe (peak), its level, and the longest stretch on watch (run, hours; two watches back to back count as
// one). The same rules as tiredHour, from rested, for 3 days.
export function rosterStrain(state, base, s) {
  const on = (h) => !!watchShift(base, s, ((h % 24) + 24) % 24);
  let t = 0, sleepIn = false, peak = 0, run = 0, best = 0;
  for (let i = 0; i < 72; i++) {
    const h = i % 24;
    const watching = on(h);
    if (watching) { sleepIn = false; run++; best = Math.max(best, run); } else run = 0;
    if (!watching && !sleepIn && t >= TIRED.SLEEP_IN && on(h - 1) && sleepHour(state, s, (h + 23) % 24)) sleepIn = true;
    const asleep = !watching && (sleepIn || sleepHour(state, s, h));
    t = asleep ? Math.max(0, t - TIRED.SLEEP) : Math.min(TIRED.MAX, t + TIRED.AWAKE);
    if (asleep && t <= 0) sleepIn = false;
    if (i >= 24) peak = Math.max(peak, t);
  }
  const lv = peak >= TIRED.EXHAUSTED ? 2 : peak >= TIRED.TIRED ? 1 : 0;
  return { peak, level: lv, run: best >= 24 ? 24 : best };
}

// One line for the survivor's needs and the roster ("" when rested).
export function tiredText(s) {
  const lv = tiredLevel(s);
  if (!lv) return "";
  return `${TIRED_WORDS[lv]} (owes ${Math.ceil(s.tired)} h of sleep): aim ${TIRED.AIM[lv]}, mood −${TIRED.MOOD[lv]} an hour${lv === 2 ? ", half as good on guard and may doze off on watch" : ""}${s.sleepIn ? " · sleeping it off" : ""}`;
}
