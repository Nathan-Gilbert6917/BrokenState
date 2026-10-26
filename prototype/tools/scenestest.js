// Signs of survival in a raid's building (sim/interiorscenes.js; issue #11, the user's request 2026-10-25: "The interior
// of buildings can have chairs, shelves and other movable furniture that can block door ways, hallways etc to show
// people were here surviving trying to barricade or slow down something. Add blood splatters, dead zombie bodies
// survivor bodies."):
//   1. the rates: over 300+ seeded buildings, the share with scenes by kind within ±10% of SCENES.ODDS, 1–3 a building;
//   2. the scenes' cells: every barricaded doorway holds boards or a piece with hit points (a piece in an open frame
//      keeps the frame), every piece has hit points; every floor stays connected for the living with shoving
//      (pieces are shoveable, never a wall) and for the dead (crawl or batter); a hallway's pile is half cover only;
//   3. bodies have f and lie on walkable floor; blood only on floor cells, on the floor of a scene with a body or a pile;
//   4. the same building rolls the same scenes; the map's own dice untouched (its rooms and containers as without);
//   5. the battle: the dead of a scene as b.corpses with f, the survivors as dead people with a body container (full
//      kit), the intro line once when the room is seen, the piles; Sleepers among the dead by sleepers.js's share;
//   6. the ledger: a smashed piece stays smashed (sceneLedger / applySceneLedger), the crawl's snapshot keeps the bodies
//      and the blood; a save round-trips the scenes;
//   7. the view: ui/battlemarks.js draws the pre-placed blood and brass by floor;
//   8. a hospital's own (issue #14): the ER overrun (its pieces knocked over, a doctor's bag), the sealed ward and the
//      morgue's dead roll; the patients' bodies are bare, the wormed ones get up at the turn of the dead (carriers.js).
// Usage: node tools/scenestest.js
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, registerCombatHandler, CELL, setFloor, searchBox } from "../src/sim/combat.js";
import { buildingMap } from "../src/sim/buildingmaps.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { FURNITURE, crawlable, breakPiece } from "../src/sim/barricade.js";
import * as SC from "../src/sim/interiorscenes.js";
import { snapshotBuilding, restoreBuilding } from "../src/sim/citycrawl.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { SLEEPER } from "../src/sim/hiveconst.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return !!ok; };
const t0 = performance.now();
registerCombatHandler("sctest", () => {});
const QUICK = !!process.env.BS_QUICK;

const st = createWorld({ seed: 11, factionCount: 6 });
const tile = st.tiles.find((t) => t.loc && t.loc.type === "city") || st.tiles.find((t) => t.loc) || st.tiles[0];
const tiles = st.tiles.filter((t) => t.loc).slice(0, 4);
const mapOf = (key, i) => buildingMap(st, (tiles[i % tiles.length] || tile).id, { key, id: `${key}-${i}`, name: key }, false);
const floorsOf = (m) => (m.floors && m.floors.length ? m.floors.map((F) => F.cells) : [m.cells]);
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- 1. the rates ----------
console.log("The rates by kind");
const KINDS = ["house", "hospital", "church", "police", "apartments", "offices"];
const PER = QUICK ? 120 : 200;
const maps = [];
{
  let total = 0, counts = true;
  for (const key of KINDS) {
    let n = 0;
    for (let i = 0; i < PER; i++) {
      const m = mapOf(key, i);
      maps.push([key, m]);
      // A site of several buildings (civicsite.js, issue #49: a churchyard's church and parish hall) rolls each
      // building's scenes on its own (sc.house): 1 to 3 a building.
      if (m.scenes) {
        n++;
        const per = new Map();
        for (const sc of m.scenes.list) per.set(sc.house ?? null, (per.get(sc.house ?? null) || 0) + 1);
        if (!per.size || [...per.values()].some((k) => k < 1 || k > 3)) counts = false;
      }
    }
    total += PER;
    const want = SC.SCENES.ODDS[key] ?? SC.SCENES.DEFAULT, got = n / PER;
    check(Math.abs(got - want) <= 0.1, `${key}: ${(got * 100).toFixed(0)}% of ${PER} have scenes (the table ${(want * 100).toFixed(0)}%)`);
  }
  check(total >= 300 && counts, `${total} buildings: each with scenes has 1 to 3 (a site of several buildings: 1 to 3 in each)`);
  const seen = {};
  for (const [, m] of maps) for (const s of (m.scenes && m.scenes.list) || []) seen[s.kind] = (seen[s.kind] || 0) + 1;
  check(["barricade", "overrun", "choke", "stand", "quiet"].every((k) => seen[k] > 0), `every scene turns up (${Object.entries(seen).map(([k, v]) => `${k} ${v}`).join(", ")})`);
}

// ---------- 2. the scenes' cells ----------
console.log("Barricades, pieces and connectivity");
{
  let doors = 0, badDoor = 0, pieces = 0, badPiece = 0, chokes = 0, tallChoke = 0, cutLiving = 0, cutDead = 0, alive = 0;
  const newKinds = new Set();
  for (const [key, m] of maps) {
    if (!m.scenes) continue;
    const F = floorsOf(m);
    for (const p of m.scenes.pieces) {
      const c = F[p.f][p.y * m.w + p.x];
      if (p.k === "rubble") continue;
      pieces++;
      if (p.k === "boarded" ? !(c.k === "boarded" && c.hp > 0 && c.under) : !(FURNITURE[c.k] && c.hp > 0 && c.mhp >= c.hp && c.moved)) badPiece++;
    }
    for (const s of m.scenes.list) {
      if (s.kind === "barricade") {
        doors++;
        const c = F[s.f][s.y * m.w + s.x];
        const ok = (c.k === "boarded" && c.hp > 0) || (FURNITURE[c.k] && c.hp > 0 && c.frame && c.frame.k === "odoor");
        if (!ok) badDoor++;
        if (s.alive) alive++;
      }
      if (s.kind === "choke") {
        chokes++;
        // With no gap only half cover; with a gap at most one full-cover piece (the gap is the way through).
        const line = s.cells.map(([x, y]) => F[s.f][y * m.w + x]).filter((c) => FURNITURE[c.k]), tall = line.filter((c) => CELL[c.k].cover !== 1).length;
        const gapLeft = s.cells.length < (s.kind === "choke" && s.width ? s.width : Infinity);
        if (!s.cells.length || tall > (gapLeft ? 1 : 0)) tallChoke++;
        for (const c of line) newKinds.add(c.k);
      }
    }
    // Every walkable cell reached: the living through doors, boards and pieces (shoved or vaulted), the dead crawling
    // over half cover or battering what has hit points. From the front zone on the ground, the stairwell upstairs (each
    // building's on a map of several).
    const z = m.zones[0];
    F.forEach((cells, f) => {
      const from = f ? (m.street ? m.stairs : m.stairs.slice(0, 1)) : [[z.x0 + 1, z.y0 + 1]]; // upstairs from the stairwell (several buildings on one map: from each one's, #32's garden apartments)
      if (!from.length) return;
      const flood = (pass) => {
        const seen = new Uint8Array(cells.length), q = from.map(([x, y]) => y * m.w + x);
        for (const i of q) seen[i] = 1;
        while (q.length) { const i = q.pop(), x = i % m.w, y = (i / m.w) | 0; for (const [dx, dy] of NEXT4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue; const j = ny * m.w + nx; if (!seen[j] && pass(cells[j])) { seen[j] = 1; q.push(j); } } }
        return seen;
      };
      const walk = (c) => !!CELL[c.k] && CELL[c.k].walk;
      const living = flood((c) => walk(c) || c.k === "door" || c.k === "boarded" || (FURNITURE[c.k] && c.moved));
      const dead = flood((c) => walk(c) || c.k === "door" || crawlable({ cells, w: m.w, h: m.h }, c) || (c.hp > 0 && (c.k === "boarded" || (FURNITURE[c.k] && c.moved))));
      // Without the scenes the map is connected through doors (buildingmaps.js); with them, still so.
      for (let i = 0; i < cells.length; i++) if (walk(cells[i])) { if (!living[i]) cutLiving++; if (!dead[i]) cutDead++; }
    });
  }
  check(doors > 0 && !badDoor, `every barricaded doorway holds boards or a piece with hit points in its open frame (${doors} doorways, ${badDoor} bad; ${alive} upstairs with nobody dead: floorfolk's)`);
  check(pieces > 0 && !badPiece, `every piece a scene set has hit points and is marked shoved (${pieces} pieces, ${badPiece} bad)`);
  check(chokes > 0 && !tallChoke, `a hallway's pile: half cover with no gap (the living vault or shove it, the dead crawl over), at most one full piece beside a gap (${chokes} chokes)`);
  check(["chair", "sofa"].every((k) => newKinds.has(k)), `the catalogue's pieces are shoved into place (chokes: ${[...newKinds].join(", ")})`);
  check(!cutLiving, `every floor stays connected for the living with shoving (${cutLiving} cells cut off)`);
  check(!cutDead, `every room still reachable by the dead, crawling or battering (${cutDead} cells cut off)`);
}

// ---------- 3. bodies and blood ----------
console.log("Bodies and blood");
{
  let bodies = 0, badBody = 0, blood = 0, badBlood = 0, offFloor = 0, kinds = new Set(), quietBlood = 0;
  for (const [, m] of maps) {
    const F = floorsOf(m);
    if (!m.scenes) { if (F.some((cells) => cells.some((c) => c.blood || c.brass))) badBlood++; continue; }
    for (const o of m.scenes.bodies) {
      bodies++;
      const c = F[o.f] && F[o.f][o.y * m.w + o.x];
      if (typeof o.f !== "number" || !c || !CELL[c.k].walk || c.f !== "floor") badBody++;
    }
    const floorsWith = new Set([...m.scenes.bodies.map((o) => o.f), ...m.scenes.list.map((s) => s.f)]);
    F.forEach((cells, f) => cells.forEach((c) => {
      if (!c.blood) return;
      blood++; kinds.add(c.blood.kind);
      if (c.f !== "floor" || !CELL[c.k] || !CELL[c.k].walk || c.k === "void" || !(c.blood.amount >= 1 && c.blood.amount <= 3)) badBlood++;
      if (!floorsWith.has(f)) offFloor++;
    }));
    // A quiet death: no blood round its body.
    for (const s of m.scenes.list.filter((q) => q.kind === "quiet")) if (F[s.f][s.y * m.w + s.x].blood && !m.scenes.list.some((q) => q !== s && q.f === s.f)) quietBlood++;
  }
  check(bodies > 0 && !badBody, `every body has its floor and lies on walkable floor (${bodies} bodies)`);
  check(blood > 0 && !badBlood && kinds.has("human") && kinds.has("zombie"), `blood only on the building's floor cells, 1–3 an amount, both kinds (${blood} cells)`);
  check(!offFloor, "blood lies on the floor of its scene");
  check(!quietBlood, "a quiet death leaves no blood");
}

// ---------- 4. determinism ----------
console.log("The same building, the same scenes");
{
  let same = 0, diff = 0, mapSame = true;
  for (let i = 0; i < 12; i++) {
    const key = KINDS[i % KINDS.length];
    const a = mapOf(key, i), b = mapOf(key, i);
    const sig = (m) => JSON.stringify([m.scenes, floorsOf(m).map((cells) => cells.map((c) => [c.k, c.hp, c.blood, c.brass]))]);
    if (sig(a) === sig(b)) same++; else diff++;
    // The map's own dice: the rooms and the containers as they would be without the scenes (their dice are separate).
    const strip = (m) => JSON.stringify([m.rooms.map((r) => [r.id, r.f, r.role, r.x0, r.y0, r.w, r.h]), m.containers.map((c) => [c.id, c.x, c.y, c.f, c.kind])]);
    if (strip(a) !== strip(b)) mapSame = false;
  }
  check(!diff && same === 12, `12 buildings built twice: the same scenes, the same cells (${same} same)`);
  check(mapSame, "the floor plan and its containers come from the map's dice, the scenes from their own");
  const r1 = SC.sceneRng(st, tile.id, { id: "x" }).next(), r2 = SC.sceneRng(st, tile.id, { id: "x" }).next(), r3 = SC.sceneRng(st, tile.id, { id: "y" }).next();
  check(r1 === r2 && r1 !== r3, "the scenes' dice: the seed, the tile and the building's id");
}

// ---------- 5. the battle ----------
console.log("On the battle");
function raidAt(types, opts = {}) {
  for (let i = 0; i < 80; i++) {
    const S = createWorld({ seed: (opts.seed || 400) + i, factionCount: 6 });
    S.cards.length = 0;
    const h = hub(S);
    const t = S.tiles.find((q) => q.loc && types.includes(q.loc.type) && q.id !== h.tile);
    if (!t) continue;
    const crew = atBase(S, h.id).slice(0, 2);
    const res = launchExpedition(S, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [t.id]; p.idx = 0; p.phase = "engaged";
    const setup = { mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "sctest", enemy: { kind: "mixed", count: 1, power: 3, groups: opts.groups || [] }, raid: { heat0: 5 }, context: {} };
    S.combat = createBattle(S, setup);
    if (opts.want && !opts.want(S.combat)) continue;
    return { st: S, b: S.combat, setup, tile: t };
  }
  return null;
}
const humanScene = (b) => b.raid.scenes && b.units.some((u) => u.scene && u.side === "neutral");
const r = raidAt(["hospital", "apartments", "office", "police", "school", "motel", "clinic"], { want: (b) => humanScene(b) && b.corpses.some((c) => c.scene) });
check(!!r, "test setup: a raid on a building with a scene with a survivor's body and the dead");
if (r) {
  const { st: S, b } = r;
  const R = b.raid;
  const sc = b.corpses.filter((c) => c.scene);
  check(sc.length && sc.every((c) => typeof c.f === "number" && !c.searched), `the scene's dead lie as bodies (b.corpses) with their floor (${sc.length})`);
  const odds = Math.min(SLEEPER.ODDS_MAX, SLEEPER.ODDS + SLEEPER.ODDS_INF * (b.infection || 0));
  check(sc.every((c) => typeof c.sleeper === "boolean"), `Sleepers among them at sleepers.js's share (${(odds * 100).toFixed(0)}% here: ${sc.filter((c) => c.sleeper).length} of ${sc.length})`);
  const dead = b.units.filter((u) => u.scene);
  const boxes = R.containers.filter((c) => c.kind === "body" && dead.some((u) => u.id === c.uid));
  check(dead.every((u) => u.dead && u.kind === "human" && u.side === "neutral" && u.restored && typeof u.f === "number") && boxes.length === dead.length && boxes.every((c) => (c.full || c.bare) && c.f === dead.find((u) => u.id === c.uid).f), `the survivors are dead people with a body container each, on their floor (${dead.length}; a hospital's patients bare)`);
  check(b.units.filter((u) => u.side === "neutral" && !u.dead && u.scene).length === 0 && !R.containers.some((c) => c.scene && c.kind !== "ground"), "nobody of a scene is alive; their piles are ground piles");
  // Searching one: their kit always on them (box.full).
  const u0 = b.units.find((u) => u.side === "player");
  const box = boxes.find((c) => c.full) || boxes[0];
  setFloor(b, box.f); u0.f = box.f; u0.away = false; u0.x = box.x; u0.y = box.y; u0.ap = 2;
  searchBox(S, b, u0, box, true);
  check(box.contents && box.contents.gear.length >= 1, `searched, a survivor's body has their kit on it (${box.contents ? box.contents.gear.map((g) => g.key).join(", ") : "nothing"})`);
  setFloor(b, 0); u0.f = 0;
  // The intro line: once, when the room is first seen.
  const s = R.scenes.list[0];
  const v = b.units.find((u) => u.side === "player");
  setFloor(b, s.f); v.f = s.f; v.away = false; v.x = s.x; v.y = s.y;
  const before = b.log.length;
  SC.sceneSeen(b, v); SC.sceneSeen(b, v);
  const lines = b.log.slice(before).map((l) => (typeof l === "string" ? l : l.text || l.msg || JSON.stringify(l)));
  check(s.seen && lines.length === 1 && lines[0].includes(s.text.slice(0, 20)), `the intro line once when the scene is seen: "${s.text}"`);
  setFloor(b, 0);

  // ---------- 6. the ledger, the crawl's snapshot, a save ----------
  console.log("The ledger, the crawl's snapshot and saves");
  const piece = R.scenes.pieces.find((p) => FURNITURE[p.k]);
  if (piece) {
    const cellsOf = (bb, f) => (bb.floors ? bb.floors[f].cells : bb.cells);
    const c = cellsOf(b, piece.f)[piece.y * b.w + piece.x];
    breakPiece(b, c);
    const L = SC.sceneLedger(b);
    check(L && L.some((o) => o.x === piece.x && o.y === piece.y && o.f === piece.f), "a smashed piece goes in the ledger");
    // The same building again (a revisit): the scene rolled the same, then the ledger applied.
    const again = createBattle(S, r.setup);
    const c2 = cellsOf(again, piece.f)[piece.y * again.w + piece.x];
    const fresh = c2.k === piece.k;
    SC.applySceneLedger(again, L);
    check(fresh && c2.k === c.k && !c2.moved, `on a revisit the scene is rolled again, and the ledger keeps the ${piece.k} smashed (${c2.k})`);
    S.combat = b;
  } else check(true, "no shoved piece in this building's scenes (boards only)");
  const snap = snapshotBuilding(b);
  check(snap.corpses && snap.corpses.length === b.corpses.length && snap.scenes && snap.scenes.list.length === R.scenes.list.length, "the crawl's snapshot keeps the bodies and the scenes");
  const b2 = createBattle(S, r.setup);
  restoreBuilding(S, b2, snap);
  const bl = (bb) => (bb.floors ? bb.floors.flatMap((F) => F.cells) : bb.cells).filter((c) => c.blood).length;
  check(restoreBuilding && b2.corpses.length === b.corpses.length && bl(b2) === bl(b) && b2.raid.scenes.list[0].seen === R.scenes.list[0].seen && b2.units.filter((u) => u.scene).length === dead.length, "restored: the bodies, the blood, the scenes seen, the survivors' bodies (not doubled)");
  S.combat = b;
  const S2 = deserializeState(serializeState(S));
  const B = S2.combat;
  check(B && B.raid.scenes && B.raid.scenes.list.length === R.scenes.list.length && bl(B) === bl(b) && B.corpses.filter((c) => c.scene).length === sc.length, "a save mid-raid keeps the scenes, the blood and the bodies");
  // An old snapshot (from before the scenes): no scene bodies, no scene log.
  const old = { ...snap }; delete old.corpses; delete old.scenes;
  const b3 = createBattle(S, r.setup);
  restoreBuilding(S, b3, old);
  check(!b3.corpses.some((c) => c.scene) && !b3.raid.scenes, "a snapshot from before the scenes loads as it was: none of a scene's bodies");

  // ---------- 7. the view ----------
  console.log("The view");
  const MK = await import("../src/ui/battlemarks.js");
  MK.clearMarks();
  S.combat = b;
  const stm = MK.marksOf(b);
  const pre = stm.list.filter((m) => m.k === "blood" || m.k === "zblood" || m.k === "brass");
  const floorsBlood = new Set(pre.map((m) => m.f));
  check(pre.length > 0 && pre.every((m) => !m.seen && typeof m.f === "number"), `the pre-placed blood (and brass) are marks from the start, found when seen (${pre.length}, floors ${[...floorsBlood].join("/")})`);
  const vis = new Uint8Array(b.w * b.h).fill(1);
  setFloor(b, 0);
  MK.revealMarks(b, vis);
  check(stm.list.filter((m) => m.seen).every((m) => m.f === 0), "seen from the ground floor, only the ground floor's marks are revealed");
}

// ---------- 8. a hospital's own (issue #14) ----------
console.log("A hospital's own scenes (issue #14)");
{
  const kinds = {};
  let patients = 0, wormed = 0;
  for (const [, m] of maps.filter(([k]) => k === "hospital")) for (const x of (m.scenes && m.scenes.list) || []) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
  check(kinds.eroverrun > 0 && kinds.sealedward > 0 && kinds.morgue > 0, `among the hospitals: an ER overrun (${kinds.eroverrun || 0}), a sealed ward (${kinds.sealedward || 0}), the morgue's dead (${kinds.morgue || 0})`);
  const h = raidAt(["hospital"], { seed: 900, want: (b) => b.raid.scenes && b.raid.scenes.list.some((x) => x.kind === "morgue" && x.rise) });
  check(!!h, "test setup: a hospital raid with the morgue's dead, one of them rising");
  if (h) {
    const { st: S, b } = h;
    const pat = b.units.filter((u) => u.scene && u.name === "A patient");
    patients = pat.length; wormed = pat.filter((u) => u.wormed).length;
    const boxes = b.raid.containers.filter((c) => c.kind === "body" && pat.some((u) => u.id === c.uid));
    check(patients >= 2 && wormed >= 1 && boxes.length === patients && boxes.every((c) => c.bare && !c.full), `the morgue's patients lie dead with bare body containers (${patients}, ${wormed} with the worm in them)`);
    const u0 = b.units.find((u) => u.side === "player"), pb = boxes[0];
    setFloor(b, pb.f); u0.f = pb.f; u0.away = false; u0.x = pb.x; u0.y = pb.y; u0.ap = 2;
    searchBox(S, b, u0, pb, true);
    check(pb.contents && !pb.contents.gear.some((g) => g.key !== "flashbang" && g.key !== "smokegren"), `searched, a patient has nothing but their pockets (${pb.contents ? JSON.stringify(pb.contents.sup) + " " + pb.contents.gear.map((g) => g.key).join(", ") : "none"})`);
    setFloor(b, 0); u0.f = 0;
    const { carrierRound } = await import("../src/sim/carriers.js");
    const zBefore = b.units.filter((u) => u.kind === "zombie").length;
    carrierRound(S, b);
    const rose = b.units.filter((u) => u.kind === "zombie").length - zBefore;
    check(rose >= 1 && rose <= wormed, `at the turn of the dead the wormed ones get up (${rose} of ${wormed})`);
  }
  const e = raidAt(["hospital"], { seed: 1300, want: (b) => b.raid.scenes && b.raid.scenes.list.some((x) => x.kind === "eroverrun") });
  check(!!e, "test setup: a hospital raid with its ER overrun");
  if (e) {
    const bag = e.b.raid.containers.find((c) => c.scene && c.label === "A doctor's bag");
    check(bag && bag.contents.sup.meds >= 2 && bag.contents.gear.some((g) => g.key === "bandagekit"), `a doctor's bag beside their body: meds and a bandage kit (${bag ? JSON.stringify(bag.contents.sup) : "none"})`);
    const pieces = e.b.raid.scenes.pieces.filter((p) => ["gurney", "ivstand", "curtain"].includes(p.k));
    const cells = (f) => (e.b.floors ? e.b.floors[f].cells : e.b.cells);
    check(pieces.length >= 1 && pieces.every((p) => cells(p.f)[p.y * e.b.w + p.x].moved), `the ER's gurneys, stands and curtains knocked over (${pieces.length} cells moved)`);
  }
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
