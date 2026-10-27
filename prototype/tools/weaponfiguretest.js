// The weapon models in the figures' hands (src/ui/weaponmodels.js, src/ui/figures.js; issue #77):
// - every weapon a survivor, a raider or an AI group's survivor can hold (every GEAR entry with the weapon slot and
//   every kit's weapons, sim/combat.js KITS) resolves to a model of its own with a pose class in HOLDS and parts;
// - no two weapons share the same draw (the same parts), unless listed in SHARED (none today);
// - a class a weapon: a pump shotgun in the pump hold, a revolver in its own, a sword two-handed, a spear level, a
//   crossbow apart from a bow, a tube on the shoulder; the kits' weapons all have models;
// - the hands are on the weapon at every heading: in figure space (the figure turns rigidly) the holding hand's
//   middle lies within a hand's radius of a part of the weapon, both hands for a two-handed hold; and painted at
//   the eight main headings, wherever the holding hand and the weapon both show, a hand pixel touches a weapon pixel;
// - the muzzle lies on the barrel: on a part of the model, at its far end, and ahead of the fist; the figure's
//   muzzle point differs between guns (an M4 and a sniper rifle);
// - fitted parts show: a suppressor lengthens the gun and moves the muzzle out, a drum, a scope and a stock change
//   the picture; the finish changes its colours;
// - the cache key includes the weapon: two weapons are two entries, the same weapon again a hit, the fitted parts
//   a separate entry; a cached-only lookup paints nothing;
// - the dead: a dead unit's weapon lies beside it until the body is searched (unitFigureDown), a downed one's does
//   not; the inventory spin's key carries the weapon look.
// Usage: node tools/weaponfiguretest.js   (a few seconds)
import { GEAR } from "../src/sim/data.js";
import { KITS } from "../src/sim/combat.js";
import * as F from "../src/ui/figures.js";
import { weaponModel, placeModel, distToPart, HOLDS, MELEE, BOWS } from "../src/ui/weaponmodels.js";
import { painter } from "../src/ui/sprites.js";
import { isGunKey } from "../src/ui/gunpaint.js";

let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(t);
const list = (a, n = 8) => a.slice(0, n).join(", ") + (a.length > n ? ` … (${a.length})` : "");
// Documented shared draws: weapons allowed the same model (none: every weapon has its own).
const SHARED = [];

const keys = new Set(Object.keys(GEAR).filter((k) => GEAR[k].slot === "weapon"));
const kitKeys = new Set();
for (const kit of Object.values(KITS)) for (const w of kit.weapons) { keys.add(w); kitKeys.add(w); }
const KEYS = [...keys].sort();
// A look with a skin no clothes or weapon share (magenta: r = b, and g 0 or r 255 in every shade), so a hand's pixels are told apart.
const APP = { build: "average", skin: "#ff00ff", hairStyle: "short", hair: "#6b4526", facial: "none", topStyle: "jacket", top: "#3d4a5c", pants: "#3a3a3a", accessory: "none", accent: "#b8322a" };
const isSkin = (c) => { if (!c) return false; const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16); return r === b && (g === 0 || r === 255) && r > 40; };

section("Every weapon has a model of its own");
{
  const none = KEYS.filter((k) => !weaponModel(k)), badHold = KEYS.filter((k) => weaponModel(k) && !HOLDS.includes(weaponModel(k).hold)), empty = KEYS.filter((k) => weaponModel(k) && weaponModel(k).parts.length < 2);
  check(KEYS.length >= 120, `${KEYS.length} weapon keys: GEAR's weapon slot and the kits' lists`);
  check(!none.length, `every key resolves to a model${none.length ? ` (not: ${list(none)})` : ""}`);
  check(!badHold.length, `every model's hold is a pose class${badHold.length ? ` (not: ${list(badHold)})` : ""}`);
  check(!empty.length, `every model has parts${empty.length ? ` (not: ${list(empty)})` : ""}`);
  check([...kitKeys].every((k) => weaponModel(k)), `the ${kitKeys.size} weapons the human kits deal out (raiders, soldiers, the groups' fighters…) all have models`);
  const sig = (m) => JSON.stringify(m.parts.map((P) => [P.A, P.B, P.ra, P.rb, P.col].map((v) => (Array.isArray(v) ? v.map((x) => +x.toFixed(2)) : v))));
  const by = new Map();
  for (const k of KEYS) { const s = sig(weaponModel(k)); if (!by.has(s)) by.set(s, []); by.get(s).push(k); }
  const dup = [...by.values()].filter((v) => v.length > 1 && !SHARED.some((S) => v.every((k) => S.includes(k))));
  check(!dup.length, `no two weapons share the same draw${dup.length ? ` (${dup.map((v) => v.join("=")).join("; ")})` : ""}`);
  const px = (k) => F.paintBoxFigure(APP, k, null, 0).px.join();
  const guns = ["shotgun", "dbshotgun", "huntrifle", "ar", "leverrifle", "sawnoff"], pics = guns.map(px);
  check(new Set(pics).size === guns.length, "a pump, a double barrel, a hunting rifle, an AR, a lever gun and a sawn-off paint six different figures");
  const blades = ["knife", "machete", "hatchet", "baton"], bats = ["bat", "sledge", "fireaxe", "spear", "katana"];
  check(new Set(blades.map(px)).size === blades.length && new Set(bats.map(px)).size === bats.length, "a knife, a machete, a hatchet and a baton differ; so do a bat, a sledge, a fire axe, a spear and a katana");
  check(weaponModel("zzz_no_such_weapon") === null && weaponModel("fists") === null && weaponModel(null) === null, "no model for fists or an unknown key");
}

section("A pose class a weapon");
{
  const want = { ar: "gun", m4: "gun", huntrifle: "gun", shotgun: "pump", tacpump: "pump", pump20: "pump", smg: "smg", uzi: "smg", sawnoff: "smg", pistol: "pistol", pistol45: "pistol", revolver: "revolver", snub38: "revolver", knife: "side", machete: "side", hatchet: "side", baton: "side", sabre: "sabre", cutlass: "sabre", katana: "sword", broadsword: "sword", bat: "shoulder", sledge: "shoulder", fireaxe: "shoulder", pickaxe: "shoulder", spear: "spear", pipespear: "spear", compbow: "bow", pulleybow: "bow", crossbow: "crossbow", xbow: "crossbow", at4: "tube", rpg: "tube", m79: "gun", m32: "gun", lmg: "gun" };
  const bad = Object.entries(want).filter(([k, h]) => F.holdOf(k) !== h).map(([k, h]) => `${k}: ${F.holdOf(k)} not ${h}`);
  check(!bad.length, `the classes split where a weapon needs its own grip${bad.length ? ` (${list(bad)})` : ""}`);
  check(F.holdOf("carry") === "carry" && F.holdOf("fists") === null && F.holdOf("m4|black|optic=acog") === "gun", "holdOf keeps the carry poses, none for fists, and reads a look with parts");
  const counts = {};
  for (const k of KEYS) counts[F.holdOf(k)] = (counts[F.holdOf(k)] || 0) + 1;
  check(HOLDS.every((h) => counts[h]), `every pose class is used (${HOLDS.map((h) => `${h} ${counts[h] || 0}`).join(", ")})`);
  const sm = (k) => weaponModel(k).fore;
  check(sm("ar") && sm("shotgun") && sm("sledge") && sm("spear") && sm("katana") && !sm("pistol") && !sm("knife") && !sm("sabre"), "two-handed holds have a fore point, one-handed none");
  check(weaponModel("shotgun").fore[0] > weaponModel("huntrifle").fore[0] - 3 && weaponModel("katana").fore[0] < 0, "the pump's hand on the slide; a sword's second hand below the first on the hilt");
}

section("The hands are on the weapon at every heading");
{
  const ONE = new Set(["pistol", "revolver", "side", "sabre", "bow"]); // the left hand hangs free, or holds the string
  const off = [], far = [];
  for (const k of KEYS) {
    const limbs = F.figureLimbs(APP, k, null), hands = limbs.filter((L) => L.part === "handR" || L.part === "handL"), wp = limbs.filter((L) => L.group === 1);
    const need = ONE.has(F.holdOf(k)) ? hands.filter((L) => L.part === "handR") : hands;
    for (const h of need) {
      const mid = [(h.A[0] + h.B[0]) / 2, (h.A[1] + h.B[1]) / 2, (h.A[2] + h.B[2]) / 2];
      const d = Math.min(...wp.map((P) => distToPart(mid, P) - Math.max(P.ra, P.rb)));
      if (d > h.ra + 0.6) far.push(`${k} ${h.part} ${d.toFixed(1)}`);
    }
    if (!wp.length) off.push(k);
  }
  check(!off.length, `every figure holding a weapon draws it (group 1 limbs)${off.length ? ` (not: ${list(off)})` : ""}`);
  check(!far.length, `the holding hand's middle lies within a hand's radius of the weapon, both hands on a two-handed one${far.length ? ` (not: ${list(far)})` : ""}`);
  // Painted: wherever a holding hand shows and the weapon shows around it (within 3.5 px of the hand's middle on the
  // grid; the body hides one or the other at some headings), a pixel of that hand touches a weapon pixel (within 4 px).
  const g = { ox: F.FIG.ox, oy: F.FIG.oy, w: F.FIG.w, h: F.FIG.h };
  const paint = (limbs, yaw) => { const p = painter(g.w, g.h); const buf = F.paintLimbs(p, limbs, F.transformOf(yaw), g); return { p, gb: buf.gb }; };
  const gaps = [];
  let checked = 0;
  for (const k of KEYS) {
    const all = F.figureLimbs(APP, k, null), hold = F.holdOf(k);
    const handParts = ONE.has(hold) ? ["handR"] : ["handR", "handL"];
    for (let yaw = 0; yaw < 360; yaw += 45) {
      const W = F.transformOf(yaw), A = paint(all, yaw);
      const wpPx = [];
      for (let i = 0; i < g.w * g.h; i++) if (A.gb[i] === 1) wpPx.push([i % g.w, (i / g.w) | 0]);
      for (const part of handParts) {
        const h = all.find((L) => L.part === part), mid = W([(h.A[0] + h.B[0]) / 2, (h.A[1] + h.B[1]) / 2, (h.A[2] + h.B[2]) / 2]);
        const hx = g.ox + mid[0] - mid[1], hy = g.oy + (mid[0] + mid[1]) / 2 - mid[2];
        if (!wpPx.some(([x, y]) => Math.hypot(x - hx, y - hy) <= 3.5)) continue; // the weapon around this hand is hidden
        const B = paint(all.filter((L) => L.part !== part), yaw), handPx = [];
        for (let i = 0; i < g.w * g.h; i++) if (A.p.px[i] && A.p.px[i] !== B.p.px[i] && isSkin(A.p.px[i])) handPx.push([i % g.w, (i / g.w) | 0]);
        if (!handPx.length) continue; // the hand is hidden (behind the weapon or the body)
        checked++;
        if (!handPx.some(([x, y]) => wpPx.some(([u, v]) => Math.abs(u - x) <= 4 && Math.abs(v - y) <= 4))) gaps.push(`${k}@${yaw}:${part}`); // 4 px: a hilt or handle held in two fists shows nothing between them, the blade or barrel starts past the second fist
      }
    }
  }
  check(checked > KEYS.length * 4 && !gaps.length, `at the eight headings a visible holding hand touches the weapon shown around it (${checked} hand views)${gaps.length ? ` (not: ${list(gaps, 12)})` : ""}`);
}

section("The muzzle lies on the barrel");
{
  const guns = KEYS.filter((k) => isGunKey(k)), bad = [], behind = [];
  for (const k of guns) {
    const m = weaponModel(k);
    if (!m.muzzle) { bad.push(`${k}: none`); continue; }
    const on = m.parts.some((P) => distToPart(m.muzzle, P) <= Math.max(P.ra, P.rb) + 0.25);
    const farX = Math.max(...m.parts.map((P) => Math.max(P.A[0], P.B[0])));
    if (!on) bad.push(`${k}: off the parts`);
    else if (m.muzzle[0] < farX - 0.3) bad.push(`${k}: not the far end (${m.muzzle[0].toFixed(1)} < ${farX.toFixed(1)})`);
    if (m.muzzle[0] < 2) behind.push(k);
  }
  check(guns.length >= 70, `${guns.length} guns`);
  check(!bad.length, `every gun's muzzle is on a part of its model, at the far end${bad.length ? ` (not: ${list(bad)})` : ""}`);
  check(!behind.length, `every muzzle is ahead of the fist${behind.length ? ` (not: ${list(behind)})` : ""}`);
  const mz = (k) => { const p = F.paintBoxFigure(APP, k, null, 0); return p.muzzle ? [p.muzzle.mx, p.muzzle.my] : null; };
  check(mz("m4") && mz("sniper") && mz("m4").join() !== mz("sniper").join() && mz("pistol") && !mz("machete"), `the figure's muzzle point is the gun's own (m4 ${mz("m4").map((v) => v.toFixed(1))}, sniper ${mz("sniper").map((v) => v.toFixed(1))}); none for a blade`);
  const plain = weaponModel("m4"), can = weaponModel("m4|black|muzzle=can_l");
  check(can.muzzle[0] > plain.muzzle[0] + 1 && can.parts.length > plain.parts.length, `a fitted suppressor lengthens the gun and moves the muzzle out (${plain.muzzle[0].toFixed(1)} → ${can.muzzle[0].toFixed(1)})`);
  const tube = weaponModel("at4");
  check(tube.hold === "tube" && tube.muzzle[0] > 8, "a rocket tube's muzzle is at the tube's far end");
}

section("Fitted parts and finishes show on the model");
{
  const px = (k) => F.paintBoxFigure(APP, k, null, 90).px.join(); // from the right side: the stock shows
  check(px("ar") !== px("ar|black|mag=drum") && weaponModel("ar|black|mag=drum").parts.length >= weaponModel("ar").parts.length, "a drum magazine changes the picture");
  check(px("m4") !== px("m4|black|optic=acog") && px("m4") !== px("m4|black|optic=scope4"), "an optic changes the picture");
  check(px("carbine") !== px("carbine|black|stock=precision"), "a stock changes the picture");
  check(px("huntrifle") !== px("huntrifle|black|bipod=bipod"), "a bipod changes the picture");
  check(px("ak") !== px("ak|black|under=vgrip"), "a fore grip changes the picture");
  check(px("ak") === px("ak|wood|") && px("ak") !== px("ak|black|") && weaponModel("ak|black|").parts.some((P, i) => P.col !== weaponModel("ak").parts[i].col), "a finish changes the colours (the AK's first finish is its wood; black is polymer)");
  check(weaponModel("sniper").parts.length > weaponModel("huntrifle").parts.length, "the sniper rifle carries its own scope and bipod, the hunting rifle neither");
}

section("The cache key includes the weapon");
{
  const n0 = F.figureStats.painted;
  F.figureCanvas(APP, "m4", null, 0); F.figureCanvas(APP, "ak", null, 0);
  check(F.figureStats.painted === n0 + 2, "two weapons on one look are two pictures");
  F.figureCanvas(APP, "m4", null, 0);
  check(F.figureStats.painted === n0 + 2, "the same weapon again is a hit");
  F.figureCanvas(APP, "m4|black|optic=acog", null, 0);
  check(F.figureStats.painted === n0 + 3, "the same gun with a fitted part is its own entry");
  check(F.figureCanvas(APP, "m4|black|muzzle=can_l", null, 0, { cached: true }) === null && F.figureStats.painted === n0 + 3, "a cached-only lookup of an unpainted weapon paints nothing");
  F.figureCanvas(APP, "m4", null, 15); F.figureCanvas(APP, "m4", null, 15);
  check(F.figureStats.painted === n0 + 4, "a heading is a key of its own; the same heading again a hit");
}

section("The dead and the downed, the spin");
{
  const state = { seed: 7, survivors: [], factions: [] };
  const t = { id: 3, side: "enemy", kind: "human", kit: "raiders", weapon: "shotgun", dead: true };
  const b = { setup: { enemy: {} }, raid: { containers: [] } };
  const n0 = F.figureStats.painted;
  F.unitFigureDown(state, b, t, 0, 0);
  const bS = { setup: { enemy: {} }, raid: { containers: [{ kind: "body", uid: 3, searched: true }] } };
  F.unitFigureDown(state, bS, t, 0, 0);
  check(F.figureStats.painted === n0 + 2, "a dead raider's figure with the shotgun beside it and the same body searched are two pictures");
  const dead = F.figureLimbs({ ...APP, down: { pose: "dead", pool: true } }, "shotgun", null), down = F.figureLimbs({ ...APP, down: { pose: "down", pool: false } }, "shotgun", null);
  check(dead.some((L) => L.group === 1) && !down.some((L) => L.group === 1), "the weapon lies beside the dead, not beside the downed");
  const low = Math.min(...dead.filter((L) => L.group === 1).map((L) => Math.min(L.A[0], L.B[0])));
  check(low < 0, "the dropped weapon lies at the ground (behind the lying body's back plane)");
  const sp = F.figureSpinImg({ seed: 1, survivors: [] }, { id: 9, gear: { weapon: { key: "m4", mods: { optic: { key: "acog" } } } } }, 7);
  const key = /data-spin="([^"]*)"/.exec(sp);
  check(key && /m4\|/.test(key[1]) && /optic=acog/.test(key[1]), `the inventory spin's key carries the weapon look (${key && key[1].slice(-30)})`);
  const stuck = Object.keys(MELEE).filter((k) => !GEAR[k]).concat(Object.keys(BOWS).filter((k) => !GEAR[k]));
  check(!stuck.length, `every table entry names a GEAR item${stuck.length ? ` (not: ${list(stuck)})` : ""}`);
  const P = placeModel(weaponModel("ar"), [1, 2, 3], [0, 1, 0]);
  check(Math.abs(P.muzzle[0] - 1) < 0.01 && P.muzzle[1] > 2, "placeModel turns a model along a direction (the muzzle along +y)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
