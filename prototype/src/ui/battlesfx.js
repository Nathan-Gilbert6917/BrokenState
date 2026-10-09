// The battle's rich sounds: the router between the cues ui/soundcues.js plans (a cue with .gun, .blast or .hand) and
// the voices that play them (ui/gunsfx.js guns and handling, ui/blastsfx.js blasts and grenades), placed for this
// frame's listener. ui/audio.js calls frameListener once a frame and playCue for each such cue (after its throttle).
import { spatial, place, listener, roomOf, playGun, playHand, prewarm, busOf, shotPlan } from "./gunsfx.js";
import { playBlast, prewarmBlasts } from "./blastsfx.js";

// The listener this frame: the selected unit of yours (LISTEN.sel), the battle view (LISTEN.cam) and the fog of war
// (LISTEN.vis), all set by ui/combat.js; the room by where the battle is.
export function frameListener(state, b, LISTEN) {
  const get = (f) => { try { return typeof f === "function" ? f() : null; } catch { return null; } };
  return listener(b, { sel: get(LISTEN.sel), cam: get(LISTEN.cam), vis: get(LISTEN.vis), room: roomOf(state, b) });
}
// How long a cue holds its place in the throttle (s): a burst its span, a blast a while.
export const cueSpan = (c) => (c.gun ? (c.gun.span || 0) + 0.5 : c.blast ? 1.2 : 0.6);
// Play cue c at t (base: the frame's now, for a grenade's pin before its flight). L: frameListener's.
export function playCue(ctx, base, t, c, L) {
  const at = (p, o = {}) => (p && L ? spatial(L, p[0], p[1], o) : place({ room: L ? L.room : "field" }));
  const sp = at(c.at, { enemy: c.enemy, indoor: c.indoor });
  const g = c.gain ?? 1;
  if (c.gun) return playGun(ctx, t, { ...c.gun, gain: g }, sp);
  if (c.blast) {
    const B = c.blast;
    if (B.pre) playHand(ctx, base, { kind: "throw", h: B.pre.h, gain: g * 1.4 }, at(B.pre.at));
    if (B.land != null) playHand(ctx, t - B.land, { kind: "clatter", gain: g * 1.6 }, sp);
    return playBlast(ctx, t, { ...B, gain: g }, sp);
  }
  if (c.hand) return playHand(ctx, t, { ...c.hand, gain: g }, sp);
  return 0;
}

// Bake what a battle will need while nothing is happening yet (a voice is 5–40 ms of work the first time): the
// room's reverb, each gun on the field (suppressed too where fitted), the common blasts. One job an idle moment.
export function prewarmBattle(ctx, state, b) {
  const jobs = [];
  const room = roomOf(state, b), bus = busOf(ctx);
  if (bus) { jobs.push(() => bus.verb(room)); if (room !== "inside") jobs.push(() => bus.verb("inside")); }
  const seen = new Set();
  for (const u of b.units || []) {
    if (u.kind !== "human" || !u.weapon) continue;
    const p = shotPlan({ rounds: 1 }, u);
    if (p.generic) continue; // a club or a blade
    const k = `${p.v}|${p.act}|${p.sup}|${p.sub}`;
    if (seen.has(k)) continue;
    seen.add(k);
    jobs.push(() => prewarm(ctx, [p]));
  }
  for (const k of ["frag", "pipebomb", "molotov", "gl40", "rocket", "flash", "smoke", "secondary", "glass"]) jobs.push(() => prewarmBlasts(ctx, [k]));
  const idle = typeof requestIdleCallback === "function" ? (f) => requestIdleCallback(f, { timeout: 500 }) : (f) => setTimeout(f, 30);
  const next = () => { const j = jobs.shift(); if (!j) return; try { j(); } catch { /* best effort */ } idle(next); };
  idle(next);
  return jobs.length;
}
