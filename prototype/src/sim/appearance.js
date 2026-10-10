// Survivor looks: pure data + helpers (no DOM). The sprite renderer in ui/sprites.js draws from this.
// Appearance never touches state.rng, so the same seed still builds the same world.
import { Rng } from "./rng.js";
import { FIRST_NAMES, LAST_NAMES, SKILLS } from "./data.js";

export const SKIN_TONES = ["#f6d7c3", "#eac3a2", "#d9a37c", "#c08a5f", "#a06e46", "#7d5233", "#5c3a24", "#3f281a"];
export const HAIR_COLORS = ["#1d1a17", "#3b2a1e", "#6b4526", "#9a6a3a", "#c9a25a", "#e3cf8f", "#a9442a", "#8a8a8a", "#e8e4dc", "#3c5a8a"];
export const CLOTH_COLORS = ["#3d4a5c", "#5a6b3a", "#7a3b32", "#8a6a3a", "#2f2f33", "#6d6f73", "#b8a77a", "#2e5e6b", "#6b3f6b", "#a4552b", "#c9c2b0", "#33533b"];
export const PANTS_COLORS = ["#2b3442", "#3a3a3a", "#4f4a3a", "#5b4632", "#36452e", "#6a6656", "#22252b", "#4a5a6a"];

export const LOOK_OPTIONS = {
  build:     { name: "Build",     values: [["slim", "Slim"], ["average", "Average"], ["heavy", "Heavy"]] },
  hairStyle: { name: "Hair",      values: [["bald", "Bald"], ["buzz", "Buzz cut"], ["short", "Short"], ["long", "Long"], ["ponytail", "Ponytail"], ["mohawk", "Mohawk"], ["curly", "Curly"]] },
  facial:    { name: "Face",      values: [["none", "Clean"], ["stubble", "Stubble"], ["beard", "Beard"], ["stache", "Moustache"]] },
  topStyle:  { name: "Top",       values: [["tshirt", "T-shirt"], ["jacket", "Jacket"], ["hoodie", "Hoodie"], ["flannel", "Flannel"], ["tank", "Tank top"]] },
  accessory: { name: "Accessory", values: [["none", "None"], ["cap", "Cap"], ["beanie", "Beanie"], ["bandana", "Bandana"], ["glasses", "Glasses"], ["headband", "Headband"], ["backpack", "Backpack"]] },
};
export const LOOK_COLORS = {
  skin: { name: "Skin", palette: SKIN_TONES },
  hair: { name: "Hair color", palette: HAIR_COLORS },
  top: { name: "Top color", palette: CLOTH_COLORS },
  pants: { name: "Pants", palette: PANTS_COLORS },
  accent: { name: "Accessory color", palette: ["#b8322a", "#2d5fa8", "#d9b23a", "#3f7a3a", "#1f1f22", "#d97a2b", "#7a4aa8", "#e6e2d8"] },
};

export function randomAppearance(rng) {
  const pickKey = (k) => rng.pick(LOOK_OPTIONS[k].values)[0];
  const hairStyle = rng.chance(0.08) ? "bald" : pickKey("hairStyle");
  return {
    build: rng.weighted(["slim", "average", "heavy"], (b) => (b === "average" ? 3 : 1.5)),
    skin: rng.pick(SKIN_TONES),
    hairStyle,
    hair: rng.chance(0.06) ? rng.pick(HAIR_COLORS.slice(6)) : rng.pick(HAIR_COLORS.slice(0, 8)),
    facial: rng.chance(0.55) ? "none" : pickKey("facial"),
    topStyle: pickKey("topStyle"),
    top: rng.pick(CLOTH_COLORS),
    pants: rng.pick(PANTS_COLORS),
    accessory: rng.chance(0.3) ? "none" : pickKey("accessory"),
    accent: rng.pick(LOOK_COLORS.accent.palette),
  };
}

// Deterministic look for a survivor that has none (old states, survivors made elsewhere).
const hashSeed = (a, b) => ((Math.imul(a | 0, 2654435761) ^ Math.imul((b | 0) + 0x9e37, 1597334677)) >>> 0) || 1;
export function appearanceFor(seed, id) {
  return randomAppearance(new Rng(hashSeed(seed, id)));
}

// Crafting (data.js SKILLS; crafting.js): a new survivor's starting level, drawn with dice of its own (seed + how many
// people this world has made, like their looks) so adding the skill moved none of the world's random numbers. People
// handy with Mechanics usually make things too: half their Mechanics plus 0-6 (× the same quality as their other skills).
export const CRAFT_START = { fromMech: 0.5, roll: 6, oldSave: 0.7 }; // oldSave: × Mechanics for people in saves from before (save.js)
export function craftingStart(seed, n, mechanics = 0, quality = 1) {
  const u = new Rng(hashSeed((seed | 0) ^ 0x5bd1e995, n)).next();
  return Math.max(0, Math.min(SKILL_MAX, Math.round(CRAFT_START.fromMech * (mechanics || 0) + u * CRAFT_START.roll * quality)));
}

// Melee (data.js SKILLS; world.js MELEE_SKILL): a new survivor's starting level, drawn like the world's skills are
// (0-9 × quality, and now and then a specialty of +3-7: about the odds one of the nine rolled skills has of being one
// of their two) but with dice of their own (seed + how many people this world has made, salted apart from Crafting's),
// so adding the skill moved none of the world's random numbers. Averages about 5.5 at quality 1, as Shooting does.
// oldSave: people in a save from before the skill (save.js, world.js fillMelee): half their Shooting plus 0-6 by a hash
// of their name, about the same average.
export const MELEE_START = { roll: 9, spec: [3, 7], specOdds: 0.11, specTries: 2, salt: 0x6d656c65, oldShoot: 0.5, oldRoll: 6, oldSalt: 0x4d454c45 };
export function meleeStart(seed, n, quality = 1) {
  const r = new Rng(hashSeed((seed | 0) ^ MELEE_START.salt, n));
  let v = Math.round(r.next() * MELEE_START.roll * quality);
  for (let i = 0; i < MELEE_START.specTries; i++) {
    const hit = r.next() < MELEE_START.specOdds, up = MELEE_START.spec[0] + Math.floor(r.next() * (MELEE_START.spec[1] - MELEE_START.spec[0] + 1));
    if (hit) v += up;
  }
  return Math.max(0, Math.min(SKILL_MAX, v));
}
// Someone from before the skill: deterministic by their name and Shooting (no state needed: world.js skill() uses it
// too; not the id: ids run on across worlds made in one session, tools/sameseedtest.js).
export function meleeOldSave(who, shooting = 0) {
  let w = 0;
  for (const c of String(who)) w = (Math.imul(w, 31) + c.charCodeAt(0)) | 0;
  const u = new Rng(hashSeed(MELEE_START.oldSalt, w)).next();
  return Math.max(0, Math.min(SKILL_MAX, Math.round(MELEE_START.oldShoot * (shooting || 0) + u * MELEE_START.oldRoll)));
}
// A die of its own for a background's Melee bump (hardcore-start.js applyArchetype): [lo, hi] by the seed, the person
// (their name: ids run on across worlds made in one session, names are the seed's) and the background, so a
// background's other bumps keep the world's dice they always drew.
export function meleeBump(seed, who, lo, hi, key = "") {
  let h = 0, w = 0;
  for (const c of String(key)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  for (const c of String(who)) w = (Math.imul(w, 31) + c.charCodeAt(0)) | 0;
  const u = new Rng(hashSeed(((seed | 0) ^ MELEE_START.salt ^ h) | 0, w)).next();
  return lo + Math.floor(u * (hi - lo + 1));
}

// Fills in a missing or partial appearance in place and returns it.
export function ensureAppearance(s, seed = 0) {
  const def = appearanceFor(seed, s.id || 0);
  if (!s.appearance || typeof s.appearance !== "object") s.appearance = def;
  else for (const k of Object.keys(def)) if (s.appearance[k] == null) s.appearance[k] = def[k];
  return s.appearance;
}

// A throwaway rng for UI randomizing (does not disturb the world's seeded rng).
export const freshRng = () => new Rng(Math.floor(Math.random() * 4294967295) || 7);

// ---------- names and skills for the new-run screen ----------
// taken: full names already in use. A first name someone has is avoided too while another is free
// (messages use first names), and a full name is never repeated.
export function randomName(rng, taken = []) {
  const firsts = new Set(taken.map((n) => String(n).split(" ")[0]));
  const free = FIRST_NAMES.filter((f) => !firsts.has(f));
  for (let i = 0; i < 40; i++) {
    const n = `${rng.pick(free.length ? free : FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    if (!taken.includes(n)) return n;
  }
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

export const SKILL_MAX = 20;
export const skillTotal = (skills) => SKILLS.reduce((s, k) => s + (skills[k] || 0), 0);

// Same shape as world.makeSurvivor (a base spread plus one or two specialties), then nudged so the
// total matches `budget` exactly. Randomizing never makes anyone better or worse overall.
export function randomSkills(rng, budget, quality = 1) {
  const skills = {};
  for (const k of SKILLS) skills[k] = Math.max(0, Math.min(SKILL_MAX, Math.round(rng.range(0, 9) * quality)));
  for (let i = 0; i < 2; i++) skills[rng.pick(SKILLS)] += rng.int(3, 7);
  for (const k of SKILLS) skills[k] = Math.min(SKILL_MAX, skills[k]);
  return fitSkills(rng, skills, budget);
}

// The same skills nudged so the total matches `budget` exactly (a copy; specialties kept). Randomize all in
// Hardcore fits the skills a new background gave to the colonist's old total.
export function fitSkills(rng, from, budget) {
  const skills = { ...from };
  budget = Math.max(0, Math.min(SKILL_MAX * SKILLS.length, Math.round(budget)));
  let diff = budget - skillTotal(skills);
  let guard = 2000;
  while (diff !== 0 && guard-- > 0) {
    // Add to skills weighted by what is already there (keeps specialties), remove the same way.
    const k = rng.weighted(SKILLS, (s) => (diff > 0 ? (skills[s] < SKILL_MAX ? 1 + skills[s] : 0) : skills[s]));
    if (diff > 0 && skills[k] < SKILL_MAX) { skills[k]++; diff--; }
    else if (diff < 0 && skills[k] > 0) { skills[k]--; diff++; }
  }
  return skills;
}
