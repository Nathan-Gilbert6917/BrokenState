// The hall of fame of past runs (sim/halloffame.js, ui/halloffame.js; the user's request 2026-10-25), headless:
// - an entry for each ending: the hive victory, the coalition's, a defeat and Crashlanding's bunker, from the forced
//   endings' shared start (tools/winforce.js: seed 1, the Balanced autopilot 30 days in, saved once and loaded for
//   each) and a Crashlanding world: the fields (the run, the ending with its day, season and year, the numbers, the
//   founders and their fates, the notable survivors, the leader, the achievements), at most 2 KB, no NaN or undefined;
// - building an entry changes nothing: the world's dice and the whole save the same before and after;
// - the list: no second entry on the same key (a save reloaded at its end screen), a second ending after Keep playing
//   adds one, at most HALL.MAX kept (the oldest dropped), filters by ending and mode;
// - storage (ui/halloffame.js): written and read back through a stand-in localStorage, an ending recorded once
//   (hallRecord) and the end screen's note; a storage that throws on every call, a full one, none at all, and
//   rubbish in the key: no error, the game goes on;
// - an older world (no campaign id, no achievements, no history, no memorial) still gets an entry.
// Usage: node tools/halloffametest.js
import { createWorld, tickHour, day, alive } from "../src/sim/world.js";
import { saveToString, loadFromString, saveBlocker } from "../src/sim/save.js";
import { destroyHive } from "../src/sim/hives.js";
import { crashJoin } from "../src/sim/crashstart.js";
import { hallEntry, hallAdd, hallFilter, endingOf, hallKey, HALL, ENDINGS } from "../src/sim/halloffame.js";
import { readHall, writeHall, deleteHall, hallRecord, hallEndHTML, hallModal, HALL_KEY, HALL_ACTIONS } from "../src/ui/halloffame.js";
import { forcedStart, forcedPlay } from "./winforce.js";

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log(`FAIL ${msg}`); } else console.log(`ok   ${msg}`); };
const bad = (o) => /NaN|undefined|null/.test(JSON.stringify(o));
const fakeStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k), m }; };
const DATE = Date.UTC(2026, 9, 25, 12);

// Every field an entry must have, and the size.
function fields(e, kind, where) {
  check(e && e.key && e.ending && e.ending.kind === kind && e.ending.label === ENDINGS[kind], `${where}: the ending ${kind} (${e && e.ending && e.ending.label})`);
  check(e.campaign && e.date && e.date.startsWith("2026-10-25") && e.mode && e.size && e.seed != null, `${where}: the run (${e.campaign}, ${e.date}, ${e.mode}, ${e.size}, seed ${e.seed})`);
  check(e.ending.day === e.days && e.days >= 1 && e.ending.season && e.ending.year >= 1, `${where}: day ${e.days}, ${e.ending.season} of year ${e.ending.year}`);
  check(Number.isFinite(e.peak) && e.peak >= e.alive && Number.isFinite(e.deaths) && e.bases && e.bases.peak >= e.bases.end, `${where}: numbers (peak ${e.peak}, alive ${e.alive}, deaths ${e.deaths}, bases ${e.bases.end}/${e.bases.peak}, hives ${e.hives}, coalition ${e.coalition})`);
  check(Array.isArray(e.founders) && e.founders.length >= 1 && e.founders.every((p) => p.n && p.fate), `${where}: ${e.founders.length} founders with their fates (${e.founders.map((p) => p.fate).join("; ")})`);
  check(Array.isArray(e.notable) && e.notable.length >= 1 && e.notable.length <= HALL.NOTABLE && e.notable.every((p) => p.n && p.fate), `${where}: ${e.notable.length} notable survivors (${e.notable.map((p) => p.why).join("; ")})`);
  const size = JSON.stringify(e).length;
  check(size <= HALL.BYTES, `${where}: ${size} bytes (at most ${HALL.BYTES})`);
  check(!bad(e), `${where}: no NaN, undefined or null`);
}

// ---------- the endings ----------
const start = forcedStart(1);
for (let h = 0; h < 48 && saveBlocker(start); h++) tickHour(start);
const save = saveToString(start);
const load = () => { const s = loadFromString(save); s.started = true; s.erasOff = true; return s; };

// The coalition's victory.
const A = load();
await forcedPlay(A, "alliance");
check(endingOf(A) === "alliance", `the coalition's victory (${A.victoryReason}, day ${day(A)})`);
const r0 = JSON.stringify(A.rng), s0 = saveToString(A, { dropCards: true });
const eA = hallEntry(A, "alliance", { date: DATE });
check(JSON.stringify(A.rng) === r0 && saveToString(A, { dropCards: true }) === s0, "building an entry changes nothing (the dice, the whole save)");
fields(eA, "alliance", "coalition");
check(eA.coalition >= 1 && Array.isArray(eA.ach) && eA.ach.some(([id]) => id === "wincoalition"), `coalition: the groups in it (${eA.coalition}) and the run's achievements (${(eA.ach || []).map((x) => x[0]).join(", ")})`);
check(eA.leader && alive(A).some((s) => s.name === eA.leader), `coalition: the leader at the end (${eA.leader})`);

// The hive victory, Keep playing, then the coalition's: two entries.
const B = load();
B.campaign = "c-another-run"; // a run of its own (A and B come from one save, so one campaign)
for (const hv of [...B.hives]) destroyHive(B, hv, "(forced by the test)");
B.hiveSites.length = 0;
for (let i = 0; i < 48 && !B.gameOver; i++) tickHour(B);
check(endingOf(B) === "hives", `the hive victory (${B.victoryReason}, day ${day(B)})`);
const eB1 = hallEntry(B, endingOf(B), { date: DATE });
fields(eB1, "hives", "hives");
check(eB1.hives >= 1 && eB1.ach && eB1.ach.some(([id]) => id === "winhives"), `hives: hives destroyed (${eB1.hives}) and the victory's achievement`);
B.victoryKept = true; B.gameOver = false; // the victory screen's Keep playing (main.js)
await forcedPlay(B, "alliance");
check(endingOf(B) === "alliance", "after Keep playing: the coalition's victory");
const eB2 = hallEntry(B, endingOf(B), { date: DATE + 1000 });
check(eB2.key !== eB1.key && eB2.campaign === eB1.campaign && eB1.campaign === "c-another-run", `a second ending on the same run has its own key (${eB1.key} / ${eB2.key})`);

// A defeat.
const C = load();
await forcedPlay(C, "loss");
check(endingOf(C) === "defeat", "everyone dead: a defeat");
const eC = hallEntry(C, endingOf(C), { date: DATE });
fields(eC, "defeat", "defeat");
check(eC.alive === 0 && /everyone died/.test(eC.ending.how) && eC.founders.every((p) => p.fate.startsWith("died")) && !eC.leader, `defeat: how (${eC.ending.how}), every founder dead`);

// Crashlanding's bunker.
const K = createWorld({ seed: 7, factionCount: 7, crash: true });
K.started = true;
for (let i = 0; i < 30; i++) tickHour(K);
K.crash.stage = "found"; K.crash.found = K.hour;
crashJoin(K, null);
check(endingOf(K) === "reunited", `Crashlanding: joined the unit (${K.victoryReason})`);
const eK = hallEntry(K, endingOf(K), { date: DATE });
fields(eK, "reunited", "crash");
check(eK.mode === "crash" && eK.ach && eK.ach.some(([id]) => id === "bunker"), "crash: the mode and the bunker's achievement");

// ---------- the list ----------
{
  let L = [];
  for (const e of [eA, eB1, eB2, eC, eK]) L = hallAdd(L, e).list;
  check(L.length === 5, `five entries (${L.length})`);
  const again = hallAdd(L, hallEntry(A, "alliance", { date: DATE + 5000 }));
  check(!again.added && again.list.length === 5, "the same run's ending again (a reload at its end screen): no second entry");
  check(hallFilter(L, { ending: "alliance" }).length === 2 && hallFilter(L, { mode: "crash" }).length === 1 && hallFilter(L, { ending: "defeat", mode: "normal" }).length === 1, "filters by ending and mode");
  check(L[0].date >= L[L.length - 1].date, "newest first");
  let big = [];
  for (let i = 0; i < HALL.MAX + 15; i++) big = hallAdd(big, { ...eC, key: `k${i}`, date: new Date(DATE + i * 60000).toISOString() }).list;
  check(big.length === HALL.MAX && big.some((x) => x.key === `k${HALL.MAX + 14}`) && !big.some((x) => x.key === "k0"), `at most ${HALL.MAX}, the oldest dropped`);
}

// ---------- storage ----------
{
  const st = fakeStore();
  const ui = { started: true };
  const got = hallRecord(A, ui, st, DATE);
  check(!!got && readHall(st).length === 1 && ui.hallNote && ui.hallNote.added, "an ending recorded and read back");
  check(/Added to the Hall of fame/.test(hallEndHTML(ui)) && /data-action="hall-open"/.test(hallEndHTML(ui)), "the end screen says so, with a button to it");
  check(hallRecord(A, ui, st, DATE) === null && readHall(st).length === 1, "recorded once (the screen redrawn)");
  const ui2 = { started: true };
  check(hallRecord(A, ui2, st, DATE + 9) === null && readHall(st).length === 1 && /is in the Hall of fame/.test(hallEndHTML(ui2)), "the save loaded at its end screen again: no duplicate");
  hallRecord(C, ui2, st, DATE + 10);
  check(readHall(st).length === 2, "another run's ending: a second entry");
  check(deleteHall(readHall(st)[0].key, st) && readHall(st).length === 1, "Delete removes one");
  check(hallRecord(load(), { started: true }, st) === null, "no entry while the run goes on");

  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  let ok = true;
  try {
    ok = readHall(throwing).length === 0 && writeHall([eA], throwing) === false && deleteHall("x", throwing) === false;
    const u = { started: true };
    ok = ok && hallRecord(C, u, throwing) === null && /could not be written/.test(hallEndHTML(u));
  } catch (e) { ok = false; console.log(e); }
  check(ok, "a storage that throws on every call: no error, nothing written, the end screen says so");
  const full = fakeStore(); full.setItem = (k, v) => { if (v.length > 6000) throw new Error("QuotaExceededError"); full.m.set(k, v); };
  check(writeHall([eA, eB1, eB2, eC, eK], full) && readHall(full).length >= 1, `full storage: the older half dropped (${readHall(full).length} kept)`);
  check(readHall(null).length === 0 && writeHall([eA], null) === false, "no storage at all");
  const junk = fakeStore(); junk.setItem(HALL_KEY, "{not json");
  check(readHall(junk).length === 0, "rubbish in the key reads as an empty list");
  // The window renders headless: the list, an entry's detail, the delete question.
  const ui3 = { started: true };
  HALL_ACTIONS["hall-open"](A, ui3, {});
  const html = hallModal(A, ui3);
  check(/Hall of fame/.test(html) && !/NaN|undefined/.test(html), "the window renders");
}

// ---------- an older world ----------
{
  const O = load();
  await forcedPlay(O, "loss");
  delete O.campaign; delete O.ach; delete O.history; delete O.memorial; delete O.alliance; delete O.hiveInfo;
  let e = null;
  try { e = hallEntry(O, endingOf(O), { date: DATE }); } catch (err) { console.log(err); }
  check(!!e && e.key === hallKey(O, "defeat") && e.campaign.startsWith("seed-") && !e.ach && e.hives === undefined && !bad(e), "an older world still gets an entry, its missing fields left out");
}

console.log(fails ? `\n${fails} check(s) failed` : "\nall hall of fame checks passed");
process.exit(fails ? 1 : 0);
