// Headless checks for New start position (sim/startpick.js): a start of its own on the same seed keeps the map (terrain,
// sites, hives) and moves where you start (the hub's town in a normal start, the roadside tile in Hardcore) away from
// the one before; the same roll always gives the same spot; with no start the world is exactly the seed's as before;
// the new spot still keeps the usual distance from the outbreak origin; and the world still ticks. Pick start on map
// ({ tile }): a tile that can be a start is where you start, the map and the groups' dice as before; one that cannot
// (water, a hive, a group's base; in a normal start also a town or a city, or within START_CLEAR tiles of one, a hive
// or a group's base) leaves the dice's start.
// The normal start's hub is out in the open (2026-10-22): never in a town or a city, START_CLEAR tiles or more from them
// and the hives, named for the nearest town.
// Usage: node tools/startpicktest.js [seeds...]
import { createWorld, tickHour } from "../src/sim/world.js";
import { playerTile } from "../src/sim/hardcore-start.js";
import { startWhyNot, startNear, isSettlementTile, START_CLEAR } from "../src/sim/startpick.js";

const seeds = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 2, 3, 4, 5];
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const mapKey = (st) => st.tiles.map((t) => `${t.terrain}${t.loc ? t.loc.type + t.loc.name : ""}${t.hive ? "H" : ""}`).join("|");

for (const mode of ["normal", "hardcore"]) {
  console.log(`${mode}`);
  for (const seed of seeds) {
    const base = createWorld({ seed, factionCount: 7, mode });
    const again = createWorld({ seed, factionCount: 7, mode, start: null });
    check(playerTile(base) === playerTile(again) && base.factions.length === again.factions.length, `seed ${seed}: no start, same world`);
    const was = playerTile(base);
    const moved = createWorld({ seed, factionCount: 7, mode, start: { roll: 12345 + seed, not: was } });
    const now = playerTile(moved);
    check(mapKey(base) === mapKey(moved), `seed ${seed}: the map is the same`);
    check(now !== was, `seed ${seed}: the start moved (${was} -> ${now})`);
    check(moved.startRoll === 12345 + seed, `seed ${seed}: the roll is kept on the state`);
    const twice = createWorld({ seed, factionCount: 7, mode, start: { roll: 12345 + seed, not: was } });
    check(playerTile(twice) === now, `seed ${seed}: the same roll gives the same spot`);
    if (mode === "normal") {
      check(moved.bases[0].type === "hub" && !isSettlementTile(moved.tiles[now]) && !startWhyNot(moved, now), `seed ${seed}: the hub is out in the open, clear of the towns, cities, hives and groups (${startWhyNot(moved, now)})`);
      check(!startWhyNot(base, was), `seed ${seed}: the dice's own start keeps clear too (${startWhyNot(base, was)})`);
      check(moved.grid.distance(now, moved.originId) >= 12, `seed ${seed}: away from the outbreak origin`);
      check(moved.survivors.length === 6, `seed ${seed}: six colonists`);
    } else check(moved.survivors.length === base.survivors.length, `seed ${seed}: the same head count`);
    // Pick start on map: the farthest tile that can be a start, from where the dice put you.
    const pickable = base.tiles.filter((t) => t.id !== was && !startWhyNot(base, t.id));
    check(pickable.length > 0, `seed ${seed}: somewhere else to pick`);
    const far = pickable.reduce((a, t) => (base.grid.distance(was, t.id) > base.grid.distance(was, a.id) ? t : a), pickable[0]);
    const picked = createWorld({ seed, factionCount: 7, mode, start: { tile: far.id } });
    check(playerTile(picked) === far.id, `seed ${seed}: the picked tile is the start (${far.id} -> ${playerTile(picked)})`);
    check(mapKey(base) === mapKey(picked), `seed ${seed}: the map is the same with a picked start`);
    check(picked.startTile === far.id, `seed ${seed}: the picked tile is kept on the state`);
    if (mode === "normal") check(/ Holdout$/.test(picked.bases[0].name) && picked.tiles.some((t) => t.loc && (t.loc.type === "town" || t.loc.type === "city") && picked.bases[0].name === `${t.loc.name} Holdout`), `seed ${seed}: the hub is named for a town (${picked.bases[0].name})`);
    const water = base.tiles.find((t) => t.terrain === "water");
    if (water) {
      check(!!startWhyNot(base, water.id), `seed ${seed}: water cannot be a start`);
      check(playerTile(createWorld({ seed, factionCount: 7, mode, start: { tile: water.id } })) === was, `seed ${seed}: a pick on water leaves the dice's start`);
    }
    // Normal mode: no start in a town or a city, nor within START_CLEAR tiles of one, a hive or another group's base.
    // Hardcore keeps its own rule (any open land but a hive or a group's base).
    if (mode === "hardcore") {
      const nearHive = base.tiles.find((t) => t.hive) && base.grid.within(base.tiles.find((t) => t.hive).id, 2).map((id) => base.tiles[id]).find((t) => !t.hive && t.terrain !== "water" && t.terrain !== "mountain" && !base.factions.some((f) => f.bases.includes(t.id)) && !(base.militaryIds || []).includes(t.id));
      if (nearHive) check(!startWhyNot(base, nearHive.id), `seed ${seed}: hardcore: open land beside a hive can still be a start`);
    } else {
    const town = base.tiles.find((t) => t.loc && t.loc.type === "town");
    if (town) {
      check(!!startWhyNot(base, town.id), `seed ${seed}: a town cannot be a start`);
      const near = base.grid.within(town.id, START_CLEAR - 1).map((id) => base.tiles[id]).find((t) => t.terrain !== "water" && t.terrain !== "mountain" && !t.hive && !isSettlementTile(t));
      if (near) check(/Too close to/.test(startWhyNot(base, near.id)), `seed ${seed}: ${base.grid.distance(town.id, near.id)} tiles from a town is too close (${startWhyNot(base, near.id)})`);
    }
    const hive = base.tiles.find((t) => t.hive);
    if (hive) check(base.grid.within(hive.id, START_CLEAR - 1).every((id) => !!startWhyNot(base, id)), `seed ${seed}: nothing within ${START_CLEAR - 1} tiles of a hive`);
    const theirs = base.factions.flatMap((f) => f.bases || []);
    check(theirs.every((b) => base.grid.within(b, START_CLEAR - 1).every((id) => !!startWhyNot(base, id))), `seed ${seed}: nothing within ${START_CLEAR - 1} tiles of a group's base`);
    check(pickable.every((t) => !startNear(base).has(t.id) && !isSettlementTile(t)), `seed ${seed}: every pickable tile is ${START_CLEAR}+ tiles clear`);
    }
    let ok = true;
    try { for (let h = 0; h < 48; h++) tickHour(picked); for (let h = 0; h < 48; h++) tickHour(moved); } catch (e) { ok = false; console.log(e); }
    check(ok, `seed ${seed}: two days run`);
  }
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
