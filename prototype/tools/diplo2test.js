// Blocs and wars with you (src/sim/blocs.js, playerwars.js): a bloc forms between compatible types with a shared
// threat (and never across the type lines), breaks after a betrayal (a theft found out), a falling-out or when the
// danger has passed; members help a raided member, march with each other's raids, go to war together and share what
// they know; a group declares war on you with a goal from its history (revenge for your raids, loot from a spy's report
// of rich stores, an outpost near its land, conversion for zealots), raids and besieges you, sues for peace or demands
// its terms; terms accepted or refused by type; you declare war (the group's bloc joins it); weariness ends a war in a
// ceasefire that holds the raids off; the war and the blocs survive a save; the Groups tab and Affairs render them.
// --pressure [days] [seeds...]: the autopilot on each seed with and without blocs and wars on you (child processes, 3 at
// a time): days survived, people, bases, raids on you, wars declared on you (and how they ended), blocs formed.
// Usage: node tools/diplo2test.js [seed] | node tools/diplo2test.js --pressure [240] [1 2 3 4 5]
import { createWorld, tickHour, hub, day, alive, factionById } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import { recomputeOwnership, resolveRaidOnFaction, changeGoodwill, attitude, strength } from "../src/sim/factions.js";
import { spawnAiParty, planPath } from "../src/sim/parties.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { learnBase, knowsOf, stealFromGroup } from "../src/sim/groupworld.js";
import { GROUP_PRIORITIES, weightOf } from "../src/sim/groupcare.js";
import { factionVehicles } from "../src/sim/vehicles.js";
import * as D from "../src/sim/diplomacy.js";
import * as B from "../src/sim/blocs.js";
import * as W from "../src/sim/playerwars.js";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const PRESSURE = process.argv[2] === "--pressure";
const ONE = process.argv[2] === "--one"; // child: one autopilot run → JSON
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);

// ---------- the pressure runs ----------
function oneRun(seed, days, off) {
  const st = createWorld({ seed, factionCount: 8 });
  st.started = true;
  setAutopilot(st, true, "balanced");
  if (off) { st.noBlocs = true; st.noPlayerWars = true; }
  while (day(st) < days && alive(st).length && !st.gameOver) tickHour(st);
  const d = st.diplo || {};
  const type = (id) => (st.factions.find((f) => f.id === id) || {}).type;
  return {
    seed, off, day: day(st), alive: alive(st).length, hub: !!hub(st), bases: st.bases.length, raids: (st.era && st.era.raids) || 0,
    declared: d.pwarStats ? d.pwarStats.declared : 0, wars: (d.pwarEnded || []).map((e) => `${type(e.fid)}:${e.goal}:${e.start}-${e.end}:${e.how}:${e.raids}r`).concat((d.pwars || []).map((w) => `${type(w.fid)}:${w.goal}:${w.start}-:on:${w.raids}r`)),
    blocs: d.blocStats ? d.blocStats.formed : 0, betrayals: d.blocStats ? d.blocStats.betrayals : 0, helps: d.blocStats ? d.blocStats.helps : 0, joint: d.blocStats ? d.blocStats.joint : 0,
  };
}
if (ONE) {
  process.stdout.write(JSON.stringify(oneRun(Number(process.argv[3]), Number(process.argv[4]), process.argv[5] === "off")));
  process.exit(0);
}
if (PRESSURE) {
  const days = Number(process.argv[3] || 240);
  const seeds = process.argv.length > 4 ? process.argv.slice(4).map(Number) : [1, 2, 3, 4, 5];
  const self = fileURLToPath(import.meta.url);
  const jobs = seeds.flatMap((s) => [[s, "on"], [s, "off"]]);
  const out = [];
  let next = 0;
  await new Promise((done) => {
    let running = 0;
    const go = () => {
      if (next >= jobs.length && !running) return done();
      while (running < 3 && next < jobs.length) {
        const [s, mode] = jobs[next++];
        running++;
        execFile(process.execPath, [self, "--one", String(s), String(days), mode], { maxBuffer: 1 << 24 }, (err, stdout) => {
          running--;
          try { out.push(JSON.parse(stdout)); } catch { out.push({ seed: s, off: mode === "off", error: String(err || stdout).slice(0, 300) }); }
          go();
        });
      }
    };
    go();
  });
  out.sort((a, b) => a.seed - b.seed || Number(a.off) - Number(b.off));
  console.log(`Pressure: ${days} days, the Balanced autopilot, seeds ${seeds.join(" ")} (a game year is 112 days)`);
  for (const r of out) console.log(r.error ? `seed ${r.seed} ${r.off ? "off" : "on "}: ERROR ${r.error}` : `seed ${r.seed} ${r.off ? "off" : "on "}: day ${r.day} hub ${r.hub ? "yes" : "NO"} · ${r.alive} people · ${r.bases} bases · ${r.raids} raids on you${r.off ? "" : ` · wars on you ${r.declared}: ${r.wars.join(", ") || "none"} · blocs ${r.blocs} (betrayals ${r.betrayals}, helps ${r.helps}, joint raids ${r.joint})`}`);
  const sum = (off, k) => out.filter((r) => !r.error && r.off === off).reduce((a, r) => a + (typeof r[k] === "boolean" ? Number(r[k]) : r[k]), 0);
  const n = seeds.length;
  const years = (n * days) / 112;
  console.log(`On:  hubs ${sum(false, "hub")}/${n}, people ${sum(false, "alive")}, bases ${sum(false, "bases")}, raids on you ${sum(false, "raids")}, wars declared on you ${sum(false, "declared")} (${(sum(false, "declared") / years).toFixed(2)} a game year), blocs ${sum(false, "blocs")}`);
  console.log(`Off: hubs ${sum(true, "hub")}/${n}, people ${sum(true, "alive")}, bases ${sum(true, "bases")}, raids on you ${sum(true, "raids")}`);
  process.exit(0);
}

// ---------- the unit tests ----------
const seed = Number(process.argv[2] || 7);
const land = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain";
const free = (st, t) => land(st, t) && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t);
// A world with a radio at the hub, every group known, and three to five groups of the types asked for, their bases
// moved to free tiles 6–12 tiles from the hub and each other (the rest of the groups stay where they are, unknown).
function setup(types, s = seed) {
  const st = createWorld({ seed: s, factionCount: 8 });
  st.started = true;
  const h = hub(st);
  addBuilding(h, "radio");
  h.radio = true;
  Object.assign(h.stock, { food: 600, water: 200, meds: 80, ammo: 600, scrap: 200, fuel: 60, parts: 10 });
  const g = st.grid;
  const spots = g.within(h.tile, 12).filter((t) => g.distance(t, h.tile) >= 6 && free(st, t) && planPath(st, t, h.tile, false));
  const used = [];
  const fs = [];
  for (const type of types) {
    const f = st.factions.find((x) => x.alive && !fs.includes(x));
    const t = spots.find((x) => used.every((u) => g.distance(u, x) >= 3));
    used.push(t);
    f.type = type;
    f.bases = [t];
    f.known = true;
    f.pop = 24;
    f.pact = null;
    f.goodwill = 0;
    f.stock.food = 400;
    fs.push(f);
  }
  for (const f of st.factions) if (!fs.includes(f)) { f.alive = false; f.bases = []; } // a quiet world: only the groups under test
  recomputeOwnership(st);
  for (const f of fs) { f.knows = null; knowsOf(st, f); }
  D.ensureDiplo(st);
  B.ensureBlocs(st);
  W.ensurePwars(st);
  st.cards.length = 0;
  return { st, fs };
}
const nextDay = (st) => { st.hour += 24; };
const setRel = (st, a, b, r) => D.changeRelation(st, a, b, r - D.relation(st, a, b));
// Run the blocs' day until cond() holds (at most n days).
function untilDays(st, n, cond, step = () => B.blocsDaily(st)) { for (let i = 0; i < n; i++) { if (cond()) return true; nextDay(st); step(); } return cond(); }

section("Blocs: the type lines");
{
  check(B.typesFit({ type: "commune" }, { type: "traders" }) === 1 && B.typesFit({ type: "fortress" }, { type: "commune" }) === 1, "communes, traders and fortresses ally readily");
  check(B.typesFit({ type: "military" }, { type: "fortress" }) === 1 && B.typesFit({ type: "military" }, { type: "raider" }) === 0, "the military allies with order-keeping types only");
  check(B.typesFit({ type: "raider" }, { type: "raider" }) > 0 && B.typesFit({ type: "raider" }, { type: "commune" }) === 0 && B.typesFit({ type: "raider" }, { type: "expansionist" }) === 0, "raiders only with raiders");
  check(B.typesFit({ type: "zealot" }, { type: "zealot" }) > 0 && B.typesFit({ type: "zealot" }, { type: "commune" }) === 0 && B.typesFit({ type: "zealot" }, { type: "military" }) === 0, "zealots only with their own kind");
  for (const t of Object.keys(GROUP_PRIORITIES)) check(["ally", "warlike", "peaceful"].every((k) => typeof GROUP_PRIORITIES[t][k] === "number"), `GROUP_PRIORITIES.${t} has ally, warlike and peaceful`);
  check(weightOf({ type: "commune" }, "ally") > weightOf({ type: "zealot" }, "ally") && weightOf({ type: "raider" }, "warlike") > weightOf({ type: "traders" }, "warlike") && weightOf({ type: "traders" }, "peaceful") > weightOf({ type: "zealot" }, "peaceful"), "the type weights lean the right way");
}

section("Blocs: forming with a shared threat, breaking after a betrayal");
{
  const { st, fs } = setup(["traders", "commune", "raider"]);
  const [a, b, c] = fs;
  setRel(st, a, b, 40);
  setRel(st, a, c, -60); setRel(st, b, c, -60);
  learnBase(st, a, c.bases[0]); learnBase(st, b, c.bases[0]);
  const t = B.sharedThreat(st, a, b);
  check(t && t.kind === "group" && t.id === c.id, `a raider gang both hate and know is their shared threat (${JSON.stringify(t)})`);
  const formed = untilDays(st, 200, () => !!B.blocOf(st, a));
  check(formed && B.sameBloc(st, a, b), "traders and a commune form a bloc");
  const bloc = B.blocOf(st, a);
  check(bloc && bloc.foe && bloc.foe.id === c.id, "the bloc stands against the gang");
  check(!!bloc && /Concord|Accord/.test(bloc.name) && BLOC_COLOR(bloc), `it has a name and a colour (${bloc && bloc.name})`);
  check(D.raidWeight(st, a, b) === 0, "members never raid each other");
  // Shared intel: what one knows the other knows.
  const spot = st.grid.within(a.bases[0], 20).find((x) => free(st, x) && st.grid.distance(x, a.bases[0]) > 15);
  knowsOf(st, a).bases[spot] = { kind: "group", id: c.id, def: 33, day: day(st) };
  delete knowsOf(st, b).bases[spot];
  B.shareIntel(st, B.blocMembers(st, bloc));
  check(knowsOf(st, b).bases[spot] && knowsOf(st, b).bases[spot].def === 33, "members share what their scouts saw");
  // A theft found out between members is a betrayal: the thief is out, the bloc (of two) gone.
  factionVehicles(b).push({ id: "t1", type: "truck", name: "Truck", fuel: 5, condition: 70, owner: b.id });
  let betrayed = false;
  for (let i = 0; i < 40 && !betrayed; i++) {
    a.careTick = (a.careTick || 0) + 1;
    if (!factionVehicles(b).length) factionVehicles(b).push({ id: `t${i + 2}`, type: "truck", name: "Truck", fuel: 5, condition: 70, owner: b.id });
    const r0 = D.relation(st, a, b);
    stealFromGroup(st, a, b);
    if (D.relation(st, a, b) < r0) betrayed = true;
  }
  check(betrayed && !B.blocOf(st, a) && !B.blocOf(st, b), "a theft found out between members breaks the bloc");
  check(st.diplo.blocStats.betrayals >= 1 && D.relation(st, a, b) < 0, `the betrayal costs them dear (relations ${Math.round(D.relation(st, a, b))})`);
  check(st.diplo.blocLog.some((x) => /betrayed/.test(x.text)), "the betrayal is news");
}

section("Blocs: never across the type lines; a falling-out; the danger past");
{
  const { st, fs } = setup(["raider", "commune", "expansionist"]);
  const [r, cm, x] = fs;
  setRel(st, r, cm, 60);
  setRel(st, r, x, -60); setRel(st, cm, x, -60);
  learnBase(st, r, x.bases[0]); learnBase(st, cm, x.bases[0]);
  untilDays(st, 200, () => !!B.blocOf(st, r));
  check(!B.blocOf(st, r) && !B.blocOf(st, cm), "a raider gang and a commune never ally, however friendly");
}
{
  const { st, fs } = setup(["fortress", "commune", "raider"]);
  const [a, b, c] = fs;
  B.formBloc(st, [a, b], { kind: "group", id: c.id, why: "foe" });
  setRel(st, a, b, -30);
  nextDay(st); B.blocsDaily(st);
  check(!B.blocOf(st, a), "a falling-out ends a bloc of two");
  B.formBloc(st, [a, b], { kind: "group", id: c.id, why: "foe" });
  setRel(st, a, b, 50); setRel(st, a, c, 40); setRel(st, b, c, 40);
  if (st.hives) st.hives.length = 0; // no hive near them either
  const gone = untilDays(st, B.BLOC.IDLE + 3, () => !B.blocOf(st, a), () => { setRel(st, a, c, 40); setRel(st, b, c, 40); B.blocsDaily(st); });
  check(gone && st.diplo.blocEnded.some((e) => /danger past/.test(e.why)), `a bloc with no threat left drifts apart (${JSON.stringify(B.blocOf(st, a) && B.blocOf(st, a).foe)} ${JSON.stringify(st.diplo.blocEnded)})`);
}

section("Blocs: help for a raided member, joint raids, wars together");
{
  const { st, fs } = setup(["traders", "fortress", "raider"]);
  const [a, b, c] = fs;
  B.formBloc(st, [a, b], { kind: "group", id: c.id, why: "foe" });
  const help = B.blocHelpFor(st, a, a.bases[0], c);
  check(help.power > 0 && help.helpers.includes(b), `a raid on a member draws the other (help ${help.power.toFixed(1)} of ${strength(b).toFixed(1)})`);
  check(help.power <= strength(b) * B.BLOC.SPARE + 1e-9, "only what it can spare");
  const far = B.blocHelpFor(st, a, a.bases[0] + 0, a);
  check(far.helpers.every((m) => m !== a), "the member raided does not help itself");
  const h0 = st.diplo.blocStats.helps;
  const p = spawnAiParty(st, c, "raid", c.bases[0], a.bases[0], { strength: 10, target: { kind: "faction", factionId: a.id, tile: a.bases[0] } });
  resolveRaidOnFaction(st, p, []);
  check(st.diplo.blocStats.helps > h0, "the raid was fought with the bloc's help");
  // Joint raids: a member marches with a raid on the bloc's foe.
  const J0 = B.BLOC.JOINT;
  B.BLOC.JOINT = 10;
  b.type = "military"; // raid weight 0.4: it will march when the dice say so (forced here)
  const j = B.jointRaid(st, a, c.bases[0], { kind: "group", id: c.id });
  B.BLOC.JOINT = J0;
  b.type = "fortress";
  check(j && j.ids.includes(b.id) && j.power > 0, "a member marches with a raid on their foe");
  // Wars together: a war on a member brings the other in.
  const WJ = B.BLOC.WAR_JOIN;
  B.BLOC.WAR_JOIN = 10;
  D.startWar(st, c, a, "land");
  B.BLOC.WAR_JOIN = WJ;
  check(!!D.warBetween(st, b, c), "the bloc goes to war beside its member");
}

section("You and the blocs: an invitation, help at your walls, turning on them");
{
  const { st, fs } = setup(["traders", "commune", "raider"]);
  const [a, b, r] = fs;
  B.formBloc(st, [a, b], { kind: "group", id: r.id, why: "foe" });
  a.goodwill = 45; b.goodwill = 40; r.goodwill = -60;
  setRel(st, a, r, -60); setRel(st, b, r, -60);
  learnBase(st, a, r.bases[0]); learnBase(st, b, r.bases[0]);
  const I0 = B.BLOC.INVITE;
  B.BLOC.INVITE = 10;
  nextDay(st); B.blocsDaily(st);
  B.BLOC.INVITE = I0;
  const card = st.cards.find((c) => c.blocInvite != null);
  check(!!card, "a bloc against a gang that is hostile to you asks you to stand with it");
  const g0 = r.goodwill;
  card && card.choices[0].resolve(st);
  const bloc = B.blocOf(st, a);
  check(bloc && bloc.player && a.goodwill >= 50 && r.goodwill < g0, "standing with them: goodwill with the members, less with their foe");
  const help = B.blocPlayerHelp(st, hub(st), r, 20);
  check(help.power > 0 && help.names.length === 2, `their fighters would come to your hub (${help.power.toFixed(1)})`);
  check(W.declareProblem(st, a) !== "", "a bloc at your side does not declare war on you");
  changeGoodwill(st, a, -20, "you attacked their people");
  check(!bloc.player && b.goodwill <= 30, "striking at a member ends it, and the others think less of you");
}

section("A war declared on you: the goal from their history");
{
  const { st, fs } = setup(["raider", "zealot", "expansionist", "traders"]);
  const [r, z, x, tr] = fs;
  st.hour = 24 * (W.PW.FROM + 5);
  const h = hub(st);
  for (const f of fs) { learnBase(st, f, h.tile); knowsOf(st, f).bases[h.tile].def = 5; f.goodwill = -60; f.pop = 30; } // they think your hub weak
  tr.goodwill = 20;
  // Revenge: you raided them and executed one of theirs.
  changeGoodwill(st, r, -30, "you attacked their base");
  changeGoodwill(st, r, -20, "you executed one of their people");
  const gr = W.warGoalFor(st, r);
  check(gr.goal === "revenge" && (gr.cb === "raid" || gr.cb === "execution"), `raids and an execution: revenge (${gr.goal}, over ${gr.cb})`);
  check(W.declareProblem(st, r) === "" && W.declareChance(st, r) > 0, `a hostile gang that knows your hub may declare (${W.declareProblem(st, r) || "ok"})`);
  check(W.declareProblem(st, tr) !== "", "friendly traders do not");
  // Loot: their spies saw rich stores.
  h.stock.ammo = 5000; h.stock.food = 3000;
  learnBase(st, x, h.tile);
  const gx = W.warGoalFor(st, x);
  check(gx.goal === "loot" && gx.cb === "rich", `a spy's report of rich stores: loot (${gx.goal}, over ${gx.cb})`);
  // Conversion: zealots.
  check(W.warGoalFor(st, z).goal === "conversion", "zealots want to convert you");
  // Territory: an outpost of yours near their land.
  const g = st.grid;
  const t = g.within(x.bases[0], 5).find((q) => free(st, q) && g.distance(q, x.bases[0]) >= 3 && g.distance(q, h.tile) >= 3);
  const out = { id: 999001, name: "Test Outpost", type: "outpost", tile: t, buildings: [], stock: { food: 10 }, armory: [] };
  st.bases.push(out);
  learnBase(st, x, t);
  h.stock.ammo = 100; h.stock.food = 200; learnBase(st, x, h.tile);
  const gt = W.warGoalFor(st, x);
  check(gt.goal === "territory" && gt.target === t, `an outpost of yours by their land: territory (${gt.goal})`);
  st.bases.splice(st.bases.indexOf(out), 1);
  // The daily path declares (forced odds), one war at a time.
  const base0 = W.PW.BASE;
  W.PW.BASE = 50;
  W.pwarsDaily(st);
  W.PW.BASE = base0;
  const wars = st.diplo.pwars;
  check(wars.length === 1, `one war at a time (${wars.length})`);
  const w = wars[0];
  const f = factionById(st, w.fid);
  check(w && f && attitude(f) === "Hostile" && st.cards.some((c) => c.pwarId === w.id), "it is declared with a card, and they are hostile");
  check(W.atWarWithYou(st, f) && !W.atWarWithYou(st, tr), "atWarWithYou knows who");
  check(st.diplo.news.some((n) => /declared war on you/.test(n.text)), "the declaration is news");
  // War raids: one at a time, by what they know.
  st.cards.length = 0;
  const p = W.warRaidOnYou(st, w);
  check(p && p.pwarId === w.id && p.target.kind === "player", "a war raid sets out for your base");
  check(!W.warRaidOnYou(st, w), "only one war raid out at a time");
  check(W.pwarTeamMult(st, f) > 1 && W.pwarTeamRange(st, f) > 5, "their patrols hunt your teams");
  // A raid held counts for you and wears them down.
  const e0 = w.exh.them;
  W.pwarRaidDone(st, p, { outcome: "held" });
  check(w.score.you === 2 && w.exh.them > e0, "a raid you hold counts for you and wears them");
  // Weariness: their losses.
  const ex1 = w.exh.them;
  f.pop -= 6;
  W.pwarsDaily(st);
  check(w.exh.them > ex1 + 5, `their losses wear them down (${ex1.toFixed(1)} → ${w.exh.them.toFixed(1)})`);
}

section("Terms: taken or refused by type");
{
  const { st, fs } = setup(["commune", "zealot", "raider"]);
  const [cm, z, r] = fs;
  st.hour = 24 * (W.PW.FROM + 5);
  for (const f of fs) { learnBase(st, f, hub(st).tile); f.goodwill = -60; }
  const wc = W.declareOnPlayer(st, cm, "loot");
  const wz = W.declareOnPlayer(st, z, "conversion");
  const wr = W.declareOnPlayer(st, r, "loot");
  st.cards.length = 0;
  const tribute = (w) => W.termOptions(st, w).find((o) => o.key === "tribute");
  check(tribute(wc).chance > tribute(wr).chance && tribute(wr).chance > tribute(wz).chance, `the same tribute: a commune ${Math.round(tribute(wc).chance * 100)}%, raiders ${Math.round(tribute(wr).chance * 100)}%, zealots ${Math.round(tribute(wz).chance * 100)}%`);
  const conv = W.termOptions(st, wz).find((o) => o.key === "demand");
  check(conv && conv.terms.some((t) => t.kind === "convert") && conv.chance > tribute(wz).chance * 3, "zealots take only their faith");
  wc.exh.them = 80;
  check(tribute(wc).chance >= 0.9, "a worn-out commune all but jumps at it");
  // Offered: accepted (a worn-out commune), refused (zealots offered tribute).
  let ok = "";
  for (let i = 0; i < 6 && W.pwarById(st, wc.id); i++) { wc.lastTalk = -99; ok = W.offerTerms(st, wc.id, "tribute"); nextDay(st); }
  check(!W.pwarById(st, wc.id) && /accepted/.test(ok), `the commune accepts tribute (${ok.slice(0, 80)})`);
  check(W.ceasefireWith(st, cm) && cm.goodwill >= W.PW.PEACE_GW, "a ceasefire, and they are no longer hostile");
  check(tribute(wz).chance < 0.1, `zealots at war for the faith all but never take tribute (${Math.round(tribute(wz).chance * 100)}%)`);
  let said = "";
  for (let i = 0; i < 6 && !/refused/.test(said) && W.pwarById(st, wz.id); i++) { wz.lastTalk = -99; said = W.offerTerms(st, wz.id, "tribute"); nextDay(st); }
  check(/refused/.test(said) && W.pwarById(st, wz.id) && wz.lastTalk === day(st) - 1, `refused: the war goes on (${said.slice(0, 70)})`);
  wz.lastTalk = day(st);
  check(/will not hear/.test(W.offerTerms(st, wz.id, "ceasefire")), "one offer every few days");
  // Their own demand, from a card: the outpost they want is handed over.
  const g = st.grid, h = hub(st);
  const t = g.within(r.bases[0], 6).find((q) => free(st, q) && g.distance(q, r.bases[0]) >= 3 && g.distance(q, h.tile) >= 3);
  const out = { id: 999002, name: "Far Post", type: "outpost", tile: t, buildings: [], stock: { food: 10 }, armory: [], repairs: [], construction: [] };
  st.bases.push(out);
  wr.goal = "territory"; wr.target = t;
  const card = W.demandCard(st, wr);
  const yes = card.choices.find((c) => /Accept/.test(c.label));
  check(!(typeof yes.disabled === "function" && yes.disabled(st)), "their terms can be kept");
  yes.resolve(st);
  check(!st.bases.includes(out) && r.bases.includes(t) && !W.pwarById(st, wr.id), "accepting hands the outpost over and ends the war");
  check(!st.cards.some((c) => /has fallen/.test(c.title)), "a base handed over is no fall");
}

section("You declare war; weariness ends it");
{
  const { st, fs } = setup(["traders", "commune", "raider"]);
  const [tr, cm, r] = fs;
  st.hour = 24 * (W.PW.FROM + 5);
  B.formBloc(st, [tr, cm], { kind: "group", id: r.id, why: "foe" });
  tr.goodwill = 40; tr.pact = "trade"; cm.goodwill = 30;
  check(W.playerDeclareProblem(st, tr) === "", "you may declare war on a friendly group");
  const inf0 = st.conquest ? st.conquest.infamy : 0;
  const msg = W.declareByPlayer(st, tr, "tribute");
  const w = W.pwarOf(st, tr);
  check(w && w.by === "you" && attitude(tr) === "Hostile" && !tr.pact, `they turn hostile and the pact goes (${msg.slice(0, 60)})`);
  check(w.allies.includes(cm.id), "their bloc comes in on their side");
  check((st.conquest ? st.conquest.infamy : 0) > inf0, "infamy rises");
  check(/already at war/.test(W.playerDeclareProblem(st, tr)), "no second declaration");
  // Raids launched for their war on you (their goodwill held at hostile).
  cm.goodwill = 10;
  W.pwarsDaily(st);
  check(cm.goodwill <= W.PW.HOSTILE_GW, "their ally stays hostile while the war lasts");
  // Weariness: past BROKEN they pull back; the ceasefire holds raids off.
  w.exh.them = W.PW.BROKEN + 1;
  W.pwarsDaily(st);
  check(!W.pwarOf(st, tr) && !W.pwarOf(st, cm), "worn out, they pull back and the war is over");
  check(W.ceasefireWith(st, tr) && W.ceasefireWith(st, cm), "a ceasefire with them both");
  check(st.diplo.pwarEnded[0].how === "weary", "ended by weariness");
  check(/ceasefire/.test(W.declareProblem(st, tr)) || W.declareProblem(st, tr) !== "", "no new war from them while it holds");
}

section("The sue-for-peace card and the autopilot");
{
  const { st, fs } = setup(["expansionist", "raider"]);
  const [x] = fs;
  st.hour = 24 * (W.PW.FROM + 5);
  learnBase(st, x, hub(st).tile); x.goodwill = -60;
  const w = W.declareOnPlayer(st, x, "loot");
  const decl = st.cards.find((c) => c.pwarId === w.id);
  check(decl && decl.choices.some((c) => /Give them/.test(c.label)) && decl.choices.some((c) => /Brace/.test(c.label)), "the declaration card: brace, or give them what they want");
  st.cards.length = 0;
  w.exh.them = W.PW.TIRED + 5;
  w.start -= 20; w.lastOffer -= 20;
  W.pwarsDaily(st);
  const sue = st.cards.find((c) => c.pwarId === w.id);
  check(sue && /sues for peace|ceasefire/.test(sue.title), `worn out, they send word (${sue && sue.title})`);
  const acc = sue && sue.choices.find((c) => c.label === "Accept");
  check(acc && acc.ai(st) > 1, "the autopilot takes a peace offered");
  acc.resolve(st);
  check(!W.pwarById(st, w.id), "accepted: the war is over");
}

section("Save round-trip");
{
  const { st, fs } = setup(["traders", "commune", "raider"]);
  const [a, b, r] = fs;
  st.hour = 24 * (W.PW.FROM + 5);
  B.formBloc(st, [a, b], { kind: "group", id: r.id, why: "foe" });
  learnBase(st, r, hub(st).tile); r.goodwill = -60;
  changeGoodwill(st, r, -20, "you raided their base");
  const w = W.declareOnPlayer(st, r, "revenge");
  st.cards.length = 0;
  w.exh.them = 12.5; w.score.you = 4;
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const a2 = factionById(back, a.id), b2 = factionById(back, b.id), r2 = factionById(back, r.id);
  check(B.sameBloc(back, a2, b2) && B.blocOf(back, a2).name === B.blocOf(st, a).name, "the bloc survives a save");
  const w2 = W.pwarOf(back, r2);
  check(w2 && w2.goal === "revenge" && w2.exh.them === 12.5 && w2.score.you === 4, "the war survives a save");
  check((r2.griev || {}).raid > 0, "so do their grievances");
  W.pwarsDaily(back); B.blocsDaily(back);
  check(!!W.pwarOf(back, r2), "and runs on after it");
}

section("A bloc votes on your invitation: together, alone, or not at all");
{
  const AL = await import("../src/sim/alliance.js");
  const { ensureJobs } = await import("../src/sim/jobs.js");
  // Three friends in a bloc against a gang hostile to you; a qualifies (goodwill, a pact, a job done).
  const mk = () => {
    const { st, fs } = setup(["traders", "commune", "fortress", "raider"]);
    const [a, b, c, r] = fs;
    B.formBloc(st, [a, b], { kind: "group", id: r.id, why: "foe" });
    B.joinBloc(st, B.blocOf(st, a), c);
    for (const [x, y] of [[a, b], [a, c], [b, c]]) setRel(st, x, y, 45);
    for (const f of [a, b, c]) setRel(st, f, r, -60);
    r.goodwill = -60;
    a.goodwill = 65; a.pact = "trade";
    ensureJobs(st).list.push({ id: 9e9, fid: a.id, status: "done", type: "deliver", data: {} });
    return { st, a, b, c, r, bloc: B.blocOf(st, a) };
  };
  {
    const { st, a, b, c, bloc } = mk();
    b.goodwill = 45; c.goodwill = 40;
    check(AL.inviteProblem(st, a) === "", `a qualifies (${AL.inviteProblem(st, a)})`);
    const v = B.previewVote(st, bloc, a);
    check(v.votes.length === 3 && v.votes.every((x) => ["agree", "decline", "break"].includes(x.vote)), `each member votes (${B.voteText(st, v)})`);
    check(JSON.stringify(B.previewVote(st, bloc, a).votes.map((x) => x.score)) === JSON.stringify(v.votes.map((x) => x.score)), "the vote is a fixed score: the same on the same day");
    const msg = AL.inviteToAlliance(st, a);
    check(v.carries && [a, b, c].every((f) => AL.isMember(st, f)), `friendly members agree and the bloc joins together: ${msg}`);
    check(!B.blocOf(st, a) && st.diplo.blocEnded.some((e) => /joined/.test(e.why)) && [b, c].every((f) => f.pact), "the bloc is folded into the coalition; members without a pact sign one");
    check(/agreed/.test(msg) && st.log.some((l) => /voted on your invitation/.test(l.text || l.msg || String(l))), "the vote is in the log, each member's vote named");
    nextDay(st); AL.allianceDaily(st); B.blocsDaily(st);
    check([a, b, c].every((f) => AL.isMember(st, f)), "and they stay in the next day");
  }
  {
    // One member cool to you breaks off; two of three agree: they go in together, the third leaves the bloc.
    const { st, a, b, c, bloc } = mk();
    b.goodwill = 50; c.goodwill = 22;
    const v = B.previewVote(st, bloc, a);
    check(v.votes.find((x) => x.f === c).vote === "break", `a member with too little goodwill breaks off (${B.voteText(st, v)})`);
    AL.inviteToAlliance(st, a);
    check(AL.isMember(st, a) && AL.isMember(st, b) && !AL.isMember(st, c) && !B.blocOf(st, c), "the majority goes in; the one that broke off stays out of both");
  }
  {
    // A majority against: the invited group that agreed goes in alone and the bloc breaks; one that did not stays out.
    const { st, a, b, c, bloc } = mk();
    b.goodwill = 26; c.goodwill = 26; b.type = "fortress"; c.type = "fortress";
    const v = B.previewVote(st, bloc, a);
    check(!v.carries && v.votes.find((x) => x.f === a).vote === "agree", `most do not agree (${B.voteText(st, v)})`);
    const msg = AL.inviteToAlliance(st, a);
    check(AL.isMember(st, a) && !AL.isMember(st, b) && !B.blocOf(st, a) && B.sameBloc(st, b, c) && /alone/.test(msg), `the invited group joins alone and leaves the bloc: ${msg}`);
  }
  {
    // The bloc's foe sits in your coalition: even the invited group declines, and nobody moves.
    const { st, a, b, c, r, bloc } = mk();
    b.goodwill = 45; c.goodwill = 45;
    AL.ensureAlliance(st).members.push(r.id);
    const v = B.previewVote(st, bloc, a);
    check(v.votes.find((x) => x.f === a).vote !== "agree" && !v.carries, `with their foe in your coalition they will not come (${B.voteText(st, v)})`);
    const msg = AL.inviteToAlliance(st, a);
    check(!AL.isMember(st, a) && B.sameBloc(st, a, b) && B.sameBloc(st, a, c) && /stays out/.test(msg), `an invited group that did not agree stays out with its bloc: ${msg}`);
  }
  {
    // "Invite the whole bloc": through a member that qualifies; none qualifies: why.
    const { st, a, b, c, bloc } = mk();
    b.goodwill = 45; c.goodwill = 45;
    check(B.blocCarrier(st, bloc, AL.inviteProblem) === a, "the invitation goes through the member that meets your terms");
    a.pact = null;
    check(/No member of/.test(AL.inviteBloc(st, bloc.id)) && !AL.isMember(st, a), "nobody qualifies: the bloc is told why, nobody joins");
    a.pact = "trade";
    AL.inviteBloc(st, bloc.id);
    check([a, b, c].every((f) => AL.isMember(st, f)), "the whole bloc invited joins together");
    const ui = await import("../src/ui/diplomacy.js");
    const html = ui.diplomacyModal(st, { diplo: { tab: "coalition" } });
    check(/Calder Coalition/.test(html), "the coalition tab renders after it");
  }
  {
    const { st, a, bloc } = mk();
    const ui = await import("../src/ui/diplomacy.js");
    const card = ui.groupCardExtras(st, a);
    check(/al-invite-bloc/.test(card) && /If you asked today/.test(card), "a member's card offers Invite the whole bloc with today's vote");
    check(/al-invite-bloc/.test(ui.diplomacyModal(st, { diplo: { tab: "coalition" } })), "so does the coalition tab");
    check(bloc.members.length === 3, "previews change nothing");
  }
}

section("AI blocs merge by the same vote");
{
  const { st, fs } = setup(["traders", "commune", "fortress", "raider"]);
  const [a, b, c, r] = fs;
  const foe = { kind: "group", id: r.id, why: "foe" };
  const big = B.formBloc(st, [a, b], foe);
  // A second bloc of one more member: c with a group brought back to life as a commune.
  const d = st.factions.find((x) => !fs.includes(x));
  d.alive = true; d.type = "commune"; d.pop = 20; d.known = true;
  d.bases = [st.grid.within(c.bases[0], 4).find((t) => free(st, t))];
  recomputeOwnership(st);
  const small = B.formBloc(st, [c, d], foe);
  for (const x of [a, b]) for (const y of [c, d]) setRel(st, x, y, 50);
  setRel(st, a, b, 50); setRel(st, c, d, 50);
  for (const f of [a, b, c, d]) { setRel(st, f, r, -60); learnBase(st, f, r.bases[0]); }
  const v = B.previewVote(st, small, null, { kind: "bloc", bloc: big });
  check(v.votes.length === 2 && v.carries, `the smaller bloc votes on going over (${B.voteText(st, v)})`);
  const out = B.mergeVote(st, big, small);
  check(out.moved.length === 2 && big.members.length === 4 && !st.diplo.blocs.includes(small), "carried: its members go over, the bloc folds into the larger one");
  // Cold members break off.
  const s2 = setup(["traders", "commune", "fortress", "raider"]);
  const [a2, b2, c2, r2] = s2.fs;
  const f2 = { kind: "group", id: r2.id, why: "foe" };
  const big2 = B.formBloc(s2.st, [a2, b2], f2);
  const e = s2.st.factions.find((x) => !s2.fs.includes(x));
  e.alive = true; e.type = "commune"; e.pop = 20; e.bases = [s2.st.grid.within(c2.bases[0], 4).find((t) => free(s2.st, t))];
  recomputeOwnership(s2.st);
  const small2 = B.formBloc(s2.st, [c2, e], f2);
  for (const y of [c2, e]) { setRel(s2.st, a2, y, -10); setRel(s2.st, b2, y, -10); }
  const v2 = B.previewVote(s2.st, small2, null, { kind: "bloc", bloc: big2 });
  check(!v2.carries, `members cold to the larger bloc vote it down (${B.voteText(s2.st, v2)})`);
  B.mergeVote(s2.st, big2, small2);
  check(big2.members.length === 2 && s2.st.diplo.blocs.includes(small2), "nothing changes");
}

section("Groups tab and Affairs render");
{
  const { st, fs } = setup(["traders", "commune", "raider"]);
  const [a, b, r] = fs;
  st.hour = 24 * (W.PW.FROM + 5);
  B.formBloc(st, [a, b], { kind: "group", id: r.id, why: "foe" });
  learnBase(st, r, hub(st).tile); r.goodwill = -60;
  W.declareOnPlayer(st, r, "loot");
  st.cards.length = 0;
  const ui = await import("../src/ui/diplomacy.js");
  const head = ui.groupsDiploHeader(st);
  check(/Blocs and wars/.test(head) && /declared war on you/.test(head), "the Groups tab shows the blocs and wars");
  const card = ui.groupCardExtras(st, r);
  check(/At war with you/.test(card) && /pw-terms/.test(card), "their card shows the war and the terms to offer");
  const ca = ui.groupCardExtras(st, a);
  check(/🛡/.test(ca) && /pw-declare/.test(ca), "a member's card shows its bloc and Declare war");
  const modal = ui.diplomacyModal(st, { diplo: { tab: "affairs" } });
  check(/Wars with you/.test(modal) && /Blocs/.test(modal), "World affairs lists wars with you and blocs");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
function BLOC_COLOR(b) { return /^#[0-9a-f]{6}$/i.test(b.color); }
