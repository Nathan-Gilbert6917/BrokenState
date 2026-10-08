// Military trucks: the Army's cargo trucks, Humvees and MRAPs left where the evacuation broke down. A truck is a big
// vehicle on a battle or raid map (combat.js placeMilTrucks: 2 cells wide, 3–5 long, full cover), with a cargo bed to
// search on a raid map (a "miltruck" container; an intact one often padlocked: locks.js LOCKS.cargobed) and its crew
// still about it: the soldiers who turned standing round it, and some still strapped in, who rise when the cargo is
// opened (the noise: combat.js truckCrewRises). Some are burned out or wrecked (less in them), some intact; an intact
// one can sometimes be got running again (foundcars.js).
//
// Where they are (trucksAt, deterministic by hash01: the same tile always has the same trucks):
//   road     a bare road tile: rare (ROAD_P 2%, ×0.5 on a dead end, ×1.5 at a junction), far more near a National
//            Guard base (NEAR_MIL: 45% a tile away, falling off to ~6% 8 tiles out): the convoys that tried to reach
//            it or get away from it. 1, sometimes 2.
//   base     a National Guard base: 3–5 in its motor pool (the evacuation took most of what they carried: BASE_RICH).
//            The first two are always ready to go (MOTOR_POOL): an Army cargo truck and a Humvee with an M2 on the
//            roof, both running (foundcars.js: the start switch, inspect, claim; plated and glassed, vehicles.js
//            fitMilitary) and guarded (more of the turned crew round them: MILTRUCK.GUARD).
//   crash    an Army helicopter wreck (crashes.js crash_mil): half of them have the Humvee of the recovery team.
//   convoy   the "abandoned military convoy" event (below): 2–4 trucks on a road tile, a temporary site that is
//            stripped by other groups and picked clean after some days (the crashes.js pattern).
// What is in one: truckLoot (the one loot table; later branches add attachments and typed ammo through
// TRUCK_LOOT_HOOKS). Opened and taken trucks are remembered per tile (state.milTrucks), so a truck is looted once.
// The headless search (scavenge.js searchHour) reaches the trucks too: truckSearchHour.
// The dead: a tile with unopened trucks has soldiers among its dead (truckDeadShare, read by deadsoldiers.js
// siteDeadMix), so raids, fights by the numbers and the hour-by-hour search all meet them.
import { LOCATIONS } from "./data.js";
import { hash01 } from "./skills.js";
import { Rng } from "./rng.js";
import { lootItem } from "./inventory.js";
import { log, addCard, hub, atBase, factionById, snapshot } from "./world.js";
import { tileLabel, planPath, spawnAiParty, partyMembers, partyTile, teamName, launchExpedition, carryCapacity, supplyLoad } from "./parties.js";
import { triggerConflict } from "./conflicts.js";
import { searchCrew } from "./crashes.js";
import { stockHas } from "./water.js";

export const MILTRUCK = {
  ROAD_P: 0.02, DEAD_END: 0.5, JUNCTION: 1.5, TWO: 0.25,
  NEAR_MIL: { p: 0.45, fall: 0.75, range: 8 }, // a road tile d tiles from a National Guard base: p × fall^(d − 1), out to range
  BASE: [3, 5], BASE_RICH: 0.45, CRASH: 0.5, CRASH_RICH: 0.8,
  // The dead: soldiers among a tile's dead while it has unopened trucks (deadsoldiers.js siteDeadMix).
  DEAD: { road: 0.35, base: 0.45, crash: 0.5, convoy: 0.55 },
  // Raid maps: the turned crew standing round each truck (AROUND), the ones still strapped in (TRUCK_KINDS crew) who
  // rise when the cargo is opened: Heat +RISE_HEAT, everything within RISE_RADIUS hears it.
  AROUND: [1, 2], RISE_HEAT: 6, RISE_RADIUS: 9, GUARD: 2, // GUARD: more round a motor pool's ready vehicles
  // The headless search: the chance an hour of reaching an unopened truck, and the Heat it costs.
  SEARCH_P: 0.35, SEARCH_HEAT: 6,
};
// L: length on the map (2 cells wide); body: what the views draw; crew: strapped in [lo, hi]; vehicle: the type it
// becomes when it is got running (vehicles.js VEHICLE_TYPES).
export const TRUCK_KINDS = {
  cargo:  { name: "Army cargo truck", short: "cargo truck", L: 5, body: "m35", crew: [1, 2], vehicle: "miltruck" },
  humvee: { name: "Humvee", short: "Humvee", L: 3, body: "humvee", crew: [1, 3], vehicle: "hummer" },
  mrap:   { name: "MRAP", short: "MRAP", L: 4, body: "mrap", crew: [2, 3], vehicle: "miltruck" },
};
// q: × supplies, items: × item chances, qual: the old item quality range (items now take theirs from itemcond.js: an intact truck "military", a wrecked or burned-out one "wreck"), crew: × strapped-in crew.
export const TRUCK_COND = {
  intact:  { name: "intact", q: 1, items: 1, qual: [0.6, 1], crew: 1 },
  wrecked: { name: "wrecked", q: 0.6, items: 0.6, qual: [0.4, 0.8], crew: 0.7 },
  burnt:   { name: "burned out", q: 0.25, items: 0.25, qual: [0.2, 0.5], crew: 0 },
};
// What each source puts on the map: kind and condition weights, loot multiplier.
const SOURCES = {
  road:   { kinds: { cargo: 0.45, humvee: 0.4, mrap: 0.15 }, cond: { intact: 0.3, wrecked: 0.35, burnt: 0.35 }, rich: 1 },
  base:   { kinds: { cargo: 0.45, humvee: 0.35, mrap: 0.2 }, cond: { intact: 0.6, wrecked: 0.3, burnt: 0.1 }, rich: MILTRUCK.BASE_RICH },
  crash:  { kinds: { humvee: 1 }, cond: { intact: 0.5, wrecked: 0.5 }, rich: MILTRUCK.CRASH_RICH },
  convoy: { kinds: { cargo: 0.5, humvee: 0.3, mrap: 0.2 }, cond: { intact: 0.5, wrecked: 0.3, burnt: 0.2 }, rich: 1 },
};
// The loot table: supplies [key, chance, lo, hi], items [key, chance] (each its own roll). A burned-out truck keeps
// only what survives a fire (BURNT_KEEP: rounds in steel cans, grenades, armour plates).
export const TRUCK_LOOT = {
  cargo: {
    sup: [["ammo", 0.85, 40, 110], ["food", 0.7, 4, 12], ["water", 0.5, 4, 10], ["meds", 0.45, 1, 3], ["fuel", 0.55, 2, 6], ["parts", 0.35, 1, 2], ["preserved", 0.3, 2, 6]],
    gear: [["ar", 0.4], ["carbine", 0.3], ["ar", 0.12], ["plate", 0.25], ["vest", 0.4], ["milhelmet", 0.4], ["milhelmet", 0.2], ["nvg", 0.1], ["thermal", 0.05], ["milradio", 0.15],
      ["frag", 0.35], ["frag", 0.15], ["smokegren", 0.4], ["flare", 0.45], ["assaultpack", 0.2], ["rucksack", 0.2], ["camonet", 0.15], ["sandbags", 0.1], ["bandagekit", 0.3], ["chocolate", 0.3], ["instcoffee", 0.25]],
  },
  humvee: {
    sup: [["ammo", 0.8, 20, 50], ["food", 0.4, 2, 5], ["water", 0.4, 2, 5], ["meds", 0.35, 1, 2], ["fuel", 0.4, 1, 4]],
    gear: [["ar", 0.3], ["carbine", 0.25], ["vest", 0.3], ["plate", 0.12], ["milhelmet", 0.3], ["nvg", 0.08], ["thermal", 0.04], ["milradio", 0.3], ["frag", 0.25], ["smokegren", 0.3], ["flare", 0.3], ["assaultpack", 0.12], ["bandagekit", 0.2]],
  },
  mrap: {
    sup: [["ammo", 0.85, 30, 70], ["food", 0.5, 2, 6], ["water", 0.5, 3, 6], ["meds", 0.5, 1, 3], ["fuel", 0.4, 2, 5]],
    gear: [["ar", 0.35], ["carbine", 0.2], ["plate", 0.3], ["vest", 0.3], ["milhelmet", 0.35], ["nvg", 0.12], ["thermal", 0.06], ["milradio", 0.25], ["frag", 0.3], ["smokegren", 0.35], ["surgkit", 0.08], ["bandagekit", 0.35], ["rucksack", 0.12]],
  },
};
// A National Guard base's motor pool: the vehicles left ready to go (trucksAt i 0, 1): intact, running, a turret.
export const MOTOR_POOL = [{ kind: "cargo", turret: null }, { kind: "humvee", turret: "m2hb" }];
const BURNT_KEEP = new Set(["ammo", "parts", "ar", "carbine", "plate", "milhelmet", "frag", "smokegren"]);
// Later branches (gun attachments, typed ammo) add to a truck's contents here: hook(rng, ctx, out) with ctx { kind,
// cond, src, rich } and out { sup, gear } (change it in place).
export const TRUCK_LOOT_HOOKS = [];
// Flashbangs (throwables.js FLASH) in the crates now and then: [chance, lo, hi] by kind, x the truck's richness; none
// left in a burned-out one. Dice of their own (a hash of the truck's dice position: no draw, the rest of the truck is
// as it was).
export const TRUCK_FLASH = { cargo: [0.25, 1, 3], humvee: [0.2, 1, 2], mrap: [0.25, 1, 2] };
TRUCK_LOOT_HOOKS.push((rng, ctx, out) => {
  const F = TRUCK_FLASH[ctx.kind];
  if (!F || ctx.cond === "burnt") return;
  const r = (...k) => hash01(rng && Number.isFinite(rng.state) ? rng.state : 0, "truckflash", ctx.kind, ctx.cond, ...k);
  if (r("p") >= F[0] * Math.min(1.2, ctx.rich ?? 1)) return;
  const n = F[1] + Math.floor(r("n") * (F[2] - F[1] + 1));
  for (let i = 0; i < n; i++) out.gear.push(lootItem("flashbang", "military", r("q", i)));
});

// What is in one truck: { sup: { ammo: 60, … }, gear: [items] }. rng: an Rng (or anything with next / chance / int);
// kind: TRUCK_KINDS key; cond: TRUCK_COND key; opts.rich: × supplies and item chances (a base's motor pool, a convoy
// another group stripped); opts.src: where it stands.
export function truckLoot(rng, kind, cond = "intact", opts = {}) {
  const T = TRUCK_LOOT[kind] || TRUCK_LOOT.cargo, C = TRUCK_COND[cond] || TRUCK_COND.intact;
  const rich = Math.max(0, opts.rich ?? 1);
  const burnt = cond === "burnt";
  const sup = {}, gear = [];
  for (const [k, p, lo, hi] of T.sup) {
    if (burnt && !BURNT_KEEP.has(k)) continue;
    if (!rng.chance(Math.min(0.95, p * Math.min(1.2, 0.5 + 0.5 * rich)))) continue;
    const q = Math.max(1, Math.round(rng.int(lo, hi) * C.q * rich));
    sup[k] = (sup[k] || 0) + q;
  }
  for (const [k, p] of T.gear) {
    if (burnt && !BURNT_KEEP.has(k)) continue;
    if (!rng.chance(Math.min(0.95, p * C.items * rich))) continue;
    rng.next(); // the old quality draw (TRUCK_COND qual), still taken so the truck's dice stay where they were
    gear.push(lootItem(k, burnt || cond === "wrecked" ? "wreck" : "military", rng)); // itemcond.js: crates in good order, a wreck's knocked about
  }
  const out = { sup, gear };
  for (const hook of TRUCK_LOOT_HOOKS) hook(rng, { kind, cond, src: opts.src || null, rich }, out);
  return out;
}

// ---------- where they are ----------
const store = (state) => state.milTrucks || (state.milTrucks = { opened: {}, taken: {} });
const pickW = (r, w) => { const ks = Object.keys(w); let x = r * ks.reduce((a, k) => a + w[k], 0); for (const k of ks) if ((x -= w[k]) <= 0) return k; return ks[ks.length - 1]; };
// The distance from a tile to the nearest National Guard base (99: none).
export function milDistance(state, tileId) {
  const g = state.grid;
  let d = 99;
  for (const id of state.militaryIds || []) d = Math.min(d, g.distance(id, tileId));
  return d;
}
// The chance a bare road tile's map holds a military truck.
export function roadTruckChance(state, t) {
  if (!t || !t.road || t.loc || t.bridge || t.terrain === "water") return 0;
  const d = milDistance(state, t.id);
  const N = MILTRUCK.NEAR_MIL;
  let p = d >= 1 && d <= N.range ? Math.max(MILTRUCK.ROAD_P, N.p * N.fall ** (d - 1)) : MILTRUCK.ROAD_P;
  const links = (t.roadLinks || []).length;
  p *= links <= 1 ? MILTRUCK.DEAD_END : links >= 3 ? MILTRUCK.JUNCTION : 1;
  return Math.min(0.6, p);
}
// The trucks on a tile's maps: [{ i, kind, cond, src, rich, crew, key }] (not the ones taken away; opened ones are
// marked opened). key: the tile's record in state.milTrucks (a convoy or a wreck has its own).
export function trucksAt(state, tileId) {
  const t = state.tiles && state.tiles[tileId];
  if (!t || t.terrain === "water") return [];
  const type = t.loc ? t.loc.type : null;
  let src = null, n = 0, salt = "";
  if (type === "convoy") { src = "convoy"; salt = `c${t.loc.convoy}`; const c = convoyById(state, t.loc.convoy); n = c ? c.trucks : 0; }
  else if (type === "military") { src = "base"; n = MILTRUCK.BASE[0] + Math.floor(hash01(state.seed, "mtruck", tileId, "n") * (MILTRUCK.BASE[1] - MILTRUCK.BASE[0] + 1)); }
  else if (type === "crash_mil") { src = "crash"; salt = `w${t.loc.crash}`; n = hash01(state.seed, "mtruck", tileId, salt, "c") < MILTRUCK.CRASH ? 1 : 0; }
  else if (!t.loc && hash01(state.seed, "mtruck", tileId, "road") < roadTruckChance(state, t)) { src = "road"; n = hash01(state.seed, "mtruck", tileId, "two") < MILTRUCK.TWO ? 2 : 1; }
  if (!n) return [];
  const S = SOURCES[src], key = `${tileId}${salt}`;
  const rec = store(state);
  const opened = rec.opened[key] || [], taken = rec.taken[key] || [];
  const stripped = src === "convoy" ? (convoyById(state, t.loc.convoy)?.stripped || 0) : 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (taken.includes(i)) continue;
    const roll = (...k) => hash01(state.seed, "mtruck", key, i, ...k);
    const pool = src === "base" ? MOTOR_POOL[i] : null; // a motor pool's ready vehicles
    const kind = pool ? pool.kind : src === "convoy" && i === 0 ? "cargo" : pickW(roll("kind"), S.kinds);
    const cond = pool ? "intact" : src === "convoy" && i === 0 && n > 1 ? "intact" : pickW(roll("cond"), S.cond);
    const K = TRUCK_KINDS[kind];
    const crew = Math.round((K.crew[0] + Math.floor(roll("crew") * (K.crew[1] - K.crew[0] + 1))) * TRUCK_COND[cond].crew);
    out.push({ i, kind, cond, src, key, crew, rich: S.rich * 0.3 ** stripped, opened: opened.includes(i), ...(pool ? { runs: true, guard: true, ...(pool.turret ? { turret: pool.turret } : {}) } : {}) });
  }
  return out;
}
export const unopenedTrucks = (state, tileId) => trucksAt(state, tileId).filter((x) => !x.opened);
export function markOpened(state, truck) {
  const rec = store(state);
  const list = rec.opened[truck.key] || (rec.opened[truck.key] = []);
  if (!list.includes(truck.i)) list.push(truck.i);
}
export function markTaken(state, truck) {
  const rec = store(state);
  const list = rec.taken[truck.key] || (rec.taken[truck.key] = []);
  if (!list.includes(truck.i)) list.push(truck.i);
}
// The share of soldiers among a tile's dead while it has trucks nobody has opened (deadsoldiers.js siteDeadMix).
export function truckDeadShare(state, tileId) {
  const list = unopenedTrucks(state, tileId);
  return list.length ? MILTRUCK.DEAD[list[0].src] || MILTRUCK.DEAD.road : 0;
}
export const truckName = (x) => `${TRUCK_COND[x.cond].name === "intact" ? "" : `${TRUCK_COND[x.cond].name[0].toUpperCase()}${TRUCK_COND[x.cond].name.slice(1)} `}${x.cond === "intact" ? TRUCK_KINDS[x.kind].name : TRUCK_KINDS[x.kind].short}`;
// The dice for one truck's cargo (its own generator: the same truck holds the same things, nothing else changes).
export const truckRng = (state, truck, salt = "") => new Rng(Math.floor(hash01(state.seed, "mtloot", truck.key, truck.i, salt) * 4294967296));

// ---------- the hour-by-hour search (scavenge.js searchHour) ----------
// A team searching a tile with unopened trucks reaches one now and then: its cargo, and its crew rising (Heat).
export function truckSearchHour(state, e, p, members) {
  const list = unopenedTrucks(state, e.tile);
  if (!list.length || !members.length) return "";
  if (hash01(state.seed, "mtsearch", e.tile, state.hour, e.hours) >= MILTRUCK.SEARCH_P) return "";
  const x = list[0];
  markOpened(state, x);
  const got = truckLoot(truckRng(state, x), x.kind, x.cond, { rich: x.rich, src: x.src });
  const bits = [];
  for (const [k, q] of Object.entries(got.sup)) { e.found.supplies[k] = (e.found.supplies[k] || 0) + q; bits.push(`${q} ${k}`); }
  for (const it of got.gear) { e.found.gear.push(it); bits.push(it.name); }
  e.heat = Math.min(100, e.heat + MILTRUCK.SEARCH_HEAT + 2 * x.crew);
  return ` Forced the back of a ${truckName(x).toLowerCase()}: ${bits.length ? bits.join(", ") : "nothing left in it"}.${x.crew ? ` ${x.crew === 1 ? "A soldier" : `${x.crew} soldiers`} still strapped in the cab came for them (Heat up).` : ""}`;
}

// ---------- a running Army truck on the State Map (vehicles.js VEHICLE_TYPES.miltruck loud) ----------
// Every tile it drives into, roaming hordes within ENGINE.range may turn toward the engine (ENGINE.p each, its own dice)
// and follow it there for ENGINE.hours.
export const ENGINE = { range: 2, p: 0.3, hours: 12 };
export function truckEngineNoise(state, p, tileId) {
  const g = state.grid;
  let n = 0;
  for (const h of state.hordes || []) {
    if ((h.role || "roam") !== "roam" || g.distance(h.tile, tileId) > ENGINE.range || (h.lureUntil && state.hour < h.lureUntil)) continue;
    if (hash01(state.seed, "engine", h.tile, h.born, h.size, tileId, state.hour) >= ENGINE.p) continue;
    h.target = tileId; h.lureUntil = state.hour + ENGINE.hours;
    n++;
  }
  if (n && p.radioLive) log(state, `The Army truck's engine carries: ${n === 1 ? "a horde turns" : `${n} hordes turn`} toward ${tileLabel(state, tileId)}.`, "danger");
  return n;
}

// ---------- seen from the State Map ----------
// A team that sees a road tile with a truck on it may notice it (markers.js perceive): a "miltruck" marker. Its own
// dice (hash01), so nothing else in the world changes.
export function spotTrucks(state, p, tileId, chance) {
  const t = state.tiles[tileId];
  if (!t || t.loc || !t.road) return null;
  const list = unopenedTrucks(state, tileId);
  if (!list.length) return null;
  if (hash01(state.seed, "mtspot", tileId, p.path ? p.path[p.idx] : "", state.hour) >= chance) return null; // never by ids made at run time (a loaded save hands out others)
  return { key: `miltruck:${tileId}`, type: "miltruck", tile: tileId, hour: state.hour, label: `${list.length === 1 ? truckName(list[0]) : `${list.length} military trucks`} on the road` };
}

// =====================================================================================================================
// The abandoned military convoy (an event, the crashes.js pattern): every 14–28 days (the first between days 12 and 20)
// a base, a team on the road or the radio learns of Army trucks stopped on a road tile: a card, and a temporary site
// there (data.js LOCATIONS convoy, raid areas combat.js AREA_SETS.convoy) with 2–4 trucks and their turned crews. Other
// groups within CONVOY.raceRange send salvage parties; one that gets there strips it (stripKeep of what is left, its
// trucks' cargo too). It is burned out or picked clean CONVOY.life days after it was found.
// =====================================================================================================================
export const CONVOY = { firstMin: 12, firstMax: 20, gapMin: 14, gapMax: 28, minDist: 4, maxDist: 12, radioDist: 18, lifeMin: 6, lifeMax: 9, trucks: [2, 4], raceRange: 22, raceMin: 18, raceMax: 48, stripKeep: 0.3 };
const RACE = { raider: 0.7, military: 0.9, expansionist: 0.6, zealot: 0.4, fortress: 0.35, traders: 0.3, commune: 0.15 };
const croll = (state, ...k) => hash01(state.seed, "convoy", ...k);
export const convoys = (state) => state.convoys || (state.convoys = []);
export const convoyById = (state, id) => (state.convoys || []).find((c) => c.id === id) || null;
export const activeConvoys = (state) => convoys(state).filter((c) => !c.gone);
export const convoyDaysLeft = (state, c) => Math.max(0, (c.expires - state.hour) / 24);

function schedule(state, first = false) {
  const n = state.convoySeq || 0;
  const d = first ? CONVOY.firstMin + Math.floor(croll(state, "first") * (CONVOY.firstMax - CONVOY.firstMin + 1))
    : Math.floor(state.hour / 24) + 1 + CONVOY.gapMin + Math.floor(croll(state, "gap", n) * (CONVOY.gapMax - CONVOY.gapMin + 1));
  state.convoyNext = (d - 1) * 24 + 8 + Math.floor(croll(state, "hr", n) * 10);
}
// A road tile for it: no site, base or hive, not a bridge, reachable on foot from the hub.
function goodTile(state, id) {
  const t = state.tiles[id];
  if (!t || !t.road || t.loc || t.bridge || t.hive || t.terrain === "water") return false;
  if (state.bases.some((b) => b.tile === id) || state.factions.some((f) => f.alive && f.bases.includes(id))) return false;
  if (state.hiveSites && state.hiveSites.some((s) => s.tile === id)) return false;
  return true;
}
function nearestTown(state, tile) {
  let best = null, bd = Infinity;
  for (const id of state.grid.within(tile, 12)) {
    const t = state.tiles[id];
    if (!t.loc || !["town", "city"].includes(t.loc.type)) continue;
    const d = state.grid.distance(id, tile);
    if (d < bd) { bd = d; best = t.loc.name.replace(/ (Town|City center|Downtown)$/i, ""); }
  }
  return best;
}
function witness(state, n) {
  const opts = [];
  for (const b of state.bases) opts.push({ tile: b.tile, label: b.name, w: b.type === "hub" ? 3 : 1, from: "base" });
  for (const p of state.parties) {
    if (p.owner !== "player" || p.kind === "convoy" || !partyMembers(state, p).length) continue;
    opts.push({ tile: partyTile(p), label: teamName(state, p), w: 1.5, from: "team" });
  }
  const h = hub(state);
  if (h && h.radio) opts.push({ tile: h.tile, label: "The radio", w: 1.5, from: "radio" });
  if (!opts.length) return null;
  let r = croll(state, "who", n) * opts.reduce((a, o) => a + o.w, 0);
  for (const o of opts) { r -= o.w; if (r <= 0) return o; }
  return opts[opts.length - 1];
}
// A new convoy (tools: opts.tile, opts.witness, opts.trucks, opts.noCard). Returns it or null.
export function spawnConvoy(state, opts = {}) {
  const n = state.convoySeq || 0;
  const w = opts.witness || witness(state, n);
  if (!w) return null;
  const g = state.grid, h = hub(state);
  let tile = opts.tile;
  if (tile == null) {
    const far = w.from === "radio" ? CONVOY.radioDist : CONVOY.maxDist;
    const cands = g.within(w.tile, far).filter((id) => g.distance(id, w.tile) >= CONVOY.minDist && goodTile(state, id));
    for (let i = 0; i < 12 && cands.length && tile == null; i++) {
      const id = cands[Math.floor(croll(state, "tile", n, i) * cands.length) % cands.length];
      if (planPath(state, h ? h.tile : w.tile, id, false)) tile = id;
    }
  }
  if (tile == null) return null;
  const t = state.tiles[tile];
  const life = CONVOY.lifeMin + Math.floor(croll(state, "life", n) * (CONVOY.lifeMax - CONVOY.lifeMin + 1));
  const trucks = opts.trucks || CONVOY.trucks[0] + Math.floor(croll(state, "n", n) * (CONVOY.trucks[1] - CONVOY.trucks[0] + 1));
  state.convoySeq = n + 1;
  const c = {
    id: n + 1, tile, trucks, seenHour: state.hour, expires: state.hour + life * 24, witness: w.label, from: w.from,
    race: [], stripped: 0, gone: false, prevLoot: t.loot ?? 0, name: nearestTown(state, tile) ? `Army convoy near ${nearestTown(state, tile)}` : "Army convoy",
  };
  convoys(state).push(c);
  placeConvoy(state, c);
  state.knowledge[tile] = snapshot(state, tile);
  state.factions.forEach((f, i) => {
    if (!f.alive || !f.bases.length) return;
    const d = Math.min(...f.bases.map((b) => g.distance(b, tile)));
    if (d > CONVOY.raceRange || croll(state, "race", n, i) >= (RACE[f.type] ?? 0.35)) return;
    c.race.push({ fid: f.id, at: state.hour + CONVOY.raceMin + Math.floor(croll(state, "rat", n, i) * (CONVOY.raceMax - CONVOY.raceMin + 1)), sent: false });
  });
  const dist = g.distance(w.tile, tile);
  log(state, `🪖 ${w.label} ${w.from === "radio" ? "picked up an automated distress beacon" : "spotted"}: ${trucks} Army trucks stopped on the road at ${tileLabel(state, tile)} (${dist} tiles away). Their crews are still with them, dead.`, "danger");
  if (!opts.noCard) addCard(state, convoyCard(state, c, w, dist));
  state.stats.convoys = (state.stats.convoys || 0) + 1;
  return c;
}
export function placeConvoy(state, c) {
  const t = state.tiles[c.tile];
  if (t.loc && t.loc.convoy === c.id) return;
  t.loc = { type: "convoy", name: c.name, zone: "special", convoy: c.id };
  t.loot = Math.max(0.03, LOCATIONS.convoy.richness * CONVOY.stripKeep ** (c.stripped || 0));
}
export function convoyCard(state, c, w = { label: c.witness, from: c.from }, dist = 0) {
  const crew = searchCrew(state);
  const est = crew.length >= 2 ? salvageSupplies(state, c, crew) : null;
  const wording = w.from === "radio" ? "An automated distress beacon on an Army channel, repeating the same grid reference." : `${w.label} saw a line of olive-drab trucks stopped nose to tail on the road, doors open, nobody moving but the dead.`;
  return {
    title: "An abandoned military convoy", convoyId: c.id, where: tileLabel(state, c.tile),
    text: `${wording} ${c.trucks} trucks at ${tileLabel(state, c.tile)}${dist ? `, ${dist} tiles away` : ""}. Army trucks carry rifles, ammunition by the crate, armour and night vision; their crews turned in the cabs and stand round them still, in plate carriers. ` +
      `Other groups will hear of it, and it will be stripped or burned out in about ${Math.round(convoyDaysLeft(state, c))} days.`,
    choices: [
      { label: "Mark it on the map", hint: "It stays on the map until it is gone. Plan a scavenging trip there yourself.", ai: () => 1, resolve: () => "The convoy is on the map." },
      {
        label: crew.length >= 2 ? `Send a salvage team (${crew.map((s) => s.name.split(" ")[0]).join(", ")})` : "Send a salvage team",
        hint: est && est.ok ? `On foot from the hub with ${est.text}: scavenge the convoy, come home. About ${Math.ceil(est.days)} days.` : (est ? est.why : "Not enough people free at the hub (2 or more, leaving 3 at home)."),
        disabled: () => !(est && est.ok) || c.gone || !searchCrew(state).length,
        ai: (st) => (est && est.ok && hub(st) && atBase(st, hub(st).id).length >= 6 ? 5 : 0),
        resolve: (st) => sendSalvageTeam(st, c),
      },
    ],
  };
}
function salvageSupplies(state, c, crew) {
  const h = hub(state);
  if (!h) return { ok: false, why: "No hub." };
  const path = planPath(state, h.tile, c.tile, false);
  if (!path) return { ok: false, why: "No way there on foot." };
  const n = crew.length, days = (path.cost * 2 + 8) / 24;
  const stock = (k) => Math.floor(stockHas(h.stock, k));
  const sup = { food: Math.ceil(n * days * 1.3) + n, water: Math.ceil(n * days * 1.3) + n, ammo: Math.max(0, Math.min(stock("ammo") - 10, 10 * n)), meds: stock("meds") >= 4 ? 1 : 0 };
  const cap = carryCapacity(state, crew, null);
  while (supplyLoad(sup) > cap && sup.ammo > 0) sup.ammo = Math.max(0, sup.ammo - 4);
  if (supplyLoad(sup) > cap) return { ok: false, why: "They cannot carry the food and water for it." };
  if (sup.food > stock("food") || sup.water > stock("water")) return { ok: false, why: `The hub cannot spare ${sup.food} food and ${sup.water} water.` };
  return { ok: true, sup, days, text: `${sup.food} food, ${sup.water} water${sup.ammo ? `, ${sup.ammo} ammo` : ""}${sup.meds ? ", 1 meds" : ""}` };
}
export function sendSalvageTeam(state, c) {
  if (!c || c.gone) return "The convoy is gone.";
  const crew = searchCrew(state);
  if (crew.length < 2) return "Not enough people free at the hub.";
  const s = salvageSupplies(state, c, crew);
  if (!s.ok) return s.why;
  const res = launchExpedition(state, { memberIds: crew.map((x) => x.id), dest: c.tile, mission: "scavenge", stance: "normal", supplies: s.sup });
  if (res.error) return res.error;
  return `${crew.map((x) => x.name.split(" ")[0]).join(", ")} set out for the convoy.`;
}

// Hourly (parties.js movePartiesHour, before crashes.js crashesHour: its salvage parties are handled here first).
export function convoysHour(state) {
  if (state.gameOver) return;
  if (state.convoyNext == null) schedule(state, true);
  if (state.hour >= state.convoyNext) {
    spawnConvoy(state);
    schedule(state);
  }
  for (const c of activeConvoys(state)) {
    if (state.hour >= c.expires) {
      const busy = (state.combat && state.combat.tileId === c.tile) || (state.engagement && !state.engagement.done && state.engagement.tile === c.tile);
      if (!busy) { expireConvoy(state, c); continue; }
    }
    for (const r of c.race) {
      if (r.sent || state.hour < r.at) continue;
      r.sent = true;
      const f = factionById(state, r.fid);
      if (!f || !f.alive || !f.bases.length) continue;
      const q = spawnAiParty(state, f, "salvage", f.bases[0], c.tile, { strength: Math.max(3, Math.round(f.pop * 0.25)) });
      if (q) { q.convoy = c.id; r.partyId = q.id; }
    }
  }
  for (const q of state.parties) {
    if (q.kind !== "salvage" || q.convoy == null || q.returning || q.owner === "player" || !q.path || q.idx < q.path.length - 1) continue;
    const c = convoyById(state, q.convoy);
    q.returning = true;
    if (!c || c.gone || partyTile(q) !== c.tile) continue;
    const f = factionById(state, q.owner);
    const team = state.parties.find((p) => p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).length && partyTile(p) === c.tile && p.phase !== "engaged");
    if (team && f && !state.cards.some((x) => x.partyId === team.id)) {
      triggerConflict(state, team, "challenge", f.id);
      log(state, `${f.known ? f.name : "Another group"} reached the convoy at ${tileLabel(state, c.tile)} while your team was there.`, "danger");
    }
    stripConvoy(state, c, f);
  }
  if (state.convoys && state.convoys.length > 10) state.convoys = state.convoys.filter((c) => !c.gone || state.hour - c.expires < 30 * 24);
}
export function stripConvoy(state, c, f) {
  const t = state.tiles[c.tile];
  if (t.loc && t.loc.convoy === c.id) t.loot = Math.max(0.03, (t.loot || 0) * CONVOY.stripKeep);
  c.stripped += 1;
  if (state.live.has(c.tile)) log(state, `${f && f.known ? f.name : "Another group"} reached the ${c.name} and stripped most of it.`, "danger");
}
export function expireConvoy(state, c) {
  const t = state.tiles[c.tile];
  c.gone = true;
  if (t.loc && t.loc.convoy === c.id) {
    delete t.loc;
    t.loot = c.prevLoot ?? 0;
    log(state, `The ${c.name} has been stripped and burned out.`, "info");
  }
  if (state.knowledge[c.tile]) state.knowledge[c.tile] = snapshot(state, c.tile);
  for (const q of state.parties) if (q.kind === "salvage" && q.convoy === c.id) q.returning = true;
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].convoyId === c.id) state.cards.splice(i, 1);
}
// The State Map tooltip.
export function convoyTip(state, tile) {
  const out = [];
  for (const c of activeConvoys(state)) if (c.tile === tile) out.push(`🪖 ${c.name}: ${c.trucks} trucks, gone in about ${convoyDaysLeft(state, c).toFixed(1)} days${c.stripped ? " (another group has stripped it)" : ""}`);
  const t = state.tiles[tile];
  if (t && t.loc && t.loc.type === "military") {
    const n = unopenedTrucks(state, tile).length;
    if (n) out.push(`🪖 ${n} truck${n === 1 ? "" : "s"} in the motor pool`);
  }
  return out;
}
