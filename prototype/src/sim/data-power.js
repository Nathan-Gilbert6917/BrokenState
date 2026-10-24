// @ts-check
// The power grid's pieces (2026-10-21, the user's request: "Add spotlights as a placeable item on wall supports or on
// the ground to provide more light during night raids on your base. Builds like this require a generator add a system
// for power management where your base needs to get generators (Carried in the carried slot using 2 hands and are
// heavy) there are different generators down from house generators up to military generators when these generators
// are running it increases heat that attracts zombies and run on fuel per hour using 0.x per hour depending on
// generator. Make buildings require x power to have lights inside to turn on and off, fridges and other buildables
// require power as well. Add other builds that require power and make sense for base building during a zombie
// apocalypse. Have ammo crafter that requires no power but is slower and a machine ammo crafter that is quicker and
// more yield. Have a panel in the base to turn on and off machines/buildings that require power. When they are off
// they can not be used for machines or for buildings reduce mood as your survivors do not have lights or cool during
// summer warmth during the winter these work when the buildings are on.").
// Plain data that imports nothing; the rules are sim/electric.js (and power.js for the supply and the demand).
//
// MORE OF THE GRID (2026-10-24, the user's request: "Add some more recipes for building that would use electronics.
// Add pre-requisite items as well as what makes sense; add items if needed."): five more things built with
// electronics, each a real mechanic (the numbers below SOLAR, BATTERY, ALARM, HEATER, CHARGER; the rules in power.js
// powerStatus for the sources, electric.js for the rest), each with a Mechanics hand, its tools (data-tools.js
// BUILD_TOOLS) and, for the two power sources, the Solar Installer's Handbook (blueprints.js solarinst):
//   solar_array      a power SOURCE with no fuel: SOLAR.out power an array at full sun, by the hour (daylight from
//                    SOLAR.from to SOLAR.to, the first and last SOLAR.shoulder hours at half), the season (SOLAR.season)
//                    and the sky over the base (SOLAR.sky: clear 1, overcast half, snow next to nothing, a blizzard
//                    nothing). Nothing at night, no Heat, no refuelling; a storm wears it (hail and wind).
//   battery_bank     a bank of car batteries on a charge controller: stores power that would go to waste (the sun's
//                    surplus, and what a flat-burn generator, the portable set and the house sets, gives beyond the
//                    demand, since they burn the same whatever they power), BATTERY.cap power-hours a bank, in or out at
//                    most BATTERY.rate an hour, BATTERY.eff of what goes in comes out. It is the LAST source drawn (the
//                    sun first, then the generators, then the bank), but it counts as supply before a generator is
//                    started, so a small night load runs off the bank and the generator stays off.
//   perimeter_alarm  motion sensors on the approaches and a siren in the yard, ALARM.need power from dusk to dawn: an
//                    attack at night never catches the base asleep (watch.js surpriseAt, through defences.js
//                    armoryDefence: the alarm's wake ALARM.wake of everyone's combat power on the walls unwarned, more
//                    than the armory's tripwire), and whatever comes within ALARM.tiles of the base at night is spotted
//                    with nobody on watch (watch.js lookoutsSpot: the warning card).
//   elec_heater      a bank of electric space heaters on a general building's floor (a fitting): HEATER.need power on a
//                    day that wants heating (upkeep.js heatRate: a freezing day or a chill night), and HEATER.heads of
//                    the people fed here are warmed by it instead of the fires (upkeep.js heatUse: their share of the
//                    wood, 15 wood a head on a freezing day, is not burned). Real heat, not the breaker panel's comfort
//                    circuit (that one is mood).
//   charging_station a charger bench on a general building's floor (a fitting): CHARGER.need power while anything
//                    here wants charging; each powered hour puts CHARGER.rate uses back into the most drained
//                    rechargeable gear at the base (GEAR recharge: electronic ear defenders, a military headset; in the
//                    stores or on anyone here), so no battery packs are spent at a bench on them (repair.js recharge).
// Wear and repairs (POWER_FIXTURES below): the sources and the alarm are repaired with electronics; demolishing any of
// them gives half its scrap, parts, electronics, metal sheets and car parts back (buildings.js demolishRefund).
// AI groups: not yet, as the rest of the grid (electric.js header: their machines are coarse works with no power budget).
// Merged by: data.js (POWER_GEAR into GEAR), buildings.js (POWER_BUILDINGS into BUILDINGS), basemap.js (POWER_FOOT into
// FOOT), loot.js (POWER_TAGS into ITEM_TAGS), crafting.js (POWER_CRAFTS into CRAFTS), breakdowns.js (POWER_FIXTURES
// into FIXTURES).
//
// THE GENERATORS YOU CARRY (GENSETS). Five found generators, the quiet camping inverter up to the Army's tactical set.
// Each is an item while it is in the stores or on the move (bulky, both arms: the In arms slot, a cart, the team's
// cargo, a vehicle; heavy: the bigger sets weigh more than anyone carries comfortably), and a generator once it is SET
// on the base map's open ground from the stores (electric.js setPlaced, the Build list's Power group). Set, it is a
// generator in every way power.js knows (isGen): it runs only while something draws power, from its own tank refuelled
// each morning, wears and breaks (breakdowns.js POWER_FIXTURES), and makes Heat while it runs (hordes.js baseHeat).
// Demolish picks it up again, whole. It is never upgraded (the built Generator's tiers are its own road).
//   out        power it gives
//   idle/full  fuel AN HOUR (the user's "0.x per hour") at no load / at full load (power.js genBurn by the share
//              drawn; a cheap set with idle = full runs flat out whatever it powers)
//   tank       fuel its tank holds (refuelled once a day: about a day's running at full load)
//   heat       Heat at the base while it runs (an inverter whispers, a contractor's set roars, the Army's is muffled)
//   w, h       its footprint on the base map
//   kg, value  the item's weight and worth
/** @type {Record<string, { name: string, out: number, idle: number, full: number, tank: number, heat: number, w: number, h: number, kg: number, value: number, what: string }>} */
export const GENSETS = {
  genset_inverter:   { name: "Inverter generator",          out: 3,  idle: 0.03, full: 0.06, tank: 1.5, heat: 1, w: 1, h: 1, kg: 22,  value: 40,  what: "a quiet suitcase inverter set off a camping trip or an RV" },
  genset_house:      { name: "House generator",             out: 5,  idle: 0.08, full: 0.08, tank: 2,   heat: 3, w: 1, h: 1, kg: 38,  value: 45,  what: "a wheeled petrol generator out of a garage, kept for the storm season" },
  genset_contractor: { name: "Contractor generator",        out: 9,  idle: 0.1,  full: 0.16, tank: 3.5, heat: 5, w: 2, h: 1, kg: 62,  value: 70,  what: "a job-site generator on a steel cage frame, loud as a chainsaw" },
  genset_standby:    { name: "Home standby generator",      out: 14, idle: 0.1,  full: 0.2,  tank: 5,   heat: 6, w: 2, h: 1, kg: 95,  value: 90,  what: "a liquid-cooled standby set unbolted from beside a big house or a clinic, with its transfer switch" },
  genset_military:   { name: "Military tactical generator", out: 20, idle: 0.08, full: 0.25, tank: 7,   heat: 4, w: 2, h: 2, kg: 140, value: 140, what: "the Army's skid-mounted diesel set: muffled, governed, built to run for weeks" },
};
export const GENSET_KINDS = Object.keys(GENSETS);
// At most this many found generators set at one base (besides up to two built Generators).
export const GENSET_MAX = 4;

// THE OTHER PIECES YOU SET FROM THE STORES (electric.js setPlaced):
//   spotlamp  the mounted spotlight: on a wall stand or the open ground; draws SPOT.need while it is night (dusk to
//             dawn) and lights the battle map round it in a night fight at the base (fort.js fixedLit: SPOT.R cells on
//             the ground, SPOT.STAND_R from a wall stand, SPOT.aim to hit in its light).
//   fridge    a refrigerator, set on a general building's floor like furniture: FRIDGE.room days of food kept at
//             FRIDGE.factor of its shelf a day while it has power (storage.js), a pantry when it has none.
//             By the numbers (defences.js defenceMult, a horde at night): +hold each lit, at most holdMax.
export const SPOT = { need: 1, R: 6, STAND_R: 8, aim: 10, hold: 0.02, holdMax: 0.1 };
export const FRIDGE = { need: 1, room: 40, factor: 0.25 };

// THE BREAKER PANEL (buildings.js breaker): the base's switchboard and its wiring. With one standing (not broken), the
// buildings below are on the grid: each draws its circuit's power (CIRCUITS: lights always, climate on a hot or a
// cold day) and its people feel it (POWER_MOOD). Without one nothing is wired: no draw, no mood either way (candles and
// the fire, as before). The Power card is the switchboard: every powered thing with its switch, the circuits by
// building, all of them on or off at once.
//   CIRCUITS[type] = [light, climate]: power for the lights inside, and for the fans and the air conditioner in a hot
//   spell or the electric heaters in a cold one (0: a workshop or a store needs no comfort).
/** @type {Record<string, [number, number]>} */
export const CIRCUITS = {
  bunkhouse: [1, 1], barracks: [2, 2], common_room: [1, 1], chapel: [1, 1], canteen: [1, 1],
  infirmary: [1, 1], field_hosp: [1, 1], clinic: [1, 1], hospital: [2, 2],
  gen_hut: [1, 1], gen_cabin: [1, 1], gen_lodge: [2, 1], gen_hall: [2, 2], gen_barn: [3, 2],
  kitchen: [1, 0], machine_shop: [1, 0], radio: [1, 0], garage: [1, 0], armory: [1, 0], cells: [1, 0], jailhouse: [1, 0], huntcabin: [1, 0], greenhouse: [1, 0],
};
// A hot or a cold day (electric.js climateNeed, by the base's weather today): hot from a heat wave, a high of HOT_HI or a
// mean of HOT_MEAN; cold at a mean of COLD_MEAN or below.
export const CLIMATE = { HOT_HI: 28, HOT_MEAN: 22, COLD_MEAN: 3 };
// A day's mood at a wired base (relations.js moodFactors, electric.js powerMood): lit +lit; some buildings dark
// −dark × the share dark; on a hot or a cold day comfy +comfy with the climate served, −harsh × the share without.
export const POWER_MOOD = { lit: 0.5, dark: 1, comfy: 1, harsh: 1.5 };

// MACHINES THAT RUN ON POWER (power.js POWER_USERS: need, served in its order):
//   ammo_press     the machine ammo crafter: a powered progressive press. A station like the ammo bench (its operator,
//                  its scrap, its standing orders, the reloading orders too) that runs ONLY with power: unpowered or
//                  switched off it stands idle. Powered: PRESS.in × the bench's scrap into PRESS.out × its rounds (more
//                  rounds a scrap), and the reloading orders at PRESS.rate × a reloading bench's rounds a day.
//   elec_pump      an electric pump down a well: PUMP.water more water a day for each well it serves while powered.
//   fence_charger  a charger on the wire: while powered the base holds back FENCE.hold more of a horde, and on the
//                  battle map the wire bites (FENCE.DEAD to the dead that reach it, FENCE.LIVING more to the snagged).
export const PRESS = { in: 2, out: 3, rate: 2.5 };
export const PUMP = { water: 8 };
export const FENCE = { hold: 0.06, DEAD: [5, 10], LIVING: [3, 6] };

// MORE OF THE GRID (2026-10-24; see the header). The two sources (power.js powerStatus sources):
//   SOLAR     out: power an array at full sun; from / to: daylight hours (the clock's), shoulder: the first and last
//             hours of it at half; sky: × by the weather over the base now (weather.js WEATHER keys; a key missing: 0.5);
//             season: × by the season (weather.js SEASONS keys). An array in a summer noon gives 4; a clear winter noon
//             1.6; a winter overcast noon 0.8. electric.js solarFactor / solarOut.
//   BATTERY   cap: power-hours a bank holds; rate: the most in or out an hour a bank; eff: the share of what goes in that
//             comes back out (lead-acid, an inverter). A bank runs a fridge and a spotlight (2) for a 10-hour night.
export const SOLAR = {
  out: 4, from: 6, to: 20, shoulder: 2,
  sky: { clear: 1, frost: 0.9, heat: 1, drought: 1, overcast: 0.5, fog: 0.4, rain: 0.35, storm: 0.2, snow: 0.15, blizzard: 0 },
  season: { spring: 0.75, summer: 1, autumn: 0.7, winter: 0.4 },
};
export const BATTERY = { cap: 20, rate: 4, eff: 0.8 };
// The three users (power.js POWER_USERS; electric.js alarmOn, heaterHeads, chargeHour):
//   ALARM     need: power from dusk to dawn; tiles: how far out its sensors spot an attack at night with nobody on
//             watch (watch.js lookoutsSpot); wake: everyone's share of their combat power on the walls unwarned
//             (defences.js guardHold; the armory's tripwire is GEAR.tripwire.defence.alarm 0.5).
//   HEATER    need: power on a day that wants heating; heads: the people one warms (their heating is not burned).
//   CHARGER   need: power while anything wants charging; rate: uses put back an hour into one item.
export const ALARM = { need: 1, tiles: 1, wake: 0.6 };
export const HEATER = { need: 2, heads: 5 };
export const CHARGER = { need: 1, rate: 3 };

// The items (data.js Object.assign(GEAR, POWER_GEAR)). slot "pack" + bulky + twoHands: carried in both arms only, or in
// a cart, the team's cargo or a vehicle; kept in the base's armory (its weight counts against the base's storage).
// placed: the building type it becomes when set (electric.js).
/** @type {Record<string, any>} */
export const POWER_GEAR = Object.fromEntries(GENSET_KINDS.map((k) => {
  const g = GENSETS[k];
  const fuel = g.idle === g.full ? `${g.full} fuel an hour while it runs` : `${g.idle}–${g.full} fuel an hour (by the load)`;
  return [k, { name: g.name, slot: "pack", skill: null, power: 0, req: 0, value: g.value, noise: 0, weight: g.kg, cat: "tools", bulky: true, twoHands: true, placed: k,
    desc: `A generator: ${g.what}. ${g.kg} kg: both arms (In arms), a cart or a vehicle. Set it on a base's open ground (the base map's Build list, Power) and it gives ${g.out} power for ${fuel} from a ${g.tank}-fuel tank, refuelled every morning; +${g.heat} Heat while it runs. Demolish picks it up again.` }];
}));
POWER_GEAR.spotlamp = { name: "Mounted spotlight", slot: "pack", skill: null, power: 0, req: 0, value: 16, noise: 0, weight: 9, cat: "tools", bulky: true, twoHands: true, placed: "spotlamp",
  desc: `A big halogen work light on a swivel bracket and a cable reel: too heavy to aim by hand. Set it on a wall stand or the open ground at a base (the base map's Build list, Power): with power (${SPOT.need} a night) it lights ${SPOT.R} cells round it in a night fight there (${SPOT.STAND_R} from up on a wall stand), and your people hit better in its light.` };
POWER_GEAR.fridge = { name: "Refrigerator", slot: "pack", skill: null, power: 0, req: 0, value: 22, noise: 0, weight: 60, cat: "household", bulky: true, twoHands: true, placed: "fridge",
  desc: `A kitchen fridge-freezer, cord coiled on its back. 60 kg: both arms, a cart or a vehicle. Set it inside a hut, cabin, lodge, hall or barn (the base map's Build list, Power): with ${FRIDGE.need} power it keeps ${FRIDGE.room} days of fresh food at a quarter of its shelf life a day; without power it is only a cupboard.` };

// The recipes (crafting.js Object.assign(CRAFTS, POWER_CRAFTS)): the spotlight from a work light's parts at a workshop.
/** @type {Record<string, any>} */
export const POWER_CRAFTS = {
  spotlamp: { gear: "spotlamp", in: { scrap: 4, parts: 1, electronics: 1 }, hours: 6, skill: "mechanics", min: 2, needs: "workshop" },
};

// The placed pieces and the new buildings (buildings.js Object.assign(BUILDINGS, POWER_BUILDINGS)). The set pieces:
// furniture (set from the stores, never queued for the builders; picked up by Demolish) + power (the Build list's
// Power group); no cost and no hours: the item is the cost. max: per base.
/** @type {Record<string, any>} */
export const POWER_BUILDINGS = {
  ...Object.fromEntries(GENSET_KINDS.map((k) => [k, { name: GENSETS[k].name, furniture: true, grid: true, set: true, cost: {}, hours: 0, max: GENSET_MAX, desc: `${POWER_GEAR[k].desc.split(" Set it")[0]} Set from the stores onto the open ground: ${GENSETS[k].out} power, +${GENSETS[k].heat} Heat while it runs. Demolish picks it up again (back into the stores).` }])),
  spotlamp: { name: "Mounted spotlight", furniture: true, grid: true, set: true, cost: {}, hours: 0, max: 24, desc: `A halogen work light on a bracket, set on a wall stand or the open ground: with power it lights ${SPOT.R} cells round it in a night fight at the base (${SPOT.STAND_R} from a wall stand), +${SPOT.aim} to hit in its light. Draws ${SPOT.need} power from dusk to dawn. Demolish picks it up again.` },
  fridge: { name: "Refrigerator", fit: true, furniture: true, grid: true, set: true, cost: {}, hours: 0, max: 8, desc: `A fridge set on a general building's floor: with ${FRIDGE.need} power, ${FRIDGE.room} days of food room that keeps fresh food four times longer than the shelf. Demolish picks it up again.` },
  // The breaker panel: the base's switchboard (see CIRCUITS above). A cabinet of breakers, a run of cable to every
  // building and the meter: priced as a small machine (a vacuum sealer's electronics, less scrap), Mechanics 2.
  breaker: { name: "Breaker panel", plot: "utility", grid: true, cost: { scrap: 8, parts: 1, electronics: 1 }, hours: 10, max: 1, req: { mechanics: 2 },
    desc: "A breaker cabinet, a meter and cable run to every building: the base's switchboard (Power card). With it the buildings are wired: each one's lights draw power, and the fans or heaters too on a hot or a cold day. Lit and comfortable, the people here are happier (+0.5 mood a day, +1 more on a hot or a cold day); a building left dark or switched off makes them miserable instead. Without a panel nothing is wired and nobody misses it. Needs a Mechanics 2+ survivor here to build." },
  // The machine ammo crafter (see PRESS above): dearer than the ammo bench (it is one, motorised) and the reloading
  // bench's upgrade; a workbench at the base as for any ammo bench.
  ammo_press: { name: "Ammo press", plot: "utility", grid: true, cost: { scrap: 30, parts: 4, electronics: 2, gunparts: 2 }, hours: 36, max: 2, station: "ammo", bench: 2, req: { mechanics: 4 }, heat: 0.5,
    desc: `Workshop station: a motorised progressive press. One operator turns ${PRESS.in}× an ammo bench's scrap into ${PRESS.out}× its rounds a day (more rounds a scrap), and works the reloading orders ${PRESS.rate}× as fast as a reloading bench. It runs ONLY on power (2 while its operator works): with none, or switched off, it stands idle. The ammo bench needs no power but is slower. Needs a workbench here and a Mechanics 4+ survivor to build.` },
  elec_pump: { name: "Electric well pump", plot: "utility", grid: true, cost: { scrap: 12, parts: 2, electronics: 1 }, hours: 12, max: 2, req: { mechanics: 2 },
    desc: `A submersible pump down a well, on a pressure tank: +${PUMP.water} water a day for each well it serves (one pump a well) while it has power (1). Needs a well here and a Mechanics 2+ survivor to build.` },
  fence_charger: { name: "Fence charger", plot: "utility", grid: true, cost: { scrap: 10, parts: 1, electronics: 2 }, hours: 8, max: 1, tab: "defenses", size: "outpost", req: { mechanics: 2 },
    desc: `A high-voltage energizer clipped to the base's barbed and razor wire: while it has power (2) the base holds back ${Math.round(FENCE.hold * 100)}% more of a horde, and on the battle map the wire bites: the dead that reach it are shocked (${FENCE.DEAD[0]}–${FENCE.DEAD[1]}), and anyone snagged on it more. Needs a barbed wire fence or concertina wire here.` },
  // MORE OF THE GRID (2026-10-24; the header). The two sources (source: true; power.js powerStatus) want the Solar
  // Installer's Handbook (blueprints.js solarinst: panels, charge controllers and inverters are one trade) and a
  // Mechanics 3 hand, as the generator does. The array is priced above the generator in electronics (its inverter and
  // controller: 4) and roofed in metal sheets for its frame; the bank in car batteries (carparts) and the controller's
  // electronics. The bank needs something to charge it: a generator or a solar array here (buildings.js canBuild).
  solar_array: { name: "Solar panel array", plot: "utility", grid: true, source: true, cost: { scrap: 14, metalsheet: 2, electronics: 4 }, hours: 24, max: 3, req: { mechanics: 3 },
    desc: `Salvaged roof panels on a welded frame with a charge controller and an inverter: ${SOLAR.out} power an array at full sun, no fuel, no noise, no refuelling. It gives by the hour: nothing at night (${String(SOLAR.to).padStart(2, "0")}:00 to ${String(SOLAR.from).padStart(2, "0")}:00), half in the first and last ${SOLAR.shoulder} hours of daylight, × the season (summer ${SOLAR.season.summer}, spring ${SOLAR.season.spring}, autumn ${SOLAR.season.autumn}, winter ${SOLAR.season.winter}) × the sky (clear ${SOLAR.sky.clear}, overcast ${SOLAR.sky.overcast}, rain ${SOLAR.sky.rain}, snow ${SOLAR.sky.snow}, a blizzard ${SOLAR.sky.blizzard}). The sun's power is used before any generator runs; what is not drawn is lost unless a battery bank stores it. Storms wear it (hail and wind); repairs take electronics. Needs the Solar Installer's Handbook studied and a Mechanics 3+ survivor here to build.` },
  battery_bank: { name: "Battery bank", plot: "utility", grid: true, source: true, cost: { scrap: 10, carparts: 2, electronics: 2 }, hours: 12, max: 2, req: { mechanics: 3 },
    desc: `A rack of car batteries on a charge controller and an inverter: stores ${BATTERY.cap} power-hours, in or out at most ${BATTERY.rate} an hour, and gives back ${Math.round(BATTERY.eff * 100)}% of what went in. It is charged only by power that would go to waste: a solar array's surplus by day, and whatever a flat-burn generator (the portable set, a house or inverter set: they burn the same whatever they power) gives beyond the demand. At night, or with the generator off or dry, the grid runs off the bank: the sun first, then the generators, then the bank, but the bank counts as supply before a generator is started, so a small night load (a fridge and a spotlight) never wakes the generator. Wears on the days it cycles; repairs take a car battery and electronics. Needs a generator or a solar array here, the Solar Installer's Handbook studied and a Mechanics 3+ survivor to build.` },
  // The perimeter alarm (ALARM): a defence on the grid like the fence charger; from a shelter up (size).
  perimeter_alarm: { name: "Perimeter alarm", plot: "utility", grid: true, cost: { scrap: 8, parts: 1, electronics: 3 }, hours: 10, max: 1, tab: "defenses", size: "shelter", req: { mechanics: 2 },
    desc: `Motion sensors and tripwire switches on the approaches wired to a siren and a light in the yard. Draws ${ALARM.need} power from dusk to dawn. While it has power an attack at night never catches the base asleep: the siren wakes everyone (they count ${Math.round(ALARM.wake * 100)}% of their combat power on the walls with no warning, more than the armory's tripwire cans; raiders are never over the wall before anyone wakes; a horde finds the defences manned), and anything that comes within ${ALARM.tiles} tile of the base at night is spotted and warned of even with nobody on watch. Repairs take electronics. Needs a Mechanics 2+ survivor here to build.` },
  // The fittings (fit: a general building's floor, as the fridge and the stove): the heaters (HEATER) and the charger
  // (CHARGER).
  elec_heater: { name: "Electric heaters", fit: true, grid: true, cost: { scrap: 6, parts: 1, electronics: 1 }, hours: 6, max: 4, req: { mechanics: 2 },
    desc: `A bank of fan heaters and oil radiators with their thermostats, 1 × 1 on the floor of a hut, cabin, lodge, hall or barn. Draws ${HEATER.need} power on a day that wants heating (a freezing day, or a night under 8°C); while it has it, ${HEATER.heads} of the people fed here are warmed by it and their share of the fires' wood is not burned (15 wood a head on a freezing day, 22 in bitter cold, 4.5 on a chill night). Real heat, not the breaker panel's comfort circuit. Needs a Mechanics 2+ survivor here to build.` },
  charging_station: { name: "Charging station", fit: true, grid: true, cost: { scrap: 4, electronics: 2 }, hours: 4, max: 1, req: { mechanics: 2 },
    desc: `A bench of chargers, adapters and a power strip, 1 × 1 on the floor of a general building. Draws ${CHARGER.need} power while anything here wants charging: every powered hour it puts ${CHARGER.rate} uses back into the most drained rechargeable gear at the base (electronic ear defenders, a military headset: in the stores or on anyone here), so nobody spends a pack of batteries at a bench on them. Needs a Mechanics 2+ survivor here to build.` },
};

// Their footprints (basemap.js Object.assign(FOOT, POWER_FOOT)). A generator is a pump-like machine in the yard; the
// spotlight a lamp (mount: it may stand on a wall stand's cell, basemap.js placeProblemAt); the fridge a fitting (a
// locker cell on a general building's floor); the panel, the pump and the charger props in the yard; the press a bench.
/** @type {Record<string, any>} */
export const POWER_FOOT = {
  ...Object.fromEntries(GENSET_KINDS.map((k) => [k, { kind: "prop", k: "pump", w: GENSETS[k].w, h: GENSETS[k].h }])),
  spotlamp: { kind: "defence", k: "spot", w: 1, h: 1, mount: true },
  fridge: { kind: "prop", k: "locker", w: 1, h: 1, fit: true, indoor: true },
  breaker: { kind: "prop", k: "locker", w: 1, h: 1 },
  elec_pump: { kind: "prop", k: "pump", w: 1, h: 1 },
  fence_charger: { kind: "prop", k: "locker", w: 1, h: 1 },
  ammo_press: { kind: "prop", k: "counter", w: 2, h: 1 },
  // More of the grid (2026-10-24): the array a 2 × 2 rack in the yard, the bank a locker-sized cabinet, the alarm's
  // siren post a locker in the yard; the heaters and the charger fittings on a floor (a locker cell, as the fridge).
  solar_array: { kind: "prop", k: "rack", w: 2, h: 2 },
  battery_bank: { kind: "prop", k: "locker", w: 1, h: 1 },
  perimeter_alarm: { kind: "prop", k: "locker", w: 1, h: 1 },
  elec_heater: { kind: "prop", k: "locker", w: 1, h: 1, fit: true, indoor: true },
  charging_station: { kind: "prop", k: "counter", w: 1, h: 1, fit: true, indoor: true },
};

// Where they are kept (loot.js ITEM_TAGS).
/** @type {Record<string, string[]>} */
export const POWER_TAGS = {
  genset_inverter: ["camp", "outdoor", "garage", "home", "tools"], genset_house: ["home", "garage", "farm", "tools"],
  genset_contractor: ["tools", "industry", "garage"], genset_standby: ["home", "farm", "medical", "industry"], genset_military: ["military"],
  spotlamp: ["tools", "industry", "police", "military", "fire", "sport"], fridge: ["home", "kitchen"],
};
// The hour-by-hour search (scavenge.js; electric.js rollPowerFind, its own dice), by the site or point of interest
// searched (data.js LOCATIONS keys): p a search hour at a full pool, items the weights. Big sets are rare.
/** @type {Record<string, { p: number, items: Record<string, number> }>} */
export const POWER_FINDS = {
  house: { p: 0.012, items: { fridge: 3, genset_house: 2, genset_inverter: 1, genset_standby: 0.3 } },
  neighbourhood: { p: 0.015, items: { fridge: 3, genset_house: 2, genset_inverter: 1, genset_standby: 0.4 } },
  apartments: { p: 0.01, items: { fridge: 3, genset_inverter: 0.5 } },
  garage: { p: 0.02, items: { genset_house: 2, genset_inverter: 1.5, genset_contractor: 1 } },
  shed: { p: 0.015, items: { genset_house: 1.5, genset_inverter: 1 } },
  farm: { p: 0.02, items: { genset_house: 2, genset_standby: 0.6, fridge: 1 } },
  hardware: { p: 0.04, items: { genset_inverter: 2, genset_house: 2, genset_contractor: 1.5, spotlamp: 2 } },
  pawnshop: { p: 0.02, items: { genset_inverter: 2, genset_house: 1, spotlamp: 0.5 } },
  factory: { p: 0.02, items: { genset_contractor: 2, spotlamp: 1.5 } },
  warehouse: { p: 0.02, items: { genset_contractor: 1.5, spotlamp: 1.5, genset_standby: 0.5 } },
  hospital: { p: 0.012, items: { genset_standby: 1 } },
  firestation: { p: 0.02, items: { spotlamp: 2, genset_contractor: 1 } },
  police: { p: 0.012, items: { spotlamp: 1 } },
  campground: { p: 0.02, items: { genset_inverter: 2 } },
  military: { p: 0.03, items: { genset_military: 2, spotlamp: 1.5 } },
  convoy: { p: 0.04, items: { genset_military: 3, spotlamp: 1 } },
};
// A raid's containers (combat.js searchBox; electric.js rollAreaPower, its own dice), by the raid area: p a container.
/** @type {Record<string, { p: number, items: Record<string, number> }>} */
export const AREA_POWER = {
  house: { p: 0.02, items: { fridge: 2, genset_house: 1, genset_inverter: 0.5 } },
  kitchen: { p: 0.03, items: { fridge: 2 } },
  farmhouse: { p: 0.03, items: { genset_house: 2, fridge: 1, genset_standby: 0.4 } },
  garage: { p: 0.04, items: { genset_house: 2, genset_contractor: 1, genset_inverter: 1 } },
  workshop: { p: 0.03, items: { genset_contractor: 2, spotlamp: 1 } },
  hardware: { p: 0.05, items: { genset_inverter: 2, genset_house: 2, genset_contractor: 1, spotlamp: 2 } },
  motorpool: { p: 0.05, items: { genset_military: 2, spotlamp: 1 } },
  barracks: { p: 0.03, items: { genset_military: 1, spotlamp: 1 } },
};

// Wear and repairs (breakdowns.js Object.assign(FIXTURES, POWER_FIXTURES)). The found generators wear by the days they
// ran, as the built one does (a bigger engine faster, a spare part more often); the rest as small machines: by the
// days they had power (power: true), the press by the days it ran (a station), the spotlight from raids only.
/** @type {Record<string, any>} */
export const POWER_FIXTURES = {
  genset_inverter:   { use: 1.2, idle: 0.1,  spares: 24, repair: { hours: 6,  cost: { scrap: 2, parts: 1 }, min: 2 }, rig: { hours: 2, cost: { scrap: 1 }, min: 1 }, what: "no power from it" },
  genset_house:      { use: 1.5, idle: 0.15, spares: 20, repair: { hours: 8,  cost: { scrap: 3, parts: 1 }, min: 2 }, rig: { hours: 3, cost: { scrap: 2 }, min: 1 }, what: "no power from it" },
  genset_contractor: { use: 1.7, idle: 0.15, spares: 18, repair: { hours: 10, cost: { scrap: 4, parts: 2 }, min: 3 }, rig: { hours: 3, cost: { scrap: 2 }, min: 1 }, what: "no power from it" },
  genset_standby:    { use: 1.8, idle: 0.18, spares: 16, repair: { hours: 12, cost: { scrap: 5, parts: 2 }, min: 4 }, rig: { hours: 4, cost: { scrap: 3 }, min: 2 }, what: "no power from it" },
  genset_military:   { use: 1.4, idle: 0.12, spares: 20, repair: { hours: 14, cost: { scrap: 6, parts: 3 }, min: 4 }, rig: { hours: 4, cost: { scrap: 3 }, min: 2 }, what: "no power from it" },
  spotlamp:      { raidOnly: true, repair: { hours: 1, cost: { scrap: 1, electronics: 1 }, min: 1 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "a smashed spotlight: no light from it" },
  fridge:        { power: true, use: 0.4, idle: 0.02, spares: 30, repair: { hours: 4, cost: { scrap: 2, parts: 1 }, min: 2 }, rig: { hours: 1, cost: { scrap: 1 }, min: 1 }, what: "a dead compressor: the food in it warms" },
  breaker:       { age: 0.03, storm: 2, repair: { hours: 3, cost: { scrap: 1, electronics: 1 }, min: 2 }, rig: { hours: 1, cost: { scrap: 1 }, min: 1 }, what: "tripped and burnt: the buildings are dark" },
  ammo_press:    { use: 1, idle: 0.05, spares: 18, repair: { hours: 8, cost: { scrap: 3, parts: 2 }, min: 3 }, rig: { hours: 2, cost: { scrap: 2 }, min: 2 }, what: "no rounds from it" },
  elec_pump:     { power: true, use: 0.6, idle: 0.05, spares: 24, repair: { hours: 6, cost: { scrap: 2, parts: 1 }, min: 2 }, rig: { hours: 2, cost: { scrap: 1 }, min: 1 }, what: "no water from it" },
  fence_charger: { power: true, use: 0.3, idle: 0.05, attack: 3, repair: { hours: 3, cost: { scrap: 1, electronics: 1 }, min: 2 }, rig: { hours: 1, cost: { scrap: 1 }, min: 1 }, what: "the wire goes dead" },
  // More of the grid (2026-10-24): the array ages a little and takes a storm's hail and wind (no use wear: nothing
  // turns); the bank wears on the days it cycles (ranDay: power.js sets b.ran when it charges or gives); the alarm, the
  // heaters and the charger by the days they had power, the alarm smashed a little in every attack.
  solar_array:   { age: 0.04, storm: 3, attack: 1, repair: { hours: 4, cost: { scrap: 2, electronics: 1 }, min: 2 }, rig: { hours: 2, cost: { scrap: 1 }, min: 1 }, what: "no power from the sun" },
  battery_bank:  { ranDay: true, use: 0.6, idle: 0.1, repair: { hours: 4, cost: { scrap: 2, carparts: 1, electronics: 1 }, min: 2 }, rig: { hours: 1, cost: { scrap: 1 }, min: 1 }, what: "a dead bank: nothing stored, nothing given" },
  perimeter_alarm: { power: true, use: 0.3, idle: 0.05, attack: 2, repair: { hours: 3, cost: { scrap: 1, electronics: 1 }, min: 2 }, rig: { hours: 1, cost: { scrap: 1 }, min: 1 }, what: "dead sensors: no alarm, a night attack can catch the base asleep again" },
  elec_heater:   { power: true, use: 0.4, idle: 0.02, repair: { hours: 2, cost: { scrap: 1, electronics: 1 }, min: 1 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "cold coils: the fires burn for everyone again" },
  charging_station: { power: true, use: 0.2, idle: 0.02, repair: { hours: 2, cost: { scrap: 1, electronics: 1 }, min: 1 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no charging: battery packs at a bench again" },
};
