// The AI groups against the hives (src/sim/factions.js groupHiveWar, GROUP_HIVE): a group with a hive within 12 tiles
// sends a war party every 20–40 days by type (zealots always, the military and a fortress often, traders rarely,
// raiders never); each party crawls the hive's den as your teams do (hivecrawl.js groupHiveCrawl: chamber by chamber on
// the shortest way, then the core), cuts the hive's guard by its fighters' power and loses a few people, and burns the hive
// out when the guard left is small (hives.js destroyHive: the records and the hive victory as for any hive). A fortress
// beside a hive wears it down and destroys it within a season; traders rarely go; a hive you fought lately earns the
// group's goodwill; the log lines come only when the group is in radio reach or the hive is in sight; the new fields
// round-trip through a save and old saves without them load; a whole year of the sim with the groups at war with the
// hives stays deterministic and sane.
// Usage: node tools/grouphivetest.js
import { createWorld, tickHour, day, hub, RADIO_RANGE } from "../src/sim/world.js";
import { makeGang, groupHiveWar, groupHiveTarget, groupHiveParty, GROUP_HIVE, changeGoodwill } from "../src/sim/factions.js";
import { makeHorde } from "../src/sim/hordes.js";
import { ensureHives, newHive, hiveGuard, hiveStats } from "../src/sim/hives.js";
import { FACTION_TYPES } from "../src/sim/data.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { takeSize } from "./sizearg.js";

const size = takeSize();
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const t0 = Date.now();
const land = (st, id) => st.tiles[id].terrain !== "water" && !st.tiles[id].hive && !st.tiles[id].loc && !st.bases.some((b) => b.tile === id);

// A world with one hive and one group of the type beside it (dist tiles away), nothing else: the other hives and
// groups are taken out so only this fight runs. guard: the hive's guard horde. The group starts known and neutral.
function setup(seed, type, pop, { dist = 3, guard = 100, fromHub = 12 } = {}) {
  const st = createWorld({ seed, factionCount: 3, size });
  st.started = true;
  ensureHives(st);
  for (const h of [...st.hives]) st.tiles[h.tile].hive = false;
  st.hives.length = 0;
  st.hordes.length = 0;
  for (const f of st.factions) { f.alive = false; f.bases = []; }
  st.factions.length = 0;
  const g = st.grid, hb = hub(st);
  const baseTile = st.tiles.find((t) => land(st, t.id) && g.distance(t.id, hb.tile) === fromHub && t.x > 3 && t.y > 3 && t.x < g.width - 4 && t.y < g.height - 4).id;
  const hiveTile = st.tiles.find((t) => land(st, t.id) && g.distance(t.id, baseTile) === dist && g.distance(t.id, hb.tile) > dist).id;
  const hv = newHive(st, hiveTile, 0);
  st.hives.push(hv);
  if (guard) makeHorde(st, { tile: hiveTile, size: guard, role: "guard", hive: hv.id, target: hiveTile });
  const f = makeGang(st, baseTile, { type, pop, known: true });
  f.goodwill = 0;
  return { st, f, hv, g };
}
// The group's days, one at a time, without the hives producing (hordesDaily is not run): the war alone.
function warDays(st, f, days, onDay = null) {
  const out = [];
  for (let i = 0; i < days; i++) {
    st.hour += 24;
    const r = groupHiveWar(st, f, day(st));
    if (r) out.push({ day: day(st), r });
    if (onDay) onDay(day(st), r);
    if (!st.hives.length) break;
  }
  return out;
}

// 1. A fortress beside a hive wears it down and burns it out.
{
  console.log("A fortress beside a hive");
  const { st, f, hv } = setup(1, "fortress", 30);
  const pop0 = f.pop;
  const guard0 = hiveGuard(st, hv).size;
  const sizes = [];
  const fights = warDays(st, f, 400, (d, r) => { if (r) sizes.push(hiveGuard(st, hv) ? hiveGuard(st, hv).size : 0); });
  const party = groupHiveParty({ ...f, pop: pop0 });
  check(groupHiveTarget(st, { bases: f.bases }) === null && !st.hives.includes(hv), `the hive (guard ${guard0}) is destroyed by the fortress's war parties (${fights.length} parties: ${fights.map((x) => `day ${x.day} ${x.r}`).join(", ")})`);
  const last = fights[fights.length - 1];
  check(last && last.r === "burned" && last.day <= 200, `... within 200 days (day ${last ? last.day : "never"}); each party of ${party.fighters} at strength ${party.power.toFixed(1)} kills about ${Math.round(party.power * GROUP_HIVE.FIGHT)} of the brood`);
  check(sizes.every((s, i) => i === 0 || s <= sizes[i - 1]), `the guard falls with every party (${guard0} → ${sizes.join(" → ")})`);
  check(f.pop < pop0 && f.pop >= pop0 - fights.length * Math.ceil(party.fighters * GROUP_HIVE.LOSS_MAX), `the fortress lost a few people to it (${pop0} → ${f.pop})`);
  check(f.hiveFights === fights.length && f.hivesBurned === 1 && f.hiveKills >= guard0 - GROUP_HIVE.SMALL, `the group remembers it (${f.hiveFights} fights, ${f.hiveKills} killed, ${f.hivesBurned} hive burned)`);
  const stats = hiveStats(st);
  check(stats.destroyed === 1 && stats.groupKills === 1 && stats.groupStorms === fights.length, `the hive record counts it: destroyed ${stats.destroyed}, by the groups ${stats.groupKills}, their storms ${stats.groupStorms}`);
  check(fights.slice(1).every((x, i) => x.day - fights[i].day >= GROUP_HIVE.EVERY[0] && x.day - fights[i].day <= GROUP_HIVE.EVERY[1] * 3), `parties come ${GROUP_HIVE.EVERY[0]}–${GROUP_HIVE.EVERY[1]} days apart (gaps ${fights.slice(1).map((x, i) => x.day - fights[i].day).join(", ")})`);
  // Guard-less hive: a party burns it out at once.
  const { st: s2, f: f2, hv: h2 } = setup(2, "fortress", 30, { guard: 0 });
  const r2 = warDays(s2, f2, 120);
  check(r2.length === 1 && r2[0].r === "burned" && !s2.hives.includes(h2), `a hive with no guard left is burned out by the first party (${r2.map((x) => x.r).join(", ")})`);
}

// 2. By type: zealots always, traders rarely, raiders never; nothing out of reach; too few people: nobody goes.
{
  console.log("By type and reach");
  const perYear = (type, seeds = [11, 12, 13, 14, 15, 16]) => {
    let fights = 0, days = 0;
    for (const seed of seeds) {
      const { st, f, hv } = setup(seed, type, 40, { guard: 5000 }); // a guard no party ends: the pace alone
      hv.res = 80;
      const r = warDays(st, f, 365);
      fights += r.length; days += 365;
      f.pop = 40;
    }
    return (fights / days) * 365;
  };
  const rates = Object.fromEntries(Object.keys(FACTION_TYPES).map((t) => [t, perYear(t)]));
  const due = 365 / ((GROUP_HIVE.EVERY[0] + GROUP_HIVE.EVERY[1]) / 2);
  console.log(`    war parties a year beside a hive: ${Object.entries(rates).map(([t, r]) => `${t} ${r.toFixed(1)}`).join(", ")} (a party is looked at ${due.toFixed(1)} times a year)`);
  check(rates.zealot >= due * 0.8 && rates.zealot <= due * 1.25, `zealots go every time (${rates.zealot.toFixed(1)} a year)`);
  check(rates.fortress > rates.expansionist && rates.military > rates.expansionist, `a fortress and the military go often (${rates.fortress.toFixed(1)}, ${rates.military.toFixed(1)}), expansionists sometimes (${rates.expansionist.toFixed(1)})`);
  check(rates.traders < rates.fortress / 2 && rates.commune < rates.fortress / 2 && rates.traders > 0, `traders and communes rarely (${rates.traders.toFixed(1)}, ${rates.commune.toFixed(1)})`);
  check(rates.raider === 0, "raiders never");
  const { st, f } = setup(3, "zealot", 30, { dist: GROUP_HIVE.RANGE + 2 });
  check(groupHiveTarget(st, f) === null && warDays(st, f, 120).length === 0, `a hive ${GROUP_HIVE.RANGE + 2} tiles away is out of reach (${GROUP_HIVE.RANGE})`);
  const { st: s2, f: f2 } = setup(4, "zealot", GROUP_HIVE.MIN_POP - 1);
  check(warDays(s2, f2, 120).length === 0, `a group of ${GROUP_HIVE.MIN_POP - 1} sends nobody (${GROUP_HIVE.MIN_POP} needed)`);
}

// 3. Goodwill: fighting the hive you fought lately.
{
  console.log("Goodwill");
  const { st, f, hv } = setup(5, "zealot", 30, { guard: 5000 });
  const gw0 = f.goodwill;
  // Your team set fires there, five days before every party (hives.js notePlayerFight sets hive.playerDay).
  const fought = (ago, days) => { let n = 0; for (let i = 0; i < days; i++) { st.hour += 24; hv.playerDay = day(st) - ago; if (groupHiveWar(st, f, day(st))) n++; } return n; };
  const r = fought(5, GROUP_HIVE.EVERY[1] + 1);
  check(r >= 1 && f.goodwill === gw0 + GROUP_HIVE.GOODWILL * r, `a group that storms a hive you fought within ${GROUP_HIVE.PLAYER_DAYS} days gains +${GROUP_HIVE.GOODWILL} (${gw0} → ${f.goodwill} after ${r} part${r === 1 ? "y" : "ies"})`);
  const gw1 = f.goodwill;
  const r2 = fought(GROUP_HIVE.PLAYER_DAYS + 1, GROUP_HIVE.EVERY[1] + 1);
  check(r2 >= 1 && f.goodwill === gw1, `an older fight of yours (${GROUP_HIVE.PLAYER_DAYS + 1} days) earns nothing (${gw1} → ${f.goodwill})`);
  void changeGoodwill;
}

// 4. Log lines: only in radio reach or sight.
{
  console.log("What you hear of it");
  const lines = (st, re) => st.log.filter((l) => re.test(l.text)).length;
  const RE = /fighters crawled .* (were driven off|burned it out)/;
  // Out of reach, out of sight, the group known: nothing.
  const { st, f } = setup(6, "zealot", 30, { guard: 5000, fromHub: 20 });
  const r = warDays(st, f, 80);
  check(r.length >= 1 && lines(st, RE) === 0, `${r.length} parties out of radio reach and out of sight: no line in the log`);
  // The hive in sight: the line, with the group named when known.
  const { st: s2, f: f2, hv: h2 } = setup(7, "zealot", 30, { guard: 5000, fromHub: 20 });
  s2.live.add(h2.tile);
  const r2 = warDays(s2, f2, 80);
  check(r2.length >= 1 && lines(s2, RE) === r2.length && s2.log.some((l) => l.text.startsWith(`${f2.name}'s fighters crawled`)), `the hive in sight: "${s2.log.find((l) => RE.test(l.text)).text}"`);
  // Not known: "An unknown group".
  const { st: s3, f: f3, hv: h3 } = setup(8, "zealot", 30, { guard: 5000, fromHub: 20 });
  f3.known = false;
  s3.live.add(h3.tile);
  warDays(s3, f3, 80);
  check(s3.log.some((l) => l.text.startsWith("An unknown group's fighters crawled")), "a group you have not met is not named");
  // In radio reach (a radio station at the hub, the group's base within its range): the line.
  const { st: s4, f: f4 } = setup(9, "fortress", 40, { guard: 5000, fromHub: RADIO_RANGE - 2 });
  hub(s4).radio = true;
  const r4 = warDays(s4, f4, 120);
  check(r4.length >= 1 && lines(s4, RE) === r4.length, `the group in radio reach (its base ${RADIO_RANGE - 2} tiles from your radio): ${lines(s4, RE)} line${lines(s4, RE) === 1 ? "" : "s"} for ${r4.length} part${r4.length === 1 ? "y" : "ies"}`);
  // A burned-out hive: the line says so and how many stand; destroyHive's own line is not written twice.
  const { st: s5, f: f5, hv: h5 } = setup(10, "fortress", 40, { guard: 10 });
  s5.live.add(h5.tile);
  warDays(s5, f5, 120);
  check(!s5.hives.includes(h5) && lines(s5, /burned it out/) === 1 && lines(s5, /was destroyed by/) === 0, `a hive burned out: "${(s5.log.find((l) => /burned it out/.test(l.text)) || { text: "?" }).text}"`);
}

// 5. The hive victory counts a hive the groups destroyed.
{
  console.log("Victory");
  const { st, f, hv } = setup(20, "zealot", 40, { guard: 10 });
  st.erasOff = true; // the eras' own clocks are tools/eratest.js's: the rule itself
  warDays(st, f, 120);
  check(!st.hives.includes(hv) && st.victory && st.gameOver && st.victoryReason === "hives", `the last hive burned out by a group wins the game (${st.log.find((l) => /^Every hive is destroyed/.test(l.text)) ? "the victory line is in the log" : "no victory line"})`);
}

// 6. Save and load: the new fields round-trip; a save without them loads and plays.
{
  console.log("Save and load");
  const { st, f, hv } = setup(21, "fortress", 40, { guard: 5000 });
  hv.playerDay = day(st);
  warDays(st, f, 60);
  st.cards.length = 0;
  const saved = JSON.parse(JSON.stringify(serializeState(st)));
  const c = deserializeState(saved);
  const cf = c.factions.find((x) => x.id === f.id), ch = c.hives.find((x) => x.id === hv.id);
  check(cf && cf.hiveDay === f.hiveDay && cf.hiveFights === f.hiveFights && cf.hiveKills === f.hiveKills && ch && ch.playerDay === hv.playerDay && c.hiveInfo.stats.groupStorms === st.hiveInfo.stats.groupStorms,
    `hiveDay ${f.hiveDay}, hiveFights ${f.hiveFights}, hiveKills ${f.hiveKills}, the hive's playerDay ${hv.playerDay} and the record's groupStorms ${st.hiveInfo.stats.groupStorms} survive a save`);
  const sig = (s) => JSON.stringify([s.hour, s.factions.map((x) => [x.pop, x.hiveDay, x.hiveFights, x.goodwill]), s.hordes.map((h) => [h.tile, h.size]), s.hives.map((h) => [h.tile, h.res])]);
  warDays(st, f, 90); warDays(c, cf, 90);
  check(sig(st) === sig(c), "and the loaded world fights on the same for 90 days");
  // An old save: no hiveDay, no fight record, no grown / groupStorms counters.
  const old = JSON.parse(JSON.stringify(serializeState(st)));
  const o = deserializeState(old);
  for (const x of o.factions) { delete x.hiveDay; delete x.hiveFights; delete x.hiveKills; delete x.hivesBurned; }
  for (const h of o.hives) delete h.playerDay;
  delete o.hiveInfo.stats.grown; delete o.hiveInfo.stats.groupStorms; delete o.hiveInfo.stats.groupKills;
  const of = o.factions.find((x) => x.id === f.id);
  const r = warDays(o, of, 120);
  check(of.hiveDay != null && r.length >= 1 && Number.isFinite(of.pop) && o.hiveInfo.stats.groupStorms === r.length, `a save from before plays on: the group picks a day (${of.hiveDay}) and fights (${r.length} parties)`);
}

// 7. A year of the whole sim: the groups fight the hives near them, nothing goes wrong, the same seed plays the same.
{
  console.log(`A year of the sim (${size})`);
  const run = (seed) => {
    const st = createWorld({ seed, factionCount: 10, size });
    st.started = true;
    const h = hub(st);
    const end = st.hour + 365 * 24;
    while (st.hour < end && !st.gameOver) { tickHour(st); if (st.hour % 24 === 0) { h.stock.food = Math.max(h.stock.food || 0, 200); h.stock.water = Math.max(h.stock.water || 0, 200); } }
    return st;
  };
  const a = run(31), b = run(31);
  const stats = hiveStats(a);
  const sig = (s) => JSON.stringify([s.hour, s.factions.map((x) => [x.pop, x.hiveDay, x.hiveFights, x.hivesBurned]), s.hives.map((h) => [h.tile, h.res])]);
  const near = a.factions.filter((f) => f.alive && groupHiveTarget(a, f)).length;
  check(stats.groupStorms > 0, `in a year the groups sent ${stats.groupStorms} war parties against the hives (${near} of ${a.factions.filter((f) => f.alive).length} groups have a hive within ${GROUP_HIVE.RANGE} tiles now) and burned out ${stats.groupKills}; ${a.hives.length} hives stand`);
  check(a.factions.every((f) => Number.isFinite(f.pop) && f.pop >= 0) && a.hives.every((h) => Number.isFinite(h.res)), "no NaN, nobody below zero people");
  check(sig(a) === sig(b), "the same seed plays out the same");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
