// Gun, blast and handling sounds (ui/gunsfx.js, ui/blastsfx.js, ui/battlesfx.js; planned in ui/soundcues.js): headless
// checks on a stub AudioContext that records what is built.
// - Every gun (data-guns.js, combat.js, the turrets) and launcher has a voice of its own (only bows and a spitter keep
//   an old one, on purpose); every voice, handling sound and blast renders with no NaN, within ±1, ringing out.
// - Suppressors and subsonic rounds: no crack when subsonic (the .45 always), a crack kept for a suppressed rifle, no
//   suppressor on a revolver; the suppressed voice quieter.
// - Bursts and full auto: the fx's rounds at the gun's cyclic rate (jittered a few ms), one shared tail (two for a long
//   stream), the per-frame cap and the throttle still holding in a 20-unit firefight.
// - Handling from a scripted sequence of state changes: reload (by platform, rounds counted), the slide locking on the
//   last round, a jam after its shot, the rack that clears it, a dud's click, a taser, a launcher fired and reloaded.
// - Grenades and launchers: the pin, the clatter, the blast after the flight and the fuse; a 40 mm's flight and a
//   rocket's; a frame's blasts merged into one; a carried bomb going off elsewhere; a car wrecked; glass near cars.
// - Space: pan by the screen, distance (level, highs, delay), out of sight muffled, blasts darker and later far away;
//   the room by place; the deafened muffle and ring; the ducking after a close blast.
// - Determinism: the same battle played with and without the sound layer ends the same (no sim state, no dice).
// Usage: node tools/gunsfxtest.js
import * as C from "../src/sim/combat.js";
import { WEAPONS } from "../src/sim/combat.js";
import { GUN_WEAPONS, LATER_GEAR } from "../src/sim/data-guns.js";
import { THROWABLES } from "../src/sim/stealth.js";
import { LAUNCH_ROUNDS } from "../src/sim/launchers.js";
import { battles } from "./isobattles.js";
import * as G from "../src/ui/gunsfx.js";
import * as BL from "../src/ui/blastsfx.js";
import * as BS from "../src/ui/battlesfx.js";
import { battleCues, LISTEN, MAX_BATTLE_SOUNDS, makeThrottle } from "../src/ui/soundcues.js";
import { stats } from "../src/ui/sfxdsp.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---------- a stub AudioContext that records ----------
function stubCtx(sr = 16000) {
  const bad = [], sources = [], nodes = { n: 0 };
  const param = (name, v = 0) => {
    const p = { value: v, events: [] };
    const fin = (x, what) => { if (!Number.isFinite(x)) bad.push(`${name}.${what}(${x})`); };
    p.setValueAtTime = (x, t) => { fin(x, "set"); fin(t, "setT"); p.events.push(["set", x, t]); return p; };
    p.linearRampToValueAtTime = (x, t) => { fin(x, "lin"); fin(t, "linT"); return p; };
    p.exponentialRampToValueAtTime = (x, t) => { fin(x, "exp"); if (!(x > 0)) bad.push(`${name}.exp(${x})`); return p; };
    p.setTargetAtTime = (x, t, k) => { fin(x, "tgt"); fin(t, "tgtT"); p.events.push(["tgt", x, t]); return p; };
    p.cancelScheduledValues = () => p;
    return p;
  };
  const node = (kind, extra = {}) => { nodes.n++; const o = { kind, outs: [], connect(d) { if (!d) bad.push(`${kind}.connect(null)`); o.outs.push(d); return d; }, disconnect() {}, ...extra }; return o; };
  const c = {
    sampleRate: sr, currentTime: 0, destination: node("dest"), bad, sources, nodes,
    createGain: () => node("gain", { gain: param("gain", 1) }),
    createBiquadFilter: () => node("filter", { type: "", frequency: param("freq", 350), Q: param("Q", 1) }),
    createStereoPanner: () => node("pan", { pan: param("pan") }),
    createConvolver: () => node("conv", { buffer: null }),
    createDynamicsCompressor: () => node("comp", { threshold: param("th"), knee: param("knee"), ratio: param("ratio"), attack: param("att"), release: param("rel") }),
    createOscillator: () => node("osc", { frequency: param("osc", 440), start() {}, stop() {} }),
    createBufferSource: () => { const s = node("src", { buffer: null, loop: false, playbackRate: param("rate", 1), start(t) { if (!Number.isFinite(t)) bad.push("start"); if (!s.buffer) bad.push("no buffer"); s.t = t; sources.push(s); }, stop() {} }); return s; },
    createBuffer: (ch, len, rate) => { const data = Array.from({ length: ch }, () => new Float32Array(len)); return { duration: len / rate, length: len, sampleRate: rate, getChannelData: (i) => data[i], copyToChannel: (a, i) => data[i].set(a) }; },
  };
  return c;
}

// ---------- 1. every gun has a voice ----------
console.log("Voices for every gun");
{
  const guns = Object.keys(WEAPONS).filter((k) => !WEAPONS[k].melee);
  const own = guns.filter((k) => G.OWN_VOICE[k]);
  const generic = guns.filter((k) => !G.OWN_VOICE[k] && G.gunVoice(k).generic);
  check(!generic.length, `every gun and launcher in WEAPONS has its own voice row (${guns.length - own.length} guns; generic: ${generic.join(", ") || "none"})`);
  check(own.every((k) => ["bow", "acid"].includes(G.OWN_VOICE[k])) && own.length === Object.keys(G.OWN_VOICE).length, `kept on purpose: ${own.map((k) => `${k}=${G.OWN_VOICE[k]}`).join(", ")}`);
  check(Object.keys(GUN_WEAPONS).filter((k) => !GUN_WEAPONS[k].melee).every((k) => G.VOICE_OF[k]) && Object.keys(LATER_GEAR).every((k) => G.VOICE_OF[k]), "every gun of the overhaul (data-guns.js) and every launcher item has its row");
  const used = new Set(Object.values(G.VOICE_OF).map((r) => r.v));
  check(Object.keys(G.GUN_VOICES).every((v) => used.has(v)) && [...used].every((v) => G.GUN_VOICES[v]), `${Object.keys(G.GUN_VOICES).length} voices, every one used: ${Object.keys(G.GUN_VOICES).join(", ")}`);
  const by = (k) => G.gunVoice(k).v;
  check(by("pistol22") === "p22" && by("pistol") === "p9" && by("pistol45") === "p45" && by("revolver") === "r357" && by("smg") === "smg9" && by("ar") === "r556" && by("ak") === "r762" &&
    by("huntrifle") === "r308" && by("sniper") === "r308" && by("amr") === "r50" && by("shotgun") === "sg12" && by("lmg") === "lmg" && by("turret_m2") === "m2" && by("m79") === "gl40" && by("at4") === "rocket",
  "the asked-for voices: .22, 9mm, .45, .357, the SMG, 5.56, 7.62×39, .308, .50, 12 gauge, the LMG, the M2, 40 mm, rockets");
  const acts = new Set(Object.values(G.VOICE_OF).flatMap((r) => [r.act, r.cycle === "bolt" ? "bolt2" : r.cycle, r.brass].filter(Boolean)));
  check([...acts].every((a) => G.HANDLING[a]), `every action, cycle and brass sound exists (${[...acts].join(", ")})`);
  const rels = new Set(Object.values(G.VOICE_OF).map((r) => r.rel));
  const missing = [];
  for (const rel of rels) for (const ev of G.handScript({ kind: "reload", rel, n: 3, empty: true })) if (ev && !G.HANDLING[ev[0]]) missing.push(`${rel}:${ev[0]}`);
  check(!missing.length, `every reload (${[...rels].join(", ")}) plays sounds that exist${missing.length ? `: missing ${missing.join(", ")}` : ""}`);
  const throwKinds = Object.keys(THROWABLES).map((k) => BL.THROW_BLAST[k] || "clatter");
  check(throwKinds.every((k) => BL.BLASTS[k]) && BL.THROW_BLAST.frag === "frag" && BL.THROW_BLAST.pipebomb === "pipebomb" && BL.THROW_BLAST.flashbang === "flash" && BL.THROW_BLAST.molotov === "molotov" && BL.THROW_BLAST.smokegren === "smoke" && BL.THROW_BLAST.flare === "flare",
    `every throwable lands as a sound (${Object.keys(THROWABLES).map((k) => `${k}=${BL.THROW_BLAST[k] || "clatter"}`).join(", ")}; the decoys clatter)`);
  const launchKinds = { he: "frag", smoke: "smokegren", illum: "flare" };
  check(Object.keys(LAUNCH_ROUNDS).filter((t) => t !== "buck" && t !== "heat").every((t) => BL.BLASTS[BL.launchBlast(launchKinds[t], false)]) && BL.launchBlast("frag", false) === "gl40" && BL.launchBlast(null, true) === "rocket",
    "every launcher round lands as a sound: 40 mm HE, smoke, illumination; a rocket's warhead (buckshot is a shot)");
}

// ---------- 2. rendering ----------
console.log("Rendering");
{
  const sr = 16000, probs = [];
  for (const [v, V] of Object.entries(G.GUN_VOICES)) {
    for (const mod of [null, "sup"]) {
      const W = mod ? G.suppressedSpec(V, false) : V;
      const r = G.renderVoice(W, sr, 7, null);
      for (const [part, d] of [["body", r.body], ["tail", r.tail], ["crack", r.crack]]) {
        if (!d) continue;
        const s = stats(d, part === "tail" ? r.tsr : sr);
        if (s.nan || s.peak > 1.0001 || !(s.peak > 0.001)) probs.push(`${v}${mod ? "/sup" : ""} ${part}: peak ${s.peak}${s.nan ? " NaN" : ""}`);
        if (Math.abs(d[d.length - 1]) > s.peak * 0.05) probs.push(`${v} ${part} does not ring out`);
      }
    }
  }
  check(!probs.length, `every gun voice (and its suppressed form) renders: body, crack, tail within ±1, no NaN, ringing out${probs.length ? `: ${probs.slice(0, 4).join("; ")}` : ""}`);
  const hp = [];
  for (const name of Object.keys(G.HANDLING)) { const d = G.renderHandling(name, sr); const s = stats(d, sr); if (s.nan || !(s.peak > 0.5) || s.peak > 1.0001) hp.push(`${name}: ${s.peak}`); }
  check(!hp.length, `all ${Object.keys(G.HANDLING).length} handling sounds render${hp.length ? `: ${hp.join(", ")}` : ""}`);
  const bp = [];
  for (const k of Object.keys(BL.BLASTS)) { const r = BL.renderBlast(k, sr); const s = stats(r.body, sr), st = stats(r.tail, r.tsr); if (s.nan || st.nan || s.peak > 1.0001 || !(s.peak > 0.01)) bp.push(k); }
  check(!bp.length, `all ${Object.keys(BL.BLASTS).length} blasts render (body and rumble)${bp.length ? `: ${bp.join(", ")}` : ""}`);
  const fl = BL.renderFireLoop(sr);
  check(fl.length > sr && stats(fl, sr).peak <= 1.0001 && Math.abs(fl[0] - fl[fl.length - 1]) < 0.5, "the Molotov's fire loop renders and loops");
  // the voices differ: a .22 quieter than a 9mm, a .50 louder and longer than a 5.56, a .45 lower than a 9mm
  const loud = (k, sup = false) => { const p = G.labPlan(k, "single", sup); const v = G.bakedVoice(sr, p); return { s: stats(v.body[0], sr), tail: v.tail.length / v.tsr, crack: v.crack ? stats(v.crack[0], sr).peak : 0 }; };
  const p22 = loud("pistol22"), p9 = loud("pistol"), p45 = loud("pistol45"), r556 = loud("ar"), r50 = loud("amr"), sg = loud("shotgun"), s9 = loud("pistol", true);
  check(p22.s.rms50Db < p9.s.rms50Db && p9.s.rms50Db < r50.s.rms50Db && r556.tail < r50.tail && p45.s.centroid < p9.s.centroid && sg.s.rms50Db > p9.s.rms50Db,
    `voices differ: .22 ${p22.s.rms50Db} < 9mm ${p9.s.rms50Db} < .50 ${r50.s.rms50Db} dB; tails 5.56 ${r556.tail.toFixed(1)} s < .50 ${r50.tail.toFixed(1)} s; .45 ${p45.s.centroid} Hz under 9mm ${p9.s.centroid} Hz; 12 gauge ${sg.s.rms50Db} dB`);
  check(s9.s.rms50Db < p9.s.rms50Db - 3, `a suppressed 9mm is quieter (${s9.s.rms50Db} dB against ${p9.s.rms50Db} dB)`);
}

// ---------- 3. suppressors and subsonic rounds ----------
console.log("Suppressors and subsonic rounds");
{
  const u = (weapon, extra = {}) => ({ id: 1, weapon, x: 0, y: 0, kind: "human", side: "player", ...extra });
  const f = { type: "shot", from: [0, 0], to: [5, 0], rounds: 1 };
  const P = (w, x) => G.shotPlan(f, u(w, x));
  check(!P("pistol").sup && !P("pistol").sub && P("pistol45").sub && !P("ar").sub, "plain: a 9mm and a 5.56 crack, a .45 never does (subsonic)");
  check(P("pistol", { load: "subsonic" }).sub && !P("pistol", { load: "fmj" }).sub, "subsonic 9mm loads: no crack");
  check(P("pistol", { suppressor: { key: "can9" } }).sup && P("ar", { suppressor: { key: "can556" } }).sup && !P("ar", { suppressor: { key: "can556" } }).sub, "a suppressor muffles; a suppressed 5.56 keeps its crack");
  check(!P("revolver", { suppressor: { key: "can9" } }).sup, "no suppressor muffles a revolver (the gas escapes at the cylinder)");
  const sr = 16000;
  const supSub = G.bakedVoice(sr, { ...P("pistol", { suppressor: {}, load: "subsonic" }) }), supSuper = G.bakedVoice(sr, P("ar", { suppressor: {} }));
  check(supSub.crack === null && supSuper.crack !== null && G.bakedVoice(sr, P("pistol45")).crack === null, "the baked voices: a suppressed subsonic shot has no crack buffer, a suppressed rifle has one, the .45 none");
  check(G.voiceKey(P("pistol", { suppressor: {}, load: "subsonic" })) !== G.voiceKey(P("pistol", { suppressor: {} })) && G.voiceKey(P("pistol")) !== G.voiceKey(P("pistol", { suppressor: {} })), "plain, suppressed and suppressed-subsonic are baked apart");
}

// ---------- 4. bursts and full auto ----------
console.log("Bursts and full auto");
{
  const c = stubCtx();
  G.installBus(c, c.destination);
  const ar = { id: 2, weapon: "ar", x: 0, y: 0, kind: "human", side: "player" };
  const p = G.shotPlan({ type: "shot", from: [0, 0], to: [5, 0], rounds: 10 }, ar);
  check(p.rounds === 10 && near(p.gap, 60 / 800) && near(p.span, 9 * 60 / 800), `an AR's stream of 10: ${p.rounds} rounds ${(p.gap * 1000).toFixed(0)} ms apart (800 rpm), ${p.span.toFixed(3)} s`);
  const lmg = G.shotPlan({ type: "shot", rounds: 15 }, { id: 3, weapon: "lmg" }), smg = G.shotPlan({ type: "shot", rounds: 12 }, { id: 4, weapon: "smg" }), ak = G.shotPlan({ type: "shot", rounds: 2 }, { id: 5, weapon: "ak" });
  check(near(60 / lmg.gap, 650) && near(60 / smg.gap, 1000) && near(60 / ak.gap, 650) && lmg.rounds === 15 && smg.rounds === 12 && ak.rounds === 2, "cyclic rates: the LMG 650, the SMG 1000, the AK 650 (a burst of 2 at the same rate)");
  let rv = 0.5; const rnd = () => (rv = (rv * 9301 + 49297) % 233280 / 233280);
  const times = G.burstTimes(10, p.gap, rnd);
  check(times.length === 10 && times[0] === 0 && times.every((t, k) => Math.abs(t - k * p.gap) <= 0.0041) && new Set(times.map((t) => (t / p.gap).toFixed(4))).size === 10, "each round a few ms early or late (±4 ms), in order");
  const before = c.sources.length, n0 = c.nodes.n;
  G.playGun(c, 1, p, G.place({ dist: 2 }), rnd);
  const srcs = c.sources.slice(before);
  const vb = G.bakedVoice(c.sampleRate, p);
  const bodies = srcs.filter((s) => s.buffer && vb.body.some((b) => b.length === s.buffer.length && s.buffer.duration < 1.2) && s.buffer.length === vb.body[0].length);
  const tails = srcs.filter((s) => s.buffer && s.buffer.sampleRate !== c.sampleRate || (s.buffer && s.buffer.length === vb.tail.length && s.buffer.sampleRate === vb.tsr));
  const starts = bodies.map((s) => s.t).sort((a, b) => a - b);
  check(bodies.length === 10 && starts.every((t, k) => k === 0 || (t - starts[k - 1] > p.gap - 0.009 && t - starts[k - 1] < p.gap + 0.009)), `10 bodies scheduled ${starts.length > 1 ? ((starts[1] - starts[0]) * 1000).toFixed(0) : "?"} ms apart`);
  check(tails.length === 2, `one shared tail for the stream (and one as it ends): ${tails.length} tails for 10 rounds`);
  const nodes10 = c.nodes.n - n0;
  const n1 = c.nodes.n; G.playGun(c, 3, G.labPlan("pistol"), G.place({ dist: 2 }), rnd); const nodes1 = c.nodes.n - n1;
  check(nodes10 < 10 * 11 && nodes1 <= 14, `cheap: a single pistol shot ${nodes1} nodes (the old one 11), a 10-round stream ${nodes10} (old: 11 a shot)`);
  // a 20-unit firefight: everyone firing full auto in one frame stays within the frame's cap and the throttle
  const [town] = battles(31, ["field-town"]);
  const { b } = town;
  const mem = { rng: rnd };
  battleCues(b, mem, 0);
  const shooters = b.units.filter((x) => !x.dead).slice(0, 20);
  for (const s of shooters) { s.weapon = "ak"; C.fx(b, { type: "shot", from: [s.x, s.y], to: [0, 0], hit: false, side: s.side, rounds: 10 }); }
  const cues = battleCues(b, mem, 0.5);
  check(cues.length <= MAX_BATTLE_SOUNDS && cues.filter((x) => x.gun).every((x) => x.gun.rounds === 10), `${shooters.length} streams of 10 in one frame: ${cues.length} sounds (cap ${MAX_BATTLE_SOUNDS}), each its 10 rounds`);
  const th = makeThrottle({ auto: { gap: 0.1, max: 3 } }, 28);
  let heard = 0;
  for (let i = 0; i < 30; i++) if (th.allow("auto", 1 + i * 0.05, BS.cueSpan({ gun: { span: 1.4 } }))) heard++;
  check(heard === 3, `30 streams in 1.5 s: ${heard} play (3 at once at most: the throttle holds a stream for its length)`);
}

// ---------- 5. handling from state ----------
console.log("Handling seen between frames");
{
  const [town] = battles(32, ["field-town"]);
  const { b } = town;
  const mem = {};
  const me = b.units.find((u) => u.side === "player" && !u.dead), foe = b.units.find((u) => u.side === "enemy" && !u.dead && u.kind === "human");
  me.weapon = "pistol"; me.magW = "pistol"; me.mag = 15; me.jam = null;
  battleCues(b, mem, 0);
  const names = (cs) => cs.map((c) => c.name);
  me.mag = 1;
  battleCues(b, mem, 0.1);
  me.mag = 0;
  C.fx(b, { type: "shot", from: [me.x, me.y], to: [foe.x, foe.y], hit: false, side: "player", rounds: 1 });
  let cs = battleCues(b, mem, 0.2);
  const lock = cs.find((c) => c.name === "empty"), shot = cs.find((c) => c.gun);
  check(!!lock && !!shot && lock.delay >= shot.delay && lock.hand.kind === "empty", `the last round: ${names(cs).join(", ")} (the slide locks back after the shot)`);
  me.mag = 15;
  cs = battleCues(b, mem, 0.3);
  const rl = cs.find((c) => c.name === "reload");
  check(!!rl && rl.hand.rel === "pistol" && rl.hand.n === 15 && rl.hand.empty === true, `a reload: ${rl ? `${rl.hand.rel}, ${rl.hand.n} rounds, from empty` : "none"}`);
  check(G.handScript(rl.hand).filter(Boolean).map((e) => e[0]).join() === "magOut,magIn,slideRel", "a pistol from empty: mag out, mag in, the slide released");
  me.jam = { kind: "stove", ap: 1 };
  C.fx(b, { type: "shot", from: [me.x, me.y], to: [foe.x, foe.y], hit: false, side: "player", rounds: 1 });
  me.mag = 14;
  cs = battleCues(b, mem, 0.4);
  check(cs.some((c) => c.name === "jam") && !cs.some((c) => c.name === "reload"), `a jam on the shot: ${names(cs).join(", ")}`);
  me.jam = null;
  cs = battleCues(b, mem, 0.5);
  check(names(cs).includes("unjam"), "cleared: the tap and rack");
  C.fx(b, { type: "shot", from: [me.x, me.y], to: [foe.x, foe.y], hit: false, side: "player", misfire: true });
  cs = battleCues(b, mem, 0.6);
  check(names(cs).join() === "dry", `a misfire is a click, no bang: ${names(cs).join(", ")}`);
  // a pump shotgun topped up with 3 shells; a revolver; a bolt-action
  me.weapon = "shotgun"; me.magW = "shotgun"; me.mag = 3;
  battleCues(b, mem, 0.7);
  me.mag = 6;
  cs = battleCues(b, mem, 0.8);
  const pump = cs.find((c) => c.name === "reload");
  check(pump && pump.hand.rel === "pump" && pump.hand.n === 3 && G.handScript(pump.hand).filter(Boolean).filter((e) => e[0] === "shellIn").length === 3, "a pump shotgun: three shells, one by one");
  me.weapon = "revolver"; me.magW = "revolver"; me.mag = 0;
  battleCues(b, mem, 0.9);
  me.mag = 6;
  const rv = battleCues(b, mem, 1).find((c) => c.name === "reload");
  check(rv && G.handScript(rv.hand).map((e) => e[0]).join() === "cylOpen,eject,speedloader,cylClose", "a revolver: the cylinder out, the empties out, the speedloader, closed");
  // another gun picked up: no reload sound for the new magazine
  me.weapon = "ar"; me.magW = "ar"; me.mag = 30;
  check(!battleCues(b, mem, 1.1).some((c) => c.name === "reload"), "another gun in the hands: no reload heard");
  // a taser fired
  me.nlTaser = 2; battleCues(b, mem, 1.2); me.nlTaser = 1;
  C.fx(b, { type: "shot", from: [me.x, me.y], to: [foe.x, foe.y], hit: true, side: "player" });
  cs = battleCues(b, mem, 1.3);
  check(names(cs)[0] === "taser" && !cs.some((c) => c.gun), "a taser: its zap, no gunshot");
  // a launcher: an M79 fired (a throw fx, its round counter down), then reloaded
  me.gl = { key: "m79", cal: "40mm", cap: 1, mag: 1, load: "he" };
  battleCues(b, mem, 1.4);
  me.gl.mag = 0;
  C.fx(b, { type: "throw", from: [me.x, me.y], to: [me.x + 10, me.y], item: "frag" });
  cs = battleCues(b, mem, 1.5);
  const thoonk = cs.find((c) => c.name === "launcher"), he = cs.find((c) => c.blast);
  check(thoonk && thoonk.gun.v === "gl40" && he && he.blast.kind === "gl40" && near(he.delay, BL.flight("gl", 10), 0.03) && !he.blast.pre, `a 40 mm HE: the thoonk, the impact ${he ? he.delay.toFixed(2) : "?"} s later (flight), no pin`);
  me.gl.mag = 1;
  cs = battleCues(b, mem, 1.6);
  check(cs.some((c) => c.name === "reload" && c.hand.rel === "gl"), "the launcher reloaded: broken open, a round in, closed");
  // an AT4: the tube fired and gone
  me.gl = { key: "at4", cal: "rocket", cap: 1, mag: 1, load: "heat", oneShot: true };
  battleCues(b, mem, 1.7);
  delete me.gl;
  C.fx(b, { type: "shot", from: [me.x, me.y], to: [me.x + 8, me.y], hit: true, side: "player", rocket: true });
  cs = battleCues(b, mem, 1.8);
  const rk = cs.find((c) => c.gun), wh = cs.find((c) => c.blast);
  check(rk && rk.gun.v === "rocket" && wh && wh.blast.kind === "rocket" && near(wh.delay, BL.flight("rocket", 8), 0.03) && !cs.some((c) => c.name === "hit"), `a rocket: the launch, the warhead ${wh ? wh.delay.toFixed(2) : "?"} s later, no bullet hit`);
}

// ---------- 6. grenades, merging, secondaries ----------
console.log("Grenades and blasts");
{
  const [town] = battles(33, ["field-town"]);
  const { b } = town;
  const mem = {};
  battleCues(b, mem, 0);
  const me = b.units.find((u) => u.side === "player" && !u.dead);
  const tx = Math.min(b.w - 1, me.x + 6), ty = me.y;
  C.fx(b, { type: "throw", from: [me.x, me.y], to: [tx, ty], item: "frag" });
  let cs = battleCues(b, mem, 0.1);
  const fr = cs.find((c) => c.blast);
  check(fr && fr.blast.kind === "frag" && fr.blast.pre && fr.blast.pre.h === "pin" && near(fr.delay, BL.THROW_FLIGHT + BL.FUSE.frag, 0.03) && fr.blast.land === BL.FUSE.frag,
    `a frag: the pin and spoon at the thrower, the clatter on landing (${BL.THROW_FLIGHT} s), the blast ${fr ? fr.delay.toFixed(2) : "?"} s after the throw`);
  C.fx(b, { type: "throw", from: [me.x, me.y], to: [tx, ty], item: "molotov" });
  cs = battleCues(b, mem, 0.2);
  const mo = cs.find((c) => c.blast);
  check(mo && mo.name === "fire" && mo.blast.kind === "molotov" && mo.blast.pre.h === "light" && near(mo.delay, BL.THROW_FLIGHT, 0.03), "a Molotov: the lighter, the bottle smashing as it lands, the whoomph and the fire");
  for (const [item, kind] of [["flashbang", "flash"], ["smokegren", "smoke"], ["flare", "flare"], ["bottle", "glass"], ["noisemaker", "clatter"], ["pipebomb", "pipebomb"]]) {
    C.fx(b, { type: "throw", from: [me.x, me.y], to: [tx, ty], item });
    const x = battleCues(b, mem, 0.3).find((c) => c.blast);
    if (!x || x.blast.kind !== kind) check(false, `${item}: ${x ? x.blast.kind : "nothing"}`);
  }
  check(true, "a flashbang, smoke, a flare, a bottle, a noise maker, a pipe bomb: each its own");
  // three blasts in one frame: one bigger sound
  for (const item of ["frag", "frag", "pipebomb"]) C.fx(b, { type: "throw", from: [me.x, me.y], to: [tx, ty], item });
  cs = battleCues(b, mem, 0.4);
  const bl = cs.filter((c) => c.blast);
  check(bl.length === 1 && bl[0].blast.n === 3 && bl[0].blast.kind === "frag" && bl[0].blast.extra && bl[0].blast.extra[0] !== "clatter", `three blasts in one frame: ${bl.length} sound (n ${bl[0] && bl[0].blast.n}, the runner-up ${bl[0] && bl[0].blast.extra && bl[0].blast.extra[0]} a moment later)`);
  // a carried bomb going off elsewhere (BOOM hits far from where this frame's blast landed): a secondary
  const far = b.units.find((u) => !u.dead && Math.hypot(u.x - tx, u.y - ty) > 6) || me;
  C.fx(b, { type: "throw", from: [me.x, me.y], to: [tx, ty], item: "frag" });
  C.fx(b, { type: "melee", from: [tx, ty], to: [tx, ty], hit: true, dmg: 20, side: "player", text: "BOOM" });
  C.fx(b, { type: "melee", from: [far.x, far.y], to: [far.x, far.y], hit: true, dmg: 20, side: "player", text: "BOOM" });
  cs = battleCues(b, mem, 0.5);
  check(cs.some((c) => c.blast && (c.blast.kind === "secondary" || (c.blast.extra && c.blast.extra[0] === "secondary"))) && !cs.some((c) => c.name === "melee" || c.name === "meleeCrit"), "a blast's own hits are silent; a carried bomb going off elsewhere is a secondary blast");
  // a car wrecked by the blast: the fireball
  const car = b.cells.findIndex((c) => c && c.car);
  if (car >= 0) {
    for (let i = 0; i < b.cells.length; i++) if (b.cells[i].car && b.cells[i].car === b.cells[car].car) b.cells[i].car = { ...b.cells[i].car, wrecked: true };
    C.fx(b, { type: "throw", from: [me.x, me.y], to: [car % b.w, Math.floor(car / b.w)], item: "pipebomb" });
    cs = battleCues(b, mem, 0.6);
    const v = cs.find((c) => c.blast);
    check(v && (v.blast.kind === "vehicle" || (v.blast.extra && v.blast.extra[0] === "vehicle")) && v.blast.glass, `a car wrecked: the fireball, glass (${v && v.blast.kind}${v && v.blast.extra ? ` + ${v.blast.extra[0]}` : ""})`);
  } else check(true, "(no car on this map to wreck)");
  check(BL.glassNear({ w: 3, h: 3, cells: Array.from({ length: 9 }, (_, i) => ({ k: i === 8 ? "window" : "open" })) }, 0, 0) && !BL.glassNear({ w: 3, h: 3, cells: Array.from({ length: 9 }, () => ({ k: "open" })) }, 0, 0), "glass near a window or a car, none in the open");
  // the blast takes priority over shots in a busy frame
  for (let i = 0; i < 30; i++) C.fx(b, { type: "shot", from: [me.x, me.y], to: [tx, ty], hit: false, side: "enemy" });
  C.fx(b, { type: "throw", from: [me.x, me.y], to: [tx, ty], item: "frag" });
  cs = battleCues(b, mem, 0.7);
  check(cs.some((c) => c.blast && c.blast.kind === "frag"), "a blast is kept over a frame of 30 shots");
}

// ---------- 7. space ----------
console.log("Pan, distance, rooms");
{
  const b = { w: 40, h: 30, units: [{ id: 1, side: "player", x: 10, y: 10 }] };
  const L = G.listener(b, { sel: 1, room: "field" });
  const at = (x, y, o) => G.spatial(L, x, y, o);
  const here = at(10, 10), right = at(30, 10), left = at(0, 10), mid = at(10, 22);
  check(here.gain === 1 && here.lp === 20000 && here.delay === 0 && here.pan === 0, "at the listener: full level, full highs, no delay, centred");
  check(right.pan > 0.5 && left.pan < -0.5 && near(right.gain, 1 / (1 + G.DIST.FALL * 17)) && right.lp < 6000 && near(right.delay, 20 * G.DIST.DELAY), `20 tiles right: pan ${right.pan.toFixed(2)}, level ${right.gain.toFixed(2)}, highs to ${Math.round(right.lp)} Hz, ${(right.delay * 1000).toFixed(0)} ms late; 10 left: pan ${left.pan.toFixed(2)}`);
  check(mid.gain > right.gain && mid.lp > right.lp && mid.send > here.send, "nearer is louder and brighter; farther is wetter");
  const cam = { cw: 1000, ch: 600, S: 2, project: (x, y) => [500 + (x - y) * 32, 300 + (x + y - 21) * 16] }; // (10.5, 10.5) in the middle of the screen
  const Lc = G.listener(b, { cam, room: "town" });
  const onLeft = G.spatial(Lc, 5, 20), onRight = G.spatial(Lc, 20, 5), centre = G.spatial(Lc, 10, 10);
  check(onLeft.pan < -0.5 && onRight.pan > 0.5 && Math.abs(centre.pan) < 0.05 && centre.dist < 1 && onLeft.dist > 5, `by the screen (no unit selected): left ${onLeft.pan.toFixed(2)}, right ${onRight.pan.toFixed(2)}, the middle of the screen ${centre.pan.toFixed(2)} at ${centre.dist.toFixed(1)} tiles`);
  const vis = new Uint8Array(40 * 30); vis[10 * 40 + 20] = 1;
  const Lv = G.listener(b, { sel: 1, vis });
  const seen = G.spatial(Lv, 20, 10, { enemy: true }), hidden = G.spatial(Lv, 20, 12, { enemy: true }), mineHidden = G.spatial(Lv, 20, 12, { enemy: false });
  check(seen.seen && !hidden.seen && hidden.lp <= G.DIST.HIDDEN_LP && hidden.gain < seen.gain && mineHidden.seen, `an enemy out of sight: muffled (highs to ${hidden.lp} Hz, level ×${G.DIST.HIDDEN_GAIN}); your own never`);
  const bf = BL.blastPlace(G.spatial(L, 35, 10)), gf = G.spatial(L, 35, 10);
  check(bf.lp < gf.lp && bf.delay > gf.delay && bf.delay <= BL.BLAST_DIST.SOUND_MAX, `a far blast: a low thud (${Math.round(bf.lp)} Hz against a shot's ${Math.round(gf.lp)}), late (${(bf.delay * 1000).toFixed(0)} ms)`);
  check(G.spatial(L, 12, 10, { indoor: true }).room === "inside" && G.place({ room: "town" }).tail === G.ROOMS.town.tail, "a shot from a floor cell: the tight room; the outdoor tail by place");
  const st = { tiles: [{ terrain: "city" }, { terrain: "forest" }, { terrain: "plains", loc: null }, { terrain: "suburb" }] };
  const room = (tile, extra = {}) => G.roomOf(st, { setup: { tile }, ...extra });
  check(room(0) === "town" && room(1) === "forest" && room(2) === "field" && room(3) === "town" && room(2, { raid: { plan: { building: {} } } }) === "inside" && G.roomOf(st, { setup: { tile: 1, layout: "baseDefence" } }) === "town",
    "rooms: a city or suburb is town (slapback), forest, open ground a field, a building raid indoors, a base town");
  // spatialOut: a bare placement for other modules (zombiesfx.js)
  const c = stubCtx();
  G.installBus(c, c.destination);
  const n = G.spatialOut(c, { x: 0.5, dist: 20, seen: false, layout: "forest" });
  check(n && n.kind === "gain" && n.gain.value > 0 && n.gain.value < 0.6, `spatialOut(c, { x, dist, seen, layout }) gives the node to play into (level ${n.gain.value.toFixed(2)})`);
}

// ---------- 8. deafened, ducking ----------
console.log("Deafened and ducking");
{
  const c = stubCtx();
  const B = G.installBus(c, c.destination);
  B.setMuffle(true, 1);
  const ev = B.muffle.frequency.events.at(-1);
  check(ev && ev[1] === G.MUFFLE_HZ, `deafened: the battle through a low-pass at ${G.MUFFLE_HZ} Hz`);
  B.setMuffle(false, 2);
  check(B.muffle.frequency.events.at(-1)[1] === Math.min(20000, c.sampleRate * 0.45), "and open again after");
  BL.playBlast(c, 3, { kind: "frag" }, G.place({ dist: 2 }));
  const d = B.duck.gain.events.filter((e) => e[0] === "tgt");
  check(d.length >= 2 && d[0][1] < 0.5 && d[1][1] === 1 && near(d[0][2], 3, 0.02), `a close frag ducks the rest of the battle to ${d[0] && d[0][1].toFixed(2)} and back`);
  const nDuck = B.duck.gain.events.length;
  BL.playBlast(c, 4, { kind: "frag" }, G.place({ dist: 20 }));
  BL.playBlast(c, 4, { kind: "smoke" }, G.place({ dist: 1 }));
  check(B.duck.gain.events.length === nDuck, "a far blast or a smoke grenade does not");
  const [town] = battles(34, ["field-town"]);
  const { b } = town;
  const u = b.units.find((x) => x.side === "player" && !x.dead);
  LISTEN.sel = () => u.id;
  const mem = {};
  battleCues(b, mem, 0);
  u.deaf = 2;
  C.fx(b, { type: "throw", from: [u.x, u.y], to: [u.x + 2, u.y], item: "frag" });
  const cs = battleCues(b, mem, 0.1);
  check(mem.deaf === true && cs.some((x) => x.name === "ring") && cs.find((x) => x.blast).gain <= 0.31, "deaf (sim/hearing.js): the ring once, everything at 30%, the muffle on (ui/audio.js reads the memory)");
  LISTEN.sel = null;
}

// ---------- 9. every cue plays on a context ----------
console.log("Playing");
{
  const c = stubCtx();
  G.installBus(c, c.destination);
  const errs = [];
  const L = G.listener({ w: 40, h: 30, units: [] }, { room: "town" });
  const play = (cue) => { try { BS.playCue(c, 0.1, 0.2, cue, L); } catch (e) { errs.push(`${cue.name}: ${e.message}`); } };
  for (const [k] of G.LAB_GUNS) for (const m of ["single", "burst", "auto"]) for (const sup of [false, true]) play({ name: k, at: [5, 5], gun: G.labPlan(k, m, sup) });
  for (const kind of Object.keys(BL.BLASTS)) play({ name: "blast", at: [8, 5], blast: { kind, pre: { h: "pin", at: [5, 5] }, land: 0.3, extra: ["frag", 0.1], glass: true, n: 2 } });
  for (const rel of new Set(Object.values(G.VOICE_OF).map((r) => r.rel))) play({ name: "reload", at: [5, 5], hand: { kind: "reload", rel, n: 4, empty: true } });
  for (const kind of ["jam", "unjam", "dry", "empty", "taser", "brass", "clatter"]) play({ name: kind, at: [5, 5], hand: { kind, h: "pin" } });
  check(!errs.length, `every gun in every mode, every blast and sequence, every handling sound plays${errs.length ? `: ${errs.slice(0, 3).join("; ")}` : ""}`);
  check(!c.bad.length, `no NaN, nothing connected to nothing, every source with its buffer${c.bad.length ? `: ${c.bad.slice(0, 4).join(", ")}` : ""}`);
  check(c.sources.every((s) => s.t >= 0), `${c.sources.length} sources, ${c.nodes.n} nodes, all started at a real time`);
}

// ---------- 10. determinism ----------
console.log("Determinism");
{
  const run = (withSound) => {
    const [x] = battles(77, ["field-town"]);
    const { st, b } = x;
    const mem = {}, c = stubCtx(8000);
    G.installBus(c, c.destination);
    const heard = new Set();
    let t = 0, err = "";
    const listen = () => {
      if (!withSound) return;
      const L = BS.frameListener(st, b, LISTEN);
      for (const cue of battleCues(b, mem, (t += 0.5))) { heard.add(cue.name); if (cue.gun || cue.blast || cue.hand) BS.playCue(c, t, t + (cue.delay || 0), cue, L); }
    };
    listen();
    for (let turn = 0; turn < 8 && !b.over; turn++) {
      try {
        C.autoPlayerTurn(st); listen();
        if (b.phase === "player") C.combatAct(st, { type: "end" });
        listen();
        if (b.phase === "enemy") C.runEnemyPhase(st);
        listen();
      } catch (e) { err = e.message; break; }
    }
    const snap = JSON.stringify({ log: b.log.map((l) => l.text), units: b.units.map((u) => [u.id, u.x, u.y, u.hp, !!u.dead, !!u.down, u.mag ?? null, u.jam ? u.jam.kind : null]), turn: b.turn, over: !!b.over, fx: b.fxSeq });
    return { snap, heard, err };
  };
  const a = run(false), s = run(true);
  check(!a.err && !s.err, `eight turns play out${a.err || s.err ? `: ${a.err || s.err}` : ""}`);
  check(a.snap === s.snap, `the same battle with and without the sound layer ends the same (${JSON.parse(a.snap).log.length} log lines, fx ${JSON.parse(a.snap).fx})`);
  check(s.heard.size >= 3, `heard along the way: ${[...s.heard].join(", ")}`);
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
