// Hive birth you can see (src/sim/hivebirth.js, suggestions-4 #23): the rumour when a site is picked near your land
// (and none far from it), the "dead are massing" card once the gathering is known (its three choices: the planner
// aimed at it, mark it as the default, ignore), the marker's estimate (days to a hive from a fresh and an old look),
// the alert for a marked gathering, the fight (smaller than a hive's brood), breaking up a gathering not started yet
// (the site given up, the next one pushed back) and one under way (the mound set back, unfed for a while: no hive
// sends to it, wandering hordes are not drawn), a Cull horde team at the gathering end to end (the card's Break up
// choice and its battle played headless), the card when a hive you knew of rises, the autopilot's answers and its
// trip, and save/load of the watch.
// Usage: node tools/hivebirthtest.js [seed=42]
import { createWorld, tickHour, hub, alive, day, snapshot, addCard } from "../src/sim/world.js";
import { ensureHives, hiveAt, deliverToSite, hiveForce, siteResting, hivesDaily } from "../src/sim/hives.js";
import { HIVE } from "../src/sim/hiveconst.js";
import { makeHorde } from "../src/sim/hordes.js";
import { launchExpedition } from "../src/sim/parties.js";
import { inCoverage } from "../src/sim/radio.js";
import { setAutopilot, PERSONALITIES } from "../src/sim/autopilot.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import {
  BIRTH, hiveBirthHour, siteView, buildSiteLabel, gatheringAlerts, gatheringForce, breakGathering, gatheringCands, watchOf, etaDays, isMarked,
} from "../src/sim/hivebirth.js";

const SEED = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const world = (seed = SEED) => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.cards.length = 0; ensureHives(st); return st; };
const logged = (st, re) => st.log.some((l) => re.test(l.text));
const land = (st, id) => { const t = st.tiles[id]; return t.terrain !== "water" && t.terrain !== "mountain" && !t.hive && !t.loc; };
// A site on open ground at a distance from the hub, near enough to a hive to be fed (SUPPORT tiles).
function placeSite(st, dMin, dMax, opts = {}) {
  const g = st.grid, h = hub(st);
  const t = st.tiles.find((x) => land(st, x.id) && g.distance(x.id, h.tile) >= dMin && g.distance(x.id, h.tile) <= dMax &&
    (!opts.fed || st.hives.some((hv) => g.distance(hv.tile, x.id) <= HIVE.SUPPORT && g.distance(hv.tile, x.id) >= 4)) &&
    (opts.coverage == null || inCoverage(st, x.id) === opts.coverage) && !st.bases.some((b) => b !== h && g.distance(b.tile, x.id) <= BIRTH.RUMOUR_BASE));
  if (!t) return null;
  const site = { id: (st.hiveSeq = (st.hiveSeq || 0) + 1), tile: t.id, chosen: st.hour, score: 0, biomass: 0, started: null };
  st.hiveSites.push(site);
  return site;
}
const gather = (st, site, size) => { const h = makeHorde(st, { tile: site.tile, size, role: "build", site: site.id, target: site.tile, split: true }); deliverToSite(st, h, site); return h; };
const mass = (st, site) => st.hordes.filter((h) => h.role === "mass" && h.site === site.id).reduce((a, h) => a + h.size, 0);
const t0 = Date.now();

// 1. The rumour: a site near the hub is heard of (a log line), one far from your land and radio is not.
{
  console.log("Rumours");
  const st = world();
  const near = placeSite(st, 6, BIRTH.RUMOUR_BASE);
  hiveBirthHour(st);
  check(near && logged(st, /^Travellers talk of the dead drifting toward/), `a site ${near ? st.grid.distance(near.tile, hub(st).tile) : "?"} tiles from the hub: a rumour in the log`);
  check(near && watchOf(st, near.id) && watchOf(st, near.id).rumour === day(st), "the watch notes the day it was heard");
  check(!st.cards.length, "no card yet: nobody has seen the dead there");
  const st2 = world();
  st2.parties.length = 0;
  const far = placeSite(st2, BIRTH.RUMOUR_BASE + 4, 99, { coverage: false });
  hiveBirthHour(st2);
  check(far && !logged(st2, /Travellers talk/), "a site far from every base, team and radio: no rumour");
  check(far && watchOf(st2, far.id) && watchOf(st2, far.id).rumour == null, "...but it is watched (silently)");
}

// 2. The card once the gathering is known; its choices; marking; the alert; the marker's estimate.
{
  console.log("The massing card, the mark, the estimate");
  const st = world();
  const site = placeSite(st, 6, 12, { fed: true });
  gather(st, site, 220);
  hiveBirthHour(st);
  check(!st.cards.some((c) => c.hiveSite === site.id), "the dead gathered out of sight: no card");
  st.knowledge[site.tile] = snapshot(st, site.tile); // a team's report (or radio news) puts it in the hub's knowledge
  hiveBirthHour(st);
  const card = st.cards.find((c) => c.hiveSite === site.id);
  check(!!card && /^The dead are massing /.test(card.title), `the card: "${card && card.title}"`);
  check(card && card.choices.length === 3 && card.choices[0].uiAction && card.choices[0].uiAction.type === "plan" && card.choices[0].uiAction.mission === "cull" && card.choices[0].uiAction.tile === site.tile,
    "first choice opens the planner aimed at the gathering (Cull horde)");
  check(card && card.choices.filter((c) => c.default).length === 1 && card.choices[1].default && /^Mark it/.test(card.choices[1].label), "Mark it is the one default answer");
  check(card && card.choices.every((c) => typeof c.ai === "function") && card.choices[1].ai(st) > card.choices[2].ai(st), "every choice carries an autopilot score; marking beats ignoring");
  hiveBirthHour(st);
  check(st.cards.filter((c) => c.hiveSite === site.id).length === 1, "only one card per gathering");
  check(gatheringAlerts(st).length === 0, "no alert before it is marked");
  card.choices[1].resolve(st);
  check(watchOf(st, site.id).marked && isMarked(st, site.tile), "Mark it: the watch is marked (the map's red ring)");
  const al = gatheringAlerts(st);
  check(al.length === 1 && /hive in ~\d+ days/.test(al[0].text) && al[0].go.tile === site.tile, `an alert tracks it: "${al[0] && al[0].text}"`);
  const v = siteView(st, site.tile);
  check(v && v.sure && v.mass === 220 && v.days === etaDays(0, false, 220), `fresh report: ${v && v.mass} dead, a hive in ~${v && v.days} days`);
  check(/Massing · hive in ~\d+ days$/.test(buildSiteLabel(st, site.tile)), `the map's line: "${buildSiteLabel(st, site.tile)}"`);
  st.hour += 5 * 24; // the look is now 5 days old
  const v2 = siteView(st, site.tile);
  check(v2 && !v2.sure && v2.days === v.days - 5 && /\?$/.test(buildSiteLabel(st, site.tile)), `5 days later: ~${v2 && v2.days} days, uncertain ("${buildSiteLabel(st, site.tile)}")`);
  site.started = st.hour; site.biomass = 600;
  check(etaDays(600, true, 400) === Math.ceil(400 / HIVE.SITE_INTAKE) && etaDays(600, true, 50) === Math.ceil(400 / 32), "under way: the days left at 40 a day with a big mass, 32 with a small one");
}

// 3. The fight: a handful of the mass, weaker and fewer than a hive's brood, with no Broodmother.
{
  console.log("The fight");
  const st = world();
  const site = placeSite(st, 6, 14, { fed: true });
  const counts = [0, 200, 500, 1200].map((m) => gatheringForce(st, site, m).count);
  check(counts.every((c) => c >= BIRTH.FIGHT_MIN && c <= BIRTH.FIGHT_MAX) && counts[3] === BIRTH.FIGHT_MAX && counts[0] === BIRTH.FIGHT_MIN, `the dead met by mass 0/200/500/1200: ${counts.join(", ")}`);
  const hf = hiveForce(st, st.hives[0]);
  const gf = gatheringForce(st, site, 1200);
  check(gf.count * gf.power < hf.count * hf.power * 0.6, `smaller than a hive's brood: ${gf.count} at power ${gf.power} against ${hf.count} at ${hf.power} (+ the Broodmother)`);
}

// 4. Breaking up a gathering not started yet: the site is given up, the dead scatter, the next site waits.
{
  console.log("Breaking up a gathering before the mound");
  const st = world();
  const site = placeSite(st, 6, 14, { fed: true });
  gather(st, site, 300);
  const builder = makeHorde(st, { tile: st.hives[0].tile, size: 60, role: "build", site: site.id, target: site.tile, split: true });
  hiveBirthHour(st);
  const before = st.hiveInfo.nextSiteDay;
  const text = breakGathering(st, site, "by your team");
  check(!st.hiveSites.includes(site), "the site is given up");
  const left = st.hordes.filter((h) => h.lureUntil > st.hour && h.role === "roam");
  const kept = left.reduce((a, h) => a + h.size, 0);
  check(Math.abs(kept - 300 * (1 - BIRTH.KILL_SHARE)) <= 2, `${Math.round(BIRTH.KILL_SHARE * 100)}% fell, ${kept} ran (of 300)`);
  check(left.every((h) => h.site == null && h.hive == null && st.grid.distance(h.target, site.tile) === BIRTH.SCATTER), `they run ${BIRTH.SCATTER} tiles off and are no hive's any more`);
  check(builder.role === "roam" && builder.site == null, "a horde still on its way there is called off");
  check(st.hiveInfo.nextSiteDay >= Math.max(before, day(st) + BIRTH.REPICK_DAYS), `no new site for ${BIRTH.REPICK_DAYS} days at least (next site day ${st.hiveInfo.nextSiteDay})`);
  check(/No hive will grow there/.test(text) && logged(st, /broke and scattered/), "a log line says so");
  check(st.hiveInfo.stats.broken === 1 && st.hiveInfo.stats.abandoned === 1, "the hive stats count it");
}

// 5. Breaking up a hive under way: set back, starts over, unfed for PAUSE_DAYS.
{
  console.log("Breaking up a mound under way");
  const st = world();
  const site = placeSite(st, 6, 14, { fed: true });
  gather(st, site, 400);
  site.started = st.hour; site.score = 40; site.biomass = 600;
  const text = breakGathering(st, site);
  check(st.hiveSites.includes(site) && site.biomass === 600 - Math.max(BIRTH.SETBACK_MIN, 600 * BIRTH.SETBACK), `the mound loses ${Math.round(BIRTH.SETBACK * 100)}%: ${site.biomass} of 1,000 left`);
  check(site.started == null && site.score === 0, "it starts over: a score of 30 has to gather again");
  check(siteResting(st, site) && site.brokenUntil === st.hour + BIRTH.PAUSE_DAYS * 24, `unfed for ${BIRTH.PAUSE_DAYS} days`);
  check(/start over/.test(text), "the log says the hive has to start over");
  // The hives near it send nothing there while it rests; a wandering horde next to it is not drawn in.
  for (const hv of st.hives) hv.res = 80;
  const wander = makeHorde(st, { tile: site.tile, size: 40, role: "roam", split: true });
  wander.tile = st.grid.neighbors(site.tile)[0];
  for (let i = 0; i < 5; i++) { st.hour += 24; hivesDaily(st); }
  check(!st.hordes.some((h) => (h.role === "build" || h.role === "mass") && h.site === site.id), "5 days on: no hive sends a horde to it");
  check(wander.role !== "build", "a wandering horde beside it is not drawn in");
  st.hour = site.brokenUntil + 24;
  for (let i = 0; i < 3; i++) { st.hour += 24; hivesDaily(st); }
  check(st.hordes.some((h) => h.role === "build" && h.site === site.id), "after the pause the hives feed it again");
}

// 6. A Cull horde team at the gathering: the card's Break up choice, the battle (headless), the result.
{
  console.log("A Cull horde team breaks up a gathering");
  const st = world();
  const site = placeSite(st, 3, 6);
  gather(st, site, 160);
  const crew = alive(st).filter((s) => s.health >= 60).sort((a, b) => (b.skills.shooting || 0) - (a.skills.shooting || 0)).slice(0, 4);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: site.tile, mission: "cull", stance: "normal", vehicleId: null, supplies: { food: 8, water: 8, ammo: 60, meds: 2 } });
  check(!res.error, `team launched toward the gathering ${st.grid.distance(site.tile, hub(st).tile)} tiles out${res.error ? ` (${res.error})` : ""}`);
  let card = null;
  for (let i = 0; i < 72 && !card; i++) {
    tickHour(st);
    card = st.cards.find((c) => c.gathering === site.id) || null;
    // Other cards on the way (road events, the massing card): answered with their last choice.
    for (const c of [...st.cards]) if (c !== card && c.gathering == null) { st.cards.splice(st.cards.indexOf(c), 1); const ch = c.choices.filter((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)); if (ch.length && c.partyId != null) ch[ch.length - 1].resolve(st); }
  }
  check(!!card && /^Break up the gathering/.test(card.choices[0].label) && /^The dead massing /.test(card.title), `the cull card at the gathering: "${card && card.title}", first choice "${card && card.choices[0].label}"`);
  if (card) {
    const m0 = mass(st, site);
    st.cards.splice(st.cards.indexOf(card), 1);
    card.choices[0].resolve(st); // fightNow: played headless
    const gone = !st.hiveSites.includes(site);
    check(!st.combat && (gone || mass(st, site) < m0), gone ? "the battle was won: the gathering broke and the site is given up" : `the team fell back: the mass is down from ${m0} to ${mass(st, site)}`);
    check(logged(st, /broke and scattered|fell back from the gathering|swallowed the attack|whole team was lost/), "the outcome is in the log");
  }
}

// 7. A hive you knew of rises: a card (plan the attack, or not now).
{
  console.log("A hive you knew of rises");
  const st = world();
  const site = placeSite(st, 6, 14, { fed: true });
  gather(st, site, 200);
  st.knowledge[site.tile] = snapshot(st, site.tile);
  hiveBirthHour(st);
  st.cards.length = 0;
  site.started = st.hour; site.score = 40; site.biomass = HIVE.SITE_BIOMASS - 10;
  st.hour = day(st) * 24 - 1; tickHour(st); // midnight: the hive is finished (hives.js siteDaily)
  check(!!hiveAt(st, site.tile), "the hive stands");
  const born = st.cards.find((c) => /^A new hive /.test(c.title));
  check(!!born && born.choices[0].uiAction && born.choices[0].uiAction.mission === "hive" && born.choices.some((c) => c.default), `the card: "${born && born.title}" (plan an attack / not now)`);
  check(!watchOf(st, site.id), "the watch lets the site go");
}

// 8. The autopilot: marks the gathering; a trip when a squad has the odds and it is in reach, none otherwise.
{
  console.log("The autopilot");
  const st = world();
  setAutopilot(st, true, "aggressive");
  const site = placeSite(st, 4, 8, { fed: true });
  gather(st, site, 150);
  st.knowledge[site.tile] = snapshot(st, site.tile);
  hiveBirthHour(st);
  const card = st.cards.find((c) => c.hiveSite === site.id);
  const opts = card.choices.filter((c) => !c.uiAction);
  const pick = [...opts].sort((a, b) => b.ai(st) - a.ai(st))[0];
  check(/^Mark it/.test(pick.label), `its answer to the card: ${pick.label}`);
  const pool = alive(st).filter((s) => s.location.kind === "base");
  const value = () => 2; // a fighter worth 2 (a shotgun and a vest)
  const P = PERSONALITIES.aggressive;
  const c = gatheringCands(st, hub(st), pool, P, value);
  check(c.length === 1 && c[0].mission === "cull" && c[0].tile === site.tile && c[0].gathering === site.id && c[0].squadMin === 3, `a strong squad: a Cull horde trip (${c[0] && c[0].why})`);
  check(gatheringCands(st, hub(st), pool, P, () => 0.1).length === 0, "a weak squad: no trip");
  check(gatheringCands(st, hub(st), pool, PERSONALITIES.cautious, () => 0.9).length <= gatheringCands(st, hub(st), pool, P, () => 0.9).length, "Aggressive takes worse odds than Cautious");
  st.parties.push({ owner: "player", apGathering: site.id, path: [hub(st).tile], idx: 0 });
  check(gatheringCands(st, hub(st), pool, P, value).length === 0, "one such trip at a time");
  st.parties.pop();
  const far = world();
  const fs = placeSite(far, P.range * 1.5 + 2, 99, { fed: true });
  if (fs) { gather(far, fs, 150); far.knowledge[fs.tile] = snapshot(far, fs.tile); }
  check(!fs || gatheringCands(far, hub(far), pool, P, value).length === 0, "out of its reach: no trip");
}

// 9. Save and load: the watch, the mark, a broken site's pause.
{
  console.log("Save and load");
  const st = world();
  const site = placeSite(st, 6, 14, { fed: true });
  gather(st, site, 300);
  st.knowledge[site.tile] = snapshot(st, site.tile);
  hiveBirthHour(st);
  st.cards.find((c) => c.hiveSite === site.id).choices[1].resolve(st);
  st.cards.length = 0;
  site.started = st.hour; site.score = 40; site.biomass = 500;
  breakGathering(st, site);
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const s2 = back.hiveSites.find((x) => x.id === site.id);
  check(watchOf(back, site.id) && watchOf(back, site.id).marked && watchOf(back, site.id).broken === 1, "the watch and the mark survive a save");
  check(s2 && s2.brokenUntil === site.brokenUntil && siteResting(back, s2), "the pause survives a save");
  const old = world();
  delete old.hiveWatch;
  const os = placeSite(old, 6, 14);
  hiveBirthHour(old);
  check(!!old.hiveWatch && !!watchOf(old, os.id), "an older save without a watch starts one");
}

// 10. The autopilot plays it out: it marks a gathering near the hub, sends a squad, and nothing breaks.
{
  console.log("The autopilot plays it out");
  const st = world(SEED + 1);
  setAutopilot(st, true, "aggressive");
  const site = placeSite(st, 4, 8);
  gather(st, site, 120);
  st.knowledge[site.tile] = snapshot(st, site.tile);
  let err = null, sent = false;
  try {
    for (let i = 0; i < 30 * 24 && !st.gameOver; i++) {
      tickHour(st);
      if (st.parties.some((p) => p.apGathering === site.id)) sent = true;
    }
  } catch (e) { err = e; }
  check(!err, `30 days, Aggressive, no error${err ? `: ${err.message}` : ""}`);
  check(!watchOf(st, site.id) || watchOf(st, site.id).marked, "it marked the gathering");
  check(sent, `it sent a squad to break it up (${st.hiveSites.includes(site) ? `still there: ${mass(st, site)} massed` : "the site is gone"}; broken up ${st.hiveInfo.stats.broken || 0})`);
  check(st.hiveSites.every((s) => Number.isFinite(s.biomass) && Number.isFinite(s.score)) && st.hordes.every((h) => Number.isFinite(h.size)), "sites and hordes finite");
}

// 11. The map draws it (headless, on a stub canvas): the mound, its line, the marked ring, the hub's festival fires.
{
  console.log("The map");
  const R = await import("../src/ui/render.js");
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  let texts = [], nanArgs = 0, dashed = 0;
  const ctxStub = new Proxy({ measureText: (t) => ({ width: String(t).length * 5 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => {
      if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nanArgs++;
      if (k === "fillText" || k === "strokeText") texts.push(String(a[0]));
      if (k === "setLineDash" && a[0] && a[0].length) dashed++;
    }),
    set: (o, k, v) => ((o[k] = v), true),
  });
  R.initRenderer({ getContext: () => ctxStub, getBoundingClientRect: () => ({ width: 1600, height: 900 }), width: 0, height: 0 });
  const st = world();
  const site = placeSite(st, 2, 3);
  gather(st, site, 300);
  tickHour(st); // in the hub's sight: the card
  const card = st.cards.find((c) => c.hiveSite === site.id);
  if (card) card.choices[1].resolve(st);
  st.cards.length = 0;
  const { holdFestival } = await import("../src/sim/festival.js");
  hub(st).stock.food = 500;
  holdFestival(st, hub(st), "FULL");
  let err = null;
  try { R.resize(); R.camera.zoom = 1.6; R.centerOn(st, site.tile); R.redrawMap(true); R.render(st); } catch (e) { err = e; }
  check(!err && nanArgs === 0, `drawn without errors or NaN${err ? `: ${err.message}` : ""}`);
  check(texts.some((t) => /^Massing · hive in ~\d+ days$/.test(t)), `the line under the mound: "${texts.find((t) => /hive in/.test(t))}"`);
  check(dashed > 0 && isMarked(st, site.tile), "the marked gathering's dashed ring");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
