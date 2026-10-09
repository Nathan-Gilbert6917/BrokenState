// The music previews (tools/musicpreview/main.cjs loads this page in a hidden Electron window): each music state,
// the battle's arc, a death over calm music, the game's ends, and a day turning into night into a horde attack.
// Each render plays the music engine (ui/music.js createEngine) on the game's chain at the default sliders: the music
// bus (its compressor, the Music volume at 50%) into the master (70%) and the master compressor; the battle with
// gunfire also plays the guns and blasts through the effects bus, the limiter and the battle bus, the music ducking
// under the blasts. The scheduler is driven on a virtual clock in 50 ms steps before the context renders.
import { createEngine, makeMusicBus, musicGains } from "../../src/ui/music.js";
import { SOUND_DEFAULTS } from "../../src/ui/audio.js";
import { GAME_LEVELS, makeLimiter, makeMasterComp } from "../../src/ui/sfxlab.js";
import { installBus, labPlan, place, playGun } from "../../src/ui/gunsfx.js";
import { playBlast } from "../../src/ui/blastsfx.js";
import { stats } from "../../src/ui/sfxdsp.js";

const PRE = 1.5; // s of silence first: the compressors settle (cut off the result)
const S = (key, season = "spring") => ({ key, season });
// script: [[t, action]]: a state ({ key, season }), a sting, a man down, a duck. sections: [[t0, t1, label]] measured.
export const RENDERS = {
  title: { secs: 55, script: [[0, S("title")]], sections: [[5, 55, "title"]] },
  map_day: { secs: 55, script: [[0, S("day")]], sections: [[3, 55, "day (spring)"]] },
  map_night: { secs: 55, script: [[0, S("night")]], sections: [[3, 55, "night (spring)"]] },
  winter: { secs: 55, script: [[0, S("day", "winter")], [30, S("night", "winter")]], sections: [[3, 30, "winter day"], [33, 55, "winter night"]] },
  summer: { secs: 45, script: [[0, S("day", "summer")]], sections: [[3, 45, "summer day"]] },
  festival: { secs: 50, script: [[0, S("festival", "autumn")]], sections: [[3, 50, "festival"]] },
  tension: { secs: 50, script: [[0, S("tension")]], sections: [[3, 50, "tension"]] },
  crisis: { secs: 50, script: [[0, S("crisis")]], sections: [[3, 50, "crisis / siege"]] },
  // no contact -> enemies seen -> firefight -> man down -> winning -> victory sting, back to calm
  battle: { secs: 60, script: [[0, S("battleQuiet")], [10, S("battleSeen")], [20, S("battleFight")], [32, { down: true }], [41, S("battleWin")], [52, { ...S("day"), sting: "victory" }]],
    sections: [[1, 10, "no contact"], [11, 20, "enemies seen"], [21, 32, "firefight"], [32, 40, "man down"], [42, 52, "winning"], [52, 60, "victory sting"]] },
  battle_lost: { secs: 30, script: [[0, S("battleFight")], [8, S("battleLose")], [20, { ...S("night"), sting: "defeat" }]], sections: [[9, 20, "losing"], [20, 30, "defeat sting"]] },
  death: { secs: 40, script: [[0, S("day")], [12, { sting: "death", hush: true }]], sections: [[2, 12, "calm before"], [12, 20, "elegy"], [20, 40, "the quiet after"]] },
  base_lost: { secs: 30, script: [[0, S("tension")], [8, { ...S("night"), sting: "baseLost", hush: true }]], sections: [[8, 18, "base lost"]] },
  gameover: { secs: 60, script: [[0, S("gameover")]], sections: [[2, 60, "game over"]] },
  victory: { secs: 60, script: [[0, S("triumph")]], sections: [[2, 60, "victory theme"]] },
  // A day turning into night, a horde coming, the base under siege, the fight at the walls.
  day_night_horde: { secs: 90, script: [[0, S("day", "autumn")], [24, S("night", "autumn")], [48, S("tension", "autumn")], [62, S("crisis", "autumn")], [72, S("battleSeen", "autumn")], [78, S("battleFight", "autumn")]],
    sections: [[2, 24, "day"], [26, 48, "night"], [50, 62, "horde near"], [63, 72, "siege"], [73, 78, "fight seen"], [79, 90, "firefight"]] },
  // The firefight with the guns and grenades over it: is the music under the effects?
  battle_fx: { secs: 30, fx: true, script: [[0, S("battleFight")]], sections: [[3, 30, "firefight + gunfire"]] },
};
// The guns and blasts of battle_fx: [t, gun, mode, distance, pan] and the blasts [t, kind, distance].
const SHOTS = [];
for (let k = 0; k < 6; k++) for (const [at, g, m, d, p] of [[0, "ar", "burst", 3, -0.3], [0.6, "ak", "auto", 14, 0.5], [1.5, "pistol", "single", 2, -0.5], [2.2, "huntrifle", "single", 22, 0.7], [3.1, "shotgun", "single", 8, 0.3], [3.9, "smg", "auto", 11, 0.6]]) SHOTS.push([3 + k * 4.4 + at, g, m, d, p]);
const BLASTS = [[8.5, "frag", 6], [17.2, "pipebomb", 9], [24.4, "frag", 4]];

async function renderOnce(R, withMusic, withFx, raw = false) {
  const sr = 48000, c = new OfflineAudioContext(2, Math.ceil(sr * (R.secs + PRE)), sr);
  const master = c.createGain(); master.gain.value = GAME_LEVELS.master;
  const comp = makeMasterComp(c); master.connect(comp); comp.connect(c.destination);
  const sfx = c.createGain(); sfx.gain.value = GAME_LEVELS.sfx;
  const lim = makeLimiter(c); sfx.connect(lim); lim.connect(master);
  installBus(c, sfx);
  const bus = makeMusicBus(c, master);
  musicGains(bus, { ...SOUND_DEFAULTS }, 0, true, true);
  let E = null;
  if (withMusic) {
    E = createEngine(c, raw ? c.destination : bus.in, { seed: 1234 }); // raw: the engine straight out (its own mix level, no bus)
    const script = R.script.map(([t, a]) => [t + PRE, a]);
    if (withFx) for (const [t] of BLASTS) script.push([t + PRE, { duck: 6 }]);
    script.sort((a, b) => a[0] - b[0]);
    let i = 0;
    for (let vt = 0; vt < R.secs + PRE; vt += 0.05) {
      while (i < script.length && script[i][0] <= vt) {
        const a = script[i++][1];
        if (a.key) E.apply({ key: a.key, season: a.season, down: !!a.down, hush: !!a.hush, stings: [] }, vt);
        if (a.down && !a.key) E.apply({ key: E.target ? E.target.key : "battleFight", season: E.target ? E.target.season : "spring", down: true, stings: [] }, vt);
        if (a.hush) E.hushBars = 10;
        if (a.sting) E.sting(a.sting, vt + 0.05);
        if (a.duck) E.duck(a.duck, vt);
      }
      E.tick(vt);
    }
  }
  if (withFx) {
    for (const [t, g, m, d, p] of SHOTS) playGun(c, PRE + t, labPlan(g, m), place({ dist: d, pan: p, room: "town", seen: d < 20 }));
    for (const [t, k, d] of BLASTS) playBlast(c, PRE + t, { kind: k }, place({ dist: d, pan: 0.2, room: "town" }));
  }
  const buf = await c.startRendering();
  const cut = Math.round(PRE * sr);
  return { L: buf.getChannelData(0).slice(cut), R: buf.getChannelData(1).slice(cut), sr, E };
}
const b64 = (i16) => { const u8 = new Uint8Array(i16.buffer); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const mono = (o) => { const n = o.L.length, m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = (o.L[i] + o.R[i]) / 2; return m; };
const peakOf = (o) => { const n = o.L.length, m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = Math.abs(o.L[i]) > Math.abs(o.R[i]) ? o.L[i] : o.R[i]; return m; };
function section(o, t0, t1) {
  const a = Math.round(t0 * o.sr), b = Math.min(o.L.length, Math.round(t1 * o.sr));
  let sum = 0, pk = 0;
  for (let i = a; i < b; i++) { const l = o.L[i], r = o.R[i]; sum += (l * l + r * r) / 2; pk = Math.max(pk, Math.abs(l), Math.abs(r)); }
  const db = (x) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -Infinity);
  return { rmsDb: db(Math.sqrt(sum / Math.max(1, b - a))), peakDb: db(pk) };
}
// The loudest win-s stretch's RMS (dB): a burst of gunfire against the music's loudest moment.
function loudest(o, win) {
  const n = Math.round(win * o.sr), L = o.L, R = o.R;
  let acc = 0, best = 0;
  for (let i = 0; i < L.length; i++) { acc += (L[i] * L[i] + R[i] * R[i]) / 2; if (i >= n) acc -= (L[i - n] * L[i - n] + R[i - n] * R[i - n]) / 2; if (acc > best) best = acc; }
  return Math.round(20 * Math.log10(Math.sqrt(best / n) || 1e-9) * 10) / 10;
}
export async function render(name, o = {}) {
  const R = RENDERS[name];
  const out = await renderOnce(R, true, !!R.fx && !o.raw, !!o.raw);
  const fxOnly = R.fx && !o.raw ? await renderOnce(R, false, true) : null;
  const n = out.L.length, i16 = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    i16[2 * i] = Math.max(-32768, Math.min(32767, Math.round(out.L[i] * 32767)));
    i16[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(out.R[i] * 32767)));
  }
  const st = stats(peakOf(out), out.sr);
  const whole = section(out, 0, R.secs);
  const E = out.E, es = E.stats, bs = E.bank.stats;
  return {
    name, sr: out.sr, data: b64(i16),
    stats: {
      secs: R.secs, peakDb: st.peakDb, rmsDb: whole.rmsDb, rms50Db: st.rms50Db, clip: st.clip, nan: st.nan, centroid: stats(mono(out), out.sr).centroid,
      sections: (R.sections || []).map(([t0, t1, label]) => ({ label, ...section(out, t0, t1), fx: fxOnly ? section(fxOnly, t0, t1).rmsDb : undefined })),
      fxOnly: fxOnly ? (() => { const f = stats(peakOf(fxOnly), fxOnly.sr); return { peakDb: f.peakDb, rms50Db: f.rms50Db, loud: loudest(fxOnly, 0.4) }; })() : undefined,
      musicLoud: loudest(out, 0.4),
      engine: { peakNodes: es.peakNodes, peakVoices: es.peakVoices, notes: es.notes, dropped: es.dropped, droppedBy: es.droppedBy, stolen: es.stolen, stolenBy: es.stolenBy, late: es.late, bars: es.bars, changes: es.changes.map((c) => `${c.from}->${c.to}@${(c.t - PRE).toFixed(2)}`),
        tickAvgMs: es.ticks ? Math.round((es.tickMs / es.ticks) * 1000) / 1000 : 0, tickMaxMs: Math.round(es.maxTickMs * 100) / 100, baked: bs.baked, bakeMs: Math.round(bs.ms), bakeMB: Math.round(bs.bytes / 1e5) / 10 },
    },
  };
}
window.MUS = { render, names: Object.keys(RENDERS), ready: true };
