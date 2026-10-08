// Battle screen conveniences (ui/combat.js, ui/isoview.js) on stub canvases:
// - AI plays my side (cb-autoplay, Shift+A): your turns played by the AI at the enemy turn's pace until you take back
//   control; End turn greyed while it plays; a new battle starts in your hands.
// - The threat preview (threatAt): every enemy you see that could shoot a tile (with the odds a shot of theirs would
//   have against the selected unit standing there, as shotOdds gives) or walk up and strike it; enemies you do not
//   see are never counted; the panel's line; the lines drawn with no NaN.
// - The ground painted once per battle in map space (turning the view does not repaint it) and the fog from a
//   one-pixel-a-tile mask, on every layout with no NaN; the Restart battle button only with a battle-start save, never
//   in Ironman.
// Usage: node tools/battleuitest.js
import { battles } from "./isobattles.js";
import * as C from "../src/sim/combat.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
let nan = 0;
const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, {
  get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
  set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
});
const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
ISO.setIsoCanvas(cvs);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
UI.setBattleView("iso");
const draw = (st) => { try { UI.drawCombat(st, 1e9); return ""; } catch (e) { return e.stack.split("\n").slice(0, 2).join(" "); } };
const cui = UI.cui;
const seenSet = (b) => new Set(b.units.filter((e) => e.side !== "player" && C.active(e) && C.playerSees(b, e)).map((e) => e.id));

// ---------- 1. AI plays my side ----------
console.log("AI plays my side");
{
  const { st, b } = battles(21, ["field-town"])[0];
  draw(st);
  check(!cui.autoPlay, "a battle starts in your hands");
  check(/data-action="cb-autoplay"[^>]*>🤖 AI plays my side/.test(UI.renderCombatPanel(st)), "the panel has AI plays my side");
  UI.combatAction(st, "cb-autoplay", {});
  check(cui.autoPlay && /Take back control/.test(UI.renderCombatPanel(st)) && /data-action="cb-end" disabled/.test(UI.renderCombatPanel(st)), "on: Take back control, End turn greyed");
  const turn0 = b.turn;
  let t = 1e6, guard = 0;
  while (!b.over && b.turn < turn0 + 3 && guard++ < 2000) { t += 500; UI.combatTick(st, t); }
  check(b.over || b.turn >= turn0 + 3, `it plays your turns and the enemy's (turn ${turn0} → ${b.turn}${b.over ? `, ${b.result.outcome}` : ""})`);
  check(b.log.some((l) => /^(\w+ \w+) (shoots|strikes|lunges|moves|patches|reacts)/.test(l.text) && !/^(Raider|Zombie)/.test(l.text)), "your people acted");
  if (!b.over) {
    UI.combatAction(st, "cb-autoplay", {});
    while (b.phase !== "player" && guard++ < 4000) { t += 500; UI.combatTick(st, t); }
    const turn1 = b.turn;
    for (let i = 0; i < 10; i++) { t += 500; UI.combatTick(st, t); }
    check(!cui.autoPlay && b.phase === "player" && b.turn === turn1, "off: your turn waits for you again");
  }
  UI.combatKey(st, { code: "KeyA", shiftKey: true, preventDefault() {} });
  check(cui.autoPlay || b.over, "Shift+A switches it on");
  const next = battles(22, ["field-forest"])[0];
  draw(next.st);
  check(!cui.autoPlay, "the next battle starts in your hands again");
  // A whole battle on it ends.
  UI.combatAction(next.st, "cb-autoplay", {});
  guard = 0;
  while (!next.b.over && guard++ < 6000) { t += 500; UI.combatTick(next.st, t); }
  check(next.b.over, `a whole battle played by it ends (${next.b.over ? next.b.result.outcome : "still going"} on turn ${next.b.turn})`);
}

// ---------- 2. the threat preview ----------
console.log("The threat preview");
{
  let compared = 0, mismatch = 0, unseenLeak = 0, blows = 0, shots = 0, tiles = 0;
  for (const seed of [31, 32, 33]) for (const name of ["field-town", "field-city", "field-forest"]) {
    const { st, b } = battles(seed, [name])[0];
    // Close in: a few turns of both sides so the enemy is in sight.
    for (let i = 0; i < 2 && !b.over; i++) { C.autoPlayerTurn(st); if (!b.over) C.runEnemyPhase(st); }
    if (b.over || b.phase !== "player") continue;
    const u = b.units.find((x) => x.side === "player" && C.active(x));
    const seen = seenSet(b);
    const v = { key: `t${seed}${name}`, seen, u };
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      if (C.unitAt(b, x, y) && !(x === u.x && y === u.y)) continue;
      const list = UI.threatAt(b, v, x, y);
      tiles++;
      for (const T of list) {
        if (!seen.has(T.e.id)) unseenLeak++;
        if (T.blow) blows++;
        if (T.shot != null) {
          shots++;
          compared++;
          if (T.shot !== C.shotOdds(b, T.e, { ...u, x, y, hunker: false }).chance || !C.canSeeAt(b, T.e, x, y)) mismatch++;
        }
      }
    }
    // Hovering a threatened tile: the panel line and the drawing.
    let hx = -1, hy = -1;
    for (let i = 0; i < b.w * b.h && hx < 0; i++) { const x = i % b.w, y = (i / b.w) | 0; if (!C.unitAt(b, x, y) && C.CELL[b.cells[i].k].walk && UI.threatAt(b, v, x, y).length) { hx = x; hy = y; } }
    if (hx >= 0) {
      draw(st); // the screen meets this battle first (a new battle clears the hover and the selection)
      cui.sel = u.id;
      cui.hover = { x: hx, y: hy, px: 400, py: 300 };
      const n0 = nan, err = draw(st);
      const html = UI.renderCombatPanel(st);
      if (err || nan !== n0) console.log(`  (${name} ${seed}: ${err || "NaN in the threat lines"})`);
      check(!err && nan === n0 && /Threat<\/b> \(enemies you see/.test(html), `${name} ${seed}: hovering a threatened tile shows the threat line and draws its lines`);
      cui.hover = null;
    }
  }
  check(tiles > 1000 && shots > 0 && blows > 0, `tiles checked ${tiles}, threats by gun ${shots}, by a walk and a blow ${blows}`);
  check(!mismatch, `every gun threat is a tile the enemy sees, at the odds its shot would have (${compared} compared, ${mismatch} off)`);
  check(!unseenLeak, "an enemy you do not see is never counted");
  const { st, b } = battles(34, ["field-town"])[0];
  const v = { key: "none", seen: new Set(), u: b.units.find((x) => x.side === "player") };
  check(b.units.every((p) => UI.threatAt(b, v, p.x, p.y).length === 0), "with nobody in sight: no threat anywhere");
  b.phase = "enemy";
  check(UI.threatAt(b, { ...v, key: "e", seen: seenSet(b) }, 5, 5).length === 0, "not in the enemy's turn");
}

// ---------- 3. the ground, the fog, Restart battle ----------
console.log("Ground, fog and Restart battle");
{
  for (const { name, st, b } of battles(41)) {
    const n0 = nan, g0 = ISO.iso.builds.ground;
    let err = draw(st);
    const built = ISO.iso.builds.ground - g0;
    for (let r = 0; r < 4 && !err; r++) { ISO.isoRotate(b, 1); err = draw(st); }
    const rebuilt = ISO.iso.builds.ground - g0 - built;
    check(!err && nan === n0 && built <= 1 && (b.floors && b.floors.length > 1 ? true : rebuilt === 0), `${name}: drawn in all four turns of the view with no NaN, the ground painted ${built}× and not again on turning${err ? ` (${err})` : ""}`);
  }
  const { st, b } = battles(42, ["field-forest"])[0];
  draw(st);
  check(!/set-battlereload/.test(UI.renderCombatPanel(st)), "no Restart battle without a battle-start save");
  b.saveKey = "k"; b.saveOk = true;
  check(/data-action="set-battlereload"/.test(UI.renderCombatPanel(st)), "Restart battle with one");
  st.ironman = { id: "ironX" };
  check(!/set-battlereload/.test(UI.renderCombatPanel(st)), "never in Ironman");
}

// ---------- 4. the weapons overhaul's gun orders (ui/combat.js gunButtons, gunOrder, aimArea, ammoChooser) ----------
// On today's sim the acts are unknown: the buttons send them and show the refusal; each shows only with the capability.
console.log("Gun orders: fire mode, unjam, suppress, throw spear, the ammo chooser, the enemy line");
{
  const { GEAR } = await import("../src/sim/data.js");
  const { ammoBoxes, CALIBERS, AMMO_TYPES } = await import("../src/sim/data-ammo.js");
  let found = null;
  for (const seed of [51, 52, 53, 54, 55, 56, 57]) {
    const { st, b } = battles(seed, ["field-town"])[0];
    for (let i = 0; i < 3 && !b.over && !b.units.some((e) => e.side === "enemy" && C.active(e) && C.playerSees(b, e)); i++) { C.autoPlayerTurn(st); if (!b.over) C.runEnemyPhase(st); }
    const u = b.units.find((x) => x.side === "player" && C.active(x) && C.isRanged(x) && C.WEAPONS[x.weapon].cal && x.sid != null);
    const e = b.units.find((x) => x.side === "enemy" && C.active(x) && C.playerSees(b, x));
    if (!b.over && b.phase === "player" && u && e) { found = { st, b, u, e }; break; }
  }
  check(!!found, "a battle with a gun on your side and an enemy in sight");
  if (found) {
    const { st, b, u, e } = found;
    const key = (code) => ({ code, shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {} });
    cui.sel = u.id; cui.mode = "move"; cui.msg = "";
    u.ap = 2;
    let html = UI.renderCombatPanel(st);
    check(!/data-v="(firemode|unjam|suppress|throwspear)"/.test(html), "a plain gun on today's sim: no fire mode, unjam, suppress or spear buttons");
    check(/reacts to every enemy that moves in range until your next turn or the magazine runs dry/i.test(html), "the Overwatch tooltip: sustained");
    // Fire modes.
    u.modes = ["single", "burst", "auto"]; u.mode = "single";
    html = UI.renderCombatPanel(st);
    check(/data-v="firemode"[^>]*>Fire: Single/.test(html) && /data-v="suppress"/.test(html), "a gun with fire modes: Fire: Single and Suppress");
    // (the sim knows the act now, sim/gunfire.js: these faked modes are not the pistol's, so it refuses the burst)
    const { modeRefusal } = await import("../src/sim/gunfire.js");
    UI.combatAction(st, "cb-act", { v: "firemode" });
    check(cui.msg !== "Unknown action." && cui.msg === modeRefusal(u, "burst"), `Fire sends combatAct "firemode" and shows what the sim says (${cui.msg})`);
    cui.msg = "";
    UI.combatKey(st, key("KeyF"));
    check(cui.msg !== "Unknown action." && cui.msg === modeRefusal(u, "burst"), "Shift+F does the same");
    u.mode = "burst";
    html = UI.renderCombatPanel(st);
    check(/Fire: Burst/.test(html) && /\[Burst\]/.test(html), "the button and the unit's line follow u.mode");
    // Unjam.
    u.jam = { kind: "stovepipe", ap: 1 };
    html = UI.renderCombatPanel(st);
    check(/data-v="unjam"/.test(html) && /JAMMED/.test(html), "a jam: the Unjam button and a JAMMED badge");
    cui.msg = "";
    UI.combatKey(st, key("KeyJ"));
    check(cui.msg !== "Unknown action." && !u.jam && u.ap === 1, `Shift+J sends combatAct "unjam" (cleared, 1 action)${cui.msg ? ` [${cui.msg}]` : ""}`);
    delete u.jam;
    check(!/data-v="unjam"/.test(UI.renderCombatPanel(st)), "no jam, no Unjam");
    // Suppress: a targeting mode with its cone.
    UI.combatAction(st, "cb-act", { v: "suppress" });
    check(cui.mode === "suppress", "Suppress: a targeting mode");
    cui.hover = { x: e.x, y: e.y, px: 400, py: 300 };
    const vis = C.playerVision(b);
    const band = UI.aimArea(b, u, vis, cui.hover, "suppress");
    check(band[e.y * b.w + e.x] === 2 && band.some((v) => v === 1) && band.every((v, i) => !v || vis[i]), "the cone: the target cell and the seen cells around the line of fire");
    const far = band.findIndex((v, i) => v && Math.hypot((i % b.w) - u.x, ((i / b.w) | 0) - u.y) > Math.hypot(e.x - u.x, e.y - u.y) + 2.01);
    check(far < 0, "no farther than 2 tiles past the target");
    check(/<b>Suppress<\/b>/.test(UI.renderCombatPanel(st)), "the hover line counts who in the cone keeps their head down");
    for (const v of ["top", "iso"]) { UI.setBattleView(v); const n0 = nan; const err = draw(st); check(!err && nan === n0, `the cone drawn in the ${v} view, no NaN${err ? ` (${err})` : ""}`); }
    UI.combatAction(st, "cb-act", { v: "suppress" });
    check(cui.mode === "move", "Suppress again: back to moving");
    // Throw spear (a spear: reach 2 on the roster agent's data).
    const held = [u.weapon, u.weaponName];
    const W0 = C.WEAPONS.pipespear.reach;
    C.WEAPONS.pipespear.reach = 2;
    u.weapon = "pipespear"; u.weaponName = "Pipe spear";
    html = UI.renderCombatPanel(st);
    check(/data-v="throwspear"/.test(html), "a spear in hand: Throw spear");
    UI.combatKey(st, key("KeyG"));
    check(cui.mode === "throwspear", "Shift+G: the spear's targeting mode");
    const sb = UI.aimArea(b, u, vis, null, "throwspear");
    check(sb.some(Boolean) && sb.every((v, i) => !v || Math.hypot((i % b.w) - u.x, ((i / b.w) | 0) - u.y) <= 5.25), "its reach: seen cells within 5 tiles");
    for (const v of ["top", "iso"]) { UI.setBattleView(v); const n0 = nan; const err = draw(st); check(!err && nan === n0, `the spear's reach drawn in the ${v} view`); }
    cui.mode = "move";
    // A thrown spear on the ground (the roster's b.spears, u.spearOut): drawn in both views, Pick up spear next to it.
    const nx = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [u.x + dx, u.y + dy]).find(([x, y]) => x >= 0 && y >= 0 && x < b.w && y < b.h) || [u.x, u.y];
    u.spearOut = { key: "pipespear", name: "Pipe spear" };
    b.spears = [{ id: 9999, x: nx[0], y: nx[1], f: u.f || 0, key: "pipespear", owner: u.id, side: "player", name: "Pipe spear" }];
    html = UI.renderCombatPanel(st);
    check(/data-v="pickspear"[^>]*>Pick up spear/.test(html) && !/data-v="pickspear"[^>]*disabled/.test(html), "a spear of theirs next to them: Pick up spear");
    for (const v of ["top", "iso"]) { UI.setBattleView(v); const n0 = nan; const err = draw(st); check(!err && nan === n0, `the spear on the ground drawn in the ${v} view`); }
    delete u.spearOut; b.spears = [];
    if (W0 === undefined) delete C.WEAPONS.pipespear.reach; else C.WEAPONS.pipespear.reach = W0;
    [u.weapon, u.weaponName] = held;
    delete u.modes; delete u.mode;
    check(!/data-v="throwspear"/.test(UI.renderCombatPanel(st)), "a gun again: no spear button");
    // The Reload ammo chooser: two kinds of the gun's round to hand.
    const cal = C.WEAPONS[u.weapon].cal, types = CALIBERS[cal].types.slice(0, 2);
    const boxes = ammoBoxes();
    const keys = types.map((t) => `a_${cal}_${t}`);
    const added = keys.filter((k) => !GEAR[k]);
    for (const k of added) GEAR[k] = boxes[k];
    // The battle's rounds (sim/ammo.js: the side's boxes on its fighters and the pools): only these two boxes, on u.
    const pools0 = b.pools, boxes0 = b.units.map((x) => x.boxes);
    b.pools = [{}];
    for (const x of b.units) if (x.side === "player") x.boxes = [];
    u.boxes = [{ key: keys[0], name: boxes[keys[0]].name, quality: 1, dur: 20 }, { key: keys[1], name: boxes[keys[1]].name, quality: 1, dur: 7 }];
    try {
      const list = UI.ammoToHand(st, b, u);
      check(list.length === 2 && list[0].n === 20 && list[1].n === 7, `the rounds to hand by kind (${list.map((x) => `${x.name} ${x.n}`).join(", ")})`);
      cui.msg = ""; cui.ammoAsk = null;
      UI.combatAction(st, "cb-act", { v: "reload" });
      html = UI.renderCombatPanel(st);
      check(cui.ammoAsk === u.id && (html.match(/data-v="reload" data-k="/g) || []).length === 2, "Reload opens the chooser: a button a kind");
      const pick0 = cui.ammoPick[u.id];
      UI.combatKey(st, key("KeyI"));
      check(cui.ammoPick[u.id] !== pick0 && types.includes(cui.ammoPick[u.id]), `Shift+I picks the next kind (${pick0} → ${cui.ammoPick[u.id]})`);
      const ap0 = u.ap;
      UI.combatAction(st, "cb-act", { v: "reload", k: types[1] });
      check(cui.msg === "" ? u.ap === ap0 - 1 && cui.ammoAsk === null : cui.msg === C.reloadRefusal(b, u), `a kind picked: combatAct "reload" with act.ammo (${cui.msg || "reloaded"})`);
      // Your own line shows the round loaded; an enemy's never does.
      u.load = types[1];
      check(UI.renderCombatPanel(st).includes(`<span class="muted">${AMMO_TYPES[types[1]].name}</span>`), "your gun's line shows the kind loaded");
      delete u.load;
    } finally {
      b.pools = pools0; b.units.forEach((x, i) => { x.boxes = boxes0[i]; });
      for (const k of added) delete GEAR[k];
      cui.ammoAsk = null;
    }
    e.load = "ap";
    cui.hover = { x: e.x, y: e.y, px: 400, py: 300 }; cui.mode = "move";
    html = UI.renderCombatPanel(st);
    const prev = (html.split('id="cbprev"')[1] || "").split("Enemies in sight")[0]; // the hovered enemy's preview only (your own lines show your load)
    check(prev.includes(e.weaponName.replace(/&/g, "&amp;")) && !/armour-piercing|hollow point/i.test(prev) && !/\bAP\b/.test(prev), "the enemy line: its gun and parts, never its ammo"); // (the preview: your own line shows your load)
    delete e.load;
    e.jam = { kind: "stovepipe", ap: 1 };
    check(/JAMMED/.test(UI.renderCombatPanel(st)), "a jammed enemy shows JAMMED");
    delete e.jam;
    UI.setBattleView("iso");
  }
}
console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
