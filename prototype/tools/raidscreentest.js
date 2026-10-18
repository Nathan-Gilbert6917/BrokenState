// A raid without the side panel (ui/combat.js raidLayout, renderRaidTop / renderRaidCards / renderRaidLog; ui/logwindow.js;
// ui/raidplan.js planHtml { card }), the user's request 2026-10-18, on stub canvases:
// - Only a raid on a site drops the panel: a field fight, a base assault and a drill keep it.
// - The top strip carries what the panel did: the place, the turn, Heat with its bar, the floor shown (▲ ▼) in a building
//   with storeys, the supplies, the Menu, the view's buttons (turn, zoom, center, Roofs, Cones) and the Log button.
// - The dialogue before you go in, over the map at the start: "Send a scout first?" with the team's odds, "Which side do
//   you start from?" with the map's sides, Wait for night, Go in. No picture of the site before a scout is sent; a scout
//   back brings the picture (the outside). "Look at the map first" puts it aside as a chip in the strip; back brings it.
// - The log window: its lines, its toggle / fold / hide, its place clamped inside the map, a drag and a resize kept as
//   anchors in rem, the smallest size.
// Usage: node tools/raidscreentest.js
import { battles, world } from "./isobattles.js";
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, registerCombatHandler } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { planOf, planOpen, sendScout } from "../src/sim/raidplan.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();
registerCombatHandler("test", () => {});

const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, { get: (o, k) => (k in o ? o[k] : () => {}) });
const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:image/png;base64,x" });
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
const LW = await import("../src/ui/logwindow.js");
ISO.setIsoCanvas(cvs);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
const cui = UI.cui;

// A raid on a site with the plan offered (sim/raidplan.js), as the browser opens it.
function plannedRaid(seed, siteType) {
  const state = createWorld({ seed, factionCount: 7 });
  const h = hub(state);
  const tile = state.tiles.find((t) => t.loc && t.loc.type === siteType && t.id !== h.tile) || state.tiles.find((t) => t.loc && t.id !== h.tile);
  const crew = atBase(state, h.id).slice(0, 3);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
  if (res.error) return null;
  const p = res.party;
  p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
  const groups = raidEnemies(state, tile.id);
  state.combat = createBattle(state, { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "test", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5 }, context: {}, plan: true });
  return state;
}

// ---------- 1. which battles drop the panel ----------
console.log("Which battles drop the side panel");
{
  const all = battles(21, ["field-town", "raid", "raid-building", "base-assault"]);
  for (const { name, b } of all) check(UI.raidLayout(b) === /^raid/.test(name), `${name}: ${UI.raidLayout(b) ? "no side panel" : "the side panel"}`);
  const field = all.find((x) => x.name === "field-town");
  check(UI.renderRaidTop(field.st) === "" && UI.renderRaidCards(field.st) === "" && UI.renderRaidLog(field.st) === "", "a field fight renders no raid strip, cards or log window");
  check(/Your team/.test(UI.renderCombatScreen(field.st)) && /<h3>Log<\/h3>/.test(UI.renderCombatScreen(field.st)), "its screen is the panel with its own log");
}

// ---------- 2. the top strip ----------
console.log("The top strip");
{
  const { st, b } = battles(21, ["raid"])[0];
  UI.drawCombat(st, 1e9);
  const top = UI.renderRaidTop(st);
  check(/class="ct-mid"/.test(top) && /class="ct-right"/.test(top), "a middle and a right part");
  check(/Heat <b>[A-Za-z]+<\/b>/.test(top) && /class="heat"><i style="left:/.test(top), "Heat by name with its bar");
  check(/Turn \d+ · \d+h \d+m in/.test(top), "the turn and the clock");
  check(/Your turn|Enemy turn/.test(top), "whose turn it is (the canvas banner's job before)");
  check(/data-action="set-open"[^>]*>⚙ Menu/.test(top), "the Menu button");
  for (const v of ["rotl", "rotr", "zin", "zout", "center", "roofs", "cones"]) check(new RegExp(`data-action="cb-view" data-v="${v}"`).test(top), `the view's ${v} button`);
  check(/data-action="cb-log" data-v="toggle"[^>]*>📜 Log/.test(top), "the Log button");
  check(/Ammo <b>\d+<\/b>/.test(top) && /Meds <b>\d+<\/b>/.test(top) && /Left to search <b>\d+<\/b>/.test(top), "ammo, meds and what is left to search");
  check(!/cbfloor/.test(top), "no floor control on a one-storey map");
  check(UI.renderCombatScreen(st).includes(top) && /data-action="cb-end"/.test(UI.renderCombatScreen(st)), "the raid's screen is the strip, the cards, the log and the bottom bar");
  const bld = battles(21, ["raid-building"])[0];
  UI.drawCombat(bld.st, 1e9);
  const t2 = UI.renderRaidTop(bld.st);
  if (ISO.floorsOf(bld.b)) {
    check(/class="ct-floor"[^>]*>Floor \d+ of \d+/.test(t2) && /data-v="fup"/.test(t2) && /data-v="fdown"/.test(t2), "a building with storeys: the floor shown with ▲ ▼ in the strip");
    check(/Ways out <b>\d+<\/b>/.test(t2), "the building's ways out");
  } else check(/Ways out <b>\d+<\/b>/.test(t2), "the building's ways out (one storey here)");
  // A warning and the hover details are cards, not strip.
  cui.msg = "This is the top floor.";
  check(/ct-toast[^>]*>This is the top floor\./.test(UI.renderRaidCards(bld.st)), "a warning is a card over the map");
  cui.msg = "";
  cui.hover = { x: 1, y: 1 };
  check(/id="cbprev" class="cbprev">/.test(UI.renderRaidCards(bld.st)), "the hover details are a card while the mouse is over the map");
  cui.hover = null;
  check(/id="cbprev" class="cbprev empty"/.test(UI.renderRaidCards(bld.st)), "and an empty, hidden box without one (the mouse fills it as it moves)");
  // The log.
  check(UI.renderRaidLog(bld.st).split('<div class="k-').length - 1 === Math.min(80, bld.b.log.length), "the log window shows the log's lines");
  check(/data-action="cb-confirm"/.test(UI.renderRaidLogFoot(bld.st)), "the ask-before-ending toggle is the window's footer");
}

// ---------- 3. the dialogue before you go in ----------
console.log("Before you go in");
{
  let st = null;
  for (let i = 0; i < 12 && !st; i++) { const s = plannedRaid(7100 + i, ["town", "farm", "gas", "police"][i % 4]); if (s && planOpen(s.combat) && planOf(s.combat).sides.length > 1) st = s; }
  check(!!st, "a raid with the plan offered and more than one side");
  if (st) {
    const b = st.combat;
    UI.drawCombat(st, 1e9);
    const cards = UI.renderRaidCards(st);
    check(/Before you go in/.test(cards) && /class="[^"]*rplan[^"]*cbcard/.test(cards), "the dialogue is a card over the map at the start");
    check(/Send a scout first\?/.test(cards) && /data-action="cb-plan" data-v="scout"/.test(cards), "it asks about a scout, with the team to pick from");
    check(/Which side do you start from\?/.test(cards) && (cards.match(/data-v="side"/g) || []).length === 4, "it asks which side to start from, the four sides");
    check(/data-v="go"[^>]*>Go in/.test(cards) && /data-v="night"/.test(cards), "Go in and Wait for night");
    check(/rplan-nomap/.test(cards) && !/class="rplanmap"/.test(cards), "no picture of the site before a scout is sent");
    check(!/data-v="back"/.test(UI.renderRaidTop(st)), "no chip in the strip while the dialogue is shown");
    // Put aside, and back.
    UI.combatAction(st, "cb-plan", { v: "aside" });
    check(!/Before you go in/.test(UI.renderRaidCards(st)) && /data-action="cb-plan" data-v="back"/.test(UI.renderRaidTop(st)), "Look at the map first: the card goes, a chip in the strip stays");
    UI.combatAction(st, "cb-plan", { v: "back" });
    check(/Before you go in/.test(UI.renderRaidCards(st)), "the chip brings it back");
    // The scout brings the picture.
    const msg = sendScout(st, null);
    const b2 = st.combat;
    check(typeof msg === "string" && !!planOf(b2).scout, `a scout sent: ${msg}`);
    UI.drawCombat(st, 1e9);
    const after = UI.renderRaidCards(st);
    check(/class="rplanmap"/.test(after) && /The site from outside/.test(after) && !/rplan-nomap/.test(after), "the scout back: the picture of the site from outside");
    check(!/Send a scout first\?/.test(after), "no second scout");
    // The same card on the panel of a battle with the panel keeps the gate (no picture before a scout).
    const { planHtml } = await import("../src/ui/raidplan.js");
    check(!/Look at the map first/.test(planHtml(st, b2)) && /Look at the map first/.test(planHtml(st, b2, { card: true })), "the panel's card has no Look at the map first; the dialogue has");
    // A new battle shows the dialogue again.
    UI.combatAction(st, "cb-plan", { v: "aside" });
    check(cui.planAside, "put aside");
    const other = battles(22, ["raid"])[0];
    UI.drawCombat(other.st, 1e9);
    check(!cui.planAside, "a new battle: the dialogue is shown again");
    void b;
  }
}

// ---------- 4. the log window's rules ----------
console.log("The log window");
{
  const L = { ...LW.LOGWIN_DEFAULT };
  const box = { w: 1200, h: 700 }, rem = 16;
  let p = LW.place(box, rem, 28, L);
  check(p.x + p.w === box.w - L.right * rem && p.y === L.top * rem && p.w === L.w * rem && p.h === L.h * rem, "its place: anchored to the right and the top, its size in rem");
  L.min = true;
  check(LW.place(box, rem, 28, L).h === 28, "folded: the title bar's height");
  L.min = false;
  // A drag to the far left and over the top edge: clamped inside.
  p = LW.place(box, rem, 28, L);
  LW.dragTo(p, -5000, -5000, box, rem, L);
  const q = LW.place(box, rem, 28, L);
  check(q.x === 0 && q.y === 0, "dragged past the top left corner: it stops at the corner");
  LW.dragTo(q, 5000, 5000, box, rem, L);
  const r = LW.place(box, rem, 28, L);
  check(r.x + r.w === box.w && r.y + r.h === box.h, "dragged past the bottom right corner: it stops at that corner");
  // A resize: the left and top edges stay, the smallest size holds, never past the map's edge.
  LW.dragTo(r, -300, -300, box, rem, L);
  const s0 = LW.place(box, rem, 28, L);
  LW.resizeTo(s0, 100, 50, box, rem, L);
  const s1 = LW.place(box, rem, 28, L);
  check(s1.x === s0.x && s1.y === s0.y && s1.w === s0.w + 100 && s1.h === s0.h + 50, "resized by the corner: wider and taller, the top left edge put");
  LW.resizeTo(s1, -5000, -5000, box, rem, L);
  const s2 = LW.place(box, rem, 28, L);
  check(s2.w === LW.LOGWIN_MIN.w * rem && s2.h === LW.LOGWIN_MIN.h * rem, "never smaller than the minimum");
  LW.resizeTo(s2, 5000, 5000, box, rem, L);
  const s3 = LW.place(box, rem, 28, L);
  check(s3.x + s3.w === box.w && s3.y + s3.h === box.h, "never past the map's edge");
  // A smaller map: still inside.
  const small = LW.place({ w: 300, h: 200 }, rem, 28, L);
  check(small.x >= 0 && small.y >= 0 && small.x + small.w <= 300 && small.y + small.h <= 200, "a small map: clamped inside it");
  // The buttons.
  const W = LW.LOGWIN;
  Object.assign(W, LW.LOGWIN_DEFAULT);
  check(W.open && !W.min, "shown and open by default");
  LW.logAction("toggle"); check(!W.open, "Log: hidden");
  LW.logAction("toggle"); check(W.open && !W.min, "Log again: shown");
  LW.logAction("min"); check(W.min, "–: folded to the title");
  LW.logAction("min"); check(!W.min, "again: open");
  LW.logAction("min"); LW.logAction("toggle"); LW.logAction("toggle"); check(W.open && !W.min, "hidden while folded, shown again: open");
  LW.logAction("close"); check(!W.open, "×: hidden");
  LW.logAction("show"); check(W.open, "show: shown");
  check(!LW.logAction("nonsense"), "an unknown button does nothing");
  // The strip's button lights while the window is shown; the key toggles it in a raid only.
  const { st, b } = battles(21, ["raid"])[0];
  UI.drawCombat(st, 1e9);
  check(/data-v="toggle"[^>]*>📜 Log/.test(UI.renderRaidTop(st)) && /class="mini active" data-action="cb-log"/.test(UI.renderRaidTop(st)), "the Log button lit while the window is shown");
  UI.combatAction(st, "cb-log", { v: "toggle" });
  check(!W.open && /class="mini" data-action="cb-log" data-v="toggle"/.test(UI.renderRaidTop(st)), "clicked: hidden, the button dark");
  UI.combatAction(st, "cb-log", { v: "toggle" });
  check(W.open, "clicked again: shown");
  const field = battles(21, ["field-town"])[0];
  UI.drawCombat(field.st, 1e9);
  check(!UI.combatKey(field.st, { code: "KeyM", shiftKey: true, key: "M", preventDefault() {} }) || W.open, "the log key in a field fight leaves the panel's log alone");
  void b;
}

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
if (failed) process.exit(1);
