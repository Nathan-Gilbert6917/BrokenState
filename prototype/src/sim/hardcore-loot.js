// Hardcore mode: the buildings are only about half picked over. On the day Calder falls people grabbed what they
// could and ran, so every site starts with about twice what a normal game's start leaves (tile.loot × START), and the
// surplus wears off on its own as the first months go by (the panic looting nobody tracks: other survivors, the
// bands, the military's convoys), down to a tenth of it by the day a normal game would start (state.hardcore.eraOffset,
// days 56–112) and on toward nothing after. Searching a place takes from it as always (scavenge.js, aiscav.js), so a
// site you strip early is stripped. The raid map's richness cap is higher in hardcore to match (combat.js createRaid).
// tile.lootNormal: what the tile held at the start of a normal game (the surplus is what is above it).
import { isHardcore } from "./hardcore.js";
import { hcEraOffset } from "./hardcore-groups.js";

export const HC_LOOT = { START: 2, LEFT_AT_ERA: 0.1 };

// createWorld (hardcore.js hardcoreAfterHives): double every tile's loot, remembering the normal start's level.
export function setupHardcoreLoot(state) {
  if (!isHardcore(state)) return;
  for (const t of state.tiles) {
    if (!(t.loot > 0)) continue;
    t.lootNormal = t.loot;
    t.loot = t.loot * HC_LOOT.START;
  }
}

// Once a day (hardcore.js hardcoreDaily): the surplus above the normal start's level shrinks by the same share a day,
// so LEFT_AT_ERA of it is left on the day the normal game would start.
export function hardcoreLootDaily(state) {
  if (!isHardcore(state)) return;
  const keep = Math.pow(HC_LOOT.LEFT_AT_ERA, 1 / Math.max(20, hcEraOffset(state)));
  for (const t of state.tiles) {
    if (t.lootNormal == null) continue;
    const extra = t.loot - t.lootNormal;
    if (extra <= 0.002) { delete t.lootNormal; continue; } // looted down to (or below) a normal start: done
    t.loot = t.lootNormal + extra * keep;
  }
}
