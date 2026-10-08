// Group arsenals (weapons overhaul plan section 26): every AI group only has the weapons, armour and explosives it
// has gathered, and fights with them.
//
// What a group holds: f.arsenal.items, real items (inventory.js newItem: key, quality, dur, gun parts in item.mods),
// next to its supplies (f.stock). Ammo stays the generic f.stock.ammo for now, behind arsenalRounds /
// takeArsenalRounds (the per-calibre boxes of the ammo overhaul can switch them). Vehicles are f.vehicles
// (vehicles.js factionVehicles: a military group's Army truck and M2 Humvee).
//
// Seed (seedArsenal, at world creation; an old save's groups the first time they are read, by the same rule): the
// group's kit (combat.js KITS by type, KIT_OF) dealt out to its people: one weapon a head (the kit's weapon list in
// turn from a hashed start, SPARE more), body armour by the kit's armour list in turn, explosives (THROW_PER a head
// of THROWS). Later gangs from beyond the border (makeGang, eras.js gangArms) bring some of the kit's strong guns.
// Condition and gun parts from the kit (itemcond.js, gunmods.js enemyMods). Every roll is a hash (skills.js hash01
// of the seed and the group's name), never the world's dice, so a world comes out the same as before.
//
// By the numbers (groupStrength, kitFactor, unitPower): each person is worth 1 + their weapon's power × quality (+ MOD
// a gun part) + ARMOUR × the power of each armour piece (world.js combatPower's sum for your people), best kit to
// the first. The mean against REF (what the type's starting kit is worth a head: the same seeding averaged) is the
// kit factor (KIT_MIN–KIT_MAX), × AMMO_SHORT–1 when the rounds are under AMMO_NEED a gun. strength = people × the
// type's arms × kit factor (with the eras' arms in it, eraArms), so on day 0 a group is as strong as before (kit factor ≈ 1)
// and it grows or wanes with what it gathers and loses. A battle unit's power (2.2 + arms × 1.6 before) is
// base + arms × 1.6 × kit factor. Launchers (none yet: the overhaul's) add WALL_LAUNCHER each against walls.
//
// Allocation (issueKit): a fight at their base uses everything, best first. Anything else (raids, war parties,
// scavengers, patrols) leaves a home guard (HOME of the people) every third piece from the second best, and draws the
// rest best first; a raid on a walled base takes the launchers first.
// Battles: combat.js arms a group's units from the issue (armFromArsenal: their actual gun, its parts and condition,
// their armour); settleArsenal after any fight with a group (tactical or by the numbers): the kit of their dead
// leaves the arsenal when you hold the field (on the bodies you search, or by the numbers one piece BYNUM_PICK of the
// time), or stays (recovered) when they do, and then they also pick up your dead's gear; survivors' kit wears a use;
// ROUNDS a fighter are spent.
// Inflows: their scavenging (aiscav.js: SCAV_ITEMS items per loot taken, from the site's gear list, condition by the
// site), newcomers (RECRUIT_ARMED bring a weapon), their own crafting (makeshift weapons from scrap while short of
// weapons, explosives from scrap and fuel: CRAFT), trade (fighting gear you sell or give them goes in; surplus over
// WANT a head goes on their shelf, trade.js), stealing (raids on your bases and other groups, robbing your teams,
// captives stripped), the fields they hold after a fight, a broken group's arsenal (half to the group that takes it
// over), your vehicles when a team is taken whole, a smoke grenade now and then while short (SMOKE_RESTOCK). Outflows:
// the dead's kit, wear (a use a fight; broken is gone), rounds spent, explosives thrown at walls, smoke thrown over a
// retreat by the numbers (smokeCover), what they sell, what others steal.
import { GEAR, FACTION_TYPES, LOCATIONS } from "./data.js";
import { KITS, WEAPONS, loadMag, placeCar, floodReach } from "./combat.js";
import { lootItem } from "./inventory.js";
import { kitSource, siteSource } from "./itemcond.js";
import { enemyMods, fitMod, gunMods, modLabel, fittedSuppressor, takesMods, fittedMods } from "./gunmods.js";
import { hash01 } from "./skills.js";
import { totalRounds, spendAmmo } from "./rounds.js"; // a group's rounds: one abstract count (f.stock.ammo) and any rounds by key it holds
import { enemyLoad } from "./ammo.js"; // the round a unit armed from it loads (data-ammo.js KIT_AMMO by the group's kit)
import { syncModes } from "./gunfire.js"; // the fire modes of the gun it is given
import { enemyPieces } from "./armour.js"; // its armour pieces: the arsenal's items themselves (their wear)
import { itemDur, itemDurMax, wear } from "./crafting.js";
import { day, factionById } from "./world.js";
import { factionVehicles, groupTurret } from "./vehicles.js";
import { workshopFactor } from "./groupworks.js";
import { fitPeople, noteFight, weightOf, woundsFor, wearGroupVehicles, tickOf } from "./groupcare.js"; // AI parity: the wounded do not fight; a fight's dead and wounded

export const ARSENAL = {
  SPARE: 0.15, // spare weapons a head at the start
  THROWS: { raiders: ["pipebomb", "molotov"], zealots: ["molotov"], soldiers: ["frag"], fighters: ["pipebomb", "molotov"], guards: [], militia: ["molotov"] },
  THROW_PER: { raiders: 0.25, zealots: 0.2, soldiers: 0.25, fighters: 0.12, guards: 0, militia: 0.08 },
  HOME: 0.35, // the home guard's share of the people (and every third piece of kit from the second best)
  MOD: 0.2, ARMOUR: 0.5, // a gun part's worth; armour counts half its power (world.js combatPower)
  KIT_MIN: 0.15, KIT_MAX: 2.5,
  KIT_WEIGHT: 0.4, // the kit's share of a group's fighting worth (the rest: its people, their numbers and training)
  AMMO_NEED: 3, AMMO_SHORT: 0.7, // rounds a gun to count fully (your bases' 3 a head, world.js armedFactor); with none, the guns count 70%
  ROUNDS: 3, // rounds a fighter spends in a fight
  PICKUP_WEAR: [0.2, 0.5], // a piece picked up off a battlefield has lost this share of its uses
  RECRUIT_ARMED: 0.9, // a newcomer is armed (from the group's kit list)
  SCAV_ITEMS: 6, // items a scavenging party finds per loot it takes (a full trip about 0.25 loot: 1.5 items)
  CRAFT: { every: 4, scrap: 3, weapons: ["pipespear", "spikedbat", "pipespear", "nailbat"], bombEvery: 6, bombScrap: 2, bombFuel: 1,
    // A group with a workshop (groupworks.js) rebuilds a gun of its kit from scrap and a part while it has fewer
    // than GUNS a head.
    gunEvery: 5, gunScrap: 8, gunParts: 1, guns: 1.1 },
  WANT: 1.3, // weapons a head they keep; more goes on the trade shelf
  SHELF: 2, // surplus pieces put on the shelf a refresh
  // Smoke grenades (siege.js coverSmoke: over a retreat) come back coarsely, a day at a time: while a group holds fewer
  // than its kit's share a head (NONLETHAL smokegren), it gets one a day at this chance from its scavenging and trade
  // (military kit from Army sites and its own stores, traders' guards buy them, militia and raiders come across one).
  SMOKE_RESTOCK: { soldiers: 0.15, guards: 0.1, militia: 0.05, fighters: 0.05, raiders: 0.03 },
  // A beaten side by the numbers (factions.js AI raids) with smoke covers its retreat: each grenade it throws (at most
  // MAX, out of its arsenal) spares PER of its people; at least one of the losses still falls.
  SMOKE_COVER: { PER: 1, MAX: 2 },
  BYNUM_PICK: 0.3, // conflicts.js victoryRewards: by the numbers, one piece of their dead's kit for you this often
  WALL_LAUNCHER: 6, // power a launcher adds against walls
  SEEN_DAYS: 30, // a fight or a look at their camp shows you their kit for this long
  // The rest of a kit's people's gear, a share a head: tasers and spray (nonlethal.js NL_KIT), flashbangs and smoke
  // (throwables.js FLASH_KIT), medics' kits (medics.js MEDIC.ENEMY KITS: about one medic in sixteen people).
  NONLETHAL: {
    guards: { taser: 0.4, pepper: 0.45, flashbang: 0.2, smokegren: 0.1, bandagekit: 0.06 }, soldiers: { taser: 0.12, pepper: 0.2, flashbang: 0.3, smokegren: 0.35, traumakit: 0.06 },
    militia: { pepper: 0.25, smokegren: 0.12, bandagekit: 0.06 }, fighters: { pepper: 0.08, smokegren: 0.08, bandagekit: 0.06 }, raiders: { taser: 0.04, smokegren: 0.04 },
  },
};
// The kit of each group type (the same as conflicts.js KIND_OF).
export const KIT_OF = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "guards", commune: "militia" };
export const kitOf = (f) => KIT_OF[f && f.type] || "survivors";

// Off switch for tests (tools/arsenaltest.js: the world made without arsenals draws the same dice).
export const ARSENAL_SWITCH = { off: false };

const ARMOUR_SLOTS = ["armor", "head", "arms", "legs"];
const EXPLOSIVE = new Set(["frag", "pipebomb", "molotov"]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const qual = (it) => (it && Number.isFinite(it.quality) ? it.quality : 1);

// ---------- what goes in an arsenal ----------
export const isLauncherKey = (k) => !!((GEAR[k] && (GEAR[k].launcher || GEAR[k].cat === "launcher")) || (WEAPONS[k] && (WEAPONS[k].launcher || WEAPONS[k].blast)));
export const isWeaponKey = (k) => !!(GEAR[k] && GEAR[k].slot === "weapon" && WEAPONS[k]);
export const isArmourKey = (k) => !!(GEAR[k] && ARMOUR_SLOTS.includes(GEAR[k].slot) && (GEAR[k].power || 0) > 0);
export const isThrowKey = (k) => !!(GEAR[k] && GEAR[k].throw && (EXPLOSIVE.has(k) || GEAR[k].explosive));
// nonlethal.js: a taser or pepper spray carried beside the gun (its nlSetup hands out only what the arsenal holds).
export const isNonlethalKey = (k) => !!(GEAR[k] && (GEAR[k].nonlethal === "taser" || GEAR[k].nonlethal === "pepper"));
// The fighters' other kit: a medic's kit (medics.js enemy medics), a flashbang or a smoke grenade (throwables.js FLASH_KIT).
export const isMedKitKey = (k) => !!(GEAR[k] && GEAR[k].medKit);
export const isKitThrowKey = (k) => k === "flashbang" || k === "smokegren";
export const arsenalWorthy = (it) => !!(it && GEAR[it.key] && (isWeaponKey(it.key) || isArmourKey(it.key) || isThrowKey(it.key) || isNonlethalKey(it.key) || isMedKitKey(it.key) || isKitThrowKey(it.key)));
export const weaponValue = (it) => (it && isWeaponKey(it.key) ? (GEAR[it.key].power || 0) * qual(it) + ARSENAL.MOD * fittedMods(it).length : 0);
export const armourValue = (it) => (it && isArmourKey(it.key) ? (GEAR[it.key].power || 0) * qual(it) * ARSENAL.ARMOUR : 0);
const usesRounds = (k) => !!(WEAPONS[k] && WEAPONS[k].ammo > 0);
const hasWorkshop = (state, f) => workshopFactor(state, f) >= 1;

// ---------- the dice: hashes only ----------
const h = (seed, ...k) => hash01(seed, "arsenal", ...k);

// A starting kit (pure: the same arguments give the same items): weapons, armour and explosives for `pop` people of a
// group type. seed / salt: the world's seed and the group's name. gear: the eras' arms (eras.js gangArms, 1 early).
export function starterKit(seed, salt, type, pop, gear = 1) {
  const kind = KIT_OF[type] || "survivors";
  const kit = KITS[kind] || KITS.raiders;
  const src = kitSource(kind);
  const out = [];
  const make = (key, tag, i) => {
    if (!GEAR[key]) return null;
    const it = lootItem(key, src, [seed, "ars", salt, tag, i]);
    if (takesMods(key)) {
      const mods = enemyMods(kind, key, Math.floor(h(seed, salt, tag, i, "mods") * 1e9), `${tag}${i}`);
      if (mods) for (const m of Object.values(mods)) fitMod(it, m);
    }
    return it;
  };
  const W = kit.weapons, n = Math.max(0, Math.round(pop)), nW = n + Math.round(n * ARSENAL.SPARE);
  const strong = clamp((gear - 1) * 1.2, 0, 0.6);
  const off = Math.floor(h(seed, salt, "woff") * W.length);
  for (let i = 0; i < nW; i++) {
    const key = strong > 0 && h(seed, salt, "strong", i) < strong ? kit.strong[Math.floor(h(seed, salt, "sk", i) * kit.strong.length) % kit.strong.length] : W[(off + i) % W.length];
    const it = make(key, "w", i);
    if (it) out.push(it);
  }
  const A = kit.armor || [null], offA = Math.floor(h(seed, salt, "aoff") * A.length);
  for (let i = 0; i < n; i++) { const key = A[(offA + i) % A.length]; if (key) { const it = make(key, "a", i); if (it) out.push(it); } }
  const T = ARSENAL.THROWS[kind] || [], nT = Math.round(n * (ARSENAL.THROW_PER[kind] || 0));
  for (let i = 0; i < nT && T.length; i++) { const it = make(T[i % T.length], "t", i); if (it) out.push(it); }
  // Tasers and pepper spray (nonlethal.js NL_KIT: the share of a kit's people who carry one).
  for (const [key, share] of Object.entries(ARSENAL.NONLETHAL[kind] || {})) for (let i = 0; i < Math.round(n * share); i++) { const it = make(key, `n${key}`, i); if (it) out.push(it); }
  return out;
}

// ---------- the arsenal ----------
function newArsenal(f) {
  return { items: [], next: 0, rev: 0, pop0: f.pop, stats: { in: {}, out: {} } };
}
function stat(A, side, why, n = 1) { const S = A.stats || (A.stats = { in: {}, out: {} }); S[side][why] = (S[side][why] || 0) + n; }
function put(A, f, it, why) {
  if (it.aid == null) it.aid = `${f.name}#${++A.next}`;
  A.items.push(it);
  A.rev++;
  if (why) stat(A, "in", why);
}
export function seedArsenal(state, f) {
  const A = (f.arsenal = newArsenal(f));
  for (const it of starterKit(state.seed, f.name, f.type, f.pop, f.gear || 1)) put(A, f, it, null);
  A.seeded = A.items.length;
  A.gear = f.gear || 1; // the eras' arms this kit was dealt with (eraArms: a later gang's strong guns already carry them)
  A.smoke = true; // dealt with smoke grenades (topUpSmoke)
  return A;
}
// Smoke grenades came into most kits later (2026-10, siege.js coverSmoke: smoke over a retreat): an arsenal dealt
// before then gets its share once, the same items a new world's would hold (A.smoke marks it done). One that already
// holds smoke (guards had it before) is left as it is.
function topUpSmoke(state, f, A) {
  A.smoke = true;
  const kind = kitOf(f), share = (ARSENAL.NONLETHAL[kind] || {}).smokegren || 0;
  if (!share || A.items.some((it) => it && it.key === "smokegren")) return;
  const src = kitSource(kind);
  for (let i = 0; i < Math.round(Math.max(0, f.pop || 0) * share); i++) put(A, f, lootItem("smokegren", src, [state.seed, "ars", f.name, "nsmokegren", i]), null);
}
// The group's arsenal, made the first time it is read (an old save's groups: the same rule as a new world's).
export function ensureArsenal(state, f) {
  if (!f || f.outsider || ARSENAL_SWITCH.off) return null;
  if (f.arsenal) { if (!f.arsenal.smoke) topUpSmoke(state, f, f.arsenal); return f.arsenal; }
  return seedArsenal(state, f);
}
export function addToArsenal(state, f, it, why = "found") {
  if (!arsenalWorthy(it)) return false;
  const A = ensureArsenal(state, f);
  if (!A || A.items.includes(it)) return false;
  put(A, f, it, why);
  return true;
}
export function removeFromArsenal(f, it, why = "lost") {
  const A = f && f.arsenal;
  const i = A ? A.items.indexOf(it) : -1;
  if (i < 0) return false;
  A.items.splice(i, 1);
  A.rev++;
  stat(A, "out", why);
  return true;
}
// A use of wear on an item they own; broken, it is gone.
function wearOwned(f, it, n = 1) {
  if (!it || !f.arsenal || !f.arsenal.items.includes(it)) return false;
  f.arsenal.rev++;
  if (wear(it, n)) { removeFromArsenal(f, it, "broke"); return true; }
  return false;
}

// ---------- rounds (ammo.js: a group keeps one abstract count, f.stock.ammo, and whatever rounds by key a deal or a
// delivery left in its stores; its fighters load by their kit, enemyLoad) ----------
export const arsenalRounds = (f) => (f && f.stock ? totalRounds(f.stock) : 0);
export function takeArsenalRounds(f, n) {
  if (!f || !f.stock) return 0;
  return spendAmmo(f.stock, Math.min(arsenalRounds(f), Math.max(0, Math.round(n)))).n; // generic first, then the cheapest rounds
}
export function addArsenalRounds(f, n) { if (n > 0) f.stock.ammo = (f.stock.ammo || 0) + n; }

// ---------- sorted kit (cached by the arsenal's revision) ----------
const SORTED = new WeakMap();
function sortedKit(A) {
  const c = SORTED.get(A);
  if (c && c.rev === A.rev) return c;
  const byV = (fn) => (a, b) => fn(b) - fn(a) || String(a.aid).localeCompare(String(b.aid));
  const W = A.items.filter((it) => isWeaponKey(it.key) && !isLauncherKey(it.key)).sort(byV(weaponValue));
  const L = A.items.filter((it) => isLauncherKey(it.key)).sort(byV(weaponValue));
  const S = {};
  for (const slot of ARMOUR_SLOTS) S[slot] = A.items.filter((it) => isArmourKey(it.key) && GEAR[it.key].slot === slot).sort(byV(armourValue));
  const T = A.items.filter((it) => isThrowKey(it.key));
  const out = { rev: A.rev, W, L, S, T };
  SORTED.set(A, out);
  return out;
}

// The kit for n fighters on a task: [{ weapon, armour: { slot: item } }], best first. task: "home" (a fight at their
// base: everything), "raid", "walls" (a raid on a walled base: launchers first), "field" (anything else).
export function issueKit(state, f, n, task = "field") {
  const A = ensureArsenal(state, f);
  if (!A) return [];
  const o = sortedKit(A);
  const home = task === "home";
  const guard = home ? 0 : Math.ceil(f.pop * ARSENAL.HOME);
  const share = (list) => {
    if (home || !guard) return list;
    const out = [];
    let kept = 0;
    list.forEach((it, i) => { if (i % 3 === 1 && kept < guard) kept++; else out.push(it); });
    return out;
  };
  const W = task === "walls" ? [...o.L, ...share(o.W)] : share(o.W);
  const S = {};
  for (const slot of ARMOUR_SLOTS) S[slot] = share(o.S[slot]);
  const out = [];
  for (let j = 0; j < Math.max(0, Math.round(n)); j++) {
    const armour = {};
    for (const slot of ARMOUR_SLOTS) if (S[slot][j]) armour[slot] = S[slot][j];
    out.push({ weapon: W[j] || null, armour });
  }
  return out;
}
const loadoutItems = (lo) => [lo.weapon, ...Object.values(lo.armour)].filter(Boolean);
const loadoutValue = (lo) => 1 + weaponValue(lo.weapon) + Object.values(lo.armour).reduce((a, it) => a + armourValue(it), 0);

// ---------- by the numbers ----------
// What the type's starting kit is worth a head (the seeding averaged over a few sizes and names): the kit factor's 1.
const REF = {};
export function kitRef(type) {
  if (REF[type] != null) return REF[type];
  let sum = 0, k = 0;
  for (const pop of [14, 18, 22, 26]) for (const salt of ["ref1", "ref2", "ref3"]) {
    const A = newArsenal({ pop });
    for (const it of starterKit(0, salt, type, pop)) put(A, { name: salt }, it, null);
    sum += meanValue(A, pop);
    k++;
  }
  return (REF[type] = sum / k);
}
const VALUE = new WeakMap();
function meanValue(A, pop) {
  const c = VALUE.get(A);
  if (c && c.rev === A.rev && c.pop === pop) return c.v;
  const n = Math.max(1, Math.round(pop));
  const o = sortedKit(A);
  let s = 0, guns = 0;
  for (let i = 0; i < n; i++) {
    const w = o.W[i];
    s += 1 + weaponValue(w);
    if (w && usesRounds(w.key)) guns++;
    for (const slot of ARMOUR_SLOTS) s += armourValue(o.S[slot][i]);
  }
  const v = s / n;
  VALUE.set(A, { rev: A.rev, pop, v, guns });
  return v;
}
function gunsIn(A, pop) { meanValue(A, pop); return VALUE.get(A).guns; }
export function ammoFactor(f) {
  const A = f && f.arsenal;
  if (!A) return 1;
  const need = gunsIn(A, Math.max(1, fitPeople(f))) * ARSENAL.AMMO_NEED;
  const have = arsenalRounds(f);
  return !need || have >= need ? 1 : ARSENAL.AMMO_SHORT + (1 - ARSENAL.AMMO_SHORT) * have / need;
}
// The eras' arms (eras.js gangArms, f.gear: an aggressive group arms itself better each year from GROW_FROM), through
// its kit: the share not already in the arsenal it was dealt (A.gear: a gang from beyond the border later in the run
// brings some of its kit's strong guns, starterKit), so it is never counted twice.
export const eraArms = (f) => (f.gear || 1) / ((f.arsenal && f.arsenal.gear) || 1);
// The kit factor: the arsenal a head against the type's starting kit (1 on day 0, KIT_MIN–KIT_MAX), weighted
// KIT_WEIGHT against the people themselves, × the ammo factor, × the eras' arms (eraArms). It is what their battle
// units fight with (unitPower) as well as their strength by the numbers (groupStrength).
export function kitFactor(f) {
  const A = f && f.arsenal;
  if (!A || !FACTION_TYPES[f.type]) return 1;
  const r = clamp(meanValue(A, Math.max(1, fitPeople(f))) / kitRef(f.type), ARSENAL.KIT_MIN, ARSENAL.KIT_MAX);
  return (1 - ARSENAL.KIT_WEIGHT + ARSENAL.KIT_WEIGHT * r) * ammoFactor(f) * eraArms(f);
}
export const groupStrength = (f) => fitPeople(f) * FACTION_TYPES[f.type].arms * kitFactor(f); // groupcare.js: the wounded do not fight
// A battle unit's power (combat.js enemyUnit: aim, hit points, damage): base + the type's arms × 1.6 × the kit factor.
export const unitPower = (f, base = 2.2) => base + (FACTION_TYPES[f.type] ? FACTION_TYPES[f.type].arms : 1) * 1.6 * (f.arsenal ? kitFactor(f) : 1);
// Launchers against walls: what a raid on a walled base gains from those it takes.
export function wallPower(state, f, n) {
  const A = f && f.arsenal;
  if (!A) return 0;
  return Math.min(sortedKit(A).L.length, Math.max(1, Math.ceil(n / 4))) * ARSENAL.WALL_LAUNCHER;
}
// How many fighters a raid of this strength sends (conflicts.js raidForce counts the same).
export const raidCount = (f, strength) => clamp(Math.round(strength / unitPower(f)), 1, 14);

// ---------- battles (combat.js) ----------
// Fights at the group's own base: everything they own is there (rescue missions, assaults, rescueraid.js).
const HOME_HANDLERS = ["rescue", "assault", "baseAssault", "rescueRaid"];
// One of a group's units on the battle map is armed from its arsenal: the n-th best kit of the issue for this fight.
export function armFromArsenal(state, b, u, n) {
  const f = factionById(state, u.factionId);
  if (!f || !f.alive || f.outsider || u.kind !== "human") return;
  if (!ensureArsenal(state, f)) return;
  const setup = b.setup || {};
  const task = setup.enemy && setup.enemy.arsTask ? setup.enemy.arsTask : HOME_HANDLERS.includes(setup.handler) ? "home" : "field";
  b.arsIssue = b.arsIssue || {};
  const want = Math.max(n, Math.round((setup.enemy && setup.enemy.count) || n), 20);
  if (!b.arsIssue[f.id] || b.arsIssue[f.id].length < want) b.arsIssue[f.id] = issueKit(state, f, want, task);
  const lo = b.arsIssue[f.id][n - 1];
  f.arsenalSeen = day(state);
  if (task === "home" && !b.motorPool) placeMotorPool(state, b, f); // their vehicles parked at their base
  u.arsFid = f.id;
  const it = lo && lo.weapon;
  if (it && WEAPONS[it.key]) {
    u.weapon = it.key;
    u.weaponName = modLabel(it);
    u.modItems = null; // the parts are on the item itself (inventory.js enemyBody drops it as it is)
    u.gm = gunMods(it);
    u.gmWeapon = it.key;
    u.suppressor = fittedSuppressor(it);
    u.supFitted = true;
    u.dmgMult *= 0.75 + 0.25 * qual(it);
    u.arsItem = it;
  } else {
    u.weapon = "fists"; u.weaponName = "Fists"; u.modItems = null; u.gm = gunMods(null); u.gmWeapon = "fists"; u.suppressor = null; u.arsItem = null;
  }
  const body = lo && lo.armour.armor, head = lo && lo.armour.head;
  u.armorKey = body ? body.key : null;
  u.armor = 1 - ((body ? GEAR[body.key].power * qual(body) : 0) + (head ? GEAR[head.key].power * qual(head) * 0.5 : 0)) * 0.06;
  u.arsArmour = lo ? Object.values(lo.armour) : [];
  u.mag = null; u.magW = null;
  loadMag(u);
  // The gun as it is (gunfire.js: its modes, its quality and wear for the jams; ammo.js: the round its kit loads) and
  // the armour as it is (armour.js enemyPieces: the issued pieces themselves wear in the fight).
  u.load = enemyLoad(kitOf(f), u.weapon, state.seed, f.id, u.id);
  u.jam = null; u.modesW = null; syncModes(u);
  if (it && WEAPONS[it.key]) { u.q = it.quality ?? u.q; const m = itemDurMax(it); if (m) u.cond = Math.max(0, Math.min(1, (itemDur(it) ?? m) / m)); }
  u.pieces = undefined; enemyPieces(b, u);
  armExtras(state, b, f, u);
  // rescueraid.js: what a guard carries is not on the armory's rack too.
  const rack = b.rescue && b.rescue.armory && b.rescue.armory.items;
  if (rack) for (const x of [u.arsItem, ...u.arsArmour]) { const i = x ? rack.indexOf(x) : -1; if (i >= 0) rack.splice(i, 1); }
}

// A unit's medic kit and throwables (medics.js enemyMedic, throwables.js kitFlashbangs: given in combat.js enemyUnit)
// come out of the arsenal too: only what the group holds and nobody else on this map carries; none, and the unit
// goes without.
function armExtras(state, b, f, u) {
  const used = (b.arsUsed = b.arsUsed || new Set());
  const free = (pred) => f.arsenal.items.find((it) => pred(it.key) && !used.has(it) && itemDur(it) !== 0);
  if (u.isMedicKit && u.medKit) {
    const kit = free((k) => k === u.medKit.key) || free(isMedKitKey);
    if (kit) {
      used.add(kit);
      u.medKit = kit;
      u.arsMedKit = kit;
      u.kitLeft = Math.max(1, itemDur(kit) ?? u.kitLeft);
    } else {
      u.medicine = Math.max(0, (u.medicine || 0) - (u.kitBonus || 0));
      u.medKit = null; u.kitBonus = 0; u.isMedicKit = false; u.kitLeft = 0;
    }
  }
  if (u.throwables) {
    u.arsThrows = [];
    for (const k of Object.keys(u.throwables)) {
      let n = 0;
      for (let i = 0; i < u.throwables[k]; i++) { const it = free((x) => x === k); if (!it) break; used.add(it); u.arsThrows.push(it); n++; }
      if (n) u.throwables[k] = n; else delete u.throwables[k];
    }
  }
  for (const it of [u.arsItem, ...(u.arsArmour || [])]) if (it) used.add(it);
}
// What a unit carried besides its gun and armour (settleArsenal): its medic kit and the throwables it did not throw.
function extrasOf(u) {
  const out = u.arsMedKit ? [u.arsMedKit] : [];
  const left = { ...(u.throwables || {}) };
  for (const it of u.arsThrows || []) if ((left[it.key] || 0) > 0) { left[it.key]--; out.push(it); }
  return out;
}
// A group's motor pool on the battle map of its own base (an assault, a rescue raid): its running vehicles (up to
// POOL), parked on its side of the map, each a car you can get into, hotwire and drive off (foundcars.js: stealing it
// costs goodwill, foundcars.js STEAL_GOODWILL). Placed once, as the first of its people is armed.
export const POOL = 2;
export function placeMotorPool(state, b, f) {
  b.motorPool = [];
  const W = b.w, H = b.h;
  const cars = factionVehicles(f).filter((v) => v.condition > 0 && v.type !== "bike").slice(0, POOL);
  const ok = (x, y) => x >= 0 && y >= 0 && x < W && y < H && b.cells[y * W + x].k === "open" && !b.units.some((u) => u.x === x && u.y === y) && (!b.reach || b.reach[y * W + x]);
  for (const v of cars) {
    const big = v.type === "truck" || v.type === "miltruck" || v.type === "van";
    let placed = null;
    for (let x = W - 3; x >= Math.floor(W / 2) && !placed; x--) for (let y = 1; y < H - 2 && !placed; y++) {
      placed = placeCar(b.cells, W, H, x, y, "y", big ? 4 : 3, big ? "truck" : "car", ok, 0, { body: v.type === "hummer" ? "humvee" : big ? "truck" : "car" });
    }
    if (!placed) continue;
    for (let yy = placed.y0; yy < placed.y0 + placed.h; yy++) for (let xx = placed.x0; xx < placed.x0 + placed.w; xx++) b.cells[yy * W + xx].car.owned = { fid: f.id, recId: v.id, type: v.type, name: v.name, fuel: v.fuel, condition: v.condition, upgrades: v.upgrades || null };
    b.motorPool.push(placed.id);
  }
  if (b.motorPool.length && b.cells.length) floodReach(b, 0, Math.floor(H / 2));
}
// After any fight with a group (combat.js finishCombat, before the handler): who lost what. battle: the map it was
// played on (null: by the numbers). Returns { dropped: [items their dead carried, now off their books], took: [] }.
export function settleArsenal(state, setup, result, battle = null) {
  const out = { dropped: [], took: [] };
  const e = setup && setup.enemy;
  const f = e && e.factionId != null ? factionById(state, e.factionId) : null;
  if (!f || !f.alive || f.outsider || !result || !ensureArsenal(state, f)) return out;
  const won = result.outcome === "victory"; // you hold the field
  f.arsenalSeen = day(state);
  if (battle && battle.units) {
    const units = battle.units.filter((u) => u.side === "enemy" && u.arsFid === f.id);
    const raidMap = !!battle.raid;
    for (const u of units) {
      // Thrown in the fight: off the books (what is left is carried, extrasOf).
      const kept = new Set(extrasOf(u));
      for (const it of u.arsThrows || []) if (!kept.has(it)) removeFromArsenal(f, it, "thrown");
      if (u.arsMedKit && u.kitUses) { if (wear(u.arsMedKit, u.kitUses)) removeFromArsenal(f, u.arsMedKit, "used up"); }
      const kit = [u.arsItem, ...(u.arsArmour || []), ...[...kept].filter((it) => f.arsenal.items.includes(it))].filter(Boolean);
      const lost = raidMap ? !!u.dead : won ? !u.fled && !u.left : false;
      if (lost) { for (const it of kit) if (removeFromArsenal(f, it, "died:battle")) out.dropped.push(it); }
      else for (const it of kit) wearOwned(f, it);
    }
    takeArsenalRounds(f, units.filter((u) => u.arsItem && usesRounds(u.arsItem.key)).length * ARSENAL.ROUNDS);
    // groupcare.js: who came back hurt (under 60% of their hit points) joins the group's wounded.
    noteFight(f, 0, units.filter((u) => !u.dead && u.hp < u.maxHp * 0.6 && (u.fled || u.left || !won)).length);
    if (!won && !raidMap) {
      // They hold the field: the gear of your dead lies there (world.js killSurvivor: the death site).
      for (const u of battle.units) {
        if (u.side !== "player" || !(result.survivorsDead || []).includes(u.sid)) continue;
        for (const [, it] of u.fielded || []) if (takeFromDeathSite(state, battle.tileId, it) && addToArsenal(state, f, it, "field")) out.took.push(it);
      }
    }
  } else {
    const n = Math.max(1, Math.round(e.count || 1));
    const issue = issueKit(state, f, n, e.arsTask || (HOME_HANDLERS.includes(setup.handler) ? "home" : setup.layout === "baseDefence" ? "raid" : "field"));
    const dead = pickDead(state, issue, Math.min(n, result.enemiesKilled || 0), `${setup.handler}|${state.hour}`);
    for (const lo of issue) {
      const isDead = dead.includes(lo);
      for (const it of loadoutItems(lo)) {
        if (isDead && won) { if (removeFromArsenal(f, it, "died:battle")) out.dropped.push(it); }
        else wearOwned(f, it);
      }
    }
    takeArsenalRounds(f, issue.filter((lo) => lo.weapon && usesRounds(lo.weapon.key)).length * ARSENAL.ROUNDS);
    // groupcare.js: the handlers count 60-70% of their "killed" as dead; the rest come home wounded.
    noteFight(f, 0, Math.floor((result.enemiesKilled || 0) * 0.4));
    if (!won) for (const id of result.survivorsDead || []) out.took.push(...takeDeadGear(state, f, id));
  }
  if (e.turret) wearGroupVehicles(state, f, won, `fight${state.hour}`); // groupcare.js: the turret vehicle in the fight
  // The explosives a raid threw at your walls (siege.js grenades).
  if (e.siege && e.siege.grenades) throwExplosives(f, e.siege.grenades, e.siege.kind);
  result.arsDropped = out.dropped;
  result.arsTook = out.took;
  // A fight at your base that you won: their dead lie in your yard, their gear goes in its armory.
  if (won && setup.baseId != null && !battle) {
    const base = state.bases.find((x) => x.id === setup.baseId);
    if (base) base.armory.push(...out.dropped);
  }
  return out;
}
// Which of the issued loadouts died (hashed: the same fight always picks the same).
function pickDead(state, issue, k, tag) {
  if (k <= 0) return [];
  return issue.map((lo, i) => [lo, hash01(state.seed, "arsdead", tag, i)]).sort((a, b) => a[1] - b[1]).slice(0, k).map((x) => x[0]);
}
function takeFromDeathSite(state, tile, it) {
  for (const site of state.deathSites || []) {
    if (tile != null && site.tile !== tile) continue;
    const i = site.items.findIndex((e) => e.item === it);
    if (i >= 0) { site.items.splice(i, 1); return true; }
  }
  return false;
}
// A dead survivor's fighting gear from wherever it lies (a death site): into the group's arsenal.
function takeDeadGear(state, f, sid) {
  const s = (state.survivors || []).find((x) => x.id === sid);
  if (!s) return [];
  const first = `${s.name.split(" ")[0]}'s `;
  const got = [];
  for (const site of state.deathSites || []) {
    if (!site.names.includes(s.name)) continue;
    for (let i = site.items.length - 1; i >= 0; i--) {
      const en = site.items[i];
      if (en.kind === "gear" && en.item && en.name.startsWith(first) && arsenalWorthy(en.item) && addToArsenal(state, f, en.item, "field")) { site.items.splice(i, 1); got.push(en.item); }
    }
  }
  return got;
}
function throwExplosives(f, n, kind) {
  const T = sortedKit(f.arsenal).T;
  const list = [...T.filter((it) => it.key === kind), ...T.filter((it) => it.key !== kind)];
  for (const it of list.slice(0, n)) removeFromArsenal(f, it, "thrown");
}

// A raid's siege kit (siege.js raidSiegeKit) holds only the explosives the group has: as many as it holds at most,
// frags if it has frags. Null when nothing is left of the kit.
export function capSiegeKit(state, f, kit) {
  if (!kit || !ensureArsenal(state, f)) return kit;
  const T = sortedKit(f.arsenal).T.filter((it) => it.key === "frag" || it.key === "pipebomb");
  const frags = T.filter((it) => it.key === "frag").length;
  kit.grenades = Math.min(kit.grenades || 0, T.length);
  if (kit.grenades) kit.kind = frags >= kit.grenades ? "frag" : "pipebomb";
  return kit.ladders || kit.ram || kit.grenades ? kit : null;
}

// ---------- raids by the numbers ----------
// A raid on your base (factions.js resolveRaidOnPlayer): outcome "held" | "broken" | "overrun", theirDead (people they
// lost), armory0 (the armory's length before the raid: what is after it is your dead's). Returns
// { dropped, stole } (item lists) for the report.
export const RAID_STEAL = { broken: 0.2, overrun: 0.5, store: 0.5 }; // the share of your armory's fighting gear they carry off (× store with a storehouse)
export function raidOnBase(state, f, base, party, o) {
  const out = { dropped: [], stole: [] };
  if (!f || !ensureArsenal(state, f)) return out;
  const n = raidCount(f, party.strength || 4);
  const issue = issueKit(state, f, n, baseWallsOf(base) ? "walls" : "raid");
  const dead = pickDead(state, issue, Math.min(n, o.theirDead || 0), `raid|${base.tile}|${state.hour}`);
  const youHold = o.outcome !== "overrun";
  // Stealing first (what they carry off is what was in the armory before their dead's kit is added).
  if (!youHold || o.outcome === "broken") {
    const frac = (RAID_STEAL[o.outcome] || 0) * (o.store ? RAID_STEAL.store : 1);
    const a0 = Math.min(base.armory.length, o.armory0 ?? base.armory.length);
    const yourDead = base.armory.slice(a0).filter(arsenalWorthy);
    const rest = base.armory.slice(0, a0).filter(arsenalWorthy).sort((a, b) => (weaponValue(b) + armourValue(b)) - (weaponValue(a) + armourValue(a)));
    const take = [...yourDead, ...rest.slice(0, Math.ceil(rest.length * frac))];
    for (const it of take) {
      const i = base.armory.indexOf(it);
      if (i >= 0 && addToArsenal(state, f, it, "stolen")) { base.armory.splice(i, 1); out.stole.push(it); }
    }
  }
  for (const lo of issue) {
    const isDead = dead.includes(lo);
    for (const it of loadoutItems(lo)) {
      if (isDead && youHold) { if (removeFromArsenal(f, it, "died:raid")) { out.dropped.push(it); base.armory.push(it); } }
      else wearOwned(f, it);
    }
  }
  takeArsenalRounds(f, n * ARSENAL.ROUNDS);
  noteFight(f, o.theirDead || 0, woundsFor(o.theirDead || 0) + (o.outcome === "held" ? 1 : 0)); // groupcare.js
  wearGroupVehicles(state, f, o.outcome === "held", `raid${base.tile}`); // groupcare.js: their Humvee at your walls
  if (party.siege && party.siege.grenades && baseWallsOf(base)) throwExplosives(f, party.siege.grenades, party.siege.kind);
  return out;
}
const baseWallsOf = (base) => (base && base.buildings ? base.buildings.filter((x) => x.type === "walls" && !x.broken).length : 0);

// A clash between groups (factions.js resolveRaidOnFaction, diplomacy.js resolveWarRaid), or a group against the dead
// (b null: a horde, a hive). a: the attacker (null: the dead), aN its fighters, aDead / bDead the people each lost,
// holder: "a" | "b" (who holds the field: it recovers its own dead's kit and picks up half the other's), steal: the
// share of b's spare kit (beyond its people) a carries home, half of what b loses. fought: false when b gave the place up
// without a fight (no wear, no rounds).
export function clashKit(state, a, aN, aDead, b, bDead, holder, steal = 0, fought = true, label = "clash") {
  const tag = `${state.hour}|${a ? a.name : "dead"}|${b ? b.name : "dead"}`;
  const side = (f, n, task, dead) => {
    if (!f || !ensureArsenal(state, f)) return [];
    if (!fought) return [];
    const issue = issueKit(state, f, n, task);
    takeArsenalRounds(f, issue.filter((lo) => lo.weapon && usesRounds(lo.weapon.key)).length * ARSENAL.ROUNDS);
    const d = pickDead(state, issue, Math.min(issue.length, dead), `${tag}|${f.name}`);
    for (const lo of issue) if (!d.includes(lo)) for (const it of loadoutItems(lo)) wearOwned(f, it);
    return d.flatMap(loadoutItems);
  };
  const aKit = side(a, aN, "raid", aDead);
  const bKit = side(b, b ? Math.ceil(b.pop * (1 - ARSENAL.HOME)) : 0, "home", bDead);
  if (fought) { noteFight(a, aDead); noteFight(b, bDead); wearGroupVehicles(state, a, holder === "b", "a"); wearGroupVehicles(state, b, holder === "a", "b"); } // groupcare.js: the dead's wounded; their turret vehicles
  // The side holding the field picks up the other's dead's kit, knocked about (PICKUP_WEAR); with nobody to pick it up
  // (the dead won) it is gone.
  const moveHalf = (from, to, list, why) => list.forEach((it, i) => {
    if (!removeFromArsenal(from, it, why) || !to) return;
    const m = itemDurMax(it);
    if (m) { const [lo, hi] = ARSENAL.PICKUP_WEAR; if (wear(it, Math.round(m * (lo + (hi - lo) * hash01(state.seed, "arspick", tag, i))))) return; }
    addToArsenal(state, to, it, "field");
  });
  if (holder === "a") { if (b) moveHalf(b, a, bKit, `died:${label}`); }
  else if (a) moveHalf(a, b, aKit, `died:${label}`);
  if (steal > 0 && a && b && b.arsenal) {
    const o = sortedKit(b.arsenal);
    const used = new Set(issueKit(state, b, b.pop, "home").flatMap(loadoutItems));
    const spare = b.arsenal.items.filter((it) => !used.has(it) && (o.W.includes(it) || o.T.includes(it) || isArmourKey(it.key)));
    const lose = spare.slice(0, Math.ceil(spare.length * steal));
    lose.forEach((it, i) => { removeFromArsenal(b, it, "stolen"); if (i % 2 === 0) addToArsenal(state, a, it, "stolen"); });
  }
}
// A party of theirs lost on the road or at a site (aiscav.js lose): its people and their kit are gone.
export function partyLost(state, f, people) {
  if (!f || !ensureArsenal(state, f)) return;
  const issue = issueKit(state, f, people, "field");
  for (const lo of issue) for (const it of loadoutItems(lo)) removeFromArsenal(f, it, "died:lost");
  noteFight(f, people, 0);
}

// ---------- inflows ----------
// A scavenging party home (aiscav.js scavArrived): the fighting gear it found at the site, by the loot it took.
export function scavFinds(state, f, p) {
  if (!ensureArsenal(state, f) || !p.scav) return [];
  const t = state.tiles[p.scav.site];
  const table = t && t.loc && LOCATIONS[t.loc.type] ? (LOCATIONS[t.loc.type].gear || []).filter((k) => arsenalWorthy({ key: k })) : [];
  if (!table.length) return [];
  const A = f.arsenal;
  const tag = [state.seed, "arsscav", f.name, A.next, state.hour];
  const n = Math.floor((p.scav.taken || 0) * ARSENAL.SCAV_ITEMS + hash01(...tag, "n"));
  const got = [];
  for (let i = 0; i < n; i++) {
    const key = table[Math.floor(hash01(...tag, "k", i) * table.length) % table.length];
    const it = lootItem(key, siteSource(t.loc.type), [...tag, i]);
    if (addToArsenal(state, f, it, "scavenged")) got.push(it);
  }
  return got;
}
// Gear you sold or gave them (trade.js): fighting gear goes into the arsenal while they want it (WANT weapons a head).
export function intoArsenalFromShelf(state, f, items) {
  if (!f || f.outsider || !items || !items.length || !ensureArsenal(state, f)) return [];
  const moved = [];
  for (const it of items) {
    if (!arsenalWorthy(it) || !f.wares || !f.wares.includes(it)) continue;
    if (isWeaponKey(it.key) && sortedKit(f.arsenal).W.length >= f.pop * ARSENAL.WANT) continue;
    f.wares.splice(f.wares.indexOf(it), 1);
    if (addToArsenal(state, f, it, "bought")) moved.push(it);
  }
  return moved;
}
// Surplus for their trade shelf (trade.js ensureWares): the worst weapons beyond WANT a head, SHELF a refresh.
export function shelfSurplus(state, f) {
  if (!f || f.outsider || !ensureArsenal(state, f)) return [];
  const W = sortedKit(f.arsenal).W;
  const extra = Math.min(ARSENAL.SHELF, Math.floor(W.length - f.pop * ARSENAL.WANT));
  if (extra <= 0) return [];
  const out = W.slice(-extra);
  for (const it of out) removeFromArsenal(f, it, "sold");
  return out;
}
// Their daily upkeep (factions.js factionsDaily): newcomers' weapons, crafting from scrap, explosives.
export function arsenalDaily(state, f) {
  const A = ensureArsenal(state, f);
  if (!A) return;
  const d = day(state);
  const salt = [state.seed, "arsday", f.name, tickOf(f)]; // groupcare.js tickOf: the group's own day count
  if (f.pop > A.pop0) {
    const W = (KITS[kitOf(f)] || KITS.survivors).weapons; // armed from the group's own kit (what its people carry)
    for (let i = A.pop0; i < f.pop; i++) {
      if (hash01(...salt, "rec", i) >= ARSENAL.RECRUIT_ARMED) continue;
      const key = W[Math.floor(hash01(...salt, "rk", i) * W.length) % W.length];
      addToArsenal(state, f, lootItem(key, kitSource(kitOf(f)), [...salt, "r", i]), "recruit");
      // and armour from the kit's list (a share of them wear none: its null entries)
      const AR = (KITS[kitOf(f)] || KITS.survivors).armor || [null];
      const ak = AR[Math.floor(hash01(...salt, "ra", i) * AR.length) % AR.length];
      if (ak && GEAR[ak]) addToArsenal(state, f, lootItem(ak, kitSource(kitOf(f)), [...salt, "ra", i]), "recruit");
    }
  }
  A.pop0 = f.pop;
  restockSmoke(state, f, A, salt);
  const C = ARSENAL.CRAFT, phase = Math.floor(h(state.seed, f.name, "craft") * 12);
  if (hash01(...salt, "crafty") >= weightOf(f, "craft")) { A.pop0 = f.pop; return; } // groupcare.js GROUP_PRIORITIES: some types craft less
  const o = sortedKit(A);
  if ((d + phase) % C.every === 0 && o.W.length < f.pop && (f.stock.scrap || 0) >= C.scrap + 2) {
    f.stock.scrap -= C.scrap;
    const key = C.weapons[Math.floor(hash01(...salt, "cw") * C.weapons.length) % C.weapons.length];
    if (GEAR[key]) addToArsenal(state, f, lootItem(key, "militia", [...salt, "c"]), "crafted");
  }
  if ((d + phase) % C.gunEvery === 0 && hasWorkshop(state, f) && sortedKit(A).W.filter((it) => usesRounds(it.key)).length < f.pop * C.guns && (f.stock.scrap || 0) >= C.gunScrap + 2 && (f.stock.parts || 0) >= C.gunParts) {
    const list = KITS[kitOf(f)].weapons.filter((k) => usesRounds(k));
    const key = list[Math.floor(hash01(...salt, "gw") * list.length) % list.length];
    f.stock.scrap -= C.gunScrap;
    f.stock.parts -= C.gunParts;
    if (key) addToArsenal(state, f, lootItem(key, "militia", [...salt, "g"]), "crafted");
  }
  const kind = kitOf(f), want = Math.round(f.pop * (ARSENAL.THROW_PER[kind] || 0));
  const bomb = kind === "zealots" || kind === "militia" ? "molotov" : (ARSENAL.THROWS[kind] || []).includes("pipebomb") ? "pipebomb" : null;
  if (bomb && (d + phase) % C.bombEvery === 0 && o.T.length < want && (f.stock.scrap || 0) >= C.bombScrap + 2 && (f.stock.fuel || 0) >= C.bombFuel + 1) {
    f.stock.scrap -= C.bombScrap;
    f.stock.fuel -= C.bombFuel;
    addToArsenal(state, f, lootItem(bomb, "militia", [...salt, "b"]), "crafted");
  }
}
// The day's smoke grenade (SMOKE_RESTOCK): one, while they hold fewer than their kit's share a head. Own dice.
function restockSmoke(state, f, A, salt) {
  const kind = kitOf(f), p = ARSENAL.SMOKE_RESTOCK[kind] || 0;
  const want = Math.round(Math.max(0, f.pop || 0) * ((ARSENAL.NONLETHAL[kind] || {}).smokegren || 0));
  if (!p || A.items.filter((it) => it && it.key === "smokegren").length >= want || hash01(...salt, "smoke") >= p) return;
  addToArsenal(state, f, lootItem("smokegren", kitSource(kind), [...salt, "sm"]), "scavenged");
}
// A side beaten by the numbers covers its retreat with smoke (SMOKE_COVER): the grenades thrown leave the arsenal.
// loss: its people lost; returns how many of them the smoke spared (never all of them).
export function smokeCover(state, f, loss) {
  if (!f || f.outsider || loss <= 1 || !ensureArsenal(state, f)) return 0;
  const S = ARSENAL.SMOKE_COVER;
  const smoke = f.arsenal.items.filter((it) => it && it.key === "smokegren");
  const n = Math.min(smoke.length, S.MAX, Math.ceil((loss - 1) / S.PER));
  for (const it of smoke.slice(0, n)) removeFromArsenal(f, it, "thrown");
  return Math.min(loss - 1, n * S.PER);
}
// A vehicle that falls to a group (your team taken whole: conflicts.js endIfEmpty; a broken group's motor pool).
export function captureVehicle(f, v) {
  if (!f || !v) return null;
  const rec = { id: `f${f.id}-v${v.id}`, type: v.type, name: v.name, fuel: v.fuel || 0, condition: v.condition ?? 60, owner: f.id };
  if (v.upgrades) rec.upgrades = JSON.parse(JSON.stringify(v.upgrades));
  factionVehicles(f).push(rec);
  return rec;
}
// A group that takes over a broken one (factions.js takeOver): half its arsenal and its vehicles.
export function inheritArsenal(state, heir, f) {
  if (!heir || !f || !f.arsenal || !ensureArsenal(state, heir)) return;
  f.arsenal.items.slice().forEach((it, i) => { removeFromArsenal(f, it, "taken"); if (i % 2 === 0) addToArsenal(state, heir, it, "taken"); });
  for (const v of factionVehicles(f).splice(0)) { v.owner = heir.id; factionVehicles(heir).push(v); }
}
// A share of their spare kit to a place of yours (conquest.js captureBase: their stores at the base you took).
export function arsenalShareTo(state, f, frac, into) {
  if (!f || !f.arsenal || frac <= 0) return [];
  const used = new Set(issueKit(state, f, f.pop, "home").flatMap(loadoutItems));
  const spare = f.arsenal.items.filter((it) => !used.has(it));
  const out = spare.slice(0, Math.floor(spare.length * frac));
  for (const it of out) { removeFromArsenal(f, it, "taken"); into.push(it); }
  return out;
}

// ---------- what you know (ui) ----------
const KIND_WORD = { automatic: "assault rifles", rifle: "rifles", shotgun: "shotguns", pistol: "handguns", bow: "bows", melee: "blades and clubs" };
export function arsenalSummary(f) {
  const A = f && f.arsenal;
  if (!A) return { weapons: 0, armour: 0, throws: 0, launchers: 0, kit: 1, guns: 0 };
  const o = sortedKit(A);
  return { weapons: o.W.length, armour: Object.values(o.S).reduce((a, l) => a + l.length, 0), body: o.S.armor.length, throws: o.T.length, launchers: o.L.length, kit: kitFactor(f), guns: gunsIn(A, f.pop), parts: o.W.filter((it) => fittedMods(it).length).length };
}
// Do you know exactly what they hold? Friends tell you; a fight or a look at their camp shows you (SEEN_DAYS).
export function arsenalKnown(state, f) {
  if (!f) return false;
  if (f.pact || f.goodwill >= 20) return true;
  return f.arsenalSeen != null && day(state) - f.arsenalSeen <= ARSENAL.SEEN_DAYS;
}
// "Well armed: rifles, shotguns, body armour, explosives, an M2 Humvee." (rough), or the list when known exactly.
export function arsenalText(state, f) {
  if (!f || !f.alive || f.outsider || !f.arsenal) return ""; // read only (a screen never seeds one)
  const s = arsenalSummary(f);
  const v = meanValue(f.arsenal, f.pop) * ammoFactor(f); // a head, on one scale for every type (a pistol and nothing else: 3.7)
  const word = v < 2.5 ? "Poorly armed" : v < 3.8 ? "Lightly armed" : v < 5.5 ? "Armed" : v < 7.5 ? "Well armed" : "Heavily armed";
  const o = sortedKit(f.arsenal);
  const turret = groupTurret(f);
  const cars = factionVehicles(f).filter((v) => v.condition > 0);
  if (!arsenalKnown(state, f)) {
    const cats = {};
    for (const it of o.W.slice(0, Math.max(1, f.pop))) { const c = GEAR[it.key].cat; cats[c] = (cats[c] || 0) + 1; }
    const kinds = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => KIND_WORD[c] || "guns");
    const bits = [...kinds];
    if (s.body >= f.pop * 0.25) bits.push("body armour");
    if (s.throws) bits.push("explosives");
    if (s.launchers) bits.push("launchers");
    if (turret) bits.push(turret === "m2hb" ? "an M2 Humvee" : "a machine-gun truck");
    else if (cars.length) bits.push(cars.length === 1 ? "a vehicle" : "vehicles");
    return `${word}${bits.length ? `: ${bits.join(", ")}` : ""}.`;
  }
  const count = (list) => {
    const m = new Map();
    for (const it of list) { const name = modLabel(it); m.set(name, (m.get(name) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([n, q]) => (q > 1 ? `${q} × ${n}` : n));
  };
  const armour = Object.values(o.S).flat();
  const parts = [count([...o.L, ...o.W]).join(", "), armour.length ? count(armour).join(", ") : "", o.T.length ? count(o.T).join(", ") : "", cars.map((v) => v.name).join(", ")].filter(Boolean);
  return `${word} (${f.pop} people, ${arsenalRounds(f)} rounds): ${parts.join("; ")}.`;
}
// Totals for tools (A/B runs).
export function arsenalStats(state) {
  const out = { in: {}, out: {}, items: 0 };
  for (const f of state.factions || []) {
    const A = f.arsenal;
    if (!A) continue;
    out.items += A.items.length;
    for (const side of ["in", "out"]) for (const [k, v] of Object.entries(A.stats[side])) out[side][k] = (out[side][k] || 0) + v;
  }
  return out;
}
