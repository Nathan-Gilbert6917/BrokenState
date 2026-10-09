// The sound mixer's groups (Settings → Sound): every sound the game makes belongs to one named group, and each group
// has a volume and an on/off switch. Groups nest one level (Zombies → Shrieks and roars); a child's level is its
// own × its parent's (Zombies 80% × Shrieks 50%). They sit under the three buses ui/audio.js keeps (Master, Effects,
// Ambience), which are not groups. UI only: nothing here touches the simulation or its dice, and nothing runs at
// import time (node tools import it).
//
//   groupGain(id)              the effective gain of a group: (volume²) × its parent's, 0 when it or its parent is off
//   groupOf(name, voice?)      the group of a sound by its name (a voice's own `group` field wins); null: none known
//   assignGroup(names, id)     put sounds in a group: one line for a new module, e.g.
//                                assignGroup(Object.keys(HUMAN_VOICES), "people.voices");
//   groupBus(c, id, dest)      a gain node on context c into dest that follows the group live (one per group, dest and
//                              context): for sounds that keep playing (wind, rain, a music bus)
//   applyGroups(t, now)        ramps every group bus to its group's gain (ui/audio.js applyGains calls it)
//   useMix(sound)              binds the mixer to the saved Sound options (sound.groups, sound.off)
//   cleanMix(sound)            the saved groups cleaned, old options migrated (soundOptions in ui/audio.js)
//   PRESETS, applyPreset(k), presetOf(), resetMix()
//
// A one-shot voice reads groupGain as it is made (a sound already ringing finishes at its level: they last seconds);
// a playing bed (the battle's crowd, the map's hordes and hive, wind and rain) follows a change at once, on a short ramp.

// ---------- the groups ----------
// id: parent.child; max: the slider's top (1.5 where loud sources want headroom); tip: what is in it.
export const GROUPS = [
  { id: "weapons", label: "Weapons", max: 1.5, tip: "Guns, explosions, reloads and melee blows in battle" },
  { id: "weapons.guns", label: "Gunfire", max: 1.5, tip: "Every gunshot, bow and crossbow, bullet hits, whizzes and ricochets" },
  { id: "weapons.blasts", label: "Explosions and grenades", max: 1.5, tip: "Grenades, pipe bombs, rockets, Molotovs, smoke and flares, a vehicle going up, the pin and the can clattering, the ears ringing after" },
  { id: "weapons.handling", label: "Reloads and handling", max: 1.5, tip: "Reloads, bolts and pumps worked, brass falling, dry clicks, jams and the slide locking back, a taser" },
  { id: "weapons.melee", label: "Melee hits and swings", max: 1.5, tip: "Blows by weapon and by what took them, swings that miss, the kill crunch" },
  { id: "zombies", label: "Zombies", max: 1.5, tip: "The dead: their voices in battle, the crowd of them, hordes and hives on the map" },
  { id: "zombies.moans", label: "Moans and idle", max: 1.5, tip: "Moans, gurgles and wheezes at rest, the silences between, sudden snarls, close breathing" },
  { id: "zombies.attacks", label: "Attacks, bites and death cries", max: 1.5, tip: "Lunges, bites, the dead hit and dying, a barricade or door pounded and smashed" },
  { id: "zombies.shrieks", label: "Shrieks and roars", max: 1.5, tip: "The screamer's call, a brute's roar, the shriek or snarl as one of them spots you" },
  { id: "zombies.special", label: "Special dead", max: 1.5, tip: "Spit and acid, a Carrier bursting, worms and the swarm, a Flinger's throw, a Climber on a wall, a crawler striking, a Sleeper waking, a Nightmare" },
  { id: "zombies.crowd", label: "Crowd murmur (battle)", max: 1.5, tip: "The murmur and shuffle of many dead in a battle, louder the more and nearer they are" },
  { id: "zombies.hordes", label: "Map hordes", max: 1.5, tip: "Hordes near your bases and teams moaning on the State Map (more at night). Under the Ambience volume" },
  { id: "zombies.hive", label: "Hive drone", max: 1.5, tip: "A known hive near you on the map: its low drone and heartbeat. Under the Ambience volume" },
  { id: "people", label: "People", max: 1.5, tip: "Your people and others: voices, footsteps, gear, someone going down" },
  { id: "people.voices", label: "Voices", max: 1.5, tip: "People's voices: hurt, crying out, going down, dying, effort, panting, coughs, shouts and taunts in battle; the chirp of an important combat bark" },
  { id: "people.steps", label: "Footsteps", max: 1.5, tip: "Everyone's footsteps in battle: yours, the enemy's, the dead's shuffle. By ground, gait and load" },
  { id: "people.gear", label: "Gear and small sounds", max: 1.5, tip: "Searching, locks and keys, fuel, bandages" },
  { id: "people.vehicles", label: "Vehicles", max: 1.5, tip: "Engines starting, idling, driven and switched off, breakdowns, car doors and tailgates, hotwiring; a convoy's hum on the map (ui/sfx-vehicles.js)" },
  { id: "people.doors", label: "Doors and gates", max: 1.5, tip: "Building doors opened, shut, tried, picked, forced and broken, the threshold of an open door; a base's gate on the map (ui/sfx-doors.js)" },
  { id: "people.downed", label: "Deaths and downed cues", max: 1.5, tip: "The fall and falling tone when one of your people goes down, the low chord when one dies" },
  { id: "world", label: "World", max: 1.5, tip: "The weather, wildlife and warnings around you. Under the Ambience volume" },
  { id: "world.weather", label: "Weather", max: 1.5, tip: "Wind, rain on roofs and leaves, storms and rolling thunder, snow, rivers and the creak of ice, the low drone at night" },
  { id: "world.wildlife", label: "Wildlife", max: 1.5, tip: "Songbirds, crows, owls and geese, frogs, cicadas and crickets, distant dogs, wolves and elk. They go quiet near danger" },
  { id: "world.base", label: "Base and camp", max: 1.5, tip: "The murmur of voices at a base you select on the map with people home (busiest at the evening meal, quiet at night), with a laugh now and then and a cough in winter" },
  { id: "world.heartbeat", label: "Heartbeat (edge warning)", max: 1.5, tip: "The soft heartbeat while a base of yours is attacked (Display → Heartbeat while a base is attacked)" },
  { id: "ui", label: "Interface", max: 1.5, tip: "Clicks, card chimes, alerts and stings" },
  { id: "ui.clicks", label: "Clicks and windows", max: 1.5, tip: "Button clicks, windows opening and closing, items picked up and put down" },
  { id: "ui.cards", label: "Card chimes", max: 1.5, tip: "The chime as a card comes up (routine, warning, crisis) and good news" },
  { id: "ui.stings", label: "Alerts and stings", max: 1.5, tip: "A new warning's bell, the raid alarm, the horde sting, a battle starting" },
  { id: "music", label: "Music", max: 1, tip: "The music (ui/music.js): made on the spot, following what is going on. 100% is its usual level" },
  { id: "music.stings", label: "Stings and phrases", max: 1.5, tip: "The music's short phrases over the score: a battle won or lost, the elegy when someone dies, a base lost" },
];
export const GROUP_IDS = GROUPS.map((g) => g.id);
const BY_ID = new Map(GROUPS.map((g) => [g.id, g]));
export const groupDef = (id) => BY_ID.get(id) || null;
export const parentOf = (id) => { const i = String(id).indexOf("."); return i > 0 ? String(id).slice(0, i) : null; };
export const TOP_GROUPS = GROUP_IDS.filter((id) => !parentOf(id));
export const childrenOf = (id) => GROUP_IDS.filter((c) => parentOf(c) === id);

// ---------- which sound is in which group ----------
// By name: ui/audio.js VOICES (with the voices of sfx-melee, sfx-steps, sfx-gear and edgefx), its throttle names (the
// cues the battle plays as guns, blasts and handling), ui/zombiesfx.js's cues, and the ambience layers. A voice can
// carry its own `group` instead; anything else falls to `prefix rules` below, and tools/soundmixtest.js fails on any
// name that lands nowhere.
export const SOUND_GROUP = {};
export function assignGroup(names, id) {
  if (!BY_ID.has(id)) throw new Error(`soundgroups: no group ${id}`);
  for (const n of [].concat(names)) SOUND_GROUP[n] = id;
  return id;
}
assignGroup(["pistol", "revolver", "rifle", "shotgun", "auto", "suppressed", "bow", "launcher", "rocket", "hit", "whiz", "ricochet", "gun"], "weapons.guns");
assignGroup(["blast", "fire", "glass", "hiss", "flare", "ring", "throw", "clatter"], "weapons.blasts");
assignGroup(["reload", "jam", "unjam", "dry", "empty", "taser", "brass", "hand"], "weapons.handling");
assignGroup(["melee", "meleeCrit", "whoosh", "hearPunch", "hearBat", "hearPipe", "hearBlade", "hearAxe", "hearSledge", "hearPlate", "hearHelmet"], "weapons.melee");
assignGroup(["zIdle", "zSnarl", "groan", "zBreath"], "zombies.moans");
assignGroup(["zAttack", "zBite", "zHurt", "zDeath", "zSmash", "zBash", "bite"], "zombies.attacks");
assignGroup(["zAggro", "zShriek", "scream"], "zombies.shrieks");
assignGroup(["zSpit", "zSizzle", "zStrike", "zBurst", "zWorms", "zHeave", "zFling", "zClimb", "zWake", "zStep", "acid"], "zombies.special");
assignGroup(["crowd"], "zombies.crowd");
assignGroup(["mapHorde"], "zombies.hordes");
assignGroup(["hive", "hiveBeat"], "zombies.hive");
assignGroup(["bark", "hDown", "hCry", "hDeath", "hShout", "hGasp", "hHurt", "hTaunt", "hEcstatic", "hDeaf", "hPlea", "hPanic", "hEffort", "hScared",
  "hPant", "hWheeze", "hCough", "hMuffled"], "people.voices"); // ui/humansfx.js HUMAN_CUES
assignGroup(["step", "hearStepGrass", "hearStepRoad", "hearStepWood", "hearStepGravel", "hearStepMud", "hearStepSnow", "hearStepLaden", "hearStepSneak",
  "hearStepWalker", "hearStepRunner", "hearStepBrute", "hearStepCrawler", "hearStepArmoured"], "people.steps");
assignGroup(["rummage", "lockRattle", "unlock", "jingle", "glug", "bandage", "tourniquet"], "people.gear"); // the vehicles' and the doors' names: ui/sfx-vehicles.js, ui/sfx-doors.js
assignGroup(["downed", "death"], "people.downed");
assignGroup(["wind", "rain", "rainLow", "drone", "thunder"], "world.weather");
assignGroup(["bird", "cricket"], "world.wildlife");
assignGroup(["murmur"], "world.base"); // ui/humansfx.js: a selected base's murmur, its laughs and coughs
assignGroup(["heartbeat"], "world.heartbeat");
assignGroup(["click", "uiOpen", "uiClose", "pickup", "putdown"], "ui.clicks");
assignGroup(["cardRoutine", "cardWarning", "cardCrisis", "good"], "ui.cards");
assignGroup(["alert", "alarm", "horde", "battle"], "ui.stings");
// Prefix rules for families that grow (a new zombie cue zSomething, a new human voice hSomething): checked after the
// table. A rule maps to the parent when the child cannot be told from the name.
export const PREFIX_GROUP = [[/^z[A-Z]/, "zombies"], [/^h[A-Z]/, "people.voices"], [/^music/, "music"]];
export function groupOf(name, voice = null) {
  if (voice && voice.group && BY_ID.has(voice.group)) return voice.group;
  if (SOUND_GROUP[name]) return SOUND_GROUP[name];
  for (const [re, id] of PREFIX_GROUP) if (re.test(String(name))) return id;
  return null;
}

// ---------- the mix ----------
// vol: id -> slider value (0..max, 1 the default); off: id -> true when switched off. useMix binds these to the saved
// options so the sliders, the save and the sounds share one object.
export const MIX = { vol: {}, off: {} };
const num = (v, d, max) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Number(v))) : d);
export function groupVolume(id) { const g = BY_ID.get(id); return g ? num(MIX.vol[id], 1, g.max) : 1; }
export const groupOn = (id) => !MIX.off[id];
// The gain of a slider value (squared, like ui/audio.js's other sliders: the low half stays usable).
export const volGain = (v) => v * v;
export function groupGain(id) {
  if (!id || !BY_ID.has(id)) return 1;
  const own = groupOn(id) ? volGain(groupVolume(id)) : 0;
  const p = parentOf(id);
  return p ? own * groupGain(p) : own;
}
export const soundGain = (name, voice = null) => groupGain(groupOf(name, voice));
export function setGroupVolume(id, v) {
  const g = BY_ID.get(id);
  if (!g) return false;
  MIX.vol[id] = Math.round(num(v, 1, g.max) * 100) / 100;
  return true;
}
export function setGroupOn(id, on) {
  if (!BY_ID.has(id)) return false;
  if (on) delete MIX.off[id]; else MIX.off[id] = true;
  return true;
}

// The saved form (options.sound.groups and options.sound.off) cleaned; an old save (no groups yet) migrated from its
// Gunfire, Zombies, Map hordes and Footsteps sliders with the same loudness for every sound:
//   guns g     → Gunfire, Explosions and grenades, Reloads and handling at g (the old slider drove all three)
//   zombie z   → Zombies at z; the Hive drone at 1/z (it was not under the old Zombie slider), capped at 150%
//   horde h    → Map hordes at h / 0.7 (the old 70% default is the new 100%)
//   steps s    → Footsteps at s / 0.7 (likewise)
export const OLD_DEFAULTS = { guns: 1, zombie: 1, horde: 0.7, steps: 0.7 };
export function migrateOld(s = {}) {
  const old = (k, max) => num(s[k], OLD_DEFAULTS[k], max);
  const g = old("guns", 1.5), z = old("zombie", 1.5), h = old("horde", 1), st = old("steps", 1);
  const vol = {};
  for (const id of ["weapons.guns", "weapons.blasts", "weapons.handling"]) if (g !== 1) vol[id] = g;
  if (z !== 1) { vol.zombies = z; if (z > 0) vol["zombies.hive"] = Math.min(1.5, 1 / z); }
  if (h !== OLD_DEFAULTS.horde) vol["zombies.hordes"] = h / OLD_DEFAULTS.horde;
  if (st !== OLD_DEFAULTS.steps) vol["people.steps"] = st / OLD_DEFAULTS.steps;
  return vol;
}
export function cleanMix(s = {}) {
  const src = s.groups && typeof s.groups === "object" ? s.groups : migrateOld(s);
  const groups = {}, off = {};
  for (const g of GROUPS) {
    const v = num(src[g.id], 1, g.max);
    if (v !== 1) groups[g.id] = v;
  }
  if (s.off && typeof s.off === "object") for (const id of Object.keys(s.off)) if (BY_ID.has(id) && s.off[id]) off[id] = true;
  return { groups, off };
}
export function useMix(sound) {
  if (!sound) return MIX;
  if (!sound.groups || typeof sound.groups !== "object") sound.groups = {};
  if (!sound.off || typeof sound.off !== "object") sound.off = {};
  MIX.vol = sound.groups;
  MIX.off = sound.off;
  return MIX;
}

// ---------- presets ----------
// Each sets every group's volume (unlisted ones to 100%); the on/off switches are kept.
export const PRESETS = {
  default: { label: "Default", tip: "Every group at 100%", vol: {} },
  quietZombies: { label: "Quieter zombies", tip: "The dead about 5 dB down, their shrieks a little more", vol: { zombies: 0.75, "zombies.shrieks": 0.85 } },
  combat: { label: "Focus on combat", tip: "Guns and the dead up front: the weather, wildlife, map hordes and the interface low", vol: { weapons: 1.1, world: 0.5, ui: 0.5, "zombies.hordes": 0.6, "zombies.hive": 0.6 } },
  atmosphere: { label: "Atmosphere", tip: "The world and the dead up, the interface low", vol: { world: 1.25, zombies: 1.15, "zombies.crowd": 1.15, "zombies.hordes": 1.2, "zombies.hive": 1.2, ui: 0.6, "people.steps": 1.1 } },
  hushUi: { label: "Hush the interface", tip: "Clicks and chimes quiet; the alarms and stings still heard", vol: { "ui.clicks": 0.35, "ui.cards": 0.55, "ui.stings": 0.9 } },
};
export function applyPreset(key) {
  const P = PRESETS[key];
  if (!P) return false;
  for (const id of Object.keys(MIX.vol)) delete MIX.vol[id];
  for (const [id, v] of Object.entries(P.vol)) setGroupVolume(id, v);
  return true;
}
// The preset the volumes match (null: a mix of your own).
export function presetOf() {
  for (const [k, P] of Object.entries(PRESETS)) if (GROUP_IDS.every((id) => Math.abs(groupVolume(id) - (P.vol[id] ?? 1)) < 0.005)) return k;
  return null;
}
export function resetMix() {
  for (const id of Object.keys(MIX.vol)) delete MIX.vol[id];
  for (const id of Object.keys(MIX.off)) delete MIX.off[id];
}

// ---------- live gain nodes ----------
// One per (context, group, destination), made once: a bed or a bus that keeps playing goes through it and follows a
// change at once. Contexts that are closed (an offline render done) are let go on the next apply.
const BUSES = new Map(); // context -> Map(`${id}` -> [{ dest, node }])
export function groupBus(c, id, dest) {
  let m = BUSES.get(c);
  if (!m) { m = new Map(); BUSES.set(c, m); }
  let list = m.get(id);
  if (!list) { list = []; m.set(id, list); }
  const hit = list.find((x) => x.dest === dest);
  if (hit) return hit.node;
  const node = c.createGain();
  node.gain.value = groupGain(id);
  node.connect(dest);
  list.push({ dest, node });
  return node;
}
export const RAMP = 0.06; // s: the time constant a group change ramps over (no clicks)
export function applyGroups(t = null, now = false) {
  for (const [c, m] of BUSES) {
    if (c.state === "closed") { BUSES.delete(c); continue; }
    const at = t ?? c.currentTime;
    for (const [id, list] of m) {
      const g = groupGain(id);
      for (const { node } of list) {
        if (now) node.gain.setValueAtTime(g, at);
        else node.gain.setTargetAtTime(g, at, RAMP);
      }
    }
  }
}
export const busCount = () => [...BUSES.values()].reduce((s, m) => s + [...m.values()].reduce((a, l) => a + l.length, 0), 0);
