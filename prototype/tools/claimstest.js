// Land claims, wells on claims, radio reach and the coalition's victory rule (src/sim/claims.js, alliance.js, radio.js,
// economy.js, orders.js): scripted cases on one seed. Usage: node tools/claimstest.js [seed]
// - canClaim: water, your base, a group's base, a hive, a group's ground, no border with your land, a tile next to yours
// - the Claim order end to end: a team walks there, 2 hours on the spot, 3 scrap, the claim and the log line; no scrap: refused
// - land counting (alliance.js controlledLand): a claim outside every base's reach adds one held tile; inside, none
// - overwrite: a group's base founded beside it (the daily sweep over tile.owner), a hive, a hostile party, raiders
//   from outside, a hardcore band; a friendly group's party does not take it; another group's claim can be claimed over
// - wells: yield by terrain and the shore, mountains refuse, the dig (24h, 15 scrap, 1 part), 1500–4000 left, half
//   under 20%, dry at 0 with a log line; hauled water into waterProduction, one well per 4 people at the base
// - radio: a station reaches 12, a Military encrypted radio in the armory 24, groups' sets add 6, a chain through an
//   owned base; a group's base is no relay
// - radio relays at any base: buildable at the hub without a station and at an outpost, refused beside a station
//   (standing or queued); an outpost's relay links and brings a group past it into radio reach and so into reach
//   for the coalition (inviteProblem, reachVia, relaySpotFor), out again when it goes off the air; a relay out of
//   the station's range reaches nobody; a hub relay linked from an outpost's station; idle beside a station, no parts
// - allianceVictory: a hostile group alive and outside does not block it with a member and over half the land; no
//   member: no victory; goalsProgress blocks text
// - save/load (sim/save.js): the claims and wells round-trip as plain data; an older save without claims loads
import { stockTools } from "./toolset.js"; // every tool a build or recipe can need (toolreqs.js)
import { createWorld, tickHour, hub, atBase, RADIO_RANGE, newId, makeSurvivor, day, radioBasesInRange } from "../src/sim/world.js";
import { BUILDINGS, canBuild, queueBuild, addBuilding } from "../src/sim/buildings.js";
import * as BP from "../src/sim/blueprints.js";
import { ensureJobs } from "../src/sim/jobs.js";
import { launchExpedition, partyTile, carried, outpostName } from "../src/sim/parties.js";
import { startOrder, queueEstimate, describeOrder, queueOrder } from "../src/sim/orders.js";
import * as C from "../src/sim/claims.js";
import { controlledLand, allianceVictory, accordHolds, goalsProgress, ensureAlliance, ALLIANCE, coalitionMask, inviteProblem, reachVia } from "../src/sim/alliance.js";
import { radioNodes, canRadioGroup, GROUP_REACH, MIL_RADIO_RANGE, hasMilRadio, RELAY_RANGE, relayReach, relaySpotFor, radioSummary, radioDaily } from "../src/sim/radio.js";
import { waterProduction } from "../src/sim/economy.js";
import { newItem } from "../src/sim/inventory.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import * as Weather from "../src/sim/weather.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 7 });
  state.started = true;
  state.autoCombat = true;
  state.noWanderers = true;
  stockTools(hub(state)); // every tool a build can need (toolset.js)
  Object.assign(hub(state).stock, { food: 300, water: 300, fuel: 100, meds: 20, ammo: 300, parts: 10, scrap: 100 });
  return state;
}
const dropEvents = (state) => { for (let i = state.cards.length - 1; i >= 0; i--) if (!state.cards[i].isOrders) state.cards.splice(i, 1); };
function tick(state, n, p, until) {
  for (let i = 0; i < n; i++) {
    state.hordes.length = 0;
    if (p) p.lastConflict = state.hour;
    tickHour(state);
    if (state.combat) state.combat = null;
    dropEvents(state);
    if (until && until()) return true;
  }
  return !until;
}
const lastLog = (state, re) => state.log.find((l) => re.test(l.text));
// A land tile at distance d..d2 from `from` with no base, no group's ground, no hive.
function tileNear(state, from, d, d2, filter = () => true) {
  for (const t of state.tiles) {
    const dist = state.grid.distance(from, t.id);
    if (dist < d || dist > d2 || t.terrain === "water" || t.hive || t.owner != null || state.bases.some((b) => b.tile === t.id) || !filter(t)) continue;
    return t.id;
  }
  return null;
}
// A tile right outside the hub's held ground (recomputeOwnership: 2 tiles): bordering it, claimable.
const edgeTile = (state, filter) => tileNear(state, hub(state).tile, 3, 3, (t) => state.grid.neighbors(t.id).some((id) => state.tiles[id].owner === "player") && (!filter || filter(t)));
const fakeOutpost = (state, tile) => {
  const base = { id: newId(), tile, type: "outpost", name: outpostName(state, tile), stock: { food: 60, water: 40, fuel: 0, meds: 2, ammo: 20, parts: 0, scrap: 10 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  state.bases.push(base);
  return base;
};

// ---------------------------------------------------------------------------------------------------------
section("canClaim: the rules");
{
  const state = mk();
  const h = hub(state);
  const water = state.tiles.find((t) => t.terrain === "water");
  check(/water/i.test(C.canClaim(state, water.id)), "open water cannot be claimed");
  check(/your base/i.test(C.canClaim(state, h.tile)), "your base tile is not a claim");
  const f = state.factions.find((x) => x.alive && x.bases.length);
  check(/base there/i.test(C.canClaim(state, f.bases[0])), `a group's base tile: "${C.canClaim(state, f.bases[0])}"`);
  const ground = state.grid.neighbors(f.bases[0]).find((id) => state.tiles[id].terrain !== "water" && typeof state.tiles[id].owner === "number");
  check(ground != null && /held by/i.test(C.canClaim(state, ground)), `a group's ground: "${ground != null ? C.canClaim(state, ground) : "no ground tile"}"`);
  const far = tileNear(state, h.tile, 8, 12);
  check(/border/i.test(C.canClaim(state, far)), `far from your land: "${C.canClaim(state, far)}"`);
  const edge = edgeTile(state);
  check(edge != null && C.canClaim(state, edge) === "", `a tile bordering the hub's ground can be claimed ("${C.canClaim(state, edge)}")`);
  state.tiles[edge].hive = true;
  check(/hive/i.test(C.canClaim(state, edge)), "a hive tile cannot be claimed");
  state.tiles[edge].hive = false;
  check(C.ownsTile(state, h.tile) && C.ownsTile(state, state.grid.neighbors(h.tile)[0]) && !C.ownsTile(state, edge), "ownsTile: the base, its ground, not the edge tile yet");
  // No team: the hub's scrap pays.
  const scrap0 = h.stock.scrap;
  const r = C.claimTile(state, null, edge);
  check(/claimed for the holdout/.test(r) && C.claimOwner(state, edge) === "player" && h.stock.scrap === scrap0 - C.CLAIM.SCRAP, `claimTile with no team: hub pays ${C.CLAIM.SCRAP} scrap (${r})`);
  check(/already/.test(C.canClaim(state, edge)), "the same tile twice: refused");
  check(C.ownsTile(state, edge) && C.playerClaims(state).includes(edge) && C.claimedLand(state) === 1, "ownsTile, playerClaims and claimedLand see the claim");
  // Its neighbour further out borders a claim now: claimable in turn (claims chain outward).
  const next = state.grid.neighbors(edge).find((id) => state.tiles[id].terrain !== "water" && state.grid.distance(h.tile, id) === 4 && state.tiles[id].owner == null);
  check(next != null && C.canClaim(state, next) === "", "a tile bordering a claim can be claimed (claims chain outward)");
  check(C.canClaim(state, -5) !== "" && C.canClaim(state, 10 ** 9) !== "", "a tile off the map is refused, not a crash");
}

// ---------------------------------------------------------------------------------------------------------
section("The Claim order end to end: a team, 2 hours, 3 scrap, the log line");
{
  const state = mk();
  const h = hub(state);
  const edge = edgeTile(state);
  const ids = atBase(state, h.id).slice(0, 2).map((s) => s.id);
  const res = launchExpedition(state, { memberIds: ids, dest: edge, mission: "move", stance: "normal", supplies: { food: 10, water: 10, scrap: 10, parts: 2 } });
  check(!res.error, `launch: ${res.error || "ok"}`);
  const p = res.party;
  // Queued behind the move: the estimate knows its hours and its name.
  const q = queueOrder(state, p, { type: "claim" });
  const est = queueEstimate(state, p);
  check(/Queued: Claim this tile/.test(q) && est.length === 1 && est[0].hours === C.CLAIM.HOURS && describeOrder(state, { type: "claim" }) === "Claim this tile", `queued and estimated (${q}; ${est[0] && est[0].hours}h)`);
  tick(state, 24 * 4, p, () => p.phase === "task" && p.task && p.task.type === "claim");
  check(p.phase === "task" && p.task && p.task.type === "claim" && partyTile(p) === edge, `the team arrived and started the claim (${p.phase} ${p.task && p.task.type})`);
  const scrap0 = carried(p, "scrap");
  tick(state, C.CLAIM.HOURS + 1, p, () => C.claimOwner(state, edge) === "player");
  check(C.claimOwner(state, edge) === "player", "the tile is claimed after the hours");
  check(carried(p, "scrap") === scrap0 - C.CLAIM.SCRAP, `${C.CLAIM.SCRAP} scrap taken from the team (${scrap0} → ${carried(p, "scrap")})`);
  const l = lastLog(state, /claimed for the holdout/);
  check(!!l && l.kind === "good", `log line: ${l ? l.text : "none"}`);
  check(state.claims[edge].since <= state.hour && day(state) >= 1 && /Claimed by you \(day \d+\)/.test(C.claimText(state, edge)), `claimText: ${C.claimText(state, edge)}`);
  // No scrap: refused with the reason, nothing claimed.
  const next = state.grid.neighbors(edge).find((id) => state.tiles[id].terrain !== "water" && C.canClaim(state, id) === "");
  const p2 = launchExpedition(state, { memberIds: atBase(state, h.id).slice(0, 1).map((s) => s.id), dest: next, mission: "move", stance: "normal", supplies: { food: 10, water: 10 } }).party;
  tick(state, 24 * 4, p2, () => p2.phase === "waiting" && partyTile(p2) === next);
  const r2 = startOrder(state, p2, { type: "claim" });
  check(/needs 3 scrap/.test(r2) && C.claimOwner(state, next) == null, `no scrap carried: refused (${r2})`);
}

// ---------------------------------------------------------------------------------------------------------
section("Land counting: claims add to the coalition's land");
{
  const state = mk();
  const h = hub(state);
  const before = controlledLand(state);
  const edge = edgeTile(state); // inside the hub's reach (controlRadius 9): held already
  C.claimTile(state, null, edge);
  const mid = controlledLand(state);
  check(mid.held === before.held && mid.claims === 0 && mid.claimed === 1, `a claim inside a base's reach adds no held tile (${before.held} → ${mid.held}, claims ${mid.claims}, claimed ${mid.claimed})`);
  // A claim outside every reach: force it (the chain of claims would get there in time).
  const far = tileNear(state, h.tile, 14, 20);
  C.ensureClaims(state)[far] = { owner: "player", since: state.hour };
  const after = controlledLand(state);
  check(after.held === before.held + 1 && after.claims === 1 && after.pct > before.pct, `a claim outside adds one held tile (${before.held} → ${after.held})`);
  check(coalitionMask(state)[far] === 1, "coalitionMask marks the claim");
  // Another group's claim is not yours.
  state.claims[far].owner = state.factions[0].id;
  check(controlledLand(state).held === before.held && C.claimedLand(state) === 1, "a group's claim does not count for you");
  check(/Claimed by/.test(C.claimText(state, far)) && !/by you/.test(C.claimText(state, far)), `claimText for a group's claim: ${C.claimText(state, far)}`);
  // ...but can be claimed over when it borders your land.
  state.claims[edge].owner = state.factions[0].id;
  check(C.canClaim(state, edge) === "" && /torn down/.test(C.claimTile(state, null, edge)) && C.claimOwner(state, edge) === "player", "a group's claim bordering your land can be claimed over");
}

// ---------------------------------------------------------------------------------------------------------
section("Overwrite: a base founded, a hive, a hostile camp");
{
  const state = mk();
  const h = hub(state);
  const edge = edgeTile(state);
  C.claimTile(state, null, edge);
  const f = state.factions.find((x) => x.alive && x.bases.length);
  // overwriteClaims directly (the hooks in hives.js and factions.js call it).
  const n = C.overwriteClaims(state, edge, 1, f.id, "a group settled there");
  check(n === 1 && C.claimOwner(state, edge) === f.id && C.claimedLand(state) === 0, `overwriteClaims: taken by the group (${n})`);
  check(!!lastLog(state, /Your claim at .* is lost: a group settled there/), "the loss is logged");
  check(C.overwriteClaims(state, edge, 1, f.id, "again") === 0, "the same owner again: nothing taken");
  check(C.overwriteClaims(state, edge, 0, null, "wiped") === 0 && C.claimOwner(state, edge) == null, "wiping a group's claim: not yours, not counted, gone");
  // The daily sweep: a group's base founded beside the claim takes it (tile.owner after recomputeOwnership).
  C.claimTile(state, null, edge);
  const spot = state.grid.neighbors(edge).find((id) => state.tiles[id].terrain !== "water" && state.tiles[id].owner == null && !state.bases.some((b) => b.tile === id));
  f.bases.push(spot);
  recomputeOwnership(state);
  C.claimsDaily(state);
  check(typeof state.tiles[edge].owner === "number" && C.claimOwner(state, edge) === f.id, `the daily sweep hands a claim under a group's new ground to the group (${C.claimOwner(state, edge)})`);
  f.bases.pop();
  recomputeOwnership(state);
  delete state.claims[edge];
  // A hive on the tile.
  C.claimTile(state, null, edge);
  state.tiles[edge].hive = true;
  C.claimsDaily(state);
  check(C.claimOwner(state, edge) == null && !!lastLog(state, /lost: a hive stands there/), "a hive on the tile wipes the claim");
  state.tiles[edge].hive = false;
  // A hostile group's party camped on it at the day tick; a friendly one does not take it.
  C.claimTile(state, null, edge);
  // A besieging party that never moves (parties.js aiPartyHour: a siege on another group counts down 1 an hour): a stand-in for a camp.
  const party = { id: newId(), owner: f.id, kind: "raid", path: [edge], idx: 0, progress: 0, phase: "siege", siegeLeft: 100000, strength: 10, target: { kind: "faction", factionId: state.factions.find((x) => x !== f).id, tile: edge } };
  state.parties.push(party);
  f.goodwill = 30;
  C.claimsDaily(state);
  check(C.claimOwner(state, edge) === "player", "a friendly group's party on the tile leaves the claim alone");
  f.goodwill = -60;
  check(C.hostileOn(state, edge) === f.id, "hostileOn names the hostile group");
  C.claimsDaily(state);
  check(C.claimOwner(state, edge) === f.id && !!lastLog(state, /lost: a hostile band camped on it/), "a hostile group's party camped on it takes the claim for its group");
  state.parties.splice(state.parties.indexOf(party), 1);
  f.goodwill = 30;
  delete state.claims[edge];
  // Raiders from outside (visitors.js) and a hardcore band wipe it.
  C.claimTile(state, null, edge);
  state.visitors = state.visitors || [];
  state.visitors.push({ id: newId(), kind: "raiders", tile: edge, size: 5, phase: "travel", path: [edge], idx: 0, name: "test raiders" });
  C.claimsDaily(state);
  check(C.claimOwner(state, edge) == null, "raiders from outside camped on it wipe the claim");
  state.visitors.pop();
  C.claimTile(state, null, edge);
  const hc = state.hardcore;
  state.hardcore = { groups: { bands: [{ id: 1, tile: edge, pop: 6 }] } };
  C.claimsDaily(state);
  check(C.claimOwner(state, edge) == null, "a hardcore band camped on it wipes the claim");
  state.hardcore = hc;
  // Your own outpost built on a claim: the post is moot, quietly.
  C.claimTile(state, null, edge);
  const logs = state.log.length;
  const o = fakeOutpost(state, edge);
  C.claimsDaily(state);
  check(C.claimOwner(state, edge) == null && state.log.length === logs, "your own base on the claim: the claim goes without a loss line");
  state.bases.splice(state.bases.indexOf(o), 1);
  // The day tick runs the sweep (world.js): a hostile party standing there at midnight.
  C.claimTile(state, null, edge);
  state.parties.push(party);
  f.goodwill = -60;
  while (state.hour % 24 !== 23) tickHour(state);
  state.hordes.length = 0;
  tickHour(state);
  check(C.claimOwner(state, edge) === f.id, "the day tick runs claimsDaily (world.js)");
  state.parties.splice(state.parties.indexOf(party), 1);
}

// ---------------------------------------------------------------------------------------------------------
section("Wells: yield by the ground, the dig, depletion, hauled water and the one-per-4-people cap");
{
  const state = mk();
  const h = hub(state);
  // Yield by terrain (a tile with water next to it is a shore).
  for (const t of state.tiles) {
    if (t.terrain === "water") continue;
    const want = t.terrain === "mountain" ? 0 : C.besideWater(state, t.id) ? C.WELL_SHORE : C.WELL_YIELD[t.terrain];
    if (C.wellYield(state, t.id) !== want) { check(false, `wellYield ${t.terrain} shore=${C.besideWater(state, t.id)}: ${C.wellYield(state, t.id)} ≠ ${want}`); break; }
  }
  passed++;
  const ring = state.grid.neighbors(h.tile).filter((id) => state.tiles[id].terrain !== "water" && state.tiles[id].terrain !== "mountain");
  check(ring.length >= 2, `the hub has ${ring.length} land neighbours`);
  const t0 = ring[0];
  check(/claim/i.test(C.wellProblem(state, null, t0)), `no claim yet: "${C.wellProblem(state, null, t0)}"`);
  C.claimTile(state, null, t0);
  check(C.wellProblem(state, null, t0) === "", `a claim next to the hub: a well can be dug ("${C.wellProblem(state, null, t0)}")`);
  const far = tileNear(state, h.tile, 3, 3);
  C.ensureClaims(state)[far] = { owner: "player", since: state.hour };
  check(/next to one of your bases/.test(C.wellProblem(state, null, far)), "a claim not beside a base: no well");
  const mtn = state.tiles.find((t) => t.terrain === "mountain" && state.grid.distance(t.id, h.tile) <= 1);
  if (mtn) { C.ensureClaims(state)[mtn.id] = { owner: "player", since: state.hour }; check(/rock/.test(C.wellProblem(state, null, mtn.id)), "mountains: no water to dig for"); }
  // The dig order: materials carried, 24 hours.
  const ids = atBase(state, h.id).slice(0, 2).map((s) => s.id);
  const p = launchExpedition(state, { memberIds: ids, dest: t0, mission: "move", stance: "normal", supplies: { food: 10, water: 10, scrap: 20, parts: 0 } }).party;
  tick(state, 48, p, () => p.phase === "waiting" && partyTile(p) === t0);
  check(p.phase === "waiting" && partyTile(p) === t0, "the team stands on the claim");
  const r0 = startOrder(state, p, { type: "well" });
  check(/Needs 15 scrap and 1 part/.test(r0), `no part carried: refused (${r0})`);
  p.supplies.parts = 2;
  const r1 = startOrder(state, p, { type: "well" });
  check(/digging a well/.test(r1) && p.task && p.task.type === "well" && p.task.hours === C.CLAIM.WELL_HOURS, `the dig starts (${r1})`);
  check(queueEstimate(state, { ...p, orders: [{ type: "well" }], phase: "waiting", task: null }).find((e) => e.order.type === "well").hours === C.CLAIM.WELL_HOURS, "queueEstimate: 24h for a well");
  tick(state, C.CLAIM.WELL_HOURS + 1, p, () => !!C.wellAt(state, t0));
  const w = C.wellAt(state, t0);
  check(!!w && w.yield === C.wellYield(state, t0) && w.left >= 1500 && w.left <= 4000 && w.start === w.left, `the well: ${w ? `${w.yield} a day, ${w.left} left` : "none"}`);
  check(carried(p, "scrap") === 5 && carried(p, "parts") === 1, `15 scrap and 1 part taken (${carried(p, "scrap")} scrap, ${carried(p, "parts")} parts left)`);
  check(!!lastLog(state, /A well dug at/) && /Well: .* a day, \d+ left/.test(C.wellText(state, t0)), `log and wellText: ${C.wellText(state, t0)}`);
  check(/already/.test(C.wellProblem(state, null, t0)), "a second well on the tile: refused");
  // Hauled into the base's production, drawn down daily.
  const factor = Weather.wellFactor ? Weather.wellFactor(state) : 1;
  const prod = waterProduction(state, h);
  const rate = C.wellRate(state, w);
  check(Math.abs(rate - Math.round(w.yield * factor * 10) / 10) < 1e-9, `wellRate: ${rate} (yield ${w.yield} × dry-spell factor ${factor})`);
  check(prod.hauled >= rate - 1e-9 && prod.claimWells.length === 1 && prod.claimWells[0].counted, `waterProduction.hauled ${prod.hauled} includes the well (${rate})`);
  const left0 = w.left;
  C.drawWells(state, h);
  check(Math.abs(left0 - w.left - rate) < 1e-9, `drawWells takes a day's rate (${left0} → ${w.left})`);
  // Under 20% left the yield halves; at 0 it is dry with a log line.
  w.left = w.start * 0.1;
  check(Math.abs(C.wellRate(state, w) - Math.round(w.yield * 0.5 * factor * 10) / 10) < 1e-9, `under 20% left: half (${C.wellRate(state, w)})`);
  w.left = 1;
  C.drawWells(state, h);
  check(w.left === 0 && w.dry && C.wellRate(state, w) === 0 && !!lastLog(state, /has run dry/) && C.wellText(state, t0) === "Well: dry", `dry at 0: ${C.wellText(state, t0)}`);
  check(waterProduction(state, h).hauled < 1e-9, "a dry well hauls nothing");
  // The cap: one well per 4 people at the base; the best wells first.
  const people = atBase(state, h.id).length;
  const cap = Math.floor(people / C.CLAIM.WELL_PER_PEOPLE);
  for (const id of ring) C.ensureClaims(state)[id] = { owner: "player", since: state.hour, well: { yield: 6, left: 3000, start: 3000, dug: 0 } };
  const hw = C.hauledWells(state, h);
  check(hw.cap === cap && hw.wells.filter((o) => o.counted).length === Math.min(cap, ring.length), `${people} people: ${hw.cap} wells counted of ${ring.length} (${hw.wells.filter((o) => o.counted).length})`);
  check(Math.abs(hw.total - Math.min(cap, ring.length) * Math.round(6 * factor * 10) / 10) < 1e-6, `hauled total ${hw.total}`);
  state.claims[ring[1]].well.yield = 10;
  check(C.hauledWells(state, h).wells[0].tile === ring[1], "the best well is counted first");
  // Fewer people: fewer wells.
  const moved = atBase(state, h.id).slice(0, people - 3);
  for (const s of moved) s.location = { kind: "away" };
  check(C.hauledWells(state, h).cap === 0 && waterProduction(state, h).hauled < 1e-9, "3 people at the base: no well is hauled");
  for (const s of moved) s.location = { kind: "base", baseId: h.id };
  // A group's claim beside the base hauls nothing for you.
  state.claims[ring[1]].owner = state.factions[0].id;
  check(!C.hauledWells(state, h).wells.some((o) => o.tile === ring[1]), "a group's well is not yours to haul");
}

// ---------------------------------------------------------------------------------------------------------
section("Radio reach: 12, 24 with a Military encrypted radio, groups' sets +6, a chain through an owned base");
{
  const state = mk();
  const h = hub(state);
  check(RADIO_RANGE === 12 && GROUP_REACH === 6 && MIL_RADIO_RANGE === 24, `the numbers: ${RADIO_RANGE} / ${GROUP_REACH} / ${MIL_RADIO_RANGE}`);
  h.radio = true;
  const node = radioNodes(state).find((n) => n.base === h);
  check(!!node && node.kind === "station" && node.range >= RADIO_RANGE && node.range <= RADIO_RANGE + 2 && !node.military, `a station reaches ${node && node.range}`);
  // A group at 20 tiles: out of reach of a 12-tile station (+6), in reach with the military set (24+6).
  const f = state.factions.find((x) => x.alive && x.bases.length);
  const spot = tileNear(state, h.tile, 20, 20);
  const saved = f.bases.slice();
  f.bases.length = 0; f.bases.push(spot);
  check(!canRadioGroup(state, f), "a group 20 tiles out: out of reach with a 12-tile station");
  h.armory.push(newItem("milradio"));
  const mil = radioNodes(state).find((n) => n.base === h);
  check(hasMilRadio(h) && mil.military && mil.range >= MIL_RADIO_RANGE, `with the military set the station reaches ${mil.range}`);
  check(canRadioGroup(state, f), "in reach with the military set (24 + 6)");
  h.armory.pop();
  // No station but the set: still a station.
  h.radio = false;
  h.armory.push(newItem("milradio"));
  check(radioNodes(state).some((n) => n.base === h && n.kind === "station" && n.military), "a base with the set and no station building is a station");
  h.armory.pop();
  h.radio = true;
  // A chain through an owned base: an outpost with a station 10 tiles toward the group.
  const mid = tileNear(state, h.tile, 10, 10, (t) => state.grid.distance(t.id, spot) <= 12);
  if (mid != null) {
    const o = fakeOutpost(state, mid);
    o.radio = true;
    check(canRadioGroup(state, f), "a chain through an owned base with a station reaches the group");
    state.bases.splice(state.bases.indexOf(o), 1);
    // A group's base on that tile is no relay.
    const other = state.factions.find((x) => x !== f && x.alive);
    other.bases.push(mid);
    check(!canRadioGroup(state, f), "another group's base on the way is no relay: a chain runs through owned bases only");
    other.bases.pop();
  } else passed += 2;
  f.bases.length = 0; f.bases.push(...saved);
}

// ---------------------------------------------------------------------------------------------------------
section("Radio relays at any base: an outpost and the hub, none beside a station, a group brought into reach");
{
  const state = mk();
  const h = hub(state);
  const g = state.grid;
  BP.unlockAll(state); // the Radio Engineering Handbook studied
  const mech = (base) => { const s = makeSurvivor(state); s.skills.mechanics = 5; s.location = { kind: "base", baseId: base.id }; state.survivors.push(s); return s; };
  mech(h);
  Object.assign(h.stock, { scrap: 100, parts: 20 });
  check(!BUILDINGS.relay.outpostOnly && BUILDINGS.relay.plot === "utility" && BUILDINGS.relay.req.mechanics === 3 && BUILDINGS.relay.cost.parts === 3, "the relay: a utility plot, Mechanics 3+, 3 parts, no longer outposts only");
  // The hub without a station: a relay can go up (it works once a station elsewhere reaches it).
  h.radio = false;
  h.buildings = h.buildings.filter((b) => b.type !== "radio" && b.type !== "relay");
  check(canBuild(state, h, "relay").ok, `a relay at the hub with no station: buildable (${canBuild(state, h, "relay").reason || "ok"})`);
  // Queued station, or a station standing: refused (the station's 12 tiles cover the relay's 6).
  h.construction.push({ id: newId(), type: "radio", progress: 0, hours: 48 });
  const q = canBuild(state, h, "relay");
  check(!q.ok && /radio station here/.test(q.reason), `a station queued at the hub: no relay (${q.reason})`);
  h.construction.length = 0;
  addBuilding(h, "radio");
  const r = canBuild(state, h, "relay");
  check(!r.ok && /radio station here/.test(r.reason), `a station at the hub: no relay (${r.reason})`);
  // An outpost 9-11 tiles out, with a mechanic and the materials: buildable, and queueBuild takes it.
  const oTile = tileNear(state, h.tile, 9, 11);
  const o = fakeOutpost(state, oTile);
  stockTools(o); // a drill, wrenches and pliers for the relay (toolreqs.js)
  mech(o);
  Object.assign(o.stock, { scrap: 30, parts: 4 });
  check(canBuild(state, o, "relay").ok && /queued/.test(queueBuild(state, o, "relay")) && o.stock.parts === 1, "a relay at an outpost: queued, 15 scrap and 3 parts paid");
  o.construction.length = 0;
  addBuilding(o, "relay");
  const nodes = radioNodes(state);
  check(nodes.find((n) => n.base === o).linked && nodes.find((n) => n.base === o).range === RELAY_RANGE, "the outpost's relay links to the hub's station");
  // A group 6-12 tiles past the outpost (out of the hub's 12 + 6): the relay brings it into call reach, and so into
  // reach for the coalition's invitation.
  state.bases.splice(state.bases.indexOf(o), 1);
  const f = state.factions.find((x) => x.alive && x.bases.length);
  const saved = f.bases.slice();
  const fTile = tileNear(state, oTile, 9, 12, (t) => g.distance(t.id, h.tile) > RADIO_RANGE + 2 + GROUP_REACH && g.distance(t.id, h.tile) > ALLIANCE.NEIGHBOUR + 2);
  if (check(fTile != null, "a spot for the group past the outpost")) {
    f.bases.length = 0; f.bases.push(fTile);
    f.known = true; f.goodwill = 70; f.pact = "trade";
    ensureJobs(state).list.push({ id: 9901, fid: f.id, type: "scout", status: "done", endDay: day(state), data: {}, reward: { goodwill: 0, supplies: {}, gear: [] }, title: "x", desc: "", target: fTile });
    state.bases.push(o);
    const relay = o.buildings.find((b) => b.type === "relay");
    o.buildings.splice(o.buildings.indexOf(relay), 1); // no relay yet
    const why = inviteProblem(state, f);
    check(!canRadioGroup(state, f) && reachVia(state, f) === "" && /out of radio reach/.test(why), `no relay: out of radio reach ("${why}")`);
    check(relaySpotFor(state, f) === o && relayReach(state, o).includes(f) && why.includes(`radio relay at ${o.name}`), "the invitation's line names the outpost where a relay would reach them");
    o.buildings.push(relay);
    check(canRadioGroup(state, f) && reachVia(state, f) === "radio" && inviteProblem(state, f) === "", `with the relay up: in radio reach, and they can be invited (${inviteProblem(state, f) || "ok"})`);
    o.relayOffline = true;
    check(!canRadioGroup(state, f) && /out of radio reach/.test(inviteProblem(state, f)), "the relay off the air: out of reach again");
    o.relayOffline = false;
    // A relay that would not link (an outpost beyond the station's 12, though within its coverage + 6) adds nothing.
    o.buildings.splice(o.buildings.indexOf(relay), 1);
    const farTile = tileNear(state, h.tile, RADIO_RANGE + 3, RADIO_RANGE + 5, (t) => g.distance(t.id, fTile) <= RELAY_RANGE + GROUP_REACH);
    if (farTile != null) {
      state.bases.splice(state.bases.indexOf(o), 1);
      const far = fakeOutpost(state, farTile);
      check(relayReach(state, far).length === 0 && relaySpotFor(state, f) !== far, "a relay out of the station's range would not link: it reaches nobody");
      state.bases.splice(state.bases.indexOf(far), 1);
    } else passed++;
  }
  f.bases.length = 0; f.bases.push(...saved);
  // A relay at a hub with no station of its own, linked from an outpost's station: it extends coverage. With a
  // station built beside it later, it stands idle and uses no parts.
  const st2 = mk();
  const h2 = hub(st2);
  const o2 = fakeOutpost(st2, tileNear(st2, h2.tile, 8, 10));
  addBuilding(o2, "radio");
  addBuilding(h2, "relay");
  const hn = radioNodes(st2).find((n) => n.base === h2);
  check(hn && hn.kind === "relay" && hn.linked, "a hub relay without a station links to an outpost's station");
  const edge = tileNear(st2, h2.tile, RELAY_RANGE, RELAY_RANGE, (t) => st2.grid.distance(t.id, o2.tile) > RADIO_RANGE + 2);
  if (edge != null) check(radioBasesInRange(st2, edge).includes(h2), "the hub relay's 6 tiles are covered"); else passed++;
  addBuilding(h2, "radio");
  h2.stock.parts = 5;
  const sum = radioSummary(st2, h2);
  check(radioNodes(st2).find((n) => n.base === h2).kind === "station" && /relay here stands idle/.test(sum), `a station beside the relay: the base is a station, the relay idle ("${sum}")`);
  for (let d = 0; d < 12; d++) { st2.hour += 24; radioDaily(st2); }
  check(h2.stock.parts === 5 && !h2.relayOffline, "an idle relay uses no parts");
}

// ---------------------------------------------------------------------------------------------------------
section("allianceVictory: a member, 60% of the land, no hive and no group outside (2026-10-13)");
{
  const state = mk();
  const h = hub(state);
  const gp0 = goalsProgress(state).alliance;
  check(!gp0.membersOk && /no member/.test(gp0.blocks[0]) && /land \d+% of the 60%\+/.test(gp0.blocks[1]) && gp0.blocks.some((b) => /hive/.test(b)) && gp0.blocks.some((b) => /outside the coalition/.test(b)), `blocks at the start: ${gp0.blocks.join(" | ")}`);
  const A = ensureAlliance(state);
  const groups = state.factions.filter((f) => f.alive);
  const hostile = groups[groups.length - 1];
  hostile.goodwill = -80; hostile.known = true;
  for (const f of groups.slice(0, -1)) { f.known = true; f.pact = "trade"; f.goodwill = 80; A.members.push(f.id); }
  A.founded = day(state);
  // Outposts until over half the land (as wintest's forced scenario).
  let added = 0;
  while (controlledLand(state).pct <= ALLIANCE.LAND_NEEDED && added < 40) {
    const mask = coalitionMask(state);
    let best = null;
    for (const t of state.tiles) {
      if (t.terrain === "water" || t.hive || mask[t.id] || state.factions.some((f) => f.bases.includes(t.id))) continue;
      const gain = state.grid.within(t.id, ALLIANCE.CONTROL_RANGE).filter((id) => !mask[id] && state.tiles[id].terrain !== "water").length;
      if (!best || gain > best.gain) best = { t, gain };
    }
    if (!best) break;
    fakeOutpost(state, best.t.id);
    added++;
  }
  const land = controlledLand(state);
  check(land.pct > ALLIANCE.LAND_NEEDED, `over half the land with ${added} outposts (${(land.pct * 100).toFixed(1)}%)`);
  check(hostile.alive && !A.members.includes(hostile.id), "a hostile group is alive and outside");
  check(!allianceVictory(state), "land over the line, but a hostile group outside and hives standing: no victory (2026-10-13)");
  const hv = state.hives.slice(), hs = (state.hiveSites || []).slice();
  state.hives.length = 0; if (state.hiveSites) state.hiveSites.length = 0;
  check(!allianceVictory(state), "no hive, but the hostile group is still outside: no victory");
  hostile.alive = false; hostile.bases = [];
  check(allianceVictory(state) && accordHolds(state), "victory: a member, 60% of the land, no hive, no group outside");
  const gp = goalsProgress(state).alliance;
  check(gp.ok && gp.membersOk && gp.landOk && gp.allIn && gp.hivesOk && gp.blocks.length === 0, "goalsProgress: ok once every hive is gone and every group is in or broken");
  // No member: no victory, even with the land.
  const members = A.members.slice();
  A.members.length = 0;
  check(!allianceVictory(state) && /no member/.test(goalsProgress(state).alliance.blocks[0]), "no member: no victory, the blocker says so");
  A.members.push(...members);
  // Claims can close the gap: drop below the line, then claim tiles until over it.
  const o = state.bases[state.bases.length - 1];
  state.bases.pop();
  if (controlledLand(state).pct <= ALLIANCE.LAND_NEEDED) {
    const need = Math.ceil((ALLIANCE.LAND_NEEDED - controlledLand(state).pct) * controlledLand(state).land) + 1;
    const mask = coalitionMask(state);
    let n = 0;
    for (const t of state.tiles) { if (n >= need) break; if (t.terrain === "water" || mask[t.id] || t.hive || t.owner != null) continue; C.ensureClaims(state)[t.id] = { owner: "player", since: state.hour }; n++; }
    check(allianceVictory(state), `${n} claims close the gap: victory (${(controlledLand(state).pct * 100).toFixed(1)}%)`);
  } else { state.bases.push(o); passed++; }
}

// ---------------------------------------------------------------------------------------------------------
section("Save and load: claims and wells round-trip; an older save without claims loads");
{
  const state = mk();
  const h = hub(state);
  const ring = state.grid.neighbors(h.tile).filter((id) => state.tiles[id].terrain !== "water" && state.tiles[id].terrain !== "mountain");
  C.claimTile(state, null, ring[0]);
  C.ensureClaims(state)[ring[0]].well = { yield: 6, left: 2800, start: 2800, dug: state.hour };
  C.ensureClaims(state)[ring[1]] = { owner: state.factions[0].id, since: 5 };
  state.cards.length = 0;
  const save = JSON.parse(JSON.stringify(serializeState(state)));
  const loaded = deserializeState(save);
  check(JSON.stringify(loaded.claims) === JSON.stringify(state.claims), "claims round-trip as plain data");
  check(Math.abs(waterProduction(loaded, hub(loaded)).hauled - waterProduction(state, h).hauled) < 1e-9 && controlledLand(loaded).claimed === controlledLand(state).claimed, "the loaded world hauls and counts the same");
  delete state.claims;
  const old = deserializeState(JSON.parse(JSON.stringify(serializeState(state))));
  check(old.claims === undefined && C.claimedLand(old) === 0 && C.canClaim(old, ring[0]) === "" && controlledLand(old).claimed === 0, "an older save without claims: nothing claimed, claims can be made");
  C.claimsDaily(old);
  check(C.playerClaims(old).length === 0, "claimsDaily on a world with no claims table: a no-op");
}

console.log(`\n${passed} checks passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
