// The sound mixer (ui/soundgroups.js, Settings → Sound in ui/audio.js): headless checks with no speakers.
// - The registry: every group has a label, a slider top, a parent that exists; the hierarchy's maths (a child × its
//   parent, squared sliders, off is 0, the Music group the music bus plays through (with its Stings part).
// - Every sound is in a group: every name the modules register (ui/audio.js VOICES and its throttle LIMITS, the gun
//   voices, handling and blasts of gunsfx/blastsfx, the dead's cues, the people's cues, the melee, step and gear kits,
//   the edge heartbeat, the ambience's beds) maps to a group by name, not by a fallback.
// - Old saved options (Gunfire, Zombies, Map hordes, Footsteps sliders) migrate with the same effective gain for every
//   sound, computed the old way and the new way and compared.
// - The presets, mute and on/off, reset, save and load through the options store.
// - The modules honour their group: a gun, a reload, a blast, a zombie's voice, a person's voice built on a stub
//   context at the group's gain, nothing built with the group off.
// - Live: in a faked browser, ui/audio.js plays through the group as each sound is made, and a change ramps the
//   group buses and the crowd bed (setTargetAtTime, no jump).
// Usage: node tools/soundmixtest.js
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// A stub AudioContext that keeps every node and every call on its params.
function stub() {
  const gains = [], calls = [];
  const param = (name, v = 0) => {
    const p = { value: v, name, calls: [] };
    for (const m of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime", "cancelScheduledValues"]) p[m] = (...a) => { p.calls.push([m, ...a]); calls.push([name, m, ...a]); return p; };
    return p;
  };
  const node = (extra = {}) => ({ connect(d) { return d; }, disconnect() {}, ...extra });
  const src = (extra) => node({ start() {}, stop() {}, ...extra });
  const ctx = {
    sampleRate: 8000, currentTime: 0, state: "running", destination: node(),
    resume: () => Promise.resolve(), suspend: () => Promise.resolve(),
    createGain: () => { const g = node({ gain: param("gain", 1) }); gains.push(g); return g; },
    createBiquadFilter: () => node({ type: "", frequency: param("freq", 350), Q: param("Q", 1) }),
    createOscillator: () => src({ type: "", frequency: param("osc", 440), setPeriodicWave() {} }),
    createBufferSource: () => src({ buffer: null, loop: false, playbackRate: param("rate", 1) }),
    createBuffer: (ch, len, rate) => { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { duration: len / rate, numberOfChannels: ch, getChannelData: (i) => d[i], copyToChannel(a, i) { d[i].set(a); } }; },
    createStereoPanner: () => node({ pan: param("pan") }),
    createWaveShaper: () => node({ curve: null, oversample: "none" }),
    createConvolver: () => node({ buffer: null }),
    createPeriodicWave: () => ({}),
    createDelay: () => node({ delayTime: param("delay", 0) }),
    createDynamicsCompressor: () => node({ threshold: param("thr", -24), knee: param("knee", 30), ratio: param("ratio", 12), attack: param("att", 0.003), release: param("rel", 0.25), reduction: 0 }),
  };
  return { ctx, gains, calls };
}

const SG = await import("../src/ui/soundgroups.js");
const AU = await import("../src/ui/audio.js");
const MU = await import("../src/ui/music.js"); // the music's names (its bus goes through the Music group)
const G = await import("../src/ui/gunsfx.js");
const B = await import("../src/ui/blastsfx.js");
const Z = await import("../src/ui/zombiesfx.js");
const H = await import("../src/ui/humansfx.js");
let EDGE = null;
try { EDGE = await import("../src/ui/edgefx.js"); } catch { EDGE = null; } // adds the heartbeat voice (needs the battle view: may not load in node)

// ---------- 1. the registry and the hierarchy ----------
console.log("Registry");
{
  const ids = SG.GROUP_IDS;
  check(ids.length === new Set(ids).size && SG.GROUPS.every((g) => g.label && g.max > 0 && (!SG.parentOf(g.id) || ids.includes(SG.parentOf(g.id)))), `${ids.length} groups, ids unique, each with a label and a slider top, every child's parent a group`);
  check(JSON.stringify(SG.TOP_GROUPS) === JSON.stringify(["weapons", "zombies", "people", "world", "ui", "music"]), `the top groups: ${SG.TOP_GROUPS.join(", ")}`);
  const want = {
    weapons: ["guns", "blasts", "handling", "melee"], zombies: ["moans", "attacks", "shrieks", "special", "crowd", "hordes", "hive"],
    people: ["voices", "steps", "gear", "downed"], world: ["weather", "wildlife", "heartbeat"], ui: ["clicks", "cards", "stings"], music: ["stings"],
  };
  check(Object.entries(want).every(([p, kids]) => JSON.stringify(SG.childrenOf(p)) === JSON.stringify(kids.map((k) => `${p}.${k}`))), "each group's parts as asked (Weapons 4, Zombies 7, People 4, World 3, Interface 3, Music 1)");
  check(!SG.groupDef("music").reserved && SG.groupDef("music").max === 1 && SG.groupDef("music.stings").max === 1.5, "Music: the music bus plays through it (no longer reserved; its slider 0–100%, 100% the usual level), with a Stings and phrases part");
  SG.useMix({ groups: {}, off: {} });
  check(ids.every((id) => SG.groupGain(id) === 1), "at the defaults every group's gain is 1");
  SG.setGroupVolume("zombies", 0.8); SG.setGroupVolume("zombies.shrieks", 0.5);
  check(near(SG.groupGain("zombies.shrieks"), 0.64 * 0.25) && near(SG.groupGain("zombies"), 0.64) && near(SG.groupGain("zombies.moans"), 0.64), "a child × its parent, squared sliders: Zombies 80% × Shrieks 50% = 0.64 × 0.25");
  SG.setGroupVolume("weapons.guns", 9);
  check(SG.groupVolume("weapons.guns") === 1.5 && near(SG.groupGain("weapons.guns"), 2.25) && SG.setGroupVolume("nope", 1) === false && SG.groupGain("nope") === 1 && SG.groupGain(null) === 1, "clamped at the group's top (150%: × 2.25); an unknown group is no group");
  SG.setGroupOn("zombies", false);
  check(SG.groupGain("zombies.moans") === 0 && SG.groupGain("zombies") === 0 && SG.groupVolume("zombies.moans") === 1, "a parent off silences its parts and keeps their volumes");
  SG.setGroupOn("zombies", true); SG.setGroupOn("zombies.moans", false);
  check(SG.groupGain("zombies.moans") === 0 && near(SG.groupGain("zombies.attacks"), 0.64), "a part off is silent alone");
  SG.resetMix();
  check(ids.every((id) => SG.groupGain(id) === 1 && SG.groupOn(id)), "Reset to defaults: every group at 100% and on");
}

// ---------- 2. every sound in a group ----------
console.log("Every sound in a group");
{
  const explicit = (name, voice) => (voice && voice.group) || SG.SOUND_GROUP[name] || null;
  const lists = {
    "audio.js VOICES": Object.keys(AU.VOICES),
    "audio.js LIMITS (throttle names)": Object.keys(AU.LIMITS),
    "gunsfx GUN_VOICES": Object.keys(G.GUN_VOICES).map((k) => `gun:${k}`),
    "gunsfx HANDLING": Object.keys(G.HANDLING).map((k) => `hand:${k}`),
    "blastsfx BLASTS": Object.keys(B.BLASTS).map((k) => `blast:${k}`),
    "zombiesfx cues": [...Z.ZOMBIE_SOUND_NAMES, ...Object.keys(Z.ZOMBIE_LIMITS), ...Object.keys(Z.Z_PRIORITY)],
    "humansfx cues": [...H.HUMAN_SOUND_NAMES, ...Object.keys(H.HUMAN_LIMITS), ...Object.keys(H.H_PRIORITY)],
    "ambience beds": [...Object.keys(AU.AMB_LEVELS), "crowd", "mapHorde", "hive", "murmur"],
    "edge heartbeat": ["heartbeat"],
    "music.js names": MU.MUSIC_SOUND_NAMES,
  };
  for (const [what, names] of Object.entries(lists)) {
    const miss = [...new Set(names)].filter((n) => !explicit(n, AU.VOICES[n]) || !SG.groupDef(explicit(n, AU.VOICES[n])));
    check(names.length > 0 && !miss.length, `${what}: ${new Set(names).size} names, each in a group${miss.length ? ` (missing: ${miss.join(", ")})` : ""}`);
  }
  check(!EDGE || !!AU.VOICES.heartbeat, `the edge heartbeat voice ${EDGE ? "registered" : "(edgefx not loadable in node: checked by name)"}`);
  const counts = {};
  const all = new Set(Object.values(lists).flat());
  for (const n of all) { const g = explicit(n, AU.VOICES[n]); counts[g] = (counts[g] || 0) + 1; }
  check(SG.GROUP_IDS.filter((id) => SG.parentOf(id)).every((id) => counts[id] > 0), `every part has sounds: ${SG.GROUP_IDS.filter((id) => SG.parentOf(id)).map((id) => `${id} ${counts[id] || 0}`).join(", ")}`);
  check(SG.groupOf("zSomethingNew") === "zombies" && SG.groupOf("hNewVoice") === "people.voices" && SG.groupOf("musicStinger") === "music" && SG.groupOf("whatever") === null, "a new zombie cue falls to Zombies, a new human voice to Voices, music's to Music (the table first)");
  SG.assignGroup(["zTestOnly"], "zombies.special");
  let threw = false; try { SG.assignGroup(["x"], "no.such"); } catch { threw = true; }
  check(SG.groupOf("zTestOnly") === "zombies.special" && threw && SG.groupOf("q", { group: "ui.cards" }) === "ui.cards", "assignGroup puts sounds in a group in one line (an unknown group throws); a voice's own group wins");
  delete SG.SOUND_GROUP.zTestOnly;
  check(SG.GROUP_IDS.every((id) => AU.GROUP_PREVIEW[id]), "every group has a ▶ preview (Music and its Stings: a short phrase over the music)");
}

// ---------- 3. migration: the same loudness ----------
console.log("Migration");
{
  // The old effective gains (ui/audio.js before the mixer): sliders squared; footsteps (s/0.7)²; guns g² on guns,
  // handling and blasts; the dead's voices and crowd z²; map hordes (h/0.7)² × z²; the hive under nothing; the rest 1.
  const oldGain = (o, sound) => {
    const g = (o.guns ?? 1) ** 2, z = (o.zombie ?? 1) ** 2, h = ((o.horde ?? 0.7) / 0.7) ** 2, st = ((o.steps ?? 0.7) / 0.7) ** 2;
    if (/^(gun|hand|blast):|^(weapons\.(guns|blasts|handling))$/.test(sound)) return g;
    if (sound === "zombies.hordes") return h * z;
    if (sound === "zombies.hive") return 1;
    if (sound.startsWith("zombies.")) return z;
    if (sound === "people.steps") return st;
    return 1;
  };
  const cases = [{}, { guns: 1.5 }, { guns: 0.4, zombie: 1.3 }, { zombie: 0.8, horde: 1 }, { steps: 0, horde: 0.2 }, { steps: 1, guns: 0, zombie: 1.5, horde: 0.9 }, { zombie: 0.7 }];
  const parts = SG.GROUP_IDS.filter((id) => SG.parentOf(id) && id !== "music");
  let worst = 0, where = "";
  for (const o of cases) {
    const s = AU.soundOptions({ sound: { master: 0.6, sfx: 0.9, amb: 0.4, ...o } });
    SG.useMix(s);
    for (const id of parts) { const d = Math.abs(SG.groupGain(id) - oldGain(o, id)); if (d > worst) { worst = d; where = `${JSON.stringify(o)} ${id}: ${SG.groupGain(id)} vs ${oldGain(o, id)}`; } }
    check(s.master === 0.6 && s.sfx === 0.9 && s.amb === 0.4 && !("guns" in s) && !("zombie" in s) && !("horde" in s) && !("steps" in s), `${JSON.stringify(o)}: the buses kept, the old keys dropped (groups ${JSON.stringify(s.groups)})`);
  }
  check(worst < 1e-9, `every part's gain the same as before for ${cases.length} old saves (worst difference ${worst.toExponential(1)}${where ? `: ${where}` : ""})`);
  const low = AU.soundOptions({ sound: { zombie: 0.5 } });
  SG.useMix(low);
  check(near(SG.groupGain("zombies.hive"), 2.25 * 0.25) && near(SG.groupGain("zombies.moans"), 0.25), "the one approximation: an old Zombie volume under 67% leaves the Hive drone a little lower than before (its compensation stops at 150%)");
  const kept = AU.soundOptions({ sound: { guns: 1.5, groups: { "weapons.guns": 0.5 } } });
  check(kept.groups["weapons.guns"] === 0.5 && !kept.groups["weapons.blasts"], "a save that has groups keeps them (the old keys are not read again)");
  const bad = AU.soundOptions({ sound: { groups: { "weapons.guns": 7, zombies: -1, nope: 0.3, music: 4 }, off: { ui: true, fake: true, people: false } } });
  check(bad.groups["weapons.guns"] === 1.5 && bad.groups.zombies === 0 && !("nope" in bad.groups) && !("music" in bad.groups) && JSON.stringify(bad.off) === '{"ui":true}', `bad saved values clamped (Music tops at 100%), unknown groups dropped (${JSON.stringify(bad.groups)}, off ${JSON.stringify(bad.off)})`);
  SG.useMix({ groups: {}, off: {} });
}

// ---------- 4. presets ----------
console.log("Presets");
{
  const mix = SG.useMix({ groups: {}, off: {} });
  check(Object.keys(SG.PRESETS).join() === "default,quietZombies,combat,atmosphere,hushUi" && SG.presetOf() === "default", "five presets; the defaults read as Default");
  SG.setGroupOn("ui.clicks", false);
  SG.applyPreset("quietZombies");
  check(SG.presetOf() === "quietZombies" && SG.groupGain("zombies.moans") < 0.6 && SG.groupGain("zombies.shrieks") < SG.groupGain("zombies.moans") && SG.groupGain("weapons.guns") === 1, `Quieter zombies: the dead ${(20 * Math.log10(SG.groupGain("zombies.moans"))).toFixed(1)} dB, shrieks ${(20 * Math.log10(SG.groupGain("zombies.shrieks"))).toFixed(1)} dB, the guns as they were`);
  check(!SG.groupOn("ui.clicks"), "a preset keeps the On switches");
  SG.applyPreset("combat");
  check(SG.groupGain("world.weather") < 0.3 && SG.groupGain("ui.cards") < 0.3 && SG.groupGain("weapons.guns") > 1 && SG.groupGain("zombies.hordes") < 0.4, "Focus on combat: the world and the interface low, weapons up a touch, map hordes low");
  SG.applyPreset("atmosphere");
  check(SG.groupGain("world.wildlife") > 1.5 && SG.groupGain("zombies.crowd") > 1.3 && SG.groupGain("ui.clicks") < 0.4, "Atmosphere: the world and the dead up, the interface low");
  SG.applyPreset("hushUi");
  check(SG.groupGain("ui.clicks") < 0.15 && SG.groupGain("ui.cards") < 0.35 && SG.groupGain("ui.stings") > 0.75 && SG.groupGain("zombies") === 1, "Hush the interface: clicks and chimes quiet, the alarms still heard, the rest untouched");
  SG.setGroupVolume("people.gear", 0.3);
  check(SG.presetOf() === null && SG.applyPreset("nope") === false, "a change of your own reads as Custom; an unknown preset does nothing");
  SG.applyPreset("default");
  check(SG.presetOf() === "default" && Object.keys(mix.vol).length === 0, "Default clears every volume");
  SG.resetMix();
}

// ---------- 5. the modules honour their group ----------
console.log("Modules");
{
  SG.useMix({ groups: {}, off: {} });
  const S = stub();
  G.installBus(S.ctx, S.ctx.createGain());
  const outGain = (fn) => { const n = S.gains.length; fn(); return S.gains.slice(n); };
  const head = (fn) => outGain(fn)[0].gain.value; // spatialOut's level node is the first gain each makes
  const plan = G.labPlan("pistol"), sp = G.place({ dist: 2 });
  const g1 = head(() => G.playGun(S.ctx, 0, plan, sp));
  SG.setGroupVolume("weapons.guns", 1.5);
  const g15 = head(() => G.playGun(S.ctx, 0, plan, sp));
  SG.setGroupVolume("weapons", 0.5);
  const gHalf = head(() => G.playGun(S.ctx, 0, plan, sp));
  check(near(g1, G.GUN_TRIM) && near(g15, G.GUN_TRIM * 2.25) && near(gHalf, G.GUN_TRIM * 2.25 * 0.25), `a gun at Gunfire × Weapons (${g1.toFixed(3)}, at 150% ${g15.toFixed(3)}, under Weapons 50% ${gHalf.toFixed(3)})`);
  SG.resetMix();
  SG.setGroupVolume("weapons.handling", 0.5);
  const h = head(() => G.playHand(S.ctx, 0, { kind: "reload", rel: "rifle", n: 3 }, sp));
  const pin = head(() => G.playHand(S.ctx, 0, { kind: "throw", h: "pin" }, sp));
  check(near(h, G.GUN_TRIM * G.HAND_LEVEL * 0.25) && near(pin, G.GUN_TRIM * G.HAND_LEVEL), "a reload at Reloads and handling; a grenade's pin at Explosions and grenades");
  SG.resetMix();
  SG.setGroupVolume("weapons.blasts", 0.5);
  const bl = head(() => B.playBlast(S.ctx, 0, { kind: "frag" }, G.place({ dist: 0 })));
  check(near(bl, B.BLAST_TRIM * 0.25), `a blast at Explosions and grenades (${bl.toFixed(3)})`);
  SG.resetMix();
  const zv = (ev, kind, o = {}) => outGain(() => Z.playZombie(ev, S.ctx, S.ctx.createGain(), 0, { kind, seed: 7, dist: 0, ...o }));
  const zIdle = zv("idle", "walker"), zIdleG = zIdle[1].gain.value; // [0] the out passed in, [1] spatialOut's level
  SG.setGroupVolume("zombies.moans", 0.5);
  const zIdle2 = zv("idle", "walker")[1].gain.value;
  SG.setGroupOn("zombies.shrieks", false);
  const shriek = zv("shriek", "screamer");
  check(near(zIdle2 / zIdleG, 0.25) && shriek.length === 1, `the dead's voices at their event's group (a moan at 50%: × ${(zIdle2 / zIdleG).toFixed(2)}); Shrieks off: no nodes built`);
  SG.resetMix();
  const hv = (o = {}) => outGain(() => H.playHuman("hHurt", S.ctx, S.ctx.createGain(), 0, { voice: H.humanVoice({ id: 3, side: "player" }), dist: 0, ...o }));
  const hu1 = hv()[1].gain.value;
  SG.setGroupVolume("people", 0.5);
  const hu2 = hv()[1].gain.value;
  SG.setGroupOn("people.voices", false);
  const hu0 = hv();
  check(near(hu2 / hu1, 0.25) && hu0.length === 1, "a person's voice at People → Voices (People 50%: × 0.25); Voices off: nothing built");
  SG.resetMix();
  // The crowd bed and the map layer: a gain they are handed, ramped.
  const zb = Z.makeZombieBus(S.ctx, S.ctx.createGain());
  zb.setGain(0.25, 1);
  const last = zb.input.gain.calls[zb.input.gain.calls.length - 1];
  check(last[0] === "setTargetAtTime" && near(last[1], Z.ZOMBIE_BUS_GAIN * 0.25) && last[3] > 0 && last[3] < 0.2, "the crowd bed: the Crowd murmur gain on a short ramp");
  const lay = Z.makeMapLayer(S.ctx, S.ctx.createGain(), 0);
  lay.update({ horde: 1, hive: 1, near: 1, size: 100, big: 1, night: 0, close: 1 }, 1, 0.5, 0);
  check(near(lay.level, Z.MAP_LEVELS.horde * 0.5) && S.calls.some((c) => c[0] === "gain" && c[1] === "setTargetAtTime" && c[2] === 0), "the map layer: hordes at the Map hordes gain, the hive's drone and heartbeat at the Hive drone gain (0: silent)");
}

// ---------- 6. live in a faked browser; save and load ----------
console.log("Live, save and load");
{
  const S = stub();
  const on = {};
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.window = { AudioContext: function AC() { return S.ctx; }, addEventListener: (ev, f) => { (on[ev] ||= []).push(f); } };
  globalThis.document = { hidden: false, hasFocus: () => true, addEventListener: (ev, f) => { (on["doc:" + ev] ||= []).push(f); }, getElementById: () => null };
  const { loadOptions, saveOptions } = await import("../src/ui/saves.js");
  const opts = loadOptions();
  opts.sound = { master: 0.7, sfx: 0.8, amb: 0.5, guns: 1.2, zombie: 0.9, horde: 0.7, steps: 0.7 }; // an old save's options
  let saves = 0;
  AU.initAudio(opts, () => { saves++; saveOptions(opts); });
  for (const f of on.pointerdown || []) f({}); // the first gesture makes the context
  check(!!AU.audioDebug.ctx && near(opts.sound.groups["weapons.guns"], 1.2) && opts.sound.groups.zombies === 0.9 && !("guns" in opts.sound), "the game's options migrate as the sound starts; the context is made on the first gesture");
  // A sound is made at its group's gain.
  const seen = [];
  const keep = AU.VOICES.click.play;
  AU.VOICES.click.play = (c, out, t, o) => seen.push(o.gain);
  AU.sfx("click");
  AU.SOUND_CHANGE["snd-grp"](null, null, { dataset: { g: "ui.clicks" }, value: "50", blur() {} });
  S.ctx.currentTime += 1; // past the click's throttle
  AU.sfx("click");
  AU.SOUND_CHANGE["snd-gon"](null, null, { dataset: { g: "ui" }, checked: false });
  const off = AU.sfx("click");
  AU.SOUND_CHANGE["snd-gon"](null, null, { dataset: { g: "ui" }, checked: true });
  AU.VOICES.click.play = keep;
  check(seen.length === 2 && near(seen[0], 1) && near(seen[1], 0.25) && off === false, `sfx plays at the group's gain as it is made (click ${seen.map((x) => x.toFixed(2)).join(" → ")}); Interface off: not played`);
  // Live: a group change ramps the group buses (Weather) and the crowd bed.
  S.calls.length = 0;
  AU.SOUND_CHANGE["snd-grp"](null, null, { dataset: { g: "world.weather" }, value: "60", blur() {} });
  AU.SOUND_CHANGE["snd-grp"](null, null, { dataset: { g: "zombies.crowd" }, value: "80", blur() {} });
  const tg = S.calls.filter((c) => c[0] === "gain" && c[1] === "setTargetAtTime");
  const jumps = S.calls.filter((c) => c[0] === "gain" && c[1] === "setValueAtTime" && (near(c[2], 0.36) || near(c[2], Z.ZOMBIE_BUS_GAIN * 0.64 * 0.81))); // (the ▶ sounds the sliders play have their own envelopes)
  check(tg.some((c) => near(c[2], 0.36)) && tg.some((c) => near(c[2], Z.ZOMBIE_BUS_GAIN * 0.64 * 0.81)) && tg.every((c) => c[4] > 0) && !jumps.length, "live: Weather's bus ramps to 0.36, the crowd bed to its new gain (Crowd 80% × Zombies 90%), no jumps");
  check(saves >= 4, `each change saved (${saves} saves)`);
  // Save and load: the store has the groups; a reload brings them back.
  const back = loadOptions();
  const s2 = AU.soundOptions(back);
  check(near(s2.groups["world.weather"], 0.6) && near(s2.groups["zombies.crowd"], 0.8) && near(s2.groups["ui.clicks"], 0.5) && near(s2.groups["weapons.guns"], 1.2) && JSON.stringify(s2.off) === "{}", `saved and loaded with the other options (${JSON.stringify(s2.groups)})`);
  // A preset, then reset.
  AU.SOUND_CHANGE["snd-preset"](null, null, { value: "hushUi" });
  check(SG.presetOf() === "hushUi" && near(opts.sound.groups["ui.clicks"], 0.35), "a preset from the menu sets the mix and saves it");
  opts.sound.master = 0.2;
  AU.SOUND_CHANGE["snd-gon"](null, null, { dataset: { g: "people.steps" }, checked: false });
  AU.SOUND_ACTIONS["snd-reset"]();
  check(opts.sound.master === AU.SOUND_DEFAULTS.master && JSON.stringify(opts.sound.groups) === "{}" && JSON.stringify(opts.sound.off) === "{}" && SG.groupGain("people.steps") === 1, "Reset to defaults: the buses and every group back, every group on");
  // The menu: short, then the advanced mixer.
  const short = AU.soundOptionsHtml(opts);
  AU.SOUND_ACTIONS["snd-mix"]();
  const adv = AU.soundOptionsHtml(opts);
  AU.SOUND_ACTIONS["snd-mix"]();
  const rows = (h) => (h.match(/class="sndrow/g) || []).length;
  check(rows(short) === 3 + SG.TOP_GROUPS.length && rows(adv) === 3 + SG.GROUP_IDS.length && /data-action="snd-preset"/.test(short) && /data-action="snd-reset"/.test(short) && /Advanced mixer/.test(short), `the panel: ${rows(short)} rows (Master, Effects, Ambience, the top groups), a Mix preset list, Reset; the Advanced mixer ${rows(adv)} rows`);
  check((adv.match(/data-action="snd-gon"/g) || []).length === SG.GROUP_IDS.length && (adv.match(/data-action="snd-prev"/g) || []).length === SG.GROUP_IDS.length && !/aria-label="Music" disabled/.test(adv), "the Advanced mixer: an On box and ▶ on every group, the Music slider live");
  let errs = 0;
  const warn = console.warn; console.warn = () => { errs++; };
  for (const id of SG.GROUP_IDS) AU.SOUND_ACTIONS["snd-prev"](null, null, { g: id });
  console.warn = warn;
  check(errs === 0, `every group's ▶ plays without an error on the stub (${SG.GROUP_IDS.length} groups)`);
  delete globalThis.window; delete globalThis.document; delete globalThis.localStorage;
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
