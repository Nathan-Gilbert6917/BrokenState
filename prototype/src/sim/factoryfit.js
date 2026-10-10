// @ts-check
// Guns found already fitted (docs/weapons-overhaul-plan.md section 22): a sniper rifle always comes with its tactical
// scope and bipod, the .50 with its scope, a marksman rifle often with a scope (60%) and a bipod (40%). The table is
// data-guns.js FACTORY_FIT; this fits it wherever a gun item is made (inventory.js newItem: loot, searches, trade,
// gun safes, trucks, bodies) and on the guns enemies carry (combat.js enemyUnit).
// A part that does not exist yet (data-gunmods.js, the economy agent) or does not fit the gun (gunmods.js ATTACH fits)
// is skipped, so this works before and after the attachments land. A mount already taken is left alone.
// Dice: chance-1 rows need none. Rows below 1 roll on a seed (the source's rng position, read and never moved, so no
// other roll changes); with no seed at all (a gun made from nothing, e.g. a trader's stock) they are left off.
import { GEAR } from "./data.js";
import { ATTACH, makeMod, modFits } from "./gunmods.js";
import { FACTORY_FIT, TRUCK_GEAR } from "./data-guns.js";
import { lootItem } from "./inventory.js"; // call time only (inventory.js imports this module)
import { hash01 } from "./skills.js";
import { setFinish } from "./data-finish.js"; // its finish (black, tan, wood...) on the same dice
import { swapGun } from "./gundist.js"; // the gun distribution (call-time only)

// The parts of a row that can go on this gun now (gunmods.js modFits: by platform and calibre, data-gunmods.js).
const usable = (gunKey, keys) => keys.filter((k) => GEAR[k] && ATTACH[k] && modFits(gunKey, k));

/** Fits the factory parts to a gun item (in place) and returns it. seed: a number (or anything) to roll the chance rows on.
 * @param {any} item @param {any} [seed] */
export function factoryFit(item, seed = null) {
  setFinish(item, seed);
  const plan = item && FACTORY_FIT[item.key];
  if (!plan) return item;
  plan.forEach(([chance, keys], i) => {
    if (chance < 1 && (seed == null || hash01(seed, item.key, i, "ffit") >= chance)) return;
    const cands = usable(item.key, keys);
    if (!cands.length) return;
    const key = cands.length === 1 ? cands[0] : cands[Math.floor(hash01(seed ?? 0, item.key, i, "ffpick") * cands.length) % cands.length];
    const mount = ATTACH[key].mount;
    if (item.mods && item.mods[mount]) return;
    (item.mods || (item.mods = {}))[mount] = makeMod(key, 1);
  });
  return item;
}

// An enemy's gun: its factory parts (a sniper rifle's scope and bipod come first), then the parts its kit gave it
// (gunmods.js enemyMods: { mount: item } or null) on the mounts still free. Returns the same shape.
/** @param {string} weapon @param {any} mods @param {any} seed @param {any} salt */
export function withFactory(weapon, mods, seed, salt) {
  if (!FACTORY_FIT[weapon]) return mods;
  const gun = factoryFit({ key: weapon }, `${seed}:${salt}`);
  for (const [mount, m] of Object.entries(mods || {})) if (m && !(gun.mods && gun.mods[mount])) (gun.mods || (gun.mods = {}))[mount] = m;
  return gun.mods && Object.keys(gun.mods).length ? gun.mods : null;
}

// A seed from newItem's `worn` argument (an rng, or a number): null when there is none.
export const seedOf = (worn) => (worn == null ? null : typeof worn === "number" ? worn : Number.isFinite(worn.state) ? worn.state : null);

// An Army truck's load (miltrucks.js TRUCK_LOOT_HOOKS): the new military weapons (data-guns.js TRUCK_GEAR), fitted as
// found. Dice from the truck's rng position, never drawn from it.
const TRUCK_COND_ITEMS = { intact: 1, wrecked: 0.6, burnt: 0 };
/** @param {any} rng @param {{ kind: string, cond: string, rich: number }} ctx @param {{ gear: any[] }} out */
export function rosterTruckGear(rng, ctx, out) {
  const rows = TRUCK_GEAR[ctx.kind] || TRUCK_GEAR.cargo;
  const seed = rng && Number.isFinite(rng.state) ? rng.state : 0;
  const m = (TRUCK_COND_ITEMS[ctx.cond] ?? 1) * (ctx.rich ?? 1);
  rows.forEach(([k, p], i) => {
    if (!GEAR[k] || hash01(seed, "trkgear", ctx.kind, k, i) >= Math.min(0.95, p * m)) return;
    out.gear.push(lootItem(swapGun(`truck:${ctx.kind}`, k, [seed, "trkgun", k, i]), ctx.cond === "intact" ? "military" : "wreck", hash01(seed, "trkdur", k, i))); // gundist.js: which gun // itemcond.js: the condition by the truck's state
  });
}
