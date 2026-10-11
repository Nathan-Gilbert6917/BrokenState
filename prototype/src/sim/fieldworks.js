// Field works (2026-10-10, user request): structures a base builds on the land it holds outside its walls, planned
// from the base window (Field works tab) and put up by its builders, who walk out to the site.
//
// Kinds (FIELD.KINDS; cost from the base's stores when the job is queued, work-hours plus the walk):
//   roadblock  Cars, logs and wire across a road tile. A hostile party (a raid, a war party, raiders from outside) or a
//              horde entering the tile is held while it batters a way through: hold hours = min(max hold, hp / its
//              rate), and the roadblock takes that damage. Your own teams and friends' pass.
//   well       A dug well on open ground (not mountains): the yield of a claim well (claims.js WELL_YIELD: by a river or
//              lake 10 a day, farmland 6, forest 4, hills, suburbs, city 2), drawn down like one. Its water is fetched
//              by the base's water carriers (job trips: Fetch water, up to its yield a day, drawWell; with the trips'
//              hooks not installed, FIELD.PASSIVE_WELLS: hauled by the base's people, one well per 4) and is
//              un-purified, but deep ground water: half the eggs of the tile's ground (worm.js rawWaterEggs). Boil it.
//   tower      A watch tower. Only when manned (1–2 people posted to it: they live there, fed from the base, and take
//              turns; one alone sleeps 22:00–06:00 and the tower is dark then) it sees FIELD.TOWER.day tiles around
//              by day (night: FIELD.TOWER.night), live on the State Map, and its lookouts warn the base of raids and
//              hordes they see (watch.js lookoutsSpot). Posted people are out of the base: no base work, not in a base
//              battle (atBase leaves them out; world.js residents keeps them fed, healed and counted).
//   relay      An unmanned radio relay mast (radio.js radioNodes): RELAY_RANGE (6) tiles of coverage when it links to a
//              station or a linked relay, 1 part every RELAY_UPKEEP_DAYS days from its base (else the hub).
//   stockpile  A fenced drop point. Outdoor workers and teams leave goods here (dropPointsFor / depositAt; a team's
//              Unload order) up to FIELD.KINDS.stockpile.capKg; a team (Load order, or the base's Send a haul team)
//              brings it home. Raiders passing over it, and a group's raid on it, take what is there.
// Threats: a horde entering a structure's tile batters it (FIELD.HORDE); a manned tower's lookouts shoot back from
// above; a hostile group within FIELD.RAID.range tiles may send a raid at it (an AI party, kind "fwraid": it
// fights the garrison by the numbers and then takes the structure over, wrecks it or empties it). Destroyed: gone.
// Repairs: per structure, by the base's builders (walk included), materials by kind and damage (repairCost).
// The groups build their own (groupFieldDaily, coarse: a tower when threatened, a well, a stockpile, a roadblock on
// a road through their land) and you can wreck, capture or loot theirs with a team (orders "fwork").
//
// state.fieldworks = { list: [fw], jobs: [job], news: [{ hour, fw, kind, text, tone, tile }] }, plain data (save.js):
//   fw  = { id, kind, tile, owner: "player" | faction id, baseId (yours) | baseTile (a group's), hp, max, built,
//           garrison: [survivor ids] (yours) | gar: n (a group's), contents: { key: qty } (stockpile),
//           well?: { yield, left, start, dug } (well), since, hitHour?, relayDue?, offline? }
//   job = { id, type: "build" | "repair" | "demolish", fw, baseId, progress, hours, paid: { key: qty } }
// Older saves have no state.fieldworks: ensureFW makes an empty one.
import { log, atBase, baseById, hub, newId, skill, combatPower, hourOfDay, isNight, day, alive, survivorById, factionById, killSurvivor, hurt, localId } from "./world.js";
import { BUILDINGS, buildRate, isCamp, isShelter, gatherStalled, underAttack, matName, onUpkeep } from "./buildings.js";
import { ownsTile, wellYield, wellRate, WELL_LEFT, CLAIM, claimOwner, hauledWells } from "./claims.js";
import { attitude, changeGoodwill, isAggressiveType } from "./factions.js";
import { tileLabel, spawnAiParty, partyTile, cargoRoom, carried, takeSupply, partyMembers, launchExpedition, removeParty } from "./parties.js";
import { queueOrder } from "./orders.js";
import { winOdds } from "./combat.js";
import { healthRest } from "./work.js";
import { SUPPLIES, SKILL_NAMES } from "./data.js";
import { hordeWallPower } from "./hordes.js";
import { RELAY_RANGE, RELAY_UPKEEP_DAYS } from "./radio.js";
import { woodNeed } from "./woodcutting.js"; // the governor keeps the winter's firewood (govFieldWorks)
import { TRIP_HOOKS } from "./tripland.js"; // the job trips' plug-in points: installed at load (installTripHooks, end of file)

// ---------- the numbers ----------
export const FIELD = {
  KINDS: {
    roadblock: { name: "Roadblock", icon: "🚧", cost: { scrap: 10, wood: 150 }, hours: 10, hp: 60, road: true,
      desc: "Wrecked cars, logs and wire across the road. A hostile party or a horde entering the tile is held while it forces a lane through (up to 10 hours for a party, 12 for a horde; the stronger they are, the sooner), and the roadblock takes the damage (a fresh one is left at about 40%). Your teams and friends pass. Road tiles only." },
    well: { name: "Field well", icon: "🪣", cost: { scrap: 12, parts: 1 }, hours: 20, hp: 50,
      desc: "A dug well on the base's land: water a day by the ground (beside a river or lake 10, farmland 6, forest 4, hills, suburbs and city 2; not in the mountains), brought in by the base's water carriers (the Fetch water job: up to its yield a day). Deep ground water: half the worm's eggs of the ground, but still un-purified: boil it." },
    tower: { name: "Watch tower", icon: "🗼", cost: { scrap: 15, wood: 120 }, hours: 18, hp: 70, garrison: 2,
      desc: "A lookout tower. Manned (post 1 or 2 people: they live out there, fed from the base, and do no base work) it shows the map 3 tiles around it by day (1 at night) and its lookouts warn the base of raids and hordes they see. One alone sleeps at night (dark 22:00–06:00); two take turns. Unmanned it sees nothing." },
    relay: { name: "Relay mast", icon: "📡", cost: { scrap: 15, parts: 3 }, hours: 24, hp: 40, req: { mechanics: 3 },
      desc: "An unmanned radio relay on a mast: 6 tiles of radio coverage around it when a radio station or a linked relay reaches it (teams in coverage report live and can be called). Uses 1 part every 10 days from its base (else the hub). Needs a Mechanics 3+ survivor at the base to build." },
    stockpile: { name: "Stockpile", icon: "📦", cost: { scrap: 8, wood: 90 }, hours: 8, hp: 50, capKg: 200,
      desc: "A fenced drop point: outdoor workers and teams leave goods here instead of walking home (up to 200 kg), and a haul team brings it in (Send a haul team: a vehicle carries the most). Raiders passing over it take what is there." },
  },
  ORDER: ["tower", "well", "stockpile", "roadblock", "relay"],
  RANGE: 3,                                   // the most tiles from the base (and the land must be yours)
  MAX: { hub: 6, outpost: 4, shelter: 2, camp: 0 },
  WALK: { pace: 0.5, shift: 8 },              // hours a tile each way; a trip out per `shift` work-hours
  TOWER: { day: 3, night: 1, soloFrom: 6, soloTo: 22, warnBase: 4, perch: 1.5 },
  ROADBLOCK: { gap: 0.6, partyHold: 10, hordeHold: 12, partyRate: 4, partyPer: 0.4, hordeRate: 3, hordePer: 0.05, teamHostile: 3, teamCheck: 1, teamDamage: 10 },
  HORDE: { base: 10, per: 5, siteLoss: 0.5, shot: 2, hurt: 0.5, killed: 0.1 },
  RAID: { range: 10, chance: 0.02, perKg: 1 / 2500, max: 0.08, minPop: 6, str: [4, 12], capture: 0.5, near: 4, every: 10 },
  REPAIR: { share: 0.6, hoursShare: 0.5, minHours: 2 },
  DEMOLISH: { hours: 4, refund: 0.5 },
  TEAM: { destroy: 3, capture: 4, load: 1, unload: 1, gw: -8, garPower: 2.5 },
  AI: { every: 5, max: [1, 12, 4], stock: 0.15, gar: 2, garPop: 10, work: 3 },
  GOV: { towerPop: 6, garrisonPop: 10, repairAt: 0.7, woodKeep: 0.5 }, // woodKeep: the share of the cold's firewood kept back from field works
  NEWS_HOURS: 48,
  // The wells' water comes home by itself (the base's people haul it, as the claim wells'). Set false once the job
  // trips' Fetch water job walks to the wells (installTripHooks) so the water is not counted twice.
  PASSIVE_WELLS: true,
  DROP_MIN_KG: 10, // a stockpile takes a worker's load while it has this much room
};
const K = FIELD.KINDS;
// Materials to repair a structure from nothing (scaled by the damage): about 60% of its cost.
export const repairBase = (kind) => Object.fromEntries(Object.entries(K[kind].cost).map(([k, v]) => [k, Math.max(1, Math.round(v * FIELD.REPAIR.share))]));

// ---------- the state ----------
export function ensureFW(state) {
  if (!state.fieldworks) state.fieldworks = { list: [], jobs: [], news: [] };
  const F = state.fieldworks;
  if (!F.list) F.list = [];
  if (!F.jobs) F.jobs = [];
  if (!F.news) F.news = [];
  return F;
}
export const fwList = (state) => (state.fieldworks ? state.fieldworks.list : []);
export const fwById = (state, id) => fwList(state).find((x) => x.id === id) || null;
export const fwAt = (state, tile) => fwList(state).find((x) => x.tile === tile) || null;
export const kindName = (fw) => (fw && K[fw.kind] ? K[fw.kind].name : "Field work");
export const isMine = (fw) => !!fw && fw.owner === "player";
export const playerWorks = (state, base = null) => fwList(state).filter((x) => x.owner === "player" && (!base || x.baseId === base.id));
export const groupWorks = (state, f) => fwList(state).filter((x) => x.owner === f.id);
const jobsOf = (state, base) => (state.fieldworks ? state.fieldworks.jobs.filter((j) => j.baseId === base.id) : []);
export const jobFor = (state, fw) => (state.fieldworks ? state.fieldworks.jobs.find((j) => j.fw === fw.id) || null : null);
export const fieldJobs = jobsOf;
export const condition = (fw) => (fw.max > 0 ? Math.max(0, Math.min(1, fw.hp / fw.max)) : 1);
// Damage band for the icon: null (sound), "worn" (under 70%), "bad" (under 35%).
export const damageBand = (fw) => (!fw.built ? null : condition(fw) < 0.35 ? "bad" : condition(fw) < FIELD.GOV.repairAt ? "worn" : null);
const owned = (fw, who) => fw.owner === who;
const ownerName = (state, owner) => (owner === "player" ? "you" : (() => { const f = factionById(state, owner); return f && f.known ? f.name : "a group"; })());
function news(state, fw, text, tone = "danger") {
  const F = ensureFW(state);
  F.news.unshift({ hour: state.hour, fw: fw.id, kind: fw.kind, tile: fw.tile, text, tone });
  if (F.news.length > 40) F.news.length = 40;
  log(state, text, tone);
}
export const recentNews = (state) => (state.fieldworks ? state.fieldworks.news.filter((n) => state.hour - n.hour <= FIELD.NEWS_HOURS) : []);
const label = (state, fw) => `the ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)}`;
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- where they can go ----------
export const maxWorks = (base) => FIELD.MAX[isCamp(base) ? "camp" : isShelter(base) ? "shelter" : base.type === "hub" ? "hub" : "outpost"];
// Why this kind cannot go on this tile for this base ("" = it can). costs: also check the stores and the skill.
export function placeProblem(state, base, kind, tile, costs = true) {
  const def = K[kind];
  if (!def) return "No such field work.";
  if (!base) return "No base.";
  const t = state.tiles[tile];
  if (!t) return "No such tile.";
  if (tile === base.tile) return "Field works go outside the base: pick a tile around it.";
  if (state.bases.some((b) => b.tile === tile)) return "Another of your bases stands there.";
  if (t.terrain === "water") return "Not on open water.";
  if (t.hive) return "A hive stands there.";
  if (state.factions.some((f) => f.alive && f.bases.includes(tile))) return "A group's base stands there.";
  if (state.grid.distance(base.tile, tile) > FIELD.RANGE) return `Too far from ${base.name} (at most ${FIELD.RANGE} tiles).`;
  if (!ownsTile(state, tile)) return "Only on land you hold: the ground around a base or a claim of yours.";
  const there = fwAt(state, tile);
  if (there) return `${there.owner === "player" ? "Your" : "A"} ${kindName(there).toLowerCase()} stands there already.`;
  if (def.road && !t.road) return "Roadblocks go on a road tile.";
  if (kind === "well") {
    if (!wellYield(state, tile)) return "Solid rock: no water to dig for.";
    if (state.claims && state.claims[tile] && state.claims[tile].well) return "A well is dug on that claim already.";
  }
  if (playerWorks(state, base).length >= maxWorks(base)) return maxWorks(base) ? `${base.name} has all the field works it can keep (${maxWorks(base)}).` : "A camp builds no field works: build it up first.";
  if (costs) {
    for (const [k, v] of Object.entries(def.cost)) if ((base.stock[k] || 0) < v) return `Needs ${v} ${matName(k, v)} at ${base.name} (have ${Math.floor(base.stock[k] || 0)}).`;
    if (def.req) for (const [sk, lvl] of Object.entries(def.req)) if (!atBase(state, base.id).some((s) => skill(s, sk) >= lvl)) return `Needs a ${SKILL_NAMES[sk] || sk} ${lvl}+ survivor at ${base.name}.`;
  }
  return "";
}
// Every tile of the base's land within range, with why not (for the map's highlight and the tab's list).
export function placeTiles(state, base, kind) {
  if (!base) return [];
  return state.grid.within(base.tile, FIELD.RANGE).filter((id) => id !== base.tile && ownsTile(state, id))
    .map((id) => ({ tile: id, why: placeProblem(state, base, kind, id, false) }));
}
// The walk: hours there and back for each trip of FIELD.WALK.shift work-hours.
export const walkHours = (state, base, tile, work) => r1(state.grid.distance(base.tile, tile) * 2 * FIELD.WALK.pace * Math.max(1, Math.ceil(work / FIELD.WALK.shift)));

// ---------- planning (the base window) ----------
// Plans a field work: the materials leave the stores now, a site stands on the map and the builders go out to it.
// Returns the line to show, or why not ({ error }).
export function planFieldWork(state, base, kind, tile) {
  const why = placeProblem(state, base, kind, tile);
  if (why) return { error: why };
  const def = K[kind];
  for (const [k, v] of Object.entries(def.cost)) base.stock[k] -= v;
  const fw = { id: newId(), kind, tile, owner: "player", baseId: base.id, hp: def.hp, max: def.hp, built: false, garrison: [], contents: {}, since: state.hour };
  const F = ensureFW(state);
  F.list.push(fw);
  const walk = walkHours(state, base, tile, def.hours);
  F.jobs.push({ id: newId(), type: "build", fw: fw.id, baseId: base.id, progress: 0, hours: r1(def.hours + walk), paid: { ...def.cost } });
  const text = `${def.name} planned at ${tileLabel(state, tile)} for ${base.name}: ${def.hours} work-hours and ${walk} hours of walking for the builders.`;
  log(state, text, "info");
  return { text, fw };
}
// Cancel a job: an untouched build gives everything back (and the site goes), a started one half; a repair or a
// demolition just stops (a repair's materials: as a build's).
export function cancelFieldJob(state, jobId) {
  const F = ensureFW(state);
  const job = F.jobs.find((j) => j.id === jobId);
  if (!job) return "That job is gone.";
  const base = baseById(state, job.baseId);
  const fw = fwById(state, job.fw);
  const full = job.progress <= 0;
  if (base) for (const [k, v] of Object.entries(job.paid || {})) base.stock[k] = (base.stock[k] || 0) + (full ? v : Math.ceil(v / 2));
  F.jobs.splice(F.jobs.indexOf(job), 1);
  if (job.type === "build" && fw && !fw.built) F.list.splice(F.list.indexOf(fw), 1);
  return `Cancelled: ${jobText(state, job)}. ${Object.keys(job.paid || {}).length ? `${full ? "All" : "Half"} the materials were returned.` : ""}`.trim();
}
export function jobText(state, job) {
  const fw = fwById(state, job.fw);
  const n = fw ? kindName(fw).toLowerCase() : "field work";
  return job.type === "repair" ? `repair the ${n}` : job.type === "demolish" ? `pull down the ${n}` : `build a ${n}`;
}
// Repairs: materials by kind and damage (repairBase × the share missing, rounded up), hours by the damage (half the
// build's hours for a wreck, at least FIELD.REPAIR.minHours) plus the walk. { cost, hours, work, walk, missing }.
export function repairCost(state, fw) {
  const base = baseById(state, fw.baseId);
  const missing = 1 - condition(fw);
  const cost = {};
  for (const [k, v] of Object.entries(repairBase(fw.kind))) { const n = Math.ceil(v * missing - 1e-9); if (n > 0) cost[k] = n; }
  const work = Math.max(FIELD.REPAIR.minHours, r1(K[fw.kind].hours * FIELD.REPAIR.hoursShare * missing));
  const walk = base ? walkHours(state, base, fw.tile, work) : 0;
  return { cost, work, walk, hours: r1(work + walk), missing };
}
export function repairProblem(state, fw) {
  if (!fw || !isMine(fw)) return "Not yours.";
  if (!fw.built) return "Still being built.";
  if (fw.hp >= fw.max) return "Not damaged.";
  if (jobFor(state, fw)) return "A job is queued there already.";
  const base = baseById(state, fw.baseId);
  if (!base) return "Its base is gone.";
  const rc = repairCost(state, fw);
  for (const [k, v] of Object.entries(rc.cost)) if ((base.stock[k] || 0) < v) return `Needs ${v} ${matName(k, v)} at ${base.name} (have ${Math.floor(base.stock[k] || 0)}).`;
  return "";
}
export function queueRepair(state, fwId) {
  const fw = fwById(state, fwId);
  const why = repairProblem(state, fw);
  if (why) return { error: why };
  const base = baseById(state, fw.baseId);
  const rc = repairCost(state, fw);
  for (const [k, v] of Object.entries(rc.cost)) base.stock[k] -= v;
  ensureFW(state).jobs.push({ id: newId(), type: "repair", fw: fw.id, baseId: base.id, progress: 0, hours: rc.hours, paid: rc.cost, hpFrom: fw.hp });
  const text = `Repairs queued on ${label(state, fw)} (${costText(rc.cost)}, ${rc.hours} hours with the walk).`;
  return { text };
}
// Every damaged structure of this base that can be paid for, worst first. Returns { done: n, text, short: [why…] }.
export function repairAll(state, base) {
  const list = playerWorks(state, base).filter((fw) => fw.built && fw.hp < fw.max && !jobFor(state, fw)).sort((a, b) => condition(a) - condition(b));
  let done = 0;
  const short = [];
  for (const fw of list) { const r = queueRepair(state, fw.id); if (r.error) short.push(`${kindName(fw)}: ${r.error}`); else done++; }
  return { done, short, text: done ? `${done} repair${done === 1 ? "" : "s"} queued at ${base.name}.${short.length ? ` Not paid for: ${short.join("; ")}` : ""}` : list.length ? `No repairs could be paid for: ${short.join("; ")}` : "Nothing needs repairs." };
}
export function demolishProblem(state, fw) {
  if (!fw || !isMine(fw)) return "Not yours.";
  if (jobFor(state, fw)) return "A job is queued there already: cancel it first.";
  if (!baseById(state, fw.baseId)) return "Its base is gone.";
  return "";
}
export function queueDemolish(state, fwId) {
  const fw = fwById(state, fwId);
  const why = demolishProblem(state, fw);
  if (why) return { error: why };
  if (!fw.built) return { text: cancelFieldJob(state, jobFor(state, fw).id) };
  const base = baseById(state, fw.baseId);
  const hours = r1(FIELD.DEMOLISH.hours + walkHours(state, base, fw.tile, FIELD.DEMOLISH.hours));
  ensureFW(state).jobs.push({ id: newId(), type: "demolish", fw: fw.id, baseId: base.id, progress: 0, hours, paid: {} });
  return { text: `${kindName(fw)} at ${tileLabel(state, fw.tile)}: the builders will pull it down (${hours} hours with the walk; half its materials come back).` };
}
export const costText = (cost) => Object.entries(cost || {}).map(([k, v]) => `${v} ${matName(k, v)}`).join(", ") || "nothing";

// ---------- the builders' hour (buildings.js constructionHour) ----------
// A base with field jobs: the builders go out on the odd hours while the base's own queue has a job to work, every
// hour when it has none. The job in hand is the first one in the field queue whose site is clear (no hostile
// party or horde on it). Returns true when this hour went to the field (constructionHour then skips the base).
export function fieldBuildHour(state, base) {
  const out = fieldBuildWork(state, base);
  // The builders back at the base's own work this hour: not out at a site any more (they were marked away until the
  // end of the next tick: the parties and hordes move before the construction hour, world.js hourOfWorld).
  if (!out) fieldAwayEnd(state, base);
  return out;
}
export function fieldAwayEnd(state, base) { for (const s of atBase(state, base.id)) if (s.away && s.away.fw != null) delete s.away; }
function fieldBuildWork(state, base) {
  if (!state.fieldworks || !state.fieldworks.jobs.length) return false;
  const jobs = jobsOf(state, base);
  if (!jobs.length) return false;
  const rate = buildRate(state, base);
  if (rate <= 0) return false;
  const job = jobs.find((j) => { const fw = fwById(state, j.fw); return fw && !threatOn(state, fw.tile); });
  if (!job) return false;
  const baseWork = base.construction.some((c) => !gatherStalled(c));
  if (baseWork && state.hour % 2 === 0) return false;
  job.progress += rate;
  // The builders are out at the site this hour: away from the walls (world.js outOnTrip: not in a battle at the base).
  const fw = fwById(state, job.fw);
  const text = `Out ${job.type === "repair" ? "repairing" : job.type === "demolish" ? "pulling down" : "building"} the ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)}`;
  for (const s of atBase(state, base.id)) if (s.role === "build" && !s.inBed && !onUpkeep(state, base, s)) s.away = { until: state.hour + 2, fw: fw.id, text }; // through the next hour's moves, until the next construction hour
  if (job.progress >= job.hours - 1e-9) finishJob(state, job);
  return true;
}
function finishJob(state, job) {
  const F = ensureFW(state);
  F.jobs.splice(F.jobs.indexOf(job), 1);
  const fw = fwById(state, job.fw);
  const base = baseById(state, job.baseId);
  if (!fw) return;
  if (job.type === "build") {
    fw.built = true;
    fw.hp = fw.max;
    if (fw.kind === "well") {
      const y = wellYield(state, fw.tile);
      const left = state.rng.int(WELL_LEFT.min, WELL_LEFT.max) + WELL_LEFT.perYield * y;
      fw.well = { yield: y, left, start: left, dug: state.hour };
    }
    if (fw.kind === "relay") fw.relayDue = day(state) + RELAY_UPKEEP_DAYS;
    log(state, `${kindName(fw)} finished at ${tileLabel(state, fw.tile)}${base ? ` (${base.name})` : ""}.`, "good");
  } else if (job.type === "repair") {
    fw.hp = fw.max;
    log(state, `The ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)} is repaired.`, "good");
  } else if (job.type === "demolish") {
    if (base) for (const [k, v] of Object.entries(K[fw.kind].cost)) base.stock[k] = (base.stock[k] || 0) + Math.floor(v * FIELD.DEMOLISH.refund * condition(fw));
    if (base && fw.contents) for (const [k, v] of Object.entries(fw.contents)) base.stock[k] = (base.stock[k] || 0) + v;
    removeWork(state, fw);
    log(state, `The ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)} is pulled down; what could be saved is back at ${base ? base.name : "the base"}.`, "info");
  }
}
// A structure goes: its garrison comes home, its jobs end.
function removeWork(state, fw) {
  const F = ensureFW(state);
  recallAll(state, fw);
  F.jobs = F.jobs.filter((j) => j.fw !== fw.id);
  const i = F.list.indexOf(fw);
  if (i >= 0) F.list.splice(i, 1);
}

// ---------- the garrison (towers) ----------
export const garrisonCap = (fw) => (fw && K[fw.kind] ? K[fw.kind].garrison || 0 : 0);
export const onPost = (s) => !!s && !!s.location && s.location.kind === "post";
// Out of the base (job-trips' "who is home" check, base battles): someone posted at a field work.
export const outOfBase = onPost;
export const postedAt = (state, fw) => (fw.garrison || []).map((id) => survivorById(state, id)).filter((s) => s && s.alive && s.location && s.location.kind === "post" && s.location.fw === fw.id);
export function postProblem(state, fw, s) {
  if (!fw || !isMine(fw)) return "Not yours.";
  if (!garrisonCap(fw)) return "Nobody can be posted there.";
  if (!fw.built) return "Still being built.";
  if (!s || !s.alive) return "Nobody to post.";
  if (postedAt(state, fw).length >= garrisonCap(fw)) return `It holds ${garrisonCap(fw)} at most.`;
  if (!s.location || s.location.kind !== "base" || s.location.baseId !== fw.baseId) return `${s.name.split(" ")[0]} is not at its base.`;
  if (threatOn(state, fw.tile)) return "Enemies stand there.";
  return "";
}
export function postPerson(state, fwId, sid) {
  const fw = fwById(state, fwId), s = survivorById(state, sid);
  const why = postProblem(state, fw, s);
  if (why) return { error: why };
  s.location = { kind: "post", baseId: fw.baseId, fw: fw.id, tile: fw.tile };
  if (s.inBed) s.inBed = false;
  if (!fw.garrison.includes(s.id)) fw.garrison.push(s.id);
  return { text: `${s.name.split(" ")[0]} goes out to the ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)}.` };
}
// Back to the base (theirs, else the hub). Returns the line.
export function recallPerson(state, sid, why = "") {
  const s = survivorById(state, sid);
  if (!s || !onPost(s)) return "";
  const fw = fwById(state, s.location.fw);
  const home = baseById(state, s.location.baseId) || hub(state);
  if (fw) fw.garrison = fw.garrison.filter((id) => id !== s.id);
  if (home) s.location = { kind: "base", baseId: home.id };
  return `${s.name.split(" ")[0]} is back at ${home ? home.name : "the base"}${why ? `: ${why}` : ""}.`;
}
export function recallAll(state, fw, why = "") {
  const lines = [];
  for (const id of [...(fw.garrison || [])]) { const t = recallPerson(state, id, why); if (t) lines.push(t); }
  fw.garrison = [];
  return lines;
}
// Lookouts awake now: two take turns round the clock, one alone from soloFrom to soloTo. A posted person who is badly
// hurt or ill (work.js healthRest) keeps no watch.
export function lookouts(state, fw) {
  if (fw.owner !== "player") return fw.built ? Math.min(fw.gar || 0, 2) : 0;
  if (!fw.built || fw.kind !== "tower") return 0;
  const fit = postedAt(state, fw).filter((s) => !healthRest(s)).length;
  if (fit >= 2) return fit;
  const h = hourOfDay(state);
  return fit === 1 && h >= FIELD.TOWER.soloFrom && h < FIELD.TOWER.soloTo ? 1 : 0;
}
export const manned = (state, fw) => fw.kind === "tower" && fw.built && lookouts(state, fw) > 0;
export const towerRadius = (state) => (isNight(state) ? FIELD.TOWER.night : FIELD.TOWER.day);
// The tiles your manned towers show live on the map (world.js liveTiles).
export function fieldSight(state) {
  const out = [];
  for (const fw of fwList(state)) if (fw.owner === "player" && manned(state, fw)) for (const id of state.grid.within(fw.tile, towerRadius(state))) out.push(id);
  return out;
}
// A manned tower of this base (or within TOWER.warnBase tiles of it) sees this tile (watch.js lookoutsSpot).
export function towerSees(state, base, tile) {
  if (!base || !state.fieldworks) return null;
  for (const fw of fwList(state)) {
    if (fw.owner !== "player" || !manned(state, fw)) continue;
    if (fw.baseId !== base.id && state.grid.distance(fw.tile, base.tile) > FIELD.TOWER.warnBase) continue;
    if (state.grid.distance(fw.tile, tile) <= towerRadius(state)) return fw;
  }
  return null;
}
export const towerSawText = (state, base, tile) => { const fw = towerSees(state, base, tile); return fw ? ` The lookouts on the tower at ${tileLabel(state, fw.tile)} saw them first.` : ""; };

// ---------- water (economy.js waterProduction; job-trips' Fetch water) ----------
// The wells of this base: [{ fw, tile, rate, today (the day's yield not yet drawn by the water carriers) }], best first.
export function waterSourcesFor(state, base) {
  return playerWorks(state, base).filter((fw) => fw.kind === "well" && fw.built && fw.well && fw.hp > 0)
    .map((fw) => ({ fw, tile: fw.tile, rate: wellRate(state, fw.well), today: wellToday(state, fw) })).sort((a, b) => b.rate - a.rate);
}
// The yield a well has left to give today (the job trips' water carriers draw it: drawWell).
export function wellToday(state, fw) {
  const w = fw && fw.well;
  if (!w) return 0;
  return Math.max(0, r1(wellRate(state, w) - (w.drawnDay === day(state) ? w.drawn || 0 : 0)));
}
// A water carrier fills up to q at a field well (job trips, TRIP_HOOKS.draw): at most the day's yield left; the well is
// drawn down by it and one at 0 is dry. Returns what they got.
export function drawWell(state, tile, q) {
  const fw = fwList(state).find((x) => x.tile === tile && x.kind === "well" && x.owner === "player" && x.built && x.well && x.hp > 0);
  if (!fw || !(q > 0)) return 0;
  const w = fw.well, today = day(state);
  const take = Math.min(q, wellToday(state, fw), Math.max(0, w.left));
  if (!(take > 0)) return 0;
  if (w.drawnDay !== today) { w.drawnDay = today; w.drawn = 0; }
  w.drawn = Math.round((w.drawn + take) * 100) / 100;
  w.left = Math.max(0, Math.round((w.left - take) * 100) / 100);
  if (w.left <= 0 && !w.dry) { w.dry = true; log(state, `The field well at ${tileLabel(state, fw.tile)} has run dry.`, "danger"); }
  return take;
}
// The well water hauled home today: the base's people haul one well per CLAIM.WELL_PER_PEOPLE of them, the claim wells
// (claims.js hauledWells) taking their share first. { total, wells: [{ fw, tile, rate, counted }] }.
export function fieldWellWater(state, base) {
  const src = FIELD.PASSIVE_WELLS ? waterSourcesFor(state, base) : [];
  if (!src.length) return { total: 0, wells: [] };
  const cw = hauledWells(state, base);
  const used = cw.wells.filter((w) => w.counted).length;
  const cap = Math.max(0, Math.floor(atBase(state, base.id).length / CLAIM.WELL_PER_PEOPLE) - used);
  let total = 0;
  const wells = src.map((x, i) => { const counted = i < cap && x.rate > 0; if (counted) total += x.rate; return { ...x, counted }; });
  return { total: r1(total), wells };
}
// Daily: what was hauled is drawn from the wells (economy.js baseDaily, after the claim wells).
export function drawFieldWells(state, base) {
  for (const o of fieldWellWater(state, base).wells) {
    if (!o.counted) continue;
    const w = o.fw.well;
    w.left = Math.max(0, r1(w.left - o.rate));
    if (w.left <= 0 && !w.dry) { w.dry = true; log(state, `The field well at ${tileLabel(state, o.tile)} has run dry.`, "danger"); }
  }
}

// ---------- stockpiles (drop points) ----------
const kgIn = (rec) => Object.entries(rec || {}).reduce((a, [k, q]) => a + (q > 0 && SUPPLIES[k] ? q * SUPPLIES[k].weight : 0), 0);
export const stockKg = (fw) => r1(kgIn(fw.contents));
export const stockRoom = (fw) => Math.max(0, (K[fw.kind].capKg || 0) - kgIn(fw.contents));
export const contentsText = (fw) => Object.entries(fw.contents || {}).filter(([, q]) => q >= 0.5).map(([k, q]) => `${Math.floor(q)} ${matName(k, q)}`).join(", ") || "empty";
// The stockpiles of this base an outdoor worker can leave goods at: [{ fw, tile, room (kg) }], nearest to `near` first.
export function dropPointsFor(state, base, near = null) {
  const list = playerWorks(state, base).filter((fw) => fw.kind === "stockpile" && fw.built && fw.hp > 0 && !threatOn(state, fw.tile));
  const at = near == null ? base.tile : near;
  return list.map((fw) => ({ fw, tile: fw.tile, room: r1(stockRoom(fw)) })).sort((a, b) => state.grid.distance(a.tile, at) - state.grid.distance(b.tile, at) || a.fw.id - b.fw.id);
}
// Leave up to qty of a supply at a stockpile. Returns what it took (by its room).
export function depositAt(state, fw, key, qty) {
  if (!fw || fw.kind !== "stockpile" || !fw.built || !SUPPLIES[key] || !(qty > 0)) return 0;
  const w = SUPPLIES[key].weight || 1;
  const take = Math.min(qty, Math.floor((stockRoom(fw) / w) * 100) / 100);
  if (take <= 0) return 0;
  fw.contents[key] = r1((fw.contents[key] || 0) + take);
  return take;
}
// Everything at a stockpile into a team's cargo, as far as there is room (heaviest-value first). Returns the line.
export function loadFromStockpile(state, p, fw) {
  if (!p.cargo) p.cargo = { supplies: {}, gear: [] };
  const got = [];
  const keys = Object.keys(fw.contents || {}).sort((a, b) => (SUPPLIES[b] ? SUPPLIES[b].value / SUPPLIES[b].weight : 0) - (SUPPLIES[a] ? SUPPLIES[a].value / SUPPLIES[a].weight : 0));
  for (const k of keys) {
    const q = fw.contents[k] || 0;
    if (q <= 0 || !SUPPLIES[k]) continue;
    const fits = Math.min(q, Math.floor(cargoRoom(state, p) / SUPPLIES[k].weight));
    if (fits <= 0) continue;
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + fits;
    fw.contents[k] = r1(q - fits);
    if (fw.contents[k] <= 0) delete fw.contents[k];
    got.push(`${fits} ${matName(k, fits)}`);
  }
  return got.length ? `Loaded from the stockpile: ${got.join(", ")}.${Object.keys(fw.contents).length ? ` Left there: ${contentsText(fw)} (no room).` : ""}` : Object.keys(fw.contents || {}).length ? "No room to carry anything more." : "The stockpile is empty.";
}
// A team leaves what it found (not its own food, water, meds and ammo) at a stockpile of yours.
const KEEP = new Set(["food", "water", "rawwater", "meds", "ammo", "arrows", "fuel"]);
export function unloadToStockpile(state, p, fw) {
  const got = [];
  const keys = new Set([...Object.keys((p.cargo && p.cargo.supplies) || {}), ...Object.keys(p.supplies || {})]);
  for (const k of keys) {
    if (KEEP.has(k) || !SUPPLIES[k] || SUPPLIES[k].cat === "ammo") continue;
    const have = carried(p, k);
    if (have < 1) continue;
    const put = depositAt(state, fw, k, Math.floor(have));
    if (put > 0) { takeSupply(p, k, put); got.push(`${put} ${matName(k, put)}`); }
  }
  return got.length ? `Left at the stockpile: ${got.join(", ")} (${stockKg(fw)} of ${K.stockpile.capKg} kg).` : stockRoom(fw) < 1 ? "The stockpile is full." : "Nothing to leave there (the team keeps its food, water, meds and ammo).";
}
// The base's Send a haul team: up to 2 fit people (the strongest backs) and the base's best running vehicle go to
// the stockpile, load it and come home. Returns the line or { error }.
export function sendHaul(state, fwId) {
  const fw = fwById(state, fwId);
  if (!fw || !isMine(fw) || fw.kind !== "stockpile") return { error: "No stockpile of yours." };
  if (!Object.keys(fw.contents || {}).length) return { error: "The stockpile is empty." };
  const base = baseById(state, fw.baseId);
  if (!base) return { error: "Its base is gone." };
  const people = atBase(state, base.id).filter((s) => !healthRest(s) && !s.pinned && !s.leader && s.health >= 50).sort((a, b) => (a.role === "build") - (b.role === "build") || combatPower(b) - combatPower(a)); // the builders last
  if (!people.length) return { error: `Nobody fit at ${base.name} to send.` };
  const cars = state.vehicles.filter((v) => v.loc.kind === "base" && v.loc.baseId === base.id && v.condition > 0 && !v.count && (v.fuel || 0) >= 2).sort((a, b) => (b.cargo || 0) - (a.cargo || 0));
  const crew = people.slice(0, 2).map((s) => s.id);
  const sup = { food: Math.min(Math.floor(base.stock.food || 0), crew.length), water: Math.min(Math.floor(base.stock.water || 0), crew.length) };
  let res = cars.length ? launchExpedition(state, { memberIds: crew, dest: fw.tile, mission: "move", stance: "normal", supplies: sup, vehicleId: cars[0].id, fromBaseId: base.id, quiet: true }) : null;
  if (!res || res.error) res = launchExpedition(state, { memberIds: crew, dest: fw.tile, mission: "move", stance: "normal", supplies: sup, fromBaseId: base.id, quiet: true });
  if (res.error) return { error: res.error };
  const p = res.party;
  p.haulFor = fw.id;
  queueOrder(state, p, { type: "fwork", act: "load", at: fw.tile });
  queueOrder(state, p, { type: "home" });
  const text = `${crew.map((id) => survivorById(state, id).name.split(" ")[0]).join(" and ")} set out from ${base.name} to haul the stockpile at ${tileLabel(state, fw.tile)}${p.vehicle ? " with a vehicle" : " on foot"}.`;
  log(state, text, "info");
  return { text, party: p };
}

// ---------- the job trips' plug-in points (job-trips branch: tripland.js TRIP_HOOKS) ----------
// At integration: installTripHooks(TRIP_HOOKS) once (main.js or tripland.js). Then
//   water(state, base, job, list): the base's wells join the water carriers' sources (Fetch water; not the fishers),
//     { id, d, well: true }, sorted in with the river and lake tiles by distance;
//   deposit(state, base, s, job): an outdoor worker's load goes to the nearest stockpile of the base with room (and
//     DROP_MIN_KG to spare) when it is nearer the worker's tile than the base is: { tile, stock: its contents, fw }.
// and FIELD.PASSIVE_WELLS can be set false (the carriers bring the well water instead).
export function installTripHooks(hooks, { passiveWells = false } = {}) {
  if (!hooks) return;
  const prevWater = hooks.water, prevDeposit = hooks.deposit;
  hooks.water = (state, base, job, list) => {
    const base0 = prevWater ? prevWater(state, base, job, list) || list : list;
    if (job !== "water") return base0;
    const wells = waterSourcesFor(state, base).filter((w) => w.rate > 0 && w.today >= 0.5).map((w) => ({ id: w.tile, d: state.grid.distance(base.tile, w.tile), well: true })); // drawn dry for today: the carriers go elsewhere
    return [...base0, ...wells].sort((a, b) => a.d - b.d || a.id - b.id);
  };
  hooks.deposit = (state, base, s, job) => {
    const prev = prevDeposit ? prevDeposit(state, base, s, job) : null;
    if (prev && prev.tile != null) return prev;
    const at = s && s.trip && s.trip.at != null ? s.trip.at : null;
    if (at == null || job === "water") return null;
    const drop = dropPointsFor(state, base, at).find((d) => d.room >= FIELD.DROP_MIN_KG && state.grid.distance(d.tile, at) < state.grid.distance(base.tile, at));
    return drop ? { tile: drop.tile, stock: drop.fw.contents, fw: drop.fw, put: (key, q) => depositAt(state, drop.fw, key, q) } : null; // put: up to its room (no overfill)
  };
  const prevDraw = hooks.draw;
  hooks.draw = (state, base, tile, q) => (fwAt(state, tile) && fwAt(state, tile).kind === "well" ? drawWell(state, tile, q) : prevDraw ? prevDraw(state, base, tile, q) : q);
  FIELD.PASSIVE_WELLS = !!passiveWells;
}

// ---------- radio (radio.js radioNodes, groupNetwork) ----------
export function fieldRelayNodes(state) {
  const out = [];
  for (const fw of fwList(state)) {
    if (fw.kind !== "relay" || !fw.built || fw.hp <= 0 || fw.owner !== "player") continue;
    const base = baseById(state, fw.baseId) || hub(state);
    if (!base) continue;
    out.push({ base, tile: fw.tile, range: RELAY_RANGE, kind: "relay", linked: false, offline: !!fw.offline, field: fw.id });
  }
  return out;
}
export const groupRelayTiles = (state, f) => fwList(state).filter((fw) => fw.kind === "relay" && fw.built && fw.owner === f.id).map((fw) => fw.tile);
function relayUpkeep(state) {
  const today = day(state);
  for (const fw of fwList(state)) {
    if (fw.kind !== "relay" || !fw.built || fw.owner !== "player") continue;
    if (fw.relayDue == null) fw.relayDue = today + RELAY_UPKEEP_DAYS;
    if (today < fw.relayDue && !fw.offline) continue;
    const b = baseById(state, fw.baseId), h = hub(state);
    const from = b && (b.stock.parts || 0) >= 1 ? b : h && (h.stock.parts || 0) >= 1 ? h : null;
    if (from) {
      from.stock.parts -= 1;
      fw.relayDue = today + RELAY_UPKEEP_DAYS;
      if (fw.offline) log(state, `The relay mast at ${tileLabel(state, fw.tile)} is back on the air.`, "good");
      fw.offline = false;
    } else if (!fw.offline) {
      fw.offline = true;
      log(state, `The relay mast at ${tileLabel(state, fw.tile)} went off the air: it needs 1 part.`, "danger");
    }
  }
}

// ---------- who is hostile to whom ----------
// An AI party is hostile to a structure's owner: yours: a hostile group's party, a raid on you, outsiders; a group's:
// a raid on that group.
function partyHostile(state, fw, p) {
  if (p.owner === fw.owner) return false;
  if (fw.owner === "player") {
    if (p.owner === "player") return false;
    if (p.owner === "outsider") return true;
    if (p.kind === "raid" && p.target && p.target.kind === "player") return true;
    if (p.kind === "fwraid") return true;
    const f = typeof p.owner === "number" ? factionById(state, p.owner) : null;
    return !!f && f.alive && attitude(f) === "Hostile";
  }
  if (p.owner === "player") return false; // your teams: teamEnter
  return (p.kind === "raid" && p.target && p.target.factionId === fw.owner) || (p.kind === "fwraid" && p.target && p.target.fw === fw.id);
}
// Something hostile to the owner stands on the tile (a horde, a hostile party, outsider raiders).
export function threatOn(state, tile) {
  const fw = fwAt(state, tile);
  if (state.hordes.some((h) => h.tile === tile && h.size >= 5)) return true;
  if (!fw) return false;
  if (state.parties.some((p) => p.owner !== "player" && partyTile(p) === tile && partyHostile(state, fw, p))) return true;
  if (fw.owner === "player" && (state.visitors || []).some((v) => v.kind === "raiders" && v.tile === tile)) return true;
  return false;
}

// ---------- damage ----------
// n hit points off. Destroyed: gone (its garrison flees home, a stockpile's goods are lost). Returns true if destroyed.
export function damageWork(state, fw, n, why) {
  if (!fw || n <= 0) return false;
  if (!fw.built) {
    const job = jobFor(state, fw);
    if (job) job.progress = Math.max(0, job.progress * FIELD.HORDE.siteLoss);
    if (fw.owner === "player") news(state, fw, `The ${kindName(fw).toLowerCase()} going up at ${tileLabel(state, fw.tile)} was set back by ${why}.`, "warn");
    return false;
  }
  fw.hp = Math.max(0, r1(fw.hp - n));
  fw.hitHour = state.hour;
  if (fw.hp > 0) {
    if (fw.owner === "player") news(state, fw, `${cap(label(state, fw))} was damaged by ${why} (${Math.round(condition(fw) * 100)}% left).`, condition(fw) < 0.35 ? "danger" : "warn");
    return false;
  }
  if (fw.owner === "player") news(state, fw, `${cap(label(state, fw))} was destroyed by ${why}.${fw.kind === "stockpile" && Object.keys(fw.contents || {}).length ? ` What was there (${contentsText(fw)}) is lost.` : ""}`, "danger");
  else if (state.live && state.live.has(fw.tile)) log(state, `${ownerName(state, fw.owner)}'s ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)} was destroyed by ${why}.`, "info");
  removeWork(state, fw);
  return true;
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// The people posted at a structure that falls run for it: each hurt FIELD.HORDE.hurt of the time, killed `killed`.
function scatter(state, fw, killed = FIELD.HORDE.killed) {
  const lines = [];
  for (const s of postedAt(state, fw)) {
    if (state.rng.chance(killed)) { killSurvivor(state, s, fw.tile, `at the ${kindName(fw).toLowerCase()} at ${tileLabel(state, fw.tile)}`); lines.push(`${s.name} was killed`); continue; }
    if (state.rng.chance(FIELD.HORDE.hurt)) { hurt(state, s, state.rng.int(15, 40), fw.tile, `at the ${kindName(fw).toLowerCase()}`); lines.push(`${s.name.split(" ")[0]} got away hurt`); }
    else lines.push(`${s.name.split(" ")[0]} got away`);
  }
  recallAll(state, fw);
  return lines;
}

// ---------- hordes (hordes.js) ----------
// The roadblock's hold: hours a crowd at `rate` hp an hour takes to force a lane through it (ROADBLOCK.gap of its
// condition; at most `most` hours), and that damage: a fresh roadblock stands a lane forced through it, at 40%.
function holdOf(fw, rate, most) {
  const hours = Math.min(most, (fw.hp * FIELD.ROADBLOCK.gap) / Math.max(0.5, rate)); // a lane forced through it: GAP of what stands
  return { hours: r1(hours), dmg: r1(hours * rate) };
}
// A horde entered a tile (hordes.js onHordeEnter, before a base there): a roadblock holds it (h.move goes back), any
// structure is battered, a manned tower's lookouts shoot from above. Returns nothing.
export function hordeEnter(state, h) {
  const fw = fwAt(state, h.tile);
  if (!fw) return;
  const power = hordeWallPower(h);
  const who = `a horde of about ${h.size}`;
  if (fw.kind === "roadblock" && fw.built) {
    const rate = (FIELD.ROADBLOCK.hordeRate + h.size * FIELD.ROADBLOCK.hordePer) * (h.bosses ? 1.6 : 1);
    const hold = holdOf(fw, rate, FIELD.ROADBLOCK.hordeHold);
    h.move = (h.move || 0) - hold.hours;
    if (fw.owner === "player") news(state, fw, `The roadblock at ${tileLabel(state, fw.tile)} holds ${who} for about ${Math.round(hold.hours)} hours.`, "warn");
    damageWork(state, fw, hold.dmg, who);
    return;
  }
  // Lookouts in a tower shoot down from it before it is battered.
  if (fw.kind === "tower" && fw.built) {
    const shots = fw.owner === "player" ? postedAt(state, fw).reduce((a, s) => a + combatPower(s), 0) : (fw.gar || 0) * FIELD.TEAM.garPower;
    const kills = Math.min(Math.floor(h.size * 0.3), Math.round(shots * FIELD.HORDE.shot));
    if (kills > 0) { h.size -= kills; if (fw.owner === "player") log(state, `The lookouts on the tower at ${tileLabel(state, fw.tile)} shot down about ${kills} of the dead.`, "info"); }
  }
  const dmg = FIELD.HORDE.base + power * FIELD.HORDE.per * (fw.kind === "tower" ? 0.7 : 1);
  // A structure about to fall: its people run for it first (hurt or killed by the dice).
  if (fw.built && fw.owner === "player" && dmg >= fw.hp && postedAt(state, fw).length) {
    const lines = scatter(state, fw);
    news(state, fw, `The lookouts fled ${label(state, fw)} before ${who}: ${lines.join(", ")}.`, "danger");
  }
  damageWork(state, fw, dmg, who);
}

// ---------- AI parties (parties.js aiPartyHour) ----------
// An AI party entered a tile: a hostile roadblock holds it (its progress goes back, the roadblock takes the damage); a
// raid on you passing over your stockpile empties it.
export function partyEnter(state, p, tile) {
  const fw = fwAt(state, tile);
  if (!fw || !fw.built || !partyHostile(state, fw, p)) return;
  if (fw.kind === "roadblock") {
    const rate = FIELD.ROADBLOCK.partyRate + (p.strength || 1) * FIELD.ROADBLOCK.partyPer;
    const hold = holdOf(fw, rate, FIELD.ROADBLOCK.partyHold);
    p.progress = (p.progress || 0) - hold.hours * (p.vehicle ? 1 : 0.9);
    const f = factionById(state, p.owner);
    if (fw.owner === "player") news(state, fw, `The roadblock at ${tileLabel(state, fw.tile)} holds up ${p.kind === "raid" ? "a raiding party" : "a hostile party"}${f && f.known ? ` of ${f.name}` : ""} for about ${Math.round(hold.hours)} hours.`, "warn");
    damageWork(state, fw, hold.dmg, f && f.known ? f.name : "raiders");
    return;
  }
  if (fw.kind === "stockpile" && p.kind === "raid" && Object.keys(fw.contents || {}).length) {
    const f = factionById(state, p.owner);
    const what = contentsText(fw);
    if (f) for (const [k, v] of Object.entries(fw.contents)) f.stock[k] = (f.stock[k] || 0) + v;
    fw.contents = {};
    if (fw.owner === "player") news(state, fw, `${f && f.known ? f.name : "Raiders"} on their way past emptied the stockpile at ${tileLabel(state, fw.tile)} (${what}).`, "danger");
  }
}
// A team of yours entered a tile: a group's roadblock stops it a while (hostile: FIELD.ROADBLOCK.teamHostile hours and
// the roadblock takes a beating; otherwise a checkpoint, teamCheck hours; allies wave it through).
export function teamEnter(state, p, tile, speed = 1) {
  const fw = fwAt(state, tile);
  if (!fw || !fw.built || fw.kind !== "roadblock" || fw.owner === "player") return;
  const f = factionById(state, fw.owner);
  if (!f || !f.alive) return;
  const att = attitude(f);
  if (att === "Allied" || f.pact) return;
  const hostile = att === "Hostile";
  const hours = hostile ? FIELD.ROADBLOCK.teamHostile : FIELD.ROADBLOCK.teamCheck;
  p.progress = (p.progress || 0) - hours * speed;
  log(state, hostile ? `The team forced a way through ${f.known ? f.name : "a group"}'s roadblock at ${tileLabel(state, tile)} (${hours} hours).` : `${f.known ? f.name : "A group"}'s checkpoint at ${tileLabel(state, tile)} stopped the team for an hour of questions.`, "info");
  if (hostile) damageWork(state, fw, FIELD.ROADBLOCK.teamDamage, "your team");
}

// ---------- raids on field works ----------
// Once a day: a hostile group near a structure of yours may send a small raid at it (an AI party, kind "fwraid").
function raidsDaily(state) {
  const R = FIELD.RAID;
  for (const fw of fwList(state)) {
    if (fw.owner !== "player" || !fw.built) continue;
    if (state.parties.some((p) => p.kind === "fwraid" && p.target && p.target.fw === fw.id)) continue;
    const near = state.factions.filter((f) => f.alive && f.bases.length && f.pop >= R.minPop && (attitude(f) === "Hostile" || (isAggressiveType(f) && attitude(f) !== "Friendly" && attitude(f) !== "Allied" && !f.pact)))
      .map((f) => ({ f, d: Math.min(...f.bases.map((b) => state.grid.distance(b, fw.tile))) })).filter((x) => x.d <= R.range).sort((a, b) => a.d - b.d);
    if (!near.length) continue;
    const { f } = near[0];
    const chance = Math.min(R.max, R.chance + stockKg(fw) * R.perKg) * (attitude(f) === "Hostile" ? 1 : 0.5);
    if (!state.rng.chance(chance)) continue;
    sendFieldRaid(state, f, fw);
  }
}
// A group's raid on a structure of yours (also the tests). Returns the party or null.
export function sendFieldRaid(state, f, fw, strength = null) {
  const from = f.bases.slice().sort((a, b) => state.grid.distance(a, fw.tile) - state.grid.distance(b, fw.tile))[0];
  const str = strength ?? state.rng.int(FIELD.RAID.str[0], FIELD.RAID.str[1]) + Math.min(6, Math.floor(f.pop / 10));
  const p = spawnAiParty(state, f, "fwraid", from, fw.tile, { strength: str, target: { kind: "field", fw: fw.id, tile: fw.tile, factionId: f.id } });
  return p;
}
// The garrison's power behind the structure (a tower's height × TOWER.perch).
function garrisonPower(state, fw) {
  const base = fw.owner === "player" ? postedAt(state, fw).reduce((a, s) => a + combatPower(s), 0) : (fw.gar || 0) * FIELD.TEAM.garPower;
  return base * (fw.kind === "tower" ? FIELD.TOWER.perch : 1);
}
// The raid is there (parties.js aiPartyHour, at the end of its path): the garrison fights by the numbers; won, the
// raiders go home beaten; lost (or nobody there), they take the structure over (near their land, CAPTURE of the time;
// never a relay), or empty it and wreck it.
export function fieldRaidArrive(state, p) {
  const fw = p.target ? fwById(state, p.target.fw) : null;
  const f = factionById(state, p.owner);
  removeParty(state, p);
  if (!fw || !f || fw.owner === f.id) return;
  const gp = garrisonPower(state, fw);
  const who = f.known ? f.name : "Raiders";
  if (gp > 0) {
    const odds = winOdds(gp / Math.max(0.5, p.strength), { people: Math.max(1, fw.owner === "player" ? postedAt(state, fw).length : fw.gar || 1), count: Math.max(1, Math.round(p.strength / 3)) });
    if (state.rng.chance(odds)) {
      if (fw.owner === "player") {
        for (const s of postedAt(state, fw)) if (state.rng.chance(0.25)) hurt(state, s, state.rng.int(8, 25), fw.tile, `holding the ${kindName(fw).toLowerCase()}`);
        news(state, fw, `${who} attacked ${label(state, fw)}; the lookouts drove them off.`, "warn");
      }
      damageWork(state, fw, 8, who);
      return;
    }
    if (fw.owner === "player") {
      const lines = scatter(state, fw, 0.15);
      news(state, fw, `${who} overran ${label(state, fw)}: ${lines.join(", ")}.`, "danger");
    } else fw.gar = 0;
  }
  if (fw.owner === "player" && fw.kind === "stockpile" && Object.keys(fw.contents || {}).length) {
    const what = contentsText(fw);
    for (const [k, v] of Object.entries(fw.contents)) f.stock[k] = (f.stock[k] || 0) + v;
    fw.contents = {};
    news(state, fw, `${who} emptied the stockpile at ${tileLabel(state, fw.tile)} (${what}).`, "danger");
  }
  const nearLand = Math.min(...f.bases.map((b) => state.grid.distance(b, fw.tile))) <= FIELD.RAID.near;
  if (fw.kind !== "relay" && nearLand && state.rng.chance(FIELD.RAID.capture)) { captureWork(state, fw, f.id); return; }
  damageWork(state, fw, fw.hp, who);
}
// A structure changes hands: the old garrison goes, the job queue drops it; a group's garrison of FIELD.AI.gar.
export function captureWork(state, fw, owner, baseId = null) {
  const was = fw.owner;
  recallAll(state, fw);
  ensureFW(state).jobs = ensureFW(state).jobs.filter((j) => j.fw !== fw.id);
  fw.owner = owner;
  fw.captured = { from: was, hour: state.hour };
  fw.hp = Math.max(fw.hp, Math.round(fw.max * 0.4));
  if (owner === "player") {
    fw.baseId = baseId ?? nearestBase(state, fw.tile)?.id ?? null;
    fw.gar = 0;
    delete fw.baseTile;
  } else {
    const f = factionById(state, owner);
    fw.baseTile = f && f.bases.length ? f.bases.slice().sort((a, b) => state.grid.distance(a, fw.tile) - state.grid.distance(b, fw.tile))[0] : null;
    fw.gar = fw.kind === "tower" ? FIELD.AI.gar : 0;
    fw.garrison = [];
    delete fw.baseId;
  }
  if (was === "player") news(state, fw, `${ownerName(state, owner) === "a group" ? "A group" : ownerName(state, owner)} took ${label(state, fw)} from you. Send a team to take it back (Capture).`, "danger");
  else if (owner === "player") log(state, `Your team took ${label(state, fw)} from ${ownerName(state, was)}.`, "good");
}
const nearestBase = (state, tile) => state.bases.slice().sort((a, b) => state.grid.distance(a.tile, tile) - state.grid.distance(b.tile, tile))[0] || null;

// ---------- your teams at a structure (orders.js "fwork") ----------
// What a team can do here: [{ act, label, hours, why, hint }].
export function teamActs(state, p, tile) {
  const fw = fwAt(state, tile);
  if (!fw) return [];
  const T = FIELD.TEAM;
  const out = [];
  if (fw.owner === "player") {
    if (fw.kind === "stockpile" && fw.built) {
      out.push({ act: "load", label: `Load from the stockpile (${T.load}h)`, hours: T.load, why: Object.keys(fw.contents || {}).length ? (cargoRoom(state, p) < 1 ? "No room to carry anything." : "") : "The stockpile is empty.", hint: `Take what is there (${contentsText(fw)}) as far as there is room; bring it home.` });
      out.push({ act: "unload", label: `Leave finds at the stockpile (${T.unload}h)`, hours: T.unload, why: stockRoom(fw) < 1 ? "The stockpile is full." : "", hint: "Leave what the team found (scrap, parts, materials, firewood…) here for a haul team; it keeps its food, water, meds and ammo." });
    }
    return out;
  }
  const f = factionById(state, fw.owner);
  const gar = fw.gar || 0;
  const fight = gar ? ` (${gar} on guard: a fight)` : "";
  const gw = f && attitude(f) !== "Hostile" ? ` Goodwill ${T.gw} with ${f.known ? f.name : "them"}.` : "";
  out.push({ act: "destroy", label: `Wreck their ${kindName(fw).toLowerCase()} (${T.destroy}h)${fight}`, hours: T.destroy, why: fw.built ? "" : "Not built yet.", hint: `Pull it down and burn what is left.${gw}` });
  if (fw.kind !== "relay") out.push({ act: "capture", label: `Take their ${kindName(fw).toLowerCase()} (${T.capture}h)${fight}`, hours: T.capture, why: !fw.built ? "Not built yet." : !state.bases.length ? "You have no base to hold it from." : "", hint: `It becomes yours, held from your nearest base${fw.kind === "tower" ? " (post lookouts there from its Field works tab)" : ""}.${gw}` });
  if (fw.kind === "stockpile" && Object.keys(fw.contents || {}).length) out.push({ act: "loot", label: `Take their stockpile's goods (${T.load}h)${fight}`, hours: T.load, why: cargoRoom(state, p) < 1 ? "No room to carry anything." : "", hint: `${contentsText(fw)}.${gw}` });
  return out;
}
export function teamActProblem(state, p, act) {
  const a = teamActs(state, p, partyTile(p)).find((x) => x.act === act);
  if (!a) return "Nothing of that kind here.";
  return a.why;
}
export const teamActHours = (act) => (act === "destroy" ? FIELD.TEAM.destroy : act === "capture" ? FIELD.TEAM.capture : act === "unload" ? FIELD.TEAM.unload : FIELD.TEAM.load);
// The task is done (orders.js finishTask). Returns the line.
export function teamActDone(state, p, act) {
  const tile = partyTile(p);
  const fw = fwAt(state, tile);
  if (!fw) return "The field work is gone.";
  if (act === "load" && fw.owner === "player") return loadFromStockpile(state, p, fw);
  if (act === "unload" && fw.owner === "player") return unloadToStockpile(state, p, fw);
  if (fw.owner === "player") return "It is yours already.";
  const f = factionById(state, fw.owner);
  // Their guard first, by the numbers.
  if ((fw.gar || 0) > 0) {
    const members = partyMembers(state, p);
    const mine = members.reduce((a, s) => a + combatPower(s), 0);
    const odds = winOdds(mine / Math.max(0.5, garrisonPower(state, fw)), { people: members.length, count: fw.gar });
    if (!state.rng.chance(odds)) {
      for (const s of members) if (state.rng.chance(0.5)) hurt(state, s, state.rng.int(10, 30), tile, `attacking a ${kindName(fw).toLowerCase()}`);
      return `The guards at their ${kindName(fw).toLowerCase()} drove the team off. ${members.map((s) => `${s.name.split(" ")[0]} ${Math.floor(s.health)}`).join(", ")}.`;
    }
    fw.gar = 0;
  }
  if (f && f.alive && attitude(f) !== "Hostile") changeGoodwill(state, f, FIELD.TEAM.gw, `your team hit their ${kindName(fw).toLowerCase()}`);
  if (act === "loot") {
    if (!p.cargo) p.cargo = { supplies: {}, gear: [] };
    const got = [];
    for (const [k, q] of Object.entries(fw.contents || {})) {
      const fits = Math.min(q, Math.floor(cargoRoom(state, p) / (SUPPLIES[k] ? SUPPLIES[k].weight : 1)));
      if (fits <= 0) continue;
      p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + fits;
      fw.contents[k] = q - fits;
      if (fw.contents[k] <= 0) delete fw.contents[k];
      got.push(`${fits} ${matName(k, fits)}`);
    }
    return got.length ? `The team took ${got.join(", ")} from their stockpile.` : "No room for any of it.";
  }
  if (act === "capture") {
    const base = nearestBase(state, tile);
    captureWork(state, fw, "player", base ? base.id : null);
    return `The ${kindName(fw).toLowerCase()} is yours, held from ${base ? base.name : "your nearest base"}.`;
  }
  const name = kindName(fw).toLowerCase();
  removeWork(state, fw);
  return `The team wrecked ${f && f.known ? `${f.name}'s` : "their"} ${name}.`;
}

// ---------- the groups' own (AI parity) ----------
// Every FIELD.AI.every days a group may put one up near its main base (coarse, paid from its stores, standing at once
// after FIELD.AI.work days): a tower when threatened, a well while its water is short, a stockpile when its stores
// are big (a share of them goes there), a roadblock on a road through its land (aggressive groups); repairs are
// made from scrap when they have it. At most max[0] + people / max[1], up to max[2].
export function groupFieldDaily(state) {
  const A = FIELD.AI;
  for (const f of state.factions) {
    if (!f.alive || !f.bases.length) continue;
    const mine = groupWorks(state, f);
    // Their builds under way stand when the work is done.
    for (const fw of mine) {
      if (!fw.built && day(state) >= (fw.readyDay || 0)) { fw.built = true; fw.hp = fw.max; if (fw.kind === "tower" && f.pop >= A.garPop) fw.gar = A.gar; }
      if (fw.built && fw.kind === "tower" && !fw.gar && f.pop >= A.garPop && state.rng.chance(0.3)) fw.gar = A.gar;
      if (fw.built && fw.hp < fw.max && (f.stock.scrap || 0) >= 4) { f.stock.scrap -= 2; fw.hp = Math.min(fw.max, fw.hp + fw.max * 0.25); }
    }
    if ((day(state) + localId(state, f.id)) % A.every !== 0) continue; // localId: the same days in a replay of the seed
    const maxN = Math.min(A.max[2], A.max[0] + Math.floor(f.pop / A.max[1]));
    if (mine.length >= maxN) continue;
    const pick = groupWants(state, f, mine);
    if (!pick) continue;
    const cost = { scrap: Math.ceil((K[pick.kind].cost.scrap || 0) * 0.6), parts: K[pick.kind].cost.parts ? 1 : 0 };
    if ((f.stock.scrap || 0) < cost.scrap + 5 || (f.stock.parts || 0) < cost.parts) continue;
    f.stock.scrap -= cost.scrap;
    if (cost.parts) f.stock.parts -= cost.parts;
    buildGroupWork(state, f, pick.kind, pick.tile, false);
  }
}
// Puts a group's structure on a tile (now: built; else ready in FIELD.AI.work days). Also the tests.
export function buildGroupWork(state, f, kind, tile, now = true) {
  const def = K[kind];
  const fw = { id: newId(), kind, tile, owner: f.id, baseTile: f.bases[0], hp: def.hp, max: def.hp, built: !!now, readyDay: day(state) + FIELD.AI.work, garrison: [], gar: now && kind === "tower" ? FIELD.AI.gar : 0, contents: {}, since: state.hour };
  if (kind === "stockpile") {
    // A share of their stores goes out there (a forward cache), within its room.
    for (const k of ["food", "scrap", "ammo", "fuel"]) {
      const put = Math.min(Math.floor((f.stock[k] || 0) * FIELD.AI.stock), Math.floor(stockRoomOf(fw) / SUPPLIES[k].weight));
      if (put > 0) { fw.contents[k] = (fw.contents[k] || 0) + put; f.stock[k] -= put; }
    }
  }
  if (kind === "well") {
    const y = wellYield(state, tile);
    fw.well = { yield: y, left: WELL_LEFT.max, start: WELL_LEFT.max, dug: state.hour };
  }
  ensureFW(state).list.push(fw);
  if (state.live && state.live.has(tile)) log(state, `${f.known ? f.name : "A group"} ${now ? "put up" : "is putting up"} a ${def.name.toLowerCase()} at ${tileLabel(state, tile)}.`, "info");
  return fw;
}
const stockRoomOf = (fw) => Math.max(0, (K[fw.kind].capKg || 0) - kgIn(fw.contents));
// What a group would put up next, and where: { kind, tile } or null.
export function groupWants(state, f, mine = groupWorks(state, f)) {
  const has = (k) => mine.some((x) => x.kind === k);
  const main = f.bases[0];
  const land = state.grid.within(main, 2).filter((id) => id !== main && state.tiles[id].owner === f.id && state.tiles[id].terrain !== "water" && !state.tiles[id].hive && !fwAt(state, id) && !state.bases.some((b) => b.tile === id) && !state.factions.some((o) => o.alive && o.bases.includes(id)));
  if (!land.length) return null;
  const g = state.grid;
  const threat = state.hordes.some((h) => g.distance(h.tile, main) <= 6) || state.factions.some((o) => o !== f && o.alive && isAggressiveType(o) && o.bases.some((b) => g.distance(b, main) <= 12)) || state.bases.some((b) => g.distance(b.tile, main) <= 8 && attitude(f) === "Hostile");
  const pickBy = (fn) => land.slice().sort((a, b) => fn(b) - fn(a) || a - b)[0];
  if (!has("tower") && threat) return { kind: "tower", tile: pickBy((id) => g.distance(id, main) * 10 + (state.tiles[id].terrain === "hills" ? 5 : 0)) };
  if (!has("well") && (f.stock.water == null || (f.stock.water || 0) < f.pop * 3)) { const t = pickBy((id) => wellYield(state, id)); if (wellYield(state, t) > 0) return { kind: "well", tile: t }; }
  if (!has("stockpile") && ((f.stock.scrap || 0) + (f.stock.food || 0)) > f.pop * 20) return { kind: "stockpile", tile: pickBy((id) => -g.distance(id, main)) };
  if (!has("roadblock") && isAggressiveType(f)) { const roads = land.filter((id) => state.tiles[id].road); if (roads.length) return { kind: "roadblock", tile: roads.sort((a, b) => g.distance(b, main) - g.distance(a, main) || a - b)[0] }; }
  return null;
}
// A group's manned towers near a base add to its defence (factions.js resolveRaidOnFaction via groupworks.js): ×.
export function groupFieldDefence(state, f, tile) {
  const n = fwList(state).filter((fw) => fw.owner === f.id && fw.kind === "tower" && fw.built && (fw.gar || 0) > 0 && state.grid.distance(fw.tile, tile) <= 3).length;
  return 1 + 0.1 * Math.min(2, n);
}
// A group's field wells (groupworks.js provisioned): wells that count as built water works.
export const groupFieldWells = (state, f) => fwList(state).filter((fw) => fw.owner === f.id && fw.kind === "well" && fw.built).length;

// ---------- the governor and a base's leader (autopilot.js governBase) ----------
// Modest: a well when the water runs short, a tower when the base is threatened (and lookouts posted once it has the
// people), repairs to anything below FIELD.GOV.repairAt. Returns the lines said.
export function govFieldWorks(state, base, { threatened = false, waterShort = false } = {}) {
  const lines = [];
  if (!base || maxWorks(base) <= 0) return lines;
  const mine = playerWorks(state, base);
  const n = atBase(state, base.id).length;
  const busy = jobsOf(state, base).length > 0;
  // Firewood is the winter's: the governor spends none of it on a field work (a tower 120, a roadblock 150, their repairs)
  // while the woodpile, less the cost, is behind GOV.woodKeep of what the coming cold needs (woodcutting.js woodNeed).
  // (woodtest seed 43: a tower bought from the starting 300 in spring, then rebuilt, left the hub nothing to start on.)
  const w = woodNeed(state, base);
  const woodOk = (cost) => !(cost && cost.wood > 0) || w.need <= 0 || (base.stock.wood || 0) - cost.wood >= w.need * FIELD.GOV.woodKeep;
  const pickTile = (kind, score) => placeTiles(state, base, kind).filter((x) => !placeProblem(state, base, kind, x.tile)).sort((a, b) => score(b.tile) - score(a.tile) || a.tile - b.tile)[0];
  // Repairs first.
  for (const fw of mine) if (fw.built && condition(fw) < FIELD.GOV.repairAt && !jobFor(state, fw) && woodOk(repairCost(state, fw).cost)) { const r = queueRepair(state, fw.id); if (!r.error) lines.push(r.text); }
  if (!busy && !mine.some((x) => x.kind === "well") && waterShort) {
    const t = pickTile("well", (id) => wellYield(state, id) * 10 - state.grid.distance(base.tile, id));
    if (t && wellYield(state, t.tile) >= 4) { const r = planFieldWork(state, base, "well", t.tile); if (!r.error) lines.push(r.text); }
  }
  if (!busy && threatened && n >= FIELD.GOV.towerPop && !mine.some((x) => x.kind === "tower") && woodOk(K.tower.cost)) {
    const t = pickTile("tower", (id) => state.grid.distance(base.tile, id) * 10 + (state.tiles[id].terrain === "hills" ? 5 : 0));
    if (t) { const r = planFieldWork(state, base, "tower", t.tile); if (!r.error) lines.push(r.text); }
  }
  // Lookouts: one at a base of FIELD.GOV.garrisonPop, two at twice that, while it is threatened.
  for (const fw of mine.filter((x) => x.kind === "tower" && x.built)) {
    const want = !threatened ? 0 : n >= FIELD.GOV.garrisonPop * 2 ? 2 : n >= FIELD.GOV.garrisonPop ? 1 : 0;
    const have = postedAt(state, fw);
    if (have.length < want) {
      const pick = atBase(state, base.id).filter((s) => !healthRest(s) && !s.pinned && !s.leader && s.role !== "medic").sort((a, b) => skill(b, "scouting") - skill(a, "scouting") || a.id - b.id)[0];
      if (pick) { const r = postPerson(state, fw.id, pick.id); if (!r.error) lines.push(r.text); }
    } else if (have.length > want && !threatened) for (const s of have.slice(want)) lines.push(recallPerson(state, s.id, "the danger has passed"));
  }
  return lines;
}
// ---------- the hour and the day ----------
// Hourly (world.js tickHour, after the parties and hordes move): garrisons tidied (dead, moved, a structure gone).
export function fieldworksHour(state) {
  if (!state.fieldworks) return;
  for (const fw of fwList(state)) {
    if (fw.owner !== "player" || !fw.garrison || !fw.garrison.length) continue;
    fw.garrison = fw.garrison.filter((id) => { const s = survivorById(state, id); return s && s.alive && s.location && s.location.kind === "post" && s.location.fw === fw.id; });
  }
  // Anyone on a post whose structure is gone, or whose base is gone, comes home.
  for (const s of alive(state)) if (onPost(s) && !fwById(state, s.location.fw)) recallPerson(state, s.id);
  // Hostiles camped on a tower: its people come home.
  for (const fw of fwList(state)) if (fw.owner === "player" && fw.garrison && fw.garrison.length && threatOn(state, fw.tile) && !state.hordes.some((h) => h.tile === fw.tile)) {
    const lines = recallAll(state, fw, "enemies at the tower");
    if (lines.length) news(state, fw, `The lookouts left the tower at ${tileLabel(state, fw.tile)}: enemies there.`, "warn");
  }
}
// Daily (world.js, with the groups): relays' upkeep, the raids on your structures, the groups' own building, structures
// whose base is gone (held from your nearest base, or abandoned with none), hordes drawn to lit towers.
export function fieldworksDaily(state) {
  if (!state.fieldworks && !state.factions.some((f) => f.alive)) return;
  ensureFW(state);
  for (const fw of [...fwList(state)]) {
    if (fw.owner === "player" && !baseById(state, fw.baseId)) {
      const b = nearestBase(state, fw.tile);
      if (b && state.grid.distance(b.tile, fw.tile) <= FIELD.RANGE + 2) fw.baseId = b.id;
      else { removeWork(state, fw); continue; }
    }
    if (typeof fw.owner === "number") {
      const f = factionById(state, fw.owner);
      if (!f || !f.alive || !f.bases.length) { removeWork(state, fw); continue; }
    }
  }
  relayUpkeep(state);
  raidsDaily(state);
  groupFieldDaily(state);
  // A manned tower's fire and voices draw a roaming horde within 3 tiles now and then.
  for (const fw of fwList(state)) {
    if (fw.kind !== "tower" || !fw.built || (fw.owner === "player" ? !postedAt(state, fw).length : !(fw.gar > 0))) continue;
    for (const h of state.hordes) if ((h.role === "roam" || h.role === "border") && state.grid.distance(h.tile, fw.tile) <= 3 && h.tile !== fw.tile && state.rng.chance(0.15)) { h.target = fw.tile; h.path = null; }
  }
}

// ---------- text ----------
export function fwStatusText(state, fw) {
  const bits = [];
  if (!fw.built) { const j = jobFor(state, fw); bits.push(j ? `going up: ${Math.round((j.progress / j.hours) * 100)}%` : "a site"); }
  else {
    bits.push(`condition ${Math.round(condition(fw) * 100)}%`);
    if (fw.kind === "tower") bits.push(fw.owner === "player" ? `${postedAt(state, fw).length}/${garrisonCap(fw)} posted${manned(state, fw) ? ", watching" : postedAt(state, fw).length ? ", dark now" : ", unmanned: sees nothing"}` : `${fw.gar || 0} on guard`);
    if (fw.kind === "well" && fw.well) bits.push(fw.well.left <= 0 ? "dry" : `${wellRate(state, fw.well)} water a day, ${Math.round(fw.well.left)} left`);
    if (fw.kind === "stockpile") bits.push(`${stockKg(fw)}/${K.stockpile.capKg} kg: ${contentsText(fw)}`);
    if (fw.kind === "relay") bits.push(fw.offline ? "offline: needs 1 part" : "on the air");
  }
  const j = jobFor(state, fw);
  if (fw.built && j) bits.push(`${j.type === "repair" ? "repairs" : "demolition"} ${Math.round((j.progress / j.hours) * 100)}%`);
  return bits.join(" · ");
}
// The map's hover lines for a tile.
export function fwTooltip(state, tile) {
  const fw = fwAt(state, tile);
  if (!fw) return "";
  const base = fw.owner === "player" ? baseById(state, fw.baseId) : null;
  const who = fw.owner === "player" ? `yours${base ? ` (${base.name})` : ""}` : ownerName(state, fw.owner);
  const band = damageBand(fw);
  return `${K[fw.kind].icon} ${kindName(fw)}, ${who}: ${fwStatusText(state, fw)}${band ? ` · 🔧 ${band === "bad" ? "badly damaged" : "needs repair"}` : ""}`;
}

// The job trips (sim/jobtrips.js) are always on: the field wells join the water carriers' sources (their water comes in
// by the Fetch water job, not by itself: FIELD.PASSIVE_WELLS false) and the stockpiles are drop points. Installed once
// here, at load, so the game and the headless tools (tools/*.js) both get it.
installTripHooks(TRIP_HOOKS);
