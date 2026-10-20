// No idle workers (the user's requests 2026-10-20; src/sim/noidle.js, autopilot.js planRoles 4a' / 5 / 11,
// idlework.js baseNeeds, activity.js, world.js, groupworks.js groupWorksDaily, ui/activity.js noWorkAlerts):
// - with an empty construction queue the governor leaves nobody a builder;
// - a role with no work (the ruins picked clean, a quiet ward, no crops …) is given one that has work by the governor;
// - under Manual roles a person whose job has no work this hour helps elsewhere (the builders, the felling, water,
//   the fields, a lookout) and keeps their role: back on it the hour it has work; the activity line says so;
// - the quiet alert lists the roles with no work, and who helps where;
// - the governor puts a woodcutter (the best) on its queued felling, and takes them off once it is done and wood is fine;
// - nobody idle over a 30-day hub run, with the governor and with Manual roles (idle person-hours: the activity line idle
//   or stalled, not counting rest, sleep, sickness, eating or the job's off hours);
// - an AI group's crew-days are never left on work that does not exist.
// Usage: node tools/noidletest.js [seed] [days] (default 42, 30)
import { createWorld, tickHour, hub, atBase, makeSurvivor, day } from "../src/sim/world.js";
import { setAutopilot, governRoles } from "../src/sim/autopilot.js";
import { describeActivity } from "../src/sim/activity.js";
import { groupsBuild, groupWorksDaily } from "../src/sim/groupworks.js";
import { newItem } from "../src/sim/inventory.js";
import * as NI from "../src/sim/noidle.js";
import * as WW from "../src/sim/woodwork.js";
import * as BM from "../src/sim/basemap.js";
import { noWorkAlerts } from "../src/ui/activity.js";
import { roleSelect, applyRoleChoice } from "../src/ui/work.js";
import { workFactor } from "../src/sim/health.js";

const SEED = Number(process.argv[2] || 42);
const DAYS = Number(process.argv[3] || 30);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
const world = (s = SEED, extra = {}) => { const st = createWorld({ seed: s, factionCount: 6, ...extra }); st.started = true; return st; };
const first = (s) => s.name.split(" ")[0];
const atHour = (st, h) => { st.hour = Math.floor(st.hour / 24) * 24 + 24 * 3 + h; }; // a spring day, at hour h
const healthy = (st, h) => { for (const s of atBase(st, h.id)) { s.health = 100; s.mood = 70; s.conditions = []; delete s.woundInfected; delete s.inBed; s.leader = false; } };
const more = (st, base, n) => { for (let i = 0; i < n; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: base.id }; s.health = 100; s.mood = 70; s.gear.weapon = newItem("pistol"); st.survivors.push(s); } };
const roles = (st, h) => atBase(st, h.id).map((s) => s.role);
const tally = (list) => Object.entries(list.reduce((a, r) => ((a[r] = (a[r] || 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join(", ");
const nearestTrees = (st, base, n) => BM.landFor(st, base).list.filter((p) => p.k === "tree").sort((a, b) => Math.hypot(...a.cells[0]) - Math.hypot(...b.cells[0])).slice(0, n);

// ---------- 1. Empty queue: no builders ----------
section("1. The governor: with the construction queue empty nobody stays a builder");
{
  const st = world();
  const h = hub(st);
  more(st, h, 4);
  healthy(st, h);
  setAutopilot(st, true);
  atHour(st, 9);
  h.construction = [];
  for (const s of atBase(st, h.id)) s.role = "build";
  governRoles(st, h);
  const b = atBase(st, h.id).filter((s) => s.role === "build");
  check(b.length === 0 || b.every((s) => s.upkeep), `no builders with nothing to build (${tally(roles(st, h))})`);
  // Its own felling for wood is the woodcutters' work, not the builders'.
  h.stock.wood = 0;
  const [t1] = nearestTrees(st, h, 1);
  const job = BM.queueClear(st, h, [t1], { label: "Fell a tree for wood" });
  job.gov = "wood";
  governRoles(st, h);
  check(!atBase(st, h.id).some((s) => s.role === "build" && !s.upkeep) && atBase(st, h.id).some((s) => s.role === "wood"), `only its felling queued: a woodcutter on it, no builders (${tally(roles(st, h))})`);
  // A build queued: builders again.
  h.construction = h.construction.filter((c) => c !== job);
  h.stock.scrap = 200; h.stock.wood = 5000;
  h.construction.push({ id: 99001, type: "craftbench", progress: 0, hours: 20 });
  governRoles(st, h);
  check(atBase(st, h.id).some((s) => s.role === "build"), `a build queued: a builder on it (${tally(roles(st, h))})`);
}

// ---------- 2. Roles with no work reassigned ----------
section("2. The governor: a role with no work is given one that has work");
{
  const st = world(SEED + 1);
  const h = hub(st);
  more(st, h, 5);
  healthy(st, h);
  setAutopilot(st, true);
  atHour(st, 10);
  h.construction = [];
  h.scavLeft = 0.1; // the ruins round the base picked clean: the governor's last resort (scavenge) has no work
  for (const s of atBase(st, h.id)) s.role = "scavenge";
  const ppl = atBase(st, h.id);
  ppl[0].role = "medic"; // nobody hurt: a quiet ward
  governRoles(st, h);
  const left = atBase(st, h.id).filter((s) => NI.noWorkFor(st, h, s, s.role, s.station));
  check(!left.length, `every role the governor set has work (${tally(roles(st, h))}${left.length ? `; no work: ${left.map((s) => `${first(s)} ${s.role}`).join(", ")}` : ""})`);
  check(!atBase(st, h.id).some((s) => s.role === "scavenge"), "nobody left scavenging ruins picked clean");
  check(!atBase(st, h.id).some((s) => s.role === "medic"), "no medic on a quiet ward");
  const a = describeActivity(st, Object.assign(makeSurvivor(st), { location: { kind: "base", baseId: h.id }, role: "medic", health: 100 }), 14);
  check(a.kind === "idle", `a medic with nobody to look after is idle by the activity line ("${a.text}")`);
}

// ---------- 3. Manual: help elsewhere, keep the role ----------
section("3. Manual roles: no work this hour → they help elsewhere and keep their role");
let alertState = null;
{
  const st = world(SEED + 2);
  const h = hub(st);
  more(st, h, 3);
  healthy(st, h);
  atHour(st, 9);
  h.construction = [];
  const ppl = atBase(st, h.id);
  for (const s of ppl) s.role = "guard";
  const [bob, cy, di] = ppl;
  bob.role = "build"; cy.role = "build"; di.role = "medic";
  const trees = nearestTrees(st, h, 1);
  BM.queueClear(st, h, trees, { label: "Fell a tree" });
  check(describeActivity(st, di).kind === "idle", `the medic has nobody to look after ("${describeActivity(st, di).text}")`);
  NI.helpHour(st);
  check(bob.role === "build" && !NI.helpingAs(bob), `a tree marked: the builders keep building (felling from the queue is builder work: "${describeActivity(st, bob).text}")`);
  // Nothing at all to build, nothing marked, the woodpile full: the fields (the hub's plots) or a lookout.
  NI.helpRestore(st);
  h.construction = [];
  h.stock.wood = 50000;
  for (const s of [bob, cy]) { s.role = "build"; delete s.helpLast; }
  NI.helpHour(st);
  check(["farm", "guard"].includes(NI.helpingAs(bob)) && NI.assignedRole(bob) === "build", `nothing to build, nothing marked, wood plenty: ${first(bob)} tends the fields or stands guard, still a Builder (${bob.role}, kept ${NI.assignedRole(bob)})`);
  const line = describeActivity(st, bob);
  check(line.kind === "work" && /^No building to do: /.test(line.text), `the activity line: "${line.text}"`);
  check(/<option value="build" selected/.test(roleSelect(st, bob)), "the role drop-down still shows Build");
  check(NI.helpingAs(di) != null && NI.assignedRole(di) === "medic", `the medic helps too (${di.role}), still a Medic`);
  alertState = { st, h, bob, cy, di };
  // The next hour: a tree marked on the base map → they help chop it (daylight).
  NI.helpRestore(st);
  check(bob.role === "build" && di.role === "medic", "the hour after, back on their own job before the roles are set");
  st.hour++;
  BM.queueClear(st, h, nearestTrees(st, h, 2).slice(1), { label: "Fell a tree" });
  delete di.helpLast; // (last hour's help comes first: a trip out is not cut short)
  h.construction = h.construction.filter((c) => c.type === "clear");
  // Builders can fell from the queue: that is work for them. A medic with no patients helps chop it.
  NI.helpHour(st);
  check(di.role === "build" || di.role === "wood", `a tree marked: the medic helps with it (${di.role}: "${describeActivity(st, di).text}")`);
  const dl = describeActivity(st, di);
  check(/^Nobody to look after: helping (the builders|chop wood)/.test(dl.text), `"${dl.text}"`);
  // Work appears for their own job: back to it.
  NI.helpRestore(st);
  di.health = 100; bob.health = 60; // someone hurt: the medic has work
  NI.helpHour(st);
  check(di.role === "medic" && !NI.helpingAs(di), `someone hurt: the medic is back on Medic duty ("${describeActivity(st, di).text}")`);
  bob.health = 100;
  // Changed by hand while helping: the change holds.
  NI.helpRestore(st); h.construction = []; for (const s of [bob, cy]) delete s.helpLast;
  NI.helpHour(st);
  const was = NI.helpingAs(cy);
  applyRoleChoice(st, cy, cy.role === "farm" ? "scavenge" : "farm"); // the player picks a job (the role drop-down)
  const picked = cy.role;
  NI.helpRestore(st);
  check(was && cy.role === picked, `changed by hand while helping (${was}): kept (${cy.role})`);
}

// ---------- 4. The alert ----------
section("4. The quiet alert lists the roles with no work");
{
  const { st, h, bob } = alertState;
  NI.helpRestore(st);
  h.construction = [];
  bob.role = "build";
  NI.helpHour(st);
  const rows = NI.noWorkRoles(st).filter((r) => r.base === h);
  check(rows.some((r) => r.job === "build" && r.people.includes(bob)), `roles with no work: ${rows.map((r) => `${r.name} (${r.people.map(first).join(", ")})`).join("; ")}`);
  const out = [];
  noWorkAlerts(st, out);
  const al = out.find((a) => a.kind === "nowork");
  check(!!al && al.tone === "info" && /Build/.test(al.text) && /help/.test(al.tip), `the alert (quiet, ${al ? al.tone : "none"}): "${al ? al.text : ""}"`);
  setAutopilot(st, true);
  check(!NI.noWorkRoles(st).length, "none while the governor runs the roles");
  setAutopilot(st, false);
}

// ---------- 5. The governor's woodcutter on its felling ----------
section("5. The governor puts the best woodcutter on its queued felling, and takes them off after");
{
  const st = world(SEED + 3);
  const h = hub(st);
  more(st, h, 5);
  healthy(st, h);
  setAutopilot(st, true);
  atHour(st, 9);
  h.construction = [];
  const ppl = atBase(st, h.id);
  for (const s of ppl) { s.role = "farm"; s.skills.farming = 1; s.skills.mechanics = 1; }
  const best = ppl[ppl.length - 1];
  best.skills.farming = 8; best.skills.mechanics = 6;
  best.gear.weapon = newItem("fireaxe");
  h.stock.wood = 5000; // the woodpile is fine: one woodcutter
  BM.queueClear(st, h, nearestTrees(st, h, 2), { label: "Fell a tree for wood" }).gov = "wood";
  governRoles(st, h);
  const wc = atBase(st, h.id).filter((s) => s.role === "wood");
  check(wc.length === 1 && wc[0] === best, `felling queued, the woodpile fine: one woodcutter, the best (${wc.map((s) => `${first(s)} ${Math.round(NI.fellScore(s) * 100) / 100}`).join(", ")}; best ${first(best)})`);
  h.stock.wood = 0;
  for (const p of nearestTrees(st, h, 6).slice(2)) BM.queueClear(st, h, [p], { label: "Fell a tree for wood" }).gov = "wood";
  governRoles(st, h);
  const wc2 = atBase(st, h.id).filter((s) => s.role === "wood").length;
  check(wc2 >= 2, `the woodpile empty: more woodcutters (${wc2})`);
  // Felling done and wood fine: off again.
  h.construction = h.construction.filter((c) => !WW.isChopJob(c));
  h.stock.wood = 50000;
  governRoles(st, h);
  check(!atBase(st, h.id).some((s) => s.role === "wood"), `the felling done and the woodpile full: no woodcutter (${tally(roles(st, h))})`);
}

// ---------- 6. 30 days at the hub ----------
// Idle: the activity line idle or stalled (not rest, sleep, sickness, eating, off hours; too weak to work, from hunger,
// wounds or mood, is their health).
const idleHours = (st, h) => {
  let n = 0;
  const who = {};
  for (const s of atBase(st, h.id)) {
    const a = describeActivity(st, s);
    if ((a.kind === "idle" || a.kind === "stalled") && workFactor(s) >= NI.NOIDLE.minWork) { n++; const k = `${s.role}: ${a.text}`; who[k] = (who[k] || 0) + 1; }
  }
  return { n, who };
};
const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] || 0) + v; };
section(`6. Nobody idle over ${DAYS} days at the hub (idle person-hours, rest, sleep, sickness and eating not counted)`);
{
  // The governor.
  const st = world(SEED + 4, { factionCount: 8 });
  setAutopilot(st, true);
  const h = hub(st);
  let idle = 0, ph = 0, wood = 0;
  const why = {};
  while (day(st) <= DAYS && !st.gameOver) {
    tickHour(st);
    const r = idleHours(st, h);
    idle += r.n; merge(why, r.who); ph += atBase(st, h.id).length;
    wood += atBase(st, h.id).filter((s) => s.role === "wood").length;
  }
  check(idle === 0, `the governor: ${idle} idle person-hours of ${ph}${idle ? ` (${Object.entries(why).slice(0, 4).map(([k, v]) => `${v} ${k}`).join("; ")})` : ""}`);
  console.log(`    ${atBase(st, h.id).length} at the hub on day ${day(st)}; ${wood} woodcutter-hours`);
}
{
  // Manual roles: builders with nothing queued, a medic, a cook with no kitchen, a crafter with an empty queue, a teacher.
  const st = world(SEED + 5, { factionCount: 8 });
  const h = hub(st);
  more(st, h, 2);
  h.construction = [];
  const ppl = atBase(st, h.id);
  const set = ["build", "build", "medic", "cook", "craft", "scavenge", "farm", "guard"];
  ppl.forEach((s, i) => { s.role = set[i % set.length]; });
  const mine = new Map(ppl.map((s) => [s.id, s.role]));
  h.scavLeft = 0.1;
  let idle = 0, ph = 0, helped = 0;
  const why = {}, as = {};
  while (day(st) <= DAYS && !st.gameOver) {
    tickHour(st);
    const r = idleHours(st, h);
    idle += r.n; merge(why, r.who); ph += atBase(st, h.id).length;
    for (const s of atBase(st, h.id)) if (NI.helpingAs(s)) { helped++; as[NI.helpingAs(s)] = (as[NI.helpingAs(s)] || 0) + 1; }
  }
  check(idle === 0, `Manual roles: ${idle} idle person-hours of ${ph}${idle ? ` (${Object.entries(why).slice(0, 4).map(([k, v]) => `${v} ${k}`).join("; ")})` : ""}`);
  check(helped > 0, `${helped} person-hours helping elsewhere (${Object.entries(as).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  const kept = ppl.filter((s) => s.alive && s.location.kind === "base" && !s.sickWas && NI.assignedRole(s) === mine.get(s.id));
  check(kept.length >= ppl.filter((s) => s.alive && s.location.kind === "base" && !s.sickWas).length, `everyone kept their own role (${ppl.map((s) => `${first(s)} ${NI.assignedRole(s)}`).join(", ")})`);
}

// ---------- 7. AI groups ----------
section("7. AI groups: no crew-days on work that does not exist");
{
  const st = world(SEED + 6, { factionCount: 8 });
  const fs = st.factions.filter((f) => f.alive && groupsBuild(st, f) && f.bases.length).slice(0, 4);
  let days = 0, carried = 0, landDays = 0, bad = 0, lost = 0;
  for (const f of fs) {
    f.stock.scrap = 400; f.stock.parts = 20;
    for (let d = 0; d < 40; d++) {
      groupWorksDaily(st, f);
      const c = f.crewDay;
      if (!c) continue;
      days++;
      if (Math.abs(c.carried + c.crew - (c.built + c.carry + c.land)) > 1e-6) bad++;
      if (c.carry > 0) carried++;
      if (c.land > 0) { landDays++; if (f.job) lost++; }
    }
  }
  check(fs.length > 0 && days > 0 && !bad, `${fs.length} groups, ${days} group-days: every crew-day built or on the land (${bad} off)`);
  check(carried > 0, `${carried} days a finished job's spare crew-days went on to the next job (they were lost)`);
  check(!lost, `crew on the land only on days with nothing to build (${landDays} such days)`);
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fail ? 1 : 0);
