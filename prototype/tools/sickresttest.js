// Sick people rest (src/sim/sickrest.js; user, 2026-10-10: "When a survivor is sick at base they will be reassigned to
// rest", "Food poisoning counts").
// Checks: every illness rests by its kind (an upset stomach and a chest cold too), injuries keep their old rules; people
// on work priorities ("Resting: sick (Flu)", back to work when well), Manual and pinned people (their job and station
// kept and given back, a log line each way and no more); the setting (keep mild ones working, off) and old saves; the
// doctor's exception; the walls in an emergency; the watch roster, order templates' crews and the team-forming window's
// Fit filter; the governor; resting heals faster; the AI groups' coarse ill.
// Usage: node tools/sickresttest.js [seed]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import { addCondition, removeCondition, conditionDrift, CONDITIONS } from "../src/sim/health.js";
import { workState, assignRole, planBase, healthRest, taskLabel, roleById } from "../src/sim/work.js";
import { sickRestWhy, sickRestHour, setSickRest, sickRestMode, mildIllness, SICK_REST_MODES, sickRestLabel } from "../src/sim/sickrest.js";
import { setWatchPreset, toggleWatch, onWatchNow, watchWhy } from "../src/sim/watch.js";
import { unfitWhy } from "../src/sim/trips.js";
import { FILTERS } from "../src/ui/teamform.js";
import { setAutopilot, governRoles } from "../src/sim/autopilot.js";
import { GROUP_ILL, illDaily, illOf, workingPeople } from "../src/sim/groupcare.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { workTab, taskChip } from "../src/ui/work.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const world = () => { const st = createWorld({ seed, factionCount: 4 }); st.started = true; return st; };
// A hub of n healthy people, all Manual farmers.
function setup(n = 6) {
  const st = world();
  const h = hub(st);
  for (const s of [...atBase(st, h.id)].slice(n)) s.location = { kind: "party", partyId: -1 };
  while (atBase(st, h.id).length < n) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  const ppl = atBase(st, h.id);
  for (const s of ppl) { s.health = 100; s.conditions = []; s.pinned = false; s.role = "farm"; s.station = null; s.mood = 70; s.woundInfected = false; s.inBed = false; delete s.work; delete s.worm; }
  return { st, h, ppl };
}
const ill = (st, s, key, sev = 40) => addCondition(st, s, key, "", { sev, quiet: true });
const logs = (st, re) => st.log.filter((l) => re.test(l.text)).length;

section("The rule: any illness by its kind, injuries as before");
{
  const { st, ppl } = setup();
  const [a, b, c, d] = ppl;
  check(sickRestMode(st) === "all" && st.sickRest === "all", "a new world: Sick people rest, every illness");
  ill(st, a, "stomach", 25);
  check(sickRestWhy(st, a) === "sick: Upset stomach", `an upset stomach (un-purified water, uncooked food: food poisoning) rests: "${sickRestWhy(st, a)}"`);
  check(healthRest(a) === "" && healthRest(a, st) === "sick: Upset stomach", "healthRest without the state keeps the old rules; with it the illness counts");
  ill(st, b, "chestcold", 20);
  check(sickRestWhy(st, b) === "sick: Chest cold" && mildIllness(b.conditions[0]), "a mild chest cold rests too");
  ill(st, c, "cut", 40);
  check(sickRestWhy(st, c) === "" && healthRest(c, st) === "", "a deep cut (an injury) keeps working");
  d.health = 20;
  check(/badly hurt/.test(healthRest(d, st)), "badly hurt rests, as before");
  const kinds = Object.entries(CONDITIONS).filter(([, x]) => x.kind === "illness").map(([k]) => k);
  const all = kinds.every((k) => { const s = makeSurvivor(st); s.location = { kind: "base", baseId: hub(st).id }; s.conditions = []; ill(st, s, k, 30); return /^sick: /.test(sickRestWhy(st, s)); });
  check(all, `every illness kind rests (${kinds.join(", ")}): the rule reads the kind, so food poisoning to come counts too`);
  const away = makeSurvivor(st); away.location = { kind: "party", partyId: 1 }; away.conditions = []; ill(st, away, "flu");
  check(sickRestWhy(st, away) === "", "away on a team the rule does not apply");
}

section("People on work priorities");
{
  const { st, h, ppl } = setup();
  workState(st);
  const gen = st.work.roles.find((r) => r.name === "Generalist");
  for (const s of ppl) assignRole(st, s, gen.id);
  const a = ppl[0];
  ill(st, a, "flu", 40);
  planBase(st, h);
  check(a.role === "rest" && a.task.t === "sick" && a.task.kind === "health", `planned to rest (${a.task.why})`);
  check(taskLabel(st, a) === "Resting: sick (Flu)", `the Work tab and People tab read "${taskLabel(st, a)}"`);
  check(/Resting: sick \(Flu\)/.test(taskChip(st, a)), "the role chip says it too");
  sickRestHour(st);
  check(logs(st, new RegExp(`${a.name} is ill \\(Flu\\): resting`)) === 1, "one log line when they start resting");
  sickRestHour(st); planBase(st, h); sickRestHour(st);
  check(logs(st, new RegExp(`${a.name} is ill`)) === 1, "no more lines while it lasts");
  removeCondition(a, "flu");
  planBase(st, h); sickRestHour(st);
  check(a.task.t !== "sick" && logs(st, new RegExp(`${a.name} is well again: back to their work priorities`)) === 1, `well: back to their priorities (${a.task.t}), one line`);
  // Pinned people on priorities: their job kept.
  const p = ppl[1];
  p.pinned = true; p.role = "build";
  ill(st, p, "fever", 30);
  planBase(st, h); sickRestHour(st);
  check(p.role === "rest" && p.sickWas && p.sickWas.role === "build" && sickRestLabel(st, p) === "Resting: sick (Fever)", "pinned: rests, their job kept");
  removeCondition(p, "fever");
  sickRestHour(st);
  check(p.role === "build" && !p.sickWas, "pinned: back to Build when well");
}

section("Manual people: their job and station kept and given back");
{
  const { st, h, ppl } = setup();
  const [a, b] = ppl;
  a.role = "medic"; b.role = "operate"; b.station = 12345;
  ill(st, a, "stomach", 30); ill(st, b, "chestcold", 30);
  ppl[2].role = "medic"; // a second doctor, fit: no exception for a
  sickRestHour(st);
  check(a.role === "rest" && a.sickWas.role === "medic" && b.role === "rest" && b.station == null && b.sickWas.station === 12345, "Manual medic and operator rest, jobs kept");
  check(/Medic again when well/.test(st.log.find((l) => l.text.includes(a.name)).text), "the log line names the job they go back to");
  check(/Resting: sick \(Upset stomach\)/.test(taskChip(st, a)), "the role chip shows Manual people resting sick");
  b.role = "build"; // someone gives b another job meanwhile: the rule still holds, and that job is the one kept
  sickRestHour(st);
  check(b.role === "rest" && b.sickWas.role === "build", "a job changed while sick is the one kept");
  removeCondition(a, "stomach");
  sickRestHour(st);
  check(a.role === "medic" && !a.sickWas && logs(st, new RegExp(`${a.name} is well again: back to medic`)) === 1, "well: back to Medic, one line");
  b.location = { kind: "party", partyId: 9 };
  sickRestHour(st);
  check(!b.sickWas && !b.sickOff, "leaving the base drops the rest (their role is theirs to set on the road)");
}

section("The setting: keep mild ones working, off; saves");
{
  const { st, h, ppl } = setup();
  const [a, b, c, d] = ppl;
  ill(st, a, "stomach", 30); ill(st, b, "chestcold", 40); ill(st, c, "flu", 40); ill(st, d, "pneumonia", 60);
  sickRestHour(st);
  check([a, b, c, d].every((s) => s.role === "rest"), "every illness: all four rest");
  check(setSickRest(st, "serious") !== "" && st.sickRest === "serious", "set to keep mild ones working");
  check(sickRestWhy(st, a) === "" && sickRestWhy(st, b) === "" && sickRestWhy(st, c) === "sick: Flu", "mild ones (stomach, chest cold) work; the flu rests");
  sickRestHour(st);
  check(a.role === "farm" && b.role === "farm" && c.role === "rest", "the mild ones back to the farm");
  check(logs(st, new RegExp(`${a.name} is still a little ill but back to farm`)) === 1, "a line says they work through it");
  setSickRest(st, "off");
  sickRestHour(st);
  check(c.role === "farm" && /too ill/.test(healthRest(d, st)), "off: the flu works; pneumonia is too ill (the old rule)");
  st.sickRest = "serious";
  const back = loadFromString(saveToString(st));
  check(back.sickRest === "serious", "the setting is saved");
  delete st.sickRest;
  check(loadFromString(saveToString(st)).sickRest === "all", "a save from before has it on (every illness)");
  setSickRest(st, "all"); sickRestHour(st);
  const again = loadFromString(saveToString(st));
  const a2 = again.survivors.find((s) => s.id === a.id);
  check(a2.role === "rest" && a2.sickWas && a2.sickWas.role === "farm", "a rest and its kept job survive a save");
  const html = workTab(st, h, {});
  check(/data-action="wsick"/.test(html) && Object.values(SICK_REST_MODES).every((m) => html.includes(m.name)), "the Work tab has the setting");
}

section("The doctor's exception");
{
  const { st, ppl } = setup();
  const [doc, pt, other] = ppl;
  doc.role = "medic";
  ill(st, doc, "chestcold", 30);
  check(sickRestWhy(st, doc) === "sick: Chest cold", "a sick doctor with nobody worse off rests");
  pt.health = 25; // badly hurt
  check(sickRestWhy(st, doc) === "", "the only doctor fit, someone worse off: they keep working");
  sickRestHour(st);
  check(doc.role === "medic", "and keep their Medic job");
  other.role = "medic";
  check(sickRestWhy(st, doc) === "sick: Chest cold", "another doctor fit: they rest");
  other.role = "farm";
  removeCondition(doc, "chestcold"); ill(st, doc, "pneumonia", 70);
  check(/too ill/.test(healthRest(doc, st)), "too ill to work is never excepted");
}

section("Emergencies, the watch, the jail, trips and teams");
{
  const { st, h, ppl } = setup(8);
  workState(st);
  const gen = st.work.roles.find((r) => r.name === "Generalist");
  const [a, b, c] = ppl;
  assignRole(st, a, gen.id);
  ill(st, a, "flu", 40);
  h.alert = true; // the defences manned: everyone with Guard set to the walls
  planBase(st, h);
  check(a.role === "guard" && a.task.kind === "emerg", `an emergency still takes the ill to the walls (${a.task.why})`);
  b.role = "guard"; ill(st, b, "chestcold", 30);
  sickRestHour(st);
  check(b.role === "guard", "a Manual guard stays on the walls while it lasts");
  h.alert = false;
  planBase(st, h); sickRestHour(st);
  check(a.role === "rest" && b.role === "rest", "the emergency over: both rest");
  setWatchPreset(st, h, "four");
  for (let i = 0; i < 4; i++) toggleWatch(st, h, i, c.id);
  ill(st, c, "stomach", 30);
  check(!onWatchNow(st, h, c) && watchWhy(st, h, c) === "sick: Upset stomach", "not on the watch roster while sick (the Defence tab says why)");
  check(unfitWhy(st, c) === "sick: Upset stomach", "an order template's crew: a stand-in for the sick one");
  check(!FILTERS.fit.test(c, false, st) && FILTERS.fit.test(ppl[5], false, st), "the team-forming window's Fit filter leaves the sick out");
}

section("The governor");
{
  const { st, h, ppl } = setup(8);
  setAutopilot(st, true, "balanced");
  const a = ppl[0];
  ill(st, a, "stomach", 30);
  governRoles(st, h);
  check(a.role === "rest", "the governor rests the sick");
  removeCondition(a, "stomach");
  governRoles(st, h);
  check(a.role !== "rest" || a.mood < 40, `well: the governor puts them back to work (${a.role})`);
}

section("Resting heals faster");
{
  const { st, ppl } = setup();
  const a = ppl[0];
  const c = ill(st, a, "chestcold", 30);
  a.role = "farm"; const work = conditionDrift(st, a, c);
  a.role = "rest"; const rest = conditionDrift(st, a, c);
  check(rest === work - 2, `chest cold drift: ${work} a day working, ${rest} resting`);
}

section("AI groups (coarse)");
{
  const st = world();
  const f = st.factions.find((x) => x.alive);
  f.pop = 40; f.wounded = 0; f.ill = 0;
  for (let i = 0; i < 120; i++) illDaily(st, f);
  const share = illOf(f) / f.pop;
  check(share > 0.03 && share < 0.12, `a group of 40 settles at ${(share * 100).toFixed(1)}% ill (rate ${GROUP_ILL.rate}, mend ${GROUP_ILL.mend})`);
  check(Math.abs(workingPeople(f) - (f.pop - f.ill)) < 1e-9 && workingPeople(f) < f.pop, `their ill do not work (${workingPeople(f).toFixed(1)} of ${f.pop} at work)`);
  f.ill = 50;
  check(illOf(f) === 40 && workingPeople(f) === 0, "never more ill than people");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
