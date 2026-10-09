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
  const src = (extra) => node({ start(t, off) { started++; if (!Number.isFinite(t ?? 0) || !Number.isFinite(off ?? 0)) bad.push("start"); }, stop(t) { stopped++; if (!Number.isFinite(t)) bad.push("stop"); }, ...extra });
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
  };
  return { ctx, bad, get nodes() { return nodes; }, get started() { return started; }, get stopped() { return stopped; }, reset() { nodes = 0; } };
}

// ---------- 1. voice sets ----------
console.log("Voice sets");
{
  const kinds = Object.keys(Z.PROFILE);
  const zk = Object.keys(ZTYPES).map((k) => Z.voiceKind({ kind: "zombie", ztype: k }));
  check(Object.keys(ZTYPES).every((k, i) => Z.VOICE_SETS[zk[i]]), `every ZTYPES kind has a voice set (${Object.keys(ZTYPES).map((k, i) => `${k}→${zk[i]}`).join(", ")})`);
  check(Z.voiceKind({ kind: "zombie", ztype: "soldier" }) === "armoured" && Z.voiceKind({ kind: "zombie", ztype: "riot" }) === "armoured", "the armoured dead (soldiers, riot police) clank");
  check(Z.voiceKind({ kind: "zombie" }) === "walker" && Z.voiceKind({ kind: "zombie", turned: true, name: "Dana (turned)" }) === "walker", "the common dead and the turned: walkers");
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
  check(names(cs).join() === "zAttack", `it lunges and misses: ${names(cs).join(", ")}`);
  C.fx(b, { type: "melee", from: [walker.x, walker.y], to: [me.x, me.y], hit: true, crit: false, dmg: 9, side: "enemy" });
  cs = step();
  const bite = cs.find((c) => c.name === "zBite");
  check(!!bite && bite.human === true && bite.kind === "walker" && !cs.some((c) => c.name === "bite"), "it bites one of yours: the tearing bite, the victim screams (human), the old bite not played too");
  check(bite && bite.seed === Z.unitSeed(b, walker) && Number.isFinite(bite.pan) && Number.isFinite(bite.dist), "the cue carries the unit's voice seed, its pan and distance");
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
  C.fx(b, { type: "move", unit: brute.id, from: [brute.x - 1, brute.y], path: [[brute.x, brute.y]] });
  cs = step();
  check(!has(cs, "zStep") && has(cs, "zAggro", "brute"), "a brute's first move: its roar, and no footsteps (another branch has them)");
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

// ---------- 7. the map ----------
console.log("The map");
{
  const st = createWorld({ seed: 9, factionCount: 4 });
  st.started = true;
  const h = hub(st);
  check(Z.hordeAmbience(st).horde === 0 && Z.hordeAmbience(st).hive === 0, "no horde, no hive: silence");
  const at = (d) => st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === d && !st.bases.some((b) => b !== h && st.grid.distance(t.id, b.tile) < d));
  const t2 = at(2), t6 = at(6), t12 = st.tiles.find((t) => !st.bases.some((b) => st.grid.distance(t.id, b.tile) <= 10));
  st.hour = 12;
  const lv = (tile, size) => { st.hordes = [{ id: 1, tile: tile.id, size }]; st.live.add(tile.id); return Z.hordeAmbience(st); };
  const n2 = lv(t2, 60), n6 = lv(t6, 60), big = lv(t6, 300), small = lv(t6, 12);
  check(n2.horde > n6.horde && n6.horde > 0, `a horde 2 tiles off is louder than one 6 off (${n2.horde} > ${n6.horde})`);
  check(big.horde > n6.horde && n6.horde > small.horde, `bigger is louder (12: ${small.horde}, 60: ${n6.horde}, 300: ${big.horde})`);
  check(lv(t12, 300).horde === 0, "a horde far from your bases and teams: not heard");
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
  check(Z.MAP_LEVELS.horde <= 0.25 && Z.MAP_LEVELS.hive <= 0.15, `kept low under the ambience slider (horde ${Z.MAP_LEVELS.horde}, hive ${Z.MAP_LEVELS.hive}; wind is 0.32)`);
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
