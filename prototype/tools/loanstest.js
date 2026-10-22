// Volunteers on loan to your bases and joint operations (src/sim/loans.js, asked through src/sim/envoys.js): the ask
// delivered only by envoy (or at once by radio); their people walking to the base, living and working there and going
// out on a team, their kit their own; a recall and the walk home; a death on loan costing standing (less on the work
// they came for); a joint operation's fighters joining your team at the rendezvous and on the battle map as allies; a
// party that never comes (the operation goes on) and nobody at the rendezvous; the loot share and reneging; a member's
// answer on coalition.js's record; their proposals; the Envoys tab, the roster badge and the codex; a save mid-loan,
// an old save; the same seed, the same story.
// Usage: node tools/loanstest.js [seed=7]
import { setFood } from "./foodkit.js";
import { createWorld, tickHour, hub, day, makeSurvivor, atBase, killSurvivor } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { planPath, launchExpedition, partyMembers, startReturn } from "../src/sim/parties.js";
import { moveItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { defaultChoice } from "../src/sim/cardrules.js";
import { worksAt } from "../src/sim/groupworks.js";
import { createBattle } from "../src/sim/combat.js";
import * as D from "../src/sim/diplomacy.js";
import * as AL from "../src/sim/alliance.js";
import * as C from "../src/sim/coalition.js";
import * as E from "../src/sim/envoys.js";
import * as L from "../src/sim/loans.js";
import * as V from "../src/sim/volunteers.js";
import * as W from "../src/sim/playerwars.js";
import * as M from "../src/sim/members.js";

const SEED = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = performance.now();

const land = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain";
const free = (st, t) => land(st, t) && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t);
function setup(types, { seed = SEED, gw = 60, members = false, radio = false } = {}) {
  const st = createWorld({ seed, factionCount: 8 });
  Object.assign(st, { started: true, noNewGangs: true, noPlayerWars: true, noWars: true, noBlocs: true, noWanderers: true, noRoadblocks: true });
  const h = hub(st);
  Object.assign(h.stock, { water: 400, meds: 80, a_9mm: 900, scrap: 200, fuel: 80, parts: 10 }); setFood(h, 600);
  for (let i = 0; i < 6; i++) makeSurvivor(st, h.id);
  const g = st.grid;
  const spots = g.within(h.tile, 9).filter((t) => g.distance(t, h.tile) >= 6 && free(st, t) && planPath(st, t, h.tile, false));
  const used = [], fs = [];
  for (const type of types) {
    const f = st.factions.find((x) => x.alive && !fs.includes(x));
    const t = spots.find((x) => used.every((u) => g.distance(u, x) >= 3));
    used.push(t);
    Object.assign(f, { type, bases: [t], known: true, pop: 24, pact: "trade", goodwill: gw, works: {} });
    setFood(f, 400);
    fs.push(f);
  }
  for (const f of st.factions) if (!fs.includes(f)) { f.alive = false; f.bases = []; }
  st.hordes.length = 0;
  recomputeOwnership(st);
  D.ensureDiplo(st); W.ensurePwars(st);
  const A = AL.ensureAlliance(st);
  if (members) for (const f of fs) { A.members.push(f.id); A.joined[f.id] = day(st) - 200; }
  if (radio) { addBuilding(h, "radio"); h.radio = true; for (const f of fs) worksAt(f, f.bases[0]).radio = 1; }
  st.cards.length = 0;
  return { st, fs, h };
}
function run(st, hours, until = null, keep = () => false) {
  for (let i = 0; i < hours; i++) {
    tickHour(st);
    for (let n = 0; n < 20; n++) {
      const c = st.cards.find((x) => !keep(x));
      if (!c) break;
      const ch = defaultChoice(st, c) || c.choices[c.choices.length - 1];
      st.cards.splice(st.cards.indexOf(c), 1);
      if (ch) ch.resolve(st);
    }
    if (until && until()) return i + 1;
  }
  return hours;
}
const crew = (st, h, n = 1) => atBase(st, h.id).filter((s) => !s.loan).slice(-n).map((s) => s.id);
const loaned = (st, f) => st.survivors.filter((s) => s.alive && s.loan && s.loan.fid === f.id);
const ask = (st, f, h, extra = {}) => E.communicate(st, { fid: f.id, kind: "volunteers", payload: { baseId: h.id, n: 2, days: 5, purpose: "work", ...extra }, memberIds: crew(st, h) });

section("Asking for volunteers: by envoy, the answer on arrival");
{
  const { st, h, fs: [f] } = setup(["commune"]);
  const pop0 = f.pop;
  const r = ask(st, f, h, { offer: { key: "meds", qty: 5 } });
  check(r.ok && r.party && r.msg.kind === "volunteers", `an envoy carries the ask (${r.text})`);
  check(!L.loansOf(st).length && f.pop === pop0, "nothing happens until it arrives");
  run(st, 24 * 10, () => r.msg.status !== "travelling");
  const loan = L.loansOf(st)[0];
  check(r.msg.answer && r.msg.answer.yes && loan && loan.status === "coming" && f.pop === pop0, `delivered: they say yes and two of theirs set out, still their group's on the road (${r.msg.answer && r.msg.answer.text})`);
  const q = st.parties.find((p) => p.id === loan.partyId);
  check(q && q.kind === "loan" && q.owner === f.id && M.partyPeople(f, q).length === 2 && q.rations && Object.keys(q.rations).length > 0, "their very people walk to your base: a party of the group on the map (members out with it, road rations)");
  const meds0 = h.stock.meds;
  run(st, 24 * 10, () => loan.status === "here");
  const ps = loaned(st, f);
  check(loan.status === "here" && ps.length === 2 && ps.every((s) => s.location.kind === "base" && s.location.baseId === h.id), `they live at ${h.name}: in the roster, at the base`);
  check(atBase(st, h.id).filter((s) => s.loan).length === 2 && h.stock.meds === meds0 - 5, "they count at the base (beds, food, water) and the offer is paid when they come");
  check(f.pop === pop0 - 2 && !(f.people || []).some((s) => ps.includes(s)), "off their group's list while here (members.js)");
  check(/On loan from/.test(L.loanLine(st, ps[0])) && /days left/.test(L.loanLine(st, ps[0])), `marked: ${L.loanLine(st, ps[0])}`);
  ps[0].role = "build";
  check(ps[0].role === "build", "a work role like your own");
  const kitLoc = ps[0].gear.weapon ? `s:${ps[0].id}:weapon` : null;
  if (kitLoc) check(/on loan/i.test(moveItem(st, kitLoc, `s:${crew(st, h)[0]}:weapon`)) && ps[0].gear.weapon, "their kit cannot be taken off them");
  else check(true, "(no weapon to check)");
  const res = launchExpedition(st, { dest: st.grid.within(h.tile, 2).find((t) => t !== h.tile && land(st, t)), mission: "move", stance: "normal", memberIds: [ps[1].id, ...crew(st, h)], supplies: { food: 2, water: 2 } });
  check(res.party && partyMembers(st, res.party).some((s) => s.loan), "one goes out on a team");
}

section("By radio: at once");
{
  const { st, h, fs: [f] } = setup(["military"], { radio: true });
  const r = E.communicate(st, { fid: f.id, kind: "volunteers", payload: { baseId: h.id, n: 2, days: 4, purpose: "defence" } });
  check(r.ok && r.msg.via === "radio" && r.msg.status === "returned" && L.loansOf(st).length === 1 && L.loansOf(st)[0].status === "coming" && !st.parties.some((p) => p.envoy != null), `the answer at once, their people on the way (${r.text})`);
}

section("A refusal, on a member's record");
{
  const { st, h, fs: [f] } = setup(["raider"], { gw: 32, members: true, radio: true });
  const rec0 = C.recordOf(st, f);
  const r = E.communicate(st, { fid: f.id, kind: "volunteers", payload: { baseId: h.id, n: 4, days: 30, purpose: "hive" } });
  check(r.ok && r.msg.answer && !r.msg.answer.yes, `raiders, a hive, four for a month: no (${r.text})`);
  check(C.recordOf(st, f).tRef === (rec0.tRef || 0) + 1, "their refusal on coalition.js's record");
}

section("Recalled: they walk home");
{
  const { st, h, fs: [f] } = setup(["commune"], { radio: true });
  E.communicate(st, { fid: f.id, kind: "volunteers", payload: { baseId: h.id, n: 2, days: 20, purpose: "work" } });
  const loan = L.loansOf(st)[0];
  run(st, 24 * 6, () => loan.status === "here");
  const ids = loaned(st, f).map((s) => s.id);
  f.goodwill = 10;
  run(st, 2);
  check(!loaned(st, f).length && loan.status === "going" && st.parties.some((p) => p.loanId === loan.id && p.phase === "back"), "their group calls them back: off the base, a party walking home");
  run(st, 24 * 6, () => loan.status === "done");
  check(loan.status === "done" && ids.every((id) => (f.people || []).some((s) => s.id === id)), "home: the group's people again");
  // Their time up.
  f.goodwill = 60;
  E.communicate(st, { fid: f.id, kind: "volunteers", payload: { baseId: h.id, n: 1, days: 3, purpose: "work" } });
  const l2 = L.loansOf(st)[1];
  run(st, 24 * 6, () => l2.status === "here");
  run(st, 24 * 5, () => l2.status !== "here");
  check(l2.status === "going" || l2.status === "done", "their time up: they go");
}

section("A death on loan costs standing: by how they died");
{
  const { st, h, fs: [f, g] } = setup(["commune", "traders"], { radio: true, members: true });
  E.communicate(st, { fid: f.id, kind: "volunteers", payload: { baseId: h.id, n: 2, days: 10, purpose: "work" } });
  E.communicate(st, { fid: g.id, kind: "volunteers", payload: { baseId: h.id, n: 1, days: 10, purpose: "defence" } });
  run(st, 24 * 6, () => L.loansOf(st).every((l) => l.status === "here"));
  const s = loaned(st, f)[0];
  const s0 = C.standing(st, f);
  killSurvivor(st, s, h.tile, "of hunger");
  const s1 = C.standing(st, f);
  check(s1 <= s0 + L.LOAN.DEATH.other + 0.5, `dying in your care: ${Math.round(s0)} → ${Math.round(s1)}`);
  check(!st.survivors.includes(s) && (f.volFallen || []).length === 1, "off your roster; their group remembers its dead");
  const t = loaned(st, g)[0];
  const g0 = C.standing(st, g);
  st.resolving = true; killSurvivor(st, t, h.tile, "in the raid"); st.resolving = false;
  const g1 = C.standing(st, g);
  check(g1 < g0 && g0 - g1 < s0 - s1, `falling defending the base they came to defend costs less (${Math.round(g0 - g1)} against ${Math.round(s0 - s1)})`);
}

section("A joint operation: the rendezvous, allies on the battle map, the loot share");
{
  const { st, h, fs: [f, g] } = setup(["military", "fortress"], { radio: true, members: true });
  for (const x of [f, g]) x.goodwill = 70;
  const target = st.grid.within(h.tile, 5).find((t) => st.grid.distance(t, h.tile) === 4 && land(st, t));
  const r1 = E.communicate(st, { fid: f.id, kind: "jointop", payload: { op: "poi", target, n: 2, share: 0.25, dayAt: day(st) + 2 } });
  const o = L.opsOf(st)[0];
  check(r1.ok && o && o.groups.find((x) => x.fid === f.id).status === "coming", `${f.name} agree on the radio and set out for the rendezvous at ${o && o.tile} (${r1.text})`);
  const r2 = E.communicate(st, { fid: g.id, kind: "jointop", payload: { opId: o.id } });
  const gg = o.groups.find((x) => x.fid === g.id);
  check(r2.ok && gg && gg.status === "coming", `${g.name} join the same operation`);
  // g's party is killed on the way: missed, the operation goes on.
  const gp = st.parties.find((p) => p.id === gg.partyId);
  st.parties.splice(st.parties.indexOf(gp), 1);
  const team = launchExpedition(st, { dest: o.tile, mission: "move", stance: "normal", memberIds: crew(st, h, 3), supplies: { food: 6, water: 6 } }).party;
  run(st, 24 * 6, () => o.status === "met");
  check(o.status === "met" && o.groups.find((x) => x.fid === f.id).status === "joined" && gg.status === "lost", `met on day ${day(st)}: ${f.name}'s people joined, ${g.name}'s never came (lost)`);
  run(st, 2);
  const vols = V.volunteersWith(st, team);
  check(vols.length === 2 && vols.every((s) => s.vol.op === o.id), "with the team as volunteers");
  globalThis.window = {};
  let b;
  try { b = createBattle(st, { tile: team.path[team.idx], partyId: team.id, enemy: { kind: "raiders", count: 4, power: 3, name: "test raiders" }, ambush: null, canRetreat: true, handler: "none", context: {} }); } finally { delete globalThis.window; }
  const allies = b.units.filter((u) => u.side === "player" && u.vol != null);
  check(allies.length === 2 && allies.every((u) => u.volGroup === f.name), "on the battle map: allied units on your side, moved by their group");
  // The loot: what the team's cargo gains while they are with it, the share to them when they leave.
  team.cargo.supplies.meds = (team.cargo.supplies.meds || 0) + 40;
  run(st, 1);
  const meds0 = f.stock.meds || 0, st0 = C.standing(st, f);
  for (const s of vols) s.vol.until = st.hour;
  run(st, 3, () => o.status === "done");
  const home = st.parties.find((p) => p.owner === f.id && p.kind === "opparty" && p.phase === "back");
  check(home && (home.goods.supplies.meds || 0) >= 10 && M.partyPeople(f, home).length === 2, `they walk home together carrying their 25% share of the haul (${home && home.goods.supplies.meds} of 40 meds)`);
  check(o.status === "done" && C.standing(st, f) > st0, `the operation over: fought beside them (${Math.round(st0)} → ${Math.round(C.standing(st, f))})`);
  run(st, 24 * 6, () => !st.parties.includes(home));
  check(!st.parties.includes(home) && (f.stock.meds || 0) >= meds0 + 10, `home: the share in their stores (${(f.stock.meds || 0) - meds0} meds)`);
  // Nobody at the rendezvous (the team goes home first).
  startReturn(st, team);
  run(st, 24 * 4, () => !st.parties.includes(team));
  const o2 = L.planOp(st, { op: "horde", target, dayAt: day(st) + 1, n: 1 });
  const r3 = E.communicate(st, { fid: f.id, kind: "jointop", payload: { opId: o2.id } });
  check(r3.ok && o2.groups[0].status === "coming", `they agree to meet again (${r3.text})`);
  const s2 = C.standing(st, f);
  run(st, 24 * (L.LOAN.WAIT + 3), () => o2.status === "off");
  check(o2.status === "off" && C.standing(st, f) < s2, "nobody came: the operation is off, their party goes home, and they think less of you");
}

section("By envoy: the joint operation's answer comes home with it");
{
  const { st, h, fs: [f] } = setup(["fortress"]);
  f.goodwill = 70;
  const target = st.grid.within(h.tile, 4).find((t) => st.grid.distance(t, h.tile) === 3 && land(st, t));
  const r = E.communicate(st, { fid: f.id, kind: "jointop", payload: { op: "poi", target, n: 2, dayAt: day(st) + 6 }, memberIds: crew(st, h) });
  const o = L.opsOf(st)[0];
  check(r.ok && r.party && (!o.groups.length || o.groups[0].status === "asked"), "an envoy carries the proposal");
  run(st, 24 * 6, () => r.msg.status !== "travelling");
  check(o.groups[0] && ["coming", "refused"].includes(o.groups[0].status), `delivered: their answer at their table (${o.groups[0] && o.groups[0].status})`);
}

section("Their proposals");
{
  const { st, h, fs: [f] } = setup(["commune"], { radio: true, members: true });
  const prop = { fid: f.id, op: "horde", target: st.grid.within(f.bases[0], 3).find((t) => land(st, t) && t !== f.bases[0]), n: 2, share: 0.1 };
  E.proposeRoute(st, f, prop);
  const card = st.cards.find((c) => c.opProposal === f.id);
  check(card && /propose/.test(card.title), "by radio: a card at once");
  st.cards.splice(st.cards.indexOf(card), 1);
  card.choices.find((c) => c.label === "Agree").resolve(st);
  const o = L.opsOf(st).find((x) => x.by === f.id);
  check(o && o.groups[0].status === "coming", "agreed: their party sets out for the rendezvous");
}

section("The Envoys tab, the badge, the codex");
{
  const { st, h, fs: [f] } = setup(["commune"], { radio: true });
  E.communicate(st, { fid: f.id, kind: "volunteers", payload: { baseId: h.id, n: 1, days: 5, purpose: "work" } });
  run(st, 24 * 6, () => L.loansOf(st)[0].status === "here");
  const ui = await import("../src/ui/diplomacy.js");
  const u = { diplo: { tab: "envoys" }, envoy: { fid: f.id, kind: "volunteers", goods: {}, give: {}, get: {}, key: "food", qty: 10, pact: "nonaggression", members: [], vehicleId: null, msg: "", n: 2, days: 5, purpose: "work", baseId: h.id } };
  const html = ui.diplomacyModal(st, u);
  check(/Request volunteers/.test(html) && /Propose a joint operation/.test(html), "the actions in the composer");
  check(/On loan/.test(html), "volunteers on loan listed");
  const { loanBadge } = await import("../src/ui/envoys.js");
  check(/on loan/i.test(loanBadge(st, loaned(st, f)[0])), "a badge with their group's name");
  const { codexEntry } = await import("../src/ui/codex.js");
  check(!!codexEntry("k:loans"), "a codex entry");
}

section("Saves");
{
  const { st, h, fs: [f] } = setup(["commune"], { radio: true });
  E.communicate(st, { fid: f.id, kind: "volunteers", payload: { baseId: h.id, n: 2, days: 6, purpose: "work" } });
  run(st, 24 * 6, () => L.loansOf(st)[0].status === "here");
  const back = loadFromString(saveToString(st));
  const f2 = back.factions.find((x) => x.id === f.id);
  check(loaned(back, f2).length === 2 && L.loansOf(back)[0].status === "here", "a save mid-loan comes back");
  run(back, 24 * 12, () => L.loansOf(back)[0].status === "done");
  check(L.loansOf(back)[0].status === "done", "and the loan ends after the load");
  delete back.vols.baseLoans; delete back.vols.ops;
  run(back, 2);
  check(L.loansOf(back).length === 0 && L.opsOf(back).length === 0, "a save from before: no loans, no operations");
}

section("The same seed, the same story");
{
  const story = () => {
    const { st, h, fs: [f] } = setup(["commune"], { seed: SEED + 4 });
    ask(st, f, h);
    run(st, 24 * 16);
    return JSON.stringify({ l: L.loansOf(st).map((l) => [l.status, l.n, l.arrived]), m: st.envoys.msgs.map((m) => [m.kind, m.status, m.delivered, m.returned]) });
  };
  const x = story(), y = story();
  check(x === y, `two runs match (${x})`);
}

console.log(`\n${failed ? "FAILED" : "passed"}: ${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
