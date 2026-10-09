// Music (ui/music.js, musicdirector.js, musicscore.js, musicsynth.js): headless checks with no speakers, on a stub
// AudioContext that keeps every node, every start and stop and every call on its params.
// - The director: title, day, night (with a margin at dusk and dawn), winter, the festival, tension (a horde near, a
//   raid warning, a hive seen, a base out of food), crisis (a base under siege, an ambush), the battle's states (no
//   contact, enemies seen, firefight, winning, losing), one of yours down, a death, a base lost, a battle won or lost,
//   game over and victory; hysteresis (no flapping, up fast, down slow); the intensity toggle.
// - The engine: a change of state lands on a bar line (the layers' fades start there); the scheduler keeps its
//   lookahead under jitter and stalls (nothing scheduled in the past); the node budget in the busiest battle music;
//   ducking (depth, recovery, a deeper duck wins, the cues that duck); the pause (muted, unfocused, the group off).
// - The score and the instruments: every state composes, the motif comes back (title, calm, victory), the instruments
//   are in tune and finite, the pad loops without a seam.
// - The settings (the Music group, its switch, intensity follows the action, the Music test) and determinism: the
//   game plays out the same with and without the music reading it.
// Usage: node tools/musictest.js   (it runs itself twice more with --play 0|1 for the determinism check)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createWorld, hub, addCard, tickHour, killSurvivor, removeBase } from "../src/sim/world.js";
import * as C from "../src/sim/combat.js";
import { seasonOfDay } from "../src/sim/weather.js";
import { battles } from "./isobattles.js";
import { readSituation, direct, wanted, isNightHour, DIRECTOR } from "../src/ui/musicdirector.js";
import { STATES, STATE_KEYS, STINGS, STING_KEYS, MOTIF, MODES, stateDef, composeBar, planPhrase, degSemis, midiHz, TONIC, RANK } from "../src/ui/musicscore.js";
import { bakeVoice, makeBank, makeHiss, PITCH_RATE, LOW_RATE, bakeRate } from "../src/ui/musicsynth.js";
import { rngOf } from "../src/ui/sfxdsp.js";

// --play 0|1: twelve days of a world, with (1) or without (0) the music reading it every hour; prints what it ended as.
// Run in a fresh process each (the world's id counters are module state, so two worlds in one process differ anyway).
if (process.argv[2] === "--play") {
  const withMusic = process.argv[3] === "1";
  const w = createWorld({ seed: 31, factionCount: 4 });
  w.started = true;
  const mem = {}, dir = {}, u = { started: true, alertList: [] };
  for (let i = 0; i < 24 * 12; i++) {
    tickHour(w);
    if (withMusic) { const s = readSituation(w, u, mem, i * 0.5); direct(dir, s, i * 0.5); }
    if (w.gameOver) break;
  }
  process.stdout.write(JSON.stringify({ rng: w.rng, hour: w.hour, survivors: w.survivors.map((s) => [s.id, s.alive, s.health, s.mood]), bases: w.bases.map((b) => [b.id, b.stock]), hordes: w.hordes.map((x) => [x.id, x.tile, x.size]), parties: (w.parties || []).length, log: (w.log || []).length, cards: (w.cards || []).map((c) => c.title) }));
  process.exit(0);
}
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();
const AU = await import("../src/ui/audio.js");
const MU = await import("../src/ui/music.js");
const SG = await import("../src/ui/soundgroups.js");
const { createEngine, makeMusicBus, musicGains, musicFrame, bindMusic, MUSIC, LAYER_LEVEL } = MU;

// ---------- a stub AudioContext ----------
function fakeCtx(sr = 48000) {
  const ctx = { sampleRate: sr, currentTime: 0, state: "running", nodes: [], sources: [], bad: [] };
  const param = (name, v = 0) => {
    const p = { value: v, events: [] };
    const fin = (x, what) => { if (!Number.isFinite(x)) ctx.bad.push(`${name}.${what}(${x})`); };
    p.setValueAtTime = (x, t) => { fin(x, "set"); fin(t, "t"); p.events.push(["set", x, t]); return p; };
    p.linearRampToValueAtTime = (x, t) => { fin(x, "lin"); fin(t, "t"); p.events.push(["lin", x, t]); return p; };
    p.exponentialRampToValueAtTime = (x, t) => { fin(x, "exp"); if (!(x > 0)) ctx.bad.push(`${name}.exp(${x})`); p.events.push(["exp", x, t]); return p; };
    p.setTargetAtTime = (x, t, k) => { fin(x, "tgt"); fin(t, "t"); fin(k, "k"); p.events.push(["tgt", x, t, k]); return p; };
    p.cancelScheduledValues = (t) => { p.events.push(["cancel", 0, t]); return p; };
    return p;
  };
  const node = (kind, extra = {}) => { const n = { kind, out: [], connect(d) { if (!d) ctx.bad.push(`${kind}.connect(null)`); n.out.push(d); return d; }, disconnect() {}, ...extra }; ctx.nodes.push(n); return n; };
  Object.assign(ctx, {
    destination: { kind: "destination" },
    createGain: () => node("gain", { gain: param("gain", 1) }),
    createBiquadFilter: () => node("filter", { type: "", frequency: param("freq", 350), Q: param("Q", 1) }),
    createDelay: () => node("delay", { delayTime: param("delay", 0) }),
    createConvolver: () => node("convolver", { normalize: true, buffer: null }),
    createDynamicsCompressor: () => node("comp", { threshold: param("thr", -24), knee: param("knee", 30), ratio: param("ratio", 12), attack: param("att", 0.003), release: param("rel", 0.25) }),
    createOscillator: () => node("osc", { type: "", frequency: param("osc", 440), start() {}, stop() {} }),
    createBufferSource: () => {
      const s = node("source", { buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param("rate", 1), at: null, end: null, made: ctx.currentTime,
        start(t = 0, off = 0) { s.at = t; if (!Number.isFinite(t) || !Number.isFinite(off)) ctx.bad.push("start"); },
        stop(t) { s.end = t; if (!Number.isFinite(t)) ctx.bad.push("stop"); } });
      ctx.sources.push(s);
      return s;
    },
    createBuffer: (ch, len, rate) => { const data = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: (i) => data[i], copyToChannel: (a, i) => data[i].set(a) }; },
  });
  return ctx;
}
// Runs the engine on a virtual clock: steps of `step` s from `from` to `to`, calling fn(t) first each step.
function run(E, ctx, from, to, step = 0.05, fn = null) {
  for (let t = from; t < to; t += step) { ctx.currentTime = t; if (fn) fn(t); E.tick(t); }
}
// Nodes sounding at t on the stub, counted independently of the engine: each note's source (started, not yet stopped)
// and its own gain if it has one (a gain made after the graph); the graph's looping sources are part of the graph.
function soundingOnStub(ctx, graph, t) {
  let n = 0;
  for (const s of ctx.sources) {
    if (graph.has(s) || s.at == null || s.at > t || !(s.end > t)) continue;
    n += s.out[0] && s.out[0].kind === "gain" && !graph.has(s.out[0]) ? 2 : 1;
  }
  return n;
}

// ---------- 1. the director ----------
console.log("The director");
const st = createWorld({ seed: 11, factionCount: 4 });
st.started = true;
const h = hub(st);
const ui = { started: true, alertList: [] };
const look = (mem, s = st, u = ui, now = 0) => readSituation(s, u, mem, now);
{
  check(wanted(look({}, st, { title: true })) === "title" && wanted(look({}, st, { started: false })) === "title", "the title (and the new-run screen): the title theme");
  st.hour = 24 * 3 + 12;
  const noon = look({});
  check(noon.mode === "map" && noon.calm === "day" && noon.level === 0 && wanted(noon) === "day", `noon on the map, nothing near: day (${noon.season})`);
  st.hour = 24 * 3 + 23;
  check(wanted(look({})) === "night", "23:00: night");
  check(!isNightHour(19.7, false) && isNightHour(20.1, false) && isNightHour(5.8, true) && !isNightHour(6.1, true) && isNightHour(19.6, true) && !isNightHour(5.6, false),
    "dusk and dawn with a margin: night from 20:00, day again from 6:00 (the hour on the line does not flip it)");
  // Winter: the calendar's first winter day.
  let wd = 0; while (seasonOfDay(wd).key !== "winter" && wd < 400) wd++;
  const sw = createWorld({ seed: 12, factionCount: 3 }); sw.started = true; sw.hour = wd * 24 + 12;
  const ws = look({}, sw);
  const wdef = stateDef("day", { season: ws.season }), ndef = stateDef("night", { season: "winter" }), sdef = stateDef("day", { season: "summer" }), base = stateDef("day", { season: "spring" });
  check(ws.season === "winter" && wanted(ws) === "day" && wdef.winter && wdef.density < base.density && wdef.mode === "aeolian" && wdef.keysInst === "bell" && ndef.winter, `winter (day ${wd}): colder and sparser (aeolian, bells, density ${wdef.density.toFixed(2)} < ${base.density.toFixed(2)})`);
  check(sdef.mode === "mixolydian" && sdef.bpm > base.bpm && sdef.density > base.density, "summer: warmer (the mixolydian, a touch faster and fuller)");
  // The festival.
  st.hour = 24 * 3 + 12;
  st.festival = { year: 1, postponed: null, last: { day: Math.floor(st.hour / 24) + 1, baseId: h.id, kind: "full" } };
  const fest = look({});
  check(fest.calm === "festival" && wanted(fest) === "festival" && STATES.festival.meter === 3 && STATES.festival.pluckInst === "banjo", `the harvest festival day: the festival waltz (${fest.calm})`);
  st.festival = null;
  // Tension: a horde near the hub.
  const near = st.tiles.find((t) => t.id !== h.tile && st.grid.distance(t.id, h.tile) === 3);
  const hz = { id: 9101, tile: near.id, size: 60, target: null };
  st.hordes.push(hz); st.live.add(near.id);
  const tn = look({});
  check(tn.level === 1 && wanted(tn) === "tension" && wanted(tn, false) === "day", `a horde 3 tiles from the hub: tension (${tn.why.join("; ")}); with the intensity toggle off: day`);
  st.hordes = st.hordes.filter((x) => x !== hz);
  addCard(st, { title: `Raiders heading for ${h.name}`, choices: [] });
  check(wanted(look({})) === "tension", "a raid warning card: tension");
  st.cards.length = 0;
  ui.alertList = [{ key: `starve:${h.id}`, kind: "starve", tone: "danger" }];
  check(wanted(look({})) === "tension", "a base out of food: tension");
  ui.alertList = [{ key: `food:${h.id}`, kind: "food", tone: "warn" }];
  check(wanted(look({})) === "day", "food running low but not out (a warning): still calm");
  ui.alertList = [];
  // A hive newly seen: tension for a while, then calm; a hive already known on the first look is no news.
  st.hives = st.hives || [];
  const far = st.tiles.find((t) => st.grid.distance(t.id, h.tile) > 10 && !st.live.has(t.id));
  const hm = {};
  look(hm, st, ui, 0);
  st.hives.push({ tile: far.id }); st.live.add(far.id);
  const hv = look(hm, st, ui, 1);
  const hv2 = look(hm, st, ui, 1 + DIRECTOR.HIVE_HOLD + 1);
  const known = look({}, st, ui, 5);
  check(wanted(hv) === "tension" && wanted(hv2) === "day" && wanted(known) === "day", `a hive newly seen: tension for ${DIRECTOR.HIVE_HOLD} s, then calm; a known one on a load: calm`);
  st.hives.pop(); st.live.delete(far.id);
  // Crisis: the hub on alert (a siege), an ambush card.
  h.alert = true;
  const cr = look({});
  check(cr.level === 2 && wanted(cr) === "crisis" && wanted(cr, false) === "day", `the hub on alert (a siege at its walls): crisis (${cr.why.join("; ")}); toggle off: calm`);
  h.alert = false;
  addCard(st, { title: "Ambush", kind: "conflict", conflict: { type: "ambush" }, choices: [] });
  check(wanted(look({})) === "crisis", "a team ambushed (the card): crisis");
  st.cards.length = 0;
  // Deaths and a base lost: the edges, never on a first look.
  const lm = {};
  look(lm);
  const victim = st.survivors.find((s) => s.alive);
  killSurvivor(st, victim, h.tile, "a test");
  const dl = look(lm);
  check(dl.events.some((e) => e.k === "death") && !look(lm).events.length, "a colonist dies: the elegy, once");
  const fresh = {};
  const first = look(fresh);
  check(!first.events.length, "a world first seen (a load): no elegy for the dead already there");
  const ob = st.bases.find((b) => b.id !== h.id && (b.owner == null || b.owner === "player"));
  if (ob) { removeBase(st, ob, "was lost"); check(look(lm).events.some((e) => e.k === "baseLost"), "a base lost: the toll"); }
  else check(true, "(no outpost in this world to lose)");
  // Game over and victory.
  st.gameOver = true;
  check(wanted(look({})) === "gameover", "game over: the full sad theme");
  st.victory = true;
  check(wanted(look({})) === "triumph", "a victory (the coalition's or the hives'): the bittersweet theme");
  st.gameOver = false; st.victory = false;
  check(look({}, st, { ...ui, timelapse: {} }).mode === "hold", "the run's replay: whatever plays goes on");
}
{
  // The battle's states, from a real battle.
  const [town] = battles(21, ["field-town"]);
  const { st: bs, b } = town;
  const bui = { started: true, alertList: [] };
  const mem = {};
  for (const u of b.units) if (u.side === "enemy") u.aware = false;
  let s = readSituation(bs, bui, mem, 0);
  const seeAny = b.units.some((u) => u.side === "enemy" && C.active(u) && C.playerSees(b, u));
  check(s.mode === "battle" && (wanted(s) === "battleQuiet" || (seeAny && wanted(s) === "battleSeen")), `a battle, the enemy unaware: ${wanted(s)} (${seeAny ? "one in sight" : "none in sight"})`);
  for (const u of b.units) if (u.side === "enemy") u.aware = true;
  s = readSituation(bs, bui, mem, 1);
  check(wanted(s) === "battleSeen", "the enemy aware of you: enemies in sight (rising)");
  const me = b.units.find((u) => u.side === "player" && C.active(u)), foe = b.units.find((u) => u.side === "enemy" && C.active(u));
  C.fx(b, { type: "shot", from: [me.x, me.y], to: [foe.x, foe.y], hit: false, side: "player" });
  s = readSituation(bs, bui, mem, 2);
  check(wanted(s) === "battleFight" && s.battle.tide === "even", "a shot: the firefight");
  s = readSituation(bs, bui, mem, 2 + DIRECTOR.FIGHT_HOLD + 1);
  check(wanted(s) === "battleSeen", `no shot for ${DIRECTOR.FIGHT_HOLD} s: back to enemies in sight`);
  // The tide: most of the enemy down -> winning; most of yours -> losing.
  const foes = b.units.filter((u) => u.side === "enemy" && C.active(u));
  const keep = foes.map((u) => u.down);
  for (const u of foes.slice(0, Math.ceil(foes.length * 0.75))) u.down = true;
  C.fx(b, { type: "shot", from: [me.x, me.y], to: [foe.x, foe.y], hit: true, side: "player" });
  s = readSituation(bs, bui, mem, 20);
  check(foes.length < 2 || wanted(s) === "battleWin", `three quarters of the enemy down in a firefight: winning (${s.battle.mine} vs ${s.battle.theirs})`);
  foes.forEach((u, i) => { u.down = keep[i]; });
  const mine = b.units.filter((u) => u.side === "player" && C.active(u));
  const mineKeep = mine.map((u) => u.down);
  for (const u of mine.slice(0, mine.length - 1)) u.down = true;
  C.fx(b, { type: "shot", from: [foe.x, foe.y], to: [me.x, me.y], hit: true, side: "enemy" });
  s = readSituation(bs, bui, mem, 21);
  check(wanted(s) === "battleLose" && s.events.some((e) => e.k === "down"), `all but one of yours down: losing, and the man-down beat (${s.battle.mine} vs ${s.battle.theirs})`);
  mine.forEach((u, i) => { u.down = mineKeep[i]; });
  readSituation(bs, bui, mem, 22);
  const dead = mine[0];
  dead.dead = true;
  s = readSituation(bs, bui, mem, 23);
  check(s.events.some((e) => e.k === "death"), "one of yours killed in battle: the elegy");
  dead.dead = false;
  readSituation(bs, bui, mem, 24);
  b.over = true; b.result = { outcome: "victory" };
  s = readSituation(bs, bui, mem, 25);
  check(s.mode === "map" && s.events.some((e) => e.k === "victory") && !readSituation(bs, bui, mem, 26).events.length, "the battle won: the victory sting, once, and the map's music under the result");
  const m2 = {};
  b.over = false; delete b.result;
  readSituation(bs, bui, m2, 0);
  b.over = true; b.result = { outcome: "retreat" };
  check(readSituation(bs, bui, m2, 1).events.some((e) => e.k === "defeat"), "a retreat (or a defeat): the sombre sting");
  b.over = false; delete b.result;
  const d0 = direct({}, { mode: "battle", battle: { phase: "fight", tide: "even" }, events: [{ k: "victory" }, { k: "down" }], calm: "day", level: 0 }, 0, false);
  check(d0.key === "day" && !d0.stings.length && !d0.down, "intensity toggle off: a battle plays the calm music, no battle stings, no heartbeat");
}
{
  // Hysteresis.
  const dir = {};
  const sit = (level, extra = {}) => ({ mode: "map", calm: "day", level, events: [], ...extra });
  direct(dir, sit(0), 0);
  let flips = 0, last = dir.key;
  for (let i = 1; i <= 60; i++) { const d = direct(dir, sit(i % 2), i * 0.5); if (d.key !== last) { flips++; last = d.key; } }
  check(flips === 0, `a threat flickering every half second for 30 s: no flapping (${flips} changes)`);
  const d1 = direct(dir, sit(1), 40), d2 = direct(dir, sit(1), 40.5), d3 = direct(dir, sit(1), 41);
  check(d1.key === "day" && d3.key === "tension" && d3.changed !== d2.changed || (d2.key === "tension"), `a lasting threat: up within ${DIRECTOR.UP} s`);
  let downAt = null;
  for (let t = 41.5; t < 80; t += 0.5) if (direct(dir, sit(0), t).key === "day") { downAt = t; break; }
  check(downAt != null && downAt - 41.5 >= DIRECTOR.DOWN.tension - 0.01, `the threat gone: back down after ${downAt != null ? (downAt - 41.5).toFixed(1) : "?"} s (no sooner than ${DIRECTOR.DOWN.tension})`);
  const dB = direct(dir, { mode: "battle", battle: { phase: "quiet", tide: "even" }, events: [], calm: "day", level: 0 }, 100);
  check(dB.key === "battleQuiet" && dB.changed, "a battle opening: at once (a change of place, not of mood)");
  const back = direct(dir, sit(0), 101);
  check(back.key === "day" && back.changed, "a battle over: back to the map's music at once");
  let nAt = null; for (let t = 101.5; t < 140; t += 0.5) if (direct(dir, sit(0, { calm: "night" }), t).key === "night") { nAt = t; break; }
  check(nAt != null && nAt - 101.5 >= DIRECTOR.LATERAL - 0.01, `day to night: after ${nAt != null ? (nAt - 101.5).toFixed(1) : "?"} s of night (sideways moves wait ${DIRECTOR.LATERAL} s)`);
  const dd = direct({}, { mode: "map", calm: "day", level: 0, events: [{ k: "death" }, { k: "baseLost" }] }, 0);
  check(dd.stings.length === 1 && dd.stings[0] === "baseLost" && dd.hush, "a death and a base lost at once: one phrase (the toll), then the hush");
}

// ---------- 2. the score ----------
console.log("The score");
{
  let bad = 0, total = 0;
  const per = {};
  for (const k of STATE_KEYS) {
    const def = stateDef(k, { season: "spring" }), mem = {}, rng = rngOf(7);
    let n = 0;
    for (let bar = 0; bar < 32; bar++) for (const e of composeBar(def, mem, rng, bar)) {
      n++; total++;
      if (!Number.isFinite(e.midi) || !Number.isFinite(e.beat) || e.beat < 0 || e.beat >= def.meter + 1e-9 || !(e.vel > 0 && e.vel <= 1) || !(e.len > 0) || (e.midi && (e.midi < 24 || e.midi > 96))) bad++;
    }
    per[k] = n / 32;
  }
  check(!bad && total > 0, `every state composes 32 bars (${total} notes) with sane pitches, beats inside the bar, velocities and lengths`);
  check(per.night < per.day && per.day < per.battleFight && per.battleQuiet < per.battleSeen && per.battleSeen < per.battleFight && per.title < per.day,
    `density rises with the action: night ${per.night.toFixed(1)}, title ${per.title.toFixed(1)}, day ${per.day.toFixed(1)}, no contact ${per.battleQuiet.toFixed(1)}, seen ${per.battleSeen.toFixed(1)}, firefight ${per.battleFight.toFixed(1)} notes a bar`);
  check(STATE_KEYS.every((k) => RANK[k] != null && STATES[k].label) && STATE_KEYS.every((k) => STATES[k].prog.every((c) => Number.isFinite(parseInt(c, 10)))), "every state has a rank, a label and a progression");
  // The motif: the theme states open on it; the title, the calm map and the victory theme bring it back.
  const motifSemis = (mode) => MOTIF.map((n) => degSemis(mode, n.d));
  const pc = (x) => ((x % 12) + 12) % 12;
  const opens = (k) => { const def = stateDef(k), mem = {}; const p = planPhrase(def, mem, rngOf(3), 0); return p.plan === "motif" ? p.notes.slice(0, MOTIF.length).map((n) => pc(degSemis(def.mode, n.d))) : null; };
  const go = opens("gameover"), tr = opens("triumph");
  check(go && tr && JSON.stringify(go) === JSON.stringify(motifSemis("aeolian").map(pc)) && tr.includes(4) && !go.includes(4) && go.includes(3),
    "game over opens on the motif in the minor, the victory theme on the same motif in the major (F# for F)");
  const share = (k, n = 40) => { const def = stateDef(k), mem = {}, rng = rngOf(9); let m = 0; for (let i = 0; i < n; i++) if (planPhrase(def, mem, rng, i * 4).plan === "motif") m++; return m / n; };
  const sT = share("title"), sD = share("day"), sV = share("triumph"), sF = share("battleFight");
  check(sT > 0.3 && sD > 0.1 && sV > 0.4 && sF === 0, `the motif recurs: title ${Math.round(sT * 100)}%, calm day ${Math.round(sD * 100)}%, victory ${Math.round(sV * 100)}% of phrases (never in a firefight)`);
  const mem = {}, rng = rngOf(5), def = stateDef("day");
  const plans = []; for (let i = 0; i < 40; i++) plans.push(planPhrase(def, mem, rng, i * 4).plan);
  check(plans.includes("rest") && plans.includes("cell") && plans.includes("walk"), `calm music breathes and remembers: ${["motif", "cell", "walk", "rest"].map((p) => `${p} ${plans.filter((x) => x === p).length}`).join(", ")} of 40 phrases`);
  check(STING_KEYS.every((k) => STINGS[k].events.every(([b, inst, m, v, l]) => b >= 0 && inst && Number.isFinite(m) && v > 0 && l > 0) && STINGS[k].secs > 0), `the stings (${STING_KEYS.join(", ")}) are well formed`);
}

// ---------- 3. the instruments ----------
console.log("The instruments");
{
  // Pitch by autocorrelation over a stretch after the attack.
  const pitchOf = (d, sr, f0) => {
    const a = Math.floor(sr * 0.15), n = Math.min(d.length - a - 4000, Math.floor(sr * 0.25));
    let best = 0, bl = 0;
    const lo = Math.floor(sr / (f0 * 1.15)), hi = Math.ceil(sr / (f0 * 0.87));
    for (let lag = lo; lag <= hi; lag++) { let s = 0; for (let i = 0; i < n; i++) s += d[a + i] * d[a + i + lag]; if (s > best) { best = s; bl = lag; } }
    // parabolic refinement
    const r = (lag) => { let s = 0; for (let i = 0; i < n; i++) s += d[a + i] * d[a + i + lag]; return s; };
    const y0 = r(bl - 1), y1 = r(bl), y2 = r(bl + 1), off = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
    return sr / (bl + off);
  };
  const cents = (f, g) => 1200 * Math.log2(f / g);
  const out = [];
  let worst = 0;
  for (const [inst, m] of [["guitar", 45], ["guitar", 57], ["guitar", 69], ["banjo", 62], ["epiano", 62], ["epiano", 74], ["pad", 50], ["bassLong", 38], ["bassLong", 45]]) {
    const sr = bakeRate(inst, 48000), v = bakeVoice(inst, m, sr);
    const f = pitchOf(v.data, sr, midiHz(m)), c = cents(f, midiHz(m));
    worst = Math.max(worst, Math.abs(c));
    out.push(`${inst} ${m}: ${c >= 0 ? "+" : ""}${c.toFixed(1)}c`);
  }
  check(worst < 12, `in tune within 12 cents (${out.join(", ")})`);
  const names = ["guitar", "banjo", "muted", "epiano", "bell", "pad", "stab", "bassShort", "bassLong", "kick", "heart", "snare", "hatC", "hatO", "tomL", "tomM", "shaker", "anvil", "boom", "swell"];
  const badV = [];
  const ms = {};
  for (const n of names) { const tt = performance.now(); const v = bakeVoice(n, 57, bakeRate(n, 48000), 0.8); ms[n] = performance.now() - tt; let pk = 0; for (const x of v.data) { if (!Number.isFinite(x)) { badV.push(n); break; } pk = Math.max(pk, Math.abs(x)); } if (!(pk > 0.1 && pk <= 1)) badV.push(`${n} peak ${pk}`); }
  check(!badV.length, `all ${names.length} instruments bake finite, at a sane peak${badV.length ? `: ${badV.join(", ")}` : ""}`);
  const slow = Object.entries(ms).sort((a, b) => b[1] - a[1])[0];
  check(slow[1] < 60, `baking a voice costs a few ms (slowest ${slow[0]} ${slow[1].toFixed(1)} ms; the engine bakes a state's ahead of need, a few ms a frame)`);
  const pad = bakeVoice("pad", 50, LOW_RATE).data;
  const jump = Math.abs(pad[0] - pad[pad.length - 1]), step = (() => { let s = 0; for (let i = 1; i < 2000; i++) s = Math.max(s, Math.abs(pad[i] - pad[i - 1])); return s; })();
  check(jump < step * 3, `the pad loops without a seam (the jump at the loop ${jump.toFixed(3)} vs the largest step ${step.toFixed(3)})`);
  const hiss = makeHiss(48000);
  check(hiss.length > 48000 && hiss.every((x) => Number.isFinite(x)), "the tape hiss loop");
  check(bakeRate("pad", 48000) === LOW_RATE && bakeRate("guitar", 48000) === PITCH_RATE && bakeRate("hatC", 48000) === 48000 && bakeRate("guitar", 22050) === 22050, "baked at 16 kHz (pads, bass, low drums), 32 kHz (keys, plucks) or the context's (the bright kit)");
}

// ---------- 4. the engine ----------
console.log("The engine");
{
  // A change lands on a bar line.
  const ctx = fakeCtx();
  const E = createEngine(ctx, ctx.destination, { seed: 1 });
  const graph0 = new Set(ctx.nodes);
  E.apply({ key: "day", season: "spring", stings: [] }, 0);
  run(E, ctx, 0, 10);
  const bars0 = E.stats.bars;
  const nextBar = E.nextBar;
  E.apply({ key: "tension", season: "spring", stings: [] }, 10.01);
  run(E, ctx, 10.05, 20);
  const ch = E.stats.changes.find((c) => c.to === "tension");
  check(!!ch && Math.abs(ch.t - nextBar) < 1e-6 && ch.t > 10, `day to tension asked at 10.01 s: it lands on the next bar line (${ch ? ch.t.toFixed(3) : "?"} s, bar ${ch ? ch.bar : "?"} after ${bars0})`);
  const layerGains = ctx.nodes.filter((n) => graph0.has(n) && n.kind === "gain" && n.gain.events.some((e) => e[0] === "lin")); // the layers' gains (not the notes')
  const ramps = layerGains.flatMap((n) => n.gain.events.filter((e) => e[0] === "set" && Math.abs(e[2] - ch.t) < 1e-6));
  const stray = layerGains.flatMap((n) => n.gain.events.filter((e, i, a) => e[0] === "lin" && a[i - 1] && a[i - 1][0] === "set" && e[2] > 10 && e[2] < ch.t));
  check(ramps.length >= 3 && !stray.length, `the layers' crossfades start on that bar line (${ramps.length} layers fading), none mid-bar`);
  // Tempo glides: no jump from 76 to 84 in one bar.
  check(E.stats.changes.length >= 2 && E.bpm > 76 && E.bpm <= 84 + 1e-9, `the tempo glides to the new state's (${E.bpm.toFixed(1)} bpm now)`);
  check(!ctx.bad.length, `no NaN, no bad ramp, nothing connected to nothing${ctx.bad.length ? `: ${ctx.bad.slice(0, 4).join(", ")}` : ""}`);
}
{
  // The scheduler under load: jittery ticks and stalls.
  const ctx = fakeCtx();
  const E = createEngine(ctx, ctx.destination, { seed: 2 });
  E.apply({ key: "battleFight", season: "spring", stings: [] }, 0);
  const r = rngOf(99);
  let t = 0, past = 0, far = 0, n0 = 0, worstGap = 0;
  const look = MUSIC.LOOKAHEAD;
  while (t < 60) {
    const dt = r() < 0.03 ? 0.2 + r() * 0.15 : 0.005 + r() * 0.055; // mostly frames and timer ticks, now and then a long frame
    t += dt;
    ctx.currentTime = t;
    const before = ctx.sources.length;
    E.tick(t);
    for (let i = before; i < ctx.sources.length; i++) { const s = ctx.sources[i]; if (s.at == null) continue; if (s.at < t - 1e-9) past++; if (s.at > t + look + 0.06) far++; }
    n0++;
    // after each tick everything due before now + lookahead is out of the queue
    if (E.queue.length && E.queue[0].t < t + look - 1e-9) worstGap++;
  }
  check(past === 0 && far === 0 && worstGap === 0, `60 s of firefight with jittery ticks (5–60 ms, now and then 200–350 ms): nothing scheduled in the past, nothing further ahead than the lookahead (${n0} ticks, ${E.stats.notes} notes)`);
  // A 3 s stall (a frozen tab): the music picks up on a fresh bar, the missed notes skipped, not crammed in.
  const before = ctx.sources.length;
  t += 3; ctx.currentTime = t; E.tick(t);
  const crammed = ctx.sources.slice(before).filter((s) => s.at != null && s.at < t).length;
  check(crammed === 0 && E.stats.late > 0 && E.nextBar > t, `a 3 s stall: no notes crammed into the past, a fresh bar from now (late ${E.stats.late})`);
  check(E.stats.tickMs / E.stats.ticks < 2, `the scheduler's time a tick: ${(E.stats.tickMs / E.stats.ticks).toFixed(3)} ms on average (bakes included)`);
}
{
  // The node budget, every state, the busiest battle music in particular.
  const peaks = {};
  for (const k of STATE_KEYS) {
    const ctx = fakeCtx();
    const E = createEngine(ctx, ctx.destination, { seed: 3 });
    E.apply({ key: k, season: "spring", stings: [] }, 0);
    run(E, ctx, 0, 45, 0.04);
    peaks[k] = E.stats.peakNodes;
  }
  const worst = Object.entries(peaks).sort((a, b) => b[1] - a[1])[0];
  check(Object.values(peaks).every((p) => p <= MUSIC.NODE_CAP), `every state within ${MUSIC.NODE_CAP} nodes at once, the graph's own included (${STATE_KEYS.map((k) => `${k} ${peaks[k]}`).join(", ")})`);
  // Independently, on the stub: the battle with a man down, a sting and a change at once.
  const ctx = fakeCtx();
  const E = createEngine(ctx, ctx.destination, { seed: 4 });
  const graph = new Set(ctx.nodes);
  E.apply({ key: "battleFight", season: "spring", stings: [] }, 0);
  run(E, ctx, 0, 30, 0.04, (t) => {
    if (Math.abs(t - 10) < 0.02) E.apply({ key: "battleWin", season: "spring", down: true, stings: [] }, t);
    if (Math.abs(t - 20) < 0.02) E.apply({ key: "day", season: "spring", stings: ["victory"] }, t);
  });
  let stubPeak = 0;
  for (let t = 0.5; t < 30; t += 0.005) stubPeak = Math.max(stubPeak, soundingOnStub(ctx, graph, t));
  const fixedSources = [...graph].filter((n) => n.kind === "source").length; // the wobble, the pads' sweep, the hiss
  check(E.fixed === 17 && stubPeak + E.fixed <= MUSIC.NODE_CAP && E.stats.peakNodes <= MUSIC.NODE_CAP,
    `the busiest moment (a firefight, one down, the tide turning, then the victory sting over a change): ${E.stats.peakNodes} nodes by the engine's count, ${stubPeak + E.fixed} on the stub (the graph's own ${E.fixed}: bus 2, duck, tape, wobble, bed, room, 7 layer gains, pad filter and sweep, hiss); ${E.stats.stolen} voices made way, ${E.stats.dropped} dropped of ${E.stats.notes}`);
  check(fixedSources === 3, "three looping sources in the graph (the tape's wobble, the pads' sweep, the hiss), no oscillators");
}
{
  // Ducking.
  const ctx = fakeCtx();
  const E = createEngine(ctx, ctx.destination, { seed: 5 });
  const duck = ctx.nodes.find((n) => n.kind === "gain" && n.out[0] === ctx.destination);
  E.duck(6, 1);
  const ev = duck.gain.events.filter((e) => e[0] === "tgt");
  const depth = ev[0] && ev[0][1], rec = ev[1];
  check(depth && Math.abs(20 * Math.log10(depth) + 6) < 0.01 && rec && rec[1] === 1, `a 6 dB duck: down to ${depth ? (20 * Math.log10(depth)).toFixed(1) : "?"} dB at once, back to full`);
  // the recovery: within 1 dB of full this long after the duck
  const hold = rec[2] - 1, tau = rec[3];
  const t1db = hold + tau * Math.log((1 - depth) / (1 - Math.pow(10, -1 / 20)));
  check(t1db > 0.8 && t1db < 1.8, `back within 1 dB after ${t1db.toFixed(2)} s (about 1.5 s)`);
  const n = duck.gain.events.length;
  E.duck(3, 1.1);
  check(duck.gain.events.length === n, "a shallower duck during a deeper one: ignored");
  E.duck(6, 3);
  check(duck.gain.events.length > n, "a new duck once the last has passed");
  // The cues that duck, through musicFrame (the game's hook).
  const opt = { sound: { ...AU.SOUND_DEFAULTS, groups: {}, off: {} } };
  SG.useMix(opt.sound);
  const A = { ctx: fakeCtx(), test: false };
  A.mus = makeMusicBus(A.ctx, A.ctx.destination);
  bindMusic({ opt: () => opt, unlock: () => {}, bus: () => A });
  musicGains(A.mus, opt.sound, 0, true, true);
  musicFrame(A, st, { started: true, alertList: [] }, 1000, [], true);
  const eng = MU.musicDebug.engine;
  const dk = A.ctx.nodes.find((x) => x.kind === "gain" && x.out[0] === A.mus.in);
  const count = () => dk.gain.events.length;
  let c0 = count();
  musicFrame(A, st, { started: true, alertList: [] }, 1100, [{ name: "blast", blast: { kind: "glass" } }, { name: "pistol" }], true);
  const noDuck = count() === c0;
  musicFrame(A, st, { started: true, alertList: [] }, 1200, [{ name: "blast", blast: { kind: "frag" }, delay: 0.8 }], true);
  const fragDuck = dk.gain.events.slice(c0).find((e) => e[0] === "tgt" && e[1] < 0.6);
  c0 = count();
  A.ctx.currentTime = 5;
  musicFrame(A, st, { started: true, alertList: [] }, 5000, [{ name: "zShriek" }], true);
  const shriek = dk.gain.events.slice(c0).find((e) => e[0] === "tgt" && e[1] < 0.6);
  c0 = count();
  A.ctx.currentTime = 9;
  musicFrame(A, st, { started: true, alertList: [] }, 9000, [{ name: "cardCrisis" }], true);
  const card = dk.gain.events.slice(c0).find((e) => e[0] === "tgt" && e[1] < 0.6);
  check(!!eng && noDuck && fragDuck && Math.abs(fragDuck[2] - 0.81) < 0.02 && shriek && card,
    `ducks driven by the cues: a frag (at its blast, after the fuse: ${fragDuck ? fragDuck[2].toFixed(2) : "?"} s), a screamer's shriek, a crisis card; not a bottle or a pistol`);
  // ---------- 5. pause: muted, unfocused, the group off ----------
  console.log("Pause");
  const notes0 = eng.stats.notes;
  musicGains(A.mus, opt.sound, 10, false, false); // muted or unfocused (audio.js wantOn false)
  const busOff = A.mus.gain.gain.events.at(-1);
  for (let t = 10; t < 20; t += 0.05) { A.ctx.currentTime = t; musicFrame(A, st, { started: true, alertList: [] }, t * 1000, [], false); }
  const notes1 = eng.stats.notes;
  check(eng.paused && busOff[1] === 0 && notes1 - notes0 < 30, `muted or unfocused: the bus fades out and the scheduler stops (${notes1 - notes0} notes in the last lookahead, then none)`);
  musicGains(A.mus, opt.sound, 20, false, true);
  const late0 = eng.stats.late;
  for (let t = 20; t < 25; t += 0.05) { A.ctx.currentTime = t; musicFrame(A, st, { started: true, alertList: [] }, t * 1000, [], true); }
  const crammed = A.ctx.sources.filter((s) => s.made >= 20 && s.at != null && s.at < s.made - 1e-9).length;
  check(!eng.paused && eng.stats.notes > notes1 && crammed === 0 && eng.stats.late <= late0 + 1, `back in focus: the music picks up on a fresh bar, nothing played late (${eng.stats.notes - notes1} notes)`);
  SG.setGroupOn("music", false);
  musicGains(A.mus, opt.sound, 25, false, true);
  check(eng.paused && A.mus.gain.gain.events.at(-1)[1] === 0, "the Music group switched off: silent and paused");
  SG.setGroupOn("music", true);
  musicGains(A.mus, opt.sound, 26, false, true);
  check(!eng.paused && A.mus.gain.gain.events.at(-1)[1] === MUSIC.LEVEL, `on again: at its level (${MUSIC.LEVEL})`);
  SG.setGroupVolume("music.stings", 0.5);
  musicGains(A.mus, opt.sound, 27, false, true);
  const stingG = A.ctx.nodes.filter((x) => x.kind === "gain").find((x) => x.gain.events.some((e) => e[0] === "tgt" && Math.abs(e[1] - LAYER_LEVEL.sting * 0.25) < 1e-9));
  check(!!stingG, "the Stings part at 50%: the stings at a quarter (−12 dB)");
  SG.resetMix();
}

// ---------- 6. settings ----------
console.log("Settings");
{
  const s = AU.soundOptions({ sound: {} });
  check(s.musicFollow === true && SG.groupGain("music") === 1 && !SG.groupDef("music").reserved, "music on (the Music group at 100%) and its intensity following the action by default");
  const m = AU.soundOptions({ sound: { music: 0.5, musicOn: true } }), q = AU.soundOptions({ sound: { music: 1 } }), z = AU.soundOptions({ sound: { music: 0, musicOn: false } });
  check(!("music" in m.groups) && q.groups.music === undefined && z.groups.music === 0 && z.off.music === true, "an early save's Music slider moves to the group at the same loudness (50% → 100%, 100% capped at 100%, 0 → 0) and Music off to the group's switch");
  const html = AU.soundOptionsHtml({ sound: {} });
  check(/data-k="music"/.test(html) && /data-k="musicFollow"/.test(html) && /data-g="music"/.test(html) && MU.MUSIC_TEST_NAMES.every((k) => html.includes(`value="${k}"`)) && STATE_KEYS.every((k) => html.includes(`value="${k}"`)) && STING_KEYS.every((k) => html.includes(`value="sting:${k}"`)),
    `Settings → Sound: Music on / off, intensity follows the action, the Music group's slider, and the Music test (${MU.MUSIC_TEST_NAMES.length} entries: every state and sting)`);
  const { SETTINGS_ACTIONS, SETTINGS_CHANGE } = await import("../src/ui/settings.js");
  check(!!SETTINGS_ACTIONS["mus-test"] && !!SETTINGS_CHANGE["mus-pick"], "the menu knows the Music test's actions");
  check(SG.groupOf("musicVictory") === "music.stings" && SG.groupOf("music") === "music", "the music's names in the mixer (Music, Music → Stings and phrases)");
  // The intensity toggle end to end: off, a firefight is heard as calm music.
  const sit = { mode: "battle", calm: "night", level: 0, battle: { phase: "fight", tide: "lose" }, events: [] };
  check(wanted(sit, false) === "night" && wanted({ ...sit, mode: "map", level: 2 }, false) === "night" && wanted(sit, true) === "battleLose", "intensity off: battle and crisis are heard as the calm night music; on: losing");
}

// ---------- 7. determinism ----------
console.log("Determinism");
{
  const play = (withMusic) => execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--play", withMusic ? "1" : "0"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const a = play(false), b = play(true);
  check(a === b, `twelve days of the world played with and without the music reading it every hour: the same (${a.length} chars compared)`);
  const fight = (withMusic) => {
    const [x] = battles(23, ["field-forest"]);
    const mem = {}, u = { started: true };
    for (let turn = 0; turn < 6 && !x.b.over; turn++) {
      if (withMusic) readSituation(x.st, u, mem, turn);
      C.combatAct(x.st, { type: "end" });
      if (x.b.phase === "enemy") C.runEnemyPhase(x.st);
      if (withMusic) readSituation(x.st, u, mem, turn + 0.5);
    }
    return JSON.stringify({ rng: x.b.rng, turn: x.b.turn, fx: x.b.fx.map((f) => [f.type, f.seq]), units: x.b.units.map((v) => [v.id, v.x, v.y, v.hp, v.dead, v.down, v.aware]) });
  };
  check(fight(false) === fight(true), "a battle played six turns with and without the music reading it: the same dice, moves and wounds");
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
