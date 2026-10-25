// The dead beasts: animals that died of the worm and walk, full of it (every number in hiveconst.js BEASTS; their
// stats as special dead in ZTYPES deadstag / deadhog / deadhound / deadcow, each with beast: true). The worm's eggs are
// in the soil and the water (worm.js), and the game that grazes bad land catches it (the infested herds there): thin
// deer and hogs that carry the eggs to cleaner ground until it kills them. These are the ones it killed. No hive
// breeds them (share 0): they are where they fell, on the hills, in the woods and over the farmland; and in the towns
// and cities the pets that died of it (dogs and cats), shut in the houses and the apartment blocks or loose in the
// streets.
// - Where they are (beastMix): the share of them among a tile's dead, as a horde's mix ({ deadstag: 0.1, ... })
//   placed one by one among the dead by zombietypes.js siteList (raids: scavenge.js raidEnemies; fights on the road:
//   conflicts.js enemyGroup) and drawn in later by noise with the rest (combat.js b.zmix, beastsOf). By the ground
//   (BEASTS.LAND: a dead stag on the hills and in the woods, a dead hog in the woods and by the farms, dead dogs and
//   dead cattle where the farms were; the dead pets of the suburbs and cities: TOWN), more at a farm, a barn or a ranch
//   and in the houses, neighbourhoods, motels and apartment blocks (SITE), an infested herd's own dead on its tile
//   (HERD: worm.js herdAt), × the ground's Infection (FLOOR + PER_INF × infection, at most 1), and only ODDS of tiles
//   have them in a given week (a hash of the seed, the tile and the week: no world dice, the same tile the same
//   beasts). In a raid the pets are in the rooms with the rest (buildingmaps.js placeInterior takes the mix), and a
//   city crawl's streets have the city's (citycrawl.js). None on a base's tile, on a mountain or on water.
//   A raid's locked house (locks.js lockRaid: a locked room of a kind in LOCKED.ROOMS, or a vet's locked kennels, on a
//   tile that has dead pets)
//   holds some of them LOCKED.ODDS of the time (shutInPets: area.pets, rolled with the raid's lock dice), shut in
//   with nobody to bite; the moment its door is opened (locks.js openLock: a key, the picks or a boot) they come out
//   at whoever opened it (releasePets: units inside the room by the door, aware, acting in the enemy turn).
// - In a fight: the usual AI plays them (they go for every living thing: wild). A dead cat hides as a crawler does
//   (zombietypes.js applyZType low: unseen until close, in light or once it has struck). A dead dog's bite is PACK surer for
//   each other dead dog next to its target (packAim, combat.js meleeOdds). Their bite can leave the worm in someone
//   living who stands it (beastBite, INFEST of the time; a kill INFEST_KILL: beastHit), as a worm swarm's does
//   (carriers.js swarmBite: wormed, wormBit; one of yours who lives through the battle has caught it). Killed, a
//   beast bursts into a worm swarm at its kind's BURST odds (a dead cow every time), never when fire killed it: the
//   worms cook (beastDies; carriers.js releaseSwarm, the Carrier's swarm).
// - On the State Map a horde crossing such land at HORDE_INF infection or more picks some up (hordeBeastPickup,
//   hordes.js onHordeEnter; hash dice of the seed, the horde's per-world id, the tile and the hour), and they come with it to your walls (ZTYPES wall / weight). A team on foot crossing
//   such land meets them as a travel card now and then (events.js "deadbeasts": go around, put them down, burn them).
// Battles without them draw no dice of the battle's here.
import { BEASTS, ZTYPES } from "./hiveconst.js";
import { LOCATIONS } from "./data.js";
import { hash01 } from "./skills.js";
import { localId } from "./world.js"; // a horde's id counted from the world's own start (the same seed the same dice)
import { herdAt } from "./worm.js";
import { mergeMix } from "./zombietypes.js";
import { releaseSwarm } from "./carriers.js";
import { say, adjacent, active, enemyUnit, CELL } from "./combat.js";
import { applyZType } from "./zombietypes.js";

export const BEAST_KINDS = Object.keys(ZTYPES).filter((k) => ZTYPES[k].beast);
export const isBeast = (k) => !!(k && ZTYPES[k] && ZTYPES[k].beast);
const round = (v) => Math.round(v * 1000) / 1000;
const first = (name) => String(name || "").split(" ")[0];
const week = (state) => Math.floor((state.hour || 0) / (24 * 7));

// ---------- where they are ----------
// The land the wild ones walk: hills, woods and farmland (plains); hordes pick them up there. Not a mountain or water.
export const beastLand = (t) => !!t && BEASTS.LAND[t.terrain] != null;
// The ground's shares: the suburbs and cities (and a town site anywhere) have the dead pets, the countryside the rest.
const groundShares = (t) => {
  const L = t.loc ? LOCATIONS[t.loc.type] : null;
  if (BEASTS.TOWN[t.terrain]) return BEASTS.TOWN[t.terrain];
  if (L && (L.cat === "town" || L.cat === "urban")) return BEASTS.TOWN.suburb;
  return BEASTS.LAND[t.terrain] || null;
};
// The share of the dead beasts among a tile's dead: { deadstag: 0.1, deadhog: 0.03 } or null. Deterministic (no
// world dice): the ground, its sites and herds, its Infection, and a hash of the seed, the tile and the week.
export function beastMix(state, tileId) {
  const t = state.tiles[tileId];
  const land = t ? groundShares(t) : null;
  if (!t || !land || (t.terrain === "water" && !t.bridge)) return null;
  if ((state.bases || []).some((b) => b.tile === tileId)) return null;
  if (hash01(state.seed, "beasts", tileId, week(state)) >= BEASTS.ODDS) return null;
  const out = {};
  const add = (k, v) => { if (v > 0) out[k] = Math.max(out[k] || 0, v); };
  for (const k in land) add(k, land[k]);
  if (t.loc && BEASTS.SITE[t.loc.type]) for (const [k, v] of Object.entries(BEASTS.SITE[t.loc.type])) add(k, v); // a farm's cattle, a house's pets
  const f = Math.min(1, BEASTS.FLOOR + BEASTS.PER_INF * (t.infection || 0));
  for (const k in out) out[k] = round(out[k] * f);
  const herd = herdAt(state, tileId); // worm.js: an infested herd grazing here: its own dead among the rest
  if (herd && BEASTS.HERD[herd.kind]) { const [k, v] = BEASTS.HERD[herd.kind]; out[k] = round((out[k] || 0) + v); }
  return Object.keys(out).length ? out : null;
}
// The beasts' share only of a mix (the dead drawn in by noise later: combat.js b.zmix).
export function beastsOf(mix) {
  if (!mix) return null;
  const out = {};
  for (const k of BEAST_KINDS) if (mix[k] > 0) out[k] = mix[k];
  return Object.keys(out).length ? out : null;
}
// The beasts in a mix as words: "dead stags, dead dogs" (the roster, the tile panel). "" when none.
export function beastText(mix) {
  return BEAST_KINDS.filter((k) => mix && mix[k] > 0).map((k) => `${ZTYPES[k].name.toLowerCase()}s`).join(", ");
}

// ---------- shut in a locked house (locks.js) ----------
const PET_KINDS = ["deadhound", "deadcat"];
// A raid's locked room has just been sealed (locks.js lockRaid): a house, a kitchen, a garage, a cabin on a tile that
// has dead pets holds some of them LOCKED.ODDS of the time. roll(...keys): the raid's lock dice (a hash: the same raid
// the same pets). area.pets = { kind, n }; null when none.
export function shutInPets(state, b, area, roll) {
  if (!area || area.outdoor || !(BEASTS.LOCKED.ROOMS.includes(area.type) || area.kennel) || area.pets) return null; // kennel: a vet's kennels (buildingmaps.js, #14)
  const mix = beastMix(state, b.tileId);
  const kinds = PET_KINDS.filter((k) => mix && mix[k] > 0);
  if (!kinds.length || roll("pets", area.id) >= BEASTS.LOCKED.ODDS) return null;
  const kind = kinds.reduce((a, k) => (mix[k] > mix[a] ? k : a));
  const [lo, hi] = BEASTS.LOCKED.COUNT;
  const n = lo + Math.floor(roll("petsn", area.id) * (hi - lo + 1)) % (hi - lo + 1);
  area.pets = { kind, n };
  return area.pets;
}
// The room's door has just been opened (locks.js openLock): the pets shut in it come out. Units inside the room on the
// door's storey, nearest the door first, aware (they bite in the enemy turn: ap 0 now), not counted among the enemy
// the battle began with (reinforcement). H: { say, fx }. Returns the units made.
export function releasePets(state, b, door, area, H) {
  const P = area && area.pets;
  if (!P || P.out) return [];
  P.out = true;
  const f = door.f || 0, W = b.w;
  const cells = b.floors && b.floors[f] ? b.floors[f].cells : b.cells;
  const taken = (x, y) => b.units.some((u) => !u.dead && !u.off && (u.f || 0) === f && u.x === x && u.y === y);
  const spots = [];
  for (let y = area.y0; y < area.y0 + area.h; y++) for (let x = area.x0; x < area.x0 + area.w; x++) {
    const c = cells[y * W + x];
    if (!c || !CELL[c.k] || !CELL[c.k].walk || c.k === "odoor" || c.k === "idoor" || c.k === "door" || taken(x, y)) continue;
    spots.push([x, y, Math.hypot(x - door.x, y - door.y)]);
  }
  spots.sort((a, c) => a[2] - c[2]);
  const power = (b.setup && b.setup.enemy && b.setup.enemy.power) || 2 + (b.infection || 0) * 3;
  const out = [];
  for (let i = 0; i < P.n && i < spots.length; i++) {
    const z = applyZType(enemyUnit(b, b.rng, "zombies", power, b.units.filter((o) => o.kind === "zombie").length + 1), P.kind, false, power);
    z.x = spots[i][0]; z.y = spots[i][1]; z.f = f;
    z.aware = true;
    z.reinforcement = true;
    z.ap = 0;
    z.low = false; // out of hiding: it is on whoever opened the door
    z.face = [Math.sign(door.x - z.x), Math.sign(door.y - z.y)];
    b.units.push(z);
    out.push(z);
  }
  if (!out.length) return out;
  const name = ZTYPES[P.kind].name.toLowerCase();
  const what = out.length === 1 ? `a ${name}` : `${out.length} ${name}s`;
  H.say(b, `Something scrabbles at the door as it opens: ${what}, shut in here since the house fell, thin and full of the worm, ${out.length === 1 ? "comes" : "come"} out at whoever opened it.`, "danger");
  if (H.fx) H.fx(b, { type: "loot", to: [door.x, door.y], text: out.length === 1 ? ZTYPES[P.kind].name.toUpperCase() : `${ZTYPES[P.kind].name.toUpperCase()}S` });
  return out;
}

// ---------- in a fight ----------
// A dead dog's bite (combat.js meleeOdds): + PACK to hit for each other dead dog next to its target, at most PACK_MAX.
export function packAim(b, a, t) {
  if (!a || a.ztype !== "deadhound" || !b || !b.units) return 0;
  let n = 0;
  for (const o of b.units) if (o !== a && o.ztype === "deadhound" && active(o) && adjacent(o, t)) n++;
  return Math.min(BEASTS.PACK_MAX, n * BEASTS.PACK);
}
// combat.js damage: a beast's bite that someone living takes and stands leaves the worm in them INFEST of the time.
export function beastBite(b, t, by) {
  if (!by || !by.beast || t.kind !== "human" || t.wormed || !b.rng.chance(Math.min(1, BEASTS.INFEST * (b.infectBite ?? 1)))) return false; // worldcfg.js: the run's Infection from bites dial
  t.wormed = true;
  t.wormBit = true;
  say(b, `${by.name}'s bite is full of the worm: it is in ${first(t.name)} now. If they die, they get up.`, t.side === "player" ? "death" : "info");
  return true;
}
// combat.js damage: brought to 0 by a beast's bite: the worm is in them INFEST_KILL of the time (they get up).
export function beastHit(b, t, by) {
  if (!by || !by.beast || t.kind !== "human" || t.wormed) return false;
  if (!b.rng.chance(Math.min(1, BEASTS.INFEST_KILL * (b.infectBite ?? 1)))) return false; // worldcfg.js: the Infection from bites dial
  t.wormed = true;
  return true;
}
// combat.js damage: a beast has just died. Fire cooked the worms in it; otherwise at its kind's odds it bursts into
// a worm swarm where it fell (carriers.js releaseSwarm).
export function beastDies(b, t, hit) {
  const odds = BEASTS.BURST[t.ztype] || 0;
  if (hit && hit.how === "fire") { if (odds > 0) say(b, `The fire cooks the worms in the ${ZTYPES[t.ztype].name.toLowerCase()}. Nothing comes out of it.`, "good"); return null; }
  if (!(odds > 0) || !b.rng.chance(odds)) return null;
  const w = releaseSwarm(b, t.x, t.y, t.power || 2);
  say(b, w ? `${t.name} splits open as it falls: a swarm of worms pours out of it.` : `${t.name} splits open as it falls; the worms spill out and sink into the ground.`, "danger");
  return w;
}

// ---------- on the State Map ----------
// A horde entering a tile (hordes.js onHordeEnter): on the beasts' land at HORDE_INF infection or more, some of the
// dead beasts there fall in (HORDE_ODDS a pass, HORDE_ADD of the horde, up to HORDE_MAX). Hash dice of the seed, the
// horde's per-world id (world.js localId: two worlds of one seed roll alike), the tile and the hour: no world dice.
export function hordeBeastPickup(state, h) {
  const t = state.tiles[h.tile];
  if (!t || !beastLand(t) || (t.infection || 0) < BEASTS.HORDE_INF) return false;
  if ((state.bases || []).some((b) => b.tile === h.tile)) return false;
  if (hash01(state.seed, "beasts-horde", localId(state, h.id), h.tile, state.hour) >= BEASTS.HORDE_ODDS) return false;
  const land = BEASTS.LAND[t.terrain];
  const kind = Object.keys(land).reduce((a, k) => (land[k] > land[a] ? k : a));
  const have = (h.mix && h.mix[kind]) || 0;
  if (have >= BEASTS.HORDE_MAX) return false;
  const add = Math.min(BEASTS.HORDE_ADD, BEASTS.HORDE_MAX - have);
  const n = Math.max(1, Math.round(h.size * add));
  h.mix = mergeMix(h.mix, h.size - n, { [kind]: 1 }, n);
  if (h.mix) for (const k in h.mix) h.mix[k] = round(h.mix[k]);
  h.mix[kind] = Math.min(BEASTS.HORDE_MAX, h.mix[kind]);
  return true;
}
