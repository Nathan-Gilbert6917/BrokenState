// Medical care: hospital tiers, passive healing, infected wounds, and treating people with meds
// at a base or out in the field. Hospital buildings live in BUILDINGS (family "hospital");
// their medical numbers sit in the `med` block of each entry.
//
// Treatment limits (B-20, P-10):
//   - one wound treatment per patient per day (base or field; illnesses: one per condition a day, health.js);
//   - treating takes a medic's time: each Medic-role survivor at a base gives 3 + Medicine/4 treatments a day
//     (less while ill: x their work factor); with nobody on the role, the best treater there gives 2 a day between
//     other work. Surgery on a severe wound takes 3 of them from one medic (most of a day); with no medic that free
//     the patient gets a plain treatment;
//   - automatic care (each night, one rule for wounds and illnesses): worst off first, wounds below 70 health or
//     infected, illnesses that matter; never takes the base's meds below its reserve (base.medsReserve), never
//     beyond the medics' time. It can be switched off per base (base.autoTreat).
// Beds (B-10): a per-base admit line (base.admitBelow, default 70, 30-100): people below it, with a severe or
// infected wound, or too ill to work take beds, worst off first; everyone else keeps working and heals slowly.
// A hospital without enough medics for its tier runs as the highest tier its medics can staff.
import { log, atBase, alive, skill, survivorById, baseById, hurt, hub, residents, day } from "./world.js";
import { BUILDINGS } from "./buildings.js";
import { partyTile, partyMembers, wipeParty } from "./parties.js";
import { medKitBonus, useMedKit } from "./crafting.js";
import { conditionsOf, CONDITIONS, workFactor, tooIllToWork, conditionInfoCtx, applyCondition, autoWantsCondition, conditionDanger } from "./health.js";
import { hasPerk, gainXp, USE } from "./skills.js";
import { noteTreated } from "./relations.js";
import { FIELD_CARE } from "./medfinds.js";

export const SEVERE_BELOW = 30;          // severe wounds: health below this
export const SEVERE_NO_BED = 0.4;        // healing speed for severe wounds without a hospital bed
export const SURGERY_MULT = 1.5;         // treatment heal on a severe wound where surgery is available

// Tier 0: no hospital (or nobody staffing it). People still heal slowly and meds still work, weakly.
export const NO_HOSPITAL = { tier: 0, name: "No hospital", beds: 0, heal: 0, eff: 1, treat: 12, staff: 0, cures: false, guards: false, severe: SEVERE_NO_BED, surgery: false, craft: 0 };

export const BASE_HEAL_PER_DAY = 4;      // everyone at a base, before Medicine
export const TREAT_MEDS = 1;             // meds per treatment
export const CURE_MEDS = 1;              // extra meds to clean an infected wound
export const FIELD_TREAT_HOURS = 1;      // time a field treatment takes (for timed orders)
const FIELD_HEAL = 8;                    // heal per field treatment before Medicine
export const AUTO_BELOW = 70;            // automatic care treats wounds below this health (and any infected wound)

// Medic time.
export const TREATS_PER_MEDIC = 3;       // treatments a day per Medic-role survivor, + Medicine / 4
export const UNTRAINED_TREATS = 2;       // with nobody on the Medic role: the best treater here, between other work
export const SURGERY_LOAD = 3;           // treatments' worth of one medic's day that a surgery takes

// The admit line for hospital beds.
export const ADMIT_DEFAULT = 70, ADMIT_MIN = 30, ADMIT_MAX = 100, ADMIT_STEP = 10;
export const admitBelow = (base) => {
  const v = Number(base && base.admitBelow);
  return Number.isFinite(v) && base.admitBelow != null ? Math.max(ADMIT_MIN, Math.min(ADMIT_MAX, Math.round(v))) : ADMIT_DEFAULT;
};
export const medsReserve = (base) => Math.max(0, Number(base && base.medsReserve) || 0);
export const autoCareOn = (base) => !!base && base.autoTreat !== false;

const hoursToMidnight = (state) => 24 - (state.hour % 24);
export const nextDayText = (state) => `from midnight (in ${hoursToMidnight(state)}h)`;

// Hospital building types in tier order (a function: BUILDINGS may not exist yet while modules load).
export const hospitalTypes = () => Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].family === "hospital").sort((a, b) => BUILDINGS[a].tier - BUILDINGS[b].tier);

// The hospital building at a base (the highest tier; an upgrade replaces the old one).
export function hospitalBuilding(base) {
  let best = null;
  for (const b of base.buildings) {
    const d = BUILDINGS[b.type];
    if (d && d.family === "hospital" && (!best || d.tier > BUILDINGS[best.type].tier)) best = b;
  }
  return best;
}

export function hospitalTier(base) {
  const b = hospitalBuilding(base);
  return b ? BUILDINGS[b.type].tier : 0;
}

const defOf = (type) => ({ tier: BUILDINGS[type].tier, name: BUILDINGS[type].name, type, ...BUILDINGS[type].med });

// The full stats of the hospital as built (ignores staffing).
export function hospitalDef(base) {
  const b = hospitalBuilding(base);
  return b ? defOf(b.type) : NO_HOSPITAL;
}

// Next upgrade step (building type) or null at the top tier.
export function nextHospitalType(base) {
  const t = hospitalTier(base);
  return hospitalTypes().find((k) => BUILDINGS[k].tier === t + 1) || null;
}

// People on the Medic role at this base.
export const medicStaff = (state, base) => atBase(state, base.id).filter((s) => s.role === "medic");
const bestMed = (people) => Math.max(0, ...people.map((s) => skill(s, "medicine")));

// What actually runs: buildings need people. With too few medics for the tier as built, the hospital runs as the
// highest tier its medics can staff (a Clinic with one medic works as a Field hospital); with none, as no hospital.
export function activeHospital(state, base) {
  const def = hospitalDef(base);
  const staff = medicStaff(state, base);
  const staffed = def.tier > 0 && staff.length >= def.staff;
  let run = NO_HOSPITAL;
  if (staffed) run = def;
  else if (def.tier > 0) {
    const fit = hospitalTypes().filter((k) => BUILDINGS[k].tier < def.tier && staff.length >= BUILDINGS[k].med.staff).pop();
    if (fit) run = defOf(fit);
  }
  return {
    ...run,
    built: def,
    staffed,
    fallback: def.tier > 0 && !staffed && run.tier > 0, // running below the tier built
    staff,
    staffSkill: bestMed(staff),
    baseSkill: bestMed(atBase(state, base.id)),
  };
}

export const isHurt = (s) => !!s && s.alive && (s.health < 100 || !!s.woundInfected);

export const isSevere = (s) => !!s && s.alive && s.health < SEVERE_BELOW;

// How badly someone needs care: the order for beds and automatic treatment (worst off first).
export function careNeed(s) {
  if (!s || !s.alive) return -1;
  let n = 100 - s.health;
  if (s.woundInfected) n += 40;
  if (s.health < SEVERE_BELOW) n += 20;
  for (const c of conditionsOf(s)) n += conditionDanger(c);
  return n;
}

// Why someone would take a hospital bed at this base ("" = they keep working). Medics on duty never do.
export function bedReason(state, base, s) {
  if (!s || !s.alive) return "";
  if (s.role === "medic" && s.location.kind === "base") return "";
  if (isSevere(s)) return `severe wound (below ${SEVERE_BELOW} health)`;
  if (s.woundInfected) return "infected wound";
  const line = admitBelow(base);
  if (s.health < line) return `below ${line} health`;
  if (tooIllToWork(s)) return "too ill to work";
  return "";
}

// Who gets a hospital bed: the people who need one (bedReason), worst off first, capped by beds.
// Patients do not work their role while in bed (s.inBed, set hourly in medicalHour).
export function patients(state, base, h = activeHospital(state, base)) {
  if (!h.beds) return [];
  // Residents: the people here plus (hub) trade-route escorts waiting between trips.
  return residents(state, base.id).filter((s) => bedReason(state, base, s)).sort((a, b) => careNeed(b) - careNeed(a)).slice(0, h.beds);
}

// Passive heal per hour for one survivor at a base.
export function healRatePerHour(state, base, s, hosp = activeHospital(state, base), inBed = null) {
  if (!isHurt(s)) return 0;
  const bed = inBed != null ? inBed : patients(state, base).includes(s);
  let perDay = BASE_HEAL_PER_DAY + hosp.baseSkill * 0.4;
  if (bed && hosp.tier > 0) perDay += hosp.heal + hosp.staffSkill * 0.5 + ((hosp.staff || []).some((m) => hasPerk(m, "chiefmedic")) ? 6 : 0); // Chief of Medicine (skills.js)
  // Severe wounds heal slowly without a bed; the hospital tier sets the speed in a bed.
  if (isSevere(s)) perDay *= bed && hosp.tier > 0 ? hosp.severe : SEVERE_NO_BED;
  if (s.woundInfected) perDay = perDay * 0.5 - 2;
  // Nobody recovers on an empty stomach: no healing while the base is out of food (wounds can still worsen).
  if ((base.hungerDays > 0 || base.thirstDays > 0) && perDay > 0) perDay = 0; // nor without water (economy.js)
  return perDay / 24;
}

// Hourly: assign beds (s.inBed), passive healing at every base, infected wounds worsening everywhere.
export function medicalHour(state) {
  // Anyone not re-admitted below (away on a team, healed, staff) leaves their bed.
  for (const s of state.survivors) if (s.inBed) s.inBed = false;
  for (const base of state.bases) {
    const hosp = activeHospital(state, base);
    understaffedCheck(state, base, hosp);
    const beds = new Set(patients(state, base, hosp).map((s) => s.id));
    const here = residents(state, base.id);
    for (const s of here) if (beds.has(s.id)) s.inBed = true;
    for (const s of here) {
      if (!isHurt(s)) continue;
      const rate = healRatePerHour(state, base, s, hosp, beds.has(s.id));
      if (rate >= 0) s.health = Math.min(100, s.health + rate);
      else hurt(state, s, -rate, base.tile, `of an infected wound at ${base.name}`, { raw: true });
    }
  }
  // Away from a base an infected wound only gets worse.
  for (const s of alive(state)) {
    if (!s.woundInfected || s.location.kind !== "party") continue;
    const p = state.parties.find((x) => x.id === s.location.partyId);
    hurt(state, s, 3 / 24, p ? partyTile(p) : null, "of an infected wound", { raw: true });
    if (p && state.parties.includes(p) && !partyMembers(state, p).length) wipeParty(state, p);
  }
}

// A new hospital tier that its medics cannot staff gets a warning (once per tier built).
function understaffedCheck(state, base, hosp) {
  const type = hosp.built.type || null;
  if (base.hospSeen === undefined) { base.hospSeen = type; return; }
  if (base.hospSeen === type) return;
  base.hospSeen = type;
  if (!type || hosp.staffed) return;
  const n = hosp.staff.length;
  log(state, `The ${hosp.built.name} at ${base.name} needs ${hosp.built.staff} medic${hosp.built.staff === 1 ? "" : "s"} and has ${n}: it runs as ${hosp.tier ? `a ${hosp.name}` : "no hospital"} until ${hosp.built.staff - n} more ${hosp.built.staff - n === 1 ? "person takes" : "people take"} the Medic role.`, "danger");
}

// Daily: infections setting in or clearing. (Meds are used by automatic care, autoCare, run from health.js.)
export function medicalDaily(state, base) {
  const rng = state.rng;
  const hosp = activeHospital(state, base);
  const beds = new Set(patients(state, base).map((s) => s.id));
  for (const s of residents(state, base.id)) {
    if (!s.alive) continue;
    if (s.woundInfected) {
      if (s.health >= 50 && rng.chance(0.1)) {
        s.woundInfected = false;
        log(state, `${s.name}'s infected wound cleared up on its own.`, "good");
      }
    } else if (s.health < 40 && !(hosp.guards && beds.has(s.id)) && rng.chance(0.05)) {
      s.woundInfected = true;
      log(state, `${s.name}'s wounds are infected. Treat them with meds${hosp.cures ? "" : " (a Clinic or better cleans them reliably)"}.`, "danger");
    }
  }
}

// Infections set in more easily on the road (called daily for people away); then the teams' own care.
export function fieldInfectionDaily(state) {
  for (const s of alive(state)) {
    if (s.location.kind !== "party" || s.woundInfected || s.health >= 40) continue;
    if (state.rng.chance(0.08)) {
      s.woundInfected = true;
      log(state, `${s.name}'s wounds are infected out in the field. Treat them with meds.`, "danger");
    }
  }
  fieldCareDaily(state);
}

// A team in the field patches up a bad wound from the meds it carries (medfinds.js FIELD_CARE: below `below` health
// or infected; once a day, as a field treatment: 1 meds, +1 to clean an infection). Meds go on need only: nobody
// hurt, nothing spent. Illnesses on the road: health.js teamOnsets. A team in a battle is left to it.
export function fieldCareDaily(state) {
  for (const p of state.parties) {
    if (p.owner !== "player" || !Array.isArray(p.members) || (state.combat && state.combat.setup && state.combat.setup.partyId === p.id)) continue;
    const hurtOnes = partyMembers(state, p).filter((s) => s.alive && s.location.kind === "party" && (s.woundInfected || s.health < FIELD_CARE.below)).sort((a, b) => careNeed(b) - careNeed(a));
    for (const s of hurtOnes) {
      if (!fieldTreatInfo(state, p, s).ok) continue;
      log(state, `${teamWord(state, p)}: ${fieldTreat(state, p, s.id)}`, "info");
    }
  }
}
const teamWord = (state, p) => { const ms = partyMembers(state, p); return ms.length === 1 ? ms[0].name.split(" ")[0] : `${ms[0].name.split(" ")[0]}'s team`; };

// ---------- who does the treating ----------
// The best treater among some people: Medicine plus the kit in their off hand (crafting.medKitBonus: a bandage
// kit, or a surgical kit they are skilled enough to use). The same rule at a base, in the field and in battle;
// a kit that wears (bandage kit) loses a use per treatment.
function bestMedic(people) {
  let best = null, bestVal = -1;
  for (const m of people) {
    const v = skill(m, "medicine") + medKitBonus(m);
    if (v > bestVal) { best = m; bestVal = v; }
  }
  return { medic: best, value: Math.max(0, bestVal) };
}

// Treatments a Medic-role survivor can give in a day.
export function medicCapacity(s) {
  const cap = Math.max(0, Math.floor((TREATS_PER_MEDIC + Math.floor(skill(s, "medicine") / 4)) * workFactor(s) + 1e-9));
  return cap > 0 && hasPerk(s, "triage") ? cap + 1 : cap; // Triage (skills.js): +1 treatment a day
}

// Who treats at this base and how many treatments a day each: the Medic-role people there (best first); with
// nobody on the role, the best treater here (2 a day).
export function treaters(state, base) {
  const here = atBase(state, base.id);
  const medics = here.filter((s) => s.role === "medic");
  let list;
  if (medics.length) list = medics.map((m) => ({ s: m, cap: medicCapacity(m), trained: true }));
  else {
    const { medic } = bestMedic(here);
    list = medic ? [{ s: medic, cap: UNTRAINED_TREATS + (hasPerk(medic, "triage") ? 1 : 0), trained: false }] : [];
  }
  for (const t of list) t.value = skill(t.s, "medicine") + medKitBonus(t.s);
  return list.sort((a, b) => b.value - a.value);
}

// Today's ledger of medic time at a base (resets each day).
function ledger(state, base) {
  const d = day(state);
  if (!base.medWork || base.medWork.day !== d) base.medWork = { day: d, used: {} };
  return base.medWork;
}

// A context for treatment checks: the meds and medic time available. plan = tonight's automatic care (a fresh day,
// nobody treated yet); auto = an automatic dose (keeps the reserve).
export function careCtx(state, base, { auto = false, plan = false } = {}) {
  const d = day(state);
  const used = plan ? {} : { ...(base.medWork && base.medWork.day === d ? base.medWork.used : {}) };
  return { day: plan ? d + 1 : d, meds: base.stock.meds || 0, used, auto: auto || plan, plan, reserve: medsReserve(base), treaters: treaters(state, base) };
}

// The best treater with at least `load` treatments of time left today.
export function pickTreater(ctx, load = 1) {
  return ctx.treaters.find((t) => t.cap - (ctx.used[t.s.id] || 0) >= load) || null;
}

const timeTotals = (ctx) => {
  let cap = 0, used = 0;
  for (const t of ctx.treaters) { cap += t.cap; used += Math.min(t.cap, ctx.used[t.s.id] || 0); }
  return { cap, used, left: cap - used };
};

// Why there is no treater with time (a reason string).
export function noTimeReason(state, ctx) {
  if (!ctx.treaters.length) return "Nobody here can treat.";
  const t = timeTotals(ctx);
  if (!t.cap) return "Nobody here is fit to treat today.";
  return `No medic time left today (${t.used} of ${t.cap} treatments given). More ${nextDayText(state)}.`;
}

// Medic time at a base today, for the UI: each treater's capacity and use.
export function medicTime(state, base) {
  const ctx = careCtx(state, base);
  const list = ctx.treaters.map((t) => ({ ...t, used: Math.min(t.cap, ctx.used[t.s.id] || 0), left: Math.max(0, t.cap - (ctx.used[t.s.id] || 0)) }));
  return { list, ...timeTotals(ctx), trained: list.some((t) => t.trained) };
}

// Uses a treater's time (after a treatment).
export function spendMedicTime(state, base, treater, load) {
  if (!treater) return;
  const L = ledger(state, base);
  L.used[treater.s.id] = (L.used[treater.s.id] || 0) + load;
  noteTreated(state, treater.s); // relations.js: people treated (service record)
}

// ---------- treating at a base ----------
function woundInfo(state, base, s, ctx) {
  const hosp = activeHospital(state, base);
  const cost = TREAT_MEDS + (s && s.woundInfected ? CURE_MEDS : 0);
  const wantSurgery = !!(s && isSevere(s) && hosp.surgery);
  let t = wantSurgery ? pickTreater(ctx, SURGERY_LOAD) : null;
  const surgery = !!t;
  if (!t) t = pickTreater(ctx, 1);
  const shown = t || ctx.treaters[0] || null;
  const value = shown ? shown.value : 0;
  // Perks of the one treating (skills.js): Steady Hands +25%, Miracle Worker's surgery 2× instead of 1.5×.
  const who = t ? t.s : shown ? shown.s : null;
  const heal = Math.round((hosp.treat + value * 0.5) * hosp.eff * (surgery ? (hasPerk(who, "miracle") ? 2 : SURGERY_MULT) : 1) * (hasPerk(who, "steadyhands") ? 1.25 : 1));
  const cureChance = !s || !s.alive || !s.woundInfected ? 0 : hosp.cures ? 1 : Math.min(0.9, 0.25 + hosp.tier * 0.15 + value * 0.03);
  const treatedToday = !!s && s.woundTreatedDay === ctx.day;
  let reason = "";
  if (!s || !s.alive) reason = "Nobody to treat.";
  else if (!residents(state, base.id).includes(s)) reason = `${s.name} is not at ${base.name}.`;
  else if (!isHurt(s)) reason = `${s.name} is not hurt.`;
  else if (treatedToday) reason = `Already treated today. Next treatment ${nextDayText(state)}.`;
  else if (!t) reason = noTimeReason(state, ctx);
  else if (ctx.meds < cost) reason = `Needs ${cost} meds (have ${Math.floor(ctx.meds)}).`;
  else if (ctx.auto && ctx.meds - cost < ctx.reserve) reason = `Would take the meds below the reserve of ${ctx.reserve}.`;
  return {
    ok: !reason, reason, cost, heal, cureChance, hosp, surgery, medic: t ? t.s : null, treater: t,
    load: surgery ? SURGERY_LOAD : 1, noSurgeryTime: wantSurgery && !surgery, treatedToday,
  };
}

export function treatAtBaseInfo(state, base, s, opts = {}) {
  return woundInfo(state, base, s, opts.ctx || careCtx(state, base, opts));
}

function applyWound(state, base, s, info) {
  base.stock.meds = Math.max(0, (base.stock.meds || 0) - info.cost);
  spendMedicTime(state, base, info.treater, info.load);
  s.woundTreatedDay = day(state);
  useMedKit(state, info.medic);
  gainXp(state, info.medic, "medicine", info.surgery ? USE.surgery : USE.wound); // skills.js
  const before = s.health;
  s.health = Math.min(100, s.health + info.heal);
  let cure = "";
  if (s.woundInfected) {
    if (state.rng.chance(info.cureChance)) { s.woundInfected = false; cure = " The infection is cleaned out."; }
    else cure = " The wound is still infected.";
  }
  const where = info.hosp.tier ? `in the ${info.hosp.name.toLowerCase()}` : "on a cot";
  const by = info.medic && info.medic.id !== s.id ? ` by ${info.medic.name.split(" ")[0]}` : "";
  return `${s.name} ${info.surgery ? "operated on" : "treated"}${by} ${where} at ${base.name}: health ${Math.floor(before)} → ${Math.floor(s.health)} (${info.cost} meds).${cure}`;
}

export function treatAtBase(state, base, survivorId, opts = {}) {
  const s = survivorById(state, survivorId);
  const info = treatAtBaseInfo(state, base, s, opts);
  if (!info.ok) return info.reason;
  return applyWound(state, base, s, info);
}

// ---------- automatic care ----------
// One rule for every automatic dose (wounds and illnesses), run each night (health.healthDaily) and shown ahead
// in the Medical tab (plan: true, nothing changes). Worst off first (careNeed); for one person an infected or
// severe wound comes before their illnesses, the rest by danger. Wounds below AUTO_BELOW health or infected;
// illnesses that matter (health.autoWantsCondition). Each dose keeps the reserve and needs medic time.
// Returns { off, list: [{ s, kind: "wound"|"cond", key, cost, heal, amount }], skipped: [{ s, kind, key, reason }] }.
export function autoCare(state, base, { plan = false } = {}) {
  const out = { off: !autoCareOn(base), list: [], skipped: [], meds: 0 };
  if (out.off) return out;
  let ctx = careCtx(state, base, { auto: true, plan });
  const people = residents(state, base.id).filter((s) => s.alive).sort((a, b) => careNeed(b) - careNeed(a));
  // A plan looks ahead to midnight: whether a wound is still below AUTO_BELOW by then (passive healing until then).
  const hosp = plan ? activeHospital(state, base) : null;
  const hpAtNight = (s) => (plan ? projectHealth(state, base, s, { hosp, inBed: !!s.inBed }).night : s.health);
  for (const s of people) {
    const jobs = [];
    const hp = hpAtNight(s);
    const woundDue = isHurt(s) && (hp < 100 || s.woundInfected) && (hp < AUTO_BELOW || s.woundInfected);
    const woundFirst = s.woundInfected || isSevere(s);
    const conds = conditionsOf(s).filter((c) => autoWantsCondition(c)).sort((a, b) => conditionDanger(b) - conditionDanger(a));
    if (woundDue && woundFirst) jobs.push({ kind: "wound" });
    for (const c of conds) jobs.push({ kind: "cond", key: c.key });
    if (woundDue && !woundFirst) jobs.push({ kind: "wound" });
    for (const j of jobs) {
      if (!s.alive) break;
      const info = j.kind === "wound" ? woundInfo(state, base, s, ctx) : conditionInfoCtx(state, base, s, j.key, ctx);
      if (!info.ok) { out.skipped.push({ s, ...j, reason: info.reason }); continue; }
      const entry = { s, ...j, cost: info.cost, heal: info.heal || 0, amount: info.amount || 0, surgery: !!info.surgery };
      if (plan) {
        ctx.meds -= info.cost;
        ctx.used[info.treater.s.id] = (ctx.used[info.treater.s.id] || 0) + info.load;
      } else {
        if (j.kind === "wound") applyWound(state, base, s, info);
        else applyCondition(state, base, s, j.key, info);
        ctx = careCtx(state, base, { auto: true });
      }
      out.meds += info.cost;
      out.list.push(entry);
    }
  }
  if (!plan && out.list.length) {
    const byPerson = new Map();
    for (const e of out.list) {
      const what = e.kind === "wound" ? (e.surgery ? "surgery" : "wounds") : CONDITIONS[e.key].name.toLowerCase();
      byPerson.set(e.s, [...(byPerson.get(e.s) || []), what]);
    }
    log(state, `Night care at ${base.name}: ${[...byPerson].map(([s, w]) => `${s.name.split(" ")[0]} (${w.join(", ")})`).join(", ")}. ${out.meds} meds used.`, "good");
  }
  return out;
}

// Health someone loses tonight to their illnesses (health.js, conditions older than a day).
function illnessTonight(s) {
  let n = 0;
  for (const c of conditionsOf(s)) if (c.days > 0 && CONDITIONS[c.key]) n += CONDITIONS[c.key].hp * c.sev / 100;
  return n;
}

// Projects someone's health hour by hour over the next 24 hours at a base, in the order the game runs it: passive
// healing each hour (leaving the bed once nothing keeps them there), and at midnight their illness, then tonight's
// treatment (`treat`, health). Returns { night: health when night care looks at them, end: health in 24 hours,
// passive: what passive healing alone added }.
export function projectHealth(state, base, s, { hosp = activeHospital(state, base), inBed = null, treat = 0 } = {}) {
  const bedNow = inBed != null ? inBed : patients(state, base, hosp).includes(s);
  const H = hoursToMidnight(state);
  const ill = illnessTonight(s);
  let hp = s.health, night = s.health, passive = 0;
  for (let i = 1; i <= 24; i++) {
    const t = { ...s, health: hp };
    const bed = bedNow && !!bedReason(state, base, t);
    const rate = healRatePerHour(state, base, t, hosp, bed);
    const next = rate >= 0 ? Math.min(100, hp + rate) : hp + rate;
    passive += next - hp;
    hp = next;
    if (i === H) {
      hp -= ill;
      night = hp;
      if (treat) hp = Math.min(100, hp + treat);
    }
  }
  return { night, end: hp, passive };
}

// Expected health change over the next day for someone at a base (the Medical tab's figure, P-21): passive healing
// for 24 hours (hour by hour, out of bed once healed past the admit line), tonight's automatic treatment if they are
// in the plan, and what their illnesses cost. Pass `plan` (autoCare(..., { plan: true })) to share one plan.
export function dailyHealthChange(state, base, s, { hosp = activeHospital(state, base), inBed = null, plan = null } = {}) {
  const p = plan || autoCare(state, base, { plan: true });
  const mine = p.list.filter((e) => e.s === s);
  const wound = mine.find((e) => e.kind === "wound");
  const r = projectHealth(state, base, s, { hosp, inBed, treat: wound ? wound.heal : 0 });
  const illness = illnessTonight(s);
  const total = r.end - s.health;
  const treat = wound ? Math.max(0, total - r.passive + illness) : 0; // what the treatment adds (after the cap at 100)
  const skipped = p.skipped.find((e) => e.s === s && e.kind === "wound");
  return { total, passive: r.passive, treat, illness, wound: wound || null, conds: mine.filter((e) => e.kind === "cond"), skipped: skipped ? skipped.reason : "", off: p.off };
}

// ---------- treating in the field ----------
export const partyMeds = (p) => Math.max(0, (p.supplies.meds || 0)) + Math.max(0, (p.cargo && p.cargo.supplies.meds) || 0);

function takeMeds(p, qty) {
  const fromCargo = Math.min(qty, Math.max(0, (p.cargo && p.cargo.supplies.meds) || 0));
  if (fromCargo) p.cargo.supplies.meds -= fromCargo;
  p.supplies.meds = (p.supplies.meds || 0) - (qty - fromCargo);
}

// The team member who does the treating: best Medicine plus kit.
function fieldMedic(state, p) {
  return bestMedic((p.members || []).map((id) => survivorById(state, id)).filter((m) => m && m.alive));
}

export function fieldTreatInfo(state, party, s) {
  const { medic, value } = fieldMedic(state, party);
  const cost = TREAT_MEDS + (s && s.woundInfected ? CURE_MEDS : 0);
  // Perks of the team's medic (skills.js): Field Surgeon heals like a base treatment (1.5× on a severe wound) and
  // cleans infections 90% of the time; Steady Hands +25%.
  const fs = hasPerk(medic, "fieldsurgeon");
  const heal = Math.round((fs ? (12 + value * 0.5) * (isSevere(s) ? SURGERY_MULT : 1) : FIELD_HEAL + value * 0.6) * (hasPerk(medic, "steadyhands") ? 1.25 : 1));
  const cureChance = s && s.woundInfected ? (fs ? 0.9 : Math.min(0.85, 0.2 + value * 0.04)) : 0;
  const treatedToday = !!s && s.woundTreatedDay === day(state);
  let reason = "";
  if (!s || !s.alive) reason = "Nobody to treat.";
  else if (!party || !(party.members || []).includes(s.id) || s.location.kind !== "party") reason = `${s.name} is not with this team.`;
  else if (!isHurt(s)) reason = `${s.name} is not hurt.`;
  else if (treatedToday) reason = `Already treated today. Next treatment ${nextDayText(state)}.`;
  else if (partyMeds(party) < cost) reason = `Needs ${cost} meds; the team carries ${Math.floor(partyMeds(party))}.`;
  return { ok: !reason, reason, cost, heal, cureChance, medic, hours: FIELD_TREAT_HOURS, treatedToday };
}

export function fieldTreat(state, party, survivorId) {
  const s = survivorById(state, survivorId);
  const info = fieldTreatInfo(state, party, s);
  if (!info.ok) return info.reason;
  takeMeds(party, info.cost);
  useMedKit(state, info.medic);
  gainXp(state, info.medic, "medicine", USE.field); // skills.js
  s.woundTreatedDay = day(state);
  const before = s.health;
  s.health = Math.min(100, s.health + info.heal);
  let cure = "";
  if (s.woundInfected) {
    if (state.rng.chance(info.cureChance)) { s.woundInfected = false; cure = " The infection is cleaned out."; }
    else cure = " The wound is still infected.";
  }
  const by = info.medic && info.medic.id !== s.id ? `${info.medic.name.split(" ")[0]} patches up ${s.name.split(" ")[0]}` : `${s.name.split(" ")[0]} patches themselves up`;
  return `${by} in the field: health ${Math.floor(before)} → ${Math.floor(s.health)} (${info.cost} meds).${cure}`;
}

// Treat someone wherever they are: at their base, or with their team's carried meds.
export function treatAnywhere(state, survivorId) {
  const s = survivorById(state, survivorId);
  if (!s || !s.alive) return "Nobody to treat.";
  if (s.location.kind === "base") return treatAtBase(state, baseById(state, s.location.baseId), s.id);
  if (s.location.kind === "route") return treatAtBase(state, hub(state), s.id); // an escort waiting at the hub between trips
  if (s.location.kind === "party") {
    const p = state.parties.find((x) => x.id === s.location.partyId);
    if (p) return fieldTreat(state, p, s.id);
  }
  return `${s.name} cannot be treated from here.`;
}

// Short lines for the base Medical tab and the Buildings summary.
export function medicalSummary(state, base) {
  const h = activeHospital(state, base);
  const built = h.built;
  if (!built.tier) return "None (slow healing, meds work weakly)";
  if (h.staffed) return built.name;
  return `${built.name} (needs ${built.staff} medic${built.staff === 1 ? "" : "s"}; runs as ${h.tier ? h.name : "no hospital"})`;
}

