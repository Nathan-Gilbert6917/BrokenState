// Orders to allies on a raid's map, the UI half (sim/allyorders.js; ui/combat.js allyButton / allyCard / allyClick /
// allyLine / allyMarks, ui/isoview.js drawAllyMarks, ui/battlebar.js, ui/keymap.js), on stub canvases:
// - Ally orders is a raid order (Alt+A, its own in a battle, not Alt+D/E/F), on the bar (🫡, 1 action, with Call out):
//   given when sim/allyorders.js allyOrderTargets has an ally your people see, greyed with why not (no allies, none in
//   sight, none within ALLY_ORDER.RANGE, no actions, the sim's reason); a field fight shows it greyed with when it applies.
// - A raid with nobody allied looks as before: no card, no chip count, the Evac tip as it was.
// - The flow (sim or stub): the card over the map (every order with its tip and odds, Whole group, Cancel), an order that
//   needs a pick (the enemy, the tile, the way to watch) a pick mode; a tile in the fog of war is sent as it is (the UI
//   never filters by what your people see), off the map is refused; Esc and a right click go back a step.
// - The hover text of an ally: its order (or none) and the key; the Evac tip: allies are told to retreat.
// - With the real sim (an order given): the map draws the markers, the icon only over an ally your people see.
// - Tell me what you see (sim/allyorders.js allyIntel, when there): in the menu with its odds; the marks drawn only on
//   cells your people do not see, a "?" over each; their hover "Told by <ally> on turn N: <label>. Not seen by your people."
// Every check passes with the contract's stub (nothing to order) and with the real sim.
// Usage: node tools/allyordersuitest.js
import { battles } from "./isobattles.js";
import * as C from "../src/sim/combat.js";
import { PARLEY, parleyStatus } from "../src/sim/parley.js";
import { ALLY_ORDER, ALLY_ORDERS, allyOrderTargets, allyOrderOf, allyOrdersShown } from "../src/sim/allyorders.js";
import * as ALLY from "../src/sim/allyorders.js"; // allyIntel: looked up when present
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { faceToward } from "../src/sim/vision.js";
import { LOCATIONS } from "../src/sim/data.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

const drawn = [], styles = []; // every text drawn on a canvas (the badges), every colour set (the markers)
const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }), fillText: (t) => { drawn.push(String(t)); } }, {
  get: (o, k) => (k in o ? o[k] : () => {}),
  set: (o, k, v) => { if (k === "strokeStyle" || k === "fillStyle") styles.push(String(v)); return true; },
});
const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
try { globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} }; } catch { /* node's own */ }

const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
const KM = await import("../src/ui/keymap.js");
const BAR = await import("../src/ui/battlebar.js");
ISO.setIsoCanvas(cvs);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
const cui = UI.cui;
const GREEN = UI.ALLY_COLOR;
const draw = (st) => { try { UI.drawCombat(st, 1e9); return ""; } catch (e) { return e.stack.split("\n").slice(0, 2).join(" "); } };
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const key = (code, alt = false) => ({ code, altKey: alt, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
// An order's button on the bar or in its group's tray (each tray opened in turn).
function barBtn(st, v) {
  const was = cui.barTray;
  try {
    for (const tray of [null, 0, 1, 2, 3, 4, 5, 6, 7]) {
      cui.barTray = tray;
      const m = new RegExp(`<button class="([^"]*)" data-action="cb-act" data-v="${v}"((?: data-[a-z]+="[^"]*")*) (disabled)? ?data-tip="([^"]*)"[^>]*>([^<]*)`).exec(UI.renderCombatBar(st));
      if (m) return { cls: m[1], disabled: !!m[3], tip: unesc(m[4]), label: m[5] };
    }
    return null;
  } finally { cui.barTray = was; }
}
const refresh = (st) => { const b = st.combat; b.rev = (b.rev || 0) + 1; if (b.losCache) b.losCache.fill(0); cui.cache.key = ""; drawn.length = 0; styles.length = 0; return draw(st); };
const greens = () => styles.filter((s) => s.toLowerCase() === GREEN.toLowerCase()).length;
// The screen point of a cell (its middle on the ground) that isoPick gives back as that cell, or null.
function pxOf(b, x, y) {
  for (const z of [0, 8, 16]) {
    const [px, py] = ISO.project(x + 0.5, y + 0.5, z);
    const c = ISO.isoPick(b, px, py);
    if (c && c.x === x && c.y === y) return [px, py];
  }
  return null;
}
const clickCell = (st, x, y) => { const p = pxOf(st.combat, x, y); if (!p) return false; UI.combatClick(st, p[0], p[1]); return true; };
const rightClick = (st) => { UI.combatPress(st, 10, 10, 2); return UI.combatRelease(st, 10, 10); };

// ---------- 1. the key and the bar's tables ----------
console.log("The key: Alt+A, its own in a battle; the bar: 🫡, 1 action, Ally orders");
{
  const k = KM.KEY_BY_ID.get("battle.allyorder");
  check(k && k.v === "allyorder" && k.ctx === "battle" && k.keys.includes("Alt+KeyA"), `battle.allyorder is Ally orders on ${k ? k.keys.join(", ") : "nothing"}`);
  const same = KM.KEYMAP.filter((o) => o.ctx === "battle" && o.keys.includes("Alt+KeyA"));
  check(same.length === 1, `nothing else in a battle on Alt+A (${same.map((o) => o.id).join(", ")})`);
  check(k && !k.keys.some((c) => /^Alt\+Key[DEF]$/.test(c)), "not on Alt+D, E or F (the browser's menus)");
  check(BAR.ICON.allyorder && BAR.COST.allyorder === 1 && BAR.BAR_KEYS.some((x) => x.id === "battle.allyorder"), `the bar: icon ${BAR.ICON.allyorder}, cost ${BAR.COST.allyorder}, among its keys`);
}

// ---------- 2. a raid with nobody allied ----------
console.log("A raid with nobody allied: greyed with why, no card, as before");
const fresh = (seed, name) => {
  const { st, b } = battles(seed, [name])[0];
  draw(st);
  const u = b.units.find((x) => x.side === "player" && x.vol == null && C.active(x) && x.sid != null);
  cui.sel = u.id; cui.mode = "move"; cui.msg = ""; cui.barAll = true; cui.barTray = null; cui.hover = null;
  return { st, b, u };
};
{
  const { st, b, u } = fresh(61, "raid");
  check(!b.units.some((x) => x.ally), "(setup: nobody allied)");
  const o = UI.unitOrders(st, b, u).list.find((x) => x.v === "allyorder");
  check(!!o && !o.ok && /No allies here/.test(o.why || ""), `among the orders, greyed: "${o && o.why}"`);
  const btn = barBtn(st, "allyorder");
  check(btn && btn.disabled && /Alt\+A|Alt A/.test(btn.tip) && /1 action/.test(btn.tip) && /\nNot now: No allies here/.test(btn.tip), "the bar's button: its key, its cost and why not now");
  check(btn && /Ally orders/.test(btn.label), `labelled "${btn && btn.label.trim()}"`);
  UI.combatKey(st, key("KeyA", true));
  check(cui.mode === "move" && cui.msg === o.why, `Alt+A: stays in move mode and says why ("${cui.msg}")`);
  cui.msg = "";
  check(!UI.renderRaidCards(st).includes("cbally"), "no card over the map");
  check(!UI.renderRaidTop(st).includes("ct-ordered"), "no count in the strip");
  const evac = UI.unitOrders(st, b, u).list.find((x) => x.v === "evac");
  check(!evac || !/Allies are told to retreat/.test(evac.tip), "the Evac tip as before");
  check(refresh(st) === "" && greens() === 0, "the map draws, nothing in the allies' green");
  // A field fight: greyed with when it applies (the key table's other orders).
  const F = fresh(62, "field-town");
  const fb = barBtn(F.st, "allyorder");
  check(!UI.unitOrders(F.st, F.b, F.u).list.some((x) => x.v === "allyorder") && fb && fb.disabled && /Raids only/.test(fb.tip), "a field fight: not an order, greyed on the bar (Raids only)");
}

// ---------- 3. a raid with an allied group (sim/parley.js Fight with us) ----------
C.registerCombatHandler("aouitest", () => {});
function world(seed) {
  const state = createWorld({ seed, factionCount: 7 });
  state.cards.length = 0;
  state.noWanderers = true;
  state.hour = Math.floor(state.hour / 24) * 24 + 36; // midday: no night cones
  return state;
}
const siteTile = (state) => state.tiles.find((t) => t.loc && LOCATIONS[t.loc.type] && !t.hive && t.terrain !== "water" && !state.bases.some((b) => b.tile === t.id) && !state.factions.some((f) => f.bases.includes(t.id)));
function raid(state, groups) {
  const h = hub(state);
  for (const k of ["food", "water", "meds"]) h.stock[k] = Math.max(h.stock[k] || 0, 60);
  const crew = atBase(state, h.id).slice(0, 3), tile = siteTile(state);
  const p = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 8, water: 8, ammo: 30, meds: 2 } }).party;
  p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
  const b = C.createBattle(state, { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "aouitest", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 0, building: "street" }, context: {} });
  state.combat = b;
  b.units = b.units.filter((u) => u.kind !== "zombie");
  b.raid.spawnCap = 0;
  const mine = b.units.filter((u) => u.side === "player");
  cui.sel = mine[0].id; cui.mode = "move"; cui.msg = ""; cui.barAll = true; cui.barTray = null; cui.hover = null; cui.allyAsk = null;
  return { b, mine };
}
const open = (b, x, y) => x > 0 && y > 0 && x < b.w - 1 && y < b.h - 1 && b.reach[y * b.w + x] && C.CELL[b.cells[y * b.w + x].k].walk && !b.units.some((o) => !o.dead && o.x === x && o.y === y);
function inSight(b, u, list, d0 = 3, d1 = 6) {
  const cells = [];
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) { const d = Math.hypot(x - u.x, y - u.y); if (d >= d0 && d <= d1) cells.push([x, y, d]); }
  cells.sort((p, q) => p[2] - q[2]);
  for (const [x, y] of cells) {
    if (!open(b, x, y)) continue;
    const t = list[0];
    t.x = x; t.y = y; t.f = 0;
    faceToward(t, u.x, u.y); faceToward(u, x, y);
    if (!C.canSee(b, u, t) || !C.canSee(b, t, u)) continue;
    let k = 1;
    for (const [nx, ny] of cells.filter(([a, c]) => Math.hypot(a - x, c - y) <= 2.5)) {
      if (k >= list.length) break;
      if (!open(b, nx, ny)) continue;
      list[k].x = nx; list[k].y = ny; list[k].f = 0; faceToward(list[k], u.x, u.y); k++;
    }
    return true;
  }
  return false;
}
function outOfSight(b, mine, t) {
  for (let r = Math.max(b.w, b.h); r > 12; r--) for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) {
    if (Math.round(Math.hypot(x - mine[0].x, y - mine[0].y)) !== r || !open(b, x, y)) continue;
    t.x = x; t.y = y;
    b.losCache.fill(0);
    if (!mine.some((m) => C.active(m) && C.canSee(b, m, t))) return true;
  }
  return false;
}
function sure(v, fn) { const O = PARLEY.ODDS, m = O.min, M = O.max; O.min = O.max = v; try { return fn(); } finally { O.min = m; O.max = M; } }
const cardOf = (st, k) => st.cards.find((c) => c && c.battle && c.parley === k);
const choose = (st, c, label) => { const i = st.cards.indexOf(c); if (i >= 0) st.cards.splice(i, 1); const ch = c.choices.find((x) => x.label === label || x.label.startsWith(label)); if (!ch) throw new Error(`no ${label}: ${c.choices.map((x) => x.label).join(", ")}`); return ch.resolve(st); };
const partyOf = (f, n = 3) => ({ kind: "raiders", count: n, power: 4, name: `${f.name} scavengers`, factionId: f.id, side: "neutral", parley: { stance: "friendly", hostility: 15, treacherous: false } });
const hoverOn = (st, t) => { cui.hover = { x: t.x, y: t.y }; const h = UI.renderRaidCards(st); cui.hover = null; return h; };
// An allied group in sight of the first of yours, within reach; the rest of yours out of the way.
function alliedRaid(seed) {
  const st = world(seed);
  const f = st.factions.find((x) => x.alive && !x.outsider);
  const { b, mine } = raid(st, [partyOf(f, 3)]);
  const party = b.units.filter((x) => x.side === "third");
  const ok = inSight(b, mine[0], party, 2, ALLY_ORDER.RANGE - 1);
  for (const x of mine.slice(1)) { x.x = mine[0].x; x.y = mine[0].y; x.off = true; }
  C.combatAct(st, { type: "callout", unit: mine[0].id, target: party[0].id });
  const c = cardOf(st, party[0].pk);
  if (c) sure(1, () => choose(st, c, "Fight with us"));
  st.cards = st.cards.filter((x) => !(x && x.battle));
  for (const x of b.units) if (x.side === "player") x.ap = 2;
  cui.sel = mine[0].id; cui.mode = "move"; cui.msg = ""; cui.allyAsk = null;
  refresh(st);
  return { st, b, u: mine[0], mine, party, ok: ok && !!c };
}

console.log("An allied group: the button, the hover, the Evac tip");
{
  const { st, b, u, party, ok } = alliedRaid(131);
  const a = party[0], g = parleyStatus(b, a);
  check(ok && g && g.allied && party.every((x) => x.ally), `(setup: ${party.length} allied, in sight within ${ALLY_ORDER.RANGE} tiles: ${g && g.label})`);
  const ts = (allyOrderTargets(st, b, u) || []).filter(Boolean);
  const o = UI.unitOrders(st, b, u).list.find((x) => x.v === "allyorder");
  check(!!o && o.ok === ts.length > 0 && (o.ok || !!o.why), `Ally orders: ${o ? (o.ok ? `given (${ts.length} in reach)` : `greyed: "${o.why}"`) : "missing"}`);
  const evac = UI.unitOrders(st, b, u).list.find((x) => x.v === "evac");
  check(evac && /Allies are told to retreat/.test(evac.tip), "the Evac tip: allies are told to retreat");
  const h = hoverOn(st, a);
  check(/Fighting beside you/.test(h) && (/Orders: /.test(h) || /No orders: their own call/.test(h)), "the hover: allied, and their order (none yet)");
  check(!ts.some((x) => x.id === a.id) || /Ally orders \(Alt\+A\)/.test(h), "the hover: the key when they are in reach");
  // Alt+A: none in reach (the stub): says why; one: the card; more: pick them.
  UI.combatKey(st, key("KeyA", true));
  if (!ts.length) check(cui.mode === "move" && cui.msg === o.why && !UI.renderRaidCards(st).includes("cbally"), `Alt+A with nobody to order: "${cui.msg}"`);
  else if (ts.length === 1) check(cui.mode === "allymenu" && UI.renderRaidCards(st).includes("cbally"), "Alt+A, one in reach: the card at once");
  else {
    check(cui.mode === "allypick" && /Click the ally/.test(cui.msg), "Alt+A, more in reach: pick one");
    check(draw(st) === "" && greens() > 0, "the map marks them (green)");
    check(clickCell(st, ts[0].x, ts[0].y) && cui.mode === "allymenu", "the one clicked: the card");
  }
  cui.mode = "move"; cui.msg = ""; cui.allyAsk = null;
  // An ally out of sight of all yours: not offered, not marked.
  const far = party[party.length - 1];
  if (outOfSight(b, [u], far)) {
    refresh(st);
    check(!UI.unitOrders(st, b, u).list.find((x) => x.v === "allyorder").why?.includes(far.name), "an ally out of sight: never named");
  } else check(true, "(no cell out of sight on this map)");
  st.combat = null; st.cards = [];
}

console.log("The flow: the card, the picks, a tile in the fog, Esc and a right click back a step");
{
  const { st, b, u, party } = alliedRaid(131);
  const a = party[0];
  // The card for this ally (as Alt+A opens it with one in reach; the stub offers nobody, so it is opened here).
  cui.allyAsk = { uid: u.id, ally: a.id, kind: null, group: false, many: false }; cui.mode = "allymenu";
  let card = UI.renderRaidCards(st);
  const btns = card.match(/data-v="allykind" data-k="[a-z]+"/g) || [];
  check(btns.length === ALLY_ORDERS.length && ALLY_ORDERS.every((o) => card.includes(`data-k="${o.kind}"`) && card.includes(`>${o.label}`)), `the card: every order (${btns.length} of ${ALLY_ORDERS.length})`);
  check(ALLY_ORDERS.every((o) => unesc(card).includes(o.tip)), "each with its tip");
  check(/\d+%/.test(card) && card.includes("Whole group") && card.includes('data-v="allyclose"') && card.includes(a.name), "the odds, Whole group, Cancel, the ally's name");
  check(draw(st) === "" && greens() > 0, "the map: the reach and the ally picked (green)");
  UI.combatAction(st, "cb-act", { v: "allygroup" });
  check(cui.allyAsk && cui.allyAsk.group && /✔ Whole group/.test(UI.renderRaidCards(st)), "Whole group: on");
  UI.combatAction(st, "cb-act", { v: "allygroup" });
  check(cui.allyAsk && !cui.allyAsk.group, "and off");
  // Move: a tile, any, the fog too.
  UI.combatAction(st, "cb-act", { v: "allykind", k: "move" });
  check(cui.mode === "allytarget" && /fog too/.test(cui.msg), `Move: pick the tile ("${cui.msg}")`);
  UI.combatKey(st, key("Escape"));
  check(cui.mode === "allymenu" && cui.allyAsk && cui.allyAsk.kind === null, "Esc: back to the card");
  UI.combatAction(st, "cb-act", { v: "allykind", k: "move" });
  const r = rightClick(st);
  check(r === null && cui.mode === "allymenu" && UI.combatTick(st, performance.now()) === true, "a right click: back to the card (not out), the cards drawn again");
  UI.combatAction(st, "cb-act", { v: "allykind", k: "move" });
  const vis = C.playerVision(b);
  let fog = null;
  for (let y = 1; y < b.h - 1 && !fog; y++) for (let x = 1; x < b.w - 1 && !fog; x++) if (!vis[y * b.w + x] && open(b, x, y) && pxOf(b, x, y)) fog = [x, y];
  check(!!fog, `(a tile in the fog: ${fog})`);
  if (fog) {
    cui.hover = { x: fog[0], y: fog[1] };
    const prev = UI.renderRaidCards(st);
    check(prev.includes(`(${fog[0]}, ${fog[1]})`) && /fog too/.test(prev), "the hover: the tile picked, nothing of what is there");
    check(draw(st) === "", "the map draws the flag under the mouse");
    cui.hover = null;
    const logs = b.log.length;
    clickCell(st, fog[0], fog[1]);
    const sent = cui.mode === "move" && cui.msg.includes(`(${fog[0]}, ${fog[1]})`);
    const refused = cui.mode === "allytarget" && !!cui.msg && !/Click where|Off the map/.test(cui.msg);
    check(sent || refused, sent ? `sent: "${cui.msg}"` : `the sim's answer (sent, not filtered by your vision): "${cui.msg}"`);
    if (sent) {
      const ord = allyOrderOf(b, a);
      check(b.log.length > logs && (!ord || ord.kind === "move"), `the sim: ${ord ? `${ord.kind}${ord.heeded ? ", heeded" : ", not heeded"}` : "no order shown (ignored)"}`);
    }
  }
  // Off the map: refused by the UI.
  cui.allyAsk = { uid: u.id, ally: a.id, kind: "move", group: false, many: false }; cui.mode = "allytarget";
  UI.combatClick(st, -50000, -50000);
  check(cui.mode === "allytarget" && /Off the map/.test(cui.msg), "off the map: refused");
  // Overwatch: the way (the cone from the ally); their own tile is not a way.
  cui.allyAsk = { uid: u.id, ally: a.id, kind: null, group: false, many: false }; cui.mode = "allymenu";
  UI.combatAction(st, "cb-act", { v: "allykind", k: "overwatch" });
  check(cui.mode === "allytarget" && /way .* should watch/.test(cui.msg), "Overwatch: pick the way");
  cui.hover = { x: Math.min(b.w - 1, a.x + 3), y: a.y, px: 0, py: 0 };
  check(draw(st) === "", "the cone from the ally under the mouse: the map draws");
  cui.hover = null;
  if (clickCell(st, a.x, a.y)) check(/Click away from/.test(cui.msg) && cui.mode === "allytarget", "their own tile: click away");
  // Attack: an enemy your people see; a tile with nobody is not one.
  cui.allyAsk = { uid: u.id, ally: a.id, kind: null, group: false, many: false }; cui.mode = "allymenu";
  UI.combatAction(st, "cb-act", { v: "allykind", k: "attack" });
  check(cui.mode === "allytarget" && /Click an enemy/.test(cui.msg), "Attack: pick the enemy");
  if (fog) { clickCell(st, fog[0], fog[1]); check(cui.mode === "allytarget" && /Click an enemy your people see/.test(cui.msg), "an empty tile: not a target"); }
  // Esc all the way out; Alt+A again closes the flow; another unit selected drops it.
  UI.combatKey(st, key("Escape"));
  UI.combatKey(st, key("Escape"));
  check(cui.mode === "move" && !UI.renderRaidCards(st).includes("cbally"), "Esc twice: out");
  cui.allyAsk = { uid: u.id, ally: a.id, kind: null, group: false, many: true }; cui.mode = "allymenu";
  UI.combatKey(st, key("Escape"));
  check(cui.mode === "allypick", "picked from several: Esc goes back to picking");
  UI.combatKey(st, key("Escape"));
  check(cui.mode === "move", "and then out");
  cui.allyAsk = { uid: u.id, ally: a.id, kind: null, group: false, many: false }; cui.mode = "allymenu";
  UI.combatAction(st, "cb-act", { v: "allyclose" });
  check(cui.mode === "move" && cui.allyAsk === null, "Cancel: out");
  // A need-nothing order (Hold): sent at once when the sim allows it, else greyed with its reason.
  cui.allyAsk = { uid: u.id, ally: a.id, kind: null, group: false, many: false }; cui.mode = "allymenu";
  card = UI.renderRaidCards(st);
  const hold = /<button class="mini[^"]*" data-action="cb-act" data-v="allykind" data-k="hold" (disabled )?data-tip="([^"]*)"/.exec(card);
  check(!!hold && (!hold[1] || /Not now: \S/.test(unesc(hold[2]))), hold && hold[1] ? `Hold greyed: ${unesc(hold[2]).split("Not now: ")[1]}` : "Hold offered");
  if (hold && !hold[1]) {
    UI.combatAction(st, "cb-act", { v: "allykind", k: "hold" });
    check((cui.mode === "move" && /Hold/.test(cui.msg)) || (cui.mode === "allymenu" && !!cui.msg), `Hold: "${cui.msg}"`);
  }
  cui.mode = "move"; cui.allyAsk = null; cui.msg = "";
  // The strip: the allied chip (a count of those under orders when there are).
  const top = UI.renderRaidTop(st), shown = (allyOrdersShown(b) || []).length;
  check(/ct-group allied/.test(top) && (shown > 0) === top.includes("ct-ordered"), `the strip: the allied chip${shown ? `, ${shown} under orders` : ""}`);
  st.combat = null; st.cards = [];
}

console.log("The markers (the real sim): a flag where you sent them, the icon only over an ally you see");
{
  const { st, b, u, party, mine } = alliedRaid(131);
  const a = party[0];
  const vis = C.playerVision(b);
  let fog = null;
  for (let y = 1; y < b.h - 1 && !fog; y++) for (let x = 1; x < b.w - 1 && !fog; x++) if (!vis[y * b.w + x] && open(b, x, y)) fog = [x, y];
  const err = fog ? C.combatAct(st, { type: "allyorder", unit: u.id, ally: a.id, order: { kind: "move", x: fog[0], y: fog[1] } }) : "no fog";
  const shown = (allyOrdersShown(b) || []).find((o) => o && o.allyId === a.id);
  if (err || !shown) check(true, `(no order shown to draw: ${err || "not heeded"})`);
  else {
    check(shown.kind === "move" && shown.x != null && shown.y != null, `allyOrdersShown: ${shown.kind} to (${shown.x}, ${shown.y})${shown.icon ? ` ${shown.icon}` : ""}`);
    check(refresh(st) === "" && greens() > 0 && (!shown.icon || drawn.includes(String(shown.icon))), "seen: the flag and the line (green), the icon by the badge");
    check(/Orders: Move to/.test(hoverOn(st, a)), "the hover: Orders: Move to …");
    if (outOfSight(b, mine.filter((m) => C.active(m)), a)) {
      refresh(st);
      check(greens() > 0 && (!shown.icon || !drawn.includes(String(shown.icon))), "out of sight: the flag you set still shows, no icon (where they are is not given away)");
    } else check(true, "(no cell out of sight on this map)");
  }
  st.combat = null; st.cards = [];
}

console.log("Tell me what you see: the order in the menu, the marks only in the fog, their hover");
{
  const { st, b, u, party } = alliedRaid(131);
  const a = party[0], info = ALLY_ORDERS.find((o) => o.kind === "info");
  cui.allyAsk = { uid: u.id, ally: a.id, kind: null, group: false, many: false }; cui.mode = "allymenu";
  const card = UI.renderRaidCards(st);
  if (!info) check(true, "(the sim has no info order yet: nothing to show)");
  else check(card.includes('data-k="info"') && card.includes(`>${info.label}`) && /data-k="info"[^>]*>[^<]*<b>\d+%<\/b>/.test(card), `the menu: "${info.label}" with its odds`);
  cui.mode = "move"; cui.allyAsk = null;
  const intel = typeof ALLY.allyIntel === "function" ? ALLY.allyIntel : null;
  // Asked from spots 4 tiles off, looking away (where they may see what your people do not), until they tell something.
  let err = info && intel ? "" : "no info order";
  if (!err) {
    const spots = [];
    for (let y = u.y - 5; y <= u.y + 5; y++) for (let x = u.x - 5; x <= u.x + 5; x++) { const d = Math.hypot(x - u.x, y - u.y); if (d >= 3.5 && d <= 4.9 && open(b, x, y)) spots.push([x, y]); }
    const k = ALLY.ALLY_ORDER.ODDS, keep = k && [k.min, k.max];
    if (k && k.min != null) k.min = k.max = 0.99;
    try {
      for (const [x, y] of spots.slice(0, 30)) {
        a.x = x; a.y = y; faceToward(a, x + (x - u.x) * 3, y + (y - u.y) * 3); b.losCache.fill(0); u.ap = 2;
        err = C.combatAct(st, { type: "allyorder", unit: u.id, ally: a.id, order: { kind: "info" } });
        if ((intel(b) || []).length) break;
      }
    } finally { if (keep) [k.min, k.max] = keep; }
  }
  const marks = intel ? (intel(b) || []) : [];
  check(refresh(st) === "", `the map draws (${marks.length} mark${marks.length === 1 ? "" : "s"}${err ? `; ${err}` : ""})`);
  const vis = C.playerVision(b);
  const fogged = marks.filter((m) => m && !vis[m.y * b.w + m.x]);
  if (fogged.length) {
    const m = fogged[0];
    check(drawn.filter((t) => t === "?").length >= fogged.length, `a "?" over each mark in the fog (${fogged.length})`);
    cui.hover = { x: m.x, y: m.y };
    const h = unesc(UI.renderRaidCards(st)).replace(/<[^>]+>/g, "");
    cui.hover = null;
    check(/Told by .+ on turn \d+: .+\. Not seen by your people\./.test(h), `the hover: "${(/Told by[^\n]*?people\./.exec(h) || [""])[0]}"`);
    // One of yours walks up to a mark (no action: the sim has not dropped it yet): the UI shows nothing on a cell they see.
    const q = b.units.find((x) => x.side === "player" && x !== u && C.active(x)) || u, was = [q.x, q.y, q.off];
    let near = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (!near && open(b, m.x + dx, m.y + dy)) near = [m.x + dx, m.y + dy];
    if (near) {
      q.x = near[0]; q.y = near[1]; q.off = false; faceToward(q, m.x, m.y);
      refresh(st);
      const v2 = C.playerVision(b);
      if (v2[m.y * b.w + m.x]) {
        cui.hover = { x: m.x, y: m.y };
        const h2 = UI.renderRaidCards(st);
        cui.hover = null;
        check(!/Told by/.test(h2) && (intel(b) || []).some((o) => o.x === m.x && o.y === m.y), "a mark on a cell your people now see: not shown, though the sim still holds it");
      } else check(true, "(the mark's cell still unseen from next to it)");
      [q.x, q.y, q.off] = was; refresh(st);
    }
  } else check(true, "(no marks in the fog to draw)");
  // A cell your people see: never a mark, whatever the sim holds.
  let seenHover = "";
  for (let i = 0; i < b.w * b.h && !seenHover; i++) if (vis[i]) { cui.hover = { x: i % b.w, y: (i / b.w) | 0 }; const h = UI.renderRaidCards(st); if (/Told by/.test(h)) seenHover = `${cui.hover.x},${cui.hover.y}`; }
  cui.hover = null;
  check(!seenHover, `no mark on a cell your people see${seenHover ? ` (one at ${seenHover})` : ""}`);
  st.combat = null; st.cards = [];
}

console.log(`\n${passed} passed, ${failed} failed (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
