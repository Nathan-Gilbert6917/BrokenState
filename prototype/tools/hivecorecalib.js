// Calibration of the core battle (hivecrawl.js: the Hivemind, the Broodmother and the brood) by the hive's tier: the
// rifle squad (6 fighters, assault rifles + plate, Shooting 10; with headlamps or without) against a hive with a guard
// of 80 at tier 2 and tier 4, played headless by the AI on both sides (as the autopilot's core fight).
// Usage: node tools/hivecorecalib.js [trials=24] [lights=1|0] [tiers=2,4]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { ensureHives } from "../src/sim/hives.js";
import { makeHorde } from "../src/sim/hordes.js";
import { hiveTier } from "../src/sim/hivetech.js";
import { byNumbersOdds, winOdds } from "../src/sim/combat.js";
import * as HC from "../src/sim/hivecrawl.js";

const TRIALS = Number(process.argv[2] || 24);
const LIGHTS = process.argv[3] == null ? 1 : Number(process.argv[3]);
const TIERS = (process.argv[4] || "2,4").split(",").map(Number);
if (process.env.HP_P2 === "0") HC.HIVEMIND.P2.on = false; // A/B: no second phase
if (process.env.HP_DARK === "0") { HC.HCRAWL.LIGHT.dark = 99; HC.HCRAWL.LIGHT.lit = 99; } // A/B: no darkness on the sight
const DAY = { 0: 0, 1: 400, 2: 900, 3: 1600, 4: 2100 };
export function coreTrial(seed, tier, { lights = true, n = 6, weapon = "ar", armor = "plate", shoot = 10, fire = 0, stun = 0, guard = 80, alt = null, health = 100 } = {}) {
  const st = createWorld({ seed, factionCount: 3 });
  st.started = true;
  ensureHives(st);
  const hv = st.hives[0];
  st.hour = DAY[tier] * 24; hv.born = 0;
  makeHorde(st, { tile: hv.tile, size: guard, role: "guard", hive: hv.id, target: hv.tile });
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(st, 1);
    s.traits = []; s.skills.shooting = shoot; s.health = health;
    const wk = alt && i % 2 ? alt : weapon;
    s.gear.weapon = { key: wk, name: GEAR[wk].name, quality: 1 };
    s.gear.armor = armor ? { key: armor, name: GEAR[armor].name, quality: 1 } : null;
    s.pockets = [lights ? { key: "headlamp", name: GEAR.headlamp.name, quality: 1 } : null, i < fire ? { key: "molotov", name: GEAR.molotov.name, quality: 1 } : null, i >= n - stun ? { key: "flashbang", name: GEAR.flashbang.name, quality: 1 } : null, null];
    st.survivors.push(s); people.push(s);
  }
  const p = { id: 77000 + seed, owner: "player", kind: "expedition", mission: "hive", members: people.map((s) => s.id), supplies: { ammo: 240, meds: 6, food: 10, water: 10 }, cargo: { supplies: {}, gear: [] },
    path: [hv.tile], idx: 0, dest: hv.tile, phase: "engaged", seen: new Map(), spotted: new Map(), homeBaseId: hub(st).id, orders: [], stance: "normal" };
  for (const s of people) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  const t = hiveTier(st, hv);
  const hp = HC.coreForce(st, hv).hp;
  const p20 = HC.HM_STATS.phase2, b0 = HC.HM_STATS.burned, s0 = HC.HM_STATS.stunned;
  const setupN = HC.coreSetup(st, p, hv, true);
  const oN = byNumbersOdds(st, setupN);
  const numbers = oN.win; // the core's odds by the numbers for this squad
  const f = HC.coreForce(st, hv);
  const terms = { mine: oN.mine, S: oN.theirs / (setupN.enemy.count * setupN.enemy.power), count: f.count, n: setupN.enemy.count, power: f.power, bossBase: f.bossPower / HC.HIVEMIND.numbersK, prep: HC.corePrep(st, people, p), enemy: { ...setupN.enemy, people: people.length, ambush: null, hive: true } };
  const gate = HC.coreGate(st, hv, people, undefined).win;
  HC.assaultHive(st, p, hv);
  const phase2 = HC.HM_STATS.phase2 > p20;
  return { won: !st.hives.includes(hv), dead: people.filter((s) => !s.alive).length, tier: t, hp, phase2, burned: HC.HM_STATS.burned > b0, stunned: HC.HM_STATS.stunned > s0, numbers, gate, terms };
}
// The numbers' fit (--fit [trials]): squads × tiers × guards × lit or not × with and without two Molotovs and two
// flashbangs, played on the map; then numbersK and HIVEMIND.NUMBERS (lit, fire, stun) fitted so the core's odds by the
// numbers match the map's (least squares over the configurations' win rates).
export const FIT_SQUADS = { rifle: { n: 6, weapon: "ar", armor: "plate", shoot: 10 }, shotgun: { n: 6, weapon: "shotgun", armor: "vest", shoot: 7 }, hunt: { n: 6, weapon: "huntrifle", armor: "vest", shoot: 6 },
  scrappy: { n: 6, weapon: "shotgun", alt: "pistol", armor: "vest", shoot: 5, health: 80 } }; // the autopilot's teams as the census met them: mixed guns, middling shots, not quite fit
export function predict(t, k) {
  const N = HC.HIVEMIND.NUMBERS;
  const mult = (1 - k.lit * t.prep.lit) * Math.max(0.3, 1 - k.fire * Math.min(1, t.prep.fire / N.kit) - k.stun * Math.min(1, t.prep.stun / N.kit));
  const theirs = t.S * (t.count * t.power + t.bossBase * k.K * mult);
  return winOdds(t.mine / Math.max(0.1, theirs), t.enemy);
}
async function runFit(N) {
  const rows = [];
  for (const [sq, cfg] of Object.entries(FIT_SQUADS)) for (const tier of [1, 2, 4]) for (const guard of [60, 120]) for (const lights of [false, true]) for (const prep of [0, 2]) {
    const trials = [];
    for (let i = 0; i < N; i++) trials.push(coreTrial(300 + i, tier, { ...cfg, lights, fire: prep, stun: prep, guard }));
    const rate = trials.reduce((a, r) => a + r.won, 0) / N;
    rows.push({ sq, tier, guard, lights, prep, rate, terms: trials.map((r) => r.terms) });
    process.stdout.write(".");
  }
  console.log("");
  if (process.env.FIT_SAVE) (await import("node:fs")).writeFileSync(process.env.FIT_SAVE, JSON.stringify(rows));
  return fitRows(rows);
}
export function fitRows(rows, fixed = {}) {
  const loss = (k) => rows.reduce((a, r) => { const p = r.terms.reduce((x, t) => x + predict(t, k), 0) / r.terms.length; return a + (p - r.rate) ** 2; }, 0);
  let k = { K: HC.HIVEMIND.numbersK, lit: HC.HIVEMIND.NUMBERS.lit, fire: HC.HIVEMIND.NUMBERS.fire, stun: HC.HIVEMIND.NUMBERS.stun };
  const span = { K: [0.5, 5, 0.05], lit: [0, 0.7, 0.025], fire: [0, 0.65, 0.025], stun: [0, 0.5, 0.025] };
  for (let pass = 0; pass < 6; pass++) for (const key of Object.keys(span)) {
    if (fixed[key] != null) { k[key] = fixed[key]; continue; }
    let best = k[key], bl = loss(k);
    for (let v = span[key][0]; v <= span[key][1] + 1e-9; v += span[key][2]) { const l = loss({ ...k, [key]: v }); if (l < bl) { bl = l; best = Math.round(v * 1000) / 1000; } }
    k[key] = best;
  }
  const before = { K: HC.HIVEMIND.numbersK, lit: 0, fire: 0, stun: 0 };
  console.log(`fit: numbersK ${k.K}, lit ${k.lit}, fire ${k.fire}, stun ${k.stun}; RMS error ${Math.sqrt(loss(k) / rows.length).toFixed(3)} (numbersK ${before.K} alone: ${Math.sqrt(loss(before) / rows.length).toFixed(3)}; current: ${Math.sqrt(loss({ K: HC.HIVEMIND.numbersK, ...HC.HIVEMIND.NUMBERS }) / rows.length).toFixed(3)})`);
  for (const r of rows) { const p = r.terms.reduce((x, t) => x + predict(t, k), 0) / r.terms.length; console.log(`  ${r.sq.padEnd(8)} t${r.tier} g${r.guard} ${r.lights ? "lit  " : "dark "} ${r.prep ? "prep" : "    "}  map ${String(Math.round(r.rate * 100)).padStart(3)}%  numbers ${String(Math.round(p * 100)).padStart(3)}%`); }
}
if (process.argv[1] && process.argv[1].endsWith("hivecorecalib.js") && process.argv[2] === "--fit") { await runFit(Number(process.argv[3] || 16)); process.exit(0); }
// --refit file [K]: the fit again from saved rows (FIT_SAVE=file on a --fit run), numbersK held at K when given.
if (process.argv[1] && process.argv[1].endsWith("hivecorecalib.js") && process.argv[2] === "--refit") { fitRows(JSON.parse((await import("node:fs")).readFileSync(process.argv[3], "utf8")), process.argv[4] ? { K: Number(process.argv[4]) } : {}); process.exit(0); }
if (process.argv[1] && process.argv[1].endsWith("hivecorecalib.js")) {
  const t0 = Date.now();
  for (const tier of TIERS) {
    let won = 0, dead = 0, p2 = 0, tt = -1;
    for (let i = 0; i < TRIALS; i++) { const r = coreTrial(100 + i, tier, { lights: !!LIGHTS }); won += r.won; dead += r.dead; p2 += r.phase2; tt = r.tier; }
    console.log(`tier ${tier} (hiveTier ${tt}), ${LIGHTS ? "headlamps" : "no lights"}: won ${Math.round((won / TRIALS) * 100)}% (${won}/${TRIALS}), ${(dead / TRIALS).toFixed(2)} dead a battle, phase 2 in ${p2}`);
  }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
