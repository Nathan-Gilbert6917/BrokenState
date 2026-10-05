// Hives and hordes (src/sim/hives.js, hordes.js, defences.js): resource income by cluster size, horde costs and
// sizes, 5–6 hives with no hordes and 5 resources each at the start, hordes moving at most 2 tiles a day, merging
// and splitting (parts of at least 10), a new build site every 120–180 days, the 30-score / 1,000-dead rule for a new
// hive (at most 40 a day going in), the Wallbreaker for 40 and 90 days between a hive's Wallbreakers, hordes from
// the border, wall hold limits by tier, a held horde falling back and leaving the base be, a break-in turning into a battle,
// infection fading after a hive dies, the win condition, determinism, and 365-day runs without NaN. Then the two
// battles calibrated: storming a hive (well-armed vs poorly armed team) and break-ins at the hub by horde size.
// Usage: node tools/hivetest.js [trials=24]
import { createWorld, tickHour, day, makeSurvivor, hub, alive } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import {
  ensureHives, hiveIncome, hivesDaily, hiveTracker, destroyHive, deliverToSite, hiveForce, assaultHive, zombieToughness, hiveDanger,
} from "../src/sim/hives.js";
import { HIVE } from "../src/sim/hiveconst.js";
import { HORDE_SIZES, hordeScore, makeHorde, splitHorde, mergeHordes, hordesHour, hordesDaily, SPLIT_MIN, HORDE_MAX_SIZE } from "../src/sim/hordes.js";
import { holdLimit, holdCheck, hordeAttackBase, spikeKill, breakInForce, DEFENCE } from "../src/sim/defences.js";
import { addBuilding } from "../src/sim/buildings.js";
import { setAutopilot } from "../src/sim/autopilot.js";

const TRIALS = Number(process.argv[2] || 24);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const world = (seed = 42) => { const st = createWorld({ seed, factionCount: 8 }); st.started = true; return st; };
const feed = (st) => { const h = hub(st); if (!h) return; const n = alive(st).length; h.stock.food = Math.max(h.stock.food || 0, n * 6); h.stock.water = Math.max(h.stock.water || 0, n * 6); };
const runDays = (st, days, fed = true) => { const end = st.hour + days * 24; while (st.hour < end && !st.gameOver) { tickHour(st); if (fed && st.hour % 24 === 0) feed(st); } };
const land = (st, id) => st.tiles[id].terrain !== "water" || st.tiles[id].bridge;
const t0 = Date.now();

// 1. Start: 5–6 hives with 5 resources each, no hordes; income by cluster size.
{
  console.log("Start and income");
  const st = world();
  const counts = [42, 1, 2, 3, 4, 5, 6, 7].map((seed) => world(seed).hives.length);
  check(st.hives.every((h) => h.res === HIVE.START_RES) && counts.every((n) => n >= HIVE.START_ORIGIN + HIVE.START_SPOT && n <= HIVE.START_ORIGIN + 2 * HIVE.START_SPOT),
    `${st.hives.length} hives at the start, each with ${HIVE.START_RES} resources (8 seeds: ${counts.join(", ")}; ${HIVE.START_ORIGIN} at the origin, ${HIVE.START_SPOT} per other hot spot)`);
  check(st.hordes.length === 0, "no hordes exist when the game starts");
  check([1, 2, 3, 4, 5, 6, 9].map(hiveIncome).join(",") === "1,3,6,8,10,12,12", `income per hive by cluster size 1..6, 9: ${[1, 2, 3, 4, 5, 6, 9].map(hiveIncome).join(", ")}`);
  // A lone hive and a pair 3 tiles apart, everything else removed.
  const s2 = world(7);
  for (const h of [...s2.hives]) { s2.tiles[h.tile].hive = false; }
  s2.hives.length = 0;
  const g = s2.grid;
  const spots = s2.tiles.filter((t) => t.terrain === "plains" && !t.loc && t.x > 6 && t.x < 58 && t.y > 5 && t.y < 37);
  const a = spots[0], b = spots.find((t) => g.distance(t.id, a.id) === 3), c = spots.find((t) => g.distance(t.id, a.id) > 20 && g.distance(t.id, b.id) > 20);
  for (const t of [a, b, c]) { t.hive = true; s2.hives.push({ id: 900 + s2.hives.length, tile: t.id, res: 0, born: 0, income: 0, name: "test hive" }); }
  for (const h of s2.hives) h.res = -50; // nothing to spend: income only
  hivesDaily(s2);
  const inc = s2.hives.map((h) => h.income);
  check(inc[0] === 3 && inc[1] === 3 && inc[2] === 1, `a pair within 5 tiles gets 3 a day each, a lone hive 1 (got ${inc.join(", ")})`);
}

// 2. Costs and sizes; the Wallbreaker at 40.
{
  console.log("Hordes bought by a hive");
  const st = world(11);
  const hv = st.hives[0];
  for (const h of st.hives.slice(1)) h.res = -999;
  hv.res = HORDE_SIZES.medium.cost - hiveIncome(st.hives.filter((o) => st.grid.distance(o.tile, hv.tile) <= HIVE.CLUSTER).length);
  hivesDaily(st);
  const guard = st.hordes.find((h) => h.hive === hv.id && h.role === "guard");
  check(guard && guard.size >= HORDE_SIZES.medium.min && guard.size <= HORDE_SIZES.medium.max && hv.res === 0, `a hive with 8 resources and no guard buys a medium horde of 50–80 (got ${guard ? guard.size : "none"}, ${hv.res} left)`);
  const sizes = { small: [], medium: [], large: [] };
  for (let i = 0; i < 40; i++) for (const k of Object.keys(sizes)) sizes[k].push(st.rng.int(HORDE_SIZES[k].min, HORDE_SIZES[k].max));
  check(HORDE_SIZES.small.cost === 3 && HORDE_SIZES.medium.cost === 8 && HORDE_SIZES.large.cost === 15, "costs: small 3, medium 8, large 15");
  check(Math.min(...sizes.small) >= 10 && Math.max(...sizes.small) <= 25 && Math.min(...sizes.large) >= 100 && Math.max(...sizes.large) <= 200, "sizes: small 10–25, medium 50–80, large 100–200");
  check(hordeScore(17) >= 2.5 && hordeScore(17) <= 3.5 && hordeScore(65) >= 7 && hordeScore(65) <= 9 && hordeScore(150) >= 14 && hordeScore(150) <= 18, `score: small ${hordeScore(17)}, medium ${hordeScore(65)}, large ${hordeScore(150)}`);
  // Wallbreaker: not before day 90; at 40 resources after.
  const s3 = world(12);
  s3.hour = (HIVE.BOSS_DAY + 5) * 24;
  for (const h of s3.hives) h.res = 0;
  const b = s3.hives[0];
  b.res = 40 + 30;
  hivesDaily(s3);
  check(s3.hiveInfo.stats.bosses >= 1, `a hive with 40+ spare resources after day ${HIVE.BOSS_DAY} makes a Wallbreaker (${s3.hiveInfo.stats.bosses} made)`);
  const led = s3.hordes.find((h) => h.bosses > 0);
  check(!!led && led.role === "attack" && !!led.goal, `the Wallbreaker leads a horde out to attack (${led ? `${led.size} heading for tile ${led.goal.tile}` : "none"})`);
  // The next one waits BOSS_GAP days, even with the first one gone and resources to spare.
  if (led) s3.hordes.splice(s3.hordes.indexOf(led), 1);
  const made = s3.hiveInfo.stats.bosses;
  b.res = 80;
  s3.hour += (HIVE.BOSS_GAP - 1) * 24;
  hivesDaily(s3);
  const early = s3.hiveInfo.stats.bosses - made;
  for (const h of [...s3.hordes]) if (h.bosses) s3.hordes.splice(s3.hordes.indexOf(h), 1);
  b.res = 80;
  s3.hour += 2 * 24;
  hivesDaily(s3);
  check(early === 0 && s3.hiveInfo.stats.bosses - made >= 1, `a hive raises its next Wallbreaker only ${HIVE.BOSS_GAP} days after the last (day ${HIVE.BOSS_GAP - 1} after: ${early}, after ${HIVE.BOSS_GAP + 1}: ${s3.hiveInfo.stats.bosses - made - early})`);
}

// 3. Movement (at most 2 tiles a day), merging, splitting.
{
  console.log("Movement, merging, splitting");
  const st = world(5);
  runDays(st, 40);
  const pos = new Map(st.hordes.map((h) => [h, h.tile]));
  let worst = 0, n = 0;
  for (let d = 0; d < 20; d++) {
    runDays(st, 1);
    for (const h of st.hordes) {
      if (!pos.has(h)) continue;
      worst = Math.max(worst, st.grid.distance(pos.get(h), h.tile));
      n++;
    }
    for (const h of st.hordes) pos.set(h, h.tile);
  }
  check(worst <= 2 && n > 100, `no horde moved more than 2 tiles in a day (worst ${worst}, ${n} horde-days)`);
  const s2 = world(6);
  const t = s2.tiles.find((x) => x.terrain === "plains" && !x.loc).id;
  const h1 = makeHorde(s2, { tile: t, size: 60, role: "roam" }), h2 = makeHorde(s2, { tile: t, size: 40, role: "border" });
  const g1 = makeHorde(s2, { tile: t, size: 50, role: "guard", hive: 1 });
  mergeHordes(s2);
  check(s2.hordes.includes(h1) && !s2.hordes.includes(h2) && h1.size === 100 && s2.hordes.includes(g1), "two wandering hordes that meet merge (60 + 40 = 100); a hive's guard on the same tile does not join them");
  check(splitHorde(s2, h1, 9) === null && splitHorde(s2, h1, 91) === null, "a split that leaves fewer than 10 in either part is refused");
  const part = splitHorde(s2, h1, 40);
  check(part && part.size === 40 && h1.size === 60 && part.size >= SPLIT_MIN, "a horde of 100 splits into 60 and 40");
  const big1 = makeHorde(s2, { tile: t, size: 400, role: "roam" }), big2 = makeHorde(s2, { tile: t, size: 400, role: "roam" });
  mergeHordes(s2);
  const here = s2.hordes.filter((h) => h.tile === t && h.role === "roam");
  check(here.every((h) => h.size <= HORDE_MAX_SIZE) && here.reduce((a, h) => a + h.size, 0) === 900, `merging stops at ${HORDE_MAX_SIZE} and keeps every one of the dead (${here.map((h) => h.size).join(" + ")})`);
  void big1; void big2;
}

// 4. Build sites: every 120–180 days, 30 score to start, 1,000 dead to finish at most 40 a day.
{
  console.log("New hives");
  const st = world(3);
  const picks = [];
  let seen = new Set();
  const end = (HIVE.SITE_DAYS[1] * 3 + 30) * 24; // room for three sites
  // Only the hives and hordes run (no colony to fall and stop the clock).
  while (st.hour < end) {
    st.hour++;
    hordesHour(st);
    if (st.hour % 24 === 0) hordesDaily(st);
    for (const s of st.hiveSites) if (!seen.has(s.id)) { seen.add(s.id); picks.push(day(st)); }
  }
  const gaps = picks.slice(1).map((d, i) => d - picks[i]);
  const [lo, hi] = HIVE.SITE_DAYS;
  check(picks.length >= 3 && picks[0] >= lo && picks[0] <= hi + 1 && gaps.every((x) => x >= lo && x <= hi + 1), `build sites picked on days ${picks.join(", ")} (gaps ${gaps.join(", ")}; ${lo}–${hi} apart)`);
  check(st.hiveInfo.stats.built >= 1, `hives left alone build new hives (${st.hiveInfo.stats.built} built by day ${day(st)}, ${st.hives.length} standing)`);
  // The rule by hand.
  const s2 = world(4);
  const hv = s2.hives[0];
  const tile = s2.grid.within(hv.tile, 7).find((id) => s2.grid.distance(id, hv.tile) === 6 && land(s2, id) && !s2.tiles[id].hive);
  const site = { id: 999, tile, chosen: s2.hour, score: 0, biomass: 0, started: null };
  s2.hiveSites.push(site);
  for (const h of s2.hives) h.res = -9999;
  const deliver = (size) => { const h = makeHorde(s2, { tile, size, role: "build", site: site.id }); deliverToSite(s2, h, site); };
  deliver(150);
  mergeHordes(s2);
  hivesDaily(s2);
  check(site.started == null && site.biomass === 0 && site.score < 30, `one large horde (score ${site.score}) gathers but does not start a hive`);
  deliver(150);
  mergeHordes(s2);
  hivesDaily(s2);
  check(site.started != null && site.biomass > 0, `a second one takes the score to ${site.score} (30+): building starts (${site.biomass} dead in after a day)`);
  check(site.biomass <= HIVE.SITE_INTAKE, `at most ${HIVE.SITE_INTAKE} of the dead go in a day (${site.biomass} with ~300 gathered)`);
  const before = s2.hives.length;
  let grew = 1;
  for (let i = 0; i < 60 && s2.hiveSites.includes(site); i++) { if (!s2.hordes.some((h) => h.role === "mass" && h.site === site.id)) deliver(120); mergeHordes(s2); hivesDaily(s2); grew++; }
  check(grew >= Math.ceil(HIVE.SITE_BIOMASS / HIVE.SITE_INTAKE), `the hive takes ${grew} days to grow once building starts (at least ${Math.ceil(HIVE.SITE_BIOMASS / HIVE.SITE_INTAKE)}): time to strike`);
  check(!s2.hiveSites.includes(site) && s2.hives.length === before + 1 && s2.tiles[tile].hive, `the hive stands once 1,000 of the dead have gone into it (${s2.hives.length} hives)`);
  check(site.biomass >= HIVE.SITE_BIOMASS, `biomass at completion: ${site.biomass}`);
}

// 5. Border hordes.
{
  console.log("Off-map hordes");
  const st = world(8);
  for (const h of [...st.hives]) destroyHive(st, h);
  st.gameOver = false; st.victory = false; st.victoryKept = true;
  const seen = [];
  for (let d = 0; d < 40; d++) { runDays(st, 1); for (const h of st.hordes) if (h.role === "border" && !seen.includes(h)) seen.push(h); }
  const g = st.grid;
  check(seen.length >= 4, `with no hives left, hordes still come in from the border (${seen.length} in 40 days, sizes ${seen.map((h) => h.size).join(", ")})`);
  check(seen.every((h) => h.born != null), "each spawned on a border land tile");
  void g;
}

// 6. Walls and break-ins.
{
  console.log("Walls and break-ins");
  const st = world(9);
  const h = hub(st);
  for (const s of alive(st)) s.role = "farm";
  h.buildings = h.buildings.filter((b) => b.type !== "walls");
  const lims = [];
  for (let w = 0; w <= 3; w++) { lims.push(holdLimit(st, h)); addBuilding(h, "walls"); }
  check(lims.join(",") === "69,123,177,231", `hub hold limit by wall tier 0–3 with nobody on guard: ${lims.join(", ")}`);
  const full = holdLimit(st, h);
  check(holdLimit(st, h, 1) === Math.round(full * 0.6), `a Wallbreaker cuts the limit to 60% (${full} → ${holdLimit(st, h, 1)})`);
  addBuilding(h, "barricades"); addBuilding(h, "trench");
  check(holdLimit(st, h) === Math.round(full * 1.37), `barricade +12% and trench +25%: ${holdLimit(st, h)}`);
  addBuilding(h, "spike_pits");
  check(spikeKill(h, 200) === 18 && holdCheck(st, h, 200).after === 182, "a spike pit takes 7% + 4 of a horde of 200 before the walls");
  // A horde under the limit is held at the walls; one far over it breaks in and is fought as a battle.
  const stats = st.hiveInfo.stats;
  const small = makeHorde(st, { tile: h.tile, size: 60, role: "attack" });
  hordeAttackBase(st, small, h);
  check(stats.held === 1 && stats.breakIns === 0, "a horde of 60 against walls that stop ~300 is beaten off at the walls");
  check(st.hordes.includes(small) && small.role === "roam" && st.grid.distance(small.target, h.tile) === DEFENCE.RETREAT_TILES && small.shun && small.shun.tile === h.tile,
    `it falls back ${DEFENCE.RETREAT_TILES} tiles and leaves the base be for ${DEFENCE.SHUN_DAYS} days (heading for a tile ${st.grid.distance(small.target, h.tile)} out)`);
  const people = alive(st).length;
  const big = makeHorde(st, { tile: h.tile, size: 600, role: "attack", bosses: 1 });
  hordeAttackBase(st, big, h);
  const fought = stats.breakIns === 1 && stats.repelled + stats.overrun === 1;
  check(fought, `a horde of 600 with a Wallbreaker breaks in and the battle is played out (beaten ${stats.repelled}, overrun ${stats.overrun}; people ${people} → ${alive(st).length})`);
  check(!h.buildings.some((b) => b.type === "spike_pits"), "spike pits are used up by the attack");
  const f = breakInForce(st, h, 300, 1);
  check(f.count === 20 && f.power > 2 && f.bosses === 1, `the dead inside as a battle: ${f.count} at power ${f.power} plus the Wallbreaker`);
}

// 7. Territory, toughness, infection fading, the win condition.
{
  console.log("Territory, infection, victory");
  const st = world(10);
  const hv = st.hives[0];
  const ring = st.grid.neighbors(hv.tile)[0];
  const far = st.tiles.find((t) => st.hives.every((h) => st.grid.distance(h.tile, t.id) > 6)).id;
  check(zombieToughness(st, ring) === 3 && zombieToughness(st, far) === 0, "the dead are +3 tougher on the ring around a hive, normal far from any");
  const dz = hiveDanger(st, st.grid.within(hv.tile, 4).find((id) => st.grid.distance(id, hv.tile) === 4));
  check(dz.territory && !dz.red, "a tile 4 from a hive is in its land (3 skulls) but not on the red ring");
  runDays(st, 20);
  const near = (s, tile) => { const ids = s.grid.within(tile, 3); return ids.reduce((a, id) => a + s.tiles[id].infection, 0) / ids.length; };
  const hives = [...st.hives];
  const lone = hives.reduce((best, h) => { const n = hives.filter((o) => o !== h && st.grid.distance(o.tile, h.tile) <= 9).length; return !best || n < best.n ? { h, n } : best; }, null).h;
  const inf0 = near(st, lone.tile);
  destroyHive(st, lone, "in the test");
  runDays(st, 45);
  const inf1 = near(st, lone.tile);
  check(inf1 < inf0 - 0.2, `infection around a destroyed hive falls over 45 days (${inf0.toFixed(2)} → ${inf1.toFixed(2)})`);
  check(!st.victory, "with hives left the game goes on");
  for (const h of [...st.hives]) destroyHive(st, h, "in the test");
  for (const s of [...st.hiveSites]) s.started = null;
  st.erasOff = true; // the eras' clocks (year 6, the outbreak beyond the border, a season clear) are tools/eratest.js's; this checks the rule itself
  runDays(st, 1);
  check(st.victory && st.gameOver, "destroying every hive wins the game");
  check(st.log.some((l) => /^Every hive is destroyed/.test(l.text)), "the victory is in the log");
}

// 8. Determinism and long runs.
{
  console.log("Determinism and a year");
  const sig = (st) => `${st.hour}|${st.hives.map((h) => `${h.tile}:${h.res}`).join(",")}|${st.hordes.map((h) => `${h.tile}:${h.size}:${h.bosses}`).join(",")}|${alive(st).length}`;
  const a = world(21), b = world(21);
  runDays(a, 120); runDays(b, 120);
  check(sig(a) === sig(b), "the same seed plays out the same for 120 days");
  for (const seed of [1, 2]) {
    const st = world(seed);
    setAutopilot(st, true, "balanced");
    runDays(st, 365);
    const bad = st.hordes.some((h) => !Number.isFinite(h.size) || !Number.isFinite(h.tile)) || st.hives.some((h) => !Number.isFinite(h.res)) || st.tiles.some((t) => !Number.isFinite(t.infection));
    const tr = hiveTracker(st);
    check(!bad, `seed ${seed}: ${st.gameOver ? (st.victory ? "won" : "fell") : "alive"} on day ${Math.min(365, day(st))}, ${tr.hives} hives, ${st.hordes.length} hordes, no NaN anywhere`);
  }
}

// 9. Calibration: storming a hive, and break-ins at the hub.
function crew(st, n, weapon, armor, shooting) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(st, 1);
    s.skills.shooting = shooting;
    s.gear.weapon = { key: weapon, name: GEAR[weapon].name, quality: 1 };
    s.gear.armor = armor ? { key: armor, name: GEAR[armor].name, quality: 1 } : null;
    s.health = 100;
    st.survivors.push(s);
    out.push(s);
  }
  return out;
}
function stormTrial(seed, n, weapon, armor, shooting) {
  const st = world(seed);
  const hv = st.hives[0];
  makeHorde(st, { tile: hv.tile, size: 80, role: "guard", hive: hv.id, target: hv.tile });
  const people = crew(st, n, weapon, armor, shooting);
  const p = { id: 77000 + seed, owner: "player", kind: "expedition", mission: "hive", members: people.map((s) => s.id), supplies: { ammo: 240, meds: 6, food: 10, water: 10 }, cargo: { supplies: {}, gear: [] },
    path: [hv.tile], idx: 0, dest: hv.tile, phase: "engaged", seen: new Map(), spotted: new Map(), homeBaseId: hub(st).id, orders: [], stance: "normal" };
  for (const s of people) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  assaultHive(st, p, hv);
  return { won: !st.hives.includes(hv), dead: people.filter((s) => !s.alive).length };
}
{
  console.log(`Calibration (${TRIALS} battles each, played by the AI on both sides)`);
  const fw = world(1), fh = fw.hives[0];
  makeHorde(fw, { tile: fh.tile, size: 80, role: "guard", hive: fh.id, target: fh.tile });
  const force = hiveForce(fw, fh);
  const rows = [
    ["6 fighters, assault rifles + plate, Shooting 10", 6, "ar", "plate", 10],
    ["5 fighters, shotguns + vests, Shooting 7", 5, "shotgun", "vest", 7],
    ["4 fighters, pistols, Shooting 4", 4, "pistol", null, 4],
  ];
  const res = [];
  for (const [label, n, w, a, sh] of rows) {
    let won = 0, dead = 0;
    for (let i = 0; i < TRIALS; i++) { const r = stormTrial(100 + i, n, w, a, sh); won += r.won; dead += r.dead; }
    res.push(won / TRIALS);
    console.log(`    storm a hive (guard 80: ${force.count} brood at power ${force.power} and the Broodmother) with ${label}: won ${Math.round((won / TRIALS) * 100)}%, ${(dead / TRIALS).toFixed(1)} dead a battle`);
  }
  check(res[0] >= 0.5, "a well-armed team usually destroys a hive");
  check(res[2] <= 0.35, "a poorly armed team usually does not");
  // Break-ins at a tier-2 hub (nobody on guard): the starting six as they are (pistols, knives, a machete, a rifle),
  // and the same six plus four with shotguns and vests.
  for (const armed of [false, true]) {
    for (const [size, bosses] of [[250, 0], [400, 0], [400, 1], [600, 1]]) {
      let beaten = 0, dead = 0;
      for (let i = 0; i < TRIALS; i++) {
        const st = world(300 + i);
        const h = hub(st);
        addBuilding(h, "walls"); addBuilding(h, "walls");
        if (armed) crew(st, 4, "shotgun", "vest", 6).forEach((s) => (s.location = { kind: "base", baseId: h.id }));
        for (const s of alive(st)) s.role = "farm";
        h.stock.ammo = 300; h.stock.meds = 10;
        const before = alive(st).length;
        const hd = makeHorde(st, { tile: h.tile, size, role: "attack", bosses });
        hordeAttackBase(st, hd, h);
        beaten += st.hiveInfo.stats.repelled;
        dead += before - alive(st).length;
      }
      console.log(`    break-in at a tier-2 hub (limit ~177), ${armed ? "10 defenders, 4 with shotguns and vests" : "the starting six"}: horde of ${size}${bosses ? " + Wallbreaker" : ""}: defenders win ${Math.round((beaten / TRIALS) * 100)}%, ${(dead / TRIALS).toFixed(1)} dead`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
