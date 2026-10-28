// The first week's attack (sim/firstweekattack.js; the user's request 2026-10-28: "add a scripted raid on the base of a
// nomad group or horde at the end of the week"), without a browser.
// Usage: node tools/firstweekattacktest.js
// - only while the first-week guide is on (not brought back by hand, not beside the autopilot), once a guide
// - the warning at the seventh dawn, the attack in the seventh night (21:00 to 03:00), the first hour the hub is ready
// - a pack of the dead (the people at home + 2, 3 to 8) or a raider band (half of them, 2 to 4), drawn out of the land
//   round the base (nothing made), the base's card whatever the walls; Defend plays the base defence; the guide's
//   "Hold off the attack" step ticks once it is over
// - nothing within reach, or the night gone by: a quiet night; saved with the guide; hooked into the hour
import { createWorld, tickHour, hub, homeAt, alive } from "../src/sim/world.js";
import "../src/ui/ui.js"; // the UI's modules in their usual order (ui/guide.js after it)
import { giveOrder } from "../src/sim/parties.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { openDead, openRaiders, putBack, putBackRaiders, drawFromTile, drawRaiders } from "../src/sim/deadpop.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { FIRST_ATTACK, firstWeekHour, nightDawn } from "../src/sim/firstweekattack.js";
import { startGuide, guideCheck, guideSteps, GUIDE_PHASES } from "../src/ui/guide.js";
import { readFileSync } from "node:fs";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const freshUi = () => ({ started: true, speed: 0, tab: "bases", selected: -1, baseView: null, expedition: null, diary: null });

// A Normal road start with its camp set up and the guide on from the first hour.
function camp(seed, { guide = true } = {}) {
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
  check(g.attack && g.attack.kind === "dead" && g.attack.n === want && g.attack.base === b.id, `21:00: a pack of ${g.attack && g.attack.n} dead for ${people} at home (want ${want})`);
  check(!!card && /in the night/.test(card.title) && /gathering/.test(card.text) && card.choices.length === 2 && /Defend/.test(card.choices[0].label), `the base's card: "${card && card.title}"`);
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

section("A raider band when there are raiders about");
{
  const { st, g, b } = camp(33);
  clearDead(st, b);
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
