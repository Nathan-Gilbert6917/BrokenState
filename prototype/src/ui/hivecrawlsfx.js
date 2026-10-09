// The hive crawl's sound (sim/hivecrawl.js): while the crawl window is open, and in a chamber's or the core's battle,
// the hive breathes around the team: a low warm drone (two detuned sines and brown noise under a low-pass) and the
// pulse, a lub-dub heartbeat throb. Both follow the warmth (0 at the coldest chamber, 100 in the core): the drone gets
// louder and brighter (its low-pass opens), the beat louder and faster (HC_SOUND.period: from 1.7 s apart to 0.55 s).
// Synthesized here with the dead's DSP kit (ui/zombiesfx.js DSP), no audio files; in the mixer's Zombies → Hive crawl
// pulse group (ui/soundgroups.js), under the Ambience volume. UI only: no sim dice, nothing at import time.
import { DSP, mulberry } from "./zombiesfx.js";
import { activeHiveCrawl, crawlHive, denOf, roomById, warmthOf } from "../sim/hivecrawl.js";

// Levels at warmth 0 → 100: the drone's gain and low-pass, the beat's peak and period (s), the drone's pitch.
export const HC_SOUND = { drone: [0.05, 0.24], lp: [90, 460], beat: [0.1, 0.45], period: [1.7, 0.55], f: [38, 52], idle: 3 };
export const HC_SOUND_NAMES = ["hiveCrawlDrone", "hiveCrawlBeat"]; // the bed's parts, for the mixer's tables (ui/soundgroups.js)
const lerp = (a, t) => a[0] + (a[1] - a[0]) * Math.max(0, Math.min(1, t));

// What the crawl sounds like now: { warmth } or null (no crawl window, no hive battle). The battle's own warmth is set
// by its layout (b.hiveWarmth: hivecrawl.js "hivechamber", "hivecore").
export function hiveCrawlHeard(state, ui) {
  if (!state || (ui && (ui.timelapse || ui.title || !ui.started))) return null;
  const b = state.combat;
  if (b && !b.over && b.hiveWarmth != null) return { warmth: b.hiveWarmth, battle: true };
  if (b || state.autopilot) return null;
  const p = activeHiveCrawl(state);
  if (!p) return null;
  const c = p.hiveCrawl, hive = crawlHive(state, c);
  if (!hive) return null;
  const den = denOf(state, hive);
  return { warmth: warmthOf(den, roomById(den, c.at)), battle: false };
}

// The layer: made when first heard, let go after HC_SOUND.idle seconds of silence.
export function makeHiveCrawlLayer(c, out, t = c.currentTime) {
  const { osc, gainN, biq, envG, noise, lfo } = DSP;
  const bus = gainN(c, 1, out); // the group's gain
  const droneG = gainN(c, 0, bus);
  const breathe = gainN(c, 0.75, droneG);
  const lp = biq(c, "lowpass", HC_SOUND.lp[0], 0.8, breathe);
  const o1 = osc(c, "sine", HC_SOUND.f[0], t, 1e5, gainN(c, 0.5, lp)), o2 = osc(c, "triangle", HC_SOUND.f[0] * 1.059, t, 1e5, gainN(c, 0.25, lp));
  const rnd = mulberry(0xc0de);
  const nb = noise(c, "brown", t, 1e5, gainN(c, 0.7, lp), rnd);
  lfo(c, 0.13, 0.25, breathe.gain, t, 1e5);
  const sources = [o1, o2, nb];
  return {
    nodes: 14, idleSince: null, nextBeat: t + 0.3, beats: 0, warmth: 0,
    update(lv, now, vol = 1) {
      const on = !!lv;
      const w = on ? lv.warmth / 100 : this.warmth / 100;
      if (on) this.warmth = lv.warmth;
      bus.gain.setTargetAtTime(vol, now, 0.06);
      droneG.gain.setTargetAtTime(on ? lerp(HC_SOUND.drone, w) : 0, now, on ? 0.8 : 0.4);
      lp.frequency.setTargetAtTime(lerp(HC_SOUND.lp, w), now, 1.2);
      o1.frequency.setTargetAtTime(lerp(HC_SOUND.f, w), now, 2);
      o2.frequency.setTargetAtTime(lerp(HC_SOUND.f, w) * 1.059, now, 2);
      if (on && vol > 0) {
        if (this.nextBeat < now) this.nextBeat = now + 0.05;
        while (this.nextBeat < now + 0.6) {
          const bt = this.nextBeat, pk = lerp(HC_SOUND.beat, w), f = 46 + 14 * w;
          throb(c, bus, bt, f, pk, rnd);
          throb(c, bus, bt + 0.2 + 0.08 * (1 - w), f * 0.85, pk * 0.65, rnd);
          this.beats++;
          this.nextBeat += lerp(HC_SOUND.period, w);
        }
      }
      this.idleSince = on ? null : this.idleSince ?? now;
    },
    stop(now) { for (const x of sources) { try { x.stop(now + 0.05); } catch { /* already stopped */ } } },
  };
  // One thump: a falling sine and a puff of brown noise, low-passed (the pulse through flesh).
  function throb(ctx, dest, at, f, peak, r) {
    osc(ctx, "sine", f, at, 0.32, envG(ctx, dest, at, peak, 0.014, 0, 0.24)).frequency.exponentialRampToValueAtTime(f * 0.55, at + 0.22);
    noise(ctx, "brown", at, 0.22, biq(ctx, "lowpass", 180, 0.8, envG(ctx, dest, at, peak * 0.5, 0.01, 0, 0.18)), r);
  }
}
const LAYERS = new WeakMap();
const DEMO = { until: 0 };
// ui/audio.js every ambience tick: lv from hiveCrawlHeard (null: silent); vol: the Hive crawl pulse group's gain.
export function hiveCrawlAmbience(c, out, lv, t = c.currentTime, vol = 1) {
  let L = lv;
  if (DEMO.until > t) L = { warmth: 60 + 40 * Math.max(0, Math.min(1, 1 - (DEMO.until - t) / 5)) }; // the mixer's ▶: from warm to the core
  let m = LAYERS.get(c);
  if (!m) {
    if (!L) return null;
    m = makeHiveCrawlLayer(c, out, t);
    LAYERS.set(c, m);
  }
  m.update(L, t, vol);
  if (m.idleSince != null && t - m.idleSince > HC_SOUND.idle) { m.stop(t); LAYERS.delete(c); return null; }
  return m;
}
// The mixer's preview: five seconds walking into the core.
export const demoHiveCrawl = (t, secs = 5) => { DEMO.until = t + secs; };
