// @ts-check
// Names for item rows that say what a thing is (2026-10-10, user: "Add the word magazine to Gun Mags, since my
// character started with something called '23 .308/7.62 NATO FMJ': is this loose rounds?"):
//   - a magazine always says magazine ("AK drum magazine (75)", "Belt box magazine (100)");
//   - rounds say their form after the name: ".308 / 7.62 NATO FMJ — loose", "… — box", "… — 3 boxes"; the stores'
//     rounds (a supply count, not in boxes) are loose rounds too;
//   - the count is not part of the name: rowCount gives it for the small number on the right of the row ("×23").
// The inventory, the armory, the team inventory, the stack mover and the loot screens use these (ui/inventory.js tile,
// ui/teaminv.js, ui/stackmove.js). sim/itemstack.js stackLabel stays the words of the log lines.
import { GEAR, SUPPLIES } from "./data.js";
import { ROUND_SUPPLIES } from "./data-ammo.js";
import { MAGAZINES, CLIPS } from "./data-kit.js";
import { isRoundItem, isBulk, boxesIn, amountOf, countOf, bulkRecord, bulkRounds } from "./itemstack.js";

const num = (v) => (Number.isFinite(v) ? v : 0);

// A magazine's name with the word in it: "AK drum (75)" → "AK drum magazine (75)".
/** @param {string} name */
export function withMagWord(name) {
  const s = String(name || "");
  if (/magazine/i.test(s)) return s;
  const i = s.indexOf(" (");
  return i > 0 ? `${s.slice(0, i)} magazine${s.slice(i)}` : `${s} magazine`;
}
/** @param {any} it an item or a key */
export const isMagItem = (it) => !!(it && MAGAZINES[typeof it === "string" ? it : it.key]);
// The name of a magazine item (or key).
/** @param {any} it */
export function magName(it) {
  const key = typeof it === "string" ? it : it && it.key;
  const d = GEAR[key];
  return withMagWord((it && typeof it === "object" && it.name) || (d && d.name) || key);
}
// The form a stack of rounds is in: "loose", "box", "3 boxes" ("" for anything else).
/** @param {any} it */
export function roundsForm(it) {
  if (!isRoundItem(it)) return "";
  if (it.loose) return "loose";
  const b = boxesIn(it);
  return b > 1 ? `${b} boxes` : "box";
}
// The row name of a supply key (the stores): rounds are loose rounds (".308 / 7.62 NATO FMJ — loose").
/** @param {string} key */
export function supplyName(key) {
  const s = SUPPLIES[key];
  if (!s) return key;
  return ROUND_SUPPLIES[key] ? `${s.name} — loose` : s.name;
}
// The row name of an item: what it is, never its count (rowCount).
/** @param {any} it */
export function rowName(it) {
  if (!it) return "";
  if (isRoundItem(it)) return `${it.name} — ${roundsForm(it)}`;
  if (isMagItem(it)) return magName(it);
  if (isBulk(it)) {
    const rec = bulkRecord(it), keys = Object.keys(rec);
    return keys.length === 1 && SUPPLIES[keys[0]] ? `${it.name} — ${SUPPLIES[keys[0]].name}` : keys.length ? `${it.name} — ${keys.length} kinds` : `${it.name} — empty`;
  }
  if (CLIPS[it.key]) return it.name;
  return it.name;
}
// The small number on the right of a row: "×23" (rounds, a stack of things), "×120" (a bulk can's rounds), "" (one).
/** @param {any} it */
export function rowCount(it) {
  if (!it) return "";
  if (isRoundItem(it)) return `×${amountOf(it)}`;
  if (isBulk(it)) { const n = bulkRounds(it); return n > 0 ? `×${n}` : ""; }
  return countOf(it) > 1 ? `×${countOf(it)}` : "";
}
// A row as one line of text, the count after the name (lists with no badge: "… FMJ — loose ×23").
/** @param {any} it */
export const rowText = (it) => { const c = rowCount(it); return c ? `${rowName(it)} ${c}` : rowName(it); };
// For a supply count: "×27".
/** @param {number} n */
export const supplyCount = (n) => `×${Math.floor(num(n))}`;
