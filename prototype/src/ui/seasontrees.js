// Seasonal trees (the user's request 2026-10-23: "In fall the trees should be red orange and brown in winter the trees
// are leaf less and have snow on them."): how the leafy trees and bushes look by the season, on the battle, raid and
// base maps (ui/isoview.js) and on the State Map (ui/terraindeco.js SEASON_LOOK, the forests' flat colour in
// ui/render.js; the POI dialogue's tile map, ui/poimap.js, through the same decals). Drawing only: nothing here changes
// the game. The season is the calendar's (sim/weather.js season).
//   - Spring and summer: green, as they always were.
//   - Autumn: each tree its own red, orange or brown (FALL), picked from its cell's hash so it never flickers; in the
//     season's first days (FALL_GREEN) some are still green, fewer every few days.
//   - Winter: the broadleaf trees bare (trunk, branches, twigs) and the bushes bare twigs, with snow on the branches
//     and crowns while snow lies (a battle's b.snowLie or its tile's snow cover; with neither to go by, winter means
//     snow). The State Map's pines keep their needles, snow on top.
// API:
//   treeSeason(seasonKey, dayOfSeason, snow)  -> the look: "green" | "fall0".."fall2" (early autumn, some still green)
//                                                | "fall" | "bare" | "snow" (bare, snow on it)
//   treeLookFor(state, b)                      -> a battle map's look now (memoised by battle and hour)
//   treeStyle(look, x, y)                      -> { kind: "green" | "fall" | "bare", leaf: FALL index (-1), snow }
//   styleKey(style)                            -> its part of a sprite's cache key ("" green)
//   mapSeason(seasonKey, dayOfSeason)          -> the State Map's SEASON_LOOK key: "spring" | "summer" | "autumn0" |
//                                                 "autumn" | "winter"
//   FOREST_FLAT[map season]                    -> the forests' flat colour on the State Map (none: the terrain's own)
import { season, seasonOfDay, dayIndex, weatherAt } from "../sim/weather.js";

// Autumn's leaves, [r, g, b]: red, orange, brown and a rust between them.
export const FALL = [[156, 50, 30], [196, 100, 30], [116, 72, 38], [170, 70, 26]];
export const FALL_NAMES = ["red", "orange", "brown", "rust"];
// Early autumn: the share of trees still green, by the stretch of days (days 1-3, 4-6, 7-9); none from day 10.
export const FALL_GREEN = [0.45, 0.28, 0.12];
const FALL_DAYS = 3;
// Snow cover (sim/weather.js snowCover) from which the trees carry snow: as the State Map's snow wash (weatherTint).
export const SNOW_ON_TREES = 0.08;

function hash(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** @param {string} key @param {number} [day] @param {boolean | null} [snow] null: not known (winter means snow) */
export function treeSeason(key, day = 1, snow = null) {
  if (key === "autumn") { const st = Math.floor((Math.max(1, day) - 1) / FALL_DAYS); return st < FALL_GREEN.length ? `fall${st}` : "fall"; }
  if (key === "winter") return snow === false ? "bare" : "snow";
  return "green";
}

// A battle map's look: the calendar now; the snow lying on its slopes (b.snowLie, sim/ponds.js), else its tile's
// snow cover (a base's map: the base's tile); neither known (no weather, no tile): winter means snow.
let memo = { b: null, hour: NaN, look: "green" };
export function treeLookFor(state, b) {
  const hour = state && Number.isFinite(state.hour) ? state.hour : 0;
  if (memo.b === b && memo.hour === hour) return memo.look;
  let look = "green";
  try {
    const s = season(state, hour);
    let snow = null;
    if (s.key === "winter") {
      if (b && b.snowLie) snow = b.snowLie >= SNOW_ON_TREES;
      else {
        const base = b && b.tileId == null && b.setup && b.setup.baseId != null && Array.isArray(state.bases) ? state.bases.find((x) => x.id === b.setup.baseId) : null;
        const tile = b ? b.tileId ?? (base ? base.tile : null) : null;
        if (tile != null && state.weather && state.tiles) snow = (weatherAt(state, tile, hour).snowCover || 0) >= SNOW_ON_TREES;
      }
    }
    look = treeSeason(s.key, s.dayOfSeason, snow);
  } catch { /* a bare state: no calendar */ }
  memo = { b, hour, look };
  return look;
}

/** One tree's (or bush's) style at cell (x, y): the same cell always the same. @param {string} look */
export function treeStyle(look, x, y) {
  if (look === "bare" || look === "snow") return { kind: "bare", leaf: -1, snow: look === "snow" };
  if (!look || !look.startsWith("fall")) return { kind: "green", leaf: -1, snow: false };
  const st = look === "fall" ? -1 : Number(look.slice(4));
  if (st >= 0 && hash(x, y, 71) < FALL_GREEN[st]) return { kind: "green", leaf: -1, snow: false };
  return { kind: "fall", leaf: Math.floor(hash(x, y, 53) * FALL.length), snow: false };
}
export const styleKey = (s) => (s.kind === "fall" ? `f${s.leaf}` : s.kind === "bare" ? (s.snow ? "bs" : "b") : "");

// The State Map's season for its decals: early autumn (its first six days) keeps one green of the three.
export function mapSeason(key, day = 1) {
  if (key === "autumn" && day <= FALL_DAYS * 2) return "autumn0";
  return SEASON_KEYS.has(key) ? key : "spring";
}
const SEASON_KEYS = new Set(["spring", "summer", "autumn", "winter"]);
export const mapSeasonOf = (state) => { try { const s = seasonOfDay(dayIndex(state)); return mapSeason(s.key, s.dayOfSeason); } catch { return "spring"; } };
export const FOREST_FLAT = { autumn0: "#4e5434", autumn: "#664629", winter: "#425040" }; // autumn rust; winter the pines' dark green, greyed
