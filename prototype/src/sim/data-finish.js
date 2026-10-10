// @ts-check
// A gun's finish (user 2026-10-10: colour variants as found variety): black, tan, OD green, wood, stainless... where
// that gun really comes that way. item.finish holds the name; ui/gunspecs.js FINISH_LOOK paints it (the gun builder,
// the battle HUD, the item thumbnails, the gun held in battle and dropped by a body).
// Chosen when the gun item is made (factoryfit.js factoryFit, on the dice newItem / lootItem pass it: a hash of the
// source's rng position, never a draw from it, so no other roll changes). A gun made with no dice (a trader's stock,
// an old save) has no finish stored: finishOf gives its first, the look its spec draws.
// An enemy's gun (no item: combat.js enemyUnit) is shown in unitFinish's, and carryMods gives the looted gun the same.
// GUN_FINISH[weapon key] = [[name, weight], ...]; the first is the gun's own look. A gun not listed has only that.
import { hash01 } from "./skills.js";

/** @type {Record<string, [string, number][]>} */
export const GUN_FINISH = {
  // pistols and revolvers
  pistol: [["black", 6], ["fde", 2], ["od", 1]], compact9: [["black", 6], ["fde", 2], ["od", 1]],
  usp45: [["black", 5], ["fde", 2], ["twotone", 1]], pistol45: [["stainless", 4], ["blued", 3], ["black", 2]],
  magnum: [["nickel", 3], ["black", 3]], pistol22: [["black", 4], ["stainless", 2]],
  revolver: [["stainless", 5], ["blued", 3]], snub357: [["stainless", 4], ["black", 2]],
  snub38: [["blued", 4], ["nickel", 2]], service38: [["blued", 4], ["nickel", 1]], revolver44: [["blued", 3], ["stainless", 2]],
  pistol57: [["fde", 3], ["black", 3]],
  // submachine guns
  ump45: [["black", 4], ["fde", 1]], vector: [["black", 4], ["fde", 1], ["od", 1]], p90: [["black", 4], ["od", 1], ["fde", 1]],
  // AR family and the other rifles
  carbine: [["black", 5], ["fde", 2], ["od", 1]], m4: [["black", 5], ["fde", 2], ["od", 1]], hk416: [["black", 4], ["fde", 2]],
  dmr: [["black", 4], ["fde", 2]], ar15rifle: [["fde", 3], ["black", 4], ["od", 1]], ar223: [["black", 4], ["fde", 2]],
  arpistol: [["black", 4], ["fde", 2]], ar300: [["od", 3], ["black", 3], ["fde", 2]], sbr300: [["black", 4], ["fde", 2]],
  ardmr: [["twotone", 3], ["black", 3]], scarl: [["fde", 3], ["black", 2]], scarh: [["twotone", 3], ["black", 2], ["fde", 2]],
  ak: [["wood", 5], ["black", 3], ["plum", 1]], fal: [["wood", 3], ["black", 3]], m1a: [["wood", 4], ["black", 2], ["fde", 1]],
  g3: [["od", 3], ["black", 3]], famas: [["black", 1]], aug: [["od", 3], ["black", 2], ["fde", 1]],
  huntrifle: [["wood", 4], ["black", 2], ["stainless", 1]], sniper: [["od", 3], ["black", 2], ["fde", 2]],
  rifle22: [["wood", 4], ["black", 1]], varmint223: [["laminate", 3], ["black", 2]], ranch223: [["blued", 4], ["stainless", 2], ["black", 1]],
  leverrifle: [["wood", 4], ["stainless", 1]], lever357: [["case", 3], ["blued", 2], ["stainless", 1]], lever44: [["blued", 3], ["stainless", 1]],
  amr: [["black", 3], ["fde", 1]], lmg: [["black", 3], ["fde", 1]], m240: [["black", 3], ["fde", 1]],
  single556: [["blued", 3], ["black", 1]], single223: [["stainless", 3], ["black", 1]], single300: [["od", 3], ["black", 2]],
  singlerifle: [["case", 3], ["black", 1]], single44: [["blued", 3], ["stainless", 1]],
  // shotguns
  shotgun: [["wood", 5], ["black", 3], ["od", 1]], pump20: [["wood", 4], ["black", 1]], tacpump: [["black", 4], ["fde", 1], ["od", 1]],
  semishotgun: [["black", 3], ["fde", 1]], dbshotgun: [["wood", 3], ["case", 1]], ou12: [["silver", 3], ["case", 1]], ou20: [["case", 3], ["silver", 1]],
  single12: [["wood", 3], ["nickel", 1], ["black", 1]],
};
// What the finish is called (the item's tooltip, the gun builder).
export const FINISH_NAME = {
  black: "black", fde: "tan (FDE)", od: "OD green", wood: "wood", plum: "plum polymer", stainless: "stainless", blued: "blued",
  nickel: "nickel", twotone: "two-tone", case: "case-coloured", silver: "silver", laminate: "laminate",
};

const listOf = (key) => GUN_FINISH[key] || null;
/** The finish a gun of this kind gets on these dice (seed: any value; hashed). @param {string} key @param {any} seed */
export function rollFinish(key, seed) {
  const L = listOf(key);
  if (!L) return null;
  const total = L.reduce((a, [, w]) => a + w, 0);
  let r = hash01(seed, key, "finish") * total;
  for (const [name, w] of L) { if ((r -= w) < 0) return name; }
  return L[L.length - 1][0];
}
/** A gun item's finish: its own (when the gun comes that way), else its first. @param {any} item */
export function finishOf(item) {
  const L = item && listOf(item.key);
  if (!L) return null;
  return item.finish && L.some(([n]) => n === item.finish) ? item.finish : L[0][0];
}
/** Sets a new gun item's finish on its dice (none when it has one, or no choice). @param {any} item @param {any} seed */
export function setFinish(item, seed) {
  if (!item || item.finish || seed == null) return item;
  const L = listOf(item.key);
  if (L && L.length > 1) { const f = rollFinish(item.key, seed); if (f !== L[0][0]) item.finish = f; }
  return item;
}
/** The finish of the gun a battle unit with no item carries (an enemy's: combat.js enemyUnit). @param {any} u */
export const unitFinish = (u) => (u && u.weapon && listOf(u.weapon) ? rollFinish(u.weapon, `u${u.id}:${u.kit || ""}`) : null);
