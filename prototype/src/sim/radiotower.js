// @ts-check
// Radio towers a base can power (issue #54 of the round-2 epic #39; the user's request 2026-10-26: "radio tower(can have
// a base turn it on with generators to extend radio communications further)"). The tower's raid map, its dozen plans
// and its loot: radiotowerlayout.js, data-radiotower.js. This module is the base feature; its numbers are
// data-radiotower.js TOWER.
//
// Where the towers stand: a tile whose site is a radio tower (mapgen.js: on the hills) or that has a radio tower point
// of interest (placement.js PLACE_EXTRA: by the highways, in the cities and the towns). towerTiles lists them (kept on
// the state for the map, not saved).
//
// Claiming: a base claims a tower on its own tile or within TOWER.CLAIM_R (2) tiles of it (claimTower: the base card's
// Claim; one tower a base, one base a tower). base.tower = { tile, on, gen, wrecked, dark, paid } (saved; new-only: an older save has none).
//
// Turning it on (setTower): the base needs
//   - a radio station of its own (a Radio station built, or a Military encrypted radio in its armory: radio.js
//     hasStation): the tower carries the base's set further, it does not replace it, so it opens no earlier than radios
//     do (the handbook or year 5: radio.js header);
//   - a generator: a working one at the base (power.js generators: built or a found set at the base, not broken, not
//     switched off: its crew runs the line to the tower), or a found generator carried there as a piece (installGen: a
//     genset_* item from the base's stores set in the tower's generator shed, base.tower.gen; removeGen puts it back);
//   - fuel: TOWER.FUEL (2) a day from the base's fuel above its reserve (power.js genReserve), paid when it is switched
//     on and at each day's turn after (towerDaily).
// Running (towerStatus → { live, why }): a tower on the air is a transmitter of yours at the tower's tile reaching
// TOWER.RANGE (30) tiles (radio.js radioNodes kind "tower", linked: it is a station's mast), so everything radio range
// drives today follows: who can be called and invited (canRadioGroup, the coalition's reach), the groups' offers and
// requests, caravans and radio trades, Scan the airwaves and the news, your teams reporting live, listening in,
// the Radio coverage layer's rings.
// Going dark: no fuel at the day's turn (dark "out of fuel", back on the air the first day the fuel is there), the
// generator gone, broken or switched off, the base's station gone (live: the next look), the tower wrecked.
// Raided or sabotaged: a raid on the base (breakdowns.js raidDamage calls towerRaided) wrecks its tower with the chance
// TOWER.RAID by the raid's outcome; a hostile group with a base within TOWER.SAB_R tiles sabotages a tower on the air
// with TOWER.SABOTAGE a day (towerDaily). A wrecked tower is off the air until repaired (repairTower: TOWER.REPAIR from
// the base's stores).
// The groups (docs/adr/0001-ai-parity.md, your rules, coarse): a group base standing on a tower's tile with a radio
// station (groupworks.js works.radio; the military's army sets), a generator (works.power; the military's sets) and the
// fuel for the day runs the tower (groupTowersDaily: TOWER.FUEL a day from its fuel; f.towersOn[tile]): its network's
// node there reaches TOWER.RANGE (radio.js groupNetwork). Their towers are not raided or sabotaged.
// An older save (worldcfg.js legacyTowers): no tower to claim or power.
import { TOWER } from "./data-radiotower.js";
import { GENSETS } from "./data-power.js";
import { generators, genName, genReserve, switchedOff } from "./power.js";
import { day, log } from "./world.js";
import { legacyTowers } from "./worldcfg.js";
import { hash01 } from "./skills.js";
import { groupsBuild } from "./groupworks.js";
import { attitude } from "./factions.js";

export { TOWER };
const r1 = (v) => Math.round(v * 100) / 100;

// ---------- where the towers stand ----------
/** A tile with a radio tower: its site, or a radio tower point of interest. @param {any} t */
export const hasTowerAt = (t) => !!t && ((t.loc && t.loc.type === "radiotower") || (Array.isArray(t.pois) && t.pois.some((p) => p && p.kind === "radiotower")));
/** Every tile with a tower (cached on the state, not saved). @param {any} state @returns {number[]} */
export function towerTiles(state) {
  const n = state.tiles ? state.tiles.length : 0;
  let c = state._towerTiles;
  if (!c || c.n !== n) {
    c = { n, list: (state.tiles || []).filter(hasTowerAt).map((t) => t.id) };
    Object.defineProperty(state, "_towerTiles", { value: c, writable: true, configurable: true, enumerable: false });
  }
  return c.list;
}
/** The tower another base of yours holds at a tile, or null. */
const claimedBy = (state, tile, except = null) => state.bases.find((b) => b !== except && b.tower && b.tower.tile === tile) || null;
/** The towers a base could claim: within TOWER.CLAIM_R tiles, nobody of yours holding them (its own tile first). */
export function towersNear(state, base) {
  if (!base || legacyTowers(state) || !state.grid) return [];
  const g = state.grid;
  return towerTiles(state).filter((t) => g.distance(t, base.tile) <= TOWER.CLAIM_R && !claimedBy(state, t, base)).sort((a, b) => g.distance(a, base.tile) - g.distance(b, base.tile) || a - b);
}

// ---------- claiming ----------
export function claimTower(state, base, tile = null) {
  if (legacyTowers(state)) return "There are no radio towers to claim in this world.";
  const near = towersNear(state, base);
  const t = tile == null ? near[0] : near.includes(tile) ? tile : null;
  if (t == null) return `No radio tower within ${TOWER.CLAIM_R} tiles of ${base.name} that another of your bases does not hold.`;
  if (base.tower && base.tower.tile === t) return `${base.name} already holds that tower.`;
  if (base.tower) releaseTower(state, base);
  base.tower = { tile: t, on: false, gen: null, wrecked: false, dark: "", paid: 0 };
  return `${base.name} claims the radio tower at ${tileName(state, t)}. Power it with a generator and fuel to put your radio on its mast (${TOWER.RANGE} tiles).`;
}
export function releaseTower(state, base) {
  const T = base && base.tower;
  if (!T) return "";
  if (T.gen) base.armory.push(T.gen);
  base.tower = null;
  return `${base.name} gives up the radio tower${T.gen ? "; its generator goes back into the stores" : ""}.`;
}
const tileName = (state, t) => { const x = state.tiles[t]; return x && x.loc && x.loc.name ? x.loc.name : `tile ${t}`; };

// ---------- its power ----------
const hasStation = (b) => !!b.radio || (!!b.armory && b.armory.some((it) => it && it.key === "milradio")); // radio.js hasStation (no import back)
/** What powers the tower: { kind: "set" | "base", name } or null. */
export function towerSource(state, base) {
  const T = base && base.tower;
  if (!T) return null;
  if (T.gen && GENSETS[T.gen.key]) return { kind: "set", name: GENSETS[T.gen.key].name };
  const g = generators(base).find((b) => !b.broken && !switchedOff(base, b));
  return g ? { kind: "base", name: genName(g) } : null;
}
const fuelAbove = (base) => Math.max(0, (base.stock.fuel || 0) - genReserve(base));
/** On the air now: { live, why } (why: what keeps it dark, "" when live). */
export function towerStatus(state, base) {
  const T = base && base.tower;
  if (!T || legacyTowers(state)) return { live: false, why: "No tower" };
  if (T.wrecked) return { live: false, why: `Wrecked: repair it (${costText(TOWER.REPAIR)})` };
  if (!T.on) return { live: false, why: "Switched off" };
  if (!hasStation(base)) return { live: false, why: "No radio station at the base to put on its mast" };
  if (!towerSource(state, base)) return { live: false, why: "No working generator (build one, set a found one, or carry one to its shed)" };
  if (T.dark) return { live: false, why: T.dark };
  return { live: true, why: "" };
}
export const towerOnAir = (state, base) => towerStatus(state, base).live;
const costText = (c) => Object.entries(c).map(([k, v]) => `${v} ${k}`).join(", ");
// Pay the day's fuel: true when paid (today already, or now).
function payFuel(state, base) {
  const T = base.tower, today = day(state);
  if (T.paid === today) return true;
  if (fuelAbove(base) < TOWER.FUEL - 1e-9) return false;
  base.stock.fuel = r1((base.stock.fuel || 0) - TOWER.FUEL);
  T.paid = today;
  return true;
}
// Why it cannot be switched on now ("" when it can).
export function towerRefusal(state, base) {
  const T = base && base.tower;
  if (!T) return "The base holds no radio tower.";
  if (T.wrecked) return `The tower is wrecked: repair it first (${costText(TOWER.REPAIR)}).`;
  if (!hasStation(base)) return `${base.name} has no radio station to put on the tower's mast: build one (or keep a Military encrypted radio in its armory).`;
  if (!towerSource(state, base)) return "No generator: a working generator at the base, or a found one carried to the tower's shed (Set a generator).";
  if (T.paid !== day(state) && fuelAbove(base) < TOWER.FUEL - 1e-9) return `Not enough fuel: it burns ${TOWER.FUEL} a day (above the ${genReserve(base)} kept back).`;
  return "";
}
export function setTower(state, base, on) {
  const T = base && base.tower;
  if (!T) return "The base holds no radio tower.";
  if (!on) { T.on = false; return `The radio tower at ${tileName(state, T.tile)} is switched off.`; }
  const why = towerRefusal(state, base);
  if (why) return why;
  payFuel(state, base);
  T.on = true; T.dark = "";
  return `The radio tower at ${tileName(state, T.tile)} is on the air: ${TOWER.RANGE} tiles of coverage, ${TOWER.FUEL} fuel a day (${towerSource(state, base).name}).`;
}
// A found generator carried to the tower's shed (the best of the base's stores), or taken back out.
export function installGen(state, base) {
  const T = base && base.tower;
  if (!T) return "The base holds no radio tower.";
  if (T.gen) return "The tower's shed has a generator already.";
  const list = base.armory.map((it, i) => [it, i]).filter(([it]) => it && GENSETS[it.key]).sort(([a], [b]) => GENSETS[b.key].out - GENSETS[a.key].out || (b.quality || 0) - (a.quality || 0));
  if (!list.length) return "No found generator in the stores to carry to the tower.";
  const [item, idx] = list[0];
  base.armory.splice(idx, 1);
  delete item.store;
  T.gen = item;
  return `${GENSETS[item.key].name} carried to the radio tower's generator shed.`;
}
export function removeGen(state, base) {
  const T = base && base.tower;
  if (!T || !T.gen) return "No generator in the tower's shed.";
  const item = T.gen;
  T.gen = null;
  base.armory.push(item);
  return `${GENSETS[item.key] ? GENSETS[item.key].name : "The generator"} taken back into the stores.`;
}
export function repairTower(state, base) {
  const T = base && base.tower;
  if (!T || !T.wrecked) return "The tower needs no repair.";
  const short = Object.entries(TOWER.REPAIR).filter(([k, v]) => (base.stock[k] || 0) < v);
  if (short.length) return `Repairing the tower takes ${costText(TOWER.REPAIR)}; ${base.name} is short of ${short.map(([k]) => k).join(" and ")}.`;
  for (const [k, v] of Object.entries(TOWER.REPAIR)) base.stock[k] -= v;
  T.wrecked = false;
  return `The radio tower is repaired${T.on ? "" : " (switched off: turn it on to put it back on the air)"}.`;
}

// ---------- raids and sabotage ----------
// A raid on the base has been settled (breakdowns.js raidDamage): the tower wrecked by the outcome's chance. Returns a
// sentence for the raid's report, or "".
export function towerRaided(state, base, outcome, key) {
  const T = base && base.tower;
  if (!T || T.wrecked || legacyTowers(state)) return "";
  const p = TOWER.RAID[outcome] ?? 0;
  if (!(p > 0) || hash01(state.seed, "towerraid", key) >= p) return "";
  T.wrecked = true;
  return "They wrecked the radio tower's transmitter: it is off the air until repaired.";
}
// The day's turn: the fuel, going dark and back, sabotage; then the groups' towers.
export function towerDaily(state) {
  if (legacyTowers(state)) return;
  const today = day(state), g = state.grid;
  for (const base of state.bases) {
    const T = base.tower;
    if (!T || !T.on || T.wrecked) continue;
    const src = towerSource(state, base);
    if (!src || !hasStation(base)) continue; // dark while it lasts (towerStatus says why); nothing burned
    if (payFuel(state, base)) {
      if (T.dark) log(state, `The radio tower held by ${base.name} is back on the air.`, "good");
      T.dark = "";
    } else if (!T.dark) {
      T.dark = `Out of fuel: ${TOWER.FUEL} a day (above the ${genReserve(base)} kept back)`;
      log(state, `The radio tower held by ${base.name} went dark: no fuel for its generator (${TOWER.FUEL} a day).`, "danger");
    }
    if (T.dark) continue;
    // Sabotage: each hostile group with a base near the tower, its own dice a day.
    let p = 0;
    for (const f of state.factions) if (f.alive && attitude(f) === "Hostile" && f.bases.some((t) => g.distance(t, T.tile) <= TOWER.SAB_R)) p += TOWER.SABOTAGE;
    if (p > 0 && hash01(state.seed, "towersab", base.id, today) < Math.min(TOWER.SAB_MAX, p)) {
      T.wrecked = true;
      log(state, `Saboteurs wrecked the radio tower held by ${base.name}: it is off the air until repaired (${costText(TOWER.REPAIR)}).`, "danger");
    }
  }
  groupTowersDaily(state);
}
// The groups' towers (see the header): f.towersOn = { [tile]: true } for the day.
export function groupTowersDaily(state) {
  if (legacyTowers(state)) return;
  for (const f of state.factions) {
    if (!f.alive || !f.bases || !groupsBuild(state, f)) { if (f.towersOn) delete f.towersOn; continue; }
    const mil = f.type === "military" || !!f.hcSplinter;
    const on = {};
    for (const tile of f.bases) {
      if (!hasTowerAt(state.tiles[tile])) continue;
      const w = f.works && f.works[tile];
      if (!(mil || (w && w.radio > 0)) || !(mil || (w && w.power > 0))) continue;
      if ((f.stock.fuel || 0) < TOWER.FUEL - 1e-9) continue;
      f.stock.fuel = r1(f.stock.fuel - TOWER.FUEL);
      on[tile] = true;
    }
    if (Object.keys(on).length) f.towersOn = on; else if (f.towersOn) delete f.towersOn;
  }
}
/** A group's tower on the air at one of its bases. */
export const groupTowerOn = (f, tile) => !!(f && f.towersOn && f.towersOn[tile]);

// ---------- the base panel's line ----------
/** { text, acts: [{ act, label, why }] } for the Bases tab card, or null (no tower held or near). */
export function towerLine(state, base) {
  if (legacyTowers(state) || !base) return null;
  const T = base.tower;
  if (!T) {
    const near = towersNear(state, base);
    if (!near.length) return null;
    return { text: `A radio tower at ${tileName(state, near[0])} (${state.grid.distance(near[0], base.tile) || "on this"} tile${state.grid.distance(near[0], base.tile) === 1 ? "" : "s"}${state.grid.distance(near[0], base.tile) ? " away" : ""}): claim it to power it`, acts: [{ act: "claim", label: "Claim the tower", why: "" }] };
  }
  const st = towerStatus(state, base), src = towerSource(state, base);
  const text = st.live
    ? `Radio tower at ${tileName(state, T.tile)}: on the air, ${TOWER.RANGE} tiles of coverage, ${TOWER.FUEL} fuel a day (${src ? src.name : "?"})`
    : `Radio tower at ${tileName(state, T.tile)}: dark (${st.why})`;
  const acts = [];
  if (T.wrecked) acts.push({ act: "repair", label: "Repair", why: Object.entries(TOWER.REPAIR).some(([k, v]) => (base.stock[k] || 0) < v) ? `Needs ${costText(TOWER.REPAIR)}` : "" });
  else if (T.on) acts.push({ act: "off", label: "Switch off", why: "" });
  else acts.push({ act: "on", label: "Turn on", why: towerRefusal(state, base) });
  if (T.gen) acts.push({ act: "ungen", label: "Take the generator back", why: "" });
  else acts.push({ act: "gen", label: "Carry a generator there", why: base.armory.some((it) => it && GENSETS[it.key]) ? "" : "No found generator in the stores" });
  acts.push({ act: "release", label: "Give it up", why: "" });
  return { text, acts };
}
