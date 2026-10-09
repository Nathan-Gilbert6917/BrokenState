// Calibration of the core battle (hivecrawl.js: the Hivemind, the Broodmother and the brood) by the hive's tier: the
// rifle squad (6 fighters, assault rifles + plate, Shooting 10; with headlamps or without) against a hive with a guard
// of 80 at tier 2 and tier 4, played headless by the AI on both sides (as the autopilot's core fight).
// Usage: node tools/hivecorecalib.js [trials=24] [lights=1|0] [tiers=2,4]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { ensureHives } from "../src/sim/hives.js";
import { makeHorde } from "../src/sim/hordes.js";
import { hiveTier } from "../src/sim/hivetech.js";
import * as HC from "../src/sim/hivecrawl.js";

const TRIALS = Number(process.argv[2] || 24);
const LIGHTS = process.argv[3] == null ? 1 : Number(process.argv[3]);
const TIERS = (process.argv[4] || "2,4").split(",").map(Number);
const DAY = { 0: 0, 1: 400, 2: 900, 3: 1600, 4: 2100 };
export function coreTrial(seed, tier, { lights = true, n = 6, weapon = "ar", armor = "plate", shoot = 10 } = {}) {
  const st = createWorld({ seed, factionCount: 3 });
  st.started = true;
  ensureHives(st);
  const hv = st.hives[0];
  st.hour = DAY[tier] * 24; hv.born = 0;
  makeHorde(st, { tile: hv.tile, size: 80, role: "guard", hive: hv.id, target: hv.tile });
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(st, 1);
    s.traits = []; s.skills.shooting = shoot; s.health = 100;
    s.gear.weapon = { key: weapon, name: GEAR[weapon].name, quality: 1 };
    s.gear.armor = armor ? { key: armor, name: GEAR[armor].name, quality: 1 } : null;
    if (lights) s.pockets = [{ key: "headlamp", name: GEAR.headlamp.name, quality: 1 }, null, null, null];
    st.survivors.push(s); people.push(s);
  }
  const p = { id: 77000 + seed, owner: "player", kind: "expedition", mission: "hive", members: people.map((s) => s.id), supplies: { ammo: 240, meds: 6, food: 10, water: 10 }, cargo: { supplies: {}, gear: [] },
    path: [hv.tile], idx: 0, dest: hv.tile, phase: "engaged", seen: new Map(), spotted: new Map(), homeBaseId: hub(st).id, orders: [], stance: "normal" };
  for (const s of people) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  const t = hiveTier(st, hv);
  const hp = HC.coreForce(st, hv).hp;
  let phase2 = false;
  const log0 = st.log.length;
  HC.assaultHive(st, p, hv);
  phase2 = !!st.lastHivemindPhase2;
  return { won: !st.hives.includes(hv), dead: people.filter((s) => !s.alive).length, tier: t, hp, phase2 };
}
if (process.argv[1] && process.argv[1].endsWith("hivecorecalib.js")) {
  const t0 = Date.now();
  for (const tier of TIERS) {
    let won = 0, dead = 0, p2 = 0, tt = -1;
    for (let i = 0; i < TRIALS; i++) { const r = coreTrial(100 + i, tier, { lights: !!LIGHTS }); won += r.won; dead += r.dead; p2 += r.phase2; tt = r.tier; }
    console.log(`tier ${tier} (hiveTier ${tt}), ${LIGHTS ? "headlamps" : "no lights"}: won ${Math.round((won / TRIALS) * 100)}% (${won}/${TRIALS}), ${(dead / TRIALS).toFixed(2)} dead a battle, phase 2 in ${p2}`);
  }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
