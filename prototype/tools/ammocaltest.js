// All ammo by calibre (2026-10-09, user requests: "The ammo shown at the top should be a combined number of ammo and
// when hovering shows the breakdown of how much per caliber including arrows"; "All ammo should be based on caliber"):
//   - the top bar's Ammo figure is every round (every calibre and type, launcher rounds too) and every arrow at the hub,
//     its people's boxes included, and equals the sum of its tooltip's rows; the tooltip names calibres and arrows,
//     most first; a hardcore team on the road shows the same for the team;
//   - a 60-day autopilot run leaves no generic ammo in a holder of yours at the end of any hour (bases, your teams'
//     supplies and cargo, the staging camp), and the cards and log lines never say "N ammo" or show a raw round key;
//   - custom backgrounds carry rounds by calibre and type (on them and in the car's back), clamped to their caps; an
//     old background's generic ammo becomes the common rounds of its guns (9mm and 12 gauge with none); the editor has
//     the rows and the add pick, which adds a box;
//   - a hardcore start's rounds are for the guns the team actually got (on them, in the back, in the boxes);
//   - deals with groups name calibres: the peddler, a radio offer, a council request.
// Usage: node tools/ammocaltest.js [days=60] [seed=11]
import { createWorld, tickHour, day, hub } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { ROUND_SUPPLIES, CALIBERS } from "../src/sim/data-ammo.js";
import { SUPPLIES } from "../src/sim/data.js";
import { ammoBreakdown, baseAmmoBreakdown, teamAmmoBreakdown, breakdownText, calibrate, calibrateDeal, roundsText, gunCals, calOf, boxesOf } from "../src/sim/ammo.js";
import { totalRounds } from "../src/sim/rounds.js";
import { topbarParts } from "../src/ui/ui.js";
import { CUSTOM_BG, sanitizeBackground, sanitizeLibrary } from "../src/sim/custombg.js";
import { backgroundEditor, setCustomLibrary, customLibrary, BG_CHANGE, BG_ACTIONS } from "../src/ui/backgrounds.js";
import { dealRoundKey } from "../src/sim/trade.js";
import { offerCard } from "../src/sim/radio.js";
import { sanitizeStartVehicle, START_TRUNK } from "../src/sim/startgear.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const DAYS = Number(process.argv[2]) || 60;
const SEED = Number(process.argv[3]) || 11;
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const roundsOnly = (rec) => Object.entries(rec || {}).filter(([k, q]) => ROUND_SUPPLIES[k] && q > 0);

section("The top bar: one Ammo figure, by calibre and arrows on hover");
{
  const st = createWorld({ seed: SEED, factionCount: 5 });
  const h = hub(st);
  h.stock.arrows = 37;
  h.stock.a_9mm_hp = (h.stock.a_9mm_hp || 0) + 12;
  h.stock.a_40mm_he = 3; // launcher rounds count too
  const bd = baseAmmoBreakdown(st, h);
  const boxes = st.survivors.filter((s) => s.location.kind === "base" && s.location.baseId === h.id).flatMap(boxesOf).reduce((a, it) => a + Math.floor(it.dur || 0), 0);
  const want = roundsOnly(h.stock).reduce((a, [, q]) => a + Math.floor(q), 0) + 37 + boxes;
  check(bd.total === want, `the total is every round, arrow and box at the hub (${bd.total} vs ${want})`);
  check(bd.total === bd.rows.reduce((a, r) => a + r.n, 0), "the total is the sum of the rows");
  check(bd.rows.every((r, i) => i === 0 || bd.rows[i - 1].n >= r.n), "rows most first");
  check(bd.rows.some((r) => r.key === "arrows" && r.n === 37) && bd.rows.some((r) => r.key === "9mm" && r.types.some((t) => t.type === "hp" && t.n >= 12)) && bd.rows.some((r) => r.key === "40mm"), `rows: arrows, 9mm with its hollow points, 40 mm (${breakdownText(bd)})`);
  const tb = topbarParts(st, { speed: 1 });
  const chip = tb.stock.match(/<span data-tip="([^"]*)"[^>]*><b>Ammo<\/b>(\d+)/);
  check(!!chip && Number(chip[2]) === bd.total, `the bar shows the total (${chip ? chip[2] : "no Ammo chip"})`);
  check(!!chip && /9mm/.test(unesc(chip[1])) && /Arrows and bolts 37/.test(unesc(chip[1])), "the tooltip names the calibres and the arrows");
  check(!/<b>Arrows<\/b>/.test(tb.stock), "no separate Arrows chip");
  const again = baseAmmoBreakdown(st, h);
  check(again === bd, "cached while nothing changed");
  h.stock.a_9mm_fmj = (h.stock.a_9mm_fmj || 0) + 5;
  check(baseAmmoBreakdown(st, h).total === bd.total + 5, "and fresh when the stock changes");
  // A hardcore team on the road.
  const hc = createWorld({ seed: SEED, factionCount: 5, mode: "hardcore" });
  const p = hc.parties.find((x) => x.owner === "player");
  const tbd = teamAmmoBreakdown(hc, p);
  const roadBar = topbarParts(hc, { speed: 1 }).stock;
  const rm = roadBar.match(/<b>Ammo<\/b>(\d+)/);
  check(!!rm && Number(rm[1]) === tbd.total, `the road bar shows the team's total (${rm ? rm[1] : "none"} vs ${tbd.total})`);
}

section("Custom backgrounds: rounds by calibre, old generic ammo migrated");
{
  const d = sanitizeBackground({ id: "c_1", gear: { weapon: "huntrifle" }, supplies: { food: 3, ammo: 40, a_9mm_hp: 500 }, car: { items: ["shotgun"], trunk: { ammo: 50, a_556_fmj: 999 } } });
  const sup = roundsOnly(d.supplies), trunk = roundsOnly(d.car.trunk);
  check(!("ammo" in d.supplies) && !("ammo" in d.car.trunk), "no generic ammo kept");
  check(sup.reduce((a, [, q]) => a + q, 0) <= CUSTOM_BG.ROUNDS && trunk.reduce((a, [, q]) => a + q, 0) <= CUSTOM_BG.TRUNK_ROUNDS, "clamped to the caps");
  const rifleCal = calOf("huntrifle");
  check(sup.some(([k]) => ROUND_SUPPLIES[k].round.cal === rifleCal), `the old 40 became the rifle's rounds (${JSON.stringify(d.supplies)})`);
  const none = sanitizeBackground({ id: "c_2", supplies: { ammo: 20 } });
  check(roundsOnly(none.supplies).map(([k]) => k).sort().join() === "a_12ga_buck,a_9mm_fmj" && totalRounds(none.supplies) === 20, `no guns: 9mm and 12 gauge (${JSON.stringify(none.supplies)})`);
  const lib = sanitizeLibrary([{ id: "c_3", name: "Old", supplies: { ammo: 30 }, gear: { weapon: "pistol" } }]);
  check(totalRounds(lib.c_3.supplies) === 30 && !("ammo" in lib.c_3.supplies), "a saved list migrates");
  setCustomLibrary([{ id: "c_4", name: "Gunner", gear: { weapon: "pistol" } }]);
  const ui = { bgEditor: { sel: "c_4", changed: [], confirmDel: false } };
  const html = backgroundEditor({}, ui);
  check(/data-action="bg-round-add" data-w="sup"/.test(html) && /data-action="bg-round-add" data-w="trunk"/.test(html) && /Add rounds…/.test(html), "the editor has the add picks");
  check(!/>Ammo<input/.test(html), "no generic Ammo box");
  BG_CHANGE["bg-round-add"]({}, ui, { value: "a_9mm_fmj", dataset: { w: "sup" } });
  check(customLibrary().c_4.supplies.a_9mm_fmj === CALIBERS["9mm"].box, "adding a calibre adds a box of it");
  const html2 = backgroundEditor({}, ui);
  check(/data-action="bg-sup"[^>]*data-k="a_9mm_fmj"/.test(html2) && /data-action="bg-round-del"/.test(html2), "and it has a row with ×");
  BG_ACTIONS["bg-round-del"]({}, ui, { w: "sup", k: "a_9mm_fmj" });
  check(!customLibrary().c_4.supplies.a_9mm_fmj, "× takes it out");
  const v = sanitizeStartVehicle({ items: ["shotgun"], supplies: { food: 5, ammo: 400, a_308_fmj: 10 } });
  check(!("ammo" in v.supplies) && totalRounds(v.supplies) <= START_TRUNK.ROUNDS && v.supplies.a_12ga_buck > 0, `the new-run vehicle back: rounds by calibre too (${JSON.stringify(v.supplies)})`);
}

section("A hardcore start's rounds are for the guns they got");
{
  let starts = 0, bad = [];
  for (let seed = 1; seed <= 12; seed++) {
    const st = createWorld({ seed, factionCount: 5, mode: "hardcore", crewRoll: seed * 13 });
    const p = st.parties.find((x) => x.owner === "player");
    const people = p.members.map((id) => st.survivors.find((s) => s.id === id));
    const cals = gunCals(people, p.cargo.gear);
    const has = Object.keys(cals).length;
    for (const rec of [p.supplies, p.cargo.supplies]) for (const [k] of roundsOnly(rec)) {
      const c = ROUND_SUPPLIES[k].round.cal;
      if (has ? !cals[c] : !["9mm", "12ga"].includes(c)) bad.push(`seed ${seed}: ${k} (guns: ${Object.keys(cals).join(",") || "none"})`);
    }
    check(!("ammo" in p.supplies && p.supplies.ammo >= 1) && !(p.cargo.supplies.ammo >= 1), `seed ${seed}: no generic ammo`);
    starts++;
  }
  check(!bad.length, `every round fits a gun they have (${starts} starts) ${bad.slice(0, 4).join("; ")}`);
}

section("Deals name calibres");
{
  const st = createWorld({ seed: SEED, factionCount: 5 });
  const h = hub(st);
  const deal = calibrateDeal(st, h, { give: { ammo: 20 }, get: { ammo: 15, meds: 2 } });
  check(!deal.give.ammo && !deal.get.ammo && totalRounds(deal.give) === 20 && totalRounds(deal.get) === 15, `a deal's ammo as rounds (${roundsText(deal.give)} for ${roundsText(deal.get)})`);
  const f = st.factions.find((x) => x.alive);
  const k1 = dealRoundKey(st, f, h, 30, true), k2 = dealRoundKey(st, f, h, 30, false);
  check(!!ROUND_SUPPLIES[k1] && !!ROUND_SUPPLIES[k2], `a radio deal's round keys (${k1}, ${k2})`);
  const rec = { food: 1, ammo: 9 };
  calibrate(rec, { "556": 1 });
  check(rec.a_556_fmj === 9 && !("ammo" in rec), "calibrate: generic into the common rounds of the guns");
  let cards = 0, generic = 0;
  for (const g of st.factions) { if (!g.alive) continue; g.known = true; const c = offerCard(st, g); if (!c) continue; cards++; if (/\b\d+ ammo\b/.test(`${c.text} ${c.choices.map((x) => x.label).join(" ")}`)) generic++; }
  check(generic === 0, `radio offers name calibres (${cards} cards, ${generic} with "N ammo")`);
}

section(`A ${DAYS}-day autopilot run: no generic ammo left in your holders`);
{
  const st = createWorld({ seed: SEED, factionCount: 7 });
  st.started = true;
  setAutopilot(st, true, "balanced");
  const holders = () => [
    ...st.bases.map((b) => [`base ${b.name}`, b.stock]),
    ...st.parties.filter((p) => p.owner === "player" || p.owner == null).flatMap((p) => [[`team ${p.id}`, p.supplies], [`team ${p.id} cargo`, p.cargo && p.kind !== "convoy" && p.kind !== "caravan" ? p.cargo.supplies : null]]),
    ["staging", st.staging && st.staging.stores],
  ];
  let hours = 0, worst = null;
  const seenLog = new WeakSet(); // the log keeps its newest 200 lines, newest first
  const genericText = [], rawKey = [];
  const seenCards = new Set();
  const scan = (t, where) => {
    if (!t) return;
    if (/\b\d+ ammo\b/i.test(t) && genericText.length < 6) genericText.push(`${where}: ${t.slice(0, 160)}`);
    if (/\ba_[0-9a-z]+_[a-z]+\b/.test(t) && rawKey.length < 6) rawKey.push(`${where}: ${t.slice(0, 160)}`);
  };
  try {
    while (day(st) <= DAYS && !st.gameOver) {
      tickHour(st);
      hours++;
      for (const [name, rec] of holders()) if (rec && Math.abs(rec.ammo || 0) >= 1 && !worst) worst = `day ${day(st)} ${name}: ${rec.ammo} generic`;
      for (const c of st.cards) { if (seenCards.has(c)) continue; seenCards.add(c); scan(`${c.title || ""} ${c.text || ""} ${(c.choices || []).map((x) => `${x.label || ""} ${typeof x.hint === "string" ? x.hint : ""}`).join(" ")}`, "card"); }
      for (const l of st.log || []) { if (!l || typeof l !== "object" || seenLog.has(l)) continue; seenLog.add(l); scan(l.text, "log"); }
    }
  } catch (e) {
    check(false, `the run crashed on day ${day(st)}: ${e.stack.split("\n").slice(0, 4).join(" | ")}`);
  }
  check(!worst, `no generic ammo at any hour's end (${hours} hours) ${worst || ""}`);
  check(!genericText.length, `no "N ammo" in cards or the log ${genericText.join(" || ")}`);
  check(!rawKey.length, `no raw round keys in cards or the log ${rawKey.join(" || ")}`);
  const h = hub(st);
  if (h) check(baseAmmoBreakdown(st, h).total >= totalRounds(h.stock), "the hub's figure covers its rounds");
  // A save from before: generic ammo in a holder, a background with generic ammo, a job reward in ammo.
  const old = JSON.parse(saveToString(st));
  const raw = JSON.stringify(old);
  check(raw.length > 0, "saved");
  const ld = loadFromString(saveToString(st));
  if (ld && hub(ld)) {
    hub(ld).stock.ammo = 33;
    ld.ammoCal = 1;
    ld.customBackgrounds = { c_1: { id: "c_1", name: "Old", supplies: { ammo: 25 }, car: { trunk: { ammo: 10 } } } };
    const re = loadFromString(saveToString(ld));
    check(re.ammoCal === 2 && !(hub(re).stock.ammo >= 1), "an older save's generic ammo settles on load");
    check(!("ammo" in re.customBackgrounds.c_1.supplies) && totalRounds(re.customBackgrounds.c_1.supplies) === 25, "and its custom backgrounds' ammo becomes rounds");
  }
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
