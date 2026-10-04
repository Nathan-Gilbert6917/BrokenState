// Comforts and treats: things that lift mood, for a price (relations.js moodFactors lists them; morale.js moodWork
// and combat.js read the after-effects).
//
// Kept comforts (GEAR comfort): never used up, they only weigh what they weigh.
//   comfort.team: shared by everyone at the same base (carried by anyone there, or in its armory) or on the same
//     team (carried, or in the team's cargo): a deck of cards +0.4 a day, a harmonica +0.4, a guitar +1. Each kind
//     counts once; all of them together at most +1.5 a day.
//   comfort.self: for whoever carries it (pockets, hands or pack): family photos +0.6 a day (once).
// Treats (GEAR use): used up when someone has them (the Use button on the inventory screen; the autopilot hands
//   them to its glummest people). use.mood at once (a mood note), use.hp health (cigarettes cost 2, never below 1),
//   use.buzz a lingering effect for buzz.days days: work × buzz.work, aim in battle + buzz.aim, and buzz.mood a day
//   (a mood line). Chocolate +6; instant coffee +4 and work ×1.1 for the day; a pack of cigarettes +5 and −2
//   health; cheap vodka +10, then a day "Hungover": work ×0.85, aim −10, −2 mood.
import { GEAR } from "./data.js";
import { log, survivorById, atBase } from "./world.js";
import { allItems, packOf, itemAt, parseLoc, removeAt, personPlace, placeOfLoc } from "./inventory.js";
import { partyMembers } from "./parties.js";
import { addMood } from "./relations.js";

export const COMFORT = { teamMax: 1.5, selfMax: 1, lowMood: 35, cigHpFloor: 1 };

const first = (s) => s.name.split(" ")[0];
const r1 = (v) => Math.round(v * 10) / 10;

// Everything a person has on them, with what is in their pack.
export function carriedAll(s) {
  if (!s || !s.gear) return [];
  const pk = packOf(s) || [];
  return [...allItems(s), ...pk.filter(Boolean)];
}

// Items shared at a place: everyone's carried things and the armory (base) or cargo (team).
function sharedItems(state, place) {
  if (!place) return [];
  if (place.base) return [...atBase(state, place.base.id).flatMap(carriedAll), ...(place.base.armory || [])];
  if (place.party) return [...partyMembers(state, place.party).flatMap(carriedAll), ...((place.party.cargo && place.party.cargo.gear) || [])];
  return [];
}

// Mood lines from kept comforts for someone at a place ({ base } or { party }): [{ label, v }].
export function comfortLines(state, s, place) {
  const out = [];
  const team = new Map();
  for (const it of sharedItems(state, place)) {
    const c = GEAR[it.key] && GEAR[it.key].comfort;
    if (c && c.team && !team.has(it.key)) team.set(it.key, c.team);
  }
  if (team.size) {
    const v = Math.min(COMFORT.teamMax, [...team.values()].reduce((a, x) => a + x, 0));
    out.push({ label: `Music and games (${[...team.keys()].map((k) => GEAR[k].name.toLowerCase()).join(", ")})`, v: r1(v) });
  }
  const own = new Map();
  for (const it of carriedAll(s)) {
    const c = GEAR[it.key] && GEAR[it.key].comfort;
    if (c && c.self && !own.has(it.key)) own.set(it.key, c.self);
  }
  if (own.size) {
    const v = Math.min(COMFORT.selfMax, [...own.values()].reduce((a, x) => a + x, 0));
    out.push({ label: `Keepsakes (${[...own.keys()].map((k) => GEAR[k].name.toLowerCase()).join(", ")})`, v: r1(v) });
  }
  return out;
}

// What using an item would do, in a few words (tooltips, the Use button). "" when it cannot be used.
export function useText(key) {
  const u = GEAR[key] && GEAR[key].use;
  if (!u) return "";
  const bits = [];
  if (u.mood) bits.push(`+${u.mood} mood`);
  if (u.hp) bits.push(`${u.hp} health`);
  if (u.buzz) {
    const b = u.buzz;
    const fx = [];
    if (b.work && b.work !== 1) fx.push(`work ${b.work > 1 ? "+" : "−"}${Math.round(Math.abs(b.work - 1) * 100)}%`);
    if (b.aim) fx.push(`aim ${b.aim > 0 ? "+" : "−"}${Math.abs(b.aim)}`);
    if (b.mood) fx.push(`${b.mood > 0 ? "+" : "−"}${Math.abs(b.mood)} mood`);
    bits.push(`then ${b.label.toLowerCase()} for ${b.days} day${b.days === 1 ? "" : "s"} (${fx.join(", ")})`);
  }
  return bits.join(", ");
}

// Applies a treat to a survivor (the item is already taken). Returns the line for the log / the screen.
export function applyUse(state, s, key) {
  const d = GEAR[key];
  const u = d && d.use;
  if (!u || !s || !s.alive) return "";
  if (u.mood) addMood(state, s, u.mood, d.name);
  if (u.hp) s.health = Math.max(Math.min(s.health, COMFORT.cigHpFloor), s.health + u.hp);
  if (u.buzz) s.buzz = { ...u.buzz, from: key };
  return `${first(s)} ${d.useVerb || "has"} the ${d.name.toLowerCase()}: ${useText(key)}.`;
}

// Uses the item at an inventory location on survivor sid (the Use button). Returns a message.
export function useItemOn(state, sid, loc) {
  const s = survivorById(state, sid);
  const it = itemAt(state, loc);
  if (!s || !s.alive || !it) return "Nothing to use.";
  if (!GEAR[it.key] || !GEAR[it.key].use) return `The ${it.name} is not something to use up.`;
  const L = parseLoc(loc);
  if (L.o === "body") return "Take it first.";
  if (placeOfLoc(state, L) !== personPlace(s)) return `${first(s)} cannot reach it.`;
  removeAt(state, loc);
  const line = applyUse(state, s, it.key);
  log(state, line, "info");
  return line;
}

// Daily (relations.js relationsDaily): a buzz counts down; drink turns into a hangover.
export function buzzDaily(s) {
  if (!s.buzz) return;
  s.buzz.days -= 1;
  if (s.buzz.days > 0) return;
  s.buzz = s.buzz.next ? { ...s.buzz.next } : null;
  if (!s.buzz) delete s.buzz;
}
export const buzzWork = (s) => (s && s.buzz && s.buzz.work) || 1;
export const buzzAim = (s) => (s && s.buzz && s.buzz.aim) || 0;
export const buzzLine = (s) => (s && s.buzz ? { label: `${s.buzz.label} (${[s.buzz.work && s.buzz.work !== 1 ? `work ×${s.buzz.work}` : "", s.buzz.aim ? `aim ${s.buzz.aim > 0 ? "+" : ""}${s.buzz.aim}` : ""].filter(Boolean).join(", ")})`, v: s.buzz.mood || 0 } : null);

// ---------- the autopilot ----------
// At a base: people below COMFORT.lowMood (glummest first) get a treat from the armory, the gentlest first
// (chocolate, coffee, cigarettes; vodka only for someone resting). One each a day. Returns the lines.
const TREAT_ORDER = ["chocolate", "instcoffee", "smokes", "vodka"];
export function autoTreats(state, base) {
  const out = [];
  const people = atBase(state, base.id).filter((s) => s.alive && s.mood < COMFORT.lowMood && !s.buzz).sort((a, b) => a.mood - b.mood);
  for (const s of people) {
    const key = TREAT_ORDER.find((k) => base.armory.some((it) => it.key === k) && (k !== "vodka" || s.role === "rest") && (k !== "smokes" || s.health > 40));
    if (!key) continue;
    const i = base.armory.findIndex((it) => it.key === key);
    base.armory.splice(i, 1);
    out.push(applyUse(state, s, key));
  }
  return out;
}
