// Bonds: the web of relationships between survivors, its buffs and debuffs and how people act on it (the user's
// request 2026-10-21: "Improve survivor inter-connected relationships and behaviors Buffs and debuffs and events").
// Built on relations.js: the one opinion a pair (state.rel, sparse, -100..100, the same both ways), its daily drift
// toward chemistry + traits + shared history, friends, rivals, grief. Partners and couples stay relations.js's and
// family.js's; nothing here makes romance.
//
// Levels (bondLevel, by opinion): rival ≤ -30, disliked ≤ -10, neutral, friendly 15+, friend 40+, close friend 70+
// (a partner above them all). Each pair keeps why (r.why: the few biggest things that moved it, relations.js
// bumpPair's reason), shown on the survivor screen with the level.
//
// What moves a pair (shared history, bumpPair: half at once, the rest pulls the drift; history fades 1% a day, so a
// daily nudge of v settles near 100 × v):
//   - out on the same job trip (a crew, teamwork.js): +BOND.crew a trip; the same work at a base: relations.js's drift
//     (REL.jobRate); fighting side by side and saving each other: relations.js battleRecord, noteRescue;
//   - trait fit (bondTraitParts, in relations.js compat): Vegetarian and Cannibal, two Pessimists, two Farm-Raised,
//     Diplomatic, Persuasive and Medic against Squeamish, two Hotheads;
//   - a lesson (skills.js teachingDaily, lessonBond) and an apprentice's evening lessons: +BOND.lesson a day;
//   - hot meals and a common room together: +BOND.meals, +BOND.common a day;
//   - friction a day for pairs not friends: crowding BOND.crowd, short rations BOND.ration; a rival's success (a
//     moment on their record) BOND.envy; someone who sat the day out on a break BOND.slack with everyone not their
//     friend; rivals at the same work may quarrel (BOND.quarrel, a log line).
// Buffs and debuffs (each a line in relations.js moodFactors and the survivor screen; work in morale.js moodWork, the
// activity line's why):
//   - the same work at a base beside a friend: work +5% (a close friend +8%, at most +8%), mood +0.5 each (up to +1);
//     beside a rival: mood -0.5 each (down to -1) and BOND.quarrelChance a day of a quarrel;
//   - a job trip with a friend in the crew: the load +5% (a close friend +8%), with a rival -5% (jobtrips.js rollLoad);
//   - in a fight: relations.js friendAim (+3 aim a friend) and here steadier nerve, +0.05 a friend alongside (up to
//     +0.1) against a Nightmare's scream (combat.js setup.relNerve, middead.js);
//   - a friend's death: relations.js grief, BOND.closeGrief days longer for a close friend or partner; a friend who
//     walks out: grief at half (BOND.leftGrief), "Misses …";
//   - lessons from a friend +15% XP (close +25%), from a rival -25% (skills.js teachingDaily);
//   - cliques: three or more at a base who are all friends: +0.3 mood each, and -0.5 for anyone there left out (no
//     friend at the base, or a rival or dislike in the circle);
//   - a promise to a dying friend (promiseCard): +0.6 mood and work +5% for BOND.promise.days while the one they swore to
//     look after lives; broken (that one dies or leaves): mood -10 and -0.6 a day for BOND.promise.brokenDays.
// Behaviours: the work scheduler leans toward the job a friend is on and away from a rival's (bondPull: within one
// priority, a fraction of a skill point, never over the player's picks; work.js planBase); a deeply unhappy close
// friend (mood under BOND.follow.mood) may walk out after a deserter (BOND.follow.chance, morale.js desert).
// Events: bondevents.js (hub cards), and the promise card here.
// AI parity (docs/adr/0001-ai-parity.md point 3): an AI group's people are survivor records, but mood, needs and
// relationships do not tick for them (they are treated as fed and rested), so no opinion is kept or drifted for
// them: the pair map is O(n²) a base and a Huge world carries thousands of them. The rules are written on survivor
// records, so anyone who joins you (a recruit, a prisoner turned, a group's people taken in) is under them at once.
// Dice: relations.js relRng (its own stream; the world's dice untouched).
import { log, addCard, day, atBase, residents, survivorById, baseById, skill } from "./world.js";
import { getRel, relKind, bumpPair, addMood, noteMood, addMoment, relationsOf, relRng, bond, REL } from "./relations.js";
import { crowdInfo, desert } from "./morale.js";
import { kitchenService } from "./kitchen.js";
import { count } from "./buildings.js";
import { gainXp, TEACH_GAP } from "./skills.js";
import { SKILL_NAMES } from "./data.js";

export const BOND = {
  friendly: 15, disliked: -10, feud: -50, why: 5,
  // history: occasions and days
  crew: 0.3, lesson: 0.25, meals: 0.06, common: 0.04, crowd: -0.12, ration: -0.1, envy: -1.5, slack: -1, quarrel: -2,
  // buffs and debuffs
  work: { friend: 0.05, close: 0.08, cap: 0.08, promise: 0.05, max: 1.12 },
  mood: { friend: 0.5, rival: -0.5, cap: 1 },
  quarrelChance: 0.05, quarrelMood: -2,
  crewLoad: { friend: 0.05, close: 0.08, rival: -0.05, cap: 0.08 },
  nerve: { friend: 0.05, max: 0.1 },
  teach: { friend: 0.15, close: 0.25, rival: -0.25 },
  apprentice: { days: 28, xp: 3, per: 0.2, mood: 0.3 },
  clique: { min: 3, in: 0.3, out: -0.5 },
  closeGrief: 3, leftGrief: 0.5, leftAt: 0.4,
  follow: { mood: 25, chance: 0.35 },
  promise: { days: 30, mood: 0.6, broken: -10, brokenDays: 14, brokenMood: -0.6, kept: 5, wardAt: 0.4 },
  sched: { friend: 0.25, rival: -0.4, cap: 0.5 },
};
export const LEVELS = [
  ["partner", "Partner"], ["close", "Close friend"], ["friend", "Friend"], ["friendly", "Friendly"],
  ["neutral", "Neutral"], ["disliked", "Disliked"], ["rival", "Rival"],
];
export const LEVEL_NAMES = Object.fromEntries(LEVELS);
// Jobs done at the base (the work bonus) and out on job trips (the crew's load instead).
const BASE_JOBS = new Set(["farm", "build", "craft", "operate", "medic", "guard", "scavenge", "cook"]);
const TRIP_JOBS = new Set(["wood", "forage", "hunt", "fish", "water", "haul"]);
const JOB_WORDS = { farm: "fields", build: "building", craft: "bench", operate: "station", medic: "ward", guard: "walls", scavenge: "ruins", cook: "kitchen", wood: "felling", forage: "foraging", hunt: "hunt", fish: "fishing", water: "water run", haul: "hauling" };
const SUCCESS = /^(Finished a first building|Held the gate|Drove .+ off|Helped burn out a hive|Put down \d+ of the dead|Kept .+ alive under fire|Brought .+ home from captivity|Avenged|Stormed|Back from a tenth trip)/;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
const first = (s) => s.name.split(" ")[0];
const listText = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
const isFriend = (r) => !!r && (r.p || r.o >= REL.friend);
const isClose = (r) => !!r && (r.p || r.o >= REL.close);
const isRival = (r) => !!r && !r.p && r.o <= REL.rival;
const pct = (v) => `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`;

// ---------- levels and reasons ----------
export function levelOf(r) {
  if (!r) return "neutral";
  if (r.p) return "partner";
  if (r.o >= REL.close) return "close";
  if (r.o >= REL.friend) return "friend";
  if (r.o >= BOND.friendly) return "friendly";
  if (r.o <= REL.rival) return "rival";
  if (r.o <= BOND.disliked) return "disliked";
  return "neutral";
}
export const bondLevel = (state, a, b) => levelOf(getRel(state, a, b));
// relations.js bumpPair: what moved a pair, the biggest few kept (same words add up; the newest day kept).
export function noteWhy(state, r, v, why) {
  if (!r || !v || !Number.isFinite(v)) return;
  const t = why || (v > 0 ? "Got on well" : "A falling-out");
  const list = r.why || (r.why = []);
  const e = list.find((x) => x.t === t);
  if (e) { e.v += v; e.d = day(state); } else list.push({ t, v, d: day(state) });
  list.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
  while (list.length > BOND.why) list.pop();
}
// A reason inside a sentence: "(fought side by side at the mill)", "(Mara kept Ben alive under fire)" (no day; a
// first word that is somebody's name keeps its capital).
export function reasonText(state, t) {
  const s = String(t || "").replace(/ \(day \d+\)$/, "");
  const w = s.split(" ")[0];
  return state.survivors.some((x) => x.name.split(" ")[0] === w) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}
// The main reason a pair stands where it does: their biggest shared history the way they lean (for or against),
// else the biggest part of their fit that way.
export function bondReason(state, a, b, compatParts = null) {
  const r = getRel(state, a, b);
  const sign = r && r.o < 0 ? -1 : 1;
  const top = r && r.why && r.why.find((x) => Math.abs(x.v) >= 1 && Math.sign(x.v) === sign);
  if (top) return `${top.t} (day ${top.d})`;
  const parts = (compatParts || []).filter(([, v]) => Math.abs(v) >= 5 && Math.sign(v) === sign).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  return parts.length ? `${parts[0][0]} ${parts[0][1] >= 0 ? "+" : "−"}${Math.round(Math.abs(parts[0][1]))}` : "";
}

// ---------- trait fit (relations.js compat) ----------
export function bondTraitParts(a, b) {
  const ta = a.traits || [], tb = b.traits || [];
  const both = (t) => ta.includes(t) && tb.includes(t);
  const either = (x, y) => (ta.includes(x) && tb.includes(y)) || (ta.includes(y) && tb.includes(x));
  const n = (t) => (ta.includes(t) ? 1 : 0) + (tb.includes(t) ? 1 : 0);
  const out = [];
  if (either("vegetarian", "cannibal")) out.push(["Diet: Vegetarian and Cannibal", -25]);
  if (both("pessimist")) out.push(["Two Pessimists: misery loves company", 6]);
  if (both("farmraised")) out.push(["Both Farm-Raised", 6]);
  if (both("hothead")) out.push(["Two Hotheads", -10]);
  if (either("medic", "squeamish")) out.push(["Medic and Squeamish", -6]);
  const smooth = 5 * n("diplomatic") + 3 * n("persuasive");
  if (smooth) out.push(["Diplomatic, Persuasive", smooth]);
  return out;
}

// ---------- where and with whom ----------
// Their job today (a night's sleep or free time counts as the last work: work.js s.task.last).
export function jobOf(s) {
  let r = s.role;
  if (r === "rest" && s.task && s.task.last && (s.task.kind === "sched" || s.task.kind === "mood")) r = s.task.last.role;
  return r;
}
// Friends and rivals on the same job at the same base.
export function coworkers(state, s) {
  const out = { friends: [], rivals: [], job: null, trip: false };
  if (!s || !s.alive || !s.location || s.location.kind !== "base" || !state.rel) return out;
  const job = jobOf(s);
  if (!BASE_JOBS.has(job) && !TRIP_JOBS.has(job)) return out;
  out.job = job;
  out.trip = TRIP_JOBS.has(job);
  for (const o of atBase(state, s.location.baseId)) {
    if (o === s || jobOf(o) !== job) continue;
    const r = getRel(state, s, o);
    if (isFriend(r)) out.friends.push({ o, close: isClose(r) });
    else if (isRival(r)) out.rivals.push(o);
  }
  return out;
}
const placeKind = (s) => (s && s.location ? s.location.kind : null);
const placed = (s) => s && s.alive && ["base", "party", "post", "route"].includes(placeKind(s));

// ---------- cliques ----------
// Three or more at a base who are all friends with each other (greedy, most friends first; one circle a person).
export function cliquesAt(state, base) {
  const d = day(state);
  if (base.bondCliques && base.bondCliques.d === d) return base.bondCliques.list;
  const people = residents(state, base.id).filter((s) => s.alive);
  const fr = new Map(people.map((s) => [s.id, new Set()]));
  if (state.rel) for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    if (isFriend(getRel(state, people[i], people[j]))) { fr.get(people[i].id).add(people[j].id); fr.get(people[j].id).add(people[i].id); }
  }
  const order = [...people].sort((a, b) => fr.get(b.id).size - fr.get(a.id).size || a.id - b.id);
  const used = new Set();
  const list = [];
  for (const s of order) {
    if (used.has(s.id) || fr.get(s.id).size < BOND.clique.min - 1) continue;
    const c = [s.id];
    for (const o of order) if (!used.has(o.id) && o !== s && c.every((id) => fr.get(id).has(o.id))) c.push(o.id);
    if (c.length >= BOND.clique.min) { list.push(c); for (const id of c) used.add(id); }
  }
  base.bondCliques = { d, list };
  return list;
}
const cliqueName = (state, ids, skip = null) => {
  const names = ids.filter((id) => id !== skip).map((id) => survivorById(state, id)).filter(Boolean).map(first);
  return names.length > 3 ? `${names.slice(0, 2).join(", ")} and the rest` : listText(names);
};

// ---------- mood (relations.js moodFactors: applied there, daily) ----------
export function bondMood(state, s, pl, base) {
  const out = [];
  if (!s || !s.alive || !pl) return out;
  const d = day(state);
  if (base && !pl.route) {
    const cw = coworkers(state, s);
    if (cw.friends.length) {
      const names = listText(cw.friends.map((x) => first(x.o)));
      const w = cw.trip ? crewLoadOf(cw.friends.map((x) => x.close)) : 0;
      out.push({ label: `${cw.trip ? "Out on the" : "At the"} ${JOB_WORDS[cw.job] || cw.job} with ${names} (friend${cw.friends.length > 1 ? "s" : ""})${cw.trip ? `: the load ${pct(w)}` : `: work ${pct(bondWorkFrom(cw))}`}`, v: Math.min(BOND.mood.cap, cw.friends.length * BOND.mood.friend) });
    }
    if (cw.rivals.length) out.push({ label: `${cw.trip ? "Out on the" : "At the"} ${JOB_WORDS[cw.job] || cw.job} with ${listText(cw.rivals.map(first))} (rival${cw.rivals.length > 1 ? "s" : ""})${cw.trip ? `: the load ${pct(BOND.crewLoad.rival)}` : ""}; quarrels likely`, v: Math.max(-BOND.mood.cap, cw.rivals.length * BOND.mood.rival) });
    for (const c of cliquesAt(state, base)) {
      if (c.includes(s.id)) { out.push({ label: `One of ${cliqueName(state, c, s.id)}'s circle`, v: BOND.clique.in, tip: "Three or more who are all friends: they stick together" }); continue; }
      if (leftOut(state, s, c, base)) out.push({ label: `Left out by ${cliqueName(state, c)}'s circle`, v: BOND.clique.out, tip: "No friend here, or bad blood with the circle: a friend at the base or making peace ends it" });
    }
  }
  if (s.promise && s.promise.until >= d) out.push({ label: `Keeping a promise to ${s.promise.to}: looking after ${s.promise.wardName}`, v: BOND.promise.mood });
  if (s.promiseBroken && s.promiseBroken.until >= d) out.push({ label: `Could not keep a promise to ${s.promiseBroken.to}`, v: BOND.promise.brokenMood });
  const ap = s.apprentice && s.apprentice.until >= d ? survivorById(state, s.apprentice.tid) : null;
  if (ap && ap.alive) out.push({ label: `Apprenticed to ${first(ap)} (${SKILL_NAMES[s.apprentice.skill] || s.apprentice.skill})`, v: BOND.apprentice.mood });
  return out;
}
function leftOut(state, s, c, base) {
  if (c.length < BOND.clique.min) return false;
  let bad = false;
  for (const id of c) { const o = survivorById(state, id); const r = o && getRel(state, s, o); if (r && r.o <= BOND.disliked) bad = true; }
  if (bad) return true;
  return !residents(state, base.id).some((o) => o !== s && o.alive && isFriend(getRel(state, s, o)));
}

// ---------- work (morale.js moodWork) and loads (jobtrips.js rollLoad) ----------
function bondWorkFrom(cw) {
  if (cw.trip || !cw.friends.length) return 0;
  return Math.min(BOND.work.cap, cw.friends.reduce((a, x) => a + (x.close ? BOND.work.close : BOND.work.friend), 0));
}
// × on their work at a base today (cached by bondsDaily: moodWork has no state).
export function bondWork(s) {
  const f = s && s.bondFx;
  if (!f || !s.location || s.location.kind !== "base" || f.base !== s.location.baseId) return 1;
  return f.work || 1;
}
function crewLoadOf(closes, rivals = 0) {
  const v = closes.reduce((a, c) => a + (c ? BOND.crewLoad.close : BOND.crewLoad.friend), 0) + rivals * BOND.crewLoad.rival;
  return clamp(v, -BOND.crewLoad.cap, BOND.crewLoad.cap);
}
// A job trip's crew: × on this one's load from friends and rivals among the mates, and the trip shared (history).
export function bondCrewMult(state, s, t) {
  if (!s || !t || !t.mates || !t.mates.length) return 1;
  const closes = [];
  let rivals = 0;
  for (const id of t.mates) {
    const o = survivorById(state, id);
    if (!o || !o.alive || o === s) continue;
    const r = getRel(state, s, o, true);
    if (isFriend(r)) closes.push(isClose(r));
    else if (isRival(r)) rivals++;
    bumpPair(state, s, o, BOND.crew / 2, `Out on the ${JOB_WORDS[t.job] || t.job} together`); // each of the two rolls their load: half each
  }
  return Math.round((1 + crewLoadOf(closes, rivals)) * 1000) / 1000;
}
// The activity line's why (activity.js describeActivity).
export function bondWorkNote(state, s) {
  const cw = coworkers(state, s);
  const bits = [];
  if (cw.friends.length) bits.push(`Beside ${listText(cw.friends.map((x) => first(x.o)))} (friend${cw.friends.length > 1 ? "s" : ""}): ${cw.trip ? `the load ${pct(crewLoadOf(cw.friends.map((x) => x.close)))} when out together` : `work ${pct(bondWorkFrom(cw))}`}.`);
  if (cw.rivals.length) bits.push(`${listText(cw.rivals.map(first))} (rival${cw.rivals.length > 1 ? "s" : ""}) on the same job: mood down, a quarrel now and then.`);
  if (s.promise && s.promise.until >= day(state)) bits.push(`A promise to ${s.promise.to}: work +${Math.round(BOND.work.promise * 100)}%.`);
  return bits.join(" ");
}

// ---------- the work scheduler (work.js planBase) ----------
// A pull toward the job a friend is on this hour and away from a rival's: (s, key) → a score added within one
// priority (a skill point is 0.25 there; the same job kept 1.5). Never more than BOND.sched.cap either way.
export function bondPull(state, people) {
  const m = new Map();
  if (!state.rel || people.length < 2) return () => 0;
  for (const s of people) {
    let row = null;
    for (const o of people) {
      if (o === s || !o.task || !o.task.t) continue;
      const r = getRel(state, s, o);
      if (!r) continue;
      const v = isFriend(r) ? BOND.sched.friend : isRival(r) ? BOND.sched.rival : 0;
      if (!v) continue;
      row = row || {};
      row[o.task.t] = (row[o.task.t] || 0) + v;
    }
    if (row) m.set(s.id, row);
  }
  return (s, key) => { const row = m.get(s.id); return row && row[key] ? clamp(row[key], -BOND.sched.cap, BOND.sched.cap) : 0; };
}

// ---------- fights (combat.js createBattle) ----------
// Nerve per survivor id: friends alongside hold steadier (a Nightmare's scream, middead.js).
export function bondNerve(state, people) {
  const out = {};
  for (const s of people) {
    let f = 0;
    for (const o of people) if (o !== s && isFriend(getRel(state, s, o))) f++;
    if (f) out[s.id] = Math.min(BOND.nerve.max, f * BOND.nerve.friend);
  }
  return out;
}

// ---------- lessons (skills.js teachingDaily) ----------
// × on a lesson's XP from T to L, and the lesson shared (history).
export function lessonBond(state, T, L, key) {
  if (!T || !L) return 1;
  const r = getRel(state, T, L, true);
  bumpPair(state, T, L, BOND.lesson, `${first(T)} teaches ${first(L)} ${SKILL_NAMES[key] || key || ""}`.trim());
  r.taught = (r.taught || 0) + 1;
  return 1 + (isClose(r) ? BOND.teach.close : isFriend(r) ? BOND.teach.friend : isRival(r) ? BOND.teach.rival : 0);
}
// Who taught whom most: the mentor's name, from the pair's lesson days (5 or more).
export function mentorOf(state, s) {
  let best = null, n = 4;
  for (const x of relationsOf(state, s)) if (x.rel.taught > n && x.other.alive && skillGap(x.other, s)) { best = x.other; n = x.rel.taught; }
  return best;
}
const skillGap = (T, L) => Object.keys(SKILL_NAMES).some((k) => skill(T, k) >= skill(L, k) + TEACH_GAP);

// ---------- daily (relations.js relationsDaily, at its end) ----------
export function bondsDaily(state, rng = relRng(state)) {
  const d = day(state);
  if (state.bondDay === d) return;
  state.bondDay = d;
  for (const base of state.bases) {
    const people = atBase(state, base.id);
    if (people.length < 2) continue;
    // Meals and comforts shared; friction from crowding and short rations (for pairs who are not friends).
    const meals = !(base.hungerDays > 0) && kitchenService(state, base).mood > 0;
    const common = count(base, "common_room") > 0;
    const crowded = crowdInfo(state, base).penalty > 0;
    const short = !!base.rationing;
    if (meals || common || crowded || short) {
      for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
        const a = people[i], b = people[j];
        if (meals) bumpPair(state, a, b, BOND.meals, `Meals together at ${base.name}`);
        if (common) bumpPair(state, a, b, BOND.common, `Evenings in the common room`);
        if (!isFriend(getRel(state, a, b))) {
          if (crowded) bumpPair(state, a, b, BOND.crowd, `Packed in at ${base.name}`);
          if (short) bumpPair(state, a, b, BOND.ration, "Short rations");
        }
      }
    }
    // Rivals on the same job: a quarrel now and then.
    const seen = new Set();
    for (const s of people) {
      for (const o of coworkers(state, s).rivals) {
        const k = s.id < o.id ? `${s.id}:${o.id}` : `${o.id}:${s.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (!rng.chance(BOND.quarrelChance)) continue;
        bumpPair(state, s, o, BOND.quarrel, `Quarrels over the ${JOB_WORDS[jobOf(s)] || "work"}`);
        addMood(state, s, BOND.quarrelMood, `A quarrel with ${first(o)}`);
        addMood(state, o, BOND.quarrelMood, `A quarrel with ${first(s)}`);
        log(state, `${first(s)} and ${first(o)} quarrelled over the ${JOB_WORDS[jobOf(s)] || "work"} at ${base.name}.`, "info");
      }
    }
    // Someone who sat the day out (a break: relations.js maybeBreak): the others who are not their friends mind it.
    for (const s of people) {
      if (!s.onBreak) continue;
      for (const o of people) if (o !== s && !isFriend(getRel(state, s, o))) bumpPair(state, o, s, BOND.slack, `${first(s)} sat the work out`);
    }
    cliquesAt(state, base);
  }
  // A rival's success (a moment on their record since yesterday): envy.
  for (const s of state.survivors) {
    if (!s.alive || !s.moments) continue;
    for (const m of s.moments) {
      if (m.env || m.d < d - 1) continue;
      m.env = true;
      if (!SUCCESS.test(m.t)) continue;
      for (const x of relationsOf(state, s)) if (x.other.alive && isRival(x.rel)) { bumpPair(state, x.other, s, BOND.envy, `Envies ${first(s)}`); noteMood(state, x.other, -1, `${first(s)} gets the credit (rival)`); x.other.mood = clamp(x.other.mood - 1, 0, 100); }
    }
  }
  // Work today, apprentices' evening lessons, promises.
  for (const s of state.survivors) {
    if (!s.alive) { delete s.bondFx; continue; }
    const atB = s.location && s.location.kind === "base";
    let w = atB ? 1 + bondWorkFrom(coworkers(state, s)) : 1;
    if (s.promise && s.promise.until >= d) w += BOND.work.promise;
    w = Math.min(BOND.work.max, w);
    if (w !== 1 && atB) s.bondFx = { base: s.location.baseId, work: Math.round(w * 1000) / 1000, d };
    else delete s.bondFx;
    apprenticeDaily(state, s, d);
    promiseDaily(state, s, d);
  }
}
function apprenticeDaily(state, L, d) {
  const a = L.apprentice;
  if (!a) return;
  const T = survivorById(state, a.tid);
  if (!T || !T.alive || a.until < d) {
    if (T && a.until < d) { addMoment(state, L, `Finished an apprenticeship with ${T.name} (${SKILL_NAMES[a.skill] || a.skill}), day ${d}`, d); addMoment(state, T, `Took ${L.name} on as an apprentice, day ${d}`, d); }
    delete L.apprentice;
    return;
  }
  const same = L.location.kind === "base" && T.location.kind === "base" && L.location.baseId === T.location.baseId;
  if (!same || skill(T, a.skill) < skill(L, a.skill) + TEACH_GAP) return;
  gainXp(state, L, a.skill, (BOND.apprentice.xp + BOND.apprentice.per * skill(T, a.skill)) * lessonBond(state, T, L, a.skill), "study");
}
function promiseDaily(state, s, d) {
  if (s.promiseBroken && s.promiseBroken.until < d) delete s.promiseBroken;
  const p = s.promise;
  if (!p || p.until >= d) return;
  const w = survivorById(state, p.ward);
  if (w && w.alive) { addMood(state, s, BOND.promise.kept, `Kept a promise to ${p.to}`); addMoment(state, s, `Kept a promise to ${p.to}: looked after ${w.name}, day ${d}`, d); }
  delete s.promise;
}

// ---------- deaths and departures (relations.js onDeath, onLeave) ----------
let following = false;
export function bondsOnDeath(state, s) {
  const d = day(state);
  // A close friend or a partner grieves longer.
  for (const x of relationsOf(state, s)) if (x.other.alive && isClose(x.rel) && x.other.grief && x.other.grief.id === s.id) x.other.grief.days += BOND.closeGrief;
  wardGone(state, s, "died");
  if (s.promise) delete s.promise;
  if (s.apprentice) delete s.apprentice;
  // A promise to the dying: their closest friend there swears to look after the next closest (one card a day).
  if (state.bondPromiseDay === d || state.gameOver) return;
  const close = relationsOf(state, s).filter((x) => x.other.alive && placed(x.other) && bond(state, s, x.other) >= REL.close / 100).sort((a, b) => bond(state, s, b.other) - bond(state, s, a.other) || a.other.id - b.other.id);
  const P = close[0] && close[0].other;
  if (!P || P.promise) return;
  const W = relationsOf(state, s).filter((x) => x.other.alive && x.other !== P && placed(x.other) && bond(state, s, x.other) >= BOND.promise.wardAt).sort((a, b) => bond(state, s, b.other) - bond(state, s, a.other) || a.other.id - b.other.id)[0];
  if (!W) return;
  state.bondPromiseDay = d;
  addCard(state, promiseCard(state, s, P, W.other));
}
// A friend who walks out: grief at half; a ward gone breaks a promise; a close friend may go after them.
export function bondsOnLeave(state, s, base) {
  const d = day(state);
  for (const x of relationsOf(state, s)) {
    const o = x.other;
    if (!o.alive) continue;
    const bd = bond(state, s, o);
    if (bd < BOND.leftAt) continue;
    const g = { name: first(s), id: s.id, bond: r1(bd * BOND.leftGrief), days: Math.max(1, Math.round((3 + 7 * bd) * BOND.leftGrief)), left: true };
    if (!o.grief || o.grief.bond <= g.bond) o.grief = g;
  }
  wardGone(state, s, "left");
  if (s.promise) delete s.promise;
  if (following || !base || !s.left) return;
  // A deeply unhappy close friend at the same base may follow them out (one at most).
  const rng = relRng(state);
  const cands = atBase(state, base.id).filter((o) => o !== s && !o.leader && o.mood < BOND.follow.mood && isClose(getRel(state, s, o))).sort((a, b) => a.mood - b.mood || a.id - b.id);
  for (const f of cands) {
    if (!rng.chance(BOND.follow.chance)) continue;
    following = true;
    try { desert(state, base, f, { why: `${f.name} could not stay at ${base.name} without ${first(s)} and went after them (mood ${Math.round(f.mood)})` }); } finally { following = false; }
    addMoment(state, f, `Followed ${s.name} out of ${base.name}, day ${d}`, d);
    break;
  }
}
function wardGone(state, w, how) {
  const d = day(state);
  for (const s of state.survivors) {
    if (!s.alive || !s.promise || s.promise.ward !== w.id || s.promise.until < d) continue;
    const to = s.promise.to;
    delete s.promise;
    s.promiseBroken = { to, until: d + BOND.promise.brokenDays };
    addMood(state, s, BOND.promise.broken, `${first(w)} ${how}: a promise to ${to} broken`);
    log(state, `${s.name} swore to ${to} to look after ${first(w)}, and ${first(w)} ${how === "died" ? "is dead" : "has gone"}. It weighs on them.`, "danger");
  }
}

// ---------- the promise card ----------
export function promiseCard(state, dead, P, W) {
  const B = BOND.promise;
  const live = () => P.alive && W.alive && placed(P);
  return {
    title: `A promise to ${first(dead)}`,
    text: `Before the end ${dead.name} asked ${P.name} for one thing: to look out for ${W.name}. ${first(P)} and ${first(dead)} were ${levelOf(getRel(state, dead, P)) === "partner" ? "partners" : "close friends"}${bondReason(state, dead, P) ? ` (${reasonText(state, bondReason(state, dead, P))})` : ""}.`,
    survivorIds: [P.id, W.id],
    bondFor: P.id,
    choices: [
      {
        label: `${first(P)} gives their word`,
        hint: `${first(P)}: mood +${B.mood} and work +${Math.round(BOND.work.promise * 100)}% a day for ${B.days} days while ${first(W)} lives; if ${first(W)} dies or leaves before then, mood ${B.broken} and ${B.brokenMood} a day for ${B.brokenDays} days`,
        ai: () => 3,
        resolve: (st) => {
          if (!live()) return `${first(P)} cannot make that promise now.`;
          P.promise = { to: first(dead), toId: dead.id, ward: W.id, wardName: first(W), until: day(st) + B.days };
          bumpPair(st, P, W, 6, `Swore to ${first(dead)} to look after ${first(W)}`);
          addMoment(st, P, `Promised ${dead.name} to look after ${W.name}, day ${day(st)}`);
          return `${first(P)} gives ${first(dead)} their word. ${first(W)} will not be alone.`;
        },
      },
      {
        label: "Just hold their hand",
        hint: `${first(P)} mood +3, grief a day shorter; no promise`,
        default: true, ai: () => 2,
        resolve: (st) => {
          if (!P.alive) return "Too late.";
          addMood(st, P, 3, `Was there for ${first(dead)} at the end`);
          if (P.grief && P.grief.id === dead.id) P.grief.days = Math.max(1, P.grief.days - 1);
          return `${first(P)} stays with ${first(dead)} to the end, and makes no promises.`;
        },
      },
    ],
  };
}

// ---------- the survivor screen ----------
// Their notable ties: level, opinion, why; living first, strongest first (relations.js relationsOf).
export function notableBonds(state, s, max = 10, compatOf = null) {
  const out = [];
  for (const x of relationsOf(state, s)) {
    const lvl = levelOf(x.rel);
    if (lvl === "neutral" && !(x.rel.taught > 4)) continue;
    const tags = [];
    if (x.rel.taught > 4) tags.push(`${x.rel.taught} days of lessons`);
    if (s.promise && s.promise.ward === x.other.id) tags.push(`promised ${s.promise.to} to look after them`);
    if (x.other.promise && x.other.promise.ward === s.id) tags.push("looks out for them");
    if (s.apprentice && s.apprentice.tid === x.other.id) tags.push("their mentor");
    if (x.other.apprentice && x.other.apprentice.tid === s.id) tags.push("their apprentice");
    out.push({ other: x.other, o: x.o, level: lvl, name: LEVEL_NAMES[lvl], why: bondReason(state, s, x.other, compatOf ? compatOf(x.other) : null), tags, rel: x.rel });
    if (out.length >= max) break;
  }
  return out;
}
// Their relationship buffs and debuffs now, in words (tone good / bad).
export function bondEffects(state, s) {
  const out = [];
  if (!s || !s.alive) return out;
  const d = day(state);
  const cw = coworkers(state, s);
  if (cw.friends.length) out.push({ text: cw.trip ? `Load ${pct(crewLoadOf(cw.friends.map((x) => x.close)))} out with ${listText(cw.friends.map((x) => first(x.o)))}` : `Work ${pct(bondWorkFrom(cw))} beside ${listText(cw.friends.map((x) => first(x.o)))}`, good: true });
  if (cw.rivals.length) out.push({ text: `Same job as ${listText(cw.rivals.map(first))} (rival): mood down, ${Math.round(BOND.quarrelChance * 100)}% a day of a quarrel${cw.trip ? `, load ${pct(BOND.crewLoad.rival)} out together` : ""}`, good: false });
  const friends = relationsOf(state, s).filter((x) => x.other.alive && isFriend(x.rel));
  if (friends.length) out.push({ text: `In a fight beside ${friends.length === 1 ? first(friends[0].other) : `friends (${friends.length})`}: +3 aim each (up to +6), nerve +${Math.round(BOND.nerve.friend * 100)}% each (up to +${Math.round(BOND.nerve.max * 100)}%)`, good: true });
  const rivals = relationsOf(state, s).filter((x) => x.other.alive && isRival(x.rel));
  if (rivals.length) out.push({ text: `In a fight beside ${listText(rivals.slice(0, 2).map((x) => first(x.other)))} (rival): −2 aim each`, good: false });
  const teachers = friends.filter((x) => x.other.role === "teach" || (s.apprentice && s.apprentice.tid === x.other.id));
  if (teachers.length) out.push({ text: `Learns ${pct(isClose(teachers[0].rel) ? BOND.teach.close : BOND.teach.friend)} faster from ${first(teachers[0].other)}`, good: true });
  if (s.apprentice && s.apprentice.until >= d) { const T = survivorById(state, s.apprentice.tid); if (T) out.push({ text: `Evening lessons in ${SKILL_NAMES[s.apprentice.skill]} from ${first(T)} until day ${s.apprentice.until}`, good: true }); }
  if (s.promise && s.promise.until >= d) out.push({ text: `A promise to ${s.promise.to}: work +${Math.round(BOND.work.promise * 100)}%, mood +${BOND.promise.mood} a day until day ${s.promise.until} while ${s.promise.wardName} lives`, good: true });
  if (s.promiseBroken && s.promiseBroken.until >= d) out.push({ text: `A broken promise to ${s.promiseBroken.to}: mood ${BOND.promise.brokenMood} a day until day ${s.promiseBroken.until}`, good: false });
  if (s.grief && s.grief.left) out.push({ text: `Misses ${s.grief.name} (walked out): ${s.grief.days} days`, good: false });
  const base = s.location && s.location.kind === "base" ? baseById(state, s.location.baseId) : null;
  if (base) for (const c of cliquesAt(state, base)) {
    if (c.includes(s.id)) out.push({ text: `In ${cliqueName(state, c, s.id)}'s circle: mood +${BOND.clique.in} a day`, good: true });
    else if (leftOut(state, s, c, base)) out.push({ text: `Left out by ${cliqueName(state, c)}'s circle: mood ${BOND.clique.out} a day`, good: false });
  }
  return out;
}
// The states line (relations.js survivorSummary).
export function bondStates(state, s) {
  const out = [];
  const d = day(state);
  if (s.promise && s.promise.until >= d) out.push(`Promised ${s.promise.to}`);
  if (s.apprentice && s.apprentice.until >= d) { const T = survivorById(state, s.apprentice.tid); if (T) out.push(`Apprentice to ${first(T)}`); }
  return out;
}
