// Open the build map (the user's request 2026-10-20: "When a camp/base is established add an option to open up the
// build map to set up things like tents etc."): the card that says a camp stands (Set up camp, Establish base, Build
// outpost: sim/staging.js makeCamp), or that a base went up a tier (camp → shelter: "A new home" or hardcore's "A place
// of your own"; shelter → base and outpost camp → outpost: buildings.js upgradeShelter → staging.js baseUpgraded),
// carries an "Open the build map" button (uiAction "basemap"), and the button opens that base's base map
// (ui/basemap.js openBuildMap, routed by main.js's card choice).
// Checks: each of those cards has the button with the right base; OK is the card's default answer and the button is
// never an auto-answer (cardrules.js usableChoices / defaultChoice), so a card in the tray never gets stuck on it; the
// card renders the button as a card choice; the click (main.js's choice: the card shifted, resolved, then openBuildMap)
// opens the layout view of the right base with nothing picked and comes back to its Base map tab; a gone base: the card
// is stale in the tray (dropped, not answered), and the button answered anyway opens nothing and says why; a battle
// on: nothing replaced; under the governor no new card is made.
// Usage: node tools/buildmapbtntest.js [seed]
import { readFileSync } from "node:fs";
import { createWorld, tickHour, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, giveOrder, planPath, PITCH_HOURS } from "../src/sim/parties.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { establishArrive, campBecameShelter, removeCamp, BUILD_MAP_LABEL } from "../src/sim/staging.js";
import { upgradeShelter, isCamp, isShelter } from "../src/sim/buildings.js";
import { usableChoices, defaultChoice, cardKind, trayStale, autoAnswer } from "../src/sim/cardrules.js";
import { openBuildMap } from "../src/ui/basemap.js";
import { renderModal } from "../src/ui/ui.js";
import { cardUp, trayCards } from "../src/ui/pacing.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
const world = (opts = {}) => { const st = createWorld({ seed, factionCount: 6, ...opts }); st.started = true; st.noNewGangs = true; st.erasOff = true; st.noWanderers = true; return st; };
const free = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain" && st.tiles[t].owner == null && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t) && !st.hordes.some((h) => h.tile === t);
const nearFree = (st, from, lo, hi) => st.grid.within(from, hi).find((t) => st.grid.distance(t, from) >= lo && free(st, t) && planPath(st, from, t, false));
const btnOf = (card) => (card && card.choices || []).find((c) => c.uiAction && c.uiAction.type === "basemap");
const cardFor = (st, base, title) => st.cards.find((c) => c.title === title && btnOf(c) && btnOf(c).uiAction.baseId === base.id);
// main.js's choice for a card at the front of the queue: shifted, resolved, then the uiAction (openBuildMap).
function click(st, ui, card, i) {
  st.cards.splice(st.cards.indexOf(card), 1);
  st.cards.unshift(card);
  const c = st.cards[0].choices[i];
  st.cards.shift();
  c.resolve(st);
  if (c.uiAction && c.uiAction.type === "basemap") { const why = openBuildMap(st, ui, c.uiAction.baseId); if (why) ui.cardResult = { title: card.title, text: why }; }
}
// The card's own checks: the button, the default, the tray.
function cardChecks(st, card, base, what) {
  const b = btnOf(card);
  if (!check(!!card && !!b, `${what}: the card carries the button`)) return;
  check(b.label === BUILD_MAP_LABEL && BUILD_MAP_LABEL === "Open the build map", `${what}: labelled "${BUILD_MAP_LABEL}"`);
  check(b.uiAction.baseId === base.id && card.mapBase === base.id, `${what}: for ${base.name}`);
  check(!usableChoices(st, card).includes(b), `${what}: never an auto-answer or a governor's pick`);
  const d = defaultChoice(st, card);
  check(!!d && d.label === "OK", `${what}: OK is the default answer (${d && d.label})`);
  check(cardKind(st, card) !== "always", `${what}: it can wait in the tray (${cardKind(st, card)})`);
  check(trayStale(st, card) === "", `${what}: not stale while the base stands`);
}

section("Set up camp: the 'Camp set up' card");
let st = world();
const h = hub(st);
const tile = nearFree(st, h.tile, 3, 6);
Object.assign(h.stock, { food: 200, water: 200 });
const crew = atBase(st, h.id).slice(0, 2).map((s) => s.id);
const res = launchExpedition(st, { memberIds: crew, dest: tile, mission: "camp", stance: "normal", supplies: { food: 6, water: 6 } });
check(!res.error, `a team leaves to set up camp (${res.error || "ok"})`);
res.party.path = [tile]; res.party.idx = 0;
giveOrder(st, res.party, "camp");
for (let i = 0; i < PITCH_HOURS + 2 && !st.bases.some((b) => b.tile === tile); i++) tickHour(st);
const camp = st.bases.find((b) => b.tile === tile);
check(!!camp && isCamp(camp), "the camp stands");
let card = camp && cardFor(st, camp, "Camp set up");
if (camp) cardChecks(st, card, camp, "Camp set up");
check(!!card && /Open the build map to lay it out/.test(card.text), "the text points at the button");
// The card in the browser (ui/pacing.js): it waits in the tray without stopping the clock; opened from the tray it
// comes to the front and renderModal shows it with the button as one of its choices.
if (card) {
  const tui = { started: true, baseView: null };
  cardUp(st, tui); // stamps the cards' kinds
  check(trayCards(st).includes(card), "it waits in the card tray (the clock runs)");
  tui.trayOpen = card.tray.id;
  const html = renderModal(st, tui) || "";
  const i = card.choices.indexOf(btnOf(card));
  check(st.cards[0] === card && html.includes(`data-action="choice" data-i="${i}"`) && html.includes("Open the build map"), "opened from the tray, the card renders the button as a card choice");
}

section("The click opens that base's map");
let ui = { baseView: { id: camp.id, tab: "camp" }, baseMsg: "" };
click(st, ui, card, card.choices.indexOf(btnOf(card)));
check(!st.cards.includes(card), "the card is answered");
check(!!st.combat && !!st.combat.layout && st.combat.layout.baseId === camp.id, "the base map's layout view is open on the camp");
check(st.combat && st.combat.layout.pick == null && st.combat.layout.pickType == null, "nothing picked: the Build list is ready");
check(ui.baseView === null && ui.mapFrom && ui.mapFrom.id === camp.id && ui.mapFrom.tab === "basemap", "the base window closes; closing the map comes back to its Base map tab");
check(!ui.cardResult, "no message");
// A battle on: the button replaces nothing.
const battle = st.combat;
ui = { baseView: null, baseMsg: "" };
check(openBuildMap(st, ui, h.id) !== "" && st.combat === battle, "with a battle (or the map) open, nothing is replaced and it says why");
st.combat = null;
check(main().includes('uiAction.type === "basemap"') && /openBuildMap\(state, ui, c\.uiAction\.baseId\)/.test(main()), "main.js routes the card's button to openBuildMap");

section("Outpost camp → established outpost: 'An established outpost'");
st.cards.length = 0;
upgradeShelter(st, camp);
check(!isCamp(camp) && !isShelter(camp) && camp.type === "outpost", "the camp is an outpost");
card = cardFor(st, camp, "An established outpost");
cardChecks(st, card, camp, "An established outpost");
ui = { baseView: null, baseMsg: "" };
click(st, ui, card, card.choices.indexOf(btnOf(card)));
check(st.combat && st.combat.layout && st.combat.layout.baseId === camp.id, "the button opens the outpost's map");
st.combat = null;

section("A gone base");
st.cards.length = 0;
const camp2 = nearFree(st, h.tile, 3, 8);
// A second camp made the same way as the first, then struck before its card is answered.
const crew2 = atBase(st, h.id).slice(0, 1).map((s) => s.id);
const res2 = launchExpedition(st, { memberIds: crew2, dest: camp2, mission: "camp", stance: "normal", supplies: { food: 4, water: 4 } });
check(!res2.error, `a second team leaves (${res2.error || "ok"})`);
res2.party.path = [camp2]; res2.party.idx = 0;
giveOrder(st, res2.party, "camp");
for (let i = 0; i < PITCH_HOURS + 2 && !st.bases.some((b) => b.tile === camp2); i++) tickHour(st);
const gone = st.bases.find((b) => b.tile === camp2);
card = gone && cardFor(st, gone, "Camp set up");
check(!!card, "its card is waiting");
removeCamp(st, gone, "struck");
check(!st.bases.includes(gone), "the camp is gone");
check(trayStale(st, card) === "the base is gone", "in the tray the card is stale ('the base is gone')");
ui = { baseView: null, baseMsg: "" };
click(st, ui, card, card.choices.indexOf(btnOf(card)));
check(!st.combat, "answered anyway, the button opens nothing");
check(ui.cardResult && /gone/.test(ui.cardResult.text), `and says why ("${ui.cardResult && ui.cardResult.text}")`);
// Left in the tray: dropped, not answered with anything.
const before = st.cards.length;
st.cards.push({ ...card });
autoAnswer(st, st.cards[st.cards.length - 1]);
check(st.cards.length === before, "the tray drops it without an error");

section("Establish base (hardcore): 'Camp set up', then 'A place of your own', then 'A real base'");
st = world({ mode: "hardcore" });
const p = roadTeam(st);
p.pitched = true;
establishArrive(st, p);
const home = st.bases[0];
check(!!home && isCamp(home), "the camp stands");
card = home && cardFor(st, home, "Camp set up");
cardChecks(st, card, home, "Establish base's Camp set up");
st.cards.length = 0;
upgradeShelter(st, home);
check(isShelter(home) && !isCamp(home), "the camp is a shelter");
card = cardFor(st, home, "A place of your own");
cardChecks(st, card, home, "A place of your own");
st.cards.length = 0;
upgradeShelter(st, home);
check(!isShelter(home), "the shelter is a base");
card = cardFor(st, home, "A real base");
cardChecks(st, card, home, "A real base");
ui = { baseView: null, baseMsg: "" };
click(st, ui, card, card.choices.indexOf(btnOf(card)));
check(st.combat && st.combat.layout && st.combat.layout.baseId === home.id, "the button opens the base's map");
st.combat = null;

section("A new home (a camp that is your hub, not hardcore's first)");
st = world();
const hb = hub(st);
Object.assign(hb, { tier: 0, camp: true, campDay: 1 });
campBecameShelter(st, hb);
card = cardFor(st, hb, "A new home");
cardChecks(st, card, hb, "A new home");

section("Under the governor: no new card");
st = world();
st.autopilot = true;
const h4 = hub(st);
const t4 = nearFree(st, h4.tile, 3, 6);
Object.assign(h4.stock, { food: 200, water: 200 });
const res4 = launchExpedition(st, { memberIds: atBase(st, h4.id).slice(0, 1).map((s) => s.id), dest: t4, mission: "camp", stance: "normal", supplies: { food: 4, water: 4 } });
res4.party.path = [t4]; res4.party.idx = 0;
giveOrder(st, res4.party, "camp");
for (let i = 0; i < PITCH_HOURS + 2 && !st.bases.some((b) => b.tile === t4); i++) tickHour(st);
const c4 = st.bases.find((b) => b.tile === t4);
check(!!c4 && !st.cards.some((c) => c.title === "Camp set up"), "the camp stands and no 'Camp set up' card waits");

function main() { return readFileSync(new URL("../src/main.js", import.meta.url), "utf8"); }
console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
