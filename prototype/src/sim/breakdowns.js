// Things break (suggestions-2 #20, hub tasks): buildings and equipment at your bases wear out and break, and a
// broken one stops (or weakens) until a named survivor repairs it. Fixtures: the hub's own well pump, wells, the
// generator, the still, the machine shop, the ammo bench, the med station, the preserving kitchen, the radio
// station, walls and the reinforced gate (damaged by attacks), and the storehouse roof (storms). Parked vehicles
// lose condition on frost days (repaired as before, from the Vehicles tab or the Repairs list).
//
// Wear (0–100) builds up every day: use (a station that ran, a well that pumped) × age (+1/240 a day since it was
// built) + weather (frost for pumps, storms for pumps, masts and roofs) + attacks (a horde or a raid on the walls),
// × the operator's Mechanics (−2.5% a point, from ×1.15, at least ×0.65), × a Grease Monkey (×0.8) or Handy (×0.85)
// survivor living there, × 1.6 while jury-rigged. Builders with no construction job do upkeep: 1.5 wear off the most
// worn fixture per builder a day. A fixture breaks at 100, and from 60 up with a daily chance ((wear − 60) / 40)² × 30%.
//
// A broken fixture: a station does nothing, a well gives no water (the hub's pump: 6 less a day), the radio station
// is off the air, walls lose their +3 wall strength, the gate its horde bonus, the storehouse its room. It shows in
// the alerts and the base's Repairs tab, with a card offering:
//   Repair properly  the best free mechanic (Mechanics at least the job's minimum) for the job's hours (× 1.2 − 3% a
//                    Mechanics point, at least 40%, faster with Handy / Master Builder), and its scrap and parts;
//                    wear back to 8.
//   Jury-rig         a third of the hours (at least 1), cheap, any skill (at least the rig minimum); wear left at 65 and
//                    it wears 60% faster until it is repaired properly.
//   Leave it         stays broken, on the Repairs list.
// The repairer works the job between 08:00 and 20:00 while at the base and well enough (work factor 0.35+), keeping
// their role. The autopilot, and a steward with Building on, start the repairs themselves (repair if they can pay,
// else jury-rig) and replace a repairer who left. The old storm "broken well pump" hub event is this system now.
// Rolls use hash01 (skills.js), never the world's random numbers.
import { BUILDINGS } from "./buildings.js";
import { log, addCard, day, hourOfDay, atBase, survivorById, skill } from "./world.js";
import { hash01, gainXp, buildMult, hasPerk, USE } from "./skills.js";
import { workFactor } from "./health.js";
import { stationStatus } from "./buildings.js";
import { weatherOnDay } from "./weather.js";
import { stewardOn } from "./steward.js";
import { vehiclesAtBase } from "./vehicles.js";

export const WELL_WATER = 6; // the hub pump's share (hubevents.js WELL_DOWN.water)
export const SCRAP_PER_PART = 4; // a repair short of scrap can use a part instead of this much
// use: wear a day of use; age: a day standing; frost / storm / rain: extra on such a day; attack: wear per attack.
// repair / rig: { hours, cost, min (Mechanics) }; what: what breaking does.
export const FIXTURES = {
  pump:        { name: "Well pump", use: 0.9, frost: 2.5, storm: 4, repair: { hours: 6, cost: { scrap: 3, parts: 1 }, min: 1 }, rig: { hours: 2, cost: { scrap: 1 }, min: 0 }, what: `the hub's well gives ${WELL_WATER} less water a day` },
  well:        { use: 0.9, frost: 2.5, storm: 4, repair: { hours: 6, cost: { scrap: 3, parts: 1 }, min: 1 }, rig: { hours: 2, cost: { scrap: 1 }, min: 0 }, what: "no water from this well" },
  generator:   { use: 1.6, idle: 0.15, repair: { hours: 10, cost: { scrap: 4, parts: 2 }, min: 3 }, rig: { hours: 3, cost: { scrap: 2 }, min: 1 }, what: "no power from it" },
  still:       { use: 1.2, idle: 0.1, repair: { hours: 6, cost: { scrap: 3, parts: 1 }, min: 2 }, rig: { hours: 2, cost: { scrap: 2 }, min: 0 }, what: "no fuel from it" },
  machine_shop:{ use: 1.2, idle: 0.1, repair: { hours: 8, cost: { scrap: 3, parts: 1 }, min: 3 }, rig: { hours: 3, cost: { scrap: 2 }, min: 1 }, what: "no parts from it" },
  ammo_bench:  { use: 0.8, idle: 0.05, repair: { hours: 4, cost: { scrap: 2 }, min: 1 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no ammo from it" },
  med_station: { use: 0.6, idle: 0.05, repair: { hours: 4, cost: { scrap: 2 }, min: 0 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no meds from it" },
  kitchen:     { use: 0.8, idle: 0.05, repair: { hours: 4, cost: { scrap: 2 }, min: 0 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no preserving" },
  radio:       { use: 0.7, storm: 6, repair: { hours: 10, cost: { scrap: 4, parts: 2 }, min: 4 }, rig: { hours: 3, cost: { scrap: 2 }, min: 2 }, what: "the radio station is off the air" },
  walls:       { age: 0.05, attack: 18, repair: { hours: 12, cost: { scrap: 10 }, min: 0 }, rig: { hours: 4, cost: { scrap: 4 }, min: 0 }, what: "−3 wall strength" },
  gate:        { age: 0.05, attack: 22, repair: { hours: 8, cost: { scrap: 6, parts: 1 }, min: 1 }, rig: { hours: 3, cost: { scrap: 3 }, min: 0 }, what: "the gate no longer holds hordes back" },
  storehouse:  { age: 0.1, storm: 8, rain: 1, repair: { hours: 6, cost: { scrap: 4 }, min: 0 }, rig: { hours: 2, cost: { scrap: 2 }, min: 0 }, what: "a leaking roof: no food room and no protection from raiders" },
};
export const WEAR = { ageDays: 240, breakAt: 100, riskFrom: 60, riskMax: 0.3, rigWear: 65, repairWear: 8, rigMult: 1.6, upkeep: 1.5, greaseMonkey: 0.8, handy: 0.85, workFrom: 8, workTo: 20, vehicleFrost: 1, vehicleBlizzard: 2 };

// ---------- fixtures at a base ----------
// The hub's pump is a fixture of its own (base.pump); everything else is a building with an entry in FIXTURES.
export function fixtures(base) {
  const out = base.buildings.filter((b) => FIXTURES[b.type]);
  if (base.type === "hub") {
    if (!base.pump) base.pump = { id: "pump", type: "pump", wear: 0, built: 1 };
    out.unshift(base.pump);
  }
  return out;
}
// A key for the dice that does not depend on object ids (they differ between two worlds made in one process).
const fxKey = (base, fx) => `${base.tile}:${fx.type}:${base.buildings.indexOf(fx)}`;
export const fixtureName = (fx) => (fx.type === "pump" ? "Well pump" : (BUILDINGS[fx.type] && BUILDINGS[fx.type].name) || fx.type);
export const fixtureById = (base, id) => fixtures(base).find((f) => String(f.id) === String(id)) || null;
export const isBroken = (fx) => !!(fx && fx.broken);
export const brokenAt = (base) => fixtures(base).filter(isBroken);
const jobs = (base) => base.repairs || (base.repairs = []);
export const jobFor = (base, fx) => jobs(base).find((j) => String(j.fx) === String(fx.id)) || null;

// ---------- breaking and fixing ----------
export function breakFixture(state, base, fx, cause = "worn out", { card = true } = {}) {
  if (!fx || fx.broken) return false;
  fx.broken = { day: day(state), cause };
  fx.wear = Math.max(fx.wear || 0, WEAR.breakAt);
  applyEffect(state, base, fx);
  const def = FIXTURES[fx.type];
  log(state, `⚠ The ${fixtureName(fx).toLowerCase()} at ${base.name} broke (${cause}): ${def.what} until it is repaired.`, "danger");
  state.stats.breakdowns = (state.stats.breakdowns || 0) + 1;
  if (autoHands(state, base)) autoRepair(state, base, fx);
  else if (card) addCard(state, breakCard(state, base, fx));
  return true;
}
// What a broken fixture does to the base (a station, a well, walls and the storehouse are left out by buildings.js
// count / stationOperator; the pump and the radio need a flag).
function applyEffect(state, base, fx) {
  if (fx.type === "pump") base.wellDown = { until: 1e9, water: WELL_WATER, broken: true };
  if (fx.type === "radio") base.radio = false;
}
function fixed(state, base, fx, method) {
  fx.broken = null;
  fx.wear = method === "rig" ? WEAR.rigWear : WEAR.repairWear;
  fx.rigged = method === "rig";
  if (fx.type === "pump") delete base.wellDown;
  if (fx.type === "radio") base.radio = true;
}

// What a repair takes: { ok, why, who, hours, cost, method }.
export function repairPlan(state, base, fx, method = "repair", whoId = null) {
  const def = FIXTURES[fx.type];
  const r = def[method];
  const busy = new Set(jobs(base).filter((j) => String(j.fx) !== String(fx.id)).map((j) => j.who));
  const able = atBase(state, base.id).filter((s) => !s.inBed && workFactor(s) >= 0.35 && !busy.has(s.id) && skill(s, "mechanics") >= r.min)
    .sort((a, b) => skill(b, "mechanics") - skill(a, "mechanics") || (a.role === "build") - (b.role === "build") || a.id - b.id);
  const who = whoId != null ? able.find((s) => s.id === whoId) || null : able[0] || null;
  const mech = who ? skill(who, "mechanics") : 0;
  const hours = Math.max(1, Math.ceil(r.hours * Math.max(0.4, 1.2 - 0.03 * mech) / (who ? buildMult(who) : 1)));
  // Scrap that is short can be made up with parts (1 part for SCRAP_PER_PART scrap).
  const cost = { ...r.cost };
  const lack = Math.max(0, (cost.scrap || 0) - Math.floor(base.stock.scrap || 0));
  if (lack > 0) { cost.scrap -= lack; cost.parts = (cost.parts || 0) + Math.ceil(lack / SCRAP_PER_PART); if (!cost.scrap) delete cost.scrap; }
  const short = Object.entries(cost).filter(([k, v]) => (base.stock[k] || 0) < v);
  const why = !fx.broken ? "Not broken." : jobFor(base, fx) ? "Already being worked on." : !who ? (r.min ? `Needs a free survivor with Mechanics ${r.min}+ here.` : "Nobody here is free and well enough.") :
    short.length ? `Needs ${costText(r.cost)} (short scrap can be made up with parts, 1 for ${SCRAP_PER_PART}).` : "";
  return { ok: !why, why, who, hours, cost, method, min: r.min };
}
export const costText = (cost) => Object.entries(cost).map(([k, v]) => `${v} ${k === "parts" && v === 1 ? "part" : k}`).join(", ");

export function startRepair(state, base, fx, method = "repair", whoId = null) {
  const plan = repairPlan(state, base, fx, method, whoId);
  if (!plan.ok) return plan.why;
  for (const [k, v] of Object.entries(plan.cost)) base.stock[k] -= v;
  jobs(base).push({ id: `${fx.id}`, fx: fx.id, method, who: plan.who.id, hours: plan.hours, done: 0, paid: { ...plan.cost }, started: state.hour });
  return `${plan.who.name.split(" ")[0]} starts ${method === "rig" ? "jury-rigging" : "repairing"} the ${fixtureName(fx).toLowerCase()} at ${base.name} (${plan.hours} work-hours, ${costText(plan.cost)}).`;
}
export function cancelRepair(state, base, fxId) {
  const list = jobs(base);
  const i = list.findIndex((j) => String(j.fx) === String(fxId));
  if (i < 0) return "No such job.";
  const [j] = list.splice(i, 1);
  for (const [k, v] of Object.entries(j.paid || {})) base.stock[k] = (base.stock[k] || 0) + v;
  return "Repair cancelled; the materials are back in stock.";
}
// Someone else takes over a job (the UI, or the autopilot when the repairer left).
export function reassignRepair(state, base, fxId, whoId) {
  const j = jobs(base).find((x) => String(x.fx) === String(fxId));
  const fx = fixtureById(base, fxId);
  if (!j || !fx) return "No such job.";
  const s = survivorById(state, whoId);
  const r = FIXTURES[fx.type][j.method];
  if (!s || !atBase(state, base.id).includes(s) || skill(s, "mechanics") < r.min) return "They cannot do it.";
  j.who = s.id;
  return `${s.name.split(" ")[0]} takes over the ${fixtureName(fx).toLowerCase()}.`;
}

// The card when something breaks (and the merged storm "well pump" hub event, hubevents.js).
export function breakCard(state, base, fx, { pumpStorm = null } = {}) {
  const def = FIXTURES[fx.type];
  const rep = repairPlan(state, base, { ...fx, broken: fx.broken || { day: day(state) } }, "repair");
  const rig = repairPlan(state, base, { ...fx, broken: fx.broken || { day: day(state) } }, "rig");
  const first = (s) => (s ? s.name.split(" ")[0] : "");
  // pumpStorm: the hub event's card: the pump is not broken yet; each choice breaks it (so every choice does something).
  const ensure = (st) => { if (!fx.broken) { fx.broken = { day: day(st), cause: pumpStorm ? "storm damage" : "worn out" }; fx.wear = Math.max(fx.wear || 0, WEAR.breakAt); applyEffect(st, base, fx); } };
  const name = fixtureName(fx).toLowerCase();
  return {
    title: pumpStorm != null ? `The well pump at ${base.name} is broken` : `The ${name} at ${base.name} broke down`,
    text: `${pumpStorm != null ? `${pumpStorm ? "The storm" : "The weather"} wrecked the pump housing on the well.` : `The ${name} at ${base.name} gave out (${fx.broken ? fx.broken.cause : "worn out"}).`} Until it is fixed: ${def.what}. It needs someone with the skill and some hours.`,
    breakdown: { baseId: base.id, fx: fx.id },
    choices: [
      {
        label: rep.who ? `Repair it: ${first(rep.who)} (Mechanics ${skill(rep.who, "mechanics")}), ${rep.hours}h, ${costText(rep.cost)}` : `Repair it (${costText(rep.cost)})`,
        hint: rep.ok ? `Fixed properly after ${rep.hours} work-hours (worked 08:00–20:00); wear back to ${WEAR.repairWear}.` : rep.why,
        disabled: () => !repairPlan(state, base, { ...fx, broken: fx.broken || { day: 0 } }, "repair").ok,
        ai: () => (rep.ok ? 8 : 0),
        resolve: (st) => { ensure(st); return startRepair(st, base, fx, "repair"); },
      },
      {
        label: rig.who ? `Jury-rig it: ${first(rig.who)}, ${rig.hours}h, ${costText(rig.cost)}` : `Jury-rig it (${costText(rig.cost)})`,
        hint: rig.ok ? `Running again after ${rig.hours} work-hours, but it wears ${Math.round((WEAR.rigMult - 1) * 100)}% faster and breaks again sooner (wear left at ${WEAR.rigWear}).` : rig.why,
        disabled: () => !repairPlan(state, base, { ...fx, broken: fx.broken || { day: 0 } }, "rig").ok,
        ai: () => (rig.ok ? (rep.ok ? 3 : 6) : 0),
        resolve: (st) => { ensure(st); return startRepair(st, base, fx, "rig"); },
      },
      {
        label: "Leave it for now",
        hint: `${def.what[0].toUpperCase()}${def.what.slice(1)} until someone fixes it (the base's Repairs tab).`,
        ai: () => 0.5,
        resolve: (st) => { ensure(st); return `The ${name} stays broken for now: it is on ${base.name}'s Repairs list.`; },
      },
    ],
  };
}

// The autopilot (all bases) and a steward with Building on fix things themselves.
export const autoHands = (state, base) => !!state.autopilot || (stewardOn(base) && base.steward.areas.building !== false);
function autoRepair(state, base, fx) {
  if (!fx.broken || jobFor(base, fx)) return "";
  const rep = repairPlan(state, base, fx, "repair");
  const msg = rep.ok ? startRepair(state, base, fx, "repair") : repairPlan(state, base, fx, "rig").ok ? startRepair(state, base, fx, "rig") : "";
  if (msg) log(state, `${state.autopilot ? "🤖" : "🧭"} ${msg}`, "info");
  return msg;
}

// ---------- hourly: repair work (parties.js movePartiesHour hook) and attack damage ----------
export function breakdownsHour(state) {
  const h = hourOfDay(state);
  for (const base of state.bases) {
    attackWear(state, base);
    const list = jobs(base);
    for (const j of [...list]) {
      const fx = fixtureById(base, j.fx);
      if (!fx || !fx.broken) { list.splice(list.indexOf(j), 1); continue; }
      const s = j.who != null ? survivorById(state, j.who) : null;
      const here = s && s.alive && s.location.kind === "base" && s.location.baseId === base.id;
      if (!here) { j.who = null; }
      if (j.who == null && autoHands(state, base)) {
        const r = FIXTURES[fx.type][j.method];
        const busy = new Set(list.map((x) => x.who));
        const pick = atBase(state, base.id).filter((o) => !o.inBed && workFactor(o) >= 0.35 && !busy.has(o.id) && skill(o, "mechanics") >= r.min).sort((a, b) => skill(b, "mechanics") - skill(a, "mechanics") || a.id - b.id)[0];
        if (pick) j.who = pick.id;
      }
      if (j.who == null || h < WEAR.workFrom || h >= WEAR.workTo) continue;
      const w = survivorById(state, j.who);
      if (!w || w.inBed || workFactor(w) < 0.35) continue;
      j.done += Math.max(0.5, workFactor(w)) * buildMult(w);
      if (j.done >= j.hours - 1e-9) {
        list.splice(list.indexOf(j), 1);
        fixed(state, base, fx, j.method);
        gainXp(state, w, "mechanics", USE.repair * (j.method === "rig" ? 1 : 2));
        log(state, `🔧 ${w.name.split(" ")[0]} ${j.method === "rig" ? "jury-rigged" : "repaired"} the ${fixtureName(fx).toLowerCase()} at ${base.name}.${j.method === "rig" ? " It will not last." : ""}`, "good");
      }
    }
    // The autopilot and stewards start the repairs nobody has started.
    if (autoHands(state, base) && h === WEAR.workFrom) for (const fx of brokenAt(base)) autoRepair(state, base, fx);
  }
}
// Horde attacks (base.hordeHits, defences.js) and raids (a siege on the base that ended) wear the walls and gate.
function attackWear(state, base) {
  const hits = base.hordeHits || 0;
  if (base.wearHits == null) base.wearHits = hits;
  let attacks = hits - base.wearHits;
  base.wearHits = hits;
  const besieged = state.parties.some((q) => q.phase === "siege" && q.target && q.target.kind === "player" && q.target.baseId === base.id);
  if (base.wasBesieged && !besieged) attacks++;
  base.wasBesieged = besieged;
  if (attacks <= 0) return;
  for (const fx of fixtures(base)) {
    const def = FIXTURES[fx.type];
    if (!def.attack || fx.broken) continue;
    const add = def.attack * attacks * (0.7 + 0.6 * hash01(state.seed, "atk", fxKey(base, fx), state.hour));
    fx.wear = Math.min(WEAR.breakAt, (fx.wear || 0) + add);
    if (fx.wear >= WEAR.breakAt) breakFixture(state, base, fx, "damaged in the attack");
  }
}

// ---------- daily wear (hubevents.js hubEventsDaily, at midnight: the day that ended) ----------
export function wearMult(state, base, fx) {
  const people = atBase(state, base.id);
  let m = 1;
  if (people.some((s) => hasPerk(s, "greasemonkey"))) m *= WEAR.greaseMonkey;
  else if (people.some((s) => hasPerk(s, "handy"))) m *= WEAR.handy;
  if (fx.rigged) m *= WEAR.rigMult;
  return m;
}
export function dailyWear(state, base, fx, wx) {
  const def = FIXTURES[fx.type];
  const age = Math.max(0, day(state) - (fx.built || day(state)));
  let use = 0;
  if (BUILDINGS[fx.type] && BUILDINGS[fx.type].station) {
    const st = stationStatus(state, base, fx);
    use = st.running ? def.use : def.idle || 0;
    if (st.running && st.op) use *= Math.max(0.65, 1.15 - 0.025 * skill(st.op, "mechanics"));
  } else use = def.use || 0;
  let w = (use + (def.age || 0)) * (1 + age / WEAR.ageDays);
  if (wx) {
    if (def.frost && wx.lo <= -3) w += def.frost;
    if (def.storm && ["storm", "blizzard"].includes(wx.key)) w += def.storm;
    if (def.rain && ["rain", "snow"].includes(wx.key)) w += def.rain;
  }
  return w * wearMult(state, base, fx);
}
export function breakdownsDaily(state) {
  const d = day(state);
  const wx = d > 1 ? weatherOnDay(state, d - 1) : null;
  for (const base of state.bases) {
    const list = fixtures(base);
    // What the holdout started with is not new: the hub's pump 30–50 wear, the rest 5–25.
    for (const fx of list) if (fx.built == null) { fx.built = d; if (d <= 2) fx.wear = (fx.type === "pump" ? 30 : 5) + 20 * hash01(state.seed, "wear0", fxKey(base, fx)); }
    for (const fx of list) {
      if (fx.broken) continue;
      fx.wear = Math.min(WEAR.breakAt, (fx.wear || 0) + dailyWear(state, base, fx, wx));
    }
    for (const fx of list) {
      if (fx.broken) continue;
      const w = fx.wear || 0;
      const p = w >= WEAR.breakAt ? 1 : w >= WEAR.riskFrom ? ((w - WEAR.riskFrom) / (WEAR.breakAt - WEAR.riskFrom)) ** 2 * WEAR.riskMax : 0;
      if (p > 0 && hash01(state.seed, "brk", fxKey(base, fx), d) < p) breakFixture(state, base, fx, w >= WEAR.breakAt ? "worn out" : "worn");
    }
    // Upkeep by builders with nothing to build.
    if (!base.construction.length) {
      let pts = atBase(state, base.id).filter((s) => s.role === "build" && !s.inBed).reduce((a, s) => a + WEAR.upkeep * workFactor(s), 0);
      for (const fx of [...list].filter((f) => !f.broken).sort((a, b) => (b.wear || 0) - (a.wear || 0))) {
        if (pts <= 0) break;
        const cut = Math.min(pts, fx.wear || 0);
        fx.wear -= cut;
        pts -= cut;
      }
    }
    // Parked vehicles in the frost.
    if (wx && wx.lo <= -3) for (const v of vehiclesAtBase(state, base.id)) v.condition = Math.max(1, v.condition - (wx.key === "blizzard" ? WEAR.vehicleBlizzard : WEAR.vehicleFrost));
  }
}

// For the UI and the alerts.
export function repairRows(state, base) {
  return fixtures(base).map((fx) => ({ fx, name: fixtureName(fx), def: FIXTURES[fx.type], job: jobFor(base, fx), wear: Math.round(fx.wear || 0) }));
}
