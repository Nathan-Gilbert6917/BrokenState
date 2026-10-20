// World configuration (2026-10-19, user request; sim/worldcfg.js, ui/worldcfg.js): the new-run screen's World… window
// and its dials. Checks: the settings object (defaults, clamping, steps, the min–max pairs, presets and Custom), the
// world (a standard world carries no worldCfg and plays as before; a set one keeps it through save and load), and that
// each dial reaches the sim: hunger, thirst, spoilage, horde size, the dead at sites, hive growth, zombie damage on the
// battle, infection from bites, the worm's cure, the groups' starting rounds and kit, events, raids, the loot by kind,
// the sizes of bases, raid maps (cities and towns always the largest), city crawls and hive crawls, wear, failures and fuel. The window: every dial drawn, a preset
// picked sets them, moving one flips the select to Custom, Done rebuilds only when something changed.
// Usage: node tools/worldcfgtest.js [-v]
import { createWorld, tickHour } from "../src/sim/world.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { WORLD_CFG, CFG_KEYS, CFG_PRESETS, defaultCfg, cleanCfg, cleanValue, isDefaultCfg, presetOf, presetCfg, cfgOf, cfgChance, lootQty, cfgSummary, battleDials, setWorldCfg } from "../src/sim/worldcfg.js";
import { thirstFactor } from "../src/sim/weather.js";
import { makeHorde } from "../src/sim/hordes.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { hubEventChance } from "../src/sim/hubevents.js";
import { gridOf as cityGrid, crawlRange, GRID as CITY } from "../src/sim/citygrid.js";
import { gridOf as baseGrid, GRID as BASE, stampGrid, yardHalf, GRID_MAX } from "../src/sim/basemap.js";
import { denDepth, HCRAWL } from "../src/sim/hivecrawl.js";
import { raidDims, buildingTarget, raidMinDims, raidMaxDims, raidBig } from "../src/sim/battlesize.js";
import { raidRange, legacyRaids, RAID_MAPS } from "../src/sim/worldcfg.js";
import { buildingMap } from "../src/sim/buildingmaps.js";
import { wearSlot } from "../src/sim/crafting.js";
import { wear as vehWear, breakdownRoll } from "../src/sim/vehicles.js";
import { jamChance } from "../src/sim/gunfire.js";
import { fuelForPath } from "../src/sim/parties.js";
import { wormTreatInfo, wormCurable, INCURABLE, cureWorm } from "../src/sim/worm.js";
import { ageLots, syncLots, lotsOf } from "../src/sim/foods.js";
import { worldConfigModal, WC_ACTIONS, WC_CHANGE, worldButton, worldLabel, uiCfg, wcChanged } from "../src/ui/worldcfg.js";
import { newRunScreen } from "../src/ui/newgame.js";
import { helpTopics } from "../src/ui/help.js";
import { Rng } from "../src/sim/rng.js";

let pass = 0, fail = 0;
const VERBOSE = process.argv.includes("-v");
const check = (ok, msg) => { if (ok) { pass++; if (VERBOSE) console.log(`  ok ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const world = (worldCfg = null, seed = 11, mode = "normal") => createWorld({ seed, factionCount: 4, worldCfg, mode });
const meanHunger = (st) => st.survivors.reduce((a, s) => a + s.hunger, 0) / st.survivors.length;

section("the settings object");
{
  const d = defaultCfg();
  check(CFG_KEYS.length >= 30 && CFG_KEYS.every((k) => k in d), `every dial has a default (${CFG_KEYS.length} dials)`);
  check(isDefaultCfg(d) && isDefaultCfg(null) && isDefaultCfg({}), "the defaults, nothing and an empty object are standard");
  check(cleanValue("hunger", 99) === WORLD_CFG.hunger.max && cleanValue("hunger", -1) === WORLD_CFG.hunger.min && cleanValue("hunger", "abc") === 1, "a multiplier is clamped to its range; garbage is its default");
  check(cleanValue("hunger", 1.234) === 1.25 && cleanValue("cityMin", 7.6) === 8 && cleanValue("raidMin", 33) === 34 && cleanValue("raidMax", "0x31") === 50, "values snap to the step (0.05; whole numbers; a raid map's width by 2, as the map is)");
  check(cleanValue("curable", "false") === false && cleanValue("curable", "on") === true && cleanValue("curable", undefined) === true, "the toggle reads strings and defaults on");
  const c = cleanCfg({ hunger: 2, bogus: 5, cityMin: 35, cityMax: 20 });
  check(c.hunger === 2 && !("bogus" in c) && c.thirst === 1, "cleanCfg keeps known dials, drops unknown ones, fills the rest");
  check(c.cityMin === 35 && c.cityMax === 35, "a min set over its max lifts the max");
  const c2 = cleanCfg({ cityMin: 35, cityMax: 20 }, "cityMax");
  check(c2.cityMin === 20 && c2.cityMax === 20, "a max moved under its min drops the min");
  const c3 = cleanCfg({ hiveMin: 11, hiveMax: 4 });
  check(c3.hiveMin === 11 && c3.hiveMax === 11, "the hive pair too");
  check(presetOf(d) === "standard" && presetOf(presetCfg("harsh")) === "harsh" && presetOf(presetCfg("nightmare")) === "nightmare" && presetOf(presetCfg("gentle")) === "gentle", "each preset is recognized as itself");
  check(presetOf({ ...presetCfg("harsh"), hunger: 1.3 }) === null, "one dial off a preset is Custom");
  check(presetCfg("nope") === null, "an unknown preset is null");
  for (const [k, p] of Object.entries(CFG_PRESETS)) check(CFG_KEYS.every((x) => presetCfg(k)[x] === cleanValue(x, presetCfg(k)[x])), `${p.name}'s values are all in range and on step`);
  check(presetCfg("nightmare").curable === false && presetCfg("harsh").curable === true, "Nightmare turns the cure off; Harsh keeps it");
  check(cfgSummary(d) === "" && /Hunger ×2/.test(cfgSummary({ hunger: 2 })) && /Infection curable off/.test(cfgSummary({ curable: false })) && /^Harsh: /.test(cfgSummary(presetCfg("harsh"))), "the summary names the dials off standard, and the preset");
  check(cfgChance({ worldCfg: { events: 3 } }, "events", 0.5) === 1 && cfgChance(null, "events", 0.5) === 0.5, "a chance under a dial never passes 1");
  check(lootQty({ worldCfg: { lootAmmo: 0.5 } }, "ammo", 1) === 1 && lootQty({ worldCfg: { lootAmmo: 0 } }, "ammo", 7) === 0 && lootQty({ worldCfg: { lootFood: 2 } }, "jars", 3) === 6 && lootQty(null, "wood", 3) === 3, "loot by kind: whole, at least 1 unless the dial is 0; jars count as food; wood has no dial");
}

section("the world");
{
  const a = world(), b = world({ hunger: 2, hordes: 2 });
  check(!("worldCfg" in a), "a standard world carries no worldCfg");
  check(b.worldCfg && b.worldCfg.hunger === 2 && b.worldCfg.thirst === 1, "a set one carries the whole cleaned object");
  check(cfgOf(a, "hunger") === 1 && cfgOf(b, "hunger") === 2 && cfgOf(a, "curable") === true && cfgOf({ worldCfg: { curable: false } }, "curable") === false && cfgOf(null, "hordes") === 1, "cfgOf reads the dial, defaults without one");
  const st = { worldCfg: { hunger: 2 } };
  setWorldCfg(st, { hunger: 1 });
  check(!("worldCfg" in st), "setWorldCfg with all-default values removes the object");
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(b))));
  check(back.worldCfg && back.worldCfg.hunger === 2 && back.worldCfg.hordes === 2, "the dials survive save and load");
  // Raid maps in an older save (worldcfg.js RAID_MAPS, legacyRaids): a world made now carries the mark and loads as it
  // is; a save from before (no mark) keeps the old raid map sizes and none of the big-map scales.
  check(a.raidMaps === RAID_MAPS && !legacyRaids(a) && !legacyRaids(back), "a new world carries the raid map mark and loads as a new one");
  const old = world();
  delete old.raidMaps;
  const oldBack = deserializeState(JSON.parse(JSON.stringify(serializeState(old))));
  const at = (st, ty) => st.tiles.find((t) => t.loc && t.loc.type === ty);
  const dimsOf = (st, ty) => (at(st, ty) ? raidDims(at(st, ty), st).join("×") : "");
  check(legacyRaids(oldBack) && oldBack.raidMaps === RAID_MAPS && dimsOf(oldBack, "town") === "36×26" && dimsOf(oldBack, "city") === "40×30" && buildingTarget(at(oldBack, "city"), false, oldBack).join("×") === "24×18" && !raidBig(oldBack, 48, 34),
    `an older save keeps its old raid maps (a town ${dimsOf(oldBack, "town")}, a city ${dimsOf(oldBack, "city")}, a building at a site with several 24×18 at least, no big-map scales)`);
  const again = deserializeState(JSON.parse(JSON.stringify(serializeState(oldBack))));
  check(legacyRaids(again) && dimsOf(again, "town") === "36×26", "and keeps them through another save and load");
  // The dials in order whatever was stored: a hand-edited or older settings object with them the wrong way round, or out of range.
  const inv = { worldCfg: { raidMin: 70, raidMax: 30 } }, wild = { worldCfg: { raidMin: 5, raidMax: 500 } };
  check(raidRange(inv).join() === "30,70" && raidMinDims(inv)[0] === 30 && raidMaxDims(inv)[0] === 70 && raidDims(at(a, "town"), inv)[0] === 70 && raidRange(wild).join() === "24,80",
    `inverted dials read in order (${raidRange(inv).join("–")}; a town's map ${raidDims(at(a, "town"), inv).join("×")}), out-of-range ones clamped (${raidRange(wild).join("–")})`);
  const bd = battleDials(b);
  check(bd.zDmg === 1 && bd.wear === 1 && bd.failures === 1 && bd.infectBite === 1 && battleDials({ worldCfg: { zDmg: 1.5 } }).zDmg === 1.5, "the battle's dials");
  // The same seed with the standard dials is the same world as one built with no worldCfg at all (a default run is unchanged).
  const c = createWorld({ seed: 11, factionCount: 4, worldCfg: defaultCfg() });
  for (let i = 0; i < 24; i++) { tickHour(a); tickHour(c); }
  const shape = (st) => JSON.stringify([st.log.map((l) => l.text), st.survivors.map((s) => [s.name, s.hunger, s.thirst, s.health]), st.hordes.map((h) => [h.tile, h.size]), st.factions.map((f) => [f.name, f.pop, f.stock.scrap])]);
  check(shape(a) === shape(c), "standard dials build and play the same world as none (ids aside: a global counter)");
}

section("needs: hunger, thirst, spoilage");
{
  const a = world(), b = world({ hunger: 2 });
  for (let i = 0; i < 36; i++) { tickHour(a); tickHour(b); }
  check(meanHunger(b) < meanHunger(a) - 2, `hunger ×2: hungrier after 36 h (${meanHunger(a).toFixed(1)} vs ${meanHunger(b).toFixed(1)})`);
  check(Math.abs(thirstFactor(world({ thirst: 1.5 })) / thirstFactor(world()) - 1.5) < 1e-9, "thirst ×1.5 scales the thirst factor");
  // Spoilage: the same lots aged a day under ×2 lose twice as much.
  // The hub's lots aged a day at factor 1 under each dial: a lot's days left fall by 1, 2 and 0.
  const drop = (st) => { const base = st.bases[0]; syncLots(base, st); const L = lotsOf(base); const k = Object.keys(L).find((x) => L[x].length && L[x][0].left > 3); const was = L[k][0].left; ageLots(base, 1, () => 1, st); return was - L[k][0].left; };
  const d1 = drop(world()), d2 = drop(world({ spoil: 2 })), d0 = drop(world({ spoil: 0 }));
  check(Math.abs(d1 - 1) < 1e-9 && Math.abs(d2 - 2) < 1e-9 && Math.abs(d0) < 1e-9, `spoilage ×1, ×2 and 0 on a lot (${d1}, ${d2}, ${d0})`);
}

section("the dead");
{
  const a = world(), b = world({ hordes: 2, siteDead: 0, hiveGrowth: 0 });
  const h1 = makeHorde(a, { tile: 5, size: 30 }), h2 = makeHorde(b, { tile: 5, size: 30 }), h3 = makeHorde(b, { tile: 5, size: 30, split: true });
  check(h1.size === 30 && h2.size === 60 && h3.size === 30, "horde size ×2 (a split part keeps its size)");
  const site = a.tiles.findIndex((t) => t.loc && t.loc.type === "town");
  const zA = raidEnemies(a, site).find((g) => g.kind === "zombies"), zB = raidEnemies(b, site).find((g) => g.kind === "zombies");
  check(zA && !zB, "dead at sites 0: none at a town the standard world has them at");
  const zC = raidEnemies(world({ siteDead: 3 }), site).find((g) => g.kind === "zombies");
  check(zC && zC.count >= zA.count && zC.count <= 14, `dead at sites ×3: ${zA.count} → ${zC.count}, capped at 14`);
  const inc = (st) => { for (let i = 0; i < 24 * 3; i++) tickHour(st); return st.hives.reduce((x, h) => x + (h.income || 0), 0); };
  const ia = inc(world()), ib = inc(world({ hiveGrowth: 0 }));
  check(ia > 0 && ib === 0, `hive growth 0: no income (standard ${ia.toFixed(1)})`);
}

section("the worm and its cure");
{
  const a = world(), b = world({ curable: false });
  check(wormCurable(a) && !wormCurable(b), "the toggle");
  const sick = (st) => { const s = st.survivors[0]; s.worm = { v: 2, stage: "gut", day: 2, len: 30, since: 1, why: "test", how: "water", from: "test", seen: 1, treatedDay: -99, carded: "", paid: 0 }; return s; };
  const sa = sick(a), sb = sick(b);
  const ia = wormTreatInfo(a, a.bases[0], sa, "dewormer"), ib = wormTreatInfo(b, b.bases[0], sb, "dewormer");
  check(ia.reason !== INCURABLE && ib.reason === INCURABLE && !ib.ok, "incurable: no treatment at a base, with the reason");
  check(wormTreatInfo(b, b.bases[0], sb, "purge").reason === INCURABLE && wormTreatInfo(b, b.bases[0], sb, "surgery").reason === INCURABLE, "nor a purge nor surgery");
  cureWorm(a, sa); cureWorm(b, sb);
}

section("people, events, raids");
{
  const a = world(), b = world({ aiGear: 2 }), c = world({ aiGear: 0.5 });
  const rounds = (st) => st.factions.reduce((x, f) => x + Object.keys(f.stock).filter((k) => /^a_/.test(k)).reduce((y, k) => y + f.stock[k], 0), 0); // rounds by calibre (ammo.js)
  check(rounds(c) < rounds(a) && rounds(a) < rounds(b), `AI starting gear ×0.5 / ×1 / ×2: rounds ${rounds(c)} / ${rounds(a)} / ${rounds(b)} (their guns bring rounds of their own, so not in step)`);
  const strong = (st) => st.factions.reduce((x, f) => x + (f.arsenal ? f.arsenal.items.filter((it) => /^(ar|carbine|shotgun|huntrifle|smg|lmg|dmr|sniper)/.test(it.key)).length : 0), 0);
  check(strong(b) >= strong(a), `AI starting gear ×2: at least as many strong guns in the arsenals (${strong(a)} → ${strong(b)})`);
  const e2 = world({ events: 2 }), e0 = world({ events: 0 });
  check(Math.abs(hubEventChance(e2, e2.bases[0]) - Math.min(1, 2 * hubEventChance(a, a.bases[0]))) < 1e-9 && hubEventChance(e0, e0.bases[0]) === 0, "events ×2 and 0 on the hub event chance");
  // Raids 0: an aggressive group never raids over a year of days. (The dice are the world's; a standard run raids sooner or later.)
  const r0 = world({ raids: 0 }, 23);
  let raids = 0;
  for (let d = 0; d < 200; d++) { for (let h = 0; h < 24; h++) tickHour(r0); raids += (r0.log || []).filter((l) => /raid/i.test(l.text) && /on your|your base|at your/i.test(l.text)).length; r0.log.length = 0; }
  check(raids === 0, "raids 0: no raid on you in 200 days");
}

section("sizes");
{
  const a = world(), b = world({ cityMin: 20, cityMax: 20, hiveMin: 5, hiveMax: 5, baseMin: 0.5, baseMax: 1.5 });
  const cityTile = a.tiles.find((t) => t.loc && t.loc.type === "city");
  const townTile = a.tiles.find((t) => t.loc && t.loc.type === "town");
  check(cityGrid(a, cityTile).size >= CITY.CITY[0] && cityGrid(a, cityTile).size <= CITY.CITY[1] && cityGrid(b, cityTile).size === 20, "city crawl: the usual range, or exactly the dials' 20");
  const [tl, th] = crawlRange(b, true);
  check(tl <= th && tl >= 3 && cityGrid(b, townTile).size >= tl && cityGrid(b, townTile).size <= th, `a town's crawl is scaled by the same shares (${tl}–${th})`);
  const hive = a.hives[0];
  if (hive) check(denDepth(a, hive) >= HCRAWL.DEPTH[0] && denDepth(b, b.hives[0]) >= 5 && denDepth(b, b.hives[0]) <= 6, `hive crawl: a young hive ${denDepth(a, hive)} deep as usual, 5 (plus a spire) under the dials`);
  const d9 = world({ hiveMin: 1, hiveMax: 12 });
  if (d9.hives[0]) check(denDepth(d9, d9.hives[0]) >= 1, "a wider range still gives a depth");
  const base = b.bases[0];
  stampGrid(b, base);
  const g = baseGrid(base), g0 = BASE.hub;
  check(base.gridCfg && g.yard === Math.round(g0.yard * 0.5) && g.cap === Math.min(GRID_MAX - 2 - g0.out, Math.round(g0.cap * 1.5)), `base yard ×0.5 to start, ×1.5 at most (${g.yard}, ${g.cap})`);
  check(yardHalf(base) <= yardHalf(a.bases[0]), "the smaller yard shows");
  check(!a.bases[0].gridCfg && baseGrid(a.bases[0]) === g0, "a standard world's base reads GRID itself");
  const tiny = world({ baseMin: 0.5, baseMax: 0.5 }).bases[0];
  stampGrid(world({ baseMin: 0.5, baseMax: 0.5 }), tiny);
  const gt = baseGrid(tiny);
  check(gt.cap >= gt.yard && gt.yard >= gt.core + 2, "the cap is never under the yard, the yard never under the core");
  // Raid maps (battlesize.js raidDims): the usual 32 to 56 across, the dials' 40 to 72; cities and towns the largest.
  const r = world({ raidMin: 40, raidMax: 72 });
  const site = (st, ty) => st.tiles.find((t) => t.loc && t.loc.type === ty);
  const small = ["gas", "diner", "grocery", "pharmacy", "cabin", "barn"].map((ty) => site(a, ty)).find(Boolean);
  check(raidDims(cityTile, a)[0] === 56 && raidDims(townTile, a)[0] === 56 && raidDims(cityTile, r)[0] === 72 && raidDims(townTile, r)[0] === 72, `a city's and a town's raid map the largest (${raidDims(townTile, a).join("×")}; ${raidDims(townTile, r).join("×")} under the dials)`);
  if (small) check(raidDims(small, a)[0] === 32 && raidDims(small, r)[0] === 40, `a small site the smallest (${small.loc.type}: ${raidDims(small, a).join("×")}; ${raidDims(small, r).join("×")} under the dials)`);
  check(cleanCfg({ raidMin: 70, raidMax: 30 }).raidMax === 70 && cleanValue("raidMax", 500) === 80, "the raid map pair keeps min ≤ max and its range");
  const crawlB = buildingMap(r, townTile.id, { id: "b1", key: "house", name: "House" }, false), want = buildingTarget(townTile, false, r);
  check(crawlB.w >= want[0] && crawlB.h >= want[1], `a town's building (a crawl's) on the largest raid map under the dials (${crawlB.w}×${crawlB.h})`);
}

section("wear, failures, fuel");
{
  const a = world(), b = world({ wear: 0, failures: 0, fuel: 2 }), c = world({ wear: 2 });
  const s = () => ({ gear: { weapon: { key: "bat", dur: 10, durMax: 20 } } });
  const s1 = s(), s2 = s(), s3 = s();
  wearSlot(a, s1, "weapon", 2); wearSlot(b, s2, "weapon", 2); wearSlot(c, s3, "weapon", 2);
  check(s1.gear.weapon.dur === 8 && s2.gear.weapon.dur === 10 && s3.gear.weapon.dur === 6, "durability loss ×1, 0 and ×2 on a slot");
  const v1 = { type: "car", condition: 80 }, v2 = { type: "car", condition: 80 };
  vehWear(v1, true, 0, 1); vehWear(v2, true, 0, 0);
  check(v1.condition < 80 && v2.condition === 80, "vehicle wear takes the dial");
  const bb = { failures: 0 }, bn = { failures: 1 }, u = { weapon: "pistol", item: { key: "pistol", dur: 50, durMax: 100 } };
  const j1 = jamChance(bn, u), j0 = jamChance(bb, u), jx = jamChance({ failures: 2 }, u);
  check(j1 > 0 && j0 === 0 && Math.abs(jx - 2 * j1) < 1e-9 && Math.abs(jamChance(null, u) - j1) < 1e-9, `jams ×1 ${j1.toFixed(4)}, 0, ×2, and no battle given`);
  const p = { id: 1, vehicleIds: [], vehicle: true }; // breakdownRoll with no vehicles: null either way; the chance is per vehicle
  check(breakdownRoll(b, { ...p }, 0) === null, "breakdown roll without a vehicle is null");
  const path = [a.bases[0].tile, a.grid.neighbors(a.bases[0].tile)[0], a.grid.neighbors(a.grid.neighbors(a.bases[0].tile)[0])[0]];
  check(Math.abs(fuelForPath(b, path) - 2 * fuelForPath(a, path)) < 1e-9 && fuelForPath(a, path) > 0, "fuel use ×2 doubles a trip's estimate");
}

section("the window");
{
  const ui = { started: false };
  const st = world();
  const html = worldConfigModal(st, ui);
  check(CFG_KEYS.every((k) => html.includes(`data-k="${k}"`)), "every dial is drawn");
  check((html.match(/data-action="wc-set"/g) || []).length === CFG_KEYS.length * 2 - 1, "a slider and a number box each, a checkbox for the toggle");
  check(/value="standard" selected/.test(html) && !/value="custom" selected/.test(html), "the select reads Standard for the defaults");
  check(/Reset to standard/.test(html) && /data-action="wc-close"/.test(html) && /data-action="wc-preset"/.test(html), "the preset select, Reset and Done");
  WC_ACTIONS["wc-open"](st, ui, {});
  check(ui.wcOpen && !wcChanged(ui), "opened; nothing changed yet");
  WC_CHANGE["wc-preset"](st, ui, { value: "nightmare" });
  check(presetOf(uiCfg(ui)) === "nightmare" && wcChanged(ui) && worldLabel(ui) === "Nightmare", "a preset picked sets every dial");
  check(/value="nightmare" selected/.test(worldConfigModal(st, ui)), "and the select shows it");
  WC_CHANGE["wc-set"](st, ui, { dataset: { k: "hunger" }, value: "1.45", type: "range" });
  check(presetOf(uiCfg(ui)) === null && uiCfg(ui).hunger === 1.45 && worldLabel(ui) === "Custom", "a dial moved off the preset: Custom");
  check(/value="custom" selected/.test(worldConfigModal(st, ui)) && /Custom/.test(worldButton(ui)), "the select and the button read Custom");
  WC_CHANGE["wc-preset"](st, ui, { value: "custom" });
  check(uiCfg(ui).hunger === 1.45, "picking Custom changes nothing");
  WC_CHANGE["wc-set"](st, ui, { dataset: { k: "curable" }, checked: false, type: "checkbox" });
  check(uiCfg(ui).curable === false && /data-k="curable"(?! checked)/.test(worldConfigModal(st, ui)), "the toggle off");
  WC_CHANGE["wc-set"](st, ui, { dataset: { k: "cityMax" }, value: "10", type: "number" });
  check(uiCfg(ui).cityMax === 10 && uiCfg(ui).cityMin === 10, "a max typed under its min drops the min");
  WC_ACTIONS["wc-reset"](st, ui, {});
  check(isDefaultCfg(uiCfg(ui)) && worldLabel(ui) === "" && !/Custom|Standard:/.test(worldButton(ui).replace(/data-tip="[^"]*"/, "")), "Reset: standard again, the button plain");
  WC_ACTIONS["wc-close"](st, ui, {});
  check(!ui.wcOpen, "Done closes it");
  ui.started = true;
  WC_CHANGE["wc-set"](st, ui, { dataset: { k: "hunger" }, value: "3", type: "range" });
  WC_CHANGE["wc-preset"](st, ui, { value: "harsh" });
  check(uiCfg(ui).hunger === 1, "nothing moves once the game is running");
  ui.started = false;
  // The new-run screen carries the button, and the help its topic.
  const nr = newRunScreen(st, { ...ui, worldSize: "normal", factionCount: 4, hiveCount: null, mode: "normal" });
  check(/data-action="wc-open"/.test(nr) && /🌍 World…/.test(nr), "the new-run screen's World… button");
  WC_CHANGE["wc-preset"](st, ui, { value: "harsh" });
  check(/🌍 World: Harsh…/.test(newRunScreen(st, { ...ui, worldSize: "normal", factionCount: 4, hiveCount: null, mode: "normal" })), "it names the preset");
  check(helpTopics().some((t) => t.id === "world-configuration" && /Nightmare/.test(t.html)), "Help has the topic");
}

section("determinism");
{
  const run = () => { const st = world({ hordes: 1.5, events: 1.5, lootFood: 0.5 }, 31); for (let i = 0; i < 24 * 5; i++) tickHour(st); return JSON.stringify([st.log.map((l) => l.text), st.survivors.map((s) => [s.name, s.hunger, s.thirst, s.health, s.mood]), st.hordes.map((h) => [h.tile, h.size]), st.factions.map((f) => [f.name, f.pop, f.stock.scrap]), st.hives.map((h) => [h.tile, h.res])]); };
  check(run() === run(), "the same seed and dials play the same five days (ids aside: a global counter)");
  const rng = new Rng(3);
  check(rng.next() >= 0, "rng loads");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
