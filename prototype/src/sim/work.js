// Work priorities (the RimWorld work tab): named roles, a 1–5 priority per work type, and an hourly scheduler that
// turns them into the single role each system already reads (s.role, s.station, the lesson, the book, the repair).
//
// state.work = { roles: [role…], next, newcomers }   (created when the player first opens the Work tab)
//   role = { id, name, kind: "base" | "crew", pri: { type: 1..5 }, min: { type: skill }, sched: 24 chars, crew }
//   pri: missing / 0 = never. min: the skill a member needs for that type (Medicine 4 for Doctor, …).
//   sched: one letter per hour of the day: w work (priorities), g guard watch, f free time, s sleep.
//   crew: the field settings of a crew role (crews.js); its members work the base by `pri` while they are home.
// s.work = { role: id | null, over: { type: 0..5 }, watch? }   (no s.work / role null: Manual, today's fixed role)
//   over: one cell overridden for this person (0 = never), on top of the role's default.
//   watch: { base, was, hour, off? } while the watchtower's alarm at their base has moved Guard, a backup job of
//   theirs (set below their first priority), up to priority 1 (watchPromotions; `was` is what it was then, for the
//   UI). Their own cells are not touched: when the horde has gone, or they leave the base, the flag goes and Guard is
//   back where it was. Setting the Guard cell by hand sets `off`: their own setting holds until the alarm is over.
// s.task = what they do this hour and why (the Work tab, the roster, the survivor screen).
//
// Every hour (world.js tickHour, before stewards and the autopilot) each base with people on priorities is planned:
//   1. Not touched: Manual and pinned people (stewards still run Manual ones, steward.js / autopilot planRoles).
//   2. Health first: a hospital bed, a severe wound, an infected wound, too ill, quarantine, or days off from a card
//      → rest. Then emergencies: raiders warned or at the walls, or the defences manned → everyone with Guard set
//      (any priority) guards; a horde warned and coming, or next to the walls → as many of them as it takes to hold
//      it with a quarter to spare (defences.js hold limit), best shots first, all of them when that is not enough
//      (the ill too). Then an illness → rest until it is gone (sickrest.js: "Resting: sick (Flu)", by the Work tab's
//      "Sick people rest"; any illness, food poisoning included). Then the base's watch roster (watch.js: on their shift they stand guard; off a long one they sleep until rested,
//      sleep.js sleepingIn), then the role's schedule (guard watch, free time, sleep), then free time for anyone whose
//      mood is very low (below 25, until 40).
//   2b. The watchtower's alarm (defences.js towerWatch: a horde near a base with a watchtower): Guard counts as
//      priority 1 for everyone there who has it set lower than their first priority, and the walls take as many
//      more lookouts as it takes to hold that horde with a quarter to spare (at least one), first at priority 1.
//   3. Everyone else, priority 1 first: each work type has work now (hasWork), room for more hands (capacity) and
//      may need a skill (the role's minimum); at each priority the most urgent type and the best-skilled person go
//      first (a small bonus for staying on the same job; ties by id, then column order). Whoever finds nothing at 1
//      tries 2, and so on; nothing anywhere → rest ("idle"). The next hour starts again from 1.
//      Emergency boosts: a patient in danger with no doctor, a broken well pump or wall → the first hands with
//      that type set at any priority go to it before priority 1.
//   4. Capacity counts everyone already doing that work (Manual people too): one operator a station, the hospital's
//      medics, lessons' learners and books' copies are never booked twice.
// Daily systems (farming, stations, scavenging, XP, teaching, reading) read roles at midnight: someone asleep, on
// free time, on a watch or on the walls then is counted at their last work of the day (workDayRoles; fights are
// settled hour by hour, so the walls lose nothing); the hours off give the Rest role's mood (+6 a day) by the hour.
//
// Adding a work type (hunting, fishing …) is one entry in WORK_TYPES: name, the role it maps onto, the skill that
// orders people, open (capacity, urgency, why not), can (this person), take (the assignment) and holds (counts a
// Manual person already doing it).
import { atBase, skill, combatPower, hourOfDay, baseById, log } from "./world.js";
import { SKILLS, SKILL_NAMES } from "./data.js";
import { BUILDINGS, RECIPES, stations, underAttack, assignStations } from "./buildings.js";
import { hasOrder, orderHold, stationIO, stationOrder } from "./production.js";
import { POWER, powerWanted } from "./power.js";
import { farmersWanted, farmOf } from "./farming.js";
import { edibleFood, foodStore } from "./storage.js";
import { season } from "./weather.js";
import { hospitalDef, isHurt, isSevere } from "./medical.js";
import { tooIllToWork, isSick, isContagious } from "./health.js";
import { sickRestWhy } from "./sickrest.js"; // sick people rest (an illness at a base, by the Work tab's setting)
import { CRAFTS, craftQueue, craftQuality, meetsNeeds, craftHeld, isFilterJob, benchQuality, canAttempt, craftSkill } from "./crafting.js";
import { learnersFor, lessonOf, bestBook, bookDef, MAX_LEARNERS, TEACH_GAP } from "./skills.js";
import { doctorAt, TRAINING, lessonGap } from "./training.js"; // Medic trainees
import { studyable, canStudy, BLUEPRINTS } from "./blueprints.js";
import { FIXTURES, fixtures, brokenAt, WEAR } from "./breakdowns.js";
import { scavLeft, SCAV_FLOOR, waterOutlook, waterRunningShort, waterCapacity } from "./economy.js";
import { prisonersAt, prisonGuardsWanted, onJailRoster, jailName } from "./prisoners.js";
import { DEFENCE, wallHold, defenceMult, spikeKill, manned, towerHordes } from "./defences.js";
import { huntWorkWhy, fishWorkWhy, fishWorkHands, huntWorkCap, hunterMult, bestHuntWeapon, fisherMult } from "./hunting.js";
import { forageWorkWhy, forageWorkCap, foragerMult, FORAGE_SHORT } from "./foraging.js";
import { foodUse, HEAT, woodFor } from "./upkeep.js";
import { woodWorkWhy, woodHandsWanted, woodNeed, woodcutterMult, bestChop } from "./woodcutting.js";
import { waterIn, stockHas } from "./water.js"; // purified and un-purified water count together
import { watchShift, shiftText } from "./watch.js"; // the base's watch roster (Defence tab)
import { sleepingIn } from "./sleep.js"; // off a watch: sleep until rested
import { wormFilterUrgent, woodCritical, farmCrewLimits, FARM_AP } from "./autopilot.js"; // the governor's rules: a filter while the worm is in the water (planRoles 1b), the autumn's woodcutters (4a)
import { baseAmmo } from "./ammo.js"; // rounds by calibre: what fits the guns there

export const PRIO_MAX = 5;
const WATER_BUILDS = ["well", "rain_catcher", "cistern"]; // water first (autopilot.js waterPlan)
// Assignments a queued build may take one hand from (no station, lesson, book or repair job to give back).
const LOOSE = ["farm", "scavenge", "hunt", "fish", "forage", "wood"];
export const SCRAP_KEEP = { ammo: 50, meds: 40, parts: 60 }; // stations on a steward's or the governor's order stop below this
export const MOOD_LOW = 25, MOOD_BACK = 40;   // free time below 25 mood, back to work at 40
export const OFF_MOOD = 0.25;                 // mood an hour of sleep or free time gives (the Rest role's 6 a day)
const STICKY = 1.5;                           // staying on the same job this hour
// Upkeep hands (the Repair type with nothing to build): a building from `from` wear is worn; the wear past `to` on the
// worn ones, taken off within `days` at WEAR.upkeep a hand a day (breakdowns.js), sizes the crew (tune-jobcaps).
const UPKEEP = { from: 50, to: 30, days: 20 };

// ---------- the schedule ----------
export const SCHED = {
  w: { name: "Work", short: "W", desc: "Works by the role's priorities." },
  g: { name: "Guard watch", short: "G", desc: "Stands guard (counts 1.5× in a fight), whatever the priorities say." },
  f: { name: "Free time", short: "F", desc: "Off work: rests and recovers mood (as the Rest role does, by the hour)." },
  s: { name: "Sleep", short: "S", desc: "Asleep: rests and recovers mood (as the Rest role does, by the hour). Wakes for an emergency." },
};
export const SCHED_PRESETS = {
  any:   { name: "Anytime", sched: "w".repeat(24) },
  day:   { name: "Day shift (sleep 22–06)", sched: "ssssss" + "w".repeat(14) + "ff" + "ss" },
  night: { name: "Night watch (guard 20–04)", sched: "gggg" + "ssssssss" + "wwwwwwww" + "gggg" },
  guard: { name: "On guard all day", sched: "g".repeat(24) },
};
const ANY = SCHED_PRESETS.any.sched;
export const schedAt = (role, h) => {
  const c = role && typeof role.sched === "string" && role.sched.length === 24 ? role.sched[h] : "w";
  return SCHED[c] ? c : "w";
};

// ---------- work types ----------
// open(ctx) → { cap, urg, why }: hands wanted now (Manual people already on it count), how urgent (0–10), and why
// none. can(ctx, s) → "" or why not this person. take(ctx, s) → { role, station?, note? } or null (ctx.why says).
// holds(ctx, s, role, station): is this (fixed) person already doing it? Default: their role is `role`.
const n0 = (v) => Math.round(v || 0);
const stationKind = (st) => (BUILDINGS[st.type] && BUILDINGS[st.type].station) || null;
// Days of food a base wants before the farms may take fewer hands: the governor's seasonal target (autopilot.js
// foodTarget, without its winter plan) × 1.5, at least 40.
function foodGoal(state) {
  const s = season(state);
  const t = s.key === "autumn" ? 55 : s.key === "winter" ? s.daysLeft + 25 : s.key === "summer" ? 12 + Math.max(0, 28 - s.daysLeft) * 1.5 : 15;
  return Math.max(40, t * 1.5);
}

export const WORK_TYPES = {
  doctor: {
    name: "Doctor", ing: "On medic duty", short: "Doc", role: "medic", skill: "medicine",
    desc: "Medic on duty: with an infirmary or hospital while anyone here is hurt or sick (it needs 1–3 by tier); without one only for the badly hurt, infected or ill. Treats wounds and illness; leaves when everyone is healed, unless trainees are learning here (then one stays: the doctor teaches them on duty).",
    open(ctx) {
      const { base, people } = ctx;
      const hosp = hospitalDef(base);
      const onDuty = people.some((s) => s.role === "medic");
      const line = hosp.tier > 0 ? (onDuty ? 100 : 95) : 50;
      const pts = people.filter((s) => s.woundInfected || isSick(s) || (isHurt(s) && s.health < line));
      // Trainees learning here keep the doctor on duty on a quiet ward (training.js: off duty the lessons are halved).
      if (!pts.length) return hosp.tier > 0 && people.some((s) => s.role === "trainee") && docOf(ctx) ? { cap: 1, urg: 2 } : { cap: 0, why: "nobody here needs care" };
      const danger = pts.some((s) => isSevere(s) || s.woundInfected);
      return { cap: Math.max(1, hosp.tier > 0 ? hosp.staff : 1), urg: 4 + (danger ? 3 : 0) + Math.min(3, pts.length / 2), danger };
    },
    // A patient in danger and nobody on duty: the first person with Doctor set goes, whatever its priority.
    emergency(ctx) { const o = this.open(ctx); return o.danger && !ctx.people.some((s) => s.role === "medic" && !ctx.free.has(s)) ? { slots: 1, why: "a patient is in danger" } : null; },
  },
  // Medic trainees (training.js): learn Medicine from the doctor on the ward; the hospital tier's places are the cap.
  trainee: {
    name: "Trainee", ing: "Training on the ward", short: "Trn", role: "trainee", skill: "medicine",
    desc: "Medic trainee: works on the ward of the infirmary or hospital and learns Medicine from the doctor (the best medic here, Medicine 6+) every day, up to 1 below the doctor's (a trauma hospital: up to the doctor's own). Counts as half a medic toward the hospital's staff. Places: 1 (infirmary, field hospital), 2 (clinic), 3 (trauma hospital).",
    open(ctx) {
      const def = hospitalDef(ctx.base);
      if (!def.tier || !def.train) return { cap: 0, why: "no infirmary or hospital" };
      if (!docOf(ctx)) return { cap: 0, why: `no doctor here (Medicine ${TRAINING.docMin}+)` };
      return { cap: def.train, urg: 1.5 };
    },
    can(ctx, s) {
      const doc = docOf(ctx);
      if (!doc || doc.s === s) return "they are the best medic here";
      const cap = skill(doc.s, "medicine") - lessonGap(hospitalDef(ctx.base));
      return skill(s, "medicine") < cap ? "" : `Medicine ${skill(s, "medicine")}: lessons go up to ${cap}`;
    },
  },
  guard: {
    name: "Guard", ing: "On guard", short: "Grd", role: "guard", skill: "shooting",
    desc: "A lookout on the walls (one at a base of 4+, two at 12+, one more while a horde is in sight, one more for prisoners in the cells and one per 4 of them out at work: the jail's own guards, named on the Prisoners tab, fill those first and guard it in their Work hours). While a watchtower sees a horde near, Guard is priority 1 for everyone who has it set as a backup job, and the walls take as many more as it takes to hold that horde (at least one), before any other work. Raid and horde warnings send everyone with Guard set to the walls (an emergency).",
    open(ctx) {
      const n = ctx.people.length;
      const watch = ctx.threat.watch ? Math.max(1, ctx.watchNeed || 0) : 0; // the watchtower's alarm: the hands to hold the horde it sees
      const cap = (n >= 4 ? 1 : 0) + (n >= 12 ? 1 : 0) + (ctx.threat.standing ? 1 : 0) + watch + prisonGuardsWanted(ctx.state, ctx.base); // prisoners-tab: one for the cells, one per 4 prisoners out at work
      return cap ? { cap, urg: watch ? 9 : ctx.threat.standing ? 6 : 2 } : { cap: 0, why: "no lookout needed (fewer than 4 people, nothing in sight)" };
    },
    rank: (s) => combatPower(s) * 2,
  },
  farm: {
    name: "Farm", ing: "Farming", short: "Farm", role: "farm", skill: "farming",
    desc: "Tends, sows and harvests the plots. Wants about 1.2 farmers a plot in use, up to 1.9 while food is short of the season's target or of the winter stores. While food is comfortable (at its target, and the winter stores with twice their safety margin) the crew is capped at about a third of the people here, as the governor does: a plot nobody tends still gives half, and the freed hands go to the next work. Pinned and Manual farmers always stay.",
    // The governor's rule (autopilot.js farmCrewLimits, planRoles step 2): the extra crew only while hungry, and the
    // crew capped at FARM_AP.share of the people while comfortable. The cap counts Manual and pinned farmers (ctx.used:
    // they are never moved) and only limits the hands priorities put on the plots; capNote is what those turned away read.
    open(ctx) {
      const fw = farmersWanted(ctx.state, ctx.base);
      if (fw.active + fw.toSow <= 0) return { cap: 0, why: "no crops to tend or sow" };
      const days = ctx.foodDays;
      const ripe = farmOf(ctx.state, ctx.base).plots.some((p) => p.stage === "ripe");
      const lim = farmCrewLimits(ctx.state, ctx.base, days, ctx.people.length);
      const want = Math.max(fw.need, lim.hungry ? Math.ceil(fw.ideal * FARM_AP.extra) : fw.ideal);
      const cap = Math.min(want, lim.cap);
      const plots = fw.active + fw.toSow, tended = Math.min(plots, Math.floor((cap * plots) / Math.max(1, fw.ideal)));
      return { cap, urg: (days < 7 ? 8 : days < 20 ? 5 : 3) + (ripe ? 1 : 0), capNote: cap < want ? `Farm crew capped: food is comfortable (${tended} of ${plots} plots tended)` : "" };
    },
  },
  cook: {
    name: "Preserve", ing: "Preserving", short: "Cook", role: "operate", skill: "farming",
    desc: "Runs the preserving kitchen: jars fresh food that would spoil. By its standing order, or without one while food is spoiling outside or piling up for winter.",
    open: (ctx) => stationOpen(ctx, (k) => k === "preserve", "no preserving kitchen"),
    take: (ctx, s) => takeStation(ctx, s, (k) => k === "preserve"),
    holds: (ctx, s, role, st) => role === "operate" && stationKindById(ctx, st) === "preserve",
  },
  workshop: {
    name: "Workshop", ing: "At the workshop", short: "Shop", role: "operate", skill: "mechanics",
    desc: "Runs a workshop station: ammo bench, med station, machine shop, still or generator, one operator each. By the station's standing order (Workshops tab); without one only while the base is short of what it makes. Unless the order is yours, the scrap the next building needs is left alone (ammo under 50, meds 40, parts 60).",
    open: (ctx) => stationOpen(ctx, (k) => k !== "preserve", "no workshop station"),
    take: (ctx, s) => takeStation(ctx, s, (k) => k !== "preserve"),
    holds: (ctx, s, role, st) => role === "operate" && st != null && stationKindById(ctx, st) !== "preserve",
    rank: (s, ctx) => Math.max(0, ...ctx.stationKinds.filter((k) => k !== "preserve").map((k) => skill(s, (RECIPES[k] && RECIPES[k].skill) || "mechanics"))),
  },
  craft: {
    name: "Craft", ing: "Crafting", short: "Craft", role: "craft", skill: "crafting",
    desc: "Works the craft queue by hand (base Crafting tab): one crafter at a time. Needs the recipe's skill. A queued job keeps one hand: someone with Craft set leaves scavenging, or the plots when they have more than their crew, for it; a water filter while the water runs short pulls the first hand with Craft set. A water filter the governor or a steward queued waits while the tanks are three-quarters full and something is queued to build (its scrap goes to the build first); the jobs behind it go first. As the queue never waits for spare hands, the governor or a steward queues crafts that can wait only from scrap past what the next building needs.",
    open(ctx) {
      const jobs = openCrafts(ctx);
      if (!jobs.length) return { cap: 0, why: craftQueue(ctx.base).length ? (craftQueue(ctx.base).every((j) => craftHeld(ctx.state, j)) ? "the water filter waits: the tanks are full enough and a build is queued" : "the queued crafts need a workshop") : "nothing in the craft queue" };
      const water = jobs.some(isFilterJob) && waterIn(ctx.base.stock) < ctx.people.length * 3;
      return { cap: 1, urg: 3 + (water ? 4 : 0) }; // one crafter, as the governor: a queue that empties fast gets refilled, and every craft is paid in scrap the build queue wants
    },
    // The governor's rule (autopilot.js planRoles 1b): a queued water filter gets its crafter first while the water
    // is running short (thirst kills in days; a hungry base still has its stock).
    // ...and while the water carries the worm's eggs and nothing boils it (wormFilterUrgent: no boiler, or one the land
    // cannot feed), as the governor since the worm: without it priorities crafted half the governor's filters.
    emergency(ctx) {
      if (ctx.used.craft > 0 || !openCrafts(ctx).some(isFilterJob)) return null;
      if (waterRunningShort(ctx.state, ctx.base)) return { slots: 1, why: "the water is running short and a water filter is queued" };
      if (wormFilterUrgent(ctx.state, ctx.base)) return { slots: 1, why: "the water carries the worm's eggs, nothing boils it and a water filter is queued" };
      return null;
    },
    can(ctx, s) {
      const ok = openCrafts(ctx).some((j) => {
        const r = CRAFTS[j.recipe];
        return r && meetsNeeds(ctx.base, r) && canAttempt(s, r) && (!j.minQ || !r.gear || benchQuality(craftQuality(craftSkill(s), r, false, ctx.state), ctx.base) + 1e-9 >= j.minQ);
      });
      return ok ? "" : "not skilled enough for anything queued";
    },
    rank: (s, ctx) => craftSkill(s), // crafting.js: quality and speed come from Crafting (the recipe's own skill is only its minimum)
  },
  build: {
    name: "Build", ing: "Building", short: "Build", role: "build", skill: "mechanics",
    desc: "Works the construction queue: one builder per 40 work-hours queued, up to 3 (4 while a well, rain catcher or cistern is queued: water comes first, ahead of a hungry farm). A queued build always keeps one hand with Build set, even when the farm would take everyone. Stops while the base is on alert or under siege.",
    open(ctx) {
      const q = ctx.base.construction;
      if (!q.length) return { cap: 0, why: "nothing to build" };
      if (underAttack(ctx.state, ctx.base)) return { cap: 0, why: "on alert: nobody builds" };
      const left = q.reduce((a, j) => a + j.hours - j.progress, 0);
      const water = q.some((j) => WATER_BUILDS.includes(j.type));
      // before a comfortable farm (3), after a hungry one (5+); water (the summer plan) before both
      return { cap: Math.min(water ? 4 : 3, Math.max(1, Math.ceil(left / 40)) + (water ? 1 : 0)), urg: water ? 7 : 4.5, water };
    },
  },
  repair: {
    name: "Repair", ing: "Repairing", short: "Fix", role: "build", skill: "mechanics",
    desc: "Repairs broken buildings (the Repairs tab; a repair is started by itself when the base can pay; one hand a repair), worked 08:00–20:00, and keeps worn ones in shape when nothing is being built (as many as the wear wants). A broken well pump, well or wall pulls the first hands with Repair set.",
    // A repair is one hand a job; upkeep has no fixed cap (tune-jobcaps: it was one hand): ctx.upkeepHands, the wear
    // past UPKEEP.to on the worn buildings taken off within UPKEEP.days.
    open(ctx) {
      const open = ctx.repairJobs.filter((j) => !ctx.repairTaken.has(j.id));
      const upkeep = !ctx.base.construction.length && ctx.worn > 0 ? ctx.upkeepHands : 0;
      if (!open.length && !upkeep) return { cap: 0, why: "nothing broken or worn" };
      return { cap: open.length + upkeep, urg: open.length ? 6 : 1 };
    },
    emergency(ctx) {
      const crit = brokenAt(ctx.base).filter((fx) => ["pump", "well", "walls", "gate"].includes(fx.type)).length;
      return crit ? { slots: crit, why: "a well or the walls are broken" } : null;
    },
    can(ctx, s) {
      const open = ctx.repairJobs.filter((j) => (j.who == null || j.who === s.id) && !ctx.repairTaken.has(j.id) && skill(s, "mechanics") >= j.min);
      if (open.length || (!ctx.base.construction.length && ctx.worn > 0)) return "";
      return "not skilled enough for the repair";
    },
    take(ctx, s) {
      const jobs = ctx.repairJobs.filter((j) => (j.who == null || j.who === s.id) && skill(s, "mechanics") >= j.min && !ctx.repairTaken.has(j.id));
      const j = jobs.find((x) => x.who === s.id) || jobs[0];
      if (j) { ctx.repairTaken.add(j.id); return { role: "build", repair: j.id, note: `repairing the ${j.name}` }; }
      if (!ctx.base.construction.length && ctx.worn > 0 && ctx.upkeepTaken < ctx.upkeepHands) { ctx.upkeepTaken++; return { role: "build", note: "upkeep on worn buildings" }; }
      ctx.why = "the repairs have their hands";
      return null;
    },
    holds: () => false, // repairers keep their role (breakdowns.js): counted by job instead
  },
  teach: {
    name: "Teach", ing: "Teaching", short: "Tch", role: "teach", skill: "leadership",
    desc: "Teaches a skill to up to 2 people here whose skill is at least 4 below theirs (learners keep their own jobs). As many teachers as there are learners nobody teaches yet.",
    // No fixed cap (tune-jobcaps: it was one teacher, two at 12+): the learners are the limit (each teacher takes up to
    // MAX_LEARNERS nobody else teaches, lessonFor), and Teach sits below the producing work in every default role.
    open(ctx) {
      return ctx.people.length >= 3 ? { cap: ctx.people.length, urg: 1 } : { cap: 0, why: "too few people to teach" };
    },
    can: (ctx, s) => (lessonFor(ctx, s) ? "" : `nobody here ${TEACH_GAP}+ below them in a skill`),
    take(ctx, s) {
      const l = lessonFor(ctx, s);
      if (!l) { ctx.why = "no free learners"; return null; }
      for (const id of l.learners) ctx.learners.add(id);
      return { role: "teach", teach: l, note: `${SKILL_NAMES[l.skill]} to ${l.learners.length}` };
    },
    rank: (s) => skill(s, "leadership") + skill(s, "speech"),
  },
  study: {
    name: "Study", ing: "Studying", short: "Read", role: "read", skill: null,
    desc: "Studies a blueprint or manual in the armory, or reads a skill book (one reader a copy; comics and novels only when spirits are low). A manual or blueprint nobody studies yet pulls the best qualified person with Study set (whatever its priority) while food is not down to days and nothing attacks: the buildings and crafts it unlocks (cisterns, the trench, the clinic …) wait for it.",
    open(ctx) {
      const bp = studyable(ctx.state, ctx.base).length;
      const books = Object.values(ctx.books).reduce((a, v) => a + Math.max(0, v), 0);
      return bp + books ? { cap: bp + books, urg: bp ? 2 : 1 } : { cap: 0, why: "no books or blueprints here" };
    },
    // The governor's rule (blueprints.js planBlueprintStudy): a manual or blueprint in the armory gets a reader.
    emergency(ctx) {
      if (ctx.threat.urgent || ctx.foodDays < 4) return null;
      const open = studyable(ctx.state, ctx.base).filter((id) => !ctx.studying.has(id));
      return open.length ? { slots: open.length, why: "a manual or blueprint to study (it unlocks buildings or crafts)" } : null;
    },
    emergencyCan: (ctx, s) => studyable(ctx.state, ctx.base).some((id) => canStudy(s, id) && !ctx.studying.has(id)),
    rank: (s, ctx) => Math.max(0, ...studyable(ctx.state, ctx.base).filter((id) => canStudy(s, id)).map((id) => skill(s, BLUEPRINTS[id].skill))),
    can: (ctx, s) => (studyFor(ctx, s) ? "" : "nothing here they can learn from"),
    take(ctx, s) {
      const r = studyFor(ctx, s);
      if (!r) { ctx.why = "the copies are taken"; return null; }
      if (r.bp) ctx.studying.add(r.bp); else ctx.books[r.book]--;
      return { role: "read", ...r, note: r.bp ? "a blueprint" : bookDef(r.book) ? "a book" : "" };
    },
  },
  scavenge: {
    name: "Scavenge", ing: "Scavenging", short: "Scav", role: "scavenge", skill: "scavenging",
    desc: "Picks through the ruins around the base: usually finds nothing, and the area is picked over for good. Real supplies come from trips (crews).",
    open: (ctx) => (scavLeft(ctx.base) > SCAV_FLOOR + 0.02 ? { cap: 99, urg: 0 } : { cap: 0, why: "the surroundings are picked clean" }),
  },
  // Food from the land (hunting.js): the hunting cabin's hunters and the fishers of a base by the water.
  hunt: {
    name: "Hunt", ing: "Hunting", short: "Hunt", role: "hunt", skill: "shooting",
    desc: "Hunts the land within 2 tiles with a Hunting cabin here while food is short of the season's goal (as many as it takes to bring the stores up, no fixed cap: each takes the best ground left, so a crowd hunts poorer land), 3 hours a day at dawn and dusk by the base's hunting mix (Farming tab: traps, bows, guns): their own rifle or gun (this base's ammo: shots add Heat and can draw the dead), bow (this base's arrows: silent) or snares (silent, less food; also without a weapon). Fresh game spoils fast; the land runs short of game when hunted hard and grows back over weeks.",
    open(ctx) {
      const why = huntWorkWhy(ctx.state, ctx.base);
      if (why) return { cap: 0, why };
      const days = ctx.foodDays;
      if (days >= foodGoal(ctx.state)) return { cap: 0, why: `food is plentiful (${Math.floor(days)} days)` };
      // No fixed cap (tune-jobcaps: it was 2): hunters to close the food the land must bring in (hunting.js huntWorkCap).
      return { cap: huntWorkCap(ctx.state, ctx.base, foodGoal(ctx.state)), urg: days < 7 ? 7 : days < 20 ? 4.5 : 2.5 };
    },
    rank: (s) => hunterMult(s) * 10 * (bestHuntWeapon(s) ? 1 : 0.4),
  },
  fish: {
    name: "Fish", ing: "Fishing", short: "Fish", role: "fish", skill: "scouting",
    desc: "Fishes the river or lake by this base 3 hours a day while food is short of the season's goal: one fishing rod or net each (carried or in the armory), as many as it takes to bring the stores up (each one past the first catches a little less at the one spot). Fresh fish spoils fast; a fished-out spot comes back in a week or two.",
    open(ctx) {
      const why = fishWorkWhy(ctx.state, ctx.base);
      if (why) return { cap: 0, why };
      const days = ctx.foodDays;
      if (days >= foodGoal(ctx.state)) return { cap: 0, why: `food is plentiful (${Math.floor(days)} days)` };
      return { cap: fishWorkHands(ctx.state, ctx.base, foodGoal(ctx.state)), urg: days < 7 ? 6.5 : days < 20 ? 4 : 2 }; // one rod or net each, sized to the need
    },
    rank: (s) => fisherMult(s) * 10,
  },
  // Wild food around the base (foraging.js): berries, nuts, mushrooms, greens, roots, by the season.
  forage: {
    name: "Forage", ing: "Foraging", short: "Forg", role: "forage", skill: "farming",
    desc: "Gathers wild food within 2 tiles of the base 6 hours a day while food is short (under 25 days): about a ration a day each in summer, more in autumn, little in spring, nothing worth it in winter. As many as it takes to bring the stores up (no fixed cap: each picks the best ground left, so a crowd strips the land faster). Farming and Scouting help; the land picked hard grows back over weeks.",
    open(ctx) {
      const why = forageWorkWhy(ctx.state, ctx.base);
      if (why) return { cap: 0, why };
      const days = Math.min(ctx.foodDays, edibleFood(ctx.base) / Math.max(1, foodUse(ctx.state, ctx.base).total)); // everyone fed here (upkeep.js)
      if (days >= Math.min(FORAGE_SHORT, foodGoal(ctx.state))) return { cap: 0, why: `food is not short (${Math.floor(days)} days)` };
      return { cap: forageWorkCap(ctx.state, ctx.base, Math.min(FORAGE_SHORT, foodGoal(ctx.state))), urg: days < 7 ? 6.5 : days < 14 ? 4 : 2 }; // sized to the need, no fixed cap
    },
    rank: (s) => foragerMult(s) * 10,
  },
  // Firewood for the winter's heating (woodcutting.js): felled trees, deadfall, fence rails, by the land around.
  wood: {
    name: "Cut wood", ing: "Cutting wood", short: "Wood", role: "wood", skill: "farming",
    desc: "Cuts firewood within 2 tiles of the base 6 hours a day while the store is short of what the coming cold needs (15, 1.5 kg, a head a day below freezing; the water boiler 6 a head a day): forest best (about 140 a day each with an axe), hills fair, farmland and suburbs little, a city next to nothing. As many as it takes to have the pile in within three weeks (no fixed cap; each one past the first brings in 5% less, at least half). Their own axe, machete or sledgehammer, or one from the armory, cuts much faster than bare hands. Loud (base Heat), and axes slip; the land cut hard grows back over seasons.",
    open(ctx) {
      const why = woodWorkWhy(ctx.state, ctx.base);
      if (why) return { cap: 0, why };
      const w = woodNeed(ctx.state, ctx.base);
      if (!w.short) return { cap: 0, why: w.need > 0 ? `enough firewood for the cold ahead (${Math.floor(w.have)} of ${w.need})` : "no heating needed here" };
      const burn = Math.max(0.1, w.heads * woodFor(HEAT.fuel) + (w.boiler || 0)); // a day's heating and boiling
      const urg = w.cold ? (w.have < burn * 5 ? 7 : 4.5) : w.toCold <= 14 ? 5 : w.soon ? 3 : 1;
      return { cap: Math.max(1, woodHandsWanted(ctx.state, ctx.base, { w })), urg }; // sized to the need (the pile in within 3 weeks), no fixed cap
    },
    // The governor's rule (autopilot.js planRoles 4a, planWood): from autumn (the cold within WOOD_AP.autumn days, or
    // here, or a water boiler burning wood) the woodcutters it takes to have the pile in by the cold go before the
    // farm and the builders, up to a quarter of the people (one at a base of 3 or fewer; in late summer one). Cut wood
    // sits at 3 in every default role under Farm at 1-2, so with the plots short of hands nobody cut wood at all and the
    // hub stocked its winter by woodcutting trips alone (12 a season on worktest's seed 8 to the governor's 3, each
    // three people away for a day or two: 8% fewer buildings than the governor).
    emergency(ctx) {
      if (ctx.base.tier === 0 || (ctx.state.governor && ctx.state.governor.noWood) || woodWorkWhy(ctx.state, ctx.base)) return null; // gov.noWood: the test switch (woodtest.js)
      const w = woodNeed(ctx.state, ctx.base);
      if (!w.short || !w.soon || w.need <= 0) return null;
      const critical = woodCritical(ctx.state, ctx.base, w, ctx.people.length); // the governor's rule (autopilot.js): by the cold (and the boiler's), no fixed cap
      const slots = critical - ctx.used.wood;
      return slots > 0 ? { slots, why: `the winter's firewood (${Math.floor(w.have)} of ${w.need}, ${w.toCold} days to the cold)` } : null;
    },
    emergencyCan: (ctx, s) => (s.health ?? 100) >= 50 && !s.woundInfected && (ctx.people.length <= 3 || !s.leader),
    rank: (s) => woodcutterMult(s) * 10 * bestChop(s).mult,
  },
};
export const WORK_KEYS = Object.keys(WORK_TYPES);

// The craft jobs that can be worked here now: a workshop if they need one, not held back (holdFilters).
const openCrafts = (ctx) => craftQueue(ctx.base).filter((j) => CRAFTS[j.recipe] && meetsNeeds(ctx.base, CRAFTS[j.recipe]) && !craftHeld(ctx.state, j));
// A water filter the governor or a steward queued (planCrafts: for the summer and dry spells, or wells that cannot keep
// up) waits while the tanks are at least FILTER_HOLD full and the water is not running short; the crafter works the
// jobs behind it meanwhile (crafting.js craftJobStatus skips it). Crafted into full tanks, its 3 a day mostly spilled
// over while it clogged up day by day (and was queued again from scrap the build queue wanted; since tune-jobcaps a
// filter clogs only on the days it is in use, crafting.js filtersInUse, but its scrap still went early), and its water hides
// the dry-day shortfall the governor builds rain catchers for (5 scrap, for good). The governor's own roles leave such
// a filter queued until spare hands or a shortage come along (planRoles); crafted the moment someone with Craft set is
// free, priorities finished 286 crafts to the governor's 152 and 7% fewer buildings over worktest's 40 runs. A filter
// already started, or one in the player's own queue, is left alone.
// Only while something is queued to build: those spare hands are what the governor crafts its filters with. Over
// worktest's 40 runs 100 of its 158 filters were crafted into tanks ¾ full with nothing queued to build (7 with a build
// queued); held then too, priorities crafted 114 and 185 crafts in all to its 213 (the held filters also fill the
// queue, planCrafts queues no gear past 3 jobs). Released with nothing to build: 292 crafts, buildings 1301 to 1323
// (on 8 rolls 2630 to 2635), food still ahead.
const FILTER_HOLD = 0.75;
function holdFilters(state, base) {
  const q = craftQueue(base);
  if (!q.some(isFilterJob)) return;
  const auto = !!state.autopilot || !!(base.steward && base.steward.on && base.steward.areas && base.steward.areas.production !== false);
  // Never while the water carries the worm's eggs and nothing boils it (autopilot.js wormFilterUrgent): that filter is
  // for safe water, not more of it, and planCrafts put it at the front of the queue for the crafter the rule above spares.
  const hold = auto && base.construction.length > 0 && waterIn(base.stock) >= waterCapacity(base) * FILTER_HOLD && !waterRunningShort(state, base) && !wormFilterUrgent(state, base);
  for (const j of q) {
    if (!isFilterJob(j)) continue;
    if (hold && !(j.progress > 0)) j.held = state.hour;
    else delete j.held;
  }
}

function stationKindById(ctx, id) {
  if (id == null) return null;
  const st = ctx.stationList.find((x) => x.id === id);
  return st ? stationKind(st) : null;
}

// Does a station have work now? "" = yes, else why not. A standing order (production.js, the player's or a
// steward's) decides; without one, automation runs it only while the base is short of what it makes.
export function stationWork(state, base, st, opsNow = new Set()) {
  if (st.broken) return "broken (Repairs tab)";
  const k = stationKind(st);
  const n = Math.max(1, atBase(state, base.id).length);
  const s = base.stock;
  // The scrap the build queue needs is kept back unless the player's own order says otherwise (a steward's or the
  // governor's order only sets the stock target, like the governor's stationWorth).
  const own = hasOrder(base, st) && stationOrder(base, st).by === "player";
  if (hasOrder(base, st)) {
    const hold = orderHold(state, base, st);
    if (hold) return hold;
  } else if (k === "ammo") { const a = baseAmmo(state, base); if (a >= n * 15 + 60) return `enough ammo (${n0(a)} rounds that fit the guns here; no order set)`; } // ammo.js
  else if (k === "meds") { if ((s.meds || 0) >= Math.max(5, n)) return `enough meds (${n0(s.meds)}; no order set)`; }
  else if (k === "parts") { if ((s.parts || 0) >= 8) return `enough parts (${n0(s.parts)}; no order set)`; }
  // Priorities staff a station as soon as it has work (the governor only with hands left over), so the floor is
  // higher than the governor's: enough scrap stays for the next building to be queued (walls 25, a bunkhouse 20,
  // plus the 10 the governor keeps back).
  if (!own) {
    if (k === "ammo" && (s.scrap || 0) < SCRAP_KEEP.ammo) return `scrap kept for building (under ${SCRAP_KEEP.ammo})`;
    if (k === "meds" && ((s.scrap || 0) < SCRAP_KEEP.meds || (s.food || 0) < n * 6)) return `scrap kept for building (under ${SCRAP_KEEP.meds}) or food short`;
    if (k === "parts" && ((s.scrap || 0) < SCRAP_KEEP.parts || !atBase(state, base.id).some((p) => skill(p, "mechanics") >= 4))) return `scrap kept for building (under ${SCRAP_KEEP.parts}), or nobody with Mechanics 4`;
  }
  // Water is tight (it runs out within 8 days): no water into the kitchen or the still, as the governor rations.
  if ((k === "preserve" || k === "still") && !own) { const wo = waterOutlook(state, base); if (wo.net < 0 && wo.daysLeft < 8) return `water kept for drinking (${Math.floor(wo.daysLeft)} days left)`; }
  if (!hasOrder(base, st) && k === "preserve") {
    const store = foodStore(state, base);
    const sk = season(state).key;
    if ((s.food || 0) < n * 14 + 9) return "food kept for eating (no order set)";
    if (!(store.outside >= 1 || ((sk === "summer" || sk === "autumn") && (s.food || 0) >= Math.min(store.cap * 0.6, n * 25)))) return "nothing spoiling (no order set)";
  } else if (!hasOrder(base, st) && k === "still") {
    if (!(foodStore(state, base).outside >= 1 || edibleFood(base) / n >= 30)) return "no surplus food (no order set)";
    if (waterIn(s) < n * 2 + 2) return "water kept for drinking";
  }
  if (k === "power") {
    if ((s.fuel || 0) < POWER.genFuel) return "no fuel";
    return powerWanted(state, base, (b) => opsNow.has(b.id) || !BUILDINGS[b.type].station) > 0 ? "" : "nothing to power";
  }
  const io = stationIO(state, base, st);
  const missing = Object.entries(io.in).filter(([key, v]) => (s[key] || 0) < v).map(([key]) => key);
  return missing.length ? `waiting for ${missing.join(", ")}` : "";
}

function stationOpen(ctx, kindOk, none) {
  const list = ctx.stationList.filter((st) => kindOk(stationKind(st)));
  if (!list.length) return { cap: 0, why: none };
  const free = list.filter((st) => !ctx.stations.has(st.id));
  const ok = free.filter((st) => !ctx.stationWhy(st));
  if (!ok.length) {
    const why = free.length ? ctx.stationWhy(free[0]) : "every station has its operator";
    return { cap: 0, why: `${BUILDINGS[(free[0] || list[0]).type].name.toLowerCase()}: ${why}` };
  }
  const urgent = ok.some((st) => ["ammo", "meds"].includes(stationKind(st)) && stockHas(ctx.base.stock, stationKind(st)) < ctx.people.length * 2);
  // capacity counts the stations still free: holders were already left out
  return { cap: ok.length + ctx.used[kindOk("preserve") ? "cook" : "workshop"], urg: 2 + (urgent ? 3 : 0) };
}
function takeStation(ctx, s, kindOk) {
  const ok = ctx.stationList.filter((st) => kindOk(stationKind(st)) && !ctx.stations.has(st.id) && !ctx.stationWhy(st));
  if (!ok.length) { ctx.why = "every station that has work is taken"; return null; }
  const sk = (st) => skill(s, (RECIPES[stationKind(st)] && RECIPES[stationKind(st)].skill) || "mechanics") + (s.station === st.id ? 3 : 0);
  const st = [...ok].sort((a, b) => sk(b) - sk(a) || a.id - b.id)[0];
  ctx.stations.add(st.id);
  return { role: "operate", station: st.id, note: `the ${BUILDINGS[st.type].name.toLowerCase()}` };
}

// The doctor at this base for the Trainee type (training.js doctorAt), once per plan.
function docOf(ctx) {
  if (!ctx.memo.has("doc")) ctx.memo.set("doc", doctorAt(ctx.state, ctx.base));
  return ctx.memo.get("doc");
}

// The best lesson T can give to learners nobody else teaches this hour (skills.js bestLesson's scoring).
function lessonFor(ctx, T) {
  const key = `l${T.id}`;
  if (ctx.memo.has(key) && ctx.memo.get(key).gen === ctx.learners.size) return ctx.memo.get(key).v;
  let best = null, bestV = 0;
  for (const k of SKILLS) {
    const ls = learnersFor(ctx.state, T, k).filter((L) => !ctx.learners.has(L.id)).slice(0, MAX_LEARNERS);
    if (!ls.length) continue;
    const v = ls.reduce((a, L) => a + Math.min(8, skill(T, k) - TEACH_GAP - skill(L, k) + 1), 0) + skill(T, k) * 0.1 + (T.teach && T.teach.skill === k ? 0.5 : 0);
    if (v > bestV) { best = { skill: k, learners: ls.map((L) => L.id) }; bestV = v; }
  }
  ctx.memo.set(key, { gen: ctx.learners.size, v: best });
  return best;
}
// A blueprint they can study that nobody else is on, else the best free book (comics and novels only when glum).
function studyFor(ctx, s) {
  const bp = studyable(ctx.state, ctx.base).filter((id) => canStudy(s, id) && !ctx.studying.has(id));
  if (bp.length) return { bp: bp.includes(s.studying) ? s.studying : bp[0] };
  const k = bestBook(s, ctx.books, ctx.state); // an unread craft book counts (blueprints.js)
  if (!k || (!bookDef(k).skill && s.mood >= 55)) return null;
  return { book: k };
}

// ---------- roles ----------
const P = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v > 0));
export const DEFAULT_ROLES = () => [
  { name: "Generalist", pri: P({ doctor: 3, guard: 4, farm: 2, cook: 3, workshop: 3, craft: 4, build: 2, repair: 2, hunt: 4, fish: 4, forage: 4, wood: 3, teach: 4, study: 4, scavenge: 4 }) },
  { name: "Farmer", pri: P({ farm: 1, cook: 2, hunt: 3, fish: 3, forage: 3, wood: 3, repair: 3, build: 3, study: 4, scavenge: 4 }) },
  { name: "Builder", pri: P({ build: 1, repair: 1, workshop: 2, craft: 3, farm: 3, wood: 3, study: 4, scavenge: 4 }) },
  { name: "Guard", pri: P({ guard: 1, repair: 3, build: 3, farm: 4 }), sched: SCHED_PRESETS.guard.sched },
  { name: "Medic", pri: P({ doctor: 1, trainee: 2, study: 2, teach: 3, craft: 3, farm: 4, scavenge: 4 }), min: { doctor: 2 } },
  { name: "Crafter", pri: P({ craft: 1, workshop: 1, cook: 2, repair: 3, build: 3, farm: 4, study: 4 }) },
  { name: "Night watch", pri: P({ guard: 2, build: 2, repair: 2, craft: 3, farm: 3 }), sched: SCHED_PRESETS.night.sched },
  { name: "Hunter", pri: P({ hunt: 1, fish: 1, forage: 2, wood: 2, guard: 3, farm: 3, repair: 4, build: 4, scavenge: 4 }) },
  { name: "Scavengers", kind: "crew", pri: P({ farm: 2, build: 3, repair: 3, wood: 3, scavenge: 4 }) },
  { name: "Hunting party", kind: "crew", pri: P({ hunt: 2, fish: 2, farm: 3, build: 4 }), crew: { field: { hunt: 1, fish: 2, recover: 3 }, size: 2, rules: { hurt: 45, food: 1, cargo: true } } },
];

export function workState(state) {
  if (!state.work) {
    state.work = { roles: [], next: 1, newcomers: null };
    for (const r of DEFAULT_ROLES()) addRole(state, r);
  }
  return state.work;
}
function addRole(state, r) {
  const w = state.work;
  const role = { id: `r${w.next++}`, name: r.name, kind: r.kind === "crew" ? "crew" : "base", pri: { ...(r.pri || {}) }, min: { ...(r.min || {}) }, sched: r.sched || ANY };
  if (role.kind === "crew") role.crew = { ...defaultCrew(), ...(r.crew || {}) };
  w.roles.push(role);
  return role;
}
// A crew's field settings (crews.js reads them).
export const defaultCrew = () => ({
  field: { scavenge: 1, recover: 2, vehicle: 2, trade: 3, supply: 3, hunt: 3, fish: 3 },
  range: 10, maxHours: 24, size: 3, stance: "normal", vehicle: "auto", ammo: 10, meds: 2, spare: 1.3,
  rules: { hurt: 45, food: 1, cargo: true }, rest: 1, paused: false, handleAll: false, style: "balanced",
  out: null, log: [], lastTrip: -99,
});

export const roleById = (state, id) => (state.work && id != null ? state.work.roles.find((r) => r.id === id) || null : null);
export const roleOf = (state, s) => (s && s.work ? roleById(state, s.work.role) : null);
// On priorities: in a role (and not pinned). Pinned people keep what they do.
export const isManaged = (state, s) => !!s && !s.pinned && !!roleOf(state, s);

// A cell: { p (0 = never), over (set for this person), def (the role's), watch (Guard moved up to 1 by the
// watchtower's alarm: what it is otherwise) }.
export function cellOf(state, s, key) {
  const c = ownCell(state, s, key);
  return key === "guard" && onWatch(s) && c.p > 0 ? { ...c, p: 1, watch: c.p } : c;
}
function ownCell(state, s, key) {
  const role = roleOf(state, s);
  const def = role ? role.pri[key] || 0 : 0;
  const o = s.work && s.work.over && s.work.over[key];
  return o != null ? { p: o, over: true, def } : { p: def, over: false, def };
}
// Moved up by the watchtower's alarm at the base they are at now.
const onWatch = (s) => !!(s && s.work && s.work.watch && !s.work.watch.off && s.location && s.location.kind === "base" && s.location.baseId === s.work.watch.base);
// Their first priority, the alarm aside (0: nothing set).
export function topPrio(state, s) {
  let top = 0;
  for (const k of WORK_KEYS) { const p = ownCell(state, s, k).p; if (p > 0 && (!top || p < top)) top = p; }
  return top;
}
export const prio = (state, s, key) => cellOf(state, s, key).p;

const clampP = (p) => Math.max(0, Math.min(PRIO_MAX, Math.round(Number(p) || 0)));
export function setCell(state, s, key, p) {
  if (!s || !WORK_TYPES[key]) return "";
  const role = roleOf(state, s);
  if (!role) return `${s.name.split(" ")[0]} is on Manual: pick a role first.`;
  const v = clampP(p);
  if (key === "guard" && s.work.watch) s.work.watch.off = true; // set by hand: the watchtower's alarm leaves their Guard alone until it is over
  s.work.over = s.work.over || {};
  if (v === (role.pri[key] || 0)) delete s.work.over[key]; else s.work.over[key] = v;
  return "";
}
export function clearCell(state, s, key) {
  if (s && s.work && key === "guard" && s.work.watch) s.work.watch.off = true;
  if (s && s.work && s.work.over) delete s.work.over[key];
}
export function setRoleCell(state, role, key, p) {
  if (!role || !WORK_TYPES[key]) return;
  const v = clampP(p);
  if (v) role.pri[key] = v; else delete role.pri[key];
}
export function setRoleMin(state, role, key, v) {
  if (!role || !WORK_TYPES[key]) return;
  const n = Math.max(0, Math.min(20, Math.round(Number(v) || 0)));
  if (n) role.min[key] = n; else delete role.min[key];
}
export function setSched(role, h, c) {
  if (!role || !SCHED[c] || h < 0 || h > 23) return;
  const a = (role.sched && role.sched.length === 24 ? role.sched : ANY).split("");
  a[h] = c;
  role.sched = a.join("");
}

// Put someone in a role (null = Manual). Overrides are kept for when they come back to a role.
export function assignRole(state, s, roleId) {
  if (!s) return "";
  workState(state);
  const role = roleId == null || roleId === "" ? null : roleById(state, roleId);
  s.work = { role: role ? role.id : null, over: (s.work && s.work.over) || {} };
  if (!role) { s.task = null; return `${s.name.split(" ")[0]} is on Manual: their role (${s.role}) stays as it is.`; }
  return `${s.name.split(" ")[0]} joins ${role.name}${s.pinned ? " (pinned: they keep their job until unpinned)" : ""}.`;
}
// A hand-picked role (the role drop-down, "Add a medic", a station's operator…): that person goes to Manual.
export function toManual(state, s) {
  if (s && s.work && s.work.role != null) { s.work.role = null; s.task = null; }
}

export function createRole(state, name = "New role", kind = "base") {
  workState(state);
  const clean = String(name || "").trim().slice(0, 30) || "New role";
  return addRole(state, { name: uniqueName(state, clean), kind, pri: kind === "crew" ? { farm: 2, build: 3 } : { farm: 3, build: 3 } });
}
export function duplicateRole(state, role) {
  if (!role) return null;
  const r = addRole(state, { ...JSON.parse(JSON.stringify(role)), name: uniqueName(state, `${role.name} copy`) });
  if (r.crew) { r.crew.out = null; r.crew.log = []; r.crew.lastTrip = -99; }
  return r;
}
export function renameRole(state, role, name) {
  const clean = String(name || "").trim().slice(0, 30);
  if (!role || !clean || clean === role.name) return "";
  role.name = uniqueName(state, clean, role);
  return `Role renamed to ${role.name}.`;
}
// Deleting a role puts its members on Manual (they keep the job they have now).
export function deleteRole(state, role) {
  const w = workState(state);
  if (!role || !w.roles.includes(role)) return "";
  if (role.crew && role.crew.out) return `${role.name} has a team out: wait until it is home.`;
  let n = 0;
  for (const s of state.survivors) if (s.work && s.work.role === role.id) { s.work.role = null; s.task = null; n++; }
  w.roles.splice(w.roles.indexOf(role), 1);
  if (w.newcomers === role.id) w.newcomers = null;
  return `${role.name} deleted${n ? `: ${n} member${n === 1 ? "" : "s"} back on Manual` : ""}.`;
}
function uniqueName(state, name, self = null) {
  let out = name;
  for (let i = 2; state.work.roles.some((r) => r !== self && r.name.toLowerCase() === out.toLowerCase()); i++) out = `${name} ${i}`;
  return out;
}
export const roleMembers = (state, role) => state.survivors.filter((s) => s.alive && s.work && s.work.role === role.id);

// A starting role by what someone does now (the Work tab's "Everyone here on priorities").
const ROLE_FOR = { farm: "Farmer", build: "Builder", medic: "Medic", craft: "Crafter", operate: "Crafter" }; // guards: Generalist (the Guard role guards all day)
export function everyoneOnPriorities(state, base) {
  const w = workState(state);
  let n = 0;
  for (const s of atBase(state, base.id)) {
    if (s.work && s.work.role != null) continue;
    const want = ROLE_FOR[s.role] || "Generalist";
    const role = w.roles.find((r) => r.name === want && r.kind === "base") || w.roles.find((r) => r.kind === "base");
    if (!role) continue;
    assignRole(state, s, role.id);
    n++;
  }
  if (w.newcomers == null) w.newcomers = (w.roles.find((r) => r.name === "Generalist") || {}).id || null;
  return n ? `${n} ${n === 1 ? "person" : "people"} at ${base.name} now work by priorities (Farmers, Builders, Generalists… by what they did).` : "Everyone here is already in a role.";
}
// Newcomers (anyone who never had a role) join this role.
export function setNewcomers(state, roleId) {
  const w = workState(state);
  for (const s of state.survivors) if (s.alive && !s.work) s.work = { role: null, over: {} }; // the people here now stay as they are
  w.newcomers = roleById(state, roleId) ? roleId : null;
}

// ---------- threats ----------
// urgent: a reason to man the walls now (raid or horde warned and coming, the defences manned, at the walls).
// standing: a horde in sight within 6 tiles (one more lookout).
// watch: { size, bosses } of the biggest horde on the watchtower's alarm (defences.js towerWatch), else null.
// kind: "raid" (raiders warned or at the walls, the defences manned for them: everyone with Guard set goes) or
// "horde" (a horde warned and coming, or next to the walls: as many with Guard set as it takes to hold it, with a
// quarter to spare; everyone when even that is not enough). size / bosses: the biggest such horde.
export function threatInfo(state, base) {
  let urgent = "", kind = "", standing = false, size = 0, bosses = 0;
  if (base.alert) { urgent = "the defences are manned"; kind = "raid"; }
  for (const q of state.parties) {
    if (urgent) break;
    if (q.kind === "raid" && q.target && q.target.kind === "player" && q.target.baseId === base.id && !q.returning && (q.warned || q.phase === "siege")) { urgent = "raiders are coming"; kind = "raid"; }
  }
  for (const v of state.visitors || []) {
    if (urgent) break;
    if (v.kind === "raiders" && v.goal && v.goal.kind === "base" && v.goal.baseId === base.id && (v.warned || v.phase === "siege")) { urgent = "raiders are coming"; kind = "raid"; }
  }
  for (const h of state.hordes) {
    if (!state.live.has(h.tile)) continue;
    const d = state.grid.distance(h.tile, base.tile);
    if (d <= 1 || (h.warned && ((h.goal && h.goal.baseId === base.id) || h.target === base.tile))) {
      if (h.size > size) { size = h.size; bosses = h.bosses || 0; }
      if (!urgent || kind === "horde") { urgent = d <= 1 ? `a horde of ${size} is at the walls` : `a horde of ${size} is coming`; kind = "horde"; }
    }
    if (d <= 6) standing = true;
  }
  const tw = towerHordes(state, base)[0]; // the watchtower's alarm (defences.js towerWatch): the biggest horde on its watch
  const watch = tw ? { size: tw.size, bosses: tw.bosses || 0 } : null;
  return { urgent, kind, standing, size, bosses, watch };
}

// Who of the people with Guard set goes to the walls (best shots first). A raid: all of them. A horde: until the
// hold limit (defences.js: walls, guards' combat power, the defence buildings, a Wallbreaker) covers the horde
// (after the spike pits) with a quarter to spare. While the defences are manned for a horde everyone already
// counts 0.8, so a guard adds only the rest.
function emergencyGuards(state, base, threat, cands, fixedGuards) {
  const list = [...cands].sort((a, b) => combatPower(b) - combatPower(a) || a.id - b.id);
  if (threat.kind !== "horde") return new Set(list);
  const after = threat.size - spikeKill(base, threat.size);
  const mult = defenceMult(state, base) * DEFENCE.BOSS[Math.min(2, threat.bosses || 0)];
  const all = manned(state, base);
  let hold = wallHold(base) * mult;
  for (const s of atBase(state, base.id)) {
    if (s.inBed) continue;
    if (fixedGuards.has(s)) hold += combatPower(s) * DEFENCE.GUARD_PER_POWER * mult;
    else if (all) hold += combatPower(s) * DEFENCE.ALERT_WEIGHT * DEFENCE.GUARD_PER_POWER * mult;
  }
  const out = new Set();
  for (const s of list) {
    if (hold >= after * 1.25) break;
    out.add(s);
    hold += combatPower(s) * (all ? 1 - DEFENCE.ALERT_WEIGHT : 1) * DEFENCE.GUARD_PER_POWER * mult;
  }
  return out;
}

// Why someone should rest for their health ("" = fit to work). With the state: also an illness at a base (sickrest.js:
// "sick: Flu", by the Work tab's "Sick people rest" setting); without it only the hard rules (mustRest), as before.
export function healthRest(s, state = null) {
  return mustRest(s) || (state ? sickRestWhy(state, s) : "");
}
// The hard rules: these rest whatever the setting, and never go to the walls in an emergency.
export function mustRest(s) {
  if (s.inBed) return "in a hospital bed";
  if (isSevere(s)) return `badly hurt (health ${Math.floor(s.health)})`;
  if (s.woundInfected) return "an infected wound";
  if (tooIllToWork(s)) return "too ill to work";
  if (s.quarantined && isContagious(s)) return "in quarantine";
  return "";
}

// ---------- the hourly pass ----------
export function workHour(state) {
  if (!state.work || state.gameOver) return;
  const planned = !(state.autopilot && !(state.governor && state.governor.priorityRoles)); // the dev autopilot runs every role
  watchPromotions(state, planned);
  if (!planned) return;
  const w = state.work;
  if (w.newcomers != null && roleById(state, w.newcomers)) {
    for (const s of state.survivors) if (s.alive && !s.work && s.location.kind === "base") assignRole(state, s, w.newcomers);
  }
  for (const base of state.bases) planBase(state, base);
}

// The watchtower's alarm (defences.js towerWatch, base.towerWatch): everyone on priorities at that base with Guard
// set below their first priority (a backup job) gets it moved up to 1 (s.work.watch), and back when the alarm is
// off, they leave the base, or Guard is no longer set. A log line each way. promote false (the dev autopilot running
// every role): only the flags left from before are cleared.
export function watchPromotions(state, promote = true) {
  const up = new Map(), back = new Map();
  const add = (m, b, s) => { if (!m.has(b)) m.set(b, []); m.get(b).push(s); };
  for (const s of state.survivors) {
    if (!s.work || !s.work.watch) continue;
    const b = baseById(state, s.work.watch.base);
    const here = !!b && s.alive && s.location.kind === "base" && s.location.baseId === b.id;
    const off = !!s.work.watch.off; // Guard set by hand during the alarm: left alone until it is over
    if (promote && here && b.towerWatch && (off || (isManaged(state, s) && ownCell(state, s, "guard").p > 0))) continue;
    if (here && !off && isManaged(state, s)) add(back, b, s);
    delete s.work.watch;
  }
  if (promote) for (const b of state.bases) {
    if (!b.towerWatch) continue;
    for (const s of atBase(state, b.id)) {
      if (!isManaged(state, s) || s.work.watch) continue;
      const g = ownCell(state, s, "guard").p;
      if (g > 0 && g > topPrio(state, s)) { s.work.watch = { base: b.id, was: g, hour: state.hour }; add(up, b, s); }
    }
  }
  const names = (list, f) => { const n = list.map(f); return n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0]; };
  const first = (s) => s.name.split(" ")[0];
  for (const [b, list] of up) log(state, `Watchtower alarm at ${b.name}: ${names(list, (s) => `${first(s)} (Guard ${s.work.watch.was})`)} move${list.length === 1 ? "s" : ""} Guard up to priority 1 until the horde has gone.`, "info");
  for (const [b, list] of back) log(state, `${b.name}: ${names(list, (s) => `${first(s)} (Guard ${ownCell(state, s, "guard").p || "never"})`)} back to the usual order of work.`, "info");
}

// Plans one base for this hour and applies it. Returns the number of people whose job changed.
export function planBase(state, base) {
  const people = atBase(state, base.id);
  const managed = people.filter((s) => isManaged(state, s));
  if (!managed.length) return 0;
  const h = hourOfDay(state);
  holdFilters(state, base);
  const ctx = makeCtx(state, base, people);
  const out = new Map();
  const put = (s, a) => out.set(s.id, a);
  // The walls in an emergency take the sick (sickrest.js) as before: only the hard rules keep people off them.
  const fit = managed.filter((s) => s.restUntil == null && !mustRest(s));
  const held = prisonersAt(state, base.id).length; // the jail's guards stand it while anyone is held
  let walls = new Set();
  if (ctx.threat.urgent) {
    const cands = fit.filter((s) => prio(state, s, "guard") > 0);
    walls = emergencyGuards(state, base, ctx.threat, cands, new Set(people.filter((s) => !managed.includes(s) && s.role === "guard")));
    ctx.wallsNote = ctx.threat.kind === "horde" ? ` (${walls.size} of ${cands.length} with Guard set ${walls.size === 1 ? "is" : "are"} needed to hold it)` : " (Guard is set)";
  } else if (ctx.threat.watch) {
    // The watchtower's alarm: the lookouts it takes to hold the horde it sees (Guard's capacity, at least one more).
    const cands = fit.filter((s) => prio(state, s, "guard") > 0);
    ctx.watchNeed = emergencyGuards(state, base, { kind: "horde", size: ctx.threat.watch.size, bosses: ctx.threat.watch.bosses }, cands, new Set(people.filter((s) => !managed.includes(s) && s.role === "guard"))).size;
  }
  for (const s of managed) {
    const role = roleOf(state, s);
    if (s.restUntil != null) { put(s, { role: "rest", t: "rest", kind: "health", why: `Time off until day ${s.restUntil}` }); continue; }
    const hurt = mustRest(s);
    if (hurt) { put(s, { role: "rest", t: "rest", kind: "health", why: `Resting: ${hurt}` }); continue; }
    if (walls.has(s)) { put(s, { role: "guard", t: "guard", kind: "emerg", why: `Emergency: ${ctx.threat.urgent}${ctx.wallsNote}${sickRestWhy(state, s) ? ` (ill, but every gun counts)` : ""}` }); continue; }
    // Sick people rest (sickrest.js): any illness here (food poisoning and whatever comes later: it goes by the kind)
    // until it is gone; back to their priorities the hour they are well.
    const sick = sickRestWhy(state, s);
    if (sick) { put(s, { role: "rest", t: "sick", kind: "health", note: sick.slice(6), why: `Resting: sick (${sick.slice(6)}) until it is gone: resting heals it faster (Sick people rest, the Work tab)` }); continue; }
    const ws = base.watch ? watchShift(base, s, h) : null; // watch.js: the base's watch roster, before the role's schedule
    if (ws) { put(s, { role: "guard", t: "guard", kind: "sched", why: `On watch: ${ws.name} ${shiftText(ws)} (the watch roster)` }); continue; }
    if (base.watch && sleepingIn(state, base, s, h)) { put(s, { role: "rest", t: "sleep", kind: "sched", why: `Sleeping off the watch (owes ${Math.ceil(s.tired || 0)} h of sleep)` }); continue; } // sleep.js
    const block = schedAt(role, h);
    if (block === "g") { put(s, { role: "guard", t: "guard", kind: "sched", why: `Guard watch (${role.name}'s schedule)` }); continue; }
    if (block === "s" || block === "f") { put(s, { role: "rest", t: block === "s" ? "sleep" : "free", kind: "sched", why: `${SCHED[block].name} (${role.name}'s schedule)` }); continue; }
    // prisoners.js JAIL_GUARD: on the jail's roster, their Work hours go to guarding it while anyone is held here.
    if (held && onJailRoster(base, s)) { put(s, { role: "guard", t: "guard", kind: "sched", why: `Guarding the ${jailName(base).toLowerCase()} (${held} held; the jail's roster)` }); continue; }
    const glum = s.mood < MOOD_LOW || (s.task && s.task.kind === "mood" && s.mood < MOOD_BACK);
    if (glum) { put(s, { role: "rest", t: "free", kind: "mood", why: `Free time: mood ${Math.floor(s.mood)} (back to work at ${MOOD_BACK})` }); continue; }
    ctx.free.add(s);
  }
  // What the people not being planned now already hold (Manual, pinned, resting, guarding).
  for (const s of people) {
    if (ctx.free.has(s)) continue;
    const a = out.get(s.id);
    ctx.hold(s, a ? a.role : s.role, a ? null : s.station, !a);
  }
  // Emergency boosts, then priorities 1..5.
  const reasons = new Map();
  const note = (s, key, why) => { if (!reasons.has(s.id)) reasons.set(s.id, []); const r = reasons.get(s.id); if (!r.some((x) => x.key === key)) r.push({ key, why }); };
  const give = (s, key, p, kind, why) => {
    const T = WORK_TYPES[key];
    ctx.why = "";
    const a = T.take ? T.take(ctx, s) : { role: T.role };
    if (!a) { note(s, key, ctx.why || "full"); return false; }
    ctx.used[key]++;
    ctx.free.delete(s);
    put(s, { ...a, t: key, p, kind, why });
    return true;
  };
  for (const key of WORK_KEYS) {
    const T = WORK_TYPES[key];
    if (!T.emergency) continue;
    const em = T.emergency(ctx);
    if (!em) continue;
    let slots = em.slots;
    const cands = [...ctx.free].filter((s) => prio(state, s, key) > 0 && minOk(state, s, key) && (T.emergencyCan ? T.emergencyCan(ctx, s) : !(T.can && T.can(ctx, s)))).sort((a, b) => rankOf(ctx, b, key) - rankOf(ctx, a, key) || a.id - b.id);
    for (const s of cands) {
      if (slots <= 0) break;
      if (give(s, key, prio(state, s, key), "emerg", `Emergency: ${em.why} (${T.name} is set)`)) slots--;
    }
  }
  for (let p = 1; p <= PRIO_MAX && ctx.free.size; p++) {
    const pairs = [];
    for (const s of ctx.free) {
      for (const key of WORK_KEYS) {
        if (prio(state, s, key) !== p) continue;
        const T = WORK_TYPES[key];
        if (!minOk(state, s, key)) { note(s, key, `needs ${SKILL_NAMES[T.skill] || T.skill} ${roleOf(state, s).min[key]}`); continue; }
        const o = ctx.open(key);
        if (o.cap - ctx.used[key] <= 0) { note(s, key, o.cap ? o.capNote || `full (${ctx.used[key]} of ${o.cap})` : o.why); continue; }
        const why = T.can ? T.can(ctx, s) : "";
        if (why) { note(s, key, why); continue; }
        pairs.push({ s, key, urg: o.urg || 0, score: (o.urg || 0) + rankOf(ctx, s, key) / 4 + (s.task && s.task.t === key ? STICKY : 0) });
      }
    }
    pairs.sort((a, b) => b.score - a.score || a.s.id - b.s.id || WORK_KEYS.indexOf(a.key) - WORK_KEYS.indexOf(b.key));
    for (const x of pairs) {
      if (!ctx.free.has(x.s)) continue;
      const o = ctx.open(x.key);
      if (o.cap - ctx.used[x.key] <= 0) { note(x.s, x.key, o.capNote || `full (${ctx.used[x.key]} of ${o.cap})`); continue; }
      const higher = (reasons.get(x.s.id) || []).filter((r) => prio(state, x.s, r.key) < p);
      const raised = x.key === "guard" && cellOf(state, x.s, "guard").watch; // moved up by the watchtower's alarm
      give(x.s, x.key, p, "work", `${WORK_TYPES[x.key].ing}: priority ${p}${raised ? ` (Guard ${raised}, moved up: the watchtower sees a horde of ${ctx.threat.watch ? ctx.threat.watch.size : "?"} near)` : ""}${higher.length ? ` (before it: ${higher.map((r) => `${WORK_TYPES[r.key].name}: ${r.why}`).join("; ")})` : ""}`);
    }
  }
  // A queued build keeps one hand (the governor's rule against the builder deadlock): when the farm or the like took
  // everyone with Build set, the one with Build highest (then the best builder) switches to it.
  const bo = ctx.open("build");
  if (bo.cap > 0 && ctx.used.build === 0) {
    const cands = managed.filter((s) => {
      if (prio(state, s, "build") <= 0 || !minOk(state, s, "build")) return false;
      if (ctx.free.has(s)) return true;
      const a = out.get(s.id);
      return !!a && a.kind === "work" && LOOSE.includes(a.t);
    }).sort((a, b) => prio(state, a, "build") - prio(state, b, "build") || rankOf(ctx, b, "build") - rankOf(ctx, a, "build") || a.id - b.id);
    const s = cands[0];
    if (s) {
      const was = out.get(s.id);
      if (was && !ctx.free.has(s)) ctx.used[was.t]--;
      ctx.free.add(s);
      give(s, "build", prio(state, s, "build"), "emerg", `${WORK_TYPES.build.ing}: one hand stays on the queued build${was && was.t ? ` (${WORK_TYPES[was.t].name} took everyone else)` : ""}`);
    }
  }
  // Likewise a craft queue with work keeps one hand (the governor's step 8: one crafter once the farm has its crew).
  // Taken from scavenging or from farmers beyond the governor's crew for the plots: 0.6 a plot while food is
  // comfortable, 1.2 a plot below that (autopilot.js planRoles step 6). The farm here takes up to 1.6 × 1.2 a plot
  // while food is short of the season's goal, and Farm sits above Craft for most roles, so without this the queue sat
  // all season on many maps (the summer's water filters, dressings for short meds, a weapon for the unarmed): over
  // worktest's 10 seeds × 8 rolls priorities finished a fifth fewer crafts than the governor (373 vs 462; with this
  // 451, food and buildings unchanged).
  // Never from a build, a station, a lesson, a repair or the walls.
  const co = ctx.open("craft");
  if (co.cap > 0 && ctx.used.craft === 0) {
    const fw = farmersWanted(state, base);
    const farmSpare = ctx.used.farm - (ctx.foodDays >= Math.max(15, foodGoal(state) / 1.5) ? fw.need : fw.ideal);
    const cands = managed.filter((s) => {
      if (prio(state, s, "craft") <= 0 || !minOk(state, s, "craft") || WORK_TYPES.craft.can(ctx, s)) return false;
      if (ctx.free.has(s)) return true;
      const a = out.get(s.id);
      return !!a && a.kind === "work" && (a.t === "scavenge" || (a.t === "farm" && farmSpare > 0));
    }).sort((a, b) => prio(state, a, "craft") - prio(state, b, "craft") || rankOf(ctx, b, "craft") - rankOf(ctx, a, "craft") || a.id - b.id);
    const s = cands[0];
    if (s) {
      const was = out.get(s.id);
      if (was && !ctx.free.has(s)) ctx.used[was.t]--;
      ctx.free.add(s);
      give(s, "craft", prio(state, s, "craft"), "emerg", `${WORK_TYPES.craft.ing}: one hand stays on the craft queue${was && was.t ? ` (${WORK_TYPES[was.t].name} has hands to spare)` : ""}`);
    }
  }
  for (const s of ctx.free) {
    const r = reasons.get(s.id) || [];
    put(s, { role: "rest", t: "idle", kind: "idle", why: r.length ? `Nothing to do, resting (${r.map((x) => `${WORK_TYPES[x.key].name}: ${x.why}`).join("; ")})` : "No work type is set for them" });
  }
  // Apply.
  let changed = 0;
  for (const s of managed) {
    const a = out.get(s.id);
    if (!a) continue;
    const station = a.role === "operate" ? (a.station != null ? a.station : s.station) : null;
    if (s.role !== a.role || (s.station || null) !== (station || null)) changed++;
    s.role = a.role;
    s.station = station;
    s.parked = null;
    if (a.teach) s.teach = { skill: a.teach.skill, learners: a.teach.learners.slice() };
    if (a.book) s.reading = a.book;
    if (a.bp) s.studying = a.bp;
    if (a.repair != null) { const j = (base.repairs || []).find((x) => String(x.id) === String(a.repair)); if (j) j.who = s.id; }
    if (a.kind === "sched" && (a.t === "sleep" || a.t === "free")) s.mood = Math.min(100, s.mood + OFF_MOOD);
    const prev = s.task;
    const last = a.kind === "work" || a.kind === "emerg" && a.role !== "guard" ? { role: a.role, station, hour: state.hour } : prev && prev.last && state.hour - prev.last.hour < 72 ? prev.last : null;
    s.task = { t: a.t, p: a.p || 0, kind: a.kind, why: a.why, note: a.note || "", base: base.id, hour: state.hour, since: prev && prev.t === a.t ? prev.since : state.hour, last };
  }
  if (changed) assignStations(state, base);
  return changed;
}

const minOk = (state, s, key) => {
  const role = roleOf(state, s);
  const m = role && role.min ? role.min[key] || 0 : 0;
  const k = WORK_TYPES[key].skill;
  return !m || !k || skill(s, k) >= m;
};
const rankOf = (ctx, s, key) => {
  const T = WORK_TYPES[key];
  return T.rank ? T.rank(s, ctx) : T.skill ? skill(s, T.skill) : 0;
};

function makeCtx(state, base, people) {
  const stationList = stations(base);
  const opsNow = new Set(people.filter((s) => s.role === "operate" && s.station != null).map((s) => s.station));
  const whyMemo = new Map();
  const ctx = {
    state, base, people, free: new Set(), memo: new Map(), why: "",
    threat: threatInfo(state, base),
    foodDays: edibleFood(base) / Math.max(1, people.length),
    stationList, stationKinds: [...new Set(stationList.map(stationKind))],
    stations: new Set(), learners: new Set(), studying: new Set(), repairTaken: new Set(), upkeepTaken: 0,
    books: {}, used: Object.fromEntries(WORK_KEYS.map((k) => [k, 0])),
    stationWhy: (st) => { if (!whyMemo.has(st.id)) whyMemo.set(st.id, stationWork(state, base, st, opsNow)); return whyMemo.get(st.id); },
  };
  for (const it of base.armory) if (it && bookDef(it.key)) ctx.books[it.key] = (ctx.books[it.key] || 0) + 1;
  // Repair jobs at this base: open (nobody on it, or its worker is gone) or already a planned person's.
  ctx.repairJobs = (base.repairs || []).map((j) => {
    const fx = fixtures(base).find((f) => String(f.id) === String(j.fx));
    const def = fx && FIXTURES[fx.type];
    const here = j.who != null && people.some((s) => s.id === j.who);
    return { id: j.id, who: here ? j.who : null, min: def && def[j.method] ? def[j.method].min || 0 : 0, name: fx ? (fx.type === "pump" ? "well pump" : (BUILDINGS[fx.type] && BUILDINGS[fx.type].name.toLowerCase()) || fx.type) : "fixture" };
  });
  const worn = fixtures(base).filter((f) => !f.broken && (f.wear || 0) >= UPKEEP.from);
  ctx.worn = worn.length; // upkeep before the risk of breaking (60)
  ctx.upkeepHands = worn.length ? Math.max(1, Math.ceil(worn.reduce((a, f) => a + f.wear - UPKEEP.to, 0) / (WEAR.upkeep * UPKEEP.days))) : 0;
  const opens = new Map();
  ctx.open = (key) => { if (!opens.has(key)) opens.set(key, WORK_TYPES[key].open(ctx)); return opens.get(key); };
  // A person not being planned: what they hold.
  ctx.hold = (s, role, station, fixed) => {
    if (role === "operate" && station != null) ctx.stations.add(station);
    if (fixed && role === "teach") { const l = lessonOf(state, s); if (l) for (const id of l.learners) ctx.learners.add(id); }
    if (fixed && role === "read") { if (s.studying) ctx.studying.add(s.studying); else if (s.reading && ctx.books[s.reading] > 0) ctx.books[s.reading]--; }
    for (const j of ctx.repairJobs) if (j.who === s.id) ctx.repairTaken.add(j.id);
    for (const key of WORK_KEYS) {
      const T = WORK_TYPES[key];
      if (T.holds ? T.holds(ctx, s, role, station) : role === T.role) ctx.used[key]++;
    }
  };
  return ctx;
}

// ---------- the daily tick (world.js, just before the bases' day) ----------
// People asleep, on free time, on a guard watch or on the walls in an emergency at midnight are counted at their
// last work of the day by the daily systems (farming, stations, scavenging, XP …). Fights are settled hour by hour
// before this (hordes.js, parties.js, visitors.js), and workHour puts everyone back on their post right after, so
// the walls are never thinner for it; only prisoners keep their guards (their escapes are rolled in the day).
export function workDayRoles(state) {
  if (!state.work) return;
  if (state.autopilot && !(state.governor && state.governor.priorityRoles)) return;
  for (const base of state.bases) {
    const people = atBase(state, base.id);
    const cells = prisonersAt(state, base.id).length > 0;
    for (const s of people) {
      if (!isManaged(state, s) || !s.task || (s.task.kind !== "sched" && s.task.kind !== "emerg") || s.task.base !== base.id) continue;
      if (cells && s.role === "guard") continue;
      const last = s.task.last;
      if (!last || state.hour - last.hour > 72) continue;
      const clash = last.role === "operate" && people.some((o) => o !== s && o.role === "operate" && o.station === last.station);
      s.role = clash ? "rest" : last.role;
      s.station = last.role === "operate" && !clash ? last.station : null;
    }
  }
}

// ---------- for the UI ----------
const TASK_NAMES = { rest: "Resting", sick: "Resting: sick", sleep: "Asleep", free: "Free time", idle: "Idle", guard: "On guard" };
export function taskLabel(state, s) {
  if (!s || !s.alive) return "";
  if (s.location.kind !== "base") return "Away from base";
  if (s.pinned) return "Pinned";
  if (!isManaged(state, s) || !s.task || s.task.base !== s.location.baseId) return "";
  const t = s.task;
  const name = WORK_TYPES[t.t] ? WORK_TYPES[t.t].ing : TASK_NAMES[t.t] || t.t;
  return `${name}${t.note ? ` (${t.note})` : ""}`;
}
export const taskWhy = (state, s) => (s && s.task && isManaged(state, s) && s.location.kind === "base" && s.task.base === s.location.baseId ? s.task.why : "");
// The schedule as runs: "work 06–20, free 20–22, sleep 22–06".
export function schedText(role) {
  const sc = role && role.sched && role.sched.length === 24 ? role.sched : ANY;
  if (sc === ANY) return "works any hour";
  const runs = [];
  let start = 0;
  for (let h = 1; h <= 24; h++) if (h === 24 || sc[h] !== sc[start]) { runs.push([sc[start], start, h]); start = h; }
  if (runs.length > 1 && runs[0][0] === runs[runs.length - 1][0]) { const last = runs.pop(); runs[0] = [last[0], last[1], runs[0][2] + 24]; }
  const hh = (x) => String(x % 24).padStart(2, "0");
  return runs.map(([c, a, b]) => `${SCHED[c].name.toLowerCase()} ${hh(a)}–${hh(b)}`).join(", ");
}
// The steward card: how many people here work by priorities.
export function priorityCount(state, base) {
  return atBase(state, base.id).filter((s) => isManaged(state, s)).length;
}
