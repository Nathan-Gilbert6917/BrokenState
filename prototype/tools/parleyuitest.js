// Calling out to another group on a raid's map, the UI half (sim/parley.js; ui/combat.js callButton / groupLine /
// groupChips, ui/isoview.js drawLabels, ui/battlebar.js, ui/keymap.js), on stub canvases:
// - Call out is a raid order (Alt+O), on the bar: given when sim/parley.js callOutTargets has someone, greyed with the
//   sim's reason otherwise; a field fight shows it greyed with when it applies. Its key runs the same code as its button.
// - The hover text of someone of another group carries the group line (name, the stance shown, the indicator's word,
//   actively hostile or not); the raid's strip a chip per group seen (sim/parley.js parleyGroupsSeen).
// - A raid with nobody but the dead looks as before: no chips, no group lines, Call out greyed.
// - A talk over a fight with many answers (a battle card, ui/ui.js cardModal) lays them out in two columns.
// Written against the contract (sim/parley.js's exports and shapes), so it holds whether the sim returns data or not.
// Usage: node tools/parleyuitest.js
import { battles } from "./isobattles.js";
import * as C from "../src/sim/combat.js";
import { parleyStatus, parleyGroupsSeen, callOutTargets } from "../src/sim/parley.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, {
  get: (o, k) => (k in o ? o[k] : () => {}),
});
const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
try { globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} }; } catch { /* node's own */ }

const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
const KM = await import("../src/ui/keymap.js");
const UIM = await import("../src/ui/ui.js");
ISO.setIsoCanvas(cvs);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
const cui = UI.cui;
const draw = (st) => { try { UI.drawCombat(st, 1e9); return ""; } catch (e) { return e.stack.split("\n").slice(0, 2).join(" "); } };
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// An order's button on the bar or in its group's tray (each tray opened in turn).
function barBtn(st, v) {
  const was = cui.barTray;
  try {
    for (const tray of [null, 0, 1, 2, 3, 4, 5, 6, 7]) {
      cui.barTray = tray;
      const m = new RegExp(`<button class="([^"]*)" data-action="cb-act" data-v="${v}"((?: data-[a-z]+="[^"]*")*) (disabled)? ?data-tip="([^"]*)"`).exec(UI.renderCombatBar(st));
      if (m) return { cls: m[1], disabled: !!m[3], tip: unesc(m[4]) };
    }
    return null;
  } finally { cui.barTray = was; }
}
const fresh = (seed, name) => {
  const { st, b } = battles(seed, [name])[0];
  draw(st);
  const u = b.units.find((x) => x.side === "player" && x.vol == null && C.active(x) && x.sid != null);
  cui.sel = u.id; cui.mode = "move"; cui.msg = ""; cui.barAll = true; cui.barTray = null; cui.hover = null;
  return { st, b, u };
};
// One of theirs (a person) moved right next to u, in sight; the view worked out again.
function bringNear(b, u, t) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const x = u.x + dx, y = u.y + dy;
    if (x < 0 || y < 0 || x >= b.w || y >= b.h || !C.CELL[b.cells[y * b.w + x].k]?.walk || C.unitAt(b, x, y)) continue;
    t.x = x; t.y = y; t.aware = true;
    b.losCache.fill(0); b.rev = (b.rev || 0) + 1; cui.cache.key = "";
    return true;
  }
  return false;
}

// ---------- 1. the key ----------
console.log("The key: Alt+O, its own in a battle");
{
  const k = KM.KEY_BY_ID.get("battle.callout");
  check(k && k.v === "callout" && k.ctx === "battle" && k.keys.includes("Alt+KeyO"), `battle.callout is Call out on ${k ? k.keys.join(", ") : "nothing"}`);
  const same = KM.KEYMAP.filter((o) => o.ctx === "battle" && o.keys.includes("Alt+KeyO"));
  check(same.length === 1, `nothing else in a battle on Alt+O (${same.map((o) => o.id).join(", ")})`);
}

// ---------- 2. the order in a raid ----------
console.log("Call out in a raid: given when someone can be called to, else greyed with the sim's reason");
{
  const { st, b, u } = fresh(61, "raid");
  const o = UI.unitOrders(st, b, u).list.find((x) => x.v === "callout");
  const ts = callOutTargets(st, b, u) || [];
  check(!!o && o.ok === ts.length > 0, `Call out among the orders (${o ? (o.ok ? "given" : `greyed: ${o.why}`) : "missing"}; ${ts.length} to call to)`);
  check(!o || o.ok || !!o.why, "greyed, it says why");
  const btn = barBtn(st, "callout");
  check(btn && /Alt\+O|Alt O/.test(btn.tip) && /1 action/.test(btn.tip) && (!btn.disabled || /\nNot now: \S/.test(btn.tip)), `the bar's button: its key, its cost${btn && btn.disabled ? " and why not now" : ""}`);
  // The key runs the button's code: with nobody to call to it stays in move mode and says why.
  UI.combatKey(st, { code: "KeyO", altKey: true, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
  if (!ts.length) check(cui.mode === "move" && cui.msg === o.why, `Alt+O with nobody to call to: "${cui.msg}"`);
  else check(cui.mode === "callout" || b.log.length > 0, `Alt+O with someone to call to: ${ts.length > 1 ? "pick whom" : "called"}`);
  cui.mode = "move"; cui.msg = "";
  check(draw(st) === "", "the map draws");

  // Someone of theirs (a person) right next to u: the hover text's group line, as sim/parley.js parleyStatus says.
  const t = b.units.find((x) => x.side === "enemy" && x.kind === "human" && C.active(x));
  if (t && bringNear(b, u, t)) {
    draw(st);
    cui.hover = { x: t.x, y: t.y };
    const card = UI.renderRaidCards(st), g = parleyStatus(b, t);
    check(!g || (card.includes("group ·") && card.includes(g.label) && /Actively hostile|Not hostile/.test(card)), g ? `the hover text: ${/<br><span class="small"><b style[^>]*>([^<]*)<\/b>([^<]*)/.exec(card)?.slice(1).join("") || "no group line"}` : "no group: no group line");
    check(!g || card.includes(g.active ? "Actively hostile" : "Not hostile"), "hostile now or not, as the sim says");
    // Callout mode: the map marks whom it can be called to, and draws.
    cui.mode = "callout";
    check(draw(st) === "", "callout mode: the map draws");
    cui.mode = "move"; cui.hover = null;
  } else check(true, "no person of theirs on this raid to bring near");
  // The strip: a chip a group seen.
  const top = UI.renderRaidTop(st), gs = parleyGroupsSeen(b) || [];
  const chips = (top.match(/class="ct-group/g) || []).length;
  check(chips === gs.length && (gs.length > 0) === top.includes("cbgroups"), `the strip: ${chips} chip${chips === 1 ? "" : "s"} for ${gs.length} group${gs.length === 1 ? "" : "s"} seen`);
  check(gs.every((g) => top.includes(g.active ? "HOSTILE" : "NOT HOSTILE")), "each chip: HOSTILE or NOT HOSTILE");
  st.combat = null;
}

// ---------- 3. the dead only: as before ----------
console.log("A raid with nobody but the dead looks as before");
{
  const { st, b, u } = fresh(62, "raid");
  b.units = b.units.filter((x) => x.side === "player" || x.kind === "zombie");
  b.rev = (b.rev || 0) + 1; cui.cache.key = "";
  draw(st);
  const o = UI.unitOrders(st, b, u).list.find((x) => x.v === "callout");
  check(o && !o.ok && /Nobody of another group in sight/.test(o.why), `Call out greyed: ${o ? o.why : "missing"}`);
  check(!UI.renderRaidTop(st).includes("cbgroups"), "no group chips in the strip");
  const z = b.units.find((x) => x.kind === "zombie" && C.active(x));
  if (z) { cui.hover = { x: z.x, y: z.y }; check(!UI.renderRaidCards(st).includes("group ·"), "no group line over the dead"); cui.hover = null; }
  check(draw(st) === "", "the map draws");
  st.combat = null;
}

// ---------- 4. a field fight ----------
console.log("A field fight: Call out greyed with when it applies");
{
  const { st, b, u } = fresh(63, "field-town");
  check(!UI.unitOrders(st, b, u).list.some((x) => x.v === "callout"), "not among the orders");
  const btn = barBtn(st, "callout");
  check(btn && btn.disabled && /Raids only/.test(btn.tip), `with All, greyed: ${btn ? btn.tip.split("\n")[1] : "missing"}`);
  st.combat = null;
}

// ---------- 5. the talk's card ----------
console.log("A talk over a fight with seven answers: two columns");
{
  const { st } = fresh(64, "raid");
  const choices = ["Hold your fire", "Let's both walk away", "Trade", "Join us", "What do you know?", "Attack them", "Never mind"].map((label, i) => ({ label, hint: `${40 + i * 5}%: what it brings`, resolve: () => "" }));
  st.cards = [{ id: 1, title: "Call out", text: "\"Stop there. Who are you with?\"", battle: true, choices }];
  const html = UIM.renderModal(st, { started: true });
  check(/<div class="box many">/.test(html) && (html.match(/data-action="choice"/g) || []).length === 7 && (html.match(/class="hint"/g) || []).length === 7, "the box is marked many, seven answers with their hints");
  st.cards[0].choices = choices.slice(0, 3);
  check(/<div class="box">/.test(UIM.renderModal(st, { started: true })), "three answers: the plain box");
  st.cards = []; st.combat = null;
}

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
