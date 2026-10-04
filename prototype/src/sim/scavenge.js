// Abstract extraction raid: search hour by hour while Heat rises, then extract.
import { LOCATIONS, GEAR, SUPPLIES, siteDanger as locDanger } from "./data.js";
import { log, hurt, isNight, combatPower, gearEffect, factionById } from "./world.js";
import {
  partyMembers, bestSkill, carryCapacity, partyCapacity, cargoLoad, supplyLoad, unitsThatFit, awaitOrders, tileLabel, wipeParty,
  wipeIfEmpty, leaveVehicle, addGearToCargo,
} from "./parties.js";
import { attitude, changeGoodwill } from "./factions.js";
import { startCombat, registerCombatHandler } from "./combat.js";
import { zombieToughness } from "./hives.js";
import { tickHour } from "./world.js";
import { searchHazards } from "./health.js";

export const APPROACHES = {
  sneak:  { name: "Sneak",  loot: 0.7, heat: 7,  desc: "Slow and quiet. Stealth lowers Heat further." },
  normal: { name: "Normal", loot: 1.0, heat: 13, desc: "Balanced." },
  loud:   { name: "Loud",   loot: 1.4, heat: 22, desc: "Kick doors, use guns. Fast loot, Heat climbs quickly, uses ammo." },
};

export const HEAT_STAGES = [
  { name: "Quiet",    min: 0,  fight: 0.05, desc: "Scattered dead, easy stealth" },
  { name: "Stirring", min: 25, fight: 0.15, desc: "More wanderers moving toward noise" },
  { name: "Swarming", min: 50, fight: 0.35, desc: "Hordes converge; exits get harder" },
  { name: "Overrun",  min: 75, fight: 0.6,  desc: "Only a hard extraction is left" },
];
export const heatStage = (heat) => [...HEAT_STAGES].reverse().find((s) => heat >= s.min);
// Extra dead at a site (data.js siteDanger): quiet countryside 0, towns 1, city blocks 2, hospitals, prisons and
// military bases 3. Open ground counts as 0.
const siteDanger = (t) => locDanger(t.loc);

// Who is at a site: the dead (more where infection is high) and, depending on who holds the
// land, guards, patrols or rival scavengers.
export function raidEnemies(state, tileId) {
  const rng = state.rng;
  const t = state.tiles[tileId];
  const groups = [];
  const inf = t.infection || 0;
  // A hive's land (hives.js): more of the dead and tougher (+1 power), and on the red-skull ring around a hive +3.
  const hz = zombieToughness(state, tileId);
  const z = Math.round(1 + inf * 5 + (t.terrain === "city" ? 1 : 0) + siteDanger(t) + (hz ? 2 : 0) + rng.int(-1, 1));
  if (z > 0) groups.push({ kind: "zombies", count: Math.max(1, Math.min(14, z)), power: 2 + inf * 3 + hz, name: hz >= 3 ? "the hive's dead" : "the dead" });
  const baseOwner = state.factions.find((f) => f.alive && f.bases.includes(tileId));
  const owner = typeof t.owner === "number" ? factionById(state, t.owner) : null;
  const kindOf = (f) => (f.type === "military" ? "soldiers" : f.type === "zealot" ? "zealots" : "raiders");
  if (baseOwner) {
    groups.push({ kind: kindOf(baseOwner), count: Math.max(3, Math.min(7, Math.round(baseOwner.pop / 6))), power: 4 + baseOwner.pop / 15, name: `${baseOwner.name} guards`, factionId: baseOwner.id, guard: true });
  } else if (owner && attitude(owner) === "Hostile" && rng.chance(0.4)) {
    groups.push({ kind: kindOf(owner), count: rng.int(2, 3), power: 4, name: `${owner.name} patrol`, factionId: owner.id, guard: true });
  } else if (rng.chance(0.15)) {
    groups.push({ kind: "raiders", count: 2, power: 3.5, name: "rival scavengers", guard: true });
  }
  return groups;
}

// Registered as this module loads (not on the first raid), so a raid finishes correctly however it was started.
registerCombatHandler("scavenge", afterRaid);

// A search another team is still running (the abstract search has one slot, state.engagement).
export function searchBusy(state, p) {
  const e = state.engagement;
  return !!(e && !e.done && e.partyId !== p.id && state.parties.some((q) => q.id === e.partyId && partyMembers(state, q).length));
}

// Returns false when the search could not start because another team's search is still running.
export function startScavenge(state, p) {
  const t = state.tiles[p.dest];
  const owner = typeof t.owner === "number" ? factionById(state, t.owner) : null;
  // In the browser, scavenging is an interactive raid on a generated map.
  if (!state.autoCombat && typeof window !== "undefined") {
    const groups = raidEnemies(state, p.dest);
    const total = groups.reduce((a, g) => a + g.count, 0);
    const names = groups.map((g) => g.name).join(" and ");
    startCombat(state, {
      mode: "raid", tile: p.dest, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge",
      enemy: { kind: groups.length > 1 ? "mixed" : groups[0]?.kind || "zombies", count: total, power: 3, name: names || "nobody", groups },
      raid: { heat0: isNight(state) ? 0 : 5 },
      context: { factionIds: groups.filter((g) => g.factionId).map((g) => g.factionId) },
    });
    return true;
  }
  // The one search slot is never overwritten while another team is using it (the caller makes this team wait).
  if (searchBusy(state, p)) return false;
  state.engagement = {
    partyId: p.id, tile: p.dest, heat: isNight(state) ? 0 : 5, hours: 0, approach: null,
    log: [`The team reaches ${tileLabel(state, p.dest)}. ${t.loc ? LOCATIONS[t.loc.type].name + "." : ""} Infection here: ${Math.round(t.infection * 100)}%.`],
    found: { supplies: {}, gear: [] }, done: false,
    guarded: owner && attitude(owner) === "Hostile" && owner.bases.includes(p.dest) ? owner.id : null,
  };
  if (state.engagement.guarded) state.engagement.log.push(`${owner.name} hold this place. Expect armed guards.`);
  return true;
}

// After the raid: time passes on the shared clock, the site is picked over, the vehicle may stay behind.
export function afterRaid(state, result, setup) {
  const p = state.parties.find((x) => x.id === setup.partyId);
  const t = state.tiles[setup.tile];
  const r = result.raid || { hours: 1, searched: 0, total: 0 };
  t.loot = Math.max(0.03, t.loot - 0.07 * r.searched);
  // Guards who saw you, or died, hold it against you.
  if (r.alerted) for (const id of setup.context.factionIds || []) {
    const f = factionById(state, id);
    if (f) changeGoodwill(state, f, -10, "you raided their land");
  }
  const loot = [...Object.entries(result.loot.supplies).map(([k, v]) => `${v} ${k}`), ...result.loot.gear.map((g) => g.name)];
  log(state, `Raid at ${tileLabel(state, setup.tile)}: ${result.outcome === "extracted" ? `got out with ${loot.join(", ") || "nothing"}` : "nobody made it out"} (${r.searched}/${r.total} searched, ${r.hours}h).`, result.outcome === "extracted" ? "good" : "death");
  if (!p || !state.parties.includes(p)) return;
  if (!partyMembers(state, p).length) {
    wipeParty(state, p);
    return;
  }
  if (r.hadVehicle && !r.vehicleKept && p.vehicle) {
    log(state, `The vehicle was left at ${tileLabel(state, setup.tile)}.`, "danger");
    leaveVehicle(state, p, setup.tile, "left at the raid site"); // cargo the people cannot carry stays in it (logged)
  }
  // Cuts and fevers from the hours spent searching (health.js), as in the hour-by-hour search.
  for (let i = 0; i < (r.hours || 1); i++) searchHazards(state, partyMembers(state, p), tileLabel(state, setup.tile));
  // The raid took time; the world moved on meanwhile.
  for (let i = 0; i < r.hours && state.parties.includes(p); i++) tickHour(state);
  if (state.parties.includes(p)) awaitOrders(state, p, `The team is out of ${tileLabel(state, setup.tile)}${loot.length ? ` with ${loot.join(", ")}` : ""}.`);
}

export function engagementParty(state) {
  return state.engagement && state.parties.find((p) => p.id === state.engagement.partyId);
}

export function searchHour(state) {
  const e = state.engagement;
  const p = engagementParty(state);
  if (!e || !p || e.done) return;
  const rng = state.rng;
  const t = state.tiles[e.tile];
  const ap = APPROACHES[e.approach];
  const members = partyMembers(state, p);
  if (!members.length) {
    // Nobody left to search (lost between two search hours): the team ends as a wiped team.
    wipeIfEmpty(state, p);
    e.done = true;
    e.log.push("The whole team is dead.");
    return;
  }
  e.hours += 1; // the caller advances the shared clock by one hour per search

  // Loot.
  const scav = bestSkill(state, p, "scavenging");
  const table = t.loc ? LOCATIONS[t.loc.type].loot : { scrap: 2, food: 1 };
  const finds = [];
  const rolls = 1 + (ap.loot > 1 ? 1 : 0);
  for (let i = 0; i < rolls; i++) {
    const key = rng.weighted(Object.keys(table), (k) => table[k]);
    const qty = Math.round(rng.range(4, 9) * t.loot * ap.loot * (1 + scav / 15) * (key === "ammo" ? 6 : key === "scrap" ? 2.5 : key === "fuel" ? 0.7 : key === "jars" ? 2 : 1)); // fuel is scarce; ruins are full of scrap (expeditions are the source now); jars come by the box
    if (qty > 0) {
      e.found.supplies[key] = (e.found.supplies[key] || 0) + qty;
      finds.push(`${qty} ${key}`);
    }
  }
  const gearList = t.loc ? LOCATIONS[t.loc.type].gear : [];
  if (gearList.length && rng.chance(0.07 * t.loot * (1 + scav / 15) * ap.loot)) {
    const g = rng.pick(gearList);
    e.found.gear.push({ key: g, name: GEAR[g].name, quality: 1 });
    finds.push(GEAR[g].name);
  }
  t.loot = Math.max(0.03, t.loot - 0.05 * ap.loot);

  // Heat.
  let heat = ap.heat * (0.6 + 0.6 * t.infection);
  if (e.approach === "sneak") heat -= bestSkill(state, p, "stealth") * 0.3;
  if (isNight(state)) heat -= 2;
  e.heat = Math.min(100, e.heat + Math.max(2, heat));
  const stage = heatStage(e.heat);

  // Encounters.
  let line = finds.length ? `Found ${finds.join(", ")}.` : "Nothing useful this hour.";
  if (rng.chance(stage.fight + (e.guarded ? 0.15 : 0))) {
    const threat = HEAT_STAGES.indexOf(stage) * 3 + t.infection * 6 + (siteDanger(t) - 1) * 1.5 + (e.guarded ? 8 : 0);
    const ammoUse = e.approach === "loud" ? members.length * 6 : members.length * 2;
    p.supplies.ammo = Math.max(0, (p.supplies.ammo || 0) - ammoUse);
    const power = members.reduce((a, m) => a + combatPower(m), 0) * ((p.supplies.ammo || 0) > 0 ? 1 : 0.6);
    if (power * rng.range(0.6, 1.4) > threat) {
      line += e.guarded ? " A guard patrol was taken down." : " The dead found you, and you put them down.";
      if (e.guarded) {
        const f = factionById(state, e.guarded);
        if (f) { f.pop = Math.max(0, f.pop - 1); changeGoodwill(state, f, -6, "you raided their base"); }
      }
    } else {
      const v = rng.pick(members);
      hurt(state, v, rng.int(15, 45), e.tile, `raiding ${tileLabel(state, e.tile)}`);
      line += v.alive ? ` ${v.name.split(" ")[0]} was hurt in a fight.` : ` ${v.name} was killed.`;
    }
    e.heat = Math.min(100, e.heat + 3);
    // Gear used below its skill can be damaged.
    for (const m of members) {
      const eff = gearEffect(m, m.gear.weapon);
      if (m.gear.weapon && eff.damageChance && rng.chance(eff.damageChance)) {
        m.gear.weapon.quality = Math.max(0.3, (m.gear.weapon.quality || 1) - 0.25);
        line += ` ${m.name.split(" ")[0]}'s ${m.gear.weapon.name} was damaged (used below skill).`;
      }
    }
  }
  e.log.push(`Hour ${e.hours} [${stage.name}]: ${line}`);
  searchHazards(state, partyMembers(state, p), tileLabel(state, e.tile)); // cuts and fevers while searching (health.js)
  if (!partyMembers(state, p).length) {
    // Everyone died; what they found stays with them.
    for (const [k, v] of Object.entries(e.found.supplies)) p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + v;
    p.cargo.gear.push(...e.found.gear);
    wipeParty(state, p);
    e.done = true;
    e.log.push("The whole team is dead.");
  }
  return line;
}

export function foundLoad(e) {
  return Math.round(supplyLoad(e.found.supplies) + e.found.gear.length * 3);
}

export function extract(state) {
  const e = state.engagement;
  const p = engagementParty(state);
  if (!e || !p) {
    state.engagement = null;
    return;
  }
  const rng = state.rng;
  const stage = heatStage(e.heat);
  const members = partyMembers(state, p);
  if (!members.length) {
    wipeIfEmpty(state, p);
    state.engagement = null;
    return;
  }
  // Hard extraction when overrun.
  if (stage.name === "Overrun" || stage.name === "Swarming") {
    const dc = stage.name === "Overrun" ? 12 : 8;
    const s = bestSkill(state, p, "stealth") + rng.int(1, 10);
    if (s < dc) {
      const v = rng.pick(members);
      hurt(state, v, rng.int(20, 60), e.tile, `extracting from ${tileLabel(state, e.tile)}`);
      e.log.push(v.alive ? `Extraction was rough. ${v.name.split(" ")[0]} was hurt.` : `${v.name} did not make it out.`);
    } else e.log.push("A clean extraction.");
  }
  const alive = partyMembers(state, p);
  if (!alive.length) {
    // What they had found stays with them.
    for (const [k, v] of Object.entries(e.found.supplies)) p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + v;
    p.cargo.gear.push(...e.found.gear);
    wipeParty(state, p);
    state.engagement = null;
    return;
  }
  // Load what fits; the cheapest goods are left behind first. Found items need carry space too
  // (the most valuable go in first); what does not fit is left at the site.
  const left = [];
  const gear = [...e.found.gear].sort((a, b) => (GEAR[b.key]?.value || 0) - (GEAR[a.key]?.value || 0));
  for (const g of gear) if (!addGearToCargo(state, p, g)) left.push(g.name);
  let room = partyCapacity(state, p) - cargoLoad(p.cargo);
  // Best value per unit of carry space goes in first.
  const keys = Object.keys(e.found.supplies).sort((a, b) => SUPPLIES[b].value / SUPPLIES[b].weight - SUPPLIES[a].value / SUPPLIES[a].weight);
  for (const k of keys) {
    const take = Math.min(unitsThatFit(room, k), e.found.supplies[k]);
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + take;
    room -= take * SUPPLIES[k].weight;
    if (take < e.found.supplies[k]) left.push(`${e.found.supplies[k] - take} ${k}`);
  }
  if (left.length) log(state, `No room to carry ${left.join(", ")}. It was left behind.`, "info");
  log(state, `Scavenging team extracted from ${tileLabel(state, e.tile)} after ${e.hours} hours.`, "info");
  state.engagement = null;
  awaitOrders(state, p, `Searched ${tileLabel(state, e.tile)} for ${e.hours} hours.`);
}
