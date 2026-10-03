// Medical care: hospital tiers, passive healing, infected wounds, and treating people with meds
// at a base or out in the field. Hospital buildings live in BUILDINGS (family "hospital");
// their medical numbers sit in the `med` block of each entry.
import { log, atBase, alive, skill, survivorById, baseById, hurt } from "./world.js";
import { BUILDINGS } from "./buildings.js";
import { GEAR } from "./data.js";
import { partyTile, partyMembers, wipeParty } from "./parties.js";
import { medKitBonus, useMedKit } from "./crafting.js";

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
const AUTO_BELOW = 70;                   // daily auto-use of meds below this health (old behaviour)

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

// The full stats of the hospital as built (ignores staffing).
export function hospitalDef(base) {
  const b = hospitalBuilding(base);
  if (!b) return NO_HOSPITAL;
  const d = BUILDINGS[b.type];
  return { tier: d.tier, name: d.name, type: b.type, ...d.med };
}

// Next upgrade step (building type) or null at the top tier.
export function nextHospitalType(base) {
  const t = hospitalTier(base);
  return hospitalTypes().find((k) => BUILDINGS[k].tier === t + 1) || null;
}

// People on the Medic role at this base.
export const medicStaff = (state, base) => atBase(state, base.id).filter((s) => s.role === "medic");
const bestMed = (people) => Math.max(0, ...people.map((s) => skill(s, "medicine")));

// What actually runs: a hospital with too few medics works as no hospital (buildings need people).
export function activeHospital(state, base) {
  const def = hospitalDef(base);
  const staff = medicStaff(state, base);
  const staffed = def.tier > 0 && staff.length >= def.staff;
  return {
    ...(staffed ? def : NO_HOSPITAL),
    built: def,
    staffed,
    staff,
    staffSkill: bestMed(staff),
    baseSkill: bestMed(atBase(state, base.id)),
  };
}

export const isHurt = (s) => s.alive && (s.health < 100 || !!s.woundInfected);

export const isSevere = (s) => s.alive && s.health < SEVERE_BELOW;

// Who gets a hospital bed: the worst off first, capped by beds. Medics are staff, never patients.
// Patients do not work their role while in bed (s.inBed, set hourly in medicalHour).
export function patients(state, base, h = activeHospital(state, base)) {
  if (!h.beds) return [];
  return atBase(state, base.id).filter((s) => isHurt(s) && s.role !== "medic").sort((a, b) => (b.woundInfected ? 1 : 0) - (a.woundInfected ? 1 : 0) || a.health - b.health).slice(0, h.beds);
}

// Passive heal per hour for one survivor at a base.
export function healRatePerHour(state, base, s, hosp = activeHospital(state, base), inBed = null) {
  if (!isHurt(s)) return 0;
  const bed = inBed != null ? inBed : patients(state, base).includes(s);
  let perDay = BASE_HEAL_PER_DAY + hosp.baseSkill * 0.4;
  if (bed && hosp.tier > 0) perDay += hosp.heal + hosp.staffSkill * 0.5;
  // Severe wounds heal slowly without a bed; the hospital tier sets the speed in a bed.
  if (isSevere(s)) perDay *= bed && hosp.tier > 0 ? hosp.severe : SEVERE_NO_BED;
  if (s.woundInfected) perDay = perDay * 0.5 - 2;
  return perDay / 24;
}

// Hourly: assign beds (s.inBed), passive healing at every base, infected wounds worsening everywhere.
export function medicalHour(state) {
  // Anyone not re-admitted below (away on a team, healed, staff) leaves their bed.
  for (const s of state.survivors) if (s.inBed) s.inBed = false;
  for (const base of state.bases) {
    const hosp = activeHospital(state, base);
    const beds = new Set(patients(state, base, hosp).map((s) => s.id));
    for (const s of atBase(state, base.id)) if (beds.has(s.id)) s.inBed = true;
    for (const s of atBase(state, base.id)) {
      if (!isHurt(s)) continue;
      const rate = healRatePerHour(state, base, s, hosp, beds.has(s.id));
      if (rate >= 0) s.health = Math.min(100, s.health + rate);
      else hurt(state, s, -rate, base.tile, `of an infected wound at ${base.name}`);
    }
  }
  // Away from a base an infected wound only gets worse.
  for (const s of alive(state)) {
    if (!s.woundInfected || s.location.kind !== "party") continue;
    const p = state.parties.find((x) => x.id === s.location.partyId);
    hurt(state, s, 3 / 24, p ? partyTile(p) : null, "of an infected wound");
    if (p && state.parties.includes(p) && !partyMembers(state, p).length) wipeParty(state, p);
  }
}

// Daily: automatic meds for the badly hurt (as before), infections setting in or clearing.
export function medicalDaily(state, base) {
  const rng = state.rng;
  const st = base.stock;
  const hosp = activeHospital(state, base);
  const beds = new Set(patients(state, base).map((s) => s.id));
  for (const s of atBase(state, base.id)) {
    if (!s.alive) continue;
    if (s.health < AUTO_BELOW && (st.meds || 0) >= 1) {
      st.meds -= 1;
      s.health = Math.min(100, s.health + 10 * hosp.eff);
    }
    if (s.woundInfected) {
      if (hosp.cures && beds.has(s.id) && (st.meds || 0) >= CURE_MEDS) {
        st.meds -= CURE_MEDS;
        s.woundInfected = false;
        log(state, `${s.name}'s infected wound was cleaned at the ${hosp.name} in ${base.name}.`, "good");
      } else if (s.health >= 50 && rng.chance(0.1)) {
        s.woundInfected = false;
        log(state, `${s.name}'s infected wound cleared up on its own.`, "good");
      }
    } else if (s.health < 40 && !(hosp.guards && beds.has(s.id)) && rng.chance(0.05)) {
      s.woundInfected = true;
      log(state, `${s.name}'s wounds are infected. Treat them with meds${hosp.cures ? "" : " (a Clinic or better cleans them reliably)"}.`, "danger");
    }
  }
}

// Infections set in more easily on the road (called daily for people away).
export function fieldInfectionDaily(state) {
  for (const s of alive(state)) {
    if (s.location.kind !== "party" || s.woundInfected || s.health >= 40) continue;
    if (state.rng.chance(0.08)) {
      s.woundInfected = true;
      log(state, `${s.name}'s wounds are infected out in the field. Treat them with meds.`, "danger");
    }
  }
}

// ---------- treating at a base ----------
export function treatAtBaseInfo(state, base, s) {
  const hosp = activeHospital(state, base);
  const cost = TREAT_MEDS + (s && s.woundInfected ? CURE_MEDS : 0);
  const surgery = !!(s && isSevere(s) && hosp.surgery);
  const heal = Math.round((hosp.treat + hosp.baseSkill * 0.5) * hosp.eff * (surgery ? SURGERY_MULT : 1));
  const cureChance = !s || !s.woundInfected ? 0 : hosp.cures ? 1 : Math.min(0.9, 0.25 + hosp.tier * 0.15 + hosp.baseSkill * 0.03);
  let reason = "";
  if (!s || !s.alive) reason = "Nobody to treat.";
  else if (s.location.kind !== "base" || s.location.baseId !== base.id) reason = `${s.name} is not at ${base.name}.`;
  else if (!isHurt(s)) reason = `${s.name} is not hurt.`;
  else if ((base.stock.meds || 0) < cost) reason = `Needs ${cost} meds (have ${Math.floor(base.stock.meds || 0)}).`;
  return { ok: !reason, reason, cost, heal, cureChance, hosp, surgery };
}

export function treatAtBase(state, base, survivorId) {
  const s = survivorById(state, survivorId);
  const info = treatAtBaseInfo(state, base, s);
  if (!info.ok) return info.reason;
  base.stock.meds -= info.cost;
  const before = s.health;
  s.health = Math.min(100, s.health + info.heal);
  let cure = "";
  if (s.woundInfected) {
    if (state.rng.chance(info.cureChance)) { s.woundInfected = false; cure = " The infection is cleaned out."; }
    else cure = " The wound is still infected.";
  }
  const where = info.hosp.tier ? `in the ${info.hosp.name.toLowerCase()}` : "on a cot";
  return `${s.name} ${info.surgery ? "operated on" : "treated"} ${where} at ${base.name}: health ${Math.floor(before)} → ${Math.floor(s.health)} (${info.cost} meds).${cure}`;
}

// ---------- treating in the field ----------
export const partyMeds = (p) => Math.max(0, (p.supplies.meds || 0)) + Math.max(0, (p.cargo && p.cargo.supplies.meds) || 0);

function takeMeds(p, qty) {
  const fromCargo = Math.min(qty, Math.max(0, (p.cargo && p.cargo.supplies.meds) || 0));
  if (fromCargo) p.cargo.supplies.meds -= fromCargo;
  p.supplies.meds = (p.supplies.meds || 0) - (qty - fromCargo);
}

// The team member who does the treating: best Medicine, a usable surgical kit adds to it.
function fieldMedic(state, p) {
  const members = (p.members || []).map((id) => survivorById(state, id)).filter((m) => m && m.alive);
  let best = null, bestVal = -1;
  for (const m of members) {
    // A usable surgical kit adds 3; a makeshift bandage kit adds its medKit bonus (and wears per treatment).
    const kit = m.gear.tool && m.gear.tool.key === "surgkit" && skill(m, "medicine") >= GEAR.surgkit.req - 7 ? 3 : medKitBonus(m);
    const v = skill(m, "medicine") + kit;
    if (v > bestVal) { best = m; bestVal = v; }
  }
  return { medic: best, value: Math.max(0, bestVal) };
}

export function fieldTreatInfo(state, party, s) {
  const { medic, value } = fieldMedic(state, party);
  const cost = TREAT_MEDS + (s && s.woundInfected ? CURE_MEDS : 0);
  const heal = Math.round(FIELD_HEAL + value * 0.6);
  const cureChance = s && s.woundInfected ? Math.min(0.85, 0.2 + value * 0.04) : 0;
  let reason = "";
  if (!s || !s.alive) reason = "Nobody to treat.";
  else if (!party || !(party.members || []).includes(s.id) || s.location.kind !== "party") reason = `${s.name} is not with this team.`;
  else if (!isHurt(s)) reason = `${s.name} is not hurt.`;
  else if (partyMeds(party) < cost) reason = `Needs ${cost} meds; the team carries ${Math.floor(partyMeds(party))}.`;
  return { ok: !reason, reason, cost, heal, cureChance, medic, hours: FIELD_TREAT_HOURS };
}

export function fieldTreat(state, party, survivorId) {
  const s = survivorById(state, survivorId);
  const info = fieldTreatInfo(state, party, s);
  if (!info.ok) return info.reason;
  takeMeds(party, info.cost);
  useMedKit(state, info.medic);
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
  return `${built.name}${h.staffed ? "" : ` (needs ${built.staff} medic${built.staff === 1 ? "" : "s"}, unstaffed)`}`;
}
