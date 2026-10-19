// Travel events: choice cards rolled per tile, and the escort table for trade-route convoys.
import { typedFood, addFood, unitsOf } from "./foods.js"; // food found on the road, by type
import { TERRAIN, GEAR, LOCATIONS } from "./data.js";
import { log, hub, skill, hurt, isNight, factionById, snapshot, makeSurvivor, newId, day, combatPower, armedFactor, arrowsBack, archerCount } from "./world.js";
import {
  partyMembers, bestSkill, partyTile, STANCES, tileLabel, partyCapacity, cargoLoad, cargoRoom, unitsThatFit, partySpeed,
  carried, takeSupply, takeShots, addGearToCargo, leaveVehicle, startReturn, wipeIfEmpty, cardStale,
} from "./parties.js";
import { markRepair } from "./repairwait.js"; // a repair's wait on the road: told when it is over
import { partyFuel, useFuel, partyVehicle, partyVehicles, breakdownRoll, seatsOf, fleetOf, isBike, carPartsCost } from "./vehicles.js";
import { attitude, changeGoodwill, isAggressiveType } from "./factions.js";
import { rollConflict } from "./conflicts.js";
import { rollWanderer } from "./wanderers.js";
import { hiveAt, zombieToughness, BOSS_NAMES } from "./hives.js";
import { growthsOf } from "./hivetech.js";
import { GROWTHS, ZTYPES, BEASTS } from "./hiveconst.js";
import { beastMix } from "./deadbeasts.js"; // the dead beasts of the hills, the woods and the farmland
import { LONE, stragglerFits, stragglerCard } from "./loneattack.js"; // one of the team attacked alone on the road
import { mixWeight, mixText } from "./zombietypes.js";
import { hordeScore, reduceHorde } from "./hordes.js";
import { travelEffects, weatherAt, season } from "./weather.js";
import { makeCandidate, recruitCard } from "./recruits.js";
import { argumentWeight, argumentPair, relEvent, hasFriendsOnTeam, campfireCard } from "./relations.js";
import { lootItem } from "./inventory.js";
import { spend } from "./itemcond.js"; // the condition of what is found
import { teamPolicy, wantsOut, breakOff, RETREAT_POLICIES } from "./breakoff.js";
import { totalRounds, spendAmmo } from "./rounds.js"; // rounds by calibre
import { calRounds, partyCals, roundsText } from "./ammo.js"; // a find of rounds named by calibre
import { swapGun } from "./gundist.js"; // the gun distribution: a crashed Humvee's gun
import { marchingNow, NIGHT_MARCH } from "./nightmarch.js"; // pushing on through the night: more trouble on the road
import { isHardcore } from "./hardcore.js"; // hardcore's year Calder falls: road cards of its own (HC_EVENTS)
import { hardcoreEraOffset, hcOutbreakCity } from "./hardcore-outbreak.js";
import { hcMilitary } from "./hardcore-groups.js";

// Things a road card can turn up (tools/loottest.js counts them as sources).
export const HUMVEE_GEAR = ["ar", "plate", "nvg", "milradio", "rucksack", "carbine", "smokegren", "frag"];
export const HIKER_STUFF = ["stove", "flare", "handwarmer", "pocketradio", "handradio", "puritabs", "chocolate", "instcoffee", "harmonica", "cards", "ragboots", "novel", "bandagekit", "flashlight", "lighters", "photos", "waterfilter"];

// ---------- helpers ----------
function check(state, p, key, dc) {
  const s = bestSkill(state, p, key);
  const chance = Math.max(0.05, Math.min(0.95, (s + 10 - dc + 1) / 10));
  return { ok: state.rng.chance(chance), chance, skill: s };
}
const pct = (c) => `${Math.round(c * 100)}%`;
function hint(state, p, key, dc) {
  const s = bestSkill(state, p, key);
  const chance = Math.max(0.05, Math.min(0.95, (s + 10 - dc + 1) / 10));
  return `${key[0].toUpperCase() + key.slice(1)} check, ${pct(chance)}`;
}
function injureRandom(state, p, min, max, cause) {
  const m = partyMembers(state, p);
  if (!m.length) return "";
  const v = state.rng.pick(m);
  hurt(state, v, state.rng.int(min, max), partyTile(p), cause);
  wipeIfEmpty(state, p); // the last one: the team ends as a wiped team (cargo at a death site, vehicle marked)
  return v.alive ? `${v.name.split(" ")[0]} was hurt.` : `${v.name} was killed.`;
}
// A delay in real hours whatever the pace: progress builds up at the stance's speed per hour, so the same
// "4 hours" costs a rushed team 4 hours too (not 3).
function delay(p, hours) {
  p.progress -= hours * partySpeed(p);
}
// A breakdown repaired on the road: the same delay, marked so the team says when it is running again (repairwait.js).
function repairDelay(state, p, v, hours) {
  const before = p.progress || 0;
  delay(p, hours);
  markRepair(state, p, v, hours, before);
}
// mix: the kind of food found (a foods.js MIXES key, or a { key: weight } table of what grows there), "travel" by default.
function addCargo(state, p, key, qty, mix = null) {
  if (key === "ammo") { // rounds: the common rounds of the team's guns, named by calibre (ammo.js)
    /** @type {Record<string, number>} */
    const got = {};
    let short = false;
    for (const [k, q] of Object.entries(calRounds(qty, partyCals(state, p)))) { const t = Math.min(unitsThatFit(cargoRoom(state, p), k), q); if (t < q) short = true; if (t > 0) { p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + t; got[k] = t; } }
    return `${roundsText(got)}${short ? " (no room for the rest)" : ""}`;
  }
  if (key === "food" || key === "preserved") { // foods.js: days of food as what is in a crate or a truck (light, keeps), as far as it fits
    let got = 0, short = false;
    const items = mix && typeof mix === "object" ? growing(mix, qty) : typedFood(state, mix || (key === "preserved" ? "keeps" : "travel"), qty);
    for (const [k, q] of Object.entries(items)) { const t = Math.min(unitsThatFit(cargoRoom(state, p), k), q); if (t < q) short = true; if (t > 0) { addFood(p.cargo, k, t, { state }); got += unitsOf(k, t); } }
    return `${Math.round(got * 10) / 10} days of food${short ? " (no room for the rest)" : ""}`;
  }
  const room = cargoRoom(state, p);
  const take = Math.min(unitsThatFit(room, key), qty);
  p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) + take;
  const word = key === "wood" ? "firewood" : key === "water" ? "bottles of water" : key;
  return take < qty ? `${take} ${word} (no room for the rest)` : `${take} ${word}`;
}
// What grows wild (an orchard's apples, brambles' berries): `units` days of food split by the table's weights, in
// whole items. Not typedFood: it leaves out the kinds only the shops had once the shops are bare, and a tree is no shop.
function growing(table, units) {
  const w = Object.values(table).reduce((a, x) => a + x, 0);
  return Object.fromEntries(Object.entries(table).map(([k, x]) => [k, Math.max(1, Math.round((units * x) / w / unitsOf(k, 1)))]));
}
// A choice that costs carried supplies (packed or found). `disabled` is read from what the team carries each
// time the card is shown, and the cost is checked again and paid when the choice is made: an old card can
// never take stock below zero.
function paid(p, cost, choice) {
  const short = () => Object.entries(cost).find(([k, q]) => carried(p, k) < q);
  const run = choice.resolve;
  return {
    ...choice,
    get disabled() { return !!short(); },
    resolve: (s) => {
      const miss = short();
      if (miss) return `The team no longer has ${miss[1]} ${miss[0]} to spare. Nothing was done.`;
      for (const [k, q] of Object.entries(cost)) takeSupply(p, k, q);
      return run(s);
    },
  };
}
// Same for fuel burned from the tank and the cans (vehicles.js partyFuel).
function burns(state, p, fuel, choice) {
  const run = choice.resolve;
  return {
    ...choice,
    get disabled() { return partyFuel(state, p) < fuel; },
    resolve: (s) => {
      if (partyFuel(s, p) < fuel) return `The team no longer has ${fuel} fuel. Nothing was done.`;
      useFuel(s, p, fuel);
      return run(s);
    },
  };
}
function factionNear(state, tileId, filter, radius = 3) {
  return state.factions.find((f) => f.alive && filter(f) && f.bases.some((b) => state.grid.distance(b, tileId) <= radius));
}

// ---------- event table ----------
const EVENTS = [
  // Hazards
  {
    id: "blocked", weight: 3, when: (st, p, t) => p.vehicle === true && t.road, // bikes are lifted over the wrecks
    card: (st, p, t) => ({
      title: "Blocked highway",
      text: `Wrecked cars choke the road near ${tileLabel(st, t.id)}.`,
      choices: [
        { label: "Clear a path (4 hours, noisy)", resolve: (s) => { delay(p, 4); return s.rng.chance(0.3) ? `The noise drew the dead. ${injureRandom(s, p, 10, 30, "clearing a blocked road")}` : "The road is clear."; } },
        burns(st, p, 3, { label: "Detour off-road (costs 3 fuel)", hint: "Burns extra fuel but avoids the noise", resolve: () => "A long detour through the fields." }),
        { label: "Squeeze through", hint: hint(st, p, "mechanics", 8), resolve: (s) => check(s, p, "mechanics", 8).ok ? "The truck scrapes through." : (delay(p, 3), "The truck gets stuck for hours before you free it.") },
      ],
    }),
  },
  // (Vehicle breakdowns are rolled from the vehicle's condition: breakdownCard below.)
  {
    // Only under rain or snow where the team is, most often under a storm or blizzard front (weather.js).
    id: "storm", weight: (st, p) => (weatherAt(st, partyTile(p)).severe ? 6 : 1.5), when: (st, p, t) => ["rain", "storm", "snow", "blizzard"].includes(weatherAt(st, t.id).key),
    card: (st, p, t) => ({
      title: weatherAt(st, t.id).key === "blizzard" || weatherAt(st, t.id).key === "snow" ? "Blizzard" : "Storm",
      text: weatherAt(st, t.id).key === "blizzard" || weatherAt(st, t.id).key === "snow" ? "The snow thickens into a whiteout." : "A violent storm rolls in.",
      choices: [
        { label: "Shelter and wait (6 hours)", resolve: () => { delay(p, 6); return "You wait it out in a barn."; } },
        { label: "Push through", resolve: (s) => s.rng.chance(0.4) ? `Someone takes a fall. ${injureRandom(s, p, 5, 20, "in a storm")}` : "Soaked, but fine." },
      ],
    }),
  },
  {
    id: "ankle", weight: 1, when: (st, p, t) => !p.vehicle && (t.terrain === "hills" || t.terrain === "forest" || t.terrain === "mountain"),
    card: (st, p) => ({
      title: "Bad footing",
      text: "Loose rock gives way under one of the team.",
      choices: [
        paid(p, { meds: 1 }, { label: "Treat it (1 meds)", resolve: () => { delay(p, 1); return "Wrapped and walking."; } }),
        { label: "Keep moving", resolve: (s) => injureRandom(s, p, 8, 18, "after a fall") },
      ],
    }),
  },
  {
    // A creek too small for any map, running high after rain or with the spring melt (weather.js). On foot only:
    // a vehicle keeps to the bridges and culverts.
    id: "creek", weight: (st, p) => (["rain", "storm"].includes(weatherAt(st, partyTile(p)).key) ? 2.5 : 1),
    when: (st, p, t) => !p.vehicle && ["plains", "forest", "hills"].includes(t.terrain) && (season(st).key === "spring" || ["rain", "storm"].includes(weatherAt(st, t.id).key)),
    card: (st, p) => ({
      title: "A swollen creek",
      text: "A creek that would be ankle-deep in summer is running brown and fast across the way, carrying branches.",
      choices: [
        { label: "Wait for the water to drop (5 hours)", resolve: () => { delay(p, 5); return "By the time it drops the team has eaten, rested and wrung out its socks."; } },
        { label: "Wade across", hint: `${hint(st, p, "scouting", 8)} to find the shallows; otherwise someone is swept off their feet`, resolve: (s) => check(s, p, "scouting", 8).ok ? "Arm in arm, the team finds a gravel bar and crosses." : (delay(p, 1), `The current takes someone's legs. ${injureRandom(s, p, 5, 16, "swept away in a flooded creek")}`) },
        { label: "Walk upstream to a narrower place (3 hours)", resolve: () => { delay(p, 3); return "A fallen tree makes a bridge a few miles up."; } },
      ],
    }),
  },
  {
    // Wolves in the woods and hills (bolder in winter), feral dogs where the towns and farms were: the same beasts
    // that trouble the job trips (tripevents.js TRIP_ANIMALS). Not a team in a vehicle: it drives on past them.
    id: "animals", weight: (st) => (season(st).key === "winter" ? 1.6 : 0.8),
    when: (st, p, t) => p.vehicle !== true && ["forest", "hills", "mountain", "suburb", "plains"].includes(t.terrain),
    card: (st, p, t) => {
      const wolves = ["forest", "hills", "mountain"].includes(t.terrain);
      const n = wolves ? st.rng.int(3, 6) : st.rng.int(4, 8);
      const what = wolves ? "wolves" : "feral dogs";
      const bit = wolves ? "bitten by wolves" : "bitten by feral dogs";
      return {
        title: wolves ? "Wolves" : "Feral dogs",
        text: wolves
          ? `${n} wolves have been pacing the team for an hour, closer each time they show. With so many dead to scavenge they have lost their fear of people.`
          : `A pack of ${n} feral dogs, somebody's pets once, spreads out across the way with their hackles up.`,
        choices: [
          { label: "Back away", hint: `${hint(st, p, "scouting", wolves ? 8 : 6)}; otherwise they rush in and someone is bitten`, resolve: (s) => check(s, p, "scouting", wolves ? 8 : 6).ok ? (delay(p, 1), `Slowly, facing them, the team backs off until the ${what} lose interest.`) : `They rush in. ${injureRandom(s, p, 5, wolves ? 18 : 12, bit)}` },
          paid(p, { food: 2 }, { label: "Throw them some food (2 food)", resolve: () => `The ${what} fall on it, snarling at each other, and the team slips away.` }),
          {
            label: "Drive them off (uses ammo)", hint: "Loud; safe with shooters and rounds (bows use arrows)", resolve: (s) => {
              // A shot or two a beast, the bows' in arrows (takeShots); an animal is worth about two of the dead.
              const members = partyMembers(s, p);
              const shot = takeShots(p, members, n * 2);
              const power = members.reduce((a, m) => a + combatPower(m), 0) * armedFactor(members, shot.used, shot.arrows, { need: (k) => (n * k) / Math.max(1, members.length), short: 0.5 });
              if (power <= n * (wolves ? 1.2 : 0.8)) return `They do not scatter fast enough. ${injureRandom(s, p, 6, wolves ? 20 : 14, bit)}`;
              const back = arrowsBack(shot.arrows);
              if (back) p.supplies.arrows = (p.supplies.arrows || 0) + back;
              return `The ${what} scatter, using ${shot.arrows ? `${roundsText(shot.used)} and ${shot.arrows} arrows (${back} picked up again)` : roundsText(shot.used)}.`;
            },
          },
        ],
      };
    },
  },
  // The dead beasts (deadbeasts.js beastMix): the worm's dead animals on the hills, in the woods and over the farms,
  // and its dead pets in the towns, on foot (a car drives on past them). Go round, put them down (they are quick, and full of the worm), or burn them.
  {
    id: "deadbeasts", weight: (st) => BEASTS.CARD, when: (st, p, t) => p.vehicle !== true && !!beastMix(st, t.id),
    card: (st, p, t) => {
      const mix = beastMix(st, t.id) || {};
      const kind = Object.keys(mix).reduce((a, k) => (mix[k] > mix[a] ? k : a));
      const name = ZTYPES[kind].name.toLowerCase();
      const n = kind === "deadhound" ? st.rng.int(3, 6) : kind === "deadcow" ? st.rng.int(2, 4) : kind === "deadcat" ? st.rng.int(2, 5) : st.rng.int(1, 3);
      const what = n === 1 ? `a ${name}` : `${n} ${name}s`;
      const bit = `bitten by a ${name}`;
      const where = t.terrain === "hills" ? "on the slope" : t.terrain === "forest" ? "between the trees" : t.terrain === "city" ? "in the street" : t.terrain === "suburb" || (t.loc && ["house", "neighbourhood", "motel", "apartments", "town"].includes(t.loc.type)) ? "in a yard" : "in the field";
      return {
        title: n === 1 ? ZTYPES[kind].name : `${ZTYPES[kind].name}s`,
        text: `${what[0].toUpperCase()}${what.slice(1)} ${where}, standing wrong: thin, the hide split, pale worms moving in the splits. ${n === 1 ? "It turns its head toward the team." : "They turn their heads toward the team."} The worm killed them, and now they walk.`,
        choices: [
          { label: "Go around (1 hour)", hint: `${hint(st, p, "scouting", 5)}; otherwise they catch the team's scent and come`, resolve: (s) => check(s, p, "scouting", 5).ok ? (delay(p, 1), `The team gives them a wide berth and the ${what} ${n === 1 ? "loses" : "lose"} interest.`) : `They come at a run. ${injureRandom(s, p, 6, kind === "deadcow" ? 20 : 14, bit)}` },
          {
            label: "Put them down (uses ammo)", hint: "Loud; they are quick, and their bites carry the worm (bows use arrows)", resolve: (s) => {
              const members = partyMembers(s, p);
              const shot = takeShots(p, members, n * 2);
              const power = members.reduce((a, m) => a + combatPower(m), 0) * armedFactor(members, shot.used, shot.arrows, { need: (k) => (n * k) / Math.max(1, members.length), short: 0.5 });
              if (power <= n * ZTYPES[kind].weight * 0.6) return `They are on the team before enough shots land. ${injureRandom(s, p, 8, kind === "deadcow" ? 24 : 16, bit)}`;
              const back = arrowsBack(shot.arrows);
              if (back) p.supplies.arrows = (p.supplies.arrows || 0) + back;
              return `Put down, using ${shot.arrows ? `${roundsText(shot.used)} and ${shot.arrows} arrows (${back} picked up again)` : roundsText(shot.used)}. ${kind === "deadcow" || kind === "deadhog" ? "The carcasses split as they fall and the worms spill out; nobody goes near them." : "Nobody touches the carcasses."}`;
            },
          },
          paid(p, { fuel: 1 }, { label: "Burn them (1 fuel)", hint: "The worms cook; the smoke is seen for miles", resolve: (s) => { delay(p, 1); return `A splash of fuel and a match: the ${what} ${n === 1 ? "goes" : "go"} up where ${n === 1 ? "it stands" : "they stand"}, the worms with ${n === 1 ? "it" : "them"}. The team waits out the smoke.`; } }),
        ],
      };
    },
  },
  // One of the team, fallen behind on foot, set upon by the dead or the dead beasts: fought alone on the battle map
  // with what they carry (loneattack.js stragglerCard: Save and fight, Fight, or by the numbers).
  { id: "straggler", weight: (st, p) => LONE.ROAD * (1 + ((st.tiles[partyTile(p)] || {}).infection || 0) * 2), when: (st, p, t) => stragglerFits(st, p, t), card: (st, p, t) => stragglerCard(st, p, t) },
  // Zombies
  {
    id: "pack", weight: 5, when: (st, p, t) => t.infection > 0.2,
    card: (st, p, t) => {
      const n = Math.round(4 + t.infection * 14 + (isNight(st) ? 4 : 0));
      return {
        title: "The dead ahead",
        text: `About ${n} infected shamble across your path${isNight(st) ? " in the dark" : ""}.`,
        choices: [
          { label: "Sneak around", hint: hint(st, p, "stealth", 7 + Math.round(t.infection * 4)), resolve: (s) => check(s, p, "stealth", 7 + Math.round(t.infection * 4)).ok ? (delay(p, 1), "You slip past unseen.") : `They spot you. ${injureRandom(s, p, 10, 30, "fleeing the dead")}` },
          {
            label: "Fight (uses ammo)", hint: "Safe with ammo and shooters, loud (bows and crossbows use arrows)", resolve: (s) => {
              // Two shots for each of the dead: a bow's in arrows, everyone else's in ammo (takeShots); half power for
              // the bows or the guns with under one a head of the dead between them (world.js armedFactor).
              const members = partyMembers(s, p);
              const shot = takeShots(p, members, n * 2);
              const power = members.reduce((a, m) => a + combatPower(m), 0) * armedFactor(members, shot.used, shot.arrows, { need: (k) => (n * k) / Math.max(1, members.length), short: 0.5 });
              if (power <= n * 0.6) return `A messy fight. ${injureRandom(s, p, 15, 40, "fighting the dead")}`;
              const back = arrowsBack(shot.arrows); // cleared: about half the arrows are picked up again
              if (back) p.supplies.arrows = (p.supplies.arrows || 0) + back;
              return shot.arrows ? `Cleared, using ${roundsText(shot.used)} and ${shot.arrows} arrows (${back} picked up again).` : `Cleared, using ${roundsText(shot.used)}.`;
            },
          },
          { label: "Go the long way (3 hours)", resolve: () => { delay(p, 3); return "A safe but slow detour."; } },
        ],
      };
    },
  },
  // The worm is no longer a roll of the dice on bad ground: people catch it from what they drink, eat and where they
  // camp, and its card ("The worm") comes when the team finds out someone has it (worm.js).
  {
    id: "hive", weight: 2, when: (st, p, t) => st.grid.within(t.id, 2).some((id) => st.tiles[id].hive),
    card: (st, p, t) => {
      const hiveTile = st.grid.within(t.id, 2).find((id) => st.tiles[id].hive);
      p.seen.set(hiveTile, snapshot(st, hiveTile)); // they saw it: it goes on the map when the team reports
      // What has grown around it (hivetech.js): the team sees those too.
      const hv0 = hiveAt(st, hiveTile);
      const grown = hv0 ? growthsOf(st, hv0, false) : [];
      for (const g of grown) p.seen.set(g.tile, snapshot(st, g.tile));
      const names = grown.map((g) => GROWTHS[g.kind].name.toLowerCase());
      return {
        title: "A hive",
        text: `The team comes upon an infestation hive: a mound of fused bodies, warm and pulsing, the dead packed around it. Hordes are born here. Destroying it takes a real assault (the Destroy hive mission).${names.length ? ` The dead have grown things around it: ${names.join(", ")}. They go on the map when the team reports (the Burn the growth mission).` : ""}`,
        choices: [
          { label: "Mark it and move on", resolve: () => "Noted on the map." },
        ],
      };
    },
  },
  {
    // Somebody who got away left a warning: a horde a few tiles off (a horde on the team's own tile is its own card).
    id: "warning", weight: 1.2, when: (st, p, t) => st.hordes.some((h) => h.tile !== t.id && st.grid.distance(h.tile, t.id) <= 4),
    card: (st, p, t) => {
      const near = st.hordes.filter((h) => h.tile !== t.id && st.grid.distance(h.tile, t.id) <= 4).sort((a, b) => st.grid.distance(a.tile, t.id) - st.grid.distance(b.tile, t.id))[0];
      const mark = (s, list) => { for (const h of list) p.seen.set(h.tile, snapshot(s, h.tile)); }; // on the map when the team reports
      return {
        title: "A warning on the road",
        text: `Someone has painted DEAD AHEAD, TURN BACK across a barn wall in letters a yard high, with an arrow pointing ${compass(st, t.id, near.tile)}. The paint is fresh.`,
        choices: [
          { label: "Mark it on the map", hint: "Where the arrow points goes on the map when the team reports", resolve: (s) => { mark(s, [near]); return `The team marks the dead ${compass(s, t.id, near.tile)} of here.`; } },
          {
            label: "Scout ahead to see for yourselves (2 hours)", hint: `${hint(st, p, "scouting", 7)}: every horde within 5 tiles goes on the map, with its size; otherwise the dead see you`,
            resolve: (s) => {
              delay(p, 2);
              if (!check(s, p, "scouting", 7).ok) { mark(s, [near]); return `The dead were closer than the paint said. ${injureRandom(s, p, 10, 25, "scouting a horde")}`; }
              const all = s.hordes.filter((h) => s.grid.distance(h.tile, t.id) <= 5);
              mark(s, all);
              if (!all.length) return "From a water tower the team sees only empty fields: whatever was there has moved on.";
              return `From a water tower the team counts ${all.map((h) => `about ${h.size} ${compass(s, t.id, h.tile)}`).join(", ")}. It all goes on the map.`;
            },
          },
        ],
      };
    },
  },
  // Humans
  {
    id: "traders", weight: 2, when: () => true,
    card: (st, p) => ({
      title: "Stranded traders",
      text: "A pair of traders sit beside a broken cart. Their mule is dead.",
      choices: [
        { label: "Help them (2 hours)", resolve: (s) => { delay(p, 2); const fr = s.factions.find((f) => f.alive && f.type === "traders"); if (fr) changeGoodwill(s, fr, 5, "you helped their people"); return `Grateful, they share: ${addCargo(s, p, "meds", 2)}.`; } },
        paid(p, { food: 10 }, { label: "Trade (10 food for 3 parts)", resolve: (s) => `Traded. ${addCargo(s, p, "parts", 3)}.` }),
        { label: "Rob them", resolve: (s) => { const fr = s.factions.find((f) => f.alive && f.type === "traders"); if (fr) changeGoodwill(s, fr, -12, "you robbed their people"); s.survivors.filter((x) => x.alive).forEach((x) => (x.mood = Math.max(0, x.mood - 4))); return `You take what they have: ${addCargo(s, p, "parts", 3)}, ${addCargo(s, p, "food", 6)}.`; } },
        { label: "Leave them", resolve: () => "You walk on." },
      ],
    }),
  },
  {
    id: "loner", weight: 2, when: () => true,
    // A recruit card (recruits.js): take them along if the team's rations allow, send them to a base on foot,
    // give them supplies and part ways, or turn them away.
    card: (st, p) => {
      const s0 = makeCandidate(st, { quality: 0.85, minHealth: 50 });
      return recruitCard(st, [s0], { source: "loner", partyId: p.id, title: "A survivor alone", intro: `${s0.name} has been living in a hunting stand and asks to come with you.` });
    },
  },
  {
    // A stranger in the worm's last days (worm.js): nobody turns from a bite, but in a day or two the larvae reach the
    // brain and they will get up. They ask for someone to see it through.
    id: "wormdying", weight: 1, when: (st, p, t) => t.infection > 0.25,
    card: (st, p) => ({
      title: "A stranger with the worm",
      text: `A stranger sits against a fence post, grey and shaking, eating dry oats by the handful as fast as they can swallow. "It's the worm," they say. "A day or two and it reaches my head. Don't let me get up after. Please."`,
      choices: [
        {
          label: "Stay with them until it is over (5 hours)", hint: "Everyone on the team mood -3; the stranger leaves the team what they carry",
          resolve: (s) => {
            delay(p, 5);
            cheer(partyMembers(s, p), -3);
            const it = lootItem(s.rng.pick(HIKER_STUFF), "survivor", spend(s.rng));
            const kept = addGearToCargo(s, p, it) ? it.name.toLowerCase() : "";
            return `It is over by dusk, and the team makes sure they will not rise. They left the team ${[kept, addCargo(s, p, "ammo", s.rng.int(6, 16))].filter(Boolean).join(" and ")}.`;
          },
        },
        paid(p, { food: 2 }, { label: "Leave them food (2 food)", hint: "Everyone on the team mood +2", resolve: (s) => { cheer(partyMembers(s, p), 2); return "They thank you through chattering teeth."; } }),
        { label: "Move on", hint: "Everyone on the team mood -2", resolve: (s) => { cheer(partyMembers(s, p), -2); return "Nobody speaks for an hour."; } },
      ],
    }),
  },
  {
    id: "patrol", weight: 3, when: (st, p, t) => typeof t.owner === "number" && attitude(factionById(st, t.owner)) !== "Hostile",
    card: (st, p, t) => {
      const f = factionById(st, t.owner);
      f.known = true;
      return {
        title: `${f.name} patrol`,
        text: `A ${f.name} patrol stops you. They are ${attitude(f).toLowerCase()}, but watchful.`,
        choices: [
          { label: "Share news and move on", resolve: (s) => { changeGoodwill(s, f, 2); f.lastDiplomacy = day(s); for (const b of f.bases) p.seen.set(b, snapshot(s, b)); return `They mark their bases on your map.`; } },
          paid(p, { food: 5 }, { label: "Offer 5 food as a gift", resolve: (s) => { changeGoodwill(s, f, 6, "a gift"); f.lastDiplomacy = day(s); return "They appreciate it."; } }),
        ],
      };
    },
  },
  // Discoveries
  {
    id: "truck", weight: 3, when: (st, p, t) => t.road,
    card: (st, p, t) => ({
      title: "Abandoned supply truck",
      text: "A delivery truck sits on its rims, back door still shut.",
      choices: [
        { label: "Search it (2 hours)", resolve: (s) => { delay(p, 2); const k = s.rng.pick(["food", "fuel", "scrap", "meds", "ammo"]); const q = { food: 12, fuel: 5, scrap: 15, meds: 3, ammo: 30 }[k]; /* fuel is scarce */ return s.rng.chance(0.2) ? `Something was waiting inside. ${injureRandom(s, p, 10, 30, "searching a truck")}` : `Found ${addCargo(s, p, k, q)}.`; } },
        { label: "Leave it", resolve: () => "Not worth the risk." },
      ],
    }),
  },
  {
    id: "radio", weight: 1, when: () => true,
    card: (st, p) => {
      const f = st.rng.pick(st.factions.filter((f) => f.alive));
      return {
        title: "Radio signal",
        text: "A looping broadcast on an old scanner gives directions to a settlement.",
        choices: [{ label: "Note it", resolve: (s) => { if (!f) return "Static."; for (const b of f.bases) p.seen.set(b, snapshot(s, b)); return `The team notes where ${f.name} is. It goes on the map when they return.`; } }],
      };
    },
  },
  {
    id: "military", weight: 1, when: (st, p, t) => t.infection > 0.3,
    card: (st, p) => ({
      title: "Crashed military vehicle",
      text: "A Humvee lies on its side in a ditch. Bodies in uniform still sit inside, and the dead are thick around it.",
      choices: [
        {
          label: "Search it", hint: hint(st, p, "stealth", 11), resolve: (s) => {
            const ok = check(s, p, "stealth", 11).ok;
            const g = swapGun("truck:humvee", s.rng.pick(HUMVEE_GEAR), s.rng); // gundist.js: which gun (a hash of the draw)
            // The find needs carry space like anything else; with none it stays in the wreck.
            const fits = addGearToCargo(s, p, lootItem(g, "wreck", s.rng)); // itemcond.js: a wreck's kit, knocked about
            const found = fits ? GEAR[g].name : `${GEAR[g].name} (no room to carry it: left there)`;
            return ok ? `Found: ${found}, ${addCargo(s, p, "ammo", 30)}.` : `Found ${found}, but ${injureRandom(s, p, 20, 50, "at a crashed Humvee")}`;
          },
        },
        { label: "Leave it", resolve: () => "Too many of them." },
      ],
    }),
  },
  {
    // A pack on a dead hiker (or a soldier's rucksack): one of the ways to find a big pack, with things inside.
    id: "hiker", weight: 1.5, when: (st, p, t) => !t.loc && ["forest", "hills", "mountain", "plains"].includes(t.terrain),
    card: (st, p) => ({
      title: "A dead hiker",
      text: "Slumped against a trail marker, a hiker in a rain jacket. The dead did not get the pack, and they did not get the hiker either: a bite on the arm and a pistol with one round fired.",
      choices: [
        {
          label: "Take the pack", hint: "It may have been a while. Heavy, but a big pack is worth it",
          resolve: (s) => {
            const pack = lootItem(s.rng.chance(0.25) ? "rucksack" : "hikingpack", "survivor", spend(s.rng));
            const n = s.rng.int(1, 3);
            for (let i = 0; i < n; i++) pack.contents[i] = lootItem(s.rng.pick(HIKER_STUFF), "survivor", s.rng);
            const inside = pack.contents.filter(Boolean).map((it) => it.name.toLowerCase()).join(", ");
            return addGearToCargo(s, p, pack) ? `A ${pack.name.toLowerCase()} with ${inside} inside. It goes in the cargo; anyone can wear it.` : `A ${pack.name.toLowerCase()}, but nobody has room to carry it: it stays on the hiker.`;
          },
        },
        { label: "Leave them be", resolve: () => "The team walks on." },
      ],
    }),
  },
  {
    id: "cache", weight: 2, when: (st, p, t) => t.terrain === "forest" || t.terrain === "hills",
    card: (st, p) => ({
      title: "Prepper cache",
      text: "A hidden hatch under leaves. Someone planned for this.",
      choices: [{ label: "Open it", resolve: (s) => `Inside: ${addCargo(s, p, "food", 8)}, ${addCargo(s, p, "meds", 2)}, ${addCargo(s, p, "ammo", 20)}.` }],
    }),
  },
  {
    // A farmhouse off on its own: a farm's larder and a woodpile, and on infected land whoever lived there may still be in.
    id: "farmhouse", weight: 1.2, when: (st, p, t) => !t.loc && ["plains", "hills", "forest"].includes(t.terrain),
    card: (st, p, t) => {
      const risk = Math.min(0.5, 0.1 + t.infection * 0.4);
      return {
        title: "A lonely farmhouse",
        text: "A farmhouse stands back from the lane, curtains drawn, a tractor rusting in the yard. The door is shut, and nobody answers a knock.",
        choices: [
          {
            label: "Search it (3 hours)", hint: `${hint(st, p, "scavenging", 8)} for the cellar and the woodpile; ${pct(risk)} someone is still home`,
            resolve: (s) => {
              delay(p, 3);
              const hurtTxt = s.rng.chance(risk) ? ` Someone was still home. ${injureRandom(s, p, 8, 25, "searching a farmhouse")}` : "";
              if (!s.parties.includes(p)) return hurtTxt.trim();
              const got = check(s, p, "scavenging", 8).ok ? [addCargo(s, p, "food", s.rng.int(4, 7), "farm"), addCargo(s, p, "wood", 60), ...(s.rng.chance(0.4) ? [addCargo(s, p, "meds", 1)] : [])] : [addCargo(s, p, "food", 2, "farm")];
              return `Found ${got.join(", ")}.${hurtTxt}`;
            },
          },
          { label: "Leave it", resolve: () => "The team leaves the house to whatever is inside it." },
        ],
      };
    },
  },
  {
    // An orchard gone wild in autumn, brambles heavy with berries in summer: fresh food that will not keep long.
    id: "orchard", weight: 1.5, when: (st, p, t) => !t.loc && ["plains", "hills"].includes(t.terrain) && ["summer", "autumn"].includes(season(st).key),
    card: (st, p) => {
      const autumn = season(st).key === "autumn";
      const grows = autumn ? { f_apples: 10, f_berries: 2 } : { f_berries: 10, f_wildgreens: 3 };
      return {
        title: autumn ? "A gone-wild orchard" : "Brambles in fruit",
        text: autumn ? "Rows of apple trees run down to a broken fence, branches bent with fruit nobody has picked in years. Wasps drone over the windfalls." : "Brambles have swallowed a fence line along the field, black with ripe berries.",
        choices: [
          { label: "Pick what you can (2 hours)", hint: "Fresh food: it spoils in days (berries) or weeks (apples)", resolve: (s) => { delay(p, 2); return `The team fills every spare bag: ${addCargo(s, p, "food", s.rng.int(3, 6), grows)}.`; } },
          { label: "Move on", resolve: () => "The team eats a handful each and walks on." },
        ],
      };
    },
  },
  {
    // A gas station nobody has bothered with: the pumps are dead but the tank under the forecourt may not be.
    id: "station", weight: 1.5, when: (st, p, t) => t.road && !t.loc && ["plains", "suburb", "hills", "forest"].includes(t.terrain),
    card: (st, p, t) => {
      const noise = Math.min(0.6, 0.15 + t.infection * 0.4);
      return {
        title: "A roadside gas station",
        text: "The pumps at a little gas station are dry and the windows long smashed, but the tank under the forecourt may still hold something.",
        choices: [
          {
            label: "Hand-pump the underground tank (3 hours)", hint: `${hint(st, p, "mechanics", 9)}: 4 to 8 fuel; noisy, ${pct(noise)} it draws the dead`,
            resolve: (s) => {
              delay(p, 3);
              const hurtTxt = s.rng.chance(noise) ? ` The clanking drew the dead. ${injureRandom(s, p, 8, 22, "at a gas station")}` : "";
              if (!s.parties.includes(p)) return hurtTxt.trim();
              return check(s, p, "mechanics", 9).ok ? `The pump coughs up ${addCargo(s, p, "fuel", s.rng.int(4, 8))}.${hurtTxt}` : `The pump only brings up water and sludge.${hurtTxt}`;
            },
          },
          { label: "Pick through the shop (1 hour)", hint: "Whatever the looters missed", resolve: (s) => { delay(p, 1); return `Under the shelves: ${addCargo(s, p, "food", 2, "roadside")}${s.rng.chance(0.3) ? `, ${addCargo(s, p, "scrap", 4)}` : ""}.`; } },
          { label: "Move on", resolve: () => "The team leaves it." },
        ],
      };
    },
  },
  {
    // A camp the dead overran: what the campers had, a chance one of them got up again (worm.js), and the dead to bury.
    id: "camp", weight: 1.2, when: (st, p, t) => !t.loc && t.infection > 0.15,
    card: (st, p, t) => {
      const risk = Math.min(0.5, 0.15 + t.infection * 0.3);
      return {
        title: "An overrun camp",
        text: "Tents slashed and trampled, a cold fire pit, a camper van with its door hanging open. Whoever lived here did not leave on their own feet, and some of them are still lying where they fell.",
        choices: [
          {
            label: "Search the camp (2 hours)", hint: `What the campers had; ${pct(risk)} one of them gets up`,
            resolve: (s) => {
              delay(p, 2);
              const hurtTxt = s.rng.chance(risk) ? ` One of the bodies was not finished. ${injureRandom(s, p, 8, 20, "searching an overrun camp")}` : "";
              if (!s.parties.includes(p)) return hurtTxt.trim();
              const [a, b] = s.rng.shuffle([["food", 4], ["ammo", 20], ["meds", 2], ["wood", 60], ["parts", 1]]);
              const got = [addCargo(s, p, a[0], a[1]), addCargo(s, p, b[0], b[1])];
              if (s.rng.chance(0.4)) { const it = lootItem(s.rng.pick(HIKER_STUFF), "survivor", spend(s.rng)); if (addGearToCargo(s, p, it)) got.push(it.name.toLowerCase()); }
              return `Found ${got.join(", ")}.${hurtTxt}`;
            },
          },
          { label: "Bury the dead (3 hours)", hint: "Everyone on the team mood +6", resolve: (s) => { delay(p, 3); cheer(partyMembers(s, p), 6); return "Shallow graves and a few words. The team feels better for it (mood +6)."; } },
          { label: "Move on", resolve: () => "The team gives it a wide berth." },
        ],
      };
    },
  },
  // Crew
  {
    // Rivals on a team argue far more often (weight 5), a team of friends rarely (1); relations.js.
    id: "argument", weight: (st, p) => argumentWeight(st, p), when: (st, p) => partyMembers(st, p).length >= 2,
    card: (st, p) => {
      const [a0, b0] = st.rng.shuffle([...partyMembers(st, p)]);
      const [a, b] = argumentPair(st, partyMembers(st, p), a0, b0); // the worst rival pair, if there is one
      return {
        title: "Tempers flare",
        text: `${a.name.split(" ")[0]} and ${b.name.split(" ")[0]} are at each other's throats over rations.`,
        survivorIds: [a.id, b.id],
        choices: [
          { label: "Step in", hint: hint(st, p, "leadership", 7), resolve: (s) => check(s, p, "leadership", 7).ok ? (relEvent(s, a, b, 4), "Calm returns.") : (sulk(a, 10), sulk(b, 10), relEvent(s, a, b, -8), "It ends badly. Both are sulking.") },
          { label: "Let them sort it out", resolve: (s) => { relEvent(s, a, b, -6); if (s.rng.chance(0.3)) { hurt(s, b, 10, partyTile(p), "in a fight"); wipeIfEmpty(s, p); return "Punches are thrown."; } return "It blows over."; } },
        ],
      };
    },
  },
  {
    // Friends on a team: a night of old stories (relations.js).
    id: "campfire", weight: 1.5, when: (st, p) => partyMembers(st, p).length >= 2 && hasFriendsOnTeam(st, p),
    card: (st, p) => campfireCard(st, p),
  },
  {
    id: "coward", weight: 2, when: (st, p) => partyMembers(st, p).some((m) => m.traits.includes("coward")) && p.phase === "out" && !!hub(st), // no base: no home to turn back to
    card: (st, p) => {
      const c = partyMembers(st, p).find((m) => m.traits.includes("coward"));
      const alone = partyMembers(st, p).length === 1;
      return {
        title: "Cold feet",
        text: `${c.name} wants to turn back. "We are going to die out here."`,
        survivorIds: [c.id],
        choices: [
          { label: "Convince them", hint: hint(st, p, "leadership", 8), resolve: (s) => check(s, p, "leadership", 8).ok ? "They steady themselves." : (sulk(c, 15), "They come, but they are shaking.") },
          {
            label: alone ? "Turn back for home" : "Let them go home alone",
            hint: alone ? "They are the whole team: it turns around with everything it carries" : "The rest of the team goes on without them",
            resolve: (s) => {
              // The only one out here: going home means the whole team turns around (vehicle, supplies and cargo
              // go back with them; a team is never left with nobody in it).
              if (partyMembers(s, p).length <= 1) {
                const why = startReturn(s, p);
                return why ? `${c.name} wants to go home, but cannot. ${why}` : `${c.name} turns around and heads for home.`;
              }
              if (!hub(s)) return `There is no home left to go back to. ${c.name} stays with the team.`; // the hub fell since the card came up
              p.members = p.members.filter((id) => id !== c.id);
              if (s.rng.chance(0.7)) { c.location = { kind: "base", baseId: hub(s).id }; return `${c.name} made it home.`; }
              hurt(s, c, 999, partyTile(p), "walking home alone");
              return `${c.name} never made it home.`;
            },
          },
        ],
      };
    },
  },
];
// ---------- hardcore: the year Calder falls (hardcore.js) ----------
// Road cards only a hardcore run meets, and only before the day a normal game would start (hardcore-outbreak.js
// hardcoreEraOffset): the evacuation that jammed the roads, the Guard's checkpoints and relief drops while it still
// stands, the emergency broadcast still on the air, people who would not leave, the first weeks' looters, and the dead
// still in the clothes they died in. Most come in the first weeks and fade as the months go by (hcFade).
const hcYear = (st) => isHardcore(st) && day(st) <= hardcoreEraOffset(st);
const hcFade = (st, days) => Math.exp(-(day(st) - 1) / days);
const guardStands = (st) => { const m = hcMilitary(st); return !!m && !m.fell; };
const LOOTED = { town: "corner shop", gas: "gas station", pharmacy: "pharmacy", grocery: "grocery store", supermarket: "supermarket", truckstop: "truck stop" };
const HC_EVENTS = [
  {
    // The evacuation that never got anywhere: cars nose to tail, doors open, luggage on the roofs.
    id: "hc_gridlock", weight: (st) => 4 * hcFade(st, 30), when: (st, p, t) => hcYear(st) && t.road,
    card: (st, p, t) => {
      const risk = Math.min(0.4, 0.05 + t.infection * 0.5);
      const stuck = (s) => (s.rng.chance(risk) ? ` Not every driver got out. ${injureRandom(s, p, 6, 18, "in an evacuation jam")}` : "");
      return {
        title: "Gridlock",
        text: "Both lanes are solid with cars for a mile, nose to tail, doors hanging open, suitcases still strapped to the roofs. The radio in one of them is still playing to nobody.",
        choices: [
          { label: "Siphon the tanks (2 hours)", hint: `2 to 6 fuel; ${pct(risk)} someone is still in their car`, resolve: (s) => { delay(p, 2); const hurtTxt = stuck(s); if (!s.parties.includes(p)) return hurtTxt.trim(); return `A hose and a jerry can: ${addCargo(s, p, "fuel", s.rng.int(2, 6))}.${hurtTxt}`; } },
          {
            label: "Go through the luggage (2 hours)", hint: `Food and whatever people packed in a hurry; ${pct(risk)} someone is still in their car`,
            resolve: (s) => {
              delay(p, 2);
              const hurtTxt = stuck(s);
              if (!s.parties.includes(p)) return hurtTxt.trim();
              const got = [addCargo(s, p, "food", s.rng.int(2, 4))];
              if (s.rng.chance(0.5)) { const it = lootItem(s.rng.pick(HIKER_STUFF), "survivor", s.rng); if (addGearToCargo(s, p, it)) got.push(it.name.toLowerCase()); }
              return `Found ${got.join(" and ")}.${hurtTxt}`;
            },
          },
          { label: "Move on", resolve: () => "The team picks its way past the cars." },
        ],
      };
    },
  },
  {
    // A National Guard checkpoint left when the line fell back: sandbags, a quarantine sign, crates under a tarp.
    id: "hc_checkpoint", weight: 1.5, when: (st, p, t) => hcYear(st) && t.road && !t.loc,
    card: (st, p, t) => {
      const risk = Math.min(0.5, 0.15 + t.infection * 0.4);
      return {
        title: "An abandoned checkpoint",
        text: "Sandbags, a sawhorse barrier and a hand-painted sign: QUARANTINE ZONE, NO ENTRY. The National Guard pulled out in a hurry and left a cot, a dead radio set and crates under a tarp. One of the soldiers never left: they are still sitting in the cab of a truck.",
        choices: [
          {
            label: "Search the crates (2 hours)", hint: `Army rations and rounds, maybe kit; ${pct(risk)} the soldier in the truck had the worm and gets out`,
            resolve: (s) => {
              delay(p, 2);
              const hurtTxt = s.rng.chance(risk) ? ` The soldier in the cab was not dead for long. ${injureRandom(s, p, 10, 25, "at an abandoned checkpoint")}` : "";
              if (!s.parties.includes(p)) return hurtTxt.trim();
              const got = [addCargo(s, p, "food", 3, "army"), addCargo(s, p, "ammo", s.rng.int(20, 40))];
              if (s.rng.chance(0.35)) { const it = lootItem(swapGun("truck:humvee", s.rng.pick(HUMVEE_GEAR), s.rng), "wreck", s.rng); if (addGearToCargo(s, p, it)) got.push(it.name); }
              return `Found ${got.join(", ")}.${hurtTxt}`;
            },
          },
          { label: "Leave it", resolve: () => "The team gives the truck a wide berth." },
        ],
      };
    },
  },
  {
    // The Emergency Alert System, still on the air the first weeks: where the outbreak began, and where the Guard is.
    id: "hc_broadcast", weight: (st) => 2 * hcFade(st, 25), when: (st) => hcYear(st) && (st.hives || []).length > 0,
    card: (st, p, t) => {
      const city = hcOutbreakCity(st);
      const from = city != null ? city : t.id;
      const first = [...st.hives].sort((a, b) => st.grid.distance(a.tile, from) - st.grid.distance(b.tile, from))[0];
      const m = guardStands(st) ? hcMilitary(st) : null;
      const mark = (s, tiles) => { for (const id of tiles) p.seen.set(id, snapshot(s, id)); }; // on the map when the team reports
      return {
        title: "The emergency broadcast",
        text: `A car radio in a wreck still has power. Under the alert tones a recorded voice repeats: stay indoors, avoid ${city != null ? tileLabel(st, city) : "the cities"}, where the infection began${m ? `; the National Guard holds ${tileLabel(st, m.tile)}, and it is closed to civilians` : ""}. Nobody has updated it in days.`,
        choices: [
          { label: "Note it", hint: "Where the outbreak began goes on the map when the team reports", resolve: (s) => { mark(s, [first.tile, ...(m ? [m.tile] : [])]); return `The team marks where it began, ${compass(s, t.id, first.tile)} of here.`; } },
          {
            label: "Listen to the whole loop (2 hours)", hint: "Every hive it names goes on the map when the team reports",
            resolve: (s) => {
              delay(p, 2);
              const all = (s.hives || []).map((h) => h.tile);
              mark(s, [...all, ...(m ? [m.tile] : [])]);
              return `Between the tones, a list of places to avoid: ${all.length} ${all.length === 1 ? "hive goes" : "hives go"} on the map.`;
            },
          },
        ],
      };
    },
  },
  {
    // People who would not leave: boarded windows, a bedsheet sign, a rifle at an upstairs window.
    id: "hc_holdouts", weight: 1.5, when: (st, p, t) => hcYear(st) && ["suburb", "plains"].includes(t.terrain),
    card: (st, p) => ({
      title: "They would not leave",
      text: "A house with boarded windows and a bedsheet hung from the porch: WE ARE FINE. GO AWAY. A rifle barrel shows at an upstairs window, and a voice calls down that they are waiting for the Guard to come for them.",
      choices: [
        {
          label: "Tell them what you have seen (1 hour)", hint: `${hint(st, p, "speech", 8)}: they believe you and share what they cannot carry (team mood +2); otherwise they tell you to leave`,
          resolve: (s) => {
            delay(p, 1);
            if (!check(s, p, "speech", 8).ok) return "\"Get off our lawn.\" The rifle does not move.";
            cheer(partyMembers(s, p), 2);
            return `The door opens. They are packing to go north, and give the team ${addCargo(s, p, "food", 3, "house")} and ${addCargo(s, p, "meds", 1)} they cannot take.`;
          },
        },
        { label: "Move on", resolve: () => "The rifle follows the team down the street." },
      ],
    }),
  },
  {
    // The first weeks' looting: a gang stripping a shop while the town still has people in it.
    id: "hc_looters", weight: (st) => 2.5 * hcFade(st, 40), when: (st, p, t) => hcYear(st) && (["suburb", "city"].includes(t.terrain) || (!!t.loc && !!LOOTED[t.loc.type])),
    card: (st, p, t) => {
      const what = (t.loc && LOOTED[t.loc.type]) || "supermarket";
      return {
        title: `A ${what} being looted`,
        text: `Glass on the pavement and shouting inside: a dozen people are stripping a ${what} into the backs of two pickups, and one of them sits on a hood with a shotgun, watching the street.`,
        choices: [
          { label: "Wait for them to go and pick over what is left (3 hours)", resolve: (s) => { delay(p, 3); return `They leave the shelves bare, nearly: ${addCargo(s, p, "food", 2, "shop")}${s.rng.chance(0.5) ? ` and ${addCargo(s, p, "meds", 1)}` : ""}.`; } },
          {
            label: "Slip in the back while they are busy", hint: `${hint(st, p, "stealth", 9)}: a share of the good stuff; otherwise they open fire`,
            resolve: (s) => check(s, p, "stealth", 9).ok
              ? `In and out the loading dock: ${addCargo(s, p, "food", 4, "shop")}, ${addCargo(s, p, "meds", 2)} and ${addCargo(s, p, "ammo", 10)}.`
              : `Someone shouts, and the shotgun goes off. ${injureRandom(s, p, 10, 30, "shot by looters")}`,
          },
          { label: "Move on", resolve: () => "Not worth getting shot over." },
        ],
      };
    },
  },
  {
    // The dead are new: still in their uniforms. Putting the first ones down weighs on everyone.
    id: "hc_newdead", weight: (st) => 3 * hcFade(st, 20), when: (st) => hcYear(st),
    card: (st, p) => ({
      title: "Still in uniform",
      text: "A police officer stands in the middle of the road, uniform neat and radio still crackling on their shoulder, swaying. A week ago they were directing traffic. Their eyes are milky, and the holster is still buttoned.",
      choices: [
        {
          label: "Put them down", hint: "Everyone on the team mood -3 (it is all still new); 20% someone is hurt; the pistol and its rounds are yours",
          resolve: (s) => {
            cheer(partyMembers(s, p), -3);
            const hurtTxt = s.rng.chance(0.2) ? ` It takes longer than it should. ${injureRandom(s, p, 5, 15, "putting down the dead")}` : "";
            if (!s.parties.includes(p)) return hurtTxt.trim();
            const it = lootItem("pistol", "survivor", s.rng);
            const gun = addGearToCargo(s, p, it) ? `a ${it.name.toLowerCase()}` : "nothing (no room for the pistol)";
            return `Nobody talks about it afterwards (mood -3). The team takes ${gun} and ${addCargo(s, p, "ammo", s.rng.int(8, 15))}.${hurtTxt}`;
          },
        },
        { label: "Let them be", hint: "Everyone on the team mood -1", resolve: (s) => { cheer(partyMembers(s, p), -1); return "The team goes round by the gardens and does not look back."; } },
      ],
    }),
  },
  {
    // While the Guard stands it drops relief by air; not every pallet lands where it was meant to.
    id: "hc_drop", weight: 1.2, when: (st, p, t) => hcYear(st) && !t.loc && ["plains", "hills"].includes(t.terrain) && guardStands(st),
    card: (st, p) => ({
      title: "A relief drop",
      text: "A parachute is draped over a hedge at the edge of a field, and under it a pallet stamped with the National Guard's eagle: ration boxes, bottled water, a medical chest. The smoke from its marker is still drifting. Others will have seen it come down.",
      choices: [
        { label: "Grab what you can and go (1 hour)", resolve: (s) => { delay(p, 1); return `The team takes ${addCargo(s, p, "food", 3, "military")}, ${addCargo(s, p, "water", 6)} and ${addCargo(s, p, "meds", 1)}.`; } },
        {
          label: "Take it all (3 hours)", hint: `Twice as much; ${pct(HC_DROP.risk)} armed strangers come for it and someone is hurt`,
          resolve: (s) => {
            delay(p, 3);
            const got = `${addCargo(s, p, "food", 6, "military")}, ${addCargo(s, p, "water", 12)} and ${addCargo(s, p, "meds", 3)}`;
            return s.rng.chance(HC_DROP.risk) ? `The team gets ${got}, but not before others arrive with guns. ${injureRandom(s, p, 10, 30, "over a relief drop")}` : `Every box: ${got}.`;
          },
        },
      ],
    }),
  },
];
export const HC_DROP = { risk: 0.35 };
// Mood never drops below zero.
function sulk(s, by) {
  s.mood = Math.max(0, (s.mood || 0) - by);
}
// Everyone on a team's mood up (or down), between 0 and 100.
function cheer(list, by) {
  for (const m of list) m.mood = Math.max(0, Math.min(100, (m.mood || 0) + by));
}
// The rough way from one tile to another ("north-east"); y grows to the south.
function compass(state, from, to) {
  if (from === to) return "right here";
  const a = state.tiles[from], b = state.tiles[to];
  const i = ((Math.round(Math.atan2(a.y - b.y, b.x - a.x) / (Math.PI / 4)) % 8) + 8) % 8;
  return ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"][i];
}

const ALL_EVENTS = [...EVENTS, ...HC_EVENTS];
export const TRAVEL_EVENT_IDS = ALL_EVENTS.map((e) => e.id);
// Whether an event can come on a tile, and its card (tools/roadeventstest.js forces an event).
export const travelEventFits = (state, p, id, tileId) => !!ALL_EVENTS.find((e) => e.id === id)?.when(state, p, state.tiles[tileId]);
export function travelEventCard(state, p, id, tileId) {
  const ev = ALL_EVENTS.find((e) => e.id === id);
  return guarded(state, p, ev.card(state, p, state.tiles[tileId]), tileId);
}

export function rollTravelEvent(state, p, tileId) {
  const t = state.tiles[tileId];
  // A horde on the tile always forces an encounter.
  const horde = state.hordes.find((h) => h.tile === tileId);
  if (horde) return guarded(state, p, hordeCard(state, p, horde), tileId);
  // Worn vehicles break down more often.
  // Several vehicles: one roll for any of them, then which (vehicles.js breakdownRoll); one vehicle: its own roll.
  const v = p.vehicle ? breakdownRoll(state, p, p.burden ? p.burden.fill : 0) : null;
  if (v) return guarded(state, p, breakdownCard(state, p, v), tileId);
  const owner = typeof t.owner === "number" ? factionById(state, t.owner) : null;
  let chance = 0.05 + t.infection * 0.1 + TERRAIN[t.terrain].traffic * 0.4 + (owner && attitude(owner) === "Hostile" ? 0.12 : 0) + (owner && attitude(owner) !== "Hostile" ? 0.06 : 0);
  chance *= STANCES[p.stance].events * (marchingNow(state, p) ? NIGHT_MARCH.EVENTS : isNight(state) ? 1.2 : 1) * travelEffects(state, state.hour, tileId).events; // storms and blizzards where the team is: more trouble on the road (weather.js)
  if (state.bases.some((b) => b.tile === tileId)) return null;
  // Conflicts with other people (or a surge of the dead): see conflicts.js. Roadblocks and ambushes live there.
  const conflict = rollConflict(state, p, tileId);
  if (conflict) return conflict;
  // People on the move (wanderers.js): survivors, armed strangers, a military squad. Its own dice (hash01): with
  // nobody met the rest of this roll is unchanged. A hostile squad's checkpoint card is added by conflicts.js.
  const hourBefore = p.eventHour;
  const met = rollWanderer(state, p, tileId);
  if (met) return guarded(state, p, met, tileId);
  // A hostile squad's checkpoint (conflicts.js) took this hour's card during that roll: no second card. Only that:
  // callers decide for themselves whether an event already came this hour.
  if (p.eventHour === state.hour && hourBefore !== state.hour) return null;
  if (!state.rng.chance(chance)) return null;
  const options = ALL_EVENTS.filter((e) => e.when(state, p, t)); // HC_EVENTS: only in hardcore's first year
  if (!options.length) return null;
  const ev = state.rng.weighted(options, (e) => (typeof e.weight === "function" ? e.weight(state, p) : e.weight));
  return guarded(state, p, ev.card(state, p, t), tileId);
}

// Every travel card belongs to its team: it is dropped when the team is gone or the person it is about has
// died or left (parties.js cardStale, pruneCards), and if it is answered anyway its choices do nothing.
function guarded(state, p, card, tileId) {
  card.where = tileLabel(state, tileId);
  card.partyId = p.id;
  for (const c of card.choices) {
    const run = c.resolve; // set on the choice itself (not a copy), so a live `disabled` getter stays live
    c.resolve = (s) => (cardStale(s, card) ? "Too late: the team is no longer there." : run(s));
  }
  return card;
}

function breakdownCard(state, p, v) {
  // The card can be answered after the vehicle was left behind (a second breakdown card the same hour).
  const here = (s) => p.vehicle && partyVehicles(s, p).includes(v);
  // With other vehicles: left behind alone when the rest still seat everyone (vehicles.js fleetProblem), else they all stay.
  const others = () => partyVehicles(state, p).filter((x) => x !== v);
  // Pick-list 3b: the others go on even when they cannot seat everyone (walkers.js: those without a seat walk).
  const alone = () => others().length > 0 && (others().some((x) => !isBike(x)) || others().reduce((a, x) => a + (x.count || 1), 0) >= p.members.length);
  const short = () => Math.max(0, p.members.length - seatsOf(fleetOf(others())));
  const gone = `The ${v.name} is no longer with the team.`;
  return {
    title: "Breakdown",
    text: isBike(v) ? `A tire blows and a chain snaps on one of the bikes. Condition ${Math.round(v.condition)}%.` : `The ${v.name} coughs and dies. Condition ${Math.round(v.condition)}%, fuel ${Math.round(v.fuel)}.`,
    partyId: p.id,
    vehicleId: v.id, // dropped if the team loses this vehicle before it is answered (parties.js cardStale)
    choices: [
      { label: "Repair it on the spot", hint: `${hint(state, p, "mechanics", 9)}. Success: 2 hours. Failure: 8 hours and more wear`, resolve: (s) => !here(s) ? gone : check(s, p, "mechanics", 9).ok ? (repairDelay(s, p, v, 2), "Fixed in two hours.") : (repairDelay(s, p, v, 8), (v.condition = Math.max(1, v.condition - 10)), "It takes most of the day to get it running, and it is worse for wear.") },
      {
        label: "Use a spare part", hint: "1 car part (or 2 machine parts): quick fix, +10 condition",
        get disabled() { return !carPartsCost((k) => carried(p, k), 1).ok; }, // what the team carries now, not when the card was made
        resolve: (s) => {
          if (!here(s)) return gone;
          const pay = carPartsCost((k) => carried(p, k), 1); // vehicles.js: a car part, else 2 machine parts
          if (!pay.ok) return "No spare part left. Nothing was done.";
          if (pay.car) takeSupply(p, "carparts", pay.car);
          if (pay.parts) takeSupply(p, "parts", pay.parts);
          if (!v.destroyed) v.condition = Math.min(100, v.condition + 10); // a wreck (launchers.js) stays one
          repairDelay(s, p, v, 1);
          return "Back on the road quickly.";
        },
      },
      {
        label: "Abandon it",
        get hint() { return alone() ? `Leave the ${v.name} here (it is marked on the map); the team goes on in its other vehicles${short() ? `, ${short()} on foot beside them (walking pace until a seat turns up)` : ""}. Cargo they cannot carry stays in it` : "Leave it here (it is marked on the map) and continue on foot. Cargo the team cannot carry stays in it"; },
        resolve: (s) => {
          if (!here(s)) return gone;
          if (alone()) { const left = leaveVehicle(s, p, partyTile(p), "broke down", v); return `The ${v.name} is left by the road. The team goes on without it.${left ? ` Left in it: ${left}.` : ""}`; }
          const left = leaveVehicle(s, p, partyTile(p), "broke down");
          return `The ${v.name} is left by the road. The team walks on.${left ? ` Left in it: ${left}.` : ""}`;
        },
      },
    ],
  };
}

// The horde's score (hordes.js hordeScore) sets how hard it is to hide from and how badly a fight goes; on a
// hive's land the dead are tougher still (hives.js zombieToughness).
export function hordeCard(state, p, horde) {
  const drive = () => p.vehicle === true && partyFuel(state, p) >= 4; // a vehicle needs fuel in it to outrun anything (bikes cannot)
  const score = hordeScore(horde.size);
  const land = 1 + zombieToughness(state, horde.tile) * 0.35;
  const tough = land * mixWeight(horde.mix, "weight", horde.elite); // a hive's special dead among them (zombietypes.js)
  const dc = 5 + Math.round(score / 3);
  return {
    title: `Horde of ${horde.size}`,
    text: `A horde of about ${horde.size} (score ${score}${horde.bosses ? `, a ${BOSS_NAMES.horde} lumbering at its head` : ""}) is moving across ${tileLabel(state, horde.tile)}, right in your path.${land > 2 ? " This close to a hive the dead are much tougher." : ""}${horde.mix && mixText(horde.mix, horde.size) ? ` Among them: ${mixText(horde.mix, horde.size)}.` : ""}`,
    partyId: p.id,
    choices: [
      { label: "Hide and let it pass (6 hours)", hint: hint(state, p, "stealth", dc), resolve: (s) => { delay(p, 6); return check(s, p, "stealth", dc).ok ? "The horde passes by." : `Something gives you away. ${injureRandom(s, p, 20, 60, "hiding from a horde")}`; } },
      {
        label: "Outrun it",
        get hint() { return drive() ? "By vehicle: safe, uses 4 fuel" : p.vehicle === true ? "Less than 4 fuel: the vehicle cannot outrun it. On foot: risky" : "On foot: risky"; },
        resolve: (s) => {
          if (drive()) { useFuel(s, p, 4); return "The vehicle tears through and away."; }
          const dry = p.vehicle === true ? "The tank is all but dry, so the team runs for it on foot and comes back for the vehicle after. " : "";
          return s.rng.chance(0.5) ? `${dry}You run until your lungs burn, and make it.` : `${dry}Not everyone is fast enough. ${injureRandom(s, p, 30, 80, "running from a horde")}`;
        },
      },
      {
        label: "Fight",
        // The team's "Retreat if it goes badly" policy (breakoff.js) is shown on the card and decides when it breaks off.
        fight: { horde: true },
        get hint() { const pol = teamPolicy(state, p); return `Very dangerous.${pol === "never" ? " The team fights it out" : ` Retreat ${RETREAT_POLICIES[pol].short}: the team breaks off between wounds, the horde only partly thinned, and runs for it`}`; },
        resolve: (s) => {
          const members0 = partyMembers(s, p);
          const n = members0.length;
          const power = members0.reduce((a, m) => a + combatPower(m), 0);
          const cut = Math.round((power * 2) / tough);
          const shot = takeShots(p, members0, 40); // a bow's share in arrows (picked up again only if the team fights it out)
          // One wound for a small horde, two for a medium one, three for a large one (and one more for a Wallbreaker).
          // Each wound is a round of the fight; between rounds the team may break off by its policy.
          const hits = Math.min(4, 1 + (score >= 6 ? 1 : 0) + (score >= 13 ? 1 : 0) + (horde.bosses ? 1 : 0));
          const policy = teamPolicy(s, p);
          const out = [];
          let rounds = hits;
          for (let i = 0; i < hits && s.parties.includes(p) && partyMembers(s, p).length; i++) {
            out.push(injureRandom(s, p, i ? 20 : 30, (i ? 60 : 80) * Math.min(1.5, tough), "fighting a horde"));
            const now = s.parties.includes(p) ? partyMembers(s, p) : [];
            const look = { turning: cut < horde.size, n, hit: i + 1, down: n - now.length, badly: now.filter((m) => m.health < 50).length };
            if (i < hits - 1 && now.length && wantsOut(policy, look)) { rounds = i + 1; break; }
          }
          horde.size = Math.max(0, horde.size - Math.round((cut * rounds) / hits));
          // Too few left to be a horde: it is gone from the map.
          if (horde.size < 5 && s.hordes.includes(horde)) s.hordes.splice(s.hordes.indexOf(horde), 1);
          // Fought out: about half the arrows are picked up again (world.js ARROWS.BACK); broken off, none.
          if (shot.arrows && rounds === hits && s.parties.includes(p) && partyMembers(s, p).length) {
            const back = arrowsBack(shot.arrows);
            if (back) { p.supplies.arrows = (p.supplies.arrows || 0) + back; out.push(`${back} of the ${shot.arrows} arrows shot were picked up again.`); }
          }
          if (rounds < hits && s.parties.includes(p)) {
            // Broken off: everyone runs for it with the dead on their heels (the tactical escape check).
            const run = breakOff(s, partyMembers(s, p), { enemy: { kind: "zombies", count: Math.min(12, Math.max(1, Math.round(horde.size / 4))) }, tiles: [3, 6], tile: partyTile(p), cause: "running from a horde", vehicle: p.vehicle, stealthy: p.stance === "stealthy", party: p });
            out.push(`The team broke off (${RETREAT_POLICIES[policy].short}) after ${rounds} of ${hits} rounds and ran for it: ${run.lines.join(" ")}`);
            wipeIfEmpty(s, p);
          }
          return out.join(" ").trim();
        },
      },
    ],
  };
}

// ---------- trade-route convoys: escort table from the design doc ----------
const ESCORT_MULT = {
  light:    { zombie: 0.6, small: 1.5, large: 1.0 },
  standard: { zombie: 1.0, small: 1.0, large: 1.0 },
  heavy:    { zombie: 1.5, small: 0.4, large: 1.6 },
};

export function convoyLegEvent(state, p, tileId) {
  // Supply runs between your own bases use the same table: the escort tier comes from the crew size
  // and their stance scales how often something happens.
  const supply = p.routeKind === "supply";
  const route = supply ? null : state.routes.find((r) => r.id === p.routeId);
  const escort = supply ? p.escort : route && route.escort;
  if (!ESCORT_MULT[escort]) return;
  const m = ESCORT_MULT[escort];
  const sm = supply ? STANCES[p.stance]?.events ?? 1 : 1;
  const t = state.tiles[tileId];
  const rng = state.rng;
  const members = partyMembers(state, p);
  const bows = archerCount(members); // the escort's bows shoot arrows: the +2 for being well supplied counts them too
  const power = members.reduce((a, s) => a + combatPower(s), 0) + (totalRounds(p.supplies) > 10 || (bows && p.supplies.arrows > 10) ? 2 : 0);
  const where = tileLabel(state, tileId);
  if (rng.chance((0.02 + t.infection * 0.05) * m.zombie * sm)) {
    if (power > 6 + t.infection * 8) log(state, `Convoy fought off the dead near ${where}.`, "info");
    else {
      log(state, `The dead swarmed the convoy near ${where}. ${injureRandom(state, p, 15, 50, "defending the convoy")}`, "danger");
    }
    // Six shots from the escort's packed supplies (never the cargo): the bows' share in arrows, lost (the convoy does
    // not stop to look for them).
    const bowShots = bows ? Math.round((6 * bows) / Math.max(1, members.length)) : 0;
    spendAmmo(p.supplies, 6 - bowShots); // rounds.js: any calibre, the cheapest first
    if (bowShots) p.supplies.arrows = Math.max(0, (p.supplies.arrows || 0) - bowShots);
    return;
  }
  const hostileNear = factionNear(state, tileId, (f) => attitude(f) === "Hostile", 4);
  if (rng.chance((0.02 + (hostileNear ? 0.03 : 0)) * m.small * sm)) {
    if (power >= 8) log(state, `Small-time raiders eyed the convoy near ${where} and backed off.`, "info");
    else {
      for (const k of Object.keys(p.cargo.supplies)) p.cargo.supplies[k] = Math.floor(p.cargo.supplies[k] * 0.7);
      log(state, `Raiders hit the convoy near ${where} and took part of the cargo.`, "danger");
    }
    return;
  }
  const aggressive = factionNear(state, tileId, (f) => isAggressiveType(f) && attitude(f) === "Hostile", 5);
  if (aggressive && rng.chance(0.03 * m.large * sm)) {
    const att = aggressive.pop * 0.3;
    if (power > att) log(state, `${aggressive.name} sent a war party against the convoy near ${where}. The escort held.`, "good");
    else {
      for (const k of Object.keys(p.cargo.supplies)) p.cargo.supplies[k] = 0;
      log(state, `${aggressive.name} ambushed the convoy near ${where} with a large force. Cargo lost. ${injureRandom(state, p, 30, 80, `when ${aggressive.name} hit the convoy`)} ${injureRandom(state, p, 20, 70, `when ${aggressive.name} hit the convoy`)}`, "death");
    }
  }
}

