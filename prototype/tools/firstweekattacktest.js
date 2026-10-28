// The first week's attack (sim/firstweekattack.js; the user's requests 2026-10-28), without a browser.
// Usage: node tools/firstweekattacktest.js
// - only while the first-week guide is on (not brought back by hand, not beside the autopilot), once a guide, and only
//   once its steps of days 1 to 6 are all done (g.ready, set by ui/guide.js guideCheck)
// - its hour picked on day 7 (from the seventh dawn, never before the guide is ready, LAST hours before the eighth),
//   with a warning; nothing before it
// - by day a nomad band made for it (looters, beside the base, half the people at home + 1): its card, Defend (the
//   base defence against the band's people) and Hide (a share of the stores carried off into its own), the band moving on
// - by night a horde of the dead made for it (the people at home + 3), the camp-attack card; Defend played out
// - waits while the hub is not ready; the window closed: a quiet night; the guide's step shown only once it comes;
//   saved with the guide; hooked into the hour
import { createWorld, tickHour, hub, homeAt, alive, isNight } from "../src/sim/world.js";
import "../src/ui/ui.js"; // the UI's modules in their usual order (ui/guide.js after it)
import { giveOrder } from "../src/sim/parties.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { FIRST_ATTACK, firstWeekHour, nightDawn } from "../src/sim/firstweekattack.js";
import { startGuide, guideCheck, guideSteps, GUIDE } from "../src/ui/guide.js";
import { nomadsOf } from "../src/sim/nomads.js";
import { readFileSync } from "node:fs";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const freshUi = () => ({ started: true, speed: 0, tab: "bases", selected: -1, baseView: null, expedition: null, diary: null });

// A Normal road start with its camp set up and the guide on from the first hour (ready: days 1 to 6 taken as done).
function camp(seed, { guide = true, ready = true } = {}) {
  const st = createWorld({ seed, factionCount: 5, mode: "normal", roadStart: true });
  st.noWanderers = true;
  const g = guide ? startGuide(st, true) : null;
  const p = roadTeam(st);
  Object.assign(p.cargo.supplies, { wood: 5, stone: 8 });
  p.pitched = true;
  giveOrder(st, p, "establish");
  st.cards.length = 0;
  st.nameAsk = [];
  for (const s of alive(st)) s.health = 100;
  if (st.nomads) st.nomads.bands.length = 0;
  if (g && ready) g.ready = st.hour;
  return { st, g, b: hub(st) };
}
const day7 = (g, h) => nightDawn(g, FIRST_ATTACK.NIGHT) - 24 + (h - 6) + (h < 6 ? 24 : 0); // an hour of the seventh day (and its night)
const cardAt = (st, b) => st.cards.find((c) => c.campAttack === b.id || c.firstWeek === b.id);
const fitOf = (st, b) => homeAt(st, b.id).filter((s) => (s.health ?? 100) >= FIRST_ATTACK.FIT);
const armedOf = (st, b) => fitOf(st, b).filter((s) => s.gear && (s.gear.weapon || s.gear.sidearm)).length;
const deadFor = (st, b) => Math.max(FIRST_ATTACK.DEAD[0], Math.min(FIRST_ATTACK.DEAD[1], 2 + armedOf(st, b) + Math.floor((fitOf(st, b).length - armedOf(st, b)) / 2)));
const holdShown = (g) => guideSteps(g).some((x) => x.id === "hold");
const holdDone = (st, g) => { const h = guideSteps(g).find((x) => x.id === "hold"); return !!h && h.done(st, g, freshUi()); };
// Run the hours with firstWeekHour alone, from one hour of day 7 to another (or until a card comes).
function hours(st, b, from, to) { for (st.hour = from; st.hour <= to; st.hour++) { firstWeekHour(st); if (cardAt(st, b)) return cardAt(st, b); } return null; }

section("Only while the guide is on, once");
{
  const { st, b } = camp(31, { guide: false });
  check(!hours(st, b, 7 * 24, 8 * 24) && !st.guide, "no guide: no attack");
  const c2 = camp(31);
  c2.g.keep = true; // brought back by hand
  check(!hours(c2.st, c2.b, day7(c2.g, 6), day7(c2.g, 2)) && !c2.g.attack, "a guide brought back by hand from the menu: no attack");
  const c3 = camp(31);
  c3.st.autopilot = { on: true };
  check(!hours(c3.st, c3.b, day7(c3.g, 6), day7(c3.g, 2)) && !c3.g.attack, "beside the autopilot: no attack");
}

section("Only once the steps of days 1 to 6 are done, on day 7");
{
  const { st, g, b } = camp(37, { ready: false });
  const log0 = st.log.length;
  check(!hours(st, b, day7(g, 6), day7(g, 3)) && !g.attack && g.attackAt == null && st.log.length === log0, "not ready: no warning and no attack all day 7 and its night");
  // The guide marks ready when every step of days 1 to 6 is done, and not before.
  const ui = freshUi();
  const early = guideSteps(g).filter((x) => x.phase < GUIDE.DAYS - 1);
  check(early.length && !early.some((x) => x.id === "hold") && guideSteps(g).filter((x) => x.phase === GUIDE.DAYS - 1).every((x) => ["found", "diary", "night7"].includes(x.id)), "day 7's own steps (the shelter, the diary, the night) are not needed");
  const c2 = camp(37, { ready: false });
  for (const x of early.slice(1)) c2.g.done[x.id] = 0;
  guideCheck(c2.st, ui);
  check(c2.g.ready == null, "one step of days 1 to 6 open: not ready");
  for (const x of early) c2.g.done[x.id] = 0;
  guideCheck(c2.st, ui);
  check(c2.g.ready === c2.st.hour, "all done: ready");
  // Ready before day 7: nothing until the seventh dawn, then the hour is picked, with a warning.
  const c3 = camp(41);
  check(!hours(c3.st, c3.b, day7(c3.g, 6) - 30, day7(c3.g, 6) - 1) && c3.g.attackAt == null, "ready on day 5 or 6: nothing before the seventh dawn");
  c3.st.hour = day7(c3.g, 6);
  firstWeekHour(c3.st);
  const [lo, hi] = [day7(c3.g, 6), nightDawn(c3.g, 7) - FIRST_ATTACK.LAST];
  check(c3.g.attackAt >= lo && c3.g.attackAt < hi && c3.g.warned === c3.st.hour && c3.st.log.some((l) => /something is coming/.test(l.text) && l.kind === "danger"), `the seventh dawn: its hour picked (${c3.g.attackAt % 24}:00, day 7 or its night) and a warning`);
  const at = c3.g.attackAt;
  check(!hours(c3.st, c3.b, c3.st.hour + 1, at - 1) && !c3.g.attack, "nothing before its hour");
  check(!!hours(c3.st, c3.b, at, at) && c3.g.attack.hour === at && c3.g.attack.kind === (isNight({ hour: at }) ? "dead" : "nomads"), `at its hour: ${c3.g.attack.kind} (${isNight({ hour: at }) ? "night" : "day"})`);
  // Readied late on day 7: the hour is picked from then.
  const c4 = camp(42, { ready: false });
  c4.st.hour = day7(c4.g, 15);
  c4.g.ready = c4.st.hour;
  firstWeekHour(c4.st);
  check(c4.g.attackAt >= c4.st.hour && c4.g.attackAt < nightDawn(c4.g, 7) - FIRST_ATTACK.LAST, `ready at 15:00 on day 7: picked for ${c4.g.attackAt % 24}:00, not before`);
}

section("By day: a nomad band made for it");
{
  const { st, g, b } = camp(38);
  b.stock.scrap = 40;
  const people = homeAt(st, b.id).length, bands0 = nomadsOf(st).length;
  g.attackAt = day7(g, 13); g.warned = g.attackAt;
  const card = hours(st, b, day7(g, 13), day7(g, 13));
  const n = Math.max(FIRST_ATTACK.NOMADS[0], Math.min(FIRST_ATTACK.NOMADS[1], Math.ceil(fitOf(st, b).length / 2) + 1));
  const band = nomadsOf(st).find((x) => x.id === (g.attack && g.attack.band));
  check(g.attack && g.attack.kind === "nomads" && g.attack.n === n && nomadsOf(st).length === bands0 + 1 && band && band.tier === 1 && band.pop === n, `13:00: a band of ${n} looters made for it, for ${people} at home (none on the map before)`);
  check(st.grid.distance(band.tile, b.tile) <= 1 && band.phase === "battle" && band.goodwill <= -50, `beside the base (${st.grid.distance(band.tile, b.tile)} away), hostile, held for the raid`);
  check(!!card && /^Nomads at /.test(card.title) && /broad daylight/.test(card.text) && /Defend/.test(card.choices[0].label) && /Hide/.test(card.choices[1].label) && card.raidReport, `the card: "${card && card.title}"`);
  check(holdShown(g) && !holdDone(st, g), "the guide's Hold off the attack: shown now, not done while the card waits");
  st.cards.splice(st.cards.indexOf(card), 1);
  card.choices.find((x) => x.default).resolve(st); // Defend: played out headless
  const gone = !nomadsOf(st).includes(band);
  check(!st.combat && holdDone(st, g) && (gone || band.phase !== "battle"), `defended: the fight over (the band ${gone ? "broken up" : `${band.pop} left, ${band.phase}`}), the step done`);
  // Hide: they carry off a share of the stores into their own, and move on.
  const c2 = camp(39);
  c2.b.stock.scrap = 40;
  c2.g.attackAt = day7(c2.g, 10);
  const card2 = hours(c2.st, c2.b, day7(c2.g, 10), day7(c2.g, 10));
  const band2 = nomadsOf(c2.st).find((x) => x.id === c2.g.attack.band);
  const bs0 = band2.stock.scrap || 0;
  c2.st.cards.splice(c2.st.cards.indexOf(card2), 1);
  card2.choices[1].resolve(c2.st);
  check(c2.b.stock.scrap === 30 && band2.stock.scrap === bs0 + 10 && band2.phase !== "battle" && c2.st.log.some((l) => /hid while/.test(l.text)) && holdDone(c2.st, c2.g), `hidden from: 10 of 40 scrap carried off into the band's own (theirs ${band2.stock.scrap}), the band moves on (${band2.phase}), the step done`);
}

section("By night: a horde of the dead made for it");
{
  const { st, g, b } = camp(32);
  const people = homeAt(st, b.id).length, armed = armedOf(st, b);
  g.attackAt = day7(g, 22);
  const n = deadFor(st, b);
  const card = hours(st, b, day7(g, 22), day7(g, 22));
  check(g.attack && g.attack.kind === "dead" && g.attack.n === n && b.campAttack.wave.d === n && n <= FIRST_ATTACK.DEAD[1], `22:00: a horde of ${n} dead for ${people} at home, ${armed} armed (2 + the armed + half the rest, at most ${FIRST_ATTACK.DEAD[1]})`);
  check(!!card && /A horde of the dead/.test(card.title) && card.text.includes(`horde of ${n} dead`) && !/Nearby|drawn to the camp/.test(card.text) && /Defend/.test(card.choices[0].label), `the camp-attack card in the horde's own words: "${card && card.text.slice(0, 80)}…"`);
  st.cards.splice(st.cards.indexOf(card), 1);
  card.choices.find((x) => x.default).resolve(st);
  check(!st.combat && !(b.campAttack && b.campAttack.wave) && holdDone(st, g), "defended: the fight over, the step done");
  const ld = loadFromString(saveToString(st));
  check(JSON.stringify(ld.guide.attack) === JSON.stringify(g.attack) && ld.guide.attackAt === g.attackAt, "saved with the guide");
  // A worn, unarmed crew meets a smaller horde (the playtest 2026-10-28: people + 3 overran one).
  const c2 = camp(43);
  for (const s of homeAt(c2.st, c2.b.id)) { s.gear.weapon = null; s.gear.sidearm = null; }
  for (const s of homeAt(c2.st, c2.b.id).slice(0, 1)) s.health = 30;
  c2.g.attackAt = day7(c2.g, 23);
  const fit = fitOf(c2.st, c2.b).length, want = Math.max(3, Math.min(6, 2 + Math.floor(fit / 2)));
  hours(c2.st, c2.b, day7(c2.g, 23), day7(c2.g, 23));
  check(c2.g.attack && c2.g.attack.n === want && want < homeAt(c2.st, c2.b.id).length + 3, `unarmed, one badly hurt: ${c2.g.attack && c2.g.attack.n} dead for ${fit} fit of ${homeAt(c2.st, c2.b.id).length}`);
}

section("Waits for the hub to be ready; a quiet night otherwise");
{
  const { st, g, b } = camp(34);
  g.attackAt = day7(g, 12);
  st.combat = { setup: {} };
  check(!hours(st, b, day7(g, 12), day7(g, 14)) && !g.attack, "a fight on: it waits");
  st.combat = null;
  check(!!hours(st, b, day7(g, 15), day7(g, 15)), "the fight over: it comes the next hour");
  const c2 = camp(35);
  c2.g.attackAt = day7(c2.g, 23);
  c2.st.combat = { setup: {} };
  hours(c2.st, c2.b, day7(c2.g, 23), day7(c2.g, 3));
  check(c2.g.attack && c2.g.attack.quiet && !cardAt(c2.st, c2.b) && !holdShown(c2.g), "never ready until the window closed: a quiet night, and no step shown");
}

section("Hooked into the hour");
{
  const { st, g, b } = camp(36);
  st.hour = day7(g, 6) - 1;
  let card = null;
  for (let i = 0; i < 24 && !card; i++) { tickHour(st); card = cardAt(st, b); if (!card) st.cards.length = 0; }
  check(!!card && g.attack && !g.attack.quiet, `the hours bring it (${card ? card.title : "none"}, at ${g.attack && g.attack.hour % 24}:00)`);
  const src = readFileSync(new URL("../src/sim/campscout.js", import.meta.url), "utf8");
  check(/firstWeekHour\(state\)/.test(src), "campscout.js groundsHour calls it");
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
