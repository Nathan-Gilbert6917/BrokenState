// Custom backgrounds (2026-10-07, user request): who a hardcore survivor was, made by the player on the new-run screen
// (ui/backgrounds.js keeps them in this browser) instead of drawn from HC_START.ARCHETYPES. Full control and no dice:
// the skill bumps, the traits, what they wear and hold, what they carry, the food, water, ammo and meds on them, how
// likely the car is theirs, which car and what is in its back are all exactly what the player set (clamped to CUSTOM_BG).
// A world built with them keeps a copy (state.customBackgrounds, saved with the game), so a save shows the background
// whatever the browser's list holds later. hardcore-start.js archetypeOf / applyArchetype / rollCustom use them.
// Not in an Ironman run (ui/newgame.js: ticking Ironman puts the colonists back as rolled, and Start refuses a custom crew).
import { GEAR, TRAITS, SKILLS, clashIn } from "./data.js";
import { VEHICLE_TYPES } from "./vehicles.js";
import { cleanTier, tierCount } from "./traits.js"; // a trait's tier (traits.js TRAIT_TIERS)

export const CUSTOM_BG = {
  PREFIX: "c_",
  MAX: 24, // backgrounds kept in the list
  NAME: 30, BLURB: 60, // characters
  SKILL: 10, // the most a background adds to one skill (a colonist's own skills cap at 20 as ever)
  TRAITS: 3, // traits it gives (never two that clash: data.js TRAIT_CLASH); a colonist keeps at most TRAITS in all, the background's first
  ITEMS: 12, TRUNK_ITEMS: 10,
  // On them (on top of the team's clamped 1–3 days, like a prepper's bag) and in the car's back.
  SUPPLY: { food: 30, water: 30, ammo: 200, arrows: 60, meds: 10 },
  TRUNK: { food: 60, water: 60, fuel: 40, ammo: 300, meds: 20, scrap: 40, parts: 20 },
  CAR_ODDS: 10, // how likely the car is theirs against the others' (a preset is 0.7–1.6); 0: never theirs
  SLOTS: ["weapon", "tool", "armor", "head", "arms", "legs", "backpack"],
};

export const isCustomBg = (key) => typeof key === "string" && key.startsWith(CUSTOM_BG.PREFIX);
export const customTraitKeys = () => Object.keys(TRAITS); // enumerable only: the prepper's background trait is not one to give
export const slotOptions = (slot) => Object.keys(GEAR).filter((k) => GEAR[k].slot === slot);
// Carried things: anything that fits a pocket, a pack or the off hand (no packs, nothing bulky, no bicycle).
export const carryOptions = () => Object.keys(GEAR).filter((k) => GEAR[k].slot !== "backpack" && GEAR[k].slot !== "cargo" && !GEAR[k].bulky);
// The car's back holds anything.
export const trunkOptions = () => Object.keys(GEAR);
export const carTypes = () => Object.keys(VEHICLE_TYPES).filter((k) => VEHICLE_TYPES[k].motor);

export function blankBackground(id) {
  return { id, name: "New background", blurb: "", skills: {}, traits: [], traitTier: {}, gear: {}, items: [], supplies: {}, car: { odds: 1, type: null, trunk: {}, items: [] } };
}

const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };
const str = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const amounts = (src, caps) => {
  const out = {};
  for (const [k, cap] of Object.entries(caps)) { const q = int(src && src[k], 0, cap); if (q > 0) out[k] = q; }
  return out;
};

// Anything the browser kept (or a save carried), made safe: unknown keys dropped, numbers clamped, no clashing traits.
export function sanitizeBackground(raw, id = raw && raw.id) {
  const C = CUSTOM_BG, r = raw && typeof raw === "object" ? raw : {};
  const skills = {};
  for (const k of SKILLS) { const v = int(r.skills && r.skills[k], 0, C.SKILL); if (v) skills[k] = v; }
  const traits = [];
  for (const t of Array.isArray(r.traits) ? r.traits : []) {
    if (!customTraitKeys().includes(t) || traits.includes(t) || traits.length >= C.TRAITS) continue;
    if (clashIn(traits, t)) continue; // never two that clash (data.js TRAIT_CLASH): the first stays
    traits.push(t);
  }
  // Each trait's tier (traits.js; missing: tier I).
  const traitTier = {};
  for (const t of traits) { const n = cleanTier(t, r.traitTier && r.traitTier[t]); if (n > 1 && tierCount(t) > 1) traitTier[t] = n; }
  const gear = {};
  for (const slot of C.SLOTS) { const k = r.gear && r.gear[slot]; if (k && GEAR[k] && GEAR[k].slot === slot) gear[slot] = k; }
  const carry = new Set(carryOptions()), trunkOk = new Set(trunkOptions());
  const items = (Array.isArray(r.items) ? r.items : []).filter((k) => carry.has(k)).slice(0, C.ITEMS);
  const car = r.car && typeof r.car === "object" ? r.car : {};
  const odds = Number.isFinite(Number(car.odds)) ? Math.max(0, Math.min(C.CAR_ODDS, Math.round(Number(car.odds) * 10) / 10)) : 1;
  return {
    id: String(id || `${C.PREFIX}1`),
    name: str(r.name, C.NAME) || "Custom background",
    blurb: str(r.blurb, C.BLURB),
    skills, traits, traitTier, gear, items,
    supplies: amounts(r.supplies, C.SUPPLY),
    car: {
      odds,
      type: carTypes().includes(car.type) ? car.type : null,
      trunk: amounts(car.trunk, C.TRUNK),
      items: (Array.isArray(car.items) ? car.items : []).filter((k) => trunkOk.has(k)).slice(0, C.TRUNK_ITEMS),
    },
    custom: true,
  };
}

// A list (the browser's, or a save's) as { id: background }, at most MAX, ids with the prefix.
export function sanitizeLibrary(src) {
  const out = {};
  const list = Array.isArray(src) ? src : src && typeof src === "object" ? Object.values(src) : [];
  for (const raw of list) {
    if (Object.keys(out).length >= CUSTOM_BG.MAX) break;
    if (!raw || !isCustomBg(raw.id) || out[raw.id]) continue;
    out[raw.id] = sanitizeBackground(raw, raw.id);
  }
  return out;
}

// A fresh id not in the list.
export function newBackgroundId(lib) {
  let n = 1;
  while (lib[`${CUSTOM_BG.PREFIX}${n}`]) n++;
  return `${CUSTOM_BG.PREFIX}${n}`;
}

// A one-line summary for the editor's list and tooltips: "+4 Medicine, +2 Speech; Former Medic; Kitchen knife...".
export function backgroundSummary(def, names = {}) {
  const sk = Object.entries(def.skills || {}).map(([k, v]) => `+${v} ${names[k] || k}`);
  const tr = (def.traits || []).map((t) => `${TRAITS[t].name}${def.traitTier && def.traitTier[t] > 1 ? ` ${["", "I", "II", "III"][def.traitTier[t]]}` : ""}`);
  const kit = [...Object.values(def.gear || {}), ...(def.items || [])].map((k) => GEAR[k].name);
  return [sk.join(", "), tr.join(", "), kit.slice(0, 4).join(", ") + (kit.length > 4 ? ` +${kit.length - 4} more` : "")].filter(Boolean).join("; ") || "nothing yet";
}
