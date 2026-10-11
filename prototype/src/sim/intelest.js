// Estimates of what you cannot see: another group's base (selected on the State Map) and their parties on the road,
// worked out from what your people have learned (intelnotes.js state.intelLedger) and nothing else. Pure functions of
// the state: they never change it and never draw on state.rng (the ranges are placed by the world's dice, hash01, so
// they hold still between frames).
//
// A base (baseIntel):
// - Sources. A look from outside (sight: one of your bases or a team saw it, out of radio range brought home with the
//   report), a Survey team or a Look around close by (survey: sharper with binoculars or a spotting scope, rougher at
//   night without night optics), a trade team at their gates (visit: the stores too), your ally telling you (ally: an
//   alliance member, a pact or Allied goodwill: as good as a visit, today), a prisoner of theirs questioned
//   (prisoners.js f.intel: their numbers and stores on that day), their radio channel (radiolisten.js: what their
//   stores are short of or full of, a war party's strength), a fight with them or friends telling you what they carry
//   (arsenal.js arsenalKnown). The base in view right now counts as a fresh look from outside.
// - Each look has an error (intelnotes.js LOOK_ERR: sight 30%, survey 20%, visit 12%, ally 10%) that grows by
//   INTEL.STALE a day since (people come and go, walls go up): a count is shown as a range around what was seen, never
//   the number itself, and the range holds what was there when they looked. Each field takes the best source that
//   shows it: walls, fields and wells show from outside; quarters, a workshop and a storehouse from close by; a jail
//   and the stores only from inside (a visit, an ally) or a prisoner; vehicles parked at the main base from outside.
// - Nothing learned of a thing: it is null ("unknown" on the map). A base whose holder changed keeps none of the old
//   holder's looks.
// A party on the road (partyIntel): only while in view (state.live: base vision, teams in radio contact, by night as
//   far as they see); its size as a range (wider at night), its vehicle, the way it is heading, and where it is going
//   only if you heard it on their channel or your lookouts called it.
import { foodIn } from "./foods.js"; // days of food, every kind
import { day, isNight, factionById, localId } from "./world.js";
import { hash01 } from "./skills.js";
import { partyTile, tileLabel } from "./parties.js";
import { attitude } from "./factions.js";
import { isMember } from "./alliance.js";
import { wallGoal, GROUP_WORKS } from "./groupworks.js";
import { arsenalKnown, arsenalText } from "./arsenal.js";
import { raidForce } from "./conflicts.js";
import { guardPower } from "./caravans.js";
import { ledger, baseLook } from "./intelnotes.js";
import { intelMult } from "./traits.js"; // Strategic: sharper estimates while one of yours is at a base

export const INTEL = {
  STALE: 0.03, MAX_ERR: 1.2, ALLY_ERR: 0.1, CAPTIVE_ERR: 0.15, WALL_SPAN: 4,
  ARMS_DAYS: 10, STORES_DAYS: 12, FORCE_DAYS: 8, PARTY_ERR: 0.25, PARTY_NIGHT: 0.5,
  CONF: [[0.15, "high"], [0.3, "good"], [0.55, "fair"], [Infinity, "poor"]],
};
const SRC_LABEL = { sight: "seen from outside", survey: "a close look (survey)", visit: "a trade visit", ally: "they tell you (allies)", captive: "a prisoner of theirs", radio: "their radio channel" };
// What each kind of look can make out (walls, fields and wells from outside; the rest closer).
const SEES = {
  sight: ["walls", "water", "farms"],
  survey: ["walls", "water", "farms", "beds", "bench", "store"],
  visit: ["walls", "water", "farms", "beds", "bench", "store", "jail"],
  ally: ["walls", "water", "farms", "beds", "bench", "store", "jail"],
};
const WORK_NAME = { water: ["a well", "wells"], farms: ["a field", "fields"], beds: ["quarters", "quarters"], bench: ["a workshop", "workshops"], store: ["a storehouse", "storehouses"] };
const ARMS_WORDS = ["Poorly armed", "Lightly armed", "Armed", "Well armed", "Heavily armed"];

const hoursAgo = (state, h) => Math.max(0, state.hour - h);
const ageDays = (state, h) => hoursAgo(state, h) / 24;
// The error of a look by now (× a Strategic planner at one of your bases: traits.js intelMult, 1 without).
export const staleErr = (state, err, hour) => Math.min(INTEL.MAX_ERR, (err + INTEL.STALE * ageDays(state, hour)) * intelMult(state));
// A count as a range around what was seen: the middle moved by up to half the error (the world's dice), the range
// ± the error around it, so what was there lies inside it and is never shown on its own.
export function rangeOf(state, v, err, salt, min = 0) {
  if (v == null || !Number.isFinite(v)) return null;
  const j = (hash01(state.seed, "intel", ...salt) - 0.5) * err;
  const c = v * (1 + j);
  const lo = Math.max(min, Math.floor(c * (1 - err)));
  let hi = Math.max(lo, Math.ceil(c * (1 + err)));
  if (hi <= lo) hi = lo + 1;
  return { lo, hi };
}
export const rangeText = (r) => (!r ? "unknown" : r.lo === r.hi ? `${r.lo}` : `${r.lo}–${r.hi}`);
const confWord = (err) => (err == null ? "none" : INTEL.CONF.find(([k]) => err < k)[1]);
const word = (v, cuts, words = ["low", "some", "plenty"]) => (v < cuts[0] ? words[0] : v < cuts[1] ? words[1] : words[2]);
// Stores a head, in words (a group eats about 1 food a person a day).
function storeWords(stock, pop) {
  const p = Math.max(1, pop || 1);
  return [["food", word(foodIn(stock) / p, [4, 12])], ["ammo", word((stock.ammo || 0) / p, [5, 20])], ["meds", word((stock.meds || 0) / p, [0.5, 2])], ["fuel", word((stock.fuel || 0) / p, [2, 10])]];
}
// The relationship that makes them tell you what they have.
export const shares = (state, f) => !!f && f.alive && (isMember(state, f) || !!f.pact || attitude(f) === "Allied");

// The group holding the base on this tile (alive), or null.
export const baseHolder = (state, tile) => (state.factions || []).find((f) => f.alive && f.bases.includes(tile)) || null;

// Everything your people know of the group's base on this tile. live: the tiles in view (the map passes its own,
// for the dev Reveal). Returns null when no group holds the tile, else:
// { tile, fid, name, known, attitude, ally, sources: [{ src, label, day, ago }], lastSeen: { hour, ago, src } | null,
//   confidence, pop, gpop, walls: { lo, hi, goal } | null, works: [{ key, text }] | null, worksFrom, cars, arms:
//   { text, sure } | null, stores: [{ key, word }] | null, storesFrom, heard: { short, plenty, day } | null,
//   force: { strength, day } | null, located: day | null, tips: [..] }
// believed: the group you think holds it (the map's last word on the tile, ui.js knownGroupBase); left out, the group
// that holds it now. A base that changed hands out of your sight keeps showing what you knew of the old holder.
export function baseIntel(state, tile, live = state.live, believed = null) {
  const f = believed || baseHolder(state, tile);
  if (!f) return null;
  const holds = f.alive && f.bases.includes(tile);
  const known = !!f.known;
  const looks = [];
  const rec = ledger(state).bases[tile] || {};
  for (const src of ["sight", "survey", "visit"]) if (rec[src] && rec[src].fid === f.id) looks.push(rec[src]);
  if (holds && live && live.has(tile) && !looks.some((l) => l.src === "sight" && l.hour >= state.hour)) { const l = baseLook(state, tile, "sight"); if (l) looks.push(l); }
  const ally = shares(state, f);
  if (ally && holds) { const l = baseLook(state, tile, "visit", INTEL.ALLY_ERR); if (l) looks.push({ ...l, src: "ally" }); }
  const err = (l) => staleErr(state, l.err, l.hour);
  const best = (list) => list.reduce((a, l) => (!a || err(l) < err(a) ? l : a), null);
  const lid = localId(state, f.id);
  const out = {
    tile, fid: f.id, name: known ? f.name : "A group you have not met", known, color: f.color, attitude: known ? attitude(f) : null, ally,
    sources: [], lastSeen: null, confidence: "none", pop: null, gpop: null, walls: null, works: null, worksFrom: null, cars: null,
    arms: null, stores: null, storesFrom: null, heard: null, force: null, located: null, tips: [],
  };
  const seenLooks = looks.filter((l) => l.src !== "ally");
  const newest = seenLooks.reduce((a, l) => (!a || l.hour > a.hour ? l : a), null);
  if (newest) out.lastSeen = { hour: newest.hour, ago: Math.floor(ageDays(state, newest.hour)), src: newest.src };
  for (const l of looks) out.sources.push({ src: l.src, label: SRC_LABEL[l.src], day: Math.floor(l.hour / 24) + 1, ago: Math.floor(ageDays(state, l.hour)) });
  // People at this base and in the whole group.
  const bp = best(looks);
  if (bp) {
    out.pop = rangeOf(state, bp.pop, err(bp), ["pop", tile, bp.src, bp.hour], 1);
    out.confidence = confWord(err(bp));
  }
  const cap = f.intel && f.intel.day != null ? f.intel : null; // prisoners.js gatherIntel
  const capErr = cap ? staleErr(state, INTEL.CAPTIVE_ERR, (cap.day - 1) * 24) : Infinity;
  if (cap) out.sources.push({ src: "captive", label: SRC_LABEL.captive, day: cap.day, ago: Math.max(0, day(state) - cap.day) });
  if (bp && err(bp) <= capErr) out.gpop = rangeOf(state, bp.gpop, err(bp), ["gpop", lid, bp.src, bp.hour], 1);
  else if (cap) out.gpop = rangeOf(state, cap.pop, capErr, ["gpop", lid, "captive", cap.day], 1);
  if (out.confidence === "none" && cap) out.confidence = confWord(capErr);
  // Walls and the works that show to each kind of look.
  if (bp) {
    const goal = wallGoal(f, tile);
    const wl = best(looks);
    const w = wl.built ? Math.min(goal, wl.works.walls || 0) : goal;
    const span = Math.round(err(wl) * INTEL.WALL_SPAN);
    out.walls = { lo: Math.max(0, w - span), hi: Math.min(Math.max(goal, w), w + span), goal };
    const wk = best(looks.filter((l) => SEES[l.src].length > 3)) || wl;
    out.worksFrom = wk.src;
    out.works = [];
    for (const k of Object.keys(WORK_NAME)) {
      if (!SEES[wk.src].includes(k)) continue;
      const n = (wk.works && wk.works[k]) || 0;
      if (n > 0) out.works.push({ key: k, text: n === 1 ? WORK_NAME[k][0] : k === "beds" ? `quarters for about ${n * GROUP_WORKS.SERVES.beds}` : `${n} ${WORK_NAME[k][1]}` });
    }
    if (SEES[wk.src].includes("jail") && wk.jail > 0) out.works.push({ key: "jail", text: "a jail" });
    if (!SEES[wk.src].includes("beds")) out.tips.push("Quarters, a workshop or a storehouse do not show from outside: a Survey team close by would see them.");
    // Vehicles parked at their main base.
    const cl = best(looks.filter((l) => l.main));
    if (cl) out.cars = cl.cars ? rangeOf(state, cl.cars, err(cl), ["cars", tile, cl.src, cl.hour], 0) : { lo: 0, hi: 0 };
  }
  // Stores: inside their gates, from a prisoner, or heard on their channel.
  const inside = best(looks.filter((l) => l.stock));
  const insideErr = inside ? err(inside) : Infinity;
  if (inside && insideErr <= capErr) { out.stores = storeWords(inside.stock, inside.gpop).map(([key, w]) => ({ key, word: w })); out.storesFrom = inside.src; }
  else if (cap) { out.stores = storeWords(cap, cap.pop).map(([key, w]) => ({ key, word: w })); out.storesFrom = "captive"; }
  const g = ledger(state).groups[f.id] || {};
  if (g.stores && ageDays(state, g.stores.hour) <= INTEL.STORES_DAYS) {
    out.heard = { short: g.stores.wants || [], plenty: g.stores.spare || [], day: Math.floor(g.stores.hour / 24) + 1 };
    out.sources.push({ src: "radio", label: SRC_LABEL.radio, day: out.heard.day, ago: Math.floor(ageDays(state, g.stores.hour)) });
  }
  if (g.force && ageDays(state, g.force.hour) <= INTEL.FORCE_DAYS) out.force = { strength: g.force.strength, day: Math.floor(g.force.hour / 24) + 1 };
  // Arms: exact when friends tell you or you fought them lately (arsenal.js), a band either way after a close look.
  const armsText = known ? arsenalText(state, f) : "";
  if (armsText && arsenalKnown(state, f)) out.arms = { text: armsText, sure: true };
  else if (armsText) {
    const close = looks.find((l) => (l.src === "visit" || l.src === "survey") && ageDays(state, l.hour) <= INTEL.ARMS_DAYS);
    if (close) {
      const i = ARMS_WORDS.findIndex((w) => armsText.startsWith(w));
      if (i >= 0) {
        // a close look: the true band and the one above or below it (the world's dice pick which)
        const up = hash01(state.seed, "intel", "arms", tile, close.hour) < 0.5;
        const a = close.src === "visit" ? i : up ? Math.max(0, Math.min(i, ARMS_WORDS.length - 2)) : Math.max(0, i - 1);
        const b = close.src === "visit" ? i : Math.min(ARMS_WORDS.length - 1, a + 1);
        out.arms = { text: a === b ? ARMS_WORDS[a] : `${ARMS_WORDS[a]} to ${ARMS_WORDS[b].toLowerCase()}`, sure: false };
      }
    }
  }
  // Told where they are (a radio fix, news, a prisoner): the base is on your map without a look at it.
  const k = state.knowledge && state.knowledge[tile];
  if (k && k.factionBase === f.id) out.located = Math.floor(k.hour / 24) + 1;
  if (out.confidence === "none") out.tips.push("Nothing learned of this base yet. Send a team past it or a Survey team close by (binoculars or a spotting scope sharpen the look), trade with them, listen in on their channel, or question one of theirs.");
  else if (out.lastSeen && out.lastSeen.ago >= 7) out.tips.push(`Last looked at ${out.lastSeen.ago} days ago: it may have changed since.`);
  return out;
}

// ---------- parties on the road ----------
const KIND_LABEL = { raid: "War party", caravan: "Caravan", convoy: "Trade convoy", scav: "Scavengers", salvage: "Salvage crew" };
const DIRS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
// The way from one tile to the next as a compass word.
export function compass(state, a, b) {
  if (!state.grid || a == null || b == null || a === b) return null;
  const [ax, ay] = state.grid.toPixel(a, 1), [bx, by] = state.grid.toPixel(b, 1);
  if (Math.abs(bx - ax) + Math.abs(by - ay) < 1e-6) return null;
  const ang = Math.atan2(by - ay, bx - ax); // screen y grows southwards
  return DIRS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
}
// The people a party is made of (the true count; only shown as a range).
function headCount(state, p, f) {
  if (Array.isArray(p.members) && p.members.length) return p.members.length;
  if (p.kind === "raid" && f) return raidForce(f, p.strength || 1).count;
  if ((p.kind === "caravan" || p.kind === "convoy") && f) return p.escort ? Math.max(1, Math.min(14, p.escort.guards || 1)) : Math.max(1, Math.min(10, Math.round((p.strength || 2) / guardPower(f))));
  return Math.max(1, Math.min(8, Math.round((p.strength || 2) / 3)));
}
// Where it is going, if you heard it on their channel (radiolisten.js) or your lookouts called the raid.
function heardOf(state, p) {
  const c = state.radioChan;
  const lid = localId(state, p.id);
  for (const key of [`raid:${lid}`, `cv:${lid}`, `sc:${lid}`]) {
    if (!c || !c.got || c.got[key] == null) continue;
    const item = ((c.traffic && c.traffic[p.owner]) || []).find((x) => x.key === key);
    if (item && item.text) return { text: item.text, day: c.got[key] };
  }
  return null;
}
// What you can make out of another group's party: null when it is not in view (or it is yours).
// { id, fid, name, known, color, kind, kindLabel, size: { lo, hi }, night, vehicle, heading, standing, siege,
//   dest, tile, where }
export function partyIntel(state, p, live = state.live) {
  if (!p || p.owner === "player") return null;
  const tile = partyTile(p);
  if (!live || !live.has(tile)) return null;
  const f = typeof p.owner === "number" ? factionById(state, p.owner) : null;
  const known = !!(f && f.known);
  const night = isNight(state);
  const err = (night ? INTEL.PARTY_NIGHT : INTEL.PARTY_ERR) * intelMult(state); // Strategic (traits.js)
  const n = headCount(state, p, f);
  const next = p.path && p.idx < p.path.length - 1 ? p.path[p.idx + 1] : null;
  const moving = next != null && next !== tile && p.phase !== "siege";
  const out = {
    id: p.id, fid: f ? f.id : null, name: known ? f.name : "A group you have not met", known, color: f ? f.color : "#cccccc",
    kind: p.kind, kindLabel: KIND_LABEL[p.kind] || "Party", size: rangeOf(state, n, err, ["party", localId(state, p.id), day(state), night ? 1 : 0], 1), night,
    vehicle: p.humvee != null ? "a Humvee with a machine gun" : p.vehicle ? (p.escort && p.escort.vehicle ? p.escort.vehicle : "a truck") : p.kind === "caravan" ? "a wagon" : null,
    heading: moving ? compass(state, tile, next) : null, standing: !moving, siege: p.phase === "siege", dest: null, tile, where: tileLabel(state, tile),
    attitude: known ? attitude(f) : null,
  };
  const heard = heardOf(state, p);
  if (heard) out.dest = `Heard on their channel (day ${heard.day + 1}): ${heard.text}`;
  else if (p.kind === "raid" && p.target && p.target.kind === "player" && (p.warned || p.phase === "siege")) {
    const b = (state.bases || []).find((x) => x.id === p.target.baseId);
    if (b) out.dest = `Coming for your ${b.name}.`;
  }
  return out;
}
