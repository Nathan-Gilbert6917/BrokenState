// Hives and hordes (src/sim/hives.js, hordes.js, defences.js): resource income by cluster size, horde costs and
// sizes, 5–6 hives with no hordes and 5 resources each at the start, hordes moving at most 2 tiles a day, merging
// and splitting (parts of at least 10), new build sites on a curve under a cap by the map size, the 30-score / 1,000-dead rule for a new
// hive (at most 40 a day going in), the Wallbreaker for 40 and 90 days between a hive's Wallbreakers, hordes from
// the border, wall hold limits by tier, a held horde falling back and leaving the base be, a break-in turning into a battle,
// infection fading after a hive dies, the win condition, determinism, and 365-day runs without NaN. The hive tech
// tree (hivetech.js): growths placed within 2 tiles, their costs, build times, income, the special dead they unlock
// and the den Wallbreakers need, tiers by day and age, the hive's choices (young: income; attacked: a brood chamber;
// later: its spawners; its guard first, saving for what it cannot afford), burning a growth (fires, Molotovs, a
// fight with its guard), decay at a destroyed hive, the horde mix (merging, splitting, battle counts, the walls'
// weight, crawlers slipping past, border hordes), determinism and save/load; the special dead in battle (stats, a
// hidden crawler, acid through cover, a brute smashing a barricade, a screamer calling the dead, the same battle
// twice). Then the two battles calibrated: the core of a hive at the end of its crawl (hivecrawl.js: the Hivemind, the
// Broodmother and the brood; well-armed vs poorly armed team) and break-ins at the
// hub by horde size.
// Usage: node tools/hivetest.js [trials=24]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, day, makeSurvivor, hub, alive } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import {
  ensureHives, hiveIncome, hivesDaily, hiveTracker, destroyHive, deliverToSite, hiveForce, assaultHive, zombieToughness, hiveDanger, newHiveCap, siteDue,
} from "../src/sim/hives.js";
import { HIVE } from "../src/sim/hiveconst.js";
import { HORDE_SIZES, hordeScore, makeHorde, splitHorde, mergeHordes, hordesHour, hordesDaily, SPLIT_MIN, HORDE_MAX_SIZE } from "../src/sim/hordes.js";
import { holdLimit, holdCheck, hordeAttackBase, spikeKill, breakInForce, DEFENCE } from "../src/sim/defences.js";
import { addBuilding } from "../src/sim/buildings.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import {
  growthTiles, startGrowth, isGrowing, hiveMods, growthsDaily, growthIncome, hiveMix, hiveTier, growthWish, growthStep, markThreat, growthAt,
  growthArrive, canRaiseBoss, borderMix, growthCounts, ensureGrowths, growthForce, guardMin,
} from "../src/sim/hivetech.js";
import { TECH, GROWTHS, ZTYPES } from "../src/sim/hiveconst.js";
import { battleTypes, mixWeight, typeStrength, zombieTurn, mixText, typeList } from "../src/sim/zombietypes.js";
import { createBattle, canSee, shotOdds, CELL, registerCombatHandler, autoPlayerTurn, runEnemyPhase, closeCombat, active } from "../src/sim/combat.js";
import { crawlerSlip } from "../src/sim/defences.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { clusterSize } from "../src/sim/hives.js";
import { coreForce } from "../src/sim/hivecrawl.js";

const TRIALS = Number(process.argv[2] || 24);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const world = (seed = 42) => { const st = createWorld({ seed, factionCount: 8 }); st.started = true; return st; };
const feed = (st) => { const h = hub(st); if (!h) return; const n = alive(st).length; setFood(h, Math.max(food(h) || 0, n * 6)); h.stock.water = Math.max(h.stock.water || 0, n * 6); };
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
  // Wallbreaker: not before BOSS_DAY; at 40 resources after, and only from a hive that has grown a Wallbreaker den
  // (hivetech.js). No growths start in these checks (growDay far ahead), so the resources go where they are tested.
  const s3 = world(12);
  s3.hour = (HIVE.BOSS_DAY + 5) * 24;
  for (const h of s3.hives) { h.res = 0; h.growDay = 1e9; }
  const b = s3.hives[0], nb = s3.hives[1];
  nb.res = 40 + 30;
  hivesDaily(s3);
  check(!s3.hordes.some((h) => h.bosses) && s3.hiveInfo.stats.bosses === 0, `a hive without a Wallbreaker den raises none, resources or not (${s3.hiveInfo.stats.bosses} made)`);
  for (const h of [...s3.hordes]) s3.hordes.splice(s3.hordes.indexOf(h), 1);
  nb.res = 0;
  const den = startGrowth(s3, b, "den");
  den.ready = s3.hour;
  b.res = 40 + 30;
  hivesDaily(s3);
  check(s3.hiveInfo.stats.bosses >= 1, `a hive with a grown den and 40+ spare resources after day ${HIVE.BOSS_DAY} makes a Wallbreaker (${s3.hiveInfo.stats.bosses} made)`);
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

// 4. Build sites: a curve (slow in the first year, faster later) under a cap of new hives per three years by the map's
// size (HIVE.NEW_CAP: 5–8 on Large and Huge, fewer on Normal, never under 2); 30 score to start, 1,000 dead to finish
// at most 40 a day.
{
  console.log("New hives");
  // Only the hives and hordes run (no colony to fall and stop the clock) for three years on each size.
  const grow = (seed, size, days = HIVE.NEW_SPAN) => {
    const st = createWorld({ seed, factionCount: 8, size }); st.started = true;
    const picks = [], built = [], seen = new Set();
    let b0 = 0;
    while (day(st) <= days) {
      st.hour++;
      hordesHour(st);
      if (st.hour % 24 !== 0) continue;
      hordesDaily(st);
      for (const s of st.hiveSites) if (!seen.has(s.id)) { seen.add(s.id); picks.push(day(st)); }
      if (st.hiveInfo.stats.built > b0) { built.push(day(st)); b0 = st.hiveInfo.stats.built; }
    }
    return { st, picks, built, cap: newHiveCap(st) };
  };
  const caps = { normal: [], large: [], huge: [] };
  for (const size of Object.keys(caps)) for (const seed of [1, 2, 3]) caps[size].push(grow(seed, size));
  for (const [size, runs] of Object.entries(caps)) {
    const [lo, hi] = HIVE.NEW_CAP;
    const capLo = size === "normal" ? HIVE.NEW_MIN : lo, capHi = size === "normal" ? hi - 1 : hi;
    check(runs.every((r) => r.cap >= capLo && r.cap <= capHi), `${size}: the cap on new hives in ${HIVE.NEW_SPAN} days is ${capLo}–${capHi} by the dice (${runs.map((r) => r.cap).join(", ")})`);
    check(runs.every((r) => r.built.length <= r.cap && r.picks.length <= r.cap && r.built.length >= Math.min(2, r.cap - 1)),
      `${size}: within the cap over three years (built ${runs.map((r) => `${r.built.length} of ${r.cap}`).join(", ")}; sites on days ${runs.map((r) => r.picks.join("/")).join("; ")})`);
    check(runs.every((r) => r.picks[0] >= 250), `${size}: slow at first: the first site after day 250 (${runs.map((r) => r.picks[0]).join(", ")})`);
    const faster = runs.filter((r) => r.picks.length >= 3);
    check(faster.length && faster.every((r) => r.picks[1] - r.picks[0] > r.picks[r.picks.length - 1] - r.picks[r.picks.length - 2]), `${size}: then faster: the gap between sites shrinks (${faster.map((r) => r.picks.slice(1).map((d, i) => d - r.picks[i]).join("→")).join("; ")})`);
  }
  const st = caps.normal[0].st;
  check(st.hiveInfo.stats.built >= 1 && st.hiveInfo.stats.grown === st.hiveInfo.stats.built, `hives left alone build new hives (${st.hiveInfo.stats.built} built by day ${day(st)}, ${st.hives.length} standing)`);
  // The due days: in order, the n-th site of a span NEW_SPAN × (n / cap) ^ SITE_CURVE days into it (± the jitter on the gaps), the next span's after.
  const due = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => siteDue(st, n)), cap = newHiveCap(st);
  check(due.every((d, i) => i === 0 || d > due[i - 1]) && Math.abs(due[cap - 1] - HIVE.NEW_SPAN) <= HIVE.NEW_SPAN * HIVE.SITE_JITTER && due[cap] > HIVE.NEW_SPAN,
    `the ${cap} sites of the first span fall on ramp days ${due.slice(0, cap).join(", ")}; the next span's first on ${due[cap]}`);
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
  // A cook fire: the hub starts bare (barestart), and days of "No hot food" (eating.js EAT.cold) drove seed 8's whole
  // holdout to walk out by day 17, which ended the run (and the border hordes with it); this test is about the hordes.
  addBuilding(hub(st), "cookhouse");
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
  // A cook fire, as above: without hot food (eating.js EAT.cold) the holdout walks out before the 65 days are up, the
  // run ends and the infection stops fading with it; this test is about the infection.
  addBuilding(hub(st), "cookhouse");
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
  // The win rule itself, on a holdout still standing (65 days in, the one above may have fallen to a horde: the rule is
  // not about that, and the holdout's fate turns on every other system's dice): a fresh world of the same seed, a week on.
  const sv = world(10);
  runDays(sv, 7);
  check(!sv.victory && !sv.gameOver && alive(sv).length > 0, "with hives left the game goes on");
  for (const h of [...sv.hives]) destroyHive(sv, h, "in the test");
  for (const s of [...sv.hiveSites]) s.started = null;
  sv.erasOff = true; // the eras' clocks (year 6, the outbreak beyond the border, a season clear) are tools/eratest.js's; this checks the rule itself
  runDays(sv, 1);
  check(sv.victory && sv.gameOver, "destroying every hive wins the game");
  check(sv.log.some((l) => /^Every hive is destroyed/.test(l.text)), "the victory is in the log");
}

// 8. Determinism and long runs.
{
  console.log("Determinism and a year");
  const sig = (st) => `${st.hour}|${st.hives.map((h) => `${h.tile}:${h.res}`).join(",")}|${st.hordes.map((h) => `${h.tile}:${h.size}:${h.bosses}:${JSON.stringify(h.mix)}`).join(",")}|${alive(st).length}|${(st.hiveGrowths || []).map((g) => `${g.tile}:${g.kind}:${g.ready}`).join(",")}`;
  // Each world made when the one before has played (world.js localId counts ids from a world's own start; two worlds
  // made back to back and then played one after the other interleave their ids differently, and the dice that hash a
  // party's or a caravan's id would roll differently: that is the test, not the game).
  const a = world(21); runDays(a, 120);
  const b = world(21); runDays(b, 120);
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

// 10. The hive tech tree (hivetech.js): growths placed within reach of the hive, their costs, build times and what
// they give, the special dead they unlock, the hive's choices by age and threat, burning them, decay, the horde mix,
// determinism and save/load.
const teamAt = (st, tile, people, extra = {}) => {
  const p = { id: 88000 + st.parties.length, owner: "player", kind: "expedition", mission: "growth", members: people.map((s) => s.id), supplies: { ammo: 240, meds: 6, food: 10, water: 10, ...(extra.supplies || {}) },
    cargo: { supplies: {}, gear: extra.gear || [] }, path: [tile], idx: 0, dest: tile, phase: "engaged", seen: new Map(), spotted: new Map(), homeBaseId: hub(st).id, orders: [], stance: "normal" };
  for (const s of people) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  return p;
};
const answer = (st, re) => { const c = st.cards.pop(); const ch = c && c.choices.find((x) => re.test(x.label)); return ch ? ch.resolve(st) : `no choice ${re}`; };
{
  console.log("The hive tech tree: growths");
  const st = world(31);
  const g = st.grid;
  const hv = st.hives[0];
  hv.growDay = 1e9; // nothing started by the hive itself in these checks
  const tiles = growthTiles(st, hv);
  const bad = tiles.filter((id) => { const t = st.tiles[id]; return g.distance(id, hv.tile) > TECH.RANGE || id === hv.tile || t.terrain === "water" || t.loc || t.hive || st.bases.some((b) => b.tile === id) || st.factions.some((f) => f.bases.includes(id)); });
  check(tiles.length > 0 && !bad.length, `growths go on free land within ${TECH.RANGE} tiles of their hive, never on water, a site, a base or the hive (${tiles.length} spots, ${bad.length} bad)`);
  hv.res = 60;
  const pit = startGrowth(st, hv, "pit");
  check(!!pit && hv.res === 60 - GROWTHS.pit.cost && g.distance(pit.tile, hv.tile) <= TECH.RANGE, `a biomass pit costs ${GROWTHS.pit.cost} (60 → ${hv.res}) and stands ${pit ? g.distance(pit.tile, hv.tile) : "?"} tiles from the hive`);
  check(!growthTiles(st, hv).includes(pit.tile) && startGrowth(st, hv, "brood", pit.tile) === null, "a tile with a growth takes no other");
  const base = hiveIncome(clusterSize(st, hv));
  st.hour += GROWTHS.pit.days * 24 - 1;
  const still = isGrowing(st, pit) && growthIncome(st, hv, base) === base;
  st.hour += 1;
  growthsDaily(st);
  check(still && !isGrowing(st, pit) && pit.done, `it grows for ${GROWTHS.pit.days} days and gives nothing until then`);
  check(growthIncome(st, hv, base) === base + GROWTHS.pit.income, `grown, a pit adds ${GROWTHS.pit.income} a day (${base} → ${growthIncome(st, hv, base)})`);
  hv.res = 80;
  const fg = startGrowth(st, hv, "feeding"); fg.ready = st.hour;
  check(growthIncome(st, hv, base) === Math.round((base + 1) * GROWTHS.feeding.incomeMult * 10) / 10, `feeding grounds: income ×${GROWTHS.feeding.incomeMult} (${growthIncome(st, hv, base)})`);
  const g0 = guardMin(st, hv);
  const br = startGrowth(st, hv, "brood"); br.ready = st.hour;
  check(guardMin(st, hv) === g0 + GROWTHS.brood.guard, `a brood chamber: the guard kept up to ${guardMin(st, hv)} (was ${g0})`);
  // Unlocks.
  check(hiveMix(st, hv).mix === null, "with no warren, pit, sac, spire or burrow its hordes are all ordinary dead");
  hv.res = 80;
  const wr = startGrowth(st, hv, "warren");
  check(hiveMix(st, hv).mix === null, "a runner warren still growing breeds nothing yet");
  wr.ready = st.hour;
  // Each new horde brings the kinds a hive breeds at its odds (hivetech.js mixOdds): over a few hordes they come.
  let m = null;
  const h0 = st.hour;
  for (let i = 0; i < 20 && !(m && m.runner); i++, st.hour++) m = hiveMix(st, hv, "large").mix;
  st.hour = h0;
  check(!!m && m.runner > 0 && m.runner <= TECH.MIX_MAX, `a grown runner warren: its hordes carry runners (${m ? Math.round(m.runner * 100) : 0}%)`);
  for (const h of [...st.hordes]) if (h.hive === hv.id) st.hordes.splice(st.hordes.indexOf(h), 1);
  for (const h of st.hives) if (h !== hv) h.res = -999;
  hv.res = 30;
  hivesDaily(st);
  const gd = st.hordes.find((h) => h.hive === hv.id && h.role === "guard");
  check(!!gd && !!gd.mix && gd.mix.runner > 0, `the guard it buys carries them (${gd ? mixText(gd.mix, gd.size) : "none"})`);
  check(!canRaiseBoss(st, hv), "no den: no Wallbreakers");
  hv.res = 80;
  const dn = startGrowth(st, hv, "den"); dn.ready = st.hour;
  check(canRaiseBoss(st, hv), "a grown Wallbreaker den: Wallbreakers");
  for (let i = 0; i < 30; i++) { const k = ["pit", "brutepit", "sac", "spire", "burrow", "vat"][i % 6]; const x = startGrowth(st, hv, k); if (x) x.ready = st.hour; hv.res = 80; }
  const mine = ensureGrowths(st).filter((x) => x.hive === hv.id);
  check(mine.every((x) => g.distance(x.tile, hv.tile) <= TECH.RANGE) && new Set(mine.map((x) => x.tile)).size === mine.length && !growthTiles(st, hv).length,
    `started over and over, growths fill the free tiles around the hive and no more (${mine.length})`);
  // Decay: the hive is destroyed; its growths wither and rot away.
  const before = ensureGrowths(st).filter((x) => x.hive === hv.id).length;
  destroyHive(st, hv);
  const withered = ensureGrowths(st).filter((x) => x.hive === hv.id && x.withered != null).length;
  check(before > 0 && withered === before && hiveMods(st, hv).unlocks.length === 0, `destroying the hive withers its ${before} growths (no effect left)`);
  st.hour += (TECH.DECAY_DAYS * 24) - 24; growthsDaily(st);
  const left1 = ensureGrowths(st).filter((x) => x.hive === hv.id).length;
  st.hour += 24; growthsDaily(st);
  check(left1 === before && !ensureGrowths(st).some((x) => x.hive === hv.id), `withered growths rot away after ${TECH.DECAY_DAYS} days`);
}
{
  console.log("The hive tech tree: tiers and the hive's choices");
  const st = world(32);
  const hv = st.hives[0];
  hv.growDay = null;
  const tierAt = (d) => { st.hour = d * 24; return hiveTier(st, hv); };
  const late = TECH.TIER_DAY.map((d, i) => tierAt(Math.ceil(d * (1 + TECH.JITTER)) + 1));
  const early = TECH.TIER_DAY.slice(1).map((d, i) => tierAt(d - 1));
  check(late.every((t, i) => t >= i) && early.every((t, i) => t <= i), `an old hive opens tier t between day TIER_DAY[t] and +${Math.round(TECH.JITTER * 100)}% (tiers by then: ${late.join(", ")}; just before: ${early.join(", ")})`);
  st.hour = 3200 * 24;
  hv.born = st.hour;
  const young = hiveTier(st, hv);
  st.hour += (TECH.TIER_AGE[1] + 1) * 24;
  check(young === 0 && hiveTier(st, hv) >= 1, `a newly risen hive starts at tier 0 even late (${young}), and climbs as it ages (${hiveTier(st, hv)} at ${TECH.TIER_AGE[1] + 1} days)`);
  // Choices: a young hive grows income; attacked, a brood chamber; later tiers its spawners; tier 3 the den or the screamer / crawler growths.
  const s2 = world(33);
  const h2 = s2.hives[0];
  s2.hour = 5 * 24;
  check(growthWish(s2, h2, false) === "pit", `a young hive on day 5 wants a biomass pit first (${growthWish(s2, h2, false)})`);
  markThreat(s2, h2);
  check(growthWish(s2, h2, false) === "brood", `attacked lately, it wants a brood chamber (${growthWish(s2, h2, false)})`);
  // Later: with income covered, an old hive picks the special dead its tier allows.
  h2.threatDay = null;
  const fill = (kinds) => { for (const k of kinds) { h2.res = 80; const x = startGrowth(s2, h2, k); if (x) x.ready = s2.hour; } h2.growDay = null; };
  fill(["pit", "pit", "brood"]);
  s2.hour = 700 * 24; h2.born = 0;
  const w2 = growthWish(s2, h2, false);
  const MID = ["warren", "brutepit", "sac", "feeding", "ossuary", "scaffold", "wormpit", "cistern", "hollow"]; // middead.js: the mid game's growths
  check(MID.includes(w2) && GROWTHS[w2].tier <= hiveTier(s2, h2), `on day 700 (tier ${hiveTier(s2, h2)}) it grows toward the special dead (${w2})`);
  fill(["warren", "brutepit", "sac", "feeding"]);
  check(growthWish(s2, h2, false) === null || GROWTHS[growthWish(s2, h2, false)].tier <= hiveTier(s2, h2), `nothing above its tier (${growthWish(s2, h2, false)})`);
  s2.hour = 1600 * 24;
  const w3 = growthWish(s2, h2, false);
  check(["spire", "burrow", "den", "fold"].includes(w3), `on day 1600 (tier ${hiveTier(s2, h2)}) screamers, crawlers, the Wallbreaker den or the Shepherd's fold (${w3})`);
  // Its guard first, then the growth (saved for when it is short).
  for (const h of [...s2.hordes]) if (h.hive === h2.id) s2.hordes.splice(s2.hordes.indexOf(h), 1);
  h2.res = 100; h2.growDay = null;
  check(growthStep(s2, h2) === null, "with no guard at home, no growth is started");
  makeHorde(s2, { tile: h2.tile, size: 200, role: "guard", hive: h2.id, target: h2.tile });
  h2.res = 5;
  growthStep(s2, h2);
  const saving = h2.growSave && h2.growSave.kind;
  check(!!saving && GROWTHS[saving].tier <= hiveTier(s2, h2) && GROWTHS[saving].cost > 5 && !GROWTHS[saving].income, `short of resources it saves for the ${h2.growSave ? GROWTHS[h2.growSave.kind].name.toLowerCase() : "?"} (no new roaming hordes meanwhile)`);
  h2.res = 80;
  const started = growthStep(s2, h2);
  check(!!started && started.kind === saving && !h2.growSave, `then grows it once it has the ${GROWTHS[saving].cost}`);
  // Left alone a few years, hives evolve: tier 1 growths in year one, spawners of tier 2 by year two.
  const s3 = world(34);
  runDays(s3, 300);
  const c1 = growthCounts(s3);
  check(c1.total > s3.hives.length && (c1.kinds.pit || 0) > 0, `300 days: the hives have grown ${c1.total} growths (${JSON.stringify(c1.kinds)})`);
}
{
  console.log("The hive tech tree: burning a growth, the horde mix");
  // Two fires burn a fresh growth down; Molotovs in one go; its guard can be fought.
  const st = world(35);
  const hv = st.hives[0];
  hv.growDay = 1e9; hv.res = 80;
  const wr = startGrowth(st, hv, "warren"); wr.ready = st.hour;
  makeHorde(st, { tile: hv.tile, size: 80, role: "guard", hive: hv.id, target: hv.tile, mix: { runner: 0.2 } });
  const people = crew(st, 4, "shotgun", "vest", 8);
  const p = teamAt(st, wr.tile, people, { supplies: { fuel: 8 } });
  growthArrive(st, p);
  const r1 = answer(st, /^Burn it/);
  check(growthAt(st, wr.tile) === wr && wr.hp === TECH.HP - TECH.FIRE_DMG, `one fire (${TECH.FIRE_FUEL} fuel) burns ${TECH.FIRE_DMG} of its flesh: ${wr.hp} left ("${r1.slice(0, 60)}...")`);
  growthsDaily(st);
  check(wr.hp === TECH.HP - TECH.FIRE_DMG + TECH.REGROW, `it grows back ${TECH.REGROW} a day (${wr.hp})`);
  growthArrive(st, p);
  answer(st, /^Burn it/);
  check(!growthAt(st, wr.tile) && hiveMix(st, hv).mix === null && hv.threatDay != null, "a second fire destroys it: the hive breeds no more runners, and it knows it was attacked");
  hv.res = 80;
  const sc = startGrowth(st, hv, "sac"); sc.ready = st.hour;
  const p2 = teamAt(st, sc.tile, crew(st, 3, "pistol", null, 5), { gear: [{ key: "molotov", name: "Molotov" }, { key: "molotov", name: "Molotov" }] });
  growthArrive(st, p2);
  answer(st, /^Firebomb/);
  check(!growthAt(st, sc.tile) && p2.cargo.gear.length === 0, `${TECH.BOMBS} Molotovs burn a growth down at once`);
  hv.res = 80;
  const bp = startGrowth(st, hv, "brutepit"); bp.ready = st.hour;
  const f = growthForce(st, bp);
  check(f.count >= TECH.GUARD_BASE && f.count <= TECH.GUARD_MAX && f.types && f.types.brute >= 1, `its guard: ${f.count} of the dead at power ${f.power}, with ${mixText(f.types ? Object.fromEntries(Object.entries(f.types).map(([k, n]) => [k, n / f.count])) : null, f.count)}`);
  let won = 0;
  for (let i = 0; i < 4; i++) {
    const s = world(40 + i); const h = s.hives[0]; h.growDay = 1e9; h.res = 80;
    const x = startGrowth(s, h, "brutepit"); x.ready = s.hour;
    makeHorde(s, { tile: h.tile, size: 80, role: "guard", hive: h.id, target: h.tile });
    const q = teamAt(s, x.tile, crew(s, 5, "ar", "plate", 9));
    growthArrive(s, q);
    answer(s, /^Fight its guard/);
    if (!growthAt(s, x.tile)) won++;
  }
  check(won >= 3, `a well-armed team that beats its guard tears the growth down (${won} of 4)`);
  // The horde mix: merged by numbers, kept through a split, into a battle's unit counts and the walls' weight.
  const s4 = world(36);
  const a = makeHorde(s4, { tile: 500, size: 100, role: "roam", mix: { runner: 0.2 } });
  const b = makeHorde(s4, { tile: 500, size: 100, role: "roam", mix: { brute: 0.1 } });
  mergeHordes(s4);
  check(s4.hordes.includes(a) && !s4.hordes.includes(b) && Math.abs(a.mix.runner - 0.1) < 0.001 && Math.abs(a.mix.brute - 0.05) < 0.001, `merging 100 (20% runners) and 100 (10% brutes): ${JSON.stringify(a.mix)}`);
  const part = splitHorde(s4, a, 50);
  check(part && part.mix && part.mix.runner === a.mix.runner, "a split keeps the mix");
  const bt = battleTypes({ runner: 0.15, brute: 0.08, spitter: 0.08 }, 20);
  check(bt.runner === 3 && bt.brute === 2 && bt.spitter === 2 && typeList(bt, 20).filter(Boolean).length === 7, `a battle with 20 of them: ${JSON.stringify(bt)}`);
  check(mixWeight({ brute: 0.1 }, "wall") > 1.1 && mixWeight({ runner: 0.2 }, "wall") < 1 && typeStrength({ count: 10, types: { brute: 2 } }) > 1.2, `brutes press the walls harder (${mixWeight({ brute: 0.1 }, "wall").toFixed(2)}), runners less (${mixWeight({ runner: 0.2 }, "wall").toFixed(2)}); 2 brutes in 10 fight like ${typeStrength({ count: 10, types: { brute: 2 } }).toFixed(2)}×`);
  const hb = hub(s4);
  addBuilding(hb, "walls"); addBuilding(hb, "walls");
  const lim = holdLimit(s4, hb);
  const plain = holdCheck(s4, hb, Math.round(lim * 0.9)).holds, brutish = holdCheck(s4, hb, Math.round(lim * 0.9), 0, { brute: 0.15 }).holds;
  check(plain && !brutish, `a horde of ${Math.round(lim * 0.9)} is held by walls that stop ${lim}, with 15% brutes it breaks in`);
  const ch = makeHorde(s4, { tile: hb.tile, size: 200, role: "attack", mix: { crawler: 0.2 } });
  const open = crawlerSlip(s4, hb, ch, false);
  addBuilding(hb, "watchtower");
  const towered = crawlerSlip(s4, hb, ch, false), lit = crawlerSlip(s4, hb, ch, true);
  check(open > towered && towered > lit && lit === 0, `crawlers slipping past held walls: ${open}, with a watchtower ${towered}, and lit floodlights too ${lit}`);
  // Border hordes bring the era's special dead late in the game.
  s4.hour = (TECH.BORDER_DAY - 2) * 24;
  const early = borderMix(s4);
  s4.hour = (TECH.TIER_DAY[3] + 10) * 24;
  const lateMix = borderMix(s4);
  check(early === null && lateMix && lateMix.runner > 0 && lateMix.crawler > 0, `border hordes: none before day ${TECH.BORDER_DAY}, the era's kinds after (${mixText(lateMix)})`);
}
{
  console.log("The hive tech tree: determinism and save/load");
  // The second world is built after the first has run: ids come from one process-wide counter (world.js newId), and
  // a world's dice may read them (a party's, a group's), so two worlds built at once would not draw alike.
  const a = world(37);
  runDays(a, 200);
  const b = world(37);
  runDays(b, 200);
  const sg = (st) => JSON.stringify([st.hiveGrowths, st.hordes.map((h) => [h.tile, h.size, h.mix, h.elite]), st.hives.map((h) => [h.res, h.growSave, h.threatDay])]);
  check(sg(a) === sg(b) && (a.hiveGrowths || []).length > 0, `the same seed grows the same growths in 200 days (${(a.hiveGrowths || []).length})`);
  a.cards.length = 0; // nobody answers cards in this run; a save cannot hold them, so both worlds go on without them
  const saved = JSON.parse(JSON.stringify(serializeState(a)));
  const c = deserializeState(saved);
  check(sg(c) === sg(a), "save and load keep the growths, the hordes' special dead and the hives' plans");
  runDays(a, 60); runDays(c, 60);
  check(sg(c) === sg(a), "and the loaded world plays on the same for 60 days");
}
{
  console.log("The special dead in battle");
  let last = null;
  registerCombatHandler("ztest", (st, r) => { last = r; });
  const setupFor = (st, people, types, extra = {}) => ({ tile: st.tiles.find((t) => t.terrain === "plains" && !t.loc).id, baseId: hub(st).id, fighterIds: people.map((s) => s.id),
    enemy: { kind: "zombies", count: 12, power: 2, types, ...extra }, ambush: null, canRetreat: false, handler: "ztest", context: {} });
  const st = world(50);
  const people = crew(st, 3, "pistol", null, 8);
  for (const s of people) s.location = { kind: "base", baseId: hub(st).id };
  const b = createBattle(st, setupFor(st, people, { runner: 2, brute: 1, spitter: 1, screamer: 1, crawler: 1 }, { elite: true }));
  st.combat = b;
  const z = (k) => b.units.find((u) => u.ztype === k);
  const plain = b.units.find((u) => u.kind === "zombie" && !u.ztype);
  check(["runner", "brute", "spitter", "screamer", "crawler"].every((k) => z(k)) && b.units.filter((u) => u.ztype).length === 6 && z("brute").elite, "the battle has the kinds asked for (2 runners, a brute, a spitter, a screamer, a crawler; elite)");
  check(z("runner").mob > plain.mob && z("brute").maxHp > plain.maxHp * 2 && z("brute").armor < 1 && z("spitter").weapon === "acid" && z("crawler").low, `stats: runner ${z("runner").mob} tiles an action (plain ${plain.mob}), brute ${z("brute").maxHp} hp (plain ${plain.maxHp}) and takes ×${z("brute").armor}, spitter spits acid, crawler low`);
  // On open ground: the crawler hidden at 6 tiles, seen at 2; the spitter's acid against someone in full cover.
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0);
  const me = b.units.find((u) => u.side === "player");
  for (const u of b.units) if (u !== me) { u.x = 17; u.y = u.id % b.h; }
  me.x = 3; me.y = 6;
  const cr = z("crawler");
  cr.x = 9; cr.y = 6;
  const hidden = !canSee(b, me, cr);
  cr.x = 5;
  check(hidden && canSee(b, me, cr), "a crawler is unseen 6 tiles off, seen at 2");
  const sp = z("spitter");
  sp.x = 7; sp.y = 6;
  b.cells[6 * b.w + 4].k = "wall"; b.losCache.fill(0); // full cover between them, east of your man
  b.cells[5 * b.w + 5].k = "open";
  const acid = shotOdds(b, sp, me, sp.x, sp.y), gun = shotOdds(b, { ...sp, weapon: "pistol" }, me, sp.x, sp.y);
  check(acid.cover === 2 && acid.chance > gun.chance, `a spitter's acid against full cover: ${acid.chance}% (a gun from the same spot ${gun.chance}%): cover counts a step less`);
  closeCombat(st, { take: false });
  st.combat = null;
  // Brutes smash the barricade line that keeps them from your people.
  const st2 = world(51);
  const pp = crew(st2, 2, "pistol", null, 6);
  for (const s of pp) s.location = { kind: "base", baseId: hub(st2).id };
  const b2 = createBattle(st2, setupFor(st2, pp, { brute: 1 }));
  st2.combat = b2;
  for (let y = 0; y < b2.h; y++) for (let x = 0; x < b2.w; x++) b2.cells[y * b2.w + x].k = x === 9 ? "barricade" : "open";
  const brute = b2.units.find((u) => u.ztype === "brute");
  for (const u of b2.units) if (u.side === "enemy" && u !== brute) u.dead = true;
  for (const u of b2.units) if (u.side === "player") { u.x = 2; u.y = u.id % b2.h; }
  brute.x = 10; brute.y = 6; brute.aware = true;
  let smashed = false;
  for (let i = 0; i < 12 && !smashed; i++) { brute.ap = 2; zombieTurn(b2, brute); smashed = [5, 6, 7].some((y) => b2.cells[y * b2.w + 9].k === "open"); }
  check(smashed, "a brute walled off from your people smashes through the barricade");
  st2.combat = null;
  // Screamers call more of the dead in; whole battles stay deterministic.
  const run = (seed, types) => {
    const s = world(seed);
    const pl = crew(s, 3, "pistol", null, 8);
    for (const x of pl) x.location = { kind: "base", baseId: hub(s).id };
    hub(s).stock.ammo = 200;
    s.combat = createBattle(s, setupFor(s, pl, types));
    const bb = s.combat;
    for (let i = 0; i < 60 && !bb.over; i++) { autoPlayerTurn(s); runEnemyPhase(s); }
    const out = { over: bb.over, turns: bb.turn, called: bb.screamed || 0, units: bb.units.length, log: bb.log.map((l) => l.text).join("|") };
    if (bb.over) closeCombat(s); else s.combat = null;
    return out;
  };
  const r1 = run(52, { screamer: 1, spitter: 2, crawler: 2 }), r2 = run(52, { screamer: 1, spitter: 2, crawler: 2 });
  check(r1.called > 0 && r1.units > 15, `a screamer called ${r1.called} more of the dead into the battle (${r1.units} units)`);
  check(r1.over && r1.log === r2.log, `the same battle plays out the same (${r1.turns} turns)`);
  check(/spits acid/.test(r1.log), "spitters spit acid in it");
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
  const force = coreForce(fw, fh); // the core room at the end of the crawl (hivecrawl.js): assaultHive is its fight
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
    console.log(`    the core of a hive (guard 80: ${force.count} brood at power ${force.power}, the Broodmother and the Hivemind, ${force.hp} hp) with ${label}: won ${Math.round((won / TRIALS) * 100)}%, ${(dead / TRIALS).toFixed(1)} dead a battle`);
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
