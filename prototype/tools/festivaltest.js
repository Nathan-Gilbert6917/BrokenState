// The harvest festival (src/sim/festival.js, suggestions-4 #27): the card on the morning of autumn day 22 (once a
// year), its three choices (the small festival the default), holding it (the food, the bonfire, the drink, the day
// off for all but the guards and medics and the roles back at midnight, the mood at the hub and elsewhere, the
// afterglow in the mood breakdown, the bonds), the small one and skipping it (only low spirits mind), put off once
// when the hub is under attack or starving and dropped for the year if still not possible, no hub no festival, the
// autopilot's answers by its food, the extra fires on the map's festival day, stories over many festivals, and
// save/load.
// Usage: node tools/festivaltest.js [seed=42]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, alive, atBase, residents, day } from "../src/sim/world.js";
import { season, SEASON_DAYS, START_OFFSET } from "../src/sim/weather.js";
import { moodFactors, getRel } from "../src/sim/relations.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { newItem } from "../src/sim/inventory.js";
import { cardKind, defaultChoice, autoAnswer, trayStale } from "../src/sim/cardrules.js";
import { childrenOf } from "../src/sim/family.js";
import { FEST, festivalHour, festivalCard, holdFestival, festivalGlow, festivalNow, festivalBlocker } from "../src/sim/festival.js";

const SEED = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const world = (seed = SEED) => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.cards.length = 0; return st; };
const logged = (st, re) => st.log.some((l) => re.test(l.text));
// The campaign day (1-based) of autumn day FEST.DAY in the first year.
const FEST_DAY = 2 * SEASON_DAYS + FEST.DAY - START_OFFSET;
// Jump to the morning of a campaign day (no ticking: the festival is checked on its own).
const morning = (st, d) => { st.hour = (d - 1) * 24 + FEST.HOUR; };
const stock = (st, food = 500) => { const h = hub(st); setFood(h, food); setJarred(h, 0); h.stock.firewood = 200; return h; };
const festCard = (st) => st.cards.find((c) => c.festival);
const t0 = Date.now();

// 1. The day: the morning of autumn day 22, once a year.
{
  console.log("The day");
  const st = world();
  stock(st);
  morning(st, FEST_DAY - 1);
  festivalHour(st);
  check(!festCard(st), `day ${FEST_DAY - 1}: no festival yet`);
  morning(st, FEST_DAY);
  const se = season(st);
  check(se.key === "autumn" && se.dayOfSeason === FEST.DAY, `campaign day ${FEST_DAY} is autumn day ${se.dayOfSeason}`);
  st.hour -= 1; festivalHour(st);
  check(!festCard(st), "not before the morning hour");
  st.hour += 1; festivalHour(st);
  const card = festCard(st);
  check(!!card && card.title === "The harvest festival" && card.choices.length === 3, `${FEST.HOUR}:00: the card, three choices`);
  check(card && card.choices.filter((c) => c.default).length === 1 && /^A small festival/.test(card.choices.find((c) => c.default).label), "the small festival is the one default answer");
  check(card && cardKind(st, card) === "other" && defaultChoice(st, card) === card.choices[1], "pause rules (cardrules.js): it waits in the tray; its default is the small festival");
  const food0 = food(hub(st));
  const line = card ? autoAnswer(st, card) : "";
  check(/took its default: A small festival/.test(line) && food(hub(st)) < food0 && !festCard(st), `left in the tray it holds the small one: "${line.slice(0, 90)}…"`);
  const h0 = hub(st), c2 = festivalCard(st, h0), at = st.bases.indexOf(h0);
  st.bases.splice(at, 1);
  check(trayStale(st, c2) === "the base is gone", "a festival card for a hub that is lost is out of date");
  st.bases.splice(at, 0, h0);
  st.cards.length = 0;
  morning(st, FEST_DAY + 1); festivalHour(st);
  check(!festCard(st), "the next day: not again");
  morning(st, FEST_DAY + 112); festivalHour(st);
  check(!!festCard(st) && season(st).year === 2, "a year later: again");
}

// 2. Holding it: the costs, the day off, the mood, the afterglow, the bonds, the map's fires.
{
  console.log("Holding the festival");
  const st = world();
  const h = stock(st, 300);
  h.armory.push(newItem("vodka"), newItem("whiskey"));
  morning(st, FEST_DAY);
  const people = residents(st, h.id);
  for (const s of people) s.mood = 50;
  const guard = atBase(st, h.id).find((s) => !s.leader) || atBase(st, h.id)[0];
  guard.role = "guard";
  const worker = atBase(st, h.id).find((s) => s !== guard && !s.inBed);
  worker.role = "farm"; delete worker.restUntil;
  const a = people[0], b = people[1];
  const o0 = getRel(st, a, b, true).o;
  const cost = Math.ceil(people.length * FEST.FULL.food);
  const text = holdFestival(st, h, "FULL");
  check(food(h) === 300 - cost, `${cost} food for ${people.length} people`);
  check(h.stock.firewood === 200 - FEST.FULL.wood && !h.armory.some((it) => it.key === "vodka" || it.key === "whiskey"), `a bonfire (${FEST.FULL.wood} firewood) and the bottles`);
  const lift = FEST.FULL.mood + FEST.FULL.fire + FEST.FULL.drink;
  check(people.every((s) => Math.abs(s.mood - (50 + lift)) < 0.01), `everyone at the hub mood +${lift}`);
  check(worker.role === "rest" && worker.restUntil === day(st) + 1 && worker.restPrev === "farm", "a farmer has the day off");
  check(guard.role === "guard" && guard.restUntil == null, "the guard stays on duty");
  check(getRel(st, a, b).o > o0, "the people there grow a little closer");
  check(festivalNow(st, h), "the map's festival fires burn today");
  const f = moodFactors(st, a).list.find((x) => x.label === "The harvest festival");
  check(f && f.v === FEST.FULL.glow && f.own, `the afterglow in the mood breakdown: +${f && f.v} a day`);
  check(/^The harvest festival at .*mood \+\d+, and a day off/.test(text) && logged(st, /^The harvest festival at /), "a diary line");
  // Midnight: the day off ends.
  st.hour = day(st) * 24 - 1;
  tickHour(st);
  check(worker.role === "farm" && worker.restUntil == null, "at midnight the farmer is back at work");
  check(!festivalNow(st, h), "the fires are out the next day");
  st.hour += FEST.FULL.glowDays * 24;
  check(festivalGlow(st, a) === 0, `after ${FEST.FULL.glowDays} days the afterglow is gone`);
}

// 2b. Children eat at the festival (half a head each); they have no mood of their own.
{
  console.log("Children at the festival");
  const st = world();
  const h = stock(st, 300);
  morning(st, FEST_DAY);
  const n = residents(st, h.id).length;
  childrenOf(st).push({ id: 9001, name: "Pip", baseId: h.id, parents: [], bornDay: 1, grown: 30 }, { id: 9002, name: "Wren", baseId: h.id, parents: [], bornDay: 1, grown: 40 });
  const text = holdFestival(st, h, "FULL");
  check(food(h) === 300 - Math.ceil((n + 2 * FEST.KID_SHARE) * FEST.FULL.food), `two children at the hub: ${Math.ceil((n + 2 * FEST.KID_SHARE) * FEST.FULL.food)} food for ${n} people and 2 children`);
  check(/children ran wild/.test(text), "the diary line mentions them");
}

// 3. The small one, skipping it, and everyone else's share.
{
  console.log("The small festival and skipping it");
  const st = world();
  const h = stock(st, 300);
  morning(st, FEST_DAY);
  const people = residents(st, h.id);
  for (const s of people) s.mood = 50;
  const away = alive(st).find((s) => !people.includes(s));
  if (away) away.mood = 50;
  holdFestival(st, h, "SMALL");
  check(food(h) === 300 - Math.ceil(people.length * FEST.SMALL.food) && h.stock.firewood === 200, `a small one: ${Math.ceil(people.length * FEST.SMALL.food)} food, no firewood`);
  check(people.every((s) => Math.abs(s.mood - (50 + FEST.SMALL.mood)) < 0.01) && people.every((s) => s.restUntil == null || s.role !== "rest" || s.inBed), `mood +${FEST.SMALL.mood}, no day off`);
  check(!away || Math.abs(away.mood - (50 + FEST.SMALL.outpost)) < 0.01, away ? `someone away from the hub +${FEST.SMALL.outpost}` : "(nobody away from the hub)");
  const st2 = world();
  const h2 = stock(st2);
  morning(st2, FEST_DAY);
  for (const s of residents(st2, h2.id)) s.mood = 60;
  festivalCard(st2, h2).choices[2].resolve(st2);
  check(residents(st2, h2.id).every((s) => s.mood === 60), "skipped in good spirits: nobody minds");
  for (const s of residents(st2, h2.id)) s.mood = 30;
  festivalCard(st2, h2).choices[2].resolve(st2);
  check(residents(st2, h2.id).every((s) => s.mood === 30 + FEST.SKIP.mood), `skipped with spirits low: mood ${FEST.SKIP.mood}`);
  check(festivalCard(st2, h2).choices[0].disabled(st2) === false, "full festival affordable with the food");
  setFood(h2, 1); setJarred(h2, 0);
  check(festivalCard(st2, h2).choices[0].disabled(st2) === true, "with no food it cannot be held");
}

// 4. Under attack or starving: put off once, then dropped for the year. No hub: none.
{
  console.log("Put off, dropped, no hub");
  const st = world();
  const h = stock(st);
  h.alert = true;
  morning(st, FEST_DAY);
  festivalHour(st);
  check(!festCard(st) && logged(st, /put off for \d+ days: the hub is under attack/), "under attack: put off");
  morning(st, FEST_DAY + FEST.POSTPONE - 1); festivalHour(st);
  check(!festCard(st), "not before the new day");
  h.alert = false;
  morning(st, FEST_DAY + FEST.POSTPONE); festivalHour(st);
  check(!!festCard(st), `${FEST.POSTPONE} days later, the attack over: the card`);
  const st2 = world();
  const h2 = stock(st2, 0);
  h2.hungerDays = 1;
  morning(st2, FEST_DAY); festivalHour(st2);
  check(festivalBlocker(st2, h2) === "the stores are nearly empty" && logged(st2, /put off/), "starving: put off");
  morning(st2, FEST_DAY + FEST.POSTPONE); festivalHour(st2);
  check(!festCard(st2) && logged(st2, /No harvest festival at .* this year: the stores are nearly empty/), "still starving: none this year");
  morning(st2, FEST_DAY + FEST.POSTPONE + 1); festivalHour(st2);
  check(!festCard(st2), "and not asked again that year");
  const st3 = world();
  st3.bases.length = 0;
  morning(st3, FEST_DAY); festivalHour(st3);
  check(!festCard(st3) && st3.festival.year === season(st3).year, "no hub (hardcore before the first): skipped for the year");
}

// 5. The autopilot's answer by the food.
{
  console.log("The autopilot");
  const pick = (st, h) => { const c = festivalCard(st, h); const ok = c.choices.filter((x) => !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)); return [...ok].sort((a, b) => b.ai(st) - a.ai(st))[0].label; };
  const st = world();
  const h = stock(st, 2000);
  morning(st, FEST_DAY);
  check(/^Hold the festival/.test(pick(st, h)), `plenty of food: ${pick(st, h)}`);
  const n = residents(st, h.id).length;
  setFood(h, n * 25);
  check(/^A small festival|^Skip/.test(pick(st, h)), `about 25 days' food: ${pick(st, h)}`);
  setFood(h, n * 3);
  check(/^Skip/.test(pick(st, h)), `a few days' food: ${pick(st, h)}`);
}

// 6. Stories over many festivals (relations.js's own dice).
{
  console.log("Stories");
  let stories = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    const st = world(SEED + i);
    const h = stock(st);
    morning(st, FEST_DAY);
    const text = holdFestival(st, h, "FULL");
    if (/danced|buried the hatchet|talked until dawn/.test(text)) stories++;
  }
  check(stories >= N * FEST.FULL.story * 0.35 && stories <= N * FEST.FULL.story * 1.6, `${stories} stories in ${N} festivals (about ${Math.round(FEST.FULL.story * 100)}% expected, some nights have no pair for one)`);
}

// 7. Save and load: the year done, the afterglow; an older save without the festival state.
{
  console.log("Save and load");
  const st = world();
  const h = stock(st);
  morning(st, FEST_DAY);
  festivalHour(st);
  st.cards.length = 0;
  holdFestival(st, h, "FULL");
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const a = residents(back, hub(back).id)[0];
  check(back.festival.year === 1 && festivalGlow(back, a) === FEST.FULL.glow && festivalNow(back, hub(back)), "the year, the afterglow and the day survive a save");
  back.hour += 1; festivalHour(back);
  check(!festCard(back), "no second card after loading");
  const old = world();
  delete old.festival;
  stock(old);
  morning(old, FEST_DAY); festivalHour(old);
  check(!!festCard(old), "a save from before the festival: it starts its state and asks");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
