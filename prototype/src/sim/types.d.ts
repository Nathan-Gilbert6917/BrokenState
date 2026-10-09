// The sim's core shapes, for type checking only (README "Type checking"). Nothing here runs: the game never loads
// this file. A module that starts with // @ts-check uses them with one line:
//   /** @import { State, Survivor, Party } from "./types" */
// and then /** @param {State} state */ on its functions. Read them like C# records: `field?: T` is optional (older
// saves or other code may not have it), `T | null` can be null.
//
// The big records end with `[key: string]: any`: about 120 modules each keep a few fields of their own on the world,
// a survivor, a team or a group (save.js writes whatever is there). Those fields are allowed and untyped; the ones
// listed are checked. Move a field up into its record when a module that uses it opts in.

import type { Rng } from "./rng.js";
import type { HexGrid } from "./hex.js";

// ---------- the stocks ----------
// The supplies (data.js SUPPLIES: food, water, rawwater, fuel, meds, ammo, arrows, parts, scrap, preserved, jars,
// wood) in amounts. A base's stock, a team's packed supplies or cargo, a group's stores. A key can be missing (a team
// that packed none), so read it as `stock.x || 0`.
export type SupplyKey = "food" | "water" | "rawwater" | "fuel" | "meds" | "ammo" | "arrows" | "parts" | "scrap" | "preserved" | "jars" | "wood" | "carparts" | "gunparts" | "electronics";
export type Stock = { [K in SupplyKey]?: number } & { [key: string]: number };

// ---------- the map ----------
export interface TileLoc {
  type: string; // a site type (town, city, farm, hospital…: mapgen.js)
  name: string;
  zone?: string; // urban, rural, wild…
  settlement?: number | null; // a town's own shops: the town's tile
  crash?: any;
  [key: string]: any;
}

export interface Tile {
  id: number;
  x: number;
  y: number;
  elev: number;
  terrain: string; // data.js TERRAIN key: plains, forest, hills, mountain, water
  road: boolean;
  roadLinks: number[]; // neighbouring tiles joined by road
  river: boolean;
  bridge: boolean;
  loc: TileLoc | null;
  loot: number; // 0..1 what is left to find
  infection: number;
  owner: string | number | null; // "player", a group's id, or nobody
  hive: boolean;
  // A base burned or overrun here (an outpost on it needs less scrap): its name, the day, who did it, whose it was.
  ruin?: { name: string; day: number; by: string; from: string; yours?: boolean; dead?: number } | null;
  [key: string]: any;
}

// What the player last saw of a tile (world.js snapshot): state.knowledge[tileId].
export interface TileSnapshot {
  hour: number;
  owner: string | number | null;
  factionBase: number | null;
  hordeSize: number;
  hordeBoss: number;
  hordeMix: any;
  growth: any;
  infection: number;
  loot: number;
  hive: boolean;
  site: { biomass: number; started: boolean } | null;
  deathSite: number;
  lootHour?: number; // radio news of a stripped site (aiscav.js)
  lootSrc?: any;
}

// ---------- people ----------
// Where someone (or a vehicle) is. kind: "base" (baseId), "party" (partyId), "route" (routeId: a trade-route
// escort), "captive" (factionId, tile, since), "abandoned" (a vehicle left on a tile).
export interface Place {
  kind: string;
  baseId?: number;
  partyId?: number;
  routeId?: number;
  factionId?: number;
  tile?: number;
  since?: number;
  until?: number;
  [key: string]: any;
}

// A thing: worn, held, in a pocket, pack, armory, cargo or on a body. key: data.js GEAR key.
export interface Item {
  key: string;
  name: string;
  quality: number; // 1 = as made; makeshift gear less
  dur?: number; // uses or wear left (data.js GEAR dur)
  contents?: (Item | null)[]; // a pack's slots (inventory.js ensurePack)
  [key: string]: any;
}

// Worn and held gear (inventory.js): weapon = hands, tool = off hand, armor = body.
export interface Gear {
  weapon: Item | null;
  armor: Item | null;
  tool: Item | null;
  head: Item | null;
  arms: Item | null;
  legs: Item | null;
  backpack: Item | null;
  /** carry.js: a bag carried in the arms instead of worn (a looted pack, a rig, a gun case): hands full */
  carry?: Item | null;
}

export interface Survivor {
  id: number;
  name: string;
  skills: { [skill: string]: number }; // data.js SKILLS, 0–20
  traits: string[]; // data.js TRAITS keys
  health: number; // 0–100
  mood: number; // 0–100
  alive: boolean;
  left?: boolean; // deserted or went over (alive is false then too)
  leader: boolean;
  hunger: number; // needs.js gauges, 0–100
  thirst: number;
  gear: Gear;
  pockets: (Item | null)[];
  location: Place | null;
  role: string; // work.js role: farm, scavenge, guard, build, operate…
  station?: number | null; // the building operated (role "operate")
  inBed?: boolean; // in a hospital bed (medical.js)
  appearance?: any;
  skillBudget?: number;
  [key: string]: any;
}

// ---------- bases ----------
// A building, built or under construction (buildings.js BUILDINGS[type]).
export interface Building {
  id: number;
  type: string;
  tier?: number;
  holds?: number; // a water barrel's size
  broken?: boolean; // breakdowns.js
  [key: string]: any;
}
export interface Construction {
  id: number;
  type: string;
  progress: number;
  hours: number;
  target?: number;
  tier?: number;
  cost?: Stock;
  [key: string]: any;
}

export interface Base {
  id: number;
  tile: number;
  type: string; // "hub" or "outpost"
  name: string;
  tier?: number; // 0: a staging camp's shelter (staging.js)
  stock: Stock;
  radio: boolean;
  watchtower: boolean;
  buildings: Building[];
  construction: Construction[];
  armory: Item[];
  [key: string]: any;
}

export interface Vehicle {
  id: number;
  type: string; // vehicles.js VEHICLE_TYPES key (truck, car, bike…)
  name: string;
  fuel: number;
  condition: number; // 0–100
  loc: Place;
  count?: number; // bikes: how many in the stack
  cargo?: Cargo;
  // Found on a battle map (foundcars.js): the model, where and when, and what getting it running needs (null: it runs).
  found?: { model: string; at?: string; hour?: number; tries?: number; repair: { parts: number; scrap: number; hours: number; mech: number; what: string[] } | null };
  // Upgrades (vehicles.js VEH_UPGRADES; missing = none): glass / mesh 0|1, plating 0|1|2, scrapPlate 0|1, a mounted gun.
  upgrades?: { glass?: number; mesh?: number; plating?: number; scrapPlate?: number; turret?: { gun: string; item?: Item } | null };
  destroyed?: boolean; // blown up in a fight (launchers.js): condition 0 for good, nothing repairs it (strip it for parts)
}

// ---------- teams ----------
// What a team found or carries besides its packed supplies.
export interface Cargo {
  supplies: Stock;
  gear: Item[];
  bodies?: any[]; // bodies brought home (carriers.js)
  [key: string]: any;
}

// An order in a team's queue (orders.js): { type: "move", tile }, { type: "home" }, { type: "task", … }.
export interface Order {
  type: string;
  tile?: number;
  [key: string]: any;
}

// Anything that moves on the map: your teams (owner "player": kind "expedition" or "convoy") and other groups'
// raids, convoys and scavenging parties (owner: the group's id).
export interface Party {
  id: number;
  owner: string | number;
  kind: string; // expedition, convoy, raid, scav…
  path: number[]; // tile ids, the team at path[idx]
  idx: number;
  progress: number; // movement built up towards the next tile
  phase: string; // out, back, waiting, siege…
  vehicle: boolean | "bike"; // false on foot, true a car, "bike"
  // A player team:
  mission?: string; // parties.js MISSIONS key
  teamMission?: string; // the mission it left with (its name)
  dest?: number;
  homeBaseId?: number;
  members?: number[]; // survivor ids
  stance?: string; // parties.js STANCES key
  vehicleId?: number | null;
  supplies?: Stock;
  cargo?: Cargo;
  seen?: Map<number, TileSnapshot>;
  spotted?: Map<string, Marker>;
  sightNow?: number[];
  radioLive?: boolean;
  departed?: number;
  plannedHours?: number;
  orders?: Order[];
  orderStart?: number;
  task?: any; // orders.js: the task under way
  plan?: any; // plans.js: the plan it was sent with
  burden?: any; // load.js burdenRecord: its pace and rations when last weighed
  // What the hub knows of the plan (plannedTile).
  planPath?: number[];
  planStart?: number;
  planVehicle?: boolean | "bike";
  planFuel?: number;
  planStay?: number;
  etaOut?: number;
  etaBack?: number | null;
  // An AI party:
  strength?: number;
  target?: any;
  targetFaction?: number | null;
  warned?: boolean;
  [key: string]: any;
}

// ---------- the other groups ----------
export interface Faction {
  id: number;
  name: string;
  type: string; // factions.js FACTION_TYPES key
  color: string;
  bases: number[]; // tile ids
  pop: number;
  alive: boolean;
  known: boolean;
  goodwill: number; // -100..100 (attitude: Hostile under -40)
  lastDiplomacy: number;
  pact: string | null; // "trade", "nonaggression"…
  stock: Stock;
  lootedGear: Item[];
  raidCooldown: number;
  [key: string]: any;
}

// ---------- the dead ----------
// The smaller records below have no `[key: string]: any`: a field not listed is an error in a checked file (add it
// here when it is real).
export interface Horde {
  id: number;
  tile: number;
  size: number;
  target: number | null;
  move: number;
  role: string; // roam, attack, border, guard, gather…
  hive: number | null; // the hive it belongs to
  site: number | null; // a hive site it gathers at
  bosses: number;
  goal: any;
  born: number;
  mix: any; // zombietypes.js: a hive's special dead
  elite: boolean;
  path?: number[]; // the way it is walking (hordes.js)
  pathTo?: number;
  shun?: { tile: number; until: number }; // beaten off a base lately (defences.js)
  lureUntil?: number; // a cull team lured it off (parties.js)
  from?: number; // the side a break-in comes from (deploy.js)
}

export interface Hive {
  id: number;
  tile: number;
  res: number; // resources for hordes and growths
  born: number;
  income: number;
  bossReady: boolean;
  bossHorde: number | null;
  name: string;
  growSave?: number; // hivetech.js: saving up for a growth
  growDay?: number;
  saving?: boolean; // holding resources back for a boss
  threatDay?: number;
  bossDay?: number;
  playerDay?: number;
}

// A place the dead are building a new hive (hives.js).
export interface HiveSite {
  id: number;
  tile: number;
  chosen: number;
  score: number;
  biomass: number;
  started: number | null;
  brokenUntil?: number;
  hardcore?: boolean;
  noPath?: boolean;
}

// ---------- cards ----------
// One answer on a card. resolve runs it and returns the line to show (or nothing). disabled: true, a reason, or a
// function of the state (cardrules.js choiceOff).
export interface Choice {
  label: string;
  resolve: (state: State) => string | void | null | undefined;
  disabled?: boolean | string | ((state: State) => boolean | string | null | undefined);
  hint?: string | ((state: State) => string);
  fight?: boolean;
  [key: string]: any;
}

// An event card waiting for an answer (world.js addCard). Cards hold code, so a save waits until they are answered.
export interface Card {
  title: string;
  text: string;
  choices: Choice[];
  kind?: string; // cardrules.js
  partyId?: number; // the team it is about (stale once the team is gone: parties.js cardStale)
  survivorIds?: number[];
  vehicleId?: number;
  [key: string]: any;
}

// ---------- the record ----------
export interface LogLine {
  hour: number;
  text: string;
  kind: string; // info, good, danger, death…
}

export interface DeathSite {
  id: number;
  tile: number;
  items: any[];
  day: number;
  names: string[];
  lastConfirmed: number;
  walked?: string[]; // carriers.js: the names of the bodies that got up and walked off
}

// Something on the map the player knows of (markers.js): a vehicle left behind, a death site, a find.
export interface Marker {
  key: string;
  type: string;
  tile: number;
  hour: number;
  label: string;
  info?: any;
  [key: string]: any;
}

// ---------- the world ----------
// Everything the sim keeps (world.js createWorld). One object; save.js writes it whole.
export interface State {
  seed: number;
  rng: Rng;
  worldSize: string; // worldsize.js key, or "custom"
  mode: "normal" | "hardcore";
  idBase: number; // world.js localId
  woodcutting: number; // save marks (save.js migrations)
  rawWater: number;
  groupWorks?: number; // barestart: the AI groups build their bases up (groupworks.js); absent in older saves
  gunSlots?: number; // gunmods.js: guns have attachment slots (save.js moves an older save's parts on load)
  groupJails?: number; // jailhouse: the AI groups keep prisoners in jails, work and trade them (groupjails.js); absent in older saves
  grid: HexGrid;
  tiles: Tile[];
  cityId: number;
  originId: number;
  cityIds: number[];
  militaryIds: number[];
  hour: number; // hours since the start (day 1 06:00 is hour 6)
  survivors: Survivor[];
  bases: Base[];
  factions: Faction[];
  parties: Party[];
  hordes: Horde[];
  hives?: Hive[]; // hives.js ensureHives
  hiveSites?: HiveSite[];
  deathSites: DeathSite[];
  routes: any[]; // trade routes (trade.js)
  supplyRuns: any[]; // supply.js
  knowledge: (TileSnapshot | null)[]; // per tile
  log: LogLine[]; // newest first, the last 200
  cards: Card[];
  vehicles: Vehicle[];
  markers: Marker[];
  engagement: any; // a fight's card under way (conflicts.js)
  trade: any; // the open trade window (trade.js)
  combat?: any; // the battle under way (combat.js)
  live: Set<number>; // tiles seen right now
  gameOver: boolean;
  started: boolean;
  victory?: boolean;
  stats: { peopleSaved: number; raidsRepelled: number; [key: string]: any };
  autopilot?: boolean;
  startPeople?: number; // hardcore: how many fled together
  [key: string]: any;
}
