// Tactical combat entry point. This is the shared contract between the conflict system and the
// XCOM-style combat engine. The engine may change everything inside this file except the
// exported API described below.
//
// setup = {
//   tile,                       // State Map tile where the fight happens
//   partyId?,                   // player team fighting (members = partyMembers)
//   baseId?,                    // or: player base being defended (fighters = people at the base)
//   fighterIds?,                // optional: only these survivors take part
//   enemy: {
//     kind: "raiders" | "soldiers" | "zealots" | "zombies" | "mixed",
//     count,                    // number of enemy units
//     power,                    // rough per-unit strength, same scale as world.combatPower (2–10)
//     factionId?,               // AI group they belong to, if any
//     name?,                    // display name, e.g. "Red Hand raiders"
//   },
//   ambush: "player" | "enemy" | null,  // who has the drop on whom
//   canRetreat: true,           // whether the player may leave the map
//   handler: "key",             // registered handler that applies the outcome
//   context: {},                // free data passed back to the handler
// }
//
// result = {
//   outcome: "victory" | "defeat" | "retreat",
//   enemiesKilled, enemiesLeft,
//   survivorsHurt: [ids], survivorsDead: [ids],
//   ammoUsed,
//   loot: { supplies: {}, gear: [] },  // dropped by dead enemies, already added to the party cargo / base stock
//   turns?, medsUsed?, extraKilled?    // optional extras from the tactical engine
// }
import { survivorById, alive, atBase, combatPower, hurt, log, skill, gearEffect } from "./world.js";
import { partyMembers, partyTile, partyCapacity, cargoLoad, unitsThatFit, wipeParty } from "./parties.js";
import { GEAR, SUPPLIES } from "./data.js";
import { wearAfterFight, wearSlot, itemDur, medKitBonus } from "./crafting.js";
import { armorMult, enemyBody, allyBody, bodyEmpty, takeAllBodies, leaveBodies, ARMOR_SLOTS } from "./inventory.js";

// Result handlers by key. Other modules register theirs while they load (conflicts.js, scavenge.js), which can be
// before this module's own body has run (the imports are circular), so the map is made on first use: a `var`
// with no initialiser is already usable then and is not reset when this line runs later.
var handlers; // eslint-disable-line no-var

export function registerCombatHandler(key, fn) {
  (handlers = handlers || new Map()).set(key, fn);
}

export function combatants(state, setup) {
  let list = [];
  if (setup.partyId) {
    const p = state.parties.find((x) => x.id === setup.partyId);
    list = p ? partyMembers(state, p) : [];
  } else if (setup.baseId) list = atBase(state, setup.baseId);
  if (setup.fighterIds) list = list.filter((s) => setup.fighterIds.includes(s.id));
  return list;
}

// Opens a fight. With no browser (headless tools) or state.autoCombat, it resolves instantly.
// In the browser it sets state.combat to a live battle; the combat screen plays it out.
export function startCombat(state, setup) {
  // Nobody left to fight it (the team died or went home while the battle waited its turn): no battle, no result.
  if (!combatants(state, setup).length) {
    dropSetup(state, setup);
    return state.combat || null;
  }
  if (state.autoCombat || typeof window === "undefined") {
    const result = autoResolveCombat(state, setup);
    finishCombat(state, setup, result);
    return null;
  }
  if (state.combat) {
    (state.combatQueue = state.combatQueue || []).push(setup);
    return state.combat;
  }
  state.combat = createBattle(state, setup);
  return state.combat;
}

// A battle that cannot happen is dropped without a result. A team that still exists with nobody alive is closed
// properly (what it carried stays at a death site, parties.js wipeParty).
function dropSetup(state, setup) {
  const p = setup.partyId ? state.parties.find((x) => x.id === setup.partyId) : null;
  if (p && p.owner === "player" && !partyMembers(state, p).length) wipeParty(state, p);
}

export function finishCombat(state, setup, result) {
  state.combat = null;
  // Makeshift gear loses durability with every fight (a raid only if someone was killed). A battle played on the
  // map has already worn what its units took the field with (wearFielded, when the battle ended); one resolved by
  // the numbers wears everyone who was counted in it.
  if (!(result && result.worn) && (setup.mode !== "raid" || (result && result.enemiesKilled))) wearAfterFight(state, combatants(state, setup));
  const fn = handlers && handlers.get(setup.handler);
  // While the handler runs, the team is between a battle and its aftermath (conflicts.js releaseStranded skips it).
  state.resolving = (state.resolving || 0) + 1;
  try {
    if (fn) fn(state, result, setup);
  } finally {
    state.resolving -= 1;
  }
  while (!state.combat && state.combatQueue && state.combatQueue.length) startCombat(state, state.combatQueue.shift());
}

// Is a battle for this team open or waiting its turn?
export function battlePending(state, partyId) {
  return !!(state.combat && state.combat.setup.partyId === partyId) || (state.combatQueue || []).some((s) => s.partyId === partyId);
}

// Quick statistical resolution, used headless and as a fallback.
export function autoResolveCombat(state, setup) {
  const rng = state.rng;
  const people = combatants(state, setup);
  const party = setup.partyId ? state.parties.find((x) => x.id === setup.partyId) : null;
  const base = setup.baseId ? state.bases.find((b) => b.id === setup.baseId) : null;
  if (!people.length) {
    // Nobody to fight: no dice, no losses on either side.
    return { outcome: "defeat", enemiesKilled: 0, enemiesLeft: setup.enemy.count, survivorsHurt: [], survivorsDead: [], ammoUsed: 0, loot: { supplies: {}, gear: [] } };
  }
  // A team shoots from what it packed and from ammo it found on the way (the same two pools as a tactical battle).
  const pools = party ? [party.supplies, party.cargo ? party.cargo.supplies : {}] : base ? [base.stock] : [{}];
  const have = pools.reduce((a, o) => a + Math.max(0, Math.floor(o.ammo || 0)), 0);
  const ammoUsed = Math.min(have, people.length * 6);
  let owed = ammoUsed;
  for (const o of pools) {
    const t = Math.min(owed, Math.max(0, Math.floor(o.ammo || 0)));
    if (t > 0) o.ammo -= t;
    owed -= t;
  }
  let mine = people.reduce((a, s) => a + combatPower(s), 0) * (ammoUsed >= people.length * 3 ? 1 : 0.6);
  let theirs = setup.enemy.count * setup.enemy.power;
  if (setup.ambush === "player") mine *= 1.4;
  if (setup.ambush === "enemy") theirs *= 1.4;
  const ratio = mine / Math.max(0.1, theirs);
  const win = rng.chance(Math.max(0.05, Math.min(0.95, 0.5 + (ratio - 1) * 0.6)));
  const tile = party ? partyTile(party) : tileIdOf(setup);
  const hurtIds = [], deadIds = [];
  const hits = win ? rng.int(0, Math.ceil(people.length / 2)) : rng.int(1, people.length);
  for (let i = 0; i < hits && people.length; i++) {
    const s = rng.pick(people);
    if (!s.alive) continue;
    hurt(state, s, rng.int(win ? 10 : 25, win ? 40 : 75), tile, `in a fight with ${setup.enemy.name || setup.enemy.kind}`);
    (s.alive ? hurtIds : deadIds).push(s.id);
  }
  const killed = win ? setup.enemy.count : Math.floor(setup.enemy.count * rng.range(0.1, 0.5));
  return {
    outcome: win ? "victory" : "defeat",
    enemiesKilled: killed, enemiesLeft: setup.enemy.count - killed,
    survivorsHurt: hurtIds, survivorsDead: deadIds, ammoUsed,
    loot: { supplies: {}, gear: [] },
  };
}

const tileIdOf = (setup) => (setup.tile && typeof setup.tile === "object" ? setup.tile.id : setup.tile);

// ======================================================================================
// Tactical engine
// ======================================================================================

export const MAP_W = 18, MAP_H = 13;
// Current battle size. Only one battle runs at a time; createBattle / createRaid set these.
let W = MAP_W, H = MAP_H;
const MOVE = 5, ZOMBIE_MOVE = 2, ZOMBIE_FAST = 3; // tiles per action point (zombies halved: 4/5 → 2/3)
const SIGHT = 13, ZOMBIE_SIGHT = 9;
export const COVER_DEF = [0, 20, 40];     // aim penalty for no / half / full cover
export const HUNKER_DEF = 20;
const BLEED_TURNS = 3;
const MAX_PLAYERS = 8, MAX_ENEMIES = 20;

// walk: can stand there. cover: 0 none, 1 half, 2 full. los: blocks line of sight.
export const CELL = {
  open:    { walk: true,  cover: 0, los: false, name: "Open ground" },
  tree:    { walk: false, cover: 2, los: true,  name: "Tree" },
  boulder: { walk: false, cover: 2, los: true,  name: "Boulder" },
  wall:    { walk: false, cover: 2, los: true,  name: "Wall" },
  truck:   { walk: false, cover: 2, los: true,  name: "Burnt-out truck" },
  window:  { walk: false, cover: 1, los: false, name: "Window" },
  rock:    { walk: false, cover: 1, los: false, name: "Rock" },
  car:     { walk: false, cover: 1, los: false, name: "Car" },
  fence:   { walk: false, cover: 1, los: false, name: "Fence" },
  hay:     { walk: false, cover: 1, los: false, name: "Hay bales" },
  crate:   { walk: false, cover: 1, los: false, name: "Crates" },
  sandbag: { walk: false, cover: 1, los: false, name: "Sandbags" },
  pump:    { walk: false, cover: 1, los: false, name: "Fuel pump" },
  water:   { walk: false, cover: 0, los: false, name: "Water" },
  // Raid containers and props.
  shelf:   { walk: false, cover: 1, los: false, name: "Shelves" },
  locker:  { walk: false, cover: 2, los: true,  name: "Lockers" },
  cabinet: { walk: false, cover: 1, los: false, name: "Cabinet" },
  counter: { walk: false, cover: 1, los: false, name: "Counter" },
  vehicle: { walk: false, cover: 2, los: true,  name: "Your vehicle" },
};

// Weapon stats in battle, keyed like GEAR. opt = best range; fall = aim lost per tile beyond it.
export const WEAPONS = {
  fists:     { name: "Fists",          melee: true, dmg: [6, 10] },
  knife:     { name: "Kitchen knife",  melee: true, dmg: [14, 22] },
  machete:   { name: "Machete",        melee: true, dmg: [20, 30] },
  claws:     { name: "Teeth and nails", melee: true, dmg: [12, 20] },
  pistol:    { name: "9mm pistol",     dmg: [16, 24], opt: 6,  fall: 4, aim: 0,  ammo: 1, noise: 2 },
  shotgun:   { name: "Pump shotgun",   dmg: [24, 36], opt: 4,  fall: 7, aim: 10, ammo: 1, noise: 3, close: 10 },
  huntrifle: { name: "Hunting rifle",  dmg: [24, 34], opt: 12, fall: 2, aim: 5,  ammo: 1, noise: 3, close: -10 },
  ar:        { name: "Assault rifle",  dmg: [22, 32], opt: 9,  fall: 3, aim: 8,  ammo: 2, noise: 3 },
  // Makeshift weapons (crafting.js). The crossbow reuses its bolts (no ammo) and is silent.
  spikedbat:  { name: "Spiked bat",        melee: true, dmg: [16, 25] },
  pipespear:  { name: "Pipe spear",        melee: true, dmg: [15, 23] },
  sawmachete: { name: "Saw-blade machete", melee: true, dmg: [17, 27] },
  crossbow:   { name: "Scrap crossbow",    dmg: [18, 26], opt: 7, fall: 4, aim: -4, ammo: 0, noise: 0 },
  pipegun:    { name: "Pipe shotgun",      dmg: [20, 32], opt: 3, fall: 8, aim: -6, ammo: 1, noise: 3, close: 8 },
};
const BASH = [8, 12]; // hitting someone with a gun

// loot = spare gear a body may carry; pack = [pack key, chance] a body wears one (inventory.js enemyBody).
const KITS = {
  raiders:  { label: "Raider",  aim: 3, hp: 5,  weapons: ["pistol", "pistol", "shotgun", "huntrifle", "machete"], strong: ["shotgun", "ar", "huntrifle"], armor: [null, null, "vest"], loot: ["pistol", "shotgun", "machete", "huntrifle", "vest", "spikedbat", "tirevest", "bikehelmet", "kneeguards"], pack: ["backpack", 0.15] },
  soldiers: { label: "Soldier", aim: -6, hp: -10, weapons: ["ar", "ar", "huntrifle", "shotgun"], strong: ["ar"], armor: ["vest", "plate"], loot: ["ar", "plate", "vest", "nvg", "milradio", "riothelmet"], pack: ["assaultpack", 0.3] },
  zealots:  { label: "Zealot",  aim: 0, hp: 5,  weapons: ["shotgun", "pistol", "machete", "machete", "huntrifle"], strong: ["shotgun", "huntrifle"], armor: [null], loot: ["machete", "shotgun", "pistol", "knife"], fearless: true },
  // People of the other group types (conflicts.js KIND_OF). All human: "mixed" is only for humans plus the dead.
  fighters: { label: "Fighter", aim: 3, hp: 5,  weapons: ["pistol", "shotgun", "huntrifle", "huntrifle", "machete"], strong: ["ar", "shotgun", "huntrifle"], armor: [null, null, "vest"], loot: ["pistol", "shotgun", "huntrifle", "machete", "vest", "kneeguards"], pack: ["backpack", 0.15] },
  guards:   { label: "Guard",   aim: 2, hp: 0,  weapons: ["pistol", "pistol", "shotgun", "huntrifle"], strong: ["shotgun", "huntrifle"], armor: [null, null, "vest"], loot: ["pistol", "shotgun", "knife", "vest", "bikehelmet"], pack: ["backpack", 0.3] },
  militia:  { label: "Militia", aim: 0, hp: 0,  weapons: ["huntrifle", "shotgun", "pistol", "machete", "pipespear"], strong: ["huntrifle", "shotgun"], armor: [null], loot: ["huntrifle", "machete", "knife", "pipespear", "padding"] },
};

const idx = (x, y) => y * W + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const cellAt = (b, x, y) => CELL[b.cells[idx(x, y)].k];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const active = (u) => !u.dead && !u.down && !u.left && !u.fled;
const onMap = (u) => !u.dead && !u.left && !u.fled;
export const unitAt = (b, x, y) => b.units.find((u) => onMap(u) && u.x === x && u.y === y);
export const unitById = (b, id) => b.units.find((u) => u.id === id);
export const inEvac = (b, x) => b.evacCols > 0 && x < b.evacCols;
const bump = (b) => b.rev++;

function say(b, text, k = "info") {
  b.log.push({ turn: b.turn, text, k });
  if (b.log.length > 80) b.log.shift();
}
function fx(b, e) {
  e.seq = ++b.fxSeq;
  b.fx.push(e);
  if (b.fx.length > 40) b.fx.shift();
}

// ---------- supplies (party or base) ----------
const pool = (b, k) => b.pools.reduce((s, o) => s + Math.max(0, Math.floor(o[k] || 0)), 0);
function take(b, k, n) {
  for (const o of b.pools) {
    const t = Math.min(n, Math.max(0, Math.floor(o[k] || 0)));
    o[k] = (o[k] || 0) - t;
    n -= t;
    if (n <= 0) break;
  }
}
export const ammoLeft = (b) => pool(b, "ammo");
export const medsLeft = (b) => pool(b, "meds");

// ---------- battle map ----------
function genMap(rng, tile) {
  const t = tile || { terrain: "plains" };
  const floor = { plains: "grass", forest: "grass", hills: "dirt", mountain: "gravel", suburb: "grass", city: "rubble", water: "grass" }[t.terrain] || "grass";
  const cells = Array.from({ length: W * H }, () => ({ k: "open", f: floor }));
  const at = (x, y) => (inside(x, y) ? cells[idx(x, y)] : null);
  const free = (x, y) => { const c = at(x, y); return c && c.k === "open"; };
  const put = (x, y, k, f) => { const c = at(x, y); if (c) { c.k = k; if (f) c.f = f; } };
  const rx = (lo = 3, hi = W - 4) => rng.int(lo, hi);
  const scatter = (k, n, lo = 3, hi = W - 4) => {
    // Crates may go indoors; everything else stays outside.
    for (let i = 0; i < n; i++) { const x = rx(lo, hi), y = rng.int(0, H - 1); if (free(x, y) && at(x, y).f !== "road" && (k === "crate" || at(x, y).f !== "floor")) put(x, y, k); }
  };
  // Sparse cover inside the deployment zones so nobody starts in the open.
  const edgeCover = (k, n) => { scatter(k, n, 1, 3); scatter(k, n, W - 4, W - 2); };
  const rectFree = (x0, y0, w, h) => {
    for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) if (inside(x, y) && (at(x, y).k !== "open" || at(x, y).f === "road")) return false;
    return x0 >= 0 && y0 >= 0 && x0 + w <= W && y0 + h <= H;
  };
  const building = (w, h, lo = 4, hi = W - 5 - w) => {
    for (let tries = 0; tries < 25; tries++) {
      const x0 = rng.int(lo, Math.max(lo, hi)), y0 = rng.int(0, H - h);
      if (!rectFree(x0, y0, w, h)) continue;
      const edge = [];
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const border = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
        put(x, y, border ? "wall" : "open", "floor");
        const corner = (x === x0 || x === x0 + w - 1) && (y === y0 || y === y0 + h - 1);
        if (border && !corner && inside(x + (x === x0 ? -1 : x === x0 + w - 1 ? 1 : 0), y + (y === y0 ? -1 : y === y0 + h - 1 ? 1 : 0))) edge.push([x, y]);
      }
      rng.shuffle(edge);
      const doors = w * h > 30 ? 3 : 2;
      edge.slice(0, doors).forEach(([x, y]) => put(x, y, "open", "floor"));
      edge.slice(doors, doors + rng.int(1, 3)).forEach(([x, y]) => put(x, y, "window"));
      return true;
    }
    return false;
  };
  const fenceLine = (x0, y0, len, horiz, k = "fence") => {
    for (let i = 0; i < len; i++) {
      const x = horiz ? x0 + i : x0, y = horiz ? y0 : y0 + i;
      if (free(x, y) && at(x, y).f !== "road" && at(x, y).f !== "floor" && !rng.chance(0.18)) put(x, y, k);
    }
  };

  // Road strip with wrecks.
  if (t.road) {
    const r = rng.int(5, 7);
    for (let x = 0; x < W; x++) for (const y of [r, r + 1]) put(x, y, "open", "road");
    for (let i = 0; i < rng.int(2, 4); i++) { const x = rx(4, W - 5), y = rng.pick([r, r + 1]); put(x, y, rng.chance(0.3) ? "truck" : "car"); }
  }
  // River for water tiles: a band with a couple of fords.
  if (t.terrain === "water") {
    const c = rng.int(8, 9);
    const fords = [rng.int(1, 4), rng.int(8, 11)];
    for (let y = 0; y < H; y++) for (const x of [c, c + 1]) if (!fords.some((f) => Math.abs(f - y) <= 0) && at(x, y).f !== "road") put(x, y, "water");
  }

  const type = t.loc ? t.loc.type : null;
  switch (type) {
    case "town": building(5, 4); building(4, 4); scatter("car", 3); fenceLine(rx(), rng.int(1, H - 2), 4, true); break;
    case "farm": building(6, 4); fenceLine(rx(3, 6), rng.int(1, 3), 8, true); fenceLine(rx(3, 6), rng.int(9, 11), 8, true); scatter("hay", 6); break;
    case "gas": building(4, 3); scatter("pump", 3, 6, 11); scatter("car", 2); break;
    case "mall": building(8, 5); scatter("car", 6); break;
    case "hospital": case "univ": case "factory": building(7, 5); scatter("crate", 4); scatter("car", 2); break;
    case "police": building(5, 4); scatter("car", 4); scatter("crate", 2); break;
    case "military": building(5, 4); fenceLine(rx(5, 7), rng.int(1, 4), 6, true, "sandbag"); fenceLine(rx(5, 7), rng.int(8, 11), 6, true, "sandbag"); scatter("truck", 2); scatter("crate", 3); break;
    case "prison": building(6, 5); fenceLine(5, 0, 9, false); fenceLine(12, 2, 9, false); break;
    case "airport": scatter("truck", 3); scatter("crate", 4); scatter("car", 2); break;
    case "dam": for (let x = 0; x < W; x++) if (free(x, 0)) put(x, 0, "water"); building(5, 3); break;
    case "quarry": scatter("boulder", 6); scatter("rock", 8); for (const c of cells) if (c.f === floor) c.f = "dirt"; break;
    // Map site types (mapgen.js): big city blocks, small shops, garages, farms, cabins, open-air sites.
    case "apartments": case "office": case "supermarket": case "school": case "warehouse": case "hardware": building(7, 5); scatter("car", 3); scatter("crate", 3); break;
    case "pharmacy": case "gunstore": case "grocery": case "diner": case "motel": case "church": case "clinic": case "feedstore":
      building(5, 4); building(4, 3); scatter("car", 2); fenceLine(rx(), rng.int(1, H - 2), 4, true); break;
    case "autoshop": case "firestation": case "truckstop": building(5, 4); scatter("truck", 2); scatter("car", 3); scatter("crate", 2); break;
    case "ranch": case "barn": building(6, 4); fenceLine(rx(3, 6), rng.int(1, 3), 8, true); fenceLine(rx(3, 6), rng.int(9, 11), 8, true); scatter("hay", 5); break;
    case "cabin": case "lodge": case "ranger": building(4, 3); scatter("crate", 2); break;
    case "campground": case "crashsite": scatter("crate", 4); scatter(type === "crashsite" ? "truck" : "car", 2); break;
    case "radiotower": building(3, 3); fenceLine(rx(4, 8), rng.int(2, 10), 6, true); scatter("crate", 2); break;
    default: break;
  }
  switch (t.terrain) {
    case "forest": scatter("tree", 30); scatter("rock", 5); edgeCover("tree", 3); break;
    case "hills": scatter("rock", 14); scatter("boulder", 5); edgeCover("rock", 3); break;
    case "mountain": scatter("boulder", 12); scatter("rock", 10); edgeCover("boulder", 2); break;
    case "suburb": building(5, 4); building(4, 3); fenceLine(rx(), rng.int(0, H - 1), 5, rng.chance(0.5)); scatter("car", 3); scatter("tree", 5); edgeCover("car", 1); edgeCover("tree", 2); break;
    case "city": building(6, 4); building(5, 4); building(4, 3); scatter("car", 4); scatter("truck", 2); scatter("crate", 4); edgeCover("crate", 2); break;
    default: scatter("rock", 5); scatter("tree", 6); edgeCover("rock", 2); edgeCover("tree", 1); break;
  }
  if (type === "farm" || type === "ranch") for (const c of cells) if (c.f === "grass") c.f = "field";

  // Every open cell must connect to both deployment zones; carve a lane if not.
  const mid = Math.floor(H / 2);
  for (let tries = 0; tries < 3; tries++) {
    const r = flood(cells, 0, mid);
    if (r[idx(W - 1, mid)]) return { cells, reach: r };
    for (let x = 0; x < W; x++) if (cells[idx(x, mid + tries - 1)].k !== "open") cells[idx(x, mid + tries - 1)].k = "open";
  }
  return { cells, reach: flood(cells, 0, mid) };
}

function flood(cells, sx, sy) {
  const seen = new Uint8Array(W * H);
  if (!CELL[cells[idx(sx, sy)].k].walk) cells[idx(sx, sy)].k = "open";
  const q = [idx(sx, sy)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      const j = idx(nx, ny);
      if (!seen[j] && CELL[cells[j].k].walk) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
}

// ---------- geometry ----------
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Line of sight between cell centers. Full-cover cells block it; grazing a corner does not.
export function los(b, x0, y0, x1, y1) {
  const a = idx(x0, y0), c = idx(x1, y1);
  const v = b.losCache[a * W * H + c];
  if (v) return v === 1;
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4);
  let clear = true;
  for (let i = 1; i < n && clear; i++) {
    const px = x0 + 0.5 + (dx * i) / n, py = y0 + 0.5 + (dy * i) / n;
    const cx = Math.floor(px), cy = Math.floor(py);
    if ((cx === x0 && cy === y0) || (cx === x1 && cy === y1)) continue;
    if (!cellAt(b, cx, cy).los) continue;
    const fx = px - cx, fy = py - cy;
    if (fx > 0.12 && fx < 0.88 && fy > 0.12 && fy < 0.88) clear = false;
  }
  b.losCache[a * W * H + c] = b.losCache[c * W * H + a] = clear ? 1 : 2;
  return clear;
}

export const canSee = (b, a, t) => dist(a.x, a.y, t.x, t.y) <= a.sight && los(b, a.x, a.y, t.x, t.y);

// Cover a unit at (x, y) has against an attacker at (ax, ay). Cover sits on the 4 sides; it only
// counts when the attacker is roughly in front of it. Some cover nearby but none facing = flanked.
export function coverAgainst(b, x, y, ax, ay) {
  let level = 0, any = false;
  const d = dist(x, y, ax, ay) || 1;
  for (const [dx, dy] of DIRS4) {
    if (!inside(x + dx, y + dy)) continue;
    const c = cellAt(b, x + dx, y + dy).cover;
    if (!c) continue;
    any = true;
    if (((ax - x) * dx + (ay - y) * dy) / d > 0.35) level = Math.max(level, c);
  }
  return { level, any, flanked: any && level === 0 };
}

// Cover on each side of a cell, for the shield icons: [east, west, south, north].
export function coverSides(b, x, y) {
  return DIRS4.map(([dx, dy]) => (inside(x + dx, y + dy) ? cellAt(b, x + dx, y + dy).cover : 0));
}

// Dijkstra over 8 directions (diagonals 1.5, no corner cutting). Units block cells.
export function reachable(b, u, maxCost) {
  const d = new Float32Array(W * H).fill(Infinity), prev = new Int16Array(W * H).fill(-1);
  const occ = new Uint8Array(W * H);
  for (const o of b.units) if (o !== u && onMap(o)) occ[idx(o.x, o.y)] = active(o) ? 1 : 2;
  const start = idx(u.x, u.y);
  d[start] = 0;
  const open = [start];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (d[open[i]] < d[open[bi]]) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    const x = cur % W, y = (cur / W) | 0;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny) || !cellAt(b, nx, ny).walk) continue;
      const diag = dx && dy;
      if (diag && (!cellAt(b, x + dx, y).walk || !cellAt(b, x, y + dy).walk)) continue;
      const j = idx(nx, ny);
      if (occ[j] === 1) continue;
      const nd = d[cur] + (diag ? 1.5 : 1);
      if (nd <= maxCost + 1e-6 && nd < d[j]) {
        if (d[j] === Infinity) open.push(j);
        d[j] = nd;
        prev[j] = cur;
      }
    }
  }
  // Downed bodies can be stepped over but not stood on.
  const stop = d.slice();
  for (let j = 0; j < W * H; j++) if (occ[j] === 2) stop[j] = Infinity;
  return { dist: stop, prev };
}

export function pathTo(r, x, y) {
  const path = [];
  let i = idx(x, y);
  while (i >= 0 && r.prev[i] >= 0) {
    path.unshift([i % W, (i / W) | 0]);
    i = r.prev[i];
  }
  return path;
}

// Walking distance from a set of cells to everywhere (ignores units). Used by AI to find a way around walls.
function distField(b, sources) {
  const d = new Float32Array(W * H).fill(Infinity);
  const open = [];
  for (const [x, y] of sources) { d[idx(x, y)] = 0; open.push(idx(x, y)); }
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (d[open[i]] < d[open[bi]]) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    const x = cur % W, y = (cur / W) | 0;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny) || !cellAt(b, nx, ny).walk) continue;
      if (dx && dy && (!cellAt(b, x + dx, y).walk || !cellAt(b, x, y + dy).walk)) continue;
      const j = idx(nx, ny), nd = d[cur] + (dx && dy ? 1.5 : 1);
      if (nd < d[j]) { if (d[j] === Infinity) open.push(j); d[j] = nd; }
    }
  }
  return d;
}

// ---------- odds ----------
export function shotOdds(b, a, t, ax = a.x, ay = a.y, opts = {}) {
  const w = WEAPONS[a.weapon];
  const d = dist(ax, ay, t.x, t.y);
  let aim = a.aim + (w.aim || 0);
  if (d > w.opt) aim -= (d - w.opt) * w.fall;
  if (d <= 2.5 && w.close) aim += w.close;
  const flat = t.surprised || (!t.aware && t.side === "enemy");
  const cov = t.kind === "zombie" || flat ? { level: 0, any: false, flanked: false } : coverAgainst(b, t.x, t.y, ax, ay);
  aim -= COVER_DEF[cov.level];
  if (t.hunker && cov.level) aim -= HUNKER_DEF;
  if (flat) aim += 15;
  if (opts.reaction) aim -= 15;
  if (opts.volley) aim += 15; // caught before they could take cover
  const chance = Math.max(5, Math.min(95, Math.round(aim)));
  const crit = opts.reaction ? 0 : cov.level === 0 ? (t.kind === "zombie" ? 15 : 40) : 5;
  return { chance, crit, dmg: [Math.round(w.dmg[0] * a.dmgMult), Math.round(w.dmg[1] * a.dmgMult)], cover: cov.level, flanked: cov.flanked, exposed: !cov.any && t.kind !== "zombie", dist: d };
}

export function meleeOdds(b, a, t) {
  const w = WEAPONS[a.weapon];
  const chance = Math.max(10, Math.min(95, Math.round(a.meleeAim - (t.hunker ? 10 : 0))));
  const base = w.melee ? w.dmg : BASH;
  const mult = w.melee ? a.dmgMult : 1;
  return { chance, crit: 10, dmg: [Math.round(base[0] * mult), Math.round(base[1] * mult)], cover: 0, flanked: false, dist: 1 };
}

export const isRanged = (u) => !WEAPONS[u.weapon].melee;
export const adjacent = (a, t) => Math.max(Math.abs(a.x - t.x), Math.abs(a.y - t.y)) === 1;
// Can this unit fire its gun right now (ranged weapon and, for the player, ammo)?
export const canFire = (b, u) => isRanged(u) && (u.side !== "player" || ammoLeft(b) >= WEAPONS[u.weapon].ammo);
// Enemies the player side can currently see.
export function playerSees(b, t) {
  return b.units.some((u) => u.side === "player" && active(u) && (canSee(b, u, t) || adjacent(u, t)));
}

// ---------- units ----------
// Medicine bonus from the off-hand kit in battle: the one rule shared with treating at a base and in the field
// (crafting.medKitBonus: bandage kit +2, surgical kit +4 scaled by the usual skill-gap rule, nothing when the
// medic is not skilled enough to use it).
const battleKitBonus = (s) => medKitBonus(s);

function playerUnit(b, s) {
  const item = s.gear.weapon;
  const eff = gearEffect(s, item);
  const key = item && eff.usable && WEAPONS[item.key] ? item.key : "fists";
  const mult = key === "fists" ? 1 : eff.mult;
  const q = item && key !== "fists" ? item.quality || 1 : 1;
  const bravery = (s.traits.includes("brave") ? 5 : 0) - (s.traits.includes("coward") ? 5 : 0);
  const armor = (s.traits.includes("tough") ? 0.75 : 1) * armorMult(s); // every worn piece (inventory.js)
  // What this unit takes the field with: exactly these item objects wear when the battle ends (wearFielded).
  const fielded = [];
  if (item && key !== "fists") fielded.push(["weapon", item]);
  for (const slot of ARMOR_SLOTS) if (s.gear[slot]) fielded.push([slot, s.gear[slot]]);
  // A bandage kit in the off hand loses a use with every treatment in battle; when it runs out its bonus is gone.
  const tool = s.gear.tool;
  const medKit = tool && GEAR[tool.key] && GEAR[tool.key].medKit ? tool : null;
  return {
    fielded, medKit, kitBonus: medKit ? medKitBonus(s) : 0, kitLeft: medKit ? itemDur(medKit) ?? Infinity : 0, kitUses: 0,
    id: b.nextId++, side: "player", kind: "human", sid: s.id, name: s.name, short: initials(s.name),
    weapon: key, weaponName: key === "fists" ? (item ? `${item.name} (unusable)` : "Fists") : item.name,
    aim: 40 + skill(s, "shooting") * 2.5 - (1 - mult) * 30 + bravery,
    meleeAim: 75 + bravery, dmgMult: (0.6 + 0.4 * mult) * (0.75 + 0.25 * q),
    armor, hp: s.health, maxHp: 100, startHp: s.health, mob: MOVE, sight: SIGHT,
    stealth: skill(s, "stealth"), medicine: skill(s, "medicine") + battleKitBonus(s),
    gearRisk: key === "fists" ? 0 : eff.damageChance, item: key === "fists" ? null : item,
    ap: 2, aware: true, x: 0, y: 0,
  };
}

function enemyUnit(b, rng, kind, power, n) {
  const p = Math.max(1, power);
  if (kind === "zombies") {
    return {
      id: b.nextId++, side: "enemy", kind: "zombie", name: `Zombie ${n}`, short: "Z", weapon: "claws", weaponName: "Teeth and nails",
      aim: 0, meleeAim: 55 + p * 3, dmgMult: 0.6 + p * 0.1, armor: 1, hp: Math.round(15 + p * 7), maxHp: Math.round(15 + p * 7),
      mob: p >= 5 ? ZOMBIE_FAST : ZOMBIE_MOVE, sight: ZOMBIE_SIGHT, ap: 2, aware: true, x: 0, y: 0,
    };
  }
  const kit = KITS[kind] || KITS.raiders;
  const weapon = p >= 7 && rng.chance(0.5) ? rng.pick(kit.strong) : rng.pick(kit.weapons);
  const armorKey = rng.pick(kit.armor);
  const hp = Math.round(55 + p * 5 + kit.hp);
  return {
    id: b.nextId++, side: "enemy", kind: "human", name: `${kit.label} ${n}`, short: kit.label[0] + n, weapon, weaponName: WEAPONS[weapon].name,
    aim: 39 + p * 4 + kit.aim, meleeAim: 65 + p * 2, dmgMult: 0.7 + p * 0.05, armor: armorKey ? 1 - GEAR[armorKey].power * 0.06 : 1, armorKey,
    hp, maxHp: hp, mob: MOVE, sight: SIGHT, ap: 2, aware: true, x: 0, y: 0, fearless: !!kit.fearless, kit: kind,
  };
}

const initials = (name) => name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

// ---------- setup ----------
export function createBattle(state, setup) {
  if (setup.mode === "raid") return createRaid(state, setup);
  W = MAP_W; H = MAP_H;
  const rng = state.rng;
  const tileId = tileIdOf(setup);
  const tile = state.tiles[tileId];
  const party = setup.partyId ? state.parties.find((x) => x.id === setup.partyId) : null;
  const base = setup.baseId ? state.bases.find((x) => x.id === setup.baseId) : null;
  const map = genMap(rng, tile);
  const b = {
    setup, tileId: party ? partyTile(party) : tileId, w: W, h: H, cells: map.cells, reach: map.reach,
    place: tile ? (tile.loc ? tile.loc.name : (tile.terrain[0].toUpperCase() + tile.terrain.slice(1))) : "Open ground",
    units: [], turn: 1, phase: "player", log: [], fx: [], fxSeq: 0, rev: 1, nextId: 1,
    pools: party ? [party.supplies, party.cargo ? party.cargo.supplies : {}] : base ? [base.stock] : [{}],
    ammoUsed: 0, medsUsed: 0, noise: 0, reinf: 0, infection: tile ? tile.infection || 0 : 0,
    evacCols: setup.canRetreat ? 2 : 0, over: false, result: null, acted: false, queue: [],
    losCache: new Int8Array(W * H * W * H), rng,
  };
  b.reinfMax = Math.round(b.infection * 5);
  const occupied = (x, y) => !!unitAt(b, x, y);
  const spot = (x, y) => inside(x, y) && b.reach[idx(x, y)] && cellAt(b, x, y).walk && !occupied(x, y);
  const coverScore = (x, y) => coverSides(b, x, y).reduce((s, c) => s + c, 0);
  const pickCells = (n, test, score) => {
    const list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (spot(x, y) && test(x, y)) list.push([x, y, score(x, y) + rng.next() * 2]);
    list.sort((a, c) => c[2] - a[2]);
    return list.slice(0, n);
  };

  // Player side.
  const people = combatants(state, setup).slice().sort((a, c) => combatPower(c) - combatPower(a)).slice(0, MAX_PLAYERS);
  const mid = H / 2;
  const pcells = pickCells(people.length, (x) => x <= 3, (x, y) => coverScore(x, y) * 1.5 - Math.abs(y - mid) * 0.6);
  people.forEach((s, i) => {
    const u = playerUnit(b, s);
    const c = pcells[i] || pickCells(1, () => true, (x) => -x)[0];
    u.x = c[0]; u.y = c[1];
    b.units.push(u);
  });

  // Enemy side.
  const e = setup.enemy;
  const count = Math.max(1, Math.min(MAX_ENEMIES, Math.round(e.count || 1)));
  const kinds = [];
  for (let i = 0; i < count; i++) kinds.push(e.kind === "mixed" ? (i % 2 ? "zombies" : "raiders") : e.kind);
  const pc = b.units.reduce((a, u) => [a[0] + u.x / b.units.length, a[1] + u.y / b.units.length], [0, 0]);
  let pods = [];
  if (setup.ambush === "player") {
    // Unaware and clustered around a couple of spots.
    const nPods = Math.max(1, Math.min(3, Math.ceil(count / 4)));
    pods = pickCells(nPods, (x) => x >= 9 && x <= W - 4, () => rng.next() * 3);
  }
  const flankTop = pc[1] >= mid; // flankers come from the side farther from your people
  let zn = 0, hn = 0;
  kinds.forEach((k, i) => {
    const u = enemyUnit(b, rng, k, e.power, k === "zombies" ? ++zn : ++hn);
    let c;
    if (setup.ambush === "player") {
      const pod = pods[i % pods.length] || [W - 3, Math.floor(mid)];
      u.aware = false;
      u.pod = i % Math.max(1, pods.length);
      c = pickCells(1, (x, y) => dist(x, y, pod[0], pod[1]) <= 3.2, (x, y) => -dist(x, y, pod[0], pod[1]) + coverScore(x, y) * 0.5)[0];
    } else if (setup.ambush === "enemy") {
      if (u.kind === "zombie") c = pickCells(1, (x, y) => { const d = dist(x, y, pc[0], pc[1]); return d >= 3.5 && d <= 7 && x > 1; }, () => 0)[0];
      else if (i % 2) c = pickCells(1, (x, y) => x >= 4 && x <= 9 && (flankTop ? y <= 2 : y >= H - 3), (x, y) => coverScore(x, y))[0];
      else c = pickCells(1, (x) => x >= W - 6, (x, y) => coverScore(x, y))[0];
    } else {
      c = pickCells(1, (x) => x >= W - 5, (x, y) => (u.kind === "zombie" ? 0 : coverScore(x, y)))[0];
    }
    c = c || pickCells(1, (x) => x >= 6, (x) => x)[0];
    if (!c) return;
    u.x = c[0]; u.y = c[1];
    b.units.push(u);
  });
  b.enemyStart = b.units.filter((u) => u.side === "enemy").length;

  const foeName = e.name || e.kind;
  say(b, `Battle at ${b.place} against ${foeName}.`, "info");
  if (setup.ambush === "player") say(b, "You have the drop on them. They have not seen you yet. Gunfire will alert them; melee is silent.", "good");
  if (setup.ambush === "enemy") {
    say(b, "Ambush! They saw you first. Your people are pinned: 1 action each this turn.", "danger");
    for (const u of b.units) if (u.side === "player") u.ap = 1;
    for (const u of b.units) {
      if (u.side !== "enemy" || !isRanged(u)) continue;
      const shot = bestShot(b, u, foesOf(b, u), { volley: true });
      if (shot) fire(b, u, shot.t, { volley: true });
    }
  }
  if (b.evacCols) say(b, "The green strip on the left edge is your way out. Units standing there can retreat.", "info");
  checkEnd(state, b);
  return b;
}

// Who a unit fights. Zombies drawn in by noise attack anyone alive, and raiders shoot back.
function foesOf(b, u) {
  if (u.wild) return b.units.filter((o) => active(o) && o.kind !== "zombie");
  if (u.side === "enemy" && u.kind === "human") return b.units.filter((o) => active(o) && (o.side === "player" || o.wild));
  return b.units.filter((o) => o.side !== u.side && active(o));
}

// ---------- actions ----------
function damage(b, t, raw, by) {
  const eff = raw * t.armor;
  t.hp = Math.max(0, t.hp - eff);
  if (t.hp > 0) return eff;
  if (t.side === "player") {
    t.down = true;
    t.bleed = BLEED_TURNS;
    t.ow = t.hunker = false;
    say(b, `${t.name} is down and bleeding. Use meds on them within ${BLEED_TURNS} turns${b.raid ? "; once stabilized they are carried out when a teammate extracts" : ""}.`, "death");
  } else {
    t.dead = true;
    t.killedBy = by ? by.side : null;
    if (b.raid && t.kind === "human") b.raid.containers.push({ id: b.nextId++, x: t.x, y: t.y, kind: "body", area: null, searched: false, kit: t.kit, weapon: t.weapon, label: `${t.name}'s body` });
    say(b, `${t.name} is dead.`, "good");
  }
  return eff;
}

// Gunfire wakes everyone. Caught by your own opening shots, they stay flat-footed until their turn.
function alertAll(b, why) {
  const sleepers = b.units.filter((u) => u.side === "enemy" && !u.aware && active(u));
  if (!sleepers.length) return;
  for (const u of sleepers) { u.aware = true; if (b.phase === "player") u.surprised = true; }
  say(b, b.phase === "player" ? "Your shots catch them by surprise. They scramble but cannot react this turn." : why, "good");
}

function alertPod(b, pod, why) {
  const sleepers = b.units.filter((u) => u.side === "enemy" && !u.aware && active(u) && u.pod === pod);
  if (!sleepers.length) return;
  for (const u of sleepers) u.aware = true;
  say(b, why, "danger");
  if (b.phase === "player") for (const u of sleepers) scramble(b, u);
}

// Freshly alerted humans dash for cover (XCOM-style), without spending their turn.
function scramble(b, u) {
  if (u.kind === "zombie" || !active(u)) return;
  const mv = bestMove(b, u, foesOf(b, u));
  if (mv) moveAlong(b, u, mv.path);
}

// An unaware enemy notices a player unit that comes close enough in its sight.
function detect(b, mover) {
  const range = Math.max(3, 8 - Math.floor(mover.stealth / 4));
  for (const e of b.units) {
    if (e.side !== "enemy" || e.aware || !active(e)) continue;
    const r = e.kind === "zombie" ? Math.min(range, 5) : range;
    if (dist(e.x, e.y, mover.x, mover.y) <= r && los(b, e.x, e.y, mover.x, mover.y)) {
      alertPod(b, e.pod, `${e.name} spotted ${mover.name}!`);
    }
  }
}

function moveAlong(b, u, path) {
  if (!path.length) return;
  const from = [u.x, u.y];
  const walked = [];
  for (const [x, y] of path) {
    const there = unitAt(b, x, y);
    if (there && (active(there) || (x === path[path.length - 1][0] && y === path[path.length - 1][1]))) break;
    u.x = x; u.y = y;
    walked.push([x, y]);
    // Overwatch: the first enemy that moves in sight draws a reaction shot.
    for (const o of b.units) {
      if (!o.ow || o.side === u.side || !active(o) || !active(u)) continue;
      if (!canSee(b, o, u) || !canFire(b, o)) continue;
      o.ow = false;
      say(b, `${o.name} reacts on overwatch.`, "info");
      fire(b, o, u, { reaction: true });
    }
    if (u.side === "player" && active(u)) detect(b, u);
    if (!active(u)) break;
  }
  if (walked.length) fx(b, { type: "move", unit: u.id, from, path: walked });
}

function fire(b, a, t, opts = {}) {
  const w = WEAPONS[a.weapon];
  const rng = b.rng;
  if (a.side === "player") {
    take(b, "ammo", w.ammo);
    b.ammoUsed += w.ammo;
    if (a.gearRisk && a.item && rng.chance(a.gearRisk)) {
      a.item.quality = Math.max(0.4, Math.round(((a.item.quality || 1) - 0.15) * 100) / 100);
      say(b, `${a.name}'s ${a.item.name} was damaged (it is above their skill).`, "danger");
    }
  }
  b.noise += w.noise || 0;
  const o = shotOdds(b, a, t, a.x, a.y, opts);
  const hit = rng.chance(o.chance / 100);
  let text;
  if (hit) {
    const crit = rng.chance(o.crit / 100);
    const raw = rng.int(o.dmg[0], o.dmg[1]) * (crit ? 1.5 : 1);
    const eff = Math.round(damage(b, t, raw, a));
    text = `${a.name} shoots ${t.name}: ${crit ? "critical hit" : "hit"} for ${eff} (${o.chance}%).`;
    fx(b, { type: "shot", from: [a.x, a.y], to: [t.x, t.y], hit: true, crit, dmg: eff, side: a.side });
  } else {
    text = `${a.name} shoots at ${t.name} and misses (${o.chance}%).`;
    fx(b, { type: "shot", from: [a.x, a.y], to: [t.x, t.y], hit: false, side: a.side });
  }
  say(b, text, a.side === "player" ? (hit ? "good" : "info") : hit ? "danger" : "info");
  if (w.noise && b.raid) alertNear(b, a.x, a.y, 9 + w.noise * 2, "The gunshots alert everything nearby.");
  else if (w.noise) alertAll(b, "The gunshots alert everyone nearby.");
  // Any hit that leaves a sleeper alive wakes its group, however quiet the weapon (a crossbow bolt, a shot from
  // beyond earshot in a raid).
  if (hit && t.side === "enemy" && !t.dead && !t.aware) alertPod(b, t.pod, `${t.name} cries out!`);
}

function strike(b, a, t) {
  const o = meleeOdds(b, a, t);
  const rng = b.rng;
  const hit = rng.chance(o.chance / 100);
  if (hit) {
    const crit = rng.chance(o.crit / 100);
    const eff = Math.round(damage(b, t, rng.int(o.dmg[0], o.dmg[1]) * (crit ? 1.5 : 1), a));
    say(b, `${a.name} ${a.kind === "zombie" ? "tears into" : "strikes"} ${t.name} for ${eff}.`, a.side === "player" ? "good" : "danger");
    fx(b, { type: "melee", from: [a.x, a.y], to: [t.x, t.y], hit: true, crit, dmg: eff, side: a.side });
  } else {
    say(b, `${a.name} lunges at ${t.name} and misses.`, "info");
    fx(b, { type: "melee", from: [a.x, a.y], to: [t.x, t.y], hit: false, side: a.side });
  }
  // A struck sleeper that survives wakes its group.
  if (t.side === "enemy" && !t.dead && !t.aware) alertPod(b, t.pod, `${t.name} cries out!`);
}

function heal(b, u, t) {
  take(b, "meds", 1);
  b.medsUsed++;
  if (t.down) {
    t.stab = true;
    say(b, `${u.name} stabilizes ${t.name}. ${b.raid ? "They will be carried out if a teammate extracts" : "They will live if you hold the field"}.`, "good");
  } else {
    const amt = Math.round(15 + u.medicine * 1.5);
    t.hp = Math.min(t.maxHp, t.hp + amt);
    say(b, `${u.name} patches up ${t === u ? "their own wounds" : t.name} (+${amt}).`, "good");
  }
  fx(b, { type: "heal", to: [t.x, t.y] });
  // Each treatment uses the healer's bandage kit a little (the wear is applied when the battle ends); a kit that
  // is used up stops helping.
  if (u.medKit && u.kitBonus) {
    u.kitUses += 1;
    if (u.kitUses >= u.kitLeft) {
      u.medicine -= u.kitBonus;
      u.kitBonus = 0;
      say(b, `${u.name}'s ${u.medKit.name} is used up.`, "info");
    }
  }
}

// Player commands. Returns an error message, or "" when the action happened.
export function combatAct(state, act) {
  const b = state.combat;
  if (!b || b.over) return "";
  if (act.type === "end") {
    if (b.phase === "player") endPlayerTurn(state);
    return "";
  }
  if (b.phase !== "player") return "Wait for the enemy turn to finish.";
  const u = unitById(b, act.unit);
  if (!u || u.side !== "player" || !active(u) || u.ap < 1) return "That unit cannot act.";
  const t = act.target != null ? unitById(b, act.target) : null;
  switch (act.type) {
    case "move": {
      if (!inside(act.x, act.y)) return "Cannot move there.";
      const r = reachable(b, u, u.mob * u.ap);
      const c = r.dist[idx(act.x, act.y)];
      if (!isFinite(c) || c === 0) return "Cannot move there.";
      u.ap -= c <= u.mob ? 1 : 2;
      u.hunker = false;
      moveAlong(b, u, pathTo(r, act.x, act.y));
      break;
    }
    case "shoot": {
      if (!t || t.side === "player" || !active(t)) return "No target.";
      if (!isRanged(u)) return "No gun.";
      if (!canFire(b, u)) return "Out of ammo.";
      if (!canSee(b, u, t)) return "No line of sight.";
      fire(b, u, t);
      u.ap = 0;
      break;
    }
    case "melee": {
      if (!t || t.side === "player" || !active(t) || !adjacent(u, t)) return "Must be next to the target.";
      strike(b, u, t);
      u.ap = 0;
      break;
    }
    case "overwatch":
      if (!canFire(b, u)) return "Needs a gun with ammo.";
      u.ow = true; u.ap = 0;
      say(b, `${u.name} is on overwatch.`, "info");
      break;
    case "hunker":
      u.hunker = true; u.ap = 0;
      say(b, `${u.name} hunkers down.`, "info");
      break;
    case "meds": {
      const target = t || u;
      if (target.side !== "player" || target.dead || target.left) return "No one to treat.";
      if (target !== u && !adjacent(u, target)) return "Must be next to them.";
      if (medsLeft(b) < 1) return "No meds left.";
      if (target.stab) return "Already stabilized.";
      if (!target.down && target.hp >= target.maxHp) return "Not hurt.";
      heal(b, u, target);
      u.ap -= 1;
      break;
    }
    case "search": {
      if (!b.raid) return "Nothing to search.";
      const box = act.box != null ? b.raid.containers.find((c) => c.id === act.box) : searchableNear(b, u)[0];
      if (!box || box.searched || !nearBox(u, box)) return "Move next to something to search first.";
      u.ap -= 1;
      searchBox(state, b, u, box);
      break;
    }
    case "extract": {
      if (!b.raid) return "Use Retreat.";
      const z = zoneAt(b, u.x, u.y);
      if (z < 0) return "Move into an extraction zone first.";
      u.left = true; u.exitZone = z; u.ap = 0; u.ow = u.hunker = false;
      say(b, `${u.name} extracts${b.raid.zones[z].vehicle ? " at the vehicle" : ""}.`, "good");
      break;
    }
    case "retreat":
      if (!inEvac(b, u.x)) return "Move into the evacuation zone first.";
      u.left = true; u.ap = 0; u.ow = u.hunker = false;
      say(b, `${u.name} slips away from the fight.`, "info");
      break;
    default:
      return "Unknown action.";
  }
  b.acted = true;
  bump(b);
  checkEnd(state, b);
  if (!b.over && b.phase === "player" && !b.units.some((x) => x.side === "player" && active(x) && x.ap > 0)) endPlayerTurn(state);
  return "";
}

// ---------- turn flow ----------
export function endPlayerTurn(state) {
  const b = state.combat;
  if (!b || b.over || b.phase !== "player") return;
  for (const u of b.units) if (u.side === "player") u.ap = 0;
  b.phase = "enemy";
  for (const u of b.units) if (u.side === "enemy" && active(u)) { u.ap = u.surprised ? 0 : 2; u.ow = false; u.hunker = false; u.surprised = false; }
  if (b.raid) raidTurn(b);
  else reinforcements(b);
  // Sleepers look around at the start of their turn.
  for (const u of b.units) if (u.side === "player" && active(u)) detect(b, u);
  b.queue = b.units.filter((u) => u.side === "enemy" && active(u)).sort((a, c) => (a.kind === "zombie") - (c.kind === "zombie")).map((u) => u.id);
  bump(b);
}

// Processes one enemy unit. Returns the unit that acted, or null when the enemy phase is over.
export function enemyStep(state) {
  const b = state.combat;
  if (!b || b.over || b.phase !== "enemy") return null;
  let u = null;
  while (b.queue.length && !u) {
    const c = unitById(b, b.queue.shift());
    if (c && active(c)) u = c;
  }
  if (u) aiUnit(b, u);
  checkEnd(state, b);
  if (!b.over && !b.queue.length) startPlayerTurn(b);
  bump(b);
  return u;
}

export function runEnemyPhase(state) {
  for (let i = 0; i < 200 && state.combat && state.combat.phase === "enemy" && !state.combat.over; i++) enemyStep(state);
}

function startPlayerTurn(b) {
  b.turn++;
  b.phase = "player";
  for (const u of b.units) {
    if (u.side !== "player") continue;
    u.ow = false; u.hunker = false;
    u.ap = active(u) ? 2 : 0;
    if (u.down && !u.stab && !u.dead && !u.left) {
      u.bleed--;
      if (u.bleed <= 0) { u.dead = true; say(b, `${u.name} bled out.`, "death"); }
      else say(b, `${u.name} is bleeding out (${u.bleed} turn${u.bleed > 1 ? "s" : ""} left).`, "danger");
    }
  }
}

// Gunfire on infected ground draws more of the dead from the map edge.
function reinforcements(b) {
  const rng = b.rng;
  const noise = b.noise;
  b.noise = 0;
  if (b.infection < 0.1 || !noise || b.reinf >= b.reinfMax) return;
  if (!rng.chance(Math.min(0.5, (b.infection * noise) / 18))) return;
  const edge = rng.pick(["north", "south", "east"]);
  const cells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const on = edge === "north" ? y === 0 && x >= 5 : edge === "south" ? y === H - 1 && x >= 5 : x === W - 1;
    if (on && b.reach[idx(x, y)] && cellAt(b, x, y).walk && !unitAt(b, x, y)) cells.push([x, y]);
  }
  rng.shuffle(cells);
  const n = Math.min(b.reinfMax - b.reinf, 1 + rng.int(0, Math.round(b.infection)), cells.length);
  if (n <= 0) return;
  for (let i = 0; i < n; i++) {
    const z = enemyUnit(b, rng, "zombies", 2 + b.infection * 3, b.units.filter((u) => u.kind === "zombie").length + 1);
    z.x = cells[i][0]; z.y = cells[i][1];
    z.reinforcement = z.wild = true;
    z.ap = 2;
    b.units.push(z);
  }
  b.reinf += n;
  say(b, `The noise draws more of the dead: ${n} shambling in from the ${edge} edge.`, "danger");
}

// ---------- AI (works for either side) ----------
function bestShot(b, u, foes, opts = {}) {
  if (!canFire(b, u)) return null;
  let best = null;
  for (const t of foes) {
    if (!canSee(b, u, t)) continue;
    const o = shotOdds(b, u, t, u.x, u.y, opts);
    const avg = (o.dmg[0] + o.dmg[1]) / 2 * (1 + o.crit / 200) * t.armor;
    let v = (o.chance / 100) * avg;
    if (t.hp <= avg) v *= 1.5;
    if (!best || v > best.v) best = { t, o, v };
  }
  return best;
}

function scoreCell(b, u, x, y, foes, cost, field) {
  let s = -cost * 0.4, best = 0, nearest = 99;
  for (const f of foes) {
    const d = dist(x, y, f.x, f.y);
    nearest = Math.min(nearest, d);
    if (!isRanged(f)) { if (d < 2.5) s -= 10; else if (d < 5) s -= (5 - d) * 2; continue; }
    if (d > f.sight || !los(b, x, y, f.x, f.y)) continue;
    const c = coverAgainst(b, x, y, f.x, f.y).level;
    s += c === 2 ? 0 : c === 1 ? -5 : -14;
  }
  if (canFire(b, u)) {
    for (const f of foes) {
      if (dist(x, y, f.x, f.y) > u.sight || !los(b, x, y, f.x, f.y)) continue;
      const o = shotOdds(b, u, f, x, y);
      best = Math.max(best, o.chance + (o.crit >= 40 ? 12 : 0));
    }
  }
  s += best * 0.3;
  if (!best) s -= 8 + (field ? Math.min(40, field[idx(x, y)]) : nearest);
  return s;
}

function bestMove(b, u, foes) {
  const r = reachable(b, u, u.mob);
  const field = distField(b, foes.map((f) => [f.x, f.y]));
  let best = null;
  for (let i = 0; i < W * H; i++) {
    if (!isFinite(r.dist[i]) || r.dist[i] === 0) continue;
    const x = i % W, y = (i / W) | 0;
    const sc = scoreCell(b, u, x, y, foes, r.dist[i], field) + b.rng.next() * 1.5;
    if (!best || sc > best.sc) best = { x, y, sc };
  }
  if (best) best.path = pathTo(r, best.x, best.y);
  return best;
}

function aiUnit(b, u) {
  if (!active(u)) return;
  const rng = b.rng;
  if (!u.aware && b.raid) {
    patrol(b, u);
    return;
  }
  if (!u.aware) {
    // Sleeping zombies shuffle about; sleeping humans hold position.
    if (u.kind === "zombie" && rng.chance(0.4)) {
      const r = reachable(b, u, 1.5);
      const opts = [];
      for (let i = 0; i < W * H; i++) if (r.dist[i] > 0 && isFinite(r.dist[i])) opts.push(i);
      if (opts.length) { const i = rng.pick(opts); moveAlong(b, u, pathTo(r, i % W, (i / W) | 0)); }
    }
    u.ap = 0;
    return;
  }
  if (u.side === "enemy" && u.kind === "human" && !u.fearless && shouldFlee(b)) return flee(b, u);
  if (u.side === "player" && aiMeds(b, u)) { if (u.ap < 1) return; }
  if (!canFire(b, u)) return aiMelee(b, u);
  for (let step = 0; step < 3 && u.ap > 0 && active(u); step++) {
    const foes = foesOf(b, u);
    if (!foes.length) return;
    const shot = bestShot(b, u, foes);
    const here = scoreCell(b, u, u.x, u.y, foes, 0, distField(b, foes.map((f) => [f.x, f.y])));
    if (shot && (u.ap === 1 || (shot.o.chance >= 55 && here > -6))) { fire(b, u, shot.t); u.ap = 0; return; }
    const mv = bestMove(b, u, foes);
    if (mv && mv.sc > here + 1) { u.ap -= 1; moveAlong(b, u, mv.path); continue; }
    if (shot) { fire(b, u, shot.t); u.ap = 0; return; }
    if (u.side === "player" || rng.chance(0.6)) u.ow = true;
    else if (coverSides(b, u.x, u.y).some((c) => c)) u.hunker = true;
    u.ap = 0;
  }
}

function aiMeds(b, u) {
  if (medsLeft(b) < 1) return false;
  const hurtAlly = b.units.find((o) => o.side === "player" && o.down && !o.stab && !o.dead && !o.left && (o === u || adjacent(u, o)));
  const target = hurtAlly || (u.hp < 40 ? u : null);
  if (!target) return false;
  heal(b, u, target);
  u.ap -= 1;
  return true;
}

function aiMelee(b, u) {
  for (let step = 0; step < 3 && u.ap > 0 && active(u); step++) {
    const foes = foesOf(b, u);
    if (!foes.length) return;
    const adj = foes.filter((f) => adjacent(u, f)).sort((a, c) => a.hp - c.hp);
    if (adj.length) { strike(b, u, adj[0]); u.ap = 0; return; }
    const r = reachable(b, u, u.mob * u.ap);
    const field = distField(b, foes.map((f) => [f.x, f.y]));
    let best = null;
    for (let i = 0; i < W * H; i++) {
      if (!isFinite(r.dist[i])) continue;
      const x = i % W, y = (i / W) | 0;
      const nextTo = foes.some((f) => Math.max(Math.abs(f.x - x), Math.abs(f.y - y)) === 1);
      const sc = (nextTo ? -100 : field[i]) + r.dist[i] * 0.05;
      if (!best || sc < best.sc) best = { x, y, sc, cost: r.dist[i], nextTo };
    }
    if (!best || best.cost === 0) { u.ap = 0; return; }
    u.ap -= best.cost <= u.mob ? 1 : 2;
    moveAlong(b, u, pathTo(r, best.x, best.y));
  }
}

function shouldFlee(b) {
  const humans = b.units.filter((u) => u.side === "enemy" && u.kind === "human" && active(u)).length;
  const mine = b.units.filter((u) => u.side === "player" && active(u)).length;
  return humans * 3 <= b.enemyStart && mine >= humans * 2;
}

function flee(b, u) {
  if (u.x >= W - 1) { u.fled = true; u.ap = 0; say(b, `${u.name} runs off.`, "good"); return; }
  const r = reachable(b, u, u.mob * u.ap);
  const exits = [];
  for (let y = 0; y < H; y++) if (cellAt(b, W - 1, y).walk) exits.push([W - 1, y]);
  const field = distField(b, exits);
  let best = null;
  for (let i = 0; i < W * H; i++) if (isFinite(r.dist[i]) && (best == null || field[i] < field[best])) best = i;
  if (best != null && r.dist[best] > 0) moveAlong(b, u, pathTo(r, best % W, (best / W) | 0));
  if (active(u) && u.x >= W - 1) { u.fled = true; say(b, `${u.name} breaks and runs.`, "good"); }
  else if (active(u) && !u.fleeing) { u.fleeing = true; say(b, `${u.name} falls back.`, "good"); }
  u.ap = 0;
}

// Runs a whole player turn with the AI (used by headless tests).
export function autoPlayerTurn(state) {
  const b = state.combat;
  if (!b || b.over || b.phase !== "player") return;
  if (b.raid) return autoRaidTurn(state);
  for (const u of b.units.filter((x) => x.side === "player")) {
    if (b.over) return;
    if (active(u) && u.ap > 0) aiUnit(b, u);
    checkEnd(state, b);
  }
  bump(b);
  if (!b.over) endPlayerTurn(state);
}

// ---------- ending ----------
function checkEnd(state, b) {
  if (b.over) return;
  if (b.raid) {
    if (!b.units.some((u) => u.side === "player" && active(u))) endRaid(state, b);
    return;
  }
  if (!b.units.some((u) => u.side === "enemy" && active(u))) return endBattle(state, b, "victory");
  if (!b.units.some((u) => u.side === "player" && active(u))) endBattle(state, b, b.units.some((u) => u.side === "player" && u.left) ? "retreat" : "defeat");
}

function endBattle(state, b, outcome) {
  const rng = state.rng;
  b.over = true;
  b.phase = "over";
  const setup = b.setup;
  const cause = `in a fight with ${setup.enemy.name || setup.enemy.kind}`;
  const zombies = setup.enemy.kind === "zombies";
  const hurtIds = [], deadIds = [];
  const lines = [];
  const medic = Math.max(0, ...b.units.filter((u) => u.side === "player" && active(u)).map((u) => u.medicine));
  for (const u of b.units) {
    if (u.side !== "player") continue;
    const s = survivorById(state, u.sid);
    if (!s || !s.alive) continue;
    let dies = u.dead;
    if (!dies && u.down) {
      let live;
      if (outcome === "victory") live = u.stab ? 1 : 0.5 + medic * 0.02;
      else if (outcome === "retreat") live = 0;
      else live = (zombies ? 0.1 : 0.35) + (u.stab ? 0.3 : 0);
      dies = !rng.chance(live);
      if (outcome === "retreat") lines.push(`${u.name} was left behind.`);
    }
    if (dies) {
      hurt(state, s, 9999, b.tileId, cause);
      deadIds.push(s.id);
      lines.push(`${u.name} died.`);
      continue;
    }
    const hp = u.down ? rng.int(5, 15) : u.hp;
    if (hp < s.health - 0.01) hurt(state, s, (s.health - hp) / u.armor, b.tileId, cause);
    else s.health = Math.min(100, Math.max(s.health, hp));
    if (!s.alive) { deadIds.push(s.id); continue; }
    if (s.health < u.startHp - 0.5) hurtIds.push(s.id);
    if (u.down) lines.push(`${u.name} pulled through, barely (health ${Math.round(s.health)}).`);
  }
  wearFielded(state, b, true);

  const enemies = b.units.filter((u) => u.side === "enemy");
  const original = enemies.filter((u) => !u.reinforcement);
  const killed = original.filter((u) => u.dead).length;
  // Loot: after a win the dead are bodies to search (inventory.js): enemies carry what they fought with plus
  // some ammo, food, meds and scrap; zombies now and then a pocket item; your fallen keep their own things.
  // result.loot fills up as things are taken (the loot screen, "Take all", or straight away when headless).
  const loot = { supplies: {}, gear: [] };
  b.bodies = [];
  if (outcome === "victory") {
    for (const e of enemies) if (e.dead) b.bodies.push(enemyBody(rng, e, KITS[e.kit] || (e.kind === "zombie" ? null : KITS.raiders)));
    for (const u of b.units) {
      const s = u.side === "player" && deadIds.includes(u.sid) ? survivorById(state, u.sid) : null;
      if (s) b.bodies.push(allyBody(s, u));
    }
    b.bodies = b.bodies.filter((body) => !bodyEmpty(state, body));
  }
  b.result = {
    outcome, enemiesKilled: killed, enemiesLeft: original.length - killed,
    survivorsHurt: hurtIds, survivorsDead: deadIds, ammoUsed: b.ammoUsed, loot,
    turns: b.turn, medsUsed: b.medsUsed, extraKilled: enemies.filter((u) => u.reinforcement && u.dead).length,
    // Played on the map: gear wear is done, and the dead were there to search (so handlers add no "loot from the bodies").
    tactical: true, worn: true, bodies: b.bodies.length,
  };
  b.summary = lines;
  say(b, outcome === "victory" ? "Victory. The area is clear." : outcome === "retreat" ? "You pulled out of the fight." : "Defeat. Your team is down.", outcome === "victory" ? "good" : "death");
  // No one to pick through the bodies by hand (headless tools, auto-combat): take all that fits now.
  if (b.bodies.length && (state.autoCombat || typeof window === "undefined")) takeAllBodies(state);
  bump(b);
}

// When a battle on the map ends, before anything is looted or moved: makeshift gear loses a use, but only on the
// units that took the field and only the item objects they took it with (weapon in hand, every worn armor
// piece). A bandage kit loses one use per treatment its carrier gave. A broken item is gone.
function wearFielded(state, b, fought) {
  for (const u of b.units) {
    if (u.side !== "player") continue;
    const s = survivorById(state, u.sid);
    if (!s || !s.alive) continue;
    if (fought) for (const [slot, item] of u.fielded || []) if (s.gear[slot] === item) wearSlot(state, s, slot);
    if (u.kitUses && u.medKit && s.gear.tool === u.medKit) wearSlot(state, s, "tool", u.kitUses);
  }
}

// Closes a finished battle: hands the result to the registered handler. take: first take everything that fits
// from the bodies (the default, as before looting existed); either way the rest stays where they fell.
export function closeCombat(state, { take = true } = {}) {
  const b = state.combat;
  if (!b || !b.over) return;
  if (b.bodies && b.bodies.length) {
    if (take) takeAllBodies(state);
    leaveBodies(state, b);
  }
  finishCombat(state, b.setup, b.result);
}

// ======================================================================================
// Raid mode: interactive scavenging. A bigger map with buildings and containers to search,
// roaming enemies that have not seen you yet, Heat that rises every turn, and set extraction
// zones. A vehicle you bring is parked in its own zone: extract there to keep it.
// ======================================================================================

export const RAID_W = 28, RAID_H = 18;
export const HEAT_NAMES = ["Quiet", "Stirring", "Swarming", "Overrun"];

// Loot per area type: supplies [chance, min, max] and gear [key, chance].
export const AREAS = {
  house:     { name: "House",          boxes: ["cabinet", "shelf", "locker"],  loot: { food: [0.6, 2, 6], water: [0.35, 2, 4], meds: [0.25, 1, 2], scrap: [0.4, 1, 4], ammo: [0.15, 4, 12] }, gear: [["knife", 0.06], ["pistol", 0.04], ["sportspads", 0.03], ["backpack", 0.03]] },
  farmhouse: { name: "Farmhouse",      boxes: ["cabinet", "shelf", "locker"],  loot: { food: [0.75, 3, 8], water: [0.4, 2, 5], ammo: [0.25, 4, 12], meds: [0.15, 1, 2] }, gear: [["huntrifle", 0.06], ["machete", 0.05]] },
  store:     { name: "Store",          boxes: ["shelf", "shelf", "counter"],   loot: { food: [0.85, 4, 10], water: [0.6, 3, 8], meds: [0.2, 1, 2] }, gear: [] },
  kitchen:   { name: "Kitchen",        boxes: ["shelf", "counter", "cabinet"], loot: { food: [0.85, 4, 12], water: [0.6, 3, 6] }, gear: [["knife", 0.08]] },
  pharmacy:  { name: "Pharmacy",       boxes: ["shelf", "cabinet", "counter"], loot: { meds: [0.85, 2, 6], food: [0.2, 1, 3] }, gear: [["surgkit", 0.05]] },
  clinic:    { name: "Clinic",         boxes: ["cabinet", "locker", "shelf"],  loot: { meds: [0.75, 2, 5], water: [0.3, 1, 3] }, gear: [["surgkit", 0.08]] },
  garage:    { name: "Garage",         boxes: ["locker", "crate", "shelf"],    loot: { fuel: [0.6, 2, 6], parts: [0.45, 1, 2], scrap: [0.7, 3, 8] }, gear: [["machete", 0.05], ["crowbar", 0.06], ["spikedbat", 0.03]] },
  workshop:  { name: "Workshop",       boxes: ["crate", "locker", "shelf"],    loot: { scrap: [0.8, 4, 10], parts: [0.5, 1, 3], fuel: [0.2, 1, 3] }, gear: [] },
  warehouse: { name: "Warehouse",      boxes: ["crate", "crate", "shelf"],     loot: { scrap: [0.7, 4, 10], food: [0.35, 3, 8], parts: [0.3, 1, 2], fuel: [0.2, 2, 4] }, gear: [] },
  office:    { name: "Offices",        boxes: ["cabinet", "cabinet", "counter"], loot: { scrap: [0.5, 1, 4], parts: [0.15, 1, 1], meds: [0.15, 1, 1], water: [0.3, 1, 3] }, gear: [] },
  armory:    { name: "Armory",         boxes: ["locker", "locker", "crate"],   loot: { ammo: [0.85, 15, 40] }, gear: [["pistol", 0.12], ["shotgun", 0.1], ["vest", 0.1], ["ar", 0.04]] },
  barracks:  { name: "Barracks",       boxes: ["locker", "locker", "cabinet"], loot: { ammo: [0.6, 10, 25], food: [0.4, 3, 6], meds: [0.3, 1, 3] }, gear: [["vest", 0.08], ["plate", 0.04], ["nvg", 0.03], ["milradio", 0.03]] },
  motorpool: { name: "Motor pool",     boxes: ["crate", "locker", "shelf"],    loot: { fuel: [0.75, 4, 10], parts: [0.55, 1, 3] }, gear: [] },
  barn:      { name: "Barn",           boxes: ["crate", "shelf"],              loot: { food: [0.7, 4, 10], fuel: [0.3, 2, 4], scrap: [0.3, 2, 4] }, gear: [["huntrifle", 0.05]] },
  lab:       { name: "Lab",            boxes: ["cabinet", "counter", "shelf"], loot: { meds: [0.5, 1, 4], parts: [0.4, 1, 2], scrap: [0.3, 1, 3] }, gear: [["surgkit", 0.05], ["milradio", 0.03]] },
  cabin:     { name: "Hunting cabin",  boxes: ["locker", "shelf"],             loot: { food: [0.5, 2, 6], ammo: [0.5, 6, 18], meds: [0.2, 1, 2] }, gear: [["huntrifle", 0.08], ["machete", 0.06]] },
  hangar:    { name: "Hangar",         boxes: ["crate", "locker", "shelf"],    loot: { fuel: [0.6, 4, 10], parts: [0.5, 1, 3], scrap: [0.5, 3, 6] }, gear: [] },
  cellblock: { name: "Cell block",     boxes: ["locker", "cabinet"],           loot: { food: [0.3, 1, 4], scrap: [0.3, 1, 3], ammo: [0.15, 4, 10] }, gear: [["knife", 0.08]] },
  control:   { name: "Control room",   boxes: ["cabinet", "counter"],          loot: { parts: [0.6, 1, 3], scrap: [0.4, 2, 5] }, gear: [] },
  campsite:  { name: "Campsite",       outdoor: true, boxes: ["crate", "crate"], loot: { food: [0.5, 2, 5], water: [0.5, 2, 4], ammo: [0.25, 4, 10] }, gear: [["knife", 0.05], ["pipespear", 0.05], ["waterfilter", 0.04], ["padding", 0.04]] },
  wreck:     { name: "Wrecked cars",   outdoor: true, boxes: ["car", "car", "car"], loot: { fuel: [0.5, 1, 4], scrap: [0.5, 1, 4], parts: [0.2, 1, 1], food: [0.15, 1, 3] }, gear: [["pistol", 0.03]], alarm: 0.15 },
  pumps:     { name: "Fuel pumps",     outdoor: true, boxes: ["pump", "pump"], loot: { fuel: [0.7, 3, 8] }, gear: [] },
  gunshop:   { name: "Gun counter",    boxes: ["locker", "counter", "shelf"],  loot: { ammo: [0.85, 12, 35], scrap: [0.2, 1, 2] }, gear: [["pistol", 0.12], ["shotgun", 0.1], ["huntrifle", 0.1], ["vest", 0.05], ["kneeguards", 0.05]] },
  lockers:   { name: "Locker room",    boxes: ["locker", "locker", "shelf"],   loot: { water: [0.4, 1, 3], meds: [0.25, 1, 2], scrap: [0.3, 1, 3] }, gear: [["sportspads", 0.1], ["footballhelmet", 0.08], ["backpack", 0.06], ["kneeguards", 0.04]] },
  chapel:    { name: "Chapel",         boxes: ["cabinet", "shelf", "counter"], loot: { food: [0.5, 2, 6], water: [0.5, 2, 5], meds: [0.2, 1, 2] }, gear: [["bandagekit", 0.05]] },
};
const AREA_SETS = {
  town: ["house", "house", "store", "garage", "pharmacy", "wreck"], city: ["store", "pharmacy", "office", "house", "warehouse", "wreck"],
  farm: ["farmhouse", "barn", "barn", "campsite"], gas: ["store", "garage", "pumps", "wreck"], mall: ["store", "store", "pharmacy", "kitchen", "warehouse"],
  hospital: ["clinic", "clinic", "pharmacy", "office", "kitchen"], police: ["armory", "office", "garage", "cellblock"],
  military: ["armory", "barracks", "motorpool", "warehouse"], prison: ["cellblock", "cellblock", "kitchen", "armory", "clinic"],
  univ: ["lab", "lab", "office", "kitchen"], dam: ["control", "workshop", "warehouse"], airport: ["hangar", "warehouse", "store", "office"],
  factory: ["workshop", "warehouse", "office", "garage"], quarry: ["workshop", "garage", "campsite"],
  forest: ["cabin", "campsite", "wreck"], hills: ["cabin", "campsite"], mountain: ["campsite", "cabin"], plains: ["farmhouse", "barn", "wreck"],
  suburb: ["house", "house", "house", "garage"], water: ["campsite", "wreck"],
  // City blocks.
  autoshop: ["garage", "garage", "workshop", "wreck"], pharmacy: ["pharmacy", "pharmacy", "store", "office"],
  supermarket: ["store", "store", "kitchen", "warehouse", "wreck"], gunstore: ["gunshop", "store", "office", "wreck"],
  hardware: ["workshop", "store", "garage", "warehouse"], apartments: ["house", "house", "house", "kitchen", "garage"],
  office: ["office", "office", "office", "kitchen"], school: ["lockers", "office", "kitchen", "clinic", "lockers"],
  firestation: ["garage", "clinic", "kitchen", "motorpool"], warehouse: ["warehouse", "warehouse", "warehouse", "office", "wreck"],
  // Small-town shops.
  grocery: ["store", "store", "kitchen", "garage"], diner: ["kitchen", "kitchen", "store", "wreck"], motel: ["house", "house", "house", "office", "wreck"],
  church: ["chapel", "kitchen", "house", "campsite"], clinic: ["clinic", "clinic", "pharmacy", "office"], feedstore: ["barn", "store", "warehouse", "garage"],
  // Countryside.
  barn: ["barn", "barn", "campsite"], ranch: ["farmhouse", "barn", "barn", "garage"], cabin: ["cabin", "campsite"],
  lodge: ["cabin", "cabin", "kitchen", "campsite"], campground: ["campsite", "campsite", "campsite", "wreck"], ranger: ["cabin", "office", "garage"],
  radiotower: ["control", "workshop"], truckstop: ["store", "kitchen", "garage", "pumps", "wreck"], crashsite: ["wreck", "wreck", "campsite"],
};

export function raidAreasFor(tile) {
  const t = tile || { terrain: "plains" };
  return (t.loc && AREA_SETS[t.loc.type]) || AREA_SETS[t.terrain] || AREA_SETS.plains;
}

// What an area tends to hold, for tooltips.
export function areaHint(type) {
  const a = AREAS[type];
  if (!a) return "";
  const sup = Object.entries(a.loot).sort((x, y) => y[1][0] - x[1][0]).map(([k]) => k);
  return `Likely: ${sup.join(", ")}${a.gear.length ? ", maybe gear" : ""}`;
}

export const zoneAt = (b, x, y) => (b.raid ? b.raid.zones.findIndex((z) => x >= z.x0 && x < z.x0 + z.w && y >= z.y0 && y < z.y0 + z.h) : -1);
export const nearBox = (u, c) => Math.max(Math.abs(u.x - c.x), Math.abs(u.y - c.y)) <= 1;
export const boxAt = (b, x, y) => (b.raid ? b.raid.containers.find((c) => c.x === x && c.y === y && !c.searched) || b.raid.containers.find((c) => c.x === x && c.y === y) : null);
export function searchableNear(b, u) {
  return b.raid ? b.raid.containers.filter((c) => !c.searched && nearBox(u, c)).sort((a, c) => (a.kind === "body") - (c.kind === "body")) : [];
}

function genRaidMap(rng, tile, areaTypes, withVehicle) {
  const t = tile || { terrain: "plains" };
  const floor = { plains: "grass", forest: "grass", hills: "dirt", mountain: "gravel", suburb: "grass", city: "rubble", water: "grass" }[t.terrain] || "grass";
  const cells = Array.from({ length: W * H }, () => ({ k: "open", f: floor }));
  const reserved = new Uint8Array(W * H);
  const at = (x, y) => (inside(x, y) ? cells[idx(x, y)] : null);
  const put = (x, y, k, f) => { const c = at(x, y); if (c) { c.k = k; if (f) c.f = f; } };
  const free = (x, y) => { const c = at(x, y); return c && c.k === "open" && !reserved[idx(x, y)] && c.f !== "road" && c.f !== "floor"; };

  // Extraction zones: 3×3 at the edges. The first is where the team comes in.
  const zones = [];
  const zoneSpots = rng.shuffle([
    { side: "west", x0: 0, y0: rng.int(2, H - 5) },
    { side: "east", x0: W - 3, y0: rng.int(2, H - 5) },
    { side: rng.chance(0.5) ? "north" : "south", x0: rng.int(8, W - 11), y0: 0 },
  ]);
  zoneSpots.sort((a, c) => (a.side === "west" ? -1 : c.side === "west" ? 1 : 0));
  for (const zs of zoneSpots) {
    const y0 = zs.side === "south" ? H - 3 : zs.y0;
    zones.push({ x0: zs.x0, y0, w: 3, h: 3, side: zs.side, vehicle: false });
    for (let y = y0 - 1; y <= y0 + 3; y++) for (let x = zs.x0 - 1; x <= zs.x0 + 3; x++) if (inside(x, y)) reserved[idx(x, y)] = 1;
  }
  if (withVehicle) {
    const z = zones[0];
    z.vehicle = true;
    put(z.x0 + 1, z.y0 + 1, "vehicle", "road");
  }

  // Road across the map.
  if (t.road) {
    const r = rng.int(3, H - 5);
    for (let x = 0; x < W; x++) for (const y of [r, r + 1]) if (!reserved[idx(x, y)]) put(x, y, "open", "road");
    for (let i = 0; i < rng.int(2, 4); i++) { const x = rng.int(5, W - 6), y = rng.pick([r, r + 1]); if (!reserved[idx(x, y)]) put(x, y, rng.chance(0.3) ? "truck" : "car"); }
  }

  const rectFree = (x0, y0, w, h) => {
    if (x0 < 1 || y0 < 1 || x0 + w > W - 1 || y0 + h > H - 1) return false;
    for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) if (!free(x, y)) return false;
    return true;
  };
  const areas = [], containers = [];
  let cid = 1;
  for (const type of areaTypes) {
    const def = AREAS[type];
    if (!def) continue;
    const area = { id: areas.length, type, name: def.name };
    if (def.outdoor) {
      // A cluster of objects around a free spot.
      let cx = 0, cy = 0, ok = false;
      for (let tries = 0; tries < 40 && !ok; tries++) {
        cx = rng.int(5, W - 6); cy = rng.int(2, H - 3);
        ok = free(cx, cy) && free(cx - 1, cy) && free(cx + 1, cy);
      }
      if (!ok) continue;
      const n = rng.int(2, 4);
      let placed = 0;
      for (let tries = 0; tries < 30 && placed < n; tries++) {
        const x = cx + rng.int(-3, 3), y = cy + rng.int(-2, 2);
        if (!free(x, y)) continue;
        const kind = rng.pick(def.boxes);
        put(x, y, kind === "pump" ? "pump" : kind === "car" ? "car" : "crate");
        containers.push({ id: cid++, x, y, area: area.id, kind, searched: false, label: `${def.name}: ${kind === "car" ? "car" : kind === "pump" ? "fuel pump" : "crate"}` });
        placed++;
      }
      Object.assign(area, { x0: cx - 3, y0: cy - 2, w: 7, h: 5, outdoor: true });
      areas.push(area);
      continue;
    }
    // A building with doors, windows and containers against the inside walls.
    let built = false;
    for (let tries = 0; tries < 40 && !built; tries++) {
      const w = rng.int(5, 8), h = rng.int(4, 6);
      const x0 = rng.int(4, W - 5 - w), y0 = rng.int(1, H - 1 - h);
      if (!rectFree(x0, y0, w, h)) continue;
      const edge = [];
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const border = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
        put(x, y, border ? "wall" : "open", "floor");
        const corner = (x === x0 || x === x0 + w - 1) && (y === y0 || y === y0 + h - 1);
        if (border && !corner) edge.push([x, y]);
      }
      rng.shuffle(edge);
      const doors = edge.slice(0, 2);
      doors.forEach(([x, y]) => put(x, y, "open", "floor"));
      edge.slice(2, 2 + rng.int(1, 2)).forEach(([x, y]) => put(x, y, "window"));
      // Inside cells touching a wall, away from doors.
      const spots = [];
      for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x < x0 + w - 1; x++) {
        const byWall = x === x0 + 1 || x === x0 + w - 2 || y === y0 + 1 || y === y0 + h - 2;
        const byDoor = doors.some(([dx, dy]) => Math.abs(dx - x) + Math.abs(dy - y) <= 1);
        if (byWall && !byDoor) spots.push([x, y]);
      }
      rng.shuffle(spots);
      const n = Math.min(spots.length, rng.int(2, 4));
      for (let i = 0; i < n; i++) {
        const [x, y] = spots[i];
        const kind = rng.pick(def.boxes);
        put(x, y, kind, "floor");
        containers.push({ id: cid++, x, y, area: area.id, kind, searched: false, label: `${def.name}: ${kind}` });
      }
      for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) if (inside(x, y)) reserved[idx(x, y)] = 1;
      Object.assign(area, { x0, y0, w, h, doors });
      areas.push(area);
      built = true;
    }
  }

  // Terrain cover.
  const scatter = (k, n) => { for (let i = 0; i < n; i++) { const x = rng.int(1, W - 2), y = rng.int(0, H - 1); if (free(x, y)) put(x, y, k); } };
  switch (t.terrain) {
    case "forest": scatter("tree", 70); scatter("rock", 10); break;
    case "hills": scatter("rock", 30); scatter("boulder", 12); scatter("tree", 10); break;
    case "mountain": scatter("boulder", 25); scatter("rock", 20); break;
    case "suburb": scatter("tree", 18); scatter("car", 6); scatter("fence", 8); break;
    case "city": scatter("car", 10); scatter("truck", 3); scatter("crate", 8); break;
    default: scatter("tree", 14); scatter("rock", 10); scatter("fence", 6); break;
  }
  if (t.loc && (t.loc.type === "farm" || t.loc.type === "ranch")) { scatter("hay", 10); for (const c of cells) if (c.f === "grass") c.f = "field"; }

  // Make sure every zone and every container can be reached from the entry zone.
  const entry = zones[0];
  const start = [entry.x0 + (entry.vehicle ? 0 : 1), entry.y0 + 1];
  const carve = (x0, y0, x1, y1) => {
    let x = x0, y = y0;
    const step = () => { const c = at(x, y); if (c && !CELL[c.k].walk && c.k !== "vehicle") { c.k = "open"; if (c.f === "floor") c.f = "floor"; } };
    while (x !== x1) { x += Math.sign(x1 - x); step(); }
    while (y !== y1) { y += Math.sign(y1 - y); step(); }
  };
  let reach = flood(cells, start[0], start[1]);
  const reachableNear = (c) => DIRS8.some(([dx, dy]) => inside(c.x + dx, c.y + dy) && reach[idx(c.x + dx, c.y + dy)]);
  for (const z of zones.slice(1)) {
    if (!reach[idx(z.x0 + 1, z.y0 + 1)]) { carve(start[0], start[1], z.x0 + 1, z.y0 + 1); reach = flood(cells, start[0], start[1]); }
  }
  for (const c of containers) {
    if (reachableNear(c)) continue;
    const door = areas[c.area]?.doors?.[0];
    if (door) carve(start[0], start[1], door[0], door[1]);
    reach = flood(cells, start[0], start[1]);
    if (!reachableNear(c)) { carve(start[0], start[1], c.x, c.y + (c.y > 0 ? -1 : 1)); reach = flood(cells, start[0], start[1]); }
  }
  const kept = containers.filter((c) => reachableNear(c));
  return { cells, reach, areas, containers: kept, zones };
}

export function createRaid(state, setup) {
  W = RAID_W; H = RAID_H;
  const rng = state.rng;
  const tileId = tileIdOf(setup);
  const tile = state.tiles[tileId];
  const party = state.parties.find((x) => x.id === setup.partyId);
  const types = rng.shuffle(raidAreasFor(tile).slice()).slice(0, rng.int(3, 5));
  const withVehicle = !!(party && party.vehicle);
  const map = genRaidMap(rng, tile, types, withVehicle);
  const b = {
    setup, tileId: party ? partyTile(party) : tileId, w: W, h: H, cells: map.cells, reach: map.reach,
    place: tile ? (tile.loc ? tile.loc.name : tile.terrain[0].toUpperCase() + tile.terrain.slice(1)) : "Open ground",
    units: [], turn: 1, phase: "player", log: [], fx: [], fxSeq: 0, rev: 1, nextId: 1000,
    pools: party ? [party.supplies, party.cargo ? party.cargo.supplies : {}] : [{}],
    ammoUsed: 0, medsUsed: 0, noise: 0, reinf: 0, infection: tile ? tile.infection || 0 : 0,
    evacCols: 0, over: false, result: null, acted: true, queue: [],
    losCache: new Int8Array(W * H * W * H), rng,
    raid: {
      areas: map.areas, containers: map.containers, zones: map.zones,
      vehicleZone: map.zones.findIndex((z) => z.vehicle), heat: setup.raid?.heat0 || 0, stage: 0, spawned: 0, spawnCap: 12,
      found: {}, foundGear: [], richness: Math.max(0.35, Math.min(1.2, (tile ? tile.loot : 0.5) * 1.3)),
    },
  };
  b.reinfMax = 0;
  const occupied = (x, y) => !!unitAt(b, x, y);
  const ok = (x, y) => inside(x, y) && b.reach[idx(x, y)] && cellAt(b, x, y).walk && !occupied(x, y);
  const entry = map.zones[0];

  // Your team starts in the entry zone (next to the vehicle if you brought one).
  const people = combatants(state, setup).slice(0, MAX_PLAYERS);
  const entryCells = [];
  for (let y = entry.y0 - 1; y <= entry.y0 + entry.h; y++) for (let x = entry.x0; x <= entry.x0 + entry.w; x++) entryCells.push([x, y]);
  entryCells.sort((a, c) => (zoneAt(b, c[0], c[1]) === 0) - (zoneAt(b, a[0], a[1]) === 0));
  for (const s of people) {
    const u = playerUnit(b, s);
    const c = entryCells.find(([x, y]) => ok(x, y)) || [entry.x0, entry.y0];
    u.x = c[0]; u.y = c[1];
    b.units.push(u);
  }

  // Enemies: guards around buildings, the dead scattered about. Nobody has seen you yet.
  const center = [entry.x0 + 1, entry.y0 + 1];
  const groups = setup.enemy.groups || [{ kind: setup.enemy.kind, count: setup.enemy.count, power: setup.enemy.power }];
  let pod = 0, zn = 0, hn = 0;
  const buildings = map.areas.filter((a) => !a.outdoor);
  for (const g of groups) {
    const count = Math.max(0, Math.min(MAX_ENEMIES, Math.round(g.count || 0)));
    if (!count) continue;
    if (g.kind === "zombies") {
      for (let i = 0; i < count; i++) {
        const u = enemyUnit(b, rng, "zombies", g.power, ++zn);
        const cells = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ok(x, y) && dist(x, y, center[0], center[1]) >= 8 && zoneAt(b, x, y) < 0) cells.push([x, y]);
        const c = rng.pick(cells);
        if (!c) continue;
        u.x = c[0]; u.y = c[1]; u.aware = false; u.pod = pod++; u.home = [c[0], c[1]];
        b.units.push(u);
      }
    } else {
      const home = buildings.length ? rng.pick(buildings) : null;
      const hx = home ? home.x0 + Math.floor(home.w / 2) : rng.int(W / 2, W - 4), hy = home ? home.y0 + Math.floor(home.h / 2) : rng.int(3, H - 4);
      for (let i = 0; i < count; i++) {
        const u = enemyUnit(b, rng, g.kind, g.power, ++hn);
        const cells = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ok(x, y) && dist(x, y, hx, hy) <= 5 && dist(x, y, center[0], center[1]) >= 9) cells.push([x, y]);
        const c = rng.pick(cells);
        if (!c) continue;
        u.x = c[0]; u.y = c[1]; u.aware = false; u.pod = pod; u.home = [hx, hy];
        b.units.push(u);
      }
      pod++;
    }
  }
  b.enemyStart = b.units.filter((u) => u.side === "enemy").length;
  say(b, `You slip into ${b.place}. ${map.containers.length} places to search across ${map.areas.length} areas.`, "info");
  say(b, "Search next to a container (S). Heat rises every turn and with gunfire; more of the dead arrive as it climbs. Reach a green zone and Extract (X).", "info");
  if (withVehicle) say(b, "Your vehicle waits in the entry zone. Extract there to keep it; leave from another zone and it stays behind.", "info");
  return b;
}

// Unaware enemies wander: guards walk a beat around their building, the dead shuffle.
function patrol(b, u) {
  const rng = b.rng;
  if (u.kind === "zombie" && !rng.chance(0.5)) { u.ap = 0; return; }
  const home = u.home || [u.x, u.y];
  if (!u.wp || (u.x === u.wp[0] && u.y === u.wp[1]) || rng.chance(0.15)) {
    const opts = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.reach[idx(x, y)] && cellAt(b, x, y).walk && dist(x, y, home[0], home[1]) <= (u.kind === "zombie" ? 4 : 6)) opts.push([x, y]);
    u.wp = rng.pick(opts) || home;
  }
  const r = reachable(b, u, u.kind === "zombie" ? 2 : u.mob * 0.6);
  let best = null;
  for (let i = 0; i < W * H; i++) {
    if (!isFinite(r.dist[i]) || r.dist[i] === 0) continue;
    const d = dist(i % W, (i / W) | 0, u.wp[0], u.wp[1]);
    if (!best || d < best.d) best = { i, d };
  }
  if (best && best.d < dist(u.x, u.y, u.wp[0], u.wp[1])) moveAlong(b, u, pathTo(r, best.i % W, (best.i / W) | 0));
  notice(b, u);
  u.ap = 0;
}

// A wandering enemy that walks into view of your people raises the alarm for its group.
function notice(b, e) {
  if (e.aware || !active(e)) return;
  for (const p of b.units) {
    if (p.side !== "player" || !active(p)) continue;
    const range = Math.max(3, 8 - Math.floor(p.stealth / 4));
    const r = e.kind === "zombie" ? Math.min(range, 5) : range;
    if (dist(e.x, e.y, p.x, p.y) <= r && los(b, e.x, e.y, p.x, p.y)) {
      alertPod(b, e.pod, `${e.name} spotted ${p.name}!`);
      return;
    }
  }
}

// Noise wakes everything within earshot (raids only; ordinary battles wake everyone).
function alertNear(b, x, y, radius, why) {
  const near = b.units.filter((u) => u.side === "enemy" && !u.aware && active(u) && dist(u.x, u.y, x, y) <= radius);
  if (!near.length) return;
  const pods = new Set(near.map((u) => u.pod));
  for (const u of b.units) if (u.side === "enemy" && !u.aware && active(u) && pods.has(u.pod)) { u.aware = true; if (b.phase === "player") u.surprised = true; }
  say(b, why, "danger");
}

// Heat climbs every turn and with noise. Each new stage brings a wave of the dead.
function raidTurn(b) {
  const R = b.raid;
  const rng = b.rng;
  const noise = b.noise;
  b.noise = 0;
  R.heat = Math.min(100, R.heat + 1.2 + noise * 1.0 + b.infection * 0.6);
  const stage = Math.min(3, Math.floor(R.heat / 25));
  if (stage > R.stage) {
    R.stage = stage;
    say(b, `Heat is now ${HEAT_NAMES[stage]}.`, "danger");
    spawnWave(b, stage + Math.round(b.infection * 2));
  } else if (R.stage >= 2 && rng.chance(0.2 + 0.1 * R.stage)) spawnWave(b, 1 + (R.stage === 3 ? 1 : 0));
}

function spawnWave(b, n) {
  const R = b.raid;
  const rng = b.rng;
  n = Math.min(n, R.spawnCap - R.spawned);
  if (n <= 0) return;
  const players = b.units.filter((u) => u.side === "player" && active(u));
  const cells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    if (!edge || !b.reach[idx(x, y)] || !cellAt(b, x, y).walk || unitAt(b, x, y) || zoneAt(b, x, y) >= 0) continue;
    if (players.some((p) => dist(p.x, p.y, x, y) < 9)) continue;
    cells.push([x, y]);
  }
  rng.shuffle(cells);
  const made = Math.min(n, cells.length);
  for (let i = 0; i < made; i++) {
    const z = enemyUnit(b, rng, "zombies", 2 + b.infection * 3, b.units.filter((u) => u.kind === "zombie").length + 1);
    z.x = cells[i][0]; z.y = cells[i][1];
    z.reinforcement = z.wild = true;
    z.aware = true;
    b.units.push(z);
  }
  R.spawned += made;
  if (made) say(b, `${made} more of the dead shamble in, drawn by the commotion.`, "danger");
}

function searchBox(state, b, u, box) {
  const rng = state.rng;
  const R = b.raid;
  const s = survivorById(state, u.sid);
  const scav = s ? skill(s, "scavenging") : 0;
  const party = state.parties.find((x) => x.id === b.setup.partyId);
  const rich = box.kind === "body" ? 1 : R.richness;
  // Roll what is inside (once); anything that does not fit stays in the container.
  if (!box.contents) {
    const sup = {}, gear = [];
    if (box.kind === "body") {
      sup.ammo = rng.int(3, 10);
      if (rng.chance(0.25)) sup.food = rng.int(1, 3);
      if (rng.chance(0.15)) sup.meds = 1;
      if (rng.chance(0.3)) {
        const kit = KITS[box.kit] || KITS.raiders;
        const key = rng.chance(0.5) && GEAR[box.weapon] ? box.weapon : rng.pick(kit.loot);
        gear.push({ key, name: GEAR[key].name, quality: rng.pick([0.7, 0.85, 1]) });
      }
    } else {
      const def = AREAS[R.areas[box.area].type];
      for (const [k, [p, lo, hi]] of Object.entries(def.loot)) {
        if (!rng.chance(Math.min(0.95, p * (0.6 + 0.4 * rich) * (1 + scav / 40)))) continue;
        sup[k] = Math.max(1, Math.round(rng.int(lo, hi) * (0.6 + 0.5 * rich) * (1 + scav / 25)));
      }
      for (const [key, p] of def.gear) if (rng.chance(p * (0.5 + rich) * (1 + scav / 30))) gear.push({ key, name: GEAR[key].name, quality: 1 });
      if (def.alarm && box.kind === "car" && rng.chance(def.alarm)) {
        R.heat = Math.min(100, R.heat + 12);
        say(b, "A car alarm goes off! Heat jumps.", "danger");
        alertNear(b, box.x, box.y, 12, "The alarm wakes everything nearby.");
      }
    }
    box.contents = { sup, gear };
  }
  const got = [];
  const left = [];
  let room = party ? partyCapacity(state, party) - cargoLoad(party.cargo) : 0;
  for (const [k, q] of Object.entries(box.contents.sup)) {
    const take = party ? Math.min(q, unitsThatFit(room, k)) : 0;
    if (take > 0) {
      party.cargo.supplies[k] = (party.cargo.supplies[k] || 0) + take;
      R.found[k] = (R.found[k] || 0) + take;
      room -= take * SUPPLIES[k].weight;
      got.push(`${take} ${k}`);
    }
    if (q - take > 0) left.push(`${q - take} ${k}`);
    box.contents.sup[k] = q - take;
  }
  box.contents.gear = box.contents.gear.filter((g) => {
    if (party && room >= 3) {
      party.cargo.gear.push(g);
      R.foundGear.push(g);
      room -= 3;
      got.push(g.name);
      return false;
    }
    left.push(g.name);
    return true;
  });
  box.searched = !left.length;
  if (left.length) box.partial = true;
  const what = got.length ? got.join(", ") : "nothing useful";
  say(b, `${u.name} searches the ${box.kind === "body" ? box.label : box.label.toLowerCase()}: ${what}.${left.length ? ` No room for ${left.join(", ")} (left inside).` : ""}`, got.length ? "good" : "info");
  fx(b, { type: "loot", to: [box.x, box.y], text: got.length ? `+${got.length > 1 ? got.length + " items" : got[0]}` : "empty" });
}

function endRaid(state, b) {
  const rng = state.rng;
  const R = b.raid;
  b.over = true;
  b.phase = "over";
  const hurtIds = [], deadIds = [], extractedIds = [], carriedIds = [];
  const lines = [];
  // Someone walked out: the downed can be carried. A stabilized teammate lives; one still bleeding takes the
  // same chance as the downed in a lost battle. With nobody out, everyone still on the map is lost.
  const anyOut = b.units.some((u) => u.side === "player" && u.left && !u.dead);
  const zombies = b.setup.enemy.kind === "zombies";
  for (const u of b.units) {
    if (u.side !== "player") continue;
    const s = survivorById(state, u.sid);
    if (!s || !s.alive) continue;
    const carried = !u.dead && !u.left && u.down && anyOut && (u.stab || rng.chance(zombies ? 0.1 : 0.35));
    if (carried) {
      const hp = rng.int(5, 15);
      if (hp < s.health - 0.01) hurt(state, s, (s.health - hp) / u.armor, b.tileId, `while scavenging ${b.place}`);
      if (!s.alive) { deadIds.push(s.id); lines.push(`${u.name} died.`); continue; }
      carriedIds.push(s.id);
      hurtIds.push(s.id);
      lines.push(`${u.name} was carried out, barely alive (health ${Math.round(s.health)}).`);
      continue;
    }
    if (u.dead || !u.left) {
      hurt(state, s, 9999, b.tileId, u.dead ? `while scavenging ${b.place}` : `left behind while scavenging ${b.place}`);
      deadIds.push(s.id);
      lines.push(u.dead ? `${u.name} died.` : u.down && anyOut ? `${u.name} bled out before the others could carry them clear.` : `${u.name} was left behind.`);
      continue;
    }
    extractedIds.push(s.id);
    if (u.hp < s.health - 0.01) hurt(state, s, (s.health - u.hp) / u.armor, b.tileId, `while scavenging ${b.place}`);
    if (!s.alive) { deadIds.push(s.id); continue; }
    if (s.health < u.startHp - 0.5) hurtIds.push(s.id);
  }
  const vehicleKept = R.vehicleZone >= 0 && b.units.some((u) => u.side === "player" && u.left && !u.dead && u.exitZone === R.vehicleZone);
  if (R.vehicleZone >= 0 && extractedIds.length && !vehicleKept) lines.push("Nobody went back to the vehicle. It stays behind at the site.");
  const enemies = b.units.filter((u) => u.side === "enemy");
  const original = enemies.filter((u) => !u.reinforcement);
  const killed = original.filter((u) => u.dead).length;
  const outcome = extractedIds.length ? "extracted" : "defeat";
  wearFielded(state, b, killed > 0); // makeshift gear wears in a raid only if someone was killed; a med kit by its use
  b.result = {
    outcome, enemiesKilled: killed, enemiesLeft: original.length - killed,
    survivorsHurt: hurtIds, survivorsDead: deadIds, ammoUsed: b.ammoUsed,
    loot: { supplies: { ...R.found }, gear: R.foundGear.slice() },
    turns: b.turn, medsUsed: b.medsUsed, extraKilled: enemies.filter((u) => u.reinforcement && u.dead).length,
    tactical: true, worn: true,
    raid: {
      extractedIds, carriedIds, vehicleKept, hadVehicle: R.vehicleZone >= 0, heat: Math.round(R.heat),
      searched: R.containers.filter((c) => c.searched && c.kind !== "body").length, total: R.containers.filter((c) => c.kind !== "body").length,
      hours: Math.max(1, Math.ceil(b.turn / 6)),
      alerted: original.some((u) => u.kind === "human" && (u.aware || u.dead)),
    },
  };
  b.summary = lines;
  say(b, outcome === "extracted" ? "You made it out." : "Nobody made it out.", outcome === "extracted" ? "good" : "death");
  bump(b);
}

// Headless auto-player for raids: loot what is near, extract when Heat or wounds get bad.
function autoRaidTurn(state) {
  const b = state.combat;
  const R = b.raid;
  const party = state.parties.find((x) => x.id === b.setup.partyId);
  for (const u of b.units.filter((x) => x.side === "player")) {
    for (let step = 0; step < 3 && active(u) && u.ap > 0 && !b.over; step++) {
      const full = party && partyCapacity(state, party) - cargoLoad(party.cargo) < 3;
      const leave = R.heat >= 55 || u.hp < 45 || full || !R.containers.some((c) => !c.searched);
      const z = zoneAt(b, u.x, u.y);
      if (leave && z >= 0 && (R.vehicleZone < 0 || z === R.vehicleZone || R.heat > 80)) { combatAct(state, { type: "extract", unit: u.id }); break; }
      // Fight only what is close; otherwise keep moving (shooting raises Heat).
      const foes = foesOf(b, u).filter((f) => f.aware && canSee(b, u, f) && dist(u.x, u.y, f.x, f.y) <= (leave ? 1.5 : 4));
      const adj = foes.find((f) => adjacent(u, f));
      if (adj && !isRanged(u)) { combatAct(state, { type: "melee", unit: u.id, target: adj.id }); break; }
      const shot = foes.length ? bestShot(b, u, foes) : null;
      if (shot && shot.o.chance >= 45) { combatAct(state, { type: "shoot", unit: u.id, target: shot.t.id }); break; }
      const fallen = medsLeft(b) > 0 ? b.units.find((o) => o.side === "player" && o.down && !o.stab && !o.dead && !o.left && adjacent(u, o)) : null;
      if (fallen) { combatAct(state, { type: "meds", unit: u.id, target: fallen.id }); continue; }
      if (u.hp < 50 && medsLeft(b) > 0 && u.ap > 0) { combatAct(state, { type: "meds", unit: u.id, target: u.id }); continue; }
      if (!leave && searchableNear(b, u).length) { combatAct(state, { type: "search", unit: u.id }); continue; }
      let targets;
      if (leave) {
        const zs = R.vehicleZone >= 0 && R.heat <= 80 ? [R.zones[R.vehicleZone]] : R.zones;
        targets = [];
        for (const zz of zs) for (let y = zz.y0; y < zz.y0 + zz.h; y++) for (let x = zz.x0; x < zz.x0 + zz.w; x++) if (cellAt(b, x, y).walk) targets.push([x, y]);
      } else {
        targets = [];
        for (const c of R.containers) if (!c.searched) for (const [dx, dy] of DIRS8) if (inside(c.x + dx, c.y + dy) && cellAt(b, c.x + dx, c.y + dy).walk) targets.push([c.x + dx, c.y + dy]);
      }
      if (!targets.length) { u.ap = 0; break; }
      const field = distField(b, targets);
      const r = reachable(b, u, u.mob * u.ap);
      let best = null;
      for (let i = 0; i < W * H; i++) if (isFinite(r.dist[i]) && r.dist[i] > 0 && (!best || field[i] < field[best])) best = i;
      if (best == null || field[best] >= field[idx(u.x, u.y)]) { u.ap = 0; break; }
      const err = combatAct(state, { type: "move", unit: u.id, x: best % W, y: (best / W) | 0 });
      if (err) { u.ap = 0; break; }
    }
  }
  bump(b);
  if (!b.over && b.phase === "player") endPlayerTurn(state);
}

export { survivorById, alive, log };
