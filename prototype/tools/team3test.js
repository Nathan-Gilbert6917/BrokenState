// Headless checks for team orders, movement and interaction (batch 3):
// - TEAM-02 a site can be scavenged / raided again after it is picked over (depletion lowers what it yields).
// - TEAM-03 right-click with a team selected: that team's actions for the tile (also a team on the move, out of
//   radio range), fitting the tile (a site: scavenge; your base: drop off / load; water: no move).
// - TEAM-04 a team on the move (out of radio range too) is picked on the map, its panel shows where it is and takes
//   orders, and the selection follows it as it travels.
// Usage: node tools/team3test.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, planPath, partyTile, glideAt, orderOptions, scavengeable, PICKED_OVER } from "../src/sim/parties.js";
import { afterRaid } from "../src/sim/scavenge.js";
import { tileActions } from "../src/ui/ui.js";
import { picksAt, clickPick, syncPick, teamTileOf } from "../src/ui/mapselect.js";
import { selectedTeam } from "../src/ui/teamsel.js";
import { renderExpedition } from "../src/ui/expedition.js";
import { tickHour } from "../src/sim/world.js";
import { teamTileMenu, runTeamAction } from "../src/ui/teamctx.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true;
  state.noWanderers = true;
  state.cards = [];
  return state;
}
// The nearest land tile (not a base) within d..d2 of `from`, reachable on foot, that passes `ok`.
function find(state, from, ok, d = 1, d2 = 14) {
  const list = state.tiles.filter((t) => t.terrain !== "water" && !state.bases.some((b) => b.tile === t.id)).map((t) => [t, state.grid.distance(from, t.id)])
    .filter(([, dist]) => dist >= d && dist <= d2).sort((a, b) => a[1] - b[1]);
  for (const [t] of list) if (ok(t) && planPath(state, from, t.id, false)) return t.id;
  return null;
}
// A team of `n` from the hub, stood on `tile`, waiting.
function team(state, n, tile, { radio = false } = {}) {
  const h = hub(state);
  const crew = atBase(state, h.id).filter((s) => !state.parties.some((p) => p.members.includes(s.id))).slice(0, n);
  const dest = find(state, h.tile, () => true, 2, 3);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.orders = []; p.radioLive = radio;
  state.cards = [];
  return p;
}

// ---------------------------------------------------------------------------------------------------------
section("TEAM-02: a site can be scavenged / raided again");
{
  const state = mk();
  const h = hub(state);
  const site = find(state, h.tile, (t) => !!t.loc && t.loot > 0.2, 1, 14);
  if (check(site != null, "a site near the hub")) {
    const t = state.tiles[site];
    const p = team(state, 2, site);
    check(orderOptions(state, p).some((o) => o.mission === "scavenge"), "a fresh site offers Scavenge");
    const before = t.loot;
    // A full raid that searched everything: the site drops to its floor (scavenge.js afterRaid).
    afterRaid(state, { outcome: "extracted", loot: { supplies: {}, gear: [] }, raid: { hours: 0, searched: 40, total: 40 } }, { partyId: -1, tile: site, context: {} });
    check(t.loot < before && t.loot <= PICKED_OVER, `the raid picked it over (${before.toFixed(2)} → ${t.loot.toFixed(2)})`);
    const opt = orderOptions(state, p).find((o) => o.mission === "scavenge");
    check(opt && !opt.disabled, "a picked-over site still offers Scavenge (raid it again)");
    check(opt && /Picked over/.test(opt.desc), "…and says it is picked over");
    check(scavengeable(t), "scavengeable: a site is never closed");
    check(tileActions(state, site).some(([m]) => m === "scavenge"), "the hub's menu offers Scavenge / raid on it again");
    // A second raid on it: it stays at the floor (depletion kept), still open.
    afterRaid(state, { outcome: "extracted", loot: { supplies: {}, gear: [] }, raid: { hours: 0, searched: 5, total: 5 } }, { partyId: -1, tile: site, context: {} });
    check(t.loot >= 0.03 && orderOptions(state, p).some((o) => o.mission === "scavenge"), "a third raid is offered too; loot stays at its floor");
  }
  // Open ground with nothing left stays closed (nothing there to search).
  const open = find(state, h.tile, (t) => !t.loc && t.terrain !== "water", 2, 10);
  if (open != null) {
    const t = state.tiles[open];
    t.loot = 0.03;
    check(!scavengeable(t), "open ground with nothing left: no search");
    t.loot = 0.3;
    check(scavengeable(t), "open ground with something left: search");
  }
}

// ---------------------------------------------------------------------------------------------------------
section("TEAM-04: select a team while it moves");
{
  const state = mk();
  const h = hub(state);
  const far = find(state, h.tile, (t) => !t.loc, 9, 14);
  const p = team(state, 2, h.tile);
  p.path = planPath(state, h.tile, far, false).path; p.idx = 0; p.phase = "out"; p.dest = far; p.mission = "move";
  for (let i = 0; i < 40 && (p.radioLive || p.idx < 2); i++) { p.lastConflict = state.hour + 1; tickHour(state); state.cards = []; if (p.phase !== "out") break; }
  if (check(p.phase === "out" && p.idx < p.path.length - 1, `the team is on the move (${p.phase}, step ${p.idx}/${p.path.length - 1}, radio ${p.radioLive})`)) {
    const tile = teamTileOf(state, p);
    check(tile === partyTile(p) || p.path.indexOf(tile) === p.idx + 1, "the map shows it where it is (its tile or the next it is nearer to, not an estimate)");
    const picks = picksAt(state, tile, new Set());
    check(picks.some((x) => x.kind === "team" && x.id === p.id), "its tile offers it as a pick");
    const ui = { selected: null, mapSel: null, expedition: null, selParty: null, xpMsg: "" };
    const got = clickPick(state, ui, tile);
    check(got && got.kind === "team" && ui.expedition === p.id, "a click on its tile selects it (its team panel)");
    syncPick(state, ui);
    check(selectedTeam(state, ui) === p, "it is the selected team (right-click orders go to it)");
    const html = renderExpedition(state, ui, p);
    check(/At /.test(html) && !/No radio contact/.test(html) && /Redirect…/.test(html), "the right panel shows where it is and its orders while it travels");
    // It walks on: the selection follows.
    const from = partyTile(p);
    for (let i = 0; i < 12 && partyTile(p) === from && p.phase === "out"; i++) { p.lastConflict = state.hour + 1; tickHour(state); state.cards = []; }
    syncPick(state, ui);
    check(partyTile(p) === from || ui.selected === teamTileOf(state, p), `the selection follows it (${ui.selected} / ${partyTile(p)})`);
    check(ui.expedition === p.id, "its panel stays open as it moves");
    // TEAM-03: right-click a site with this moving team selected: its own actions for the site.
    const site = find(state, partyTile(p), (t) => !!t.loc && t.loot > 0.1, 1, 8);
    if (check(site != null, "a site near the moving team")) {
      const sel = selectedTeam(state, ui);
      const m = teamTileMenu(state, ui, sel, site);
      const it = (k) => m.items.find((x) => x.key === k);
      check(m.p === p && it("move") && !it("move").disabled, "TEAM-03: the menu is the selected team's: Move here, enabled");
      check(it("mission:scavenge") && !it("mission:scavenge").disabled, "TEAM-03: Scavenge / raid the site, enabled");
      check(!m.items.some((x) => x.key === "drop" || x.key === "load"), "TEAM-03: no base actions on a site");
      check(m.items.some((x) => x.key === "home"), "TEAM-03: Go home offered");
      const msg = runTeamAction(state, ui, { id: p.id, tile: site, key: "mission:scavenge", mode: "replace" });
      check(p.phase === "out" && p.path[p.path.length - 1] === site, `TEAM-03: the order is given to the moving team (${msg})`);
      const hm = teamTileMenu(state, ui, sel, hub(state).tile);
      check(hm.items.some((x) => x.key === "drop") && !hm.items.some((x) => x.key === "mission:scavenge"), "TEAM-03: on your base, the base actions instead");
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
