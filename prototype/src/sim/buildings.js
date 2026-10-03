// Buildings, workshop stations and the construction queue for every base (hub and outposts).
import { log, atBase, skill, newId } from "./world.js";

export const RECIPES = {
  ammo:  { name: "Ammo",  in: { scrap: 3 },          out: { ammo: 8 },  skill: "mechanics", desc: "3 scrap → 8 ammo per day (+4% per Mechanics point)" },
  meds:  { name: "Meds",  in: { scrap: 2, food: 1 }, out: { meds: 1 },  skill: "medicine",  desc: "2 scrap + 1 food → 1 meds per day (+1 with Medicine 8+, +1 with a Clinic or better here)" },
  parts: { name: "Parts", in: { scrap: 6 },          out: { parts: 1 }, skill: "mechanics", minSkill: 4, desc: "6 scrap → 1 part per day (Mechanics 4+, otherwise half the time it fails)" },
};

export const BUILDINGS = {
  farm_plot:    { name: "Farm plot",      cost: { scrap: 8 },             hours: 12, max: 8, desc: "Room for 2 farmers at full output. Extra farmers work at 30%." },
  ammo_bench:   { name: "Ammo bench",     cost: { scrap: 15, parts: 1 },  hours: 24, max: 3, station: "ammo", desc: "Workshop station. One operator turns scrap into ammo." },
  med_station:  { name: "Med station",    cost: { scrap: 12, meds: 1 },   hours: 24, max: 2, station: "meds", desc: "Workshop station. One operator makes basic meds." },
  machine_shop: { name: "Machine shop",   cost: { scrap: 25, parts: 3 },  hours: 48, max: 2, station: "parts", req: { mechanics: 4 }, desc: "Workshop station. One operator machines spare parts. Needs a Mechanics 4+ survivor here to build." },
  bunkhouse:    { name: "Bunkhouse",      cost: { scrap: 20 },            hours: 30, max: 6, desc: "+6 beds. Overcrowding lowers mood every day." },
  walls:        { name: "Walls",          cost: { scrap: 25 },            hours: 36, max: 3, desc: "+3 wall strength (each point adds 2 defense)." },
  watchtower:   { name: "Watchtower",     cost: { scrap: 15 },            hours: 18, max: 1, desc: "+2 tiles of live vision around this base. Lookouts warn of raids sooner." },
  radio:        { name: "Radio station",  cost: { scrap: 30, parts: 6 },  hours: 48, max: 1, req: { mechanics: 4 }, desc: "Live intel from teams in range, instant calls for help, radio diplomacy. Needs a Mechanics 4+ survivor here to build." },
  garage:       { name: "Garage",         cost: { scrap: 20, parts: 2 },  hours: 30, max: 1, desc: "Vehicle repairs restore 25 condition per part (12 without). No mechanic needed." },
  storehouse:   { name: "Storehouse",     cost: { scrap: 18 },            hours: 24, max: 1, desc: "Locked storage: raiders steal half as much from this base." },
  // Hospital tiers (family "hospital"): each one upgrades the one below and replaces it when finished.
  // med: beds = patients that get the bonus, heal = extra health per day in a bed, eff = meds multiplier,
  // treat = health per manual treatment before Medicine, staff = Medic-role people needed to run it,
  // guards = beds stop wounds getting infected, cures = cleans infected wounds reliably,
  // severe = healing speed for wounds below 30 health in a bed (0.4 without a bed), surgery = operates on
  // severe wounds (full speed plus a bigger heal per treatment), craft = extra meds per day from each med station. See medical.js.
  infirmary:    { name: "Makeshift infirmary", family: "hospital", tier: 1, cost: { scrap: 15, meds: 2 }, hours: 20, max: 1,
                  med: { beds: 2, heal: 6, eff: 1.25, treat: 14, staff: 1, guards: false, cures: false, severe: 0.6, surgery: false, craft: 0 },
                  desc: "Cots behind a curtain. 2 beds: +6 health/day for patients, meds 25% more effective, severe wounds (below 30) heal at 60% instead of 40%. Needs 1 survivor on the Medic role." },
  field_hosp:   { name: "Field hospital",      family: "hospital", tier: 2, upgrades: "infirmary", cost: { scrap: 30, parts: 2, meds: 4 }, hours: 36, max: 1,
                  med: { beds: 4, heal: 10, eff: 1.5, treat: 16, staff: 1, guards: true, cures: false, severe: 0.8, surgery: false, craft: 0 },
                  desc: "Army tents, clean water, real dressings. 4 beds: +10 health/day, meds 50% more effective, wounds in bed do not get infected, severe wounds heal at 80%. Upgrades the infirmary. Needs 1 Medic." },
  clinic:       { name: "Clinic",              family: "hospital", tier: 3, upgrades: "field_hosp", cost: { scrap: 45, parts: 4, meds: 8 }, hours: 60, max: 1, req: { medicine: 6 },
                  med: { beds: 6, heal: 16, eff: 1.8, treat: 18, staff: 2, guards: true, cures: true, severe: 1, surgery: true, craft: 1 },
                  desc: "A proper treatment room with sterilised tools. 6 beds: +16 health/day, meds 80% more effective, cleans infected wounds, surgery for severe wounds (full speed, bigger treatments), med stations make +1 meds a day. Upgrades the field hospital. Needs 2 Medics and a Medicine 6+ survivor here to build." },
  hospital:     { name: "Trauma hospital",     family: "hospital", tier: 4, upgrades: "clinic", cost: { scrap: 70, parts: 8, meds: 12 }, hours: 96, max: 1, req: { medicine: 10, mechanics: 4 },
                  med: { beds: 10, heal: 24, eff: 2.2, treat: 22, staff: 3, guards: true, cures: true, severe: 1.2, surgery: true, craft: 1 },
                  desc: "Operating theatre on generator power. 10 beds: +24 health/day, meds 120% more effective, cleans infected wounds, full surgery (severe wounds heal 20% faster), med stations make +1 meds a day. Upgrades the clinic. Needs 3 Medics, and Medicine 10+ and Mechanics 4+ survivors here to build." },
};

export const count = (base, type) => base.buildings.filter((b) => b.type === type).length;
export const baseWalls = (base) => (base.type === "hub" ? 3 : 1) + count(base, "walls") * 3;
export const baseBeds = (base) => (base.type === "hub" ? 4 : 2) + count(base, "bunkhouse") * 6;
export const farmSlots = (base) => count(base, "farm_plot") * 2;
export const stations = (base) => base.buildings.filter((b) => BUILDINGS[b.type].station);

export function addBuilding(base, type) {
  const b = { id: newId(), type };
  // An upgrade (hospital tiers) replaces the lower tier of the same family.
  const fam = BUILDINGS[type].family;
  if (fam) base.buildings = base.buildings.filter((x) => BUILDINGS[x.type].family !== fam);
  base.buildings.push(b);
  if (type === "radio") base.radio = true;
  if (type === "watchtower") base.watchtower = true;
  return b;
}

export function stationOperator(state, base, st) {
  // Patients in a hospital bed (s.inBed, set hourly by medical.js) do not work.
  return atBase(state, base.id).find((s) => s.role === "operate" && s.station === st.id && !s.inBed) || null;
}

// Operators without a valid station are moved to the first free one.
export function assignStations(state, base) {
  const list = stations(base);
  const people = atBase(state, base.id).filter((s) => s.role === "operate");
  const taken = new Set();
  for (const s of people) {
    if (s.station && list.some((st) => st.id === s.station) && !taken.has(s.station)) taken.add(s.station);
    else s.station = null;
  }
  for (const s of people) {
    if (s.station) continue;
    const free = list.find((st) => !taken.has(st.id));
    if (free) {
      s.station = free.id;
      taken.add(free.id);
    }
  }
}

// Extra meds per day from a med station thanks to the base's hospital (Clinic or better).
const hospitalCraft = (base) => Math.max(0, ...(base ? base.buildings : []).map((b) => (BUILDINGS[b.type].med && BUILDINGS[b.type].med.craft) || 0));

export function recipeOutput(s, recipe, base = null) {
  const r = RECIPES[recipe];
  const out = {};
  for (const [k, v] of Object.entries(r.out)) {
    let q = v;
    if (recipe === "ammo") q = Math.round(v * (1 + skill(s, "mechanics") * 0.04));
    if (recipe === "meds" && skill(s, "medicine") >= 8) q += 1;
    if (recipe === "meds") q += hospitalCraft(base);
    out[k] = q;
  }
  return out;
}

export function stationStatus(state, base, st) {
  const recipe = BUILDINGS[st.type].station;
  const r = RECIPES[recipe];
  const op = stationOperator(state, base, st);
  if (!op) {
    const sick = atBase(state, base.id).some((s) => s.role === "operate" && s.station === st.id && s.inBed);
    return { op: null, running: false, reason: sick ? "Operator in a hospital bed" : "No operator", recipe, out: {} };
  }
  const missing = Object.entries(r.in).filter(([k, v]) => (base.stock[k] || 0) < v).map(([k]) => k);
  const out = recipeOutput(op, recipe, base);
  if (missing.length) return { op, running: false, reason: `Waiting for ${missing.join(", ")}`, recipe, out };
  return { op, running: true, reason: "Running", recipe, out };
}

export function runStations(state, base) {
  assignStations(state, base);
  for (const st of stations(base)) {
    const status = stationStatus(state, base, st);
    if (!status.running) continue;
    const r = RECIPES[status.recipe];
    for (const [k, v] of Object.entries(r.in)) base.stock[k] -= v;
    if (r.minSkill && skill(status.op, r.skill) < r.minSkill && state.rng.chance(0.5)) continue;
    for (const [k, v] of Object.entries(status.out)) base.stock[k] = (base.stock[k] || 0) + v;
  }
}

export function canBuild(state, base, type) {
  const def = BUILDINGS[type];
  const queued = base.construction.filter((c) => c.type === type).length;
  if (count(base, type) + queued >= def.max) return { ok: false, reason: `Limit reached (${def.max})` };
  if (def.family) {
    // Tiered buildings: one step at a time, and only one upgrade in the queue.
    const have = Math.max(0, ...base.buildings.map((x) => (BUILDINGS[x.type].family === def.family ? BUILDINGS[x.type].tier : 0)));
    if (base.construction.some((c) => BUILDINGS[c.type].family === def.family)) return { ok: false, reason: "An upgrade is already queued" };
    if (have >= def.tier) return { ok: false, reason: "Already built (or a better tier)" };
    if (def.upgrades && !count(base, def.upgrades)) return { ok: false, reason: `Upgrade a ${BUILDINGS[def.upgrades].name.toLowerCase()} first` };
  }
  for (const [k, v] of Object.entries(def.cost)) if ((base.stock[k] || 0) < v) return { ok: false, reason: `Needs ${v} ${k}` };
  if (def.req) {
    for (const [sk, lvl] of Object.entries(def.req)) {
      if (!atBase(state, base.id).some((s) => skill(s, sk) >= lvl)) return { ok: false, reason: `Needs a ${sk} ${lvl}+ survivor here` };
    }
  }
  return { ok: true };
}

export function queueBuild(state, base, type) {
  const chk = canBuild(state, base, type);
  if (!chk.ok) return chk.reason;
  for (const [k, v] of Object.entries(BUILDINGS[type].cost)) base.stock[k] -= v;
  base.construction.push({ id: newId(), type, progress: 0, hours: BUILDINGS[type].hours });
  return `${BUILDINGS[type].name} queued at ${base.name}.`;
}

export function cancelBuild(state, base, id) {
  const job = base.construction.find((c) => c.id === id);
  if (!job) return;
  for (const [k, v] of Object.entries(BUILDINGS[job.type].cost)) base.stock[k] = (base.stock[k] || 0) + Math.floor(v / 2);
  base.construction.splice(base.construction.indexOf(job), 1);
}

export function buildRate(state, base) {
  return atBase(state, base.id).filter((s) => s.role === "build" && !s.inBed).reduce((a, s) => a + 1 + skill(s, "mechanics") * 0.03, 0);
}

// Builders work on the first job in the queue, hour by hour.
export function constructionHour(state) {
  for (const base of state.bases) {
    const job = base.construction[0];
    if (!job) continue;
    job.progress += buildRate(state, base);
    if (job.progress >= job.hours) {
      base.construction.shift();
      addBuilding(base, job.type);
      log(state, `${BUILDINGS[job.type].name} finished at ${base.name}.`, "good");
    }
  }
}

export function buildingSummary(state, base) {
  const people = atBase(state, base.id).length;
  return [
    ["Defense from walls", `+${baseWalls(base) * 2}`],
    ["Beds", `${baseBeds(base)} for ${people} people${people > baseBeds(base) ? " (overcrowded)" : ""}`],
    ["Farm slots", `${farmSlots(base)}`],
    ["Workshop stations", `${stations(base).length}`],
    ["Vision", `${(base.type === "hub" ? 3 : 2) + (base.watchtower ? 2 : 0)} tiles`],
    ["Radio", base.radio ? "Yes" : "No"],
    ["Vehicle repairs", count(base, "garage") ? "Garage (+25 per part)" : "Field repair (+12 per part, Mechanics 4+)"],
    ["Raid losses", count(base, "storehouse") ? "Halved by storehouse" : "Normal"],
    ["Medical", (() => {
      const h = base.buildings.find((x) => BUILDINGS[x.type].family === "hospital");
      if (!h) return "No hospital (severe wounds heal slowly)";
      const d = BUILDINGS[h.type];
      return `Tier ${d.tier} ${d.name}: ${d.med.beds} beds, needs ${d.med.staff} medic${d.med.staff === 1 ? "" : "s"}${d.med.surgery ? ", surgery" : ""}`;
    })()],
  ];
}
