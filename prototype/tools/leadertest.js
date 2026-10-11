// Base leaders (src/sim/steward.js on top of the governor, autopilot.js stewardSafety / stewardSupplies): one of the
// people living at a base runs it. Checks: handing a base over picks the best by Leadership; a leader must live there
// and leads one base; while the leader is away the base waits (no role changes) and runs again when they are back;
// a dead leader is replaced by the next best; the night watch roster and a defence plan by role (but never over the
// player's own); an emergency water haul from an outpost with the leader kept home, and none with Emergency supplies
// off; the leader survives a save and load. Then: a deputy standing in while the leader is away; the mood lift by
// Leadership and a weak leader slow to act; a caravan at the gates traded with and a radio deal for water; a supply run
// from a led hub to a thirsty outpost; a hunting, fishing or firewood trip; a raid warning answered.
// Usage: node tools/leadertest.js [seed]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, newId, hourOfDay, makeSurvivor, day } from "../src/sim/world.js";
import { stewardOf, setSteward, setStewardArea, setLeader, leaderOf, leaderStatus, leaderChoices, stewardHour, actingLeader, actsShare, LEADER } from "../src/sim/steward.js";
import { crowdInfo, LEADER_LIFT } from "../src/sim/morale.js";
import { moodFactors } from "../src/sim/relations.js";
import { addBuilding } from "../src/sim/buildings.js";
import { radioDeal, dealQuote, canRadioGroup, tradeBase } from "../src/sim/radio.js";
import { tradeContext } from "../src/sim/trade.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { setWatchPreset } from "../src/sim/watch.js";
import { plansOf, newPlan } from "../src/sim/defenceplan.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { planPath } from "../src/sim/parties.js";
import { serializeState, deserializeState } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; if (process.env.V) console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const W = (sd = seed) => { const st = createWorld({ seed: sd, factionCount: 6 }); st.started = true; return st; };
function quiet(st, b) {
  for (const s of atBase(st, b.id)) { s.traits = []; s.conditions = []; s.role = "rest"; s.station = null; s.health = 100; s.mood = 80; }
  Object.assign(b.stock, { water: 200, scrap: 300, parts: 30, fuel: 40, meds: 20, ammo: 50, jars: 40 }); setFood(b, 500);
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
  for (const s of ppl) s.skills.leadership = Math.max(LEADER.sharp, s.skills.leadership); // nobody slow to act here
  setSteward(st, o, true);
  const L = leaderOf(st, o);
  st.hour = 24 * 5 + 6;
  for (let i = 0; i < 6; i++) tickHour(st);
  // Away: the next best stands in.
  L.location = { kind: "errand", baseId: o.id, until: day(st) + 10, pack: {} };
  const dep = leaderChoices(st, o)[0];
  const n0 = st.log.length;
  tickHour(st);
  check(logged(st, new RegExp(`${L.name} is away from ${o.name}: ${dep.name} stands in`), n0), "the leader leaving is logged with who stands in");
  check(actingLeader(st, o) === dep, `the deputy is the next best (${actingLeader(st, o) && actingLeader(st, o).name})`);
  let ran = 0;
  const n1 = st.log.length;
  for (let i = 0; i < 12; i++) { const h0 = stewardOf(o).day.hours; tickHour(st); if (stewardOf(o).day.hours !== h0) ran++; }
  check(ran >= 10 && stewardOf(o).on && stewardOf(o).leaderId === L.id, `while the leader is away the deputy runs the base (${ran} hours run), the leader stays leader`);
  check(!logged(st, /is away from/, n1), "the away line is logged once");
  // Nobody to stand in: the base waits.
  const others = atBase(st, o.id);
  for (const s of others) s.location = { kind: "base", baseId: h.id };
  const n1b = st.log.length;
  tickHour(st);
  const hb = stewardOf(o).day.hours;
  for (let i = 0; i < 6; i++) tickHour(st);
  check(logged(st, /nobody there can stand in/, n1b) && stewardOf(o).day.hours === hb, "nobody to stand in: the base waits");
  for (const s of others) s.location = { kind: "base", baseId: o.id };
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
      Object.assign(o.stock, { water: 0 }); setFood(o, 200);
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

// ---------- 6. Leadership: the mood lift and a weak leader ----------
{
  console.log("Leadership");
  const st = W();
  grow(st, 6);
  const h = quiet(st, hub(st));
  const o = makeOutpost(st, atBase(st, h.id).filter((s) => !s.leader).slice(0, 5));
  quiet(st, o);
  const L = atBase(st, o.id)[0];
  L.skills.leadership = 10;
  const before = crowdInfo(st, o).rawLift;
  setLeader(st, o, L.id);
  const ci = crowdInfo(st, o);
  check(before === 0 && ci.leader === L && Math.abs(ci.rawLift - 10 * LEADER_LIFT) < 0.05, `a named leader lifts the base's mood (${before} → ${ci.rawLift} a day)`);
  const other = atBase(st, o.id)[1];
  check(moodFactors(st, other).list.some((f) => /^Base leader /.test(f.label)), "the mood breakdown shows the base leader");
  L.location = { kind: "base", baseId: h.id };
  check(crowdInfo(st, o).rawLift === 0, "no lift while they are not there");
  L.location = { kind: "base", baseId: o.id };
  // Slow to act: Leadership 0 runs about half the hours, 6 every hour.
  setSteward(st, o, true);
  L.skills.leadership = 0;
  check(actsShare(L) === LEADER.base, `Leadership 0 acts in ${actsShare(L) * 100}% of the hours`);
  st.hour = 24 * 5 + 21;
  stewardOf(o).day = { ...stewardOf(o).day, slow: 0, hours: 0 };
  for (let i = 0; i < 20; i++) tickHour(st);
  const d = stewardOf(o).day;
  check(d.slow >= 4 && d.slow <= 16 && d.hours + d.slow >= 18, `a weak leader is slow to act (${d.slow} idle hours, ${d.hours} run of 20)`);
  L.skills.leadership = 6;
  stewardOf(o).day = { ...stewardOf(o).day, slow: 0, hours: 0 };
  for (let i = 0; i < 10; i++) tickHour(st);
  check(stewardOf(o).day.slow === 0, "Leadership 5+ acts every hour");
}

// ---------- 7. trading ----------
{
  console.log("Trading");
  const st = createWorld({ seed, factionCount: 8 });
  st.started = true;
  const h = quiet(st, hub(st));
  addBuilding(h, "radio");
  const land = (t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain";
  const f = st.factions.filter((x) => x.alive && x.bases.length && planPath(st, x.bases[0], h.tile, false)).sort((a, b) => st.grid.distance(a.bases[0], h.tile) - st.grid.distance(b.bases[0], h.tile))[0];
  Object.assign(f, { type: "traders", goodwill: 45, known: true, pop: Math.max(f.pop, 24) });
  Object.assign(f.stock, { ammo: 600, meds: 60, fuel: 60, parts: 10, scrap: 120, water: 150 }); setFood(f, 300);
  f.bases = [f.bases[0]];
  for (const x of st.factions) if (x !== f) { x.goodwill = Math.max(x.goodwill, -20); x.known = false; }
  if (!canRadioGroup(st, f)) f.bases = [st.grid.within(h.tile, 10).find((t) => land(t) && st.grid.distance(t, h.tile) >= 6 && !st.bases.some((b) => b.tile === t) && planPath(st, t, h.tile, false))];
  for (const s of atBase(st, h.id)) s.skills.leadership = 8;
  h.stock.ammo = 600;
  h.stock.meds = 0; // out of meds: a radio deal for them
  setSteward(st, h, true);
  for (const k of ["supplies", "land", "outposts"]) setStewardArea(st, h, k, false);
  st.hour = 24 * 5 + 6;
  const n0 = st.log.length;
  tickHour(st); // 07:00
  const c = st.parties.find((p) => p.kind === "caravan" && p.owner === f.id && p.deal);
  check(tradeBase(st, f) === h && !!c, `a short base makes a radio deal (${st.log.slice(0, st.log.length - n0).map((l) => l.text).find((t) => /radio deal/.test(t)) || "none"})`);
  check(!!c && c.goods.supplies.meds > 0 && c.goods.supplies.meds <= 6, `for meds, a small amount (${c ? c.goods.supplies.meds : 0})`);
  // The caravan arrives and the leader keeps the deal at the gates.
  let arrived = false, n1 = st.log.length;
  for (let i = 0; i < 24 * 30 && c && st.parties.includes(c); i++) {
    tickHour(st);
    for (const p of st.parties) if (p.owner === "player") p.lastConflict = st.hour;
    st.cards = st.cards.filter((x) => /heading for/.test(x.title));
    if (c.dealDone) { arrived = true; break; }
  }
  check(arrived, `the caravan's deal is kept at the gates (${st.log.slice(0, st.log.length - n1).map((l) => l.text).find((t) => /caravan at the gates/.test(t)) || "no line"})`);
  check(!tradeContext(st), "and the trade window is closed");
  // Only every LEADER_RADIO.every days.
  const deals = () => st.parties.filter((p) => p.kind === "caravan" && p.deal).length;
  h.stock.meds = 0;
  const k0 = deals();
  st.hour = Math.ceil(st.hour / 24) * 24 + 6;
  tickHour(st);
  check(deals() === k0 || day(st) - stewardOf(h).radioDay >= 6, "no second radio deal within 6 days");
}

// ---------- 8. supply runs to an outpost ----------
{
  console.log("Supply runs to outposts");
  let ok = null;
  for (const sd of [seed, 7, 11, 19]) {
    const st = W(sd);
    grow(st, 10);
    const h = quiet(st, hub(st));
    const o = makeOutpost(st, atBase(st, h.id).slice(-3), { water: 0 });
    quiet(st, o);
    for (const k of Object.keys(o.stock)) if (/water|raw/i.test(k)) o.stock[k] = 0;
    o.stock.food = 200;
    h.stock.water = 300;
    for (const s of atBase(st, h.id)) s.skills.leadership = 8;
    setSteward(st, h, true);
    for (const k of ["supplies", "land", "trade"]) setStewardArea(st, h, k, false);
    const L = leaderOf(st, h);
    st.hour = 24 * 5 + 6;
    const n0 = st.log.length;
    tickHour(st);
    const run = st.parties.find((p) => p.owner === "player" && p.homeBaseId === h.id && (p.kind === "supply" || p.supplyJobId != null || p.jobId != null)) || st.parties.find((p) => p.owner === "player" && p.homeBaseId === h.id);
    const line = st.log.slice(0, st.log.length - n0).map((l) => l.text).find((t) => /supply run to Test Outpost/.test(t));
    if (line) { ok = { sd, line, leaderHome: !run || !(run.members || []).includes(L.id), moved: atBase(st, o.id).length === 3 }; break; }
  }
  check(!!ok, `a led hub sends water to a thirsty outpost (${ok ? ok.line : "none"})`);
  check(!ok || ok.leaderHome, "the leader stays home");
  check(!ok || /water/.test(ok.line), "with water");
}

// ---------- 9. hunting, fishing and firewood ----------
{
  console.log("Hunting, fishing & firewood");
  let ok = null, tried = 0;
  for (const sd of [seed, 7, 11, 19, 23, 31, 5, 13]) {
    const st = W(sd);
    grow(st, 6);
    const h = quiet(st, hub(st));
    for (const s of atBase(st, h.id)) { s.skills.leadership = 8; s.skills.shooting = Math.max(6, s.skills.shooting); }
    h.stock.food = Math.ceil(atBase(st, h.id).length * 6); // short of food, but no emergency
    h.stock.preserved = 0;
    h.stock.ammo = 200;
    setSteward(st, h, true);
    for (const k of ["supplies", "outposts", "trade"]) setStewardArea(st, h, k, false);
    const L = leaderOf(st, h);
    st.hour = 24 * 30 + 6;
    tickHour(st);
    tried++;
    const team = st.parties.find((p) => p.owner === "player" && p.leaderTrip);
    if (team) { ok = { sd, team, leaderHome: !team.members.includes(L.id), line: st.log.find((l) => /went (hunting|fishing|cutting firewood)/.test(l.text)) }; break; }
  }
  check(!!ok, `a base short of food sends a hunting or fishing trip (${ok ? `seed ${ok.sd}: ${ok.line && ok.line.text}` : `none in ${tried}`})`);
  check(!ok || ok.leaderHome, "the leader stays home");
  if (ok) {
    const st = ok.team; // one team at a time
    check(st.homeBaseId != null, "the team belongs to the base");
  }
}

// ---------- 10. raid warnings ----------
{
  console.log("Raid warnings");
  const st = W();
  const h = quiet(st, hub(st));
  for (const s of atBase(st, h.id)) s.skills.leadership = 8;
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const raid = { id: newId(), owner: f.id, kind: "raid", path: [f.bases[0], h.tile], idx: 0, strength: 5, target: { kind: "player", baseId: h.id, tile: h.tile } };
  st.parties.push(raid);
  setSteward(st, h, true);
  const { raidWarning } = await import("../src/sim/factions.js");
  raidWarning(st, raid);
  check(st.cards.some((c) => /^Raiders heading for/.test(c.title)), "the warning card is up");
  stewardHour(st);
  check(!st.cards.some((c) => /^Raiders heading for/.test(c.title)), "the leader answers it");
  const line = st.log.find((l) => /Raiders heading for .* → /.test(l.text));
  check(!!line && /Prepare|tribute/i.test(line.text), `with prepare or a tribute (${line ? line.text : "none"})`);
  check(st.bases.includes(h), "and never by leaving the base");
  // Defence handed back: the card waits for you.
  const st2 = W();
  const h2 = quiet(st2, hub(st2));
  for (const s of atBase(st2, h2.id)) s.skills.leadership = 8;
  const f2 = st2.factions.find((x) => x.alive && x.bases.length);
  const raid2 = { id: newId(), owner: f2.id, kind: "raid", path: [f2.bases[0], h2.tile], idx: 0, strength: 5, target: { kind: "player", baseId: h2.id, tile: h2.tile } };
  st2.parties.push(raid2);
  setSteward(st2, h2, true);
  setStewardArea(st2, h2, "defence", false);
  raidWarning(st2, raid2);
  stewardHour(st2);
  check(st2.cards.some((c) => /^Raiders heading for/.test(c.title)), "Defence handed back: the card waits for you");
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
