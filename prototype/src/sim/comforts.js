// Comforts and treats: things that lift mood, for a price (relations.js moodFactors lists them; morale.js moodWork
// and combat.js read the after-effects).
//
// Kept comforts (GEAR comfort): never used up, they only weigh what they weigh.
//   comfort.team: shared by everyone at the same base (carried by anyone there, or in its armory) or on the same
//     team (carried, or in the team's cargo): a deck of cards +0.4 a day, a harmonica +0.4, a guitar +1. Each kind
//     counts once; all of them together at most +1.5 a day.
//   comfort.self: for whoever carries it (pockets, hands or pack): family photos +0.6 a day (once).
// Toiletries (GEAR groom, dur = days of use): deodorant, toothpaste, shampoo, soap, razor blades, wet wipes, lip balm,
//   makeup, perfume.
//   Each kind lifts mood a day (groom) for whoever uses it, all of them together at most +1.2 (COMFORT.groomMax).
//   Someone uses their own (carried) first, else the shared shelf where they are (a base's armory, a team's cargo).
//   One day of use a day each (groomDaily): a shared stick at a base of ten lasts a tenth as long. Used up, it is gone.
// Treats (GEAR use): used up when someone has them (the Use button on the inventory screen; the autopilot hands
//   them to its glummest people). use.mood at once (a mood note), use.hp health (cigarettes cost 2, never below 1),
//   use.buzz a lingering effect for buzz.days days: work × buzz.work, aim in battle + buzz.aim, and buzz.mood a day
//   (a mood line). Chocolate +6; instant coffee +4 and work ×1.1 for the day; a pack of cigarettes +5 and −2
//   health; cheap vodka +10, then a day "Hungover": work ×0.85, aim −10, −2 mood.
import { GEAR } from "./data.js";
import { log, survivorById, atBase } from "./world.js";
import { allItems, packOf, itemAt, parseLoc, removeAt, personPlace, placeOfLoc } from "./inventory.js";
import { partyMembers, teamName } from "./parties.js";
import { addMood } from "./relations.js";

export const COMFORT = { teamMax: 1.5, selfMax: 1, groomMax: 1.2, lowMood: 35, cigHpFloor: 1 };

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

// The shared shelf of toiletries at a place: a base's armory or a team's cargo (not other people's own).
function shelf(place) {
  if (!place) return [];
  if (place.base) return place.base.armory || [];
  if (place.party) return (place.party.cargo && place.party.cargo.gear) || [];
  return [];
}
const groomOf = (it) => (it && GEAR[it.key] && GEAR[it.key].groom) || 0;
const daysLeft = (it) => (it.dur != null ? it.dur : GEAR[it.key].dur || 1);

// The toiletries someone uses today, one of each kind: Map key -> { item, own }. Their own first (the emptiest of
// them), else the shelf's emptiest (an open bottle before a new one).
export function groomKit(state, s, place) {
  const out = new Map();
  const take = (items, own) => {
    for (const it of items) {
      if (!groomOf(it) || daysLeft(it) <= 0) continue;
      const cur = out.get(it.key);
      if (!cur || (cur.own === own && daysLeft(it) < daysLeft(cur.item))) out.set(it.key, { item: it, own });
    }
  };
  take(carriedAll(s), true);
  const own = new Set(out.keys());
  take(shelf(place).filter((it) => !own.has(it.key)), false);
  return out;
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
  const kit = groomKit(state, s, place);
  if (kit.size) {
    const v = Math.min(COMFORT.groomMax, [...kit.keys()].reduce((a, k) => a + GEAR[k].groom, 0));
    out.push({ label: `Washed and groomed (${[...kit.keys()].map((k) => GEAR[k].name.toLowerCase()).join(", ")})`, v: r1(v) });
  }
  return out;
}

// Daily (relations.js relationsDaily, after the day's mood): each toiletry someone used today loses a day; an empty
// one is thrown away (theirs: from their pockets or pack; the shelf's: from the armory or cargo).
export function groomDaily(state, s, place) {
  for (const { item, own } of groomKit(state, s, place).values()) {
    item.dur = daysLeft(item) - 1;
    if (item.dur > 0) continue;
    if (own) dropCarried(s, item);
    else { const sh = shelf(place); const i = sh.indexOf(item); if (i >= 0) sh.splice(i, 1); }
    if (own) log(state, `${first(s)}'s ${item.name.toLowerCase()} ran out.`, "info");
    else if (!shelf(place).some((it) => it.key === item.key)) log(state, `The last ${item.name.toLowerCase()} ${place.base ? `at ${place.base.name}` : `with the ${teamName(state, place.party)}`} is used up.`, "info");
  }
}
function dropCarried(s, item) {
  for (const k of Object.keys(s.gear || {})) if (s.gear[k] === item) { s.gear[k] = null; return; }
  const i = (s.pockets || []).indexOf(item);
  if (i >= 0) { s.pockets[i] = null; return; }
  const pk = packOf(s) || [];
  const j = pk.indexOf(item);
  if (j >= 0) pk[j] = null;
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
