// AI parity: the other groups look after themselves with the systems you use (user, 2026-10-07: "AI groups use all
// the same game system mechanics and try to stay alive by repairing, healing, expanding, handling scenarios").
// Coarse and cheap: one pass a day per group (factions.js factionsDaily), counts rather than people.
//
// Wounded (f.wounded): a fight leaves WOUND_PER_DEAD wounded for each of a group's dead (a fight by the numbers you
// won: the 40% of their "killed" that conflicts.js did not count as dead). The wounded do not fight (fitPeople:
// arsenal.js strength counts the fit), and heal HEAL a day, HEAL + HEAL_MEDS with meds (MEDS a wounded head a day from
// their stock); with none, DIE_NO_MEDS of them a day die of their wounds.
// Repairs (repairGear): a group with a workshop (groupworks.js "bench", what a workbench is for you) mends its kit by
// the rules of your repairs (repair.js on ow-economy: the same formula, to be wired to it): every REPAIR.every days up
// to one piece per REPAIR.perPop people below REPAIR.below of its maximum, best first, back to its maximum, the maximum
// dropping by restored × max(0.08, 0.25 − 0.01 × skill) (the group's mechanic: REPAIR.skill by type). Inputs from
// their stock: guns a part per 20% of full durability restored and a scrap; hard armour a part and 2 scrap; soft
// armour 2 scrap and a part (for the kevlar kit); makeshift and melee 1 scrap. Ceramic plates and worn-out pieces
// (maximum under 20% of full) are not mended.
// Vehicles (f.vehicles): a turreted vehicle loses VEHICLE.fight condition a fight it is in (VEHICLE.lost when its side
// loses); at 0 it is out (vehicles.js groupTurret). With a workshop, one in need (under VEHICLE.below) gets
// VEHICLE.step back a day for a part and 2 scrap.
// Hunger (hungerTrade): a group with under HUNGER.below days of food a head buys food from a group that has HUNGER.rich
// (not one at war with it, relation above HUNGER.rel; a member of its bloc first, blocs.js), paying with ammo, scrap,
// fuel and meds at their worth (data.js SUPPLIES) × HUNGER.markup (1 from a bloc member), once every HUNGER.gap days.
// Raids (raidAnswer): a group raided by a group HOLD_RATIO × stronger than its defence at a base pays tribute
// (TRIBUTE share of its food, ammo, meds and scrap) TRIBUTE_ODDS of the time instead of fighting, as you can.
// Expansion (canExpand): a new base takes EXPAND.scrap scrap and EXPAND.fit fit people at home.
// Medics (medicsOf): a group's people with Medicine, by its size and type (MEDIC_SHARE x the profile's heal), speed the
// healing (HEAL_MEDIC while there are MEDIC_CARE wounded or fewer to each). Without meds the wounded also die faster
// (DIE_NO_MEDS against DIE_MEDS). A fight's wounded: noteFight (WOUND_PER_DEAD for each dead, and its losses for
// desertion).
// Profiles (GROUP_PRIORITIES): one table of what each type of group leans to; the AI choices here and in factions.js,
// aiscav.js and arsenal.js read its weight x the situation (prio). Desertion (desertDaily): a group under pressure
// (hunger, no beds, recent losses, many wounded, at war) x its harshness loses people; a deserter takes their own gun
// and armour and becomes a wanderer (wanderers.js), joins a better-off group nearby, or comes to your base for a
// recruit card. Recruiting: wanderers near their bases join by the profile, food and beds (wandererJoinChance); your
// own deserters who do not come back may join a group near the base they left (playerDeserters).
// Every roll is a hash (skills.js hash01): the world's dice are not touched (bar a recruit card's own).
import { SUPPLIES, GEAR } from "./data.js";
import { day, log, hub } from "./world.js";
import { Rng } from "./rng.js";
import { growthFactor } from "./groupworks.js";
import { issueKit, removeFromArsenal, addToArsenal } from "./arsenal.js";
import { stripAll } from "./inventory.js";
import { makeCandidate, offerRecruits, RETURN } from "./recruits.js";
import { newNeutralGroup } from "./wanderers.js";
import { hash01 } from "./skills.js";
import { itemDur, itemDurMax } from "./crafting.js";
import { workshopFactor } from "./groupworks.js";
import { factionVehicles, groupTurret, upgradesOf } from "./vehicles.js";
import { relation, warsOf } from "./diplomacy.js";
import { sameBloc } from "./blocs.js"; // AI blocs: food bought from a member first
import { atWarWithYou } from "./playerwars.js"; // a war with you presses on desertion

// What each type of group leans to (1 = an ordinary group). Read through prio(); the situation multiplies it.
// Wired now: scavenge (aiscav.js trip gap), trade (buying food when short), raid (factions.js raid chance), expand,
// repair, heal (medics), recruit (growth, wanderers, press-gangs), craft (arsenal.js), yield (tribute instead of a
// fight), harsh (desertion), vehicles (taking, fitting: groupvehicles.js), ally (blocs.js), warlike (diplomacy.js,
// playerwars.js), peaceful (playerwars.js), hide (hiding.js), silent (radiolisten.js), listen (intel.js).
// Folded in: nonlethal.js NL_TAKE (takeAlive), groupworks.js WALLED_TYPES (walled), escorts.js's home guard (escort),
// groupjails.js prisoners recruited after a long hold (× recruit). Still separate (TODO, lead): nonlethal.js NL_STYLE /
// NL_KIT (by battle kit, not group type), groupworks.js build order (one order for every type), groupjails.js GROUP_JAIL
// EARLY / LATE / FULL / BUYERS / WORK (jails, what to do with no room, labour: could read prisoners / harsh / trade),
// FACTION_TYPES food / expand / raid (the types' base rates; the profile scales them), wanderers.js military squads
// (patrol), throwables.js FLASH_KIT and medics.js MEDIC.ENEMY (by kit; arsenal.js ARSENAL.NONLETHAL seeds the items).
export const GROUP_PRIORITIES = {
  // takeAlive: the share of a beaten group's losses the winners take alive (nonlethal.js NL_TAKE reads it); walled:
  // builds the full wall goal at every base (groupworks.js WALLED_TYPES reads it); escort: × the share of its fighters
  // a group puts on a caravan (escorts.js groupCapacity). ally: how readily it joins a bloc (blocs.js: forming, joining,
  // the help it sends a member, the wars of its bloc it joins); warlike: its temper for war (diplomacy.js declareWars
  // between groups, the old TEMPER table; playerwars.js a war declared on you); peaceful: how readily it takes terms and
  // how fast a war wears it down (playerwars.js termsChance, weariness). hide: the share of its outposts it keeps hidden
// (× hiding.js HIDE.AI_SHARE); silent: its radio discipline (radiolisten.js silentMult: its channel says less in the
// clear); listen: how keenly it listens in on you and on others (intel.js: its listener's Scouting and days on the set).
  raider:      { takeAlive: 0.25, walled: 0, escort: 0.8, scavenge: 1.0, trade: 0.3, raid: 1.5, build: 0.6, expand: 1.1, fortify: 0.6, prisoners: 1.2, nonlethal: 0.3, repair: 0.7, heal: 0.6, recruit: 1.2, caravan: 0.2, farm: 0.6, craft: 1.1, yield: 0.3, harsh: 1.4, ransom: 1.0, patrol: 0.8, vehicles: 1.3, steal: 1.5, ally: 0.7, warlike: 1.5, peaceful: 0.6, hide: 0.5, silent: 0.6, listen: 1.2 },
  expansionist: { takeAlive: 0.2, walled: 0, escort: 1.1, scavenge: 1.1, trade: 0.9, raid: 1.0, build: 1.1, expand: 1.5, fortify: 0.9, prisoners: 1.0, nonlethal: 0.7, repair: 1.0, heal: 0.9, recruit: 1.4, caravan: 1.3, farm: 1.0, craft: 1.0, yield: 0.5, harsh: 1.0, ransom: 1.0, patrol: 1.0, vehicles: 1.2, steal: 0.8, ally: 0.6, warlike: 1.4, peaceful: 0.8, hide: 0.2, silent: 0.3, listen: 1.0 },
  zealot:       { takeAlive: 0, walled: 0, escort: 0.8, scavenge: 0.8, trade: 0.4, raid: 1.2, build: 0.9, expand: 0.9, fortify: 1.0, prisoners: 1.3, nonlethal: 0.2, repair: 0.6, heal: 0.7, recruit: 1.0, caravan: 0.3, farm: 1.0, craft: 0.8, yield: 0.0, harsh: 1.3, ransom: 0.0, patrol: 1.0, vehicles: 0.6, steal: 0.7, ally: 0.4, warlike: 1.2, peaceful: 0.2, hide: 0.6, silent: 0.7, listen: 0.8 },
  military:     { takeAlive: 0.35, walled: 1, escort: 1, scavenge: 0.9, trade: 0.8, raid: 0.4, build: 1.0, expand: 0.8, fortify: 1.3, prisoners: 1.2, nonlethal: 1.1, repair: 1.4, heal: 1.3, recruit: 0.8, caravan: 0.8, farm: 0.8, craft: 1.2, yield: 0.6, harsh: 1.1, ransom: 0.8, patrol: 1.4, vehicles: 1.5, steal: 0.3, ally: 0.9, warlike: 0.5, peaceful: 1.0, hide: 0.4, silent: 0.8, listen: 1.5 },
  fortress:     { takeAlive: 0.35, walled: 1, escort: 0.9, scavenge: 0.9, trade: 1.0, raid: 0.3, build: 1.3, expand: 0.5, fortify: 1.5, prisoners: 0.9, nonlethal: 0.9, repair: 1.4, heal: 1.1, recruit: 0.9, caravan: 0.9, farm: 1.1, craft: 1.2, yield: 0.7, harsh: 0.9, ransom: 1.0, patrol: 0.9, vehicles: 1.0, steal: 0.3, ally: 1.3, warlike: 0.3, peaceful: 1.1, hide: 0.1, silent: 0.3, listen: 1.0 },
  traders:      { takeAlive: 0.45, walled: 0, escort: 1.2, scavenge: 1.0, trade: 1.5, raid: 0.1, build: 1.0, expand: 0.9, fortify: 0.8, prisoners: 0.6, nonlethal: 1.2, repair: 1.0, heal: 1.1, recruit: 1.0, caravan: 1.5, farm: 0.9, craft: 0.9, yield: 1.2, harsh: 0.8, ransom: 1.2, patrol: 0.8, vehicles: 1.1, steal: 0.2, ally: 1.4, warlike: 0.1, peaceful: 1.5, hide: 0, silent: 0, listen: 1.2 },
  commune:      { takeAlive: 0.4, walled: 0, escort: 1, scavenge: 0.9, trade: 1.3, raid: 0.0, build: 1.1, expand: 0.9, fortify: 0.7, prisoners: 0.4, nonlethal: 1.5, repair: 0.9, heal: 1.4, recruit: 1.4, caravan: 1.0, farm: 1.5, craft: 0.8, yield: 1.3, harsh: 0.6, ransom: 1.0, patrol: 0.6, vehicles: 0.5, steal: 0.1, ally: 1.5, warlike: 0.1, peaceful: 1.6, hide: 0.3, silent: 0.2, listen: 0.6 },
};
// A type's weight for an action (1 for an unknown type or action).
export const weightOf = (f, act, dflt = 1) => ((GROUP_PRIORITIES[f && f.type] || {})[act] ?? dflt);
// The weight x the situation: hunger and the wounded push some choices up and others down.
export function prio(f, act) {
  const w = weightOf(f, act);
  const pop = Math.max(1, (f && f.pop) || 0);
  const hungry = f && f.stock && (f.stock.food || 0) < pop * 3 ? 1 : 0;
  const hurt = woundedOf(f) / pop;
  switch (act) {
    case "raid": return w * (1 + 0.5 * hungry * w) * (1 - Math.min(0.6, hurt)); // the hungry raid more (raiders most), the hurt less
    case "trade": return w * (1 + hungry);
    case "scavenge": return w * (1 + 0.3 * hungry);
    case "expand": return w * (1 - Math.min(0.8, hurt * 2)) * (hungry ? 0.5 : 1);
    case "recruit": return w * (hungry ? 0.5 : 1);
    default: return w;
  }
}

export const CARE = {
  WOUND_PER_DEAD: 1.5, HEAL: 0.06, HEAL_MEDS: 0.08, HEAL_MEDIC: 0.08, MEDS: 0.1, DIE_NO_MEDS: 0.015, DIE_MEDS: 0.002,
  MEDIC_SHARE: 0.06, MEDIC_CARE: 3,
  DESERT: { base: 0.015, max: 0.15, decay: 0.95, toPlayer: 0.25, toGroup: 0.35, range: 15, playerRange: 12, playerJoin: 0.02 },
  WANDER_JOIN: 0.04, // a day, a wanderer group within 3 tiles of a base (wanderers.js SIM.JOIN_GROUP, now by profile)
  REPAIR: { every: 2, below: 0.6, perPop: 10, skill: { military: 6, fortress: 5, expansionist: 4, traders: 4, raider: 3, zealot: 2, commune: 3 },
    lossBase: 0.25, lossPer: 0.01, lossMin: 0.08, wornOut: 0.2, gunStep: 0.2 },
  VEHICLE: { fight: [2, 6], lost: [10, 25], below: 80, step: 15, parts: 1, scrap: 2 },
  HUNGER: { below: 2, rich: 8, want: 4, markup: 1.3, gap: 5, rel: -15 },
  HOLD_RATIO: 1.4, TRIBUTE_ODDS: 0.4, TRIBUTE: 0.25,
  EXPAND: { scrap: 8, fit: 8 },
};
const h = (state, ...k) => hash01(state.seed, "groupcare", ...k);
// A group's own day count (factions.js factionsDaily ticks it): the daily rolls' salt, so a test that runs the groups'
// day over and over without the clock moving still rolls new dice.
export const tickOf = (f) => (f && f.careTick) || 0;
export function tickGroup(f) { f.careTick = (f.careTick || 0) + 1; return f.careTick; }
const known = (state, ...fs) => fs.some((f) => f && f.known);

// ---------- the wounded ----------
export const woundedOf = (f) => (f ? Math.max(0, Math.min(f.pop || 0, Math.round(f.wounded || 0))) : 0);
export const fitPeople = (f) => Math.max(0, (f.pop || 0) - woundedOf(f));
export function woundGroup(f, n) {
  if (!f || !(n > 0)) return;
  f.wounded = Math.min(f.pop || 0, (f.wounded || 0) + Math.round(n));
}
// The wounded a fight leaves for `dead` dead.
export const woundsFor = (dead) => Math.round(Math.max(0, dead) * CARE.WOUND_PER_DEAD);

// A group's medics: its people with Medicine, by size and type.
export const medicsOf = (f) => Math.round(fitPeople(f) * CARE.MEDIC_SHARE * weightOf(f, "heal"));
// Today's healing: { rate (share healed), die (share dying), meds (spent from their stock) }.
export function healRate(f) {
  const w = woundedOf(f);
  const need = Math.ceil(w * CARE.MEDS);
  const meds = w > 0 && (f.stock.meds || 0) >= need;
  const care = w ? Math.min(1, (medicsOf(f) * CARE.MEDIC_CARE) / w) : 0;
  return { rate: CARE.HEAL + (meds ? CARE.HEAL_MEDS : 0) + CARE.HEAL_MEDIC * care, die: meds ? CARE.DIE_MEDS : CARE.DIE_NO_MEDS, meds: meds ? need : 0 };
}
function heal(state, f, d) {
  const w = woundedOf(f);
  f.wounded = w;
  if (f.lossRecent) f.lossRecent = f.lossRecent * CARE.DESERT.decay < 0.05 ? 0 : f.lossRecent * CARE.DESERT.decay;
  if (!w) return;
  const r = healRate(f);
  if (r.meds) { f.stock.meds -= r.meds; f.medsUsed = (f.medsUsed || 0) + r.meds; }
  const healed = Math.min(w, Math.floor(w * r.rate + h(state, f.name, tickOf(f), "heal")));
  f.wounded = w - healed;
  const dead = Math.min(f.wounded, Math.floor(f.wounded * r.die + h(state, f.name, tickOf(f), "die")));
  if (dead > 0) { f.wounded -= dead; f.pop = Math.max(0, f.pop - dead); f.diedOfWounds = (f.diedOfWounds || 0) + dead; }
}
// After a fight: the group's dead and wounded (and the losses that make people think of leaving).
export function noteFight(f, dead, wounded = null) {
  if (!f || f.outsider) return;
  woundGroup(f, wounded == null ? woundsFor(dead) : wounded);
  if (dead > 0) f.lossRecent = (f.lossRecent || 0) + dead;
}

// ---------- repairs (the same contract as repair.js: repairMath / repairInputs) ----------
const GUN_CATS = ["pistol", "shotgun", "rifle", "automatic"];
const SOFT = ["vest", "tacvest", "softinsert"];
const CERAMIC = ["plate", "ceramicplate"];
export function groupLossRate(skill) { const R = CARE.REPAIR; return Math.max(R.lossMin, R.lossBase - R.lossPer * Math.max(0, skill || 0)); }
// What mending one piece takes and does: { restore, newMax, parts, scrap } or null (nothing to mend, or it cannot be).
export function groupRepairPlan(item, skill) {
  const d = item && GEAR[item.key];
  if (!d || !d.dur || d.throw) return null;
  const max = itemDurMax(item), dur = itemDur(item);
  if (max == null || dur == null || dur >= max) return null;
  if (max < CARE.REPAIR.wornOut * d.dur - 1e-9) return null; // worn out
  if (CERAMIC.includes(item.key)) return null; // replaced, not mended
  const restore = max - dur;
  let parts = 0, scrap = 1;
  if (d.slot === "weapon" && GUN_CATS.includes(d.cat) && !d.makeshift) parts = Math.ceil(restore / (CARE.REPAIR.gunStep * d.dur) - 1e-9);
  else if (["armor", "head", "arms", "legs"].includes(d.slot) && !d.makeshift) { parts = 1; scrap = 2; if (SOFT.includes(item.key)) scrap = 2; }
  const newMax = Math.round(Math.max(1, max - restore * groupLossRate(skill)) * 10) / 10;
  return { restore, newMax, parts, scrap };
}
export function repairGear(state, f, d = day(state)) {
  const A = f.arsenal;
  const R = CARE.REPAIR;
  if (!A || workshopFactor(state, f) < 1 || (d + Math.floor(h(state, f.name, "rph") * R.every)) % R.every) return 0;
  const skill = R.skill[f.type] ?? 3;
  const worn = A.items.filter((it) => { const m = itemDurMax(it), u = itemDur(it); return m && u != null && u < m * R.below; })
    .sort((a, b) => (GEAR[b.key].value || 0) - (GEAR[a.key].value || 0) || String(a.aid).localeCompare(String(b.aid)));
  let n = 0;
  for (const it of worn) {
    if (n >= Math.max(1, Math.round((f.pop / R.perPop) * weightOf(f, "repair")))) break;
    const p = groupRepairPlan(it, skill);
    if (!p || (f.stock.parts || 0) < p.parts || (f.stock.scrap || 0) < p.scrap) continue;
    f.stock.parts = (f.stock.parts || 0) - p.parts;
    f.stock.scrap -= p.scrap;
    if (it.durBase == null) it.durBase = itemDurMax(it);
    it.durMax = p.newMax;
    it.dur = p.newMax;
    A.rev++;
    A.stats.in.repaired = (A.stats.in.repaired || 0) + 1;
    n++;
  }
  return n;
}

// ---------- vehicles ----------
export function wearGroupVehicles(state, f, lost = false, tag = "") {
  if (!f || !groupTurret(f)) return;
  const v = factionVehicles(f).find((x) => x.condition > 0 && upgradesOf(x).turret) || factionVehicles(f).find((x) => x.condition > 0);
  if (!v) return;
  const [lo, hi] = lost ? CARE.VEHICLE.lost : CARE.VEHICLE.fight;
  v.condition = Math.max(0, Math.round(v.condition - (lo + (hi - lo) * h(state, f.name, state.hour, tag, "veh"))));
  if (v.condition <= 0 && f.known) log(state, `${f.name}'s ${v.name} was knocked out; it is out of action until they repair it.`, "info");
}
function repairVehicles(state, f) {
  if (workshopFactor(state, f) < 1) return;
  const V = CARE.VEHICLE;
  const v = factionVehicles(f).filter((x) => x.condition < V.below).sort((a, b) => a.condition - b.condition)[0];
  if (!v || (f.stock.parts || 0) < V.parts || (f.stock.scrap || 0) < V.scrap) return;
  f.stock.parts -= V.parts;
  f.stock.scrap -= V.scrap;
  v.condition = Math.min(100, v.condition + V.step);
}

// ---------- hunger: buy food ----------
export function hungerTrade(state, f, d = day(state)) {
  const H = CARE.HUNGER;
  if ((f.stock.food || 0) >= f.pop * H.below || (f.foodDeal != null && d - f.foodDeal < H.gap)) return null;
  if (h(state, f.name, tickOf(f), "trade") >= Math.min(1, 0.5 * weightOf(f, "trade") + 0.2)) return null; // raiders would rather take it
  const wars = new Set(warsOf(state, f).flatMap((w) => [w.a, w.b]));
  const partners = state.factions.filter((o) => o.alive && o !== f && !o.outsider && !wars.has(o.id) && (o.stock.food || 0) >= o.pop * H.rich && relation(state, f, o) > H.rel);
  if (!partners.length) return null;
  const mate = (o) => (sameBloc(state, f, o) ? 1 : 0); // blocs.js: a member of their bloc first, at cost
  const o = partners.sort((a, b) => mate(b) - mate(a) || b.stock.food / b.pop - a.stock.food / a.pop || a.id - b.id)[0];
  const markup = mate(o) ? 1 : H.markup;
  let want = Math.min(Math.floor(f.pop * H.want - (f.stock.food || 0)), Math.floor((o.stock.food || 0) - o.pop * (H.rich - 2)));
  if (want <= 0) return null;
  // Pay with what they can spare most (ammo above 3 a head, scrap, fuel, meds above 1 a head), at their worth.
  const spare = { ammo: (f.stock.ammo || 0) - f.pop * 3, scrap: f.stock.scrap || 0, fuel: (f.stock.fuel || 0) - f.pop * 0.5, meds: (f.stock.meds || 0) - f.pop };
  let owed = want * SUPPLIES.food.value * markup;
  const paid = {};
  for (const k of ["scrap", "ammo", "fuel", "meds"]) {
    if (owed <= 0) break;
    const q = Math.min(Math.max(0, Math.floor(spare[k])), Math.ceil(owed / SUPPLIES[k].value));
    if (q <= 0) continue;
    paid[k] = q;
    owed -= q * SUPPLIES[k].value;
  }
  if (owed > 0) want = Math.floor(want * (1 - owed / (want * SUPPLIES.food.value * markup)));
  if (want <= 0) return null;
  for (const [k, q] of Object.entries(paid)) { f.stock[k] -= q; o.stock[k] = (o.stock[k] || 0) + q; }
  f.stock.food = (f.stock.food || 0) + want;
  o.stock.food -= want;
  f.foodDeal = d;
  f.foodBought = (f.foodBought || 0) + want;
  if (known(state, f, o) && f.known && o.known) log(state, `${f.name}, short of food, bought ${want} food from ${o.name}.`, "info");
  return { from: o, food: want, paid };
}

// ---------- a raid at their walls ----------
// Pay or fight? "tribute" when they pay (what was paid goes to the raiders), or null (they fight).
export function raidAnswer(state, attacker, target, att, def) {
  if (!attacker || !target || att < def * CARE.HOLD_RATIO) return null;
  if (h(state, target.name, attacker.name, state.hour, "tribute") >= CARE.TRIBUTE_ODDS * weightOf(target, "yield")) return null; // zealots never pay
  for (const k of ["food", "ammo", "meds", "scrap"]) {
    const q = Math.floor((target.stock[k] || 0) * CARE.TRIBUTE);
    target.stock[k] -= q;
    attacker.stock[k] = (attacker.stock[k] || 0) + q;
  }
  target.tributes = (target.tributes || 0) + 1;
  return "tribute";
}

// ---------- expanding ----------
export const canExpand = (f) => (f.stock.scrap || 0) >= CARE.EXPAND.scrap && fitPeople(f) >= CARE.EXPAND.fit;
export function expanded(f) { f.stock.scrap -= CARE.EXPAND.scrap; }

// ---------- desertion ----------
// What pushes people out: hunger, sleeping rough, recent losses, the wounded, a war; x the type's harshness.
export function desertPressure(state, f) {
  const pop = Math.max(1, f.pop);
  const food = (f.stock.food || 0) / pop;
  let p = food < 1 ? 2 : food < 2 ? 1 : 0;
  if (growthFactor(state, f) < 1) p += 0.5; // no quarters for everyone (groupworks.js)
  p += Math.min(2, ((f.lossRecent || 0) / pop) * 5);
  p += (woundedOf(f) / pop) * 2;
  if (warsOf(state, f).length || atWarWithYou(state, f)) p += 0.5; // playerwars.js: a war with you weighs the same
  return p * weightOf(f, "harsh");
}
export function desertDaily(state, f, d = day(state)) {
  const D = CARE.DESERT;
  if (f.pop <= 4 || f.hcNoGrow) return null;
  const chance = Math.min(D.max, D.base * desertPressure(state, f));
  if (!(chance > 0) || h(state, f.name, tickOf(f), "desert") >= chance) return null;
  return desertOne(state, f, d);
}
// One of them walks out with their own gun and armour: to your gates, to another group, or onto the road.
export function desertOne(state, f, d = day(state), where = null) {
  const D = CARE.DESERT;
  const kit = [];
  if (f.arsenal) {
    const issue = issueKit(state, f, f.pop, "home");
    const lo = issue[Math.floor(h(state, f.name, tickOf(f), "dk") * issue.length)] || null;
    for (const it of lo ? [lo.weapon, lo.armour.armor] : []) if (it && removeFromArsenal(f, it, "deserted")) kit.push(it);
  }
  f.pop -= 1;
  f.deserted = (f.deserted || 0) + 1;
  if (f.wounded > f.pop) f.wounded = f.pop;
  const r = where === "player" ? 0 : where === "group" ? D.toPlayer : where === "wanderer" ? 1 : h(state, f.name, tickOf(f), "dwhere");
  const g = state.grid, home = f.bases[0];
  const base = home != null ? state.bases.filter((b) => g.distance(b.tile, home) <= D.playerRange).sort((a, b) => g.distance(a.tile, home) - g.distance(b.tile, home))[0] : null;
  if (base && r < D.toPlayer && hub(state)) {
    const s = makeCandidate(state, { quality: 0.8, minHealth: 45, gearChance: 0 });
    for (const it of kit) { const slot = GEAR[it.key].slot; if (!s.gear[slot]) s.gear[slot] = it; }
    offerRecruits(state, [s], { source: "deserter", baseId: base.id, title: "A deserter at the gate", intro: `${s.name} walked out of ${f.known ? f.name : "a group nearby"} and asks to join you${kit.length ? `, bringing ${kit.map((x) => x.name).join(" and ")}` : ""}.` });
    return { to: "player", kit, who: s };
  }
  if (r < D.toPlayer + D.toGroup && home != null) {
    const wars = new Set(warsOf(state, f).flatMap((w) => [w.a, w.b]));
    const per = (o) => (o.stock.food || 0) / Math.max(1, o.pop);
    const o = state.factions.filter((x) => x.alive && x !== f && !x.outsider && x.bases.length && !wars.has(x.id) && Math.min(...x.bases.map((b) => g.distance(b, home))) <= D.range && (where === "group" || per(x) > per(f)))
      .sort((a, b) => per(b) - per(a) || a.id - b.id)[0];
    if (o) {
      o.pop += 1;
      if (o.arsenal) o.arsenal.pop0 = o.pop; // their kit came with them
      for (const it of kit) addToArsenal(state, o, it, "deserter");
      if (o.known && f.known) log(state, `One of ${f.name} went over to ${o.name}.`, "info");
      return { to: "group", group: o, kit };
    }
  }
  if (home == null) return { to: "gone", kit };
  const ng = newNeutralGroup(state, home, new Rng(Math.floor(h(state, f.name, tickOf(f), "dseed") * 2 ** 31)));
  ng.people.length = 1;
  ng.mood = "desperate";
  ng.from = f.id;
  const s = ng.people[0];
  for (const it of kit) s.gear[GEAR[it.key].slot] = it;
  return { to: "wanderer", wanderer: ng, kit };
}

// ---------- recruiting ----------
// Wanderers left on the map near a group's bases (wanderers.js wanderersDaily): does this group take them in today? By
// its profile, its food and its beds, and how the wanderers feel (the desperate join anyone with food, the wary rarely).
// Raiders press-gang: mood does not matter, the weak go along. Their gear goes into the arsenal.
export function wandererJoinChance(state, f, wg) {
  if (!f || !f.alive) return 0;
  const fed = (f.stock.food || 0) >= f.pop * 4 ? 1 : (f.stock.food || 0) >= f.pop * 2 ? 0.5 : 0.1;
  const beds = growthFactor(state, f) < 1 ? 0.6 : 1;
  const mood = f.type === "raider" ? 1.5 : wg.mood === "desperate" ? 1.5 : wg.mood === "wary" ? 0.5 : 1;
  return Math.min(0.5, CARE.WANDER_JOIN * prio(f, "recruit") * fed * beds * mood);
}
export function wandererJoins(state, f, wg) {
  const n = wg.people.length;
  f.pop += n;
  for (const s of wg.people) {
    for (const it of stripAll(s)) addToArsenal(state, f, it, "recruit");
    s.joinedGroup = f.id;
  }
  if (f.arsenal) f.arsenal.pop0 = f.pop; // their kit came with them (arsenalDaily's newcomers' guns are for the others)
  f.recruitedWanderers = (f.recruitedWanderers || 0) + n;
  return n;
}
// Your deserters who do not come back (recruits.js RETURN) may join a group near the base they left.
export function playerDeserters(state, d = day(state), force = false) {
  const D = CARE.DESERT;
  const out = [];
  for (const e of [...(state.deserters || [])]) {
    if (!force && d - e.day < RETURN.after) continue;
    const s = state.survivors.find((x) => x.id === e.id);
    if (!s || s.alive || !s.left || s.joinedGroup != null) continue;
    if (!force && hash01(state.seed, "groupcare", "pdes", s.name, d) >= D.playerJoin) continue;
    const base = state.bases.find((b) => b.id === e.baseId) || hub(state);
    if (!base) continue;
    const g = state.grid;
    const near = (x) => Math.min(...x.bases.map((t) => g.distance(t, base.tile)));
    const f = state.factions.filter((x) => x.alive && !x.outsider && x.bases.length && near(x) <= D.playerRange).sort((a, b) => near(a) - near(b) || a.id - b.id)[0];
    if (!f) continue;
    state.deserters.splice(state.deserters.indexOf(e), 1);
    s.joinedGroup = f.id;
    f.pop += 1;
    if (f.arsenal) f.arsenal.pop0 = f.pop;
    for (const it of stripAll(s)) addToArsenal(state, f, it, "deserter");
    log(state, `Word on the road: ${s.name}, who walked out on you, has joined ${f.known ? f.name : "a group nearby"}.`, "info");
    out.push({ s, f });
  }
  return out;
}

// One group's day (factions.js factionsDaily).
export function groupCareDaily(state, f) {
  const d = day(state);
  heal(state, f, d);
  repairGear(state, f, d);
  repairVehicles(state, f);
  hungerTrade(state, f, d);
  desertDaily(state, f, d);
}
// Once a day for the world (factions.js factionsDaily, after the groups).
export function groupCareWorld(state) {
  playerDeserters(state, day(state));
}
