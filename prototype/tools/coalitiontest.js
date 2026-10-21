// Keeping the coalition together (src/sim/coalition.js): standing as goodwill plus named modifiers that fade (a
// quarter for good), the breakdown; refusal fatigue (the multiplier, "Requests ignored"); each ask (dispute, favour,
// trade, aid, military aid, an expulsion demand): what granting costs and refusing does, the card system's default
// (refuse) and staleness; the tolerance bands (may leave, leaves at once under 20, hostile and war far under); the
// expulsion demand refused until the demander walks out; the members drifting on their own (border friction, trade,
// a common enemy); the victory losing a member; the council's and the volunteers' asks in the tally; a save and an
// old save; the Coalition standing tab and the codex entry; the same seed, the same story.
// Usage: node tools/coalitiontest.js [seed=7]
import { setFood } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, hub, day, makeSurvivor } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import { recomputeOwnership, attitude } from "../src/sim/factions.js";
import { planPath } from "../src/sim/parties.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { knowsOf } from "../src/sim/groupworld.js";
import { supplyAmt } from "../src/sim/rounds.js";
import { cardKind, defaultChoice, trayStale } from "../src/sim/cardrules.js";
import * as D from "../src/sim/diplomacy.js";
import * as AL from "../src/sim/alliance.js";
import * as C from "../src/sim/coalition.js";
import * as W from "../src/sim/playerwars.js";
import * as V from "../src/sim/volunteers.js";

const SEED = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = performance.now();

const land = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain";
const free = (st, t) => land(st, t) && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t);
// A quiet world: a radio at the hub with full stores, and the groups asked for as coalition members (goodwill 60, a
// trade pact, a year in), their bases 6–12 tiles from the hub and at least `gap` tiles from each other.
function setup(types, { seed = SEED, gap = 3, members = true } = {}) {
  const st = createWorld({ seed, factionCount: 8 });
  st.started = true;
  st.noNewGangs = true;
  const h = hub(st);
  addBuilding(h, "radio");
  h.radio = true;
  Object.assign(h.stock, { water: 300, meds: 80, a_9mm: 900, scrap: 200, fuel: 80, parts: 10 }); setFood(h, 600);
  for (let i = 0; i < 12; i++) makeSurvivor(st, h.id); // people to lend
  const g = st.grid;
  const spots = g.within(h.tile, 14).filter((t) => g.distance(t, h.tile) >= 6 && free(st, t) && planPath(st, t, h.tile, false));
  const used = [], fs = [];
  for (const type of types) {
    const f = st.factions.find((x) => x.alive && !fs.includes(x));
    const t = spots.find((x) => used.every((u) => g.distance(u, x) >= gap));
    used.push(t);
    Object.assign(f, { type, bases: [t], known: true, pop: 24, pact: "trade", goodwill: 60 });
    setFood(f, 400);
    fs.push(f);
  }
  for (const f of st.factions) if (!fs.includes(f)) { f.alive = false; f.bases = []; }
  recomputeOwnership(st);
  for (const f of fs) { f.knows = null; knowsOf(st, f); }
  D.ensureDiplo(st);
  W.ensurePwars(st);
  const A = AL.ensureAlliance(st);
  if (members) for (const f of fs) { A.members.push(f.id); A.joined[f.id] = day(st) - 200; }
  for (const a of fs) for (const b of fs) if (a.id < b.id) setRel(st, a, b, 20);
  st.cards.length = 0;
  return { st, fs, h };
}
const setRel = (st, a, b, r) => D.changeRelation(st, a, b, r - D.relation(st, a, b));
const nextDay = (st, n = 1) => { for (let i = 0; i < n; i++) { st.hour += 24; AL.allianceDaily(st); st.cards.length = 0; } };
const pick = (card, re) => card && card.choices.find((c) => re.test(c.label));
const near = (a, b, e = 0.6) => Math.abs(a - b) <= e;

section("Standing: goodwill plus modifiers that fade, a quarter for good");
{
  const { st, fs: [a] } = setup(["traders", "commune"]);
  const g0 = a.goodwill;
  check(C.standing(st, a) === g0, `no memories: standing is goodwill (${g0})`);
  C.remember(st, a, "you", "aid", "Sent aid", 12, "aid");
  check(near(a.goodwill, g0 + 3) && near(C.standing(st, a), g0 + 12), `an act of +12: +12 at once, +3 of it in goodwill (goodwill ${a.goodwill.toFixed(1)}, standing ${C.standing(st, a).toFixed(1)})`);
  const parts = C.standingParts(st, a);
  check(parts[0].base && parts.some((p) => p.label === "Sent aid" && near(p.v, 9) && p.fading > 0), `the breakdown names it: ${parts.map((p) => `${p.label} ${Math.round(p.v)}${p.fading ? ` (${p.fading}d)` : ""}`).join(", ")}`);
  C.remember(st, a, "you", "aid", "Sent aid", 12, "aid");
  check(C.youMods(st, a).filter((m) => m.key === "aid").length === 1 && near(C.youMods(st, a)[0].v, 18), "the same kind stacks into one modifier");
  const s1 = C.standing(st, a);
  C.coalitionDaily(st, AL.allianceMembers(st));
  check(C.standing(st, a) < s1, `a day later it has faded a little (${s1.toFixed(1)} → ${C.standing(st, a).toFixed(1)})`);
  for (let i = 0; i < C.BAL.DAYS.aid + 2; i++) C.coalitionDaily(st, AL.allianceMembers(st));
  check(!C.youMods(st, a).some((m) => m.key === "aid") && near(C.standing(st, a), a.goodwill, 0.01), `after ${C.BAL.DAYS.aid} days it is gone; the lasting quarter stays (goodwill ${a.goodwill.toFixed(1)})`);
}

section("Refusal fatigue: refusals land harder, and standing drains");
{
  const { st, fs: [a, b] } = setup(["traders", "commune"]);
  check(C.fatigue(st, a) === 1, "no record: ×1");
  const hits = [];
  for (let i = 0; i < 4; i++) {
    const card = C.askCard(st, "favour", [a, b]) ;
    const before = C.standing(st, card.coalIds[0] === a.id ? a : b);
    const who = card.coalIds[0] === a.id ? a : b;
    pick(card, /^Refuse/).resolve(st);
    hits.push(before - C.standing(st, who));
  }
  check(hits.every((x, i) => i === 0 || x >= hits[i - 1] - 0.01) && hits[hits.length - 1] > hits[0] + 1, `each refusal of the same member hits harder: ${hits.map((x) => x.toFixed(1)).join(", ")}`);
  const r = C.recordOf(st, a);
  check(r.nRef + C.recordOf(st, b).nRef === 4 && C.ensureBalance(st).all.nRef === 4, "the record counts them, per member and for the coalition");
  const worst = C.fatigue(st, a) >= C.fatigue(st, b) ? a : b;
  check(C.fatigue(st, worst) > 1.5, `fatigue ×${C.fatigue(st, worst).toFixed(2)}`);
  for (let i = 0; i < 10; i++) { st.hour += 24; C.coalitionDaily(st, AL.allianceMembers(st)); }
  const ig = C.youMods(st, worst).find((m) => m.key === "neglect");
  check(ig && ig.v < -2 && ig.label === "Requests ignored" && ig.fade === 0, `while refusals outweigh grants, "Requests ignored" deepens day by day and does not fade (${ig ? ig.v.toFixed(1) : "none"} in 10 days)`);
  for (let i = 0; i < 8; i++) C.noteAnswer(st, worst, true);
  C.coalitionDaily(st, AL.allianceMembers(st));
  const ig2 = C.youMods(st, worst).find((m) => m.key === "neglect");
  check(C.fatigue(st, worst) === 1 + C.BAL.FAT.ALL * Math.max(0, C.ensureBalance(st).all.ref - C.ensureBalance(st).all.acc) || C.fatigue(st, worst) < 1.3, `granting brings the multiplier down (×${C.fatigue(st, worst).toFixed(2)})`);
  check(ig2 && ig2.fade > 0, "and \"Requests ignored\" starts to fade");
}

section("The asks: dispute");
{
  const { st, fs: [a, b] } = setup(["traders", "commune"]);
  setRel(st, a, b, -10);
  const card = C.askCard(st, "dispute");
  check(card && card.choices.length === 4 && card.coalKind === "dispute" && card.coalIds.length === 2, `a quarrel: ${card && card.choices.map((c) => c.label).join(" / ")}`);
  check(cardKind(st, card) === "other" && defaultChoice(st, card).label === "Stay out of it", "a card like any other (kind other); left too long it stays out of it");
  const [x, y] = card.coalIds.map((id) => (id === a.id ? a : b));
  const sx = C.standing(st, x), sy = C.standing(st, y), p0 = C.pairStanding(st, x, y);
  pick(card, new RegExp(`^Side with ${x.name}`)).resolve(st);
  check(C.standing(st, x) > sx + 5 && C.standing(st, y) < sy - 5 && C.pairStanding(st, x, y) < p0, `side with one: it up (${sx.toFixed(0)} → ${C.standing(st, x).toFixed(0)}), the other down (${sy.toFixed(0)} → ${C.standing(st, y).toFixed(0)}), they sour (${p0.toFixed(0)} → ${C.pairStanding(st, x, y).toFixed(0)})`);
  check(C.recordOf(st, x).nAcc === 1 && C.recordOf(st, y).nRef === 1, "the winner tallies a grant, the loser a refusal");
  const card2 = C.askCard(st, "dispute");
  const s2x = C.standing(st, x), s2y = C.standing(st, y), p2 = C.pairStanding(st, x, y);
  pick(card2, /^Split/).resolve(st);
  check(C.standing(st, x) < s2x && C.standing(st, y) < s2y && s2x - C.standing(st, x) < 4 && C.pairStanding(st, x, y) > p2, "split the difference: small hits to both, they mend a little");
  const card3 = C.askCard(st, "dispute");
  const s3 = C.standing(st, x), p3 = C.pairStanding(st, x, y);
  pick(card3, /^Stay out/).resolve(st);
  check(C.standing(st, x) < s3 && C.pairStanding(st, x, y) < p3, "stay out of it: both down, and they settle it badly");
}

section("The asks: a favour at another's expense");
{
  const { st, fs: [a, b] } = setup(["traders", "fortress"]);
  const card = C.askCard(st, "favour");
  const [x, y] = card.coalIds.map((id) => (id === a.id ? a : b));
  const sx = C.standing(st, x), sy = C.standing(st, y), p0 = C.pairStanding(st, x, y);
  check(defaultChoice(st, card).label === "Refuse", `${card.title}: the default is to refuse`);
  pick(card, /^Grant/).resolve(st);
  check(C.standing(st, x) > sx + 5 && C.standing(st, y) < sy - 5 && C.pairStanding(st, x, y) < p0, "granted: up with the asker, down with the other, and between them");
}

section("The asks: trade, aid and military aid cost real goods and people");
{
  const { st, fs: [a], h } = setup(["traders"]);
  setFood(a, 2); a.stock.meds = 60; a.stock.fuel = 80; a.stock.scrap = 200;
  const trade = C.askCard(st, "trade");
  if (check(!!trade, `a member short of something offers a trade: ${trade && trade.text}`)) {
    const before = JSON.stringify(h.stock), s0 = C.standing(st, a);
    const yes = trade.choices[0];
    check(!yes.disabled(st), "the hub can pay");
    yes.resolve(st);
    check(JSON.stringify(h.stock) !== before && C.standing(st, a) > s0, `accepted: goods change hands (${yes.label}), standing up`);
  }
  const aid = C.askCard(st, "aid");
  if (check(!!aid, `a member short of something asks for aid: ${aid && aid.choices[0].label}`)) {
    const k = /food/.test(aid.choices[0].label) ? "food" : /meds/.test(aid.choices[0].label) ? "meds" : /fuel/.test(aid.choices[0].label) ? "fuel" : /water/.test(aid.choices[0].label) ? "water" : "ammo";
    const had = supplyAmt(h.stock, k), s0 = C.standing(st, a);
    aid.choices[0].resolve(st);
    check(supplyAmt(h.stock, k) < had && C.standing(st, a) >= s0 + C.BAL.GAIN.aid - 0.5, `sent: the hub has less ${k} (${Math.round(had)} → ${Math.round(supplyAmt(h.stock, k))}), standing +${C.BAL.GAIN.aid}`);
    const aid2 = C.askCard(st, "aid");
    const s1 = C.standing(st, a);
    pick(aid2, /^Refuse/).resolve(st);
    check(C.standing(st, a) < s1 - 4, `refused: ${(s1 - C.standing(st, a)).toFixed(1)} off standing`);
  }
  // At war with a group outside the coalition: fighters, rounds or join the war.
  const e = st.factions.find((f) => !f.alive);
  Object.assign(e, { alive: true, type: "raider", pop: 20, known: true, goodwill: 0, bases: [st.grid.within(a.bases[0], 6).find((t) => free(st, t))] });
  setFood(e, 100);
  recomputeOwnership(st);
  const w = D.startWar(st, e, a, "land");
  st.cards.length = 0;
  const mil = C.askCard(st, "military");
  if (check(mil && mil.coalKind === "military", `a member at war asks for military aid: ${mil && mil.choices.map((c) => c.label).join(" / ")}`)) {
    check(mil.choices.some((c) => /^Join their war/.test(c.label)) && mil.choices.some((c) => /rounds$/.test(c.label)), "fighters, rounds, or join their war");
    const home = st.survivors.filter((s) => s.alive && s.location.kind === "base").length, s0 = C.standing(st, a);
    pick(mil, /^Send 2 fighters/).resolve(st);
    const lent = V.lentPeople(st).filter((s) => s.location.fid === a.id);
    check(lent.length === 2 && st.survivors.filter((s) => s.alive && s.location.kind === "base").length === home - 2, `two of yours go as people lent (volunteers.js): ${lent.map((s) => s.name).join(", ")}`);
    check(C.standing(st, a) > s0 + 10 && C.standingParts(st, a).some((p) => p.label === "Your people fight with them" && p.fading === 0), "standing up, and more while they are with them");
    const mil2 = C.askCard(st, "military");
    pick(mil2, /^Join their war/).resolve(st);
    check(w.playerSide === a.id && C.standingParts(st, a).some((p) => p.label === "You fight beside them"), "joined: you fight beside them (diplomacy.js joinWar), a modifier while it lasts");
  }
}

section("Cards in the tray: stale once a member is gone");
{
  const { st, fs: [a, b] } = setup(["traders", "commune"]);
  const card = C.askCard(st, "dispute");
  st.cards.push(card);
  check(trayStale(st, card) === "", "fresh while both are members");
  AL.expel(st, b);
  check(/no longer in the coalition/.test(trayStale(st, card)), `then: ${trayStale(st, card)}`);
}

section("Tolerance bands: may leave, leaves at once, turns hostile");
{
  const { st, fs: [a, r] } = setup(["commune", "raider"]);
  const ba = C.band(st, a), br = C.band(st, r);
  check(br.leave > ba.leave && ba.leave > AL.ALLIANCE.LEAVE_GOODWILL, `touchier kinds leave sooner: commune under ${ba.leave}, raiders under ${br.leave}`);
  check(ba.hostile === ba.leave - C.BAL.HOSTILE_GAP && ba.grudge < br.grudge, `hostile ${C.BAL.HOSTILE_GAP} under the leave line (${ba.hostile}); grudges by kind too (${ba.grudge} / ${br.grudge})`);
  // Between the floor and the leave line: may leave, likelier each day.
  a.goodwill = ba.leave - 3;
  check(C.risks(st, a).some((k) => k.kind === "leave"), `flagged: ${C.risks(st, a).map((k) => k.text).join(", ")}`);
  let days = 0;
  while (AL.isMember(st, a) && days < 60) { nextDay(st); days++; }
  check(!AL.isMember(st, a) && a.pact === "trade" && attitude(a) !== "Hostile", `it left after ${days} day(s) under the line, peacefully (pact kept)`);
  // Just under the line, across seeds: not always the first day, never past a month.
  const waits = [11, 12, 13, 14, 15, 16].map((sd) => { const { st: s, fs: [m] } = setup(["commune", "traders"], { seed: sd }); m.goodwill = C.band(s, m).leave - 1; let n = 0; while (AL.isMember(s, m) && n < 60) { nextDay(s); n++; } return n; });
  check(waits.some((n) => n > 1) && waits.every((n) => n <= 30), `days a member 1 under its line stays (6 seeds): ${waits.join(", ")}`);
  check(st.log.some((l) => /unhappy in .* they may leave/.test(l.text || "")), "a warning in the log first");
}
{
  const { st, fs: [a, r] } = setup(["commune", "raider"]);
  a.goodwill = 15;
  nextDay(st);
  check(!AL.isMember(st, a) && attitude(a) !== "Hostile", "under 20: leaves at once (as before), not hostile above its hostile line");
  r.goodwill = 30;
  C.remember(st, r, "you", "x", "Betrayed them", -40, "kept");
  check(C.standing(st, r) < C.band(st, r).hostile, `a raider far under (standing ${C.standing(st, r).toFixed(0)}, hostile under ${C.band(st, r).hostile})`);
  nextDay(st);
  check(!AL.isMember(st, r) && attitude(r) === "Hostile" && !r.pact && W.atWarWithYou(st, r), "walks out in anger: hostile, the pact torn up, and (a warlike kind) war on you");
  check(C.ensureBalance(st).stats.hostile === 1 && C.ensureBalance(st).stats.left === 2, "counted");
}

section("Expulsion demands");
{
  const { st, fs: [a, b, c], h } = setup(["fortress", "traders", "commune"]);
  setRel(st, a, b, -40);
  check(C.risks(st, a).some((k) => k.kind === "grudge"), `${a.name} under its grudge line with ${b.name}: ${C.risks(st, a).map((k) => k.text).join(", ")}`);
  st.hour += 24; AL.allianceDaily(st);
  let card = st.cards.find((x) => x.coalKind === "expel");
  check(card && card.coalIds[1] === b.id && defaultChoice(st, card).label === "Refuse", `${card && card.title}; the default is to refuse`);
  let refusals = 0;
  for (let i = 0; i < 5 && AL.isMember(st, a); i++) {
    card = card || C.expelCard(st, a, b);
    pick(card, /^Refuse/).resolve(st);
    refusals++;
    card = null;
  }
  check(!AL.isMember(st, a) && AL.isMember(st, b) && refusals === C.BAL.DEMAND_MAX, `refused ${refusals} times: ${a.name} walk out, ${b.name} stay`);
  // Talks instead: food to both, they mend, the demand not counted.
  setRel(st, b, c, -40);
  const tc = C.expelCard(st, c, b);
  const talk = pick(tc, /^Hold talks/), food0 = supplyAmt(h.stock, "food"), p0 = C.pairStanding(st, b, c);
  check(talk && !talk.disabled(st), `an expulsion demand offers talks: ${talk && talk.hint}`);
  talk.resolve(st);
  check(supplyAmt(h.stock, "food") <= food0 - 2 * C.BAL.TALKS.food + 0.01 && C.pairStanding(st, b, c) >= p0 + C.BAL.TALKS.mend - 0.5 && !(C.ensureBalance(st).demands[`${c.id}|${b.id}`]), `talks: ${2 * C.BAL.TALKS.food} days of food out, between them ${p0.toFixed(0)} → ${C.pairStanding(st, b, c).toFixed(0)}, no refusal counted`);
  st.cards.length = 0;
  // Granting it.
  setRel(st, b, c, 30);
  setRel(st, c, b, 30);
  const card2 = C.expelCard(st, c, b);
  pick(card2, /^Expel/).resolve(st);
  check(!AL.isMember(st, b) && AL.isMember(st, c) && C.ensureBalance(st).stats.expelled === 1, "expelled on demand: the target goes, the demander stays");
}

section("Members drift on their own: border friction, trade, a common enemy, incidents");
{
  const { st, fs: [a, b] } = setup(["traders", "commune"], { gap: 3 });
  D.ensureDiplo(st).pacts.push({ a: a.id, b: b.id, since: day(st) });
  for (let i = 0; i < 60; i++) C.coalitionDaily(st, AL.allianceMembers(st));
  const parts = C.pairParts(st, a, b);
  const border = parts.find((p) => p.label === "Border friction"), trade = parts.find((p) => p.label === "Trade between them");
  check(D.baseDistance(st, a, b) <= C.BAL.BORDER.range ? border && border.v < -5 && border.fading === 0 : true, `neighbours rub raw: ${border ? border.v.toFixed(1) : "far apart"}`);
  check(trade && trade.v > 4, `trade partners grow closer: ${trade ? trade.v.toFixed(1) : "none"}`);
  st.diplo.pacts = [];
  for (let i = 0; i < 3; i++) C.coalitionDaily(st, AL.allianceMembers(st));
  const t2 = C.pairParts(st, a, b).find((p) => p.label === "Trade between them");
  check(t2 && t2.v < trade.v && t2.fading > 0, "the pact gone, that fades");
  // Incidents over a long stretch.
  const { st: s2 } = setup(["traders", "commune", "fortress", "military"], { seed: SEED + 1 });
  for (let i = 0; i < 200; i++) { s2.hour += 24; C.coalitionDaily(s2, AL.allianceMembers(s2)); }
  check(C.ensureBalance(s2).stats.incidents > 0, `incidents happen (${C.ensureBalance(s2).stats.incidents} in 200 days between 4 members)`);
}

section("The asks come by themselves, one at a time");
{
  const { st } = setup(["traders", "commune", "fortress"]);
  setFood(st.factions.find((f) => f.alive), 2);
  let raised = 0, maxOpen = 0;
  for (let i = 0; i < 60; i++) {
    st.hour += 24; AL.allianceDaily(st);
    const open = st.cards.filter((c) => c.coalAsk).length;
    maxOpen = Math.max(maxOpen, open);
    for (const c of st.cards.filter((x) => x.coalAsk)) { raised++; defaultChoice(st, c).resolve(st); }
    st.cards.length = 0;
  }
  check(raised >= 4 && raised <= 15, `${raised} asks in 60 days with 3 members`);
  check(maxOpen <= 1, "never two at once");
  check(C.ensureBalance(st).all.nRef >= raised - 1, "left to their defaults, they are refused (and the record shows it)");
}

section("The council and the groups' calls for volunteers count in the tally");
{
  const { st, fs: [a, b] } = setup(["traders", "commune"]);
  setFood(a, 0);
  const sup = AL.councilCard(st, "supplies", [a, b]);
  if (check(!!sup, "the council asks for supplies")) {
    const f = sup.title.includes(a.name) ? a : b;
    pick(sup, /^Refuse/).resolve(st);
    check(C.recordOf(st, f).nRef === 1, "refusing the council is a refusal of that member");
  }
  const ask = V.makeAsk(st, a, { kind: "war", label: "a war" }, 1, 3);
  V.answerAsk(st, ask.id, null);
  check(C.recordOf(st, a).nRef >= 1, "so is turning down their call for volunteers");
}

section("Membership and the victory");
{
  const { st, fs: [a, b] } = setup(["traders", "commune"]);
  const land0 = AL.controlledLand(st).pct;
  const without = C.landWithout(st, a);
  check(without <= land0, `the land if ${a.name} left: ${Math.round(without * 100)}% (now ${Math.round(land0 * 100)}%)`);
  C.breakAway(st, a, "test");
  check(!AL.isMember(st, a) && !AL.allianceVictory(st) && AL.goalsProgress(st).alliance.blocks.some((x) => /outside the coalition/.test(x)), "a member gone is a group outside: the victory is blocked");
  check(Math.abs(AL.controlledLand(st).pct - without) < 0.01, "and its land leaves the count");
}

section("Saves: the ledger of memories survives; an old save starts empty");
{
  const { st, fs: [a, b] } = setup(["traders", "commune"]);
  C.remember(st, a, "you", "aid", "Sent aid", 12, "aid");
  C.remember(st, a, b, "ruling", "Your ruling", -6, "sided");
  C.noteAnswer(st, a, false);
  const back = loadFromString(saveToString(st));
  const a2 = back.factions.find((f) => f.id === a.id), b2 = back.factions.find((f) => f.id === b.id);
  check(near(C.standing(back, a2), C.standing(st, a), 0.01) && near(C.pairStanding(back, a2, b2), C.pairStanding(st, a, b), 0.01) && C.recordOf(back, a2).nRef === 1, "standing, the pair and the record come back");
  delete back.alliance.bal;
  check(C.standing(back, a2) === a2.goodwill && C.fatigue(back, a2) === 1, "a save from before: no memories, no fatigue");
}

section("The Coalition standing tab and the codex");
{
  const { st, fs: [a, b] } = setup(["traders", "raider"]);
  C.remember(st, a, "you", "aid", "Sent aid", 12, "aid");
  setRel(st, a, b, -40);
  C.noteAnswer(st, b, false); C.noteAnswer(st, b, false);
  const ui = await import("../src/ui/diplomacy.js");
  const html = ui.diplomacyModal(st, { diplo: { tab: "standing" } });
  check(/Coalition standing/.test(html) && html.includes(a.name) && html.includes(b.name), "the tab renders with every member");
  check(/Sent aid \+9/.test(html) && /leaves under \d+/.test(html) && /hostile under -?\d+/.test(html), "bars with the leave and hostile lines, the modifiers named");
  check(/Record: <b class="good">0<\/b> granted · <b class="danger">2<\/b> refused/.test(html) && /refusals land ×1\.\d/.test(html), "the record and the fatigue");
  check(/⚠ wants .+ out/.test(html) && /If they leave: land \d+%/.test(html), "risk flags and the land at stake");
  check(/<table class="t small">/.test(html) && /⚠<\/td>/.test(html), "the member-to-member grid, a grudge marked");
  check(/data-tab="standing"/.test(ui.diplomacyModal(st, { diplo: { tab: "coalition" } })), "the Coalition tab links to it");
  const { codexEntry } = await import("../src/ui/codex.js");
  const e = codexEntry("k:coalition");
  check(e && e.cat === "groups" && /Coalition standing/.test(e.how), "a codex entry: Keeping the coalition");
}

section("The same seed, the same story");
{
  const run = () => {
    const { st } = setup(["traders", "commune", "fortress"], { seed: SEED + 3 });
    for (let i = 0; i < 80; i++) { st.hour += 24; AL.allianceDaily(st); for (const c of st.cards.filter((x) => x.coalAsk)) { const ch = [...c.choices].filter((x) => !(typeof x.disabled === "function" && x.disabled(st))).sort((p, q) => q.ai(st) - p.ai(st))[0]; ch.resolve(st); } st.cards.length = 0; }
    const B = C.ensureBalance(st), nm = (id) => (id === "you" ? "you" : st.factions.find((f) => f.id === id).name); // ids differ between two worlds in one process
    return JSON.stringify({ m: st.alliance.members.map(nm), mods: B.mods.map((m) => [nm(m.a), nm(m.b), m.key.replace(/\d+$/, ""), Math.round(m.v * 100)]), all: B.all, s: B.stats });
  };
  const x = run(), y = run();
  check(x === y, "two runs of 80 days with the governor's picks match");
}

console.log(`\n${failed ? "FAILED" : "passed"}: ${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
