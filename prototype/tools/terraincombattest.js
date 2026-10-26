// The lie of the land in a fight (src/sim/highground.js; combat.js HEIGHT, shotOdds, coverAgainst, los, distField,
// scoreCell; the user's word 2026-10-23: "improve high ground accuracy and sight range, low ground inaccuracy and can't
// see beyond the first tiles around a hollow. High ground acts as half cover if one layer high and can see the survivor
// and full cover if two layers high. You can use hills to see into upper floors of buildings if any are in range with a
// window. Update AI pathing").
// Checks: aim by the height difference (High ground +, Uphill −, the breakdown's labels), sight by height, a hollow's
// rim (both ways), cover a level up (half, still seen) and two up (full), the target card's "half cover: hill"; the
// pathfinders (reachable, distField) climb the hills a level a step, the dead go round a tall hill and people over it
// when that is cheaper, never through crag; a raider with a gun takes the high ground and leaves a hollow; a raid in a
// building with storeys: from a hill as high as an upper floor a survivor sees and shoots in through a window (not
// through a wall, not from too low, not out of range), and the raider at the window shoots back.
// The window raider made of one of the dead drops the dead's wild and beast flags with its zombie type: a wild unit's
// foes are every living non-zombie, itself too once a person (combat.js foesOf; issue #44, 2026-10-26).
// Usage: node tools/terraincombattest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import {
  createBattle, combatAct, registerCombatHandler, endPlayerTurn, runEnemyPhase, active, CELL, HEIGHT, COVER_DEF,
  reachable, pathTo, distField, shotOdds, coverAgainst, sightRange, canSee, canSeeAt, los, playerSees,
} from "../src/sim/combat.js";
import { windowSees, hollowShut, terrainScore, TERRAIN_AI, windowFoes } from "../src/sim/highground.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { newItem } from "../src/sim/inventory.js";
import { targetCardHtml } from "../src/ui/battlehud.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
registerCombatHandler("tct", () => {});

// An open field with nothing on it (clean geometry), two of yours and one raider, every cell level open ground.
function cleanBattle(s = seed) {
  const st = createWorld({ seed: s, factionCount: 6 });
  st.started = true;
  const h = hub(st);
  for (const p of atBase(st, h.id)) { p.health = 100; if (!p.gear.weapon) p.gear.weapon = newItem("pistol"); }
  h.stock.ammo = 300;
  const ids = atBase(st, h.id).slice(0, 2).map((p) => p.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy: { kind: "raiders", count: 1, power: 3 }, ambush: null, canRetreat: false, handler: "tct", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; delete c.h; delete c.t; delete c.ter; delete c.ch; }
  b.losCache.fill(0); b.reach.fill(1);
  b.phase = "player";
  const [p, q] = b.units.filter((u) => u.side === "player");
  const e = b.units.find((u) => u.side === "enemy");
  for (const u of b.units) if (u !== p && u !== q && u !== e) { u.dead = true; u.x = 0; u.y = 0; }
  q.x = 0; q.y = b.h - 1;
  e.aware = true; e.surprised = false;
  return { st, b, p, q, e };
}
const cell = (b, x, y) => b.cells[y * b.w + x];
const ground = (b, x, y, h) => { const c = cell(b, x, y); c.k = "open"; if (h) { c.h = h; c.ter = 1; } else { delete c.h; delete c.ter; } b.losCache.fill(0); };
// A hill: level L on the core rect, a level less each ring out (eight ways), on the map.
function hill(b, x0, y0, x1, y1, L) {
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const d = Math.max(x < x0 ? x0 - x : x > x1 ? x - x1 : 0, y < y0 ? y0 - y : y > y1 ? y - y1 : 0);
    const lv = L - d;
    if (lv > 0 && lv > (cell(b, x, y).h || 0)) ground(b, x, y, lv);
  }
}
const label = (o, re) => (o.parts || []).find(([l]) => re.test(l));

section("Aim and sight by height");
{
  const { b, p, e } = cleanBattle();
  const my = Math.floor(b.h / 2);
  p.x = 3; p.y = my; e.x = 11; e.y = my;
  const flat = shotOdds(b, p, e, p.x, p.y, { parts: true }), s0 = sightRange(b, p);
  hill(b, 2, my - 1, 4, my + 1, 2); // the shooter two levels up
  const down = shotOdds(b, p, e, p.x, p.y, { parts: true });
  check(down.chance - flat.chance === 2 * HEIGHT.AIM && label(down, /^High ground$/) && label(down, /^High ground$/)[1] === 2 * HEIGHT.AIM, `two levels over the target: +${down.chance - flat.chance} aim ("High ground +${label(down, /^High ground$/) ? label(down, /^High ground$/)[1] : "?"}")`);
  check(sightRange(b, p) === s0 + 2 * HEIGHT.SIGHT, `sight from two levels up: ${s0} → ${sightRange(b, p)} tiles`);
  check(down.notes.some((n) => /high ground \+10/.test(n)), `the odds line says so ("${down.notes.join(", ")}")`);
  // The other way: the raider shoots up at the hill: uphill, and the hill is full cover two levels up.
  const up = shotOdds(b, e, p, e.x, e.y, { parts: true });
  check(label(up, /^Uphill$/) && label(up, /^Uphill$/)[1] === -2 * HEIGHT.UPHILL && up.cover === 2 && up.high === "hill" && label(up, /^Full cover: hill$/), `shooting up two levels: Uphill ${label(up, /^Uphill$/) ? label(up, /^Uphill$/)[1] : "?"}, "Full cover: hill" (${up.chance}%)`);
  // Three levels: the bonus keeps growing up to MAX_AIM.
  hill(b, 2, my - 1, 4, my + 1, 3);
  const d3 = shotOdds(b, p, e);
  check(d3.chance - flat.chance === Math.min(HEIGHT.MAX_AIM, 3 * HEIGHT.AIM) && sightRange(b, p) === s0 + 3 * HEIGHT.SIGHT, `three levels: +${d3.chance - flat.chance} aim, ${sightRange(b, p)} tiles of sight`);
}

section("High ground as cover: half a level up (still seen), full two up");
{
  const { b, p, e } = cleanBattle();
  const my = Math.floor(b.h / 2);
  e.x = 3; e.y = my; p.x = 10; p.y = my;
  const open = shotOdds(b, p, e);
  ground(b, 3, my, 1); for (const [dx, dy] of [[-1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1]]) ground(b, 3 + dx, my + dy, 1); ground(b, 4, my, 1); ground(b, 4, my - 1, 1); ground(b, 4, my + 1, 1);
  const c1 = coverAgainst(b, 3, my, 10, my), o1 = shotOdds(b, p, e, p.x, p.y, { parts: true });
  check(c1.level === 1 && c1.high === "hill" && canSee(b, p, e), `a level up: half cover from the hill, and still in sight`);
  check(open.chance - o1.chance === COVER_DEF[1] + HEIGHT.UPHILL && label(o1, /^Half cover: hill$/) && label(o1, /^Uphill$/), `the shot: ${open.chance}% → ${o1.chance}% (Half cover: hill −${COVER_DEF[1]}, Uphill −${HEIGHT.UPHILL})`);
  check(coverAgainst(b, 3, my, 4, my).high == null, "a shooter right next to them: the height is no cover");
  const card = targetCardHtml(b, p, e, { ...o1, ok: true, kind: "shot" });
  check(/half cover: hill/.test(card) && /Half cover: hill/.test(card) && /Uphill/.test(card), "the target card: \"half cover: hill\", and the breakdown's Half cover: hill and Uphill rows");
  hill(b, 2, my - 1, 3, my + 1, 2);
  const c2 = coverAgainst(b, 3, my, 10, my);
  check(c2.level === 2 && c2.high === "hill" && canSee(b, p, e), `two levels up: full cover from the hill (seen where the line reaches them)`);
  // A raised floor (a walkway) counts as "higher ground", not a hill.
  ground(b, 3, my, 0); cell(b, 3, my).k = "walkway"; b.losCache.fill(0);
  for (const c of b.cells) if (c.ter) { delete c.h; delete c.ter; }
  b.losCache.fill(0);
  const cw = coverAgainst(b, 3, my, 10, my);
  check(cw.level === 1 && cw.high === "height", "a walkway a level up: half cover, \"higher ground\"");
  cell(b, 3, my).k = "open";
}

section("A hollow sees only its rim");
{
  const { b, p, e } = cleanBattle();
  const my = Math.floor(b.h / 2);
  for (let y = my - 4; y <= my + 4; y++) for (let x = 6; x <= 14; x++) ground(b, x, y, -1); // a hollow 9 across
  p.x = 10; p.y = my; e.x = 15; e.y = my; // e on the rim
  check(canSeeAt(b, p, 15, my) && canSeeAt(b, p, 14, my - 4) && canSeeAt(b, p, 5, my + 5), "from the hollow: the hollow and the first tiles round its rim");
  check(!canSeeAt(b, p, 16, my) && !canSeeAt(b, p, 20, my) && !canSeeAt(b, p, 10, my - 6), "nothing beyond the rim");
  check(!los(b, 20, my, 10, my) && !los(b, 10, my - 7, 10, my) && hollowShut(b, 20, my, 10, my), "and nothing beyond the rim sees in");
  e.x = 20; b.losCache.fill(0);
  check(!canSee(b, e, p) && !canSee(b, p, e), "a raider 10 tiles off and the survivor in the hollow: neither sees the other");
  hill(b, 22, my - 1, 23, my + 1, 3); e.x = 23; b.losCache.fill(0);
  check(!canSee(b, e, p), "not even from a hill three levels up");
  p.x = 15; e.x = 21; b.losCache.fill(0);
  check(!hollowShut(b, 15, my, 21, my) && canSeeAt(b, p, 21, my), "out of it, on the rim: no rim rule, the hill 6 tiles off is seen");
  p.x = 10; b.losCache.fill(0);
  check(sightRange(b, p) === p.sight - HEIGHT.SIGHT, `down a level, sight ${sightRange(b, p)} (${HEIGHT.SIGHT} less)`);
}

section("Pathing over the ground: a level a step, round a tall hill, never through crag");
{
  const { b, p, e, q } = cleanBattle();
  const W = b.w, H = b.h;
  check(W >= 22 && H >= 16, `the field: ${W} × ${H}`);
  const cx = Math.floor(W / 2), ry = 6;
  hill(b, cx - 1, 0, cx + 1, ry, 3); // a ridge three levels up, rows 0..ry+2, open below it
  const ys = 2;
  p.x = 2; p.y = ys; e.x = W - 1; e.y = H - 1; q.x = 0; q.y = H - 1;
  const z = { ...e, id: 9001, kind: "zombie", side: "enemy", x: 2, y: ys, weapon: "claws", f: 0 };
  b.units.push(z); p.x = 0; p.y = 0;
  const rz = reachable(b, z, 200);
  const tx = W - 3;
  const pz = pathTo(rz, tx, ys), maxZ = Math.max(0, ...pz.map(([x, y]) => cell(b, x, y).h || 0));
  check(isFinite(rz.dist[ys * W + tx]) && maxZ === 0, `the dead go round the tall hill (climbing ${HEIGHT.CLIMB_DEAD} a level): highest step ${maxZ}, cost ${rz.dist[ys * W + tx].toFixed(1)}`);
  const fz = distField(b, [[tx, ys]], z);
  check(Math.abs(fz[ys * W + 2] - rz.dist[ys * W + tx]) < 1e-6, `the dead's distance field costs the same way (${fz[ys * W + 2].toFixed(1)}): the hill no wall to it`);
  b.units.pop();
  p.x = 2; p.y = ys;
  const rp = reachable(b, p, 200), pp = pathTo(rp, tx, ys), maxP = Math.max(0, ...pp.map(([x, y]) => cell(b, x, y).h || 0));
  check(isFinite(rp.dist[ys * W + tx]) && maxP === 3, `a survivor (${HEIGHT.CLIMB} a level) goes straight over it: highest step ${maxP}, cost ${rp.dist[ys * W + tx].toFixed(1)}`);
  const fp = distField(b, [[tx, ys]], p);
  check(Math.abs(fp[ys * W + 2] - rp.dist[ys * W + tx]) < 1e-6, `and the field agrees (${fp[ys * W + 2].toFixed(1)})`);
  // Crag: never through it. A wall of crag across the map: no way; a gap in it: through the gap.
  for (const c of b.cells) if (c.ter) { delete c.h; delete c.ter; }
  for (let y = 0; y < H; y++) { const c = cell(b, cx, y); c.k = "crag"; c.ch = 5; }
  b.losCache.fill(0);
  const r1 = reachable(b, p, 200), f1 = distField(b, [[tx, ys]], p);
  check(!isFinite(r1.dist[ys * W + tx]) && !isFinite(f1[ys * W + 2]), "a line of crag across the map: no path, by either pathfinder");
  cell(b, cx, H - 2).k = "open";
  const r2 = reachable(b, p, 200), p2 = pathTo(r2, tx, ys);
  check(isFinite(r2.dist[ys * W + tx]) && p2.every(([x, y]) => cell(b, x, y).k !== "crag") && p2.some(([x, y]) => x === cx && y === H - 2), "a gap in it: the path goes through the gap, never the rock");
  check(!los(b, cx - 2, ys, cx + 2, ys), "and the crag blocks sight");
}

section("A raider with a gun takes the high ground and leaves a hollow");
{
  check(terrainScore({ cells: [{ ter: 1, h: 2 }], w: 1, h: 1 }, 0, 0) === 2 * TERRAIN_AI.HIGH && terrainScore({ cells: [{ ter: 1, h: -1 }], w: 1, h: 1 }, 0, 0) === -TERRAIN_AI.HOLLOW, `the AI's ground score: +${TERRAIN_AI.HIGH} a level up, −${TERRAIN_AI.HOLLOW} a level down`);
  let up = 0, out = 0, runs = 0;
  for (let k = 0; k < 4; k++) {
    const { st, b, p, q, e } = cleanBattle(seed + k);
    const my = Math.floor(b.h / 2);
    p.x = 4; p.y = my; q.x = 3; q.y = my + 1;
    e.x = 14; e.y = my; e.weapon = "pistol"; // a plain gun (a shotgun closes in, an automatic suppresses)
    hill(b, 16, my - 4, 18, my - 3, 2); // a hill a few steps from the raider
    for (const u of b.units) if (u.side === "player") u.ap = 0;
    endPlayerTurn(st); runEnemyPhase(st);
    runs++;
    if ((cell(b, e.x, e.y).h || 0) > 0) up++;
    // The same raider in a hollow with the foes out past its rim: out of it.
    const r = cleanBattle(seed + 10 + k), B = r.b, m2 = Math.floor(B.h / 2);
    for (let y = m2 - 4; y <= m2 + 4; y++) for (let x = 10; x <= 18; x++) ground(B, x, y, -1);
    r.p.x = 3; r.p.y = m2; r.q.x = 3; r.q.y = m2 + 2; r.e.x = 17; r.e.y = m2;
    for (const u of B.units) if (u.side === "player") u.ap = 0;
    endPlayerTurn(r.st); runEnemyPhase(r.st);
    if (!((cell(B, r.e.x, r.e.y).h || 0) < 0) || !active(r.e)) out++;
  }
  check(up >= 3, `the raider went up the hill in ${up} of ${runs} fields`);
  check(out >= 3, `and climbed out of a hollow in ${out} of ${runs}`);
}

section("From a hill into an upper floor through a window");
{
  // A raid in a building with storeys, with a window on its upper floor that looks out over open ground.
  let found = null;
  for (let i = 0; i < 80 && !found; i++) {
    const st = createWorld({ seed: 500 + i, factionCount: 6 });
    st.cards.length = 0;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && ["house", "farmhouse", "lodge", "motel", "police", "school", "clinic", "office", "apartments"].includes(t.loc.type) && t.id !== h.tile);
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 2);
    for (const s of crew) { s.health = 100; s.gear.weapon = newItem("pistol"); }
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 60, meds: 2 } });
    if (res.error) continue;
    const pa = res.party;
    pa.path = [tile.id]; pa.idx = 0; pa.phase = "engaged";
    st.combat = createBattle(st, { mode: "raid", tile: tile.id, partyId: pa.id, canRetreat: true, ambush: null, handler: "tct", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st, tile.id) }, raid: { heat0: 0 }, context: {} });
    const b = st.combat;
    if (!b.floors || b.floors.length < 2) continue;
    const F1 = b.floors[1].cells, G = b.floors[0].cells, W = b.w;
    for (let k = 0; k < F1.length && !found; k++) {
      if (F1[k].k !== "window") continue;
      const wx = k % W, wy = (k / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ix = wx - dx, iy = wy - dy; // inside: the floor's own walkable cell
        const ok = (j) => j >= 0 && j < 7;
        if (ix < 0 || iy < 0 || ix >= W || iy >= b.h || !CELL[F1[iy * W + ix].k].walk) continue;
        let clear = true;
        for (let s = 1; s <= 6 && clear; s++) { const x = wx + dx * s, y = wy + dy * s; if (x < 0 || y < 0 || x >= W || y >= b.h || F1[y * W + x].k !== "void") clear = false; }
        if (clear && ok(0)) { found = { st, b, wx, wy, dx, dy, ix, iy, G }; break; }
      }
    }
  }
  check(!!found, "test setup: a raid in a building with an upper floor and a window over open ground");
  if (found) {
    const { st, b, wx, wy, dx, dy, ix, iy, G } = found;
    const W = b.w;
    b.raid.spawnCap = 0;
    const p = b.units.find((u) => u.side === "player" && active(u)), q = b.units.find((u) => u.side === "player" && u !== p);
    const raider = b.units.find((u) => u.side === "enemy" && u.kind === "human") || b.units.find((u) => u.side === "enemy");
    for (const u of b.units) if (u.side === "enemy" && u !== raider) { u.dead = true; }
    if (q) { q.x = p.x; q.y = p.y; q.dead = true; }
    // No raider of their own in the mix (seed 7: two dead hogs and a zombie): one of the dead made the raider. A dead
    // beast is wild (zombietypes.js applyZType: u.beast, u.wild), and a wild unit's foes are every living thing that is
    // not a zombie (combat.js foesOf), itself once a person: so the wild and the beast go with the zombie type, or it
    // shoots at itself. Red since the repo's first commit 222200d, where the dead beasts were already in the raid mix.
    raider.kind = "human"; raider.weapon = "pistol"; raider.aware = true; raider.surprised = false; delete raider.ztype; delete raider.wild; delete raider.beast; raider.f = 1; raider.away = true; raider.x = ix; raider.y = iy; raider.hp = raider.maxHp = 200;
    // The ground out from the window: level open ground, then a hill a level up 4–6 tiles out.
    for (let s = 1; s <= 6; s++) { const c = G[(wy + dy * s) * W + wx + dx * s]; c.k = "open"; delete c.h; delete c.ter; for (const [ox, oy] of [[dy, dx], [-dy, -dx]]) { const x = wx + dx * s + ox, y = wy + dy * s + oy; if (x >= 0 && y >= 0 && x < W && y < b.h && G[y * W + x].f !== "floor") { G[y * W + x].k = "open"; } } }
    const at = (s) => [wx + dx * s, wy + dy * s];
    const [hx, hy] = at(5);
    for (const s of [4, 5, 6]) { const [x, y] = at(s); G[y * W + x].h = 1; G[y * W + x].ter = 1; }
    p.x = hx; p.y = hy; p.f = 0; p.away = false; p.ap = 2; delete p.face;
    b.losCache.fill(0);
    check(windowSees(b, p, raider) && canSee(b, p, raider) && canSee(b, raider, p), "on a hill a level up, 5 tiles out: the survivor sees the raider at the window, and the raider sees them");
    check(playerSees(b, raider), "the raider upstairs counts as seen (its marker is drawn)");
    const o = shotOdds(b, p, raider, p.x, p.y, { parts: true });
    check(o.cover === 1 && !o.high, `the window's sill is half cover (${o.chance}% to hit)`);
    // A wall instead of the window: nothing.
    const win = b.floors[1].cells[wy * W + wx];
    win.k = "wall";
    check(!windowSees(b, p, raider), "no window there (a wall): not seen");
    win.k = "window";
    // The hill too low: level ground.
    for (const s of [4, 5, 6]) { const [x, y] = at(s); delete G[y * W + x].h; delete G[y * W + x].ter; }
    check(!windowSees(b, p, raider), "from level ground: the upper floor is not seen");
    for (const s of [4, 5, 6]) { const [x, y] = at(s); G[y * W + x].h = 1; G[y * W + x].ter = 1; }
    // Out of range.
    const keep = p.sight; p.sight = 2;
    check(!windowSees(b, p, raider), "out of the survivor's sight: not seen");
    p.sight = keep;
    // Two levels up: the shooter is higher than the floor (high ground +5).
    for (const s of [4, 5, 6]) { const [x, y] = at(s); G[y * W + x].h = 2; }
    G[at(3)[1] * W + at(3)[0]].h = 1; G[at(3)[1] * W + at(3)[0]].ter = 1;
    const o2 = shotOdds(b, p, raider, p.x, p.y, { parts: true });
    check(windowSees(b, p, raider) && label(o2, /^High ground$/) && label(o2, /^High ground$/)[1] === HEIGHT.AIM, `from two levels up: High ground +${label(o2, /^High ground$/) ? label(o2, /^High ground$/)[1] : "?"} into the first floor`);
    // The shot itself, by order.
    const logN = b.log.length;
    const err = combatAct(st, { type: "shoot", unit: p.id, target: raider.id });
    check(!err && p.ap === 0 && b.log.slice(logN).some((l) => l.text.includes(raider.name)), `Shoot through the window: ${err || b.log.slice(logN).map((l) => l.text).find((t) => t.includes(raider.name))}`);
    // The raider's turn: it shoots back through the window.
    raider.hp = raider.maxHp; raider.dead = false; raider.down = false;
    check(windowFoes(b, raider).includes(p), "the raider's AI counts the survivor on the hill as a foe in sight");
    const n2 = b.log.length;
    for (const u of b.units) if (u.side === "player") u.ap = 0;
    endPlayerTurn(st); runEnemyPhase(st);
    check(b.log.slice(n2).some((l) => l.text.includes(raider.name) && l.text.includes(p.name)), `the raider fires back: ${b.log.slice(n2).map((l) => l.text).find((t) => t.includes(raider.name)) || "(nothing)"}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
