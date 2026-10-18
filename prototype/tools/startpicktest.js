// Headless checks for New start position (sim/startpick.js): a start of its own on the same seed keeps the map (terrain,
// sites, hives) and moves where you start (the hub's town in a normal start, the roadside tile in Hardcore) away from
// the one before; the same roll always gives the same spot; with no start the world is exactly the seed's as before;
// the new spot still keeps the usual distance from the outbreak origin; and the world still ticks.
// Usage: node tools/startpicktest.js [seeds...]
import { createWorld, tickHour } from "../src/sim/world.js";
import { playerTile } from "../src/sim/hardcore-start.js";

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
      check(moved.bases[0].type === "hub" && moved.tiles[now].loc && moved.tiles[now].loc.type === "town", `seed ${seed}: the hub is in a town`);
      check(moved.grid.distance(now, moved.originId) >= 12, `seed ${seed}: away from the outbreak origin`);
      check(moved.survivors.length === 6, `seed ${seed}: six colonists`);
    } else check(moved.survivors.length === base.survivors.length, `seed ${seed}: the same head count`);
    let ok = true;
    try { for (let h = 0; h < 48; h++) tickHour(moved); } catch (e) { ok = false; console.log(e); }
    check(ok, `seed ${seed}: two days run`);
  }
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
