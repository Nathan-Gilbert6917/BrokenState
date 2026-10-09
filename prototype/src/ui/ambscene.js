// The ambience's ears: where you are listening and what is around you, as plain numbers (no WebAudio), and the plan
// of what to hear there (ui/ambweather.js and ui/ambwild.js play it). UI only: it reads the game and changes nothing.
//
//   ambienceScene(state, ui, mem, now, o)  -> the scene: the listening tile's terrain blended over SCENE.RADIUS tiles,
//                                            its weather (blended at the edge of a front), the hour, the season, the
//                                            battle and its room, how far the map is zoomed out, and the danger that
//                                            silences the wildlife (a seen horde near, a battle, gunfire lately)
//                                            o: { tile, zoom, hourFrac, room }   mem: the caller's (kept between calls)
//   makeScene(over)                        -> a scene from plain values (tools, previews)
//   ambiencePlan(scene)                    -> { beds: levels 0–1, tone, wind, dull, weather: rates, wild: rates, … }
//                                            rates are calls a minute; beds are levels under the ambience slider
import { weatherAt, season, iceRow, frontsApproaching } from "../sim/weather.js";
import { roomOf } from "./gunsfx.js";

export const SCENE = {
  RADIUS: 2, RING_W: [1, 0.55, 0.25], // the listening tile and its two rings, by weight
  HORDE_HUSH: 3, BIG_HORDE: 60,       // a seen horde within this many tiles silences the wildlife (a big one a tile further)
  HIVE_NEAR: 4,                        // a known hive within this many tiles: the wildlife sparse and wrong, flies
  DEATH_NEAR: 3, DEATH_DAYS: 12,       // a death site this near and this fresh draws crows
  GUN_HOLD: 8, GUN_FADE: 60,           // s: silence after the last shot, then the wildlife back over a minute
  FIELD_S: 300,                        // s: crows over a battlefield once the shooting has stopped
  FAR_ZOOM: [0.8, 0.45],               // camera zoom: full detail above the first, only the general bed below the second
  WET_TAU: 150,                        // s: the dripping after rain dies away over a few minutes
  HUSH_UP: 2.5, HUSH_DOWN: 14,         // s: wildlife falls silent fast, comes back slowly
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const gauss = (h, c, w) => { let d = Math.abs(h - c); if (d > 12) d = 24 - d; return Math.exp(-((d / w) ** 2)); };

// ---------- terrain ----------
const CLASS = { forest: "forest", plains: "field", hills: "hills", mountain: "hills", suburb: "town", city: "town", water: "water" };
export const TERRAIN_KEYS = ["forest", "field", "hills", "town", "water"];
// Shares of forest, field, hills, town and water around a tile (weighted by ring), how near a river, a lake or frozen
// water is (1 on it, 0.75 next to it, 0.4 two away) and a base of yours (the tin roofs and gutters).
export function terrainAround(state, tile, radius = SCENE.RADIUS) {
  const out = { forest: 0, field: 0, hills: 0, town: 0, water: 0, river: 0, lake: 0, frozen: 0, base: 0 };
  const g = state && state.grid, T = state && state.tiles;
  if (!g || !T || tile == null || !T[tile]) { out.field = 1; return out; }
  let row = -1;
  if (state.weather) try { row = iceRow(state); } catch { /* no weather yet */ }
  let wsum = 0;
  for (const id of g.within(tile, radius)) {
    const t = T[id];
    if (!t) continue;
    const d = g.distance(tile, id), w = SCENE.RING_W[d] ?? 0;
    if (!w) continue;
    wsum += w;
    const cls = CLASS[t.terrain] || "field";
    if (t.loc && cls !== "water" && cls !== "town") { out.town += w * 0.5; out[cls] += w * 0.5; } // a farmhouse, a cabin, a gas station
    else out[cls] += w;
    if (t.terrain === "water") {
      const near = d === 0 ? 1 : d === 1 ? 0.75 : 0.4;
      if (!t.bridge && t.y <= row) out.frozen = Math.max(out.frozen, near);
      else if (t.river) out.river = Math.max(out.river, near);
      else out.lake = Math.max(out.lake, near);
    }
  }
  if (wsum > 0) for (const k of TERRAIN_KEYS) out[k] /= wsum;
  for (const b of state.bases || []) {
    if (b && b.tile != null && !b.lost) { const d = g.distance(tile, b.tile); if (d <= 1) out.base = Math.max(out.base, d === 0 ? 1 : 0.5); }
  }
  return out;
}

// ---------- the clock ----------
// night 0 by day, 1 at night (the map's shade: dusk 19–21, dawn 5–7); dawn and dusk peak at sunrise (06:00) and sunset
// (19:30); noon peaks in the heat of the afternoon (14:00).
export function dayCurve(h) {
  h = ((h % 24) + 24) % 24;
  const night = h >= 21 || h < 5 ? 1 : h >= 19 ? smooth(19, 21, h) : h < 7 ? 1 - smooth(5, 7, h) : 0;
  return { night, dawn: gauss(h, 6, 1.1), dusk: gauss(h, 19.5, 1.2), noon: gauss(h, 14, 2.6) };
}

// ---------- weather ----------
const WET = { rain: 1, storm: 1 }, WHITE = { snow: 1, blizzard: 1 };
export const rainLevel = (w) => (w && WET[w.key] ? clamp01((Number(w.rain) || 0.45) * 1.05 - 0.03 + (w.key === "storm" ? 0.05 : 0)) : 0);
export const snowLevel = (w) => (w && WHITE[w.key] ? clamp01(0.25 + (Number(w.snow) || 0.5) * 0.75) : 0);
// A world with no weather yet (before its first hour) is read as a fair day: reading must never make it.
function readWx(state, tile) {
  if (!state.weather) return null;
  try {
    const w = weatherAt(state, tile);
    return { key: w.key, wind: Number(w.wind) || 0, rain: Number(w.rain) || 0, snow: Number(w.snow) || 0, temp: Number.isFinite(w.temp) ? w.temp : 12, cover: Number(w.snowCover) || 0 };
  } catch { return null; }
}
// The listening tile's weather, with the rain, snow, wind and storm of the tiles two away mixed in (half and half):
// at the edge of a front the rain is heard thinning out, a storm next door rumbles.
function blendWx(state, tile) {
  const c = readWx(state, tile);
  if (!c) return null;
  const g = state.grid;
  const ring = g ? g.within(tile, 2).filter((id) => g.distance(tile, id) === 2) : [];
  const pick = ring.filter((_, i) => i % 2 === 0).slice(0, 6);
  let rain = 0, snow = 0, wind = 0, storm = 0, n = 0;
  for (const id of pick) {
    const w = readWx(state, id);
    if (!w) continue;
    rain += rainLevel(w); snow += snowLevel(w); wind += w.wind; storm += w.key === "storm" ? 1 : 0; n++;
  }
  const k = n ? 0.5 / n : 0, kc = n ? 0.5 : 1;
  return {
    ...c, rainI: rainLevel(c) * kc + rain * k, snowI: snowLevel(c) * kc + snow * k, wind: c.wind * kc + wind * k,
    storm: (c.key === "storm" ? 1 : 0) * kc + storm * k,
  };
}
// A storm front coming: 0 none, up to 1 as it arrives (heard as far thunder, the wind picking up), from the fronts
// you can see on the map (sim/weather.js frontsApproaching).
function approachOf(state, tile) {
  let best = 0;
  if (!state.weather) return 0;
  try {
    for (const f of frontsApproaching(state, tile, 8)) {
      if (f.k !== "storm" || f.over) continue;
      const byEta = f.eta != null ? clamp01(1 - (f.eta - 1) / 5) : 0;
      const byDist = clamp01(1 - f.dist / 8) * 0.6;
      best = Math.max(best, byEta, byDist);
    }
  } catch { /* no fronts */ }
  return best;
}

// ---------- the scene ----------
const BASE = () => ({
  mode: "map", tile: null, hour: 12, season: "summer", night: 0, dawn: 0, dusk: 0, noon: 0,
  wx: { key: "clear", wind: 0.2, rainI: 0, snowI: 0, temp: 15, cover: 0, storm: 0 },
  ter: { forest: 0, field: 1, hills: 0, town: 0, water: 0, river: 0, lake: 0, frozen: 0, base: 0 },
  indoor: false, room: "field", far: 0, battle: false,
  hush: { horde: 0, battle: 0, gun: 0, all: 0 }, hive: 0, death: 0, field: 0, approach: 0, wet: 0, flush: false, titleStorm: 0,
});
// A scene from plain values (tools, previews): over { hour, season, wx: {…}, ter: {…}, … }; dawn, dusk and night from
// the hour unless given.
export function makeScene(over = {}) {
  const s = BASE();
  const h = over.hour ?? s.hour;
  Object.assign(s, dayCurve(h), over, { wx: { ...s.wx, ...(over.wx || {}) }, ter: { ...s.ter, ...(over.ter || {}) }, hush: { ...s.hush, ...(over.hush || {}) } });
  if (over.wx && over.wx.rainI == null) s.wx.rainI = rainLevel(s.wx);
  if (over.wx && over.wx.snowI == null) s.wx.snowI = snowLevel(s.wx);
  if (over.wx && over.wx.storm == null) s.wx.storm = s.wx.key === "storm" ? 1 : 0;
  s.hush.all = Math.max(s.hush.horde, s.hush.battle, s.hush.gun, s.hush.all || 0);
  return s;
}

// mem: { lastShot, seq, battle, fieldTile, fieldAt, hushS, wet, t, key, cache }
export function ambienceScene(state, ui, mem, now, o = {}) {
  const s = BASE();
  if (!ui || ui.timelapse) { s.mode = "off"; return s; }
  if (ui.title || !ui.started) { s.mode = "title"; s.night = 1; s.titleStorm = o.titleStorm || 0; return s; }
  if (!state) { s.mode = "off"; return s; }
  const dt = mem.t != null ? Math.max(0, Math.min(2, now - mem.t)) : 0;
  mem.t = now;
  const b = state.combat || null;
  // Gunfire (combat.js fx: a shot, a blast): remembered by the clock, so the silence outlasts the battle.
  if (b) {
    if (mem.battle !== b) { mem.battle = b; mem.seq = b.fxSeq || 0; }
    for (const f of b.fx || []) {
      if (f.seq <= mem.seq) continue;
      if ((f.type === "shot" && !f.misfire) || (f.type === "throw" && f.kind !== "smoke" && f.kind !== "bottle")) mem.lastShot = now;
    }
    if (b.fx && b.fx.length) mem.seq = Math.max(mem.seq, b.fx[b.fx.length - 1].seq || 0);
  } else if (mem.battle) { // a battle just ended: its field draws crows once the shooting has stopped
    mem.fieldTile = mem.battle.setup ? mem.battle.setup.tile : null;
    mem.fieldAt = now;
    mem.battle = null;
  }
  const tile = o.tile ?? (b && b.setup ? b.setup.tile : null);
  s.mode = b ? "battle" : "map";
  s.battle = !!b;
  s.tile = tile;
  const hour = ((state.hour || 0) % 24) + (o.hourFrac || 0);
  s.hour = hour;
  Object.assign(s, dayCurve(hour));
  try { s.season = season(state).key; } catch { /* a bare state */ } // (the calendar only: it makes nothing)
  // Terrain and weather: kept until the tile or the hour changes (a front moves by the hour).
  const key = `${tile}|${state.hour}|${b ? 1 : 0}`;
  if (mem.key !== key || !mem.cache) {
    mem.key = key;
    const ter = terrainAround(state, tile, b ? 1 : SCENE.RADIUS);
    const wx = tile != null ? blendWx(state, tile) : null;
    mem.cache = { ter, wx, approach: tile != null ? approachOf(state, tile) : 0, death: deathNear(state, tile), hive: hiveNear(state, tile) };
  }
  const C = mem.cache;
  s.ter = C.ter;
  if (C.wx) s.wx = { key: C.wx.key, wind: C.wx.wind, rainI: C.wx.rainI, snowI: C.wx.snowI, temp: C.wx.temp, cover: C.wx.cover, storm: C.wx.storm };
  s.approach = C.approach;
  s.death = C.death;
  s.hive = C.hive;
  // Where: a battle's room (indoors in a building raid), the zoom on the map.
  if (b) { s.room = o.room || safeRoom(state, b); s.indoor = s.room === "inside"; }
  else {
    const z = Number(o.zoom);
    s.far = Number.isFinite(z) ? clamp01((SCENE.FAR_ZOOM[0] - z) / (SCENE.FAR_ZOOM[0] - SCENE.FAR_ZOOM[1])) : 0;
  }
  // Danger: the wildlife falls silent.
  const hordeNow = b ? 0 : hordeHush(state, tile);
  const target = hordeNow;
  const prev = mem.hushS ?? target;
  const tau = target > prev ? SCENE.HUSH_UP : SCENE.HUSH_DOWN;
  mem.hushS = dt > 0 ? prev + (target - prev) * (1 - Math.exp(-dt / tau)) : target;
  s.hush.horde = Math.round(mem.hushS * 1000) / 1000;
  s.hush.battle = b ? 1 : 0;
  s.hush.gun = gunHush(mem.lastShot, now);
  s.hush.all = Math.max(s.hush.horde, s.hush.battle, s.hush.gun);
  // The birds flushed: as the silence falls, one alarm call.
  const was = mem.flushHush ?? s.hush.all;
  s.flush = was < 0.3 && s.hush.all >= 0.3 && !b;
  mem.flushHush = s.hush.all;
  // A battlefield after the fight: crows come in as the silence lifts.
  s.field = mem.fieldAt != null && mem.fieldTile != null && tile != null && state.grid && state.grid.distance(tile, mem.fieldTile) <= 2 ? clamp01(1 - (now - mem.fieldAt) / SCENE.FIELD_S) : 0;
  // Wet: rain falling now, then the dripping after it stops.
  const r = s.wx.rainI || 0;
  const w0 = mem.wet ?? r;
  mem.wet = r > w0 ? w0 + (r - w0) * (1 - Math.exp(-dt / 8)) : w0 * Math.exp(-dt / SCENE.WET_TAU);
  s.wet = Math.round(mem.wet * 1000) / 1000;
  return s;
}
const safeRoom = (state, b) => { try { return roomOf(state, b); } catch { return "field"; } };
export function gunHush(lastShot, now) {
  if (lastShot == null) return 0;
  const since = now - lastShot;
  return since < SCENE.GUN_HOLD ? 1 : clamp01(1 - (since - SCENE.GUN_HOLD) / SCENE.GUN_FADE);
}
// A horde you can see within SCENE.HORDE_HUSH tiles (a big one a tile further): 1 close, fading over the last tiles.
// The ones out of sight do not count: the silence never gives away a horde the map does not show.
export function hordeHush(state, tile) {
  const g = state.grid;
  if (!g || tile == null || !state.hordes || !state.hordes.length) return 0;
  let best = 0;
  for (const h of state.hordes) {
    if (!h || h.tile == null || !(state.live && state.live.has(h.tile))) continue;
    const r = SCENE.HORDE_HUSH + ((h.size || 0) >= SCENE.BIG_HORDE ? 1 : 0), d = g.distance(tile, h.tile);
    const v = d <= r - 1 ? 1 : d <= r ? 0.65 : d <= r + 1 ? 0.25 : 0;
    if (v > best) best = v;
  }
  return best;
}
function hiveNear(state, tile) {
  const g = state.grid;
  if (!g || tile == null) return 0;
  let best = 0;
  for (const hv of state.hives || []) {
    if (!hv || hv.tile == null) continue;
    const known = state.live && state.live.has(hv.tile) ? !!(state.tiles[hv.tile] || {}).hive : !!(state.knowledge && state.knowledge[hv.tile] && state.knowledge[hv.tile].hive);
    if (!known) continue;
    const d = g.distance(tile, hv.tile);
    if (d <= SCENE.HIVE_NEAR) best = Math.max(best, 1 - d / (SCENE.HIVE_NEAR + 1));
  }
  return Math.round(best * 100) / 100;
}
function deathNear(state, tile) {
  const g = state.grid;
  if (!g || tile == null || !state.deathSites || !state.deathSites.length) return 0;
  const today = Math.floor((state.hour || 0) / 24) + 1;
  let best = 0;
  for (const d of state.deathSites) {
    if (!d || d.tile == null) continue;
    const dist = g.distance(tile, d.tile);
    if (dist > SCENE.DEATH_NEAR) continue;
    const age = Math.max(0, today - (d.lastConfirmed || d.day || today));
    best = Math.max(best, (1 - dist / (SCENE.DEATH_NEAR + 1)) * clamp01(1 - age / SCENE.DEATH_DAYS));
  }
  return Math.round(best * 100) / 100;
}

// ---------- the plan ----------
// Wildlife: calls a minute at full (per), by season, by time of day, by terrain share; wet: × in rain; the rest by
// the rules in wildRates. tod: day (light hours), dawnday (a chorus at sunrise), night, dusknight, any.
export const WILD = {
  songRobin:   { per: 3.2, season: { spring: 1, summer: 0.8, autumn: 0.25, winter: 0 }, tod: "dawnday", ter: { forest: 1, field: 0.7, hills: 0.8, town: 0.45, water: 0.6 }, wet: 0.12 },
  songWarbler: { per: 2.2, season: { spring: 1, summer: 0.7, autumn: 0.1, winter: 0 }, tod: "dawnday", ter: { forest: 1, field: 0.45, hills: 0.7, town: 0.2, water: 0.7 }, wet: 0.08 },
  songWhistle: { per: 1.4, season: { spring: 1, summer: 0.6, autumn: 0.55, winter: 0.4 }, tod: "dawnday", ter: { forest: 1, field: 0.5, hills: 0.8, town: 0.5, water: 0.5 }, wet: 0.15 },
  songFinch:   { per: 2, season: { spring: 0.9, summer: 1, autumn: 0.5, winter: 0.12 }, tod: "dawnday", ter: { forest: 0.5, field: 1, hills: 0.6, town: 0.8, water: 0.5 }, wet: 0.1 },
  crow:        { per: 1.1, season: { spring: 1, summer: 0.9, autumn: 1.1, winter: 1.1 }, tod: "day", ter: { forest: 0.35, field: 1, hills: 0.5, town: 1, water: 0.5 }, wet: 0.5 },
  raven:       { per: 0.3, season: { spring: 0.8, summer: 0.7, autumn: 1, winter: 1.3 }, tod: "day", ter: { forest: 0.7, field: 0.3, hills: 1, town: 0.3, water: 0.3 }, wet: 0.4 },
  owlHoot:     { per: 1.1, season: { spring: 0.8, summer: 0.6, autumn: 0.9, winter: 1.2 }, tod: "night", ter: { forest: 1, field: 0.2, hills: 0.5, town: 0.12, water: 0.3 }, wet: 0.2 },
  owlScreech:  { per: 0.35, season: { spring: 1, summer: 0.8, autumn: 1, winter: 0.7 }, tod: "night", ter: { forest: 0.8, field: 0.3, hills: 0.3, town: 0.6, water: 0.3 }, wet: 0.2 },
  geese:       { per: 0.45, season: { spring: 1, summer: 0.08, autumn: 1, winter: 0.04 }, tod: "daydusk", ter: { forest: 0.7, field: 1, hills: 0.8, town: 0.6, water: 1.6 }, wet: 0.5 },
  ducks:       { per: 1, season: { spring: 1, summer: 0.7, autumn: 0.9, winter: 0 }, tod: "day", ter: { forest: 1, field: 1, hills: 1, town: 0.6, water: 1 }, wet: 0.7, water: true },
  woodpecker:  { per: 0.7, season: { spring: 1, summer: 0.7, autumn: 0.6, winter: 0.4 }, tod: "day", ter: { forest: 1, field: 0.1, hills: 0.4, town: 0.1, water: 0.2 }, wet: 0.1 },
  bullfrog:    { per: 1.3, season: { spring: 0.3, summer: 1, autumn: 0.1, winter: 0 }, tod: "dusknight", ter: { forest: 1, field: 1, hills: 1, town: 0.5, water: 1 }, wet: 0.8, water: true, warm: 12 },
  dogBark:     { per: 0.4, season: { spring: 1, summer: 1, autumn: 1, winter: 1 }, tod: "any", ter: { forest: 0.1, field: 0.35, hills: 0.15, town: 1, water: 0.1 }, wet: 0.5, nightK: 1.4 },
  dogHowl:     { per: 0.1, season: { spring: 1, summer: 1, autumn: 1, winter: 1.2 }, tod: "night", ter: { forest: 0.1, field: 0.3, hills: 0.2, town: 1, water: 0.1 }, wet: 0.3 },
  wolfHowl:    { per: 0.06, season: { spring: 0.7, summer: 0.6, autumn: 1, winter: 1.5 }, tod: "night", ter: { forest: 0.6, field: 0.1, hills: 1, town: 0, water: 0.1 }, wet: 0.2 },
  coyote:      { per: 0.08, season: { spring: 1, summer: 1, autumn: 1, winter: 0.8 }, tod: "dusknight", ter: { forest: 0.4, field: 1, hills: 0.8, town: 0.15, water: 0.2 }, wet: 0.2 },
  elkBugle:    { per: 0.35, season: { spring: 0, summer: 0, autumn: 1, winter: 0 }, tod: "dusknight", ter: { forest: 1, field: 0.3, hills: 1, town: 0, water: 0.4 }, wet: 0.4 },
  rustle:      { per: 0.6, season: { spring: 1, summer: 1, autumn: 1, winter: 0.25 }, tod: "any", ter: { forest: 1, field: 0.6, hills: 0.7, town: 0.2, water: 0.2 }, wet: 0.3, nightK: 0.6 },
};
// Insects and frogs (continuous beds): by season, warmth, time and terrain.
const BUGS = {
  crickets: { season: { spring: 0.3, summer: 1, autumn: 0.6, winter: 0 }, warm: [10, 16], ter: { forest: 0.6, field: 1, hills: 0.85, town: 0.45, water: 0.5 } },
  frogs:    { season: { spring: 1, summer: 0.65, autumn: 0.1, winter: 0 }, warm: [6, 12] },
  cicadas:  { season: { spring: 0, summer: 1, autumn: 0.2, winter: 0 }, warm: [23, 30], ter: { forest: 1, field: 0.7, hills: 0.7, town: 0.6, water: 0.5 } },
};
// How much the danger lets the wildlife call: nothing once the silence is nearly whole.
const hushLet = (s) => Math.max(0, 1 - (s.hush.all || 0) * 1.15);
const terShare = (ter, w) => TERRAIN_KEYS.reduce((a, k) => a + (ter[k] || 0) * (w[k] ?? 0), 0);
function todOf(s, tod) {
  const day = 1 - s.night;
  switch (tod) {
    case "dawnday": return day + s.dawn * 2.6 + s.dusk * 0.4; // the dawn chorus: about 3.5× around sunrise, starting before light
    case "day": return day;
    case "night": return s.night;
    case "daydusk": return day + s.dusk * 0.8;
    case "dusknight": return Math.min(1.3, s.night + s.dusk * 0.8 + s.dawn * 0.4);
    default: return 1;
  }
}
// How the weather lets the wildlife call (birds, mammals): rain × wet, none in a storm or blizzard, little in fog,
// snow or a gale, less in the hard cold.
function wxLet(s, wet) {
  const w = s.wx, k = w.key;
  if (k === "storm" || k === "blizzard") return 0;
  let f = 1;
  if (w.rainI > 0.05) f *= wet + (1 - wet) * (1 - Math.min(1, w.rainI * 1.6));
  if (k === "fog") f *= 0.45;
  if (k === "snow") f *= 0.3;
  if (w.wind > 0.7) f *= 0.5;
  if (w.temp < 0) f *= 0.55;
  return f;
}
export function wildRates(s) {
  const out = {};
  const water = Math.max(s.ter.lake, s.ter.river * 0.6);
  const hush = hushLet(s), hive = 1 - 0.75 * (s.hive || 0);
  const place = s.indoor ? 0.06 : 1;
  const detail = 1 - s.far;
  for (const [name, W] of Object.entries(WILD)) {
    let r = W.per * (W.season[s.season] ?? 0) * todOf(s, W.tod) * terShare(s.ter, W.ter) * wxLet(s, W.wet);
    if (W.water) r *= water;
    if (W.warm != null && s.wx.temp < W.warm) r *= 0.2;
    if (W.nightK) r *= 1 + (W.nightK - 1) * s.night;
    if (name === "geese") r *= 1 + water * 0.6;
    if (name === "crow" || name === "raven") r *= 1 + 3 * (s.death || 0) + 3 * (s.field || 0) * (1 - (s.hush.gun || 0)); // carrion
    r *= hush * hive * place * detail;
    out[name] = Math.round(r * 1000) / 1000;
  }
  // Flies: over a hive and a fresh death site (the dead do not scare them off).
  out.flies = Math.round(((s.hive || 0) * 2.5 + (s.death || 0) * 1.5) * (s.season === "winter" ? 0.15 : 1) * (s.wx.temp > 4 ? 1 : 0.2) * place * detail * 1000) / 1000;
  return out;
}
function bugLevel(s, B, timeF) {
  let v = (B.season[s.season] ?? 0) * smooth(B.warm[0], B.warm[1], s.wx.temp) * timeF;
  if (B.ter) v *= terShare(s.ter, B.ter);
  const k = s.wx.key;
  if (k === "storm" || k === "blizzard" || k === "snow") v *= 0;
  else if (s.wx.rainI > 0.05) v *= 0.25;
  if (s.wx.wind > 0.6) v *= 0.6;
  if (k === "fog") v *= 0.7;
  return v;
}
// The plan: bed levels and tones, the wind, how dull each group is, and the one-shots' rates.
export function ambiencePlan(s) {
  const P = {
    mode: s.mode,
    beds: { windLow: 0, windMid: 0, windHigh: 0, rainWash: 0, drone: 0, river: 0, lake: 0, crickets: 0, frogs: 0, cicadas: 0 },
    tone: { low: 160, mid: 520, high: 1500, washHp: 1500, washLp: 7000 },
    wind: { base: 0, gusty: 0.4 }, dull: { weather: 0, wildlife: 0 },
    weather: {}, wild: {}, wrong: 0, far: s.far || 0, flush: !!s.flush, fog: s.wx.key === "fog", indoor: !!s.indoor, storm: s.wx.storm || 0,
  };
  if (s.mode === "off") return P;
  if (s.mode === "title") { // the title and new-run screens: wind and the drone (and rain while the title's storm flashes)
    P.wind.base = 0.42; P.wind.gusty = 0.55;
    windBeds(P, 0.42, { forest: 0, field: 1, hills: 0, town: 0 }, false, false);
    P.beds.drone = 0.45;
    if (s.titleStorm > 0) { P.beds.rainWash = 0.5 * s.titleStorm; P.tone.washHp = 1100; P.tone.washLp = 6500; }
    return P;
  }
  const w = s.wx, ter = s.ter, k = w.key;
  const fog = k === "fog", blizzard = k === "blizzard", snowing = w.snowI > 0.02;
  // Wind: the weather's (calm in fog), more in a blizzard and as a storm comes.
  const wind = Math.max(0, Math.min(1, fog ? 0.04 : w.wind + (blizzard ? 0.12 : 0) + 0.15 * (s.approach || 0)));
  P.wind.base = wind;
  P.wind.gusty = 0.3 + 0.5 * wind;
  windBeds(P, wind, ter, snowing && !blizzard, blizzard);
  // Rain and snow: the wash, drizzle to downpour; the snow's hush.
  const r = w.rainI || 0;
  if (r > 0.01) {
    P.beds.rainWash = Math.pow(r, 0.75);
    P.tone.washHp = 2600 - 1900 * r; // drizzle is fine and high, a downpour fills the whole band
    P.tone.washLp = 5200 + 3800 * r;
    const roar = Math.max(0, r - 0.5) * 1.4 + (w.storm || 0) * 0.25; // a storm's low roar under it (shares the low wind bed)
    P.beds.windLow = Math.hypot(P.beds.windLow, roar);
    P.tone.low = 160 + 260 * Math.min(1, roar / Math.max(0.01, P.beds.windLow));
  } else if (snowing) {
    P.beds.rainWash = 0.32 * Math.pow(w.snowI, 0.8);
    P.tone.washHp = 450; P.tone.washLp = 2300;
  }
  // The night drone.
  P.beds.drone = 0.2 + s.night * 0.65;
  // Water: a river running, a lake lapping (more with the wind); frozen water is still (it creaks instead).
  P.beds.river = ter.river * (s.indoor ? 0.15 : 1);
  P.beds.lake = ter.lake * (0.55 + 0.6 * wind) * (s.indoor ? 0.15 : 1);
  // Insects and frogs (wildlife): fall silent with the danger.
  const hush = hushLet(s), hive = 1 - 0.7 * (s.hive || 0), place = s.indoor ? 0.05 : 1;
  P.beds.crickets = bugLevel(s, BUGS.crickets, Math.pow(s.night, 0.7)) * hush * hive * place;
  P.beds.frogs = bugLevel(s, BUGS.frogs, Math.min(1, Math.pow(s.night, 0.8) + s.dusk * 0.5)) * Math.max(ter.lake, ter.river * 0.55) * (r > 0.05 && s.season === "spring" ? 3 : 1) * hush * hive * place;
  P.beds.cicadas = bugLevel(s, BUGS.cicadas, (1 - s.night) * (0.35 + 0.65 * s.noon)) * (k === "heat" ? 1.2 : 1) * hush * hive * place;
  // Zoomed far out: only a soft general bed, no water or insect detail.
  if (s.far > 0) {
    const d = 1 - 0.7 * s.far;
    for (const b of ["river", "lake", "crickets", "frogs", "cicadas"]) P.beds[b] *= d;
  }
  for (const b of Object.keys(P.beds)) P.beds[b] = Math.round(Math.min(1.3, P.beds[b]) * 1000) / 1000;
  // Dulling: indoors the weather comes through the walls; snow cover and fog muffle the world.
  const cover = w.cover || 0;
  const open = 0;
  let air = cover > 0.2 ? 6500 - 2500 * Math.min(1, cover) : open;
  if (fog) air = air ? Math.min(air, 4200) : 4200;
  P.dull.weather = s.indoor ? 650 : air;
  P.dull.wildlife = s.indoor ? 1100 : air;
  // One-shot rates.
  P.weather = weatherRates(s, wind, r);
  P.wild = wildRates(s);
  P.wrong = s.hive || 0;
  return P;
}
function windBeds(P, wind, ter, softSnow, blizzard) {
  const open = (ter.field || 0) + (ter.hills || 0);
  P.beds.windLow = (0.12 + 0.88 * wind) * (0.8 + 0.4 * open) * (P.indoor ? 0.5 : 1);
  P.beds.windMid = (0.08 + 0.85 * wind) * (1 + 0.45 * (ter.forest || 0)) * (P.indoor ? 0.3 : 1);
  P.beds.windHigh = Math.max(0, (wind - 0.3) / 0.7) * (0.55 + 0.8 * (ter.town || 0) + 0.3 * (ter.hills || 0)) * (softSnow ? 0.45 : blizzard ? 1.3 : 1) * (P.indoor ? 0.25 : 1);
  P.tone.mid = (softSnow ? 300 : 360) + 520 * wind - 80 * (ter.forest || 0);
  P.tone.high = 900 + 1300 * wind + 350 * (ter.town || 0) + (blizzard ? 300 : 0);
  P.tone.low = 160;
}
function weatherRates(s, wind, r) {
  const ter = s.ter, detail = 1 - s.far, out = {};
  const town = Math.min(1, ter.town + ter.base * 0.8);
  const st = s.wx.storm || 0;
  // Thunder: under a storm near cracks and rolling far rumbles (about one every 25 s together, as before); a storm
  // next door or one coming rumbles far off.
  out.thunderNear = st > 0.5 ? 0.9 * st : 0;
  out.thunderFar = st > 0.05 ? 1.5 * st : 0;
  out.thunderDistant = Math.max(s.approach || 0, st > 0 && st < 0.5 ? 0.8 : 0) * 1.6;
  // Drops by surface (clusters a minute): leaves in the forest, tin roofs and gutters in towns and at your bases,
  // puddles in the open; dripping for a while after the rain stops (and in fog under trees).
  const rr = Math.pow(r, 0.6);
  const indoor = s.indoor;
  out.dropLeaf = (indoor ? 0 : ter.forest) * 34 * rr * detail;
  out.dropTin = (indoor ? 1 : town) * 26 * rr * detail;
  out.dropGutter = (indoor ? 0.5 : town) * 10 * Math.pow(r, 0.5) * detail;
  out.dropPuddle = (indoor ? 0 : ter.field + ter.water + ter.hills * 0.6 + town * 0.3) * 20 * rr * detail;
  const dripWet = r < 0.08 ? Math.max(s.wet || 0, s.wx.key === "fog" ? 0.35 * (ter.forest + town) : 0) : 0;
  out.drip = (ter.forest + town * 0.8 + (indoor ? 0.6 : 0)) * 16 * dripWet * detail;
  // The wind's loose things (more in the gusts): metal sheets, hinges and shutters in towns, leaves and branches.
  const gale = Math.max(0, wind - 0.2);
  out.rattle = (indoor ? 0.3 : town) * 4 * gale * detail;
  out.creak = (indoor ? 0.5 : town) * (0.6 + 3 * gale) * detail;
  out.shutter = (indoor ? 0.3 : town) * 3 * Math.max(0, wind - 0.45) * detail;
  out.leaves = (indoor ? 0 : ter.forest) * (s.season === "winter" ? 0.4 : 1) * 6 * Math.max(0, wind - 0.12) * detail;
  out.branch = (indoor ? 0 : ter.forest) * 3 * Math.max(0, wind - 0.4) * detail;
  // Ice: frozen water creaks and groans, more as the night cold deepens.
  out.iceGroan = ter.frozen * (0.9 + 0.9 * s.night) * (indoor ? 0.2 : 1) * detail;
  out.icePing = ter.frozen * (0.7 + 0.8 * s.night) * (indoor ? 0.1 : 1) * detail;
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 1000) / 1000;
  return out;
}
