// Base leaders (src/sim/steward.js on top of the governor, autopilot.js stewardSafety / stewardSupplies): one of the
// people living at a base runs it. Checks: handing a base over picks the best by Leadership; a leader must live there
// and leads one base; while the leader is away the base waits (no role changes) and runs again when they are back;
// a dead leader is replaced by the next best; the night watch roster and a defence plan by role (but never over the
// player's own); an emergency water haul from an outpost with the leader kept home, and none with Emergency supplies
// off; the leader survives a save and load.
// Usage: node tools/leadertest.js [seed]
import { createWorld, tickHour, hub, atBase, newId, hourOfDay, makeSurvivor, day } from "../src/sim/world.js";
import { stewardOf, setSteward, setStewardArea, setLeader, leaderOf, leaderStatus, leaderChoices, stewardHour } from "../src/sim/steward.js";
import { setWatchPreset } from "../src/sim/watch.js";
import { plansOf, newPlan } from "../src/sim/defenceplan.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { planPath } from "../src/sim/parties.js";
import { serializeState, deserializeState } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const W = (sd = seed) => { const st = createWorld({ seed: sd, factionCount: 6 }); st.started = true; return st; };
function quiet(st, b) {
  for (const s of atBase(st, b.id)) { s.traits = []; s.conditions = []; s.role = "rest"; s.station = null; s.health = 100; s.mood = 80; }
  Object.assign(b.stock, { food: 500, water: 200, scrap: 300, parts: 30, fuel: 40, meds: 20, ammo: 50, jars: 40, preserved: 0 });
  return b;
}
function makeOutpost(st, staff, stock) {
  const h = hub(st);
  const g = st.grid;
  const t = st.tiles.find((x) => {
    const d = g.distance(x.id, h.tile);
    return d >= 4 && d <= 7 && x.terrain !== "water" && typeof x.owner !== "number" && !st.factions.some((f) => f.bases.some((b) => g.distance(b, x.id) <= 3)) && planPath(st, h.tile, x.id, true);
  });
  const base = { id: newId(), tile: t.id, type: "outpost", name: "Test Outpost", stock: { food: 200, water: 80, fuel: 10, meds: 6, ammo: 60, parts: 4, scrap: 80, ...stock }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(base);
  for (const s of staff) { s.location = { kind: "base", baseId: base.id }; s.role = "rest"; s.station = null; }
  recomputeOwnership(st);
  return base;
}
// More people at the hub (a new world starts with 6).
const grow = (st, n) => { for (let i = 0; i < n; i++) { const s = makeSurvivor(st, 1); s.location = { kind: "base", baseId: hub(st).id }; st.survivors.push(s); } };
const toHour = (st, h) => { while (hourOfDay(st) !== h) tickHour(st); };
const logged = (st, re, from) => st.log.slice(0, st.log.length - from).some((l) => re.test(l.text));

// ---------- 1. picking a leader ----------
{
  console.log("Picking a leader");
  const st = W();
  const h = quiet(st, hub(st));
  const ppl = atBase(st, h.id);
  ppl.forEach((s, i) => { s.skills.leadership = i; s.skills.speech = 0; });
  const best = ppl[ppl.length - 1];
  check(leaderStatus(st, h) === "none", "no leader before you pick one");
  setSteward(st, h, true);
  check(leaderOf(st, h) === best, `handing it over picks the best by Leadership (${leaderOf(st, h) && leaderOf(st, h).name})`);
  check(new RegExp(`${best.name} now runs ${h.name}`).test(st.log[0].text), `the hand-over names the leader (${st.log[0].text})`);
  const other = ppl[0];
  setLeader(st, h, other.id);
  check(leaderOf(st, h) === other, "you can name someone else");
  const o = makeOutpost(st, ppl.slice(-4));
  const msg = setLeader(st, o, other.id);
  check(/must live at/.test(msg) && stewardOf(o).leaderId == null, `someone living elsewhere cannot lead it (${msg})`);
  // One base each: naming the outpost's own person who already leads it elsewhere moves them.
  const op = atBase(st, o.id)[0];
  setLeader(st, h, other.id);
  setLeader(st, o, op.id);
  setSteward(st, o, true);
  check(leaderOf(st, o) === op, "the outpost keeps the leader you named");
  check(/needs a leader/.test(setLeader(st, o, "")), "a base that runs itself cannot be left without a leader");
  setSteward(st, h, false);
  check(/take over .* from /.test(st.log[0].text), `taking over names who it was (${st.log[0].text})`);
}

// ---------- 2. away, back, dead ----------
{
  console.log("Away, back and dead");
  const st = W();
  grow(st, 6);
  const h = quiet(st, hub(st));
  const o = makeOutpost(st, atBase(st, h.id).slice(5));
  quiet(st, o);
  const ppl = atBase(st, o.id);
  setSteward(st, o, true);
  const L = leaderOf(st, o);
  st.hour = 24 * 5 + 6;
  for (let i = 0; i < 6; i++) tickHour(st);
  // Away: the base waits, roles set by hand stay.
  L.location = { kind: "errand", baseId: o.id, until: day(st) + 10, pack: {} };
  const n0 = st.log.length;
  tickHour(st);
  check(logged(st, new RegExp(`${L.name} is away from ${o.name}`), n0), "the leader leaving is logged");
  const hours = stewardOf(o).day.hours;
  const n1 = st.log.length;
  for (let i = 0; i < 12; i++) tickHour(st);
  check(stewardOf(o).day.hours === hours && stewardOf(o).on, `while the leader is away the base waits (${stewardOf(o).day.hours - hours} hours run)`);
  check(!logged(st, /is away from/, n1), "the away line is logged once");
  // Back.
  L.location = { kind: "base", baseId: o.id };
  const n2 = st.log.length;
  tickHour(st);
  check(logged(st, new RegExp(`${L.name} is back and runs ${o.name}`), n2), "the leader coming back is logged");
  // Dead: the next best takes over.
  const next = leaderChoices(st, o).find((s) => s !== L);
  L.alive = false;
  const n3 = st.log.length;
  tickHour(st);
  check(leaderOf(st, o) === next && stewardOf(o).on, `a dead leader is replaced by the next best (${leaderOf(st, o) && leaderOf(st, o).name})`);
  check(logged(st, new RegExp(`${L.name}, ${o.name}'s leader, is dead: ${next.name} leads`), n3), "and the log says so");
  // Everyone gone: you run it.
  for (const s of atBase(st, o.id)) s.location = { kind: "base", baseId: h.id };
  tickHour(st);
  check(!stewardOf(o).on, "nobody left to lead it: the base is yours again");
  check(ppl.length >= 4, `the outpost had people (${ppl.length})`);
}

// ---------- 3. safety: the night watch and the defence plan ----------
{
  console.log("Safety");
  const st = W();
  const h = quiet(st, hub(st));
  st.hour = 24 * 5 + 6;
  setSteward(st, h, true);
  toHour(st, 7);
  tickHour(st);
  toHour(st, 19);
  check(h.watch && h.watch.gov && h.watch.shifts.some((sh) => sh.ids.length), `the leader keeps a night watch (${h.watch ? h.watch.shifts.map((sh) => `${sh.name}: ${sh.ids.length}`).join(", ") : "none"})`);
  check(!h.watch.shifts.some((sh) => sh.ids.includes(leaderOf(st, h).id) && leaderOf(st, h).pinned), "pinned people stay off the watch");
  const govPlan = plansOf(h).find((p) => p.by === "governor");
  check(!!govPlan || plansOf(h).length === 0, `a defence plan by role where the map takes one (${plansOf(h).map((p) => p.name).join(", ") || "none: fort map"})`);
  // Your own roster and plan stand.
  setWatchPreset(st, h, "two");
  const mine = JSON.stringify(h.watch.shifts.map((sh) => [sh.from, sh.to]));
  for (let i = 0; i < 30; i++) tickHour(st);
  check(!h.watch.gov && JSON.stringify(h.watch.shifts.map((sh) => [sh.from, sh.to])) === mine, "a roster of your own is left as it is");
  const st2 = W();
  const h2 = quiet(st2, hub(st2));
  const p = newPlan(st2, h2, "Mine");
  st2.hour = 24 * 5 + 6;
  setSteward(st2, h2, true);
  toHour(st2, 8);
  check(plansOf(h2).length === 1 && plansOf(h2)[0] === p, "a defence plan of yours: the leader lays none of its own");
  // Defence off: no roster.
  const st3 = W();
  const h3 = quiet(st3, hub(st3));
  setSteward(st3, h3, true);
  setStewardArea(st3, h3, "defence", false);
  st3.hour = 24 * 5 + 6;
  for (let i = 0; i < 20; i++) tickHour(st3);
  check(!h3.watch, "Defence handed back: no watch roster");
}

// ---------- 4. supplies: an emergency haul from the base ----------
{
  console.log("Emergency supplies");
  let sent = null, tried = 0, leaderKept = true, offOk = true;
  for (const sd of [seed, 7, 11, 19, 23, 31]) {
    for (const off of [false, true]) {
      const st = W(sd);
      grow(st, 8);
      const h = quiet(st, hub(st));
      const all = atBase(st, h.id);
      const o = makeOutpost(st, all.slice(2), { water: 0, food: 200 });
      quiet(st, o);
      Object.assign(o.stock, { water: 0, food: 200 });
      for (const k of Object.keys(o.stock)) if (/water|raw/i.test(k)) o.stock[k] = 0;
      setSteward(st, o, true);
      if (off) setStewardArea(st, o, "supplies", false);
      const L = leaderOf(st, o);
      st.hour = 24 * 5 + 6;
      tickHour(st); // 07:00, the morning plan
      const teams = st.parties.filter((p) => p.owner === "player" && p.homeBaseId === o.id);
      if (off) { if (teams.length) offOk = false; continue; }
      tried++;
      if (!teams.length) continue;
      if (teams.some((p) => p.members.includes(L.id))) leaderKept = false;
      sent = sent || { sd, team: teams[0], log: st.log.find((l) => /🧭 .*Emergency/.test(l.text)) };
    }
    if (sent) break;
  }
  check(!!sent, `an outpost out of water sends a haul from itself (${sent ? `seed ${sent.sd}` : `none in ${tried} tries`})`);
  check(leaderKept, "the leader stays home");
  check(!sent || !!sent.log, `the haul is logged under the leader's name (${sent && sent.log ? sent.log.text : "no line"})`);
  check(offOk, "Emergency supplies handed back: no haul");
}

// ---------- 5. save and load ----------
{
  console.log("Save and load");
  const st = W();
  const h = quiet(st, hub(st));
  setSteward(st, h, true);
  const id = leaderOf(st, h).id;
  const st2 = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const h2 = hub(st2);
  check(stewardOf(h2).on && stewardOf(h2).leaderId === id && leaderOf(st2, h2) && leaderOf(st2, h2).id === id, "the leader is kept in a save");
  st2.hour = 24 * 5 + 6;
  for (let i = 0; i < 24; i++) tickHour(st2);
  stewardHour(st2);
  check(stewardOf(h2).on, "and the loaded base keeps running");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
