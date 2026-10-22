// Naming bases (sim/basenames.js, ui/basename.js): a base you found asks for its name (the staging camp becoming your
// shelter, Build outpost, an outpost handed over), the suggestion filled in; ✎ Rename opens the same window for any
// base; names are cleaned, unique, and the founding card follows a new name. Autopilot keeps the suggestion.
// node tools/basenametest.js
import { createWorld, tickHour, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, giveOrder, partyTile, STANCES } from "../src/sim/parties.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { establishArrive } from "../src/sim/staging.js";
import { pendingName, renameBase, nameSuggestions, cleanName, askBaseName, nameDone } from "../src/sim/basenames.js";
import { nameBaseModal, nameModalUp, BN_ACTIONS, BN_INPUT, bnKey } from "../src/ui/basename.js";
import { renderModal, modalKind, renderLeft, renderRight } from "../src/ui/ui.js";

// Setting up a camp takes an hour (staging.js STAGING.PITCH, nothing carried): the hour is skipped here and the camp stands at once.
const establishArriveNow = (st, p) => { p.pitched = true; return establishArrive(st, p); };

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const freshUi = () => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false });

section("Establish base: the camp (the barest base, staging.js) stands at once and the naming window opens, the suggestion filled in");
{
  const st = createWorld({ seed: 11, factionCount: 7, mode: "hardcore" });
  const p = roadTeam(st);
  Object.assign(p.supplies, { scrap: 30, parts: 4, food: 30, water: 30, buildmat: 2 }); // the shelter takes building materials (staging.js)
  establishArriveNow(st, p);
  const b = st.bases[0];
  check(!!b && b.camp === true, "the camp stands (a base)");
  check(pendingName(st) === b, "the camp waits for a name");
  const ui = freshUi();
  check(nameModalUp(st, ui) && modalKind(st, ui) === "namebase", `the naming window is the one up (${modalKind(st, ui)})`);
  const html = renderModal(st, ui);
  check(/Name your new camp/.test(html), "it asks for the camp's name");
  check(html.includes(`value="${b.name}"`), "the suggested name is filled in");
  check(/data-action="bn-pick"/.test(html), "ideas to pick from");
  check(nameSuggestions(st, b)[0] === b.name && nameSuggestions(st, b).length >= 3, `suggestions: ${nameSuggestions(st, b).join(" / ")}`);
  // Typing, then Enter in the box.
  const old = b.name;
  const card = st.cards.find((c) => (c.text || "").includes(old) || (c.title || "").includes(old));
  BN_INPUT["bn-input"](st, ui, { value: "  Riverside   Hold " });
  check(bnKey(st, ui, { code: "Enter", target: { dataset: { action: "bn-input" }, value: "  Riverside   Hold " } }), "Enter names it");
  check(b.name === "Riverside Hold", `cleaned and set (${b.name})`);
  check(pendingName(st) == null && !nameModalUp(st, ui), "the window closes and the queue is empty");
  if (card) check(!(card.text || "").includes(old) && (card.text || "").includes("Riverside Hold"), "the founding card follows the new name");
  check(st.log.some((l) => /is now called Riverside Hold/.test(l.text || l.msg || "")), "a log line says so");
}

section("Build outpost (a normal game): asked again; duplicates refused; Keep closes with the suggestion");
{
  const st = createWorld({ seed: 42, factionCount: 7 });
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, 2).map((s) => s.id);
  const g = st.grid;
  const dest = [...g.within(h.tile, 4)].find((id) => g.distance(id, h.tile) >= 3 && st.tiles[id].terrain !== "water" && st.tiles[id].owner == null && !st.factions.some((f) => f.bases.includes(id)) && !st.tiles[id].hive);
  check(dest != null, "a free tile 3–4 away");
  const r = launchExpedition(st, { dest, mission: "move", stance: Object.keys(STANCES)[0], memberIds: ids, supplies: { scrap: 20, food: 10, water: 10 } });
  check(!r.error, `the team set out (${r.error || "ok"})`);
  const p = r.party;
  for (let i = 0; i < 96 && p && p.phase !== "waiting"; i++) { tickHour(st); st.cards.length = 0; }
  check(p && partyTile(p) === dest, "the team got there");
  const n0 = st.bases.length;
  giveOrder(st, p, "outpost");
  for (let i = 0; i < 48 && st.bases.length === n0; i++) { tickHour(st); st.cards.length = 0; } // setting up the camp: its fire and the clearing of its 5 × 5 (staging.js siteSetup)
  const o = st.bases[n0];
  check(st.bases.length === n0 + 1 && !!o, "the outpost stands");
  check(pendingName(st) === o, "the outpost waits for a name");
  const ui = freshUi();
  check(/Name your new outpost/.test(renderModal(st, ui)), "it asks for the outpost's name");
  check(renameBase(st, o, h.name) !== "" && o.name !== h.name, "a name another base has is refused");
  BN_INPUT["bn-input"](st, ui, { value: h.name.toUpperCase() });
  BN_ACTIONS["bn-ok"](st, ui);
  check(/already called/.test(ui.nameMsg) && nameModalUp(st, ui), "the window says why and stays open");
  check(/disabled/.test(renderModal(st, ui).match(/data-action="bn-ok"[^>]*/)[0]), "Name it is greyed out while the name is taken");
  const kept = o.name;
  BN_ACTIONS["bn-cancel"](st, ui);
  check(o.name === kept && !nameModalUp(st, ui), "Keep closes it with the suggested name");
  check(renameBase(st, o, "") !== "" && renameBase(st, o, "   ") !== "", "an empty name is refused");
  check(cleanName("a<b>c" + "x".repeat(80)).length === 40 && !/[<>]/.test(cleanName("a<b>c")), "names are cut to 40 and stripped of < >");

  section("✎ Rename: any base, from its screen, the Bases tab and the tile panel");
  const right = renderRight(st, { ...freshUi(), selected: o.tile });
  check(right.includes(`data-action="bn-open" data-base="${o.id}"`), "the tile panel's base card has ✎");
  const left = renderLeft(st, freshUi());
  check(left.includes(`data-action="bn-open" data-base="${h.id}"`), "the Bases tab has ✎ Rename");
  const screen = renderModal(st, { ...freshUi(), baseView: { id: h.id, tab: "overview" } });
  check(screen.includes(`data-action="bn-open" data-base="${h.id}"`), "the base screen has ✎ Rename");
  BN_ACTIONS["bn-open"](st, ui, { base: String(h.id) });
  check(modalKind(st, ui) === "namebase" && /Rename /.test(renderModal(st, ui)), "it opens the window to rename");
  check(bnKey(st, ui, { code: "Escape", target: {} }) && !nameModalUp(st, ui) && h.name !== "", "Esc closes it, the name kept");
  BN_ACTIONS["bn-open"](st, ui, { base: String(h.id) });
  BN_ACTIONS["bn-pick"](st, ui, { name: "Old Town Hall" });
  BN_ACTIONS["bn-ok"](st, ui);
  check(h.name === "Old Town Hall" && !nameModalUp(st, ui), "picking an idea and Rename");
}

section("Autopilot: nobody is asked; a base lost before it is named is forgotten");
{
  const st = createWorld({ seed: 7, factionCount: 7 });
  st.autopilot = true;
  askBaseName(st, hub(st));
  check(pendingName(st) == null, "on autopilot nothing is queued");
  st.autopilot = false;
  askBaseName(st, { id: 999999, name: "Ghost" });
  check(pendingName(st) == null, "a base that is not yours (or gone) is dropped from the queue");
  askBaseName(st, hub(st));
  check(nameModalUp(st, freshUi()) && !nameModalUp(st, { ...freshUi(), started: false }), "not over the new-run screen");
  st.combat = { over: false };
  check(!nameModalUp(st, freshUi()), "not during a battle");
  st.combat = null;
  nameDone(st, hub(st).id);
  check(pendingName(st) == null, "nameDone clears it");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
