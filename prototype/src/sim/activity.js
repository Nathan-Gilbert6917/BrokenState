// What people are doing right now, and how each job at a base is getting on: one place for the People tab's
// activity line, the base's "Work now" panel and the tests (tools/activitytest.js). Read-only: it never changes the
// world or rolls dice, so the same game plays out with or without it.
//
// describeActivity(state, s) → { kind, icon, text, why, job }
//   kind: work (doing their job now), off (their job, but not at this hour: dark, between hunts), sleep, guard, hurt
//         (in bed or resting for their health), free (rest, free time), idle (a work role with nothing to do), stalled
//         (a job that cannot be done here: no trees, no cabin, nothing queued …), away (on a team, an errand …).
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
//   firewood). last: what it brought in on the last days it worked (output.js). why: why it brings in nothing now.
import { atBase, baseById, factionById, hourOfDay, survivorById, day } from "./world.js";
import { SUPPLIES, GEAR, SKILL_NAMES } from "./data.js";
import { RAW } from "./water.js";
import { ROLES, scavLeft, SCAV_FLOOR, scavengeOutput } from "./economy.js";
import { WORK_TYPES, isManaged, healthRest } from "./work.js";
import { BUILDINGS, stations, stationStatus, buildRate, gatherStalled, underAttack } from "./buildings.js";
import { CRAFTS, craftQueue, craftJobStatus, craftName, craftRate } from "./crafting.js";
import { CROPS, farmOf, farmersWanted, nextHarvests } from "./farming.js";
import { WOOD, woodWorkWhy, woodTime, chopCrew, isChopTool, woodTripTile, seasonWood, woodCrowd, woodNeed } from "./woodcutting.js";
import { forageWorkWhy, forageTime, baseForageDay } from "./foraging.js";
import { huntWorkWhy, fishWorkWhy, baseHuntDay, baseFishDay } from "./hunting.js";
import { hospitalDef, isHurt, patients } from "./medical.js";
import { workFactor, isSick } from "./health.js";
import { lessonOf, bookDef } from "./skills.js";
import { BLUEPRINTS } from "./blueprints.js";
import { sleepHour, sleepingIn } from "./sleep.js";
import { onWatchNow } from "./watch.js";
import { MISSIONS, tileLabel, partyTile } from "./parties.js";
import { orderStatus } from "./orders.js";
import { fixtures, fixtureName } from "./breakdowns.js";
import { outputDays } from "./output.js";
import { TRIP_JOBS, tripWindow, inTripHours } from "./tripland.js"; // the outdoor jobs' hours (jobtrips.js trips)
import { tripState, tripTarget } from "./jobtrips.js"; // where someone out on a trip is: "Heading to forest (3,7)", "Bringing 18 kg meat back"
import { fetchWaterWhy, fetchWaterDay } from "./economy.js"; // Fetch water

// Icons by job, and by kind for everything that is not a job.
export const JOB_ICONS = { water: "🪣", wood: "🪓", farm: "🌱", forage: "🍄", hunt: "🏹", fish: "🎣", build: "🔨", craft: "🧰", operate: "⚙️", medic: "✚", trainee: "✚", teach: "🎓", read: "📚", scavenge: "🔍", guard: "🛡️", rest: "☕" };
export const KIND_ICONS = { sleep: "💤", guard: "🛡️", hurt: "🩹", free: "☕", idle: "⏸", stalled: "⚠️", off: "🕓", away: "🚶", captive: "⛓️" };
const MIN_WORK = 0.35; // the daily jobs skip anyone below this work factor (woodDaily, foragingDaily, huntingDaily)
const r1 = (v) => Math.round((v || 0) * 10) / 10;
const n0 = (v) => Math.round(v || 0);
const hh = (h) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;
const first = (s) => s.name.split(" ")[0];
const act = (kind, text, why = "", job = null, icon = null) => ({ kind, icon: icon || (kind === "work" && job && JOB_ICONS[job]) || KIND_ICONS[kind] || "•", text, why, job });
const hours = (job) => TRIP_JOBS[job].windows.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(" and "); // "06:00–10:00 and 16:00–20:00"
const AWAKE = [6, 22]; // the default day (sleep.js TIRED.NIGHT 22–06)

// ---------- one person ----------
// opts.trips false: the job in its hours as "work" without the trip's own line (jobtrips.js: may they go out now?).
export function describeActivity(state, s, h = hourOfDay(state), opts = {}) {
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
  const a = jobActivity(state, base, s, job, h, opts);
  if (t && t.why && !a.why.includes(t.why)) a.why = a.why ? `${a.why} ${t.why}.` : t.why;
  return a;
}

// The job itself at this hour, and whether it can be done here.
function jobActivity(state, base, s, job, h, opts = {}) {
  const weak = workFactor(s) < MIN_WORK;
  const name = ROLES[job] ? ROLES[job].name : job;
  if (weak && ["wood", "forage", "hunt", "fish", "water"].includes(job)) return act("stalled", `${name}: too weak to work`, "Ill, hurt or in very low spirits: the day's work is skipped until they are better.", job);
  if (TRIP_JOBS[job]) return tripJobActivity(state, base, s, job, h, opts);
  return fixedJobActivity(state, base, s, job, h);
}
// The outdoor jobs (jobtrips.js): can it be done here, on hold while the base is attacked, out on a trip (where and
// how far along, or bringing the load home), between trips, or done for the day.
function tripJobActivity(state, base, s, job, h, opts) {
  const why = tripWhy(state, base, job);
  if (why) return why;
  if (underAttack(state, base)) return { ...act("off", "On hold: base under siege", `${base.name} is on alert or under attack: nobody goes out to work until it is over (those out come home).`, job, "⛔"), hold: "siege" };
  const nowH = h === hourOfDay(state);
  if (opts.trips !== false && nowH) {
    const st = tripState(state, s, state.hour);
    if (st) return act("work", st.text, st.phase === "back" ? "The load goes into the store when they are home." : tripTip(state, base, s, job), job);
  }
  if (!inTripHours(job, h)) return offActivity(job);
  if (opts.trips === false || !nowH) return act("work", TRIP_JOBS[job].ing, "", job);
  if (s.tripNext && s.tripNext.day === Math.floor(state.hour / 24) && s.tripNext.t > state.hour) return act("work", job === "water" ? "Pouring the water into the barrels" : `${TRIP_JOBS[job].ing}: back at the base for a bit`, `Out again at ${hhmm(s.tripNext.t)}.`, job);
  const tg = tripTarget(state, base, job);
  return act("work", tg ? `Setting out for ${tileLabel(state, tg.tile)}` : TRIP_JOBS[job].ing, "", job);
}
const hhmm = (t) => `${String(Math.floor(t) % 24).padStart(2, "0")}:${String(Math.floor((t % 1) * 60)).padStart(2, "0")}`;
function tripTip(state, base, s, job) {
  if (job === "wood") { const c = chopCrew([s], (base.armory || []).filter(isChopTool))[0]; return c.tool ? `With ${c.tool.name.toLowerCase()}.` : "No axe, machete or sledgehammer: gathering deadfall by hand is much slower. Put a cutting tool in the armory."; }
  if (job === "hunt") return "Out at dawn and dusk, when game moves.";
  return "";
}
// The job cannot be done here: the stalled line.
function tripWhy(state, base, job) {
  switch (job) {
    case "wood": { const why = woodWorkWhy(state, base); return why ? act("stalled", `Can't cut wood: ${why}`, `Nothing worth cutting around ${base.name}: ${why}. Send a team to cut wood on a forest tile, or trade for firewood.`, job) : null; }
    case "forage": { const why = forageWorkWhy(state, base); return why ? act("stalled", `Can't forage: ${why}`, `Nothing worth gathering around ${base.name}: ${why}.`, job) : null; }
    case "hunt": { const why = huntWorkWhy(state, base); return why ? act("stalled", `Can't hunt: ${why}`, `The Hunt job needs game on the base's hunting grounds (the tiles next to it; with a Hunting cabin the land within 2 tiles): ${why}.`, job) : null; }
    case "fish": { const why = fishWorkWhy(state, base); return why ? act("stalled", `Can't fish: ${why}`, `The Fish job needs a river or lake tile in the base's own land and a rod, net or spear: ${why}.`, job) : null; }
    case "scavenge": return scavLeft(base) <= SCAV_FLOOR + 0.02 ? act("stalled", "Scavenger – area picked clean", "The ruins around the base are picked over: send a team on a trip instead.", job) : null;
    case "water": { const why = fetchWaterWhy(state, base); return why ? act("stalled", `Can't fetch water: ${why}`, `Fetch water needs a river or lake tile in the base's own land, and room in the un-purified barrels: ${why}.`, job) : null; }
    default: return null;
  }
}
function offActivity(job) {
  switch (job) {
    case "wood": return act("off", "Done chopping for the day", `Woodcutters are out ${hours("wood")}: back at it in the morning. Each load of firewood goes into the store when they bring it home.`, job);
    case "forage": return act("off", "Done foraging for the day", `Out ${hours("forage")}: out again in the morning.`, job);
    case "hunt": return act("off", "Hunter – out again at dusk", `Hunters go out at dawn and dusk (${hours("hunt")}); the catch comes in when they bring it home.`, job);
    case "fish": return act("off", "Fisher – out again at dusk", `Fishers are out at dawn and dusk (${hours("fish")}); the catch comes in when they bring it home.`, job);
    case "scavenge": return act("off", "Done scavenging for the day", `Out ${hours("scavenge")}.`, job);
    case "water": return act("off", "Done fetching water for the day", `Water carriers go out ${hours("water")}.`, job);
    default: return act("off", "Off", "", job);
  }
}
function fixedJobActivity(state, base, s, job, h) {
  switch (job) {
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
      if (!base.construction.length) return act("stalled", "Builder – nothing to build", "The construction queue is empty: queue a building (Construction tab) or give them another job.", job);
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
    const stalled = ps.filter((x) => x.act.kind === "stalled");
    if (stalled.length && stalled.length === ps.length) row.why = stalled[0].act.why || stalled[0].act.text;
    else if (TRIP_JOBS[job] && ps.some((x) => x.act.hold)) { row.why = "On hold: the base is under attack (nobody goes out to work until it is over)."; row.hold = "siege"; }
    if (TRIP_JOBS[job]) row.out = ps.filter((x) => x.s.trip && x.s.trip.leave <= state.hour && state.hour < x.s.trip.home).length; // out on trips now (jobtrips.js)
    Object.assign(row, jobProgress(state, base, job, list, h));
    rows.push(row);
  }
  return rows;
}

// Share of a day's work hours already past at hour h (weights by hour).
const dayShare = (weight, h) => { let done = 0, all = 0; for (let x = 0; x < 24; x++) { const w = weight(x); all += w; if (x < h) done += w; } return all > 0 ? done / all : 0; };
const inWin = (job) => (x) => (tripWindow(job, x) ? 1 : 0);
const awakeHour = (x) => (x >= AWAKE[0] && x < AWAKE[1] ? 1 : 0);
const able = (list) => list.filter((s) => !s.inBed && workFactor(s) >= MIN_WORK && !healthRest(s));

// { progress?, goal? } for one job: what the day's work is heading for.
function jobProgress(state, base, job, list, h) {
  const out = {};
  // The outdoor jobs (jobtrips.js): what their trips have brought home today, against the day's expected haul.
  const inSoFar = (unit, f = (x) => x) => { const T = base.tripTally && base.tripTally.day === Math.floor((state.hour - 1) / 24) ? base.tripTally[job] : null; return T ? f(T) : 0; };
  const daily = (frac, expect, unit, note = "") => {
    const got = inSoFar(unit, (T) => (unit === "wood" ? T.wood : unit === RAW ? T.water : unit === "finds" ? T.finds : (T.rations ?? T.food)) || 0);
    const tg = tripTarget(state, base, job);
    const where = tg ? ` · ${tileLabel(state, tg.tile)}, ${tg.d ? `${tg.d} tile${tg.d === 1 ? "" : "s"} out` : "by the walls"}` : "";
    return { frac: expect > 0.05 ? Math.min(1, got / expect) : frac, text: `${got > 0.05 ? `${amountText(unit, got)} in today` : "nothing in yet today"}${expect > 0.05 ? ` · ≈ ${amountText(unit, expect)} expected` : ""}${where}${note}` };
  };
  if (job === "wood" && !woodWorkWhy(state, base)) {
    const tile = woodTripTile(state, base);
    const crew = chopCrew(able(list), (base.armory || []).filter(isChopTool));
    const expect = tile ? crew.reduce((a, c, k) => a + WOOD.rate * tile.v * tile.f * seasonWood(state) * c.mult * Math.min(1, workFactor(c.s)) * woodCrowd(k) * WOOD.base.hours, 0) : 0;
    out.progress = daily(dayShare(woodTime, h), expect, "wood", ` · ${crew.filter((c) => c.tool).length} of ${crew.length} with a cutting tool`);
    const w = woodNeed(state, base);
    const kg = (v) => n0(v * SUPPLIES.wood.weight);
    if (w.need > 0) out.goal = { frac: Math.min(1, w.have / w.need), text: `Winter store: ${n0(w.have)} of ${n0(w.need)} firewood (${kg(w.have)} of ${kg(w.need)} kg)${w.short ? (expect > 0 ? ` · ~${Math.ceil((w.need - w.have) / expect)} more days at this pace` : "") : " · enough for the cold ahead"}` };
  } else if (job === "forage" && !forageWorkWhy(state, base)) {
    out.progress = daily(dayShare(inWin("forage"), h), able(list).reduce((a, s) => a + baseForageDay(state, base, s), 0), "food");
  } else if (job === "hunt" && !huntWorkWhy(state, base)) {
    out.progress = daily(dayShare(inWin("hunt"), h), baseHuntDay(state, base) * able(list).length, "food", " (an average hunter's catch)");
  } else if (job === "fish" && !fishWorkWhy(state, base)) {
    out.progress = daily(dayShare(inWin("fish"), h), baseFishDay(state, base) * able(list).length, "food");
  } else if (job === "water" && !fetchWaterWhy(state, base)) {
    out.progress = daily(dayShare(inWin("water"), h), fetchWaterDay(state, base) * able(list).length, RAW, " · un-purified (boil or filter it)");
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
      out.progress = { frac: j.progress / Math.max(1, j.hours), text: `${BUILDINGS[j.type] ? BUILDINGS[j.type].name : j.type}: ${n0(j.progress)} of ${n0(j.hours)} work-hours${rate > 0 ? ` · ~${Math.ceil(left / rate)} h left` : ""}${base.construction.length > 1 ? ` · ${base.construction.length - 1} more queued` : ""}` };
    } else if (rep) {
      const fx = fixtures(base).find((f) => String(f.id) === String(rep.fx));
      out.progress = { frac: rep.done / Math.max(1, rep.hours), text: `Repairing the ${fx ? fixtureName(fx).toLowerCase() : "building"}: ${n0(rep.done)} of ${rep.hours} work-hours` };
    }
  } else if (job === "craft") {
    const j = craftQueue(base).find((x) => !craftJobStatus(state, base, x));
    if (j && CRAFTS[j.recipe]) {
      const rate = craftRate(state, base, j.recipe);
      out.progress = { frac: j.progress / Math.max(0.1, j.hours), text: `${craftName(j.recipe)}: ${pct(j.progress / Math.max(0.1, j.hours))}${rate > 0 ? ` · ~${Math.ceil(Math.max(0, j.hours - j.progress) / rate)} h left` : ""}${craftQueue(base).length > 1 ? ` · ${craftQueue(base).length - 1} more queued` : ""}` };
    }
  } else if (job === "operate") {
    const sts = stations(base).map((st) => ({ st, status: stationStatus(state, base, st) })).filter((x) => x.status.op && list.includes(x.status.op));
    const running = sts.filter((x) => x.status.running && x.status.recipe !== "power");
    const sum = {};
    for (const x of running) for (const [k, v] of Object.entries(x.status.out || {})) sum[k] = (sum[k] || 0) + v;
    if (sts.length) out.progress = { frac: dayShare(awakeHour, h), text: running.length ? `≈ ${outText(sum)} at midnight (${running.length} of ${sts.length} station${sts.length === 1 ? "" : "s"} running)` : "no station running today" };
  } else if (job === "scavenge" && scavLeft(base) > SCAV_FLOOR + 0.02) {
    const exp = Object.values(scavengeOutput(state, base)).reduce((a, v) => a + v, 0);
    const finds = inSoFar("finds", (T) => T.finds || 0);
    out.progress = { frac: dayShare(inWin("scavenge"), h), text: `${finds ? `${finds} find${finds === 1 ? "" : "s"} today · ` : ""}≈ ${r1(exp)} supplies a day on average (most days nothing) · area ${Math.round(scavLeft(base) * 100)}% left` };
  }
  return out;
}

