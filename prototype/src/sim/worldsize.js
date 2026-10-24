// @ts-check
// World sizes (new-run screen): the map's width and height in hexes, and how many AI groups fit on it. A leaf
// module (no imports), safe to read at load time from anywhere.
//
// The presets (2026-10-24, the user's request: "Make map sizes for all modes besides crashlanding to be Small: 150 x 75,
// Normal: 250 x 150, Large: 300 x 200, Huge: 500x 300"): Small 150 × 75, Normal 250 × 150, Large 300 × 200, Huge
// 500 × 300 (Crashlanding's own map is 300 × 200, crashmode.js CRASH.W × H: the Large preset's grid). Before that day
// the presets were 48 × 32, 64 × 42, 80 × 52 and 100 × 66, and Normal was the original State of Calder whose seeds
// built the same maps as ever: THAT IS NO LONGER TRUE. A seed builds a different (much bigger) Normal map than it did,
// and a save from before (any of the four old grids) matches no preset: it is read as a custom map of its own grid
// (worldSizeOf, stateSizeDef below) and plays on as it was.
//
// The density reference stays the original 64 × 42 map (BASE_W × BASE_H, the area unit: areaScale = 1 there, about 14
// on the new Normal): everything that comes with land is scaled by it, so every size keeps that map's density per
// hex: towns, countryside sites, landmarks, highway stops, rivers (by width), hot spots and starting hives (about the
// same hive density), the border hordes' pace and the hives' build sites (hives.js), and how far from the hub the
// groups settle (factions.js, by the square root). Cities, military bases, hives at the origin, extra hot spots,
// nearGroups and hiveClear are set per size in WORLD_SIZES below, each worked out the way customDef(w, h) works them
// out from the area (the formula is noted on the table; the numbers are written by hand so the table reads): the
// 500 × 250 Crashlanding map the user played on 2026-10-24 was built by customDef, and the presets keep its density.
// Only the AI groups are not by area: their ranges and defaults are set by hand to keep a run playable (the user sets
// them on the new-run screen anyway, up to GROUPS_MAX).
//
// nearGroups: at most this many groups start within raid reach of the hub (factions.js RAIDS.REACH, the same 30
// tiles on every size), the rest farther out, so raids grow as the groups expand toward you.
// hiveClear: the hub is placed at least this far from the outbreak origin (and 4 less from the extra hot spots),
// so about as many hives start within striking range of it as on the original map; the rest reach it as they spread.
export const BASE_W = 64;
export const BASE_H = 42;

// By hand from customDef's formulas with A = w × h / (64 × 42): cities = max(2, round(1.2 + 1.15 A)); military =
// max(1, round(0.8 A)); originHives 5 (A ≥ 2); hotspots = round(A − 0.5) with 3 hives each; nearGroups 4 (A ≥ 2);
// hiveClear = min(40, round(28 + (A − 1.54) × 6.5)) = 40 on all four. A: Small 4.19, Normal 13.95, Large 22.32, Huge 55.80.
export const WORLD_SIZES = {
  //        hexes                   AI groups: range and default   cities  military bases (+50% one more)  hives at the outbreak origin; extra hot spots and their hives
  small:  { key: "small",  label: "Small",  w: 150, h: 75,  groups: [3, 8],   defGroups: 4,  cities: 6,  military: 3,  originHives: 5, hotspots: 4,  spotHives: 3, nearGroups: 4, hiveClear: 40 },
  normal: { key: "normal", label: "Normal", w: 250, h: 150, groups: [5, 14],  defGroups: 7,  cities: 17, military: 11, originHives: 5, hotspots: 13, spotHives: 3, nearGroups: 4, hiveClear: 40 },
  large:  { key: "large",  label: "Large",  w: 300, h: 200, groups: [7, 18],  defGroups: 10, cities: 27, military: 18, originHives: 5, hotspots: 22, spotHives: 3, nearGroups: 4, hiveClear: 40 },
  huge:   { key: "huge",   label: "Huge",   w: 500, h: 300, groups: [10, 24], defGroups: 15, cities: 65, military: 45, originHives: 5, hotspots: 55, spotHives: 3, nearGroups: 4, hiveClear: 40 },
};
export const SIZE_KEYS = Object.keys(WORLD_SIZES);
export const DEFAULT_SIZE = "normal";

// A size's definition: a preset key, or a definition already built (customDef), as it is.
export const sizeDef = (key) => (key && typeof key === "object" && key.w ? key : WORLD_SIZES[key] || WORLD_SIZES[DEFAULT_SIZE]);
// Land relative to the original 64 × 42 map (the density unit; the new Normal is about 14).
export const areaScale = (def) => (def.w * def.h) / (BASE_W * BASE_H);
// The preset with exactly this grid, or null (a custom 300 × 200 is the Large preset, Crashlanding's map among them).
export function presetKeyFor(w, h) {
  for (const k of SIZE_KEYS) if (WORLD_SIZES[k].w === w && WORLD_SIZES[k].h === h) return k;
  return null;
}

// Custom size (new-run screen, experimental): any width × height in this range. Everything the presets set by hand
// is worked out from the area so it lands on the presets' values at their sizes (Small 6 cities, Huge 65 and 55
// extra hot spots...); the AI groups' range and default follow the presets by area (between two presets, in
// between them; past Huge, Huge's), so a custom map suggests a playable count. Big maps cost more every frame and
// every day (rendering, paths, the groups' searches). A custom grid that is exactly a preset's is that preset
// (presetKeyFor; world.js createWorld).
export const CUSTOM = { MIN_W: 32, MAX_W: 500, MIN_H: 24, MAX_H: 300 }; // 500 × 300: the Huge preset (2026-10-24); Crashlanding's 300 × 200 (crashmode.js CRASH.W × H) within
const clampInt = (n, lo, hi, dflt) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt; };
export const clampCustomW = (n) => clampInt(n, CUSTOM.MIN_W, CUSTOM.MAX_W, BASE_W);
export const clampCustomH = (n) => clampInt(n, CUSTOM.MIN_H, CUSTOM.MAX_H, BASE_H);
// The AI groups for an area A: the presets' values interpolated by area (below Small, scaled down to 1 group at nothing).
function groupsByArea(A) {
  const pts = SIZE_KEYS.map((k) => WORLD_SIZES[k]).map((d) => ({ A: areaScale(d), lo: d.groups[0], hi: d.groups[1], def: d.defGroups })).sort((a, b) => a.A - b.A);
  pts.unshift({ A: 0, lo: 1, hi: 2, def: 1 });
  let a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length; i++) if (A <= pts[i].A) { a = pts[i - 1]; b = pts[i]; break; }
  const f = A >= b.A ? 1 : (A - a.A) / Math.max(1e-9, b.A - a.A);
  const mix = (x, y) => Math.max(1, Math.round(x + (y - x) * f));
  return { groups: [mix(a.lo, b.lo), Math.max(2, mix(a.hi, b.hi))], defGroups: Math.min(GROUPS_MAX, mix(a.def, b.def)) };
}
export function customDef(w, h) {
  w = clampCustomW(w);
  h = clampCustomH(h);
  const A = (w * h) / (BASE_W * BASE_H);
  const big = A >= 1.2; // the original Large and up: extra hot spots, groups held back from the hub, the hub kept clear of the hives
  const hotspots = big ? Math.round(A - 0.5) : 0;
  return {
    key: "custom", label: "Custom", w, h,
    ...groupsByArea(A),
    cities: Math.max(2, Math.round(1.2 + 1.15 * A)), military: Math.max(1, Math.round(A * 0.8)),
    originHives: A < 0.8 ? 3 : A < 2 ? 4 : 5, hotspots, spotHives: hotspots ? 3 : 0,
    ...(big ? { nearGroups: A < 2 ? 5 : 4, hiveClear: Math.min(40, Math.round(28 + (A - 1.54) * 6.5)) } : {}),
  };
}
// The size key a run is built with: a preset, or "custom" (createWorld takes customW / customH with it).
export const isCustom = (key) => key === "custom";

// A world's size key: its grid decides (2026-10-24: the presets changed size, so a save's worldSize may name a
// preset its grid no longer is). A grid that is exactly a preset's is that preset, whatever state.worldSize says;
// any other grid is "custom" (an old 64 × 42 Normal, 48 × 32 Small... among them: stateSizeDef builds its def from
// the grid), never "normal" for a grid of another size. With no grid at all, a valid worldSize, else Normal.
export function worldSizeOf(state) {
  const g = state && state.grid;
  if (g && g.width && g.height) return presetKeyFor(g.width, g.height) || "custom";
  if (state && (WORLD_SIZES[state.worldSize] || isCustom(state.worldSize))) return state.worldSize;
  return DEFAULT_SIZE;
}
// A live world's size definition: its preset, or a custom one built from its grid.
export function stateSizeDef(state) {
  const k = worldSizeOf(state);
  return isCustom(k) && state.grid ? customDef(state.grid.width, state.grid.height) : sizeDef(k);
}
// Land relative to the original 64 × 42 map for a live world (from its grid, so it holds for any size).
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
