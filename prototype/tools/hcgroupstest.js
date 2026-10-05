// Hardcore mode, the other groups (sim/hardcore-groups.js): bands that found their hubs, the military's stand and
// fall, no raiders before state.hardcore.raidersFrom, save/load mid-founding, a normal world untouched.
// Usage: node tools/hcgroupstest.js [--quick]
import { createWorld, tickHour, day, supplyValue, hub } from "../src/sim/world.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { bandsOf, hcMilitary, hardcoreGroupsHour, HC_GROUPS, HC_MILITARY } from "../src/sim/hardcore-groups.js";
import { hiveName } from "../src/sim/hives.js";
import { makeHorde } from "../src/sim/hordes.js";
import { worldScale } from "../src/sim/worldsize.js";

const quick = process.argv.includes("--quick");
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) fail++; };
const t0 = Date.now();

// Keeps your side alive and fed (this test is about the other groups, not your start): health and food topped up.
function keepAlive(s) {
  for (const x of s.survivors) if (x.alive) x.health = Math.max(x.health, 80);
  for (const b of s.bases) { b.stock.food = Math.max(b.stock.food || 0, 60); b.stock.water = Math.max(b.stock.water || 0, 60); }
  for (const p of s.parties) if (p.owner === "player" && p.supplies) { p.supplies.food = Math.max(p.supplies.food || 0, 10); p.supplies.water = Math.max(p.supplies.water || 0, 10); }
}
// Runs whole days; watch(s) after each day. Cards are answered by the autopilot when it is on, else dropped.
function runDays(s, n, watch = null) {
  for (let d = 0; d < n && !s.gameOver; d++) {
    for (let i = 0; i < 24 && !s.gameOver; i++) {
      keepAlive(s);
      if (!s.autopilot) s.cards.length = 0;
      tickHour(s);
    }
    if (watch) watch(s);
  }
}
const playerValue = (s) => {
  let v = 0;
  for (const b of s.bases) v += supplyValue(b.stock);
  for (const p of s.parties) if (p.owner === "player") v += supplyValue(p.supplies || {}) + supplyValue((p.cargo && p.cargo.supplies) || {});
  return v;
};
const raiderSigns = (s) => ({
  groups: s.factions.filter((f) => f.alive && f.type === "raider").length,
  outsiders: (s.visitors || []).filter((v) => v.kind === "raiders").length + ((s.visitorInfo && s.visitorInfo.stats.raiders) || 0),
  gangs: (s.stats.newGangs || 0) + (s.stats.bandsSettled || 0),
});

// ---------- a normal world is untouched ----------
console.log("A normal world");
{
  const n = createWorld({ seed: 4242, factionCount: 7 });
  check(!n.hardcore && bandsOf(n).length === 0, "no hardcore state, no bands");
  check(n.factions.length === 7 && n.factions.every((f) => f.bases.length === 1), "7 groups, each with its base");
  check(n.factions.some((f) => f.type === "raider"), "a raider gang from the start, as before");
  runDays(n, 3);
  check(day(n) >= 4 && bandsOf(n).length === 0, "runs as before");
}

// ---------- day 1 ----------
console.log("Day 1 in hardcore worlds");
const SEEDS = quick ? [4242, 7, 99] : [4242, 7, 99, 1234, 31337, 5, 2024, 77];
const worlds = SEEDS.map((seed) => ({ seed, s: createWorld({ seed, factionCount: 7, mode: "hardcore" }) }));
for (const { seed, s } of worlds) {
  const mil = s.factions.find((f) => f.type === "military");
  const based = s.factions.filter((f) => f.bases.length);
  check(based.length === 1 && based[0] === mil, `seed ${seed}: only the military has a base (${s.factions.length} group in the list, ${bandsOf(s).length} bands)`);
  check(bandsOf(s).length === 6, `seed ${seed}: six bands on the road`);
  check(!s.militaryIds.length || s.militaryIds.includes(mil.bases[0]), `seed ${seed}: the military holds a military site (${s.tiles[mil.bases[0]].loc?.type})`);
  check(mil.pop >= HC_MILITARY.POP[0] && mil.stock.ammo >= mil.pop * 20, `seed ${seed}: the military is ${mil.pop} strong with ${mil.stock.ammo} ammo`);
  check(bandsOf(s).every((b) => b.type !== "raider"), `seed ${seed}: no raiders among the bands`);
  const pv = playerValue(s);
  const pPeople = s.survivors.filter((x) => x.alive).length;
  check(bandsOf(s).every((b) => supplyValue(b.stock) > pv * 2 && b.pop > pPeople * 2), `seed ${seed}: every band carries more than you (${Math.round(pv)} supply value, ${pPeople} people; bands ${bandsOf(s).map((b) => Math.round(supplyValue(b.stock))).join("/")})`);
  const pt = hub(s) ? hub(s).tile : s.parties.find((p) => p.owner === "player")?.path[0];
  const minD = Math.round(HC_GROUPS.START_MIN * Math.sqrt(worldScale(s))) - 6;
  if (pt != null) check(bandsOf(s).every((b) => s.grid.distance(b.tile, pt) >= minD), `seed ${seed}: bands start a fair distance from you (${bandsOf(s).map((b) => s.grid.distance(b.tile, pt)).join(", ")} tiles)`);
  const off = s.hardcore.eraOffset ?? s.hardcore.groups.eraOffset;
  check(off >= 56 && off <= 112 && s.hardcore.raidersFrom >= Math.floor(0.6 * off) && s.hardcore.raidersFrom <= off, `seed ${seed}: raiders from day ${s.hardcore.raidersFrom} (era offset ${off})`);
}
// Resources by type: the commune carries the most food, traders the most fuel, a fortress or expansionists the most ammo.
{
  const all = worlds.flatMap(({ s }) => bandsOf(s));
  const avg = (type, k) => { const l = all.filter((b) => b.type === type); return l.length ? l.reduce((a, b) => a + b.stock[k], 0) / l.length : null; };
  const kinds = new Set(all.map((b) => b.type));
  check(kinds.size >= 4, `the bands come as ${[...kinds].join(", ")}`);
  if (avg("commune", "food") != null) check(all.filter((b) => b.type !== "commune").every((b) => b.stock.food < avg("commune", "food")), `communes carry the most food (${Math.round(avg("commune", "food"))})`);
  if (avg("traders", "fuel") != null) check(all.filter((b) => b.type !== "traders").every((b) => b.stock.fuel < avg("traders", "fuel")), `traders carry the most fuel (${Math.round(avg("traders", "fuel"))})`);
  const ammoTop = Math.max(avg("fortress", "ammo") || 0, avg("expansionist", "ammo") || 0);
  check(all.filter((b) => b.type === "traders" || b.type === "commune").every((b) => b.stock.ammo < ammoTop), `fortresses and expansionists carry the most ammo (${Math.round(ammoTop)})`);
  if (avg("zealot", "food") != null) check(all.filter((b) => b.type === "zealot").every((b) => b.pop >= 14), "zealots come in numbers");
}

// ---------- meeting a band ----------
console.log("Meeting a band");
{
  const s = createWorld({ seed: 4242, factionCount: 7, mode: "hardcore" });
  const b = bandsOf(s)[0];
  const who = s.survivors.find((x) => x.alive);
  const p = { id: 999999, owner: "player", kind: "recon", path: [b.tile], idx: 0, progress: 0, members: [who.id], supplies: { food: 10, water: 10 }, cargo: { supplies: {}, gear: [] }, phase: "waiting" };
  s.parties.push(p);
  hardcoreGroupsHour(s);
  const card = s.cards.find((c) => c.hcBand === b.id);
  check(!!card && b.known && b.met, `a team beside ${b.name} gets a card ("${card && card.title}")`);
  const gw = b.goodwill;
  const news = card && card.choices.find((c) => c.label === "Trade news");
  const text = news ? news.resolve(s) : "";
  check(b.goodwill > gw && b.destKnown, `trading news: goodwill ${gw} â†’ ${b.goodwill}; ${text}`);
  s.cards.length = 0;
  hardcoreGroupsHour(s);
  check(!s.cards.some((c) => c.hcBand === b.id), "the same team is not stopped twice");
  s.parties.splice(s.parties.indexOf(p), 1);
}

// ---------- founding ----------
console.log("Founding (first 45 days)");
let by30 = 0, total = 0, quietBroken = 0, earlyRaiders = 0, baseless = 0;
const foundDays = [], seenRaids = new Set();
for (const w of worlds) {
  const s = w.s;
  total += bandsOf(s).length;
  const ids = new Set(bandsOf(s).map((b) => b.id));
  runDays(s, 45, (st) => {
    const d = day(st);
    if (d === 31) by30 += st.factions.filter((f) => ids.has(f.id)).length;
    for (const f of st.factions) if (ids.has(f.id) && f.founded === d - 1) foundDays.push(f.founded);
    if (st.factions.some((f) => f.alive && !f.bases.length)) baseless++;
    const r = raiderSigns(st);
    if (d < st.hardcore.raidersFrom && (r.groups || r.outsiders || r.gangs)) earlyRaiders++;
    // Raids launched today (the groups' day runs at midnight, so a new one is from day d).
    const quiet = st.hardcore.groups.quietUntil == null || d < st.hardcore.groups.quietUntil;
    const raids = st.parties.filter((p) => p.kind === "raid" && !seenRaids.has(p.id));
    for (const p of raids) seenRaids.add(p.id);
    if (quiet && raids.length) {
      quietBroken++;
      console.log(`     raid while quiet: day ${d}, ${raids.map((p) => `${st.factions.find((f) => f.id === p.owner)?.type}:${p.warId}:${p.grudge}:${p.target && p.target.kind}`).join(" ")}`);
    }
  });
  w.left45 = bandsOf(s).filter((b) => !b.remnant).length;
}
check(by30 >= total * 0.8, `bands with a hub by day 30: ${by30} of ${total}`);
check(worlds.every((w) => w.left45 === 0), `every band has founded or broken up by day 45 (left: ${worlds.map((w) => w.left45).join(",")})`);
check(baseless === 0, "no living group without a base, any day");
check(earlyRaiders === 0, "no raider groups, outsider raiders or gangs before the raiders' day");
check(quietBroken === 0, "no group raids while the bands are founding");
foundDays.sort((a, b) => a - b);
console.log(`     founding days: ${foundDays.join(" ")}`);

// ---------- save / load mid-founding ----------
console.log("Save and load mid-founding");
{
  const s = createWorld({ seed: 31337, factionCount: 7, mode: "hardcore" });
  runDays(s, 10);
  s.cards.length = 0;
  const saved = JSON.stringify(serializeState(s));
  const fp = (st) => JSON.stringify([st.factions.map((f) => [f.id, f.name, f.type, f.bases, f.pop]), bandsOf(st).map((b) => [b.id, b.tile, b.pop, b.phase, b.goal, Math.round(b.stock.food)]), hcMilitary(st).sorties, hcMilitary(st).killed]);
  runDays(s, 12);
  const a = fp(s);
  const t = deserializeState(JSON.parse(saved));
  check(bandsOf(t).length > 0 && t.hardcore.raidersFrom === s.hardcore.raidersFrom, `the save holds ${bandsOf(t).length} bands on the road and the raiders' day`);
  runDays(t, 12);
  check(fp(t) === a, "the loaded world plays out the same");
}

// ---------- the military ----------
console.log("The military against the hive");
// The outbreak work drives the hordes at the base (state.hardcore.outbreak.mil). Without it in this branch, the test
// does it: a hive near the base sends an attack horde at it every few days, bigger each time.
const MSEEDS = quick ? [4242, 7] : [4242, 7, 99, 1234];
const falls = [];
for (const seed of MSEEDS) {
  const s = createWorld({ seed, factionCount: 7, mode: "hardcore" });
  const mil = s.factions.find((f) => f.type === "military");
  const base = mil.bases[0], g = s.grid;
  const outbreak = !!(s.hardcore.outbreak && s.hardcore.outbreak.mil);
  let hive = s.hives.filter((h) => g.distance(h.tile, base) <= HC_MILITARY.HIVE_RANGE).sort((a, b) => g.distance(a.tile, base) - g.distance(b.tile, base))[0];
  if (!hive) {
    const tile = g.within(base, 7).find((id) => g.distance(id, base) >= 5 && s.tiles[id].terrain !== "water" && !s.tiles[id].loc && !s.tiles[id].hive);
    s.tiles[tile].hive = true;
    hive = { id: (s.hiveSeq = (s.hiveSeq || 0) + 1), tile, res: 5, born: s.hour, income: 0, bossReady: false, bossHorde: null, name: hiveName(s, tile) };
    s.hives.push(hive);
  }
  let fell = null, waves = 0;
  runDays(s, 160, (st) => {
    if (fell == null && hcMilitary(st).fell) fell = hcMilitary(st).fellDay;
    if (!outbreak && fell == null && day(st) % 5 === 0 && st.hives.includes(hive)) {
      waves++;
      makeHorde(st, { tile: hive.tile, size: 40 + waves * 12, role: "attack", hive: hive.id, goal: { tile: base, factionId: mil.id }, target: base });
    }
  });
  const m = hcMilitary(s);
  if (s.gameOver && fell == null) { console.log(`     seed ${seed}: skipped (your side died on day ${day(s)} before the base fell: this test does not play your start)`); continue; }
  falls.push(fell);
  const hi = outbreak ? Math.round(1.1 * s.hardcore.eraOffset) : 160;
  check(fell != null && fell <= hi, `seed ${seed}: overrun on day ${fell}${outbreak ? ` (era offset ${s.hardcore.eraOffset})` : ` after ${waves} test waves`} (${m.sorties} sorties, ${m.culls} culls, ${m.killed} dead cut down, ${m.lost} soldiers lost in sorties; ran to day ${day(s)}${s.gameOver ? ", game over" : ""}${s.hives.includes(hive) ? "" : ", its hive gone"})`);
  check(m.sorties > 0, `seed ${seed}: the Guard fought back`);
  if (fell != null) {
    const t = s.tiles[m.tile];
    check(!mil.alive && !!t.ruin && t.infection >= 0.6, `seed ${seed}: the base is a ruin full of the dead (infection ${t.infection.toFixed(2)})`);
    check(s.log.some((l) => /Last transmission/.test(l.text)), `seed ${seed}: a last radio message`);
    const rem = s.factions.find((f) => f.hcRemnant) || bandsOf(s).find((b) => b.remnant) || s.log.find((l) => /remnant were taken in|remnant/.test(l.text));
    console.log(`     seed ${seed}: remnant: ${rem ? (rem.name || rem.text) : "none (scattered)"}`);
  }
}
check(falls.length >= Math.min(2, MSEEDS.length - 1), `${falls.length} of ${MSEEDS.length} seeds played to the fall`);
check(new Set(falls).size > 1 || falls.length < 2, `the fall comes on different days by the seed (${falls.join(", ")})`);
// Without a hive and its hordes the base holds, and the Guard does not grow (cut off, closed to civilians).
{
  const s = createWorld({ seed: 4242, factionCount: 7, mode: "hardcore" });
  for (const h of s.hives) s.tiles[h.tile].hive = false;
  s.hives.length = 0;
  s.hordes.length = 0;
  s.hiveInfo.nextBorderDay = 9999;
  if (s.hardcore.outbreak) s.hardcore.outbreak.off = true; // a hint for the outbreak work's own hordes, if any
  const mil = s.factions.find((f) => f.type === "military");
  const pop0 = mil.pop;
  runDays(s, 90);
  check(mil.alive && !hcMilitary(s).fell && mil.pop <= pop0 && mil.pop >= pop0 * 0.7, `no hive near: the base holds (soldiers ${pop0} → ${mil.pop})`);
}

// ---------- raiders ----------
console.log("Raiders appear from raidersFrom");
{
  const s = createWorld({ seed: 99, factionCount: 7, mode: "hardcore" });
  s.hardcore.raidersFrom = 50; // brought forward for the test
  let before = null;
  runDays(s, 49, (st) => { const r = raiderSigns(st); if (day(st) < st.hardcore.raidersFrom && (r.groups || r.outsiders || r.gangs)) before = before || { d: day(st), ...r }; });
  check(!before, `none before day 50${before ? ` (day ${before.d}: ${JSON.stringify(before)})` : ""}`);
  runDays(s, 60);
  const r = raiderSigns(s);
  check(r.groups + r.outsiders + r.gangs > 0, `raiders after day 50: ${r.groups} group(s) turned, ${r.outsiders} outsider band(s), ${r.gangs} new gang(s)`);
  check(s.hardcore.groups.raidersOut && s.log.some((l) => /preying on each other/.test(l.text)), "word of the first raiders");
}

// ---------- the autopilot ----------
console.log("The autopilot plays a hardcore start");
{
  const s = createWorld({ seed: 2024, factionCount: 7, mode: "hardcore" });
  s.autopilot = true;
  let err = null;
  try { runDays(s, quick ? 30 : 45); } catch (e) { err = e; }
  check(!err, `no errors${err ? `: ${err.stack.split("\n").slice(0, 3).join(" | ")}` : ""} (day ${day(s)})`);
  check(bandsOf(s).filter((b) => !b.remnant).length === 0 || quick, `the bands founded their hubs (${s.factions.filter((f) => f.hcBand).length} groups)`);
}

console.log(`\n${fail ? `${fail} FAILED` : "all passed"} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fail ? 1 : 0);
