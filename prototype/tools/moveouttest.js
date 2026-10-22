// Headless checks for moving people between your bases (sim/moveout.js): the Overcrowded card (when it comes, the
// cooldown, "worse"), a team moved out of a crowded base (who, from which stores, waiting outside or sent on), founding
// an outpost with it, and the "Enter <base>?" card when a team ends a move on another of your bases (yes: they live
// there, the cargo is unloaded; no: the team stays on the map), and the autopilot's answers.
// Usage: node tools/moveouttest.js [seed]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, residents, makeSurvivor, newId } from "../src/sim/world.js";
import { planPath, partyTile, partyMembers, orderMove, giveOrder, orderOptions, outpostName, launchExpedition, teamName, MISSIONS } from "../src/sim/parties.js";
import { baseBeds, addBuilding } from "../src/sim/buildings.js";
import { CROWD_CARD, MOVE_OUT, crowdCardsHour, moveTeamOut, enterTarget, overBeds, freeBeds } from "../src/sim/moveout.js";
import { crewAI } from "../src/sim/autopilot.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 7 });
  state.started = true;
  state.autoCombat = true;
  state.noWanderers = true; // people met on the road (wanderers.js) bring cards of their own
  Object.assign(hub(state).stock, { water: 300, fuel: 100, meds: 20, ammo: 300, parts: 10, scrap: 100 }); setFood(hub(state), 300);
  // The hub starts bare (barestart: 6 people in 4 beds, the card held back for its first days); these checks start
  // from a hub where everyone has a bed, as the old start's bunkhouse gave.
  addBuilding(hub(state), "bunkhouse");
  delete hub(state).crowdNote;
  return state;
}
const addPerson = (st, base) => { const s = makeSurvivor(st, 1); s.traits = []; s.location = { kind: "base", baseId: base.id }; s.role = "farm"; st.survivors.push(s); return s; };
const crowd = (st, base, over = 1) => { while (overBeds(st, base) < over) addPerson(st, base); };
const mkOutpost = (st, tile) => {
  const b = { id: newId(), tile, type: "outpost", name: outpostName(st, tile), stock: { water: 40, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0, jars: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  setFood(b, 40); // days of ration bars (tools/foodkit.js)
  st.bases.push(b);
  return b;
};
// A land tile d..d2 tiles from `from`, reachable on foot, not a base and not held by anyone.
function tileNear(st, from, d, d2) {
  for (const t of st.tiles) {
    const dist = st.grid.distance(from, t.id);
    if (dist < d || dist > d2 || t.terrain === "water" || t.owner != null && t.owner !== "player" || st.bases.some((b) => b.tile === t.id) || st.factions.some((f) => f.bases.includes(t.id))) continue;
    if (planPath(st, from, t.id, false)) return t.id;
  }
  return null;
}
const crowdCards = (st, base) => st.cards.filter((c) => c.crowdFor === base.id);
// Ticks with the dead kept away and other cards dropped (their dice would blur the case); `keep` cards stay.
function tick(st, n, keep = () => false, until = null) {
  for (let i = 0; i < n; i++) {
    st.hordes.length = 0;
    tickHour(st);
    if (st.combat) st.combat = null;
    for (let j = st.cards.length - 1; j >= 0; j--) if (!keep(st.cards[j])) st.cards.splice(j, 1);
    if (until && until()) return true;
  }
  return !until;
}

// ---------- 1. the Overcrowded card ----------
section("Overcrowded card: once, then after the cooldown or when it gets worse");
{
  const st = mk();
  const h = hub(st);
  st.cards.length = 0;
  crowdCardsHour(st);
  check(!crowdCards(st, h).length, `no card while everyone has a bed (${residents(st, h.id).length} in ${baseBeds(h)})`);
  crowd(st, h, 1);
  tick(st, 1, (c) => c.crowdFor != null);
  const c1 = crowdCards(st, h);
  check(c1.length === 1, "one person over the beds: the Overcrowded card comes within the hour");
  const card = c1[0];
  check(card && /overcrowded/i.test(card.title), `its title says so ("${card && card.title}")`);
  const move = card && card.choices.find((c) => /^Move a team out/.test(c.label));
  check(move && move.uiAction && move.uiAction.type === "moveout" && move.uiAction.baseId === h.id, "\"Move a team out…\" opens the move-out planner for that base");
  check(card && card.choices.some((c) => /^Leave it/.test(c.label) && !c.uiAction), "and there is a choice to leave it");
  // Answered "leave it": not asked again until the cooldown, unless it gets worse.
  st.cards.length = 0;
  tick(st, 30, (c) => c.crowdFor != null);
  check(!crowdCards(st, h).length, "not asked again the next day at the same crowding");
  crowd(st, h, 1 + CROWD_CARD.worse);
  tick(st, 1, (c) => c.crowdFor != null);
  check(crowdCards(st, h).length === 1, `${CROWD_CARD.worse} more over the beds: asked again at once`);
  st.cards.length = 0;
  tick(st, CROWD_CARD.days * 24 - 2, (c) => c.crowdFor != null);
  check(!crowdCards(st, h).length, `quiet for ${CROWD_CARD.days} days at that crowding`);
  tick(st, 3, (c) => c.crowdFor != null);
  check(crowdCards(st, h).length === 1, `asked again after ${CROWD_CARD.days} days`);
  tick(st, 5, (c) => c.crowdFor != null);
  check(crowdCards(st, h).length === 1, "never two open cards for one base");
  // The autopilot: no card while it plays; a card left open is answered "Leave it" (the planner choice needs a person).
  st.cards.length = 0;
  h.crowdNote = null;
  st.autopilot = true;
  crowdCardsHour(st);
  check(!crowdCards(st, h).length, "no Overcrowded card while the autopilot plays");
  st.autopilot = false;
}

// ---------- 2. moving a team out ----------
section("Move a team out: from that base's people and stores, waiting outside, then an outpost");
{
  const st = mk();
  const h = hub(st);
  crowd(st, h, 2);
  st.cards.length = 0;
  const before = residents(st, h.id).length;
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 3);
  const food0 = food(h), scrap0 = h.stock.scrap;
  const res = moveTeamOut(st, { baseId: h.id, memberIds: crew.map((s) => s.id), supplies: { food: 9, water: 9, scrap: MOVE_OUT.scrap, ammo: 30 } });
  const p = res.party;
  check(p && !res.error, `the team leaves (${res.error || "ok"})`);
  if (p) {
    check(residents(st, h.id).length === before - 3, "three fewer people live at the hub");
    check(overBeds(st, h) === -1, `and it has a bed to spare now (${residents(st, h.id).length} in ${baseBeds(h)})`);
    check(Math.abs(food(h) - (food0 - food(p))) < 1e-6 && food(p) >= 9 && h.stock.scrap === scrap0 - MOVE_OUT.scrap, `what they take comes out of the hub's stores (${food(p).toFixed(1)} days of food, whole items)`);
    check(p.phase === "waiting" && partyTile(p) === h.tile, "with nowhere picked yet the team waits outside the hub");
    check(p.homeBaseId === h.id && p.teamMission === "moveout" && /^Moving out team/.test(teamName(st, p)), `still from the hub, named "${teamName(st, p)}"`);
    check(!st.cards.some((c) => c.partyId === p.id), "no card in the way of the map pick");
    // Sent to a free tile: Build outpost there founds a base with them.
    const site = tileNear(st, h.tile, 3, 5);
    check(site != null && /sets off/.test(orderMove(st, p, site)), "ordered to a tile 3-5 tiles out");
    tick(st, 200, (c) => c.partyId === p.id && c.isOrders, () => p.phase === "waiting");
    check(partyTile(p) === site, "the team got there and waits for orders");
    check(!st.cards.some((c) => c.partyId === p.id && /Enter/.test(c.title || "")) && p.phase === "waiting", "a free tile: it waits for orders (no Enter card; orders reach it anywhere, so no arrival card is needed)");
    const opt = orderOptions(st, p).find((o) => o.mission === "outpost");
    check(opt && !opt.disabled, `Build outpost is on offer with the scrap they carry (${opt && opt.disabled})`);
    const n0 = st.bases.length;
    giveOrder(st, p, "outpost");
    for (let i = 0; i < 48 && st.bases.length === n0; i++) { tickHour(st); st.cards.length = 0; } // pitching the camp: its fire and the clearing of its 5 × 5 (staging.js siteSetup)
    const ob = st.bases.find((b) => b.tile === site);
    check(st.bases.length === n0 + 1 && ob, "the outpost is founded");
    check(ob && crew.every((s) => s.location.kind === "base" && s.location.baseId === ob.id), "the three live there now");
  }
  // A crowded outpost sends a team too (launchExpedition's fromBaseId), from its own people only.
  const ot = tileNear(st, h.tile, 3, 6);
  const o = ot != null ? mkOutpost(st, ot) : null;
  if (check(o, "an outpost for the next case")) {
    for (let i = 0; i < 4; i++) addPerson(st, o);
    const wrong = moveTeamOut(st, { baseId: o.id, memberIds: [atBase(st, h.id)[0].id], supplies: {} });
    check(wrong.error && /is not at/.test(wrong.error), `someone from another base cannot be picked (${wrong.error})`);
    const ok = moveTeamOut(st, { baseId: o.id, memberIds: atBase(st, o.id).slice(0, 2).map((s) => s.id), supplies: { food: 4, water: 4 } });
    check(ok.party && ok.party.homeBaseId === o.id, "two leave the outpost; it stays their home");
    check(ok.party && Math.abs(food(o) + food(ok.party) - 40) < 1e-6 && food(ok.party) >= 4, "their food came from the outpost's stores");
    const tooMuch = moveTeamOut(st, { baseId: o.id, memberIds: atBase(st, o.id).slice(0, 1).map((s) => s.id), supplies: { meds: 5 } });
    check(tooMuch.error && new RegExp(o.name).test(tooMuch.error), `the outpost's stock is the limit (${tooMuch.error})`);
  }
}

// ---------- 3. Enter <base>? ----------
section("Enter card: a team that ends a move on another of your bases");
{
  const st = mk();
  const h = hub(st);
  const ot = tileNear(st, h.tile, 3, 5);
  const o = mkOutpost(st, ot);
  crowd(st, h, 1);
  st.cards.length = 0;
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 2);
  const res = moveTeamOut(st, { baseId: h.id, memberIds: crew.map((s) => s.id), supplies: { food: 8, water: 8, ammo: 20 }, dest: o.tile });
  const p = res.party;
  check(p && p.phase === "out" && p.joinBaseId === o.id, `sent straight to ${o.name} (${res.error || "on its way"})`);
  if (p) {
    p.cargo.supplies.scrap = 7; // found on the way
    addPerson(st, o); // one there already: with the two it is one over its 2 beds
    const food0 = food(o);
    tick(st, 200, (c) => c.partyId === p.id && (c.enterBase != null || c.isOrders), () => st.cards.some((c) => c.partyId === p.id && (c.enterBase != null || c.isOrders)));
    const card = st.cards.find((c) => c.partyId === p.id);
    check(card && card.enterBase === o.id && card.title === `Enter ${o.name}?`, `on arrival: "${card && card.title}"`);
    check(card && !st.cards.some((c) => c.isOrders && c.partyId === p.id), "instead of the orders card");
    // The autopilot says yes to a team sent there to move in.
    const yes = card.choices.find((c) => /^Yes/.test(c.label));
    const no = card.choices.find((c) => /^No/.test(c.label));
    check(yes.ai(st) > no.ai(st), "the autopilot's score: yes for a team sent there to move in");
    st.cards.length = 0;
    const atDoor = food(o), carried = food(p) + food(p.cargo); // the outpost eats its meals while the team walks (packs topped up too)
    yes.resolve(st);
    check(!st.parties.includes(p), "yes: the team ends");
    check(crew.every((s) => s.location.kind === "base" && s.location.baseId === o.id), "its people live at the outpost now");
    check(carried > 7 && food(o) >= atDoor + carried - 1e-6 && o.stock.scrap >= 7, `what they carried went into the outpost's stores (${Math.round(carried * 10) / 10} days of food; ${Math.round(food0 * 10) / 10} before they set off)`);
    check(st.log.some((l) => /moved into/.test(l.text)), "the log says they moved in");
    check(overBeds(st, o) === 1, `the outpost is one over its beds now (${residents(st, o.id).length} in ${baseBeds(o)})`);
    crowdCardsHour(st);
    check(!crowdCards(st, o).length, "no Overcrowded card for it straight after: the Enter card said how full it was");
  }
  // No: the team stays on the map and waits for orders. A team from the outpost is asked at the hub too.
  const two = atBase(st, o.id).slice(0, 2);
  const back = launchExpedition(st, { memberIds: two.map((s) => s.id), dest: h.tile, mission: "move", stance: "normal", supplies: { food: 4, water: 4 }, fromBaseId: o.id });
  const q = back.party;
  check(q && !back.error, `a team from ${o.name} sets off for the hub (${back.error || "ok"})`);
  if (q) {
    tick(st, 200, (c) => c.partyId === q.id && (c.enterBase != null || c.isOrders), () => st.cards.some((c) => c.partyId === q.id && (c.enterBase != null || c.isOrders)));
    const card = st.cards.find((c) => c.partyId === q.id);
    check(card && card.enterBase === h.id, "at the hub (not its home): the Enter card");
    st.cards.length = 0;
    card.choices.find((c) => /^No/.test(c.label)).resolve(st);
    check(st.parties.includes(q) && q.phase === "waiting" && partyTile(q) === h.tile, "no: still a team, waiting at the hub's tile");
    check(st.cards.some((c) => c.isOrders && c.partyId === q.id), "with its orders card");
    check(two.every((s) => s.location.kind === "party"), "its people are still on the team");
  }
  // At its own home, or with orders queued after the move: no Enter card.
  const r = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, 1).map((s) => s.id), dest: o.tile, mission: "recon", stance: "normal", supplies: { food: 3, water: 3 } });
  check(r.party && enterTarget(st, r.party) === null, "a team at its own base is not asked");
}

// ---------- 4. the autopilot ----------
section("Autopilot: answers to the new cards");
{
  const st = mk();
  const h = hub(st);
  const o = mkOutpost(st, tileNear(st, h.tile, 3, 5));
  crowd(st, h, 1);
  st.cards.length = 0;
  crowdCardsHour(st);
  const card = crowdCards(st, h)[0];
  const pick = card && crewAI.answer(st, card, "balanced");
  check(pick && /^Leave it/.test(pick.label), `the Overcrowded card: "${pick && pick.label}" (its own logic deals with crowding)`);
  // A team the player sent somewhere else that lands on a full outpost: the autopilot keeps it a team.
  for (let i = 0; i < 4; i++) addPerson(st, o);
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 2);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: o.tile, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } });
  const p = res.party;
  if (check(p, "a hub team sent to the outpost")) {
    st.cards.length = 0;
    tick(st, 200, (c) => c.partyId === p.id && (c.enterBase != null || c.isOrders), () => st.cards.some((c) => c.partyId === p.id && (c.enterBase != null || c.isOrders)));
    const ec = st.cards.find((c) => c.enterBase === o.id);
    const a = ec && crewAI.answer(st, ec, "balanced");
    check(a && /^No/.test(a.label), `the outpost is full (${freeBeds(st, o)} free): "${a && a.label}"`);
    o.buildings.push({ type: "bunkhouse", id: newId() });
    const b = ec && crewAI.answer(st, ec, "balanced");
    check(b && /^Yes/.test(b.label), `with a bunkhouse there (${freeBeds(st, o)} free): "${b && b.label}"`);
  }
  check(MISSIONS.moveout && MISSIONS.moveout.hidden, "the Moving out team name is a hidden mission (not in the planner's list)");
}

console.log(`\n${passed} passed, ${fails} failed`);
if (fails) process.exit(1);
