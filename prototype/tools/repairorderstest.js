// Repair orders (the user's request 2026-10-19, docs/base-building/plan.md Part E; sim/breakdowns.js, ui/explore.js
// repairsTab): every placed thing has a FIXTURES entry (the new ones raid-only, the outer defences outer); repairList
// sorts most damaged first (broken, then by wear); a repair order on a worn fixture is a partial job (hours and scrap
// by its share, never under 1 hour and 1 scrap, below the full job's); builders are picked before a better mechanic;
// orderRepair starts the job and the hourly work finishes it with the wear back at repairWear; a job on a worn fixture
// is not dropped by the hourly work; raidDamage hits the new defences as the outer line; the Repairs tab renders the
// list in order with a handler for every data-action it emits; the autopilot orders a repair on a 55-wear fixture
// when the scrap allows and not when it does not.
// Usage: node tools/repairorderstest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { addBuilding, BUILDINGS } from "../src/sim/buildings.js";
import { FOOT } from "../src/sim/basemap.js";
import {
  FIXTURES, WEAR, RAID_DAMAGE, ORDERS, fixtures, fxDef, repairList, repairPlan, repairHands, repairShare, orderRepair, startRepair, cancelRepair,
  startAllRepairs, repairAllBill, breakFixture, breakdownsHour, raidDamage, jobFor, fixtureName,
} from "../src/sim/breakdowns.js";
import { repairsTab, EXPLORE_ACTIONS, EXPLORE_CHANGE } from "../src/ui/explore.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const t0 = Date.now();
const byType = (base, type) => base.buildings.find((b) => b.type === type);
// A hub with only these buildings, everyone at rest with no skills, the stock set; 09:00 on a quiet day.
function setup(types = ["walls", "barricades", "bunkhouse", "spike_pits"], stock = { scrap: 100, parts: 5 }) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  st.noWanderers = true;
  const h = hub(st);
  h.buildings = [];
  for (const t of types) addBuilding(h, t);
  for (const b of h.buildings) b.built = 1;
  h.repairs = [];
  const people = atBase(st, h.id);
  for (const s of people) { s.role = "rest"; for (const k of Object.keys(s.skills)) s.skills[k] = 0; s.inBed = false; }
  Object.assign(h.stock, stock);
  st.hour = Math.floor(st.hour / 24) * 24 + 9;
  return { st, h, people };
}
// The hourly work from this hour on, n hours (the base's jobs are worked 08:00–20:00).
const workHours = (st, n) => { for (let i = 0; i < n; i++) { breakdownsHour(st); st.hour++; } };

// 1. FIXTURES covers every placed thing; the outer defences are outer.
{
  console.log("FIXTURES coverage");
  const skip = new Set(["car", "vehicle", "plot", "crop", "field"]);
  const placed = Object.keys(FOOT).filter((k) => !skip.has(FOOT[k].kind) && BUILDINGS[k]);
  const missing = placed.filter((k) => !FIXTURES[k]);
  check(!missing.length, `every FOOT type has a FIXTURES entry (${placed.length}; missing: ${missing.join(", ") || "none"})`);
  const extra = ["barbed_wire", "razor_wire", "guard_towers", "minefield"].filter((k) => !FIXTURES[k]);
  check(!extra.length, "the wire rings, the guard towers and the minefield (laid by the map itself) have entries too");
  const outer = ["spike_pits", "trench", "sandbag_wall", "barbed_wire", "razor_wire", "guard_towers", "minefield", "walls", "gate", "barricades", "watchtower", "floodlights"];
  check(outer.every((k) => FIXTURES[k] && FIXTURES[k].outer), "the outer line: spike pits, trench, sandbag positions, the wires, guard towers and minefield, with the walls, gate, barricades, tower and lights");
  const inner = ["gen_hut", "gen_barn", "bunks", "shelves", "lockers", "stove", "infirmary", "hospital", "greenhouse", "jailhouse", "lockup", "crates", "cookhouse", "boiler", "water_barrel", "craftbench", "toolbench"];
  check(inner.every((k) => FIXTURES[k] && FIXTURES[k].raidOnly && !FIXTURES[k].outer), "the buildings inside are raid-only and not outer");
  const sane = Object.entries(FIXTURES).every(([, d]) => d.repair && d.repair.hours >= 1 && (d.repair.cost.scrap || 0) >= 1 && d.rig && d.rig.hours >= 1 && typeof d.what === "string" && d.what.length);
  check(sane, "every entry: repair hours and scrap at least 1, a rig, a what");
  const NEW = ["infirmary", "field_hosp", "clinic", "hospital", "greenhouse", "jailhouse", "lockup", "gen_hut", "gen_cabin", "gen_lodge", "gen_hall", "gen_barn", "bunks", "shelves", "lockers", "stove", "crates", "cookhouse", "boiler", "water_barrel", "craftbench", "workbench", "toolbench", "spike_pits", "trench", "sandbag_wall", "barbed_wire", "razor_wire", "guard_towers", "minefield"];
  const off = NEW.filter((k) => { const d = FIXTURES[k].repair, b = BUILDINGS[k]; return !(d.cost.scrap <= Math.max(1, Math.ceil(b.cost.scrap / 2)) && d.cost.scrap >= Math.max(1, Math.floor(b.cost.scrap / 4)) && d.hours <= Math.max(1, Math.ceil(b.hours / 3)) && d.hours >= Math.max(1, Math.floor(b.hours / 6)) && (!b.cost.parts || d.cost.parts) && (d.cost.parts ? d.min >= 1 : d.min === 0)); });
  check(!off.length, `the new entries' costs in proportion: a quarter to a half of the building's scrap, a sixth to a third of its hours, a part (and Mechanics 1) where it took parts, Mechanics 0 for plain structures (off: ${off.join(", ") || "none"})`);
}

// 2. The list, most damaged first; the partial plan.
{
  console.log("repairList and the partial plan");
  const { st, h, people } = setup();
  const walls = byType(h, "walls"), bar = byType(h, "barricades"), bunk = byType(h, "bunkhouse"), pits = byType(h, "spike_pits");
  bunk.wear = 30; bar.wear = 75; pits.wear = 0;
  breakFixture(st, h, walls, "test", { card: false, quiet: true });
  check(walls.broken && walls.wear === WEAR.breakAt, "the wall is broken at 100");
  const list = repairList(st, h).filter((r) => r.fx.type !== "pump"); // the hub's own well pump is a fixture too (unworn here)
  check(list.map((r) => r.fx.type).join(",") === "walls,barricades,bunkhouse,spike_pits", `most damaged first: ${list.map((r) => `${r.name} ${r.wear}${r.fx.broken ? " broken" : ""}`).join(" > ")}`);
  check(list[0].state === "Broken" && list[1].state === "Damaged" && list[2].state === "Worn" && list[3].state === "OK", `states: ${list.map((r) => r.state).join(", ")}`);
  check(list[0].rig && !list[1].rig && list.every((r) => r.plan && r.def && r.name), "a rig plan on the broken only; a plan, a def and a name on every row");
  // Nobody has a skill yet: the plans still price the job.
  const mechanic = people[0];
  mechanic.skills.mechanics = 3;
  const full = fxDef(bar).repair;
  const p75 = repairPlan(st, h, bar, "repair");
  const share = repairShare(bar);
  check(Math.abs(share - (75 - WEAR.repairWear) / (WEAR.breakAt - WEAR.repairWear)) < 1e-9, `the share at 75 wear is (75 − ${WEAR.repairWear}) / (${WEAR.breakAt} − ${WEAR.repairWear}) = ${share.toFixed(3)}`);
  const fullPlan = repairPlan(st, h, { ...bar, broken: { day: 1, cause: "test" } }, "repair");
  check(p75.ok && p75.hours < fullPlan.hours && p75.cost.scrap < full.cost.scrap && p75.cost.scrap === Math.ceil(full.cost.scrap * share), `a partial repair at 75: ${p75.hours}h, ${p75.cost.scrap} scrap, under the full job's ${fullPlan.hours}h, ${full.cost.scrap} scrap`);
  bunk.wear = 9;
  const p9 = repairPlan(st, h, bunk, "repair");
  check(p9.ok && p9.hours === 1 && p9.cost.scrap === 1, `the lightest job is still 1 hour and 1 scrap (${p9.hours}h, ${p9.cost.scrap} scrap at 9 wear)`);
  bunk.wear = WEAR.repairWear;
  check(repairPlan(st, h, bunk, "repair").why === "Nothing to repair.", "at repairWear: Nothing to repair.");
  bunk.wear = 30;
  check(repairPlan(st, h, bunk, "rig").why === "Not broken.", "a jury-rig is for a broken one only");
  check(repairPlan(st, h, walls, "repair").share === 1 && repairPlan(st, h, walls, "rig").ok, "a broken wall costs the full job; its jury-rig is on");
  // A part comes in only when the share rounds to one.
  const gen = addBuilding(h, "generator"); gen.built = 1; gen.wear = 30;
  mechanic.skills.mechanics = 5;
  const pg = repairPlan(st, h, gen, "repair");
  check(pg.ok && !pg.cost.parts && pg.cost.scrap >= 1, `a light repair of a machine takes no part (${JSON.stringify(pg.cost)} at 30 wear)`);
  gen.wear = 90;
  check(repairPlan(st, h, gen, "repair").cost.parts === FIXTURES.generator.repair.cost.parts, "a heavy one takes its parts");
  h.buildings.splice(h.buildings.indexOf(gen), 1);
}

// 3. Who: builders first, then the best mechanic; the player's pick wins.
{
  console.log("Who does it");
  const { st, h, people } = setup();
  const bar = byType(h, "barricades"); bar.wear = 75;
  const [builder, mech, other] = people;
  builder.role = "build"; builder.skills.mechanics = 2;
  mech.role = "rest"; mech.skills.mechanics = 6;
  other.skills.mechanics = 4;
  const hands = repairHands(st, h, bar, "repair");
  check(hands[0] === builder && hands[1] === mech && hands[2] === other, `the builder first, then by Mechanics: ${hands.slice(0, 3).map((s) => `${s.name.split(" ")[0]} (${s.role}, ${s.skills.mechanics})`).join(", ")}`);
  check(repairPlan(st, h, bar, "repair").who === builder, "the plan picks the builder");
  check(repairPlan(st, h, bar, "repair", mech.id).who === mech, "the player's pick wins");
  builder.inBed = true;
  check(repairPlan(st, h, bar, "repair").who === mech, "a builder in bed is passed over for the best mechanic");
  builder.inBed = false;
  // A minimum: the plain barricade needs none; a machine's job needs the skill.
  const gen = addBuilding(h, "generator"); gen.built = 1; gen.wear = 70;
  check(!repairHands(st, h, gen, "repair").includes(builder) && repairHands(st, h, gen, "repair")[0] === mech, "a generator's repair (Mechanics 3) skips the builder for the mechanic");
  const bad = repairPlan(st, h, gen, "repair", builder.id);
  check(!bad.ok && /cannot do it/.test(bad.why), `picking someone short of the skill says so ("${bad.why}")`);
  // Busy on another job: not offered again.
  startRepair(st, h, bar, "repair");
  check(!repairHands(st, h, gen, "repair").includes(builder) && jobFor(h, bar).who === builder.id, "the builder on the barricades is busy");
}

// 4. The order runs: started, worked by the hour, finished at repairWear; not dropped while worn; dropped when mended.
{
  console.log("An order worked to the end");
  const { st, h, people } = setup();
  const bunk = byType(h, "bunkhouse"); bunk.wear = 30;
  const bar = byType(h, "barricades"); bar.wear = 75;
  const builder = people[0]; builder.role = "build"; builder.skills.mechanics = 2;
  const scrap0 = h.stock.scrap;
  const plan = repairPlan(st, h, bunk, "repair");
  const msg = orderRepair(st, h, bunk.id);
  const job = jobFor(h, bunk);
  check(job && job.who === builder.id && job.method === "repair" && /starts repairing the bunkhouse/.test(msg), `orderRepair starts the job by the builder ("${msg}")`);
  check(h.stock.scrap === scrap0 - plan.cost.scrap && job.hours === plan.hours, `paid ${plan.cost.scrap} scrap for ${plan.hours} work-hours`);
  check(/Already being worked on/.test(orderRepair(st, h, bunk.id)), "ordered twice: Already being worked on.");
  breakdownsHour(st); // 09:00: the job is worked, not dropped (the old rule dropped anything under 60)
  check(jobFor(h, bunk) === job && job.done > 0, `the hourly work keeps the order on a 30-wear bunkhouse and works it (${job.done.toFixed(2)} of ${job.hours}h)`);
  st.hour++;
  workHours(st, 10);
  check(!jobFor(h, bunk) && !bunk.broken && bunk.wear === WEAR.repairWear, `finished within the day: wear back to ${WEAR.repairWear} (${bunk.wear})`);
  // A job whose fixture upkeep mended first is dropped and paid back.
  orderRepair(st, h, bar.id);
  const s1 = h.stock.scrap, paid = jobFor(h, bar).paid.scrap;
  bar.wear = WEAR.repairWear;
  breakdownsHour(st);
  check(!jobFor(h, bar) && h.stock.scrap === s1 + paid, "a job on a fixture already at repairWear is dropped, the scrap back");
  bar.wear = 75;
  orderRepair(st, h, bar.id);
  bar.wear = 40; // upkeep took some off: the order stands
  breakdownsHour(st);
  check(!!jobFor(h, bar), "an order stands while its fixture is still worn (40)");
  check(/cancelled/.test(cancelRepair(st, h, bar.id)) && !jobFor(h, bar), "and can be cancelled");
  // Repair all: the broken and the damaged (60+), not the worn.
  const walls = byType(h, "walls");
  breakFixture(st, h, walls, "test", { card: false, quiet: true });
  bunk.wear = 30; bar.wear = 75;
  people[1].skills.mechanics = 3;
  const bill = repairAllBill(st, h);
  check(bill.list.length === 2 && bill.list.map((r) => r.fx.type).join() === "walls,barricades" && bill.cost.scrap > 0 && bill.hours > 0, `Repair all's bill counts the broken wall and the 75-wear barricades (${bill.cost.scrap} scrap, ${bill.hours}h), not the 30-wear bunkhouse`);
  const all = startAllRepairs(st, h);
  check(jobFor(h, walls) && jobFor(h, bar) && !jobFor(h, bunk), `Repair all starts both ("${all.slice(0, 90)}…")`);
}

// 5. Raid damage hits the new defences as the outer line.
{
  console.log("Raid damage on the new defences");
  const { st, h } = setup(["spike_pits", "trench", "sandbag_wall", "barbed_wire", "razor_wire", "guard_towers", "minefield", "bunkhouse", "crates", "gen_hut", "bunks", "water_barrel"]);
  check(fixtures(h).filter((f) => f.type !== "pump").length === h.buildings.length, "every one of them is a fixture");
  // Six raids driven off (85% of the hits on the outer line, the dice by the hour): the defences take most of it.
  let rep = null, outerWear = 0, innerWear = 0;
  for (let i = 0; i < 6; i++) {
    const before = new Map(h.buildings.map((b) => [b, b.wear || 0]));
    rep = raidDamage(st, h, { strength: 80, hours: 8, outcome: "held", by: "Test raiders" });
    for (const b of h.buildings) { const d = (b.wear || 0) - before.get(b); if (fxDef(b).outer) outerWear += d; else innerWear += d; }
    for (const b of h.buildings) { b.wear = 0; b.broken = null; } // fresh for the next
    if (h.pump) { h.pump.wear = 0; h.pump.broken = null; }
    st.hour++;
  }
  const outerHit = h.buildings.filter((b) => fxDef(b).outer);
  check(rep.budget === 240 && outerWear > 0, `driven off: the defences took hits (${outerWear} wear on ${outerHit.map((b) => fixtureName(b).toLowerCase()).join(", ")})`);
  check(outerWear > 1.5 * innerWear, `the outer line took well over half the hits (${outerWear} wear vs ${innerWear} inside)`);
  check(typeof rep.text === "string" && rep.text.length && h.lastRaid === rep, `the report reads (${rep.text})`);
  // Wear and tear: nothing of it wears from use, age or weather.
  check(h.buildings.every((b) => fxDef(b).raidOnly && !fxDef(b).use && !fxDef(b).age), "none of them wears but by raids");
}

// 6. The Repairs tab: the list in order, every data-action handled.
{
  console.log("The Repairs tab");
  const { st, h, people } = setup();
  const walls = byType(h, "walls"), bar = byType(h, "barricades"), bunk = byType(h, "bunkhouse");
  bunk.wear = 30; bar.wear = 75;
  breakFixture(st, h, walls, "test", { card: false, quiet: true });
  const builder = people[0]; builder.role = "build"; builder.skills.mechanics = 2;
  people[1].skills.mechanics = 5;
  const html = repairsTab(st, h);
  const at = (t) => html.indexOf(`<b>${fixtureName({ type: t })}</b>`);
  check(at("walls") >= 0 && at("walls") < at("barricades") && at("barricades") < at("bunkhouse") && at("bunkhouse") < at("spike_pits"), "the rows run wall, barricades, bunkhouse, spike pits");
  const first = builder.name.split(" ")[0];
  const plan = repairPlan(st, h, bar, "repair");
  check(html.includes(`>Repair: ${first}, ${plan.hours}h, ${plan.cost.scrap} scrap</button>`), `the barricades' button reads "Repair: ${first}, ${plan.hours}h, ${plan.cost.scrap} scrap"`);
  check((html.match(/data-m="rig"/g) || []).length === 1 && new RegExp(`data-fx="${walls.id}" data-m="rig"`).test(html), "Jury-rig on the broken wall only");
  check(new RegExp(`<select data-action="rp-order" data-base="${h.id}" data-fx="${bar.id}"`).test(html) && html.includes(", builder)"), "a who-picker on an order (rp-order), builders marked");
  check(!/data-action="rp-start"[^>]*data-fx="[^"]*"[^>]*data-m="repair"[^>]*disabled/.test(html.split(`<b>${fixtureName({ type: "spike_pits" })}</b>`)[0]) && html.includes("<td><span class=\"muted\">—</span></td>"), "the unworn spike pits offer nothing");
  check(/data-action="rp-all"/.test(html) && html.includes(">Broken<") && html.includes(">Damaged<") && html.includes(">Worn<") && html.includes(">OK<"), "Repair all and the four states");
  check(html.includes("Last raid") === false && html.includes("Parked vehicles") && html.includes("Wear a day"), "the vehicles card and the wear note stay (no raid yet)");
  // Every data-action has a handler (buttons in EXPLORE_ACTIONS or main.js's own; selects in EXPLORE_CHANGE).
  const main = ["repairv"]; // main.js's vehicle repair
  const missing = [];
  for (const m of html.matchAll(/<(\w+)[^>]*?data-action="([^"]+)"/g)) { const isSel = m[1] === "select"; if (!(isSel ? EXPLORE_CHANGE[m[2]] : EXPLORE_ACTIONS[m[2]] || main.includes(m[2]))) missing.push(m[2]); }
  check(!missing.length, `every data-action has a handler (missing: ${missing.join(", ") || "none"})`);
  check(!/undefined|NaN|null/.test(html.replace(/<[^>]*>/g, " ")), "no undefined, NaN or null in the text");
  // The handlers: rp-order starts the job by the person picked, rp-who changes who, rp-cancel stops it.
  const ui = {};
  EXPLORE_CHANGE["rp-order"](st, ui, { dataset: { base: String(h.id), fx: String(bar.id) }, value: String(people[1].id) });
  check(jobFor(h, bar) && jobFor(h, bar).who === people[1].id && /starts repairing/.test(ui.baseMsg), `rp-order starts the job with the pick ("${ui.baseMsg}")`);
  const html2 = repairsTab(st, h);
  check(new RegExp(`<select data-action="rp-who" data-base="${h.id}" data-fx="${bar.id}"`).test(html2) && new RegExp(`data-action="rp-cancel" data-base="${h.id}" data-fx="${bar.id}"`).test(html2) && html2.includes(">Being repaired<"), "a running job: rp-who, Cancel, Being repaired");
  EXPLORE_CHANGE["rp-who"](st, ui, { dataset: { base: String(h.id), fx: String(bar.id) }, value: String(builder.id) });
  check(jobFor(h, bar).who === builder.id, "rp-who hands it to the builder");
  EXPLORE_ACTIONS["rp-start"](st, ui, { base: String(h.id), fx: String(bunk.id), m: "repair", who: String(people[2].id) });
  check(jobFor(h, bunk) && jobFor(h, bunk).who === people[2].id, "rp-start with data-who starts it by that person");
  EXPLORE_ACTIONS["rp-cancel"](st, ui, { base: String(h.id), fx: String(bar.id) });
  check(!jobFor(h, bar), "rp-cancel stops it");
  EXPLORE_ACTIONS["rp-all"](st, ui, { base: String(h.id) });
  check(jobFor(h, walls) && jobFor(h, bar), "rp-all starts the wall and the barricades");
  check(!/data-action="rp-all"/.test(repairsTab(st, h)), "with everything under way, no Repair all");
}

// 7. The autopilot orders a repair on the most worn thing over 50 when the scrap allows.
{
  console.log("The autopilot's orders");
  const { st, h, people } = setup(["walls", "barricades", "bunkhouse", "spike_pits"], { scrap: 100, parts: 5 });
  st.autopilot = true;
  const builder = people[0]; builder.role = "build"; builder.skills.mechanics = 2;
  const bunk = byType(h, "bunkhouse"); bunk.wear = 55;
  const bar = byType(h, "barricades"); bar.wear = 45;
  breakdownsHour(st); // 09:00
  check(jobFor(h, bunk) && jobFor(h, bunk).who === builder.id && !jobFor(h, bar), `at 09:00 the 55-wear bunkhouse gets an order by the builder, the 45-wear barricades none (${(st.log.find((l) => /repairing the bunkhouse/.test(l.text)) || {}).text || "no log"})`);
  check((h.stock.scrap || 0) >= ORDERS.keepScrap, "the scrap kept");
  // Short of scrap: no order.
  const s2 = setup(["walls", "barricades", "bunkhouse", "spike_pits"], { scrap: ORDERS.keepScrap + 1, parts: 0 });
  s2.st.autopilot = true;
  s2.people[0].role = "build";
  byType(s2.h, "bunkhouse").wear = 55;
  breakdownsHour(s2.st);
  check(!jobFor(s2.h, byType(s2.h, "bunkhouse")), `with ${ORDERS.keepScrap + 1} scrap (the order would leave less than ${ORDERS.keepScrap}) nothing is ordered`);
  // One an hour: two worn things, two hours.
  const s3 = setup(["walls", "barricades", "bunkhouse", "spike_pits"], { scrap: 100, parts: 5 });
  s3.st.autopilot = true;
  s3.people[0].role = "build";
  byType(s3.h, "bunkhouse").wear = 55; byType(s3.h, "barricades").wear = 70;
  breakdownsHour(s3.st);
  check(jobFor(s3.h, byType(s3.h, "barricades")) && !jobFor(s3.h, byType(s3.h, "bunkhouse")), "the most worn first, one an hour");
  s3.st.hour++;
  breakdownsHour(s3.st);
  check(!!jobFor(s3.h, byType(s3.h, "bunkhouse")), "the next hour the other");
  // At night nothing is ordered.
  const s4 = setup(["walls", "bunkhouse"], { scrap: 100 });
  s4.st.autopilot = true;
  s4.st.hour += 14; // 23:00
  byType(s4.h, "bunkhouse").wear = 55;
  breakdownsHour(s4.st);
  check(!jobFor(s4.h, byType(s4.h, "bunkhouse")), "not at night");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
