// The groups' outdoor work, by the same rules as your job trips (sim/jobtrips.js, tripland.js), coarsely: their day is
// one number for food and one for firewood (factions.js factionsDaily), so the trips are a factor on those, read from
// the land each of their bases holds (tile.owner = the group: factions.js recomputeOwnership).
//   - food from the land (groupFoodLand): their hunters and foragers on the best ground of each base's land, the walk
//     counted (tripland.js distFactor, the same as yours): 0.9–1.1 × the land share of their food, 1 for a base with
//     usual land (GROUP_TRIPS.foodRef); +fish where the base holds a water tile (no fishing without one, as yours).
//   - firewood (groupWoodLand): × the best wood land's yield against GROUP_TRIPS.woodRef (0.5–1.5).
//   - water: a base holding a water tile carries water from it (groupFetchedWater: GROUP_TRIPS.fetchServes people's
//     drinking, groupworks.js provisioned) while its wells fall short.
//   - a base under siege (a raid camped at it) sends nobody out: its land counts nothing that day.
//   - by day (GROUP_TRIPS.hours) a share of their people is out working (groupHomeShare): a raid on them then meets
//     fewer at the walls (factions.js resolveRaidOnFaction).
// The map shows a couple of walkers going out and in at their bases you can see (ui/render.js, the same drawing).
import { workLand, distFactor, ownedWater, TRIP_JOBS } from "./tripland.js";
import { gameAbundance, gameLevel } from "./hunting.js";
import { forageAbundance, forageLevel } from "./foraging.js";
import { woodAbundance, woodLevel } from "./woodcutting.js";

// foodRef / woodRef: a usual base's land score (measured over 60 worlds' group bases: the median), so the median base
// keeps its food and firewood as before.
export const GROUP_TRIPS = { foodRef: 1.05, woodRef: 0.59, foodSpread: 0.1, fish: 0.02, fetchServes: 4, outShare: 0.15, hours: [7, 19] };
const besieged = (state, f, tile) => state.parties.some((q) => q.phase === "siege" && q.target && q.target.kind === "faction" && q.target.factionId === f.id && q.target.tile === tile);
// The best of a base's land for a job: max over its tiles of what a tile holds × its walk.
function bestLand(state, f, tile, job, value) {
  let best = 0;
  for (const id of workLand(state, tile, f.id)) {
    const v = value(id);
    if (v <= 0) continue;
    best = Math.max(best, v * distFactor(job, state.grid.distance(tile, id)));
  }
  return best;
}
export const groupFoodScore = (state, f, tile) => Math.max(
  bestLand(state, f, tile, "hunt", (id) => gameAbundance(state, id) * gameLevel(state, id)),
  bestLand(state, f, tile, "forage", (id) => forageAbundance(state, id) * forageLevel(state, id)));
export const groupWoodScore = (state, f, tile) => bestLand(state, f, tile, "wood", (id) => woodAbundance(state, id) * woodLevel(state, id));
const ownsWater = (state, f, tile) => ownedWater(state, tile, f.id).length > 0;
// × on the group's food from the land (0.9–1.1, + fish): the mean over its bases.
export function groupFoodLand(state, f) {
  if (!f.bases.length) return 1;
  let sum = 0;
  for (const tile of f.bases) {
    if (besieged(state, f, tile)) { sum += 1 - GROUP_TRIPS.foodSpread; continue; }
    const r = Math.min(2, groupFoodScore(state, f, tile) / GROUP_TRIPS.foodRef);
    sum += 1 - GROUP_TRIPS.foodSpread + GROUP_TRIPS.foodSpread * r + (ownsWater(state, f, tile) ? GROUP_TRIPS.fish : 0);
  }
  return sum / f.bases.length;
}
// × on the firewood they cut a day (0.5–1.5; nothing from a besieged base).
export function groupWoodLand(state, f) {
  if (!f.bases.length) return 1;
  let sum = 0;
  for (const tile of f.bases) sum += besieged(state, f, tile) ? 0 : Math.max(0.5, Math.min(1.5, groupWoodScore(state, f, tile) / GROUP_TRIPS.woodRef));
  return sum / f.bases.length;
}
// People's drinking their water carriers bring in (groupworks.js provisioned): fetchServes for each base holding water.
export const groupFetchedWater = (state, f) => f.bases.filter((tile) => ownsWater(state, f, tile) && !besieged(state, f, tile)).length * GROUP_TRIPS.fetchServes;
// The share of a group's people at home at this hour (a raid on them by day meets fewer at the walls).
export const groupHomeShare = (hour) => { const h = ((hour % 24) + 24) % 24; return h >= GROUP_TRIPS.hours[0] && h < GROUP_TRIPS.hours[1] ? 1 - GROUP_TRIPS.outShare : 1; };
// For the map: how many of a group base's people are out working at this hour (a light show: 0–2 walkers), and the
// job they are drawn at: [{ job, tile }] (deterministic: the base and the day pick them).
export function groupWalkers(state, f, tile, t) {
  const h = ((Math.floor(t) % 24) + 24) % 24;
  if (h < GROUP_TRIPS.hours[0] || h >= GROUP_TRIPS.hours[1] || besieged(state, f, tile)) return [];
  const land = workLand(state, tile, f.id).filter((id) => id !== tile && state.tiles[id] && state.tiles[id].terrain !== "water");
  if (!land.length) return [];
  const per = f.pop / Math.max(1, f.bases.length);
  const n = per >= 12 ? 2 : per >= 4 ? 1 : 0;
  const day = Math.floor(t / 24);
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = Math.abs((tile * 31 + day * 7 + i * 13) | 0);
    const target = land[k % land.length];
    const terr = state.tiles[target].terrain;
    out.push({ job: terr === "forest" ? (i ? "hunt" : "wood") : terr === "hills" || terr === "mountain" ? "hunt" : i && ownsWater(state, f, tile) ? "water" : "forage", tile: target, i });
  }
  return out;
}
export { TRIP_JOBS };
