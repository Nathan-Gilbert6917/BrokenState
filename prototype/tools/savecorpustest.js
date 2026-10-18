// The save corpus (tools/saves/): real saves made by older builds of the game, loaded by the code as it is now, so a
// migration (like firewood ×30) or a new field that an old world lacks never breaks an old campaign.
// Usage: node tools/savecorpustest.js [days] [file filter]      (default 8 in-game days after loading, every file)
// For every *.bsave / *.bsave.gz in tools/saves/ (the line in corpus.json says which build made it and why):
// - It is a save this version reads (format, version), and it loads (save.js deserializeState and its migrations).
// - The world is sane: survivors (as many alive as the save's list line says, every one at a base or a team that
//   exists), bases (a hub in a Normal game that has not fallen; known building types, plots counted), the mode,
//   world size and marks the migrations leave (woodcutting 2, rawWater); no NaN or negative amounts in any stock,
//   team supplies or cargo; hunger, thirst and health are numbers.
// - Firewood: a save from before firewood by weight (woodcutting mark 1) has every base's and team's firewood × 30
//   (data.js WOOD_UNITS), once: saved and loaded again, it stays the same. A save from before woodcutting starts at 0.
// - The autopilot plays [days] in-game days from there without an exception; the world is still sane, and it saves
//   and loads again (the tile heat and the POI container ledgers too).
// Adding a save from a new build: node tools/makesave.js (see there; one command).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tickHour, day, hub } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { checkSave, deserializeState, decodeGraph, serializeState, SAVE_VERSION } from "../src/sim/save.js";
import { WOOD_UNITS } from "../src/sim/data.js";
import { BUILDINGS, plotsUsed, plotCap } from "../src/sim/buildings.js";
import { WORLD_SIZES } from "../src/sim/worldsize.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "saves");
const days = Number(process.argv[2] || 8);
const only = process.argv[3] || "";
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`    FAIL: ${msg}`); } return ok; };
const t0 = performance.now();

const readText = (file) => {
  const bytes = readFileSync(join(DIR, file));
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
};
let corpus = [];
try { corpus = JSON.parse(readFileSync(join(DIR, "corpus.json"), "utf8")); } catch { corpus = []; }
const lineOf = (file) => corpus.find((e) => e.file === file) || null;

// Every amount kept in a stock-like pool: bases' stocks, teams' supplies and cargo, the staging camp's stores.
function pools(st) {
  const out = [];
  for (const b of st.bases || []) out.push([`base ${b.name}`, b.stock]);
  for (const p of st.parties || []) {
    out.push([`team ${p.name || p.id} supplies`, p.supplies]);
    if (p.cargo && p.cargo.supplies) out.push([`team ${p.name || p.id} cargo`, p.cargo.supplies]);
  }
  if (st.staging && st.staging.stores) out.push(["staging camp", st.staging.stores]);
  return out.filter(([, o]) => o && typeof o === "object");
}
// What is wrong with a world (empty: nothing). label: where in the test.
function problems(st, expectAlive = null) {
  const bad = [];
  if (!Array.isArray(st.survivors) || !st.survivors.length) bad.push("no survivors list");
  const alive = (st.survivors || []).filter((s) => s.alive);
  if (expectAlive != null && alive.length !== expectAlive) bad.push(`${alive.length} alive, the save's list says ${expectAlive}`);
  const baseIds = new Set((st.bases || []).map((b) => b.id)), partyIds = new Set((st.parties || []).map((p) => p.id));
  for (const s of alive) {
    const L = s.location || {};
    if (L.kind === "base" && !baseIds.has(L.baseId)) bad.push(`${s.name} is at a base that is gone (${L.baseId})`);
    if (L.kind === "party" && !partyIds.has(L.partyId)) bad.push(`${s.name} is in a team that is gone (${L.partyId})`);
    if (!L.kind) bad.push(`${s.name} is nowhere`);
    for (const k of ["hp", "hunger", "thirst"]) if (k in s && !Number.isFinite(s[k])) bad.push(`${s.name}'s ${k} is ${s[k]}`);
  }
  if (st.mode !== "normal" && st.mode !== "hardcore") bad.push(`mode "${st.mode}"`);
  if (!WORLD_SIZES[st.worldSize] && st.worldSize !== "custom") bad.push(`world size "${st.worldSize}"`);
  if (st.mode === "normal" && !st.gameOver && !hub(st)) bad.push("a Normal game with no hub");
  for (const b of st.bases || []) {
    for (const x of b.buildings || []) if (!BUILDINGS[x.type]) bad.push(`${b.name}: unknown building "${x.type}"`);
    for (const kind of ["building", "utility"]) if (!Number.isFinite(plotsUsed(b, kind)) || !Number.isFinite(plotCap(b, kind))) bad.push(`${b.name}: ${kind} plots not countable`);
  }
  for (const [where, o] of pools(st)) for (const [k, v] of Object.entries(o)) {
    if (typeof v !== "number") continue;
    if (!Number.isFinite(v)) bad.push(`${where}: ${k} is ${v}`);
    else if (v < -1e-6) bad.push(`${where}: ${k} is ${v}`);
  }
  if (!(st.woodcutting >= 2)) bad.push(`woodcutting mark ${st.woodcutting} (the firewood migration did not run)`);
  if (!st.rawWater) bad.push("no rawWater mark (the water migration did not run)");
  return bad;
}
const report = (bad, what) => check(!bad.length, `${what}: ${bad.slice(0, 6).join("; ")}${bad.length > 6 ? ` (+${bad.length - 6} more)` : ""}`);
const woodOf = (st) => [...(st.bases || []).map((b) => (b.stock && b.stock.wood) || 0), ...(st.parties || []).map((p) => (p.supplies && p.supplies.wood) || 0)];
const roundTrip = (st) => deserializeState(JSON.parse(JSON.stringify(serializeState(st, { dropCards: true }))));

if (!existsSync(DIR)) { console.log(`No corpus at ${DIR}`); process.exit(1); }
const files = readdirSync(DIR).filter((f) => /\.bsave(\.gz)?$/.test(f) && f.includes(only)).sort();
console.log(`Save corpus: ${files.length} saves, ${days} in-game days each on the autopilot (save format now ${SAVE_VERSION})`);
for (const file of files) {
  const t1 = performance.now();
  const meta = lineOf(file);
  console.log(`  ${file}${meta ? ` (build ${meta.commit}: ${meta.note || "no note"})` : " (not in corpus.json)"}`);
  check(!!meta, `${file} has a line in corpus.json (node tools/makesave.js writes it)`);
  let save;
  try { save = JSON.parse(readText(file)); } catch (e) { check(false, `${file} is readable JSON (${e.message})`); continue; }
  const chk = checkSave(save);
  if (!check(chk.ok, `${file} is a save this version reads (${chk.why})`)) continue;
  // The world as the old build wrote it, before any migration (to compare amounts with).
  let raw = null;
  try { raw = decodeGraph(save.state); } catch (e) { check(false, `${file} decodes (${e.message})`); continue; }
  let st;
  try { st = deserializeState(save); } catch (e) { check(false, `${file} loads: ${e.stack || e.message}`); continue; }
  check(true, "loads");
  report(problems(st, save.meta ? save.meta.survivors : null), "sane after loading");
  // Firewood ×30, once.
  const w0 = woodOf(raw), w1 = woodOf(st);
  if (!raw.woodcutting) check(w1.every((x) => x === 0), `no firewood before woodcutting: none after loading (${w1.join(",")})`);
  else if (raw.woodcutting < 2) {
    console.log(`    firewood from before firewood by weight (bases, teams): ${w0.map((x) => +x.toFixed(2)).join(", ")} → ${w1.map((x) => +x.toFixed(1)).join(", ")}`);
    check(w0.length === w1.length && w0.every((x, i) => Math.abs(x * WOOD_UNITS - w1[i]) < 1e-6), `firewood ×${WOOD_UNITS} from a save before firewood by weight (${w0.join(",")} → ${w1.join(",")})`);
  } else check(w0.every((x, i) => x === w1[i]), `firewood unchanged in a save made after the change (${w0.join(",")} → ${w1.join(",")})`);
  let again = null;
  try { again = roundTrip(st); } catch (e) { check(false, `the loaded world saves and loads again (${e.message})`); }
  if (again) check(woodOf(again).every((x, i) => x === w1[i]) && again.woodcutting === 2, "saved and loaded again: firewood scaled once only");
  check(!!st.ironman === !!raw.ironman, `Ironman ${raw.ironman ? "kept" : "not added"}`);
  // Played on by the autopilot.
  setAutopilot(st, true, "balanced");
  const d0 = day(st), end = d0 + days;
  let err = null;
  try { while (day(st) < end && !st.gameOver) tickHour(st); } catch (e) { err = e; }
  check(!err, `${days} days on the autopilot without an exception${err ? `: ${err.stack.split("\n").slice(0, 4).join(" | ")}` : ""}`);
  if (err) continue;
  report(problems(st), `sane after ${day(st) - d0} more days`);
  let after = null;
  try { after = roundTrip(st); } catch (e) { check(false, `saves and loads after playing on (${e.message})`); }
  if (after) check(day(after) === day(st) && after.survivors.length === st.survivors.length, "saves and loads after playing on");
  // Points of interest (pois.js, poicont.js): the tile heat and every container ledger come back as they were (a save
  // from before them has neither; the autopilot's searches made some).
  if (after) {
    const ledgers = (w) => JSON.stringify(w.tiles.flatMap((t) => (t.pois || []).map((x, i) => (x.cont ? [t.id, i, x.cont] : null)).filter(Boolean)));
    check(JSON.stringify(after.tileHeat || {}) === JSON.stringify(st.tileHeat || {}) && ledgers(after) === ledgers(st), `the tile heat (${Object.keys(st.tileHeat || {}).length} tiles) and the container ledgers come back after a save`);
  }
  const h = hub(st);
  console.log(`    day ${d0} → ${day(st)}${st.gameOver ? " (fallen)" : ""}, ${st.survivors.filter((s) => s.alive).length} alive, ${st.bases.length} base(s)${h ? `, hub firewood ${Math.round(h.stock.wood || 0)}` : ""} (${((performance.now() - t1) / 1000).toFixed(1)} s)`);
}
check(files.length > 0, "the corpus has saves");
console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
