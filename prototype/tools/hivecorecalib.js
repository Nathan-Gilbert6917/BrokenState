// Calibration of the core battle (hivecrawl.js: the Hivemind, the Broodmother and the brood) by the hive's tier: the
// rifle squad (6 fighters, assault rifles + plate, Shooting 10; with headlamps or without) against a hive with a guard
// of 80 at tier 2 and tier 4, played headless by the AI on both sides (as the autopilot's core fight).
// Usage: node tools/hivecorecalib.js [trials=24] [lights=1|0] [tiers=2,4]
//        node tools/hivecorecalib.js --fit [trials=16]   (env FIT_ONLY=rifle,hunt a few squads, FIT_SAVE=file the rows, FIT_NOSTEEP=1 steepness 1)
//        node tools/hivecorecalib.js --refit rows1.json[,rows2.json…] [numbersK]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { GEAR, SUPPLIES } from "../src/sim/data.js";
import { ensureHives } from "../src/sim/hives.js";
import { makeHorde } from "../src/sim/hordes.js";
import { hiveTier } from "../src/sim/hivetech.js";
import { byNumbersOdds, winOdds } from "../src/sim/combat.js";
import * as HC from "../src/sim/hivecrawl.js";
import { settleParty } from "../src/sim/ammo.js";
import { packShells, packMags, CARRY } from "../src/sim/carrykit.js";
import { standardMag } from "../src/sim/mags.js";
import { newItem } from "../src/sim/inventory.js";
import { loadoutRounds } from "../src/sim/gunrounds.js";
import { WEAPONS } from "../src/sim/combat.js";

const TRIALS = Number(process.argv[2] || 24);
const LIGHTS = process.argv[3] == null ? 1 : Number(process.argv[3]);
const TIERS = (process.argv[4] || "2,4").split(",").map(Number);
if (process.env.HP_P2 === "0") HC.HIVEMIND.P2.on = false; // A/B: no second phase
if (process.env.HP_DARK === "0") { HC.HCRAWL.LIGHT.dark = 99; HC.HCRAWL.LIGHT.lit = 99; } // A/B: no darkness on the sight
const DAY = { 0: 0, 1: 400, 2: 900, 3: 1600, 4: 2100 };
export function coreTrial(seed, tier, { lights = true, n = 6, weapon = "ar", armor = "plate", shoot = 10, melee = 0, fire = 0, stun = 0, guard = 80, alt = null, health = 100, packed = process.env.HP_PACK !== "0" } = {}) {
  const st = createWorld({ seed, factionCount: 3 });
  st.started = true;
  ensureHives(st);
  const hv = st.hives[0];
  st.hour = DAY[tier] * 24; hv.born = 0;
  makeHorde(st, { tile: hv.tile, size: guard, role: "guard", hive: hv.id, target: hv.tile });
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(st, 1);
    s.traits = []; s.skills.shooting = shoot; if (melee) s.skills.melee = melee; s.health = health;
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
  settleParty(st, p); // the team's rounds by calibre, and its shotgunners' shells at hand as a trip packs them (carrykit.js packShells)
  if (packed) packShells(p.supplies, people);
  // And the spare magazines a trip packs out of the armory (parties.js launchExpedition, carrykit.js packMags): with
  // physical rounds (mags.js, 2026-10-18) a Reload draws only on what the person carries, the team's bags loading the
  // guns and the spares as the fight starts (no spares: a magazine gun's one magazine a fight).
  if (packed) packMags(people.flatMap((s) => { const mk = standardMag(s.gear.weapon.key); return mk ? Array.from({ length: CARRY.PACK.rifle }, () => newItem(mk)) : []; }), people);
  // And the rounds those guns and magazines leave loaded with, on top of the 240 (parties.js launchExpedition takes
  // them out of the stores as every trip does: gunrounds.js loadoutRounds; here from an ample armory of FMJ).
  if (packed) {
    const stores = {};
    for (const s of people) { const cal = WEAPONS[s.gear.weapon.key] && WEAPONS[s.gear.weapon.key].cal; const k = cal && (SUPPLIES[`a_${cal}_fmj`] ? `a_${cal}_fmj` : Object.keys(SUPPLIES).find((x) => x.startsWith(`a_${cal}_`))); if (k) stores[k] = 1e6; } // (a shotgun's: buckshot)
    for (const [k, q] of Object.entries(loadoutRounds(people, [stores]))) p.supplies[k] = (p.supplies[k] || 0) + q;
  }
  const t = hiveTier(st, hv);
  const hp = HC.coreForce(st, hv).hp;
  const p20 = HC.HM_STATS.phase2, b0 = HC.HM_STATS.burned, s0 = HC.HM_STATS.stunned;
  const setupN = HC.coreSetup(st, p, hv, true);
  const oN = byNumbersOdds(st, setupN);
  const numbers = oN.win; // the core's odds by the numbers for this squad
  const f = HC.coreForce(st, hv);
  const cf = HC.coreFire(people);
  const terms = { mine: oN.mine, mine0: oN.mine / (setupN.mineMult || 1), fire: cf.fire, S: oN.theirs / (setupN.enemy.count * setupN.enemy.power), count: f.count, n: setupN.enemy.count, power: f.power, bossBase: f.bossPower / HC.HIVEMIND.numbersK, tier: f.tier, prep: HC.corePrep(st, people, p), enemy: { ...setupN.enemy, people: people.length, ambush: null, hive: true } };
  const gate = HC.coreGate(st, hv, people, undefined).win;
  HC.assaultHive(st, p, hv);
  const phase2 = HC.HM_STATS.phase2 > p20;
  return { won: !st.hives.includes(hv), dead: people.filter((s) => !s.alive).length, tier: t, hp, phase2, burned: HC.HM_STATS.burned > b0, stunned: HC.HM_STATS.stunned > s0, numbers, gate, terms };
}
// The numbers' fit (--fit [trials]): squads × tiers × guards × lit or not × with and without two Molotovs and two
// flashbangs, played on the map; then numbersK and HIVEMIND.NUMBERS (lit, fire, stun) fitted so the core's odds by the
// numbers match the map's (least squares over the configurations' win rates).
export const FIT_SQUADS = { rifle: { n: 6, weapon: "ar", armor: "plate", shoot: 10 }, shotgun: { n: 6, weapon: "shotgun", armor: "vest", shoot: 7 }, hunt: { n: 6, weapon: "huntrifle", armor: "vest", shoot: 6 },
  scrappy: { n: 6, weapon: "shotgun", alt: "pistol", armor: "vest", shoot: 5, health: 80 }, // the autopilot's teams as the census met them: mixed guns, middling shots, not quite fit
  mixed: { n: 6, weapon: "huntrifle", alt: "shotgun", armor: "vest", shoot: 7 }, melee: { n: 6, weapon: "fireaxe", armor: "vest", shoot: 3, melee: 8 } }; // rifles and shotguns side by side; axes
// The squad kinds the report sums the gap over (rifle, shotgun, melee, mixed: a squad of shotguns with pistols or rifles).
const KIND = { rifle: "rifle", hunt: "rifle", shotgun: "shotgun", scrappy: "mixed", mixed: "mixed", melee: "melee" };
export function predict(t, k) {
  const N = HC.HIVEMIND.NUMBERS;
  let mine = t.mine; // rows saved before coreFire: their team power as it was counted
  if (t.fire && t.mine0 != null) { const tot = t.fire.reduce((a, d) => a + d.p, 0); mine = t.mine0 * (tot > 0 ? t.fire.reduce((a, d) => a + d.p * HC.fireAt(d, k.R, k.m), 0) / tot : 1); }
  const mult = (1 - k.lit * t.prep.lit) * Math.max(k.fl ?? N.floor ?? 0.3, 1 - k.fire * Math.min(1, t.prep.fire / N.kit) - k.stun * Math.min(1, t.prep.stun / N.kit));
  const base = t.bossBase + (k.pt != null && t.tier != null ? (k.pt - HC.HIVEMIND.powerTier) * t.tier : 0); // pt: the bosses' power a tier (HIVEMIND.powerTier)
  const theirs = t.S * (t.count * t.power + base * k.K * mult);
  return winOdds((mine / Math.max(0.1, theirs)) ** (k.g ?? 1), t.enemy);
}
async function runFit(N) {
  const rows = [];
  const only = process.env.FIT_ONLY ? process.env.FIT_ONLY.split(",") : null; // FIT_ONLY=rifle,hunt: those squads (runs split over processes, FIT_SAVE each, --refit a,b,c)
  for (const [sq, cfg] of Object.entries(FIT_SQUADS)) if (!only || only.includes(sq)) for (const tier of [1, 2, 4]) for (const guard of [60, 120]) for (const lights of [false, true]) for (const prep of [0, 2]) {
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
  if (process.env.FIT_NOSTEEP) fixed = { ...fixed, g: 1 };
  for (const kv of (process.env.FIT_FIX || "").split(",").filter(Boolean)) { const [key, v] = kv.split("="); fixed = { ...fixed, [key]: Number(v) }; } // FIT_FIX=pt=8,fl=0.3: those held
  // FIT_CAREFUL=w: the numbers over the map count w times (the autopilot's gate goes on 70–90%: odds shown too high
  // send squads to their deaths, too low only keep them home a while longer).
  const careful = Number(process.env.FIT_CAREFUL || 1);
  const loss = (k) => rows.reduce((a, r) => { const p = r.terms.reduce((x, t) => x + predict(t, k), 0) / r.terms.length; return a + (p - r.rate) ** 2 * (p > r.rate ? careful : 1); }, 0);
  const R0 = HC.HIVEMIND.REACH;
  const N0 = HC.HIVEMIND.NUMBERS;
  let k = { K: HC.HIVEMIND.numbersK, lit: N0.lit, fire: N0.fire, stun: N0.stun, g: N0.steep ?? 1, R: R0.range, m: R0.melee, fl: N0.floor ?? 0.3, pt: HC.HIVEMIND.powerTier };
  const span = { K: [0.2, 5, 0.05], lit: [0, 0.7, 0.025], fire: [0, 0.65, 0.025], stun: [0, 0.5, 0.025], g: [1, 3, 0.05], R: [3, 10, 0.5], m: [0, 1, 0.05], fl: [0.05, 0.5, 0.025], pt: [0, 30, 1] };
  const descend = (k0, hold) => { // coordinate descent from k0, the keys in hold kept
    const k = { ...k0 };
    for (let pass = 0; pass < 6; pass++) for (const key of Object.keys(span)) {
      if (fixed[key] != null) { k[key] = fixed[key]; continue; }
      if (hold.includes(key)) continue;
      let best = k[key], bl = loss(k);
      for (let v = span[key][0]; v <= span[key][1] + 1e-9; v += span[key][2]) { const l = loss({ ...k, [key]: v }); if (l < bl) { bl = l; best = Math.round(v * 1000) / 1000; } }
      k[key] = best;
    }
    return k;
  };
  // The steepness and numbersK pull together (one coordinate at a time stays put): each steepness on its own first.
  if (fixed.g == null) { let bestK = null, bl = Infinity; for (let g = 1; g <= 3 + 1e-9; g += 0.25) { const c = descend({ ...k, g }, ["g"]); const l = loss(c); if (l < bl) { bl = l; bestK = c; } } k = bestK; }
  k = descend(k, []);
  const before = { K: HC.HIVEMIND.numbersK, lit: 0, fire: 0, stun: 0, R: R0.range, m: R0.melee };
  const cur = { K: HC.HIVEMIND.numbersK, ...HC.HIVEMIND.NUMBERS, g: HC.HIVEMIND.NUMBERS.steep ?? 1, R: R0.range, m: R0.melee };
  console.log(`fit: numbersK ${k.K}, lit ${k.lit}, fire ${k.fire}, stun ${k.stun}, steep ${k.g}, range ${k.R}, melee ${k.m}, floor ${k.fl}, powerTier ${k.pt}; RMS error ${Math.sqrt(loss(k) / rows.length).toFixed(3)} (numbersK ${before.K} alone: ${Math.sqrt(loss(before) / rows.length).toFixed(3)}; current: ${Math.sqrt(loss(cur) / rows.length).toFixed(3)})`);
  // The mean gap (map against numbers, points) by squad kind: the constants in the code now, and fitted.
  const gaps = {};
  for (const r of rows) {
    const g = (gaps[KIND[r.sq] || r.sq] ||= { n: 0, now: 0, fit: 0, map: 0, numNow: 0, numFit: 0 });
    const pn = r.terms.reduce((x, t) => x + predict(t, cur), 0) / r.terms.length, pf = r.terms.reduce((x, t) => x + predict(t, k), 0) / r.terms.length;
    g.n++; g.now += Math.abs(pn - r.rate); g.fit += Math.abs(pf - r.rate); g.map += r.rate; g.numNow += pn; g.numFit += pf;
  }
  const over = rows.filter((r) => r.terms.reduce((x, t) => x + predict(t, k), 0) / r.terms.length >= 0.7);
  console.log(`  where the numbers say 70% or more (${over.length} configurations): the map won ${over.length ? Math.round((over.reduce((a, r) => a + r.rate, 0) / over.length) * 100) : 0}% on average, at worst ${over.length ? Math.round(Math.min(...over.map((r) => r.rate)) * 100) : 0}%`);
  for (const [kind, g] of Object.entries(gaps)) console.log(`  ${kind.padEnd(8)} map ${Math.round((g.map / g.n) * 100)}%, numbers now ${Math.round((g.numNow / g.n) * 100)}% (gap ${Math.round((g.now / g.n) * 100)}), fitted ${Math.round((g.numFit / g.n) * 100)}% (gap ${Math.round((g.fit / g.n) * 100)}) over ${g.n} configurations`);
  for (const r of rows) { const p = r.terms.reduce((x, t) => x + predict(t, k), 0) / r.terms.length; console.log(`  ${r.sq.padEnd(8)} t${r.tier} g${r.guard} ${r.lights ? "lit  " : "dark "} ${r.prep ? "prep" : "    "}  map ${String(Math.round(r.rate * 100)).padStart(3)}%  numbers ${String(Math.round(p * 100)).padStart(3)}%`); }
}
if (process.argv[1] && process.argv[1].endsWith("hivecorecalib.js") && process.argv[2] === "--fit") { await runFit(Number(process.argv[3] || 16)); process.exit(0); }
// --refit file[,file…] [K]: the fit again from saved rows (FIT_SAVE=file on a --fit run), numbersK held at K when given.
const fs0 = await import("node:fs");
if (process.argv[1] && process.argv[1].endsWith("hivecorecalib.js") && process.argv[2] === "--refit") { fitRows(process.argv[3].split(",").flatMap((file) => JSON.parse(fs0.readFileSync(file, "utf8"))), process.argv[4] ? { K: Number(process.argv[4]) } : {}); process.exit(0); }
if (process.argv[1] && process.argv[1].endsWith("hivecorecalib.js")) {
  const t0 = Date.now();
  for (const tier of TIERS) {
    let won = 0, dead = 0, p2 = 0, tt = -1;
    for (let i = 0; i < TRIALS; i++) { const r = coreTrial(100 + i, tier, { lights: !!LIGHTS }); won += r.won; dead += r.dead; p2 += r.phase2; tt = r.tier; }
    console.log(`tier ${tier} (hiveTier ${tt}), ${LIGHTS ? "headlamps" : "no lights"}: won ${Math.round((won / TRIALS) * 100)}% (${won}/${TRIALS}), ${(dead / TRIALS).toFixed(2)} dead a battle, phase 2 in ${p2}`);
  }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
