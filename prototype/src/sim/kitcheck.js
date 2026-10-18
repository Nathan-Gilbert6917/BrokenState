// @ts-check
// The kit check before a fight (2026-10-18 user requests: "if anyone has an empty gun let that be known in the starting
// raid window to go into the inventory to reload the gun before the start of the raid or proceed without reloading";
// "also let it be known if no healing items or low health survivors are in the team"). ui/combat.js kitWarnHtml shows
// it as a card on the first turn until Proceed (b.kitWarnSeen) or nothing is left to say.
//   - empty: each of yours whose gun has too few rounds for a shot (combat.js magEmpty), with the rounds for it they
//     carry (mags.js roundSources: a Reload from them, 1 action a pocket or the rig, both the pack) or none;
//   - heal: no healing on the team at all: no meds in the bags (combat.js medsLeft), nobody with a med kit (medics.js
//     isMedic), no tourniquet or trauma kit in reach (selfKit), no medical item carried (data.js cat "medical", a
//     supply item of meds);
//   - hurt: anyone below HURT_HP (of 100).
import { GEAR } from "./data.js";
import { survivorById } from "./world.js";
import { carriedSpots } from "./inventory.js";
import { WEAPONS, isRanged, hasMag, magEmpty, medsLeft, magLabel } from "./combat.js";
import { isMedic, selfKit } from "./medics.js";
import { roundSources, isStacked } from "./mags.js";
import { calOf, roundName } from "./ammo.js";

export const HURT_HP = 50;
const first = (u) => String(u.name || "").split(" ")[0];
const medical = (it) => !!(it && GEAR[it.key] && (GEAR[it.key].medKit || GEAR[it.key].selfStab || GEAR[it.key].supKey === "meds" || GEAR[it.key].cat === "medical"));

// { empty: [{ uid, name, gun, label, rounds, text }], heal: "" | the warning, hurt: [{ uid, name, hp, text }], any }.
/** @param {any} state @param {any} b */
export function kitWarnings(state, b) {
  const out = { empty: [], heal: "", hurt: [], any: false };
  if (!b || !Array.isArray(b.units)) return out;
  const mine = b.units.filter((u) => u.side === "player" && u.sid != null && u.vol == null && !u.dead && !u.left && !u.fled);
  for (const u of mine) {
    if (isRanged(u) && hasMag(u) && magEmpty(b, u) && !u.gunner) {
      const cal = calOf(u.weapon);
      const rounds = isStacked(u) ? roundSources(u).reduce((a, s) => a + s.n, 0) : 0;
      const where = isStacked(u) ? [...new Set(roundSources(u).map((s) => s.where))] : [];
      const gun = u.weaponName || (WEAPONS[u.weapon] && WEAPONS[u.weapon].name) || "gun";
      const text = rounds > 0
        ? `${first(u)}'s ${gun} is empty (${magLabel(b, u)}): ${rounds} ${cal ? roundName(cal, null).split(" ")[0] : ""} rounds for it in ${where.map((w) => (w === "pack" ? "the pack" : w === "rig" ? "the rig" : "a pocket")).join(" and ")}. Reload it in the Inventory (${where.every((w) => w === "pack") ? "both actions from the pack" : "1 action from a pocket or the rig"}), or go in and reload under fire.`
        : `${first(u)}'s ${gun} is empty (${magLabel(b, u)}) and they carry no rounds for it: it stays empty (a club) unless a teammate hands some over.`;
      out.empty.push({ uid: u.id, name: u.name, gun, label: magLabel(b, u), rounds, text });
    }
    if (u.maxHp > 0 && u.hp < HURT_HP) out.hurt.push({ uid: u.id, name: u.name, hp: Math.round(u.hp), text: `${first(u)} is hurt (${Math.round(u.hp)} hp): a bad place to take another hit.` });
  }
  const meds = medsLeft(b);
  const kits = mine.some((u) => isMedic(u) || selfKit(u));
  const items = mine.some((u) => { const s = survivorById(state, u.sid); return s && carriedSpots(s).some((x) => medical(x.item)); });
  if (mine.length && !(meds > 0) && !kits && !items) out.heal = "No healing on the team: no meds in the bags, no med kit, tourniquet or trauma kit on anyone. Nobody down can be stabilized but by hand, and nobody is healed.";
  out.any = !!(out.empty.length || out.heal || out.hurt.length);
  return out;
}
// Should the card show now: the first turn of the fight, your turn, not put aside, something to say.
/** @param {any} state @param {any} b */
export const kitWarnDue = (state, b) => !!(b && !b.over && b.phase === "player" && (b.turn || 1) <= 1 && !b.kitWarnSeen && kitWarnings(state, b).any);
