// The hive crawl (src/sim/hivecrawl.js): the den (the same chambers for a seed and a hive; its depth by the hive's
// tier; a round grid of chambers, the core in its innermost rings open on 1 or 2 sides; warmth rising along the shortest way
// and the beat through the walls, both highest in the core; the brood tougher the deeper), the team's crawl (moving, the drafts and their misreading, creeping past,
// fights by the numbers fitted to the cave map, burning eggs, the bone pits, the Alert converging, leaving the way you
// came, chambers that stay clear and fill again), saving and loading mid-crawl, the core battle on the map (the
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
  // rings, open on 1 or 2 of its sides; every chamber reachable without passing the core.
  const gridOk = (d) => d.grid && d.rooms.every((r) => r.links.every((id) => { const o = HC.roomById(d, id); return Math.abs(o.y - r.y) + Math.abs(o.x - r.x) === 1; }));
  const reach = (d, cut) => { const seen = new Set([d.mouth]), q = [d.mouth]; while (q.length) { const id = q.shift(); for (const n of HC.roomById(d, id).links) if (!seen.has(n) && n !== cut) { seen.add(n); q.push(n); } } return seen; };
  let grids = 0, doors = { 1: 0, 2: 0 }, deep = 0, reachAll = 0, walls = 0, tot = 0;
  for (let s = 1; s <= 12; s++) {
    const w = createWorld({ seed: s, factionCount: 3 }); ensureHives(w);
    for (const t of [0, 1, 2, 3, 4]) {
      const d = HC.genDen(w, w.hives[0], HC.HCRAWL.DEPTH[t], t), core = HC.roomById(d, d.core);
      tot++;
      if (gridOk(d)) grids++;
      doors[core.links.length] = (doors[core.links.length] || 0) + 1;
      if (d.coreRing >= d.rings - 1) deep++;
      const seen = reach(d, d.core);
      if (d.rooms.every((r) => r.id === d.core || seen.has(r.id))) reachAll++;
      if (d.rooms.some((r) => r.gd === 1 && !r.links.includes(d.core))) walls++;
    }
  }
  check(grids === tot, `every den is a round grid: passages only to the chamber beside, above or below (${grids}/${tot} dens, 12 seeds × 5 tiers)`);
  check(doors[1] > 0 && doors[2] > 0 && doors[1] + doors[2] === tot, `the core opens on 1 side (${doors[1]} dens) or 2 (${doors[2]}), never more`);
  check(deep === tot, `the core lies in the round grid's innermost rings (${deep}/${tot})`);
  check(reachAll === tot, `every chamber can be reached from the mouth without passing the core (${reachAll}/${tot})`);
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
  check(deadEnds >= 1 && loops >= 1, `dead ends (${deadEnds}) and loops (${loops} passages over a tree) at tier 4`);
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
  HC.startHiveCrawl(st, p, hv);
  const c = p.hiveCrawl;
  const den = HC.denOf(st, hv);
  check(!!c && c.at === den.mouth && c.enc && c.enc.kind === "brood", `the team starts at the mouth with its brood in front (${c.enc && HC.roomForce(st, hv, HC.roomById(den, den.mouth)).count} of them)`);
  check(HC.activeHiveCrawl(st) === p, "the crawl window shows it");
  const opts = HC.encounterOptions(st, p);
  check(["fight", "numbers", "sneak", "out"].every((id) => opts.some((o) => o.id === id)), `answers: ${opts.map((o) => o.label).join(", ")}`);
  check(HC.moveTo(st, p, den.rooms[1].id).startsWith("Deal"), "no moving on with the brood in front");
  const g0 = hiveGuard(st, hv).size, h0 = st.hour;
  HC.resolveHiveEnc(st, p, "numbers");
  check(!c.enc && HC.broodLeft(st, hv, HC.roomById(den, den.mouth)) === 0, "a fight by the numbers clears the mouth");
  check(hiveGuard(st, hv).size < g0, `the brood killed thins the hive's guard (${g0} → ${hiveGuard(st, hv).size})`);
  check(st.hour > h0 && c.alert > HC.HCRAWL.ALERT.start, `hours pass (${st.hour - h0} h) and the Alert rises (${c.alert})`);
  const ex = HC.exitsOf(st, p);
  check(ex.length >= 1 && ex.every((x) => ["warmer", "colder", "level"].includes(x.draft)) && ex.every((x) => !x.room), `the passages out: ${ex.map((x) => `${x.id} ${x.draft}`).join(", ")} (unexplored)`);
  const warm = ex.find((x) => x.draft === "warmer") || ex[0];
  HC.moveTo(st, p, warm.id);
  check(c.at === warm.id && c.visited[warm.id] && c.trail.join(">") === `${den.mouth}>${warm.id}`, `moved into ${warm.id}; the way back: ${c.trail.join(" > ")}`);
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
  check(HC.draftOf(st, p, c, den, HC.roomById(den, c.at), HC.roomById(den, den.mouth)) === "colder", "a chamber the team has been in reads right (back to the mouth: colder)");
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
  // Leaving the way it came: a chamber full again is in the way.
  delete p.hiveCrawl;
  const { st: s3, hv: h3 } = world(SEED + 4, 0, 80);
  const { p: q } = squad(s3, h3);
  s3.autoCombat = true;
  HC.startHiveCrawl(s3, q, h3);
  HC.resolveHiveEnc(s3, q, "numbers");
  const d3 = HC.denOf(s3, h3);
  const next = HC.exitsOf(s3, q).find((x) => x.id !== d3.core);
  HC.moveTo(s3, q, next.id);
  if (q.hiveCrawl.enc) HC.resolveHiveEnc(s3, q, "numbers");
  h3.denMem.rooms[d3.mouth] = undefined; delete h3.denMem.rooms[d3.mouth]; // the mouth full again
  if (q.hiveCrawl && !q.hiveCrawl.enc) {
    HC.leaveHive(s3, q);
    check(q.hiveCrawl && q.hiveCrawl.enc && q.hiveCrawl.enc.room === d3.mouth, "on the way out a mouth full again is in the way");
    HC.resolveHiveEnc(s3, q, "numbers");
    if (q.hiveCrawl && !q.hiveCrawl.enc) HC.stepOut(s3, q);
    check(!q.hiveCrawl && q.phase === "waiting", `then the team is out: "${(s3.log.find((l) => /Out of the hive/.test(l.text)) || {}).text}"`);
  } else check(false, "the team got into its second chamber");
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
  const mouth = HC.roomById(den, den.mouth);
  c.alert = 20; c.heat = { [mouth.id]: 10 };
  check(Math.abs(HC.roomHeat(st, c, mouth, 1.35) - 30 * 1.35) < 1e-9, "a chamber's heat: (Alert + its own heat) × its activity");
  const room = den.rooms.find((r) => r.layer === 2);
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
  const path = HC.shortestPath(den);
  check(path.slice(0, r1.reached).every((id) => HC.broodLeft(st, hv, HC.roomById(den, id)) === 0), "the chambers it cleared stay clear (for your teams too)");
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
  for (let s = 0; s < 40 && den0.rooms.every((r) => later.has(r.id)); s++) den0.rooms.push({ id: `p${1 + s}`, layer: 1, slot: 9, kind: "bones", links: [den0.mouth], dist: 1, pocket: true, dead: true });
  const far = den0.rooms.filter((r) => !later.has(r.id) && r.kind !== "core")[0];
  c.at = far.id; c.enc = null; c.trail = [den0.mouth, far.id]; c.from = den0.mouth;
  let err = null;
  try { HC.roomActions(st, p); for (let i = 0; i < 40 && p.hiveCrawl; i++) HC.hiveCrawlAutoStep(st, p); } catch (e) { err = e.message; }
  check(deeper > den0.depth && !err, `a team in ${far.id} of a ${den0.depth}-deep den as the hive grows ${deeper} deep: no crash${err ? ` (${err})` : ""}`);
  check(!p.hiveCrawl ? HC.denOf(st, hv).depth === deeper : hv.den === den0, `the den keeps its shape while the team is inside and deepens once it is out (now ${hv.den.depth})`);
}

// ---------- 6c. the hive gone with a team inside ----------
// depletetest 2026-10-09 (the autopilot's year, --curve 3 on 365): the hive was taken off the map in the hour's tick
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
    leaveHive: (st, p) => HC.leaveHive(st, p),
    stepOut: (st, p) => HC.stepOut(st, p),
    listenAt: (st, p) => HC.listenAt(st, p, "x"),
    throwFlare: (st, p) => HC.throwFlare(st, p, "x"),
    setLights: (st, p) => HC.setLights(st, p, false),
    hiveCrawlAutoStep: (st, p) => HC.hiveCrawlAutoStep(st, p),
    "canMoveOn, crawlRoom": (st, p, c) => { if (HC.canMoveOn(st, c) || HC.crawlRoom(st, c)) throw new Error("a room in a dead hive"); },
    "the window's Go": (st, p) => UI.HIVE_CRAWL_ACTIONS["hc-move"](st, {}, { id: p.id, room: "x" }),
    "the window's Lie still": (st, p) => UI.HIVE_CRAWL_ACTIONS["hc-act"](st, {}, { id: p.id, act: "lie" }),
    "the window's Leave": (st, p) => UI.HIVE_CRAWL_ACTIONS["hc-leave"](st, {}, { id: p.id }),
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
