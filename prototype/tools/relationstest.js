// Relationships, grief, the service record, the memorial wall and mood that matters (sim/relations.js, morale.js
// moodWork): opinion drift and thresholds, partners, grief on a death, the record's counters and moments, memorial
// entries and services, the mood → work curve, breaks near the bottom, the new mood sources (and that the
// breakdown adds up to what is applied), hub events and road events that read relationships, combat aim and the
// autopilot's crews, determinism, a render check of the survivor screen and the memorial wall, and a long
// autopilot run without NaN.
// Usage: node tools/relationstest.js [seed] [days]
//   BS_QUICK=1 in the environment (runtests.js --quick): the same checks on less: the autopilot run 60 days (unless
//   [days] is given) and the determinism pair 20 days each.
import { eatFromStore } from "../src/sim/storage.js";
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, alive, residents, day, makeSurvivor, killSurvivor } from "../src/sim/world.js";
import { addBuilding, buildRate, BUILDINGS } from "../src/sim/buildings.js";
import { workFactor } from "../src/sim/health.js";
import { spendMedicTime } from "../src/sim/medical.js";
import { farmOf, farmLabour } from "../src/sim/farming.js";
import { moodCurve, moodWork, MOOD_WORK } from "../src/sim/morale.js";
import { HUB_EVENT_IDS, hubEventCard, hubEventWeights } from "../src/sim/hubevents.js";
import { setAutopilot, housingAI } from "../src/sim/autopilot.js";
import { newItem } from "../src/sim/inventory.js";
import { weatherOnDay } from "../src/sim/weather.js";
import { Rng } from "../src/sim/rng.js";
import { GEAR } from "../src/sim/data.js";
import { woodNeed } from "../src/sim/woodcutting.js"; // the coming cold's wood a big build leaves (the common room check)
import { WHY_ACTIONS } from "../src/ui/causes.js"; // the "Why?" link on the memorial wall
import { BOND } from "../src/sim/bonds.js"; // bonds: a close friend grieves longer, a friend who walks out is missed
import {
  getRel, opinion, relKind, relationsDaily, moodFactors, noteMeals, onDeath, memorialList, holdMemorial, memorialInfo, memorialWeight,
  battleRecord, tripDone, noteSearch, noteRescue, rec, friendAim, teamSpirit, friendlyCrew, quarrelPair, couplePair, makePartners,
  argumentWeight, friendsOf, rivalsOf, partnerOf, bond, compat, survivorSummary, makePeace, peaceInfo, REL, GRIEF, BREAK, MOODF, MEMORIAL, COMBAT,
} from "../src/sim/relations.js";

const QUICK = !!process.env.BS_QUICK;
const seed = Number(process.argv[2] || 42);
const longDays = Number(process.argv[3] || (QUICK ? 60 : 200));
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.cards.length = 0; return st; };
const addPerson = (st, base, mood = 60) => { const s = makeSurvivor(st, 1); s.traits = []; s.location = { kind: "base", baseId: base.id }; s.role = "farm"; s.mood = mood; st.survivors.push(s); return s; };
const nextDay = (st) => { st.hour += 24; };
const setO = (st, a, b, o, extra = {}) => Object.assign(getRel(st, a, b, true), { o, h: 0 }, extra);
const factor = (st, s, re) => moodFactors(st, s).list.find((f) => re.test(f.label));
const near = (a, b, e = 0.051) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------------------------------------------------
section("Opinion drift and thresholds");
{
  const st = W();
  const h = hub(st);
  const [a, b] = atBase(st, h.id);
  const r = setO(st, a, b, 0);
  const target = Math.max(-90, Math.min(95, compat(st, a, b).v + REL.leader * 0 + (a.leader || b.leader ? 0 : 0)));
  // Drift toward the target, 5% of the gap a day at a base (plus the leader's pull, if one of them leads).
  const path = [];
  for (let i = 0; i < 40; i++) { nextDay(st); relationsDaily(st); path.push(getRel(st, a, b).o); }
  const end = path[path.length - 1];
  check(Math.abs(end) > 5 && Math.sign(end) === Math.sign(compat(st, a, b).v || 1) || Math.abs(compat(st, a, b).v) < 8, `opinion drifts toward the pair's compatibility (${Math.round(compat(st, a, b).v)} → ${Math.round(end)} after 40 days)`);
  check(r.met === 1 && path.every(finite), "pairs remember the day they met; opinions are numbers");
  // A team drifts faster than a base.
  const s2 = W();
  const h2 = hub(s2);
  const [c, d0, e] = atBase(s2, h2.id).filter((x) => !x.leader);
  const pc = setO(s2, c, d0, 0), pe = setO(s2, c, e, 0);
  // compatibility forced the same for both pairs by a common target: compare relative progress
  const goal = (x, y) => compat(s2, x, y).v;
  e.location = { kind: "errand", baseId: h2.id, until: 999 }; // out of the way
  nextDay(s2); relationsDaily(s2);
  const baseStep = Math.abs(pc.o) / Math.max(1, Math.abs(goal(c, d0)));
  check(baseStep > 0.02 && baseStep < 0.12, `one day at a base moves about 5% of the gap (${(baseStep * 100).toFixed(1)}%, jitter ±0.6)`);
  check(pe.o === 0, "people apart do not drift");
  // Thresholds.
  const st3 = W();
  const [x, y] = atBase(st3, hub(st3).id);
  setO(st3, x, y, REL.friend);
  check(relKind(getRel(st3, x, y)) === "friend" && friendsOf(st3, x).includes(y), `friend at ${REL.friend}+`);
  setO(st3, x, y, REL.close);
  check(relKind(getRel(st3, x, y)) === "close" && near(bond(st3, x, y), REL.close / 100), `close friend at ${REL.close}+, bond = opinion/100`);
  setO(st3, x, y, REL.rival);
  check(relKind(getRel(st3, x, y)) === "rival" && rivalsOf(st3, x).includes(y) && bond(st3, x, y) === 0, `rival at ${REL.rival} or below, no bond`);
  setO(st3, x, y, 10);
  check(relKind(getRel(st3, x, y)) === "known" && bond(st3, x, y) === 0, "in between: they know each other");
  makePartners(st3, x, y);
  check(partnerOf(st3, x) === y && getRel(st3, x, y).o >= REL.partnerFloor && bond(st3, x, y) === 1, "partners: opinion at least 70, bond 1");
  getRel(st3, x, y).o = REL.split - 5; getRel(st3, x, y).h = -60;
  nextDay(st3); relationsDaily(st3);
  check(!partnerOf(st3, x) && st3.log.some((l) => /split up/.test(l.text)), "partners split up below 15");
  // Leader: pairs where the leader is drift toward a higher target.
  const st4 = W();
  const h4 = hub(st4);
  const L = atBase(st4, h4.id).find((s) => s.leader);
  const pair = atBase(st4, h4.id).filter((s) => !s.leader).slice(0, 2);
  setO(st4, pair[0], pair[1], 0);
  L.skills.leadership = 20;
  for (let i = 0; i < 60; i++) { nextDay(st4); relationsDaily(st4); }
  const withLeader = getRel(st4, pair[0], pair[1]).o;
  const st5 = W();
  const h5 = hub(st5);
  atBase(st5, h5.id).find((s) => s.leader).location = { kind: "errand", baseId: h5.id, until: 9999 };
  const pair5 = atBase(st5, h5.id).slice(0, 2);
  setO(st5, pair5[0], pair5[1], 0);
  for (let i = 0; i < 60; i++) { nextDay(st5); relationsDaily(st5); }
  check(withLeader > getRel(st5, pair5[0], pair5[1]).o + 5, `a Leadership-20 leader at the base lifts opinions (${Math.round(getRel(st5, pair5[0], pair5[1]).o)} → ${Math.round(withLeader)})`);
  // How many friends and rivals a hub grows over 60 days (no hardship): a few of each.
  let fr = 0, rv = 0, n = 0;
  const al = atBase(st5, h5.id);
  for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) { n++; const k = relKind(getRel(st5, al[i], al[j])); if (k === "friend" || k === "close") fr++; if (k === "rival") rv++; }
  console.log(`  ${n} pairs after 60 days at the hub: ${fr} friends, ${rv} rivals`);
}

// ---------------------------------------------------------------------------------------------------------
section("Grief on a death, and the memorial wall");
{
  const st = W();
  const h = hub(st);
  const [dead, friend, partner, known, rival] = atBase(st, h.id).filter((s) => !s.leader).concat(atBase(st, h.id).filter((s) => s.leader));
  for (const s of [friend, partner, known, rival]) { s.mood = 70; s.traits = s.traits.filter((t) => t !== "squeamish"); } // (Squeamish takes any death harder: traitstest)
  setO(st, dead, friend, 80);
  makePartners(st, dead, partner);
  setO(st, dead, known, 20);
  setO(st, dead, rival, -50);
  killSurvivor(st, dead, h.tile, "of a fever at the hub");
  const hitF = GRIEF.hit + GRIEF.hitPer * 0.8, hitP = GRIEF.hit + GRIEF.hitPer;
  check(near(friend.mood, 70 - hitF, 0.11), `a friend (opinion 80): mood -${hitF.toFixed(1)} (${friend.mood.toFixed(1)})`);
  check(near(partner.mood, 70 - hitP, 0.11), `the partner: mood -${hitP} (${partner.mood.toFixed(1)})`);
  check(near(known.mood, 70 + GRIEF.acquaint), `someone they knew: ${GRIEF.acquaint}`);
  check(rival.mood === 70, "a rival: no change");
  check(friend.grief && friend.grief.days === Math.round(GRIEF.daysBase + GRIEF.daysPer * 0.8) + BOND.closeGrief && partner.grief.days === GRIEF.daysBase + GRIEF.daysPer + BOND.closeGrief, `grieving: ${friend.grief && friend.grief.days} days (friend), ${partner.grief && partner.grief.days} (partner) (a close friend and a partner ${BOND.closeGrief} days longer: bonds.js)`);
  partner.mood = 60;
  check(near(workFactor(partner), 1 - GRIEF.work, 0.011) && near(moodWork(friend), moodCurve(friend.mood) * (1 - GRIEF.work * 0.8), 0.002), `grief slows work: partner ×${workFactor(partner)}, friend ×${moodWork(friend).toFixed(2)}`);
  const f = factor(st, partner, /Grieving/);
  check(!!f && near(f.v, -(GRIEF.daily + GRIEF.dailyPer)), `grief in the mood breakdown (${f && f.v} a day)`);
  const m = memorialList(st)[0];
  check(m && m.id === dead.id && m.grievedBy.length === 2 && m.partner === partner.name && /fever/.test(m.cause) && m.place === h.name && m.days >= 1, `memorial entry: ${m && `${m.name}, ${m.days} days, ${m.cause}, ${m.place}, grieved by ${m.grievedBy.join(", ")}`}`);
  check(st.log.some((l) => /grieving for/.test(l.text)), "a log line names who grieves");
  // Grief counts down and ends.
  for (let i = 0; i < 12 + BOND.closeGrief; i++) { nextDay(st); relationsDaily(st); }
  check(!friend.grief && !partner.grief, "grief ends after its days");
  // Memorial service: food per person, mood, grief shortened, once a week.
  const s2 = W();
  const h2 = hub(s2);
  const ppl = atBase(s2, h2.id);
  setO(s2, ppl[0], ppl[1], 90);
  killSurvivor(s2, ppl[0], h2.tile, "in a test");
  const g = ppl[1];
  check(memorialWeight(s2, h2) > 0, `the memorial hub event comes after an unmarked death (weight ${memorialWeight(s2, h2).toFixed(2)})`);
  const food0 = food(h2), days0 = g.grief.days, m0 = residents(s2, h2.id).map((s) => s.mood);
  const info = memorialInfo(s2, h2);
  const txt = holdMemorial(s2, h2);
  check(food(h2) === food0 - info.food && info.food === Math.max(2, residents(s2, h2.id).length * MEMORIAL.food), `a service costs ${info.food} food (${txt})`);
  check(residents(s2, h2.id).every((s, i) => near(s.mood, Math.min(100, m0[i] + MEMORIAL.all + (s.grief ? MEMORIAL.grievers : 0)), 0.11)) && g.grief.days === days0 - MEMORIAL.griefDays, "everyone +3, the grieving +8 more and 2 days less grief");
  check(!memorialInfo(s2, h2).ok && /next one/.test(holdMemorial(s2, h2)) && memorialWeight(s2, h2) === 0, "once a week; no memorial event right after a service");
  addBuilding(h2, "chapel");
  s2.hour += 24 * 8;
  const before = g.mood;
  holdMemorial(s2, h2);
  check(g.mood >= Math.min(100, before + MEMORIAL.all + MEMORIAL.chapel) - 0.11, "a chapel lifts a service by 2 more");
  // Deserting friends hurt half as much, grief days at half (bonds.js BOND.leftGrief: "Misses …").
  const s3 = W();
  const h3 = hub(s3);
  const [q, w] = atBase(s3, h3.id).filter((s) => !s.leader);
  setO(s3, q, w, 60); w.mood = 70;
  const { desert } = await import("../src/sim/morale.js");
  desert(s3, h3, q);
  check(near(w.mood, 70 - (GRIEF.hit + GRIEF.hitPer * 0.6) / 2, 0.11) && w.grief && w.grief.left && w.grief.days === Math.round((GRIEF.daysBase + GRIEF.daysPer * 0.6) * BOND.leftGrief) && !memorialList(s3).length, "a friend who walks out: half the grief hit, half the grief days (missed, not mourned), no memorial line");
}

// ---------------------------------------------------------------------------------------------------------
section("Service record and notable moments");
{
  const st = W();
  const h = hub(st);
  const ppl = atBase(st, h.id);
  const [a, b, c] = ppl;
  // A battle played on a map: kills by unit, downed, rescues and treatments.
  const battle = { units: [{ side: "player", sid: a.id }, { side: "player", sid: b.id }], killsBy: { [a.id]: { z: 12, h: 1 } }, downedIds: [b.id], rescuesBy: { [a.id]: [b.id] }, healsBy: { [a.id]: 2 }, place: "Old Mill" };
  battleRecord(st, { handler: "hordeBreakIn", baseId: h.id, enemy: { kind: "zombies", count: 12 }, context: { size: 300 } }, { outcome: "victory", enemiesKilled: 12, survivorsDead: [], survivorsHurt: [b.id] }, battle, [a, b]);
  check(rec(a).killsZ === 12 && rec(a).killsH === 1 && rec(a).rescues === 1 && rec(a).treated === 2 && rec(b).downed === 1, `on the map: kills ${rec(a).killsZ}+${rec(a).killsH}, rescues ${rec(a).rescues}, treated ${rec(a).treated}, downed ${rec(b).downed}`);
  const txt = (s) => (s.moments || []).map((x) => x.t).join(" | ");
  check(/Held the gate during the 300-horde break-in/.test(txt(a)) && /Put down 10 of the dead/.test(txt(a)) && /first time/.test(txt(a)) && /Kept .* alive under fire at Old Mill/.test(txt(a)) && /Went down fighting/.test(txt(b)), `moments: ${txt(a)}`);
  check(getRel(st, a, b).h >= 10, "fighting side by side with someone downed: +10 shared history");
  // By the numbers: the kills spread over the fighters.
  const k0 = ppl.reduce((s, p) => s + rec(p).killsH, 0);
  battleRecord(st, { handler: "conflict", enemy: { kind: "raiders", count: 5, name: "Rust Dogs" } }, { outcome: "victory", enemiesKilled: 5, survivorsDead: [], survivorsHurt: [] }, null, ppl.slice(0, 3));
  check(ppl.reduce((s, p) => s + rec(p).killsH, 0) === k0 + 5, "by the numbers: every kill is credited to someone who fought");
  battleRecord(st, { handler: "hiveAssault", enemy: { kind: "zombies", count: 8 } }, { outcome: "victory", enemiesKilled: 8, survivorsDead: [], survivorsHurt: [] }, null, [c]);
  check(rec(c).hives === 1 && /burn out a hive/.test(txt(c)), "a hive destroyed");
  // Trips, searches, treatments, rescues, buildings, harvests.
  const p = { id: 999, owner: "player", kind: "expedition", members: [a.id, b.id], departed: st.hour - 24 * 11 };
  tripDone(st, p, [a, b], h);
  check(rec(a).trips === 1 && a.rough != null && /11 days out/.test(txt(a)), "a trip home: counted; 10+ days out is a rough trip and a moment");
  noteSearch(st, [a]);
  spendMedicTime(st, h, { s: c }, 1);
  check(rec(a).sites === 1 && rec(c).treated === 1, "a site searched; a treatment given (medical.js spendMedicTime)");
  noteRescue(st, c, { members: [a.id, b.id, c.id] });
  check(rec(a).rescues === 2 && /Brought .* home from captivity/.test(txt(a)), "bringing a captive home counts as a rescue");
  for (const s of ppl) s.role = "farm";
  a.role = "build";
  relationsDaily(st);
  addBuilding(h, "walls");
  nextDay(st); relationsDaily(st);
  check(rec(a).built === 1 && /first building/.test(txt(a)), "a building finished: the builders get it");
  const farmers = atBase(st, h.id).filter((s) => s.role === "farm");
  const hv0 = farmers.map((s) => rec(s).harvested);
  nextDay(st);
  farmOf(st, h).lastHarvest = { day: day(st), food: 60 };
  relationsDaily(st);
  check(farmers.every((s, i) => near(rec(s).harvested, hv0[i] + 60 / farmers.length)), "a harvest is shared by the farmers");
  check(survivorSummary(st, a).record.days >= 1, "days with the group");
}

// ---------------------------------------------------------------------------------------------------------
section("Mood and work");
{
  const pts = [[0, 0.7], [10, 0.75], [20, 0.8], [45, 1], [60, 1], [80, 1], [90, 1.05], [100, 1.1]];
  for (const [m, w] of pts) check(near(moodCurve(m), w, 0.001), `mood ${m}: works at ${Math.round(moodCurve(m) * 100)}%`);
  const st = W();
  const h = hub(st);
  const s = atBase(st, h.id).find((x) => !x.leader);
  s.mood = 0;
  check(near(workFactor(s), 0.7, 0.001), "workFactor (health.js) carries the mood: 70% at rock bottom");
  s.onBreak = true;
  check(workFactor(s) === 0, "on a break: no work that day");
  s.onBreak = false;
  // Builders: build rate scales.
  for (const p of atBase(st, h.id)) p.role = "farm";
  s.role = "build";
  s.mood = 60;
  const r60 = buildRate(st, h);
  s.mood = 100;
  const r100 = buildRate(st, h);
  s.mood = 5;
  const r5 = buildRate(st, h);
  check(near(r100 / r60, 1.1, 0.001) && near(r5 / r60, moodCurve(5), 0.001), `build rate: ×${(r5 / r60).toFixed(2)} at mood 5, ×${(r100 / r60).toFixed(2)} at 100`);
  const lab60 = farmLabour(st, h);
  for (const p of atBase(st, h.id)) if (p.role === "farm") p.mood = 10;
  check(farmLabour(st, h) < lab60, "farm labour drops with mood");
  // Sick and unhappy multiply.
  s.mood = 20;
  s.conditions = [{ key: "cut", sev: 40, days: 1, since: 1, why: "", treatedDay: -99 }];
  const { healthWork } = await import("../src/sim/health.js");
  check(near(workFactor(s), Math.round(healthWork(s) * 0.8 * 100) / 100, 0.001), `sick and unhappy: ${healthWork(s)} × 0.8 = ${workFactor(s)}`);
}

// ---------------------------------------------------------------------------------------------------------
section("Breaks near the bottom");
{
  const kinds = {};
  let breaks = 0, cards = 0, bad = 0, days = 0;
  for (let i = 0; i < 12; i++) {
    const st = W(seed + i);
    const h = hub(st);
    setFood(h, 500);
    const s = atBase(st, h.id).find((x) => !x.leader);
    for (let d = 0; d < 30; d++) {
      nextDay(st);
      s.mood = 4;
      const before = st.log.length;
      relationsDaily(st);
      days++;
      if (s.breaks && s.breaks[s.breaks.length - 1] === day(st)) {
        breaks++;
        if (!(s.moodNotes || []).some((n) => n.d === day(st) && /Let it out/.test(n.label) && n.v >= BREAK.relief - 0.01)) bad++;
        if (st.log.length === before) bad++;
      }
      while (st.cards.length) { if (st.cards[0].breakFor === s.id) cards++; st.cards.shift(); }
    }
    for (const [k, v] of Object.entries((st.relStats || {}).breaks || {})) kinds[k] = (kinds[k] || 0) + v;
  }
  console.log(`  ${breaks} breaks in ${days} days at mood 4: ${JSON.stringify(kinds)}, ${cards} cards`);
  const p = BREAK.base + BREAK.per * (BREAK.at - 4);
  check(breaks > 0 && breaks <= days / BREAK.cooldown + 1, `breaks happen at mood 4 (${p * 100}% a day), at most one per ${BREAK.cooldown} days`);
  check(Object.keys(kinds).length >= 3, "several kinds of break (sits out, wanders, binge eats, picks a fight)");
  check(bad === 0, "every break logs a line and lifts mood by 8 afterwards");
  check(cards > 0, "a card for the worst cases (a fight, or a second break within 10 days)");
  // Above the line: none.
  const st = W();
  const s = atBase(st, hub(st).id)[0];
  let none = true;
  for (let d = 0; d < 60; d++) { nextDay(st); s.mood = BREAK.at + 4; relationsDaily(st); if (s.breaks) none = false; }
  check(none, `no breaks above ${BREAK.at} (mood ${BREAK.at + 4} each morning)`);
}

// ---------------------------------------------------------------------------------------------------------
section("New mood sources, and the breakdown adds up");
{
  const st = W();
  const h = hub(st);
  const s = atBase(st, h.id).find((x) => !x.leader);
  s.mood = 50;
  // Preserved food only.
  setFood(h, 0); setJarred(h, 200);
  const hourM = st.hour;
  const eatDay = () => { st.hour += 24; eatFromStore(h, 6, st); noteMeals(st, h); }; // a day's meals (storage.js base.ate), then the note
  for (let i = 0; i < 7; i++) eatDay();
  check(factor(st, s, /Nothing fresh to eat for 7 days/)?.v === MOODF.preserved7, "7 days of nothing but preserved food: -1");
  for (let i = 0; i < 14; i++) eatDay();
  check(factor(st, s, /Nothing fresh to eat for 21 days/)?.v === MOODF.preserved21, "21 days: -2");
  setFood(h, 30, "f_potatoes"); eatDay();
  check(!factor(st, s, /Nothing fresh/), "fresh food again: gone");
  st.hour = hourM; delete h.ate;
  addBuilding(h, "kitchen");
  check(!factor(st, s, /Hot meals/), "a preserving room: no hot meals (only the Kitchen serves them, kitchen-plus)");
  addBuilding(h, "common_room");
  check(factor(st, s, /Common room/)?.v === MOODF.common, "a common room: +1.5");
  while (residents(st, h.id).length < 30) addPerson(st, h, 50);
  check(near(factor(st, s, /Common room/)?.v, MOODF.common * 15 / 30), `a common room for 30 people: +${factor(st, s, /Common room/)?.v}`);
  addBuilding(h, "chapel");
  check(factor(st, s, /chapel/)?.v === MOODF.chapel, "a chapel: +1");
  check(!!BUILDINGS.common_room && !!BUILDINGS.chapel && !BUILDINGS.common_room.station && !BUILDINGS.chapel.station, "both need no operator");
  // Comfort: books. The shelf is shared (each book goes round MOODF.shelfShare people); blueprints are not comfort.
  const bookKey = Object.keys(GEAR).find((k) => GEAR[k].book);
  if (bookKey) {
    const bpKey = Object.keys(GEAR).find((k) => GEAR[k].blueprint);
    if (bpKey) { h.armory.push(newItem(bpKey), newItem(bpKey), newItem(bpKey), newItem(bpKey)); check(!factor(st, s, /Something to read/), `blueprints on the shelf (${GEAR[bpKey].name}) are study, not comfort`); }
    const n = residents(st, h.id).length;
    h.armory.push(newItem(bookKey), newItem(bookKey), newItem(bookKey));
    const thin = MOODF.comfortPer * 2 * Math.min(1, (3 * MOODF.shelfShare) / n);
    check(near(factor(st, s, /Something to read/)?.v, thin), `3 books on the shelf for ${n} people: shared, +${factor(st, s, /Something to read/)?.v} (${thin.toFixed(2)})`);
    while (h.armory.filter((g) => g.key === bookKey).length * MOODF.shelfShare < n) h.armory.push(newItem(bookKey));
    check(factor(st, s, /Something to read/)?.v === MOODF.comfortMax, `enough books on the shelf (${GEAR[bookKey].name}) for ${n} people: +${MOODF.comfortMax} at most`);
  } else console.log("  (no books in GEAR yet: comfort items not tested)");
  // Weather: cabin fever late in winter; grey days.
  const hour0 = st.hour;
  st.hour = 91 * 24 + 12; // winter, day 22
  check(factor(st, s, /Cabin fever/)?.v === MOODF.winter21, "day 22 of winter: cabin fever -1");
  st.hour = 86 * 24 + 12; // winter, day 17
  check(factor(st, s, /Cabin fever/)?.v === MOODF.winter14, "day 17 of winter: -0.5");
  let grey = null;
  for (let d = 4; d < 300 && grey == null; d++) if ([d, d - 1, d - 2].every((k) => ["rain", "fog", "storm", "snow", "blizzard", "overcast"].includes(weatherOnDay(st, k).key))) grey = d;
  if (grey) { st.hour = (grey - 1) * 24 + 12; check(factor(st, s, /grey days/)?.v === MOODF.gloom, `3 grey days in a row (day ${grey}): -0.5`); }
  st.hour = hour0;
  // People around.
  const others = atBase(st, h.id).filter((x) => x !== s);
  for (const o of others) setO(st, s, o, 0);
  setO(st, s, others[0], 50); setO(st, s, others[1], 50); setO(st, s, others[2], 50); setO(st, s, others[3], 50);
  check(factor(st, s, /friends close by/)?.v === MOODF.friendMax, "4 friends close by: +1.2 (the cap)");
  setO(st, s, others[4], -40);
  check(factor(st, s, /rival close by/)?.v === MOODF.rival, "a rival close by: -0.6");
  makePartners(st, s, others[5]);
  check(factor(st, s, /partner/)?.v === MOODF.partner, "with their partner: +1.5");
  others[5].location = { kind: "errand", baseId: h.id, until: 999 };
  check(factor(st, s, /Misses/)?.v === MOODF.partnerAway, "partner away: -0.5");
  // Rough trip.
  s.rough = day(st) + 2;
  check(factor(st, s, /Shaken/)?.v === MOODF.rough, "after a rough trip: -1 a day");
  s.role = "rest";
  check(factor(st, s, /Resting after a rough trip/)?.v === MOODF.roughRest, "resting after it: +3 a day");
  // Fade.
  s.mood = 90;
  check(near(factor(st, s, /fade/)?.v, -MOODF.fade * 40), "high spirits fade: -10% of the mood above 50");
  s.mood = 50;
  check(!factor(st, s, /fade/), "no fade at 50 or below");
  // What relationsDaily applies is exactly the breakdown's own part.
  s.role = "farm"; s.mood = 60;
  const f0 = moodFactors(st, s);
  const m0 = s.mood;
  for (const o of others) { const r = getRel(st, s, o); if (r) r.o = r.o >= 40 ? 60 : r.o <= -30 ? -60 : 0; }
  nextDay(st); relationsDaily(st);
  check(near(s.mood - m0, f0.own, 0.11), `relationsDaily applies the breakdown's own factors (${f0.own}, mood ${m0} → ${s.mood.toFixed(1)})`);
  const all = moodFactors(st, s);
  check(all.list.some((x) => !x.own && /bed/.test(x.label)) && all.list.some((x) => !x.own && /Fed/.test(x.label)), "the breakdown lists the factors applied elsewhere too (beds, food)");
  check(all.list.every((x) => finite(x.v) && x.label), "every factor has a label and a number");
}

// ---------------------------------------------------------------------------------------------------------
section("Hub events, road events, combat and crews");
{
  const st = W();
  const h = hub(st);
  while (atBase(st, h.id).length < 10) addPerson(st, h, 60);
  const pool = atBase(st, h.id).filter((s) => !s.leader);
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) setO(st, pool[i], pool[j], 0);
  setO(st, pool[0], pool[1], -60);
  const w0 = hubEventWeights(st, h);
  setO(st, pool[2], pool[3], -50);
  const w1 = hubEventWeights(st, h);
  check(w1.quarrel > w0.quarrel, `more rivals, more quarrels (${w0.quarrel.toFixed(2)} → ${w1.quarrel.toFixed(2)})`);
  const rng = new Rng(7);
  let rivalPicks = 0;
  for (let i = 0; i < 400; i++) { const [a, b] = quarrelPair(st, rng, pool); if (relKind(getRel(st, a, b)) === "rival") rivalPicks++; }
  check(rivalPicks > 400 * 0.6, `a quarrel is between rivals most of the time (${rivalPicks} of 400)`);
  const card = hubEventCard(st, "quarrel", h);
  const [qa, qb] = card.text.match(/^(.*?) and (.*?) are/).slice(1).map((n) => st.survivors.find((s) => s.name === n));
  const o0 = opinion(st, qa, qb);
  card.choices[0].resolve(st);
  check(opinion(st, qa, qb) < o0, "siding with one makes it worse between them");
  // Couples: the closest friends.
  setO(st, pool[4], pool[5], 85);
  const [ca, cb] = couplePair(st, new Rng(3), pool);
  check([ca, cb].includes(pool[4]) && [ca, cb].includes(pool[5]), "two survivors grow close: the closest friends");
  const cc = hubEventCard(st, "couple", h);
  cc.choices[2].resolve(st);
  const named = cc.text.match(/^(.*?) and (.*?) have/).slice(1).map((n) => st.survivors.find((s) => s.name === n));
  check(partnerOf(st, named[0]) === named[1], "the couple event makes them partners");
  check(HUB_EVENT_IDS.includes("memorial"), "the memorial is a hub event");
  // Road: arguments by rivals, stories by friends.
  const p = { members: [pool[0].id, pool[1].id] };
  pool[0].location = pool[1].location = { kind: "party", partyId: -1 };
  const { partyMembers } = await import("../src/sim/parties.js");
  check(argumentWeight(st, p) === 5, "rivals on a team: arguments weigh 5 (else 2, a team of friends 1)");
  pool[0].location = pool[1].location = { kind: "base", baseId: h.id };
  // Combat.
  const team = pool.slice(4, 8);
  for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) setO(st, team[i], team[j], 0);
  setO(st, team[0], team[1], 60); setO(st, team[0], team[2], 60); setO(st, team[0], team[3], -60);
  const aim = friendAim(st, team, { enemy: { kind: "raiders" } });
  check(aim[team[0].id] === Math.min(COMBAT.friendAimMax, 2 * COMBAT.friendAim) + COMBAT.rivalAim && aim[team[1].id] === COMBAT.friendAim, `aim: two friends and a rival ${aim[team[0].id]}, one friend +${aim[team[1].id]}`);
  check(near(teamSpirit(st, team), 1 + COMBAT.spirit * (2 - 1), 0.001), `by the numbers: ×${teamSpirit(st, team).toFixed(2)} (2 friend pairs, 1 rival pair)`);
  team[3].revenge = { fid: 5, name: "Ana", foe: "Rust Dogs", until: 999 };
  check(friendAim(st, team, { enemy: { factionId: 5 } })[team[3].id] === COMBAT.rivalAim + COMBAT.revengeAim, "revenge: +5 aim against the group that killed a friend");
  // Autopilot crews: among near-equal picks, friends go together and rivals stay apart.
  const fit = () => 5;
  const crew = friendlyCrew(st, [team[0], team[3], team[1], team[2]], 3, fit);
  check(crew.includes(team[1]) && crew.includes(team[2]) && !crew.includes(team[3]), "the autopilot's crew: friends together, the rival stays home");
  const fit2 = (s) => (s === team[3] ? 20 : 5);
  check(friendlyCrew(st, [team[3], team[0], team[1], team[2]], 2, fit2).includes(team[3]), "but a much better fit still goes");
  // Making peace on the survivor screen.
  const [ra, rb] = [pool[0], pool[1]];
  const pi = peaceInfo(st, ra, rb);
  const o1 = opinion(st, ra, rb), f1 = food(h);
  const msg = makePeace(st, ra, rb, "gift");
  check(pi.ok && food(h) === f1 - 3 && opinion(st, ra, rb) > o1 && !peaceInfo(st, ra, rb).ok, `a shared meal: 3 food, better opinion, then a 10-day wait (${msg})`);
}

// ---------------------------------------------------------------------------------------------------------
section("Hub event choices (memorial)");
{
  const fresh = () => {
    const s2 = W(seed + 3);
    const hb = hub(s2);
    while (atBase(s2, hb.id).length < 8) addPerson(s2, hb, 50);
    Object.assign(hb.stock, { water: 60, scrap: 40 }); setFood(hb, 150);
    const v = atBase(s2, hb.id)[1];
    setO(s2, v, atBase(s2, hb.id)[2], 80);
    killSurvivor(s2, v, hb.tile, "in a test");
    return { s2, hb };
  };
  const probe = fresh();
  const card0 = hubEventCard(probe.s2, "memorial", probe.hb);
  for (let i = 0; i < card0.choices.length; i++) {
    const { s2, hb } = fresh();
    const card = hubEventCard(s2, "memorial", hb);
    const c = card.choices[i];
    const snap = () => JSON.stringify([food(hb), residents(s2, hb.id).map((s) => Math.round(s.mood * 10))]);
    const before = snap();
    const text = c.resolve(s2);
    check(typeof c.ai === "function" && typeof text === "string" && !/undefined|NaN/.test(text) && snap() !== before, `memorial → ${c.label}: ${text}`);
  }
}

// ---------------------------------------------------------------------------------------------------------
section("Render: survivor screen and memorial wall");
{
  let ui;
  try { ui = await import("../src/ui/relations.js"); } catch (e) { console.log(`  (UI module not loadable headless: ${e.message})`); }
  if (ui) {
    const st = W();
    const h = hub(st);
    addBuilding(h, "walls"); addBuilding(h, "walls"); // a timber palisade: no base has a wall it did not build (buildings.js WALL_TIERS), and this month must leave two people here
    for (let i = 0; i < 30; i++) { for (let k = 0; k < 24; k++) tickHour(st); while (st.cards.length) { const c = st.cards.shift(); const ch = c.choices.find((x) => !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)); if (ch) ch.resolve(st); } }
    const [a, b] = atBase(st, h.id);
    setO(st, a, b, -50);
    killSurvivor(st, atBase(st, h.id).slice(-1)[0], h.tile, "in a test");
    const dead = st.survivors.find((s) => !s.alive);
    const uiState = { memorial: { baseId: h.id }, relMsg: "" };
    const html = [ui.relationsSection(st, a, uiState), ui.relationsSection(st, dead, uiState), ui.relChip(st, a), ui.moodTipText(st, a), ui.memorialModal(st, uiState), ui.memorialButton(st, h)].join("\n");
    check(!/undefined|NaN|\[object/.test(html), "no undefined / NaN in the survivor screen, chips, mood tooltip and memorial wall");
    const acts = [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
    const known = new Set([...Object.keys(ui.REL_ACTIONS), ...Object.keys(WHY_ACTIONS), "survivor"]);
    const missing = [...new Set(acts)].filter((x) => !known.has(x));
    check(acts.length > 0 && !missing.length, `every data-action has a handler (${[...new Set(acts)].join(", ")})${missing.length ? ` missing: ${missing}` : ""}`);
    const opens = (html.match(/<div/g) || []).length, closes = (html.match(/<\/div>/g) || []).length;
    check(opens === closes, `balanced divs (${opens}/${closes})`);
    const r = { ...uiState };
    ui.REL_ACTIONS["rel-gift"](st, r, { id: a.id, other: b.id });
    ui.REL_ACTIONS["memorial-service"](st, r, { base: h.id });
    check(typeof r.relMsg === "string" && r.relMsg && typeof r.memorialMsg === "string" && r.memorialMsg, `handlers answer: "${r.relMsg}" / "${r.memorialMsg}"`);
  }
}

// ---------------------------------------------------------------------------------------------------------
section("Where mood settles: the fade against the daily factors");
{
  // The whole daily net (every factor, the fade included) applied day after day until it levels out.
  const settle = (st, s) => { for (let i = 0; i < 150; i++) s.mood = Math.max(0, Math.min(100, s.mood + moodFactors(st, s).net)); return s.mood; };
  const st = W();
  const h = hub(st);
  addBuilding(h, "bunkhouse"); // a bed each (the hub starts bare: barestart)
  const ppl = atBase(st, h.id);
  h.armory = [];
  for (const a of ppl) { a.perks = []; for (const b of ppl) if (a !== b) setO(st, a, b, 0); }
  for (const a of ppl) if (a.leader) a.skills.leadership = 5; // an ordinary leader (a great one lifts it more)
  const s = ppl.find((x) => !x.leader);
  s.mood = 50;
  const plain = settle(st, s);
  const why = moodFactors(st, s).list.filter((f) => !/fade/.test(f.label)).map((f) => `${f.label} ${f.v > 0 ? "+" : ""}${f.v}`).join(", ");
  check(plain >= 70 && plain <= 82, `a hub with only beds and food settles at ${plain.toFixed(0)} (70-80: ${why})`);
  addBuilding(h, "kitchen"); addBuilding(h, "common_room");
  for (const o of ppl.filter((o) => o !== s).slice(0, 3)) setO(st, s, o, 50);
  const comfy = settle(st, s);
  console.log(`  settles at ${plain.toFixed(0)} with beds, food and an ordinary leader (${why}); ${comfy.toFixed(0)} with a kitchen, a common room and friends`);
  check(comfy >= 95, `with a kitchen, a common room and three friends: ${comfy.toFixed(0)} (near 100)`);
}

// ---------------------------------------------------------------------------------------------------------
section(`Determinism, and ${longDays} days on autopilot without NaN`);
{
  const run = (days, style = "balanced", s0 = seed) => {
    const st = createWorld({ seed: s0, factionCount: 8 });
    st.started = true;
    setAutopilot(st, true, style);
    let bad = null;
    while (day(st) <= days && !st.gameOver) {
      tickHour(st);
      if (st.hour % 24 === 1) {
        for (const s of st.survivors) {
          if (!s.alive) continue;
          if (!finite(s.mood) || s.mood < 0 || s.mood > 100) bad = `${s.name} mood ${s.mood}`;
          const r = s.rec || {};
          for (const v of Object.values(r)) if (!finite(v)) bad = `${s.name} record ${JSON.stringify(r)}`;
          if (!finite(workFactor(s))) bad = `${s.name} work ${workFactor(s)}`;
        }
        for (const r of Object.values(st.rel || {})) if (!finite(r.o) || !finite(r.h)) bad = `opinion ${JSON.stringify(r)}`;
      }
      if (bad) break;
    }
    return { st, bad };
  };
  const sig = (st) => JSON.stringify([st.survivors.map((s) => [s.rk, Math.round(s.mood * 100), s.alive, s.rec]), Object.values(st.rel || {}).map((r) => Math.round(r.o * 100)).sort((x, y) => x - y), memorialList(st).map((m) => [m.name, m.died])]);
  const detDays = QUICK ? 20 : 60;
  const r1 = run(detDays), r2 = run(detDays);
  check(sig(r1.st) === sig(r2.st), `same seed, same relationships, moods, records and memorial (${detDays} days, twice)`);
  const t0 = performance.now();
  const L = run(longDays);
  const st = L.st;
  check(!L.bad, `${longDays} days on autopilot: no NaN or out-of-range mood, opinion, record or work factor${L.bad ? ` (${L.bad})` : ""}`);
  const al = alive(st);
  let fr = 0, rv = 0, pa = 0;
  for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) { const k = relKind(getRel(st, al[i], al[j])); if (k === "friend" || k === "close") fr++; else if (k === "rival") rv++; else if (k === "partner") pa++; }
  const avg = al.length ? al.reduce((a, s) => a + s.mood, 0) / al.length : 0;
  const work = al.length ? al.reduce((a, s) => a + moodWork(s), 0) / al.length : 0;
  const tot = (k) => st.survivors.reduce((a, s) => a + ((s.rec && s.rec[k]) || 0), 0);
  console.log(`  day ${day(st) - 1}${st.gameOver ? " (game over)" : ""}: ${al.length} alive, ${fr} friend pairs, ${rv} rival pairs, ${pa} couples; mood avg ${avg.toFixed(0)}, work ×${work.toFixed(2)}; breaks ${JSON.stringify((st.relStats || {}).breaks || {})}; memorial ${memorialList(st).length} (${memorialList(st).filter((m) => m.honored).length} remembered); grieving now ${al.filter((s) => s.grief).length}`);
  console.log(`  record totals: trips ${tot("trips")}, sites ${tot("sites")}, dead put down ${tot("killsZ")}, people killed ${tot("killsH")}, treated ${tot("treated")}, built ${tot("built")}, harvested ${Math.round(tot("harvested"))}, hives ${tot("hives")}, downed ${tot("downed")}, rescues ${tot("rescues")} (${Math.round(performance.now() - t0)} ms)`);
  check(tot("trips") > 0 && tot("built") > 0 && tot("harvested") > 0, "the long run fills the service record");
  check(memorialList(st).every((m) => m.name && finite(m.died) && finite(m.days) && Array.isArray(m.grievedBy)), "memorial entries are complete");
  // The long run's common room is the governor's call against the run's scrap: it wants one when spirits sag below
  // 75, between 75 and 85 only with 35 scrap to spare, and saves for one at 15+ people behind water, defences, beds and
  // food stores (autopilot.js buildWishes). On a hub that lives at 0-15 scrap (filters for the dry days, spike pits
  // dug again after each horde, bunkhouses, weapons for the newcomers) with spirits in the 90s it never comes, and
  // need not; the governor's rule itself is checked on a set-up hub below.
  const hb = st.bases.find((b) => b.type === "hub");
  const hbHere = hb ? atBase(st, hb.id) : [];
  const hbMood = hbHere.length ? hbHere.reduce((a, s) => a + s.mood, 0) / hbHere.length : 100;
  const hasCommon = !!hb && (hb.buildings.some((b) => b.type === "common_room") || hb.construction.some((c) => c.type === "common_room"));
  // Or the governor wants one and has not the scrap yet (its build list, autopilot.js buildWishes): where a run's
  // spirits and scrap stand on day 200 is the seed's path (after the weapons wave, seed 42: 29 people at mood 68 with
  // 18 scrap, a common room 22; before it 41 at mood 93; over seeds 1-6 the colonies came out the same size, 149 vs
  // 151 people and 215 vs 220 buildings).
  const wantsCommon = !!hb && housingAI.wishes(st, hb).some((w) => w.type === "common_room");
  if (hb && !hasCommon) console.log(`  no common room at day ${longDays}: ${hbHere.length} at the hub, their mood ${hbMood.toFixed(0)}, ${Math.round(hb.stock.scrap || 0)} scrap${wantsCommon ? " (the governor wants one)" : ""}`);
  check(!hb || hasCommon || wantsCommon || al.length < 8 || hbMood >= 75, `a big hub with low spirits has a common room (or one going up, or the governor wants one)${hb && !hasCommon ? ` (none: mood ${hbMood.toFixed(0)})` : ""}`);
  // The rule: a hub of 10 whose spirits stay low (mood held at 60), with the scrap and wood for it, gets a common room within
  // two weeks: behind water, beds, food stores and the infirmary (two building slots), day 9 on seed 42.
  {
    const s2 = createWorld({ seed, factionCount: 8 });
    s2.started = true;
    s2.cards.length = 0;
    const h2 = hub(s2);
    // A set-up hub (the hub starts bare: barestart): what the old start had standing.
    for (const t of ["farm_plot", "farm_plot", "craftbench", "bunkhouse", "walls"]) addBuilding(h2, t);
    while (atBase(s2, h2.id).length < 10) addPerson(s2, h2, 60);
    for (const p of atBase(s2, h2.id)) p.mood = 60;
    Object.assign(h2.stock, { scrap: 400, parts: 40, water: 300, meds: 20 }); setFood(h2, 400);
    setAutopilot(s2, true, "balanced");
    let hours = 0;
    const wants = () => h2.buildings.some((b) => b.type === "common_room") || h2.construction.some((c) => c.type === "common_room");
    // The scrap kept at 400 (and the parts at 40): "with the scrap for it" all the way, so the check is the rule and
    // not a race between the common room and the builds ahead of it for one stock (with newcomers coming in, seed 42
    // can spend the 400 on an infirmary, a field hospital and an ammo bench by day 9 and have none left). The wood the
    // same: the room is 400 of it (woodwork 2026-10-20), and a big wooden build leaves the coming cold's share of the
    // woodpile (autopilot.js keepsWood), so the cold's whole need and the room's wood are kept in.
    const crWood = () => woodNeed(s2, h2).need + BUILDINGS.common_room.cost.wood;
    while (hours < 24 * 14 && !wants() && !s2.gameOver) { for (const p of atBase(s2, h2.id)) p.mood = Math.min(p.mood, 60); h2.stock.scrap = Math.max(h2.stock.scrap || 0, 400); h2.stock.parts = Math.max(h2.stock.parts || 0, 40); h2.stock.wood = Math.max(h2.stock.wood || 0, crWood()); tickHour(s2); hours++; }
    check(wants(), `the autopilot builds a common room once the hub is big enough and spirits are low (10 people at mood 60: ${wants() ? `queued on day ${Math.ceil(hours / 24)}` : "not in 14 days"})`);
  }
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
