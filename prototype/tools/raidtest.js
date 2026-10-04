// Headless raid test: runs many interactive scavenging raids with the AI playing your team.
// Usage: node tools/raidtest.js [raidsPerSite] [seed] [all] [kit] [night]
//   all: every site type in data.js LOCATIONS; kit: everyone carries 2 bottles and a noise maker, a flashlight in
//   the off hand, and the first gun that takes one a suppressor (the bot throws them, stealth.js botStealth);
//   night: the raids start at 22:00 (short sight, searching in the dark).
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, partyTile } from "../src/sim/parties.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler, finishCombat } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { LOCATIONS } from "../src/sim/data.js";
import { newItem, stow } from "../src/sim/inventory.js";
import { SUPPRESSIBLE } from "../src/sim/stealth.js";

const per = Number(process.argv[2] || 20);
const seed = Number(process.argv[3] || 7);
const KIT = process.argv.includes("kit"), NIGHT = process.argv.includes("night");
const kitStats = { thrown: 0, takedowns: 0, tied: 0, suppressed: 0, prisoners: 0 };
const stats = {};
let crashes = 0, timeouts = 0, battles = 0;
const t0 = performance.now();
registerCombatHandler("test", () => {});

const SITES = process.argv[4] === "all" ? [...Object.keys(LOCATIONS), null]
  : ["town", "city", "military", "farm", "gas", "hospital", "police", "autoshop", "pharmacy", "gunstore", "school", "church", "cabin", "truckstop", null];
for (const siteType of SITES) {
  const key = siteType || "wilds";
  const s = (stats[key] = { raids: 0, out: 0, wiped: 0, deaths: 0, searched: 0, total: 0, turns: 0, kept: 0, withVehicle: 0, loot: {} });
  for (let i = 0; i < per; i++) {
    const state = createWorld({ seed: seed * 1000 + i, factionCount: 7 });
    const h = hub(state);
    const tile = state.tiles.find((t) => (siteType ? t.loc && t.loc.type === siteType : !t.loc && t.terrain === "forest" && t.road)) ||
      state.tiles.find((t) => t.loc && t.id !== h.tile);
    const crew = atBase(state, h.id).slice(0, 3).map((x) => x.id);
    if (NIGHT) state.hour += 16; // 22:00 on day 1
    if (KIT) {
      let sup = false;
      for (const s of atBase(state, h.id).slice(0, 3)) {
        for (const k of ["bottle", "bottle", "noisemaker"]) stow(s, newItem(k));
        if (!s.gear.tool) s.gear.tool = newItem("flashlight");
        if (!sup && s.gear.weapon && SUPPRESSIBLE.includes(s.gear.weapon.key)) { stow(s, newItem("suppressor")); sup = true; }
      }
    }
    const useVehicle = i % 2 === 0;
    const res = launchExpedition(state, { memberIds: crew, dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: useVehicle ? state.vehicles[0].id : null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const groups = raidEnemies(state, tile.id);
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "test", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5 }, context: {} };
    try {
      state.combat = createBattle(state, setup);
      let guard = 0;
      while (!state.combat.over && guard++ < 200) {
        autoPlayerTurn(state);
        runEnemyPhase(state);
      }
      battles++;
      const b = state.combat;
      if (!b.over) { timeouts++; continue; }
      for (const l of b.log) {
        if (/ throws /.test(l.text)) kitStats.thrown++;
        if (/ takes .* down/.test(l.text)) kitStats.takedowns++;
        if (/ ties up /.test(l.text)) kitStats.tied++;
        if (/muffled/.test(l.text)) kitStats.suppressed++;
      }
      kitStats.prisoners += (b.result.prisoners || []).length;
      const r = b.result;
      s.raids++;
      if (r.outcome === "extracted") s.out++; else s.wiped++;
      s.deaths += r.survivorsDead.length;
      s.searched += r.raid.searched;
      s.total += r.raid.total;
      s.turns += r.turns;
      if (r.raid.hadVehicle) { s.withVehicle++; if (r.raid.vehicleKept) s.kept++; }
      for (const [k, v] of Object.entries(r.loot.supplies)) s.loot[k] = (s.loot[k] || 0) + v;
      s.gear = (s.gear || 0) + r.loot.gear.length;
      finishCombat(state, setup, r);
    } catch (e) {
      crashes++;
      if (crashes < 4) console.error(key, e.stack);
    }
  }
}
for (const [k, s] of Object.entries(stats)) {
  if (!s.raids) continue;
  const avg = (v) => (v / s.raids).toFixed(1);
  console.log(`${k.padEnd(9)} raids ${s.raids}  got out ${Math.round((s.out / s.raids) * 100)}%  deaths/raid ${avg(s.deaths)}  searched ${avg(s.searched)}/${avg(s.total)}  turns ${avg(s.turns)}  vehicle kept ${s.kept}/${s.withVehicle}  loot/raid ${Object.entries(s.loot).map(([kk, v]) => `${kk} ${avg(v)}`).join(", ")}, gear ${avg(s.gear || 0)}`);
}
console.log(`\nStealth kit${KIT ? "" : " (none carried; add kit)"}${NIGHT ? ", night raids" : ""}: ${kitStats.thrown} throws, ${kitStats.takedowns} takedowns, ${kitStats.tied} tied up, ${kitStats.suppressed} muffled volleys, ${kitStats.prisoners} prisoners taken out.`);
console.log(`${battles} raids in ${((performance.now() - t0) / 1000).toFixed(1)}s, ${crashes} crashes, ${timeouts} timeouts.`);
