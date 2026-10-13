// Crawl balance automation (docs/crawl-balance.md): plays the hive crawl and the city crawl end to end, headless, with
// the autopilot's own crawl steps, over a grid of scenarios you control (the hive's tier and guard, the city's depth and
// the day, the number of survivors, their weapons, armour, Shooting, lights, Molotovs and bangs), and prints a table of
// outcomes per scenario: how often the crawl succeeds, what it costs in lives, hours and ammo, and what it brings home.
// A scenario is judged against TARGETS (below): the win rate and the loss of life a squad of that tier should see.
//
// Usage: node tools/crawlbalance.js hive [options]     (the hive crawl: to the core and the Hivemind)
//        node tools/crawlbalance.js city [options]     (the city crawl: blocks, buildings, the way out)
//        node tools/crawlbalance.js both [options]
// Options (comma lists make a grid; each key can be a list):
//   --trials N        seeds per scenario (default 12)         --seed N      first seed (default 4000)
//   --tier 1,2,3      hive tier (hive)                        --guard 80    the hive's guard horde (hive)
//   --trips 3         hive trips per scenario: the squad goes home, heals, restocks and comes again (default 1)
//   --rest 6          days between hive trips (default 6; chambers refill by REFILL_DAYS, the guard does not regrow)
//   --depth 2,4       blocks the city crawl goes down to (city; default the autopilot's CRAWL.AUTO.depth)
//   --block N         city: start on a block of this level (a list compares them)
//   --way safer       city: how the team leaves (safer: the lowest risk, the autopilot's; back: the path in; line: the
//                     safest straight line to the rim). A list compares them.
//   --day 100         the day of the game (eras and growth scale with it; default hive: by tier, city: 60)
//   --squad rifle,scrappy,...  loadouts (see LOADOUTS; or a custom one: --n 4 --weapon shotgun --armor vest --shoot 5)
//   --n 6 --weapon ar --armor plate --shoot 8 --health 100 --lights 1 --fire 0 --stun 0 --meds 6 --ammo 300
//   --trace           print each crawl's log (use with --trials 1 --seed N to follow one run)
//   --why             hive: also print why each trip ended (won, core too much, too many hurt, alert, turned back, wiped);
//                     city: how each crawl ended (edge: from the rim, back, line, wiped, stuck)
//   --style balanced  the autopilot style whose retreat policy the team fights by (cautious, balanced, aggressive;
//                     none: fight to the end, a player's team's default)
//   --json file       write the rows as JSON                  --quiet       only the table
//   --targets         judge the rows against TARGETS and exit 1 when some are off (for a CI-style check)
//   --set HCRAWL.NUMBERS.k=120,CRAWL.QUICK.fight=0.25   override tuning numbers for this run (a dotted path under
//                     HCRAWL, HIVEMIND, CRAWL, EVENTS, DEEP): A/B a tweak without editing the source.
import { createWorld, makeSurvivor, hub, tickHour } from "../src/sim/world.js";
import { GEAR, supValue } from "../src/sim/data.js";
import { itemValue } from "../src/sim/valuation.js";
import { FOODS } from "../src/sim/foods.js";
import { ensureHives } from "../src/sim/hives.js";
import { makeHorde } from "../src/sim/hordes.js";
import { hiveTier } from "../src/sim/hivetech.js";
import { settleParty } from "../src/sim/ammo.js";
import { packShells } from "../src/sim/carrykit.js";
import { partyMembers } from "../src/sim/parties.js";
import { STYLE_POLICY } from "../src/sim/breakoff.js";
import { launchExpedition } from "../src/sim/parties.js";
import { atBase } from "../src/sim/world.js";
import * as HC from "../src/sim/hivecrawl.js";
import * as CC from "../src/sim/citycrawl.js";
import { DEEP } from "../src/sim/deeploot.js";
import { writeFileSync } from "node:fs";

// ---------- loadouts: what the people going in carry ----------
// n people, the gun, the armour, Shooting, health, a headlamp each, Molotovs and flashbangs in the pockets.
export const LOADOUTS = {
  naked:   { n: 4, weapon: "bat",       armor: null,    shoot: 2, health: 100, lights: false, fire: 0, stun: 0 }, // fresh survivors with a club
  scrappy: { n: 5, weapon: "pistol",    armor: null,    shoot: 4, health: 90,  lights: false, fire: 0, stun: 0 }, // the first weeks: pistols, no armour
  early:   { n: 5, weapon: "shotgun",   armor: "vest",  shoot: 5, health: 100, lights: true,  fire: 1, stun: 0 }, // a first proper squad
  hunters: { n: 6, weapon: "huntrifle", armor: "vest",  shoot: 6, health: 100, lights: true,  fire: 1, stun: 1 },
  solid:   { n: 6, weapon: "shotgun",   armor: "vest",  shoot: 7, health: 100, lights: true,  fire: 2, stun: 2 }, // a good mid-game squad
  rifles:  { n: 6, weapon: "ar",        armor: "plate", shoot: 8, health: 100, lights: true,  fire: 2, stun: 2 }, // the late game
  elite:   { n: 8, weapon: "ar",        armor: "plate", shoot: 10, health: 100, lights: true, fire: 3, stun: 3 }, // the best a hub fields
};
// What a good balance looks like (win = the hive destroyed in `trips` trips; out = the city crawl ends with the team
// out and alive; dead = the average share of the squad lost). A loadout meets a tier's range when the numbers fall in
// it. Written from the design (a tier-N hive should beat a naked squad, test a middling one and fall to a good one).
export const TARGETS = {
  hive: {
    // tier: { loadout: [minWin, maxWin, maxDeadShare] }
    1: { naked: [0, 0.15, 1], scrappy: [0.05, 0.5, 0.6], early: [0.4, 0.9, 0.4], solid: [0.7, 1, 0.3], rifles: [0.85, 1, 0.25] },
    2: { scrappy: [0, 0.15, 1], early: [0.1, 0.55, 0.6], solid: [0.4, 0.85, 0.45], rifles: [0.7, 1, 0.35] },
    3: { early: [0, 0.2, 1], solid: [0.15, 0.6, 0.55], rifles: [0.4, 0.85, 0.45], elite: [0.6, 1, 0.35] },
    4: { solid: [0, 0.2, 1], rifles: [0.15, 0.6, 0.55], elite: [0.4, 0.85, 0.45] },
  },
  city: {
    // depth (blocks): { loadout: [minOut, maxOut, maxDeadShare] }. Only the autopilot's own depth (2, a block 3-4 with
    // a good squad) is judged: it leaves a deeper street at once, so depth 6 and 8 rows say nothing until the
    // harness has a search policy (docs/crawl-balance.md, next steps). A lost fight by the numbers is lethal (it
    // killed 75% of a team), so even a good squad loses a few percent of its people over two blocks.
    2: { naked: [0.6, 1, 0.35], scrappy: [0.8, 1, 0.22], early: [0.88, 1, 0.18], solid: [0.9, 1, 0.18], rifles: [0.9, 1, 0.18] },
    // The autopilot's own depth (AUTO.depth 4 levels on the round grid, 2026-10-13): it plans the level by the team's
    // strength, so a weak team stays near the rim and a strong one goes in toward the centre and pays in street fights.
    4: { naked: [0.85, 1, 0.2], scrappy: [0.85, 1, 0.2], early: [0.85, 1, 0.2], solid: [0.85, 1, 0.2], rifles: [0.85, 1, 0.22], elite: [0.85, 1, 0.3] },
  },
};
// The day each hive tier opens (hivetech.js hiveTier follows the game's years); a scenario's default day.
const TIER_DAY = { 0: 0, 1: 400, 2: 900, 3: 1600, 4: 2100 };

// ---------- args ----------
const argv = process.argv.slice(2);
const MODE = ["hive", "city", "both"].includes(argv[0]) ? argv[0] : "both";
const opt = (name, def) => { const i = argv.indexOf("--" + name); return i < 0 ? def : (argv[i + 1] === undefined || argv[i + 1].startsWith("--") ? true : argv[i + 1]); };
const list = (name, def) => { const v = opt(name, null); return v == null || v === true ? def : String(v).split(",").map((x) => (x !== "" && !isNaN(x) ? Number(x) : x)); };
const flag = (name) => argv.includes("--" + name);

// --set path=value,path=value: tuning overrides. Returns the undo.
const ROOTS = { HCRAWL: HC.HCRAWL, HIVEMIND: HC.HIVEMIND, CRAWL: CC.CRAWL, EVENTS: CC.EVENTS, DEEP };
export function applySets(spec) {
  for (const kv of String(spec || "").split(/,(?![^\[]*\])/).filter(Boolean)) { // commas inside [..] belong to an array value
    const [path, raw] = kv.split("=");
    const keys = path.split(".");
    let o = ROOTS[keys[0]];
    if (!o) throw new Error(`--set: unknown root ${keys[0]} (${Object.keys(ROOTS).join(", ")})`);
    for (let i = 1; i < keys.length - 1; i++) { o = o[keys[i]]; if (o == null) throw new Error(`--set: no ${keys.slice(0, i + 1).join(".")}`); }
    const last = keys[keys.length - 1];
    if (!(last in o)) throw new Error(`--set: no ${path}`);
    o[last] = JSON.parse(raw);
  }
}

// ---------- building a squad ----------
function loadoutFrom(name) {
  const base = LOADOUTS[name] || { ...LOADOUTS.solid };
  const o = { ...base };
  for (const k of ["n", "weapon", "armor", "shoot", "health", "fire", "stun"]) { const v = opt(k, null); if (v != null && v !== true) o[k] = v === "none" ? null : isNaN(v) ? v : Number(v); }
  const l = opt("lights", null); if (l != null && l !== true) o.lights = l !== "0";
  return o;
}
function addSquad(st, L, partyId, dest, mission, supplies) {
  const people = [];
  for (let i = 0; i < L.n; i++) {
    const s = makeSurvivor(st, 1);
    s.traits = []; s.skills.shooting = L.shoot; s.skills.stealth = 4; s.skills.scouting = 3; s.skills.medicine = 4; s.health = L.health;
    s.gear.weapon = { key: L.weapon, name: GEAR[L.weapon].name, quality: 1 };
    s.gear.armor = L.armor ? { key: L.armor, name: GEAR[L.armor].name, quality: 1 } : null;
    s.pockets = [L.lights ? { key: "headlamp", name: GEAR.headlamp.name, quality: 1 } : null, i < L.fire ? { key: "molotov", name: GEAR.molotov.name, quality: 1 } : null, i >= L.n - L.stun ? { key: "flashbang", name: GEAR.flashbang.name, quality: 1 } : null, null];
    st.survivors.push(s); people.push(s);
  }
  const p = { id: partyId, owner: "player", kind: "expedition", mission, members: people.map((s) => s.id), supplies: { ...supplies }, cargo: { supplies: {}, gear: [] },
    path: [dest], idx: 0, dest, phase: "engaged", seen: new Map(), spotted: new Map(), homeBaseId: hub(st).id, orders: [], stance: "normal" };
  for (const s of people) s.location = { kind: "party", partyId: p.id };
  // The retreat policy the autopilot's style fights by (breakoff.js STYLE_POLICY; --style none: fight to the end, a
  // player's team's default). Set on the team, not by turning the autopilot on: the governor would step the crawl too.
  const style = String(opt("style", "balanced"));
  if (style !== "none") p.retreatPolicy = STYLE_POLICY[style] || "losing";
  st.parties.push(p);
  settleParty(st, p);
  packShells(p.supplies, people);
  return { p, people };
}
const ammoOf = (p) => Object.entries(p.supplies || {}).reduce((a, [k, v]) => a + (/ammo|rounds|9mm|556|762|12g|shell|\.|gauge|cal/i.test(k) ? v : 0), 0);

// ---------- the hive crawl ----------
// One scenario trial: a world, a hive of `tier` with a guard, the squad crawls (the autopilot's step) until it is out,
// dead or the hive is dead; with trips > 1 the survivors heal, restock and go again after the hive's rest.
export function hiveTrial(seed, { tier, guard, loadout, L, trips = 1, day = null }) {
  const st = createWorld({ seed, factionCount: 3 });
  st.started = true;
  ensureHives(st);
  const hv = st.hives[0];
  st.hour = (day ?? TIER_DAY[tier]) * 24; hv.born = 0;
  if (guard) makeHorde(st, { tile: hv.tile, size: guard, role: "guard", hive: hv.id, target: hv.tile });
  const realTier = hiveTier(st, hv);
  const supplies = { ammo: opt("ammo", 400), meds: opt("meds", 6), food: 12, water: 12, fuel: 4 };
  let { p, people } = addSquad(st, L, 91000 + (seed % 1000), hv.tile, "hive", supplies);
  const reasons = [];
  let hours = 0, lost = 0, deepest = 0, kills = 0, ammoUsed = 0, tripsMade = 0, won = false, depth = 0, startN = L.n;
  for (let t = 0; t < trips && !won; t++) {
    tripsMade++;
    const a0 = ammoOf(p), h0 = st.hour;
    if (!st.parties.includes(p)) break;
    HC.startHiveCrawl(st, p, hv);
    depth = HC.denOf(st, hv).depth;
    let g = 0;
    const cr = p.hiveCrawl;
    while (p.hiveCrawl && st.parties.includes(p) && g++ < 400) {
      if (flag("trace") && p.hiveCrawl.enc) { const o = HC.encounterOptions(st, p).map((x) => `${x.id}:${(x.odds ?? 0).toFixed(2)}`).join(" "); console.log(`  [h${st.hour}] enc ${p.hiveCrawl.enc.kind} at ${p.hiveCrawl.at}, alert ${p.hiveCrawl.alert}, hp ${people.map((s) => (s.alive ? Math.round(s.health) : "X")).join(",")}: ${o}`); }
      HC.hiveCrawlAutoStep(st, p);
    }
    if (flag("trace") && cr) for (const l of cr.log) console.log(`  [h${l.hour}] ${l.text}`);
    hours += st.hour - h0;
    if (cr) { const txt = cr.log.map((l) => l.text).join(" | "); reasons.push(!st.hives.includes(hv) ? "won" : /core is too much/.test(txt) ? "core too much" : /Too many hurt/.test(txt) ? "too many hurt" : /roused|swarm|packs up|Swarming/i.test(txt) ? "alert" : !st.parties.includes(p) ? "wiped" : "turned back"); }
    if (flag("trace")) for (const l of (st.log || []).slice(-14)) console.log(`  LOG ${(l.text || l.msg || JSON.stringify(l)).slice(0, 220)}`);
    if (!st.hives.includes(hv)) { won = true; break; }
    const alive = people.filter((s) => s.alive !== false && st.survivors.includes(s));
    if (flag("trace")) console.log(`  after trip ${t + 1}: party in world ${st.parties.includes(p)}, alive ${people.map((s) => `${s.alive}/${st.survivors.includes(s)}/${Math.round(s.health)}`).join(" ")}`);
    lost = startN - alive.length;
    ammoUsed += Math.max(0, a0 - ammoOf(p));
    if (!st.parties.includes(p) || !alive.length) break;
    if (t === trips - 1) break;
    // Home: heal, restock, rest for the hive's gap between trips (the autopilot's hiveRest), then go again.
    for (const s of alive) s.health = L.health;
    p.supplies.ammo = supplies.ammo; p.supplies.meds = supplies.meds;
    st.hour += 24 * Number(opt("rest", 6)); // days pass without the world's tick (a fake hub would starve): chambers refill by the clock, the guard does not regrow
    p.phase = "engaged";
    for (const s of alive) s.location = { kind: "party", partyId: p.id };
    people = alive; p.members = alive.map((s) => s.id);
  }
  const alive = people.filter((s) => s.alive !== false && st.survivors.includes(s)).length;
  const c = null;
  return { won, tier: realTier, lost: startN - alive, share: (startN - alive) / startN, wiped: alive === 0, hours, trips: tripsMade, depth, reasons, ammo: ammoUsed, guardLeft: (st.hordes.find((h) => h.role === "guard" && h.hive === hv.id) || { size: 0 }).size };
}

// ---------- the city crawl ----------
function cityWorld(seed, day) {
  const st = createWorld({ seed, factionCount: 7 });
  st.hour = day * 24;
  const city = st.tiles.find((t) => t.loc && t.loc.type === "city");
  return { st, city };
}
export function cityTrial(seed, { depth, startBlock = 1, loadout, L, day = 60, way = "safer" }) {
  const { st, city } = cityWorld(seed, day);
  const supplies = { ammo: opt("ammo", 300), meds: opt("meds", 4), food: 8, water: 8 };
  const { p, people } = addSquad(st, L, 92000 + (seed % 1000), city.id, "scavenge", supplies);
  const saved = CC.CRAWL.AUTO.depth, savedWay = CC.CRAWL.AUTO.way;
  CC.CRAWL.AUTO.depth = Math.max(depth, startBlock);
  CC.CRAWL.AUTO.way = way;
  try {
    CC.startCrawl(st, p);
    const c = p.crawl;
    if (startBlock > 1) CC.jumpToLevel(st, c, startBlock);
    const h0 = st.hour;
    let g = 0;
    const aliveNow = () => people.filter((s) => s.alive !== false && st.survivors.includes(s)).length;
    let atLeave = null, leftBy = null; // how many were alive when the team set off for the way out, and which way
    while (p.crawl && st.parties.includes(p) && g++ < 200) { const n0 = aliveNow(); CC.crawlAutoStep(st, p); if (atLeave == null && c.leaving) { atLeave = n0; leftBy = c.leaving.way; } }
    if (flag("trace")) for (const l of c.log) console.log(`  [h${l.hour}] ${l.text}`);
    const alive = aliveNow();
    const out = !p.crawl && st.parties.includes(p) && alive > 0;
    const loot = out ? Object.values(p.cargo.supplies).reduce((a, v) => a + v, 0) + (p.cargo.gear || []).length * 4 : 0;
    // What it is worth (trade value: supplies by data.js supValue, food by its kcal at a day's ration's worth, gear by valuation.js itemValue).
    const value = out ? Object.entries(p.cargo.supplies).reduce((a, [k, v]) => a + v * (supValue(k) || (FOODS[k] ? (FOODS[k].kcal || 0) / 2000 * supValue("food") : 0)), 0) + (p.cargo.gear || []).reduce((a, it) => a + (it ? itemValue(it) || 0 : 0), 0) : 0;
    const fl = c.log.filter((l) => /^Fight with/.test(l.text));
    const fights = fl.length, fightsLost = fl.filter((l) => /: lost\./.test(l.text)).length;
    // How it ended: from the rim (edge), back along the path, a straight line out, wiped, or still in (stuck).
    const end = alive === 0 ? "wiped" : p.crawl ? "stuck" : leftBy || "edge";
    return { end, walked: Object.keys(c.blocks).length, outShare: atLeave == null ? 0 : (atLeave - alive) / L.n, out, value, fights, fightsLost, wiped: alive === 0, lost: L.n - alive, share: (L.n - alive) / L.n, hours: st.hour - h0, loot, ammo: Math.max(0, supplies.ammo - ammoOf(p)), blocks: c.deepest ?? c.block };
  } finally { CC.CRAWL.AUTO.depth = saved; CC.CRAWL.AUTO.way = savedWay; }
}

// ---------- the table ----------
const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);
const tally = (xs) => xs.reduce((o, x) => ((o[x] = (o[x] || 0) + 1), o), {});
const avg = (rs, f) => rs.reduce((a, r) => a + f(r), 0) / Math.max(1, rs.length);
function judge(kind, key, loadout, win, share) {
  const row = TARGETS[kind] && TARGETS[kind][key] && TARGETS[kind][key][loadout];
  if (!row) return { mark: " ", note: "" };
  const [lo, hi, maxDead] = row;
  const issues = [];
  if (win < lo - 1e-9) issues.push(`${kind === "hive" ? "win" : "out"} ${pct(win).trim()} < ${pct(lo).trim()} (too hard)`);
  if (win > hi + 1e-9) issues.push(`${kind === "hive" ? "win" : "out"} ${pct(win).trim()} > ${pct(hi).trim()} (too easy)`);
  if (share > maxDead + 1e-9) issues.push(`deaths ${pct(share).trim()} > ${pct(maxDead).trim()}`);
  return issues.length ? { mark: "✗", note: issues.join("; ") } : { mark: "✓", note: "" };
}

export function run() {
  const trials = Number(opt("trials", 12));
  const seed0 = Number(opt("seed", 4000));
  const squads = list("squad", ["early", "solid", "rifles"]);
  const rows = [];
  if (opt("set", null) && opt("set", null) !== true) applySets(opt("set", null));
  const quiet = flag("quiet");
  if (MODE === "hive" || MODE === "both") {
    const tiers = list("tier", [1, 2, 3]);
    const guards = list("guard", [80]);
    const trips = Number(opt("trips", 1));
    if (!quiet) console.log(`\nHIVE CRAWL (${trials} trials a row, ${trips} trip${trips === 1 ? "" : "s"}; win = the Hivemind dead)`);
    const days = list("day", [null]); // null: the tier's opening day
    const showDay = days.length > 1;
    console.log((showDay ? "  day " : "") + "tier guard squad      n weapon     armor  shoot | win   wiped  lost/sq  hours ammo  depth |");
    for (const tier of tiers) for (const guard of guards) for (const day of days) for (const sq of squads) {
      const L = loadoutFrom(sq);
      const rs = [];
      for (let i = 0; i < trials; i++) rs.push(hiveTrial(seed0 + i, { tier, guard, loadout: sq, L, trips, day }));
      const win = avg(rs, (r) => (r.won ? 1 : 0)), share = avg(rs, (r) => r.share), wiped = avg(rs, (r) => (r.wiped ? 1 : 0));
      const j = judge("hive", tier, sq, win, share);
      const row = { kind: "hive", tier, guard, day, squad: sq, n: L.n, weapon: L.weapon, armor: L.armor, shoot: L.shoot, trips, win, wiped, lostShare: share, hours: avg(rs, (r) => r.hours), ammo: avg(rs, (r) => r.ammo), depth: avg(rs, (r) => r.depth), ends: tally(rs.flatMap((r) => r.reasons)), mark: j.mark, note: j.note };
      rows.push(row);
      console.log(`${showDay ? String(day ?? TIER_DAY[tier]).padStart(5) + " " : ""}${String(tier).padStart(3)} ${String(guard).padStart(5)} ${sq.padEnd(10)}${String(L.n).padStart(2)} ${String(L.weapon).padEnd(10)}${String(L.armor || "-").padEnd(6)}${String(L.shoot).padStart(4)}  | ${pct(win)} ${pct(wiped)}   ${pct(share)}  ${row.hours.toFixed(0).padStart(5)} ${row.ammo.toFixed(0).padStart(4)}  ${row.depth.toFixed(0).padStart(3)}   | ${j.mark} ${j.note}`);
      if (flag("why")) console.log(`       trips ended: ${Object.entries(row.ends).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    }
  }
  if (MODE === "city" || MODE === "both") {
    const depths = list("depth", [2, 4]);
    const blocks = list("block", [1]), days = list("day", [60]), ways = list("way", ["safer"]);
    for (const w of ways) if (!["safer", "back", "line"].includes(w)) throw new Error(`--way: ${w} (safer, back, line)`);
    // A column for each of --block, --day and --way only when it is a list (or not its default).
    const show = { block: blocks.length > 1 || blocks[0] !== 1, day: days.length > 1, way: ways.length > 1 || ways[0] !== "safer" };
    const lead = () => `${show.block ? "blk " : ""}${show.day ? "  day " : ""}${show.way ? "way   " : ""}`;
    if (!quiet) console.log(`\nCITY CRAWL (${trials} trials a row${show.day ? "" : `, day ${days[0]}`}; out = the team comes back alive; walked = blocks it set foot on; line = left by a straight line to the rim; out lost = share of the squad lost on the way out)`);
    console.log(`${lead()}depth squad      n weapon     armor  shoot | out   wiped  lost/sq  hours loot value ammo fights lost deep walk line out lost |`);
    for (const startBlock of blocks) for (const day of days) for (const way of ways) for (const depth of depths) for (const sq of squads) {
      const L = loadoutFrom(sq);
      const rs = [];
      for (let i = 0; i < trials; i++) rs.push(cityTrial(seed0 + i, { depth, startBlock, loadout: sq, L, day, way }));
      const out = avg(rs, (r) => (r.out ? 1 : 0)), share = avg(rs, (r) => r.share), wiped = avg(rs, (r) => (r.wiped ? 1 : 0));
      const j = judge("city", depth, sq, out, share);
      const row = { kind: "city", depth, block: startBlock, day, way, walked: avg(rs, (r) => r.walked), viaLine: avg(rs, (r) => (r.end === "line" ? 1 : 0)), ends: tally(rs.map((r) => r.end)), squad: sq, n: L.n, weapon: L.weapon, armor: L.armor, shoot: L.shoot, out, wiped, lostShare: share, lostOut: avg(rs, (r) => r.outShare), hours: avg(rs, (r) => r.hours), loot: avg(rs, (r) => r.loot), value: avg(rs, (r) => r.value), ammo: avg(rs, (r) => r.ammo), deep: avg(rs, (r) => r.blocks || 0), fights: avg(rs, (r) => r.fights), fightsLost: avg(rs, (r) => r.fightsLost), mark: j.mark, note: j.note };
      rows.push(row);
      const pre = `${show.block ? String(startBlock).padStart(3) + " " : ""}${show.day ? String(day).padStart(5) + " " : ""}${show.way ? way.padEnd(6) : ""}`;
      console.log(`${pre}${String(depth).padStart(4)} ${sq.padEnd(10)}${String(L.n).padStart(2)} ${String(L.weapon).padEnd(10)}${String(L.armor || "-").padEnd(6)}${String(L.shoot).padStart(4)}  | ${pct(out)} ${pct(wiped)}   ${pct(share)}  ${row.hours.toFixed(0).padStart(5)} ${row.loot.toFixed(0).padStart(4)} ${row.value.toFixed(0).padStart(5)} ${row.ammo.toFixed(0).padStart(5)} ${row.fights.toFixed(1).padStart(5)} ${row.fightsLost.toFixed(2).padStart(5)} ${row.deep.toFixed(1).padStart(4)} ${row.walked.toFixed(1).padStart(4)} ${pct(row.viaLine)}    ${pct(row.lostOut)} | ${j.mark} ${j.note}`);
      if (flag("why")) console.log(`       crawls ended: ${Object.entries(row.ends).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    }
  }
  const out = opt("json", null);
  if (out && out !== true) writeFileSync(out, JSON.stringify({ args: argv, rows }, null, 1));
  const off = rows.filter((r) => r.mark === "✗").length, judged = rows.filter((r) => r.mark !== " ").length;
  if (judged) console.log(`\n${judged - off} of ${judged} judged rows inside their targets, ${off} off.`);
  if (flag("targets") && off) process.exit(1);
  return rows;
}

if (process.argv[1] && process.argv[1].endsWith("crawlbalance.js")) run();
