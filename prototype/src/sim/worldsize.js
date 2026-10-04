// World sizes (new-run screen): the map's width and height in hexes, and how many AI groups fit on it. A leaf
// module (no imports), safe to read at load time from anywhere. Normal is the original 64 × 42 State of Calder:
// its seeds build exactly the maps they always did, and a save without a size is a Normal world.
//
// Everything that comes with land is scaled by area (areaScale: Normal = 1): towns, countryside sites, landmarks,
// highway stops, rivers (by width), hot spots and starting hives (about the same hive density), the border hordes'
// pace and the hives' build sites (hives.js), and how far from the hub the groups settle (factions.js, by the
// square root). Cities, the extra hot spots and the guaranteed military bases are set per size below.
//
// Bigger maps are for longer games: they start no harsher than a Normal one and the pressure grows as the world
// does. nearGroups: at most this many groups start within raid reach of the hub (factions.js RAIDS.REACH, the
// same 30 tiles on every size), the rest farther out, so raids grow as the groups expand toward you.
// hiveClear: the hub is placed at least this far from the outbreak origin (and 4 less from the extra hot spots),
// so about as many hives start within striking range of it as on a Normal map; the rest reach it as they spread.
export const BASE_W = 64;
export const BASE_H = 42;

export const WORLD_SIZES = {
  //        hexes          AI groups: range and default   cities  military bases (+50% one more)  hives at the outbreak origin; extra hot spots and their hives
  small:  { key: "small",  label: "Small",  w: 48,  h: 32, groups: [3, 6],   defGroups: 4,  cities: 2, military: 1, originHives: 3, hotspots: 0, spotHives: 0 },
  normal: { key: "normal", label: "Normal", w: 64,  h: 42, groups: [5, 10],  defGroups: 7,  cities: 2, military: 1, originHives: 4, hotspots: 0, spotHives: 0 },
  large:  { key: "large",  label: "Large",  w: 80,  h: 52, groups: [7, 14],  defGroups: 10, cities: 3, military: 1, originHives: 4, hotspots: 1, spotHives: 3, nearGroups: 5, hiveClear: 28 },
  huge:   { key: "huge",   label: "Huge",   w: 100, h: 66, groups: [10, 18], defGroups: 15, cities: 4, military: 2, originHives: 5, hotspots: 2, spotHives: 3, nearGroups: 4, hiveClear: 34 },
};
export const SIZE_KEYS = Object.keys(WORLD_SIZES);
export const DEFAULT_SIZE = "normal";

export const sizeDef = (key) => WORLD_SIZES[key] || WORLD_SIZES[DEFAULT_SIZE];
// Land relative to Normal (exactly 1 for Normal, so `round(n * areaScale)` keeps every Normal count).
export const areaScale = (def) => (def.w * def.h) / (BASE_W * BASE_H);
// A world's size key: stored on the state (createWorld), else worked out from the grid (older saves are Normal).
export function worldSizeOf(state) {
  if (state && WORLD_SIZES[state.worldSize]) return state.worldSize;
  const g = state && state.grid;
  if (g) for (const k of SIZE_KEYS) if (WORLD_SIZES[k].w === g.width && WORLD_SIZES[k].h === g.height) return k;
  return DEFAULT_SIZE;
}
// Land relative to Normal for a live world (from its grid, so it holds for any size).
export const worldScale = (state) => (state && state.grid ? (state.grid.width * state.grid.height) / (BASE_W * BASE_H) : 1);
// Group count clamped to a size's range (the new-run screen's select).
export function clampGroups(key, n) {
  const d = sizeDef(key);
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(d.groups[0], Math.min(d.groups[1], v)) : d.defGroups;
}
