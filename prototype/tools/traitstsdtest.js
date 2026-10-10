// Tactical, Strategic and Diplomatic (2026-10-09, user request: "Tactical as a trait? / Strategic as a trait? /
// Diplomatic as a trait"; sim/traits.js TRAIT_TIERS, data.js TRAITS / LATE_TRAITS):
//   - the table: three good traits, tiers I-III costing more each tier, Diplomatic clashing with Hothead (the picker,
//     a custom background, the points under Customize);
//   - each rule measured on a survivor (or a team) against an identical one without it, at each tier:
//     Tactical: a shot at a flanked target, a shot at them in cover, an ally within 2 tiles (shots and blows), and
//     fighting strength by the numbers; Strategic: a team's road encounters, the error of estimates of other groups;
//     Diplomatic: goodwill gains and losses (not while held captive; a change that sets goodwill left alone), a
//     team's toll, the lowest radio delivery fee;
//   - rolling: their share of the birth rolls (about 3 in 34), the swap's rolls untouched (with them off, every roll is
//     the same but for the traits they take), seed stability (map, names, skills, groups, the world's dice);
//   - a save keeps them; 10 days of autopilot with them on everyone.
// Usage: node tools/traitstsdtest.js [-v]
import { createWorld, tickHour, day, hub, atBase, makeSurvivor, rollTraits, newId, combatPower } from "../src/sim/world.js";
import { TRAITS, SKILLS, LATE_TRAITS, SWAP_TRAITS, NEW_TRAITS, traitsClash, traitKind } from "../src/sim/data.js";
import { TRAIT_TIERS, TRAIT_ROLL, traitPoints, tierFx, setTier, encounterMult, intelMult, goodwillMult, bribeMult, feeCut } from "../src/sim/traits.js";
import { Rng } from "../src/sim/rng.js";
import { createBattle, playerUnit, shotOdds, meleeOdds, COVER_DEF } from "../src/sim/combat.js";
import { conflictChance, triggerConflict } from "../src/sim/conflicts.js";
import { partyMembers, partyTile } from "../src/sim/parties.js";
import { staleErr } from "../src/sim/intelest.js";
import { changeGoodwill } from "../src/sim/factions.js";
import { minFee, deliveryFee } from "../src/sim/radiotrade.js";
import { pricePerson } from "../src/sim/custompoints.js";
import { sanitizeBackground } from "../src/sim/custombg.js";
import { traitPickerHtml } from "../src/ui/traitpick.js";
import { helpTopics } from "../src/ui/help.js";
import { stripAll } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { setAutopilot, autopilotResolve } from "../src/sim/autopilot.js";

let pass = 0, fail = 0;
const VERBOSE = process.argv.includes("-v");
const check = (ok, msg) => { if (ok) { pass++; if (VERBOSE) console.log(`  ok ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const r3 = (v) => Math.round(v * 1000) / 1000;
const t0 = Date.now();
const world = (seed = 11, mode = "normal") => { const st = createWorld({ seed, factionCount: 5, mode }); st.started = true; return st; };
const TIERS = [1, 2, 3];
// Someone plain at the hub: no traits, no perks, nothing worn, middling skills.
function plain(st, lvl = 5) {
  const h = hub(st);
  const s = makeSurvivor(st, 1);
  s.traits = []; s.perks = []; s.conditions = []; s.worm = null; delete s.traitTier;
  for (const k of SKILLS) s.skills[k] = lvl;
  stripAll(s);
  s.location = { kind: "base", baseId: h.id }; s.role = "farm"; s.health = 100; s.mood = 60; s.hunger = 100; s.thirst = 100;
  st.survivors.push(s);
  return s;
}
// s with trait t at tier n (or none).
const withTrait = (s, t, n) => { s.traits = t ? [t] : []; delete s.traitTier; if (t) setTier(s, t, n); return s; };
const everyoneWithout = (st, t) => st.survivors.forEach((s) => { s.traits = s.traits.filter((x) => x !== t); });

section("The table");
{
  check(LATE_TRAITS.join() === "tactical,strategic,diplomatic" && LATE_TRAITS.every((t) => TRAITS[t] && traitKind(t) === "good"), "Tactical, Strategic, Diplomatic: three good traits");
  check(SWAP_TRAITS.length === 21 && SWAP_TRAITS[0] === "quicklearner" && SWAP_TRAITS[20] === "pessimist" && !SWAP_TRAITS.some((t) => LATE_TRAITS.includes(t)), "the swap's pool is still the 21 of 2026-10-08, in their order");
  check(NEW_TRAITS.length === 24 && Object.keys(TRAITS).length === 34, "24 newer traits, 34 in all");
  for (const t of LATE_TRAITS) {
    const p = TIERS.map((n) => traitPoints(t, n));
    check(TRAIT_TIERS[t].pts.length === 3 && p[0] > 0 && p[1] > p[0] && p[2] > p[1], `${TRAITS[t].name}: tiers I-III cost ${p.join(" / ")} points`);
  }
  check(traitsClash("diplomatic", "hothead") && !traitsClash("tactical", "brave") && !traitsClash("strategic", "keeneye"), "Diplomatic clashes with Hothead (no other clash)");
  const html = traitPickerHtml(Object.keys(TRAITS), ["hothead"], 3, "");
  const btn = (k) => (html.match(new RegExp(`<button[^>]*data-k="${k}"[^>]*>`)) || [""])[0];
  check(/disabled/.test(btn("diplomatic")) && /Not with Hothead/.test(btn("diplomatic")) && btn("tactical") && !/disabled/.test(btn("tactical")) && /t-good/.test(btn("strategic")), "the picker: all three in the Good row, Diplomatic off beside Hothead");
  const d = sanitizeBackground({ id: "c_1", name: "x", traits: ["hothead", "diplomatic", "tactical"] });
  check(d.traits.join() === "hothead,tactical", `a custom background made safe: ${d.traits.join()}`);
  const st = world();
  const s = plain(st, 0);
  s.skills = Object.fromEntries(SKILLS.map((k) => [k, 0]));
  withTrait(s, "tactical", 3);
  const bill = pricePerson(st, s);
  check(bill.good === traitPoints("tactical", 3) && bill.lines.some((l) => /Tactical III \+9/.test(l)), `Customize: Tactical III costs ${bill.good} (${bill.lines.join("; ")})`);
  const topic = helpTopics().find((x) => x.id === "traits");
  check(!!topic && LATE_TRAITS.every((t) => topic.html.includes(TRAITS[t].name)) && /Hothead/.test(topic.html), "Help → Traits lists them");
}

section("Tactical on the battle map: flanks, cover, allies near");
{
  const st = world();
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, 2);
  everyoneWithout(st, "tactical");
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "raiders", count: 2, power: 3 }, ambush: null, canRetreat: false, handler: "tt", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; delete c.h; delete c.car; delete c.f; }
  b.smoke = []; b.flares = []; b.lit = null; b.night = false; b.dark = false;
  const W = b.w;
  const put = (x, y, k) => { b.cells[y * W + x].k = k; };
  const clear = () => { for (const c of b.cells) c.k = "open"; };
  const enemy = b.units.find((u) => u.side === "enemy" && u.kind === "human");
  const a = plain(st), at = plain(st);
  const ua = playerUnit(b, a); // no Tactical yet: b.tact not set by it
  check(!ua.tact && !b.tact, "no Tactical on the field: nothing looked at");
  ua.x = 2; ua.y = 5; enemy.x = 8; enemy.y = 5; ua.f = enemy.f = 0;
  b.units = [ua, enemy];
  for (const n of TIERS) {
    const ut = playerUnit(b, withTrait(at, "tactical", n));
    ut.x = 2; ut.y = 5; ut.f = 0;
    const fx = tierFx("tactical", n);
    // Flanked: cover beside the target (north), the shooter due west.
    clear(); put(8, 4, "wall");
    const o0 = shotOdds(b, ua, enemy), o1 = shotOdds(b, ut, enemy);
    check(o0.flanked && o1.chance - o0.chance === fx.flank && o1.notes.some((x) => /Tactical, a flank/.test(x)), `Tactical ${n}: a flanked target ${o0.chance}% → ${o1.chance}% (+${fx.flank})`);
    // Not flanked (open ground, no cover anywhere): nothing.
    clear();
    const p0 = shotOdds(b, ua, enemy), p1 = shotOdds(b, ut, enemy);
    check(!p0.flanked && p1.chance === p0.chance, `Tactical ${n}: a target in the open, no cover near: the same ${p0.chance}%`);
    // Shot at in cover: sandbags between them and the enemy shooter.
    b.units = [ua, ut, enemy];
    ut.x = ua.x = 2; ut.y = ua.y = 5; enemy.x = 8; enemy.y = 5;
    clear(); put(3, 5, "sandbag");
    const c0 = shotOdds(b, enemy, ua), c1 = shotOdds(b, enemy, ut);
    check(c0.cover === 1 && c0.chance - c1.chance === fx.cover && c1.notes.some((x) => /use cover well/.test(x)), `Tactical ${n}: shot at in half cover ${c0.chance}% → ${c1.chance}% (−${fx.cover})`);
    clear();
    const e0 = shotOdds(b, enemy, ua), e1 = shotOdds(b, enemy, ut);
    check(e0.chance === e1.chance, `Tactical ${n}: shot at in the open: the same ${e0.chance}%`);
    // An ally within 2 tiles: +aura to hit (shots and blows); 3 tiles away: nothing; never themselves.
    clear();
    const ally = playerUnit(b, plain(st));
    ally.x = 2; ally.y = 7; ally.f = 0;
    b.units = [ally, enemy];
    const s0 = shotOdds(b, ally, enemy).chance, m0 = meleeOdds(b, ally, enemy).chance;
    b.units = [ally, ut, enemy];
    ut.x = 2; ut.y = 5;
    const s1 = shotOdds(b, ally, enemy).chance, m1 = meleeOdds(b, ally, enemy).chance;
    ut.y = 4;
    const s2 = shotOdds(b, ally, enemy).chance;
    ut.y = 5; ut.dead = true;
    const s3 = shotOdds(b, ally, enemy).chance;
    ut.dead = false;
    check(s1 - s0 === fx.aura && m1 - m0 === fx.aura && s2 === s0 && s3 === s0, `Tactical ${n}: an ally 2 tiles off ${s0}% → ${s1}% (melee ${m0}% → ${m1}%), 3 tiles off ${s2}%, down ${s3}%`);
    b.units = [ua, enemy];
  }
  // Two Tactical allies near: the best one counts, not both.
  {
    const ally = playerUnit(b, plain(st));
    ally.x = 2; ally.y = 7;
    const t1 = playerUnit(b, withTrait(plain(st), "tactical", 1)), t3 = playerUnit(b, withTrait(plain(st), "tactical", 3));
    t1.x = 3; t1.y = 7; t3.x = 1; t3.y = 7;
    b.units = [ally, enemy];
    const s0 = shotOdds(b, ally, enemy).chance;
    b.units = [ally, t1, t3, enemy];
    const s1 = shotOdds(b, ally, enemy).chance;
    check(s1 - s0 === tierFx("tactical", 3).aura, `two Tactical allies near (I and III): +${s1 - s0}, the best one`);
  }
  st.combat = null;
  // By the numbers: fighting strength.
  const p = plain(st);
  const base = combatPower(p);
  const pw = TIERS.map((n) => r3(combatPower(withTrait(p, "tactical", n)) - base));
  check(pw.every((v, i) => near(v, tierFx("tactical", i + 1).power, 1e-3)), `fighting strength by the numbers +${pw.join(" / +")} (tiers I-III, full health)`);
}

section("Strategic: fewer road encounters, sharper estimates");
{
  const hw = world(5, "hardcore");
  const p = hw.parties.find((x) => x.owner === "player");
  const ms = partyMembers(hw, p);
  ms.forEach((m) => { m.traits = []; delete m.traitTier; });
  let tile = null, c0 = 0;
  for (const t of hw.tiles) { const c = conflictChance(hw, p, t.id).chance; if (c > 0.05 && c < 0.25) { tile = t.id; c0 = c; break; } }
  check(tile != null, `a tile with a road encounter chance to measure (${r3(c0)})`);
  for (const n of TIERS) {
    withTrait(ms[0], "strategic", n);
    const c1 = conflictChance(hw, p, tile).chance;
    check(near(c1, c0 * (1 - tierFx("strategic", n).enc), 1e-12), `Strategic ${n} on the team: encounters ${r3(c0)} → ${r3(c1)} (×${1 - tierFx("strategic", n).enc})`);
  }
  withTrait(ms[1] || ms[0], "strategic", 1);
  withTrait(ms[0], "strategic", 3);
  check(near(encounterMult(ms), 1 - tierFx("strategic", 3).enc), "two on a team: the best tier counts");
  ms.forEach((m) => { m.traits = []; delete m.traitTier; });
  // Estimates: at one of your bases, not on a team.
  const st = world();
  everyoneWithout(st, "strategic");
  const e0 = staleErr(st, 0.2, st.hour - 48);
  const s = plain(st);
  for (const n of TIERS) {
    withTrait(s, "strategic", n);
    const e1 = staleErr(st, 0.2, st.hour - 48);
    check(near(e1, e0 * (1 - tierFx("strategic", n).intel), 1e-12), `Strategic ${n} at a base: an estimate's error ${r3(e0)} → ${r3(e1)}`);
  }
  s.location = { kind: "party", partyId: -1 };
  check(near(intelMult(st), 1) && near(staleErr(st, 0.2, st.hour - 48), e0), "away on a team: the estimates as they were");
  s.alive = false;
}

section("Diplomatic: goodwill, tolls, radio fees");
{
  const st = world();
  everyoneWithout(st, "diplomatic");
  const f = st.factions.find((x) => x.alive);
  const s = plain(st);
  const gw = (amount, exact = false) => { f.goodwill = 0; f.pact = null; changeGoodwill(st, f, amount, "a test", exact); return r3(f.goodwill); };
  const plainUp = gw(10), plainDown = gw(-10);
  check(plainUp === 10 && plainDown === -10, "nobody Diplomatic: +10 and −10 as they are");
  for (const n of TIERS) {
    withTrait(s, "diplomatic", n);
    const g = tierFx("diplomatic", n).gw;
    const up = gw(10), down = gw(-10), set = gw(-35, true);
    check(near(up, r3(10 * (1 + g))) && near(down, r3(-10 * (1 - g))) && set === -35, `Diplomatic ${n}: +10 → +${up}, −10 → ${down}; a change that sets goodwill (exact) left at ${set}`);
  }
  s.location = { kind: "captive", factionId: f.id };
  check(gw(10) === 10 && near(goodwillMult(st, -5), 1), "held captive by a group: no help");
  s.location = { kind: "party", partyId: -1 };
  check(gw(10) === r3(10 * (1 + tierFx("diplomatic", 3).gw)), "away on a team: still counts (the group's envoy, wherever they are)");
  s.location = { kind: "base", baseId: hub(st).id };
  // Radio deals: the lowest delivery fee from the base making the call.
  const h = hub(st);
  const g2 = st.factions.find((x) => x.alive && deliveryFee(st, x, h) >= 10);
  if (check(!!g2, "a group whose caravan would bring a deal (a fee to measure)")) {
    g2.goodwill = 0;
    withTrait(s, null);
    const fee = deliveryFee(st, g2, h), m0 = minFee(st, g2, h);
    for (const n of TIERS) {
      withTrait(s, "diplomatic", n);
      const cut = tierFx("diplomatic", n).fee;
      const m1 = minFee(st, g2, h);
      check(near(feeCut(atBase(st, h.id)), cut) && m1 === Math.ceil(fee * Math.max(0.6 - cut, 1 - (g2.type === "traders" ? 0.1 : 0) - cut)) && m1 < m0, `Diplomatic ${n} at the hub: the lowest fee ${m0} → ${m1} (their fee ${fee})`);
    }
    s.location = { kind: "party", partyId: -1 };
    check(minFee(st, g2, h) === m0, "not at that base: the fee floor as it was");
    s.location = { kind: "base", baseId: h.id };
  }
  s.alive = false;
  // A toll on the road: the team's best.
  const hw = world(5, "hardcore");
  const p = hw.parties.find((x) => x.owner === "player");
  const ms = partyMembers(hw, p);
  everyoneWithout(hw, "diplomatic");
  ms.forEach((m) => { m.traits = []; delete m.traitTier; });
  for (const k of Object.keys(p.supplies)) p.supplies[k] = 0;
  if (p.cargo) for (const k of Object.keys(p.cargo.supplies || {})) p.cargo.supplies[k] = 0;
  const fid = hw.factions.find((x) => x.alive).id;
  const toll = () => {
    const r = hw.rng.state;
    const card = triggerConflict(hw, p, "roadblock", fid);
    hw.rng.state = r;
    hw.cards = (hw.cards || []).filter((c) => c !== card);
    p.lastConflict = null;
    const ch = card && card.choices.find((c) => /toll/i.test(c.label));
    const m = ch && /needs about (\d+) worth/.exec(ch.hint);
    return m ? Number(m[1]) : null;
  };
  const v0 = toll();
  check(v0 > 0, `a roadblock's toll, nobody Diplomatic: about ${v0} worth`);
  for (const n of TIERS) {
    withTrait(ms[0], "diplomatic", n);
    const v1 = toll();
    check(v1 === Math.round(v0 * (1 - tierFx("diplomatic", n).bribe)) && near(bribeMult(ms), 1 - tierFx("diplomatic", n).bribe), `Diplomatic ${n} on the team: the toll ${v0} → ${v1}`);
  }
}

section("Rolling: their share, the swap untouched, seed-stable");
{
  const N = 20000;
  let late = 0, slots = 0, bad = 0, other = 0;
  const share = TRAIT_ROLL.LATE_SHARE;
  for (let i = 0; i < N; i++) {
    const seed = 1000 + i;
    TRAIT_ROLL.LATE_SHARE = 0;
    const a = rollTraits(new Rng(seed));
    TRAIT_ROLL.LATE_SHARE = share;
    const b = rollTraits(new Rng(seed));
    for (let j = 0; j < b.length; j++) { slots++; if (LATE_TRAITS.includes(b[j])) late++; if (b[j] !== a[j] && !LATE_TRAITS.includes(b[j])) other++; }
    if (a.length !== b.length || new Set(b).size !== b.length || (b.includes("diplomatic") && b.includes("hothead"))) bad++;
  }
  TRAIT_ROLL.LATE_SHARE = share;
  check(Math.abs(late / slots - 3 / 34) < 0.01, `their share of ${slots} trait slots: ${r3(late / slots)} (aimed at ${r3(3 / 34)}: each trait about as common as any other)`);
  check(other === 0 && bad === 0, `with them off, every roll the same but the traits they take (${other} other changes, ${bad} bad rolls)`);
  const fp = (st) => JSON.stringify({ rng: st.rng.state, map: st.tiles.map((t) => t.terrain + (t.loc ? t.loc.type : "")).join(""), people: st.survivors.map((s) => [s.name, s.skills, s.background, s.appearance]), groups: st.factions.map((f) => [f.name, f.type, f.strength]) });
  let same = 0, n = 0, onlyLate = 0, showed = 0;
  for (const mode of ["normal", "hardcore"]) for (const seed of [1, 2, 3, 42, 777, 2026]) {
    TRAIT_ROLL.LATE_SHARE = 0;
    const a = createWorld({ seed, factionCount: 5, mode });
    const ra = []; for (let i = 0; i < 20; i++) ra.push(makeSurvivor(a, 0.9));
    TRAIT_ROLL.LATE_SHARE = share;
    const b = createWorld({ seed, factionCount: 5, mode });
    const rb = []; for (let i = 0; i < 20; i++) rb.push(makeSurvivor(b, 0.9));
    n++;
    if (fp(a) === fp(b) && JSON.stringify(ra.map((s) => [s.name, s.skills])) === JSON.stringify(rb.map((s) => [s.name, s.skills]))) same++;
    else console.log(`  differs: ${mode} seed ${seed}`);
    const pa = [...a.survivors, ...ra], pb = [...b.survivors, ...rb];
    if (pa.every((s, i) => s.traits.every((t, j) => t === pb[i].traits[j] || LATE_TRAITS.includes(pb[i].traits[j])))) onlyLate++;
    if (pb.some((s) => s.traits.some((t) => LATE_TRAITS.includes(t)))) showed++;
  }
  TRAIT_ROLL.LATE_SHARE = share;
  check(same === n, `${same}/${n} worlds the same with them rolled or not: map, names, skills, looks, backgrounds, groups, 20 recruits after, the world's dice`);
  check(onlyLate === n && showed >= n / 2, `only the traits they take differ (${onlyLate}/${n}), and they show up (${showed}/${n} worlds)`);
  const x = createWorld({ seed: 9, factionCount: 5 }), y = createWorld({ seed: 9, factionCount: 5 });
  check(JSON.stringify(x.survivors.map((s) => [s.traits, s.traitTier || null])) === JSON.stringify(y.survivors.map((s) => [s.traits, s.traitTier || null])), "the same seed, the same traits and tiers");
}

section("A save keeps them; an autopilot run with them on everyone");
{
  const st = world(4);
  st.survivors.forEach((s, i) => { s.traits = [LATE_TRAITS[i % 3]]; setTier(s, LATE_TRAITS[i % 3], 1 + (i % 3)); });
  const ld = loadFromString(saveToString(st));
  check(ld.survivors.every((s, i) => s.traits.join() === st.survivors[i].traits.join() && JSON.stringify(s.traitTier || null) === JSON.stringify(st.survivors[i].traitTier || null)), "every survivor's traits and tiers after a save and a load");
  const ap = world(6);
  ap.survivors.forEach((s, i) => { s.traits = [LATE_TRAITS[i % 3], LATE_TRAITS[(i + 1) % 3]]; setTier(s, LATE_TRAITS[i % 3], 3); });
  setAutopilot(ap, true, "balanced");
  let err = null;
  try { while (day(ap) <= 10 && !ap.gameOver) { autopilotResolve(ap); tickHour(ap); } } catch (e) { err = e; }
  check(!err, `10 days on autopilot${err ? `: ${err.stack.split("\n").slice(0, 3).join(" | ")}` : ""}`);
  check(ap.factions.every((f) => Number.isFinite(f.goodwill)), "goodwill stays a number");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fail ? 1 : 0);
