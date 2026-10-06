// Hand crafting: survivors on the Craft role make makeshift gear (and a few supplies) by hand at any base,
// no station needed. Works like the construction queue: materials are paid when a job is queued, crafters
// put work-hours into the first job they are skilled enough for, and the item lands in the base armory.
// Some sturdier recipes still need a workshop (needs: "workshop" = an ammo bench or machine shop here).
// Makeshift gear has durability (item.dur): it wears with every fight / treatment / day of work and breaks at 0.
// Field crafting: a team in the field can make the simplest recipes (field: true) from what it carries.
import { GEAR, SKILL_NAMES } from "./data.js";
import { log, atBase, skill, newId, gearEffect } from "./world.js";
import { count, BUILDINGS } from "./buildings.js";
import { partyMembers, addGearToCargo } from "./parties.js";
import { ARMOR_SLOTS, SLOT_NAMES, EQUIP_SLOTS, ensurePack, stow, packOf } from "./inventory.js";
import { workFactor } from "./health.js";
import { hasPerk } from "./skills.js";
import { craftLock } from "./blueprints.js";
import { stockHas, useStock, teamWaterIn, takeTeamWater, RAW } from "./water.js"; // recipes: water counts both kinds, un-purified used first
import { WORM } from "./worm.js"; // TABS_WATER: what one purification tablet treats (the recipe text)

// in = materials (base stock), hours = work-hours, skill + min = who can make it, out = gear key or supplies.
// needs: "workshop" (an ammo bench or machine shop at this base) or a building key. field: can be made by a team.
export const CRAFTS = {
  pipespear:   { gear: "pipespear",   in: { scrap: 3 },           hours: 4,  skill: "mechanics", min: 0, field: true },
  spikedbat:   { gear: "spikedbat",   in: { scrap: 4 },           hours: 6,  skill: "mechanics", min: 0, field: true },
  sawmachete:  { gear: "sawmachete",  in: { scrap: 6 },           hours: 10, skill: "mechanics", min: 3 },
  crossbow:    { gear: "crossbow",    in: { scrap: 8, parts: 1 }, hours: 16, skill: "mechanics", min: 5, needs: "workshop" },
  pipegun:     { gear: "pipegun",     in: { scrap: 6, parts: 2 }, hours: 14, skill: "mechanics", min: 6, needs: "workshop" },
  padding:     { gear: "padding",     in: { scrap: 2 },           hours: 3,  skill: "mechanics", min: 0, field: true },
  shinguards:  { gear: "shinguards",  in: { scrap: 2 },           hours: 3,  skill: "mechanics", min: 0, field: true },
  tirevest:    { gear: "tirevest",    in: { scrap: 6 },           hours: 8,  skill: "mechanics", min: 2 },
  scrapvest:   { gear: "scrapvest",   in: { scrap: 10, parts: 1 },hours: 18, skill: "mechanics", min: 4, needs: "workshop" },
  bandagekit:  { gear: "bandagekit",  in: { scrap: 2, meds: 1 },  hours: 4,  skill: "medicine",  min: 2, field: true },
  dressings:   { name: "Boiled-rag dressings", supplies: { meds: 1 }, in: { scrap: 2, water: 2 }, hours: 6, skill: "medicine", min: 3, field: true,
                 desc: "Rags boiled clean and folded into dressings: 1 meds. Slower than a med station, but needs no building." },
  crowbar:     { gear: "crowbar",     in: { scrap: 4 },           hours: 5,  skill: "mechanics", min: 1 },
  waterfilter: { gear: "waterfilter", in: { scrap: 4 },           hours: 6,  skill: "mechanics", min: 2, field: true },
  // The worm (worm.js): a sure cure in the gut stage. Strong meds pressed into tablets at a med station.
  dewormer:    { gear: "dewormer",    in: { meds: 3, food: 1 },   hours: 8,  skill: "medicine",  min: 5, needs: "med_station" },
  // Purification tablets (worm.js): iodine from the meds pressed into a tube of 10 at a med station.
  puritabs:    { gear: "puritabs",    in: { meds: 1, scrap: 1 },  hours: 4,  skill: "medicine",  min: 3, needs: "med_station" },
  backpack:    { gear: "backpack",    in: { scrap: 3 },           hours: 5,  skill: "mechanics", min: 0 },
  // The stealth kit (stealth.js).
  noisemaker:  { gear: "noisemaker",  in: { scrap: 2 },           hours: 3,  skill: "mechanics", min: 1, field: true },
  firecracker: { gear: "firecracker", in: { scrap: 1, ammo: 8 },  hours: 3,  skill: "mechanics", min: 2, field: true },
  flashlight:  { gear: "flashlight",  in: { scrap: 2, parts: 1 }, hours: 6,  skill: "mechanics", min: 3 },
  suppressor:  { gear: "suppressor",  in: { scrap: 4, parts: 1 }, hours: 10, skill: "mechanics", min: 4, needs: "workshop" },
  // A bicycle built from frames and wheels (vehicles.js): it joins the base's bikes.
  bicycle:     { gear: "bicycle",     in: { scrap: 8, parts: 2 }, hours: 14, skill: "mechanics", min: 3, needs: "workshop" },
  // gearIn = items used up (from the base armory; in the field from the team's cargo or someone's pockets and pack).
  nailbat:     { gear: "nailbat",     gearIn: { bat: 1 }, in: { scrap: 1 }, hours: 2, skill: "mechanics", min: 0, field: true },
  molotov:     { gear: "molotov",     gearIn: { bottle: 1 }, in: { fuel: 1 }, hours: 1, skill: "mechanics", min: 0, field: true },
  pipebomb:    { gear: "pipebomb",    in: { scrap: 2, parts: 1, ammo: 15 }, hours: 6, skill: "mechanics", min: 5, needs: "workshop" },
  // Siege kit (siege.js): a ladder for walls, a ram for gates (taken along on an Assault, kit.js).
  ladder:      { gear: "ladder",      in: { scrap: 4 },           hours: 4,  skill: "mechanics", min: 1 },
  ram:         { gear: "ram",         in: { scrap: 8, parts: 2 }, hours: 10, skill: "mechanics", min: 3, needs: "workshop" },
  tripwire:    { gear: "tripwire",    in: { scrap: 1 },           hours: 2,  skill: "mechanics", min: 0, field: true },
  slingbag:    { gear: "slingbag",    in: { scrap: 2 },           hours: 3,  skill: "mechanics", min: 0 },
  // Camp kit against Heat (fieldheat.js): made by whoever knows how to keep quiet.
  ghillie:     { gear: "ghillie",     in: { scrap: 2 },           hours: 6,  skill: "stealth",   min: 2, field: true },
  ragboots:    { gear: "ragboots",    in: { scrap: 1 },           hours: 2,  skill: "stealth",   min: 0, field: true },
  scentmask:   { gear: "scentmask",   in: { scrap: 1, water: 1 }, hours: 2,  skill: "stealth",   min: 1, field: true },
};

export const WORKSHOP_TYPES = ["ammo_bench", "machine_shop"]; // stations with metal tools
export const MAX_CRAFT_QUEUE = 8;
const FIELD_QUALITY = -0.05;  // made on the road with less to work with
const WORKSHOP_QUALITY = 0.1; // workshop recipes come out a little better

export const craftName = (key) => CRAFTS[key].name || GEAR[CRAFTS[key].gear].name;
export const craftQueue = (base) => base.crafting || (base.crafting = []);
export const hasWorkshop = (base) => WORKSHOP_TYPES.some((t) => count(base, t) > 0);

export function meetsNeeds(base, r) {
  if (!r.needs) return true;
  if (r.needs === "workshop") return hasWorkshop(base);
  return count(base, r.needs) > 0;
}
const needsText = (r) => (r.needs === "workshop" ? "a workshop (ammo bench or machine shop)" : BUILDINGS[r.needs] ? `a ${BUILDINGS[r.needs].name.toLowerCase()}` : r.needs);

// Short description of what a recipe makes (for the UI).
export function craftOutputText(key) {
  const r = CRAFTS[key];
  if (r.supplies) return Object.entries(r.supplies).map(([k, v]) => `+${v} ${k}`).join(", ");
  const d = GEAR[r.gear];
  const bits = [];
  // What the thing does, by kind: weapons have power, armor has armor, packs carry, tools give their bonus.
  if (d.slot === "weapon") bits.push(`weapon, power ${d.power}`);
  else if (ARMOR_SLOTS.includes(d.slot)) bits.push(`${SLOT_NAMES[d.slot].toLowerCase()} armor ${d.power}`);
  else if (d.slot === "backpack") bits.push(`pack, ${d.slots} pack slots, +${d.carry} kg more to carry (max load)${d.ease ? `, load counts ${Math.round(d.ease * 100)}% lighter` : ""}`);
  else if (r.gear === "bicycle") bits.push("a bike for the base: teams ride out on bikes, one each (faster on roads, no fuel, a 15 kg rack)");
  else if (r.gear === "dewormer") bits.push("medicine: cures the worm while it is still in the gut, no medic needed, one use"); // worm.js
  else if (r.gear === "puritabs") bits.push(`medicine: a tube of ${d.dur} tablets, one makes ${WORM.TABS_WATER} un-purified water safe without stopping to boil it (for the road: teams drinking river or well water; a base only when its boiler is cold for want of firewood and it has no water filter)`); // worm.js
  else {
    const fx = [];
    if (d.medKit) fx.push(`+${d.medKit} Medicine when treating`);
    for (const [k, v] of Object.entries(d.bonus || {})) fx.push(`+${v} ${SKILL_NAMES[k]}${k === "scavenging" ? " for base scavenging" : ""}`);
    if (d.water) fx.push(`+${d.water} purified water a day at its base and purifies ${WORM.PURIFY_FILTER} un-purified water a day there (strains out the worm's eggs)`);
    // The stealth kit (stealth.js): thrown to pull guards away, a suppressor, a light for night raids.
    if (d.throw) fx.push(d.throw === "molotov" ? "thrown in battle, sets a 3 × 3 patch on fire for 2–3 turns (the dead walk into it), one use" : d.throw === "pipebomb" ? "thrown in battle (over walls too), blows up everyone within a tile and the cover there, one use" : "thrown in battle to pull unaware guards and the dead to a spot, one use");
    if (d.siege) fx.push(d.siege === "ladder" ? "set against a wall in battle to climb onto its walkway" : "carried by 2–3 to smash a barred gate or door, 16–24 a carrier a turn");
    if (d.suppressor) fx.push("halves the noise of a pistol or rifle shot");
    if (r.gear === "flashlight") fx.push("lets your people search at night, but the light is seen");
    if (d.heat) fx.push(`${Object.entries(d.heat).filter(([k]) => k !== "hours").map(([k, v]) => `Heat ×${v} ${k === "stay" ? "staying put" : k === "camp" ? "camping" : "searching"}`).join(", ")}${d.heat.hours ? `, for ${d.heat.hours} hours, used up` : ""}`);
    if (d.defence && d.defence.alarm) fx.push("an alarm for a base (everyone counts half on the walls) or a camp (less trouble)");
    bits.push(`${d.throw || d.suppressor || d.siege ? "kit" : d.heat ? "camp kit" : "tool"}${fx.length ? `, ${fx.join(", ")}` : ""}`);
  }
  if (d.req && d.skill) bits.push(`needs ${SKILL_NAMES[d.skill]} ${d.req}`);
  if (d.dur) bits.push(`lasts ${d.dur} ${durUnit(r.gear)}`);
  if (d.noise === 0 && d.slot === "weapon") bits.push("silent");
  return bits.join(", ");
}
export function durUnit(key) {
  const d = GEAR[key];
  if (d.tabs) return "tablets"; // purification tablets: dur counts the tablets in the tube (worm.js)
  if (d.slot === "weapon" || ARMOR_SLOTS.includes(d.slot)) return "fights";
  if (d.medKit) return "treatments";
  if (d.suppressor) return "shots";
  return "days";
}

// ---------- the base craft queue ----------
// Crafters: people on the Craft role here (patients in a hospital bed do not work).
export const crafters = (state, base) => atBase(state, base.id).filter((s) => s.role === "craft" && !s.inBed);
const qualified = (state, base, r) => crafters(state, base).filter((s) => skill(s, r.skill) >= r.min);

// Work-hours per hour on a recipe: each skilled crafter gives 1 + 3% per point of the recipe's skill.
export function craftRate(state, base, key) {
  const r = CRAFTS[key];
  return qualified(state, base, r).reduce((a, s) => a + (1 + skill(s, r.skill) * 0.03) * workFactor(s) * (hasPerk(s, "machinist") ? 1.3 : 1), 0); // the sick work less (health.js); Machinist (skills.js)
}

// Item condition from the best crafter's skill: 75% at 0, 100% at 20. Workshop recipes +10%.
export function craftQuality(skillLevel, r, field = false) {
  const q = 0.75 + skillLevel * 0.0125 + (r.needs ? WORKSHOP_QUALITY : 0) + (field ? FIELD_QUALITY : 0);
  return Math.round(Math.max(0.6, Math.min(1, q)) * 100) / 100;
}

export function canCraft(state, base, key) {
  const r = CRAFTS[key];
  if (!r) return { ok: false, reason: "Unknown recipe" };
  if (craftQueue(base).length >= MAX_CRAFT_QUEUE) return { ok: false, reason: `Queue is full (${MAX_CRAFT_QUEUE})` };
  if (!meetsNeeds(base, r)) return { ok: false, reason: `Needs ${needsText(r)} here` };
  if (!atBase(state, base.id).some((s) => skill(s, r.skill) >= r.min)) return { ok: false, reason: `Needs a ${SKILL_NAMES[r.skill]} ${r.min}+ survivor here` };
  for (const [k, v] of Object.entries(r.in)) if (stockHas(base.stock, k) < v) return { ok: false, reason: `Needs ${v} ${k} (have ${Math.floor(stockHas(base.stock, k))})` };
  for (const [k, v] of Object.entries(r.gearIn || {})) if (base.armory.filter((it) => it && it.key === k).length < v) return { ok: false, reason: `Needs ${v > 1 ? `${v} × ` : "a "}${GEAR[k].name} in the armory` };
  const lock = craftLock(state, key); // blueprints.js: advanced recipes need a studied blueprint
  if (lock) return { ok: false, reason: lock, locked: true };
  return { ok: true };
}

// What a recipe uses, for the screens: "1 scrap, 1 fuel, a Empty bottle".
export function craftInText(r) {
  return [...Object.entries(r.in).map(([k, v]) => `${v} ${k}`), ...Object.entries(r.gearIn || {}).map(([k, v]) => `${v > 1 ? `${v} × ` : ""}${GEAR[k].name.toLowerCase()}`)].join(", ");
}

export function queueCraft(state, base, key) {
  const chk = canCraft(state, base, key);
  if (!chk.ok) return chk.reason;
  const r = CRAFTS[key];
  for (const [k, v] of Object.entries(r.in)) useStock(base.stock, k, v);
  const taken = [];
  for (const [k, v] of Object.entries(r.gearIn || {})) for (let i = 0; i < v; i++) taken.push(...base.armory.splice(base.armory.findIndex((it) => it && it.key === k), 1));
  craftQueue(base).push({ id: newId(), recipe: key, progress: 0, hours: r.hours, ...(taken.length ? { gearTaken: taken } : {}) });
  const note = crafters(state, base).length ? "" : " Nobody is on the Craft role yet.";
  return `${craftName(key)} queued at ${base.name}.${note}`;
}

// Cancelling an untouched job refunds everything; a started one gives half back, rounded up (like construction).
// Items it was to use (gearIn) always go back to the armory.
export function cancelCraft(state, base, id) {
  const q = craftQueue(base);
  const job = q.find((c) => c.id === id);
  if (!job) return "That job is gone.";
  const full = job.progress <= 0;
  for (const [k, v] of Object.entries(CRAFTS[job.recipe].in)) { const key = k === "water" ? RAW : k; base.stock[key] = (base.stock[key] || 0) + (full ? v : Math.ceil(v / 2)); } // water comes back un-purified
  if (job.gearTaken) base.armory.push(...job.gearTaken);
  q.splice(q.indexOf(job), 1);
  return `Cancelled ${craftName(job.recipe)}. ${full ? "All" : "Half"} the materials were returned.`;
}

// A job held back this hour (job.held = the hour): work priorities leave the governor's or a steward's water filter
// queued while the tanks are full enough and a build is queued (work.js holdFilters); the crafters work the jobs behind it.
export const craftHeld = (state, job) => job.held != null && state.hour - job.held <= 1;
// Why a job is not moving (empty string when it is).
export function craftJobStatus(state, base, job) {
  const r = CRAFTS[job.recipe];
  if (craftHeld(state, job)) return "Waits: the tanks are full enough and a build is queued (a filter clogs up day by day, needed or not)";
  if (!crafters(state, base).length) return "No crafters. Set someone's role to Craft.";
  if (!meetsNeeds(base, r)) return `Needs ${needsText(r)} here`;
  if (!qualified(state, base, r).length) return `No crafter with ${SKILL_NAMES[r.skill]} ${r.min}+`;
  // A craft order's minimum quality (production.js): only a crafter who reaches it works the job.
  if (job.minQ && r.gear) {
    const q = craftQuality(Math.max(0, ...qualified(state, base, r).map((s) => skill(s, r.skill))), r);
    if (q + 1e-9 < job.minQ) return `No crafter good enough for ${Math.round(job.minQ * 100)}% (best ${Math.round(q * 100)}%)`;
  }
  return "";
}

// Hourly: crafters work the first job in the queue they can do (blocked jobs are skipped, not lost).
export function craftingHour(state) {
  for (const base of state.bases) {
    const q = craftQueue(base);
    const job = q.find((j) => !craftJobStatus(state, base, j));
    if (!job) continue;
    job.progress += craftRate(state, base, job.recipe);
    if (job.progress < job.hours) continue;
    q.splice(q.indexOf(job), 1);
    const r = CRAFTS[job.recipe];
    if (r.supplies) {
      for (const [k, v] of Object.entries(r.supplies)) base.stock[k] = (base.stock[k] || 0) + v;
      log(state, `${craftName(job.recipe)} finished at ${base.name}.`, "good");
    } else {
      const best = Math.max(0, ...qualified(state, base, r).map((s) => skill(s, r.skill)));
      const item = makeItem(r.gear, craftQuality(best, r));
      if (item.dur && crafters(state, base).some((s) => hasPerk(s, "tinkerer"))) item.dur = Math.round(item.dur * 1.5); // Tinkerer (skills.js): lasts 50% longer
      base.armory.push(item);
      log(state, `${item.name} crafted at ${base.name} (condition ${Math.round(item.quality * 100)}%). It is in the armory.`, "good");
    }
  }
}

// ---------- items and durability ----------
export function makeItem(key, quality = 1) {
  const d = GEAR[key];
  const item = { key, name: d.name, quality };
  if (d.dur) item.dur = d.dur;
  if (d.slots) ensurePack(item); // a pack comes with empty pack slots
  return item;
}

// Uses left (null = does not wear). Items made before durability (loot, older code) start full.
export function itemDur(item) {
  if (!item) return null;
  const d = GEAR[item.key];
  if (!d || !d.dur) return null;
  return item.dur != null ? item.dur : d.dur;
}

// Wears an item by n uses. Returns true when it broke.
function wear(item, n = 1) {
  const left = itemDur(item);
  if (left == null) return false;
  item.dur = Math.max(0, left - n);
  return item.dur <= 0;
}

// Wears what a survivor has in a slot; a broken item is gone.
export function wearSlot(state, s, slot, n = 1) {
  const item = s.gear[slot];
  if (!item || !wear(item, n)) return false;
  s.gear[slot] = null;
  log(state, `${s.name.split(" ")[0]}'s ${item.name} broke.`, "danger");
  return true;
}

// After a fight: makeshift weapons and every worn armor piece (body, head, arms, legs) lose one use.
export function wearAfterFight(state, people) {
  for (const s of people) {
    if (!s || !s.alive) continue;
    wearSlot(state, s, "weapon");
    for (const slot of ARMOR_SLOTS) wearSlot(state, s, slot);
  }
}

// A treatment with a kit that wears (the bandage kit) uses it up a little: at a base, in the field and in battle.
export function useMedKit(state, s) {
  if (s && s.alive && s.gear.tool && GEAR[s.gear.tool.key] && GEAR[s.gear.tool.key].medKit) wearSlot(state, s, "tool");
}

// Medicine bonus from the kit in the off hand (GEAR[key].medKit): +2 for a bandage kit, +4 for a surgical kit.
// The usual skill-gap rule applies (world.gearEffect): a surgical kit needs Medicine 10 for the full bonus,
// gives less below that and nothing below 3. One rule for treating at a base, in the field and in battle.
export function medKitBonus(s) {
  const t = s && s.gear && s.gear.tool;
  const d = t && GEAR[t.key];
  if (!d || !d.medKit) return 0;
  const eff = gearEffect(s, t);
  return eff.usable ? Math.round(d.medKit * eff.mult * 10) / 10 : 0;
}

// Skill bonus a tool gives for base work (crowbar: Scavenging).
export function toolBonus(s, skillKey) {
  const t = s.gear.tool;
  if (!t) return 0;
  const b = GEAR[t.key].bonus;
  return (b && b[skillKey]) || 0;
}

// Daily: water filters make water at their base (in the armory or worn by someone there) and wear out;
// tools used for base work (crowbar while scavenging) wear by a day.
export function craftingDaily(state) {
  for (const base of state.bases) {
    const people = atBase(state, base.id);
    let water = 0;
    for (const item of [...base.armory]) {
      const w = GEAR[item.key].water;
      if (!w) continue;
      water += w;
      if (wear(item)) {
        base.armory.splice(base.armory.indexOf(item), 1);
        log(state, `The ${item.name} at ${base.name} clogged up for good.`, "danger");
      }
    }
    for (const s of people) {
      const t = s.gear.tool;
      if (!t) continue;
      const d = GEAR[t.key];
      if (d.water) { water += d.water; wearSlot(state, s, "tool"); }
      else if (d.bonus && d.bonus.scavenging && s.role === "scavenge" && !s.inBed) wearSlot(state, s, "tool");
    }
    if (water) base.stock.water = (base.stock.water || 0) + water;
  }
}

// ---------- field crafting (a team on the road) ----------
const partyHas = (p, k) => (k === "water" ? teamWaterIn(p) : Math.max(0, p.supplies[k] || 0) + Math.max(0, (p.cargo && p.cargo.supplies[k]) || 0));
function partyTake(p, k, qty) {
  if (k === "water") { takeTeamWater(p, qty, { rawFirst: true }); return; } // boiled in the work: un-purified first (water.js)
  const fromCargo = Math.min(qty, Math.max(0, (p.cargo && p.cargo.supplies[k]) || 0));
  if (fromCargo) p.cargo.supplies[k] -= fromCargo;
  p.supplies[k] = (p.supplies[k] || 0) - (qty - fromCargo);
}

// Simple recipes a team can make from what it carries. Each: { key, name, ok, reason, in, hours, skill, min, out }.
// hours is how long the work would take; fieldCraft does not move the clock (an order can add the wait).
export function fieldCraftOptions(state, party) {
  const members = party ? partyMembers(state, party) : [];
  return Object.entries(CRAFTS).filter(([, r]) => r.field).map(([key, r]) => {
    const best = Math.max(0, ...members.map((s) => skill(s, r.skill)));
    let reason = "";
    if (!members.length) reason = "Nobody on this team.";
    else if (best < r.min) reason = `Needs ${SKILL_NAMES[r.skill]} ${r.min}+ on the team`;
    else {
      const miss = Object.entries(r.in).find(([k, v]) => partyHas(party, k) < v);
      if (miss) reason = `Needs ${miss[1]} ${miss[0]}; the team carries ${Math.floor(partyHas(party, miss[0]))}`;
      const missG = Object.entries(r.gearIn || {}).find(([k, v]) => partyItems(state, party).filter((x) => x.it.key === k).length < v);
      if (!reason && missG) reason = `Needs ${missG[1] > 1 ? `${missG[1]} × ` : "a "}${GEAR[missG[0]].name.toLowerCase()} with the team`;
    }
    return { key, name: craftName(key), ok: !reason, reason, in: { ...r.in }, gearIn: { ...(r.gearIn || {}) }, inText: craftInText(r), hours: r.hours, skill: r.skill, min: r.min, out: craftOutputText(key) };
  });
}

// Items a team has: in its cargo and on its people (pockets, hands, pack). [{ it, take() }]
function partyItems(state, party) {
  const out = [];
  const cargo = (party.cargo && party.cargo.gear) || [];
  for (const it of cargo) out.push({ it, take: () => cargo.splice(cargo.indexOf(it), 1) });
  for (const s of partyMembers(state, party)) {
    for (const [k, it] of Object.entries(s.gear || {})) if (it) out.push({ it, take: () => { s.gear[k] = null; } });
    (s.pockets || []).forEach((it, i) => { if (it) out.push({ it, take: () => { s.pockets[i] = null; } }); });
    const pk = s.gear && s.gear.backpack && s.gear.backpack.contents;
    (pk || []).forEach((it, i) => { if (it) out.push({ it, take: () => { pk[i] = null; } }); });
  }
  return out;
}

// Makes one field recipe from the team's supplies. Gear goes to a member with that slot free, else into the cargo.
export function fieldCraft(state, party, recipeKey) {
  const opt = fieldCraftOptions(state, party).find((o) => o.key === recipeKey);
  if (!opt) return "The team cannot make that in the field.";
  if (!opt.ok) return opt.reason;
  const r = CRAFTS[recipeKey];
  // An item nobody can wear needs room in the cargo (parties.js addGearToCargo); checked before materials are used.
  const worn = !r.supplies && EQUIP_SLOTS.includes(GEAR[r.gear].slot);
  const roomOn = (s) => (worn ? !s.gear[GEAR[r.gear].slot] : (GEAR[r.gear].small && (s.pockets || []).includes(null)) || (!GEAR[r.gear].bulky && (packOf(s) || []).includes(null)));
  if (!r.supplies && !partyMembers(state, party).some(roomOn)) {
    const probe = makeItem(r.gear, 1);
    if (!addGearToCargo(state, party, probe)) return `No free ${SLOT_NAMES[GEAR[r.gear].slot] || "slot"} on anyone and no room in the cargo for a ${probe.name}: not made.`;
    party.cargo.gear.splice(party.cargo.gear.indexOf(probe), 1);
  }
  for (const [k, v] of Object.entries(r.in)) partyTake(party, k, v);
  for (const [k, v] of Object.entries(r.gearIn || {})) for (let i = 0; i < v; i++) { const x = partyItems(state, party).find((y) => y.it.key === k); if (x) x.take(); }
  const members = partyMembers(state, party);
  const maker = members.reduce((a, s) => (skill(s, r.skill) > skill(a, r.skill) ? s : a), members[0]);
  const who = maker.name.split(" ")[0];
  if (r.supplies) {
    for (const [k, v] of Object.entries(r.supplies)) party.supplies[k] = (party.supplies[k] || 0) + v;
    return `${who} makes ${craftName(recipeKey).toLowerCase()} (${opt.out}) in about ${r.hours} hours.`;
  }
  const item = makeItem(r.gear, craftQuality(skill(maker, r.skill), r, true));
  const slot = GEAR[r.gear].slot;
  // Worn kit to a free slot; small things (throwables, camp kit) to a pocket or a pack (they are not worn).
  if (!EQUIP_SLOTS.includes(slot)) {
    for (const s of members) {
      const at = stow(s, item);
      if (at) return `${who} makes a ${item.name} in about ${r.hours} hours; ${s.name.split(" ")[0]} keeps it (${at.includes(":pocket:") ? "pocket" : "pack"}).`;
    }
  }
  const taker = EQUIP_SLOTS.includes(slot) ? members.find((s) => !s.gear[slot]) : null;
  if (taker) {
    taker.gear[slot] = item;
    return `${who} makes a ${item.name} in about ${r.hours} hours; ${taker.name.split(" ")[0]} takes it (${slot}).`;
  }
  party.cargo = party.cargo || { supplies: {}, gear: [] };
  party.cargo.gear.push(item);
  return `${who} makes a ${item.name} in about ${r.hours} hours. It goes in the cargo.`;
}

