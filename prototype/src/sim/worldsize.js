// @ts-check
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

// A size's definition: a preset key, or a definition already built (customDef), as it is.
export const sizeDef = (key) => (key && typeof key === "object" && key.w ? key : WORLD_SIZES[key] || WORLD_SIZES[DEFAULT_SIZE]);
// Land relative to Normal (exactly 1 for Normal, so `round(n * areaScale)` keeps every Normal count).
export const areaScale = (def) => (def.w * def.h) / (BASE_W * BASE_H);

// Custom size (new-run screen, experimental): any width × height in this range. Everything the presets set by hand
// is worked out from the area so it lands on the presets' values at their sizes (Small 2 cities, Huge 4 and two
// extra hot spots...). Big maps cost more every frame and every day (rendering, paths, the groups' searches).
export const CUSTOM = { MIN_W: 32, MAX_W: 500, MIN_H: 24, MAX_H: 250 }; // 500 × 250: Crashlanding's map (crashmode.js CRASH.W × H, 2026-10-24); the presets stay as they are
const clampInt = (n, lo, hi, dflt) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt; };
export const clampCustomW = (n) => clampInt(n, CUSTOM.MIN_W, CUSTOM.MAX_W, BASE_W);
export const clampCustomH = (n) => clampInt(n, CUSTOM.MIN_H, CUSTOM.MAX_H, BASE_H);
export function customDef(w, h) {
  w = clampCustomW(w);
  h = clampCustomH(h);
  const A = (w * h) / (BASE_W * BASE_H);
  const big = A >= 1.2; // Large and up: extra hot spots, groups held back from the hub, the hub kept clear of the hives
  const hotspots = big ? Math.round(A - 0.5) : 0;
  return {
    key: "custom", label: "Custom", w, h,
    groups: [Math.max(1, Math.round(5 * A ** 0.8)), Math.max(2, Math.round(10 * A ** 0.65))], defGroups: Math.max(1, Math.min(GROUPS_MAX, Math.round(7 * A ** 0.85))),
    cities: Math.max(2, Math.round(1.2 + 1.15 * A)), military: Math.max(1, Math.round(A * 0.8)),
    originHives: A < 0.8 ? 3 : A < 2 ? 4 : 5, hotspots, spotHives: hotspots ? 3 : 0,
    ...(big ? { nearGroups: A < 2 ? 5 : 4, hiveClear: Math.min(40, Math.round(28 + (A - 1.54) * 6.5)) } : {}),
  };
}
// The size key a run is built with: a preset, or "custom" (createWorld takes customW / customH with it).
export const isCustom = (key) => key === "custom";

// A world's size key: stored on the state (createWorld), else worked out from the grid (older saves are Normal).
export function worldSizeOf(state) {
  if (state && (WORLD_SIZES[state.worldSize] || isCustom(state.worldSize))) return state.worldSize;
  const g = state && state.grid;
  if (g) for (const k of SIZE_KEYS) if (WORLD_SIZES[k].w === g.width && WORLD_SIZES[k].h === g.height) return k;
  return DEFAULT_SIZE;
}
// A live world's size definition: its preset, or a custom one built from its grid.
export function stateSizeDef(state) {
  const k = worldSizeOf(state);
  return isCustom(k) && state.grid ? customDef(state.grid.width, state.grid.height) : sizeDef(k);
}
// Land relative to Normal for a live world (from its grid, so it holds for any size).
export const worldScale = (state) => (state && state.grid ? (state.grid.width * state.grid.height) / (BASE_W * BASE_H) : 1);

// The new-run screen's limits: 0–50 AI groups on any size (each size suggests a range: groups above), and the
// starting hives (null: what the map makes on its own, else 0–20).
export const GROUPS_MAX = 50;
export const HIVES_MAX = 20;
export function clampGroups(key, n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && String(n).trim() !== "" ? Math.max(0, Math.min(GROUPS_MAX, v)) : sizeDef(key).defGroups;
}
export function clampHives(n) {
  if (n == null || n === "" || n === "default") return null;
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(0, Math.min(HIVES_MAX, v)) : null;
}
