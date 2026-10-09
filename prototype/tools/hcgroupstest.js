// Hardcore mode, the other groups (sim/hardcore-groups.js): bands that found their hubs, the military's arc (its
// strike on the city hive fails, the hive by its base, the fall, the splinter groups; save/load with the strike
// force on the road; destroying the base's hive saves it), no raiders before state.hardcore.raidersFrom, save/load
// mid-founding, a normal world untouched.
// Usage: node tools/hcgroupstest.js [--quick]
import { createWorld, tickHour, day, supplyValue, hub } from "../src/sim/world.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { bandsOf, hcMilitary, hardcoreGroupsHour, HC_GROUPS, HC_MILITARY } from "../src/sim/hardcore-groups.js";
import { destroyHive } from "../src/sim/hives.js";
import { tileLabel } from "../src/sim/parties.js";
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
console.log("The military's arc: the strike on the city hive, the hive by the base, the fall, the splinter groups");
// The strike force goes out on its day with half or more of the soldiers, reaches the city hive, fails with heavy
// losses (the hive stands) and is cut off; the dead mass by the base and build a hive; the base falls on days 20–60;
// what is left becomes groups of its own that found hubs; 1–3 soldiers come to you.
const MSEEDS = quick ? [4242, 7, 42] : [4242, 7, 99, 1234, 42, 2024, 5, 13];
const arcs = [];
for (const seed of MSEEDS) {
  const s = createWorld({ seed, factionCount: 7, mode: "hardcore" });
  const mil = s.factions.find((f) => f.type === "military");
  const g = s.grid, O = s.hardcore.outbreak;
  const pop0 = mil.pop;
  const r = { seed, strikeDay: hcMilitary(s).strikeDay };
  runDays(s, 100, (st) => {
    const m = hcMilitary(st), x = m.strike, d = day(st);
    if (x && r.sent == null) { r.sent = x.left; r.n = x.start; r.garrison = m.garrison; }
    if (x && x.arrived != null && r.arrived == null) { r.arrived = x.arrived; r.reach = g.distance(x.tile, x.hiveTile); }
    if (x && x.failed != null && r.failed == null) { r.failed = x.failed; r.lost = x.lost; r.killed = x.killed; r.hiveStands = st.hives.some((h) => h.id === x.hiveId); r.hold = x.hold; }
    if (x && x.phase === "back" && !m.fell && r.back == null) r.back = d;
    if (O.mil && O.mil.stood != null) r.stood = O.mil.stood;
    if (m.fell && r.fell == null) {
      r.fell = m.fellDay; r.toYou = m.toYou || 0;
      r.splinters = bandsOf(st).filter((b) => m.splinters.includes(b.id)).map((b) => ({ id: b.id, name: b.name, type: b.type, pop: b.pop }));
    }
  });
  const m = hcMilitary(s);
  const tag = `seed ${seed}:`;
  check(r.sent === r.strikeDay && r.sent >= HC_MILITARY.STRIKE_DAY[0] && r.sent <= HC_MILITARY.STRIKE_DAY[1] && r.n / pop0 >= 0.45 && r.n / pop0 <= 0.7,
    `${tag} the strike force left on day ${r.sent} with ${r.n} of ${pop0} soldiers (${Math.round((100 * r.n) / pop0)}%; ${r.garrison} stayed)`);
  check(r.arrived != null && r.arrived - r.sent <= 4 && r.reach <= 1, `${tag} it drove to the city hive and engaged on day ${r.arrived}`);
  check(r.failed != null && r.lost / r.n >= 0.45 && r.hiveStands, `${tag} it failed on day ${r.failed}: ${r.lost} of ${r.n} lost (${Math.round((100 * r.lost) / r.n)}%), about ${r.killed} of the dead cut down, the hive still standing; the rest cut off near ${r.hold != null ? tileLabel(s, r.hold) : "?"}`);
  check(r.stood != null && (r.fell == null || r.stood < r.fell), `${tag} the dead massed by the base (day ${O.mil.gathered}) and their hive stood on day ${r.stood}`);
  check(r.fell != null && r.back == null, `${tag} the base fell on day ${r.fell} (${m.sorties} sorties, ${m.culls} culls, ${m.killed} of the dead cut down); the strike force never got back`);
  if (r.fell == null) { arcs.push(r); continue; }
  const t = s.tiles[m.tile];
  // The ruin keeps its own dead even when a group kills the hive by the base afterwards (hives.js destroyHive
  // fades only what a hive radiated; seed 42: burned on day 60).
  const hiveBy = O.mil && O.mil.tile != null ? (s.hives.some((h) => h.tile === O.mil.tile) ? "; the hive by the base still stands" : "; the hive by the base is gone") : "";
  check(!mil.alive && !!t.ruin && t.infection >= 0.6 && s.log.some((l) => /Last transmission/.test(l.text)), `${tag} the old military is gone: its base a ruin full of the dead (infection ${t.infection.toFixed(2)}${hiveBy}), a last radio message`);
  r.founded = r.splinters.map((b) => s.factions.find((f) => f.id === b.id)).filter(Boolean);
  check(r.splinters.length >= 1 && r.splinters.every((b) => /^Remnant of |Holdouts$/.test(b.name) && (b.type === "military" || b.type === "fortress")),
    `${tag} it split into ${r.splinters.map((b) => `${b.name} (${b.type}, ${b.pop})`).join(" and ")}; ${r.toYou} soldier(s) came to you`);
  check(r.founded.length >= 1 && r.founded.every((f) => f.hcSplinter && f.founded > r.fell), `${tag} by day 100 ${r.founded.map((f) => `${f.name} founded at ${tileLabel(s, f.bases[0] ?? m.tile)} on day ${f.founded}${f.type === "raider" ? " (turned raider)" : ""}${f.alive ? "" : " (since gone)"}`).join("; ") || "none founded"}`);
  arcs.push(r);
}
{
  const fell = arcs.filter((r) => r.fell != null);
  const inWindow = fell.filter((r) => r.fell >= 20 && r.fell <= 60);
  console.log(`     per seed: ${arcs.map((r) => `${r.seed}: strike d${r.sent}, failed d${r.failed}, hive by the base d${r.stood}, fell d${r.fell ?? "-"}, ${r.splinters ? r.splinters.length : 0} splinter(s), ${r.toYou ?? 0} to you`).join(" | ")}`);
  check(inWindow.length >= Math.ceil(arcs.length * 0.75), `the base fell on days 20–60 on ${inWindow.length} of ${arcs.length} seeds (${arcs.map((r) => r.fell ?? "-").join(", ")})`);
  check(new Set(fell.map((r) => r.fell)).size > 1, "the fall comes on different days by the seed");
  check(fell.filter((r) => r.splinters.length === 2).length >= Math.ceil(fell.length / 2), `two splinter groups on ${fell.filter((r) => r.splinters.length === 2).length} of ${fell.length} falls`);
  check(fell.filter((r) => r.toYou >= 1).length >= Math.ceil(fell.length * 0.75), `soldiers came to you as recruits on ${fell.filter((r) => r.toYou >= 1).length} of ${fell.length} falls`);
}
// Save and load mid-arc: the strike force on the road.
{
  const s = createWorld({ seed: 42, factionCount: 7, mode: "hardcore" });
  for (let i = 0; i < 24 * 15 && !(hcMilitary(s).strike && hcMilitary(s).strike.phase === "travel" && hcMilitary(s).strike.idx > 0); i++) { keepAlive(s); s.cards.length = 0; tickHour(s); }
  const x = hcMilitary(s).strike;
  check(!!x && x.phase === "travel", `seed 42: the strike force is on the road on day ${day(s)} (${x && x.idx} of ${x && x.path.length - 1} tiles)`);
  s.cards.length = 0;
  const saved = JSON.stringify(serializeState(s));
  const fp = (st) => JSON.stringify([hcMilitary(st), st.hardcore.outbreak.mil, st.factions.map((f) => [f.id, f.name, f.type, f.alive, f.bases, f.pop]), bandsOf(st).map((b) => [b.id, b.tile, b.pop, b.phase, b.goal])]);
  runDays(s, 45);
  const a = fp(s);
  const t = deserializeState(JSON.parse(saved));
  check(hcMilitary(t).strike && hcMilitary(t).strike.phase === "travel", "the save holds the strike force on the road");
  runDays(t, 45);
  check(fp(t) === a, `the loaded world plays the arc out the same (day ${day(t)}: ${hcMilitary(t).fell ? `the base fell on day ${hcMilitary(t).fellDay}` : "the base holds"})`);
}
// Destroy the hive by the base (you, say) and the base holds; the strike force's survivors come home.
{
  const s = createWorld({ seed: 4242, factionCount: 7, mode: "hardcore" });
  const O = s.hardcore.outbreak, mil = s.factions.find((f) => f.type === "military");
  runDays(s, 60, (st) => {
    const hv = st.hives.find((h) => h.tile === O.mil.tile);
    if (hv) destroyHive(st, hv, "in the test");
  });
  const m = hcMilitary(s);
  check(O.mil.stood != null && O.mil.done != null && mil.alive && !m.fell, `seed 4242: its hive stood on day ${O.mil.stood} and was destroyed: the base holds (${mil.pop} soldiers on day ${day(s)})`);
  check(m.strike && m.strike.phase === "back" && mil.pop >= m.breakPop, `the strike force's ${m.strike && m.strike.pop} survivors made it home (${m.strike && m.strike.phase})`);
}
// Without a hive and its hordes the base holds, and the Guard does not grow (cut off, closed to civilians).
{
  const s = createWorld({ seed: 4242, factionCount: 7, mode: "hardcore" });
  for (const h of s.hives) s.tiles[h.tile].hive = false;
  s.hives.length = 0;
  s.hordes.length = 0;
  s.hiveInfo.nextBorderDay = 9999;
  if (s.hardcore.outbreak) s.hardcore.outbreak.mil = null; // no hive by the base either (hardcore-outbreak.js)
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
