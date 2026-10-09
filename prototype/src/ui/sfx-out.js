// Where the sounds of ui/sfx-melee.js, ui/sfx-steps.js and ui/sfx-gear.js go: one small output stage between a voice
// and its bus (ui/audio.js sfx calls it for every voice flagged own). Its shape is gun-sfx's spatialOut(c, placement)
// (ui/gunsfx.js on that branch): a placement { x (pan, -1..1 left to right on the screen), dist (tiles from your
// nearest person), seen (false: out of sight, heard through a wall: a low-pass) } in, the node to play into out. bus:
// where it ends (spatialOut picks its own), so switching to it is one line in audio.js.
export function voiceOut(ctx, place = {}, bus = ctx.destination) {
  let out = bus;
  const pan = Number(place.x);
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
  const dist = Number(place.dist);
  if (dist > 2 && Number.isFinite(dist)) { // further off, a little quieter
    const g = ctx.createGain();
    g.gain.value = Math.max(0.45, 1 - (dist - 2) * 0.035);
    g.connect(out);
    out = g;
  }
  return out;
}
// A placement for a cue: its pan, its distance, whether you see it (the opts a cue carries: pan, dist, seen).
export const placeOf = (o = {}) => ({ x: Number.isFinite(o.pan) ? o.pan : 0, dist: Number.isFinite(o.dist) ? o.dist : 0, seen: o.seen !== false });
// Left to right across a battle map b (cells 0..b.w-1), kept off the far edges.
export const panOfX = (b, x) => (b && b.w > 1 && Number.isFinite(x) ? Math.max(-0.8, Math.min(0.8, ((x + 0.5) / b.w - 0.5) * 1.5)) : 0);
