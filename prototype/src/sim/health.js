// Illness and work injuries: named conditions people pick up from what they do, that cost meds to treat.
// A condition has a severity (0-100). Each day it gets better or worse (drift), costs health while it lasts
// (hp at severity 100, raw damage), cuts how much the person can work, may spread to others at a crowded base,
// and may turn into something worse. Rest, a hospital bed and a good medic speed recovery; a treatment (meds)
// knocks the severity down and stops it worsening for a day.
// Infected wounds stay the woundInfected flag of medical.js (shown as "Infected wound"); an untreated deep cut can
// become one. Where people get sick or hurt (chances per person per day unless noted):
//   - work at a base: farming 0.6%, building 1.2%, crafting 0.8%, workshop 0.6%, base scavenging 2%, guard 0.2%
//     (cuts and sprains);
//   - searching a site: 0.8% a cut and 0.25% a fever per person per search hour (scavenge.js);
//   - wounds: a hit of 10+ health that does not kill: 25% a deep cut that needs dressing (world.hurt);
//   - weather: weather.exposureRisk per day outdoors (teams on the road in full, farmers, scavengers, guards and
//     builders at 60%, everyone else indoors at a quarter of half): cold brings flu (pneumonia on top of flu), heat
//     a fever;
//   - hunger or thirst at a base: 6% a day (fever when hungry, dysentery when thirsty); a team out of food or water 4%;
//   - dirty water: 0.4% dysentery a day at a base with no water filter (0.1% with one, x3 while thirsty);
//   - crowding: more people than beds, flu 0.2% + 1% x overcrowding (up to 3%);
//   - contagion: each contagious case at a base passes it on with its own chance per person (x1.6 crowded,
//     x0.4 in quarantine); medics catch it half again as often (treating the sick).
import { log, addCard, alive, atBase, residents, skill, hurt, day, baseById } from "./world.js";
import { activeHospital } from "./medical.js";
import * as Weather from "./weather.js";
import { GEAR } from "./data.js";
import { count, baseBeds } from "./buildings.js";

// sev = starting severity [min, max]; drift = change per day untreated (before rest and care);
// hp = health lost per day at severity 100; work = how much they can work at severity 100 (1 = fully);
// meds / treat = meds per treatment and the severity it takes off (x the hospital's meds effect);
// spread = chance per day to pass it to each other person at the base; turns = [condition, chance per day, when].
export const CONDITIONS = {
  cut:       { name: "Deep cut",   kind: "injury",  sev: [20, 45], drift: -4, hp: 0,  work: 0.75, meds: 1, treat: 100, spread: 0,
               desc: "A deep gash that needs cleaning and dressing. Untreated it can get infected (3% a day)." },
  sprain:    { name: "Sprain",     kind: "injury",  sev: [30, 60], drift: -5, hp: 0,  work: 0.35, meds: 1, treat: 40, spread: 0,
               desc: "A twisted ankle or wrist: barely able to work until it heals. A splint and painkillers help." },
  fever:     { name: "Fever",      kind: "illness", sev: [25, 50], drift: 1,  hp: 6,  work: 0.3,  meds: 1, treat: 45, spread: 0,
               desc: "Burning up: weak and sweating. It can turn into pneumonia if it runs high (3% a day above 60)." },
  flu:       { name: "Flu",        kind: "illness", sev: [30, 55], drift: -3, hp: 4,  work: 0.3,  meds: 1, treat: 35, spread: 0.035,
               desc: "Catching, and spreads fast in a crowded base. Gets worse for the first days. In the cold it can become pneumonia." },
  dysentery: { name: "Dysentery",  kind: "illness", sev: [30, 60], drift: 1,  hp: 8,  work: 0.2,  meds: 2, treat: 50, spread: 0.015, thirst: 1,
               desc: "From dirty water or food. Drains health and water (+1 water a day). A water filter makes it rarer." },
  pneumonia: { name: "Pneumonia",  kind: "illness", sev: [50, 75], drift: 4,  hp: 12, work: 0,    meds: 2, treat: 30, spread: 0.01,
               desc: "Fluid in the lungs: cannot work, and it kills without meds. A hospital bed helps a lot." },
};
export const CONDITION_KEYS = Object.keys(CONDITIONS);

const r1 = (v) => Math.round(v * 10) / 10;
const first = (s) => s.name.split(" ")[0];
export const conditionsOf = (s) => (s && Array.isArray(s.conditions) ? s.conditions : []);
export const isSick = (s) => !!s && s.alive && conditionsOf(s).length > 0;
export const isContagious = (s) => conditionsOf(s).some((c) => CONDITIONS[c.key] && CONDITIONS[c.key].spread > 0);
export const hasCondition = (s, key) => conditionsOf(s).some((c) => c.key === key);

// How much someone can work (0..1): the worst of their conditions, by severity; nothing while quarantined.
export function workFactor(s) {
  if (!s) return 1;
  const list = conditionsOf(s);
  if (!list.length) return 1;
  if (s.quarantined && isContagious(s)) return 0;
  let f = 1;
  for (const c of list) {
    const d = CONDITIONS[c.key];
    if (!d) continue;
    f = Math.min(f, 1 - (1 - d.work) * Math.min(1, Math.max(0.3, c.sev / 100) + 0.2));
  }
  return Math.max(0, Math.round(f * 100) / 100);
}

// Gives someone a condition (or makes the one they have worse). Returns the condition, or null.
export function addCondition(state, s, key, why = "", opts = {}) {
  const d = CONDITIONS[key];
  if (!d || !s || !s.alive) return null;
  if (!Array.isArray(s.conditions)) s.conditions = [];
  const sev = opts.sev ?? state.rng.int(d.sev[0], d.sev[1]);
  const have = s.conditions.find((c) => c.key === key);
  if (have) {
    have.sev = Math.min(100, have.sev + sev * 0.4);
    return have;
  }
  const c = { key, sev, days: 0, since: day(state), why, treatedDay: -99 };
  s.conditions.push(c);
  if (!opts.quiet) log(state, `${s.name} ${d.kind === "injury" ? "got" : "came down with"} ${d.kind === "injury" ? `a ${d.name.toLowerCase()}` : d.name.toLowerCase()}${why ? ` ${why}` : ""}.`, "danger");
  return c;
}

export function removeCondition(s, key) {
  if (!Array.isArray(s.conditions)) return;
  s.conditions = s.conditions.filter((c) => c.key !== key);
}

// ---------- treatment ----------
const lastTreatedToday = (state, c) => c.treatedDay === day(state);

export function treatConditionInfo(state, base, s, key) {
  const c = conditionsOf(s).find((x) => x.key === key);
  const d = CONDITIONS[key];
  let reason = "";
  if (!s || !s.alive) reason = "Nobody to treat.";
  else if (!c || !d) reason = `${s.name} does not have that.`;
  else if (!base || !residents(state, base.id).includes(s)) reason = `${s.name} is not at ${base ? base.name : "a base"}.`;
  else if (lastTreatedToday(state, c)) reason = "Already treated today.";
  else if ((base.stock.meds || 0) < d.meds) reason = `Needs ${d.meds} meds (have ${Math.floor(base.stock.meds || 0)}).`;
  const hosp = base ? activeHospital(state, base) : null;
  const medSkill = hosp ? hosp.baseSkill : 0;
  const amount = d ? Math.round(d.treat * (hosp ? hosp.eff : 1) * (1 + medSkill * 0.02)) : 0;
  return { ok: !reason, reason, cost: d ? d.meds : 0, amount, cures: c ? amount >= c.sev : false };
}

// One treatment with base meds: the severity drops (cured if it reaches 0) and it does not worsen today.
export function treatCondition(state, base, survivorId, key) {
  const s = state.survivors.find((x) => x.id === Number(survivorId));
  const info = treatConditionInfo(state, base, s, key);
  if (!info.ok) return info.reason;
  const c = conditionsOf(s).find((x) => x.key === key);
  base.stock.meds = Math.max(0, (base.stock.meds || 0) - info.cost);
  state.medsUsed = (state.medsUsed || 0) + info.cost;
  c.sev -= info.amount;
  c.treatedDay = day(state);
  const name = CONDITIONS[key].name.toLowerCase();
  if (c.sev <= 0) {
    removeCondition(s, key);
    return `${s.name}'s ${name} was treated at ${base.name} (${info.cost} meds). It is gone.`;
  }
  return `${s.name}'s ${name} was treated at ${base.name} (${info.cost} meds): severity now ${Math.round(c.sev)}.`;
}

// Meds a base would need today to treat everyone sick here once.
export function medsToTreatAll(state, base) {
  let n = 0;
  for (const s of residents(state, base.id)) for (const c of conditionsOf(s)) if (!lastTreatedToday(state, c)) n += CONDITIONS[c.key].meds;
  return n;
}

// Base setting: treat the sick automatically each day with base meds, keeping a reserve (base.medsReserve).
export const autoTreatOn = (base) => base.autoTreat !== false;

function autoTreatBase(state, base) {
  if (!autoTreatOn(base)) return;
  const reserve = base.medsReserve || 0;
  const list = [];
  for (const s of residents(state, base.id)) for (const c of conditionsOf(s)) list.push({ s, c, d: CONDITIONS[c.key] });
  // Worst first: anything that can kill, then by severity.
  list.sort((a, b) => b.d.hp * b.c.sev - a.d.hp * a.c.sev || b.c.sev - a.c.sev);
  for (const { s, c, d } of list) {
    const urgent = d.hp * c.sev / 100 >= 6 || c.key === "pneumonia";
    if (!urgent && (c.sev < 30 && c.key !== "cut")) continue;
    if ((base.stock.meds || 0) - d.meds < (urgent ? 0 : reserve)) continue;
    const msg = treatCondition(state, base, s.id, c.key);
    if (/meds\)/.test(msg)) log(state, msg, "good");
  }
}

// ---------- the daily tick ----------
// Everyone with a condition: it drifts, hurts, maybe turns worse; then new cases; then automatic treatment.
export function healthDaily(state) {
  const rng = state.rng;
  const today = day(state);
  for (const base of state.bases) base.healthToday = { cases: 0 };
  // Progress of every condition.
  for (const s of alive(state)) {
    const list = conditionsOf(s);
    if (!list.length) continue;
    const base = s.location.kind === "base" ? baseById(state, s.location.baseId) : null;
    const hosp = base ? activeHospital(state, base) : null;
    for (const c of [...list]) {
      const d = CONDITIONS[c.key];
      if (!d) { removeCondition(s, c.key); continue; }
      let drift = d.drift;
      if (c.key === "flu" && c.days < 3) drift = 4;
      if (base) {
        drift -= 1.5;
        if (s.role === "rest") drift -= 2;
        if (s.inBed && hosp && hosp.tier > 0) drift -= 4 + hosp.tier * 2;
        drift -= (hosp ? hosp.baseSkill : 0) * 0.15;
        if (base.hungerDays > 0 || base.thirstDays > 0) drift += 4;
      } else {
        const p = state.parties.find((x) => x.id === s.location.partyId);
        if (p && (p.noFood || p.noWater)) drift += 4;
      }
      if (c.treatedDay >= today - 1) drift = Math.min(drift, -2);
      if (c.key === "fever" && c.days < 2) drift += 2;
      c.sev = Math.min(100, c.sev + drift + rng.range(-2, 2));
      if (c.sev <= 0) {
        removeCondition(s, c.key);
        log(state, `${s.name} got over the ${d.name.toLowerCase()}.`, "good");
        continue;
      }
      // Health: not on the day it starts.
      if (c.days > 0 && d.hp > 0) {
        const tile = base ? base.tile : partyTileOf(state, s);
        hurt(state, s, d.hp * c.sev / 100, tile, `of ${d.name.toLowerCase()}`, { raw: true });
        if (!s.alive) break;
      }
      c.days += 1;
      // Turning worse.
      if (c.key === "cut" && c.treatedDay < today - 1 && !s.woundInfected && rng.chance(0.03)) {
        removeCondition(s, "cut");
        s.woundInfected = true;
        log(state, `${s.name}'s untreated cut is infected. Treat it with meds.`, "danger");
      } else if ((c.key === "fever" && c.sev > 60 && rng.chance(0.03)) || (c.key === "flu" && c.sev > 50 && coldNow(state) && rng.chance(0.04))) {
        removeCondition(s, c.key);
        addCondition(state, s, "pneumonia", `after the ${d.name.toLowerCase()} went to the lungs`);
      }
    }
  }
  // New cases.
  for (const base of state.bases) baseOnsets(state, base);
  teamOnsets(state);
  for (const base of state.bases) {
    autoTreatBase(state, base);
    outbreakCheck(state, base);
  }
}

function partyTileOf(state, s) {
  const p = state.parties.find((x) => x.id === s.location.partyId);
  return p && p.path ? p.path[p.idx] : null;
}

const coldNow = (state) => {
  const w = Weather.weather ? Weather.weather(state) : null;
  return !!w && w.lo <= 3;
};
const exposure = (state, sheltered) => (Weather.exposureRisk ? Weather.exposureRisk(state, { sheltered }) : { chance: 0, kind: null, reason: "" });

const WORK_RISK = { farm: 0.006, build: 0.012, craft: 0.008, operate: 0.006, scavenge: 0.02, guard: 0.002, medic: 0, rest: 0 };
const OUTDOORS = new Set(["farm", "scavenge", "guard", "build"]);

export function hasWaterFilter(state, base) {
  if (base.armory.some((it) => it && GEAR[it.key] && GEAR[it.key].water)) return true;
  return atBase(state, base.id).some((s) => s.gear.tool && GEAR[s.gear.tool.key] && GEAR[s.gear.tool.key].water);
}

function baseOnsets(state, base) {
  const rng = state.rng;
  const people = residents(state, base.id);
  if (!people.length) return;
  const crowd = people.length - baseBeds(base);
  const crowdFlu = crowd > 0 ? Math.min(0.03, 0.002 + 0.01 * crowd / Math.max(1, baseBeds(base))) : 0;
  const filter = hasWaterFilter(state, base);
  const dirty = (filter ? 0.001 : 0.004) * (base.thirstDays > 0 ? 3 : 1);
  const outside = exposure(state, false), inside = exposure(state, true);
  const quarantine = (base.quarantineUntil || 0) >= day(state);
  // Contagion from today's cases (before anyone new falls ill).
  const sources = people.filter((s) => isContagious(s));
  const where = `at ${base.name}`;
  for (const s of people) {
    if (!s.alive) continue;
    s.quarantined = quarantine && isContagious(s);
    const role = s.location.kind === "base" ? s.role : "rest";
    const working = s.location.kind === "base" && !s.inBed;
    // Work accidents.
    if (working && rng.chance((WORK_RISK[role] || 0) * workFactor(s))) {
      const key = rng.chance(role === "scavenge" ? 0.65 : 0.55) ? "cut" : "sprain";
      const what = { farm: "in the fields", build: "on the building site", craft: "at the workbench", operate: "at a workshop station", scavenge: "scavenging around the base", guard: "on watch" }[role] || "at work";
      addCondition(state, s, key, `${what} ${where}`);
      if (role === "scavenge") hurt(state, s, rng.int(4, 12), base.tile, `scavenging near ${base.name}`);
      continue;
    }
    // Weather.
    const ex = working && OUTDOORS.has(role) ? { ...outside, chance: outside.chance * 0.6 } : { ...inside, chance: inside.chance * 0.5 };
    if (ex.kind && rng.chance(ex.chance)) {
      if (ex.kind === "heat") addCondition(state, s, "fever", `from the heat (${ex.reason}) ${where}`);
      else addCondition(state, s, hasCondition(s, "flu") ? "pneumonia" : "flu", `in the ${ex.reason} ${where}`);
      continue;
    }
    // Hunger and thirst.
    if ((base.hungerDays > 0 || base.thirstDays > 0) && rng.chance(0.06)) {
      addCondition(state, s, base.thirstDays > 0 ? "dysentery" : "fever", base.thirstDays > 0 ? `drinking whatever they could find ${where}` : `weak from hunger ${where}`);
      continue;
    }
    if (rng.chance(dirty)) { addCondition(state, s, "dysentery", `from dirty water ${where}${filter ? "" : " (no water filter)"}`); continue; }
    if (crowdFlu && rng.chance(crowdFlu)) { addCondition(state, s, "flu", `in the crowded bunks ${where}`); continue; }
    // Contagion.
    let p = 0, from = null;
    for (const src of sources) {
      if (src === s) continue;
      for (const c of conditionsOf(src)) {
        const d = CONDITIONS[c.key];
        if (!d.spread) continue;
        let q = d.spread * (0.5 + c.sev / 100) * (crowd > 0 ? 1.6 : 1) * (quarantine ? 0.4 : 1) * (s.role === "medic" ? 1.5 : 1);
        if (q > p) { p = q; from = { src, key: c.key }; }
      }
    }
    if (from && !hasCondition(s, from.key) && rng.chance(Math.min(0.25, p * Math.max(1, Math.sqrt(sources.length))))) {
      addCondition(state, s, from.key, `caught from ${first(from.src)} ${where}`);
    }
  }
}

function teamOnsets(state) {
  const rng = state.rng;
  const ex = exposure(state, false);
  for (const p of state.parties) {
    if (p.owner !== "player" || !Array.isArray(p.members)) continue;
    for (const id of p.members) {
      const s = state.survivors.find((x) => x.id === id);
      if (!s || !s.alive || s.location.kind !== "party") continue;
      if (ex.kind && rng.chance(ex.chance)) {
        if (ex.kind === "heat") addCondition(state, s, "fever", `from the heat on the road (${ex.reason})`);
        else addCondition(state, s, hasCondition(s, "flu") ? "pneumonia" : "flu", `in the ${ex.reason} on the road`);
      } else if ((p.noFood || p.noWater) && rng.chance(0.04)) {
        addCondition(state, s, p.noWater ? "dysentery" : "fever", p.noWater ? "drinking from puddles on the road" : "weak from hunger on the road");
      }
      // A team uses its carried meds on anything serious.
      for (const c of conditionsOf(s)) {
        const d = CONDITIONS[c.key];
        if (c.sev < 45 && c.key !== "pneumonia") continue;
        if (c.treatedDay >= day(state)) continue;
        const have = Math.max(0, p.supplies.meds || 0) + Math.max(0, (p.cargo && p.cargo.supplies.meds) || 0);
        if (have < d.meds) continue;
        let need = d.meds;
        const fromCargo = Math.min(need, Math.max(0, (p.cargo && p.cargo.supplies.meds) || 0));
        if (fromCargo) { p.cargo.supplies.meds -= fromCargo; need -= fromCargo; }
        p.supplies.meds = (p.supplies.meds || 0) - need;
        state.medsUsed = (state.medsUsed || 0) + d.meds;
        c.sev -= d.treat * 0.8;
        c.treatedDay = day(state);
        if (c.sev <= 0) removeCondition(s, c.key);
        log(state, `${first(s)} took ${d.meds} of the team's meds for the ${d.name.toLowerCase()}.`, "info");
      }
    }
  }
}

// Search hours at a site (scavenge.js): cuts on broken glass and rusty metal, fevers from what lies there.
export function searchHazards(state, members, where = "") {
  for (const s of members) {
    if (!s || !s.alive) continue;
    if (state.rng.chance(0.008)) addCondition(state, s, "cut", `searching ${where}`.trim());
    else if (state.rng.chance(0.0025)) addCondition(state, s, "fever", `from the filth at ${where}`.trim());
  }
}

// A wound that did not kill (world.hurt, plain damage only): it may need dressing.
export function woundTrauma(state, s, amount) {
  if (!s || !s.alive || amount < 10 || hasCondition(s, "cut")) return;
  if (state.rng.chance(0.25)) addCondition(state, s, "cut", "from the wound", { quiet: true });
}

// ---------- outbreaks ----------
function outbreakCheck(state, base) {
  const sick = residents(state, base.id).filter((s) => isContagious(s));
  if (sick.length < 3) return;
  if ((base.outbreakDay || -99) > day(state) - 10) return;
  if (state.cards.some((c) => c.outbreakBase === base.id)) return;
  base.outbreakDay = day(state);
  const names = {};
  for (const s of sick) for (const c of conditionsOf(s)) if (CONDITIONS[c.key].spread) names[CONDITIONS[c.key].name.toLowerCase()] = true;
  const what = Object.keys(names).join(" and ");
  const baseId = base.id;
  addCard(state, {
    title: `Outbreak at ${base.name}`,
    outbreakBase: baseId,
    text: `${sick.length} people at ${base.name} have ${what}: ${sick.map(first).join(", ")}. It is spreading.`,
    choices: [
      {
        label: "Quarantine the sick (10 days)", hint: "The sick do not work while contagious; the spread drops by 60% for 10 days",
        resolve: (st) => {
          const b = baseById(st, baseId);
          if (!b) return "That base is gone.";
          b.quarantineUntil = day(st) + 10;
          return `The sick at ${b.name} are kept apart for 10 days.`;
        },
      },
      {
        label: "Treat everyone now", get hint() { const b = baseById(state, baseId); return b ? `Uses up to ${medsToTreatAll(state, b)} meds (have ${Math.floor(b.stock.meds || 0)})` : ""; },
        disabled: (st) => { const b = baseById(st, baseId); return !b || (b.stock.meds || 0) < 1; },
        resolve: (st) => {
          const b = baseById(st, baseId);
          if (!b) return "That base is gone.";
          let used = 0;
          for (const s of residents(st, b.id)) for (const c of [...conditionsOf(s)]) {
            const msg = treatCondition(st, b, s.id, c.key);
            if (/meds\)/.test(msg)) used += CONDITIONS[c.key].meds;
          }
          return used ? `Treated the sick at ${b.name} (${used} meds).` : "There were not enough meds to treat anyone.";
        },
      },
      { label: "Carry on", hint: "No cost now", resolve: () => "Life goes on. The sick keep working as they can." },
    ],
  });
}

// ---------- text for the UI ----------
export function conditionText(c) {
  const d = CONDITIONS[c.key];
  return `${d.name} (${Math.round(c.sev)})`;
}

export function conditionTip(state, s, c) {
  const d = CONDITIONS[c.key];
  const bits = [d.desc, `Severity ${Math.round(c.sev)} of 100, day ${c.days + 1}${c.why ? `, ${c.why}` : ""}.`];
  if (d.hp) bits.push(`Costs about ${r1(d.hp * c.sev / 100)} health a day.`);
  bits.push(`Can work at ${Math.round(workFactor({ conditions: [c] }) * 100)}%.`);
  bits.push(`Treatment: ${d.meds} meds, takes off about ${d.treat} severity (more with a hospital and Medicine); once a day.`);
  if (d.spread) bits.push("Contagious.");
  return bits.join(" ");
}
