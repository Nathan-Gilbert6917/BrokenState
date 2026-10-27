// Hardcore mode: the buildings are only about half picked over. On the day Calder falls people grabbed what they
// could and ran, so every site starts with about twice what a normal game's start leaves (tile.loot × START), and the
// surplus wears off on its own as the first months go by (the panic looting nobody tracks: other survivors, the
// bands, the military's convoys), down to a tenth of it by the day a normal game would start (state.hardcore.eraOffset,
// days 56–112) and on toward nothing after. Searching a place takes from it as always (scavenge.js, aiscav.js), so a
// site you strip early is stripped. The raid map's richness cap is higher in hardcore to match (combat.js createRaid).
// tile.lootNormal: what the tile held at the start of a normal game (the surplus is what is above it).
// Points of interest (pois.js) the same: every POI's own pool (poi.pool: every one but a site's, whose pool is its
// tile.loot above) × START, poi.poolNormal what it held at a normal start, the surplus wearing off by the same share a
// day; once it is gone the pool goes back to exactly what it was made with (unless a raid took it lower), so a save
// keeps only the POIs that changed (pois.js packPois).
import { isRoadStart, isHardcore } from "./roadstart.js";
import { HARD } from "./hardrules.js";
import { hcEraOffset } from "./hardcore-groups.js";
import { poisOf, isSitePoi } from "./pois.js";

export const HC_LOOT = { START: 2, LEFT_AT_ERA: 0.1 };
// Normal's road start leaves twice a normal start's loot; Hardcore starts below it (hardrules.js LOOT_START).
const startLoot = (state) => (isHardcore(state) ? HARD.LOOT_START : HC_LOOT.START);

// createWorld (hardcore.js hardcoreAfterHives): double every tile's loot and every POI's pool, remembering the normal
// start's level.
export function setupHardcoreLoot(state) {
  if (!isRoadStart(state)) return;
  for (const t of state.tiles) {
    poisOf(t).forEach((p, i) => {
      if (isSitePoi(t, i) || !(p.pool > 0)) return;
      p.poolNormal = p.pool;
      p.pool = p.pool * startLoot(state);
    });
    if (!(t.loot > 0)) continue;
    t.lootNormal = t.loot;
    t.loot = t.loot * startLoot(state);
  }
}

// Once a day (hardcore.js hardcoreDaily): the surplus above the normal start's level shrinks by the same share a day,
// so LEFT_AT_ERA of it is left on the day the normal game would start.
export function hardcoreLootDaily(state) {
  if (!isRoadStart(state)) return;
  const keep = Math.pow(HC_LOOT.LEFT_AT_ERA, 1 / Math.max(20, hcEraOffset(state)));
  for (const t of state.tiles) {
    for (const p of poisOf(t)) {
      if (p.poolNormal == null) continue;
      const extra = p.pool - p.poolNormal;
      if (extra <= 0.002) { if (extra > 0) p.pool = p.poolNormal; delete p.poolNormal; continue; } // back to a normal start's (exactly), or raided below it
      p.pool = p.poolNormal + extra * keep;
    }
    if (t.lootNormal == null) continue;
    const extra = t.loot - t.lootNormal;
    if (extra <= 0.002) { delete t.lootNormal; continue; } // looted down to (or below) a normal start: done
    t.loot = t.lootNormal + extra * keep;
  }
}
