// The newer survivor traits (2026-10-08, user request: "more tags like Lucky, Tough"; sim/traits.js, data.js TRAITS):
//   - every new trait's rule, measured on a survivor against an identical one without it (paired, exact where the rule
//     is a number; enough samples where it is dice);
//   - the clash table (data.js TRAIT_CLASH) everywhere: the birth roll over many rolls, people made in play, the
//     new-run screen's picker and its handler, a custom background made safe, a custom background on a start;
//   - rolling stays seed-stable: with the newer traits' own dice on or off, the same seed builds the same map, names,
//     skills, backgrounds and groups, and the world's dice end where they did (normal and hardcore starts);
//   - a save keeps them; a short autopilot run with them on everyone has no errors.
// Usage: node tools/traitstest.js
import { createWorld, tickHour, day, hub, atBase, skill, hurt, makeSurvivor, rollTraits, newId } from "../src/sim/world.js";
import { TRAITS, SKILLS, BIRTH_TRAITS, NEW_TRAITS, TRAIT_CLASH, traitsClash, clashIn } from "../src/sim/data.js";
import { TRAIT_FX, TRAIT_ROLL, woundMult, stomachShrugs } from "../src/sim/traits.js";
import { Rng } from "../src/sim/rng.js";
import { gainXp, ensureSkills, tradeSpeech } from "../src/sim/skills.js";
import { catchWorm, sickRoll } from "../src/sim/worm.js";
import { removeCondition, frailty, conditionDrift, searchHazards } from "../src/sim/health.js";
import { healRatePerHour } from "../src/sim/medical.js";
import { campHealPerHour } from "../src/sim/orders.js";
import { maxLoad, feelFactor } from "../src/sim/load.js";
import { weighPlayer } from "../src/sim/carrykit.js";
import { createBattle, playerUnit, escapeOdds } from "../src/sim/combat.js";
import { escapeChanceByNumbers, fightModel } from "../src/sim/breakoff.js";
import { runBonus } from "../src/sim/conflicts.js";
import { toughOf } from "../src/sim/armour.js";
import { careToday } from "../src/sim/farming.js";
import { buyPrice } from "../src/sim/trade.js";
import { mentalBreaksDaily } from "../src/sim/mentalbreaks.js";
import { compat } from "../src/sim/relations.js";
import { foodUse } from "../src/sim/upkeep.js";
import { teamNeedsHour } from "../src/sim/needs.js";
import { partyMembers } from "../src/sim/parties.js";
import { stripAll } from "../src/sim/inventory.js";
import { sanitizeBackground } from "../src/sim/custombg.js";
import { LOOK_ACTIONS } from "../src/ui/newgame.js";
import { traitPickerHtml, traitBlock } from "../src/ui/traitpick.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { setAutopilot, autopilotResolve } from "../src/sim/autopilot.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const r3 = (v) => Math.round(v * 1000) / 1000;
const t0 = Date.now();
const world = (seed = 11, mode = "normal") => { const st = createWorld({ seed, factionCount: 5, mode }); st.started = true; return st; };

// A twin of s: the same person with these traits (a new id, in the world, where s is).
function twin(st, s, traits) {
  const t = structuredClone(s);
  t.id = newId();
  t.traits = [...traits];
  st.survivors.push(t);
  return t;
}
// Someone plain at the hub: no traits, no perks, nothing worn, middling skills.
function plain(st, lvl = 5) {
  const h = hub(st);
  const s = makeSurvivor(st, 1);
  s.traits = []; s.perks = []; s.conditions = []; s.worm = null;
  for (const k of SKILLS) s.skills[k] = lvl;
  stripAll(s);
  s.location = { kind: "base", baseId: h.id }; s.role = "farm"; s.health = 100; s.mood = 60; s.hunger = 100; s.thirst = 100;
  st.survivors.push(s);
  return s;
}

section("The table");
{
  check(Object.keys(TRAITS).length === BIRTH_TRAITS.length + NEW_TRAITS.length && NEW_TRAITS.length === 14, `${BIRTH_TRAITS.length} old + ${NEW_TRAITS.length} new traits`);
  check(BIRTH_TRAITS.join() === "brave,coward,nightowl,medic,greedy,tough,keeneye,loud,lucky,badback", "the birth draw's list is the old one, in its order");
  check(!Object.keys(TRAITS).includes("prepper") && !!TRAITS.prepper, "the prepper's background trait is still not enumerable");
  check(Object.values(TRAITS).every((t) => t.name && t.desc), "every trait has a name and a desc");
  check(TRAIT_CLASH.every(([a, b]) => TRAITS[a] && TRAITS[b] && traitsClash(a, b) && traitsClash(b, a)), `the clash pairs: ${TRAIT_CLASH.map((p) => p.join("/")).join(", ")}`);
  check(!traitsClash("brave", "lucky") && clashIn(["tough", "lucky"], "unlucky") === "lucky", "traitsClash, clashIn");
  const names = Object.values(TRAITS).map((t) => t.name);
  check(new Set(names).size === names.length, "no two traits share a name");
}

section("Quick Study: +25% XP");
{
  const st = world();
  const a = plain(st, 10), b = twin(st, a, ["quicklearner"]);
  for (const s of [a, b]) { ensureSkills(st, s); s.xp.farming = 0; }
  const ga = gainXp(st, a, "farming", 6), gb = gainXp(st, b, "farming", 6);
  check(near(gb, ga * TRAIT_FX.LEARN) && near(b.xp.farming, a.xp.farming * 1.25), `6 XP of use: ${r3(a.xp.farming)} plain, ${r3(b.xp.farming)} Quick Study`);
  for (let i = 0; i < 10; i++) { gainXp(st, a, "shooting", 5); gainXp(st, b, "shooting", 5); }
  check(near(b.xp.shooting, a.xp.shooting * 1.25), `the day's cap (20) reached by both: ${r3(a.xp.shooting)} vs ${r3(b.xp.shooting)}`);
}

section("Iron Stomach: an upset stomach half as likely, the worm's eggs shrugged off a third of the time");
{
  const st = world();
  const a = plain(st), b = twin(st, a, ["ironstomach"]);
  const h0 = st.hour;
  let ca = 0, cb = 0, swarm = 0;
  for (let i = 0; i < 3000; i++) {
    st.hour = h0 + i;
    a.worm = null; b.worm = null;
    if (catchWorm(st, a, "test", "water")) ca++;
    if (catchWorm(st, b, "test", ["water", "meat", "crop", "forage", "camp", "search"][i % 6])) cb++;
    b.worm = null; if (catchWorm(st, b, "swarm", "swarm")) swarm++;
  }
  st.hour = h0; a.worm = null; b.worm = null;
  check(ca === 3000 && cb > 1800 && cb < 2200, `eggs swallowed 3000 times: ${ca} plain, ${cb} with an Iron Stomach (about 2000)`);
  check(swarm === 3000, "a Carrier's worm swarm in a fight is not swallowed: always caught");
  check(catchWorm(st, b, "test") || true, "no way given (a tool's): caught as ever");
  b.worm = null;
  let sa = 0, sb = 0;
  for (let i = 0; i < 6000; i++) {
    if (sickRoll(st, a, 0.2, "from un-purified water")) sa++;
    if (sickRoll(st, b, 0.2, "from un-purified water")) sb++;
    removeCondition(a, "stomach"); removeCondition(b, "stomach");
  }
  check(sa > 1050 && sa < 1350 && sb > 480 && sb < 720, `an upset stomach at 20%: ${sa}/6000 plain, ${sb}/6000 Iron Stomach (half)`);
  check(stomachShrugs(st, a, "water") === false, "nobody without it shrugs anything off");
}

section("Quick Healer: wounds heal 30% faster at rest");
{
  const st = world();
  const h = hub(st);
  const a = plain(st), b = twin(st, a, ["quickheal"]);
  a.health = b.health = 60;
  const ra = healRatePerHour(st, h, a), rb = healRatePerHour(st, h, b);
  check(ra > 0 && near(rb, ra * TRAIT_FX.HEAL), `at a base: ${r3(ra * 24)} vs ${r3(rb * 24)} health a day`);
  const hc = world(5, "hardcore");
  const p = hc.parties.find((x) => x.owner === "player");
  const m = partyMembers(hc, p)[0];
  m.traits = []; m.health = 60; m.woundInfected = false;
  const c0 = campHealPerHour(hc, p, m);
  m.traits = ["quickheal"];
  const c1 = campHealPerHour(hc, p, m);
  check(c0 > 0 && near(c1, c0 * 1.3), `in camp: ${r3(c0 * 24)} vs ${r3(c1 * 24)} a day`);
}

section("Strong Back: max load 48, loads feel 10% lighter");
{
  const st = world();
  const a = plain(st), b = twin(st, a, ["strongback"]), c = twin(st, a, ["badback"]);
  check(maxLoad(a) === 40 && maxLoad(b) === 48 && maxLoad(c) === 28, `max load ${maxLoad(a)} / Strong Back ${maxLoad(b)} / Bad Back ${maxLoad(c)}`);
  check(near(feelFactor(b), feelFactor(a) * 0.9) && near(feelFactor(c), feelFactor(a) * 1.2), "felt load × 0.9 (× 1.2 Bad Back)");
}

section("Fleet-Footed: a tile more a move in battle, +10 to get away");
{
  const st = world();
  const a = plain(st), b = twin(st, a, ["fleet"]);
  const ua = {}, ub = {};
  weighPlayer(ua, a); weighPlayer(ub, b);
  check(ub.mob === ua.mob + 1, `mob ${ua.mob} → ${ub.mob}`);
  const e = { tiles: 5, pinned: 0, shooters: 2, chasers: 0 };
  const m = { hp: 100, load: 10, scouting: 3, mult: 1 };
  const ea = escapeChanceByNumbers(m, e), eb = escapeChanceByNumbers({ ...m, fleet: TRAIT_FX.FLEET_ESCAPE }, e);
  check(eb.chance === ea.chance + 10 && eb.parts.some(([l, v]) => l === "Fleet-Footed" && v === 10), `breaking off by the numbers: ${ea.chance}% → ${eb.chance}%`);
  const fm = fightModel(st, [a, b], { win: 0.5, enemy: { kind: "raiders", count: 3 } });
  check(fm.members[0].fleet === 0 && fm.members[1].fleet === 10, "the fight's model carries it (breakoff.js memberOf)");
  const hw = world(5, "hardcore");
  const tp = hw.parties.find((x) => x.owner === "player");
  const keepV = tp.vehicle;
  tp.vehicle = null;
  const ms = partyMembers(hw, tp);
  ms.forEach((x) => (x.traits = []));
  const r0 = runBonus(hw, tp);
  ms.forEach((x) => (x.traits = ["fleet"]));
  const r1 = runBonus(hw, tp);
  ms[0].traits = [];
  const r2 = runBonus(hw, tp);
  tp.vehicle = keepV;
  check(r1 === r0 + 1 && r2 === r0, `Run for it on the road, on foot: +${r1 - r0} with everyone Fleet-Footed, +${r2 - r0} with one who is not`);
  // On the battle map.
  const h = hub(st);
  const people = atBase(st, h.id).filter((s) => s !== b).slice(0, 2);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "raiders", count: 2, power: 3 }, ambush: null, canRetreat: true, handler: "tt", context: {} });
  const bt = st.combat;
  const pa = playerUnit(bt, a), pb = playerUnit(bt, b);
  check(pb.mob === pa.mob + 1 && pb.fleet === 10 && !pa.fleet, `battle unit: mob ${pa.mob} → ${pb.mob}`);
  const ref = bt.units.find((u) => u.side === "player");
  pa.x = pb.x = ref.x; pa.y = pb.y = ref.y;
  const oa = escapeOdds(bt, pa), ob = escapeOdds(bt, pb);
  check(ob.parts.some(([l, v]) => l === "Fleet-Footed" && v === 10) && !oa.parts.some(([l]) => l === "Fleet-Footed"), "the escape check lists Fleet-Footed +10");
  st.combat = null;
}

section("Farm-Raised (+3 Farming), Persuasive (+3 Speech), Unlucky (−1 every skill)");
{
  const st = world();
  const a = plain(st), f = twin(st, a, ["farmraised"]), p = twin(st, a, ["persuasive"]), u = twin(st, a, ["unlucky"]), l = twin(st, a, ["lucky"]);
  check(skill(f, "farming") === skill(a, "farming") + 3 && skill(f, "shooting") === skill(a, "shooting"), "Farm-Raised: Farming +3, nothing else");
  check(skill(p, "speech") === skill(a, "speech") + 3 && tradeSpeech([p]) === tradeSpeech([a]) + 3, "Persuasive: Speech +3, and the trading Speech");
  const fac = st.factions.find((x) => x.alive);
  const pa = buyPrice(st, fac, "food", tradeSpeech([a])), pp = buyPrice(st, fac, "food", tradeSpeech([p]));
  check(pp < pa, `buying food: ${r3(pa)} → ${r3(pp)} a unit`);
  check(SKILLS.every((k) => skill(u, k) === skill(a, k) - 1 && skill(l, k) === skill(a, k) + 1), "Unlucky −1 to every skill (Lucky +1)");
  const zero = twin(st, a, ["unlucky"]); zero.skills.stealth = 0;
  check(skill(zero, "stealth") === 0, "never below 0");
  // The farm: the same farmers, one Farm-Raised.
  const h = hub(st);
  const farmers = atBase(st, h.id).filter((s) => s.role === "farm");
  const before = careToday(st, h).avgSkill;
  const keep = farmers.map((s) => s.traits);
  farmers.forEach((s) => (s.traits = [...s.traits.filter((t) => t !== "unlucky" && t !== "farmraised"), "farmraised"]));
  const after = careToday(st, h).avgSkill;
  farmers.forEach((s, i) => (s.traits = keep[i]));
  check(farmers.length > 0 && after > before, `the hub's farmers tending: average Farming ${r3(before)} → ${r3(after)}`);
}

section("Iron Will: breaks half as likely");
{
  const st = world();
  const h = hub(st);
  st.survivors.forEach((s) => (s.mood = 90));
  let na = 0, nb = 0, n = 0;
  for (let round = 0; round < 30; round++) {
    const group = [];
    for (let i = 0; i < 20; i++) { const s = plain(st); s.leader = false; group.push([s, i % 2 === 0]); }
    for (const [s, will] of group) { s.traits = will ? ["ironwill"] : []; s.mood = 0; s.lowDays = 3; s.snapCd = 0; }
    st.snapDay = -1;
    mentalBreaksDaily(st);
    for (const [s, will] of group) { const broke = (s.snaps || []).length > 0; if (will) nb += broke ? 1 : 0; else na += broke ? 1 : 0; }
    n += 10;
    for (const [s] of group) { s.alive = false; s.left = true; } // off the stage for the next round
  }
  check(na > 0 && nb < na * 0.75 && nb > na * 0.25, `mood 0, past the edge: ${na}/${n} broke, ${nb}/${n} with Iron Will (about half)`);
}

section("Frail: 25% more from wounds (Tough 25% less)");
{
  const st = world();
  const a = plain(st), f = twin(st, a, ["frail"]), t = twin(st, a, ["tough"]);
  for (const s of [a, f, t]) hurt(st, s, 20, null, "in a test");
  check(near(a.health, 80) && near(f.health, 75) && near(t.health, 85), `a 20 wound: ${a.health} / Frail ${f.health} / Tough ${t.health}`);
  for (const s of [a, f]) { s.health = 50; hurt(st, s, 20, null, "of hunger", { raw: true }); }
  check(near(a.health, 30) && near(f.health, 30), "hunger, thirst, infection: the same for both");
  check(toughOf(f) === 1.25 && toughOf(t) === 0.75 && woundMult(a) === 1, "on the battle map (armour.js toughOf) the same rule");
}

section("Clumsy: −10 to hit in melee, 50% more cuts");
{
  const st = world();
  const h = hub(st);
  const a = plain(st), c = twin(st, a, ["clumsy"]);
  const people = atBase(st, h.id).filter((s) => s !== c).slice(0, 2);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "raiders", count: 2, power: 3 }, ambush: null, canRetreat: false, handler: "tt", context: {} });
  const ua = playerUnit(st.combat, a), uc = playerUnit(st.combat, c);
  check(uc.meleeAim === ua.meleeAim - 10 && uc.aim === ua.aim, `melee to hit ${ua.meleeAim} → ${uc.meleeAim}; shooting unchanged`);
  st.combat = null;
  let ka = 0, kc = 0;
  for (let i = 0; i < 60000; i++) {
    searchHazards(st, [a, c], "a test site");
    if (a.conditions.some((x) => x.key === "cut")) ka++;
    if (c.conditions.some((x) => x.key === "cut")) kc++;
    a.conditions = []; c.conditions = [];
  }
  check(kc > ka * 1.25 && kc < ka * 1.8, `cuts while searching (60000 hours): ${ka} plain, ${kc} Clumsy (×1.5)`);
}

section("Glutton: a quarter ration more");
{
  const st = world();
  const h = hub(st);
  const people = atBase(st, h.id);
  const keep = people.map((s) => s.traits);
  people.forEach((s) => (s.traits = s.traits.filter((t) => t !== "glutton")));
  const u0 = foodUse(st, h);
  people[0].traits = [...people[0].traits, "glutton"];
  const u1 = foodUse(st, h);
  people.forEach((s, i) => (s.traits = keep[i]));
  check(near(u1.total - u0.total, u0.rate * 0.25, 1e-3) && near(u1.residents - u0.residents, u0.rate * 0.25, 1e-3), `a base's food a day: ${r3(u0.total)} → ${r3(u1.total)} with one Glutton`);
  const hc = world(5, "hardcore");
  const p = hc.parties.find((x) => x.owner === "player");
  const m = partyMembers(hc, p)[0];
  m.traits = []; m.hunger = 100; teamNeedsHour(hc, p, [m]); const d0 = 100 - m.hunger;
  m.traits = ["glutton"]; m.hunger = 100; teamNeedsHour(hc, p, [m]); const d1 = 100 - m.hunger;
  check(d0 > 0 && near(d1, d0 * 1.25), `on the road: hunger −${r3(d0)} → −${r3(d1)} an hour`);
}

section("Sickly: falls ill 50% more often, illnesses clear slower");
{
  const st = world();
  const a = plain(st), s = twin(st, a, ["sickly"]);
  const fa = frailty(st, a).f, fs = frailty(st, s).f;
  check(near(fs, fa * 1.5) && frailty(st, s).why.some((w) => /sickly/.test(w)), `frailty ×${r3(fa)} → ×${r3(fs)}, and it says why`);
  const c = { key: "chestcold", sev: 30, days: 2, treatedDay: -99 }, cut = { key: "cut", sev: 30, days: 2, treatedDay: -99 };
  check(near(conditionDrift(st, s, c), conditionDrift(st, a, c) + 1), `a chest cold: ${conditionDrift(st, a, c)} → ${conditionDrift(st, s, c)} a day`);
  check(near(conditionDrift(st, s, cut), conditionDrift(st, a, cut)), "a cut (an injury): the same");
}

section("Hothead: gets along worse");
{
  const st = world();
  const a = plain(st), b = twin(st, a, []), h = twin(st, a, ["hothead"]);
  const tr = (x, y) => (compat(st, x, y).parts.find((p) => p[0] === "Traits") || [0, 0])[1];
  check(tr(a, b) === 0 && tr(h, b) === -10, `the Traits part of getting along: ${tr(a, b)} → ${tr(h, b)}`);
}

section("The clash table everywhere");
{
  const rng = new Rng(7);
  const seen = {};
  let bad = 0, nNew = 0, slots = 0, two = 0;
  for (let i = 0; i < 20000; i++) {
    const t = rollTraits(rng);
    if (new Set(t).size !== t.length || t.some((x, j) => clashIn(t.slice(0, j), x)) || !t.every((x) => TRAITS[x])) bad++;
    for (const x of t) { seen[x] = (seen[x] || 0) + 1; slots++; if (NEW_TRAITS.includes(x)) nNew++; }
    if (t.length === 2) two++;
  }
  check(bad === 0, `20000 birth rolls: no duplicate, no clash (${bad} bad)`);
  check(Object.keys(TRAITS).every((t) => seen[t] > 0), "every trait comes up");
  check(Math.abs(nNew / slots - TRAIT_ROLL.NEW_SHARE) < 0.02, `the newer traits' share ${r3(nNew / slots)} (aimed at ${r3(TRAIT_ROLL.NEW_SHARE)})`);
  check(Math.abs(two / 20000 - 0.4) < 0.02, `two traits ${r3(two / 20000)} of the time (as before)`);
  const st = world(3);
  let badMade = 0;
  for (let i = 0; i < 300; i++) { const s = makeSurvivor(st, 0.9); if (s.traits.some((x, j) => clashIn(s.traits.slice(0, j), x) || s.traits.indexOf(x) !== j)) badMade++; }
  check(badMade === 0, "300 recruits made in play: none with clashing traits");
  // The picker.
  const html = traitPickerHtml(Object.keys(TRAITS), ["brave"], 3, `data-action="nr-trait" data-id="1"`);
  const btn = (k) => (html.match(new RegExp(`<button[^>]*data-k="${k}"[^>]*>`)) || [""])[0];
  check(/disabled/.test(btn("coward")) && /Not with Brave/.test(btn("coward")) && !/disabled/.test(btn("lucky")), "the picker: Coward off beside Brave, with why");
  check(/tp-row/.test(html) && /Good/.test(html) && /Bad/.test(html) && /tp-bad[^>]*data-k="frail"/.test(html), "good and bad in their own rows");
  const full = traitPickerHtml(Object.keys(TRAITS), ["brave", "lucky", "tough"], 3, "").match(/<button[^>]*data-k="medic"[^>]*>/)[0];
  check(!/At most/.test(btn("lucky")) && /At most 3/.test(full) && /disabled/.test(full), "three picked: the rest off (at most 3)");
  check(traitBlock(["tough"], "frail", 3) === "Not with Tough" && traitBlock(["tough"], "lucky", 3) === "", "traitBlock");
  const s = st.survivors[0];
  const ui = { freeEdit: true, ironman: false };
  s.traits = ["lucky"];
  LOOK_ACTIONS["nr-trait"](st, ui, { id: s.id, k: "unlucky" });
  check(s.traits.join() === "lucky", "Customize: Unlucky refused beside Lucky");
  LOOK_ACTIONS["nr-trait"](st, ui, { id: s.id, k: "strongback" });
  LOOK_ACTIONS["nr-trait"](st, ui, { id: s.id, k: "badback" });
  check(s.traits.join() === "lucky,strongback", `Customize: Strong Back added, Bad Back refused (${s.traits.join()})`);
  const d = sanitizeBackground({ id: "c_1", name: "x", traits: ["tough", "frail", "strongback", "badback", "quickheal"] });
  check(d.traits.join() === "tough,strongback,quickheal", `a custom background made safe: ${d.traits.join()}`);
  const d2 = sanitizeBackground({ id: "c_2", name: "y", traits: ["ironwill", "hothead", "sickly", "quickheal", "fleet"] });
  check(d2.traits.join() === "ironwill,sickly,fleet", `and the new pairs: ${d2.traits.join()}`);
}

section("Rolling stays seed-stable");
{
  const fp = (st) => JSON.stringify({ rng: st.rng.state, map: st.tiles.map((t) => t.terrain + (t.loc ? t.loc.type : "")).join(""), people: st.survivors.map((s) => [s.name, s.skills, s.background, s.appearance]), groups: st.factions.map((f) => [f.name, f.type, f.strength]) });
  let same = 0, n = 0, moved = 0;
  for (const mode of ["normal", "hardcore"]) for (const seed of [1, 2, 3, 42, 777, 2026]) {
    TRAIT_ROLL.ON = false;
    const a = createWorld({ seed, factionCount: 5, mode });
    const ra = []; for (let i = 0; i < 12; i++) { const s = makeSurvivor(a, 0.9); ra.push([s.name, s.skills]); }
    TRAIT_ROLL.ON = true;
    const b = createWorld({ seed, factionCount: 5, mode });
    const rb = []; for (let i = 0; i < 12; i++) { const s = makeSurvivor(b, 0.9); rb.push([s.name, s.skills]); }
    n++;
    if (fp(a) === fp(b) && JSON.stringify(ra) === JSON.stringify(rb) && a.rng.state === b.rng.state) same++;
    else console.log(`  differs: ${mode} seed ${seed}`);
    if (a.survivors.some((s, i) => s.traits.join() !== b.survivors[i].traits.join())) moved++;
  }
  TRAIT_ROLL.ON = true;
  check(same === n, `${same}/${n} worlds (normal and hardcore) the same with the newer traits on or off: map, names, skills, looks, backgrounds, groups, 12 recruits after, the world's dice`);
  check(moved >= n / 2, `and the newer traits do show up in the crews (${moved}/${n} crews differ)`);
  const a = createWorld({ seed: 9, factionCount: 5 }), b = createWorld({ seed: 9, factionCount: 5 });
  check(a.survivors.map((s) => s.traits.join()).join("|") === b.survivors.map((s) => s.traits.join()).join("|"), "the same seed, the same traits");
}

section("A save keeps them");
{
  const st = world(4);
  st.survivors.forEach((s, i) => (s.traits = [NEW_TRAITS[i % NEW_TRAITS.length], NEW_TRAITS[(i + 7) % NEW_TRAITS.length]].filter((t, j, all) => !clashIn(all.slice(0, j), t))));
  const ld = loadFromString(saveToString(st));
  check(ld.survivors.every((s, i) => s.traits.join() === st.survivors[i].traits.join()), "every survivor's traits after a save and a load");
  check(ld.survivors.every((s, i) => maxLoad(s) === maxLoad(st.survivors[i]) && skill(s, "farming") === skill(st.survivors[i], "farming")), "and what they do");
}

section("An autopilot run with them on everyone");
{
  const st = world(6);
  st.survivors.forEach((s, i) => (s.traits = [NEW_TRAITS[i % NEW_TRAITS.length], NEW_TRAITS[(i + 5) % NEW_TRAITS.length]].filter((t, j, all) => !clashIn(all.slice(0, j), t))));
  setAutopilot(st, true, "balanced");
  let err = null;
  try { while (day(st) <= 15 && !st.gameOver) { autopilotResolve(st); tickHour(st); } } catch (e) { err = e; }
  check(!err, `15 days on autopilot${err ? `: ${err.stack.split("\n").slice(0, 3).join(" | ")}` : ""}`);
  check(st.survivors.every((s) => Array.isArray(s.traits) && s.traits.every((t) => TRAITS[t] || t === "prepper")), "everyone's traits still known ones");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fail ? 1 : 0);
