// Saving and loading (src/sim/save.js, src/ui/saves.js, src/ui/settings.js).
// Usage: node tools/savetest.js [days] [seeds...]     (default 120 days, seeds 42 7 1234)
// - For each seed: the Balanced autopilot plays [days]; at half time the world is saved (through a JSON string) and
//   loaded again after another world has run in the same process (module state left behind, as in dettest); the
//   original and the loaded world both play to [days] and must end identical: the dettest digest (tools/digest.js)
//   and the whole saved state. One seed again in a fresh node process (the save handed over in a file).
// - Saved mid-way through a team's plan, with prisoners in the cells, with raid damage and repairs under way, mid-battle (a fight at the hub, a raid, a
//   break-in on the deploy step, a hive assault): load, play on, identical. An open card cannot be saved (the
//   reason names it); once answered it can.
// - Size at day 365: the save's JSON, gzip, and what browser storage holds; serialize and load times.
// - Storage (a stand-in localStorage): slots, the index, compression, a full storage, versions (newer and unknown
//   saves are refused with a reason), a damaged save.
// - The settings view rendered for every tab, before and during a game: no undefined / NaN / null, balanced tags,
//   and every data-action has a handler.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createWorld, tickHour, day, newId, hub, atBase, peekNextId, addCard } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { launchExpedition, partyTile, planPath } from "../src/sim/parties.js";
import { PRESETS } from "../src/sim/plans.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, registerCombatHandler, closeCombat } from "../src/sim/combat.js";
import { addBuilding } from "../src/sim/buildings.js";
import { newItem } from "../src/sim/inventory.js";
import { setHuntMix } from "../src/sim/hunting.js";
import { captiveRecords, capturePrisoners, prisonersAt } from "../src/sim/prisoners.js";
import { assaultHive } from "../src/sim/hives.js";
import { raidDamage, startAllRepairs } from "../src/sim/breakdowns.js";
import {
  serializeState, deserializeState, saveToString, loadFromString, saveBlocker, checkSave, SAVE_VERSION, SAVE_FORMAT, SaveError,
} from "../src/sim/save.js";
import * as Saves from "../src/ui/saves.js";
import { settingsModal, openSettings, SETTINGS_ACTIONS, SETTINGS_CHANGE } from "../src/ui/settings.js";
import { digest } from "./digest.js";

const child = process.argv[2] === "--continue"; // child mode: load the handed-over save, play on, print the digest hash
const args = child ? [] : process.argv.slice(2);
const days = Number(args[0] || 120);
const seeds = args.length > 1 ? args.slice(1).map(Number) : [42, 7, 1234];
const half = Math.floor(days / 2);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const hashOf = (s) => createHash("sha1").update(s).digest("hex");
const ID_STEP = 1e6;

// Every log line of a run (state.log keeps the last 200), as dettest does. The hook is an own property of the log
// list, which a save refuses (it is code), so it is taken off while saving.
function track(st, lines) {
  const unshift = Array.prototype.unshift;
  st.log.unshift = function (...x) { for (const l of x) lines.push(`${l.hour} ${l.text}`); return unshift.apply(this, x); };
}
const untracked = (st, fn) => { const f = st.log.unshift; delete st.log.unshift; try { return fn(); } finally { st.log.unshift = f; } };
const playTo = (st, d) => { while (day(st) <= d && !st.gameOver) tickHour(st); };
// The whole state as a save writes it (open cards left out: they are code), plus the cards' words and the next id.
// The chronicle's own timing (ms spent recording) is the one number that is not the world's.
function fullSnap(st) {
  if (st.chronicle) st.chronicle.ms = 0;
  const cards = (st.cards || []).map((c) => [c.title, c.text, (c.choices || []).map((x) => x.label)]);
  return JSON.stringify([peekNextId(), cards, serializeState(st, { dropCards: true }).state]);
}
function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at char ${i}: …${a.slice(Math.max(0, i - 100), i + 60)}… vs …${b.slice(Math.max(0, i - 100), i + 60)}…`;
}

// ---------- child: a fresh process loads the save and plays on ----------
if (child) {
  const h = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const st = loadFromString(h.save);
  const lines = h.lines.slice();
  track(st, lines);
  playTo(st, h.days);
  console.log(hashOf(digest({ st, lines, id0: h.id0, id1: h.id0 + ID_STEP })));
  process.exit(0);
}

const t0 = performance.now();
registerCombatHandler("savetest", () => {});

// ---------- 1. a long run, saved half way ----------
console.log(`Save on day ${half}, load, play both to day ${days} (Balanced autopilot)`);
let handed = null;
for (const seed of seeds) {
  let id0 = newId();
  while (id0 % ID_STEP) id0 = newId();
  const st = createWorld({ seed, factionCount: 8 });
  st.started = true;
  setAutopilot(st, true, "balanced");
  const lines = st.log.slice().reverse().map((l) => `${l.hour} ${l.text}`);
  track(st, lines);
  playTo(st, half);
  while (st.cards.length && !st.gameOver) tickHour(st); // a quiet hour: the autopilot answers cards as they come
  check(!saveBlocker(st), `seed ${seed}: nothing blocks the save on day ${day(st)}`);
  const ts = performance.now();
  const text = untracked(st, () => saveToString(st));
  const ms = performance.now() - ts;
  const linesAtSave = lines.slice();
  const savedHour = st.hour;
  // The original plays on.
  playTo(st, days);
  const dA = digest({ st, lines, id0, id1: id0 + ID_STEP });
  const fA = untracked(st, () => fullSnap(st));
  // Another world runs in between (module state from it is left behind), then the save is loaded.
  const other = createWorld({ seed: seed + 11, factionCount: 6 });
  setAutopilot(other, true, "aggressive");
  playTo(other, 10);
  const tl = performance.now();
  const B = loadFromString(text);
  const msLoad = performance.now() - tl;
  check(B.hour === savedHour && day(B) === day({ hour: savedHour }), `seed ${seed}: the loaded world is at the saved hour`);
  const linesB = linesAtSave.slice();
  track(B, linesB);
  playTo(B, days);
  const dB = digest({ st: B, lines: linesB, id0, id1: id0 + ID_STEP });
  const fB = untracked(B, () => fullSnap(B));
  const ok1 = check(dA === dB, `seed ${seed}: digests differ ${firstDiff(dA, dB)}`);
  const ok2 = check(fA === fB, `seed ${seed}: whole states differ ${firstDiff(fA, fB)}`);
  if (ok1 && ok2) console.log(`  seed ${seed}: identical on day ${day(st) - 1}${st.gameOver ? " (game over)" : ""} (${linesB.length} log lines; save ${kb(text.length)}, written in ${ms.toFixed(0)} ms, loaded in ${msLoad.toFixed(0)} ms)`);
  if (!handed) handed = { seed, save: text, lines: linesAtSave, id0, days, hash: hashOf(dA) };
}

console.log("Loaded in a fresh process");
{
  const file = join(tmpdir(), `bs-savetest-${process.pid}.json`);
  writeFileSync(file, JSON.stringify(handed));
  try {
    const there = execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--continue", file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim();
    if (check(there === handed.hash, `seed ${handed.seed}: a fresh process plays the save differently (${there.slice(0, 12)} vs ${handed.hash.slice(0, 12)})`)) console.log(`  seed ${handed.seed}: identical (${there.slice(0, 12)})`);
  } finally { try { unlinkSync(file); } catch { /* ignore */ } }
}

// ---------- 1b. world sizes (sim/worldsize.js) ----------
// A Small and a Huge world saved on day 20, played on and loaded: identical, with their size. A save from before
// sizes (no worldSize on the state) loads as what its grid is: a Normal 64 × 42 map, or whatever it really is.
console.log("World sizes");
for (const size of ["small", "huge"]) {
  const st = createWorld({ seed: 31, factionCount: 6, size });
  st.started = true;
  setAutopilot(st, true, "balanced");
  playTo(st, 20);
  while (st.cards.length && !st.gameOver) tickHour(st);
  const save = serializeState(st);
  check(save.meta.world === size, `${size}: the save list says ${save.meta.world}`);
  const B = branch(`${size} world (${st.grid.width}×${st.grid.height})`, st, (w) => playTo(w, 30));
  check(B.worldSize === size && B.grid.width === st.grid.width && B.grid.height === st.grid.height && B.tiles.length === st.tiles.length &&
    B.knowledge.length === B.tiles.length, `${size}: loaded as ${B.worldSize} ${B.grid.width}×${B.grid.height}`);
}
{
  const st = createWorld({ seed: 32, factionCount: 6 });
  const old = { ...st };
  delete old.worldSize;
  const B = deserializeState(JSON.parse(JSON.stringify(serializeState(old))));
  check(B.worldSize === "normal" && B.grid.width === 64 && B.grid.height === 42, `a save without a size loads as ${B.worldSize}`);
  const hu = createWorld({ seed: 33, factionCount: 10, size: "huge" });
  const oldHuge = { ...hu };
  delete oldHuge.worldSize;
  const C = deserializeState(JSON.parse(JSON.stringify(serializeState(oldHuge))));
  check(C.worldSize === "huge", `a Huge save without its size loads as ${C.worldSize}`);
  console.log(`  a save without a size loads as ${B.worldSize} (${B.grid.width}×${B.grid.height}); a 100×66 one as ${C.worldSize}`);
}

// ---------- 2. saved at awkward moments ----------
// Saves the world, plays it on with `go`, loads the save, plays that on the same way: the same world?
function branch(label, st, go, extra = () => "") {
  const text = saveToString(st);
  go(st);
  const a = fullSnap(st), ea = extra(st);
  const B = loadFromString(text);
  go(B);
  const b = fullSnap(B), eb = extra(B);
  if (check(a === b && ea === eb, `${label}: differs after loading ${a !== b ? firstDiff(a, b) : `${ea} vs ${eb}`}`)) console.log(`  ${label}: identical (save ${kb(text.length)})`);
  return B;
}
const world = (seed, d = 0, style = "balanced") => {
  const st = createWorld({ seed, factionCount: 7 });
  st.started = true;
  setAutopilot(st, true, style);
  playTo(st, d);
  while (st.cards.length && !st.gameOver) tickHour(st);
  if (st.gameOver) st.cards.length = 0; // a run that has fallen keeps its last card unanswered (the clock no longer moves): drop it
  return st;
};

console.log("Saved at awkward moments");
{
  // A team out on a plan (the autopilot launches none; this one is sent by hand).
  const st = world(42, 6);
  const h = hub(st);
  const dest = st.tiles.find((t) => { const d = st.grid.distance(h.tile, t.id); return d >= 4 && d <= 8 && t.loc && t.loot > 0.3 && t.loc.type !== "town" && planPath(st, h.tile, t.id, false); });
  const crew = atBase(st, h.id).slice(0, 3).map((s) => s.id);
  const res = launchExpedition(st, { memberIds: crew, dest: dest.id, mission: "scavenge", stance: "normal", supplies: { food: 14, water: 14, ammo: 20 }, plan: { preset: "scavenge", steps: PRESETS.scavenge.steps(1) } });
  check(!res.error, `plan team launched (${res.error || "ok"})`);
  const p = res.party;
  for (let i = 0; i < 30 && (st.cards.length || p.phase === "waiting" || p.idx < 2); i++) tickHour(st);
  check(st.parties.includes(p) && p.plan && p.orders && !saveBlocker(st), `the team is under way on its plan (${p.phase}, ${p.orders.length} orders left${st.cards.length ? ", a card is open" : ""})`);
  const B = branch("mid-plan (a team on a scavenge plan), 10 more days", st, (w) => playTo(w, day(w) + 10));
  check(!!B.parties.find((q) => q.id === p.id) === !!st.parties.find((q) => q.id === p.id), "the team is in the same state in both");
}
{
  // Prisoners in the cells (and the knocked-out records they came from).
  const st = world(7, 15);
  const h = hub(st);
  addBuilding(h, "cells");
  addBuilding(h, "cells");
  const f = st.factions.find((x) => x.alive && x.pop >= 6) || st.factions[0];
  const fakeB = { setup: { enemy: { kind: "raiders", power: 4, factionId: f.id, name: f.name } }, tileId: h.tile };
  const recs = captiveRecords(st, fakeB, [{ kit: "raiders", name: "Raider One", factionId: f.id }, { kit: "raiders", name: "Raider Two", factionId: f.id }]);
  capturePrisoners(st, { baseId: h.id, tile: h.tile, enemy: fakeB.setup.enemy }, { outcome: "victory", tactical: true, prisoners: recs }, null);
  h.stock.food = Math.max(h.stock.food, 200);
  check(prisonersAt(st, h.id).length === 2, `two prisoners in ${h.name}'s cells`);
  tickHour(st);
  branch("with prisoners, 20 more days", st, (w) => playTo(w, day(w) + 20), (w) => JSON.stringify((w.prisoners || []).map((x) => [x.name, x.at, Math.round(x.opinion * 1000)])));
}
{
  // A hunting cabin with a hunting mix part way through its hours (hunting.js: base.huntMix, the hour carried to the
  // next day in base.huntCarry), bows and arrows: the cabin's hunters on the Hunt role, hand-set (the governor off).
  const st = world(42, 8);
  setAutopilot(st, false);
  const h = hub(st);
  addBuilding(h, "huntcabin");
  const hunters = atBase(st, h.id).slice(0, 2);
  hunters[0].gear.weapon = newItem("compbow");
  for (const s of hunters) { s.role = "hunt"; s.work = null; s.pinned = true; }
  h.stock.arrows = 40;
  setHuntMix(h, { traps: 30, bows: 50, guns: 20 });
  tickHour(st);
  for (let i = 0; i < 48; i++) { tickHour(st); while (st.cards.length) { const c = st.cards.shift(); (c.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)) || c.choices[0]).resolve(st); } }
  check(JSON.stringify(h.huntMix) === JSON.stringify({ traps: 30, bows: 50, guns: 20 }) && !saveBlocker(st), `the hub hunts by its mix (${JSON.stringify(h.huntMix)}, carried ${JSON.stringify(h.huntCarry || {})}, yesterday ${JSON.stringify(h.huntLast && h.huntLast.hrs)})`);
  const B = branch("a hunting mix and arrows, 10 more days", st, (w) => { for (let i = 0; i < 240; i++) { tickHour(w); while (w.cards.length) { const c = w.cards.shift(); (c.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(w) : x.disabled)) || c.choices[0]).resolve(w); } } },
    (w) => JSON.stringify([hub(w).huntMix, hub(w).huntCarry, hub(w).huntLast, hub(w).stock.arrows]));
  check(JSON.stringify(hub(B).huntMix) === JSON.stringify({ traps: 30, bows: 50, guns: 20 }), "the hunting mix is kept through a save and load");
}
{
  // Raid damage (breakdowns.js raidDamage): wrecked and damaged buildings, the last raid's report and the repairs
  // under way survive a save, and both worlds repair the same way.
  const st = world(42, 12);
  setAutopilot(st, false);
  const h = hub(st);
  for (const t of ["walls", "walls", "bunkhouse", "watchtower", "cistern"]) addBuilding(h, t);
  h.stock.scrap = Math.max(h.stock.scrap || 0, 120);
  const rep = raidDamage(st, h, { strength: 90, hours: 8, outcome: "broken", by: "Test raiders" });
  const sig = (w) => JSON.stringify([hub(w).buildings.map((b) => [b.type, Math.round(b.wear || 0), !!b.broken]), hub(w).lastRaid && hub(w).lastRaid.text, (hub(w).repairs || []).map((j) => [j.fx, j.method, Math.round(j.done * 10)])]);
  check(rep.broken.length >= 1 && h.lastRaid === rep, `a break-in by strength 90 wrecks buildings (${rep.text})`);
  check(sig(loadFromString(saveToString(st))) === sig(st), "the damage (wear, broken flags, the raid report) is the same after loading");
  startAllRepairs(st, h);
  check((h.repairs || []).length >= 1, `repairs started (${(h.repairs || []).length})`);
  branch("raid damage with repairs under way, 6 more days", st, (w) => playTo(w, day(w) + 6), sig);
}
{
  // An open card: refused with a reason; answered, it saves.
  const st = world(1234, 3);
  setAutopilot(st, false);
  addCard(st, { title: "A test card", text: "Pick one.", choices: [{ label: "Fine", resolve: () => "Done." }] });
  let err = null;
  try { serializeState(st); } catch (e) { err = e; }
  check(err instanceof SaveError && err.code === "card" && /A test card/.test(err.message) && saveBlocker(st) === err.message, `an open card cannot be saved: "${err && err.message}"`);
  st.cards.shift().choices[0].resolve(st);
  check(!saveBlocker(st) && loadFromString(saveToString(st)).hour === st.hour, "answered, the world saves and loads");
  // Anything else that is code is refused too, with where it is.
  st.bases[0].oops = () => 1;
  try { serializeState(st); err = null; } catch (e) { err = e; }
  check(err instanceof SaveError && err.code === "function" && /bases\[0\]\.oops/.test(err.message), `code anywhere else in the world is refused with its place (${err && err.message})`);
  delete st.bases[0].oops;
  // The game-over autosave leaves open cards out.
  addCard(st, { title: "Left open", text: "", choices: [{ label: "x", resolve: () => "" }] });
  const s2 = loadFromString(JSON.stringify(serializeState(st, { dropCards: true })));
  check(s2.cards.length === 0 && st.cards.length === 1, "dropCards writes the world without its open cards (and leaves the live world alone)");
}
{
  // Battles: saved mid-fight, both play to the end.
  const fight = (w) => { for (let g = 0; g < 80 && w.combat && !w.combat.over; g++) { autoPlayerTurn(w); if (w.combat && !w.combat.over) runEnemyPhase(w); } if (w.combat && w.combat.over) closeCombat(w); };
  const battleTail = (w) => JSON.stringify([!!w.combat, w.log.slice(0, 12).map((l) => l.text)]);
  const turn = (w) => { autoPlayerTurn(w); if (w.combat && !w.combat.over) runEnemyPhase(w); };
  {
    const st = world(42, 2);
    const h = hub(st);
    st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: atBase(st, h.id).slice(0, 4).map((s) => s.id), enemy: { kind: "raiders", count: 5, power: 4 }, ambush: null, canRetreat: true, handler: "savetest" });
    turn(st);
    const B = loadFromString(saveToString(st));
    check(B.combat && B.combat.rng === B.rng && B.combat.pools[0] === hub(B).stock && B.combat.units.length === st.combat.units.length, "a loaded battle keeps its links: the world's rng, the hub's stock as its supply pool");
    branch("mid-battle at the hub (turn 2), fought to the end", st, fight, battleTail);
  }
  {
    const st = world(7, 2);
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile).id;
    const crew = atBase(st, h.id).slice(0, 3);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 20, meds: 1 } });
    const p = res.party;
    p.path = [tile]; p.idx = 0; p.phase = "engaged";
    st.combat = createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "savetest", enemy: { kind: "mixed", count: 3, power: 3, groups: [{ kind: "raiders", count: 2, power: 3 }, { kind: "zombies", count: 2, power: 2 }] }, raid: { heat0: 0 }, context: {} });
    turn(st); turn(st);
    branch(`mid-raid (${st.combat.w}×${st.combat.h} map, turn ${st.combat.turn}), played to the end`, st, fight, battleTail);
  }
  {
    const st = world(1234, 2);
    const h = hub(st);
    addBuilding(h, "barricades");
    const [x0, y0] = st.grid.xy(h.tile);
    globalThis.window = {}; // a battle on the map, as in the browser (deploy.js)
    try {
      st.combat = createBattle(st, { tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: 12, power: 3, name: "the horde" }, ambush: null, canRetreat: false, handler: "savetest", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { strip: true, through: 150, fromTile: st.grid.id(x0, Math.max(0, y0 - 2)) } });
    } finally { delete globalThis.window; }
    check(st.combat.phase === "deploy", `the break-in opens on the deploy step (${st.combat.w}×${st.combat.h}, attack from the ${st.combat.side})`);
    branch("a break-in saved on the deploy step, fought to the end", st, fight, battleTail);
  }
  {
    const st = world(42, 2);
    const h = hub(st);
    const hive = st.hives[0];
    const crew = atBase(st, h.id).slice(0, 4);
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile === hive.tile ? hive.tile : st.grid.neighbors(h.tile)[0], mission: "move", stance: "normal", supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
    const p = res.party;
    p.path = [hive.tile]; p.idx = 0; p.dest = hive.tile; p.phase = "engaged";
    st.autoCombat = false; // the autopilot's fights by the numbers: this one opens on the map
    globalThis.window = {};
    try { assaultHive(st, p, hive); } finally { delete globalThis.window; }
    check(st.combat && st.combat.setup.handler === "hiveAssault", "a hive assault opens on the map (the autosave's moment)");
    turn(st);
    branch("mid hive assault (turn 2), fought to the end", st, fight, battleTail);
  }
}

// ---------- 3. size at day 365 ----------
console.log("Size at day 365");
{
  const seed = seeds[seeds.length - 1];
  const st = world(seed, 365);
  const t1 = performance.now();
  const save = serializeState(st, { dropCards: true });
  const t2 = performance.now();
  const json = JSON.stringify(save);
  const t3 = performance.now();
  const gz = await Saves.gzip(json);
  const stored = await Saves.packSave(json);
  const t4 = performance.now();
  const back = await Saves.unpackSave(stored);
  const B = loadFromString(back);
  const t5 = performance.now();
  check(back === json && fullSnap(B) === fullSnap(st), "packed for storage and back: the same save, the same world");
  const parts = Object.entries(save.state).map(([k, v]) => [k, JSON.stringify(v ?? null).length]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`  seed ${seed}, day ${day(st)}${st.gameOver ? " (game over)" : ""}: JSON ${kb(json.length)} (largest: ${parts.map(([k, n]) => `${k} ${kb(n)}`).join(", ")}); gzip ${kb(gz.length)}; stored ${stored.length} characters = ${kb(stored.length * 2)} of browser storage (UTF-16)`);
  console.log(`  times: serialize ${(t2 - t1).toFixed(0)} ms, JSON ${(t3 - t2).toFixed(0)} ms, compress ${(t4 - t3).toFixed(0)} ms, unpack + load ${(t5 - t4).toFixed(0)} ms`);
  check(stored.length * 2 < 1.5 * 1024 * 1024, `a year's save fits browser storage several times over (${kb(stored.length * 2)} of the usual 5 MB)`);
}

// ---------- 4. storage ----------
console.log("Storage, versions and damage");
{
  const store = new Map();
  let full = false;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { if (full && String(v).length > 1000) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" }); store.set(k, String(v)); },
    removeItem: (k) => store.delete(k),
  };
  const rnd = new Uint8Array(5003).map((_, i) => (i * 7919 + (i >> 3) * 31) & 255);
  check(Saves.unpack15(Saves.pack15(rnd), rnd.length).every((v, i) => v === rnd[i]), "15-bit packing round trip");
  check([...Saves.pack15(rnd)].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 0xd800), "packed characters are never surrogates or control characters");
  const st = world(42, 8);
  const e1 = await Saves.writeSave("s1", st, { name: "First" });
  playTo(st, 10);
  while (st.cards.length) tickHour(st);
  const e2 = await Saves.writeSave(Saves.AUTOSAVE, st, { why: "dawn" });
  const list = Saves.listSaves();
  check(list.length === 2 && list.some((e) => e.id === "s1" && e.name === "First" && e.day === 9) && list.some((e) => e.auto && e.day === 11), `index lists both saves with their day (${list.map((e) => `${e.name} d${e.day}`).join(", ")})`);
  check(Saves.newSlotId() === "s2", "the next free slot is s2");
  const L = await Saves.readSave("s1");
  check(day(L) === 9 && L.seed === 42 && e1.survivors === L.survivors.filter((s) => s.alive).length, "a slot loads the world it saved");
  full = true;
  let err = null;
  try { await Saves.writeSave("s2", st, {}); } catch (e) { err = e; }
  check(err instanceof SaveError && err.code === "quota" && !Saves.saveEntry("s2"), `a full storage is a clear message, nothing half-written ("${err && err.message}")`);
  full = false;
  check(Saves.deleteSave("s1") && !store.has("brokenstate.save.s1") && Saves.listSaves().length === 1, "delete removes the save and its line in the index");
  const imp = await Saves.importSaveText(saveToString(st), "From a file");
  check(imp.name === "From a file" && (await Saves.readSave(imp.id)).hour === st.hour, "an imported file becomes a slot that loads");
  const good = JSON.parse(saveToString(st));
  check(!checkSave({ ...good, v: SAVE_VERSION + 1 }).ok && /newer version/.test(checkSave({ ...good, v: SAVE_VERSION + 1 }).why), "a save from a newer version is refused with a reason");
  check(!checkSave({ ...good, v: undefined }).ok && !checkSave({ ...good, format: "x" }).ok && !checkSave(null).ok, "no version or another format: refused");
  let dmg = null;
  try { deserializeState({ format: SAVE_FORMAT, v: SAVE_VERSION, nextId: 5, state: { $: "R", i: 3 } }); } catch (e) { dmg = e; }
  check(dmg instanceof SaveError && dmg.code === "damaged", `a damaged save is refused (${dmg && dmg.message})`);
  let trunc = null;
  try { Saves.parseSave(saveToString(st).slice(0, 5000)); } catch (e) { trunc = e; }
  check(trunc instanceof SaveError, "a cut-off file is refused");
  const o = Saves.loadOptions();
  check(o.autosave === true && o.autosaveDays === 1, "options default to autosave every day");
  Saves.saveOptions({ ...o, autosaveDays: 3, pauseOnBlur: true });
  check(Saves.loadOptions().autosaveDays === 3 && Saves.loadOptions().pauseOnBlur === true, "options are remembered");
  // The odd values JSON loses: kept.
  const odd = { a: undefined, b: NaN, c: Infinity, d: -0, e: [undefined, 1], $: "dollar", m: new Map([[1, { x: 1 }]]), s: new Set(["a"]), t: new Uint16Array([1, 65535]) };
  odd.self = odd.m.get(1);
  const back = deserializeState({ format: SAVE_FORMAT, v: SAVE_VERSION, nextId: peekNextId(), state: JSON.parse(JSON.stringify(serializeState({ ...st, odd }).state)) }).odd;
  check("a" in back && back.a === undefined && Number.isNaN(back.b) && back.c === Infinity && Object.is(back.d, -0) && back.e.length === 2 && back.$ === "dollar" &&
    back.m.get(1) === back.self && back.s.has("a") && back.t instanceof Uint16Array && back.t[1] === 65535, "undefined, NaN, Infinity, -0, a \"$\" key, Map, Set, typed arrays and shared objects survive");
}

// ---------- 5. the settings view ----------
console.log("The settings view");
{
  const BAD = /\b(undefined|NaN|Infinity)\b|\[object [A-Za-z]+\]|\bnull\b/;
  const VOID = new Set(["input", "br", "img", "hr", "meta", "link"]);
  const scan = (html, where) => {
    const out = [];
    const text = html.replace(/<[^>]*>/g, " ");
    const m = BAD.exec(text);
    if (m) out.push(`${where}: "${m[0]}" near "${text.slice(Math.max(0, m.index - 50), m.index + 30).replace(/\s+/g, " ")}"`);
    for (const a of html.matchAll(/(data-[\w-]+|title|value|placeholder)="([^"]*)"/g)) if (BAD.test(a[2])) out.push(`${where}: ${a[1]}="${a[2].slice(0, 80)}"`);
    const stack = [];
    for (const t of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
      const tag = t[2].toLowerCase();
      if (VOID.has(tag) || t[3]) continue;
      if (!t[1]) stack.push(tag);
      else if (stack.pop() !== tag) { out.push(`${where}: unbalanced </${tag}>`); break; }
    }
    if (stack.length) out.push(`${where}: unclosed <${stack.join("> <")}>`);
    return out;
  };
  const mainSrc = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const NG = await import("../src/ui/newgame.js");
  const handled = (a) => !!(SETTINGS_ACTIONS[a] || SETTINGS_CHANGE[a] || NG.LOOK_ACTIONS[a] || new RegExp(`(^|[\\s{,])("${a}"|${/^[a-z]\w*$/i.test(a) ? a : "\\u0000"})\\s*:`, "m").test(mainSrc));
  const api = { options: Saves.loadOptions(), desktop: true, autosaveInfo: () => ({ error: "" }), refresh() {}, track() {}, thumb: () => "" };
  const st = world(7, 4);
  const views = [];
  for (const started of [false, true]) for (const tab of ["game", "options", "about"]) {
    const ui = { started, scale: 1, speed: 0, slot: started ? "s2" : null };
    openSettings(ui, tab);
    views.push([`${started ? "in game" : "new run"} / ${tab}`, settingsModal(st, ui, api)]);
  }
  { // with a question open, a message, and a card blocking the save
    const ui = { started: true, scale: 1, speed: 0, slot: null };
    openSettings(ui, "game");
    ui.settings.confirm = { text: "Load it?", yes: "Load" };
    ui.settings.msg = "Saved: x.";
    addCard(st, { title: "Blocking", text: "", choices: [] });
    views.push(["card open + question", settingsModal(st, ui, { ...api, desktop: false })]);
    st.cards.length = 0;
  }
  for (const [started, sec] of [[false, ""], [true, "map-layers"], [true, "map-legend"], [true, "keys-on-the-map"]]) { // the Help tab (ui/help.js)
    const ui = { started, scale: 1, speed: 0, slot: null };
    openSettings(ui, "help", sec);
    views.push([`${started ? "in game" : "new run"} / help${sec ? ` / ${sec}` : ""}`, settingsModal(st, ui, api)]);
  }
  let probs = [], acts = new Set(), missing = new Set();
  for (const [where, html] of views) {
    probs.push(...scan(html, where));
    for (const m of html.matchAll(/data-action="([^"]+)"/g)) { acts.add(m[1]); if (!handled(m[1])) missing.add(m[1]); }
  }
  check(probs.length === 0, `settings view: ${probs.slice(0, 4).join(" | ")}`);
  check(missing.size === 0, `data-actions without a handler: ${[...missing].join(", ")}`);
  check(views[3][1].includes("waiting") === false && views[6][1].includes("waiting for an answer") && /data-action="set-save"[^>]*disabled/.test(views[6][1]), "Save is disabled with the card's reason while a card is open");
  check(views[3][1].includes("set-saveexit") && views[3][1].includes("set-quit") && !views[6][1].includes("set-quit"), "Save and exit always; Quit to desktop only in the desktop app");
  console.log(`  ${views.length} views, ${acts.size} actions (${[...acts].join(", ")})`);
}

console.log(`\n${passes} passed, ${fails} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(fails ? 1 : 0);
