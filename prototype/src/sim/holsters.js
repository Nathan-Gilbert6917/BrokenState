// @ts-check
// Holsters: a side arm and a melee weapon carried on the belt, and the main weapon slung while one of them is out (the
// user's request 2026-10-21: "add a melee slot and side arm slot so a survivor can swap to a small melee weapon if they
// run out of ammo ... it takes an action to swap ... side arm can only fit small guns not long guns. Ai groups can do
// the same").
//   - Two equip slots (inventory.js EQUIP_SLOTS): "sidearm" takes a handgun (GEAR cat "pistol"), "melee" a one-handed
//     melee weapon up to BELT_KG (a knife, a hatchet, a machete, a bat, a baton: GEAR cat "melee"). Nothing there does
//     anything until it is drawn: the weapon in the hands (s.gear.weapon) is the one a fight reads.
//   - Drawing (drawWeapon: combat.js combatAct "draw", DRAW_AP in a fight, free out of one) puts the holstered weapon in
//     the hands. What was in the hands goes into its own holster when it belongs in one and that is free (a pistol
//     back in the side arm slot), else it is slung (the hidden "slung" slot: a long gun on its sling, one at most).
//     "main" draws the slung weapon back the same way.
//   - When a fight ends (combat.js closeCombat, fighters.js personBody), whoever has a weapon slung takes it back in
//     their hands (holsterAll): out of a fight the main weapon is the one in the hands.
// One rule for every side (docs/adr/0001-ai-parity.md): your people, your bots and the AI groups' people draw the same way.
import { GEAR } from "./data.js";

export const HOLSTERS = ["sidearm", "melee"];
export const DRAW_AP = 1;
export const BELT_KG = 1; // the heaviest melee weapon that hangs on a belt: a machete or a bat yes, a fire axe or a katana no
const def = (key) => (key && GEAR[key]) || null;
// A handgun: what the side arm slot takes (no rifle, shotgun, submachine gun or launcher).
export const isSidearmKey = (key) => { const d = def(key); return !!(d && d.slot === "weapon" && d.cat === "pistol"); };
// A small melee weapon: what the melee slot takes.
export const isBeltMeleeKey = (key) => { const d = def(key); return !!(d && d.slot === "weapon" && d.cat === "melee" && !d.twoHands && (d.weight ?? Infinity) <= BELT_KG); };
// The holster an item belongs in (null: none, a long gun among them).
export const holsterOf = (item) => (!item ? null : isSidearmKey(item.key) ? "sidearm" : isBeltMeleeKey(item.key) ? "melee" : null);
// Why an item cannot go in a holster or on the sling ("" when it can). inventory.js fitReason asks for these slots.
export function holsterReason(item, slot) {
  const d = item && def(item.key);
  if (!d) return "Unknown item.";
  if (slot === "sidearm") return isSidearmKey(item.key) ? "" : d.slot === "weapon" && d.cat !== "melee" ? `The ${item.name} is a long gun: only a handgun goes in the side arm slot.` : `Only a handgun goes in the side arm slot (not the ${item.name}).`;
  if (slot === "melee") return isBeltMeleeKey(item.key) ? "" : d.cat === "melee" ? `The ${item.name} is too big for the belt: only a small melee weapon (${BELT_KG} kg or less, one hand) goes in the melee slot.` : `Only a small melee weapon goes in the melee slot (not the ${item.name}).`;
  if (slot === "slung") return d.slot === "weapon" ? "" : `Only a weapon is slung (not the ${item.name}).`;
  return "";
}

// ---------- drawing ----------
const nameOf = (it) => (it ? it.name : "");
// What a draw would do: { why, item, put } (put: where the hands' weapon goes: a holster, "slung", or null for empty
// hands). slot: "sidearm", "melee" or "main" (the slung weapon back).
export function drawPlan(s, slot) {
  const g = s && s.gear;
  if (!g) return { why: "Nobody to draw.", item: null, put: null };
  const from = slot === "main" ? "slung" : slot;
  if (from !== "slung" && !HOLSTERS.includes(from)) return { why: "No such holster.", item: null, put: null };
  const item = g[from] || null;
  if (!item) return { why: slot === "main" ? "Nothing slung to take back." : slot === "sidearm" ? "No side arm in the side arm slot." : "No melee weapon in the melee slot.", item: null, put: null };
  const held = g.weapon || null;
  if (!held) return { why: "", item, put: null };
  const own = holsterOf(held);
  if (own && (!g[own] || own === from)) return { why: "", item, put: own };
  if (!g.slung || from === "slung") return { why: "", item, put: "slung" };
  return { why: `Nowhere to put the ${held.name}: the ${g.slung.name} is slung already.`, item, put: null };
}
// The draw itself (checked by drawPlan). Returns the log's words, or "" when it could not be done.
export function drawWeapon(s, slot) {
  const p = drawPlan(s, slot);
  if (p.why || !p.item) return "";
  const g = s.gear, held = g.weapon || null, from = slot === "main" ? "slung" : slot;
  g[from] = null;
  if (held && p.put) g[p.put] = held;
  g.weapon = p.item;
  const first = String(s.name || "").split(" ")[0] || "They";
  if (!held) return `${first} draws the ${nameOf(p.item)}.`;
  return slot === "main" ? `${first} puts away the ${nameOf(held)} and takes up the ${nameOf(p.item)} again.` : p.put === "slung" ? `${first} slings the ${nameOf(held)} and draws the ${nameOf(p.item)}.` : `${first} puts away the ${nameOf(held)} and draws the ${nameOf(p.item)}.`;
}
// The draws a person has (the battle bar's buttons, the AI): [{ slot, item, why }] for each filled holster and the sling.
export function drawOptions(s) {
  const g = s && s.gear;
  if (!g) return [];
  const out = [];
  for (const slot of [...HOLSTERS, "main"]) {
    const item = g[slot === "main" ? "slung" : slot];
    if (item) out.push({ slot, item, why: drawPlan(s, slot).why });
  }
  return out;
}
// A fight over: the slung weapon back in the hands (free). Returns true when something moved.
export function holsterAll(s) {
  if (!s || !s.gear || !s.gear.slung) return false;
  return !!drawWeapon(s, "main");
}
