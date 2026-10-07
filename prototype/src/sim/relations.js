// Relationships, grief, the service record and the memorial wall (suggestions #3), and the daily mood factors that
// make mood matter (#4; the work curve itself is morale.js moodWork).
//
// Opinion: one number per pair (-100..100, the same both ways) for people who have shared a base, a team, a job or
// a battle. Every day people who are together drift toward their pair's *target*: 100 x compatibility (chemistry,
// temper, traits, Speech) + shared history (battles, rough trips, hunger, gifts, quarrels; it fades 1% a day) + the
// leader's pull (0.6 x Leadership for pairs where the leader is). Drift per day = rate x 5% of the gap (rate 1 at a
// base, 2.5 on a team, +0.6 for the same job). Friend at 40+, close friend at 70+, rival at -30 or below; partners
// come from the hub event "two survivors grow close" and split up below 15.
//
// Effects: friends (+0.4 mood a day each, up to +1.2) and a partner (+1.5) nearby, rivals (-0.6 each, up to -1.8);
// in battle +3 aim per friend fighting alongside (up to +6), -2 per rival (up to -4); a team's odds by the numbers
// x(1 + 3% per friend pair - 3% per rival pair, -6%..+9%); rivals start quarrels at the hub and arguments on the road,
// friends tell stories by the fire. A friend or partner who dies: mood -(6 + 14 x bond) at once and "Grieving" for
// 3 + 7 x bond days (-(0.5 + bond) mood a day, work x(1 - 0.2 x bond)); bond = opinion/100 for friends, 1 for a
// partner. Friends of someone killed by a group want revenge (+5 aim against them for 60 days, mood +6 when avenged).
//
// Daily mood factors added here (the rest stay where they were: beds and the leader in morale.js; food, rationing,
// rest, hunger and thirst in economy.js; the dog in hubevents.js), all listed with numbers by moodFactors():
// preserved food only for 7+ days -1 (21+ days -2), hot meals from a kitchen +1, a common room +1.5 (15 people a
// room), a chapel +1 (grief weighs half), comfort items (books; the shelf shared, MOODF.shelfShare people a copy;
// not blueprints) +0.5 each up to +1, the Inspiring perk +0.5 per inspiring person here (up to +1), cabin fever after 14 days of
// winter -0.5 (21: -1), 3+ gloomy days -0.5, after a rough trip +3 a day resting (else -1) for 4 days, friends,
// partner and rivals as above, and high spirits fade (-10% of the mood above 50 a day).
// Breaks: below 12 mood, 10% + 2% per point below 12 a day (cooldown 5 days): sits out a day, binge eats, wanders
// off, or picks a fight; mood +8 afterwards; a card for a fight or a second break within 10 days.
import { log, addCard, day, skill, atBase, residents, alive, baseById, hurt, combatPower } from "./world.js";
import { count } from "./buildings.js";
import { GEAR } from "./data.js";
import { allItems } from "./inventory.js";
import { season, weatherOnDay } from "./weather.js";
import { crowdInfo, talker } from "./morale.js";
import { partyMembers, tileLabel } from "./parties.js";
import { farmOf } from "./farming.js";
import { Rng } from "./rng.js";
import { hasPerk } from "./skills.js";
import { comfortLines, buzzLine, buzzDaily, groomDaily } from "./comforts.js";
import { familyMood } from "./family.js"; // children and expecting (family.js)

export const REL = { friend: 40, close: 70, rival: -30, split: 15, partnerFloor: 70, drift: 0.05, baseRate: 1, teamRate: 2.5, jobRate: 0.6, histFade: 0.99, leader: 0.6, jitter: 1.2 };
export const MOODF = {
  preserved7: -1, preserved21: -2, hotMeals: 1, common: 1.5, commonCap: 15, chapel: 1, comfortPer: 0.5, comfortMax: 1,
  winter14: -0.5, winter21: -1, gloom: -0.5, friend: 0.4, friendMax: 1.2, partner: 1.5, partnerAway: -0.5,
  rival: -0.6, rivalMax: -1.8, roughRest: 3, rough: -1, roughDays: 4, roughHit: -4, fade: 0.1, fadeFrom: 50,
  inspire: 0.5, inspireMax: 1, shelfShare: 5,
};
export const GRIEF = { hit: 6, hitPer: 14, daysBase: 3, daysPer: 7, daily: 0.5, dailyPer: 1, work: 0.2, acquaint: -3, chapel: 0.5 };
export const BREAK = { at: 12, base: 0.1, per: 0.02, relief: 8, cooldown: 5, binge: 3, cardWithin: 10 };
export const COMBAT = { friendAim: 3, friendAimMax: 6, rivalAim: -2, rivalAimMax: -4, revengeAim: 5, revengeDays: 60, avenged: 6, spirit: 0.03, spiritMin: -0.06, spiritMax: 0.09 };
export const MEMORIAL = { food: 1, all: 3, chapel: 2, grievers: 8, griefDays: 2, cooldown: 7, recent: 21 };
export const RECORD_KEYS = [
  ["trips", "Trips"], ["sites", "Sites searched"], ["killsZ", "Dead put down"], ["killsH", "People killed"], ["treated", "People treated"],
  ["built", "Buildings built"], ["harvested", "Food harvested"], ["hives", "Hives destroyed"], ["downed", "Times downed"], ["rescues", "Rescues"],
];
const WORK_ROLES = new Set(["farm", "build", "craft", "operate", "medic", "guard", "scavenge"]);
const GLOOMY = new Set(["rain", "fog", "storm", "snow", "blizzard", "overcast"]);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
const first = (s) => s.name.split(" ")[0];
const listText = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

// ---------- state ----------
// A stream of its own, so relationships never shift the world's dice (same seed, same run).
export function relRng(state) {
  if (!state.relRng) state.relRng = new Rng(((state.seed || 1) * 2654435761 + 0x5eed) >>> 0);
  return state.relRng;
}
const relMap = (state) => state.rel || (state.rel = {});
// A stable per-world number for each person (ids are global across worlds; this is not).
function rk(state, s) {
  if (s.rk == null) s.rk = state.relKeyN = (state.relKeyN || 0) + 1;
  return s.rk;
}
const pairKey = (a, b) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);
export function getRel(state, a, b, create = false) {
  if (!a || !b || a === b) return null;
  const m = relMap(state);
  const k = pairKey(a, b);
  if (!m[k] && create) m[k] = { o: 0, h: 0, met: day(state) };
  return m[k] || null;
}
export const opinion = (state, a, b) => { const r = getRel(state, a, b); return r ? r.o : 0; };
export function relKind(r) {
  if (!r) return null;
  if (r.p) return "partner";
  if (r.o >= REL.close) return "close";
  if (r.o >= REL.friend) return "friend";
  if (r.o <= REL.rival) return "rival";
  return "known";
}
export const KIND_NAMES = { partner: "Partner", close: "Close friend", friend: "Friend", rival: "Rival", known: "Knows" };
const isFriendKind = (k) => k === "partner" || k === "close" || k === "friend";

// Everyone this person has a relationship with (living others first), strongest first.
export function relationsOf(state, s) {
  const out = [];
  if (!s || !state.rel) return out;
  for (const o of state.survivors) {
    if (o === s) continue;
    const r = getRel(state, s, o);
    if (!r) continue;
    out.push({ other: o, o: r.o, kind: relKind(r), partner: !!r.p, rel: r });
  }
  return out.sort((x, y) => (y.other.alive - x.other.alive) || (y.partner - x.partner) || (Math.abs(y.o) - Math.abs(x.o)));
}
export const partnerOf = (state, s) => { const r = relationsOf(state, s).find((x) => x.partner && x.other.alive); return r ? r.other : null; };
export const friendsOf = (state, s) => relationsOf(state, s).filter((x) => x.other.alive && isFriendKind(x.kind)).map((x) => x.other);
export const rivalsOf = (state, s) => relationsOf(state, s).filter((x) => x.other.alive && x.kind === "rival").map((x) => x.other);
// How close two people are, 0..1: a partner 1, a friend opinion/100, anyone else 0.
export function bond(state, a, b) {
  const r = getRel(state, a, b);
  if (!r) return 0;
  if (r.p) return 1;
  return r.o >= REL.friend ? r.o / 100 : 0;
}

// ---------- compatibility ----------
function hash01(...n) {
  let h = 2166136261;
  for (const x of n) { h ^= (x | 0); h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; }
  return (h >>> 0) / 4294967296;
}
// How someone gets along with people in general (-0.15..0.15), from the seed: Warm, Easy-going or Prickly.
export function temper(state, s) { return (hash01(state.seed || 1, rk(state, s), 77) - 0.5) * 0.3; }
export function temperName(state, s) { const t = temper(state, s); return t >= 0.07 ? "Warm" : t <= -0.07 ? "Prickly" : "Easy-going"; }
// Why a pair gets along (or not): parts in target points. Sum = the pair's target opinion before history and leader.
export function compat(state, a, b) {
  const parts = [];
  const lo = Math.min(rk(state, a), rk(state, b)), hi = Math.max(rk(state, a), rk(state, b));
  const chem = (hash01(state.seed || 1, lo, hi) * 1.12 - 0.5) * 100; // -50..+62
  parts.push(["Chemistry", chem]);
  const tem = (temper(state, a) + temper(state, b)) * 100;
  parts.push([`Temper (${temperName(state, a)} / ${temperName(state, b)})`, tem]);
  const has = (t) => (a.traits.includes(t) ? 1 : 0) + (b.traits.includes(t) ? 1 : 0);
  let tr = 0;
  if ((a.traits.includes("brave") && b.traits.includes("coward")) || (a.traits.includes("coward") && b.traits.includes("brave"))) tr -= 30;
  tr -= 10 * has("loud") + 10 * has("greedy");
  tr += 10 * has("medic") + 5 * has("lucky");
  if (tr) parts.push(["Traits", tr]);
  const sp = 1.5 * (skill(a, "speech") + skill(b, "speech") - 10);
  if (Math.abs(sp) >= 1) parts.push(["Speech", sp]);
  return { parts, v: parts.reduce((x, p) => x + p[1], 0) };
}
function pairTarget(state, a, b, r, leaderL) {
  let t = compat(state, a, b).v + r.h + REL.leader * leaderL;
  if (r.p) t = Math.max(t, REL.partnerFloor);
  return clamp(t, -90, 95);
}
// Shared history: lasts (fades 1% a day) and pulls the opinion with it; half of it shows at once.
export function bumpPair(state, a, b, v) {
  const r = getRel(state, a, b, true);
  if (!r) return null;
  r.h = clamp(r.h + v, -60, 60);
  r.o = clamp(r.o + v * 0.5, -100, 100);
  return r;
}

// ---------- mood notes (one-off changes shown in the mood breakdown) ----------
export function noteMood(state, s, v, label) {
  if (!s || !v) return;
  const d = day(state);
  const list = s.moodNotes || (s.moodNotes = []);
  const same = list.find((n) => n.d === d && n.label === label);
  if (same) same.v = r1(same.v + v);
  else list.unshift({ d, v: r1(v), label });
  while (list.length > 8) list.pop();
}
export function addMood(state, s, v, label) {
  if (!s || !s.alive || !v) return;
  const before = s.mood;
  s.mood = clamp(s.mood + v, 0, 100);
  noteMood(state, s, s.mood - before || v, label);
}

// ---------- service record ----------
export function rec(s) {
  if (!s.rec) s.rec = {};
  for (const [k] of RECORD_KEYS) if (!Number.isFinite(s.rec[k])) s.rec[k] = 0;
  return s.rec;
}
function credit(s, key, n = 1) { if (s && n) rec(s)[key] = r1(rec(s)[key] + n); }
export function addMoment(state, s, text, d = day(state)) {
  if (!s) return;
  const list = s.moments || (s.moments = []);
  if (list.some((m) => m.t === text)) return;
  list.unshift({ d, t: text });
  while (list.length > 10) list.pop();
}
export const daysWith = (state, s) => Math.max(1, (s.alive ? day(state) : s.diedDay || day(state)) - (s.joined || 1) + 1);

// ---------- where someone is, and with whom ----------
function placeOf(state, s) {
  const L = s.location;
  if (!L) return null;
  if (L.kind === "base") return { base: baseById(state, L.baseId) };
  if (L.kind === "route") return { base: state.bases.find((b) => b.type === "hub") || null, route: true };
  if (L.kind === "party") return { party: state.parties.find((p) => p.id === L.partyId) || null };
  return null;
}
function together(state, s) {
  const pl = placeOf(state, s);
  if (!pl) return [];
  if (pl.base) return residents(state, pl.base.id).filter((o) => o !== s);
  if (pl.party) return partyMembers(state, pl.party).filter((o) => o !== s);
  return [];
}

// ---------- daily ----------
// Once a day from economy.js basesDaily (after the bases' own daily tick).
export function relationsDaily(state) {
  const d = day(state);
  if (state.relDay === d || state.gameOver) return;
  state.relDay = d;
  const rng = relRng(state);
  for (const s of state.survivors) {
    if (!s.alive) continue;
    rk(state, s);
    if (s.joined == null) { s.joined = d; if (d > 2) addMoment(state, s, `Joined the group, day ${d}`, d); }
    s.onBreak = false;
  }
  // Opinions drift for everyone who shares a base or a team today.
  for (const base of state.bases) driftGroup(state, residents(state, base.id), REL.baseRate, { base, hardship: base.hungerDays > 0 || base.thirstDays > 0 }, rng);
  for (const p of state.parties) if (p.owner === "player") driftGroup(state, partyMembers(state, p), REL.teamRate, { party: p }, rng);
  // Work done at a base: buildings finished and harvests since yesterday.
  for (const base of state.bases) baseCredits(state, base);
  // The day's mood factors (see moodFactors), then grief counts down.
  for (const s of alive(state)) {
    if (!placeOf(state, s)) continue;
    const f = moodFactors(state, s);
    if (f.own) s.mood = clamp(s.mood + f.own, 0, 100);
    if (!Number.isFinite(s.mood)) s.mood = 50;
  }
  for (const s of alive(state)) {
    buzzDaily(s); // comforts.js: a coffee buzz wears off, drink turns into a hangover
    const pl = placeOf(state, s);
    if (pl && !pl.route) groomDaily(state, s, pl); // comforts.js: a day of deodorant, toothpaste and the rest used
    if (s.grief) { s.grief.days -= 1; if (s.grief.days <= 0) delete s.grief; }
    if (s.revenge && s.revenge.until < d) delete s.revenge;
    if (s.rough != null && s.rough < d) delete s.rough;
    const days = daysWith(state, s);
    if ([100, 200, 365, 500].includes(days)) addMoment(state, s, `${days} days with the group, day ${d}`, d);
  }
  // Near the bottom: breaks.
  for (const base of state.bases) for (const s of atBase(state, base.id)) maybeBreak(state, base, s, rng);
}

function driftGroup(state, group, rate, ctx, rng) {
  const people = group.filter((s) => s.alive);
  if (people.length < 2) return;
  const leader = people.find((s) => s.leader);
  const L = leader ? skill(leader, "leadership") : 0;
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i], b = people[j];
      const r = getRel(state, a, b, true);
      if (r.day === state.relDay) continue; // once a day per pair (an escort can be in two lists)
      r.day = state.relDay;
      r.h *= REL.histFade;
      if (ctx.hardship) r.h = clamp(r.h + 0.3, -60, 60);
      let k = rate;
      if (ctx.base && a.role === b.role && WORK_ROLES.has(a.role) && a.location.kind === "base" && b.location.kind === "base") k += REL.jobRate;
      const before = relKind(r);
      const t = pairTarget(state, a, b, r, L);
      r.o = clamp(r.o + k * REL.drift * (t - r.o) + (rng.next() - 0.5) * REL.jitter, -100, 100);
      const now = relKind(r);
      if (r.p && r.o < REL.split) splitUp(state, a, b, r);
      else if (now !== before && (now === "friend" || now === "rival") && r.said !== now) {
        r.said = now;
        log(state, now === "friend" ? `${first(a)} and ${first(b)} have become friends.` : `${first(a)} and ${first(b)} cannot stand each other.`, now === "friend" ? "good" : "info");
      }
    }
  }
}

function splitUp(state, a, b, r) {
  r.p = false;
  log(state, `${a.name} and ${b.name} have split up.`, "danger");
  addMood(state, a, -8, `Split up with ${first(b)}`);
  addMood(state, b, -8, `Split up with ${first(a)}`);
}

function baseCredits(state, base) {
  const n = base.buildings.length;
  if (base.relBuilt == null) base.relBuilt = n;
  if (n > base.relBuilt) {
    const builders = atBase(state, base.id).filter((s) => s.role === "build");
    for (const s of builders) {
      if (!rec(s).built) addMoment(state, s, `Finished a first building at ${base.name}, day ${day(state)}`);
      credit(s, "built", n - base.relBuilt);
    }
  }
  base.relBuilt = n;
  const f = farmOf(state, base);
  const h = f && f.lastHarvest;
  if (h && h.day === day(state) && base.relHarvestDay !== h.day) {
    base.relHarvestDay = h.day;
    const farmers = atBase(state, base.id).filter((s) => s.role === "farm");
    for (const s of farmers) credit(s, "harvested", h.food / farmers.length);
  }
}

// ---------- mood factors ----------
// Everything that moves someone's mood a day, with numbers. own = the factors applied here (relationsDaily);
// the others are applied by economy.js / morale.js / hubevents.js and listed so the breakdown is complete.
export function moodFactors(state, s) {
  const list = [];
  const add = (label, v, own, tip = "") => { if (v && Number.isFinite(v)) list.push({ label, v: r1(v), own, tip }); };
  const pl = placeOf(state, s);
  if (!s.alive || !pl) return { list, net: 0, own: 0, notes: recentNotes(state, s) };
  const d = day(state);
  const base = pl.base || null;
  if (base) {
    // Applied elsewhere (economy.js, morale.js, hubevents.js).
    const ci = crowdInfo(state, base);
    if (ci.penalty > 0) add(`Crowded: ${ci.people} people in ${ci.beds} beds`, -ci.penalty, false);
    else add("A bed for everyone", 1, false);
    if (ci.lift > 0) add(`Leader ${first(ci.leader)} (Leadership ${skill(ci.leader, "leadership")})`, ci.lift, false);
    if (base.thirstDays > 0) add("Out of water", -8, false);
    if (base.hungerDays > 0) add("Out of food", -10, false);
    else add("Fed", 1, false);
    if (base.rationing) add("Short rations", -3, false);
    if (!pl.route && s.role === "rest") add("Resting (Rest role)", 6, false);
    else if (!pl.route && s.inBed) add("In a hospital bed", 3, false);
    if (base.dog) add(`${base.dog.name} the dog`, 0.5, false);
    // Applied here.
    const pres = base.relPreserved || 0;
    if (pres >= 21) add(`Nothing but preserved food for ${pres} days`, MOODF.preserved21, true);
    else if (pres >= 7) add(`Nothing but preserved food for ${pres} days`, MOODF.preserved7, true);
    if (count(base, "kitchen") && !(base.hungerDays > 0)) add("Hot meals from the kitchen", MOODF.hotMeals, true);
    const rooms = count(base, "common_room");
    if (rooms) {
      const n = Math.max(1, residents(state, base.id).length);
      add(`Common room${rooms > 1 ? `s (${rooms})` : ""}${n > rooms * MOODF.commonCap ? ` (crowded: ${n} people)` : ""}`, MOODF.common * Math.min(1, (rooms * MOODF.commonCap) / n), true);
    }
    if (count(base, "chapel")) add("The chapel", MOODF.chapel, true);
    // The Inspiring perk (skills.js PERK_TREE): +0.5 a day from each inspiring person at the base, up to two.
    const insp = pl.route ? [] : atBase(state, base.id).filter((o) => o !== s && hasPerk(o, "inspiring"));
    if (insp.length) add(`Inspired by ${listText(insp.slice(0, 2).map(first))}`, Math.min(MOODF.inspireMax, insp.length * MOODF.inspire), true);
  }
  const ci = comfortInfo(state, s, base);
  if (ci.n > 0) add(`Something to read (${ci.text})`, Math.min(MOODF.comfortMax, ci.n * MOODF.comfortPer), true);
  // Music, cards, keepsakes and toiletries (comforts.js), and the after-effect of a treat (a coffee buzz, a hangover).
  if (!pl.route) for (const c of comfortLines(state, s, pl)) add(c.label, c.v, true);
  const bz = buzzLine(s);
  if (bz) list.push({ label: bz.label, v: bz.v, own: true, tip: "" });
  // Weather: a long winter, and a run of grey days.
  const se = season(state);
  if (se.key === "winter" && se.dayOfSeason > 21) add(`Cabin fever (day ${se.dayOfSeason} of winter)`, MOODF.winter21, true);
  else if (se.key === "winter" && se.dayOfSeason > 14) add(`Cabin fever (day ${se.dayOfSeason} of winter)`, MOODF.winter14, true);
  const grey = gloomDays(state, d);
  if (grey >= 3) add(`${grey} grey days in a row`, MOODF.gloom, true);
  // People.
  const near = together(state, s);
  let fr = 0, rv = 0, partnerHere = false;
  for (const o of near) {
    const r = getRel(state, s, o);
    const k = relKind(r);
    if (k === "partner") partnerHere = true;
    else if (k === "friend" || k === "close") fr++;
    else if (k === "rival") rv++;
  }
  const partner = partnerOf(state, s);
  if (partnerHere) add(`With ${first(partner)} (partner)`, MOODF.partner, true);
  else if (partner && partner.location && partner.location.kind !== "captive") add(`Misses ${first(partner)} (away)`, MOODF.partnerAway, true);
  if (fr) add(`${fr} friend${fr === 1 ? "" : "s"} close by`, Math.min(MOODF.friendMax, fr * MOODF.friend), true);
  if (rv) add(`${rv} rival${rv === 1 ? "" : "s"} close by`, Math.max(MOODF.rivalMax, rv * MOODF.rival), true);
  for (const f of familyMood(state, s, pl.route ? null : base)) add(f.label, f.v, true); // family.js: expecting, children
  if (s.grief) add(`Grieving for ${s.grief.name} (${s.grief.days} day${s.grief.days === 1 ? "" : "s"} left)`, -(GRIEF.daily + GRIEF.dailyPer * s.grief.bond) * (base && count(base, "chapel") ? GRIEF.chapel : 1), true);
  if (s.rough != null && s.rough >= d) {
    if (base && !pl.route && s.role === "rest") add("Resting after a rough trip", MOODF.roughRest, true);
    else add("Shaken after a rough trip (rest helps)", MOODF.rough, true);
  }
  if (s.mood > MOODF.fadeFrom) add("High spirits fade", -MOODF.fade * (s.mood - MOODF.fadeFrom), true);
  const net = r1(list.reduce((a, f) => a + f.v, 0));
  const own = r1(list.filter((f) => f.own).reduce((a, f) => a + f.v, 0));
  return { list, net, own, notes: recentNotes(state, s) };
}
const recentNotes = (state, s) => (s.moodNotes || []).filter((n) => n.d >= day(state) - 10);

function gloomDays(state, d) {
  let n = 0;
  for (let k = d; k > Math.max(0, d - 10); k--) {
    const w = weatherOnDay(state, k);
    if (!w || !GLOOMY.has(w.key)) break;
    n++;
  }
  return n;
}
// Books and other comforts: carried, or (at a base) on the armory shelf (up to 2 count from the shelf).
const isComfort = (g) => {
  if (!g) return false;
  const def = GEAR[g.key] || {};
  if (def.blueprint) return false; // blueprints and technical manuals (blueprints.js) are study, not comfort
  return !!(def.book || def.skillBook || (!def.comfort && /book|novel|manual|bible/i.test(`${g.key} ${def.name || g.name || ""}`))); // music and keepsakes: comforts.js
};
// The shelf is shared: each book on it goes round up to MOODF.shelfShare people, so a big hub needs more of them
// (n is in books: carried ones count in full, the shelf up to 2 a person, spread thinner when it is crowded).
export function comfortInfo(state, s, base) {
  let carried = 0;
  try { carried = allItems(s).filter(isComfort).length; } catch { /* no inventory */ }
  const shelf = base ? (base.armory || []).filter(isComfort).length : 0;
  const people = base ? Math.max(1, residents(state, base.id).length) : 1;
  const share = shelf ? Math.min(1, (shelf * MOODF.shelfShare) / people) : 0;
  const n = carried + Math.min(2, shelf) * share;
  const parts = [];
  if (carried) parts.push(`${carried} carried`);
  if (shelf) parts.push(`${shelf} on the shelf${share < 1 ? ` for ${people} people` : ""}`);
  return { n, carried, shelf, people, text: parts.join(", ") };
}
export function comfortCount(state, s, base) { return comfortInfo(state, s, base).n; }

// Preserved-only streak, per base: called from economy.js after eating (fresh food is eaten first, so no fresh food
// left and preserved food in store means the day's meals were preserved).
export function noteMeals(state, base) {
  const fresh = Math.max(0, base.stock.food || 0), pres = Math.max(0, base.stock.preserved || 0);
  base.relPreserved = fresh < 1 && pres >= 1 ? (base.relPreserved || 0) + 1 : 0;
}

// ---------- breaks ----------
function maybeBreak(state, base, s, rng) {
  const d = day(state);
  if (!s.alive || s.inBed || s.mood >= BREAK.at || (s.breakCd || 0) > d) return;
  if (!rng.chance(BREAK.base + BREAK.per * (BREAK.at - s.mood))) return;
  const others = atBase(state, base.id).filter((o) => o !== s && o.health > 20);
  const kinds = [["sit", 3], ["wander", 2]];
  if ((base.stock.food || 0) >= BREAK.binge * 2) kinds.push(["binge", 2]);
  if (others.length) kinds.push(["fight", 2]);
  const kind = rng.weighted(kinds, (k) => k[1])[0];
  const name = first(s);
  let text = "", card = false;
  if (kind === "sit") { s.onBreak = true; text = `${s.name} could not face the day and sat it out (mood ${Math.round(s.mood)}).`; }
  else if (kind === "wander") { s.onBreak = true; text = `${s.name} wandered off around ${base.name} all day and came back at dusk (mood ${Math.round(s.mood)}).`; }
  else if (kind === "binge") {
    const took = Math.min(BREAK.binge, Math.floor(base.stock.food || 0));
    base.stock.food -= took;
    text = `${s.name} broke into the stores at ${base.name} and ate ${took} food in one sitting.`;
  } else {
    const foe = [...others].sort((a, b) => opinion(state, s, a) - opinion(state, s, b))[0];
    const dmg = rng.int(3, 8);
    hurt(state, foe, Math.min(dmg, foe.health - 5), base.tile, `in a fight with ${name} at ${base.name}`, { raw: true });
    bumpPair(state, s, foe, -16);
    s.onBreak = true;
    addMood(state, foe, -3, `Hit by ${name}`);
    text = `${s.name} picked a fight with ${first(foe)} at ${base.name}; ${first(foe)} took ${dmg} health in it.`;
    card = true;
  }
  const breaks = (s.breaks || []).filter((x) => x >= d - BREAK.cardWithin);
  if (breaks.length) card = true;
  s.breaks = [...breaks, d];
  s.breakCd = d + BREAK.cooldown;
  rec(s);
  addMood(state, s, BREAK.relief, "Let it out (a break)");
  log(state, text, "danger");
  state.relStats = state.relStats || { breaks: {} };
  state.relStats.breaks[kind] = (state.relStats.breaks[kind] || 0) + 1;
  if (card && !state.cards.some((c) => c.breakFor === s.id)) addCard(state, breakCard(state, base, s, text));
}

function breakCard(state, base, s, what) {
  const t = talker(state, base, s);
  const live = () => s.alive && s.location.kind === "base" && s.location.baseId === base.id;
  const gone = () => `${s.name} is no longer at ${base.name}.`;
  return {
    title: `${s.name} is falling apart`,
    text: `${what} ${first(s)} has hit bottom (mood ${Math.round(s.mood)})${s.grief ? ` and is still grieving for ${s.grief.name}` : ""}.`,
    breakFor: s.id,
    choices: [
      {
        label: t.who ? `Talk to them (${first(t.who)}, ${t.who.leader ? "leader" : "Speech"} ${t.score})` : "Talk to them",
        hint: t.who ? `${Math.round(t.chance * 100)}% to get through: mood +15 (else +3)` : "Nobody else is here to talk to them",
        disabled: () => !t.who, ai: () => t.chance * 15,
        resolve: (st) => {
          if (!live()) return gone();
          const ok = st.rng.chance(t.chance);
          addMood(st, s, ok ? 15 : 3, `Talked it through with ${first(t.who)}`);
          if (ok) bumpPair(st, s, t.who, 8);
          return ok ? `${first(t.who)} gets ${first(s)} talking. It helps (mood ${Math.round(s.mood)}).` : `${first(s)} will not open up (mood ${Math.round(s.mood)}).`;
        },
      },
      {
        label: "Give them 2 days' rest", hint: "The Rest role for 2 days (+6 mood a day), +4 now; then back to their role", ai: () => 10,
        resolve: (st) => {
          if (!live()) return gone();
          if (s.role !== "rest") s.restPrev = s.role;
          s.role = "rest"; s.station = null; s.restUntil = day(st) + 2;
          addMood(st, s, 4, "Time off");
          return `${first(s)} takes two days off.`;
        },
      },
      { label: "Let them be", hint: "Nothing changes", ai: () => 0, resolve: () => (live() ? `You leave ${first(s)} alone.` : gone()) },
    ],
  };
}

// ---------- deaths, desertion and the memorial wall ----------
// world.js killSurvivor: grief for friends and a partner, a line on the memorial wall.
export function onDeath(state, s, tileId, cause) {
  const d = day(state);
  s.diedDay = d;
  const grieved = [];
  for (const x of relationsOf(state, s)) {
    const o = x.other;
    if (!o.alive) continue;
    const bd = bond(state, s, o);
    if (bd > 0) {
      const hit = -(GRIEF.hit + GRIEF.hitPer * bd);
      addMood(state, o, hit, `${first(s)} died`);
      const days = Math.round(GRIEF.daysBase + GRIEF.daysPer * bd);
      if (!o.grief || o.grief.bond <= bd) o.grief = { name: first(s), id: s.id, bond: r1(bd), days };
      grieved.push(o.name);
      addMoment(state, o, `Lost ${x.partner ? "their partner " : ""}${s.name}, day ${d}`, d);
    } else if (x.o >= 10 && x.kind !== "rival") addMood(state, o, GRIEF.acquaint, `${first(s)} died`);
  }
  if (grieved.length) log(state, `${listText(grieved.map((n) => n.split(" ")[0]))} ${grieved.length === 1 ? "is" : "are"} grieving for ${first(s)}.`, "info");
  const partner = relationsOf(state, s).find((x) => x.partner);
  const entry = {
    id: s.id, name: s.name, joined: s.joined || 1, died: d, days: daysWith(state, s), cause: String(cause || "").trim(),
    place: placeName(state, tileId, s), record: { ...rec(s) }, moments: (s.moments || []).slice(0, 4),
    grievedBy: grieved, partner: partner ? partner.other.name : null, leader: !!s.leader, honored: false,
  };
  (state.memorial || (state.memorial = [])).unshift(entry);
  return entry;
}
function placeName(state, tileId, s) {
  if (tileId == null) {
    const L = s.location || {};
    if (L.kind === "base") { const b = baseById(state, L.baseId); return b ? b.name : "at home"; }
    return L.kind === "errand" ? "far from home" : "somewhere out there";
  }
  const b = state.bases.find((x) => x.tile === tileId);
  if (b) return b.name;
  try { return tileLabel(state, tileId); } catch { return "on the road"; }
}
// morale.js desert: a friend or partner walking out hurts too (half as much as a death, no grief days).
export function onLeave(state, s, base) {
  for (const x of relationsOf(state, s)) {
    if (!x.other.alive) continue;
    const bd = bond(state, s, x.other);
    if (bd > 0) addMood(state, x.other, -(GRIEF.hit + GRIEF.hitPer * bd) / 2, `${first(s)} walked out`);
    if (x.partner) x.rel.p = false;
  }
}

export const memorialList = (state) => state.memorial || [];
const unhonored = (state) => memorialList(state).filter((m) => !m.honored && m.died >= day(state) - MEMORIAL.recent);
export function grievers(state, base) { return residents(state, base.id).filter((s) => s.grief); }

export function memorialInfo(state, base) {
  const n = residents(state, base.id).length;
  const food = Math.max(2, n * MEMORIAL.food);
  const last = base.memorialDay != null ? base.memorialDay : -99;
  const wait = last + MEMORIAL.cooldown - day(state);
  let reason = "";
  if (!n) reason = "Nobody is here.";
  else if (!memorialList(state).length) reason = "Nobody has died yet.";
  else if (wait > 0) reason = `A service was held on day ${last}; the next one in ${wait} day${wait === 1 ? "" : "s"}.`;
  else if ((base.stock.food || 0) < food) reason = `Needs ${food} food (have ${Math.floor(base.stock.food || 0)}).`;
  return { ok: !reason, reason, food, n, chapel: count(base, "chapel") > 0, names: unhonored(state).map((m) => m.name.split(" ")[0]) };
}
export function holdMemorial(state, base) {
  const info = memorialInfo(state, base);
  if (!info.ok) return info.reason;
  base.stock.food -= info.food;
  base.memorialDay = day(state);
  const lift = MEMORIAL.all + (info.chapel ? MEMORIAL.chapel : 0);
  for (const s of residents(state, base.id)) {
    addMood(state, s, lift + (s.grief ? MEMORIAL.grievers : 0), "Memorial service");
    if (s.grief) s.grief.days = Math.max(1, s.grief.days - MEMORIAL.griefDays);
  }
  const names = info.names.length ? info.names : memorialList(state).slice(0, 3).map((m) => m.name.split(" ")[0]);
  for (const m of unhonored(state)) m.honored = day(state);
  const text = `A memorial service at ${base.name}${info.chapel ? " in the chapel" : ""} for ${listText(names)} (${info.food} food): everyone mood +${lift}, the grieving +${lift + MEMORIAL.grievers}.`;
  log(state, text, "good");
  return text;
}
// Hub event "Remembering the dead" (hubevents.js): likelier with recent deaths nobody has marked yet.
export function memorialWeight(state, base) {
  const recent = unhonored(state).length;
  if (!recent || (base.memorialDay != null && base.memorialDay > day(state) - MEMORIAL.cooldown)) return 0;
  return 0.8 * Math.min(2, recent) * (grievers(state, base).length ? 1.5 : 1);
}
export function memorialCard(state, base) {
  const recent = unhonored(state);
  const names = recent.length ? recent.map((m) => m.name.split(" ")[0]) : memorialList(state).slice(0, 2).map((m) => m.name.split(" ")[0]);
  const who = names.length ? listText(names) : "the ones lost before they found this place";
  const info = memorialInfo(state, base);
  const grieving = () => grievers(state, base);
  return {
    title: "Remembering the dead",
    text: `People at ${base.name} want to mark the passing of ${who}.${grieving().length ? ` ${listText(grieving().map(first))} ${grieving().length === 1 ? "is" : "are"} still grieving.` : ""}`,
    choices: [
      {
        label: `A proper service (${info.food} food)`,
        hint: `Everyone here mood +${MEMORIAL.all + (info.chapel ? MEMORIAL.chapel : 0)}${info.chapel ? " (in the chapel)" : ""}, the grieving +${MEMORIAL.grievers} more and ${MEMORIAL.griefDays} days less grief`,
        disabled: (st) => (base.stock.food || 0) < info.food,
        ai: () => ((base.stock.food || 0) >= info.food + 30 ? 7 + grieving().length : 1),
        resolve: (st) => {
          if ((base.stock.food || 0) < info.food) return `${base.name} cannot spare the food now.`;
          base.memorialDay = null; // the card is the occasion: no cooldown check here
          if (!memorialList(st).length) {
            base.stock.food -= info.food;
            for (const s of residents(st, base.id)) addMood(st, s, MEMORIAL.all, "Memorial service");
            base.memorialDay = day(st);
            return `Candles for the ones lost before (${info.food} food). Everyone mood +${MEMORIAL.all}.`;
          }
          return holdMemorial(st, base);
        },
      },
      {
        label: "A few words at the gate", hint: "Everyone here mood +1, the grieving +3", ai: () => 3,
        resolve: (st) => {
          for (const s of residents(st, base.id)) addMood(st, s, s.grief ? 3 : 1, "A few words for the dead");
          for (const m of unhonored(st)) m.honored = day(st);
          return "Heads bowed at the gate for a minute.";
        },
      },
      {
        label: "No time for it", hint: "Everyone here mood -1, the grieving -3", ai: () => -2,
        resolve: (st) => { for (const s of residents(st, base.id)) addMood(st, s, s.grief ? -3 : -1, "No time to mourn"); return "Work goes on. Not everyone forgives it."; },
      },
    ],
  };
}

// ---------- battles, trips, searches, care, rescues (the record and shared hardship) ----------
// combat.js finishCombat, before the result handler runs. battle = the tactical battle when it was played on a map.
export function battleRecord(state, setup, result, battle, people) {
  if (!result) return;
  const d = day(state);
  const dead = (result.survivorsDead || []).map((id) => state.survivors.find((s) => s.id === id)).filter(Boolean);
  // On a map: the units that took the field; by the numbers: everyone counted in it.
  const onMap = battle && battle.units ? battle.units.filter((u) => u.side === "player" && u.sid != null).map((u) => state.survivors.find((s) => s.id === u.sid)).filter(Boolean) : null;
  const base0 = onMap || people;
  const fought = [...base0.filter((s) => s.alive), ...dead.filter((s) => !base0.filter((x) => x.alive).includes(s))];
  if (!fought.length) return;
  const won = result.outcome === "victory" || result.outcome === "extracted";
  const z = setup.enemy && setup.enemy.kind === "zombies";
  // Kills: by the unit that made them on the map; by the numbers, spread over the fighters by strength.
  const killsBy = battle && battle.killsBy;
  if (killsBy) {
    for (const [sid, k] of Object.entries(killsBy)) { const s = state.survivors.find((x) => x.id === Number(sid)); if (s) { credit(s, "killsZ", k.z); credit(s, "killsH", k.h); killMoments(state, s, k, d); } }
  } else if (result.enemiesKilled > 0) {
    const order = [...fought].sort((a, b) => combatPower(b) - combatPower(a));
    for (let i = 0; i < result.enemiesKilled; i++) {
      const s = order[i % order.length];
      const zk = setup.enemy.kind === "mixed" ? i % 2 === 0 : z;
      const k = zk ? { z: 1, h: 0 } : { z: 0, h: 1 };
      credit(s, zk ? "killsZ" : "killsH");
      killMoments(state, s, k, d);
    }
  }
  const downed = battle && battle.downedIds ? battle.downedIds : fought.filter((s) => s.alive && s.health < 25 && (result.survivorsHurt || []).includes(s.id)).map((s) => s.id);
  const place = battle ? battle.place : setup.tile != null ? placeName(state, typeof setup.tile === "object" ? setup.tile.id : setup.tile, fought[0]) : "the field";
  const foe = (setup.enemy && setup.enemy.name) || (z ? "the dead" : "raiders");
  for (const id of new Set(downed)) {
    const s = state.survivors.find((x) => x.id === id);
    if (!s) continue;
    credit(s, "downed");
    if (s.alive) addMoment(state, s, `Went down fighting ${foe} at ${place} and lived, day ${d}`, d);
  }
  if (battle && battle.rescuesBy) for (const [sid, list] of Object.entries(battle.rescuesBy)) {
    const s = state.survivors.find((x) => x.id === Number(sid));
    if (!s) continue;
    credit(s, "rescues", list.length);
    for (const tid of list) { const t = state.survivors.find((x) => x.id === tid); if (t) { addMoment(state, s, `Kept ${first(t)} alive under fire at ${place}, day ${d}`, d); bumpPair(state, s, t, 12); } }
  }
  if (battle && battle.healsBy) for (const [sid, n] of Object.entries(battle.healsBy)) credit(state.survivors.find((x) => x.id === Number(sid)), "treated", n);
  // Shared hardship: everyone who fought side by side.
  const hard = dead.length > 0 || downed.length > 0;
  const living = fought.filter((s) => s.alive);
  for (let i = 0; i < living.length; i++) for (let j = i + 1; j < living.length; j++) bumpPair(state, living[i], living[j], hard ? 10 : 6);
  const party = setup.partyId ? state.parties.find((p) => p.id === setup.partyId) : null;
  if (party && hard) party.relHard = true;
  // Moments for the big fights.
  const base = setup.baseId != null ? baseById(state, setup.baseId) : null;
  if (setup.handler === "hordeBreakIn" && base) {
    const size = (setup.context && setup.context.size) || setup.enemy.count;
    for (const s of living) addMoment(state, s, won ? `Held the gate${living.length === 1 ? " alone" : ""} during the ${size}-horde break-in at ${base.name}, day ${d}` : `Lived through the ${size}-horde break-in at ${base.name}, day ${d}`, d);
  } else if (setup.handler === "raidDefense" && base && won) {
    for (const s of living) addMoment(state, s, `Drove ${foe} off ${base.name}, day ${d}`, d);
  } else if (setup.handler === "hiveAssault" && won) {
    for (const s of living) { credit(s, "hives"); addMoment(state, s, `Helped burn out a hive at ${place}, day ${d}`, d); }
  } else if (setup.handler === "scavenge" && won) {
    noteSearch(state, living); // a search played on the raid map
  } else if (setup.handler === "rescue" && won) {
    for (const s of living) addMoment(state, s, `Stormed ${foe}'s base on a rescue, day ${d}`, d);
  }
  // Revenge: friends of the fallen against the group that killed them; a win against them settles it.
  const fid = setup.enemy && setup.enemy.factionId;
  if (fid != null) {
    for (const s of alive(state)) {
      if (s.revenge && s.revenge.fid === fid && won && fought.includes(s)) { addMood(state, s, COMBAT.avenged, `Avenged ${s.revenge.name}`); addMoment(state, s, `Avenged ${s.revenge.name} against ${foe}, day ${d}`, d); delete s.revenge; }
    }
    for (const x of dead) for (const o of friendsOf(state, x)) if (o.alive) o.revenge = { fid, name: first(x), foe, until: d + COMBAT.revengeDays };
  }
}
function killMoments(state, s, k, d) {
  const r = rec(s);
  if (k.h > 0 && r.killsH === k.h) addMoment(state, s, `Killed a man for the first time, day ${d}`, d);
  for (const n of [10, 50, 100, 250, 500]) if (k.z > 0 && r.killsZ >= n && r.killsZ - k.z < n) addMoment(state, s, `Put down ${n} of the dead, day ${d}`, d);
}

// parties.js returnHome: a trip done. A rough one (a death, someone badly hurt or downed, 10+ days out) shakes people.
export function tripDone(state, p, members, home) {
  if (!members.length) return;
  const d = day(state);
  const days = p.departed != null ? Math.floor((state.hour - p.departed) / 24) : 0;
  const lost = (p.members || []).map((id) => state.survivors.find((s) => s.id === id)).filter((s) => s && !s.alive && s.diedDay != null && s.diedDay >= d - Math.max(1, days + 1));
  const rough = lost.length > 0 || !!p.relHard || members.some((s) => s.health < 40) || days >= 10;
  for (const s of members) {
    credit(s, "trips");
    if (rec(s).trips === 10) addMoment(state, s, `Back from a tenth trip, day ${d}`, d);
    if (days >= 10) addMoment(state, s, `Came home after ${days} days out, day ${d}`, d);
    if (rough && p.kind !== "convoy") { s.rough = d + MOODF.roughDays; addMood(state, s, MOODF.roughHit, lost.length ? `A trip that cost ${first(lost[0])}` : "A rough trip"); }
  }
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) bumpPair(state, members[i], members[j], rough ? 6 : 3);
}
// scavenge.js extract: a site searched.
export function noteSearch(state, members) { for (const s of members) credit(s, "sites"); }
// medical.js spendMedicTime: a treatment given (wounds and illnesses, by hand or automatic care).
export function noteTreated(state, medic) { if (medic && medic.alive) credit(medic, "treated"); }
// conflicts.js freeCaptive: brought back from captivity by a team.
export function noteRescue(state, freed, p) {
  const team = partyMembers(state, p).filter((s) => s !== freed);
  const d = day(state);
  for (const s of team) { credit(s, "rescues"); addMoment(state, s, `Brought ${first(freed)} home from captivity, day ${d}`, d); bumpPair(state, s, freed, 15); }
  addMoment(state, freed, `Freed from captivity, day ${d}`, d);
}

// ---------- combat and teams ----------
// Aim bonus per survivor id for a battle (combat.js playerUnit): friends alongside, rivals, revenge on this group.
export function friendAim(state, people, setup) {
  const out = {};
  const fid = setup && setup.enemy ? setup.enemy.factionId : null;
  for (const s of people) {
    let f = 0, r = 0;
    for (const o of people) {
      if (o === s) continue;
      const k = relKind(getRel(state, s, o));
      if (isFriendKind(k)) f++;
      else if (k === "rival") r++;
    }
    let v = Math.min(COMBAT.friendAimMax, f * COMBAT.friendAim) + Math.max(COMBAT.rivalAimMax, r * COMBAT.rivalAim);
    if (fid != null && s.revenge && s.revenge.fid === fid) v += COMBAT.revengeAim;
    if (v) out[s.id] = v;
  }
  return out;
}
// A team's odds by the numbers (combat.js autoResolveCombat): x(1 + 3% per friend pair - 3% per rival pair).
export function teamSpirit(state, people) {
  let f = 0, r = 0;
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const k = relKind(getRel(state, people[i], people[j]));
    if (isFriendKind(k)) f++;
    else if (k === "rival") r++;
  }
  return 1 + clamp(COMBAT.spirit * (f - r), COMBAT.spiritMin, COMBAT.spiritMax);
}
// The autopilot's crew: the best fits, but among near-equal picks friends go together and rivals apart.
export function friendlyCrew(state, sorted, size, fit) {
  if (sorted.length <= size || size <= 1) return sorted.slice(0, size);
  const crew = [sorted[0]];
  const pool = sorted.slice(1);
  while (crew.length < size && pool.length) {
    const top = fit(pool[0]);
    const floor = top - Math.max(0.5, Math.abs(top) * 0.15);
    let pick = pool[0], best = -Infinity;
    for (const c of pool) {
      const f = fit(c);
      if (f < floor) break;
      let sc = f;
      for (const m of crew) { const k = relKind(getRel(state, c, m)); sc += isFriendKind(k) ? 0.8 : k === "rival" ? -1.5 : 0; }
      if (sc > best) { best = sc; pick = c; }
    }
    crew.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return crew;
}

// ---------- quarrels, arguments, couples (hubevents.js, events.js) ----------
const pairsIn = (state, pool, pred) => {
  const out = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) { const r = getRel(state, pool[i], pool[j]); if (pred(r)) out.push([pool[i], pool[j], r]); }
  return out;
};
export const rivalPairs = (state, pool) => pairsIn(state, pool, (r) => relKind(r) === "rival");
export const friendPairs = (state, pool) => pairsIn(state, pool, (r) => isFriendKind(relKind(r)));
export function quarrelBoost(state, pool) { return 1 + Math.min(1.2, 0.4 * rivalPairs(state, pool).length); }
// Two people for a quarrel, with the world's dice (two draws, as before): a rival pair 70% of the time when there is one.
export function quarrelPair(state, rng, pool) {
  const rivals = rivalPairs(state, pool).sort((x, y) => x[2].o - y[2].o);
  const u = rng.next(), v = rng.next();
  if (rivals.length && u < 0.7) { const p = rivals[Math.floor(v * Math.min(3, rivals.length))]; return [p[0], p[1]]; }
  const a = pool[Math.floor(u * pool.length)] || pool[0];
  const rest = pool.filter((s) => s !== a);
  return [a, rest[Math.floor(v * rest.length)] || rest[0]];
}
export function coupleBoost(state, pool) { const n = friendPairs(state, pool).filter(([a, b, r]) => !r.p && r.o >= 50 && !partnerOf(state, a) && !partnerOf(state, b)).length; return n ? 1 + 0.5 * Math.min(3, n) : 0.4; }
export function couplePair(state, rng, pool) {
  const close = friendPairs(state, pool).filter(([a, b, r]) => !r.p && r.o >= 50 && !partnerOf(state, a) && !partnerOf(state, b)).sort((x, y) => y[2].o - x[2].o);
  const u = rng.next(), v = rng.next();
  if (close.length) { const p = close[Math.floor(u * Math.min(3, close.length))]; return [p[0], p[1]]; }
  const free = pool.filter((s) => !partnerOf(state, s));
  const list = free.length >= 2 ? free : pool;
  const a = list[Math.floor(u * list.length)] || list[0];
  const rest = list.filter((s) => s !== a);
  return [a, rest[Math.floor(v * rest.length)] || rest[0]];
}
export function makePartners(state, a, b) {
  for (const s of [a, b]) { const old = partnerOf(state, s); if (old && old !== a && old !== b) getRel(state, s, old).p = false; }
  const r = getRel(state, a, b, true);
  r.p = true;
  r.o = Math.max(r.o, REL.partnerFloor);
  r.h = Math.max(r.h, 20);
  const d = day(state);
  addMoment(state, a, `Grew close to ${b.name}, day ${d}`, d);
  addMoment(state, b, `Grew close to ${a.name}, day ${d}`, d);
}
// A falling-out or a making-up between two people (their shared history; hub quarrels, road arguments).
export function relEvent(state, a, b, v) {
  if (a && b && a !== b) bumpPair(state, a, b, v);
}
export function argumentWeight(state, p) {
  const m = partyMembers(state, p);
  if (rivalPairs(state, m).length) return 5;
  return friendPairs(state, m).length >= m.length - 1 && m.length >= 2 ? 1 : 2;
}
// The two who argue on the road: the worst rival pair if there is one, else the given pair.
export function argumentPair(state, members, a, b) {
  const rv = rivalPairs(state, members).sort((x, y) => x[2].o - y[2].o)[0];
  return rv ? [rv[0], rv[1]] : [a, b];
}
// Friends on a team: a night of old stories (travel event).
export function campfireCard(state, p) {
  const m = partyMembers(state, p);
  const pair = friendPairs(state, m).sort((x, y) => y[2].o - x[2].o)[0];
  const [a, b] = pair ? [pair[0], pair[1]] : [m[0], m[1] || m[0]];
  return {
    title: "Stories by the fire",
    text: `${first(a)} and ${first(b)} keep the team up half the night with stories from before.`,
    survivorIds: [a.id, b.id],
    choices: [
      { label: "Let them talk", hint: "The team mood +2, the two of them +4 and closer", resolve: (st) => { for (const s of partyMembers(st, p)) addMood(st, s, s === a || s === b ? 4 : 2, "Stories by the fire"); bumpPair(st, a, b, 5); return "Laughter carries a long way at night, but nothing comes."; } },
      { label: "Douse the fire early", hint: "Nothing changes", resolve: () => "Cold and dark, but quiet." },
    ],
  };
}
export const hasFriendsOnTeam = (state, p) => friendPairs(state, partyMembers(state, p)).length > 0;

// ---------- the survivor screen: making peace between rivals ----------
export const PEACE = { food: 3, gift: 14, talkOk: 22, talkFail: -4, cooldown: 10 };
export function peaceInfo(state, a, b) {
  const r = getRel(state, a, b);
  const base = a.location.kind === "base" && b.location.kind === "base" && a.location.baseId === b.location.baseId ? baseById(state, a.location.baseId) : null;
  const wait = r && r.peaceDay != null ? r.peaceDay + PEACE.cooldown - day(state) : 0;
  const t = base ? talker(state, base, a) : { who: null, chance: 0, score: 0 };
  const who = t.who === b ? null : t.who;
  let reason = "";
  if (!a.alive || !b.alive) reason = "Both have to be alive.";
  else if (!base) reason = "Both have to be at the same base.";
  else if (wait > 0) reason = `Tried on day ${r.peaceDay}; again in ${wait} day${wait === 1 ? "" : "s"}.`;
  return { ok: !reason, reason, base, who, chance: who ? t.chance : 0, score: t.score, food: PEACE.food, hasFood: !!base && (base.stock.food || 0) >= PEACE.food };
}
export function makePeace(state, a, b, how) {
  const info = peaceInfo(state, a, b);
  if (!info.ok) return info.reason;
  const r = getRel(state, a, b, true);
  if (how === "gift") {
    if (!info.hasFood) return `Needs ${PEACE.food} food at ${info.base.name}.`;
    info.base.stock.food -= PEACE.food;
    r.peaceDay = day(state);
    bumpPair(state, a, b, PEACE.gift);
    return `A shared meal (${PEACE.food} food): ${first(a)} and ${first(b)} get on a little better (opinion ${Math.round(r.o)}).`;
  }
  if (!info.who) return "Nobody else here can talk them round.";
  r.peaceDay = day(state);
  const ok = state.rng.chance(info.chance);
  bumpPair(state, a, b, ok ? PEACE.talkOk : PEACE.talkFail);
  return ok ? `${first(info.who)} sits them down. ${first(a)} and ${first(b)} shake hands (opinion ${Math.round(r.o)}).` : `${first(info.who)} tries, but it ends in shouting (opinion ${Math.round(r.o)}).`;
}

// ---------- autopilot ----------
// Rest after a rough trip while spirits are low (autopilot.js planRoles).
export const wantsRest = (state, s) => s.rough != null && s.rough >= day(state) && s.mood < 60;
// Once a day: a memorial service when people are grieving or spirits are low and the food allows.
export function relAutopilotDaily(state) {
  const h = state.bases.find((b) => b.type === "hub");
  if (!h || !unhonored(state).length) return null;
  const ppl = residents(state, h.id);
  const avg = ppl.length ? ppl.reduce((a, s) => a + s.mood, 0) / ppl.length : 100;
  const info = memorialInfo(state, h);
  if (!info.ok || (h.stock.food || 0) < info.food + 20 + ppl.length * 5) return null;
  if (!grievers(state, h).length && avg >= 55) return null;
  return holdMemorial(state, h);
}

// ---------- one summary per person (People tab, roster, survivor screen) ----------
export function survivorSummary(state, s) {
  const rel = relationsOf(state, s).filter((x) => x.other.alive);
  const partner = rel.find((x) => x.partner);
  const friends = rel.filter((x) => !x.partner && isFriendKind(x.kind));
  const rivals = rel.filter((x) => x.kind === "rival");
  const mf = moodFactors(state, s);
  const states = [];
  if (s.onBreak) states.push("On a break");
  if (s.grief) states.push(`Grieving (${s.grief.days} d)`);
  if (s.rough != null && s.rough >= day(state)) states.push("Shaken");
  if (s.revenge) states.push(`Wants revenge on ${s.revenge.foe}`);
  return {
    mood: s.mood, moodPerDay: mf.net, factors: mf.list, notes: mf.notes, states, temper: temperName(state, s),
    partner: partner ? partner.other : null, friends: friends.map((x) => x.other), rivals: rivals.map((x) => x.other),
    record: { ...rec(s), days: daysWith(state, s) }, moments: (s.moments || []).slice(),
  };
}
