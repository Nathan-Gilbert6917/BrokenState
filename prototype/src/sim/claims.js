// Land claims and the wells dug on them (docs/coalition-war-plan.md, "Claims" and "Wells on claimed tiles").
//
// Claims
// - A team on a land tile can claim it (the order "Claim this tile": CLAIM.HOURS (2) hours on the spot and
//   CLAIM.SCRAP (3) scrap for the marker post). The tile must border land you hold: one of your bases, the ground
//   right around one (tile.owner "player", factions.js recomputeOwnership) or another claim of yours; it cannot be
//   water, a base, a hive or the ground a group's base holds.
// - A claim counts as land the coalition holds (alliance.js controlledLand), toward the 50% the victory needs.
// - A claim is lost when a group founds or takes a base there (within 2 tiles: the hook in factions.js and the daily
//   sweep over tile.owner), a hive rises there (hives.js completeSite), or a hostile team or band stands on it at
//   the day tick (claimsDaily: an AI group's party whose group is hostile, raiders from outside, a hardcore band).
//   A group's base founded on your claims takes them for that group (owner = its id); a hive or a camp just wipes it.
// - state.claims = { [tileId]: { owner: "player" | <faction id>, since: <hour>, well?: { yield, left, dug } } },
//   plain data (save.js needs nothing special; older saves have none and get an empty table on demand).
//
// Wells
// - "Dig a well" (CLAIM.WELL_HOURS (24) hours, CLAIM.WELL_SCRAP (15) scrap, CLAIM.WELL_PARTS (1) part carried) on a
//   claim of yours next to one of your bases. The yield a day by the ground: beside a river or lake 10, farmland
//   (plains) 6, forest 4, hills 2, suburbs / city 2, mountains 0 (cannot dig). `left` starts at 1500–4000 (the dice
//   and the ground) and falls by what is drawn; under WELL_LOW (20%) the yield halves; at 0 the well is dry (a log line).
// - economy.js waterProduction adds the wells on the claims next to a base as `hauled`: somebody at the base hauls
//   it, so at most one well per CLAIM.WELL_PER_PEOPLE (4) people at the base counts, the best wells first.
import { day, log, hub, atBase } from "./world.js";
import { TERRAIN } from "./data.js";
import { attitude, changeGoodwill as changeGoodwillLazy } from "./factions.js";
import { changeRelation } from "./diplomacy.js"; // a group's claims taken by another group's base (overwriteClaims)
import { tileLabel, partyTile, carried, takeSupply } from "./parties.js";
import * as Weather from "./weather.js";

// Hardcore bands on the road (hardcore-groups.js bandsOf, read here without the import: orders.js loads this module early).
const bandsOf = (state) => (state.hardcore && state.hardcore.groups ? state.hardcore.groups.bands : []);

// TAKEN: what a claim taken from a group costs with it, a tile (goodwill toward you when your Occupy order takes it,
// occupy.js; relations between two groups when one's base takes the other's, overwriteClaims).
export const CLAIM = { HOURS: 2, SCRAP: 3, WELL_HOURS: 24, WELL_SCRAP: 15, WELL_PARTS: 1, WELL_LOW: 0.2, WELL_PER_PEOPLE: 4, BASE_RADIUS: 2, HIVE_RADIUS: 2, TAKEN: -2 };
// Well yield a day by terrain; beside water (a river or lake next to the tile) WELL_SHORE instead.
export const WELL_YIELD = { plains: 6, forest: 4, hills: 2, suburb: 2, city: 2, mountain: 0, water: 0 };
export const WELL_SHORE = 10;
export const WELL_LEFT = { min: 1500, max: 2500, perYield: 150 }; // left = min..max + perYield × yield: 1500–4000

export function ensureClaims(state) {
  if (!state.claims) state.claims = {};
  return state.claims;
}
const claimAt = (state, tile) => (state.claims ? state.claims[tile] : null) || null;
// Who claims a tile: "player", a group's id, or null.
export const claimOwner = (state, tile) => { const c = claimAt(state, tile); return c ? c.owner : null; };
// Land you hold: one of your base tiles, the ground right around one (recomputeOwnership) or a claim of yours.
export function ownsTile(state, tile) {
  const t = state.tiles[tile];
  if (!t) return false;
  if (state.bases.some((b) => b.tile === tile)) return true;
  if (claimOwner(state, tile) === "player") return true;
  return t.owner === "player";
}
const groupBaseAt = (state, tile) => state.factions.find((f) => f.alive && f.bases.includes(tile)) || null;
// Why this tile cannot be claimed now ("" = it can).
export function canClaim(state, tile) {
  const t = state.tiles[tile];
  if (!t) return "No such tile.";
  if (t.terrain === "water") return "Open water cannot be claimed.";
  if (state.bases.some((b) => b.tile === tile)) return "That is your base already.";
  const fb = groupBaseAt(state, tile);
  if (fb) return `${fb.known ? fb.name : "A group"} has a base there.`;
  if (t.hive) return "A hive stands there.";
  if (typeof t.owner === "number") { const f = state.factions.find((x) => x.id === t.owner); return `That ground is held by ${f && f.known ? f.name : "a group"}'s base.`; }
  if (claimOwner(state, tile) === "player") return "You claim this tile already.";
  if (!state.grid.neighbors(tile).some((id) => ownsTile(state, id))) return "A claim must border land you hold: a base, the ground around it or another claim.";
  return "";
}
// The claim itself: by a team on the tile (its carried scrap pays), or with no team (the hub's scrap). Returns the
// log line, or why not.
export function claimTile(state, p, tile) {
  const why = canClaim(state, tile);
  if (why) return why;
  const have = p ? carried(p, "scrap") : (hub(state) ? hub(state).stock.scrap || 0 : 0);
  if (have < CLAIM.SCRAP) return `Claiming needs ${CLAIM.SCRAP} scrap for the marker post (have ${Math.floor(have)}).`;
  if (p) takeSupply(p, "scrap", CLAIM.SCRAP); else hub(state).stock.scrap -= CLAIM.SCRAP;
  const C = ensureClaims(state);
  const was = C[tile];
  C[tile] = { owner: "player", since: state.hour, ...(was && was.well ? { well: was.well } : {}) };
  const text = `${tileLabel(state, tile)} claimed for the holdout${was && was.owner !== "player" ? " (another group's post torn down)" : ""}: a marker post goes up (${CLAIM.SCRAP} scrap). ${claimedLand(state)} tile${claimedLand(state) === 1 ? "" : "s"} claimed.`;
  log(state, text, "good");
  return text;
}
export function releaseClaim(state, tile, why = "") {
  const c = claimAt(state, tile);
  if (!c) return false;
  delete state.claims[tile];
  if (c.owner === "player") log(state, `Your claim at ${tileLabel(state, tile)} is lost${c.well ? ", and the well with it" : ""}${why ? `: ${why}` : "."}`, "danger");
  return true;
}
// Every claim within `radius` of a tile goes to newOwner (a group's id), or is wiped (newOwner null). Returns how
// many of yours were taken. why: for the log line. Another group's claims taken by a group: their relations fall
// CLAIM.TAKEN a tile (AI parity: your Occupy order taking a group's claims costs goodwill with it the same way, occupy.js).
export function overwriteClaims(state, tile, radius, newOwner, why = "") {
  if (!state.claims) return 0;
  let taken = 0;
  const lost = [];
  const by = typeof newOwner === "number" ? state.factions.find((f) => f.id === newOwner) : null;
  for (const id of state.grid.within(tile, radius)) {
    const c = state.claims[id];
    if (!c || c.owner === newOwner) continue;
    if (c.owner === "player") { taken++; lost.push(id); }
    else if (by && typeof c.owner === "number") { const o = state.factions.find((f) => f.id === c.owner && f.alive); if (o) changeRelation(state, by, o, CLAIM.TAKEN); }
    if (newOwner == null) delete state.claims[id];
    else state.claims[id] = { owner: newOwner, since: state.hour, ...(c.well ? { well: c.well } : {}) };
  }
  if (lost.length) log(state, `${lost.length === 1 ? `Your claim at ${tileLabel(state, lost[0])} is` : `${lost.length} of your claims near ${tileLabel(state, tile)} are`} lost${why ? `: ${why}` : "."}`, "danger");
  return taken;
}
// A new base of yours (Build outpost, parties.js; Occupy, occupy.js) takes every group's claim within
// CLAIM.BASE_RADIUS tiles, as a group's new base takes yours and any other group's (factions.js expansion:
// overwriteClaims with the same radius). claimsTaken: what it would take, by group ([{ f, n, gw }]: gw the goodwill it
// costs with that group, CLAIM.TAKEN a tile). takeGroupClaims: takes them, and the goodwill falls ("your expansion near
// their land": a growth grievance, playerwars.js). Returns the list.
export function claimsTaken(state, tile) {
  const by = new Map();
  if (state.claims) for (const id of state.grid.within(tile, CLAIM.BASE_RADIUS)) {
    const c = state.claims[id];
    if (!c || typeof c.owner !== "number") continue;
    const f = state.factions.find((o) => o.id === c.owner && o.alive);
    if (f) by.set(f, (by.get(f) || 0) + 1);
  }
  return [...by].map(([f, n]) => ({ f, n, gw: CLAIM.TAKEN * n }));
}
export function takeGroupClaims(state, tile) {
  const list = claimsTaken(state, tile);
  if (state.claims) for (const id of state.grid.within(tile, CLAIM.BASE_RADIUS)) {
    const c = state.claims[id];
    if (c && typeof c.owner === "number") state.claims[id] = { owner: "player", since: state.hour, ...(c.well ? { well: c.well } : {}) };
  }
  for (const x of list) changeGoodwillLazy(state, x.f, x.gw, "your expansion near their land: you took their claims");
  return list;
}
// "Long Haul Co. (2 claims: goodwill -4)" for the planner and the orders card.
export const claimsTakenText = (list) => list.map((x) => `${x.f.known ? x.f.name : "a group"} (${x.n} claim${x.n === 1 ? "" : "s"}: goodwill ${x.gw})`).join(", ");
export const playerClaims = (state) => (state.claims ? Object.keys(state.claims).filter((k) => state.claims[k].owner === "player").map(Number) : []);
export const claimedLand = (state) => playerClaims(state).filter((id) => state.tiles[id] && state.tiles[id].terrain !== "water").length;

// ---------- wells ----------
export const besideWater = (state, tile) => state.grid.neighbors(tile).some((id) => state.tiles[id] && state.tiles[id].terrain === "water");
// Water a day a new well here would give (0: cannot dig).
export function wellYield(state, tile) {
  const t = state.tiles[tile];
  if (!t || t.terrain === "water") return 0;
  if (t.terrain === "mountain") return 0;
  return besideWater(state, tile) ? WELL_SHORE : WELL_YIELD[t.terrain] ?? 0;
}
export const wellAt = (state, tile) => { const c = claimAt(state, tile); return c && c.well ? c.well : null; };
// Your bases next to a tile (distance 1): the people who would haul from a well there.
const basesBeside = (state, tile) => state.bases.filter((b) => state.grid.distance(b.tile, tile) <= 1);
// Why a well cannot be dug here by this team ("" = it can). p null: the materials are not checked.
export function wellProblem(state, p, tile) {
  const t = state.tiles[tile];
  if (!t || t.terrain === "water") return "Not on the water.";
  if (claimOwner(state, tile) !== "player") return "Only on a tile you claim (Claim this tile first).";
  if (wellAt(state, tile)) return "There is a well here already.";
  if (!wellYield(state, tile)) return `${TERRAIN[t.terrain].name}: solid rock, no water to dig for.`;
  if (!basesBeside(state, tile).length) return "A well must stand next to one of your bases: its people haul the water.";
  if (p) {
    const s = carried(p, "scrap"), pa = carried(p, "parts");
    if (s < CLAIM.WELL_SCRAP || pa < CLAIM.WELL_PARTS) return `Needs ${CLAIM.WELL_SCRAP} scrap and ${CLAIM.WELL_PARTS} part carried (have ${Math.floor(s)} scrap, ${Math.floor(pa)} part${Math.floor(pa) === 1 ? "" : "s"}).`;
  }
  return "";
}
// The team has dug: the well goes on the claim. Returns the log line, or why not.
export function digWell(state, p, tile) {
  const why = wellProblem(state, p, tile);
  if (why) return why;
  if (p) { takeSupply(p, "scrap", CLAIM.WELL_SCRAP); takeSupply(p, "parts", CLAIM.WELL_PARTS); }
  const y = wellYield(state, tile);
  const left = state.rng.int(WELL_LEFT.min, WELL_LEFT.max) + WELL_LEFT.perYield * y;
  state.claims[tile].well = { yield: y, left, start: left, dug: state.hour };
  const b = basesBeside(state, tile)[0];
  const text = `A well dug at ${tileLabel(state, tile)}: about ${y} water a day, hauled to ${b.name} (${CLAIM.WELL_SCRAP} scrap, ${CLAIM.WELL_PARTS} part).`;
  log(state, text, "good");
  return text;
}
// What a well gives today: its yield, halved under WELL_LOW left, a dry spell's share (weather.js wellFactor), 0 when dry.
export function wellRate(state, w) {
  if (!w || w.left <= 0) return 0;
  const factor = Weather.wellFactor ? Weather.wellFactor(state) : 1;
  const low = w.left < wellStart(w) * CLAIM.WELL_LOW;
  return Math.round(w.yield * (low ? 0.5 : 1) * factor * 10) / 10;
}
// What the well held when it was dug (`start`; a well without it: the middle of its band).
export const wellStart = (w) => w.start ?? (WELL_LEFT.min + WELL_LEFT.max) / 2 + WELL_LEFT.perYield * w.yield;
// The wells a base hauls from: on your claims next to it, at most one per WELL_PER_PEOPLE people at the base, the
// best first. { total, wells: [{ tile, well, rate, counted }] }.
export function hauledWells(state, base) {
  const out = [];
  for (const id of state.grid.neighbors(base.tile)) {
    const w = wellAt(state, id);
    if (!w || claimOwner(state, id) !== "player") continue;
    out.push({ tile: id, well: w, rate: wellRate(state, w), counted: false });
  }
  out.sort((a, b) => b.rate - a.rate || a.tile - b.tile);
  const cap = Math.floor(atBase(state, base.id).length / CLAIM.WELL_PER_PEOPLE);
  let total = 0;
  for (let i = 0; i < out.length; i++) if (i < cap) { out[i].counted = true; total += out[i].rate; }
  return { total: Math.round(total * 10) / 10, wells: out, cap };
}
// Daily (economy.js baseDaily): the wells drawn from today lose what was hauled; one that runs out is dry.
export function drawWells(state, base) {
  for (const o of hauledWells(state, base).wells) {
    if (!o.counted || o.rate <= 0) continue;
    o.well.left = Math.max(0, Math.round((o.well.left - o.rate) * 10) / 10);
    if (o.well.left <= 0 && !o.well.dry) { o.well.dry = true; log(state, `The well at ${tileLabel(state, o.tile)} has run dry.`, "danger"); }
  }
}

// ---------- daily ----------
// A hostile party standing on a tile: an AI group's party whose group is hostile, raiders from outside
// (visitors.js), a hardcore band (hardcore-groups.js). Returns the group's id, or true for the rest, or null.
export function hostileOn(state, tile) {
  for (const p of state.parties) {
    if (p.owner === "player" || partyTile(p) !== tile) continue;
    if (p.owner === "outsider") return true;
    const f = typeof p.owner === "number" ? state.factions.find((x) => x.id === p.owner) : null;
    if (f && f.alive && attitude(f) === "Hostile") return f.id;
  }
  for (const v of state.visitors || []) if (v.kind === "raiders" && v.tile === tile) return true;
  for (const b of bandsOf(state)) if (b.tile === tile) return true;
  return null;
}
// Once a day (world.js, after recomputeOwnership): claims under a base founded or taken, under a hive, or with a
// hostile team or band camped on them are lost.
export function claimsDaily(state) {
  if (!state.claims) return;
  for (const k of Object.keys(state.claims)) {
    const id = Number(k), c = state.claims[k], t = state.tiles[id];
    if (!c || !t) { delete state.claims[k]; continue; }
    if (state.bases.some((b) => b.tile === id)) { delete state.claims[k]; continue; } // your base stands here now: the post is moot
    const fb = groupBaseAt(state, id);
    if (fb) { overwriteClaims(state, id, 0, fb.id, `${fb.known ? fb.name : "a group"} holds a base there`); continue; }
    if (t.hive) { overwriteClaims(state, id, 0, null, "a hive stands there"); continue; }
    if (typeof t.owner === "number" && c.owner !== t.owner) { const f = state.factions.find((x) => x.id === t.owner); overwriteClaims(state, id, 0, t.owner, `${f && f.known ? f.name : "a group"}'s base holds that ground now`); continue; }
    if (c.owner !== "player") continue;
    const h = hostileOn(state, id);
    if (h != null) overwriteClaims(state, id, 0, typeof h === "number" ? h : null, "a hostile band camped on it");
  }
}
// For the panels: "Claimed by you (day N)" and the well's line.
export function claimText(state, tile) {
  const c = claimAt(state, tile);
  if (!c) return null;
  const f = c.owner === "player" ? null : state.factions.find((x) => x.id === c.owner);
  const who = c.owner === "player" ? "you" : f && f.known ? f.name : "another group";
  return `Claimed by ${who} (day ${Math.floor(c.since / 24) + 1})`;
}
export function wellText(state, tile) {
  const w = wellAt(state, tile);
  if (!w) return null;
  return w.left <= 0 ? "Well: dry" : `Well: ${wellRate(state, w)} a day, ${Math.round(w.left)} left`;
}
