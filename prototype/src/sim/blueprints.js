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
// machine shop and generator, the reinforced gate and trench, the cistern, the cold store and the walk-in freezer, a
// second preserving room, the radio relay), the generator's third tier (unlocks.upgrades: an upgrade where it stands,
// not a building type: gen-tiers, the Industrial Power Manual) and three crafts (scrap crossbow, pipe shotgun, scrap
// plate vest).
// The AI groups (machines-2 2026-10-10, the user's rule: "AI groups need to have the same restrictions and gameplay
// features") find, buy and study these too, coarsely, and their works wait for the same ones (groupworks.js groupTech).
// Rolls use hash01 (skills.js): finds never move the world's random numbers.
import { GEAR, LOCATIONS, SKILL_NAMES } from "./data.js";
import { log, atBase, skill } from "./world.js";
import { hash01, gainXp, READ_HOURS, BOOK_SITES, WARE_BOOKS, readReason } from "./skills.js";
import { newItem } from "./inventory.js";
import { workFactor } from "./health.js";
import { noteOutput } from "./output.js"; // the base's Work now panel: what each job brought in a day (activity.js)

// sites: where it turns up on the shelves (location types). unlocks.buildings / unlocks.crafts: what it opens;
// unlocks.from: a building type free up to this many (the first preserving room needs no manual).
export const BLUEPRINTS = {
  fieldsurgery: { name: "Field Surgery Manual", skill: "medicine", min: 4, hours: 24, value: 60, unlocks: { buildings: ["clinic"] },
    sites: ["hospital", "univ", "clinic", "military", "firestation"], desc: "Army field surgery: sterile fields, sutures, chest drains." },
  hospitalops: { name: "Hospital Operations Manual", skill: "medicine", min: 8, hours: 36, value: 90, unlocks: { buildings: ["hospital"] },
    sites: ["hospital", "univ"], desc: "How a trauma ward runs: theatre, sterilisation, triage, generator power." },
  machinist: { name: "Machinist's Handbook", skill: "mechanics", min: 3, hours: 24, value: 60, unlocks: { buildings: ["machine_shop"] },
    sites: ["factory", "univ", "hardware", "dam", "airport", "autoshop"], desc: "Lathes, mills, tolerances: making spare parts from scrap." },
  genschem: { name: "Generator Schematics", skill: "mechanics", min: 3, hours: 24, value: 60, unlocks: { buildings: ["generator"] },
    sites: ["dam", "factory", "military", "airport", "hospital", "radiotower"], desc: "Wiring diagrams for standby generators and transfer switches." },
  // gen-tiers 2026-10-10: the generator's tier 3 (power.js GEN_TIERS[3].bp; an upgrade, not a building: unlocks.upgrades).
  // Mechanics 4 to study (the standby generator's hand), as the Hospital Operations Manual is a step above the clinic's.
  indpower: { name: "Industrial Power Manual", skill: "mechanics", min: 4, hours: 30, value: 70, unlocks: { upgrades: ["generator3"] },
    sites: ["dam", "factory", "quarry", "military", "hospital", "airport"], desc: "Service manuals for skid-mounted diesel sets: load banks, governors, paralleling and day tanks." },
  armyeng: { name: "Army Engineering Manual", skill: "mechanics", min: 2, hours: 30, value: 70, unlocks: { buildings: ["gate", "trench"], from: { trench: 1 } }, // the first trench any base digs (the Defenses tab, 2026-10-19); the second line needs the manual
    sites: ["military", "prison", "police"], desc: "Field fortifications: obstacles, ditches, gates that hold." },
  watertreat: { name: "Water Treatment Schematics", skill: "mechanics", min: 2, hours: 20, value: 45, unlocks: { buildings: ["cistern"] },
    sites: ["dam", "univ", "factory", "firestation"], desc: "Settling tanks, sand filters and sealed storage." },
  refrig: { name: "Refrigeration Schematics", skill: "mechanics", min: 3, hours: 20, value: 45, unlocks: { buildings: ["coldstore", "freezer"] }, // machines-2: the walk-in freezer too
    sites: ["supermarket", "warehouse", "factory", "truckstop", "univ", "grocery"], desc: "Insulated cold rooms, ice packing and compressor loops." },
  canning: { name: "Commercial Canning Guide", skill: "farming", min: 3, hours: 16, value: 40, unlocks: { buildings: ["kitchen"], from: { kitchen: 1 } },
    sites: ["farm", "feedstore", "school", "grocery", "supermarket", "church", "ranch"], desc: "Pressure canning in batches: a second preserving room." },
  radioeng: { name: "Radio Engineering Handbook", skill: "mechanics", min: 3, hours: 24, value: 60, unlocks: { buildings: ["relay"] },
    sites: ["radiotower", "airport", "police", "military", "univ"], desc: "Antennas, repeaters and line-of-sight links." },
  weaponplans: { name: "Improvised Weapons Plans", skill: "mechanics", min: 4, hours: 20, value: 55, unlocks: { crafts: ["crossbow", "pipegun"] },
    sites: ["gunstore", "police", "prison", "military", "hardware", "lodge"], desc: "Leaf-spring crossbows and zip guns, with drawings." },
  armorsmith: { name: "Armor Smithing Notes", skill: "mechanics", min: 3, hours: 16, value: 45, unlocks: { crafts: ["scrapvest"] },
    sites: ["military", "police", "factory", "prison", "hardware"], desc: "Cutting, bending and riveting plate onto a carrier." },
  // ---------- craft blueprints for special gear (crafting.js CRAFTS, the block at its end) ----------
  // covers: ordinary recipes that come out better and faster once it is known (craftEdge; its unlocks count too).
  bowyer: { name: "Bowyer's Drawings", skill: "crafting", min: 4, hours: 20, value: 55, unlocks: { crafts: ["pulleybow"] }, covers: ["crossbow", "arrows"],
    sites: ["gunstore", "lodge", "cabin", "ranger", "mall"], desc: "Laminating limbs, cutting cams from scrap pulleys, tillering a bow true." },
  combatmedic: { name: "Combat Medic's Notes", skill: "medicine", min: 4, hours: 18, value: 50, unlocks: { crafts: ["traumakit"] }, covers: ["bandagekit", "dressings"],
    sites: ["military", "hospital", "firestation", "clinic", "police"], desc: "An army medic's packing lists: tourniquets, chest seals, pressure dressings." },
  // ---------- end of craft blueprints ----------
};
export const BP_KEYS = Object.keys(BLUEPRINTS);
export const bpItemKey = (id) => `bp_${id}`;
export const bpOfItem = (key) => (GEAR[key] && GEAR[key].blueprint) || null;
// Recipe keys whose gear key differs (crafting.js CRAFTS), for unlockName; the rest share the gear's key.
const CRAFTS_GEAR = { dressings: "bandagekit", repackfilter: "waterfilter" };

// ---------- craft books (data.js GEAR entries with a book field) ----------
// A book read on the Read role like any other (skills.js); once anyone has read one of these to the end at a base, it
// is known for good (state.tech.known, the same list as studied blueprints): its unlocks.crafts can be made, and its
// unlocks and covers get the crafting edge (craftEdge). Someone past the book's skill cap may still read it while it is
// not known yet (no XP above the cap).
export const CRAFT_BOOKS = {
  diybook: { unlocks: {}, covers: ["backpack", "slingbag", "crowbar", "ladder", "tripwire", "padding", "shinguards", "tirevest"] },
  forgebook: { unlocks: { crafts: ["springmachete", "rivethelmet"] }, covers: ["sawmachete", "spikedbat", "pipespear", "nailbat", "scrapvest"] },
  bushcraftbook: { unlocks: { crafts: ["woodghillie"] }, covers: ["ghillie", "ragboots", "scentmask", "torch", "arrows", "waterfilter"] },
  enginebook: { unlocks: {}, covers: ["bicycle", "lantern", "headlamp", "flashlight", "spotlight", "windlight"] }, // Small Engine Repair (teaches Mechanics)
  // Cookbooks (wave 2 cooking, the user's pick 13: "cookbooks found while scavenging unlock meals even when not at the
  // correct level"). No craft recipes: cook maps a cooking recipe (cooking.js COOK_RECIPES) to the Cooking a cook needs
  // for it once the book is read (below the recipe's own level, at a poisoning cost a level short: cooking.js
  // POISON.below), and its recipes go cooking.js COOK.bookSpeed faster. They stack with skill: the lowest level of the
  // books read counts. cookText: the item's text and the log line. The AI groups learn them coarsely (cooking.js
  // groupCookbooks).
  cookbook: { unlocks: {}, covers: [], cook: { stew: 0, bread: 0, fine: 3 }, cookText: "the cooks make stew and bread at any Cooking and fine meals from Cooking 3 (2, 2 and 6 without it)" },
  chefbook: { unlocks: {}, covers: [], cook: { fine: 2, lavish: 4 }, cookText: "the cooks make fine meals from Cooking 2 and lavish meals from Cooking 4 (6 and 8 without it)" },
  gamebook: { unlocks: {}, covers: [], cook: { pemmican: 0, ground: 0, sausage: 1 }, cookText: "the cooks make pemmican and ground meat at any Cooking and smoked sausage from Cooking 1 (3, 0 and 3 without it)" },
  prepbook: { unlocks: {}, covers: [], cook: { survival: 1, pemmican: 1, flour: 0, bread: 0 }, cookText: "the cooks pack survival meals from Cooking 1 (4 without it), make pemmican from Cooking 1, and flour and bread at any Cooking" },
};
export const CRAFT_BOOK_KEYS = Object.keys(CRAFT_BOOKS);
const isBookTech = (id) => !!CRAFT_BOOKS[id];
export const techName = (id) => (BLUEPRINTS[id] ? BLUEPRINTS[id].name : GEAR[id] ? GEAR[id].name : id);

// The crafting edge ("blueprints and certain books improve crafting"): each known blueprint or read craft book whose
// unlocks or covers name a recipe makes it come out `quality` better on average (crafting.js craftQuality) and its
// work go `speed` faster (crafting.js craftRate), up to `max` such sources a recipe.
export const CRAFT_EDGE = { quality: 0.05, speed: 0.1, max: 2 };

// What each blueprint locks: building type → { bp, from }, craft key → bp (or craft book).
export const LOCKED = { buildings: {}, crafts: {}, upgrades: {} }; // upgrades: an upgrade key ("generator3") → bp
for (const [id, d] of Object.entries(BLUEPRINTS)) {
  for (const t of d.unlocks.buildings || []) LOCKED.buildings[t] = { bp: id, from: (d.unlocks.from && d.unlocks.from[t]) || 0 };
  for (const k of d.unlocks.upgrades || []) LOCKED.upgrades[k] = id;
  for (const k of d.unlocks.crafts || []) LOCKED.crafts[k] = id;
}
for (const [id, d] of Object.entries(CRAFT_BOOKS)) for (const k of d.unlocks.crafts || []) LOCKED.crafts[k] = id;
// Recipe key → the tech ids that give it the edge (their unlocks and covers).
export const EDGE_FROM = {};
for (const [id, d] of [...Object.entries(BLUEPRINTS), ...Object.entries(CRAFT_BOOKS)]) {
  for (const k of [...(d.unlocks.crafts || []), ...(d.covers || [])]) {
    EDGE_FROM[k] = EDGE_FROM[k] || [];
    if (!EDGE_FROM[k].includes(id)) EDGE_FROM[k].push(id);
  }
}
// The edge a recipe has in this world: { n, quality, speed, from: [names] }.
export function craftEdge(state, key) {
  const from = state ? (EDGE_FROM[key] || []).filter((id) => isKnown(state, id)).slice(0, CRAFT_EDGE.max) : [];
  return { n: from.length, quality: from.length * CRAFT_EDGE.quality, speed: 1 + from.length * CRAFT_EDGE.speed, from: from.map(techName) };
}
export const craftEdgeQuality = (state, key) => (state ? craftEdge(state, key).quality : 0);
export const craftEdgeSpeed = (state, key) => (state ? craftEdge(state, key).speed : 1);
// The edge line for an item's text: "x, y come out 5% better and are made 10% faster".
function edgeText(d) {
  const ks = [...new Set([...(d.unlocks.crafts || []), ...(d.covers || [])])];
  if (!ks.length) return "";
  return `${ks.map(unlockName).join(", ")} come out ${Math.round(CRAFT_EDGE.quality * 100)}% better and are made ${Math.round(CRAFT_EDGE.speed * 100)}% faster (up to ${CRAFT_EDGE.max} such manuals or books count for a recipe)`;
}

// The items (registered with the gear so trade, armories, cargo and the inventory know them). Not worn: a pack
// item, kept in an armory, like a book.
for (const [id, d] of Object.entries(BLUEPRINTS)) {
  const opens = [...(d.unlocks.buildings || []).map((t) => t), ...(d.unlocks.upgrades || []), ...(d.unlocks.crafts || [])];
  const edge = d.unlocks.crafts || d.covers ? edgeText(d) : "";
  GEAR[bpItemKey(id)] = {
    name: d.name, slot: "pack", skill: null, power: 0, req: 0, value: d.value, noise: 0, blueprint: id, cat: "manuals", weight: 0.2, // a folder of papers (load.js)
    desc: `${d.desc} Study it at a base (Read role, ${SKILL_NAMES[d.skill]} ${d.min}+, ${d.hours}h) to unlock: ${opens.map(unlockName).join(", ")}.${edge ? ` Once studied, ${edge}.` : ""}`,
  };
}
// The craft books' text: what reading one to the end does for the whole group.
for (const [key, d] of Object.entries(CRAFT_BOOKS)) {
  if (!GEAR[key] || GEAR[key].craftBook) continue;
  GEAR[key].craftBook = true;
  if (d.cook) { GEAR[key].cookBook = true; GEAR[key].desc += ` Once anyone has read it to the end at a base, for good: ${d.cookText}, and those meals are made 10% faster.`; continue; } // wave 2 cooking
  const opens = (d.unlocks.crafts || []).map(unlockName);
  GEAR[key].desc += ` Once anyone has read it to the end at a base, for good:${opens.length ? ` unlocks ${opens.join(", ")};` : ""} ${edgeText(d)}.`;
}
function unlockName(k) {
  const names = {
    clinic: "the Clinic", hospital: "the Trauma hospital", machine_shop: "the machine shop", generator: "the generator", gate: "the reinforced gate",
    trench: "the trench", cistern: "the cistern", coldstore: "the cold store", freezer: "the walk-in freezer", kitchen: "a second preserving room", relay: "the radio relay",
    crossbow: "the scrap crossbow", pipegun: "the pipe shotgun", scrapvest: "the scrap plate vest",
    generator3: "the industrial diesel set (a generator's third tier)",
  };
  if (names[k]) return names[k];
  const g = GEAR[CRAFTS_GEAR[k] || k];
  return g ? `the ${g.name.toLowerCase()}` : k;
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
  t.known = [...BP_KEYS, ...CRAFT_BOOK_KEYS];
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
// "" when an upgrade (LOCKED.upgrades: "generator3") is open as far as tech goes, else why not.
export function upgradeLock(state, key) {
  const id = LOCKED.upgrades[key];
  return !id || isKnown(state, id) ? "" : `Needs the ${BLUEPRINTS[id].name} (studied)`;
}
export function craftLock(state, key) {
  const id = LOCKED.crafts[key];
  if (!id || isKnown(state, id)) return "";
  return isBookTech(id) ? `Needs ${techName(id)} (read to the end by someone at a base)` : `Needs the ${BLUEPRINTS[id].name} (studied)`;
}
// The blueprint a building or craft waits for (for the UI's "Needs: … (where)" lines), or null.
export function lockOf(state, base, kind, key) {
  if (kind === "craft") { const id = LOCKED.crafts[key]; return id && !isKnown(state, id) ? id : null; }
  if (kind === "upgrade") { const id = LOCKED.upgrades[key]; return id && !isKnown(state, id) ? id : null; }
  const L = LOCKED.buildings[key];
  return L && buildLock(state, base, key) ? L.bp : null;
}
export function lockNote(state, base, kind, key) {
  const id = lockOf(state, base, kind, key);
  if (!id) return "";
  if (isBookTech(id)) {
    const b = GEAR[id].book;
    const held = booksHeld(state, id);
    const who = state.survivors.filter((s) => s.alive && s.role === "read" && s.reading === id);
    const status = who.length ? ` (reading: ${who.map((s) => `${s.name.split(" ")[0]} ${Math.floor((s.books && s.books[id]) || 0)}/${b.hours}h`).join(", ")})` : held ? " (a copy is here: put someone on the Read role at the base that holds it)" : "";
    return `Needs: ${techName(id)}, read to the end${status}. Look in: ${bookWhere(id)}.`;
  }
  const d = BLUEPRINTS[id];
  const held = copiesHeld(state)[id];
  const prog = studyHours(state, id);
  const status = held ? (prog > 0 ? ` (studying: ${Math.floor(prog)}/${d.hours}h)` : ` (a copy is here: put someone with ${SKILL_NAMES[d.skill]} ${d.min}+ on the Read role)`) : "";
  return `Needs: ${d.name}${status}. Look in: ${whereFound(id)}.`;
}

// ---------- craft books: copies held, where they turn up, read to the end ----------
// Copies of a book in every base armory and every team's cargo.
export function booksHeld(state, key) {
  let n = 0;
  for (const b of state.bases) for (const it of b.armory || []) if (it && it.key === key) n++;
  for (const p of state.parties) if (p.owner === "player" && p.cargo) for (const it of p.cargo.gear || []) if (it && it.key === key) n++;
  return n;
}
export function bookWhere(key) {
  const sites = Object.entries(BOOK_SITES).filter(([, d]) => d.books.includes(key)).map(([t]) => (LOCATIONS[t] ? LOCATIONS[t].name.toLowerCase() : t));
  const sold = Object.values(WARE_BOOKS).some((d) => d.books.includes(key));
  return `${sites.join(", ") || "nowhere on the shelves"}${sold ? "; traders" : ""}`;
}
// A craft book nobody has read to the end yet (skills.js: worth reading even past its skill cap).
export const bookUnlocksPending = (state, key) => isBookTech(key) && !isKnown(state, key);
// Someone finished reading a book (skills.js readHours): a craft book is known for good.
export function learnBook(state, key, s = null) {
  if (!isBookTech(key) || isKnown(state, key)) return false;
  tech(state).known.push(key);
  const d = CRAFT_BOOKS[key];
  if (d.cook) { log(state, `📗 ${s ? `${s.name.split(" ")[0]} read ${GEAR[key].name} to the end` : `${GEAR[key].name} is read`}: ${d.cookText}.`, "good"); return true; } // wave 2 cooking
  const opens = (d.unlocks.crafts || []).map(unlockName);
  const n = new Set([...(d.unlocks.crafts || []), ...(d.covers || [])]).size;
  log(state, `📗 ${s ? `${s.name.split(" ")[0]} read ${GEAR[key].name} to the end` : `${GEAR[key].name} is read`}: ${opens.length ? `${opens.join(", ")} can now be made, and ` : ""}${n} recipes come out better and faster.`, "good");
  return true;
}
// For the UI: every craft book with its state.
export function craftBookRows(state) {
  return CRAFT_BOOK_KEYS.filter((k) => GEAR[k] && !CRAFT_BOOKS[k].cook).map((key) => { // the cookbooks have their own rows (cookBookRows)
    const d = CRAFT_BOOKS[key];
    return { key, name: GEAR[key].name, known: isKnown(state, key), held: booksHeld(state, key), opens: (d.unlocks.crafts || []).map(unlockName), covers: (d.covers || []).map(unlockName), where: bookWhere(key), desc: GEAR[key].desc };
  });
}
// Wave 2 cooking: the cookbooks (CRAFT_BOOKS with cook) with their state, for the Blueprints card.
export function cookBookRows(state) {
  return CRAFT_BOOK_KEYS.filter((k) => GEAR[k] && CRAFT_BOOKS[k].cook).map((key) => ({ key, name: GEAR[key].name, known: isKnown(state, key), held: booksHeld(state, key), what: CRAFT_BOOKS[key].cookText, where: bookWhere(key), desc: GEAR[key].desc }));
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
export const ZONE_P = { urban: 0.018, town: 0.012, rural: 0.008, special: 0.03 }; // the groups' finds too (groupworks.js groupFindBlueprint)
export const CRASH_BP = {
  crash_mil: ["armyeng", "genschem", "weaponplans", "armorsmith", "radioeng", "combatmedic", "indpower"],
  crash_med: ["fieldsurgery", "hospitalops", "watertreat", "combatmedic"],
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
  const pref = { military: ["armyeng", "genschem", "weaponplans", "armorsmith", "combatmedic", "indpower"], traders: BP_KEYS, commune: ["canning", "watertreat", "refrig"], fortress: ["armyeng", "armorsmith", "machinist"] }[f && f.type] || BP_KEYS;
  const held = copiesHeld(state);
  const open = pref.filter((id) => !isKnown(state, id) && !held[id]);
  if (!open.length) return null;
  const id = open[Math.floor(hash01(state.seed, "bprew", f ? f.name : "", state.hour, salt) * open.length) % open.length];
  noteFound(state, id);
  return newItem(bpItemKey(id), 1);
}

// What a group sells this week (skills.js bookWares adds it to their books): traders often, the military its manuals.
export const WARE_BP = { // machines-2: also what a group starts with (groupworks.js groupTech)
  traders: { p: 0.3, list: BP_KEYS },
  military: { p: 0.3, list: ["armyeng", "genschem", "weaponplans", "armorsmith", "radioeng", "combatmedic", "indpower"] },
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
  noteOutput(state, base, "read", h, "readh");
  gainXp(state, s, d.skill, h * STUDY_XP, "study");
  if (t.progress[id] >= d.hours - 1e-9) learn(state, id, s, base);
  return true;
}
export function learn(state, id, s = null, base = null) {
  const t = tech(state);
  if (t.known.includes(id)) return;
  t.known.push(id);
  const d = BLUEPRINTS[id];
  const opens = [...(d.unlocks.buildings || []), ...(d.unlocks.upgrades || []), ...(d.unlocks.crafts || [])].map(unlockName).join(", ");
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
  // An unread craft book in the armory is read like a blueprint is studied (its recipes are for everyone): a free
  // person who can read it, someone it still teaches first (skills.js readReason).
  for (const key of unreadCraftBooks(state, base)) {
    if (people.some((s) => s.role === "read" && s.reading === key && !free.has(s))) continue;
    const b = GEAR[key].book;
    const pick = [...free].filter((s) => !s.inBed && workFactor(s) >= 0.35 && !readReason(s, key, state))
      .sort((a, c) => (skill(a, b.skill) >= b.max) - (skill(c, b.skill) >= b.max) || skill(c, b.skill) - skill(a, b.skill) || a.id - c.id)[0];
    if (!pick) continue;
    pick.reading = key;
    give(pick, "read");
  }
}
// Craft books in a base's armory that nobody has read to the end yet.
export function unreadCraftBooks(state, base) {
  const out = [];
  for (const it of base.armory || []) if (it && isBookTech(it.key) && GEAR[it.key] && !isKnown(state, it.key) && !out.includes(it.key)) out.push(it.key);
  return out;
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
      who: readers.filter((s) => s.studying === id), opens: [...(d.unlocks.buildings || []), ...(d.unlocks.upgrades || []), ...(d.unlocks.crafts || [])].map(unlockName),
      where: whereFound(id),
    };
  });
}
export { unlockName };
