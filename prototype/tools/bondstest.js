// Bonds between survivors (sim/bonds.js, sim/bondevents.js on top of sim/relations.js): the named levels and the
// reasons kept for a pair, trait fit, work and mood beside friends and rivals (moodWork, the mood breakdown, the
// activity line), quarrels at work, a crew's load, nerve in a fight, lessons, circles and the left-out, friction and
// shared meals, envy, grief for a close friend and a friend who walked out, a close friend following a deserter, the
// promise card (kept, broken), the scheduler's pull, every bond card (weight, names, default, each answer), the survivor
// screen and the codex, the same seed twice, and a long autopilot run without NaN.
// Usage: node tools/bondstest.js [seed] [days]
import { createWorld, tickHour, hub, atBase, day, makeSurvivor, killSurvivor, alive } from "../src/sim/world.js";
import { getRel, relationsDaily, moodFactors, compat, bumpPair, REL, makePartners } from "../src/sim/relations.js";
import {
  BOND, levelOf, bondLevel, bondReason, noteWhy, coworkers, bondWork, bondCrewMult, bondNerve, lessonBond, cliquesAt,
  bondPull, bondsDaily, bondEffects, notableBonds, bondWorkNote, bondTraitParts,
} from "../src/sim/bonds.js";
import { BOND_EVENTS } from "../src/sim/bondevents.js";
import { HUB_EVENT_IDS, hubEventCard, hubEventWeights } from "../src/sim/hubevents.js";
import { moodWork } from "../src/sim/morale.js";
import { defaultChoice } from "../src/sim/cardrules.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { addBuilding } from "../src/sim/buildings.js";
import { describeActivity } from "../src/sim/activity.js";

const seed = Number(process.argv[2] || 42);
const longDays = Number(process.argv[3] || 75);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 4 }); st.cards.length = 0; return st; };
const nextDay = (st) => { st.hour += 24; };
const setO = (st, a, b, o, extra = {}) => Object.assign(getRel(st, a, b, true), { o, h: 0 }, extra);
const factor = (st, s, re) => moodFactors(st, s).list.find((f) => re.test(f.label));
// A clean hub: the people it has, all farming (Manual), traits off, nobody pinned to anything else.
function hubOf(st, n = 6) {
  const h = hub(st);
  const ppl = atBase(st, h.id);
  while (ppl.length < n) { const s = makeSurvivor(st, 1); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); ppl.push(s); }
  for (const s of ppl) { s.traits = []; s.role = "farm"; s.mood = 60; delete s.work; s.task = null; }
  return { h, ppl };
}
const resolveEach = (st, mk) => { const out = []; const n = mk().choices.length; for (let i = 0; i < n; i++) { const c = mk(); const ch = c.choices[i]; if (ch.disabled && (typeof ch.disabled === "function" ? ch.disabled(st) : ch.disabled)) { out.push(null); continue; } out.push(ch.resolve(st)); } return out; };

// ---------------------------------------------------------------------------------------------------------
section("Levels and reasons");
{
  const st = W();
  const { ppl: [a, b] } = hubOf(st);
  const at = (o) => levelOf({ o });
  check(at(-30) === "rival" && at(-29) === "disliked" && at(-10) === "disliked" && at(-9) === "neutral" && at(14) === "neutral" && at(15) === "friendly" && at(40) === "friend" && at(70) === "close" && levelOf({ o: 0, p: true }) === "partner", "rival ≤ -30, disliked ≤ -10, neutral, friendly 15+, friend 40+, close 70+, partner");
  setO(st, a, b, 50);
  bumpPair(st, a, b, 10, "Fought side by side at the mill");
  bumpPair(st, a, b, 3, "Fought side by side at the mill");
  bumpPair(st, a, b, -4, "A quarrel");
  const r = getRel(st, a, b);
  check(r.why.length === 2 && r.why[0].t === "Fought side by side at the mill" && r.why[0].v === 13, `the same words add up, biggest first (${JSON.stringify(r.why)})`);
  check(/^Fought side by side at the mill \(day \d+\)$/.test(bondReason(st, a, b)), `a friend's reason is the biggest thing for them: "${bondReason(st, a, b)}"`);
  r.o = -40;
  check(bondReason(st, a, b).startsWith("A quarrel"), "a rival's reason is the biggest thing against them");
  for (let i = 0; i < 8; i++) noteWhy(st, r, 1 + i, `thing ${i}`);
  check(r.why.length === BOND.why, `at most ${BOND.why} reasons kept`);
  check(bondLevel(st, a, b) === "rival", "bondLevel reads the pair");
}

section("Trait fit");
{
  const st = W();
  const { ppl: [a, b] } = hubOf(st);
  a.traits = ["vegetarian"]; b.traits = ["cannibal"];
  const c = compat(st, a, b);
  check(c.parts.some(([k, v]) => /Vegetarian and Cannibal/.test(k) && v === -25), "Vegetarian and Cannibal clash in compat (-25)");
  a.traits = ["pessimist"]; b.traits = ["pessimist"];
  check(bondTraitParts(a, b).some(([k, v]) => /Pessimists/.test(k) && v > 0), "two Pessimists get on");
  a.traits = ["diplomatic"]; b.traits = [];
  check(bondTraitParts(a, b).some(([, v]) => v === 5), "Diplomatic smooths it (+5)");
}

section("Work and mood beside friends and rivals");
{
  const st = W();
  const { h, ppl: [a, b, c, d] } = hubOf(st);
  for (const s of [c, d]) s.role = "build";
  setO(st, a, b, 55); setO(st, a, c, 0); setO(st, c, d, -50);
  check(coworkers(st, a).friends.length === 1 && coworkers(st, a).friends[0].o === b, "a and b farm together as friends");
  check(coworkers(st, c).rivals[0] === d, "c and d build together as rivals");
  const w0 = moodWork(a);
  nextDay(st); bondsDaily(st);
  check(Math.abs(bondWork(a) - (1 + BOND.work.friend)) < 1e-9 && Math.abs(moodWork(a) / w0 - bondWork(a)) < 0.01, `work +${BOND.work.friend * 100}% beside a friend (bondWork ${bondWork(a)}, moodWork ${w0} → ${moodWork(a)})`);
  check(bondWork(c) === 1, "no work bonus beside a rival");
  setO(st, a, b, 80);
  delete st.bondDay; bondsDaily(st);
  check(Math.abs(bondWork(a) - (1 + BOND.work.close)) < 1e-9, "a close friend: +8%");
  const f = factor(st, a, /fields with .+ \(friend\)/);
  check(f && f.v === BOND.mood.friend && f.own && /work \+8%/.test(f.label), `mood factor "${f && f.label}" ${f && f.v}`);
  const fr = factor(st, c, /\(rival\)/);
  check(fr && fr.v === BOND.mood.rival && /quarrels likely/.test(fr.label), `the rival line "${fr && fr.label}" ${fr && fr.v}`);
  check(/Beside .+ \(friend\): work \+8%/.test(bondWorkNote(st, a)), `the activity line's why: "${bondWorkNote(st, a)}"`);
  const act = describeActivity(st, a, 10);
  check(act.kind !== "work" || /Beside/.test(act.why), "describeActivity carries it on a work line");
  // Away from the base: no work bonus.
  a.location = { kind: "errand", baseId: h.id, until: 999 };
  check(bondWork(a) === 1, "away from the base: none");
  a.location = { kind: "base", baseId: h.id };
  // Quarrels: about BOND.quarrelChance a day.
  let q = 0;
  for (let i = 0; i < 400; i++) { const before = getRel(st, c, d).why ? (getRel(st, c, d).why.find((x) => /^Quarrels/.test(x.t)) || { v: 0 }).v : 0; delete st.bondDay; nextDay(st); bondsDaily(st); const after = ((getRel(st, c, d).why || []).find((x) => /^Quarrels/.test(x.t)) || { v: 0 }).v; if (after < before) q++; getRel(st, c, d).o = -50; }
  check(q >= 400 * BOND.quarrelChance * 0.4 && q <= 400 * BOND.quarrelChance * 2, `rivals at work quarrel ~${BOND.quarrelChance * 100}% of days (${q} of 400)`);
}

section("A crew's load, nerve, lessons");
{
  const st = W();
  const { ppl: [a, b, c] } = hubOf(st);
  setO(st, a, b, 50); setO(st, a, c, -40);
  const t = { job: "wood", mates: [b.id] };
  check(bondCrewMult(st, a, t) === 1 + BOND.crewLoad.friend, `a friend in the crew: the load ×${1 + BOND.crewLoad.friend}`);
  check(getRel(st, a, b).why.some((w) => /Out on the felling together/.test(w.t)), "and the trip shared shows as a reason");
  check(bondCrewMult(st, a, { job: "wood", mates: [c.id] }) === 1 + BOND.crewLoad.rival, "a rival: ×0.95");
  check(bondCrewMult(st, a, { job: "wood", mates: [b.id, c.id] }) === 1, "a friend and a rival cancel out");
  const nv = bondNerve(st, [a, b, c]);
  check(nv[a.id] === BOND.nerve.friend && nv[b.id] === BOND.nerve.friend && !nv[c.id], `nerve +${BOND.nerve.friend} a friend alongside, none for the rival (${JSON.stringify(nv)})`);
  setO(st, a, b, 80);
  check(Math.abs(lessonBond(st, a, b, "medicine") - (1 + BOND.teach.close)) < 1e-9, "a lesson from a close friend +25%");
  setO(st, a, b, 45);
  check(Math.abs(lessonBond(st, a, b, "medicine") - (1 + BOND.teach.friend)) < 1e-9, "from a friend +15%");
  check(Math.abs(lessonBond(st, a, c, "medicine") - (1 + BOND.teach.rival)) < 1e-9, "from a rival -25%");
  check(getRel(st, a, b).taught === 2, "lesson days counted on the pair");
}

section("Circles and the left-out; meals and friction; envy");
{
  const st = W();
  const { h, ppl: [a, b, c, d, e] } = hubOf(st);
  setO(st, a, b, 50); setO(st, a, c, 50); setO(st, b, c, 50);
  setO(st, d, a, -20);
  setO(st, e, d, 45); // e has a friend
  delete h.bondCliques;
  const cl = cliquesAt(st, h);
  check(cl.length === 1 && [a, b, c].every((s) => cl[0].includes(s.id)), "a, b and c are a circle");
  const fin = factor(st, a, /circle/);
  check(fin && fin.v === BOND.clique.in, `in it: "${fin && fin.label}" +${BOND.clique.in}`);
  const fout = factor(st, d, /Left out/);
  check(fout && fout.v === BOND.clique.out, `d dislikes one of them: "${fout && fout.label}"`);
  check(!factor(st, e, /Left out/), "e has a friend and no bad blood: not left out");
  // A common room: shared evenings; crowding: friction between those who are not friends.
  addBuilding(h, "common_room");
  h.rationing = true;
  const before = getRel(st, d, b) ? getRel(st, d, b).h : 0;
  delete st.bondDay; nextDay(st); bondsDaily(st);
  const r = getRel(st, d, b);
  check(r.why.some((w) => /common room/.test(w.t) && w.v > 0) && r.why.some((w) => /Short rations/.test(w.t) && w.v < 0), `evenings in the common room and short rations both noted (${JSON.stringify(r.why.map((w) => w.t))})`);
  check(!getRel(st, a, b).why || !getRel(st, a, b).why.some((w) => /Short rations/.test(w.t)), "friends are not driven apart by the rations");
  check(finite(r.h) && r.h !== before, "history moved");
  delete h.rationing;
  // Envy: a rival's success.
  setO(st, a, d, -45);
  a.moments = [{ d: day(st), t: `Held the gate during the 40-horde break-in at ${h.name}, day ${day(st)}` }];
  const m0 = d.mood;
  delete st.bondDay; bondsDaily(st);
  check(getRel(st, a, d).why.some((w) => /Envies/.test(w.t)) && d.mood < m0, "a rival's success: envy (a reason, mood down)");
  delete st.bondDay; bondsDaily(st);
  check(getRel(st, a, d).why.find((w) => /Envies/.test(w.t)).v === BOND.envy, "once per moment");
}

section("Grief, walking out, following");
{
  const st = W();
  const { h, ppl: [a, b, c, d] } = hubOf(st);
  setO(st, a, b, 80); setO(st, a, c, 45);
  killSurvivor(st, a, h.tile, "in a test");
  const gb = b.grief, gc = c.grief;
  check(gb && gc && gb.days === Math.round(3 + 7 * 0.8) + BOND.closeGrief && gc.days === Math.round(3 + 7 * 0.45), `a close friend grieves ${BOND.closeGrief} days longer (${gb && gb.days} vs ${gc && gc.days})`);
  // Walking out: a friend misses them; a deeply unhappy close friend follows.
  const { desert } = await import("../src/sim/morale.js");
  setO(st, b, c, 80); setO(st, b, d, 50);
  c.mood = 10; delete c.grief; delete d.grief; c.leader = false;
  const keep = BOND.follow.chance;
  BOND.follow.chance = 1;
  desert(st, h, b);
  BOND.follow.chance = keep;
  check(!c.alive && c.left, "c (close friend, mood 10) followed b out");
  check(d.grief && d.grief.left && d.grief.name === b.name.split(" ")[0] && Math.abs(d.grief.bond - 0.25) <= 0.05, `d misses b at half (${JSON.stringify(d.grief)})`);
  const f = factor(st, d, /^Misses/);
  check(f && f.v < 0, `the mood line "${f && f.label}"`);
  check(st.log.some((l) => /went after them/.test(l.text || l)), "the log says why c went");
}

section("The promise card");
{
  const st = W();
  const { h, ppl: [a, b, c] } = hubOf(st);
  setO(st, a, b, 85); setO(st, a, c, 60);
  killSurvivor(st, a, h.tile, "of wounds");
  const card = st.cards.find((x) => /^A promise to /.test(x.title));
  check(card && card.text.includes(b.name) && card.text.includes(c.name), `a card: "${card && card.title}": ${card && card.text}`);
  check(card && defaultChoice(st, card) === card.choices[1], "its default makes no promise");
  card.choices[0].resolve(st);
  check(b.promise && b.promise.ward === c.id, "b gives their word to look after c");
  nextDay(st); bondsDaily(st);
  check(factor(st, b, /Keeping a promise/) && Math.abs(bondWork(b) - (1 + BOND.work.promise)) < 1e-9, "a mood line and work +5% while it holds");
  check(bondEffects(st, b).some((e) => /A promise to/.test(e.text)), "listed in the bonds card");
  const m0 = b.mood;
  killSurvivor(st, c, h.tile, "in a test");
  check(!b.promise && b.promiseBroken && b.mood <= m0 + BOND.promise.broken + 1e-9 + 20, "c dies: broken");
  check(factor(st, b, /Could not keep a promise/), "the broken promise weighs a day");
  // Kept.
  const s2 = W(seed + 1);
  const { h: h2, ppl: [x, y, z] } = hubOf(s2);
  setO(s2, x, y, 85); setO(s2, x, z, 60);
  killSurvivor(s2, x, h2.tile, "of wounds");
  s2.cards.find((k) => /^A promise to /.test(k.title)).choices[0].resolve(s2);
  for (let i = 0; i <= BOND.promise.days; i++) { nextDay(s2); delete s2.bondDay; bondsDaily(s2); }
  check(!y.promise && (y.moments || []).some((m) => /Kept a promise/.test(m.t)), "kept: a moment on the record");
}

section("The scheduler's pull");
{
  const st = W();
  const { ppl: [a, b, c] } = hubOf(st);
  setO(st, a, b, 50); setO(st, a, c, -40);
  b.task = { t: "build" }; c.task = { t: "craft" };
  const pull = bondPull(st, [a, b, c]);
  check(pull(a, "build") === BOND.sched.friend && pull(a, "craft") === BOND.sched.rival && pull(a, "farm") === 0, "toward a friend's job, away from a rival's");
  check(Math.abs(pull(a, "build")) < 1.5 && BOND.sched.cap <= 0.5, "a fraction of the sticky bonus (never over a priority)");
}

section("The bond cards");
{
  const ids = Object.keys(BOND_EVENTS);
  check(ids.every((id) => HUB_EVENT_IDS.includes(id)), `all ${ids.length} are hub events (${ids.join(", ")})`);
  const setups = {
    feud: (st, p) => { setO(st, p[0], p[1], -70); },
    reconcile: (st, p) => { setO(st, p[0], p[1], -30, { h: 30, why: [{ t: "Fought side by side at the bridge", v: 20, d: 1 }] }); },
    join: (st, p) => { setO(st, p[0], p[1], 50); p[1].role = "build"; },
    apprentice: (st, p) => { p[0].skills.medicine = 1; p[1].skills.medicine = 12; setO(st, p[0], p[1], 20); },
    jealousy: (st, p) => { const L = p.find((s) => s.leader) || p[0]; L.leader = true; const others = p.filter((s) => s !== L); setO(st, L, others[0], 60); setO(st, others[1], L, 0); setO(st, others[1], others[0], -5); },
    betrayal: (st, p) => { setO(st, p[0], p[1], 50); p[0].traits = ["greedy"]; p[0].leader = false; },
    newcomer: (st, p) => { p[0].joined = day(st) - 3; setO(st, p[1], p[2], 50); setO(st, p[1], p[3], 50); setO(st, p[2], p[3], 50); },
  };
  for (const id of ids) {
    const st = W(seed + 3);
    for (let i = 0; i < 24 * 5; i++) tickHour(st); // a few days in (a newcomer needs day > 1)
    st.cards.length = 0;
    const { h, ppl } = hubOf(st, 6);
    for (const s of ppl) for (const o of ppl) if (s !== o) { const r = getRel(st, s, o, true); r.o = 0; r.h = 0; r.why = []; r.evDay = null; }
    for (const s of ppl) { s.leader = false; s.joined = 1; delete s.bondWelcomed; delete s.apprentice; }
    ppl[ppl.length - 1].leader = true;
    setups[id](st, ppl);
    const w = hubEventWeights(st, h)[id];
    if (!check(w > 0, `${id}: weighs in (${w})`)) continue;
    const card = hubEventCard(st, id, h);
    const named = ppl.filter((s) => card.text.includes(s.name) || card.title.includes(s.name.split(" ")[0]));
    check(named.length >= 1 && card.choices.length >= 2, `${id}: "${card.title}" names them: ${card.text}`);
    check(!!defaultChoice(st, card), `${id}: a default for the tray (${defaultChoice(st, card) && defaultChoice(st, card).label})`);
    check(card.choices.every((c) => typeof c.ai === "function" && finite(c.ai())), `${id}: every answer has an ai score`);
    // Each answer on its own world copy (same setup), none throws, each returns words.
    for (let i = 0; i < card.choices.length; i++) {
      const s2 = W(seed + 3);
      for (let k = 0; k < 24 * 5; k++) tickHour(s2);
      s2.cards.length = 0;
      const { h: h2, ppl: p2 } = hubOf(s2, 6);
      for (const s of p2) for (const o of p2) if (s !== o) { const r = getRel(s2, s, o, true); r.o = 0; r.h = 0; r.why = []; r.evDay = null; }
      for (const s of p2) { s.leader = false; s.joined = 1; delete s.bondWelcomed; delete s.apprentice; }
      p2[p2.length - 1].leader = true;
      setups[id](s2, p2);
      const c2 = hubEventCard(s2, id, h2);
      const ch = c2.choices[i];
      if (typeof ch.disabled === "function" ? ch.disabled(s2) : ch.disabled) continue;
      let text = "";
      try { text = ch.resolve(s2); } catch (e) { text = `THREW ${e.message}`; }
      check(typeof text === "string" && text.length > 3 && !/THREW|undefined|NaN/.test(text), `${id} / "${ch.label}": ${text}`);
      check(p2.every((s) => finite(s.mood) && finite(s.health)), `${id} / "${ch.label}": moods and health are numbers`);
    }
    check(hubEventWeights(st, h)[id] === 0 || id === "apprentice" || id === "jealousy", `${id}: the same pair waits ${20} days`);
  }
  // Specific outcomes.
  const st = W(seed + 3);
  for (let i = 0; i < 24 * 5; i++) tickHour(st);
  const { h, ppl } = hubOf(st, 6);
  for (const s of ppl) s.leader = false;
  setO(st, ppl[0], ppl[1], 50); ppl[1].role = "build";
  hubEventCard(st, "join", h).choices[0].resolve(st);
  check(ppl[0].role === "build", "join, yes: a Manual person takes the friend's role");
  ppl[2].skills.medicine = 0; ppl[3].skills.medicine = 14; setO(st, ppl[2], ppl[3], 20); delete ppl[2].apprentice;
  for (const s of ppl) if (s !== ppl[2] && s !== ppl[3]) s.skills.medicine = 0;
  const ac = hubEventCard(st, "apprentice", h);
  ac.choices[0].resolve(st);
  const L = ppl.find((s) => s.apprentice);
  const xp0 = L ? JSON.stringify(L.xp || {}) : "";
  delete st.bondDay; nextDay(st); bondsDaily(st);
  check(L && L.apprentice && JSON.stringify(L.xp || {}) !== xp0, "apprentice, yes: evening lessons give XP");
  check(L && factor(st, L, /Apprenticed to/), "and a mood line");
}

section("The survivor screen and the codex");
{
  const st = W();
  const { ppl: [a, b, c] } = hubOf(st);
  setO(st, a, b, 75); bumpPair(st, a, b, 8, "Fought side by side at the mill"); setO(st, a, c, -45, { h: 0 });
  getRel(st, a, b).why = [{ t: "Fought side by side at the mill", v: 8, d: 1 }];
  nextDay(st); bondsDaily(st);
  const nb = notableBonds(st, a);
  check(nb[0].other === b && nb[0].name === "Close friend" && /mill/.test(nb[0].why), `notable: ${nb.map((x) => `${x.name} ${x.why}`).join(" | ")}`);
  check(nb.some((x) => x.other === c && x.name === "Rival"), "the rival listed too");
  let ui = null;
  try { ui = await import("../src/ui/relations.js"); } catch (e) { console.log(`  (UI module not loadable headless: ${e.message})`); }
  if (ui) {
    const html = ui.relationsSection(st, a, {});
    check(html.includes("Close friend") && html.includes("Rival") && html.includes("Fought side by side at the mill"), "the People list shows level and reason");
    check(html.includes("<h3>Bonds</h3>") && /Work \+8% beside/.test(html), "the Bonds card shows the buffs now");
    check(!/undefined|NaN/.test(html), "no undefined or NaN in the screen");
  }
  let cx = null;
  try { cx = await import("../src/ui/codex.js"); } catch (e) { console.log(`  (codex not loadable headless: ${e.message})`); }
  if (cx) {
    const e = cx.codexEntry("k:bonds");
    check(e && e.cat === "people" && e.stats.length >= 6 && !/undefined|NaN/.test(JSON.stringify(e)), "a codex entry under People");
  }
}

section("The same seed twice, and a long autopilot run");
{
  const run = (days, sd = seed) => {
    const st = W(sd);
    setAutopilot(st, true);
    for (let i = 0; i < 24 * days; i++) { tickHour(st); while (st.cards.length) { const c = st.cards.shift(); const ch = defaultChoice(st, c) || c.choices.find((x) => !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)); if (ch && ch.resolve) ch.resolve(st); } }
    return st;
  };
  const a = run(30), b = run(30);
  // Survivor ids run on across worlds in one process (relations.js rk is per world): compare the pairs by value.
  const sig = (st) => JSON.stringify(Object.values(st.rel || {}).map((r) => [Math.round(r.o * 100), (r.why || []).map((w) => `${w.t}:${Math.round(w.v * 100)}`).join("|")]).sort());
  check(sig(a) === sig(b), "the same pairs, opinions and reasons on the same seed");
  const t0 = Date.now();
  const st = run(longDays);
  const ms = Date.now() - t0;
  const people = alive(st);
  const rels = Object.values(st.rel || {});
  const lv = {};
  for (const r of rels) lv[levelOf(r)] = (lv[levelOf(r)] || 0) + 1;
  const ev = st.stats.hubEvents || {};
  console.log(`    day ${day(st)}: ${people.length} alive, ${rels.length} pairs ${JSON.stringify(lv)}; bond cards ${JSON.stringify(Object.fromEntries(Object.keys(BOND_EVENTS).map((k) => [k, ev[k] || 0])))} (${ms} ms)`);
  check(rels.every((r) => finite(r.o) && finite(r.h) && (r.why || []).every((w) => finite(w.v))), "every opinion, history and reason a number");
  check(people.every((s) => finite(s.mood) && finite(moodWork(s))), "every mood and work factor a number");
  check(people.every((s) => bondWork(s) >= 1 && bondWork(s) <= BOND.work.max), "the work bonus within its bounds");
  // (A few a run at most: one run may draw none, so a second seed's run counts with it.)
  const ev2 = Object.keys(BOND_EVENTS).some((k) => ev[k] > 0) ? {} : run(longDays, seed + 1).stats.hubEvents || {};
  check(Object.keys(BOND_EVENTS).some((k) => ev[k] > 0 || ev2[k] > 0), "bond cards come up in a run");
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
