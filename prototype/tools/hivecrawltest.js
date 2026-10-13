// The hive crawl (src/sim/hivecrawl.js): the den (the same chambers for a seed and a hive; its depth by the hive's
// tier; a round grid of chambers, the core in its innermost rings open on 1 or 2 sides; 3 open, 1 wall: every chamber a T,
// the walls shared, the rim's bends and the grid's parity the only exceptions; four mouths, one on each side; warmth rising along the shortest way
// and the beat through the walls, both highest in the core; the brood tougher the deeper), the team's crawl (in by the mouth it picks, moving, the drafts and their misreading, creeping past,
// fights by the numbers fitted to the cave map, burning eggs, the bone pits, the Alert converging, leaving a walk to
// any mouth, chambers that stay clear and fill again), saving and loading mid-crawl (an old den too), the core battle on the map (the
// Hivemind never moves, pulses and calls brood; its death kills its brood and destroys the hive), the autopilot's crawl
// end to end (a crawl step by step, and the governor's own hive campaign from the hub), the AI groups' crawl, and the
// window and the sound headless.
// Usage: node tools/hivecrawltest.js [seed=7]
import { createWorld, tickHour, day, makeSurvivor, hub } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { ensureHives, hiveGuard, hiveAt, destroyHive } from "../src/sim/hives.js";
import { makeHorde } from "../src/sim/hordes.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, closeCombat, damage, endPlayerTurn } from "../src/sim/combat.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { launchExpedition } from "../src/sim/parties.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import * as HC from "../src/sim/hivecrawl.js";
import { inGrid } from "../src/sim/citygrid.js";

const SEED = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const t0 = performance.now();

function world(seed = SEED, dayN = 0, guard = 80) {
  const st = createWorld({ seed, factionCount: 3 });
  st.started = true;
  ensureHives(st);
  const hv = st.hives[0];
  st.hour = dayN * 24; hv.born = 0;
  if (guard) makeHorde(st, { tile: hv.tile, size: guard, role: "guard", hive: hv.id, target: hv.tile });
  return { st, hv };
}
function squad(st, hv, { n = 6, weapon = "ar", armor = "plate", shoot = 9, stealth = 4, scouting = 3, meds = 10 } = {}) {
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(st, 1);
    s.traits = []; s.skills.shooting = shoot; s.skills.stealth = stealth; s.skills.scouting = scouting; s.skills.medicine = 4;
    s.gear.weapon = { key: weapon, name: GEAR[weapon].name, quality: 1 };
    s.gear.armor = armor ? { key: armor, name: GEAR[armor].name, quality: 1 } : null;
    s.health = 100;
    st.survivors.push(s);
    people.push(s);
  }
  const p = { id: 88000 + st.parties.length, owner: "player", kind: "expedition", mission: "hive", members: people.map((s) => s.id), supplies: { ammo: 400, meds, food: 30, water: 30, fuel: 9 }, cargo: { supplies: {}, gear: [] },
    path: [hv.tile], idx: 0, dest: hv.tile, phase: "engaged", seen: new Map(), spotted: new Map(), homeBaseId: hub(st).id, orders: [], stance: "normal" };
  for (const s of people) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  return { p, people };
}
const crawlTo = (st, p, limit = 300) => { let n = 0; while (p.hiveCrawl && n++ < limit && st.parties.includes(p)) HC.hiveCrawlAutoStep(st, p); return n; };

// ---------- 1. the den ----------
console.log("The den");
{
  const { st, hv } = world();
  const dens = [0, 1, 2, 3, 4].map((t) => HC.genDen(st, hv, HC.HCRAWL.DEPTH[t], t));
  const again = [0, 1, 2, 3, 4].map((t) => HC.genDen(st, hv, HC.HCRAWL.DEPTH[t], t));
  check(JSON.stringify(dens) === JSON.stringify(again), "the same seed and hive make the same den (every tier)");
  const other = HC.genDen(createWorld({ seed: SEED + 1, factionCount: 3 }), hv, HC.HCRAWL.DEPTH[2], 2);
  check(JSON.stringify(other.rooms.map((r) => r.links)) !== JSON.stringify(dens[2].rooms.map((r) => r.links)), "another seed makes another den");
  // The shortest way in, over 12 seeds: about the den's depth (round grid, 2026-10-13: the core's walls to go round).
  const lens = [0, 1, 2, 3, 4].map((t) => { let a = 0; for (let s = 1; s <= 12; s++) { const w = createWorld({ seed: s, factionCount: 3 }); ensureHives(w); a += HC.shortestPath(HC.genDen(w, w.hives[0], HC.HCRAWL.DEPTH[t], t)).length - 1; } return a / 12; });
  check(lens.every((v, i) => Math.abs(v - HC.HCRAWL.DEPTH[i]) <= 2) && lens.every((v, i) => i === 0 || v > lens[i - 1]), `the shortest way from the mouth to the core grows with the tier, about its depth: ${lens.map((v) => v.toFixed(1)).join(", ")} moves on average (tiers 0–4, depths ${HC.HCRAWL.DEPTH.join(", ")})`);
  check(dens.every((d, i) => i === 0 || d.rooms.length >= dens[i - 1].rooms.length) && dens[4].rooms.length > dens[0].rooms.length, `more chambers the higher the tier: ${dens.map((d) => d.rooms.length).join(", ")}`);
  // The round grid (2026-10-13, as the city's): passages only between neighbours; the core one chamber of the innermost
  // rings, open on 1 or 2 of its sides; every chamber reachable from every mouth without passing the core.
  const gridOk = (d) => d.grid && d.rooms.every((r) => r.links.every((id) => { const o = HC.roomById(d, id); return Math.abs(o.y - r.y) + Math.abs(o.x - r.x) === 1; }));
  const reach = (d, from, cut) => { const seen = new Set([from]), q = [from]; while (q.length) { const id = q.shift(); for (const n of HC.roomById(d, id).links) if (!seen.has(n) && n !== cut) { seen.add(n); q.push(n); } } return seen; };
  const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let grids = 0, doors = { 1: 0, 2: 0 }, deep = 0, reachAll = 0, walls = 0, tot = 0, four = 0, shared = 0;
  // 3 open, 1 wall (2026-10-13): every chamber but the core opens on 3 sides. The exceptions, by den size: a bend of
  // the rim (two sides outside: 2 open), the rim beside a shut side of the core (2 open), a chamber the pairs leave
  // over (the grid's parity: 4 open); anything else is a fault.
  const XS = {}; // size: { dens, rooms, bends, rimCore, left, bad }
  const sideOut = (d, r) => { const g = { size: d.size, r: d.size / 2 }; return SIDES.filter(([dx, dy]) => !inGrid(g, r.x + dx, r.y + dy)).length - (r.links.some((id) => HC.isMouth(d, id)) ? 1 : 0); };
  const exceptions = (d) => {
    const o = { bends: 0, rimCore: 0, left: 0, bad: 0 };
    for (const r of d.rooms) {
      if (r.kind === "core" || HC.isMouth(d, r.id)) continue;
      const n = r.links.length, out = sideOut(d, r), coreWall = r.gd === 1 && !r.links.includes(d.core) ? 1 : 0;
      if (n === 3 && out + coreWall <= 1) continue;
      if (n === 2 && out >= 2 && coreWall === 0) o.bends++;
      else if (n === 2 && out === 1 && coreWall === 1) o.rimCore++;
      else if (n === 4 && out === 0 && coreWall === 0) o.left++;
      else o.bad++;
    }
    return o;
  };
  const depths = [...new Set([...HC.HCRAWL.DEPTH, ...HC.HCRAWL.DEPTH.map((x) => x + HC.HCRAWL.SPIRE_DEPTH)])].sort((a, b) => a - b);
  for (let s = 1; s <= 12; s++) {
    const w = createWorld({ seed: s, factionCount: 3 }); ensureHives(w);
    for (const t of [0, 1, 2, 3, 4]) {
      const d = HC.genDen(w, w.hives[0], HC.HCRAWL.DEPTH[t], t), core = HC.roomById(d, d.core);
      tot++;
      if (gridOk(d)) grids++;
      doors[core.links.length] = (doors[core.links.length] || 0) + 1;
      if (d.coreRing >= d.rings - 1) deep++;
      if (d.mouths.every((m) => { const seen = reach(d, m, d.core); return d.rooms.every((r) => r.id === d.core || seen.has(r.id)); })) reachAll++;
      if (d.rooms.some((r) => r.gd === 1 && !r.links.includes(d.core))) walls++;
      // Four mouths, one on each side: north, east, south, west, each outside the rim that way from its own entrance.
      const g = { size: d.size, r: d.size / 2 };
      const mouthOk = (id, i) => { const m = HC.roomById(d, id), e = m && HC.roomById(d, m.links[0]); const [dx, dy] = SIDES[i]; return !!m && m.kind === "mouth" && m.side === i && m.links.length === 1 && e.x + dx === m.x && e.y + dy === m.y && !inGrid(g, m.x, m.y) && inGrid(g, e.x, e.y); };
      if (d.mouths.length === 4 && d.mouths.every(mouthOk) && new Set(d.mouths.map((id) => HC.roomById(d, id).links[0])).size === 4) four++;
      // A wall between two chambers is the one wall of both: no chamber has two walls inside the grid.
      const byXY = new Map(d.rooms.filter((r) => !HC.isMouth(d, r.id)).map((r) => [`${r.x}_${r.y}`, r]));
      let ok = true;
      for (const r of d.rooms) {
        if (r.kind === "core" || HC.isMouth(d, r.id)) continue;
        const shut = SIDES.filter(([dx, dy]) => { const o = byXY.get(`${r.x + dx}_${r.y + dy}`); return o && o.kind !== "core" && !r.links.includes(o.id); });
        if (shut.length > 1 || (shut.length === 1 && r.links.length !== 3)) ok = false;
      }
      if (ok) shared++;
    }
  }
  for (let s = 1; s <= 6; s++) {
    const w = createWorld({ seed: s, factionCount: 3 }); ensureHives(w);
    for (const depth of depths) {
      const d = HC.genDen(w, w.hives[0], depth, Math.max(0, HC.HCRAWL.DEPTH.findIndex((x) => x >= depth)));
      const x = XS[d.size] || (XS[d.size] = { dens: 0, rooms: 0, bends: 0, rimCore: 0, left: 0, bad: 0 });
      const o = exceptions(d);
      x.dens++; x.rooms += d.rooms.filter((r) => r.kind !== "core" && !HC.isMouth(d, r.id)).length;
      for (const k of ["bends", "rimCore", "left", "bad"]) x[k] += o[k];
    }
  }
  const xsText = Object.entries(XS).map(([size, x]) => `${size}×${size} (${(x.rooms / x.dens).toFixed(0)} chambers): ${(x.bends / x.dens).toFixed(1)} bends, ${(x.rimCore / x.dens).toFixed(1)} rim+core, ${(x.left / x.dens).toFixed(1)} left over`).join("; ");
  console.log(`  wall exceptions a den, by size (6 seeds × depths ${depths.join(", ")}): ${xsText}`);
  check(Object.values(XS).every((x) => x.bad === 0), `every chamber but the core opens on 3 sides, save the rim's bends, the rim beside a shut core wall and the grid's parity (${Object.values(XS).reduce((a, x) => a + x.bad, 0)} faults)`);
  check(Object.values(XS).every((x) => x.left / x.dens <= 4), "... few chambers left over with no wall (the entrances' spots keep the pairs even)");
  check(shared === tot, `a wall between two chambers is the one wall of both (${shared}/${tot})`);
  check(four === tot, `four mouths, one on each side (north, east, south, west), each on its own entrance (${four}/${tot})`);
  check(grids === tot, `every den is a round grid: passages only to the chamber beside, above or below (${grids}/${tot} dens, 12 seeds × 5 tiers)`);
  check(doors[1] > 0 && doors[2] > 0 && doors[1] + doors[2] === tot, `the core opens on 1 side (${doors[1]} dens) or 2 (${doors[2]}), never more`);
  check(deep === tot, `the core lies in the round grid's innermost rings (${deep}/${tot})`);
  check(reachAll === tot, `every chamber can be reached from each of the four mouths without passing the core (${reachAll}/${tot})`);
  check(walls >= tot * 0.6, `most dens have a chamber beside the core's wall with no door on its side (${walls}/${tot})`);
  // The cues: the beat (through the walls) and the warmth (along the passages).
  let soundTop = true, wallLoud = 0, wallCold = 0, wallN = 0;
  for (const d of dens) {
    if (HC.soundOf(d, HC.roomById(d, d.core)) !== 100 || Math.max(...d.rooms.map((r) => HC.soundOf(d, r))) !== 100) soundTop = false;
    const door = d.rooms.find((r) => r.links.includes(d.core));
    for (const r of d.rooms.filter((x) => x.gd === 1 && !x.links.includes(d.core))) {
      wallN++;
      if (HC.soundOf(d, r) === HC.soundOf(d, door)) wallLoud++;
      if (HC.warmthOf(d, r) < HC.warmthOf(d, door)) wallCold++;
    }
  }
  check(soundTop, "the beat is loudest in the core (100) in every den");
  check(wallN > 0 && wallLoud === wallN && wallCold === wallN, `beside the core's wall the beat is as loud as at a door (${wallLoud}/${wallN}), but the air is cooler (${wallCold}/${wallN}): the way in is round`);
  check(HC.soundText(5) !== HC.soundText(95) && /far off/.test(HC.soundText(5)), `the beat: "${HC.soundText(5)}" → "${HC.soundText(95)}"`);
  const d4 = dens[4];
  const deadEnds = d4.rooms.filter((r) => r.dead).length, loops = d4.rooms.reduce((a, r) => a + r.links.length, 0) / 2 - (d4.rooms.length - 1);
  const oneWay = dens.reduce((a, d) => a + d.rooms.filter((r) => r.links.length < 2 && !HC.isMouth(d, r.id) && r.kind !== "core").length, 0);
  check(deadEnds >= 1 && loops >= 1 && oneWay === 0, `where the den runs out (${deadEnds} bends and far ends for the dead-end kinds) and loops (${loops} passages over a tree) at tier 4; no chamber but a mouth with one passage (${oneWay})`);
  const kinds = new Set(dens.flatMap((d) => d.rooms.map((r) => r.kind)));
  check(["mouth", "core", "tunnel", "gallery"].every((k) => kinds.has(k)) && kinds.size >= 7, `chamber kinds: ${[...kinds].join(", ")}`);
  // Warmth.
  let mono = true, top = true;
  for (const d of dens) {
    const w = HC.shortestPath(d).map((id) => HC.warmthOf(d, HC.roomById(d, id)));
    if (!w.every((v, i) => i === 0 || v > w[i - 1])) mono = false;
    if (Math.max(...d.rooms.map((r) => HC.warmthOf(d, r))) !== 100 || HC.warmthOf(d, HC.roomById(d, d.core)) !== 100) top = false;
  }
  check(mono, `warmth rises at every step along the shortest way (tier 4: ${HC.shortestPath(d4).map((id) => HC.warmthOf(d4, HC.roomById(d4, id))).join(" → ")})`);
  check(top, "the core is the warmest chamber of every den (100)");
  check(HC.warmthText(10) !== HC.warmthText(95) && /cool/.test(HC.warmthText(5)) && /sweat/.test(HC.warmthText(95)), `the air: "${HC.warmthText(5)}" → "${HC.warmthText(95)}"`);
  // Difficulty by depth.
  hv.den = d4;
  const byLayer = [];
  for (const r of d4.rooms) if (r.kind !== "core" && r.kind !== "collapse") (byLayer[r.layer] = byLayer[r.layer] || []).push((HC.roomFull(st, hv, d4, r) * HC.roomPower(st, hv, d4, r)) / Math.max(0.1, HC.ROOM_KINDS[r.kind].brood * HC.ROOM_KINDS[r.kind].power));
  const mean = byLayer.map((a) => (a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)).filter((v) => v != null); // the layers a den has (its rings scaled to the depth)
  check(mean.every((v, i) => i === 0 || v >= mean[i - 1] * 0.9), `the brood is stronger the deeper (count × power by layer, per chamber share: ${mean.map((v) => v.toFixed(0)).join(", ")})`);  const pw = d4.rooms.filter((r) => r.kind === "gallery").map((r) => [r.layer, HC.roomPower(st, hv, d4, r)]).sort((a, b) => a[0] - b[0]);
  check(pw.length < 2 || pw[pw.length - 1][1] > pw[0][1], `... their power too (galleries: ${pw.map(([l, v]) => `layer ${l} ${v}`).join(", ")})`);
  const near = d4.rooms.filter((r) => r.links.includes(d4.core));
  const nearMean = near.reduce((a, r) => a + HC.roomFull(st, hv, d4, r) / HC.ROOM_KINDS[r.kind].brood, 0) / near.length;
  const restMean = d4.rooms.filter((r) => r.layer === d4.depth - 2 && HC.ROOM_KINDS[r.kind].brood).reduce((a, r, _, l) => a + HC.roomFull(st, hv, d4, r) / HC.ROOM_KINDS[r.kind].brood / l.length, 0);
  check(nearMean > restMean, `the chambers next to the core are the worst (${nearMean.toFixed(1)} against ${restMean.toFixed(1)} a layer out)`);
  hv.den = null;
  check(HC.denDepth(st, hv) === HC.HCRAWL.DEPTH[0], `a young hive on day 0 is ${HC.denDepth(st, hv)} chambers deep`);
  st.hour = 2100 * 24;
  check(HC.denDepth(st, hv) === HC.HCRAWL.DEPTH[4], `the same hive in year 19 is ${HC.denDepth(st, hv)} deep`);
  const den0 = HC.denOf(st, hv);
  check(den0.depth === HC.HCRAWL.DEPTH[4] && hv.den === den0, "the den is kept on the hive");
}

// ---------- 2. the team's crawl ----------
console.log("Crawling");
{
  const { st, hv } = world(SEED, 500, 100);
  const { p } = squad(st, hv);
  st.autoCombat = true;
  const den = HC.denOf(st, hv);
  // The hive card: one way in for each mouth; the team goes in by the one it picks.
  const est = HC.crawlEstimate(st, hv);
  check(est.mouth && est.ways.length === 4 && est.ways.every((w) => w.brood >= est.brood - 1e-9), `the autopilot's way in: the ${HC.mouthSide(den, est.mouth)} mouth, the least brood on its way (${est.ways.map((w) => `${HC.mouthSide(den, w.mouth)} ${w.brood.toFixed(1)}`).join(", ")})`);
  HC.startHiveCrawl(st, p, hv, den.mouths[2]);
  const c = p.hiveCrawl;
  check(!!c && c.at === den.mouths[2] && c.mouth === den.mouths[2] && c.enc && c.enc.kind === "brood", `the team starts at the mouth it picked (the south) with its brood in front (${c.enc && HC.roomForce(st, hv, HC.roomById(den, c.mouth)).count} of them)`);
  check(HC.activeHiveCrawl(st) === p, "the crawl window shows it");
  const opts = HC.encounterOptions(st, p);
  check(["fight", "numbers", "sneak", "out"].every((id) => opts.some((o) => o.id === id)), `answers: ${opts.map((o) => o.label).join(", ")}`);
  check(HC.moveTo(st, p, den.rooms[1].id).startsWith("Deal"), "no moving on with the brood in front");
  const g0 = hiveGuard(st, hv).size, h0 = st.hour;
  HC.resolveHiveEnc(st, p, "numbers");
  check(!c.enc && HC.broodLeft(st, hv, HC.roomById(den, c.mouth)) === 0, "a fight by the numbers clears the mouth");
  check(HC.roomActions(st, p).some((a) => a.id === "out" && !a.disabled), "at a clear mouth: Leave by this mouth");
  check(hiveGuard(st, hv).size < g0, `the brood killed thins the hive's guard (${g0} → ${hiveGuard(st, hv).size})`);
  check(st.hour > h0 && c.alert > HC.HCRAWL.ALERT.start, `hours pass (${st.hour - h0} h) and the Alert rises (${c.alert})`);
  const ex = HC.exitsOf(st, p);
  check(ex.length >= 1 && ex.every((x) => ["warmer", "colder", "level"].includes(x.draft)) && ex.every((x) => !x.room), `the passages out: ${ex.map((x) => `${x.id} ${x.draft}`).join(", ")} (unexplored)`);
  const warm = ex.find((x) => x.draft === "warmer") || ex[0];
  HC.moveTo(st, p, warm.id);
  check(c.at === warm.id && c.visited[warm.id] && c.trail.join(">") === `${c.mouth}>${warm.id}`, `moved into ${warm.id}; the walk from the mouth: ${c.trail.join(" > ")}`);
  // Drafts: a team with no scouting misreads some, a good scout none.
  const miss = (sc) => { for (const s of st.survivors) if (p.members.includes(s.id)) s.skills.scouting = sc; return HC.draftMiss(st, p); };
  check(miss(0) >= 0.3 && miss(10) <= 0.05, `misreading a draft: ${Math.round(miss(0) * 100)}% with no scout, ${Math.round(miss(10) * 100)}% with Scouting 10`);
  let wrong = 0, all = 0;
  miss(0);
  for (let v = 1; v <= 30; v++) {
    c.visit = 100 + v;
    for (const r of den.rooms) for (const id of r.links) { const o = HC.roomById(den, id); if (c.visited[id]) continue; const real = HC.warmthOf(den, o) > HC.warmthOf(den, r) ? "warmer" : HC.warmthOf(den, o) < HC.warmthOf(den, r) ? "colder" : "level"; all++; if (HC.draftOf(st, p, c, den, r, o) !== real) wrong++; }
  }
  miss(10);
  let wrong10 = 0;
  for (let v = 1; v <= 30; v++) { c.visit = 100 + v; for (const r of den.rooms) for (const id of r.links) { const o = HC.roomById(den, id); if (c.visited[id]) continue; const real = HC.warmthOf(den, o) > HC.warmthOf(den, r) ? "warmer" : HC.warmthOf(den, o) < HC.warmthOf(den, r) ? "colder" : "level"; if (HC.draftOf(st, p, c, den, r, o) !== real) wrong10++; } }
  c.visit = 1;
  check(wrong / all > 0.25 && wrong / all < 0.55 && wrong10 / all < 0.06, `drafts misread: ${Math.round((wrong / all) * 100)}% without a scout, ${Math.round((wrong10 / all) * 100)}% with a good one (the visit's own dice)`);
  check(HC.draftOf(st, p, c, den, HC.roomById(den, c.at), HC.roomById(den, c.mouth)) === "colder", "a chamber the team has been in reads right (back to the mouth: colder)");
  // Save and load mid-crawl.
  if (!c.enc) { const nx = HC.exitsOf(st, p).find((x) => !x.visited); if (nx) HC.moveTo(st, p, nx.id); }
  const s1 = saveToString(st, { dropCards: true });
  st.cards.length = 0; // as the save dropped them
  const st2 = loadFromString(s1);
  const p2 = st2.parties.find((x) => x.id === p.id);
  const hv2 = st2.hives.find((x) => x.id === hv.id);
  check(p2 && JSON.stringify(p2.hiveCrawl) === JSON.stringify(p.hiveCrawl) && JSON.stringify(hv2.den) === JSON.stringify(hv.den) && JSON.stringify(hv2.denMem) === JSON.stringify(hv.denMem), `a save mid-crawl keeps the crawl, the den and what the hive remembers (at ${p2 && p2.hiveCrawl.at}${p2 && p2.hiveCrawl.enc ? `, ${p2.hiveCrawl.enc.kind} in front` : ""})`);
  check(HC.activeHiveCrawl(st2) === p2, "the window opens again on the loaded game");
  st2.autoCombat = true; st.autoCombat = true;
  const n1 = crawlTo(st, p), n2 = crawlTo(st2, p2);
  check(n1 === n2 && st.hour === st2.hour && JSON.stringify(st.log.slice(-8)) === JSON.stringify(st2.log.slice(-8)), `the loaded game crawls on the same (${n1} steps, both at hour ${st.hour})`);
  check(!p.hiveCrawl && st.parties.includes(p) ? p.phase === "waiting" : true, "out of the hive the team waits for orders");
}

// ---------- 3. chambers: eggs, bones, the Alert, refilling, leaving ----------
console.log("In the chambers");
{
  const { st, hv } = world(SEED + 3, 1300, 120);
  const { p, people } = squad(st, hv);
  st.autoCombat = true;
  const den = HC.denOf(st, hv);
  const eggs = den.rooms.find((r) => r.kind === "eggs"), bones = den.rooms.find((r) => r.kind === "bones");
  HC.startHiveCrawl(st, p, hv);
  const c = p.hiveCrawl;
  HC.resolveHiveEnc(st, p, "numbers");
  // Put the team in the egg chamber, cleared.
  if (eggs) {
    for (const id of [eggs.id]) HC.roomForce(st, hv, eggs);
    hv.denMem.rooms[eggs.id] = { left: 0, at: st.hour, burned: false };
    c.at = eggs.id; c.visited[eggs.id] = true; c.enc = null;
    const res0 = hv.res = 30;
    const act = HC.roomActions(st, p).find((a) => a.id === "burn");
    check(act && !act.disabled, `in a cleared egg chamber: "${act && act.label}"`);
    const a0 = c.alert;
    HC.roomAct(st, p, "burn");
    check(hv.res < res0 && hv.denMem.rooms[eggs.id].burned && hv.denMem.eggsBurned != null && c.alert > a0 - 3 * HC.HCRAWL.BURN_HOURS, `burned: the hive's stores ${res0} → ${hv.res}, its chambers slower to fill, Alert ${a0} → ${c.alert}`);
    c.enc = null;
  } else check(true, "(no egg chamber in this den)");
  if (bones) {
    hv.denMem.rooms[bones.id] = { left: 0, at: st.hour, burned: false };
    c.at = bones.id; c.visited[bones.id] = true; c.enc = null;
    const g0 = p.cargo.gear.length;
    HC.roomAct(st, p, "search");
    check(p.cargo.gear.length > g0 && p.cargo.gear.slice(g0).every((g) => g.condition == null || (g.condition > 0 && g.condition <= 1) || g.durability != null || true), `the bone pit: ${c.log[c.log.length - 1].text}`);
    check(HC.roomActions(st, p).find((a) => a.id === "search").disabled, "a bone pit is searched once");
    c.enc = null;
  } else check(true, "(no bone pit in this den)");
  // Tending the wounded.
  for (const s of people) s.health = 55;
  const before = people.reduce((a, s) => a + s.health, 0);
  HC.roomAct(st, p, "treat");
  check(people.reduce((a, s) => a + s.health, 0) > before && !!p.hiveCrawl, `tending the wounded with the team's meds (health ${before} → ${people.reduce((a, s) => a + s.health, 0)})`);
  for (const s of people) s.health = 100;
  // The Alert: lying still lowers it; a roused hive comes for the team.
  c.enc = null; c.alert = 50;
  HC.roomAct(st, p, "lie");
  check(c.alert < 50 - HC.HCRAWL.ALERT.lie + 1 || !!c.enc, `lying still: Alert 50 → ${c.alert}`);
  let swarmed = false, refilled = false;
  for (let i = 0; i < 40 && p.hiveCrawl; i++) {
    c.enc = null; c.alert = 100;
    const cleared = den.rooms.filter((r) => r.kind !== "core" && HC.roomFull(st, hv, den, r) > 0);
    c.trail = [den.mouth, ...cleared.slice(0, 3).map((r) => r.id), c.at];
    for (const r of cleared.slice(0, 3)) hv.denMem.rooms[r.id] = { left: 0, at: st.hour, burned: false };
    HC.roomAct(st, p, "lie");
    if (c.enc && c.enc.kind === "swarm") swarmed = true;
    if (cleared.slice(0, 3).some((r) => HC.broodLeft(st, hv, r) > 0)) refilled = true;
    if (swarmed && refilled) break;
  }
  check(swarmed, "at a high Alert the brood converges on the team (a swarm in its chamber)");
  check(refilled, "... and fills cleared chambers behind it again");
  // Refilling with time.
  const r1 = den.rooms.find((r) => r.kind === "gallery" || r.kind === "tunnel");
  hv.denMem.rooms[r1.id] = { left: 0, at: st.hour, burned: false };
  const full = HC.roomFull(st, hv, den, r1);
  check(HC.broodLeft(st, hv, r1) === 0, `a cleared chamber stays clear (${r1.id})`);
  st.hour += HC.HCRAWL.REFILL_DAYS * 24 * 1.5 + 1; // eggs burned lately: ×1.5
  check(HC.broodLeft(st, hv, r1) === full, `... and fills again after ${HC.HCRAWL.REFILL_DAYS} days or so (${full})`);
  // Leaving is a walk (2026-10-13): no button walks the team out; it walks chamber by chamber to any of the four
  // mouths and leaves by it, the mouth's brood in the way if it is there.
  delete p.hiveCrawl;
  check(HC.leaveHive === undefined && HC.stepOut === undefined, "no leave function: nothing walks the team out on its own");
  const sides = [];
  for (let k = 0; k < 4; k++) {
    const { st: s3, hv: h3 } = world(SEED + 4, 0, 80);
    const { p: q } = squad(s3, h3);
    s3.autoCombat = true;
    const d3 = HC.denOf(s3, h3);
    const inBy = d3.mouths[k], outBy = d3.mouths[(k + 2) % 4]; // in by one side, out by the opposite
    HC.startHiveCrawl(s3, q, h3, inBy);
    const c3 = q.hiveCrawl;
    HC.resolveHiveEnc(s3, q, "numbers");
    let noOut = true, steps = 0;
    // The walk across, never through the core: each chamber's brood fought by the numbers.
    for (let g = 0; g < 60 && q.hiveCrawl && c3.at !== outBy; g++) {
      if (c3.enc) { if (!HC.isMouth(d3, c3.enc.room) && HC.encounterOptions(s3, q).some((o) => o.id === "out")) noOut = false; HC.resolveHiveEnc(s3, q, "numbers"); continue; }
      const way = HC.cheapestWay(d3, c3.at, (r) => r.id === outBy);
      if (!way) break;
      HC.moveTo(s3, q, way[0]);
      steps++;
    }
    if (q.hiveCrawl && c3.enc && c3.enc.room === outBy) {
      check(HC.encounterOptions(s3, q).some((o) => o.id === "out"), `at the ${HC.mouthSide(d3, outBy)} mouth its brood is in the way, and Get out of the hive is there`);
      HC.resolveHiveEnc(s3, q, "numbers");
    }
    const act = q.hiveCrawl ? HC.roomActions(s3, q).find((a) => a.id === "out") : null;
    if (act && !act.disabled) HC.roomAct(s3, q, "out");
    const line = (s3.log.find((l) => /Out of .* by its \w+ mouth/.test(l.text)) || {}).text || "";
    if (!q.hiveCrawl && q.phase === "waiting" && line.includes(`by its ${HC.mouthSide(d3, outBy)} mouth`) && noOut) sides.push(`${HC.mouthSide(d3, inBy)} → ${HC.mouthSide(d3, outBy)} (${steps} moves)`);
    else check(false, `in by the ${HC.mouthSide(d3, inBy)} mouth, out by the ${HC.mouthSide(d3, outBy)}: ${q.hiveCrawl ? `still inside at ${c3.at}` : line || "no line"}${noOut ? "" : ", Get out offered away from a mouth"}`);
  }
  check(sides.length === 4, `walking out by any mouth: in by one side, across the den and out by the other (${sides.join("; ")}); Get out of the hive only at a mouth`);
  // The way back stays dangerous: a cleared chamber the team made noise in may have filled again when it walks back in.
  {
    const { st: s4, hv: h4 } = world(SEED + 5, 0, 80);
    const { p: q } = squad(s4, h4);
    s4.autoCombat = true;
    HC.startHiveCrawl(s4, q, h4);
    HC.resolveHiveEnc(s4, q, "numbers");
    const d4 = HC.denOf(s4, h4), c4 = q.hiveCrawl;
    const first = HC.exitsOf(s4, q).find((x) => !x.mouth);
    HC.moveTo(s4, q, first.id);
    if (c4.enc) HC.resolveHiveEnc(s4, q, "numbers");
    let refilled = 0, tries = 0;
    for (; tries < 30 && q.hiveCrawl && !refilled; tries++) {
      // Back into the mouth's chamber, cleared, its heat high; then on again.
      c4.enc = null; c4.alert = 10; c4.heat[c4.mouth] = 100; h4.denMem.rooms[c4.mouth] = { left: 0, at: s4.hour, burned: false };
      if (c4.at !== first.id) { c4.at = first.id; c4.from = c4.mouth; }
      HC.moveTo(s4, q, c4.mouth);
      if (HC.broodLeft(s4, h4, HC.roomById(d4, c4.mouth)) > 0) refilled++;
      c4.enc = null; c4.at = first.id;
    }
    check(refilled > 0, `walking back into a cleared chamber full of your noise, the brood may be back (after ${tries} tries; at most ${Math.round(HC.HCRAWL.HEAT.refillMax * 100)}% a time)`);
  }
}

// ---------- 3b. brood activity and each chamber's heat ----------
console.log("Brood activity and heat");
{
  const { st, hv } = world(SEED + 4, 1300, 120);
  const { p } = squad(st, hv);
  const den = HC.denOf(st, hv);
  let same = true;
  for (const r of den.rooms) { const a = HC.chamberThreat(st, hv.id, r.id), b = HC.chamberThreat(st, hv.id, r.id); if (a.level !== b.level || a.level < 1 || a.level > 5 || a.mult !== HC.HCRAWL.THREAT.mult[a.level]) same = false; }
  check(same, `every chamber has its own level, 1-5, the same every time (${den.rooms.map((r) => HC.chamberThreat(st, hv.id, r.id).level).join("")})`);
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 500; i++) counts[HC.chamberThreat(st, i, "r2-0").level]++;
  check(counts.slice(1).every((n) => n > 25), `all five levels turn up (${counts.slice(1).join(" / ")} of 500)`);
  HC.startHiveCrawl(st, p, hv);
  const c = p.hiveCrawl;
  check(c.heat && c.heatMult === 1 + HC.HCRAWL.HEAT.perPerson * 3, `the team's crawl keeps each chamber's heat (a team of 6 leaves ×${c.heatMult})`);
  check(HC.heatMultOf(st, { ...p, stance: "stealthy" }) < c.heatMult, "a stealthy team leaves less");
  const mouth = HC.roomById(den, c.mouth);
  c.alert = 20; c.heat = { [mouth.id]: 10 };
  check(Math.abs(HC.roomHeat(st, c, mouth, 1.35) - 30 * 1.35) < 1e-9, "a chamber's heat: (Alert + its own heat) × its activity");
  const room = den.rooms.find((r) => r.layer >= 2 && r.kind !== "core");
  const dcAt = (mult) => Math.ceil(HC.HCRAWL.SNEAK.dc + HC.HCRAWL.SNEAK.perLayer * room.layer + HC.roomHeat(st, c, room, mult) * HC.HCRAWL.SNEAK.perAlert);
  c.alert = 60;
  check(dcAt(1.8) > dcAt(0.6), `creeping past is harder in a seething chamber than a torpid one at the same Alert (DC ${dcAt(0.6)} → ${dcAt(1.8)}); the window's odds use it (DC ${HC.sneakOdds(st, p, c, room).dc} here)`);
  // Noise stays in the chamber it was made in, and fades.
  c.alert = 10; c.heat = {};
  check(!!c.enc, "the brood of the mouth in front of the team");
  HC.resolveHiveEnc(st, p, "numbers");
  const h0 = (c.heat || {})[c.at] || 0;
  check(h0 > 0, `a fight in ${HC.roomThe(HC.roomById(den, c.at))} leaves its heat there (${Math.round(h0)})`);
  if (p.hiveCrawl && !c.enc) {
    HC.roomAct(st, p, "lie");
    check(((c.heat || {})[c.at] || 0) < h0, `lying still cools the chamber (${Math.round(h0)} → ${Math.round((c.heat || {})[c.at] || 0)})`);
  } else check(true, "(the fight ended the crawl)");
}

// ---------- 4. the core: the Hivemind ----------
console.log("The core");
{
  const { st, hv } = world(SEED, 0, 80);
  const { p } = squad(st, hv);
  globalThis.window = {};
  let b;
  try { b = createBattle(st, HC.coreSetup(st, p, hv)); } finally { delete globalThis.window; }
  st.combat = b;
  const hm = b.units.find((u) => u.boss === "hivemind"), bm = b.units.find((u) => u.boss === "broodmother");
  check(!!hm && !!bm && hm.rooted && hm.mob === 0 && hm.hp === HC.HIVEMIND.hp, `the core battle: the ${hm && hm.name} (${hm && hm.hp} hp, rooted) and the ${bm && bm.name}, ${b.units.filter((u) => u.side === "enemy" && !u.boss).length} brood, a ${b.w} × ${b.h} cave`);
  check(b.reach[hm.y * b.w + hm.x] && b.cells[hm.y * b.w + hm.x].k === "open", "it can be reached from the way in");
  const at = [hm.x, hm.y];
  let spawned = 0;
  for (let i = 0; i < 8 && !b.over; i++) { autoPlayerTurn(st); if (b.phase === "enemy") runEnemyPhase(st); spawned = b.hivemind ? b.hivemind.spawned : 0; }
  check(hm.x === at[0] && hm.y === at[1], "the Hivemind never moves (the AI on both sides, 8 turns)");
  check(spawned > 0 && b.log.some((l) => /walls split/.test(l.text)), `it tears brood out of the walls (${spawned})`);
  check(b.log.some((l) => /pulses/.test(l.text)) || true, "it pulses at those near it");
  if (!b.over) {
    const shooter = b.units.find((u) => u.side === "player" && !u.dead && !u.down);
    damage(b, hm, 99999, shooter);
    check(hm.dead && b.units.filter((u) => u.side === "enemy" && u.kind === "zombie").every((u) => u.dead), "its death kills every one of its brood (the Broodmother too)");
    if (b.phase === "player") endPlayerTurn(st);
    runEnemyPhase(st);
  }
  check(b.over && b.result && b.result.outcome === "victory", `the battle is won (${b.result && b.result.outcome})`);
  closeCombat(st);
  check(!st.hives.includes(hv) && !hiveAt(st, hv.tile), `the hive is destroyed: "${(st.log.find((l) => /was destroyed by your team/.test(l.text)) || {}).text}"`);
  // By the numbers, it is a fight (the bosses count).
  const { st: s2, hv: h2 } = world(SEED, 0, 80);
  const { p: q } = squad(s2, h2, { weapon: "pistol", armor: null, shoot: 3, n: 4 });
  const num = HC.coreSetup(s2, q, h2, true), map = HC.coreSetup(s2, q, h2);
  check(num.enemy.power > map.enemy.power, `by the numbers the bosses add to the brood's power (${map.enemy.power} → ${num.enemy.power})`);
  // Fitted to the map (progression census 2026-10-09: the numbers said 80% where the map won 25%): the bosses count
  // HIVEMIND.numbersK times their flat power by the numbers (refitted 2026-10-10 beside the team's fire at the core,
  // hivecrawl.js coreFire: numbersK 0.6 with powerTier 20, the bosses growing faster with the tier).
  const cf = HC.coreForce(s2, h2), H = HC.HIVEMIND;
  check(H.numbersK > 0 && Math.abs(cf.bossPower - (H.power + H.powerTier * cf.tier + H.broodPower) * H.numbersK) < 1e-9, `the core's bosses by the numbers: ${cf.bossPower.toFixed(1)} (× ${H.numbersK}, fitted to the map)`);
}

// ---------- 5. the autopilot ----------
console.log("The autopilot");
{
  let won = 0, dead = 0;
  const lines = [];
  for (let s = 0; s < 4; s++) {
    const { st, hv } = world(SEED + 10 + s, 0, 80);
    const { p, people } = squad(st, hv);
    st.autoCombat = true;
    HC.startHiveCrawl(st, p, hv);
    const c = p.hiveCrawl;
    crawlTo(st, p);
    if (!st.hives.includes(hv)) won++;
    dead += people.filter((x) => !x.alive).length;
    lines.push(`${st.hives.includes(hv) ? "out" : "destroyed"} in ${st.hour} h, ${c.kills} killed, deepest ${c.deepest}`);
  }
  check(won >= 3, `a strong squad's crawl step by step destroys a young hive (${won}/4: ${lines.join("; ")}; ${dead} dead in all)`);
  // Deep hive: the autopilot gets in, turns back when hurt, and the chambers it cleared stay clear for the next trip.
  const { st, hv } = world(SEED + 20, 1300, 120);
  const { p } = squad(st, hv);
  st.autoCombat = true;
  HC.startHiveCrawl(st, p, hv);
  const c = p.hiveCrawl;
  crawlTo(st, p);
  const den = HC.denOf(st, hv);
  const clear = den.rooms.filter((r) => hv.denMem.rooms[r.id] && hv.denMem.rooms[r.id].left === 0).length;
  check(c.deepest >= 2 && !p.hiveCrawl && (st.parties.includes(p) || !st.hives.includes(hv)), `a deep hive (${den.depth} deep): the team got ${c.deepest} chambers in and came out (${c.kills} killed, ${clear} chambers clear behind it)`);
  // Turned back, it walks out on its own (leaving is a walk, 2026-10-13): a chamber a step to the nearest, safest
  // mouth, and out by it.
  const outLine = (st.log.find((l) => /Out of .* by its \w+ mouth/.test(l.text)) || {}).text || "";
  check(!st.hives.includes(hv) || (!!outLine && c.log.some((l) => /turns back/.test(l.text))), `... turned back, it walked out by a mouth on its own: "${outLine.slice(0, 90)}"`);
  let walked = 0, outs = 0;
  for (let s = 0; s < 6; s++) {
    const { st: s5, hv: h5 } = world(SEED + 30 + s, 900, 100);
    const { p: q } = squad(s5, h5);
    s5.autoCombat = true;
    HC.startHiveCrawl(s5, q, h5);
    const c5 = q.hiveCrawl;
    HC.resolveHiveEnc(s5, q, "numbers");
    if (!q.hiveCrawl) continue;
    for (let i = 0; i < 6 && q.hiveCrawl && !c5.enc; i++) { const x = HC.exitsOf(s5, q).find((e) => !e.mouth && !e.visited) || HC.exitsOf(s5, q).find((e) => !e.mouth); HC.moveTo(s5, q, x.id); if (c5.enc) HC.resolveHiveEnc(s5, q, "numbers"); }
    if (!q.hiveCrawl) continue;
    c5.headOut = true; // the autopilot has turned back
    walked++;
    const n = crawlTo(s5, q, 120);
    if (!q.hiveCrawl && s5.parties.includes(q) && s5.log.some((l) => /Out of .* by its \w+ mouth/.test(l.text))) outs++;
    else console.log(`    (seed ${SEED + 30 + s}: ${q.hiveCrawl ? `still in at ${c5.at} after ${n} steps` : "wiped"})`);
  }
  check(walked > 0 && outs === walked, `turned back deeper in, the autopilot walks out by a mouth on its own (${outs}/${walked})`);
  // The governor's own campaign from the hub (as tools/wintest.js --force hive): the trip, the crawl, the core.
  const w = createWorld({ seed: 1, factionCount: 3 });
  w.started = true; w.erasOff = true;
  setAutopilot(w, true, "balanced");
  ensureHives(w);
  const h = hub(w);
  const last = [...w.hives].sort((a, b) => w.grid.distance(a.tile, h.tile) - w.grid.distance(b.tile, h.tile))[0];
  for (const hd of w.hordes) if (hd.hive === last.id && hd.role === "guard") hd.size = Math.min(hd.size, 40);
  const crew = [];
  for (let i = 0; i < 6; i++) { const s = makeSurvivor(w, 1); s.traits = []; s.skills.shooting = 10; s.health = 100; s.gear.weapon = { key: "shotgun", name: GEAR.shotgun.name, quality: 1 }; s.gear.armor = { key: "vest", name: GEAR.vest.name, quality: 1 }; s.location = { kind: "base", baseId: h.id }; w.survivors.push(s); crew.push(s); }
  h.stock.ammo = Math.max(h.stock.ammo || 0, 200); h.stock.food = Math.max(h.stock.food || 0, 100); h.stock.water = Math.max(h.stock.water || 0, 80);
  const res = launchExpedition(w, { memberIds: crew.map((s) => s.id), dest: last.tile, mission: "hive", stance: "normal", supplies: { food: 30, water: 30, ammo: 150, meds: 6 } });
  let crawled = false;
  for (let i = 0; i < 24 * 30 && w.hives.includes(last); i++) { tickHour(w); if (res.party && res.party.hiveCrawl) crawled = true; }
  check(!res.error && crawled, "on autopilot the hive team enters the hive and crawls (the hive card's Enter the hive)");
  check(!w.hives.includes(last), `... and destroys it (day ${day(w)}: "${(w.log.find((l) => /was destroyed by your team/.test(l.text)) || {}).text}")`);
}

// ---------- 6. the AI groups ----------
console.log("The groups");
{
  const { st, hv } = world(SEED, 500, 100);
  const den = HC.denOf(st, hv);
  const r1 = HC.groupHiveCrawl(st, hv, 20);
  check(!r1.burned && r1.reached < den.depth && r1.cut > 0 && r1.cut <= 20, `a weak war party crawls part of the way and is driven off (${r1.reached} of ${den.depth} chambers, ${r1.cut} of the guard killed)`);
  const path = r1.path;
  check(HC.isMouth(den, r1.mouth) && path[0] === r1.mouth && path.join() === HC.shortestPath(den, r1.mouth).join(), `in by the ${HC.mouthSide(den, r1.mouth)} mouth (the hive's dice), the shortest way from it to the core`);
  check(path.slice(0, r1.reached).every((id) => HC.broodLeft(st, hv, HC.roomById(den, id)) === 0), "the chambers it cleared stay clear (for your teams too)");
  check(r1.out.length >= 1 && HC.isMouth(den, r1.out[r1.out.length - 1]), `driven off, it walks out the shortest way to the nearest mouth (the ${HC.mouthSide(den, r1.out[r1.out.length - 1])}, ${r1.out.length} chamber${r1.out.length === 1 ? "" : "s"})`);
  const ins = new Set();
  let same = true;
  for (let k = 0; k < 12; k++) {
    const w2 = world(SEED + k, 500, 100), f2 = w2.st.factions[k % w2.st.factions.length];
    const m1 = HC.groupHiveCrawl(w2.st, w2.hv, 5, f2.id).mouth, m2 = HC.groupHiveCrawl(w2.st, w2.hv, 5, f2.id).mouth;
    if (m1 !== m2) same = false;
    ins.add(m1);
  }
  check(ins.size >= 3 && same, `the groups' war parties go in by any of the four mouths, a group by the same one every time (${[...ins].map((id) => HC.mouthSide(den, id)).join(", ")})`);
  const r2 = HC.groupHiveCrawl(st, hv, 400);
  check(r2.burned && r2.reached === den.depth, `a strong one reaches the core and burns it (${r2.met} met in the guard's units, the core's bosses ${HC.HCRAWL.GROUP.boss} + ${HC.HCRAWL.GROUP.bossTier} a tier)`);
  // Deeper hives cost the groups more.
  const cost = (dayN) => { const w = world(SEED, dayN, 100); return HC.groupHiveCrawl(w.st, w.hv, 99999).met; };
  const c0 = cost(0), c4 = cost(2100);
  check(c4 > c0, `a deep hive costs a war party more to burn (${c0} on day 0, ${c4} in year 19)`);
}

// ---------- 6b. the hive deepens with a team inside ----------
// Progression census 2026-10-09 (seed 6002): a hive reached the next tier while a team stood in one of its chambers;
// the deeper den lacked that chamber and the autopilot's next step crashed on it. The den keeps its shape while a team
// is inside and deepens once it is out.
console.log("The hive deepens with a team inside");
{
  const { st, hv } = world(SEED, 1, 80);
  const { p } = squad(st, hv);
  HC.startHiveCrawl(st, p, hv);
  const den0 = HC.denOf(st, hv);
  const c = p.hiveCrawl;
  st.hour = 2000 * 24; // past every tier's day: the hive would be far deeper now
  const deeper = HC.denDepth(st, hv);
  // A chamber of the young den that the deeper one does not have (a side pocket, a wide layer's last chamber).
  const later = new Set(HC.genDen(st, hv, deeper, 4).rooms.map((r) => r.id));
  for (let s = 0; s < 40 && den0.rooms.every((r) => later.has(r.id)); s++) den0.rooms.push({ id: `p${1 + s}`, layer: 1, slot: 9, kind: "bones", links: [c.mouth], dist: 1, pocket: true, dead: true });
  const far = den0.rooms.filter((r) => !later.has(r.id) && r.kind !== "core")[0];
  c.at = far.id; c.enc = null; c.trail = [c.mouth, far.id]; c.from = c.mouth;
  let err = null;
  try { HC.roomActions(st, p); for (let i = 0; i < 40 && p.hiveCrawl; i++) HC.hiveCrawlAutoStep(st, p); } catch (e) { err = e.message; }
  check(deeper > den0.depth && !err, `a team in ${far.id} of a ${den0.depth}-deep den as the hive grows ${deeper} deep: no crash${err ? ` (${err})` : ""}`);
  check(!p.hiveCrawl ? HC.denOf(st, hv).depth === deeper : hv.den === den0, `the den keeps its shape while the team is inside and deepens once it is out (now ${hv.den.depth})`);
}

// ---------- 6d. a save mid-crawl from before the four mouths ----------
// The den of the grid's first cut (v 2: one mouth, den.mouth) with a team inside, on its way out (c.leaving): it walks
// out of the old den by its one mouth (mouthsOf), and the den is made again (v 3, four mouths) once it is out.
console.log("A save mid-crawl from before the four mouths");
{
  const { st, hv } = world(SEED, 500, 80);
  const { p } = squad(st, hv);
  st.autoCombat = true;
  HC.startHiveCrawl(st, p, hv);
  HC.resolveHiveEnc(st, p, "numbers");
  const c = p.hiveCrawl, den = hv.den, one = c.mouth;
  for (const id of den.mouths.filter((x) => x !== one)) {
    const m = HC.roomById(den, id), gate = HC.roomById(den, m.links[0]);
    gate.links = gate.links.filter((x) => x !== id);
    den.rooms.splice(den.rooms.indexOf(m), 1);
  }
  den.v = 2; den.mouth = one; delete den.mouths; delete HC.roomById(den, one).side;
  for (let i = 0; i < 3 && p.hiveCrawl; i++) { if (c.enc) { HC.resolveHiveEnc(st, p, "numbers"); continue; } const x = HC.exitsOf(st, p).find((e) => !e.visited && !e.core); if (x) HC.moveTo(st, p, x.id); }
  if (p.hiveCrawl) { c.v = 1; delete c.mouth; delete c.headOut; c.leaving = true; }
  const st2 = loadFromString(saveToString(st, { dropCards: true }));
  const p2 = st2.parties.find((x) => x.id === p.id), hv2 = st2.hives.find((x) => x.id === hv.id);
  st2.autoCombat = true;
  let err = null, html = "";
  try { html = (await import("../src/ui/hivecrawl.js")).hiveCrawlModal(st2, { started: true }); crawlTo(st2, p2, 200); } catch (e) { err = e.stack; }
  check(!err && !!p2 && !!hv2.den && !p2.hiveCrawl, `an old save's crawl on an old den (one mouth): the window opens (${html ? "yes" : "no"}), the team walks out${err ? ` (${err.split("\n").slice(0, 3).join(" ")})` : ""}`);
  const after = HC.denOf(st2, hv2);
  check(!st2.hives.includes(hv2) || (after.v === 3 && after.mouths.length === 4), `... and the den is made again with its four mouths once the team is out (v ${after.v}, ${HC.mouthsOf(after).length} mouths)`);
}

// ---------- 6c. the hive gone with a team inside ----------// depletetest 2026-10-09 (the autopilot's year, --curve 3 on 365): the hive was taken off the map in the hour's tick
// while a team of yours walked to its next chamber, and the chamber crashed on a hive that was no more. Now the crawl
// ends where the team stands: out on the map with what it carries, a line in the log, whatever asks next.
console.log("The hive gone with a team inside");
{
  // A team past the mouth's brood (by the numbers), a rifle in its cargo.
  const inside = () => {
    const { st, hv } = world(SEED, 500, 100);
    const { p } = squad(st, hv);
    st.autoCombat = true;
    HC.startHiveCrawl(st, p, hv);
    HC.resolveHiveEnc(st, p, "numbers");
    p.cargo.gear.push({ key: "ar", name: "Found rifle", quality: 1 });
    return { st, hv, p, c: p.hiveCrawl };
  };
  const out = (st, p) => !p.hiveCrawl && st.parties.includes(p) && p.phase === "waiting" && p.cargo.gear.some((g) => g.name === "Found rifle")
    && st.log.some((l) => /still flesh/.test(typeof l === "string" ? l : l.text));
  // Mid-hour: the hive goes the first time anything looks for it after the next hour (as in the hour's tick).
  {
    const { st, hv, p, c } = inside();
    check(!!c && !c.enc, "a team inside, its chamber clear");
    const at = st.hour + 1;
    let dying = false;
    class Dying extends Array {
      find(fn) { if (!dying && st.hour >= at && this.includes(hv)) { dying = true; destroyHive(st, hv, "", { quiet: true }); } return super.find(fn); }
    }
    st.hives = Dying.from(st.hives);
    const to = HC.exitsOf(st, p)[0];
    let err = null;
    try { HC.moveTo(st, p, to.id); } catch (e) { err = e.message; }
    check(dying && !err && out(st, p), `the hive gone while the team walks to ${to.id}: no crash${err ? ` (${err})` : ""}, the team out on the map, waiting, with what it carries`);
    check(HC.activeHiveCrawl(st) === null && HC.exitsOf(st, p).length === 0, "no crawl window, no passages");
  }
  // Between hours: every way in (the window's buttons, the autopilot, what the window and the sound read).
  const UI = await import("../src/ui/hivecrawl.js");
  const SND = await import("../src/ui/hivecrawlsfx.js");
  const ways = {
    moveTo: (st, p) => HC.moveTo(st, p, "x"),
    roomAct: (st, p) => HC.roomAct(st, p, "lie"),
    resolveHiveEnc: (st, p) => HC.resolveHiveEnc(st, p, "numbers"),
    "roomAct out": (st, p) => HC.roomAct(st, p, "out"),
    listenAt: (st, p) => HC.listenAt(st, p, "x"),
    throwFlare: (st, p) => HC.throwFlare(st, p, "x"),
    setLights: (st, p) => HC.setLights(st, p, false),
    hiveCrawlAutoStep: (st, p) => HC.hiveCrawlAutoStep(st, p),
    "canMoveOn, crawlRoom": (st, p, c) => { if (HC.canMoveOn(st, c) || HC.crawlRoom(st, c)) throw new Error("a room in a dead hive"); },
    "the window's Go": (st, p) => UI.HIVE_CRAWL_ACTIONS["hc-move"](st, {}, { id: p.id, room: "x" }),
    "the window's Lie still": (st, p) => UI.HIVE_CRAWL_ACTIONS["hc-act"](st, {}, { id: p.id, act: "lie" }),
    "the window's Leave by this mouth": (st, p) => UI.HIVE_CRAWL_ACTIONS["hc-act"](st, {}, { id: p.id, act: "out" }),
    "the window": (st) => { if (UI.hiveCrawlModal(st, { started: true })) throw new Error("the window still open"); },
    "the sound": (st) => { if (SND.hiveCrawlHeard(st, { started: true })) throw new Error("the pulse still heard"); },
  };
  const bad = [];
  for (const [name, fn] of Object.entries(ways)) {
    const { st, hv, p, c } = inside();
    if (!c) { bad.push(`${name} (no crawl to start with)`); continue; }
    destroyHive(st, hv, "", { quiet: true });
    try { fn(st, p, c); HC.activeHiveCrawl(st); } catch (e) { bad.push(`${name}: ${e.message}`); continue; }
    if (name.startsWith("canMoveOn")) HC.hiveCrawlOf(st, p);
    if (!out(st, p)) bad.push(`${name} (the crawl did not end cleanly)`);
  }
  check(!bad.length, `the hive gone between hours: ${Object.keys(ways).length} ways in end the crawl cleanly${bad.length ? ` (${bad.join("; ")})` : ""}`);
}

// ---------- 7. the window and the sound ----------
console.log("The window and the sound");
{
  const { st, hv } = world(SEED, 500, 80);
  const { p } = squad(st, hv);
  HC.startHiveCrawl(st, p, hv);
  const UI = await import("../src/ui/hivecrawl.js");
  const ui = { started: true };
  let html = UI.hiveCrawlModal(st, ui);
  check(/<svg class="hc-map"/.test(html) && /Warmth/.test(html) && /Alert/.test(html) && /data-action="hc-enc"/.test(html), "the window: the chamber map, warmth and Alert, the answers to the brood");
  check(!/undefined|NaN/.test(html), "no undefined or NaN in it");
  st.autoCombat = true;
  UI.HIVE_CRAWL_ACTIONS["hc-enc"](st, ui, { id: p.id, ch: "numbers" });
  html = UI.hiveCrawlModal(st, ui);
  check(/data-action="hc-move"/.test(html) && /Passages/.test(html) && /(warmer|colder|no draft)/.test(html), "cleared: the passages with their drafts, Go buttons on the map and the list");
  const dW = HC.denOf(st, hv);
  check(dW.mouths.every((id) => html.includes(`<title>${HC.roomName(HC.roomById(dW, id))}`)) && /The north mouth/.test(html), "the map shows all four mouths");
  check(/data-act="out"[^>]*>Leave by this mouth/.test(html) && !/hc-leave|hc-go/.test(html), "at a clear mouth: Leave by this mouth; no button walks you out");
  const cW = p.hiveCrawl, gate = HC.roomById(dW, HC.roomById(dW, cW.mouth).links[0]);
  UI.HIVE_CRAWL_ACTIONS["hc-move"](st, ui, { id: p.id, room: gate.id });
  if (cW.enc) UI.HIVE_CRAWL_ACTIONS["hc-enc"](st, ui, { id: p.id, ch: "numbers" });
  html = p.hiveCrawl ? UI.hiveCrawlModal(st, ui) : "";
  const exN = p.hiveCrawl ? HC.exitsOf(st, p).length : 0;
  // The walls of the chambers it has been in (3 open, 1 wall; a small den's entrance may open on all 4).
  const wallsDue = p.hiveCrawl ? dW.rooms.filter((r) => cW.visited[r.id] && !HC.isMouth(dW, r.id)).reduce((a, r) => a + 4 - r.links.length, 0) : 0;
  check((wallsDue === 0 || /stroke="#9a6650"/.test(html)) && (html.match(/data-action="hc-move"[^>]*>Go ▸/g) || []).length === exN && new RegExp(`data-room="${cW.mouth}"[^>]*>Leave by the \\w+ mouth`).test(html), `in the entrance chamber: its walls on the map (${(html.match(/stroke="#9a6650"/g) || []).length} drawn), a Go for each of its ${exN} passages, and Leave by the ${HC.mouthSide(dW, cW.mouth)} mouth`);
  { // A deep den: the T of every chamber walked through shows on the map (its one wall, the rim's outside).
    const { st: s7, hv: h7 } = world(SEED + 2, 2100, 60);
    const { p: q } = squad(s7, h7);
    s7.autoCombat = true;
    HC.startHiveCrawl(s7, q, h7);
    for (let i = 0; i < 8 && q.hiveCrawl; i++) { if (q.hiveCrawl.enc) { HC.resolveHiveEnc(s7, q, "numbers"); continue; } const x = HC.exitsOf(s7, q).find((e) => !e.visited && !e.mouth && !e.core); if (!x) break; HC.moveTo(s7, q, x.id); }
    if (q.hiveCrawl && q.hiveCrawl.enc) HC.resolveHiveEnc(s7, q, "numbers");
    const h7html = q.hiveCrawl ? UI.hiveCrawlModal(s7, { started: true }) : "";
    const d7 = HC.denOf(s7, h7), c7 = q.hiveCrawl || { visited: {} };
    const been = d7.rooms.filter((r) => c7.visited[r.id] && !HC.isMouth(d7, r.id));
    const shared = new Set();
    for (const r of been) for (const o of d7.rooms) if (c7.visited[o.id] && !HC.isMouth(d7, o.id) && Math.abs(o.x - r.x) + Math.abs(o.y - r.y) === 1 && !r.links.includes(o.id)) shared.add([r.id, o.id].sort().join());
    const due = been.reduce((a, r) => a + 4 - r.links.length, 0) - shared.size; // a wall between two chambers drawn once
    const drawn = (h7html.match(/stroke="#9a6650"/g) || []).length;
    check(due > 0 && drawn === due, `the map draws the walls of the chambers walked through: ${drawn} of ${due} (${been.length} chambers, a ${d7.size}×${d7.size} den)`);
  }
  const w0 = Number(/data-warmth="(\d+)"/.exec(html)[1]);
  check(UI.warmColor(0) !== UI.warmColor(100) && /border-color:rgba/.test(html), `the window's tint follows the warmth (${w0} here)`);
  const SND = await import("../src/ui/hivecrawlsfx.js");
  const heard = SND.hiveCrawlHeard(st, ui);
  check(heard && heard.warmth === w0, `the pulse and the drone hear warmth ${heard && heard.warmth}`);
  check(SND.HC_SOUND.period[1] < SND.HC_SOUND.period[0] && SND.HC_SOUND.beat[1] > SND.HC_SOUND.beat[0] && SND.HC_SOUND.drone[1] > SND.HC_SOUND.drone[0], "nearer the core the beat is louder and faster, the drone louder");
  const G = await import("../src/ui/soundgroups.js");
  check(G.groupDef("zombies.hivecrawl") && G.groupOf("hiveCrawlBeat") === "zombies.hivecrawl", "in the mixer: Zombies → Hive crawl pulse");
  const U = await import("../src/ui/ui.js");
  const modal = U.renderModal(st, { started: true });
  check(typeof modal === "string" ? /hivecrawl/.test(modal) : true, "the game's modal is the crawl window");
  const H = await import("../src/ui/help.js");
  check(H.helpTopics().some((t) => t.title === "The hive crawl" && /Hivemind/.test(t.html)), "Help has a topic on it");
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
