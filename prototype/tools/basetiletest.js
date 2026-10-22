// Teams that end on one of your bases (sim/staging.js makeCamp, sim/parties.js settleInto / returnHome, sim/moveout.js
// enterOption / joinBase): establishing a base disbands the team into it (its people residents, its vehicle parked,
// its cargo in the stores), a finished camp takes in a team that came back with a Move order, and "Enter <base>" for a
// team standing on any of your bases (its home too, one that waited outside, one that said No on the Enter card, one
// that ended another order there, a queued Enter) from the orders card, the team panel, the Teams tab and the tile
// panel. Every merge leaves nothing pointing at the gone team; saves before and after.
// Usage: node tools/basetiletest.js [seed]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, residents, makeSurvivor, newId, alive } from "../src/sim/world.js";
import { partyTile, partyMembers, orderMove, giveOrder, orderOptions, outpostName, launchExpedition, ordersCard, planPath, MISSIONS, teamName } from "../src/sim/parties.js";
import { startOrder, queueOrder } from "../src/sim/orders.js";
import { moveTeamOut, enterOption, enterCard } from "../src/sim/moveout.js";
import { addBuilding } from "../src/sim/buildings.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { takePrisonersAt } from "../src/sim/prisoners.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { GEAR } from "../src/sim/data.js";
import { renderLeft, renderRight } from "../src/ui/ui.js";

// Setting up a camp takes an hour (staging.js STAGING.PITCH): skipped here, the camp stands at once.
const establishNow = (st, p) => { p.pitched = true; return giveOrder(st, p, "establish"); };

const SEED = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  passed: ${msg}`); } else { fails++; console.log(`  FAILED: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function run(st, hours, done = () => false, each = null) {
  for (let i = 0; i < hours && !done(); i++) {
    st.hordes.length = 0;
    tickHour(st);
    st.cards.length = 0;
    if (st.engagement) st.engagement = null;
    if (st.combat) st.combat = null;
    if (each) each();
  }
}
// Nothing may point at a gone team: people, vehicles, prisoners, cards, an open trade or search, supply jobs, crews.
function dangling(st, id) {
  const out = [];
  if (st.parties.some((p) => p.id === id)) out.push("still in state.parties");
  for (const s of st.survivors) if (s.alive && s.location && s.location.kind === "party" && s.location.partyId === id) out.push(`survivor ${s.name}`);
  for (const v of st.vehicles || []) if (v.loc && v.loc.kind === "party" && v.loc.partyId === id) out.push(`vehicle ${v.name}`);
  for (const pr of st.prisoners || []) if (pr.at && pr.at.kind === "party" && pr.at.partyId === id) out.push(`prisoner ${pr.name}`);
  for (const c of st.cards) if (c.partyId === id) out.push(`card ${c.title}`);
  if (st.trade && st.trade.partyId === id) out.push("trade");
  if (st.engagement && st.engagement.partyId === id) out.push("engagement");
  for (const j of (st.supplyRuns || [])) if (j.partyId === id) out.push("supply run");
  for (const r of (st.work && st.work.roles) || []) if (r.crew && r.crew.out && r.crew.out.partyId === id) out.push(`crew ${r.name}`);
  return out;
}
const freshUi = () => ({ started: true, speed: 0, tab: "teams", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false, scale: 1, armed: { parties: new Map(), builds: new Set(), crafts: new Set() } });
const roundTrip = (st) => { st.cards.length = 0; return loadFromString(saveToString(st)); }; // a card waiting cannot be saved (save.js)

// ---------- 1. establishing a base: the team moves in and is disbanded ----------
// Since 2026-10-09 a camp is the barest base (sim/staging.js): Establish base sets it up in an hour and the team moves in
// at once (its people residents, its vehicle parked, its cargo in the stores); the camp is built up into the shelter later.
section("Establish base: the team that sets up the camp moves into it and is disbanded");
{
  const st = createWorld({ seed: 77, factionCount: 7, mode: "hardcore" });
  st.noWanderers = true;
  const p = roadTeam(st);
  const id = p.id;
  const people = partyMembers(st, p).map((s) => s.id);
  const car = st.vehicles.find((v) => v.loc.kind === "party" && v.loc.partyId === id);
  Object.assign(p.cargo.supplies, { scrap: 30, parts: 5, water: 40, fuel: 3, buildmat: 4 }); setFood(p.cargo, 40);
  p.cargo.gear.push({ key: "crowbar", name: GEAR.crowbar.name, quality: 1 });
  establishNow(st, p);
  const h = hub(st);
  check(!!h && h.camp === true && h.tier === 0, "the camp stands: a base (a camp, tier 0)");
  check(!st.parties.some((q) => q.owner === "player"), "the team is disbanded (no player team left)");
  check(h && people.every((sid) => { const s = st.survivors.find((x) => x.id === sid); return s.alive && s.location.kind === "base" && s.location.baseId === h.id; }), "every member lives at the camp");
  check(h && residents(st, h.id).length === people.length, `its residents are the team (${h && residents(st, h.id).length})`);
  check(!car || (car.loc.kind === "base" && car.loc.baseId === h.id), `the vehicle is parked there (${car ? car.loc.kind : "no car"})`);
  check(h && h.armory.some((g) => g.key === "crowbar") && h.stock.fuel >= 3, "its cargo went into the stores and the armory");
  check(dangling(st, id).length === 0, `nothing points at the gone team (${dangling(st, id).join(", ") || "clean"})`);
  const after = roundTrip(st);
  check(hub(after) && hub(after).camp === true && !after.parties.some((q) => q.owner === "player") && residents(after, hub(after).id).length === people.length, "save / load: the camp with its people, no team");
  run(st, 24 * 10, () => !!hub(st) && hub(st).camp !== true);
  check(hub(st) && hub(st).camp !== true && hub(st).tier === 0 && residents(st, hub(st).id).length === people.length, `its builders build it up into the shelter with what the team brought (${hub(st) && hub(st).camp ? "still a camp" : "a shelter"})`);
}

section("A camp takes in a team that comes back with a Move order (the Enter card), like any base");
{
  const st = createWorld({ seed: 23, factionCount: 7, mode: "hardcore" });
  st.noWanderers = true;
  const p = roadTeam(st);
  Object.assign(p.cargo.supplies, { scrap: 30, parts: 5, water: 40, buildmat: 4 }); setFood(p.cargo, 40);
  giveOrder(st, p, "camp"); p.pitched = true; giveOrder(st, p, "camp");
  const camp = st.bases[0];
  check(!!camp && camp.camp === true && !camp.construction.length, "Set up camp: a plain camp, nothing building");
  const tile0 = camp.tile;
  const away = st.tiles.find((t) => t.terrain !== "water" && t.terrain !== "mountain" && !t.hive && st.grid.distance(t.id, tile0) === 2 && planPath(st, tile0, t.id, false));
  const lp = launchExpedition(st, { memberIds: residents(st, camp.id).map((s) => s.id), dest: away.id, mission: "move", stance: "normal", fromBaseId: camp.id, supplies: { food: 4, water: 4 } });
  check(!lp.error, `a team leaves the camp like any base (${lp.error || "ok"})`);
  const q = lp.party;
  run(st, 48, () => q.phase === "waiting" && partyTile(q) === away.id);
  check(st.bases.includes(camp) && !residents(st, camp.id).length, "with nobody there the camp stands empty");
  orderMove(st, q, tile0);
  run(st, 48, () => partyTile(q) === tile0 && q.phase === "waiting");
  check(enterOption(st, q, tile0) && !enterOption(st, q, tile0).disabled, "back at the camp: Enter is offered");
  giveOrder(st, q, "enter");
  check(!st.parties.includes(q) && residents(st, camp.id).length === partyMembers(st, q).length, "Enter: the team moved back in");
  check(dangling(st, q.id).length === 0, "nothing points at the gone team");
}

// ---------- 2. Enter base ----------
function mk(seed = SEED) {
  const st = createWorld({ seed, factionCount: 7 });
  st.started = true;
  st.autoCombat = true;
  st.noWanderers = true;
  Object.assign(hub(st).stock, { water: 300, fuel: 100, meds: 20, ammo: 300, parts: 10, scrap: 100 }); setFood(hub(st), 300);
  addBuilding(hub(st), "bunkhouse");
  delete hub(st).crowdNote;
  return st;
}
const mkOutpost = (st, tile) => {
  const b = { id: newId(), tile, type: "outpost", name: outpostName(st, tile), stock: { food: 40, water: 40, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0, preserved: 0, jars: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(b);
  return b;
};
function tileNear(st, from, d, d2) {
  for (const t of st.tiles) {
    const dist = st.grid.distance(from, t.id);
    if (dist < d || dist > d2 || t.terrain === "water" || (t.owner != null && t.owner !== "player") || st.bases.some((b) => b.tile === t.id) || st.factions.some((f) => f.bases.includes(t.id))) continue;
    if (planPath(st, from, t.id, false)) return t.id;
  }
  return null;
}
const enterOpt = (st, p) => orderOptions(st, p).find((o) => o.mission === "enter");

section("Enter base: a team at its own base that waited outside (moved out with no destination)");
{
  const st = mk();
  const h = hub(st);
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 2);
  const food0 = food(h);
  const res = moveTeamOut(st, { baseId: h.id, memberIds: crew.map((s) => s.id), supplies: { food: 6, water: 6 } });
  const p = res.party;
  check(p && p.phase === "waiting" && partyTile(p) === h.tile, "a team waits outside the hub");
  check(p && !st.cards.some((c) => c.partyId === p.id && c.enterBase != null), "moved out with no destination: not asked to enter (it waits outside)");
  const o = p && enterOpt(st, p);
  check(o && !o.disabled && o.label === `Enter ${h.name}`, `the orders offer "${o && o.label}"`);
  const card = p && ordersCard(st, p, "");
  check(card && card.choices.some((c) => c.label === `Enter ${h.name}` && !c.disabled), "the orders card lists it");
  const ui = freshUi();
  const left = renderLeft(st, { ...ui, tab: "teams" });
  check(/data-mission="enter"/.test(left), "the Teams tab's team card has the Enter button");
  const right = renderRight(st, { ...ui, selected: h.tile });
  check(/data-mission="enter"/.test(right) && right.includes(`Enter ${h.name}`), "the base tile's panel has it on the team's card");
  const panel = renderRight(st, { ...ui, expedition: p.id });
  check(/data-mission="enter"/.test(panel), "the team panel has it among its orders");
  p.cargo.supplies.scrap = 9;
  p.cargo.gear.push({ key: "crowbar", name: GEAR.crowbar.name, quality: 1 });
  const msg = startOrder(st, p, { type: "mission", mission: "enter" });
  check(!st.parties.includes(p), `Enter: the team is disbanded (${msg})`);
  check(crew.every((s) => s.location.kind === "base" && s.location.baseId === h.id), "its people live at the hub again");
  check(food(h) >= food0 && h.stock.scrap >= 109 && h.armory.some((g) => g.key === "crowbar"), "what it carried is in the stores and the armory");
  check(st.log.some((l) => /is home/.test(l.text)), "the log: the team is home (its own base)");
  check(dangling(st, p.id).length === 0, "nothing points at the gone team");
}

section("Enter card: a team that ends a Move on its own home tile is asked; No leaves it waiting with Enter base");
{
  // Ticks keeping only the team's own cards, until its Enter card or orders card is up (or done says stop).
  const until = (st, p, done = () => false) => { for (let i = 0; i < 200 && !done() && !st.cards.some((c) => c.partyId === p.id && (c.enterBase != null || c.isOrders)); i++) { st.hordes.length = 0; tickHour(st); if (st.combat) st.combat = null; if (st.engagement) st.engagement = null; for (let j = st.cards.length - 1; j >= 0; j--) { const c = st.cards[j]; if (c.partyId !== p.id) st.cards.splice(j, 1); else if (c.enterBase == null && !c.isOrders) { st.cards.splice(j, 1); const ch = (c.choices || []).find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)); if (ch) ch.resolve(st); } } } return st.cards.find((c) => c.partyId === p.id); }; // the road's own cards (a loner, a find) answered with their first choice
  for (const answer of ["No", "Yes"]) {
    const st = mk();
    const h = hub(st);
    const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 2);
    const out = tileNear(st, h.tile, 2, 3);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: out, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } });
    const p = res.party;
    // A plain Move that got there raises no card at all since orders reach a team anywhere (TEAM-01, parties.js
    // quietArrival): a log line, and the team waits for orders.
    const c0 = until(st, p, () => p.phase === "waiting" && partyTile(p) === out);
    check(!c0 && partyTile(p) === out && p.phase === "waiting" && st.log.some((l) => /reached .* and waits for orders/.test(l.text) && l.text.startsWith(teamName(st, p))), `${answer}: a Move to an empty tile ends with a log line, not the Enter card or an orders card (${c0 ? c0.title : "no card"})`);
    st.cards.length = 0;
    orderMove(st, p, h.tile);
    const card = until(st, p);
    check(card && card.enterBase === h.id && card.title === `Enter ${h.name}?` && !/instead of/.test(card.text), `${answer}: back on its home tile with a Move: "${card && card.title}"`);
    check(card && !st.cards.some((c) => c.isOrders && c.partyId === p.id), `${answer}: instead of the orders card`);
    if (!card) continue;
    const yes = card.choices.find((c) => /^Yes/.test(c.label)), no = card.choices.find((c) => /^No/.test(c.label));
    if (answer === "Yes") {
      check(yes.ai(st) > no.ai(st), "the autopilot says yes at its own home");
      st.cards.length = 0;
      const text = yes.resolve(st);
      check(!st.parties.includes(p) && crew.every((s) => s.location.kind === "base" && s.location.baseId === h.id), `Yes: the team is home and disbanded (${text})`);
      check(dangling(st, p.id).length === 0, "nothing points at the gone team");
    } else {
      st.cards.length = 0;
      no.resolve(st);
      check(st.parties.includes(p) && p.phase === "waiting" && partyTile(p) === h.tile && crew.every((s) => s.location.kind === "party"), "No: still a team, waiting on the hub's tile");
      check(st.cards.some((c) => c.isOrders && c.partyId === p.id) && enterOpt(st, p) && !enterOpt(st, p).disabled, "with its orders card, Enter base still offered");
      check(/data-mission="enter"/.test(renderRight(st, { ...freshUi(), selected: h.tile })), "and the Enter button on the base tile's team card");
      st.cards.length = 0;
      startOrder(st, p, { type: "mission", mission: "enter" });
      check(!st.parties.includes(p) && crew.every((s) => s.location.kind === "base" && s.location.baseId === h.id) && dangling(st, p.id).length === 0, "Enter base later: home and disbanded");
    }
  }
}

section("Enter base: another of your bases, after No on the Enter card; with a vehicle and a prisoner");
{
  const st = mk();
  const h = hub(st);
  const o = mkOutpost(st, tileNear(st, h.tile, 3, 5));
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 2);
  const car = st.vehicles.find((v) => v.loc.kind === "base" && v.loc.baseId === h.id && v.type !== "bike");
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: o.tile, mission: "move", stance: "normal", vehicleId: car ? car.id : null, supplies: { food: 6, water: 6, fuel: car ? 10 : 0 } });
  const p = res.party;
  check(p && !res.error, `a team sets off for ${o.name}${car ? ` in the ${car.name}` : ""} (${res.error || "ok"})`);
  if (p) {
    const f = st.factions[0];
    const pr = takePrisonersAt(st, f, h, 1)[0];
    pr.at = { kind: "party", partyId: p.id };
    for (let i = 0; i < 200 && !st.cards.some((c) => c.partyId === p.id && c.enterBase != null); i++) { st.hordes.length = 0; tickHour(st); if (st.combat) st.combat = null; for (let j = st.cards.length - 1; j >= 0; j--) if (st.cards[j].partyId !== p.id) st.cards.splice(j, 1); }
    const card = st.cards.find((c) => c.partyId === p.id && c.enterBase === o.id);
    check(!!card, "on arrival: the Enter card");
    st.cards.length = 0;
    card.choices.find((c) => /^No/.test(c.label)).resolve(st);
    check(st.parties.includes(p) && p.phase === "waiting" && partyTile(p) === o.tile, "No: it stays a team on the outpost's tile");
    const opt = enterOpt(st, p);
    check(opt && !opt.disabled && opt.label === `Enter ${o.name}` && new RegExp(`instead of ${h.name}`).test(opt.desc), `the orders still offer "${opt && opt.label}" (instead of its home)`);
    // Save / load with the team waiting on the base tile: the option and the merge work in the loaded world.
    const ld = roundTrip(st);
    const lp = ld.parties.find((q) => q.id === p.id);
    check(lp && enterOpt(ld, lp), "save / load: the team on the base tile still has Enter base");
    st.cards.length = 0;
    const text = giveOrder(st, p, "enter");
    check(!st.parties.includes(p), `Enter: the team is disbanded (${text})`);
    check(crew.every((s) => s.location.kind === "base" && s.location.baseId === o.id), "its people live at the outpost now");
    check(!car || (car.loc.kind === "base" && car.loc.baseId === o.id), "the vehicle parks in the outpost's motor pool");
    check(pr.at.kind === "base" && pr.at.baseId === o.id, "the prisoner it brought is held at the outpost");
    check(st.log.some((l) => /moved into/.test(l.text)), "the log: moved into the outpost");
    check(dangling(st, p.id).length === 0, `nothing points at the gone team (${dangling(st, p.id).join(", ") || "clean"})`);
    if (lp) {
      ld.cards.length = 0;
      giveOrder(ld, lp, "enter");
      const o2 = ld.bases.find((b) => b.id === o.id);
      check(!ld.parties.includes(lp) && crew.every((s) => { const x = ld.survivors.find((y) => y.id === s.id); return x.location.kind === "base" && x.location.baseId === o2.id; }) && dangling(ld, lp.id).length === 0, "and in the loaded world it merges the same way");
      const again = roundTrip(ld);
      check(!again.parties.some((q) => q.id === lp.id) && residents(again, o.id).length === residents(ld, o.id).length, "save / load after the merge: the people at the outpost, no team");
    }
  }
}

section("Enter base: a team that ended another order on a base, a queued Enter, and where it is not offered");
{
  const st = mk();
  const h = hub(st);
  const o = mkOutpost(st, tileNear(st, h.tile, 3, 5));
  const one = atBase(st, h.id).filter((s) => !s.leader).slice(0, 1);
  // Recon of the outpost's tile (a one-way trip that ends there): the orders card there offers Enter.
  const r = launchExpedition(st, { memberIds: one.map((s) => s.id), dest: o.tile, mission: "recon", stance: "normal", supplies: { food: 4, water: 4 } });
  const p = r.party;
  run(st, 200, () => p.phase === "waiting");
  check(partyTile(p) === o.tile && enterOpt(st, p), "a team that ended a recon on the outpost gets Enter");
  // Off the base: no Enter.
  const away = tileNear(st, o.tile, 2, 3);
  orderMove(st, p, away);
  run(st, 100, () => p.phase === "waiting" && partyTile(p) === away);
  check(partyTile(p) === away && !enterOpt(st, p) && !enterOption(st, p), "away from any base: no Enter base");
  // Queued: move to the hub, then Enter (the queue's last step runs on arrival).
  orderMove(st, p, h.tile);
  queueOrder(st, p, { type: "mission", mission: "enter" });
  run(st, 200, () => !st.parties.includes(p));
  check(!st.parties.includes(p) && one.every((s) => s.location.kind === "base" && s.location.baseId === h.id), "a queued Enter after a move: it moves into the hub on arrival");
  check(dangling(st, p.id).length === 0, "nothing points at the gone team");
  check(MISSIONS.enter && MISSIONS.enter.hidden, "Enter base is a hidden mission (not one you send a team out on from the planner)");
}

// ---------- 3. the autopilot with the disband ----------
section("Autopilot: a hardcore start founds its shelter and the team is disbanded into it");
{
  let founded = 0, clean = 0;
  const N = 3;
  for (let g = 0; g < N; g++) {
    const st = createWorld({ seed: 9000 + g * 13, factionCount: 7, mode: "hardcore" });
    setAutopilot(st, true);
    const teamIds = new Set(st.parties.filter((q) => q.owner === "player").map((q) => q.id));
    try {
      for (let i = 0; i < 24 * 20 && !hub(st); i++) { tickHour(st); for (const q of st.parties) if (q.owner === "player") teamIds.add(q.id); }
    } catch (e) { check(false, `game ${g}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); continue; }
    if (!hub(st)) continue;
    founded++;
    const h = hub(st);
    const gone = [...teamIds].filter((id) => !st.parties.some((q) => q.id === id));
    if (gone.every((id) => dangling(st, id).length === 0) && residents(st, h.id).length > 0) clean++;
    try { for (let i = 0; i < 48; i++) tickHour(st); } catch (e) { check(false, `game ${g} after founding: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); }
  }
  check(founded >= 2, `the governor founds a shelter (${founded} of ${N} within 20 days)`);
  check(clean === founded, `every founding left people at the base and nothing pointing at a gone team (${clean} of ${founded})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
if (fails) { console.log("failed"); process.exit(1); }
console.log("passed");
