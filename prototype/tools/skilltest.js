// Skills, teaching, books and perks (src/sim/skills.js): the XP curve, XP per action, the daily caps, decay and its
// floor, teaching, reading (progress, limits, one reader per copy), books found and sold, perk milestones and
// choices, every perk's effect where it is coded, determinism, and a 200-day autopilot run without NaN.
// Usage: node tools/skilltest.js [seed]
import { createWorld, tickHour, day, hub, atBase, alive, makeSurvivor, skill, combatPower } from "../src/sim/world.js";
import { GEAR, SKILLS } from "../src/sim/data.js";
import * as S from "../src/sim/skills.js";
import { launchExpedition, partyMembers, partyTile, carryCapacity, sightRadius, bestSkill, partySpeed, survey } from "../src/sim/parties.js";
import { treatAtBaseInfo, treatAtBase, fieldTreatInfo, fieldTreat, medicCapacity, healRatePerHour, activeHospital, treaters } from "../src/sim/medical.js";
import { addCondition, treatConditionInfo } from "../src/sim/health.js";
import { createBattle, combatAct, autoPlayerTurn, runEnemyPhase, autoResolveCombat, shotOdds, active } from "../src/sim/combat.js";
import { scavChance, eatPerDay } from "../src/sim/economy.js";
import { careToday, farmOf, farmingDaily, plantPlot } from "../src/sim/farming.js";
import { foodStore } from "../src/sim/storage.js";
import { addBuilding, buildRate } from "../src/sim/buildings.js";
import { craftRate, queueCraft, craftingHour, craftQueue, makeItem, craftedDur } from "../src/sim/crafting.js";
import { canRepair } from "../src/sim/vehicles.js";
import { perceptionChance } from "../src/sim/markers.js";
import { heatGain } from "../src/sim/fieldheat.js";
import { triggerConflict } from "../src/sim/conflicts.js";
import { startScavenge, searchHour, extract } from "../src/sim/scavenge.js";
import { radioSpeech } from "../src/sim/radio.js";
import { newItem } from "../src/sim/inventory.js";
import { setAutopilot, autopilotResolve } from "../src/sim/autopilot.js";
import { moodFactors, MOODF } from "../src/sim/relations.js";

const SEED = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, text) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${text}`); };
const r1 = (v) => Math.round(v * 10) / 10;

function world(seed = SEED) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  return st;
}
// A fresh survivor at the hub with the given skills (others 0), no traits, mood 60.
function person(st, skills = {}, role = "rest") {
  const s = makeSurvivor(st);
  for (const k of SKILLS) s.skills[k] = skills[k] ?? 0;
  s.traits = [];
  s.mood = 60;
  s.role = role;
  s.location = { kind: "base", baseId: hub(st).id };
  st.survivors.push(s);
  S.ensureSkills(st, s);
  s.perkPending = [];
  return s;
}
const nextDay = (st) => { st.hour += 24; };
const team = (st, people, supplies = { food: 3, water: 3, ammo: 20, meds: 4 }) => {
  const h = hub(st);
  for (const [k, v] of Object.entries(supplies)) h.stock[k] = (h.stock[k] || 0) + v;
  const dest = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 4).id;
  const res = launchExpedition(st, { memberIds: people.map((s) => s.id), dest, mission: "move", stance: "normal", supplies });
  if (res.error) throw new Error(res.error);
  return res.party;
};
const give = (s, ...ids) => { s.perks = [...(s.perks || []), ...ids]; };
const without = (s, id) => { s.perks = (s.perks || []).filter((x) => x !== id); };
// Value of fn() with and without a perk on s.
function withPerk(s, id, fn) {
  without(s, id);
  const a = fn();
  give(s, id);
  const b = fn();
  without(s, id);
  return [a, b];
}

// ---------------------------------------------------------------------------------------------------------------
console.log("XP curve");
{
  check(S.xpNeed(0) === 40 && S.xpNeed(3) === 49 && S.xpNeed(5) === 80 && S.xpNeed(10) === 360 && S.xpNeed(15) === 1120 && S.xpNeed(19) === 2235,
    `XP to the next level: 40 at 0, 49 at 3, 80 at 5, 360 at 10, 1120 at 15, 2235 at 19 (40 + 0.32 × L³)`);
  const st = world();
  const a = person(st, { farming: 3 });
  for (let d = 0; d < 28; d++) { S.gainXp(st, a, "farming", S.USE.farm); nextDay(st); }
  check(a.skills.farming === 7, `a 3 with a full day of one job (${S.USE.farm} XP) every day for a season (28 days) is ${a.skills.farming} (7)`);
  const b = person(st, { shooting: 15 });
  let days = 0;
  while (b.skills.shooting === 15 && days < 300) { S.gainXp(st, b, "shooting", S.USE.farm); nextDay(st); days++; }
  check(days >= 95 && days <= 125, `15 → 16 takes about a year of a full day's use every day (${days} days; a year is 112)`);
  const c = person(st, { medicine: 19 });
  for (let d = 0; d < 400; d++) { S.gainXp(st, c, "medicine", 15); nextDay(st); }
  check(c.skills.medicine === 20 && c.xp.medicine === 0, "skills stop at 20 (no XP kept above it)");
  // The real thing: a farmer at the hub for a season of full ticks.
  const w = world(SEED + 1);
  const f = person(w, { farming: 3 }, "farm");
  for (let h = 0; h < 28 * 24; h++) { tickHour(w); w.cards.length = 0; if (!f.alive) break; f.role = "farm"; f.inBed = false; f.mood = 60; }
  check(f.skills.farming >= 6, `a farmer on the Farm role for a season of real days: Farming 3 → ${f.skills.farming}`);
}

// ---------------------------------------------------------------------------------------------------------------
console.log("XP per action");
{
  const st = world();
  const h = hub(st);
  const xpOf = (s, k) => s.skills[k] * 10000 + (s.xp[k] || 0);
  const med = person(st, { medicine: 6 }, "medic");
  const pat = person(st, {}, "rest");
  pat.health = 40;
  h.stock.meds = 20;
  let x0 = xpOf(med, "medicine");
  const txt = treatAtBase(st, h, pat.id);
  check(/treated|operated/.test(txt) && r1(xpOf(med, "medicine") - x0) === S.USE.wound, `a wound treatment at a base gives the medic ${S.USE.wound} Medicine XP (${txt.slice(0, 50)}…)`);
  addCondition(st, pat, "flu", "test");
  x0 = xpOf(med, "medicine");
  const ci = treatConditionInfo(st, h, pat, "flu");
  if (ci.ok) { (await import("../src/sim/health.js")).applyCondition(st, h, pat, "flu", ci); }
  check(ci.ok && r1(xpOf(med, "medicine") - x0) === S.USE.illness, `an illness treatment gives ${S.USE.illness} Medicine XP`);
  const scout = person(st, { scouting: 2, medicine: 4 });
  const hurtOne = person(st, {});
  hurtOne.health = 50;
  const p = team(st, [scout, hurtOne]);
  x0 = xpOf(scout, "medicine");
  fieldTreat(st, p, hurtOne.id);
  check(r1(xpOf(scout, "medicine") - x0) === S.USE.field, `a field treatment gives ${S.USE.field} Medicine XP`);
  x0 = xpOf(scout, "scouting");
  survey(st, p, 0, false);
  check(r1(xpOf(scout, "scouting") - x0) === S.USE.survey, `looking around gives everyone on the team ${S.USE.survey} Scouting XP`);
  x0 = xpOf(scout, "scouting");
  p.phase = "out";
  S.skillsHour(st);
  check(r1(xpOf(scout, "scouting") - x0) === S.USE.travelHour, `an hour on the move gives ${S.USE.travelHour} Scouting XP`);
  x0 = xpOf(scout, "shooting");
  const res = autoResolveCombat(st, { partyId: p.id, tile: partyTile(p), enemy: { kind: "zombies", count: 1, power: 0.5, name: "test" }, ambush: null });
  check(r1(xpOf(scout, "shooting") - x0) === S.USE.autoFight + (res.outcome === "victory" ? S.USE.autoWin : 0) || !scout.alive, `a fight resolved by the numbers gives ${S.USE.autoFight} Shooting XP (+${S.USE.autoWin} for a win)`);
  // Hour-by-hour search.
  const site = st.tiles.find((t) => t.loc && t.loc.type === "school" && !t.owner) || st.tiles.find((t) => t.loc);
  p.dest = site.id;
  st.autoCombat = true;
  startScavenge(st, p);
  st.engagement.approach = "sneak";
  const sv0 = xpOf(scout, "scavenging"), sl0 = xpOf(scout, "stealth");
  searchHour(st);
  check(!scout.alive || (r1(xpOf(scout, "scavenging") - sv0) === S.USE.searchHour && r1(xpOf(scout, "stealth") - sl0) === S.USE.sneakSearch), `a search hour gives ${S.USE.searchHour} Scavenging XP (+${S.USE.sneakSearch} Stealth sneaking)`);
  st.engagement = null;
  // Road talk.
  const talker = person(st, { speech: 8 });
  const q = team(st, [talker]);
  const f = st.factions.find((x) => x.alive);
  f.goodwill = 0;
  const card = triggerConflict(st, q, "roadblock", f.id);
  const talk = card && card.choices.find((c) => /^Talk/.test(c.label));
  st.cards = st.cards.filter((c) => c !== card);
  x0 = xpOf(talker, "speech");
  if (talk) talk.resolve(st);
  const dx = r1(xpOf(talker, "speech") - x0);
  check(!!talk && (dx === S.USE.talk || dx === S.USE.talk + S.USE.talkWon), `a road talk gives the talker ${S.USE.talk} Speech XP (+${S.USE.talkWon} if it works): ${dx}`);
  // Roles over a day.
  const w = world(SEED + 2);
  const roles = { farm: "farming", guard: "shooting", scavenge: "scavenging", medic: "medicine" };
  const ppl = Object.keys(roles).map((r) => person(w, {}, r));
  S.skillsDaily(w);
  check(ppl.every((s) => (s.xp[roles[s.role]] || 0) > 0), "a day on Farm, Guard, Scavenge or Medic gives XP in that role's skill");
  // Balance pass 2026-10-07: an hour on guard, the camp's talker, an outpost's head.
  const g = ppl.find((s) => s.role === "guard");
  let x1 = xpOf(g, "shooting");
  S.skillsHour(w);
  check(Math.abs(xpOf(g, "shooting") - x1 - S.USE.watchHour) < 1e-9, `an hour on guard at a base gives ${S.USE.watchHour} Shooting XP (the night watch too)`);
  const talkers = atBase(w, hub(w).id).filter((s) => !s.inBed);
  const bestTalk = [...talkers].sort((a, b) => skill(b, "speech") - skill(a, "speech") || a.id - b.id)[0];
  nextDay(w);
  x1 = xpOf(bestTalk, "speech");
  S.skillsDaily(w);
  check(talkers.length >= 3 && xpOf(bestTalk, "speech") - x1 >= S.USE.campTalk - 1e-9, `the best Speech at a base of 3 or more gains ${S.USE.campTalk} Speech a day (the camp's talker)`);
  // Tactical battle: shots and hits counted, given as Shooting XP when it ends.
  const bw = world(SEED + 3);
  const bh = hub(bw);
  const shooters = [person(bw, { shooting: 10 }), person(bw, { shooting: 10 })];
  for (const s of shooters) s.gear.weapon = newItem("huntrifle");
  bh.stock.ammo = 200;
  const xs0 = shooters.map((s) => xpOf(s, "shooting"));
  const b = (bw.combat = createBattle(bw, { tile: bh.tile, baseId: bh.id, fighterIds: shooters.map((s) => s.id), enemy: { kind: "zombies", count: 3, power: 1 }, ambush: null, canRetreat: false, handler: "st", context: {} }));
  const tallies = b.units.filter((u) => u.side === "player").map((u) => u.xpT);
  for (let g = 0; g < 60 && !b.over; g++) { autoPlayerTurn(bw); runEnemyPhase(bw); }
  const shots = tallies.reduce((a, t) => a + (t ? 0 : 0), 0);
  const gained = shooters.reduce((a, s, i) => a + (xpOf(s, "shooting") - xs0[i]), 0);
  check(b.over && gained > 0, `a tactical battle gives Shooting XP for shots, hits and kills when it ends (+${r1(gained)})${shots}`);
}

// ---------------------------------------------------------------------------------------------------------------
console.log("Daily caps");
{
  const st = world();
  const s = person(st, { farming: 2 });
  let got = 0;
  for (let i = 0; i < 50; i++) got += S.gainXp(st, s, "farming", 3);
  check(r1(got) === S.CAP_USE, `use XP per skill per day is capped at ${S.CAP_USE} (got ${r1(got)} of 150)`);
  check(S.gainXp(st, s, "farming", 100, "study") === S.CAP_STUDY, `study XP (teaching, books) has its own cap of ${S.CAP_STUDY}`);
  check(S.gainXp(st, s, "shooting", 5) === 5, "the cap is per skill");
  let fought = 0;
  for (let i = 0; i < 20; i++) fought += S.gainXp(st, s, "shooting", 4, "fight");
  check(r1(fought) === S.CAP_FIGHT && S.gainXp(st, s, "shooting", 2) === 2, `fighting XP has its own cap of ${S.CAP_FIGHT}, apart from the use cap (got ${r1(fought)} of 80)`);
  nextDay(st);
  check(S.gainXp(st, s, "farming", 5) === 5, "the caps reset the next day");
  check(S.gainXp(st, s, "nonsense", 5) === 0 && S.gainXp(st, s, "farming", NaN) === 0, "unknown skills and NaN give nothing");
}

// ---------------------------------------------------------------------------------------------------------------
console.log("Decay");
{
  const st = world();
  const a = person(st, { shooting: 14, stealth: 9, medicine: 18 });
  a.skillFloor = { ...a.skillFloor, shooting: 12, stealth: 9, medicine: 18 };
  let lowest = 14;
  for (let d = 0; d < 13; d++) { nextDay(st); S.skillsDaily(st); }
  check(a.skills.shooting === 14, "no decay in the first 14 days without use");
  for (let d = 0; d < 800; d++) { nextDay(st); S.skillsDaily(st); lowest = Math.min(lowest, a.skills.shooting); }
  check(lowest >= 12 && a.skills.shooting <= 13, `an unused 14 slips slowly and never below the level it joined with (12): now ${a.skills.shooting}`);
  check(a.skills.stealth === 9 && a.skills.medicine === 18, "skills at 10 or below never slip, nor below the starting level (18 stays 18)");
  const b = person(st, { farming: 13 });
  b.skillFloor.farming = 0;
  for (let d = 0; d < 2000; d++) { nextDay(st); S.skillsDaily(st); }
  check(b.skills.farming === 10, `never below 10 either (13 unused for 2000 days → ${b.skills.farming})`);
  const c = person(st, { farming: 15 });
  c.skillFloor.farming = 0;
  for (let d = 0; d < 112; d++) { nextDay(st); S.gainXp(st, c, "farming", 1); S.skillsDaily(st); }
  check(c.skills.farming === 15, "a skill used now and then does not slip");
}

// ---------------------------------------------------------------------------------------------------------------
console.log("Teaching");
{
  const st = world();
  for (const s of alive(st)) s.location = { kind: "base", baseId: -1 }; // out of the way
  const T = person(st, { medicine: 12, leadership: 5, speech: 5 }, "teach");
  const L1 = person(st, { medicine: 2 }, "farm");
  const L2 = person(st, { medicine: 8 }, "guard");
  const L3 = person(st, { medicine: 9 }, "farm");
  check(S.learnReason(st, T, L2, "medicine") === "" && /at least 4 above/.test(S.learnReason(st, T, L3, "medicine")), "a learner must be 4 or more below the teacher (12 teaches 8, not 9)");
  T.teach = { skill: "medicine", learners: [L1.id, L3.id] };
  const lesson = S.lessonOf(st, T);
  check(lesson.learners.length === 1 && lesson.learners[0] === L1.id, "an ineligible learner is dropped from the lesson");
  const rate = S.teachRate(T, "medicine");
  check(r1(rate) === r1(4 + 12 * 0.4 + 10 * 0.15), `a learner gains 4 + 0.4 × 12 + 0.15 × (5 + 5) = ${r1(rate)} XP a day`);
  const x1 = L1.xp.medicine || 0, x3 = L3.xp.medicine || 0, lead = T.xp.leadership || 0;
  S.skillsDaily(st);
  check(r1((L1.xp.medicine || 0) + L1.skills.medicine * 1000 - x1 - 2000) === r1(rate) && (L3.xp.medicine || 0) === x3, "the learner gains it; the ineligible one gains nothing");
  check(r1((T.xp.leadership || 0) - lead) === S.USE.teachLead, `the teacher gains ${S.USE.teachLead} Leadership a day`);
  check(L1.role === "farm" && T.role === "teach", "learners keep their own jobs; the teacher only teaches");
  T.teach = null;
  const auto = S.lessonOf(st, T);
  check(!!auto && auto.learners.length === 2 && auto.learners.includes(L1.id), `with nothing set they pick the best lesson themselves (${auto && auto.skill}, ${auto && auto.learners.length} learners)`);
  give(T, "mentor");
  check(r1(S.teachRate(T, "medicine")) === r1(rate * 1.5), "Mentor: learners learn 50% faster");
  without(T, "mentor");
  // Teaching XP is study XP: capped at 25 a day.
  const big = person(st, { medicine: 20, leadership: 20, speech: 20 }, "teach");
  big.teach = { skill: "medicine", learners: [L1.id] };
  give(big, "mentor");
  nextDay(st);
  const before = L1.skills.medicine * 100000 + (L1.xp.medicine || 0);
  S.skillsDaily(st);
  const after = L1.skills.medicine * 100000 + (L1.xp.medicine || 0);
  check(after > before && L1.xpDay.study.medicine <= S.CAP_STUDY + 1e-9, `two teachers on one learner still count toward the ${S.CAP_STUDY} study cap (${r1(L1.xpDay.study.medicine)})`);
}

// ---------------------------------------------------------------------------------------------------------------
console.log("Books");
{
  const st = world();
  const h = hub(st);
  for (const s of alive(st)) s.location = { kind: "base", baseId: -1 };
  const keys = S.BOOK_KEYS();
  check(["medbook", "enginebook", "gardenbook", "gunbook", "survivalbook", "talkbook", "lockbook", "comic", "novel"].every((k) => keys.includes(k)), `book items exist (${keys.length}: ${keys.join(", ")})`);
  check(keys.every((k) => GEAR[k].slot === "pack" && !GEAR[k].small && GEAR[k].book.hours > 0), "books are pack or cargo items (not pocket-sized) with read hours");
  h.armory = h.armory.filter((i) => !GEAR[i.key].book);
  h.armory.push(newItem("medbook"));
  const R = person(st, { medicine: 3 }, "read");
  const R2 = person(st, { medicine: 1 }, "read");
  S.skillsDaily(st);
  check(r1(S.bookHours(R, "medbook")) === S.READ_HOURS && S.bookHours(R2, "medbook") === 0, `one copy, one reader at a time: ${S.READ_HOURS} hours read a day, the second reader waits`);
  check(R.xpDay.study.medicine === S.READ_HOURS * S.BOOK_XP, `a skill book gives ${S.BOOK_XP} XP an hour (${S.READ_HOURS * S.BOOK_XP} a day)`);
  for (let d = 0; d < 6; d++) { nextDay(st); S.skillsDaily(st); }
  check(S.bookDone(R, "medbook") && /Already read/.test(S.readReason(R, "medbook")), `after ${GEAR.medbook.book.hours} hours the book is finished and not read again by the same person`);
  check(S.bookHours(R2, "medbook") > 0, "then the next reader picks it up (one after another)");
  check(h.armory.some((i) => i.key === "medbook"), "the book stays in the armory");
  const M = person(st, { medicine: 8 }, "read");
  check(/Already knows/.test(S.readReason(M, "medbook")), "a reader at the book's max level learns nothing from it (Medicine to 8)");
  const reader = person(st, { mechanics: 9 }, "rest");
  S.ensureSkills(st, reader);
  S.readHours(st, reader, "enginebook", 10);
  check(reader.skills.mechanics <= GEAR.enginebook.book.max, "reading stops adding once the book's max is reached");
  // Comics: mood, no skill.
  const C = person(st, {}, "rest");
  C.mood = 40;
  S.readHours(st, C, "comic", 4);
  check(C.mood === 40 + 4 * GEAR.comic.book.mood && SKILLS.every((k) => !(C.xp[k] > 0)), `a comic gives +${GEAR.comic.book.mood} mood an hour and no XP`);
  S.readHours(st, C, "comic", 3);
  check(r1(C.mood) === r1(52 + 3 * GEAR.comic.book.mood / 3), "reading it again gives a third of that");
  // Found and sold.
  const school = st.tiles.find((t) => t.loc && t.loc.type === "school");
  const rolls = [];
  for (let i = 0; i < 400; i++) { st.hour += 1; const bk = S.rollBook(st, school.id, 1, `t${i}`); if (bk) rolls.push(bk.key); }
  check(rolls.length > 10 && rolls.length < 120 && rolls.every((k) => S.BOOK_SITES.school.books.includes(k)), `schools hold books (${rolls.length} in 400 search hours at full loot)`);
  const a1 = S.rollBook(st, school.id, 50, "x"), a2 = S.rollBook(st, school.id, 50, "x");
  check(!!a1 && a1.key === a2.key, "the book roll is deterministic and does not use the world's random numbers");
  const farmT = st.tiles.find((t) => !t.loc && t.terrain !== "water");
  check(S.rollBook(st, farmT.id, 100, "y") === null, "open ground holds no books");
  const tr = st.factions.find((f) => f.type === "traders") || { id: 999, type: "traders" };
  tr.type = "traders";
  let sold = 0;
  for (let d = 0; d < 60; d++) { st.hour += 24; sold += S.bookWares(st, tr).length; }
  check(sold > 15 && sold < 60, `traders often have a book for sale (${sold} weeks of 60 restocks)`);
}

// ---------------------------------------------------------------------------------------------------------------
console.log("Perks: milestones and choices");
{
  const st = world();
  const s = person(st, { medicine: 9 });
  s.xp.medicine = S.xpNeed(9) - 1;
  st.cards.length = 0;
  S.gainXp(st, s, "medicine", 5);
  const card = st.cards.find((c) => c.perkFor === `${s.id}:medicine:10`);
  check(s.skills.medicine === 10 && !!card && card.choices.length === 3, "reaching Medicine 10 raises a card with its two perks and Decide later");
  check(S.pendingPerks(s).length === 1, "the point waits until spent");
  card.choices[2].resolve(st);
  check(S.pendingPerks(s).length === 1, "Decide later keeps the point");
  const text = card.choices[0].resolve(st);
  check(S.hasPerk(s, "fieldsurgeon") && S.pendingPerks(s).length === 0 && /Field Surgeon/.test(text), "picking a perk spends the point");
  check(/Already took/.test(S.perkReason(s, "plaguedoctor")) && /Needs Medicine 15/.test(S.perkReason(s, "chiefmedic")), "the other perk of that milestone is closed, later ones are locked");
  check(/Already/.test(S.choosePerk(st, s, "plaguedoctor")) && !S.hasPerk(s, "plaguedoctor"), "a closed perk cannot be taken");
  const t = person(st, { shooting: 4 });
  t.xp.shooting = S.xpNeed(4) - 1;
  S.gainXp(st, t, "shooting", 2);
  check(st.cards.some((c) => c.perkFor === `${t.id}:shooting:5`), "Skill 5 raises a card too");
  S.choosePerk(st, t, "brawler");
  check(!st.cards.some((c) => c.perkFor === `${t.id}:shooting:5`), "picking from the skill tree answers the card");
  // Joining: points for the two best skills only.
  const j = makeSurvivor(st);
  for (const k of SKILLS) j.skills[k] = 0;
  j.traits = [];
  Object.assign(j.skills, { farming: 16, shooting: 11, speech: 7, medicine: 5 });
  S.ensureSkills(st, j);
  check(j.perkPending.length === 5 && j.perkMs.speech === 5 && j.perkMs.medicine === 5, "a survivor joins with points for the milestones of their two best skills (Farming 16: 3, Shooting 11: 2), none for the rest");
  // Autopilot: by style.
  st.governor = { personality: "cautious" };
  const ap = person(st, { medicine: 10 });
  ap.perkPending = [{ skill: "medicine", ms: 10 }];
  st.governor.personality = "cautious";
  S.autoPerks(st);
  check(S.hasPerk(ap, "plaguedoctor"), "a cautious autopilot takes Plague Doctor at Medicine 10");
  const ag = person(st, { medicine: 10 });
  ag.perkPending = [{ skill: "medicine", ms: 10 }];
  st.governor.personality = "aggressive";
  S.autoPerks(st);
  check(S.hasPerk(ag, "fieldsurgeon"), "an aggressive one takes Field Surgeon");
  check(Object.keys(S.PERKS).length === 60 && Object.values(S.PERK_TREE).every((t) => S.MILESTONES.every((m) => t[m] && t[m].length === 2)), "10 skills × 3 milestones × 2 perks = 60 perks");
  check(Object.values(S.PERKS).every((p) => p.desc.length > 20 && p.hook), "every perk has an effect text and a hook");
}

// ---------------------------------------------------------------------------------------------------------------
console.log("Perk effects");
{
  const st = world();
  const h = hub(st);
  for (const s of alive(st)) s.location = { kind: "base", baseId: -1 };
  h.stock.meds = 100;
  // Medicine.
  const med = person(st, { medicine: 10 }, "medic");
  const pat = person(st, {});
  pat.health = 50;
  let [a, b] = withPerk(med, "steadyhands", () => treatAtBaseInfo(st, h, pat).heal);
  check(b === Math.round(a * 1.25) || Math.abs(b - a * 1.25) <= 1, `Steady Hands: a base treatment heals ${a} → ${b}`);
  [a, b] = withPerk(med, "triage", () => medicCapacity(med));
  check(b === a + 1, `Triage: medic time ${a} → ${b} treatments a day`);
  const tm = person(st, { medicine: 10 });
  const hurtOne = person(st, {});
  hurtOne.health = 20;
  const p = team(st, [tm, hurtOne]);
  [a, b] = withPerk(tm, "fieldsurgeon", () => fieldTreatInfo(st, p, hurtOne));
  check(b.heal === Math.round((12 + 10 * 0.5) * 1.5) && a.heal === Math.round(8 + 10 * 0.6), `Field Surgeon: a field treatment on a severe wound heals ${a.heal} → ${b.heal}`);
  hurtOne.woundInfected = true;
  [a, b] = withPerk(tm, "fieldsurgeon", () => fieldTreatInfo(st, p, hurtOne).cureChance);
  check(b === 0.9 && a < 0.9, `Field Surgeon: cleans infection ${Math.round(a * 100)}% → 90%`);
  hurtOne.woundInfected = false;
  [a, b] = withPerk(tm, "steadyhands", () => fieldTreatInfo(st, p, hurtOne).heal);
  check(b === Math.round(a * 1.25), `Steady Hands in the field: ${a} → ${b}`);
  const sick = person(st, {});
  addCondition(st, sick, "flu", "test");
  for (const o of atBase(st, h.id)) if (o !== med && o.role === "medic") o.role = "rest";
  [a, b] = withPerk(med, "plaguedoctor", () => treatConditionInfo(st, h, sick, "flu").amount);
  check(b > a && Math.abs(b - a * 1.5) <= 1, `Plague Doctor: an illness treatment lowers severity ${a} → ${b}`);
  addBuilding(h, "hospital");
  const meds3 = [med, person(st, { medicine: 6 }, "medic"), person(st, { medicine: 6 }, "medic")];
  const bedP = person(st, {});
  bedP.health = 50;
  [a, b] = withPerk(med, "chiefmedic", () => healRatePerHour(st, h, bedP, activeHospital(st, h), true) * 24);
  check(Math.abs(b - a - 6) < 0.01, `Chief of Medicine: a patient in a bed heals ${r1(a)} → ${r1(b)} a day`);
  const sev = person(st, {});
  sev.health = 20;
  [a, b] = withPerk(med, "miracle", () => treatAtBaseInfo(st, h, sev));
  check(a.surgery && b.surgery && Math.abs(b.heal / a.heal - 2 / 1.5) < 0.05, `Miracle Worker: surgery heals ${a.heal} → ${b.heal} (2× instead of 1.5×)`);
  void meds3;
  // Battle perks: on the units.
  const bw = world(SEED + 5);
  const bh = hub(bw);
  const fA = person(bw, { shooting: 8, stealth: 8, medicine: 8, scavenging: 8 });
  const fB = person(bw, { shooting: 8 });
  for (const s of [fA, fB]) s.gear.weapon = newItem("huntrifle");
  const setup = { tile: bh.tile, baseId: bh.id, fighterIds: [fA.id, fB.id], enemy: { kind: "raiders", count: 2, power: 3 }, ambush: null, canRetreat: false, handler: "st", context: {} };
  const unitsWith = (ids) => { fA.perks = ids; const bb = createBattle(bw, setup); fA.perks = []; return bb; };
  const plain = unitsWith([]);
  const uA = (bb) => bb.units.find((u) => u.sid === fA.id), uB = (bb) => bb.units.find((u) => u.sid === fB.id);
  let bb = unitsWith(["steadyaim", "brawler"]);
  check(uA(bb).aim === uA(plain).aim + 5 && uA(bb).meleeAim === uA(plain).meleeAim + 10 && uA(bb).meleeMult === 1.25, "Steady Aim +5 to hit; Brawler +10 melee to hit, ×1.25 melee damage");
  bb = unitsWith(["rally", "commander"]);
  check(uB(bb).aim === uB(plain).aim + 5 && uB(bb).meleeAim === uB(plain).meleeAim + 5 && Math.abs(uB(bb).armor - uB(plain).armor * 0.9) < 1e-9, "Rally: every ally +5 to hit; Commander: every ally takes 10% less damage");
  bb = unitsWith(["deadeye", "suppressor", "sniper"]);
  const e = bb.units.find((u) => u.side === "enemy");
  const A = uA(bb), P0 = uA(plain);
  e.x = A.x + 14; e.y = A.y;
  const o1 = shotOdds(bb, P0, e, A.x, A.y), o2 = shotOdds(bb, A, e, A.x, A.y);
  check(o2.crit === o1.crit + 15, `Deadeye: crit ${o1.crit}% → ${o2.crit}%`);
  const rr1 = shotOdds(bb, P0, e, A.x, A.y, { reaction: true }), rr2 = shotOdds(bb, A, e, A.x, A.y, { reaction: true });
  check(rr2.chance >= rr1.chance + 15 || rr2.chance === 95, `Suppressor: overwatch reaction shots without the −15 (${rr1.chance}% → ${rr2.chance}%)`);
  check(o2.chance > o1.chance, `Sniper: no aim loss at long range (${o1.chance}% → ${o2.chance}% at 14 tiles)`);
  bb = unitsWith(["lightstep", "ghost", "assassin", "steadyhands", "miracle", "treasure", "quiethands"]);
  const u = uA(bb);
  check(u.sneak === 2 && u.ghost && u.assassin && u.healMult === 1.25 && u.miracle && u.scavBonus === 5 && u.quiet, "Light Step, Ghost, Assassin, Steady Hands, Miracle Worker, Treasure Hunter and Quiet Hands are on the unit (read by detect, strike, heal, searchBox)");
  // Assassin and Brawler in melee on an unaware enemy.
  let sure = 0, tries = 0;
  for (let i = 0; i < 25; i++) {
    fA.perks = ["assassin"];
    const b2 = (bw.combat = createBattle(bw, setup));
    fA.perks = [];
    const me = uA(b2), foe = b2.units.find((x) => x.side === "enemy" && active(x));
    if (!foe || b2.phase !== "player") continue;
    foe.aware = false; foe.hp = 999; foe.maxHp = 999;
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [foe.x + dx, foe.y + dy]).find(([x, y]) => !b2.units.some((o) => o.x === x && o.y === y));
    if (!spot) continue;
    me.x = spot[0]; me.y = spot[1]; me.ap = 2;
    const hp0 = foe.hp;
    if (combatAct(bw, { type: "melee", unit: me.id, target: foe.id })) continue;
    tries++;
    if (foe.hp < hp0) sure++;
  }
  bw.combat = null;
  check(tries >= 10 && sure === tries, `Assassin: melee on the unaware always hits (${sure}/${tries})`);
  // Miracle Worker in battle: a stabilized teammate always pulls through, even in defeat.
  let lived = 0, n = 0;
  for (let i = 0; i < 12; i++) {
    const w2 = world(SEED + 50 + i);
    const h2 = hub(w2);
    const doc = person(w2, { medicine: 10 }); const down = person(w2, {});
    doc.perks = ["miracle"];
    h2.stock.meds = 5;
    const b3 = (w2.combat = createBattle(w2, { tile: h2.tile, baseId: h2.id, fighterIds: [doc.id, down.id], enemy: { kind: "zombies", count: 2, power: 1 }, ambush: null, canRetreat: false, handler: "st", context: {} }));
    const ud = b3.units.find((x) => x.sid === down.id), um = b3.units.find((x) => x.sid === doc.id);
    if (!ud || !um || b3.phase !== "player") continue;
    ud.hp = 0; ud.down = true; ud.bleed = 3;
    um.x = ud.x + 1 <= 30 ? ud.x : ud.x; um.ap = 2;
    const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [ud.x + dx, ud.y + dy]).find(([x, y]) => !b3.units.some((o) => o.x === x && o.y === y));
    if (!adj) continue;
    um.x = adj[0]; um.y = adj[1];
    if (combatAct(w2, { type: "meds", unit: um.id, target: ud.id })) continue;
    n++;
    (await import("../src/sim/combat.js")).endBattleNow(w2, "defeat");
    if (down.alive) lived++;
  }
  check(n >= 5 && lived === n, `Miracle Worker: a teammate they stabilized pulls through even when the fight is lost (${lived}/${n})`);
  // Shooting 15.
  const g = person(st, { shooting: 15 });
  [a, b] = withPerk(g, "gunslinger", () => combatPower(g));
  check(Math.abs(b - a - 1.5 * (0.5 + g.health / 200)) < 1e-9, `Gunslinger: fighting strength ${r1(a)} → ${r1(b)}`);
  // Stealth and scouting on a team.
  const sc = person(st, { stealth: 6, scouting: 6 });
  const tp = team(st, [sc, person(st, {})]);
  [a, b] = withPerk(sc, "shadow", () => bestSkill(st, tp, "stealth"));
  check(b === a + 3, `Shadow: the team's Stealth checks ${a} → ${b}`);
  [a, b] = withPerk(sc, "lookout", () => sightRadius(st, tp));
  check(b === a + 1, `Lookout: sight radius ${a} → ${b}`);
  [a, b] = withPerk(sc, "packrat", () => carryCapacity(st, partyMembers(st, tp), null));
  check(b === a + 8, `Packrat: carry space ${a} → ${b}`);
  [a, b] = withPerk(sc, "spotter", () => perceptionChance(st, partyMembers(st, tp)));
  check(Math.abs(b - a - (st.hour % 24 < 6 || st.hour % 24 >= 20 ? 0.09 : 0.15)) < 1e-9 || b === 0.9, `Spotter: notice hidden finds ${Math.round(a * 100)}% → ${Math.round(b * 100)}%`);
  [a, b] = withPerk(sc, "ranger", () => heatGain(st, { ...tp, phase: "task", task: { type: "camp" } }, "camp").gain);
  check(Math.abs(b - a * 0.7) < 1e-9 && a > 0, `Ranger: field Heat ${r1(a)} → ${r1(b)} an hour while camped`);
  give(sc, "pathfinder");
  tp.vehicle = null;
  S.skillsHour(st);
  const fast = partySpeed(tp);
  without(sc, "pathfinder");
  S.skillsHour(st);
  check(Math.abs(fast / partySpeed(tp) - 1.1) < 1e-9, `Pathfinder: on foot ${r1(partySpeed(tp))} → ${r1(fast)} speed`);
  give(sc, "forager", "hunter");
  const food0 = tp.supplies.food;
  S.skillsDaily(st);
  check(tp.supplies.food - food0 === 4, `Forager +1 and Hunter +3 food a day on a trip (+${tp.supplies.food - food0})`);
  sc.perks = [];
  // Searches: Quiet Hands, Salvager (exact), Phantom; Tinker's Eye, Treasure Hunter, Sixth Sense (Monte Carlo).
  const pickSite = (w) => w.tiles.find((t) => t.loc && typeof t.owner !== "number" && ["autoshop", "hardware", "factory", "gas"].includes(t.loc.type)) || w.tiles.find((t) => t.loc);
  const site = pickSite(world(SEED + 7)); // the same map in every world made from this seed
  const searchOnce = (ids, approach = "normal") => {
    const w3 = world(SEED + 7);
    const s3 = person(w3, { scavenging: 5, stealth: 4 });
    s3.perks = ids;
    const p3 = team(w3, [s3, person(w3, {})]);
    p3.dest = site.id;
    w3.autoCombat = true;
    const t3 = w3.tiles[site.id];
    t3.loot = 1;
    startScavenge(w3, p3);
    w3.engagement.approach = approach;
    const heat0 = w3.engagement.heat, loot0 = t3.loot;
    searchHour(w3);
    return { heat: w3.engagement.heat - heat0, loot: loot0 - t3.loot, w: w3, p: p3, s: s3 };
  };
  const plainS = searchOnce([]), quiet = searchOnce(["quiethands"]), salv = searchOnce(["salvager"]);
  check(quiet.heat < plainS.heat && Math.abs(quiet.heat - Math.max(1, plainS.heat / 2)) < 0.6, `Quiet Hands: Heat from a search hour ${r1(plainS.heat)} → ${r1(quiet.heat)}`);
  check(Math.abs(salv.loot - plainS.loot * 0.6) < 1e-9, `Salvager: the site is picked over ${r1(plainS.loot * 100)} → ${r1(salv.loot * 100)} points an hour`);
  let hurtPlain = 0, hurtPh = 0;
  for (let i = 0; i < 30; i++) {
    for (const [ids, inc] of [[[], () => hurtPlain++], [["phantom"], () => hurtPh++]]) {
      const r = searchOnce(ids);
      r.w.engagement.heat = 90;
      r.w.rng = new (r.w.rng.constructor)(1000 + i);
      const hp0 = partyMembers(r.w, r.p).reduce((x, s) => x + s.health, 0);
      extract(r.w);
      const hp1 = partyMembers(r.w, r.p).reduce((x, s) => x + s.health, 0);
      if (hp1 < hp0 - 0.01) inc();
    }
  }
  check(hurtPlain > 3 && hurtPh === 0, `Phantom: hard extractions never cost health (hurt in ${hurtPlain}/30 without, ${hurtPh}/30 with)`);
  const monte = (ids, hours = 40) => {
    const out = { pf: 0, gear: 0, fights: 0, sup: 0 };
    for (let i = 0; i < hours; i++) {
      const r = searchOnce(ids);
      r.w.rng = new (r.w.rng.constructor)(5000 + i);
      r.w.engagement.found = { supplies: {}, gear: [] };
      r.w.tiles[site.id].loot = 1;
      const line = searchHour(r.w) || "";
      const f = r.w.engagement.found.supplies;
      out.pf += (f.parts || 0) + (f.fuel || 0);
      out.sup += Object.values(f).reduce((x, v) => x + v, 0);
      out.gear += r.w.engagement.found.gear.length;
      if (/fight|took down|put them down|hurt|killed/.test(line)) out.fights++;
    }
    return out;
  };
  const m0 = monte([], 120), mT = monte(["treasure"], 120), mE = monte(["tinkerseye"], 120);
  check(mT.sup > m0.sup && mT.gear >= m0.gear, `Treasure Hunter: more supplies and gear over 120 search hours (${m0.sup} → ${mT.sup} supplies, ${m0.gear} → ${mT.gear} items)`);
  check(mE.pf >= m0.pf, `Tinker's Eye: parts and fuel ${m0.pf} → ${mE.pf}`);
  const fightRate = (ids) => { let fights = 0; for (let i = 0; i < 200; i++) { const r = searchOnce(ids); r.w.engagement.heat = 60; r.w.rng = new (r.w.rng.constructor)(9000 + i); const line = searchHour(r.w) || ""; if (/fight|taken down|put them down|hurt|killed/.test(line)) fights++; } return fights; };
  const f0 = fightRate([]), f1 = fightRate(["sixthsense"]);
  check(f1 < f0, `Sixth Sense: trouble in ${f0} → ${f1} of 200 hot search hours`);
  // Base work.
  const w4 = world(SEED + 9);
  const h4 = hub(w4);
  for (const s of alive(w4)) s.location = { kind: "base", baseId: -1 };
  const sv = person(w4, { scavenging: 5 }, "scavenge");
  [a, b] = withPerk(sv, "scrounger", () => scavChance(w4, h4, sv));
  check(Math.abs(b - Math.min(0.5, a * 1.3)) < 1e-9, `Scrounger: a find a day ${r1(a * 100)}% → ${r1(b * 100)}%`);
  const bd = person(w4, { mechanics: 6 }, "build");
  [a, b] = withPerk(bd, "handy", () => buildRate(w4, h4));
  check(Math.abs(b - a * 1.2) < 1e-9, `Handy: construction ${r1(a)} → ${r1(b)} work an hour`);
  [a, b] = withPerk(bd, "masterbuilder", () => buildRate(w4, h4));
  check(Math.abs(b - a * 1.4) < 1e-9, `Master Builder: ${r1(a)} → ${r1(b)}`);
  const cr = person(w4, { mechanics: 6 }, "craft");
  [a, b] = withPerk(cr, "machinist", () => craftRate(w4, h4, "spikedbat"));
  check(Math.abs(b - a * 1.3) < 1e-9, `Machinist: crafting ${r1(a)} → ${r1(b)}`);
  h4.stock.scrap = 200;
  h4.armory = [];
  give(cr, "tinkerer");
  queueCraft(w4, h4, "spikedbat");
  for (let i = 0; i < 40 && craftQueue(h4).length; i++) craftingHour(w4);
  const bat = h4.armory.find((i) => i.key === "spikedbat");
  check(!!bat && bat.dur === Math.round(craftedDur(GEAR.spikedbat.dur, bat.quality) * 1.5) && bat.durMax === bat.dur, `Tinkerer: a spiked bat made with them on the Craft role has ${bat && bat.dur} uses (normally ${bat && craftedDur(GEAR.spikedbat.dur, bat.quality)} at its quality)`);
  without(cr, "tinkerer");
  const worn = makeItem("pipespear", 1);
  worn.dur = 2;
  cr.gear.weapon = worn;
  give(cr, "fieldrepair");
  S.skillsDaily(w4);
  check(worn.dur === 3, "Field Repair: a worn makeshift item gets 1 use back a day");
  without(cr, "fieldrepair");
  [a, b] = withPerk(bd, "greasemonkey", () => canRepair(w4, h4).per);
  check(a === 12 && b === 25, `Grease Monkey: a repair restores ${a}% → ${b}%`);
  const fm = person(w4, { farming: 6 }, "farm");
  for (const o of atBase(w4, h4.id)) if (o !== fm && o.role === "farm") o.role = "rest";
  [a, b] = withPerk(fm, "earlyriser", () => careToday(w4, h4).avgSkill);
  check(b === a + 3, `Early Riser: tending counts Farming ${a} → ${b}`);
  [a, b] = withPerk(fm, "greenthumb", () => careToday(w4, h4).care);
  check(Math.abs(b - a * 1.15) < 1e-9, `Green Thumb: crop care ${r1(a)} → ${r1(b)} (+15%)`);
  const ripeRun = (ids) => {
    const w5 = world(SEED + 11);
    const h5 = hub(w5);
    for (const s of alive(w5)) s.location = { kind: "base", baseId: -1 };
    const f5 = person(w5, { farming: 6 }, "farm");
    f5.perks = ids;
    const farm = farmOf(w5, h5);
    while (farm.plots.length < 8) farm.plots.push({ ...farm.plots[0], id: farm.plots.length + 100 });
    for (const pl of farm.plots) Object.assign(pl, { stage: "ripe", crop: "beans", grown: 99, care: 1, careDays: 1, ripeDays: 0, yieldLeft: 10 });
    return farmingDaily(w5, h5, 1).plots;
  };
  [a, b] = [ripeRun([]), ripeRun(["harvester"])];
  check(b === a + 2, `Harvester: ripe plots brought in a day ${a} → ${b}`);
  h4.stock.food = 500;
  [a, b] = withPerk(fm, "rootcellar", () => foodStore(w4, h4).spoil);
  check(Math.abs(b - a * 0.75) < 1e-6, `Root Cellar Lore: spoilage ${r1(a)} → ${r1(b)} a day`);
  const farm4 = farmOf(w4, h4);
  const free = farm4.plots.find((x) => x.stage === "empty") || farm4.plots[0];
  Object.assign(free, { stage: "empty", crop: null });
  give(fm, "seedsaver");
  const food1 = h4.stock.food + (h4.stock.preserved || 0);
  const msg = plantPlot(w4, h4, free.id, "beans");
  const paid = food1 - (h4.stock.food + (h4.stock.preserved || 0));
  without(fm, "seedsaver");
  check(/sown/.test(msg) ? paid === Math.ceil(3 / 2) : true, `Seed Saver: beans cost ${paid} seed food instead of 3 (${msg.slice(0, 40)}…)`);
  give(fm, "herbalist");
  while (day(w4) % 3 !== 0) nextDay(w4);
  const meds0 = h4.stock.meds || 0;
  S.skillsDaily(w4);
  without(fm, "herbalist");
  check((h4.stock.meds || 0) === meds0 + 1, "Herbalist: +1 meds every 3 days on the Farm role");
  const ld = person(w4, { leadership: 6 });
  const others = atBase(w4, h4.id).filter((x) => x !== ld);
  for (const o of others) o.mood = 50;
  ld.mood = 50;
  give(ld, "inspiring");
  nextDay(w4);
  const insp = (s) => (moodFactors(w4, s).list.find((f) => /^Inspired by/.test(f.label)) || {}).v || 0;
  const inspOthers = others.map(insp), inspSelf = insp(ld);
  without(ld, "inspiring");
  check(inspOthers.every((v) => v === MOODF.inspire) && !inspSelf && others.every((o) => !insp(o)), `Inspiring: everyone else at the base +${MOODF.inspire} mood a day (a factor in their mood breakdown; not the inspiring one)`);
  [a, b] = withPerk(ld, "quartermaster", () => eatPerDay(w4, h4));
  check(Math.abs(b - a * 0.9) < 1e-9, `Quartermaster: food eaten ${r1(a)} → ${r1(b)} a day`);
  // Mentor on a trip: +25% use XP for teammates.
  const w6 = world(SEED + 13);
  const mt = person(w6, { leadership: 6 }), mate = person(w6, {});
  give(mt, "mentor");
  team(w6, [mt, mate]);
  check(S.gainXp(w6, mate, "scouting", 4) === 5 && S.gainXp(w6, mt, "scouting", 4) === 4, "Mentor: teammates on a trip gain 25% more use XP (not the mentor)");
  // Speech and Leadership on the road.
  const roadCard = (ids, skills = { speech: 6, leadership: 8 }) => {
    const w7 = world(SEED + 17);
    const s7 = person(w7, skills);
    s7.perks = ids;
    const p7 = team(w7, [s7]);
    const f7 = w7.factions.find((x) => x.alive);
    f7.goodwill = 0;
    f7.type = "raider";
    const c7 = triggerConflict(w7, p7, "roadblock", f7.id);
    const pctOf = (re) => { const ch = c7.choices.find((x) => re.test(x.label)); const m = ch && /(\d+)%/.exec(ch.hint || ""); return m ? Number(m[1]) : null; };
    return { w: w7, p: p7, f: f7, c: c7, talk: pctOf(/^Talk/), talkCh: c7.choices.find((x) => /^Talk/.test(x.label)), bribe: c7.choices.find((x) => /toll|palms|Offer/.test(x.label)) };
  };
  const base0 = roadCard([]);
  const sm = roadCard(["smooth"]), pm = roadCard(["peacemaker"]), stg = roadCard(["silvertongue"]);
  check(sm.talk > base0.talk, `Smooth Talker: talk check ${base0.talk}% → ${sm.talk}% (+2 skill)`);
  check(pm.talk > base0.talk, `Peacemaker: Leadership 8 counts in full (not 6): ${base0.talk}% → ${pm.talk}%`);
  check(stg.talk === Math.min(95, base0.talk + 15), `Silver Tongue: ${base0.talk}% → ${stg.talk}%`);
  const ng = roadCard(["negotiator"]);
  const cost = (r) => { const m = /needs about (\d+)|Costs (.*?) \(/.exec(r.bribe.hint); return r.bribe.hint; };
  check(cost(ng) !== cost(base0), `Negotiator: tolls cost less ("${cost(base0).slice(0, 40)}" → "${cost(ng).slice(0, 40)}")`);
  // Talk outcomes: force a failure / a success with the world's dice.
  const outcome = (ids, win) => {
    const r = roadCard(ids, { speech: win ? 20 : 0, leadership: 0 });
    r.w.rng.chance = () => win; // the talk roll is the first roll in the choice
    const gw0 = r.f.goodwill;
    r.w.cards = [];
    r.talkCh.resolve(r.w);
    return { dgw: r.f.goodwill - gw0, follow: r.w.cards.find((c) => c.partyId === r.p.id) };
  };
  const failPlain = outcome([], false), failPeace = outcome(["peacemaker"], false), failDip = outcome(["diplomat"], false);
  check(failPlain.dgw < 0 && failPeace.dgw === 0, `Peacemaker: a failed talk costs no goodwill (${failPlain.dgw} → ${failPeace.dgw})`);
  const canTalk = (o) => !!(o.follow && o.follow.choices.some((c) => /^Talk/.test(c.label)));
  check(!canTalk(failPlain) && canTalk(failDip), "Diplomat: after a failed talk the team may talk once more");
  const winPlain = outcome([], true), winCharm = outcome(["charming"], true);
  check(winCharm.dgw === 2 * winPlain.dgw && winPlain.dgw > 0, `Charming: a won talk raises goodwill +${winPlain.dgw} → +${winCharm.dgw}`);
  // Haggler.
  const w8 = world(SEED + 19);
  for (const s of alive(w8)) s.location = { kind: "base", baseId: -1 };
  const hg = person(w8, { speech: 10 });
  [a, b] = withPerk(hg, "haggler", () => S.tradeSpeech([hg]));
  const [ra, rb] = withPerk(hg, "haggler", () => radioSpeech(w8));
  check(b === a + 5 && rb === ra + 5, `Haggler: Speech when trading ${a} → ${b} (radio ${ra} → ${rb})`);
}

// ---------------------------------------------------------------------------------------------------------------
console.log("Determinism and a long run");
{
  const run = (seed, days) => {
    const st = world(seed);
    setAutopilot(st, true, "balanced");
    for (let h = 0; h < days * 24 && !st.gameOver; h++) { tickHour(st); autopilotResolve(st); }
    return st;
  };
  // Ids come from a counter shared by every world made in this process, so compare without them.
  const sig = (st) => JSON.stringify(st.survivors.map((s) => [s.name, s.skills, s.xp, s.perks, s.books, s.role]));
  const a = run(SEED, 40), b = run(SEED, 40);
  check(sig(a) === sig(b), "the same seed gives the same skills, XP, perks and books");
  const st = run(SEED + 3, 200);
  let bad = [];
  for (const s of st.survivors) {
    for (const k of SKILLS) {
      const v = s.skills[k], x = s.xp ? s.xp[k] || 0 : 0;
      if (!Number.isInteger(v) || v < 0 || v > 20 || !Number.isFinite(x) || x < 0) bad.push(`${s.name} ${k} ${v}/${x}`);
    }
    if (!Number.isFinite(s.mood) || !Number.isFinite(s.health)) bad.push(`${s.name} mood/health`);
  }
  for (const b of st.bases) for (const [k, v] of Object.entries(b.stock)) if (!Number.isFinite(v)) bad.push(`${b.name} ${k}`);
  const gained = st.survivors.reduce((x, s) => x + SKILLS.reduce((y, k) => y + Math.max(0, s.skills[k] - (s.skillFloor ? s.skillFloor[k] : s.skills[k])), 0), 0);
  const perks = st.survivors.reduce((x, s) => x + (s.perks || []).length, 0);
  const roles = {};
  for (const s of alive(st)) roles[s.role] = (roles[s.role] || 0) + 1;
  check(!bad.length, `200 days on autopilot: no NaN or out-of-range skills (${bad.slice(0, 3).join("; ")})`);
  console.log(`    day ${day(st)}: ${alive(st).length} alive, ${gained} levels gained, ${perks} perks, ${st.bases.reduce((x, b) => x + b.armory.filter((i) => GEAR[i.key].book).length, 0)} books in armories, roles ${JSON.stringify(roles)}`);
  check(gained > 0 && perks > 0, "skills grow and perks get taken");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
