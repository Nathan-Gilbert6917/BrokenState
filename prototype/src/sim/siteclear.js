// @ts-check
// Clearing the camp's spot of the dead (the user's request 2026-10-22): "If it is a safe area you can build with no
// problem typically out of city etc. but if it is in a city tile or town tile or higher infection rate you will need to
// clear the zombies first before establishing the base. So it would be like a raid on the base map to clear it out
// before setting up a base. For the purpose of making it easier do not have reinforcements come due to heat just spawn a
// decent amount of zombies based on the era and infection rate and have them be cleared to establish the base. Farmland
// and far from town and city tiles should have very few if any zombies."
//
// WHO FIGHTS (siteThreat): a team setting up camp (Set up camp, Establish base, Build outpost: staging.js pitchArrive)
// on a city tile, a town (the suburbs, a town's own tile: basemap.js terrainOf) or a tile at least SITE_CLEAR.INF
// infected. The dead there: BASE by the place, more by the tile's infection (INF_N), times the year's growth of the
// hordes (eras.js hordeGrowth), times the run's Dead at sites dial; on farmland (plains, a farm's fields) or land with no
// town or city within NEAR tiles a share of that (FAR): a few at most, often none. Their kinds as a raid's there (the soldiers of a military site, the bred dead, the dead beasts,
// the years' dead).
// WHEN: once the spot is fixed (staging.js pickSite, autoSite, or at once when nobody is asked: clearSiteFirst), before
// the setup's work: the pitching waits (the team "engaged") while the fight is on.
// THE FIGHT (layout "siteClear"): the tile's own land round the spot (basemap.js siteLand: its houses, stores, streets,
// wrecks, its high ground, laid as on the base map: basescatter.js layLand), the spot SPOT_X across the map, your people
// by the west edge, the dead spread round the spot (in the houses too), no more drawn in by the noise (b.reinfMax 0).
// AFTER (handler "siteClear"): won, the spot is clear (p.siteClear: the tile) and the setup goes on; pulled back or
// beaten, the team waits for orders (Set up camp again: the dead are all back).
import { startCombat, registerCombatHandler, registerBattleLayout, registerBattleSize } from "./combat.js";
import { siteLand, terrainOf } from "./basemap.js";
import { layLand } from "./basescatter.js";
import { cragWays } from "./relief.js";
import { partyMembers, partyTile, tileLabel, awaitOrders, wipeIfEmpty } from "./parties.js";
import { log } from "./world.js";
import { hordeGrowth } from "./eras.js";
import { cfgOf } from "./worldcfg.js";
import { siteDeadMix, maxMix } from "./deadsoldiers.js";
import { beastMix } from "./deadbeasts.js";
import { siteSpecials } from "./hivetech.js";
import { widenMix } from "./deadpool.js";

export const SITE_CLEAR = {
  INF: 0.5,                               // a tile this infected needs clearing wherever it is
  BASE: { city: 8, town: 5, land: 1 },    // the dead at the spot by the place
  INF_N: 10,                              // and more by the tile's infection (× it)
  FAR: 0.4,                               // farmland, or land this far (NEAR+ tiles) from any town or city: this share
  NEAR: 2,
  MAX: 20,                                // a battle's most (combat.js MAX_ENEMIES)
  SIZE: [44, 34],                         // the fight's map
  SPOT_X: 0.62,                           // the spot this far across it (your people come in from the west)
  SPREAD: 11,                             // the dead within this many cells of the spot
};
const URBAN = new Set(["city", "suburb"]);
const townish = (t) => !!t && (URBAN.has(t.terrain) || (t.loc && t.loc.type === "town"));
// The place: "city" | "town" | "land".
const placeOf = (state, tile) => { const k = terrainOf(state, { tile }); return k === "city" ? "city" : k === "suburb" ? "town" : "land"; };
// Farmland, or land with no town or city within NEAR tiles.
function farOut(state, tile) {
  const k = terrainOf(state, { tile });
  if (k === "farm" || k === "plains") return true;
  return !(state.grid && state.grid.within && state.grid.within(tile, SITE_CLEAR.NEAR).some((id) => townish(state.tiles[id])));
}
/**
 * The dead at a camp's spot on this tile: { count (0: nothing to clear), power, place, mix, name }.
 * @param {any} state @param {number} tile
 */
export function siteThreat(state, tile) {
  const t = state.tiles[tile];
  const none = { count: 0, power: 0, place: "land", mix: null, name: "" };
  if (!t) return none;
  const place = placeOf(state, tile), inf = Math.max(0, Math.min(1, t.infection || 0));
  if (place === "land" && inf < SITE_CLEAR.INF) return { ...none, place };
  let n = (SITE_CLEAR.BASE[place] + inf * SITE_CLEAR.INF_N) * hordeGrowth(state);
  if (place === "land" && farOut(state, tile)) n *= SITE_CLEAR.FAR;
  const dial = cfgOf(state, "siteDead");
  if (dial != null && dial !== 1) n *= dial; // worldcfg.js: the run's Dead at sites dial
  const count = Math.max(0, Math.min(SITE_CLEAR.MAX, Math.round(n)));
  if (!count) return { ...none, place };
  const mix = maxMix(maxMix(maxMix(siteDeadMix(state, tile), siteSpecials(state, tile)), beastMix(state, tile)), widenMix(state, tile));
  return { count, power: Math.round((2 + inf * 3) * 10) / 10, place, mix, name: place === "land" ? "the dead about the spot" : `the dead in the ${place === "city" ? "city's" : "town's"} streets` };
}
// "about 12 of the dead to clear first" / "" (the orders' text, the spot's panel).
export function threatWords(state, tile) {
  const th = siteThreat(state, tile);
  return th.count ? `about ${th.count} of the dead here to clear first (a fight on the tile's map, none drawn in from further off)` : "";
}

/**
 * The team's spot is fixed: the dead there cleared first (the fight starts; the pitching waits). True when a fight
 * started. at: the spot (map coordinates of the fire). @param {any} state @param {any} p @param {number[]} at
 */
export function clearSiteFirst(state, p, at) {
  if (!p || !state.parties.includes(p) || !p.task || p.task.type !== "pitch") return false;
  const tile = partyTile(p);
  if (p.siteClear === tile) return false;
  const th = siteThreat(state, tile);
  if (!th.count) { p.siteClear = tile; return false; }
  p.phase = "engaged";
  log(state, `${tileLabel(state, tile).replace(/^\w/, (m) => m.toUpperCase())}: ${th.count} of the dead between the team and its camp's spot. They have to be cleared first.`, "danger");
  startCombat(state, { tile, partyId: p.id, enemy: { kind: "zombies", count: th.count, power: th.power, name: th.name, mix: th.mix }, ambush: null, canRetreat: true, handler: "siteClear", layout: "siteClear", context: { partyId: p.id, tile, at: [at[0], at[1]] } });
  return true;
}

registerCombatHandler("siteClear", (state, result, setup) => {
  const c = setup.context;
  const p = state.parties.find((x) => x.id === c.partyId);
  if (!p || !partyMembers(state, p).length) {
    if (p) wipeIfEmpty(state, p);
    log(state, `The team setting up camp at ${tileLabel(state, c.tile)} died clearing the dead there.`, "death");
    return;
  }
  if (result.outcome === "victory") {
    p.siteClear = c.tile;
    if (p.task && p.task.type === "pitch") p.phase = "task";
    log(state, `The camp's spot at ${tileLabel(state, c.tile)} is clear of the dead: the team sets up camp.`, "good");
    return;
  }
  const text = result.outcome === "retreat" ? `The team pulled back from its camp's spot at ${tileLabel(state, c.tile)}: the dead still hold it.` : `The team was driven off its camp's spot at ${tileLabel(state, c.tile)}.`;
  log(state, text, "danger");
  if (state.parties.includes(p) && !wipeIfEmpty(state, p)) awaitOrders(state, p, text, { failed: true });
});

registerBattleSize("siteClear", () => SITE_CLEAR.SIZE);
// The map: the tile's own land round the spot; then the dead spread round it.
registerBattleLayout("siteClear", (b, ctx) => {
  const c = b.setup && b.setup.context;
  if (!c) return;
  const cx = Math.round(ctx.W * SITE_CLEAR.SPOT_X), cy = Math.floor(ctx.H / 2);
  if (ctx.phase === "map") {
    for (let i = 0; i < b.cells.length; i++) b.cells[i] = { k: "open" };
    const land = siteLand(ctx.state, c.tile);
    layLand({ cells: b.cells, W: ctx.W, H: ctx.H, ox: cx - c.at[0], oy: cy - c.at[1], land, ok: (x, y) => b.cells[y * ctx.W + x].k === "open", floor: (x, y) => b.cells[y * ctx.W + x].k === "open" });
    cragWays(b.cells, ctx.W, ctx.H); // relief.js: the crag in the map's crop never shuts the spot off from the west edge (tools/mapreachtest.js)
    b.reinfMax = 0; // no more of the dead drawn in by the noise: these are all of them
    b.siteSpot = [cx, cy];
    return;
  }
  const taken = new Set(b.units.filter((u) => u.side !== "enemy").map((u) => u.y * ctx.W + u.x));
  const spots = [];
  for (let y = 1; y < ctx.H - 1; y++) for (let x = 1; x < ctx.W - 1; x++) {
    const i = y * ctx.W + x;
    if (Math.hypot(x - cx, y - cy) > SITE_CLEAR.SPREAD || x < 10 || !b.reach[i] || taken.has(i)) continue;
    const k = b.cells[i].k;
    if (k === "open" || k === "doorway" || k === "rise" || k === "slope" || k === "bush") spots.push(i);
  }
  for (const u of b.units) {
    if (u.side !== "enemy" || !spots.length) continue;
    const j = ctx.rng.int(0, spots.length - 1), i = spots[j];
    spots.splice(j, 1);
    u.x = i % ctx.W; u.y = Math.floor(i / ctx.W);
  }
});
