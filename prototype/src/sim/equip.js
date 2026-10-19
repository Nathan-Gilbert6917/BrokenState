// Handing gear out of an armory onto people: the one rule for your governor (autopilot.js equipFromArmory) and the AI
// groups' loadouts (loadouts.js kitOut) alike (docs/adr/0001-ai-parity.md: decisions may differ, rules may not).
//   - Each slot in turn (the hands, the body, the head, the arms, the legs, the pack), the best fighters first: the
//     best piece for them (itemScore: a weapon by its power at their skill, armour by its power, a pack by what it
//     carries), and only a real upgrade over what they wear (what comes off goes back into the armory).
//   - Loose gun attachments onto the guns in hand (gunmods.js fitFromPool), then the carry kit (carrykit.js equipKit:
//     a rig, plates into carriers, spare magazines into pouches).
//   - Tools for the off hand: a crowbar to a scavenger, a med kit to a medic (else the best Medicine), anything else to
//     whoever has the skill for it. Water filters stay in the armory.
// The armory is a plain list, changed in place. Returns [{ s, item }] of what was handed out.
import { GEAR } from "./data.js";
import { gearEffect, meleeDmgMult, skill } from "./world.js";
import { ensureInv } from "./inventory.js";
import { fitFromPool } from "./gunmods.js";
import { equipKit } from "./carrykit.js";

export const EQUIP_ORDER = ["weapon", "armor", "head", "arms", "legs", "backpack"];
const slotOf = (key) => (GEAR[key] ? GEAR[key].slot : null);

export function itemScore(s, item) { // also the roster's Equip best available (sim/bulk.js)
  if (!item || !GEAR[item.key]) return 0;
  const d = GEAR[item.key];
  if (d.slot === "weapon") {
    const eff = gearEffect(s, item);
    if (d.launcher) return eff.usable ? 0.5 + 1.5 * eff.mult : -1; // a launcher (launchers.js) is a second weapon: better than empty hands, never instead of a gun
    return eff.usable ? 0.5 + d.power * eff.mult * (item.quality || 1) * (d.cat === "melee" ? meleeDmgMult(s) : 1) : -1; // a melee weapon by their Melee (world.js MELEE_SKILL): a strong hand keeps a fire axe over a weak gun
  }
  if (d.slot === "backpack") return d.carry || 0;
  return d.power || 0;
}

// people: best fighters first. opts.weaponOk(s, item): false keeps a weapon off someone (the governor's outdoor kit).
// opts.medic(s): true for a person on medic duty (a med kit goes to them first). opts.scavenger(s): the same for a crowbar.
export function equipPeople(armory, people, opts = {}) {
  const handed = [];
  if (!Array.isArray(armory) || !armory.length || !people.length) return handed;
  for (const slot of EQUIP_ORDER) {
    // This slot's pieces in the armory's order, kept in step with it (taken out as handed, what comes off added at the
    // end as it is to the armory): the armory is not walked again for every person.
    const items = armory.filter((it) => slotOf(it.key) === slot);
    for (const s of people) {
      ensureInv(s);
      if (!items.length) break;
      // The best piece for them: the first in the armory's order with the top score (what a stable sort by score put
      // first), each piece scored once (itemScore is pure; a sort scored each one 2 log n times, and this runs for
      // every person, every slot, every base each hour and every group each day).
      let best = items[0], top = itemScore(s, best);
      for (let i = 1; i < items.length; i++) {
        const sc = itemScore(s, items[i]);
        if (sc > top || (Number.isNaN(top) && !Number.isNaN(sc))) { best = items[i]; top = sc; }
      }
      if (top < itemScore(s, s.gear[slot]) + (s.gear[slot] ? 0.3 : 0.05)) continue; // only real upgrades
      if (slot === "weapon" && opts.weaponOk && !opts.weaponOk(s, best)) continue;
      armory.splice(armory.indexOf(best), 1);
      items.splice(items.indexOf(best), 1);
      const off = s.gear[slot];
      if (off) { armory.push(off); if (slotOf(off.key) === slot) items.push(off); }
      s.gear[slot] = best;
      handed.push({ s, item: best });
    }
  }
  for (const x of fitFromPool(armory, people.map((s) => s.gear.weapon))) handed.push({ s: null, item: x.mod, gun: x.gun });
  for (const x of equipKit(armory, people)) handed.push({ s: x.s, item: x.item });
  return handed;
}
// The off hand's tools (after the governor's plates: autopilot.js governPlates).
export function equipTools(armory, people, opts = {}) {
  const handed = [];
  for (const item of [...armory]) {
    const d = GEAR[item.key];
    if (!d || d.slot !== "tool" || d.water) continue;
    const forScav = !!(d.bonus && d.bonus.scavenging);
    const free = people.filter((s) => !s.gear.tool && (!d.skill || gearEffect(s, item).usable) && (!forScav || (opts.scavenger && opts.scavenger(s))));
    if (!free.length) continue;
    const want = forScav ? (s) => skill(s, "scavenging") : d.medKit ? (s) => (opts.medic && opts.medic(s) ? 20 : 0) + skill(s, "medicine") : (s) => (d.skill ? skill(s, d.skill) : 0);
    const s = free.sort((a, b) => want(b) - want(a))[0];
    armory.splice(armory.indexOf(item), 1);
    s.gear.tool = item;
    handed.push({ s, item });
  }
  return handed;
}
