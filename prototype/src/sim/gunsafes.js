// Gun safes and gun cases (docs/weapons-overhaul-plan.md section 19): what is inside them, one extensible loot
// function for every tier, and the cases' own small rules. The locks themselves (where safes stand, the ways to open
// them, the raid bot, the hour-by-hour search) are in locks.js; this file only knows the contents.
//
// Tiers (locks.js LOCKS gunsafe1/2/3 → GUN_STASH cheap / mid / high): a gun cabinet in a house or a farmhouse holds a
// hunting gun or two, a gun safe in a gun shop or a lodge two to four guns and the owner's valuables, an armoury safe
// at a police station, a prison or a base a rack of service guns and the ammo for them. Safes are the clean-gun
// source: guns in them are 0.6–0.9 quality (cheap) or 0.75–1 (mid, high), against the worn guns elsewhere.
//
// Rolls: roll(...k) is a hash01 closure (locks.js style: its own dice, never the world's random numbers), so adding
// safes and cases moves no other loot roll. rollGunStash returns { gear, sup, key, bp }: the items, the supplies, the
// chance of a site key inside and the blueprint multiplier (locks.js lockedLoot gives those two, it has the state).
//
// Later stages plug in through registerStashExtra (typed ammo: converts sup.ammo into calibre stocks for the guns
// rolled; magazines: 0–2 a gun; attachments: gunmods.js randomStashMods, mid 40% one part, high 60% up to two) and new
// GUN_STASH rows, so nothing here has to be rewritten.
//
// Gun cases (riflecase, pistolcase) are items: item.contents holds the gun (itemLoad and itemValue count it), item.sup
// a little ammo, item.locked a cheap lock. A cased gun is not fielded: it is not in a weapon slot, so it neither wears
// (combat.js wearFielded) nor fires. A locked case opens with a blade or a crowbar: 1 action and Heat +1 in a raid
// (locks.js openCaseAct), free and silent at a base or a camp (openCase here).
import { GEAR, SUPPLIES } from "./data.js";
import { lootItem, itemAt, placeOfLoc, storageFor } from "./inventory.js";
import { siteSource, GUNSTORE_LOCKED } from "./itemcond.js"; // every item here gets its condition from itemcond.js (rollCondition by source)
import { baseById } from "./world.js";
import { stashRounds, boxFinds, themeOf } from "./ammo.js"; // rounds by calibre (call-time only: safe in the import cycle)
import { withMags } from "./carrykit.js"; // a gun's spare magazines (call-time only)
import { stashGun } from "./gunfinds.js"; // one of the newer guns now and then (call-time only)
import { swapGun } from "./gundist.js"; // the gun distribution: which gun a safe or a case holds
import { GUN_SOURCES } from "./data-guns.js";
import { makeBox, isSealed, boxText, openBoxAt } from "./boxes.js"; // a case is a box (call-time only)
import { ROWS, mergeRows } from "./data-shops.js";

// ---------- what is inside ----------
// guns: weights (existing GEAR keys); n: [lo, hi] guns, more: the chance of one more; q: a quality range of the
// table's own (else itemcond.js gives it by the source: "gunsafe" for a safe, the site's for a case); sup: supply
// [lo, hi]; items: [key or weights, chance] each its own roll; rare: [chance, weights]; key: the chance of a site key
// (locks.js keyFor); bp: blueprint rolls × this (locks.js lockedLoot); only: a gun only at these site types.
const MIL_SITES = ["military", "crash_mil", "airdrop"];
const COP_SITES = ["police", "prison"];
export const GUN_STASH = {
  cheap: {
    guns: { huntrifle: 3, shotgun: 3, leverrifle: 2, revolver: 1 }, n: [1, 1], more: 0.35, q: [0.6, 0.9],
    sup: { ammo: [10, 30] }, items: [[{ coins: 1, watch: 1, goldring: 1 }, 0.15]], key: 0, bp: 1,
  },
  mid: {
    guns: { pistol: 3, revolver: 2, huntrifle: 2, shotgun: 2, leverrifle: 2, carbine: 1 }, n: [2, 4],
    sup: { ammo: [30, 80] }, items: [[{ coins: 1, goldchain: 1, watch: 1 }, 0.5]], key: 0.2, bp: 3,
    // The rare 8%: a collector's piece in top condition. On dev a plain pistol or hunting rifle; gunmods registers an
    // extra that fits a suppressor to the pistol (pistolcan) and a 4× scope to the rifle (scope4x), and section 3 swaps
    // the rifle for its scoped .308 key when that lands.
    rare: [0.08, { pistol: 1, huntrifle: 1 }],
  },
  high: { // police or prison (the military one is highMil: highFor picks by site)
    guns: { pistol: 3, carbine: 3, shotgun: 2 }, n: [2, 5],
    sup: { ammo: [80, 200] }, items: [["riothelmet", 0.2]], key: 0, bp: 3,
    // TODO (later stages register these): ["riflecan", 0.15] (section 5 rifle suppressor), ["eardef", 0.1] (section 18).
  },
  highMil: {
    guns: { ar: 3, carbine: 2 }, n: [2, 4],
    sup: { ammo: [100, 250] }, items: [["frag", 0.2]], key: 0, bp: 3,
    // TODO: dmr 1 in guns (section 3), ["highcut", 0.05] (section 18), ["m79", 0.04] (section 13), a .50 rifle 0.005
    // only if section 3 allows it here.
  },
  pistolcase: { guns: { pistol: 3, revolver: 2 }, n: [1, 1], sup: { ammo: [6, 15] } },
  riflecase: { guns: { huntrifle: 5, leverrifle: 2, shotgun: 2, carbine: 1 }, only: { carbine: [...COP_SITES, ...MIL_SITES] }, n: [1, 1], sup: { ammo: [5, 20] } },
};
export const TIER_STASH = { 1: "cheap", 2: "mid", 3: "high" };
// The table a tier uses at a site: the armoury safe of a base or a military crash holds military guns.
export const stashTable = (tier, siteType) => (tier === "high" && MIL_SITES.includes(siteType) ? "highMil" : tier);

const EXTRAS = [];
// fn(ctx, out): ctx { roll, tier, table, siteType, opts }, out { gear, sup, key, bp } (changed in place). Later stages
// add typed ammo, magazines and fitted attachments here. Returns a function that takes it off again (for tests).
export function registerStashExtra(fn) {
  EXTRAS.push(fn);
  return () => { const i = EXTRAS.indexOf(fn); if (i >= 0) EXTRAS.splice(i, 1); };
}
// ammo.js: the rounds in a safe or a case, by the calibres of the guns in it (now and then a typed load).
registerStashExtra((ctx, out) => stashRounds(ctx, out));
// ammo.js: a safe's rounds mostly in their boxes (stacks of boxes beside the guns); a gun case's stay loose in it.
registerStashExtra((ctx, out) => { if (out && out.sup && Array.isArray(out.gear) && !/case$/.test(String(ctx && ctx.table))) boxFinds(out.sup, out.gear, ctx && ctx.siteType && ["military", "police", "prison"].includes(themeOf(ctx.siteType)) ? themeOf(ctx.siteType) : "guns", "stash", ctx && ctx.tier, ctx && ctx.table); });
// carrykit.js: a gun in a safe or a case keeps 0-2 spare magazines beside it (its own dice).
registerStashExtra(({ roll, tier, siteType }, out) => { withMags(out.gear, stashSource(tier, siteType), "stash", tier, roll("mags")); });
// gunfinds.js: now and then one of the newer guns as well (an over-under in a farmer's safe, a battle rifle in an
// armoury's; its own rolls).
registerStashExtra((ctx, out) => stashGun({ ...ctx, source: stashSource(ctx.tier, ctx.siteType) }, out));

// A weighted pick from { key: weight } with a roll in [0, 1).
export function pickWeighted(r, weights) {
  const list = Object.entries(weights).filter(([k, w]) => w > 0 && GEAR[k]);
  const sum = list.reduce((a, [, w]) => a + w, 0);
  let x = r * sum;
  for (const [k, w] of list) { if (x < w) return k; x -= w; }
  return list.length ? list[list.length - 1][0] : null;
}
const q2 = (v) => Math.round(v * 100) / 100;
// The itemcond.js source of what is in a safe ("gunsafe"; at a gun store the military's range, GUNSTORE_LOCKED: a
// store's back room does not beat the Army) or a case (the site's: a police or a military one, else a home).
const CASE_KINDS = ["pistolcase", "riflecase"];
export const caseSource = (siteType) => { const s = siteSource(siteType); return s === "police" || s === "military" ? s : "home"; };
export const stashSource = (tier, siteType) => (CASE_KINDS.includes(tier) ? caseSource(siteType) : siteType === "gunstore" ? GUNSTORE_LOCKED : "gunsafe");

// What a safe or a case of this tier holds at a site of this type. roll: a hash01 closure. opts: passed to the extras.
export function rollGunStash(roll, tier, siteType, opts = {}) {
  const name = stashTable(tier, siteType);
  const T = GUN_STASH[name] || GUN_STASH.cheap;
  const out = { gear: [], sup: {}, key: T.key || 0, bp: T.bp || 1 };
  const src = stashSource(tier, siteType);
  const guns = { ...T.guns };
  for (const [k, sites] of Object.entries(T.only || {})) if (!sites.includes(siteType)) delete guns[k];
  // The gun distribution's source (data-guns.js GUN_SOURCES stash:<table>; a case at a police or Army site: @service).
  const gsrc = CASE_KINDS.includes(name) && [...COP_SITES, ...MIL_SITES].includes(siteType) && GUN_SOURCES[`stash:${name}@service`] ? `stash:${name}@service` : `stash:${name}`;
  let n = T.n[0] + Math.floor(roll("n") * (T.n[1] - T.n[0] + 1));
  if (T.more && roll("more") < T.more) n++;
  for (let i = 0; i < n; i++) {
    const k = swapGun(gsrc, pickWeighted(roll("g", i), guns), [roll("gs", i)]); // gundist.js: which gun, by the safe's draws (its own dice)
    if (k) out.gear.push(lootItem(k, src, roll("q", i), T.q ? { quality: q2(T.q[0] + roll("q", i) * (T.q[1] - T.q[0])) } : undefined));
  }
  if (T.rare && roll("rare") < T.rare[0]) {
    const k = swapGun(gsrc, pickWeighted(roll("rarek"), T.rare[1]), [roll("rarekg")]); // gundist.js
    if (k) out.gear.push(lootItem(k, src, roll("rareq"), { quality: 1 })); // a collector's piece: top condition
  }
  for (const [k, [lo, hi]] of Object.entries(T.sup || {})) if (SUPPLIES[k]) out.sup[k] = lo + Math.floor(roll("s", k) * (hi - lo + 1));
  (T.items || []).forEach(([what, p], i) => {
    if (roll("i", i) >= p) return;
    const k = typeof what === "string" ? what : pickWeighted(roll("ik", i), what);
    if (k && GEAR[k]) out.gear.push(lootItem(k, src, roll("iq", i)));
  });
  for (const fn of EXTRAS) fn({ roll, tier, table: name, siteType, opts }, out);
  return out;
}

// ---------- flashbangs and smoke grenades (throwables.js FLASH) ----------
// An armoury safe (the high tier, police or military) keeps a few: 0-2, each a flashbang (60%) or a smoke grenade.
export const STASH_GRENADES = { max: 2, flashbang: 0.6 };
registerStashExtra(({ roll, tier, siteType }, out) => {
  if (tier !== "high") return;
  const n = Math.floor(roll("gren", "n") * (STASH_GRENADES.max + 1));
  for (let i = 0; i < n; i++) {
    const k = roll("gren", "k", i) < STASH_GRENADES.flashbang ? "flashbang" : "smokegren";
    out.gear.push(lootItem(k, stashSource(tier, siteType), roll("gren", "q", i)));
  }
});

// ---------- blown open (locks.js "blow") ----------
// What a blast does to the contents: each gun −0.3 quality (at least 0.2), 30% of every supply gone, the glass
// valuables (bottles of liquor) smashed. Changes gear and sup in place; returns how many things were lost.
export const BLOWN = { gunQ: 0.3, minQ: 0.2, supLoss: 0.3, glass: ["liquor"] };
export function blastContents(gear, sup) {
  let lost = 0;
  for (let i = gear.length - 1; i >= 0; i--) {
    const it = gear[i], d = it && GEAR[it.key];
    if (!d) continue;
    if (BLOWN.glass.includes(d.cat)) { gear.splice(i, 1); lost++; continue; }
    if (d.slot === "weapon" && d.skill === "shooting" && d.cat !== "melee") it.quality = q2(Math.max(BLOWN.minQ, (it.quality ?? 1) - BLOWN.gunQ));
  }
  for (const k of Object.keys(sup)) {
    const gone = Math.round(sup[k] * BLOWN.supLoss);
    if (gone > 0) { sup[k] -= gone; lost++; }
    if (sup[k] <= 0) delete sup[k];
  }
  return lost;
}

// ---------- gun cases ----------
export const CASE = { locked: 0.4, raidAp: 1, raidHeat: 1, blades: ["knife", "machete", "sawmachete", "pipespear"] };
export const isGunCase = (item) => !!(item && GEAR[item.key] && GEAR[item.key].gunCase);
// A case with what it holds. kind: "riflecase" | "pistolcase".
// Since 2026-10-19 a case is a box (boxes.js makeBox, data-boxes.js BOX_HOLDS riflecase / pistolcase): most hold a
// gun (this file's stash, on the same dice as before), some only rounds, a camera, optics or a fishing rod, some nothing.
export function rollGunCase(roll, kind, siteType) {
  return makeBox(kind, roll, siteType);
}
// What a case holds, for a tooltip ("Hunting rifle (85%), 12 ammo").
export function caseText(item) {
  if (!isGunCase(item)) return "";
  if (isSealed(item)) return boxText(item); // unknown until it is opened (boxes.js)
  const bits = (item.contents || []).filter(Boolean).map((c) => `${c.name}${c.quality != null && c.quality < 1 ? ` (${Math.round(c.quality * 100)}%)` : ""}`);
  for (const [k, v] of Object.entries(item.sup || {})) if (v > 0) bits.push(`${v} ${(SUPPLIES[k] && SUPPLIES[k].name.toLowerCase()) || k}`);
  return bits.length ? bits.join(", ") : "empty";
}
// Empties a case: its items into gear (an array), its supplies into sup (an object). The case stays, empty and
// unlocked. Returns the names of what came out.
export function openCase(item, gear, sup) {
  if (!isGunCase(item) && !(item && GEAR[item.key] && GEAR[item.key].box)) return []; // any box (boxes.js)
  const out = [];
  for (const it of item.contents || []) if (it) { gear.push(it); out.push(it.name); }
  for (const [k, v] of Object.entries(item.sup || {})) if (v > 0) { sup[k] = (sup[k] || 0) + v; out.push(`${v} ${SUPPLIES[k] && SUPPLIES[k].round ? SUPPLIES[k].name : k}`); } // rounds: "17 12 gauge 00 buckshot" (ammo.js)
  item.contents = [];
  item.sup = {};
  item.locked = false;
  item.opened = true;
  return out;
}
// A base's armory (and its stock) or a team's cargo: every case with something in it is opened (free and silent).
// The guns then sit in the armory for the usual equip logic (bulk.js equipBest, autopilot.js equipFromArmory).
export function openCasesIn(list, sup) {
  if (!Array.isArray(list) || !sup) return [];
  const got = [];
  for (const it of list.slice()) if (isGunCase(it) && ((it.contents && it.contents.some(Boolean)) || Object.values(it.sup || {}).some((v) => v > 0))) got.push(...openCase(it, list, sup));
  return got;
}

// The inventory screen's "Open case" (ui/inventory.js): a case in a base's armory, a team's cargo or on someone at a
// base or with a team opens for free: what is inside goes into the armory or the cargo, the supplies into the base's
// stock or the team's cargo. Not in a raid (there it takes an action: locks.js openCaseAct). Returns the message.
// Since 2026-10-19 (boxes.js): any box or case, opened with the right tool when locked, and what is inside stays in it
// for its window (ui/boxview.js: take things out one by one or all). sid: who opens it (their tools count). The old
// empty-it-all rule is openCaseDump.
export function openCaseAt(state, str, sid = null) {
  return openBoxAt(state, str, sid).msg;
}
export function openCaseDump(state, str) {
  const item = itemAt(state, str);
  if (!isGunCase(item)) return "That is not a gun case.";
  if (state.combat && !state.combat.over) return "In a raid, open it from the raid panel (1 action).";
  const place = placeOfLoc(state, str);
  const st = place ? storageFor(state, place) : null;
  if (!st) return "Out of reach.";
  const sup = st.o === "armory" ? (baseById(state, st.id) || {}).stock : st.party && (st.party.cargo.supplies || (st.party.cargo.supplies = {}));
  if (!sup) return "Out of reach.";
  const locked = !!item.locked;
  const got = openCase(item, st.list, sup);
  return got.length ? `${locked ? "Prised open" : "Opened"} the ${item.name.toLowerCase()}: ${got.join(", ")} into ${st.name}.` : `The ${item.name.toLowerCase()} is empty.`;
}

// ---------- where the tools and the cases turn up ----------
// A raid container of this area type (locks.js lockedLoot, its own dice): { item: chance } each its own roll.
export const GUN_FINDS = {
  house: { pistolcase: 0.012, riflecase: 0.008 }, farmhouse: { riflecase: 0.03, pistolcase: 0.01 }, cabin: { riflecase: 0.035, pistolcase: 0.015 },
  gunshop: { riflecase: 0.04, pistolcase: 0.04 }, pawnshop: { pistolcase: 0.05, riflecase: 0.04, powerdrill: 0.03 }, // shops.js: pawned in their cases hangar: { pistolcase: 0.005, riflecase: 0.005, anglegrinder: 0.02 },
  garage: { powerdrill: 0.04, anglegrinder: 0.015 }, hardware: { powerdrill: 0.06, anglegrinder: 0.03 }, workshop: { powerdrill: 0.05, anglegrinder: 0.03 }, warehouse: { powerdrill: 0.015 },
  motorpool: { anglegrinder: 0.02 },
};
// A locked car's trunk (LOCK_LOOT.car): a case 4% of the time. TODO: miltrucks cargo 0.15 (its branch calls rollGunCase).
export const CAR_CASE = 0.04;
// The hour-by-hour search (locks.js lockedSearchHour): a tool on the shelves, by site type, a chance an hour × loot left.
export const SEARCH_TOOLS = {
  hardware: { powerdrill: 0.04, anglegrinder: 0.015 }, autoshop: { powerdrill: 0.03, anglegrinder: 0.02 },
  factory: { anglegrinder: 0.03, powerdrill: 0.02 }, quarry: { anglegrinder: 0.02 }, dam: { powerdrill: 0.01 },
};
// A drill or a grinder's condition: a shop's picked-over stock (a hardware store), else a worksite's.
export const toolSource = (siteType) => (siteSource(siteType) === "shop" ? "shop" : "site");
// Items from GUN_FINDS for one container: cases come with their contents.
export function rollAreaGunFinds(roll, areaType, siteType) {
  const f = GUN_FINDS[areaType];
  if (!f) return [];
  const out = [];
  for (const [k, p] of Object.entries(f)) {
    if (!GEAR[k] || roll("f", k) >= p) continue;
    out.push(GEAR[k].gunCase ? rollGunCase((...x) => roll("fc", k, ...x), k, siteType) : lootItem(k, toolSource(siteType), roll("fq", k)));
  }
  return out;
}

// data-shops.js: the town's and the city's shops and services (their rows; this module's own rows win).
mergeRows(SEARCH_TOOLS, ROWS.SEARCH_TOOLS); mergeRows(GUN_FINDS, ROWS.GUN_FINDS);
