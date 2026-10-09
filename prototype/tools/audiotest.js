// Sound (ui/audio.js plays, ui/soundcues.js decides what): headless checks with no speakers.
// - Options: the Sound defaults, bad values cleaned, kept by the options store (ui/saves.js) across a reload.
// - Cards: routine / warning / crisis chimes by what the card is about; a raid on a base is the alarm.
// - Battle (the dead's own voices: tools/zombiesfxtest.js): each gun class has its report (pistol, revolver, rifle, shotgun, burst, suppressed, bow, acid), hits and
//   misses, blows, bites, throws, the downed; a new battle drums (a base defence rings the alarm); a 200-shot frame
//   is cut to a handful; a battle already under way when first seen (a load) makes no sound for what was there.
// - The map: a new card or alert chimes once, a horde newly seen near a base or a team stings once, a load is quiet.
// - Ambience by weather and hour: rain and thunder in storms, the drone at night, birds by day, crickets on warm nights.
// - The throttle; every sound built on a stub AudioContext with no exception and no NaN or bad ramp.
// - The Options section and the Help topic.
// Usage: node tools/audiotest.js
import { createWorld, hub, addCard } from "../src/sim/world.js";
import * as C from "../src/sim/combat.js";
import { WEAPONS } from "../src/sim/combat.js";
import { THROWABLES } from "../src/sim/stealth.js";
import { battles } from "./isobattles.js";
import {
  cardUrgency, isBaseAttack, weaponSound, throwSound, battleCues, worldCues, ambienceMix, makeThrottle, hordesNear, MAX_BATTLE_SOUNDS, ALERT_QUIET_HOURS,
} from "../src/ui/soundcues.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

// ui/audio.js imports the map renderer; it must load with no browser and do nothing there.
const AU = await import("../src/ui/audio.js");
const { VOICES, SOUND_NAMES, soundOptions, SOUND_DEFAULTS, sfx, initAudio, audioFrame, soundOptionsHtml, soundHelp } = AU;

// ---------- 1. options ----------
console.log("Options");
{
  const o = {};
  const s = soundOptions(o);
  check(JSON.stringify(s) === JSON.stringify(SOUND_DEFAULTS) && o.sound === s, `defaults: master ${s.master}, effects ${s.sfx}, ambience ${s.amb}, mute off, mute when not focused on`);
  const bad = soundOptions({ sound: { master: 7, sfx: -1, amb: "x", mute: "yes", muteBlur: false } });
  check(bad.master === 1 && bad.sfx === 0 && bad.amb === SOUND_DEFAULTS.amb && bad.mute === false && bad.muteBlur === false, "bad values clamped or put back to the default; good ones kept");
  // The options store (ui/saves.js) keeps options.sound across a reload.
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const { loadOptions, saveOptions } = await import("../src/ui/saves.js");
  const before = loadOptions();
  soundOptions(before);
  before.sound.amb = 0.25; before.sound.mute = true;
  saveOptions(before);
  const after = loadOptions();
  const back = soundOptions(after);
  check(back.amb === 0.25 && back.mute === true && back.master === SOUND_DEFAULTS.master, "the Sound options survive a reload of the options");
  delete globalThis.localStorage;
  check(initAudio({}, () => {}) === undefined && sfx("pistol") === false, "with no browser: initAudio does nothing, sfx plays nothing");
}

// ---------- 2. cards ----------
console.log("Cards");
{
  const u = (title, extra = {}) => cardUrgency({ title, ...extra });
  check(u("A peddler at the gate") === "routine" && u("Traders on the radio") === "routine" && u("Stories by the fire") === "routine", "visitors, traders, stories: routine");
  check(u("Breakdown") === "warning" && u("A quarrel at Oakridge") === "warning" && u("After the fight") === "warning" && u("Storm") === "warning", "a breakdown, a quarrel, after a fight, a storm: warning");
  check(u("Oakridge has fallen") === "crisis" && u("Outbreak at the hub") === "crisis" && u("Horde of 40") === "crisis" && u("Ella rose") === "crisis", "a base fallen, an outbreak, a horde, someone rising: crisis");
  check(u("Ambush", { kind: "conflict", conflict: { type: "ambush" } }) === "crisis" && u("Checkpoint", { kind: "conflict", conflict: { type: "contest" } }) === "warning", "a road conflict: forced is a crisis, the rest a warning");
  const raids = ["Raiders heading for Oakridge", "Outsider raiders heading for Oakridge", "Horde heading for Oakridge", "Heard on the radio: Red Hand are coming for Oakridge", "Red Hand goes on the attack", "Raid defense"];
  check(raids.every((t) => isBaseAttack({ title: t }) && u(t) === "crisis"), "raids on a base: the alarm (and a crisis)");
  check(!isBaseAttack({ title: "A horde passing through" }) && !isBaseAttack({ title: "Ransom paid" }), "a horde passing, a ransom: not the alarm");
}

// ---------- 3. weapons and throwables ----------
console.log("Weapons");
{
  const ranged = Object.keys(WEAPONS).filter((k) => !WEAPONS[k].melee);
  check(ranged.every((k) => VOICES[weaponSound(k)]), `every gun has a sound (${ranged.map((k) => `${k}=${weaponSound(k)}`).join(", ")})`);
  check(weaponSound("pistol") === "pistol" && weaponSound("revolver") === "revolver" && weaponSound("huntrifle") === "rifle" && weaponSound("shotgun") === "shotgun" &&
    weaponSound("ar") === "auto" && weaponSound("xbow") === "bow" && weaponSound("acid") === "acid", "pistol, revolver, rifle, shotgun, burst, bow and acid apart");
  check(weaponSound("pistol", { suppressor: { dur: 5 } }) === "suppressed" && weaponSound("crossbow", { suppressor: {} }) === "bow", "a suppressor muffles a gun (a bow is silent anyway)");
  check(Object.keys(THROWABLES).every((k) => VOICES[throwSound(k)]) && throwSound("pipebomb") === "blast" && throwSound("frag") === "blast" && throwSound("molotov") === "fire" && throwSound("smokegren") === "hiss",
    "every throwable has a sound: pipe bomb and frag blast, Molotov fire, smoke hiss");
}

// ---------- 4. battle ----------
console.log("Battle");
{
  let rv = 0.37;
  const rng = () => (rv = (rv * 9301 + 49297) % 233280 / 233280);
  const [town] = battles(21, ["field-town"]);
  const { b } = town;
  const mem = { rng };
  const first = battleCues(b, mem, 0);
  check(first.length === 1 && first[0].name === "battle", "a new battle: the drums (and nothing for what was already on the field)");
  check(battleCues(b, mem, 0.1).length === 0, "nothing new: silence");
  const me = b.units.find((u) => u.side === "player" && !u.dead), foe = b.units.find((u) => u.side === "enemy" && !u.dead);
  me.weapon = "shotgun";
  C.fx(b, { type: "shot", from: [me.x, me.y], to: [foe.x, foe.y], hit: true, crit: false, dmg: 20, side: "player" });
  let cues = battleCues(b, mem, 0.2).map((c) => c.name);
  check(cues[0] === "shotgun" && cues.includes("hit"), `a shotgun hit: ${cues.join(", ")}`);
  me.weapon = "huntrifle";
  C.fx(b, { type: "shot", from: [me.x, me.y], to: [foe.x, foe.y], hit: false, side: "player" });
  cues = battleCues(b, mem, 0.3).map((c) => c.name);
  check(cues[0] === "rifle" && (cues.includes("whiz") || cues.includes("ricochet")), `a rifle miss: ${cues.join(", ")}`);
  C.fx(b, { type: "melee", from: [me.x, me.y], to: [foe.x, foe.y], hit: true, crit: true, dmg: 30, side: "player" });
  C.fx(b, { type: "melee", from: [me.x, me.y], to: [foe.x, foe.y], hit: false, side: "player" });
  C.fx(b, { type: "throw", from: [me.x, me.y], to: [foe.x, foe.y], item: "molotov" });
  cues = battleCues(b, mem, 0.4).map((c) => c.name);
  check(cues.join() === "meleeCrit,whoosh,fire", `a critical blow, a miss, a Molotov: ${cues.join(", ")}`);
  // A 20-unit firefight: 200 shots in one frame are cut to a handful, spread in time.
  for (let i = 0; i < 200; i++) C.fx(b, { type: "shot", from: [foe.x, foe.y], to: [me.x, me.y], hit: i % 2 === 0, side: "enemy" });
  me.weapon = "ar";
  C.fx(b, { type: "shot", from: [me.x, me.y], to: [foe.x, foe.y], hit: true, side: "player" });
  const volley = battleCues(b, mem, 0.5);
  check(volley.some((c) => c.name === "auto"), "your own shot is heard over the enemy's volley");
  check(volley.length <= MAX_BATTLE_SOUNDS && volley.length >= 3, `200 shots in one frame: ${volley.length} sounds`);
  check(volley.every((c, i) => i === 0 || c.delay >= volley[i - 1].delay - 1e-9) && volley[volley.length - 1].delay > 0.05, "the volley is spread in time");
  // Your people going down and dying.
  me.down = true;
  cues = battleCues(b, mem, 0.6).map((c) => c.name);
  check(cues.includes("downed"), "one of yours goes down: the downed sound");
  me.dead = true;
  const other = b.units.find((u) => u.side === "enemy" && u !== foe && !u.dead);
  if (other) other.dead = true;
  cues = battleCues(b, mem, 0.7).map((c) => c.name);
  check(cues.includes("death") && cues.filter((n) => n === "death").length === 1, "and dies: the death sound (an enemy dying makes none of its own)");
  // A battle first seen part way (a save loaded mid-battle): no sound for the effects already logged.
  const late = { rng };
  battleCues(b, late, 0);
  check(battleCues(b, late, 0.1).length === 0, "a battle loaded part way: nothing replayed");
}
{
  // The dead: groans while they are up, bites from the real enemy turn.
  const [forest] = battles(22, ["field-forest"]);
  const { st, b } = forest;
  const mem = {};
  battleCues(b, mem, 0);
  const heard = new Set();
  let t = 1, err = "";
  for (let turn = 0; turn < 6 && !b.over; turn++) {
    try {
      C.combatAct(st, { type: "end" });
      if (b.phase === "enemy") C.runEnemyPhase(st);
    } catch (e) { err = e.message; break; }
    for (let k = 0; k < 4; k++) for (const c of battleCues(b, mem, (t += 2))) heard.add(c.name);
  }
  check(!err, `six turns against the dead play out${err ? `: ${err}` : ""}`);
  check(heard.has("zIdle"), `the dead moan, each in its own voice (ui/zombiesfx.js; heard: ${[...heard].join(", ")})`);
  check([...heard].every((n) => VOICES[n]), "every cue is a known sound");
}
{
  const base = battles(42).find((x) => x.b.setup.layout === "baseDefence");
  check(!!base && battleCues(base.b, {}, 0)[0].name === "alarm", "a battle at your own base: the alarm bell");
}

// ---------- 5. the map ----------
console.log("The map");
{
  const st = createWorld({ seed: 7, factionCount: 4 });
  st.started = true;
  const ui = { started: true, alertList: [{ key: "food:1", tone: "warn", kind: "food" }] };
  const mem = {};
  addCard(st, { title: "A peddler at the gate", choices: [] });
  check(worldCues(st, ui, mem).length === 0, "a world first heard (new or loaded): no sound for the cards and alerts already there");
  addCard(st, { title: "A peddler at the gate", choices: [] });
  check(worldCues(st, ui, mem).map((c) => c.name).join() === "cardRoutine", "a new routine card: the routine chime");
  addCard(st, { title: "Breakdown", choices: [] });
  addCard(st, { title: "Oakridge has fallen", choices: [] });
  check(worldCues(st, ui, mem).map((c) => c.name).join() === "cardCrisis", "two new cards at once: the most urgent one only");
  addCard(st, { title: "Raiders heading for Oakridge", choices: [] });
  check(worldCues(st, ui, mem).map((c) => c.name).join() === "alarm", "a raid warning: the alarm bell");
  check(worldCues(st, ui, mem).length === 0, "the same cards again: silence");
  ui.alertList = [...ui.alertList, { key: "starve:1", tone: "danger", kind: "starve" }, { key: "built:1", tone: "good", kind: "built" }];
  check(worldCues(st, ui, mem).map((c) => c.name).join() === "alert", "a new danger alert: the alert bell (good news under it is not heard)");
  ui.alertList = [{ key: "idle:3:2", tone: "warn", kind: "idle" }];
  check(worldCues(st, ui, mem).map((c) => c.name).join() === "alert", "a new warning: the alert bell");
  ui.alertList = [{ key: "idle:3:4", tone: "warn", kind: "idle" }];
  check(worldCues(st, ui, mem).length === 0, "the same alert with a new count: silence");
  ui.alertList = [{ key: "idle:3:4", tone: "danger", kind: "idle" }];
  check(worldCues(st, ui, mem).map((c) => c.name).join() === "alert", "a warning turning into a danger: heard again");
  ui.alertList = [];
  worldCues(st, ui, mem);
  st.hour += 3;
  ui.alertList = [{ key: "idle:3:4", tone: "danger", kind: "idle" }];
  check(worldCues(st, ui, mem).length === 0, "an alert flickering off and on within hours: heard once");
  st.hour += ALERT_QUIET_HOURS + 1;
  check(worldCues(st, ui, mem).map((c) => c.name).join() === "alert", "back after half a day away: heard again");
  ui.alertList = [...ui.alertList, { key: "breakin:9", tone: "danger", kind: "breakin" }];
  check(worldCues(st, ui, mem).map((c) => c.name).join() === "alarm", "a break-in alert: the alarm");
  st.autopilot = { on: true };
  addCard(st, { title: "Oakridge has fallen", choices: [] });
  check(worldCues(st, ui, mem).length === 0, "on autopilot the cards are answered at once: no chimes");
  delete st.autopilot;
  // A horde seen near the hub: one sting, once.
  const h = hub(st);
  const near = st.tiles.find((t) => t.id !== h.tile && st.grid.distance(t.id, h.tile) === 3);
  st.hordes.push({ id: 9001, tile: near.id, size: 40, target: null });
  st.live.add(near.id);
  check(hordesNear(st).some((x) => x.id === 9001), "a horde you can see 3 tiles from the hub is near");
  check(worldCues(st, ui, mem).map((c) => c.name).join() === "horde" && worldCues(st, ui, mem).length === 0, "a horde newly seen near the hub: the sting, once");
  const far = st.tiles.find((t) => st.grid.distance(t.id, h.tile) > 12 && !st.bases.some((b) => st.grid.distance(t.id, b.tile) <= 8));
  st.hordes.push({ id: 9002, tile: far.id, size: 40, target: null });
  st.live.add(far.id);
  check(worldCues(st, ui, mem).length === 0, "a horde far from your bases and teams: no sting");
  st.live.delete(near.id);
  const unseen = { id: 9003, tile: near.id, size: 30 };
  st.hordes.push(unseen);
  check(worldCues(st, ui, mem).length === 0, "a horde near but out of sight: no sting");
  const st2 = createWorld({ seed: 8, factionCount: 4 });
  check(worldCues(st2, ui, mem).length === 0, "another world (a load): the memory starts again quietly");
}

// ---------- 6. ambience ----------
console.log("Ambience");
{
  const storm = ambienceMix({ key: "storm", wind: 0.9, rain: 0.9, temp: 14 }, 13, "summer");
  check(storm.rain > 0.8 && storm.thunder === 1 && storm.wind > 0.6 && storm.birds === 0, `a storm: rain ${storm.rain.toFixed(2)}, wind ${storm.wind.toFixed(2)}, thunder, no birds`);
  const noon = ambienceMix({ key: "clear", wind: 0.2, rain: 0, temp: 22 }, 12, "summer");
  check(noon.birds > 0.5 && noon.drone < 0.3 && noon.rain === 0 && noon.crickets === 0, `a clear summer noon: birds ${noon.birds.toFixed(2)}, drone low`);
  const dawn = ambienceMix({ key: "clear", wind: 0.2, rain: 0, temp: 12 }, 7, "spring");
  check(dawn.birds >= noon.birds, "the dawn chorus is no quieter than noon");
  const night = ambienceMix({ key: "clear", wind: 0.2, rain: 0, temp: 18 }, 1, "summer");
  check(night.drone > 0.8 && night.birds === 0 && night.crickets > 0.5, `a warm summer night: the drone ${night.drone.toFixed(2)}, crickets, no birds`);
  const dusk = ambienceMix({ key: "clear", wind: 0.2, rain: 0, temp: 18 }, 20, "summer");
  check(dusk.drone > noon.drone && dusk.drone < night.drone, "dusk: the drone fading in");
  const bliz = ambienceMix({ key: "blizzard", wind: 0.95, rain: 0, snow: 1, temp: -12 }, 12, "winter");
  check(bliz.wind > 0.8 && bliz.birds === 0 && bliz.crickets === 0 && bliz.rain === 0 && bliz.windTone > noon.windTone, "a blizzard: a high, strong wind and nothing alive");
  const fog = ambienceMix({ key: "fog", wind: 0.05, rain: 0, temp: 8 }, 10, "autumn");
  check(fog.wind < 0.1 && fog.birds === 0, "fog: still and hushed");
  check(Object.values(ambienceMix(null, 30.5)).every((v) => Number.isFinite(v)), "no weather (a fresh world): finite levels");
}

// ---------- 7. throttle ----------
console.log("Throttle");
{
  const th = makeThrottle({ pistol: { gap: 0.045, max: 4 } }, 10);
  let n = 0;
  for (let i = 0; i < 200; i++) if (th.allow("pistol", 1, 0.35)) n++;
  check(n === 1, `200 pistol shots at the same instant: ${n} heard`);
  let m = 0;
  for (let i = 0; i < 200; i++) if (th.allow("pistol", 2 + i * 0.01, 0.35)) m++;
  check(m > 0 && m <= 40, `200 shots over 2 seconds: ${m} heard (a gap of 45 ms, 4 at once)`);
  const tot = makeThrottle({}, 5);
  let k = 0;
  for (const name of ["a", "b", "c", "d", "e", "f", "g"]) if (tot.allow(name, 5, 1)) k++;
  check(k === 5 && tot.playing === 5, "the cap on everything playing at once holds");
  check(tot.allow("h", 6.5, 1), "and frees up once they end");
}

// ---------- 8. every sound on a stub AudioContext ----------
console.log("Voices");
{
  let bad = [];
  const param = (name, v = 0) => {
    const p = { value: v };
    const fin = (x, what) => { if (!Number.isFinite(x)) bad.push(`${name}.${what}(${x})`); };
    p.setValueAtTime = (x, t) => { fin(x, "set"); fin(t, "setT"); return p; };
    p.linearRampToValueAtTime = (x, t) => { fin(x, "lin"); fin(t, "linT"); return p; };
    p.exponentialRampToValueAtTime = (x, t) => { fin(x, "exp"); if (!(x > 0)) bad.push(`${name}.exp(${x})`); fin(t, "expT"); return p; };
    p.setTargetAtTime = (x, t, k) => { fin(x, "tgt"); return p; };
    return p;
  };
  let nodes = 0, started = 0, stopped = 0;
  const node = (extra = {}) => { nodes++; return { connect(d) { if (!d) bad.push("connect(null)"); return d; }, disconnect() {}, ...extra }; };
  const ctx = {
    sampleRate: 8000, currentTime: 0,
    createGain: () => node({ gain: param("gain", 1) }),
    createBiquadFilter: () => node({ type: "", frequency: param("freq", 350), Q: param("Q", 1) }),
    createOscillator: () => node({ type: "", frequency: param("osc", 440), start() { started++; }, stop(t) { stopped++; if (!Number.isFinite(t)) bad.push("stop"); } }),
    createBufferSource: () => node({ buffer: null, loop: false, playbackRate: param("rate", 1), start(t, off) { started++; if (!Number.isFinite(off)) bad.push("offset"); }, stop() { stopped++; } }),
    createBuffer: (ch, len, rate) => ({ duration: len / rate, getChannelData: () => new Float32Array(len) }),
    createStereoPanner: () => node({ pan: param("pan") }),
  };
  const errs = [];
  for (const name of SOUND_NAMES) {
    try { VOICES[name].play(ctx, node(), 0.5, { gain: 1, pitch: 1, near: 0.8 }); } catch (e) { errs.push(`${name}: ${e.message}`); }
  }
  check(!errs.length, `all ${SOUND_NAMES.length} sounds build${errs.length ? `: ${errs.join("; ")}` : ""}`);
  check(!bad.length, `no NaN, no ramp to zero, nothing connected to nothing${bad.length ? `: ${bad.slice(0, 5).join(", ")}` : ""}`);
  check(started > 0 && stopped >= started - 0, `every source started is stopped (${started} started, ${stopped} stopped, ${nodes} nodes)`);
  check(SOUND_NAMES.every((n) => VOICES[n].dur > 0 && VOICES[n].dur < 6), "every sound says how long it rings (under 6 s)");
  const vo = AU.voiceOpts({ gain: undefined, delay: 0.1, pitch: undefined, near: 0.3 }), vo2 = AU.voiceOpts({ gain: 0.5, pitch: 1.2 });
  check(vo.gain === 1 && vo.pitch > 0.9 && vo.pitch < 1.1 && vo.near === 0.3 && vo2.gain === 0.5 && vo2.pitch === 1.2, "a cue with no gain plays at full gain, a few percent off pitch (an undefined gain is no NaN)");
}

// ---------- 9. the menu and help ----------
console.log("Menu and help");
{
  const html = soundOptionsHtml({ sound: { master: 0.5, sfx: 0.8, amb: 0.3, mute: false, muteBlur: true } });
  check(/<h3>Sound<\/h3>/.test(html) && (html.match(/type="range"/g) || []).length === 7 && /value="50"/.test(html) && /value="30"/.test(html) && /data-k="steps"/.test(html) && /max="150" step="5" value="100" data-action="snd-vol" data-k="guns"/.test(html), "the Sound section: five sliders (master, effects, gunfire, footsteps, ambience) at the saved levels (Gunfire 0–150%, 100% by default)");
  const g = soundOptions({ sound: { guns: 2 } }), g2 = soundOptions({ sound: { guns: 1.25 } }), g3 = soundOptions({ sound: {} });
  check(g.guns === 1.5 && g2.guns === 1.25 && g3.guns === 1 && g3.steps === 0.7 && g3.zombie === 1 && g3.horde === 0.7 && g.zombie === 1, "the Gunfire volume: kept up to 150%, clamped above, 100% when missing (footsteps 70%, zombies 100%, map hordes 70%)");
  check(/data-action="snd-opt" data-k="on"/.test(html) && /data-action="snd-opt" data-k="muteBlur"/.test(html) && /data-action="snd-test"/.test(html), "sound on / off, mute when not focused, Hear a sound");
  const { SETTINGS_ACTIONS, SETTINGS_CHANGE } = await import("../src/ui/settings.js");
  check(!!SETTINGS_ACTIONS["snd-opt"] && !!SETTINGS_CHANGE["snd-vol"] && !!SETTINGS_CHANGE["snd-pick"], "the menu knows the Sound actions");
  const { helpTopics } = await import("../src/ui/help.js");
  check(helpTopics().some((t) => t.id === "sound" && /Ambience/.test(t.html)) && /alarm bell/.test(soundHelp()), "Help has a Sound topic");
  const st = createWorld({ seed: 3, factionCount: 3 });
  let threw = "";
  try { audioFrame(st, { started: true }, 1000); } catch (e) { threw = e.message; }
  check(!threw, "audioFrame with no browser does nothing and does not throw");
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
