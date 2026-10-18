// Ammo in its forms (2026-10-10, user requests; sim/data-stacks.js, sim/itemstack.js, sim/ammo.js formFinds / bulkFind):
//   - box sizes: typical US retail counts by calibre and load (12 gauge slugs 5, buckshot 10, birdshot 25; 5.56, .308,
//     7.62×39 20; .22 LR 100, premium 50; 9mm 50, defensive 20; .50 BMG 10), a calibre or load the data adds later
//     by its class; weight and worth follow the rounds;
//   - a slot: up to 80 loose rounds of one type, or up to five boxes of one kind; loose and boxed never merge; boxes open
//     into loose rounds, and loose rounds box again (tools/supitemstest.js: Box, loose and boxed dropped on each other);
//   - bulk containers: an ammo can (one type, 500), a carton (one calibre, 1000), a bag (any, 2000): weight and worth by
//     their rounds; a handful comes out; opened into the stock at a base or in cargo; in a pack in a fight their rounds
//     are the pack's (a shotgun's need Get shells);
//   - finds: some of a container's rounds boxed, the rest loose, the rounds kept; bulk containers more often for common
//     rounds and gun places, never launcher rounds;
//   - points and saves: a box priced by its retail size, a stack of boxes in the new-run picker; an old box item reads
//     as the boxes it fills.
// Usage: node tools/ammoformtest.js [-v]
import { createWorld, hub } from "../src/sim/world.js";
import { GEAR, SUPPLIES } from "../src/sim/data.js";
import { AMMO_GEAR, ROUND_SUPPLIES, CALIBERS, LOAD_CLASS } from "../src/sim/data-ammo.js";
import { RETAIL_BOX, retailBox, AMMO_STACK, BULK } from "../src/sim/data-stacks.js";
import { roundItem, roundItems, boxesIn, canStack, mergeInto, stackLabel, newBulk, fillBulk, bulkReason, bulkRounds, takeOut, isBulk } from "../src/sim/itemstack.js";
import { itemKg, itemAt, openAt, ensureInv, packOf } from "../src/sim/inventory.js";
import { itemValue } from "../src/sim/valuation.js";
import { unbox, boxesOf, sweepBoxes, takeBattleRounds, roundsOf, formFinds, bulkFind, commonness, totalRounds } from "../src/sim/ammo.js";
import { shellsAt } from "../src/sim/mags.js";
import { itemPoints } from "../src/sim/custompoints.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

let pass = 0, fail = 0;
const VERBOSE = process.argv.includes("-v");
const check = (ok, msg) => { if (ok) { pass++; if (VERBOSE) console.log(`  ok ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

section("Box sizes (typical US retail counts)");
{
  const want = { a_12ga_slug: 5, a_12ga_buck: 10, a_12ga_bird: 25, a_12ga_beanbag: 5, a_556_fmj: 20, a_308_fmj: 20, a_762x39_fmj: 20, a_22lr_fmj: 100, a_22lr_subsonic: 50,
    a_9mm_fmj: 50, a_9mm_hp: 20, a_45acp_fmj: 50, a_45acp_hp: 20, a_357_fmj: 50, a_50bmg_ball: 10, a_3030_sp: 20, a_9mm_fmj_hand: 50, a_12ga_slug_hand: 5, a_40mm_he: 6 };
  const bad = Object.entries(want).filter(([k, n]) => !GEAR[k] || GEAR[k].dur !== n).map(([k]) => `${k} ${GEAR[k] && GEAR[k].dur}`);
  check(!bad.length, `the table: ${Object.entries(want).map(([k, n]) => `${k.slice(2)} ${n}`).join(", ")}${bad.length ? ` (wrong: ${bad.join(", ")})` : ""}`);
  const all = Object.entries(AMMO_GEAR).filter(([, g]) => g.rounds);
  check(all.every(([, g]) => g.dur === retailBox(g.rounds.cal, g.rounds.type, CALIBERS[g.rounds.cal], LOAD_CLASS[g.rounds.cal] || "")), `every box of every calibre and load (${all.length}) has its retail size`);
  check(all.every(([k, g]) => near(g.weight, Math.round((CALIBERS[g.rounds.cal].kg * g.dur + 0.05) * 100) / 100) && Math.abs(g.value - Math.max(1, Math.round(ROUND_SUPPLIES[k].value * g.dur))) <= 1 || k.startsWith("a_40mm") || k.startsWith("a_rocket")), "a box weighs and is worth its rounds (and 50 g of box)");
  check(retailBox("20ga", "slug") === 5 && retailBox("20ga", "buck") === 10 && retailBox("410", "bird", {}, "shotgun") === 25, "a gauge the data adds later: buckshot 10, slugs 5, the rest 25");
  check(retailBox("17hmr", "fmj", { kg: 0.0026 }) === 100 && retailBox("338lm", "fmj", { kg: 0.07 }) === 10 && retailBox("10mm", "hp", { kg: 0.015 }, "pistol") === 20 && retailBox("10mm", "fmj", { kg: 0.015 }, "pistol") === 50 && retailBox("6.5mm", "fmj", { kg: 0.02 }, "rifle") === 20, "an unknown calibre by its class: rimfire 100, heavy 10, pistol 50 (defensive 20), rifle 20");
  check(itemPoints("a_12ga_slug") < itemPoints("a_12ga_bird") && itemPoints("a_9mm_fmj") > itemPoints("a_9mm_hp") * 0.5, `points by the box's rounds: 5 slugs ${itemPoints("a_12ga_slug")}, 25 birdshot ${itemPoints("a_12ga_bird")}, 50 9mm FMJ ${itemPoints("a_9mm_fmj")}, 20 9mm HP ${itemPoints("a_9mm_hp")}`);
}

section("A slot: loose up to 80, or up to five boxes");
{
  const box = GEAR.a_9mm_fmj.dur;
  const items = roundItems("a_9mm_fmj", 600, false);
  check(items.length === 3 && items[0].dur === 5 * box && items.every((it) => !it.loose), `600 rounds boxed: stacks of five boxes (${items.map((it) => it.dur).join(", ")})`);
  const loose = roundItems("a_9mm_fmj", 200, true);
  check(loose.length === 3 && loose[0].dur === AMMO_STACK.LOOSE && loose.every((it) => it.loose), `200 loose: handfuls of 80 (${loose.map((it) => it.dur).join(", ")})`);
  const s3 = roundItem("a_9mm_fmj", 130);
  check(boxesIn(s3) === 3 && stackLabel(s3) === "9mm FMJ · 3 boxes (130)", `boxes in a stack: "${stackLabel(s3)}"`);
  check(!canStack(roundItem("a_9mm_fmj", 50), roundItem("a_9mm_fmj", 30, true)) && !canStack(roundItem("a_9mm_fmj", 50), roundItem("a_9mm_hp", 20)), "loose and boxed never merge, nor two loads");
  const a = roundItem("a_9mm_fmj", 200), b = roundItem("a_9mm_fmj", 100);
  check(mergeInto(a, b) === 50 && a.dur === 250 && b.dur === 50, "boxes merge up to five boxes (250 rounds), the rest stays");
  const l1 = roundItem("a_12ga_buck", 60, true), l2 = roundItem("a_12ga_buck", 40, true);
  check(mergeInto(l1, l2) === 20 && l1.dur === 80 && l2.dur === 20, "loose merges up to 80");
  check(near(itemKg(roundItem("a_9mm_fmj", 80, true)), 80 * SUPPLIES.a_9mm_fmj.weight) && near(itemValue(roundItem("a_9mm_fmj", 150)), 3 * itemValue(roundItem("a_9mm_fmj", 50)), 1e-6), "loose weighs its rounds; three boxes are worth three");
  // Opening boxes.
  const st = createWorld({ seed: 5, factionCount: 3 });
  const s = st.survivors.find((x) => x.location && x.location.kind === "base");
  ensureInv(s);
  s.pockets = [roundItem("a_9mm_fmj", 150), null, null, null];
  const m = openAt(st, `s:${s.id}:pocket:0`);
  check(s.pockets[0].dur === 70 && !s.pockets[0].loose && s.pockets.some((x) => x && x.loose && x.dur === 80), `Open box: 80 loose beside the 70 still boxed ("${m}")`);
  s.pockets[0] = roundItem("a_9mm_fmj", 40);
  openAt(st, `s:${s.id}:pocket:0`);
  check(s.pockets[0].loose && s.pockets[0].dur === 40, "a box of 40: opened in place, loose");
}

section("Bulk containers");
{
  const can = newBulk("ammocan", { a_556_fmj: 420 });
  check(bulkRounds(can) === 420 && bulkReason(can, "a_556_ap") !== "" && bulkReason(can, "a_556_fmj", 80) === "", `an ammo can holds one kind ("${bulkReason(can, "a_556_ap")}")`);
  check(fillBulk(can, "a_556_fmj", 500) === 80 && bulkRounds(can) === BULK.ammocan.cap, "up to 500");
  check(near(itemKg(can), BULK.ammocan.empty + 500 * SUPPLIES.a_556_fmj.weight) && itemKg(can) > 6, `semi heavy: ${itemKg(can).toFixed(1)} kg (the can and its rounds)`);
  check(near(itemValue(can), GEAR.ammocan.value + 500 * SUPPLIES.a_556_fmj.value, 1e-6), "worth the can and its rounds");
  const carton = newBulk("ammocarton", { a_9mm_fmj: 600, a_9mm_hp: 300 });
  check(bulkRounds(carton) === 900 && bulkReason(carton, "a_556_fmj") !== "" && itemKg(carton) > 10, `a carton: one calibre, any load (${bulkRounds(carton)} 9mm, ${itemKg(carton).toFixed(1)} kg), no 5.56`);
  const bag = newBulk("ammobag", { a_9mm_fmj: 800, a_12ga_buck: 600, a_556_fmj: 600 });
  check(bulkRounds(bag) === 2000 && fillBulk(bag, "a_308_fmj", 10) === 0 && itemKg(bag) > 20, `a bag: any kinds, 2000 at most, very heavy (${itemKg(bag).toFixed(1)} kg)`);
  check(GEAR.ammocarton.bulky && GEAR.ammobag.bulky && !GEAR.ammocan.bulky, "the can goes in a pack; the carton and the bag are bulky");
  const h1 = takeOut(carton);
  check(h1 && h1.loose && h1.dur === 80 && bulkRounds(carton) === 820, "a handful out: 80 loose");
  const rec = {};
  const list = [newBulk("ammocan", { a_9mm_fmj: 300 }), roundItem("a_9mm_fmj", 50)];
  const moved = unbox(list, rec);
  check(moved === 350 && rec.a_9mm_fmj === 350 && !list.length, "in an armory or cargo: opened into the stock with the boxes");
  // In a fight: an ammo can in the pack is the pack's rounds.
  const st = createWorld({ seed: 5, factionCount: 3 });
  const s = st.survivors.find((x) => x.location && x.location.kind === "base");
  ensureInv(s);
  s.gear.backpack = s.gear.backpack || { key: "hikingpack", name: "Hiking pack", quality: 1 };
  const pk = packOf(s);
  pk.fill(null);
  s.pockets = [roundItem("a_12ga_buck", 6, true), null, null, null];
  pk[0] = newBulk("ammocan", { a_12ga_buck: 200 });
  const u = { side: "player", weapon: "shotgun", load: "buck", magMode: "internal", mag: 0, magMax: 6, boxes: boxesOf(s), handBoxes: 1, hand: {} };
  const b = { units: [u], pools: [{}] };
  const at = shellsAt(b, u, "buck");
  check(roundsOf(b, u) === 206 && at.box === 6 && at.pack === 200, `a shotgunner: 6 loose shells at hand, the can's 200 in the pack (Get shells) (${JSON.stringify(at)})`);
  const pu = { side: "player", weapon: "pistol", load: null, boxes: [], hand: {} };
  s.pockets = [null, null, null, null];
  pk[0] = newBulk("ammocan", { a_9mm_fmj: 30 });
  pu.boxes = boxesOf(s);
  const bb = { units: [pu], pools: [{}] };
  check(takeBattleRounds(bb, pu, 12) === 12 && bulkRounds(pk[0]) === 18, "a pistol draws on the can in the pack");
  takeBattleRounds(bb, pu, 18);
  sweepBoxes(s);
  check(isBulk(pk[0]) && bulkRounds(pk[0]) === 0 && !pk[0].loads.length, "spent: the empty can stays, its loads swept");
}

section("Finds: loose, boxed and bulk");
{
  const sup = { a_9mm_fmj: 160, a_12ga_buck: 23, food: 2 };
  const gear = [];
  let found = null;
  for (let i = 0; i < 40 && !found; i++) { const s2 = { ...sup }, g2 = []; formFinds(s2, g2, "police", "t", i); if (g2.some((it) => !isBulk(it))) found = { s2, g2 }; }
  check(!!found, "some finds come boxed");
  if (found) {
    const items = found.g2.filter((it) => !isBulk(it));
    check(items.every((it) => it.dur % GEAR[it.key].dur === 0 && it.dur <= 5 * GEAR[it.key].dur), `whole boxes, five a slot at most (${items.map((it) => stackLabel(it)).join(", ")})`);
    const total = (s3, g) => totalRounds(s3) + g.filter((it) => !isBulk(it)).reduce((a, it) => a + it.dur, 0);
    check(total(found.s2, found.g2) === 183 && found.s2.food === 2, "the rounds are all there (boxed + loose = the find)");
  }
  check(commonness("a_9mm_fmj") > commonness("a_9mm_hp") && commonness("a_9mm_hp") > commonness("a_556_ap") && commonness("a_40mm_he") === 0, `commonness from the finds' mix: 9mm FMJ ${commonness("a_9mm_fmj").toFixed(2)}, 9mm HP ${commonness("a_9mm_hp").toFixed(2)}, 5.56 AP ${commonness("a_556_ap").toFixed(2)}, 40 mm ${commonness("a_40mm_he")}`);
  const rate = (theme) => { let n = 0, rounds = 0; const keys = {}; for (let i = 0; i < 40000; i++) { const it = bulkFind(theme, "rate", i); if (it) { n++; rounds += bulkRounds(it); for (const l of it.loads) keys[l.key] = (keys[l.key] || 0) + 1; } } return { per: n / 40, rounds: n ? rounds / n : 0, keys }; };
  const mil = rate("military"), home = rate("home");
  console.log(`  bulk containers per 1000 containers searched: military ${mil.per.toFixed(1)} (${mil.rounds.toFixed(0)} rounds each), home ${home.per.toFixed(2)}`);
  check(mil.per > home.per * 5 && mil.per < 15, "far more in military places than in homes, and rare even there");
  const special = Object.keys(mil.keys).filter((k) => /_(ap|match|tracer|api)$/.test(k)).reduce((a, k) => a + mil.keys[k], 0), common = Object.keys(mil.keys).filter((k) => /_fmj$/.test(k)).reduce((a, k) => a + mil.keys[k], 0);
  check(common > special * 8, `common rounds in bulk far more often than special ones (FMJ ${common}, AP / match / tracer ${special})`);
  check(!Object.keys(mil.keys).some((k) => k.startsWith("a_40mm") || k.startsWith("a_rocket")), "never launcher rounds");
}

section("Saves");
{
  const w = createWorld({ seed: 7, factionCount: 3 });
  const h = hub(w);
  h.armory.push(newBulk("ammocan", { a_9mm_fmj: 100 }));
  const s = w.survivors.find((x) => x.location && x.location.kind === "base");
  ensureInv(s);
  s.pockets[0] = roundItem("a_556_fmj", 30); // an old 30-round box: two of the 20-round boxes now
  s.pockets[1] = roundItem("a_12ga_buck", 40, true);
  const text = saveToString(w);
  const ld = loadFromString(text);
  const p = ld.survivors.find((x) => x.id === s.id).pockets;
  check(p[0].dur === 30 && boxesIn(p[0]) === 2 && p[1].loose && p[1].dur === 40 && saveToString(ld) === text, "a box stack, loose rounds and a can survive a save (an old 30-round box reads as two boxes)");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
