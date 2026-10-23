// @ts-check
// Seasonal weather in play on a fight's, a raid's or a base's map (the user's request 2026-10-23: "in winter the ground
// is covered in snow and slows people. ice can form and has a chance to trip people. In spring it rains more often and
// show rain fog can occur to that limit visibility range and rain obscures some sounds and renders some distractions
// null"; and, the same day, "when night and foggy the vision is really reduced").
// The weather of the battle's tile at the hour it starts (weather.js weatherAt; it holds for the fight: a fight is
// minutes) is noted once, as the map is made (seasonBattle, from combat.js createBattle / createRaid right after
// ponds.js pondsBattle): b.sfx { snow, snowStep, ice, rain, fog, fogWhy }. Everyone obeys the same rules: your people,
// raiders, soldiers, the third side and the dead (docs/adr/0001-ai-parity.md).
//   - Snow (SNOW): in winter (WINTER deep at least), under falling snow (FALLING) or wherever the tile's snow cover
//     lies (weather.js snowCover), open ground is snow: a step into it costs snowStep more moves (COST × the depth over
//     FULL, MIN to MAX of it: half cover or a winter's day +0.5, a blizzard's drifts +0.75), a road ROAD of that (worn
//     down), nothing on a floor indoors, a roof, a pond (its own cost: ponds.js wetCost) or ice (groundCost: combat.js
//     reachable and distField, the dead's way round as everyone's).
//   - Ice (ICE): freezing (the hour's temperature at or below 0 °C, frozen ground, or the hollows' ponds iced over) and
//     wet (snow lying, mud, rain or snow falling, a pond in the hollows): a frozen pond (ponds.js c.wet "ice"), ROAD of a
//     road's cells and PUDDLE of open ground's (frozen puddles: c.ice, by the tile, the day and the cell, no dice of the
//     battle's) are ice. A step onto ice costs COST more and SLIP to slip (careful: sneaking ×CAREFUL, Light Step
//     ×LIGHT): the move ends there, the rest of the turn is spent getting up (u.ap 0) and the fall hurts HURT
//     (slipStep, from combat.js moveAlong; the battle's own dice: armour.js battleDice "slip", so a replay is the same).
//   - Rain (b.sfx.rain "rain" | "storm"): noise carries HEAR[rain] as far (muffle: combat.js alertNear, stealth.js
//     noiseAt and the lures, a guard hearing feet behind them, your people hearing the unseen: hearing.js heardGhosts);
//     a noise that would carry less than QUIET tiles is not heard at all; a noise lure (a bottle, a noise maker, an
//     alarm clock...) that would carry less than LURE tiles is drowned out (drowned: thrown, it pulls nobody; the AI
//     does not throw it). A flare (light) and heat lures work as ever. Indoors (a floor) the rain changes nothing.
//   - Fog (FOG): by day a fog bank (weather.js "fog") is wxsight.js's (everyone's day sight WX_SIGHT.fog less, every
//     side: the raid-weatherfx work); rain fog (weather.js rainFog: on some rain days, more in spring and at dawn) takes
//     the same cut through the same code (b.wxSight, wxsight.js fogEyes (the weather stays the rain's). This file adds
//     the night: at night in fog (the user's word: "really reduced") the dark ahead is NIGHT tiles (below the darkest
//     night's 4 and the day's fog cut: the fog takes what little light there is), a light's beam or pool and night
//     vision LIGHT of their reach (the beam scatters in the murk), never less than NIGHT. One place: fogSight (combat.js
//     sightRange: those with no front), nightFogEyes (vision.js nightEyes) and the guards' noticing range (stealth.js
//     noticeRange: fogNotice). Indoors (a floor) the fog changes nothing.
// UI: the battle's conditions line (conditions: "Snow: moves +50%", "Ice", "Rain fog: sight 7", "Night fog: sight 3",
// "Rain: sounds carry less"), the hover (cellWord) and the move preview (pathWord) in ui/combat.js.
import { weatherAt, season, rainFog } from "./weather.js";
import { WX_SIGHT, WX_SIGHT_MIN } from "./wxsight.js"; // the day's fog cut to sight (the battle's fog: everyone alike)
import { hash01 } from "./skills.js";
import { battleDice } from "./armour.js";
import { coned, activeLight, nvgOn, nvgSight, VISION } from "./vision.js"; // call-time only (vision.js calls nightFogEyes)
import { LIGHTS } from "./lights.js";
/** @import { State } from "./types" */

export const SEASONFX = {
  SNOW: { COST: 0.5, FULL: 0.5, MIN: 0.5, MAX: 1.5, WINTER: 0.5, FALLING: 0.3, LEAST: 0.05, ROAD: 0.5 },
  ICE: { SLIP: 0.1, CAREFUL: 0.5, LIGHT: 0.75, HURT: [1, 3], COST: 0.25, ROAD: 0.3, PUDDLE: 0.03 },
  HEAR: { rain: 0.6, storm: 0.45, QUIET: 3, LURE: 6.5 },
  FOG: { NIGHT: 3, LIGHT: 0.5 }, // by day the cut is wxsight.js WX_SIGHT.fog
};
const { SNOW, ICE, HEAR, FOG } = SEASONFX;
const r2 = (v) => Math.round(v * 100) / 100;
// The ground snow lies on (c.f): its share of the step's cost. A floor, a roof, the air: none.
const SNOW_ON = { grass: 1, dirt: 1, field: 1, road: SNOW.ROAD };
const cellOf = (b, x, y) => (b && b.cells && b.w && x >= 0 && y >= 0 && x < b.w ? b.cells[y * b.w + x] : null);
// Inside a building: a floor (building maps, a raid's interiors, the base's buildings).
const indoorCell = (b, x, y) => { const c = cellOf(b, x, y); return !!(c && (c.f === "floor" || c.indoor)); };

// ---------- the battle's weather ----------
/**
 * The weather on the battle's map, noted once as it is made (b.sfx), and the ice laid on its cells (c.ice). Nothing on
 * a map with no tile. Returns b.sfx (or null: fair weather).
 * @param {State} state @param {any} b @param {number | null} tileId
 */
export function seasonBattle(state, b, tileId) {
  delete b.sfx;
  if (tileId == null || !state || !state.tiles || !b || !b.cells) return null;
  let w;
  try { w = weatherAt(state, tileId, state.hour); } catch { return null; }
  if (!w) return null;
  const winter = season(state).key === "winter";
  /** @type {any} */
  const fx = {};
  // Snow lying on open ground.
  const depth = Math.max(w.snowCover || 0, winter ? SNOW.WINTER : 0, (w.snow || 0) > 0 ? SNOW.FALLING : 0);
  if (depth >= SNOW.LEAST) { fx.snow = r2(Math.min(1, depth)); fx.snowStep = r2(SNOW.COST * Math.min(SNOW.MAX, Math.max(SNOW.MIN, depth / SNOW.FULL))); }
  // Ice: freezing and wet.
  const freezing = (w.temp ?? 99) <= 0 || !!w.frozen || !!(b.ponds && b.ponds.ice);
  const wet = (w.snowCover || 0) >= 0.05 || (w.mud || 0) >= 0.1 || (w.rain || 0) > 0 || (w.snow || 0) > 0 || !!b.ponds;
  if (freezing && wet) {
    const day = Math.floor(state.hour / 24);
    let n = 0;
    for (let i = 0; i < b.cells.length; i++) {
      const c = b.cells[i];
      if (c.wet === "ice") { n++; continue; }
      if (c.k !== "open" || c.wet) continue;
      const p = c.f === "road" ? ICE.ROAD : SNOW_ON[c.f] ? ICE.PUDDLE : 0;
      if (p && hash01("ice", tileId, day, i) < p) { c.ice = true; n++; }
    }
    if (n) fx.ice = n;
  }
  // Rain: sounds carry less.
  if ((w.rain || 0) > 0 && (w.key === "rain" || w.key === "storm")) fx.rain = w.key;
  // Fog: a fog bank, or rain fog.
  if (w.key === "fog") { fx.fog = true; fx.fogWhy = "Fog"; } // its day cut is wxsight.js's, noted as the battle is set up
  else if (fx.rain) {
    let rf = false;
    try { rf = rainFog(state, tileId, state.hour); } catch { rf = false; }
    if (rf) { // the same cut as a fog bank, through wxsight.js (stealthSetup applies it to every unit, newcomers too)
      fx.fog = true; fx.fogWhy = "Rain fog";
      if (b.wx == null) { b.wx = w.key; b.wxSight = WX_SIGHT.fog; }
      b.wxFog = "Rain fog";
    }
  }
  if (!Object.keys(fx).length) return null;
  b.sfx = fx;
  return fx;
}

// ---------- snow and ice: moving ----------
export const isIce = (c) => !!c && (c.wet === "ice" || !!c.ice);
// The moves a step into a cell costs more for the snow or the ice (combat.js reachable, distField; a pond's own cost
// is ponds.js wetCost: a frozen pond is its ice, not snow).
export function groundCost(b, c) {
  const f = b && b.sfx;
  if (!f || !c) return 0;
  if (c.ice && !c.wet) return ICE.COST;
  if (!f.snowStep || c.wet || c.indoor) return 0;
  const m = SNOW_ON[c.f];
  return m ? f.snowStep * m : 0;
}
// The chance a step onto ice slips: careful feet (sneaking) and Light Step (skills.js: u.sneak) less. The dead too.
export function slipChance(u) {
  if (!u) return 0;
  return r2(ICE.SLIP * (u.sneaking ? ICE.CAREFUL : 1) * (u.sneak ? ICE.LIGHT : 1));
}
/**
 * A step onto (x, y) (combat.js moveAlong): on ice, the battle's dice for a slip. A fall ends the move: the rest of the
 * turn spent getting up, HURT damage. h: combat.js's { damage, say, fx, seen } (seen: someone of yours sees it).
 * Returns true when they fell.
 * @param {any} b @param {any} u @param {number} x @param {number} y @param {any} h
 */
export function slipStep(b, u, x, y, h) {
  if (!b.sfx || !isIce(cellOf(b, x, y)) || u.shoved || u.aboard) return false;
  const p = slipChance(u);
  if (!(p > 0) || battleDice(b, "slip") >= p) return false;
  u.ap = 0;
  u.slipT = b.turn;
  const n = ICE.HURT[0] + Math.floor(battleDice(b, "sliphurt") * (ICE.HURT[1] - ICE.HURT[0] + 1));
  const eff = Math.round(h.damage(b, u, n, null, false, { how: "ice" }));
  h.fx(b, { type: "melee", from: [x, y], to: [x, y], hit: true, crit: false, dmg: eff, side: u.side, text: "SLIP" });
  if (u.side === "player" || h.seen(b, u)) h.say(b, `${u.name} slips on the ice and goes down hard (${eff}): the rest of the turn is spent getting up.`, u.side === "player" ? "danger" : "good");
  return true;
}

// ---------- rain: sounds ----------
// How far a sound made at (x, y) carries in the rain (1: as ever; indoors the rain changes nothing).
export function rainHear(b, x, y) {
  const r = b && b.sfx && b.sfx.rain;
  if (!r) return 1;
  if (x != null && y != null && indoorCell(b, x, y)) return 1;
  return HEAR[r] || 1;
}
// A sound's earshot in the rain: × rainHear, nothing at all under QUIET tiles.
export function muffle(b, x, y, radius) {
  const m = rainHear(b, x, y);
  if (m === 1 || !(radius > 0)) return radius;
  const r = radius * m;
  return r < HEAR.QUIET ? 0 : r2(r);
}
// A noise lure (only noise: a flare's light, a heat pack still work) the rain drowns out where it lands.
export function drowned(b, lure, T = null) {
  const sense = (lure && lure.sense) || (T && T.sense) || ["noise"];
  if (!sense.every((k) => k === "noise")) return false;
  const m = rainHear(b, lure.x, lure.y);
  return m < 1 && (lure.radius ?? (T && T.radius) ?? 0) * m < HEAR.LURE;
}
// A lure's reach in the rain (stealth.js pull): drowned 0, else muffled.
export function lureReach(b, lure, T = null) {
  if (drowned(b, lure, T)) return 0;
  const sense = lure.sense || (T && T.sense) || ["noise"];
  return sense.every((k) => k === "noise") ? lure.radius * rainHear(b, lure.x, lure.y) : lure.radius;
}
// Why a throwable does nothing here (the throw's words, ui/combat.js), or "".
export function drownWhy(b, T, x, y) {
  if (!T || !T.radius || !drowned(b, { x, y, radius: T.radius, sense: T.sense }, T)) return "";
  return b.sfx.rain === "storm" ? "The storm drowns it out" : "Rain drowns it out";
}

// ---------- fog: sight ----------
// The fog's cap on sight at night (0: none, or by day: the day's fog is wxsight.js's cut).
export const fogCap = (b) => (b && b.sfx && b.sfx.fog && b.night ? FOG.NIGHT : 0);
// combat.js sightRange through the fog at night: capped at FOG.NIGHT, unless they stand indoors. A person on foot sees
// down cones (vision.js): the fog is on the cones (nightFogEyes), not here; this is the dead's and anyone with no front.
export function fogSight(b, a, r, x = a.x, y = a.y) {
  const cap = fogCap(b);
  if (!cap || indoorCell(b, x, y) || (b.night && coned(b, a))) return r;
  return Math.min(r, cap);
}
// vision.js nightEyes in fog: the dark ahead NIGHT, a light's beam or pool and night vision LIGHT of their own reach
// (never under NIGHT, never over what they were).
export function nightFogEyes(b, u, e) {
  if (!b || !b.night || !fogCap(b) || indoorCell(b, u.x, u.y)) return e;
  const L = activeLight(u) ? LIGHTS[activeLight(u)] : null;
  const dim = (r) => Math.max(FOG.NIGHT, r * FOG.LIGHT);
  const cones = e.cones.map((c, i) => ({ ...c, r: Math.min(c.r, i === 0 ? (nvgOn(u) ? dim(nvgSight(u)) : FOG.NIGHT) : dim(L ? L.sight : c.r)) }));
  const pool = L && L.round ? L.pool || 0 : 0;
  return { cones, near: Math.min(e.near, Math.max(VISION.NEAR, pool * FOG.LIGHT)) };
}
// A guard's noticing range in fog (stealth.js noticeRange).
export function fogNotice(b, e, mover, r) {
  const cap = fogCap(b);
  if (!cap || indoorCell(b, mover.x, mover.y)) return r;
  return Math.max(1, Math.min(r, cap));
}

// ---------- words ----------
// The battle's conditions: [{ text, tip, cls }] (ui/combat.js conditions line).
export function conditions(b) {
  const f = b && b.sfx;
  if (!f) return [];
  const out = [];
  if (f.snowStep) out.push({ text: `Snow: moves +${Math.round(f.snowStep * 100)}%`, cls: "warn", tip: `Snow lies on the open ground (${Math.round(f.snow * 100)}% cover): every step into it costs +${f.snowStep} moves (a road +${r2(f.snowStep * SNOW.ROAD)}; floors indoors nothing). Everyone wades through it, the dead too.` });
  if (f.ice) out.push({ text: `Ice: ${Math.round(ICE.SLIP * 100)}% to slip`, cls: "warn", tip: `It is freezing: frozen puddles, icy road and frozen ponds. A step onto ice costs +${ICE.COST} moves and has a ${Math.round(ICE.SLIP * 100)}% chance to slip (${Math.round(ICE.SLIP * ICE.CAREFUL * 100)}% sneaking, less with Light Step): the move ends there, the rest of the turn is spent getting up, ${ICE.HURT[0]}–${ICE.HURT[1]} damage. The enemy and the dead slip too.` });
  if (f.fog && b.night) out.push({ text: `Night fog: sight ${FOG.NIGHT}`, cls: "danger", tip: `${f.fogWhy} in the dark: everyone sees ${FOG.NIGHT} tiles ahead at most; a light's beam or pool and night vision reach half as far as in a clear night (the beam scatters in the murk), never less than ${FOG.NIGHT}. Guards notice you only that close.` });
  else if (f.fog) { const me = (b.units || []).find((u) => u.side === "player" && u.daySight != null); const day = me ? me.daySight : Math.max(WX_SIGHT_MIN, 13 - WX_SIGHT.fog); out.push({ text: `${f.fogWhy}: sight ${Math.round(day)}`, cls: "warn", tip: `${f.fogWhy}: everyone on the map, on every side and the dead too, sees ${WX_SIGHT.fog} tiles less by day (never under ${WX_SIGHT_MIN}); at night it is far worse. Indoors it changes nothing.` }); }
  if (f.rain) out.push({ text: `${f.rain === "storm" ? "Storm" : "Rain"}: sounds carry less`, cls: "muted", tip: `The ${f.rain === "storm" ? "storm" : "rain"} drowns out sounds made outdoors: gunshots and footsteps are heard ×${HEAR[f.rain]} as far, anything heard less than ${HEAR.QUIET} tiles off not at all; noise lures (a bottle, a noise maker, an alarm clock...) that would carry less than ${HEAR.LURE} tiles do nothing. A flare and heat lures still work. Indoors nothing changes.` });
  return out;
}
// The hover's words for a cell: the snow on it, the ice and its risk (ui/combat.js previewText).
export function cellWord(b, c, u = null) {
  const f = b && b.sfx;
  if (!f || !c) return "";
  if (isIce(c)) return `<b>Ice</b>: ${Math.round(slipChance(u && u.kind ? u : {}) * 100)}% to slip${u && u.sneaking ? " (sneaking)" : ""} stepping onto it (the move ends, the turn spent getting up, ${ICE.HURT[0]}–${ICE.HURT[1]} damage)${c.wet ? "" : `, +${ICE.COST} moves`}.`;
  const g = groundCost(b, c);
  return g ? `<b>Snow</b>: +${r2(g)} moves a step in${c.f === "road" ? " (the road, worn down)" : ""}.` : "";
}
// The move preview's words for a path (ui/combat.js moveWord): the snow it wades and the ice it crosses.
export function pathWord(b, u, path) {
  if (!b || !b.sfx || !path || !path.length) return "";
  let snow = 0, ice = 0;
  for (const [x, y] of path) { const c = cellOf(b, x, y); if (isIce(c)) ice++; else snow += groundCost(b, c); }
  const p = slipChance(u);
  const bits = [];
  if (snow > 0) bits.push(`snow +${r2(snow)} tiles`);
  if (ice) bits.push(`${ice} ice tile${ice === 1 ? "" : "s"}: ${Math.round(p * 100)}% each to slip (${Math.round((1 - Math.pow(1 - p, ice)) * 100)}% on the way)`);
  return bits.length ? bits.join("; ") : "";
}
