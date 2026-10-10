// What people are doing right now, and how each job at a base is getting on: one place for the People tab's
// activity line, the base's "Work now" panel and the tests (tools/activitytest.js). Read-only: it never changes the
// world or rolls dice, so the same game plays out with or without it.
//
// describeActivity(state, s) → { kind, icon, text, why, job }
//   kind: work (doing their job now), off (their job, but not at this hour: dark, between hunts), sleep, guard, hurt
//         (in bed or resting for their health), free (rest, free time), idle (a work role with nothing to do), stalled
//         (a job that cannot be done here: no trees, no cabin, nothing queued …), away (on a team, an errand …), eat
//         (a mealtime: MEALS).
//   text: a few words ("Chopping wood (fire axe)", "Asleep", "Away: Scavenge team, heading home"); why: the longer
//   reason (the tooltip); job: the role it is about (economy.js ROLES key) or null.
// The order at a base: hospital bed and health first, then the walls in an emergency, the watch roster, the hour's
// plan for people on work priorities (work.js s.task: sleep, free time, idle), the night (sleep.js sleepHour), and
// last the job itself by the hour (woodcutting by daylight, hunting and fishing at dawn and dusk …) and whether it
// can be done here at all (the same checks the work priorities use: woodWorkWhy, huntWorkWhy …).
//
// baseWork(state, base) → [{ job, name, icon, people: [{ s, act }], now, progress?, goal?, last, why }]
//   one row per job someone here is on (the job the day's systems count them at: work.js workDayRoles), in ROLES
//   order. progress: { frac, text } toward the next output (today's share of the job's hours with the expected
//   amount by midnight; a build or craft job's work-hours; the next harvest). goal: a longer target (the winter's
//   firewood). last: what it brought in on the last days it worked (output.js). why: why it brings in nothing now
//   (by the job, not the hour: asleep woodcutters on bare land still say why). stalledDays: since when (stallDaily).
//
// workingActivity(state, s): the job's state by the job, not the clock (at its working hour): what the Idle list,
//   the Bases badge and the stalled-job alert read. idlePeople(state, base?) → [{ s, base, act, why }]: people at a
//   base with nothing to do (a work role with no work, or a job that cannot be done here), not counting anyone
//   resting (the Rest job, free time), in bed, ill or hurt, on watch or away. workCount(state, base) → { total,
//   working, idle, hurt, resting }.
// Mealtimes (meals.js MEALS): breakfast at 06:00 (08:00 for hunters and fishers, after the dawn hunt) and dinner at
//   20:00, an hour each, show as "Eating". The food and water still come out of the store once a day (economy.js
//   baseDaily); the jobs that work every hour (construction, crafting, gear repairs) stop for them (meals.js), the
//   jobs with set hours have no meal in them.
// stallDaily(state) (world.js, after the bases' day): base.stall[job] = the day a job here was first found with nobody
//   on it able to work (row.why), cleared when it can work again; the alert (ui/activity.js stallAlerts) comes at 2 days.
import { atBase, baseById, factionById, hourOfDay, survivorById, day, skill } from "./world.js";
import { SUPPLIES, GEAR, SKILL_NAMES } from "./data.js";
import { ROLES, scavLeft, SCAV_FLOOR, scavengeOutput } from "./economy.js";
import { WORK_TYPES, isManaged, healthRest } from "./work.js";
import { BUILDINGS, stations, stationStatus, buildRate, gatherStalled, underAttack, onUpkeep } from "./buildings.js";
import { CRAFTS, craftQueue, craftJobStatus, craftName, craftRate } from "./crafting.js";
import { CROPS, farmOf, farmersWanted, nextHarvests } from "./farming.js";
import { WOOD, woodWorkWhy, woodTime, chopCrew, isChopTool, baseWoodTiles, seasonWood, woodCrowd, woodNeed } from "./woodcutting.js";
import { forageWorkWhy, forageTime, baseForageDay } from "./foraging.js";
import { huntWorkWhy, fishWorkWhy, baseHuntDay, baseFishDay } from "./hunting.js";
import { hospitalDef, isHurt, patients } from "./medical.js";
import { workFactor, isSick } from "./health.js";
import { lessonOf, bookDef, skillProgress, bookHours } from "./skills.js";
import { BLUEPRINTS, studyHours } from "./blueprints.js";
import { edibleFood } from "./storage.js";
import { sleepHour, sleepingIn } from "./sleep.js";
import { onWatchNow } from "./watch.js";
import { MISSIONS, tileLabel, partyTile } from "./parties.js";
import { orderStatus } from "./orders.js";
import { fixtures, fixtureName } from "./breakdowns.js";
import { outputDays } from "./output.js";
import { MEALS, MEAL_WORK_SHARE } from "./meals.js";

// Icons by job, and by kind for everything that is not a job.
export const JOB_ICONS = { wood: "🪓", farm: "🌱", forage: "🍄", hunt: "🏹", fish: "🎣", build: "🔨", craft: "🧰", operate: "⚙️", medic: "✚", trainee: "✚", teach: "🎓", read: "📚", scavenge: "🔍", guard: "🛡️", rest: "☕" };
export const KIND_ICONS = { sleep: "💤", guard: "🛡️", hurt: "🩹", free: "☕", idle: "⏸", stalled: "⚠️", off: "🕓", away: "🚶", captive: "⛓️", eat: "🍲" };
// Mealtimes (meals.js: the hour each starts; an hour each). Hunters and fishers are out at dawn (05–07), so they eat after.
export { MEALS };
export function mealAt(job, h) {
  const b = job === "hunt" || job === "fish" ? MEALS.lateBreakfast : MEALS.breakfast;
  return h === b ? "breakfast" : h === MEALS.dinner ? "dinner" : null;
}
export const STALL_ALERT_DAYS = 2;
const UPKEEP_WORTH = 20; // wear on a building that makes a builder's upkeep worth a day (breakdowns.js: they mend any wear)
const MIN_WORK = 0.35; // the daily jobs skip anyone below this work factor (woodDaily, foragingDaily, huntingDaily)
const r1 = (v) => Math.round((v || 0) * 10) / 10;
const n0 = (v) => Math.round(v || 0);
const hh = (h) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;
const first = (s) => s.name.split(" ")[0];
const act = (kind, text, why = "", job = null, icon = null) => ({ kind, icon: icon || (kind === "work" && job && JOB_ICONS[job]) || KIND_ICONS[kind] || "•", text, why, job });
const DAWN_DUSK = [6, 17, 7]; // hunting.js DAWN_DUSK, its first CABIN.hours: the hours the base's hunters and fishers are out
const FORAGE_HOURS = [9, 11, 13, 15, 17, 19]; // foraging.js foragingDaily: FORAGE.base.hours from 09:00, every 2 hours
const AWAKE = [6, 22]; // the default day (sleep.js TIRED.NIGHT 22–06)

// ---------- one person ----------
export function describeActivity(state, s, h = hourOfDay(state)) {
  if (!s || !s.alive) return act("away", s && s.left ? "Has left the group" : "Dead");
  const l = s.location || {};
  if (l.kind !== "base") return awayActivity(state, s);
  const base = baseById(state, l.baseId);
  if (!base) return act("away", "Away");
  if (s.inBed) return act("hurt", `${isHurt(s) ? "Wounded" : "Ill"} – in a hospital bed`, `Health ${n0(s.health)}${isSick(s) ? ", ill" : ""}: in a bed on the ward until they are well enough to work.`);
  if (s.restUntil != null) return act("hurt", `Time off until day ${s.restUntil}`, "Off work for a while (a card gave them days off).");
  const rest = healthRest(s);
  if (rest) return act("hurt", `Resting – ${rest}`, `Not fit to work: ${rest}.`);
  const t = isManaged(state, s) && s.task && s.task.base === base.id && state.hour - s.task.hour <= 1 ? s.task : null;
  if (t && t.kind === "emerg" && t.t === "guard") return act("guard", "Manning the walls", t.why, "guard");
  if (!t && s.role === "guard" && underAttack(state, base)) return act("guard", "Manning the walls", "The base is on alert: the guards are on the walls.", "guard");
  const ws = onWatchNow(state, base, s, h);
  if (ws) return act("guard", `On watch (${ws.name})`, "Their shift on the base's watch roster (Defence tab).", "guard");
  const meal = mealAt(s.role, h);
  if (meal && s.role !== "guard" && !(t && (t.t === "sleep" || t.t === "guard")) && !sleepHour(state, s, h) && !sleepingIn(state, base, s, h)) {
    if (edibleFood(base) > 0 || (base.stock.food || 0) > 0) return act("eat", `Eating ${meal}`, `${meal === "breakfast" ? "Breakfast" : "Dinner"} at ${base.name}. The day's food comes out of the store once a day; building and crafting stop for the hour.`, s.role);
    return act("eat", "Mealtime – nothing to eat", `${base.name} is out of food.`, s.role, "🍽️");
  }
  if (t) {
    if (t.t === "sleep") return act("sleep", "Asleep", t.why);
    if (t.t === "free") return act("free", t.kind === "mood" ? "Free time – low mood" : "Free time", t.why);
    if (t.t === "idle") return act("idle", "Idle – nothing to do", t.why);
    if (t.t === "rest") return act("hurt", "Resting", t.why);
  }
  if (sleepingIn(state, base, s, h)) return act("sleep", "Sleeping off the watch", `Owes ${Math.ceil(s.tired || 0)} hours of sleep after a night watch.`);
  const job = s.role;
  if (job !== "guard" && sleepHour(state, s, h)) {
    const name = ROLES[job] ? ROLES[job].name : "work";
    return act("sleep", "Asleep", job === "rest" ? "Asleep for the night." : `Asleep for the night; ${name} again in the morning.`, job);
  }
  const a = jobActivity(state, base, s, job, h);
  if (t && t.why && !a.why.includes(t.why)) a.why = a.why ? `${a.why} ${t.why}.` : t.why;
  return a;
}

// The job itself at this hour, and whether it can be done here.
function jobActivity(state, base, s, job, h) {
  const weak = workFactor(s) < MIN_WORK;
  const name = ROLES[job] ? ROLES[job].name : job;
  if (weak && ["wood", "forage", "hunt", "fish"].includes(job)) return act("stalled", `${name}: too weak to work`, "Ill, hurt or in very low spirits: the day's work is skipped until they are better.", job);
  switch (job) {
    case "wood": {
      const why = woodWorkWhy(state, base);
      if (why) return act("stalled", `Can't cut wood: ${why}`, `Nothing worth cutting around ${base.name}: ${why}. Send a team to cut wood on a forest tile, or trade for firewood.`, job);
      if (woodTime(h) <= 0) return act("off", "Done chopping for the day", `Too dark to fell trees: back at it at dawn (05:00). The day's firewood comes into the store at midnight.`, job);
      const c = chopCrew([s], (base.armory || []).filter(isChopTool))[0];
      return act("work", `Chopping wood (${c.tool ? c.tool.name.toLowerCase() : "by hand"})`, c.tool ? "" : "No axe, machete or sledgehammer: gathering deadfall by hand is much slower. Put a cutting tool in the armory.", job);
    }
    case "forage": {
      const why = forageWorkWhy(state, base);
      if (why) return act("stalled", `Can't forage: ${why}`, `Nothing worth gathering around ${base.name}: ${why}.`, job);
      if (forageTime(h) <= 0) return act("off", "Done foraging for the day", "Too dark to find anything: out again at first light.", job);
      return act("work", "Foraging", "", job);
    }
    case "hunt": {
      const why = huntWorkWhy(state, base);
      if (why) return act("stalled", `Can't hunt: ${why}`, `The Hunt job needs a Hunting cabin and game land within 2 tiles: ${why}.`, job);
      return DAWN_DUSK.includes(h) ? act("work", "Hunting", "Out at dawn and dusk, when game moves.", job) : act("off", "Hunter – out again at dusk", "Hunters go out 3 hours a day, at dawn and dusk (05–07, 17–19); the catch comes in at midnight.", job);
    }
    case "fish": {
      const why = fishWorkWhy(state, base);
      if (why) return act("stalled", `Can't fish: ${why}`, `The Fish job needs a river or lake and a rod, net or spear: ${why}.`, job);
      return DAWN_DUSK.includes(h) ? act("work", "Fishing", "Out at dawn and dusk.", job) : act("off", "Fisher – out again at dusk", "Fishers are out 3 hours a day, at dawn and dusk; the catch comes in at midnight.", job);
    }
    case "farm": {
      const fw = farmersWanted(state, base);
      if (fw.active + fw.toSow <= 0) return act("stalled", "Farmer – no crops to tend", "No plot is planted or ready to sow (Farming tab: sow a plot, or turn on replanting).", job);
      return act("work", "Tending the crops", "", job);
    }
    case "build": {
      const rep = (base.repairs || []).find((j) => j.who === s.id);
      if (rep) {
        const fx = fixtures(base).find((f) => String(f.id) === String(rep.fx));
        return act("work", `Repairing the ${fx ? fixtureName(fx).toLowerCase() : "building"} (${pct(rep.done / Math.max(1, rep.hours))})`, "", job, "🔧");
      }
      // Builders with nothing to build mend the worn buildings (breakdowns.js upkeep); kept on upkeep, always.
      const worn = fixtures(base).filter((f) => !f.broken && (f.wear || 0) >= UPKEEP_WORTH).length;
      if (worn && (!base.construction.length || (s.upkeep && onUpkeep(state, base, s)))) return act("work", `Upkeep on worn buildings (${worn})`, "Mending wear before things break (Repairs tab).", job, "🔧");
      if (!base.construction.length) return act("stalled", "Builder – nothing to build", "The construction queue is empty and nothing is worn: queue a building (Construction tab) or give them another job.", job);
      if (underAttack(state, base)) return act("stalled", "Building stopped – on alert", "Nobody builds while the base is on alert or under siege.", job);
      const j = base.construction.find((c) => !gatherStalled(c));
      if (!j) return act("stalled", "Builder – waiting for materials", "The queued builds wait for their materials to be gathered or brought in.", job);
      return act("work", `Building ${buildName(j)} (${pct(j.progress / Math.max(1, j.hours))})`, "", job);
    }
    case "craft": {
      const q = craftQueue(base);
      if (!q.length) return act("stalled", "Crafter – queue empty", "Nothing in the craft queue (Crafting tab).", job);
      const j = q.find((x) => !craftJobStatus(state, base, x));
      if (!j) return act("stalled", `Crafter – ${lower(craftJobStatus(state, base, q[0]))}`, craftJobStatus(state, base, q[0]), job);
      return act("work", `Crafting ${craftName(j.recipe).toLowerCase()} (${pct(j.progress / Math.max(1, j.hours))})`, "", job);
    }
    case "operate": {
      const st = stations(base).find((x) => x.id === s.station);
      if (!st) return act("stalled", "Operator – no station", "Not on a workshop station: build one, or pick another job.", job);
      const status = stationStatus(state, base, st);
      const nm = BUILDINGS[st.type].name;
      if (!status.running) return act("stalled", `${nm}: ${lower(status.reason || "idle")}`, status.reason || "", job);
      return act("work", `At the ${nm.toLowerCase()}`, `Makes ${outText(status.out) || "its goods"} a day (into the store at midnight).`, job);
    }
    case "medic": {
      const pts = patients(state, base).length;
      const hurt = atBase(state, base.id).filter((x) => x !== s && (isHurt(x) || isSick(x))).length;
      return act("work", pts ? `On medic duty (${pts} in bed)` : hurt ? `On medic duty (${hurt} to look after)` : "On medic duty (quiet ward)", hospitalDef(base).tier ? "" : "No infirmary: only the badly hurt get much from a medic.", job);
    }
    case "trainee": return act("work", "Training on the ward", "", job);
    case "guard": return act("guard", "On guard", "A lookout on the walls (counts 1.5× in a fight).", job);
    case "rest": return act("free", "Resting", "Their job is Rest: recovers mood.", job);
    case "teach": {
      const l = lessonOf(state, s);
      if (!l || !l.learners.length) return act("stalled", "Teacher – nobody to teach", "Nobody here is 4+ below them in a skill.", job);
      return act("work", `Teaching ${SKILL_NAMES[l.skill] || l.skill} to ${l.learners.map((id) => survivorById(state, id)).filter(Boolean).map(first).join(", ")}`, "", job);
    }
    case "read": {
      if (s.studying && BLUEPRINTS[s.studying]) return act("work", `Studying the ${BLUEPRINTS[s.studying].name}`, "", job);
      if (s.reading && bookDef(s.reading)) return act("work", `Reading ${GEAR[s.reading] ? GEAR[s.reading].name : "a book"}`, "", job);
      return act("stalled", "Reader – nothing to read", "No book or blueprint here they can learn from.", job);
    }
    case "scavenge":
      if (scavLeft(base) <= SCAV_FLOOR + 0.02) return act("stalled", "Scavenger – area picked clean", "The ruins around the base are picked over: send a team on a trip instead.", job);
      return act("work", "Scavenging nearby", "", job);
    default: return act("work", ROLES[job] ? ROLES[job].name : "Working", "", job);
  }
}

function awayActivity(state, s) {
  const l = s.location;
  if (l.kind === "party") {
    const p = state.parties.find((x) => x.id === l.partyId);
    if (!p) return act("away", "Away on a team");
    if (p.kind === "convoy") return act("away", "Away: on the road with a convoy");
    const m = p.teamMission || p.mission;
    const team = !MISSIONS[m] || m === "move" || m === "formed" ? "team" : `${MISSIONS[m].name.toLowerCase()} team`;
    let what = "on the way";
    if (p.phase === "waiting") what = "waiting for orders";
    else if (p.phase === "back") what = "heading home";
    else if (p.phase === "task") { const o = orderStatus(state, p); what = `${lower(o.label)}${o.left != null ? `, ${o.left}h left` : ""}`; }
    else if (p.phase === "engaged" || p.phase === "siege") what = "in a fight";
    else if (p.dest != null) what = `going to ${tileLabel(state, p.dest)}`;
    return act("away", `${team === "team" ? "Away with a team" : `Away: ${team}`}, ${what}`, `Out with the team at ${tileLabel(state, partyTile(p))}.`);
  }
  if (l.kind === "route") return act("away", "Away: escorting a trade route");
  if (l.kind === "errand") return act("away", `Away on an errand (back ~day ${l.until})`);
  if (l.kind === "lent") { const f = factionById(state, l.fid); return act("away", `Lent to ${f ? f.name : "another group"}`); }
  if (l.kind === "captive") { const f = factionById(state, l.factionId); return act("away", `Held captive${f && f.known ? ` by ${f.name}` : ""}`, "", null, KIND_ICONS.captive); }
  return act("away", "Away");
}

const pct = (f) => `${Math.max(0, Math.min(100, Math.floor((f || 0) * 100)))}%`;
const lower = (t) => (t ? t[0].toLowerCase() + t.slice(1) : "");
const buildName = (j) => (BUILDINGS[j.type] ? BUILDINGS[j.type].name.toLowerCase() : j.type);

// ---------- units ----------
// "140 firewood (14 kg)", "12 food", "3 work-hours" …
export function amountText(unit, n) {
  const v = r1(n);
  if (unit === "wood") return `${n0(v)} firewood (${r1(v * SUPPLIES.wood.weight)} kg)`;
  if (unit === "workh") return `${r1(v)} work-hours`;
  if (unit === "done") return `${n0(v)} finished`;
  if (unit === "items") return `${n0(v)} made`;
  if (unit === "finds") return `${n0(v)} find${n0(v) === 1 ? "" : "s"}`;
  if (unit === "buildmat") return `${v} building materials`;
  if (unit === "xp") return `${r1(v)} XP`;
  if (unit === "readh") return `${r1(v)} hours read`;
  if (unit === "heal") return `${r1(v)} health healed`;
  return `${v} ${SUPPLIES[unit] ? SUPPLIES[unit].name.toLowerCase() : unit}`;
}
const outText = (out) => Object.entries(out || {}).filter(([, v]) => v > 0).map(([k, v]) => amountText(k, v)).join(", ");

// What a job brought in on its last recorded days: [{ day, when ("yesterday", "today", "day 12"), text, zero }].
export function lastOutput(state, base, job) {
  const today = day(state);
  return outputDays(base, job).map((d) => {
    const by = Object.entries(d.by).filter(([u]) => !(job === "scavenge" && u === "finds"));
    const parts = by.filter(([, v]) => v > 0.05).map(([u, v]) => `+${amountText(u, v)}`);
    const when = d.day === today ? "today" : d.day === today - 1 ? "yesterday" : `day ${d.day}`;
    return { day: d.day, when, text: parts.join(", ") || "nothing", zero: !parts.length };
  });
}

// The main measure of a job's day (for the sparklines): the unit and how it sums a day's record.
const MAIN_UNIT = { wood: "wood", forage: "food", hunt: "food", fish: "food", farm: "food", build: "workh", craft: "workh", teach: "xp", read: "readh", medic: "heal", trainee: "xp" };
// The last `days` work days of a job, oldest first (0 for a day with nothing recorded): { unit, days: [{ day, n }] }.
// The day being worked now is left out until it is in (the daily jobs' output comes at midnight).
export function outputSeries(state, base, job, days = 7) {
  const rec = outputDays(base, job);
  const unit = MAIN_UNIT[job] || null;
  const end = day(state) - (["build", "craft", "medic"].includes(job) ? 0 : 1);
  const out = [];
  for (let d = end - days + 1; d <= end; d++) {
    const r = rec.find((x) => x.day === d);
    const by = r ? r.by : {};
    const n = unit ? (job === "farm" ? (by.food || 0) + (by.preserved || 0) : by[unit] || 0) : Object.entries(by).filter(([u]) => u !== "finds").reduce((a, [, v]) => a + v, 0);
    out.push({ day: d, n: r1(n), rec: !!r });
  }
  return { unit: unit || "supplies", days: out };
}

// ---------- the base's jobs ----------
// The job the day's systems count someone at (work.js workDayRoles: asleep or on a watch at midnight, people on
// priorities count at their last work of the day).
export function dayJob(state, s) {
  const t = isManaged(state, s) ? s.task : null;
  if (t && (t.kind === "sched" || t.kind === "emerg") && t.last && state.hour - t.last.hour <= 72) return t.last.role;
  return s.role;
}
const JOB_ORDER = () => Object.keys(ROLES).filter((k) => k !== "rest");

export function baseWork(state, base, h = hourOfDay(state)) {
  const people = atBase(state, base.id);
  const by = new Map();
  for (const s of people) {
    const j = dayJob(state, s);
    if (!by.has(j)) by.set(j, []);
    by.get(j).push(s);
  }
  const rows = [];
  for (const job of [...JOB_ORDER(), "rest"]) {
    const list = by.get(job);
    if (!list || !list.length) continue;
    const ps = list.map((s) => ({ s, act: describeActivity(state, s, h) }));
    const row = { job, name: ROLES[job] ? ROLES[job].name : job, icon: JOB_ICONS[job] || "•", people: ps, now: ps.filter((x) => x.act.kind === "work" || (job === "guard" && x.act.kind === "guard")).length, last: lastOutput(state, base, job), why: "" };
    // Why it brings in nothing: by the job, not the hour (asleep on cut-bare land still says why).
    const states = list.map((s) => workingActivity(state, s));
    const stalled = states.filter((a) => a.kind === "stalled");
    if (stalled.length && stalled.length === states.length) row.why = stalled[0].why || stalled[0].text;
    const since = base.stall && base.stall[job];
    row.stalledDays = row.why && since != null ? Math.max(0, day(state) - since) : 0;
    Object.assign(row, jobProgress(state, base, job, list, h));
    rows.push(row);
  }
  return rows;
}

// Share of a day's work hours already past at hour h (weights by hour).
const dayShare = (weight, h) => { let done = 0, all = 0; for (let x = 0; x < 24; x++) { const w = weight(x); all += w; if (x < h) done += w; } return all > 0 ? done / all : 0; };
const inList = (list) => (x) => (list.includes(x) ? 1 : 0);
const awakeHour = (x) => (x >= AWAKE[0] && x < AWAKE[1] ? 1 : 0);
const able = (list) => list.filter((s) => !s.inBed && workFactor(s) >= MIN_WORK && !healthRest(s));

// { progress?, goal? } for one job: what the day's work is heading for.
function jobProgress(state, base, job, list, h) {
  const out = {};
  const daily = (frac, expect, unit, note = "") => ({ frac, text: expect > 0.05 ? `≈ ${amountText(unit, expect)} expected at midnight${note}` : `nothing expected today${note}` });
  if (job === "wood" && !woodWorkWhy(state, base)) {
    const tile = baseWoodTiles(state, base)[0];
    const crew = chopCrew(able(list), (base.armory || []).filter(isChopTool));
    const expect = tile ? crew.reduce((a, c, k) => a + WOOD.rate * tile.v * seasonWood(state) * c.mult * Math.min(1, workFactor(c.s)) * woodCrowd(k) * WOOD.base.hours, 0) : 0;
    out.progress = daily(dayShare(woodTime, h), expect, "wood", ` · ${crew.filter((c) => c.tool).length} of ${crew.length} with a cutting tool`);
    const w = woodNeed(state, base);
    const kg = (v) => n0(v * SUPPLIES.wood.weight);
    if (w.need > 0) out.goal = { frac: Math.min(1, w.have / w.need), text: `Winter store: ${n0(w.have)} of ${n0(w.need)} firewood (${kg(w.have)} of ${kg(w.need)} kg)${w.short ? (expect > 0 ? ` · ~${Math.ceil((w.need - w.have) / expect)} more days at this pace` : "") : " · enough for the cold ahead"}` };
  } else if (job === "forage" && !forageWorkWhy(state, base)) {
    out.progress = daily(dayShare(inList(FORAGE_HOURS), h), able(list).reduce((a, s) => a + baseForageDay(state, base, s), 0), "food");
  } else if (job === "hunt" && !huntWorkWhy(state, base)) {
    out.progress = daily(dayShare(inList(DAWN_DUSK), h), baseHuntDay(state, base) * able(list).length, "food", " (an average hunter's catch)");
  } else if (job === "fish" && !fishWorkWhy(state, base)) {
    out.progress = daily(dayShare(inList(DAWN_DUSK), h), baseFishDay(state, base) * able(list).length, "food");
  } else if (job === "farm") {
    const next = nextHarvests(state, base)[0];
    if (next) {
      const p = farmOf(state, base).plots.find((x) => x.id === next.plot);
      const frac = p && p.stage === "ripe" ? 1 : p && CROPS[p.crop] ? Math.min(1, (p.grown || 0) / CROPS[p.crop].days) : 0;
      out.progress = { frac, text: next.inDays <= 0 ? `${next.name} ripe: harvested at midnight (~${n0(next.food)} food)` : `Next harvest: ${next.name} in ~${next.inDays} day${next.inDays === 1 ? "" : "s"} (~${n0(next.food)} food)` };
    }
  } else if (job === "build") {
    const j = base.construction.find((c) => !gatherStalled(c));
    const rep = (base.repairs || []).find((r) => list.some((s) => s.id === r.who));
    if (j && !underAttack(state, base)) {
      const rate = buildRate(state, base);
      const left = Math.max(0, j.hours - j.progress);
      out.progress = { frac: j.progress / Math.max(1, j.hours), text: `${BUILDINGS[j.type] ? BUILDINGS[j.type].name : j.type}: ${n0(j.progress)} of ${n0(j.hours)} work-hours${rate > 0 ? ` · ~${Math.ceil(left / (rate * MEAL_WORK_SHARE))} h left` : ""}${base.construction.length > 1 ? ` · ${base.construction.length - 1} more queued` : ""}` };
    } else if (rep) {
      const fx = fixtures(base).find((f) => String(f.id) === String(rep.fx));
      out.progress = { frac: rep.done / Math.max(1, rep.hours), text: `Repairing the ${fx ? fixtureName(fx).toLowerCase() : "building"}: ${n0(rep.done)} of ${rep.hours} work-hours` };
    }
  } else if (job === "craft") {
    const j = craftQueue(base).find((x) => !craftJobStatus(state, base, x));
    if (j && CRAFTS[j.recipe]) {
      const rate = craftRate(state, base, j.recipe);
      out.progress = { frac: j.progress / Math.max(0.1, j.hours), text: `${craftName(j.recipe)}: ${pct(j.progress / Math.max(0.1, j.hours))}${rate > 0 ? ` · ~${Math.ceil(Math.max(0, j.hours - j.progress) / (rate * MEAL_WORK_SHARE))} h left` : ""}${craftQueue(base).length > 1 ? ` · ${craftQueue(base).length - 1} more queued` : ""}` };
    }
  } else if (job === "operate") {
    const sts = stations(base).map((st) => ({ st, status: stationStatus(state, base, st) })).filter((x) => x.status.op && list.includes(x.status.op));
    const running = sts.filter((x) => x.status.running && x.status.recipe !== "power");
    const sum = {};
    for (const x of running) for (const [k, v] of Object.entries(x.status.out || {})) sum[k] = (sum[k] || 0) + v;
    if (sts.length) out.progress = { frac: dayShare(awakeHour, h), text: running.length ? `≈ ${outText(sum)} at midnight (${running.length} of ${sts.length} station${sts.length === 1 ? "" : "s"} running)` : "no station running today" };
  } else if (job === "teach") {
    const parts = [], fr = [];
    for (const T of list) {
      const l = lessonOf(state, T);
      if (!l || !l.learners.length) continue;
      for (const L of l.learners.map((id) => survivorById(state, id)).filter(Boolean)) {
        const sp = skillProgress(L, l.skill);
        fr.push(sp.frac);
        parts.push(`${first(L)} ${SKILL_NAMES[l.skill] || l.skill} ${sp.level}→${sp.level + 1} ${sp.pct}%`);
      }
    }
    if (fr.length) out.progress = { frac: fr.reduce((a, v) => a + v, 0) / fr.length, text: parts.join(" · ") };
  } else if (job === "read") {
    const parts = [], fr = [];
    for (const s of list) {
      if (s.studying && BLUEPRINTS[s.studying]) { const d = BLUEPRINTS[s.studying]; const hrs = studyHours(state, s.studying); fr.push(hrs / d.hours); parts.push(`${first(s)}: the ${d.name} ${n0(hrs)} of ${d.hours} h`); }
      else if (s.reading && bookDef(s.reading)) { const b = bookDef(s.reading); const hrs = bookHours(s, s.reading); fr.push(Math.min(1, hrs / b.hours)); parts.push(`${first(s)}: ${GEAR[s.reading] ? GEAR[s.reading].name : "a book"} ${n0(hrs)} of ${b.hours} h`); }
    }
    if (fr.length) out.progress = { frac: fr.reduce((a, v) => a + v, 0) / fr.length, text: parts.join(" · ") };
  } else if (job === "medic") {
    const care = atBase(state, base.id).filter((x) => !list.includes(x) && (isHurt(x) || isSick(x)));
    const beds = care.filter((x) => x.inBed).length;
    const avg = care.length ? care.reduce((a, x) => a + (x.health ?? 100), 0) / care.length : 100;
    out.progress = care.length
      ? { frac: avg / 100, text: `${care.length} hurt or ill here${beds ? ` (${beds} in bed)` : ""} · average health ${n0(avg)}` }
      : { frac: 1, text: "Nobody here needs care" };
  } else if (job === "trainee") {
    const sp = list.map((s) => ({ s, p: skillProgress(s, "medicine") }));
    out.progress = { frac: sp.reduce((a, x) => a + x.p.frac, 0) / sp.length, text: sp.map((x) => `${first(x.s)} Medicine ${x.p.level}→${x.p.level + 1} ${x.p.pct}%`).join(" · ") };
  } else if (job === "scavenge" && scavLeft(base) > SCAV_FLOOR + 0.02) {
    const exp = Object.values(scavengeOutput(state, base)).reduce((a, v) => a + v, 0);
    out.progress = { frac: dayShare(awakeHour, h), text: `≈ ${r1(exp)} supplies a day on average (most days nothing) · area ${Math.round(scavLeft(base) * 100)}% left` };
  }
  return out;
}

// ---------- by the job, not the clock: the Idle list, the Bases badge, the stalled-job alert ----------
// The hour each job is checked at (a working hour of the job).
const WORK_HOUR = { hunt: 6, fish: 6 };
export function workingActivity(state, s) {
  if (!s || !s.alive || !s.location || s.location.kind !== "base") return describeActivity(state, s);
  const base = baseById(state, s.location.baseId);
  if (!base) return act("away", "Away");
  if (s.inBed || s.restUntil != null || healthRest(s)) return describeActivity(state, s);
  const t = isManaged(state, s) && s.task && s.task.base === base.id && state.hour - s.task.hour <= 1 ? s.task : null;
  if (t && t.t === "idle") return act("idle", "Idle – nothing to do", t.why);
  if (t && t.t === "free") return act("free", t.kind === "mood" ? "Free time – low mood" : "Free time", t.why);
  const job = dayJob(state, s);
  if (job === "rest") return act("free", "Resting", "Their job is Rest: recovers mood.", job);
  if (job === "guard") return act("guard", "On guard", "", job);
  return jobActivity(state, base, s, job, WORK_HOUR[job] ?? 12);
}
const IDLE_KINDS = new Set(["idle", "stalled"]);
// People at a base (every base when base is null) with nothing to do: [{ s, base, act, why }].
export function idlePeople(state, base = null) {
  const out = [];
  for (const b of base ? [base] : state.bases) {
    for (const s of atBase(state, b.id)) {
      if (onWatchNow(state, b, s)) continue;
      const a = workingActivity(state, s);
      if (IDLE_KINDS.has(a.kind)) out.push({ s, base: b, act: a, why: a.kind === "idle" ? idleWhy(a) : a.text });
    }
  }
  return out;
}
// A short why for someone on priorities with nothing to do (the planner's reasons).
function idleWhy(a) {
  const m = /\((.*)\)$/.exec(a.why || "");
  return m ? `Nothing to do (${m[1]})` : a.why === "No work type is set for them" ? "No work type set in their role" : "Nothing to do";
}
// The Bases badge: { total, working, idle, hurt, resting }.
export function workCount(state, base) {
  const ppl = atBase(state, base.id);
  const c = { total: ppl.length, working: 0, idle: 0, hurt: 0, resting: 0 };
  for (const s of ppl) {
    const k = workingActivity(state, s).kind;
    if (IDLE_KINDS.has(k)) c.idle++;
    else if (k === "hurt") c.hurt++;
    else if (k === "free") c.resting++;
    else c.working++;
  }
  return c;
}
// Daily (world.js, after the bases' day): the day each job at a base was first found unable to work.
export function stallDaily(state) {
  for (const b of state.bases) {
    const now = {};
    for (const r of baseWork(state, b)) if (r.why) now[r.job] = b.stall && b.stall[r.job] != null ? b.stall[r.job] : day(state);
    if (Object.keys(now).length) b.stall = now; else delete b.stall;
  }
}
// Jobs stalled for STALL_ALERT_DAYS or more, still stalled now: [{ base, job, name, days, why, people }].
export function stalledJobs(state) {
  const out = [];
  for (const b of state.bases) {
    if (!b.stall) continue;
    for (const r of baseWork(state, b)) if (r.why && r.stalledDays >= STALL_ALERT_DAYS) out.push({ base: b, job: r.job, name: r.name, days: r.stalledDays, why: r.why, people: r.people.map((x) => x.s) });
  }
  return out;
}
// Could this person do this job here (at its working hour)? The job's activity: kind "stalled" when it cannot run.
// station: for "operate", the station to try. Nothing is changed (the role is put back).
export function jobCheck(state, base, s, job, station = null) {
  const was = [s.role, s.station];
  s.role = job;
  if (job === "operate") s.station = station;
  try { return jobActivity(state, base, s, job, WORK_HOUR[job] ?? 12); } finally { [s.role, s.station] = was; }
}
