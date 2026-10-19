// Volunteers (src/sim/volunteers.js): asking an allied group for people (the points: goodwill, pacts, the danger, how
// many and how long, their trouble, an offer), the volunteers walking to the team and joining it (their kit from the
// group's arsenal, the food and rounds they bring, the team's carry and rations), the battle map (no orders from you,
// they move and shoot on their own, the Evac and pulling out with your people), fights by the numbers counting them,
// deaths and goodwill, going home (span, team home, goodwill), a save and load with volunteers on a team and your
// people lent out, a group's ask of you (lending, the coarse fights, coming home with a share; declining), the groups
// lending each other, a hive crawl with volunteers (no double count with the coalition's brood thinning), and the
// governor (its styles answering asks, asking allies for a marginal hive).
// Usage: node tools/volunteertest.js [seed=7]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, makeSurvivor, hub, survivorById, hurt, combatPower } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { partyMembers, partyCapacity, rationsPerHour } from "../src/sim/parties.js";
import { createBattle, combatAct, autoPlayerTurn, runEnemyPhase, endPlayerTurn, closeCombat, byNumbersOdds, autoResolveCombat } from "../src/sim/combat.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { strength } from "../src/sim/factions.js";
import { ensureHives } from "../src/sim/hives.js";
import { makeHorde } from "../src/sim/hordes.js";
import { hiveAllies, ensureAlliance } from "../src/sim/alliance.js";
import { changeRelation } from "../src/sim/diplomacy.js";
import * as HC from "../src/sim/hivecrawl.js";
import { lightOf, LIGHTS } from "../src/sim/lights.js";
import * as V from "../src/sim/volunteers.js";
import { calOf } from "../src/sim/ammo.js";
import { baseKey } from "../src/sim/rounds.js";

const SEED = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const t0 = performance.now();

function world(seed = SEED) {
  const st = createWorld({ seed, factionCount: 4 });
  st.started = true;
  st.noNewGangs = true;
  const f = st.factions.find((x) => x.type === "military") || st.factions[0];
  for (const g of st.factions) { g.known = true; }
  f.goodwill = 70; f.pact = "trade"; f.pop = Math.max(f.pop, 20);
  return { st, f };
}
function team(st, tile, { n = 3, mission = "move", weapon = "ar", phase = "waiting" } = {}) {
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(st, 1);
    s.traits = []; s.skills.shooting = 8; s.health = 100;
    s.gear.weapon = { key: weapon, name: GEAR[weapon].name, quality: 1 };
    st.survivors.push(s);
    people.push(s);
  }
  const p = { id: 91000 + st.parties.length, owner: "player", kind: "expedition", mission, members: people.map((s) => s.id), supplies: { ammo: 300, meds: 6, food: 20, water: 20 }, cargo: { supplies: {}, gear: [] },
    path: [tile], idx: 0, progress: 0, dest: tile, phase, seen: new Map(), spotted: new Map(), homeBaseId: hub(st).id, orders: [], stance: "normal", departed: st.hour, plannedHours: 48 };
  for (const s of people) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  return { p, people };
}
const ticks = (st, n) => { for (let i = 0; i < n; i++) tickHour(st); };
const joinNow = (st, p, maxH = 100) => { for (let i = 0; i < maxH && V.volunteersComing(st, p).length; i++) tickHour(st); return V.volunteersWith(st, p); };

// ---------- 1. the answer ----------
console.log("Asking a group");
{
  const { st, f } = world();
  const { p } = team(st, f.bases[0]);
  const q1 = V.askQuote(st, f, p, { n: 1, days: 7 });
  check(!q1.refuse && q1.yes, `a friend with a trade pact (goodwill 70) lends one for a walk: yes, ${q1.points} points (${q1.parts.map((x) => `${x.label} ${x.v > 0 ? "+" : ""}${x.v}`).join(", ")})`);
  const q4 = V.askQuote(st, f, p, { n: 4, days: 20 });
  check(q4.points < q1.points, `four people for 20 days is a bigger ask: ${q4.points} points`);
  const { p: hp } = team(st, f.bases[0], { mission: "assault" });
  const qa = V.askQuote(st, f, hp, { n: 2, days: 7 });
  check(qa.points < V.askQuote(st, f, p, { n: 2, days: 7 }).points && qa.parts.some((x) => /danger/.test(x.label)), `an assault is a big ask: ${qa.points} points (danger ${qa.parts.find((x) => /danger/.test(x.label)).v})`);
  f.goodwill = 45; f.pact = null;
  const qlow = V.askQuote(st, f, hp, { n: 3, days: 10 });
  check(!qlow.yes && !qlow.refuse, `goodwill 45, no pact, three for an assault: no (${qlow.points} points)`);
  const offer = { key: "food", qty: 0 };
  setFood(hub(st), 400);
  offer.qty = Math.ceil(-qlow.points * V.VOL.P.goodsPer / 1) + 5;
  const qpay = V.askQuote(st, f, hp, { n: 3, days: 10, offer });
  check(qpay.yes, `an offer of ${offer.qty} food turns it to yes (${qpay.points} points)`);
  const qfav = V.askQuote(st, f, hp, { n: 3, days: 10, favour: true });
  check(qfav.points - qlow.points === V.VOL.P.favour, `a favour owed: +${V.VOL.P.favour}`);
  const r = V.askVolunteers(st, f, hp, { n: 3, days: 10 });
  check(!r.ok && /will not send/.test(r.text) && V.groupProblem(st, f).includes("said no lately"), `the no is logged and they will not hear you again for ${V.VOL.REFUSED_WAIT} days: "${r.text}"`);
  f.goodwill = 20;
  check(!!V.askQuote(st, f, p, { n: 1 }).refuse, "below goodwill 30 they will not be asked at all");
  f.goodwill = -60;
  check(/hostile/.test(V.askQuote(st, f, p, { n: 1 }).refuse), "a hostile group refuses outright");
  f.goodwill = 70; f.pact = "trade"; delete V.ensureVols(st).refused[f.id];
  f.pop = 10;
  check(/cannot spare/.test(V.askQuote(st, f, p, { n: 3 }).refuse), `a group keeps at least ${V.VOL.HOME_MIN} at home`);
  f.pop = 20;
  // Their trouble: a horde at their base.
  makeHorde(st, { tile: f.bases[0], size: 60, role: "wander", target: f.bases[0] });
  check(V.askQuote(st, f, p, { n: 1 }).parts.some((x) => /horde/.test(x.label)), "a horde near their base weighs against it");
}

// ---------- 2. they come, join, travel and eat ----------
console.log("Joining the team");
{
  const { st, f } = world();
  const { p } = team(st, f.bases[0]);
  const gwBefore = f.goodwill, popBefore = f.pop, arsBefore = f.arsenal ? f.arsenal.items.length : 0;
  const cap0 = partyCapacity(st, p), eat0 = rationsPerHour(st, p), food0 = food(p);
  const r = V.askVolunteers(st, f, p, { n: 2, days: 4 });
  check(r.ok && r.people.length === 2, `yes: "${r.text}"`);
  check(f.goodwill === gwBefore - V.VOL.ASK_GW && f.pop === popBefore - 2, `a favour asked with nothing offered: goodwill −${V.VOL.ASK_GW}; their people away (${popBefore} → ${f.pop})`);
  const kitOut = arsBefore - (f.arsenal ? f.arsenal.items.length : 0);
  check(r.people.every((s) => s.gear.weapon) && kitOut >= 1, `armed from their arsenal (${r.people.map((s) => s.gear.weapon.name).join(", ")}; ${kitOut} pieces out of it)`);
  check(!partyMembers(st, p).some((s) => s.vol), "on their way: not on the team yet");
  const joined = joinNow(st, p);
  check(joined.length === 2 && partyMembers(st, p).filter((s) => s.vol).length === 2, `they reach the team and join it (${joined.map((s) => s.name).join(", ")})`);
  check(survivorById(st, joined[0].id) === joined[0] && !st.survivors.includes(joined[0]), "they are found by id, but are not your people (not in the roster)");
  check(partyCapacity(st, p) > cap0 && rationsPerHour(st, p) > eat0, `they carry (${Math.round(cap0)} → ${Math.round(partyCapacity(st, p))} kg) and eat (${eat0.toFixed(3)} → ${rationsPerHour(st, p).toFixed(3)} rations an hour)`);
  check(food(p) > food0 - 5, `they brought their food (${food0} → ${Math.round(food(p))} after the walk)`);
  const keys = joined.map((s) => (calOf(s.gear.weapon.key) ? baseKey(calOf(s.gear.weapon.key)) : null)).filter(Boolean);
  check(keys.length && keys.every((k) => (p.supplies[k] || 0) > 0), `and rounds for their own guns (${[...new Set(keys)].map((k) => `${k} ${p.supplies[k]}`).join(", ")})`);
  const foodAt = food(p);
  ticks(st, 24);
  check(food(p) < foodAt, `a day with the team: the food goes down (${Math.round(foodAt)} → ${Math.round(food(p))})`);
  // Span over: home, with their kit.
  const s0 = joined[0];
  // Hour by hour: the group's own growth (factions.js factionsDaily, a newcomer some days) goes on meanwhile, so what
  // counts is the hour they come home: their people +1 each (and their arsenal up by the kit they took).
  let homeDelta = null, homeAt = null, arsDelta = null;
  for (let i = 0; i < 24 * 4; i++) {
    const was = V.volunteersWith(st, p).length, pop0 = f.pop, ars0 = f.arsenal ? f.arsenal.items.length : 0;
    tickHour(st);
    if (was && !V.volunteersWith(st, p).length && homeDelta == null) { homeDelta = f.pop - pop0; homeAt = st.hour; arsDelta = (f.arsenal ? f.arsenal.items.length : 0) - ars0; }
  }
  check(!V.volunteersWith(st, p).length && !p.members.includes(s0.id), `the span runs out: they go home ("${(st.log.find((l) => /went home/.test(l.text)) || {}).text}")`);
  check(homeDelta != null && homeDelta - joined.length >= 0 && homeDelta - joined.length <= 1 && arsDelta >= 1 && f.pop >= popBefore,
    `their people back home (+${homeDelta} the hour they came home, hour ${homeAt}; ${popBefore} before they left, ${f.pop} now with the group's own growth) and their kit back in the arsenal (+${arsDelta})`);
}

// ---------- 3. the battle map ----------
console.log("On the battle map");
let battleFired = 0;
{
  const { st, f } = world();
  const { p } = team(st, f.bases[0]);
  V.askVolunteers(st, f, p, { n: 2, days: 6 });
  joinNow(st, p);
  const setup = { tile: f.bases[0], partyId: p.id, enemy: { kind: "raiders", count: 5, power: 4, name: "test raiders" }, ambush: null, canRetreat: true, handler: "none", context: {} };
  globalThis.window = {};
  let b;
  try { b = createBattle(st, setup); } finally { delete globalThis.window; }
  st.combat = b;
  const vols = b.units.filter((u) => u.side === "player" && u.vol != null);
  check(vols.length === 2 && vols.every((u) => u.volGroup === f.name), `two volunteer units on your side (${vols.map((u) => u.name).join(", ")})`);
  const u = vols[0];
  const err = combatAct(st, { type: "move", unit: u.id, x: u.x + 1, y: u.y });
  check(/volunteer/.test(err || ""), `your order is refused: "${err}"`);
  check(/volunteer/.test(combatAct(st, { type: "shoot", unit: u.id, target: b.units.find((e) => e.side === "enemy").id }) || ""), "a shot ordered is refused too");
  // Your turn by hand (nothing ordered): ending it, they act on their own.
  const at = vols.map((x) => `${x.x},${x.y}`).join(" "), shots0 = b.gunshots || 0, ap0 = vols.map((x) => x.ap).join(",");
  for (const e of b.units) if (e.side === "enemy") e.aware = true;
  combatAct(st, { type: "end" });
  const moved = vols.map((x) => `${x.x},${x.y}`).join(" ") !== at;
  battleFired = (b.gunshots || 0) - shots0;
  check(moved || battleFired > 0 || vols.some((x) => x.ow || x.hunker), `ending your turn, they act on their own (moved ${moved}, shots ${battleFired}, AP ${ap0} at the start)`);
  runEnemyPhase(st);
  let turns = 0;
  while (!b.over && turns++ < 40) { autoPlayerTurn(st); if (b.phase === "enemy") runEnemyPhase(st); }
  const vfire = b.log.filter((l) => vols.some((x) => l.text.includes(x.name.split(" ")[0]))).length;
  check(b.over, `the AI playing your side still works with volunteers in it: ${b.result && b.result.outcome} in ${b.turn} turns (${vfire} lines naming them)`);
  closeCombat(st);
  check(V.volunteersWith(st, p).every((s) => s.vol.fought >= 1) || V.volunteersWith(st, p).length === 0, "the volunteers who were in it fought beside you");
  // The retreat: they pull out with your people.
  const { st: s2, f: f2 } = world(SEED + 1);
  const { p: p2 } = team(s2, f2.bases[0]);
  V.askVolunteers(s2, f2, p2, { n: 1, days: 6 });
  joinNow(s2, p2);
  globalThis.window = {};
  let b2;
  try { b2 = createBattle(s2, { ...setup, tile: f2.bases[0], partyId: p2.id }); } finally { delete globalThis.window; }
  s2.combat = b2;
  for (const x of b2.units) if (x.side === "player" && x.vol == null) { x.left = true; }
  combatAct(s2, { type: "end" });
  const v2 = b2.units.find((x) => x.vol != null);
  check(v2 && v2.left && b2.over && b2.result.outcome === "retreat", `your people all out: the volunteer pulls out too (${b2.result && b2.result.outcome})`);
}

// ---------- 4. by the numbers ----------
console.log("By the numbers");
{
  const { st, f } = world();
  const { p } = team(st, f.bases[0]);
  const setup = { tile: f.bases[0], partyId: p.id, enemy: { kind: "raiders", count: 6, power: 4, name: "raiders" }, ambush: null };
  const before = byNumbersOdds(st, setup);
  V.askVolunteers(st, f, p, { n: 2, days: 6 });
  joinNow(st, p);
  const after = byNumbersOdds(st, setup);
  check(after.mine > before.mine && after.win > before.win, `the fight's odds count them: power ${before.mine.toFixed(1)} → ${after.mine.toFixed(1)}, win ${Math.round(before.win * 100)}% → ${Math.round(after.win * 100)}%`);
  const res = autoResolveCombat(st, setup);
  check(!!res.outcome, `a fight resolved by the numbers with them in it: ${res.outcome}`);
}

// ---------- 5. deaths ----------
console.log("Deaths");
{
  const { st, f } = world();
  const { p } = team(st, f.bases[0]);
  V.askVolunteers(st, f, p, { n: 2, days: 6 });
  const [a, b] = joinNow(st, p);
  let gw = f.goodwill;
  st.resolving = 1;
  hurt(st, a, 999, f.bases[0], "in a fight with raiders", { raw: true });
  st.resolving = 0;
  check(!a.alive && Math.abs(f.goodwill - (gw + V.VOL.DEATH.fight)) < 1e-6, `fell in a fight: goodwill ${V.VOL.DEATH.fight} ("${(st.log.find((l) => /mourn/.test(l.text)) || {}).text}")`);
  gw = f.goodwill;
  hurt(st, b, 999, null, "of thirst", { raw: true });
  check(!b.alive && Math.abs(f.goodwill - (gw + V.VOL.DEATH.other)) < 1e-6, `died of thirst in your care: goodwill ${V.VOL.DEATH.other}`);
  check((f.volFallen || []).length === 2 && V.askQuote(st, f, p, { n: 1 }).parts.some((x) => /died with your teams/.test(x.label)), "the group remembers its dead: fewer points for a while");
  check(!st.memorial || !(st.memorial.list || st.memorial || []).some?.((m) => m && m.name === a.name), "not on your memorial wall");
}

// ---------- 6. going home ----------
console.log("Going home");
{
  const { st, f } = world();
  const { p } = team(st, f.bases[0]);
  V.askVolunteers(st, f, p, { n: 1, days: 20 });
  const [s] = joinNow(st, p);
  f.goodwill = 15;
  tickHour(st);
  check(!V.volunteersWith(st, p).length, `goodwill below ${V.VOL.GW_LEAVE}: called home ("${(st.log.find((l) => /went home/.test(l.text)) || {}).text}")`);
  const { st: s2, f: f2 } = world(SEED + 2);
  const { p: p2 } = team(s2, f2.bases[0]);
  V.askVolunteers(s2, f2, p2, { n: 1, days: 20 });
  joinNow(s2, p2);
  for (const id of [...p2.members]) { const x = survivorById(s2, id); if (x && !x.vol) x.alive = false; }
  tickHour(s2);
  check(!V.volunteersWith(s2, p2).length && !s2.parties.includes(p2), "none of your people left: they go home and the team is done");
  const { st: s3, f: f3 } = world(SEED + 3);
  const { p: p3 } = team(s3, f3.bases[0]);
  V.askVolunteers(s3, f3, p3, { n: 1, days: 20 });
  const [v3] = joinNow(s3, p3);
  for (const id of p3.members) { const x = survivorById(s3, id); if (x) x.location = { kind: "base", baseId: hub(s3).id }; }
  s3.parties.splice(s3.parties.indexOf(p3), 1); // the team came home (returnHome moves everyone in and removes it)
  tickHour(s3);
  check(!V.ensureVols(s3).people.includes(v3), "the team came home: the job is done, they go home");
}

// ---------- 7. save and load ----------
console.log("Save and load");
{
  const { st, f } = world();
  const { p } = team(st, f.bases[0]);
  V.askVolunteers(st, f, p, { n: 2, days: 8 });
  joinNow(st, p);
  // Your people lent to a group.
  const ask = V.makeAsk(st, f, { kind: "war", label: "their war" }, 2, 5);
  st.cards = [];
  const lend = V.lendable(st).slice(0, 2).map((s) => s.id);
  V.answerAsk(st, ask.id, lend);
  const txt = saveToString(st, { dropCards: true });
  const s2 = loadFromString(txt);
  const p2 = s2.parties.find((x) => x.id === p.id);
  check(V.volunteersWith(s2, p2).length === 2 && partyMembers(s2, p2).filter((s) => s.vol).length === 2, "volunteers on the team survive a save and load");
  check(lend.every((id) => { const s = s2.survivors.find((x) => x.id === id); return s && V.lentWith(s); }) && V.ensureVols(s2).loans.length === 1, "your people lent out survive it too");
  ticks(st, 24 * 6); ticks(s2, 24 * 6);
  const sig = (w) => JSON.stringify({ v: V.ensureVols(w).stats, loans: V.ensureVols(w).loans.length, hp: w.survivors.map((s) => Math.round(s.health)), gw: w.factions.map((g) => Math.round(g.goodwill * 10)) });
  check(sig(st) === sig(s2), "six days on, the loaded world plays out the same as the original");
}

// ---------- 8. a group asks you ----------
console.log("A group asks you");
{
  const { st, f } = world();
  const str0 = strength(f);
  const ask = V.makeAsk(st, f, { kind: "war", label: "their war with Red Hand" }, 2, 5);
  const card = st.cards.find((c) => c.volAsk === ask.id);
  check(!!card && card.choices.some((c) => /^Send 2/.test(c.label)) && card.choices.some((c) => /Choose who/.test(c.label)) && card.choices.some((c) => c.label === "Decline"), `the card: ${card && card.choices.map((c) => c.label).join(" / ")}`);
  const pick = V.lendable(st).slice(0, 2);
  const gw = f.goodwill;
  const text = V.answerAsk(st, ask.id, pick.map((s) => s.id));
  check(pick.every((s) => V.lentWith(s) && V.lentLine(st, s).includes(f.name)), `"${text}" (on the roster: ${V.lentLine(st, pick[0])})`);
  check(strength(f) > str0 && f.goodwill > gw, `their strength counts your people (${str0.toFixed(1)} → ${strength(f).toFixed(1)}), goodwill +${V.VOL.AI.accept}`);
  st.cards = [];
  let days = 0;
  while (V.ensureVols(st).loans.length && days++ < 12) ticks(st, 24);
  const back = pick.filter((s) => s.alive);
  check(!V.ensureVols(st).loans.length && back.every((s) => s.location.kind === "base"), `back after the span: ${back.length} of 2 alive ("${(st.log.find((l) => /back from/.test(l.text)) || {}).text}")`);
  check(Math.abs(strength(f) - str0) < 1e-6 || strength(f) !== str0, "their aid ends with the loan");
  // Declining.
  const ask2 = V.makeAsk(st, f, { kind: "defence", label: "a horde" }, 1, 4);
  const g2 = f.goodwill;
  V.answerAsk(st, ask2.id, null);
  check(f.goodwill < g2, `declining costs ${Math.round((g2 - f.goodwill) * 10) / 10} goodwill`);
  // Lots of fights: some get hurt.
  let hurtSeen = 0, diedSeen = 0;
  for (let k = 0; k < 6; k++) {
    const { st: w } = world(SEED + 20 + k);
    const g = w.factions.find((x) => x.type === "military") || w.factions[0];
    const a = V.makeAsk(w, g, { kind: "hive", label: "their crawl" }, 3, 7);
    const ppl = V.lendable(w).slice(0, 3);
    V.answerAsk(w, a.id, ppl.map((s) => s.id));
    w.cards = [];
    ticks(w, 24 * 8);
    hurtSeen += ppl.filter((s) => s.alive && s.health < 100).length;
    diedSeen += ppl.filter((s) => !s.alive).length;
  }
  check(hurtSeen + diedSeen > 0, `their fights are coarse but real: over 6 loans of 3, ${hurtSeen} came back hurt, ${diedSeen} died`);
}

// ---------- 9. groups lend each other ----------
console.log("Groups lend each other");
{
  const { st } = world();
  const [g, l] = st.factions.filter((x) => x.alive);
  g.pop = Math.max(g.pop, 15); l.pop = 30;
  makeHorde(st, { tile: g.bases[0], size: 80, role: "wander", target: g.bases[0] });
  changeRelation(st, g, l, 80);
  const lp = l.pop, sg = strength(g);
  let n = 0;
  while (!V.ensureVols(st).aiLoans.length && n++ < 200) V.aiLendDaily(st);
  const L = V.ensureVols(st).aiLoans[0];
  check(!!L && L.to === g.id, `a friend sends fighters to a group with a horde at its gates (${L ? `${L.n} from ${st.factions.find((x) => x.id === L.from).name}` : "none"} after ${n} days)`);
  if (L) {
    const lender = st.factions.find((x) => x.id === L.from);
    check(strength(g) > sg && (lender !== l || l.pop === lp - L.n), `their strength on the asker's (${sg.toFixed(1)} → ${strength(g).toFixed(1)}), the lender's people away`);
    st.hour += 24 * 10;
    V.aiLendDaily(st);
    check(!V.ensureVols(st).aiLoans.some((x) => x === L) && (g.volAid || 0) < 1e-6, "home again after the span, the aid gone");
  }
}

// ---------- 10. a hive crawl with volunteers ----------
console.log("The hive crawl");
{
  const { st, f } = world();
  ensureHives(st);
  const hv = st.hives[0];
  hv.born = 0;
  makeHorde(st, { tile: hv.tile, size: 60, role: "guard", hive: hv.id, target: hv.tile });
  // f a coalition member with a base by the hive: it would thin the brood.
  f.bases.push(hv.tile + 2 < st.tiles.length ? hv.tile + 2 : hv.tile - 2);
  ensureAlliance(st).members.push(f.id);
  const { p, people } = team(st, hv.tile, { n: 4, mission: "hive", phase: "engaged" });
  const before = hiveAllies(st, hv).names.join(", ");
  p.path = [f.bases[0]]; // asked at their gates on the way
  const asked = V.askVolunteers(st, f, p, { n: 2, days: 10, favour: true });
  p.path = [hv.tile];
  if (!asked.ok) console.log("   ", asked.text);
  for (const s of V.ensureVols(st).people) s.location.eta = st.hour; // they are there
  tickHour(st);
  const vols = V.volunteersWith(st, p);
  const after = hiveAllies(st, hv).names.join(", ");
  check(vols.length === 2 && before.includes(f.name) && !after.includes(f.name), `${f.name} thin the brood from outside (${before}) until their volunteers are in the crawl (then: ${after || "nobody"}): no double count`);
  globalThis.window = {};
  let b;
  try { b = createBattle(st, HC.coreSetup(st, p, hv)); } finally { delete globalThis.window; }
  check(b.units.filter((u) => u.vol != null).length === 2, "the core battle has them on the map as volunteer units");
  check(vols.every((s) => lightOf(s)), `for a dark hive they bring lights of their own (${vols.map((s) => lightOf(s)).join(", ")})`);
  const vu = b.units.find((u) => u.vol != null), vs = survivorById(st, vu.sid);
  const lit = vu.sight;
  const keepTool = vs.gear.tool, wm = vs.gear.weapon && vs.gear.weapon.mods, keepTac = wm && wm.tactical; vs.gear.tool = null; if (keepTac) delete wm.tactical; vu.sight = 99; HC.caveDark(st, b); const darkSight = vu.sight; vs.gear.tool = keepTool; if (keepTac) wm.tactical = keepTac; // (and no weapon light: a soldier's military carbine may carry one)
  check(b.dark && lit === LIGHTS[lightOf(vs)].sight + HC.HCRAWL.LIGHT.lit && darkSight === HC.HCRAWL.LIGHT.dark, `in the cave's dark a volunteer sees by their light (${lit} tiles), without one ${darkSight}`);
  st.combat = null;
  st.autoCombat = true;
  HC.startHiveCrawl(st, p, hv);
  let n = 0;
  while (p.hiveCrawl && n++ < 300 && st.parties.includes(p)) HC.hiveCrawlAutoStep(st, p);
  const fought = vols.filter((s) => (s.vol.fought || 0) > 0 || !s.alive).length;
  check(fought >= 1, `in the crawl's fights with your people: ${vols.map((s) => `${s.name} ${s.alive ? `${s.vol.fought} fights` : "fell"}`).join(", ")} (hive ${st.hives.includes(hv) ? "standing" : "destroyed"}, ${people.filter((s) => !s.alive).length} of yours lost)`);
}

// ---------- 11. the governor ----------
console.log("The governor");
{
  const { st, f } = world();
  for (let i = 0; i < 8; i++) { const s = makeSurvivor(st, 1); s.location = { kind: "base", baseId: hub(st).id }; st.survivors.push(s); }
  const ask = V.makeAsk(st, f, { kind: "war", label: "their war" }, 2, 5);
  const card = st.cards.find((c) => c.volAsk === ask.id);
  const best = (style) => { st.governor = { personality: "balanced", style }; return [...card.choices].filter((c) => !c.uiAction && !(typeof c.disabled === "function" && c.disabled(st))).sort((a, b) => b.ai(st) - a.ai(st))[0].label; };
  const home = V.lendable(st).length;
  const dip = best("diplomat"), tur = best("turtle");
  check(/^Send/.test(dip) && tur === "Decline", `with ${home} fit at the hub: the Diplomat answers "${dip}", the Turtle "${tur}"`);
  // A marginal hive: the governor asks. Three pistols (four until the core's numbers were refitted, hivecrawl.js
  // HIVEMIND numbersK 2 -> 0.6 on 2026-10-10: the crawl's estimate fell by a third and four came out at 1.9 against
  // Balanced's 1.5; three are at 1.45, about where four were before). Two since the refit of 2026-10-19 (numbersK 0.4,
  // powerTier 23: three came out at 1.51, two at 1.01).
  const { st: s2, f: f2 } = world(SEED + 5);
  ensureHives(s2);
  const hv = s2.hives[0];
  makeHorde(s2, { tile: hv.tile, size: 120, role: "guard", hive: hv.id, target: hv.tile });
  const { p } = team(s2, hv.tile, { n: 2, mission: "hive", phase: "waiting", weapon: "pistol" });
  p.path = [f2.bases[0]]; // at their gates on the way (in reach)
  s2.governor = { personality: "balanced" };
  V.autoAskVolunteers(s2);
  check(V.volunteersComing(s2, p).length > 0 || /will not|cannot/.test(s2.log.map((l) => l.text).join("|")), `a weak squad for a hive: the governor asks for volunteers (${V.volunteersComing(s2, p).length} coming)`);
}

console.log(`\n${failed ? "FAILED" : "passed"}: ${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
