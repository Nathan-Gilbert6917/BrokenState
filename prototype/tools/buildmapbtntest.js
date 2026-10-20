// Open the build map (the user's requests 2026-10-20: "When a camp/base is established add an option to open up the
// build map to set up things like tents etc."; round 2: never block a save, occupied / conquered / handed-over bases
// too, the base's name as it is now, a key). sim/staging.js askLayout / layoutAsks / layoutDone / buildMapChoice,
// ui/buildmap.js (the alert, the Camp tab's button, the key), ui/basemap.js openBuildMap, main.js (the card choice,
// actions.buildmap, the key, tidyUi), ui/alerts.js (SECTIONS.layout), ui/keymap.js base.buildmap.
// Checks:
//   - Set up camp: no card (nothing waits, the game saves), the base asks to be laid out: an alert "<name>: camp set
//     up. Open the build map" whose text follows a rename, whose click opens that base's build map (nothing picked,
//     back to its Base map tab) and ends the ask; the Camp tab has the button (bm-open, back to the Camp tab); the ask
//     goes by itself after LAYOUT_ASK.HOURS; under the governor nothing is asked;
//   - Build outpost → the outpost camp built up, Establish base → shelter → base (hardcore): each asks, no new card;
//     the founding cards that already were ("A new home", "A place of your own") keep the button as an extra choice
//     (OK the default, never an auto-answer), a rename while one waits rewrites its text (basenames.js renameBase);
//   - a base occupied (occupy.js takeAbandoned), taken (conquest.js captureBase), given back empty (conquestDaily)
//     or handed over (jobs.js handOver) asks too;
//   - a card's button for a gone base: stale in the tray, answered anyway it opens nothing and says why; a battle on:
//     nothing replaced;
//   - the key: U (B is the Bases tab), in the key table without a clash on the map, in the help's key line; it opens
//     the selected base's map (its window open, or its tile selected), says why with nothing selected, and does
//     nothing behind another window.
// Usage: node tools/buildmapbtntest.js [seed]
import { readFileSync } from "node:fs";
import { createWorld, tickHour, hub, atBase, day } from "../src/sim/world.js";
import { launchExpedition, giveOrder, planPath, PITCH_HOURS } from "../src/sim/parties.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { establishArrive, campBecameShelter, removeCamp, campsHour, layoutAsks, LAYOUT_ASK, BUILD_MAP_LABEL } from "../src/sim/staging.js";
import { upgradeShelter, isCamp, isShelter } from "../src/sim/buildings.js";
import { usableChoices, defaultChoice, cardKind, trayStale, autoAnswer } from "../src/sim/cardrules.js";
import { serializeState, saveBlocker } from "../src/sim/save.js";
import { takeAbandoned } from "../src/sim/occupy.js";
import { captureBase, occupyPlayerBase, conquestDaily } from "../src/sim/conquest.js";
import { handOver } from "../src/sim/jobs.js";
import { renameBase } from "../src/sim/basenames.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { openBuildMap, BASEMAP_ACTIONS } from "../src/ui/basemap.js";
import { BUILDMAP_ACTIONS, buildMapKey, selectedBase } from "../src/ui/buildmap.js";
import { computeAlerts, ALERT_ACTIONS } from "../src/ui/alerts.js";
import { KEYMAP, keyLabel } from "../src/ui/keymap.js";
import { renderModal, helpText } from "../src/ui/ui.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
const world = (opts = {}) => { const st = createWorld({ seed, factionCount: 6, ...opts }); st.started = true; st.noNewGangs = true; st.erasOff = true; st.noWanderers = true; return st; };
const free = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain" && st.tiles[t].owner == null && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t) && !st.hordes.some((h) => h.tile === t) && !(st.abandoned || []).some((a) => a.tile === t);
const nearFree = (st, from, lo, hi) => st.grid.within(from, hi).find((t) => st.grid.distance(t, from) >= lo && free(st, t) && planPath(st, from, t, false));
const btnOf = (card) => (card && card.choices || []).find((c) => c.uiAction && c.uiAction.type === "basemap");
const alertOf = (st, b) => computeAlerts(st, { all: true }).find((a) => a.kind === "layout" && a.go && a.go.baseId === b.id);
const asks = (st, b, why) => !!b && !!b.layoutAsk && b.layoutAsk.why === why && layoutAsks(st).includes(b);
const newUi = (extra = {}) => ({ started: true, baseView: null, baseMsg: "", ...extra });
// main.js's actions as ui/alerts.js's goTo sees them.
const actsFor = (st, ui) => ({ buildmap: (d) => BUILDMAP_ACTIONS.buildmap(st, ui, d), openbase: () => {}, center: () => {}, "xp-open": () => {} });
const key = (code, mods = {}) => ({ code, key: code.replace(/^Key/, "").toLowerCase(), ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
// A team from the hub sets up camp on a free tile near it; returns the camp.
function setUpCamp(st, n = 2, lo = 3) {
  const h = hub(st);
  const tile = nearFree(st, h.tile, lo, lo + 4);
  Object.assign(h.stock, { food: 200, water: 200 });
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, n).map((s) => s.id), dest: tile, mission: "camp", stance: "normal", supplies: { food: 4, water: 4 } });
  if (res.error) { check(false, `a team leaves to set up camp (${res.error})`); return null; }
  res.party.path = [tile]; res.party.idx = 0;
  giveOrder(st, res.party, "camp");
  for (let i = 0; i < PITCH_HOURS + 2 && !st.bases.some((b) => b.tile === tile); i++) tickHour(st);
  return st.bases.find((b) => b.tile === tile) || null;
}
// A card's own checks: the button, the default, the tray.
function cardChecks(st, card, base, what) {
  const b = btnOf(card);
  if (!check(!!card && !!b, `${what}: the card carries the button`)) return;
  check(b.label === BUILD_MAP_LABEL && BUILD_MAP_LABEL === "Open the build map" && b.uiAction.baseId === base.id && card.mapBase === base.id, `${what}: "${BUILD_MAP_LABEL}" for ${base.name}`);
  check(!usableChoices(st, card).includes(b) && defaultChoice(st, card) && defaultChoice(st, card).label === "OK", `${what}: OK is the default, the button never an auto-answer`);
  check(cardKind(st, card) !== "always" && trayStale(st, card) === "", `${what}: it can wait in the tray, not stale while the base stands`);
}

section("Set up camp: no card, an alert; nothing blocks a save");
let st = world();
const camp = setUpCamp(st);
check(!!camp && isCamp(camp), "the camp stands");
check(!st.cards.some((c) => btnOf(c)) && !st.cards.some((c) => c.title === "Camp set up"), "no card for it");
check(saveBlocker(st) === "" || !st.cards.length, "nothing waits: the game can be saved");
let saved = true; try { serializeState(st); } catch (e) { saved = false; }
check(saved, "serializeState works right after the camp is set up");
check(asks(st, camp, "camp"), "the camp asks to be laid out (camp set up)");
let al = alertOf(st, camp);
check(!!al && al.text === `${camp.name}: camp set up. Open the build map` && al.event && al.go.act === "buildmap", `the alert: "${al && al.text}"`);
const oldName = camp.name;
check(renameBase(st, camp, "Riverbend") === "", "renamed (the naming window's rename)");
al = alertOf(st, camp);
check(!!al && al.text.startsWith("Riverbend: ") && !al.text.includes(oldName) && al.tip.includes("Riverbend"), "renamed: the alert names it as it is now");

section("The Camp tab's button");
let ui = newUi({ baseView: { id: camp.id, tab: "camp" } });
st.cards.length = 0;
const html = renderModal(st, ui) || "";
check(html.includes(`data-action="bm-open" data-base="${camp.id}" data-tab="camp"`) && html.includes("Open the build map"), "the Camp tab has Open the build map (bm-open, back to the Camp tab)");
check(typeof BASEMAP_ACTIONS["bm-open"] === "function", "bm-open has its handler");
BASEMAP_ACTIONS["bm-open"](st, ui, { base: String(camp.id), tab: "camp" });
check(st.combat && st.combat.layout && st.combat.layout.baseId === camp.id && ui.mapFrom.tab === "camp", "it opens the camp's map, back to the Camp tab when it closes");
check(main().includes("if (state.combat && state.combat.layout) layoutDone(state, state.combat.layout.baseId)"), "main.js ends the ask whenever a base's map is open (tidyUi)");
st.combat = null;

section("The alert's click");
ui = newUi();
ALERT_ACTIONS["al-go"](st, ui, { key: al.key }, actsFor(st, ui));
check(st.combat && st.combat.layout && st.combat.layout.baseId === camp.id, "the click opens that base's build map");
check(st.combat && st.combat.layout.pick == null && ui.mapFrom && ui.mapFrom.id === camp.id && ui.mapFrom.tab === "basemap", "nothing picked; closing comes back to its Base map tab");
check(!camp.layoutAsk && !alertOf(st, camp), "the ask and its alert are gone");
const battle = st.combat;
check(openBuildMap(st, newUi(), hub(st).id) !== "" && st.combat === battle, "with a battle (or the map) open, nothing is replaced and it says why");
st.combat = null;

section("The ask goes by itself");
camp.layoutAsk = { why: "camp", hour: st.hour };
st.hour += LAYOUT_ASK.HOURS;
check(!layoutAsks(st).includes(camp) && !alertOf(st, camp), `after ${LAYOUT_ASK.HOURS} hours no alert`);
campsHour(st);
check(!camp.layoutAsk, "and the hour's tidy drops it");

section("Outpost camp → established outpost: an alert, no card");
st.cards.length = 0;
upgradeShelter(st, camp);
check(!isCamp(camp) && !isShelter(camp) && camp.type === "outpost", "the camp is an outpost");
check(asks(st, camp, "outpost") && /an established outpost now\. Open the build map$/.test(alertOf(st, camp).text), `it asks ("${alertOf(st, camp) && alertOf(st, camp).text}")`);
check(!st.cards.length, "no card");

section("Gained bases ask too");
{
  const st2 = world();
  const h = hub(st2);
  const f = st2.factions.find((x) => x.alive);
  const t1 = nearFree(st2, h.tile, 4, 8);
  st2.abandoned = [{ tile: t1, from: f.id, fromName: f.name, works: { walls: 2, beds: 4 }, stock: { food: 10 }, day: day(st2) - 30 }];
  takeAbandoned(st2, t1, null);
  const occ = st2.bases.find((b) => b.tile === t1);
  check(asks(st2, occ, "occupied"), "a base moved into (occupy.js takeAbandoned): yours: you moved in");
  const g = st2.factions.find((x) => x.alive && x !== f) || f;
  const t2 = nearFree(st2, h.tile, 4, 10);
  g.bases.push(t2); recomputeOwnership(st2);
  captureBase(st2, g, t2, null, {});
  const cap = st2.bases.find((b) => b.tile === t2);
  check(asks(st2, cap, "conquered"), "a base taken (conquest.js captureBase): yours: taken");
  const t3 = nearFree(st2, h.tile, 4, 12);
  const k = st2.factions.find((x) => x.alive && !x.bases.includes(t3));
  const handed = handOver(st2, k, t3);
  check(asks(st2, handed, "handed"), "a group's outpost handed over (jobs.js handOver)");
  // Taken from you, its holders gone: back to you empty (conquestDaily).
  const holder = st2.factions.find((x) => x.alive);
  occupyPlayerBase(st2, cap, holder, { garrison: 4 });
  check(!st2.bases.includes(cap), "the taken base is lost again");
  holder.alive = false;
  holder.bases = holder.bases.filter((x) => x !== cap.tile);
  conquestDaily(st2);
  const back = st2.bases.find((b) => b.tile === cap.tile);
  check(asks(st2, back, "returned"), "back to you empty (conquestDaily): yours again");
  check(!st2.cards.some((c) => btnOf(c)), "none of them adds a card with the button");
}

section("Establish base (hardcore): asks; 'A place of your own' keeps its button; the base: an alert");
st = world({ mode: "hardcore" });
const p = roadTeam(st);
p.pitched = true;
establishArrive(st, p);
const home = st.bases[0];
check(!!home && isCamp(home) && asks(st, home, "camp"), "the camp stands and asks");
check(!st.cards.some((c) => btnOf(c)), "no card with the button for the set-up");
st.cards.length = 0;
upgradeShelter(st, home);
check(isShelter(home) && !isCamp(home) && asks(st, home, "shelter"), "the shelter asks");
let card = st.cards.find((c) => c.title === "A place of your own");
cardChecks(st, card, home, "A place of your own");
check(renameBase(st, home, "Stillwater") === "" && card.text.includes("Stillwater"), "renamed while it waits (the naming window): its text names Stillwater");
ui = newUi();
const i = card.choices.indexOf(btnOf(card));
st.cards.splice(st.cards.indexOf(card), 1);
card.choices[i].resolve(st);
check(main().includes('uiAction.type === "basemap"') && /openBuildMap\(state, ui, c\.uiAction\.baseId\)/.test(main()), "main.js routes the card's button to openBuildMap");
check(openBuildMap(st, ui, card.choices[i].uiAction.baseId) === "" && st.combat && st.combat.layout.baseId === home.id, "the card's button opens the base's map");
st.combat = null;
st.cards.length = 0;
upgradeShelter(st, home);
check(!isShelter(home) && asks(st, home, "base") && !st.cards.length, "the shelter is a base: it asks, no card");

section("'A new home' keeps its button; a gone base");
st = world();
const hb = hub(st);
Object.assign(hb, { tier: 0, camp: true, campDay: 1 });
campBecameShelter(st, hb);
card = st.cards.find((c) => c.title === "A new home");
cardChecks(st, card, hb, "A new home");
check(renameBase(st, hb, "Hollow Pines") === "" && card.text.includes("Hollow Pines"), "renamed while it waits: its text names Hollow Pines");
const gone = setUpCamp(st, 1);
card = { title: "A new home", text: "", mapBase: gone.id, choices: [{ label: "OK", default: true, resolve: () => "" }, { ...btnOf(st.cards[0]), uiAction: { type: "basemap", baseId: gone.id } }] };
st.cards.push(card);
removeCamp(st, gone, "struck");
check(trayStale(st, card) === "the base is gone", "a card whose base is gone is stale in the tray");
ui = newUi();
check(/gone/.test(openBuildMap(st, ui, gone.id)) && !st.combat, "answered anyway, the button opens nothing and says why");
const before = st.cards.length;
autoAnswer(st, card);
check(st.cards.length === before - 1, "the tray drops it without an error");
check(!BUILDMAP_ACTIONS.buildmap(st, ui, { baseId: gone.id }) && /gone/.test(ui.flash.text) && !st.combat, "the alert's action for a gone base opens nothing and says why");

section("The key");
const kb = KEYMAP.find((k) => k.id === "base.buildmap");
check(!!kb && kb.ctx === "map" && kb.keys.join() === "KeyU", "base.buildmap: U on the State Map");
check(KEYMAP.find((k) => k.id === "tab.bases").keys.includes("KeyB"), "(B stays the Bases tab)");
check(!KEYMAP.some((k) => k !== kb && k.ctx === "map" && k.keys.includes("KeyU")), "no other map key on U");
check(keyLabel("base.buildmap", 1) === "U", `its label: ${keyLabel("base.buildmap", 1)}`);
check(/<b>U<\/b> the selected base's build map/.test(helpText()), "the help's keys on the map list it");
check(main().includes("buildMapKey(state, ui, e, modalKind(state, ui))"), "main.js's keydown asks it");
// Nothing selected: it says so.
ui = newUi({ selected: null });
check(buildMapKey(st, ui, key("KeyU"), null) && !st.combat && /Select one of your bases/.test(ui.flash.text), "nothing selected: it says what to do");
// The base on the selected tile.
ui = newUi({ selected: hb.tile });
check(selectedBase(st, ui) === hb, "the selected tile's base is the selected base");
check(buildMapKey(st, ui, key("KeyU"), null) && st.combat && st.combat.layout.baseId === hb.id && ui.mapFrom.tab === "basemap", "U opens its build map");
st.combat = null;
// Over its own window: that base, back to the tab it was on.
const other = setUpCamp(st, 1);
ui = newUi({ selected: hb.tile, baseView: { id: other.id, tab: "camp" } });
check(selectedBase(st, ui) === other, "an open base window is the selected base");
check(buildMapKey(st, ui, key("KeyU"), "base") && st.combat && st.combat.layout.baseId === other.id && ui.mapFrom.tab === "camp", "U over its window opens its map, back to the same tab");
st.combat = null;
ui = newUi({ selected: hb.tile });
check(!buildMapKey(st, ui, key("KeyU"), "card") && !st.combat, "behind another window (a card) it does nothing");
check(!buildMapKey(st, ui, key("KeyU", { shiftKey: true }), null) && !buildMapKey(st, ui, key("KeyB"), null) && !st.combat, "Shift+U and B are not it");

section("Under the governor: nothing is asked");
st = world();
st.autopilot = true;
const c4 = setUpCamp(st, 1);
check(!!c4 && !c4.layoutAsk && !st.cards.some((c) => btnOf(c)), "the camp stands, no ask, no card");

function main() { return readFileSync(new URL("../src/main.js", import.meta.url), "utf8"); }
console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
