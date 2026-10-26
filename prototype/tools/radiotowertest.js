// Radio towers a base can power with generators to extend its radio range (issue #54 of the round-2 epic #39; the
// user's request 2026-10-26: "radio tower(can have a base turn it on with generators to extend radio communications
// further)"). src/sim/radiotowerlayout.js (the dozen plans), src/sim/radiotower.js (the base feature).
// - The building type: 12+ plans through the shared picker, each its own plan (tools/plansig.js), every one with a
//   transmitter room and a generator shed, the mast's climbable tower cells outside (the rooftop's lookout its roof
//   floor), the fence, the drums; a new save's radio tower site opens it, an older save keeps the transmitter hut.
// - Range with and without the tower: a powered tower reaches TOWER.RANGE from its tile, a tile out of the station's
//   reach comes into coverage, and back out when it is off.
// - Fuel: TOWER.FUEL a day, paid when switched on and at each day's turn, never below the reserve.
// - Loss of power: no fuel → dark ("out of fuel") and back on the air when fuel comes; the generator broken → dark; a
//   found generator carried to its shed powers it again; no station → dark.
// - Raided or sabotaged: an overrun raid wrecks it, the repair's bill; a hostile group near it sabotages it.
// - The groups' towers (AI parity): a group base on a tower's tile with a station and a generator runs it, its network
//   reaching TOWER.RANGE there, their fuel burned.
// - The UI's words: the ring's label, the base panel's line and its buttons.
// Usage: node tools/radiotowertest.js [seed]
import { createWorld, hub, RADIO_RANGE } from "../src/sim/world.js";
import { Rng } from "../src/sim/rng.js";
import { BUILDINGS, assemble, realScale, siteBuildings } from "../src/sim/buildingmaps.js";
import { variantsOf } from "../src/sim/variantpick.js";
import { TOWER_PLANS } from "../src/sim/radiotowerlayout.js";
import { TOWER, towersNear, claimTower, setTower, towerStatus, towerDaily, installGen, removeGen, repairTower, towerRaided, groupTowersDaily, towerLine, towerTiles } from "../src/sim/radiotower.js";
import { radioNodes, inCoverage, groupNetwork } from "../src/sim/radio.js";
import { yourRadioRings } from "../src/sim/radioallies.js";
import { addBuilding } from "../src/sim/buildings.js";
import { makeItem } from "../src/sim/crafting.js";
import { worksAt, groupsBuild } from "../src/sim/groupworks.js";
import { planSignature } from "./plansig.js";
import { PLACEMENT } from "../src/sim/data-placement.js";
import { LOOT_SENSE } from "../src/sim/lootsense.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const t0 = Date.now();

console.log("The building type: a dozen plans");
{
  const list = variantsOf("radiotower");
  check(list.length >= 12 && new Set(list.map((e) => e.id)).size === list.length, `${list.length} plans registered with the shared picker, ids unique`);
  const sigs = new Set();
  for (const p of TOWER_PLANS) {
    let ok = true, why = [];
    for (let s = 1; s <= 3; s++) {
      const r = new Rng(seed * 31 + s);
      const sp = realScale(r, BUILDINGS.radiotower.make(r, { plan: p.id }), "radiotower", { setting: "rural" });
      const m = assemble(new Rng(seed + s), sp, { key: "radiotower", name: "Radio tower" });
      if (sp.vid !== p.id || sp.vname !== p.name || m.vname !== p.name) { ok = false; why.push("vid/vname"); }
      const rooms = m.rooms.filter((a) => !a.outdoor);
      if (!rooms.some((a) => a.type === "txroom")) { ok = false; why.push("no transmitter room"); }
      if (!rooms.some((a) => a.type === "genshed")) { ok = false; why.push("no generator shed"); }
      if (!m.rooms.some((a) => a.type === "eqshelter")) { ok = false; why.push("no equipment shelter"); }
      if (!m.rooms.some((a) => a.outdoor && a.name === "Fuel store")) { ok = false; why.push("no fuel drums"); }
      if (p.fence && !m.cells.some((c) => c.k === "wirefence" || c.k === "fence")) { ok = false; why.push("no fence"); }
      const towers = m.cells.filter((c) => c.k === "tower").length;
      if (p.mast && !towers) { ok = false; why.push("no mast"); }
      if (!p.mast && (m.storeys || 1) < 3) { ok = false; why.push("a rooftop of under 3 storeys"); }
      if (!m.containers.length) { ok = false; why.push("no containers"); }
      if (s === 1) sigs.add(planSignature(m, sp.foot || null).key);
    }
    const has = `transmitter room, generator shed, equipment shelter, fuel drums${p.fence ? ", the fence" : ""}, ${p.mast ? "the mast's tower cells (a lookout)" : "its roof floor the lookout"}`;
    check(ok, `${p.name}: ${ok ? has : why.join(", ")}`);
  }
  check(sigs.size >= 12, `${sigs.size} distinct plans by their signature (rooms, doors, entrances, footprint)`);
  check(!!PLACEMENT.radiotower && PLACEMENT.radiotower.at.highway > 0 && PLACEMENT.radiotower.at.city > 0 && PLACEMENT.radiotower.at.scenic > 0, "placed on the hills, by the highways and in the cities (data-placement.js)");
  check(!!LOOT_SENSE.radiotower && LOOT_SENSE.radiotower.sig.parts > 0 && LOOT_SENSE.radiotower.sig.fuel > 0, "its loot row (lootsense.js): parts and electronics, fuel");
}

// A world: the hub with a radio station, a tower two tiles off (a radio tower point of interest put there).
const st = createWorld({ seed, factionCount: 6 });
st.started = true; st.visitorsOff = true; st.noWanderers = true;
const h = hub(st);
h.radio = true;
const g = st.grid;
const spot = g.within(h.tile, 2).find((id) => id !== h.tile && g.distance(id, h.tile) === 2 && st.tiles[id].terrain !== "water" && !st.tiles[id].loc);
st.tiles[spot].pois = [...(st.tiles[spot].pois || []), { kind: "radiotower", name: "Test mast", extra: "place" }];
delete st._towerTiles;

console.log("The site and older saves");
{
  const t = st.tiles.find((x) => x.loc && x.loc.type === "radiotower");
  if (t) {
    const sb = siteBuildings(t, st);
    check(sb && sb.options[0].key === "radiotower", `a new save's radio tower site opens the tower compound (${sb && sb.options[0].key})`);
    const old = { ...st, towerLegacy: true };
    const so = siteBuildings(t, old);
    check(so && so.options[0].key === "radio", `an older save's keeps its transmitter hut (${so && so.options[0].key})`);
    check(towersNear(old, h).length === 0 && claimTower(old, h).startsWith("There are no radio towers"), "an older save: no tower to claim");
  } else check(true, "(no radio tower site on this map)");
  check(towerTiles(st).includes(spot), "the tower point of interest is found (towerTiles)");
}

console.log("Claiming and turning it on");
{
  check(towersNear(st, h).includes(spot), `the hub can claim the tower ${g.distance(spot, h.tile)} tiles away`);
  const L0 = towerLine(st, h);
  check(L0 && L0.acts[0].act === "claim", `the base panel offers to claim it: "${L0 && L0.text}"`);
  const msg = claimTower(st, h, spot);
  check(h.tower && h.tower.tile === spot, `claimed: "${msg}"`);
  h.buildings = h.buildings.filter((b) => b.type !== "generator");
  h.stock.fuel = 10;
  check(setTower(st, h, true).startsWith("No generator") && !towerStatus(st, h).live, "no generator: it will not turn on");
  addBuilding(h, "generator");
  const gen = h.buildings.find((b) => b.type === "generator");
  h.radio = false;
  check(setTower(st, h, true).includes("no radio station") && !towerStatus(st, h).live, "no radio station at the base: nothing to put on the mast");
  h.radio = true;
}

console.log("Range with and without the tower");
{
  // A tile out of the station's reach but within the tower's.
  const far = g.within(spot, TOWER.RANGE).find((id) => g.distance(id, spot) === TOWER.RANGE - 2 && g.distance(id, h.tile) > RADIO_RANGE + 6);
  check(!!far && !inCoverage(st, far), `without the tower: a tile ${far != null ? g.distance(far, h.tile) : "?"} tiles off is out of coverage`);
  const before = (h.stock.fuel || 0);
  const m = setTower(st, h, true);
  check(towerStatus(st, h).live, `turned on: "${m}"`);
  check(Math.abs(before - TOWER.FUEL - h.stock.fuel) < 1e-6, `the day's fuel paid on switching on (${before} → ${h.stock.fuel})`);
  const node = radioNodes(st).find((n) => n.kind === "tower");
  check(node && node.tile === spot && node.range === TOWER.RANGE && node.linked, `a transmitter at the tower's tile reaching ${node && node.range} tiles`);
  check(far != null && inCoverage(st, far), "with the tower: that tile is in coverage");
  const ring = yourRadioRings(st).find((n) => n.kind === "tower");
  check(ring && ring.label === `Your radio tower: ${TOWER.RANGE} tiles`, `its ring on the Radio layer: "${ring && ring.label}"`);
  const L = towerLine(st, h);
  check(L && /on the air/.test(L.text) && L.acts.some((a) => a.act === "off"), `the base panel: "${L && L.text}"`);
  setTower(st, h, false);
  check(!towerStatus(st, h).live && !inCoverage(st, far) && !radioNodes(st).some((n) => n.kind === "tower"), "switched off: the station's reach again");
  setTower(st, h, true);
}

console.log("Fuel by the day");
{
  h.stock.fuel = 7; h.genReserve = null;
  st.hour += 24;
  towerDaily(st);
  check(Math.abs(h.stock.fuel - (7 - TOWER.FUEL)) < 1e-6 && towerStatus(st, h).live, `a day on the air burns ${TOWER.FUEL} (7 → ${h.stock.fuel})`);
  towerDaily(st);
  check(Math.abs(h.stock.fuel - (7 - TOWER.FUEL)) < 1e-6, "paid once a day only");
  h.genReserve = { n: h.stock.fuel - 1, by: "player" };
  st.hour += 24;
  towerDaily(st);
  check(!towerStatus(st, h).live && /fuel/i.test(towerStatus(st, h).why) && Math.abs(h.stock.fuel - (7 - TOWER.FUEL)) < 1e-6, `never below the reserve: dark (${towerStatus(st, h).why})`);
  check(st.log.some((e) => /went dark/.test(e.text || e.msg || String(e))), "the log says it went dark");
  h.genReserve = null; h.stock.fuel = 0;
  st.hour += 24;
  towerDaily(st);
  check(!towerStatus(st, h).live && !radioNodes(st).some((n) => n.kind === "tower"), "out of fuel: dark, the tower's coverage gone");
  h.stock.fuel = 6;
  st.hour += 24;
  towerDaily(st);
  check(towerStatus(st, h).live && Math.abs(h.stock.fuel - (6 - TOWER.FUEL)) < 1e-6, "fuel back: on the air again the next day");
}

console.log("Loss of power");
{
  const gen = h.buildings.find((b) => b.type === "generator");
  gen.broken = true;
  check(!towerStatus(st, h).live && /generator/i.test(towerStatus(st, h).why), `the generator broken: dark (${towerStatus(st, h).why})`);
  h.armory.push(makeItem("genset_house", 0.9));
  const m = installGen(st, h);
  check(h.tower.gen && towerStatus(st, h).live, `a found generator carried to its shed powers it: "${m}"`);
  const n = h.armory.filter((it) => it && it.key === "genset_house").length;
  removeGen(st, h);
  check(!h.tower.gen && h.armory.filter((it) => it && it.key === "genset_house").length === n + 1 && !towerStatus(st, h).live, "taken back into the stores: dark again");
  gen.broken = false;
  check(towerStatus(st, h).live, "the generator repaired: back on the air");
}

console.log("Raided and sabotaged");
{
  check(towerRaided(st, h, "held", "k1") === "" && !h.tower.wrecked, "a raid held off: the tower stands");
  const t = towerRaided(st, h, "overrun", "k2");
  check(h.tower.wrecked && !towerStatus(st, h).live && /wrecked/.test(t), `an overrun raid wrecks it: "${t}"`);
  h.stock.parts = 0; h.stock.electronics = 0;
  check(/short/.test(repairTower(st, h)) && h.tower.wrecked, "the repair needs its parts");
  h.stock.parts = TOWER.REPAIR.parts; h.stock.electronics = TOWER.REPAIR.electronics;
  repairTower(st, h);
  check(!h.tower.wrecked && towerStatus(st, h).live && h.stock.parts === 0 && h.stock.electronics === 0, "repaired: back on the air, its bill paid");
  const foe = st.factions.find((f) => f.alive && f.bases.length);
  const was = { gw: foe.goodwill, bases: foe.bases.slice(), sab: TOWER.SABOTAGE, max: TOWER.SAB_MAX };
  foe.goodwill = -80; foe.bases = [spot, ...foe.bases];
  TOWER.SABOTAGE = 1; TOWER.SAB_MAX = 1;
  h.stock.fuel = 10;
  st.hour += 24;
  towerDaily(st);
  check(h.tower.wrecked, "a hostile group next to it sabotages it");
  Object.assign(foe, { goodwill: was.gw, bases: was.bases }); TOWER.SABOTAGE = was.sab; TOWER.SAB_MAX = was.max;
  h.tower.wrecked = false;
}

console.log("The groups' towers (AI parity)");
{
  const f = st.factions.find((x) => x.alive && x.bases.length && x.type !== "military" && !x.hcSplinter && groupsBuild(st, x));
  if (f) {
    const tile = f.bases[0];
    st.tiles[tile].pois = [...(st.tiles[tile].pois || []), { kind: "radiotower", name: "Their mast", extra: "place" }];
    delete st._towerTiles;
    const w = worksAt(f, tile);
    w.radio = 1; w.power = 0;
    f.stock.fuel = 10;
    groupTowersDaily(st);
    check(!(f.towersOn && f.towersOn[tile]), "no generator: their tower stays dark");
    w.power = 1;
    groupTowersDaily(st);
    const net = groupNetwork(st, f), node = net && net.nodes.find((n) => n.tile === tile);
    check(f.towersOn && f.towersOn[tile] && node && node.range === TOWER.RANGE, `with a station and a generator they run it: their network reaches ${node && node.range} tiles there`);
    check(Math.abs(f.stock.fuel - (10 - TOWER.FUEL)) < 1e-6, `their fuel burned (${f.stock.fuel})`);
    f.stock.fuel = 0;
    groupTowersDaily(st);
    const n2 = groupNetwork(st, f), node2 = n2 && n2.nodes.find((n) => n.tile === tile);
    check(!(f.towersOn && f.towersOn[tile]) && node2 && node2.range === RADIO_RANGE, "out of fuel: back to their station's reach");
  } else check(true, "(no building group on this map)");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
