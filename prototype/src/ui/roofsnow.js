// Snow on the buildings (the user's request 2026-10-23: "In raid and base view: Winter has snow on buildings."): how
// much snow lies on a battle, raid or base map's roofs, wall tops, fences, sandbags, tents and the rest, for the view
// (ui/isoview.js roofSprite, snowPrims). Drawing only: nothing here changes the game.
//   - The snow lying, in quarters (0, 0.25, 0.5, 0.75, 1): the battle's own b.snowLie (sim/ponds.js pondsBattle, from
//     the tile's snow cover), else its tile's snow cover the same way (a map with no hills or hollows has no b.snowLie;
//     a base's map: the base's tile). Nothing to go by (no weather, no tile): none.
//   - From SNOW_MIN of cover, as sim/ponds.js: a dusting below it is not drawn. That is winter's snow in practice (the
//     cover builds up and melts by the weather, sim/weather.js), so no snow lies on them in any other season.
// API:
//   snowQuarter(cover)    -> the cover (0..1) in quarters, 0 below SNOW_MIN
//   snowOnFor(state, b)   -> a battle map's snow now (memoised by battle and hour)
import { weatherAt } from "../sim/weather.js";

export const SNOW_MIN = 0.15; // as sim/ponds.js b.snowLie
export const snowQuarter = (cover) => (Number(cover) >= SNOW_MIN ? Math.round(Math.min(1, Number(cover)) * 4) / 4 : 0);

let memo = { b: null, hour: NaN, sn: 0 };
/** @param {any} state @param {any} b */
export function snowOnFor(state, b) {
  const hour = state && Number.isFinite(state.hour) ? state.hour : 0;
  if (memo.b === b && memo.hour === hour) return memo.sn;
  let sn = 0;
  if (b && b.snowLie > 0) sn = snowQuarter(b.snowLie);
  else {
    try {
      const base = b && b.tileId == null && b.setup && b.setup.baseId != null && Array.isArray(state.bases) ? state.bases.find((x) => x.id === b.setup.baseId) : null;
      const tile = b ? b.tileId ?? (base ? base.tile : null) : null;
      if (tile != null && state.weather && state.tiles) sn = snowQuarter(weatherAt(state, tile, hour).snowCover || 0);
    } catch { /* a bare state: no weather */ }
  }
  memo = { b, hour, sn };
  return sn;
}
