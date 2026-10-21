// Bond events: hub cards about the people at the hub and how they get on (bonds.js; the user's request 2026-10-21).
// Merged into hubevents.js HUB_EVENTS, so they come with its pacing (a daily chance, never two days running, never
// while another hub card waits), the tray and its auto-answers (cardrules.js: each card marks its default), and the
// autopilot's `ai` scores. Every card names the people and what lies between them (bonds.js bondReason).
//   feud       a feud (a rival pair at BOND.feud or below) comes to blows: mediate, punish them both, send one of
//              them to another of your bases (moveout.js moveTeamOut), or let them fight it out;
//   reconcile  two who were at odds have been through enough together (their history well above where they stand):
//              share a drink on it, or let it come in its own time;
//   join       someone asks to work beside a friend: put them on the friend's job (work.js setCell: priority 1 for
//              that work type; a Manual person's role), or not now;
//   apprentice someone asks a friend or a neutral who knows a skill far better to teach them: evening lessons for
//              BOND.apprentice.days (bonds.js apprenticeDaily), or not now;
//   jealousy   someone who thinks little of the leader resents the leader's closest friend at the hub;
//   betrayal   a Greedy or unhappy person steals from a friend;
//   newcomer   someone who joined in the last 10 days: welcomed (a supper, a guide) or left to find their feet (shunned
//              by a circle if the hub has one).
// The promise to a dying friend is bonds.js promiseCard (raised by the death, not by the hub's dice).
// Each pair waits BOND_EV.cooldown days after a card about them (r.evDay). World dice (state.rng) only when a card
// resolves, as the other hub cards do.
import { foodIn, payFood } from "./foods.js";
import { day, atBase, skill, hurt, log } from "./world.js";
import { talkXp, TEACH_GAP, SKILL_MAX } from "./skills.js";
import { SKILLS, SKILL_NAMES } from "./data.js";
import { getRel, bumpPair, addMood, addMoment, temper, REL } from "./relations.js";
import { BOND, levelOf, bondReason, reasonText, cliquesAt, jobOf } from "./bonds.js";
import { isManaged, setCell, WORK_TYPES } from "./work.js";
import { moveTeamOut } from "./moveout.js";

export const BOND_EV = { cooldown: 20, newDays: 10, lessonGap: 2, theft: ["a hidden ration bar", "a keepsake from before", "their last pack of cigarettes", "a good pair of socks", "a little bottle of whisky", "a photograph in a tin"] };
const JOIN_JOBS = ["farm", "build", "craft", "scavenge", "hunt", "fish", "forage", "wood", "water", "guard"];
const JOB_NAMES = { farm: "the fields", build: "the building", craft: "the bench", scavenge: "the scavenging", hunt: "the hunting", fish: "the fishing", forage: "the foraging", wood: "the felling", water: "the water runs", guard: "the walls" };

const first = (s) => s.name.split(" ")[0];
const pct = (c) => `${Math.round(c * 100)}%`;
const here = (s, base) => s && s.alive && s.location.kind === "base" && s.location.baseId === base.id;
// "are friends", "are friendly", "are rivals", "are at odds" (a level as a predicate).
const LEVEL_SAY = { partner: "partners", close: "close friends", friend: "friends", friendly: "friendly", neutral: "not close", disliked: "at odds", rival: "rivals" };
const are = (st, a, b) => LEVEL_SAY[levelOf(getRel(st, a, b))];
const because = (st, a, b) => { const w = bondReason(st, a, b); return w ? ` (${reasonText(st, w)})` : ""; };
// Someone at the base to talk two people down: the leader if neither of them, else the best Speech there.
function mediatorFor(st, base, a, b) {
  const pool = atBase(st, base.id).filter((o) => o !== a && o !== b);
  if (!pool.length) return null;
  const score = (o) => (o.leader ? Math.max(skill(o, "speech"), skill(o, "leadership")) : skill(o, "speech"));
  const who = pool.find((o) => o.leader) || [...pool].sort((x, y) => score(y) - score(x) || x.id - y.id)[0];
  const best = [...pool].sort((x, y) => score(y) - score(x) || x.id - y.id)[0];
  const pick = score(best) > score(who) ? best : who;
  return { who: pick, score: score(pick), chance: Math.max(0.3, Math.min(0.95, 0.3 + 0.035 * score(pick))) };
}
const fresh = (st, r) => !r || r.evDay == null || r.evDay <= day(st) - BOND_EV.cooldown;
const mark = (st, a, b) => { const r = getRel(st, a, b, true); if (r) r.evDay = day(st); };
// Every pair among the people (i < j) with its record, filtered.
function pairs(st, people, pred) {
  const out = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const r = getRel(st, people[i], people[j]);
    if (r && fresh(st, r) && pred(r, people[i], people[j])) out.push([people[i], people[j], r]);
  }
  return out;
}

// ---------- who each card is about (the same pick for the weight and the card: no dice) ----------
const feudPair = (st, c) => pairs(st, c.people, (r) => !r.p && r.o <= BOND.feud).sort((x, y) => x[2].o - y[2].o || x[0].id - y[0].id)[0] || null;
function reconcilePair(st, c) {
  return pairs(st, c.people, (r) => !r.p && r.o <= BOND.disliked && r.h >= 12 && r.h - r.o >= 25).sort((x, y) => (y[2].h - y[2].o) - (x[2].h - x[2].o) || x[0].id - y[0].id)[0] || null;
}
function joinPick(st, c) {
  for (const [a, b] of pairs(st, c.people, (r) => r.p || r.o >= REL.friend)) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const job = jobOf(y);
      if (JOIN_JOBS.includes(job) && jobOf(x) !== job && !x.leader && x.mood >= 30 && !x.inBed) return { x, y, job };
    }
  }
  return null;
}
function lessonPick(st, c) {
  let best = null;
  for (const L of c.people) {
    if (L.apprentice || L.inBed) continue;
    for (const T of c.people) {
      if (T === L || T.inBed) continue;
      const r = getRel(st, L, T);
      if (!fresh(st, r) || (r && r.o <= BOND.disliked)) continue;
      for (const k of SKILLS) {
        const gap = skill(T, k) - skill(L, k);
        if (gap < TEACH_GAP + BOND_EV.lessonGap || (L.skills[k] || 0) >= SKILL_MAX) continue;
        const v = gap + (r ? r.o / 20 : 0);
        if (!best || v > best.v) best = { L, T, k, v };
      }
    }
  }
  return best;
}
function jealousyPick(st, c) {
  const leader = c.people.find((s) => s.leader);
  if (!leader) return null;
  const fav = c.people.filter((s) => s !== leader && (getRel(st, leader, s) || { o: 0 }).o >= REL.friend).sort((a, b) => getRel(st, leader, b).o - getRel(st, leader, a).o || a.id - b.id)[0];
  if (!fav) return null;
  const J = c.people.filter((s) => s !== leader && s !== fav && (getRel(st, s, leader) || { o: 0 }).o < BOND.friendly && (getRel(st, s, fav) || { o: 0 }).o <= 0 && fresh(st, getRel(st, s, fav))).sort((a, b) => (getRel(st, a, fav) || { o: 0 }).o - (getRel(st, b, fav) || { o: 0 }).o || a.id - b.id)[0];
  return J ? { leader, fav, J } : null;
}
const betrayalPair = (st, c) => {
  for (const [a, b] of pairs(st, c.people, (r) => !r.p && r.o >= REL.friend)) {
    for (const [x, y] of [[a, b], [b, a]]) if (!x.leader && (x.traits.includes("greedy") || x.mood < 35)) return { x, y };
  }
  return null;
};
function newcomerPick(st, c) {
  const d = day(st);
  return c.people.filter((s) => s.joined != null && s.joined > 1 && d - s.joined >= 1 && d - s.joined <= BOND_EV.newDays && !s.bondWelcomed).sort((a, b) => b.joined - a.joined || a.id - b.id)[0] || null;
}

// ---------- the cards ----------
export const BOND_EVENTS = {
  feud: {
    name: "A feud comes to blows",
    weight: (st, c) => { const p = feudPair(st, c); return p ? 0.8 * (1 + Math.min(1, (BOND.feud - p[2].o) / 30)) : 0; },
    card: (st, c) => {
      const [a, b] = feudPair(st, c);
      mark(st, a, b);
      const [x, y] = a.mood <= b.mood ? [a, b] : [b, a]; // the angrier one threw the first punch
      const med = mediatorFor(st, c.base, a, b);
      const other = st.bases.find((B) => B !== c.base && B.tile !== c.base.tile);
      const both = () => here(a, c.base) && here(b, c.base);
      const gone = "It is over: one of them is no longer here.";
      return {
        title: `A fistfight at ${c.base.name}`,
        text: `${x.name} and ${y.name} have hated each other for a while${because(st, a, b)}. Today ${first(x)} swung first, and now they are rolling in the dirt with half of ${c.base.name} watching.`,
        survivorIds: [a.id, b.id],
        choices: [
          {
            label: med ? `Mediate (${first(med.who)}, ${med.who.leader ? "leader" : "Speech"} ${med.score})` : "Mediate",
            hint: med ? `${pct(med.chance)}: they shake on it (much better between them, both mood +4); else both mood -4 and it festers` : "Nobody else here can talk them down",
            disabled: () => !med,
            ai: () => (med ? med.chance * 14 - (1 - med.chance) * 5 : -9),
            resolve: (s2) => {
              if (!both()) return gone;
              if (!med || !here(med.who, c.base)) return "Nobody here can talk them down."; // disabled then: an answer that took it anyway
              const ok = s2.rng.chance(med.chance);
              talkXp(s2, med.who, ok);
              bumpPair(s2, a, b, ok ? 20 : -6, ok ? `${first(med.who)} settled their feud` : "A fistfight nobody settled");
              for (const s of [a, b]) addMood(s2, s, ok ? 4 : -4, ok ? "Made peace after a fight" : "Still angry after a fight");
              return ok ? `${first(med.who)} pulls them apart and makes them talk. By evening ${first(x)} and ${first(y)} shake hands.` : `${first(med.who)} gets a split lip for the trouble. Nothing is settled.`;
            },
          },
          {
            label: "Punish them both (latrine duty for a week)",
            hint: "Both mood -6; a little better between them (shared misery); everyone else here +1 (order kept)",
            default: true, ai: () => 3,
            resolve: (s2) => {
              if (!both()) return gone;
              for (const s of [a, b]) addMood(s2, s, -6, "Punished for a fight");
              for (const s of atBase(s2, c.base.id)) if (s !== a && s !== b) addMood(s2, s, 1, "Order kept");
              bumpPair(s2, a, b, 5, "Dug latrines side by side");
              return `${first(x)} and ${first(y)} dig latrines together for a week. Grudgingly, they talk.`;
            },
          },
          {
            label: other ? `Separate them: ${first(x)} moves to ${other.name}` : "Separate them",
            hint: other ? `${first(x)} walks to ${other.name} with what they carry (mood -4); apart, the feud cools` : "You have no other base to send one of them to",
            disabled: () => !other || !here(x, c.base),
            ai: () => (other ? 4 : -9),
            resolve: (s2) => {
              if (!both()) return gone;
              const res = moveTeamOut(s2, { baseId: c.base.id, memberIds: [x.id], dest: other.tile });
              if (res.error) return `${first(x)} cannot leave now: ${res.error}`;
              addMood(s2, x, -4, `Sent away from ${c.base.name}`);
              return `${first(x)} packs a bag and sets out for ${other.name}.`;
            },
          },
          {
            label: "Let them have it out",
            hint: "One of them takes 4–12 health; the loser mood -6; 30% it clears the air, else it gets worse",
            ai: () => -4,
            resolve: (s2) => {
              if (!both()) return gone;
              const loser = s2.rng.pick([a, b]);
              const winner = loser === a ? b : a;
              hurt(s2, loser, s2.rng.int(4, 12), c.base.tile, `in a fistfight with ${first(winner)} at ${c.base.name}`, { raw: true });
              addMood(s2, loser, -6, `Beaten by ${first(winner)}`);
              const air = s2.rng.chance(0.3);
              bumpPair(s2, a, b, air ? 10 : -8, air ? "Fought it out and cleared the air" : `${first(winner)} beat ${first(loser)} in a fight`);
              return `${first(winner)} gets the better of it${loser.alive ? "" : `, and ${first(loser)} does not get up`}. ${air ? "Afterwards they share a cigarette." : "It is not over."}`;
            },
          },
        ],
      };
    },
  },

  reconcile: {
    name: "Burying the hatchet",
    weight: (st, c) => (reconcilePair(st, c) ? 0.5 : 0),
    card: (st, c) => {
      const [a, b, r] = reconcilePair(st, c);
      mark(st, a, b);
      const both = () => here(a, c.base) && here(b, c.base);
      const top = r.why && r.why.find((w) => w.v > 0);
      return {
        title: `${first(a)} and ${first(b)} make it up?`,
        text: `${a.name} and ${b.name} have been ${are(st, a, b)} for a long time, but something has shifted${top ? ` (${reasonText(st, top.t)})` : " after all they have been through"}. ${first(a)} is looking for a way to say sorry.`,
        survivorIds: [a.id, b.id],
        choices: [
          {
            label: "Share a bottle on it (2 food)", hint: "Much better between them; both mood +5",
            disabled: () => foodIn(c.base.stock) < 2, ai: () => (foodIn(c.base.stock) >= 20 ? 6 : 1),
            resolve: (s2) => {
              if (!both()) return "Too late: one of them is gone.";
              payFood(c.base, 2, s2);
              bumpPair(s2, a, b, 20, "Buried the hatchet over a bottle");
              for (const s of [a, b]) addMood(s2, s, 5, `Made it up with ${first(s === a ? b : a)}`);
              return `${first(a)} and ${first(b)} talk late into the night. It is a start.`;
            },
          },
          {
            label: "Let it come in its own time", hint: "A little better between them", default: true, ai: () => 2,
            resolve: (s2) => { if (!both()) return "Too late: one of them is gone."; bumpPair(s2, a, b, 8, "Started to make it up"); return `A nod in the morning, a cup of coffee passed over. It will take time.`; },
          },
        ],
      };
    },
  },

  join: {
    name: "A friend asks to work alongside",
    weight: (st, c) => (joinPick(st, c) ? 0.35 : 0),
    card: (st, c) => {
      const { x, y, job } = joinPick(st, c);
      mark(st, x, y);
      const both = () => here(x, c.base) && here(y, c.base);
      return {
        title: `${first(x)} asks to work with ${first(y)}`,
        text: `${x.name} and ${y.name} are ${are(st, x, y)}${because(st, x, y)}. ${first(x)} asks to join ${first(y)} on ${JOB_NAMES[job]}: "We work better together."`,
        survivorIds: [x.id, y.id],
        choices: [
          {
            label: `Yes: ${first(x)} on ${JOB_NAMES[job]}`,
            hint: `${isManaged(st, x) ? `${WORK_TYPES[job] ? WORK_TYPES[job].name : job} at priority 1 for ${first(x)}` : `${first(x)}'s role becomes ${first(y)}'s`}; both mood +4 and closer; friends on one job work and haul better`,
            ai: () => 3,
            resolve: (s2) => {
              if (!both()) return "Too late.";
              if (isManaged(s2, x)) setCell(s2, x, job, 1); // work.js: their own cell, as the Work tab sets it
              else { x.role = job; x.station = null; }
              for (const s of [x, y]) addMood(s2, s, 4, "Working together");
              bumpPair(s2, x, y, 4, `${first(x)} asked to work with ${first(y)}`);
              return `${first(x)} joins ${first(y)} on ${JOB_NAMES[job]}.`;
            },
          },
          { label: "Not now", hint: `${first(x)} mood -3`, default: true, ai: () => 0, resolve: (s2) => { if (here(x, c.base)) addMood(s2, x, -3, "Asked to work with a friend: no"); return `${first(x)} shrugs and goes back to work.`; } },
        ],
      };
    },
  },

  apprentice: {
    name: "An apprentice asks to be taught",
    weight: (st, c) => (lessonPick(st, c) ? 0.4 : 0),
    card: (st, c) => {
      const { L, T, k } = lessonPick(st, c);
      mark(st, L, T);
      const A = BOND.apprentice;
      const both = () => here(L, c.base) && here(T, c.base);
      return {
        title: `${first(L)} asks ${first(T)} to teach them`,
        text: `${L.name} (${SKILL_NAMES[k]} ${skill(L, k)}) has been watching ${T.name} (${SKILL_NAMES[k]} ${skill(T, k)}) work and asks to learn. They are ${are(st, L, T)}${because(st, L, T)}.`,
        survivorIds: [L.id, T.id],
        choices: [
          {
            label: `Yes: evening lessons in ${SKILL_NAMES[k]} for ${A.days} days`,
            hint: `${first(L)} gains ${A.xp} + ${A.per} × ${first(T)}'s ${SKILL_NAMES[k]} study XP a day (faster if they are friends); both keep their jobs; both mood +3 and closer`,
            ai: () => 4,
            resolve: (s2) => {
              if (!both()) return "Too late.";
              L.apprentice = { tid: T.id, skill: k, until: day(s2) + A.days };
              for (const s of [L, T]) addMood(s2, s, 3, "Master and apprentice");
              bumpPair(s2, L, T, 6, `${first(T)} took ${first(L)} on as an apprentice`);
              return `${first(T)} agrees. Every evening by the fire, ${first(L)} learns.`;
            },
          },
          { label: "Not now", hint: `${first(L)} mood -2`, default: true, ai: () => 0, resolve: (s2) => { if (here(L, c.base)) addMood(s2, L, -2, "No lessons"); return `${first(T)} has no time for it now.`; } },
        ],
      };
    },
  },

  jealousy: {
    name: "Jealousy over the leader's favour",
    weight: (st, c) => (jealousyPick(st, c) ? 0.35 : 0),
    card: (st, c) => {
      const { leader, fav, J } = jealousyPick(st, c);
      mark(st, J, fav);
      const chance = Math.max(0.3, Math.min(0.95, 0.3 + 0.035 * Math.max(skill(leader, "speech"), skill(leader, "leadership"))));
      const live = () => here(J, c.base) && here(leader, c.base);
      return {
        title: `${first(J)} says ${first(leader)} plays favourites`,
        text: `${J.name} has had enough of watching ${fav.name} get the easy jobs and ${first(leader)}'s ear. ${first(leader)} and ${first(fav)} are ${are(st, leader, fav)}${because(st, leader, fav)}; ${first(J)} and ${first(fav)} are ${are(st, J, fav)}.`,
        survivorIds: [J.id, fav.id, leader.id],
        choices: [
          {
            label: `${first(leader)} sits down with ${first(J)}`,
            hint: `${pct(chance)}: ${first(J)} thinks better of ${first(leader)}, mood +5; else worse, mood -3`,
            ai: () => chance * 9 - (1 - chance) * 4,
            resolve: (s2) => {
              if (!live()) return "Too late.";
              const ok = s2.rng.chance(chance);
              talkXp(s2, leader, ok);
              bumpPair(s2, J, leader, ok ? 12 : -4, ok ? `${first(leader)} heard ${first(J)} out` : `${first(leader)} brushed ${first(J)} off`);
              addMood(s2, J, ok ? 5 : -3, ok ? "Heard out by the leader" : "Brushed off by the leader");
              return ok ? `${first(leader)} listens, and gives ${first(J)} a fair hearing.` : `It turns into an argument. ${first(J)} storms off.`;
            },
          },
          {
            label: `Give ${first(J)} a say in the work plan`,
            hint: `${first(J)} mood +6 and warmer to ${first(leader)}; ${first(fav)} mood -2`,
            default: true, ai: () => 3,
            resolve: (s2) => {
              if (!live()) return "Too late.";
              addMood(s2, J, 6, "Given a say");
              addMood(s2, fav, -2, `${first(J)} given a say`);
              bumpPair(s2, J, leader, 6, `${first(leader)} gave ${first(J)} a say`);
              return `${first(J)} gets a seat at the morning meeting. It helps.`;
            },
          },
          {
            label: "Dismiss it",
            hint: `${first(J)} mood -6, colder to ${first(leader)} and to ${first(fav)}`,
            ai: () => -3,
            resolve: (s2) => {
              if (!live()) return "Too late.";
              addMood(s2, J, -6, "Dismissed by the leader");
              bumpPair(s2, J, fav, -8, `Jealous of ${first(fav)}`);
              bumpPair(s2, J, leader, -6, `${first(leader)} plays favourites`);
              return `${first(J)} says nothing more about it. They do not forget.`;
            },
          },
        ],
      };
    },
  },

  betrayal: {
    name: "Stealing from a friend",
    weight: (st, c) => (betrayalPair(st, c) ? 0.25 : 0),
    card: (st, c) => {
      const { x, y } = betrayalPair(st, c);
      mark(st, x, y);
      const thing = BOND_EV.theft[(x.id * 7 + y.id * 3 + day(st)) % BOND_EV.theft.length];
      const both = () => here(x, c.base) && here(y, c.base);
      return {
        title: `${first(x)} stole from ${first(y)}`,
        text: `${y.name} found something of theirs in ${x.name}'s bunk: ${thing}. They were ${are(st, x, y)}${because(st, x, y)}${x.traits.includes("greedy") ? `; ${first(x)} always did want more than their share` : `; ${first(x)} has not been themselves lately (mood ${Math.round(x.mood)})`}.`,
        survivorIds: [x.id, y.id],
        choices: [
          {
            label: `${first(x)} gives it back and says sorry`, hint: `Worse between them; ${first(x)} mood -3`,
            default: true, ai: () => 2,
            resolve: (s2) => { if (!both()) return "Too late."; bumpPair(s2, x, y, -10, `${first(x)} stole from ${first(y)}`); addMood(s2, x, -3, "Caught stealing"); return `${first(x)} hands it back without meeting ${first(y)}'s eyes.`; },
          },
          {
            label: `Punish ${first(x)} in front of everyone`, hint: `${first(x)} mood -10; worse between them; everyone else here +1`,
            ai: () => 0,
            resolve: (s2) => {
              if (!both()) return "Too late.";
              addMood(s2, x, -10, "Punished for stealing");
              bumpPair(s2, x, y, -6, `${first(x)} stole from ${first(y)}`);
              for (const s of atBase(s2, c.base.id)) if (s !== x) addMood(s2, s, 1, "A thief punished");
              return `${first(x)} stands in the yard while everyone hears what they did.`;
            },
          },
          {
            label: "Let them settle it", hint: `Much worse between them; 30% ${first(y)} hits ${first(x)} (3–8 health)`,
            ai: () => -3,
            resolve: (s2) => {
              if (!both()) return "Too late.";
              bumpPair(s2, x, y, -18, `${first(x)} stole from ${first(y)}`);
              if (s2.rng.chance(0.3)) { hurt(s2, x, s2.rng.int(3, 8), c.base.tile, `hit by ${first(y)} at ${c.base.name}`, { raw: true }); return `${first(y)} hits ${first(x)} once, hard. Then walks away.`; }
              return `${first(y)} takes it back and does not speak to ${first(x)} again.`;
            },
          },
        ],
      };
    },
  },

  newcomer: {
    name: "A new face",
    weight: (st, c) => (c.n >= 3 && newcomerPick(st, c) ? 0.45 * (cliquesAt(st, c.base).length ? 1.5 : 1) : 0),
    card: (st, c) => {
      const N = newcomerPick(st, c);
      N.bondWelcomed = true;
      const guide = c.people.filter((s) => s !== N).sort((a, b) => temper(st, b) + skill(b, "speech") / 40 - (temper(st, a) + skill(a, "speech") / 40) || a.id - b.id)[0];
      const circle = cliquesAt(st, c.base)[0] || null;
      const circleNames = circle ? circle.map((id) => c.people.find((s) => s.id === id)).filter(Boolean).slice(0, 3).map(first) : [];
      const live = () => here(N, c.base);
      return {
        title: `A new face at ${c.base.name}: ${first(N)}`,
        text: `${N.name} came to ${c.base.name} on day ${N.joined} and still eats alone.${circle ? ` ${circleNames.join(", ")} and their circle have not made room for them.` : ""}`,
        survivorIds: [N.id],
        choices: [
          {
            label: "A welcome supper (2 food)", hint: `${first(N)} mood +8 and warmer with everyone here`,
            disabled: () => foodIn(c.base.stock) < 2, ai: () => (foodIn(c.base.stock) >= 20 ? 5 : 1),
            resolve: (s2) => {
              if (!live()) return "Too late.";
              payFood(c.base, 2, s2);
              addMood(s2, N, 8, "A welcome supper");
              for (const s of atBase(s2, c.base.id)) if (s !== N) bumpPair(s2, N, s, 6, `A welcome supper for ${first(N)}`);
              addMoment(s2, N, `Welcomed to ${c.base.name} with a supper, day ${day(s2)}`);
              return `Toasts to ${first(N)}. For the first time they laugh.`;
            },
          },
          ...(guide ? [{
            label: `Ask ${first(guide)} to show them the ropes`, hint: `${first(N)} and ${first(guide)} closer; both mood +3`,
            ai: () => 3,
            resolve: (s2) => {
              if (!live() || !here(guide, c.base)) return "Too late.";
              bumpPair(s2, N, guide, 14, `${first(guide)} showed ${first(N)} the ropes`);
              for (const s of [N, guide]) addMood(s2, s, 3, "Showing a newcomer around");
              return `${first(guide)} takes ${first(N)} round the walls and the stores and introduces them to everyone.`;
            },
          }] : []),
          {
            label: "Leave them to find their feet",
            hint: circle ? `${first(N)} mood -5 and colder with ${circleNames.join(", ")}'s circle` : `${first(N)} mood -2`,
            default: true, ai: () => -1,
            resolve: (s2) => {
              if (!live()) return "Too late.";
              if (circle) {
                addMood(s2, N, -5, "Shunned");
                for (const id of circle) { const o = atBase(s2, c.base.id).find((s) => s.id === id); if (o) bumpPair(s2, N, o, -5, `${first(o)}'s circle shunned ${first(N)}`); }
                log(s2, `${N.name} is being frozen out at ${c.base.name}.`, "info");
                return `${first(N)} keeps to themselves. The circle keeps to itself.`;
              }
              addMood(s2, N, -2, "Left to find their feet");
              return `${first(N)} will find their place, or not.`;
            },
          },
        ],
      };
    },
  },
};
