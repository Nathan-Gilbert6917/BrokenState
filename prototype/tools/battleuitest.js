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

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
