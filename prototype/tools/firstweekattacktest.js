// The first week's attack (sim/firstweekattack.js; the user's request 2026-10-28: "add a scripted raid on the base of a
// nomad group or horde at the end of the week"), without a browser.
// Usage: node tools/firstweekattacktest.js
// - only while the first-week guide is on (not brought back by hand, not beside the autopilot), once a guide, and only
//   once its steps of days 1 to 6 are all done (g.ready, set by ui/guide.js guideCheck; the user's request 2026-10-28)
// - the warning, the attack in the seventh night (21:00 to 03:00), the first hour the hub is ready
// - a nomad band on your trail first (drifters or looters, not friendly, within reach): it comes beside the base, a
//   raiding party of its own people; Defend (the band's dead off it) or Hide (a share of the stores carried off into
//   its own); it moves on after
// - else a horde of the dead (the people at home + 2, 3 to 8) or the land's raiders, drawn out of the land round the
//   base (nothing made), the base's card whatever the walls; the guide's "Hold off the attack" step ticks once it is over
// - nothing within reach, or the night gone by: a quiet night; saved with the guide; hooked into the hour
import { createWorld, tickHour, hub, homeAt, alive } from "../src/sim/world.js";
import "../src/ui/ui.js"; // the UI's modules in their usual order (ui/guide.js after it)
import { giveOrder } from "../src/sim/parties.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { openDead, openRaiders, putBack, putBackRaiders, drawFromTile, drawRaiders } from "../src/sim/deadpop.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { FIRST_ATTACK, firstWeekHour, nightDawn } from "../src/sim/firstweekattack.js";
import { startGuide, guideCheck, guideSteps, GUIDE_PHASES, GUIDE } from "../src/ui/guide.js";
import { nomadsOf, spawnNomads } from "../src/sim/nomads.js";
import { readFileSync } from "node:fs";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const freshUi = () => ({ started: true, speed: 0, tab: "bases", selected: -1, baseView: null, expedition: null, diary: null });

// A Normal road start with its camp set up and the guide on from the first hour (ready: days 1 to 6 taken as done), no
// nomad band on the map.
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
const reach = (st, b) => st.grid.within(b.tile, FIRST_ATTACK.REACH);
const deadNear = (st, b) => reach(st, b).reduce((a, t) => a + openDead(st, t), 0);
const raidersNear = (st, b) => reach(st, b).reduce((a, t) => a + openRaiders(st, t), 0);
const clearDead = (st, b) => { for (const t of reach(st, b)) drawFromTile(st, t, openDead(st, t)); };
const clearRaiders = (st, b) => { for (const t of reach(st, b)) drawRaiders(st, t, openRaiders(st, t)); };
const at = (g, h) => nightDawn(g, FIRST_ATTACK.NIGHT) - 24 + (h - 6) + (h < 6 ? 24 : 0); // an hour of the seventh day / night
const attackCard = (st, b) => st.cards.find((c) => c.campAttack === b.id);

section("Only while the guide is on, once");
{
  const { st, b } = camp(31, { guide: false });
  putBack(st, b.tile, null, 10);
  st.hour = 7 * 24 + 22;
  firstWeekHour(st);
  check(!attackCard(st, b) && !st.guide, "no guide: no attack");
  const c2 = camp(31);
  c2.g.keep = true; // brought back by hand
  putBack(c2.st, c2.b.tile, null, 10);
  c2.st.hour = at(c2.g, 22);
  firstWeekHour(c2.st);
  check(!attackCard(c2.st, c2.b) && !c2.g.attack, "a guide brought back by hand from the menu: no attack");
  const c3 = camp(31);
  c3.st.autopilot = { on: true };
  c3.st.hour = at(c3.g, 22);
  firstWeekHour(c3.st);
  check(!c3.g.attack, "beside the autopilot: no attack");
}

section("Only once the steps of days 1 to 6 are done");
{
  const { st, g, b } = camp(37, { ready: false });
  putBack(st, b.tile, null, 10);
  const log0 = st.log.length;
  for (const h of [6, 12, 21, 23, 2]) { st.hour = at(g, h); firstWeekHour(st); }
  check(!g.attack && g.warned == null && st.log.length === log0 && !attackCard(st, b), "not ready: no warning and no attack through the seventh day and night");
  st.hour = at(g, 3);
  firstWeekHour(st);
  check(!g.attack, "the night gone by: none after it either");
  // The guide marks ready when every step of days 1 to 6 is done, and not before.
  const ui = freshUi();
  const steps = guideSteps(g), early = steps.filter((x) => x.phase < GUIDE.DAYS - 1);
  check(early.length && steps.filter((x) => x.phase === GUIDE.DAYS - 1).every((x) => ["found", "diary", "hold", "night7"].includes(x.id)), "day 7's own steps (the shelter, the diary, the attack, the night) are not needed");
  for (const x of early.slice(1)) g.done[x.id] = 0;
  st.hour = at(g, 7);
  guideCheck(st, ui);
  check(g.ready == null || early.every((x) => g.done[x.id] != null), "one step of days 1 to 6 open: not ready");
  for (const x of early) g.done[x.id] = 0;
  guideCheck(st, ui);
  check(g.ready === st.hour, "all done: ready");
}

section("The warning, then a pack of the dead in the seventh night");
{
  const { st, g, b } = camp(32);
  clearRaiders(st, b);
  putBack(st, b.tile, null, 12);
  const people = homeAt(st, b.id).length;
  const log0 = st.log.length;
  st.hour = nightDawn(g, 6) - 1;
  firstWeekHour(st);
  check(g.warned == null && st.log.length === log0, "before the seventh dawn: nothing");
  st.hour = nightDawn(g, 6);
  firstWeekHour(st);
  const warn = st.log.find((l) => /watching/.test(l.text));
  check(g.warned === st.hour && !!warn && warn.kind === "danger" && !g.attack, `the seventh dawn: the warning ("${warn ? warn.text.slice(0, 70) : "none"}…")`);
  st.hour = at(g, 20);
  firstWeekHour(st);
  check(!g.attack && !attackCard(st, b), "20:00: not yet");
  const near0 = deadNear(st, b);
  st.hour = at(g, 21);
  firstWeekHour(st);
  const want = Math.max(FIRST_ATTACK.DEAD[0], Math.min(FIRST_ATTACK.DEAD[1], people + 2));
  const card = attackCard(st, b);
  check(g.attack && g.attack.kind === "dead" && g.attack.n === want && g.attack.base === b.id, `21:00, no nomads near: a horde of ${g.attack && g.attack.n} dead for ${people} at home (want ${want})`);
  check(!!card && /A horde of the dead/.test(card.title) && /gathering/.test(card.text) && card.choices.length === 2 && /Defend/.test(card.choices[0].label), `the base's card: "${card && card.title}"`);
  check(deadNear(st, b) === near0 - g.attack.n && b.campAttack.wave.d === g.attack.n, `drawn out of the land round the base (${near0} → ${deadNear(st, b)}): nothing made`);
  const n = st.cards.length;
  st.hour += 1;
  firstWeekHour(st);
  check(st.cards.length === n, "once a guide");
  const hold = () => guideSteps(g).find((x) => x.id === "hold").done(st, g, freshUi());
  check(GUIDE_PHASES.road[6].ids.includes("hold") && !hold(), "the guide's Hold off the attack: not while the card waits");
  st.cards.splice(st.cards.indexOf(card), 1);
  card.choices.find((x) => x.default).resolve(st); // Defend: the base defence, played out headless
  check(!st.combat && !(b.campAttack && b.campAttack.wave) && hold(), "defended: the fight over, the step ticks");
  check(deadNear(st, b) <= near0, `nothing from nowhere: the land round the base ${near0} → ${deadNear(st, b)}`);
  const ld = loadFromString(saveToString(st));
  check(JSON.stringify(ld.guide.attack) === JSON.stringify(g.attack) && ld.guide.warned === g.warned, "saved with the guide");
}

section("A nomad band on your trail comes first");
{
  const { st, g, b } = camp(38);
  putBack(st, b.tile, null, 10); // the dead about too: the band still comes first
  const far = st.grid.within(b.tile, 20).find((t) => st.grid.distance(b.tile, t) === 20 && st.tiles[t].terrain !== "water");
  const band = spawnNomads(st, { tier: 1, tile: far, pop: 5 });
  band.goodwill = -50;
  const people = homeAt(st, b.id).length, dead0 = deadNear(st, b);
  st.hour = at(g, 21);
  firstWeekHour(st);
  const want = Math.min(5, Math.max(FIRST_ATTACK.NOMADS[0], Math.min(FIRST_ATTACK.NOMADS[1], Math.ceil(people / 2) + 1)));
  const card = st.cards.find((c) => c.firstWeek === b.id);
  check(g.attack && g.attack.kind === "nomads" && g.attack.band === band.id && g.attack.n === want, `the looters come: ${g.attack && g.attack.n} of them for ${people} at home (want ${want})`);
  check(st.grid.distance(band.tile, b.tile) <= 1 && band.phase === "battle" && deadNear(st, b) === dead0, `the band beside the base (${st.grid.distance(band.tile, b.tile)} away), held for the raid; the dead left where they are`);
  check(!!card && card.title.includes(band.name.charAt(0).toUpperCase() + band.name.slice(1)) && /following your trail/.test(card.text) && /Defend/.test(card.choices[0].label) && /Hide/.test(card.choices[1].label) && card.raidReport, `the card: "${card && card.title}"`);
  const hold = () => guideSteps(g).find((x) => x.id === "hold").done(st, g, freshUi());
  check(!hold(), "not held while the card waits");
  st.cards.splice(st.cards.indexOf(card), 1);
  const pop0 = band.pop;
  card.choices.find((x) => x.default).resolve(st); // Defend: played out headless
  const gone = !nomadsOf(st).includes(band);
  check(!st.combat && hold() && (gone || (band.pop < pop0 || band.pop === pop0) && band.phase !== "battle"), `defended: the fight over (the band ${gone ? "broken up" : `${pop0} → ${band.pop}, ${band.phase}`}), the step ticks`);
  // Hide: they carry off a share of the stores into their own, and move on.
  const c2 = camp(39);
  const far2 = c2.st.grid.within(c2.b.tile, 15).find((t) => c2.st.grid.distance(c2.b.tile, t) === 15 && c2.st.tiles[t].terrain !== "water");
  const band2 = spawnNomads(c2.st, { tier: 0, tile: far2, pop: 4 });
  band2.goodwill = 0;
  c2.b.stock.scrap = 40;
  const bs0 = band2.stock.scrap || 0;
  c2.st.hour = at(c2.g, 22);
  firstWeekHour(c2.st);
  const card2 = c2.st.cards.find((c) => c.firstWeek === c2.b.id);
  check(c2.g.attack && c2.g.attack.kind === "nomads" && !!card2, "drifters come too (not friendly)");
  c2.st.cards.splice(c2.st.cards.indexOf(card2), 1);
  card2.choices[1].resolve(c2.st);
  check(c2.b.stock.scrap === 30 && band2.stock.scrap === bs0 + 10 && band2.phase !== "battle" && c2.st.log.some((l) => /hid while/.test(l.text)), `hidden from: 10 of 40 scrap carried off into the band's own (${c2.b.stock.scrap}, theirs ${band2.stock.scrap}), the band moves on (${band2.phase})`);
  // Friendly bands and survivalists keep away: the dead come instead.
  const c3 = camp(40);
  putBack(c3.st, c3.b.tile, null, 10);
  const t3 = c3.st.grid.within(c3.b.tile, 6).find((t) => c3.st.grid.distance(c3.b.tile, t) === 6 && c3.st.tiles[t].terrain !== "water");
  const f1 = spawnNomads(c3.st, { tier: 1, tile: t3, pop: 4 }); f1.goodwill = 30;
  spawnNomads(c3.st, { tier: 2, tile: t3, pop: 5 });
  c3.st.hour = at(c3.g, 21);
  firstWeekHour(c3.st);
  check(c3.g.attack && c3.g.attack.kind === "dead", "a friendly band and survivalists near: the dead come instead");
}

section("A raider band when there are raiders about");
{
  const { st, g, b } = camp(33);
  clearDead(st, b); // no dead and no nomads: the land's raiders
  putBackRaiders(st, b.tile, null, 6);
  const people = homeAt(st, b.id).length, r0 = raidersNear(st, b);
  st.hour = at(g, 23);
  firstWeekHour(st);
  const want = Math.max(FIRST_ATTACK.RAIDERS[0], Math.min(FIRST_ATTACK.RAIDERS[1], Math.ceil(people / 2)));
  const card = attackCard(st, b);
  check(g.attack && g.attack.kind === "raiders" && g.attack.n === want && raidersNear(st, b) === r0 - want, `${want} raiders for ${people} at home, drawn from the land (${r0} → ${raidersNear(st, b)})`);
  check(!!card && /raiders at/.test(card.title) && /watching the camp/.test(card.text) && /Hide/.test(card.choices[1].label), `the card: "${card && card.title}"`);
  st.cards.splice(st.cards.indexOf(card), 1);
  card.choices[1].resolve(st); // hide
  check(!(b.campAttack && b.campAttack.wave) && raidersNear(st, b) === r0 && guideSteps(g).find((x) => x.id === "hold").done(st, g, freshUi()), "hidden from: the band back on the land, the step ticks");
}

section("Waits for the hub to be ready; a quiet night otherwise");
{
  const { st, g, b } = camp(34);
  putBack(st, b.tile, null, 10);
  st.combat = { setup: {} };
  st.hour = at(g, 21);
  firstWeekHour(st);
  check(!g.attack, "a fight on: it waits");
  st.combat = null;
  st.hour = at(g, 3);
  firstWeekHour(st);
  check(g.attack && g.attack.quiet && !attackCard(st, b), "03:00 with nothing yet: the night passed quietly");
  check(guideSteps(g).find((x) => x.id === "hold").done(st, g, freshUi()), "a quiet night ticks the step");
  const c2 = camp(35);
  clearDead(c2.st, c2.b); clearRaiders(c2.st, c2.b);
  c2.st.hour = at(c2.g, 21);
  firstWeekHour(c2.st);
  check(c2.g.attack && c2.g.attack.quiet && !attackCard(c2.st, c2.b), "nothing within reach: a quiet night, nothing made");
}

section("Hooked into the hour");
{
  const { st, g, b } = camp(36);
  clearRaiders(st, b);
  putBack(st, b.tile, null, 12);
  st.hour = at(g, 20);
  let card = null;
  for (let i = 0; i < 8 && !card; i++) { tickHour(st); card = attackCard(st, b); if (!card) st.cards.length = 0; }
  check(!!card && g.attack && !g.attack.quiet, `the hour brings it (${card ? card.title : "none"}, at ${g.attack && g.attack.hour % 24}:00)`);
  const src = readFileSync(new URL("../src/sim/campscout.js", import.meta.url), "utf8");
  check(/firstWeekHour\(state\)/.test(src), "campscout.js groundsHour calls it");
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
