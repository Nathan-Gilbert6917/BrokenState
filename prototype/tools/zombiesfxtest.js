// The dead's voices (ui/zombiesfx.js; soundcues.js hooks them into battleCues, audio.js plays them): headless checks.
// - Voice sets: every kind of the dead (ZTYPES, the bosses, the turned, the armoured dead) has every core event.
// - Voice seeds: stable per unit, different between units, never the world's dice.
// - A scripted battle: aggro, lunge, bite (the victim screams), hurt, death, smash, spit and sizzle, the screamer's and
//   the Nightmare's shriek, a crawler striking from hiding, a Carrier bursting, a Flinger's wind-up and throw, a Sleeper.
// - The crowd bed follows the count of the dead and their nearness; the throttle and the volley cap hold for a horde.
// - The map: a horde's moaning by distance, size and night; a hive's drone; nothing for what you cannot see.
// - Every voice builds on a stub AudioContext (no NaN, no ramp to zero, every source stopped); node counts per voice.
// - Determinism: a battle and a world play out the same with and without the sound layer.
// Usage: node tools/zombiesfxtest.js
import * as C from "../src/sim/combat.js";
import { createWorld, hub } from "../src/sim/world.js";
import { applyZType } from "../src/sim/zombietypes.js";
import { ZTYPES } from "../src/sim/hiveconst.js";
import { battles } from "./isobattles.js";
import { battleCues, battleCrowd, makeThrottle, MAX_BATTLE_SOUNDS } from "../src/ui/soundcues.js";
import * as Z from "../src/ui/zombiesfx.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

// ---------- a stub AudioContext that counts nodes and catches bad parameters ----------
function stub() {
  const bad = [];
  let nodes = 0, started = 0, stopped = 0;
  const starts = [];
  const param = (name, v = 0) => {
    const p = { value: v };
    const fin = (x, what) => { if (!Number.isFinite(x)) bad.push(`${name}.${what}(${x})`); };
    p.setValueAtTime = (x, t) => { fin(x, "set"); fin(t, "setT"); return p; };
    p.linearRampToValueAtTime = (x, t) => { fin(x, "lin"); fin(t, "linT"); return p; };
    p.exponentialRampToValueAtTime = (x, t) => { fin(x, "exp"); if (!(x > 0)) bad.push(`${name}.exp(${x})`); fin(t, "expT"); return p; };
    p.setTargetAtTime = (x, t, k) => { fin(x, "tgt"); fin(t, "tgtT"); if (!(k > 0)) bad.push(`${name}.tgtK(${k})`); return p; };
    return p;
  };
  const node = (extra = {}) => { nodes++; return { connect(d) { if (!d) bad.push("connect(null)"); return d; }, disconnect() {}, ...extra }; };
  const src = (extra) => node({ start(t, off) { started++; starts.push(t ?? 0); if (!Number.isFinite(t ?? 0) || !Number.isFinite(off ?? 0)) bad.push("start"); }, stop(t) { stopped++; if (!Number.isFinite(t)) bad.push("stop"); }, ...extra });
  const ctx = {
    sampleRate: 8000, currentTime: 0,
    createGain: () => node({ gain: param("gain", 1) }),
    createBiquadFilter: () => node({ type: "", frequency: param("freq", 350), Q: param("Q", 1) }),
    createOscillator: () => src({ type: "", frequency: param("osc", 440), setPeriodicWave() {} }),
    createBufferSource: () => src({ buffer: null, loop: false, playbackRate: param("rate", 1) }),
    createBuffer: (ch, len, rate) => { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { duration: len / rate, numberOfChannels: ch, getChannelData: (i) => d[i] }; },
    createStereoPanner: () => node({ pan: param("pan") }),
    createWaveShaper: () => node({ curve: null, oversample: "none" }),
    createPeriodicWave: () => ({}),
    createDelay: () => node({ delayTime: param("delay", 0) }),
    createDynamicsCompressor: () => node({ threshold: param("thr", -24), knee: param("knee", 30), ratio: param("ratio", 12), attack: param("att", 0.003), release: param("rel", 0.25) }),
  };
  return { ctx, bad, starts, get nodes() { return nodes; }, get started() { return started; }, get stopped() { return stopped; }, reset() { nodes = 0; } };
}

// ---------- 1. voice sets ----------
console.log("Voice sets");
{
  const kinds = Object.keys(Z.PROFILE);
  const zk = Object.keys(ZTYPES).map((k) => Z.voiceKind({ kind: "zombie", ztype: k }));
  check(Object.keys(ZTYPES).every((k, i) => Z.VOICE_SETS[zk[i]]), `every ZTYPES kind has a voice set (${Object.keys(ZTYPES).map((k, i) => `${k}→${zk[i]}`).join(", ")})`);
  check(Z.voiceKind({ kind: "zombie", ztype: "soldier" }) === "armoured" && Z.voiceKind({ kind: "zombie", ztype: "riot" }) === "riot" && Z.VOICE_SETS.riot.step === "clank", "the armoured dead: soldiers clank, riot police behind a visor");
  check(Z.voiceKind({ kind: "zombie" }) === "walker" && Z.voiceKind({ kind: "zombie", turned: true, name: "Dana (turned)" }) === "turned", "the common dead walk; the turned keep half a human voice");
  check(Z.voiceKind({ kind: "zombie", boss: "wallbreaker" }) === "wallbreaker" && Z.voiceKind({ kind: "zombie", boss: "broodmother" }) === "broodmother", "Wallbreakers and the Broodmother have their own");
  const missing = [];
  for (const k of kinds) for (const ev of Z.CORE_EVENTS) { const r = Z.recipeFor(k, ev, () => 0); if (!r || !Z.RECIPES[r]) missing.push(`${k}.${ev}`); }
  check(!missing.length, `every kind has idle, aggro, attack, bite, hurt, death and step${missing.length ? `: missing ${missing.join(", ")}` : ""}`);
  const named = new Set();
  for (const set of Object.values(Z.VOICE_SETS)) for (const v of Object.values(set)) for (const r of [].concat(v)) named.add(r);
  check([...named].every((r) => Z.RECIPES[r]), `every recipe a set names exists (${named.size})`);
  check(Z.recipeFor("screamer", "shriek") === "screech" && Z.recipeFor("nightmare", "shriek") === "nightmare" && Z.recipeFor("carrier", "death") === "burst" &&
    Z.recipeFor("crawler", "strike") === "strike" && Z.recipeFor("brute", "smash") === "smash" && Z.recipeFor("spitter", "spit") === "spit", "the signatures: screech, the nightmare's scream, the Carrier's burst, the crawler's strike, the smash, the spit");
  check(Z.recipeFor("sleeper", "idle") === "silent" && Z.recipeFor("sleeper", "wake") === "wake", "a Sleeper is silent until it wakes");
  check(new Set(kinds.map((k) => [Z.PROFILE[k].f0, Z.PROFILE[k].shift].join())).size === kinds.length, "no two kinds share a throat (pitch and formants)");
  check(Z.PROFILE.walker.f0 < 85 && Z.PROFILE.brute.f0 < 50 && Z.PROFILE.walker.sub > 0, `the dead sit low, below a human voice (walker ${Z.PROFILE.walker.f0} Hz, brute ${Z.PROFILE.brute.f0} Hz), a torn second pulse under them`);
  check(Z.ZOMBIE_STEPS.on === false && !Z.ZOMBIE_TESTS.some((g) => g.items.some(([v]) => v === "walker:step")) && Z.ZOMBIE_TESTS.some((g) => g.items.some(([v]) => v === "swarm:step")),
    "footsteps are off (the sfx-melee-steps branch has them); the swarm's squirm stays");
}

// Every kind of the dead the simulation makes: scan src/sim for ztype values, applyZType kinds and boss kinds.
{
  const fs = await import("node:fs");
  const dir = new URL("../src/sim/", import.meta.url);
  const found = new Set(Object.keys(ZTYPES)), bosses = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const src = fs.readFileSync(new URL(f, dir), "utf8");
    for (const m of src.matchAll(/ztype\s*(?:===|!==|=)\s*"([a-z]+)"/g)) found.add(m[1]);
    for (const m of src.matchAll(/applyZType\([^,]+,\s*"([a-z]+)"/g)) found.add(m[1]);
    for (const m of src.matchAll(/bossUnit\(b,\s*"([a-z]+)"/g)) bosses.add(m[1]);
  }
  const bad = [...found].filter((k) => { const v = Z.voiceKind({ kind: "zombie", ztype: k }); return !Z.VOICE_SETS[v] || v === "walker"; });
  check(!bad.length && found.size >= 16, `every ztype in src/sim has its own voice set (${found.size}: ${[...found].map((k) => `${k}→${Z.voiceKind({ kind: "zombie", ztype: k })}`).join(", ")})${bad.length ? `; walker fallback: ${bad.join(", ")}` : ""}`);
  check([...bosses].every((k) => Z.voiceKind({ kind: "zombie", boss: k }) === k) && bosses.size === 2, `the bosses: ${[...bosses].join(", ")}`);
  check(Z.voiceKind({ kind: "zombie", turned: { sid: 3 } }) === "turned" && Z.voiceKind({ kind: "zombie", walking: { who: "Dana" } }) === "turned" && Z.voiceKind({ kind: "zombie", ztype: "riot" }) === "riot",
    "the risen (turned, walking loot) and riot police have their own; soldiers the armoured dead's");
  check(Z.voiceKind({ kind: "zombie", called: true }) === "walker" && Z.FALLBACK_TO_WALKER.length >= 4, `walker voice, by design: ${Z.FALLBACK_TO_WALKER.join(", ")}`);
}

// ---------- 2. voice seeds ----------
console.log("Voice seeds");
{
  const ids = Array.from({ length: 300 }, (_, i) => i + 1);
  const seeds = ids.map((id) => Z.voiceSeed(id, 77));
  check(ids.every((id, i) => Z.voiceSeed(id, 77) === seeds[i]), "the same unit always has the same seed");
  check(new Set(seeds).size === seeds.length, "300 units: 300 different seeds");
  const ps = seeds.map((s) => Z.voiceParams(s));
  const keys = new Set(ps.map((p) => [p.pitch, p.rasp, p.f1, p.f2, p.drawl].join()));
  check(keys.size === ps.length, "and 300 different voices (pitch, rasp, mouth, drawl)");
  check(JSON.stringify(Z.voiceParams(seeds[5])) === JSON.stringify(Z.voiceParams(seeds[5])), "a seed's voice is the same every time");
  const pitches = ps.map((p) => p.pitch);
  check(Math.min(...pitches) >= 0.8 && Math.max(...pitches) <= 1.25 && Math.max(...pitches) - Math.min(...pitches) > 0.35, `pitch spread ${Math.min(...pitches)}–${Math.max(...pitches)}`);
  check(Z.voiceSeed(5, 1) !== Z.voiceSeed(5, 2), "the battle's tile salts it (the same id in another battle is another zombie)");
  const [forest] = battles(22, ["field-forest"]);
  const rngBefore = JSON.stringify(forest.b.rng), z = forest.b.units.find((u) => u.kind === "zombie");
  const s1 = Z.unitSeed(forest.b, z), s2 = Z.unitSeed(forest.b, z);
  check(s1 === s2 && JSON.stringify(forest.b.rng) === rngBefore, "a unit's seed draws none of the battle's dice");
}

// ---------- 3. a scripted battle ----------
console.log("Battle cues");
{
  const [forest] = battles(23, ["field-forest"]);
  const { b } = forest;
  const mem = { rng: Z.mulberry(4242) };
  const me = b.units.find((u) => u.side === "player" && !u.dead);
  const zs = b.units.filter((u) => u.kind === "zombie" && !u.dead);
  const [walker, brute, spitter, screamer, crawler, carrier, flinger, nightmare, sleepy, swarm] = zs;
  applyZType(brute, "brute", false, 3); applyZType(spitter, "spitter", false, 3); applyZType(screamer, "screamer", false, 3);
  applyZType(crawler, "crawler", false, 3); applyZType(carrier, "carrier", false, 3); applyZType(flinger, "flinger", false, 3);
  applyZType(nightmare, "nightmare", false, 3); applyZType(swarm, "swarm", false, 3);
  walker.aware = false;
  // Put them where they can be found by position: a free row each.
  const free = []; for (let y = 0; y < b.h && free.length < 12; y++) for (let x = 0; x < b.w && free.length < 12; x += 2) if (C.CELL[b.cells[y * b.w + x].k]?.walk && !b.units.some((u) => u.x === x && u.y === y)) free.push([x, y]);
  zs.slice(0, 10).forEach((u, i) => { u.x = free[i][0]; u.y = free[i][1]; });
  battleCues(b, mem, 0);
  let tm = 0;
  const step = () => battleCues(b, mem, (tm += 0.05));
  const names = (cs) => cs.map((c) => c.name);
  const has = (cs, n, kind) => cs.some((c) => c.name === n && (!kind || c.kind === kind));
  check(names(step()).length === 0, "nothing new: silence (and the idle moans wait their turn)");
  walker.aware = true;
  let cs = step();
  check(has(cs, "zAggro", "walker"), `a walker notices you: ${names(cs).join(", ")}`);
  C.fx(b, { type: "melee", from: [walker.x, walker.y], to: [me.x, me.y], hit: false, side: "enemy" });
  cs = step();
  check(names(cs).join() === "zAttack,whoosh" && cs[1].cls === "claws", `it lunges and misses: its snarl and the claws' swipe (ui/sfx-melee.js): ${names(cs).join(", ")}`);
  C.fx(b, { type: "melee", from: [walker.x, walker.y], to: [me.x, me.y], hit: true, crit: false, dmg: 9, side: "enemy" });
  cs = step();
  const bite = cs.find((c) => c.name === "zBite");
  check(!!bite && bite.human === true && bite.kind === "walker" && !cs.some((c) => c.name === "bite"), "it bites one of yours: the tearing bite, the victim screams (human), the old bite not played too");
  check(bite && bite.seed === Z.unitSeed(b, walker) && Number.isFinite(bite.pan) && Number.isFinite(bite.dist), "the cue carries the unit's voice seed, its pan and distance");
  check(bite && bite.sp && bite.sp.gain > 0 && bite.sp.lp > 0 && typeof bite.sp.room === "string" && Math.abs(bite.sp.dist - bite.dist) < 0.01 && Math.abs(bite.sp.pan - bite.pan) < 0.01, `and its placement by gun-sfx's spatial (level ${bite && bite.sp ? bite.sp.gain.toFixed(2) : "?"}, highs, the room ${bite && bite.sp ? bite.sp.room : "?"})`);
  walker.hp -= 6;
  check(has(step(), "zHurt", "walker"), "hit: a grunt");
  walker.dead = true;
  cs = step();
  check(has(cs, "zDeath", "walker") && !has(cs, "zHurt"), "killed: the death rattle and the slump (no hurt grunt too)");
  C.fx(b, { type: "melee", from: [brute.x, brute.y], to: [brute.x + 1, brute.y], hit: true, crit: false, dmg: 0, side: "enemy", text: "SMASH" });
  cs = step();
  check(has(cs, "zSmash", "brute") && cs.find((c) => c.name === "zSmash").mat, `a brute smashes a barricade: ${names(cs).join(", ")} (${cs[0] && cs[0].mat})`);
  C.fx(b, { type: "shot", from: [spitter.x, spitter.y], to: [me.x, me.y], hit: true, crit: false, dmg: 12, side: "enemy", acid: true });
  cs = step();
  check(has(cs, "zSpit", "spitter") && has(cs, "zSizzle") && !has(cs, "acid") && cs.find((c) => c.name === "zSizzle").delay > 0.4, `a spitter spits and it sizzles where it lands: ${names(cs).join(", ")}`);
  C.fx(b, { type: "scream", from: [screamer.x, screamer.y], to: [screamer.x, screamer.y], hit: true, text: "SHRIEK", side: "enemy" });
  cs = step();
  check(has(cs, "zShriek", "screamer") && cs.find((c) => c.name === "zShriek").far === true && !has(cs, "scream"), "the screamer shrieks (made to carry)");
  C.fx(b, { type: "scream", from: [nightmare.x, nightmare.y], to: [nightmare.x, nightmare.y], hit: true, text: "SCREAM", side: "enemy" });
  check(has(step(), "zShriek", "nightmare"), "the Nightmare's scream is its own");
  C.fx(b, { type: "melee", from: [crawler.x, crawler.y], to: [me.x, me.y], hit: true, crit: false, dmg: 14, side: "enemy" });
  crawler.low = false;
  cs = step();
  check(has(cs, "zStrike", "crawler") && has(cs, "zBite", "crawler"), `a crawler strikes from hiding: ${names(cs).join(", ")}`);
  C.fx(b, { type: "melee", from: [crawler.x, crawler.y], to: [me.x, me.y], hit: true, crit: false, dmg: 9, side: "enemy" });
  check(!has(step(), "zStrike"), "its next bite is a plain bite");
  carrier.dead = true;
  C.fx(b, { type: "loot", to: [carrier.x, carrier.y], text: "WORMS" });
  cs = step();
  check(has(cs, "zDeath", "carrier") && !has(cs, "zWorms") && Z.recipeFor("carrier", "death") === "burst", `a Carrier bursts (its death is the burst; the swarm in it): ${names(cs).join(", ")}`);
  C.fx(b, { type: "loot", to: [flinger.x, flinger.y], text: "WINDS UP" });
  check(has(step(), "zHeave", "flinger"), "a Flinger winds up");
  C.fx(b, { type: "shot", from: [flinger.x, flinger.y], to: [me.x, me.y], hit: true, side: "enemy", worm: true });
  C.fx(b, { type: "loot", to: [me.x + 1, me.y], text: "WORMS" });
  cs = step();
  check(has(cs, "zFling", "flinger") && !has(cs, "zWorms"), `and throws (the landing is in the throw): ${names(cs).join(", ")}`);
  C.fx(b, { type: "loot", to: [swarm.x, swarm.y], text: "WORMS" });
  check(has(step(), "zWorms", "swarm"), "worms coming out anywhere else: the squirm");
  b.corpses = [...(b.corpses || []), { id: 999, x: sleepy.x, y: sleepy.y, sleeper: true, burst: true }];
  C.fx(b, { type: "loot", to: [sleepy.x, sleepy.y], text: "WORMS" });
  cs = step();
  check(has(cs, "zWake", "sleeper"), "a Sleeper splitting open: the gasp as it wakes");
  C.fx(b, { type: "move", unit: swarm.id, from: [swarm.x - 1, swarm.y], path: [[swarm.x, swarm.y]] });
  cs = step();
  check(has(cs, "zStep", "swarm"), "the swarm moving: its squirm");
  const bx = brute.x, by = brute.y;
  brute.x = me.x + 1; brute.y = me.y; // it comes within 2 tiles: always heard
  C.fx(b, { type: "move", unit: brute.id, from: [bx, by], path: [[brute.x, brute.y]] });
  cs = step();
  check(!has(cs, "zStep") && has(cs, "zAggro", "brute"), "a brute closing in: its roar, and no footsteps (another branch has them)");
  brute.x = bx; brute.y = by;
  C.fx(b, { type: "melee", from: [brute.x, brute.y], to: [brute.x, brute.y - 1 < 0 ? 1 : brute.y - 1], hit: true, crit: false, dmg: 5, side: "enemy", text: "-5" });
  const bashed = step();
  check(has(bashed, "zBash", "brute") || has(bashed, "zBite"), `a blow at a structure: ${names(bashed).join(", ")}`);
  // Your own blow on one of the dead is yours (the melee sound), its hurt grunt from the hp change.
  C.fx(b, { type: "melee", from: [me.x, me.y], to: [brute.x, brute.y], hit: true, crit: false, dmg: 10, side: "player" });
  brute.hp -= 10;
  cs = step();
  check(has(cs, "melee") && has(cs, "zHurt", "brute"), `your blow on a brute: ${names(cs).join(", ")}`);
  // Idle moans: within a few seconds, from one of them, by its own voice.
  const idles = [];
  for (let i = 0; i < 400; i++) for (const c of battleCues(b, mem, (tm += 0.1))) if (c.name === "zIdle") idles.push(c);
  check(idles.length >= 4 && new Set(idles.map((c) => c.seed)).size >= 2, `the dead moan now and then, in different voices (${idles.length} in 40 s, ${new Set(idles.map((c) => c.seed)).size} voices)`);
  const live = b.units.filter((u) => u.kind === "zombie" && !u.dead).length;
  check(idles.length < 40 * 3, `but not all the time (${idles.length} in 40 s with ${live} up)`);
}

// ---------- 4. crowd ----------
console.log("Crowd");
{
  const mix = (n, near = 6, mean = 8) => Z.crowdMix({ count: n, near, mean });
  check(mix(0).gain === 0 && mix(2).gain === 0, "no crowd bed for one or two of the dead (their own voices are enough)");
  const g = [3, 6, 12, 24, 40].map((n) => mix(n));
  check(g.every((m, i) => !i || m.gain > g[i - 1].gain), `the bed grows with the count: ${g.map((m) => `${m.count}→${m.gain}`).join(", ")}`);
  check(g.every((m, i) => !i || m.dense >= g[i - 1].dense) && g[0].dense === 0 && g[4].dense === 1, `the dense murmur comes in from about 6 and is full by 30 (${g.map((m) => m.dense).join(", ")})`);
  const far = mix(20, 16, 18), near = mix(20, 2, 3);
  check(near.gain > far.gain && near.cutoff > far.cutoff, `nearer is louder and brighter (${far.gain}/${far.cutoff} Hz → ${near.gain}/${near.cutoff} Hz)`);
  const [forest] = battles(24, ["field-forest"]);
  const cs = battleCrowd(forest.b), up = forest.b.units.filter((u) => u.kind === "zombie" && !u.dead).length;
  check(cs.count === up && cs.near <= cs.mean, `the battle's crowd: ${cs.count} up, nearest ${cs.near}, mean ${cs.mean}`);
  forest.b.over = true;
  check(battleCrowd(forest.b).count === 0, "a battle over: no crowd");
  // The bed on a stub context: a fixed handful of nodes whatever the count.
  const S = stub();
  const bus = S.ctx.createGain();
  S.reset();
  const bed = Z.zombieCrowd(S.ctx, bus, { count: 40, near: 3, mean: 6 }, 1);
  const n40 = S.nodes;
  S.reset();
  Z.zombieCrowd(S.ctx, bus, { count: 8, near: 3, mean: 6 }, 1.25);
  check(!!bed && S.nodes === 0 && n40 <= 16, `the crowd bed is one shared bed: ${n40} nodes for 40 of the dead, none more for another frame`);
  Z.zombieCrowd(S.ctx, null, null, 2);
  check(Z.zombieCrowd(S.ctx, null, null, 7) === null && !S.bad.length, `let go after a few seconds of silence${S.bad.length ? `: ${S.bad.slice(0, 3).join(", ")}` : ""}`);
}

// ---------- 5. throttle and caps ----------
console.log("Throttle");
{
  const th = makeThrottle(Z.ZOMBIE_LIMITS, 28);
  let n = 0;
  for (let i = 0; i < 100; i++) if (th.allow("zIdle", 1, 2.4)) n++;
  check(n === 1, `100 moans at the same instant: ${n}`);
  let m = 0, most = 0;
  for (let i = 0; i < 100; i++) { if (th.allow("zStep", 2 + i * 0.02, 1.6)) m++; most = Math.max(most, th.playing); }
  check(most <= 4 && m <= 8, `a step every 20 ms for 2 s: ${m} heard, at most ${most} playing (3 steps and the moan)`);
  let s = 0;
  for (let i = 0; i < 20; i++) if (th.allow("zShriek", 5 + i * 0.1, 2.4)) s++;
  check(s === 1, "one shriek at a time");
  // A horde of 40 all hurt and one shrieking in one frame: a handful heard, the shriek among them.
  const [hive] = battles(25, ["field-forest"]);
  const { b } = hive;
  const mem = {};
  battleCues(b, mem, 0);
  const zs = b.units.filter((u) => u.kind === "zombie" && !u.dead);
  for (const z of zs) z.hp -= 3;
  applyZType(zs[0], "screamer", false, 3);
  C.fx(b, { type: "scream", from: [zs[0].x, zs[0].y], to: [zs[0].x, zs[0].y], hit: true, text: "SHRIEK", side: "enemy" });
  const cs = battleCues(b, mem, 1);
  check(cs.length <= MAX_BATTLE_SOUNDS && cs.some((c) => c.name === "zShriek"), `${zs.length} hurt and a shriek in one frame: ${cs.length} heard (${cs.map((c) => c.name).join(", ")})`);
}

// ---------- 6. every voice on a stub context ----------
console.log("Voices");
{
  const S = stub();
  const errs = [], cost = {};
  for (const kind of Object.keys(Z.PROFILE)) for (const ev of Object.keys(Z.EVENT_CUE)) {
    for (const o of [{}, { dist: 12, pan: -0.6, human: true, mat: "metal", hidden: true, steps: 5 }, { dist: 3, mat: "wall", far: true }]) {
      S.reset();
      try { Z.playZombie(ev, S.ctx, S.ctx.createGain(), 0.5, { kind, seed: Z.voiceSeed(kind.length * 31 + ev.length), ...o }); } catch (e) { errs.push(`${kind}.${ev}: ${e.message}`); }
      const r = Z.recipeFor(kind, ev, () => 0);
      cost[r] = Math.max(cost[r] || 0, S.nodes);
    }
  }
  check(!errs.length, `every kind × event builds (${Object.keys(Z.PROFILE).length} kinds × ${Object.keys(Z.EVENT_CUE).length} events)${errs.length ? `: ${errs.slice(0, 4).join("; ")}` : ""}`);
  check(!S.bad.length, `no NaN, no ramp to zero, nothing connected to nothing${S.bad.length ? `: ${S.bad.slice(0, 5).join(", ")}` : ""}`);
  check(S.started > 0 && S.stopped >= S.started - 4, `every source started is stopped (${S.started} started, ${S.stopped} stopped; the crowd bed's 4 loops run until let go)`);
  const top = Object.entries(cost).sort((a, b) => b[1] - a[1]);
  console.log(`    nodes per voice: ${top.map(([r, n]) => `${r} ${n}`).join(", ")}`);
  check(top[0][1] <= 260, `the costliest voice builds ${top[0][1]} nodes (${top[0][0]}), short-lived`);
  // The old cues still work through audio.js's VOICES (groan and bite are now the new voices).
  const AU = await import("../src/ui/audio.js");
  check(Z.ZOMBIE_SOUND_NAMES.every((n) => AU.VOICES[n] && AU.VOICES[n].routes) && AU.VOICES.groan && AU.VOICES.bite, "audio.js plays every zombie cue (and Hear: Zombie groan / bite are the new voices)");
  const html = AU.soundOptionsHtml({ sound: { master: 0.5, sfx: 0.8, amb: 0.3, mute: false, muteBlur: true } });
  const opts = (html.match(/<option value="[a-z]+:[a-z]+/g) || []).length;
  check(/data-action="zsnd-pick"/.test(html) && /data-action="zsnd-test"/.test(html) && opts >= 80 && /Screamer shrieks/.test(html) && !/value="zIdle"/.test(html),
    `Options → Sound has the Zombie sounds list (${opts} entries) and the plain Hear list leaves them out`);
  const { SETTINGS_ACTIONS, SETTINGS_CHANGE } = await import("../src/ui/settings.js");
  check(!!SETTINGS_ACTIONS["zsnd-test"] && !!SETTINGS_CHANGE["zsnd-pick"], "the menu knows the Zombie sounds actions");
  const played = [];
  Z.playZombieTest("brute:smash:metal", (n, o) => played.push([n, o.kind, o.mat]));
  check(played[0] && played[0].join() === "zSmash,brute,metal", "a test entry plays its kind, event and material");
  Z.playZombieTest("demo:crowd", () => {}, 10);
  check(Z.DEMO.crowd && Z.DEMO.crowd.until === 22, "the crowd demo runs for 12 s");
  Z.DEMO.crowd = null;
}

// ---------- 6b. the screamer ----------
console.log("Screamer");
{
  const S = Z.SCREECH, D = Z.EVENT_DUR.shriek;
  const plans = Array.from({ length: 200 }, (_, i) => Z.screechPlan(Z.voiceSeed(i + 1, 3), () => 0.5));
  check(plans.every((p) => p.dur >= 1.6 && p.dur <= 2.2), `the first call lasts 1.6–2.2 s (${Math.min(...plans.map((p) => p.dur)).toFixed(2)}–${Math.max(...plans.map((p) => p.dur)).toFixed(2)})`);
  check(plans.every((p) => p.at >= 0.35 && p.pull > 0), "a gasping in-breath before it (two pulls, the call from 0.35 s on)");
  check(plans.every((p) => p.gap >= 0.4 && p.gap <= 0.8 && p.at2 >= p.at + p.dur + p.gap), "a pause of 0.4–0.8 s after its tail, then the second call");
  check(plans.every((p) => p.dur2 / p.dur >= 0.6 - 1e-9 && p.dur2 / p.dur <= 0.8 + 1e-9 && p.lower < 1), "the second call is lower and 60–80% as long");
  const sobs = plans.filter((p) => p.sob).length;
  check(sobs > 40 && sobs < 120, `some screamers break into a sob-shriek (${sobs} of 200)`);
  const again = Z.screechPlan(Z.voiceSeed(7, 3), () => 0.9), first = Z.screechPlan(Z.voiceSeed(7, 3), () => 0.1);
  check(again.sob === first.sob && again.base === first.base && again.f === first.f && again.dur !== first.dur, "a screamer always shrieks its own way (seed), each shriek a little different (take)");
  check(new Set(plans.map((p) => [p.vow, Math.round(p.ring * 20), Math.round(p.f * 10), p.sob].join())).size > 60, "screamers differ: vowel path, ring, pitch, the sob");
  const worst = Math.max(...plans.map((p) => Z.screechPlan(p ? Z.voiceSeed(plans.indexOf(p) + 1, 3) : 0, () => 1).total));
  check(worst <= D && D < 6, `the whole shriek is done within ${D} s (the longest ${worst.toFixed(2)} s), the throttle's length for it`);
  const th = makeThrottle(Z.ZOMBIE_LIMITS, 28);
  check(th.allow("zShriek", 0, D) && !th.allow("zShriek", 3, D) && !th.allow("zShriek", 5.5, D) && th.allow("zShriek", 6, D), "one shriek at a time: a second screamer waits until the first has died away (no stacking)");
  // Built on a stub: two calls (oscillators started after the pause), the noticing shriek only one.
  const St = stub();
  Z.resetTakes(0);
  Z.playZombie("shriek", St.ctx, St.ctx.createGain(), 0.5, { kind: "screamer", seed: Z.voiceSeed(11, 3), pitch: 1, dist: 16 });
  const pl = Z.screechPlan(Z.voiceSeed(11, 3), () => 0);
  const late = St.starts.filter((x) => x >= 0.5 + pl.at + 1.6 + 0.2 + 0.39).length, lastShriek = Math.max(...St.starts);
  St.starts.length = 0;
  Z.playZombie("aggro", St.ctx, St.ctx.createGain(), 0.5, { kind: "screamer", seed: Z.voiceSeed(11, 3), pitch: 1 });
  const lastAggro = Math.max(...St.starts);
  check(late >= 10 && lastShriek > 0.5 + 3.4 && lastAggro < lastShriek - 1 && !St.bad.length, `the second call is there (${late} sources after the pause, the last at ${(lastShriek - 0.5).toFixed(2)} s); noticing you is one call (${(lastAggro - 0.5).toFixed(2)} s)`);
  check(Z.Z_PRIORITY.zShriek <= 2 && Z.ZOMBIE_LIMITS.zShriek.max === 1, "it stays at the top of a frame's volley, one at a time");
}

// ---------- 6c. silences, snarls, aggro ----------
console.log("Silences and snarls");
{
  // n of the dead standing about for secs seconds, the cues heard (battleCues at 10 frames a second).
  const quiet = (n, secs = 120, seed = 27) => {
    const [x] = battles(seed, ["field-forest"]);
    const { b } = x;
    const zs = b.units.filter((u) => u.kind === "zombie");
    while (zs.length < n) { const z = C.enemyUnit(b, b.rng, "zombies", 3, zs.length + 1); const f = zs[zs.length % zs.length]; z.x = f.x; z.y = f.y; b.units.push(z); zs.push(z); }
    zs.forEach((u, i) => { if (i >= n) u.dead = true; });
    const mem = {}, log = [], hush = [];
    battleCues(b, mem, 0);
    for (let t = 0.1; t <= secs; t += 0.1) {
      for (const c of battleCues(b, mem, t)) if (/^z/.test(c.name)) log.push({ t: Math.round(t * 10) / 10, name: c.name, gain: c.gain ?? 1 });
      hush.push(battleCrowd(b).hush);
    }
    return { b, log, hush };
  };
  const q = quiet(8);
  const times = q.log.map((c) => c.t);
  const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 5);
  const snarls = q.log.filter((c) => c.name === "zSnarl"), moans = q.log.filter((c) => c.name === "zIdle");
  check(gaps.length >= 4, `8 of the dead for 120 s: moans in clusters with real gaps (${moans.length} moans, ${gaps.length} gaps over 5 s, the longest ${Math.max(...gaps).toFixed(1)} s)`);
  const steps = moans.slice(1).map((c, i) => c.t - moans[i].t).filter((g) => g < 5);
  check(new Set(steps.map((g) => g.toFixed(1))).size >= Math.min(6, steps.length - 1), `no metronome: the steps inside a cluster vary (${[...new Set(steps.map((g) => g.toFixed(1)))].slice(0, 8).join(", ")} s)`);
  check(snarls.length >= 1 && snarls.length <= 8, `now and then a sudden snarl in the quiet (${snarls.length} in 120 s: about one every ${(120 / Math.max(1, snarls.length)).toFixed(0)} s)`);
  check(snarls.every((s) => q.log.every((o) => o === s || Math.abs(o.t - s.t) >= Z.IDLE.SNARL_GAP - 1e-9)), "a snarl never lands within 1.5 s of another of their sounds");
  check(snarls.every((s) => s.gain > Math.max(...moans.map((m) => m.gain))) && Z.LEVELS.bark > Z.LEVELS.moan * 1.1 && Z.LEVELS.aggro >= Z.LEVELS.bark,
    `snarls are louder than moans (cue ${snarls[0] ? snarls[0].gain : "-"} vs ${Math.max(...moans.map((m) => m.gain)).toFixed(2)}; peak ${Z.LEVELS.bark} vs ${Z.LEVELS.moan}), the aggro louder still (${Z.LEVELS.aggro})`);
  const hushed = q.hush.filter((h) => h === 1).length / q.hush.length;
  check(hushed > 0.3 && hushed < 0.9, `the crowd bed dips through the silences (${Math.round(hushed * 100)}% of the time)`);
  check(Z.crowdMix({ count: 8, near: 5, mean: 7, hush: 1 }).gain < Z.crowdMix({ count: 8, near: 5, mean: 7, hush: 0 }).gain, "a hushed crowd is quieter");
  const big = quiet(40, 120, 27), bt = big.log.filter((c) => c.name === "zIdle").map((c) => c.t);
  const bigGap = Math.max(...bt.slice(1).map((t, i) => t - bt[i]));
  check(bigGap < Math.max(...gaps) && bigGap < 9 && bt.length > moans.length, `40 of the dead never go quiet for long (longest gap ${bigGap.toFixed(1)} s, ${bt.length} moans)`);
  const again = quiet(8);
  check(JSON.stringify(again.log) === JSON.stringify(q.log), "the same battle: the same pattern of moans, silences and snarls");
  const other = quiet(8, 120, 31);
  check(JSON.stringify(other.log.map((c) => c.t)) !== JSON.stringify(times), "another battle: another pattern");
  // Aggro: the first of the fight always, any within 2 tiles always, else about half (by the unit's seed).
  const [x] = battles(29, ["field-forest"]);
  const { b } = x;
  const share = Array.from({ length: 400 }, (_, i) => Z.aggroLucky(b, { id: 1000 + i })).filter(Boolean).length / 400;
  check(share > 0.42 && share < 0.58, `about half of the dead starting for you snarl (${Math.round(share * 100)}% by their seeds)`);
  const mem = {};
  const me = b.units.find((u) => u.side === "player" && !u.dead);
  const zs = b.units.filter((u) => u.kind === "zombie" && !u.dead);
  for (const z of zs) z.aware = false;
  battleCues(b, mem, 0);
  const far = zs.filter((z) => Math.max(...b.units.filter((u) => u.side === "player").map((p) => -Math.max(Math.abs(p.x - z.x), Math.abs(p.y - z.y)))) < -2);
  const heard = [];
  let tt = 0;
  for (const z of far) { z.aware = true; for (const c of battleCues(b, mem, (tt += 0.1))) if (c.name === "zAggro") heard.push(z.id); }
  check(heard[0] === far[0].id, "the first of them to notice you always snarls");
  const rest = far.slice(1), lucky = rest.filter((z) => Z.aggroLucky(b, z));
  check(heard.length - 1 === lucky.length && rest.length > 4, `the rest by their seed: ${heard.length - 1} of ${rest.length} (the others stay quiet)`);
  const quietOne = rest.find((z) => !Z.aggroLucky(b, z));
  if (quietOne) {
    const from = [quietOne.x, quietOne.y];
    quietOne.x = me.x + 1; quietOne.y = me.y;
    C.fx(b, { type: "move", unit: quietOne.id, from, path: [[quietOne.x, quietOne.y]] });
    check(battleCues(b, mem, (tt += 0.1)).some((c) => c.name === "zAggro" && c.seed === Z.unitSeed(b, quietOne)), "a quiet one that comes within 2 tiles of your people: always heard then");
  }
}

// ---------- 6d. close breathing ----------
console.log("Close breathing");
{
  // A battle with one of your people at a free spot and the dead put where asked; runs secs at 10 frames a second.
  const setup = (seed = 33) => {
    const [x] = battles(seed, ["field-forest"]);
    const { b } = x;
    const me = b.units.find((u) => u.side === "player" && !u.dead);
    for (const u of b.units) if (u.side === "player" && u !== me) u.left = true;
    const zs = b.units.filter((u) => u.kind === "zombie" && !u.dead);
    zs.forEach((z, i) => { z.x = (me.x + 6 + i) % b.w; z.y = (me.y + 6) % b.h; z.aware = true; }); // all far off
    return { b, me, zs };
  };
  const run = (b, mem, t0, secs, log, onTick) => {
    for (let t = t0; t < t0 + secs - 1e-9; t += 0.1) {
      if (onTick) onTick(t);
      for (const c of battleCues(b, mem, Math.round(t * 10) / 10)) if (c.name === "zBreath" || /^z/.test(c.name)) log.push({ t: Math.round(t * 10) / 10, ...c });
    }
  };
  const put = (z, me, dx, dy) => { z.x = me.x + dx; z.y = me.y + dy; };
  {
    const { b, me, zs } = setup();
    const mem = {}, log = [];
    battleCues(b, mem, 0);
    put(zs[0], me, 2, 0);
    run(b, mem, 0.1, 20, log);
    const br = log.filter((c) => c.name === "zBreath");
    check(br.length >= 4 && br.every((c) => c.seed === Z.unitSeed(b, zs[0])) && br[0].fade === true && !br[1].fade, `one of the dead 2 tiles off: it breathes (${br.length} breaths in 20 s, the first fading in)`);
    check(br[0].t <= 1, `it starts within a second of coming close (${br[0].t} s)`);
    check(br.every((c) => c.sp && Number.isFinite(c.sp.gain) && Number.isFinite(c.dist)), "each breath carries its place in the battle's sound space (sp, as the other cues)");
    const gaps = br.slice(1).map((c, i) => +(c.t - br[i].t).toFixed(1));
    check(new Set(gaps).size >= Math.min(4, gaps.length), `slow and irregular (${gaps.join(", ")} s between breaths)`);
    put(zs[0], me, 3, 0);
    const after = [];
    run(b, mem, 20.1, 10, after);
    check(!after.some((c) => c.name === "zBreath"), "3 tiles off: it stops");
    // Its own voice: no breath starts while it is sounding.
    put(zs[0], me, 1, 1);
    const mix = [];
    run(b, mem, 30.1, 25, mix, (t) => { if (Math.abs(t - 32) < 0.05 || Math.abs(t - 40) < 0.05 || Math.abs(t - 47) < 0.05) C.fx(b, { type: "melee", from: [zs[0].x, zs[0].y], to: [me.x, me.y], hit: false, side: "enemy" }); });
    const seed0 = Z.unitSeed(b, zs[0]);
    const vocals = mix.filter((c) => c.name !== "zBreath" && c.seed === seed0), breaths = mix.filter((c) => c.name === "zBreath");
    check(vocals.length >= 3 && breaths.length >= 3 && breaths.every((br2) => vocals.every((v) => br2.t < v.t || br2.t >= v.t + Z.EVENT_DUR[Object.keys(Z.EVENT_CUE).find((k) => Z.EVENT_CUE[k] === v.name)] + (v.delay || 0) - 0.11)),
      `it never starts a breath while its own voice is sounding (${vocals.length} lunges, ${breaths.length} breaths)`);
  }
  {
    const { b, me, zs } = setup(34);
    applyZType(zs[0], "crawler", false, 3);
    zs[0].low = true;
    const mem = {}, log = [];
    battleCues(b, mem, 0);
    put(zs[0], me, 2, 0);
    run(b, mem, 0.1, 8, log);
    check(!log.some((c) => c.name === "zBreath"), "a crawler hidden in the grass 2 tiles off: not heard");
    put(zs[0], me, 1, 0);
    run(b, mem, 8.1, 8, log);
    check(log.some((c) => c.name === "zBreath" && c.kind === "crawler"), "right next to you, hidden or not: its hissing wheeze");
  }
  {
    const { b, me, zs } = setup(35);
    const mem = {}, log = [];
    battleCues(b, mem, 0);
    put(zs[0], me, 1, 0); put(zs[1], me, 0, 2); put(zs[2], me, 2, 2); put(zs[3], me, -2, 1);
    run(b, mem, 0.1, 20, log);
    const who = new Set(log.filter((c) => c.name === "zBreath").map((c) => c.seed));
    check(who.size === 2 && who.has(Z.unitSeed(b, zs[0])), `four of the dead close: only the nearest two breathe (${who.size})`);
    const again = [], mem2 = {};
    const s2 = setup(35);
    battleCues(s2.b, mem2, 0);
    put(s2.zs[0], s2.me, 1, 0); put(s2.zs[1], s2.me, 0, 2); put(s2.zs[2], s2.me, 2, 2); put(s2.zs[3], s2.me, -2, 1);
    run(s2.b, mem2, 0.1, 20, again);
    check(JSON.stringify(again.filter((c) => c.name === "zBreath").map((c) => [c.t, c.n])) === JSON.stringify(log.filter((c) => c.name === "zBreath").map((c) => [c.t, c.n])), "the same battle: the same breaths");
    b.night = true;
    const night = [];
    run(b, mem, 20.1, 10, night);
    check(night.filter((c) => c.name === "zBreath").every((c) => c.gain > 1.2), "more present at night");
  }
  // The kinds.
  const B = Z.BREATH;
  check(Z.recipeFor("swarm", "breath") === "silent" && Z.recipeFor("walker", "breath") === "breathe" && Z.recipeFor("armoured", "breath") === "breathe" && Z.PROFILE.armoured.muffle > 0,
    "every kind breathes but the worm swarm (its squirm) and a Sleeper; the armoured dead through the helmet");
  const per = (k) => Z.breathPlan(k, 12345, 0).pair;
  check(B.brute.band < B.walker.band && B.walker.band < B.runner.band && per("brute") > per("walker") && per("walker") > per("runner") && B.runner.pairs === 2,
    `a brute deep and slow (${per("brute").toFixed(1)} s a breath), a walker (${per("walker").toFixed(1)} s), a runner fast and ragged (${per("runner").toFixed(1)} s, panting two)`);
  check(B.crawler.hiss === 1 && B.spitter.wet === 1 && B.carrier.wet === 1, "a crawler wheezes and hisses, spitters bubble, Carriers gurgle");
  check(Z.BREATH_LEVEL <= Z.LEVELS.moan * 0.5 && Z.ZOMBIE_LIMITS.zBreath.max === 2 && Z.Z_PRIORITY.zBreath > Z.Z_PRIORITY.zIdle,
    `quiet: its peak ${Z.BREATH_LEVEL} against a moan's ${Z.LEVELS.moan}; two at a time; the last in a busy frame`);
}

// ---------- 7. the map ----------
console.log("The map");
{
  const st = createWorld({ seed: 9, factionCount: 4 });
  st.started = true;
  const h = hub(st);
  check(Z.hordeAmbience(st).horde === 0 && Z.hordeAmbience(st).hive === 0, "no horde, no hive: silence");
  const at = (d) => st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === d && !st.bases.some((b) => b !== h && st.grid.distance(t.id, b.tile) < d));
  const t2 = at(2), t6 = at(6), t12 = at(12), tFar = st.tiles.find((t) => !st.bases.some((b) => st.grid.distance(t.id, b.tile) <= Z.HORDE_HEAR));
  st.hour = 12;
  const lv = (tile, size) => { st.hordes = [{ id: 1, tile: tile.id, size }]; st.live.add(tile.id); return Z.hordeAmbience(st); };
  const n2 = lv(t2, 60), n6 = lv(t6, 60), big = lv(t6, 300), small = lv(t6, 12);
  check(n2.horde > n6.horde && n6.horde > 0, `a horde 2 tiles off is louder than one 6 off (${n2.horde} > ${n6.horde})`);
  check(big.horde > n6.horde && n6.horde > small.horde, `bigger is louder (12: ${small.horde}, 60: ${n6.horde}, 300: ${big.horde})`);
  const n12 = lv(t12, 60);
  check(n12.horde > 0 && n12.horde < n6.horde, `the range is ${Z.HORDE_HEAR} tiles: a horde 12 tiles off is heard, faintly (${n12.horde})`);
  const fall = [2, 3, 4, 6, 8, 10, 12, 14, 15, 16].map((d) => Z.hordeDistLevel(d));
  check(fall.every((v, i) => !i || v <= fall[i - 1]) && fall[0] === 1 && fall[1] > 0.85 && fall[fall.length - 1] === 0 && fall.slice(1).every((v, i) => fall[i] - v < 0.2),
    `a smooth fall-off with distance (${fall.map((v) => v.toFixed(2)).join(" ")})`);
  check(lv(tFar, 300).horde === 0, "a horde beyond that from your bases and teams: not heard");
  check(n2.horde >= 0.45 && lv(t2, 300).horde > 0.7 && lv(t2, 12).horde < 0.35, `within 2 tiles by day: 60 of the dead ${n2.horde}, 300 roar (${lv(t2, 300).horde}), 12 mutter (${lv(t2, 12).horde})`);
  // Three hordes closing on a base: they add up, softly, and never pass 1.
  st.hordes = [{ id: 1, tile: t2.id, size: 300 }, { id: 2, tile: at(3).id, size: 200 }, { id: 3, tile: t6.id, size: 150 }, { id: 4, tile: at(4).id, size: 400 }];
  for (const h of st.hordes) st.live.add(h.tile);
  const three = Z.hordeAmbience(st);
  st.hordes = [st.hordes[0]];
  const one = Z.hordeAmbience(st);
  check(three.horde > one.horde && three.horde <= 1 && three.count === 4, `four big hordes at once: ${three.horde} (one of them alone ${one.horde}); never past 1`);
  st.live.delete(t2.id); st.hordes = [{ id: 1, tile: t2.id, size: 60 }];
  check(Z.hordeAmbience(st).horde === 0, "a horde out of sight: not heard");
  st.hour = 1;
  const night = lv(t2, 60);
  check(night.horde > n2.horde && night.night === 1, `at night it is more present (${n2.horde} → ${night.horde})`);
  st.hordes = [];
  st.hives = [{ id: 1, tile: t2.id, bossReady: false }];
  st.tiles[t2.id] = { ...st.tiles[t2.id], hive: true };
  st.live.add(t2.id);
  const hv = Z.hordeAmbience(st);
  st.hives[0].bossReady = true;
  const hvb = Z.hordeAmbience(st);
  check(hv.hive > 0 && hvb.hive > hv.hive, `a hive 2 tiles off: its drone (${hv.hive}; with the Broodmother ready ${hvb.hive})`);
  st.live.delete(t2.id); st.knowledge = {};
  check(Z.hordeAmbience(st).hive === 0, "a hive you do not know of: not heard");
  // The layer on a stub: swells now and then, the heartbeat while a hive is near, let go in silence.
  const S = stub();
  const out = S.ctx.createGain();
  let layer = null;
  for (let t = 1; t < 40; t += 0.25) layer = Z.zombieMapAmbience(S.ctx, out, { horde: 0.6, hive: 0.7, near: 2, size: 80, night: 1, close: 0.7 }, t) || layer;
  check(layer && layer.swells >= 2 && layer.swells <= 8, `the moaning swells now and then, not all the time (${layer && layer.swells} swells in 40 s)`);
  check(layer && layer.beats >= 25 && layer.beats <= 40, `the hive's heartbeat (${layer && layer.beats} beats in 40 s)`);
  let gone = false;
  for (let t = 40; t < 50; t += 0.25) if (Z.zombieMapAmbience(S.ctx, out, null, t) === null) gone = true;
  check(gone && !S.bad.length, `quiet again: the layer is let go${S.bad.length ? ` (${S.bad.slice(0, 3).join(", ")})` : ""}`);
  const up = 20 * Math.log10(Z.MAP_LEVELS.horde / Z.MAP_HORDE_OLD);
  check(up >= 8 && Z.MAP_LEVELS.hive <= 0.15, `the hordes are louder than before (+${up.toFixed(1)} dB), the hive stays low (${Z.MAP_LEVELS.hive})`);
  // The limiter on the horde bed, and the Map horde volume.
  const S2 = stub();
  const lay = Z.makeMapLayer(S2.ctx, S2.ctx.createGain(), 0);
  lay.update({ horde: 1, hive: 0, near: 1, size: 900, big: 1, night: 1, close: 1 }, 1, 2);
  check(lay.level <= Z.MAP_LEVELS.horde * 2 + 1e-9 && !S2.bad.length, `at full level and the slider at the top the bed is ${lay.level.toFixed(2)} into a soft limiter, then the ambience bus`);
  const AU = await import("../src/ui/audio.js");
  const so = AU.soundOptions({});
  check(so.horde === 0.7 && AU.hordeVolume(so.horde) === 1 && AU.hordeVolume(0) === 0 && AU.hordeVolume(1) > 1.9 && AU.soundOptions({ sound: { horde: 5 } }).horde === 1,
    "the Map horde volume: 70% by default (× 1), 0 is silent, 100% about +6 dB, bad values clamped");
  // The Zombie volume: 0–150%, 100% the new louder level; the zombie bus +4 dB into a soft limiter.
  const zo = AU.soundOptions({ sound: { zombie: 9 } }), zd = AU.soundOptions({});
  check(zd.zombie === 1 && zo.zombie === 1.5 && AU.soundOptions({ sound: { zombie: -1 } }).zombie === 0 && Z.zombieVolume(1) === 1 && Z.zombieVolume(1.5) === 2.25 && Z.zombieVolume(0) === 0,
    "the Zombie volume: 100% by default, up to 150% (× 2.25), clamped");
  const zh = AU.soundOptionsHtml({ sound: { zombie: 1.2 } });
  check(/data-k="zombie"/.test(zh) && /max="150"[^>]*value="120"|value="120"[^>]*max="150"|max="150" step="5" value="120"/.test(zh), "Options → Sound has the Zombies slider (0–150%) at the saved level");
  const S3 = stub();
  const busOut = S3.ctx.createGain();
  const zb = Z.makeZombieBus(S3.ctx, busOut);
  zb.setVolume(1.5, 0, true);
  check(Math.abs(20 * Math.log10(Z.ZOMBIE_BUS_GAIN) - 4) < 0.05 && zb.comp && zb.comp.ratio.value >= 10 && !S3.bad.length, `the zombie bus: +${(20 * Math.log10(Z.ZOMBIE_BUS_GAIN)).toFixed(1)} dB, a soft limiter (ratio ${zb.comp.ratio.value}) and a soft clip at -1 dBFS`);
  check(/data-k="horde"/.test(AU.soundOptionsHtml({ sound: { horde: 0.4 } })) && /value="40"/.test(AU.soundOptionsHtml({ sound: { horde: 0.4 } })), "Options → Sound has the Map hordes slider at the saved level");
}

// ---------- 7b. routing (gun-sfx's spatial chain) ----------
console.log("Routing");
{
  const G = await import("../src/ui/gunsfx.js");
  const S = stub();
  S.ctx.destination = S.ctx.createGain();
  S.ctx.createConvolver = () => ({ ...S.ctx.createGain(), buffer: null }); // the room's reverb
  G.installBus(S.ctx, S.ctx.destination);
  const head = (o = {}) => Z.zRoute(S.ctx, null, 0, o).gain.value; // out null: on a context with a battle bus it is not used
  const g1 = head({ dist: 0 });
  G.setGunVolume(2.25);
  const gGuns = head({ dist: 0 });
  Z.setZombieVolume(1.5);
  const gZ = head({ dist: 0 }), gun = G.GUNVOL.v;
  Z.setZombieVolume(0);
  const g0 = head({ dist: 0 });
  Z.setZombieVolume(1); G.setGunVolume(1);
  const far = head({ dist: 0, far: true }), d12 = head({ dist: 12 });
  check(Math.abs(g1 - Z.ZOMBIE_BUS_GAIN) < 1e-9 && gGuns === g1 && Math.abs(gZ - Z.ZOMBIE_BUS_GAIN * 2.25) < 1e-9 && gun === 2.25 && g0 === 0 && !S.bad.length,
    `a voice plays into the battle bus at the zombie gain (+4 dB × the Zombies slider: ${g1.toFixed(3)}, at 150% ${gZ.toFixed(3)}, at 0 silent); the Gunfire slider leaves it (${gGuns.toFixed(3)}) and it leaves the Gunfire (${gun})`);
  check(Math.abs(far / g1 - Z.FAR_GAIN) < 1e-9 && d12 < g1 * 0.8, `a voice made to carry ×${Z.FAR_GAIN}; 12 tiles off it falls with gun-sfx's distance (${(d12 / g1).toFixed(2)})`);
  const L = Z.zListener(null, { w: 20, h: 20, units: [{ id: 1, side: "player", x: 2, y: 10 }] }, null);
  const near = Z.zPlace(L, 3, 10), away = Z.zPlace(L, 18, 10);
  check(near.sp && away.sp && away.dist > near.dist && away.pan > 0 && away.sp.gain < near.sp.gain && away.sp.lp < near.sp.lp, `headless (no view): heard from your people (${near.dist} tiles: ${near.sp.gain.toFixed(2)}, ${away.dist} tiles to the right: ${away.sp.gain.toFixed(2)}, pan ${away.pan})`);
}

// ---------- 8. determinism ----------
console.log("Determinism");
{
  const run = (withSound) => {
    const [x] = battles(26, ["field-forest"]);
    const { st, b } = x;
    const mem = {};
    let t = 0;
    for (let turn = 0; turn < 5 && !b.over; turn++) {
      C.combatAct(st, { type: "end" });
      if (withSound) { battleCues(b, mem, (t += 1)); battleCrowd(b); }
      if (b.phase === "enemy") {
        for (let i = 0; i < 200 && b.phase === "enemy" && !b.over; i++) {
          if (!C.enemyStep(st)) break;
          if (withSound) { battleCues(b, mem, (t += 0.3)); battleCrowd(b); }
        }
      }
    }
    // What the battle did (ids of people and bases run on across worlds in one process, so they are left out).
    return JSON.stringify({ rng: b.rng, turn: b.turn, phase: b.phase, over: b.over, fx: b.fx, cells: b.cells.map((c) => c.k).join(),
      units: b.units.map((u) => [u.id, u.side, u.kind, u.ztype, u.x, u.y, u.hp, !!u.dead, !!u.down, !!u.aware, u.ap]), log: (b.log || []).map((l) => l.text || l) });
  };
  const a = run(false), a2 = run(false), b2 = run(true);
  check(a === a2, "the same battle twice without sound: the same (the check below means something)");
  check(a === b2, `a battle against the dead plays out the same with and without the sound layer (${a.length} chars of state)`);
  const st = createWorld({ seed: 11, factionCount: 4 });
  st.hordes.push({ id: 77, tile: hub(st).tile, size: 50 });
  const before = JSON.stringify(st.hordes) + JSON.stringify([...st.live]) + st.hour + JSON.stringify(st.rng || null);
  for (let i = 0; i < 20; i++) Z.hordeAmbience(st);
  check(JSON.stringify(st.hordes) + JSON.stringify([...st.live]) + st.hour + JSON.stringify(st.rng || null) === before, "reading the map for the ambience changes nothing");
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
