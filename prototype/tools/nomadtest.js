// Nomad bands (src/sim/nomads.js; grouppois.js, poicont.js underneath).
// - Determinism: the same seed gives the same bands, camps, stocks and tallies; another seed differs.
// - Counts: about half the size's default AI group count (worldsize.js defGroups × NOMADS.SHARE), filled up and never
//   passed, on all four sizes.
// - Tiers: T1 from the start, T2 from year 2, T3 from year 4 (eras.js yearOf; hardcore counts from the normal start),
//   sizes within the tier's range, never past its cap; the kits exist (combat.js KITS, arsenal.js KIT_OF/starterKit),
//   preppers' armour AC 3 and up.
// - Survival: a band without food or water loses people and breaks up (starved); the respawn brings the count back.
// - Recruiting: neutral wanderers (state.wanderers) and refugees from outside (visitors.js), never hostile ones, only
//   with food in store, never past the cap.
// - Surveys: a camp near tiles it does not know surveys them first (grouppois.js knowledge grows by its survey only).
// - Raids: a POI raid lowers the pool, marks the container ledger (cont.last by the band), takes what your people
//   left in a container into the band's wares and stock.
// - Not a group: never in state.factions, no land, no claims, refused by the coalition and by pacts; the
//   coalition's land share is the same with or without them.
// - Your teams: a meeting card by tier (looters stop a weaker team, scatter before a stronger one; survivalists and
//   preppers talk and trade through trade.js), a fight by the numbers headless, a known camp can be attacked
//   (parties.js mission "nomads"); the autopilot answers their cards.
// - Save and load: the bands, their generator and knowledge round-trip and the world goes on the same.
// - The long run (skipped with --quick): YEARS (6) game years (eras.js YEAR_DAYS, 112 days) on all four sizes, each in
//   a process of its own, simtest.js's crude auto-player on; no exceptions, nomads alive over time printed, the count
//   near the target, no cap passed, nobody grows into a base-holding group.
// Usage: node tools/nomadtest.js [seed] [--quick] [--years N]
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHILD = process.argv[2] === "--child";
const QUICK = process.argv.includes("--quick");
const yi = process.argv.indexOf("--years");
const YEARS = yi > 0 ? Number(process.argv[yi + 1]) : 6;
const args = process.argv.slice(CHILD ? 3 : 2).filter((a, i, l) => !a.startsWith("--") && l[i - 1] !== "--years");
const seed = Number(args[0] || 42);

const { createWorld, tickHour, day, alive, hub, atBase } = await import("../src/sim/world.js");
const N = await import("../src/sim/nomads.js");
const { WORLD_SIZES } = await import("../src/sim/worldsize.js");
const { YEAR_DAYS, yearStartDay } = await import("../src/sim/eras.js");

// ---------- the long run, one size in a child process ----------
if (CHILD) {
  const size = args[1];
  const { launchExpedition, estimateTrip, startReturn } = await import("../src/sim/parties.js");
  const { searchHour, extract } = await import("../src/sim/scavenge.js");
  const { executeTrade, endTrade } = await import("../src/sim/trade.js");
  const st = createWorld({ seed, factionCount: WORLD_SIZES[size].defGroups, size });
  st.started = true;
  const days = YEARS * YEAR_DAYS;
  const out = { size, target: N.nomadTarget(st), samples: [], maxPop: { 1: 0, 2: 0, 3: 0 }, inFactions: 0, owners: 0, err: null };
  const t0 = Date.now();
  let was = day(st), cards = 0;
  // simtest.js's auto-player: cards by the first enabled choice, searches of 3 hours, trades taken, teams home, a
  // scavenging team every 6 days.
  const autoplay = () => {
    while (st.cards.length) {
      const c = st.cards.shift();
      const ch = c.choices.find((x) => x.label === "Return home") || c.choices.find((x) => !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled));
      if (ch) ch.resolve(st);
      cards++;
    }
    if (st.engagement) {
      if (!st.engagement.approach) st.engagement.approach = "normal";
      if (st.engagement.hours < 3 && st.engagement.heat < 50) { searchHour(st); tickHour(st); } else extract(st);
    }
    if (st.trade) { executeTrade(st); endTrade(st); }
    for (const p of st.parties) if (p.owner === "player" && p.phase === "waiting") startReturn(st, p);
    const h = hub(st);
    if (h && st.hour % (24 * 6) === 12 && !st.parties.some((p) => p.owner === "player")) {
      const people = alive(st).filter((s) => s.location.kind === "base" && s.location.baseId === h.id).slice(0, 2);
      const targets = st.tiles.filter((t) => t.loc && st.grid.distance(t.id, h.tile) <= 8 && t.id !== h.tile);
      if (people.length && targets.length) {
        const dest = targets[(st.hour / 24) % targets.length | 0].id;
        const est = estimateTrip(st, { memberIds: people.map((s) => s.id), dest, vehicle: false, stance: "normal" });
        if (est) launchExpedition(st, { memberIds: people.map((s) => s.id), dest, mission: "scavenge", stance: "normal", supplies: { food: Math.min(h.stock.food || 0, est.food + 2), water: Math.min(h.stock.water || 0, est.water + 2), ammo: Math.min(h.stock.ammo || 0, 20) } });
      }
    }
  };
  try {
    while (day(st) <= days) {
      if (st.gameOver) { if (out.fell == null) out.fell = day(st); st.gameOver = false; }
      autoplay();
      tickHour(st);
      for (const b of N.nomadsOf(st)) out.maxPop[b.tier] = Math.max(out.maxPop[b.tier], b.pop);
      if (day(st) !== was) {
        was = day(st);
        if (was % 28 === 0) out.samples.push({ day: was, ...N.nomadCounts(st), tiers: N.nomadTiers(st).length });
      }
    }
  } catch (e) { out.err = `${e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : e}`; }
  out.inFactions = st.factions.filter((f) => f.nomad || N.nomadsOf(st).some((b) => b.id === f.id)).length;
  out.owners = st.tiles.filter((t) => typeof t.owner === "number" && N.nomadsOf(st).some((b) => b.id === t.owner)).length;
  out.stats = N.nomads(st).stats;
  out.cards = cards;
  out.ms = Date.now() - t0;
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ---------- the checks ----------
const { serializeState, deserializeState } = await import("../src/sim/save.js");
const { launchExpedition, orderOptions, partyTile, partyMembers } = await import("../src/sim/parties.js");
const { poisOf, poiPool, isSitePoi, inKnownZone, poiLedger } = await import("../src/sim/pois.js");
const { contKey } = await import("../src/sim/poicont.js");
const { groupKnownPois, groupSurveyedDay, groupKnowsPoi, groupPoiRecord } = await import("../src/sim/grouppois.js");
const { tradeContext, tradeVerdict, executeTrade, endTrade, proposePact } = await import("../src/sim/trade.js");
const { controlledLand, inviteProblem, allianceMembers } = await import("../src/sim/alliance.js");
const { KITS } = await import("../src/sim/combat.js");
const { KIT_OF, starterKit } = await import("../src/sim/arsenal.js");
const { ARMOUR } = await import("../src/sim/armour.js");
const { GEAR } = await import("../src/sim/data.js");
const { newNeutralGroup, wanderers } = await import("../src/sim/wanderers.js");
const V = await import("../src/sim/visitors.js");
const { foodIn } = await import("../src/sim/foods.js");
const { newItem } = await import("../src/sim/inventory.js");
const { Rng } = await import("../src/sim/rng.js");
const { setAutopilot } = await import("../src/sim/autopilot.js");
const { attitude } = await import("../src/sim/factions.js");

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = (opts = {}) => { const st = createWorld({ seed, factionCount: 7, ...opts }); st.started = true; st.cards.length = 0; return st; };
// The days pass for the nomads alone (their daily step, the clock moved on): cheap, for the lifecycle checks.
const days = (st, n) => { for (let i = 0; i < n; i++) { st.hour += 24; N.nomadsDaily(st); } };
const T = N.NOMADS.TIERS;
const summary = (st) => JSON.stringify({ b: N.nomadsOf(st).map((b) => [b.serial, b.tier, b.name, b.pop, b.tile, b.camp, b.phase, Math.round(foodIn(b.stock) * 100), Math.round((b.stock.water || 0) * 100), b.wares.map((w) => w.key)]), s: N.nomads(st).stats, rng: N.nomads(st).rng.state });
const freeTile = (st, t) => t.terrain !== "water" && !t.hive && !t.loc && t.owner == null && !st.bases.some((x) => x.tile === t.id) && !st.factions.some((f) => f.bases.includes(t.id)) && !st.hordes.some((h) => st.grid.distance(h.tile, t.id) <= 2);
function team(st, tile, n = 2) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, n).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: ids, dest: tile, mission: "move", stance: "normal", supplies: { food: 12, water: 12, ammo: 30 } });
  if (res.error) throw new Error(`team: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.dest = tile; p.orders = [];
  return p;
}

section("Determinism");
{
  const run = (s) => { const st = W(); if (s != null) { st.seed = s; st.nomads = null; } for (let i = 0; i < 40 * 24; i++) { st.cards.length = 0; tickHour(st); } return summary(st); };
  const a = run(), b = run();
  check(a === b && N.nomadsOf(W()).length === 0, "the same seed: the same bands, camps, stocks, wares and tallies after 40 days");
  const st2 = W({ seed: seed + 1 });
  for (let i = 0; i < 40 * 24; i++) { st2.cards.length = 0; tickHour(st2); }
  check(summary(st2) !== a, "another seed: other bands");
  check(JSON.parse(a).b.length > 0, `bands on the map by day 40 (${JSON.parse(a).b.length})`);
}

section("Counts by world size");
for (const size of Object.keys(WORLD_SIZES)) {
  const st = W({ size, factionCount: WORLD_SIZES[size].defGroups });
  const target = N.nomadTarget(st);
  check(target === Math.max(1, Math.round(WORLD_SIZES[size].defGroups * N.NOMADS.SHARE)), `${size}: the target is half the size's default group count (${target})`);
  let most = 0;
  for (let i = 0; i < 60; i++) { days(st, 1); most = Math.max(most, N.nomadsOf(st).length); }
  check(most <= target && N.nomadsOf(st).length >= Math.min(target, 1), `${size}: filled up to the target and never past it (${N.nomadsOf(st).length} now, at most ${most}, target ${target})`);
}

section("Tiers: era unlock, sizes and caps, kits");
{
  const st = W();
  check(JSON.stringify(N.nomadTiers(st)) === "[1]", "year 1: looters only");
  st.hour = (yearStartDay(2) - 1) * 24 + 1;
  check(JSON.stringify(N.nomadTiers(st)) === "[1,2]", "year 2: survivalists too");
  st.hour = (yearStartDay(4) - 1) * 24 + 1;
  check(JSON.stringify(N.nomadTiers(st)) === "[1,2,3]", "year 4: preppers too");
  st.hour = (yearStartDay(3) - 1) * 24 + 1;
  const made = [];
  for (let i = 0; i < 40; i++) { const b = N.spawnNomads(st); if (b) made.push(b); }
  check(made.length > 30 && made.every((b) => b.tier <= 2) && made.some((b) => b.tier === 2), `year 3: spawned tiers 1–2 only (${made.map((b) => b.tier).join("")})`);
  check(made.every((b) => b.pop >= T[b.tier].size[0] && b.pop <= T[b.tier].size[1]), "every band starts within its tier's size range");
  const hc = W({ mode: "hardcore" });
  check(JSON.stringify(N.nomadTiers(hc)) === "[1]", "hardcore, early: looters only");
  for (const tier of [1, 2, 3]) {
    const K = KITS[T[tier].kit];
    check(!!K && [...K.weapons, ...K.strong].every((k) => GEAR[k] && GEAR[k].slot === "weapon") && K.armor.every((k) => k == null || GEAR[k]), `tier ${tier}: its kit (${T[tier].kit}) is real weapons and armour`);
    check(KIT_OF[`nomad${tier}`] === T[tier].kit && starterKit(seed, "x", `nomad${tier}`, 4).length >= 4, `tier ${tier}: arsenal.js KIT_OF and starterKit deal its kit`);
  }
  check(KITS.looters.armor.every((k) => k == null) && !KITS.looters.weapons.some((k) => ["ar", "carbine", "huntrifle"].includes(k)), "looters: no armour, no rifles");
  check(KITS.preppers.armor.every((k) => k && (ARMOUR[k].ac >= 3 || ARMOUR[k].carrier)), "preppers: armour AC 3 and up (scrap steel, plate carriers with their plates)");
  // The cap: plenty of food and recruits, never past it.
  const b = N.spawnNomads(st, { tier: 1 });
  b.stock.f_beans = 500;
  for (let i = 0; i < 400; i++) { N.recruit(st, b); b.met = {}; }
  check(b.pop <= T[1].size[1], `a fed band keeps recruiting only up to its cap (${b.pop} of ${T[1].size[1]})`);
}

section("Survival: hunger, the dead, respawn");
{
  const st = W();
  days(st, 12);
  const target = N.nomadTarget(st);
  const b = N.nomadsOf(st)[0];
  const id = b.id;
  let n = 0;
  while (N.nomadById(st, id) && n < 80) { for (const k of Object.keys(b.stock)) b.stock[k] = 0; st.hour += 24; const f = T[b.tier].forage, w = T[b.tier].water; T[b.tier].forage = 0; T[b.tier].water = 0; N.bandDay(st, b); T[b.tier].forage = f; T[b.tier].water = w; n++; }
  check(!N.nomadById(st, id) && N.nomads(st).stats.starved >= 1, `a band with no food or water starves and breaks up (${n} days)`);
  for (const x of [...N.nomadsOf(st)]) { x.pop = 1; N.bandDay(st, x); }
  const gone = N.nomadsOf(st).length, sp0 = N.nomads(st).stats.spawned;
  let most = gone;
  for (let i = 0; i < 80; i++) { days(st, 1); most = Math.max(most, N.nomadsOf(st).length); }
  check(gone < target && most === target && N.nomads(st).stats.spawned >= sp0 + target - gone, `the respawn brings the count back (${gone} → ${most}, target ${target}; ${N.nomads(st).stats.spawned - sp0} new bands in 80 days)`);
}

section("Recruiting: neutral wanderers and refugees only, with food, up to the cap");
{
  const st = W();
  const tile = st.tiles.find((t) => freeTile(st, t) && st.grid.distance(t.id, hub(st).tile) > 14).id;
  const b = N.spawnNomads(st, { tier: 2, tile, pop: 4 });
  const ws = wanderers(st);
  const rng = new Rng(5);
  const hostile = { wid: ++ws.seq, kind: "hostile", people: [{ name: "Bad One" }], tile, since: 1, mood: "wary", met: 0 };
  ws.groups.push(hostile);
  const g = newNeutralGroup(st, tile, rng);
  g.people = g.people.slice(0, 1);
  for (const k of Object.keys(b.stock)) if (k.startsWith("f_")) b.stock[k] = 0;
  for (let i = 0; i < 60; i++) N.recruit(st, b);
  check(b.pop === 4 && ws.groups.includes(g), "no food in store: nobody taken in");
  b.stock.f_beans = 400;
  for (let i = 0; i < 200 && ws.groups.includes(g); i++) N.recruit(st, b);
  check(!ws.groups.includes(g) && ws.groups.includes(hostile) && N.nomads(st).stats.recruits.wanderers >= 1, "a neutral wanderer joins; the hostile ones never do");
  const v = V.spawnVisitor(st, "explorers", { tile, sub: "refugees", hostile: false });
  const vh = V.spawnVisitor(st, "explorers", { tile, sub: "refugees", hostile: true });
  const s0 = vh ? vh.size : 0;
  for (let i = 0; i < 300; i++) { if (v) { v.tile = tile; v.phase = "travel"; } if (vh) { vh.tile = tile; vh.phase = "travel"; } N.recruit(st, b); }
  check(!v || N.nomads(st).stats.recruits.refugees >= 1, `refugees from outside join (${N.nomads(st).stats.recruits.refugees})`);
  check(!vh || vh.size === s0, "robbers posing as refugees never join");
  check(b.pop <= T[2].size[1], `never past the cap (${b.pop} of ${T[2].size[1]})`);
}

section("Surveys and raids through the groups' picker and the container ledger");
{
  const st = W();
  // A camp with an unknown-zone tile next to it whose POIs are hidden, and nothing known round it.
  let camp = null, target = null;
  for (const t of st.tiles) {
    if (!freeTile(st, t) || inKnownZone(st, t) || st.grid.distance(t.id, hub(st).tile) < 10) continue;
    const near = st.grid.within(t.id, 3).map((id) => st.tiles[id]);
    if (near.some((x) => poisOf(x).length && inKnownZone(st, x))) continue;
    const tgt = near.find((x) => x.id !== t.id && poisOf(x).length >= 2 && !x.loc && freeTile(st, x));
    if (tgt) { camp = t; target = tgt; break; }
  }
  check(!!camp, "found an unknown-zone camp with a tile of hidden places beside it");
  if (camp) {
    const b = N.spawnNomads(st, { tier: 2, tile: camp.id, pop: 5 });
    b.scouting = 40; // a sure survey
    check(groupKnownPois(st, b, target).length === 0, "before: the band knows none of the hidden places there");
    let n = 0;
    while (groupSurveyedDay(st, b, target) == null && n < 30) { N.campWork(st, b); n++; }
    check(groupSurveyedDay(st, b, target) != null && groupKnownPois(st, b, target).length > 0, `a survey first (after ${n} camp days), then it knows them (${groupKnownPois(st, b, target).length})`);
    // A raid: the pool falls and the ledger names the band.
    const i = groupKnownPois(st, b, target).find((x) => poiPool(target, x) > 0.05);
    const pool0 = poiPool(target, i);
    // Something your people left in a container they opened there.
    const L = poiLedger(target, i);
    L.maps = L.maps || {};
    const key = contKey("street", 1);
    L.mine[key] = { contents: { sup: { scrap: 3 }, gear: [newItem("crowbar", 1)] }, hidden: null, quick: false, lock: null, searched: true, partial: false };
    for (const j of groupKnownPois(st, b, target)) if (j !== i) poisOf(target)[j].pool = 0; // only that one worth a trip
    const rec = groupPoiRecord(st, b, true);
    for (const id of st.grid.within(camp.id, 3)) { if (id === target.id) continue; rec.s[id] = day(st); const t = st.tiles[id]; poisOf(t).forEach((x, j) => { if (isSitePoi(t, j)) t.loot = 0; else x.pool = 0; }); }
    const st0 = N.nomads(st).stats.raids;
    poisOf(target)[i].pool = Math.min(poisOf(target)[i].pool, 0.02 + 1e-9) + 0.04; // little left: whatever was left there goes too
    const before = poiPool(target, i);
    for (let k = 0; k < 6 && N.nomads(st).stats.raids === st0; k++) N.campWork(st, b);
    check(N.nomads(st).stats.raids > st0 && poiPool(target, i) < before, `a raid lowers the pool (${before.toFixed(3)} → ${poiPool(target, i).toFixed(3)}, ${pool0.toFixed(3)} at first)`);
    const cont = poisOf(target)[i].cont;
    check(!!cont && cont.last && String(cont.last.by) === String(b.id), "the container ledger names the band (cont.last)");
    check(b.wares.some((w) => w.key === "crowbar") && !cont.mine[key].contents.gear.length && N.nomads(st).stats.leftTaken >= 1, "what your people left in a container went into the band's wares and stock");
  }
}

section("Not a group: no factions, no land, no coalition, no pacts");
{
  const st = W();
  const land0 = controlledLand(st).pct;
  days(st, 30);
  for (const b of N.nomadsOf(st)) { b.goodwill = 90; b.known = true; }
  const b = N.nomadsOf(st)[0];
  check(N.nomadsOf(st).length > 0 && st.factions.every((f) => !f.nomad && !N.nomadsOf(st).some((x) => x.id === f.id)), "never in state.factions");
  check(st.tiles.every((t) => !N.nomadsOf(st).some((x) => x.id === t.owner)) && N.nomadsOf(st).every((x) => !x.bases.length), "no land and no bases");
  check(controlledLand(st).pct === land0, "the coalition's land share is the same with them on the map");
  check(/join nothing/.test(inviteProblem(st, b)) && !allianceMembers(st).some((m) => m.id === b.id), "the coalition will not take them");
  check(/sign nothing/.test(proposePact(st, b, "trade")) && !b.pact, "no pacts");
}

section("Meeting your teams, trade, fights, camps");
{
  const st = W();
  const tile = st.tiles.find((t) => freeTile(st, t) && st.grid.distance(t.id, hub(st).tile) >= 3 && st.grid.distance(t.id, hub(st).tile) <= 6).id;
  // Looters against a team they can take: they stop it.
  const lt = N.spawnNomads(st, { tier: 1, tile, pop: 6 });
  lt.phase = "travel"; lt.path = [tile]; lt.idx = 0;
  const p1 = team(st, tile, 1);
  for (const s of partyMembers(st, p1)) s.health = 30;
  st.cards.length = 0;
  N.nomadsHour(st);
  const c1 = st.cards.find((c) => c.nomadId === lt.id);
  check(!!c1 && /Looters on the road/.test(c1.title) && c1.choices.some((c) => /Pay them/.test(c.label)), `looters stop a weak team (${c1 ? c1.title : "no card"})`);
  // A fight by the numbers (headless).
  const killed0 = N.nomads(st).stats.fights;
  if (c1) c1.choices[0].resolve(st);
  check(N.nomads(st).stats.fights === killed0 + 1 && st.cards.some((c) => /The fight with/.test(c.title)), "the fight is resolved by the numbers and reported");
  // Survivalists: talk and trade.
  const st2 = W();
  const sv = N.spawnNomads(st2, { tier: 2, tile, pop: 5 });
  sv.phase = "camp"; sv.camp = tile; sv.goodwill = 10; sv.stock.meds = 20;
  const p2 = team(st2, tile, 2);
  st2.cards.length = 0;
  N.nomadsHour(st2);
  const c2 = st2.cards.find((c) => c.nomadId === sv.id);
  check(!!c2 && /Survivalists on the road/.test(c2.title) && c2.choices.some((c) => /Trade/.test(c.label)) && c2.choices.some((c) => /Attack/.test(c.label)), "survivalists meet a team: talk, trade, share, attack, move on");
  const tr = c2 && c2.choices.find((c) => /Trade/.test(c.label));
  if (tr) tr.resolve(st2);
  const ctx = tradeContext(st2);
  check(!!ctx && ctx.kind === "visit" && ctx.f === sv && ctx.nomad === sv, "the trade window opens on the band (trade.js: a visit from what the team carries)");
  if (ctx) {
    st2.trade.ask = { meds: 2 };
    st2.trade.offer = { ammo: 0 };
    const food = Object.keys(p2.supplies).find((k) => k.startsWith("f_") && p2.supplies[k] > 0);
    st2.trade.offer = food ? { [food]: Math.floor(p2.supplies[food]) } : {};
    const v = tradeVerdict(st2);
    const res = v.ok ? executeTrade(st2) : v.reason;
    check(v.ok ? /Traded with/.test(res) : /Not enough|cannot carry|only have/.test(res), `a deal goes through trade.js (${res})`);
    endTrade(st2);
    check(!st2.trade && p2.phase === "waiting", "leaving the window: the team waits for orders");
  }
  // A camp you spotted can be attacked.
  st2.live.add(tile);
  N.nomadsHour(st2);
  check(st2.markers.some((m) => m.type === "nomadcamp" && m.tile === tile), "a camp in view is marked on the map, with when it was seen");
  st2.cards.length = 0;
  check(orderOptions(st2, p2, tile).some((o) => o.mission === "nomads"), "the team can be ordered to attack the camp");
  p2.mission = "nomads"; p2.dest = tile;
  N.nomadCampArrive(st2, p2);
  const c3 = st2.cards.find((c) => /The camp of/.test(c.title));
  check(!!c3 && c3.choices.some((c) => /Attack the camp/.test(c.label)), "at the camp: attack it, talk, or leave");
  // Preppers: neutral and defensive, they trade.
  const st3 = W();
  const pr = N.spawnNomads(st3, { tier: 3, tile, pop: 7 });
  check(pr.tier === 3 && N.nomadStrength(st3, pr) > N.nomadStrength(st3, N.spawnNomads(st3, { tier: 1, tile, pop: 7 })) && pr.vehicle, "preppers are stronger than looters of the same size and have a vehicle");
  check(attitude(pr) === "Neutral" && attitude(sv) !== "Hostile", `preppers start neutral (goodwill ${pr.goodwill}); survivalists not hostile`);
  // The autopilot answers their cards and never crashes on them.
  const st4 = W();
  setAutopilot(st4, true, "balanced");
  const h = hub(st4);
  for (const t of [1, 1, 1]) { const tt = st4.grid.within(h.tile, 4).map((id) => st4.tiles[id]).find((x) => freeTile(st4, x) && !N.nomadsOf(st4).some((b) => b.tile === x.id)); if (tt) N.spawnNomads(st4, { tier: t, tile: tt.id }); }
  let err = null;
  try { for (let i = 0; i < 20 * 24; i++) tickHour(st4); } catch (e) { err = e; }
  check(!err, `20 days on the Balanced autopilot with bands round the hub: no crash${err ? ` (${err.message})` : ""}`);
}

section("Save and load");
{
  const st = W();
  for (let i = 0; i < 30 * 24; i++) { st.cards.length = 0; tickHour(st); }
  const save = serializeState(st);
  const back = deserializeState(JSON.parse(JSON.stringify(save)));
  check(summary(back) === summary(st), "the bands, their stock, wares, tallies and generator come back as they were");
  const a = N.nomadsOf(st)[0];
  check(!a || JSON.stringify(groupKnownPois(back, N.nomadById(back, a.id), a.tile)) === JSON.stringify(groupKnownPois(st, a, a.tile)), "what a band knows of the places comes back");
  for (let i = 0; i < 10 * 24; i++) { st.cards.length = 0; back.cards.length = 0; tickHour(st); tickHour(back); }
  check(summary(back) === summary(st), "and the world goes on the same 10 days later");
}

// ---------- the long run ----------
if (!QUICK) {
  section(`The long run: ${YEARS} game years (${YEARS * YEAR_DAYS} days) on every size, simtest.js's auto-player`);
  const me = fileURLToPath(import.meta.url);
  const run = (size) => new Promise((res, rej) => execFile(process.execPath, [me, "--child", String(seed), size, "--years", String(YEARS)], { maxBuffer: 1 << 26 }, (e, o) => (e ? rej(e) : res(JSON.parse(o)))));
  const results = await Promise.all(Object.keys(WORLD_SIZES).map(run));
  for (const r of results) {
    const counts = r.samples.map((s) => s.n);
    const mean = counts.reduce((a, v) => a + v, 0) / Math.max(1, counts.length);
    console.log(`  ${r.size}: target ${r.target}, ${Math.round(r.ms / 1000)} s, holdout ${r.fell ? `fell on day ${r.fell}` : "stood"}; bands every 28 days: ${r.samples.map((s) => `${s.n}${s.n ? `(${s[1]}/${s[2]}/${s[3]})` : ""}`).join(" ")}`);
    console.log(`    people every 112 days: ${r.samples.filter((s) => s.day % 112 === 0).map((s) => `d${s.day} ${s.people}`).join(", ")}; largest by tier ${r.maxPop[1]}/${r.maxPop[2]}/${r.maxPop[3]}`);
    const S = r.stats;
    console.log(`    spawned ${S.spawned} (T1 ${S.tiers[1]}, T2 ${S.tiers[2]}, T3 ${S.tiers[3]}); gone: starved ${S.starved}, beaten ${S.beaten || 0}, road ${S.road || 0}, mishap ${S.mishap || 0}, horde ${S.horde || 0}; recruits ${S.recruited} (${JSON.stringify(S.recruits)}); surveys ${S.surveys} (found ${S.found}), raids ${S.raids} (took ${S.took.toFixed(1)}), your left items taken ${S.leftTaken}; met ${S.met}, fights ${S.fights}, trades ${S.trades}`);
    check(!r.err, `${r.size}: no exceptions${r.err ? ` (${r.err})` : ""}`);
    const late = r.samples.filter((s) => s.day >= 56).map((s) => s.n);
    const lateMean = late.reduce((a, v) => a + v, 0) / Math.max(1, late.length);
    check(lateMean >= r.target * 0.6 && Math.max(...counts) <= r.target, `${r.size}: the count stays near the target (mean ${lateMean.toFixed(1)} after day 56, at most ${Math.max(...counts)}, target ${r.target}; overall ${mean.toFixed(1)})`);
    check([1, 2, 3].every((t) => r.maxPop[t] <= T[t].size[1]), `${r.size}: no tier cap passed (${r.maxPop[1]}/${r.maxPop[2]}/${r.maxPop[3]} of ${T[1].size[1]}/${T[2].size[1]}/${T[3].size[1]})`);
    check(r.inFactions === 0 && r.owners === 0, `${r.size}: nobody grew into a base-holding group`);
    check(r.samples.some((s) => s.tiers === 3) ? S.tiers[3] > 0 || S.tiers[2] > 0 : true, `${r.size}: the later tiers came once unlocked`);
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
