// "Why did this happen?" for setbacks (src/sim/causes.js noteSetback and its callers, ui/causes.js; the user's request
// 2026-10-25: "update 'Why did this happen?' so it explains more of what goes wrong in a run"): each new kind built
// headless with its kind, headline and factors, linked from its log line, the marker card and the run summary:
//   1. a vehicle left behind with nobody to drive it (walkers.js shedSurplusVehicles);
//   2. a team wiped out (parties.js wipeParty): the odds noted by noteFight, how far from home, what it was short of;
//   3. a vehicle lost to a group (groupworld.js vehicleDaily): the group named (or "a group you have not met"), how long
//      it had been left;
//   4. a mission that failed: a team home with nothing, an envoy turned away, a convoy gone (convoyrecover.js);
//   5. a survivor who walked out (morale.js desert): the mood factors;
//   6. the existing chains: a team with no medic, an unmanned watchtower;
//   7. the cap, the size, the play dice untouched by recording, an older save without state.setbacks.
// Usage: node tools/whytest.js [seed=7]
import { setFood } from "./foodkit.js";
import { createWorld, hub, makeSurvivor, atBase, hurt, day, log } from "../src/sim/world.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { planPath, launchExpedition, wipeIfEmpty, startReturn, giveOrder } from "../src/sim/parties.js";
import { createVehicle, setPartyVehicles } from "../src/sim/vehicles.js";
import { shedSurplusVehicles } from "../src/sim/walkers.js";
import { groupWorldDaily, VEH } from "../src/sim/groupworld.js";
import { desert } from "../src/sim/morale.js";
import { addBuilding } from "../src/sim/buildings.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { supWeight } from "../src/sim/data.js";
import * as C from "../src/sim/causes.js";
import * as E from "../src/sim/envoys.js";
import { lineWhy, whyModal, markerWhy, setbackList } from "../src/ui/causes.js";

const SEED = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const show = (x) => x && console.log(`    ${x.why.h}\n${x.why.f.map((f) => `      - ${f.t}`).join("\n")}`);

const free = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain" && !st.tiles[t].loc && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t);
function setup() {
  const st = createWorld({ seed: SEED, factionCount: 6 });
  Object.assign(st, { started: true, noNewGangs: true, noPlayerWars: true, noWars: true, noBlocs: true, noWanderers: true, noRoadblocks: true });
  const h = hub(st);
  Object.assign(h.stock, { water: 400, meds: 80, scrap: 200, fuel: 200, parts: 40 }); setFood(h, 600);
  for (let i = 0; i < 8; i++) makeSurvivor(st, h.id);
  const g = st.grid;
  const tile = g.within(h.tile, 5).find((t) => g.distance(t, h.tile) >= 3 && free(st, t) && planPath(st, h.tile, t, true));
  st.hordes.length = 0;
  st.cards.length = 0;
  return { st, h, tile };
}
function team(st, h, n, vs = []) {
  const crew = atBase(st, h.id).slice(0, n);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "move", stance: "normal", supplies: { food: 0, water: 0, ammo: 0, meds: 0 } });
  if (res.error) throw new Error(res.error);
  if (vs.length) setPartyVehicles(st, res.party, vs);
  return { p: res.party, crew };
}
const at = (p, tile) => { p.path = [tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; };
const rngOf = (st) => JSON.stringify(st.rng.state ?? st.rng);
const sane = (x, what) => {
  check(!!x && x.why.f.length <= C.MAX_FACTORS && x.why.f.every((f) => typeof f.t === "string" && f.t.length > 0 && f.t.length < 240), `${what}: at most ${C.MAX_FACTORS} short factors`);
  check(!!x && JSON.stringify(x).length < 1500, `${what}: a few hundred bytes (${x ? JSON.stringify(x).length : 0})`);
};
const linked = (st, x) => { const l = st.log.find((y) => x.m && y.text.startsWith(x.m)); return !!l && (lineWhy(st, l.text, l.kind, null, Math.floor(l.hour / 24) + 1) || {}).x === x.id; };

section("1. a vehicle left behind: who could not drive, where, what stayed in it");
{
  const { st, h, tile } = setup();
  const a = createVehicle(st, "truck", { kind: "base", baseId: h.id }, { fuel: 30, condition: 80 });
  const b = createVehicle(st, "van", { kind: "base", baseId: h.id }, { fuel: 30, condition: 20 });
  const { p, crew } = team(st, h, 2, [a, b]);
  at(p, tile);
  p.cargo.supplies = { scrap: Math.ceil(1600 / supWeight("scrap")) };
  hurt(st, crew[1], 9999, tile, "in a fight with raiders");
  st.cards.length = 0;
  shedSurplusVehicles(st, p, tile);
  const x = C.setbacksOf(st).find((y) => y.kind === "left");
  show(x);
  check(!!x && /left at .* nobody to drive/.test(x.why.h) && x.name.includes("Work van"), "kind left, the van named in the headline");
  check(!!x && x.why.f.some((f) => /Only one of the team/.test(f.t)) && x.why.f.some((f) => f.t.includes(crew[1].name.split(" ")[0]) && /died/.test(f.t)), "who could not drive and why (the driver who died)");
  check(!!x && x.why.f.some((f) => /Left inside: .*scrap/.test(f.t)), "what cargo stayed in it");
  sane(x, "left");
  check(!!x && linked(st, x), "the log line gets a Why? link");
  const mark = st.markers.find((m) => m.key === `vehicle:${b.id}`) || (p.spotted && p.spotted.get(`vehicle:${b.id}`));
  check(!!mark && /data-x="\d+"/.test(markerWhy(st, mark)), "the abandoned vehicle's marker card gets a Why? link");
  const html = whyModal(st, { why: { x: x.id } });
  check(/Why was .* left behind\?/.test(html) && /Vehicle left behind/.test(html), "the Why panel shows it with its kind");
}

section("2. a team wiped out: the fight's odds, how far from home, what it was short of");
{
  const { st, h, tile } = setup();
  const a = createVehicle(st, "truck", { kind: "base", baseId: h.id }, { fuel: 30, condition: 80 });
  const { p, crew } = team(st, h, 2, [a]);
  at(p, tile);
  C.noteFight(st, { partyId: p.id, enemy: { name: "raiders", count: 6 } }, { win: 0.22 }, 2);
  for (const s of crew) hurt(st, s, 9999, tile, "in a fight with raiders");
  st.cards.length = 0;
  wipeIfEmpty(st, p);
  const x = C.setbacksOf(st).find((y) => y.kind === "wiped");
  show(x);
  check(!!x && /whole team .* was lost near/.test(x.why.h), "kind wiped, the headline");
  check(!!x && x.why.f.some((f) => /22% odds/.test(f.t)), "the odds noted by noteFight");
  check(!!x && x.why.f.some((f) => /tiles? from/.test(f.t)), "how far from home");
  check(!!x && x.why.f.some((f) => /had no water, food, meds and ammo left|had no .* left/.test(f.t)) || x.why.f.length >= C.MAX_FACTORS, "what the team was short of");
  sane(x, "wiped");
  check(!!x && linked(st, x) && (x.v || []).includes(a.id), "linked from the log line and the vehicle's marker");
}

section("3. a vehicle lost to a group: who, how long it had been left");
{
  const { st, h, tile } = setup();
  const f = st.factions.find((y) => y.alive && !y.outsider);
  f.bases = [st.grid.within(tile, 2).find((t) => free(st, t) && t !== tile)];
  f.known = true;
  recomputeOwnership(st);
  const a = createVehicle(st, "truck", { kind: "abandoned", tile, since: st.hour - 72 }, { fuel: 30, condition: 80 });
  a.cargo = { supplies: { scrap: 20 }, gear: [] };
  const take0 = VEH.TAKE;
  VEH.TAKE = 1e9;
  for (let i = 0; i < 10 && st.vehicles.includes(a); i++) groupWorldDaily(st, f);
  const x = C.setbacksOf(st).find((y) => y.kind === "looted");
  show(x);
  check(!!x && x.why.h.startsWith(f.name) && x.f === f.id, `the group named: ${f.name}`);
  check(!!x && x.why.f.some((f2) => /left there 3 days/.test(f2.t)), "how long it had been left");
  check(!!x && x.why.f.some((f2) => /20 scrap/.test(f2.t)), "what was in it");
  sane(x, "looted");
  check(!!x && linked(st, x), "linked from the log line");
  // A group you have not met, in sight: not named.
  f.known = false;
  st.live.add(tile);
  const b = createVehicle(st, "van", { kind: "abandoned", tile, since: st.hour }, { fuel: 30, condition: 80 });
  for (let i = 0; i < 10 && st.vehicles.includes(b); i++) groupWorldDaily(st, f);
  VEH.TAKE = take0;
  const y = C.setbacksOf(st).find((z) => z.kind === "looted" && z.v.includes(b.id));
  check(!!y && /^A group you have not met/.test(y.why.h) && !y.why.h.includes(f.name), "an unknown group is not named");
}

section("4. a mission that failed: home with nothing, an envoy turned away, a convoy gone");
{
  const { st, h, tile } = setup();
  const { p } = team(st, h, 2);
  p.teamMission = "scavenge"; p.searched = true; p.dest = tile;
  st.tiles[tile].loot = 0.01;
  at(p, h.tile);
  startReturn(st, p);
  const x = C.setbacksOf(st).find((y) => y.kind === "failed");
  show(x);
  check(!!x && /came home from .* with nothing/.test(x.why.h) && x.why.f.some((f) => /picked over/.test(f.t)), "a team home with nothing: the site was picked over");
  check(!!x && linked(st, x), "linked from its \"is home\" line");
  // An envoy turned away.
  const f = st.factions.find((y) => y.alive && !y.outsider);
  Object.assign(f, { known: true, goodwill: 40 });
  const r = E.communicate(st, { fid: f.id, kind: "news", payload: {}, memberIds: atBase(st, h.id).slice(0, 1).map((s) => s.id) });
  if (r.party) {
    r.msg.answer = { yes: false, why: "they do not trust you", text: `${f.name} would not hear your news.` };
    E.envoyHome(st, r.party, h);
    const y = C.setbacksOf(st)[0];
    show(y);
    check(y.kind === "failed" && /envoy/.test(y.why.h) && y.why.f.some((g) => /do not trust you/.test(g.t)), "an envoy turned away: their reason");
  } else check(false, `the envoy went (${r.text})`);
  // A convoy gone before the team got there (convoyrecover.js).
  const v = createVehicle(st, "truck", { kind: "abandoned", tile, since: st.hour }, { fuel: 30, condition: 80 });
  st.markers.push({ key: `vehicle:${v.id}`, type: "vehicle", tile, hour: st.hour, label: "Pickup truck (its team was lost, cargo inside)", info: { vehicleId: v.id } });
  st.vehicles.splice(st.vehicles.indexOf(v), 1);
  const q = team(st, h, 2).p;
  at(q, tile);
  giveOrder(st, q, "convoy");
  const z = C.setbacksOf(st)[0];
  check(z.kind === "failed" && /convoy/.test(z.why.h), "a convoy recovery that found it gone");
}

section("5. a survivor who walked out: the mood behind it");
{
  const { st, h } = setup();
  const s = atBase(st, h.id).find((x) => !x.leader);
  s.mood = 8; s.moodWarn = 2; h.rationing = true; h.hungerDays = 3;
  desert(st, h, s);
  const x = C.setbacksOf(st).find((y) => y.kind === "gone");
  show(x);
  check(!!x && x.why.h.startsWith(s.name) && x.why.f.some((f) => /mood was 8/.test(f.t)) && x.why.f.some((f) => /short rations|out of food/.test(f.t)), "kind gone: the mood and what weighed on it");
  sane(x, "gone");
  check(!!x && linked(st, x), "linked from the log line");
  check(/Setbacks|Left the group/.test(setbackList(st)) && /data-x=/.test(setbackList(st)), "listed in the run summary with its Why?");
}

section("6. thin chains made fuller: no medic on the team, an unmanned watchtower");
{
  const { st, h, tile } = setup();
  const { p, crew } = team(st, h, 2);
  for (const s of crew) s.skills.medicine = 0;
  at(p, tile);
  hurt(st, crew[0], 9999, tile, "in a fight with raiders");
  const c = C.deathCause(st, crew[0]);
  check(!!c && c.factors.some((f) => /Nobody on the team knew medicine/.test(f.t)), `a team death: no medic (${c && c.factors.map((f) => f.t).join(" | ")})`);
  addBuilding(h, "watchtower");
  for (const s of atBase(st, h.id)) s.role = "scavenge";
  const victim = atBase(st, h.id)[0];
  log(st, `Raiders broke into ${h.name}.`, "danger");
  hurt(st, victim, 9999, h.tile, `defending ${h.name}`);
  const d = C.deathCause(st, victim);
  check(!!d && d.factors.some((f) => /watchtower .* was unmanned/.test(f.t)) || (d && d.factors.length >= C.MAX_FACTORS), `a raid death: the unmanned watchtower (${d && d.factors.map((f) => f.t).join(" | ")})`);
}

section("7. the cap, the play dice, an older save");
{
  const { st, h, tile } = setup();
  for (let i = 0; i < C.MAX_SETBACKS + 12; i++) C.noteMissionFailed(st, `test ${i}`, tile, `Test ${i}`, "because");
  check(C.setbacksOf(st).length === C.MAX_SETBACKS && C.setbacksOf(st)[0].name === `test ${C.MAX_SETBACKS + 11}`, `capped at ${C.MAX_SETBACKS}, newest first`);
  const r0 = rngOf(st);
  const a = createVehicle(st, "truck", { kind: "abandoned", tile, since: st.hour }, { fuel: 30, condition: 80 });
  const { p } = team(st, h, 1);
  C.noteVehiclesLeft(st, p, [a], tile);
  C.explainWipe(st, p, tile);
  C.noteVehicleLooted(st, st.factions[0], a, "took", C.lootedBefore(st, a));
  C.noteDesertion(st, h, atBase(st, h.id)[0]);
  check(rngOf(st) === r0, "recording never touches the play dice");
  delete st.setbacks; delete st.setbackSeq;
  st.cards.length = 0;
  const st2 = loadFromString(saveToString(st));
  check(C.setbacksOf(st2).length === 0 && lineWhy(st2, "Anything at all", "info", null, day(st2)) === null, "an older save without setbacks loads, and nothing breaks");
  C.noteMissionFailed(st2, "after", tile, "After", "x");
  check(C.setbacksOf(st2).length === 1, "and records from then on");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
