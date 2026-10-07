// Hunting, snares and fishing: food from the land itself (team orders on a tile, the hunting cabin at a base, and
// fishing at a base by the water). Everything here is fresh game: it is food, but it weighs twice as much as packed
// food on the way home (a carcass is bones and hide too) and it spoils fast until it is eaten, dried or smoked.
//
// The land (per tile; state.game for game, state.fish for fish, created on the first hunt):
//   abundance = terrain (forest 1, hills 0.8, farmland 0.55, mountains 0.5, suburbs 0.12, city 0.03)
//               × 1.1 by a river or lake (game comes to drink) × 0.8 on a site (people lived there)
//               × (1 − 0.6 × infection) × hive land 0.15 (its red ring 0.05) × 0.3 on one of your bases and × 0.6
//               next to one (people, noise and smoke)
//   level     = 1 untouched; every ration taken lowers it (a deer, 30 rations: −0.3; a rabbit −0.03; fish 1/50 a
//               ration), and it grows back toward 1 with a half-life of 20 days (fish 10): weeks, not days.
//   Words on the tile panel: plenty (abundance × level ≥ 0.6), some (≥ 0.3), scarce (≥ 0.08), none.
//
// Hunt (team order, N hours on a land tile): each hour rolls for big game and small game.
//   big:   6.5% × abundance × level × season × time of day × weather × team(big)   (a deer 30 rations, a wild hog 16;
//          hills and mountains only deer)
//   small: 32% × the same × team(small), a second one at a third of that   (rabbits, birds: 2 rations each)
//   season: spring 0.8, summer 0.9, autumn 1.25 (fat and moving), winter 0.95 (× 1.2 with snow on the ground: tracks)
//   time of day: dawn and dusk (05–07, 17–19) × 1.3, day × 1, night (20–04) × 0.35; a storm or blizzard × 0.5
//   team: the best three hunters count 1, ½ and ¼ (+0.08 a hand without a weapon, up to two, driving game):
//     a hunter = their best hunting weapon (big / small game: hunting rifle 1 / 0.8, bows and crossbows 0.6 + 0.08 ×
//     power for big game (scrap crossbow 0.8, compound bow 0.86, hunting crossbow 0.9) / 0.9,
//     shotgun 0.45 / 1.2, automatic 0.7 / 0.6, pistol 0.3 / 0.6; melee: none) × the weapon's skill gap ×
//     skill (0.55 + 0.09 × (0.5 Shooting + 0.35 Scouting + 0.15 Stealth)) × 1.25 with the Hunter perk.
//     Firearms need ammo carried (1 a shot); bows and crossbows are silent and need none. Nobody with a hunting
//     weapon: no hunt (set snares instead).
//   Gunshots: each kill with a firearm is 1 shot, a second one (a miss first) 40% of the time for big game and 20% for
//     small: 1 ammo and +6 Heat each (× the gun's noise / 3) on top of the hour's Heat, and each wandering horde
//     within 3 tiles turns toward the shots 25% of the time. Bows add nothing. (A rifle hunt in good country fires
//     5–8 shots in 8 hours: Heat ~40–50 from the shots alone.)
//   What does not fit in the cargo stays where it fell (the team takes what it can carry; the estimates follow the
//   chances of each load hour by hour, so they count what is really kept).
//   Expect: two decent hunters with a rifle and a pistol, 8 hours in autumn forest, ~20 food (a deer about every
//   other hunt, a few rabbits); summer about three quarters of that, farmland about half; a town almost nothing.
//
// Snares (team order): lay a line of 8 snares (2h) with snare wire (the coil stays with the line and comes back
//   when it is lifted) or 2 scrap (fence wire). Checking a line (1h) collects the catch and leaves it set; lifting
//   it (1h) also takes it up. Each day a line catches 1 small game (2 rations) × abundance × level × season, caught
//   game keeps 3 days (2 in the heat, 6 in the cold), and from the third day without a check each day has an 8%
//   chance (more by towns, in hive land, with a horde near) that it is robbed or sprung: the catch is gone, and
//   30% of the time the line with it. Quiet: Heat × 0.8 while setting or checking.
// Fish (team order, N hours on a river bank or a lake shore, with a fishing rod or a net carried): 0.6 rations an
//   hour a rod, 1.2 a net worked by two (0.7 by one) × water (a deep river bend or a lake 1, a river 0.85, a pond 0.6)
//   × season
//   (spring 1.15, summer 1, autumn 0.9, winter 0.75) × time of day (dawn/dusk 1.4, night 0.5) × skill
//   (0.6 + 0.08 × (0.6 Scouting + 0.4 Stealth)) × the water's level. Frozen water: ice fishing needs a tool to cut
//   the ice (crowbar, machete, hatchet or axe) and catches half. Quiet: Heat × 0.7.
//
// Fresh game (cargo.meat, base.meat: the share of the food that is fresh game):
//   Carried it weighs MEAT_KG (1 kg) a ration instead of 0.5 (load.js bands: a deer on foot is a heavy walk; a car
//   carries it all). A team eats its fresh game first. In the field it spoils 35% a day above 24 °C, 22% above
//   12 °C, 12% above 4 °C, 6% around freezing and 2% below.
//   At a base it is eaten first and the drying racks take it first; on top of the stores' own rate it loses 5% a
//   day (10% in the heat, 2% below 5 °C, 0.3% below 0 °C), less with a cold store (× 0.4) or a hunting cabin
//   (× 0.6). A hunting cabin smokes up to 6 a day into 5 preserved food.
//
// Hunting cabin (buildings.js "huntcabin", any base with game land within 2 tiles: abundance there adding up to 3):
//   the people on the Hunt work type / role (no fixed cap: as many as the food the land must bring in wants,
//   CABIN above) hunt the land within 2 tiles 3 hours a day (dawn and dusk) with
//   their own weapons and the base's ammo (never its last 3 a head + 10: those are for the walls), the same rolls and
//   depletion as a team; a hunter without a weapon tends
//   snares there (two lines' worth). Fish work / role: a base on a river or a lake shore, one rod or net a fisher
//   (carried or in the armory), 3 hours a day. Expect a good hunter at a cabin in forest to bring in about 4–6 food a
//   day once the land settles (a farmer about 2), less in spring and on farmland.
import { GEAR, SUPPLIES } from "./data.js";
import { log, skill, gearEffect, atBase, newId } from "./world.js";
import { partyMembers, partyTile, tileLabel, teamName, cargoRoom, carried, takeSupply } from "./parties.js";
import { allItems, packOf } from "./inventory.js";
import { hasPerk, gainXp } from "./skills.js";
import { zombieToughness } from "./hives.js";
import * as Weather from "./weather.js";
import { count } from "./buildings.js";
import { workFactor } from "./health.js";
import { foragingDaily, landFoodHands } from "./foraging.js";
import { wormKill, wormMeatIn, wormMeatAt, smokeWormMeat, shrinkWormMeat, huntYieldMult, WORM } from "./worm.js";

// ---------- numbers ----------
export const HUNT = {
  big: 0.065, small: 0.32, bigDeplete: 100, smallDeplete: 60, halfLife: 20,
  shotHeat: 6, missChance: 0.4, missSmall: 0.2, drawChance: 0.25, drawRange: 3,
  minHours: 2, maxHours: 24, defHours: 8,
};
export const ANIMALS = {
  deer:  { name: "deer", plural: "deer", rations: 30, big: true },
  hog:   { name: "wild hog", plural: "wild hogs", rations: 16, big: true },
  small: { name: "small game", plural: "small game", rations: 2, big: false },
  fish:  { name: "fish", plural: "fish", rations: 1, big: false },
};
export const SNARE = { count: 8, perDay: 1, setHours: 2, checkHours: 1, scrap: 2, theft: 0.08, wireLoss: 0.3, deplete: 60, safeDays: 2 };
export const FISH = { rod: 0.6, net: 1.2, netAlone: 0.7, deplete: 50, halfLife: 10, ice: 0.5 };
// The cabin's Hunt job has no head-count cap (tune-jobcaps: it was 2): hunters are sized to the food the land must
// bring in (foraging.js landFoodHands), each takes the best tile left and a kill thins it hard (a deer −0.3), so a
// crowd soon hunts poor ground. Fishers likewise (one rod or net each: the tools are the cap); the base's one spot
// gives each fisher past the first fishCrowd less (fishers' bank space and spooked fish; at least fishCrowdFloor).
export const CABIN = { radius: 2, hours: 3, smoke: 6, smokeOut: 5, land: 3, spoil: 0.6, snareLines: 2, fishCrowd: 0.1, fishCrowdFloor: 0.4 };
export const MEAT_KG = 1;                                    // a ration of fresh game as carried
export const MEAT_EXTRA = MEAT_KG - SUPPLIES.food.weight;    // what it adds over packed food
export const GAME_TERRAIN = { forest: 1, hills: 0.8, mountain: 0.5, plains: 0.55, suburb: 0.12, city: 0.03, water: 0 };
// Hunting weapons by trade category (data.js GEAR cat); a GEAR entry's own `hunt: { big, small }` overrides it.
export const HUNT_CAT = {
  rifle: { big: 1, small: 0.8 }, bow: { big: 0.85, small: 0.9 }, crossbow: { big: 0.85, small: 0.9 },
  shotgun: { big: 0.45, small: 1.2 }, automatic: { big: 0.7, small: 0.6 }, smg: { big: 0.5, small: 0.6 }, pistol: { big: 0.3, small: 0.6 },
};
const ICE_TOOL = /^(crowbar|machete|sawmachete|hatchet|axe|fireaxe|iceauger|woodaxe)$/;
const r1 = (x) => Math.round(x * 10) / 10;
const first = (s) => s.name.split(" ")[0];

// ---------- the land ----------
export function gameAbundance(state, tile) {
  const t = state.tiles[tile];
  if (!t || t.terrain === "water") return 0;
  let a = GAME_TERRAIN[t.terrain] ?? 0.3;
  if (t.river || state.grid.neighbors(tile).some((n) => state.tiles[n] && state.tiles[n].terrain === "water")) a *= 1.1;
  if (t.loc) a *= 0.8;
  a *= 1 - 0.6 * Math.max(0, Math.min(1, t.infection || 0));
  const tough = state.hives ? zombieToughness(state, tile) : 0;
  if (tough) a *= tough >= 3 ? 0.05 : 0.15;
  if (state.bases.some((b) => b.tile === tile)) a *= 0.3;
  else if (state.bases.some((b) => state.grid.distance(b.tile, tile) <= 1)) a *= 0.6; // people, noise and smoke next door
  return a;
}
const levelIn = (store, key, hour, half) => {
  const r = store && store[key];
  if (!r) return 1;
  const days = Math.max(0, hour - r[1]) / 24;
  return 1 - (1 - r[0]) * Math.pow(0.5, days / half);
};
export const gameLevel = (state, tile, hour = state.hour) => levelIn(state.game, tile, hour, HUNT.halfLife);
export const fishLevel = (state, tile, hour = state.hour) => levelIn(state.fish, tile, hour, FISH.halfLife);
function lower(state, key, tile, amount) {
  const store = state[key] || (state[key] = {});
  const now = key === "fish" ? fishLevel(state, tile) : gameLevel(state, tile);
  store[tile] = [Math.max(0, Math.round((now - amount) * 1e4) / 1e4), state.hour];
}
export const takeGame = (state, tile, rations, per) => lower(state, "game", tile, rations / per);
export const gameWord = (v) => (v >= 0.6 ? "plenty" : v >= 0.3 ? "some" : v >= 0.08 ? "scarce" : "none");

// ---------- seasons, hours, weather ----------
export function seasonGame(state, hour = state.hour) {
  const k = Weather.season(state, hour).key;
  const m = { spring: 0.8, summer: 0.9, autumn: 1.25, winter: 0.95 }[k] ?? 1;
  return m * ((Weather.weather(state, hour).snowCover || 0) >= 0.3 ? 1.2 : 1);
}
export const seasonFish = (state, hour = state.hour) => ({ spring: 1.15, summer: 1, autumn: 0.9, winter: 0.75 }[Weather.season(state, hour).key] ?? 1);
export function timeOfDay(hour, kind = "hunt") {
  const h = ((hour % 24) + 24) % 24;
  if ((h >= 5 && h <= 7) || (h >= 17 && h <= 19)) return kind === "fish" ? 1.4 : 1.3;
  if (h >= 20 || h <= 4) return kind === "fish" ? 0.5 : 0.35;
  return 1;
}
const weatherMult = (state, hour, tile) => (Weather.weather(state, hour, tile).severe ? 0.5 : 1); // a storm over that tile (weather.js)
export const frozenAt = (state, hour = state.hour) => !!Weather.weather(state, hour).frozen;

// ---------- people and gear ----------
// Everything a person has on them: worn and held, pockets, and what is in the pack.
export function carriedItems(s) {
  const pk = packOf(s);
  return [...allItems(s), ...((pk && pk.contents) || []).filter(Boolean)];
}
export function huntWeaponInfo(item) {
  const d = item && GEAR[item.key];
  if (!d || d.slot !== "weapon") return null;
  let h = d.hunt || HUNT_CAT[d.cat];
  if (!h) return null;
  // Bows by their draw: a scrap crossbow 0.8 for deer, a compound bow 0.86, a hunting crossbow 0.9.
  if (!d.hunt && d.cat === "bow") h = { big: Math.min(0.95, 0.6 + 0.08 * (d.power || 2.5)), small: 0.9 };
  const noise = d.noise || 0;
  return { key: item.key, name: d.name, big: h.big, small: h.small, loud: noise >= 1, noise, ammo: noise >= 1 };
}
export const hunterSkill = (s) => 0.5 * skill(s, "shooting") + 0.35 * skill(s, "scouting") + 0.15 * skill(s, "stealth");
export const hunterMult = (s) => (0.55 + 0.09 * hunterSkill(s)) * (hasPerk(s, "hunter") ? 1.25 : 1);
// A person's best hunting weapon (null: none they can use; firearms only with ammo to hand).
export function bestHuntWeapon(s, ammo = Infinity) {
  let best = null;
  for (const it of carriedItems(s)) {
    const w = huntWeaponInfo(it);
    if (!w || (w.ammo && ammo < 1)) continue;
    const eff = gearEffect(s, it);
    if (!eff.usable) continue;
    const v = (w.big + 0.3 * w.small) * eff.mult;
    if (!best || v > best.v) best = { item: it, w, eff: eff.mult, v };
  }
  return best;
}
// The people who can hunt, best first: { s, w, item, big, small } (power for big and small game).
export function huntersOf(members, ammo = Infinity) {
  const out = [];
  for (const s of members) {
    const b = bestHuntWeapon(s, ammo);
    if (!b) continue;
    const m = hunterMult(s) * b.eff;
    out.push({ s, w: b.w, item: b.item, big: m * b.w.big, small: m * b.w.small });
  }
  return out.sort((a, b) => b.big + 0.3 * b.small - (a.big + 0.3 * a.small) || a.s.id - b.s.id);
}
const W3 = [1, 0.5, 0.25];
export function teamPower(hs, others = 0) {
  if (!hs.length) return { big: 0, small: 0, n: 0 };
  let big = 0, small = 0;
  hs.slice(0, 3).forEach((h, i) => { big += W3[i] * h.big; small += W3[i] * h.small; });
  const beat = 0.08 * Math.min(2, Math.max(0, others));
  return { big: big + beat, small, n: hs.length };
}

// ---------- hunting odds ----------
// Chances this hour on this tile at this level (no randomness): big and small game, and the mix of big game.
export function huntOdds(state, team, tile, hour, level = gameLevel(state, tile, hour)) {
  const base = gameAbundance(state, tile) * level * seasonGame(state, hour) * timeOfDay(hour) * weatherMult(state, hour, tile);
  const t = state.tiles[tile];
  const deer = t && (t.terrain === "hills" || t.terrain === "mountain") ? 1 : 0.7;
  return { big: Math.min(0.6, HUNT.big * base * team.big), small: Math.min(0.9, HUNT.small * base * team.small), deer, base };
}
const bigAvg = (deer) => deer * ANIMALS.deer.rations + (1 - deer) * ANIMALS.hog.rations;

// Expected haul of a hunt (no randomness): rations, kills, shots, with the land depleting as it goes.
// team: teamPower; loud: share of kills by firearms; room: kg the team can still carry (what does not fit is left:
// rations are capped by it, all = what was bagged).
export function expectHunt(state, team, tile, hours, startHour = state.hour, loud = 0, room = Infinity) {
  let level = gameLevel(state, tile, startHour), rations = 0, big = 0, small = 0;
  // With a limit on what fits, the haul is lumpy (a deer is 30): the chances of each load carried are followed hour by
  // hour (what does not fit is left), so the expectation is that of what is really kept.
  const R = Number.isFinite(room) ? Math.max(0, Math.floor(room / MEAT_KG + 1e-9)) : null;
  let dist = R != null ? Object.assign(new Array(R + 1).fill(0), { 0: 1 }) : null;
  for (let h = 1; h <= hours; h++) {
    const o = huntOdds(state, team, tile, startHour + h, level);
    const nb = o.big, ns = o.small * (1 + o.small / 3);
    const r = nb * bigAvg(o.deer) + ns * ANIMALS.small.rations;
    rations += r; big += nb; small += ns;
    if (dist && R > 0) {
      const next = new Array(R + 1).fill(0);
      const bigs = [[0, 1 - o.big], [ANIMALS.deer.rations, o.big * o.deer], [ANIMALS.hog.rations, o.big * (1 - o.deer)]];
      const smalls = [[0, 1 - o.small], [ANIMALS.small.rations, o.small * (1 - o.small / 3)], [2 * ANIMALS.small.rations, o.small * (o.small / 3)]];
      for (let k = 0; k <= R; k++) {
        if (!dist[k]) continue;
        for (const [b, pb] of bigs) for (const [sm, ps] of smalls) if (pb * ps > 0) next[Math.min(R, k + b + sm)] += dist[k] * pb * ps;
      }
      dist = next;
    }
    level = Math.max(0, level - (nb * bigAvg(o.deer)) / HUNT.bigDeplete - (ns * ANIMALS.small.rations) / HUNT.smallDeplete);
  }
  const shots = (big * (1 + HUNT.missChance) + small * (1 + HUNT.missSmall)) * loud;
  // Infested animals (worm.js) give a quarter of the meat: the estimate counts the share of them here.
  const ym = huntYieldMult(state, tile);
  const kept = (R == null ? rations : R === 0 ? 0 : dist.reduce((a, q, k) => a + q * k, 0)) * ym;
  return { rations: r1(kept), all: r1(rations * ym), big: r1(big), small: r1(small), shots: r1(shots), levelAfter: level, perHour: hours ? kept / hours : 0 };
}
// For a team (or a crew about to go): its hunters, power, how loud it is and why it cannot hunt.
export function huntTeam(state, members, ammo) {
  const hs = huntersOf(members, ammo);
  const team = teamPower(hs, members.length - hs.length);
  const tot = hs.slice(0, 3).reduce((a, h, i) => a + W3[i] * (h.big + h.small), 0) || 1;
  const loud = hs.slice(0, 3).reduce((a, h, i) => a + (h.w.loud ? W3[i] * (h.big + h.small) : 0), 0) / tot;
  return { hs, team, loud, why: hs.length ? "" : "nobody carries a hunting weapon (a rifle, bow, crossbow, shotgun or pistol; firearms need ammo). Set snares instead." };
}
// The tile panel's line: what the land holds and what a hunt would bring (a party, or a planner crew).
export function huntInfo(state, tile, { members = null, ammo = Infinity, hours = HUNT.defHours, startHour = state.hour, room = Infinity } = {}) {
  const abundance = gameAbundance(state, tile);
  const level = gameLevel(state, tile);
  const word = gameWord(abundance * level);
  const out = { abundance, level, word, fishSpot: fishSpot(state, tile), fishLevel: fishLevel(state, tile) };
  if (members) {
    const t = huntTeam(state, members, ammo);
    out.why = t.why;
    out.est = t.why ? null : expectHunt(state, t.team, tile, hours, startHour, t.loud, room);
    out.loud = t.loud;
    out.hunters = t.hs.length;
  }
  return out;
}

// Why a team cannot hunt here ("" = it can).
export function huntProblem(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  if (!t || t.terrain === "water") return "not on open water.";
  const h = huntTeam(state, partyMembers(state, p), carried(p, "ammo"));
  if (h.why) return h.why;
  if (gameAbundance(state, tile) < 0.02) return "there is no game here (a city, or the dead own this land).";
  return "";
}

// ---------- fresh game in the cargo ----------
export const meatIn = (cargo) => (cargo ? Math.max(0, Math.min(cargo.meat || 0, cargo.supplies && cargo.supplies.food > 0 ? cargo.supplies.food : 0)) : 0);
export const meatAt = (base) => Math.max(0, Math.min(base.meat || 0, base.stock.food || 0));
// Puts fresh game in a team's cargo, as much as fits. worm: how much of it carries the worm's eggs (worm.js
// cargo.wormMeat). Returns the rations kept.
export function addMeat(state, p, rations, worm = 0) {
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  const fit = Math.floor((cargoRoom(state, p) + 1e-9) / MEAT_KG);
  const kept = Math.max(0, Math.min(rations, fit));
  if (kept <= 0) return 0;
  const m = meatIn(p.cargo), w = wormMeatIn(p.cargo);
  p.cargo.supplies.food = (p.cargo.supplies.food || 0) + kept;
  p.cargo.meat = m + kept;
  if (worm > 0 || w > 0) p.cargo.wormMeat = w + kept * Math.min(1, Math.max(0, worm) / rations);
  return kept;
}
// Takes `qty` of fresh game out of a cargo (spoiled, dropped: the meat with eggs goes in proportion). clean: eaten,
// only the meat without eggs (worm.js: that is eaten last, raw). Returns what was taken.
export function takeMeat(cargo, qty, { clean = false } = {}) {
  const m = meatIn(cargo), w = wormMeatIn(cargo);
  const q = Math.max(0, Math.min(clean ? m - w : m, qty));
  if (q <= 0) { if (cargo) cargo.meat = m; return 0; }
  cargo.supplies.food -= q;
  cargo.meat = m - q;
  if (!clean && w > 0) cargo.wormMeat = (w * (m - q)) / m;
  return q;
}
export function fieldSpoilRate(temp) {
  return temp > 24 ? 0.35 : temp > 12 ? 0.22 : temp > 4 ? 0.12 : temp > -1 ? 0.06 : 0.02;
}
// Hourly for a team (parties.js): its fresh game spoils by the temperature.
export function gameSpoilHour(state, p) {
  const m = meatIn(p.cargo);
  if (!(m > 0)) { if (p.cargo && p.cargo.meat) p.cargo.meat = 0; return 0; }
  const lost = takeMeat(p.cargo, (m * fieldSpoilRate(Weather.weather(state).temp)) / 24);
  p.gameSpoiled = (p.gameSpoiled || 0) + lost;
  return lost;
}
// A team unloading at a base (parties.js): its fresh game is fresh game there too.
export function unloadGame(base, cargo) {
  const m = meatIn(cargo), w = wormMeatIn(cargo);
  if (cargo) { cargo.meat = 0; cargo.wormMeat = 0; }
  if (w > 0) base.wormMeat = wormMeatAt(base) + w; // before the meat: wormMeatAt is capped by it
  if (m > 0) base.meat = meatAt(base) + m;
}

// ---------- one hour of hunting (orders.js taskHour) ----------
// Wandering hordes within reach turn toward gunshots.
function drawHordes(state, tile) {
  let n = 0;
  for (const h of state.hordes) {
    if (!["roam", "border", undefined, null].includes(h.role)) continue;
    if (state.grid.distance(h.tile, tile) > HUNT.drawRange || h.tile === tile) continue;
    if (state.rng.chance(HUNT.drawChance)) { h.target = tile; h.path = null; n++; }
  }
  return n;
}
function bagged(got, key) { got[key] = (got[key] || 0) + 1; }
export function huntHour(state, p) {
  const t = p.task;
  const tile = partyTile(p);
  const got = t.got || (t.got = { rations: 0, left: 0, shots: 0, drawn: 0 });
  const members = partyMembers(state, p);
  const h = huntTeam(state, members, carried(p, "ammo"));
  if (h.why) { got.stopped = h.why; return false; }
  const o = huntOdds(state, h.team, tile, state.hour);
  const kills = [];
  if (state.rng.chance(o.big)) kills.push(state.rng.chance(o.deer) ? "deer" : "hog");
  if (state.rng.chance(o.small)) { kills.push("small"); if (state.rng.chance(o.small / 3)) kills.push("small"); }
  for (const k of kills) {
    const a = ANIMALS[k];
    const who = state.rng.weighted(h.hs.slice(0, 3), (x) => (a.big ? x.big : x.small) + 1e-6);
    if (who.w.ammo) {
      const shots = 1 + (state.rng.chance(a.big ? HUNT.missChance : HUNT.missSmall) ? 1 : 0);
      const used = takeSupply(p, "ammo", shots);
      got.shots += Math.max(1, used);
      p.heat = Math.min(100, (p.heat || 0) + HUNT.shotHeat * (who.w.noise / 3) * Math.max(1, used));
      got.drawn += drawHordes(state, tile);
    }
    const wk = wormKill(state, tile, a.rations); // worm.js: an infested animal yields a quarter, all of it with eggs
    const kept = addMeat(state, p, wk.rations, wk.worm);
    bagged(got, k);
    if (wk.infested) got.infested = (got.infested || 0) + 1;
    got.rations += kept;
    got.left += wk.rations - kept;
    takeGame(state, tile, a.rations, a.big ? HUNT.bigDeplete : HUNT.smallDeplete);
    gainXp(state, who.s, "shooting", a.big ? 6 : 2);
  }
  for (const m of members) gainXp(state, m, "scouting", 0.5);
  return true;
}
// What the worm left in a haul (worm.js): infested animals, or game from infected land that needs cooking through.
function wormNote(state, tile, infested = 0) {
  if (infested) return ` ${infested === 1 ? "One was" : `${infested} were`} infested, grey and thin under the hide: a quarter of the meat, and it carries the worm's eggs. Cook it through before anyone eats it.`;
  if (((state.tiles[tile] || {}).infection || 0) >= WORM.MEAT_AT) return " The land here is infected: cook the meat through before anyone eats it.";
  return "";
}
const countText = (got, keys = ["deer", "hog", "small", "fish"]) => keys.filter((k) => got[k]).map((k) => `${got[k] === 1 && k !== "small" && k !== "fish" ? `a ${ANIMALS[k].name}` : `${got[k]} ${ANIMALS[k].plural}`}`).join(", ");
export function huntSummary(state, p, t) {
  const got = t.got || { rations: 0 };
  const what = countText(got);
  const heat = got.shots ? ` ${got.shots} shot${got.shots === 1 ? "" : "s"} fired (Heat ${Math.round(p.heat || 0)})${got.drawn ? `: the dead nearby heard it` : ""}.` : got.rations ? " Not a shot fired." : "";
  const left = got.left >= 1 ? ` No room to carry ${Math.floor(got.left)} more: left where it fell.` : "";
  const stop = got.stopped ? ` Stopped: ${got.stopped}` : "";
  const level = gameWord(gameAbundance(state, partyTile(p)) * gameLevel(state, partyTile(p)));
  p.lastHaul = { kind: "hunt", rations: got.rations, hour: state.hour }; // for the trip report (and tests)
  const worm = wormNote(state, partyTile(p), got.infested);
  const text = got.rations > 0
    ? `Hunted ${t.done}h: ${what} (${Math.floor(got.rations)} food of fresh game, it spoils fast: eat it, or dry or smoke it at home).${worm}${heat}${left} Game left here: ${level}.${stop}`
    : `Hunted ${t.done}h and found nothing worth a shot.${heat} Game left here: ${level}.${stop}`;
  if (got.rations > 0) log(state, `${teamName(state, p)} hunted near ${tileLabel(state, partyTile(p))}: ${what}, ${Math.floor(got.rations)} food of game.`, "good");
  return text;
}

// ---------- fishing ----------
// Where a team can fish: a land tile on the water. Rivers are water tiles (mapgen.js); a bridge is fished like the
// river under it. Kinds: a lake shore (open water that is not a river, 6+ water tiles within 2) and a deep river bend
// (rivers meeting or winding: 6+ water tiles within 2) × 1, a river × 0.85, a small lake or pond × 0.6.
export function fishSpot(state, tile) {
  const t = state.tiles[tile];
  if (!t || (t.terrain === "water" && !t.bridge)) return null;
  const wet = state.grid.neighbors(tile).map((n) => state.tiles[n]).filter((x) => x && x.terrain === "water");
  if (t.bridge) wet.push(t);
  if (!wet.length) return null;
  const water = state.grid.within(tile, 2).filter((id) => state.tiles[id].terrain === "water").length;
  const river = wet.some((x) => x.river);
  if (river) return water >= 6 ? { kind: "bend", mult: 1, name: "a deep river bend" } : { kind: "river", mult: 0.85, name: "a river" };
  return water >= 6 ? { kind: "lake", mult: 1, name: "a lake shore" } : { kind: "pond", mult: 0.6, name: "a pond" };
}
const isRod = (it) => it && (it.key === "fishrod" || (GEAR[it.key] && GEAR[it.key].fish === "rod"));
const isNet = (it) => it && (it.key === "fishnet" || (GEAR[it.key] && GEAR[it.key].fish === "net"));
const isIceTool = (it) => it && (ICE_TOOL.test(it.key) || !!(GEAR[it.key] && GEAR[it.key].iceTool));
export const fisherMult = (s) => (0.6 + 0.08 * (0.6 * skill(s, "scouting") + 0.4 * skill(s, "stealth"))) * (hasPerk(s, "forager") ? 1.1 : 1);
// What a team (members and cargo items) has for fishing: rods, nets, an ice tool, and its rigs' power.
export function fishKit(members, extraItems = []) {
  const items = [...members.flatMap((s) => carriedItems(s)), ...extraItems];
  const rods = items.filter(isRod).length, nets = items.filter(isNet).length, ice = items.some(isIceTool);
  const best = [...members].sort((a, b) => fisherMult(b) - fisherMult(a) || a.id - b.id);
  let people = members.length, power = 0, used = 0;
  for (let i = 0; i < nets && people > 0; i++) { const two = people >= 2; power += two ? FISH.net : FISH.netAlone; people -= two ? 2 : 1; used += two ? 2 : 1; }
  for (let i = 0; i < rods && people > 0; i++) { power += FISH.rod; people--; used++; }
  const sk = used ? best.slice(0, used).reduce((a, s) => a + fisherMult(s), 0) / used : 0;
  return { rods, nets, ice, power: power * sk, used };
}
export function fishRate(state, kit, tile, hour, level = fishLevel(state, tile, hour)) {
  const spot = fishSpot(state, tile);
  if (!spot || !kit.power) return 0;
  const ice = frozenAt(state, hour) ? (kit.ice ? FISH.ice : 0) : 1;
  return kit.power * spot.mult * seasonFish(state, hour) * timeOfDay(hour, "fish") * weatherMult(state, hour, tile) * ice * level;
}
export function expectFish(state, kit, tile, hours, startHour = state.hour, room = Infinity) {
  let level = fishLevel(state, tile, startHour), rations = 0;
  for (let h = 1; h <= hours; h++) {
    const r = Math.min(3, fishRate(state, kit, tile, startHour + h, level));
    rations += r;
    level = Math.max(0, level - r / FISH.deplete);
  }
  const kept = Math.min(rations, Math.max(0, room) / MEAT_KG);
  return { rations: r1(kept), all: r1(rations), perHour: hours ? kept / hours : 0 };
}
export function fishProblem(state, p, tile = partyTile(p)) {
  const spot = fishSpot(state, tile);
  if (!spot) return "only on a river or a lake shore.";
  const kit = fishKit(partyMembers(state, p), (p.cargo && p.cargo.gear) || []);
  if (!kit.rods && !kit.nets) return "needs a fishing rod or a net (found at cabins, campgrounds, lodges and hardware stores).";
  if (frozenAt(state) && !kit.ice) return "the water is frozen: cutting a hole for ice fishing needs a crowbar, machete, hatchet or axe.";
  return "";
}
export function fishHour(state, p) {
  const t = p.task;
  const tile = partyTile(p);
  const got = t.got || (t.got = { rations: 0, left: 0, fish: 0 });
  const members = partyMembers(state, p);
  const kit = fishKit(members, (p.cargo && p.cargo.gear) || []);
  const rate = Math.min(3, fishRate(state, kit, tile, state.hour));
  if (!(rate > 0)) { if (!kit.power) got.stopped = "no fishing gear left."; return false; }
  let n = 0;
  for (let i = 0; i < 3; i++) if (state.rng.chance(rate / 3)) n++;
  if (n) {
    const kept = addMeat(state, p, n, wormKill(state, tile, n, { fish: true }).worm); // worm.js: fish from infected water carry eggs
    got.fish += n;
    got.rations += kept;
    got.left += n - kept;
    lower(state, "fish", tile, n / FISH.deplete);
  }
  for (const m of members.slice(0, Math.max(1, kit.used))) gainXp(state, m, "scouting", 0.6);
  return true;
}
export function fishSummary(state, p, t) {
  const got = t.got || { rations: 0, fish: 0 };
  const spot = fishSpot(state, partyTile(p));
  const ice = frozenAt(state) ? " through the ice" : "";
  const left = got.left >= 1 ? ` No room for ${Math.floor(got.left)} more.` : "";
  const word = gameWord(fishLevel(state, partyTile(p)));
  p.lastHaul = { kind: "fish", rations: got.rations, hour: state.hour };
  if (got.rations > 0) log(state, `${teamName(state, p)} fished ${spot ? spot.name : "the water"} near ${tileLabel(state, partyTile(p))}${ice}: ${Math.floor(got.rations)} food of fish.`, "good");
  return got.rations > 0
    ? `Fished ${t.done}h${ice}: ${Math.floor(got.rations)} food of fresh fish (it spoils fast).${wormNote(state, partyTile(p))}${left} Fish left here: ${word}.${got.stopped ? ` Stopped: ${got.stopped}` : ""}`
    : `Fished ${t.done}h${ice} and caught nothing worth keeping. Fish left here: ${word}.${got.stopped ? ` Stopped: ${got.stopped}` : ""}`;
}

// ---------- snares ----------
export const snareLine = (state, tile) => (state.snares || []).find((l) => l.tile === tile) || null;
const findWire = (members, cargo) => {
  for (const s of members) {
    const pk = packOf(s);
    const pi = s.pockets ? s.pockets.findIndex((it) => it && it.key === "snarewire") : -1;
    if (pi >= 0) return { take: () => { const it = s.pockets[pi]; s.pockets[pi] = null; return it; } };
    const ci = pk && pk.contents ? pk.contents.findIndex((it) => it && it.key === "snarewire") : -1;
    if (ci >= 0) return { take: () => { const it = pk.contents[ci]; pk.contents[ci] = null; return it; } };
  }
  const gi = cargo && cargo.gear ? cargo.gear.findIndex((it) => it && it.key === "snarewire") : -1;
  if (gi >= 0) return { take: () => cargo.gear.splice(gi, 1)[0] };
  return null;
};
export const snareMode = (state, tile, mode = null) => mode || (snareLine(state, tile) ? "check" : "set");
export const snareHours = (state, tile, mode = null) => (snareMode(state, tile, mode) === "set" ? SNARE.setHours : SNARE.checkHours);
export function snareProblem(state, p, tile = partyTile(p), mode = null) {
  const t = state.tiles[tile];
  if (!t || t.terrain === "water") return "not on open water.";
  const m = snareMode(state, tile, mode);
  if (m !== "set") return snareLine(state, tile) ? "" : "no snare line of yours here.";
  if (snareLine(state, tile)) return "a line is already set here: check it instead.";
  if (gameAbundance(state, tile) < 0.02) return "nothing to catch here.";
  if (!findWire(partyMembers(state, p), p.cargo) && carried(p, "scrap") < SNARE.scrap) return `needs snare wire or ${SNARE.scrap} scrap (fence wire).`;
  return "";
}
// How long caught game keeps in a snare (days), by the temperature.
const keepDays = (temp) => (temp > 22 ? 2 : temp < 3 ? 6 : 3);
const theftChance = (state, tile) => {
  const near = state.grid.within(tile, 2).map((id) => state.tiles[id]);
  const town = near.some((t) => t.terrain === "city" || t.terrain === "suburb") ? 0.08 : 0;
  const hive = state.hives && zombieToughness(state, tile) ? 0.1 : 0;
  const horde = state.hordes.some((h) => state.grid.distance(h.tile, tile) <= 3) ? 0.08 : 0;
  return SNARE.theft + town + hive + horde;
};
export const snareDayRate = (state, tile, hour, level = gameLevel(state, tile, hour)) => SNARE.perDay * gameAbundance(state, tile) * level * seasonGame(state, hour);
// Expected catch of a line from its last check until `hour` (no theft or rot: an upper guide).
export function expectSnare(state, tile, from, to) {
  let level = gameLevel(state, tile, from), n = 0;
  for (let d = 0; d < (to - from) / 24; d++) {
    const frac = Math.min(1, (to - from) / 24 - d);
    const c = snareDayRate(state, tile, from + d * 24, level) * frac;
    n += c;
    level = Math.max(0, level - (c * ANIMALS.small.rations) / SNARE.deplete);
  }
  return { animals: r1(n), rations: r1(n * ANIMALS.small.rations) };
}
// What a line holds now: rolled day by day since its last check (catches, rot, theft). Changes the line.
function rollSnares(state, line) {
  const start = line.check ?? line.set;
  const days = Math.max(0, (state.hour - start) / 24);
  let held = [], robbed = 0, rotted = 0, gone = false;
  for (let d = 0; d < Math.ceil(days - 1e-9); d++) {
    const frac = Math.min(1, days - d);
    const hour = start + d * 24;
    const per = Math.min(0.9, snareDayRate(state, line.tile, hour) / SNARE.count) * frac;
    let n = 0;
    for (let i = 0; i < SNARE.count; i++) if (state.rng.chance(per)) n++;
    for (let i = 0; i < n; i++) held.push(d);
    if (n) takeGame(state, line.tile, n * ANIMALS.small.rations, SNARE.deplete);
    const keep = keepDays(Weather.weather(state, hour + 12).temp);
    const fresh = held.filter((x) => d - x < keep);
    rotted += held.length - fresh.length;
    held = fresh;
    if (d >= SNARE.safeDays && state.rng.chance(theftChance(state, line.tile))) {
      robbed += held.length;
      held = [];
      if (state.rng.chance(SNARE.wireLoss)) { gone = true; break; }
    }
  }
  return { animals: held.length, robbed, rotted, gone, days };
}
// The snare order's work, when its hours are done (orders.js finishTask). mode: set, check or lift.
export function snareWork(state, p, mode) {
  const tile = partyTile(p);
  const members = partyMembers(state, p);
  const where = tileLabel(state, tile);
  if (mode === "set") {
    const why = snareProblem(state, p, tile, "set");
    if (why) return `Snares: ${why}`;
    const wire = findWire(members, p.cargo);
    const item = wire ? wire.take() : null;
    if (!item) takeSupply(p, "scrap", SNARE.scrap);
    state.snares = state.snares || [];
    state.snares.push({ id: newId(), tile, set: state.hour, check: null, wire: item || null, by: members.map((s) => s.id) });
    const e = expectSnare(state, tile, state.hour, state.hour + 72);
    log(state, `${teamName(state, p)} set a line of snares near ${where}.`, "info");
    return `Set a line of ${SNARE.count} snares near ${where} (${item ? "with the snare wire" : `${SNARE.scrap} scrap of fence wire`}). Expect about ${e.animals} small game in 3 days; check them within 2–3 days, before the catch rots or someone else takes it.`;
  }
  const line = snareLine(state, tile);
  if (!line) return "Snares: no line of yours here.";
  const r = rollSnares(state, line);
  line.check = state.hour;
  // Each animal may be infested (worm.js): a quarter of the meat, with the worm's eggs.
  let rations = 0, worm = 0, infested = 0;
  for (let i = 0; i < r.animals; i++) {
    const wk = wormKill(state, tile, ANIMALS.small.rations);
    rations += wk.rations;
    worm += wk.worm;
    if (wk.infested) infested++;
  }
  const kept = addMeat(state, p, rations, worm);
  for (const m of members) gainXp(state, m, "scouting", 1);
  let text = r.animals ? `The snares held ${r.animals} small game (${kept} food of fresh game${kept < rations ? `; no room for ${rations - kept}` : ""}).${wormNote(state, tile, infested)}` : "The snares were empty.";
  if (r.rotted) text += ` ${r.rotted} caught earlier had gone bad.`;
  if (r.robbed) text += ` Something got to the line first: ${r.robbed} taken.`;
  const lift = mode === "lift" || r.gone;
  if (lift) {
    state.snares.splice(state.snares.indexOf(line), 1);
    if (r.gone) text += " The line itself was torn up and the wire is gone.";
    else if (line.wire) {
      p.cargo = p.cargo || { supplies: {}, gear: [] };
      p.cargo.gear.push(line.wire);
      text += " Lifted the line: the snare wire is back in the cargo.";
    } else text += " Lifted the line.";
  } else text += " The line stays set.";
  if (r.animals || r.robbed) log(state, `${teamName(state, p)} checked the snares near ${where}: ${r.animals} small game${r.robbed ? `, ${r.robbed} stolen` : ""}.`, r.animals ? "good" : "info");
  return text;
}
// Lines nobody comes back for: after 30 days unchecked a line is gone (torn up, rusted, sprung for good).
export function snaresDaily(state) {
  if (!state.snares || !state.snares.length) return;
  state.snares = state.snares.filter((l) => state.hour - (l.check ?? l.set) < 30 * 24);
}

// ---------- the hunting cabin and the base's hunters and fishers ----------
export const gameLand = (state, base) => state.grid.within(base.tile, CABIN.radius).reduce((a, id) => a + gameAbundance(state, id), 0);
export function cabinProblem(state, base) {
  if (gameLand(state, base) < CABIN.land) return "too little game land around it (it needs forest, hills or farmland within 2 tiles).";
  return "";
}
const baseHasHunting = (base) => count(base, "huntcabin") > 0;
// Why nobody here can hunt / fish as work ("" = they can). Used by work.js.
export function huntWorkWhy(state, base) {
  if (!baseHasHunting(base)) return "no hunting cabin";
  return cabinProblem(state, base) ? "no game land around" : "";
}
export function fishTools(state, base, people = atBase(state, base.id)) {
  return fishKit(people, base.armory || []);
}
export function fishWorkWhy(state, base) {
  if (!fishSpot(state, base.tile)) return "not by a river or lake";
  const k = fishTools(state, base);
  if (!k.rods && !k.nets) return "no fishing rod or net here";
  return "";
}
// The Fish job's tools: one rod or net each (a net worked by two). No other cap (tune-jobcaps: it was at most 2).
export const fishWorkCap = (state, base) => { const k = fishTools(state, base); return k.rods + 2 * k.nets; };
// The share each of n fishers at the base's one spot counts (the k-th max(fishCrowdFloor, 1 − fishCrowd × k)).
export const fishCrowdShare = (n) => {
  if (n <= 1) return 1;
  let a = 0;
  for (let k = 0; k < n; k++) a += Math.max(CABIN.fishCrowdFloor, 1 - CABIN.fishCrowd * k);
  return a / n;
};
// Expected food a day for one hunter at this base now (an average one with a hunting rifle: the job's sizing), from
// the best tile around, CABIN.hours at dawn and dusk.
export function baseHuntDay(state, base, hour = state.hour) {
  const tile = cabinTiles(state, base)[0];
  if (tile == null) return 0;
  const m = 0.82, team = { big: m * HUNT_CAT.rifle.big, small: m * HUNT_CAT.rifle.small };
  const dayStart = hour - (hour % 24);
  let r = 0;
  for (const hh of DAWN_DUSK.slice(0, CABIN.hours)) { const o = huntOdds(state, team, tile, dayStart + hh); r += o.big * bigAvg(o.deer) + o.small * ANIMALS.small.rations; }
  return r;
}
// Expected food a day for one fisher with a rod at this base now (an average one: the job's sizing).
export function baseFishDay(state, base, hour = state.hour) {
  const kit = { rods: 1, nets: 0, ice: true, power: FISH.rod * 0.85, used: 1 };
  const dayStart = hour - (hour % 24);
  let r = 0;
  for (const hh of DAWN_DUSK.slice(0, CABIN.hours)) r += fishRate(state, kit, base.tile, dayStart + hh);
  return r;
}
// The Hunt job's room (no fixed cap): hunters to close the land food gap to goalDays (foraging.js landFoodHands).
export const huntWorkCap = (state, base, goalDays) => landFoodHands(state, base, goalDays, baseHuntDay(state, base));
// The Fish job's room: fishers to close it, at most one a rod (two a net).
export const fishWorkHands = (state, base, goalDays) => Math.min(fishWorkCap(state, base), landFoodHands(state, base, goalDays, baseFishDay(state, base)));
// The best hunting tiles around a base, by what they hold now.
function cabinTiles(state, base) {
  return state.grid.within(base.tile, CABIN.radius).filter((id) => gameAbundance(state, id) > 0.02)
    .sort((a, b) => gameAbundance(state, b) * gameLevel(state, b) - gameAbundance(state, a) * gameLevel(state, a) || a - b);
}
export const ammoKeep = (state, base) => atBase(state, base.id).length * 3 + 10; // ammo the cabin's hunters leave for the walls
const DAWN_DUSK = [6, 17, 7, 18, 5, 19]; // the hours a base's hunters and fishers are out (dawn and dusk first)
// Daily (economy.js baseDaily): the people on the Hunt and Fish roles bring in their day's catch, and the people on
// the Forage role their day's gathering (foraging.js).
export function huntingDaily(state, base) {
  foragingDaily(state, base);
  const people = atBase(state, base.id).filter((s) => !s.inBed && workFactor(s) >= 0.35);
  const hunters = people.filter((s) => s.role === "hunt");
  const fishers = people.filter((s) => s.role === "fish");
  const dayStart = state.hour - 24;
  const got = { rations: 0, shots: 0 };
  let noise = 0;
  if (hunters.length && !huntWorkWhy(state, base)) {
    for (const s of hunters) {
      const tiles = cabinTiles(state, base);
      const tile = tiles[0];
      if (tile == null) break;
      // The walls come first: the hunters leave the base's last ammo (3 a head + 10) and set snares instead.
      const spare = () => Math.max(0, (base.stock.ammo || 0) - ammoKeep(state, base));
      const b = bestHuntWeapon(s, spare());
      const hours = Math.round(CABIN.hours * Math.min(1, workFactor(s)));
      if (!b) {
        // No weapon: the cabin's snare lines (two lines, checked every day).
        const rate = snareDayRate(state, tile, dayStart + 12) * CABIN.snareLines * (hours / CABIN.hours);
        let n = 0;
        for (let i = 0; i < SNARE.count * CABIN.snareLines; i++) if (state.rng.chance(Math.min(0.9, rate / (SNARE.count * CABIN.snareLines)))) n++;
        if (n) {
          bagged(got, "small"); got.small += n - 1;
          for (let i = 0; i < n; i++) cabinKill(state, got, tile, ANIMALS.small.rations);
          takeGame(state, tile, n * ANIMALS.small.rations, SNARE.deplete);
        }
        gainXp(state, s, "scouting", 3);
        continue;
      }
      const m = hunterMult(s) * b.eff;
      const team = { big: m * b.w.big, small: m * b.w.small };
      for (const hh of DAWN_DUSK.slice(0, hours)) {
        const o = huntOdds(state, team, tile, dayStart + hh);
        const kills = [];
        if (state.rng.chance(o.big)) kills.push(state.rng.chance(o.deer) ? "deer" : "hog");
        if (state.rng.chance(o.small)) kills.push("small");
        for (const k of kills) {
          if (b.w.ammo) {
            const shots = 1 + (state.rng.chance(ANIMALS[k].big ? HUNT.missChance : HUNT.missSmall) ? 1 : 0);
            const used = Math.min(shots, Math.floor(spare()));
            base.stock.ammo = (base.stock.ammo || 0) - used;
            got.shots += used;
            noise += b.w.noise / 3;
          }
          bagged(got, k);
          cabinKill(state, got, tile, ANIMALS[k].rations);
          takeGame(state, tile, ANIMALS[k].rations, ANIMALS[k].big ? HUNT.bigDeplete : HUNT.smallDeplete);
          gainXp(state, s, "shooting", ANIMALS[k].big ? 6 : 2);
        }
      }
      gainXp(state, s, "scouting", 4);
    }
  }
  base.huntNoise = Math.round(noise * 10) / 10; // hordes.js baseHeat: gunshots around the base
  if (fishers.length && !fishWorkWhy(state, base)) {
    const k0 = fishTools(state, base, fishers);
    const kit = { ...k0, power: k0.power * fishCrowdShare(k0.used) }; // one spot: each fisher past the first a little less
    const hours = CABIN.hours;
    for (const hh of DAWN_DUSK.slice(0, hours)) {
      const rate = fishRate(state, kit, base.tile, dayStart + hh);
      const rolls = Math.max(3, Math.ceil(rate)); // three rolls an hour (more for a big crew, no fixed ceiling)
      let n = 0;
      for (let i = 0; i < rolls; i++) if (state.rng.chance(Math.min(1, rate / rolls))) n++;
      if (n) { got.fish = (got.fish || 0) + n; cabinKill(state, got, base.tile, n, true); lower(state, "fish", base.tile, n / FISH.deplete); }
    }
    for (const s of fishers) gainXp(state, s, "scouting", 3);
  }
  if (got.rations > 0) {
    if (got.worm > 0) base.wormMeat = wormMeatAt(base) + got.worm; // worm.js: before the meat (it is capped by it)
    base.stock.food = (base.stock.food || 0) + got.rations;
    base.meat = meatAt(base) + got.rations;
    const es = state.econStats;
    if (es) es.hunted = (es.hunted || 0) + got.rations;
    const worm = got.infested ? ` ${got.infested} of them infested: a quarter of the meat, with the worm's eggs.` : got.worm > 0 ? " Some of it is from infected land and needs cooking through." : "";
    log(state, `${[...hunters, ...fishers].map(first).join(" and ")} brought in ${countText(got)} at ${base.name} (${Math.floor(got.rations)} food of fresh game).${worm}`, "good");
  }
  return got;
}
// One kill by a base's hunters, snares or fishers (worm.js wormKill): what it adds to the day's catch.
function cabinKill(state, got, tile, rations, fish = false) {
  const wk = wormKill(state, tile, rations, { fish });
  got.rations += wk.rations;
  if (wk.worm > 0) got.worm = (got.worm || 0) + wk.worm;
  if (wk.infested) got.infested = (got.infested || 0) + 1;
}

// ---------- fresh game at a base (storage.js storageDaily) ----------
export function baseMeatRate(temp) {
  return temp < 0 ? 0.003 : temp < 5 ? 0.02 : temp > 24 ? 0.1 : 0.05;
}
// Before the stores spoil: the cabin smokes its share, then the rest of the fresh game spoils faster than other food.
// Returns { smoked, dried (preserved made), spoiled }.
export function baseGameDaily(state, base, temp) {
  let m = meatAt(base);
  base.meat = m;
  const out = { smoked: 0, dried: 0, spoiled: 0 };
  if (!(m > 0)) return out;
  if (baseHasHunting(base) && atBase(state, base.id).length) {
    const s = Math.min(CABIN.smoke, m);
    smokeWormMeat(base, s); // worm.js: the meat with eggs is smoked first (smoked is safe)
    base.stock.food -= s;
    base.stock.preserved = (base.stock.preserved || 0) + (s * CABIN.smokeOut) / CABIN.smoke;
    m -= s;
    out.smoked = s;
    out.dried = (s * CABIN.smokeOut) / CABIN.smoke;
  }
  const mult = (count(base, "coldstore") ? 0.4 : 1) * (baseHasHunting(base) ? CABIN.spoil : 1);
  const lost = m * baseMeatRate(temp) * mult;
  base.stock.food = Math.max(0, base.stock.food - lost);
  shrinkWormMeat(base, m, m - lost);
  m = Math.max(0, m - lost);
  base.meat = Math.round(m * 100) / 100;
  out.spoiled = lost;
  return out;
}

// ---------- for the autopilot and crews ----------
// The best tiles to hunt within `range` of `from` for these people, by expected rations a trip hour.
export function huntTargets(state, from, range, members, { ammo = Infinity, hours = HUNT.defHours, startHour = state.hour, limit = 6 } = {}) {
  const t = huntTeam(state, members, ammo);
  if (t.why) return [];
  const out = [];
  for (const id of state.grid.within(from, range)) {
    if (id === from || state.tiles[id].terrain === "water") continue;
    const a = gameAbundance(state, id);
    if (a * gameLevel(state, id) < 0.25) continue;
    if (state.parties.some((p) => p.owner === "player" && p.dest === id)) continue;
    const e = expectHunt(state, t.team, id, hours, startHour, t.loud);
    out.push({ tile: id, est: e, dist: state.grid.distance(from, id), snares: !!snareLine(state, id) });
  }
  return out.sort((a, b) => b.est.rations / (1 + b.dist / 5) - a.est.rations / (1 + a.dist / 5) || a.tile - b.tile).slice(0, limit);
}
export function fishTargets(state, from, range, members, extraItems = [], { hours = HUNT.defHours, startHour = state.hour, limit = 4 } = {}) {
  const kit = fishKit(members, extraItems);
  if (!kit.power) return [];
  const out = [];
  for (const id of state.grid.within(from, range)) {
    if (id === from || !fishSpot(state, id)) continue;
    if (frozenAt(state, startHour) && !kit.ice) continue;
    if (state.parties.some((p) => p.owner === "player" && p.dest === id)) continue;
    const e = expectFish(state, kit, id, hours, startHour);
    if (e.rations < 2) continue;
    out.push({ tile: id, est: e, dist: state.grid.distance(from, id) });
  }
  return out.sort((a, b) => b.est.rations / (1 + b.dist / 5) - a.est.rations / (1 + a.dist / 5) || a.tile - b.tile).slice(0, limit);
}
// A fishing rod or net in a base's armory, moved into a team's cargo (autopilot, crews). Returns the item or null.
export function packFishingGear(state, base, p) {
  const i = (base.armory || []).findIndex((it) => isNet(it) || isRod(it));
  if (i < 0) return null;
  const [it] = base.armory.splice(i, 1);
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  p.cargo.gear.push(it);
  return it;
}
export const hasFishingGear = (items) => (items || []).some((it) => isNet(it) || isRod(it));
