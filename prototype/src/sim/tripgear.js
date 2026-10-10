// Gear for the outdoor workers (trips-plus #2, user rule "AI should gear them enough to survive these occurrences"):
// what someone going out on a job trip has to meet trouble with (sim/tripevents.js reads it), the warning chips
// ("No weapon"), and one pass that hands them what the base armory can spare, used by the governor and the base
// leaders (autopilot.js equipFromArmory, after the fighters' share), by "Assign all idle" (idlework) and by the Work now
// panel's "Gear outdoor workers" button.
//
// What a worker going out is given, from the armory only (nobody else is stripped), each piece only to someone without
// one:
//   - a weapon they can use (gearEffect usable): a hunter a gun or bow it has rounds or arrows for (the best for
//     hunting, hunting.js bestHuntWeapon's numbers), else the best melee weapon; everyone else the best melee weapon
//     (quiet: no noise to draw the dead), a gun only when there is no melee weapon and the base has rounds for it;
//   - a light for the dusk jobs (hunting and fishing: home after dark): the lightest that works (lights.js packLights);
//   - basic body armour if there is any spare (the lightest piece under GEAR_OUT.armourKg: a jacket or a vest, not a plate
//     carrier for a woodcutter);
//   - something to stop a bleed: a tourniquet (one use; GEAR_OUT.tqKept stay for a team), else a bandage kit or trauma
//     kit while the armory keeps GEAR_OUT.kitsKept of those for the medics.
// Pinned people are left alone by the governor and the leaders (as all their gear passes); the button gears them too
// (it is your own order).
import { GEAR } from "./data.js";
import { atBase, gearEffect, combatPower, usesArrows } from "./world.js";
import { calOf, drawShots } from "./ammo.js";
import { armorPower, allCarried, stow, isSmall, itemArmor } from "./inventory.js";
import { lightOf, packLights } from "./lights.js";
import { TRIP_JOBS } from "./tripland.js";
import { isChopTool } from "./woodcutting.js";

export const GEAR_OUT = { armourKg: 6, kitsKept: 1, tqKept: 1 }; // kept in the armory: a med kit for the medics, a tourniquet for a team
const DUSK = new Set(["hunt", "fish"]); // home after dark: a light helps
const isOut = (s) => !!(s && s.alive && TRIP_JOBS[s.role]);
const isMelee = (d) => !!d && d.cat === "melee";
const isBowKey = (k) => !!(GEAR[k] && (GEAR[k].cat === "bow" || k === "crossbow"));
// Rounds or arrows for this weapon at the base (a dry run on a copy of the stock).
function ammoFor(base, s, it) {
  if (!it) return false;
  if (calOf(it.key)) { const was = s.gear.weapon; s.gear.weapon = it; const n = drawShots({ ...(base.stock || {}) }, [s], 1).n; s.gear.weapon = was; return n >= 1; }
  if (isBowKey(it.key)) return (base.stock && base.stock.arrows || 0) >= 1;
  return true;
}
// The aid they carry: a tourniquet or a kit that stops a bleed (selfStab), else any med kit; or null.
export const aidOf = (s) => allCarried(s).find((it) => GEAR[it.key] && GEAR[it.key].selfStab) || allCarried(s).find((it) => GEAR[it.key] && GEAR[it.key].medKit) || null;

// What someone has to meet trouble with on a trip: { weapon (item they can use, or null), gun, bow, melee, ready (a gun
// with rounds at the base, a bow with arrows, or a melee weapon), armour (armorPower), light (lights.js key), aid (item) }.
export function tripKit(state, base, s) {
  const it = s && s.gear ? s.gear.weapon : null;
  const d = it ? GEAR[it.key] : null;
  const usable = !!(it && d && gearEffect(s, it).usable);
  const gun = usable && !!calOf(it.key);
  const bow = usable && !gun && (usesArrows(s) || isBowKey(it.key));
  return {
    weapon: usable ? it : null, gun, bow, melee: usable && !gun && !bow,
    ready: usable && (!(gun || bow) || ammoFor(base, s, it)),
    armour: armorPower(s), light: lightOf(s), aid: aidOf(s),
  };
}
// The warnings for an outdoor worker's chip: [{ key, text, tip }] (empty when they are geared).
export function kitWarnings(state, base, s) {
  if (!isOut(s)) return [];
  const k = tripKit(state, base, s);
  const out = [];
  if (!k.weapon) out.push({ key: "weapon", text: "No weapon", tip: "Out on the land with nothing to fight with: the dead, a wild animal or a robber is met with bare hands (Gear outdoor workers, or give them one from the armory)." });
  else if (!k.ready) out.push({ key: "ammo", text: k.bow ? "No arrows" : "No rounds", tip: `${k.weapon.name}: nothing to shoot with at the base, so it is only a club out there.` });
  if (DUSK.has(s.role) && !k.light) out.push({ key: "light", text: "No light", tip: "Home after dark from the dusk hunt or fishing: without a light they see trouble later and get lost more." });
  return out;
}
export const ungeared = (state, base, s) => kitWarnings(state, base, s).some((w) => w.key === "weapon" || w.key === "ammo");

// How good a weapon is for this worker's trips (higher is better; 0 = not for them).
function weaponScore(base, s, it) {
  const d = GEAR[it.key];
  if (!d || d.slot !== "weapon") return 0;
  const eff = gearEffect(s, it);
  if (!eff.usable) return 0;
  const power = (d.power || 0) * eff.mult * (it.quality || 1);
  const shoots = !!calOf(it.key) || isBowKey(it.key);
  if (shoots && !ammoFor(base, s, it)) return 0;
  if (s.role === "hunt") return shoots ? 10 + power : 1 + power; // a hunter wants something to hunt with
  const chop = s.role === "wood" && isChopTool(it) ? 3 : 0; // a woodcutter's axe or machete cuts wood too
  return isMelee(d) ? 10 + power + chop : shoots ? 1 + power * 0.5 : 0.5 + power * 0.5 + chop; // the others: quiet first
}

// Hands the outdoor workers of a base what the armory can spare (see the top). opts.pinned: gear pinned people too
// (the button); opts.who: only these people. Returns [{ s, item, what }] (what: "weapon", "light", "armour", "aid").
export function gearOutdoorWorkers(state, base, opts = {}) {
  const out = [];
  if (!base || !Array.isArray(base.armory)) return out;
  let people = atBase(state, base.id).filter((s) => isOut(s) && (opts.pinned || !s.pinned));
  if (opts.who) people = people.filter((s) => opts.who.includes(s));
  people.sort((a, b) => (a.role === "hunt" ? 0 : 1) - (b.role === "hunt" ? 0 : 1) || combatPower(b) - combatPower(a) || a.id - b.id);
  const take = (it) => { const i = base.armory.indexOf(it); if (i >= 0) base.armory.splice(i, 1); };
  for (const s of people) {
    const k = tripKit(state, base, s);
    // A weapon: someone with none they can use (or a gun with nothing to shoot), from the armory.
    if (!k.weapon || !k.ready) {
      const cur = k.weapon && k.ready ? weaponScore(base, s, k.weapon) : 0;
      const best = base.armory.filter((it) => GEAR[it.key] && GEAR[it.key].slot === "weapon").map((it) => ({ it, v: weaponScore(base, s, it) })).filter((x) => x.v > cur).sort((a, b) => b.v - a.v || a.it.key.localeCompare(b.it.key))[0];
      if (best) {
        take(best.it);
        if (s.gear.weapon) base.armory.push(s.gear.weapon);
        s.gear.weapon = best.it;
        out.push({ s, item: best.it, what: "weapon" });
      }
    }
    // A light for the dusk jobs.
    if (DUSK.has(s.role) && !lightOf(s)) for (const name of packLights(base, [s])) out.push({ s, item: { name }, what: "light" });
    // Basic body armour, if there is a light piece spare.
    if (!s.gear.armor && armorPower(s) < 1) {
      const a = base.armory.filter((it) => GEAR[it.key] && GEAR[it.key].slot === "armor" && itemArmor(it) > 0 && (GEAR[it.key].weight || 0) <= GEAR_OUT.armourKg)
        .sort((x, y) => (GEAR[x.key].weight || 0) - (GEAR[y.key].weight || 0) || itemArmor(y) - itemArmor(x) || x.key.localeCompare(y.key))[0];
      if (a) { take(a); s.gear.armor = a; out.push({ s, item: a, what: "armour" }); }
    }
    // Something to stop a bleed.
    if (!aidOf(s)) {
      const tqs = base.armory.filter((it) => GEAR[it.key] && GEAR[it.key].selfStab && !GEAR[it.key].medKit);
      const tq = tqs.length > GEAR_OUT.tqKept ? tqs[0] : null;
      const kits = base.armory.filter((it) => GEAR[it.key] && GEAR[it.key].medKit && isSmall(it.key) && (GEAR[it.key].req || 0) <= 4);
      const it = tq || (kits.length > GEAR_OUT.kitsKept ? kits.sort((a, b) => (GEAR[b.key].selfStab ? 1 : 0) - (GEAR[a.key].selfStab ? 1 : 0) || a.key.localeCompare(b.key))[0] : null);
      if (it) {
        take(it);
        const was = s.gear.tool;
        if (GEAR[it.key].slot === "tool" && !was) s.gear.tool = it; // an empty off hand: held (a medic's kit there too)
        else if (!stow(s, it)) { base.armory.push(it); continue; }
        out.push({ s, item: it, what: "aid" });
      }
    }
  }
  return out;
}
// "Ann: machete, Bo: headlamp" for a log line.
export const gearText = (list) => list.map((x) => `${x.s.name.split(" ")[0]}: ${String(x.item.name || "").toLowerCase()}`).join(", ");
