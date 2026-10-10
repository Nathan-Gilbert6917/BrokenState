// The arsenal balance of 2026-10-10 (docs/weapons-overhaul-plan.md "Balance ladder 2026-10-10"; src/sim/ladder.js,
// data-ammo.js CAL_DMG / LADDER / ROUND_ECON / THEME_CALS, data-guns.js ARSENAL_* / GUN_RARITY / ARSENAL_FINDS,
// gunfinds.js). Checks:
// - the damage ladder: .22 < 9mm < .45 < .357 < 20 ga < 5.56 < 7.62×39 < 12 ga buck < .30-30 < .308 < 12 ga slug <
//   .50 on an unarmoured target; 5.56 closer to .22 than to .308; 12 ga buckshot between 5.56 and .308; a 12 ga slug
//   beats every .308 round, the .50 every round; no .22 round beats another calibre's base round; no variant leaps a
//   calibre whose base round is 20% or more above its own (slugs aside: their own rule); on a vest and a plate the .22
//   is lowest and the .50 highest, AP beats FMJ on a plate;
// - every gun's dmg within the band of its calibre (mounted guns aside), the guns' own hits follow the ladder
//   (every 5.56 gun under every .308 gun, the M2 over every 12 ga slug);
// - every calibre has a gun and a way to feed it (a magazine or an internal one); 20 gauge exists with its rounds;
// - every gun can be found somewhere (a site, a raid box, a kit, an Army truck, a gun safe, a shelf, the arsenal's
//   finds) and has a value, a weight, a durability and a rarity;
// - every round has a tier and a value; finds follow the tiers (in all the places together a rarer round of a calibre
//   turns up less than a commoner one); 5.56, .308, .22 and 12 ga among the most found calibres, .50 the least;
// - the arsenal's finds roll on their own dice (the world's random numbers untouched; the same roll twice the same);
// - break actions load both barrels a Reload, single-shots one;
// - the more calibres of 2026-10-10: 5.7×28 between 9mm and 5.56 a hit (over the 9mm, under the .45) with more pen
//   than a 9mm (through a soft vest better); .44 Magnum over the .357 and under the .308 a shot; their guns (5.7 pistol
//   and PDW, the low-recoil .45, the G3, the FAMAS, the .44 revolver, lever and single-shot) fed by their own
//   magazines or tubes; the Vector's full auto steadier than the other .45 SMG's; their boxes by retail size.
// Usage: node tools/arsenalbalancetest.js
import { WEAPONS, KITS, AREAS } from "../src/sim/combat.js";
import { GEAR, LOCATIONS } from "../src/sim/data.js";
import { CALIBERS, AMMO_TYPES, CAL_DMG, LADDER, ROUND_ECON, RARITY, AMMO_MIX, THEME_CALS, ammoKey, roundTier, roundValue } from "../src/sim/data-ammo.js";
import { SUPPLIES } from "../src/sim/data.js";
import { ARSENAL_GEAR, GUN_RARITY, ARSENAL_FINDS, TRUCK_GEAR, ARSENAL_TAGS } from "../src/sim/data-guns.js";
import { MAGAZINES, INTERNAL } from "../src/sim/data-kit.js";
import { AMMO_GEAR, ammoPen } from "../src/sim/data-ammo.js";
import { SHELLS, standardMag } from "../src/sim/mags.js";
import { hitDamage, rung, ladderRows, gunHit, TARGETS } from "../src/sim/ladder.js";
import { gunPool, rollSiteGuns, rollAreaGuns, gunWares, scavGun, stashGun } from "../src/sim/gunfinds.js";
import { SITE_TAGS, AREA_TAGS, ITEM_TAGS } from "../src/sim/loot.js";
import { GUN_STASH } from "../src/sim/gunsafes.js";
import { WARES } from "../src/sim/trade.js";
import { platformOf } from "../src/sim/gunmods.js";
import { hash01 } from "../src/sim/skills.js";

let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } };
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const lethal = (cal) => CALIBERS[cal].types.filter((t) => !AMMO_TYPES[t].nonlethal && !AMMO_TYPES[t].launch);
const base = (cal) => CALIBERS[cal].base;
const bare = (cal, t) => hitDamage(cal, t);

// ---------- the ladder ----------
console.log("The damage ladder (unarmoured, base round)");
const O = LADDER.ORDER;
console.log("  " + O.map((c) => `${c} ${f1(rung(c))}`).join(" < "));
check(O.every((c) => CALIBERS[c] && CAL_DMG[c]) && Object.keys(CALIBERS).filter((c) => CALIBERS[c].common !== false).every((c) => O.includes(c)), "every gun calibre is on the ladder with a reference damage");
check(O.every((c, i) => i === 0 || rung(c) > rung(O[i - 1])), "the base rounds climb the ladder in order");
check(O.every((c) => c === "22lr" || rung(c) > Math.max(...lethal("22lr").map((t) => bare("22lr", t)))), ".22: no .22 round beats another calibre's base round");
check(O.every((c) => c === "22lr" || lethal(c).every((t) => bare(c, t) > bare("22lr", "fmj"))), ".22 FMJ is the weakest lethal round there is");
check(rung("556") - rung("22lr") < rung("308") - rung("556"), `5.56 is closer to .22 than to .308 (${f1(rung("556") - rung("22lr"))} above, ${f1(rung("308") - rung("556"))} below)`);
check(lethal("556").every((t) => bare("556", t) < rung("308")), "no 5.56 round reaches the .308's base round");
check(rung("12ga") > rung("556") && rung("12ga") < rung("308"), `12 ga buckshot in the middle: between 5.56 and .308 (${f1(rung("12ga"))})`);
check(lethal("308").every((t) => bare("12ga", "slug") > bare("308", t)), `a 12 ga slug (${f1(bare("12ga", "slug"))}) beats every .308 round (best ${f1(Math.max(...lethal("308").map((t) => bare("308", t))))})`);
check(bare("20ga", "slug") < rung("308") && bare("20ga", "slug") < bare("12ga", "slug") && rung("20ga") < rung("12ga"), "20 ga under 12 ga, its slug under the .308");
check(O.filter((c) => c !== "50bmg").every((c) => lethal(c).every((t) => bare(c, t) < rung("50bmg"))), ".50 BMG beats every other round");
check(["9mm", "45acp", "357"].every((c, i, a) => i === 0 || rung(c) > rung(a[i - 1])) && rung("357") < rung("556"), "pistol calibres: 9mm < .45 < .357, all under 5.56");
const leaps = [];
for (const a of O) for (const t of lethal(a)) {
  if (t === "slug") continue; // a slug is its own projectile (the rule above)
  for (const b of O) if (rung(b) >= 1.2 * rung(a) && bare(a, t) > rung(b)) leaps.push(`${a} ${t} (${f1(bare(a, t))}) > ${b} (${f1(rung(b))})`);
}
check(!leaps.length, `no variant leaps a calibre 20% or more above its own${leaps.length ? `: ${leaps.join("; ")}` : ""}`);
for (const [tname, tgt] of [["vest", TARGETS.vest], ["plate", TARGETS.plate]]) {
  const all = O.flatMap((c) => lethal(c).map((t) => [c, t, hitDamage(c, t, tgt)]));
  const lo = Math.min(...all.filter(([c]) => c !== "22lr").map(([c, t]) => hitDamage(c, base(c), tgt)));
  check(lethal("22lr").every((t) => hitDamage("22lr", t, tgt) <= lo + 1e-9), `on a ${tname}: no .22 round beats another calibre's base round`);
  check(all.filter(([c]) => c !== "50bmg").every(([, , d]) => d < hitDamage("50bmg", "ball", tgt)), `on a ${tname}: .50 ball beats every other round`);
}
const apOn = (c) => (["9mm", "45acp", "357"].includes(c) ? TARGETS.vest : TARGETS.plate); // a pistol AP round is for soft armour, a rifle's for plates
check(O.filter((c) => CALIBERS[c].types.includes("ap")).every((c) => hitDamage(c, "ap", apOn(c)) > hitDamage(c, base(c), apOn(c))), "AP beats the base round on the armour it is made for (pistols a vest, rifles a steel plate)");
check(hitDamage("308", "fmj", TARGETS.vest) > hitDamage("556", "fmj", TARGETS.vest) && hitDamage("556", "fmj", TARGETS.vest) > hitDamage("22lr", "fmj", TARGETS.vest), "on a vest: .308 > 5.56 > .22");
check(ladderRows().length === O.reduce((a, c) => a + lethal(c).length, 0), "ladder.js lists every lethal round");

// ---------- the guns follow it ----------
console.log("Guns on the ladder");
const guns = Object.keys(WEAPONS).filter((k) => { const w = WEAPONS[k]; return !w.melee && w.ammo > 0 && w.cal && CALIBERS[w.cal] && CALIBERS[w.cal].common !== false && !w.launcher; });
const band = [];
for (const k of guns) {
  const w = WEAPONS[k];
  if (w.mount || w.mounted) continue;
  const r = (w.dmg[0] + w.dmg[1]) / 2 / ((CAL_DMG[w.cal][0] + CAL_DMG[w.cal][1]) / 2);
  if (r < LADDER.BAND[0] - 1e-9 || r > LADDER.BAND[1] + 1e-9) band.push(`${k} ${w.dmg.join("–")} (${r.toFixed(2)} of ${w.cal})`);
}
check(!band.length, `every gun's damage within ${LADDER.BAND.join("–")} of its calibre's${band.length ? `: ${band.join("; ")}` : ""}`);
const of = (cal) => guns.filter((k) => WEAPONS[k].cal === cal && !WEAPONS[k].mount && !WEAPONS[k].mounted);
const hit = (k, t = null) => gunHit(WEAPONS[k], t).bare;
check(Math.max(...of("556").map((k) => hit(k))) < Math.min(...of("308").map((k) => hit(k))), "every 5.56 gun hits lighter than every .308 gun");
check(Math.max(...of("22lr").map((k) => hit(k, "hp"))) < Math.min(...[...of("9mm"), ...of("556")].map((k) => hit(k))), "every .22 gun (hollow points) under every 9mm and 5.56 gun");
check(Math.max(...of("308").map((k) => hit(k))) < Math.min(...of("50bmg").map((k) => hit(k))), "every .308 gun under the .50");
check(Math.max(...of("12ga").map((k) => hit(k, "slug"))) < (WEAPONS.m2hb ? gunHit(WEAPONS.m2hb).bare : Infinity), "the M2's .50 over every 12 ga slug");
check(WEAPONS.shotgun && hit("shotgun", "slug") > Math.max(...of("308").filter((k) => !["sniper"].includes(k)).map((k) => hit(k, "sp"))), "a pump's slug beats every service .308 gun's soft point (the long-barrelled sniper rifle aside)");

// ---------- every calibre has a gun and its feeding ----------
console.log("Calibres, guns, magazines");
const fed = (k) => !!(INTERNAL[k] || standardMag(k) || Object.values(MAGAZINES).some((m) => m.cal === WEAPONS[k].cal && m.plat.includes(platformOf(k))));
for (const cal of Object.keys(CALIBERS).filter((c) => CALIBERS[c].common !== false)) {
  const gs = guns.filter((k) => WEAPONS[k].cal === cal && GEAR[k]);
  check(gs.length >= 1 && gs.every(fed), `${CALIBERS[cal].name}: ${gs.length} guns, each fed (${gs.join(", ")})`);
}
check(CALIBERS["20ga"] && ["buck", "slug", "bird"].every((t) => CALIBERS["20ga"].types.includes(t) && SUPPLIES[ammoKey("20ga", t)] && GEAR[ammoKey("20ga", t)]), "20 gauge: buckshot, slugs, birdshot as supplies and boxes");
check(["pump20", "ou20"].every((k) => WEAPONS[k] && WEAPONS[k].cal === "20ga"), "a 20 gauge pump and over-under");
check(["ou12", "ou20", "dbshotgun", "sawnoff"].every((k) => SHELLS.GUNS[k] === "break" && INTERNAL[k] === 2 && WEAPONS[k].cap === 2), "over-unders and doubles: break actions, 2 shells, both barrels a Reload");
check(["single12"].every((k) => SHELLS.GUNS[k] === "single" && INTERNAL[k] === 1 && WEAPONS[k].cap === 1) && INTERNAL.singlerifle === 1 && WEAPONS.singlerifle.cap === 1, "single-shots: one round a Reload");
check(SHELLS.BREAK === 2, "a break action loads both barrels at once");

// ---------- more calibres (2026-10-10): 5.7×28 and .44 Magnum, the P90, Vector, G3, FAMAS and the .44s ----------
console.log("More calibres: 5.7×28 and .44 Magnum");
check(rung("57x28") > rung("9mm") && rung("57x28") < rung("45acp") && rung("57x28") < rung("556"), `5.7×28 between 9mm and 5.56 a hit, under the .45 (${f1(rung("9mm"))} < ${f1(rung("57x28"))} < ${f1(rung("45acp"))})`);
check(ammoPen("57x28", "fmj") > ammoPen("9mm", "fmj") && ammoPen("57x28", "fmj") < ammoPen("556", "fmj") && hitDamage("57x28", "fmj", TARGETS.vest) > hitDamage("9mm", "fmj", TARGETS.vest) && hitDamage("57x28", "fmj", TARGETS.vest) > hitDamage("45acp", "fmj", TARGETS.vest), `5.7 goes through more than a 9mm: pen ${ammoPen("57x28", "fmj")} (9mm ${ammoPen("9mm", "fmj")}); on a vest ${f1(hitDamage("57x28", "fmj", TARGETS.vest))} over the 9mm's ${f1(hitDamage("9mm", "fmj", TARGETS.vest))} and the .45's ${f1(hitDamage("45acp", "fmj", TARGETS.vest))}`);
check(rung("44mag") > rung("357") && rung("44mag") < rung("308") && lethal("44mag").every((t) => bare("44mag", t) < rung("308")), `.44 Magnum over the .357 and under the .308 a shot (${f1(rung("357"))} < ${f1(rung("44mag"))} < ${f1(rung("308"))}; its hollow point ${f1(bare("44mag", "hp"))})`);
check(ammoPen("44mag", "fmj") > ammoPen("357", "fmj") && ammoPen("44mag", "fmj") < ammoPen("308", "fmj"), ".44 pen between the .357's and the .308's");
const NEW = { fiveseven: ["57x28", 20], p90: ["57x28", 50], vector: ["45acp", 25], g3: ["308", 20], famas: ["556", 25], revolver44: ["44mag", 6], lever44: ["44mag", 10], single44: ["44mag", 1] };
check(Object.entries(NEW).every(([k, [cal, cap]]) => WEAPONS[k] && GEAR[k] && WEAPONS[k].cal === cal && WEAPONS[k].cap === cap && ARSENAL_GEAR[k] && fed(k)), "the new guns: their calibre and capacity, each fed (the arsenal's)");
check(standardMag("p90") === "mag_p90_50" && standardMag("fiveseven") === "mag_fn57_20" && standardMag("vector") === "mag_vector_25" && standardMag("g3") === "mag_g3_20" && standardMag("famas") === "mag_famas_25", "own magazines: the PDW's 50, the 5.7 pistol's 20, the Vector's 25 (and 13), the G3's 20, the FAMAS's 25");
check(MAGAZINES.mag_vector_13 && MAGAZINES.mag_vector_13.cap === 13 && Object.values(MAGAZINES).filter((m) => m.plat.includes("famas") || m.plat.includes("g3") || m.plat.includes("p90")).every((m) => m.plat.length === 1), "the Vector takes a 13 too; the FAMAS, G3 and PDW magazines fit only their own gun");
check(!Object.values(MAGAZINES).some((m) => m.plat.includes(platformOf("famas")) && m.cap !== 25) && !Object.values(MAGAZINES).some((m) => m.plat.includes(platformOf("g3")) && m.cal !== "308"), "no STANAG in the FAMAS, no other .308 magazine in the G3");
check(INTERNAL.revolver44 === 2 && INTERNAL.lever44 === 4 && INTERNAL.single44 === 1 && platformOf("single44") === "single" && platformOf("lever44") === "lever" && platformOf("revolver44") === "revolver", ".44 revolver (cylinder), lever (tube of 10, 4 a Reload), single-shot (1 a Reload)");
check(WEAPONS.vector.modes.auto.aim > WEAPONS.ump45.modes.auto.aim && WEAPONS.vector.modes.burst.aim > WEAPONS.ump45.modes.burst.aim && WEAPONS.p90.modes.auto.aim > WEAPONS.smg.modes.auto.aim, "low recoil: the Vector's bursts and full auto lose less aim than the UMP-style .45's, the PDW's than the 9mm SMG's");
check(WEAPONS.famas.modes.auto.rounds > WEAPONS.aug.modes.auto.rounds && WEAPONS.famas.modes.burst.rounds === 3, "the FAMAS: a high rate (longer streams), three-round bursts");
check(WEAPONS.g3.rel < WEAPONS.fal.rel && WEAPONS.g3.rel < WEAPONS.scarh.rel, "the G3 jams less than the other battle rifles (roller-delayed)");
check(GUN_RARITY.p90 === "rare" && GUN_RARITY.famas === "rare" && GUN_RARITY.g3 === "rare" && ["revolver44", "lever44", "single44"].every((k) => GUN_RARITY[k] === "uncommon") && ["military", "police"].some((t) => ARSENAL_TAGS.p90.includes(t)), "the PDW, FAMAS and G3 rare, military and police; the .44s uncommon");
check(["hunt", "guns", "home"].every((t) => ["revolver44", "lever44", "single44"].some((k) => ARSENAL_TAGS[k].includes(t))), ".44s in hunting places, gun stores and homes");
check(AMMO_GEAR.a_44mag_fmj.dur === 50 && AMMO_GEAR.a_44mag_hp.dur === 20 && AMMO_GEAR.a_57x28_fmj.dur === 50 && AMMO_GEAR.a_57x28_hp.dur === 50, ".44 boxes of 50 (hollow points 20), 5.7 boxes of 50");

// ---------- every gun is found somewhere, with its numbers ----------
console.log("Finds, value, weight, durability, rarity");
const items = guns.filter((k) => GEAR[k]);
const src = new Set();
for (const d of Object.values(LOCATIONS)) for (const k of d.gear || []) src.add(k);
for (const a of Object.values(AREAS)) for (const [k] of a.gear || []) src.add(k);
for (const kit of Object.values(KITS)) for (const k of [...(kit.weapons || []), ...(kit.strong || []), ...(kit.loot || [])]) src.add(k);
for (const rows of Object.values(TRUCK_GEAR)) for (const [k] of rows) src.add(k);
for (const T of Object.values(GUN_STASH)) for (const k of [...Object.keys(T.guns || {}), ...Object.keys((T.rare || [0, {}])[1])]) src.add(k);
for (const list of Object.values(WARES)) for (const k of list) src.add(k);
const finds = new Set();
for (const [type, p] of Object.entries(ARSENAL_FINDS.site)) if (p > 0) for (const k of Object.keys(gunPool(SITE_TAGS[type] || []))) finds.add(k);
for (const [area, p] of Object.entries(ARSENAL_FINDS.area)) if (p > 0) for (const k of Object.keys(gunPool(AREA_TAGS[area] || []))) finds.add(k);
const crafted = (k) => !!(GEAR[k] && GEAR[k].makeshift);
const lost = items.filter((k) => !src.has(k) && !finds.has(k) && !crafted(k));
check(!lost.length, `every gun is found somewhere${lost.length ? ` (not: ${lost.join(", ")})` : ""}`);
const noFind = Object.keys(ARSENAL_GEAR).filter((k) => !finds.has(k)), noAI = Object.keys(ARSENAL_GEAR).filter((k) => !src.has(k));
check(!noFind.length, `every new gun turns up in the arsenal's finds (which the AI's scavengers roll too)${noFind.length ? ` (not: ${noFind.join(", ")})` : ""}`);
check(noAI.length <= 1, `the new guns are on the AI's people (kits) too, bar the very rarest (not: ${noAI.join(", ") || "none"})`);
const bad = items.filter((k) => !(GEAR[k].value > 0 && GEAR[k].weight > 0 && GEAR[k].dur > 0 && RARITY.includes(GUN_RARITY[k])));
check(!bad.length, `every gun has a value, weight, durability and rarity${bad.length ? ` (not: ${bad.join(", ")})` : ""}`);
check(Object.keys(ARSENAL_GEAR).every((k) => ITEM_TAGS[k] && ITEM_TAGS[k] === ARSENAL_TAGS[k] || (ITEM_TAGS[k] || []).join() === ARSENAL_TAGS[k].join()), "every new gun has its loot tags");
const pricier = Object.keys(ARSENAL_GEAR).filter((k) => ["rare", "veryrare"].includes(GUN_RARITY[k]) && GEAR[k].value < 100 && GEAR[k].cat !== "pistol");
check(!pricier.length, `the rare long guns are dear (${pricier.join(", ") || "all 100+"})`);

// ---------- rounds: tier and value; finds follow the tiers ----------
console.log("Rounds by rarity");
const keys = Object.keys(CALIBERS).flatMap((c) => CALIBERS[c].types.map((t) => [c, t]));
check(keys.every(([c, t]) => ROUND_ECON[`${c}_${t}`] && RARITY.includes(roundTier(c, t)) && roundValue(c, t) > 0), "every round has a tier and a value (data-ammo.js ROUND_ECON)");
check(keys.every(([c, t]) => Math.abs(SUPPLIES[ammoKey(c, t)].value - roundValue(c, t)) < 1e-6 || CALIBERS[c].common === false), "a round's supply value is its ROUND_ECON value");
check(["22lr", "9mm", "556", "308", "12ga"].every((c) => roundTier(c, base(c)) === "common") && roundTier("50bmg", "ball") === "rare", "5.56, .308, .22, 12 ga (and 9mm) base rounds common, .50 rare");
const themes = Object.keys(AMMO_MIX);
const agg = {};
for (const th of themes) { const tot = Object.values(AMMO_MIX[th]).reduce((a, b) => a + b, 0); for (const [k, v] of Object.entries(AMMO_MIX[th])) agg[k] = (agg[k] || 0) + v / tot / themes.length; }
const inv = [];
for (const cal of Object.keys(THEME_CALS.guns).concat(["50bmg"])) for (const a of CALIBERS[cal].types) for (const b of CALIBERS[cal].types) {
  const ra = RARITY.indexOf(roundTier(cal, a)), rb = RARITY.indexOf(roundTier(cal, b));
  if (ra < rb && (agg[`${cal}_${a}`] || 0) <= (agg[`${cal}_${b}`] || 0) && (agg[`${cal}_${b}`] || 0) > 0) inv.push(`${cal} ${b} (${roundTier(cal, b)}) ≥ ${a} (${roundTier(cal, a)})`);
}
check(!inv.length, `in all the places together a rarer round of a calibre turns up less than a commoner one${inv.length ? `: ${inv.join("; ")}` : ""}`);
const byCal = {};
for (const [k, v] of Object.entries(agg)) { const c = k.split("_")[0]; byCal[c] = (byCal[c] || 0) + v; }
const top = Object.entries(byCal).sort((a, b) => b[1] - a[1]).map(([c]) => c);
console.log("  found most: " + top.map((c) => `${c} ${(byCal[c] * 100).toFixed(1)}%`).join(", "));
check(["556", "308", "22lr", "12ga"].every((c) => top.indexOf(c) < 5), "5.56, .308, .22 and 12 ga among the five calibres found most");
check(top[top.length - 1] === "50bmg", ".50 BMG found least");
check(themes.every((th) => Object.keys(AMMO_MIX[th]).every((k) => AMMO_MIX[th][k] > 0)), "no zero weights in a place's mix");

// ---------- own dice ----------
console.log("The arsenal's finds: their own dice");
const rng = { get state() { throw new Error("world rng read"); }, next() { throw new Error("world rng used"); }, int() { throw new Error("world rng used"); }, chance() { throw new Error("world rng used"); }, pick() { throw new Error("world rng used"); } };
const tiles = [];
const types = Object.keys(ARSENAL_FINDS.site);
types.forEach((type, i) => { tiles[i] = { loc: { type }, loot: 1 }; });
const state = { seed: 4242, hour: 7, rng, tiles };
let got = 0, same = true, tagsOk = true;
for (let h = 0; h < 400; h++) {
  state.hour = h;
  for (let i = 0; i < types.length; i++) {
    const a = rollSiteGuns(state, i, 1, "t"), b = rollSiteGuns(state, i, 1, "t");
    if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
    const g = a.find((it) => WEAPONS[it.key]);
    if (g) { got++; if (!(ITEM_TAGS[g.key] || []).some((t) => (SITE_TAGS[types[i]] || []).includes(t))) tagsOk = false; }
  }
}
check(got > 0 && same && tagsOk, `site finds: ${got} guns in ${400 * types.length} search hours, the same roll twice the same, each fits its site's tags, no world dice`);
let ag = 0;
for (let n = 0; n < 3000; n++) for (const area of Object.keys(ARSENAL_FINDS.area)) ag += rollAreaGuns(state, n % types.length, area, null, `b${n}`).filter((it) => WEAPONS[it.key]).length;
check(ag > 0, `raid boxes: ${ag} guns in ${3000 * Object.keys(ARSENAL_FINDS.area).length} containers`);
let wares = 0;
for (let d = 0; d < 300; d++) for (const t of Object.keys(ARSENAL_FINDS.wares)) wares += gunWares(state, t, `G${t}`, d).filter((it) => WEAPONS[it.key]).length;
check(wares > 0, `shelves: ${wares} guns in ${300 * Object.keys(ARSENAL_FINDS.wares).length} group-weeks`);
let sc = 0;
for (let n = 0; n < 2000; n++) if (scavGun("gunstore", 0.25, [1, "trip", n])) sc++;
check(sc > 0 && sc < 2000 * 0.3, `AI scavengers find them too (${sc} in 2000 gun store trips)`);
const out = { gear: [], sup: {} };
let st = 0;
for (let n = 0; n < 500; n++) { out.gear = []; stashGun({ roll: (...p) => hash01("stash", n, ...p), tier: "mid", table: "mid", siteType: "farm", source: "gunsafe" }, out); if (out.gear.some((it) => WEAPONS[it.key])) st++; }
check(st > 100 && st < 250, `gun safes: an extra gun in ${st} of 500 mid safes`);
const rare = { common: 0, veryrare: 0 };
for (let n = 0; n < 20000; n++) { const p = gunPool(AREA_TAGS.armory); const ks = Object.keys(p); const k = ks[Math.floor(hash01("r", n) * ks.length)]; if (GUN_RARITY[k] === "veryrare") rare.veryrare++; }
check(Object.values(gunPool(AREA_TAGS.armory)).every((w) => w > 0) && gunPool(AREA_TAGS.armory).m240 < gunPool(AREA_TAGS.armory).m4, "an armoury's pool weighs a very rare M240 below a scarce M4");

// ---------- the table ----------
console.log("\nLadder (mean hit: unarmoured / soft vest AC2 / steel plate AC4; tier, value a round)");
for (const r of ladderRows()) console.log(`  ${r.name.padEnd(32)} ${f1(r.bare).padStart(5)} ${f1(r.vest).padStart(5)} ${f1(r.plate).padStart(5)}  ${r.tier.padEnd(9)} ${r.value}`);
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
