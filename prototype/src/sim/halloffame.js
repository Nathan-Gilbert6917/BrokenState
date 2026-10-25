// The hall of fame's entries (the user's request 2026-10-25: "a past-runs hall of fame for when you get an ending: how
// many days, which survivors, what kind of victory, etc."). Pure: hallEntry reads the world at an ending and builds
// one small record of the run (about 2 KB at most); it changes nothing and never touches state.rng. The UI keeps the
// list outside any save (ui/halloffame.js: browser storage, the same as the save list's, so the desktop app's too) and
// writes an entry when the victory or game-over screen comes up.
//
// The endings (endingOf): "hives" (the hive victory), "alliance" (the coalition's), "reunited" (Crashlanding's bunker,
// crashstart.js crashJoin) and "defeat" (everyone dead or gone: world.js checkGameOver). A run kept playing after a
// victory that later reaches another ending (or falls) gets a second entry: an entry's key is the campaign
// (savesummary.js campaignKey) and the ending's kind (hallKey), so a save reloaded at its end screen adds nothing new.
//
// An entry: the run (campaign, the date played: passed in, never read from the clock here; mode, world size, seed,
// Custom's counts), the ending (kind, how, the day, season and year), the numbers (days, peak and final people,
// deaths, bases at the end and at most at once, hives destroyed, groups in the coalition), the founders and what
// became of each, up to HALL.NOTABLE notable survivors (longest with the group, the best skill, the most kills, built,
// treated, trips: the service record, relations.js), the leader at the end, and the run's achievements
// (achievements.js achievementsOf) as [id, day] pairs. Fields an older world lacks are left out.
import { day, alive } from "./world.js";
import { seasonOfDay } from "./weather.js";
import { campaignKey } from "./savesummary.js";
import { worldSizeOf } from "./worldsize.js";
import { runMode, achievementsOf, foundersOf } from "./achievements.js";
import { BACKGROUNDS } from "./hardcore-start.js";
import { SKILLS, SKILL_NAMES } from "./data.js";
import { column, historyOf } from "./history.js";
import { allianceMembers } from "./alliance.js";

export const HALL = { MAX: 200, NOTABLE: 8, BYTES: 2048, CAUSE: 48 };
export const ENDINGS = { hives: "Hive victory", alliance: "Coalition victory", reunited: "The bunker", defeat: "Fallen" };

// The ending a world is at, or null while the run goes on.
/** @param {any} state */
export function endingOf(state) {
  if (!state || !state.gameOver) return null;
  if (!state.victory) return "defeat";
  return state.victoryReason === "alliance" ? "alliance" : state.victoryReason === "reunited" ? "reunited" : "hives";
}
/** @param {any} state @param {string} ending */
export const hallKey = (state, ending) => `${campaignKey(state)}|${ending}`;

const cut = (s, n = HALL.CAUSE) => { const t = String(s || "").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** @param {any} s */
const bgName = (s) => (s.background && BACKGROUNDS[s.background] ? BACKGROUNDS[s.background].name : s.background ? "Custom" : undefined);
/** @param {any} s */
function topSkill(s) {
  let best = null, lv = -1;
  for (const k of SKILLS) { const v = (s.skills && s.skills[k]) || 0; if (v > lv) { lv = v; best = k; } }
  return best ? [best, lv] : undefined;
}
// What became of someone: "alive", "left", "captive" or "died day N, <cause>" (from the memorial wall).
/** @param {any} state @param {any} s */
function fateOf(state, s) {
  if (s.alive) return s.location && s.location.kind === "captive" ? "captive" : "alive";
  if (s.left) return "left";
  const m = (state.memorial || []).find((x) => x.id === s.id);
  return m ? `died day ${m.died}${m.cause ? `, ${cut(m.cause)}` : ""}` : "dead";
}
/** @param {any} state @param {any} s @param {string} [why] */
function personOf(state, s, why) {
  const o = { n: s.name, bg: bgName(s), sk: topSkill(s), fate: fateOf(state, s) };
  if (why) o.why = why;
  return o;
}
// Days with the group (relations.js daysWith, by hand: no world.js import cycle).
/** @param {any} state @param {any} s */
const daysWithOf = (state, s) => {
  const m = !s.alive ? (state.memorial || []).find((x) => x.id === s.id) : null;
  const end = s.alive ? day(state) : m ? m.died : s.diedDay || day(state);
  return Math.max(1, end - (s.joined || 1) + 1);
};
// Up to HALL.NOTABLE people, each for one thing: the longest with the group, the best skill, the most of the dead put
// down, the most people killed, built, treated, trips; then the longest-serving others. The founders are listed apart.
/** @param {any} state */
function notables(state) {
  const pool = (state.survivors || []).filter((s) => !s.vol && !s.loan);
  const r = (s, k) => Number(s.rec && s.rec[k]) || 0;
  const picks = [];
  const seen = new Set();
  const take = (list, why, ok = () => true) => {
    const s = list.find((x) => !seen.has(x.id) && ok(x));
    if (s && picks.length < HALL.NOTABLE) { seen.add(s.id); picks.push(personOf(state, s, why(s))); }
  };
  const by = (f) => [...pool].sort((a, b) => f(b) - f(a) || a.id - b.id);
  const served = (s) => { const n = daysWithOf(state, s); return `${n} day${n === 1 ? "" : "s"} with the group`; };
  take(by((s) => daysWithOf(state, s)), served);
  take(by((s) => (topSkill(s) || [0, 0])[1]), (s) => { const t = topSkill(s); return t ? `the best ${SKILL_NAMES[t[0]] || t[0]}, ${t[1]}` : "skill"; });
  for (const [k, one, many] of [["killsZ", "of the dead put down", "of the dead put down"], ["killsH", "person killed", "people killed"], ["built", "building built", "buildings built"], ["treated", "person treated", "people treated"], ["trips", "trip", "trips"], ["hives", "hive burned", "hives burned"]]) take(by((s) => r(s, k)), (s) => `${r(s, k)} ${r(s, k) === 1 ? one : many}`, (s) => r(s, k) > 0);
  for (const s of by((x) => daysWithOf(state, x))) take([s], served);
  return picks;
}
// The most of your bases standing on one day (history.js: each base's rows with their day and span), at least now.
/** @param {any} state */
function peakBases(state) {
  const H = historyOf(state);
  let peak = (state.bases || []).length;
  if (!H || !H.bases) return peak;
  const cnt = new Map();
  for (const ser of Object.values(H.bases)) {
    const days = new Set();
    for (const row of ser.rows || []) for (let d = row[0]; d < row[0] + (row[1] || 1); d++) days.add(d);
    for (const d of days) cnt.set(d, (cnt.get(d) || 0) + 1);
  }
  for (const v of cnt.values()) peak = Math.max(peak, v);
  return peak;
}

// How the run fell: everyone dead (or some gone), the last death's cause, every base lost.
/** @param {any} state */
function defeatHow(state) {
  const allDead = (state.survivors || []).every((s) => !s.left);
  const last = (state.memorial || [])[0];
  const bits = [allDead ? "everyone died" : "everyone dead or gone"];
  if (!(state.bases || []).length) bits.push("every base lost");
  if (last) bits.push(`the last, ${last.name}, ${cut(last.cause, 40)}`);
  return bits.join("; ");
}

/**
 * One hall-of-fame entry for the run at an ending. Changes nothing.
 * @param {any} state
 * @param {string | null} [ending] endingOf(state) by default
 * @param {{ date?: string | number }} [opts] the date played (the UI passes the clock's)
 */
export function hallEntry(state, ending = endingOf(state), opts = {}) {
  const kind = ending || "defeat";
  const d = day(state);
  const se = seasonOfDay(d - 1);
  const living = alive(state);
  const pops = column(state, "all", "pop").map((x) => x.v);
  const ach = achievementsOf(state);
  const lead = living.find((s) => s.leader);
  const founders = foundersOf(state).slice(0, 8);
  /** @type {any} */
  const e = {
    v: 1, key: hallKey(state, kind), campaign: campaignKey(state),
    date: opts.date != null ? (typeof opts.date === "number" ? new Date(opts.date).toISOString() : String(opts.date)) : undefined,
    mode: runMode(state), size: worldSizeOf(state), seed: state.seed,
    custom: state.custom ? { ...state.custom } : undefined,
    ironman: state.ironman ? true : undefined,
    ending: { kind, label: ENDINGS[kind] || kind, how: kind === "defeat" ? defeatHow(state) : undefined, day: d, season: se.name, year: se.year },
    days: d,
    peak: Math.max(living.length, ...pops),
    alive: living.length,
    deaths: (state.memorial || []).length,
    bases: { end: (state.bases || []).length, peak: peakBases(state) },
    hives: state.hiveInfo && state.hiveInfo.stats ? state.hiveInfo.stats.destroyed : undefined,
    coalition: state.alliance ? allianceMembers(state).length : undefined,
    founders: founders.map((s) => personOf(state, s)),
    notable: notables(state),
    leader: lead ? lead.name : undefined,
    ach: ach.length ? ach.map((a) => [a.id, a.day]) : undefined,
  };
  return fit(JSON.parse(JSON.stringify(e)));
}
// Kept to HALL.BYTES: the notables' reasons go first, then notables from the end, then the founders' backgrounds.
/** @param {any} e */
function fit(e) {
  const size = () => JSON.stringify(e).length;
  if (size() <= HALL.BYTES) return e;
  for (const p of e.notable) delete p.why;
  while (size() > HALL.BYTES && e.notable.length) e.notable.pop();
  for (const p of e.founders) { if (size() <= HALL.BYTES) break; delete p.bg; delete p.sk; }
  while (size() > HALL.BYTES && e.founders.length) e.founders.pop();
  return e;
}

// ---------- the list (pure: the UI reads and writes it) ----------
// Adds an entry to a list (newest first), unless one with its key is there; keeps HALL.MAX, the oldest dropped.
// Returns { list, added }.
/** @param {any[]} list @param {any} entry */
export function hallAdd(list, entry) {
  const L = Array.isArray(list) ? list.filter((x) => x && x.key) : [];
  if (!entry || !entry.key || L.some((x) => x.key === entry.key)) return { list: L, added: false };
  const out = [entry, ...L];
  out.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return { list: out.slice(0, HALL.MAX), added: true };
}
// Filtered for the window: by ending kind and mode ("all" for either).
/** @param {any[]} list @param {{ ending?: string, mode?: string }} f */
export const hallFilter = (list, f = {}) => (list || []).filter((x) => (!f.ending || f.ending === "all" || (x.ending && x.ending.kind === f.ending)) && (!f.mode || f.mode === "all" || x.mode === f.mode));
