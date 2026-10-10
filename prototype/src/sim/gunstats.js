// @ts-check
// One gun's stats as the battle uses them (docs/weapons-overhaul-plan.md section 0): playerUnit / shotOdds, the gun
// builder and the tooltips all read this, so the screen always matches the fight.
// WEAPONS stats, the fitted attachments (gunmods.js) and the loaded ammo type (ammo.js: aim, range, damage, noise,
// penetration, the soft-target bonus, jam ×). Jams and fire modes are the combat agent's (A2); the UI agent (D) reads it.
import { WEAPONS } from "./combat.js";
import { GEAR } from "./data.js";
import { gunMods, modRange, roundReach } from "./gunmods.js";
import { jamChance } from "./gunfire.js"; // jam: the battle's own per-round jam chance (call time only)
import { ammoPen, spreadFloor } from "./data-ammo.js";
import { calOf, typeFor, roundFx, loadRefusal } from "./ammo.js"; // the loaded type (ammo.js): aim, range, damage, noise, penetration
import { loadParts } from "./rounds.js"; // a load of another calibre the gun takes (.223 in a 5.56 gun)

/**
 * @param {any} itemOrKey a weapon item ({ key, mods, load, quality }) or a WEAPONS key
 * @param {{ load?: string|null, mods?: any, mag?: any }} [opts]
 */
export function gunStats(itemOrKey, opts = {}) {
  const item = typeof itemOrKey === "string" ? { key: itemOrKey } : itemOrKey;
  const w = item && WEAPONS[item.key];
  if (!w) return null;
  const m = gunMods(opts.mods ? { ...item, mods: opts.mods } : item);
  const mods = opts.mods || item.mods;
  const fit = mods && mods.mag && GEAR[mods.mag.key] && GEAR[mods.mag.key].mag ? GEAR[mods.mag.key].mag.cap : null; // a magazine item fitted (data-kit.js): its rounds
  const cap = w.cap ? Math.max(1, Math.round((fit || w.cap) * (m.capMult ?? 1)) + (m.cap || 0)) : 0;
  const cal = calOf(item.key);
  const want = opts.load ?? item.load ?? null;
  const load = cal ? typeFor(cal, want && !loadRefusal(item.key, want) ? want : null) : null; // ammo.js: a type of a calibre it takes, else its common round
  const t = cal ? roundFx(cal, load) : {}; // (its damage x the calibre's over the gun's, the calibre's aim: .223 +3)
  const lp = cal ? loadParts(cal, load) : null;
  // jam: % a round, as gunfire.js jamChance rolls it in battle (the gun's rel × its quality, its durability, the loaded
  // type, its parts and its fouling; no weather off the battle map).
  const gun = opts.mods ? { ...item, mods: opts.mods } : item;
  const jam = w.rel ? Math.round(jamChance(null, { weapon: item.key, item: gun, load, gm: m, gmWeapon: item.key }) * 1e6) / 1e4 : 0;
  return {
    cal: w.cal || null, aim: (w.aim || 0) + (m.aim || 0) + (t.aim || 0), close: (w.close || 0) + (m.close || 0) + (t.close || 0),
    opt: modRange(w, m).opt + (t.opt || 0), fall: Math.max(0, ((w.fall || 0) + (m.fall || 0)) * (t.fallMult ?? 1)),
    dmg: [Math.round(w.dmg[0] * (m.dmg ?? 1) * (t.dmg ?? 1)), Math.round(w.dmg[1] * (m.dmg ?? 1) * (t.dmg ?? 1))],
    ammoPerShot: w.ammo || 0, cap, noise: (w.noise || 0) * (m.noise ?? 1) * (t.noise || 1), weight: m.weight || 0, value: m.value || 0,
    pen: lp ? ammoPen(lp.cal, lp.type) : 0, soft: t.soft || 1, jam, reloadAp: 1, load, loadCal: lp ? lp.cal : null, type: lp ? lp.type : null,
    // An intermediate or rimfire round's reach (gunmods.js ROUND_REACH): past it, drop aim a tile more, scope or not.
    reach: roundReach(w) ? roundReach(w).reach + (t.opt || 0) : null, drop: roundReach(w) ? roundReach(w).drop : 0,
    // Shot that spreads (buckshot, birdshot: data-ammo.js spreadMult): full damage out to full tiles, then −drop a tile, min.
    // A choke adds its tiles (m.spread); the floor is never under a .22's hit (spreadFloor).
    spread: t.spreadFull != null && t.spreadDrop > 0 && lp ? { full: t.spreadFull + (m.spread || 0), drop: t.spreadDrop, min: spreadFloor(lp.type, lp.cal), choke: m.spread || 0 } : null,
  };
}
