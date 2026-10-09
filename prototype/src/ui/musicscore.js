// The music's score: modes, the music states (which layers play, tempo, mode, density), the main motif and the
// composer that writes one bar at a time. Pure functions and plain objects, no WebAudio and no game state: ui/music.js
// plays what this writes, ui/musicdirector.js picks the state, tools/musictest.js checks it headless.
//
//   STATES[key]               a music state: bpm, meter, mode, chord progression, layer levels, patterns, density
//   stateDef(key, mods)       the state with its colour applied (season, a man down, the hush after a death)
//   composeBar(def, mem, rng, bar)  the notes of one bar: [{ layer, inst, midi, beat, vel, len }]
//   STINGS[key]               short fixed phrases played over the music (battle won or lost, a death, a base lost)
//   MOTIF                     the main motif: the title, the calm map and the victory theme share it
//
// Every state keeps the same tonic (D), so a change of state is a change of colour (mode, layers, tempo) and never a
// jump of key. The melody is a seeded random walk over the mode with the motif and remembered cells coming back.

export const TONIC = 50; // D3: the pads' home; the bass sits an octave under it, the melody an octave over
export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
};
export const LAYERS = ["pad", "bass", "keys", "pluck", "drums", "tex"]; // drone/pad, bass, melody, arpeggio, percussion, texture
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const mod = (a, n) => ((a % n) + n) % n;
// A scale degree (0 = the tonic, 7 = an octave up, negative below) to semitones from the tonic.
export const degSemis = (mode, d) => 12 * Math.floor(d / 7) + MODES[mode][mod(d, 7)];

// The main motif ("Calder"): 5 4 3 1 | 2 b7 1 in the minor, two bars of 4/4. In a major mode the same degrees sound
// hopeful (the victory theme), in the dorian worn (the calm map), in the aeolian sad (the title, game over).
export const MOTIF = [
  { d: 4, b: 0, l: 1 }, { d: 3, b: 1, l: 0.5 }, { d: 2, b: 1.5, l: 0.5 }, { d: 0, b: 2, l: 2 },
  { d: 1, b: 4, l: 1 }, { d: -1, b: 5, l: 1 }, { d: 0, b: 6, l: 2 },
];
// The motif fitted to 3/4 (the festival waltz): the same notes over two bars of three.
const MOTIF3 = [
  { d: 4, b: 0, l: 1 }, { d: 3, b: 1, l: 0.5 }, { d: 2, b: 1.5, l: 0.5 }, { d: 0, b: 2, l: 1 },
  { d: 1, b: 3, l: 1 }, { d: -1, b: 4, l: 1 }, { d: 0, b: 5, l: 1 },
];

// ---------- the states ----------
// levels: each layer's level 0–1 (0: silent). Patterns: pad (chord | drone | cluster | power), bass (none | root |
// roots | pulse | ostinato | waltz), keys (none | melody | bells | stabs), keysInst (epiano | bell), pluck (none | arp |
// sparse | strum | waltz | mute8), pluckInst (guitar | banjo), drums (none | heartbeat | tick | pulse | toms | full |
// festival), tex (none | swell | anvil | riser). density: how many of the notes a pattern could play are played; rest:
// the chance a melody phrase rests (calm music breathes); motifP: the chance a phrase opens on the motif; padCut: the
// pads' low-pass (Hz); chordBars: bars per chord; trim: the state's loudness in dB (set on the renders so the quiet
// states are not lost and the busy ones do not shout: about −19 dB RMS calm, −16 in a fight at the default volume).
const D = (o) => ({ meter: 4, chordBars: 1, density: 0.6, rest: 0.2, motifP: 0.25, padCut: 1400, keysInst: "epiano", pluckInst: "guitar", tex: "none", ...o });
export const STATES = {
  title: D({ trim: 2.4, label: "Title", bpm: 64, mode: "aeolian", prog: [0, 5, 2, 6], chordBars: 2, levels: { pad: 0.8, bass: 0.35, keys: 0.85, pluck: 0.55, drums: 0, tex: 0 },
    pad: "drone", bass: "root", keys: "melody", pluck: "sparse", drums: "none", density: 0.45, rest: 0.12, motifP: 0.65, padCut: 900 }),
  day: D({ trim: 1.5, label: "Map: day", bpm: 76, mode: "dorian", prog: [0, 3, 6, 0, 2, 3, 6, 6], chordBars: 2, levels: { pad: 0.55, bass: 0.45, keys: 0.6, pluck: 0.85, drums: 0, tex: 0 },
    pad: "chord", bass: "roots", keys: "melody", pluck: "arp", drums: "none", density: 0.6, rest: 0.4, motifP: 0.3, padCut: 1600 }),
  night: D({ trim: 4.6, label: "Map: night", bpm: 60, mode: "aeolian", prog: [0, 5, 3, 0], chordBars: 2, levels: { pad: 0.75, bass: 0.3, keys: 0.55, pluck: 0.3, drums: 0, tex: 0 },
    pad: "drone", bass: "root", keys: "bells", keysInst: "bell", pluck: "sparse", drums: "none", density: 0.35, rest: 0.45, motifP: 0.2, padCut: 700 }),
  festival: D({ trim: 1, label: "Harvest festival", bpm: 96, meter: 3, mode: "ionian", prog: [0, 3, 4, 0, 5, 3, 4, 4], levels: { pad: 0.45, bass: 0.55, keys: 0.6, pluck: 0.9, drums: 0.5, tex: 0 },
    pad: "chord", bass: "waltz", keys: "melody", pluck: "waltz", pluckInst: "banjo", drums: "festival", density: 0.7, rest: 0.25, motifP: 0.4, padCut: 2000 }),
  tension: D({ trim: 5, label: "Tension", bpm: 84, mode: "phrygian", prog: [0, 1, 0, 1, 0, 5, 1, 0], levels: { pad: 0.75, bass: 0.6, keys: 0.35, pluck: 0.35, drums: 0.5, tex: 0.6 },
    pad: "cluster", bass: "pulse", keys: "bells", keysInst: "bell", pluck: "mute8", drums: "tick", tex: "swell", density: 0.45, rest: 0.5, motifP: 0, padCut: 1100 }),
  crisis: D({ trim: 0.6, label: "Crisis", bpm: 112, mode: "harmonic", prog: [0, 0, 5, 4], levels: { pad: 0.6, bass: 0.8, keys: 0.5, pluck: 0, drums: 0.85, tex: 0.7 },
    pad: "power", bass: "ostinato", keys: "stabs", pluck: "none", drums: "toms", tex: "anvil", density: 0.7, rest: 0, motifP: 0, padCut: 1800 }),
  battleQuiet: D({ trim: 5, label: "Battle: no contact", bpm: 92, mode: "aeolian", prog: [0, 0, 5, 5], levels: { pad: 0.6, bass: 0.55, keys: 0.3, pluck: 0, drums: 0.45, tex: 0.3 },
    pad: "drone", bass: "pulse", keys: "bells", keysInst: "bell", pluck: "none", drums: "heartbeat", tex: "swell", density: 0.3, rest: 0.6, motifP: 0, padCut: 650 }),
  battleSeen: D({ trim: 4.1, label: "Battle: enemies in sight", bpm: 104, mode: "aeolian", prog: [0, 5, 3, 4], levels: { pad: 0.65, bass: 0.7, keys: 0.35, pluck: 0.35, drums: 0.7, tex: 0.5 },
    pad: "power", bass: "roots8", keys: "bells", keysInst: "bell", pluck: "mute8", drums: "toms", tex: "riser", density: 0.55, rest: 0.5, motifP: 0, padCut: 1200 }),
  battleFight: D({ trim: 0.5, label: "Battle: firefight", bpm: 126, mode: "harmonic", prog: [0, 0, 5, 4], levels: { pad: 0.55, bass: 0.85, keys: 0.6, pluck: 0, drums: 1, tex: 0.65 },
    pad: "power", bass: "ostinato", keys: "stabs", pluck: "none", drums: "full", tex: "anvil", density: 0.75, rest: 0, motifP: 0, padCut: 2200 }),
  battleWin: D({ trim: 0, label: "Battle: winning", bpm: 126, mode: "dorian", prog: [0, 6, 3, 0], levels: { pad: 0.6, bass: 0.85, keys: 0.6, pluck: 0, drums: 1, tex: 0.5 },
    pad: "power", bass: "ostinato", keys: "stabs", pluck: "none", drums: "full", tex: "anvil", density: 0.75, rest: 0, motifP: 0, padCut: 2600 }),
  battleLose: D({ trim: 0.5, label: "Battle: losing", bpm: 120, mode: "phrygian", prog: [0, 1, 5, 1], levels: { pad: 0.7, bass: 0.85, keys: 0.5, pluck: 0, drums: 0.9, tex: 0.7 },
    pad: "cluster", bass: "ostinato", keys: "stabs", pluck: "none", drums: "full", tex: "anvil", density: 0.65, rest: 0, motifP: 0, padCut: 1500 }),
  gameover: D({ trim: 2, label: "Game over", bpm: 54, mode: "aeolian", prog: [0, 5, 2, 6, 3, 0, 4, 4], chordBars: 1, levels: { pad: 0.85, bass: 0.45, keys: 0.9, pluck: 0.35, drums: 0, tex: 0 },
    pad: "chord", bass: "root", keys: "melody", pluck: "sparse", drums: "none", density: 0.4, rest: 0.08, motifP: 0.7, padCut: 1000, theme: true }),
  triumph: D({ trim: 1.8, label: "Victory theme", bpm: 72, mode: "ionian", prog: [0, 4, 5, 3, 0, "3m", 0, 4], levels: { pad: 0.7, bass: 0.55, keys: 0.85, pluck: 0.7, drums: 0.4, tex: 0 },
    pad: "chord", bass: "roots", keys: "melody", pluck: "strum", drums: "pulse", density: 0.6, rest: 0.05, motifP: 0.75, padCut: 2200, theme: true }),
};
export const STATE_KEYS = Object.keys(STATES);
// How hard each state is (the director's escalation order; ui/musicdirector.js).
export const RANK = { title: 0, day: 1, night: 1, festival: 1, tension: 3, crisis: 4, battleQuiet: 5, battleSeen: 6, battleFight: 7, battleWin: 7, battleLose: 7, gameover: 9, triumph: 9 };

// The state with its colour: mods { season: spring|summer|autumn|winter, down (bars left of a man down), hush (bars
// left of the quiet after a death) }. A new object: STATES stays as written.
export function stateDef(key, mods = {}) {
  const S = STATES[key] || STATES.day;
  const d = { ...S, key, levels: { ...S.levels } };
  const calm = key === "day" || key === "night";
  if (calm && mods.season === "winter") { // colder and sparser: the aeolian, bells high, no arpeggio running
    Object.assign(d, { bpm: S.bpm * 0.9, density: S.density * 0.6, rest: Math.min(0.7, S.rest + 0.15), mode: "aeolian", keysInst: "bell", keys: "bells", padCut: S.padCut * 0.8, pad: "drone", winter: true, trim: (S.trim || 0) + (key === "day" ? 2.5 : 1) });
    d.levels.pluck *= key === "day" ? 0.55 : 0.4; d.levels.bass *= 0.6;
    if (key === "day") d.pluck = "sparse";
  } else if (calm && mods.season === "summer") { // warmer: the mixolydian by day, fuller strums
    Object.assign(d, { bpm: S.bpm * 1.05, density: Math.min(0.9, S.density * 1.15), padCut: S.padCut * 1.2 });
    if (key === "day") { d.mode = "mixolydian"; d.prog = [0, 6, 3, 0, 4, 3, 6, 0]; }
    if (key === "night") d.levels.pluck = 0.45;
  } else if (calm && mods.season === "autumn") {
    Object.assign(d, { density: S.density * 0.9, rest: Math.min(0.7, S.rest + 0.05) });
  }
  if (mods.down > 0) { // one of yours down: the drums drop to a heartbeat, no ostinato or stabs for a few bars
    d.drums = "heartbeat"; d.bass = "none"; d.keys = "none"; d.tex = "none"; d.down = true;
    d.levels.drums = Math.max(0.5, d.levels.drums * 0.8);
  }
  if (mods.hush > 0) { // the quieter stretch after a death
    d.density *= 0.45; d.rest = Math.max(d.rest, 0.6); d.levels.drums *= 0.3; d.levels.bass *= 0.5; d.levels.tex *= 0.3; d.hush = true;
  }
  return d;
}

// ---------- harmony ----------
// A chord of the progression: a degree, or a degree with "m" (a borrowed minor triad: the triumph's iv).
export function chordAt(def, bar) {
  const c = def.prog[Math.floor(bar / (def.chordBars || 1)) % def.prog.length];
  const minor = typeof c === "string" && c.endsWith("m");
  const d = typeof c === "string" ? parseInt(c, 10) : c;
  const root = degSemis(def.mode, d);
  const third = minor ? root + 3 : degSemis(def.mode, d + 2);
  const fifth = degSemis(def.mode, d + 4);
  return { d, root, third, fifth, minor, tones: [mod(d, 7), mod(d + 2, 7), mod(d + 4, 7)] };
}
// A pitch class (semitones from the tonic) put in [lo, lo + 12).
const near = (semi, lo) => lo + mod(TONIC + semi - lo, 12);

// ---------- rhythm ----------
const RHYTHMS = {
  4: { sparse: [[0], [0, 2], [0, 3], [0, 1.5]], mid: [[0, 2, 3], [0, 1, 2], [0, 1.5, 2, 3], [0, 0.5, 1, 2]], dense: [[0, 1, 1.5, 2, 3], [0, 0.5, 1, 2, 2.5, 3], [0, 1, 2, 2.5, 3, 3.5]] },
  3: { sparse: [[0], [0, 2]], mid: [[0, 1, 2], [0, 2], [0, 1.5, 2]], dense: [[0, 1, 1.5, 2], [0, 0.5, 1, 2]] },
};
const pick = (rng, a) => a[Math.floor(rng() * a.length) % a.length];

// ---------- the melody ----------
// mem (per engine): { phrase: { plan, notes }, cell (a remembered two-bar phrase), last (degree), theme (theme played) }.
// One phrase is four bars: the motif and an answer, a remembered cell come back, or a fresh walk (remembered for later).
function nearestTone(deg, tones) {
  let best = deg, bd = 99;
  for (let k = -7; k <= 7; k++) { const x = deg + k; if (tones.includes(mod(x, 7)) && Math.abs(k) < bd) { bd = Math.abs(k); best = x; } }
  return best;
}
function walkBars(def, rng, start, bars, firstBar, endOnTonic) {
  const R = RHYTHMS[def.meter] || RHYTHMS[4];
  const band = def.density < 0.45 ? R.sparse : def.density < 0.7 ? R.mid : R.dense;
  const out = [];
  let p = start;
  for (let k = 0; k < bars; k++) {
    const ch = chordAt(def, firstBar + k);
    const on = pick(rng, band);
    for (let i = 0; i < on.length; i++) {
      const strong = on[i] === 0 || on[i] === def.meter / 2;
      const r = rng();
      const step = r < 0.08 ? 0 : r < 0.42 ? -1 : r < 0.76 ? 1 : r < 0.86 ? -2 : r < 0.95 ? 2 : (rng() < 0.5 ? -4 : 3);
      p += step;
      if (strong) p = nearestTone(p, ch.tones);
      if (p > 9) p -= 2; if (p < -3) p += 2;
      const next = i + 1 < on.length ? on[i + 1] : def.meter;
      out.push({ d: p, b: k * def.meter + on[i], l: Math.min(2, next - on[i]) * (0.9 + rng() * 0.2) });
    }
  }
  if (endOnTonic && out.length) { // the answer comes home: a long tonic (or its octave) on the last bar's downbeat
    const lastBar = (bars - 1) * def.meter;
    const keep = out.filter((n) => n.b < lastBar);
    keep.push({ d: Math.abs(p - 7) < Math.abs(p) ? 7 : 0, b: lastBar, l: def.meter * 0.9 });
    return keep;
  }
  return out;
}
function vary(rng, notes) { // the same cell, one note moved a step
  const v = notes.map((n) => ({ ...n }));
  if (v.length > 2) { const i = 1 + Math.floor(rng() * (v.length - 2)); v[i].d += rng() < 0.5 ? -1 : 1; }
  return v;
}
// Plans the four-bar phrase starting at bar.
export function planPhrase(def, mem, rng, bar) {
  const motif = def.meter === 3 ? MOTIF3 : MOTIF;
  const span = 2 * def.meter;
  let plan, notes;
  if (def.theme && !mem.theme) { mem.theme = def.key; plan = "motif"; } // a theme opens on the motif
  else if (rng() < def.rest) plan = "rest";
  else if (rng() < def.motifP) plan = "motif";
  else if (mem.cell && mem.cell.meter === def.meter && rng() < 0.45) plan = "cell";
  else plan = "walk";
  if (plan === "rest") notes = [];
  else if (plan === "motif") {
    const up = rng() < 0.25 ? 7 : 0; // now and then an octave up
    const head = motif.map((n) => ({ d: n.d + up, b: n.b, l: n.l }));
    notes = [...head, ...walkBars(def, rng, head[head.length - 1].d, 2, bar + 2, true).map((n) => ({ ...n, b: n.b + span }))];
  } else if (plan === "cell") {
    const head = vary(rng, mem.cell.notes);
    notes = [...head, ...walkBars(def, rng, head[head.length - 1].d, 2, bar + 2, true).map((n) => ({ ...n, b: n.b + span }))];
  } else {
    const head = walkBars(def, rng, mem.last ?? 2, 2, bar, false);
    if (!mem.cell || rng() < 0.3) mem.cell = { meter: def.meter, notes: head };
    notes = [...head, ...vary(rng, head).map((n) => ({ ...n, b: n.b + span }))];
    if (notes.length) { const last = notes[notes.length - 1]; last.d = nearestTone(last.d, [0, 2, 4]); }
  }
  if (notes.length) mem.last = notes[notes.length - 1].d;
  mem.phrase = { plan, notes, bar, key: def.key };
  return mem.phrase;
}

// ---------- one bar ----------
// The notes of bar `bar` of state def: { layer, inst, midi, beat (in the bar), vel 0–1, len (beats) }. mem: the
// engine's composer memory (phrases, cells); rng: a seeded 0–1 generator (never the world's).
export function composeBar(def, mem, rng, bar) {
  const out = [];
  const M = def.meter, ch = chordAt(def, bar), L = def.levels;
  const put = (layer, inst, midi, beat, vel, len) => { if (L[layer] > 0 && vel > 0) out.push({ layer, inst, midi, beat, vel: Math.min(1, vel), len }); };
  const dens = (p) => rng() < Math.min(1, p * (0.4 + def.density));
  const phraseBar = mod(bar, 4);
  // Pad: on the chord's first bar (a held chord), a little behind the beat.
  if ((def.chordBars <= 1 || bar % def.chordBars === 0) && def.pad !== "none") {
    const len = M * (def.chordBars || 1);
    const r = near(ch.root, 45);
    const notes = def.pad === "drone" ? [r - 12 >= 33 ? r - 12 : r, r + 7] :
      def.pad === "power" ? [r, r + 7] :
      def.pad === "cluster" ? [r, r + 1 + (rng() < 0.5 ? 0 : 12), r + 7] :
      [r, r + (ch.fifth - ch.root), near(ch.third, r + 5)];
    for (const m of notes) put("pad", "pad", m, 0, 0.8, len);
  }
  // Bass.
  const b0 = near(ch.root, 38);
  if (def.bass === "root") { if (def.chordBars <= 1 || bar % def.chordBars === 0) put("bass", "bassLong", b0, 0, 0.9, M * (def.chordBars || 1)); }
  else if (def.bass === "roots") { put("bass", "bassLong", b0, 0, 0.9, M / 2); if (dens(0.8)) put("bass", "bassLong", b0 + (ch.fifth - ch.root), M / 2, 0.75, M / 2); }
  else if (def.bass === "waltz") put("bass", "bassLong", b0, 0, 0.9, 1);
  else if (def.bass === "pulse") { for (let q = 0; q < M; q++) put("bass", "bassShort", b0, q, q === 0 ? 0.9 : 0.55, 0.5); }
  else if (def.bass === "roots8") { for (let e = 0; e < M * 2; e++) if (e % 2 === 0 || dens(0.6)) put("bass", "bassShort", e === 6 ? b0 + 12 : b0, e / 2, e % 4 === 0 ? 0.95 : 0.6, 0.45); }
  else if (def.bass === "ostinato") {
    const pat = [0, 0, 12, 0, 0, 0, ch.fifth - ch.root, 0, 0, 0, 12, 0, ch.fifth - ch.root, 0, ch.third - ch.root, 0]; // a driving sixteenth figure
    for (let s = 0; s < M * 4; s++) if (s % 2 === 0 || dens(0.75)) put("bass", "bassShort", b0 + pat[s % 16], s / 4, s % 4 === 0 ? 1 : 0.65, 0.25);
  }
  // Keys: the melody (its phrase), bells far off, or the battle's stabs.
  if (def.keys === "melody") {
    if (!mem.phrase || phraseBar === 0 || mem.phrase.key !== def.key || bar - mem.phrase.bar >= 4) planPhrase(def, mem, rng, bar - phraseBar);
    const off = (bar - mem.phrase.bar) * M;
    for (const n of mem.phrase.notes) if (n.b >= off && n.b < off + M) put("keys", def.keysInst, TONIC + 12 + degSemis(def.mode, n.d), n.b - off, 0.55 + rng() * 0.2 + (n.b === off ? 0.1 : 0), n.l);
  } else if (def.keys === "bells") {
    const n = def.density < 0.4 ? 1 : 2;
    for (let i = 0; i < n; i++) if (dens(0.55)) {
      const d = pick(rng, [...ch.tones.map((t) => t + 7), ch.tones[0] + 14, ch.tones[2] + 7 + (def.winter ? 7 : 0)]);
      put("keys", "bell", TONIC + 24 + degSemis(def.mode, d) - (def.winter ? 0 : 12 * (rng() < 0.4 ? 1 : 0)), Math.floor(rng() * M * 2) / 2, 0.35 + rng() * 0.25, 2);
    }
  } else if (def.keys === "stabs") {
    const r = near(ch.root, 50);
    const steps = pick(rng, [[0, 3, 6, 10], [0, 6, 10, 12], [0, 3, 8, 11, 14], [2, 6, 10]]);
    for (const s of steps) if (s < M * 4 && (s === 0 || dens(0.8))) { put("keys", "stab", r, s / 4, s === 0 ? 0.9 : 0.7, 0.3); put("keys", "stab", r + 7, s / 4, s === 0 ? 0.8 : 0.6, 0.3); }
  }
  // Pluck: fingerpicked arpeggio, sparse notes, strums, the waltz's oom-pah-pah, muted eighths.
  const tones = [near(ch.root, 50), near(ch.fifth, 50) + (ch.fifth < ch.root ? 12 : 0), near(ch.root, 50) + 12, near(ch.third, 50) + 12, near(ch.fifth, 50) + 12];
  const pi = def.pluckInst;
  if (def.pluck === "arp") {
    const order = [0, 2, 1, 3, 0, 4, 1, 3];
    for (let e = 0; e < M * 2; e++) if (e === 0 || dens(0.75)) put("pluck", pi, tones[order[e % 8]] + (e === 0 ? -12 : 0), e / 2, e % 2 ? 0.45 + rng() * 0.15 : 0.6 + rng() * 0.15, e === 0 ? 2 : 1);
  } else if (def.pluck === "sparse") {
    const n = 1 + (def.density > 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) if (dens(0.7)) put("pluck", pi, pick(rng, tones.slice(1)), Math.floor(rng() * M * 2) / 2, 0.4 + rng() * 0.2, 2);
  } else if (def.pluck === "strum") {
    for (const q of [0, M / 2]) for (let k = 0; k < 4; k++) put("pluck", pi, tones[k] + (k === 0 ? -12 : 0), q + k * 0.04, (q === 0 ? 0.65 : 0.5) - k * 0.04, 2);
    if (dens(0.5)) for (let k = 1; k < 4; k++) put("pluck", pi, tones[k], M / 2 + 1 + k * 0.03, 0.35, 1);
  } else if (def.pluck === "waltz") {
    put("pluck", pi, tones[0] - 12, 0, 0.7, 1);
    for (const q of [1, 2]) for (let k = 1; k < 4; k++) put("pluck", pi, tones[k], q + k * 0.03, 0.42 - k * 0.03, 0.9);
    if (dens(0.45)) put("pluck", pi, tones[4], 2.5, 0.35, 0.5);
  } else if (def.pluck === "mute8") {
    for (let e = 0; e < M * 2; e++) if (dens(0.6)) put("pluck", "muted", e % 4 === 3 ? tones[1] : tones[0], e / 2, e % 2 ? 0.35 : 0.5, 0.4);
  }
  // Drums (in sixteenths).
  const S = M * 4, hit = (inst, s, vel) => put("drums", inst, 0, s / 4, vel, 0.5);
  if (def.drums === "heartbeat") { if (def.down || bar % 2 === 0 || def.bpm > 100) { hit("heart", 0, 0.9); hit("heart", 3, 0.6); } }
  else if (def.drums === "tick") { for (let s = 0; s < S; s += 4) hit("hatC", s, s === 0 ? 0.45 : 0.3); hit("kick", 0, 0.55); if (phraseBar === 3 && dens(0.6)) for (let s = S - 4; s < S; s++) hit("snare", s, 0.2 + (s - S + 4) * 0.08); }
  else if (def.drums === "pulse") { hit("kick", 0, 0.6); hit("kick", S / 2, 0.45); for (let s = 4; s < S; s += 8) hit("hatC", s, 0.35); }
  else if (def.drums === "festival") { hit("tomL", 0, 0.6); for (let s = 2; s < S; s += 2) hit("shaker", s, s % 4 === 0 ? 0.5 : 0.32); if (dens(0.4)) hit("tomM", S - 2, 0.4); }
  else if (def.drums === "toms") {
    hit("kick", 0, 0.9);
    for (const s of [3, 6, 10, 12]) if (s < S && (s !== 3 || dens(0.7))) hit(s === 12 ? "tomM" : "tomL", s, 0.7);
    if (def.bpm >= 110) for (let s = 2; s < S; s += 4) hit("hatC", s, 0.3);
    if (phraseBar === 3) for (let s = S - 4; s < S; s++) hit("tomM", s, 0.5 + (s - S + 4) * 0.1);
  } else if (def.drums === "full") {
    for (const s of [0, 6, 8]) hit("kick", s, s === 0 ? 1 : 0.8);
    if (dens(0.5)) hit("kick", 11, 0.7);
    hit("snare", 4, 0.9); hit("snare", 12, 0.95);
    for (let s = 0; s < S; s++) if (s % 2 === 0 || dens(0.6)) hit(s === 14 && bar % 2 ? "hatO" : "hatC", s, s % 4 === 2 ? 0.5 : 0.32);
    if (phraseBar === 3) { hit("tomM", 13, 0.7); hit("tomL", 14, 0.75); hit("tomL", 15, 0.8); }
  }
  // Texture: a swell into the next phrase, anvil hits, a riser.
  if (def.tex === "swell" && phraseBar === 3) put("tex", "swell", 0, Math.max(0, M - 2.6 * def.bpm / 60), 0.7, 2.6 * def.bpm / 60);
  else if (def.tex === "anvil") { if (bar % 2 === 0) put("tex", "anvil", 0, 0, 0.8, 1); if (phraseBar === 0 && bar % 8 === 0) put("tex", "boom", 0, 0, 0.9, 2); }
  else if (def.tex === "riser" && phraseBar === 2) { put("tex", "swell", 0, M - 0.5, 0.45, M + 0.5); if (bar % 8 === 2) put("tex", "anvil", 0, 0, 0.45, 1); }
  return out;
}

// ---------- stings ----------
// Short fixed phrases over whatever is playing (the bed dips under them): [beat, inst, midi, vel, len] at bpm.
const T = TONIC;
export const STINGS = {
  // A battle won: the motif's head fast in the major, home on a wide D major chord with a ninth.
  victory: { label: "Battle won", bpm: 96, secs: 6, events: [
    [0, "epiano", T + 12 + 9, 0.7, 0.5], [0.5, "epiano", T + 12 + 7, 0.6, 0.25], [0.75, "epiano", T + 12 + 6, 0.6, 0.25], [1, "epiano", T + 12 + 2, 0.7, 1],
    [2, "epiano", T + 12 + 4, 0.65, 0.5], [2.5, "epiano", T + 12 + 1, 0.6, 0.5], [3, "epiano", T + 12 + 2, 0.8, 4],
    [3, "pad", T, 0.8, 5], [3, "pad", T + 7, 0.8, 5], [3, "pad", T + 16, 0.7, 5], [3, "bassLong", T - 12, 0.9, 4],
    [3, "bell", T + 26, 0.45, 4], [3, "guitar", T - 12, 0.6, 3], [3.04, "guitar", T - 5, 0.55, 3], [3.08, "guitar", T + 4, 0.5, 3], [3.12, "guitar", T + 9, 0.5, 3],
    [2.2, "swell", 0, 0.5, 0.8],
  ] },
  // Lost or ran: a sombre fall in the minor over a low Dm to Bb.
  defeat: { label: "Battle lost", bpm: 60, secs: 8, events: [
    [0, "pad", T - 12, 0.8, 3], [0, "pad", T - 5, 0.7, 3], [0, "bassLong", T - 12, 0.85, 3],
    [0, "epiano", T + 15, 0.6, 1], [1, "epiano", T + 14, 0.55, 1], [2, "epiano", T + 12, 0.6, 1], [3, "epiano", T + 13, 0.55, 1.5], [4.5, "epiano", T + 10, 0.6, 3],
    [3, "pad", T - 4, 0.75, 4], [3, "pad", T + 2, 0.7, 4], [3, "bassLong", T - 16, 0.85, 4],
    [0, "tomL", 0, 0.6, 1], [3, "tomL", 0, 0.5, 1],
  ] },
  // A colonist dies: the motif's first four notes slowed, on a bell, over a low D.
  death: { label: "A colonist dies", bpm: 56, secs: 8, events: [
    [0, "bell", T + 19, 0.5, 2], [1.5, "bell", T + 17, 0.45, 2], [2.5, "bell", T + 15, 0.45, 2], [3.5, "bell", T + 12, 0.55, 3],
    [0, "pad", T - 12, 0.6, 5], [0, "pad", T - 5, 0.5, 5], [3.5, "epiano", T + 12, 0.4, 3], [3.5, "epiano", T + 3, 0.35, 3],
  ] },
  // A base lost: a low bell tolled three times, the pads falling from Dm to Gm.
  baseLost: { label: "A base lost", bpm: 50, secs: 10, events: [
    [0, "bell", T - 12, 0.7, 3], [0, "boom", 0, 0.7, 2], [2, "bell", T - 12, 0.6, 3], [4, "bell", T - 5, 0.65, 3], [4, "boom", 0, 0.5, 2],
    [0, "pad", T - 12, 0.75, 4], [0, "pad", T - 5, 0.7, 4], [0, "pad", T + 3, 0.6, 4], [4, "pad", T - 7, 0.75, 4], [4, "pad", T - 2, 0.7, 4], [4, "pad", T + 3, 0.6, 4],
    [4, "bassLong", T - 19, 0.85, 4], [5, "epiano", T + 10, 0.45, 3],
  ] },
};
export const STING_KEYS = Object.keys(STINGS);
