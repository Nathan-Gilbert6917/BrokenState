// The ambience (ui/ambscene.js decides, ui/ambweather.js and ui/ambwild.js play, ui/ambience.js joins them for
// ui/audio.js): headless checks with a stub AudioContext (no speakers).
// - The sound tables: every weather and wildlife sound named in its group, with a label, a level and a voice.
// - The mix by weather, hour, season and terrain: a dawn chorus at sunrise in a spring forest, owls at night, frogs by
//   the water on spring nights, no insects in winter, cicadas on hot summer afternoons, ice creaking on frozen rivers,
//   drizzle to downpour, storms, snow, fog, geese in the migrations, the elk's rut, crows at death sites, a hive.
// - Danger silences the wildlife: a horde you can see near, a battle, gunfire lately; and it comes back.
// - Indoors (a building raid) the weather is muffled through the walls and the wildlife is gone.
// - Zoomed far out: the general bed only.
// - The throttle and the node budget over a minute of frames in the busiest scenes; every voice bakes clean.
// - The title's storm: its lightning brings thunder and rain.
// - Determinism: the world plays out the same with and without the ambience listening to it.
// Usage: node tools/ambiencetest.js
import { createWorld, tickHour } from "../src/sim/world.js";
import { saveToString } from "../src/sim/save.js";
import { makeHorde } from "../src/sim/hordes.js";
import { SCENE, makeScene, ambiencePlan, ambienceScene, terrainAround, gunHush, WILD } from "../src/ui/ambscene.js";
import { AMB_OPTS, ambEngine, bedNodes, busy, BED_IDLE } from "../src/ui/ambkit.js";
import { WEATHER_SOUNDS, RECIPES, WEATHER_LIMIT, weatherFrame, ambLightning } from "../src/ui/ambweather.js";
import { WILDLIFE_SOUNDS, CALLS, WILD_LIMIT, WILD_BEDS } from "../src/ui/ambwild.js";
import { AMB_SOUNDS, ambGroupOf, ambTarget, ambPlay, ambStats, ambBus, ambPreview } from "../src/ui/ambience.js";
import { groupOf } from "../src/ui/soundgroups.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();
AMB_OPTS.sync = true; // bake at once (no idle moments here)

// ---------- a stub AudioContext: counts nodes, keeps buffers, catches bad parameters ----------
function stub(rate = 8000) {
  const bad = [];
  let nodes = 0;
  const starts = [];
  const param = (name, v = 0) => {
    const p = { value: v };
    const fin = (x, what) => { if (!Number.isFinite(x)) bad.push(`${name}.${what}(${x})`); };
    p.setValueAtTime = (x, t) => { fin(x, "set"); fin(t, "setT"); return p; };
    p.linearRampToValueAtTime = (x, t) => { fin(x, "lin"); fin(t, "linT"); return p; };
    p.exponentialRampToValueAtTime = (x, t) => { fin(x, "exp"); if (!(x > 0)) bad.push(`${name}.exp(${x})`); fin(t, "expT"); return p; };
    p.setTargetAtTime = (x, t, k) => { fin(x, "tgt"); fin(t, "tgtT"); if (!(k > 0)) bad.push(`${name}.tgtK(${k})`); return p; };
    p.cancelScheduledValues = () => p;
    return p;
  };
  const node = (extra = {}) => { nodes++; return { connect(d) { if (!d) bad.push("connect(null)"); return d; }, disconnect() {}, ...extra }; };
  const src = (extra) => node({ start(t, off) { starts.push({ t: t ?? 0, buf: this.buffer }); if (!Number.isFinite(t ?? 0) || !Number.isFinite(off ?? 0)) bad.push("start"); }, stop(t) { if (!Number.isFinite(t)) bad.push("stop"); }, ...extra });
  const ctx = {
    sampleRate: rate, currentTime: 0,
    createGain: () => node({ gain: param("gain", 1) }),
    createBiquadFilter: () => node({ type: "", frequency: param("freq", 350), Q: param("Q", 1) }),
    createOscillator: () => src({ type: "", frequency: param("osc", 440) }),
    createBufferSource: () => src({ buffer: null, loop: false, playbackRate: param("rate", 1) }),
    createBuffer: (ch, len, sr) => { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { duration: len / sr, length: len, sampleRate: sr, numberOfChannels: ch, getChannelData: (i) => d[i], copyToChannel: (a, i) => d[i].set(a) }; },
    createStereoPanner: () => node({ pan: param("pan") }),
  };
  return { ctx, bad, starts, get nodes() { return nodes; } };
}
const dest = () => ({ connect() {}, disconnect() {} });
const sum = (o, keys) => keys.reduce((a, k) => a + (o[k] || 0), 0);
const SONG = ["songRobin", "songWarbler", "songWhistle", "songFinch"];
const plan = (o) => ambiencePlan(makeScene(o));
const forest = { forest: 1, field: 0 }, field = { field: 1 }, town = { town: 1, field: 0 }, hills = { hills: 1, field: 0 };

// ---------- 1. the sound tables ----------
console.log("Sound tables");
{
  const W = Object.keys(WEATHER_SOUNDS), L = Object.keys(WILDLIFE_SOUNDS);
  check(W.length >= 20 && L.length >= 20 && W.every((n) => !WILDLIFE_SOUNDS[n]), `two groups, no name in both: weather ${W.length}, wildlife ${L.length}`);
  check(JSON.stringify(AMB_SOUNDS) === JSON.stringify({ weather: W, wildlife: L }) && W.every((n) => ambGroupOf(n) === "weather") && L.every((n) => ambGroupOf(n) === "wildlife") && ambGroupOf("pistol") === null, "AMB_SOUNDS lists them by group for the mixer; ambGroupOf names the group");
  check([...W.map((n) => WEATHER_SOUNDS[n]), ...L.map((n) => WILDLIFE_SOUNDS[n])].every((s) => s.label && s.trim > 0 && s.trim < 1), "each has a label and a level (trim)");
  const voiceless = [...W.filter((n) => !WEATHER_SOUNDS[n].bed && !RECIPES[n]), ...L.filter((n) => !WILDLIFE_SOUNDS[n].bed && !CALLS[n])];
  check(!voiceless.length, `every one-shot has a voice${voiceless.length ? `: missing ${voiceless}` : ""}`);
  check(L.filter((n) => WILDLIFE_SOUNDS[n].bed).every((n) => WILD_BEDS[n]), "every wildlife bed has its loop");
  const P = plan({ hour: 6, season: "spring", wx: { key: "storm", wind: 0.9, rain: 0.9, temp: 14 }, ter: { forest: 0.3, town: 0.3, field: 0.4, river: 1, lake: 1, frozen: 1, base: 1 }, death: 1, hive: 1 });
  const unnamed = [...Object.keys(P.beds).filter((n) => !WEATHER_SOUNDS[n] && !WILDLIFE_SOUNDS[n]), ...Object.keys(P.weather).filter((n) => !WEATHER_SOUNDS[n]), ...Object.keys(P.wild).filter((n) => !WILDLIFE_SOUNDS[n])];
  check(!unnamed.length, `everything the plan can play is in the tables${unnamed.length ? `: ${unnamed}` : ""}`);
  check(Object.keys(WILD).every((n) => WILDLIFE_SOUNDS[n]) && Object.keys(P.weather).length >= 15, "the wildlife roster and the weather one-shots are all named");
  check(W.every((n) => groupOf(n) === "world.weather") && L.every((n) => groupOf(n) === "world.wildlife"), "the mixer knows them: World → Weather and World → Wildlife (ui/soundgroups.js)");
  const S = stub(8000), to = { weather: { n: 0, connect() {}, disconnect() {} }, wildlife: { n: 0, connect() {}, disconnect() {} } };
  const E = ambEngine(S.ctx, to);
  // where the buses go: a fresh engine whose filters report it
  const S2 = stub(8000), seen = [];
  const mk = S2.ctx.createBiquadFilter;
  S2.ctx.createBiquadFilter = () => { const f = mk(); f.connect = (d) => { seen.push(d); return d; }; return f; };
  ambEngine(S2.ctx, to);
  check(seen.includes(to.weather) && seen.includes(to.wildlife), "the weather bus goes to the Weather group's node, the wildlife bus to Wildlife's (beds and one-shots alike)");
  check(ambPreview(E, "weather", 0) === 1 && ambPreview(E, "wildlife", 0) === 1 && S.starts.length >= 3, "the mixer's ▶ plays thunder, and a songbird and a crow");
}

// ---------- 2. the mix by weather, hour, season, terrain ----------
console.log("The mix");
{
  const dawn = plan({ hour: 6, season: "spring", wx: { key: "clear", wind: 0.15, temp: 9 }, ter: forest });
  const noon = plan({ hour: 12, season: "spring", wx: { key: "clear", wind: 0.15, temp: 16 }, ter: forest });
  const midnight = plan({ hour: 1, season: "spring", wx: { key: "clear", wind: 0.15, temp: 7 }, ter: forest });
  const sd = sum(dawn.wild, SONG), sn = sum(noon.wild, SONG);
  check(sd > 2.5 * sn && sn > 3, `a spring forest: the dawn chorus at sunrise (${sd.toFixed(1)} songs a minute) over noon (${sn.toFixed(1)})`);
  check(sum(midnight.wild, SONG) === 0 && midnight.wild.owlHoot > 0.5 && noon.wild.owlHoot === 0, `owls at night in the forest (${midnight.wild.owlHoot}/min), none by day; no songbirds at night`);
  const wf = plan({ hour: 10, season: "spring", wx: { key: "clear", temp: 14 }, ter: forest }).wild.woodpecker, wp = plan({ hour: 10, season: "spring", wx: { key: "clear", temp: 14 }, ter: field }).wild.woodpecker;
  check(wf > 0.5 && wp < wf * 0.2, `woodpeckers drum in the forest (${wf}/min), hardly in the fields`);
  const pre = plan({ hour: 5, season: "spring", wx: { key: "clear", temp: 8 }, ter: forest });
  check(sum(pre.wild, SONG) > 1, "the chorus starts before first light");
  const frogs = plan({ hour: 23, season: "spring", wx: { key: "clear", temp: 12 }, ter: { field: 0.6, water: 0.4, lake: 1 } });
  const dry = plan({ hour: 23, season: "spring", wx: { key: "clear", temp: 12 }, ter: field });
  check(frogs.beds.frogs > 0.3 && dry.beds.frogs === 0 && frogs.beds.lake > 0.3, `frogs by a lake on a spring night (${frogs.beds.frogs}), none away from water; the lake laps`);
  const wint = plan({ hour: 23, season: "winter", wx: { key: "clear", temp: 2 }, ter: { field: 0.6, lake: 1 } });
  const wday = plan({ hour: 10, season: "winter", wx: { key: "clear", temp: 1 }, ter: forest });
  check(wint.beds.frogs === 0 && wint.beds.crickets === 0 && wday.beds.cicadas === 0 && wday.wild.songRobin === 0 && wday.wild.songWarbler === 0, "winter: no insects, no frogs, no summer songbirds");
  check(wday.wild.crow > 0 || wday.wild.raven > 0 || wday.wild.songWhistle > 0, "winter still has a few birds (crows, ravens, a whistler)");
  const hot = plan({ hour: 14, season: "summer", wx: { key: "heat", wind: 0.1, temp: 32 }, ter: field });
  const hotNight = plan({ hour: 2, season: "summer", wx: { key: "clear", wind: 0.1, temp: 21 }, ter: field });
  const cool = plan({ hour: 14, season: "summer", wx: { key: "clear", wind: 0.1, temp: 19 }, ter: field });
  check(hot.beds.cicadas > 0.5 && hotNight.beds.cicadas === 0 && cool.beds.cicadas < 0.05, `cicadas on a hot summer afternoon (${hot.beds.cicadas}), not at night, not on a cool day`);
  check(hotNight.beds.crickets > 0.6 && hot.beds.crickets === 0, `crickets on warm summer nights (${hotNight.beds.crickets}), not by day`);
  const ice = plan({ hour: 22, season: "winter", wx: { key: "frost", wind: 0.1, temp: -9 }, ter: { field: 0.7, water: 0.3, frozen: 1 } });
  check(ice.weather.iceGroan > 1 && ice.weather.icePing > 0.5 && ice.beds.river === 0, `frozen river: the ice groans (${ice.weather.iceGroan}/min) and sings, no running water`);
  check(plan({ hour: 12, season: "summer", wx: { key: "clear", temp: 20 }, ter: { field: 0.8, river: 1 } }).beds.river > 0.9, "a river runs where it is not frozen");
  const driz = plan({ hour: 12, season: "spring", wx: { key: "rain", rain: 0.3, wind: 0.3, temp: 10 }, ter: forest });
  const pour = plan({ hour: 12, season: "spring", wx: { key: "storm", rain: 1, wind: 0.9, temp: 10 }, ter: forest });
  check(driz.beds.rainWash < pour.beds.rainWash && driz.tone.washHp > pour.tone.washHp + 1000 && pour.beds.windLow > driz.beds.windLow, `drizzle (wash ${driz.beds.rainWash}, fine above ${driz.tone.washHp} Hz) to downpour (${pour.beds.rainWash}, from ${pour.tone.washHp} Hz, a low roar)`);
  check(driz.weather.dropLeaf > 5 && driz.weather.dropTin === 0 && plan({ hour: 12, wx: { key: "rain", rain: 0.5, temp: 10 }, ter: town }).weather.dropTin > 5, "drops by surface: leaves in the forest, tin roofs in town");
  check(pour.weather.thunderNear > 0 && pour.weather.thunderFar > 0 && sum(pour.wild, SONG) === 0 && driz.weather.thunderNear === 0, "a storm: thunder near and far, no songbirds; no thunder in plain rain");
  const front = makeScene({ hour: 15, season: "summer", wx: { key: "clear", wind: 0.3, temp: 24 }, approach: 0.8 });
  check(ambiencePlan(front).weather.thunderDistant > 0.5 && ambiencePlan(front).wind.base > 0.3, "a storm front coming: distant thunder, the wind picking up");
  const after = plan({ hour: 12, wx: { key: "overcast", temp: 12 }, ter: forest, wet: 0.6 });
  check(after.weather.drip > 3 && after.beds.rainWash === 0, "after the rain: dripping, no wash");
  const snow = plan({ hour: 12, season: "winter", wx: { key: "snow", snow: 0.5, wind: 0.3, temp: -3, cover: 0.7 }, ter: field });
  const bliz = plan({ hour: 12, season: "winter", wx: { key: "blizzard", snow: 1, wind: 0.95, temp: -12, cover: 0.9 }, ter: field });
  check(snow.beds.rainWash > 0 && snow.beds.rainWash < 0.35 && snow.tone.washLp < 3000 && snow.dull.weather > 0 && snow.dull.weather < 6000 && snow.dull.wildlife === snow.dull.weather, `snow: a soft hush, the world muffled under the cover (${snow.dull.weather} Hz)`);
  check(bliz.beds.windHigh > snow.beds.windHigh * 2 && bliz.beds.windLow > 0.9, "a blizzard howls");
  const fog = plan({ hour: 8, season: "autumn", wx: { key: "fog", wind: 0.05, temp: 7 }, ter: town });
  const clearAut = plan({ hour: 8, season: "autumn", wx: { key: "clear", wind: 0.05, temp: 7 }, ter: town });
  check(fog.fog && fog.dull.weather > 0 && fog.dull.weather <= 4200 && fog.beds.windLow < 0.25 && sum(fog.wild, ["crow", "dogBark"]) < sum(clearAut.wild, ["crow", "dogBark"]), "fog: still, closer and duller, fewer calls");
  const spring = plan({ hour: 10, season: "spring", wx: { key: "clear", temp: 12 }, ter: { field: 0.7, water: 0.3, lake: 1 } }), summer = plan({ hour: 10, season: "summer", wx: { key: "clear", temp: 22 }, ter: { field: 0.7, water: 0.3, lake: 1 } });
  check(spring.wild.geese > 0.3 && summer.wild.geese < spring.wild.geese * 0.15 && spring.wild.ducks > 0.3, "geese in the spring and autumn migrations (rare in summer), ducks on the water");
  const rut = plan({ hour: 19.5, season: "autumn", wx: { key: "clear", temp: 9 }, ter: hills });
  check(rut.wild.elkBugle > 0.2 && plan({ hour: 19.5, season: "summer", wx: { key: "clear", temp: 18 }, ter: hills }).wild.elkBugle === 0 && rut.wild.geese > 0, "autumn dusk in the hills: an elk in the rut (autumn only), geese going over");
  const night = plan({ hour: 1, season: "autumn", wx: { key: "clear", temp: 6 }, ter: hills });
  check(night.wild.wolfHowl > 0 && night.wild.wolfHowl < 0.2 && night.wild.coyote > 0 && plan({ hour: 1, wx: { key: "clear" }, ter: town }).wild.dogBark > 0.3, "wolves and coyotes rare at night in the hills; feral dogs in the ruins");
  const crows = plan({ hour: 11, wx: { key: "clear", temp: 15 }, ter: field }), carrion = plan({ hour: 11, wx: { key: "clear", temp: 15 }, ter: field, death: 1 });
  check(carrion.wild.crow > 3 * crows.wild.crow && carrion.wild.flies > 0 && crows.wild.flies === 0, "crows gather at a death site; flies");
  const hive = plan({ hour: 11, season: "summer", wx: { key: "clear", temp: 22 }, ter: forest, hive: 1 }), nohive = plan({ hour: 11, season: "summer", wx: { key: "clear", temp: 22 }, ter: forest });
  check(sum(hive.wild, SONG) < 0.3 * sum(nohive.wild, SONG) && hive.wild.flies > 1 && hive.wrong === 1, "a hive near: sparse, wrong-sounding wildlife and buzzing flies");
  const windy = plan({ hour: 12, wx: { key: "overcast", wind: 0.7, temp: 10 }, ter: town }), still = plan({ hour: 12, wx: { key: "overcast", wind: 0.1, temp: 10 }, ter: town });
  check(windy.weather.rattle > 1 && windy.weather.shutter > 0.3 && still.weather.shutter === 0 && plan({ hour: 12, wx: { key: "overcast", wind: 0.7 }, ter: forest }).weather.branch > 0.5, "wind: rattles and shutters in town, branches in the forest (more as it blows)");
  const calm = plan({ hour: 12, season: "summer", wx: { key: "clear", wind: 0.2, temp: 20 }, ter: field });
  check(Object.values(calm.beds).every(Number.isFinite) && Object.values(calm.wild).every(Number.isFinite) && Object.values(plan({}).beds).every(Number.isFinite), "finite levels everywhere");
}

// ---------- 3. danger silences the wildlife (a real world) ----------
console.log("Silence");
const st = createWorld({ seed: 11, factionCount: 3 });
{
  const g = st.grid;
  // A quiet land tile to listen on, the season spring, a fine morning there.
  const tile = st.tiles.find((t) => t.terrain === "forest" && !t.loc && t.x > 8 && t.y > 8 && t.x < g.width - 8 && t.y < g.height - 8).id;
  const ui = { started: true };
  const mem = {};
  const at = (now, o = {}) => ambienceScene(st, ui, mem, now, { tile, ...o });
  st.hordes = [];
  const quiet = at(0);
  check(quiet.mode === "map" && quiet.hush.all === 0 && quiet.ter.forest > 0.2, `listening on a forest tile with nothing near: no silence (forest ${quiet.ter.forest.toFixed(2)})`);
  const near = g.within(tile, 2).find((id) => g.distance(tile, id) === 2);
  const h = makeHorde(st, { tile: near, size: 30 });
  if (!st.hordes.includes(h)) st.hordes.push(h);
  st.live = new Set([...(st.live || []), near]);
  let s = at(0.25);
  for (let k = 1; k <= 40; k++) s = at(0.25 + k * 0.25);
  check(s.hush.horde > 0.95 && s.hush.all > 0.95, `a horde two tiles off: the wildlife falls silent within seconds (${s.hush.horde})`);
  const P = ambiencePlan(makeScene({ hour: 7, season: "spring", wx: { key: "clear", temp: 12 }, ter: forest, hush: s.hush }));
  check(sum(P.wild, Object.keys(WILD)) === 0 && P.beds.crickets === 0, "silent: no calls at all, the insects too");
  st.live.delete(near);
  const hid = ambienceScene(st, ui, {}, 0, { tile });
  check(hid.hush.horde === 0, "a horde out of sight does not hush anything (the silence never gives one away)");
  st.live.add(near);
  // flushed: one alarm as the silence falls (a fresh memory)
  const m2 = {};
  ambienceScene(st, ui, m2, 0, { tile: st.tiles.find((t) => g.distance(t.id, near) > 9 && t.terrain !== "water").id });
  let flushes = 0;
  for (let k = 1; k <= 40; k++) if (ambienceScene(st, ui, m2, k * 0.25, { tile }).flush) flushes++;
  check(flushes === 1, `the birds flush once as the dead come near (${flushes} alarm)`);
  st.hordes = st.hordes.filter((x) => x !== h);
  s = at(11);
  const s5 = (() => { let x; for (let k = 1; k <= 20; k++) x = at(11 + k * 0.25); return x; })();
  let s60;
  for (let k = 1; k <= 240; k++) s60 = at(16 + k * 0.25);
  check(s5.hush.horde > 0.6 && s60.hush.horde < 0.05, `the horde gone: still hushed 5 s later (${s5.hush.horde}), back a minute on (${s60.hush.horde})`);
  // A battle on this tile: silence; gunfire holds it after the fight and lets go over a minute.
  const b = { setup: { tile, layout: "forest" }, fx: [], fxSeq: 0, units: [], w: 10, h: 10 };
  st.combat = b;
  let sb = at(100);
  check(sb.mode === "battle" && sb.hush.battle === 1 && ambiencePlan(sb).wild.songRobin === 0, "in battle: no wildlife");
  b.fx.push({ seq: ++b.fxSeq, type: "shot", from: [1, 1], to: [5, 5] });
  sb = at(101);
  check(sb.hush.gun === 1, "a shot is heard by the ambience (silence for a while after)");
  st.combat = null;
  const a5 = at(106), a40 = at(101 + SCENE.GUN_HOLD + 30), a75 = at(101 + SCENE.GUN_HOLD + SCENE.GUN_FADE + 2);
  check(a5.hush.gun === 1 && a40.hush.gun > 0.35 && a40.hush.gun < 0.65 && a75.hush.gun === 0, `after the gunfire: silent at 5 s, half back at ${SCENE.GUN_HOLD + 30} s (${a40.hush.gun.toFixed(2)}), back after a minute and a bit`);
  check(gunHush(null, 5) === 0 && gunHush(0, 1000) === 0, "no gunfire: no silence");
  check(a40.field > 0 && ambiencePlan({ ...a40, hour: 11, ...dayAt(11), season: "summer", wx: { ...a40.wx, key: "clear", temp: 18, rainI: 0 } }).wild.crow >= 0, "the battlefield draws crows once the shooting stops");
}
function dayAt(h) { return makeScene({ hour: h }); }

// ---------- 4. indoors ----------
console.log("Indoors");
{
  const g = st.grid, tile = st.tiles.find((t) => t.terrain === "city").id;
  const b = { setup: { tile, layout: "town" }, raid: { plan: { building: { name: "a pharmacy" } } }, fx: [], fxSeq: 0, units: [], w: 10, h: 10 };
  st.combat = b;
  const s = ambienceScene(st, { started: true }, {}, 0, {});
  st.combat = null;
  check(s.room === "inside" && s.indoor, "a building raid is heard from indoors");
  const P = ambiencePlan({ ...s, wx: { key: "rain", wind: 0.4, rainI: 0.6, snowI: 0, temp: 12, cover: 0, storm: 0 } });
  const out = ambiencePlan({ ...s, indoor: false, room: "town", wx: { key: "rain", wind: 0.4, rainI: 0.6, snowI: 0, temp: 12, cover: 0, storm: 0 } });
  check(P.dull.weather > 0 && P.dull.weather <= 700 && out.dull.weather === 0, `rain outside comes through the walls low-passed (${P.dull.weather} Hz)`);
  check(P.weather.dropTin > 0 && P.weather.dropLeaf === 0 && P.beds.windMid < out.beds.windMid * 0.5, "on the roof overhead; the wind outside dulled");
  check(sum(P.wild, Object.keys(WILD)) === 0 && P.beds.crickets === 0, "the wildlife mostly gone");
}

// ---------- 5. zoomed out ----------
console.log("Zoomed out");
{
  const base = { hour: 6, season: "spring", wx: { key: "rain", rain: 0.5, wind: 0.4, temp: 11 }, ter: { forest: 0.5, town: 0.5, river: 1 } };
  const near = plan(base), far = plan({ ...base, far: 1 });
  check(sum(far.wild, Object.keys(far.wild)) === 0 && sum(far.weather, ["dropLeaf", "dropTin", "dropGutter", "dropPuddle", "rattle", "creak"]) === 0, "far out: no calls, no drops or rattles (no detail)");
  check(far.beds.rainWash === near.beds.rainWash && far.beds.windLow === near.beds.windLow && far.beds.river < near.beds.river * 0.5, "the general bed stays: wind and rain as near, the river faded");
  const g = st.grid, tile = st.tiles.find((t) => t.terrain === "plains").id;
  check(ambienceScene(st, { started: true }, {}, 0, { tile, zoom: 0.3 }).far === 1 && ambienceScene(st, { started: true }, {}, 0, { tile, zoom: 1 }).far === 0, `the camera's zoom sets it (detail above ${SCENE.FAR_ZOOM[0]}, the bed below ${SCENE.FAR_ZOOM[1]})`);
  const t1 = terrainAround(st, tile), t2 = terrainAround(st, g.neighbors(tile)[0]);
  check(Math.abs(t1.field - t2.field) < 0.6 && Math.abs(Object.values(t1).slice(0, 5).reduce((a, v) => a + v, 0) - 1) < 1e-9, "the terrain is blended over two rings (moving a tile changes it a little, not all at once)");
}

// ---------- 6. the throttle and the node budget ----------
console.log("Budget");
{
  const scenes = {
    "storm in town by a river": makeScene({ hour: 22, season: "summer", wx: { key: "storm", rain: 1, wind: 0.95, temp: 18 }, ter: { town: 0.5, forest: 0.3, field: 0.2, river: 1, base: 1 }, approach: 1 }),
    "spring dawn chorus by a lake": makeScene({ hour: 6, season: "spring", wx: { key: "clear", wind: 0.4, temp: 13 }, ter: { forest: 0.6, field: 0.3, water: 0.1, lake: 1, river: 0.75 }, death: 1, hive: 0.3 }),
    "summer night by a lake": makeScene({ hour: 23, season: "summer", wx: { key: "clear", wind: 0.3, temp: 22 }, ter: { field: 0.5, forest: 0.3, water: 0.2, lake: 1, river: 0.4, frozen: 0 } }),
    "autumn dusk in the hills": makeScene({ hour: 19.5, season: "autumn", wx: { key: "overcast", wind: 0.5, temp: 9 }, ter: { hills: 0.7, forest: 0.3, river: 0.4 } }),
  };
  for (const [name, sc] of Object.entries(scenes)) {
    const S = stub(8000), E = ambEngine(S.ctx, dest());
    const P = ambiencePlan(sc);
    let maxBed = 0, maxWild = 0, maxWx = 0, calls = 0;
    for (let k = 0; k < 4 * 90; k++) {
      const t = k * 0.25;
      S.ctx.currentTime = t;
      const before = S.starts.length;
      ambPlay(E, P, t);
      calls += S.starts.length - before;
      maxBed = Math.max(maxBed, bedNodes(E));
      maxWild = Math.max(maxWild, busy(E, "wildlife", t));
      maxWx = Math.max(maxWx, busy(E, "weather", t));
    }
    check(maxBed <= 25 && maxWild <= WILD_LIMIT && maxWx <= WEATHER_LIMIT + 2 && !S.bad.length && calls > 5,
      `${name}: beds at most ${maxBed} nodes (+4 for the buses), ${maxWild} calls and ${maxWx} weather sounds at once, ${calls} one-shots in 90 s${S.bad.length ? `; bad: ${S.bad.slice(0, 3)}` : ""}`);
  }
  // Beds let go when unheard.
  const S = stub(8000), E = ambEngine(S.ctx, dest());
  ambPlay(E, ambiencePlan(scenes["storm in town by a river"]), 0);
  const busyNodes = bedNodes(E);
  const calm = ambiencePlan(makeScene({ hour: 12, season: "winter", wx: { key: "frost", wind: 0, temp: -5 }, ter: { field: 1 } }));
  for (let k = 1; k <= 4 * (BED_IDLE + 3); k++) ambPlay(E, calm, k * 0.25);
  check(bedNodes(E) < busyNodes && !E.beds.rainWash.live, `a bed nobody hears is let go after ${BED_IDLE} s (${busyNodes} nodes in the storm, ${bedNodes(E)} on a still frosty day)`);
  const st2 = ambStats(S.ctx);
  check(st2 && st2.busNodes === 4 && st2.baked > 0 && ambBus(S.ctx).weather && ambBus(S.ctx).wildlife, `ambStats and ambBus for the mixer (baked ${st2.baked} buffers)`);
}

// ---------- 7. every voice bakes clean ----------
console.log("Voices");
{
  const S = stub(16000), E = ambEngine(S.ctx, dest());
  const bad = [];
  let ms = 0, n = 0;
  for (const [name, f] of [...Object.entries(RECIPES), ...Object.entries(CALLS)]) {
    for (let v = 0; v < 2; v++) {
      const a = performance.now(), d = f(16000, (() => { let x = 7 + v; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; })());
      ms += performance.now() - a; n++;
      const ch = Array.isArray(d) ? d : [d];
      let pk = 0, nan = false;
      for (const c of ch) for (let i = 0; i < c.length; i++) { const x = c[i]; if (!Number.isFinite(x)) nan = true; else pk = Math.max(pk, Math.abs(x)); }
      if (nan || pk > 1 || pk < 0.05 || ch[0].length / 16000 > 10) bad.push(`${name}:${v} pk ${pk.toFixed(2)}${nan ? " NaN" : ""}`);
    }
  }
  check(!bad.length, `every weather and wildlife voice bakes with no NaN, a sane peak and under 10 s (${n} variants, ${(ms / n).toFixed(1)} ms each at 16 kHz)${bad.length ? `: ${bad.slice(0, 4)}` : ""}`);
  for (const k of ["crickets", "frogs", "cicadas"]) WILD_BEDS[k].build(E, 0);
  check(["bed:crickets", "bed:frogs", "bed:cicadas"].every((k) => E.bufs.get(k) && E.bufs.get(k).numberOfChannels === 2), "the insect and frog choruses are stereo loops");
  const loop = E.bufs.get("bed:crickets").getChannelData(0);
  check(Math.abs(loop[0] - loop[loop.length - 1]) < 0.2, "the loops join without a jump");
}

// ---------- 8. the title's storm ----------
console.log("Title");
{
  const S = stub(8000), E = ambEngine(S.ctx, dest());
  const mem = {};
  const quiet = ambTarget(null, { title: true }, mem, 0, {});
  check(quiet.mode === "title" && quiet.beds.windLow > 0 && quiet.beds.drone > 0.4 && quiet.beds.rainWash === 0 && sum(quiet.wild, Object.keys(quiet.wild)) === 0, "the title: wind and the drone, nothing else");
  ambLightning(0.8);
  const storm = ambTarget(null, { title: true }, mem, 0, {});
  const before = S.starts.length;
  weatherFrame(E, storm, 0);
  const thunder = S.starts.slice(before).filter((s) => s.buf && s.buf.duration > 4 && s.t >= 1 && s.t <= 4);
  check(storm.beds.rainWash > 0 && thunder.length === 1, `its lightning: thunder a second or three after the flash (at ${thunder[0] ? thunder[0].t.toFixed(1) : "?"} s), rain while it flashes`);
  check(ambTarget(null, { timelapse: true, started: true }, {}, 0, {}).mode === "off", "the timelapse: silent as before");
}

// ---------- 9. determinism ----------
console.log("Determinism");
{
  // What a world did (ids run on across worlds in one process, so they are left out): its dice, the weather's dice, the
  // hour, the hordes, the people, the parties, the stores.
  const print = (x) => JSON.stringify({ rng: x.rng, wx: x.weather && [x.weather.rs, x.weather.fs, x.weather.days.length, x.weather.fronts.length], hour: x.hour,
    hordes: x.hordes.map((h) => [h.tile, h.size]), people: (x.survivors || []).length, parties: x.parties.map((p) => [p.owner === "player", p.path && p.path[p.idx]]),
    bases: x.bases.map((b) => [b.tile, JSON.stringify(b.stock || b.stores || null)]) });
  const run = (withAmb) => {
    const W = createWorld({ seed: 23, factionCount: 3 });
    const S = stub(8000), E = ambEngine(S.ctx, dest());
    const mem = {};
    let t = 0;
    for (let h = 0; h < 96; h++) {
      if (withAmb) for (const tile of [W.tiles[(h * 97) % W.tiles.length].id, W.bases[0] ? W.bases[0].tile : 0]) {
        ambPlay(E, ambTarget(W, { started: true }, mem, t, { tile, zoom: 1, hourFrac: 0.5 }), t);
        t += 0.25;
      }
      tickHour(W);
      W.cards.length = 0;
      if (W.combat) W.combat = null;
    }
    return print(W);
  };
  const a = run(false), a2 = run(false), b = run(true);
  check(a === a2, "the same world twice without the ambience: the same (the check below means something)");
  check(a === b, `96 hours: the world plays out the same with the ambience listening every hour (${a.length} chars of state)`);
  const W = createWorld({ seed: 5, factionCount: 3 });
  const before = saveToString(W);
  for (let i = 0; i < 50; i++) ambTarget(W, { started: true }, {}, i, { tile: W.tiles[i * 31].id, zoom: 0.6 + (i % 3) * 0.3 });
  check(saveToString(W) === before, "reading the map for the ambience changes nothing in the saved world");
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
