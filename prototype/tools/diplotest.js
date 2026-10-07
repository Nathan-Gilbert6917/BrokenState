// Diplomacy: jobs for other groups (every type made, accepted, done, failed or called off, deadlines, offers that
// expire, rewards), the relations matrix between groups, wars (raids with their own odds, territory changing hands,
// captives, peace on terms: land, tribute or a white peace), brokering a ceasefire, joining a war, trade at war
// (prices up, less to trade, buying back still loses), the coalition (invitations, the ways into radio reach for one
// (reachVia: radio, a team at the gates, a member, a base next door; the "out of radio reach" line), the council's vote, members
// leaving, shared sightings, help against raids and hordes, allies at a hive, the seasonal council), the alliance
// victory (true only when both conditions hold: land and every group still standing in it; hives do not matter), wants and surplus lists against the real stock, the market
// board, the autopilot's choices, determinism, a 365-day run without NaN and the yearly group collapse rate with
// and without wars between groups.
// Usage: node tools/diplotest.js [seed] [days] [collapse seeds, e.g. 1,2,3,4,5,6]
import { createWorld, tickHour, hub, atBase, day, alive, newId, checkGameOver, snapshot } from "../src/sim/world.js";
import { GEAR, SUPPLY_KEYS } from "../src/sim/data.js";
import { addBuilding } from "../src/sim/buildings.js";
import { launchExpedition, partyTile, planPath, removeParty } from "../src/sim/parties.js";
import { attitude, recomputeOwnership, resolveRaidOnFaction, strength } from "../src/sim/factions.js";
import { makeHorde } from "../src/sim/hordes.js";
import { ensureHives, destroyHive } from "../src/sim/hives.js";
import { newItem } from "../src/sim/inventory.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { canRadioGroup, offerCard as radioOfferCard } from "../src/sim/radio.js";
import {
  need, demand, wantQty, available, sellPrice, buyPrice, gearSellPrice, gearBuyPrice, marketLists, refreshMarket, marketOf, marketBoard, priceTrend, WANT_NEED, SURPLUS_NEED,
} from "../src/sim/trade.js";
import { caravanSurplus } from "../src/sim/caravans.js";
import * as D from "../src/sim/diplomacy.js";
import * as J from "../src/sim/jobs.js";
import * as A from "../src/sim/alliance.js";

import { execFileSync, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
const DIGEST = process.argv[2] === "--digest"; // child process for the determinism check: prints one world's digest
const COLLAPSE = process.argv[2] === "--collapse"; // child process: one year with (on) or without (off) wars between groups
const seed = Number(process.argv[DIGEST || COLLAPSE ? 3 : 2] || 42);
const longDays = Number(process.argv[3] || 365);
// Twelve seeds: a year's collapses swing by ±2-4 groups a seed either way (new gangs come and go), so six seeds
// (the old default) failed the +0.15 band on code changes far from the wars (0.26 → 0.42 at 5d2be6a, with seed 6
// alone 2 → 9), while seeds 1–12 give +0.06 there and on 07778af. The years run 4 at a time.
// Twelve seeds are still noisy (fix-wood-diplo, seeds 1–48 in fresh processes): the gap per seed has a spread of
// ~0.17–0.20 a group-year, so twelve seeds' gap has a standard error of ~0.05. At 3f692ed seeds 1–12 read +0.16 (a
// fail of the fixed +0.15 band) while 1–48 read +0.11 ± 0.03; a8fbc7d (before the winter, job-cap and combat merges)
// +0.02 ± 0.03, 3f692ed with a8fbc7d's combat +0.07 ± 0.03: a code change anywhere reshuffles the world's dice, the
// collapses are the same kinds in all three (hordes and outsiders' raids, decline; a war raid alone never takes a
// group under DIPLO.MIN_POP), so the true gap sits around +0.07–0.11, under the band, and a fixed +0.15 failed about
// one run in five. So the band is COLLAPSE_BAND.gap (the most wars may add) plus COLLAPSE_BAND.se standard errors
// measured from this run's own seeds (~+0.23–0.26 at twelve): a false alarm about one run in a hundred at a true +0.11,
// while a true +0.30 (wars more than doubling the rate) still fails about nine runs in ten.
const COLLAPSE_BAND = { gap: 0.15, se: 1.5 };
const collapseSeeds = (process.argv[4] || "1,2,3,4,5,6,7,8,9,10,11,12").split(",").map(Number).filter(Number.isFinite);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; return st; };
const pick = (card, re) => card.choices.find((c) => re.test(c.label));
const off = (state, c) => (typeof c.disabled === "function" ? c.disabled(state) : !!c.disabled);
const landTile = (state, t) => state.tiles[t].terrain !== "water" && state.tiles[t].terrain !== "mountain";
const free = (state, t) => landTile(state, t) && !state.factions.some((f) => f.bases.includes(t)) && !state.bases.some((b) => b.tile === t);

// A world ready for diplomacy: a radio at the hub, every group known, the first few groups' main bases moved
// into radio reach of the hub (a base each), peaceful types where a test needs them.
function setup(s = seed) {
  const st = world(s);
  const h = hub(st);
  addBuilding(h, "radio");
  h.radio = true;
  Object.assign(h.stock, { food: 500, water: 200, meds: 80, ammo: 600, scrap: 200, fuel: 60, parts: 10 });
  const g = st.grid;
  const spots = g.within(h.tile, 7).filter((t) => g.distance(t, h.tile) >= 4 && free(st, t) && planPath(st, t, h.tile, false));
  const live = st.factions.filter((f) => f.alive);
  live.forEach((f, i) => { f.known = true; const t = spots[i * 4]; if (t != null) f.bases.unshift(t); });
  recomputeOwnership(st);
  D.ensureDiplo(st);
  st.cards.length = 0;
  return st;
}
// A team of yours standing on a tile (launched from the hub, then put there).
function team(st, tile, n = 2) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, n).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: ids, dest: tile, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } });
  if (res.error) throw new Error(`team: ${res.error}`);
  place(res.party, tile);
  return res.party;
}
// Back home at once (removeParty alone would leave them nowhere).
function drop(st, p) {
  for (const id of p.members) { const s = st.survivors.find((x) => x.id === id); if (s && s.alive) s.location = { kind: "base", baseId: hub(st).id }; }
  removeParty(st, p);
}
const place = (p, tile) => { p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.dest = tile; p.orders = []; };
const clearCards = (st) => { st.cards.length = 0; };
// A job of this type from f (an offer of that type already open is withdrawn first).
const jobFor = (st, f, type) => {
  for (const j of J.ensureJobs(st).list) if (j.fid === f.id && j.type === type && j.status === "offered") j.status = "expired";
  const j = J.makeJob(st, f, "radio", type);
  clearCards(st);
  return j;
};
const nearTile = (st, from, dmin, dmax) => st.grid.within(from, dmax).find((t) => st.grid.distance(t, from) >= dmin && free(st, t) && planPath(st, from, t, false));

// Ids are handed out by one counter for the whole process: compare by each group's place in the list.
const digest = (st) => {
  const ix = (id) => st.factions.findIndex((f) => f.id === id);
  const live = st.factions;
  return JSON.stringify({
    rel: live.map((a) => live.map((b) => Math.round(D.relation(st, a, b) * 1000))), wars: st.diplo.wars.map((w) => [ix(w.a), ix(w.b), w.start, w.score[w.a], w.score[w.b]]),
    ended: st.diplo.ended.map((e) => [ix(e.a), ix(e.b), e.end, e.terms]), stats: st.diplo.stats,
    jobs: st.jobs.stats, list: st.jobs.list.map((j) => [j.type, ix(j.fid), j.status]), members: st.alliance.members.map(ix), pop: st.factions.map((f) => [f.pop, f.bases]),
    market: st.factions.map((f) => f.market && f.market.prices),
  });
};
const run = (days, s = seed) => {
  const st = world(s);
  addBuilding(hub(st), "radio");
  setAutopilot(st, true, "balanced");
  while (day(st) <= days && !st.gameOver) tickHour(st);
  return st;
};
if (COLLAPSE) {
  const st = world(seed);
  st.noWars = process.argv[4] === "off";
  setAutopilot(st, true, "balanced");
  const died = {};
  while (day(st) <= 365 && !st.gameOver) {
    tickHour(st);
    if (st.hour % 24 === 0) for (const f of st.factions) if (!f.alive && !f.brokenByYou && died[f.id] == null) died[f.id] = day(st); // groups the autopilot conquered (conquest.js) are not the wars' doing
  }
  process.stdout.write(JSON.stringify({ end: day(st), died: Object.values(died), stats: st.diplo.stats, gone: st.diplo.ended.filter((e) => e.terms === "none").length }));
  process.exit(0);
}
if (DIGEST) {
  process.stdout.write(digest(run(90)));
  process.exit(0);
}

// ======================================================================================
section("Jobs: every type");
{
  const st = setup();
  const h = hub(st);
  const f = st.factions.filter((x) => x.alive)[0];
  f.type = "traders"; f.goodwill = 40; f.pop = 30;
  const g = st.grid;
  // horde: a horde near their base.
  const ht = nearTile(st, f.bases[0], 2, 4);
  const hd = makeHorde(st, { tile: ht, size: 80, role: "roam" });
  const jh = jobFor(st, f, "horde");
  check(jh && jh.type === "horde" && jh.data.hordeId === hd.id && jh.status === "offered" && jh.deadline == null, "a horde job is offered for the horde near them");
  check(jh && jh.reward.goodwill === 6 + 4 * jh.size, "reward goodwill 6 + 4 × size");
  const day0 = day(st);
  check(J.acceptJob(st, jh.id).startsWith("Job accepted") && jh.status === "active" && jh.deadline === day0 + J.JOB_TYPES.horde.days, "accepting sets the deadline (12 days)");
  const gw0 = f.goodwill;
  const p = team(st, g.neighbors(hd.tile).find((t) => landTile(st, t)) ?? hd.tile);
  J.jobsHour(st);
  check(jh.engaged && jh.status === "active", "a team within 1 tile engages the horde (not done while it is whole)");
  hd.size = 30;
  J.jobsHour(st);
  check(jh.status === "done" && f.goodwill > gw0, `horde cut to 40%: done, goodwill ${Math.round(gw0)} → ${Math.round(f.goodwill)}`);
  // void: a horde that is gone before you got there.
  const hd2 = makeHorde(st, { tile: nearTile(st, f.bases[0], 3, 5), size: 60, role: "roam" });
  st.hordes = st.hordes.filter((x) => x !== hd && x.id !== hd2.id || x === hd2);
  const jv = jobFor(st, f, "horde");
  if (jv) {
    J.acceptJob(st, jv.id);
    drop(st, p);
    st.hordes.splice(st.hordes.findIndex((x) => x.id === jv.data.hordeId), 1);
    const before = f.goodwill;
    J.jobsHour(st);
    check(jv.status === "void" && f.goodwill === before, "a horde gone before your team got there: called off, no goodwill lost");
  } else check(false, "second horde job");

  // deliver: by a team at their base, and fetched by their caravan.
  f.stock.meds = 0;
  refreshMarket(st, f);
  const jd = jobFor(st, f, "deliver");
  check(jd && jd.type === "deliver" && marketOf(st, f).wants.some((w) => w.key === jd.data.key) && jd.data.qty >= 1, `deliver asks for something on their wants list (${jd && jd.data.qty} ${jd && jd.data.key})`);
  J.acceptJob(st, jd.id);
  const pd = team(st, f.bases[0]);
  pd.supplies[jd.data.key] = Math.ceil(jd.data.qty / 2);
  J.jobsHour(st);
  check(jd.data.left === jd.data.qty - Math.ceil(jd.data.qty / 2) && jd.status === "active", `a team at their base hands over what it carries (${jd.data.qty - jd.data.left} of ${jd.data.qty})`);
  drop(st, pd);
  check(J.pickupProblem(st, jd) === "", `they can fetch the rest (${J.pickupProblem(st, jd) || "ok"})`);
  h.stock[jd.data.key] = jd.data.left + 5;
  const msg = J.requestPickup(st, jd.id);
  check(st.parties.some((q) => q.pickupJob === jd.id), `their caravan sets out to fetch it: ${msg}`);
  for (let i = 0; i < 24 * 20 && jd.status === "active"; i++) { tickHour(st); clearCards(st); if (st.trade) st.trade = null; }
  check(jd.status === "done", `the caravan fetched the rest from the hub (status ${jd.status}, ${jd.why || ""})`);

  // scout: reports newer than the job count; shared sightings do not.
  const js = jobFor(st, f, "scout");
  check(js && js.data.r === 2, `a scout job: a region of radius 2 (${js ? js.type : J.ensureJobs(st).list.filter((j) => j.fid === f.id).map((j) => j.type + ":" + j.status).join(" ")})`);
  if (js) {
    J.acceptJob(st, js.id);
    const tiles = g.within(js.data.center, js.data.r);
    for (const t of tiles) { const sn = snapshot(st, t); sn.via = "ally"; st.knowledge[t] = sn; }
    J.jobsHour(st);
    check(js.status === "active", "coalition reports do not scout it for you");
    st.hour += 1;
    for (const t of tiles.slice(0, Math.ceil(tiles.length * 0.7))) st.knowledge[t] = snapshot(st, t);
    J.jobsHour(st);
    check(js.status === "done", `70% of the region on your map from new reports: done (${js.data.seen}/${js.data.total})`);
  }

  // retrieve: picked up, carried to their base; lost with a wiped team it lies where they fell.
  const jr = jobFor(st, f, "retrieve");
  check(jr && jr.data.site != null && J.jobTile(st, jr) === jr.data.site, "a retrieve job points at its site");
  if (jr) {
    J.acceptJob(st, jr.id);
    const pr = team(st, jr.data.site);
    J.jobsHour(st);
    check(jr.data.carrier === pr.id && J.jobTile(st, jr) === f.bases[0], "your team picks it up; the job now points at their base");
    place(pr, nearTile(st, f.bases[0], 1, 2));
    J.jobsHour(st);
    const mid = partyTile(pr);
    for (const id of pr.members) { const s = st.survivors.find((x) => x.id === id); s.alive = false; }
    removeParty(st, pr);
    J.jobsHour(st);
    check(jr.data.carrier == null && jr.data.site === mid, "the team lost with it: it lies where they were");
    const pr2 = team(st, jr.data.site);
    J.jobsHour(st);
    place(pr2, f.bases[0]);
    J.jobsHour(st);
    check(jr.status === "done", "carried to their base: done");
    drop(st, pr2);
  }

  // hive: their fighters join; done when it falls with your team there.
  ensureHives(st);
  const hv = st.hives[0];
  const near = nearTile(st, hv.tile, 3, 6);
  f.bases.unshift(near);
  const jhv = jobFor(st, f, "hive");
  check(jhv && jhv.data.hiveId === hv.id, "a hive job for the hive near them");
  if (jhv) {
    J.acceptJob(st, jhv.id);
    const al = A.hiveAllies(st, hv);
    check(al.fighters >= 1 && al.names.some((n) => n.startsWith(f.name)), `their fighters join the assault (${al.names.join(", ")})`);
    check(A.broodAfterAllies(18, 3) === 15 && A.broodAfterAllies(10, 9) === 6, "each ally keeps one of the brood off your squad (40% at most, 6 left at least)");
    const ph = team(st, g.neighbors(hv.tile).find((t) => landTile(st, t)) ?? hv.tile);
    J.jobsHour(st);
    destroyHive(st, hv, "by your team");
    st.gameOver = false; st.victory = false;
    J.jobsHour(st);
    check(jhv.status === "done", "the hive fell with your squad there: done");
    drop(st, ph);
  }
  f.bases.shift();

  // rescue: their people held by their war enemy; pay them out at the holders' gates.
  const foe = st.factions.find((x) => x.alive && x !== f);
  const war = D.startWar(st, foe, f, "land");
  clearCards(st);
  war.captives[f.id] = 3;
  const pop0 = f.pop;
  const jre = jobFor(st, f, "rescue");
  check(jre && jre.data.holder === foe.id && jre.data.count === 3 && war.captives[f.id] === 0, "a rescue job for the 3 held by their enemy");
  if (jre) {
    J.acceptJob(st, jre.id);
    const pre = team(st, foe.bases[0]);
    pre.supplies.ammo = 500;
    J.jobsHour(st);
    const card = st.cards.find((c) => c.rescueJob === jre.id);
    check(!!card && !!pick(card, /^Storm/) && !!pick(card, /^Talk/) && !!pick(card, /^Pay/), "the team at their gates gets a card: storm, talk or pay");
    if (card) { pick(card, /^Pay/).resolve(st); st.cards.splice(st.cards.indexOf(card), 1); }
    check(jre.status === "done" && f.pop === pop0 + 3, `paid out: done, ${f.name} has its 3 people back`);
    drop(st, pre);
  }
  D.makePeace(st, war);
  clearCards(st);

  // escort: the caravan leaves when your team is there and arrives with your team alongside.
  const others = st.factions.filter((x) => x.alive && x !== f && !x.atWar);
  const dest = others.find((o) => { const d = g.distance(f.bases[0], o.bases[0]); return d >= 6 && d <= 22 && planPath(st, f.bases[0], o.bases[0], false); });
  if (dest) {
    D.changeRelation(st, f, dest, 50);
    let je = null;
    for (let i = 0; i < 10 && !je; i++) { je = jobFor(st, f, "escort"); if (je && je.data.to !== dest.id) { je.status = "declined"; je = null; } }
    check(!!je, "an escort job");
    if (je) {
      J.acceptJob(st, je.id);
      const pe = team(st, f.bases[0]);
      J.jobsHour(st);
      const c = st.parties.find((q) => q.id === je.data.caravanId);
      check(c && c.escortJob === je.id && je.data.stage === "moving", "the caravan sets out once your team is at their base");
      check(J.caravanGuarded(st, c), "raiders leave it alone while your team is within 2 tiles");
      for (let i = 0; i < 24 * 15 && je.status === "active"; i++) {
        const cv = st.parties.find((q) => q.id === je.data.caravanId);
        if (cv) place(pe, partyTile(cv));
        tickHour(st); clearCards(st); if (st.trade) st.trade = null;
      }
      check(je.status === "done", `escorted all the way: done (${je.data.near}/${je.data.road} hours alongside; ${je.why || ""})`);
      drop(st, pe);
      // Not alongside: it fails on arrival.
      const je2 = jobFor(st, f, "escort");
      if (je2) {
        J.acceptJob(st, je2.id);
        const pe2 = team(st, f.bases[0]);
        J.jobsHour(st);
        const far = st.tiles.filter((t) => landTile(st, t.id)).sort((x, y) => Math.min(g.distance(y.id, f.bases[0]), g.distance(y.id, dest.bases[0])) - Math.min(g.distance(x.id, f.bases[0]), g.distance(x.id, dest.bases[0])))[0].id;
        place(pe2, far);
        for (let i = 0; i < 24 * 15 && je2.status === "active"; i++) { tickHour(st); clearCards(st); if (st.trade) st.trade = null; }
        check(je2.status === "failed", `left alone on the road: failed (${je2.why || je2.status}; ${je2.data.near}/${je2.data.road}, team at ${partyTile(pe2)}, teams ${st.parties.filter((q) => q.owner === "player").length})`);
      }
    }
  } else console.log("  (no group at escort distance on this seed: escort skipped)");

  // Deadlines, offers that expire, declining.
  const f2 = st.factions.filter((x) => x.alive && x !== f)[1];
  f2.known = true; f2.goodwill = 30;
  const jx = J.makeJob(st, f2, "radio") || jobFor(st, f2, "scout");
  clearCards(st);
  const quiet = (keep) => { for (const j of J.ensureJobs(st).list) if (j !== keep && (j.status === "offered" || j.status === "active")) j.status = "declined"; };
  if (jx) {
    J.acceptJob(st, jx.id);
    quiet(jx);
    const gwx = f2.goodwill;
    st.hour = (jx.deadline + 1) * 24;
    J.jobsDaily(st);
    clearCards(st);
    check(jx.status === "failed" && Math.round(gwx - f2.goodwill) === (jx.size <= 1 ? 2 : 4), `missed deadline: failed, −${jx.size <= 1 ? 2 : 4} goodwill (${Math.round(gwx)} → ${Math.round(f2.goodwill)})`);
  }
  const jo = J.makeJob(st, f2, "radio");
  clearCards(st);
  if (jo) {
    quiet(jo);
    const gwo = f2.goodwill;
    st.hour = (jo.expires + 1) * 24;
    J.jobsDaily(st);
    clearCards(st);
    check(jo.status === "expired" && Math.round(gwo - f2.goodwill) === 1, "an offer left unanswered expires: −1 goodwill");
  }
  const jdc = J.makeJob(st, f2, "radio");
  clearCards(st);
  if (jdc) { const g0 = f2.goodwill; J.declineJob(st, jdc.id); check(jdc.status === "declined" && Math.round(g0 - f2.goodwill) === 1, "declining: −1 goodwill"); }

  // Rewards: supplies from their stock to the hub, gear to the armory, an outpost handed over.
  const f3 = st.factions.filter((x) => x.alive)[2];
  f3.known = true;
  while (f3.bases.length < 2) { const t = nearTile(st, f3.bases[0], 2, 4); f3.bases.push(t); }
  const jw = { id: 9999, type: "scout", fid: f3.id, status: "active", data: {}, size: 3, title: "test", desc: "", target: f3.bases[0],
    reward: { goodwill: 18, supplies: { food: 10 }, gear: ["vest"], blueprint: true, recruits: 1, intel: true, outpost: f3.bases[1] } };
  J.ensureJobs(st).list.push(jw);
  const food0 = h.stock.food, arm0 = h.armory.length, bases0 = st.bases.length, gw3 = f3.goodwill;
  f3.stock.food = Math.max(f3.stock.food, 50);
  J.completeJob(st, jw, "test");
  const bp = h.armory.slice(arm0).find((it) => GEAR[it.key] && GEAR[it.key].blueprint);
  check(h.stock.food === food0 + 10 && h.armory.length >= arm0 + 1 && st.bases.length === bases0 + 1 && f3.goodwill > gw3, "rewards: supplies to the hub, gear to the armory, their outpost handed over with goodwill");
  check(!J.blueprintKeys().length || !!bp || h.stock.ammo >= 40, `a blueprint reward: ${bp ? bp.name : "none left to give (ammo instead)"}`);
  check(st.cards.some((c) => c.recruit || /send people/.test(c.title)), "a recruit reward comes as a recruit card");
  check(J.blueprintKeys().every((k) => GEAR[k]), `blueprint rewards come from GEAR (${J.blueprintKeys().length} blueprint item(s) in this build)`);
  clearCards(st);
}

// ======================================================================================
section("Relations between groups, pacts and wars");
{
  const st = setup();
  const live = st.factions.filter((f) => f.alive);
  let bad = 0;
  for (const a of live) for (const b of live) {
    const r = D.relation(st, a, b);
    if (!Number.isFinite(r) || r < -100 || r > 100 || r !== D.relation(st, b, a)) bad++;
  }
  check(bad === 0, "one number per pair, the same both ways, −100..100");
  const raider = live.find((f) => f.type === "raider");
  const peaceful = live.filter((f) => f.type === "traders" || f.type === "commune");
  if (raider && peaceful.length) check(D.restingRel(st, raider, peaceful[0]) < 0, "a raider gang and a peaceful group start apart");
  const [a, b] = live.filter((f) => f !== raider);
  a.type = "commune"; b.type = "traders";
  check(D.restingRel(st, a, b) > D.restingRel(st, raider || a, b), "traders and a commune rest closer than a raider gang");
  // Drift toward the resting value.
  st.diplo.rel[`${Math.min(a.id, b.id)}|${Math.max(a.id, b.id)}`] = -90;
  const r0 = D.relation(st, a, b);
  for (let i = 0; i < 30; i++) { st.hour += 24; D.diplomacyDaily(st); clearCards(st); }
  check(D.relation(st, a, b) > r0 + 20, `relations drift back toward their resting value (${Math.round(r0)} → ${Math.round(D.relation(st, a, b))})`);
  // A pact at 28+.
  D.changeRelation(st, a, b, 200);
  for (let i = 0; i < 120 && !D.pactBetween(st, a, b); i++) { st.hour += 24; D.diplomacyDaily(st); clearCards(st); }
  check(D.pactBetween(st, a, b), "two groups that like each other sign a pact");
  // War: flags, war raids, a raid that takes a base, captives, the floor of 6 people.
  const atk = live.find((f) => f !== a && f !== b);
  atk.pop = 40;
  b.pop = 20;
  while (b.bases.length < 3) b.bases.push(nearTile(st, b.bases[0], 2, 5));
  const w = D.startWar(st, atk, b, "land");
  clearCards(st);
  check(w && atk.atWar === 1 && b.atWar === 1 && D.warBetween(st, atk, b) === w, "war declared: both at war");
  check(!D.pactBetween(st, atk, b) && D.relation(st, atk, b) <= 100, "no pact between enemies");
  const rp = D.warRaid(st, w, atk, b);
  check(rp && rp.warId === w.id && rp.kind === "raid" && rp.target.factionId === b.id, "a war raid marches on the enemy");
  if (rp) removeParty(st, rp);
  let took = false, minPop = b.pop;
  for (let i = 0; i < 40 && !took; i++) {
    const tile = b.bases[b.bases.length - 1];
    const party = { owner: atk.id, kind: "raid", strength: 1e6, target: { kind: "faction", factionId: b.id, tile }, warId: w.id };
    resolveRaidOnFaction(st, party, []);
    minPop = Math.min(minPop, b.pop);
    took = atk.bases.includes(tile);
  }
  check(took, "a won war raid can take a secondary base (territory changes hands)");
  check(minPop >= D.DIPLO.MIN_POP, `war raids never take a group below ${D.DIPLO.MIN_POP} people (lowest ${minPop})`);
  check(st.tiles[atk.bases[atk.bases.length - 1]].owner === atk.id, "the land around a taken base follows at once");
  // Peace terms.
  w.captives[b.id] = 2;
  const popB = b.pop;
  w.score[atk.id] = 12; w.score[b.id] = 0;
  while (b.bases.length < 2) b.bases.push(nearTile(st, b.bases[0], 2, 5));
  const nb = b.bases.length;
  const terms = D.makePeace(st, w);
  check(terms === "land" && b.bases.length === nb - 1, `a big lead and 2+ bases: the loser cedes land (${terms})`);
  check(b.pop === popB + 2 && !atk.atWar && !b.atWar, "captives go home with the peace; nobody is at war any more");
  check(D.relation(st, atk, b) >= -15, "peace leaves them wary (−15), not at each other's throats");
  const w2 = D.startWar(st, atk, b, "resources");
  clearCards(st);
  w2.score[atk.id] = 3; w2.score[b.id] = 0;
  const foodB = b.stock.food, foodA = atk.stock.food;
  check(D.makePeace(st, w2) === "tribute" && b.stock.food < foodB && atk.stock.food > foodA, "a small lead: the loser pays tribute (25% of food, ammo, meds, scrap)");
  const w3 = D.startWar(st, atk, b, "land");
  clearCards(st);
  check(D.makePeace(st, w3) === "white", "no lead: a white peace");
  check(st.diplo.ended.length >= 3 && st.diplo.stats.peace >= 3, "ended wars are on record");

  // Trade at war.
  const t = b;
  t.stock.ammo = t.pop * 12; t.stock.meds = t.pop * 1.2;
  t.atWar = 0;
  const avPeace = available(t, "ammo"), sp = sellPrice(st, t, "ammo", 5, 10), gp = gearSellPrice(st, t, newItem("shotgun"), 5);
  t.atWar = 1;
  check(available(t, "ammo") < avPeace, `at war they have less ammo to trade (${avPeace} → ${available(t, "ammo")})`);
  check(Math.abs(sellPrice(st, t, "ammo", 5, 10) / sp - 1.35) < 1e-9, "at war they pay 35% more for ammo");
  check(Math.abs(gearSellPrice(st, t, newItem("shotgun"), 5) / gp - 1.3) < 1e-9, "and 30% more for weapons");
  let loses = true;
  for (const k of SUPPLY_KEYS) for (const sp2 of [0, 10, 20]) for (const gw of [-100, 0, 100]) {
    t.goodwill = gw;
    if (buyPrice(st, t, k, sp2, 5) <= sellPrice(st, t, k, sp2, 5)) loses = false;
    const it = newItem("ar");
    if (gearBuyPrice(st, t, it, sp2) <= gearSellPrice(st, t, it, sp2)) loses = false;
  }
  check(loses, "at war, buying back what you sold still loses (every good, Speech 0–20, goodwill −100..100)");
  t.atWar = 0;
}

// ======================================================================================
section("Brokering a ceasefire, joining a war");
{
  const st = setup();
  const live = st.factions.filter((f) => f.alive && canRadioGroup(st, f));
  check(live.length >= 2, `two groups in radio reach (${live.length})`);
  const [a, b] = live;
  a.goodwill = 30; b.goodwill = 30;
  const w = D.startWar(st, a, b, "land");
  clearCards(st);
  const info = D.brokerInfo(st, w);
  check(info.ok && info.chance > 0.05 && info.chance <= 0.9, `you can broker it (${Math.round(info.chance * 100)}%)`);
  const realChance = st.rng.chance;
  st.rng.chance = () => false;
  const ga = a.goodwill;
  const fail = D.brokerCeasefire(st, w.id);
  check(D.warById(st, w.id) && Math.round(ga - a.goodwill) === 3, `failed talks: −3 goodwill with both (${fail.slice(0, 40)}…)`);
  check(!D.brokerInfo(st, w).ok && /day/.test(D.brokerInfo(st, w).why), "not again for a week");
  w.brokerDay = -99;
  st.rng.chance = () => true;
  const hubFood = Object.values(hub(st).stock).reduce((x, y) => x + y, 0);
  const gb = b.goodwill;
  const okText = D.brokerCeasefire(st, w.id);
  st.rng.chance = realChance;
  check(!D.warById(st, w.id) && b.goodwill >= gb + 8 - 1e-9 && st.diplo.stats.brokered === 1, `ceasefire: the war ends, +8 goodwill with both (${okText.slice(0, 50)}…)`);
  check(Object.values(hub(st).stock).reduce((x, y) => x + y, 0) > hubFood, "and they thank you with supplies");
  const hostile = D.startWar(st, a, b, "land");
  clearCards(st);
  b.goodwill = -60;
  check(!D.brokerInfo(st, hostile).ok, "no brokering with a side that is hostile to you");
  D.makePeace(st, hostile);
  // Joining.
  b.goodwill = 30; a.goodwill = 10;
  const w2 = D.startWar(st, a, b, "land");
  clearCards(st);
  check(D.joinProblem(st, w2, b) === "", "you can join a war beside a group that trusts you");
  D.joinWar(st, w2.id, b.id);
  check(w2.playerSide === b.id && attitude(a) === "Hostile" && a.goodwill <= -60 && b.goodwill >= 40 - 1e-9, "joined: the enemy turns hostile, your side +10 goodwill");
  let mine = 0;
  for (let i = 0; i < 40; i++) { const p = D.warRaid(st, w2, a, b); if (p) { if (p.target.kind === "player") mine++; removeParty(st, p); } }
  check(mine > 0, `the enemy's war raids now come for your bases too (${mine} of 40)`);
  w2.score[b.id] = 10; w2.score[a.id] = 0;
  const ammo0 = hub(st).stock.ammo;
  a.stock.ammo = 400;
  while (a.bases.length < 2) a.bases.push(nearTile(st, a.bases[0], 2, 4));
  const tiles = [...a.bases];
  const terms = D.makePeace(st, w2);
  const freed = tiles.find((t) => !a.bases.includes(t));
  if (terms === "land") check(freed != null && D.reservedForYou(st, freed) && !b.bases.includes(freed), "your side won land: it is left free for your outpost (reserved from the groups)");
  else check(hub(st).stock.ammo > ammo0, "your side won tribute: half of it reaches the hub");
  check(attitude(a) !== "Hostile", "after the peace the enemy is wary, no longer hostile");
  // Selling arms to one side costs a little with the other (3 a day at most).
  const w3 = D.startWar(st, a, b, "land");
  clearCards(st);
  a.goodwill = 20; b.goodwill = 20;
  for (let i = 0; i < 5; i++) D.armsSold(st, a, 50, false);
  check(Math.round(20 - b.goodwill) === 3, "arming one side: −1 a deal with the other, 3 a day at most");
  D.makePeace(st, w3);
}

// ======================================================================================
section("The coalition");
{
  const st = setup();
  const h = hub(st);
  const live = st.factions.filter((f) => f.alive && canRadioGroup(st, f));
  const [a, b, c] = live;
  a.goodwill = 30; a.pact = null;
  check(/goodwill/.test(A.inviteProblem(st, a)), "invite: needs goodwill 50 first");
  a.goodwill = 60;
  check(/pact/.test(A.inviteProblem(st, a)), "then a pact");
  a.pact = "nonaggression";
  check(/job/.test(A.inviteProblem(st, a)), "then a job done for them (no council yet)");
  J.ensureJobs(st).list.push({ id: 7001, fid: a.id, type: "scout", status: "done", endDay: day(st), data: {}, reward: { goodwill: 0, supplies: {}, gear: [] }, title: "x", desc: "", target: a.bases[0] });
  check(A.inviteProblem(st, a) === "", "now they can be invited");
  A.inviteToAlliance(st, a);
  check(A.isMember(st, a) && st.alliance.founded === day(st), "a joins the coalition");
  // The council's vote stands in for the job.
  b.goodwill = 60; b.pact = "trade";
  D.changeRelation(st, a, b, 100);
  check(A.councilVote(st, b).passes && A.inviteProblem(st, b) === "", "the council votes b in without a job");
  A.inviteToAlliance(st, b);
  c.goodwill = 60; c.pact = "trade";
  D.changeRelation(st, a, c, -200); D.changeRelation(st, b, c, -200);
  check(!A.councilVote(st, c).passes && /job|vote/.test(A.inviteProblem(st, c)), "the council votes c down");
  // Members share what they see.
  const ht = nearTile(st, a.bases[0], 3, 8);
  const hd = makeHorde(st, { tile: ht, size: 50, role: "roam" });
  st.knowledge[ht] = null;
  st.hour += 24;
  A.allianceDaily(st);
  clearCards(st);
  check(st.knowledge[ht] && st.knowledge[ht].hordeSize >= 50 && st.knowledge[ht].via === "ally", "members report the hordes near them");
  // Help against raids and hordes.
  const help = A.allianceRaidHelp(st, h, null);
  check(help.power > 0 && help.names.includes(a.name), `members within 20 tiles send fighters against a raid (+${Math.round(help.power)} defence)`);
  const att = makeHorde(st, { tile: nearTile(st, h.tile, 3, 5), size: 200, role: "attack", goal: { tile: h.tile, baseId: h.id } });
  st.hour += 24;
  A.allianceDaily(st);
  clearCards(st);
  check(att.size <= 170 && att.allyHarried, `a horde heading for your base is harried on the way (200 → ${att.size})`);
  // Hive assaults.
  ensureHives(st);
  const hv = st.hives[0];
  a.bases.push(nearTile(st, hv.tile, 4, 8));
  check(A.hiveAllies(st, hv).fighters >= 1, "members near a hive send fighters to your assault");
  a.bases.pop();
  // The council: supplies, a job, a ruling.
  const sup = A.councilCard(st, "supplies", [a, b]) || (() => { a.stock.food = 0; return A.councilCard(st, "supplies", [a, b]); })();
  if (check(!!sup, "the council asks for supplies")) {
    const before = { ...h.stock }, ga = a.goodwill, gb = b.goodwill;
    const send = pick(sup, /^Send/);
    send.resolve(st);
    check(Object.keys(before).some((k) => h.stock[k] < before[k]) && (a.goodwill > ga || b.goodwill > gb), "sending: the hub pays, members are pleased");
    const sup2 = A.councilCard(st, "supplies", [a, b]);
    if (sup2) { const g2 = a.goodwill; pick(sup2, /^Refuse/).resolve(st); check(Math.round(g2 - a.goodwill) === 4, "refusing: −4 with every member"); }
  }
  const jc = A.councilCard(st, "job", [a, b]);
  check(jc && jc.council === "job" && jc.jobId && !pick(jc, /^Maybe later/), "the council asks you to take a job (accept or refuse)");
  const rl = A.councilCard(st, "ruling", [a, b]);
  if (check(rl && rl.choices.length === 3, "the council asks for a ruling between two members")) {
    const [x, y] = [a, b].sort((p, q) => (rl.choices[0].label.includes(p.name) ? -1 : 1));
    const gx = x.goodwill, gy = y.goodwill, r0 = D.relation(st, x, y);
    rl.choices[0].resolve(st);
    check(x.goodwill > gx && y.goodwill < gy && D.relation(st, x, y) < r0, "siding with one: +6 with it, −8 with the other, and they fall out");
  }
  clearCards(st);
  // The seasonal council meets on day 43.
  st.hour = 42 * 24;
  st.alliance.lastCouncil = null;
  A.allianceDaily(st);
  check(st.cards.some((c) => c.council) || st.alliance.history.some((x) => /council/i.test(x.text)), "the council meets at the start of the season");
  clearCards(st);
  // A member that no longer trusts you leaves.
  b.goodwill = 10;
  A.allianceDaily(st);
  clearCards(st);
  check(!A.isMember(st, b), "a member below goodwill 20 leaves");
  // A qualifying group asks to join (card) and the autopilot welcomes it.
  b.goodwill = 70;
  const realD = D.diploRng(st).chance;
  D.diploRng(st).chance = () => true;
  st.alliance.lastAsk = {};
  A.allianceDaily(st);
  D.diploRng(st).chance = realD;
  const ask = st.cards.find((x) => x.allianceAsk === b.id);
  check(!!ask, "a group that qualifies asks to join");
  if (ask) { const best = [...ask.choices].sort((p, q) => q.ai(st) - p.ai(st))[0]; check(/Welcome/.test(best.label), "the autopilot welcomes it"); }
  clearCards(st);
}

// ======================================================================================
section("Radio reach for the coalition (alliance.js reachVia): radio, a team at the gates, a member, a base next door");
{
  const st = setup();
  const h = hub(st);
  const g = st.grid;
  const f = st.factions.find((x) => x.alive && canRadioGroup(st, x));
  check(A.reachVia(st, f) === "radio", "a group within the station's coverage + 6: in reach by radio");
  const far = g.within(h.tile, 40).find((t) => g.distance(t, h.tile) >= 30 && free(st, t) && planPath(st, h.tile, t, false) &&
    st.factions.every((x) => x === f || x.bases.every((b) => g.distance(b, t) > 14)));
  if (check(far != null, "a spot 30+ tiles out with no group near it")) {
    const saved = f.bases.slice();
    f.bases.length = 0; f.bases.push(far);
    const why = A.inviteProblem(st, f);
    check(A.reachVia(st, f) === "" && /out of radio reach \(bring their base within 6 tiles of your radio coverage \(a station reaches 12 tiles, each linked relay 6 more/.test(why),
      `30+ tiles out: out of radio reach, and the line says what coverage (stations, relays) would take ("${why}")`);
    const p = team(st, far);
    check(A.reachVia(st, f) === "gates", "a team of yours at their gates: in reach");
    drop(st, p);
    const m = st.factions.find((x) => x.alive && x !== f);
    const mSaved = m.bases.slice();
    m.bases.push(g.within(far, 10).find((t) => g.distance(t, far) >= 9 && free(st, t)));
    A.ensureAlliance(st).members.push(m.id);
    check(A.reachVia(st, f) === "member", "a member with a base within 12 tiles of theirs: in reach");
    st.alliance.members = st.alliance.members.filter((id) => id !== m.id);
    m.bases.length = 0; m.bases.push(...mSaved);
    const o = { id: newId(), tile: g.within(far, 8).find((t) => g.distance(t, far) >= 6 && free(st, t)), type: "outpost", name: "Fence Post", stock: {}, buildings: [], construction: [], armory: [], radio: false, watchtower: false };
    st.bases.push(o);
    check(A.reachVia(st, f) === "neighbour", "a base of yours within 8 tiles of theirs: in reach (over the fence)");
    st.bases.splice(st.bases.indexOf(o), 1);
    f.bases.length = 0; f.bases.push(...saved);
  }
}

// ======================================================================================
section("Alliance victory");
{
  const st = setup();
  st.erasOff = true; // the eras' clocks (no victory before year 6, the Accord held a year) are tools/eratest.js's; this checks the rule itself
  const live = st.factions.filter((f) => f.alive);
  const done = (f) => J.ensureJobs(st).list.push({ id: 6000 + f.id, fid: f.id, type: "scout", status: "done", endDay: day(st), data: {}, reward: { goodwill: 0, supplies: {}, gear: [] }, title: "x", desc: "", target: 0 });
  for (const f of live) { f.goodwill = 80; f.pact = "trade"; done(f); f.known = true; }
  for (const f of live.slice(0, -1)) { const r = A.inviteToAlliance(st, f); if (!A.isMember(st, f)) { f.bases.unshift(nearTile(st, hub(st).tile, 2, 7)); A.inviteToAlliance(st, f); } }
  const last = live[live.length - 1];
  const g0 = A.goalsProgress(st);
  console.log(`  start: land ${(g0.alliance.land.pct * 100).toFixed(1)}%, ${g0.alliance.members} of ${g0.alliance.groups} groups in, ${g0.hives.left} hives`);
  check(!A.allianceVictory(st), "not with hives standing, land under half and a group outside");
  st.hives.length = 0; st.hiveSites.length = 0;
  check(!A.allianceVictory(st), "not with no hives but land under half and a group outside");
  // More land: members spread out (test only).
  const ms = A.allianceMembers(st);
  let k = 0;
  for (const t of st.tiles) {
    if (A.controlledLand(st).pct > 0.55) break;
    if (t.terrain === "water" || (t.x + t.y * 3) % 11) continue;
    if (st.grid.distance(t.id, hub(st).tile) > 4 && free(st, t.id)) ms[k++ % ms.length].bases.push(t.id);
  }
  check(A.controlledLand(st).pct > 0.5 && A.allianceVictory(st), `land ${(A.controlledLand(st).pct * 100).toFixed(1)}% held with ${last.name} outside: the victory stands (groups outside no longer block it; members are enough)`);
  last.bases.unshift(nearTile(st, hub(st).tile, 2, 7));
  A.inviteToAlliance(st, last);
  check(A.isMember(st, last) && A.allianceVictory(st), "land over half, every group in, no hive: victory");
  st.hives.push({ id: 999, tile: 0, res: 0 });
  check(A.allianceVictory(st), "a hive still standing does not stop it (the coalition is its own victory)");
  st.hives.length = 0;
  st.hiveSites.push({ id: 1, tile: 5, started: 1, biomass: 10 });
  check(A.allianceVictory(st), "nor a hive being built");
  st.hiveSites.length = 0;
  // A collapsed group does not count against you.
  const outsider = st.factions.find((f) => f.alive && A.isMember(st, f));
  st.alliance.members = st.alliance.members.filter((id) => id !== outsider.id);
  check(A.allianceVictory(st) && A.allianceMembers(st).length > 0, "a living group outside the coalition no longer blocks the victory (members and land are what count)");
  outsider.alive = false; outsider.bases = [];
  check(A.allianceVictory(st) === (A.controlledLand(st).pct > 0.5), "a collapsed group does not count");
  st.alliance.members.push(outsider.id);
  outsider.alive = true;
  outsider.bases = [nearTile(st, hub(st).tile, 2, 7)];
  check(checkGameOver(st) && st.victory && st.victoryReason === "alliance" && st.log.some((l) => /^The Calder Coalition holds/.test(l.text)), "checkGameOver: the coalition's victory, with its reason");
  // Without the coalition, the same world is the hive victory.
  const st2 = setup();
  st2.erasOff = true;
  st2.hives.length = 0; st2.hiveSites.length = 0;
  check(checkGameOver(st2) && st2.victoryReason === "hives", "no coalition: destroying every hive is the hive victory");
  const gp = A.goalsProgress(st);
  check(gp.hives && gp.alliance && Number.isFinite(gp.alliance.land.pct) && gp.alliance.groups >= gp.alliance.members, "Goals progress has both victories");
}

// ======================================================================================
section("Wants and surplus, the market board");
{
  const st = setup();
  let bad = 0, nlists = 0;
  for (const f of st.factions.filter((x) => x.alive)) {
    f.stock.meds = 0; f.stock.food = f.pop * 20;
    const m = refreshMarket(st, f);
    nlists += m.wants.length + m.surplus.length;
    for (const k of SUPPLY_KEYS) {
      const n = demand(st, f, k); // stock, their kind and their state (trade.js)
      const w = m.wants.find((x) => x.key === k), s = m.surplus.find((x) => x.key === k);
      if ((n >= WANT_NEED) !== !!w) bad++;
      if ((n <= SURPLUS_NEED && available(f, k) >= 5) !== !!s) bad++;
      if (w && (w.qty !== wantQty(f, k) || w.qty < Math.ceil(({ food: 6, water: 5, fuel: 2, meds: 1, ammo: 10, parts: 0.5, scrap: 3, preserved: 2, jars: 1 }[k]) * f.pop - Math.max(0, f.stock[k] ?? 0)) || Math.abs(w.price - sellPrice(st, f, k, 0, { food: 20, water: 20, fuel: 10, meds: 6, ammo: 50, parts: 3, scrap: 20, preserved: 10, jars: 10 }[k])) > 1e-9)) bad++;
      if (s && s.qty !== available(f, k)) bad++;
    }
    if (!m.wants.some((x) => x.key === "meds") || !m.surplus.some((x) => x.key === "food")) bad++;
  }
  check(bad === 0, `every group's lists match its stock and need (${nlists} entries checked)`);
  const f = st.factions.find((x) => x.alive && canRadioGroup(st, x));
  f.stock.ammo = f.pop * 30;
  refreshMarket(st, f);
  f.stock.ammo = 0;
  refreshMarket(st, f);
  check(priceTrend(f, "ammo", "pay") === "up" && f.market.prev, "a price that rose since last week shows an arrow up");
  st.hour += 3 * 24;
  const old = f.market.day;
  D.diplomacyDaily(st); clearCards(st);
  check(f.market.day === old, "lists stay for the week");
  st.hour += 5 * 24;
  D.diplomacyDaily(st); clearCards(st);
  check(f.market.day > old, "and are made again after 7 days");
  // Radio offers and asked-for caravans use the lists.
  f.goodwill = 40;
  let okUse = true, n = 0;
  for (let i = 0; i < 20; i++) {
    const card = radioOfferCard(st, f);
    if (!card) continue;
    n++;
    const m = marketOf(st, f);
    const yes = card.choices[0].label;
    if (!m.surplus.some((x) => yes.includes(` ${x.key}`)) && !m.wants.some((x) => yes.includes(` ${x.key}`))) okUse = false;
  }
  check(okUse, `radio offers and requests come from their lists (${n} cards)`);
  const goods = caravanSurplus(st, f);
  const listed = marketOf(st, f).surplus.map((x) => x.key);
  check(!listed.length || Object.keys(goods.supplies).some((k) => listed.includes(k)), "a caravan you ask for brings their listed surplus");
  // The board.
  const rows = marketBoard(st, "meds", "sell");
  check(rows.length >= 2 && rows.every((r, i) => !i || rows[i - 1].pay >= r.pay - 1e-9), `the board sorts by what they pay (${rows.length} groups)`);
  const buy = marketBoard(st, "food", "buy");
  check(buy.every((r, i) => !i || buy[i - 1].ask <= r.ask + 1e-9), "and by what they charge");
  rows[0].f.goodwill = -80;
  check(!marketBoard(st, "meds", "sell").some((r) => r.f === rows[0].f), "hostile groups are not on the board");
}

// ======================================================================================
section("The autopilot's choices");
{
  const st = setup();
  st.governor = { personality: "cautious" };
  const live = st.factions.filter((f) => f.alive && canRadioGroup(st, f));
  const [a, b] = live;
  a.goodwill = 60; a.pact = "trade";
  const w = D.startWar(st, b, a, "land");
  const card = D.warCard(st, w, a, b);
  const best = (cd) => [...cd.choices].filter((c) => !off(st, c)).sort((p, q) => q.ai(st) - p.ai(st))[0];
  check(/Stay out/.test(best(card).label), "Cautious stays out of wars");
  st.governor.personality = "aggressive";
  a.pop = 80; b.pop = 10;
  check(/Join/.test(best(card).label), "Aggressive joins a war beside a much stronger friend");
  // Jobs: a delivery it can pay is taken; a hive job is not.
  a.stock.meds = 0; refreshMarket(st, a);
  const jd = J.makeJob(st, a, "radio", "deliver");
  clearCards(st);
  if (jd) check(/Accept/.test(best(J.offerCard(st, jd)).label), "a delivery the hub can spare: accepted");
  ensureHives(st);
  a.bases.unshift(nearTile(st, st.hives[0].tile, 3, 6));
  const jh = J.makeJob(st, a, "radio", "hive");
  clearCards(st);
  if (jh) check(!/Accept/.test(best(J.offerCard(st, jh)).label), "a hive job: not taken by the governor");
  // Aggressive sells ammo to a group at war; Balanced does not.
  const fake = (s2, f, want, q) => `sold ${q} ammo to ${f.name} for ${want}`;
  b.goodwill = 10;
  check(D.autoWarTrade(st, "balanced", fake) === "", "Balanced does not sell to warring groups by itself");
  const sold = D.autoWarTrade(st, "aggressive", fake);
  check(/sold \d+ ammo/.test(sold), `Aggressive sells ammo to a group at war (${sold})`);
  // Trip candidates for its jobs.
  if (jd) J.acceptJob(st, jd.id);
  const js = J.makeJob(st, b, "radio", "scout");
  clearCards(st);
  if (js) { J.acceptJob(st, js.id); check(J.jobTripCands(st).some((c) => c.mission === "recon" && c.tile === js.data.center), "an accepted scout job becomes a recon trip for the governor"); }
}

// ======================================================================================
section(`Determinism, ${longDays}-day autopilot run without NaN`);
{
  // Each world in a process of its own: ids come from one counter per process, and a few other parts of the game
  // roll their dice on ids, so two worlds in one process are not comparable.
  const me = fileURLToPath(import.meta.url);
  const d1 = execFileSync(process.execPath, [me, "--digest", String(seed)], { encoding: "utf8", maxBuffer: 1 << 26 });
  const d2 = execFileSync(process.execPath, [me, "--digest", String(seed)], { encoding: "utf8", maxBuffer: 1 << 26 });
  check(d1.length > 100 && d1 === d2, "the same seed plays out the same (relations, wars, jobs, coalition, markets; 90 days, autopilot)");
  const t0 = performance.now();
  const st = world(seed + 3);
  addBuilding(hub(st), "radio");
  setAutopilot(st, true, "balanced");
  const nan = [];
  const fin = (v, w) => { if (typeof v === "number" && !Number.isFinite(v)) nan.push(w); };
  while (day(st) <= longDays && !st.gameOver) {
    tickHour(st);
    if (st.hour % 24) continue;
    for (const f of st.factions) {
      fin(f.pop, "pop"); fin(f.goodwill, "goodwill");
      for (const [k, v] of Object.entries(f.stock)) fin(v, `stock.${k}`);
      if (f.market) for (const [k, p] of Object.entries(f.market.prices)) { fin(p.pay, `pay.${k}`); fin(p.ask, `ask.${k}`); }
    }
    for (const v of Object.values(st.diplo.rel)) fin(v, "rel");
    for (const w of st.diplo.wars) for (const v of [...Object.values(w.score), ...Object.values(w.exh)]) fin(v, "war");
    for (const j of st.jobs.list) for (const v of Object.values(j.data || {})) fin(v, `job.${j.type}`);
    const lp = A.controlledLand(st).pct;
    fin(lp, "land");
  }
  check(!nan.length, `no NaN in ${day(st) - 1} days${nan.length ? ` (${[...new Set(nan)].join(", ")})` : ""}`);
  const ds = st.diplo.stats, js = st.jobs.stats;
  console.log(`  ${day(st) - 1} days${st.gameOver ? " (the holdout fell)" : ""} in ${Math.round(performance.now() - t0)} ms: ${ds.wars} wars (${ds.land} land, ${ds.tribute} tribute, ${ds.white} white, ${ds.brokered} brokered), ${ds.raids} war raids (${ds.raidWins} won, ${ds.basesTaken} bases taken), ${ds.pacts} pacts; jobs: ${js.offered} offered, ${js.accepted} accepted, ${js.done} done, ${js.failed} failed, ${js.void} called off; coalition: ${st.alliance.members.length} members, land ${(A.controlledLand(st).pct * 100).toFixed(1)}%; ${st.factions.filter((f) => !f.alive).length} of 8 groups collapsed`);
  check(ds.wars === 0 || ds.peace + st.diplo.wars.length >= ds.wars - st.diplo.ended.filter((e) => e.terms === "none").length, "every war ended in a peace or is still on");
}

// ======================================================================================
section(`Group collapse per year, with and without wars between groups (seeds ${collapseSeeds.join(", ")})`);
{
  // Each year in a process of its own (ids start at 1 in each, as in a real game).
  const me = fileURLToPath(import.meta.url);
  const one = (s, noWars) => new Promise((ok, no) => execFile(process.execPath, [me, "--collapse", String(s), noWars ? "off" : "on"], { encoding: "utf8", maxBuffer: 1 << 26 },
    (e, out) => (e ? no(e) : ok(JSON.parse(out)))));
  const years = collapseSeeds.flatMap((s) => [[s, false], [s, true]]);
  const done = new Map();
  let next = 0;
  const worker = async () => { while (next < years.length) { const [s, noWars] = years[next++]; done.set(`${s}:${noWars}`, await one(s, noWars)); } };
  await Promise.all(Array.from({ length: Math.min(4, years.length) }, worker));
  let onC = 0, offC = 0, span = 0, wars = 0, gone = 0, terms = { land: 0, tribute: 0, white: 0 };
  const pairs = []; // per seed: the extra collapses with wars, over its years
  for (const s of collapseSeeds) {
    const on = done.get(`${s}:false`), offR = done.get(`${s}:true`);
    const until = Math.min(on.end, offR.end);
    const c1 = Object.values(on.died).filter((d) => d <= until).length, c0 = Object.values(offR.died).filter((d) => d <= until).length;
    onC += c1; offC += c0; span += until;
    pairs.push({ d: c1 - c0, y: until / 365 });
    wars += on.stats.wars;
    gone += on.gone;
    for (const k of Object.keys(terms)) terms[k] += on.stats[k];
    console.log(`  seed ${s}: to day ${until}: ${c0} of 8 collapsed without wars, ${c1} with (${on.stats.wars} wars: ${on.stats.land} land, ${on.stats.tribute} tribute, ${on.stats.white} white)`);
  }
  const yrs = span / 365;
  const r0 = offC / (8 * yrs), r1 = onC / (8 * yrs);
  // The band: COLLAPSE_BAND.gap plus COLLAPSE_BAND.se standard errors of the gap, from this run's own spread (the
  // seeds paired, a ratio over their years: the extra collapses per seed against gap × its years).
  const n = pairs.length, gap = r1 - r0;
  const se = n > 1 ? Math.sqrt((n / (n - 1)) * pairs.reduce((a, x) => a + (x.d - 8 * gap * x.y) ** 2, 0)) / (8 * yrs) : 0;
  const allowed = COLLAPSE_BAND.gap + COLLAPSE_BAND.se * se;
  console.log(`  per group per year: ${r0.toFixed(2)} without wars, ${r1.toFixed(2)} with (${(r0 * 8).toFixed(1)} → ${(r1 * 8).toFixed(1)} of 8 groups a year; gap ${gap >= 0 ? "+" : ""}${gap.toFixed(2)} ± ${se.toFixed(2)} SE over ${n} seeds); ${(wars / yrs).toFixed(1)} wars a year; peace terms: ${terms.land} land, ${terms.tribute} tribute, ${terms.white} white; ${gone} ended by a side collapsing`);
  check(terms.land + terms.tribute + terms.white >= 3 * Math.max(1, gone), "wars end in terms far more often than in a wipe-out");
  check(gap <= allowed, `wars do not wipe groups out much faster (${r0.toFixed(2)} → ${r1.toFixed(2)} a group a year, allowed +${allowed.toFixed(2)}: +${COLLAPSE_BAND.gap} and ${COLLAPSE_BAND.se} SE of ${se.toFixed(2)})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
