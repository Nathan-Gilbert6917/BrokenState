// Buildings, workshop stations and the construction queue for every base (hub and outposts).
import { log, atBase, skill, newId } from "./world.js";
import { SKILL_NAMES } from "./data.js";
import { workFactor } from "./health.js";
import { storeCapacity, storeSpaces } from "./storage.js";

export const RECIPES = {
  ammo:  { name: "Ammo",  in: { scrap: 3 },          out: { ammo: 8 },  skill: "mechanics", desc: "3 scrap → 8 ammo per day (+4% per Mechanics point)" },
  meds:  { name: "Meds",  in: { scrap: 2, food: 1 }, out: { meds: 1 },  skill: "medicine",  desc: "2 scrap + 1 food → 1 meds per day (+1 with Medicine 8+, +1 with a staffed Clinic or better here)" },
  parts: { name: "Parts", in: { scrap: 6 },          out: { parts: 1 }, skill: "mechanics", minSkill: 4, desc: "6 scrap → 1 part per day (Mechanics 4+, otherwise half the time it fails)" },
  // storage.js: jarred food barely spoils and needs no cellar room; the jars come back when it is eaten at a base.
  preserve: { name: "Preserving", in: { food: 9, water: 3, scrap: 1, jars: 4 }, out: { preserved: 8 }, skill: "farming", desc: "9 fresh food + 3 water + 1 scrap (stove fuel, lids) + 4 empty jars → 8 preserved food per day (9 with Farming 8+). Preserved food barely spoils, needs no cellar room, is lighter to carry and sells well; most jars come back when it is eaten here." },
};

export const BUILDINGS = {
  farm_plot:    { name: "Farm plot",      cost: { scrap: 8 },             hours: 12, max: 10, desc: "+2 crop plots (Farming tab). Every base starts with some plots: the hub 6, an outpost 2." },
  ammo_bench:   { name: "Ammo bench",     cost: { scrap: 15, parts: 1 },  hours: 24, max: 3, station: "ammo", desc: "Workshop station. One operator turns scrap into ammo." },
  med_station:  { name: "Med station",    cost: { scrap: 12, meds: 1 },   hours: 24, max: 2, station: "meds", desc: "Workshop station. One operator makes basic meds." },
  machine_shop: { name: "Machine shop",   cost: { scrap: 25, parts: 3 },  hours: 48, max: 2, station: "parts", req: { mechanics: 4 }, desc: "Workshop station. One operator machines spare parts. Needs a Mechanics 4+ survivor here to build." },
  bunkhouse:    { name: "Bunkhouse",      cost: { scrap: 20 },            hours: 30, max: 6, desc: "+6 beds. Overcrowding lowers mood every day." },
  walls:        { name: "Walls",          cost: { scrap: 25 },            hours: 36, max: 3, desc: "+3 wall strength (each point adds 2 defense against raids, and holds back 18 more of a horde)." },
  // Defences against hordes (defences.js): they raise the size of horde the base holds out, and show up on the
  // base's battle map when the dead break in anyway.
  barricades:   { name: "Barricades",       cost: { scrap: 8 },             hours: 10, max: 3, defence: true, desc: "Cars, timber and sandbags behind the walls: the base holds back 12% more of a horde each, and they are full cover on the battle map if the dead break in. One is wrecked in every break-in fight; a Wallbreaker smashes one each time it attacks." },
  spike_pits:   { name: "Spike pits",       cost: { scrap: 6 },             hours: 8,  max: 2, defence: true, desc: "Sharpened stakes in covered pits on the approach. One use: the next horde to attack loses 7% + 4 of the dead per pit before it reaches the walls, and the pits are on the battle map (each of the dead that steps in is hurt)." },
  trench:       { name: "Trench and stakes", cost: { scrap: 12 },           hours: 30, max: 1, defence: true, desc: "A ditch around the base: the base holds back 25% more of a horde, and on the battle map the dead that reach the trench lose the rest of their turn." },
  gate:         { name: "Reinforced gate",  cost: { scrap: 14, parts: 1 },  hours: 20, max: 1, defence: true, desc: "Steel plate and a bar on the gate: the base holds back 20% more of a horde, plus two more barricades on the battle map. Needs walls to matter; a Wallbreaker smashes it when no barricade is left." },
  floodlights:  { name: "Floodlights",      cost: { scrap: 8, parts: 2 },   hours: 12, max: 1, defence: true, desc: "Work lights on the walls. Burns 2 fuel when a horde attacks: the base holds back 10% more, and defenders aim better on the battle map (+10 at night, +4 by day). No fuel, no lights." },
  watchtower:   { name: "Watchtower",     cost: { scrap: 15 },            hours: 18, max: 1, desc: "+2 tiles of live vision around this base. Lookouts warn of raids sooner." },
  radio:        { name: "Radio station",  cost: { scrap: 30, parts: 6 },  hours: 48, max: 1, req: { mechanics: 4 }, desc: "Live intel from teams in range, instant calls for help, radio diplomacy. Needs a Mechanics 4+ survivor here to build." },
  // radio.js: an unmanned repeater (no operator) that uses 1 part every 10 days; works only when linked to a station.
  relay:        { name: "Radio relay",    cost: { scrap: 15, parts: 3 },  hours: 24, max: 1, req: { mechanics: 3 }, outpostOnly: true, desc: "Outposts only. An unmanned repeater mast: extends radio coverage 6 tiles around this outpost when a radio station or another linked relay is within range. No operator; uses 1 part every 10 days (from here, else the hub) or goes off the air. Needs a Mechanics 3+ survivor here to build." },
  garage:       { name: "Garage",         cost: { scrap: 20, parts: 2 },  hours: 30, max: 1, desc: "Vehicle repairs restore 25 condition per part (12 without). No mechanic needed." },
  storehouse:   { name: "Storehouse",     cost: { scrap: 18 },            hours: 24, max: 1, desc: "Locked dry-goods store: +150 food storage room (0.8% a day, less in the cold), and raiders steal half as much from this base." },
  // Water and food keeping (economy.js WATER, spoilRate; farming.js greenhouse plots).
  well:         { name: "Well",           cost: { scrap: 15, parts: 1 },  hours: 24, max: 2, desc: "+6 water a day (less in a dry spell). Fills the base up to its water capacity." },
  rain_catcher: { name: "Rain catcher",   cost: { scrap: 5 },             hours: 8,  max: 4, desc: "Tarps and barrels: +2 water per unit of rain (about 4–7 on a wet day, up to 12 in a storm, nothing when dry)." },
  cistern:      { name: "Cistern",        cost: { scrap: 25 },            hours: 30, max: 3, desc: "+150 water capacity (the hub holds 80 without one, an outpost 40)." },
  // Food storage (storage.js): room for fresh food; food above the room is stored outside and spoils fast.
  cellar:       { name: "Root cellar",    cost: { scrap: 15 },            hours: 20, max: 2, desc: "+200 food storage room underground: food in a cellar spoils slowly (0.5% a day, 0.3% in the cold). The hub already has a small cellar (200), an outpost only a pantry (40); food above the room is stored outside and spoils fast (3% a day, more in heat and rain)." },
  coldstore:    { name: "Cold store",     cost: { scrap: 20 },            hours: 24, max: 1, desc: "An ice house packed with ice and snow: +150 food storage room, the best there is in winter (0.1–0.2% a day), still good in spring and autumn (0.5%), poor in summer once the ice is gone (1.2%)." },
  kitchen:      { name: "Preserving kitchen", cost: { scrap: 18, parts: 1 }, hours: 24, max: 2, station: "preserve", desc: "Workshop station. One operator jars fresh food: 9 food + 3 water + 1 scrap + 4 empty jars → 8 preserved food a day (9 with Farming 8+). Jars are found in kitchens, shops and farms; most come back when the food is eaten here." },
  smoker:       { name: "Drying rack",    cost: { scrap: 6 },             hours: 8,  max: 3, desc: "Racks and a smoke pit, no operator: dries 4 surplus fresh food into 3 preserved food a day (half on wet days). Takes food stored outside first, else only food above 15 days of eating." },
  greenhouse:   { name: "Greenhouse",     cost: { scrap: 20, parts: 3 },  hours: 36, max: 2, desc: "+2 sheltered crop plots: grow in every season (winter too), stand 10 °C more cold, and the weather rarely harms them." },
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
// Crop plots (farming.js plotLimit): hub 4, outpost 2, +2 per Farm plot building.
export const farmSlots = (base) => (base.type === "hub" ? 6 : 2) + count(base, "farm_plot") * 2;
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
  // Someone too sick to work (health.js) leaves the station idle.
  return atBase(state, base.id).find((s) => s.role === "operate" && s.station === st.id && !s.inBed && workFactor(s) >= 0.35) || null;
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

// Stations with an operator at work (not in a hospital bed): what makes workshop noise (Heat, hordes.js).
export const mannedStations = (state, base) => stations(base).filter((st) => stationOperator(state, base, st)).length;

// Extra meds per day from a med station thanks to the base's hospital (Clinic or better). Like everything else
// a hospital does, it needs the medics to run it (the same staffing rule as medical.activeHospital).
function hospitalCraft(state, base) {
  if (!state || !base) return 0;
  const medics = atBase(state, base.id).filter((s) => s.role === "medic").length;
  return Math.max(0, ...base.buildings.map((b) => {
    const m = BUILDINGS[b.type].med;
    return m && medics >= m.staff ? m.craft || 0 : 0;
  }));
}

// state is needed for the hospital bonus on meds (staffing); without it the bonus is left out.
export function recipeOutput(s, recipe, base = null, state = null) {
  const r = RECIPES[recipe];
  const out = {};
  for (const [k, v] of Object.entries(r.out)) {
    let q = v;
    if (recipe === "ammo") q = Math.round(v * (1 + skill(s, "mechanics") * 0.04));
    if (recipe === "meds" && skill(s, "medicine") >= 8) q += 1;
    if (recipe === "meds") q += hospitalCraft(state, base);
    if (recipe === "preserve" && skill(s, "farming") >= 8) q += 1;
    out[k] = q;
  }
  return out;
}

export function stationStatus(state, base, st) {
  const recipe = BUILDINGS[st.type].station;
  const r = RECIPES[recipe];
  const op = stationOperator(state, base, st);
  if (!op) {
    const sick = atBase(state, base.id).find((s) => s.role === "operate" && s.station === st.id);
    return { op: null, running: false, reason: sick ? (sick.inBed ? "Operator in a hospital bed" : "Operator too sick to work") : "No operator", recipe, out: {} };
  }
  const missing = Object.entries(r.in).filter(([k, v]) => (base.stock[k] || 0) < v).map(([k]) => k);
  const out = recipeOutput(op, recipe, base, state);
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
    if (r.in.jars) base.jarsInUse = (base.jarsInUse || 0) + r.in.jars; // filled jars (storage.js)
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
  if (def.outpostOnly && base.type !== "outpost") return { ok: false, reason: "Outposts only" };
  for (const [k, v] of Object.entries(def.cost)) if ((base.stock[k] || 0) < v) return { ok: false, reason: `Needs ${v} ${k}` };
  if (def.req) {
    for (const [sk, lvl] of Object.entries(def.req)) {
      if (!atBase(state, base.id).some((s) => skill(s, sk) >= lvl)) return { ok: false, reason: `Needs a ${SKILL_NAMES[sk] || sk} ${lvl}+ survivor here` };
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

// Cancelling an untouched job refunds everything; a started one gives half back, rounded up (the same rule as
// crafting.cancelCraft). Returns the message to show.
export function cancelBuild(state, base, id) {
  const job = base ? base.construction.find((c) => c.id === id) : null;
  if (!job) return "That job is gone.";
  const full = job.progress <= 0;
  for (const [k, v] of Object.entries(BUILDINGS[job.type].cost)) base.stock[k] = (base.stock[k] || 0) + (full ? v : Math.ceil(v / 2));
  base.construction.splice(base.construction.indexOf(job), 1);
  return `Cancelled ${BUILDINGS[job.type].name}. ${full ? "All" : "Half"} the materials were returned.`;
}

export function buildRate(state, base) {
  return atBase(state, base.id).filter((s) => s.role === "build" && !s.inBed).reduce((a, s) => a + (1 + skill(s, "mechanics") * 0.03) * workFactor(s), 0);
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
    ["Crop plots", `${farmSlots(base)}${count(base, "greenhouse") ? ` + ${count(base, "greenhouse") * 2} under glass` : ""}`],
    ["Workshop stations", `${stations(base).length}`],
    ["Vision", `${(base.type === "hub" ? 3 : 2) + (base.watchtower ? 2 : 0)} tiles`],
    ["Radio", base.radio ? "Station" : count(base, "relay") ? (base.relayOffline ? "Relay (offline: needs 1 part)" : "Relay") : "No"],
    ["Vehicle repairs", count(base, "garage") ? "Garage (+25 per part)" : "Field repair (+12 per part, Mechanics 4+)"],
    ["Raid losses", count(base, "storehouse") ? "Halved by storehouse" : "Normal"],
    ["Water", `${(base.type === "hub" ? 12 : 3) + count(base, "well") * 6}/day from wells${count(base, "rain_catcher") ? `, ${count(base, "rain_catcher")} rain catcher${count(base, "rain_catcher") === 1 ? "" : "s"}` : ""}, holds ${(base.type === "hub" ? 80 : 40) + count(base, "cistern") * 150}`],
    ["Food storage", `${storeCapacity(base)} room for fresh food (${storeSpaces(base).map((x) => `${x.name.toLowerCase()} ${x.cap}`).join(", ")}); more is stored outside and spoils fast`],
    ["Preserving", [count(base, "kitchen") ? `${count(base, "kitchen")} kitchen${count(base, "kitchen") > 1 ? "s" : ""}` : "", count(base, "smoker") ? `${count(base, "smoker")} drying rack${count(base, "smoker") > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ") || "None"],
    ["Medical", (() => {
      const h = base.buildings.find((x) => BUILDINGS[x.type].family === "hospital");
      if (!h) return "No hospital (severe wounds heal slowly)";
      const d = BUILDINGS[h.type];
      return `Tier ${d.tier} ${d.name}: ${d.med.beds} beds, needs ${d.med.staff} medic${d.med.staff === 1 ? "" : "s"}${d.med.surgery ? ", surgery" : ""}`;
    })()],
  ];
}
