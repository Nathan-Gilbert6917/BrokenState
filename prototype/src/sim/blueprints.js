// Manuals and blueprints (suggestions-2 #10): tech from the field. The top tiers of a few buildings and three
// advanced crafts are locked until the matching manual or blueprint has been recovered AND studied at a base:
//
//   1. Find it: on the shelves of fitting sites (hour-by-hour searches and raid containers, more often in locked
//      containers and locked rooms, see locks.js), in crash sites (crashes.js), from traders (skills.js bookWares)
//      and as a job reward (blueprintReward, for diplomacy jobs). It is an item (GEAR key "bp_<id>") carried home
//      like a book and kept in the base's armory.
//   2. Study it: a survivor on the Read role (skills.js) at a base whose armory holds it, with the blueprint's skill
//      at its minimum, studies it before any book: READ_HOURS a day (fewer when ill) toward its hours, 2 study XP an
//      hour in that skill. Progress is kept per blueprint (state.tech.progress), so anyone can carry on.
//   3. Done: the blueprint is known for good (state.tech.known); the copy stays in the armory (sell it or keep it).
//
// Early buildings are never locked; only the upper tiers listed in LOCKED (the Clinic and Trauma hospital, the
// machine shop and generator, the reinforced gate and trench, the cistern and cold store, a second preserving
// kitchen, the radio relay) and three crafts (scrap crossbow, pipe shotgun, scrap plate vest).
// Rolls use hash01 (skills.js): finds never move the world's random numbers.
import { GEAR, LOCATIONS, SKILL_NAMES } from "./data.js";
import { log, atBase, skill } from "./world.js";
import { hash01, gainXp, READ_HOURS } from "./skills.js";
import { newItem } from "./inventory.js";
import { workFactor } from "./health.js";

// sites: where it turns up on the shelves (location types). unlocks.buildings / unlocks.crafts: what it opens;
// unlocks.from: a building type free up to this many (the first preserving kitchen needs no manual).
export const BLUEPRINTS = {
  fieldsurgery: { name: "Field Surgery Manual", skill: "medicine", min: 4, hours: 24, value: 60, unlocks: { buildings: ["clinic"] },
    sites: ["hospital", "univ", "clinic", "military", "firestation"], desc: "Army field surgery: sterile fields, sutures, chest drains." },
  hospitalops: { name: "Hospital Operations Manual", skill: "medicine", min: 8, hours: 36, value: 90, unlocks: { buildings: ["hospital"] },
    sites: ["hospital", "univ"], desc: "How a trauma ward runs: theatre, sterilisation, triage, generator power." },
  machinist: { name: "Machinist's Handbook", skill: "mechanics", min: 3, hours: 24, value: 60, unlocks: { buildings: ["machine_shop"] },
    sites: ["factory", "univ", "hardware", "dam", "airport", "autoshop"], desc: "Lathes, mills, tolerances: making spare parts from scrap." },
  genschem: { name: "Generator Schematics", skill: "mechanics", min: 3, hours: 24, value: 60, unlocks: { buildings: ["generator"] },
    sites: ["dam", "factory", "military", "airport", "hospital", "radiotower"], desc: "Wiring diagrams for standby generators and transfer switches." },
  armyeng: { name: "Army Engineering Manual", skill: "mechanics", min: 2, hours: 30, value: 70, unlocks: { buildings: ["gate", "trench"] },
    sites: ["military", "prison", "police"], desc: "Field fortifications: obstacles, ditches, gates that hold." },
  watertreat: { name: "Water Treatment Schematics", skill: "mechanics", min: 2, hours: 20, value: 45, unlocks: { buildings: ["cistern"] },
    sites: ["dam", "univ", "factory", "firestation"], desc: "Settling tanks, sand filters and sealed storage." },
  refrig: { name: "Refrigeration Schematics", skill: "mechanics", min: 3, hours: 20, value: 45, unlocks: { buildings: ["coldstore"] },
    sites: ["supermarket", "warehouse", "factory", "truckstop", "univ", "grocery"], desc: "Insulated cold rooms, ice packing and compressor loops." },
  canning: { name: "Commercial Canning Guide", skill: "farming", min: 3, hours: 16, value: 40, unlocks: { buildings: ["kitchen"], from: { kitchen: 1 } },
    sites: ["farm", "feedstore", "school", "grocery", "supermarket", "church", "ranch"], desc: "Pressure canning in batches: a second preserving kitchen." },
  radioeng: { name: "Radio Engineering Handbook", skill: "mechanics", min: 3, hours: 24, value: 60, unlocks: { buildings: ["relay"] },
    sites: ["radiotower", "airport", "police", "military", "univ"], desc: "Antennas, repeaters and line-of-sight links." },
  weaponplans: { name: "Improvised Weapons Plans", skill: "mechanics", min: 4, hours: 20, value: 55, unlocks: { crafts: ["crossbow", "pipegun"] },
    sites: ["gunstore", "police", "prison", "military", "hardware", "lodge"], desc: "Leaf-spring crossbows and zip guns, with drawings." },
  armorsmith: { name: "Armor Smithing Notes", skill: "mechanics", min: 3, hours: 16, value: 45, unlocks: { crafts: ["scrapvest"] },
    sites: ["military", "police", "factory", "prison", "hardware"], desc: "Cutting, bending and riveting plate onto a carrier." },
};
export const BP_KEYS = Object.keys(BLUEPRINTS);
export const bpItemKey = (id) => `bp_${id}`;
export const bpOfItem = (key) => (GEAR[key] && GEAR[key].blueprint) || null;

// What each blueprint locks: building type → { bp, from }, craft key → bp.
export const LOCKED = { buildings: {}, crafts: {} };
for (const [id, d] of Object.entries(BLUEPRINTS)) {
  for (const t of d.unlocks.buildings || []) LOCKED.buildings[t] = { bp: id, from: (d.unlocks.from && d.unlocks.from[t]) || 0 };
  for (const k of d.unlocks.crafts || []) LOCKED.crafts[k] = id;
}

// The items (registered with the gear so trade, armories, cargo and the inventory know them). Not worn: a pack
// item, kept in an armory, like a book.
for (const [id, d] of Object.entries(BLUEPRINTS)) {
  const opens = [...(d.unlocks.buildings || []).map((t) => t), ...(d.unlocks.crafts || [])];
  GEAR[bpItemKey(id)] = {
    name: d.name, slot: "pack", skill: null, power: 0, req: 0, value: d.value, noise: 0, blueprint: id, weight: 0.2, // a folder of papers (load.js)
    desc: `${d.desc} Study it at a base (Read role, ${SKILL_NAMES[d.skill]} ${d.min}+, ${d.hours}h) to unlock: ${opens.map(unlockName).join(", ")}.`,
  };
}
function unlockName(k) {
  const names = {
    clinic: "the Clinic", hospital: "the Trauma hospital", machine_shop: "the machine shop", generator: "the generator", gate: "the reinforced gate",
    trench: "the trench", cistern: "the cistern", coldstore: "the cold store", kitchen: "a second preserving kitchen", relay: "the radio relay",
    crossbow: "the scrap crossbow", pipegun: "the pipe shotgun", scrapvest: "the scrap plate vest",
  };
  return names[k] || k;
}

// ---------- the tech state ----------
export function tech(state) {
  if (!state.tech) state.tech = { known: [], progress: {}, found: {} };
  if (!state.tech.found) state.tech.found = {};
  return state.tech;
}
export const isKnown = (state, id) => tech(state).known.includes(id);
export const studyHours = (state, id) => Math.max(0, tech(state).progress[id] || 0);
// Tools and tests: everything known (no locks).
export function unlockAll(state) {
  const t = tech(state);
  t.known = [...BP_KEYS];
}

// Where it may turn up, for the "Needs" lines: site names, plus the other ways.
export function whereFound(id) {
  const d = BLUEPRINTS[id];
  if (!d) return "";
  const sites = d.sites.map((t) => (LOCATIONS[t] ? LOCATIONS[t].name.toLowerCase() : t));
  return `${sites.join(", ")}; locked safes and cases, crash sites, traders`;
}

// "" when the building can be built as far as tech goes, else why not.
export function buildLock(state, base, type) {
  const L = LOCKED.buildings[type];
  if (!L || isKnown(state, L.bp)) return "";
  if (L.from && base && base.buildings.filter((b) => b.type === type).length + base.construction.filter((c) => c.type === type).length < L.from) return "";
  return `Needs the ${BLUEPRINTS[L.bp].name} (studied)`;
}
export function craftLock(state, key) {
  const id = LOCKED.crafts[key];
  return id && !isKnown(state, id) ? `Needs the ${BLUEPRINTS[id].name} (studied)` : "";
}
// The blueprint a building or craft waits for (for the UI's "Needs: … (where)" lines), or null.
export function lockOf(state, base, kind, key) {
  if (kind === "craft") { const id = LOCKED.crafts[key]; return id && !isKnown(state, id) ? id : null; }
  const L = LOCKED.buildings[key];
  return L && buildLock(state, base, key) ? L.bp : null;
}
export function lockNote(state, base, kind, key) {
  const id = lockOf(state, base, kind, key);
  if (!id) return "";
  const d = BLUEPRINTS[id];
  const held = copiesHeld(state)[id];
  const prog = studyHours(state, id);
  const status = held ? (prog > 0 ? ` (studying: ${Math.floor(prog)}/${d.hours}h)` : ` (a copy is here: put someone with ${SKILL_NAMES[d.skill]} ${d.min}+ on the Read role)`) : "";
  return `Needs: ${d.name}${status}. Look in: ${whereFound(id)}.`;
}

// ---------- copies held ----------
// Blueprint items in every base armory and every team's cargo (and on people).
export function copiesHeld(state) {
  const out = {};
  const add = (it) => { const id = it && bpOfItem(it.key); if (id) out[id] = (out[id] || 0) + 1; };
  for (const b of state.bases) for (const it of b.armory || []) add(it);
  for (const p of state.parties) if (p.owner === "player" && p.cargo) for (const it of p.cargo.gear || []) add(it);
  return out;
}

// ---------- finds ----------
// Chance per search hour (hour-by-hour search) or per container (raid map) by the site's zone, at full loot.
const ZONE_P = { urban: 0.018, town: 0.012, rural: 0.008, special: 0.03 };
export const CRASH_BP = {
  crash_mil: ["armyeng", "genschem", "weaponplans", "armorsmith", "radioeng"],
  crash_med: ["fieldsurgery", "hospitalops", "watertreat"],
  crash_news: ["radioeng", "genschem"],
  crash_cargo: ["refrig", "canning", "machinist", "watertreat"],
  airdrop: ["fieldsurgery", "watertreat", "armyeng"],
};
// Blueprint ids a site type can hold.
export function siteBlueprints(type) {
  if (CRASH_BP[type]) return CRASH_BP[type];
  return BP_KEYS.filter((id) => BLUEPRINTS[id].sites.includes(type));
}
// A blueprint found at a site (an item) or null. Only ones you do not know and do not hold a copy of come up, so a
// find is always news. mult: locked containers, locked rooms, Treasure Hunter, the search pace. salt: makes each
// roll unique.
export function rollBlueprint(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  if (!t || !t.loc) return null;
  const list = siteBlueprints(t.loc.type);
  if (!list.length) return null;
  const held = copiesHeld(state);
  const open = list.filter((id) => !isKnown(state, id) && !held[id]);
  if (!open.length) return null;
  const base = CRASH_BP[t.loc.type] ? 0.25 : ZONE_P[t.loc.zone] || 0.03;
  const loot = Math.max(0.15, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "bp", tileId, state.hour, salt) >= Math.min(0.9, base * loot * mult)) return null;
  const id = open[Math.floor(hash01(state.seed, "bpk", tileId, state.hour, salt) * open.length) % open.length];
  noteFound(state, id);
  return newItem(bpItemKey(id), 1);
}
export function noteFound(state, id) {
  const t = tech(state);
  t.found[id] = (t.found[id] || 0) + 1;
}

// A blueprint as a job reward (for diplomacy jobs): one you do not have, fitting the group, or null.
export function blueprintReward(state, f, salt = "") {
  const pref = { military: ["armyeng", "genschem", "weaponplans", "armorsmith"], traders: BP_KEYS, commune: ["canning", "watertreat", "refrig"], fortress: ["armyeng", "armorsmith", "machinist"] }[f && f.type] || BP_KEYS;
  const held = copiesHeld(state);
  const open = pref.filter((id) => !isKnown(state, id) && !held[id]);
  if (!open.length) return null;
  const id = open[Math.floor(hash01(state.seed, "bprew", f ? f.name : "", state.hour, salt) * open.length) % open.length];
  noteFound(state, id);
  return newItem(bpItemKey(id), 1);
}

// What a group sells this week (skills.js bookWares adds it to their books): traders often, the military its manuals.
const WARE_BP = {
  traders: { p: 0.3, list: BP_KEYS },
  military: { p: 0.3, list: ["armyeng", "genschem", "weaponplans", "armorsmith", "radioeng"] },
  commune: { p: 0.2, list: ["canning", "watertreat", "refrig"] },
  fortress: { p: 0.15, list: ["armyeng", "armorsmith", "machinist"] },
};
export function blueprintWares(state, f, dayNo) {
  const w = WARE_BP[f.type];
  if (!w || hash01(state.seed, "bpware", f.name, dayNo) >= w.p) return [];
  const open = w.list.filter((id) => !isKnown(state, id));
  if (!open.length) return [];
  const id = open[Math.floor(hash01(state.seed, "bpw", f.name, dayNo) * open.length) % open.length];
  return [newItem(bpItemKey(id), 1)];
}

// ---------- study (skills.js readingDaily: the Read role) ----------
export const STUDY_XP = 2; // study XP an hour in the blueprint's skill
// Blueprints in a base's armory that are not known yet.
export function studyable(state, base) {
  const out = [];
  for (const it of base.armory || []) {
    const id = it && bpOfItem(it.key);
    if (id && !isKnown(state, id) && !out.includes(id)) out.push(id);
  }
  return out;
}
export const canStudy = (s, id) => !!BLUEPRINTS[id] && skill(s, BLUEPRINTS[id].skill) >= BLUEPRINTS[id].min;
export function studyReason(state, s, id) {
  const d = BLUEPRINTS[id];
  if (!d) return "Not a blueprint.";
  if (isKnown(state, id)) return "Already studied.";
  if (skill(s, d.skill) < d.min) return `Needs ${SKILL_NAMES[d.skill]} ${d.min}+ (${s.name.split(" ")[0]} has ${skill(s, d.skill)}).`;
  return "";
}
// Called for each reader at a base once a day, before books: true when they studied a blueprint today.
export function studyBlueprint(state, base, s) {
  if (!s || s.role !== "read" || s.inBed) return false;
  const list = studyable(state, base).filter((id) => canStudy(s, id));
  if (!list.length) { if (s.studying) delete s.studying; return false; }
  // One blueprint per reader: their own, else the one with the most progress nobody else here is on.
  const others = atBase(state, base.id).filter((o) => o !== s && o.role === "read" && o.studying).map((o) => o.studying);
  let id = list.includes(s.studying) ? s.studying : null;
  if (!id) id = [...list].sort((a, b) => (others.includes(a) - others.includes(b)) || studyHours(state, b) - studyHours(state, a) || BP_KEYS.indexOf(a) - BP_KEYS.indexOf(b))[0];
  s.studying = id;
  const d = BLUEPRINTS[id];
  const h = Math.min(READ_HOURS * Math.max(0.5, workFactor(s)), d.hours - studyHours(state, id));
  const t = tech(state);
  t.progress[id] = studyHours(state, id) + h;
  gainXp(state, s, d.skill, h * STUDY_XP, "study");
  if (t.progress[id] >= d.hours - 1e-9) learn(state, id, s, base);
  return true;
}
export function learn(state, id, s = null, base = null) {
  const t = tech(state);
  if (t.known.includes(id)) return;
  t.known.push(id);
  const d = BLUEPRINTS[id];
  const opens = [...(d.unlocks.buildings || []), ...(d.unlocks.crafts || [])].map(unlockName).join(", ");
  log(state, `📘 ${s ? `${s.name.split(" ")[0]} finished studying` : "Studied"} the ${d.name}${base ? ` at ${base.name}` : ""}: ${opens} can now be ${d.unlocks.crafts ? "made" : "built"}.`, "good");
  for (const o of state.survivors) if (o.studying === id) delete o.studying;
}

// Autopilot and stewards (skills.js planStudy): a qualified free person on the Read role for each blueprint at the
// base that nobody studies yet. free: Set of people without a role this hour; give(s, role).
export function planBlueprintStudy(state, base, free, give) {
  const people = atBase(state, base.id);
  for (const id of studyable(state, base)) {
    if (people.some((s) => s.role === "read" && s.studying === id && !free.has(s))) continue;
    const pick = [...free].filter((s) => !s.inBed && workFactor(s) >= 0.35 && canStudy(s, id))
      .sort((a, b) => skill(b, BLUEPRINTS[id].skill) - skill(a, BLUEPRINTS[id].skill) || a.id - b.id)[0];
    if (!pick) continue;
    pick.studying = id;
    give(pick, "read");
  }
}

// For the UI: every blueprint with its state.
export function blueprintRows(state) {
  const held = copiesHeld(state);
  const readers = state.survivors.filter((s) => s.alive && s.role === "read" && s.studying);
  return BP_KEYS.map((id) => {
    const d = BLUEPRINTS[id];
    const known = isKnown(state, id);
    return {
      id, d, known, held: held[id] || 0, hours: studyHours(state, id),
      who: readers.filter((s) => s.studying === id), opens: [...(d.unlocks.buildings || []), ...(d.unlocks.crafts || [])].map(unlockName),
      where: whereFound(id),
    };
  });
}
export { unlockName };
