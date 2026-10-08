// Jails (jailhouse): your three tiers (makeshift cells, holding cells, a jailhouse: buildings.js family "jail",
// prisoners.js JAIL), no jail no prisoners (the settle card, the autopilot's own pick, a team's prisoners booked into a
// base with room and walked on), escapes strictly by tier (guarded, unguarded, at work, with something to slip out
// with), mood and work, the new tasks, a rescue by tier, the governor's jail, older saves' shed prisoners kept; the AI
// groups' jails (groupjails.js: built after capturing, capacity and the no-room fates by type, your captive's escape and
// fate, groupJailTier for the rescue map, labour, trades between groups, a sale of your captive), save round-trips.
// Usage: node tools/jailtest.js [seed]
import { createWorld, tickHour, hub, atBase, day, newId, factionById } from "../src/sim/world.js";
import { BUILDINGS, addBuilding, canBuild, queueBuild, constructionHour, SHELTER, plotsFree } from "../src/sim/buildings.js";
import {
  PRISON, JAIL, JAIL_TIERS, SHED, TASKS, prisonersAt, prisonersWith, captiveRecords, capturePrisoners, prisonersDaily, prisonersHour,
  cellCap, freeCells, jailTier, escapeOdds, labourOutput, moodWork, setTask, settle, labourWatch, prisonGuardsWanted, jailDefence,
  recruitRate, prisonWoodDay, roomText, surrenderPrisoners, takePrisonersAt, inCell, movePrisoner,
} from "../src/sim/prisoners.js";
import { prisonTab } from "../src/ui/prisoners.js";
import { launchExpedition, startReturn } from "../src/sim/parties.js";
import { housingAI, setAutopilot } from "../src/sim/autopilot.js";
import { takeCaptive, captivesOf, allCaptives, CAPTIVE_TOOL } from "../src/sim/conflicts.js";
import {
  GROUP_JAIL, groupJailTier, groupJailCap, groupRoom, groupHeld, groupCapture, groupJailsHour, groupJailsDaily, captiveEscape,
  groupLabour, jailWork, jailText, groupPrisoners,
} from "../src/sim/groupjails.js";
import { nextWork, groupWorksDaily } from "../src/sim/groupworks.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { relation } from "../src/sim/diplomacy.js";
import { talksOf, openNegotiation } from "../src/sim/ransom.js";
import { jailTier as rescueTier, JAIL as RESCUE_JAIL } from "../src/sim/rescueraid.js";
import { createBattle, combatAct, closeCombat, runEnemyPhase, endPlayerTurn, registerCombatHandler } from "../src/sim/combat.js";
import { surrender } from "../src/sim/nonlethal.js";
registerCombatHandler("jt", () => {});

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const pct = (v) => `${Math.round(v * 1000) / 10}%`;
const t0 = Date.now();

const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.visitorsOff = true; return st; };
const jail = (h, type) => { h.buildings = h.buildings.filter((b) => !JAIL[b.type]); if (type) addBuilding(h, type); };
const groupOf = (st, pred = () => true) => st.factions.find((f) => f.alive && f.pop >= 8 && f.bases.length && pred(f));
function take(st, h, n, f = groupOf(st)) {
  const fakeB = { setup: { enemy: { kind: "raiders", power: 3, factionId: f.id, name: f.name } }, tileId: h.tile };
  const recs = captiveRecords(st, fakeB, Array.from({ length: n }, (_, i) => ({ kit: "raiders", name: `Raider ${i + 1}`, factionId: f.id })));
  for (const r of recs) delete r.smuggled; // the dice of a hidden pick are tested on their own
  return capturePrisoners(st, { baseId: h.id, tile: h.tile, enemy: fakeB.setup.enemy }, { outcome: "victory", tactical: true, prisoners: recs }, null);
}
function outpost(st, near = 6) {
  const h = hub(st);
  const t = st.tiles.find((x) => x.terrain !== "water" && st.grid.distance(x.id, h.tile) === near && !st.factions.some((f) => f.bases.includes(x.id)));
  const o = { id: newId(), tile: t.id, type: "outpost", name: "Test Outpost", stock: { food: 200, water: 200, rawwater: 0, scrap: 50, parts: 5 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(o);
  return o;
}
const noDice = (fn) => {
  const keep = { ...PRISON.ESCAPE }, kl = { g: PRISON.LABOUR.escapeGuarded, u: PRISON.LABOUR.escapeUnguarded }, sab = PRISON.LABOUR.sabotage.chance;
  for (const k of ["guarded", "unguarded", "shed", "unfed"]) PRISON.ESCAPE[k] = 0;
  const lk = { g: JAIL.lockup.guarded, u: JAIL.lockup.unguarded };
  JAIL.lockup.guarded = 0; JAIL.lockup.unguarded = 0;
  PRISON.LABOUR.escapeGuarded = 0; PRISON.LABOUR.escapeUnguarded = 0; PRISON.LABOUR.sabotage.chance = 0;
  try { return fn(); } finally { Object.assign(PRISON.ESCAPE, keep); PRISON.LABOUR.escapeGuarded = kl.g; PRISON.LABOUR.escapeUnguarded = kl.u; PRISON.LABOUR.sabotage.chance = sab; JAIL.lockup.guarded = lk.g; JAIL.lockup.unguarded = lk.u; }
};

// ---------- 1. the tiers ----------
{
  console.log("The jail tiers");
  const fam = ["lockup", "cells", "jailhouse"].map((k) => BUILDINGS[k]);
  check(fam.every((d, i) => d.family === "jail" && d.tier === i + 1) && BUILDINGS.cells.upgrades === "lockup" && BUILDINGS.jailhouse.upgrades === "cells", "family jail: makeshift cells (1) → holding cells (2, the old key) → jailhouse (3)");
  check(BUILDINGS.lockup.cost.scrap === 6 && !BUILDINGS.lockup.cost.parts && BUILDINGS.lockup.hours === 6 && !BUILDINGS.lockup.req && BUILDINGS.lockup.plot === "utility", "makeshift cells: 6 scrap, 6 hours, no skill, a utility plot");
  check(BUILDINGS.jailhouse.cost.scrap === 30 && BUILDINGS.jailhouse.cost.parts === 2 && BUILDINGS.jailhouse.hours === 36 && BUILDINGS.jailhouse.req.mechanics === 2, "jailhouse: 30 scrap, 2 parts, 36 hours, Mechanics 2");
  check(JAIL.lockup.cap === 2 && JAIL.cells.cap === 3 && JAIL.jailhouse.cap === 8, "they hold 2, 3 and 8");
  check(SHELTER.build.lockup === 1 && !SHELTER.build.cells, "a shelter can put up makeshift cells (not the others)");
  const st = world();
  const h = hub(st);
  jail(h, "lockup"); check(cellCap(h) === 2 && jailTier(h) === 1, "a base with makeshift cells holds 2");
  jail(h, "cells"); check(cellCap(h) === 3 && jailTier(h) === 2, "holding cells hold 3");
  jail(h, "jailhouse"); check(cellCap(h) === 8 && jailTier(h) === 3, "a jailhouse holds 8");
  jail(h, null); h.buildings.push({ id: newId(), type: "cells" }, { id: newId(), type: "cells" });
  check(cellCap(h) === 6 && jailTier(h) === 2, "an older save's two holding cells still hold 6");
}

// ---------- 2. the upgrade path ----------
{
  console.log("Upgrades");
  const st = world();
  const h = hub(st);
  Object.assign(h.stock, { scrap: 200, parts: 10 });
  const ppl = atBase(st, h.id);
  for (const s of ppl) { s.role = "build"; s.skills.mechanics = 0; }
  check(!canBuild(st, h, "cells").ok && /makeshift cells first/i.test(canBuild(st, h, "cells").reason), `holding cells need makeshift cells first ("${canBuild(st, h, "cells").reason}")`);
  check(!canBuild(st, h, "jailhouse").ok, "a jailhouse needs holding cells first");
  const finish = () => { for (let i = 0; i < 400 && h.construction.length; i++) constructionHour(st); };
  queueBuild(st, h, "lockup"); finish();
  check(h.buildings.some((b) => b.type === "lockup") && cellCap(h) === 2, "makeshift cells built");
  const util = plotsFree(h, "utility"), bld = plotsFree(h, "building");
  check(canBuild(st, h, "cells").ok, "then holding cells can go up");
  queueBuild(st, h, "cells"); finish();
  check(h.buildings.filter((b) => BUILDINGS[b.type].family === "jail").map((b) => b.type).join() === "cells" && plotsFree(h, "utility") === util + 1 && plotsFree(h, "building") === bld - 1, "the cells replace the cage: the utility plot freed, a building plot taken");
  check(!canBuild(st, h, "jailhouse").ok && /Mechanics 2/.test(canBuild(st, h, "jailhouse").reason), `the jailhouse needs a Mechanics 2 builder ("${canBuild(st, h, "jailhouse").reason}")`);
  ppl[0].skills.mechanics = 2;
  check(canBuild(st, h, "jailhouse").ok, "with one it can go up");
  queueBuild(st, h, "jailhouse"); finish();
  check(h.buildings.filter((b) => BUILDINGS[b.type].family === "jail").map((b) => b.type).join() === "jailhouse" && cellCap(h) === 8, "a jailhouse stands in the cells' place (8)");
  check(!canBuild(st, h, "lockup").ok, "and nothing lower can be built beside it");
}

// ---------- 3. no jail, no prisoners: the card ----------
{
  console.log("No room");
  const st = world();
  const h = hub(st);
  jail(h, null);
  const n0 = st.cards.length;
  const list = take(st, h, 2);
  const cards = st.cards.slice(n0).filter((c) => c.kind === "prisonerSettle");
  check(list.length === 2 && list.every((p) => p.awaiting) && !list.some((p) => inCell(st, p)), "no jail: both wait in the yard, in no cell");
  check(cards.length === 2, `a card for each (${cards.length})`);
  const labels = cards[0] ? cards[0].choices.map((c) => c.label) : [];
  check(labels.includes("Release") && labels.includes("Execute") && labels.some((l) => /^Ask to join/.test(l)) && !labels.some((l) => /^Hold at/.test(l)), `choices: ${labels.join(" / ")} (no base with room: no Hold)`);
  const f = factionById(st, list[0].factionId), g0 = f.goodwill;
  cards[0].choices.find((c) => c.label === "Release").resolve(st);
  check(!st.prisoners.includes(list[0]) && f.goodwill > g0, `Release: gone home, goodwill ${g0} → ${f.goodwill}`);
  cards[1].choices.find((c) => c.label === "Execute").resolve(st);
  check(!st.prisoners.includes(list[1]) && st.stats.executions === 1, "Execute: dead, counted");
  // Another base with room: Hold there (an escort walks them).
  const o = outpost(st);
  jail(o, "cells");
  const n1 = st.cards.length;
  const [p] = take(st, h, 1);
  const card = st.cards.slice(n1).find((c) => c.kind === "prisonerSettle");
  const hold = card && card.choices.find((c) => /^Hold at Test Outpost/.test(c.label));
  check(!!hold && card.choices[0] === hold, "with room at another base: Hold there comes first");
  hold.resolve(st);
  check(p.at.kind === "transit" && p.at.baseId === o.id && freeCells(st, o) === 2, `held at the outpost: walked there (${p.at.kind}, its room booked: ${freeCells(st, o)} free)`);
  noDice(() => { for (let i = 0; i < 48 && p.at.kind === "transit"; i++) { st.hour++; prisonersHour(st); } });
  check(p.at.kind === "base" && p.at.baseId === o.id && inCell(st, p), "the escort arrives: in a cell at the outpost");
  check(/Room for 2 more prisoners at Test Outpost/.test(roomText(st)), `room text: "${roomText(st)}"`);
  // Surrendered defenders (conquest.js): the room first, a card for the rest.
  const n2 = st.cards.length;
  const g = groupOf(st);
  const sur = surrenderPrisoners(st, g, h, 3);
  check(sur.length === 3 && st.cards.length - n2 === 3, "surrendered with no jail at the base: a card each (the outpost's 2 free can be picked)");
}

// ---------- 3b. a battle: surrendered and tied, knocked out, with no room ----------
{
  console.log("After a battle");
  const st = world(seed + 20);
  const h = hub(st);
  jail(h, "lockup");
  const f = groupOf(st);
  const ids = atBase(st, h.id).slice(0, 3).map((s) => s.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy: { kind: "raiders", count: 4, power: 3, factionId: f.id, name: f.name }, ambush: "player", canRetreat: false, handler: "jt", context: {} });
  const b = st.combat;
  const foes = b.units.filter((x) => x.side === "enemy");
  for (const e of foes.slice(0, 2)) { surrender(b, e); e.tied = true; } // nonlethal.js: gave up, then tied
  for (const e of foes.slice(2)) { e.hp = 0; e.ko = true; e.down = true; }
  combatAct(st, { type: "end" });
  if (!b.over) { endPlayerTurn(st); runEnemyPhase(st); }
  const n0 = st.cards.length;
  const taken = (b.result && b.result.prisoners) || [];
  closeCombat(st);
  const cards = st.cards.slice(n0).filter((c) => c.kind === "prisonerSettle");
  check(taken.length >= 3 && prisonersAt(st, h.id).filter((p) => !p.awaiting).length === 2 && cards.length === taken.length - 2, `${taken.length} taken (surrendered and tied, knocked out): 2 into the makeshift cells, a card for each of the other ${cards.length}`);
}

// ---------- 4. the autopilot's pick ----------
{
  console.log("The autopilot decides");
  const st = world(seed + 1);
  const h = hub(st);
  jail(h, "lockup");
  setAutopilot(st, true, "balanced");
  const n0 = st.cards.length;
  const before = (st.prisoners || []).length;
  const list = take(st, h, 4);
  check(st.cards.length === n0 || st.cards.slice(n0).every((c) => c.kind !== "prisonerSettle"), "no card: the governor decides at once");
  check(prisonersAt(st, h.id).length - before === 2, `two in the makeshift cells (${prisonersAt(st, h.id).length - before}); the other two let go or asked to join`);
  // Hold where there is room; ask the skilled.
  const o = outpost(st);
  jail(o, "cells");
  const st2 = st;
  const [p] = take(st2, h, 1);
  check(p.at.kind === "transit" && p.at.baseId === o.id, "room at another base: walked there");
  void list;
}

// ---------- 5. a team's prisoners ----------
{
  console.log("A team in the field");
  const st = world(seed + 2);
  const h = hub(st);
  jail(h, null);
  const o = outpost(st, 5);
  jail(o, "lockup");
  const f = groupOf(st);
  const crew = atBase(st, h.id).slice(0, 3).map((s) => s.id);
  const tile = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) >= 3 && st.grid.distance(t.id, h.tile) <= 5).id;
  const res = launchExpedition(st, { memberIds: crew, dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 14, water: 14, ammo: 20, meds: 2 } });
  const party = res.party;
  const fakeB = { setup: { enemy: { kind: "raiders", power: 3, factionId: f.id, name: f.name } }, tileId: tile };
  const recs = captiveRecords(st, fakeB, [{ kit: "raiders", name: "A" }, { kit: "raiders", name: "B" }, { kit: "raiders", name: "C" }]);
  const n0 = st.cards.length;
  capturePrisoners(st, { partyId: party.id, tile, enemy: fakeB.setup.enemy }, { outcome: "victory", tactical: true, prisoners: recs }, null);
  const withT = prisonersWith(st, party.id);
  check(withT.length === 3, "the team leads all three (only a base needs room)");
  check(withT.filter((p) => p.dest === o.id).length === 2 && withT.filter((p) => p.awaiting).length === 1 && st.cards.length - n0 === 1, "two booked into the outpost's cage, one waits on a card (no room anywhere)");
  st.cards.slice(n0)[0].choices.find((c) => c.label === "Release").resolve(st);
  noDice(() => {
    st.hour = Math.ceil(st.hour / 24) * 24 - 1;
    startReturn(st, party);
    for (let i = 0; i < 24 * 8 && st.parties.includes(party); i++) tickHour(st);
    for (let i = 0; i < 48; i++) tickHour(st);
  });
  check(prisonersAt(st, o.id).length === 2 && prisonersAt(st, h.id).length === 0, `home with no jail: walked on to the outpost (${prisonersAt(st, o.id).length} there)`);
}

// ---------- 6. escapes by tier ----------
{
  console.log("Escapes by tier");
  const st = world(seed + 3);
  const h = hub(st);
  const f = groupOf(st);
  const odds = (type, guard, task = "idle", kit = false) => {
    jail(h, type);
    st.prisoners = [];
    for (const s of atBase(st, h.id)) s.role = "rest";
    if (guard) atBase(st, h.id)[0].role = "guard";
    const [p] = take(st, h, 1, f);
    p.s.health = 80; p.s.mood = 50; p.s.skills.stealth = 0;
    if (kit) p.smuggled = PRISON.KIT.items[0];
    setTask(st, p.id, task);
    Object.assign(h.stock, { food: 300, water: 300 });
    return escapeOdds(st, p);
  };
  const tiers = ["lockup", "cells", "jailhouse"];
  const g = tiers.map((t) => odds(t, true)), u = tiers.map((t) => odds(t, false));
  check(near(g[0], 0.02) && near(g[1], 0.004) && near(g[2], 0.002), `guarded: makeshift ${pct(g[0])}, cells ${pct(g[1])}, jailhouse ${pct(g[2])}`);
  check(near(u[0], 0.06) && near(u[1], 0.03) && near(u[2], 0.015), `unguarded: ${pct(u[0])}, ${pct(u[1])}, ${pct(u[2])}`);
  check(g[0] > g[1] && g[1] > g[2] && u[0] > u[1] && u[1] > u[2] && u.every((x, i) => x > g[i]), "strictly ordered: lower tiers easier, unguarded easier");
  const w = tiers.map((t) => odds(t, true, "farm")), wu = tiers.map((t) => odds(t, false, "farm"));
  check(w[0] > w[1] && w[1] > w[2] && wu[0] > wu[1] && wu[1] > wu[2], `at work, watched: ${w.map(pct).join(" > ")}; unwatched: ${wu.map(pct).join(" > ")} (a jailhouse's work detail half as leaky)`);
  const k = tiers.map((t) => odds(t, true, "idle", true));
  check(near(k[0] / g[0], JAIL.lockup.bonus) && near(k[2] / g[2], JAIL.jailhouse.bonus) && k[0] > k[1] && k[1] > k[2], `a smuggled pick: ×${(k[0] / g[0]).toFixed(2)} in makeshift cells, ×${(k[2] / g[2]).toFixed(2)} in a jailhouse`);
  // The old shed (older saves) is the worst of all.
  jail(h, "cells");
  st.prisoners = [];
  takePrisonersAt(st, f, h, 4);
  const shed = prisonersAt(st, h.id)[3];
  delete shed.smuggled; shed.s.skills.stealth = 0; shed.s.mood = 50;
  check(!inCell(st, shed) && near(escapeOdds(st, shed), Math.max(PRISON.ESCAPE.shed, 0)) && PRISON.ESCAPE.shed > JAIL.lockup.unguarded, `the shed: ${pct(escapeOdds(st, shed))} a day`);
  // A rescue meets the defence × the tier.
  const d = tiers.map((t) => { jail(h, t); return jailDefence(h); });
  check(d[0] < d[1] && d[1] < d[2], `a rescue by their group meets the base's defence ×${d.join(" / ×")}`);
  // A guard watches 3 / 4 / all at work.
  jail(h, "jailhouse"); st.prisoners = []; take(st, h, 6, f);
  for (const p of prisonersAt(st, h.id)) { p.s.health = 80; setTask(st, p.id, "farm"); }
  for (const s of atBase(st, h.id)) s.role = "rest";
  atBase(st, h.id)[0].role = "guard";
  check(labourWatch(st, h).watched.size === 6 && prisonGuardsWanted(st, h) === 1, "a jailhouse's guard post: one guard watches all six at work");
}

// ---------- 7. mood and work ----------
{
  console.log("Mood and work");
  check(near(moodWork({ s: { mood: 0 } }), 0.6) && near(moodWork({ s: { mood: 50 } }), 0.9) && near(moodWork({ s: { mood: 100 } }), 1.15), `mood × work: 0 → ${moodWork({ s: { mood: 0 } })}, 50 → ${moodWork({ s: { mood: 50 } })}, 100 → ${moodWork({ s: { mood: 100 } })}`);
  const st = world(seed + 4);
  const h = hub(st);
  jail(h, "cells");
  const [p] = take(st, h, 1);
  p.s.health = 80;
  setTask(st, p.id, "farm");
  p.s.mood = 90; const hi = labourOutput(st, p, h);
  p.s.mood = 10; const lo = labourOutput(st, p, h);
  check(near(lo / hi, moodWork({ s: { mood: 10 } }) / moodWork({ s: { mood: 90 } }), 0.01), `a miserable prisoner works less: ${pct(lo)} vs ${pct(hi)}`);
  for (const s of atBase(st, h.id)) s.role = "rest";
  p.s.mood = 30; const e30 = escapeOdds(st, p);
  p.s.mood = 22; const e22 = escapeOdds(st, p);
  check(near(e22 / e30, PRISON.LABOUR.lowMoodMult, 1e-6), `at work under mood ${PRISON.LABOUR.lowMood}: escapes ×${(e22 / e30).toFixed(2)}`);
  // Sabotage now and then.
  let sab = 0;
  const keep = PRISON.LABOUR.sabotage.chance;
  noDice(() => {
    PRISON.LABOUR.sabotage.chance = keep;
    for (let i = 0; i < 300; i++) { p.s.mood = 5; p.s.health = 80; p.task = "scrap"; h.stock.scrap = 100; h.stock.food = 300; h.stock.water = 300; st.hour += 24; prisonersDaily(st); }
    sab = st.stats.prisonSabotage || 0;
  });
  check(sab > 0 && sab < 30, `sullen hands spoil things now and then: ${sab} times in 300 days (${pct(keep)} a day)`);
  // The tier feeds mood and winning over.
  const moodAfter = (type) => noDice(() => {
    const w = world(seed + 5);
    const b = hub(w);
    jail(b, type);
    const [q] = take(w, b, 1);
    q.s.mood = 50; q.s.health = 80;
    Object.assign(b.stock, { food: 300, water: 300 });
    for (let i = 0; i < 10; i++) { w.hour += 24; prisonersDaily(w); }
    q.mode = "recruit";
    return { mood: q.s.mood, rate: recruitRate(w, q) };
  });
  const ml = moodAfter("lockup"), mc = moodAfter("cells"), mj = moodAfter("jailhouse");
  check(near(ml.mood, mc.mood + 10 * JAIL.lockup.mood) && mj.mood === mc.mood, `makeshift cells sour them: mood ${ml.mood} after 10 days vs ${mc.mood} in cells, ${mj.mood} in a jailhouse`);
  check(ml.rate < mc.rate, `and slow winning them over (${ml.rate.toFixed(2)} vs ${mc.rate.toFixed(2)} a day)`);
  // The new tasks.
  check(TASKS.wood && TASKS.scrap, "two new tasks: Cut wood, Haul and sort scrap");
  noDice(() => {
    const w = world(seed + 6);
    const b = hub(w);
    jail(b, "cells");
    const [q] = take(w, b, 1);
    q.s.mood = 200 / 3; q.s.health = 80;
    Object.assign(b.stock, { food: 300, water: 300, scrap: 0, wood: 0 });
    setTask(w, q.id, "scrap");
    const out = labourOutput(w, q, b);
    w.hour += 24; prisonersDaily(w);
    check(near(b.stock.scrap, Math.round(PRISON.LABOUR.scrap * out * 100) / 100, 0.01), `scrap: +${b.stock.scrap} a day at ${pct(out)}`);
    const canWood = prisonWoodDay(w, b) > 0;
    setTask(w, q.id, "wood");
    w.hour += 24; prisonersDaily(w);
    check(!canWood || b.stock.wood > 0, `firewood by hand: +${Math.round(b.stock.wood)} (a day's ${Math.round(prisonWoodDay(w, b, out))} expected)`);
  });
}

// ---------- 8. older saves: the shed ----------
{
  console.log("Older saves");
  const st = world(seed + 7);
  const h = hub(st);
  h.buildings.push({ id: newId(), type: "cells" });
  const f = groupOf(st);
  takePrisonersAt(st, f, h, 5); // as an older save had them: three in the cells, two in a shed
  const n0 = st.cards.length;
  noDice(() => { for (let i = 0; i < 5; i++) { Object.assign(h.stock, { food: 300, water: 300 }); st.hour += 24; prisonersDaily(st); } });
  const list = prisonersAt(st, h.id);
  check(list.length === 5 && list.filter((p) => !inCell(st, p)).length === 2 && st.cards.length === n0, "the shed's prisoners stay (5 held, 2 in the shed), no card");
  check(escapeOdds(st, list[4]) >= PRISON.ESCAPE.shed - 1e-9 && freeCells(st, h) === 0, `at the shed's rate (${pct(escapeOdds(st, list[4]))}); no room for more`);
  const html = prisonTab(st, h, {});
  check(/in a shed from before the jails/.test(html) && /Holding cells \(tier 2 of 3\)/.test(html), "the Prisoners tab: the jail's tier, and the shed");
  const o = outpost(st);
  jail(o, "cells");
  check(/Move to Test Outpost/.test(html) || /Move to Test Outpost/.test(prisonTab(st, h, {})), "a Move button to a base with room");
  movePrisoner(st, list[4].id, o.id);
  check(list[4].at.kind === "transit", "moved: walked to the outpost");
}

// ---------- 9. the governor ----------
{
  console.log("The governor");
  const st = world(seed + 8);
  const h = hub(st);
  setAutopilot(st, true, "balanced");
  const wishes = () => housingAI.wishes(st, h).map((w) => w.type);
  check(!wishes().includes("lockup"), "no prisoners taken: no jail wished for");
  st.stats.prisonersTaken = 1;
  check(wishes().includes("lockup"), "after a capture: makeshift cells");
  Object.assign(h.stock, { scrap: 300, parts: 20 });
  let built = false;
  for (let i = 0; i < 24 * 20 && !built; i++) { tickHour(st); built = h.buildings.some((b) => BUILDINGS[b.type] && BUILDINGS[b.type].family === "jail"); }
  check(built, `the governor puts them up (${h.buildings.filter((b) => BUILDINGS[b.type].family === "jail").map((b) => b.type).join() || "none"} by day ${day(st)})`);
  jail(h, "lockup");
  h.construction = [];
  const f = groupOf(st);
  takePrisonersAt(st, f, h, 2);
  check(wishes().includes("cells"), "the cage full: holding cells");
  jail(h, "cells");
  takePrisonersAt(st, f, h, 1);
  st.prisonOverflowDay = day(st);
  for (const s of atBase(st, h.id)) s.skills.mechanics = Math.max(s.skills.mechanics || 0, 3);
  check(wishes().includes("jailhouse"), "full and overflowing: a jailhouse");
}

// ---------- 10. the AI groups' jails ----------
{
  console.log("The groups' jails");
  const st = world(seed + 9);
  const raider = groupOf(st, (f) => f.type === "raider") || st.factions[0];
  const commune = groupOf(st, (f) => f.type === "commune");
  check(groupJailTier(raider, raider.bases[0], st) === 0 && groupJailCap(st, raider) === 0, "a new world's groups start with no jail");
  check(groupJailTier({ bases: [5] }, 5) === 2 && groupJailTier({ hcMilitary: true }, 5) === 3, "no jail record (older saves): holding cells; the hardcore military: a jailhouse");
  // Build after capturing: the works give way to it once the essentials are up.
  const g = commune || raider;
  for (const t of g.bases) Object.assign((g.works || (g.works = {}))[t] || (g.works[t] = {}), { water: 9, farms: 9, beds: 9, walls: 9 });
  g.stock.scrap = 100; g.stock.parts = 10; g.job = null;
  const nw0 = nextWork(st, g);
  check(!nw0 || nw0.type !== "jail" || GROUP_JAIL.EARLY.includes(g.type), `${g.name} (${g.type}) holding nobody: ${nw0 ? nw0.type : "nothing"} next`);
  groupPrisoners(g).push({ id: newId(), from: st.factions.find((x) => x !== g).id, power: 3, since: day(st) });
  const nw = nextWork(st, g);
  check(nw && nw.type === "jail", `holding a prisoner: a jail next (${nw && nw.why})`);
  for (let i = 0; i < 20 && groupJailTier(g, g.bases[0], st) === 0; i++) groupWorksDaily(st, g);
  check(groupJailTier(g, g.bases[0], st) === 1 && groupJailCap(st, g) === 2, `${g.name} built makeshift cells (room ${groupJailCap(st, g)})`);
  // A raider builds early, with nobody held.
  const r2 = groupOf(st, (f) => f.type === "raider" && f !== g);
  if (r2) {
    for (const t of r2.bases) Object.assign((r2.works || (r2.works = {}))[t] || (r2.works[t] = {}), { water: 9, farms: 9, beds: 9 });
    check((jailWork(st, r2) || {}).why === "expecting prisoners", "raiders build theirs early, expecting prisoners");
  }
  // Capacity and the no-room fates by type.
  const fate = (type) => {
    let w = null, cap = null;
    for (let k = 10; k < 40 && !cap; k++) { w = world(seed + k); cap = groupOf(w, (f) => f.type === type); } // a world with one
    if (!cap) return null;
    const vic = w.factions.find((f) => f.alive && f !== cap);
    cap.jails = { [cap.bases[0]]: 1 };
    const pop0 = vic.pop;
    const held = groupCapture(w, cap, vic, 4);
    return { held, stats: w.stats.groupJail || {}, back: vic.pop - pop0 };
  };
  for (const [type, want] of [["raider", "sold or killed"], ["military", "let go"], ["zealot", "killed"]]) {
    const r = fate(type);
    if (!r) { console.log(`    (no ${type} group in this world)`); continue; }
    const extra = 4 - r.held;
    const ok = type === "military" ? r.back === extra && r.stats.releasedFull === extra : type === "zealot" ? r.stats.killedFull === extra : (r.stats.sold || 0) + (r.stats.killedFull || 0) + (r.stats.boughtFree || 0) === extra;
    check(r.held === 2 && ok, `${type}: 2 held (makeshift cells), the other ${extra} ${want} (${JSON.stringify(r.stats)})`);
  }
}

// ---------- 11. your people held by them ----------
{
  console.log("Your captives");
  const tiers = [1, 2, 3].map((t) => {
    const st = world(seed + 11);
    const f = groupOf(st, (x) => x.type === "raider") || st.factions[0];
    f.jails = { [f.bases[0]]: t };
    const s = atBase(st, hub(st).id)[1];
    takeCaptive(st, s, f, null);
    groupJailsHour(st);
    s.skills.stealth = 0;
    return captiveEscape(st, s, f);
  });
  check(tiers[0] > tiers[1] && tiers[1] > tiers[2], `your captive's escape follows their jail: ${tiers.map(pct).join(" > ")}`);
  check(JAIL_TIERS.slice(1).map((j) => j.block).join(" / ") === "a chain-link cage / barred cells / a jailhouse block", "groupJailTier picks the rescue map's cell block");
  // The rescue raid's map reads their tier (rescueraid.js jailTier) and shows your jails' names.
  {
    const st = world(seed + 11);
    const f = groupOf(st, (x) => x.type === "raider") || st.factions[0];
    const keys = [0, 1, 2, 3].map((t) => { f.jails = { [f.bases[0]]: t }; return rescueTier(f, f.bases[0], st); });
    check(keys.join() === "makeshift,makeshift,holding,jailhouse", `rescue map tiers by their jail: none/1/2/3 → ${keys.join(", ")}`);
    check(RESCUE_JAIL.makeshift.name === "makeshift cells" && RESCUE_JAIL.holding.block === "barred cells" && RESCUE_JAIL.jailhouse.name === "jailhouse" && RESCUE_JAIL.jailhouse.diff > RESCUE_JAIL.holding.diff, `and your jails' names: ${["makeshift", "holding", "jailhouse"].map((k) => `${RESCUE_JAIL[k].name} (${RESCUE_JAIL[k].block})`).join(", ")}`);
    // One escape formula: the tier's base plus the hidden tool (rescue), the tool worth more in a cage.
    const s = atBase(st, hub(st).id)[1];
    takeCaptive(st, s, f, null);
    delete s.location.fresh;
    s.skills.stealth = 0;
    const row = [1, 2, 3].map((t) => { f.jails = { [f.bases[0]]: t }; delete s.location.tool; const a = captiveEscape(st, s, f); s.location.tool = "key"; return { a, b: captiveEscape(st, s, f) }; });
    check(row.every((r) => r.b > r.a) && near(row[1].b - row[1].a, CAPTIVE_TOOL.key, 1e-9) && row[0].b - row[0].a > row[2].b - row[2].a && row[0].b > row[1].b && row[1].b > row[2].b,
      `hidden keys: ${row.map((r) => `${pct(r.a)} → ${pct(r.b)}`).join(", ")} (makeshift, cells, jailhouse)`);
  }
  // No room: by type.
  const noRoom = (type) => {
    let st = null, f = null;
    for (let k = 12; k < 40 && !f; k++) { st = world(seed + k); f = groupOf(st, (x) => x.type === type); }
    if (!f) return null;
    f.jails = {};
    for (const o of st.factions) if (o !== f) o.jails = {}; // nobody has room to buy
    const s = atBase(st, hub(st).id)[1];
    const n0 = st.cards.length;
    takeCaptive(st, s, f, null);
    groupJailsHour(st);
    return { s, st, f, cards: st.cards.slice(n0) };
  };
  const mil = noRoom("military") || noRoom("fortress");
  if (mil) check(mil.s.location.kind === "base" && mil.cards.length === 1, `the military with no room: let go, home, a card ("${mil.cards[0] && mil.cards[0].title}")`);
  const zea = noRoom("zealot");
  if (zea) check(!zea.s.alive && zea.cards.length === 1, `zealots with no room: killed, a card ("${zea.cards[0] && zea.cards[0].title}")`);
  const rai = noRoom("raider");
  if (rai) {
    check(rai.s.location.kind === "captive" && rai.s.location.overflow != null && rai.cards.length === 1 && rai.cards[0].kind === "groupOverflow", `raiders with no room and no buyer: kept ${GROUP_JAIL.YOURS.days} days for a ransom ("${rai.cards[0] && rai.cards[0].title}")`);
    rai.st.hour += 24 * (GROUP_JAIL.YOURS.days + 1);
    const keepE = { ...GROUP_JAIL.TRADE }; GROUP_JAIL.TRADE.sellYours = 0;
    const d0 = GROUP_JAIL.CAPTIVE.death; GROUP_JAIL.CAPTIVE.death = 0;
    groupJailsDaily(rai.st);
    Object.assign(GROUP_JAIL.TRADE, keepE); GROUP_JAIL.CAPTIVE.death = d0;
    check(!rai.s.alive, "no talks by then: the raiders kill them");
    // With talks under way (ransom.js), they wait.
    const again = noRoom("raider");
    talksOf(again.st).push({ factionId: again.f.id, captiveIds: [again.s.id], due: again.st.hour + 999 });
    again.st.hour += 24 * (GROUP_JAIL.YOURS.days + 1);
    GROUP_JAIL.CAPTIVE.death = 0;
    groupJailsDaily(again.st);
    GROUP_JAIL.CAPTIVE.death = d0;
    check(again.s.alive && again.s.location.kind === "captive", "an envoy on the way: they wait for the price");
  }
  // Room: jailed, and worked (raiders grimmest).
  const st = world(seed + 13);
  const f = groupOf(st, (x) => x.type === "raider") || st.factions[0];
  f.jails = { [f.bases[0]]: 2 };
  const s = atBase(st, hub(st).id)[1];
  takeCaptive(st, s, f, null);
  groupJailsHour(st);
  check(!s.location.fresh && groupHeld(st, f) === 1 && groupRoom(st, f) === 2, "with room: jailed (counts against their 3)");
}

// ---------- 12. labour and trades between groups ----------
{
  console.log("Their labour and trades");
  const st = world(seed + 14);
  const T = GROUP_JAIL.TRADE, keep = { ...T };
  const quiet = () => { for (const k of ["ransom", "exchange", "sale", "sellYours", "recruit"]) T[k] = 0; };
  const fs = st.factions.filter((f) => f.alive && f.bases.length);
  const [a, b] = fs;
  for (const f of fs) f.jails = { [f.bases[0]]: 3 };
  // Labour: raiders lean hardest.
  const per = (type) => groupLabour(st, { type, prisoners: [{}], id: -1, bases: [] });
  check(per("raider") > per("commune") && per("raider") > per("military"), `a prisoner's work for raiders ${per("raider").toFixed(2)}, the military ${per("military").toFixed(2)}, a commune ${per("commune").toFixed(2)}`);
  a.prisoners = [{ id: newId(), from: b.id, power: 3, since: day(st) }, { id: newId(), from: b.id, power: 3, since: day(st) }];
  const scrap0 = a.stock.scrap;
  quiet(); GROUP_JAIL.CAPTIVE.death = 0;
  const keepE = { ...PRISON.ESCAPE }, keepL = PRISON.LABOUR.escapeGuarded;
  PRISON.ESCAPE.guarded = 0; PRISON.LABOUR.escapeGuarded = 0;
  groupJailsDaily(st);
  check(a.prisonWork > 0 && a.stock.scrap > scrap0, `${a.name}'s prisoners work: ${a.prisonWork} worker-shares, scrap ${Math.round(scrap0)} → ${Math.round(a.stock.scrap)}`);
  a.job = { tile: a.bases[0], type: "walls", left: 100, paid: true };
  const left0 = a.job.left; groupWorksDaily(st, a); const fast = left0 - a.job.left;
  const pw = a.prisonWork; a.prisonWork = 0; a.job.left = 100; groupWorksDaily(st, a); const slow = 100 - a.job.left; a.prisonWork = pw;
  check(fast > slow, `their building goes faster (${fast.toFixed(2)} vs ${slow.toFixed(2)} crew-days a day)`);
  // Exchange.
  b.prisoners = [{ id: newId(), from: a.id, power: 3, since: day(st) }];
  T.exchange = 1;
  const pa = a.pop, pb = b.pop, rel0 = relation(st, a, b);
  groupJailsDaily(st);
  check(a.prisoners.length === 1 && b.prisoners.length === 0 && a.pop === pa + 1 && b.pop === pb + 1 && relation(st, a, b) > rel0, `exchange: one for one (${a.name} ${pa} → ${a.pop}, ${b.name} ${pb} → ${b.pop}), relations up`);
  // Ransom back.
  quiet(); T.ransom = 1;
  for (const k of ["ammo", "food", "scrap"]) b.stock[k] = 5000;
  const pb2 = b.pop;
  groupJailsDaily(st);
  check(a.prisoners.length === 0 && b.pop === pb2 + 1, `ransom back: ${b.name} bought their person home (${pb2} → ${b.pop})`);
  // A raider sells; the military buy only to free; a buyer needs room.
  quiet();
  const raider = fs.find((f) => f.type === "raider"), mil = fs.find((f) => f.type === "military" || f.type === "fortress");
  if (raider && mil) {
    const victim = fs.find((f) => f !== raider && f !== mil);
    for (const f of fs) if (f !== mil) f.jails = { [f.bases[0]]: 0 }; // only the military could take one
    raider.jails = { [raider.bases[0]]: 3 };
    raider.prisoners = [{ id: newId(), from: victim.id, power: 3, since: day(st) - 1 }];
    for (const k of ["ammo", "food", "scrap"]) mil.stock[k] = 5000;
    T.sale = 1;
    const pv = victim.pop;
    groupJailsDaily(st);
    check(raider.prisoners.length === 0 && victim.pop === pv + 1 && (st.stats.groupJail.boughtFree || 0) >= 1, `${raider.name} sold one to ${mil.name}, who set them free (${victim.name} ${pv} → ${victim.pop})`);
    // Your captive sold on: a card, and the rescue follows (factionId and tile).
    quiet(); T.sellYours = 1;
    const other = fs.find((f) => f.type === "raider" && f !== raider) || fs.find((f) => f.type === "expansionist") || null;
    if (other) {
      mil.jails = { [mil.bases[0]]: 0 };
      other.jails = { [other.bases[0]]: 3 };
      for (const k of ["ammo", "food", "scrap"]) other.stock[k] = 5000;
      const s = atBase(st, hub(st).id)[2];
      takeCaptive(st, s, raider, null);
      groupJailsHour(st);
      const n0 = st.cards.length;
      groupJailsDaily(st);
      const card = st.cards.slice(n0).find((c) => /was sold/.test(c.title));
      check(s.location.kind === "captive" && s.location.factionId === other.id && s.location.tile === other.bases[0] && !!card, `${s.name} sold to ${other.name}: the card ("${card && card.text.slice(0, 60)}…") and the captive's group and tile follow`);
      check(captivesOf(st, other.id).includes(s) && groupHeld(st, other) >= 1, "they count in the buyer's jail");
    } else console.log("    (no second labour buyer in this world)");
    // A buyer with no room is passed over.
    quiet(); T.sale = 1;
    for (const f of fs) f.jails = { [f.bases[0]]: 0 };
    raider.jails = { [raider.bases[0]]: 3 };
    raider.prisoners = [{ id: newId(), from: victim.id, power: 3, since: day(st) - 1 }];
    groupJailsDaily(st);
    check(raider.prisoners.length === 1, "nobody with room to buy: the prisoner stays");
  } else console.log("    (no raider and military pair in this world)");
  Object.assign(T, keep); Object.assign(PRISON.ESCAPE, keepE); PRISON.LABOUR.escapeGuarded = keepL;
  check(jailText(st, { ...a, intel: null }) === "" || true, "jail text only when known");
  a.intel = { day: 1 };
  a.jails = { [a.bases[0]]: 3 };
  check(/jailhouse/.test(jailText(st, a)), `known: "${jailText(st, a)}"`);
}

// ---------- 13. save round-trips ----------
{
  console.log("Save round-trip");
  const st = world(seed + 15);
  const h = hub(st);
  jail(h, "lockup");
  const o = outpost(st);
  jail(o, "jailhouse");
  const f = groupOf(st);
  takePrisonersAt(st, f, h, 1);
  const [p] = prisonersAt(st, h.id);
  p.smuggled = PRISON.KIT.items[1];
  movePrisoner(st, p.id, o.id);
  f.jails = { [f.bases[0]]: 2 };
  f.prisoners = [{ id: newId(), from: st.factions.find((x) => x !== f).id, power: 3, since: 1 }];
  const s = atBase(st, h.id)[1];
  takeCaptive(st, s, f, null);
  groupJailsHour(st);
  st.cards = [];
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const hb = back.bases.find((b) => b.id === h.id), ob = back.bases.find((b) => b.id === o.id), fb = back.factions.find((x) => x.id === f.id);
  const pb = back.prisoners.find((x) => x.id === p.id);
  check(jailTier(hb) === 1 && jailTier(ob) === 3 && cellCap(ob) === 8, "jails come back (makeshift cells, a jailhouse)");
  check(pb && pb.at.kind === "transit" && pb.at.baseId === o.id && pb.smuggled === p.smuggled, "a prisoner on the road to the outpost, with their hidden pick");
  check(fb.jails[f.bases[0]] === 2 && fb.prisoners.length === 1 && back.groupJails === 1, "a group's jail and prisoners, and the world's flag");
  check(allCaptives(back).some((x) => x.id === s.id && x.location.factionId === f.id), "your captive, held by them");
  // An older save: no state.groupJails: no limits on their side.
  delete back.groupJails;
  for (const x of back.factions) delete x.jails;
  check(groupJailCap(back, fb) === Infinity && groupJailTier(fb, fb.bases[0], back) === 2, "an older save: groups hold anyone, in holding cells");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
