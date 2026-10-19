// Item condition by source (src/sim/itemcond.js): one roller for every piece of loot and every trader's stock.
//   1. Distributions: every source's quality and uses left fall in its ranges and spread over them; what does not
//      roll (books, counts, valuables, consumables) stays at quality 1 and full; a fixed quality (the armoured dead's) is kept.
//   2. Every creation point goes through rollCondition: no loot code calls inventory.js newItem itself (only starting
//      and recruit gear, paper, and the maker handed to deadsoldiers.js); large samples of bodies, raid finds, site
//      finds, trucks, group wares, merchants' and travellers' wares and a 40-day autopilot world's trade stock are
//      all rolled (paper excepted).
//   3. Kinds stay source-bound: a body's things from its kit, a truck's from its table, a container's finds from its
//      area, a group's wares from its type's list, a merchant's from its speciality.
//   4. No world-dice drift: a fixed-seed sample of bodies, raid finds, trucks, site finds, group wares and visitors
//      makes the same keys and leaves the random numbers where the code before this change left them (the hashes
//      below were taken from dev 75793c5; bodies' and trucks' keys re-taken with the weapons roster, see section 4).
//   5. Merchants' specialities: each turns up, its gear and books from its list, its supplies (ammo, meds, parts) larger.
//   6. Prices fall with condition (valuation.js itemValue): a worse copy sells and buys for less; the trade window
//      shows the condition in a word and the uses left.
//   7. The balance between sources: shops picked over (good but used, now and then boxed), below the Army's crates;
//      soldiers' and contractors' guns off their bodies from 55% uses (guards' and escorts' 45%) on every path;
//      homes as picked over as the shops.
//   8. Shops and homes over the years since the fall (COND_AGE: a normal game from its day 1, a hardcore run from the
//      fall), set by the world every hour, at creation and on load; a gun store's cages and safes in the Army's range.
// Usage: node tools/itemcondtest.js
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { GEAR } from "../src/sim/data.js";
import { FOODS, foodIn, foodSplit } from "../src/sim/foods.js"; // food by type
import { Rng } from "../src/sim/rng.js";
import { createWorld, tickHour, day, hub } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { KITS, AREAS } from "../src/sim/combat.js";
import { enemyBody, deadBodyFinds, allItems, lootItem, newItem, ZOMBIE_FINDS, ZOMBIE_PACKS, ZOMBIE_PACK_STUFF, ZBODY } from "../src/sim/inventory.js";
import { HEAD_FINDS, AREA_HEAD, WARE_HEAD } from "../src/sim/helmets.js"; // helmets and ear protection (their own dice)
import { WARE_CARTS } from "../src/sim/loot.js"; // carts on a merchant's table (loot.js cartWares)
import { SITE_FINDS, rollAreaFind, AREA_FINDS, rollFind, rollHuntFind, rollLightFind, LIGHT_FINDS, rollGunmodFind, rollAreaGunmod, AREA_GUNMODS, WARE_GUNMODS, WARE_MODS, SITE_MODS, AREA_MODS, rollSiteMod } from "../src/sim/loot.js"; // WARE_MODS / SITE_MODS / AREA_MODS: the economy agent's parts
import { truckLoot, TRUCK_LOOT, TRUCK_LOOT_HOOKS, TRUCK_FLASH } from "../src/sim/miltrucks.js";
import { TRUCK_GEAR } from "../src/sim/data-guns.js"; // the roster's military guns in Army trucks (factoryfit.js rosterTruckGear, plan section 22)
import { ensureWares, WARES, WARE_EXTRAS, gearSellPrice, gearBuyPrice } from "../src/sim/trade.js";
import { WARE_BOOKS } from "../src/sim/skills.js";
import { MILDEAD } from "../src/sim/deadsoldiers.js";
import { KIT_LOOT } from "../src/sim/data-kit.js";
import { WARE_KIT } from "../src/sim/carrykit.js"; // the carry kit's loot (rigs, magazines on bodies and with found guns): off for the old baselines
import * as V from "../src/sim/visitors.js";
import { RELOAD } from "../src/sim/reloading.js"; // merchants' powder and primers (their own dice)
import {
  COND_SOURCES, rollCondition, condRolled, isPaper, rollsQuality, rollsWear, qualityWord, siteSource, areaSource, kitSource, traderSource,
} from "../src/sim/itemcond.js";
import { itemValue } from "../src/sim/valuation.js";
import { tradeWindow } from "../src/ui/tradewindow.js";
import { SHOP, COND_AGE, setLootAge, lootAge, lootAgeOf, ageShare, agedSource, lockSource, GUNSTORE_LOCKED } from "../src/sim/itemcond.js";
import { stashSource } from "../src/sim/gunsafes.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { enemyGunQ, enemyGunCond } from "../src/sim/gunfire.js";
import { itemDurMax } from "../src/sim/crafting.js";
import { guardGear } from "../src/sim/escorts.js";
import { starterKit } from "../src/sim/arsenal.js";
import { BLADE_FINDS, AREA_BLADES, WARE_BLADES } from "../src/sim/blades.js"; // knives and swords (their own dice)
import { BLADE_KIT_PATCH } from "../src/sim/data-blades.js";
import { SURV_FINDS, AREA_SURV, WARE_SURV } from "../src/sim/survival.js"; // survival gear (its own dice)
import { SURV_KIT_PATCH } from "../src/sim/data-survival.js";
import { BOX_FINDS } from "../src/sim/data-boxes.js"; // lock boxes (boxes.js, their own dice, last)
import { ARSENAL_FINDS, ARSENAL_KITS, CALIBRE_KITS, AR_KITS, SURV_KITS, ARSENAL_GEAR } from "../src/sim/data-guns.js"; // the arsenal of 2026-10-10 (gunfinds.js, its own dice)
import { standardMag } from "../src/sim/mags.js";
import { isRoundItem, isBulk } from "../src/sim/itemstack.js"; // rounds loose or boxed, bulk ammo containers
import { gunsFrom, bodyGunSource, GUN_DIST } from "../src/sim/gundist.js"; // the gun distribution: which gun a source yields
import { PART_FINDS } from "../src/sim/data-gunmods.js"; // the parts catalogue's finds (partfinds.js, its own dice)
import { partPool } from "../src/sim/partfinds.js";

// A shelf's stock as the generator makes it (trade.js ensureWares): a group that lives here is stocked once and then
// trades only what it owns (docs/adr/0001-ai-parity.md), so the generator is sampled the way a visitor's shelf is made.
const restock = (state, f) => { const o = f.outsider; f.outsider = true; try { return ensureWares(state, f, true); } finally { f.outsider = o; } };


let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const h16 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
// Added to Army trucks after the baselines (data-guns.js TRUCK_GEAR's launcher rows: their own hashed dice, nothing else moves).
const LAUNCH_ADDED = new Set(["at4", "m79", "rpg", "a_40mm_he", "a_40mm_smoke", "a_rocket_heat"]);
const keysOf = (items) => items.filter(Boolean).map((it) => it.key + (it.contents ? `[${it.contents.filter(Boolean).map((c) => c.key).join(",")}]` : "")).join(",");
const flat = (items) => items.filter(Boolean).flatMap((it) => [it, ...(it.contents ? flat(it.contents) : [])]);
const pct = (v) => `${Math.round(v * 100)}%`;

// ---------- 1. distributions ----------
section("1. Distributions per source");
setLootAge(0); // a world in its first year (shops and homes as their table says: section 8 ages them)
const table = [];
// A source with boxed finds (shops: itemcond.js SHOP.boxed) rolls those from their own ranges: each part checked apart.
const inR = (v, [a, b], e) => v >= a - e && v <= b + e;
for (const [src, S] of Object.entries(COND_SOURCES)) {
  const parts = [{ R: S, qlo: 9, qhi: -9, dlo: 9, dhi: -9, n: 0 }, ...(S.boxed ? [{ R: S.boxed, qlo: 9, qhi: -9, dlo: 9, dhi: -9, n: 0, boxed: true }] : [])];
  let stray = 0;
  for (let i = 0; i < 4000; i++) {
    const c = rollCondition("pistol", src, [src, i]);
    const f = c.dur / GEAR.pistol.dur;
    // Which part it came from: the boxed ranges sit above the main ones (a roll in both counts as the main).
    const P = inR(c.quality, S.q, 0.005) && inR(f, S.d, 0.02) ? parts[0] : parts[1] && inR(c.quality, S.boxed.q, 0.005) && inR(f, S.boxed.d, 0.02) ? parts[1] : null;
    if (!P) { stray++; continue; }
    P.n++;
    P.qlo = Math.min(P.qlo, c.quality); P.qhi = Math.max(P.qhi, c.quality);
    P.dlo = Math.min(P.dlo, f); P.dhi = Math.max(P.dhi, f);
  }
  check(!stray, `${src}: every roll within its ranges (${stray} outside)`);
  for (const P of parts) {
    const R = P.R, tag = P.boxed ? `${src} (boxed)` : src;
    check(P.qlo <= R.q[0] + 0.03 * (P.boxed ? 2 : 1) && P.qhi >= R.q[1] - 0.03 * (P.boxed ? 2 : 1), `${tag}: quality spreads over its range (${P.qlo}–${P.qhi})`);
    check(P.dlo <= R.d[0] + 0.04 * (P.boxed ? 2 : 1) && P.dhi >= R.d[1] - 0.04 * (P.boxed ? 2 : 1), `${tag}: uses spread over their range (${pct(P.dlo)}–${pct(P.dhi)})`);
  }
  if (S.boxed) check(Math.abs(parts[1].n / 4000 - S.boxed.p) < 0.02, `${src}: ${pct(parts[1].n / 4000)} boxed (${pct(S.boxed.p)} meant)`);
  table.push(`  ${S.name.padEnd(44)} quality ${S.q.join("–").padEnd(10)} uses ${S.d.map(pct).join("–")}${S.boxed ? `; ${pct(S.boxed.p)} boxed: quality ${S.boxed.q.join("–")}, uses ${S.boxed.d.map(pct).join("–")}` : ""}`);
}
console.log(table.join("\n"));
// What does not roll.
for (const k of ["medbook", "goldring", "chocolate", "frag", "puritabs", "soap"].filter((x) => GEAR[x])) {
  const c = rollCondition(k, "wreck", [k, 1]);
  check(c.quality === 1 && c.dur === (GEAR[k].dur || null), `${k} keeps quality 1 and its full count (${c.quality}, ${c.dur})`);
}
check(rollsQuality("ar") && rollsWear("ar") && rollsQuality("backpack") && !rollsWear("backpack"), "a rifle rolls quality and wear; a pack quality only");
{ const c = rollCondition("plate", "armoured", [1], { quality: 0.42 }); check(c.quality === 0.42 && c.dur >= 0.2 * GEAR.plate.dur - 1 && c.dur <= 0.7 * GEAR.plate.dur + 1, `a fixed quality stays (${c.quality}), the wear rolls (${c.dur}/${GEAR.plate.dur})`); }
check(rollCondition("pistol", "home", new Rng(5)).quality === rollCondition("pistol", "home", new Rng(5)).quality, "the same roll gives the same condition");
{ const r = new Rng(9); const s0 = r.state; rollCondition("pistol", "home", r); lootItem("pistol", "home", r); check(r.state === s0, "rolling a condition draws nothing from the rng"); }
check(["poor", "worn", "good", "fine", "excellent"].every((w, i) => qualityWord([0.4, 0.6, 0.8, 0.95, 1.02][i]) === w), "quality in words: poor, worn, good, fine, excellent");
check(siteSource("gunstore") === "shop" && siteSource("military") === "military" && siteSource("crash_mil") === "wreck" && siteSource("factory") === "site", "site sources: a gun store is a shop, a crash is a wreck, a factory plain");
check(areaSource("armory", "police") === "police" && areaSource("armory", "military") === "military" && areaSource("house") === "home" && areaSource("milwreck") === "wreck", "area sources: an armoury by its site, a house a home, a wreck a wreck");
check(kitSource("soldiers") === "soldier" && kitSource("contractors") === "soldier" && kitSource("escorts") === "guard" && kitSource("zealots") === "raider" && kitSource(undefined) === "survivor", "kit sources (a hired contractor's kit kept like a soldier's, an escort's like a guard's)");
check(traderSource("military") === "traderMil" && traderSource("raider") === "traderRaider" && traderSource("commune") === "trader" && traderSource("merchants") === "merchant", "trader sources");
// Military better than raiders, on average.
const meanQ = (src) => { let a = 0; for (let i = 0; i < 2000; i++) a += rollCondition("ar", src, [i]).quality; return a / 2000; };
check(meanQ("traderMil") > meanQ("trader") && meanQ("trader") > meanQ("traderRaider"), "the military's stock is better kept than a trader's, a trader's than raiders'");
check(meanQ("military") > meanQ("shop") && meanQ("shop") > meanQ("wreck") && meanQ("home") > meanQ("wreck"), "the Army's crates are better kept than a picked-over shop's stock; a shop's and a home's better than a wreck's");

// ---------- 2. every creation point ----------
section("2. Every creation point rolls its condition");
// Static: loot code never calls newItem itself.
const ALLOWED = {
  "inventory.js": /export function newItem|condition\((factoryFit\()?newItem\(key, 1\)|g\.head = newItem\("footballhelmet"|newItem\("(ceramic|steel)plate"/, // the roller itself (lootItem: a gun's factory parts fitted first, factoryfit.js); an old save's helmet split; a carrier's plates (worn as the carrier is: lootItem wearInserts)
  "carrykit.js": /starting gear/, // a colonist's starting spare magazines (not loot)
  "deadsoldiers.js": /newItem\([kg], q\(range\), rng\)/, // the maker handed in (inventory.js armouredItem; g: gundist.js swapGun's rifle)
  "hardcore-start.js": /./, "recruits.js": /./, "world.js": /startdur/, // starting and recruit gear (START_DUR), not loot
  "blueprints.js": /bpItemKey/, "skills.js": /newItem\(key, 1\)|newItem\(list\[/, // paper
  "visitors.js": /bpItemKey|newItem\(k, 1\)\)/, // a merchant's blueprints and books (paper)
  "vehicles.js": /newItem\(t\.gun, 0\.8\)/, // a turret's own gun coming off a vehicle (not loot)
  "mags.js": /newItem\(stdKey/, // a gun's own standard magazine made a thing of as a swap takes it out (mags.js swapMag: not loot, and a magazine has no condition)
  "startgear.js": /newItem\(key, 1\)/, "custompoints.js": /newItem\(key, 1\)/, // starting gear picked under Customize (new), and its price probe: not loot
  "hubevents.js": /newItem\("ar", Math\.round\(st\.rng\.range/, // the Guard deserter's own rifle, its condition rolled there (as recruit gear: not loot)
  "barricade.js": /newItem\("boards"\)/, // boards pried off a door or window come back as bundles (the team's own: not loot)
  "volunteers.js": /newItem\("(knife|flashlight)"\)/, // a volunteer's own plain knife and light when their group lent no weapon (as recruit gear: not loot)
};
const strays = [];
for (const f of readdirSync("src/sim").filter((x) => x.endsWith(".js"))) {
  const lines = readFileSync(`src/sim/${f}`, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (!/\bnewItem\(/.test(l) || /^\s*\/\//.test(l)) return;
    if (f === "inventory.js" && /export function newItem|export const newItem/.test(l)) return;
    if (ALLOWED[f] && ALLOWED[f].test(l)) return;
    strays.push(`${f}:${i + 1}`);
  });
}
check(!strays.length, `no loot code makes items without a condition roll (newItem at ${strays.join(", ") || "none"})`);
// Dynamic: large samples.
// Rounds loose or boxed (ammo.js formFinds, itemstack.js roundItem) are counted stock, not gear: no condition to roll.
const notRolled = (items) => flat(items).filter((it) => !condRolled(it) && !isPaper(it.key) && !isRoundItem(it));
const sampleCheck = (label, items) => { const bad = notRolled(items); check(items.length > 0 && !bad.length, `${label}: ${flat(items).length} items, all rolled${bad.length ? ` (not: ${[...new Set(bad.map((x) => x.key))].join(", ")})` : ""}`); };
{
  const rng = new Rng(31);
  const items = [];
  for (let i = 0; i < 600; i++) for (const kit of Object.keys(KITS)) { const K = KITS[kit]; items.push(...allItems(enemyBody(rng, { kind: "human", name: "x", id: i, kit, weapon: K.weapons[i % K.weapons.length], armorKey: K.armor[i % K.armor.length] }, K))); }
  for (let i = 0; i < 3000; i++) items.push(...allItems(enemyBody(rng, { kind: "zombie", name: "z", id: i, ztype: i % 4 === 0 ? "soldier" : i % 9 === 0 ? "riot" : null }, null)));
  for (let i = 0; i < 3000; i++) items.push(...deadBodyFinds(rng, i % 5 === 0 ? "soldier" : i % 11 === 0 ? "riot" : null).gear);
  sampleCheck("bodies (every kit, the dead, the armoured dead)", items);
}
{ const rng = new Rng(32); const items = []; for (const a of Object.keys(AREA_FINDS)) for (let i = 0; i < 400; i++) { const it = rollAreaFind(rng, a, 1, 10); if (it) items.push(it); } sampleCheck("raid containers' small finds", items); }
{ const items = []; for (const kind of Object.keys(TRUCK_LOOT)) for (const cond of ["intact", "wrecked", "burnt"]) { const rng = new Rng(kind.length + cond.length); for (let i = 0; i < 200; i++) items.push(...truckLoot(rng, kind, cond).gear); } sampleCheck("military trucks", items); }
const st = createWorld({ seed: 4242, factionCount: 8 });
st.started = true;
{
  const items = [];
  const sites = st.tiles.filter((t) => t.loc).slice(0, 150);
  for (const t of sites) for (let hr = 0; hr < 150; hr++) {
    st.hour = hr;
    for (const f of [rollFind, rollHuntFind, rollLightFind, rollGunmodFind]) { const it = f(st, t.id, 4, "c"); if (it) items.push(it); }
    for (const a of Object.keys(AREA_GUNMODS)) { const it = rollAreaGunmod(st, t.id, a, `c${hr}`); if (it) items.push(it); }
  }
  st.hour = 0;
  sampleCheck("site finds (small finds, hunting, lights, gun parts)", items);
}
{ const items = []; for (let w = 0; w < 20; w++) for (const f of st.factions) { st.hour = w * 168; items.push(...restock(st, f)); } st.hour = 0; sampleCheck("group traders' wares", items); }
{
  const items = [];
  for (let i = 0; i < 80; i++) for (const kind of ["merchants", "explorers"]) { const v = V.spawnVisitor(st, kind); if (v) items.push(...v.wares); st.visitors.length = 0; }
  sampleCheck("merchants' and travellers' wares", items);
}
{
  const w = createWorld({ seed: 77, factionCount: 8 });
  w.started = true;
  setAutopilot(w, true, "balanced");
  // Sampled every day (the stock on the map at one hour depends on which caravans happen to be there then).
  const seen = new Set();
  const items = [];
  const take = () => { for (const it of [...w.factions.flatMap((f) => f.wares || []), ...(w.visitors || []).flatMap((v) => v.wares || [])]) if (it && !seen.has(it)) { seen.add(it); items.push(it); } };
  while (day(w) <= 40 && !w.gameOver) { tickHour(w); if (w.hour % 24 === 12) take(); }
  take();
  sampleCheck("a 40-day autopilot world's trade stock", items);
}

// ---------- 3. kinds stay source-bound ----------
section("3. Kinds by source");
// The arsenal of 2026-10-10 on a group's or a merchant's shelf (gunfinds.js gunWares: drawn from gundist.js's
// trader:<type> pool, each gun with its spare magazines).
const newGuns = (type) => { const ks = Object.keys(gunsFrom(`trader:${type}`)); return [...ks, ...ks.map((k) => standardMag(k)).filter(Boolean)]; };
const within = (label, items, allowed) => {
  const bad = [...new Set(flat(items).map((it) => it.key).filter((k) => !allowed.has(k)))];
  check(items.length > 0 && !bad.length, `${label}: ${flat(items).length} items from its own list${bad.length ? ` (stray: ${bad.join(", ")})` : ""}`);
};
for (const kit of Object.keys(KITS)) {
  const K = KITS[kit];
  const rng = new Rng(kit.length * 7);
  const items = [];
  for (let i = 0; i < 1500; i++) items.push(...allItems(enemyBody(rng, { kind: "human", name: "x", id: i, kit, weapon: K.weapons[i % K.weapons.length], armorKey: K.armor[i % K.armor.length] }, K)));
  within(`a ${K.label.toLowerCase()}'s body`, items, new Set([...K.weapons, ...K.armor.filter(Boolean), ...K.loot, ...(K.finds || []), ...(K.pack ? [K.pack[0]] : []), ...Object.keys(gunsFrom(bodyGunSource(kit)))])); // gundist.js: a spare gun is any gun of their kind
}
{
  const rng = new Rng(8);
  const items = [];
  for (let i = 0; i < 3000; i++) items.push(...allItems(enemyBody(rng, { kind: "zombie", name: "z", id: i }, null)), ...deadBodyFinds(rng, null).gear);
  within("one of the dead", items, new Set([...ZOMBIE_FINDS, ...ZOMBIE_PACKS, ...ZOMBIE_PACK_STUFF, ...ZBODY.FINDS, "pistol"]));
  for (const z of ["soldier", "riot"]) {
    const B = MILDEAD.BODY[z];
    const its = [];
    for (let i = 0; i < 2000; i++) its.push(...deadBodyFinds(rng, z).gear);
    within(`an armoured ${z}'s body`, its, new Set([...[...B.armor, ...B.items, ...(MILDEAD.BODY_EXTRA[z] || [])].map((x) => x[0]), ...Object.keys(gunsFrom("body:deadsoldier"))])); // BODY_EXTRA: a flashbang now and then; gundist.js: an Army rifle like the listed one
  }
}
for (const kind of Object.keys(TRUCK_LOOT)) { const rng = new Rng(3); const its = []; for (let i = 0; i < 300; i++) its.push(...truckLoot(rng, kind, "intact").gear); within(`a ${kind} truck`, its, new Set([...TRUCK_LOOT[kind].gear.map((x) => x[0]), ...(TRUCK_GEAR[kind] || TRUCK_GEAR.cargo).map((x) => x[0]), ...(TRUCK_FLASH[kind] ? ["flashbang"] : []), ...flat(its).filter((it) => isRoundItem(it) || isBulk(it)).map((it) => it.key), ...Object.keys(gunsFrom(`truck:${kind}`))])); } // TRUCK_GEAR: the roster's guns; TRUCK_FLASH: the hook's flashbangs; its rounds boxed and in bulk containers (ammo.js formFinds: checked by their own tools)
for (const a of Object.keys(AREA_FINDS)) { const rng = new Rng(a.length); const its = []; for (let i = 0; i < 400; i++) { const it = rollAreaFind(rng, a, 1, 20); if (it) its.push(it); } if (its.length) within(`small finds in a ${a}`, its, new Set(Object.keys(AREA_FINDS[a].items))); }
check(Object.values(AREAS).every((a) => (a.gear || []).every(([k]) => !!GEAR[k])), "every raid area's gear list is real gear");
{
  const paper = (type) => new Set([...(WARE_BOOKS[type] ? WARE_BOOKS[type].books : []), ...Object.keys(GEAR).filter((k) => GEAR[k].blueprint)]);
  for (const type of Object.keys(WARES)) {
    const f = st.factions.find((x) => x.type === type) || { ...st.factions[0], type, name: `test ${type}`, wares: null };
    const was = f.type; f.type = type;
    const its = [];
    for (let w = 0; w < 25; w++) { st.hour = w * 168; its.push(...restock(st, f)); }
    f.type = was;
    within(`a ${type} group's wares`, its, new Set([...WARES[type], ...Object.keys((WARE_BLADES[type] || {}).items || {}), ...Object.keys((WARE_SURV[type] || {}).items || {}), ...newGuns(type), ...Object.keys((WARE_EXTRAS[type] || {}).items || {}), ...Object.keys((WARE_GUNMODS[type] || {}).items || {}), ...Object.keys((WARE_MODS[type] || {}).items || {}), ...Object.keys((WARE_HEAD[type] || {}).items || {}), ...Object.keys((WARE_KIT[type] || {}).items || {}), ...paper(type), ...Object.keys(gunsFrom(`trader:${type}`)), ...Object.keys(partPool(PART_FINDS.WARE_TAGS[type]))])); // partfinds.js partWares: the catalogue's parts by the shelf's tags
  }
  st.hour = 0;
  const com = [];
  const cf = { ...st.factions[0], type: "commune", name: "Greenhollow test", wares: null };
  for (let w = 0; w < 60; w++) { st.hour = w * 168; com.push(...restock(st, cf)); }
  st.hour = 0;
  check(com.some((it) => ["fishrod", "fishnet", "snarewire", "lantern", "honey", "tobacco"].includes(it.key)), "a farming commune sells the tools of the land now and then");
}

// ---------- 4. no world-dice drift ----------
section("4. No world-dice drift (against dev 75793c5; bodies' and trucks' keys against the weapons roster)");
// The baseline moved with the weapons roster (wave 1, B: data-guns.js) on purpose, for two hashes only:
// - bodies' keys: KIT_PATCH appends new guns and loot to each kit's lists (combat.js KITS), so a body's weapon, its
//   kit loot and its pockets pick other keys (rng.pick of a longer list: one draw all the same, so the dice still end
//   where they did: BASE.bodies.rng is unchanged);
// - trucks: TRUCK_GEAR adds the roster's military guns to Army trucks (miltrucks.js TRUCK_LOOT_HOOKS rosterTruckGear,
//   plan section 22) on hashes of the truck's rng position, never a draw, so only the keys changed.
// Checked when re-taken: with KIT_PATCH taken back off KITS and the rosterTruckGear hook removed, both hashes come
// out as dev 75793c5's (bodies 5cc93cfd8dbebeeb, trucks 537afeab97d1a43f), so the drift is the roster's items alone.
// It moved again with the economy agent's parts (wave 1, C: loot.js AREA_MODS / WARE_MODS, visitors.js part kinds), for
// three hashes, keys only (every new roll is on hash dice of its own, the world's dice end where they did):
// - site finds: a raid container's gun-part roll that found nothing now rolls AREA_MODS (rollAreaGunmod -> rollAreaMod);
// - group wares: a group's table gets WARE_MODS parts (gunmodWares -> modWares);
// - merchants: a caravan's stock carries car parts, gun parts and electronics (three more stock keys).
// Checked when re-taken: with every AREA_MODS and WARE_MODS chance at 0 and the three part kinds left out of the
// merchants' stock count, the hashes come out as before (site finds dab86d9ad75a6877, group wares 0a732c1de196a889,
// merchants 70e09d390ad58668).
// The non-lethal kit (data-nonlethal.js, loot.js, the guards' kit) is new loot on purpose: the baseline is checked without it
// (taken out of the finds tables and the kits for this section, put back after it).
const NL_KEYS = new Set(["taser", "tasercart", "pepper", "stunbaton"]);
// Helmets and ear protection (helmets.js HEAD_FINDS / AREA_HEAD / WARE_HEAD, rolled on their own dice after the parts
// tables found nothing): new loot on purpose, off for the baselines (their chances at 0), back after them.
const headStash = [];
for (const T of [HEAD_FINDS, AREA_HEAD, WARE_HEAD]) for (const v of Object.values(T)) { headStash.push([v, v.p]); v.p = 0; }
const nlStash = [];
for (const T of [SITE_FINDS, AREA_FINDS]) for (const v of Object.values(T)) for (const k of Object.keys(v.items)) if (NL_KEYS.has(k)) { nlStash.push([v.items, k, v.items[k]]); delete v.items[k]; }
for (const K of Object.values(KITS)) for (const f of ["weapons", "strong", "loot", "finds"]) if (Array.isArray(K[f]) && K[f].some((k) => NL_KEYS.has(k))) { nlStash.push([K, f, K[f]]); K[f] = K[f].filter((k) => !NL_KEYS.has(k)); }
// Loot added after these baselines, off for this section the same way (back with the non-lethal kit after it):
// - the tourniquet (medics.js, med-selfstab): a row in the finds tables, the armoured dead's items, Army trucks' gear and
//   group wares (one chance draw each, so the dice moved too);
// - knives and swords (data-blades.js BLADE_KIT_PATCH, appended to the kits' loot; blades.js BLADE_FINDS / AREA_BLADES /
//   WARE_BLADES, their own dice after a roll that found nothing: chances at 0);
// - the arsenal of 2026-10-10 (gunfinds.js: ARSENAL_FINDS site / area / wares chances at 0, their own dice);
// - boxed and bulk rounds (ammo.js formFinds, a truck hook on hashed dice: taken off with the flashbang hook below).
// - survival gear (data-survival.js SURV_KIT_PATCH, appended to the kits' loot after the blades; survival.js SURV_FINDS /
//   AREA_SURV / WARE_SURV, its own dice after everything else: chances at 0), 2026-10-19.
const LATER_KEYS = new Set(["tourniquet", ...Object.values(BLADE_KIT_PATCH).flatMap((p) => Object.values(p).flat()), ...Object.values(SURV_KIT_PATCH).flatMap((p) => Object.values(p).flat())]);
for (const T of [SITE_FINDS, AREA_FINDS]) for (const v of Object.values(T)) for (const k of Object.keys(v.items)) if (LATER_KEYS.has(k)) { nlStash.push([v.items, k, v.items[k]]); delete v.items[k]; }
for (const K of Object.values(KITS)) for (const f of ["weapons", "strong", "loot", "finds"]) if (Array.isArray(K[f]) && K[f].some((k) => LATER_KEYS.has(k))) { nlStash.push([K, f, K[f]]); K[f] = K[f].filter((k) => !LATER_KEYS.has(k)); }
for (const B of Object.values(MILDEAD.BODY)) for (const f of ["items", "armor"]) if (Array.isArray(B[f]) && B[f].some((r) => LATER_KEYS.has(r[0]))) { nlStash.push([B, f, B[f]]); B[f] = B[f].filter((r) => !LATER_KEYS.has(r[0])); }
for (const T of Object.values(TRUCK_LOOT)) if (T.gear.some((r) => LATER_KEYS.has(r[0]))) { nlStash.push([T, "gear", T.gear]); T.gear = T.gear.filter((r) => !LATER_KEYS.has(r[0])); }
for (const type of Object.keys(WARES)) if (WARES[type].some((k) => LATER_KEYS.has(k))) { nlStash.push([WARES, type, WARES[type]]); WARES[type] = WARES[type].filter((k) => !LATER_KEYS.has(k)); }
for (const T of [BLADE_FINDS, AREA_BLADES, WARE_BLADES, SURV_FINDS, AREA_SURV, WARE_SURV, BOX_FINDS.site, BOX_FINDS.area]) for (const v of Object.values(T)) { headStash.push([v, v.p]); v.p = 0; }
for (const f of ["site", "area", "wares"]) { nlStash.push([ARSENAL_FINDS, f, ARSENAL_FINDS[f]]); ARSENAL_FINDS[f] = {}; }
// - the parts catalogue (partfinds.js: PART_FINDS site / area / wares chances at 0, rolled last on their own dice) and
//   the gun distribution (gundist.js swapGun: a listed gun swapped for one of its source's pool on a hash; off, every
//   source yields its own list on the same dice).
for (const f of ["site", "area", "wares"]) { nlStash.push([PART_FINDS, f, PART_FINDS[f]]); PART_FINDS[f] = {}; }
GUN_DIST.off = true;
// - the wind-up and the military flashlight (lights.js windlight / tacflash, night sight by the hour, ab69f1b): rows
//   appended to LIGHT_FINDS, so a light find picks from a longer table (one draw all the same: the keys move, not the
//   dice; with them off the site finds hash back to edc8e9c7fdaab752);
// - the cooking books (Cooking, c63df1a: the cookbook, the chef's handbook, game cookery, the prepper's pantry) at the
//   end of the traders' and the commune's WARE_BOOKS lists (with them off the group wares hash back to 2474e79ab28f41c7).
const NIGHT_LIGHTS = new Set(["windlight", "tacflash"]);
for (const v of Object.values(LIGHT_FINDS)) for (const k of Object.keys(v.items)) if (NIGHT_LIGHTS.has(k)) { nlStash.push([v.items, k, v.items[k]]); delete v.items[k]; }
const cookBook = (k) => !!(GEAR[k] && GEAR[k].book && GEAR[k].book.skill === "cooking");
for (const B of Object.values(WARE_BOOKS)) if (B.books.some(cookBook)) { nlStash.push([B, "books", B.books]); B.books = B.books.filter((k) => !cookBook(k)); }
// - and its guns in the kits (data-guns.js ARSENAL_KITS, then CALIBRE_KITS and AR_KITS, each appended to KIT_PATCH's
//   lists in that order: the tail of each list once the non-lethal kit and the blades are off, taken off last first) and
//   in Army trucks (TRUCK_GEAR rows of its guns, hashed dice). The survival guns (SURV_KITS, 2026-10-19) came after AR_KITS.
let kitTails = true;
for (const T of [SURV_KITS, AR_KITS, CALIBRE_KITS, ARSENAL_KITS]) for (const [kind, add] of Object.entries(T)) for (const [f, list] of Object.entries(add)) {
  const K = KITS[kind], cur = K && K[f];
  if (Array.isArray(cur) && cur.slice(-list.length).join() === list.join()) { nlStash.push([K, f, cur]); K[f] = cur.slice(0, -list.length); }
  else kitTails = false;
}
check(kitTails, "the later guns sit at the end of each kit's lists (ARSENAL_KITS, CALIBRE_KITS, AR_KITS, SURV_KITS in order: a new table goes in this list)");
for (const kind of Object.keys(TRUCK_GEAR)) { nlStash.push([TRUCK_GEAR, kind, TRUCK_GEAR[kind]]); TRUCK_GEAR[kind] = TRUCK_GEAR[kind].filter((r) => !ARSENAL_GEAR[r[0]]); }
const BASE = {
  bodies: { keys: "917048c944387995", rng: 94849467201019 }, areaFinds: { keys: "4f69608bbca97f26", rng: 19566617580356 }, trucks: "ddd64fb55272735e",
  // groupWares.keys and visitors: re-baselined for gen-tiers' Industrial Power Manual (blueprints.js indpower, now in
  // the military's wares and the traders' manuals); with it taken out they come back to 8b17671c3192515c,
  // 3bdc366902700698 / 706e068b336b9d26 / 12580090440502 exactly.
  // siteFinds and groupWares.keys: the wind-up and military flashlights (vision.js lights, 27096bf: loot.js LIGHT_FINDS
  // windlight / tacflash) and the cookbooks in the traders' and the commune's books (cooking, a447855: skills.js
  // WARE_BOOKS) are taken off above (NIGHT_LIGHTS, cookBook), so the old hashes hold (the world's dice unchanged). With
  // them left in they come to 449949deb71a9b49 and 6d226e0b96b09acc; the dazzling-bardeen merge (08ab2d0) carried both
  // that re-baseline and the take-off (8b2f1d3), which is why the two drift checks failed there.
  siteFinds: "edc8e9c7fdaab752", groupWares: { keys: "2474e79ab28f41c7", rng: 2670422955354 }, visitors: { keys: "c6ac67fed2276a9e", merchants: "bf202c687fe737a0", rng: 12799878338062 },
};
// The flashbang branch's extras (deadsoldiers.js MILDEAD.BODY_EXTRA, miltrucks.js TRUCK_LOOT_HOOKS) roll dice of their
// own and only add: off for these samples, like the commune's extras below, so the old baselines hold.
const bodyExtra = MILDEAD.BODY_EXTRA;
MILDEAD.BODY_EXTRA = {};
KIT_LOOT.on = false; // the carry kit (carrykit.js) only adds: checked below
// (only the flashbang hook: the roster's guns and the rounds by calibre stay, they are in the baselines above)
const takeHooks = (re) => { const out = TRUCK_LOOT_HOOKS.filter((f) => re.test(String(f))); for (const f of out) TRUCK_LOOT_HOOKS.splice(TRUCK_LOOT_HOOKS.indexOf(f), 1); return out; };
const takeFlashHooks = () => takeHooks(/truckflash/);
const truckHooks = takeHooks(/truckflash|formFinds/); // and the boxed and bulk rounds' hook (hashed dice, it only adds)
{
  const rng = new Rng(9001);
  const ks = [];
  const NEW_KITS = ["escorts", "contractors", "looters", "survivalists", "preppers"]; // added after the baseline (escorts.js: merchant caravans' guards; nomads.js: the nomad tiers)
  // A carrier's empty pouches (contents []) are no items: stowing a thing first looks for a stack to merge onto in the
  // rig's pouches (inventory.js mergeOnto -> rigPouches makes the list), which the baseline's carriers never had.
  const bodyKeys = (items) => keysOf(items.map((it) => (it && it.contents && GEAR[it.key] && GEAR[it.key].pouches && !it.contents.some(Boolean) ? { key: it.key } : it)));
  for (let i = 0; i < 400; i++) for (const kit of Object.keys(KITS).filter((k) => !NEW_KITS.includes(k))) {
    const K = KITS[kit];
    ks.push(bodyKeys(allItems(enemyBody(rng, { kind: "human", name: "x", id: i, kit, weapon: K.weapons[i % K.weapons.length], armorKey: K.armor[i % K.armor.length] }, K))));
  }
  for (let i = 0; i < 1500; i++) ks.push(bodyKeys(allItems(enemyBody(rng, { kind: "zombie", name: "z", id: i, ztype: i % 5 === 0 ? "soldier" : i % 7 === 0 ? "riot" : null }, null))));
  for (let i = 0; i < 1500; i++) ks.push(bodyKeys(deadBodyFinds(rng, i % 6 === 0 ? "soldier" : null).gear));
  check(h16(ks.join("|")) === BASE.bodies.keys, "bodies: the same items as before");
  check(rng.state === BASE.bodies.rng, `bodies: the dice end where they did (${rng.state} vs ${BASE.bodies.rng})`);
}
{
  const rng = new Rng(77);
  const ks = [];
  for (const a of Object.keys(AREA_FINDS)) for (let i = 0; i < 300; i++) { const it = rollAreaFind(rng, a, 1, 5); ks.push(it ? it.key : "-"); }
  check(h16(ks.join("|")) === BASE.areaFinds.keys && rng.state === BASE.areaFinds.rng, "raid containers' small finds: the same, the dice where they were");
}
{
  const ks = [];
  for (const kind of ["cargo", "humvee", "mrap"]) for (const cond of ["intact", "wrecked", "burnt"]) {
    const rng = new Rng(kind.length * 100 + cond.length);
    for (let i = 0; i < 200; i++) ks.push(keysOf(truckLoot(rng, kind, cond).gear.filter((it) => !LAUNCH_ADDED.has(it.key)))); // the launchers' rows (wave 2) only add, on dice of their own
    ks.push(String(rng.state));
  }
  check(h16(ks.join("|")) === BASE.trucks, "trucks: the same items, the dice where they were");
}
MILDEAD.BODY_EXTRA = bodyExtra;
TRUCK_LOOT_HOOKS.push(...truckHooks);
KIT_LOOT.on = true;
{
  // The carry kit on bodies (carrykit.js bodyKit: their rig and spare magazines; throwables into a rig's grenade pouch):
  // the same dice, the same items, more of them (flattened: a rig's pouches and a pack's slots).
  const runs = [];
  for (const on of [false, true]) {
    KIT_LOOT.on = on;
    const rng = new Rng(9001), lists = [];
    for (let i = 0; i < 300; i++) for (const kit of Object.keys(KITS)) {
      const K = KITS[kit];
      lists.push(flat(allItems(enemyBody(rng, { kind: "human", name: "x", id: i, kit, weapon: K.weapons[i % K.weapons.length], armorKey: K.armor[i % K.armor.length], mags: [{ key: "mag_stanag_30", cap: 30, where: "pocket", n: 30 }], rigKey: i % 2 ? "chestrig" : null }, K))).map((it) => it.key));
    }
    runs.push({ lists, state: rng.state });
  }
  KIT_LOOT.on = true;
  let onlyAdds = runs[0].state === runs[1].state, added = 0;
  const KIT_KEYS = (k) => !!(GEAR[k] && (GEAR[k].mag || GEAR[k].slot === "rig"));
  runs[0].lists.forEach((was, i) => {
    const now = [...runs[1].lists[i]];
    for (const k of was) { const j = now.indexOf(k); if (j < 0) onlyAdds = false; else now.splice(j, 1); }
    if (now.some((k) => !KIT_KEYS(k))) onlyAdds = false;
    added += now.length;
  });
  check(onlyAdds && added > 0, `the carry kit on enemy bodies only adds (${added} rigs and magazines): the rest and the dice are as without it`);
}
{
  // With them on: the same dice, only flashbangs and smoke grenades added (each body and truck: what it had, and more).
  const runs = [];
  for (const on of [false, true]) {
    const saved = MILDEAD.BODY_EXTRA, hooks = on ? [] : takeFlashHooks();
    if (!on) MILDEAD.BODY_EXTRA = {};
    const rng = new Rng(9001), lists = [];
    for (let i = 0; i < 1500; i++) lists.push(allItems(enemyBody(rng, { kind: "zombie", name: "z", id: i, ztype: i % 3 === 0 ? "soldier" : "riot" }, null)).filter(Boolean).map((it) => it.key));
    for (let i = 0; i < 300; i++) lists.push(truckLoot(rng, "cargo", "intact").gear.map((it) => it.key));
    runs.push({ lists, state: rng.state });
    MILDEAD.BODY_EXTRA = saved;
    TRUCK_LOOT_HOOKS.push(...hooks);
  }
  let onlyAdds = runs[0].state === runs[1].state, added = 0;
  runs[0].lists.forEach((was, i) => {
    const now = [...runs[1].lists[i]];
    for (const k of was) { const j = now.indexOf(k); if (j < 0) onlyAdds = false; else now.splice(j, 1); }
    if (now.some((k) => k !== "flashbang" && k !== "smokegren" && k !== "commset")) onlyAdds = false; // commset: a dead soldier's headset (helmets.js; its own dice too)
    added += now.length;
  });
  check(onlyAdds && added > 0, `the flashbang extras (the armoured dead, Army trucks) only add (${added} flashbangs and smoke grenades): the rest and the dice are as without them`);
}
KIT_LOOT.on = false; // the carry kit's finds and wares (carrykit.js SITE_KIT / AREA_KIT / WARE_KIT: their own dice, after a roll that found nothing) are new
{
  const w = createWorld({ seed: 4242, factionCount: 8 });
  w.started = true;
  const ks = [];
  const sites = w.tiles.filter((t) => t.loc).slice(0, 120);
  for (const t of sites) for (let hr = 0; hr < 120; hr++) {
    w.hour = hr;
    for (const f of [rollFind, rollHuntFind, rollLightFind, rollGunmodFind]) { const it = f(w, t.id, 3, "s"); ks.push(it ? it.key : "-"); }
    for (const a of Object.keys(AREA_GUNMODS)) { const it = rollAreaGunmod(w, t.id, a, `b${hr}`); ks.push(it ? it.key : "-"); }
  }
  w.hour = 0;
  check(h16(ks.join("|")) === BASE.siteFinds, "site finds: the same");
  const p0 = WARE_EXTRAS.commune.p;
  WARE_EXTRAS.commune.p = 0; // the commune's extras are new (their own dice): without them the stock is what it was
  const gk = [];
  const r0 = w.rng.state;
  for (let wk = 0; wk < 30; wk++) for (const f of w.factions) { w.hour = wk * 24 * 7; gk.push(f.type + ":" + keysOf(restock(w, f))); }
  WARE_EXTRAS.commune.p = p0;
  check(h16(gk.join("|")) === BASE.groupWares.keys, "group wares: the same kinds (less the commune's new extras)");
  check(w.rng.state - r0 === BASE.groupWares.rng, "group wares: the world's dice end where they did");
  const info = V.visitorInfo(w);
  RELOAD.MERCHANT.on = false; // the reloading bench's powder and primers are new (their own dice): without them the caravans are what they were
  const vk = [], mk = [];
  for (let i = 0; i < 60; i++) for (const kind of ["merchants", "explorers"]) {
    const v = V.spawnVisitor(w, kind);
    if (!v) continue;
    (kind === "merchants" ? mk : vk).push(`${v.name}:${v.tile}:${kind === "merchants" ? Object.keys(v.stock).filter((k) => k !== "buildmat" && !FOODS[k]).length + 2 : keysOf(v.wares)}`); // buildmat: building materials (the base ladder, staging.js), a stock key added later; food by type (foods.js): their food and preserved food are items now, counted as the two keys they were
    w.visitors.length = 0;
  }
  check(h16(vk.join("|")) === BASE.visitors.keys, "travellers: the same wares");
  RELOAD.MERCHANT.on = true;
  check(h16(mk.join("|")) === BASE.visitors.merchants, "merchants: the same caravans, at the same places");
  check(info.rng.state === BASE.visitors.rng, "visitors: their dice end where they did (the specialities use dice of their own)");
}
KIT_LOOT.on = true;

// ---------- 5. merchants' specialities ----------
GUN_DIST.off = false;
for (const [o, k, v] of [...nlStash].reverse()) o[k] = v; // the non-lethal kit and the later loot back (last off, first back)
for (const [v, p] of headStash) v.p = p; // helmets and ear protection back
section("5. Merchants' specialities");
{
  const w = createWorld({ seed: 99, factionCount: 8 });
  w.started = true;
  const by = {};
  for (let i = 0; i < 300; i++) { const v = V.spawnVisitor(w, "merchants"); if (!v) continue; (by[v.spec] = by[v.spec] || []).push(v); w.visitors.length = 0; }
  check(Object.keys(V.MERCHANT_SPECS).every((k) => (by[k] || []).length >= 20), `every speciality turns up (${Object.keys(V.MERCHANT_SPECS).map((k) => `${k} ${(by[k] || []).length}`).join(", ")})`);
  const blue = new Set(Object.keys(GEAR).filter((k) => GEAR[k].blueprint));
  const mods = new Set([...Object.keys(WARE_GUNMODS.merchants.items), ...Object.keys(WARE_MODS.merchants.items), ...Object.keys(WARE_HEAD.merchants.items), ...Object.keys(WARE_KIT.merchants.items), ...Object.keys(WARE_BLADES.merchants.items), ...Object.keys(WARE_SURV.merchants.items), ...Object.keys(WARE_CARTS.merchants.items), ...Object.keys(partPool(PART_FINDS.WARE_TAGS.merchants))]); // WARE_BLADES: knives and swords (blades.js bladeWares, with the parts)
  for (const [k, S] of Object.entries(V.MERCHANT_SPECS)) {
    const vs = by[k] || [];
    const allowed = new Set([...S.gear, ...S.books, ...V.MERCHANT_VALUABLES, ...blue, ...(k === "arms" || k === "general" ? mods : []), ...(k === "arms" ? newGuns("merchants") : []), ...Object.keys(gunsFrom("trader:merchants"))]); // gundist.js: a merchant's gun // an arms dealer's newer guns (visitors.js gunWares)
    within(`${S.name.toLowerCase()}' wares`, vs.flatMap((v) => v.wares), allowed);
    check(vs.every((v) => v.wares.filter((it) => S.gear.includes(it.key)).length >= 2), `${S.name.toLowerCase()} carry 2–4 things of their trade each`);
    const amt = (v, sup) => (sup === "food" ? foodIn(v.stock) : sup === "preserved" ? foodSplit(v.stock).stable : v.stock[sup] || 0); // food by type (foods.js): days of it, every item / the kinds that keep
    const mean = (sup) => vs.reduce((a, v) => a + amt(v, sup), 0) / Math.max(1, vs.length);
    const others = Object.keys(V.MERCHANT_SPECS).filter((x) => x !== k).flatMap((x) => by[x] || []);
    const oMean = (sup) => others.reduce((a, v) => a + amt(v, sup), 0) / Math.max(1, others.length);
    for (const sup of Object.keys(S.stock)) check(mean(sup) > oMean(sup) * 1.15, `${S.name.toLowerCase()} bring more ${sup} (${mean(sup).toFixed(0)} vs ${oMean(sup).toFixed(0)})`);
    const gear = vs.flatMap((v) => v.wares).filter((it) => rollsQuality(it.key));
    check(gear.every((it) => it.quality >= 0.6 && it.quality <= 1), `${S.name.toLowerCase()}' gear is fair to good (merchant: 60–100%)`);
  }
  console.log(`  ${Object.entries(V.MERCHANT_SPECS).map(([k, S]) => `${S.name}: ${S.gear.join(", ")}`).join("\n  ")}`);
}

// ---------- 6. prices follow condition ----------
section("6. Prices fall with condition");
{
  const f = st.factions.find((x) => x.type === "traders") || st.factions[0];
  restock(st, f);
  const fine = newItem("ar", 1), worn = newItem("ar", 0.6), used = newItem("ar", 1);
  used.dur = Math.round(GEAR.ar.dur * 0.2);
  check(itemValue(worn) < itemValue(fine) && itemValue(used) < itemValue(fine), `worth: fine ${itemValue(fine).toFixed(1)}, worn ${itemValue(worn).toFixed(1)}, nearly worn out ${itemValue(used).toFixed(1)}`);
  const sp = (it) => gearSellPrice(st, f, it, 0), bp = (it) => gearBuyPrice(st, f, it, 0);
  check(sp(worn) < sp(fine) && sp(used) < sp(fine), `they pay less for a worse one (${sp(fine).toFixed(1)} / ${sp(worn).toFixed(1)} / ${sp(used).toFixed(1)})`);
  check(bp(worn) < bp(fine) && bp(used) < bp(fine), `they charge less for a worse one (${bp(fine).toFixed(1)} / ${bp(worn).toFixed(1)} / ${bp(used).toFixed(1)})`);
  // Over a sample of wares: price tracks condition.
  const its = Array.from({ length: 40 }, (_, i) => lootItem("pistol", "trader", ["price", i]));
  const cond = (it) => (0.2 + 0.8 * it.quality) * (0.3 + 0.7 * it.dur / GEAR.pistol.dur);
  const byCond = [...its].sort((a, b) => cond(a) - cond(b));
  check(byCond.every((it, i) => i === 0 || bp(it) >= bp(byCond[i - 1]) - 1e-9), `on a table of 40 pistols the price rises with the condition (${bp(byCond[0]).toFixed(1)} … ${bp(byCond[39]).toFixed(1)})`);
}
{
  // The trade window: condition in a word and the uses left.
  const w = createWorld({ seed: 4242, factionCount: 8 });
  w.started = true;
  let v = null;
  for (let i = 0; i < 40 && !(v && v.wares.some((it) => rollsWear(it.key))); i++) { if (w.visitors) w.visitors.length = 0; v = V.spawnVisitor(w, "merchants", {}); }
  check(!!v, "a merchant caravan to trade with");
  if (v) {
    v.tile = hub(w).tile; v.phase = "stop"; v.stayUntil = w.hour + 24; // at your gates
    V.openVisitorTrade(w, v, { baseId: hub(w).id });
    const html = tradeWindow(w, { attackConfirm: null });
    check(/(poor|worn|good|fine|excellent) \d+%/.test(html), "the trade window shows the condition in a word");
    check(/\d+\/\d+ uses/.test(html), "the trade window shows the uses left of the most");
    check(html.includes(`Merchants (${V.specName(v)})`), `the trade window says what they deal in (${V.specName(v)})`);
    check(!/undefined|NaN/.test(html), "no undefined or NaN in the trade window");
  }
}

// ---------- 7. the balance between sources ----------
// Shops are picked over (good but used, now and then something boxed), below the Army's crates; professionals' guns
// (soldiers, contractors; guards and escorts less so) come off their bodies from a higher floor, on every path:
// a body's kit (enemyBody, with the gun's condition as it fought: gunfire.js enemyGunCond / lootGun), the dead searched
// on a raid map and fights by the numbers (lootItem by kitSource), caravan guards by the numbers (escorts.js
// guardGear) and a group's arsenal (arsenal.js starterKit: what its people carry and what is looted off them).
section("7. Condition by source (shops and homes picked over; professionals' guns kept)");
setLootAge(0);
{
  const stats = (rolls) => {
    const Q = rolls.map((c) => c.q).sort((a, b) => a - b), D = rolls.map((c) => c.d).sort((a, b) => a - b);
    const at = (a, p) => a[Math.floor(p * (a.length - 1))], mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return { q: mean(Q), d: mean(D), q10: at(Q, 0.1), q90: at(Q, 0.9), d10: at(D, 0.1), d90: at(D, 0.9), dmin: D[0], worth: mean(rolls.map((c) => (0.2 + 0.8 * c.q) * (0.3 + 0.7 * c.d))), n: rolls.length };
  };
  const bySource = (srcs, keys, n = 1500) => stats(srcs.flatMap((src) => keys.flatMap((k) => Array.from({ length: n }, (_, i) => { const c = rollCondition(k, src, ["bal", src, k, i]); return { q: c.quality, d: c.dur / GEAR[k].dur }; }))));
  const GUNS = ["pistol", "huntrifle", "shotgun", "ar"];
  const rows = {
    "Gun store": bySource([siteSource("gunstore"), areaSource("gunshop", "gunstore")], GUNS),
    "Hardware store": bySource([siteSource("hardware"), areaSource("store", "hardware")], ["crowbar", "fireaxe", "sledge", "machete"]),
    "Homes": bySource([siteSource("town"), areaSource("house", "town")], GUNS),
    "Police": bySource([siteSource("police"), areaSource("armory", "police")], GUNS),
    "Military sites": bySource([siteSource("military"), areaSource("armory", "military")], ["ar", "carbine", "vest", "plate"]),
  };
  // Bodies: the gun on a body after a fight (enemyBody: the gun's condition as it fought), by kit.
  const bodyGuns = (kit) => {
    const K = KITS[kit], rng = new Rng(kit.length * 13 + 1), out = [];
    for (let i = 0; i < 1500; i++) {
      const w = K.weapons[i % K.weapons.length];
      const u = { kind: "human", name: "x", id: i, kit, weapon: w, armorKey: null, q: enemyGunQ(i * 7 + 3, i, kit), cond: enemyGunCond(i * 7 + 3, i, kit) };
      const g = enemyBody(rng, u, K).gear.weapon;
      if (g && GEAR[g.key].dur) out.push({ q: g.quality, d: g.dur / itemDurMax(g) });
    }
    return stats(out);
  };
  for (const kit of ["soldiers", "contractors", "guards", "escorts", "raiders", "militia"]) rows[`${KITS[kit].label}s' guns (battle)`] = bodyGuns(kit);
  const line = (name, r) => `  ${name.padEnd(28)} quality ${pct(r.q)} (${pct(r.q10)}–${pct(r.q90)})  uses ${pct(r.d)} (${pct(r.d10)}–${pct(r.d90)}, lowest ${pct(r.dmin)})  worth ×${r.worth.toFixed(2)}`;
  console.log(Object.entries(rows).map(([k, r]) => line(k, r)).join("\n"));
  const G = rows["Gun store"], H = rows["Hardware store"], M = rows["Military sites"];
  for (const [name, r] of [["gun store", G], ["hardware store", H]]) {
    check(r.worth < M.worth && r.q < M.q && r.d < M.d, `a ${name}'s stock is worse kept than a military site's (worth ×${r.worth.toFixed(2)} vs ×${M.worth.toFixed(2)})`);
    check(r.q10 >= 0.45 && r.q90 <= 0.9 && r.d10 >= 0.45 && r.d90 <= 0.88, `a ${name}'s finds are good but used: quality ${pct(r.q10)}–${pct(r.q90)}, uses ${pct(r.d10)}–${pct(r.d90)} (10th–90th)`);
  }
  {
    const Ho = rows["Homes"];
    check(Ho.q10 >= 0.5 && Ho.q90 <= 0.9 && Ho.q < 0.75, `homes as picked over as the shops: quality ${pct(Ho.q)} (${pct(Ho.q10)}–${pct(Ho.q90)}), uses ${pct(Ho.d)}`);
    check(Math.abs(Ho.worth - G.worth) < 0.06, `a home's guns and a gun store's are about equally worn (worth ×${Ho.worth.toFixed(2)} and ×${G.worth.toFixed(2)})`);
  }
  { let boxed = 0; for (let i = 0; i < 4000; i++) { const c = rollCondition("ar", "shop", ["box", i]); if (c.quality >= SHOP.boxed.q[0]) boxed++; } check(boxed > 4000 * SHOP.boxed.p * 0.7 && boxed < 4000 * SHOP.boxed.p * 1.3, `now and then one still boxed, near new (${boxed} of 4000 rifles: ${pct(boxed / 4000)})`); }
  for (const kit of ["soldiers", "contractors"]) { const r = rows[`${KITS[kit].label}s' guns (battle)`]; check(r.dmin >= 0.55 - 0.01 && r.d10 >= 0.58 && r.d90 >= 0.88, `a ${kit === "soldiers" ? "soldier" : "contractor"}'s gun off the body: uses from 55% (lowest ${pct(r.dmin)}, typically ${pct(r.d10)}–${pct(r.d90)})`); }
  for (const kit of ["guards", "escorts"]) { const r = rows[`${KITS[kit].label}s' guns (battle)`]; check(r.dmin >= 0.45 - 0.01, `a${kit === "escorts" ? "n escort" : " guard"}'s gun off the body: uses from 45% (lowest ${pct(r.dmin)})`); }
  for (const kit of ["raiders", "militia"]) { const r = rows[`${KITS[kit].label}s' guns (battle)`]; check(r.dmin < 0.3, `${kit}' guns as worn as before (lowest ${pct(r.dmin)})`); }
  // Fights by the numbers and the dead searched on a raid map: lootItem by kitSource (conflicts.js, wanderers.js, combat.js).
  { let lo = 9; for (let i = 0; i < 2000; i++) { const it = lootItem("ar", kitSource("soldiers"), ["numbers", i]); lo = Math.min(lo, it.dur / GEAR.ar.dur); } check(lo >= 0.54, `a soldier's rifle taken after a fight by the numbers: uses from ${pct(lo)}`); }
  // Caravan guards by the numbers (escorts.js guardGear): a contractor's rifle like a soldier's, a guard's like a guard's.
  for (const [kit, floor] of [["contractors", 0.55], ["escorts", 0.45], ["guards", 0.45]]) {
    let lo = 9, n = 0;
    for (let r = 0; r < 200; r++) for (const it of guardGear(kit, 4, (i, k) => (((r * 31 + i * 7 + k.length * 13) % 97) + 0.5) / 97).gear) if (GEAR[it.key].slot === "weapon" && GEAR[it.key].dur) { lo = Math.min(lo, it.dur / GEAR[it.key].dur); n++; }
    check(n > 0 && lo >= floor - 0.01, `caravan ${kit}' guns by the numbers (escorts.js guardGear): uses from ${pct(lo)} (${n} guns)`);
  }
  // The groups' arsenals: a military group's guns (what its people fight with, and what is looted off them).
  {
    const kit = starterKit(5, "Fort test", "military", 30), guns = kit.filter((it) => GEAR[it.key].slot === "weapon" && GEAR[it.key].dur && !GEAR[it.key].throw);
    const lo = Math.min(...guns.map((it) => it.dur / GEAR[it.key].dur));
    check(guns.length > 10 && lo >= 0.54, `a military group's arsenal: its guns from ${pct(lo)} uses (${guns.length} guns)`);
    const rk = starterKit(5, "Red test", "raider", 30).filter((it) => GEAR[it.key].slot === "weapon" && GEAR[it.key].dur && !GEAR[it.key].throw);
    check(Math.min(...rk.map((it) => it.dur / GEAR[it.key].dur)) < 0.4, "a raider group's guns as worn as before");
  }
}

// ---------- 8. the years since the fall; a gun store's locks ----------
// Shops and homes slide toward their floor ranges with the years since the fall (COND_AGE), counted by the game's day:
// a normal game's day 1 is NORMAL_FALL days after the fall, a hardcore run's day 1 is the fall itself. Locked storage,
// military crates and bodies do not age. A gun store's cages and safes roll in the military's range (GUNSTORE_LOCKED).
section("8. Shops and homes over the years; a gun store's cages and safes");
{
  const statsAt = (src, keys, age) => {
    const Q = [], D = [];
    for (const k of keys) for (let i = 0; i < 1500; i++) { const c = rollCondition(k, src, ["age", src, k, i], { age }); Q.push(c.quality); D.push(c.dur / GEAR[k].dur); }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return { q: mean(Q), d: mean(D), dmin: Math.min(...D) };
  };
  const GUNS = ["pistol", "huntrifle", "shotgun", "ar"];
  // Years since the fall at the start of each game year of a normal game (eras.js: year 1 day 1, then every 112 days from day 99).
  const ageAtYear = (y) => lootAgeOf({ hour: ((y <= 1 ? 1 : 112 * (y - 1) - 14 + 1) - 1) * 24, mode: "normal" });
  const lines = [];
  let prev = null, mono = true;
  for (const y of [1, 2, 3, 5, 7, 8, 9, 12]) {
    const a = ageAtYear(y), sh = statsAt("shop", GUNS, a), ho = statsAt("home", GUNS, a), mi = statsAt("military", GUNS, a);
    lines.push(`  year ${String(y).padStart(2)} (${a.toFixed(2)} years since the fall, ${pct(ageShare(a))} of the way): shops quality ${pct(sh.q)} uses ${pct(sh.d)}; homes ${pct(ho.q)} / ${pct(ho.d)}; military ${pct(mi.q)} / ${pct(mi.d)}`);
    if (prev && (sh.q > prev.sh.q + 1e-9 || ho.d > prev.ho.d + 1e-9 || Math.abs(mi.q - prev.mi.q) > 1e-9)) mono = false;
    prev = { sh, ho, mi };
  }
  console.log(lines.join("\n"));
  check(ageShare(ageAtYear(1)) === 0 && ageShare(lootAgeOf({ hour: 80 * 24, mode: "normal" })) === 0, "a normal game's first year: shops and homes as their table says");
  check(mono, "shops and homes only get worse over the years; the Army's crates do not change");
  const y5 = statsAt("shop", GUNS, ageAtYear(5)), y1 = statsAt("shop", GUNS, ageAtYear(1)), y12 = statsAt("shop", GUNS, ageAtYear(12));
  check(y5.q < y1.q - 0.05 && y5.q > y12.q + 0.04, `slowly: a shop's guns ${pct(y1.q)} in year 1, ${pct(y5.q)} in year 5, ${pct(y12.q)} at the floor`);
  check(ageShare(ageAtYear(9)) === 1 && ageShare(ageAtYear(20)) === 1, "the floor from year 9 on (never worse)");
  { const F = COND_AGE.SOURCES.shop, A = agedSource("shop", 50); check(A.q[0] === F.q[0] && A.q[1] === F.q[1] && A.d[0] === F.d[0] && A.d[1] === F.d[1] && A.boxed === SHOP.boxed, `the shops' floor: quality ${F.q.map(pct).join("–")}, uses ${F.d.map(pct).join("–")} (a sealed box keeps its own)`); }
  check(["gunsafe", "police", "military", "soldier", "wreck"].every((src) => agedSource(src, 50) === COND_SOURCES[src]), "locked storage, the Army's and the police's, bodies and wrecks do not age");
  // The world's clock: a new world, an hour, a load; a hardcore run counts from the fall (its own day 1).
  const w = createWorld({ seed: 31, factionCount: 6 });
  check(Math.abs(lootAge() - lootAgeOf(w)) < 1e-12 && Math.abs(lootAge() - COND_AGE.NORMAL_FALL / 112) < 1e-9, `a new normal world: ${lootAge().toFixed(3)} years since the fall (day 1 is ${COND_AGE.NORMAL_FALL} days after it)`);
  w.hour = 112 * 24 * 4; w.cards = []; tickHour(w);
  const after = lootAge();
  check(Math.abs(after - lootAgeOf(w)) < 1e-12 && after > 4, `every hour sets it from the game's day (${after.toFixed(2)} years after 4 game years)`);
  w.cards = []; w.combat = null;
  const saved = JSON.parse(JSON.stringify(serializeState(w, { dropCards: true })));
  setLootAge(0);
  const back = deserializeState(saved);
  check(Math.abs(lootAge() - lootAgeOf(back)) < 1e-12 && lootAge() > 4, "a load sets it from the loaded world");
  const hc = createWorld({ seed: 31, factionCount: 6, mode: "hardcore" });
  const hcAge = lootAge();
  check(hc.mode === "hardcore" && hcAge < 0.01, `a hardcore run starts on the day of the fall: ${hcAge.toFixed(3)} years`);
  check(Math.abs(lootAgeOf({ hour: 400 * 24, mode: "hardcore" }) - lootAgeOf({ hour: (400 - COND_AGE.NORMAL_FALL) * 24, mode: "normal" })) < 1e-9, `a hardcore run's day N is as old as a normal game's day N − ${COND_AGE.NORMAL_FALL}: its first year (the outbreak) counts`);
  setLootAge(0);
  // A gun store's cages and safes: the Army's range, not the gun safe's; elsewhere unchanged.
  check(lockSource("guns", "gunstore") === GUNSTORE_LOCKED && lockSource("guns", "police") === "gunsafe" && lockSource("guns") === "gunsafe" && lockSource("meds", "gunstore") === "shop", "a gun store's gun cage: the military's range; a police one still a gun safe's");
  check(stashSource(2, "gunstore") === GUNSTORE_LOCKED && stashSource(2, "town") === "gunsafe" && stashSource("riflecase", "gunstore") === "home", "a gun store's gun safe: the military's range; a home's safe still a gun safe's");
  const cage = statsAt(lockSource("guns", "gunstore"), GUNS, 0), army = statsAt("military", GUNS, 0), safe = statsAt("gunsafe", GUNS, 0), floor = statsAt("shop", GUNS, 0);
  check(Math.abs(cage.d - army.d) < 1e-9 && cage.d < safe.d && cage.dmin >= 0.59 && cage.q > floor.q + 0.1, `a gun store's cage: uses from ${pct(cage.dmin)} (mean ${pct(cage.d)}, the Army's ${pct(army.d)}, a gun safe elsewhere ${pct(safe.d)}), better than the shop floor (quality ${pct(cage.q)} vs ${pct(floor.q)})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
