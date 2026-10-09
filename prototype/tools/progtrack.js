// Progression tracking for the long censuses (tools/campaign50.js; added 2026-10-09 for the progression census).
// progTracker(state) watches one game hour by hour: hour(freshLogLines) after every tickHour, result() at the end.
// It only reads the world (never the rng), so a game plays out the same with or without it.
//
// What it records (result()):
// - years[]: a snapshot at the start of every game year (eras.js yearOf, which counts a hardcore run's years from the
//   normal start) and at the end: the era, population, bases / outposts, vehicles, the best weapon in hand (GEAR
//   power) and the six best fighters' combat power, coalition members and land %, hives standing / destroyed /
//   being built and the highest tier a standing hive has reached, deaths so far, raids and hive hordes sent at you
//   so far (eras.js E.raids / E.hordes);
// - first: the day each milestone first happened (null: never): the mid and late eras, the year the victories open,
//   the second base, the first outpost, the coalition founded, its first member, land 25% / 40% / 50%, the first
//   hive destroyed by your team, the first hive destroyed by anyone, the first conquest, the first vehicle, the first
//   Wallbreaker raised, the first tier-2 / tier-3 / tier-4 growth grown, the Accord's clock and the containment
//   clock starting, the outbreak beyond the border burning out;
// - markers: mid / end (the player-side progression markers, defined below) as days, null when never reached;
// - content: how often each system was touched (CONTENT: log lines matched, plus counters read off the world);
// - built: the building types ever standing at one of your bases.
//
// The markers (stated in review/progression-census-2026-10-09.md):
// - mid game reached: the mid era AND a second base (an outpost or a taken base) AND either a hive destroyed by your
//   team or the coalition founded (a first member) — the day all three hold for the first time (each may come first);
// - end game reached: the late era AND a victory in progress — the Accord's clock running (the coalition holds over
//   half the land), the containment clock running (no hive standing or being built), or the hive war nearly won (at
//   least 3 hives destroyed by your team and at most 2 standing) or the coalition close (40%+ of the land with a
//   member): the first day the late era and one of those hold together.
import { day, alive } from "../src/sim/world.js";
import { yearOf, eraOf, ensureEraState, burnedOut, winOpen, eraOffsetOf } from "../src/sim/eras.js";
import { goalsProgress } from "../src/sim/alliance.js";
import { hiveStats } from "../src/sim/hives.js";
import { ensureGrowths, hiveTier } from "../src/sim/hivetech.js";
import { GROWTHS } from "../src/sim/hiveconst.js";
import { GEAR } from "../src/sim/data.js";
import { combatPower } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { ensureConquest } from "../src/sim/conquest.js";

// A hive (not one of its growths: "The runner warren at the hive near ... was destroyed by your team") destroyed by your team (hives.js destroyHive).
export const HIVE_KILL = /^The hive [^.]* was destroyed by your team/;
// Systems the autopilot can reach, by the log lines they write (any line, the governor's 🤖 lines too).
export const CONTENT = [
  ["hive storm sortie", /^(🤖 )?Destroy hive team \(.*\) left for/],
  ["hive destroyed by you", HIVE_KILL],
  ["hive fires set", /fires? (set )?around|set fires|Set fires/i],
  ["growth burned", /^(🤖 )?Burn the growth team \(.*\) left for|was destroyed by your team\. It (breeds|grows|sends|raises)/],
  ["hive gathering broken", /gathering|massing/i],
  ["conquest (base taken)", /^Your team took .*'s base/],
  ["group broken by you", /is no more: you took its last base/],
  ["coalition join", /joined The Calder Coalition/],
  ["coalition leave", /left The Calder Coalition/],
  ["coalition council", /council/i],
  ["radio deal", /^Radio deal with|radio deal/i],
  ["radio scan new voices", /^New voices on the radio/],
  ["caravan visit", /caravan from .* has arrived|send a caravan to/i],
  ["envoy", /an envoy to/i],
  ["prisoners taken", /^Taken prisoner:/],
  ["prisoner talked/recruited", /, a prisoner,|talked:|is locked up/],
  ["ransom/rescue", /ransom|Rescue|rescue team/i],
  ["outpost founded", /Outpost founded with \d+ staff|founded with \d+ staff/],
  ["vehicle claimed/restored", /claimed a .* at|goes into .*'s motor pool|joins .* team \(fuel|motor pool is yours/],
  ["crafted", /crafted at/],
  ["blueprint studied", /finished studying/],
  ["harvest festival", /The harvest festival at/],
  ["wanderers", /wanderer/i],
  ["outsiders (raiders/merchants/explorers)", /^Outsiders|merchants|explorers|raider band/i],
  ["raid on your base", /^Raiders heading for|raiders? (hit|attacked|broke)|raid on .* (held|repelled|beaten)/i],
  ["horde hit your base", /^A horde of \d+ (broke through|hit) /],
  ["horde broke in", /^A horde of \d+ broke through/],
  ["Wallbreaker", /Wallbreaker/],
  ["war joined/at war", /at war with|War council/i],
  ["bloc", /You stand with|bloc/i],
  ["claims", /claimed for the holdout/],
  ["claim lost", /^Your claim at|of your claims near/],
  ["radio relay", /radio relay/i],
  ["survey", /^(🤖 )?Survey team/],
  ["crash site/supply drop", /helicopter|supply drop|crash site|plane/i],
  ["military convoy", /Army (convoy|trucks)/],
  ["hunting/fishing", /brought in \d+ (fish|food)|Hunting team|Fishing team/],
  ["harvest", /harvested [\d.]+ food/],
  ["worm", /\bworm\b/i],
  ["memorial", /memorial/i],
  ["mental break", /breakdown|snapped|mental break/i],
  ["new recruit", /joined (you|your)|recruited|stays? (on|with you)|signs? on/i],
  ["jobs", /\bjob\b/i],
  ["tribute", /tribute/i],
  ["new gang from beyond the border", /from beyond the border/i],
  ["group fell", /has collapsed|is no more|has fallen$/],
  ["tier-2 growth rumour", /growing something new\. An? (brute pit|spitter sac|ossuary|sinew scaffold|worm pit|egg cistern|dread hollow)/],
  ["tier-3/4 growth rumour", /growing something new\. An? (screamer spire|crawler burrow|wallbreaker den|shepherd's fold|mutation vat)/i],
  // The hive crawl (hivecrawl.js, since 2026-10-09): trips in, the core fights, a team lost inside, the AI groups' crawls.
  ["hive crawl trip", / crawls into /],
  ["hive core won (Hivemind killed)", /The Hivemind bursts/],
  ["hive core lost", /fell back from the core|drove the team back from the core/],
  ["crawl team lost inside", /^(Killed in the core\. )?The team died in /],
];

const r1 = (x) => Math.round(x * 10) / 10;
export function progTracker(state, deathTotal = () => 0) {
  const first = {};
  const mark = (k, d) => { if (first[k] == null) first[k] = d; };
  const content = Object.fromEntries(CONTENT.map(([k]) => [k, 0]));
  const years = [];
  const built = new Set();
  const grownTier = {}; // growth ids seen grown, by tier
  let lastYear = 0, lastDay = 0;
  const yourHiveKills = { n: 0 };
  // The hive crawl (hivecrawl.js p.hiveCrawl): every crawl of your teams, by the hive's tier when it went in; the
  // deepest chamber reached (and the den's depth), the core fights won and lost.
  const crawl = { trips: 0, deepest: 0, depth: 0, coreWon: 0, coreLost: 0, lostInside: 0, byTier: {} };
  const live = new Map(); // party id -> { tier, deepest, depth }
  const tierRow = (t) => (crawl.byTier[t] = crawl.byTier[t] || { trips: 0, deepest: 0, coreWon: 0, coreLost: 0 });

  const snapshot = (d) => {
    const gp = goalsProgress(state);
    const E = ensureEraState(state);
    const people = alive(state);
    const weapons = people.map((s) => (s.gear && s.gear.weapon && GEAR[s.gear.weapon.key] ? GEAR[s.gear.weapon.key].power || 0 : 0));
    const top = people.map((s) => combatPower(s)).sort((a, b) => b - a).slice(0, 6);
    let maxTier = 0;
    for (const hv of state.hives || []) { try { maxTier = Math.max(maxTier, hiveTier(state, hv)); } catch { /* the hive module mid-change */ } }
    const st = hiveStats(state);
    return {
      year: yearOf(state), day: d, era: eraOf(state).key, pop: people.length, bases: state.bases.length, outposts: state.bases.filter((b) => b.type === "outpost").length,
      vehicles: (state.vehicles || []).filter((v) => !v.destroyed && !v.found).length, bestWeapon: weapons.length ? Math.max(...weapons) : 0, squad: r1(top.reduce((a, x) => a + x, 0)),
      members: gp.alliance.members, land: Math.round(gp.alliance.land.pct * 1000) / 10, hives: gp.hives.left, destroyed: st.destroyed || 0, yourKills: yourHiveKills.n, building: gp.hives.building,
      maxHiveTier: maxTier, bosses: st.bosses || 0, deaths: deathTotal(), raids: E.raids || 0, hordes: E.hordes || 0, accord: E.accord, clear: E.clear,
    };
  };

  const daily = (d) => {
    const y = yearOf(state);
    if (y !== lastYear) { years.push(snapshot(d)); lastYear = y; }
    const era = eraOf(state).key;
    if (era === "mid" || era === "late") mark("midEra", d);
    if (era === "late") mark("lateEra", d);
    if (winOpen(state)) mark("winOpen", d);
    if (burnedOut(state)) mark("burnout", d);
    if (state.bases.length >= 2) mark("secondBase", d);
    if (state.bases.some((b) => b.type === "outpost" && !b.captured)) mark("outpost", d);
    if ((state.vehicles || []).filter((v) => !v.destroyed && !v.found).length >= 2) mark("secondVehicle", d);
    for (const b of state.bases) for (const x of b.buildings) built.add(x.type);
    const gp = goalsProgress(state);
    if (gp.alliance.members > 0) mark("member", d);
    if (state.alliance && state.alliance.founded != null) mark("coalition", state.alliance.founded);
    const land = gp.alliance.land.pct;
    if (land >= 0.25) mark("land25", d);
    if (land >= 0.4) mark("land40", d);
    if (land > 0.5) mark("land50", d);
    const st = hiveStats(state);
    if ((st.destroyed || 0) > 0) mark("anyHiveDestroyed", d);
    if ((st.bosses || 0) > 0) mark("wallbreaker", d);
    const C = ensureConquest(state);
    if ((C.stats.taken || 0) > 0) mark("conquest", d);
    try {
      for (const g of ensureGrowths(state)) {
        if (g.withered || state.hour < g.ready) continue;
        const t = (GROWTHS[g.kind] && GROWTHS[g.kind].tier) || 0;
        (grownTier[t] = grownTier[t] || new Set()).add(g.id);
        if (t >= 2) mark("tier2growth", d);
        if (t >= 3) mark("tier3growth", d);
        if (t >= 4) mark("tier4growth", d);
      }
    } catch { /* the hive module mid-change */ }
    const E = ensureEraState(state);
    if (E.accord > 0) mark("accordClock", d);
    if (E.clear > 0) mark("clearClock", d);
    // The markers.
    if (first.midEra != null && first.secondBase != null && (first.yourHive != null || first.member != null)) mark("MID", d);
    const standing = gp.hives.left;
    const inProgress = E.accord > 0 || E.clear > 0 || (yourHiveKills.n >= 3 && standing <= 2) || (land >= 0.4 && gp.alliance.members > 0);
    if (era === "late" && inProgress) mark("END", d);
  };

  return {
    hour(fresh) {
      // Crawls under way: noted when they start, their deepest chamber kept up to date.
      let anyTier = null;
      for (const p of state.parties) {
        const c = p.owner === "player" && p.hiveCrawl;
        if (!c) continue;
        let e = live.get(p.id);
        if (!e || e.hiveId !== c.hiveId || e.started !== c.started) {
          const hv = (state.hives || []).find((h) => h.id === c.hiveId);
          let tier = 0, depth = 0;
          try { tier = hv ? hiveTier(state, hv) : 0; depth = hv && hv.den ? hv.den.depth || 0 : 0; } catch { /* the crawl module mid-change */ }
          e = { hiveId: c.hiveId, started: c.started, tier, deepest: 0, depth };
          live.set(p.id, e);
          crawl.trips++; tierRow(tier).trips++;
          if (first.crawl == null) first.crawl = day(state);
        }
        e.deepest = Math.max(e.deepest, c.deepest || 0);
        crawl.deepest = Math.max(crawl.deepest, e.deepest);
        crawl.depth = Math.max(crawl.depth, e.depth);
        tierRow(e.tier).deepest = Math.max(tierRow(e.tier).deepest, e.deepest);
        anyTier = e.tier;
      }
      for (const [id] of live) if (!state.parties.some((p) => p.id === id && p.hiveCrawl)) live.delete(id);
      for (const l of fresh) {
        if (/The Hivemind bursts/.test(l.text)) { crawl.coreWon++; tierRow(anyTier ?? 0).coreWon++; if (first.coreWon == null) first.coreWon = day(state); }
        else if (/fell back from the core|drove the team back from the core/.test(l.text)) { crawl.coreLost++; tierRow(anyTier ?? 0).coreLost++; }
        if (/^(Killed in the core\. )?The team died in /.test(l.text)) crawl.lostInside++;
      }
      for (const l of fresh) {
        const t = l.text;
        for (const [k, re] of CONTENT) if (re.test(t)) content[k]++;
        if (HIVE_KILL.test(t)) { yourHiveKills.n++; mark("yourHive", day(state)); }
      }
      if (state.hour % 24 === 0) { const d = day(state); if (d !== lastDay) { lastDay = d; try { daily(d); } catch (e) { first.trackError = first.trackError || String(e.stack || e).split("\n").slice(0, 3).join(" | "); } } }
    },
    result() {
      const d = day(state);
      try { years.push({ ...snapshot(d), end: true }); } catch { /* end of a crashed run */ }
      const counters = {};
      try {
        const S = state.stats || {};
        for (const k of ["prisonersTaken", "prisonersRecruited", "raidsRepelled", "caravanRaids", "convoys", "conflicts", "hubEvents", "breakdowns", "crashes", "takeovers", "newGangs", "bandsSettled", "basesTaken", "abandonedBases", "executions", "peopleSaved"]) counters[k] = S[k] || 0;
        const hs = hiveStats(state);
        for (const k of ["sites", "built", "border", "breakIns", "held", "repelled", "overrun", "groupStorms", "groupKills", "bosses", "destroyed"]) counters[`hive.${k}`] = hs[k] || 0;
        const C = ensureConquest(state).stats;
        for (const k of ["assaults", "won", "taken", "defeated", "retaken", "basesLost", "hubsLost"]) counters[`conquest.${k}`] = C[k] || 0;
        const A = state.alliance && state.alliance.stats;
        if (A) for (const k of ["joined", "left", "councils"]) counters[`alliance.${k}`] = A[k] || 0;
        const G = state.governor && state.governor.stats;
        if (G) for (const k of ["launched", "builds", "crafts", "searches", "supplyRuns", "outposts", "trades", "farTrips"]) counters[`gov.${k}`] = G[k] || 0;
        for (const [t, ids] of Object.entries(grownTier)) counters[`growths.tier${t}`] = ids.size;
      } catch { /* a module mid-change */ }
      return {
        offset: eraOffsetOf(state), crawl, years, first, markers: { mid: first.MID ?? null, end: first.END ?? null }, content, counters,
        built: [...built].sort(), neverBuilt: Object.keys(BUILDINGS).filter((k) => !built.has(k)), yourHiveKills: yourHiveKills.n,
      };
    },
  };
}
