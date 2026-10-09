// Where the sounds of ui/sfx-melee.js, ui/sfx-steps.js and ui/sfx-gear.js go: one small output stage between a voice
// and its bus (ui/audio.js sfx calls it for every voice flagged own). place: a placement, ui/gunsfx.js spatial's (or a
// bare { x | pan (-1..1 left to right on the screen), dist (tiles), seen (false: out of sight, muffled) }). In battle it
// is gun-sfx's spatialOut (level by distance, highs cut, pan, the battle bus with its ducking, deafening and room
// reverb); outside it (the interface, the map) a plain pan into bus.
import { spatialOut } from "./gunsfx.js";

export function voiceOut(ctx, place = {}, bus = ctx.destination, battle = false) {
  if (battle) return spatialOut(ctx, place);
  let out = bus;
  const pan = Number(place.pan ?? place.x);
  if (pan && Number.isFinite(pan) && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(out);
    out = p;
  }
  if (place.seen === false) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 650;
    lp.Q.value = 0.7;
    lp.connect(out);
    out = lp;
  }
  return out;
}
// A bare placement from a cue's own numbers (no listener: a headless test, a sound outside battle).
export const placeOf = (o = {}) => ({ x: Number.isFinite(o.pan) ? o.pan : 0, dist: Number.isFinite(o.dist) ? o.dist : 0, seen: o.seen !== false });
// Left to right across a battle map b (cells 0..b.w-1), kept off the far edges.
export const panOfX = (b, x) => (b && b.w > 1 && Number.isFinite(x) ? Math.max(-0.8, Math.min(0.8, ((x + 0.5) / b.w - 0.5) * 1.5)) : 0);
