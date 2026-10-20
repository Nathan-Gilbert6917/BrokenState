// The AI groups' people heal by your rules (docs/adr/0001-ai-parity.md; medical.js): once a day for everyone at home,
// the same numbers your people at a base heal by, with the group's sick bay as the hospital (groupcare.js
// groupHospitalTier: the tier they built) and its own people as the medics (their Medicine, their perks):
//   - a day's rest: BASE_HEAL_PER_DAY + 0.4 × the best Medicine at home; in a bed (the sick bay's beds, worst off
//     first: a severe or infected wound, or below AUTO_BELOW) + the tier's heal + 0.5 × the best medic's; a severe wound
//     at SEVERE_NO_BED out of a bed (the tier's own speed in one); an infected wound half, less 2; a hungry day none
//     (economy.js: nobody recovers on an empty stomach); Quick Healer by its trait (traits.js healMult);
//   - infections: one sets in under 40 health (5% a day, never in a bed of a tier that guards against it), one clears
//     on its own at 50 and over (10%);
//   - treatment, as your night's automatic care (autoCare): worst off first, wounds below AUTO_BELOW or infected, one a
//     person a day, TREAT_MEDS (+CURE_MEDS to clean an infection) from the stores keeping a reserve (a meds a head
//     past four), as many as the medics' time gives (medicCapacity: 3 + Medicine / 4 a medic, 2 with nobody on it);
//     heal (the tier's treat + half the medic's Medicine) × its eff; the cure chance by the tier and the medic.
//   - the medic learns by it (skills.js gainXp, USE.wound).
// Dice: hashes of the seed, the group and its day (the world's dice untouched).
import { personKey } from "./members.js"; // dice the same in every world on the seed
import { BUILDINGS } from "./buildings.js";
import { NO_HOSPITAL, BASE_HEAL_PER_DAY, SEVERE_BELOW, SEVERE_NO_BED, AUTO_BELOW, TREAT_MEDS, CURE_MEDS, TREATS_PER_MEDIC, UNTRAINED_TREATS, hospitalTypes } from "./medical.js";
import { hash01, gainXp, USE, hasPerk } from "./skills.js";
import { healMult } from "./traits.js";
import { homeMembers, removeMember } from "./members.js";
import { groupHospitalTier, tickOf } from "./groupcare.js";

const med = (s) => (s && s.skills ? s.skills.medicine || 0 : 0);
const hurtOne = (s) => s.alive && (s.health < 100 || s.woundInfected);
// The sick bay as your hospital's numbers (medical.js activeHospital), staffed by the group's own medics.
export function groupHosp(state, f, people, tier0 = null) {
  const tier = Math.max(0, tier0 ?? groupHospitalTier(state, f) ?? 0);
  const types = hospitalTypes();
  const k = tier > 0 ? types[Math.min(tier, types.length) - 1] : null;
  const def = k ? { tier: BUILDINGS[k].tier, name: BUILDINGS[k].name, type: k, ...BUILDINGS[k].med } : NO_HOSPITAL;
  const medics = people.filter((s) => med(s) >= 3).sort((a, b) => med(b) - med(a) || a.id - b.id);
  return { ...def, staff: medics, staffSkill: medics.length ? med(medics[0]) : 0, baseSkill: Math.max(0, ...people.map(med)) };
}
// A band with no base (nomads.js bandCare: a nomad band, raiders from beyond the border) passes its own people, no
// sick bay (tier 0: rest and the night's care only) and what happens to one who dies of their wounds (died); its meds
// are its own stores' (f.stock), as a group's are.
export function groupMedicalDaily(state, f, { hungry = false, people: list = null, tier = null, died = null } = {}) {
  const people = list || homeMembers(f);
  if (!people.length) return { healed: 0, treated: 0, died: 0 };
  const hosp = groupHosp(state, f, people, tier);
  const tag = [state.seed, "groupmed", f.name, tickOf(f), Math.floor((state.hour || 0) / 24)];
  const careNeed = (s) => (s.woundInfected ? 50 : 0) + (100 - s.health);
  const beds = new Set(people.filter((s) => s.health < SEVERE_BELOW || s.woundInfected || s.health < AUTO_BELOW).sort((a, b) => careNeed(b) - careNeed(a) || a.id - b.id).slice(0, hosp.beds || 0));
  const out = { healed: 0, treated: 0, died: 0 };
  // Treatment first (the night's care: your autoCare runs before the day's healing is read).
  const medics = hosp.staff.length ? hosp.staff : people.slice().sort((a, b) => med(b) - med(a)).slice(0, 1);
  let time = hosp.staff.length ? hosp.staff.reduce((a, s) => a + TREATS_PER_MEDIC + Math.floor(med(s) / 4) + (hasPerk(s, "triage") ? 1 : 0), 0) : UNTRAINED_TREATS;
  const reserve = Math.max(0, people.length - 4);
  for (const s of people.filter((x) => x.woundInfected || x.health < AUTO_BELOW).sort((a, b) => careNeed(b) - careNeed(a) || a.id - b.id)) {
    const cost = TREAT_MEDS + (s.woundInfected ? CURE_MEDS : 0);
    if (time <= 0 || (f.stock.meds || 0) - cost < (s.woundInfected || s.health < SEVERE_BELOW ? 0 : reserve)) continue;
    const m = medics[0];
    const heal = Math.round((hosp.treat + med(m) * 0.5) * hosp.eff * (hasPerk(m, "steadyhands") ? 1.25 : 1));
    f.stock.meds -= cost;
    f.medsUsed = (f.medsUsed || 0) + cost;
    time -= 1;
    s.health = Math.min(100, s.health + heal);
    if (s.woundInfected && hash01(...tag, "cure", personKey(state, s.id)) < (hosp.cures ? 1 : Math.min(0.9, 0.25 + hosp.tier * 0.15 + med(m) * 0.03))) s.woundInfected = false;
    if (m) gainXp(state, m, "medicine", USE.wound);
    out.treated++;
  }
  for (const s of people) {
    if (!s.alive) continue;
    // Infections setting in or clearing (medical.js medicalDaily).
    if (s.woundInfected) { if (s.health >= 50 && hash01(...tag, "clear", personKey(state, s.id)) < 0.1) s.woundInfected = false; }
    else if (s.health < 40 && !(hosp.guards && beds.has(s)) && hash01(...tag, "infect", personKey(state, s.id)) < 0.05) s.woundInfected = true;
    if (!hurtOne(s)) continue;
    const bed = beds.has(s) && hosp.tier > 0;
    let perDay = BASE_HEAL_PER_DAY + hosp.baseSkill * 0.4;
    if (bed) perDay += hosp.heal + hosp.staffSkill * 0.5 + (hosp.staff.some((m) => hasPerk(m, "chiefmedic")) ? 6 : 0);
    if (s.health < SEVERE_BELOW) perDay *= bed ? hosp.severe : SEVERE_NO_BED;
    if (s.woundInfected) perDay = perDay * 0.5 - 2;
    if (hungry && perDay > 0) perDay = 0;
    if (perDay > 0) perDay *= healMult(s);
    s.health = Math.min(100, s.health + perDay);
    if (perDay > 0) out.healed++;
    if (s.health <= 0) { if (died) died(s); else removeMember(state, f, s, "died", { keepKit: true }); f.diedOfWounds = (f.diedOfWounds || 0) + 1; out.died++; }
  }
  return out;
}
