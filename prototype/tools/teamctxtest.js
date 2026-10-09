// Headless checks for the map's right-click menu with a team selected (ui/teamctx.js, ui/teamsel.js): which team is
// selected (a map pick in ui.selParty first, then the team panel), the action list on representative tiles (a river
// bank, a forest, a town site, a known group's base, a horde, your own base, open water) with the right items
// present, absent, or disabled with a reason (no rod, no route, out of radio contact), the time estimates, and doing
// them: a plain pick replaces the plan (asking first when orders under way would be dropped), Shift (queue mode)
// appends a move and the job, a job on the team's own tile starts at once; the hub's menu (tileActions) unchanged; and
// a render smoke test of the menu's HTML.
// Usage: node tools/teamctxtest.js [seed]
import { createWorld, hub, atBase, snapshot } from "../src/sim/world.js";
import { launchExpedition, planPath, partyTile } from "../src/sim/parties.js";
import { stripAll, newItem } from "../src/sim/inventory.js";
import { fishSpot, gameAbundance } from "../src/sim/hunting.js";
import { besideWater } from "../src/sim/orders.js";
import { NO_RADIO } from "../src/sim/plans.js";
import { tileActions } from "../src/ui/ui.js";
import { selectedTeam } from "../src/ui/teamsel.js";
import { teamTileMenu, teamCtxHtml, runTeamAction, itemHours } from "../src/ui/teamctx.js";
import { crossingsFrom } from "../src/sim/crossing.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true;
  state.noWanderers = true;
  state.cards = [];
  Object.assign(hub(state).stock, { food: 300, water: 300, fuel: 100, meds: 20, parts: 10, scrap: 100 });
  return state;
}
const reach = (state, from, id) => !!planPath(state, from, id, false);
// The nearest land tile (not a base) within d..d2 of `from`, reachable on foot, that passes `ok`.
function find(state, from, ok, d = 1, d2 = 14) {
  const list = state.tiles.filter((t) => t.terrain !== "water" && !state.bases.some((b) => b.tile === t.id)).map((t) => [t, state.grid.distance(from, t.id)])
    .filter(([, dist]) => dist >= d && dist <= d2).sort((a, b) => a[1] - b[1]);
  for (const [t] of list) if (ok(t) && reach(state, from, t.id)) return t.id;
  return null;
}
// A team of `n` (no gear), stood on `tile`, waiting, in radio contact.
function team(state, n, { tile = hub(state).tile } = {}) {
  const h = hub(state);
  const crew = atBase(state, h.id).slice(0, n);
  for (const s of crew) { s.traits = []; stripAll(s); }
  const dest = find(state, h.tile, () => true, 2, 3);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.orders = []; p.radioLive = true;
  state.cards = [];
  return p;
}
const keys = (m) => m.items.map((it) => it.key);
const item = (m, key) => m.items.find((it) => it.key === key) || null;
const has = (m, key) => !!item(m, key);

// ---------------------------------------------------------------------------------------------------------
section("Which team is selected");
{
  const state = mk();
  const p = team(state, 2);
  check(selectedTeam(state, {}) === null, "nothing selected: no team");
  check(selectedTeam(state, { expedition: p.id }) === p, "the open team panel is the selected team");
  check(selectedTeam(state, { selParty: p.id, expedition: null }) === p, "a team picked on the map (ui.selParty) with no panel open is selected");
  const q = team(state, 1);
  check(selectedTeam(state, { selParty: q.id, expedition: p.id }) === q, "the map pick comes before the open panel");
  q.radioLive = false; q.path = [find(state, hub(state).tile, () => true, 4, 8)];
  check(selectedTeam(state, { selParty: q.id, expedition: p.id }) === p, "a map pick out of radio contact falls back to the open panel");
  check(selectedTeam(state, { selParty: q.id }) === null, "…and to nothing when no panel is open");
  check(selectedTeam(state, { moveParty: p.id }) === p, "move mode selects its team");
  check(selectedTeam(state, { expedition: 99999 }) === null, "a team that is gone is not selected");
  const convoy = { ...p, id: 88888, kind: "convoy" };
  state.parties.push(convoy);
  check(selectedTeam(state, { selParty: convoy.id, expedition: convoy.id }) === null, "a convoy is not a team you give these orders to");
}

section("A forest away from water: hunt, forage, wood, camp; no fishing, no water");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 2);
  const forest = find(state, h.tile, (t) => t.terrain === "forest" && gameAbundance(state, t.id) >= 0.08 && !besideWater(state, t.id) && !fishSpot(state, t.id), 2, 12);
  if (check(forest != null, "found a dry forest tile")) {
    const m = teamTileMenu(state, {}, p, forest);
    for (const k of ["move", "survey", "sweep", "hunt", "forage", "snare:set", "camp:8", "camp:24", "camp:0", "campfire", "home"]) check(has(m, k), `forest: ${k} offered`);
    check(!has(m, "fish") && !has(m, "water"), "forest: no fishing and no water away from water");
    check(!has(m, "drop") && !has(m, "mission:enter"), "forest: no base items");
    const hunt = item(m, "hunt");
    check(hunt.move && hunt.travel > 0 && hunt.task === 8, `hunt: travel ${hunt.travel}h + 8h`);
    check(/travel \+ 8h/.test(itemHours(hunt)), `hunt shows travel + task (${itemHours(hunt)})`);
    check(/Hunt/.test(m.head.name) || /team/i.test(m.head.name), `head names the team (${m.head.name})`);
    check(/on foot/.test(m.head.situation) && /away/.test(m.head.situation), `head: on foot, hours away (${m.head.situation})`);
    // No weapon: the hunt is there but disabled with the reason.
    check(!!hunt.disabled, `hunt disabled without a weapon (${hunt.disabled})`);
    check(!item(m, "forage").disabled, "forage needs nothing");
  }
}

section("A river bank: fish (no rod: disabled), fetch water");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 2);
  const bank = find(state, h.tile, (t) => { const f = fishSpot(state, t.id); return f && (f.kind === "river" || f.kind === "bend") && besideWater(state, t.id); }, 1, 20);
  if (check(bank != null, "found a river bank")) {
    let m = teamTileMenu(state, {}, p, bank);
    check(has(m, "fish") && has(m, "water"), "river bank: fish and fetch water offered");
    check(/rod/.test(item(m, "fish").disabled || ""), `no rod: fishing disabled with the reason (${item(m, "fish").disabled})`);
    const s = state.survivors.find((x) => x.id === p.members[0]);
    s.gear.weapon = newItem("fishrod");
    m = teamTileMenu(state, {}, p, bank);
    check(!item(m, "fish").disabled, `with a rod: fishing enabled (${item(m, "fish").disabled})`);
    check(item(m, "water").task === 2, "fetch water: 2 hours on the spot");
  }
}

section("Open water: no land jobs, no move; a boat from the shore");
{
  const state = mk();
  const h = hub(state);
  const shore = find(state, h.tile, (t) => crossingsFrom(state, t.id).length > 0, 1, 25);
  if (check(shore != null, "found a shore with a crossing")) {
    const p = team(state, 2, { tile: shore });
    const c = crossingsFrom(state, shore)[0];
    const m = teamTileMenu(state, {}, p, c.water);
    check(m.head.water, "the head knows it is water");
    for (const k of ["move", "fish", "water", "hunt", "forage", "well", "claim", "camp:8", "survey"]) check(!has(m, k), `water: no ${k}`);
    check(m.items.some((it) => it.key.startsWith("cross:")), "water next to the team: boat across offered");
    const far = teamTileMenu(state, {}, p, c.tile);
    const boat = far.items.find((it) => it.key.startsWith("cross:"));
    check(!!boat && !boat.move && boat.task > 0, "the land across: boat offered, no move first, its hours");
    check(!!boat.disabled && /scrap/.test(boat.disabled), `no scrap carried: boat disabled with the reason (${boat.disabled})`);
  }
}

section("A town site you know: scavenge (no bases' items)");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 3);
  const town = find(state, h.tile, (t) => t.loc && t.loc.type !== "city" && t.loot > 0.1 && !t.hive && typeof t.owner !== "number" && !state.factions.some((f) => f.bases.includes(t.id)), 2, 20);
  if (check(town != null, "found a town site")) {
    state.live.add(town);
    const m = teamTileMenu(state, {}, p, town);
    check(has(m, "mission:scavenge"), `site: scavenge offered (${keys(m).join(",")})`);
    check(/Scavenge/.test(item(m, "mission:scavenge").label), "site: labelled as a scavenge or raid");
    check(item(m, "mission:scavenge").task == null && /on site/.test(itemHours(item(m, "mission:scavenge"))), "a raid has no fixed time: travel + on site");
    check(!has(m, "mission:trade") && !has(m, "mission:assault"), "no trade or assault at a plain site");
    check(has(m, "mission:outpost"), "an outpost can go there");
  }
}

section("A known group's base: trade, assault; no rescue without captives; no claim");
{
  const state = mk();
  const p = team(state, 3);
  const f = state.factions.find((x) => x.alive && x.bases.length && reach(state, hub(state).tile, x.bases[0]));
  if (check(!!f, "a group base reachable")) {
    f.known = true;
    const tile = f.bases[0];
    state.knowledge[tile] = snapshot(state, tile);
    const m = teamTileMenu(state, {}, p, tile);
    check(has(m, "mission:trade") && has(m, "mission:assault"), `group base: trade and assault (${keys(m).join(",")})`);
    check(/Trade visit/.test(item(m, "mission:trade").label), "trade visit / talk label");
    check(!has(m, "mission:rescue"), "no rescue without captives held there");
    check(!has(m, "claim") && !has(m, "mission:outpost"), "no claim and no outpost on another group's base");
    check(!has(m, "forage") && !has(m, "hunt") && !has(m, "camp:8") && !has(m, "campfire"), "no foraging, hunting or camping on their doorstep");
    const hereHome = item(teamTileMenu(state, {}, p, partyTile(p)), "home"), thereHome = item(m, "home");
    check(hereHome && thereHome && hereHome.task === thereHome.task && !thereHome.move, `go home: the hours from where the team is, whichever tile was clicked (${hereHome && hereHome.task} / ${thereHome && thereHome.task})`);
  }
}

section("A horde you can see: cull");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 4);
  const tile = find(state, h.tile, (t) => !t.hive, 3, 8);
  state.hordes.push({ id: 9901, tile, size: 40, bosses: 0, path: [tile], idx: 0, target: null, mix: {} });
  state.live.add(tile);
  const m = teamTileMenu(state, {}, p, tile);
  check(has(m, "mission:cull"), `horde tile: cull offered (${keys(m).join(",")})`);
  state.hordes.pop();
}

section("Your own base: enter, drop off, load, resupply; away from it they wait for the team to be there");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 2);
  p.supplies.food = 0; p.supplies.water = 0;
  let m = teamTileMenu(state, {}, p, h.tile);
  for (const k of ["mission:enter", "drop", "load", "resupply", "home"]) check(has(m, k), `own base: ${k}`);
  for (const k of ["mission:scavenge", "claim", "camp:8", "mission:outpost"]) check(!has(m, k), `own base: no ${k}`);
  check(!item(m, "drop").disabled && !item(m, "resupply").disabled, `at the base: drop off and resupply enabled (${item(m, "drop").disabled} / ${item(m, "resupply").disabled})`);
  const acts = { opened: null, "ti-open": (d) => { acts.opened = d; } };
  check(runTeamAction(state, {}, { id: p.id, tile: h.tile, key: "load", mode: "replace" }, acts) === "" && acts.opened && acts.opened.tab === "load", "Load from… opens the team inventory on its load tab");
  const msg = runTeamAction(state, {}, { id: p.id, tile: h.tile, key: "resupply", mode: "replace" });
  check(p.supplies.food >= 6 && p.supplies.water >= 6, `resupply: 3 days of food and water for 2 (${p.supplies.food} food, ${p.supplies.water} water; ${msg})`);
  m = teamTileMenu(state, {}, p, h.tile);
  check(/already carries/.test(item(m, "resupply").disabled || ""), "resupplied: nothing more to take");
  const away = team(state, 1, { tile: find(state, h.tile, () => true, 3, 6) });
  const ma = teamTileMenu(state, {}, away, h.tile);
  check(/move it here first/.test(item(ma, "drop").disabled || ""), `away: drop off waits for the team to be at the base (${item(ma, "drop").disabled})`);
  check(!item(ma, "mission:enter").disabled && item(ma, "mission:enter").move, "away: enter the base = move there, then enter");
}

section("Radio rule: out of contact, everything disabled with the reason");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 2, { tile: find(state, h.tile, () => true, 4, 8) });
  p.radioLive = false; p.phase = "out"; p.path = [partyTile(p), partyTile(p)]; p.idx = 0;
  const forest = find(state, h.tile, (t) => t.terrain === "forest", 2, 12);
  const m = teamTileMenu(state, {}, p, forest);
  check(m.items.length && m.items.every((it) => it.disabled === NO_RADIO), "every item says: no radio contact");
  check(/out of radio contact/.test(m.head.situation), "the head says so too");
  const before = p.orders.length;
  check(/radio/i.test(runTeamAction(state, {}, { id: p.id, tile: forest, key: "forage", mode: "replace" })) && p.orders.length === before, "doing one anyway is refused");
}

section("Doing it: replace, Shift appends, a job here starts now, asks before dropping orders");
{
  const state = mk();
  const h = hub(state);
  const p = team(state, 2);
  const forest = find(state, h.tile, (t) => t.terrain === "forest" && gameAbundance(state, t.id) >= 0.08, 2, 12);
  const other = find(state, h.tile, (t) => t.id !== forest && t.terrain !== "water", 3, 10);
  // Plain pick on a waiting team: goes there, the job queued for that tile.
  let msg = runTeamAction(state, {}, { id: p.id, tile: forest, key: "forage", mode: "replace" });
  check(p.phase === "out" && p.dest === forest, `forage at a distant tile: the team sets off (${msg})`);
  check(p.orders.length === 1 && p.orders[0].type === "forage" && p.orders[0].at === forest && p.orders[0].hours === 8, "…with Forage 8h queued for that tile");
  // Shift: appended after the queue (move, then the job).
  const ui = {};
  msg = runTeamAction(state, ui, { id: p.id, tile: other, key: "survey", mode: "append" });
  check(p.orders.length === 3 && p.orders[1].type === "move" && p.orders[1].tile === other && p.orders[2].type === "mission" && p.orders[2].mission === "survey" && p.orders[2].at === other, `Shift: move and look around appended (${p.orders.map((o) => o.type).join(", ")})`);
  check(p.dest === forest, "Shift: the current move goes on");
  const am = teamTileMenu(state, {}, p, other, { append: true });
  check(item(am, "camp:8").ahead > 0 && /^after /.test(itemHours(item(am, "camp:8"))), `queue mode: hours after the queue (${itemHours(item(am, "camp:8"))})`);
  // Plain pick now would drop the queue: it asks first.
  msg = runTeamAction(state, ui, { id: p.id, tile: other, key: "move", mode: "replace" });
  check(msg === null && ui.ask && ui.ask.action === "tc-do" && ui.ask.kind === "replaceorders", "replacing queued orders asks first");
  check(p.orders.length === 3, "…and changes nothing until Yes");
  msg = runTeamAction(state, ui, { ...ui.ask.data, ok: "1" });
  check(p.dest === other && p.orders.length === 0, `Yes: the team heads for the new tile, the queue dropped (${msg})`);
  // A job on the team's own tile starts at once.
  const q = team(state, 2, { tile: forest });
  msg = runTeamAction(state, {}, { id: q.id, tile: forest, key: "camp:8", mode: "replace" });
  check(q.phase === "task" && q.task && q.task.type === "camp" && q.task.hours === 8, `camp here: starts now (${msg})`);
  const mq = teamTileMenu(state, {}, q, forest);
  check(has(mq, "fireout") || has(mq, "fire"), "camping here: the fire toggle instead of Make camp with a fire");
  msg = runTeamAction(state, {}, { id: q.id, tile: forest, key: "forage", mode: "replace" });
  check(q.phase === "task" && q.task.type === "forage", `forage here while camping: switches jobs, no question (${msg})`);
  // Go home needs no move.
  const ui2 = {};
  check(runTeamAction(state, ui2, { id: q.id, tile: other, key: "home", mode: "replace" }) === null && ui2.ask, "go home while foraging: asks first (the job would be dropped)");
  msg = runTeamAction(state, ui2, { ...ui2.ask.data, ok: "1" });
  check(q.phase === "back" || !state.parties.includes(q), `go home from any tile's menu, no move first (${msg})`);
  // No route: disabled.
  const island = state.tiles.find((t) => t.terrain !== "water" && !planPath(state, h.tile, t.id, false));
  if (island) {
    const r = team(state, 1);
    const mi = teamTileMenu(state, {}, r, island.id);
    check(/No route/.test(item(mi, "move").disabled || ""), `no route over land: move disabled (${item(mi, "move").disabled})`);
  }
  // Busy on site: queue only.
  const b = team(state, 2, { tile: forest });
  b.phase = "engaged";
  const mb = teamTileMenu(state, {}, b, other);
  check(mb.forced && mb.append, "busy on site: the menu only queues");
}

section("The hub's menu is unchanged; the menu renders");
{
  const state = mk();
  const h = hub(state);
  const town = find(state, h.tile, (t) => t.loc && t.loot > 0.1, 2, 20);
  const acts = tileActions(state, town).map((a) => a[0]);
  check(acts[0] === "recon" && acts[1] === "move" && acts[2] === "sweep", "hub menu: recon, send a team, survey first");
  check(tileActions(state, h.tile).length === 0, "hub menu: nothing on your own base");
  const p = team(state, 2);
  const m = teamTileMenu(state, {}, p, town);
  const html = teamCtxHtml(state, {}, m);
  check(/data-action="tc-do"/.test(html) && /data-action="tc-mode"/.test(html), "the menu has its items and the mode toggle");
  check(/disabled/.test(html) && /data-tip=/.test(html), "disabled items carry their reasons as tips");
  check(!/undefined|NaN/.test(html), "no undefined or NaN in the menu");
  const ma = teamTileMenu(state, {}, p, town, { append: true });
  check(/data-mode="append"/.test(teamCtxHtml(state, {}, ma)) && /Adding to the queue/.test(teamCtxHtml(state, {}, ma)), "queue mode renders as such");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
