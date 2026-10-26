// The land order box (ui/landorder.js, sim/landest.js; the user's request 2026-10-23: "For gathering LAND orders for
// Forage, Hunt, Fish, Cut Wood, Gather Stones when you select provide a input dialogue to set how many hours and
// estimated amount of yield depending on how many hours and the gear of the team/survivor(s) inventory and skills"):
// the estimate grows with the hours (up to what the team can carry), with the gear (an axe, a pickaxe, a rifle, a rod)
// and with the skills; picking the job from the team panel or the right-click menu opens the box (not for water, not
// asked twice, not for the autopilot); its hours and quantity go into the order given.
// Usage: node tools/landordertest.js [seed]
import { setFood } from "./foodkit.js";
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, planPath, partyMembers } from "../src/sim/parties.js";
import { stripAll, newItem } from "../src/sim/inventory.js";
import { fishSpot, gameAbundance } from "../src/sim/hunting.js";
import { stoneAbundance } from "../src/sim/stone.js";
import { woodAbundance } from "../src/sim/woodcutting.js";
import { startOrder, taskHour, tasksDue, huntHours, describeOrder } from "../src/sim/orders.js";
import { landEstimate, landEstimates, LAND_HOURS } from "../src/sim/landest.js";
import { askLand, landHtml, landModel, LAND_ACTIONS, LAND_CHANGE } from "../src/ui/landorder.js";
import { askQty } from "../src/ui/carry.js";
import { landPick, runTeamAction } from "../src/ui/teamctx.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true; state.noWanderers = true; state.cards = [];
  state.hour = Math.floor(state.hour / 24) * 24 + 8; // 8 in the morning: a working day ahead
  Object.assign(hub(state).stock, { water: 300, fuel: 100, meds: 20, parts: 10, scrap: 100 }); setFood(hub(state), 300);
  return state;
}
function find(state, from, ok, d = 1, d2 = 14) {
  const list = state.tiles.filter((t) => t.terrain !== "water" && !state.bases.some((b) => b.tile === t.id)).map((t) => [t, state.grid.distance(from, t.id)])
    .filter(([, dist]) => dist >= d && dist <= d2).sort((a, b) => a[1] - b[1]);
  for (const [t] of list) if (ok(t) && planPath(state, from, t.id, false)) return t.id;
  return null;
}
// A team of n (no gear), stood on `tile`, waiting.
function team(state, n, tile) {
  const h = hub(state);
  const crew = atBase(state, h.id).slice(0, n);
  for (const s of crew) { s.traits = []; stripAll(s); s.health = 100; }
  const dest = find(state, h.tile, () => true, 2, 3);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.orders = []; p.radioLive = true;
  state.cards = [];
  return p;
}
const spare = (p, key) => { const it = newItem(key); p.cargo.gear.push(it); return it; };

section("The estimate: hours, gear and skills");
{
  const state = mk();
  const h = hub(state);
  const forest = find(state, h.tile, (t) => t.terrain === "forest" && woodAbundance(state, t.id) >= 0.3 && gameAbundance(state, t.id) >= 0.08, 2, 14);
  const p = team(state, 2, forest);
  const at = (type, hours, extra = {}) => landEstimate(state, p, type, { tile: forest, hours, ...extra });
  // Hours: more hours, more (as far as the land and the team's room allow).
  for (const type of ["forage", "wood", "stone"]) {
    const [a, b] = [at(type, 4), at(type, 8)];
    check(b.amount > a.amount && a.amount > 0, `${type}: 8h brings more than 4h (${a.amount} → ${b.amount} ${b.unit})`);
    check(b.crew.length === 2 && b.crew.every((c) => c.name && c.skills), `${type}: each person's line (${b.crew.map((c) => `${c.name} ${c.gear}`).join("; ")})`);
  }
  const rows = landEstimates(state, p, "wood", LAND_HOURS.presets, { tile: forest });
  check(rows.length === LAND_HOURS.presets.length && rows.every((r, i) => !i || r.amount >= rows[i - 1].amount), `the lengths in order: ${rows.map((r) => `${r.hours}h ~${r.amount}`).join(", ")}`);
  check(at("wood", 99).hours === LAND_HOURS.max && at("wood", 0).hours === LAND_HOURS.def && at("wood", 0.2).hours === LAND_HOURS.min && LAND_HOURS.min === 0.5 && at("wood", 2.3).hours === 2.5, "hours kept to 30 minutes–24 hours, by the half hour (orders.js huntHours)");
  // Gear: an axe for wood, a pickaxe for stone.
  const wood0 = at("wood", 8).amount, stone0 = at("stone", 8).amount;
  check(/bare hands/.test(at("wood", 8).crew[0].gear), "no axe: bare hands");
  const axe = spare(p, "fireaxe"), pick = spare(p, "pickaxe");
  const wood1 = at("wood", 8), stone1 = at("stone", 8);
  check(wood1.amount > wood0 * 1.3 && wood1.crew.some((c) => c.gear === axe.name), `an axe in the cargo: more wood (${wood0} → ${wood1.amount}), used by ${wood1.crew.find((c) => c.gear === axe.name)?.name}`);
  check(stone1.amount > stone0 * 1.3 && stone1.crew.some((c) => c.gear === pick.name), `a pickaxe: more stone (${stone0} → ${stone1.amount})`);
  // Carrying room caps it: an hour's stone is small, 24 hours of wood for two is more than they carry.
  const big = at("wood", 24);
  check(big.kg <= big.room + 0.01 && (big.capped || big.all <= big.amount + 0.5), `what is kept fits the team's room (${big.kg} of ${Math.round(big.room)} kg; ${big.all} cut)`);
  // The most to bring back caps it too.
  check(at("wood", 8, { qty: 10 }).amount <= 10 && at("wood", 8, { qty: 10 }).capped, "at most 10 wood: the estimate stops at 10");
  // Skills: a better forager brings more.
  const [a] = partyMembers(state, p);
  const f0 = at("forage", 8).amount;
  const keep = { ...a.skills };
  a.skills.farming = 15; a.skills.scouting = 15;
  check(at("forage", 8).amount > f0, `Farming and Scouting 15: more wild food (${f0} → ${at("forage", 8).amount})`);
  a.skills = keep;
  // Hunting: nobody armed cannot; a rifle and ammo can, the rifle named.
  check(!!at("hunt", 8).why && at("hunt", 8).amount === 0, `no hunting weapon: cannot (${at("hunt", 8).why})`);
  a.gear.weapon = newItem("huntrifle");
  p.supplies.ammo = 40;
  const hu = at("hunt", 8);
  check(hu.amount > 0 && hu.crew.some((c) => c.gear === a.gear.weapon.name), `a hunting rifle: ~${hu.amount} ${hu.unit} (${hu.crew.map((c) => c.gear).join(", ")})`);
  check(at("hunt", 12).amount > at("hunt", 4).amount, "hunting 12h brings more than 4h");
  // Fishing only on a shore.
  check(!!at("fish", 8).why === !fishSpot(state, forest), "fishing: only beside a river or lake");
}

section("Fishing: a rod");
{
  const state = mk();
  const shore = find(state, hub(state).tile, (t) => !!fishSpot(state, t.id), 1, 40); // the team is put on it, so any distance does (the hub's nearest shore is 15 away on seed 42 since the 250 × 150 maps, 1370d1cf)
  if (check(shore != null, "a shore to fish from")) {
    const p = team(state, 2, shore);
    const e0 = landEstimate(state, p, "fish", { tile: shore, hours: 8 });
    spare(p, "fishrod");
    const e1 = landEstimate(state, p, "fish", { tile: shore, hours: 8 });
    check(e0.amount === 0 && e1.amount > 0 && /1 rod/.test(e1.kit), `no rod: nothing; a rod: ~${e1.amount} ${e1.unit} (${e1.kit})`);
  }
}

section("The box: opening, drawing, the order it gives");
{
  const state = mk();
  const h = hub(state);
  const tile = find(state, h.tile, (t) => woodAbundance(state, t.id) >= 0.3 && stoneAbundance(state, t.id) >= 0.1, 2, 14);
  const p = team(state, 2, tile);
  spare(p, "fireaxe");
  // Opening: a land job yes; water, a job already asked, the autopilot no.
  let ui = {};
  check(!askLand(state, ui, { id: String(p.id), type: "water" }, { via: "xp", type: "water" }) && !ui.landAsk, "Fetch water: not this box (the how-much box)");
  check(!askLand(state, ui, { id: String(p.id), type: "wood", asked: "1" }, { via: "xp", type: "wood" }), "asked already: the order goes");
  state.autopilot = true;
  check(!askLand(state, ui, { id: String(p.id), type: "wood" }, { via: "xp", type: "wood" }), "the autopilot is never asked");
  state.autopilot = false;
  check(!askQty(state, {}, { id: String(p.id), type: "wood" }), "the old how-much box no longer opens for wood");
  check(askLand(state, ui, { id: String(p.id), type: "wood" }, { via: "xp", type: "wood", tile }) && ui.landAsk.hours === LAND_HOURS.def, "Cut wood: the box opens at 8 hours");
  const html = landHtml(state, ui);
  check(/Cut wood: how long\?/.test(html) && /data-action="land-hours"/.test(html) && /data-action="land-go"/.test(html) && /Expected in 8h/.test(html) && !/undefined|NaN/.test(html), "it draws: hours, the estimate, the order");
  check(/Fire axe|axe/i.test(html) && partyMembers(state, p).every((s) => html.includes(s.name.split(" ")[0])), "…with each person and the axe they would use");
  check(/Bring back at most/.test(html), "…and the most to bring back");
  // The hours and the quantity.
  LAND_ACTIONS["land-sethours"](state, ui, { h: "12" });
  check(ui.landAsk.hours === 12 && /Expected in 12h/.test(landHtml(state, ui)), "12h picked: the estimate follows");
  LAND_CHANGE["land-hours"](state, ui, { value: "30" });
  check(ui.landAsk.hours === LAND_HOURS.max, "typed 30: kept to 24");
  LAND_CHANGE["land-hours"](state, ui, { value: "6" });
  LAND_CHANGE["land-qty"](state, ui, { value: "50" });
  const m = landModel(state, ui);
  check(m.est.hours === 6 && m.est.amount <= 50, `6h, at most 50 wood: ~${m.est.amount}`);
  // Go: the team panel's action runs again with the hours and the quantity; the order is given.
  let got = null;
  const acts = { "xp-order": (d) => { got = d; startOrder(state, p, { type: d.type, hours: Number(d.hours), ...(d.qty ? { qty: Number(d.qty) } : {}) }); } };
  LAND_ACTIONS["land-go"](state, ui, {}, null, acts);
  check(!ui.landAsk && got && got.asked === "1" && got.hours === "6" && got.qty === "50", `Cut wood 6h, at most 50 (${JSON.stringify(got)})`);
  check(p.phase === "task" && p.task.type === "wood" && p.task.hours === 6 && p.task.qty === 50, `the team cuts wood 6h, 50 at most (${p.phase} ${p.task?.type} ${p.task?.hours} ${p.task?.qty})`);
  p.phase = "waiting"; p.task = null;
  // Max: no quantity sent (as much as fits).
  ui = {};
  askLand(state, ui, { id: String(p.id), type: "stone" }, { via: "xp", type: "stone", tile });
  check(!/Bring back at most/.test(landHtml(state, ui)) && /as much as it can carry/.test(landHtml(state, ui)), "Gather stone: hours only, as much as the team carries");
  LAND_ACTIONS["land-go"](state, ui, {}, null, { "xp-order": (d) => { got = d; } });
  check(got.type === "stone" && got.hours === "8" && got.qty === "", "Gather stone 8h, no quantity");
  // Esc / Cancel.
  ui = {};
  askLand(state, ui, { id: String(p.id), type: "forage" }, { via: "xp", type: "forage", tile });
  LAND_ACTIONS["land-close"](state, ui);
  check(!ui.landAsk, "Cancel closes it, nothing given");
}

section("The right-click menu: the item's hours, then the order");
{
  const state = mk();
  const h = hub(state);
  const tile = find(state, h.tile, (t) => woodAbundance(state, t.id) >= 0.3 && stoneAbundance(state, t.id) >= 0.1, 2, 14);
  const p = team(state, 2, tile);
  const lp = landPick(state, {}, { id: p.id, tile, key: "stone", mode: "replace" });
  check(lp && lp.type === "stone" && lp.hours === 8 && lp.tile === tile, `Gather stone here: the box's job (${JSON.stringify(lp)})`);
  check(landPick(state, {}, { id: p.id, tile, key: "move", mode: "replace" }) === null, "Move: no box");
  const ui = {};
  check(askLand(state, ui, { id: String(p.id), tile: String(tile), key: "stone", mode: "replace" }, { via: "tc", ...lp }), "the box opens for it");
  LAND_ACTIONS["land-sethours"](state, ui, { h: "4" });
  let msg = null;
  LAND_ACTIONS["land-go"](state, ui, {}, null, { "tc-do": (d) => { msg = runTeamAction(state, {}, d); } });
  check(p.phase === "task" && p.task.type === "stone" && p.task.hours === 4, `Gather stone 4h under way (${msg})`);
  // A distant tile: the job queued after the walk keeps the hours and the quantity.
  p.phase = "waiting"; p.task = null; p.orders = [];
  const far = find(state, tile, (t) => woodAbundance(state, t.id) >= 0.3, 2, 6);
  const lp2 = landPick(state, {}, { id: p.id, tile: far, key: "wood", mode: "replace" });
  check(lp2 && lp2.startHour > state.hour, `a distant tile: the estimate from the arrival (${lp2 && lp2.startHour - state.hour}h away)`);
  msg = runTeamAction(state, {}, { id: p.id, tile: far, key: "wood", mode: "replace", hours: "12", qty: "40", asked: "1" });
  const q = p.orders.find((o) => o.type === "wood");
  check(q && q.hours === 12 && q.qty === 40 && q.at === far, `Cut wood 12h, at most 40, queued for the tile (${msg})`);
}

section("Half hours: 30 minutes at least, the yield by the time worked");
{
  // The user's request 2026-10-26: "Allow for doing gathering missions by 30 minutes instead of by hours update yield
  // based on this too ... Minimum is 30 min orders and scalp yield based on this".
  const state = mk();
  const h = hub(state);
  const tile = find(state, h.tile, (t) => woodAbundance(state, t.id) >= 0.3 && stoneAbundance(state, t.id) >= 0.1, 2, 14);
  const p = team(state, 2, tile);
  const at = (type, hours) => landEstimate(state, p, type, { tile, hours });
  for (const type of ["forage", "wood", "stone"]) {
    const [a, b, c, d] = [at(type, 0.5), at(type, 1), at(type, 2), at(type, 2.5)];
    check(a.hours === 0.5 && a.amount > 0 && Math.abs(a.amount - b.amount / 2) <= 0.1 + b.amount * 0.02, `${type}: 30 minutes bring half an hour's (${a.amount} against ${b.amount} in 1h)`);
    check(d.amount > c.amount && d.amount < at(type, 3).amount, `${type}: 2h 30m between 2h and 3h (${c.amount} < ${d.amount} < ${at(type, 3).amount})`);
  }
  check(huntHours({ hours: 0.5 }) === 0.5 && huntHours({ hours: 0.1 }) === 0.5 && huntHours({ hours: 1.4 }) === 1.5 && describeOrder(state, { type: "stone", hours: 0.5 }) === "Gather stone 30m" && describeOrder(state, { type: "wood", hours: 2.5 }) === "Cut wood 2h 30m", "the order's hours by the half hour, 30 minutes at least");
  // The box: 30 minutes from the slider's foot, in the words.
  const ui = {};
  askLand(state, ui, { id: String(p.id), type: "stone" }, { via: "xp", type: "stone", tile });
  LAND_ACTIONS["land-sethours"](state, ui, { h: "0.5" });
  let html = landHtml(state, ui);
  check(ui.landAsk.hours === 0.5 && /Expected in 30m/.test(html) && /Gather stone 30m<\/button>/.test(html) && /step="0.5"/.test(html) && /min="0.5"/.test(html), "the box: 30 minutes picked, the slider by the half hour");
  LAND_CHANGE["land-hours"](state, ui, { value: "2.5" });
  html = landHtml(state, ui);
  check(ui.landAsk.hours === 2.5 && /Expected in 2h 30m/.test(html) && landModel(state, ui).all.length === (LAND_HOURS.max - LAND_HOURS.min) / LAND_HOURS.step + 1, "2h 30m typed: the estimate follows (one an every half hour on the slider)");
  ui.landAsk = null;
  // The order: a 30-minute one works half an hour and ends at the tick (headless: everything on the hour).
  const run = (type, hours, ticks, frac = null) => {
    p.phase = "waiting"; p.task = null; p.orders = []; p.cargo.supplies = {};
    startOrder(state, p, { type, hours });
    const t = p.task;
    for (let i = 0; i < ticks && p.task === t; i++) taskHour(state, p);
    if (frac != null && p.task === t) tasksDue(state, frac);
    return { t, done: p.task !== t };
  };
  for (const type of ["forage", "wood", "stone"]) {
    const r = run(type, 0.5, 1);
    check(r.done && r.t.worked === 0.5 && r.t.hours === 0.5, `${type} 30m: done in one tick, half an hour worked (${r.t.worked})`);
  }
  const r3 = run("stone", 2.5, 3);
  check(r3.done && r3.t.worked === 2.5 && r3.t.done === 3, `Gather stone 2h 30m on the hour: three ticks, the last half an hour (${r3.t.worked} worked)`);
  const r2 = run("stone", 2.5, 2, 0.5);
  check(r2.done && r2.t.worked === 2.5 && r2.t.done === 2 && p.cargo.supplies.stone > 0, `with the clock's minutes: it ends at half past, its last half hour worked (${r2.t.worked} worked, ${p.cargo.supplies.stone} stone)`);
  // Started at twenty past (owed): 30 minutes end at ten to, before the tick, with half an hour worked.
  p.phase = "waiting"; p.task = null; p.orders = []; p.cargo.supplies = {};
  startOrder(state, p, { type: "stone", hours: 0.5 });
  const t = p.task;
  t.owed = 1 / 3;
  tasksDue(state, 0.6);
  check(p.task === t && !t.worked, "started at twenty past: not done at 36 minutes past");
  tasksDue(state, 0.84);
  check(p.task !== t && Math.abs(t.worked - 0.5) < 1e-6, `…done at ten to, half an hour worked (${t.worked})`);
  // Over many 30-minute orders the stone is about half what as many hours bring.
  let half = 0, full = 0;
  for (let i = 0; i < 60; i++) { run("stone", 0.5, 1); half += p.cargo.supplies.stone || 0; run("stone", 1, 1); full += p.cargo.supplies.stone || 0; }
  check(half > full * 0.35 && half < full * 0.65, `the yield by the time: 60 half hours ${half} stone, 60 hours ${full}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
