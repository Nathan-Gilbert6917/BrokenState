// Music: generative and adaptive, made on the spot like every other sound (no audio files). ui/musicdirector.js reads
// the game and picks a music state; ui/musicscore.js writes it a bar at a time; ui/musicsynth.js bakes the instruments;
// this module plays it on its own bus (ui/audio.js makeMusicBus: a gentle compressor and the Music volume, into the
// master, never through the effects' limiter).
//
//   makeMusicBus(ctx, dest)   audio.js makeContext: the music bus { in, gain, comp } (dest: the mixer's Music group bus)
//   musicGains(bus, s, t, now, on)  audio.js applyGains: on with the Music group, the Stings part's level, the mute and the focus
//   migrateMusic(s, clean)    audio.js soundOptions: an early save's music volume and musicOn moved to the Music group
//   musicSting(name)          a sting now (the mixer's ▶ for Music)
//   musicFrame(A, state, ui, nowMs, heard, on)  audio.js audioFrame: the director every half second, the scheduler,
//                             the ducking under big sounds (heard: this frame's cues)
//   musicDuck(db, hold)       duck the music by db (4–6 for a big moment), back over about 1.5 s
//   createEngine(ctx, dest, o)  the engine on a context (the previews render it offline): apply(direction), tick(now),
//                             sting(name, t), duck(db, t), jump(key, t), stats
//   musicOptionsHtml / MUSIC_ACTIONS / MUSIC_CHANGE   Settings → Sound: the Music test list (hear each state and sting)
//
// The engine: a lookahead scheduler (MUSIC.LOOKAHEAD ahead, a timer as well as the frames so a hidden window keeps
// time) composes each bar as it comes near and plays each note as it comes within the lookahead. Six layers (pad,
// bass, keys, pluck, drums, texture) each have a gain; a change of state lands on the next bar line, the layers cross-
// fade over a bar (two beats into a battle) and the tempo glides. Stings play at once over the music, the bed dipping
// under them. Everything after the layers goes through a slow tape wobble, with a faint hiss, into the bus.
// UI only: nothing here touches the game's state or its random numbers (a local seeded generator writes the notes).
import { STATES, STINGS, LAYERS, RANK, stateDef, composeBar, STATE_KEYS, STING_KEYS } from "./musicscore.js";
import { makeBank, makeHiss, makeMusicIR, GAINED } from "./musicsynth.js";
import { readSituation, direct, DIRECTOR } from "./musicdirector.js";
import { rngOf } from "./sfxdsp.js";
import { BIG } from "./blastsfx.js"; // the blasts big enough to duck the music
import { assignGroup, groupGain, groupOn, groupVolume, volGain } from "./soundgroups.js"; // the mixer: the Music group and its Stings part

export const MUSIC = {
  LOOKAHEAD: 0.12,        // s: notes are made this far ahead of when they sound
  HIDDEN_LOOKAHEAD: 1.4,  // s, while the window is hidden (timers run once a second there)
  TIMER_MS: 50,           // the scheduler's own timer (the frames call it too)
  LEVEL: 0.82,            // the bus gain at the default Music volume (50%): about −19 dB RMS out at the default master when calm, −16 in a fight
                          // (the bus compressor and the master's add their automatic make-up gain: set on the renders, tools/musicpreview)
  NODE_CAP: 40,           // nodes sounding at once at most, the fixed graph's included
  STING_DIP: 0.4,         // the bed under a sting (−8 dB)
  HUSH: 0.6,              // the bed in the quiet after a death (−4.4 dB)
  DUCK_RELEASE: 0.45,     // s: the duck's recovery time constant (back within about 1.5 s)
  WOBBLE: 0.0009,         // s: the tape's slow pitch drift (depth of the delay's swing)
  HISS: 0.012,            // the tape hiss's level
  VERB: 0.22,             // the room's level (keys, pluck, pads and stings)
};
// Each layer's level at 1 (a state's level multiplies it). Tuned on the renders (tools/musicpreview).
export const LAYER_LEVEL = { pad: 0.2, bass: 0.36, keys: 0.3, pluck: 0.32, drums: 0.36, tex: 0.26, sting: 0.34 };
export const MAX_VOICES = { pad: 6, bass: 2, keys: 4, pluck: 4, drums: 6, tex: 2, sting: 10 };
const PRIORITY = { sting: 6, drums: 5, bass: 4, pad: 3, keys: 2, tex: 1, pluck: 1 }; // who keeps sounding when the node cap is reached
const ATTACK = { pad: 0.9, guitar: 0.002, banjo: 0.002, epiano: 0.003, bell: 0.002, swell: 0.01 };
const RING = { guitar: 0.5, banjo: 0.4, epiano: 1.4, bell: 2.4, swell: 0 }; // s a note may ring past its length before its release
const RELEASE = { pad: 1.3, guitar: 0.3, banjo: 0.25, epiano: 0.5, bell: 0.8, swell: 0.02 };

// ---------- the bus (ui/audio.js) ----------
// The music bus: a gentle compressor of its own (the music never reaches the effects' limiter), then the music's level
// (MUSIC.LEVEL, 0 while it is paused), into dest (the mixer's Music group bus, into the master). Two nodes.
export function makeMusicBus(ctx, dest) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.25; // rounds off the drums' peaks; the music's own level sits under it
  const gain = ctx.createGain();
  gain.gain.value = 0;
  comp.connect(gain);
  gain.connect(dest);
  return { in: comp, comp, gain };
}
// The music's volume is the mixer's Music group (ui/soundgroups.js: its slider squared, 100% the usual level) and its
// on/off the group's switch; the Stings part sets the stings' level. Muted, unfocused (with Mute when not focused) or
// with the group off, the engine pauses: it schedules nothing and the bus fades out.
let PAUSED = true, STING_K = 1;
export function musicGains(bus, s, t, now = false, on = true) {
  const play = !!(on && groupGain("music") > 0);
  const g = play ? MUSIC.LEVEL : 0;
  if (bus) { const p = bus.gain.gain; if (now) p.setValueAtTime(g, t); else p.setTargetAtTime(g, t, 0.25); }
  PAUSED = !play;
  STING_K = groupOn("music.stings") ? volGain(groupVolume("music.stings")) : 0;
  if (ENG) { ENG.paused = PAUSED; ENG.setStingLevel(STING_K, t); }
}
// An early save's Music slider (music 0–1, 50% the default) and musicOn: the group's volume at the same loudness, the
// group's switch. clean: cleanMix's { groups, off } (changed and returned).
export const oldMusicGain = (v) => (v <= 0.5 ? (Math.max(0, v) / 0.5) ** 2 : 1 + (Math.min(1, v) - 0.5) * 2);
export function migrateMusic(s, clean) {
  if (!s || !clean) return clean;
  if (Number.isFinite(Number(s.music)) && !(s.groups && typeof s.groups === "object" && "music" in s.groups)) {
    const v = Math.round(Math.min(1, Math.sqrt(oldMusicGain(Math.max(0, Math.min(1, Number(s.music)))))) * 100) / 100;
    if (v !== 1) clean.groups.music = v;
  }
  if (s.musicOn === false && !(s.off && typeof s.off === "object" && "music" in s.off)) clean.off.music = true;
  return clean;
}
// The music's names in the mixer (tools/soundmixtest.js: every sound in a group).
export const MUSIC_SOUND_NAMES = ["music", ...STING_KEYS.map((k) => `music${k[0].toUpperCase()}${k.slice(1)}`)];
assignGroup(["music"], "music");
assignGroup(MUSIC_SOUND_NAMES.slice(1), "music.stings");

// ---------- the engine ----------
// A looped control buffer (an LFO without an oscillator and a gain: one node): fn(t) over secs at 3 kHz.
function controlLoop(ctx, secs, fn) {
  const sr = 3000, n = Math.round(secs * sr), buf = ctx.createBuffer(1, n, sr), d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = fn(i / sr);
  if (buf.copyToChannel) buf.copyToChannel(d, 0); else buf.getChannelData(0).set(d);
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  return s;
}
export function createEngine(ctx, dest, o = {}) {
  const rng = rngOf(o.seed ?? ((Math.random() * 4294967296) >>> 0));
  const bank = makeBank(ctx);
  const T0 = ctx.currentTime;
  let fixed = 0;
  const mk = (n) => { fixed++; return n; };
  // The graph: layers -> bed -> tape (wobble) -> duck -> dest; pad, keys, pluck and stings into the room -> bed.
  const duck = mk(ctx.createGain()); duck.connect(dest);
  const tape = mk(ctx.createDelay(0.05)); tape.delayTime.value = 0.012; tape.connect(duck);
  const wob = mk(controlLoop(ctx, 5, (t) => MUSIC.WOBBLE * Math.sin(2 * Math.PI * 0.6 * t) + MUSIC.WOBBLE * 0.15 * Math.sin(2 * Math.PI * 5 * t)));
  wob.connect(tape.delayTime); wob.start(T0);
  const bed = mk(ctx.createGain()); bed.connect(tape);
  const room = mk(ctx.createConvolver());
  { const [L, R] = makeMusicIR(ctx.sampleRate); // scaled so its energy is MUSIC.VERB² (the room at VERB of the dry level; no send gain node)
    let e = 0; for (const ch of [L, R]) for (let i = 0; i < ch.length; i++) e += ch[i] * ch[i];
    const k = MUSIC.VERB / Math.sqrt(e / 2 || 1); for (const ch of [L, R]) for (let i = 0; i < ch.length; i++) ch[i] *= k;
    const b = ctx.createBuffer(2, L.length, ctx.sampleRate); if (b.copyToChannel) { b.copyToChannel(L, 0); b.copyToChannel(R, 1); } else { b.getChannelData(0).set(L); b.getChannelData(1).set(R); }
    room.normalize = false; room.buffer = b; }
  room.connect(bed);
  const gains = {}, val = {};
  for (const k of [...LAYERS, "sting"]) { gains[k] = mk(ctx.createGain()); gains[k].gain.value = k === "sting" ? LAYER_LEVEL.sting : 0; val[k] = gains[k].gain.value; }
  for (const k of LAYERS) gains[k].connect(bed);
  for (const k of ["pad", "keys", "pluck"]) gains[k].connect(room);
  gains.sting.connect(tape); gains.sting.connect(room);
  const padF = mk(ctx.createBiquadFilter()); padF.type = "lowpass"; padF.frequency.value = 1200; padF.Q.value = 0.7; padF.connect(gains.pad);
  const padLfo = mk(controlLoop(ctx, 14, (t) => 0.22 * Math.sin(2 * Math.PI * t / 14) * 1000)); // ±220 Hz over 14 s
  padLfo.connect(padF.frequency); padLfo.start(T0);
  const hiss = mk(ctx.createBufferSource());
  { const h = makeHiss(ctx.sampleRate); for (let i = 0; i < h.length; i++) h[i] *= MUSIC.HISS; const b = ctx.createBuffer(1, h.length, ctx.sampleRate); if (b.copyToChannel) b.copyToChannel(h, 0); else b.getChannelData(0).set(h); hiss.buffer = b; hiss.loop = true; }
  hiss.connect(duck); hiss.start(T0);

  const E = {
    ctx, bank, rng, paused: false, fixed: fixed + 2, // + the bus's two
    key: null, def: null, target: null, mods: { season: "summer" }, downBars: 0, hushBars: 0,
    bpm: 72, bar: 0, nextBar: null, queue: [], voices: [], mem: {}, bedLevel: 1, stingUntil: -1, duckUntil: -1, duckDepth: 1,
    stats: { notes: 0, dropped: 0, droppedBy: {}, stolen: 0, stolenBy: {}, late: 0, peakNodes: 0, peakVoices: 0, ticks: 0, tickMs: 0, maxTickMs: 0, bars: 0, changes: [] },
    lookahead: () => MUSIC.LOOKAHEAD,
  };
  const layerTarget = (def, k) => (def.levels[k] || 0) * LAYER_LEVEL[k] * Math.pow(10, (def.trim || 0) / 20); // trim: the state's loudness (dB), so calm and busy states sit near each other
  const setBed = (t, level, tau = 0.3) => { const p = bed.gain; if (p.cancelScheduledValues) p.cancelScheduledValues(t); p.setTargetAtTime(level, t, tau); };
  const baseBed = () => (E.hushBars > 0 ? MUSIC.HUSH : 1);

  const drop = (layer) => { E.stats.dropped++; E.stats.droppedBy[layer] = (E.stats.droppedBy[layer] || 0) + 1; };
  // The nodes sounding at t (started, not yet stopped): the voices' and, with E.fixed, the graph's.
  function soundingAt(t) {
    let n = 0;
    for (const v of E.voices) if (v.t <= t + 1e-6 && v.end > t) n += v.nodes;
    return n;
  }
  // Ends a voice at t (a quick fade on its own gain): room for a new one.
  function release(v, t, now) {
    const p = v.g.gain, from = Math.max(now, t - 0.03);
    if (p.cancelScheduledValues) p.cancelScheduledValues(from);
    p.setTargetAtTime(0, from, 0.008);
    const end = Math.max(from + 0.03, t);
    try { v.src.stop(end); } catch { /* fine */ }
    v.end = Math.min(v.end, end);
  }
  // A note: a buffer source at the baked pitch's rate, through a gain of its own when the instrument needs one. Within
  // MAX_VOICES a layer and MUSIC.NODE_CAP in all: over either, the oldest voice of a layer that matters less (or of the
  // same layer) makes way with a quick fade, else the note is dropped.
  function voice(layer, inst, midi, t, vel, len, spb, relOver, now) {
    E.voices = E.voices.filter((v) => v.end > now);
    const gained = GAINED.has(inst), need = gained ? 2 : 1, pri = PRIORITY[layer] ?? 1;
    const live = E.voices.filter((v) => v.layer === layer && v.t <= t + 1e-6 && v.end > t);
    if (live.length >= (MAX_VOICES[layer] || 4)) {
      const old = live.filter((v) => v.g).sort((a, b) => a.t - b.t)[0];
      if (!old) { drop(layer); return null; } // a drum or bass hit with nothing to steal: let the ringing ones be
      release(old, t, now);
    }
    for (let guard = 0; E.fixed + soundingAt(t) + need > MUSIC.NODE_CAP; guard++) {
      const victims = guard > 12 ? [] : E.voices.filter((v) => v.g && v.t <= t + 1e-6 && v.end > t && ((PRIORITY[v.layer] ?? 1) < pri || v.layer === layer)).sort((a, b) => (PRIORITY[a.layer] ?? 1) - (PRIORITY[b.layer] ?? 1) || a.t - b.t);
      if (!victims.length) { drop(layer); return null; }
      release(victims[0], t, now);
      E.stats.stolen++; E.stats.stolenBy[victims[0].layer] = (E.stats.stolenBy[victims[0].layer] || 0) + 1;
    }
    const e = bank.get(inst, midi, vel);
    const src = ctx.createBufferSource();
    src.buffer = e.buf;
    if (e.rate !== 1) src.playbackRate.value = e.rate;
    const dest2 = layer === "pad" ? padF : gains[layer];
    let g = null, end;
    if (gained) {
      g = ctx.createGain();
      const secs = len * spb, att = Math.min(ATTACK[inst] ?? 0.003, secs * 0.4), rel = relOver ?? RELEASE[inst] ?? 0.3;
      const hold = inst === "pad" ? secs : Math.min(secs + (RING[inst] ?? 1), e.secs / e.rate - rel);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel, t + att);
      g.gain.setValueAtTime(vel, t + Math.max(att, hold));
      g.gain.linearRampToValueAtTime(0, t + Math.max(att, hold) + rel);
      end = t + Math.max(att, hold) + rel + 0.02;
      src.connect(g); g.connect(dest2);
      if (e.loop) { src.loop = true; src.loopStart = e.loop[0]; src.loopEnd = e.loop[1]; }
    } else {
      src.connect(dest2);
      end = t + e.secs / e.rate;
    }
    // A pad starts anywhere in its loop; a swell is cut so it ends at its peak (on the beat it leads to).
    src.start(t, e.loop ? rng() * (e.loop[1] - 1) : inst === "swell" ? Math.max(0, e.secs - len * spb) : 0);
    src.stop(end);
    const v = { layer, t, end, src, g, nodes: need };
    E.voices.push(v);
    E.stats.notes++;
    const n = E.fixed + soundingAt(t);
    if (n > E.stats.peakNodes) E.stats.peakNodes = n;
    const nv = E.voices.filter((x) => x.t <= t + 1e-6 && x.end > t).length;
    if (nv > E.stats.peakVoices) E.stats.peakVoices = nv;
    return v;
  }
  // The live nodes at t: the voices sounding then (E.fixed adds the graph's).
  function liveAt(t) {
    E.voices = E.voices.filter((v) => v.end > t);
    return soundingAt(t);
  }
  // One bar: at its start the pending state takes over (layers fade, the tempo glides), then its notes are queued.
  function queueBar(t0) {
    const S = E.stats;
    let changed = false;
    if (E.target && (E.target.key !== E.key || E.target.season !== E.mods.season)) {
      const prev = E.def, from = E.key;
      E.key = E.target.key; E.mods.season = E.target.season;
      changed = from !== E.key;
      if (changed) { E.mem.phrase = null; S.changes.push({ t: t0, from, to: E.key, bar: E.bar }); E.prevDef = prev; }
    }
    if (!E.key) return false;
    const def = stateDef(E.key, { season: E.mods.season, down: E.downBars, hush: E.hushBars });
    const into = changed && E.prevDef && (RANK[E.key] ?? 0) > (RANK[E.prevDef.key] ?? 0) && E.key.startsWith("battle");
    // The tempo glides: at most 12% a bar toward the state's.
    const bpm0 = E.bpm, goal = def.bpm;
    const step = Math.max(3, bpm0 * 0.12);
    const bpm1 = E.def ? bpm0 + Math.max(-step, Math.min(step, goal - bpm0)) : goal;
    const M = def.meter, spb0 = 60 / (E.def ? bpm0 : bpm1), spb1 = 60 / bpm1;
    const barLen = M * (spb0 + spb1) / 2;
    const at = (beat) => t0 + spb0 * beat + (spb1 - spb0) * beat * beat / (2 * M);
    // The layers: crossfade over a bar (two beats into a battle), quickly when nothing was playing.
    const xf = !E.def ? 0.05 : into ? 2 * spb1 : barLen;
    for (const k of LAYERS) {
      const want = layerTarget(def, k);
      if (Math.abs(want - val[k]) > 1e-4) { const p = gains[k].gain; if (p.cancelScheduledValues) p.cancelScheduledValues(t0); p.setValueAtTime(val[k], t0); p.linearRampToValueAtTime(want, t0 + xf); val[k] = want; }
    }
    padF.frequency.setTargetAtTime(def.padCut, t0, changed ? barLen / 2 : 1.5);
    if (E.stingUntil < t0) setBed(t0, baseBed(), 1.2);
    // The notes; on a change, the layers the new state drops play out their last bar under the fade.
    const evs = composeBar(def, E.mem, rng, E.bar);
    if (changed && E.prevDef) {
      const pd = stateDef(E.prevDef.key, { season: E.mods.season });
      for (const ev of composeBar(pd, { ...E.mem }, rng, E.bar)) if (!(def.levels[ev.layer] > 0) && ev.layer !== "pad" && ev.beat < M / 2) evs.push(ev); // the first half: the fade has taken the rest
    }
    const padRel = def.bpm >= 100 ? 0.5 : undefined; // fast music: the pads let go quickly (fewer voices overlapping)
    for (const ev of evs) {
      const t = at(ev.beat);
      if (t < E.stingUntil && (ev.layer === "keys" || ev.layer === "pluck" || ev.layer === "tex")) continue; // under a sting the bed thins to its pads, bass and drums
      E.queue.push({ ...ev, t, spb: spb1, rel: ev.layer === "pad" ? padRel : undefined });
    }
    E.queue.sort((a, b) => a.t - b.t);
    E.def = def; E.bpm = bpm1; E.bar++; S.bars++;
    E.nextBar = t0 + barLen;
    if (E.downBars > 0) E.downBars--;
    if (E.hushBars > 0) E.hushBars--;
    E.prevDef = null;
    return true;
  }
  // Schedules everything due before now + lookahead. now: the context's time (or a virtual one offline).
  E.tick = (now) => {
    if (E.paused) return;
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const look = E.lookahead();
    if (E.nextBar == null || E.nextBar < now - 0.25) { // first start, or the clock jumped (a stall, a suspended context): start afresh on a new bar
      if (E.nextBar != null) E.stats.late++;
      E.queue = E.queue.filter((ev) => ev.layer === "sting" && ev.t >= now);
      E.nextBar = now + 0.06;
    }
    let guard = 0;
    while (E.nextBar < now + look && guard++ < 8) if (!queueBar(E.nextBar)) { E.nextBar = null; break; }
    while (E.queue.length && E.queue[0].t < now + look) {
      const ev = E.queue.shift();
      let t = ev.t;
      if (t < now) { if (now - t > 0.05) { E.stats.late++; continue; } t = now + 0.005; } // late by a hair: now; by more: skipped
      if (ev.inst) voice(ev.layer, ev.inst, ev.midi, t, ev.vel, ev.len, ev.spb, ev.rel, now);
    }
    liveAt(now);
    const ms = (typeof performance !== "undefined" ? performance.now() : 0) - t0;
    E.stats.ticks++; E.stats.tickMs += ms; if (ms > E.stats.maxTickMs) E.stats.maxTickMs = ms;
  };
  // The director's word: the state to play from the next bar line, a man down, the hush after a death.
  E.apply = (d, t = ctx.currentTime) => {
    if (!d || !d.key) return;
    E.target = { key: d.key, season: d.season || E.mods.season };
    if (d.down) E.downBars = DIRECTOR.DOWN_BARS;
    if (d.hush) E.hushBars = DIRECTOR.HUSH_BARS;
    if (d.down && E.key && E.key.startsWith("battle")) { // the swell as they fall
      E.queue.push({ layer: "tex", inst: "swell", midi: 0, t: t + 0.05, vel: 0.6, len: 1.6, spb: 1 });
      E.queue.sort((a, b) => a.t - b.t);
    }
    for (const s of d.stings || []) E.sting(s, t + 0.05);
    warm(d.key);
  };
  // A sting now: its notes on their own layer, the bed dipping under it.
  E.sting = (name, t = ctx.currentTime + 0.05) => {
    const S = STINGS[name];
    if (!S) return false;
    const spb = 60 / S.bpm;
    for (const [beat, inst, midi, vel, len] of S.events) E.queue.push({ layer: "sting", inst, midi, t: t + beat * spb, vel, len, spb });
    E.queue.sort((a, b) => a.t - b.t);
    E.stingUntil = t + S.secs;
    setBed(t, MUSIC.STING_DIP * baseBed(), 0.25);
    bed.gain.setTargetAtTime(baseBed(), t + S.secs - 1.2, 0.8);
    return true;
  };
  // The Stings part's level (the mixer): the sting layer's gain.
  E.setStingLevel = (k, t = ctx.currentTime) => { const v = LAYER_LEVEL.sting * k; gains.sting.gain.setTargetAtTime(v, t, 0.06); val.sting = v; };
  // Duck under a big sound: db down at once, back over about 1.5 s. A deeper duck wins over a shallower one.
  E.duck = (db, t = ctx.currentTime, hold = 0.2) => {
    const depth = Math.pow(10, -Math.abs(db) / 20);
    if (t < E.duckUntil && depth >= E.duckDepth) return false;
    const p = duck.gain;
    if (p.cancelScheduledValues) p.cancelScheduledValues(t);
    p.setTargetAtTime(depth, t, 0.03);
    p.setTargetAtTime(1, t + hold, MUSIC.DUCK_RELEASE);
    E.duckUntil = t + hold + 0.3; E.duckDepth = depth;
    return true;
  };
  // Straight to a state (the music test): the queue cleared, the next bar at once, the layers set in a moment.
  E.jump = (key, t = ctx.currentTime, mods = {}) => {
    if (!STATES[key]) return false;
    E.queue = E.queue.filter((ev) => ev.layer === "sting");
    E.target = { key, season: mods.season || E.mods.season };
    E.key = null; E.def = null; E.mem = {}; E.nextBar = t + 0.08;
    if (mods.down) E.downBars = DIRECTOR.DOWN_BARS;
    for (const v of E.voices) if (v.g && v.layer !== "sting") { v.g.gain.cancelScheduledValues && v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.08); }
    warm(key);
    return true;
  };
  // Bakes a state's instruments a few at a time ahead of need (the first bars would otherwise bake on the spot).
  const warmList = [];
  function warm(key) {
    const def = stateDef(key, E.mods);
    const want = [["pad", 38], ["pad", 45], ["pad", 50], ["pad", 53], ["bassLong", 38], ["bassShort", 38], ["bassShort", 41], ["kick", 0, 1], ["hatC", 0, 0.4], ["snare", 0, 1]];
    if (def.keysInst) for (let m = 62; m <= 86; m += 3) want.push([def.keysInst, m]);
    if (def.pluckInst) for (let m = 38; m <= 74; m += 3) want.push([def.pluckInst, m]);
    for (const w of want) warmList.push(w);
  }
  E.warmStep = (budgetMs = 3) => { if (!warmList.length) return 0; const left = bank.warm(warmList, budgetMs); warmList.splice(0, warmList.length - left); return left; };
  E.liveNodes = (t) => E.fixed + liveAt(t);
  return E;
}

// ---------- in the game (ui/audio.js) ----------
let ENG = null, BIND = null, TIMER = null;
const SIT = {}, DIR = {};
let lastLook = -1e9, override = null, nowState = null;
const DUCK = { blast: 6, zShriek: 5, alarm: 5, cardCrisis: 5, horde: 5, death: 4, cardWarning: 3, downed: 3, scream: 3 };
// audio.js hands over once (module state there): opt() its options, unlock() the first-gesture unlock, bus() the live
// context and music bus ({ ctx, mus } or null).
export function bindMusic(api) { BIND = api; }
const opts = () => (BIND && BIND.opt() ? BIND.opt().sound : null);
export const musicDebug = { get engine() { return ENG; }, get dir() { return DIR; }, get sit() { return SIT.last || null; }, get override() { return override; }, get state() { return nowState; } };
// Duck the music (a big moment): db down, back over about 1.5 s. Safe to call with no music playing.
export function musicDuck(db = 5, hold = 0.2) { if (ENG && !ENG.paused) ENG.duck(db, ENG.ctx.currentTime + 0.01, hold); }

function startTimer() {
  if (TIMER || typeof setInterval === "undefined" || typeof window === "undefined") return;
  TIMER = setInterval(() => { if (ENG && !ENG.paused) { ENG.tick(ENG.ctx.currentTime); ENG.warmStep(2); } }, MUSIC.TIMER_MS);
}
const hidden = () => typeof document !== "undefined" && !!document.hidden;
// Every frame: the director every DIRECTOR.TICK s (its memory moves on even while silent, so unmuting does not play
// what happened meanwhile), then the ducks and the scheduler. on: the context is live and not muted.
function ensureEngine(A) {
  if (!A || A.test || !A.mus) return null;
  if (!ENG || ENG.ctx !== A.ctx) {
    ENG = createEngine(A.ctx, A.mus.in);
    ENG.lookahead = () => (hidden() ? MUSIC.HIDDEN_LOOKAHEAD : MUSIC.LOOKAHEAD);
    ENG.paused = PAUSED;
    ENG.setStingLevel(STING_K, A.ctx.currentTime);
    if (DIR.key) ENG.apply({ key: DIR.key, season: SIT.last ? SIT.last.season : "summer", stings: [] });
    startTimer();
  }
  return ENG;
}
export function musicFrame(A, state, ui, nowMs, heard = [], on = true) {
  const s = opts();
  if (!s) return;
  const now = nowMs / 1000;
  if (override && !(ui && ui.settings)) override = null; // the music test ends with the menu
  if (now - lastLook >= DIRECTOR.TICK) {
    lastLook = now;
    let d = null;
    try {
      const sit = readSituation(state, ui, SIT, now);
      SIT.last = sit;
      d = direct(DIR, sit, now, s.musicFollow !== false);
      d.season = sit.season;
    } catch (e) { console.warn("Broken State: the music director failed", e); }
    if (d) { nowState = d.key; if (ENG && !override) ENG.apply(d); else if (ENG && override && d.stings.length) for (const n of d.stings) ENG.sting(n); }
  }
  if (groupGain("music") <= 0 || !ensureEngine(A)) return;
  ENG.paused = PAUSED || !on;
  if (ENG.paused) return;
  // Ducks: the big moments among this frame's cues, each at the time it will be heard (a grenade after its fuse).
  const t = A.ctx.currentTime + 0.01;
  for (const c of [...heard].sort((a, b) => (a && a.delay || 0) - (b && b.delay || 0))) {
    if (!c || !DUCK[c.name]) continue;
    if (c.name === "blast" && !(c.blast && BIG.has(c.blast.kind))) continue; // a bottle, a fire or a flare does not duck
    ENG.duck(DUCK[c.name], t + Math.max(0, c.delay || 0));
  }
  ENG.tick(A.ctx.currentTime);
  ENG.warmStep(1.5);
}

// ---------- Settings → Sound: the music test ----------
const TEST = {
  auto: "Follow the game",
  ...Object.fromEntries(STATE_KEYS.map((k) => [k, STATES[k].label])),
  "winter:day": "Map: winter day", "winter:night": "Map: winter night", "summer:day": "Map: summer day", "down:battleFight": "Battle: one of yours down",
  ...Object.fromEntries(STING_KEYS.map((k) => [`sting:${k}`, `Sting: ${STINGS[k].label.toLowerCase()}`])),
};
let testPick = "auto";
export function musicOptionsHtml(esc, tip) {
  const now = nowState && STATES[nowState] ? STATES[nowState].label : "nothing yet";
  return `<div class="setrow">
      <label${tip("Hear each music state and sting. The music goes back to following the game when you pick Follow the game or close the menu.")}>Music test <select data-action="mus-pick">${Object.entries(TEST).map(([k, l]) => `<option value="${k}" ${k === testPick ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <button data-action="mus-test"${tip("Play the music picked")}>▶ Play</button>
      <span class="small muted" data-music-now>Playing: ${esc(override ? TEST[override] || override : now)}</span>
    </div>`;
}
function audition(pick) {
  testPick = pick;
  if (BIND) BIND.unlock();
  if (BIND && !ENG) ensureEngine(BIND.bus());
  if (pick === "auto") { override = null; if (ENG && DIR.key) ENG.jump(DIR.key, ENG.ctx.currentTime, { season: SIT.last && SIT.last.season }); return; }
  if (!ENG) return;
  const t = ENG.ctx.currentTime;
  if (pick.startsWith("sting:")) { ENG.sting(pick.slice(6), t + 0.05); return; }
  override = pick;
  const [a, b] = pick.includes(":") ? pick.split(":") : [null, pick];
  ENG.jump(b, t, a === "down" ? { down: true } : a ? { season: a } : { season: "spring" });
  const el = typeof document !== "undefined" && document.querySelector("[data-music-now]");
  if (el) el.textContent = `Playing: ${TEST[pick] || pick}`;
}
export const MUSIC_ACTIONS = { "mus-test": () => audition(testPick) };
// A sting now over whatever plays (the mixer's ▶ for Music and its Stings): false with no live context.
export function musicSting(name = "victory") {
  if (BIND) { BIND.unlock(); ensureEngine(BIND.bus()); }
  if (!ENG || ENG.paused) return false;
  return ENG.sting(name, ENG.ctx.currentTime + 0.05);
}
export const MUSIC_CHANGE = { "mus-pick": (state, ui, el) => { if (TEST[el.value]) audition(el.value); } };
export const MUSIC_TEST_NAMES = Object.keys(TEST);
