// The short labels of an item row (2026-10-10, user: "Simplify the info for items when you hover over them, too much
// detail when I hovered over the Hunting rifle"; "Guns should show quickly how many rounds are in them when in the
// inventory view").
//   - gunRoundsLabel / roundsBadge: the rounds badge on a gun's (or a magazine's) row: "4/5", red when empty
//     (sim/gunrounds.js counts them);
//   - itemShortTip: the hover tip, a few lines: the name and what it is (type, calibre), the rounds in it, condition,
//     weight, two or three key numbers as small bars, who has it. The whole description (ui/inventory.js itemTip) is
//     behind Shift (hold it while hovering: main.js swaps data-tip-full in) or the selection bar's ⓘ Details;
//   - tipAttrs: the data-tip attributes for both.
// Kept apart from the tiles' markup (ui/inventory.js tile) so a redesign of the rows only calls these.
import { GEAR, SKILL_NAMES } from "../sim/data.js";
import { CALIBERS } from "../sim/data-ammo.js";
import { MAGAZINES } from "../sim/data-kit.js";
import { WEAPONS } from "../sim/combat.js";
import { calOf } from "../sim/ammo.js";
import { gunStats } from "../sim/gunstats.js";
import { itemDur, itemDurMax } from "../sim/crafting.js";
import { itemLoad, packSize, SLOT_NAMES } from "../sim/inventory.js";
import { gearEffect } from "../sim/world.js";
import { gunRounds, holderName, isRoundGun } from "../sim/gunrounds.js";
import { rowName, rowCount, magName } from "../sim/itemnames.js";
import { isRoundItem, isBulk } from "../sim/itemstack.js";
import { typeName } from "../sim/rounds.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const r1 = (x) => Math.round(x * 10) / 10;
// The live state for rows drawn without it (ui/inventory.js tile has no state argument): main.js's window.game.
const liveState = () => (typeof window !== "undefined" && window.game ? window.game.state : null);

// ---------- the rounds badge ----------
// { text: "4/5", cls: "full" | "part" | "empty", tip } for a gun or a magazine, or null. state: null for the live one.
export function gunRoundsLabel(item, loc = null, state = null) {
  const r = gunRounds(state || liveState(), item, loc);
  if (!r) return null;
  const cls = r.n <= 0 ? "empty" : r.n >= r.cap ? "full" : "part";
  const what = isRoundGun(item) ? "in the gun" : "in the magazine";
  const how = r.src === "ready" ? ` (loaded from the rounds to hand before a fight: ${r.roundName})` : r.src === "fight" ? ` (${r.roundName}, now)` : r.src === "in it" ? ` (${r.roundName})` : "";
  const tip = r.n > 0 ? `${r.n} of ${r.cap} rounds ${what}${how}` : r.src === "ready" ? `Empty: no ${r.roundName} to hand to load it with` : `Empty (${r.cap} rounds when loaded)`;
  return { text: `${r.n}/${r.cap}`, cls, tip, n: r.n, cap: r.cap, load: r.load, roundName: r.roundName };
}
// The badge's markup (styles.css .irounds), or "".
export function roundsBadge(item, loc = null, state = null) {
  const l = gunRoundsLabel(item, loc, state);
  return l ? `<span class="irounds ${l.cls}" data-tip="${esc(l.tip)}">${esc(l.text)}</span>` : "";
}

// ---------- the short tip ----------
const BAR = 5;
const bar = (f) => { const n = Math.max(0, Math.min(BAR, Math.round(Math.max(0, Math.min(1, f)) * BAR))); return "▰".repeat(n) + "▱".repeat(BAR - n); };
// What the bars are scaled to (a top gun fills them): damage a hit (average), best range (tiles), aim.
const SCALE = { dmg: 50, range: 15, aimLo: -6, aimHi: 12, power: 5 };
const KIND = { melee: "melee weapon", pistol: "pistol", shotgun: "shotgun", rifle: "rifle", automatic: "automatic weapon", bow: "bow", explosive: "launcher" };
function kindOf(item) {
  const d = GEAR[item.key];
  if (!d) return "";
  if (MAGAZINES[item.key]) { const m = MAGAZINES[item.key]; return `magazine · ${CALIBERS[m.cal] ? CALIBERS[m.cal].name : m.cal}`; }
  if (isRoundItem(item)) return "ammunition";
  if (isBulk(item)) return "ammo container";
  if (d.slot === "weapon") { const cal = calOf(item.key); return `${KIND[d.cat] || "weapon"}${cal && CALIBERS[cal] ? ` · ${CALIBERS[cal].name}` : ""}`; }
  if (d.slot === "pack") return d.cat ? String(d.cat) : "item";
  return (SLOT_NAMES[d.slot] || d.slot || "").toLowerCase();
}
// Condition as a share (uses left of its most, else its quality), or null for a thing that does not wear.
function condition(item) {
  const d = GEAR[item.key];
  const dur = itemDur(item);
  if (dur != null && !d.count && !d.tabs && !d.groom) { const max = itemDurMax(item); return max > 0 ? dur / max : null; }
  return (item.quality ?? 1) < 1 ? item.quality : null;
}
function statLine(item) {
  const d = GEAR[item.key];
  if (isRoundGun(item) || (d.slot === "weapon" && WEAPONS[item.key] && d.cat !== "melee")) {
    const s = gunStats(item);
    if (!s) return "";
    const dmg = (s.dmg[0] + s.dmg[1]) / 2;
    return `Damage ${bar(dmg / SCALE.dmg)}  Range ${bar((s.opt || 0) / SCALE.range)}  Accuracy ${bar(((s.aim || 0) - SCALE.aimLo) / (SCALE.aimHi - SCALE.aimLo))}`;
  }
  if (d.slot === "weapon") { const g = WEAPONS[item.key] ? gunStats(item) : null; const dm = g && g.dmg ? (g.dmg[0] + g.dmg[1]) / 2 : 0; return dm ? `Damage ${bar(dm / SCALE.dmg)} ${Math.round(dm)}` : `Power ${r1(d.power || 0)}`; }
  if (["armor", "head", "arms", "legs"].includes(d.slot) && d.power) return `Armour ${bar(d.power / SCALE.power)} ${r1(d.power)}`;
  if (d.slot === "backpack") return `${packSize(item)} slots · +${d.carry || 0} kg max load`;
  if (d.slot === "rig" && d.pouches) return `${d.pouches.length} pouches · +${d.carry || 0} kg max load`;
  return "";
}
// The hover tip of an item row: a few lines. s: who would use it (a skill they lack shows); loc: where it is.
export function itemShortTip(item, loc = null, s = null, state = null) {
  const d = item && GEAR[item.key];
  if (!d) return "";
  const st = state || liveState();
  const name = MAGAZINES[item.key] ? magName(item) : rowName(item);
  const lines = [`${name} — ${kindOf(item)}`];
  const facts = [];
  const r = gunRoundsLabel(item, loc, st);
  if (r) facts.push(r.n > 0 ? `${r.text} in ${isRoundGun(item) ? "mag" : "it"}${r.load ? ` (${typeName(r.load) || r.roundName})` : ""}` : `empty (${r.cap} rounds)`);
  const c = rowCount(item);
  if (c && !r) facts.push(`${c.replace("×", "")} ${isRoundItem(item) || isBulk(item) ? "rounds" : "of them"}`);
  const cond = condition(item);
  if (cond != null) facts.push(`condition ${Math.round(cond * 100)}%`);
  facts.push(`${r1(itemLoad(item))} kg`);
  lines.push(facts.join(" · "));
  const stats = statLine(item);
  if (stats) lines.push(stats);
  const who = holderName(st, loc);
  if (who) lines.push(loc && /^s:/.test(loc) ? `Carried by ${who}` : `In ${who}`);
  if (s && d.skill && d.req) {
    const e = gearEffect(s, item);
    if (e.gap > 0) lines.push(e.usable ? `${s.name.split(" ")[0]} is ${e.gap} below ${SKILL_NAMES[d.skill]} ${d.req}: weaker` : `${s.name.split(" ")[0]} cannot use it (needs ${SKILL_NAMES[d.skill]} ${d.req})`);
  }
  lines.push("Shift: full details");
  return lines.join("\n");
}
// The data-tip attributes: the short tip shown, the full one behind Shift (main.js).
export function tipAttrs(short, full) {
  return short ? ` data-tip="${esc(short)}" data-tip-pre${full ? ` data-tip-full="${esc(full)}"` : ""}` : full ? ` data-tip="${esc(full)}"` : "";
}
