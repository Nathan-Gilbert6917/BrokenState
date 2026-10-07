// Children and generations (sim/family.js): couples forming, expecting (the factors and the hard stops), the late
// weeks' work, birth at a base and on the road, the child (name, parents, a mixed look, traits), children never
// being survivors (teams, jobs, battles, counts), food and beds, mood, growing up into a survivor with the same id,
// a base lost, a child lost, the Children box, the world's dice untouched, save / load mid-pregnancy and an old
// save, the UI (People tab, roster, survivor screen, help) and an autopilot run with a family in it.
// Usage: node tools/familytest.js [seed] [days]
import { createWorld, tickHour, hub, atBase, alive, residents, day, makeSurvivor, removeBase, newId } from "../src/sim/world.js";
import { addBuilding, baseBeds, BUILDINGS } from "../src/sim/buildings.js";
import { getRel, moodFactors, partnerOf, makePartners } from "../src/sim/relations.js";
import { moodWork } from "../src/sim/morale.js";
import { foodUse, mouthsAt } from "../src/sim/upkeep.js";
import { launchExpedition } from "../src/sim/parties.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { SKIN_TONES } from "../src/sim/appearance.js";
import {
  FAMILY, familyDaily, conceiveInfo, birthRisk, childrenOf, childrenAt, stageOf, birthsOn, birthsTotal, loseChild, familyMood,
  familyOfPerson, updateKidBeds,
} from "../src/sim/family.js";
import { renderLeft, renderModal } from "../src/ui/ui.js";
import { rosterModal } from "../src/ui/roster.js";
import { familyBlock, familyChip } from "../src/ui/family.js";
import { helpTopics } from "../src/ui/help.js";

const seed = Number(process.argv[2] || 42);
const longDays = Number(process.argv[3] || 60);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.cards.length = 0; st.started = true; return st; };
const nextDay = (st) => { st.hour += 24; };
const freshUi = () => ({ started: true, speed: 0, tab: "people", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false, scale: 1, armed: { parties: new Map(), builds: new Set(), crafts: new Set() } });
const logHas = (st, re) => st.log.some((l) => re.test(l.text));
// A couple at the hub with everything right: plenty of food, beds, good spirits.
function couple(st) {
  const h = hub(st);
  h.stock.food = 600;
  h.stock.water = 300;
  const [a, b] = atBase(st, h.id);
  a.appearance.facial = "none";
  b.appearance.facial = "beard";
  a.mood = b.mood = 75;
  makePartners(st, a, b);
  return { h, a, b };
}
// Days of familyDaily until pred (or the limit).
function until(st, pred, limit = 600) {
  for (let i = 0; i < limit && !pred(); i++) { nextDay(st); familyDaily(st); }
  return pred();
}
// A child made the quick way: a couple expecting, then due.
function withChild(st) {
  const c = couple(st);
  until(st, () => c.a.expecting || c.b.expecting);
  const mum = c.a.expecting ? c.a : c.b;
  mum.expecting.due = day(st) + 1;
  until(st, () => childrenOf(st).length > 0, 5);
  return { ...c, mum, kid: childrenOf(st)[0] };
}

// ---------------------------------------------------------------------------------------------------------
section("Couples");
{
  const st = W();
  const h = hub(st);
  const [a, b, x] = atBase(st, h.id);
  Object.assign(getRel(st, a, b, true), { o: 80, h: 0 });
  Object.assign(getRel(st, a, x, true), { o: 50, h: 0 });
  check(!partnerOf(st, a), "no partner to begin with");
  check(until(st, () => !!partnerOf(st, a), 1000), "close friends at the same base become a couple");
  check(partnerOf(st, a) === b && !partnerOf(st, x), "with the close friend, not the friend");
  check(logHas(st, /couple now/), "a diary line says so");
  const st2 = W();
  const [c, d] = atBase(st2, hub(st2).id);
  Object.assign(getRel(st2, c, d, true), { o: 80, h: 0 });
  d.location = { kind: "errand", until: 999 };
  until(st2, () => false, 300);
  check(!partnerOf(st2, c), "not while one of them is away from the base");
}

section("Expecting");
{
  const st = W();
  const { h, a, b } = couple(st);
  const info = conceiveInfo(st, a, b, h);
  check(!info.why && info.p > 0 && info.p <= FAMILY.conceive * 1.31, `a chance a day at home (${info.p})`);
  h.alert = true;
  check(conceiveInfo(st, a, b, h).p < info.p * 0.6, "rarer under threat");
  h.alert = false;
  h.rationing = true;
  check(conceiveInfo(st, a, b, h).why && conceiveInfo(st, a, b, h).p === 0, "never on short rations");
  h.rationing = false;
  const food = h.stock.food;
  h.stock.food = 20; h.stock.preserved = 0;
  check(conceiveInfo(st, a, b, h).p === 0, "never under 10 days of food");
  h.stock.food = food;
  const beds = baseBeds(h);
  for (let i = residents(st, h.id).length; i < beds; i++) { const s = makeSurvivor(st, 1); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  check(/bed/.test(conceiveInfo(st, a, b, h).why), "never with no free bed (the cap by housing)");
  for (const s of st.survivors.slice(6)) s.alive = false;
  a.mood = b.mood = 20;
  check(conceiveInfo(st, a, b, h).p === 0, "never when both are very low");
  a.mood = b.mood = 75;
  check(until(st, () => !!(a.expecting || b.expecting)), "a couple at home comes to expect a child");
  const mum = a.expecting ? a : b;
  check(mum === a, "the one with no beard carries");
  check(mum.expecting.due === mum.expecting.since + FAMILY.carry, `due in ${FAMILY.carry} days`);
  check(logHas(st, /expecting a child/), "a diary line");
  check(moodFactors(st, b).list.some((f) => /Expecting/.test(f.label)), "both have it in their mood");
  const w0 = moodWork(mum);
  st.hour = (mum.expecting.due - FAMILY.late - 1) * 24 + 6;
  familyDaily(st);
  check(mum.expecting.late && Math.abs(moodWork(mum) - w0 * FAMILY.lateWork) < 0.01, `the last ${FAMILY.late} days: work ×${FAMILY.lateWork}`);
  const r = getRel(st, a, b);
  check(r.kidDay === mum.expecting.since, "the couple's wait starts");
}

section("Birth and the child");
{
  const st = W();
  const rng0 = st.rng.state;
  const { h, a, b, mum, kid } = withChild(st);
  check(!!kid, "a child is born when due at a base");
  check(st.rng.state === rng0, "the world's dice are untouched");
  check(!mum.expecting && kid.baseId === h.id, "at the base, no longer expecting");
  check(kid.parents.includes(a.id) && kid.parents.includes(b.id), "with both parents");
  check([a, b].some((p) => kid.name.split(" ").slice(1).join(" ") === p.name.split(" ").slice(1).join(" ")), `a parent's surname (${kid.name})`);
  check(!st.survivors.some((s) => s.name.split(" ")[0] === kid.name.split(" ")[0]), "a first name nobody has");
  const ia = SKIN_TONES.indexOf(a.appearance.skin), ib = SKIN_TONES.indexOf(b.appearance.skin), ik = SKIN_TONES.indexOf(kid.appearance.skin);
  check(ik >= Math.min(ia, ib) && ik <= Math.max(ia, ib), "skin between the parents'");
  check(kid.traits.length >= 1 && kid.traits.length <= 2, "one or two traits");
  check(birthsOn(st, day(st)) === 1 && birthsTotal(st) === 1, "births counted (birthsOn, birthsTotal)");
  check(logHas(st, /was born at/), "a diary line");
  check(stageOf(kid) === "baby", "a baby");
  check(moodFactors(st, a).list.some((f) => /their child/.test(f.label)) && moodFactors(st, atBase(st, h.id).find((s) => s !== a && s !== b)).list.some((f) => /Children about/.test(f.label)), "the parents and the base get mood from them");
  // Not a survivor anywhere.
  check(!st.survivors.some((s) => s.id === kid.id) && !alive(st).includes(kid) && !residents(st, h.id).includes(kid), "not among the survivors");
  const res = launchExpedition(st, { dest: h.tile + 1, mission: "scavenge", stance: "normal", memberIds: [kid.id], supplies: {} });
  check(!!res.error, `cannot be sent on a team (${res.error})`);
  check(mouthsAt(st, h).children === 1, "fed at the base");
  const g = foodUse(st, h).groups.find((x) => x.key === "children");
  check(g && Math.abs(g.total - foodUse(st, h).rate * FAMILY.food.baby) < 0.01, "a baby eats a quarter of a ration (upkeep.js foodUse)");
  const f0 = h.stock.food;
  nextDay(st); familyDaily(st);
  check(h.stock.food < f0 && f0 - h.stock.food <= g.total + 0.01, "eaten from the store");
  check(!(h.kidBeds > 0), "a baby sleeps with a parent");
  kid.grown = FAMILY.baby + 1;
  const beds = baseBeds(h);
  updateKidBeds(st);
  check(baseBeds(h) === beds - 1, "a child takes a bed's half (two to a bed)");
  // Chores.
  const f1 = h.stock.food;
  nextDay(st); familyDaily(st);
  check(kid.chores > 0, "a child does chores at a base with fields");
  check(familyBlock(st, a).includes(kid.name.split(" ")[0]) && familyChip(st, a).includes("👪"), "the parent's Family card and chip");
  // Hunger: the parents go without.
  h.stock.food = 0; h.stock.preserved = 0;
  const hu = a.hunger;
  const gr = kid.grown;
  nextDay(st); familyDaily(st);
  check(a.hunger < hu && kid.grown === gr + 1, "with nothing in store the parents go hungry, the child still grows");
  void f1;
}

section("Growing up");
{
  const st = W();
  const { h, a, b, kid } = withChild(st);
  h.stock.food = 600;
  kid.grown = FAMILY.adult - 1;
  kid.seen = { mechanics: 50, medicine: 20 };
  kid.chores = 10;
  const rng0 = st.rng.state, n0 = st.survivors.length, made = st.peopleMade;
  nextDay(st); familyDaily(st);
  const s = st.survivors.find((x) => x.id === kid.id);
  check(!!s && st.survivors.length === n0 + 1 && !childrenOf(st).length, "a child grows up into a survivor with the same id");
  check(s && s.alive && s.location.kind === "base" && s.location.baseId === h.id && s.name === kid.name, "at their base, with their name");
  check(s && s.parents.includes(a.id) && s.joined === kid.bornDay, "parents and the day they were born");
  check(s && Object.values(s.skills).every((v) => v >= 0 && v <= 12), "low skills");
  check(s && s.skills.mechanics >= 3 && s.skills.farming >= 2, "nudged by the work they saw and the chores");
  check(st.rng.state === rng0 && st.peopleMade === made, "the world's dice and faces untouched");
  check(logHas(st, /has grown up/), "a diary line");
  check(getRel(st, s, a).o >= 55, "close to their parents");
  check(familyOfPerson(st, a).grown.includes(s), "their parents list them as grown up");
  check(residents(st, h.id).includes(s), "and works like anyone");
}

section("A base lost, a child lost, the box off");
{
  const st = W();
  const { h, a, kid } = withChild(st);
  const out = { id: newId(), tile: h.tile + 2, type: "outpost", name: "Test Outpost", stock: { food: 50, water: 30 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(out);
  kid.baseId = out.id;
  removeBase(st, out, "was overrun");
  nextDay(st); familyDaily(st);
  check(kid.baseId === h.id || !childrenOf(st).includes(kid), "a lost base's child is brought to the nearest base (or lost in the flight)");
  const st2 = W();
  const w = withChild(st2);
  const m0 = w.a.mood;
  loseChild(st2, w.kid, `${w.kid.name} died.`);
  check(!childrenOf(st2).length && w.a.grief && w.a.mood < m0, "losing a child: grief and mood for the parents");
  const st3 = W();
  st3.childrenOff = true;
  const c = couple(st3);
  Object.assign(getRel(st3, c.a, atBase(st3, c.h.id)[2], true), { o: 90 });
  until(st3, () => false, 400);
  check(!c.a.expecting && !c.b.expecting && !childrenOf(st3).length, "Children off: nobody expects");
  check(!partnerOf(st3, atBase(st3, c.h.id)[2]), "Children off: no couples form on their own");
  const st4 = W();
  const c4 = couple(st4);
  until(st4, () => c4.a.expecting || c4.b.expecting);
  const mum = c4.a.expecting ? c4.a : c4.b;
  mum.location = { kind: "party", partyId: -1 };
  st4.hour = (mum.expecting.due + 1) * 24;
  familyDaily(st4);
  check(mum.expecting && !childrenOf(st4).length, "away from a base: born when back");
  st4.hour = (mum.expecting.due + FAMILY.overdueAway + 1) * 24;
  familyDaily(st4);
  check(!mum.expecting && childrenOf(st4).length === 1 && childrenOf(st4)[0].baseId === c4.h.id, "after a week overdue: born on the road and brought to a base");
  const r = birthRisk(st4, c4.h, mum);
  addBuilding(c4.h, Object.keys(BUILDINGS).find((k) => BUILDINGS[k].family === "hospital" && BUILDINGS[k].tier === 1));
  atBase(st4, c4.h.id).find((s) => s !== mum).skills.medicine = 12;
  const r2 = birthRisk(st4, c4.h, mum);
  check(r2.hard < r.hard && r2.loss === 0, `a medic and a hospital make it safer (${r.hard} → ${r2.hard}, loss ${r.loss.toFixed(3)} → ${r2.loss})`);
}

section("Save and load");
{
  const st = W();
  const { h, kid } = withChild(st);
  const m = atBase(st, h.id).find((s) => !kid.parents.includes(s.id) && s.alive);
  m.expecting = { with: kid.parents[0], since: day(st), due: day(st) + 20, late: false };
  const s2 = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const m2 = s2.survivors.find((s) => s.id === m.id);
  check(m2.expecting && m2.expecting.due === m.expecting.due, "mid-pregnancy survives a save");
  check(childrenOf(s2).length === 1 && childrenOf(s2)[0].name === kid.name && childrenAt(s2, h.id).length === 1, "children survive a save");
  check(s2.family.rng.next() === st.family.rng.next(), "the family's dice go on as before");
  check(birthsTotal(s2) === 1, "the births count");
  const old = W();
  delete old.children; delete old.family;
  const o2 = deserializeState(JSON.parse(JSON.stringify(serializeState(old))));
  let ok = true;
  try { for (let i = 0; i < 48; i++) tickHour(o2); familyMood(o2, o2.survivors[0], hub(o2)); } catch (e) { ok = false; console.log(e.stack); }
  check(ok && Array.isArray(o2.children), "an old save (no children, no family) loads and plays");
}

section("UI");
{
  const st = W();
  const { a, kid } = withChild(st);
  const ui = freshUi();
  const left = renderLeft(st, ui);
  check(left.includes(kid.name) && left.includes("🍼"), "the People tab lists the child with a stage icon");
  ui.roster = true;
  const ro = rosterModal(st, ui);
  check(ro.includes("Children (1)") && ro.includes(kid.name), "the roster's Children table");
  ui.roster = null;
  ui.survivor = a.id;
  const sv = renderModal(st, ui) || "";
  check(sv.includes("Family") && sv.includes("Partner") && sv.includes(kid.name), "the survivor screen's Family card");
  check(!/undefined|NaN/.test(left + ro + sv), "no undefined or NaN");
  check(helpTopics().some((t) => t.title === "Children and families"), "a Help topic");
}

section(`Autopilot with a family (${longDays} days)`);
{
  const st = W(seed + 1);
  setAutopilot(st, true, "balanced");
  const { mum } = withChild(st);
  st.hour = Math.floor(st.hour / 24) * 24 + 6;
  const other = atBase(st, hub(st).id).find((s) => s !== mum && !childrenOf(st)[0].parents.includes(s.id));
  void other;
  childrenOf(st)[0].grown = FAMILY.adult - 20;
  const ids = () => new Set(childrenOf(st).map((c) => c.id));
  let crash = null, onTeam = 0, nan = 0;
  try {
    for (let h = 0; h < longDays * 24 && !st.gameOver; h++) {
      tickHour(st);
      const kids = ids();
      for (const p of st.parties) if (p.owner === "player" && (p.members || []).some((id) => kids.has(id))) onTeam++;
      if (st.combat && (st.combat.units || []).some((u) => kids.has(u.sid ?? u.survivorId ?? u.id))) onTeam++;
      for (const b of st.bases) for (const k of Object.keys(b.stock)) if (!Number.isFinite(b.stock[k])) nan++;
    }
  } catch (e) { crash = e.stack.split("\n").slice(0, 4).join(" | "); }
  check(!crash, `no crash${crash ? `: ${crash}` : ""}`);
  check(onTeam === 0, "no child on a team or in a battle");
  check(nan === 0, "no NaN in the stores");
  check(st.family.grown >= 1 || st.gameOver, "the child grew up during the run");
  console.log(`  day ${day(st)}: ${alive(st).length} alive, ${childrenOf(st).length} children, ${birthsTotal(st)} births, ${st.family.grown} grown up`);
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
