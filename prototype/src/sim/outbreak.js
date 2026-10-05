// The outbreak beyond the border (eras.js ERAS.OUTBREAK): the State of Calder is not the only state with hives.
// While the outbreak still burns in the neighbouring states, the dead from beyond the border keep the hives alive
// here: whenever fewer hives stand (or are being built) than the year's floor (2 up to year 7, 1 from year 8), a
// mass of the dead gathers on open ground near the border 20–40 days later and starts building a new hive there at
// once (a build site of hives.js with about 1,100 of the dead already gathered: about four weeks to the hive
// standing, a window to strike it as with any other site). In a year between 9 and 12 (fixed per world, from its
// seed) the outbreak beyond the border burns out: no more hives come over, and only then can the hive victory be won
// (world.js checkGameOver, eras.js containReady). The Goals panel says whether the border is still burning.
import { day, log } from "./world.js";
import { ensureHives, deliverToSite } from "./hives.js";
import { makeHorde, HORDE_MAX_SIZE } from "./hordes.js";
import { ERAS, ensureEraState, hiveFloor } from "./eras.js";

const hiveCount = (state) => (state.hives || []).length + (state.hiveSites || []).filter((s) => s.started != null || s.border).length;

export function outbreakDaily(state) {
  if (state.noOutbreak) return; // test switch
  ensureHives(state);
  const E = ensureEraState(state);
  const d = day(state);
  if (hiveCount(state) >= hiveFloor(state)) { E.reseedAt = null; return; }
  if (E.reseedAt == null) { E.reseedAt = d + state.rng.int(ERAS.OUTBREAK.DELAY[0], ERAS.OUTBREAK.DELAY[1]); return; }
  if (d < E.reseedAt) return;
  E.reseedAt = null;
  borderSite(state);
}

// A build site near the border with the dead already gathered on it (hives.js builds the hive from there).
function borderSite(state) {
  const g = state.grid, rng = state.rng, O = ERAS.OUTBREAK;
  const people = [...state.bases.map((b) => b.tile), ...state.factions.filter((f) => f.alive).flatMap((f) => f.bases)];
  const hubTile = state.bases.length ? state.bases[0].tile : null;
  const cands = [];
  for (const t of state.tiles) {
    if (t.x > O.EDGE && t.y > O.EDGE && t.x < g.width - 1 - O.EDGE && t.y < g.height - 1 - O.EDGE) continue;
    if (t.terrain === "water" || t.terrain === "mountain" || t.hive || t.loc) continue;
    if (people.some((p) => g.distance(p, t.id) < O.KEEP_CLEAR)) continue;
    if (state.hives.some((h) => g.distance(h.tile, t.id) < 6) || state.hiveSites.some((s) => g.distance(s.tile, t.id) <= 4)) continue;
    const far = hubTile == null ? 1 : Math.min(1, g.distance(hubTile, t.id) / 20);
    cands.push({ t, w: (0.4 + (t.infection || 0)) * far });
  }
  if (!cands.length) return null;
  const pick = rng.weighted(cands, (c) => c.w).t;
  const site = { id: (state.hiveSeq = (state.hiveSeq || 0) + 1), tile: pick.id, chosen: state.hour, score: 0, biomass: 0, started: null, border: true };
  state.hiveSites.push(site);
  state.hiveInfo.stats.sites++;
  state.hiveInfo.stats.borderSites = (state.hiveInfo.stats.borderSites || 0) + 1;
  // The mass, in hordes of at most HORDE_MAX_SIZE, delivered to the site at once (it starts building the next day).
  let left = O.MASS;
  while (left >= 50) {
    const n = Math.min(HORDE_MAX_SIZE - 50, left);
    const h = makeHorde(state, { tile: pick.id, size: n, role: "build", site: site.id, target: pick.id, split: true });
    deliverToSite(state, h, site);
    left -= n;
  }
  const t = state.tiles[pick.id];
  const side = t.x <= O.EDGE ? "west" : t.x >= g.width - 1 - O.EDGE ? "east" : t.y <= O.EDGE ? "north" : "south";
  log(state, `The dead are pouring over the ${side}ern border: a great mass of them has gathered in the borderlands (${t.x},${t.y}) and is building a hive. The outbreak beyond the border is not over.`, "danger");
  return site;
}
