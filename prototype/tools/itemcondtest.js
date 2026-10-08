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
//      below were taken from dev 75793c5).
//   5. Merchants' specialities: each turns up, its gear and books from its list, its supplies (ammo, meds, parts) larger.
//   6. Prices fall with condition (valuation.js itemValue): a worse copy sells and buys for less; the trade window
//      shows the condition in a word and the uses left.
// Usage: node tools/itemcondtest.js
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { GEAR } from "../src/sim/data.js";
import { Rng } from "../src/sim/rng.js";
import { createWorld, tickHour, day, hub } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { KITS, AREAS } from "../src/sim/combat.js";
import { enemyBody, deadBodyFinds, allItems, lootItem, newItem, ZOMBIE_FINDS, ZOMBIE_PACKS, ZOMBIE_PACK_STUFF, ZBODY } from "../src/sim/inventory.js";
import { SITE_FINDS, rollAreaFind, AREA_FINDS, rollFind, rollHuntFind, rollLightFind, rollGunmodFind, rollAreaGunmod, AREA_GUNMODS, WARE_GUNMODS } from "../src/sim/loot.js";
import { truckLoot, TRUCK_LOOT } from "../src/sim/miltrucks.js";
import { ensureWares, WARES, WARE_EXTRAS, gearSellPrice, gearBuyPrice } from "../src/sim/trade.js";
import { WARE_BOOKS } from "../src/sim/skills.js";
import { MILDEAD } from "../src/sim/deadsoldiers.js";
import * as V from "../src/sim/visitors.js";
import {
  COND_SOURCES, rollCondition, condRolled, isPaper, rollsQuality, rollsWear, qualityWord, siteSource, areaSource, kitSource, traderSource,
} from "../src/sim/itemcond.js";
import { itemValue } from "../src/sim/valuation.js";
import { tradeWindow } from "../src/ui/tradewindow.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const h16 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const keysOf = (items) => items.filter(Boolean).map((it) => it.key + (it.contents ? `[${it.contents.filter(Boolean).map((c) => c.key).join(",")}]` : "")).join(",");
const flat = (items) => items.filter(Boolean).flatMap((it) => [it, ...(it.contents ? flat(it.contents) : [])]);
const pct = (v) => `${Math.round(v * 100)}%`;

// ---------- 1. distributions ----------
section("1. Distributions per source");
const table = [];
for (const [src, S] of Object.entries(COND_SOURCES)) {
  let qlo = 9, qhi = -9, dlo = 9, dhi = -9;
  for (let i = 0; i < 4000; i++) {
    const c = rollCondition("pistol", src, [src, i]);
    qlo = Math.min(qlo, c.quality); qhi = Math.max(qhi, c.quality);
    const f = c.dur / GEAR.pistol.dur;
    dlo = Math.min(dlo, f); dhi = Math.max(dhi, f);
  }
  check(qlo >= S.q[0] - 0.005 && qhi <= S.q[1] + 0.005, `${src}: quality ${qlo}–${qhi} within ${S.q.join("–")}`);
  check(qlo <= S.q[0] + 0.03 && qhi >= S.q[1] - 0.03, `${src}: quality spreads over its range (${qlo}–${qhi})`);
  check(dlo >= S.d[0] - 0.02 && dhi <= S.d[1] + 0.02, `${src}: uses ${pct(dlo)}–${pct(dhi)} within ${S.d.map(pct).join("–")}`);
  check(dlo <= S.d[0] + 0.04 && dhi >= S.d[1] - 0.04, `${src}: uses spread over their range (${pct(dlo)}–${pct(dhi)})`);
  table.push(`  ${S.name.padEnd(44)} quality ${S.q.join("–").padEnd(10)} uses ${S.d.map(pct).join("–")}`);
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
check(kitSource("soldiers") === "soldier" && kitSource("zealots") === "raider" && kitSource(undefined) === "survivor", "kit sources");
check(traderSource("military") === "traderMil" && traderSource("raider") === "traderRaider" && traderSource("commune") === "trader" && traderSource("merchants") === "merchant", "trader sources");
// Military better than raiders, on average.
const meanQ = (src) => { let a = 0; for (let i = 0; i < 2000; i++) a += rollCondition("ar", src, [i]).quality; return a / 2000; };
check(meanQ("traderMil") > meanQ("trader") && meanQ("trader") > meanQ("traderRaider"), "the military's stock is better kept than a trader's, a trader's than raiders'");
check(meanQ("shop") > meanQ("home") && meanQ("home") > meanQ("wreck"), "a shop's stock is better than a home's, a home's than a wreck's");

// ---------- 2. every creation point ----------
section("2. Every creation point rolls its condition");
// Static: loot code never calls newItem itself.
const ALLOWED = {
  "inventory.js": /export function newItem|condition\(newItem\(key, 1\)|g\.head = newItem\("footballhelmet"/, // the roller itself; an old save's helmet split
  "deadsoldiers.js": /newItem\(k, q\(range\), rng\)/, // the maker handed in (inventory.js armouredItem)
  "hardcore-start.js": /./, "recruits.js": /./, "world.js": /startdur/, // starting and recruit gear (START_DUR), not loot
  "blueprints.js": /bpItemKey/, "skills.js": /newItem\(key, 1\)|newItem\(list\[/, // paper
  "visitors.js": /bpItemKey|newItem\(k, 1\)\)/, // a merchant's blueprints and books (paper)
  "vehicles.js": /newItem\(t\.gun, 0\.8\)/, // a turret's own gun coming off a vehicle (not loot)
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
const notRolled = (items) => flat(items).filter((it) => !condRolled(it) && !isPaper(it.key));
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
{ const items = []; for (let w = 0; w < 20; w++) for (const f of st.factions) { st.hour = w * 168; items.push(...ensureWares(st, f, true)); } st.hour = 0; sampleCheck("group traders' wares", items); }
{
  const items = [];
  for (let i = 0; i < 80; i++) for (const kind of ["merchants", "explorers"]) { const v = V.spawnVisitor(st, kind); if (v) items.push(...v.wares); st.visitors.length = 0; }
  sampleCheck("merchants' and travellers' wares", items);
}
{
  const w = createWorld({ seed: 77, factionCount: 8 });
  w.started = true;
  setAutopilot(w, true, "balanced");
  while (day(w) <= 40 && !w.gameOver) tickHour(w);
  const items = [...w.factions.flatMap((f) => f.wares || []), ...(w.visitors || []).flatMap((v) => v.wares || [])];
  sampleCheck("a 40-day autopilot world's trade stock", items);
}

// ---------- 3. kinds stay source-bound ----------
section("3. Kinds by source");
const within = (label, items, allowed) => {
  const bad = [...new Set(flat(items).map((it) => it.key).filter((k) => !allowed.has(k)))];
  check(items.length > 0 && !bad.length, `${label}: ${flat(items).length} items from its own list${bad.length ? ` (stray: ${bad.join(", ")})` : ""}`);
};
for (const kit of Object.keys(KITS)) {
  const K = KITS[kit];
  const rng = new Rng(kit.length * 7);
  const items = [];
  for (let i = 0; i < 1500; i++) items.push(...allItems(enemyBody(rng, { kind: "human", name: "x", id: i, kit, weapon: K.weapons[i % K.weapons.length], armorKey: K.armor[i % K.armor.length] }, K)));
  within(`a ${K.label.toLowerCase()}'s body`, items, new Set([...K.weapons, ...K.armor.filter(Boolean), ...K.loot, ...(K.finds || []), ...(K.pack ? [K.pack[0]] : [])]));
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
    within(`an armoured ${z}'s body`, its, new Set([...B.armor, ...B.items].map((x) => x[0])));
  }
}
for (const kind of Object.keys(TRUCK_LOOT)) { const rng = new Rng(3); const its = []; for (let i = 0; i < 300; i++) its.push(...truckLoot(rng, kind, "intact").gear); within(`a ${kind} truck`, its, new Set(TRUCK_LOOT[kind].gear.map((x) => x[0]))); }
for (const a of Object.keys(AREA_FINDS)) { const rng = new Rng(a.length); const its = []; for (let i = 0; i < 400; i++) { const it = rollAreaFind(rng, a, 1, 20); if (it) its.push(it); } if (its.length) within(`small finds in a ${a}`, its, new Set(Object.keys(AREA_FINDS[a].items))); }
check(Object.values(AREAS).every((a) => (a.gear || []).every(([k]) => !!GEAR[k])), "every raid area's gear list is real gear");
{
  const paper = (type) => new Set([...(WARE_BOOKS[type] ? WARE_BOOKS[type].books : []), ...Object.keys(GEAR).filter((k) => GEAR[k].blueprint)]);
  for (const type of Object.keys(WARES)) {
    const f = st.factions.find((x) => x.type === type) || { ...st.factions[0], type, name: `test ${type}`, wares: null };
    const was = f.type; f.type = type;
    const its = [];
    for (let w = 0; w < 25; w++) { st.hour = w * 168; its.push(...ensureWares(st, f, true)); }
    f.type = was;
    within(`a ${type} group's wares`, its, new Set([...WARES[type], ...Object.keys((WARE_EXTRAS[type] || {}).items || {}), ...Object.keys((WARE_GUNMODS[type] || {}).items || {}), ...paper(type)]));
  }
  st.hour = 0;
  const com = [];
  const cf = { ...st.factions[0], type: "commune", name: "Greenhollow test", wares: null };
  for (let w = 0; w < 60; w++) { st.hour = w * 168; com.push(...ensureWares(st, cf, true)); }
  st.hour = 0;
  check(com.some((it) => ["fishrod", "fishnet", "snarewire", "lantern", "honey", "tobacco"].includes(it.key)), "a farming commune sells the tools of the land now and then");
}

// ---------- 4. no world-dice drift ----------
section("4. No world-dice drift (against dev 75793c5)");
// The non-lethal kit (data-nonlethal.js, loot.js, the guards' kit) is new loot on purpose: the baseline is checked without it
// (taken out of the finds tables and the kits for this section, put back after it).
const NL_KEYS = new Set(["taser", "tasercart", "pepper", "stunbaton"]);
const nlStash = [];
for (const T of [SITE_FINDS, AREA_FINDS]) for (const v of Object.values(T)) for (const k of Object.keys(v.items)) if (NL_KEYS.has(k)) { nlStash.push([v.items, k, v.items[k]]); delete v.items[k]; }
for (const K of Object.values(KITS)) for (const f of ["weapons", "strong", "loot", "finds"]) if (Array.isArray(K[f]) && K[f].some((k) => NL_KEYS.has(k))) { nlStash.push([K, f, K[f]]); K[f] = K[f].filter((k) => !NL_KEYS.has(k)); }
const BASE = {
  bodies: { keys: "5cc93cfd8dbebeeb", rng: 94849467201019 }, areaFinds: { keys: "4f69608bbca97f26", rng: 19566617580356 }, trucks: "537afeab97d1a43f",
  siteFinds: "dab86d9ad75a6877", groupWares: { keys: "0a732c1de196a889", rng: 2670422955354 }, visitors: { keys: "3bdc366902700698", merchants: "70e09d390ad58668", rng: 12580090440502 },
};
{
  const rng = new Rng(9001);
  const ks = [];
  for (let i = 0; i < 400; i++) for (const kit of Object.keys(KITS)) {
    const K = KITS[kit];
    ks.push(keysOf(allItems(enemyBody(rng, { kind: "human", name: "x", id: i, kit, weapon: K.weapons[i % K.weapons.length], armorKey: K.armor[i % K.armor.length] }, K))));
  }
  for (let i = 0; i < 1500; i++) ks.push(keysOf(allItems(enemyBody(rng, { kind: "zombie", name: "z", id: i, ztype: i % 5 === 0 ? "soldier" : i % 7 === 0 ? "riot" : null }, null))));
  for (let i = 0; i < 1500; i++) ks.push(keysOf(deadBodyFinds(rng, i % 6 === 0 ? "soldier" : null).gear));
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
    for (let i = 0; i < 200; i++) ks.push(keysOf(truckLoot(rng, kind, cond).gear));
    ks.push(String(rng.state));
  }
  check(h16(ks.join("|")) === BASE.trucks, "trucks: the same items, the dice where they were");
}
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
  for (let wk = 0; wk < 30; wk++) for (const f of w.factions) { w.hour = wk * 24 * 7; gk.push(f.type + ":" + keysOf(ensureWares(w, f, true))); }
  WARE_EXTRAS.commune.p = p0;
  check(h16(gk.join("|")) === BASE.groupWares.keys, "group wares: the same kinds (less the commune's new extras)");
  check(w.rng.state - r0 === BASE.groupWares.rng, "group wares: the world's dice end where they did");
  const info = V.visitorInfo(w);
  const vk = [], mk = [];
  for (let i = 0; i < 60; i++) for (const kind of ["merchants", "explorers"]) {
    const v = V.spawnVisitor(w, kind);
    if (!v) continue;
    (kind === "merchants" ? mk : vk).push(`${v.name}:${v.tile}:${kind === "merchants" ? Object.values(v.stock).length : keysOf(v.wares)}`);
    w.visitors.length = 0;
  }
  check(h16(vk.join("|")) === BASE.visitors.keys, "travellers: the same wares");
  check(h16(mk.join("|")) === BASE.visitors.merchants, "merchants: the same caravans, at the same places");
  check(info.rng.state === BASE.visitors.rng, "visitors: their dice end where they did (the specialities use dice of their own)");
}

// ---------- 5. merchants' specialities ----------
for (const [o, k, v] of nlStash) o[k] = v; // the non-lethal kit back
section("5. Merchants' specialities");
{
  const w = createWorld({ seed: 99, factionCount: 8 });
  w.started = true;
  const by = {};
  for (let i = 0; i < 300; i++) { const v = V.spawnVisitor(w, "merchants"); if (!v) continue; (by[v.spec] = by[v.spec] || []).push(v); w.visitors.length = 0; }
  check(Object.keys(V.MERCHANT_SPECS).every((k) => (by[k] || []).length >= 20), `every speciality turns up (${Object.keys(V.MERCHANT_SPECS).map((k) => `${k} ${(by[k] || []).length}`).join(", ")})`);
  const blue = new Set(Object.keys(GEAR).filter((k) => GEAR[k].blueprint));
  const mods = new Set(Object.keys(WARE_GUNMODS.merchants.items));
  for (const [k, S] of Object.entries(V.MERCHANT_SPECS)) {
    const vs = by[k] || [];
    const allowed = new Set([...S.gear, ...S.books, ...V.MERCHANT_VALUABLES, ...blue, ...(k === "arms" || k === "general" ? mods : [])]);
    within(`${S.name.toLowerCase()}' wares`, vs.flatMap((v) => v.wares), allowed);
    check(vs.every((v) => v.wares.filter((it) => S.gear.includes(it.key)).length >= 2), `${S.name.toLowerCase()} carry 2–4 things of their trade each`);
    const mean = (sup) => vs.reduce((a, v) => a + (v.stock[sup] || 0), 0) / Math.max(1, vs.length);
    const others = Object.keys(V.MERCHANT_SPECS).filter((x) => x !== k).flatMap((x) => by[x] || []);
    const oMean = (sup) => others.reduce((a, v) => a + (v.stock[sup] || 0), 0) / Math.max(1, others.length);
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
  ensureWares(st, f, true);
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

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
