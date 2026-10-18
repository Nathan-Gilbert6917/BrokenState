// The battle's bottom bar (ui/battlebar.js, ui/combat.js unitOrders and renderCombatBar) on stub canvases:
// - Ready only by default: no greyed order on the bar, the All button counting the hidden ones. With All on, every
//   battle order of the key table (the Battle orders with a v, the inventory, the view cones) has a button: shown when it
//   applies, greyed with the reason when it cannot be given now, the rest greyed with when they apply.
// - Trays: a long list keeps its PRIMARY orders on the bar and each group's others behind its tray button (never one
//   alone in a tray); a short list has no trays; a tray opens and closes, Esc closes it, an order given from it too.
// - Each button shows its key as bound now (a rebound key shows at once), its cost, and when greyed why: the sim's own
//   refusals (no ammo, the magazine is full, not facing the body, no light carried, no actions left, on foot …).
// - A button and its key run the same code: each pressed on one of two identical battles leaves them the same.
// - The turn controls (End turn, Sound the retreat, AI plays my side, Auto-resolve, Restart battle), the turn and the
//   weapon on the right; the enemy's turn and the AI playing your side say so instead of orders; the selected one's card
//   (actions left as pips, facing, sneaking, the light) and a tab for everyone of yours.
// Usage: node tools/battlebartest.js
import { battles } from "./isobattles.js";
import * as C from "../src/sim/combat.js";
import { faceToward } from "../src/sim/vision.js";
import { bodiesNear } from "../src/sim/ground.js";

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
const BAR = await import("../src/ui/battlebar.js");
const KM = await import("../src/ui/keymap.js");
ISO.setIsoCanvas(cvs);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
const cui = UI.cui;
const draw = (st) => { try { UI.drawCombat(st, 1e9); return ""; } catch (e) { return e.stack.split("\n").slice(0, 2).join(" "); } };
const plainText = (h) => String(h).replace(/<[^>]+>[^<]*<\/i>/g, "").replace(/<[^>]+>/g, "").trim();
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// The bar's buttons: { action, v, k, id, disabled, tip, key, cost, text }.
function buttons(html) {
  const out = [];
  for (const m of html.matchAll(/<button class="([^"]*)" data-action="([^"]+)"((?: data-[a-z]+="[^"]*")*) (disabled)? ?data-tip="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)) {
    const attrs = Object.fromEntries([...m[3].matchAll(/data-([a-z]+)="([^"]*)"/g)].map((a) => [a[1], unesc(a[2])]));
    const key = /<span class="key">([^<]*)<\/span>/.exec(m[6]);
    const cost = /<i class="bb-ap[^"]*">([^<]*)<\/i>/.exec(m[6]);
    out.push({ cls: m[1], action: m[2], ...attrs, disabled: !!m[4], tip: unesc(m[5]), key: key ? unesc(key[1]) : "", cost: cost ? cost[1] : "", text: m[6] });
  }
  return out;
}
// The order buttons on the bar itself (not the tray and All buttons), and with every tray opened in turn.
const isOrder = (x) => /\bbb-btn\b/.test(x.cls) && !/\bbb-(traybtn|allbtn)\b/.test(x.cls);
const trayBtns = (st) => buttons(UI.renderCombatBar(st)).filter((x) => /\bbb-traybtn\b/.test(x.cls));
const mainBtns = (st) => { const was = cui.barTray; cui.barTray = null; const r = buttons(UI.renderCombatBar(st)).filter(isOrder); cui.barTray = was; return r; };
function barBtns(st) {
  const was = cui.barTray, out = mainBtns(st);
  for (const t of trayBtns(st)) { cui.barTray = Number(t.g); out.push(...buttons(UI.renderCombatBar(st)).filter((x) => isOrder(x) && x.tray)); }
  cui.barTray = was;
  return out;
}
const order = (st, v) => barBtns(st).find((x) => (x.action === "cb-act" ? x.v : x.action === "cb-inv" ? "inventory" : x.action === "cb-view" ? x.v : "") === v);
// all: the bar shows the greyed orders too (the reasons are read off them).
const fresh = (seed = 51, name = "field-town", all = true) => {
  const { st, b } = battles(seed, [name])[0];
  draw(st); // a new battle: the screen picks its first unit
  const u = b.units.find((x) => x.side === "player" && x.vol == null && C.active(x) && x.sid != null);
  cui.sel = u.id; cui.mode = "move"; cui.msg = ""; cui.barAll = all; cui.barTray = null;
  return { st, b, u };
};
const vOf = (k) => (k.v ? k.v : k.id === "battle.inventory" ? "inventory" : "cones");

// ---------- 1. ready only; with All, every battle order of the key table has a button ----------
console.log("Ready only by default; with All, every battle order in the key table has a button");
{
  check(BAR.BAR_KEYS.length >= 40 && BAR.BAR_KEYS.some((k) => k.id === "battle.light") && BAR.BAR_KEYS.some((k) => k.id === "bview.cones"), `the bar's list is the key table's battle orders (${BAR.BAR_KEYS.length})`);
  for (const name of ["field-town", "raid", "raid-building"]) {
    const { st } = fresh(52, name, false);
    const ready = barBtns(st);
    const allBtn = buttons(UI.renderCombatBar(st)).find((x) => /\bbb-allbtn\b/.test(x.cls));
    check(ready.length && ready.every((x) => !x.disabled || /\bactive\b/.test(x.cls)), `${name}: ready only, no greyed order on the bar or in its trays (${ready.length} orders: ${ready.map((x) => x.v || x.action).join(" ")})`);
    check(allBtn && /\+\d+/.test(allBtn.text) && !/\bactive\b/.test(allBtn.cls), `${name}: the All button counts the hidden ones (${allBtn ? /\+\d+/.exec(allBtn.text) : "none"})`);
    cui.barAll = true;
    const all = barBtns(st);
    const has = new Set(all.map((x) => (x.action === "cb-act" ? x.v : x.action === "cb-inv" ? "inventory" : x.v)));
    const missing = BAR.BAR_KEYS.map(vOf).filter((v) => !has.has(v));
    check(!missing.length, `${name}: with All, a button for each of the ${BAR.BAR_KEYS.length} (${missing.length ? `missing ${missing.join(", ")}` : "none missing"})`);
    const core = BAR.CORE.filter((v) => !has.has(v));
    check(!core.length && has.has("inventory") && has.has("cones"), `${name}: the core orders, Inventory and Cones there with All (${core.length ? `missing ${core.join(", ")}` : "all there"})`);
    const greyNoWhy = all.filter((x) => x.disabled && !/\nNot now: \S/.test(x.tip));
    check(!greyNoWhy.length, `${name}: every greyed button says why (${greyNoWhy.map((x) => x.v).join(", ") || "all do"})`);
    const keyed = BAR.BAR_KEYS.filter((k) => all.some((x) => (x.v === vOf(k) || (k.id === "battle.inventory" && x.action === "cb-inv")) && x.key === KM.keyLabel(k.id, 1).replace(/Shift\+/g, "⇧").replace(/Ctrl\+/g, "Ctrl ")));
    check(keyed.length >= BAR.BAR_KEYS.length - 2, `${name}: the buttons show the keys bound now (${keyed.length} of ${BAR.BAR_KEYS.length})`);
    // Trays: the PRIMARY orders and the view ones stand on the bar, every tray holds two or more.
    const trays = trayBtns(st), main = mainBtns(st);
    const sizes = trays.map((t) => { cui.barTray = Number(t.g); const n = buttons(UI.renderCombatBar(st)).filter((x) => isOrder(x) && x.tray); cui.barTray = null; return n; });
    check(trays.length && sizes.every((n) => n.length >= 2) && !sizes.flat().some((x) => (BAR.PRIMARY.has(x.v) && (!x.disabled || BAR.CORE.includes(x.v))) || x.action !== "cb-act"), `${name}: ${trays.length} trays (${trays.map((t, i) => `${plainText(t.text)} ${sizes[i].length}`).join(", ")}), none with one order, no ready primary, core or view order in one`);
    check(main.some((x) => x.v === "move") && main.some((x) => x.v === "shoot") && main.some((x) => x.action === "cb-inv") && main.length + trays.length < all.length / 2, `${name}: Move, Shoot and Inventory on the bar itself, ${main.length} orders and ${trays.length} trays there (${all.length} with the trays' orders): ${main.map((x) => x.v || "inventory").join(" ")}`);
    cui.barAll = false;
    st.combat = null;
  }
  // A short list: everything on the bar, no trays.
  {
    const { st, b, u } = fresh(53, "field-town", false);
    for (const p of b.units) if (p.side === "player") p.ap = 0;
    cui.sel = u.id;
    const main = mainBtns(st);
    check(!trayBtns(st).length && main.every((x) => !x.disabled), `no actions left, ready only: ${main.length} free orders, all on the bar, no tray (${main.map((x) => x.v).join(" ")})`);
    for (const p of b.units) if (p.side === "player") p.ap = 2;
  }
  // A rebound key shows on its button at once.
  const { st } = fresh(53);
  KM.setBinding("battle.sneak", 0, "Alt+KeyJ");
  check(order(st, "sneak").key === "Alt+J", `Sneak rebound to Alt+J: its button says ${order(st, "sneak").key}`);
  KM.resetBinding("battle.sneak");
  check(order(st, "sneak").key === "⇧Z", "back to ⇧Z with the default");
}

// ---------- 2. greyed with the sim's reason ----------
console.log("Greyed with the reason, from the sim's own refusals");
{
  const { st, b, u } = fresh(54);
  // A full magazine: Reload says so (sim/combat.js reloadRefusal).
  const gunner = b.units.find((x) => x.side === "player" && C.active(x) && C.hasMag(x));
  if (gunner) {
    cui.sel = gunner.id;
    const why = C.reloadRefusal(b, gunner), kinds = UI.ammoToHand(st, b, gunner).length; // more than one kind to hand: Reload can swap the kind
    const r = order(st, "reload");
    check(r && (why && kinds < 2 ? r.disabled && r.tip.includes(why) : !r.disabled), `Reload with ${C.magLabel(b, gunner)}: ${why && kinds < 2 ? `greyed, "${why}"` : `ready${why ? ` (${kinds} kinds of round to hand)` : ""}`}`);
    // An empty gun with no rounds left: Shoot and Overwatch say what the sim says (fireRefusal).
    gunner.mag = 0;
    for (const p of b.pools || []) for (const k of Object.keys(p)) if (typeof p[k] === "number" && !/meds|arrows/.test(k)) p[k] = 0;
    const fw = C.fireRefusal(b, gunner);
    const s = order(st, "shoot"), o = order(st, "overwatch");
    check(!C.canFire(b, gunner) && s.disabled && o.disabled && (!fw || (s.tip.includes(fw) && o.tip.includes(fw))), `an empty gun: Shoot and Overwatch greyed with "${fw}"`);
  }
  cui.sel = u.id;
  // No enemy next to them: Melee greyed with why.
  const m = order(st, "melee");
  check(m.disabled && /No enemy right next to them/.test(m.tip), "Melee with nobody next to them: greyed, why");
  // No light carried: Light greyed, "No light carried"; with one: on and off, free.
  u.light = null; u.nvg = null;
  check(order(st, "light").disabled && /No light carried/.test(order(st, "light").tip) && order(st, "nvg").disabled && /No night vision/.test(order(st, "nvg").tip), "no light or goggles: Light and NVG greyed, saying so");
  u.light = "flashlight"; u.lightOff = true;
  const l = order(st, "light");
  check(!l.disabled && /Light on/.test(l.text) && l.cost === "free", "a flashlight: Light on, free");
  // No actions left: the orders that cost one are greyed, "No actions left"; the free switches are not. (Everyone out of
  // actions, or the screen picks someone who has some.)
  for (const p of b.units) if (p.side === "player") p.ap = 0;
  const mv = order(st, "move"), sh = order(st, "shoot"), li = order(st, "light"), fa = order(st, "face");
  check(mv.disabled && /No actions left/.test(mv.tip) && sh.disabled && !li.disabled && fa.disabled, "no actions left: Move and Shoot greyed (why: no actions left), Light still free; Face needs one left");
  for (const p of b.units) if (p.side === "player") p.ap = 2;
  cui.sel = u.id;
  // A body next to them: Search body greyed unless they face it (sim/vision.js facesBox, the sim's faceRefusal).
  const foe = b.units.find((x) => x.side === "enemy" && x.kind === "human");
  if (foe) {
    foe.dead = true; foe.hp = 0; foe.x = u.x + 1; foe.y = u.y; foe.f = u.f || 0;
    if (bodiesNear(b, u).some((t) => t.id === foe.id)) {
      faceToward(u, u.x - 1, u.y);
      const away = order(st, "search");
      faceToward(u, foe.x, foe.y);
      const at = order(st, "search");
      check(away.disabled && /Face the body to search it/.test(away.tip) && !at.disabled, "a body next to them: Search body greyed facing away (Face the body), ready facing it");
    } else check(false, "a body next to them to search");
  }
  // On foot: Vehicle greyed, "You came on foot".
  const v = order(st, "vehicle");
  check(v.disabled && (b.vehicle ? true : /on foot/.test(v.tip)), `Vehicle: ${b.vehicle ? "next to the car or not" : "greyed, on foot"}`);
  // The diamonds a hovered order would spend: Hunker (ends the turn) all, Move 1, Face none (styles.css lights them on the card).
  const raw = UI.renderCombatBar(st), sp = (v) => (new RegExp(`data-bv="${v}"( data-spend="([^"]*)")?>`).exec(raw) || [])[2] || "";
  check(sp("hunker") === "all" && sp("move") === "1" && sp("face") === "" && /<i class=on data-s=1><\/i>/.test(raw), `hovering spends: Hunker ${sp("hunker")}, Move ${sp("move")}, Face ${sp("face") || "none"}; the card's diamonds numbered from the last`);
  // A jammed gun: Unjam pulses (urgent); nothing else does.
  const jg = b.units.find((x) => x.side === "player" && C.active(x) && C.isRanged && C.isRanged(x)) || b.units.find((x) => x.side === "player" && C.active(x) && C.hasMag(x));
  if (jg) {
    cui.sel = jg.id; jg.jam = { kind: "stovepipe" };
    const uj = barBtns(st).find((x) => x.v === "unjam");
    check(uj && /\burgent\b/.test(uj.cls) && barBtns(st).filter((x) => /\burgent\b/.test(x.cls)).length === 1, `a jammed gun: Unjam on the bar, pulsing (${uj ? uj.cls : "no button"})`);
    jg.jam = null; cui.sel = u.id;
  }
  // Costs: Shoot ends the turn, Move 1–2, Search 1.
  check(order(st, "shoot").cost === "end" && order(st, "move").cost === "1–2" && order(st, "face").cost === "free", "costs: Shoot end, Move 1–2, Face free");
}

// ---------- 3. a button and its key run the same code ----------
console.log("A button and its key do the same");
{
  const chordEvent = (c) => { const p = c.split("+"), code = p.pop(); return { code, shiftKey: p.includes("Shift"), altKey: p.includes("Alt"), ctrlKey: p.includes("Ctrl"), metaKey: p.includes("Meta"), preventDefault() {} }; };
  const snap = (b, u) => JSON.stringify({ sneak: !!u.sneaking, lightOff: !!u.lightOff, nvgOff: !!u.nvgOff, ap: u.ap, mode: cui.mode, cones: cui.cones, inv: cui.invReq === u.sid, ow: !!u.ow, hunk: !!u.hunker, rev: b.rev, log: b.log.length, msg: cui.msg });
  const cases = [["sneak", "battle.sneak"], ["face", "battle.face"], ["light", "battle.light"], ["nvg", "battle.nvg"], ["overwatch", "battle.overwatch"], ["shoot", "battle.shoot"], ["hunker", "battle.hunker"], ["throw", "battle.throw"], ["meds", "battle.meds"], ["inventory", "battle.inventory"], ["cones", "bview.cones"]];
  let same = 0;
  for (const [v, id] of cases) {
    const runs = [];
    for (const how of ["button", "key"]) {
      const { st, b, u } = fresh(55);
      u.light = "flashlight"; u.lightOff = true; u.nvg = "nvg"; u.nvgOff = true;
      cui.cones = false; cui.invReq = null;
      if (how === "button") {
        const x = order(st, v);
        if (!x) { runs.push("no button"); continue; }
        const d = { v: x.v, k: x.k, id: x.id, tray: x.tray };
        UI.combatAction(st, x.action, d);
      } else UI.combatKey(st, chordEvent(KM.keysOf(id)[0]));
      runs.push(snap(b, u));
    }
    const ok = runs[0] === runs[1] && runs[0] !== "no button";
    if (ok) same++;
    else console.log(`    ${v}: button ${runs[0]} / key ${runs[1]}`);
  }
  check(same === cases.length, `${same} of ${cases.length} orders: the button and the key leave the battle the same`);
  cui.cones = false; cui.invReq = null;
}

// ---------- 4. the card, the tabs, the turn controls, the phases ----------
console.log("The card, the tabs, the turn controls");
{
  const { st, b, u } = fresh(56);
  let html = UI.renderCombatBar(st);
  const team = b.units.filter((x) => x.side === "player" && x.vol == null);
  check((html.match(/class="bb-tab[^"]*" data-action="cb-sel"/g) || []).length === team.length, `a tab for each of yours (${team.length})`);
  check(new RegExp(`class="bb-tab on" data-action="cb-sel" data-id="${u.id}"`).test(html), "the selected one's tab is marked");
  check(html.includes(`<b>${u.name}</b>`) && /<b>2<\/b><span class="muted"> actions left/.test(html) && /<i class=on data-s=2><\/i><i class=on data-s=1><\/i>/.test(html), "the card: the name, 2 actions left as pips (numbered from the last)");
  u.sneaking = true; u.light = "flashlight"; u.lightOff = false; faceToward(u, u.x, u.y - 1);
  html = UI.renderCombatBar(st);
  check(/>SNEAK</.test(html) && />FACING N</.test(html) && />LIGHT ON</.test(html), "the card's chips: sneaking, facing north (N), the light on");
  u.sneaking = false;
  const ctl = buttons(html).filter((x) => /\bbb-ctl\b/.test(x.cls));
  const acts = ctl.map((x) => x.action);
  check(acts.includes("cb-end") && acts.includes("cb-retreat") && acts.includes("cb-autoplay") && acts.includes("cb-auto"), `turn controls: ${ctl.map((x) => x.action).join(", ")}`);
  check(ctl.find((x) => x.action === "cb-retreat").key === KM.keyLabel("battle.retreatAll", 1).replace("Shift+", "⇧") && /Turn <b>1<\/b>/.test(html), "Sound the retreat shows its key; the turn number");
  check(/class="bb-weapon"/.test(html), "the selected one's weapon by the controls");
  // A team member done for the turn: greyed tab.
  const mate = team.find((x) => x.id !== u.id);
  mate.ap = 0;
  check(new RegExp(`class="bb-tab done" data-action="cb-sel" data-id="${mate.id}"`).test(UI.renderCombatBar(st)), "someone with no actions left: their tab greyed");
  // Clicking a tab selects them.
  UI.combatAction(st, "cb-sel", { id: String(mate.id), center: "1" });
  check(cui.sel === mate.id, "a tab selects its person");
  // End turn: asks first while actions are left; the question sits over the controls.
  cui.sel = u.id;
  UI.combatAction(st, "cb-end", {});
  html = UI.renderCombatBar(st);
  check(/class="bb-ask"/.test(html) && /still ha(s|ve) actions/.test(html) && b.phase === "player", "End turn with actions left: the question over the controls");
  UI.combatAction(st, "cb-end", {});
  check(b.phase !== "player" || b.turn > 1, "again: the turn ends");
  html = UI.renderCombatBar(st);
  check(b.phase !== "enemy" || (/Enemy turn: watch the map/.test(html) && /data-action="cb-end" disabled/.test(html) && !/data-v="shoot"/.test(html)), "the enemy's turn: no orders, End turn greyed");
  // The AI plays your side: the bar says so, the button says Take back control.
  const f = fresh(57);
  UI.combatAction(f.st, "cb-autoplay", {});
  html = UI.renderCombatBar(f.st);
  check(/The AI is playing your side/.test(html) && /Take back control/.test(html) && /data-action="cb-end" disabled/.test(html), "the AI playing: said so, Take back control, End turn greyed");
  UI.combatAction(f.st, "cb-autoplay", {});
  // Sound the retreat: its question over the controls, with each one's odds.
  UI.combatAction(f.st, "cb-retreat", { v: "ask" });
  html = UI.renderCombatBar(f.st);
  check(!C.retreatRefusal(f.b) ? /class="bb-ask"><div class="small cbmsg cbconfirm cbretreat">/.test(html) : true, "Sound the retreat: the odds over the controls");
  UI.combatAction(f.st, "cb-retreat", { v: "cancel" });
  // All: on and off.
  cui.barAll = false;
  const nReady = barBtns(f.st).length;
  UI.combatAction(f.st, "cb-bar", { v: "all" });
  const nAll = barBtns(f.st).length;
  check(cui.barAll && nAll > nReady && barBtns(f.st).some((x) => x.disabled) && /Ready only/.test(UI.renderCombatBar(f.st)), `All shows the greyed orders too (${nReady} → ${nAll}), its button now Ready only`);
  UI.combatAction(f.st, "cb-bar", { v: "all" });
  check(!cui.barAll && barBtns(f.st).length === nReady, "and Ready only hides them again");
  // A tray: opens, closes; Esc closes it; an order given from it closes it.
  cui.barAll = true;
  const t = trayBtns(f.st)[0];
  UI.combatAction(f.st, "cb-bar", { v: "tray", g: t.g });
  html = UI.renderCombatBar(f.st);
  check(cui.barTray === Number(t.g) && /class="bb-tray"/.test(html), `the ${plainText(t.text)} tray opens over the bar`);
  UI.combatAction(f.st, "cb-bar", { v: "tray", g: t.g });
  check(cui.barTray == null && !/class="bb-tray"/.test(UI.renderCombatBar(f.st)), "pressed again, it closes");
  UI.combatAction(f.st, "cb-bar", { v: "tray", g: t.g });
  UI.combatKey(f.st, { code: "Escape", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
  check(cui.barTray == null && cui.mode === "move", "Esc closes it (and only it)");
  UI.combatAction(f.st, "cb-bar", { v: "tray", g: t.g });
  const inTray = buttons(UI.renderCombatBar(f.st)).find((x) => isOrder(x) && x.tray);
  UI.combatAction(f.st, inTray.action, { v: inTray.v, k: inTray.k, id: inTray.id, tray: inTray.tray });
  check(cui.barTray == null, `an order given from it (${inTray.v}) closes it`);
  // The panel keeps none of the controls (no duplicates): the orders and the turn buttons are the bar's.
  const panel = UI.renderCombatPanel(f.st);
  check(!/data-action="cb-act" data-v="(shoot|move|reload)"/.test(panel) && !/data-action="cb-end"/.test(panel) && !/data-action="cb-autoplay"/.test(panel) && !/data-action="cb-inv"/.test(panel), "the side panel has no order or turn buttons left (they are the bar's)");
  check(draw(f.st) === "", "drawn with the bar's inset");
  f.st.combat = null;
}

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
