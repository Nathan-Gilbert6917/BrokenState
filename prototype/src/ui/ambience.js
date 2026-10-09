// The ambience (weather and wildlife) for ui/audio.js, in one place: ui/ambscene.js decides what is heard where you
// listen, ui/ambweather.js and ui/ambwild.js play it on two buses of their own (ui/ambkit.js) into the ambience bus.
//
//   ambTarget(state, ui, mem, now, o)  the plan for now (o: { tile, zoom, hourFrac }); mem: the caller's, kept
//   ambBeds(c, dest)                   the engine on context c into dest ({ weather, wildlife }: the mixer's group buses,
//                                      or one node): made once
//   ambPlay(E, plan, t)                one frame (ui/audio.js: four a second)
//   AMB_SOUNDS                         { weather: [names], wildlife: [names] }: every sound, for a mixer's groups
//   AMB_LABELS, ambGroupOf(name)       their labels; the group of one
//   ambBus(c)                          { weather, wildlife }: each group's gain node (a mixer sets .gain)
//   ambLightning(near)                 a flash drawn somewhere (the title's storm): thunder follows
//   onLightning(fn)                    a strike was played: fn({ at, near, km }) (for a flash on the map)
//   ambPreview(E, group, t)            the mixer's ▶: thunder (weather), a songbird and a crow (wildlife)
//   ambStats(c)                        nodes held by the beds, one-shots ringing, buffers baked and their time
import { ambienceScene, ambiencePlan } from "./ambscene.js";
import { ambEngine, engineOf, bedNodes, busy } from "./ambkit.js";
import { WEATHER_SOUNDS, weatherFrame, weatherCall, ambLightning, onLightning, flashAge } from "./ambweather.js";
import { WILDLIFE_SOUNDS, wildFrame, wildCall } from "./ambwild.js";
import { makeScene } from "./ambscene.js";
import { assignGroup } from "./soundgroups.js";

export { ambLightning, onLightning, WEATHER_SOUNDS, WILDLIFE_SOUNDS };
export const AMB_SOUNDS = { weather: Object.keys(WEATHER_SOUNDS), wildlife: Object.keys(WILDLIFE_SOUNDS) };
export const AMB_LABELS = Object.fromEntries([...Object.entries(WEATHER_SOUNDS), ...Object.entries(WILDLIFE_SOUNDS)].map(([k, v]) => [k, v.label]));
// The mixer (ui/soundgroups.js): World → Weather and World → Wildlife. Every sound plays through its group's bus
// (ui/audio.js hands ambBeds the two group buses), so a slider moves the beds and the one-shots alike, at once.
assignGroup(AMB_SOUNDS.weather, "world.weather");
assignGroup(AMB_SOUNDS.wildlife, "world.wildlife");
export const ambGroupOf = (name) => (WEATHER_SOUNDS[name] ? "weather" : WILDLIFE_SOUNDS[name] ? "wildlife" : null);

export function ambTarget(state, ui, mem, now, o = {}) {
  const fa = flashAge(); // the title's storm: rain while its lightning keeps coming (gone 30 s after the last flash)
  const scene = ambienceScene(state, ui, mem, now, { ...o, titleStorm: fa < 30 ? Math.min(1, (30 - fa) / 10) : 0 });
  const plan = ambiencePlan(scene);
  plan.scene = scene;
  return plan;
}
export const ambBeds = (c, dest) => ambEngine(c, dest);
export function ambPlay(E, plan, t) {
  if (!E || !plan) return;
  weatherFrame(E, plan, t);
  wildFrame(E, plan, t);
}
// The mixer's ▶ for World → Weather and World → Wildlife (and the sound a slider makes as it is let go): rolling
// thunder, or a songbird and a crow, through the group's bus at its level. Baked at once if need be.
export function ambPreview(E, group, t) {
  if (!E) return 0;
  const keep = E.sync;
  E.sync = true;
  try {
    const P = ambiencePlan(makeScene({ hour: 7, season: "spring", wx: { key: "clear", temp: 12 }, ter: { forest: 0.6, field: 0.4 } }));
    if (group === "weather") return weatherCall(E, "thunderFar", t + 0.02) ? 1 : 0;
    wildCall(E, P, "songRobin", t + 0.05);
    wildCall(E, P, "crow", t + 1.4);
    return 1;
  } finally { E.sync = keep; }
}
export function ambBus(c) { const E = engineOf(c); return E ? { weather: E.bus.weather.in, wildlife: E.bus.wildlife.in } : null; }
export function ambStats(c) {
  const E = engineOf(c);
  if (!E) return null;
  const t = c.currentTime;
  return { bedNodes: bedNodes(E), busNodes: 4, beds: Object.keys(E.beds).filter((k) => E.beds[k].live), weatherShots: busy(E, "weather", t), wildShots: busy(E, "wildlife", t), ...E.stats };
}
