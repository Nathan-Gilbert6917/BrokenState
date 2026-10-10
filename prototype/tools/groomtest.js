// Toiletries test (src/sim/comforts.js groomKit / groomDaily, loot.js): deodorant and the rest lift the mood of whoever
// carries one; kept in a base's armory or a team's cargo they are a shared shelf for everyone there with none of their
// own; each kind counts once and all together at most COMFORT.groomMax; a day of use a day per person, and an empty
// one is thrown away. Every toiletry turns up somewhere (search finds, raid containers), and adding them left every
// other find's rate as it was.
// Usage: node tools/groomtest.js [seed]
import { createWorld, hub, atBase, log } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { newItem } from "../src/sim/inventory.js";
import { moodFactors, relationsDaily } from "../src/sim/relations.js";
import { COMFORT, groomKit, groomDaily } from "../src/sim/comforts.js";
import { launchExpedition } from "../src/sim/parties.js";
import { SITE_FINDS, AREA_FINDS, ITEM_TAGS } from "../src/sim/loot.js";
import { itemTip } from "../src/ui/inventory.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const TOILETRIES = Object.keys(GEAR).filter((k) => GEAR[k].groom);
const W = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.visitorsOff = true; return st; };
const groomLine = (st, s) => moodFactors(st, s).list.find((l) => l.label.startsWith("Washed and groomed"));
const pocket = (s, it) => { const i = s.pockets.indexOf(null); s.pockets[i] = it; return it; };

console.log(`Toiletries: ${TOILETRIES.join(", ")}`);
check(TOILETRIES.includes("deodorant") && TOILETRIES.length >= 5, "deodorant and at least four more toiletries exist");
check(TOILETRIES.every((k) => GEAR[k].value >= 0.5 * GEAR[k].groom * GEAR[k].dur), `priced for the mood they give over their life (a chocolate bar: 4 for +6; ${TOILETRIES.map((k) => `${k} ${GEAR[k].value}`).join(", ")})`);
check(["soap", "razors"].every((k) => TOILETRIES.includes(k) && !GEAR[k].valuable), "soap and razor blades are toiletries, not trade-only valuables");
check(TOILETRIES.every((k) => GEAR[k].dur > 0 && GEAR[k].groom > 0 && GEAR[k].cat === "toiletries"), "each has days of use, a mood a day and the toiletries trade category");

// ---------- 1. carried: the carrier's own ----------
{
  console.log("Carried deodorant lifts its carrier's mood");
  const st = W();
  const h = hub(st);
  h.armory = h.armory.filter((it) => !GEAR[it.key].groom);
  const [a, b] = atBase(st, h.id);
  const stick = pocket(a, newItem("deodorant"));
  const la = groomLine(st, a);
  check(la && la.v === GEAR.deodorant.groom && la.label.includes("deodorant"), `the carrier gets +${GEAR.deodorant.groom} (${la ? la.label : "no line"})`);
  check(!groomLine(st, b), "someone without one and no shelf gets nothing");
  groomDaily(st, a, { base: h });
  check(stick.dur === GEAR.deodorant.dur - 1, `a day of use (${GEAR.deodorant.dur} → ${stick.dur})`);
  stick.dur = 1;
  groomDaily(st, a, { base: h });
  check(!a.pockets.includes(stick) && st.log.some((l) => /deodorant ran out/.test(l.text || l.msg || String(l))), "the last day used, the empty stick is gone with a log line");
  check(!groomLine(st, a), "and the mood line with it");
}

// ---------- 2. the cap: each kind once, all together at most groomMax ----------
{
  console.log("Each kind counts once, all together capped");
  const st = W();
  const h = hub(st);
  h.armory = h.armory.filter((it) => !GEAR[it.key].groom);
  const a = atBase(st, h.id)[0];
  a.pockets = a.pockets.map(() => null);
  pocket(a, newItem("deodorant")); pocket(a, newItem("deodorant"));
  check(groomLine(st, a).v === GEAR.deodorant.groom, "two sticks are no better than one");
  const kit = groomKit(st, a, { base: h });
  groomDaily(st, a, { base: h });
  const sticks = a.pockets.filter((it) => it && it.key === "deodorant");
  check(kit.size === 1 && sticks.filter((it) => it.dur === GEAR.deodorant.dur - 1).length === 1, "only one of them is used a day");
  for (const k of TOILETRIES) if (k !== "deodorant") h.armory.push(newItem(k));
  const all = TOILETRIES.reduce((s, k) => s + GEAR[k].groom, 0);
  check(all > COMFORT.groomMax && groomLine(st, a).v === COMFORT.groomMax, `everything together: +${COMFORT.groomMax} (not ${Math.round(all * 10) / 10})`);
}

// ---------- 3. a base's shared shelf ----------
{
  console.log("The armory is a shared shelf: used up a day per person");
  const st = W();
  const h = hub(st);
  h.armory = h.armory.filter((it) => !GEAR[it.key].groom);
  const people = atBase(st, h.id).filter((s) => s.alive);
  for (const s of people) { s.pockets = s.pockets.map((it) => (it && GEAR[it.key].groom ? null : it)); }
  const own = people[0];
  const mine = pocket(own, newItem("toothpaste"));
  const shared = newItem("toothpaste");
  h.armory.push(shared);
  check(people.every((s) => groomLine(st, s)), `everyone at the base (${people.length}) gets the line`);
  check(groomKit(st, own, { base: h }).get("toothpaste").item === mine, "someone with their own uses that, not the shelf's");
  const d0 = shared.dur;
  relationsDaily(st);
  const users = people.filter((s) => s !== own && s.alive && s.location.kind === "base").length;
  check(shared.dur === d0 - users && mine.dur === d0 - 1, `the shelf's tube loses a day per user (${d0} → ${shared.dur}, ${users} users), the own tube one`);
  shared.dur = 1;
  const before = h.armory.length;
  for (const s of people.slice(1)) groomDaily(st, s, { base: h });
  check(h.armory.length === before - 1 && !h.armory.includes(shared), "used up, it leaves the armory");
  const second = newItem("toothpaste"); second.dur = 3; const third = newItem("toothpaste");
  h.armory.push(third, second);
  check(groomKit(st, people[1], { base: h }).get("toothpaste").item === second, "an open tube is finished before a new one");
}

// ---------- 4. a team's cargo ----------
{
  console.log("A team's cargo is the team's shelf");
  const st = W();
  const h = hub(st);
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 2);
  for (const s of crew) s.pockets = s.pockets.map((it) => (it && GEAR[it.key].groom ? null : it));
  const dest = st.tiles.find((t) => !t.loc && t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2);
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: dest.id, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 10, water: 10 } }).party;
  p.cargo = p.cargo || {}; p.cargo.gear = p.cargo.gear || [];
  const wipes = newItem("wetwipes");
  p.cargo.gear.push(wipes);
  check(crew.every((s) => { const l = groomLine(st, s); return l && l.label.includes("wet wipes"); }), "both on the team get the wet wipes");
  for (const s of crew) groomDaily(st, s, { party: p });
  check(wipes.dur === GEAR.wetwipes.dur - 2, `two people, two days used (${GEAR.wetwipes.dur} → ${wipes.dur})`);
}

// ---------- 5. where they turn up ----------
{
  console.log("Where they turn up");
  for (const k of TOILETRIES) {
    const sites = Object.entries(SITE_FINDS).filter(([, f]) => f.items[k]).map(([t]) => t);
    const areas = Object.entries(AREA_FINDS).filter(([, f]) => f.items[k]).map(([a]) => a);
    check(ITEM_TAGS[k] && sites.length >= 3 && areas.length >= 2, `${k}: ${sites.length} site types, ${areas.length} raid areas`);
  }
  check(SITE_FINDS.pharmacy.items.deodorant >= 2 && AREA_FINDS.house.items.deodorant && AREA_FINDS.lockers.items.deodorant, "deodorant in pharmacies, houses and locker rooms");
  // Every older find keeps its rate: p × weight / total is what it was before the toiletries came in.
  const OLD = { town: [0.12, 17, "goldring", 2], pharmacy: [0.14, 13, "puritabs", 2], mall: [0.18, 19.4, "diamond", 0.4] };
  for (const [t, [p0, w0, k, w]] of Object.entries(OLD)) {
    const f = SITE_FINDS[t];
    const tot = Object.entries(f.items).filter(([x]) => x !== "tourniquet").reduce((a, [, x]) => a + x, 0); // the tourniquet came after (loot.js, med-selfstab: its own addition)
    const now = (f.p * f.items[k]) / tot, was = (p0 * w) / w0;
    check(Math.abs(now - was) / was < 0.01, `${t}: ${k} still ${(was * 100).toFixed(2)}% a search hour (now ${(now * 100).toFixed(2)}%)`);
  }
}

// ---------- 6. the tooltip ----------
{
  const it = newItem("deodorant"); it.dur = 12;
  const t = itemTip(it);
  check(/toiletry: \+0\.5 mood a day/.test(t) && /12 of 30 days of use left/.test(t), `the tooltip says what it does and how long it lasts`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
