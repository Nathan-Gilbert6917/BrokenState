// A raid without the side panel (ui/combat.js raidLayout, renderRaidTop / renderRaidCards / renderRaidLog; ui/logwindow.js;
// ui/raidplan.js planHtml { card }), the user's request 2026-10-18, on stub canvases:
// - Only a raid on a site drops the panel: a field fight, a base assault and a drill keep it.
// - The top strip carries what the panel did: the place, the turn, Heat with its bar, the floor shown (▲ ▼) in a building
//   with storeys, the supplies, the Menu, the view's buttons (turn, zoom, center, Roofs, Cones) and the Log button.
// - The dialogue before you go in, over the map at the start: "Send a scout first?" with the team's odds, "Which side do
//   you start from?" with the map's sides, Wait for night, Go in. No picture of the site before a scout is sent; a scout
//   back brings the picture (the outside). "Look at the map first" (once a scout came back unseen) puts it aside: a card
//   over the map and a chip in the strip bring it back. The plan is a window over the screen (ui/raidplan.js).
// - The log window: its lines, its toggle / fold / hide, its place clamped inside the map, a drag and a resize kept as
//   anchors in rem, the smallest size.
// Usage: node tools/raidscreentest.js
import { battles, world } from "./isobattles.js";
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, registerCombatHandler } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { planOf, planOpen, sendScout, refit, unstage, setEntry } from "../src/sim/raidplan.js";
import { sideRounds } from "../src/sim/ammo.js";

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

// ---------- 3. the plan before you go in ----------
// The window over the battle screen (ui/raidplan.js planModalHtml; ui.js pickModal "raidplan"): nobody of yours on the
// map until a side is picked; Look at the map first only once a scout came back unseen (the window put aside: a card
// over the map and a chip in the strip bring it back); going in from a side closes it.
console.log("Before you go in");
{
  const RP = await import("../src/ui/raidplan.js");
  let st = null;
  for (let i = 0; i < 12 && !st; i++) { const s = plannedRaid(7100 + i, ["town", "farm", "gas", "police"][i % 4]); if (s && planOpen(s.combat) && planOf(s.combat).sides.length > 1) st = s; }
  check(!!st, "a raid with the plan offered and more than one side");
  if (st) {
    const b = st.combat;
    UI.drawCombat(st, 1e9);
    const win = RP.planModalHtml(st);
    check(/Before you go in/.test(win) && /rplanbox/.test(win), "the plan is a window (ui.js pickModal) at the start");
    check(!/Before you go in/.test(UI.renderRaidCards(st)) && !/data-v="back"/.test(UI.renderRaidTop(st)), "nothing of it over the map or in the strip while the window is up");
    check(/Send a scout first/.test(win) && /data-action="cb-plan" data-v="scout"/.test(win), "it offers a scout, with the team to pick from");
    check(/Go in from:/.test(win) && (win.match(/data-v="enter"/g) || []).length === 4 && (win.match(/data-v="enter" data-k="[a-z]+"  data-tip/g) || []).length === planOf(b).sides.length, "the sides to go in from (the map's ones live)");
    check(/data-v="night"/.test(win) && /data-v="leave"/.test(win) && /data-v="inv"/.test(win), "Wait for night, Leave and the team inventory");
    check(!/data-v="map"/.test(win), "no Look at the map first before a scout");
    check(UI.renderCombatBar(st) === "" && !/cbunit/.test(UI.renderRaidCards(st)), "no orders and no squad while nobody is on the map");
    // Put aside (the map looked at), and back.
    UI.combatAction(st, "cb-plan", { v: "map" });
    check(!RP.planUp(st) && /Back to the plan/.test(UI.renderRaidCards(st)) && /data-action="cb-plan" data-v="back"/.test(UI.renderRaidTop(st)), "put aside: the window goes, a card over the map and a chip in the strip bring it back");
    UI.combatAction(st, "cb-plan", { v: "back" });
    check(RP.planUp(st) && !/Back to the plan/.test(UI.renderRaidCards(st)), "back: the window again");
    // The scout: Look at the map first once they come back unseen.
    const msg = sendScout(st, null);
    const b2 = st.combat;
    check(typeof msg === "string" && !!planOf(b2).scout, `a scout sent: ${msg}`);
    UI.drawCombat(st, 1e9);
    const after = RP.planModalHtml(st);
    check(!/data-v="scout"/.test(after), "no second scout");
    check(/data-v="map"/.test(after) === !!planOf(b2).scout.ok, `Look at the map first ${planOf(b2).scout.ok ? "offered: the scout came back unseen" : "withheld: the scout was seen"}`);
    // Going in from a side closes the plan and places the team.
    const side = planOf(b2).sides.find((x) => x !== planOf(b2).side) || planOf(b2).side;
    UI.combatAction(st, "cb-plan", { v: "enter", k: side });
    check(!planOpen(st.combat) && st.combat.raid.zones[0].side === side && UI.renderCombatBar(st) !== "", `in from the ${side}: the plan closed, the team on the map, the orders back`);
    // A new battle shows the window again.
    const other = battles(22, ["raid"])[0];
    UI.drawCombat(other.st, 1e9);
    check(!RP.planUI.map && !RP.planUI.leave, "a new battle: the window up, nothing put aside");
    void b;
  }
}

// ---------- 3b. the rounds survive the battle being made again ----------
// The fill at the start takes a magazine's worth a gun out of the pockets' boxes and the team's bags onto the unit;
// a rebuild (the kit window closing, another side, a scout, the night) must give them back (sim/raidplan.js gunsOut),
// else rounds moved onto a survivor before going in were gone when the raid started (the user's report 2026-10-18).
console.log("The rounds across a rebuild");
{
  let n = 0;
  for (let i = 0; i < 6 && n < 3; i++) {
    const st = plannedRaid(7300 + i, ["town", "farm", "gas", "police"][i % 4]);
    if (!st || !planOpen(st.combat)) continue;
    const P = planOf(st.combat);
    const guns = st.combat.units.filter((u) => u.side === "player" && Array.isArray(u.stack) && u.stack.length).length;
    if (!guns) continue;
    n++;
    const before = sideRounds(st.combat);
    unstage(st);
    refit(st);
    check(sideRounds(st.combat) === before, `seed ${7300 + i}: ${before} rounds before the kit window, ${sideRounds(st.combat)} after it (${guns} gun${guns === 1 ? "" : "s"} loaded)`);
    const other = P.sides.find((s) => s !== planOf(st.combat).side);
    if (other) { setEntry(st, other); check(sideRounds(st.combat) === before, `seed ${7300 + i}: ${sideRounds(st.combat)} after coming in from the ${other}`); }
    check(st.combat.units.filter((u) => u.side === "player" && Array.isArray(u.stack) && u.stack.length).length === guns, `seed ${7300 + i}: the same ${guns} gun${guns === 1 ? "" : "s"} loaded in the battle made again`);
  }
  check(n >= 1, `${n} planned raid${n === 1 ? "" : "s"} with a loaded gun tried`);
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
