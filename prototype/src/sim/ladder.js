// @ts-check
// The damage ladder as numbers (docs/weapons-overhaul-plan.md "Balance ladder 2026-10-10"): what a hit of each
// calibre and type does on average, the way the battle works it out, for the tests (tools/arsenalbalancetest.js) and
// any balance sheet. Pure functions over the data tables; nothing here is used in a fight.
//
// A hit's damage in battle (combat.js shotOdds / damage): the gun's dmg roll × the type's dmg (× ROUND_REACH dmg past
// a light round's reach), then on the location hit: no armour there, × soft / dmg (hollow and soft points: ammo.js
// softMult); a piece there (armour.js pieceMult), × its pass-through share or its blunt share by the round's
// penetration (ammoPen) against the piece's class and condition. Here the gun is the calibre's reference (data-ammo.js
// CAL_DMG): every gun of a calibre keeps within LADDER.BAND of it. Shot that spreads (buckshot, birdshot) loses damage
// with range (data-ammo.js spreadMult, the same function combat.js shotOdds uses): o.dist (tiles) applies it.
import { CALIBERS, AMMO_TYPES, CAL_DMG, LADDER, ammoPen, roundTier, roundValue, spreadMult } from "./data-ammo.js";
import { pieceMult } from "./armour.js";
import { ROUND_REACH } from "./gunmods.js";

const avg = (d) => (d[0] + d[1]) / 2;
const r1 = (v) => Math.round(v * 10) / 10;
// The reference targets: none, a soft vest (AC 2, new), a steel plate (AC 4, new).
export const TARGETS = { bare: null, vest: { ac: 2, cond: 1 }, plate: { ac: 4, cond: 1 } };
/** Mean damage of a hit of this calibre and type with base damage `base` (default: the calibre's reference).
 * @param {string} cal @param {string} type @param {{ ac: number, cond?: number } | null} [armour] @param {{ base?: number, past?: boolean, dist?: number, extra?: number }} [o] (extra: a choke's tiles) */
export function hitDamage(cal, type, armour = null, o = {}) {
  const t = AMMO_TYPES[type] || {};
  const base = o.base ?? avg(CAL_DMG[cal] || [0, 0]);
  const rr = ROUND_REACH[cal];
  const raw = base * (t.dmg ?? 1) * (o.past && rr ? rr.dmg ?? 1 : 1) * (o.dist != null ? spreadMult(type, o.dist, { cal, extra: o.extra || 0 }) : 1);
  if (!armour) return raw * ((t.soft ?? 1) / (t.dmg ?? 1));
  return raw * pieceMult(ammoPen(cal, type), armour.ac, armour.cond ?? 1);
}
// The range the ladder's "far" column is taken at (tiles): a shotgun's buckshot at 8 tiles, 0.6 of its hit up close.
export const FAR = 10;
// Every lethal round of a calibre on the ladder: { cal, type, tier, value, pen, bare, vest, plate, past, far }
// (far: unarmoured at FAR tiles for shot that spreads, else null).
export function ladderRows() {
  const out = [];
  for (const cal of LADDER.ORDER) {
    for (const type of CALIBERS[cal].types) {
      const t = AMMO_TYPES[type];
      if (!t || t.nonlethal || t.launch) continue;
      out.push({
        cal, type, name: `${CALIBERS[cal].name} ${t.name}`, base: type === CALIBERS[cal].base, tier: roundTier(cal, type), value: roundValue(cal, type), pen: ammoPen(cal, type),
        bare: r1(hitDamage(cal, type)), vest: r1(hitDamage(cal, type, TARGETS.vest)), plate: r1(hitDamage(cal, type, TARGETS.plate)),
        past: ROUND_REACH[cal] ? r1(hitDamage(cal, type, null, { past: true })) : null,
        far: spreadMult(type, FAR, { cal }) < 1 ? r1(hitDamage(cal, type, null, { dist: FAR })) : null,
      });
    }
  }
  return out;
}
// The calibre's base round on an unarmoured target (the ladder's rungs).
export const rung = (cal) => hitDamage(cal, CALIBERS[cal].base);
// A gun's mean hit with its calibre's base round (its own dmg), unarmoured and on a vest; dist: at that range (tiles).
/** @param {any} w a WEAPONS entry @param {string | null} [type] @param {number} [dist] */
export function gunHit(w, type = null, dist = undefined) {
  const ty = type || CALIBERS[w.cal].base;
  const o = { base: avg(w.dmg), dist };
  return { bare: r1(hitDamage(w.cal, ty, null, o)), vest: r1(hitDamage(w.cal, ty, TARGETS.vest, o)) };
}
