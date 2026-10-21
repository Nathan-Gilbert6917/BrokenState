// The counter-dead (src/sim/counterdead.js, tunnels.js, deadpool.js; hiveconst.js COUNTER, DIG, POOL; GROWTHS tunnels,
// meltpool, huskbed, blastscar, gloom; ZTYPES digger, melter, husk, tripper, darkwalker). Checks:
//   - Digger: goes down only on bare ground, comes up only on bare ground, under a wall line, wire, a trench and mines
//     (nothing set off), its dig time by the length; the tunnel stays; a walker crawls through it (reachable links the
//     ends, moveAlong sends it under, it comes up at the far end); a blocked exit never puts it on an occupied or
//     unbare cell, and it is never stuck under
//   - the base: a fight's open tunnels are kept on the base and laid on the next fight's map; Diggers at held walls
//     dig tunnels by the numbers, placed on the map when a fight there lays them; Fill tunnel is a job by the length,
//     first in the queue, worked by the builders, and removes the tunnel; the governor queues them; a group fills its own
//   - the other counters on the battle map: a Husk through wire and spike pits, a Melter's blows at a wall, a Tripper
//     onto the mines (and a blast's share), a Dark-walker unseen in floodlight and keeping off lit ground
//   - by the numbers: each kind cuts the part it answers (walls, trench, gate and barricades, wire and pits, mines,
//     lights), open tunnels cut the walls' hold, a group's base the same
//   - adaptation: a hive's read moves toward the defences in reach and jumps when its horde meets them; a counter
//     growth only once the read asks for it; odds and shares grow with the read; capped
//   - breeding: a hive pays for each of the counter-dead (at their cost, fewer when short), its hordes carry them into
//     the by-the-numbers fight and onto the battle map
//   - the pool widening: none at the start; soldiers near military sites, riot police in towns, beasts in the
//     countryside, growing with the years; the era's kinds shaped by the place; the counter kinds only from tier 2;
//     a hive's brood broadening; a whole battle with every new kind ends
//   - determinism: the same seed digs the same tunnels and reads the same
// Usage: node tools/counterdeadtest.js
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, reachable, pathTo, moveAlong, bash, hitMult, endPlayerTurn, runEnemyPhase, autoPlayerTurn, registerCombatHandler, active, closeCombat, CELL } from "../src/sim/combat.js";
import { applyZType, zRevealed, eraKinds, battleTypes } from "../src/sim/zombietypes.js";
import { ZTYPES, GROWTHS, COUNTER, DIG, POOL, TECH, HORDEMIX } from "../src/sim/hiveconst.js";
import { diggable, diggerTurn, tunnelRound, settleTunnels, layTunnels, queueFill, fillHours, digCount, digTunnels, autoFillTunnels, groupFillDaily, tunnelHold, tunnelLinks } from "../src/sim/tunnels.js";
import { defenceProfile, adaptDaily, noteDefences, counterNeed, counterCut, payCounters, tripperTurn, darkTurn, trapProof, counterText } from "../src/sim/counterdead.js";
import { widenMix, broodWiden, shapeKinds, poolPlace } from "../src/sim/deadpool.js";
import { startGrowth, growthWish, mixOdds, hiveMix, siteSpecials } from "../src/sim/hivetech.js";
import { hivesDaily } from "../src/sim/hives.js";
import { holdLimit, holdCheck, defenceMult, spikeKill, minesTake, breakInForce, atTheWalls } from "../src/sim/defences.js";
import { constructionHour } from "../src/sim/buildings.js";
import { endDeploy } from "../src/sim/deploy.js";
import { placeKind } from "../src/sim/zombietypes.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
registerCombatHandler("counterdeadtest", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const pct = (v) => `${Math.round(v * 100)}%`;
const NEW = ["digger", "melter", "husk", "tripper", "darkwalker"];
const GROW = { tunnels: "digger", meltpool: "melter", huskbed: "husk", blastscar: "tripper", gloom: "darkwalker" };

// A battle on open grass, your 3 people and the given dead, all parked on the top row, unaware.
function arena(seed = 7, types = {}, count = 3) {
  const st = createWorld({ seed, factionCount: 4 });
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, 3);
  const b = inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "zombies", count, power: 3, types }, ambush: null, canRetreat: true, handler: "counterdeadtest", context: {} }));
  st.combat = b;
  for (let i = 0; i < b.cells.length; i++) b.cells[i] = { k: "open", f: "grass" };
  b.losCache.fill(0);
  b.evacCols = 0; b.infection = 0; b.corpses = [];
  b.units.forEach((u, i) => { u.x = 1 + i * 2; u.y = 0; u.aware = false; });
  const ps = b.units.filter((u) => u.side === "player");
  return { st, b, ps };
}
const at = (u, x, y) => { u.x = x; u.y = y; };
const cell = (b, x, y) => b.cells[y * b.w + x];
const put = (b, x, y, c) => { b.cells[y * b.w + x] = { f: "grass", ...c }; b.losCache.fill(0); };
// A wall line at column wx (with wire before it, a trench and a mined cell after it): the way round is long.
function wallLine(b, wx) {
  for (let y = 0; y < b.h; y++) {
    put(b, wx, y, { k: "palisade", f: "dirt", hp: 80, mhp: 80 });
    put(b, wx - 1, y, { k: "wire" });
    put(b, wx + 1, y, { k: "trench" });
  }
  cell(b, wx + 2, 9).mine = true; b.mines = { baseId: -1, laid: 1 };
}

section("The Digger: dirt only, under anything, the tunnel");
function digScenario(seed) {
  const { b, ps } = arena(seed, { digger: 1 }, 2);
  const dg = b.units.find((u) => u.ztype === "digger"), z = b.units.find((u) => u.kind === "zombie" && !u.ztype);
  wallLine(b, 12);
  for (let y = 0; y < b.h; y++) for (const x of [15, 16]) put(b, x, y, { k: "open", f: "road" }); // paved: never an exit
  at(ps[0], 20, 9); at(ps[1], 21, 3); at(ps[2], 21, 14);
  at(dg, 8, 9); at(z, 7, 10);
  for (const u of b.units) u.aware = true;
  return { b, ps, dg, z };
}
{
  const { b, ps, dg, z } = digScenario(7);
  const hp0 = dg.hp;
  // Not from paved ground.
  const was = cell(b, 8, 9); b.cells[9 * b.w + 8] = { k: "open", f: "road" };
  check(!diggerTurn(b, dg), "on a road it does not dig (it goes down only on bare ground)");
  b.cells[9 * b.w + 8] = was;
  check(diggable({ k: "open", f: "dirt" }) && diggable({ k: "open", f: "grass" }) && diggable({ k: "open", f: "field" }) && !diggable({ k: "open", f: "road" }) && !diggable({ k: "open", f: "floor" }) && !diggable({ k: "open", f: "gravel" }) && !diggable({ k: "open", f: "rubble" }) && !diggable({ k: "palisade", f: "dirt" }) && !diggable({ k: "open", f: "dirt", mine: true }), "bare ground is dirt, grass or a field, open; not a road, a floor, gravel, rubble, a wall or a mined cell");
  check(diggerTurn(b, dg), "behind a wall line it digs");
  const t = b.tunnels[0];
  check(dg.off && dg.under && !active(dg) && t && !t.open, `it is under the ground (off the map), the tunnel not open yet: ${t.a} → ${t.b} (${t.len} cells)`);
  check(t.len <= DIG.RANGE && t.b[0] > 13 && diggable(cell(b, t.b[0], t.b[1])), `the exit is past the wall and the trench, on bare ground (${cell(b, t.b[0], t.b[1]).f}), never on the road at x 15–16`);
  check(dg.under.left === Math.ceil(t.len / DIG.PER_TURN), `${dg.under.left} turns under for ${t.len} cells (${DIG.PER_TURN} a turn)`);
  let turns = 0;
  while (dg.under && turns < 10) { tunnelRound(b); turns++; }
  check(!dg.under && !dg.off && dg.x === t.b[0] && dg.y === t.b[1] && t.open, `it comes up at the exit after ${turns} turns (${dg.x}, ${dg.y}) with the tunnel open`);
  check(dg.hp === hp0 && cell(b, 12 + 2, 9).mine && cell(b, 11, 9).k === "wire" && cell(b, 13, 9).k === "trench" && cell(b, 12, 9).k === "palisade", "under the wire, the wall, the trench and the mine: nothing set off, nothing broken, unhurt");
  check(dg.ap === 1, "it comes up with an action to spend");
  // A walker crawls through it.
  at(z, t.a[0], t.a[1] + (t.a[1] < b.h - 1 ? 1 : -1));
  at(dg, t.b[0] + 1, t.b[1] + 1); // off the exit (someone on it keeps the others in)
  const r = reachable(b, z, z.mob * 2);
  check(isFinite(r.dist[t.b[1] * b.w + t.b[0] + 1]) || isFinite(r.dist[t.b[1] * b.w + t.b[0]]), "a walker's reach goes through the tunnel to the far side of the wall");
  const links = tunnelLinks(b);
  check(!!links && links.get(t.a[1] * b.w + t.a[0]).some(([j]) => j === t.b[1] * b.w + t.b[0]), "the pathing links the two ends");
  const path = pathTo(r, t.b[0], t.b[1]);
  moveAlong(b, z, path);
  check(z.under && z.off, `moved to the far end, the walker goes down the tunnel (${z.under && z.under.left} turn${z.under && z.under.left === 1 ? "" : "s"} under)`);
  let n = 0;
  while (z.under && n < 10) { tunnelRound(b); n++; }
  check(!z.under && Math.max(Math.abs(z.x - t.b[0]), Math.abs(z.y - t.b[1])) <= 1 && diggable(cell(b, z.x, z.y)), `it comes up at the far end (${z.x}, ${z.y}) after ${n} turn${n === 1 ? "" : "s"}`);
  check(!trapProof(z, "wire") && z.hp > 0, "nothing in between touched it");
}
{
  // A blocked exit: someone on it and no bare ground beside it.
  const { b, ps, dg } = digScenario(9);
  diggerTurn(b, dg);
  const t = b.tunnels[0];
  at(ps[0], t.b[0], t.b[1]);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) { const c = cell(b, t.b[0] + dx, t.b[1] + dy); if (c) c.f = "road"; }
  let n = 0, bad = 0;
  while (dg.under && n < 20) { tunnelRound(b); n++; if (!dg.under && (dg.x === ps[0].x && dg.y === ps[0].y)) bad++; }
  check(!dg.under && n > dg.ap && bad === 0 && diggable(cell(b, dg.x, dg.y)) && !(dg.x === ps[0].x && dg.y === ps[0].y), `blocked, it waits under and comes up elsewhere on bare ground after ${n} turns (${dg.x}, ${dg.y}), never on the one blocking it`);
}
{
  const a1 = digScenario(11), a2 = digScenario(11);
  diggerTurn(a1.b, a1.dg); diggerTurn(a2.b, a2.dg);
  for (let i = 0; i < 4; i++) { tunnelRound(a1.b); tunnelRound(a2.b); }
  check(JSON.stringify(a1.b.tunnels) === JSON.stringify(a2.b.tunnels) && a1.dg.x === a2.dg.x && a1.dg.y === a2.dg.y, `the same seed digs the same tunnel (${JSON.stringify(a1.b.tunnels[0].a)} → ${JSON.stringify(a1.b.tunnels[0].b)})`);
}

section("Tunnels on your base: kept, laid again, filled");
function baseFight(st, types = { digger: 2 }) {
  const h = hub(st);
  const b = inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: 6, power: 2, types }, ambush: null, canRetreat: true, handler: "counterdeadtest", layout: "baseDefence", deploy: true, context: { baseId: h.id } }));
  st.combat = b;
  endDeploy(b);
  return b;
}
{
  const st = createWorld({ seed: 31, factionCount: 4 });
  const h = hub(st);
  const b = baseFight(st);
  const F = b.deployPlan && b.deployPlan.fort;
  check(!!(F && F.inside), "a horde at your hub is fought on the base map (the fort map)");
  const ins = [], outs = [];
  for (let i = 0; i < b.cells.length; i++) if (diggable(b.cells[i]) && !b.units.some((u) => u.x === i % b.w && u.y === ((i / b.w) | 0))) (F.inside[i] ? ins : outs).push([i % b.w, (i / b.w) | 0]);
  const e = ins[0];
  const s = outs.find((p) => Math.max(Math.abs(p[0] - e[0]), Math.abs(p[1] - e[1])) >= 3 && Math.max(Math.abs(p[0] - e[0]), Math.abs(p[1] - e[1])) <= DIG.RANGE);
  b.tunnels = [{ id: 1, a: s, b: e, len: Math.max(Math.abs(s[0] - e[0]), Math.abs(s[1] - e[1])), open: true, seenA: true, seenB: true }];
  b.over = true;
  const kept = settleTunnels(st, b);
  check(kept === 1 && h.tunnels.length === 1 && h.tunnels[0].w === b.w && h.tunnels[0].a[0] === s[0], `the fight over, the open tunnel stays on ${h.name} (${h.tunnels[0].len} cells)`);
  const before = holdLimit(st, h, 0), cutHold = tunnelHold(h);
  check(cutHold === 1 - DIG.HOLD && holdLimit(st, { ...h, tunnels: [] }, 0) >= before, `an open tunnel takes ${pct(DIG.HOLD)} off the walls' hold (×${cutHold})`);
  st.combat = null;
  const b2 = baseFight(st);
  const laid = (b2.tunnels || []).find((t) => t.rec === h.tunnels[0].id);
  check(!!laid && laid.open && laid.seenA && laid.seenB && laid.a[0] === s[0] && laid.b[0] === e[0], "the next fight there starts with it open and known");
  // Diggers at held walls: tunnels by the numbers, placed when the next fight lays them.
  const hz = { id: 999, size: 120, mix: { digger: 0.14 }, hive: null };
  check(digCount(hz) === Math.min(DIG.NUM, Math.floor(120 * 0.14 / DIG.EVERY)), `120 of the dead with 14% Diggers dig ${digCount(hz)} tunnels at walls that held (one every ${DIG.EVERY}, at most ${DIG.NUM})`);
  digTunnels(st, h, 1, hz);
  const abs = h.tunnels[1];
  check(abs && abs.a == null && abs.len >= DIG.LEN[0] && abs.len <= DIG.LEN[1], `a tunnel dug by the numbers has no cells yet (${abs.len} cells long)`);
  st.combat = null;
  const b3 = baseFight(st);
  check(abs.a && diggable(b3.cells[abs.a[1] * b3.w + abs.a[0]]) && diggable(b3.cells[abs.b[1] * b3.w + abs.b[0]]) && b3.deployPlan.fort.inside[abs.b[1] * b3.w + abs.b[0]] && !b3.deployPlan.fort.inside[abs.a[1] * b3.w + abs.a[0]], `the next fight places it: outside ${abs.a} to inside ${abs.b}, both on bare ground`);
  st.combat = null;
  // Filling.
  const job = queueFill(st, h, h.tunnels[0].id);
  check(job && job.hours === fillHours(h.tunnels[0].len) && job.hours === DIG.FILL_BASE + DIG.FILL_PER * h.tunnels[0].len && h.construction[0] === job, `Fill tunnel: ${job.hours} work-hours for ${h.tunnels[0].len} cells (${DIG.FILL_BASE} + ${DIG.FILL_PER} a cell), first in the queue`);
  check(queueFill(st, h, h.tunnels[0].id) === null, "queued once only");
  for (const p of atBase(st, h.id)) p.role = "build";
  const id = h.tunnels[0].id;
  let hrs = 0;
  while (h.tunnels.some((r) => r.id === id) && hrs < 400) { constructionHour(st); hrs++; }
  check(!h.tunnels.some((r) => r.id === id) && !h.construction.includes(job), `the builders fill it in ${hrs} hours and it is gone`);
  const line = autoFillTunnels(st, h);
  check(/queued/.test(line) && h.construction.some((c) => c.type === "filltunnel" && c.tunnel === abs.id), `the governor queues the rest: "${line}"`);
  // A group's base: their crew fills theirs.
  const home = { tunnels: [{ id: 1, len: 6 }] };
  let days = 0;
  while (home.tunnels.length && days < 10) { groupFillDaily(st, null, { 1: home }); days++; }
  check(!home.tunnels.length && days === Math.ceil(fillHours(6) / DIG.GROUP_DAY), `a group fills a 6-cell tunnel in ${days} days (${DIG.GROUP_DAY} work-hours a day)`);
}

section("The other counters on the battle map");
{
  const { b } = arena(13, { husk: 1 }, 2);
  const hk = b.units.find((u) => u.ztype === "husk"), z = b.units.find((u) => u.kind === "zombie" && !u.ztype);
  put(b, 10, 5, { k: "wire", razor: true }); put(b, 11, 5, { k: "spikes" });
  put(b, 10, 8, { k: "wire", razor: true }); put(b, 11, 8, { k: "spikes" });
  at(hk, 9, 5); at(z, 9, 8);
  hk.ap = 2; z.ap = 2;
  const h0 = hk.hp, z0 = z.hp;
  moveAlong(b, hk, [[10, 5], [11, 5], [12, 5]]);
  moveAlong(b, z, [[10, 8], [11, 8], [12, 8]]);
  check(hk.x === 12 && hk.hp === h0 && hk.ap === 2, `a Husk walks through razor wire and a spike pit unhurt and unstopped (at ${hk.x}, hp ${hk.hp}/${h0})`);
  check(z.x === 10 && z.hp < z0 && z.ap === 0, `an ordinary one is caught in the razor wire (at ${z.x}, −${Math.round(z0 - z.hp)}, its turn over)`);
}
{
  const { b } = arena(14, { melter: 1 }, 2);
  const me = b.units.find((u) => u.ztype === "melter"), z = b.units.find((u) => u.kind === "zombie" && !u.ztype);
  put(b, 10, 5, { k: "palisade", f: "dirt", hp: 500, mhp: 500 }); put(b, 10, 8, { k: "palisade", f: "dirt", hp: 500, mhp: 500 });
  at(me, 9, 5); at(z, 9, 8);
  const s = b.rng.state;
  const dm = bash(b, me, 10, 5);
  b.rng.state = s;
  const dz = bash(b, z, 10, 8);
  const want = COUNTER.MELT * (me.dmgMult / z.dmgMult);
  check(Math.abs(dm / dz - want) < 0.25 * want, `a Melter's blow at a wall section ${dm} against an ordinary one's ${dz} (×${COUNTER.MELT} its acid, ×${(me.dmgMult / z.dmgMult).toFixed(2)} its hands)`);
}
{
  const { b, ps } = arena(15, { tripper: 1 }, 2);
  const tr = b.units.find((u) => u.ztype === "tripper");
  at(tr, 5, 9); tr.aware = true; tr.ap = 2;
  at(ps[0], 20, 9);
  cell(b, 7, 10).mine = true; cell(b, 14, 3).mine = true; b.mines = { baseId: -1, laid: 2 };
  check(Math.abs(hitMult(tr, null, { how: "blast" }) - COUNTER.BLAST * tr.armor) < 1e-9, `a blast does ${pct(COUNTER.BLAST)} to it`);
  const hp = tr.hp;
  const did = tripperTurn(b, tr);
  check(did !== undefined && !cell(b, 7, 10).mine && cell(b, 7, 10).crater && cell(b, 14, 3).mine, "a Tripper walks onto the mine it smells (in reach) and sets it off; the far one waits");
  check(tr.hp > 0 && hp - tr.hp < 38, `it takes little of the blast (−${Math.round(hp - tr.hp)})`);
}
{
  const { b, ps } = arena(16, { darkwalker: 1, crawler: 1 }, 2);
  const dw = b.units.find((u) => u.ztype === "darkwalker"), cr = b.units.find((u) => u.ztype === "crawler");
  b.lit = new Uint8Array(b.w * b.h).fill(1);
  at(ps[0], 20, 9); at(ps[1], 21, 9); at(ps[2], 21, 10);
  at(dw, 14, 9); at(cr, 14, 12);
  check(!zRevealed(b, dw) && zRevealed(b, cr), "in floodlight the crawler shows; the Dark-walker does not");
  at(dw, 19, 8);
  check(zRevealed(b, dw), "within reveal range it shows");
  // A lit band straight ahead, the dark round it.
  b.lit = new Uint8Array(b.w * b.h);
  for (let y = 6; y <= 12; y++) for (let x = 6; x <= 19; x++) b.lit[y * b.w + x] = 1;
  at(dw, 4, 9); dw.aware = true; dw.ap = 2;
  const moved = darkTurn(b, dw);
  check(moved && !b.lit[dw.y * b.w + dw.x] && dw.x > 4, `it goes on toward the living through the dark (to ${dw.x}, ${dw.y}), not onto the lit ground`);
}

section("By the numbers: each answers its part");
{
  const st = createWorld({ seed: 41, factionCount: 4 });
  const h = hub(st);
  for (const t of ["trench", "gate", "barricades", "barricades", "barbed_wire", "razor_wire", "spike_pits", "floodlights", "guard_towers"]) h.buildings.push({ id: 9000 + h.buildings.length, type: t });
  h.stock.fuel = 50;
  const plain = holdLimit(st, h, 0, false, null);
  const lim = (mix) => holdLimit(st, h, 0, false, mix);
  for (const k of NEW) {
    const mix = { [k]: 0.1 };
    const c = counterCut(h, mix);
    const parts = Object.entries(COUNTER.CUT[k]).map(([p, v]) => `${p} −${pct(Math.min(COUNTER.MAX, 0.1 * v))}`).join(", ");
    check(Object.entries(COUNTER.CUT[k]).every(([p, v]) => Math.abs(c[p] - Math.min(COUNTER.MAX, 0.1 * v)) < 1e-9), `10% ${ZTYPES[k].name}s: ${parts}`);
  }
  check(lim({ digger: 0.1 }) < plain && lim({ melter: 0.1 }) < plain && lim({ husk: 0.1 }) < plain && lim({ darkwalker: 0.1 }) < plain, `the hold limit falls against them: ${plain} plain, Diggers ${lim({ digger: 0.1 })}, Melters ${lim({ melter: 0.1 })}, Husks ${lim({ husk: 0.1 })}, Dark-walkers ${lim({ darkwalker: 0.1 })}`);
  check(lim({ runner: 0.2 }) === plain && defenceMult(st, h) === defenceMult(st, h, counterCut(h, null)), "the other special dead cut nothing; no mix is the old number");
  check(spikeKill(h, 200, { husk: 0.1 }) < spikeKill(h, 200), `the spike pits take ${spikeKill(h, 200)} of 200, ${spikeKill(h, 200, { husk: 0.1 })} with Husks among them`);
  h.buildings.push({ id: 9100, type: "minefield", mines: 12 });
  check(minesTake(h, 200, { tripper: 0.1 }) < minesTake(h, 200) && minesTake(h, 200) === 24, `the mines take ${minesTake(h, 200)} of 200, ${minesTake(h, 200, { tripper: 0.1 })} with Trippers walking onto them`);
  const c1 = holdCheck(st, h, 150, 0, null), c2 = holdCheck(st, h, 150, 0, { digger: 0.1, melter: 0.08 });
  check(c2.limit < c1.limit, `holdCheck sees it (${c1.limit} → ${c2.limit})`);
  // At the walls: the mines go off on the Trippers.
  const hz = { id: 77, size: 150, mix: { tripper: 0.12 }, hive: null, tile: h.tile };
  st.hordes.push(hz);
  const w = atTheWalls(st, hz, h, {});
  check(w && w.notes.some((s) => /Trippers walked onto the mines/.test(s)), "at the walls the log says the Trippers walked onto the mines");
  check(counterText({ digger: 0.1, husk: 0.05 }).includes("Diggers (against walls and trenches)"), `the warning names them: ${counterText({ digger: 0.1, husk: 0.05 })}`);
}

section("Adaptation: the hive reads the defences");
function hiveWorld(seed, day = 700) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  st.hour = day * 24;
  const hv = st.hives[0];
  hv.born = 0;
  return { st, hv };
}
{
  const { st, hv } = hiveWorld(51);
  const base = st.bases[0];
  base.tile = st.grid.within(hv.tile, 6).find((id) => id !== hv.tile && st.tiles[id].terrain !== "water") ?? base.tile;
  for (const t of ["trench", "trench", "barbed_wire", "razor_wire", "spike_pits"]) base.buildings.push({ id: 9200 + base.buildings.length, type: t });
  const p = defenceProfile(base);
  check(p.trench === 1 && p.wire > 0.8 && p.mines === 0, `the base's profile: trench ${pct(p.trench)}, wire ${pct(p.wire)}, mines ${pct(p.mines)}, walls ${pct(p.walls)}`);
  check(growthWish(st, hv, false) === null || !GROWTHS[growthWish(st, hv, false)].counter, "with no read yet it wishes for no counter growth");
  for (let d = 0; d < 30; d++) adaptDaily(st);
  const a = hv.adapt;
  check(a.trench > 0.3 && a.wire > 0.3 && a.mines === 0, `a month of reading: trench ${pct(a.trench)}, wire ${pct(a.wire)}, mines ${pct(a.mines)}`);
  const before = a.trench;
  noteDefences(st, { hive: hv.id }, base);
  check(hv.adapt.trench > before, `its horde meets them: trench ${pct(before)} → ${pct(hv.adapt.trench)}`);
  check(counterNeed(st, hv, "digger") === hv.adapt.trench && counterNeed(st, hv, "husk") === hv.adapt.wire && counterNeed(st, hv, "tripper") === 0, "each kind's need is its parts' read");
  const wish = growthWish(st, hv, false);
  check(wish === "tunnels" || wish === "huskbed", `now it wishes for a counter growth: ${wish} (${GROWTHS[wish].name})`);
  // Odds and shares.
  hv.res = 80; const g1 = startGrowth(st, hv, "tunnels"); if (g1) g1.ready = st.hour;
  hv.res = 80; const g2 = startGrowth(st, hv, "blastscar"); if (g2) g2.ready = st.hour;
  const o = mixOdds(st, hv, "medium");
  check(o.kinds.digger > o.kinds.tripper && Math.abs(o.kinds.digger - o.kinds.tripper - COUNTER.ODDS * hv.adapt.trench) < 1e-9, `Diggers come along more often (${pct(o.kinds.digger)}) than Trippers (${pct(o.kinds.tripper)}): the read asks for them`);
  let dig = 0, trip = 0, n = 0, over = 0;
  for (let i = 0; i < 200; i++) { st.hour += 1; const m = hiveMix(st, hv, "large").mix; if (!m) continue; n++; dig += m.digger || 0; trip += m.tripper || 0; if ((m.digger || 0) > COUNTER.KIND_MAX + 1e-9 || NEW.reduce((s, k) => s + (m[k] || 0), 0) > COUNTER.SHARE_MAX + 1e-9) over++; }
  check(dig > trip * 1.5, `over ${n} large hordes the Diggers' share ${pct(dig / n)} against the Trippers' ${pct(trip / n)}`);
  check(over === 0, `never more than ${pct(COUNTER.KIND_MAX)} of a kind nor ${pct(COUNTER.SHARE_MAX)} of all the counter-dead`);
  // Determinism: the same seed reads the same.
  const two = hiveWorld(51);
  two.st.bases[0].tile = base.tile;
  for (const t of ["trench", "trench", "barbed_wire", "razor_wire", "spike_pits"]) two.st.bases[0].buildings.push({ id: 9200 + two.st.bases[0].buildings.length, type: t });
  for (let d = 0; d < 30; d++) adaptDaily(two.st);
  check(JSON.stringify(two.hv.adapt) === JSON.stringify(a) || two.hv.adapt.trench === before, "the same seed and the same bases read the same");
}

section("Breeding: paid for, in its hordes, in the fight");
{
  const { st, hv } = hiveWorld(61);
  for (const k of ["pit", "tunnels"]) { hv.res = 80; const g = startGrowth(st, hv, k); if (g) g.ready = st.hour; }
  hv.adapt = { walls: 1, trench: 1, wire: 0, mines: 0, light: 0 };
  // payCounters at its cost.
  hv.res = 100;
  const mix = { digger: 0.1, runner: 0.1 };
  const r = payCounters(st, hv, mix, 100);
  check(r.bred.digger === 10 && Math.abs(r.paid - 10 * ZTYPES.digger.breed) < 1e-9 && Math.abs(hv.res - (100 - r.paid)) < 1e-9 && mix.runner === 0.1, `10 Diggers in a horde of 100 cost ${r.paid} (${ZTYPES.digger.breed} each); the runners nothing`);
  hv.res = 2;
  const m2 = { digger: 0.1 };
  const r2 = payCounters(st, hv, m2, 100);
  check(r2.bred.digger === Math.floor(2 / ZTYPES.digger.breed) && hv.res >= 0 && Math.abs(m2.digger - r2.bred.digger / 100) < 1e-9, `short of resources (2) it brings only ${r2.bred.digger}`);
  hv.res = 0;
  const m3 = { digger: 0.1 };
  payCounters(st, hv, m3, 100);
  check(!m3.digger, "with nothing left, none");
  // The hive's production: its new hordes carry them, paid.
  hv.res = 80;
  for (const h of [...st.hordes]) if (h.hive === hv.id) st.hordes.splice(st.hordes.indexOf(h), 1);
  const stats = st.hiveInfo.stats; const paid0 = stats.counterPaid || 0;
  const n0 = st.hordes.length;
  let got = null;
  for (let d = 0; d < 20 && !got; d++) { hv.res = Math.max(hv.res, 40); hivesDaily(st); st.hour += 24; got = st.hordes.slice(n0).find((h) => h.hive === hv.id && h.mix && h.mix.digger > 0) || null; }
  check(!!got && (stats.counterPaid || 0) > paid0, `a horde of ${got ? got.size : 0} from the hive brings Diggers (${got ? pct(got.mix.digger) : "-"}), ${Math.round(((stats.counterPaid || 0) - paid0) * 100) / 100} resources paid for them`);
  if (got) {
    const base = hub(st);
    const f = breakInForce(st, base, 120, 0, got);
    const types = battleTypes(got.mix, f.count);
    check(f.types && f.types.digger > 0 && types.digger === f.types.digger, `breaking in, they are on the battle map: ${JSON.stringify(f.types)}`);
    check(holdCheck(st, base, got.size, 0, got.mix).limit < holdCheck(st, base, got.size, 0, null).limit || !base.buildings.length, "and they count in the fight by the numbers");
  }
}

section("The pool widens with the years, whatever the hives do");
{
  const st = createWorld({ seed: 71, factionCount: 6 });
  const tiles = st.tiles.filter((t) => t && t.terrain !== "water");
  const city = tiles.find((t) => placeKind(t) === "city");
  const farm = tiles.find((t) => placeKind(t) === "other" && (t.terrain === "plains" || t.terrain === "forest" || t.terrain === "hills") && !st.bases.some((b) => b.tile === t.id));
  const mil = tiles.find((t) => t.loc && t.loc.type === "military");
  const near = mil ? st.grid.neighbors(mil.id).map((id) => st.tiles[id]).find((t) => t.terrain !== "water") : null;
  const sum = (m) => Object.values(m || {}).reduce((a, v) => a + v, 0);
  st.hour = 10 * 24;
  check(widenMix(st, city.id) === null && widenMix(st, farm.id) === null, `day 10: nothing (from day ${POOL.START_DAY})`);
  st.hour = 112 * 2 * 24;
  const c2 = widenMix(st, city.id), f2 = widenMix(st, farm.id);
  st.hour = 112 * 6 * 24;
  const c6 = widenMix(st, city.id), f6 = widenMix(st, farm.id);
  check(c2 && c2.riot > 0 && c6.riot > c2.riot && c6.riot <= POOL.RIOT_MAX + 1e-9, `riot police in a city: year 2 ${pct(c2.riot)}, year 6 ${pct(c6.riot)}`);
  check(f2 && Object.keys(f2).every((k) => ZTYPES[k] && ZTYPES[k].beast) && sum(f6) > sum(f2) && sum(f6) <= POOL.BEAST_MAX + 1e-9, `the dead beasts in the countryside (${farm.terrain}): year 2 ${pct(sum(f2))}, year 6 ${pct(sum(f6))} (${Object.keys(f6).join(", ")})`);
  if (near) {
    const n6 = widenMix(st, near.id);
    check(n6 && n6.soldier > 0 && n6.soldier <= POOL.MIL_MAX, `soldiers out of the military site next door: ${pct(n6.soldier)} in year 6`);
  } else check(true, "no military site on this map (skipped)");
  // The era's kinds and the place.
  check(!Object.keys(eraKinds(1)).some((k) => NEW.includes(k)) && NEW.every((k) => Math.abs(eraKinds(2)[k] - ZTYPES[k].share * POOL.WILD) < 1e-9), `the counter-dead join the wild pool at tier 2 (year 5), at ${pct(POOL.WILD)} of their share`);
  const k2 = eraKinds(2), sc = shapeKinds(k2, "city"), so = shapeKinds(k2, "other");
  check(Math.abs(sum(sc) - sum(k2)) < 1e-9 && sc.climber / sum(sc) > so.climber / sum(so) && so.digger / sum(so) > sc.digger / sum(sc), `shaped by the place, the total kept: Climbers ${pct(sc.climber / sum(sc))} of a city's against ${pct(so.climber / sum(so))} of the countryside's; Diggers ${pct(sc.digger / sum(sc))} against ${pct(so.digger / sum(so))}`);
  check(poolPlace(st, city) === "city" && (!mil || poolPlace(st, mil) === "military"), "the kinds of place: a city, a military site");
  const sp = siteSpecials(st, city.id);
  check(sp && sum(sp) > 0, `a city raid in year 6 meets ${Object.keys(sp).length} bred kinds (${pct(sum(sp))})`);
  // A hive's brood: the era's kinds it does not breed.
  st.hour = 30 * 24;
  check(!broodWiden(st, 0, [], 20, 1), "a hive's brood early: nothing extra");
  st.hour = 112 * 6 * 24;
  const bw = broodWiden(st, 2, ["carrier"], 30, 1);
  check(bw && Object.keys(bw).every((k) => k !== "carrier") && Object.values(bw).reduce((a, v) => a + v, 0) <= 29, `year 6, a hive that breeds only Carriers: its brood of 30 has ${JSON.stringify(bw)}`);
  // The Zombie damage dial: a gentle run meets fewer.
  st.worldCfg = { ...(st.worldCfg || {}), zDmg: 0.5 };
  const g6 = widenMix(st, city.id);
  check(g6.riot < c6.riot, `at Zombie damage ×0.5: ${pct(g6.riot)} against ${pct(c6.riot)}`);
  // Determinism.
  st.worldCfg.zDmg = 1;
  check(JSON.stringify(widenMix(st, city.id)) === JSON.stringify(widenMix(st, city.id)), "the same tile on the same day: the same pool");
}

section("A whole battle with every new kind ends");
{
  let ended = 0, dug = 0, stuck = 0, badCell = 0;
  const N = 4;
  for (let i = 0; i < N; i++) {
    const st = createWorld({ seed: 300 + i, factionCount: 4 });
    const h = hub(st);
    h.buildings.push({ id: 9300, type: "minefield", mines: 12 });
    const b = baseFight(st, { digger: 2, melter: 1, husk: 1, tripper: 1, darkwalker: 1 });
    for (let t = 0; t < 120 && !b.over; t++) {
      if (b.phase === "player" || b.phase === "deploy") autoPlayerTurn(st); else runEnemyPhase(st);
      for (const u of b.units) {
        if (u.dead || u.off || u.left || u.fled) continue;
        const c = b.cells[u.y * b.w + u.x];
        if (!c || !CELL[c.k].walk) badCell++;
      }
    }
    if (b.over) ended++;
    dug += (b.tunnels || []).filter((t) => t.open && t.rec == null).length;
    stuck += b.units.filter((u) => u.under && !u.dead).length && b.over ? 1 : 0;
    if (b.over) closeCombat(st);
  }
  check(ended === N, `${ended} of ${N} horde fights at the hub with Diggers, a Melter, a Husk, a Tripper and a Dark-walker ended (${dug} tunnels dug)`);
  check(badCell === 0, "nobody ever stood on a cell nobody can walk on");
  // Behind a wall line on open ground: the Diggers dig, the rest crawl after them.
  let fEnded = 0, fDug = 0, crawled = 0, fBad = 0, under = 0;
  for (let i = 0; i < N; i++) {
    const { st, b, ps } = arena(400 + i, { digger: 3, melter: 1, husk: 1, tripper: 1, darkwalker: 1 }, 10);
    wallLine(b, 12);
    ps.forEach((p, j) => at(p, 19 + j, 8 + j));
    b.units.filter((u) => u.side === "enemy").forEach((u, j) => { at(u, 2 + (j % 5), 3 + Math.floor(j / 5) * 6); u.aware = true; });
    const seen = new Set();
    for (let t = 0; t < 120 && !b.over; t++) {
      if (b.phase === "player") autoPlayerTurn(st); else runEnemyPhase(st);
      for (const u of b.units) {
        if (u.under && u.ztype !== "digger" && !u.under.dig) seen.add(u.id);
        if (u.dead || u.off || u.left || u.fled) continue;
        const c = b.cells[u.y * b.w + u.x];
        if (!c || !CELL[c.k].walk) fBad++;
      }
    }
    if (b.over) fEnded++;
    fDug += (b.tunnels || []).filter((t) => t.open).length;
    crawled += seen.size;
    under += b.units.filter((u) => u.under && !u.dead).length;
  }
  check(fEnded === N && fDug > 0, `${fEnded} of ${N} fights behind a wall line ended; ${fDug} tunnels dug, ${crawled} of the other dead crawled through`);
  check(fBad === 0 && under === 0, "nobody stood on an unwalkable cell, and nobody was left under the ground");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
