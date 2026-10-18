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
//   Carts (carts.js, coarse): a party on foot takes up to two of the group's carts (f.carts) and brings home 15% more a
//     cart of what it finds (it picks the site cleaner, it does not strip it faster); a party lost loses them; one
//     comes home now and then from a farm, a barn or a hardware store.
//   Production from nothing (factions.js) is cut to FACTION_MAKE of what it was: the rest comes from the sites.
//   What you learn: only what you see. The map and the tile panel show the loot you last saw (with its age), so a
//     site stripped since still looks rich until a team, a base, recon or the radio tells you otherwise. News: when a
//     party took AISCAV.newsTake+ from a site within AISCAV.newsRange tiles of one of your bases (or it dropped a
//     band), a line in the log: seen live ("Red Hand scavengers are stripping the Calder Mall."), or with a radio
//     station at one of your bases "On the radio: Red Hand has been stripping the Calder Mall." (one a day at most,
//     a site at most every AISCAV.newsGap days); the radio line also updates the loot you know there (only the loot,
//     knowledge.lootHour / lootSrc "radio"; the rest of what you know keeps its age).
//   Points of interest (pois.js; grouppois.js keeps what each group knows of them): a party goes for one POI, the
//     site of a tile among them (its pool is tile.loot, as before). bestSite (grouppois.js groupTargets) scores every
//     POI the group knows within range by need × what is left / (1 + distance / 5), a POI that is not the site
//     × AISCAV.poiW, and tiles it may find more on with a survey (× GPOI.SURVEY_W, by what it expects there). A survey
//     stop: the party stands GPOI.HOURS on the tile (shown on the map), rolls with its group's Scouting
//     (groupSurveyTile), then raids the best POI it knows there, or goes home empty-handed. At a POI it takes through
//     poicont.js lootPoiAbstract (grouppois.js raidPoiAsGroup: the pool, the container ledger, what your people left
//     in opened containers, a little tile heat, AISCAV.AI_HEAT a raid in all), the haul by the POI's kind; picked
//     clean, it moves on to the next POI it knows on the tile. q.poi marks the POI it is in (pois.js raidingNow: the
//     dialogue's "being raided now"). A tile with no POIs but a site (a city or town centre) is searched as before.
//     Same tile as your team: raiding different POIs, nobody minds (both on the map, opposite sides of the hex); the
//     same POI (or your team in none), the contest card as before; a group at war with you contests either way.
//     Their own land's POIs fall by AISCAV.landRate a day like its sites.
// Decisions use hash01 (skills.js), never the world's random numbers, so the rest of a run draws the same dice.
import { typedFood, siteMix, shopFood, drawShop, unitsOf } from "./foods.js"; // the food a site holds, as items; the shops run down
import { supplyAmt } from "./rounds.js"; // "food": days of food (foods.js)
import { keyWord } from "./water.js"; // supplies as words: "9mm FMJ", "rounds"
import { LOCATIONS, FACTION_TYPES } from "./data.js";
import { log, factionById, localId } from "./world.js"; // localId: dice keys that do not depend on the process (two worlds in one)
import { spawnAiParty, planPath, partyTile, partyMembers, tileLabel, removeParty } from "./parties.js";
import { hash01 } from "./skills.js";
import { attitude } from "./factions.js";
import { triggerConflict } from "./conflicts.js";
import { ZONE_RICHNESS } from "./mapgen.js";
import { haulMult } from "./medfinds.js";
import { PARTS_MIX } from "./loot.js"; // car parts by the kind of site (a group keeps them apart)
import { scavFinds, partyLost } from "./arsenal.js";
import { aiCartsOut, aiCartMult, aiCartsHome, aiWorkMult } from "./carts.js"; // a group's carts (AI parity, coarse)
import { groupFindBlueprint, groupGotBlueprint } from "./groupworks.js"; // machines-2: the groups' manuals
import { prio } from "./groupcare.js";
import { poisOf, poiAt, poiPool, poiBand, isSitePoi, permanentSite } from "./pois.js"; // points of interest: one POI a party
import { groupTargets, bestGroupPoi, groupSurveyTile, groupWouldSurvey, groupKnowsPoi, raidPoiAsGroup, groupPoisDaily, poiPlace, GPOI } from "./grouppois.js"; // what the groups know of the POIs, the survey stop, the raid
import { atWarWithYou } from "./playerwars.js"; // a group at war with you contests a tile whatever POI your team is in
import { addToArsenal, arsenalWorthy } from "./arsenal.js"; // gear your people left in a container, taken home
import { scavVehicle, scavSaw } from "./groupworld.js"; // a wreck brought home now and then; the bases they saw // GROUP_PRIORITIES scavenge: how often a type sends parties out // group arsenals: weapons and armour found at the site; a party lost is people and kit lost

export const AISCAV = {
  minPop: 6, gapMin: 6, gapMax: 10, retry: 3, minNeed: 0.25, baseWant: 0.15, range: 10, share: 0.12,
  searchHours: 8, take: 0.03, floor: 0.03, minLoot: 0.12, eff: 0.8, perLoot: 130, crewMax: 1,
  landRate: 0.003, landEff: 0.5, newsTake: 0.12, newsRange: 15, newsGap: 10,
  // A party drives out (VEHICLES by the dice) when the group has the fuel: FUEL in stock, FUEL_USE of it for the trip.
  carChance: 0.5, carFuel: 6, carFuelUse: 2, VEHICLES: ["truck", "sedan", "van", "suv"],
  // Points of interest (grouppois.js): × a POI's score against a site's (1: the same scale); the tile heat a raid adds in all.
  poiW: 1, AI_HEAT: 4, landPoiEff: 0.25, // AI_HEAT: pois.js TILE_HEAT.AI (a literal here: the modules load in a cycle); landPoiEff: the haul from their land's POIs (landEff for its sites)
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
  for (const [k, w] of Object.entries(want)) out[k] = w > 0 ? Math.max(0, Math.min(1, 1 - supplyAmt(f.stock, k) / w)) : 0; // rounds.js: food and preserved in days of food (foods.js)
  return out;
}

// Goods found for `taken` loot from a site whose loot was `level` before (expected values, no dice).
// Meds are rare away from medical sites (medfinds.js haulMult): there the meds weight of the site's table is cut to a
// quarter and the share it loses goes to the site's other goods, so a haul brings home the same number of finds
// (perLoot) either way, only fewer of them meds. Cutting the meds alone made every group poorer for it.
// Food (the table's food and preserved, days of food) comes as the items the site holds (foods.js: the site's mix,
// whole items by the food dice), as much as a shop still has (shopFood: AI parity, the same shelves your teams empty),
// and the shop runs down by it (drawShop). state: null for an estimate (no dice, no shop drawn).
// kind: a POI's kind (pois.js) when it is not the tile's site: its loot table and food mix, no shop drawn down.
export function haulFor(t, taken, level, eff, state = null, kind = null) {
  const type = kind || (t.loc ? t.loc.type : null);
  const { keys, w, total } = haulWeights(type, haulMult(kind ? { loc: { type: kind } } : t));
  const units = taken * AISCAV.perLoot * Math.max(0, level) * eff;
  const out = {};
  for (let i = 0; i < keys.length; i++) out[keys[i]] = units * (w[i] / total) * (MULT[keys[i]] || 1);
  if (state && (out.food > 0 || out.preserved > 0)) {
    const shop = kind ? 1 : shopFood(state, t);
    let drawn = 0;
    for (const key of ["food", "preserved"]) {
      if (!(out[key] > 0)) continue;
      const items = typedFood(state, siteMix(type || "", key === "preserved"), out[key] * shop);
      for (const [k, q] of Object.entries(items)) { out[k] = (out[k] || 0) + q; drawn += unitsOf(k, q); }
      delete out[key];
    }
    if (!kind) drawShop(state, t, drawn);
  }
  // Car parts are a group's own stock (trade.js POOLED_KINDS): the site's share of its parts (loot.js PARTS_MIX: an
  // auto shop's are mostly car parts) comes home as car parts; the other kinds stay in the one count of parts.
  const car = out.parts && PARTS_MIX[type] ? out.parts * (PARTS_MIX[type].carparts || 0) : 0;
  if (car > 0) { out.parts -= car; out.carparts = car; }
  return out;
}
// A site type's loot table as haul weights (its meds × mm: medfinds.js haulMult) and their total, kept per type and
// cut: the tables are fixed, and every group strips its land's sites and points of interest this way every day.
const WEIGHTS = new Map();
function haulWeights(type, mm) {
  const key = `${type}|${mm}`;
  let W = WEIGHTS.get(key);
  if (!W) {
    const table = type && LOCATIONS[type] ? LOCATIONS[type].loot : { scrap: 2, food: 1 };
    const keys = [], w = [];
    for (const [k, v] of Object.entries(table)) { keys.push(k); w.push(v * (k === "meds" ? mm : 1)); }
    WEIGHTS.set(key, (W = { keys, w, total: w.reduce((a, v) => a + v, 0) || 1 }));
  }
  return W;
}
const addTo = (into, goods, k = 1) => { for (const [g, q] of Object.entries(goods)) into[g] = (into[g] || 0) + q * k; };

// Can a group's party go to this tile at all (what is left there aside: grouppois.js groupTargets weighs it)?
function tileWorkable(state, f, t) {
  if ((t.loc && (t.loc.crash || t.loc.convoy)) || t.hive || t.terrain === "water") return false; // convoy: miltrucks.js races for it itself
  if (!t.loc && !poisOf(t).length) return false;
  if (t.owner != null && t.owner !== f.id) return false; // your land or another group's
  if (state.bases.some((b) => b.tile === t.id)) return false;
  if (state.factions.some((o) => o.alive && o.bases.includes(t.id))) return false;
  if (state.hordes.some((h) => h.tile === t.id)) return false;
  if (state.parties.some((q) => q.kind === "scav" && q.scav && q.scav.site === t.id)) return false;
  return true;
}

// A tile with points of interest is raided one POI at a time (pois.js); a temporary site over them is not one.
const poiTile = (t) => poisOf(t).length > 0 && !(t.loc && !permanentSite(t));

// The best target for a group by its needs (or null): { tile, from, d, score, poi, survey } (grouppois.js
// groupTargets: poi a POI index, -1 for a survey stop, null for a site without POIs; a tile's site is its POI 0,
// scored by its tile.loot as before).
export function bestSite(state, f) {
  const need = groupNeeds(f);
  const cands = groupTargets(state, f, f.bases, { range: AISCAV.range, need, ok: (t) => tileWorkable(state, f, t), poiW: AISCAV.poiW });
  for (const c of cands.slice(0, 4)) if (planPath(state, c.from, c.tile, false)) return c;
  return null;
}

// ---------- daily: parties out, their own land ----------
export function aiScavDaily(state) {
  if (state.aiScavOff) return; // test switch (tools/depletetest.js): groups that do not scavenge, the old economy
  const S = aiScav(state);
  groupPoisDaily(state); // grouppois.js: the records of groups and bands that are gone
  state.factions.forEach((f, i) => {
    if (!f.alive || !f.bases.length) return;
    // Their own land, stripped a little every day.
    for (const id of landSites(state, f)) {
      const t = state.tiles[id];
      const take = Math.min(t.loot - AISCAV.floor, t.loot * AISCAV.landRate);
      if (!(take > 0)) continue;
      addTo(f.stock, haulFor(t, take, t.loot, AISCAV.landEff * aiWorkMult(f), state)); // carts.js: their carts haul a little more in (coarse)
      t.loot -= take;
      S.stats.land += take;
    }
    // ... and the other points of interest on it (pois.js; a site's own is its tile.loot, above).
    for (const id of landPoiTiles(state, f)) {
      const t = state.tiles[id];
      poisOf(t).forEach((_, j) => {
        if (isSitePoi(t, j) || poiPool(t, j) <= AISCAV.floor) return;
        const r = raidPoiAsGroup(state, f, t, j, poiPool(t, j) * AISCAV.landRate, { eff: AISCAV.landPoiEff, heat: 0, news: false, count: false });
        if (r && r.took > 0) { addTo(f.stock, r.goods); S.stats.land += r.took; }
      });
    }
    // A party out.
    if (f.scavNext == null) f.scavNext = state.hour + 24 * (1 + Math.floor(roll(state, "first", i) * AISCAV.gapMax));
    if (state.hour < f.scavNext) return;
    const n = S.stats.trips + S.stats.home + i;
    if (f.pop < AISCAV.minPop || state.parties.some((q) => q.owner === f.id && q.kind === "scav")) { f.scavNext = state.hour + 24; return; }
    const need = groupNeeds(f);
    const site = Math.max(...Object.values(need)) >= AISCAV.minNeed ? bestSite(state, f) : null;
    if (!site) { f.scavNext = state.hour + 24 * AISCAV.retry; return; }
    sendParty(state, f, site.from, site.tile, site);
    f.scavNext = state.hour + Math.round(24 * (AISCAV.gapMin + Math.floor(roll(state, "gap", i, n, state.hour) * (AISCAV.gapMax - AISCAV.gapMin + 1))) / Math.max(0.5, prio(f, "scavenge")));
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
    if (t.owner === f.id && t.loc && !t.loc.crash && !t.loc.convoy) out.push(id);
  }
  return out;
}

// Tiles with points of interest inside a group's land (a site tile's site is in landSites).
export function landPoiTiles(state, f) {
  const out = [], seen = new Set();
  for (const b of f.bases) for (const id of state.grid.within(b, 2)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const t = state.tiles[id];
    if (t.owner === f.id && poiTile(t)) out.push(id);
  }
  return out;
}

// pick: the target bestSite chose ({ poi, survey }); without one the party picks its POI at the site.
export function sendParty(state, f, from, site, pick = null) {
  // The group's vehicle when it has the fuel for the trip: they drive (faster on the roads), and it stands on the battle
  // map if you fight them (combat.js setup.enemy.vehicle: theirs to lose).
  const drive = (f.stock.fuel || 0) >= AISCAV.carFuel && state.rng.chance(AISCAV.carChance);
  const q = spawnAiParty(state, f, "scav", from, site, { strength: Math.max(2, Math.round(f.pop * AISCAV.share)), vehicle: drive });
  if (!q) return null;
  if (q.vehicle) { q.vehicleType = state.rng.pick(AISCAV.VEHICLES); f.stock.fuel = Math.max(0, f.stock.fuel - AISCAV.carFuelUse); }
  q.scav = { site, home: from, left: AISCAV.searchHours, got: {}, taken: 0, str0: q.strength, met: [], band0: lootBand(state.tiles[site], state.tiles[site].loot),
    poi: pick && pick.poi != null ? pick.poi : null, survey: !!(pick && pick.survey), done: [] };
  aiCartsOut(f, q); // carts.js: on foot, up to two of the group's carts go along (a bigger haul)
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
      S.stats.gear = (S.stats.gear || 0) + scavFinds(state, f, p).length; // arsenal.js: guns, armour, explosives by the site's gear list
      for (const it of p.scav.gear || []) if (arsenalWorthy(it)) addToArsenal(state, f, it, "scavenged"); // what your people left in a container there
      if (scavVehicle(state, f, p.scav.site)) S.stats.vehicles = (S.stats.vehicles || 0) + 1; // groupworld.js
      if (p.scav.bp) { groupGotBlueprint(f, p.scav.bp); S.stats.manuals = (S.stats.manuals || 0) + 1; } // machines-2: a manual to study
      if (aiCartsHome(state, f, p)) S.stats.carts = (S.stats.carts || 0) + 1; // carts.js: its carts back, now and then one found
    }
    S.stats.home++;
    removeParty(state, p);
    return;
  }
  p.phase = "search";
  if (f && f.alive) scavSaw(state, f, p.scav.site); // groupworld.js: what they see around the site
  const t = state.tiles[p.scav.site];
  if (t.infection > 0.5) p.strength *= 0.9; // the dead are thick here
  choosePoi(state, p);
  if (!p.scav.surveyLeft) contest(state, p);
}

// The group as its party at the site sees things (grouppois.js): what the group knows, and the tile it stands on.
const partyEyes = (f, p) => ({ id: p.owner, bases: f ? f.bases : [], type: f ? f.type : null, known: !!(f && f.known), name: f ? f.name : "", scouting: f ? f.scouting : undefined, tile: p.scav.site, seeRange: 0 });
// The POI the party goes into (pois.js): the one it came for while it knows it and it holds something, else the best
// one it knows on the tile; it came to survey, or knows nothing worth it there: a survey stop first (GPOI.HOURS).
function choosePoi(state, p) {
  const t = state.tiles[p.scav.site];
  if (!p.scav.done) p.scav.done = [];
  if (!poiTile(t)) { p.scav.poi = null; return; } // a city or town centre (no POIs): the site as before
  const f = factionById(state, p.owner);
  const who = partyEyes(f, p);
  const want = p.scav.poi;
  if (p.scav.survey && groupWouldSurvey(state, who, t)) return startSurvey(p);
  p.scav.survey = false;
  let i = typeof want === "number" && want >= 0 && !p.scav.done.includes(want) && groupKnowsPoi(state, who, t, want) && poiPool(t, want) > AISCAV.floor + 1e-9 ? want : -1;
  if (i < 0) i = bestGroupPoi(state, who, t, f ? groupNeeds(f) : null, p.scav.done);
  if (i < 0 && !p.scav.surveyed && groupWouldSurvey(state, who, t)) return startSurvey(p);
  setPoi(state, p, i);
}
function startSurvey(p) {
  p.scav.poi = -1;
  p.scav.survey = false;
  p.scav.surveyLeft = GPOI.HOURS;
  delete p.poi;
}
function setPoi(state, p, i) {
  const t = state.tiles[p.scav.site];
  p.scav.poi = i;
  if (i == null || i < 0) { delete p.poi; return; }
  p.poi = i; // pois.js raidingNow: the dialogue's "being raided now"
  p.scav.kind = isSitePoi(t, i) ? null : poiAt(t, i).kind; // arsenal.js scavFinds: the gear of the place they search
  p.scav.band0 = poiBand(t, i);
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
  // A survey stop: GPOI.HOURS on the tile, then the roll (grouppois.js) and the best POI they know there.
  if (p.scav.surveyLeft > 0) {
    p.scav.surveyLeft -= 1;
    if (p.scav.surveyLeft > 0) return;
    const f = factionById(state, p.owner);
    groupSurveyTile(state, partyEyes(f, p), t, { n: p.strength, start: state.hour - GPOI.HOURS + 1 });
    p.scav.surveyed = true;
    p.scav.poi = null;
    choosePoi(state, p);
    if (p.scav.poi == null || p.scav.poi < 0) return goHome(state, p); // nothing worth it here after all
    contest(state, p);
    return;
  }
  // Your team searching here (in the same POI): they wait it out (and challenge it when it is done).
  const busy = contest(state, p);
  if (!busy && p.scav.poi != null && p.scav.poi >= 0) {
    // A point of interest: through its container ledger (grouppois.js raidPoiAsGroup), its kind's haul.
    const hands = Math.max(0.5, Math.min(1.5, p.strength / 3));
    const crew = Math.min(AISCAV.crewMax, hands);
    const i = p.scav.poi;
    const f = factionById(state, p.owner);
    const who = partyEyes(f, p);
    const take = Math.min(Math.max(0, poiPool(t, i) - AISCAV.floor), AISCAV.take * crew);
    if (take > 0) {
      const r = raidPoiAsGroup(state, who, t, i, take, { eff: AISCAV.eff * hands / crew, heat: AISCAV.AI_HEAT / AISCAV.searchHours, news: isSitePoi(t, i) ? "left" : true });
      if (r) {
        addTo(p.scav.got, r.goods);
        if (r.gear.length) (p.scav.gear || (p.scav.gear = [])).push(...r.gear);
        if (f && !p.scav.bp && isSitePoi(t, i)) p.scav.bp = groupFindBlueprint(state, f, t.id, localId(state, p.id)) || undefined;
        p.scav.taken += r.took;
        aiScav(state).stats.taken += r.took;
      }
    }
    // Picked clean: on to the next POI they know on the tile.
    if (poiPool(t, i) <= AISCAV.floor + 1e-9) {
      p.scav.done.push(i);
      setPoi(state, p, bestGroupPoi(state, who, t, f ? groupNeeds(f) : null, p.scav.done));
    }
  } else if (!busy && p.scav.poi == null) { // a site without POIs (a city or town centre): its tile.loot as before
    const hands = Math.max(0.5, Math.min(1.5, p.strength / 3));
    const crew = Math.min(AISCAV.crewMax, hands); // more hands than that pick it cleaner, not faster
    const take = Math.min(Math.max(0, t.loot - AISCAV.floor), AISCAV.take * crew);
    if (take > 0) {
      addTo(p.scav.got, haulFor(t, take, t.loot, AISCAV.eff * hands / crew * aiCartMult(p), state)); // carts.js: its carts carry more of what it finds home (no faster stripping)
      const fg = !p.scav.bp && factionById(state, p.owner);
      if (fg) p.scav.bp = groupFindBlueprint(state, fg, t.id, localId(state, p.id)) || undefined; // machines-2: a manual on the shelves, by your odds (groupworks.js)
      t.loot -= take;
      p.scav.taken += take;
      if (t.loc && (t.loc.type === "city" || t.loc.type === "town")) { const m = (t.crawlMem = t.crawlMem || { visits: 0, looted: {}, alert: 0, hour: 0 }); m.aiLoot = (m.aiLoot || 0) + take; } // citycrawl.js aiLootCells: the blocks near the rim they went through
      aiScav(state).stats.taken += take;
    }
  }
  p.scav.left -= 1;
  const empty = p.scav.poi != null ? p.scav.poi < 0 : t.loot <= AISCAV.floor + 1e-9;
  if (p.scav.left <= 0 || empty) {
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
  delete p.poi;
  p.scav.home = home;
  if (!res || res.path.length < 2) { scavArrived(state, p); return; }
  p.path = res.path;
  p.idx = 0;
  p.progress = 0;
}

// A horde or the road got the party: it is gone, and its haul with it.
export function lose(state, p) {
  aiScav(state).stats.lost++;
  // Its people are dead (they used to come home from nowhere), and their kit lies where they fell (arsenal.js).
  const f = factionById(state, p.owner);
  const people = Math.max(1, Math.round((p.scav && p.scav.str0) || 2));
  if (f && f.alive) { partyLost(state, f, people); f.pop = Math.max(0, f.pop - people); }
  removeParty(state, p);
}

// Raiders near their base ambush a party carrying a haul home: they take it (parties.js aiPartyHour).
export function ambushHaul(state, p, raiders) {
  for (const [k, q] of Object.entries(p.scav.got)) raiders.stock[k] = (raiders.stock[k] || 0) + Math.floor(q);
  aiScav(state).stats.ambushed++;
}

// The POI a team of yours is in right now (its search, its crew's search, its raid on a map), or null.
export function teamPoi(state, team) {
  const e = state.engagement;
  if (e && !e.done && e.partyId === team.id) return e.poi ?? null;
  if (team.crewSearch && !team.crewSearch.done) return team.crewSearch.poi ?? null;
  const c = state.combat && state.combat.setup;
  if (c && c.partyId === team.id && c.raid) return c.raid.poi ?? null;
  return null;
}
// A team of yours on the site. Returns true while one of your teams is searching there (the party waits). On a tile of
// points of interest only a team in the same POI counts, or one in none (as before): in different ones they keep out
// of each other's way, unless the group is at war with you.
function contest(state, p) {
  const f = factionById(state, p.owner);
  const tile = p.scav.site;
  let busy = false;
  for (const team of state.parties) {
    if (team.owner !== "player" || team.kind === "convoy" || partyTile(team) !== tile || !partyMembers(state, team).length) continue;
    const tp = teamPoi(state, team);
    const same = p.scav.poi == null || p.scav.poi < 0 || tp == null || tp === p.scav.poi;
    const searching = team.phase === "engaged" || (state.engagement && !state.engagement.done && state.engagement.partyId === team.id) || !!(team.crewSearch && !team.crewSearch.done);
    if (searching && same) { busy = true; continue; }
    if (!f || p.scav.met.includes(team.id) || state.cards.some((c) => c.partyId === team.id)) continue;
    if (!same && !atWarWithYou(state, f)) {
      // Different POIs on one tile: both get on with it (and both stir the tile up).
      p.scav.met.push(team.id);
      const t = state.tiles[tile];
      if (f.known) log(state, `${f.name} scavengers are going through ${poiPlace(state, t, p.scav.poi)} while your team searches another place there; nobody gets in anyone's way.`, "info");
      aiScav(state).stats.coexist = (aiScav(state).stats.coexist || 0) + 1;
      continue;
    }
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
    if (took > 0) got.push(`${took} ${keyWord(k)}`);
  }
  removeParty(state, q);
  return `Their scavengers left ${tileLabel(state, q.scav.site)}${got.length ? `, dropping what they had found: ${got.join(", ")}` : ""}.`;
}

// ---------- news ----------
function news(state, p) {
  const t = state.tiles[p.scav.site];
  if (p.scav.poi != null && (p.scav.poi < 0 || !isSitePoi(t, p.scav.poi))) return; // a POI's own news: grouppois.js raidPoiAsGroup
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
  for (const t of state.tiles) if (t.loc && !t.loc.crash && !t.loc.convoy) s += t.loot || 0;
  return s;
}
