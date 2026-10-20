// Calling out to another group on a raid's map, the UI half (sim/parley.js; ui/combat.js callButton / groupLine /
// groupChips, ui/isoview.js drawLabels, ui/battlebar.js, ui/keymap.js), on stub canvases:
// - Call out is a raid order (Alt+O), on the bar: given when sim/parley.js callOutTargets has someone, greyed with the
//   sim's reason otherwise; a field fight shows it greyed with when it applies. Its key runs the same code as its button.
// - The hover text of someone of another group carries the group line (name, the stance shown, the indicator's word,
//   actively hostile or not); the raid's strip a chip per group seen (sim/parley.js parleyGroupsSeen).
// - A raid with nobody but the dead looks as before: no chips, no group lines, Call out greyed.
// - A talk over a fight with many answers (a battle card, ui/ui.js cardModal) lays them out in two columns.
// - With the real sim (sim/parley.js), on raids with groups: Allied (green chip, its word in the tip, the badge), a tell
//   (the amber ! on the badge and the chip, "Something is off about them." on hover: only for parleyStatus.tell, never
//   for a treacherous group nobody saw through), a walk-away's countdown ("Leave their sight: N turns") or "Leaving",
//   the speaker switch on the card (a row of small buttons that are the card's own "Let <name> speak" choices), "Risky:"
//   hints in amber, the Call out tip's shout (sim/parley.js shoutCost when there), no group status outside raids.
// Usage: node tools/parleyuitest.js
import { battles } from "./isobattles.js";
import * as C from "../src/sim/combat.js";
import * as P from "../src/sim/parley.js";
import { parleyStatus, parleyGroupsSeen, callOutTargets, PARLEY } from "../src/sim/parley.js";
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { faceToward } from "../src/sim/vision.js";
import { LOCATIONS } from "../src/sim/data.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

const drawn = []; // every text drawn on a canvas (the badges' words)
const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }), fillText: (t) => { drawn.push(String(t)); } }, {
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
  const word = (g) => g.active ? "HOSTILE" : g.allied ? "ALLIED" : g.label === "Unaware" || g.label === "Standoff" ? `NOT FIRING · ${g.label.toUpperCase()}` : g.leaveBy != null || g.goes ? "" : "NOT HOSTILE";
  check(gs.every((g) => top.includes(word(g))), "each chip: HOSTILE, NOT FIRING (unaware, standoff) or NOT HOSTILE");
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

// ---------- the real sim: raids with groups ----------
C.registerCombatHandler("puitest", () => {});
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
  const b = C.createBattle(state, { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "puitest", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 0, building: "street" }, context: {} });
  state.combat = b;
  b.units = b.units.filter((u) => u.kind !== "zombie");
  b.raid.spawnCap = 0;
  const mine = b.units.filter((u) => u.side === "player");
  cui.sel = mine[0].id; cui.mode = "move"; cui.msg = ""; cui.barAll = true; cui.barTray = null; cui.hover = null;
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
const refresh = (st) => { const b = st.combat; b.rev = (b.rev || 0) + 1; if (b.losCache) b.losCache.fill(0); cui.cache.key = ""; drawn.length = 0; return draw(st); };
const cardOf = (st, key) => st.cards.find((c) => c && c.battle && c.parley === key);
// An answer as main.js gives it: the card off the queue, its choice resolved.
const choose = (st, c, label) => { const i = st.cards.indexOf(c); if (i >= 0) st.cards.splice(i, 1); const ch = c.choices.find((x) => x.label === label || x.label.startsWith(label)); if (!ch) throw new Error(`no ${label}: ${c.choices.map((x) => x.label).join(", ")}`); return ch.resolve(st); };
function sure(v, fn) { const O = PARLEY.ODDS, m = O.min, M = O.max; O.min = O.max = v; try { return fn(); } finally { O.min = m; O.max = M; } }
const hoverOn = (st, t) => { cui.hover = { x: t.x, y: t.y }; const h = UI.renderRaidCards(st); cui.hover = null; return h; };
const chipOf = (top, name) => { const m = new RegExp(`<span class="ct-group([^"]*)" data-tip="([^"]*)">(?:(?!</span><span class="ct-group).)*?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:(?!<span class="ct-group).)*`, "s").exec(top); return m ? { cls: m[1], tip: unesc(m[2]), html: m[0] } : null; };
const nextTurn = (st) => { const b = st.combat; for (const u of b.units) if (u.side === "player") u.ap = 0; C.endPlayerTurn(st); C.runEnemyPhase(st); };
const partyOf = (f, stance, n = 3) => ({ kind: "raiders", count: n, power: 4, name: `${f.name} scavengers`, factionId: f.id, ...(stance === "hostile" ? {} : { side: "neutral" }), parley: { stance, hostility: stance === "friendly" ? 15 : stance === "neutral" ? 40 : 80, treacherous: false } });
const raiders = (n = 3) => ({ kind: "raiders", count: n, power: 3.5, name: "rival scavengers", guard: true });

// ---------- 6. Allied ----------
console.log("Allied (the real sim): a green chip, its word, the badge, the hover");
{
  const st = world(131);
  const f = st.factions.find((x) => x.alive && !x.outsider);
  const { b, mine } = raid(st, [partyOf(f, "friendly", 3)]);
  const party = b.units.filter((x) => x.side === "third");
  check(inSight(b, mine[0], party, 3, 5), "(setup: their party in sight)");
  for (const x of mine.slice(1)) { x.x = mine[0].x; x.y = mine[0].y; x.off = true; }
  C.combatAct(st, { type: "callout", unit: mine[0].id, target: party[0].id });
  const c = cardOf(st, party[0].pk);
  check(!!c, "Call out raises their card");
  sure(1, () => choose(st, c, "Fight with us"));
  st.cards = st.cards.filter((x) => !(x && x.battle));
  const g = parleyStatus(b, party[0]);
  check(g && g.label === "Allied" && g.allied && g.color === "#4fe08a", `the sim: ${g && g.label} ${g && g.color}`);
  check(refresh(st) === "", "the map draws");
  check(drawn.includes("ALLIED"), "the badge: ALLIED");
  const top = UI.renderRaidTop(st), chip = chipOf(top, g.name.length > 1 ? g.name[0].toUpperCase() + g.name.slice(1) : g.name);
  check(chip && /allied/.test(chip.cls) && chip.html.includes("<b>ALLIED</b>") && chip.html.includes("#4fe08a"), `the chip: green, ALLIED (${chip ? chip.cls.trim() : "missing"})`);
  check(chip && /fight beside you: the dead and hostile groups/i.test(chip.tip), `its tip: "${chip ? chip.tip.slice(0, 120) : ""}…"`);
  const h = hoverOn(st, party[0]);
  check(h.includes("Allied") && h.includes("Fighting beside you") && !h.includes("Not hostile"), "the hover: Allied, fighting beside you");
  check(!/Something is off/.test(h) && !chip.html.includes('class="tell"'), "no tell for an honest group");
  st.combat = null; st.cards = [];
}

// ---------- 7. walking away ----------
console.log("A walk-away: the countdown on their ground, Leaving when they go");
{
  const st = world(81);
  const { b, mine } = raid(st, [raiders(2)]);
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  inSight(b, mine[0], pod, 6, 8);
  for (const x of mine.slice(1)) { x.x = mine[0].x; x.y = mine[0].y; x.off = true; }
  C.combatAct(st, { type: "callout", unit: mine[0].id, target: pod[0].id });
  sure(1, () => choose(st, cardOf(st, pod[0].pk), "Let's both walk away"));
  st.cards = st.cards.filter((x) => !(x && x.battle));
  const g = parleyStatus(b, pod[0]);
  check(g && g.goes === "you" && g.leaveBy === PARLEY.LEAVE_TURNS, `the sim: goes ${g && g.goes}, leaveBy ${g && g.leaveBy}`);
  check(refresh(st) === "", "the map draws");
  const n = g.leaveBy, want = `Leave their sight: ${n} turn${n === 1 ? "" : "s"}`;
  const top = UI.renderRaidTop(st);
  check(top.includes(want.toUpperCase()) && /ct-group leaving/.test(top), `the chip: ${want.toUpperCase()}`);
  check(hoverOn(st, pod[0]).includes(want), `the hover: ${want}`);
  nextTurn(st);
  st.cards = st.cards.filter((x) => !(x && x.battle));
  const g2 = parleyStatus(b, pod[0]);
  if (g2 && g2.leaveBy != null) { refresh(st); check(UI.renderRaidTop(st).includes(`LEAVE THEIR SIGHT: ${g2.leaveBy} TURN`), `a turn on: ${g2.leaveBy} left`); }
  else check(true, `a turn on: ${g2 ? g2.label : "gone"}`);
  st.combat = null; st.cards = [];
  // A party on the move: they go.
  const st2 = world(82);
  const f = st2.factions.find((x) => x.alive && !x.outsider);
  const R2 = raid(st2, [partyOf(f, "neutral", 2)]);
  const party = R2.b.units.filter((x) => x.side === "third");
  inSight(R2.b, R2.mine[0], party, 4, 7);
  C.combatAct(st2, { type: "callout", unit: R2.mine[0].id, target: party[0].id });
  sure(1, () => choose(st2, cardOf(st2, party[0].pk), "Let's both walk away"));
  st2.cards = st2.cards.filter((x) => !(x && x.battle));
  const g3 = parleyStatus(R2.b, party[0]);
  refresh(st2);
  const top2 = UI.renderRaidTop(st2);
  check(g3 && g3.goes === "them" && g3.leaveBy == null && top2.includes("<b>LEAVING</b>") && !top2.includes("LEAVE THEIR SIGHT"), "a party: the chip says LEAVING, no countdown");
  const h3 = hoverOn(st2, party[0]);
  check(/Leaving/.test(h3) && !/Leave their sight/.test(h3), "the hover: Leaving");
  st2.combat = null; st2.cards = [];
}

// ---------- 8. tells ----------
console.log("A tell: the amber ! and the hover line only when parleyStatus.tell says so");
function treacherous(seed, suspect) {
  const st = world(seed);
  const { b, mine } = raid(st, [raiders(3)]);
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  const rec = b.parley.groups.find((g) => g.key === pod[0].pk);
  Object.assign(rec, { treacherous: true, lie: PARLEY.LIE, stance: "hostile", hostility: 85 }); // the test's setup: a treacherous group
  for (const x of mine.slice(1)) { x.x = mine[0].x; x.y = mine[0].y; x.off = true; }
  inSight(b, mine[0], pod, 9, 11);
  const S = PARLEY.SUSPECT, m = S.min, M = S.max;
  S.min = S.max = suspect;
  const out = { st, b, pod, modal: "", told: false, top: "", hover: "", bang: false, offAny: false, tellAny: false };
  try {
    C.combatAct(st, { type: "callout", unit: mine[0].id, target: pod[0].id });
    const cd = cardOf(st, pod[0].pk);
    out.modal = UIM.renderModal(st, { started: true });
    sure(1, () => choose(st, cd, "Hold your fire"));
    st.cards = st.cards.filter((x) => !(x && x.battle));
    for (let i = 0; i < 6 && !b.over && pod.every((x) => x.side === "third"); i++) {
      for (const x of b.units) if (x.side === "player") x.ap = 0;
      C.endPlayerTurn(st);
      if (pod.some((x) => x.side === "enemy")) break;
      C.runEnemyPhase(st);
      st.cards = st.cards.filter((x) => !(x && x.battle));
      const t = pod.find((x) => C.activeAny(x) && parleyStatus(b, x));
      if (!t) break;
      const g = parleyStatus(b, t);
      refresh(st);
      const top = UI.renderRaidTop(st), hover = hoverOn(st, t);
      // the badge's ! over their people: drawn texts of this frame ("!" also marks the downed and the surprised: none here)
      const bang = drawn.includes("!") && !b.units.some((x) => (x.down && !x.dead) || x.surprised);
      out.offAny = out.offAny || /Something is off/.test(hover) || top.includes('class="tell"') || bang;
      out.tellAny = out.tellAny || g.tell;
      if (g.tell && !out.told) Object.assign(out, { told: true, top, hover, bang, label: g.label });
      if (!g.tell && (/Something is off/.test(hover) || top.includes('class="tell"'))) out.leak = true;
    }
  } finally { S.min = m; S.max = M; }
  return out;
}
{
  const seen = treacherous(151, 1), unseen = treacherous(151, 0);
  check(seen.told, `seen through: parleyStatus.tell comes up in the truce (${seen.label || "never"})`);
  check(seen.told && seen.top.includes('<em class="tell">!</em>') && /data-tip="[^"]*Something is off about them/.test(seen.top), "the chip: the amber ! and the tip says something is off");
  check(seen.told && /Something is off about them\./.test(seen.hover), "the hover: Something is off about them.");
  check(seen.told && seen.bang, "the badge: the amber !");
  check(!seen.leak, "nothing shown on a turn without the tell");
  check(!unseen.tellAny && !unseen.offAny, "nobody saw through them: no !, no line, no tip (nothing leaks)");
  // The card: "Risky:" hints in amber when the speaker saw through them, none otherwise.
  check(/class="hint risky">Risky:/.test(seen.modal) && (seen.modal.match(/hint risky/g) || []).length >= 2, `seen through: the risky hints in amber (${(seen.modal.match(/hint risky/g) || []).length})`);
  check(!/hint risky/.test(unseen.modal), "not seen through: no amber hint");
  for (const o of [seen, unseen]) { o.st.combat = null; o.st.cards = []; }
}

// ---------- 9. who speaks ----------
console.log("The card's speaker switch: small buttons, the card's own choices");
{
  const st = world(141);
  const { b, mine } = raid(st, [raiders(2)]);
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  const [a, c2] = mine;
  survivorById(st, a.sid).skills.speech = 2; survivorById(st, c2.sid).skills.speech = 16;
  mine[2].x = a.x; mine[2].y = a.y; mine[2].off = true;
  inSight(b, a, pod, 3, 5);
  c2.x = a.x; c2.y = a.y + 1;
  if (!open(b, c2.x, c2.y)) c2.y = a.y - 1;
  faceToward(c2, pod[0].x, pod[0].y);
  C.combatAct(st, { type: "callout", unit: a.id, target: pod[0].id });
  let cd = cardOf(st, pod[0].pk);
  const fn = (u) => u.name.split(" ")[0];
  const li = cd.choices.findIndex((x) => x.label === `Let ${fn(c2)} speak`);
  check(li >= 0, `the sim offers Let ${fn(c2)} speak`);
  let html = UIM.renderModal(st, { started: true });
  const row = /<div class="speakers small">(.*?)<\/div>/s.exec(html);
  check(!!row && new RegExp(`<button class="spk" data-action="choice" data-i="${li}"[^>]*>${fn(c2)} <span class="muted">Speech \\d+</span></button>`).test(row[1]), "a small button for them, with their Speech, on the same choice index");
  const tiles = /<div class="choices">(.*)<\/div><\/div>/s.exec(html)[1];
  check(!/Let \S+ speak/.test(tiles) && (tiles.match(/data-action="choice"/g) || []).length === cd.choices.length - cd.choices.filter((x) => /^Let .+ speak$/.test(x.label)).length, "the answers below: every other choice, no speaker tile");
  const answers = cd.choices.filter((x) => !/^Let .+ speak$/.test(x.label)).length;
  check(html.includes(answers >= 6 ? '<div class="box many">' : '<div class="box">'), `${answers} answers: ${answers >= 6 ? "two columns" : "one"}`);
  // Clicked (main.js: the card off the queue, the choice at data-i resolved): the card again, the other speaking.
  st.cards.splice(st.cards.indexOf(cd), 1);
  cd.choices[li].resolve(st);
  cd = cardOf(st, pod[0].pk);
  html = UIM.renderModal(st, { started: true });
  check(cd && cd.speaker.id === c2.id && html.includes(`Speaking: ${c2.name}`) && new RegExp(`class="spk"[^>]*>${fn(a)} `).test(html), `${fn(c2)} speaks now; ${fn(a)} is the one offered`);
  // parleySpeak (the sim's own switch) keeps the same shape.
  check(P.parleySpeak(st, pod[0].pk, a.id) === "" && /class="spk"/.test(UIM.renderModal(st, { started: true })), "parleySpeak: the row is there again");
  st.combat = null; st.cards = [];
}

// ---------- 10. the shout, and outside raids ----------
console.log("The Call out tip's shout; no group status outside raids");
{
  const st = world(141);
  const { b, mine } = raid(st, [raiders(2)]);
  const pod = b.units.filter((x) => x.side === "enemy" && x.kind === "human");
  inSight(b, mine[0], pod, 3, 5);
  refresh(st);
  const btn = barBtn(st, "callout");
  const cost = typeof P.shoutCost === "function" ? P.shoutCost(st, b) : null;
  const r = cost && cost.radius != null ? cost.radius : PARLEY.SHOUT;
  check(btn && btn.tip.includes(`heard ${r} tiles off`) && (!cost || /risk/.test(btn.tip)), `the tip: heard ${r} tiles off${cost ? ` (shoutCost: ${cost.risk})` : " (no shoutCost yet: PARLEY.SHOUT)"}`);
  st.combat = null;
  const fld = fresh(63, "field-town");
  check(fld.b.units.every((x) => parleyStatus(fld.b, x) === null), "a field fight: nobody has a group status");
  check(draw(fld.st) === "", "it draws");
  fld.st.combat = null;
}

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
