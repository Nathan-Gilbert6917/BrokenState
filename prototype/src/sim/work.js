// Work priorities (the RimWorld work tab): named roles, a 1–5 priority per work type, and an hourly scheduler that
// turns them into the single role each system already reads (s.role, s.station, the lesson, the book, the repair).
//
// state.work = { roles: [role…], next, newcomers }   (created when the player first opens the Work tab)
//   role = { id, name, kind: "base" | "crew", pri: { type: 1..5 }, min: { type: skill }, sched: 24 chars, crew }
//   pri: missing / 0 = never. min: the skill a member needs for that type (Medicine 4 for Doctor, …).
//   sched: one letter per hour of the day: w work (priorities), g guard watch, f free time, s sleep.
//   crew: the field settings of a crew role (crews.js); its members work the base by `pri` while they are home.
// s.work = { role: id | null, over: { type: 0..5 } }   (no s.work / role null: Manual, today's fixed role)
//   over: one cell overridden for this person (0 = never), on top of the role's default.
// s.task = what they do this hour and why (the Work tab, the roster, the survivor screen).
//
// Every hour (world.js tickHour, before stewards and the autopilot) each base with people on priorities is planned:
//   1. Not touched: Manual and pinned people (stewards still run Manual ones, steward.js / autopilot planRoles).
//   2. Health first: a hospital bed, a severe wound, an infected wound, too ill, quarantine, or days off from a card
//      → rest. Then emergencies: raiders warned or at the walls, or the defences manned → everyone with Guard set
//      (any priority) guards; a horde warned and coming, or next to the walls → as many of them as it takes to hold
//      it with a quarter to spare (defences.js hold limit), best shots first, all of them when that is not enough.
//      Then the role's schedule (guard watch, free time, sleep), then free time for anyone whose mood is very low
//      (below 25, until 40).
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
import { atBase, skill, combatPower, hourOfDay } from "./world.js";
import { SKILLS, SKILL_NAMES } from "./data.js";
import { BUILDINGS, RECIPES, stations, underAttack, assignStations } from "./buildings.js";
import { hasOrder, orderHold, stationIO, stationOrder } from "./production.js";
import { POWER, powerWanted } from "./power.js";
import { farmersWanted, farmOf } from "./farming.js";
import { edibleFood, foodStore } from "./storage.js";
import { season } from "./weather.js";
import { hospitalDef, isHurt, isSevere } from "./medical.js";
import { tooIllToWork, isSick, isContagious } from "./health.js";
import { CRAFTS, craftQueue, craftQuality, meetsNeeds } from "./crafting.js";
import { learnersFor, lessonOf, bestBook, bookDef, MAX_LEARNERS, TEACH_GAP } from "./skills.js";
import { studyable, canStudy, BLUEPRINTS } from "./blueprints.js";
import { FIXTURES, fixtures, brokenAt } from "./breakdowns.js";
import { scavLeft, SCAV_FLOOR, waterOutlook } from "./economy.js";
import { prisonersAt } from "./prisoners.js";
import { DEFENCE, wallHold, defenceMult, spikeKill, manned } from "./defences.js";
import { huntWorkWhy, fishWorkWhy, fishWorkCap, hunterMult, bestHuntWeapon, fisherMult, CABIN } from "./hunting.js";

export const PRIO_MAX = 5;
const WATER_BUILDS = ["well", "rain_catcher", "cistern"]; // water first (autopilot.js waterPlan)
// Assignments a queued build may take one hand from (no station, lesson, book or repair job to give back).
const LOOSE = ["farm", "scavenge", "hunt", "fish"];
export const SCRAP_KEEP = { ammo: 50, meds: 40, parts: 60 }; // stations on a steward's or the governor's order stop below this
export const MOOD_LOW = 25, MOOD_BACK = 40;   // free time below 25 mood, back to work at 40
export const OFF_MOOD = 0.25;                 // mood an hour of sleep or free time gives (the Rest role's 6 a day)
const STICKY = 1.5;                           // staying on the same job this hour

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
    desc: "Medic on duty: with an infirmary or hospital while anyone here is hurt or sick (it needs 1–3 by tier); without one only for the badly hurt, infected or ill. Treats wounds and illness; leaves when everyone is healed.",
    open(ctx) {
      const { base, people } = ctx;
      const hosp = hospitalDef(base);
      const onDuty = people.some((s) => s.role === "medic");
      const line = hosp.tier > 0 ? (onDuty ? 100 : 95) : 50;
      const pts = people.filter((s) => s.woundInfected || isSick(s) || (isHurt(s) && s.health < line));
      if (!pts.length) return { cap: 0, why: "nobody here needs care" };
      const danger = pts.some((s) => isSevere(s) || s.woundInfected);
      return { cap: Math.max(1, hosp.tier > 0 ? hosp.staff : 1), urg: 4 + (danger ? 3 : 0) + Math.min(3, pts.length / 2), danger };
    },
    // A patient in danger and nobody on duty: the first person with Doctor set goes, whatever its priority.
    emergency(ctx) { const o = this.open(ctx); return o.danger && !ctx.people.some((s) => s.role === "medic" && !ctx.free.has(s)) ? { slots: 1, why: "a patient is in danger" } : null; },
  },
  guard: {
    name: "Guard", ing: "On guard", short: "Grd", role: "guard", skill: "shooting",
    desc: "A lookout on the walls (one at a base of 4+, two at 12+, one more while a horde is in sight or prisoners are in the cells). Raid and horde warnings send everyone with Guard set to the walls (an emergency).",
    open(ctx) {
      const n = ctx.people.length;
      const cap = (n >= 4 ? 1 : 0) + (n >= 12 ? 1 : 0) + (ctx.threat.standing ? 1 : 0) + (prisonersAt(ctx.state, ctx.base.id).length ? 1 : 0);
      return cap ? { cap, urg: ctx.threat.standing ? 6 : 2 } : { cap: 0, why: "no lookout needed (fewer than 4 people, nothing in sight)" };
    },
    rank: (s) => combatPower(s) * 2,
  },
  farm: {
    name: "Farm", ing: "Farming", short: "Farm", role: "farm", skill: "farming",
    desc: "Tends, sows and harvests the plots. Wants about 1.2 farmers a plot in use, up to 1.9 while food is short of the season's target (40 days or more; 80 in autumn).",
    open(ctx) {
      const fw = farmersWanted(ctx.state, ctx.base);
      if (fw.active + fw.toSow <= 0) return { cap: 0, why: "no crops to tend or sow" };
      const days = ctx.foodDays;
      const ripe = farmOf(ctx.state, ctx.base).plots.some((p) => p.stage === "ripe");
      return { cap: Math.max(fw.need, days < foodGoal(ctx.state) ? Math.ceil(fw.ideal * 1.6) : fw.ideal), urg: (days < 7 ? 8 : days < 20 ? 5 : 3) + (ripe ? 1 : 0) };
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
    name: "Craft", ing: "Crafting", short: "Craft", role: "craft", skill: "mechanics",
    desc: "Works the craft queue by hand (base Crafting tab): one crafter at a time. Needs the recipe's skill.",
    open(ctx) {
      const jobs = craftQueue(ctx.base).filter((j) => CRAFTS[j.recipe] && meetsNeeds(ctx.base, CRAFTS[j.recipe]));
      if (!jobs.length) return { cap: 0, why: craftQueue(ctx.base).length ? "the queued crafts need a workshop" : "nothing in the craft queue" };
      const water = jobs.some((j) => j.recipe === "waterfilter") && (ctx.base.stock.water || 0) < ctx.people.length * 3;
      return { cap: 1, urg: 3 + (water ? 4 : 0) }; // one crafter, as the governor: a queue that empties fast gets refilled, and every craft is paid in scrap the build queue wants
    },
    can(ctx, s) {
      const ok = craftQueue(ctx.base).some((j) => {
        const r = CRAFTS[j.recipe];
        return r && meetsNeeds(ctx.base, r) && skill(s, r.skill) >= r.min && (!j.minQ || !r.gear || craftQuality(skill(s, r.skill), r) + 1e-9 >= j.minQ);
      });
      return ok ? "" : "not skilled enough for anything queued";
    },
    rank: (s, ctx) => { const j = craftQueue(ctx.base)[0]; return j && CRAFTS[j.recipe] ? skill(s, CRAFTS[j.recipe].skill) : skill(s, "mechanics"); },
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
    desc: "Repairs broken buildings (the Repairs tab; a repair is started by itself when the base can pay), worked 08:00–20:00, and keeps worn ones in shape when nothing is being built. A broken well pump, well or wall pulls the first hands with Repair set.",
    open(ctx) {
      const open = ctx.repairJobs.filter((j) => !ctx.repairTaken.has(j.id));
      const upkeep = !ctx.base.construction.length && ctx.worn > 0 ? 1 : 0;
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
      if (!ctx.base.construction.length && ctx.worn > 0 && !ctx.upkeepTaken) { ctx.upkeepTaken = true; return { role: "build", note: "upkeep on worn buildings" }; }
      ctx.why = "the repairs have their hands";
      return null;
    },
    holds: () => false, // repairers keep their role (breakdowns.js): counted by job instead
  },
  teach: {
    name: "Teach", ing: "Teaching", short: "Tch", role: "teach", skill: "leadership",
    desc: "Teaches a skill to up to 2 people here whose skill is at least 4 below theirs (learners keep their own jobs). One teacher, two at 12+ people.",
    open(ctx) {
      const cap = ctx.people.length >= 12 ? 2 : 1;
      return ctx.people.length >= 3 ? { cap, urg: 1 } : { cap: 0, why: "too few people to teach" };
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
    desc: "Hunts the land within 2 tiles with a Hunting cabin here (up to 2 people, while food is short of the season's goal), 3 hours a day at dawn and dusk: their own rifle, bow or gun (this base's ammo), snares without one. Fresh game spoils fast; the land runs short of game when hunted hard and grows back over weeks.",
    open(ctx) {
      const why = huntWorkWhy(ctx.state, ctx.base);
      if (why) return { cap: 0, why };
      const days = ctx.foodDays;
      if (days >= foodGoal(ctx.state)) return { cap: 0, why: `food is plentiful (${Math.floor(days)} days)` };
      return { cap: CABIN.hunters, urg: days < 7 ? 7 : days < 20 ? 4.5 : 2.5 };
    },
    rank: (s) => hunterMult(s) * 10 * (bestHuntWeapon(s) ? 1 : 0.4),
  },
  fish: {
    name: "Fish", ing: "Fishing", short: "Fish", role: "fish", skill: "scouting",
    desc: "Fishes the river or lake by this base 3 hours a day while food is short of the season's goal: one fishing rod or net each (carried or in the armory). Fresh fish spoils fast; a fished-out spot comes back in a week or two.",
    open(ctx) {
      const why = fishWorkWhy(ctx.state, ctx.base);
      if (why) return { cap: 0, why };
      const days = ctx.foodDays;
      if (days >= foodGoal(ctx.state)) return { cap: 0, why: `food is plentiful (${Math.floor(days)} days)` };
      return { cap: fishWorkCap(ctx.state, ctx.base), urg: days < 7 ? 6.5 : days < 20 ? 4 : 2 };
    },
    rank: (s) => fisherMult(s) * 10,
  },
};
export const WORK_KEYS = Object.keys(WORK_TYPES);

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
  } else if (k === "ammo") { if ((s.ammo || 0) >= n * 15 + 60) return `enough ammo (${n0(s.ammo)}; no order set)`; }
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
    if ((s.water || 0) < n * 2 + 2) return "water kept for drinking";
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
  const urgent = ok.some((st) => ["ammo", "meds"].includes(stationKind(st)) && (ctx.base.stock[stationKind(st)] || 0) < ctx.people.length * 2);
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
  const k = bestBook(s, ctx.books);
  if (!k || (!bookDef(k).skill && s.mood >= 55)) return null;
  return { book: k };
}

// ---------- roles ----------
const P = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v > 0));
export const DEFAULT_ROLES = () => [
  { name: "Generalist", pri: P({ doctor: 3, guard: 4, farm: 2, cook: 3, workshop: 3, craft: 4, build: 2, repair: 2, hunt: 4, fish: 4, teach: 4, study: 4, scavenge: 4 }) },
  { name: "Farmer", pri: P({ farm: 1, cook: 2, hunt: 3, fish: 3, repair: 3, build: 3, study: 4, scavenge: 4 }) },
  { name: "Builder", pri: P({ build: 1, repair: 1, workshop: 2, craft: 3, farm: 3, study: 4, scavenge: 4 }) },
  { name: "Guard", pri: P({ guard: 1, repair: 3, build: 3, farm: 4 }), sched: SCHED_PRESETS.guard.sched },
  { name: "Medic", pri: P({ doctor: 1, study: 2, teach: 3, craft: 3, farm: 4, scavenge: 4 }), min: { doctor: 2 } },
  { name: "Crafter", pri: P({ craft: 1, workshop: 1, cook: 2, repair: 3, build: 3, farm: 4, study: 4 }) },
  { name: "Night watch", pri: P({ guard: 2, build: 2, repair: 2, craft: 3, farm: 3 }), sched: SCHED_PRESETS.night.sched },
  { name: "Hunter", pri: P({ hunt: 1, fish: 1, guard: 3, farm: 3, repair: 4, build: 4, scavenge: 4 }) },
  { name: "Scavengers", kind: "crew", pri: P({ farm: 2, build: 3, repair: 3, scavenge: 4 }) },
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

// A cell: { p (0 = never), over (set for this person), def (the role's) }.
export function cellOf(state, s, key) {
  const role = roleOf(state, s);
  const def = role ? role.pri[key] || 0 : 0;
  const o = s.work && s.work.over && s.work.over[key];
  return o != null ? { p: o, over: true, def } : { p: def, over: false, def };
}
export const prio = (state, s, key) => cellOf(state, s, key).p;

const clampP = (p) => Math.max(0, Math.min(PRIO_MAX, Math.round(Number(p) || 0)));
export function setCell(state, s, key, p) {
  if (!s || !WORK_TYPES[key]) return "";
  const role = roleOf(state, s);
  if (!role) return `${s.name.split(" ")[0]} is on Manual: pick a role first.`;
  const v = clampP(p);
  s.work.over = s.work.over || {};
  if (v === (role.pri[key] || 0)) delete s.work.over[key]; else s.work.over[key] = v;
  return "";
}
export function clearCell(state, s, key) { if (s && s.work && s.work.over) delete s.work.over[key]; }
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
  return { urgent, kind, standing, size, bosses };
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

// Why someone should rest for their health ("" = fit to work).
export function healthRest(s) {
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
  if (state.autopilot && !(state.governor && state.governor.priorityRoles)) return; // the dev autopilot runs every role
  const w = state.work;
  if (w.newcomers != null && roleById(state, w.newcomers)) {
    for (const s of state.survivors) if (s.alive && !s.work && s.location.kind === "base") assignRole(state, s, w.newcomers);
  }
  for (const base of state.bases) planBase(state, base);
}

// Plans one base for this hour and applies it. Returns the number of people whose job changed.
export function planBase(state, base) {
  const people = atBase(state, base.id);
  const managed = people.filter((s) => isManaged(state, s));
  if (!managed.length) return 0;
  const h = hourOfDay(state);
  const ctx = makeCtx(state, base, people);
  const out = new Map();
  const put = (s, a) => out.set(s.id, a);
  const fit = managed.filter((s) => s.restUntil == null && !healthRest(s));
  let walls = new Set();
  if (ctx.threat.urgent) {
    const cands = fit.filter((s) => prio(state, s, "guard") > 0);
    walls = emergencyGuards(state, base, ctx.threat, cands, new Set(people.filter((s) => !managed.includes(s) && s.role === "guard")));
    ctx.wallsNote = ctx.threat.kind === "horde" ? ` (${walls.size} of ${cands.length} with Guard set ${walls.size === 1 ? "is" : "are"} needed to hold it)` : " (Guard is set)";
  }
  for (const s of managed) {
    const role = roleOf(state, s);
    if (s.restUntil != null) { put(s, { role: "rest", t: "rest", kind: "health", why: `Time off until day ${s.restUntil}` }); continue; }
    const sick = healthRest(s);
    if (sick) { put(s, { role: "rest", t: "rest", kind: "health", why: `Resting: ${sick}` }); continue; }
    if (walls.has(s)) { put(s, { role: "guard", t: "guard", kind: "emerg", why: `Emergency: ${ctx.threat.urgent}${ctx.wallsNote}` }); continue; }
    const block = schedAt(role, h);
    if (block === "g") { put(s, { role: "guard", t: "guard", kind: "sched", why: `Guard watch (${role.name}'s schedule)` }); continue; }
    if (block === "s" || block === "f") { put(s, { role: "rest", t: block === "s" ? "sleep" : "free", kind: "sched", why: `${SCHED[block].name} (${role.name}'s schedule)` }); continue; }
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
        if (o.cap - ctx.used[key] <= 0) { note(s, key, o.cap ? `full (${ctx.used[key]} of ${o.cap})` : o.why); continue; }
        const why = T.can ? T.can(ctx, s) : "";
        if (why) { note(s, key, why); continue; }
        pairs.push({ s, key, urg: o.urg || 0, score: (o.urg || 0) + rankOf(ctx, s, key) / 4 + (s.task && s.task.t === key ? STICKY : 0) });
      }
    }
    pairs.sort((a, b) => b.score - a.score || a.s.id - b.s.id || WORK_KEYS.indexOf(a.key) - WORK_KEYS.indexOf(b.key));
    for (const x of pairs) {
      if (!ctx.free.has(x.s)) continue;
      const o = ctx.open(x.key);
      if (o.cap - ctx.used[x.key] <= 0) { note(x.s, x.key, `full (${ctx.used[x.key]} of ${o.cap})`); continue; }
      const higher = (reasons.get(x.s.id) || []).filter((r) => prio(state, x.s, r.key) < p);
      give(x.s, x.key, p, "work", `${WORK_TYPES[x.key].ing}: priority ${p}${higher.length ? ` (before it: ${higher.map((r) => `${WORK_TYPES[r.key].name}: ${r.why}`).join("; ")})` : ""}`);
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
    stations: new Set(), learners: new Set(), studying: new Set(), repairTaken: new Set(), upkeepTaken: false,
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
  ctx.worn = fixtures(base).filter((f) => !f.broken && (f.wear || 0) >= 50).length; // upkeep before the risk of breaking (60)
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
const TASK_NAMES = { rest: "Resting", sleep: "Asleep", free: "Free time", idle: "Idle", guard: "On guard" };
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
