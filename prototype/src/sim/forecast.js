// @ts-check
// The 7-day threat forecast (docs/suggestions-5.md #19: "One meter in the top bar for the coming week, combining
// weather, nearby hordes and their drift, raider intent you have heard on the radio, and food or water running out.
// Hover lists the causes."). threatForecast(state, days) gathers what is coming for your bases and teams over the next
// days from the game's own forecasts, never a rule of its own: the weather forecast and the fronts on the map
// (weather.js forecast, frontsApproaching), the hordes' marches and drift (hordes.js driftTarget, driftPull,
// HOURS_PER_TILE, hordeSpeedFactor) against the defences (defences.js holdLimit), raids seen by the lookouts or heard
// on a group's channel (parties.js warned, radiolisten.js arrivalDay) against the defence (factions.js baseDefense,
// RAIDS), raiders from outside (visitors.js), the food and water outlooks (economy.js foodOutlook, waterOutlook), the
// heating against the wood and fuel in store (upkeep.js heatUse, woodcutting.js woodNeed), the generators' fuel
// (power.js powerStatus), crops and the frost (weather.js cropDamage), the worm's course (worm.js WORM.BRAIN_FROM),
// illness, teams in the field (plans.js foodDays, needs.js teamWater, parties.js hoursLeft), a night march, the dead
// massing for a new hive (hivebirth.js siteView), wars with you (playerwars.js) and the dead on a base's own tile
// (threatknow.js tileThreatEstimate: deadpop.js's pools as your people there see them, live; issue #67).
//
// Fog of war: only what the player could know. A horde counts when you see it now, a watchtower tracks it, the
// lookouts warned of it or you saw the dead within 2 tiles of it in the last day; a raid when the lookouts saw it, you
// can see it or you heard it on the radio; outsiders when you can see or hear them. Everything else stays off it.
//
// The result: { hour, today, days: [{ day, offset, level, items }], week: [items], items, level, label, range }.
// An item: { key, day (the clock's day number; null for the whole week), offset (0 = today), kind, level (0 calm,
// 1 watch, 2 danger, 3 severe), icon, text, confidence (0–1), sure (in words), source, target ({ kind: "base" |
// "team" | "horde" | "tile" | "group" | "person", id, name, tile }), why, go (what a click opens: { base, tab } |
// { team } | { tile } | { surv }) }. Cached per in-game hour (and per state), so the UI and the autopilot can ask it
// as often as they like; threatForecastFresh skips the cache (tests).
import { day, hub, residents, localId, alive } from "./world.js";
import { forecast, forecastRange, weather, frontsApproaching, dayIndex, hordeSpeedFactor, cropDamage, WEATHER } from "./weather.js";
import { HOURS_PER_TILE, driftTarget, driftPull, hordePace } from "./hordes.js";
import { holdLimit } from "./defences.js";
import { baseDefense, RAIDS } from "./factions.js";
import { arrivalDay } from "./radiolisten.js";
import { inCoverage } from "./radio.js";
import { OUTSIDERS, vStrength } from "./visitors.js";
import { foodOutlook, waterOutlook, drinkRate } from "./economy.js";
import { heatUse, HEAT, heatRateAt } from "./upkeep.js";
import { woodNeed } from "./woodcutting.js";
import { powerStatus, generators } from "./power.js";
import { wormOf, WORM } from "./worm.js";
import { isContagious, noMedsList } from "./health.js";
import { partyMembers, partyTile, travelHours, hoursLeft, onTheMove, tileLabel } from "./parties.js";
import { foodDays, commandable, hoursHome } from "./plans.js";
import { teamWater, hungerOf, thirstOf, NEEDS } from "./needs.js";
import { siteView } from "./hivebirth.js";
import { atWarWithYou } from "./playerwars.js";
import { tileThreatEstimate } from "./threatknow.js"; // the dead on the land as your people see it (issue #67): the pools round a base

export const THREAT = {
  DAYS: 7,
  LEVELS: ["calm", "watch", "danger", "severe"],
  NAMES: ["Calm", "Watch", "Danger", "Severe"],
  HORDE_NEAR: 8,     // a wandering horde this close to a base can drift onto it (hordes.js driftTarget's reach)
  DRIFT_MIN: 15,     // smaller wandering crowds are not worth a line
  SEEN_HOURS: 24,    // dead seen within 2 tiles of a horde this recently: you know it is out there
  SEEN_TILES: 2,
  STALE_HOURS: 48,   // a horde seen this recently near a base, not seen since: a guess that it is still about
  STALE_TILES: 4,
  HOLD_WATCH: 0.6,   // a horde under this share of what the defences hold is only a watch
  GATHER_NEAR: 10,   // a hive due this close to a base
  CROP_KILL: 0.2,    // a day the forecast says kills this share of a crop
  DEAD_WATCH: 3, DEAD_DANGER: 4, // the dead on a base's tile (threatknow.js bands 0–4): high a watch, overrun a danger
};
const DAY_H = 24;
const r1 = (v) => Math.round(v * 10) / 10;
const plural = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
const firstName = (s) => String((s && s.name) || "").split(/\s+/)[0];
// How sure, in words.
export const sureWord = (c) => (c >= 0.85 ? "sure" : c >= 0.6 ? "likely" : c >= 0.35 ? "possible" : "a guess");
export const levelName = (l) => THREAT.NAMES[Math.max(0, Math.min(3, l | 0))];

// ---------- the cache ----------
const cache = new WeakMap();
// The forecast for the next `days` days (today first), cached per in-game hour: the census and the render loop ask it
// many times an hour. The key also has the bases, teams and hordes counts, so a base lost or a team sent within the
// hour shows at once.
/** @param {any} state @param {number} [days] */
export function threatForecast(state, days = THREAT.DAYS) {
  if (!state || !Array.isArray(state.bases)) return emptyForecast(state, days);
  const key = `${state.hour}|${days}|${state.bases.length}|${(state.parties || []).length}|${(state.hordes || []).length}|${(state.cards || []).length}`;
  const c = cache.get(state);
  if (c && c.key === key) return c.res;
  const res = threatForecastFresh(state, days);
  cache.set(state, { key, res });
  return res;
}
/** @param {any} state */
export const dropForecastCache = (state) => cache.delete(state);

function emptyForecast(state, days) {
  const today = state && state.hour != null ? day(state) : 1;
  return { hour: state ? state.hour : 0, today, days: Array.from({ length: days }, (_, i) => ({ day: today + i, offset: i, level: 0, items: [] })), week: [], items: [], level: 0, label: THREAT.NAMES[0], range: 0 };
}

// ---------- the forecast ----------
/** @param {any} state @param {number} [days] */
export function threatForecastFresh(state, days = THREAT.DAYS) {
  const today = day(state);
  const last = today + days - 1;
  const out = [];
  const ctx = { state, today, last, days, out, live: state.live || new Set(), range: forecastRange(state), speed: [] };
  // The day (clock number) a moment `h` hours from now falls on.
  ctx.dayAt = (h) => Math.floor((state.hour + Math.max(0, h)) / DAY_H) + 1;
  ctx.add = (it) => {
    if (it.day != null && (it.day < today || it.day > last)) return;
    it.offset = it.day == null ? null : it.day - today;
    it.confidence = Math.max(0.05, Math.min(1, Math.round(it.confidence * 100) / 100));
    it.sure = sureWord(it.confidence);
    out.push(it);
  };
  for (const fn of SOURCES) {
    try { fn(ctx); } catch (e) { if (state.forecastStrict) throw e; } // one source failing never takes the meter down
  }
  out.sort((a, b) => (a.day ?? 1e9) - (b.day ?? 1e9) || b.level - a.level || b.confidence - a.confidence);
  const dayRows = [];
  for (let i = 0; i < days; i++) {
    const items = out.filter((x) => x.offset === i);
    dayRows.push({ day: today + i, offset: i, level: items.reduce((m, x) => Math.max(m, x.level), 0), items, known: i <= ctx.range });
  }
  const week = out.filter((x) => x.day == null);
  const level = Math.max(0, ...dayRows.map((d) => d.level), ...week.map((x) => Math.min(1, x.level)));
  return { hour: state.hour, today, days: dayRows, week, items: out, level, label: THREAT.NAMES[level], range: ctx.range };
}

// ---------- the sources ----------
const baseRef = (b) => ({ kind: "base", id: b.id, name: b.name, tile: b.tile });
const teamLabel = (state, p) => {
  const m = partyMembers(state, p);
  return m.length ? `${firstName(m[0])}'s team` : "A team";
};
const teamRef = (state, p) => ({ kind: "team", id: p.id, name: teamLabel(state, p), tile: p.path ? partyTile(p) : null });
const peopled = (state) => state.bases.filter((b) => residents(state, b.id).length > 0);
const fieldTeams = (state) => (state.parties || []).filter((p) => p.owner === "player" && p.kind !== "convoy" && Array.isArray(p.path) && partyMembers(state, p).length > 0);

// The horde's hours to walk `steps` tiles from where it stands, by the pace of the days ahead (the cold and snow slow
// it: weather.js hordeSpeedFactor; runners speed it: hordes.js hordePace); null past the forecast.
function hordeHours(ctx, h, steps) {
  const { state } = ctx;
  const horizon = (ctx.last - ctx.today + 1) * DAY_H + DAY_H;
  let move = h.move || 0, left = steps, t = 0;
  const pace = hordePace(h);
  while (left > 0 && t < horizon) {
    t++;
    const di = dayIndex(state, state.hour + t);
    const sp = ctx.speed[di] ?? (ctx.speed[di] = hordeSpeedFactor(state, di));
    move += sp * pace;
    if (move >= HOURS_PER_TILE) { move -= HOURS_PER_TILE; left--; }
  }
  return left > 0 ? null : t;
}
// How the player knows of a horde (null: they do not).
function hordeKnown(ctx, h) {
  const { state, live } = ctx;
  if (live.has(h.tile)) return { how: "seen", sure: 1, text: "in sight" };
  const tower = state.bases.find((b) => b.towerWatch && b.towerWatch.ids.includes(h.id));
  if (tower) return { how: "tower", sure: 0.85, text: `the watchtower at ${tower.name} tracks it` };
  if (h.warned) return { how: "lookouts", sure: 0.8, text: "the lookouts saw it coming" };
  for (const id of state.grid.within(h.tile, THREAT.SEEN_TILES)) {
    const k = state.knowledge && state.knowledge[id];
    if (k && k.hordeSize > 0 && state.hour - k.hour <= THREAT.SEEN_HOURS) return { how: "sighted", sure: 0.6, text: `seen ${Math.max(1, Math.round(state.hour - k.hour))} h ago`, tile: id };
  }
  return null;
}
const hordeLevel = (h, limit) => (h.size > limit ? 3 : h.size > limit * THREAT.HOLD_WATCH ? 2 : 1);

function hordes(ctx) {
  const { state } = ctx;
  const g = state.grid;
  const bases = state.bases;
  if (!bases.length) return;
  const seenTiles = new Set();
  for (const h of state.hordes || []) {
    const k = hordeKnown(ctx, h);
    if (!k) continue;
    seenTiles.add(k.tile ?? h.tile);
    const at = k.how === "seen" ? h.tile : k.tile ?? h.tile; // where the player places it
    const coming = bases.find((b) => (h.goal && h.goal.baseId === b.id) || h.target === b.tile);
    if (coming && h.tile !== coming.tile) {
      const steps = h.path && h.pathTo === h.target && h.path[0] === h.tile && h.target === coming.tile ? h.path.length - 1 : g.distance(h.tile, coming.tile);
      const hrs = hordeHours(ctx, h, steps);
      if (hrs == null) continue;
      const limit = holdLimit(state, coming, Math.min(2, h.bosses || 0));
      const firm = h.role === "attack" ? 0.9 : hrs <= DAY_H ? 0.8 : 0.55; // a wanderer picks its way again each day
      const lvl = hordeLevel(h, limit);
      ctx.add({
        key: `horde:${h.id}`, day: ctx.dayAt(hrs), kind: "horde", level: lvl, icon: "🧟",
        text: `Horde of ${h.size} reaches ${coming.name}${lvl === 3 ? ": break-in likely" : ""}`,
        confidence: firm * k.sure, source: k.how === "seen" ? "Seen on the map" : k.how === "tower" ? "Watchtower" : k.how === "lookouts" ? "Lookouts" : "Sighting",
        target: baseRef(coming),
        why: `A horde of about ${h.size}${h.bosses ? " with a Wallbreaker" : ""}, ${plural(g.distance(h.tile, coming.tile), "tile")} out and heading for ${coming.name} (${k.text}): about ${Math.round(hrs)} h at the pace of the days ahead. The defences hold about ${Math.round(limit)}${h.size > limit ? ": it would break in" : ""}.${h.role === "attack" ? "" : " A wandering horde picks its way again each day: it may still turn."}`,
        go: { tile: at },
      });
      continue;
    }
    // Wandering near a base: the days it is pulled it turns toward the loudest people (hordes.js driftTarget).
    if (!["roam", "border", undefined, null].includes(h.role) || h.size < THREAT.DRIFT_MIN) continue;
    const best = driftTarget(state, h);
    const b = best && bases.find((x) => x.tile === best.tile);
    if (!b || g.distance(h.tile, b.tile) > THREAT.HORDE_NEAR) continue;
    const hrs = hordeHours(ctx, h, g.distance(h.tile, b.tile));
    if (hrs == null) continue;
    const pull = driftPull(state);
    const limit = holdLimit(state, b, Math.min(2, h.bosses || 0));
    const days = Math.max(1, ctx.last - ctx.dayAt(hrs) + 1);
    ctx.add({
      key: `drift:${h.id}`, day: ctx.dayAt(hrs), kind: "drift", level: Math.min(2, hordeLevel(h, limit)), icon: "🧟",
      text: `Horde of ${h.size} may drift onto ${b.name}`,
      confidence: (1 - (1 - pull) ** days) * k.sure,
      source: k.how === "seen" ? "Seen on the map" : k.how === "tower" ? "Watchtower" : "Sighting",
      target: baseRef(b),
      why: `A wandering horde of about ${h.size}, ${plural(g.distance(h.tile, b.tile), "tile")} from ${b.name} (${k.text}). ${b.name} is the loudest place within its reach: on about ${Math.round(pull * 100)}% of days the dead turn toward the noise, and from here they would be at the gate in about ${Math.round(hrs)} h. The defences hold about ${Math.round(limit)}. Quiet work, a muffled generator or running silent make a base less of a pull.`,
      go: { tile: at },
    });
  }
  // Hordes seen near a base in the last two days and out of sight since: a guess that they are still about.
  for (const b of bases) {
    for (const id of g.within(b.tile, THREAT.STALE_TILES)) {
      if (seenTiles.has(id) || ctx.live.has(id)) continue;
      const k = state.knowledge && state.knowledge[id];
      if (!k || !(k.hordeSize >= 15) || state.hour - k.hour > THREAT.STALE_HOURS) continue;
      seenTiles.add(id);
      const d = g.distance(id, b.tile);
      ctx.add({
        key: `stale:${b.id}:${id}`, day: ctx.today, kind: "drift", level: 1, icon: "🧟",
        text: `Horde of ~${k.hordeSize} last seen ${plural(d, "tile")} from ${b.name}`,
        confidence: 0.3, source: "Last sighting", target: baseRef(b),
        why: `Seen ${Math.max(1, Math.round(state.hour - k.hour))} h ago near ${tileLabel(state, id)} and out of sight since: it may still be about, or gone. A watchtower or a team nearby would know.`,
        go: { tile: id },
      });
    }
  }
}

// Raids: a group's war party (seen, or heard on its channel) and raiders from outside (seen or heard on the radio).
function raidLevel(def, strength) {
  const ratio = strength > 0 ? def / strength : 9;
  return ratio >= RAIDS.HOLD ? 2 : 3;
}
function raids(ctx) {
  const { state, live } = ctx;
  const got = (state.radioChan && state.radioChan.got) || {};
  for (const q of state.parties || []) {
    if (q.owner === "player" || q.kind !== "raid" || !q.target || q.target.kind !== "player") continue;
    const b = state.bases.find((x) => x.id === q.target.baseId);
    if (!b) continue;
    const tile = q.path ? partyTile(q) : null;
    const seen = q.warned || (tile != null && live.has(tile));
    const heard = got[`raid:${localId(state, q.id)}`] != null || (state.cards || []).some((c) => c.radioRaid === q.id);
    if (!seen && !heard) continue;
    const f = state.factions.find((x) => x.id === q.owner);
    const who = f && f.known ? f.name : "A group";
    const def = baseDefense(state, b), st = q.strength || 0;
    const siege = q.phase === "siege";
    const arrive = siege ? ctx.today : arrivalDay(state, q) + 1; // arrivalDay: the day index (0 = day 1)
    const lvl = raidLevel(def, st);
    ctx.add({
      key: `raid:${q.id}`, day: arrive, kind: "raid", level: siege ? 3 : lvl, icon: "⚔",
      text: siege ? `${who} at the walls of ${b.name}` : `${who}'s war party reaches ${b.name}${lvl === 3 ? ": could break in" : ""}`,
      confidence: siege ? 1 : seen ? 0.85 : 0.65, source: seen ? "Lookouts" : "Radio (heard)", target: baseRef(b),
      why: `A war party of strength about ${Math.round(st)}${siege ? " is at the walls" : `, there ${arrive <= ctx.today ? "today" : arrive === ctx.today + 1 ? "tomorrow" : `around day ${arrive}`}`}${seen ? "" : " (heard on their channel: the day is their own guess)"}. ${b.name}'s defence: about ${Math.round(def)}. It holds at ${RAIDS.HOLD}× their strength; below that they break in. Prepare defenses puts everyone on a post.`,
      go: { base: b.id, tab: "overview" },
    });
  }
  for (const v of state.visitors || []) {
    if (v.kind !== "raiders" || v.paid || !v.goal || v.goal.kind !== "base") continue;
    const b = state.bases.find((x) => x.id === v.goal.baseId);
    if (!b) continue;
    const seen = live.has(v.tile), heard = !seen && inCoverage(state, v.tile);
    if (!seen && !heard && !v.warned) continue;
    const siege = v.phase === "siege";
    let hrs = 0;
    if (!siege && Array.isArray(v.path) && v.idx < v.path.length - 1) {
      const t = travelHours(state, v.path.slice(v.idx), { speed: OUTSIDERS.raiders.speed, progress: v.progress || 0, weather: false, maxHours: (ctx.days + 1) * DAY_H });
      if (!t.reached) continue;
      hrs = t.hours;
    }
    const def = baseDefense(state, b), st = vStrength(v);
    const lvl = siege ? 3 : raidLevel(def, st);
    ctx.add({
      key: `outsiders:${v.id}`, day: ctx.dayAt(hrs), kind: "raid", level: lvl, icon: "🚨",
      text: siege ? `Raiders from outside at ${b.name}` : `Raiders from outside reach ${b.name}`,
      confidence: siege ? 1 : seen || v.warned ? 0.8 : 0.6, source: seen || v.warned ? "Seen on the map" : "Radio (heard)", target: baseRef(b),
      why: `${v.name ? `${v.name[0].toUpperCase()}${v.name.slice(1)}` : "A raider band"}: ${plural(v.size, "fighter")}, strength about ${Math.round(st)}, heading for ${b.name}${siege ? " and at the walls" : `, about ${Math.round(hrs)} h out`}. ${b.name}'s defence: about ${Math.round(def)}.`,
      go: { tile: v.tile },
    });
  }
  // A war with you: a raid can come any day (no day to put on it).
  for (const f of state.factions || []) {
    if (!f.alive || !atWarWithYou(state, f)) continue;
    ctx.add({
      key: `war:${f.id}`, day: null, kind: "war", level: 1, icon: "⚔",
      text: `At war with ${f.known ? f.name : "a group"}: a raid may come any day`,
      confidence: 0.3, source: "Diplomacy", target: { kind: "group", id: f.id, name: f.known ? f.name : "a group", tile: f.bases[0] ?? null },
      why: "A group at war with you sends war parties against your bases. The lookouts see them a few tiles out; listening in on their channel can warn you days ahead.",
      go: f.bases[0] != null && f.known ? { tile: f.bases[0] } : null,
    });
  }
}

// The weather: storms and blizzards (fronts on the map, then the forecast), heat waves, and crops the frost may kill.
function weatherSrc(ctx) {
  const { state } = ctx;
  const teams = fieldTeams(state).filter((p) => onTheMove(p) || p.phase === "waiting");
  const teamNote = teams.length ? ` ${plural(teams.length, "team")} in the field: travel under it is slow and risky.` : "";
  const severeDays = new Set();
  const home = hub(state);
  // A storm slows everything (a watch); a blizzard is dangerous on the road (frostbite, lost footing) with teams out.
  const wxLevel = (k) => (k === "blizzard" && teams.length ? 2 : 1);
  for (const fr of frontsApproaching(state)) {
    if (!fr.severe || (!fr.over && fr.eta == null)) continue;
    const d = ctx.dayAt(fr.over ? 0 : fr.eta);
    if (severeDays.has(d)) continue;
    severeDays.add(d);
    ctx.add({
      key: `front:${fr.f.id}`, day: d, kind: "weather", level: wxLevel(fr.k), icon: fr.icon,
      text: fr.over ? `${fr.name} over ${home ? home.name : "you"}` : `${fr.name} reaches ${home ? home.name : "you"} in ${fr.eta} h`,
      confidence: fr.over ? 1 : 0.85, source: "Fronts on the map", target: home ? baseRef(home) : { kind: "tile", id: null, name: "here", tile: null },
      why: `A ${fr.name.toLowerCase()} ${fr.over ? "is over home now" : `${fr.dist} tiles to the ${fr.dir}, heading ${fr.heading}`}: storms and blizzards slow everything and make the road risky; crops can be flattened.${teamNote}`,
      go: home ? { tile: home.tile } : null,
    });
  }
  const w = weather(state);
  const fc = [{ day: ctx.today, offset: 0, key: w.key || w.k, name: w.name, icon: w.icon, severe: !!w.severe, hi: Math.round(w.hi), lo: Math.round(w.lo), confidence: 1 }, ...forecast(state, ctx.range)];
  const tgt = home ? baseRef(home) : { kind: "tile", id: null, name: "here", tile: null };
  for (const f of fc) {
    if (f.day > ctx.last) continue;
    if (f.severe && !severeDays.has(f.day)) {
      severeDays.add(f.day);
      ctx.add({
        key: `wx:${f.day}`, day: f.day, kind: "weather", level: wxLevel(f.key), icon: f.icon,
        text: `${f.name}${f.offset ? " forecast" : " today"}`, confidence: f.confidence, source: "Weather forecast", target: tgt,
        why: `${(WEATHER[f.key] && WEATHER[f.key].desc) || f.name} The fronts cross the map from its edges: not every one passes over you.${teamNote}`,
        go: home ? { tile: home.tile } : null,
      });
    } else if (f.key === "heat") {
      ctx.add({
        key: `heat:${f.day}`, day: f.day, kind: "weather", level: 1, icon: f.icon,
        text: `Heat wave${f.offset ? " forecast" : " today"} (${f.hi}°C)`, confidence: f.confidence, source: "Weather forecast", target: tgt,
        why: "Everyone drinks more water (60% more than spring's), wells give less and crops need watering; heat sickness for people working outside.",
        go: home ? { base: home.id, tab: "farming" } : null,
      });
    }
    // Crops the frost, a freeze, a blizzard or a storm may kill that day (weather.js cropDamage, outdoor plots).
    if (f.offset < 1) continue;
    for (const b of state.bases) {
      const plots = (b.farm && b.farm.plots || []).filter((p) => !p.gh && p.stage === "growing" && p.crop);
      if (!plots.length) continue;
      let worst = null;
      for (const crop of new Set(plots.map((p) => p.crop))) {
        const dmg = cropDamage(state, crop, f.day - 1);
        if (dmg.kill >= THREAT.CROP_KILL && (!worst || dmg.kill > worst.kill)) worst = { ...dmg, crop };
      }
      if (!worst) continue;
      ctx.add({
        key: `crops:${b.id}:${f.day}`, day: f.day, kind: "crops", level: 1, icon: "🌱",
        text: `${worst.reason[0].toUpperCase()}${worst.reason.slice(1)} may kill crops at ${b.name}`, confidence: f.confidence * 0.8, source: "Weather forecast", target: baseRef(b),
        why: `The forecast (${f.name}, ${f.lo} to ${f.hi}°C) puts ${b.name}'s ${worst.crop} at about ${Math.round(worst.kill * 100)}% risk. Harvest what is ripe; tender crops do better under glass (a greenhouse).`,
        go: { base: b.id, tab: "farming" },
      });
    }
  }
}

// Food and water at each base: the day the stores run out at today's eating (economy.js outlooks).
function stores(ctx) {
  const { state } = ctx;
  for (const b of peopled(state)) {
    const fo = foodOutlook(state, b);
    if (b.hungerDays > 0 || fo.stock < 1) {
      ctx.add({ key: `food:${b.id}`, day: ctx.today, kind: "food", level: 3, icon: "🍽", text: `${b.name} is out of food`, confidence: 1, source: "Stores", target: baseRef(b), why: "Everyone there goes hungry: they lose health every day and nobody heals. Bring food in (a supply run, trade, hunting) or move people.", go: { base: b.id, tab: "farming" } });
    } else if (isFinite(fo.daysLeft)) {
      const d = ctx.dayAt(fo.daysLeft * DAY_H);
      const harvest = (fo.harvests || []).find((x) => x && x.inDays != null && x.inDays <= fo.daysLeft && x.food >= 0.5);
      ctx.add({
        key: `food:${b.id}`, day: d, kind: "food", level: 2, icon: "🥫", text: `Food runs out at ${b.name}`,
        confidence: harvest ? 0.5 : 0.8, source: "Stores", target: baseRef(b),
        why: `${r1(fo.stock)} days of food for ${plural(fo.heads, "person", "people")} eating ${r1(fo.eat)} a day${fo.spoil >= 0.05 ? `, ${r1(fo.spoil)} spoiling` : ""}: about ${r1(fo.daysLeft)} days at today's rate, not counting harvests${harvest ? " (one is due before then and may push it back)" : ""} or finds.`,
        go: { base: b.id, tab: "farming" },
      });
    }
    const wo = waterOutlook(state, b);
    if (b.thirstDays > 0 || wo.stock < 1) {
      ctx.add({ key: `water:${b.id}`, day: ctx.today, kind: "water", level: 3, icon: "🚱", text: `${b.name} is out of water`, confidence: 1, source: "Stores", target: baseRef(b), why: "Thirst kills faster than hunger: everyone there loses health every day. Wells, rain catchers, filters or a supply run.", go: { base: b.id, tab: "farming" } });
    } else if (isFinite(wo.daysLeft)) {
      ctx.add({
        key: `water:${b.id}`, day: ctx.dayAt(wo.daysLeft * DAY_H), kind: "water", level: 3, icon: "💧", text: `Water runs out at ${b.name}`,
        confidence: 0.8, source: "Stores", target: baseRef(b),
        why: `${Math.floor(wo.stock)} water in store, ${wo.net} a day (in ${wo.inflow}, drunk and used ${r1(wo.need.total)}): about ${r1(wo.daysLeft)} days. Rain can stretch it; a heat wave shortens it.`,
        go: { base: b.id, tab: "farming" },
      });
    }
  }
}

// Heating: the days below freezing in the forecast against the wood and fuel in store (upkeep.js heatUse: per head;
// wood first, then fuel, half of it kept for the vehicles as woodcutting.js counts it), the kitchen's stove and the
// water boiler burning their share every day (woodNeed daily).
function cold(ctx) {
  const { state } = ctx;
  const fc = forecast(state, ctx.range);
  const temps = [];
  for (let i = 0; i < ctx.days; i++) {
    if (i === 0) { temps.push({ t: null, conf: 1 }); continue; } // today: the day's own (heatUse(state, base))
    const f = fc[i - 1] || fc[fc.length - 1];
    temps.push(f ? { t: (f.hi + f.lo) / 2, lo: f.lo, conf: i <= ctx.range ? f.confidence : 0.4 } : { t: 10, lo: 10, conf: 0.3 });
  }
  for (const b of peopled(state)) {
    if (b.tier === 0) continue; // a shelter's fire keeps it (and its own fire alert)
    if (b.cold) {
      ctx.add({ key: `cold:${b.id}`, day: ctx.today, kind: "cold", level: 3, icon: "🥶", text: `${b.name} is cold: no heating`, confidence: 1, source: "Stores", target: baseRef(b), why: "Below 0°C everyone needs heat a day: wood first, then fuel. Without it they lose mood and health every day and fall ill.", go: { base: b.id, tab: "farming" } });
      continue;
    }
    const wn = woodNeed(state, b);
    let heat = Math.max(0, b.stock.wood || 0) * HEAT.wood + Math.max(0, b.stock.fuel || 0) * 0.5;
    const daily = (wn.boiler + wn.kitchen + wn.fire) * HEAT.wood;
    for (let i = 0; i < ctx.days; i++) {
      const use = i === 0 ? heatUse(state, b).total : heatRateAt(temps[i].t, temps[i].lo) * heatUse(state, b).n; // the nights' fires too (fire-nights)
      heat -= use + daily;
      if (use > 0 && heat < 0) {
        ctx.add({
          key: `cold:${b.id}`, day: ctx.today + i, kind: "cold", level: 2, icon: "🥶", text: `Out of wood and fuel at ${b.name}: cold`,
          confidence: temps[i].conf * 0.9, source: "Stores + forecast", target: baseRef(b),
          why: `${Math.floor(b.stock.wood || 0)} wood and ${Math.floor(b.stock.fuel || 0)} fuel in store; the freezing days ahead need about ${r1(woodFor(use))} wood a day for ${plural(heatUse(state, b).n, "person", "people")}${daily > 0 ? `, and the stove and boiler burn ${r1(wn.boiler + wn.kitchen)} a day` : ""}. Put people on Cut wood or bring fuel.`,
          go: { base: b.id, tab: "farming" },
        });
        break;
      }
    }
  }
}
const woodFor = (fuel) => fuel / HEAT.wood;

// The generators' fuel: days of running left at today's draw (power.js powerStatus), the stores and the tanks.
function power(ctx) {
  const { state } = ctx;
  for (const b of state.bases) {
    const gens = generators(b);
    if (!gens.length) continue;
    const ps = powerStatus(state, b);
    if (!(ps.fuelPerDay > 0) || !ps.running) continue;
    const fuel = Math.max(0, b.stock.fuel || 0) + gens.reduce((a, g) => a + Math.max(0, Number(g.tank) || 0), 0);
    const daysLeft = fuel / ps.fuelPerDay;
    const d = ctx.dayAt(daysLeft * DAY_H);
    if (d > ctx.last) continue;
    const freezer = b.buildings.some((x) => x.type === "freezer" && !x.broken);
    ctx.add({
      key: `gen:${b.id}`, day: d, kind: "power", level: freezer ? 2 : 1, icon: "⛽", text: `Generator fuel runs out at ${b.name}`,
      confidence: 0.75, source: "Stores", target: baseRef(b),
      why: `${Math.floor(fuel)} fuel in store and in the tanks; the generators burn ${ps.fuelPerDay} a day: about ${r1(daysLeft)} days. Then the power goes off${freezer ? ": the freezer thaws and its food starts to spoil" : ""}, and the stations on power stop.`,
      go: { base: b.id, tab: "workshops" },
    });
  }
}

// Illness: the worm reaching the brain (worm.js: day BRAIN_FROM), illness spreading at a base, the sick with no meds.
function sickness(ctx) {
  const { state } = ctx;
  for (const s of alive(state)) {
    const w = wormOf(s);
    if (!w || w.seen == null) continue;
    const base = s.location.kind === "base" ? state.bases.find((b) => b.id === s.location.baseId) : null;
    const go = base ? { base: base.id, tab: "medical" } : { surv: s.id };
    const tgt = { kind: "person", id: s.id, name: firstName(s), tile: base ? base.tile : null };
    if (w.stage === "brain") {
      ctx.add({ key: `worm:${s.id}`, day: ctx.today, kind: "worm", level: 3, icon: "🪱", text: `${firstName(s)}: the worm is in the brain`, confidence: 0.9, source: "Medical", target: tgt, why: `In a day or two it kills ${firstName(s)} and they get up again. Only surgery in a staffed Clinic can save them.${w.locked ? " Locked away: nobody will be hurt." : ""}`, go });
    } else {
      const d = ctx.today + Math.max(1, WORM.BRAIN_FROM - w.day);
      ctx.add({ key: `worm:${s.id}`, day: d, kind: "worm", level: 2, icon: "🪱", text: `${firstName(s)}'s worm reaches the brain`, confidence: 0.85, source: "Medical", target: tgt, why: `Day ${w.day} of the worm in the gut; on day ${WORM.BRAIN_FROM} it reaches the brain, and then only surgery helps. A dewormer cures it for sure before then; a purge (${WORM.PURGE_MEDS} meds and a medic) usually does.`, go });
    }
  }
  for (const b of state.bases) {
    const sick = residents(state, b.id).filter(isContagious);
    if (sick.length < 2) continue;
    ctx.add({ key: `spread:${b.id}`, day: ctx.today, kind: "illness", level: sick.length >= 3 ? 2 : 1, icon: "🦠", text: `${sick.length} contagious at ${b.name}`, confidence: 0.6, source: "Medical", target: baseRef(b), why: `${sick.map(firstName).join(", ")} can pass it on. Treated, an illness barely spreads; quarantine and less crowding help. Three or more is an outbreak.`, go: { base: b.id, tab: "medical" } });
  }
  for (const x of noMedsList(state)) {
    if (x.base) ctx.add({ key: `nomeds:b${x.base.id}`, day: ctx.today, kind: "illness", level: 2, icon: "💊", text: `No meds at ${x.base.name}: ${x.who.length} sick`, confidence: 0.9, source: "Medical", target: baseRef(x.base), why: "Untreated, illness lasts longer, worsens and can kill. Pharmacies, clinics and hospitals have the most; a med station makes them; traders sell them.", go: { base: x.base.id, tab: "medical" } });
    else if (x.party && x.party.owner === "player") ctx.add({ key: `nomeds:p${x.party.id}`, day: ctx.today, kind: "illness", level: 2, icon: "💊", text: `No meds: ${teamLabel(state, x.party)}, ${x.who.length} sick`, confidence: 0.9, source: "Team", target: teamRef(state, x.party), why: "The team carries no meds for its sick. Rest by a fire, search a pharmacy or clinic, or head home.", go: { team: x.party.id } });
  }
}

// Teams in the field: the day a team's people go hungry or thirsty (needs.js: the supplies it carries at the rate it
// eats on the move, plans.js foodDays, then the hunger and thirst gauges running down, NEEDS) before it can be home
// (plans.js hoursHome, parties.js hoursLeft on the way back; never, with no base); and a night march.
function teams(ctx) {
  const { state } = ctx;
  for (const p of fieldTeams(state)) {
    const people = partyMembers(state, p), n = people.length;
    const inTouch = commandable(state, p);
    const conf = inTouch ? 0.8 : 0.5;
    const src = inTouch ? "Team (radio)" : "Team (last report)";
    const fd = foodDays(state, p);
    const wd = teamWater(p) / Math.max(0.1, n * drinkRate(state));
    // Days the gauges hold once the supplies are gone (the emptiest person's).
    const hungerHold = Math.min(...people.map(hungerOf)) / NEEDS.food;
    const thirstHold = Math.min(...people.map(thirstOf)) / (NEEDS.water * drinkRate(state));
    let home = null;
    const before = (hrs) => {
      if (ctx.dayAt(hrs) > ctx.last) return false;
      if (home == null) home = state.bases.length ? (p.phase === "back" ? hoursLeft(state, p) : hoursHome(state, p)) ?? Infinity : Infinity; // no base: nowhere to restock
      return hrs < home;
    };
    const homeText = () => (isFinite(home) ? ` Home is about ${Math.round(home)} h away.` : state.bases.length ? "" : " No base to go back to.");
    const contact = inTouch ? "" : " Out of radio contact: this is as of its last report.";
    const hungry = (fd + hungerHold) * DAY_H, thirsty = (wd + thirstHold) * DAY_H;
    if (before(hungry)) {
      ctx.add({ key: `teamfood:${p.id}`, day: ctx.dayAt(hungry), kind: "teamfood", level: hungry < DAY_H ? 3 : 2, icon: "🥫", text: `${teamLabel(state, p)} goes hungry`, confidence: conf, source: src, target: teamRef(state, p), why: `Food for about ${r1(fd)} days at the rate they eat on the move, then their hunger runs down: about ${Math.round(hungry)} h until it costs health.${homeText()}${contact} Forage, hunt or fish, search a farm or a grocery, or head home.`, go: { team: p.id } });
    }
    if (before(thirsty)) {
      ctx.add({ key: `teamwater:${p.id}`, day: ctx.dayAt(thirsty), kind: "teamwater", level: thirsty < DAY_H ? 3 : 2, icon: "💧", text: `${teamLabel(state, p)} runs dry`, confidence: conf, source: src, target: teamRef(state, p), why: `About ${r1(teamWater(p))} water for ${plural(n, "person", "people")} (${r1(wd)} days), then their thirst runs down: about ${Math.round(thirsty)} h until it costs health.${homeText()}${contact} A river, a well or rain; boil or filter it against the worm.`, go: { team: p.id } });
    }
    if (p.nightPlan === "push" && onTheMove(p)) {
      ctx.add({ key: `night:${p.id}`, day: ctx.today, kind: "night", level: 1, icon: "🌙", text: `${teamLabel(state, p)} marches through the night`, confidence: 0.7, source: "Team orders", target: teamRef(state, p), why: "Pushing on through the night: more run-ins on the road, ambushes more likely, and they tire. Camping each night is the safer plan.", go: { team: p.id } });
    }
  }
}

// The dead massing for a new hive near a base (hivebirth.js siteView: what you saw of the site).
function gatherings(ctx) {
  const { state } = ctx;
  const g = state.grid;
  for (const s of state.hiveSites || []) {
    const v = siteView(state, s.tile);
    if (!v) continue;
    const d = ctx.today + Math.max(0, v.days);
    if (d > ctx.last) continue;
    const near = state.bases.map((b) => ({ b, dist: g.distance(b.tile, s.tile) })).filter((x) => x.dist <= THREAT.GATHER_NEAR).sort((a, b) => a.dist - b.dist)[0];
    if (!near) continue;
    ctx.add({
      key: `hive:${s.id}`, day: d, kind: "hive", level: near.dist <= 5 ? 2 : 1, icon: "🪱", text: `A hive may stand ${plural(near.dist, "tile")} from ${near.b.name}`,
      confidence: v.sure ? 0.6 : 0.3, source: v.live ? "Seen on the map" : "Old sighting", target: baseRef(near.b),
      why: `${v.mass ? `About ${Math.round(v.mass)} of the dead massed there; ` : ""}${v.days <= 0 ? "it may stand any day now" : `a hive in about ${plural(v.days, "day")}`}${v.live ? "" : " (from an old look: a guess)"}. A new hive sends hordes of its own. Break up the gathering (a Cull horde team) before it stands.`,
      go: { tile: s.tile },
    });
  }
}

// The dead on a base's own tile (deadpop.js's pools, read live by the people there: threatknow.js tileThreatEstimate): a
// high tile is a watch for the week, an overrun one a danger; its open ground feeds the grounds attacks and a loud
// fight's reinforcements.
function deadNear(ctx) {
  const { state } = ctx;
  for (const b of peopled(state)) {
    const e = tileThreatEstimate(state, b.tile);
    if (!e || e.dead.band < THREAT.DEAD_WATCH) continue;
    const level = e.dead.band >= THREAT.DEAD_DANGER ? 2 : 1;
    ctx.add({
      key: `deadland:${b.id}`, day: null, kind: "deadland", level, icon: "☠",
      text: `The dead are ${e.dead.word} round ${b.name}`,
      confidence: e.live ? 0.7 : 0.4, source: e.live ? "Seen from the base" : "Last survey", target: baseRef(b),
      why: `About ${e.dead.lo}–${e.dead.hi} of the dead on ${b.name}'s tile and in its places (${e.dead.word} for the land${e.raiders && e.raiders.band ? `; raiders ${e.raiders.word}` : ""}). Its open ground feeds the attacks on the grounds and whatever a loud fight draws in. Kill them quietly, or draw them onto your walls on purpose, to bring the level down.`,
      go: { tile: b.tile },
    });
  }
}

const SOURCES = [hordes, raids, weatherSrc, stores, cold, power, sickness, teams, gatherings, deadNear];
