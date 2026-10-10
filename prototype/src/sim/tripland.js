// Job trips: the land a base's outdoor workers walk to, and the hours it costs them (the time side of sim/jobtrips.js).
// A leaf module (no imports): woodcutting.js, foraging.js, hunting.js and activity.js read the same numbers without a
// cycle.
//
// The outdoor jobs (Cut wood, Forage, Hunt, Fish, Scavenge, Fetch water) are worked in trips: out from the walls to a
// tile of the base's land, the work there, back home with the load (credited to the store on arrival, jobtrips.js),
// and out again while the job's hours last. Walking costs the hours on the tile:
//   - TRIP.pace hours a tile each way (0.5 h: within the base's own land a worker walks to the near side of the next
//     tile, not across it as a team crossing the State Map does at ~1 h a tile). The base's own tile counts
//     TRIP.gate of a tile (out of the walls to its fields and woods). A fisher or water carrier walks to the shore of a
//     water tile: half a tile short of its middle (d − 0.5).
//   - Each job has its hours (windows: the day's daylight for wood, forage and water; dawn and dusk for hunting and
//     fishing) split into `trips` trips each; a trip's walk out and back comes out of its window.
//   - The output of an hour on the tile is the job's old rate × `scale` (= the job's old daily hours / its hours on a
//     tile at the job's reference distance `ref`: where its workers usually went before, so a typical base brings in
//     what it did on average): wood and forage one tile out 1 (the base's own tile 1.14, two out 0.8), scavenging on
//     the base's own ground 1; hunting two out 1, one 1.5 (game keeps off the walls, though: gameAbundance); fishing at
//     water next to the base 1, two out 0.71.
//   - The tile: the best of the base's land for the job by what it holds × that distance factor (tripTile, jobtrips.js).
// The base's land: the tiles within TRIP.radius (2) of the base that no other group holds (tile.owner null or yours).
// Water jobs (fish, water) need a water tile the base OWNS (tile.owner "player": the ground round a base, factions.js
// recomputeOwnership): "No water in the base's land" otherwise.
export const TRIP = { pace: 0.5, gate: 0.3, deposit: 0.15, radius: 2, minWork: 0.25, ref: 1 };
// windows: [from, to) hours of the day; trips: trips per window; nominal: the old daily job's hours (its scale); prime:
// the hour the odds are read at (hunt and fish: dawn and dusk, as the old job read them); water: works a water tile.
// fixed (Fetch water): a short trip of `fill` hours at the water, then `rest` hours hauling it into the barrels and
// chores before the next, as many as fit; perTrip: what one trip brings (2 buckets).
export const TRIP_JOBS = {
  wood:     { windows: [[7, 19]], trips: 2, nominal: 6, ref: 1, unit: "wood", stage: ["Felling trees", "Chopping wood", "Splitting logs"], ing: "Cutting wood", load: "logs" },
  forage:   { windows: [[7, 19]], trips: 2, nominal: 6, ref: 1, unit: "food", stage: ["Searching", "Picking", "Gathering"], ing: "Foraging", load: "basket" },
  hunt:     { windows: [[6, 10], [16, 20]], trips: 1, nominal: 3, ref: 2, prime: [7, 17], unit: "food", stage: ["Tracking", "Stalking", "Dressing the kill"], ing: "Hunting", load: "game" },
  fish:     { windows: [[6, 10], [16, 20]], trips: 1, nominal: 3, ref: 1, prime: [7, 17], unit: "food", water: true, stage: ["Casting", "Fishing", "Fishing"], ing: "Fishing", load: "fish" },
  scavenge: { windows: [[8, 18]], trips: 2, nominal: 1, ref: 0, unit: "finds", stage: ["Searching", "Picking through", "Sorting"], ing: "Scavenging", load: "sack" },
  water:    { windows: [[7, 19]], ref: 1, fixed: { fill: 0.5, rest: 2 }, perTrip: 2, water: true, unit: "rawwater", stage: ["Filling the buckets", "Filling the buckets", "Filling the buckets"], ing: "Fetching water", load: "buckets" },
};
export const isTripJob = (job) => !!TRIP_JOBS[job];
const hod = (h) => ((Math.floor(h) % 24) + 24) % 24;
// The window of the day an hour falls in: [from, to] or null.
export function tripWindow(job, h) {
  const c = TRIP_JOBS[job];
  if (!c) return null;
  const x = hod(h);
  for (const [a, b] of c.windows) if (x >= a && x < b) return [a, b];
  return null;
}
export const inTripHours = (job, h) => !!tripWindow(job, h);
// Tiles walked each way to a tile d away (a water job's shore half a tile short of the water tile).
export const walkTiles = (job, d) => Math.max(TRIP.gate, (TRIP_JOBS[job] && TRIP_JOBS[job].water ? d - 0.5 : d));
export const walkHours = (job, d) => walkTiles(job, d) * TRIP.pace;
// Hours a day on the tile at distance d (the windows less the walking).
export function onTileHours(job, d) {
  const c = TRIP_JOBS[job];
  if (!c) return 0;
  if (c.fixed) { // as many short trips as fit
    let n = 0;
    for (const [a, b] of c.windows) n += Math.max(0, Math.floor((b - a + c.fixed.rest) / (2 * walkHours(job, d) + c.fixed.fill + c.fixed.rest)));
    return n * c.fixed.fill;
  }
  return c.windows.reduce((s, [a, b]) => s + Math.max(0, b - a - c.trips * 2 * walkHours(job, d)), 0);
}
// The reference distance (the scale is set there), so a typical base brings in what it did before the trips (measured
// over 80 hubs, the old best tile against the new choice with its walk: wood and forage 1 (the old job took the best tile
// within 2, mostly 2 out; the trips pick nearer ground more often), hunting 2 (game keeps away from the walls),
// scavenging 0 (the ground right round the base), a water job's water next to the base 1).
const refD = (job) => TRIP_JOBS[job].ref ?? TRIP.ref;
// The old daily hours an hour on the tile counts as.
export const tripScale = (job) => (TRIP_JOBS[job] && !TRIP_JOBS[job].fixed ? TRIP_JOBS[job].nominal / Math.max(0.1, onTileHours(job, refD(job))) : 1);
// What a tile d away gives a day against one at the job's reference distance (1 there).
export const distFactor = (job, d) => onTileHours(job, d) / Math.max(0.1, onTileHours(job, refD(job)));
// Fetch water: trips a day at distance d.
export const waterTripsADay = (d) => Math.round(onTileHours("water", d) / TRIP_JOBS.water.fixed.fill);

// ---------- the land ----------
// Tiles a base's workers may work (any base: yours, or a group's by its tile and owner): within TRIP.radius, not
// another group's. owner: "player" for yours, the group's id for a group's base.
export function workLand(state, tile, owner = "player") {
  const out = [];
  for (const id of state.grid.within(tile, TRIP.radius)) {
    const t = state.tiles[id];
    if (!t || (t.owner != null && t.owner !== owner)) continue;
    out.push(id);
  }
  return out;
}
// Water tiles the base owns (its ground: tile.owner), nearest first: [{ id, d }].
export function ownedWater(state, tile, owner = "player") {
  const out = [];
  for (const id of state.grid.within(tile, TRIP.radius)) {
    const t = state.tiles[id];
    if (t && t.terrain === "water" && !t.bridge && t.owner === owner) out.push({ id, d: state.grid.distance(tile, id) });
  }
  return out.sort((a, b) => a.d - b.d || a.id - b.id);
}
export const NO_WATER = "no water in the base's land";
// The land tile a fisher or water carrier stands on at a water tile: the base's own tile if it is on that shore, else
// the shore tile nearest the base (ties by id).
export function shoreOf(state, tile, water, owner = "player") {
  const g = state.grid;
  if (g.distance(tile, water) <= 1) return tile;
  const c = g.neighbors(water).filter((id) => { const t = state.tiles[id]; return t && t.terrain !== "water" && (t.owner == null || t.owner === owner); });
  c.sort((a, b) => g.distance(tile, a) - g.distance(tile, b) || a - b);
  return c.length ? c[0] : tile;
}
// The way from the base to a tile and back: [base, …, tile], each step to a neighbour on the base's land (not water,
// unless it is the end), the one nearer the tile first (ties by id). At most TRIP.radius + 1 tiles.
export function tripRoute(state, from, to, owner = "player") {
  const g = state.grid;
  const path = [from];
  let at = from, guard = 0;
  while (at !== to && guard++ < 6) {
    const d = g.distance(at, to);
    const next = g.neighbors(at).filter((id) => g.distance(id, to) < d)
      .map((id) => { const t = state.tiles[id]; const ok = t && (id === to || (t.terrain !== "water" || t.bridge)) && (t.owner == null || t.owner === owner) ? 0 : 1; return { id, ok }; })
      .sort((a, b) => a.ok - b.ok || a.id - b.id)[0];
    if (!next) break;
    at = next.id;
    path.push(at);
  }
  return path;
}

// ---------- plug-in points (sim/fieldworks and the like) ----------
// Where the trips go and where they bring the load, each from one small function so other systems can add to them:
//   TRIP_HOOKS.water(state, base, job, list) → the list of water sources ({ id, d }, nearest first) for "fish" or "water";
//   TRIP_HOOKS.deposit(state, base, s, job) → { tile, stock } where a trip drops its load (default: the base, its stock).
export const TRIP_HOOKS = { water: null, deposit: null };
// The water a base's fishers ("fish") or water carriers ("water") go to, nearest first: [{ id, d }].
export function waterSources(state, base, job = "fish") {
  const list = ownedWater(state, base.tile);
  return TRIP_HOOKS.water ? TRIP_HOOKS.water(state, base, job, list) || list : list;
}
// Where a worker's trip ends and the load goes: { tile, stock } (default the base itself).
export function depositPoint(state, base, s, job) {
  const d = TRIP_HOOKS.deposit ? TRIP_HOOKS.deposit(state, base, s, job) : null;
  return d && d.tile != null ? d : { tile: base.tile, stock: base.stock };
}
