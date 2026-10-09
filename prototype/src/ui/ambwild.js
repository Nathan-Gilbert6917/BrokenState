// Wildlife you hear (ui/ambscene.js plans it, ui/audio.js calls wildFrame four times a second): songbirds and the
// dawn chorus, crows and ravens, owls, geese and ducks, a woodpecker, crickets, frogs and cicadas, dogs gone feral,
// wolves and coyotes, an elk in the rut, something in the brush, and flies where the dead are. Each call is an FM
// voice baked once per variant (no audio files); the danger silences them all (ui/ambscene.js hush).
//
//   WILDLIFE_SOUNDS          every wildlife sound by name: { label, bed?, trim, pan } (a mixer maps them to "wildlife")
//   WILD_LIMIT               calls ringing at once (at most)
//   wildFrame(E, plan, t)    sets the insect beds and plays the calls due
//   wildCall(E, plan, name, t)  one call now (previews)
import { setBed, setDull, bakeBuffer, playShot, busy, clamp, expo, SHOT_SR, fmNote, noiseBurst, modes, formants,
  filterIn, verb, echoes, norm, buf1, buf2 } from "./ambkit.js";
import { loopBed } from "./ambweather.js";

// trim: the level at bed level 1 or a call's gain 1, under the ambience slider; pan: how far off to one side a call
// may sit (0–1); far: how far away it tends to be (0 near, 1 far: quieter and duller).
export const WILDLIFE_SOUNDS = {
  crickets:    { label: "Crickets (a chorus)", bed: true, trim: 0.075 },
  frogs:       { label: "Frogs (peepers and trillers)", bed: true, trim: 0.06 },
  cicadas:     { label: "Cicadas", bed: true, trim: 0.05 },
  songRobin:   { label: "Songbird: robin-like phrases", trim: 0.075, pan: 0.85, far: 0.5 },
  songWarbler: { label: "Songbird: warbler trill", trim: 0.06, pan: 0.85, far: 0.55 },
  songWhistle: { label: "Songbird: clear whistle", trim: 0.065, pan: 0.85, far: 0.5 },
  songFinch:   { label: "Songbird: finch twitter", trim: 0.055, pan: 0.8, far: 0.45 },
  birdAlarm:   { label: "Bird alarm calls (flushed)", trim: 0.08, pan: 0.7, far: 0.3 },
  crow:        { label: "Crow", trim: 0.09, pan: 0.9, far: 0.5 },
  raven:       { label: "Raven", trim: 0.08, pan: 0.9, far: 0.6 },
  owlHoot:     { label: "Owl hooting", trim: 0.1, pan: 0.8, far: 0.55 },
  owlScreech:  { label: "Screech owl", trim: 0.06, pan: 0.8, far: 0.5 },
  geese:       { label: "Geese overhead", trim: 0.08, pan: 0.6, far: 0.4 },
  ducks:       { label: "Ducks on the water", trim: 0.07, pan: 0.8, far: 0.5 },
  woodpecker:  { label: "Woodpecker drumming", trim: 0.08, pan: 0.85, far: 0.6 },
  bullfrog:    { label: "Bullfrog", trim: 0.09, pan: 0.8, far: 0.4 },
  flies:       { label: "Flies buzzing", trim: 0.05, pan: 0.5, far: 0.1 },
  dogBark:     { label: "Dog barking far off", trim: 0.09, pan: 0.9, far: 0.8 },
  dogHowl:     { label: "Dog howling far off", trim: 0.07, pan: 0.9, far: 0.85 },
  wolfHowl:    { label: "Wolf howl", trim: 0.08, pan: 0.9, far: 0.85 },
  coyote:      { label: "Coyotes yipping", trim: 0.07, pan: 0.9, far: 0.8 },
  elkBugle:    { label: "Elk bugling (autumn)", trim: 0.08, pan: 0.85, far: 0.75 },
  rustle:      { label: "Rustling in the brush", trim: 0.06, pan: 0.85, far: 0.2 },
};
export const WILD_LIMIT = 4;
const VARIANTS = { geese: 3, flies: 3, wolfHowl: 3, coyote: 3, elkBugle: 3 };
const GAP = 1.2; // s: the same species twice at least this far apart
// Bake rates: the low voices need less (cheaper to bake, smaller to keep); songbirds get the full SHOT_SR.
export const CALL_SR = { default: SHOT_SR, owlHoot: 16000, bullfrog: 16000, flies: 16000, wolfHowl: 22050, dogBark: 22050, dogHowl: 22050, crow: 22050, raven: 22050, geese: 22050, ducks: 22050, coyote: 22050, elkBugle: 24000, woodpecker: 24000, owlScreech: 22050 };

const BEDS = {
  crickets: loopBed("wildlife", "crickets", cricketLoop),
  frogs: loopBed("wildlife", "frogs", frogLoop),
  cicadas: loopBed("wildlife", "cicadas", cicadaLoop),
};

export function wildFrame(E, P, t) {
  const M = E.mem.wild || (E.mem.wild = { acc: {}, u: {}, last: 0, lastCall: {}, lastVar: {} });
  const dt = M.last ? Math.max(0, Math.min(1, t - M.last)) : 0.25;
  M.last = t;
  const B = P.beds, tr = (n) => WILDLIFE_SOUNDS[n].trim;
  // The insects fall silent over a few seconds and come back slowly (the plan's hush), swaying a little.
  const sway = (k) => 0.88 + 0.12 * Math.sin(t * (0.07 + k * 0.03) + k);
  setBed(E, "crickets", BEDS.crickets, B.crickets * sway(1) * tr("crickets"), t, B.crickets < (M.cr || 0) ? 1.2 : 4);
  setBed(E, "frogs", BEDS.frogs, B.frogs * sway(2) * tr("frogs"), t, B.frogs < (M.fr || 0) ? 1.2 : 4);
  setBed(E, "cicadas", BEDS.cicadas, B.cicadas * sway(3) * tr("cicadas"), t, 3);
  M.cr = B.crickets; M.fr = B.frogs;
  setDull(E, "wildlife", P.dull.wildlife, t);
  // Flushed: as the dead come near, one burst of alarm calls, then nothing.
  if (P.flush && !P.indoor && P.far < 0.5) callOne(E, P, E.rnd() < 0.5 ? "birdAlarm" : "crow", t + 0.1, M, true);
  const R = P.wild || {};
  for (const name of Object.keys(R)) {
    const rate = R[name];
    if (!(rate > 0)) { M.acc[name] = 0; continue; }
    M.acc[name] = (M.acc[name] || 0) + rate / 60 * dt;
    if (M.u[name] == null) M.u[name] = expo(E.rnd);
    if (M.acc[name] < M.u[name]) continue;
    if (t - (M.lastCall[name] ?? -99) < GAP) continue;
    if (busy(E, "wildlife", t) >= WILD_LIMIT) continue; // a full house: it waits (the accumulator keeps its place)
    if (callOne(E, P, name, t + E.rnd() * 0.25, M)) { M.acc[name] = 0; M.u[name] = expo(E.rnd); }
  }
}
// One call now, past the rates (the previews' showcase calls; a flushed alarm): false if it is still baking.
export function wildCall(E, P, name, t) {
  const M = E.mem.wild || (E.mem.wild = { acc: {}, u: {}, last: 0, lastCall: {}, lastVar: {} });
  return callOne(E, P, name, t, M, true);
}
// One call: a baked variant (not the same one twice running), placed left or right and near or far, duller far off
// and in fog; near a hive pitched down and cut short (the wildlife sounds wrong there).
function callOne(E, P, name, t, M, force = false) {
  if (!force && busy(E, "wildlife", t) >= WILD_LIMIT) return false;
  const S = WILDLIFE_SOUNDS[name], nv = VARIANTS[name] || 4;
  let v = Math.floor(E.rnd() * nv);
  if (nv > 1 && v === M.lastVar[name]) v = (v + 1) % nv;
  const buf = bakeBuffer(E, `${name}:${v}`, CALLS[name], CALL_SR[name]);
  if (!buf) return false;
  M.lastVar[name] = v;
  M.lastCall[name] = t;
  const r = E.rnd;
  const far = clamp((S.far ?? 0.5) + (r() - 0.5) * 0.6, 0, 1);
  const side = r() < 0.5 ? -1 : 1;
  const pan = side * (S.pan ?? 0.8) * (name === "dogBark" || name === "dogHowl" ? 0.55 + r() * 0.45 : 0.2 + r() * 0.8);
  let lp = far > 0.45 ? 14000 * Math.pow(1 - far, 1.2) + 1600 : 0;
  if (P.fog) lp = Math.min(lp || 6000, far > 0.3 ? 2200 : 5000);
  const wrong = P.wrong > 0.2 && name !== "flies";
  playShot(E, "wildlife", buf, t, {
    gain: S.trim * (1 - 0.55 * far) * (P.fog ? 0.75 : 1), pan, lp,
    panTo: name === "geese" ? -pan * (0.6 + r() * 0.4) : undefined, // a skein crossing overhead
    rate: (wrong ? 0.8 : 1) * (0.95 + r() * 0.1),
    cut: wrong ? buf.duration * (0.4 + r() * 0.3) : 0,
  });
  return true;
}

// ---------- the calls (baked per variant: sr, rnd seeded by name and variant) ----------
const pick = (r, a) => a[Math.floor(r() * a.length)];
export const CALLS = {
  // Songbirds: whistled syllables slurred up and down (a robin's carolling), a fast falling trill that speeds up (a
  // warbler), two or three pure held whistles (fee-bee, a sparrow's song), a jumble of twittering chirps (a finch).
  songRobin(sr, r) {
    const a = buf1(sr, 3.2), base = 2100 + r() * 900;
    let at = 0.02;
    const n = 4 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const d = 0.11 + r() * 0.12, f0 = base * (0.9 + r() * 0.35), up = 1.1 + r() * 0.35, down = r() < 0.5;
      fmNote(a, sr, { at, dur: d, f: (u) => f0 * (down ? 1 + (up - 1) * Math.sin(Math.PI * u) : Math.pow(up, u) * (1 - 0.1 * u)), amp: 0.6 + r() * 0.4, a: 0.12, r: 0.3, ratio: 2, index: 0.25, h2: 0.06 });
      at += d + 0.04 + r() * 0.12;
      if (i === 2 && r() < 0.6) at += 0.25;
    }
    verb(a, sr, 0.9, 0.18, 6000);
    return norm(a, 0.85);
  },
  songWarbler(sr, r) {
    const a = buf1(sr, 2.4), f0 = 4200 + r() * 1800;
    let at = 0.02, gap = 0.085;
    const n = 10 + Math.floor(r() * 10);
    for (let i = 0; i < n; i++) {
      const u0 = i / n, top = f0 * (1 + 0.25 * u0), d = 0.045 + r() * 0.015;
      fmNote(a, sr, { at, dur: d, f: (u) => top * (1 - 0.35 * u), amp: 0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, u0 * 1.3)), a: 0.1, r: 0.4 });
      at += gap; gap *= 0.97;
    }
    fmNote(a, sr, { at: at + 0.03, dur: 0.12, f: (u) => f0 * (0.9 + 0.5 * u), amp: 0.7, a: 0.1, r: 0.3 }); // the flourish
    verb(a, sr, 0.8, 0.15, 7000);
    return norm(a, 0.85);
  },
  songWhistle(sr, r) {
    const a = buf1(sr, 2.6), hi = 3300 + r() * 900;
    const kind = r();
    if (kind < 0.5) { // fee-bee
      fmNote(a, sr, { at: 0.02, dur: 0.38, f: (u) => hi * (1 - 0.03 * u), amp: 0.9, a: 0.15, r: 0.25 });
      fmNote(a, sr, { at: 0.48, dur: 0.4, f: (u) => hi * 0.84 * (1 - 0.06 * Math.sin(Math.PI * u)), amp: 0.8, a: 0.15, r: 0.3 });
    } else { // a long note, then a run of triplets higher up
      fmNote(a, sr, { at: 0.02, dur: 0.6, f: () => hi * 0.82, amp: 0.85, a: 0.15, r: 0.2 });
      let at = 0.7;
      for (let i = 0; i < 3 + Math.floor(r() * 3); i++) for (const k of [1, 1.12, 1.05]) { fmNote(a, sr, { at, dur: 0.1, f: () => hi * k, amp: 0.6, a: 0.15, r: 0.3 }); at += 0.12; }
    }
    verb(a, sr, 1, 0.2, 6000);
    return norm(a, 0.85);
  },
  songFinch(sr, r) {
    const a = buf1(sr, 2.6);
    let at = 0.02;
    const end = 1.4 + r() * 0.9;
    while (at < end) {
      const f0 = 2500 + r() * 4000, f1 = f0 * (0.7 + r() * 0.7), d = 0.025 + r() * 0.05;
      fmNote(a, sr, { at, dur: d, f: (u) => f0 + (f1 - f0) * u, amp: 0.4 + r() * 0.6, a: 0.15, r: 0.35, ratio: 0.15 + r() * 0.2, index: r() * 1.4 });
      at += d + 0.015 + r() * 0.07;
    }
    verb(a, sr, 0.7, 0.15, 7000);
    return norm(a, 0.85);
  },
  birdAlarm(sr, r) {
    const a = buf1(sr, 1.6);
    let at = 0.01;
    const n = 6 + Math.floor(r() * 7);
    for (let i = 0; i < n; i++) {
      const f0 = 5000 + r() * 1800;
      fmNote(a, sr, { at, dur: 0.018, f: (u) => f0 * (1 - 0.3 * u), amp: 0.7 + r() * 0.3, a: 0.05, r: 0.4 });
      at += 0.07 + r() * 0.09;
    }
    // wings away
    noiseBurst(a, sr, { at: 0.05, dur: 0.5, amp: 0.25, f: 900, q: 0.7, am: null, a: 0.1, r: 0.6, rnd: r });
    return norm(a, 0.85);
  },
  // Crows and ravens: a harsh nasal caw (a buzzy tone through two formants, falling a little), two to four of them; a
  // raven's lower, hollow croak.
  crow(sr, r) {
    const n = 2 + Math.floor(r() * 3), a = buf1(sr, n * 0.55 + 0.8), f0 = 520 + r() * 160;
    let at = 0.02;
    for (let i = 0; i < n; i++) {
      const d = 0.28 + r() * 0.14;
      fmNote(a, sr, { at, dur: d, f: (u) => f0 * (1.05 - 0.15 * u) * (1 + 0.03 * Math.sin(u * 40)), amp: 0.8, a: 0.08, r: 0.35, ratio: 1, index: 2.6, h2: 0.3 });
      noiseBurst(a, sr, { at, dur: d, amp: 0.15, f: 1500, q: 0.8, a: 0.1, r: 0.4, rnd: r });
      at += d + 0.12 + r() * 0.2;
    }
    const f = formants(a, sr, [[1300, 2, 1], [2300, 3, 0.6], [600, 1.5, 0.4]]);
    verb(f, sr, 1.2, 0.22, 4000);
    return norm(f, 0.85);
  },
  raven(sr, r) {
    const n = 1 + Math.floor(r() * 2), a = buf1(sr, n * 0.7 + 1), f0 = 320 + r() * 120;
    let at = 0.02;
    for (let i = 0; i < n; i++) {
      const d = 0.3 + r() * 0.15;
      fmNote(a, sr, { at, dur: d, f: (u) => f0 * (1 + 0.12 * Math.sin(Math.PI * u)), amp: 0.8, a: 0.1, r: 0.3, ratio: 1, index: 3, h2: 0.4 });
      at += d + 0.25 + r() * 0.25;
    }
    if (r() < 0.5) modes(a, sr, { at, amp: 0.3, modes: [[900, 0.02, 1], [1500, 0.012, 0.5]], tick: 0.2, rnd: r }); // the "tok"
    const f = formants(a, sr, [[900, 2.5, 1], [1700, 3, 0.5]]);
    verb(f, sr, 1.5, 0.25, 3500);
    return norm(f, 0.85);
  },
  // Owls: a great horned owl's "hoo, h'hoo — hoo, hoo" (soft low tones with a breath), a screech owl's descending
  // whinny (a trembling whistle).
  owlHoot(sr, r) {
    const a = buf1(sr, 3.6), f0 = 290 + r() * 90;
    const pat = pick(r, [[[0, 0.28], [0.42, 0.11], [0.56, 0.42], [1.3, 0.3], [1.75, 0.32]], [[0, 0.4], [0.6, 0.35], [1.2, 0.5]], [[0, 0.22], [0.3, 0.22], [0.75, 0.45], [1.45, 0.3]]]);
    for (const [at, d] of pat) {
      fmNote(a, sr, { at: at + 0.02, dur: d, f: (u) => f0 * (1.02 - 0.06 * u), amp: 0.8, a: 0.3, r: 0.4, h2: 0.12 });
      noiseBurst(a, sr, { at: at + 0.02, dur: d, amp: 0.05, f: 500, q: 0.8, a: 0.3, r: 0.4, rnd: r });
    }
    verb(a, sr, 1.8, 0.3, 1800);
    return norm(a, 0.85);
  },
  owlScreech(sr, r) {
    const a = buf1(sr, 2.6), f0 = 850 + r() * 200, d = 1.1 + r() * 0.5;
    fmNote(a, sr, { at: 0.02, dur: d, f: (u) => f0 * (1 - 0.32 * u), amp: 0.8, a: 0.1, r: 0.25, h2: 0.08, am: [11 + r() * 5, 0.85] });
    verb(a, sr, 1.5, 0.3, 3000);
    return norm(a, 0.85);
  },
  // Geese: a skein passing, each bird's "ah-honk" (a nasal tone breaking upward) scattered over a few seconds, the
  // whole swelling as they pass over (stereo; the player pans it across); ducks: a mallard's falling "quack quack quack".
  geese(sr, r) {
    const len = 5 + r() * 2, a = buf2(sr, len + 0.6), birds = 4 + Math.floor(r() * 4);
    for (let b = 0; b < birds; b++) {
      const f0 = 300 + r() * 160, lane = (r() - 0.5) * 0.8;
      let at = r() * 0.8;
      while (at < len - 0.3) {
        const u = at / len, swell = 0.25 + 0.75 * Math.exp(-(((u - 0.5) / 0.28) ** 2)), d = 0.17 + r() * 0.12;
        fmNote(a, sr, { at, dur: d, f: (x) => f0 * (x < 0.35 ? 1 : 1.32) * (1 - 0.08 * x), amp: swell * (0.5 + r() * 0.5), a: 0.1, r: 0.35, ratio: 1, index: 3.2, h2: 0.2, pan: clamp(lane + (u - 0.5) * 0.9, -1, 1) });
        at += d + 0.25 + r() * 0.9;
      }
    }
    const L = formants(a[0], sr, [[1000, 2, 1], [2500, 3, 0.5]]), R = formants(a[1], sr, [[1000, 2, 1], [2500, 3, 0.5]]);
    verb(L, sr, 1.4, 0.2, 3500); verb(R, sr, 1.4, 0.2, 3500);
    return norm([L, R], 0.85);
  },
  ducks(sr, r) {
    const n = 3 + Math.floor(r() * 4), a = buf1(sr, n * 0.3 + 0.8), f0 = 270 + r() * 70;
    let at = 0.02;
    for (let i = 0; i < n; i++) {
      const d = 0.16 + r() * 0.06, k = 1 - i * 0.04;
      fmNote(a, sr, { at, dur: d, f: (u) => f0 * k * (1.06 - 0.12 * u), amp: (1 - i * 0.12), a: 0.06, r: 0.4, ratio: 1, index: 4, h2: 0.3 });
      noiseBurst(a, sr, { at, dur: d, amp: 0.12, f: 1400, q: 1, a: 0.06, r: 0.4, rnd: r });
      at += d + 0.06 + r() * 0.06;
    }
    const f = formants(a, sr, [[950, 2.5, 1], [1800, 3, 0.6]]);
    verb(f, sr, 0.9, 0.15, 4000);
    return norm(f, 0.85);
  },
  // A woodpecker drumming: a roll of wooden knocks, quick then slowing a touch, rising then dying away, in the trees.
  woodpecker(sr, r) {
    const n = 14 + Math.floor(r() * 12), a = buf1(sr, n * 0.06 + 1.4), f0 = 850 + r() * 500;
    let at = 0.02, gap = 0.04 + r() * 0.012;
    for (let i = 0; i < n; i++) {
      const u = i / n, amp = Math.min(1, u * 4) * (1 - 0.6 * u);
      modes(a, sr, { at, amp: amp * (0.8 + r() * 0.2), modes: [[f0, 0.01, 1], [f0 * 1.9, 0.006, 0.5], [f0 * 3.4, 0.004, 0.3]], tick: 0.5, tickF: 2500, rnd: r });
      at += gap; gap *= 1.012;
    }
    verb(a, sr, 1.4, 0.3, 4000);
    return norm(a, 0.85);
  },
  // A bullfrog's "jug-o-rum": a deep pulsing drone through a low formant, two to four times.
  bullfrog(sr, r) {
    const n = 2 + Math.floor(r() * 3), a = buf1(sr, n * 0.9 + 0.6), f0 = 120 + r() * 40;
    let at = 0.02;
    for (let i = 0; i < n; i++) {
      const d = 0.45 + r() * 0.25;
      fmNote(a, sr, { at, dur: d, f: (u) => f0 * (1 - 0.08 * u), amp: 0.9, a: 0.1, r: 0.3, ratio: 1, index: 2.2, h2: 0.4, am: [28 + r() * 10, 0.75] });
      at += d + 0.3 + r() * 0.2;
    }
    const f = formants(a, sr, [[230, 2, 1], [480, 2.5, 0.6], [900, 3, 0.2]]);
    verb(f, sr, 1.1, 0.2, 1500);
    return norm(f, 0.85);
  },
  // Flies: a buzz that wanders in pitch and swells as one passes (stereo, moving across).
  flies(sr, r) {
    const len = 2.5 + r() * 1.5, a = buf2(sr, len);
    const n = 1 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) {
      const f0 = 185 + r() * 50, p0 = (r() - 0.5) * 1.6, p1 = -p0 * (0.5 + r() * 0.5), ph = r() * 9;
      const at = r() * 0.4, d = len - at - 0.1, segs = 8;
      for (let s = 0; s < segs; s++) { // pan moves in steps (one fmNote per step, overlapping)
        const u0 = s / segs;
        fmNote(a, sr, { at: at + u0 * d, dur: d / segs * 1.3, f: (u) => f0 * (1 + 0.08 * Math.sin(ph + (u0 + u / segs) * 17) + 0.04 * Math.sin((u0 + u / segs) * 61)), amp: (0.3 + 0.7 * Math.sin(Math.PI * (u0 + 0.5 / segs))) * 0.8, a: 0.25, r: 0.25, ratio: 1, index: 1.8, h2: 0.3, h3: 0.15, pan: p0 + (p1 - p0) * u0, am: [0, 0] });
      }
    }
    return norm(a, 0.8);
  },
  // Dogs gone feral, far off: a bark (a short burst through two formants, a little noise) two to five times with an
  // echo off the ruins; a long howl wobbling.
  dogBark(sr, r) {
    const n = 2 + Math.floor(r() * 4), a = buf1(sr, n * 0.5 + 1.3), f0 = 420 + r() * 250;
    let at = 0.02;
    for (let i = 0; i < n; i++) {
      const d = 0.1 + r() * 0.08;
      fmNote(a, sr, { at, dur: d, f: (u) => f0 * (1.1 - 0.35 * u), amp: 1, a: 0.05, r: 0.5, ratio: 1, index: 3, h2: 0.3 });
      noiseBurst(a, sr, { at, dur: d, amp: 0.3, f: 1200, q: 0.8, a: 0.05, r: 0.5, rnd: r });
      at += d + 0.18 + r() * 0.35;
    }
    const f = formants(a, sr, [[800, 2, 1], [1700, 2.5, 0.6], [400, 1.5, 0.4]]);
    echoes(f, sr, [[0.18 + r() * 0.15, 0.35], [0.45 + r() * 0.2, 0.18]]);
    verb(f, sr, 1.6, 0.35, 2500);
    return norm(f, 0.85);
  },
  dogHowl(sr, r) {
    const d = 1.6 + r() * 1.2, a = buf1(sr, d + 1.6), f0 = 480 + r() * 160;
    fmNote(a, sr, { at: 0.02, dur: d, f: (u) => f0 * (u < 0.2 ? 0.85 + 0.75 * u : 1 + 0.08 * Math.sin(u * 3) - 0.2 * Math.max(0, u - 0.7)), amp: 0.9, a: 0.15, r: 0.3, h2: 0.25, h3: 0.1, vib: [5.5, 0.015] });
    const f = formants(a, sr, [[900, 1.5, 1], [1800, 2, 0.4]]);
    verb(f, sr, 2, 0.4, 2200);
    return norm(f, 0.85);
  },
  // A wolf's howl (a slow rise, a long hold, a fall; sometimes a second wolf joins a few tones apart); coyotes: yips
  // and short tremolo howls tumbling over each other.
  wolfHowl(sr, r) {
    const a = buf1(sr, 7), wolves = r() < 0.5 ? 2 : 1;
    for (let w = 0; w < wolves; w++) {
      const f0 = (330 + r() * 80) * (w ? 1.25 + r() * 0.15 : 1), d = 3 + r() * 1.5, at = 0.05 + w * (0.8 + r());
      fmNote(a, sr, { at, dur: d, f: (u) => f0 * (u < 0.25 ? 0.82 + 0.72 * u : u < 0.75 ? 1 + 0.03 * Math.sin(u * 9) : 1 - 0.55 * (u - 0.75)), amp: w ? 0.6 : 0.9, a: 0.18, r: 0.3, h2: 0.18, h3: 0.06, vib: [4.5, 0.01] });
    }
    verb(a, sr, 2.6, 0.45, 2000);
    return norm(a, 0.85);
  },
  coyote(sr, r) {
    const a = buf2(sr, 4.5), n = 2 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) {
      const pan = (r() - 0.5) * 1.2, f0 = 650 + r() * 250;
      let at = r() * 0.6;
      const end = 2.4 + r();
      while (at < end) {
        if (r() < 0.7) { const d = 0.07 + r() * 0.06; fmNote(a, sr, { at, dur: d, f: (u) => f0 * (1 + 0.8 * Math.sin(Math.PI * u)), amp: 0.7, a: 0.1, r: 0.4, h2: 0.2, pan }); at += d + 0.04 + r() * 0.1; }
        else { const d = 0.5 + r() * 0.5; fmNote(a, sr, { at, dur: d, f: (u) => f0 * 1.4 * (1 - 0.3 * u), amp: 0.6, a: 0.1, r: 0.3, h2: 0.2, am: [9 + r() * 4, 0.6], pan }); at += d + 0.1; }
      }
    }
    verb(a[0], sr, 2, 0.4, 2500); verb(a[1], sr, 2, 0.4, 2500);
    return norm(a, 0.85);
  },
  // An elk bugling in the autumn rut: a low grunt rising fast into a high, warbling whistle, a slide back down, and
  // the grunting chuckles after; across a valley (a long echo).
  elkBugle(sr, r) {
    const a = buf1(sr, 6), hi = 1300 + r() * 500, hold = 0.8 + r() * 0.6;
    fmNote(a, sr, { at: 0.02, dur: 0.3, f: (u) => 190 * (1 + 0.3 * u), amp: 0.5, a: 0.1, r: 0.2, ratio: 1, index: 2.5, h2: 0.3 });
    const d = 0.35 + hold + 0.5;
    fmNote(a, sr, { at: 0.25, dur: d, f: (u) => { const x = u * d; return x < 0.35 ? 260 * Math.pow(hi / 260, x / 0.35) : x < 0.35 + hold ? hi * (1 + 0.02 * Math.sin(x * 40)) : hi * Math.pow(0.45, (x - 0.35 - hold) / 0.5); }, amp: 0.9, a: 0.05, r: 0.15, h2: 0.15, ratio: 0.5, index: 0.6 });
    let at = 0.25 + d + 0.15;
    for (let i = 0; i < 2 + Math.floor(r() * 3); i++) { fmNote(a, sr, { at, dur: 0.12, f: () => 140 + r() * 30, amp: 0.45, a: 0.1, r: 0.4, ratio: 1, index: 2.5, h2: 0.4 }); at += 0.22 + r() * 0.1; }
    echoes(a, sr, [[0.55 + r() * 0.3, 0.3]]);
    verb(a, sr, 2.4, 0.4, 3000);
    return norm(a, 0.85);
  },
  // Something small in the brush: a few crackling steps in dry leaves.
  rustle(sr, r) {
    const a = buf1(sr, 2.2);
    let at = 0.02;
    const steps = 3 + Math.floor(r() * 6);
    for (let s = 0; s < steps; s++) {
      noiseBurst(a, sr, { at, dur: 0.07 + r() * 0.06, amp: 0.4, f: 2800 + r() * 2000, q: 0.7, a: 0.1, r: 0.6, rnd: r });
      for (let k = 0; k < 6; k++) noiseBurst(a, sr, { at: at + r() * 0.1, dur: 0.006, amp: 0.3 + r() * 0.5, f: 3000 + r() * 3500, q: 1.2, tau: 0.0015, rnd: r });
      at += 0.12 + r() * 0.25;
    }
    return norm(a, 0.8);
  },
};

// ---------- the beds (loops, 6 s, every caller's period a whole fraction of it so they loop clean) ----------
const LOOP = 6;
function callers(n, r, lo, hi) { const out = []; for (let i = 0; i < n; i++) out.push({ reps: lo + Math.floor(r() * (hi - lo + 1)), off: r() * LOOP, amp: 0.25 + Math.pow(r(), 0.7) * 0.75, pan: (r() - 0.5) * 1.8 }); return out; }
// Crickets: several callers, each a little detuned, chirping three or four pulses at its own pace; two distant trillers.
function cricketLoop(sr, r) {
  const a = buf2(sr, LOOP);
  for (const c of callers(8, r, 6, 12)) {
    const f = 4100 + r() * 800, pulses = 3 + Math.floor(r() * 2), per = LOOP / c.reps;
    for (let k = 0; k < c.reps; k++) for (let p = 0; p < pulses; p++) fmNote(a, sr, { at: c.off + k * per + p * 0.042, dur: 0.022, f: () => f, amp: c.amp, a: 0.2, r: 0.4, pan: c.pan, wrap: true });
  }
  for (let i = 0; i < 2; i++) fmNote(a, sr, { at: 0, dur: LOOP, f: () => 3300 + r() * 300, amp: 0.12, a: 0.001, r: 0.001, am: [Math.round(40 * LOOP) / LOOP, 0.9], pan: (r() - 0.5) * 1.4, wrap: true });
  return norm(a, 0.85);
}
// Frogs: spring peepers (a short rising peep, many of them), a tree frog's pulsed trill, a green frog's "gunk".
function frogLoop(sr, r) {
  const a = buf2(sr, LOOP);
  for (const c of callers(9, r, 8, 22)) {
    const f = 2700 + r() * 500, per = LOOP / c.reps;
    for (let k = 0; k < c.reps; k++) fmNote(a, sr, { at: c.off + k * per, dur: 0.09 + r() * 0.04, f: (u) => f * (0.94 + 0.1 * u), amp: c.amp, a: 0.25, r: 0.3, pan: c.pan, wrap: true });
  }
  for (const c of callers(2, r, 2, 3)) {
    const f = 1100 + r() * 250, per = LOOP / c.reps;
    for (let k = 0; k < c.reps; k++) fmNote(a, sr, { at: c.off + k * per, dur: 0.6 + r() * 0.4, f: () => f, amp: c.amp * 0.7, a: 0.1, r: 0.2, am: [17 + r() * 4, 0.95], h2: 0.2, pan: c.pan, wrap: true });
  }
  for (const c of callers(2, r, 1, 2)) {
    const per = LOOP / c.reps;
    for (let k = 0; k < c.reps; k++) fmNote(a, sr, { at: c.off + k * per, dur: 0.08, f: (u) => 330 * (1 - 0.1 * u), amp: c.amp * 0.6, a: 0.05, r: 0.6, ratio: 1, index: 1.5, pan: c.pan, wrap: true });
  }
  return norm(a, 0.85);
}
// Cicadas: buzzing swells (noise in a high band, chopped fast by the tymbals), each rising and falling at its pace,
// over a distant chorus.
function cicadaLoop(sr, r) {
  const a = buf2(sr, LOOP), n = a[0].length;
  const bed = buf1(sr, LOOP);
  noiseBurst(bed, sr, { at: 0, dur: LOOP, amp: 0.25, f: 5200, q: 2, a: 0.001, r: 0.001, rnd: r });
  for (let i = 0; i < n; i++) { const x = bed[i] * (0.8 + 0.2 * Math.sin(2 * Math.PI * i / n)); a[0][i] += x; a[1][i] += x; }
  for (const c of callers(3, r, 1, 2)) {
    const f = 4300 + r() * 1700, per = LOOP / c.reps, tym = 120 + r() * 130, one = buf1(sr, per);
    noiseBurst(one, sr, { at: 0, dur: per, amp: 1, f, q: 3, a: 0.4, r: 0.3, rnd: r });
    for (let i = 0; i < one.length; i++) one[i] *= Math.pow(Math.abs(Math.sin(Math.PI * tym * i / sr)), 3);
    const gl = Math.cos((c.pan + 1) * Math.PI / 4), gr = Math.sin((c.pan + 1) * Math.PI / 4);
    for (let k = 0; k < c.reps; k++) for (let i = 0; i < one.length; i++) { const j = (Math.round((c.off + k * per) * sr) + i) % n; a[0][j] += one[i] * c.amp * gl; a[1][j] += one[i] * c.amp * gr; }
  }
  filterIn(a[0], "highpass", 2500, 0.7, sr); filterIn(a[1], "highpass", 2500, 0.7, sr);
  return norm(a, 0.85);
}
export { BEDS as WILD_BEDS };
