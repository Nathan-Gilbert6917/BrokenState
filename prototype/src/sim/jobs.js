// Jobs for other groups: they post work over the radio (groups in reach) or at their gates (your team at their
// base), you accept it, and the sim checks it every hour until it is done or the deadline passes.
//
// Offers
// - Once a day each known group that is not hostile and is in radio reach may post a job: 6% a day (traders and
//   communes 8%), at most one open offer and two jobs under way per group, six jobs under way in all, and no new
//   offer from the same group within 4 days. A team of yours at their base (trading or waiting there) hears of
//   work at the gates: 60% when it arrives, once every 3 days per group.
// - An offer is a card (Accept / Maybe later / Decline) and stays in the Groups tab's Jobs list for 4 days.
//   Declining costs 1 goodwill; an offer left to expire costs 1.
// - An accepted job that misses its deadline fails: −4 goodwill (−2 for a small one). A job that cannot be done
//   any more through nobody's fault (the horde merged into another and wandered off, the war ended and their
//   people came home, the group is gone) is called off with no cost.
//
// Types (what is checked; deadline from acceptance)
// - horde: a horde within 6 tiles of their bases. Done when it is gone or down to 40% of its size and a team of
//   yours came within 1 tile of it while the job ran (12 days).
// - escort: their caravan to another group's base. It leaves when a team of yours is within 1 tile of their main
//   base, raiders do not ambush it while a team of yours is within 2 tiles, and it is done when it arrives having
//   had your team within 2 tiles for at least half of its hours on the road (10 days to show up).
// - deliver: N of a supply they are short of (meds after sickness, food, ammo at war...). A team of yours standing
//   at one of their bases hands over what it carries; or ask them to fetch it: their caravan comes to your trade
//   base and takes what the base has (10 days).
// - rescue: their people held by a group at war with them (or taken by raiders). A team of yours at the holders'
//   base gets a card: storm it (a battle against 60% of their guards), talk them out (Speech, not with a hostile
//   group) or pay (40 a head in the team's ammo, food or meds) (14 days).
// - hive: storm a hive within 8 tiles of them; their fighters join the assault (fewer of the brood reach your
//   squad: alliance.js hiveAllies). Done when the hive falls with a team of yours within 1 tile of it (20 days).
// - scout: a region 5–10 tiles out from their main base (radius 2). Done when 70% of its tiles are on your map from
//   reports newer than the job (12 days).
// - retrieve: something at a site (a crash site if there is one): a team of yours on the site picks it up, and it
//   is done when a team carries it to their base, or it is brought to your base and their caravan fetches it (14
//   days). A team lost with it drops it where it fell.
//
// Rewards: goodwill (6 + 4 × size), plus one or two of: supplies from their surplus (about 40 × size of value),
// gear you cannot craft (from what they stock), a manual or blueprint you lack (blueprints.js blueprintReward,
// when the game has blueprint items; 40 ammo if they have none you lack), 1–2 recruits (a
// recruit card), intel (their region and the hives and hordes near them), or, for a big job from a group with two
// or more bases, one of their outposts handed over to you with two of their people as its staff.
import { GEAR, SUPPLIES, SUPPLY_KEYS, LOCATIONS } from "./data.js";
import { day, log, hub, factionById, addCard, atBase, snapshot, skill, combatPower, makeSurvivor, newId } from "./world.js";
import { siteKnown } from "./discovery.js";
import { attitude, changeGoodwill, isAggressiveType, recomputeOwnership } from "./factions.js";
import { partyMembers, partyTile, tileLabel, carried, takeSupply, planPath, spawnAiParty, awaitOrders, outpostName } from "./parties.js";
import { canRadioGroup, tradeBase } from "./radio.js";
import { available, marketOf } from "./trade.js";
import { sendCaravan, guardPower, escortParty } from "./caravans.js";
import { makeCandidate, offerRecruits } from "./recruits.js";
import { lootItem } from "./inventory.js";
import { traderSource, spend } from "./itemcond.js";
import { CRAFTS } from "./crafting.js";
import { hordeScore } from "./hordes.js";
import { startCombat, registerCombatHandler } from "./combat.js";
import { guardsFor } from "./conflicts.js";
import { gainXp, USE } from "./skills.js";
import { diploRng, ensureDiplo, warsOf, enemyIn, warById, relation } from "./diplomacy.js";
import { blueprintReward } from "./blueprints.js";
import { askBaseName } from "./basenames.js"; // name an outpost handed to you
import { supplyAmt, useSupply } from "./rounds.js"; // "ammo": every round there, any calibre

export const JOBS = {
  RADIO_CHANCE: 0.06, FRIENDLY_CHANCE: 0.08, GATE_CHANCE: 0.6, OFFER_DAYS: 4, OFFER_GAP: 4, GATE_GAP: 3,
  PER_GROUP: 2, MAX_ACTIVE: 6, FAIL_GW: 4, FAIL_GW_SMALL: 2, DECLINE_GW: 1, IGNORE_GW: 1,
};
export const JOB_TYPES = {
  horde:    { name: "Clear a horde",      icon: "🧟", days: 12, mission: "cull" },
  escort:   { name: "Escort a caravan",   icon: "🛡", days: 10, mission: "move" },
  deliver:  { name: "Deliver supplies",   icon: "📦", days: 10, mission: "trade" },
  rescue:   { name: "Rescue their people", icon: "⛓", days: 14, mission: "move" },
  hive:     { name: "Storm a hive",       icon: "🔥", days: 20, mission: "hive" },
  scout:    { name: "Scout a region",     icon: "🔭", days: 12, mission: "recon" },
  retrieve: { name: "Retrieve a package", icon: "🎒", days: 14, mission: "recon" },
};
const PACKAGES = ["a lockbox of seed stock", "the spare motor for their water pump", "a case of medical records", "a crate of radio parts", "a satchel of maps", "their scout's pack"];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function ensureJobs(state) {
  if (!state.jobs) state.jobs = { list: [], seq: 1, lastOffer: {}, lastGate: {}, stats: { offered: 0, accepted: 0, done: 0, failed: 0, expired: 0, declined: 0, void: 0 } };
  return state.jobs;
}
export const jobById = (state, id) => ensureJobs(state).list.find((j) => j.id === Number(id)) || null;
export const activeJobs = (state) => ensureJobs(state).list.filter((j) => j.status === "active");
export const openOffers = (state) => ensureJobs(state).list.filter((j) => j.status === "offered");
export const jobsOf = (state, f) => ensureJobs(state).list.filter((j) => j.fid === f.id && (j.status === "active" || j.status === "offered"));
export const jobsDoneFor = (state, f) => ensureJobs(state).list.filter((j) => j.fid === f.id && j.status === "done").length;
// Where a job points on the map right now (null: nowhere to go).
export function jobTile(state, j) {
  if (j.type === "retrieve") {
    if (j.data.carrier != null || j.data.atHub) { const f = factionById(state, j.fid); return f && f.bases.length ? f.bases[0] : null; }
    return j.data.site;
  }
  if (j.type === "escort" && j.data.caravanId != null) { const c = state.parties.find((p) => p.id === j.data.caravanId); return c ? partyTile(c) : j.target; }
  return j.target;
}

// ---------- making jobs ----------
const minDist = (state, tile, f) => Math.min(...f.bases.map((b) => state.grid.distance(b, tile)));
const ROLES_FREE = ["roam", "attack", "border", "build"];

function hordeJob(state, f) {
  const hs = state.hordes.filter((h) => (ROLES_FREE.includes(h.role) || !h.role) && h.size >= 15 && minDist(state, h.tile, f) <= 6);
  if (!hs.length) return null;
  const h = hs.sort((a, b) => b.size - a.size || a.id - b.id)[0];
  const size = h.size < 60 ? 1 : h.size < 150 ? 2 : 3;
  return { type: "horde", target: h.tile, size, data: { hordeId: h.id, size0: h.size },
    desc: `A horde of about ${h.size} (score ${hordeScore(h.size)}) is near ${tileLabel(state, h.tile)}, ${minDist(state, h.tile, f)} tiles from their walls. Clear it out or cut it down to under half.` };
}
function escortJob(state, f) {
  if (isAggressiveType(f) || !f.bases.length) return null;
  const rng = diploRng(state);
  const to = state.factions.filter((o) => o.alive && o !== f && o.bases.length && relation(state, f, o) >= -10 && !warsOf(state, f).some((w) => enemyIn(w, f) === o.id))
    .map((o) => ({ o, d: state.grid.distance(f.bases[0], o.bases[0]) })).filter((x) => x.d >= 6 && x.d <= 22);
  if (!to.length) return null;
  const pick = rng.pick(to);
  if (!planPath(state, f.bases[0], pick.o.bases[0], false)) return null;
  return { type: "escort", target: f.bases[0], size: 2, data: { to: pick.o.id, toTile: pick.o.bases[0], stage: "waiting", caravanId: null, near: 0, road: 0 },
    desc: `Their caravan to ${pick.o.known ? pick.o.name : tileLabel(state, pick.o.bases[0])} (${pick.d} tiles) needs guards. Meet it at their base; it sets out when your team is there. Stay within 2 tiles of it for at least half the way.` };
}
const DELIVER_CAP = { meds: [6, 20], food: [30, 60], ammo: [60, 150], fuel: [10, 20], parts: [2, 4], scrap: [20, 40], water: [25, 40], carparts: [2, 4], gunparts: [2, 4], electronics: [2, 4] };
function deliverJob(state, f) {
  const m = marketOf(state, f);
  const rng = diploRng(state);
  const wants = m.wants.filter((w) => DELIVER_CAP[w.key]);
  if (f.atWar && !wants.some((w) => w.key === "ammo")) wants.push({ key: "ammo", need: 1.5, qty: 100 });
  if (!wants.length) return null;
  const w = f.shock && wants.some((x) => x.key === f.shock.key) ? wants.find((x) => x.key === f.shock.key) : wants[0];
  const [lo, hi] = DELIVER_CAP[w.key];
  const qty = clamp(Math.round(Math.min(w.qty, rng.int(lo, hi))), lo, hi);
  const value = qty * SUPPLIES[w.key].value;
  const why = f.shock && f.shock.key === w.key ? (w.key === "meds" ? "Sickness is going round" : w.key === "food" ? "They lost a harvest" : "They lost a store") : f.atWar && w.key === "ammo" ? "They are at war" : "They are running short";
  return { type: "deliver", target: f.bases[0], size: value < 60 ? 1 : value < 150 ? 2 : 3, data: { key: w.key, qty, left: qty, value },
    desc: `${why}: they need ${qty} ${w.key}. Hand it over at their base with a team, or have it ready at your trade base and ask them to fetch it.` };
}
function rescueJob(state, f) {
  const rng = diploRng(state);
  for (const w of warsOf(state, f)) {
    const n = w.captives[f.id] || 0;
    const holder = factionById(state, enemyIn(w, f));
    if (n < 1 || !holder || !holder.alive || !holder.bases.length) continue;
    if (activeJobs(state).some((j) => j.type === "rescue" && j.data.warId === w.id)) continue;
    w.captives[f.id] -= n;
    return { type: "rescue", target: holder.bases[0], size: 3, data: { holder: holder.id, count: n, warId: w.id },
      desc: `${holder.known ? holder.name : "Their enemies"} took ${plural(n, "of their people")} in the war and hold them at ${tileLabel(state, holder.bases[0])}. Get them out.` };
  }
  // Raiders took some of them.
  if (!rng.chance(0.3) || f.pop < 12) return null;
  const holder = state.factions.filter((o) => o.alive && o !== f && o.type === "raider" && o.bases.length && minDist(state, o.bases[0], f) <= 20)[0];
  if (!holder) return null;
  const n = rng.int(1, 3);
  f.pop -= n;
  return { type: "rescue", target: holder.bases[0], size: 3, data: { holder: holder.id, count: n, warId: null },
    desc: `${holder.known ? holder.name : "Raiders"} grabbed ${plural(n, "of their people")} on the road and hold them at ${tileLabel(state, holder.bases[0])}. Get them out.` };
}
function hiveJob(state, f) {
  const hv = (state.hives || []).filter((h) => minDist(state, h.tile, f) <= 8).sort((a, b) => minDist(state, a.tile, f) - minDist(state, b.tile, f))[0];
  if (!hv) return null;
  return { type: "hive", target: hv.tile, size: 3, data: { hiveId: hv.id },
    desc: `${hv.name[0].toUpperCase() + hv.name.slice(1)} sends its dead against them. Storm it: their fighters will join your squad at the mound.` };
}
function scoutJob(state, f) {
  const rng = diploRng(state), g = state.grid;
  const k = state.knowledge;
  const cands = g.within(f.bases[0], 10).filter((id) => {
    const d = g.distance(id, f.bases[0]);
    if (d < 5 || state.tiles[id].terrain === "water") return false;
    const tiles = g.within(id, 2);
    return tiles.filter((t) => !k[t] || k[t].hour < state.hour - 24 * 20).length >= tiles.length * 0.6;
  });
  if (!cands.length) return null;
  const center = rng.pick(cands);
  return { type: "scout", target: center, size: 1, data: { center, r: 2, need: 0.7 },
    desc: `They want to know what is around ${tileLabel(state, center)}: scout the tiles within 2 of it and report back (70% of them on your map, newer than the job).` };
}
function retrieveJob(state, f) {
  const rng = diploRng(state), g = state.grid;
  const sites = g.within(f.bases[0], 12).filter((id) => {
    const t = state.tiles[id];
    return t.loc && t.loc.type !== "city" && !t.hive && g.distance(id, f.bases[0]) >= 3 && !state.factions.some((o) => o.bases.includes(id)) && !state.bases.some((b) => b.tile === id);
  });
  if (!sites.length) return null;
  const crash = sites.filter((id) => state.tiles[id].loc.type === "crashsite");
  const site = rng.pick(crash.length ? crash : sites);
  const what = rng.pick(PACKAGES);
  return { type: "retrieve", target: site, size: 2, data: { site, what, carrier: null, atHub: false, lastTile: site },
    desc: `Their people left ${what} at ${tileLabel(state, site)}${state.tiles[site].loc.type === "crashsite" ? " (the crash site)" : ""}. Pick it up and bring it to their base.` };
}
const MAKERS = { horde: hordeJob, escort: escortJob, deliver: deliverJob, rescue: rescueJob, hive: hiveJob, scout: scoutJob, retrieve: retrieveJob };
const WEIGHT = { horde: 1.2, escort: 0.8, deliver: 1.4, rescue: 1.5, hive: 0.6, scout: 1, retrieve: 0.9 };

// Blueprint items, if the game has any (another part of the game adds them to GEAR).
export const blueprintKeys = () => Object.keys(GEAR).filter((k) => GEAR[k].blueprint || GEAR[k].kind === "blueprint" || k.startsWith("bp_"));
// Gear this group stocks that you cannot craft.
function rareGear(f) {
  const crafted = new Set(Object.keys(CRAFTS || {}).map((k) => (CRAFTS[k] && CRAFTS[k].gear) || k));
  const pool = { military: ["ar", "plate", "nvg", "milradio", "vest", "riothelmet"], traders: ["vest", "huntrifle", "shotgun", "waterfilter", "surgkit"], fortress: ["shotgun", "vest", "riothelmet", "huntrifle"],
    commune: ["huntrifle", "waterfilter", "surgkit"], raider: ["shotgun", "pistol", "vest"], expansionist: ["vest", "riothelmet", "shotgun"], zealot: ["shotgun", "surgkit"] }[f.type] || ["vest"];
  return pool.filter((k) => GEAR[k] && !crafted.has(k));
}

export function makeReward(state, f, type, size) {
  const rng = diploRng(state);
  const r = { goodwill: 6 + 4 * size, supplies: {}, gear: [], blueprint: null, recruits: 0, intel: false, outpost: null };
  const kinds = ["supplies", "supplies", "gear", "recruits", "intel"];
  if (blueprintKeys().length) kinds.push("blueprint", "blueprint");
  if (size >= 3 && f.bases.length >= 2) kinds.push("outpost");
  const n = size >= 2 ? 2 : 1;
  const picked = new Set();
  for (let i = 0; i < n * 3 && picked.size < n; i++) picked.add(rng.pick(kinds));
  if (type === "scout") picked.add("intel");
  for (const k of picked) {
    if (k === "supplies") {
      const m = marketOf(state, f);
      const list = m.surplus.length ? m.surplus : [{ key: "ammo" }];
      const key = rng.pick(list).key;
      r.supplies[key] = Math.max(1, Math.round((40 * size) / SUPPLIES[key].value));
    } else if (k === "gear") {
      const pool = rareGear(f);
      if (pool.length) r.gear.push(rng.pick(pool));
      else r.supplies.ammo = (r.supplies.ammo || 0) + 30 * size;
    } else if (k === "blueprint") r.blueprint = true; // which one is picked when it is paid (blueprints.js blueprintReward)
    else if (k === "recruits") r.recruits = size >= 2 ? rng.int(1, 2) : 1;
    else if (k === "intel") r.intel = true;
    else if (k === "outpost") r.outpost = f.bases[f.bases.length - 1];
  }
  return r;
}
export function rewardText(state, r) {
  const parts = [`+${r.goodwill} goodwill`];
  for (const [k, q] of Object.entries(r.supplies)) parts.push(`${q} ${k}`);
  for (const k of r.gear) parts.push(GEAR[k] ? GEAR[k].name : k);
  if (r.blueprint) parts.push("a manual or blueprint from their shelves");
  if (r.recruits) parts.push(r.recruits === 1 ? "a recruit" : `${r.recruits} recruits`);
  if (r.intel) parts.push("a map of their region and the hives and hordes near them");
  if (r.outpost != null) parts.push(`their outpost at ${tileLabel(state, r.outpost)}, with two of their people as staff`);
  return parts.join(", ");
}

// A new job from this group, or null when nothing fits. via: "radio" | "gate" | "council".
export function makeJob(state, f, via = "radio", onlyType = null) {
  const J = ensureJobs(state);
  const rng = diploRng(state);
  const opts = [];
  for (const [type, fn] of Object.entries(MAKERS)) {
    if (onlyType && type !== onlyType) continue;
    if (J.list.some((j) => j.fid === f.id && j.type === type && (j.status === "active" || j.status === "offered"))) continue;
    opts.push(type);
  }
  rng.shuffle(opts);
  opts.sort((a, b) => WEIGHT[b] - WEIGHT[a]);
  // Weighted order: try a weighted pick first, then the rest.
  const first = opts.length ? rng.weighted(opts, (t) => WEIGHT[t]) : null;
  const order = first ? [first, ...opts.filter((t) => t !== first)] : [];
  for (const type of order) {
    const spec = MAKERS[type](state, f);
    if (!spec) continue;
    const today = day(state);
    const job = {
      id: J.seq++, type, fid: f.id, via, status: "offered", offered: today, expires: today + JOBS.OFFER_DAYS, deadline: null, accepted: null,
      target: spec.target, size: spec.size, desc: spec.desc, data: spec.data, engaged: false, title: `${JOB_TYPES[type].name} for ${f.name}`,
      reward: makeReward(state, f, type, spec.size),
    };
    J.list.push(job);
    J.stats.offered++;
    J.lastOffer[f.id] = today;
    return job;
  }
  return null;
}

export function offerCard(state, job) {
  const f = factionById(state, job.fid);
  const how = job.via === "gate" ? `At the gates of ${f.name}, they ask your team for help.` : job.via === "council" ? "The coalition council asks this of you." : `${f.name} call you on the radio with a job.`;
  return {
    title: `Job offer: ${f.name}`, jobId: job.id,
    text: `${how} ${JOB_TYPES[job.type].icon} ${JOB_TYPES[job.type].name}: ${job.desc} Time: ${JOB_TYPES[job.type].days} days once accepted. Reward: ${rewardText(state, job.reward)}.`,
    choices: [
      { label: "Accept the job", hint: `It goes on your Jobs list (Groups tab) and on the map. Failing or missing the deadline costs ${job.size <= 1 ? JOBS.FAIL_GW_SMALL : JOBS.FAIL_GW} goodwill`,
        ai: (st) => (autoFeasible(st, job) ? 6 : -3), resolve: (st) => acceptJob(st, job.id) },
      { label: "Maybe later", hint: `It stays on the Jobs list until day ${job.expires}; left unanswered it costs ${JOBS.IGNORE_GW} goodwill`, ai: () => -0.5, resolve: () => `The offer from ${f.name} stays open until day ${job.expires}.` },
      { label: "Decline", hint: `−${JOBS.DECLINE_GW} goodwill`, ai: () => 0, resolve: (st) => declineJob(st, job.id) },
    ],
  };
}
function postOffer(state, job) {
  addCard(state, offerCard(state, job));
}

export function acceptProblem(state, job) {
  if (!job) return "That job is gone.";
  if (job.status !== "offered") return job.status === "active" ? "You already took this job." : "This offer is over.";
  const f = factionById(state, job.fid);
  if (!f || !f.alive) return "They are gone.";
  if (attitude(f) === "Hostile") return `${f.name} will not work with you now.`;
  if (activeJobs(state).length >= JOBS.MAX_ACTIVE) return `You already have ${JOBS.MAX_ACTIVE} jobs under way.`;
  return "";
}
export function acceptJob(state, id) {
  const job = jobById(state, id);
  const why = acceptProblem(state, job);
  if (why) return why;
  const f = factionById(state, job.fid);
  job.status = "active";
  job.accepted = state.hour;
  job.deadline = day(state) + JOB_TYPES[job.type].days;
  ensureJobs(state).stats.accepted++;
  f.lastDiplomacy = day(state);
  // A pick-up at a place you have not found (discovery.js): they show you where it is (via: not your own scouting).
  if (job.type === "retrieve" && job.data && job.data.site != null && !siteKnown(state, job.data.site)) state.knowledge[job.data.site] = { ...snapshot(state, job.data.site), via: "job" };
  log(state, `Job taken for ${f.name}: ${JOB_TYPES[job.type].name.toLowerCase()} (by day ${job.deadline}).`, "info");
  return `Job accepted: ${job.title}. Deadline day ${job.deadline}.`;
}
export function declineJob(state, id) {
  const job = jobById(state, id);
  if (!job || job.status !== "offered") return "That offer is over.";
  const f = factionById(state, job.fid);
  job.status = "declined";
  ensureJobs(state).stats.declined++;
  if (f && f.alive) changeGoodwill(state, f, -JOBS.DECLINE_GW, "you turned down their job");
  return `You turned down ${f ? f.name : "them"}.`;
}
// Give up a job you took: the same as failing it.
export function abandonJob(state, id) {
  const job = jobById(state, id);
  if (!job || job.status !== "active") return "That job is not under way.";
  failJob(state, job, "you gave it up");
  return `You gave up the job for ${factionById(state, job.fid)?.name || "them"}.`;
}

function failJob(state, job, why) {
  const f = factionById(state, job.fid);
  job.status = "failed";
  job.endDay = day(state);
  job.why = why;
  ensureJobs(state).stats.failed++;
  if (job.type === "rescue" && job.data.count && !job.data.freed) {
    // Lost for good (their war captives do not come home with the peace any more).
  }
  if (f && f.alive) changeGoodwill(state, f, -(job.size <= 1 ? JOBS.FAIL_GW_SMALL : JOBS.FAIL_GW), "a job not done");
  log(state, `Job failed for ${f ? f.name : "a group"}: ${JOB_TYPES[job.type].name.toLowerCase()} (${why}).`, "danger");
}
function voidJob(state, job, why) {
  job.status = "void";
  job.endDay = day(state);
  job.why = why;
  ensureJobs(state).stats.void++;
  const f = factionById(state, job.fid);
  if (job.type === "rescue" && job.data.count && !job.data.freed && f && f.alive && why !== "the war is over") f.pop += job.data.count;
  log(state, `Job called off${f ? ` for ${f.name}` : ""}: ${why}.`, "info");
}

// Done: the reward is paid (to the hub; gear to its armory, recruits as a card, an outpost as a new base).
export function completeJob(state, job, how = "") {
  const f = factionById(state, job.fid);
  job.status = "done";
  job.endDay = day(state);
  ensureJobs(state).stats.done++;
  const h = hub(state);
  const r = job.reward;
  const got = [];
  if (f && f.alive) {
    changeGoodwill(state, f, r.goodwill, "a job well done");
    f.lastDiplomacy = day(state);
    for (const [k, q] of Object.entries(r.supplies)) {
      const n = Math.max(0, Math.min(q, Math.floor(f.stock[k] || 0)));
      if (!n) continue;
      f.stock[k] -= n;
      h.stock[k] = (h.stock[k] || 0) + n;
      got.push(`${n} ${k}`);
    }
    const rng = diploRng(state);
    for (const k of r.gear) { const it = lootItem(k, traderSource(f.type), spend(rng)); h.armory.push(it); got.push(it.name); } // itemcond.js: as the group keeps its kit
    if (r.blueprint) {
      // blueprints.js: one you neither know nor hold, fitting the group; none left: ammo instead.
      const bp = blueprintReward(state, f, `job${job.id}`);
      if (bp) { h.armory.push(bp); got.push(bp.name); }
      else { h.stock.ammo = (h.stock.ammo || 0) + 40; got.push("40 ammo (they had no manual you lack)"); }
    }
    if (r.intel) { got.push(`a map (${intelFrom(state, f)} tiles)`); }
    if (r.outpost != null && f.bases.includes(r.outpost) && f.bases.length >= 2) {
      const b = handOver(state, f, r.outpost);
      if (b) got.push(`${b.name} (their outpost, now yours)`);
    }
    if (r.recruits) {
      const list = Array.from({ length: r.recruits }, () => makeCandidate(state, { quality: 0.95, minHealth: 60 }));
      offerRecruits(state, list, { source: "job", baseId: h.id, title: `${f.name} send people`, intro: `As thanks for the job, ${f.name} send ${list.length === 1 ? "one of their people who wants" : "two of their people who want"} to join you at ${h.name}.` });
      got.push(r.recruits === 1 ? "a recruit (a card)" : `${r.recruits} recruits (a card)`);
    }
  }
  log(state, `Job done for ${f ? f.name : "a group"}${how ? ` (${how})` : ""}: ${JOB_TYPES[job.type].name.toLowerCase()}. ${got.length ? `Reward: ${got.join(", ")}.` : ""}`, "good");
  return got;
}
function intelFrom(state, f) {
  const g = state.grid;
  const tiles = new Set();
  for (const b of f.bases) for (const id of g.within(b, 6)) tiles.add(id);
  for (const hd of state.hordes) if (f.bases.some((b) => g.distance(b, hd.tile) <= 15)) tiles.add(hd.tile);
  for (const hv of state.hives || []) if (f.bases.some((b) => g.distance(b, hv.tile) <= 15)) tiles.add(hv.tile);
  for (const id of tiles) { const cur = state.knowledge[id]; if (!cur || cur.hour <= state.hour) state.knowledge[id] = snapshot(state, id); }
  return tiles.size;
}
// One of their outposts becomes yours, with two of their people staying on as staff.
export function handOver(state, f, tile) {
  if (state.bases.some((b) => b.tile === tile) || state.tiles[tile].terrain === "water") return null;
  f.bases = f.bases.filter((x) => x !== tile);
  const base = {
    id: newId(), tile, type: "outpost", name: outpostName(state, tile),
    stock: { food: 20, water: 15, fuel: 0, meds: 2, ammo: 20, arrows: 0, parts: 0, scrap: 10, preserved: 0, jars: 0 }, // arrows: every base keeps the count (a base without it read undefined)
    radio: false, watchtower: false, buildings: [], construction: [], armory: [],
  };
  state.bases.push(base);
  askBaseName(state, base);
  for (let i = 0; i < 2; i++) {
    const s = makeSurvivor(state, 0.9);
    s.location = { kind: "base", baseId: base.id };
    s.role = "scavenge";
    state.survivors.push(s);
  }
  f.pop = Math.max(1, f.pop - 2);
  recomputeOwnership(state);
  log(state, `${f.name} handed their outpost at ${tileLabel(state, tile)} over to you: ${base.name}, with two of their people as staff.`, "good");
  return base;
}

// ---------- daily and hourly ----------
export function jobsDaily(state) {
  const J = ensureJobs(state);
  const today = day(state);
  for (const j of J.list) {
    const f = factionById(state, j.fid);
    if (j.status === "offered" && (today > j.expires || !f || !f.alive)) {
      j.status = "expired";
      J.stats.expired++;
      if (f && f.alive) changeGoodwill(state, f, -JOBS.IGNORE_GW, "you never answered their call");
      continue;
    }
    if (j.status !== "active") continue;
    if (!f || !f.alive) { voidJob(state, j, "the group is gone"); continue; }
    if (today > j.deadline) failJob(state, j, "the deadline passed");
  }
  // Old jobs leave the list after 20 days.
  J.list = J.list.filter((j) => j.status === "active" || j.status === "offered" || today - (j.endDay ?? j.expires ?? today) <= 20);
  // New offers over the radio.
  const rng = diploRng(state);
  for (const f of state.factions) {
    if (!f.alive || !f.known || attitude(f) === "Hostile" || !canRadioGroup(state, f)) continue;
    if (!canOffer(state, f, JOBS.OFFER_GAP)) continue;
    const chance = f.type === "traders" || f.type === "commune" ? JOBS.FRIENDLY_CHANCE : JOBS.RADIO_CHANCE;
    if (!rng.chance(chance)) continue;
    const job = makeJob(state, f, "radio");
    if (job) postOffer(state, job);
  }
}
function canOffer(state, f, gap) {
  const J = ensureJobs(state);
  if (J.list.some((j) => j.fid === f.id && j.status === "offered")) return false;
  if (J.list.filter((j) => j.fid === f.id && j.status === "active").length >= JOBS.PER_GROUP) return false;
  if (activeJobs(state).length >= JOBS.MAX_ACTIVE) return false;
  const last = J.lastOffer[f.id];
  return last == null || day(state) - last >= gap;
}

const yourTeams = (state) => state.parties.filter((p) => p.owner === "player" && p.kind === "expedition" && (p.members || []).length);
export function jobsHour(state) {
  const J = ensureJobs(state);
  const teams = yourTeams(state);
  // Work at the gates.
  for (const p of teams) {
    if (p.phase !== "waiting" && p.phase !== "engaged") continue;
    const tile = partyTile(p);
    const f = state.factions.find((x) => x.alive && x.bases.includes(tile));
    if (!f || attitude(f) === "Hostile") continue;
    if (J.lastGate[f.id] != null && day(state) - J.lastGate[f.id] < JOBS.GATE_GAP) continue;
    J.lastGate[f.id] = day(state);
    if (!canOffer(state, f, 0) || !diploRng(state).chance(JOBS.GATE_CHANCE)) continue;
    f.known = true;
    const job = makeJob(state, f, "gate");
    if (job) postOffer(state, job);
  }
  for (const j of J.list) if (j.status === "active") checkJob(state, j, teams);
}

const near = (state, teams, tile, r) => teams.filter((p) => partyMembers(state, p).length && state.grid.distance(partyTile(p), tile) <= r);

function checkJob(state, j, teams) {
  const f = factionById(state, j.fid);
  if (!f || !f.alive) return voidJob(state, j, "the group is gone");
  const d = j.data;
  switch (j.type) {
    case "horde": {
      const h = state.hordes.find((x) => x.id === d.hordeId);
      if (h) {
        j.target = h.tile;
        if (near(state, teams, h.tile, 1).length) j.engaged = true;
      }
      if (j.engaged && (!h || h.size <= d.size0 * 0.4)) return completeJob(state, j, h ? "the horde is broken" : "the horde is gone");
      if (!h && !j.engaged) return voidJob(state, j, "the horde moved off or merged before you got there");
      return;
    }
    case "hive": {
      const hv = (state.hives || []).find((x) => x.id === d.hiveId);
      if (hv && near(state, teams, hv.tile, 1).length) j.engaged = true;
      if (!hv) return j.engaged ? completeJob(state, j, "the hive is destroyed") : voidJob(state, j, "the hive is gone");
      return;
    }
    case "scout": {
      const g = state.grid, k = state.knowledge;
      const tiles = g.within(d.center, d.r);
      const seen = tiles.filter((id) => k[id] && k[id].hour >= j.accepted && !k[id].via).length;
      d.seen = seen;
      d.total = tiles.length;
      if (seen >= tiles.length * d.need) return completeJob(state, j, "the region is scouted");
      return;
    }
    case "deliver": {
      for (const p of teams) {
        if (!f.bases.includes(partyTile(p)) || d.left <= 0) continue;
        const n = Math.min(d.left, Math.floor(carried(p, d.key)));
        if (n <= 0) continue;
        takeSupply(p, d.key, n);
        f.stock[d.key] = (f.stock[d.key] || 0) + n;
        d.left -= n;
        log(state, `Your team handed ${n} ${d.key} to ${f.name}${d.left > 0 ? ` (${d.left} still to bring)` : ""}.`, "info");
      }
      if (d.left <= 0) return completeJob(state, j, "delivered");
      return;
    }
    case "retrieve": {
      const carrier = d.carrier != null ? state.parties.find((p) => p.id === d.carrier) : null;
      if (d.carrier != null && (!carrier || !partyMembers(state, carrier).length)) {
        d.carrier = null;
        // The team got home (its people are at a base now): the package is in your stores, for their caravan.
        const home = (d.carriers || []).map((id) => state.survivors.find((s) => s.id === id)).find((s) => s && s.alive && s.location.kind === "base");
        if (home) {
          d.atHub = true;
          j.target = f.bases[0];
          log(state, `${d.what[0].toUpperCase() + d.what.slice(1)} for ${f.name} is in your stores: ask them to fetch it (Jobs list).`, "info");
          return;
        }
        d.site = d.lastTile;
        j.target = d.site;
        log(state, `${d.what[0].toUpperCase() + d.what.slice(1)} for ${f.name} was left at ${tileLabel(state, d.site)}.`, "danger");
        return;
      }
      if (carrier) {
        const tile = partyTile(carrier);
        d.lastTile = tile;
        if (f.bases.includes(tile)) return completeJob(state, j, "delivered to their base");
        return;
      }
      if (d.atHub) return; // waiting in your stores for their caravan (requestPickup)
      const here = teams.find((p) => partyTile(p) === d.site);
      if (here) {
        d.carrier = here.id;
        d.carriers = [...here.members];
        d.lastTile = d.site;
        log(state, `Your team picked up ${d.what} for ${f.name} at ${tileLabel(state, d.site)}.`, "good");
      }
      return;
    }
    case "escort": return escortHour(state, j, f, teams);
    case "rescue": return rescueHour(state, j, f, teams);
  }
}

// ---------- escort ----------
function escortHour(state, j, f, teams) {
  const d = j.data;
  const to = factionById(state, d.to);
  if (d.stage === "waiting") {
    if (!to || !to.alive || !to.bases.length) return voidJob(state, j, "the caravan has nowhere to go any more");
    if (!near(state, teams, f.bases[0], 1).length) return;
    const p = spawnAiParty(state, f, "caravan", f.bases[0], to.bases[0], { strength: 3 * guardPower(f) });
    if (!p) return voidJob(state, j, "there is no road to them");
    const goods = { food: Math.min(Math.floor(available(f, "food") * 0.3), 30), scrap: Math.min(Math.floor(available(f, "scrap") * 0.3), 20) };
    p.goods = { supplies: {}, gear: [] };
    for (const [k, q] of Object.entries(goods)) if (q > 0) { f.stock[k] -= q; p.goods.supplies[k] = q; }
    Object.assign(p, { escortJob: j.id, home: f.bases[0], leaving: false, capacity: 120, toFaction: to.id });
    escortParty(state, f, p, p.goods); // caravans.js: their own guards too (escorts.js), besides your team
    d.stage = "moving";
    d.caravanId = p.id;
    log(state, `The ${f.name} caravan sets out for ${to.known ? to.name : tileLabel(state, to.bases[0])} with your team alongside.`, "info");
    return;
  }
  if (d.stage === "moving") {
    const c = state.parties.find((p) => p.id === d.caravanId);
    if (!c) return failJob(state, j, "the caravan was lost on the road");
    d.road++;
    if (near(state, teams, partyTile(c), 2).length) d.near++;
  }
}
// caravans.js caravanArrive: an escorted caravan reached the other group.
export function escortArrived(state, p) {
  const j = jobById(state, p.escortJob);
  const to = factionById(state, p.toFaction);
  if (to && to.alive) for (const [k, q] of Object.entries(p.goods.supplies)) to.stock[k] = (to.stock[k] || 0) + q;
  p.goods = { supplies: {}, gear: [] };
  if (!j || j.status !== "active") return;
  const d = j.data;
  d.stage = "arrived";
  if (d.road > 0 && d.near >= d.road * 0.5) completeJob(state, j, `your team was alongside ${Math.round((100 * d.near) / d.road)}% of the way`);
  else failJob(state, j, `the caravan arrived, but your team was alongside only ${Math.round((100 * d.near) / Math.max(1, d.road))}% of the way`);
}
// parties.js: raiders do not ambush a caravan with a team of yours within 2 tiles.
export function caravanGuarded(state, p) {
  if (p.escortJob == null) return false;
  return near(state, yourTeams(state), partyTile(p), 2).length > 0;
}

// ---------- deliver: their caravan fetches it ----------
export function pickupProblem(state, j) {
  if (!j || j.status !== "active") return "That job is not under way.";
  if (!(j.type === "deliver" || (j.type === "retrieve" && j.data.atHub))) return "Nothing for them to fetch.";
  const f = factionById(state, j.fid);
  if (!f || !f.alive) return "They are gone.";
  if (state.parties.some((p) => p.pickupJob === j.id)) return "Their caravan is already on the way.";
  const base = tradeBase(state, f);
  if (!base) return `${f.name} cannot reach any of your bases over land.`;
  if (j.type === "deliver" && Math.floor(base.stock[j.data.key] || 0) < j.data.left) return `${base.name} has ${Math.floor(base.stock[j.data.key] || 0)} of the ${j.data.left} ${j.data.key}: have it ready first.`;
  return "";
}
export function requestPickup(state, id) {
  const j = jobById(state, id);
  const why = pickupProblem(state, j);
  if (why) return why;
  const f = factionById(state, j.fid);
  const base = tradeBase(state, f);
  const c = sendCaravan(state, f, base, { goods: { supplies: {}, gear: [] } });
  if (!c) return `${f.name} cannot reach ${base.name}.`;
  c.pickupJob = j.id;
  return `${f.name} send people to ${base.name} to fetch it (about ${c.eta}h).`;
}
// caravans.js caravanArrive: their caravan at your base to fetch a job's goods. true when handled.
export function pickupArrived(state, p, base) {
  const j = jobById(state, p.pickupJob);
  const f = factionById(state, p.owner);
  if (!j || j.status !== "active" || !f) return false;
  if (j.type === "retrieve" && j.data.atHub) { completeJob(state, j, "they fetched it"); return true; }
  if (j.type !== "deliver") return false;
  const n = Math.min(j.data.left, Math.floor(supplyAmt(base.stock, j.data.key)));
  if (n > 0) {
    useSupply(base.stock, j.data.key, n); // rounds.js: "ammo" as any rounds
    p.goods.supplies[j.data.key] = (p.goods.supplies[j.data.key] || 0) + n;
    j.data.left -= n;
  }
  if (j.data.left <= 0) completeJob(state, j, `they fetched it from ${base.name}`);
  else log(state, `The ${f.name} caravan took ${n} ${j.data.key} from ${base.name}: ${j.data.left} still owed.`, "info");
  return true;
}

// ---------- rescue ----------
function rescueHour(state, j, f, teams) {
  const d = j.data;
  const holder = factionById(state, d.holder);
  if (d.warId != null && !warById(state, d.warId)) return voidJob(state, j, "the war is over and their people came home");
  if (!holder || !holder.alive) { f.pop += d.count; d.freed = true; return completeJob(state, j, "their captors are gone"); }
  for (const p of teams) {
    if (p.phase !== "waiting" || !holder.bases.includes(partyTile(p))) continue;
    if (state.cards.some((c) => c.rescueJob === j.id)) continue;
    if (p.rescueAsked === j.id && state.hour - (p.rescueAskedAt || 0) < 24) continue;
    p.rescueAsked = j.id;
    p.rescueAskedAt = state.hour;
    addCard(state, rescueCard(state, j, p, f, holder));
  }
}
function rescueCard(state, j, p, f, holder) {
  const members = partyMembers(state, p);
  const g = guardsFor(state, p, holder);
  const guards = { ...g, count: Math.max(2, Math.round(g.count * 0.6)) };
  const speech = Math.max(0, ...members.map((s) => skill(s, "speech")));
  const talk = clamp(0.25 + speech * 0.04 + holder.goodwill / 200, 0.05, 0.85);
  const price = 40 * j.data.count;
  const payKey = ["ammo", "food", "meds"].find((k) => carried(p, k) * SUPPLIES[k].value >= price);
  const payQty = payKey ? Math.ceil(price / SUPPLIES[payKey].value) : 0;
  const hostile = attitude(holder) === "Hostile";
  const gone = (st) => j.status !== "active" || !st.parties.includes(p);
  const free = (st, how) => { f.pop += j.data.count; j.data.freed = true; completeJob(st, j, how); awaitOrders(st, p, `${plural(j.data.count, "of their people")} freed for ${f.name}.`); return `${plural(j.data.count, "of their people")} are free and on their way home to ${f.name}.`; };
  return {
    title: `Held at ${holder.known ? holder.name : tileLabel(state, partyTile(p))}`, partyId: p.id, rescueJob: j.id, where: tileLabel(state, partyTile(p)),
    text: `${plural(j.data.count, "of " + f.name + "'s people")} are held here. ${guards.count} guards stand between your team and them.`,
    choices: [
      { label: "Storm the place (battle)", fight: { enemy: guards, ambush: "player" }, hint: `About ${guards.count} guards (power ${guards.power}). ${holder.name} turns against you (−15 goodwill)`,
        ai: (st) => (members.reduce((a, s) => a + combatPower(s), 0) >= guards.count * guards.power * 1.3 ? 3 : -2),
        resolve: (st) => {
          if (gone(st)) return "Too late.";
          startCombat(st, { tile: partyTile(p), partyId: p.id, enemy: guards, ambush: "player", canRetreat: true, handler: "jobRescue", context: { jobId: j.id, partyId: p.id, holder: holder.id } });
          return "";
        } },
      { label: `Talk them into letting go (${Math.round(talk * 100)}%)`, hint: hostile ? `${holder.name} will not talk to you` : "Speech of your best talker here and their goodwill toward you", disabled: hostile,
        ai: () => (hostile ? -9 : talk * 6), resolve: (st) => {
          if (gone(st)) return "Too late.";
          const best = [...members].sort((a, b) => skill(b, "speech") - skill(a, "speech") || a.id - b.id)[0];
          if (best) gainXp(st, best, "speech", USE.radio || 2);
          if (st.rng.chance(talk)) { changeGoodwill(st, holder, -2, "you talked their captives away"); return free(st, "talked out"); }
          awaitOrders(st, p, `${holder.name} would not listen.`);
          return `${holder.name} would not listen.`;
        } },
      { label: payKey ? `Pay ${payQty} ${payKey}` : "Pay (not enough carried)", hint: `40 a head, from what the team carries`, disabled: !payKey,
        ai: () => (payKey ? 2 : -9), resolve: (st) => {
          if (gone(st) || !payKey || carried(p, payKey) < payQty) return "The team cannot pay that now.";
          takeSupply(p, payKey, payQty);
          holder.stock[payKey] = (holder.stock[payKey] || 0) + payQty;
          return free(st, "ransom paid");
        } },
      { label: "Leave it for now", ai: () => 0, resolve: (st) => { awaitOrders(st, p, "The team pulled back."); return "The team pulls back."; } },
    ],
  };
}
registerCombatHandler("jobRescue", (state, result, setup) => {
  const c = setup.context;
  const j = jobById(state, c.jobId);
  const p = state.parties.find((x) => x.id === c.partyId);
  const holder = factionById(state, c.holder);
  if (holder) {
    holder.pop = Math.max(1, holder.pop - Math.ceil((result.enemiesKilled || 0) * 0.7));
    changeGoodwill(state, holder, -15, "you stormed their base");
  }
  let text;
  if (result.outcome === "victory" && j && j.status === "active") {
    const f = factionById(state, j.fid);
    if (f && f.alive) f.pop += j.data.count;
    j.data.freed = true;
    completeJob(state, j, "stormed and freed");
    text = `The guards are beaten: ${plural(j.data.count, "captive")} freed.`;
  } else text = "The guards held. The captives are still there.";
  if (p && state.parties.includes(p) && partyMembers(state, p).length) awaitOrders(state, p, text);
});

// ---------- the AI governor (autopilot.js) ----------
const RESERVE_HEAD = { food: 6, water: 5, meds: 3, ammo: 10, fuel: 8, parts: 2, scrap: 20 };
export function hubSpareFor(state, key) {
  const h = hub(state);
  const n = Math.max(1, atBase(state, h.id).length);
  return Math.max(0, Math.floor(supplyAmt(h.stock, key) - (key === "meds" || key === "fuel" || key === "parts" || key === "scrap" ? RESERVE_HEAD[key] : n * (RESERVE_HEAD[key] || 0))));
}
// Can the governor do this job? Deliveries it can pay from the hub's spare stock; scouting and fetching within 12
// tiles of the hub with 4+ people at home; Aggressive takes a small horde with 6+ people. Nothing else.
export function autoFeasible(state, job) {
  const h = hub(state);
  if (!h || !job) return false;
  const f = factionById(state, job.fid);
  if (!f || !f.alive) return false;
  const home = atBase(state, h.id).length;
  const style = state.governor ? state.governor.personality : "balanced";
  const dist = state.grid.distance(h.tile, job.target);
  if (job.type === "deliver") return hubSpareFor(state, job.data.key) >= job.data.qty && !!tradeBase(state, f);
  if (job.type === "scout" || job.type === "retrieve") return dist <= 12 && home >= 4 && !(state.hives || []).some((hv) => state.grid.distance(hv.tile, job.target) <= 4);
  if (job.type === "horde") return style === "aggressive" && home >= 6 && hordeScore(job.data.size0) <= 8 && dist <= 12;
  return false;
}
// Daily: deliveries are fetched by their caravan once the hub has them; a package at the hub likewise.
export function autoJobsDaily(state) {
  const out = [];
  for (const j of activeJobs(state)) {
    if (j.type === "deliver" || (j.type === "retrieve" && j.data.atHub)) {
      if (state.parties.some((p) => p.pickupJob === j.id)) continue;
      if (j.type === "deliver" && hubSpareFor(state, j.data.key) < j.data.left) continue;
      if (!pickupProblem(state, j)) out.push(requestPickup(state, j.id));
    }
  }
  return out.join(" ");
}
// Trip candidates for the governor's planTrip (autopilot.js): scouting, fetching a package, culling a horde.
export function jobTripCands(state) {
  const out = [];
  for (const j of activeJobs(state)) {
    const tile = j.type === "scout" ? j.data.center : j.type === "retrieve" ? j.data.site : j.target;
    if (state.parties.some((p) => p.owner === "player" && (p.dest === tile || (p.ap && p.ap.tile === tile)))) continue;
    const f = factionById(state, j.fid);
    if (!f) continue;
    if (j.type === "scout") out.push({ mission: "recon", tile: j.data.center, score: 3, crew: 2, why: `scout for ${f.name} (a job)`, jobId: j.id });
    if (j.type === "retrieve" && j.data.carrier == null && !j.data.atHub) out.push({ mission: "recon", tile: j.data.site, score: 3, crew: 2, why: `fetch ${j.data.what} for ${f.name} (a job)`, jobId: j.id });
    if (j.type === "horde" && state.governor && state.governor.personality === "aggressive") {
      const h = state.hordes.find((x) => x.id === j.data.hordeId);
      if (h) out.push({ mission: "cull", tile: h.tile, score: 3.2, crew: 3, why: `cull the horde for ${f.name} (a job)`, jobId: j.id, supplies: { ammo: 40 } });
    }
  }
  return out;
}
