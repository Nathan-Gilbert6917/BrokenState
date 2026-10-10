// The battle HUD (ui/battlehud.js; user requests 2026-10-09: the weapon overlay with the magazine's capacity, a hit
// chance that is easy to read, health rows for every survivor at a glance even off screen). On stub canvases and a
// stub #cbhud element:
// - the weapon panel: rounds in the gun / what it holds, the calibre and the round loaded, spare magazines at hand and
//   in the pack; a shotgun's shells at hand and in the pack (sim/mags.js SHELLS), before and after Get shells; a jam;
//   melee weapons: the blow's odds and damage;
// - the hit chance: the number drawn over the enemy under the mouse (and over every enemy in sight) is the selected
//   unit's shotOdds chance, the breakdown's steps add up to its aim, and a shot rolls exactly that chance (the
//   battle's rng); the target card and the panel's odds line show it too; in all four view turns;
// - the squad strip: a row per person of yours with their hp and actions, a click selects them and brings the view
//   there; panned away, the rows say off screen and arrows with their numbers sit at the edge; the fold key.
// Usage: node tools/battlehudtest.js [seed]
import { battles } from "./isobattles.js";
import * as C from "../src/sim/combat.js";
import { setRounds, giveRounds } from "../src/sim/ammo.js";
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { newItem } from "../src/sim/inventory.js";
import { starterMags } from "../src/sim/carrykit.js";
import { shellsAt, SHELLS } from "../src/sim/mags.js";

const seed = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const t0 = performance.now();

// ---------- stubs: canvases that note their texts, a #cbhud that keeps what is written into it ----------
let nan = 0, texts = [];
const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }), fillText: (t) => { texts.push(String(t)); } }, {
  get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
  set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
});
const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
function box() { return { innerHTML: "", firstElementChild: null }; }
const hudEl = {
  isConnected: true, _html: "", boxes: null, classes: new Set(),
  get innerHTML() { return this._html; },
  set innerHTML(v) { this._html = v; this.boxes = { ".bh-rosterbox": box(), ".bh-targetbox": box(), ".bh-weaponbox": box() }; },
  get firstChild() { return this.boxes ? {} : null; },
  querySelector(sel) { return this.boxes ? this.boxes[sel] || null : null; },
  classList: { toggle(c, on) { if (on) hudEl.classes.add(c); else hudEl.classes.delete(c); } },
};
globalThis.document = { createElement: () => cvs(0, 0), getElementById: (id) => (id === "cbhud" ? hudEl : null), documentElement: { style: { getPropertyValue: () => "1" } } };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
try { globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} }; } catch { /* node's own */ }

const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
const HUD = await import("../src/ui/battlehud.js");
ISO.setIsoCanvas(cvs);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
const cui = UI.cui;
const draw = (st) => { texts = []; try { UI.drawCombat(st, 1e9); return ""; } catch (e) { return e.stack.split("\n").slice(0, 3).join(" "); } };
const roster = () => hudEl.boxes[".bh-rosterbox"].innerHTML;
const weapon = () => hudEl.boxes[".bh-weaponbox"].innerHTML;
const target = () => hudEl.boxes[".bh-targetbox"].innerHTML;
const strip = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
if (!HUD.HUD.open) HUD.toggleHud(true);

// ---------- 1. the weapon panel ----------
console.log("The weapon panel");
registerHandler();
function registerHandler() { C.registerCombatHandler("hudtest", () => {}); }
function fighter(state, weapon, shooting = 9) {
  const s = makeSurvivor(state);
  s.skills.shooting = shooting; s.traits = []; s.health = 100;
  s.gear.weapon = newItem(weapon);
  for (const slot of ["head", "armor", "arms", "legs", "tool"]) s.gear[slot] = null;
  s.pockets = s.pockets.map(() => null);
  if (weapon !== "shotgun" && weapon !== "machete") starterMags(s);
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function openBattle(state, crew, ammo = 200) {
  const h = hub(state);
  setRounds(h.stock, 0);
  for (const s of crew) if (C.WEAPONS[s.gear.weapon.key].cal) giveRounds(h.stock, ammo, [s.gear.weapon.key]);
  const b = (state.combat = C.createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 2, power: 3 }, ambush: null, canRetreat: true, handler: "hudtest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0); b.reach.fill(1);
  b.dark = false; b.night = false; b.phase = "player";
  return b;
}
{
  const st = createWorld({ seed, factionCount: 4 });
  st.started = true;
  const crew = [fighter(st, "pistol"), fighter(st, "shotgun"), fighter(st, "machete"), fighter(st, "ar")];
  const b = openBattle(st, crew);
  const by = (s) => b.units.find((u) => u.sid === s.id);
  const [pis, sg, mac, ar] = crew.map(by);
  // A pistol with spare magazines in the pockets.
  let info = HUD.weaponInfo(st, b, pis);
  check(info.mag && info.mag.in === C.magShown(b, pis) && info.mag.cap === C.magMaxOf(pis), `pistol: ${info.mag && info.mag.in}/${info.mag && info.mag.cap} = magShown/magMaxOf (${C.magLabel(b, pis)})`);
  check(info.cal === "9mm" && info.loadShort === "FMJ", `its calibre and round: ${info.cal} ${info.loadShort}`);
  check(info.spares && info.spares.hand.mags >= 1, `spare magazines at hand: ${info.spares && info.spares.hand.mags} (${info.spares && info.spares.hand.rounds} rounds), in the pack ${info.spares && info.spares.pack.mags}`);
  let html = HUD.weaponPanelHtml(st, b, pis), txt = strip(html);
  check(txt.includes(`${info.mag.in} / ${info.mag.cap}`) && txt.includes("9mm") && txt.includes("FMJ") && /at hand/.test(txt), `the panel: "${txt.trim().slice(0, 110)}"`);
  check((html.match(/<i class=on><\/i>/g) || []).length === info.mag.in && (html.match(/<i><\/i>/g) || []).length === info.mag.cap - info.mag.in, "a pip a round (15 or fewer): filled for each loaded");
  C.loadMag(pis, 3);
  check(strip(HUD.weaponPanelHtml(st, b, pis)).includes(`3 / ${info.mag.cap}`), "after shots: 3 / 15");
  C.loadMag(pis, 0);
  check(/EMPTY/.test(HUD.weaponPanelHtml(st, b, pis)), "empty: EMPTY — Reload");
  C.loadMag(pis);
  // An assault rifle: a bar, its fire mode.
  info = HUD.weaponInfo(st, b, ar);
  html = HUD.weaponPanelHtml(st, b, ar);
  check(info.mag.cap === C.magMaxOf(ar) && /bh-magbar/.test(html) && strip(html).includes(`${info.mag.in} / ${info.mag.cap}`), `assault rifle: a bar for ${info.mag.cap} rounds (${info.mag.in} / ${info.mag.cap}), ${info.cal}`);
  check(!info.mode || new RegExp(info.mode, "i").test(html), `its fire mode shown (${info.mode || "one mode"})`);
  ar.jam = { kind: "stovepipe", ap: 1 };
  check(/JAMMED/.test(HUD.weaponPanelHtml(st, b, ar)) && HUD.weaponInfo(st, b, ar).jam === "stovepipe", "a jam: JAMMED");
  ar.jam = null;
  check(HUD.weaponInfo(st, b, ar).cond != null && /cond|%/.test(HUD.weaponPanelHtml(st, b, ar)), `condition shown (${Math.round(HUD.weaponInfo(st, b, ar).cond * 100)}%)`);
  // The shotgun: shells at hand and in the pack.
  const s0 = shellsAt(b, sg);
  info = HUD.weaponInfo(st, b, sg);
  check(info.shells && info.shells.at === s0.at && info.shells.pack === s0.pack, `shotgun: ${info.shells && info.shells.at} shells at hand, ${info.shells && info.shells.pack} in the pack (sim/mags.js shellsAt ${s0.at} / ${s0.pack})`);
  check(info.mag.in === C.magShown(b, sg) && info.mag.cap === C.magMaxOf(sg) && info.cal.length > 0 && info.loadShort.length > 0, `its tube ${info.mag.in}/${info.mag.cap}, ${info.cal} ${info.loadShort}`);
  txt = strip(HUD.weaponPanelHtml(st, b, sg));
  check(txt.includes(`${s0.at} at hand`) && txt.includes(`${s0.pack} in the pack`), `the panel says so: "${(txt.match(/\d+ at hand.*?in the pack/) || [""])[0]}"`);
  // Shells to the pack only: the panel shows 0 at hand; Get shells moves them, the panel follows.
  sg.hand = {};
  const s1 = shellsAt(b, sg);
  if (s1.at === 0 && s1.pack > 0) {
    check(strip(HUD.weaponPanelHtml(st, b, sg)).includes("0 at hand"), "none at hand: 0 at hand");
    sg.ap = 2;
    const err = C.combatAct(st, { type: "getshells", unit: sg.id });
    const s2 = shellsAt(b, sg);
    check(!err && s2.at > 0 && strip(HUD.weaponPanelHtml(st, b, sg)).includes(`${s2.at} at hand`) && strip(HUD.weaponPanelHtml(st, b, sg)).includes(`${s2.pack} in the pack`), `Get shells: ${s2.at} at hand, ${s2.pack} in the pack${err ? ` (${err})` : ""}`);
  } else check(true, `(the shells at hand are in boxes: ${s1.at} at hand, ${s1.pack} in the pack)`);
  // A machete: the blow.
  info = HUD.weaponInfo(st, b, mac);
  const mo = C.meleeOdds(b, mac, { x: mac.x, y: mac.y, hunker: false });
  check(info.melee && info.melee.chance === mo.chance && info.melee.dmg[0] === mo.dmg[0] && /Melee/.test(HUD.weaponPanelHtml(st, b, mac)) && !info.mag, `machete: Melee ${info.melee && info.melee.chance}% ${mo.dmg.join("–")} dmg, no magazine`);
  // The DOM: the selected unit's panel lands in #cbhud.
  draw(st); // the first frame of a battle picks its own unit (ui/combat.js sync)
  cui.sel = sg.id;
  const e = draw(st);
  check(!e && strip(weapon()).includes(`${C.magShown(b, sg)} / ${C.magMaxOf(sg)}`), `drawn: the selected shotgunner's panel in #cbhud${e ? ` (${e})` : ""}`);
}

// ---------- 2. the hit chance ----------
console.log("The hit chance");
{
  let compared = 0, wrong = 0, rolled = 0, rollWrong = 0, sums = 0, sumWrong = 0, cards = 0, badges = 0, panelLine = 0, rots = 0;
  for (const s of [seed, seed + 30, seed + 31]) for (const name of ["field-town", "field-city", "field-forest"]) {
    const { st, b } = battles(s, [name])[0];
    for (let i = 0; i < 3 && !b.over; i++) { C.autoPlayerTurn(st); if (!b.over) C.runEnemyPhase(st); }
    if (b.over || b.phase !== "player") continue;
    draw(st);
    for (const u of b.units.filter((x) => x.side === "player" && x.vol == null && C.active(x) && x.ap > 0 && C.canFire(b, x))) {
      const foes = b.units.filter((t) => t.side === "enemy" && C.active(t) && C.playerSees(b, t) && C.canSee(b, u, t));
      for (const t of foes.slice(0, 3)) {
        cui.sel = u.id; cui.mode = "move";
        cui.hover = { x: t.x, y: t.y, px: 800, py: 450 };
        const e = draw(st);
        const o = C.shotOdds(b, u, t);
        compared++;
        const big = texts.includes(`${o.chance}%`);
        if (e || !big) { wrong++; if (wrong < 4) console.log(`    drawn ${JSON.stringify(texts.filter((x) => /%$/.test(x)))} vs shotOdds ${o.chance}% ${e}`); }
        if (target().includes(`${o.chance}%`)) cards++;
        // every other enemy in sight: its own badge
        const others = foes.filter((f) => f !== t);
        if (others.every((f) => texts.includes(`${C.shotOdds(b, u, f).chance}%`))) badges++;
        // the breakdown: the steps add up to the aim, the aim rounds and clamps to the chance
        const r = C.shotOdds(b, u, t, u.x, u.y, { parts: true });
        sums++;
        const sum = r.parts.reduce((a, [, v]) => a + v, 0);
        if (Math.abs(sum - r.aim) > 1e-6 || Math.max(5, Math.min(95, Math.round(r.aim))) !== o.chance || r.chance !== o.chance) sumWrong++;
        // the panel's odds line
        cui.hover = { x: t.x, y: t.y, px: 800, py: 450 };
        const p = UI.renderCombatPanel(st);
        if (p.includes(`<b class="cbbig">${o.chance}%</b>`) && /bh-bd/.test(p)) panelLine++;
      }
      // all four view turns: the same number over the hovered enemy, nothing NaN
      const t = foes[0];
      if (t && rots < 6) {
        const o = C.shotOdds(b, u, t);
        let ok = true;
        for (let r = 0; r < 4; r++) { ISO.isoRotate(b, 1); cui.hover = { x: t.x, y: t.y, px: 800, py: 450 }; nan = 0; const e = draw(st); if (e || nan || !texts.includes(`${o.chance}%`)) ok = false; }
        rots++;
        check(ok, `${name} seed ${s}: ${u.name} → ${t.name} ${o.chance}% in all four view turns, no NaN`);
      }
      // a real shot rolls that chance: the battle's rng is asked for exactly o.chance / 100 first
      if (foes.length && rolled < 12) {
        const tt = foes[0];
        const o = C.shotOdds(b, u, tt);
        u.gearRisk = 0;
        const asked = [];
        const orig = b.rng.chance;
        b.rng.chance = function (p) { asked.push(p); return orig.call(this, p); };
        const err = C.combatAct(st, { type: "shoot", unit: u.id, target: tt.id });
        b.rng.chance = orig;
        if (!err && asked.length) { rolled++; if (Math.abs(asked[0] - o.chance / 100) > 1e-9) { rollWrong++; console.log(`    shot rolled ${asked[0]} vs shown ${o.chance}%`); } }
        if (b.over || b.phase !== "player") break;
      }
    }
  }
  check(compared >= 10 && !wrong, `the big number over the hovered enemy is shotOdds' chance (${compared - wrong} of ${compared})`);
  check(cards === compared, `the target card shows it (${cards} of ${compared})`);
  check(badges === compared, `every other enemy in sight has its own badge with its chance (${badges} of ${compared})`);
  check(sums === compared && !sumWrong, `the breakdown's steps add up to the aim, rounded and kept within 5–95 it is the chance (${sums - sumWrong} of ${sums})`);
  check(panelLine === compared, `the panel's odds line: the chance big and the breakdown (${panelLine} of ${compared})`);
  check(rolled >= 5 && !rollWrong, `a shot rolls exactly the chance shown (${rolled - rollWrong} of ${rolled} shots)`);
  // melee: the breakdown of a blow
  const { st, b } = battles(seed, ["field-town"])[0];
  const u = b.units.find((x) => x.side === "player" && C.active(x));
  const t = b.units.find((x) => x.side === "enemy" && C.active(x));
  t.x = u.x + 1; t.y = u.y; // next to them (a test only: no map check)
  const m = C.meleeOdds(b, u, t, { parts: true });
  check(m.parts && Math.abs(m.parts.reduce((a, [, v]) => a + v, 0) - m.aim) < 1e-9 && m.chance === C.meleeOdds(b, u, t).chance, `melee: the steps add up (${m.parts.map(([l, v]) => `${l} ${Math.round(v)}`).join(", ")}) to ${m.chance}%`);
  const bd = HUD.hitBreakdown(b, u, t, { ...C.meleeOdds(b, u, t), ok: true, kind: "melee" });
  check(bd && HUD.breakdownHtml(bd).includes(`${m.chance}%`), "melee: its card shows the chance");
  check(HUD.hitTone(70) === "good" && HUD.hitTone(50) === "warn" && HUD.hitTone(20) === "danger", "colours: green 65+, amber 35–64, red under 35");
}

// ---------- 3. the squad strip ----------
console.log("The squad strip");
{
  const { st, b } = battles(seed, ["field-town"])[0];
  cui.hover = null;
  draw(st);
  const mine = b.units.filter((u) => u.side === "player" && u.vol == null);
  const html = roster();
  const rows = html.match(/class="bh-row[^"]*" data-action="cb-sel" data-id="\d+"/g) || [];
  check(rows.length === mine.length, `a row per person of yours (${rows.length} of ${mine.length})`);
  let hpOk = 0, apOk = 0;
  for (const p of mine) {
    const m = new RegExp(`data-id="${p.id}"[\\s\\S]*?<span class="bh-hpn">(\\d+)</span>`).exec(html);
    if (m && Number(m[1]) === Math.round(p.hp)) hpOk++;
    const row = html.split(`data-id="${p.id}"`)[1].split('class="bh-row')[0];
    const on = (row.match(/<i class=on><\/i>/g) || []).length;
    if (on === p.ap) apOk++;
  }
  check(hpOk === mine.length, `each row's hp is the unit's (${hpOk} of ${mine.length})`);
  check(apOk === mine.length, `each row's action pips are the unit's actions (${apOk} of ${mine.length})`);
  // Hurt one, spend an action: the strip follows on the next frame.
  const p0 = mine[0];
  p0.hp = Math.max(1, Math.round(p0.maxHp * 0.4)); p0.ap = 1; p0.bleeding = 2;
  draw(st);
  const r0 = roster().split(`data-id="${p0.id}"`)[1].split('class="bh-row')[0];
  check(r0.includes(`<span class="bh-hpn">${p0.hp}</span>`) && (r0.match(/<i class=on><\/i>/g) || []).length === 1 && /BLEED 2/.test(r0) && /bh-hp bleed/.test(r0), "hurt, bleeding, an action spent: the row shows it next frame");
  // A click on a row selects them and brings the view there.
  const p1 = mine[mine.length - 1];
  cui.sel = mine[0].id;
  ISO.iso.target = null;
  UI.combatAction(st, "cb-sel", { id: String(p1.id), center: "1" });
  check(cui.sel === p1.id && ISO.iso.target != null, `a click on ${p1.name}'s row selects them and the view goes to them`);
  // Panned far away: every row says off screen, and the edge has an arrow with each number.
  ISO.iso.target = null;
  ISO.isoZoom(b, 20); // the closest zoom, then the far corner from them (the camera stops at the map's edge)
  let offRows = -1, bestTexts = [], bestRoster = "";
  for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    ISO.isoPan(b, dx * 1e6, dy * 1e6);
    draw(st);
    const n = (roster().match(/class="bh-row[^"]* off"/g) || []).length;
    if (n > offRows) { offRows = n; bestTexts = texts.slice(); bestRoster = roster(); }
  }
  texts = bestTexts;
  const visible = mine.filter((p) => !p.dead && !p.left && !p.off && p.x >= 0).length;
  check(offRows === visible && /off screen/.test(bestRoster), `panned away: ${offRows} of ${visible} rows marked off screen`);
  const nums = mine.slice(0, 9).map((p, i) => String(i + 1)).filter((n, i) => !mine[i].dead && !mine[i].left && !mine[i].off);
  check(nums.every((n) => texts.includes(n)), `an arrow with each number at the edge (${nums.join(" ")})`);
  // Back on them: no row off screen.
  UI.combatAction(st, "cb-view", { v: "center" });
  for (let i = 0; i < 60; i++) { ISO.iso.lastT = 1e9 - 50; draw(st); } // 50 ms a frame (isoview.js stepCamera)
  const p = mine.find((x) => x.id === cui.sel);
  check(!new RegExp(`class="bh-row[^"]* off" data-action="cb-sel" data-id="${p.id}"`).test(roster()), `centred on ${p.name}: their row is on screen again`);
  // The fold key (Backquote): a narrow strip, no weapon panel; again: open.
  const before = HUD.HUD.open;
  UI.combatKey(st, { code: "Backquote", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {} });
  draw(st);
  check(HUD.HUD.open === !before && /bh-roster folded/.test(roster()) && weapon() === "", "` folds the strip (a narrow column) and hides the weapon panel");
  UI.combatAction(st, "cb-view", { v: "hud" });
  draw(st);
  check(HUD.HUD.open && !/folded/.test(roster()) && weapon() !== "", "the strip's button opens it again");
  // Downed and dead: their state on the row.
  const d = mine[1];
  if (d) {
    d.down = true; d.stab = false; d.bleed = 3;
    draw(st);
    check(/DOWN/.test(roster().split(`data-id="${d.id}"`)[1].split('class="bh-row')[0]), `${d.name} down: DOWN on the row`);
    d.down = false;
  }
  // The result screen: the HUD hides.
  b.over = true; b.result = { outcome: "victory" };
  draw(st);
  check(hudEl.classes.has("hidden"), "the battle over: the HUD hides");
  b.over = false;
  draw(st);
  check(!hudEl.classes.has("hidden"), "and comes back");
}

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
