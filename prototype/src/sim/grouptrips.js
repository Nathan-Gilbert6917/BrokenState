// The groups' outdoor work, by the same rules as your job trips (sim/jobtrips.js, tripland.js), coarsely: their day is
// one number for food and one for wood (factions.js factionsDaily), so the trips are a factor on those, read from
// the land each of their bases holds (tile.owner = the group: factions.js recomputeOwnership).
//   - food from the land (groupFoodLand): their hunters and foragers on the best ground of each base's land, the walk
//     counted (tripland.js distFactor, the same as yours); a camp's hunters only on the tiles next to it (no cabin's
//     reach, as yours: hunting.js huntRadius): 0.9–1.1 × the land share of their food, 1 for a base with
//     usual land (GROUP_TRIPS.foodRef); +fish where the base holds a water tile (no fishing without one, as yours).
//   - wood (groupWoodLand): × the best wood land's yield against GROUP_TRIPS.woodRef (0.5–1.5).
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
import { kitFactor } from "./arsenal.js"; // their kit: how well their workers out on the land are armed (trips-plus #2)
import { woundGroup } from "./groupcare.js";
import { hash01 } from "./skills.js";
import { localId } from "./world.js"; // ids are process-wide: the dice take the world-local one
import { FACTION_TYPES } from "./data.js";
import { TEAM, groupCrew } from "./teamwork.js"; // teamwork: their outdoor workers out in crews, as yours

// foodRef / woodRef: a usual base's land score (measured over 60 worlds' group bases: the median), so the median base
// keeps its food and wood as before.
export const GROUP_TRIPS = { foodRef: 1.08, woodRef: 0.67, foodSpread: 0.1, fish: 0.02, fetchServes: 4, outShare: 0.15, hours: [7, 19],
  lossDay: 1.2e-5, woundDay: 0.004, gearMin: 0.3 }; // trouble on the land (groupTripLosses)
const besieged = (state, f, tile) => state.parties.some((q) => q.phase === "siege" && q.target && q.target.kind === "faction" && q.target.factionId === f.id && q.target.tile === tile);
// The best of a base's land for a job: max over its tiles of what a tile holds × its walk.
function bestLand(state, f, tile, job, value, radius = 2) {
  let best = 0;
  for (const id of workLand(state, tile, f.id)) {
    if (radius < 2 && state.grid.distance(tile, id) > radius) continue;
    const v = value(id);
    if (v <= 0) continue;
    best = Math.max(best, v * distFactor(job, state.grid.distance(tile, id)));
  }
  return best;
}
// Their hunting grounds as yours (hunting.js huntRadius): a camp (founded from nothing, groupworks.js) hunts the tiles
// next to it, an established base (their hunting trails and smoke shed: a cabin's worth) the land within 2.
const campOf = (f, tile) => !!(f.works && f.works[tile] && f.works[tile].camp);
export const groupFoodScore = (state, f, tile) => Math.max(
  bestLand(state, f, tile, "hunt", (id) => gameAbundance(state, id) * gameLevel(state, id), campOf(f, tile) ? 1 : 2),
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
// The share of their outdoor day left after the lunch hour (meals.js: all work stops for lunch, yours and theirs; your
// woodcutters lose it on their trips, jobtrips.js). Their food is not cut: it is mostly their fields, and your farms
// and dawn and dusk hunts lose nothing to lunch either.
export const GROUP_LUNCH_SHARE = 1 - 1 / (GROUP_TRIPS.hours[1] - GROUP_TRIPS.hours[0]);
// × on the wood they cut a day (0.5–1.5, × the lunch hour off; nothing from a besieged base).
export function groupWoodLand(state, f) {
  if (!f.bases.length) return GROUP_LUNCH_SHARE;
  let sum = 0;
  for (const tile of f.bases) sum += besieged(state, f, tile) ? 0 : Math.max(0.5, Math.min(1.5, groupWoodScore(state, f, tile) / GROUP_TRIPS.woodRef));
  return (sum / f.bases.length) * GROUP_LUNCH_SHARE;
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
// Trouble on the land (trips-plus #2, as yours meet it: sim/tripevents.js), by the numbers once a day: their workers out
// (outShare of their people at the bases not under siege) each have lossDay / g² of being killed and woundDay / g of
// coming home with a wound worth tending (groupcare.js woundGroup: they heal there), g their kit (FACTION_TYPES arms ×
// arsenal.js kitFactor, at least gearMin): a usual group's 1, a commune's about 0.6 (2.8× the deaths), a military
// group's about 2 (a quarter). Calibrated on yours: an ungeared worker of yours meets death about 2.7e-5 of their days
// out (tools/tripeventstest.js), a commune's the same. The trip's own dice: a hash of the seed, the group and the day.
// Teamwork (teamwork.js, as yours: a crew meets trouble together): a base whose people out make crews of two or more a
// job (groupCrew) loses TEAM.aiRisk as many and comes home with TEAM.aiWound the wounds.
// Returns { out, dead, wounded, crew }.
export const groupGear = (f) => Math.max(GROUP_TRIPS.gearMin, ((FACTION_TYPES[f.type] && FACTION_TYPES[f.type].arms) || 1) * kitFactor(f));
export function groupTripLosses(state, f, d = Math.floor(state.hour / 24)) {
  const res = { out: 0, dead: 0, wounded: 0 };
  if (!f || !f.alive || !f.bases.length || !(f.pop > 0)) return res;
  const free = f.bases.filter((tile) => !besieged(state, f, tile)).length / f.bases.length;
  const out = f.pop * GROUP_TRIPS.outShare * free;
  if (!(out > 0)) return res;
  const g = groupGear(f);
  const crew = groupCrew(f, GROUP_TRIPS.outShare);
  const together = crew >= 2;
  res.out = Math.round(out * 10) / 10;
  res.crew = crew;
  if (hash01("grouptripdead", state.seed, localId(state, f.id), d) < out * GROUP_TRIPS.lossDay / (g * g) * (together ? TEAM.aiRisk : 1) && f.pop > 1) { f.pop -= 1; res.dead = 1; }
  const w = out * GROUP_TRIPS.woundDay / g * (together ? TEAM.aiWound : 1);
  res.wounded = Math.floor(w) + (hash01("grouptripwound", state.seed, localId(state, f.id), d) < w - Math.floor(w) ? 1 : 0);
  if (res.wounded) woundGroup(f, res.wounded);
  f.tripLoss = { dead: (f.tripLoss && f.tripLoss.dead || 0) + res.dead, wounded: (f.tripLoss && f.tripLoss.wounded || 0) + res.wounded };
  return res;
}
export { TRIP_JOBS };
