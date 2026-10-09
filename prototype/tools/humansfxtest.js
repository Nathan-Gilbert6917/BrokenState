// The people's voices (ui/humansfx.js; soundcues.js calls humanCues each battle frame, audio.js plays them, barks.js
// shouts with them): headless checks with no speakers.
// - A voice per person: stable, different between people, by looks and traits; every kind of enemy has a style.
// - Each trigger: hurt, a cry on a critical hit, going down, dying, revived, effort on blows and throws, a raider's laugh
//   and a zealot's moan on a kill, deafened, panic, hands up; by state now and then: pinned down, tied up, bleeding,
//   sick, hurt and moving; the bite's victim in their own voice.
// - The cap (2 at once), the cooldown a person; the barks' shout; the base murmur by the hour and the scream at a base;
//   every recipe built on a stub context; determinism.
// Usage: node tools/humansfxtest.js
import * as C from "../src/sim/combat.js";
import { createWorld, hub } from "../src/sim/world.js";
import { battles } from "./isobattles.js";
import { battleCues } from "../src/ui/soundcues.js";
import * as H from "../src/ui/humansfx.js";
import * as Z from "../src/ui/zombiesfx.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

function stub() {
  const bad = [];
  let nodes = 0, started = 0, stopped = 0;
  const param = (name, v = 0) => {
    const p = { value: v };
    const fin = (x, what) => { if (!Number.isFinite(x)) bad.push(`${name}.${what}(${x})`); };
    p.setValueAtTime = (x, t) => { fin(x, "set"); fin(t, "setT"); return p; };
    p.linearRampToValueAtTime = (x, t) => { fin(x, "lin"); fin(t, "linT"); return p; };
    p.exponentialRampToValueAtTime = (x, t) => { fin(x, "exp"); if (!(x > 0)) bad.push(`${name}.exp(${x})`); fin(t, "expT"); return p; };
    p.setTargetAtTime = (x, t, k) => { fin(x, "tgt"); fin(t, "tgtT"); return p; };
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
    createDynamicsCompressor: () => node({ threshold: param("thr"), knee: param("knee"), ratio: param("ratio"), attack: param("att"), release: param("rel") }),
  };
  return { ctx, bad, get nodes() { return nodes; }, reset() { nodes = 0; }, get started() { return started; }, get stopped() { return stopped; } };
}

// ---------- 1. a voice per person ----------
console.log("Voices");
{
  const vs = Array.from({ length: 300 }, (_, i) => H.humanVoice({ id: i + 1, side: "player" }));
  check(JSON.stringify(H.humanVoice({ id: 7, side: "player" })) === JSON.stringify(H.humanVoice({ id: 7, side: "player" })), "the same person always has the same voice");
  check(new Set(vs.map((v) => [v.f0, v.shift, v.rasp, v.breath].join())).size === 300, "300 people: 300 voices");
  const f0s = vs.map((v) => v.f0), lows = vs.filter((v) => v.low).length;
  check(Math.min(...f0s) < 110 && Math.max(...f0s) > 230 && lows > 100 && lows < 200, `low and high registers (${Math.min(...f0s)}–${Math.max(...f0s)} Hz, ${lows} of 300 low)`);
  const st = createWorld({ seed: 5, factionCount: 3 });
  const s = st.survivors[0];
  s.appearance = { ...(s.appearance || {}), facial: "beard", build: "heavy" };
  const bearded = H.humanVoice({ id: 99, sid: s.id, side: "player" }, st);
  s.appearance = { ...s.appearance, facial: "none", build: "slim" };
  const plain = H.humanVoice({ id: 99, sid: s.id, side: "player" }, st);
  check(bearded.low && bearded.shift < plain.shift, `a beard puts a voice low, a heavy build darkens it (${bearded.shift} vs ${plain.shift})`);
  s.traits = ["loud", "coward"];
  const loud = H.humanVoice({ id: 99, sid: s.id, side: "player" }, st);
  s.traits = [];
  const quiet = H.humanVoice({ id: 99, sid: s.id, side: "player" }, st);
  check(loud.rasp > quiet.rasp && loud.breath > quiet.breath, "Loud: a harsher throat; Coward: breathier");
  const older = vs.filter((v) => v.age === "older"), young = vs.filter((v) => v.age === "young");
  check(older.length > 30 && young.length > 30 && older.reduce((a, v) => a + v.rasp, 0) / older.length > young.reduce((a, v) => a + v.rasp, 0) / young.length, "older voices are raspier (seeded ages: the game keeps none)");
  check(H.humanVoice({ id: 5, sid: s.id, side: "player" }, st).seed === H.humanVoice({ id: 812, sid: s.id, side: "player" }, st).seed, "a person's voice is theirs, whatever the battle unit's id (the map's scream and the battle's cry match)");
  const kits = Object.keys(C.KITS);
  check(kits.every((k) => H.STYLE[H.humanStyle({ side: "enemy", kit: k })]) && H.humanStyle({ side: "player", kit: "raiders" }) === "survivor",
    `every kind of enemy has a style (${kits.map((k) => `${k}→${H.humanStyle({ side: "enemy", kit: k })}`).join(", ")}); your people are survivors`);
  check(H.STYLE.raider.taunt && H.STYLE.soldier.clipped && H.STYLE.zealot.ecstatic && H.STYLE.soldier.gain < 1, "raiders taunt, soldiers are clipped and quieter, zealots ecstatic");
}

// ---------- 2. the triggers ----------
console.log("Battle");
const fresh = (seed = 41) => {
  const [x] = battles(seed, ["field-town"]);
  const { st, b } = x;
  const mem = { rng: Z.mulberry(seed) };
  battleCues(b, mem, 0, st);
  battleCues(b, mem, 0.05, st); // the first frame after: the voices' memory starts
  let t = 0.05;
  const step = (dt = 3) => battleCues(b, mem, (t += dt), st);
  return { st, b, mem, step, me: b.units.filter((u) => u.side === "player" && !u.dead), foes: b.units.filter((u) => u.side === "enemy" && !u.dead) };
};
const has = (cs, n, unit) => cs.some((c) => c.name === n && (unit == null || c.unit === unit));
const names = (cs) => cs.filter((c) => /^h[A-Z]/.test(c.name)).map((c) => c.name).join(", ");
{
  const { b, step, me, foes } = fresh();
  const [a, bb, cc] = me, raider = foes[0];
  a.hp -= 6;
  let cs = step();
  check(has(cs, "hHurt", a.id) && cs.find((c) => c.name === "hHurt").voice, `hurt: a grunt in their own voice (${names(cs)})`);
  a.hp -= Math.ceil((a.maxHp || 100) * 0.3);
  cs = step();
  check(has(cs, "hCry", a.id), `a bad wound: a sharp cry (${names(cs)})`);
  C.fx(b, { type: "melee", from: [raider.x, raider.y], to: [bb.x, bb.y], hit: true, crit: true, dmg: 4, side: "enemy" });
  bb.hp -= 4;
  cs = step();
  check(has(cs, "hCry", bb.id) && has(cs, "hEffort", raider.id), `a critical blow: the victim cries, the raider grunts with the effort (${names(cs)})`);
  C.fx(b, { type: "throw", from: [cc.x, cc.y], to: [raider.x, raider.y], item: "molotov" });
  cs = step();
  check(has(cs, "hEffort", cc.id), "a throw: an effort grunt");
  a.down = true;
  cs = step();
  check(has(cs, "hDown", a.id), `going down: a strangled cry (${names(cs)})`);
  a.down = false;
  cs = step();
  check(has(cs, "hGasp", a.id), "revived: a ragged gasp");
  C.fx(b, { type: "melee", from: [raider.x, raider.y], to: [a.x, a.y], hit: true, crit: false, dmg: 50, side: "enemy" });
  a.dead = true;
  cs = step();
  const laugh = cs.find((c) => c.name === "hTaunt");
  check(has(cs, "hDeath", a.id) && laugh && laugh.unit === raider.id && laugh.delay > 0.3, `killed by a raider: a last breath, then the raider's harsh laugh (${names(cs)})`);
  raider.kit = "zealots";
  C.fx(b, { type: "melee", from: [raider.x, raider.y], to: [bb.x, bb.y], hit: true, crit: false, dmg: 50, side: "enemy" });
  bb.dead = true;
  cs = step();
  check(has(cs, "hEcstatic", raider.id), "killed by a zealot: an ecstatic moan");
  cc.deaf = 3;
  cs = step();
  check(has(cs, "hDeaf", cc.id), "the ears gone: a muffled groan");
  C.fx(b, { type: "loot", to: [cc.x, cc.y], text: "PANIC" });
  cs = step();
  check(has(cs, "hPanic", cc.id), "a Nightmare's scream: panic");
  const foe2 = foes[1];
  C.fx(b, { type: "melee", from: [foe2.x, foe2.y], to: [foe2.x, foe2.y], hit: true, crit: false, dmg: 0, side: "player", text: "HANDS UP" });
  cs = step();
  check(has(cs, "hPlea", foe2.id), "hands up: a whimper");
}
{
  // Now and then, by state (within a few seconds of quiet).
  const { st, b, step, me } = fresh(42);
  const [p, q, r, s4, t5] = me;
  for (const u of me) u.hp = u.maxHp || 100;
  p.suppressed = 1; q.captive = true; q.tied = true; r.bleeding = 2;
  const surv = st.survivors.find((x) => x.id === s4.sid);
  if (surv) surv.conditions = [{ key: "chestcold", sev: 30 }];
  if (t5) { t5.hp = Math.floor((t5.maxHp || 100) * 0.3); t5.movedT = b.turn; }
  const heard = new Map();
  for (let i = 0; i < 40; i++) for (const c of step(0.5)) if (/^h[A-Z]/.test(c.name)) heard.set(`${c.unit}:${c.name}`, true);
  const h = (u, n) => heard.has(`${u.id}:${n}`);
  check(h(p, "hScared"), "pinned down: frightened breathing");
  check(h(q, "hMuffled"), "tied and gagged: muffled sounds");
  check(h(r, "hWheeze"), "bleeding: wet wheezing");
  check(!surv || h(s4, "hCough"), "sick (a chest cold): coughing");
  check(!t5 || h(t5, "hPant"), "badly hurt and moving: panting");
}
{
  // The bite's victim screams in their own voice, and no extra grunt for it.
  const [x] = battles(43, ["field-forest"]);
  const { st, b } = x;
  const mem = {};
  battleCues(b, mem, 0, st);
  battleCues(b, mem, 0.05, st);
  const me = b.units.find((u) => u.side === "player" && !u.dead), z = b.units.find((u) => u.kind === "zombie" && !u.dead);
  z.x = me.x + 1; z.y = me.y;
  C.fx(b, { type: "melee", from: [z.x, z.y], to: [me.x, me.y], hit: true, crit: false, dmg: 8, side: "enemy" });
  me.hp -= 8;
  const cs = battleCues(b, mem, 2, st);
  const bite = cs.find((c) => c.name === "zBite");
  check(bite && bite.victim && bite.victim.seed === H.humanVoice(me, st).seed && !has(cs, "hHurt", me.id) && !has(cs, "hCry", me.id), "a bite: the victim screams in their own voice inside the bite (no second grunt)");
}
{
  // The cap: six hurt at once, two heard; the same person again within a second: once.
  const { b, step, me } = fresh(44);
  for (const u of me) u.hp -= 5;
  const cs = step();
  check(cs.filter((c) => /^h[A-Z]/.test(c.name)).length <= H.HUMAN_MAX, `six hurt in one frame: ${cs.filter((c) => /^h[A-Z]/.test(c.name)).length} voices (at most ${H.HUMAN_MAX})`);
  const u = me[0];
  u.hp -= 3;
  const c1 = step(5);
  u.hp -= 3;
  const c2 = step(0.3);
  check(has(c1, "hHurt", u.id) && !has(c2, "hHurt", u.id), "the same person hurt twice within a second: one grunt");
  u.down = true;
  check(has(step(0.1), "hDown", u.id), "but going down is always heard");
  check(Object.keys(H.HUMAN_LIMITS).length === H.HUMAN_SOUND_NAMES.length && H.HUMAN_SOUND_NAMES.every((n) => H.H_PRIORITY[n] != null && H.HUMAN_LIMITS[n].max <= 2), "every voice has a throttle and a place in the volley");
}

// ---------- 3. the barks, the map ----------
console.log("Barks and the map");
{
  const [x] = battles(45, ["field-town"]);
  const u = x.b.units.find((v) => v.side === "player");
  const [n, o] = H.barkShout(x.st, u, "mandown"), [, o2] = H.barkShout(x.st, u, "goingdown");
  check(n === "hShout" && o.voice.seed === H.humanVoice(u, x.st).seed && o.tone === "urgent" && o2.tone === "strained", "the barks' shout: the speaker's own voice, urgent for \"man down\", strained going down");
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/ui/barks.js", import.meta.url), "utf8");
  check(/barkShout\(state, e\.unit, e\.trig\)/.test(src), "ui/barks.js shouts with it (the chirp only if the shout is throttled)");
  const AU = await import("../src/ui/audio.js");
  check(H.HUMAN_SOUND_NAMES.every((nm) => AU.VOICES[nm] && AU.VOICES[nm].routes), "audio.js plays every voice (placed like the dead's)");
}
{
  const m = (h, n = 10) => H.murmurLevel(h, n);
  check(m(19) > m(12) && m(12) > m(7) && m(2) < 0.1 && m(19, 0) === 0 && m(19, 2) < m(19, 10), `a base's murmur: the evening meal ${m(19)}, midday ${m(12)}, morning ${m(7)}, the night ${m(2)}; empty: silent; fewer people: quieter`);
  const st = createWorld({ seed: 6, factionCount: 3 });
  const h = hub(st);
  st.hour = 19;
  const bm = H.baseMurmur(st, h.tile);
  check(bm && bm.people > 0 && bm.level > 0.2 && H.baseMurmur(st, -1) === null, `the selected base with ${bm && bm.people} home: ${bm && bm.level}; nothing selected: nothing`);
  const S = stub();
  const out = S.ctx.createGain();
  let r = null;
  for (let t = 1; t < 40; t += 0.25) r = H.humanMapVoices(S.ctx, out, st, h.tile, t);
  check(r.level > 0 && !S.bad.length, `the murmur plays (${r.people} people), no bad parameters`);
  const before = S.nodes;
  for (let t = 40; t < 50; t += 0.25) H.humanMapVoices(S.ctx, out, null, null, t);
  check(S.nodes - before < 40, "quiet again off the base: the murmur is let go");
  const dead = st.survivors.find((s) => s.alive !== false && s.location && s.location.kind === "base");
  H.deathsAtBases(st);
  dead.alive = false;
  st.hour += 1;
  check(H.deathsAtBases(st).some((s) => s.id === dead.id) && H.deathsAtBases(st).length === 0, "someone dies at a base: one scream, once");
  check(H.MURMUR_LEVEL <= 0.15, `the murmur stays a background (level ${H.MURMUR_LEVEL} under the ambience slider)`);
}

// ---------- 4. every recipe on a stub ----------
console.log("Recipes");
{
  const S = stub();
  const cost = {}, errs = [];
  for (const n of H.HUMAN_SOUND_NAMES) for (const style of ["survivor", "raider", "soldier", "zealot"]) {
    S.reset();
    try { H.playHuman(n, S.ctx, S.ctx.createGain(), 0.5, { voice: { ...H.humanVoice({ id: 3, side: "enemy", kit: "raiders" }), style }, sev: 0.6, tone: "urgent", dist: 4 }); } catch (e) { errs.push(`${n}: ${e.message}`); }
    cost[n] = Math.max(cost[n] || 0, S.nodes);
  }
  check(!errs.length && !S.bad.length, `every voice builds${errs.length ? `: ${errs.slice(0, 3).join("; ")}` : ""}${S.bad.length ? `: ${S.bad.slice(0, 3).join(", ")}` : ""}`);
  check(S.stopped >= S.started, `every source started is stopped (${S.started}/${S.stopped})`);
  console.log(`    nodes per voice: ${Object.entries(cost).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(", ")}`);
  check(Math.max(...Object.values(cost)) < 220, "none too costly");
}

// ---------- 5. determinism ----------
console.log("Determinism");
{
  const run = (withSound) => {
    const [x] = battles(46, ["field-town"]);
    const { st, b } = x;
    const mem = {}, log = [];
    let t = 0;
    for (let turn = 0; turn < 4 && !b.over; turn++) {
      C.combatAct(st, { type: "end" });
      if (withSound) for (const c of battleCues(b, mem, (t += 1), st)) if (/^h[A-Z]/.test(c.name)) log.push([t, c.name, c.unit]);
      for (let i = 0; i < 200 && b.phase === "enemy" && !b.over; i++) {
        if (!C.enemyStep(st)) break;
        if (withSound) for (const c of battleCues(b, mem, (t += 0.3), st)) if (/^h[A-Z]/.test(c.name)) log.push([t, c.name, c.unit]);
      }
    }
    return { state: JSON.stringify({ rng: b.rng, turn: b.turn, fx: b.fx, units: b.units.map((u) => [u.id, u.x, u.y, u.hp, !!u.dead, !!u.down]) }), log: JSON.stringify(log) };
  };
  const a = run(false), b1 = run(true), b2 = run(true);
  check(a.state === b1.state, "a fight against raiders plays out the same with and without the voices");
  check(b1.log === b2.log && b1.log.length > 2, `the same fight, the same voices (${JSON.parse(b1.log).length} heard)`);
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
