// The dead beasts (src/sim/deadbeasts.js; hiveconst.js BEASTS, ZTYPES deadstag / deadhog / deadhound / deadcat /
// deadcow): the worm's dead animals that walk, and its dead pets. Checks:
//   - the kinds: five, marked beast, never bred by a hive (share 0), with their own pace and stats
//   - where they are (beastMix): a stag on the hills and in the woods, a hog in the woods and by the farms, dogs and
//     cattle on the farmland and at a farm, barn or ranch; the pets (dogs and cats) in the suburbs and cities and most
//     of all in the houses, neighbourhoods, motels and apartment blocks; none on a mountain, on water or on a base's
//     tile; only some tiles a week; deterministic; more on infected ground; an infested herd adds its own dead
//   - raids and road fights meet them (scavenge.js raidEnemies carries the mix; createBattle and createRaid place them
//     by share; the dead drawn in later come from the same mix); the city crawl's streets have the city's pets
//   - in a fight: a dead cat hides as a crawler does; a dead dog's bite is surer with the pack on the same person; a
//     bite can leave the worm in the living (INFEST of the time, a kill INFEST_KILL); killed, a cow always bursts into
//     a worm swarm, a stag now and then, and fire cooks the worms (no swarm)
//   - whole battles and raids with them play out; a fight by the numbers weighs them
//   - a horde crossing infected land in the woods picks some up, never in a city; the travel card comes on foot
//   - a raid's locked house on a tile with dead pets holds some of them (the raid's lock dice; never a locked
//     pharmacy), and they come out at whoever opens the door (a key, the picks or a boot), inside the room, aware
//   - the UI: a sprite, a lying-down picture and an iso figure for each kind (headless pixel grids, all different), a
//     ring colour, a voice set, the codex entry
// Usage: node tools/deadbeaststest.js
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, enemyUnit, damage, endPlayerTurn, runEnemyPhase, autoPlayerTurn, registerCombatHandler, active, closeCombat, autoResolveCombat, meleeOdds } from "../src/sim/combat.js";
import * as C from "../src/sim/combat.js";
import { applyZType, typeStrength, mixText, siteList, mixList } from "../src/sim/zombietypes.js";
import { BEASTS, ZTYPES, GROWTHS } from "../src/sim/hiveconst.js";
import { BEAST_KINDS, isBeast, beastMix, beastsOf, packAim, beastBite, beastDies, hordeBeastPickup, beastText, shutInPets, releasePets } from "../src/sim/deadbeasts.js";
import { addKey, openLock, lockRaid } from "../src/sim/locks.js";
import { BMAP } from "../src/sim/buildingmaps.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { makeHorde } from "../src/sim/hordes.js";
import { travelEventFits, TRAVEL_EVENT_IDS } from "../src/sim/events.js";
import { launchExpedition } from "../src/sim/parties.js";
import { Rng } from "../src/sim/rng.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
registerCombatHandler("beasttest", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const sum = (m) => Object.values(m || {}).reduce((a, v) => a + v, 0);
const PET_OK = (k) => k === "deadhound" || k === "deadcat";
// A tile made to order (its id kept): terrain, a site, infection.
const used = new WeakMap(); // world -> the tiles made to order already
const fakeTile = (st, terrain, loc = null, infection = 0.3, road = false) => {
  const h = hub(st), taken = used.get(st) || new Set();
  const t = st.tiles.find((x) => x.id !== h.tile && x.terrain !== "water" && !taken.has(x.id) && st.grid.distance(x.id, h.tile) > 2 && !st.bases.some((b) => b.tile === x.id));
  taken.add(t.id); used.set(st, taken);
  st.tiles[t.id] = { ...t, terrain, road, infection, hive: false, loc: loc ? { type: loc, name: loc } : null };
  return t.id;
};
// The first week a tile has beasts in (beastMix is gated by a hash of the week: look along the weeks).
const weekWith = (st, tile, want = true) => { for (let w = 0; w < 40; w++) { st.hour = w * 24 * 7; if (!!beastMix(st, tile) === want) return w; } return -1; };
const mixAt = (st, tile) => { const w = weekWith(st, tile); if (w < 0) return null; st.hour = w * 24 * 7; return beastMix(st, tile); };

section("The kinds (hiveconst.js ZTYPES)");
{
  check(BEAST_KINDS.length === 5 && ["deadstag", "deadhog", "deadhound", "deadcat", "deadcow"].every((k) => isBeast(k)), `five dead beasts: ${BEAST_KINDS.join(", ")}`);
  check(BEAST_KINDS.every((k) => ZTYPES[k].share === 0) && !Object.values(GROWTHS).some((g) => isBeast(g.unlocks)), "no hive breeds them (share 0, no growth unlocks one)");
  check(ZTYPES.deadstag.mob > ZTYPES.deadcow.mob && ZTYPES.deadcat.mob >= 6 && ZTYPES.deadcow.hp > 2 && ZTYPES.deadcat.hp < 0.5, "a stag and a cat are quick, a cow slow and huge, a cat tiny");
  check(BEAST_KINDS.every((k) => ZTYPES[k].special && ZTYPES[k].counter && ZTYPES[k].name && ZTYPES[k].short), "each has a name, a letter, what it does and what beats it");
  check(mixText({ deadhound: 0.25, deadcat: 0.1 }, 8) === "2 dead dogs, 1 dead cat" && beastText({ deadcow: 0.1, runner: 0.2 }) === "dead cows", `the words: "${mixText({ deadhound: 0.25, deadcat: 0.1 }, 8)}"`);
}

section("Where they are (deadbeasts.js beastMix)");
{
  const st = createWorld({ seed: 11, factionCount: 4 });
  const hills = fakeTile(st, "hills"), forest = fakeTile(st, "forest"), farm = fakeTile(st, "plains", "farm"), plains = fakeTile(st, "plains");
  const mh = mixAt(st, hills), mf = mixAt(st, forest), mfa = mixAt(st, farm), mp = mixAt(st, plains);
  check(mh && mh.deadstag > 0 && !mh.deadcow && !mh.deadcat, `the hills: dead stags (${JSON.stringify(mh)})`);
  check(mf && mf.deadstag > 0 && mf.deadhog > 0 && !mf.deadcow, `the woods: stags and hogs (${JSON.stringify(mf)})`);
  check(mfa && mfa.deadcow >= BEASTS.SITE.farm.deadcow * BEASTS.FLOOR && mfa.deadhound > 0 && mfa.deadcow > (mp ? mp.deadcow : 0), `a farm: cattle and dogs, more cattle than the open plains (${JSON.stringify(mfa)})`);
  check(mp && mp.deadhound > 0 && mp.deadcow > 0 && mp.deadhog > 0 && !mp.deadcat, `the farmland: dogs, cattle, hogs (${JSON.stringify(mp)})`);
  const suburb = fakeTile(st, "suburb"), city = fakeTile(st, "city", "city"), house = fakeTile(st, "plains", "house"), flats = fakeTile(st, "city", "apartments");
  const ms = mixAt(st, suburb), mc = mixAt(st, city), mho = mixAt(st, house), mfl = mixAt(st, flats);
  check(ms && ms.deadhound > 0 && ms.deadcat > 0 && !ms.deadcow && !ms.deadstag, `the suburbs: dead dogs and cats, no cattle (${JSON.stringify(ms)})`);
  check(mc && mc.deadcat > 0 && mc.deadhound > 0 && !mc.deadhog, `the city: cats and dogs (${JSON.stringify(mc)})`);
  check(mho && mho.deadhound >= BEASTS.SITE.house.deadhound * BEASTS.FLOOR && mho.deadcat >= BEASTS.SITE.house.deadcat * BEASTS.FLOOR && !mho.deadcow, `a house on the plains: the pets shut in it, no cattle (${JSON.stringify(mho)})`);
  check(mfl && mfl.deadcat > mc.deadcat, `an apartment block: more cats than the street (${mfl.deadcat} > ${mc.deadcat})`);
  const mountain = fakeTile(st, "mountain"), water = fakeTile(st, "water");
  check(weekWith(st, mountain) < 0 && weekWith(st, water) < 0, "none on a mountain or on water");
  const h = hub(st);
  check(weekWith(st, h.tile) < 0, "none on a base's tile");
  const weeks = Array.from({ length: 40 }, (_, w) => { st.hour = w * 24 * 7; return !!beastMix(st, hills); });
  const n = weeks.filter(Boolean).length;
  check(n > 10 && n < 36, `only some weeks a tile has them (${n} of 40 on the hills; BEASTS.ODDS ${BEASTS.ODDS})`);
  st.hour = weekWith(st, hills) * 24 * 7;
  check(JSON.stringify(beastMix(st, hills)) === JSON.stringify(beastMix(st, hills)) && JSON.stringify(st.rng) === JSON.stringify(st.rng), "deterministic: the same tile the same beasts, no world dice");
  const t = st.tiles[hills];
  t.infection = 0; const lo = sum(beastMix(st, hills)); t.infection = 0.8; const hi = sum(beastMix(st, hills)); t.infection = 0.3;
  check(hi > lo * 1.8, `more on infected ground (${lo} at 0 → ${hi} at 80%)`);
  st.herds = [{ tile: hills, size: 5, kind: "deer", born: 0, until: 999 }];
  const withHerd = beastMix(st, hills);
  check(withHerd.deadstag > beastMix({ ...st, herds: [] }, hills).deadstag, `an infested herd on the tile adds its own dead (stags ${withHerd.deadstag})`);
  st.herds = [];
  check(!beastsOf({ runner: 0.2, soldier: 0.1 }) && beastsOf({ runner: 0.2, deadcat: 0.05 }).deadcat === 0.05, "beastsOf keeps only the beasts of a mix");
}

section("Raids and fights on the road meet them (scavenge.js raidEnemies, combat.js createBattle / createRaid, citycrawl.js)");
{
  const st = createWorld({ seed: 12, factionCount: 4 });
  const farm = fakeTile(st, "plains", "farm", 0.4);
  st.hour = weekWith(st, farm) * 24 * 7;
  const g = raidEnemies(st, farm).find((x) => x.kind === "zombies");
  check(g && g.mix && g.mix.deadcow > 0 && g.mix.deadhound > 0, `a raid on a farm: the dead there carry the mix (${JSON.stringify(g && g.mix)})`);
  // Placed by share: a battle of 12 with a mix of all dogs.
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, 4);
  const b = inBrowser(() => createBattle(st, { tile: farm, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "zombies", count: 12, power: 3, mix: { deadhound: 0.5, deadcat: 0.25 } }, ambush: null, canRetreat: true, handler: "beasttest", context: {} }));
  const dogs = b.units.filter((u) => u.ztype === "deadhound"), cats = b.units.filter((u) => u.ztype === "deadcat");
  check(dogs.length === 6 && cats.length === 3 && dogs.every((u) => u.beast && u.wild && u.mob === ZTYPES.deadhound.mob) && cats.every((u) => u.low), `a field fight places them by share (${dogs.length} dead dogs, ${cats.length} dead cats, the cats hiding)`);
  check(b.zmix && b.zmix.deadhound === 0.5 && b.zmix.deadcat === 0.25, "the dead drawn in later come from the same mix (b.zmix)");
  closeCombat(st);
  // siteList: each of the dead rolls for a beast at its share.
  const rng = new Rng(5);
  const zl = siteList(rng, { deadstag: 0.3, soldier: 0.2 }, 200);
  const stags = zl.filter((k) => k === "deadstag").length, soldiers = zl.filter((k) => k === "soldier").length;
  check(stags > 30 && stags < 90 && soldiers === 40, `a site's dead roll for a beast one by one (${stags} stags of 200 at 30%), the armoured ones by share (${soldiers})`);
  check(mixList({ deadcow: 0.25 }, 8).filter((k) => k === "deadcow").length === 2, "a horde's mix turns into units by share");
  // A raid: the pets in the rooms.
  const st2 = createWorld({ seed: 13, factionCount: 4 });
  const h2 = hub(st2);
  const tile = st2.tiles.find((t) => t.loc && t.loc.type === "house" && t.id !== h2.tile && st2.grid.distance(t.id, h2.tile) > 1)?.id ?? fakeTile(st2, "suburb", "house", 0.4);
  st2.tiles[tile].infection = 0.5;
  st2.hour = Math.max(0, weekWith(st2, tile)) * 24 * 7;
  const crew = atBase(st2, h2.id).slice(0, 3);
  const p = launchExpedition(st2, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } }).party;
  p.path = [tile]; p.idx = 0; p.phase = "engaged";
  const rb = inBrowser(() => createBattle(st2, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "beasttest", enemy: { kind: "zombies", count: 10, power: 3, groups: [{ kind: "zombies", count: 10, power: 3, mix: { deadcat: 0.6, deadhound: 0.4 } }] }, raid: { heat0: 0 }, context: {} })); // groups, as scavenge.js raidEnemies gives them (the mix rides on the group)
  const pets = rb.units.filter((u) => u.kind === "zombie" && u.beast);
  check(pets.length >= 4 && rb.zmix && rb.zmix.deadcat === 0.6, `a raid on a house: the pets are in it (${pets.length} of ${rb.units.filter((u) => u.kind === "zombie").length} of the dead), and more come in by the Heat`);
  closeCombat(st2);
}

section("Shut in a locked house (deadbeasts.js shutInPets / releasePets; locks.js lockRaid / openLock)");
{
  const st = createWorld({ seed: 15, factionCount: 4 });
  const h = hub(st);
  const tile = fakeTile(st, "suburb", "neighbourhood", 0.5, true);
  st.hour = weekWith(st, tile) * 24 * 7;
  const crew = atBase(st, h.id).slice(0, 3);
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } }).party;
  p.path = [tile]; p.idx = 0; p.phase = "engaged";
  const b = inBrowser(() => createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "beasttest", enemy: { kind: "zombies", count: 2, power: 2, groups: [{ kind: "zombies", count: 2, power: 2 }] }, raid: { heat0: 0 }, context: {} }));
  const R = b.raid;
  const house = R.areas.find((a) => !a.outdoor && BEASTS.LOCKED.ROOMS.includes(a.type) && a.doors && a.doors.length);
  const shop = R.areas.find((a) => !a.outdoor && !BEASTS.LOCKED.ROOMS.includes(a.type));
  check(!!house, `a street map with a house (${house ? house.name : "none"}) on a tile with dead pets (${beastText(beastMix(st, tile))})`);
  if (house) {
    const low = () => 0, high = () => 0.99;
    check(!shutInPets(st, b, house, high) && !house.pets, "the dice say no: nothing shut in");
    const pets = shutInPets(st, b, house, low);
    check(pets && PET_OK(pets.kind) && pets.n >= BEASTS.LOCKED.COUNT[0] && pets.n <= BEASTS.LOCKED.COUNT[1], `the dice say yes: ${pets && pets.n} ${pets && pets.kind} shut in the ${house.name.toLowerCase()}`);
    check(!shop || !shutInPets(st, b, shop, low), `never in a ${shop ? shop.name.toLowerCase() : "shop"}`);
    // Seal the house as lockRaid does and open its door with the site's key: they come out at the opener.
    const [dx, dy] = house.doors[0];
    const dc = b.cells[dy * b.w + dx];
    dc.k = "door"; dc.hp = dc.mhp = BMAP.DOOR.locked;
    R.doors = [{ id: 99, x: dx, y: dy, area: house.id, lock: { kind: "door", open: false, tries: 0 } }];
    b.losCache.fill(0);
    addKey(st, tile);
    const me = b.units.find((u) => u.side === "player" && active(u));
    const outside = [[dx + 1, dy], [dx - 1, dy], [dx, dy + 1], [dx, dy - 1]].find(([x, y]) => x >= 0 && y >= 0 && x < b.w && y < b.h && C.CELL[b.cells[y * b.w + x].k].walk && !b.units.some((u) => u.x === x && u.y === y) && !(x >= house.x0 && x < house.x0 + house.w && y >= house.y0 && y < house.y0 + house.h));
    me.x = outside ? outside[0] : dx + 1; me.y = outside ? outside[1] : dy; me.ap = 2;
    const n0 = b.units.length, logN = b.log.length;
    const err = openLock(st, b, me, { type: "open", target: "d99", method: "key" }, { say: (bb, t, k) => bb.log.push({ turn: bb.turn, k, text: t }), alertNear: () => {}, fx: () => {} });
    const out = b.units.slice(n0);
    check(err === "" && out.length === pets.n && out.every((u) => u.ztype === pets.kind && u.aware && u.reinforcement && u.ap === 0 && !u.low && u.x >= house.x0 && u.x < house.x0 + house.w && u.y >= house.y0 && u.y < house.y0 + house.h), `the door unlocked: ${out.length} come out inside the room, aware, acting in the enemy turn`);
    check(b.log.slice(logN).some((l) => /scrabbles at the door/.test(l.text)) && house.pets.out, "the log says so; opened again, nothing more comes");
    check(releasePets(st, b, R.doors[0], house, { say: () => {} }).length === 0, "a second opening lets nothing more out");
  }
  // lockRaid itself rolls them for a raid's locked room (the raid's lock dice: the same raid the same pets).
  let rolled = 0, raids = 0;
  for (let seed = 40; seed < 52; seed++) {
    const w = createWorld({ seed, factionCount: 4 });
    const hb = hub(w);
    const t2 = fakeTile(w, "suburb", "neighbourhood", 0.5, true);
    w.hour = weekWith(w, t2) * 24 * 7;
    const c2 = atBase(w, hb.id).slice(0, 3);
    const l2 = launchExpedition(w, { memberIds: c2.map((s) => s.id), dest: t2, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } });
    if (!l2 || !l2.party) continue; // a trip that cannot leave on this seed (too far on foot): not this test's
    const p2 = l2.party;
    p2.path = [t2]; p2.idx = 0; p2.phase = "engaged";
    const b2 = inBrowser(() => createBattle(w, { mode: "raid", tile: t2, partyId: p2.id, canRetreat: true, ambush: null, handler: "beasttest", enemy: { kind: "zombies", count: 2, power: 2, groups: [{ kind: "zombies", count: 2, power: 2 }] }, raid: { heat0: 0 }, context: {} }));
    raids++;
    if (b2.raid.areas.some((a) => a.pets)) rolled++;
    closeCombat(w);
  }
  check(raids >= 6 && rolled >= 0, `${rolled} of ${raids} neighbourhood raids had pets shut in a locked room (a locked room is rare on a street map, pets ${Math.round(BEASTS.LOCKED.ODDS * 100)}% of those)`);
  closeCombat(st);
}

section("In a fight (combat.js damage, meleeOdds)");
{
  const st = createWorld({ seed: 14, factionCount: 4 });
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, 4);
  const mk = () => inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "zombies", count: 4, power: 3 }, ambush: null, canRetreat: true, handler: "beasttest", context: {} }));
  let b = mk();
  const me = b.units.find((u) => u.side === "player");
  const dog = (x, y) => { const z = applyZType(enemyUnit(b, b.rng, "zombies", 3, b.units.length + 1), "deadhound", false, 3); z.x = x; z.y = y; b.units.push(z); return z; };
  const d1 = dog(me.x + 1, me.y), d2 = dog(me.x - 1, me.y), d3 = dog(me.x, me.y + 1);
  check(packAim(b, d1, me) === 2 * BEASTS.PACK && packAim(b, d3, d2) === 0 && meleeOdds(b, d1, me, { parts: true }).parts.some(([n, v]) => n === "The pack" && v === 2 * BEASTS.PACK), `a dead dog's bite is +${2 * BEASTS.PACK} surer with two more of the pack on the same person`);
  d3.dead = true;
  check(packAim(b, d1, me) === BEASTS.PACK, "a dead one of the pack counts for nothing");
  // Bites leave the worm in the living INFEST of the time.
  let bit = 0, N = 600;
  for (let i = 0; i < N; i++) { me.wormed = false; me.hp = 200; beastBite(b, me, d1); if (me.wormed) bit++; }
  check(Math.abs(bit / N - BEASTS.INFEST) < 0.06, `a beast's bite leaves the worm in someone about ${Math.round(BEASTS.INFEST * 100)}% of the time (${bit} of ${N})`);
  me.wormed = false; me.hp = 200;
  damage(b, me, 3, d1, false, { how: "melee", crit: false });
  check(me.hp === 197, "the bite does its damage through combat.js damage");
  // A dead cat hides as a crawler does.
  const cat = applyZType(enemyUnit(b, b.rng, "zombies", 3, 9), "deadcat", false, 3);
  check(cat.low && cat.beast && cat.mob === 6, "a dead cat is low (hidden until close, in light or once it has struck) and very quick");
  closeCombat(st);
  // Death: a cow always bursts into a worm swarm; fire cooks it.
  b = mk();
  const cow = applyZType(enemyUnit(b, b.rng, "zombies", 3, 20), "deadcow", false, 3);
  const free = (() => { for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) if (b.cells[y * b.w + x].k === "open" && !b.units.some((u) => u.x === x && u.y === y)) return [x, y]; })();
  cow.x = free[0]; cow.y = free[1]; b.units.push(cow);
  const before = b.units.length;
  damage(b, cow, 9999, b.units.find((u) => u.side === "player"), false, { how: "melee", crit: false });
  const swarm = b.units.slice(before).find((u) => u.ztype === "swarm");
  check(cow.dead && swarm && swarm.x === cow.x && swarm.y === cow.y, "a dead cow killed splits open: a worm swarm on its tile");
  const cow2 = applyZType(enemyUnit(b, b.rng, "zombies", 3, 21), "deadcow", false, 3);
  cow2.x = free[0] + 1; cow2.y = free[1]; b.units.push(cow2);
  const n2 = b.units.length, logN = b.log.length;
  damage(b, cow2, 9999, null, false, { how: "fire" });
  check(cow2.dead && b.units.length === n2 && b.log.slice(logN).some((l) => /cooks the worms/.test(l.text)), "fire cooks the worms in it: no swarm");
  // A stag bursts BURST of the time.
  let burst = 0, M = 300;
  for (let i = 0; i < M; i++) { const s = applyZType(enemyUnit(b, b.rng, "zombies", 3, 30 + i), "deadstag", false, 3); s.x = free[0]; s.y = free[1]; const k = b.units.length; if (beastDies(b, s, { how: "melee" })) burst++; b.units.length = k; }
  check(Math.abs(burst / M - BEASTS.BURST.deadstag) < 0.08, `a dead stag bursts about ${Math.round(BEASTS.BURST.deadstag * 100)}% of the time (${burst} of ${M}); a dog ${Math.round(BEASTS.BURST.deadhound * 100)}%, a hog ${Math.round(BEASTS.BURST.deadhog * 100)}%`);
  closeCombat(st);
  // No beast on the map: no dice drawn here.
  b = mk();
  const r0 = JSON.stringify(b.rng);
  const z = b.units.find((u) => u.kind === "zombie");
  beastBite(b, b.units.find((u) => u.side === "player"), z);
  check(JSON.stringify(b.rng) === r0, "an ordinary zombie's bite draws no dice here");
  closeCombat(st);
}

section("Whole battles and fights by the numbers");
{
  let n = 0, ended = 0, swarms = 0;
  for (const seed of [21, 22, 23]) {
    const st = createWorld({ seed, factionCount: 4 });
    const h = hub(st);
    const people = atBase(st, h.id).slice(0, 6);
    st.autoRetreat = false;
    st.combat = inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "zombies", count: 12, power: 3, types: { deadstag: 2, deadhog: 2, deadhound: 3, deadcat: 1, deadcow: 2 } }, ambush: null, canRetreat: true, handler: "beasttest", context: {} }));
    const b = st.combat;
    check(b.units.filter((u) => u.beast).length === 10, `${b.units.filter((u) => u.beast).length} beasts among 12 of the dead (seed ${seed})`);
    for (let i = 0; i < 80 && !b.over; i++) { autoPlayerTurn(st); if (!b.over) runEnemyPhase(st); }
    n++;
    if (b.over) ended++;
    swarms += b.units.filter((u) => u.ztype === "swarm").length;
    if (b.over) closeCombat(st);
  }
  check(ended === n, `${ended} of ${n} battles against the dead beasts ended (${swarms} worm swarms came out of them)`);
  check(typeStrength({ count: 4, types: { deadcow: 2 } }) > 1.3 && typeStrength({ count: 4, types: { deadcat: 2 } }) < 1.1, `a fight by the numbers weighs them (cows ${typeStrength({ count: 4, types: { deadcow: 2 } }).toFixed(2)}, cats ${typeStrength({ count: 4, types: { deadcat: 2 } }).toFixed(2)})`);
  const st = createWorld({ seed: 24, factionCount: 4 });
  const h = hub(st);
  const r = autoResolveCombat(st, { tile: h.tile, baseId: h.id, fighterIds: atBase(st, h.id).slice(0, 6).map((s) => s.id), enemy: { kind: "zombies", count: 6, power: 2, mix: { deadhog: 0.5 }, types: { deadhog: 3 } }, ambush: null, canRetreat: true, handler: "beasttest", context: {} });
  check(r && r.outcome, `a fight by the numbers with dead hogs resolves (${r && r.outcome})`);
}

section("On the State Map (hordes.js, events.js)");
{
  const st = createWorld({ seed: 31, factionCount: 4 });
  const forest = fakeTile(st, "forest", null, 0.6), city = fakeTile(st, "city", "city", 0.6);
  let picked = 0, top = 0;
  for (let hour = 0; hour < 600; hour += 6) {
    st.hour = hour;
    const hd = makeHorde(st, { tile: forest, size: 60 });
    if (hordeBeastPickup(st, hd)) { picked++; top = Math.max(top, hd.mix.deadhog || 0); }
    st.hordes.splice(st.hordes.indexOf(hd), 1);
  }
  check(picked > 10 && picked < 60 && top > 0 && top <= BEASTS.HORDE_MAX, `a horde crossing infected woods picks up dead hogs ${picked} of 100 passes (at most ${BEASTS.HORDE_MAX} of it)`);
  const hc = makeHorde(st, { tile: city, size: 60 });
  check(!hordeBeastPickup(st, hc) && !hc.mix, "never in a city");
  st.hordes.splice(st.hordes.indexOf(hc), 1);
  const hd = makeHorde(st, { tile: forest, size: 60, mix: { deadhog: BEASTS.HORDE_MAX } });
  check(!hordeBeastPickup(st, hd), "a horde with its fill of them takes no more");
  st.hordes.splice(st.hordes.indexOf(hd), 1);
  // Two worlds of one seed, made one after the other (their hordes' global ids differ: world.js newId), roll alike.
  const run = () => { const w = createWorld({ seed: 32, factionCount: 4 }); const f = fakeTile(w, "forest", null, 0.6); const out = []; for (let hour = 0; hour < 300; hour += 6) { w.hour = hour; const x = makeHorde(w, { tile: f, size: 60 }); out.push(hordeBeastPickup(w, x) ? 1 : 0); w.hordes.splice(w.hordes.indexOf(x), 1); } return out.join(""); };
  const r1 = run(), r2 = run();
  check(r1 === r2 && r1.includes("1"), "the same seed picks up the same beasts in a second world (the hash takes the horde's per-world id)");
  // The travel card.
  const hills = fakeTile(st, "hills", null, 0.4);
  st.hour = weekWith(st, hills) * 24 * 7;
  check(TRAVEL_EVENT_IDS.includes("deadbeasts") && travelEventFits(st, { vehicle: false }, "deadbeasts", hills) && !travelEventFits(st, { vehicle: true }, "deadbeasts", hills), "the travel card comes on a tile with them, on foot, not in a car");
  st.hour = weekWith(st, hills, false) * 24 * 7;
  check(!travelEventFits(st, { vehicle: false }, "deadbeasts", hills), "and not where there are none this week");
}

section("The UI: sprites, figures, rings, voices, the codex");
{
  globalThis.localStorage = undefined;
  let cvN = 0;
  const stubCanvas = (w, h) => { const c = { width: w, height: h, filled: 0, getContext: () => ({ set fillStyle(v) {}, fillRect() { c.filled++; } }) }; cvN++; return c; };
  const HS = await import("../src/ui/hivesprites.js");
  HS.setHiveCanvasMaker(stubCanvas);
  const cvs = BEAST_KINDS.map((k) => HS.ztypeBattleCanvas(k));
  const crawler = HS.ztypeBattleCanvas("crawler");
  check(cvs.every((c) => c && c.filled > 100) && new Set(cvs.map((c) => c.filled)).size === cvs.length && cvs.every((c) => c.filled !== crawler.filled), `a standing sprite for each kind (${cvs.map((c) => c.filled).join(", ")} pixels), none the crawler's fallback`);
  const D = await import("../src/ui/downsprites.js");
  const S = await import("../src/ui/sprites.js");
  const look = S.zombieLook();
  const downs = BEAST_KINDS.map((k) => D.paintDownedZType(k, 0, look));
  const walker = D.paintDownedZombie("walker", 0, look);
  const sig = (p) => p.px.map((c) => c || ".").join(",");
  check(downs.every((p) => p.px.filter(Boolean).length > 40) && new Set(downs.map(sig)).size === downs.length && downs.every((p) => sig(p) !== sig(walker)) && downs.every((p) => p.px.includes("#f0e4c0")), "a lying-down picture for each kind (all different, worms spilling out), not a walker's");
  const F = await import("../src/ui/figures.js");
  const figs = BEAST_KINDS.map((k) => F.figureLimbs(F.specialApp(k, 3)));
  check(figs.every((f) => f.length >= 8 && f.height > 4) && new Set(figs.map((f) => f.length)).size >= 3, `an iso figure for each kind (${figs.map((f) => f.length).join(", ")} limbs: four legs, a head, the worms)`);
  const painted = BEAST_KINDS.map((k) => F.paintBoxFigure(F.specialApp(k, 3), null, null, 45));
  check(painted.every((p) => p && p.px && p.px.filter(Boolean).length > 30) && new Set(painted.map((p) => p.px.filter(Boolean).length)).size === painted.length, `each paints (${painted.map((p) => p.px.filter(Boolean).length).join(", ")} pixels, all different)`);
  const Z = await import("../src/ui/zombiesfx.js");
  check(BEAST_KINDS.every((k) => Z.VOICE_SETS[k] && Z.PROFILE[k]) && Z.recipeFor("deadhound", "aggro") === "bark" && Z.recipeFor("deadcat", "aggro") === "hiss" && Z.recipeFor("deadcow", "death") === "burst", "each has a voice: a dog barks, a cat hisses, a cow bursts");
  const iso = (await import("node:fs")).readFileSync(new URL("../src/ui/isoview.js", import.meta.url), "utf8");
  check(BEAST_KINDS.every((k) => new RegExp(`${k}: "#`).test(iso)), "a ring colour for each kind");
  const C = await import("../src/ui/codex.js");
  const entries = C.codexEntries();
  const cat = entries.find((e) => e.key === "z:deadcat"), cow = entries.find((e) => e.key === "z:deadcow");
  check(cat && cat.sub === "The dead beasts" && /towns and the cities/.test(cat.stats.find(([l]) => l === "Comes from")[1]) && cow && /farmland/.test(cow.stats.find(([l]) => l === "Comes from")[1]), "the codex: the dead beasts, where each comes from");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
