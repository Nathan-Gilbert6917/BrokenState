// The battle view's keys and hidden tiles (ui/keymap.js, ui/combat.js, ui/isoview.js), on stub canvases:
// - Keys: Q / E turn the view an eighth (, and . still do), Melee on V, Close a door on Shift+E, Center on Home; no two actions
//   of the battle share a key; a player's saved binding on one of the new default keys keeps it (the default steps
//   aside, the action keeps its other keys); the keys work through combatKey; the panel's buttons show them.
// - Ground picking: a tile hidden behind a tree is picked under the tree's crown (the ground under the point), in all
//   four turns of the view and at two zooms; the old solid pick there was the tree; the tree's own trunk still picks
//   the tree; the hovered hidden tile is drawn with a dashed outline (and a visible one solid); someone standing
//   behind a tree gets a dashed outline of their tile in their ring's colour.
// Usage: node tools/battleviewtest.js
import { battles } from "./isobattles.js";
import * as C from "../src/sim/combat.js";
import * as K from "../src/ui/keymap.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

// A 2D context that records every stroke (its dash and colour) and counts NaNs.
let nan = 0, strokes = [];
const recorder = () => {
  const st = { dash: [], strokeStyle: "", lineWidth: 1, globalAlpha: 1 }; // (a real context's globalAlpha starts at 1: drawFigure multiplies it)
  const own = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    measureText: (t) => ({ width: String(t).length * 6 }),
    setLineDash: (a) => { st.dash = a.slice(); },
    getLineDash: () => st.dash.slice(),
    stroke: () => { strokes.push({ dash: st.dash.slice(), style: String(st.strokeStyle), width: st.lineWidth }); },
  };
  return new Proxy(own, {
    get: (o, k) => (k in o ? o[k] : k in st ? st[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
    set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; if (k in st) st[k] = v; else o[k] = v; return true; },
  });
};
const silentCvs = (w, h) => ({ width: w, height: h, getContext: () => recorder(), toDataURL: () => "data:," });
globalThis.document = { createElement: () => silentCvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
ISO.setIsoCanvas(silentCvs);
const main = { clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => mainCtx };
const mainCtx = recorder();
UI.initCombatUI(main);
let clock = 1e6;
const draw = (st) => { strokes = []; try { clock += 50; UI.drawCombat(st, clock); return ""; } catch (e) { return e.stack.split("\n").slice(0, 3).join(" "); } };
const cui = UI.cui;
const ev = (code, mods = {}) => ({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}, ...mods });
const chordEv = (chord) => { const p = chord.split("+"), code = p.pop(); return ev(code, { shiftKey: p.includes("Shift"), ctrlKey: p.includes("Ctrl"), altKey: p.includes("Alt"), metaKey: p.includes("Meta") }); };

// ---------- 1. the keys ----------
console.log("The battle keys");
K.initKeymap({});
{
  const want = [["KeyQ", "bview.rotLeft"], ["KeyE", "bview.rotRight"], ["Comma", "bview.rotLeft"], ["Period", "bview.rotRight"], ["KeyV", "battle.melee"],
    ["Shift+KeyE", "battle.close"], ["Home", "bview.center"], ["Shift+KeyQ", "battle.quick"], ["KeyF", "battle.shoot"], ["KeyK", "battle.peek"], ["KeyY", "battle.brace"], ["Shift+KeyV", "battle.revive"]];
  const bad = want.filter(([c, id]) => K.keyAction(chordEv(c), "battle") !== id).map(([c, id]) => `${c}→${K.keyAction(chordEv(c), "battle")} (want ${id})`);
  check(!bad.length, `Q / E turn the view (, and . too), V melee, Shift+E close a door, Home center, Shift+Q quick search${bad.length ? `: ${bad.join(", ")}` : ""}`);
  const cf = K.conflicts().filter((c) => c.ctx === "battle");
  check(!cf.length, `no two battle actions share a key${cf.length ? `: ${cf.map((c) => `${c.chord} ${c.ids.join("/")}`).join("; ")}` : ""}`);
  const all = K.conflicts();
  check(!all.length, `no clash in any context${all.length ? `: ${all.map((c) => `${c.ctx} ${c.chord} ${c.ids.join("/")}`).join("; ")}` : ""}`);
  check(K.keyAction(ev("KeyE"), "map") === "win.ledger", "on the State Map E is still the Ledger");
  check(K.keyLabel("bview.rotLeft") === "Q or ," && K.keyLabel("bview.rotRight") === "E or ." && K.keyLabel("battle.melee") === "V" && K.keyLabel("battle.close") === "Shift+E" && K.keyLabel("bview.center") === "Home", "the key names (Controls, tooltips): Q or , / E or . / V / Shift+E / Home");
}
// A player's own saved bindings (options.keys) keep working; a new default on a key they gave another action steps aside.
{
  K.initKeymap({ keys: { "battle.throw": ["KeyQ"] } });
  check(K.keyAction(ev("KeyQ"), "battle") === "battle.throw" && K.keysOf("bview.rotLeft").join() === "Comma" && !K.conflicts().some((c) => c.ctx === "battle"), "a saved Throw on Q keeps Q; Turn left keeps , (no clash)");
  const { controlsTab } = await import("../src/ui/controls.js");
  const ct = controlsTab({ settings: { tab: "controls" } });
  check(/Q: kept by yours/.test(ct) && K.steppedAside("bview.rotLeft")[0].by === "battle.throw" && !/class="setmsg danger keyclash"/.test(ct), "Menu → Controls says Turn left's Q is kept by the player's own key, no clash warning");
  K.initKeymap({ keys: { "battle.melee": ["KeyE"] } });
  check(K.keyAction(ev("KeyE"), "battle") === "battle.melee" && K.keysOf("bview.rotRight").join() === "Period" && K.keyAction(ev("KeyV"), "battle") === null, "a saved Melee on E keeps E; Turn right keeps .; V is free");
  K.initKeymap({ keys: { "battle.close": ["KeyQ"], "battle.peek": ["Home"] } });
  check(K.keyAction(ev("KeyQ"), "battle") === "battle.close" && K.keyAction(ev("Home"), "battle") === "battle.peek" && K.keysOf("bview.center").length === 0 && K.keysOf("bview.rotLeft").join() === "Comma", "a saved Close door on Q and Peek on Home keep theirs; Center has no key until one is picked");
  K.initKeymap({ keys: { "bview.rotLeft": ["Comma"], "bview.rotRight": ["Period"] } });
  check(K.keyAction(ev("KeyQ"), "battle") === null && K.keyAction(ev("Comma"), "battle") === "bview.rotLeft" && K.keyAction(ev("KeyE"), "battle") === null, "a saved turn on , and . only: Q and E do nothing (their choice)");
  K.initKeymap({ keys: { "map.hub": ["KeyQ"] } });
  check(K.keyAction(ev("KeyQ"), "battle") === "bview.rotLeft", "a binding in another context does not move a battle default");
  const opts = { keys: { "battle.throw": ["KeyQ"] } };
  K.initKeymap(opts);
  K.resetBinding("battle.throw");
  check(K.keyAction(ev("KeyQ"), "battle") === "bview.rotLeft" && K.keysOf("bview.rotLeft").join() === "KeyQ,Comma" && opts.keys === undefined, "Reset gives the defaults back (Q turns left again)");
  K.initKeymap({});
}

// ---------- 2. the keys in a battle ----------
console.log("The keys in a battle");
{
  const { st, b } = battles(61, ["raid-building"])[0];
  draw(st);
  if (b.phase === "deploy") C.combatAct(st, { type: "start" });
  draw(st);
  // An eighth a press (ui/isoview.js viewStep: 0..7, the straight views odd).
  const r0 = ISO.viewStep(), rot0 = ISO.iso.rot;
  UI.combatKey(st, ev("KeyQ"));
  const r1 = ISO.viewStep();
  UI.combatKey(st, ev("KeyE"));
  const r2 = ISO.viewStep();
  UI.combatKey(st, ev("Period"));
  const r3 = ISO.viewStep();
  UI.combatKey(st, ev("Comma"));
  check(r1 === (r0 + 7) % 8 && r2 === r0 && r3 === (r0 + 1) % 8 && ISO.viewStep() === r0 && ISO.iso.rot === rot0, `Q turns the view left, E right, . and , too, an eighth each (${r0} → ${r1} → ${r2} → ${r3} → ${ISO.viewStep()})`);
  const me = b.units.find((u) => u.side === "player" && C.active(u) && u.ap > 0);
  cui.sel = me.id; cui.mode = "move"; cui.msg = "";
  UI.combatKey(st, ev("KeyV"));
  check(cui.mode === "melee" || /strike|adjacent|melee/i.test(cui.msg), `V is Melee (mode ${cui.mode}${cui.msg ? `, "${cui.msg.slice(0, 60)}"` : ""})`);
  cui.mode = "move"; cui.msg = "";
  const log0 = b.log.length;
  UI.combatKey(st, ev("KeyE", { shiftKey: true }));
  const shut = b.log.slice(log0).find((l) => /door/i.test(l.text));
  check(cui.mode === "close" || /door/i.test(cui.msg) || !!shut, `Shift+E is Close door (${shut ? `"${shut.text}"` : `mode ${cui.mode}, "${cui.msg.slice(0, 60)}"`})`);
  check(ISO.iso.rot === r0, "Shift+E does not turn the view");
  cui.mode = "move"; cui.msg = "";
  ISO.iso.cx += 500;
  const cx0 = ISO.iso.cx;
  UI.combatKey(st, ev("Home"));
  check(ISO.iso.target || ISO.iso.cx !== cx0, "Home centers on the selected unit");
  const bar = UI.viewBar(b), panel = UI.renderCombatScreen(st);
  check(/to the left \(Q or ,\)/.test(bar) && /to the right \(E or \.\)/.test(bar) && /selected unit \(Home\)/.test(bar), "the view bar's tooltips name Q, E and Home");
  check(/data-v="melee"[^>]*>Melee <span class="key">V<\/span>/.test(panel), "the Melee button shows V");
  check(!/data-v="drive"[^>]*>Drive <span class="key">V/.test(panel), "Drive does not claim V");
  const raidPanel = /data-v="close"[^>]*>Close door <span class="key">⇧E<\/span>/.test(panel) || !/data-v="close"/.test(panel);
  check(raidPanel, "the Close door button (inside a building) shows ⇧E");
  K.initKeymap({ keys: { "battle.melee": ["KeyX"], "battle.extract": ["Shift+KeyZ"] } });
  check(/data-v="melee"[^>]*>Melee <span class="key">X<\/span>/.test(UI.renderCombatScreen(st)), "a rebound Melee shows its own key on the button");
  K.initKeymap({});
}

// ---------- 3. picking the ground behind a tree, in every turn of the view ----------
console.log("Tiles behind trees");
{
  const { st, b } = battles(62, ["field-forest"])[0];
  draw(st);
  if (b.phase === "deploy") C.combatAct(st, { type: "start" });
  const walk = (x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h && C.CELL[b.cells[y * b.w + x].k].walk && !C.heightAt(b, x, y);
  const isTree = (x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h && b.cells[y * b.w + x].k === "tree";
  let found = 0, picked = 0, solidTree = 0, trunk = 0, hidden = 0, dashOk = 0, visSolid = 0, unitDash = 0, coverOk = 0, total = 0;
  const errs = [], misses = [];
  for (let rot = 0; rot < 4; rot++) for (const zoom of [2, 6]) {
    ISO.iso.battle = null; draw(st);
    ISO.iso.rot = rot; ISO.iso.zoom = zoom; ISO.iso.target = null;
    ISO.iso.cx = 0; ISO.iso.cy = (b.w + b.h) * 4;
    let e = draw(st);
    if (e) errs.push(e);
    // A walkable tile whose cell in front on the screen (the next one on its view diagonal) is a tree.
    const [Wv, Hv] = ISO.viewDims(b);
    const pairs = [];
    for (let v = 0; v < Hv - 1; v++) for (let u = 0; u < Wv - 1; u++) {
      const [x, y] = ISO.fromView(u, v, rot, b.w, b.h), [tx, ty] = ISO.fromView(u + 1, v + 1, rot, b.w, b.h);
      if (walk(x, y) && isTree(tx, ty) && !C.unitAt(b, x, y)) pairs.push([x, y, tx, ty]);
    }
    found += pairs.length ? 1 : 0;
    for (const [x, y, tx, ty] of pairs.slice(0, 25)) {
      total++;
      const [px, py] = ISO.project(x + 0.5, y + 0.5, 0); // the tile's floor: under the tree's crown on the screen
      const p = ISO.isoPick(b, px, py, { noUnits: true });
      if (p && p.x === x && p.y === y) picked++; else if (misses.length < 3) misses.push(`rot ${rot} (${x},${y}) → ${p ? `${p.x},${p.y} ${b.cells[p.y * b.w + p.x].k}` : "nothing"}`);
      const q = ISO.isoPick(b, px, py, { noUnits: true, solid: true });
      if (q && isTree(q.x, q.y)) solidTree++; // this tree, or another one in front of it
      const [fx, fy] = ISO.project(tx + 0.5, ty + 0.5, 1); // the foot of the trunk
      const f = ISO.isoPick(b, fx, fy, { noUnits: true });
      // The tree's own cell, or a block in front that hides the foot of its trunk (a car, a boulder: still solid).
      const nearer = f && (() => { const [u0, v0] = ISO.toView(tx, ty, rot, b.w, b.h), [u1, v1] = ISO.toView(f.x, f.y, rot, b.w, b.h); return u1 + v1 > u0 + v0 && !C.CELL[b.cells[f.y * b.w + f.x].k].walk && !isTree(f.x, f.y); })();
      if (f && ((f.x === tx && f.y === ty) || nearer)) trunk++; else if (misses.length < 6) misses.push(`trunk rot ${rot} (${tx},${ty}) → ${f ? `${f.x},${f.y} ${b.cells[f.y * b.w + f.x].k}` : "nothing"}`);
      if (ISO.isoCoverOf(b, x, y).includes(ty * b.w + tx)) coverOk++;
    }
    // The hovered hidden tile: a dashed outline over the tree; a tile with nothing in front: solid.
    if (pairs.length) {
      const [x, y] = pairs[0];
      UI.combatMouse(st, ...ISO.project(x + 0.5, y + 0.5, 0));
      e = draw(st);
      if (e) errs.push(e);
      const h = ISO.iso.lastHover;
      if (h && h.x === x && h.y === y && h.hidden) hidden++;
      if (h && h.hidden && h.dash.length === 2 && strokes.some((s) => s.dash.length && /255,255,255/.test(s.style))) dashOk++;
      // Someone standing there: their tile dashed in their ring's colour.
      const me = b.units.find((u) => u.side === "player" && C.active(u));
      const ox = me.x, oy = me.y;
      me.x = x; me.y = y; me.moveFrom = null; me.anim = null;
      cui.hover = null;
      e = draw(st);
      if (e) errs.push(e);
      if (strokes.some((s) => s.dash.length && /#8fc1ff/i.test(s.style))) unitDash++;
      me.x = ox; me.y = oy;
    }
    // A tile with nothing tall in front of it on the screen.
    const open = (() => {
      for (let v = 1; v < Hv - 4; v++) for (let u = 1; u < Wv - 4; u++) {
        const [x, y] = ISO.fromView(u, v, rot, b.w, b.h);
        if (!walk(x, y) || C.unitAt(b, x, y)) continue;
        let clear = true;
        for (let k = 1; k <= 3 && clear; k++) { const [ax, ay] = ISO.fromView(u + k, v + k, rot, b.w, b.h); if (!walk(ax, ay)) clear = false; }
        if (clear) return [x, y];
      }
      return null;
    })();
    if (open) {
      UI.combatMouse(st, ...ISO.project(open[0] + 0.5, open[1] + 0.5, 0));
      draw(st);
      const h = ISO.iso.lastHover;
      if (h && h.x === open[0] && h.y === open[1] && !h.hidden && !h.dash.length) visSolid++;
    }
  }
  check(!errs.length && !nan, `drawn in all four turns at two zooms with hover and hidden units, no error or NaN${errs.length ? ` (${errs[0]})` : ""}`);
  check(found === 8 && total > 40, `tiles hidden behind a tree found in every turn and zoom (${found}/8, ${total} tiles)`);
  check(picked === total, `the floor of a tile behind a tree picks that tile, not the tree (${picked}/${total})${misses.length ? `: ${misses.join("; ")}` : ""}`);
  check(solidTree === total, `the old solid pick there was a tree (${solidTree}/${total})`);
  check(trunk === total, `the foot of the trunk still picks the tree's own cell (or a solid block in front of it) (${trunk}/${total})${misses.length ? `: ${misses.join("; ")}` : ""}`);
  check(coverOk === total, `the tree is what hides the tile (isoCoverOf: ${coverOk}/${total})`);
  check(hidden === 8 && dashOk === 8, `the hovered tile behind a tree is drawn hidden with a dashed white outline (${hidden}/8 hidden, ${dashOk}/8 dashed)`);
  check(visSolid === 8, `a tile with nothing in front of it keeps the solid cursor (${visSolid}/8)`);
  check(unitDash === 8, `someone standing behind a tree gets a dashed outline in their colour (${unitDash}/8)`);
  // A UI size other than 100%: the canvas measured smaller in CSS px; picking is in CSS px and still lands.
  main.clientWidth = 1100; main.clientHeight = 620;
  ISO.iso.battle = null; draw(st);
  ISO.iso.rot = 1; ISO.iso.zoom = 4; ISO.iso.target = null;
  draw(st);
  const [Wv, Hv] = ISO.viewDims(b);
  let n = 0, ok = 0;
  for (let v = 0; v < Hv - 1; v++) for (let u = 0; u < Wv - 1; u++) {
    const [x, y] = ISO.fromView(u, v, 1, b.w, b.h), [tx, ty] = ISO.fromView(u + 1, v + 1, 1, b.w, b.h);
    if (!walk(x, y) || !isTree(tx, ty)) continue;
    n++;
    const p = ISO.isoPick(b, ...ISO.project(x + 0.5, y + 0.5, 0), { noUnits: true });
    if (p && p.x === x && p.y === y) ok++;
  }
  check(n > 0 && ok === n, `on a smaller canvas (another UI size) the tile behind a tree still picks (${ok}/${n})`);
  main.clientWidth = 1600; main.clientHeight = 900;
}

// ---------- 4. the other layouts still draw ----------
console.log("Every layout");
{
  const errs = [];
  for (const { name, st, b } of battles(63)) {
    for (let r = 0; r < 8; r++) { // the eight views (ui/isoview.js isoRotate)
      ISO.isoRotate(b, 1);
      const me = b.units.find((u) => u.side === "player" && C.active(u));
      if (me) UI.combatMouse(st, ...ISO.project(me.x + 0.5, me.y - 1.5, 0));
      const e = draw(st);
      if (e) errs.push(`${name}: ${e}`);
    }
  }
  check(!errs.length && !nan, `every layout drawn in all eight turns with a hover, no error or NaN${errs.length ? ` (${errs[0]})` : ""}`);
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
