// Hive birth you can see (suggestions-4 #23): the player hears of a new hive's build site, sees the dead massing
// there, can mark it and track it, and can break the gathering up before the hive stands.
//
// hives.js picks a build site every few months and the hives near it send their hordes there (pickSite, siteDaily);
// none of that changes here (the pace of new hives is the user's). This module only watches the sites:
// - A rumour (a log line, so the diary has it) the day a site is picked, when the player has ears near it: the site
//   inside your radio coverage (radio.js inCoverage), a base within BIRTH.RUMOUR_BASE tiles or a team in the field
//   within BIRTH.RUMOUR_TEAM. It names the nearest place everyone knows, not the tile.
// - A card "The dead are massing near X" once the gathering is known by the usual rules (discovery.js): the tile in
//   view now (a base's sight, a team in radio contact) or a report of it in the hub's knowledge (a team home, radio
//   news). Choices: break it up (the planner opens aimed at the gathering with the Cull horde mission), mark it (an
//   alert that tracks it), ignore it.
// - The map's build-site mound grows with the dead gathered there and says how many days until the hive stands, as
//   known: from what is in view, or from the last report less the days since (a "?" once that is over STALE_DAYS old).
// - A Cull horde team at the gathering gets "Break up the gathering" on its cull card: a tactical battle against a
//   handful of the mass (FIGHT_*: smaller than a hive's brood, no Broodmother). Won, the gathering scatters: part of it
//   falls, the rest runs SCATTER tiles off and stays away SCATTER_DAYS. A site not started yet (score under 30) is
//   given up; one under way loses SETBACK of what has gone into it, starts over from a score of 0 and the hives stop
//   feeding it for PAUSE_DAYS (hives.js siteResting).
// - When a hive the player knew of rises: a card (plan to destroy it, or not now).
// The autopilot marks every gathering and sends a Cull horde squad when one is in its reach and the squad has the
// odds (gatheringCands; Aggressive goes farther and at worse odds).
//
// state.hiveWatch: { [siteId]: { tile, rumour (day | null), seen (day | null), card, marked, broken } }; saved with
// the state (save.js writes everything). No random numbers here: the world's dice are untouched.
import { log, day, addCard, hub, snapshot } from "./world.js";
import { HIVE, BOSS_NAMES } from "./hiveconst.js";
import { ensureHives, zombieToughness, hiveAt, siteById, hivesLeftText } from "./hives.js";
import { reduceHorde } from "./hordes.js";
import { partyMembers, partyTile, tileLabel, awaitOrders, wipeIfEmpty } from "./parties.js";
import { isPublicSite } from "./discovery.js";
import { inCoverage } from "./radio.js";
import { registerCombatHandler } from "./combat.js";
import { fightNow } from "./defences.js";
import { tacticalStyleFor } from "./breakoff.js";
import { battleTypes } from "./zombietypes.js";

export const BIRTH = {
  RUMOUR_BASE: 12, RUMOUR_TEAM: 6, // ears near a new site: a base within 12 tiles, a team in the field within 6
  FIGHT_MIN: 6, FIGHT_MAX: 12, FIGHT_PER: 80, // the dead you fight: 6 + 1 per 80 gathered, at most 12 (a hive: 10–18 + the Broodmother)
  FIGHT_POWER: 2, FIGHT_TOUGH: 0.6, // their power: 2 + 0.6 × the ground's toughness (as a growth's guard; a hive's brood is 5+)
  KILL_SHARE: 0.3,   // of the mass, the share cut down when it breaks (the rest scatter)
  SCATTER: 5,        // tiles the rest run off
  SCATTER_DAYS: 6,   // days they stay away from the site
  SETBACK: 0.4,      // a hive under way loses this share of the dead gone into it (at least SETBACK_MIN)
  SETBACK_MIN: 150,
  PAUSE_DAYS: 10,    // days the hives stop feeding a broken site
  REPICK_DAYS: 30,   // a site given up: no new site for at least this many days
  STALE_DAYS: 3,     // a report older than this: the map's estimate gets a "?"
  START_GUESS: 5,    // days a gathering not started yet is guessed to need before it starts
};

// ---------- the watch ----------
const watch = (state) => state.hiveWatch || (state.hiveWatch = {});
export const watchOf = (state, siteId) => watch(state)[siteId] || null;
const live = (state, tile) => !!(state.live && state.live.has(tile));
const massOf = (state, site) => state.hordes.filter((h) => h.role === "mass" && h.site === site.id);
const massSize = (state, site) => massOf(state, site).reduce((a, h) => a + h.size, 0);
const watched = (s) => !s.hardcore; // hardcore's first-year sites and the military's hive have their own calls

// "near Millbrook" (the nearest place everyone knows within 6 tiles), else the ground as tileLabel names it.
export function placeNear(state, tile) {
  const t = state.tiles[tile];
  if (t.loc && isPublicSite(state, tile)) return `at ${t.loc.name}`;
  let best = null, bd = 99;
  for (const id of state.grid.within(tile, 6)) {
    const d = state.grid.distance(tile, id);
    if (d < bd && state.tiles[id].loc && isPublicSite(state, id)) { best = state.tiles[id].loc; bd = d; }
  }
  return best ? `near ${best.name}` : `on the ${tileLabel(state, tile)}`;
}

// Called every hour (world.js tickHour, after the map's vision): new sites, gatherings coming into view, sites gone.
export function hiveBirthHour(state) {
  if (!state.hiveSites || state.timelapse) return;
  const W = watch(state);
  for (const s of state.hiveSites) {
    if (!watched(s)) continue;
    let w = W[s.id];
    if (!w) { w = W[s.id] = { tile: s.tile, rumour: null, seen: null, card: false, marked: false, broken: 0 }; rumour(state, s, w); }
    if (!w.card && gatheringKnown(state, s)) {
      w.card = true;
      w.seen = day(state);
      addCard(state, massingCard(state, s));
    }
  }
  for (const key of Object.keys(W)) {
    if (state.hiveSites.some((s) => String(s.id) === key)) continue;
    const w = W[key];
    delete W[key];
    const hive = hiveAt(state, w.tile);
    if (hive && (w.card || w.marked)) addCard(state, bornCard(state, hive, w));
    else if (hive && w.rumour != null) log(state, `Travellers say the dead have finished their hive ${placeNear(state, w.tile)}.`, "danger");
  }
}

// Ears near the new site: your radio network over it, a base or a team nearby.
function rumour(state, s, w) {
  const g = state.grid;
  const heard = inCoverage(state, s.tile) || state.bases.some((b) => g.distance(b.tile, s.tile) <= BIRTH.RUMOUR_BASE) ||
    state.parties.some((p) => p.owner === "player" && p.path && g.distance(partyTile(p), s.tile) <= BIRTH.RUMOUR_TEAM);
  if (!heard) return;
  w.rumour = day(state);
  log(state, `Travellers talk of the dead drifting toward ${placeNear(state, s.tile).replace(/^(near|at|on the) /, "")}: something is being built out there.`, "danger");
}

// The gathering as the player knows it: in view now with the dead on it, or a report of the site in the knowledge.
function gatheringKnown(state, s) {
  if (live(state, s.tile)) return massSize(state, s) > 0 || s.biomass > 0;
  const k = state.knowledge && state.knowledge[s.tile];
  return !!(k && k.site && (k.hordeSize > 0 || k.site.biomass > 0));
}

// ---------- what the player knows of a site (the map's marker, the tile panel, the alert) ----------
// null when the player knows of no site on this tile. days: until the hive stands (as of now, from the last look).
export function siteView(state, tile) {
  if (live(state, tile)) {
    const s = (state.hiveSites || []).find((x) => x.tile === tile);
    if (!s) return null;
    const mass = massSize(state, s);
    return { live: true, biomass: s.biomass, started: s.started != null, mass, age: 0, days: etaDays(s.biomass, s.started != null, mass), sure: true, siteId: s.id };
  }
  const k = state.knowledge && state.knowledge[tile];
  if (!k || !k.site) return null;
  const age = Math.max(0, (state.hour - k.hour) / 24);
  const days = Math.ceil(etaDays(k.site.biomass, !!k.site.started, k.hordeSize || 0) - age);
  return { live: false, biomass: k.site.biomass, started: !!k.site.started, mass: k.hordeSize || 0, age, days, sure: age <= BIRTH.STALE_DAYS, siteId: null };
}
// Days until 1,000 of the dead have gone in: at most 40 a day once started (a quarter of the mass, at least 25),
// about 32 a day on average while the hives keep it fed; a gathering not started yet needs a few days more first.
export function etaDays(biomass, started, mass) {
  const left = Math.max(0, HIVE.SITE_BIOMASS - (biomass || 0));
  const rate = mass >= 160 ? HIVE.SITE_INTAKE : 32;
  return Math.ceil(left / rate) + (started ? 0 : BIRTH.START_GUESS);
}
// The map's line under the mound: "Hive in ~12 days", "Massing · hive in ~30 days", with "?" when the look is old.
export function buildSiteLabel(state, tile) {
  const v = siteView(state, tile);
  if (!v) return "";
  const q = v.sure ? "" : "?";
  if (v.days <= 0) return v.live ? "Hive any day now" : "Hive due?";
  return v.started ? `Hive in ~${v.days} day${v.days === 1 ? "" : "s"}${q}` : `Massing · hive in ~${v.days} days${q}`;
}
// The tile panel's text for the site: what is gathered, the estimate, how old the look is.
export function siteText(state, tile) {
  const v = siteView(state, tile);
  if (!v) return "";
  const seen = v.live ? "" : ` (seen ${v.age < 1 ? "today" : `${Math.floor(v.age)} day${Math.floor(v.age) === 1 ? "" : "s"} ago`}${v.sure ? "" : ": a guess"})`;
  return `${v.mass ? `${Math.round(v.mass)} dead massed · ` : ""}${v.days <= 0 ? "the hive may stand by now" : `a hive in about ${v.days} day${v.days === 1 ? "" : "s"}`}${seen}`;
}
export const isMarked = (state, tile) => Object.values(watch(state)).some((w) => w.marked && w.tile === tile);

// ---------- the cards ----------
function massingCard(state, s) {
  const v = siteView(state, s.tile) || { mass: massSize(state, s), days: etaDays(s.biomass, s.started != null, massSize(state, s)), started: s.started != null };
  const f = gatheringForce(state, s, v.mass);
  const where = placeNear(state, s.tile);
  const mark = (st) => { const w = watchOf(st, s.id); if (w) w.marked = true; };
  const h = hub(state);
  return {
    title: `The dead are massing ${where}`,
    where: tileLabel(state, s.tile),
    hiveSite: s.id,
    text: `${v.mass ? `About ${Math.round(v.mass)} of the dead` : "The dead"} stand packed together in the open ${where}, and more drift in from the hives nearby. ` +
      `${v.started ? "They have started to grow a mound of their own bodies" : "They are gathering for something"}: left alone, a new hive will stand here in about ${v.days} days. ` +
      `Breaking the gathering up now is a much smaller fight than storming a hive later: about ${f.count} of them at the edge of the mass, no ${BOSS_NAMES.hive}.`,
    choices: [
      {
        label: "Break it up: plan a Cull horde team…",
        hint: `Opens the planner aimed at the gathering (Cull horde). There, Break up the gathering is a battle against about ${f.count} of the dead (power ${f.power}). Win and they scatter: ${v.started ? `the hive under way loses ${Math.round(BIRTH.SETBACK * 100)}% of what has gone in and the hives stop feeding it for ${BIRTH.PAUSE_DAYS} days` : "the site is given up before the hive is begun"}. Also marks it`,
        disabled: !h,
        uiAction: { type: "plan", tile: s.tile, mission: "cull" },
        ai: () => -5, // the autopilot sends its own squad (gatheringCands)
        resolve: (st) => { mark(st); return ""; },
      },
      {
        label: "Mark it and watch it",
        hint: "An alert tracks the gathering and the days left until the hive stands (as far as you know); the map marks it with a red ring",
        default: true,
        ai: () => 5,
        resolve: (st) => { mark(st); return "Marked on the map. The alerts track it."; },
      },
      { label: "Ignore it", hint: "It stays on the map as far as you have seen it; no alert", ai: () => 0, resolve: () => "Nobody wants to think about it." },
    ],
  };
}

function bornCard(state, hive, w) {
  const where = placeNear(state, hive.tile);
  const seen = live(state, hive.tile);
  if (seen) state.knowledge[hive.tile] = snapshot(state, hive.tile);
  return {
    title: `A new hive ${where}`,
    where: tileLabel(state, hive.tile),
    text: `${seen ? "Your people watched it happen" : "Word comes in from the road"}: the dead ${where} have finished their mound, and a new hive stands there${w.broken ? ` (you broke them up ${w.broken === 1 ? "once" : `${w.broken} times`}, and they came back)` : ""}. It will breed hordes of its own and hold the land around it. ${hivesLeftText(state)}`,
    choices: [
      {
        label: "Plan an attack (Destroy hive)…", hint: "Opens the planner aimed at the new hive. A young hive has a small guard and no growths yet: it is never easier than now",
        disabled: !hub(state), uiAction: { type: "plan", tile: hive.tile, mission: "hive" }, ai: () => -5, resolve: () => "",
      },
      { label: "Not now", hint: "It stays on the map", default: true, ai: () => 1, resolve: () => "Another one. The list gets longer." },
    ],
  };
}

// ---------- breaking the gathering up (the Cull horde mission at a site: parties.js cullCard) ----------
// The fight: the edge of the mass, as a growth's guard on its ground (tougher inside a hive's land).
export function gatheringForce(state, site, mass = null) {
  const m = mass == null ? massSize(state, site) : mass;
  const count = Math.max(BIRTH.FIGHT_MIN, Math.min(BIRTH.FIGHT_MAX, BIRTH.FIGHT_MIN + Math.floor(m / BIRTH.FIGHT_PER)));
  const power = Math.round((BIRTH.FIGHT_POWER + zombieToughness(state, site.tile) * BIRTH.FIGHT_TOUGH) * 10) / 10;
  const big = massOf(state, site).sort((a, b) => b.size - a.size)[0];
  return { count, power, types: big && big.mix ? battleTypes(big.mix, count) : null, elite: !!(big && big.elite), mass: m };
}

// cullCard (parties.js) at a horde gathered at a build site: the card is about the gathering, with Break up first.
export function gatheringCull(state, p, horde, card) {
  const site = horde.role === "mass" ? siteById(state, horde.site) : null;
  if (!site || !watched(site)) return card;
  const f = gatheringForce(state, site);
  const gone = (st) => !st.hiveSites.includes(site) || !massOf(st, site).length;
  card.gathering = site.id;
  card.title = `The dead massing ${placeNear(state, site.tile)}`;
  card.text = `${card.text} This is the gathering for a new hive${site.started != null ? ", and the mound is already growing" : ""}: break it up and the dead scatter.`;
  card.choices.unshift({
    label: "Break up the gathering (tactical battle)",
    hint: `About ${f.count} of the dead at the edge of the mass (power ${f.power}), no ${BOSS_NAMES.hive}. Win and they scatter: ${site.started != null ? `the hive under way loses ${Math.round(BIRTH.SETBACK * 100)}% of what has gone in and starts over, unfed for ${BIRTH.PAUSE_DAYS} days` : "the site is given up"}. You can fall back from the left edge`,
    resolve: (st) => {
      if (gone(st)) { awaitOrders(st, p, "The gathering had already broken up.", { failed: true }); return "Nothing is left to break up."; }
      const force = gatheringForce(st, site);
      fightNow(st, {
        tile: site.tile, partyId: p.id,
        enemy: { kind: "zombies", count: force.count, power: force.power, types: force.types, elite: force.elite, name: "the dead massing for a hive" },
        ambush: null, canRetreat: true, handler: "gatheringBreak",
        aiStyle: tacticalStyleFor(st, p), // played headless: the team's retreat policy as the AI's style (breakoff.js)
        context: { siteId: site.id, partyId: p.id, count: force.count },
      });
      return "";
    },
  });
  return card;
}

// The gathering breaks: KILL_SHARE of the mass falls, the rest scatter SCATTER tiles away from your bases and stay off
// for SCATTER_DAYS; the hordes still on their way are called off. Not started: the site is given up. Started: it
// loses SETBACK of what has gone in, starts again from a score of 0 and is not fed for PAUSE_DAYS. Returns a line.
export function breakGathering(state, site, how = "") {
  ensureHives(state);
  if (!state.hiveSites.includes(site)) return "";
  const g = state.grid;
  const mass = massOf(state, site);
  const total = mass.reduce((a, h) => a + h.size, 0);
  let killed = 0;
  // Where they run: land tiles SCATTER out, the farthest from your hub first, spread round the ring.
  const h0 = hub(state);
  const ring = g.within(site.tile, BIRTH.SCATTER).filter((id) => g.distance(id, site.tile) === BIRTH.SCATTER && (state.tiles[id].terrain !== "water" || state.tiles[id].bridge))
    .sort((a, b) => (h0 ? g.distance(b, h0.tile) - g.distance(a, h0.tile) : 0) || a - b);
  const goals = [];
  for (const id of ring) if (goals.length < 3 && goals.every((x) => g.distance(x, id) >= 3)) goals.push(id);
  mass.forEach((h, i) => {
    const k = Math.round(h.size * BIRTH.KILL_SHARE);
    killed += Math.min(h.size, k);
    if (reduceHorde(state, h, k)) return;
    h.role = "roam"; h.site = null; h.hive = null; h.goal = null;
    h.target = goals.length ? goals[i % goals.length] : h.tile;
    h.lureUntil = state.hour + BIRTH.SCATTER_DAYS * 24; // hordes.js: not drawn back to a site while it runs
  });
  for (const h of state.hordes) if (h.role === "build" && h.site === site.id) { h.role = "roam"; h.site = null; h.hive = null; }
  const where = placeNear(state, site.tile);
  const w = watchOf(state, site.id);
  if (w) w.broken = (w.broken || 0) + 1;
  const stats = state.hiveInfo.stats;
  stats.broken = (stats.broken || 0) + 1;
  let text;
  if (site.started == null) {
    state.hiveSites.splice(state.hiveSites.indexOf(site), 1);
    if (w) delete watch(state)[site.id];
    state.hiveInfo.nextSiteDay = Math.max(state.hiveInfo.nextSiteDay, day(state) + BIRTH.REPICK_DAYS);
    stats.abandoned = (stats.abandoned || 0) + 1;
    text = `The dead massing ${where} broke and scattered${how ? ` ${how}` : ""}: about ${killed} of ${total} fell, and the rest have given the place up. No hive will grow there.`;
  } else {
    const lost = Math.min(site.biomass, Math.max(BIRTH.SETBACK_MIN, Math.round(site.biomass * BIRTH.SETBACK)));
    site.biomass -= lost;
    site.score = 0;
    site.started = null;
    site.brokenUntil = state.hour + BIRTH.PAUSE_DAYS * 24; // hives.js siteResting: nobody feeds it for a while
    text = `The dead massing ${where} broke and scattered${how ? ` ${how}` : ""}: about ${killed} of ${total} fell, and ${lost} of the dead were torn out of the half-grown mound. The hive there has to start over (${Math.round(site.biomass)} of ${HIVE.SITE_BIOMASS} left in it).`;
  }
  log(state, text, "good");
  return text;
}

registerCombatHandler("gatheringBreak", (state, result, setup) => {
  const c = setup.context;
  const site = siteById(state, c.siteId);
  const p = state.parties.find((x) => x.id === c.partyId);
  let text;
  if (result.outcome === "victory" && site) text = breakGathering(state, site, "by your team");
  else {
    // Fell back: what they cut down is gone from the mass (a share of it, by the fight's count), the gathering stands.
    if (site && result.enemiesKilled) {
      const mass = massOf(state, site), total = mass.reduce((a, h) => a + h.size, 0);
      let cut = Math.round((total * BIRTH.KILL_SHARE * result.enemiesKilled) / Math.max(1, c.count));
      for (const h of mass) { if (cut <= 0) break; const k = Math.min(h.size, cut); cut -= k; reduceHorde(state, h, k); }
    }
    text = result.outcome === "retreat" ? "The team fell back from the gathering. The dead close ranks again." : "The gathering swallowed the attack: the team was driven off.";
  }
  if (!p || !state.parties.includes(p)) return;
  p.seen.set(setup.tile, snapshot(state, setup.tile));
  if (wipeIfEmpty(state, p)) { log(state, "The whole team was lost trying to break up a gathering of the dead.", "death"); return; }
  if (result.outcome !== "victory") log(state, `${text} (${tileLabel(state, partyTile(p))})`, "danger");
  awaitOrders(state, p, text || "The gathering is gone.");
});

// ---------- the alerts (ui/alerts.js) ----------
// One per marked gathering you still know of: the days left as far as you know, red under a week.
export function gatheringAlerts(state) {
  const out = [];
  for (const [id, w] of Object.entries(watch(state))) {
    if (!w.marked) continue;
    const v = siteView(state, w.tile);
    if (!v) continue;
    const soon = v.days <= 7;
    out.push({
      key: `gathering:${id}`, kind: "gathering", icon: "🪱", tone: soon ? "danger" : "warn",
      text: `Dead massing ${placeNear(state, w.tile)}: ${v.days <= 0 ? "hive due" : `hive in ~${v.days} days`}${v.sure ? "" : "?"}`,
      tip: `${siteText(state, w.tile)}. Send a Cull horde team there and Break up the gathering before the hive stands. Click to see it.`,
      go: { tile: w.tile },
    });
  }
  return out;
}

// ---------- the autopilot (autopilot.js planTrip) ----------
// A Cull horde trip to a gathering it knows of: within its reach (its style's range, Aggressive half again as far),
// when its best CREW fighters have the odds against the fight (value: the autopilot's storm value of a fighter,
// against count × power / 5.2 as for a hive's brood; Aggressive takes worse odds). One such trip at a time.
export const AUTO = { crew: 4, health: 70, score: 4.2, aggressiveScore: 5, oddsCautious: 1.2, oddsAggressive: 0.9 };
export function gatheringCands(state, home, pool, P, value) {
  if (!home || !state.hiveSites || state.parties.some((p) => p.owner === "player" && p.apGathering != null)) return [];
  const out = [];
  for (const s of state.hiveSites) {
    if (!watched(s)) continue;
    const v = siteView(state, s.tile);
    if (!v || !v.mass) continue;
    if (state.grid.distance(home.tile, s.tile) > P.range * (P.raid ? 1.5 : 1.15)) continue;
    const f = gatheringForce(state, s, v.mass);
    const squad = pool.filter((x) => x.health >= AUTO.health && !x.woundInfected).sort((a, b) => value(b) - value(a)).slice(0, AUTO.crew);
    if (squad.length < 3) continue;
    const odds = squad.reduce((a, x) => a + value(x), 0) / (f.count * (f.power / 5.2));
    if (odds < (P.raid ? AUTO.oddsAggressive : AUTO.oddsCautious) * P.hiveOdds) continue;
    out.push({
      mission: "cull", tile: s.tile, score: P.raid ? AUTO.aggressiveScore : AUTO.score, crew: AUTO.crew, squadMin: 3, gathering: s.id,
      why: `break up the dead massing ${placeNear(state, s.tile)} before they build a hive (odds ${odds.toFixed(2)})`,
      supplies: { ammo: AUTO.crew * 15 }, fit: (x) => (x.health >= AUTO.health && !x.woundInfected ? value(x) * 5 : -99),
    });
  }
  return out;
}

// ---------- help (ui/help.js) ----------
export const HIVE_BIRTH_HELP = `New hives are not born in silence. When the hives pick a place for a new one you may hear of it: a rumour in the log and the diary if the place is inside your radio coverage, within ${BIRTH.RUMOUR_BASE} tiles of a base of yours or within ${BIRTH.RUMOUR_TEAM} of a team in the field. Once your people see the dead massing there (a base's sight, a team in radio contact, or a team's report when it gets home) a card asks what to do: <i>break it up</i> (the planner opens aimed at the gathering with the Cull horde mission), <i>mark it</i> (an alert tracks it) or ignore it. On the map the raw mound grows with the dead gathered there, with a red bar of the ${HIVE.SITE_BIOMASS} that must go in and a line under it: how many days until the hive stands, as far as you know (from what you see now, or from the last report less the days since; a "?" once that report is more than ${BIRTH.STALE_DAYS} days old). A marked gathering has a red ring.<br>
<b>Breaking up a gathering:</b> a Cull horde team at the mass gets <i>Break up the gathering</i>: a battle against ${BIRTH.FIGHT_MIN}–${BIRTH.FIGHT_MAX} of the dead at the edge of it (one more per ${BIRTH.FIGHT_PER} gathered; power ${BIRTH.FIGHT_POWER}, more on a hive's land), with no Broodmother: far smaller than storming a hive. Win and the gathering scatters: ${Math.round(BIRTH.KILL_SHARE * 100)}% of it falls and the rest run ${BIRTH.SCATTER} tiles off for ${BIRTH.SCATTER_DAYS} days. Before the mound is begun (the hordes delivered there add up to a score of ${HIVE.SITE_SCORE}) the site is given up, and no new site is picked for at least ${BIRTH.REPICK_DAYS} days; once it is under way it loses ${Math.round(BIRTH.SETBACK * 100)}% of the dead gone into it (at least ${BIRTH.SETBACK_MIN}), has to gather a score of ${HIVE.SITE_SCORE} again and the hives stop feeding it for ${BIRTH.PAUSE_DAYS} days. The plain killzone still thins the mass without a battle. If a hive you knew of rises anyway, a card says so and offers to plan the attack.`;
