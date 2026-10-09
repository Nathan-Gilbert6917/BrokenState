// Volunteers, the follow-ups (src/sim/volunteers.js, src/sim/combat.js volOrder / watch): watching your lent people's
// fight on the map (everyone on your side moved by the AI, the group's own fighters, the result into the loan; by the
// numbers headless), old hands (the same people come back; one asks to join you for good: with the group's blessing and
// a weapon, or at a goodwill cost with a knife; groups' fighters staying with the group they helped), simple orders for
// volunteers in battle (Hold here, Follow, Free; refused in a fight you only watch), the loot share (points, the share
// of what the cargo gained, goodwill), groups pulling hurt volunteers out (between a crawl's chambers too, never in a
// fight), and the coalition's council voting fighters to a member's war (the votes, yours, the members' fighters, your
// people lent; voting no).
// Usage: node tools/volunteers2test.js [seed=7]
import { createWorld, tickHour, makeSurvivor, hub, survivorById, atBase } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { partyMembers } from "../src/sim/parties.js";
import { createBattle, combatAct, autoPlayerTurn, runEnemyPhase, closeCombat, unitById } from "../src/sim/combat.js";
import { ensureAlliance } from "../src/sim/alliance.js";
import { startWar, changeRelation } from "../src/sim/diplomacy.js";
import * as V from "../src/sim/volunteers.js";

const SEED = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const t0 = performance.now();

function world(seed = SEED, extra = 8) {
  const st = createWorld({ seed, factionCount: 4 });
  st.started = true;
  st.noNewGangs = true;
  const f = st.factions.find((x) => x.type === "military") || st.factions[0];
  for (const g of st.factions) g.known = true;
  f.goodwill = 70; f.pact = "trade"; f.pop = Math.max(f.pop, 22);
  for (let i = 0; i < extra; i++) { const s = makeSurvivor(st, 1); s.location = { kind: "base", baseId: hub(st).id }; st.survivors.push(s); }
  return { st, f };
}
function team(st, tile, { n = 3, mission = "move", phase = "waiting" } = {}) {
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(st, 1);
    s.traits = []; s.skills.shooting = 8; s.health = 100;
    s.gear.weapon = { key: "ar", name: GEAR.ar.name, quality: 1 };
    st.survivors.push(s);
    people.push(s);
  }
  const p = { id: 93000 + st.parties.length, owner: "player", kind: "expedition", mission, members: people.map((s) => s.id), supplies: { ammo: 300, meds: 6, food: 30, water: 30 }, cargo: { supplies: {}, gear: [] },
    path: [tile], idx: 0, progress: 0, dest: tile, phase, seen: new Map(), spotted: new Map(), homeBaseId: hub(st).id, orders: [], stance: "normal", departed: st.hour, plannedHours: 48 };
  for (const s of people) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  return { p, people };
}
const ticks = (st, n) => { for (let i = 0; i < n; i++) tickHour(st); };
const joinNow = (st, p) => { for (let i = 0; i < 100 && V.volunteersComing(st, p).length; i++) tickHour(st); return V.volunteersWith(st, p); };
const battle = (st, setup) => { globalThis.window = {}; try { return createBattle(st, setup); } finally { delete globalThis.window; } };

// ---------- 1. watching your lent people's fight ----------
console.log("Watching a fight of your people lent out");
{
  const { st, f } = world();
  const ask = V.makeAsk(st, f, { kind: "war", label: "their war" }, 2, 6);
  st.cards = [];
  const ppl = V.lendable(st).slice(0, 2);
  V.answerAsk(st, ask.id, ppl.map((s) => s.id));
  const loan = V.ensureVols(st).loans[0];
  const card = V.watchCard(st, loan);
  check(card.choices.map((c) => c.label).join(" / ") === "Watch the fight / Let it play out" && card.choices[1].default, `the card: ${card.choices.map((c) => c.label).join(" / ")} (left alone: Let it play out)`);
  const setup = V.watchSetup(st, loan);
  check(Object.keys(setup.pool).some((k) => /^a_/.test(k) && setup.pool[k] > 0), `their group hands them rounds for their guns (${Object.entries(setup.pool).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  const b = battle(st, setup);
  st.combat = b;
  const mine = b.units.filter((u) => u.side === "player");
  const allies = b.units.filter((u) => u.side === "third");
  check(mine.length === 2 && mine.every((u) => u.vol != null && u.watched) && allies.length >= 2, `on the map: your ${mine.length} lent people (all moved by the AI) and ${allies.length} of ${f.name}'s fighters against ${b.units.filter((u) => u.side === "enemy").length} ${setup.enemy.name}`);
  check(/volunteer/.test(combatAct(st, { type: "move", unit: mine[0].id, x: mine[0].x + 1, y: mine[0].y }) || "") && /volunteer/.test(combatAct(st, { type: "volOrder", unit: mine[0].id, order: "hold" }) || ""), "you only watch: no orders, not even a simple one");
  const at = mine.map((u) => `${u.x},${u.y}`).join(" ");
  let n = 0;
  while (!b.over && n++ < 60) { autoPlayerTurn(st); if (b.phase === "enemy") runEnemyPhase(st); }
  check(b.over && mine.map((u) => `${u.x},${u.y}`).join(" ") !== at, `it plays itself out (${b.result.outcome} in ${b.turn} turns), your people moving on their own`);
  const fights = loan.fights;
  closeCombat(st);
  check(loan.fights === fights + 1 && (b.bodies || []).length === 0, `its end goes into the loan (fights ${fights} → ${loan.fights}); the field is the group's`);
  // Headless (no browser): no card, by the numbers.
  const { st: s2, f: f2 } = world(SEED + 1);
  const a2 = V.makeAsk(s2, f2, { kind: "hive", label: "their crawl" }, 2, 8);
  s2.cards = [];
  V.answerAsk(s2, a2.id, V.lendable(s2).slice(0, 2).map((s) => s.id));
  for (let d = 0; d < 6; d++) { s2.hour = (Math.floor(s2.hour / 24) + 1) * 24 - 1; tickHour(s2); }
  check(!s2.cards.some((c) => c.volWatch != null) && (V.ensureVols(s2).loans[0] ? V.ensureVols(s2).loans[0].fights : 1) >= 1, `headless: no card, the fights by the numbers (${V.ensureVols(s2).loans[0] ? V.ensureVols(s2).loans[0].fights : "loan over"})`);
}

// ---------- 2. old hands ----------
console.log("Old hands");
{
  const { st, f } = world();
  const { p } = team(st, f.bases[0]);
  let first = null;
  for (let trip = 0; trip < 3; trip++) {
    const r = V.askVolunteers(st, f, p, { n: 1, days: 2, offer: { key: "food", qty: 40 } });
    hub(st).stock.food = 400;
    const [s] = joinNow(st, p);
    if (trip === 0) first = s;
    else if (!check(s === first, `trip ${trip + 1}: the same person comes back (${s && s.name})`)) break;
    ticks(st, 24 * 3);
    if (!r.ok) break;
  }
  const v = (f.volVets || []).find((x) => x.s === first);
  check(!!v && v.trips === 3 && !first.vol, `${first.name} is one of ${f.name}'s old hands: ${v && v.trips} trips, ${v && Math.round(v.days)} days`);
  f.goodwill = 85;
  const card = V.vetCard(st, f, v);
  const gw = f.goodwill, pop = f.pop;
  const text = card.choices[0].resolve(st);
  check(st.survivors.includes(first) && first.location.kind === "base" && first.gear.weapon && f.goodwill === gw && f.pop === pop - 1, `with their group's blessing: "${text}" (a ${first.gear.weapon && first.gear.weapon.name}, goodwill unchanged, ${f.name} one fewer)`);
  // At a cost.
  const { st: s2, f: f2 } = world(SEED + 2);
  const { p: p2 } = team(s2, f2.bases[0]);
  V.askVolunteers(s2, f2, p2, { n: 1, days: 2 });
  const [w] = joinNow(s2, p2);
  ticks(s2, 24 * 3);
  const v2 = f2.volVets.find((x) => x.s === w);
  f2.goodwill = 65;
  const g2 = f2.goodwill;
  V.welcomeVet(s2, f2, v2);
  check(s2.survivors.includes(w) && f2.goodwill === g2 + V.VOL.VET.cost && w.gear.weapon && w.gear.weapon.key === "knife", `without it: ${V.VOL.VET.cost} goodwill, and they come with a knife`);
  // Groups: one of the fighters lent may stay with the group they helped.
  const { st: s3 } = world(SEED + 3);
  let stays = 0;
  for (let k = 0; k < 400 && !stays; k++) {
    const [g, l] = s3.factions;
    g.alive = l.alive = true; g.pop = 20; l.pop = 30;
    V.ensureVols(s3).aiLoans.push({ from: l.id, to: g.id, n: 3, power: 10, until: 0, kind: "war" });
    g.volAid = 10;
    V.aiLendDaily(s3);
    stays = V.ensureVols(s3).stats.aiStayed || 0;
  }
  check(stays > 0, "groups too: one of a friend's fighters now and then stays with the group they helped");
}

// ---------- 3. simple orders in battle ----------
console.log("Orders for volunteers");
{
  const { st, f } = world();
  const { p } = team(st, f.bases[0]);
  V.askVolunteers(st, f, p, { n: 2, days: 6 });
  joinNow(st, p);
  const b = battle(st, { tile: f.bases[0], partyId: p.id, enemy: { kind: "raiders", count: 4, power: 4, name: "raiders" }, ambush: null, canRetreat: true, handler: "none", context: {} });
  st.combat = b;
  const [a, c] = b.units.filter((u) => u.vol != null);
  const lead = b.units.find((u) => u.side === "player" && u.vol == null);
  check(!combatAct(st, { type: "volOrder", unit: a.id, order: "hold" }) && a.volOrder === "hold", `"Hold here" taken (${a.name})`);
  check(!combatAct(st, { type: "volOrder", unit: c.id, order: "follow", target: lead.id }) && c.volOrder === "follow" && c.volLead === lead.id, `"Follow ${lead.name}" taken (${c.name})`);
  check(!!combatAct(st, { type: "volOrder", unit: c.id, order: "follow", target: a.id }), "they follow only your own people");
  lead.x = Math.min(b.w - 2, lead.x + 6); // walk the lead off a little (a free cell is not needed for the test: they are moved by hand)
  const aAt = `${a.x},${a.y}`, d0 = Math.hypot(c.x - lead.x, c.y - lead.y);
  for (const e of b.units) if (e.side === "enemy") e.aware = false; // nobody has noticed them: the follow and the hold show plainly
  combatAct(st, { type: "end" });
  check(`${a.x},${a.y}` === aAt, `holding: ${a.name} stays where they are`);
  check(Math.hypot(c.x - lead.x, c.y - lead.y) <= d0, `following: ${c.name} keeps up (${d0.toFixed(1)} → ${Math.hypot(c.x - lead.x, c.y - lead.y).toFixed(1)} tiles)`);
  runEnemyPhase(st);
  check(!combatAct(st, { type: "volOrder", unit: a.id, order: "free" }) && a.volOrder === "free", `"Free": their own judgement again`);
  st.combat = null;
}

// ---------- 4. the loot share ----------
console.log("The share of the haul");
{
  const { st, f } = world();
  const { p } = team(st, f.bases[0]);
  const q0 = V.askQuote(st, f, p, { n: 1 }), q1 = V.askQuote(st, f, p, { n: 1, share: 0.25 });
  check(Math.abs(q1.points - q0.points - 0.25 * V.VOL.SHARE.points) < 1e-6, `a 25% share is worth +${0.25 * V.VOL.SHARE.points} points`);
  p.cargo.supplies.meds = 2;
  V.askVolunteers(st, f, p, { n: 1, days: 2, share: 0.25 });
  joinNow(st, p);
  p.cargo.supplies.meds += 8; // the team's haul while they are with it
  const gw = f.goodwill;
  ticks(st, 24 * 3);
  const line = (st.log.find((l) => /share of the haul/.test(l.text)) || {}).text || "";
  check(/: 2 meds\./.test(line) && p.cargo.supplies.meds === 8 && f.goodwill > gw, `when they leave, 25% of the 8 meds gained goes to ${f.name}, goodwill up ("${line}")`);
}

// ---------- 5. pulled out when hurt ----------
console.log("Hurt volunteers pulled out");
{
  const { st, f } = world();
  const { p } = team(st, f.bases[0], { mission: "hive" });
  V.askVolunteers(st, f, p, { n: 2, days: 10, favour: true });
  const [a, c] = joinNow(st, p);
  a.health = V.VOL.PULL.hp - 10;
  st.combat = { setup: { partyId: p.id }, over: false };
  tickHour(st);
  check(V.volunteersWith(st, p).includes(a), "not in the middle of a fight");
  st.combat = null;
  p.hiveCrawl = { hiveId: 1, tile: p.dest }; // between a crawl's chambers
  tickHour(st);
  check(!V.volunteersWith(st, p).includes(a) && V.volunteersWith(st, p).includes(c), `hurt (health ${Math.round(a.health)}): their group pulls them out between the crawl's chambers ("${(st.log.find((l) => /pull them out/.test(l.text)) || {}).text}")`);
  delete p.hiveCrawl;
}

// ---------- 6. the council votes fighters for a member's war ----------
console.log("The council: volunteers for a member's war");
{
  const { st } = world(SEED, 10);
  const [m, a, c, e] = st.factions;
  for (const x of [m, a, c]) { x.alive = true; x.pop = Math.max(x.pop, 20); x.pact = "trade"; x.goodwill = 70; }
  ensureAlliance(st).members.push(m.id, a.id, c.id);
  startWar(st, m, e);
  changeRelation(st, a, m, 60); changeRelation(st, c, m, 60); changeRelation(st, a, e, -60); changeRelation(st, c, e, -60);
  const card = V.councilVolCard(st, [m, a, c], 10);
  check(!!card && /Vote yes and send 1/.test(card.choices[0].label) && card.choices.some((x) => x.label === "Vote no"), `the card: ${card && card.choices.map((x) => x.label.replace(/:.*/, "")).join(" / ")}`);
  const popA = a.pop, aid = m.volAid || 0;
  const text = card.choices[0].resolve(st);
  const mineLent = st.survivors.filter((s) => s.alive && V.lentWith(s) && V.lentWith(s).fid === m.id);
  check(/carries/.test(text) && a.pop < popA && (m.volAid || 0) > aid && mineLent.length === 1, `it carries: the members send fighters (${a.name} ${popA} → ${a.pop}), ${m.name}'s strength grows, one of yours goes (${mineLent.map((s) => s.name).join(", ")})`);
  changeRelation(st, c, m, -150); // now only one other member would say yes: your no sinks it
  const gw = m.goodwill;
  const card2 = V.councilVolCard(st, [m, a, c], 10);
  const t2 = card2.choices.find((x) => x.label === "Vote no").resolve(st);
  check(/fails/.test(t2) && Math.abs(m.goodwill - (gw + V.VOL.COUNCIL.no)) < 1e-9, `"${t2}": voting no costs ${V.VOL.COUNCIL.no} goodwill with ${m.name}`);
}

console.log(`\n${failed ? "FAILED" : "passed"}: ${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
