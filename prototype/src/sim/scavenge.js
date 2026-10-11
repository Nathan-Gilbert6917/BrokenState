// Abstract extraction raid: search hour by hour while Heat rises, then extract.
import { addFoodFind, foodText, typeFind, siteMix } from "./foods.js"; // a food find: the items a place like this holds
import { keyWord } from "./water.js"; // supplies as words: "9mm FMJ", "rounds"
import { LOCATIONS, GEAR, SUPPLIES, siteDanger as locDanger, supValue, supWeight } from "./data.js";
import { log, hurt, isNight, combatPower, gearEffect, factionById, spendShots, armedFactor, arrowsBack } from "./world.js";
import {
  partyMembers, bestSkill, carryCapacity, partyCapacity, cargoLoad, cargoRoom, supplyLoad, unitsThatFit, awaitOrders, tileLabel, wipeParty,
  wipeIfEmpty, leaveVehicle, addGearToCargo,
} from "./parties.js";
import { attitude, changeGoodwill } from "./factions.js";
import { noteLooked } from "./discovery.js";
import { startCombat, registerCombatHandler } from "./combat.js";
import { zombieToughness } from "./hives.js";
import { tickHour } from "./world.js";
import { searchHazards } from "./health.js";
import { wormSearch } from "./worm.js"; // the worm: hands that handled the dead
import { anyPerk, rollBook, gainXpAll, USE } from "./skills.js";
import { noteSearch } from "./relations.js";
import { itemLoad, lootItem, armouredItem } from "./inventory.js";
import { gunMags } from "./carrykit.js"; // a found gun's spare magazines
import { siteSource } from "./itemcond.js";
import { foundFill } from "./gunrounds.js";
import { rollSiteGuns } from "./gunfinds.js"; // the arsenal of 2026-10-10 (its own dice)
import { swapGun } from "./gundist.js"; // the gun distribution: which gun a site's gear list yields
import { rollFind, rollHuntFind, rollLightFind, rollSiteWood, rollBuildmat, rollSiteArrows, rollGunmodFind, rollAnyModFind, sortParts, rollSiteGrenades, rollSiteLaunchers, rollSiteReload } from "./loot.js";
import { searchHeatMult } from "./fieldheat.js";
import { lockedSearchHour } from "./locks.js";
import { truckSearchHour, convoyHeat0, convoyThreat } from "./miltrucks.js"; // an Army convoy's guard: Heat from the start, a harder fight
import { gunSearchHour } from "./locks.js"; // gun safes, drills and grinders (their own dice)
import { siteDeadMix, bodyLoot, MILDEAD, maxMix } from "./deadsoldiers.js";
import { siteSpecials } from "./hivetech.js"; // the special dead met exploring
import { mixWeight } from "./zombietypes.js";
import { searchMeds } from "./medfinds.js";
import { ZTYPES } from "./hiveconst.js";
import { siteWanderers, siteEncounter, wanderersAfterRaid } from "./wanderers.js";
import { crawlTile, startCrawl } from "./citycrawl.js";
import { addFind, roundsText } from "./ammo.js"; // rounds by calibre

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
  // mix: the armoured dead here (deadsoldiers.js: soldiers at a National Guard base or an army wreck, riot police at a
  // police station), placed among them by share (combat.js createRaid, buildingmaps.js placeInterior).
  // The bred kinds too (hivetech.js siteSpecials): more in towns and cities as the years go by, and on a hive's land.
  const mix = maxMix(siteDeadMix(state, tileId), siteSpecials(state, tileId));
  if (z > 0) groups.push({ kind: "zombies", count: Math.max(1, Math.min(14, z)), power: 2 + inf * 3 + hz, name: hz >= 3 ? "the hive's dead" : mix && mix.soldier >= 0.3 ? "the dead soldiers" : "the dead", mix });
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
  // People on the move (wanderers.js, its own dice): armed survivors squatting here (enemies), survivors hiding and a
  // military squad clearing the place (side "neutral" / "military": a third side on the raid map, thirdside.js).
  groups.push(...siteWanderers(state, tileId));
  return groups;
}

// The special dead met searching hour by hour (hivetech.js siteSpecials): their extra weight, as the armoured dead's.
const specialThreat = (state, tile) => { const sp = siteSpecials(state, tile); return sp ? (mixWeight(sp) - 1) * MILDEAD.SEARCH_THREAT : 0; };

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
  // A crew's team (crews.js) searches hour by hour on its own, never in the shared slot or on a battle map: a job
  // on the spot that crews.js works and ends.
  if (p.crewRole != null) {
    p.phase = "task";
    p.task = { type: "crewsearch", hours: null, done: 0 };
    p.crewSearch = {
      partyId: p.id, tile: p.dest, heat: (isNight(state) ? 0 : 5) + convoyHeat0(state, p.dest), hours: 0, approach: null, log: [], found: { supplies: {}, gear: [] }, done: false,
      guarded: owner && attitude(owner) === "Hostile" && owner.bases.includes(p.dest) ? owner.id : null,
    };
    return true;
  }
  // In the browser, scavenging is an interactive raid on a generated map.
  if (!state.autoCombat && typeof window !== "undefined") {
    // A city (citycrawl.js): block by block instead of one raid, while you drive the team (not the autopilot).
    if (crawlTile(t) && p.owner === "player") return startCrawl(state, p);
    const groups = raidEnemies(state, p.dest);
    const foes = groups.filter((g) => !g.side); // a third side (wanderers.js) is not who you came to fight
    const total = foes.reduce((a, g) => a + g.count, 0);
    const names = foes.map((g) => g.name).join(" and ");
    startCombat(state, {
      mode: "raid", tile: p.dest, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge",
      enemy: { kind: foes.length > 1 ? "mixed" : foes[0]?.kind || "zombies", count: total, power: 3, name: names || "nobody", groups },
      raid: { heat0: isNight(state) ? 0 : 5, choose: true }, // choose: a site with several buildings offers them first (buildingmaps.js)
      context: { factionIds: foes.filter((g) => g.factionId).map((g) => g.factionId) },
    });
    return true;
  }
  // The one search slot is never overwritten while another team is using it (the caller makes this team wait).
  if (searchBusy(state, p)) return false;
  state.engagement = {
    partyId: p.id, tile: p.dest, heat: (isNight(state) ? 0 : 5) + convoyHeat0(state, p.dest), hours: 0, approach: null, // miltrucks.js: a guarded convoy starts hotter
    log: [`The team reaches ${tileLabel(state, p.dest)}. ${t.loc ? LOCATIONS[t.loc.type].name + "." : ""} Infection here: ${Math.round(t.infection * 100)}%.`],
    found: { supplies: {}, gear: [] }, done: false,
    guarded: owner && attitude(owner) === "Hostile" && owner.bases.includes(p.dest) ? owner.id : null,
  };
  if (state.engagement.guarded) state.engagement.log.push(`${owner.name} hold this place. Expect armed guards.`);
  siteEncounter(state, p, p.dest); // wanderers.js: survivors hiding here, squatters, a squad clearing it (its own dice)
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
  const loot = [...Object.entries(result.loot.supplies).map(([k, v]) => `${v} ${keyWord(k)}`), ...result.loot.gear.map((g) => g.name)];
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
  wormSearch(state, p, setup.tile, r.hours || 1); // worm.js: the eggs on what they handled, rolled tonight or at home
  wanderersAfterRaid(state, p, result, setup.tile); // wanderers.js: the survivors you found there can be talked to; the soldiers remember
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
  noteLooked(state, p, [e.tile]); // discovery.js: the site is searched (the map's Known area layer)

  // Loot.
  const scav = bestSkill(state, p, "scavenging");
  const perk = (id) => anyPerk(members, id); // skills.js: perks of anyone on the team
  const lootPerk = (k) => (perk("treasure") ? 1.2 : 1) * ((k === "parts" || k === "fuel") && perk("tinkerseye") ? 1.5 : 1); // Treasure Hunter, Tinker's Eye
  const table = t.loc ? LOCATIONS[t.loc.type].loot : { scrap: 2, food: 1 };
  const finds = [];
  const rolls = 1 + (ap.loot > 1 ? 1 : 0);
  for (let i = 0; i < rolls; i++) {
    const key = rng.weighted(Object.keys(table), (k) => table[k]);
    let qty = Math.round(rng.range(4, 9) * t.loot * ap.loot * (1 + scav / 15) * lootPerk(key) * (key === "ammo" ? 6 : key === "scrap" ? 2.5 : key === "fuel" ? 0.7 : key === "jars" ? 2 : 1)); // fuel is scarce; ruins are full of scrap (expeditions are the source now); jars come by the box
    if (key === "meds" && qty > 0) qty = searchMeds(t, qty); // medfinds.js: a box of them only at a pharmacy, clinic, hospital or medevac wreck
    if (qty > 0 && key === "ammo") {
      finds.push(roundsText(addFind(e.found.supplies, t.loc ? t.loc.type : "", qty, false, e.tile, e.hours, i))); // ammo.js: the rounds a place like this holds, by calibre, named
    } else if (qty > 0 && (key === "food" || key === "preserved")) {
      // foods.js: the food a place like this holds (cans, rice and MREs; bread only in the first days), as much as its
      // shelves still have (a shop runs down as it is looted and with the months: shopFood).
      const got = addFoodFind(state, e.found.supplies, t.loc ? t.loc.type : "", qty, { tile: e.tile, preserved: key === "preserved" });
      if (Object.keys(got).length) finds.push(foodText(got));
    } else if (qty > 0) {
      // Parts by kind (loot.js sortParts: an auto shop's are mostly car parts; their own dice).
      const got = key === "parts" && t.loc ? sortParts(state, t.loc.type, qty, `h${e.hours}:${i}`) : { [key]: qty };
      for (const [k, q] of Object.entries(got)) { e.found.supplies[k] = (e.found.supplies[k] || 0) + q; finds.push(`${q} ${keyWord(k)}`); }
    }
  }
  const gearList = t.loc ? LOCATIONS[t.loc.type].gear : [];
  if (gearList.length && rng.chance(0.07 * t.loot * (1 + scav / 15) * ap.loot * (perk("treasure") ? 2 : 1))) {
    const g = swapGun(`site:${t.loc.type}`, rng.pick(gearList), rng); // gundist.js: which gun, by the site's draws (a hash of the draw: no extra one)
    const found = foundFill(lootItem(g, siteSource(t.loc.type), rng), e.tile, e.hours, "scav"); // itemcond.js: a gun shop's stock used, a crash site's scorched; gunrounds.js: a few rounds in it now and then (its own dice)
    e.found.gear.push(found, ...gunMags(found, siteSource(t.loc.type), e.tile, e.hours)); // carrykit.js: a gun's spare magazines (own dice)
    finds.push(GEAR[g].name);
  }
  // A book on the shelves (skills.js; its own dice, so the rest of the search is unchanged). Treasure Hunter: twice as often.
  const book = rollBook(state, e.tile, (perk("treasure") ? 2 : 1) * ap.loot, `h${e.hours}`);
  if (book) { e.found.gear.push(book); finds.push(book.name); }
  // A small find: a valuable, a comfort, smokes, a throwable (loot.js SITE_FINDS; its own dice too).
  const small = rollFind(state, e.tile, (perk("treasure") ? 2 : 1) * ap.loot, `h${e.hours}`);
  if (small) { e.found.gear.push(small); finds.push(small.name); }
  const gearFind = rollHuntFind(state, e.tile, (perk("treasure") ? 2 : 1) * ap.loot, `h${e.hours}`); // snare wire, a rod, a net (loot.js HUNT_FINDS)
  if (gearFind) { e.found.gear.push(gearFind); finds.push(gearFind.name); }
  const lamp = rollLightFind(state, e.tile, (perk("treasure") ? 2 : 1) * ap.loot, `h${e.hours}`); // a headlamp, a lantern, a spotlight (loot.js LIGHT_FINDS; its own dice)
  if (lamp) { e.found.gear.push(lamp); finds.push(lamp.name); }
  const part = rollAnyModFind(state, e.tile, (perk("treasure") ? 2 : 1) * ap.loot, `h${e.hours}`); // a sight, a suppressor (loot.js GUNMOD_FINDS, then SITE_MODS; their own dice)
  if (part) { e.found.gear.push(part); finds.push(part.name); }
  const rel = rollSiteReload(state, e.tile, (perk("treasure") ? 2 : 1) * ap.loot, `h${e.hours}`); // a bag of brass, a can of powder, a box of primers (loot.js SITE_RELOAD; its own dice)
  if (rel) { e.found.gear.push(rel); finds.push(rel.name); }
  const gren = rollSiteGrenades(state, e.tile, (perk("treasure") ? 2 : 1) * ap.loot, `h${e.hours}`); // flashbangs, smoke grenades (loot.js SITE_GRENADES; its own dice)
  if (gren.length) { e.found.gear.push(...gren); finds.push(gren.length > 1 ? `${gren.length} ${gren[0].key === "flashbang" ? "flashbangs" : "smoke grenades"}` : gren[0].name); }
  const gl = rollSiteLaunchers(state, e.tile, (perk("treasure") ? 2 : 1) * ap.loot, `h${e.hours}`); // grenade launchers, rocket tubes, 40 mm (loot.js SITE_LAUNCHERS; its own dice)
  if (gl.length) { e.found.gear.push(...gl); finds.push(gl.length > 1 ? `${gl.length} × ${gl[0].name}` : gl[0].name); }
  const ag = rollSiteGuns(state, e.tile, (perk("treasure") ? 2 : 1) * ap.loot, `h${e.hours}`); // an over-under, a battle rifle (gunfinds.js GUN_FINDS; its own dice)
  if (ag.length) { e.found.gear.push(...ag); finds.push(ag[0].name); }
  const wood = rollSiteWood(state, e.tile, ap.loot, `h${e.hours}`); // a woodpile, a log basket (loot.js SITE_WOOD; its own dice)
  if (wood > 0) { e.found.supplies.wood = (e.found.supplies.wood || 0) + wood; finds.push(`${wood} wood`); }
  const bm = rollBuildmat(state, e.tile, ap.loot * (1 + scav / 30), `h${e.hours}`); // lumber, blocks, sheet metal (loot.js BUILDMAT_FINDS; its own dice)
  if (bm > 0) { e.found.supplies.buildmat = (e.found.supplies.buildmat || 0) + bm; finds.push(`${bm} building materials`); }
  const arrows = rollSiteArrows(state, e.tile, ap.loot, `h${e.hours}`); // a quiver, a box of bolts (loot.js SITE_ARROWS; its own dice)
  if (arrows > 0) { e.found.supplies.arrows = (e.found.supplies.arrows || 0) + arrows; finds.push(`${arrows} arrows`); }
  // Locked things, keys and blueprints (locks.js; its own dice): adds finds and Heat.
  const locked = lockedSearchHour(state, e, p, members) + truckSearchHour(state, e, p, members) + gunSearchHour(state, e, p, members); // miltrucks.js: an Army truck's cargo (its own dice)
  t.loot = Math.max(0.03, t.loot - 0.05 * ap.loot * (perk("salvager") ? 0.6 : 1)); // Salvager: picked over 40% slower

  // Heat.
  let heat = ap.heat * (0.6 + 0.6 * t.infection);
  if (e.approach === "sneak") heat -= bestSkill(state, p, "stealth") * 0.3;
  if (isNight(state)) heat -= 2;
  const kit = searchHeatMult(state, p); // fieldheat.js: ghillie wrap, rag-wrapped boots, a scent mask, a hiking pack
  if (kit.mult !== 1) heat *= kit.mult;
  e.heat = Math.min(100, e.heat + (perk("quiethands") ? Math.max(1, heat * 0.5) : Math.max(2 * Math.min(1, kit.mult), heat))); // Quiet Hands: half the Heat
  const stage = heatStage(e.heat);

  // Encounters.
  let line = (finds.length ? `Found ${finds.join(", ")}.` : "Nothing useful this hour.") + locked;
  if (rng.chance((stage.fight + (e.guarded ? 0.15 : 0)) * (perk("sixthsense") ? 0.7 : 1))) { // Sixth Sense: 30% less trouble
    // The armoured dead (deadsoldiers.js) make a military site's fights harder, and their bodies pay for it.
    const mil = siteDeadMix(state, e.tile);
    const threat = HEAT_STAGES.indexOf(stage) * 3 + t.infection * 6 + (siteDanger(t) - 1) * 1.5 + (e.guarded ? 8 : 0) + (mil ? (mixWeight(mil) - 1) * MILDEAD.SEARCH_THREAT : 0) + specialThreat(state, e.tile) + convoyThreat(state, e.tile); // miltrucks.js CONVOY_GUARD: the convoy's guard
    // The shots: a bow's in arrows, everyone else's in ammo (world.js spendShots); short of either, those count 60%.
    const shot = spendShots(p.supplies, members, e.approach === "loud" ? 6 : 2);
    const power = members.reduce((a, m) => a + combatPower(m), 0) * armedFactor(members, p.supplies, p.supplies.arrows || 0, { need: () => 1 });
    if (power * rng.range(0.6, 1.4) > threat) {
      line += e.guarded ? " A guard patrol was taken down." : " The dead found you, and you put them down.";
      const back = arrowsBack(shot.arrows); // won: about half the arrows are picked up again
      if (back) p.supplies.arrows = (p.supplies.arrows || 0) + back;
      const kind = !e.guarded && mil ? ["soldier", "riot"].find((k) => mil[k] > 0) : null;
      if (kind && rng.chance(Math.min(0.8, mil[kind] * MILDEAD.SEARCH_BODY))) { // one of them was a soldier: his kit
        const loot = bodyLoot(rng, kind, armouredItem);
        const got = [];
        for (const [k, v] of Object.entries(loot.sup)) { e.found.supplies[k] = (e.found.supplies[k] || 0) + v; got.push(`${v} ${keyWord(k)}`); }
        for (const g of loot.gear) { e.found.gear.push(g); got.push(g.name); }
        if (got.length) line += ` Off a ${ZTYPES[kind].name.toLowerCase()}'s body: ${got.join(", ")}.`;
      }
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
  typeFound(state, e); // foods.js: any "food" a locked cabinet, a truck or a cache added this hour, as items
  e.log.push(`Hour ${e.hours} [${stage.name}]: ${line}`);
  gainXpAll(state, partyMembers(state, p), "scavenging", USE.searchHour); // skills.js
  gainXpAll(state, partyMembers(state, p), "stealth", e.approach === "sneak" ? USE.sneakSearch : USE.searchStealth); // moving quietly through the ruins; more sneaking
  searchHazards(state, partyMembers(state, p), tileLabel(state, e.tile)); // cuts and fevers while searching (health.js)
  wormSearch(state, p, e.tile, 1); // worm.js: the eggs on what they handled, rolled tonight or at home
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
  return Math.round(supplyLoad(e.found.supplies) + e.found.gear.reduce((a, g) => a + itemLoad(g), 0));
}

// What the search turned up, its food as the items the site holds (foods.js typeFind: locks.js, miltrucks.js and the
// caches add "food" in days).
function typeFound(state, e) {
  if (!e || !e.found || !e.found.supplies) return;
  const t = state.tiles[e.tile];
  typeFind(state, e.found.supplies, siteMix(t && t.loc ? t.loc.type : ""), e.tile);
}
export function extract(state) {
  const e = state.engagement;
  typeFound(state, e);
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
    if (s < dc && !anyPerk(members, "phantom")) { // Phantom (skills.js): hard extractions never hurt the team
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
  // (the most valuable go in first); what does not fit is left at the site. Heavy, cheap things (under 2 a kg:
  // sandbags, barbed wire, bear traps) only go in after the supplies.
  const left = [];
  const perKg = (g) => (GEAR[g.key]?.value || 0) / Math.max(0.1, itemLoad(g));
  const gear = [...e.found.gear].sort((a, b) => (GEAR[b.key]?.value || 0) - (GEAR[a.key]?.value || 0));
  for (const g of gear) if (perKg(g) >= 2 && !addGearToCargo(state, p, g)) left.push(g.name);
  let room = cargoRoom(state, p);
  // Best value per unit of carry space goes in first.
  const keys = Object.keys(e.found.supplies).sort((a, b) => supValue(b) / supWeight(b) - supValue(a) / supWeight(a));
  for (const k of keys) {
    const take = Math.min(unitsThatFit(room, k), e.found.supplies[k]);
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + take;
    room -= take * supWeight(k);
    if (take < e.found.supplies[k]) left.push(`${e.found.supplies[k] - take} ${keyWord(k)}`);
  }
  for (const g of gear) if (perKg(g) < 2 && !addGearToCargo(state, p, g)) left.push(g.name);
  if (left.length) log(state, `No room to carry ${left.join(", ")}. It was left behind.`, "info");
  log(state, `Scavenging team extracted from ${tileLabel(state, e.tile)} after ${e.hours} hours.`, "info");
  noteSearch(state, alive); // relations.js: sites searched (service record)
  state.engagement = null;
  awaitOrders(state, p, `Searched ${tileLabel(state, e.tile)} for ${e.hours} hours.`);
}
