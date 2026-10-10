// The autopilot's hive campaign, emergency hauls and land claims (sim/autopilot.js; docs/coalition-war-plan.md "Autopilot (C)").
// (hivecrawl.js: a hive is crawled to its core; when the core is beyond the squad the campaign sends crawl trips that
// clear the way and thin the brood, counted as crawlTrips.)
// Forced scenarios in the wintest.js manner (the setup is rigged, the rules are the game's):
// 1. Campaign: a Balanced hub with six well-armed fighters, a known hive with a 150-strong guard about 20 tiles off
//    (every other hive removed, destroyHive's bookkeeping intact) and a friendly group near it. Within 400 days the
//    campaign must be announced each morning (campaignLine), stockpile ammo to its target, set fires at the mound,
//    invite the group and launch a storm; autopilotStats(state).hiveRejects must be populated.
// 2. Emergency water: 40 people at home, half a day of water, both of the style's teams out and the launch cooldown
//    running: the emergency path sends a water haul anyway, and at least HIVE_KEEP people stay home.
// 3. Claims: with the coalition's land under 50% a two-person claim trip goes out and a claim is made (claims.js).
// Usage: node tools/campaigntest.js [seed]
import { baseAmmo } from "../src/sim/ammo.js"; // the rounds that fit the guns at the hub (the campaign counts those)
import { createWorld, tickHour, day, alive, hub, atBase, makeSurvivor, snapshot } from "../src/sim/world.js";
import { launchExpedition, planPath } from "../src/sim/parties.js";
import { setAutopilot, autopilotStats, campaignLine, PERSONALITIES } from "../src/sim/autopilot.js";
import { ensureHives, newHive, destroyHive, hiveAt, hiveStats } from "../src/sim/hives.js";
import { makeHorde } from "../src/sim/hordes.js";
import { HIVE } from "../src/sim/hiveconst.js";
import { isMember, goalsProgress, ALLIANCE } from "../src/sim/alliance.js";
import { GROUP_HIVE } from "../src/sim/factions.js";
import { ensureJobs } from "../src/sim/jobs.js";
import { addBuilding, count } from "../src/sim/buildings.js";
import { GEAR } from "../src/sim/data.js";
import { besideWater } from "../src/sim/orders.js";
import { waterNeed, waterProduction } from "../src/sim/economy.js";
import { siteKnown } from "../src/sim/discovery.js";

const SEED = Number(process.argv[2] || 1);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const REJECT_KEYS = ["unknown", "far", "odds", "ammo", "squad", "rest", "home"];

function world(seed, style = "balanced") {
  const state = createWorld({ seed, factionCount: 8 });
  state.started = true;
  state.erasOff = true; // the eras' clocks are not under test (tools/eratest.js)
  setAutopilot(state, true, style);
  return state;
}
const logHas = (state, re) => state.log.some((l) => re.test(l.text));
const run = (state, untilDay, each = null) => { while (day(state) < untilDay && !state.gameOver) { tickHour(state); if (each) each(); } };

// ---------- 1. the hive campaign ----------
function campaignScenario(seed) {
  section(`Campaign (seed ${seed}): a 150-guard hive about 20 tiles off, a friendly group near it`);
  const state = world(seed);
  run(state, 20); // a few weeks of ordinary play first (the hub is set up, the map known around it)
  const h = hub(state);
  const g = state.grid;
  ensureHives(state);
  // The friendly group: the one whose main base is nearest the hub (its fighters join at the mound within 15 tiles).
  const f = state.factions.filter((x) => x.alive && x.bases.length).sort((a, b) => g.distance(a.bases[0], h.tile) - g.distance(b.bases[0], h.tile))[0];
  f.known = true; f.goodwill = 55; f.pact = "trade";
  const J = ensureJobs(state);
  J.list.push({ id: J.seq++, fid: f.id, type: "deliver", status: "done", day: day(state) }); // a job done for them: the invitation needs one (alliance.js inviteProblem)
  h.radio = true; // a radio station: the invitation can go over the air (alliance.js reachable)
  // The hive: a land tile 18-22 tiles from the hub, reachable over land, within the coalition's ally range of the
  // group (alliance.js HIVE_RANGE 15: its fighters join the storm) but beyond the groups' own hive range (factions.js
  // GROUP_HIVE.RANGE 12: their war parties would otherwise burn it down before the governor's hiveFrom day), as far
  // from every other group as can be.
  let site = null;
  for (const t of state.tiles) {
    const d = g.distance(t.id, h.tile);
    if (d < 18 || d > 22 || t.terrain === "water" || t.terrain === "mountain" || t.hive || state.bases.some((b) => b.tile === t.id) || state.factions.some((x) => x.bases.includes(t.id)) || typeof t.owner === "number") continue;
    const df = g.distance(t.id, f.bases[0]);
    const others = Math.min(...state.factions.filter((x) => x.alive && x !== f).flatMap((x) => x.bases).map((b) => g.distance(b, t.id)));
    const score = (df <= GROUP_HIVE.RANGE ? -20 : 0) + (df <= ALLIANCE.HIVE_RANGE ? 10 : -df) + (others <= GROUP_HIVE.RANGE ? -20 : Math.min(others, 20) * 0.1);
    if ((!site || score > site.score) && planPath(state, h.tile, t.id, false)) site = { id: t.id, score, df, others };
  }
  if (!check(site, "a hive site 18-22 tiles from the hub")) return;
  const hive = newHive(state, site.id, HIVE.START_RES);
  state.hives.push(hive);
  makeHorde(state, { size: 150, hive: hive.id, tile: hive.tile, role: "guard", target: hive.tile });
  for (const hv of [...state.hives]) if (hv !== hive) destroyHive(state, hv, "(forced by the test)");
  state.hiveSites.length = 0;
  state.knowledge[hive.tile] = snapshot(state, hive.tile); // the hub knows the hive and its guard
  check(hiveStats(state).destroyed >= 1 && state.hives.length === 1, "every other hive destroyed with the bookkeeping intact");
  // Six fighters who can storm it, and a hub that has to stockpile the ammo (30 against the campaign's 92).
  for (let i = 0; i < 6; i++) {
    const p = makeSurvivor(state, 1);
    p.traits = []; p.skills.shooting = 10; p.health = 100;
    p.gear.weapon = { key: "shotgun", name: GEAR.shotgun.name, quality: 1 };
    p.gear.armor = { key: "vest", name: GEAR.vest.name, quality: 1 };
    p.location = { kind: "base", baseId: h.id };
    state.survivors.push(p);
  }
  Object.assign(h.stock, { food: 400, water: 200, ammo: 30, scrap: 250, fuel: 60, meds: 20, parts: 10 });
  if (!count(h, "ammo_bench")) addBuilding(h, "ammo_bench");
  console.log(`  hive ${hive.name} at ${g.distance(hive.tile, h.tile)} tiles; ${f.name}'s base ${g.distance(f.bases[0], hive.tile)} tiles from it, ${g.distance(f.bases[0], h.tile)} from the hub`);
  const P = PERSONALITIES.balanced;
  let lines = 0, maxAmmo = 0, stormDay = null, inviteDay = null, firstLine = "", ammoDay = null;
  const end = day(state) + 400;
  run(state, end, () => {
    if (state.hour % 24 !== 8) return;
    const c = state.governor.campaign;
    if (c && c.line) { lines++; if (!firstLine) firstLine = c.line; if (day(state) % 60 === 0) console.log(`  d${day(state)}: ${c.line}${hiveAt(state, hive.tile) ? "" : " [hive gone]"} (fuel ${Math.floor(h.stock.fuel || 0)})`); }
    if (c) { maxAmmo = Math.max(maxAmmo, baseAmmo(state, h)); if (ammoDay == null && baseAmmo(state, h) >= 92) ammoDay = day(state); }
    if (stormDay == null && (autopilotStats(state).stormTrips || 0) > 0) stormDay = day(state);
    if (inviteDay == null && isMember(state, f)) inviteDay = day(state);
    if (stormDay != null && inviteDay != null && !hiveAt(state, hive.tile)) state.gameOver = true; // all seen: stop early
  });
  state.gameOver = false;
  const st = autopilotStats(state);
  const rj = st.hiveRejects || {};
  console.log(`  day ${day(state)}: ${lines} campaign lines, ammo peak ${maxAmmo} (92 reached ${ammoDay != null ? `day ${ammoDay}` : "never"}), crawl trips ${st.crawlTrips || 0}, storm trips ${st.stormTrips || 0}${stormDay != null ? ` (first day ${stormDay})` : ""}, ${f.name} ${inviteDay != null ? `joined day ${inviteDay}` : "not a member"}, hive ${hiveAt(state, hive.tile) ? "stands" : "destroyed"}, ${alive(state).length} alive`);
  console.log(`  rejects: ${REJECT_KEYS.map((k) => `${k} ${rj[k] ?? "-"}`).join(", ")}`);
  if (process.env.CTLOG) for (const l of state.log.filter((x) => /hive|Hive|brood|died/.test(x.text))) console.log(`    d${Math.floor((l.hour ?? 0) / 24)} ${l.text}`);
  console.log(`  first line: ${firstLine}`);
  check(lines > 0 && /^Campaign on /.test(firstLine), "the campaign line is logged each morning (campaignLine)");
  check(REJECT_KEYS.every((k) => Number.isFinite(rj[k])) && REJECT_KEYS.reduce((a, k) => a + rj[k], 0) > 0, "hiveRejects counters populated");
  check(/ of 92 (ammo|rounds)/.test(firstLine), `the campaign's ammo target is HIVE_SQUAD × HIVE_AMMO + 20 = 92 (line: ${firstLine.slice(0, 80)})`);
  check(maxAmmo >= 92, `the campaign stockpiles ammo to its target (peak ${maxAmmo})`);
  check(inviteDay != null, `${f.name} invited into the coalition`);
  // A group's war party (factions.js GROUP_HIVE) can kill the Hivemind before the governor's hiveFrom day: then there
  // is nothing left to storm, and the storm checks do not apply (the site is placed to make that rare).
  const byGroup = !hiveAt(state, hive.tile) && (st.stormTrips || 0) === 0 && !logHas(state, /was destroyed by your team/);
  if (byGroup) console.log(`  note: a group's war party destroyed the hive on its own (day ${day(state)}): the storm checks do not apply`);
  else {
    check(!logHas(state, /Set fires|Firebomb it/) && (st.fireTrips || 0) === 0, "no fires at the mound: nothing burns a hive from outside any more");
    check((st.stormTrips || 0) + (st.crawlTrips || 0) > 0, `the squad went in (storm trips ${st.stormTrips || 0}, crawl trips ${st.crawlTrips || 0})`);
    check((st.stormTrips || 0) > 0 || logHas(state, /The hive: .*→ Enter the hive/) || !hiveAt(state, hive.tile), "a storm launched");
    check(day(state) >= P.hiveFrom, "ran past the style's hiveFrom day");
  }
  check(campaignLine(state) === "" || /^Campaign on /.test(campaignLine(state)), "campaignLine is a line or empty");
}

// ---------- 2. the emergency water haul ----------
function emergencyScenario(seed) {
  section(`Emergency water haul (seed ${seed}+): 40 at home, half a day of water, both teams out`);
  let state = null, h = null;
  for (let s = seed; s < seed + 12 && !state; s++) {
    const st = world(s);
    const hb = hub(st);
    const shore = st.grid.within(hb.tile, 6).some((id) => id !== hb.tile && besideWater(st, id));
    if (shore) { state = st; h = hb; }
  }
  if (!check(state, "a hub with a shore within 6 tiles among 12 seeds")) return;
  const g = state.grid;
  run(state, 3);
  while (atBase(state, h.id).length < 40) { const p = makeSurvivor(state, 0.9); p.location = { kind: "base", baseId: h.id }; p.role = "rest"; state.survivors.push(p); }
  Object.assign(h.stock, { food: 300, ammo: 120, scrap: 80, meds: 10 });
  // Two ordinary teams out (the Balanced limit), and the launch cooldown running.
  const sites = state.tiles.filter((t) => t.loc && siteKnown(state, t.id) && g.distance(t.id, h.tile) >= 3 && g.distance(t.id, h.tile) <= 6 && t.id !== h.tile && planPath(state, h.tile, t.id, false)).slice(0, 2);
  const people = atBase(state, h.id).filter((s) => s.health >= 80 && !s.leader);
  let out = 0;
  for (const t of sites) {
    const crew = people.splice(0, 2).map((s) => s.id);
    const r = launchExpedition(state, { memberIds: crew, dest: t.id, mission: "scavenge", stance: "normal", supplies: { food: 8, water: 8, ammo: 20 } });
    if (!r.error) out++;
  }
  state.governor.lastLaunch = day(state);
  const want = waterNeed(state, h).total;
  h.stock.water = Math.floor(want * 0.5);
  h.stock.rawwater = 0; // both kinds count (sim/water.js): half a day of water in all
  const prod = waterProduction(state, h).total;
  console.log(`  ${atBase(state, h.id).length} at home, ${out} teams out, water ${h.stock.water} against ${Math.round(want)} a day drunk, ${Math.round(prod)} made`);
  check(out >= 2, "two ordinary teams out (the style's limit)");
  check(prod < want, "the base makes less water than it drinks");
  // Through the next morning's plan and the afternoon check.
  let launched = null;
  for (let i = 0; i < 40 && !launched; i++) {
    tickHour(state);
    launched = state.parties.find((p) => p.owner === "player" && p.apEmergency) || null;
  }
  const teams = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy").length;
  console.log(`  ${launched ? `emergency haul launched day ${day(state)} hour ${state.hour % 24}` : "no emergency haul"}; ${teams} teams out, ${atBase(state, h.id).length} at home`);
  check(launched, "the emergency path launched a trip past the team limit and the cooldown");
  check(launched && launched.plan && launched.plan.steps && launched.plan.steps.some((s) => s.kind === "water"), "it is a water haul (the Fetch water step)");
  check(teams >= 3, `more teams out than the style's maxTeams (${teams})`);
  check(atBase(state, h.id).length >= 3, "HIVE_KEEP people stayed home");
  check(logHas(state, /^🤖 Emergency: /), "the Emergency log line");
  // The morning Water line (hauled / traded / made against drunk) while short.
  run(state, day(state) + 2);
  check(logHas(state, /^🤖 Water: hauled \d+, traded \d+, made \d+ against \d+ drunk/), "the daily Water line while short");
  check((autopilotStats(state).emergencyTrips || 0) >= 1, "stats.emergencyTrips counted");
}

// ---------- 3. claims ----------
async function claimsScenario(seed) {
  section(`Claims (seed ${seed}): the coalition's land under 50%`);
  let CL = null;
  try { CL = await import("../src/sim/claims.js"); } catch (e) { console.log(`  skipped: claims.js is not there yet (${e.message.split("\n")[0]})`); return; }
  const state = world(seed);
  const h = hub(state);
  Object.assign(h.stock, { food: 500, water: 300, ammo: 400, scrap: 200, fuel: 40, meds: 30, parts: 12 }); // nothing short: the claim trip wins the morning
  run(state, 5);
  check(goalsProgress(state).alliance.land.pct < 0.5, "land under 50% at the start");
  let trip = null, tripDay = null;
  run(state, 45, () => { if (!trip) { trip = state.parties.find((p) => p.owner === "player" && p.apClaim) || null; if (trip) tripDay = day(state); } });
  console.log(`  ${trip ? `claim trip launched day ${tripDay} to ${trip.ap && trip.ap.tile}` : "no claim trip in 40 days"}; claims now: ${CL.playerClaims(state).length}`);
  check(trip, "a claim trip went out");
  check(CL.playerClaims(state).length >= 1 || logHas(state, /claimed for the holdout/), `a claim was made (${CL.playerClaims(state).length})`);
  check((autopilotStats(state).claims || 0) >= 1, "stats.claims counted");
}

campaignScenario(SEED);
emergencyScenario(SEED);
await claimsScenario(SEED);
console.log(`\n${passed} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
