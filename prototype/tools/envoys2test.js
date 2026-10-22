// Every word by envoy without a radio link, and people on loan as your own (round 3 of envoys.js and loans.js, the
// user's rules 2026-10-22): each card a group sends you (asking to join, a call for your people, a trade offer, a job,
// their war, a war on you, suing for peace, their terms) only by its envoy without a link, at once with one; your peace
// terms and a request to keep their people by your envoy; the groups' own pacts, wars and peaces by courier; a joint
// operation they propose by envoy; reneging on a loot share; people on loan eating, drinking, sleeping and drawing
// rounds at the base like yours; the base's gear going back and their own going home; the autopilot running a base
// with people on loan (their kit never swapped, stripped or sold); the ask to stay (the request only when someone wants
// to, a yes, a no and keeping them anyway, just letting them join, sending them home); their parties on the road as
// people (killed by name, intercepted) walking to a base of their choosing; an envoy lost out of radio coverage heard
// of only when overdue; old saves; the same seed, the same story.
// Usage: node tools/envoys2test.js [seed=7]
import { setFood } from "./foodkit.js";
import { createWorld, tickHour, hub, day, makeSurvivor, atBase, residents, killSurvivor } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { planPath, launchExpedition, partyMembers, partyTile, wipeParty } from "../src/sim/parties.js";
import { moveItem, newItem, allCarried, stow } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { defaultChoice } from "../src/sim/cardrules.js";
import { worksAt } from "../src/sim/groupworks.js";
import { createBattle } from "../src/sim/combat.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { supItems, unpackPerson } from "../src/sim/supitems.js";
import { roadCaravans } from "../src/sim/caravanraids.js";
import { jobsDaily, ensureJobs } from "../src/sim/jobs.js";
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
function setup(types, { seed = SEED, gw = 60, members = false, radio = false, near = 6, far = 9 } = {}) {
  const st = createWorld({ seed, factionCount: 8 });
  Object.assign(st, { started: true, noNewGangs: true, noPlayerWars: true, noWars: true, noBlocs: true, noWanderers: true, noRoadblocks: true });
  const h = hub(st);
  Object.assign(h.stock, { water: 400, meds: 80, a_9mm: 900, scrap: 200, fuel: 80, parts: 10 }); setFood(h, 600);
  for (let i = 0; i < 6; i++) makeSurvivor(st, h.id);
  const g = st.grid;
  const spots = g.within(h.tile, far).filter((t) => g.distance(t, h.tile) >= near && free(st, t) && planPath(st, t, h.tile, false));
  const used = [], fs = [];
  for (const type of types) {
    const f = st.factions.find((x) => x.alive && !fs.includes(x));
    const t = spots.find((x) => used.every((u) => g.distance(u, x) >= 3));
    used.push(t);
    Object.assign(f, { type, bases: [t], known: true, pop: 24, pact: "trade", goodwill: gw, works: {} });
    delete f.people; delete f.popSeen;
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
// Hours of the world, every card answered by its default unless keep(card) (kept cards stay up).
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
const kitOf = (s) => [...allCarried(s), ...((s.gear.carry && s.gear.carry.contents) || []).filter(Boolean)];
const logHas = (st, re) => st.log.some((l) => re.test(l.text));
const envoyCard = (c) => c.envoyMsg != null || c.loanStay != null;
// A loan by radio (or by envoy when no radio), run until they are at the base.
// kit(s): what each of them carries from home, put on them on the road.
function loanHere(st, f, h, n = 2, days = 10, purpose = "work", kit = null) {
  const r = E.communicate(st, { fid: f.id, kind: "volunteers", payload: { baseId: h.id, n, days, purpose }, memberIds: crew(st, h) });
  let loan = null;
  run(st, 24 * 20, () => {
    loan = loan || L.loansOf(st).find((l) => l.fid === f.id && l.status === "coming") || null;
    if (loan && kit && !loan.kitted) { const p = st.parties.find((x) => x.id === loan.partyId); if (p) { for (const s of M.partyPeople(f, p)) kit(s); loan.kitted = true; } }
    return !!loan && loan.status === "here";
  });
  return { r, loan };
}

section("Every card a group sends: by its envoy without a link, at once with one");
{
  // Without a link: nothing until the envoy is at your gates, then the card, built for that moment.
  const { st, h, fs: [f, g, foe] } = setup(["commune", "traders", "raider"], { gw: 70 });
  check(E.commsWith(st, f) === "envoy" && E.commsWith(st, g) === "envoy", "no radio link with either group");
  ensureJobs(st).list.push({ id: 9e6, fid: f.id, status: "done" }); // a job done for them: they may ask to join (alliance.js inviteProblem)
  const sent = {};
  sent.join = E.cardFromGroup(st, f, "join");
  const ask = V.makeAsk(st, g, { kind: "defence", label: "holding their base" }, 2, 4);
  sent.volask = ask ? "envoy" : null;
  sent.offer = E.cardFromGroup(st, g, "offer");
  D.startWar(st, f, foe, "land");
  const w = D.warsOf(st, f)[0] || null;
  sent.warjoin = w ? E.cardFromGroup(st, f, "warjoin", { warId: w.id }) : "envoy";
  check(Object.values(sent).every((x) => x === "envoy") && !st.cards.length, `all carried, no card yet (${JSON.stringify(sent)})`);
  const msgs = () => st.envoys.msgs.filter((m) => m.kind === "card" && m.to === "you");
  check(msgs().length >= 3 && msgs().every((m) => m.status === "travelling" && st.parties.some((p) => p.id === m.partyId && p.kind === "envoy")), `${msgs().length} envoys on the road (group parties)`);
  check(E.cardFromGroup(st, f, "join") === "held" && E.cardInFlight(st, f, "join"), "the same word twice: one envoy (held)");
  run(st, 24 * 8, () => msgs().every((m) => m.status !== "travelling"), envoyCard);
  const cards = st.cards.filter((c) => c.envoyMsg != null);
  check(cards.length >= 3 && cards.every((c) => /envoy has come to/.test(c.text)), `on arrival: ${cards.map((c) => c.title).join(" · ")}`);
  check(cards.some((c) => c.allianceAsk === f.id) && cards.some((c) => /volunteer|people/i.test(c.title + c.text)), "the coalition ask and the call for your people among them");
}
{
  // With a link: at once.
  const { st, fs: [f] } = setup(["commune"], { gw: 70, radio: true });
  check(E.commsWith(st, f) === "radio", "a radio link");
  ensureJobs(st).list.push({ id: 9e6, fid: f.id, status: "done" });
  const n0 = st.cards.length;
  check(E.cardFromGroup(st, f, "join") === "radio" && st.cards.length === n0 + 1 && !(st.envoys && st.envoys.msgs.some((m) => m.kind === "card")), "the card now, no envoy");
  const ask = V.makeAsk(st, f, { kind: "defence", label: "holding their base" }, 2, 4);
  check(ask && st.cards.length === n0 + 2, "a call for your people: the card now");
}

section("A war on you is carried; suing for peace and their terms too");
{
  const { st, h, fs: [f] } = setup(["raider"], { gw: -40 });
  const w0 = W.declareOnPlayer(st, f);
  check(w0 == null && !W.atWarWithYou(st, f) && E.cardInFlight(st, f, "declare"), "no link: the declaration is on its way, no war yet");
  run(st, 24 * 8, () => W.atWarWithYou(st, f));
  check(W.atWarWithYou(st, f), `the war begins when it reaches ${h.name} (day ${day(st)})`);
  const w = W.pwarOf(st, f);
  if (w) {
    check(E.cardFromGroup(st, f, "sue", { warId: w.id }) === "envoy" && !st.cards.some((c) => c.envoyMsg != null), "suing for peace: by envoy");
    check(E.cardFromGroup(st, f, "demand", { warId: w.id }) === "envoy", "their terms: by envoy");
    // Your terms by your envoy: their answer comes home with it.
    const opt = W.termOptions(st, w).find((o) => !o.why);
    if (opt) {
      w.lastTalk = -99;
      const text = W.offerTerms(st, w.id, opt.key);
      const m = st.envoys.msgs.find((x) => x.kind === "terms");
      check(/white flag/.test(text) && m && m.status === "travelling", `your terms go by envoy (${text})`);
    } else check(true, "(no terms to offer here)");
  } else check(true, "(no war record to sue in)");
  const { st: s2, fs: [g] } = setup(["raider"], { gw: -40, radio: true });
  const w2 = W.declareOnPlayer(s2, g);
  check(w2 && W.atWarWithYou(s2, g), "with a radio link the declaration is read at once");
}

section("A member's sightings and a ransom's price by envoy");
{
  const { st, h, fs: [f] } = setup(["commune"], { gw: 70, members: true });
  E.newsFromMember(st, f);
  const m = st.envoys.msgs.find((x) => x.kind === "news" && x.from === f.id);
  const k0 = Object.keys(st.knowledge).length;
  check(m && m.status === "travelling", "a member's sightings: by courier");
  run(st, 24 * 8, () => m.status !== "travelling");
  check(m.status !== "travelling" && Object.keys(st.knowledge).length >= k0, "on arrival: their sightings on your map");
  const r = E.quickEnvoy(st, f, "ransom", { ids: [] });
  const q = st.envoys.msgs.find((x) => x.kind === "ransom");
  check(r.ok && q && q.status === "travelling" && q.from === "you", `asking their price: your best talker goes (${r.text})`);
  const { st: s2, fs: [g] } = setup(["commune"], { gw: 70, radio: true });
  const r2 = E.quickEnvoy(s2, g, "ransom", { ids: [] });
  check(r2.ok && /radio/i.test(r2.text) && !s2.parties.some((p) => p.envoy != null), `by radio nobody goes (${r2.text})`);
  void h;
}

section("A job offered by envoy: on your list only when it arrives");
{
  const { st, fs: [f] } = setup(["traders"], { gw: 70 });
  let m = null;
  for (let i = 0; i < 300 && !m; i++) { st.hour += 24; jobsDaily(st); m = st.envoys && st.envoys.msgs.find((x) => x.kind === "card" && x.card === "job"); }
  if (m) {
    const J = st.jobs || {};
    const job = (J.list || []).find((j) => j.id === m.args.jobId);
    check(job && job.status === "carried", "carried: not offered yet");
    run(st, 24 * 8, () => m.status !== "travelling", envoyCard);
    check(job.status === "offered" && st.cards.some((c) => c.envoyMsg === m.id), "arrived: offered, its card up");
  } else check(true, "(no job came up in 300 days here)");
}

section("Their pacts, wars and peaces by courier without a link, at once with one");
{
  const { st, fs: [a, b] } = setup(["commune", "commune"], { near: 5, far: 12 });
  check(!E.groupsLinked(st, a, b), "two communes without sets: no link");
  E.groupWord(st, a, b, "pact");
  check(!D.pactBetween(st, a, b) && st.envoys.msgs.some((m) => m.kind === "talk" && m.act === "pact" && m.status === "travelling"), "a pact: its courier on the road, not signed yet");
  run(st, 24 * 10, () => D.pactBetween(st, a, b));
  check(D.pactBetween(st, a, b), "signed when the courier reaches them");
  const { st: s2, fs: [x, y] } = setup(["commune", "commune"], { near: 5, far: 12 });
  E.groupWord(s2, x, y, "war", { reason: "land" });
  check(!D.warBetween(s2, x, y), "a declaration carried: no war yet");
  run(s2, 24 * 10, () => !!D.warBetween(s2, x, y));
  const wr = D.warBetween(s2, x, y);
  check(!!wr, "the war begins as it is read");
  if (wr) { E.groupWord(s2, x, y, "peace", { warId: wr.id }); check(!!D.warBetween(s2, x, y), "a peace carried: still at war"); run(s2, 24 * 10, () => !D.warBetween(s2, x, y)); check(!D.warBetween(s2, x, y), "peace when its courier arrives"); }
  const { st: s3, fs: [p, q] } = setup(["military", "military"], { near: 5, far: 9 });
  if (E.groupsLinked(s3, p, q)) { E.groupWord(s3, p, q, "pact"); check(D.pactBetween(s3, p, q), "linked by radio: signed at once"); }
  else check(true, "(the two military groups here are not linked)");
}

section("A joint operation they propose, by envoy");
{
  const { st, h, fs: [f] } = setup(["commune"], { gw: 70, members: true });
  const prop = { fid: f.id, op: "horde", target: st.grid.within(f.bases[0], 3).find((t) => land(st, t) && t !== f.bases[0]), n: 2, share: 0.1 };
  check(E.proposeRoute(st, f, prop) && !st.cards.some((c) => c.opProposal), "no link: their envoy carries it, no card yet");
  const m = st.envoys.msgs.find((x) => x.kind === "propose");
  run(st, 24 * 8, () => st.cards.some((c) => c.opProposal === f.id), envoyCard);
  const card = st.cards.find((c) => c.opProposal === f.id);
  check(card && /envoy has come/.test(card.text), "the card when their envoy arrives");
  st.cards.splice(st.cards.indexOf(card), 1);
  card.choices.find((c) => c.label === "Agree").resolve(st);
  const op = L.opsOf(st).find((o) => o.by === f.id);
  check(op && !st.parties.some((p) => p.owner === f.id && p.kind === "opparty"), "agreed: their fighters wait for the envoy to get home");
  run(st, 24 * 8, () => m.status === "returned");
  check(m.status === "returned" && st.parties.some((p) => p.owner === f.id && p.kind === "opparty"), "home with your yes: their party sets out");
  void h;
}

section("Reneging on a loot share");
{
  const { st, h, fs: [f] } = setup(["military"], { radio: true, members: true, gw: 70 });
  const target = st.grid.within(h.tile, 5).find((t) => st.grid.distance(t, h.tile) === 4 && land(st, t));
  E.communicate(st, { fid: f.id, kind: "jointop", payload: { op: "poi", target, n: 2, share: 0.25, dayAt: day(st) + 2 } });
  const o = L.opsOf(st)[0];
  const team = launchExpedition(st, { dest: o.tile, mission: "move", stance: "normal", memberIds: crew(st, h, 3), supplies: { food: 6, water: 6 } }).party;
  run(st, 24 * 6, () => o.status === "met");
  run(st, 2);
  team.cargo.supplies.meds = (team.cargo.supplies.meds || 0) + 40;
  run(st, 1);
  team.cargo.supplies.meds = 0; // spent before they leave
  const s0 = C.standing(st, f);
  for (const s of V.volunteersWith(st, team)) s.vol.until = st.hour;
  run(st, 3, () => o.status === "done");
  check(logHas(st, /got less than the share they were promised/) && C.standing(st, f) < s0 + L.LOAN.FOUGHT, `the haul spent before their share: reneged (${Math.round(s0)} → ${Math.round(C.standing(st, f))})`);
}

section("People on loan live as yours: eat, drink, sleep, draw rounds");
{
  const { st, h, fs: [f] } = setup(["commune"], { radio: true });
  const { loan } = loanHere(st, f, h, 2, 10);
  const ps = loaned(st, f);
  check(loan.status === "here" && ps.length === 2 && ps.every((s) => residents(st, h.id).includes(s)), "residents of the base");
  for (const s of ps) { s.hunger = 30; s.thirst = 30; s.tired = 8; }
  const own = atBase(st, h.id).find((s) => !s.loan);
  own.hunger = 30; own.thirst = 30; own.tired = 8;
  run(st, 36);
  check(ps.every((s) => s.hunger > 50 && s.thirst > 50) && own.hunger > 50, `fed and watered from the stores (hunger ${ps.map((s) => Math.round(s.hunger)).join(", ")}; yours ${Math.round(own.hunger)})`);
  check(ps.every((s) => (s.tired || 0) < 8), `they sleep (tired ${ps.map((s) => Math.round(s.tired || 0)).join(", ")})`);
  globalThis.window = {};
  let b;
  try { b = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: [ps[0].id, own.id], enemy: { kind: "raiders", count: 3, power: 3, name: "test raiders" }, ambush: null, canRetreat: true, handler: "none", context: {} }); } finally { delete globalThis.window; }
  const us = b ? b.units.filter((u) => u.side === "player") : [];
  check(b && us.some((u) => u.sid === ps[0].id) && us.some((u) => u.sid === own.id) && b.pools.includes(h.stock) && !us.find((u) => u.sid === ps[0].id).vol, "in a fight at the base: one of yours, drawing rounds from its stores");
}

section("Their kit stays theirs; the base's goes back when they leave");
{
  const { st, h, fs: [f] } = setup(["commune"], { radio: true });
  const { loan } = loanHere(st, f, h, 2, 10, "work", (x) => { x.gear.weapon = newItem("pistol"); x.gear.armor = newItem("leatherjacket"); x.gear.backpack = newItem("slingbag"); stow(x, newItem("multitool")); });
  const [s, t] = loaned(st, f);
  const mine = kitOf(s);
  check(mine.length > 0 && mine.every((it) => it.loanOwn === s.id), `what they came with is marked theirs (${mine.map((it) => it.name).join(", ")})`);
  const ownLoc = s.gear.weapon ? `s:${s.id}:weapon` : null;
  if (ownLoc) check(/their own/.test(moveItem(st, ownLoc, `s:${crew(st, h)[0]}:weapon`)) && s.gear.weapon.loanOwn === s.id, "their own weapon cannot be taken off them");
  s.gear.head = null;
  h.armory.push(newItem("milhelmet"));
  const msg = moveItem(st, `armory:${h.id}:list:${h.armory.length - 1}`, `s:${s.id}:head`);
  const helmet = s.gear.head;
  check(helmet && helmet.key === "milhelmet" && helmet.loanOwn == null, `the base adds to their kit: a helmet (${msg || "ok"})`);
  const meds = supItems("meds", 2)[0];
  check(stow(s, meds), "and a pack of meds in their pockets");
  // A path that swapped a piece of theirs into the armory: it goes back onto them.
  const leak = mine.find((it) => it !== s.gear.weapon && it !== s.gear.backpack) || null;
  if (leak) {
    for (const k of Object.keys(s.gear)) if (s.gear[k] === leak) s.gear[k] = null;
    s.pockets = s.pockets.map((x) => (x === leak ? null : x));
    if (!kitOf(s).includes(leak)) { h.armory.push(leak); run(st, 1); check(!h.armory.includes(leak) && kitOf(s).includes(leak), `their ${leak.name} found in the armory goes back on them`); }
    else check(true, "(the piece is still on them)");
  } else check(true, "(nothing spare to move)");
  const meds0 = h.stock.meds || 0;
  for (const x of [s, t]) x.loan.until = st.hour;
  run(st, 2, () => loan.status !== "here");
  const home = M.membersOf(f).find((x) => x.id === s.id);
  check(loan.status === "going" || loan.status === "done", "their time is up: they leave");
  check(h.armory.includes(helmet) && (h.stock.meds || 0) >= meds0 + 2, "the helmet back in the armory, the meds in the stores");
  check(home && mine.every((it) => kitOf(home).includes(it)) && !kitOf(home).includes(helmet), "they take home what they came with, and only that");
  check(kitOf(home).every((it) => it.loanOwn == null) && !h.armory.some((it) => it && it.loanOwn != null), "no marks left once they are home");
  // A team home does not unpack what is theirs.
  const u = makeSurvivor(st);
  u.loan = { fid: f.id, group: f.name, id: -1, since: st.hour, until: st.hour + 99, purpose: "work" };
  const mine2 = supItems("meds", 1)[0], base2 = supItems("meds", 1)[0]; // the same kind: kept apart (itemstack.js canStack)
  mine2.loanOwn = u.id;
  stow(u, mine2); stow(u, base2);
  const n = unpackPerson(st, u, h, { keep: (it) => it.loanOwn === u.id });
  check(n >= 1 && kitOf(u).includes(mine2) && !kitOf(u).includes(base2), "a team home: the base's meds into the stores, theirs stay on them");
}

section("The autopilot runs a base with people on loan");
{
  const { st, h, fs: [f] } = setup(["commune"], { radio: true });
  const { loan } = loanHere(st, f, h, 2, 6);
  const ps = loaned(st, f);
  for (const s of ps) { s.gear.weapon = newItem("steakknife"); s.gear.armor = newItem("leatherjacket"); s.gear.head = null; s.gear.weapon.loanOwn = s.id; s.gear.armor.loanOwn = s.id; }
  const own0 = new Map(ps.map((s) => [s, kitOf(s).filter((it) => it.loanOwn === s.id)]));
  for (let i = 0; i < 6; i++) h.armory.push(newItem("hk416"), newItem("tacvest"), newItem("milhelmet"), newItem("kneeguards"));
  setAutopilot(st, true);
  run(st, 48);
  const still = ps.every((s) => own0.get(s).every((it) => kitOf(s).includes(it)));
  check(still, `their own kit still on them after two days of the governor (${ps.map((s) => `${s.gear.weapon && s.gear.weapon.name}, ${s.gear.armor && s.gear.armor.name}`).join("; ")})`);
  check(!h.armory.some((it) => it && it.loanOwn != null), "none of it in the armory");
  const given = ps.flatMap((s) => kitOf(s).filter((it) => it.loanOwn == null));
  check(given.every((it) => it.loanOwn == null), `what the base handed them is the base's (${given.map((it) => it.name).join(", ") || "nothing yet"})`);
  for (const s of ps) s.loan.until = st.hour;
  run(st, 3, () => loan.status !== "here");
  const back = ps.map((s) => M.membersOf(f).find((x) => x.id === s.id)).filter(Boolean);
  check(back.length === ps.length && back.every((s) => own0.get(s).every((it) => kitOf(s).includes(it)) && kitOf(s).every((it) => !given.includes(it))), "they leave with their own kit only");
  check(given.every((it) => h.armory.includes(it) || (it.dur != null && !kitOf(back[0]).includes(it))), "the base's things back in the armory (or the stores)");
  setAutopilot(st, false);
}

section("Wanting to stay: the card, the request, keeping them, letting them go");
{
  const S0 = { ...L.LOAN.STAY };
  const { st, h, fs: [f] } = setup(["commune"], { radio: true, gw: 75 });
  loanHere(st, f, h, 2, 12);
  const ps = loaned(st, f);
  check(!L.stayCard(st, f).choices.some((c) => /Send a request/.test(c.label)), "nobody wants to stay: no request to send");
  Object.assign(L.LOAN.STAY, { base: 1, max: 1, minDays: 0 });
  run(st, 25, () => st.cards.some((c) => c.loanStay === f.id), envoyCard);
  Object.assign(L.LOAN.STAY, S0);
  const card = st.cards.find((c) => c.loanStay === f.id);
  check(card && /want(s)? to stay with you/.test(card.title) && card.choices.some((c) => /Send a request/.test(c.label)) && card.choices.some((c) => c.label === "Just let them join"), `the card: ${card && card.title} (${card && card.choices.map((c) => c.label).join(" | ")})`);
  const pop0 = f.pop;
  st.cards.splice(st.cards.indexOf(card), 1);
  const txt = card.choices.find((c) => /Send a request/.test(c.label)).resolve(st);
  check(ps.every((s) => !s.loan && s.joinedFrom === f.name && st.survivors.includes(s)) && f.pop === pop0, `by radio, a yes: yours for good (${txt})`);
}
{
  const S0 = { ...L.LOAN.STAY };
  const { st, h, fs: [f] } = setup(["military"], { radio: true, gw: 38 });
  loanHere(st, f, h, 1, 8);
  const [s] = loaned(st, f);
  if (s) {
    Object.assign(L.LOAN.STAY, { base: 1, max: 1, minDays: 0 });
    run(st, 25, () => st.cards.some((c) => c.loanStay === f.id), envoyCard);
    Object.assign(L.LOAN.STAY, S0);
    let card = st.cards.find((c) => c.loanStay === f.id);
    st.cards.splice(st.cards.indexOf(card), 1);
    card.choices.find((c) => /Send a request/.test(c.label)).resolve(st);
    card = st.cards.find((c) => c.loanStay === f.id);
    check(s.loan && s.loan.refused && card && !card.choices.some((c) => /Send a request/.test(c.label)) && card.choices.some((c) => c.label === "Keep them anyway"), `they say no: they go home at the end, unless kept anyway (${card && card.choices.map((c) => c.label).join(" | ")})`);
    const g0 = f.goodwill;
    st.cards.splice(st.cards.indexOf(card), 1);
    const t = card.choices.find((c) => c.label === "Keep them anyway").resolve(st);
    check(!s.loan && s.joinedFrom === f.name && f.goodwill <= g0, `kept anyway: yours, and ${t}`);
  } else check(false, "they lent nobody here");
}
{
  const S0 = { ...L.LOAN.STAY };
  const { st, h, fs: [f] } = setup(["commune"], { gw: 75 });
  loanHere(st, f, h, 1, 14);
  const [s] = loaned(st, f);
  Object.assign(L.LOAN.STAY, { base: 1, max: 1, minDays: 0 });
  run(st, 25, () => st.cards.some((c) => c.loanStay === f.id), envoyCard);
  Object.assign(L.LOAN.STAY, S0);
  const card = st.cards.find((c) => c.loanStay === f.id);
  st.cards.splice(st.cards.indexOf(card), 1);
  const t = card.choices.find((c) => /Send a request/.test(c.label)).resolve(st);
  const m = st.envoys.msgs.find((x) => x.kind === "keep");
  check(m && m.status === "travelling" && s.loan, `no link: your envoy carries the request, nothing yet (${t})`);
  run(st, 24 * 8, () => m.status === "returned", envoyCard);
  check(m.status === "returned" && !s.loan && s.joinedFrom === f.name, "their yes is known when the envoy is home: they stay");
}
{
  const { st, h, fs: [f, g] } = setup(["commune", "military"], { radio: true, gw: 80 });
  g.goodwill = 40;
  const { loan } = loanHere(st, g, h, 1, 8);
  const fake = (grp) => { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); s.loan = { fid: grp.id, group: grp.name, id: -2, since: st.hour - 99, until: st.hour + 999, purpose: "work", wants: day(st) }; return s; };
  for (let i = 0; i < 30; i++) L.justKeep(st, f, [fake(f).id]);
  const S1 = { ...(st.vols.keepStats || {}) };
  check(S1.none >= 20, `a friendly commune mostly lets it pass (${JSON.stringify(S1)})`);
  st.vols.keepStats = { none: 0, hit: 0, recall: 0 };
  check(loan && loan.status === "here", "the military's people on loan too");
  for (let i = 0; i < 30 && loan && loan.status === "here"; i++) { g.goodwill = 40; L.justKeep(st, g, [fake(g).id]); }
  const S2 = st.vols.keepStats;
  check(S2.hit + S2.recall > 0 && S2.recall > 0 && loan && loan.status !== "here", `the military hold it against you, and call their people home (${JSON.stringify(S2)}, the loan ${loan && loan.status})`);
  const s = fake(f); s.loan.id = -3;
  L.stayCard(st, f).choices.find((c) => /home at the loan/.test(c.label)).resolve(st);
  check(s.loan.declined && !L.wantingToStay(st, f).includes(s), "sent home at the loan's end: no more asking");
}

section("Their parties on the road: people, killed by name, robbed, to a base of their choosing");
{
  const { st, h, fs: [f] } = setup(["commune"], { radio: true });
  const pop0 = f.pop;
  E.communicate(st, { fid: f.id, kind: "volunteers", payload: { baseId: h.id, n: 3, days: 5, purpose: "work" } });
  const loan = L.loansOf(st)[0];
  const p = st.parties.find((x) => x.id === loan.partyId);
  const ppl = M.partyPeople(f, p);
  check(ppl.length === 3 && f.pop === pop0 && p.rations, "on the road: three of their members out with the party, rations packed");
  check(roadCaravans(st).some((c) => c.ref === p), "on the road it can be intercepted");
  for (const s of ppl) s.health = 15;
  p.path.slice(1, -1).forEach((t, i) => st.hordes.push({ id: 9e6 + i, tile: t, size: 400, heading: null }));
  run(st, 48, () => !st.parties.includes(p) || ppl.some((s) => !s.alive));
  const dead = ppl.filter((s) => !s.alive);
  check(dead.length > 0 && dead.every((s) => !M.membersOf(f).includes(s)) && f.pop === pop0 - dead.length, `a horde on the way kills them by name (${dead.map((s) => s.name).join(", ")})`);
  // A base of their choosing: one under threat over the nearest.
  st.hordes.length = 0;
  f.bases.push(st.grid.within(f.bases[0], 6).find((t) => free(st, t) && st.grid.distance(t, f.bases[0]) === 5));
  const near = L.baseOfChoice(st, f, f.bases[0]);
  check(near.tile === f.bases[0] && /nearest/.test(near.why), "the nearest base by default");
  st.hordes.push({ id: 9e7, tile: f.bases[1], size: 50, heading: null });
  const thr = L.baseOfChoice(st, f, f.bases[0]);
  check(thr.tile === f.bases[1] && /threat/.test(thr.why), "one under threat when it is close enough");
}

section("An envoy lost out of radio coverage: heard of only when overdue");
{
  const { st, h, fs: [f] } = setup(["traders"]);
  const r = E.communicate(st, { fid: f.id, kind: "news", payload: {}, memberIds: crew(st, h, 2) });
  run(st, 3);
  check(!r.party.radioLive, "out of coverage");
  const names = partyMembers(st, r.party).map((s) => s.name);
  const top = st.log[0];
  for (const s of partyMembers(st, r.party)) killSurvivor(st, s, partyTile(r.party), "in an ambush");
  wipeParty(st, r.party);
  const fresh = st.log.slice(0, st.log.indexOf(top)).map((l) => l.text);
  check(!fresh.some((t) => /whole team was lost|died in an ambush/.test(t)), "no live word: no deaths, no lost team");
  check(!st.markers || !JSON.stringify(st.markers).includes("the lost team"), "no death site marked for it");
  st.hour = r.msg.overdueAt;
  run(st, 1);
  check(E.statusOf(st, r.msg) === "lost" && logHas(st, new RegExp(`No word from our envoy to ${f.name}.*given up for lost`)), `overdue: ${st.log.find((l) => /No word from our envoy/.test(l.text)).text}`);
  void names;
  // In coverage: the radio reports it live.
  const { st: s2, h: h2, fs: [g] } = setup(["traders"], { near: 2, far: 4 });
  addBuilding(h2, "radio"); h2.radio = true;
  const r2 = E.communicate(s2, { fid: g.id, kind: "news", payload: {}, memberIds: crew(s2, h2, 1) });
  run(s2, 3);
  if (r2.party && r2.party.radioLive) {
    for (const s of partyMembers(s2, r2.party)) killSurvivor(s2, s, partyTile(r2.party), "in an ambush");
    wipeParty(s2, r2.party);
    check(logHas(s2, /died in an ambush/) && logHas(s2, /whole team was lost|last of a team died/), "in radio coverage: the deaths and the lost team reported at once");
  } else check(true, `(the envoy is out of coverage here: ${r2.text})`);
}

section("Old saves");
{
  const { st, h, fs: [f] } = setup(["commune"], { radio: true });
  // A loan party of an old save: its people carried on it (p.people), off the group's list.
  E.communicate(st, { fid: f.id, kind: "volunteers", payload: { baseId: h.id, n: 2, days: 4, purpose: "work" } });
  const loan = L.loansOf(st)[0];
  const p = st.parties.find((x) => x.id === loan.partyId);
  const ppl = M.partyPeople(f, p);
  for (const s of ppl) M.removeMember(st, f, s, "on loan");
  p.people = ppl; delete p.rations;
  const back = loadFromString(saveToString(st));
  const L2 = back.vols.baseLoans[0];
  run(back, 24 * 8, () => L2.status === "here");
  const f2 = back.factions.find((x) => x.id === f.id);
  const ps = loaned(back, f2);
  check(L2.status === "here" && ps.length === 2, "an old save's loan party arrives");
  for (const s of ps) { delete s.loan.marked; for (const it of kitOf(s)) delete it.loanOwn; }
  run(back, 1);
  check(ps.every((s) => s.loan.marked && kitOf(s).every((it) => it.loanOwn === s.id)), "people on loan in an old save: what they carry is marked theirs");
  run(back, 24 * 8, () => L2.status === "done");
  check(L2.status === "done" && ps.every((s) => M.membersOf(f2).some((x) => x.id === s.id)), "and they go home as a party like any");
}

section("The same seed, the same story");
{
  const story = () => {
    const S0 = { ...L.LOAN.STAY };
    const { st, h, fs: [f, g] } = setup(["commune", "commune"], { seed: SEED + 4, near: 5, far: 12 });
    E.communicate(st, { fid: f.id, kind: "volunteers", payload: { baseId: h.id, n: 2, days: 8, purpose: "work" }, memberIds: crew(st, h) });
    E.groupWord(st, f, g, "pact");
    Object.assign(L.LOAN.STAY, { base: 0.3, max: 0.3, minDays: 0 });
    run(st, 24 * 16);
    Object.assign(L.LOAN.STAY, S0);
    return JSON.stringify({ l: L.loansOf(st).map((l) => [l.status, l.n, l.arrived, l.stayed || 0]), m: st.envoys.msgs.map((m) => [m.kind, m.status, m.delivered, m.returned]), p: D.pactBetween(st, f, g) });
  };
  const x = story(), y = story();
  check(x === y, `two runs match (${x.slice(0, 160)}…)`);
}

console.log(`\n${failed ? "FAILED" : "passed"}: ${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
