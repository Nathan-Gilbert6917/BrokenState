// @ts-check
// Disease (the user's request 2026-10-21: "Add disease, and other sickness system events that need to be treated
// with rest and meds. More people higher chances of sicknesses as well as new additions to a base"): on top of
// health.js (its conditions, courses of meds and contagion) and sickrest.js (the ill rest until it is gone).
//
// Two more illnesses (health.js CONDITIONS), both a course of at least two doses (minCourse), both resting:
//   campfever   camp fever: lice and filth in packed bunks. Catching, climbs CONDITIONS.rise for its first days, and
//               untreated drags on for weeks (rest alone barely holds it) and kills the weak;
//   woundfever  wound fever: an infected wound gone into the blood. Not catching; climbs, costs the most health of
//               anything but pneumonia and kills without meds; a hospital bed helps most.
//
// The chances (diseaseRisk, added to health.js illnessRisk: × the Sickness dial, frailty and a hospital like the rest;
// rolled on hash dice so the world's dice run as before), a person a day:
//   headcount   at a base the everyday chances (health.js's cold going round, flu season, camp fever) × headMult:
//               1 + HEAD.per a head past HEAD.free, at most HEAD.cap (10 people ×1.16, 20 ×1.56, 30 ×1.96);
//   flu season  FLU.winter in winter, FLU.edge in late autumn and early spring (winter.js frostPhase), × headMult;
//   camp fever  CAMP.base × headMult × (1 + CAMP.crowd × how far past the beds: morale.js crowding), at most CAMP.cap;
//   wound fever WOUND.fever while a wound is infected (medical.js woundInfected), at a base or on a team.
//
// Newcomers (newcomersDaily, from health.js healthDaily): each person who comes to live at one of your bases (a
// recruit, refugees, a walker arriving, a prisoner turned, a deserter back, someone moved in from another of your
// bases or a team ending its trip at another base; births aside) may carry something in: CARRY.outside (CARRY.moved
// from another of your bases) × the Sickness dial. What they carry (CARRY.mix by the season: flu, camp fever, a chest
// cold, dysentery) shows CARRY.incubate days later (s.incubating = { key, day, from }) and then spreads like any case.
// Who lives where is s.sickHome (the base they were last counted at); the first pass in a world (state.sickHomes
// unset: new worlds and old saves) only notes it, so nobody already there counts as new.
//
// Cards (hubevents.js, the hub's decisions; the text and the choices here):
//   flu season   (winter and its edges, someone catching at the hub): keep the sick apart (QUAR days of quarantine),
//                dose the catching ones now, or wait (FLU_CARD.spread: 1–3 more come down with it);
//   bad water    the barrels gone foul: boil it all for a week (BAD_WATER.wood a head), dump it (BAD_WATER.dump of the
//                water), or drink it (BAD_WATER.sick each: dysentery);
//   a coughing stranger  a recruit card (recruits.js) for someone visibly ill: take them in (they bring it), take them
//                in and keep them apart (QUAR days of quarantine), or the card's other answers.
//
// AI parity (docs/adr/0001-ai-parity.md; groupcare.js illDaily, coarse as the groups' ill are): their daily rate ×
// groupSickMult (the same headMult by people a base, against HEAD.ref, the size their rate was measured at; flu
// season; the Sickness dial); newcomers (the head count risen since yesterday, f.sickSeen) bring CARRY.outside each
// into their ill; their ill are dosed from their own meds (GROUP_SICK.meds a head a day): dosed they mend
// GROUP_SICK.mend faster, untreated GROUP_SICK.die of them a day die (members.js removeMember: the weakest at home).
import { log, day, alive, residents, atBase, baseById, localId } from "./world.js";
import { CONDITIONS, conditionsOf, isContagious, isIll, addCondition, needsDose, treatConditionInfo, applyCondition } from "./health.js";
import { crowding } from "./morale.js";
import { hash01 } from "./skills.js";
import { frostPhase } from "./winter.js";
import { season, dayIndex } from "./weather.js";
import { cfgOf } from "./worldcfg.js"; // the run's dials: Sickness
import { waterIn, drawWater } from "./water.js";
import { makeCandidate, recruitCard } from "./recruits.js";
import { homeMembers, removeMember } from "./members.js";

export const HEAD = { free: 6, per: 0.04, cap: 2.2, ref: 12 };
export const FLU = { winter: 0.002, edge: 0.001 };
export const CAMP = { base: 0.0008, crowd: 4, cap: 0.02 };
export const WOUND = { fever: 0.04 };
export const CARRY = {
  outside: 0.12, moved: 0.04, incubate: [2, 5],
  mix: { winter: { flu: 4, campfever: 2, chestcold: 3, dysentery: 1 }, other: { flu: 1, campfever: 2, chestcold: 2, dysentery: 2 } },
};
export const QUAR = 7;
const AWAY = -1; // s.sickHome of someone in the group, away from every base on the first pass
export const FLU_CARD = { spread: 0.5, most: 3 };
export const BAD_WATER = { wood: 20, dump: 0.4, sick: 0.3 };
export const GROUP_SICK = { meds: 0.2, mend: 0.05, die: 0.004 };

const first = (s) => s.name.split(" ")[0];
const names = (list) => (list.length <= 1 ? list.map(first).join("") : `${list.slice(0, -1).map(first).join(", ")} and ${first(list[list.length - 1])}`);
const dice = (state, ...k) => hash01(state.seed, "disease", ...k);

// × on the everyday chances for n people living together.
/** @param {number} n */
export const headMult = (n) => Math.min(HEAD.cap, 1 + HEAD.per * Math.max(0, n - HEAD.free));

// ---------- the chances (health.js illnessRisk) ----------
// add(key, p, cause, why, guarded) is illnessRisk's: it returns the part (or null), which is marked for hash dice.
export function diseaseRisk(state, s, ctx, add) {
  const parts = [];
  const push = (x) => { if (x) { x.hash = true; parts.push(x); } };
  const head = ctx.head || 1;
  const ph = frostPhase(dayIndex(state));
  if (ph && !conditionsOf(s).some((c) => c.key === "flu")) push(add("flu", (ph === "winter" ? FLU.winter : FLU.edge) * head, "season", `in the flu season ${ctx.where}`));
  if (ctx.kind === "base") {
    const over = ctx.crowd || 0;
    push(add("campfever", Math.min(CAMP.cap, CAMP.base * head * (1 + CAMP.crowd * over)), "crowding", `from the lice in the ${over > 0 ? "packed " : ""}bunks ${ctx.where}`));
  }
  if (s.woundInfected) push(add("woundfever", WOUND.fever, "wound", `from an infected wound ${ctx.where}`));
  return parts;
}
// Today's dice for a part (health.js rollOnset): the seed, the person, the day and the illness.
export const diseaseDice = (state, s, key) => dice(state, "onset", key, localId(state, s.id), day(state));

// ---------- newcomers ----------
// A day's pass (health.js healthDaily, before the new cases): incubations that show today, then who is new where.
export function newcomersDaily(state) {
  const d = day(state);
  for (const s of alive(state)) {
    const inc = s.incubating;
    if (!inc || inc.day > d) continue;
    delete s.incubating;
    if (CONDITIONS[inc.key]) addCondition(state, s, inc.key, `carried in ${inc.from || "from the road"}`, { cause: "newcomer" });
  }
  const init = !!state.sickHomes;
  state.sickHomes = true;
  // The first pass: everyone already in the group is known, those away too (AWAY: home again, they bring nothing).
  if (!init) for (const s of alive(state)) if (s.sickHome == null) s.sickHome = s.location.kind === "base" ? s.location.baseId : AWAY;
  const mult = cfgOf(state, "sickness");
  for (const base of state.bases) {
    for (const s of atBase(state, base.id)) {
      if (s.sickHome === base.id) continue;
      const was = s.sickHome;
      s.sickHome = base.id;
      if (!init || was === AWAY || (was == null && s.born != null) || s.incubating || isIll(s)) continue; // the first pass; known from it; a birth; already carrying
      const from = was != null ? baseById(state, was) : null;
      const p = (was != null ? CARRY.moved : CARRY.outside) * mult;
      if (!(dice(state, "carry", localId(state, s.id), base.id, d) < p)) continue;
      const mix = CARRY.mix[season(state).key === "winter" ? "winter" : "other"];
      const keys = Object.keys(mix), total = keys.reduce((a, k) => a + mix[k], 0);
      let r = dice(state, "carrykind", localId(state, s.id), d) * total, key = keys[0];
      for (const k of keys) { r -= mix[k]; if (r < 0) { key = k; break; } }
      const [lo, hi] = CARRY.incubate;
      s.incubating = { key, day: d + lo + Math.floor(dice(state, "incubate", localId(state, s.id), d) * (hi - lo + 1)), from: from ? `from ${from.name}` : "from the road" };
    }
  }
}
// Someone carrying something that has not shown yet.
export const incubating = (s) => !!(s && s.incubating && CONDITIONS[s.incubating.key]);

// ---------- cards (hubevents.js) ----------
const catching = (state, base) => residents(state, base.id).filter((s) => s.location.kind === "base" && isContagious(s));
const quarantined = (state, base) => (base.quarantineUntil || 0) >= day(state);
const quarantine = (state, base, days = QUAR) => { base.quarantineUntil = Math.max(base.quarantineUntil || 0, day(state) + days); };
const moodAll = (list, v) => { for (const s of list) s.mood = Math.max(0, Math.min(100, s.mood + v)); };

// Flu season: someone at the hub is catching, in winter or at its edges, and no quarantine is on.
export function fluSeasonWeight(state, c) {
  if (c.n < 4 || !frostPhase(dayIndex(state)) || quarantined(state, c.base)) return 0;
  const sick = catching(state, c.base).length;
  if (!sick || sick >= 3) return 0; // three or more: health.js's outbreak card
  return 0.6 * (c.season === "winter" ? 1.5 : 1) * headMult(c.n);
}
export function fluSeasonCard(state, c) {
  const base = c.base, baseId = base.id;
  const sick = catching(state, base);
  const what = [...new Set(sick.flatMap((s) => conditionsOf(s).filter((x) => CONDITIONS[x.key] && CONDITIONS[x.key].spread).map((x) => CONDITIONS[x.key].name.toLowerCase())))].join(" and ") || "a fever";
  const doses = () => { const b = baseById(state, baseId); return b ? catching(state, b).reduce((a, s) => a + conditionsOf(s).filter((x) => CONDITIONS[x.key].spread && needsDose(x)).length, 0) : 0; };
  return {
    title: `Flu season at ${base.name}`,
    text: `${names(sick)} ${sick.length === 1 ? "has" : "have"} ${what}, and the coughing is spreading through ${base.name}. With ${c.n} people under one roof in the cold it will go round unless something is done.`,
    choices: [
      {
        label: `Keep the sick apart (${QUAR} days)`, hint: `The catching ones do not work while it lasts and it spreads 60% less; everyone here mood −1 (cramped and anxious)`,
        ai: () => (c.n >= 12 ? 7 : 5),
        resolve: (st) => { const b = baseById(st, baseId); if (!b) return "That base is gone."; quarantine(st, b); moodAll(atBase(st, b.id), -1); return `The sick at ${b.name} are kept apart for ${QUAR} days.`; },
      },
      {
        label: "Dose the sick now", get hint() { const b = baseById(state, baseId); return `A dose each today for the catching ones (${doses()} doses, 1 meds each; have ${b ? Math.floor(b.stock.meds || 0) : 0}): it stops them worsening, and once on the mend they barely spread it`; },
        disabled: (st) => { const b = baseById(st, baseId); return !b || (b.stock.meds || 0) < 1 || !doses(); },
        ai: () => ((base.stock.meds || 0) >= 3 * Math.max(1, doses()) ? 6 : 1),
        resolve: (st) => {
          const b = baseById(st, baseId);
          if (!b) return "That base is gone.";
          let used = 0;
          for (const s of catching(st, b)) for (const x of [...conditionsOf(s)]) {
            if (!CONDITIONS[x.key].spread) continue;
            const info = treatConditionInfo(st, b, s, x.key);
            if (!info.ok) continue;
            applyCondition(st, b, s, x.key, info);
            used += info.cost;
          }
          return used ? `The sick at ${b.name} get their doses (${used} meds).` : "There were not enough meds or medic time to dose anyone.";
        },
      },
      {
        label: "Wait and see", hint: `No cost now; ${Math.round(FLU_CARD.spread * 100)}% it goes round: 1–${FLU_CARD.most} more come down with flu`,
        ai: () => -3,
        resolve: (st) => {
          const b = baseById(st, baseId);
          if (!b || !st.rng.chance(FLU_CARD.spread)) return "The coughing dies down on its own. This time.";
          const well = atBase(st, b.id).filter((s) => !isIll(s));
          const hit = [];
          for (let i = 0, n = st.rng.int(1, FLU_CARD.most); i < n && well.length; i++) {
            const s = well.splice(st.rng.int(0, well.length - 1), 1)[0];
            if (addCondition(st, s, "flu", `as it went round ${b.name}`, { cause: "contagion", quiet: true, from: sick[0] })) hit.push(s);
          }
          return hit.length ? `It goes round: ${names(hit)} ${hit.length === 1 ? "is" : "are"} down with flu now.` : "The coughing dies down on its own.";
        },
      },
    ],
  };
}

// Bad water: any time there are people and water to spoil (likelier in the heat, rarer in the frost).
export function badWaterWeight(state, c) {
  if (c.n < 3 || waterIn(c.base.stock) < 10) return 0;
  return 0.3 * ({ summer: 1.6, winter: 0.5 }[c.season] || 1) * (["heat", "drought"].includes(c.wx) ? 1.5 : 1);
}
export function badWaterCard(state, c) {
  const base = c.base, baseId = base.id;
  const wood = () => BAD_WATER.wood * atBase(state, baseId).length;
  const dump = () => Math.max(1, Math.round(waterIn(base.stock) * BAD_WATER.dump));
  return {
    title: `Bad water at ${base.name}`,
    text: `Something has got into the water at ${base.name}: the barrels smell of the drain and the first cups have people doubled up. Dysentery goes through a base that keeps drinking it.`,
    choices: [
      {
        label: `Boil every drop for a week (${wood()} wood)`, hint: "Nobody falls ill; the wood goes on the fires",
        disabled: (st) => (base.stock.wood || 0) < wood(), ai: () => ((base.stock.wood || 0) >= 3 * wood() ? 7 : 2),
        resolve: () => { base.stock.wood = Math.max(0, (base.stock.wood || 0) - wood()); return "A week of boiling pots. Nobody else falls ill."; },
      },
      {
        label: `Dump the bad water (${dump()} water)`, hint: "Nobody falls ill; the water is lost",
        disabled: () => waterIn(base.stock) < 1, ai: () => (waterIn(base.stock) >= 4 * Math.max(1, c.n) ? 5 : 0),
        resolve: () => { const got = drawWater(base.stock, dump(), { rawFirst: true }).got; return `${Math.round(got)} water poured away and the barrels scrubbed out.`; },
      },
      {
        label: "Drink it anyway", hint: `No cost; each person here ${Math.round(BAD_WATER.sick * 100)}% dysentery`,
        ai: () => -4,
        resolve: (st) => {
          const hit = atBase(st, baseId).filter((s) => st.rng.chance(BAD_WATER.sick) && addCondition(st, s, "dysentery", `from the bad water at ${base.name}`, { cause: "water", quiet: true }));
          return hit.length ? `${names(hit)} ${hit.length === 1 ? "is" : "are"} down with dysentery.` : "Strong stomachs: nobody falls ill.";
        },
      },
    ],
  };
}

// A coughing stranger at the gate: a recruit card (recruits.js) for someone already ill with something catching.
export function coughWeight(state, c) {
  return c.n >= 2 ? 0.3 * (c.season === "winter" ? 1.6 : 1) : 0;
}
export function coughCard(state, c) {
  const base = c.base, baseId = base.id;
  const s = makeCandidate(state, { quality: 0.85, minHealth: 45, gearChance: 0.3 });
  const key = state.rng.pick(c.season === "winter" ? ["flu", "flu", "chestcold", "campfever"] : ["flu", "chestcold", "campfever"]);
  const d = CONDITIONS[key];
  s.conditions = [{ key, sev: state.rng.int(d.sev[0], d.sev[1]), days: 1, since: day(state), why: "on the road", treatedDay: -99, course: null, dosed: 0, mending: false, cause: "newcomer" }];
  const card = recruitCard(state, [s], {
    source: "cough", baseId, title: "A coughing stranger at the gate",
    intro: `${s.name} asks to stay at ${base.name}, hacking into a sleeve between words: ${d.name.toLowerCase()}, by the look of it, and catching. They swear it is nothing.`,
  });
  const take = card.choices.find((x) => x.kind === "take");
  if (take) {
    take.hint = `${take.hint}: they bring the ${d.name.toLowerCase()} in with them`;
    card.choices.splice(card.choices.indexOf(take), 0, {
      ...take,
      label: `Take ${first(s)} in, kept apart (${QUAR} days)`,
      hint: `${first(s)} joins; for ${QUAR} days the catching ones do not work and it spreads 60% less`,
      resolve: (st) => {
        const out = take.resolve(st);
        const b = baseById(st, baseId);
        if (b && !s.pending && s.location && s.location.kind === "base") { quarantine(st, b); return `${out} They sleep apart until the cough is gone.`; }
        return out;
      },
    });
  }
  return card;
}

// ---------- AI parity (groupcare.js illDaily) ----------
// × on a group's daily rate of falling ill: headcount (people a base, against HEAD.ref), flu season, the dial.
export function groupSickMult(state, f, baseRate) {
  const per = (f.pop || 0) / Math.max(1, (f.bases || []).length);
  const ph = frostPhase(dayIndex(state));
  const flu = ph ? (ph === "winter" ? FLU.winter : FLU.edge) * headMult(per) : 0;
  return (headMult(per) / headMult(HEAD.ref) + flu / Math.max(1e-6, baseRate)) * cfgOf(state, "sickness");
}
// Today's care for a group's ill: meds spent, the extra share mended, the dead (people removed). Returns
// { mend, died, carried } (carried: new ill brought in by newcomers since yesterday).
export function groupIllCare(state, f, ill) {
  const out = { mend: 0, died: 0, carried: 0 };
  const pop = f.pop || 0;
  if (Number.isFinite(f.sickSeen) && pop > f.sickSeen) out.carried = (pop - f.sickSeen) * CARRY.outside * cfgOf(state, "sickness");
  if (ill > 0) {
    const need = ill * GROUP_SICK.meds;
    const have = Math.max(0, (f.stock && f.stock.meds) || 0);
    const share = Math.min(1, have / need);
    if (share > 0) { f.stock.meds = have - need * share; f.medsUsed = (f.medsUsed || 0) + need * share; }
    out.mend = GROUP_SICK.mend * share;
    const dead = Math.min(Math.floor(ill), Math.floor(ill * (1 - share) * GROUP_SICK.die + dice(state, "groupdie", f.name, f.careTick || 0, day(state))));
    for (let i = 0; i < dead; i++) {
      const list = Array.isArray(f.people) ? homeMembers(f).filter((s) => s.alive).sort((a, b) => a.health - b.health || a.id - b.id) : [];
      if (list.length) removeMember(state, f, list[0], "died", { keepKit: true });
      else if (!Array.isArray(f.people)) f.pop = Math.max(0, (f.pop || 0) - 1);
      else break;
      out.died++;
    }
    if (out.died) {
      f.diedOfIllness = (f.diedOfIllness || 0) + out.died;
      if (f.known) log(state, `Word on the radio: ${f.name} lost ${out.died === 1 ? "one of their people" : `${out.died} of their people`} to sickness (no meds).`, "info");
    }
  }
  f.sickSeen = f.pop || 0;
  return out;
}
