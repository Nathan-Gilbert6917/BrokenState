// Envoys and radio links (src/sim/envoys.js): an offer delivered only when the envoy arrives and its answer known only
// when it is home; the envoy locked to its errand; an envoy killed on the way (the message lost, no answer, no refusal)
// and on the way back; a coalition member's ask by envoy (the card only on arrival, its books only when home); the
// instant path with radio on both sides; the council's delegates; the starting radios (none at a normal or hardcore
// start, the military's sets); the radio station's unlock (the handbook or the mid game) for you and the groups; old
// saves; the Envoys tab and the codex; the same seed, the same story.
// Usage: node tools/envoystest.js [seed=7]
import { setFood } from "./foodkit.js";
import { createWorld, tickHour, hub, day, makeSurvivor, atBase } from "../src/sim/world.js";
import { addBuilding, canBuild } from "../src/sim/buildings.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { planPath, partyMembers, orderMove, startReturn, wipeParty, partyTile } from "../src/sim/parties.js";
import { queueOrder, cancelMove } from "../src/sim/orders.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { defaultChoice } from "../src/sim/cardrules.js";
import { worksAt, workLock, groupTech } from "../src/sim/groupworks.js";
import { tech } from "../src/sim/blueprints.js";
import { yearStartDay } from "../src/sim/eras.js";
import { canRadioGroup, groupHasSet, hasStation, hasMilRadio, refusal } from "../src/sim/radio.js";
import { foodIn } from "../src/sim/foods.js";
import * as D from "../src/sim/diplomacy.js";
import * as AL from "../src/sim/alliance.js";
import * as C from "../src/sim/coalition.js";
import * as E from "../src/sim/envoys.js";
import * as W from "../src/sim/playerwars.js";

const SEED = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = performance.now();

const land = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain";
const free = (st, t) => land(st, t) && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t);
// A quiet world: no radio anywhere, full stores, the groups asked for 6–9 tiles from the hub (goodwill 40 by default).
function setup(types, { seed = SEED, gw = 40, members = false, radio = false } = {}) {
  const st = createWorld({ seed, factionCount: 8 });
  Object.assign(st, { started: true, noNewGangs: true, noPlayerWars: true, noWars: true, noBlocs: true, noWanderers: true, noRoadblocks: true });
  const h = hub(st);
  Object.assign(h.stock, { water: 400, meds: 80, a_9mm: 900, scrap: 200, fuel: 80, parts: 10 }); setFood(h, 600);
  for (let i = 0; i < 8; i++) makeSurvivor(st, h.id);
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
// Hours of the world, every card answered by its default (travel events, fights, asks) unless keep(card).
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
const crew = (st, h, n = 2) => atBase(st, h.id).slice(-n).map((s) => s.id);

section("Starting radios: none at a normal or hardcore start, the military's sets");
{
  for (const seed of [SEED, SEED + 1, SEED + 2]) {
    const st = createWorld({ seed, factionCount: 8 });
    const h = hub(st);
    const mil = st.factions.filter((f) => f.type === "military"), other = st.factions.filter((f) => f.type !== "military" && !(f.bases.some((t) => st.tiles[t].loc && st.tiles[t].loc.type === "military")));
    check(!hasStation(h) && !hasMilRadio(h) && !h.radio, `seed ${seed}: the hub starts with no station`);
    check(other.every((f) => !groupHasSet(st, f)) && mil.every((f) => groupHasSet(st, f)), `seed ${seed}: no group has a set but the military (${mil.length} military, ${other.length} others)`);
    check(st.factions.every((f) => !canRadioGroup(st, f)), `seed ${seed}: nobody can be called on day 1`);
  }
  let vets = 0, milr = 0;
  for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
    const st = createWorld({ seed, factionCount: 6, mode: "hardcore" });
    const p = st.parties.find((q) => q.owner === "player");
    const items = [...((p && p.cargo && p.cargo.gear) || []), ...st.survivors.flatMap((s) => [s.gear.tool, ...(s.pockets || []), ...((s.gear.backpack && s.gear.backpack.contents) || [])])].filter(Boolean);
    milr += items.filter((it) => it.key === "milradio").length;
    vets += st.survivors.filter((s) => s.background === "veteran").length;
    const guard = st.factions.find((f) => f.hcMilitary);
    if (guard && !groupHasSet(st, guard)) milr += 100;
  }
  check(milr === 0, `hardcore: no Military encrypted radio in a starting crew's hands (${vets} veterans in 8 runs), the Guard has its sets`);
  const { st, fs: [a] } = setup(["fortress"]);
  check(!groupHasSet(st, a), "a fortress has no set");
  a.hcSplinter = true;
  check(groupHasSet(st, a), "the Guard's splinter keeps its sets");
  delete a.hcSplinter;
  const st2 = createWorld({ seed: SEED, factionCount: 8 });
  const onMil = st2.factions.filter((f) => f.type !== "military" && f.bases.some((t) => st2.tiles[t].loc && st2.tiles[t].loc.type === "military"));
  check(onMil.every((f) => worksAt(f, f.bases.find((t) => st2.tiles[t].loc.type === "military")).radio === 1), `a group on a military site starts with its radio room (${onMil.length} here)`);
}

section("The radio station: the handbook, or the mid game");
{
  const { st, h, fs: [f] } = setup(["traders"]);
  for (const s of atBase(st, h.id)) s.skills.mechanics = Math.max(s.skills.mechanics, 6);
  h.stock.scrap = 300; h.stock.parts = 30;
  tech(st).known = tech(st).known.filter((x) => x !== "radioeng");
  const c0 = canBuild(st, h, "radio");
  check(!c0.ok && /Radio Engineering Handbook/.test(c0.reason) && /mid game \(year 5\)/.test(c0.reason), `locked early: ${c0.reason}`);
  tech(st).known.push("radioeng");
  const c1 = canBuild(st, h, "radio");
  check(c1.ok || !/Handbook/.test(c1.reason || ""), `the handbook studied opens it (${c1.ok ? "ok" : c1.reason})`);
  tech(st).known = tech(st).known.filter((x) => x !== "radioeng");
  st.hour = (yearStartDay(5) - 1) * 24 + 8;
  const c2 = canBuild(st, h, "radio");
  check(c2.ok || !/Handbook/.test(c2.reason || ""), `the mid game opens it without the handbook (${c2.ok ? "ok" : c2.reason})`);
  st.hour = 8;
  const T = groupTech(f);
  T.known = T.known.filter((x) => x !== "radioeng");
  worksAt(f, f.bases[0]).bench = 1;
  const lock = workLock(st, f, "radio");
  check(/Radio Engineering Handbook|Mechanics/.test(lock), `a group waits for the same (${lock})`);
  T.known.push("radioeng");
  check(!/Handbook/.test(workLock(st, f, "radio")), "the group with the handbook may build its station");
}

section("An offer by envoy: delivered on arrival, answered on return");
{
  const { st, h, fs: [f] } = setup(["traders"]);
  const g0 = f.goodwill, meds0 = f.stock.meds || 0;
  check(E.commsWith(st, f) === "envoy", "no radio link: by envoy");
  const plan = E.envoyPlan(st, { fid: f.id, kind: "aid", payload: { goods: { meds: 10 } }, memberIds: crew(st, h) });
  check(!plan.why && plan.hoursOut > 0 && plan.hoursBack > 0 && plan.food > 0 && plan.water > 0, `the plan: there ${Math.round(plan.hoursOut)}h, back ${Math.round(plan.hoursBack)}h, ${plan.food} days of food, ${plan.water} water`);
  const hm = h.stock.meds;
  const r = E.communicate(st, { fid: f.id, kind: "aid", payload: { goods: { meds: 10 } }, memberIds: crew(st, h) });
  check(r.ok && r.party && r.party.envoy === r.msg.id && r.party.mission === "envoy", `the envoy sets out (${r.text})`);
  const p = r.party, m = r.msg;
  check(h.stock.meds === hm - 10 && p.cargo.supplies.meds === 10, "the meds go with it, in its cargo");
  check(partyMembers(st, p).every((s) => s.location.kind === "party"), "its people are away from the base");
  check(m.status === "travelling" && E.statusOf(st, m) === "travelling" && (f.stock.meds || 0) === meds0 && f.goodwill === g0, "on the way: nothing delivered, nothing known");
  run(st, 24 * 10, () => m.status !== "travelling");
  check(m.status === "delivered" && m.answer && m.answer.yes && (f.stock.meds || 0) >= meds0 + 10 && f.goodwill > g0, `delivered on arrival: the meds in their stores, goodwill ${Math.round(g0)} → ${Math.round(f.goodwill)}`);
  check(E.statusOf(st, m) === "awaiting return" && E.messageList(st)[0].answer === "", "the answer is not yours yet: awaiting return, none shown");
  run(st, 24 * 10, () => m.status === "returned");
  check(m.status === "returned" && /took the aid/.test(E.messageList(st)[0].answer) && !st.parties.includes(p), `home: the answer known (${E.messageList(st)[0].answer})`);
  check(st.log.some((l) => /Our envoy is back/.test(l.text || l.msg || l)), "a log line when it is home");
}

section("The envoy cannot be redirected");
{
  const { st, h, fs: [f] } = setup(["commune"]);
  const r = E.communicate(st, { fid: f.id, kind: "news", payload: {}, memberIds: crew(st, h, 1) });
  const p = r.party, dest = p.dest, path = p.path.join(",");
  const other = st.grid.within(h.tile, 3).find((t) => t !== h.tile && land(st, t));
  check(orderMove(st, p, other) === E.ENVOY_LOCKED && p.dest === dest && p.path.join(",") === path, "no new move");
  check(queueOrder(st, p, { type: "move", tile: other }) === E.ENVOY_LOCKED && !(p.orders || []).length, "nothing queued");
  check(cancelMove(st, p) === E.ENVOY_LOCKED && p.phase === "out", "no stopping it");
  check(startReturn(st, p) === E.ENVOY_LOCKED && p.phase === "out", "no turning home");
  run(st, 3);
  check(st.parties.includes(p) && p.dest === dest && p.mission === "envoy", "still on its errand");
}

section("An envoy killed on the way: no message, no answer, no refusal");
{
  const { st, h, fs: [f] } = setup(["traders"], { members: true });
  const r = E.communicate(st, { fid: f.id, kind: "trade", payload: { give: { meds: 10 }, get: { scrap: 10 } }, memberIds: crew(st, h, 1) });
  const g0 = f.goodwill, rec0 = C.recordOf(st, f);
  run(st, 2);
  for (const s of partyMembers(st, r.party)) { s.alive = false; s.health = 0; }
  wipeParty(st, r.party);
  run(st, 2);
  check(r.msg.status === "lost" && r.msg.delivered == null && r.msg.answer == null, "the message is lost, never delivered");
  check(f.goodwill === g0 && JSON.stringify(C.recordOf(st, f)) === JSON.stringify(rec0), "no answer, nothing tallied: it is no refusal");
  check(E.statusOf(st, r.msg) === "travelling", "you do not know yet");
  st.hour = r.msg.overdueAt;
  run(st, 1);
  check(E.statusOf(st, r.msg) === "lost" && st.log.some((l) => /No word from our envoy/.test(l.text || l.msg || l)), `overdue: "No word from our envoy to ${f.name}"`);
}

section("An envoy killed on the way back: what was agreed stands, you never hear it");
{
  const { st, h, fs: [f] } = setup(["traders"], { gw: 30 });
  f.pact = null;
  const r = E.communicate(st, { fid: f.id, kind: "pact", payload: { pact: "trade" }, memberIds: crew(st, h, 1) });
  run(st, 24 * 10, () => r.msg.status !== "travelling");
  check(r.msg.status === "delivered" && r.msg.answer.yes && !f.pact, "they agreed at their table; not sealed yet");
  for (const s of partyMembers(st, r.party)) { s.alive = false; s.health = 0; }
  wipeParty(st, r.party);
  run(st, 2);
  check(r.msg.status === "lost" && !f.pact && E.messageList(st)[0].answer === "", "the pact lapses and you never learn their answer");
}

section("The instant path: radio on both sides");
{
  const { st, h, fs: [f] } = setup(["traders"], { gw: 30, radio: true });
  f.pact = null;
  check(E.commsWith(st, f) === "radio" && canRadioGroup(st, f), "both have a set: by radio");
  const r = E.communicate(st, { fid: f.id, kind: "pact", payload: { pact: "trade" } });
  check(r.ok && f.pact === "trade" && r.msg.status === "returned" && r.msg.via === "radio" && !st.parties.some((p) => p.envoy != null), `the pact at once, no envoy (${r.text})`);
  const r2 = E.communicate(st, { fid: f.id, kind: "aid", payload: { goods: { meds: 5 } }, memberIds: crew(st, h, 1) });
  check(r2.ok && r2.party && r2.msg.answer && r2.msg.answer.yes, "goods still go by envoy, agreed on the air");
  delete f.works[f.bases[0]].radio;
  check(E.commsWith(st, f) === "envoy" && /no radio of their own/.test(refusal(st, f)), `their set gone: by envoy again (${refusal(st, f)})`);
}

section("A coalition ask by envoy: the card only on arrival, their books only when home");
{
  const { st, h, fs: [a, b] } = setup(["commune", "traders"], { members: true });
  for (const f of [a, b]) f.stock.meds = 0;
  const card = C.askCard(st, "aid", [a], [a.id]);
  check(card && card.coalKind === "aid", "an aid ask from a member");
  const routed = E.envoyAsk(st, card);
  const m = st.envoys.msgs[st.envoys.msgs.length - 1];
  const q = st.parties.find((x) => x.id === m.partyId);
  check(routed && q && q.kind === "envoy" && q.owner === a.id && !st.cards.length, "no card: their envoy sets out (an AI party on the map)");
  check(E.askInFlight(st), "an ask in flight holds the next one");
  const rec0 = C.recordOf(st, a);
  run(st, 24 * 10, () => st.cards.some((c) => c.envoyMsg === m.id), (c) => c.envoyMsg === m.id);
  const cc = st.cards.find((c) => c.envoyMsg === m.id);
  check(cc && q.phase === "wait" && /envoy has come/.test(cc.text), "the card comes when the envoy reaches your hub");
  const refuse = cc.choices.find((c) => /Refuse/.test(c.label));
  st.cards.splice(st.cards.indexOf(cc), 1);
  refuse.resolve(st);
  check(JSON.stringify(C.recordOf(st, a)) === JSON.stringify(rec0) && m.answered && m.calls.length >= 1, "refused at your gates: their books wait for the envoy");
  run(st, 24 * 10, () => m.status === "returned");
  check(m.status === "returned" && C.recordOf(st, a).nRef === rec0.nRef + 1 && !st.parties.includes(q), "home: the refusal tallied");
  // Killed on the way: no ask, no refusal.
  const card2 = C.askCard(st, "aid", [a], [a.id]);
  E.envoyAsk(st, card2);
  const m2 = st.envoys.msgs[st.envoys.msgs.length - 1], q2 = st.parties.find((x) => x.id === m2.partyId);
  const rec1 = C.recordOf(st, a);
  st.parties.splice(st.parties.indexOf(q2), 1);
  run(st, 2);
  check(m2.status === "lost" && !st.cards.some((c) => c.envoyMsg === m2.id) && JSON.stringify(C.recordOf(st, a)) === JSON.stringify(rec1), "its envoy killed: the ask never comes, nothing tallied");
  // With radio: at once.
  addBuilding(h, "radio"); h.radio = true; worksAt(a, a.bases[0]).radio = 1;
  const card3 = C.askCard(st, "aid", [a], [a.id]);
  check(!E.envoyAsk(st, card3), "with a radio link the ask comes as a card at once (no envoy)");
}

section("The council's delegates");
{
  const { st, h, fs } = setup(["commune", "traders"], { members: true });
  const ms = AL.allianceMembers(st);
  check(E.councilByDelegates(st, ms) && st.envoys.council && st.envoys.council.msgs.length === 2 && !st.cards.length, "two delegates set out; nothing asked yet");
  run(st, 24 * 8, () => st.envoys.council.held, (c) => !!c.council);
  check(st.envoys.council.held, "the council sits when they are in");
  const dels = st.parties.filter((p) => p.kind === "envoy");
  st.cards = st.cards.filter((c) => !c.council);
  run(st, 24 * 10, () => !st.parties.some((p) => p.kind === "envoy"));
  check(dels.length && !st.parties.some((p) => p.kind === "envoy"), "the delegates go home once its business is done");
}

section("Old saves, a save mid-errand");
{
  const { st, h, fs: [f] } = setup(["traders"]);
  const r = E.communicate(st, { fid: f.id, kind: "news", payload: {}, memberIds: crew(st, h, 1) });
  run(st, 3);
  const back = loadFromString(saveToString(st));
  const p2 = back.parties.find((p) => p.id === r.party.id);
  check(p2 && p2.envoy === r.msg.id && E.msgById(back, r.msg.id).status === r.msg.status, "the envoy and its message come back");
  run(back, 24 * 20, () => E.msgById(back, r.msg.id).status === "returned");
  check(E.msgById(back, r.msg.id).status === "returned", "and it finishes its errand after the load");
  delete back.envoys;
  check(E.messageList(back).length === 0 && !E.askInFlight(back) && E.ensureEnvoys(back).msgs.length === 0, "a save from before: no messages");
  const old = createWorld({ seed: SEED, factionCount: 6 });
  old.groupWorks = 0; // a save from before the bare start: every group keeps its network by type
  check(old.factions.every((f) => groupHasSet(old, f)), "an old save's groups keep their radios");
}

section("The Envoys tab and the codex");
{
  const { st, h, fs: [f] } = setup(["traders"]);
  E.communicate(st, { fid: f.id, kind: "news", payload: {}, memberIds: crew(st, h, 1) });
  const ui = await import("../src/ui/diplomacy.js");
  const u = { diplo: { tab: "envoys" }, envoy: { fid: f.id, kind: "aid", goods: { meds: 5 }, give: {}, get: {}, key: "food", qty: 10, pact: "nonaggression", members: crew(st, h, 1), vehicleId: null, msg: "" } };
  const html = ui.diplomacyModal(st, u);
  check(/How word reaches them/.test(html) && /✉ envoy/.test(html) && /Send the envoy/.test(html) && /there in about/.test(html), "the composer with the route and the hours there and back");
  check(/Messages/.test(html) && /travelling/.test(html), "the messages in flight");
  const { codexEntry } = await import("../src/ui/codex.js");
  const e = codexEntry("k:envoys");
  check(e && e.cat === "groups" && /Envoys/.test(e.how), "a codex entry");
  const cu = await import("../src/ui/coalition.js");
  check(/by envoy/.test(cu.commsBadge(st, f)), "the coalition panel: reached by envoy");
}

section("The same seed, the same story");
{
  const story = () => {
    const { st, h, fs: [f, g] } = setup(["traders", "commune"], { seed: SEED + 5, members: true });
    E.communicate(st, { fid: f.id, kind: "trade", payload: { give: { meds: 10 }, get: { scrap: 15 } }, memberIds: crew(st, h, 2) });
    E.communicate(st, { fid: g.id, kind: "askaid", payload: { key: "food", qty: 5 }, memberIds: crew(st, h, 1).slice(0, 1).map((x) => x) });
    run(st, 24 * 14);
    const nm = (id) => (id === "you" ? "you" : st.factions.find((x) => x.id === id).name);
    return JSON.stringify(st.envoys.msgs.map((m) => [nm(m.from), nm(m.to), m.kind, m.status, m.answer && m.answer.yes, m.delivered, m.returned]));
  };
  const x = story(), y = story();
  check(x === y, `two runs match (${x.length} chars)`);
}

console.log(`\n${failed ? "FAILED" : "passed"}: ${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
