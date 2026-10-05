// Risk against reward of scavenging, by kind of site: what a team of three brings back (the value of the supplies and
// gear that made it into the cargo, data.js values) and what it costs (deaths, the share of raids anyone got out of),
// on the raid map played by the bot (inside a building or on the street map) and in the hour-by-hour search
// (headless, "normal" approach, out at Heat 50 or after 6 hours). Sites are grouped by where they stand: city
// blocks (urban), small towns, the countryside, and the open wilds; city sites should pay most and cost most.
// Usage: node tools/riskreward.js [raids per site] [seed]
import { createWorld, hub, atBase, supplyValue } from "../src/sim/world.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler } from "../src/sim/combat.js";
import { raidEnemies, startScavenge, searchHour, extract } from "../src/sim/scavenge.js";
import { GEAR, SUPPLIES } from "../src/sim/data.js";

const N = Number(process.argv[2] || 8);
const SEED = Number(process.argv[3] || 11);
registerCombatHandler("rr", () => {});
const t0 = performance.now();
const SITES = {
  city: ["city", "hospital", "pharmacy", "supermarket", "police", "apartments", "school"],
  town: ["town", "grocery", "gas", "church", "clinic", "diner", "motel"],
  rural: ["farm", "barn", "cabin", "ranch", "lodge", "campground"],
  wilds: [null],
};
const cargoValue = (p) => supplyValue(p.cargo.supplies) + p.cargo.gear.reduce((a, g) => a + ((GEAR[g.key] && GEAR[g.key].value) || 0), 0);
void SUPPLIES;

function setup(seed, type, zone) {
  const st = createWorld({ seed, factionCount: 6 });
  st.cards.length = 0;
  const h = hub(st);
  const tile = st.tiles.find((t) => (type ? t.loc && t.loc.type === type && (!zone || zoneOf(t) === zone) : !t.loc && t.terrain === "forest") && t.id !== h.tile);
  if (!tile) return null;
  const crew = atBase(st, h.id).slice(0, 3);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 4, water: 4, ammo: 30, meds: 2 } });
  if (res.error) return null;
  const p = res.party;
  p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
  return { st, p, tile, crew };
}
const zoneOf = (t) => (t.loc && t.loc.zone) || null;
const ZONE_OF_GROUP = { city: "urban", town: "town", rural: "rural" };

function tactical(seed, type, group, street = false) {
  const s = setup(seed, type, ZONE_OF_GROUP[group]);
  if (!s) return null;
  const { st, p, tile } = s;
  const v0 = cargoValue(p);
  st.combat = createBattle(st, { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "rr", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st, tile.id) }, raid: { heat0: 5, choose: !street, building: street ? "street" : undefined }, context: {} });
  if (street && st.combat.raid.interior) return null; // a single-building site has no street map
  let g = 0;
  while (!st.combat.over && g++ < 200) { autoPlayerTurn(st); runEnemyPhase(st); }
  const b = st.combat;
  if (!b.over) return null;
  const out = b.result.outcome === "extracted";
  return { mode: b.raid.interior ? "inside" : "street", value: out ? cargoValue(p) - v0 : 0, dead: b.result.survivorsDead.length, out: out ? 1 : 0, danger: tile.infection };
}

function headless(seed, type, group) {
  const s = setup(seed, type, ZONE_OF_GROUP[group]);
  if (!s) return null;
  const { st, p, crew } = s;
  const v0 = cargoValue(p);
  if (!startScavenge(st, p)) return null;
  const e = st.engagement;
  e.approach = "normal";
  for (let h = 0; h < 6 && st.engagement && !e.done; h++) {
    searchHour(st);
    if (e.heat >= 50) break;
  }
  if (st.engagement && !e.done) extract(st);
  const alive = crew.filter((x) => x.alive).length;
  return { mode: "search", value: st.parties.includes(p) ? cargoValue(p) - v0 : 0, dead: crew.length - alive, out: alive ? 1 : 0 };
}

const rows = [];
for (const [group, types] of Object.entries(SITES)) {
  for (const type of types) {
    const acc = {};
    for (let i = 0; i < N; i++) {
      for (const r of [tactical(SEED * 1000 + i, type, group), tactical(SEED * 1000 + i, type, group, true), headless(SEED * 1000 + i, type, group)]) {
        if (!r) continue;
        const a = (acc[r.mode] = acc[r.mode] || { n: 0, value: 0, dead: 0, out: 0 });
        a.n++; a.value += r.value; a.dead += r.dead; a.out += r.out;
      }
    }
    for (const [mode, a] of Object.entries(acc)) rows.push({ group, type: type || "forest", mode, ...a });
  }
}
const fmt = (a) => `n ${String(a.n).padStart(3)}  value ${String(Math.round(a.value / a.n)).padStart(4)}  (${String(a.out ? Math.round(a.value / a.out) : "-").padStart(4)} a time out)  deaths ${(a.dead / a.n).toFixed(2)}  got out ${String(Math.round((a.out / a.n) * 100)).padStart(3)}%`;
console.log("By site type");
for (const r of rows) console.log(`  ${r.group.padEnd(5)} ${r.type.padEnd(12)} ${r.mode.padEnd(6)} ${fmt(r)}`);
console.log("By group (all site types together)");
for (const group of Object.keys(SITES)) for (const mode of ["inside", "street", "search"]) {
  const list = rows.filter((r) => r.group === group && r.mode === mode);
  if (!list.length) continue;
  const a = list.reduce((s, r) => ({ n: s.n + r.n, value: s.value + r.value, dead: s.dead + r.dead, out: s.out + r.out }), { n: 0, value: 0, dead: 0, out: 0 });
  console.log(`  ${group.padEnd(5)} ${mode.padEnd(6)} ${fmt(a)}`);
}
console.log(`(${Math.round(performance.now() - t0)} ms)`);
