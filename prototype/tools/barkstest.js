// Combat barks (ui/barks.js): short speech bubbles over heads in battle.
// - A scripted run of events and state changes on a real battle gives the expected triggers (reload, empty, jam and
//   unjam, hit, hit bad, low health, crit, going down and man down with the name, kills of the dead and of people,
//   throws, suppress, overwatch shot and watch, hunker, revive started and done, surrender, the first special dead
//   seen with its groan, the retreat sounded).
// - The cooldown, one bubble a unit and the cap of three; important ones always go up.
// - Lines are the same for the same seq and unit, under 24 characters, no strong words; trait and background pick
//   from their own pools, enemies by kind, the dead only groan.
// - Fog: an enemy nobody sees says nothing. The option: Off gives none, Important only only man down / going down.
// - The battle is not touched: the same seeded battle played twice, with and without barks, ends the same.
// - The hook in ui/combat.js draws them on stub canvases with no NaN.
// Usage: node tools/barkstest.js
import { battles } from "./isobattles.js";
import * as C from "../src/sim/combat.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };

let nan = 0;
const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 7 }) }, {
  get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
  set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
});
const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const BK = await import("../src/ui/barks.js");
const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
const { detectBarks, emitBarks, drawBarks, lineFor, voiceOf, poolsFor, LINES, BARK, IMPORTANT, barkState, resetBarks, TRIGGERS } = BK;

const all = () => true;
const trigs = (list) => list.map((e) => `${e.trig}@${e.unit.name}`);
const has = (list, trig, u) => list.some((e) => e.trig === trig && (!u || e.unit === u));
const free = (b, x0, y0) => { // an empty cell near (x0, y0)
  for (let r = 1; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = x0 + dx, y = y0 + dy;
    if (x < 0 || y < 0 || x >= b.w || y >= b.h || C.unitAt(b, x, y) || !C.CELL[b.cells[y * b.w + x].k].walk) continue;
    return [x, y];
  }
  return null;
};

// ---------- 1. a scripted run ----------
console.log("Triggers from events and state");
{
  const { st, b } = battles(31, ["field-town"])[0];
  b.phase = "player";
  const mine = b.units.filter((u) => u.side === "player" && C.active(u));
  const foes = b.units.filter((u) => u.side === "enemy" && C.active(u));
  const [A, B, D] = mine;
  resetBarks();
  check(detectBarks(st, b, all).length === 0, "the first look at a battle only takes its picture");
  check(detectBarks(st, b, all).length === 0, "nothing changed: nothing to say");
  // B next to A (for the revive), and someone with a magazine.
  const nb = free(b, A.x, A.y); B.x = nb[0]; B.y = nb[1];
  detectBarks(st, b, all);
  const gun = mine.find((u) => C.hasMag(u)) || A;
  C.loadMag(gun, 1);
  detectBarks(st, b, all);
  C.loadMag(gun, null);
  let L = detectBarks(st, b, all);
  check(has(L, "reload", gun), `a magazine filled up again: reload (${trigs(L)})`);
  C.loadMag(gun, 0);
  L = detectBarks(st, b, all);
  check(has(L, "empty", gun) || has(L, "outofammo", gun), `a magazine run dry: empty or out of ammo (${trigs(L)})`);
  C.loadMag(gun, null);
  detectBarks(st, b, all);
  gun.jam = { kind: "stovepipe", ap: 1 };
  L = detectBarks(st, b, all);
  check(has(L, "jam", gun), "a jam");
  gun.jam = null;
  L = detectBarks(st, b, all);
  check(has(L, "unjam", gun), "the jam cleared");
  A.hp = A.maxHp; detectBarks(st, b, all);
  A.hp -= 2; L = detectBarks(st, b, all);
  check(has(L, "hit", A), `a small hit: I'm hit (${trigs(L)})`);
  A.hp -= Math.ceil(A.maxHp * 0.35); L = detectBarks(st, b, all);
  check(has(L, "hitbad", A) || has(L, "lowhp", A), `a big one: hit bad (${trigs(L)})`);
  A.hp = A.maxHp * 0.35; detectBarks(st, b, all);
  A.hp = A.maxHp * 0.25; L = detectBarks(st, b, all);
  check(has(L, "lowhp", A), "under 30% health: low health");
  const E = foes[0];
  A.hp = A.maxHp; detectBarks(st, b, all);
  C.fx(b, { type: "shot", from: [E.x, E.y], to: [A.x, A.y], hit: true, crit: true, dmg: 3, side: "enemy" });
  A.hp -= 3; L = detectBarks(st, b, all);
  check(has(L, "crit", A), "a critical hit taken: crit");
  A.down = true; A.hp = 0; L = detectBarks(st, b, all);
  const md = L.find((e) => e.trig === "mandown");
  check(has(L, "goingdown", A), "going down: their own shout");
  check(md && md.unit !== A && md.unit.side === "player" && md.vars.n === A.name.split(" ")[0], `a teammate shouts man down with the name (${md && md.unit.name}: ${md && md.vars.n})`);
  check(!detectBarks(st, b, all).length, "nothing more from the fallen");
  C.fx(b, { type: "heal", to: [A.x, A.y] });
  B.ap = 0;
  L = detectBarks(st, b, all);
  check(has(L, "revive", B), `a heal on a downed teammate: the one next to them (${trigs(L)})`);
  A.down = false; A.hp = 10; L = detectBarks(st, b, all);
  check(has(L, "revived", A), "back on their feet: revived");
  // A kill: a shot from B onto an enemy that dies (a person), and one of the dead in the forest below.
  C.fx(b, { type: "shot", from: [B.x, B.y], to: [E.x, E.y], hit: true, crit: false, dmg: 30, side: "player" });
  E.hp = 0; E.dead = true; L = detectBarks(st, b, all);
  check(has(L, "kill_human", B), `a kill of a person (${trigs(L)})`);
  check(L.some((e) => e.trig === "mandown" && e.unit.side === "enemy"), "their side shouts too");
  for (const [item, trig] of [["frag", "frag"], ["molotov", "molotov"], ["flashbang", "flash"], ["smokegren", "smoke"]]) {
    C.fx(b, { type: "throw", from: [D.x, D.y], to: [D.x + 3, D.y], item });
    L = detectBarks(st, b, all);
    check(has(L, trig, D), `throwing a ${item}: ${trig}`);
  }
  C.fx(b, { type: "throw", from: [D.x, D.y], to: [D.x + 3, D.y], item: "bottle" });
  check(!detectBarks(st, b, all).length, "a lure bottle: nothing");
  C.fx(b, { type: "shot", from: [D.x, D.y], to: [D.x + 4, D.y], hit: false, side: "player", suppress: true, rounds: 10 });
  L = detectBarks(st, b, all);
  check(has(L, "suppress", D), "suppressing fire");
  b.phase = "enemy";
  C.fx(b, { type: "shot", from: [D.x, D.y], to: [foes[1].x, foes[1].y], hit: false, side: "player" });
  L = detectBarks(st, b, all);
  check(has(L, "owshot", D), "a shot in the enemy's turn: overwatch");
  b.phase = "player";
  D.ow = true; L = detectBarks(st, b, all);
  check(has(L, "watch", D), "going on overwatch");
  B.hunker = true; L = detectBarks(st, b, all);
  check(has(L, "hunker", B), "hunkering down");
  const F = foes[2];
  F.surr = true; F.down = true; L = detectBarks(st, b, all);
  check(has(L, "surrender", F) && !has(L, "goingdown", F) && !has(L, "mandown"), "an enemy gives up: their own line, no man down");
  b.retreatOrder = { turn: b.turn, by: "player", escaped: [], caught: [], carried: [], dropped: [], lines: [] };
  L = detectBarks(st, b, all);
  check(L.some((e) => e.trig === "retreat" && e.unit.side === "player"), "the retreat sounded");
  check(!detectBarks(st, b, all).some((e) => e.trig === "retreat"), "once");
}
{
  const { st, b } = battles(32, ["field-forest"])[0];
  b.phase = "player";
  resetBarks();
  detectBarks(st, b, all);
  const P = b.units.find((u) => u.side === "player" && C.active(u)), Z = b.units.find((u) => u.kind === "zombie" && C.active(u));
  C.fx(b, { type: "shot", from: [P.x, P.y], to: [Z.x, Z.y], hit: true, crit: false, dmg: 30, side: "player" });
  Z.hp = 0; Z.dead = true;
  let L = detectBarks(st, b, all);
  check(has(L, "kill_dead", P) && !L.some((e) => e.unit.kind === "zombie"), `a kill of the dead: their own lines, the dead say nothing (${trigs(L)})`);
  const Z2 = b.units.find((u) => u.kind === "zombie" && C.active(u) && u !== Z);
  Z2.ztype = "brute";
  L = detectBarks(st, b, all);
  const sp = L.find((e) => e.trig === "special");
  check(sp && sp.unit.side === "player" && sp.vars.z === "Brute" && has(L, "groan", Z2), `the first special dead seen: a callout and its groan (${trigs(L)})`);
  const Z3 = b.units.find((u) => u.kind === "zombie" && C.active(u) && u !== Z && u !== Z2);
  Z3.ztype = "brute";
  check(!detectBarks(st, b, all).some((e) => e.trig === "special"), "a second of the same kind: no new callout");
  Z2.hp -= 5;
  check(!detectBarks(st, b, all).length, "a special dead hit: still no words");
}

// ---------- 2. cooldown, one a unit, the cap ----------
console.log("Cooldown and cap");
{
  const { st, b } = battles(33, ["field-city"])[0];
  resetBarks();
  detectBarks(st, b, all);
  const us = b.units.filter((u) => u.kind === "human" && C.active(u)).slice(0, 6);
  const keep = BARK.CHANCE;
  BARK.CHANCE = 1;
  const T = (u, trig = "hit", k = 1) => ({ unit: u, trig, key: `${k}:${u.id}`, vars: {} });
  let got = emitBarks(st, us.map((u) => T(u)), 0, "on");
  check(got.length === 3 && barkState.live.length === 3, `six at once: three bubbles (${got.length})`);
  got = emitBarks(st, [T(us[0], "hit", 2), T(us[0], "crit", 2)], 100, "on");
  check(got.length === 0, "the same unit again within its cooldown: nothing");
  check(emitBarks(st, [T(us[4], "hit", 3), T(us[4], "reload", 3)], 200, "on").length === 0, "the cap holds");
  got = emitBarks(st, [T(us[4], "hit", 4), T(us[4], "reload", 4)], 2000, "on");
  check(got.length === 1 && got[0].trig === "hit", "after the first ones fade: one bubble, the higher trigger");
  check(emitBarks(st, [T(us[4], "jam", 5)], 3000, "on").length === 0 && emitBarks(st, [T(us[4], "jam", 6)], 5100, "on").length === 1, "a unit's cooldown is about 3 s");
  resetBarks(); detectBarks(st, b, all);
  emitBarks(st, us.slice(1, 4).map((u) => T(u)), 0, "on");
  const p = us.find((u) => u.side === "player");
  const imp = emitBarks(st, [{ unit: p, trig: "goingdown", key: "9", vars: {} }], 50, "on");
  check(imp.length === 1 && barkState.live.length <= 3 && barkState.live.some((q) => q.imp), "an important one always goes up, pushing out a routine one");
  const imp2 = emitBarks(st, [{ unit: p, trig: "mandown", key: "10", vars: { n: "Ana" } }], 80, "on");
  check(imp2.length === 1 && barkState.live.filter((q) => q.id === p.id).length === 1, "important ones skip the cooldown, still one bubble a unit");
  BARK.CHANCE = keep;
  // Routine ones fire about 40% of the time.
  resetBarks(); detectBarks(st, b, all);
  let n = 0;
  for (let i = 0; i < 400; i++) n += emitBarks(st, [T(us[0], "hit", `r${i}`)], i * 4000, "on").length;
  check(n > 120 && n < 200, `a routine trigger: about 40% (${n} of 400)`);
}

// ---------- 3. lines ----------
console.log("Lines");
{
  const strong = /\b(fuck|shit|bitch|bastard|ass|asshole|cunt|dick|piss|crap|bloody)\b/i;
  let worst = "", bad = [];
  for (const [trig, P] of Object.entries(LINES)) for (const [pool, list] of Object.entries(P)) for (const l of list) {
    const s = l.replace(/\{n\}/g, "Marcus").replace(/\{[Zz]\}/g, "Runner");
    if (s.length > worst.length) worst = s;
    if (s.length > BARK.MAXLEN || strong.test(s)) bad.push(`${trig}.${pool}: ${s}`);
  }
  check(!bad.length, `every line under ${BARK.MAXLEN} characters (a six-letter name), nothing stronger than damn or hell${bad.length ? `: ${bad.join("; ")}` : ` (longest: "${worst}")`}`);
  const counts = TRIGGERS.filter((t) => t !== "groan").map((t) => [t, LINES[t].base.length + Object.values(LINES[t]).reduce((a, l) => a + l.length, 0) - LINES[t].base.length]);
  check(counts.every(([, c]) => c >= 6) && TRIGGERS.filter((t) => t !== "groan" && t !== "surrender").every((t) => LINES[t].base.length >= 4), `every trigger has 6 or more lines (${counts.map(([t, c]) => `${t} ${c}`).join(", ")})`);
  const v = { kind: "person", temper: null, style: null };
  check([1, 2, 3].every(() => lineFor("hit", v, "77:5") === lineFor("hit", v, "77:5")), "the same seq and unit: the same line");
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(lineFor("hit", v, `${i}:5`));
  check(seen.size >= 5, `different events: different lines (${seen.size} of ${LINES.hit.base.length})`);
  // Two copies of one battle, the same changes: the same triggers and lines.
  const runOnce = () => {
    const { st, b } = battles(34, ["field-town"])[0];
    resetBarks(); detectBarks(st, b, all);
    const P = b.units.filter((u) => u.side === "player" && C.active(u));
    P[0].hp -= 3; P[1].down = true; P[2].jam = { kind: "stovepipe", ap: 1 };
    return detectBarks(st, b, all).map((e) => `${e.trig}:${e.unit.id}:${lineFor(e.trig, voiceOf(st, e.unit), e.key, e.vars)}`).join("|");
  };
  const r1 = runOnce(), r2 = runOnce();
  check(r1 === r2 && r1.length > 0, `the same battle and changes: the same lines (${r1.split("|").slice(0, 3).join(", ")})`);
}

// ---------- 4. voices ----------
console.log("Trait and background flavour");
{
  const st = { survivors: [
    { id: 1, traits: ["brave"], background: "veteran" }, { id: 2, traits: ["coward"], background: "teacher" },
    { id: 3, traits: [], background: "cop" }, { id: 4, traits: [], background: "office" }, { id: 5, traits: ["tough"], background: "farmer" },
  ] };
  const P = (sid) => ({ id: 100 + sid, side: "player", kind: "human", sid, name: "Pat Doe" });
  const V = (sid) => voiceOf(st, P(sid));
  check(V(1).temper === "bold" && V(1).style === "terse", "brave veteran: bold and terse");
  check(V(2).temper === "nervous" && V(2).style === "chatty", "coward teacher: nervous and chatty");
  check(V(3).temper === null && V(3).style === "terse" && V(4).style === "chatty" && V(5).style === null && V(5).temper === null, "a cop terse, an office worker chatty, a farmer plain");
  const from = (sid, trig) => { const out = new Set(); for (let i = 0; i < 300; i++) out.add(lineFor(trig, V(sid), `${i}:${sid}`)); return out; };
  const inPools = (set, trig, pools) => [...set].every((l) => pools.some((p) => (LINES[trig][p] || []).includes(l)));
  const hits1 = from(1, "hit"), hits2 = from(2, "hit");
  check(inPools(hits1, "hit", ["bold", "terse", "base"]) && LINES.hit.bold.some((l) => hits1.has(l)) && LINES.hit.terse.some((l) => hits1.has(l)), "the brave veteran: bold, terse and common lines");
  check(!LINES.hit.nervous.some((l) => hits1.has(l)) && !LINES.hit.chatty.some((l) => hits1.has(l)), "never the nervous or chatty ones");
  check(inPools(hits2, "hit", ["nervous", "chatty", "base"]) && LINES.hit.nervous.some((l) => hits2.has(l)) && !LINES.hit.bold.some((l) => hits2.has(l)), "the coward teacher: nervous and chatty, never bold");
  const hits5 = from(5, "hit");
  check(inPools(hits5, "hit", ["base"]), "the farmer: the common lines only");
  const bold = [...hits1].length ? [...Array(300).keys()].filter((i) => LINES.hit.bold.includes(lineFor("hit", V(1), `${i}:1`))).length : 0;
  check(bold > 100, `a trait's pool comes up most (${bold} of 300 bold)`);
  const E = (kit) => ({ id: 9, side: "enemy", kind: "human", kit, name: "X" });
  const lines = (kit, trig) => { const out = new Set(); for (let i = 0; i < 100; i++) out.add(lineFor(trig, voiceOf(st, E(kit)), `${i}`)); return out; };
  check([...lines("raiders", "hit")].every((l) => LINES.hit.raider.includes(l)), "raiders taunt (their own pool)");
  check([...lines("soldiers", "mandown")].every((l) => LINES.mandown.radio.includes(l)), "soldiers talk like a radio");
  check([...lines("zealots", "kill_human")].every((l) => LINES.kill_human.zealot.includes(l)), "zealots preach");
  check([...lines("militia", "reload")].every((l) => LINES.reload.enemy.includes(l)) && [...lines("zealots", "unjam")].every((l) => LINES.unjam.enemy.includes(l)), "other fighters, or a line their kind has none of: the plain enemy pool");
  check([...lines("raiders", "mandown")].every((l) => !/\{n\}/.test(LINES.mandown.raider.join()) && !l.includes("{")), "enemy lines name nobody");
  const Zp = { id: 7, side: "enemy", kind: "zombie", name: "Zombie" }, Zs = { ...Zp, ztype: "brute" };
  check(!lineFor("hit", voiceOf(st, Zp), "1") && !lineFor("groan", voiceOf(st, Zp), "1"), "the ordinary dead say nothing");
  check(!lineFor("hit", voiceOf(st, Zs), "1") && LINES.groan.dead.includes(lineFor("groan", voiceOf(st, Zs), "1")), "a special one only groans");
  check(poolsFor("hit", { kind: "person" }).length === 1, "no trait, no background: the common pool");
}

// ---------- 5. fog and the option ----------
console.log("Fog and the option");
{
  const { st, b } = battles(35, ["field-town"])[0];
  b.phase = "player";
  resetBarks();
  const mineOnly = (u) => u.side === "player";
  detectBarks(st, b, mineOnly);
  const E = b.units.find((u) => u.side === "enemy" && C.active(u));
  E.hp -= 2; E.hunker = true;
  let L = detectBarks(st, b, mineOnly);
  check(!L.some((e) => e.unit.side !== "player"), "an enemy nobody sees: no bark");
  E.hp -= 2;
  L = detectBarks(st, b, all);
  check(has(L, "hit", E), "the same enemy seen: it barks");
  // Seen enemies through the drawing's own fog: a hidden enemy is never drawn.
  BK.setBarkMode("on");
  const keep = BARK.CHANCE; BARK.CHANCE = 1;
  E.hp -= 2; emitBarks(st, detectBarks(st, b, all), 0, "on");
  const ctx = silent();
  const V = (vis) => ({ visible: vis, head: (u) => [400 + u.x * 10, 300 + u.y * 5], w: 1600, h: 900, top: 40, font: 18, sel: null });
  check(drawBarks(ctx, b, 100, V(all)) === 1 && drawBarks(ctx, b, 100, V(mineOnly)) === 0, "a bubble already up is not drawn once the enemy is out of sight");
  BARK.CHANCE = keep;
  // The option.
  const P = b.units.filter((u) => u.side === "player" && C.active(u));
  const evs = [{ unit: P[0], trig: "hit", key: "1", vars: {} }, { unit: P[1], trig: "goingdown", key: "1", vars: {} }, { unit: P[2], trig: "mandown", key: "1", vars: { n: "Ana" } }, { unit: E, trig: "mandown", key: "1", vars: {} }];
  BARK.CHANCE = 1;
  resetBarks(); detectBarks(st, b, all);
  check(emitBarks(st, evs, 0, "off").length === 0, "Off: no barks");
  resetBarks(); detectBarks(st, b, all);
  const imp = emitBarks(st, evs, 0, "important");
  check(imp.length === 2 && imp.every((q) => IMPORTANT.has(q.trig) && q.side === "player"), `Important only: your people's going down and man down (${imp.map((q) => q.trig)})`);
  resetBarks(); detectBarks(st, b, all);
  check(emitBarks(st, evs, 0, "on").length === 3, "On: the rest too (within the cap)");
  BARK.CHANCE = keep;
  BK.setBarkMode("off");
  check(BK.barkMode() === "off", "the option is set");
  BK.setBarkMode("nonsense");
  check(BK.barkMode() === "off", "an unknown value leaves it");
  BK.setBarkMode("on");
  const S = await import("../src/ui/settings.js");
  check(typeof S.SETTINGS_CHANGE["set-barks"] === "function", "the settings change handler");
  S.SETTINGS_CHANGE["set-barks"](null, {}, { value: "important" });
  check(BK.barkMode() === "important", "Options → Combat barks: Important only");
  BK.setBarkMode("on");
}

// ---------- 6. the battle is not touched ----------
console.log("Sim results unchanged");
{
  const play = (withBarks) => {
    const { st, b } = battles(36, ["field-city"])[0];
    resetBarks();
    const ctx = silent();
    const V = { visible: (u) => u.side === "player" || C.playerSees(b, u), head: (u) => [u.x * 20, u.y * 10 + 60], w: 1600, h: 900, top: 40, font: 16, sel: null };
    let t = 0, guard = 0, said = 0;
    const frame = () => { if (withBarks) { t += 250; said += BK.barkFrame(ctx, st, b, t, V); } };
    frame();
    while (!b.over && b.turn < 8 && guard++ < 3000) {
      if (b.phase === "player") C.autoPlayerTurn(st);
      else if (b.phase === "enemy") { if (!C.enemyStep(st)) frame(); }
      else break;
      frame();
    }
    const units = b.units.map((u) => [u.id, u.x, u.y, Math.round(u.hp * 100), !!u.down, !!u.dead, u.mag ?? null, !!u.jam].join(",")).join(";");
    return { log: b.log.map((l) => l.text).join("\n"), units, rng: b.rng.state, wrng: st.rng.state, turn: b.turn, over: !!b.over, said, fx: b.fxSeq };
  };
  const a = play(true), c = play(false);
  check(a.said > 0, `barks were drawn along the way (${a.said} bubble-frames)`);
  check(a.log === c.log && a.units === c.units && a.turn === c.turn && a.over === c.over && a.fx === c.fx, `the same battle played with and without barks ends the same (turn ${a.turn}, ${a.log.split("\n").length} log lines)`);
  check(a.rng === c.rng && a.wrng === c.wrng, "the battle's dice and the world's RNG are where they were");
}

// ---------- 7. the hook in ui/combat.js ----------
console.log("Drawn in the battle view");
{
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
  BK.setBarkMode("on");
  for (const view of ["iso", "top"]) {
    UI.setBattleView(view);
    const { st, b } = battles(37, ["field-town"])[0];
    b.phase = "player";
    resetBarks();
    nan = 0;
    let err = "";
    const draw = (t) => { try { UI.drawCombat(st, t); } catch (e) { err = e.stack.split("\n").slice(0, 2).join(" "); } };
    draw(1000);
    const P = b.units.filter((u) => u.side === "player" && C.active(u));
    P[0].down = true; P[0].hp = 0;
    draw(1100);
    check(!err && barkState.live.some((q) => q.id === P[0].id && q.trig === "goingdown") && barkState.live.some((q) => q.trig === "mandown"), `${view}: someone going down, through drawCombat: the shout and the man down${err ? ` (${err})` : ""}`);
    draw(1500);
    check(!err && !nan, `${view}: drawn with no NaN`);
    draw(1100 + BARK.LIFE + 10);
    check(!barkState.live.length, `${view}: gone after about ${BARK.LIFE / 1000} s`);
  }
  UI.setBattleView("iso");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
