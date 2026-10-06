// Other groups scavenge too, and nothing grows back.
//
// Site loot (tile.loot) is a finite resource everyone shares: nothing raises it after the map is made. Your teams
// lower it when they search (scavenge.js) or raid (combat.js); the other groups lower it here. The only "new" loot
// is a temporary event site (a crash or a supply drop, crashes.js), which burns out again.
//
//   Scavenging parties: a group with AISCAV.minPop+ people sends one party at a time, every AISCAV.gapMin–gapMax
//     days, when it is short of something (need of a good = 1 − stock / want, wants in groupWants; it goes when the
//     biggest need is AISCAV.minNeed+). The party (strength pop × AISCAV.share, at least 2, on foot, shown on the
//     map like any group party) walks to the best site within AISCAV.range tiles of one of its bases: score = the
//     site's loot table weighted by need (+ AISCAV.baseWant for anything) × loot left / (1 + distance / 5). Never a
//     base, a hive, a crash site, a tile with a horde, land held by you or another group, a site with loot below
//     AISCAV.minLoot or one another of their parties is working.
//     At the site it searches AISCAV.searchHours hours, taking AISCAV.take of the loot an hour (× its strength / 3,
//     0.5–AISCAV.crewMax) down to AISCAV.floor; per point of loot taken it finds what one of your teams would (the
//     hour-by-hour search: 6.5 × loot left per 0.05, ammo × 6, scrap × 2.5, fuel × 0.7, jars × 2) × AISCAV.eff, split
//     by the site's loot table. A big group's party (strength 4–6, up to 1.5 × a party of 3) crowds one site: it strips
//     it no faster than a party of 3 but picks it cleaner (its haul × hands / 1, as before). When it stripped faster,
//     the worlds where the groups thrive and grow were picked down to a quarter of the map's loot within a year (1 in
//     20 below it). Then it walks home and the haul goes into the group's stock.
//     Losses: a horde on its way (or at the site) costs it a quarter of its strength and a quarter of what it
//     carries; raiders near their own base may ambush it on the way home (12% a tile) and take the haul; a party
//     brought below strength 1 is gone with its haul.
//     Contested sites: a team of yours on the same site (not in the middle of its own search) gets a conflict card
//     ("A contested site", conflicts.js), once per party and team, unless the group is friendly or allied or has a
//     pact with you; while your team searches there, the party waits. Win the fight and they leave the site (what
//     they carried goes into your cargo, as far as it fits).
//   Their own land: every site a group holds (tile.owner) loses AISCAV.landRate of its loot a day (relative, down to
//     the floor), into the group's stock at AISCAV.landEff (no party, no risk).
//   Production from nothing (factions.js) is cut to FACTION_MAKE of what it was: the rest comes from the sites.
//   What you learn: only what you see. The map and the tile panel show the loot you last saw (with its age), so a
//     site stripped since still looks rich until a team, a base, recon or the radio tells you otherwise. News: when a
//     party took AISCAV.newsTake+ from a site within AISCAV.newsRange tiles of one of your bases (or it dropped a
//     band), a line in the log: seen live ("Red Hand scavengers are stripping the Calder Mall."), or with a radio
//     station at one of your bases "On the radio: Red Hand has been stripping the Calder Mall." (one a day at most,
//     a site at most every AISCAV.newsGap days); the radio line also updates the loot you know there (only the loot,
//     knowledge.lootHour / lootSrc "radio"; the rest of what you know keeps its age).
// Decisions use hash01 (skills.js), never the world's random numbers, so the rest of a run draws the same dice.
import { LOCATIONS, FACTION_TYPES } from "./data.js";
import { log, factionById } from "./world.js";
import { spawnAiParty, planPath, partyTile, partyMembers, tileLabel, removeParty } from "./parties.js";
import { hash01 } from "./skills.js";
import { attitude } from "./factions.js";
import { triggerConflict } from "./conflicts.js";
import { ZONE_RICHNESS } from "./mapgen.js";
import { haulMult } from "./medfinds.js";

export const AISCAV = {
  minPop: 6, gapMin: 6, gapMax: 10, retry: 3, minNeed: 0.25, baseWant: 0.15, range: 10, share: 0.12,
  searchHours: 8, take: 0.03, floor: 0.03, minLoot: 0.12, eff: 0.8, perLoot: 130, crewMax: 1,
  landRate: 0.003, landEff: 0.5, newsTake: 0.12, newsRange: 15, newsGap: 10,
};
// Share of the old production from nothing a group keeps (factions.js factionsDaily): ammo, scrap, fuel, meds.
export const FACTION_MAKE = 0.4;
// Units per find by good (the same multipliers as the hour-by-hour search, scavenge.js).
const MULT = { ammo: 6, scrap: 2.5, fuel: 0.7, jars: 2 };

// ---------- loot bands (tile panel, map sprites) ----------
// What a site holds when untouched: its type's richness × its zone (mapgen.js; the dice put it at 0.7–1.2 of that).
export function siteFull(t) {
  if (!t || !t.loc) return { city: 0.4, suburb: 0.3, plains: 0.12, forest: 0.08, hills: 0.08 }[t && t.terrain] || 0.1;
  const def = LOCATIONS[t.loc.type];
  if (!def) return 1;
  return def.richness * (t.loc.type === "town" ? 1 : ZONE_RICHNESS[t.loc.zone] || 1);
}
// Bands of what is left, against what the site held untouched: 0 rich (60%+), 1 some (30%+), 2 little (10%+),
// 3 picked clean.
export const LOOT_BANDS = ["Rich", "Some", "Little", "Picked clean"];
export function lootBand(t, loot) {
  if (loot == null) return 0;
  const r = loot / Math.max(0.05, siteFull(t));
  return loot <= AISCAV.floor + 0.02 || r < 0.1 ? 3 : r < 0.3 ? 2 : r < 0.6 ? 1 : 0;
}

// ---------- state ----------
export function aiScav(state) {
  if (!state.aiScav) state.aiScav = { stats: { trips: 0, home: 0, lost: 0, ambushed: 0, taken: 0, land: 0, contests: 0, news: 0, goods: 0 }, newsDay: -1, newsAt: {} };
  return state.aiScav;
}
const roll = (state, ...k) => hash01(state.seed, "aiscav", ...k);

// How much of each good a group wants on hand (needs: 1 − stock / want).
export function groupWants(f) {
  const arms = FACTION_TYPES[f.type] ? FACTION_TYPES[f.type].arms : 1;
  return { food: f.pop * 10, ammo: f.pop * 20 * arms, scrap: f.pop * 6, fuel: f.pop * 2, meds: f.pop * 2, parts: 3 + f.pop * 0.2, preserved: f.pop, water: 0, jars: 0 };
}
export function groupNeeds(f) {
  const want = groupWants(f), out = {};
  for (const [k, w] of Object.entries(want)) out[k] = w > 0 ? Math.max(0, Math.min(1, 1 - (f.stock[k] || 0) / w)) : 0;
  return out;
}

// Goods found for `taken` loot from a site whose loot was `level` before (expected values, no dice).
// Meds are rare away from medical sites (medfinds.js haulMult): there the meds weight of the site's table is cut to a
// quarter and the share it loses goes to the site's other goods, so a haul brings home the same number of finds
// (perLoot) either way, only fewer of them meds. Cutting the meds alone made every group poorer for it.
export function haulFor(t, taken, level, eff) {
  const table = t.loc && LOCATIONS[t.loc.type] ? LOCATIONS[t.loc.type].loot : { scrap: 2, food: 1 };
  const mm = haulMult(t);
  const weights = {};
  for (const [k, w] of Object.entries(table)) weights[k] = w * (k === "meds" ? mm : 1);
  const total = Object.values(weights).reduce((a, v) => a + v, 0) || 1;
  const units = taken * AISCAV.perLoot * Math.max(0, level) * eff;
  const out = {};
  for (const [k, w] of Object.entries(weights)) out[k] = units * (w / total) * (MULT[k] || 1);
  return out;
}
const addTo = (into, goods, k = 1) => { for (const [g, q] of Object.entries(goods)) into[g] = (into[g] || 0) + q * k; };

// Can a group's party work this site?
function workable(state, f, t) {
  if (!t.loc || t.loc.crash || t.hive || t.terrain === "water") return false;
  if ((t.loot || 0) < AISCAV.minLoot) return false;
  if (t.owner != null && t.owner !== f.id) return false; // your land or another group's
  if (state.bases.some((b) => b.tile === t.id)) return false;
  if (state.factions.some((o) => o.alive && o.bases.includes(t.id))) return false;
  if (state.hordes.some((h) => h.tile === t.id)) return false;
  if (state.parties.some((q) => q.kind === "scav" && q.scav && q.scav.site === t.id)) return false;
  return true;
}

// The best site for a group by its needs (or null): { tile, from, score }.
export function bestSite(state, f) {
  const g = state.grid;
  const need = groupNeeds(f);
  const seen = new Set(), cands = [];
  for (const b of f.bases) for (const id of g.within(b, AISCAV.range)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const t = state.tiles[id];
    if (!workable(state, f, t)) continue;
    const table = LOCATIONS[t.loc.type] ? LOCATIONS[t.loc.type].loot : {};
    const total = Object.values(table).reduce((a, v) => a + v, 0) || 1;
    let value = 0;
    for (const [k, w] of Object.entries(table)) value += (w / total) * (AISCAV.baseWant + (need[k] || 0));
    const from = f.bases.reduce((best, x) => (g.distance(x, id) < g.distance(best, id) ? x : best), f.bases[0]);
    const d = g.distance(from, id);
    cands.push({ tile: id, from, d, score: (value * t.loot) / (1 + d / 5) });
  }
  cands.sort((a, b) => b.score - a.score || a.tile - b.tile);
  for (const c of cands.slice(0, 4)) if (planPath(state, c.from, c.tile, false)) return c;
  return null;
}

// ---------- daily: parties out, their own land ----------
export function aiScavDaily(state) {
  if (state.aiScavOff) return; // test switch (tools/depletetest.js): groups that do not scavenge, the old economy
  const S = aiScav(state);
  state.factions.forEach((f, i) => {
    if (!f.alive || !f.bases.length) return;
    // Their own land, stripped a little every day.
    for (const id of landSites(state, f)) {
      const t = state.tiles[id];
      const take = Math.min(t.loot - AISCAV.floor, t.loot * AISCAV.landRate);
      if (!(take > 0)) continue;
      addTo(f.stock, haulFor(t, take, t.loot, AISCAV.landEff));
      t.loot -= take;
      S.stats.land += take;
    }
    // A party out.
    if (f.scavNext == null) f.scavNext = state.hour + 24 * (1 + Math.floor(roll(state, "first", i) * AISCAV.gapMax));
    if (state.hour < f.scavNext) return;
    const n = S.stats.trips + S.stats.home + i;
    if (f.pop < AISCAV.minPop || state.parties.some((q) => q.owner === f.id && q.kind === "scav")) { f.scavNext = state.hour + 24; return; }
    const need = groupNeeds(f);
    const site = Math.max(...Object.values(need)) >= AISCAV.minNeed ? bestSite(state, f) : null;
    if (!site) { f.scavNext = state.hour + 24 * AISCAV.retry; return; }
    sendParty(state, f, site.from, site.tile);
    f.scavNext = state.hour + 24 * (AISCAV.gapMin + Math.floor(roll(state, "gap", i, n, state.hour) * (AISCAV.gapMax - AISCAV.gapMin + 1)));
  });
}
// Sites inside a group's land (including the ones it lives on).
export function landSites(state, f) {
  const out = [];
  const seen = new Set();
  for (const b of f.bases) for (const id of state.grid.within(b, 2)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const t = state.tiles[id];
    if (t.owner === f.id && t.loc && !t.loc.crash) out.push(id);
  }
  return out;
}

export function sendParty(state, f, from, site) {
  const q = spawnAiParty(state, f, "scav", from, site, { strength: Math.max(2, Math.round(f.pop * AISCAV.share)) });
  if (!q) return null;
  q.scav = { site, home: from, left: AISCAV.searchHours, got: {}, taken: 0, str0: q.strength, met: [], band0: lootBand(state.tiles[site], state.tiles[site].loot) };
  aiScav(state).stats.trips++;
  return q;
}

// ---------- hourly (parties.js aiPartyHour) ----------
// The party reached the end of its path: the site (start searching) or home (the haul goes into the stock).
export function scavArrived(state, p) {
  const f = factionById(state, p.owner);
  if (p.phase === "home") {
    const S = aiScav(state);
    if (f && f.alive) {
      for (const [k, q] of Object.entries(p.scav.got)) f.stock[k] = (f.stock[k] || 0) + Math.floor(q);
      S.stats.goods += Object.values(p.scav.got).reduce((a, q) => a + Math.floor(q), 0);
    }
    S.stats.home++;
    removeParty(state, p);
    return;
  }
  p.phase = "search";
  const t = state.tiles[p.scav.site];
  if (t.infection > 0.5) p.strength *= 0.9; // the dead are thick here
  contest(state, p);
}

// One hour at the site.
export function scavSearchHour(state, p) {
  const t = state.tiles[p.scav.site];
  const horde = state.hordes.find((h) => h.tile === t.id);
  if (horde) {
    p.strength *= 0.75;
    for (const k of Object.keys(p.scav.got)) p.scav.got[k] *= 0.75;
    horde.size = Math.max(0, horde.size - Math.round(p.strength * 0.6));
    if (horde.size < 5) state.hordes.splice(state.hordes.indexOf(horde), 1);
    if (p.strength < 1) { lose(state, p); return; }
    return goHome(state, p); // they pull out with what they have
  }
  // Your team searching here: they wait it out (and challenge it when it is done).
  const busy = contest(state, p);
  if (!busy) {
    const hands = Math.max(0.5, Math.min(1.5, p.strength / 3));
    const crew = Math.min(AISCAV.crewMax, hands); // more hands than that pick it cleaner, not faster
    const take = Math.min(Math.max(0, t.loot - AISCAV.floor), AISCAV.take * crew);
    if (take > 0) {
      addTo(p.scav.got, haulFor(t, take, t.loot, AISCAV.eff * hands / crew));
      t.loot -= take;
      p.scav.taken += take;
      aiScav(state).stats.taken += take;
    }
  }
  p.scav.left -= 1;
  if (p.scav.left <= 0 || t.loot <= AISCAV.floor + 1e-9) {
    news(state, p);
    goHome(state, p);
  }
}

function goHome(state, p) {
  const f = factionById(state, p.owner);
  const site = p.scav.site;
  const home = f && f.bases.length ? f.bases.reduce((b, x) => (state.grid.distance(x, site) < state.grid.distance(b, site) ? x : b), f.bases[0]) : p.scav.home;
  const res = planPath(state, site, home, false);
  p.phase = "home";
  p.scav.home = home;
  if (!res || res.path.length < 2) { scavArrived(state, p); return; }
  p.path = res.path;
  p.idx = 0;
  p.progress = 0;
}

// A horde or the road got the party: it is gone, and its haul with it.
export function lose(state, p) {
  aiScav(state).stats.lost++;
  removeParty(state, p);
}

// Raiders near their base ambush a party carrying a haul home: they take it (parties.js aiPartyHour).
export function ambushHaul(state, p, raiders) {
  for (const [k, q] of Object.entries(p.scav.got)) raiders.stock[k] = (raiders.stock[k] || 0) + Math.floor(q);
  aiScav(state).stats.ambushed++;
}

// A team of yours on the site. Returns true while one of your teams is searching there (the party waits).
function contest(state, p) {
  const f = factionById(state, p.owner);
  const tile = p.scav.site;
  let busy = false;
  for (const team of state.parties) {
    if (team.owner !== "player" || team.kind === "convoy" || partyTile(team) !== tile || !partyMembers(state, team).length) continue;
    if (team.phase === "engaged" || (state.engagement && !state.engagement.done && state.engagement.partyId === team.id)) { busy = true; continue; }
    if (!f || p.scav.met.includes(team.id) || state.cards.some((c) => c.partyId === team.id)) continue;
    p.scav.met.push(team.id);
    const att = attitude(f);
    if (f.pact || att === "Friendly" || att === "Allied") {
      if (f.known) log(state, `${f.name} scavengers are working ${tileLabel(state, tile)} next to your team; they keep to their side.`, "info");
      continue;
    }
    const card = triggerConflict(state, team, "contest", f.id, { scavPartyId: p.id, site: tile });
    if (card) {
      aiScav(state).stats.contests++;
      log(state, `${f.known ? f.name : "Another group"}'s scavengers reached ${tileLabel(state, tile)} while your team was there.`, "danger");
    }
  }
  return busy;
}

// You won the fight over a site: the party leaves, and its haul goes into the team's cargo as far as it fits.
export function driveOff(state, team, scavPartyId, addCargo) {
  const q = state.parties.find((x) => x.id === scavPartyId && x.kind === "scav");
  if (!q) return "";
  const got = [];
  for (const [k, n] of Object.entries(q.scav.got)) {
    const qty = Math.floor(n);
    if (qty < 1) continue;
    const took = addCargo(state, team, k, qty);
    if (took > 0) got.push(`${took} ${k}`);
  }
  removeParty(state, q);
  return `Their scavengers left ${tileLabel(state, q.scav.site)}${got.length ? `, dropping what they had found: ${got.join(", ")}` : ""}.`;
}

// ---------- news ----------
function news(state, p) {
  const t = state.tiles[p.scav.site];
  const f = factionById(state, p.owner);
  const S = aiScav(state);
  const dropped = lootBand(t, t.loot) > p.scav.band0;
  if (!f || (p.scav.taken < AISCAV.newsTake && !dropped)) return;
  const near = state.bases.some((b) => state.grid.distance(b.tile, t.id) <= AISCAV.newsRange);
  const live = state.live && state.live.has(t.id);
  if (!near && !live) return;
  const radio = state.bases.some((b) => b.radio);
  if (!live && !radio) return;
  const today = Math.floor(state.hour / 24);
  const last = S.newsAt[t.id];
  if (S.newsDay === today || (last != null && today - last < AISCAV.newsGap)) return;
  S.newsDay = today;
  S.newsAt[t.id] = today;
  S.stats.news++;
  const who = f.known ? f.name : "a group nobody knows";
  if (live) log(state, `${who[0].toUpperCase() + who.slice(1)} scavengers are stripping ${tileLabel(state, t.id)} (${LOOT_BANDS[lootBand(t, t.loot)].toLowerCase()} left).`, "info");
  else {
    log(state, `On the radio: ${who} has been stripping ${tileLabel(state, t.id)}.`, "info");
    // You know it is (nearly) stripped now; the rest of what you know of the place keeps its age.
    const k = state.knowledge[t.id];
    if (k) state.knowledge[t.id] = { ...k, loot: t.loot, lootHour: state.hour, lootSrc: "radio" };
  }
}

// ---------- totals (tests, devtools) ----------
export function siteLootTotal(state) {
  let s = 0;
  for (const t of state.tiles) if (t.loc && !t.loc.crash) s += t.loot || 0;
  return s;
}
