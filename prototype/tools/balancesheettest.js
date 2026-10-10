// The balance sheet (tools/balancesheet.js → docs/balance-sheet/index.html) and its patch tool (tools/applybalance.js).
// Checks:
// - the generator runs and every gun, melee weapon, magazine, internal feed, calibre, ammo type, round (calibre × type),
//   retail box row and bulk container in the game is a row;
// - editable cells are the source values (spot checks: a gun's dmg and its GEAR value, a round's tier, a magazine's
//   capacity, the lever-action's cap in WEAPON_PATCH, durability from ROSTER_DUR and data.js GEAR_DUR), computed ones not;
// - the page parses (its data is JSON, its scripts compile) and its live formulas equal the game's for every row
//   (ladder.js hitDamage / gunHit / rung / ladderRows, ammoPen, the ammo boxes, ROUND_SUPPLIES, AMMO_MIX,
//   HAND_SUPPLIES, custompoints.js itemPoints / slotPoints, ARSENAL_FINDS.FIND_W);
// - the exported patch has its shape ({ version, generatedFrom, changes: [{ table, key, field, from, to }],
//   rarityOrder }) and reads back (Import) to the same edits;
// - applybalance on a scratch copy of src/sim (the OS temp dir): --dry writes nothing; applying changes exactly the
//   lines it should, the game loads every new value (a fresh node), a `from` that does not match is refused, a field
//   is added where the source had none, the rarity order is rewritten; a second run refuses everything (from moved on).
// Usage: node tools/balancesheettest.js
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collect, renderHtml, PROTO, PAGE_CALC, PAGE_PATCH } from "./balancesheet.js";
import { applyPatch, probe } from "./applybalance.js";
import { WEAPONS } from "../src/sim/combat.js";
import { GEAR } from "../src/sim/data.js";
import { CALIBERS, AMMO_TYPES, AMMO_GEAR, ROUND_SUPPLIES, AMMO_MIX, HAND_SUPPLIES, RARITY, ammoPen } from "../src/sim/data-ammo.js";
import { ARSENAL_FINDS } from "../src/sim/data-guns.js";
import { MAGAZINES, INTERNAL, CLIPS } from "../src/sim/data-kit.js";
import { RETAIL_BOX, BULK } from "../src/sim/data-stacks.js";
import { hitDamage, ladderRows, gunHit, rung, TARGETS, FAR } from "../src/sim/ladder.js";
import { spreadMult } from "../src/sim/data-ammo.js";
import { itemPoints, slotPoints } from "../src/sim/custompoints.js";

let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, eps = 1e-6) => (a == null && b == null) || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= eps);
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- the generator ----------
console.log("Generator");
const sheet = await collect(PROTO);
const T = Object.fromEntries(sheet.tables.map((t) => [t.id, t]));
const keys = (id) => new Set(T[id].rows.map((r) => r.key));
const html = renderHtml(sheet);
check(html.length > 50000 && html.length < 4e6, `the page renders (${Math.round(html.length / 1024)} KB)`);
check(!/<script[^>]+src=|<link[^>]+href=|\bfetch\(|XMLHttpRequest|\bimport\(["'`]|https?:\/\/(?!www\.w3\.org)/.test(html), "self-contained: no external scripts, stylesheets or fetches");
check(["Guns", "Magazines", "Calibres & rounds", "Containers & boxes", "Melee", "Gun distribution"].every((x) => sheet.tabs.some((t) => t.title === x)), `tabs: Guns / Magazines / Calibres & rounds / Containers & boxes / Melee / Gun distribution (${sheet.tabs.map((t) => t.title).join(", ")})`);
check(sheet.tabs.every((tab) => tab.tables.every((id) => T[id])) && sheet.tables.every((t) => t.id === "rarity" || sheet.tabs.some((tab) => tab.tables.includes(t.id))), "every table is on a tab (the rarity tiers: the side panel)");

console.log("Every item is a row");
const ranged = Object.keys(WEAPONS).filter((k) => !WEAPONS[k].melee && !WEAPONS[k].acid && Array.isArray(WEAPONS[k].dmg));
const missing = (want, id) => [...want].filter((k) => !keys(id).has(k));
check(!missing(ranged, "guns").length, `every gun (${ranged.length}) is on the Guns tab${missing(ranged, "guns").length ? `: missing ${missing(ranged, "guns")}` : ""}`);
check(Object.keys(GEAR).filter((k) => GEAR[k].slot === "weapon" && WEAPONS[k] && !WEAPONS[k].melee).every((k) => keys("guns").has(k)), "every gun item (GEAR weapon) is there");
const melee = Object.keys(WEAPONS).filter((k) => WEAPONS[k].melee && k !== "claws");
check(!missing(melee, "melee").length, `every melee weapon (${melee.length}) on the Melee tab${missing(melee, "melee").length ? `: missing ${missing(melee, "melee")}` : ""}`);
check(!missing(Object.keys(MAGAZINES), "mags").length, `every magazine (${Object.keys(MAGAZINES).length})`);
check(!missing(Object.keys(INTERNAL).filter((k) => WEAPONS[k]), "feeds").length && !missing(Object.keys(CLIPS), "clips").length, "every internal magazine and clip");
check(!missing(Object.keys(CALIBERS), "calibres").length, `every calibre (${Object.keys(CALIBERS).length})`);
check(!missing(Object.keys(AMMO_TYPES), "types").length, `every ammo type (${Object.keys(AMMO_TYPES).length})`);
const rounds = Object.entries(CALIBERS).flatMap(([c, d]) => d.types.map((t) => `${c}_${t}`));
check(!missing(rounds, "rounds").length && T.rounds.rows.length === rounds.length, `every round, calibre × type (${rounds.length})`);
check(!missing(Object.keys(RETAIL_BOX), "boxes").length && !missing(Object.keys(BULK), "bulk").length, "every retail box row and bulk container");
check(T.rarity.rows.map((r) => r.key).join() === RARITY.join(), "the rarity tiers in RARITY's order");

console.log("Editable cells");
const ed = (t, k, f) => { const r = T[t].rows.find((x) => x.key === k); return r && r.ed[f]; };
check(/^combat\.js:\d+$/.test(ed("guns", "ar", "dmgHi") || "") && /^data\.js:\d+$/.test(ed("guns", "ar", "value") || ""), "the assault rifle: dmg in combat.js WEAPONS, value in data.js GEAR");
check(/^data-guns\.js:\d+$/.test(ed("guns", "m4", "dmgLo") || "") && /^data-guns\.js:\d+$/.test(ed("guns", "m4", "burstRounds") || ""), "the M4: dmg and burst in data-guns.js ARSENAL_WEAPONS");
check(!ed("guns", "hk416", "burstRounds"), "the HK416's modes are a shared constant (AUTO_556): read-only");
check(/^data-guns\.js:/.test(ed("guns", "leverrifle", "cap") || ""), "the lever-action's cap: data-guns.js WEAPON_PATCH (its last word), not combat.js");
check(/^data-guns\.js:/.test(ed("guns", "sniper", "dur") || "") && /^data\.js:/.test(ed("guns", "pistol", "dur") || ""), "durability: ROSTER_DUR for the sniper rifle, data.js GEAR_DUR for the 9mm pistol");
check(ed("guns", "pistol22", "close") && ed("guns", "pistol22", "close")[0] === "+", "a field the gun lacks (the .22 pistol's close) can be added");
check(!ed("guns", "turret_m2", "aim") && !ed("guns", "turret_m2", "rarity"), "the turrets (numbers from code, no item) are read-only");
check(/^data-ammo\.js:/.test(ed("rounds", "556_fmj", "tier") || "") && /^data-ammo\.js:/.test(ed("rounds", "556_fmj", "value") || ""), "a round's tier and value: ROUND_ECON");
check(/^data-ammo\.js:/.test(ed("rounds", "12ga_slug", "penSet") || "") && !ed("rounds", "556_fmj", "penSet"), "a type's own pen for a calibre is editable; none set: nothing");
check(["spreadFull", "spreadDrop", "spreadMin"].every((f) => /^data-ammo\.js:/.test(ed("types", "buck", f) || "") && /^data-ammo\.js:/.test(ed("types", "bird", f) || "")) && !ed("types", "slug", "spreadFull"), "buckshot's and birdshot's spread fall-off is editable (AMMO_TYPES); a slug has none");
check(/^data-guns\.js:/.test(ed("guns", "p90", "dmgLo") || "") && /^data-guns\.js:/.test(ed("guns", "revolver44", "value") || "") && /^data-guns\.js:/.test(ed("guns", "g3", "dur") || "") && /^data-guns\.js:/.test(ed("guns", "famas", "rarity") || ""), "the more-calibres guns are editable in their own tables (CALIBRE_WEAPONS / CALIBRE_GEAR / CALIBRE_DUR / CALIBRE_RARITY)");
check(/^data-kit\.js:/.test(ed("mags", "mag_p90_50", "cap") || "") && /^data-kit\.js:/.test(ed("feeds", "lever44", "perReload") || "") && /^data-stacks\.js:/.test(ed("boxes", "44mag_hp", "n") || ""), "their magazines, internal feeds and box sizes are editable (CALIBRE_MAGS, CALIBRE_INTERNAL, RETAIL_BOX)");
check(/^data-kit\.js:/.test(ed("mags", "mag_ak_30", "cap") || "") && /^data-stacks\.js:/.test(ed("boxes", "9mm", "n") || ""), "magazines (data-kit.js), box sizes (data-stacks.js)");
check(/^data-ammo\.js:/.test(ed("rarity", "rare", "find") || "") && /^data-guns\.js:/.test(ed("rarity", "rare", "gunFind") || ""), "rarity weights: RARITY_FIND and ARSENAL_FINDS.FIND_W");
check(sheet.tables.every((t) => t.rows.every((r) => Object.keys(r.ed).every((f) => { const c = t.cols.find((x) => x.id === f); return c && !c.calc; }))), "no computed column is editable");
const edCount = sheet.tables.reduce((a, t) => a + t.rows.reduce((b, r) => b + Object.keys(r.ed).length, 0), 0);
check(edCount > 1500, `editable cells: ${edCount}`);

// ---------- the page parses ----------
console.log("The page");
const scripts = [...html.matchAll(/<script id="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => ({ id: m[1], src: m[2] }));
check(scripts.map((s) => s.id).join() === "sheet-data,sheet-calc,sheet-app", "three inline scripts: data, formulas, app");
let data = null;
try { data = JSON.parse(scripts[0].src); } catch (e) { check(false, `data is JSON: ${e.message}`); }
check(data && data.tables.length === sheet.tables.length, "the data parses back");
for (const s of scripts.slice(1)) { try { new Function(s.src); check(true, ""); } catch (e) { check(false, `${s.id} compiles: ${e.message}`); } }
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";
check(/prefers-color-scheme: dark/.test(css) && /position: sticky/.test(css), "light and dark themes, sticky header");

// ---------- the page's formulas against the game ----------
console.log("Live formulas = the game's");
const base = (t, k, f) => { const tb = data.tables.find((x) => x.id === t); const r = tb && tb.rows.find((x) => x.key === k); return r ? r.v[f] : undefined; };
// eslint-disable-next-line no-new-func
const makeCalc = new Function("get", "S", `${PAGE_CALC}\nreturn CALC;`);
const CALC = makeCalc(base, data.S);
const bad = {};
const cmp = (what, a, b, eps = 1e-6) => { if (!near(a, b, eps)) (bad[what] = bad[what] || []).push(`${a} vs ${b}`); };
for (const k of ranged) {
  const w = WEAPONS[k];
  if (w.cal && CALIBERS[w.cal] && data.S.ladder[w.cal]) {
    const g = gunHit(w);
    cmp("gun hit, no armour (gunHit)", CALC.guns.hitBare(k), g.bare);
    cmp("gun hit, vest (gunHit)", CALC.guns.hitVest(k), g.vest);
    cmp("gun hit, plate", CALC.guns.hitPlate(k), r1(hitDamage(w.cal, CALIBERS[w.cal].base, TARGETS.plate, { base: (w.dmg[0] + w.dmg[1]) / 2 })));
    cmp("gun hit at range (buckshot's spread, gunHit)", CALC.guns.hitFar(k), spreadMult(CALIBERS[w.cal].base, FAR) < 1 ? gunHit(w, null, FAR).bare : null);
  }
  if (GEAR[k]) {
    cmp("gun points (itemPoints)", CALC.guns.points(k), itemPoints(k));
    cmp("gun + rounds points (slotPoints)", CALC.guns.pointsKit(k), slotPoints("weapon", k));
  }
  const tier = base("guns", k, "rarity");
  if (tier) cmp("gun find weight (FIND_W)", CALC.guns.findW(k), ARSENAL_FINDS.FIND_W[tier]);
}
for (const k of melee) if (GEAR[k]) cmp("melee points (itemPoints)", CALC.melee.points(k), itemPoints(k));
for (const r of ladderRows()) {
  const k = `${r.cal}_${r.type}`;
  cmp("round hit, no armour (ladderRows)", CALC.rounds.bare(k), r.bare);
  cmp("round hit, vest", CALC.rounds.vest(k), r.vest);
  cmp("round hit, plate", CALC.rounds.plate(k), r.plate);
  cmp("round hit past reach", CALC.rounds.past(k), r.past);
  cmp("round hit at range (spread)", CALC.rounds.far(k), r.far);
  cmp("round pen (ammoPen)", CALC.rounds.pen(k), r.pen);
}
for (const k of rounds) {
  const [cal, type] = [k.slice(0, k.indexOf("_")), k.slice(k.indexOf("_") + 1)];
  const box = AMMO_GEAR[`a_${k}`];
  cmp("pen, every round", CALC.rounds.pen(k), ammoPen(cal, type));
  cmp("box rounds", CALC.rounds.boxN(k), box.dur);
  cmp("box weight", CALC.rounds.boxKg(k), box.weight);
  cmp("box value", CALC.rounds.boxValue(k), box.value);
  cmp("supply value", CALC.rounds.supplyValue(k), ROUND_SUPPLIES[`a_${k}`].value);
  if (HAND_SUPPLIES[`a_${k}_hand`]) cmp("handload value", CALC.rounds.handValue(k), HAND_SUPPLIES[`a_${k}_hand`].value);
  for (const th of data.S.themes) cmp("AMMO_MIX weight", CALC.rounds[`mix_${th}`](k), (AMMO_MIX[th] || {})[k] || 0);
}
for (const cal of Object.keys(data.S.ladder)) cmp("calibre rung (ladder.js rung)", CALC.calibres.rung(cal), r1(rung(cal)));
for (const [what, list] of Object.entries(bad)) check(false, `${what}: ${list.length} rows differ (${list.slice(0, 3).join("; ")})`);
check(!Object.keys(bad).length, "every live formula equals the game's for every row");
// A live column follows an edit: the M4's damage up, its hits up; the .308's reference down, its rung down.
{
  const edits = { "guns|m4|dmgHi": 41, "calibres|308|refLo": 20, "rounds|556_fmj|tier": "rare", "types|slug|soft": 2, "types|buck|spreadDrop": 0.15 };
  const get2 = (t, k, f) => (`${t}|${k}|${f}` in edits ? edits[`${t}|${k}|${f}`] : base(t, k, f));
  const C2 = makeCalc(get2, data.S);
  check(C2.guns.hitBare("m4") > CALC.guns.hitBare("m4") && C2.guns.band("m4") > CALC.guns.band("m4"), "an edited gun's hits and band recompute");
  check(C2.calibres.rung("308") < CALC.calibres.rung("308") && C2.rounds.bare("308_sp") < CALC.rounds.bare("308_sp"), "an edited calibre reference moves its rung and rounds");
  check(C2.rounds.findW("556_fmj") === data.tables.find((t) => t.id === "rarity").rows.find((r) => r.key === "rare").v.find && C2.rounds.mixAll("556_fmj") < CALC.rounds.mixAll("556_fmj"), "an edited tier changes the find weight and the find mix");
  check(C2.rounds.bare("12ga_slug") > CALC.rounds.bare("12ga_slug"), "an edited type multiplier moves the round");
  check(C2.rounds.far("12ga_buck") < CALC.rounds.far("12ga_buck") && C2.guns.hitFar("shotgun") < CALC.guns.hitFar("shotgun") && C2.rounds.bare("12ga_buck") === CALC.rounds.bare("12ga_buck"), "an edited spread fall-off moves buckshot's hit at range only");
}

// ---------- export / import ----------
console.log("Export and import");
// eslint-disable-next-line no-new-func
const PP = new Function(`${PAGE_PATCH}\nreturn { buildPatch, readPatch };`)();
const editsA = { "guns|ar|dmgHi": 33, "rounds|556_fmj|tier": "uncommon", "guns|pistol22|close": 2, "mags|mag_ak_30|value": 7 };
const order = [...data.rarityOrder]; [order[1], order[2]] = [order[2], order[1]];
const patch = PP.buildPatch(data, editsA, order, base);
check(patch.version === data.version && patch.generatedFrom === data.generatedFrom && Array.isArray(patch.changes) && Array.isArray(patch.rarityOrder), "the patch: { version, generatedFrom, changes, rarityOrder }");
check(patch.changes.length === 4 && patch.changes.every((c) => ["table", "key", "field", "from", "to"].every((f) => f in c)), "each change: { table, key, field, from, to }");
check(JSON.stringify(patch.changes.find((c) => c.key === "ar")) === JSON.stringify({ table: "guns", key: "ar", field: "dmgHi", from: 32, to: 33 }), "the assault rifle's change reads from 32 to 33");
check(patch.changes.find((c) => c.key === "pistol22").from === null, "an added field reads from null");
const editable = (t, k, f) => !!ed(t, k, f);
const back = PP.readPatch(data, JSON.parse(JSON.stringify(patch)), editable, base);
check(!back.error && JSON.stringify(Object.entries(back.edits).sort()) === JSON.stringify(Object.entries(editsA).sort()) && back.order.join() === order.join() && back.applied === 4 && !back.skipped && !back.stale, "Import reads the export back to the same edits and order");
const odd = PP.readPatch(data, { version: data.version, changes: [{ table: "guns", key: "ar", field: "hitBare", from: 1, to: 2 }, { table: "guns", key: "nosuchgun", field: "aim", from: 1, to: 2 }] }, editable, base);
check(odd.skipped === 2 && !Object.keys(odd.edits).length, "Import skips computed cells and unknown rows");
check(!!PP.readPatch(data, { version: 99, changes: [] }, editable, base).error, "Import refuses another patch version");

// ---------- applybalance on a scratch copy ----------
console.log("applybalance (scratch copy)");
const scratch = mkdtempSync(join(tmpdir(), "balancesheet-"));
try {
  cpSync(join(PROTO, "src", "sim"), join(scratch, "src", "sim"), { recursive: true });
  cpSync(join(PROTO, "package.json"), join(scratch, "package.json"));
  const snap = () => Object.fromEntries(readdirSync(join(scratch, "src", "sim")).map((f) => [f, readFileSync(join(scratch, "src", "sim", f), "utf8")]));
  const before = snap();
  const P = {
    version: data.version, generatedFrom: data.generatedFrom,
    changes: [
      { table: "guns", key: "ar", field: "dmgHi", from: 32, to: 33 },
      { table: "guns", key: "m4", field: "burstRounds", from: 3, to: 4 },
      { table: "guns", key: "leverrifle", field: "cap", from: 6, to: 7 },
      { table: "guns", key: "sniper", field: "dur", from: 80, to: 85 },
      { table: "guns", key: "pistol", field: "dur", from: 60, to: 62 },
      { table: "guns", key: "pistol22", field: "close", from: null, to: 2 },
      { table: "guns", key: "magnum", field: "rarity", from: "veryrare", to: "rare" },
      { table: "guns", key: "ak", field: "dmgLo", from: 99, to: 25 }, // wrong from: refused
      { table: "rounds", key: "556_fmj", field: "tier", from: "common", to: "uncommon" },
      { table: "rounds", key: "12ga_slug", field: "penSet", from: 22, to: 24 },
      { table: "mags", key: "mag_ak_30", field: "value", from: 6, to: 7 },
      { table: "boxes", key: "9mm", field: "n", from: 50, to: 48 },
      { table: "calibres", key: "308", field: "refHi", from: 46, to: 47 },
      { table: "themeCals", key: "50bmg", field: "guns", from: null, to: 1 },
      { table: "rarity", key: "rare", field: "find", from: 0.06, to: 0.07 },
      { table: "globals", key: "HAND_VALUE", field: "value", from: 0.75, to: 0.7 },
      { table: "melee", key: "katana", field: "mclass", from: "blade", to: "chop" },
    ],
    rarityOrder: order,
  };
  const dry = applyPatch(P, scratch, { dry: true });
  check(JSON.stringify(snap()) === JSON.stringify(before), "--dry writes nothing");
  check(dry.applied.length === 17 && dry.refused.length === 1, `--dry reports 16 changes and the order, 1 refused (${dry.applied.length} / ${dry.refused.length})`);
  const res = applyPatch(P, scratch);
  check(res.refused.length === 1 && res.refused[0].id === "guns.ak.dmgLo" && /source has 24/.test(res.refused[0].why), `a mismatched from is refused and reported (${JSON.stringify(res.refused)})`);
  const after = snap();
  let lines = 0;
  for (const f of Object.keys(before)) {
    const a = before[f].split("\n"), b = after[f].split("\n");
    if (a.length !== b.length) { check(false, `${f}: line count changed`); continue; }
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) lines++;
  }
  check(lines >= 14 && lines <= 17, `minimal edits: ${lines} lines changed for 16 values and the order`);
  check(/burst: \{ rounds: 4, aim: -6 \}/.test(after["data-guns.js"]) && /ar: +\{ name: "Assault rifle",  dmg: \[22, 33\]/.test(after["combat.js"]), "the values replaced in place, the rest of the line untouched");
  check(/export const RARITY = \["common", "scarce", "uncommon", "rare", "veryrare"\];/.test(after["data-ammo.js"]), "the rarity order rewritten");
  const cells = P.changes.filter((c) => c.key !== "ak").map((c) => [c.table, c.key, c.field]);
  const got = probe(scratch, [...cells, ["rarityOrder", "", ""]]);
  const wrong = cells.map((c, i) => [c, got[i], P.changes.filter((x) => x.key !== "ak")[i].to]).filter(([, g, w]) => !near(g, w) && g !== w);
  check(!wrong.length, `the game (a fresh node on the copy) has every new value${wrong.length ? `: ${JSON.stringify(wrong)}` : ""}`);
  check(JSON.stringify(got[got.length - 1]) === JSON.stringify(order), "and the new order");
  const again = applyPatch(P, scratch, { dry: true });
  check(again.applied.length === 0 && again.refused.length === 17, `applied twice: every value change refused (from moved on), the order unchanged (${again.applied.length} / ${again.refused.length})`);
  check(readFileSync(join(PROTO, "src", "sim", "combat.js"), "utf8").includes('dmg: [22, 32], opt: 9,  fall: 3, aim: 8,  ammo: 2'), "the real source untouched");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// ---------- the gun distribution (gundist.js): its class per gun, draws, sources and newness, editable ----------
console.log("Gun distribution");
{
  const row = (id, k) => T[id] && T[id].rows.find((r) => r.key === k);
  const g = row("guns", "ou12"), d = row("gunDraws", "profile|raiders"), s = row("gunSources", "kit:raiders"), n = row("gunNewness", "newness");
  check(!!g && g.v.gunClass === "hunting civilian coldwar" && !!g.ed.gunClass && !!g.ed.added, `a gun's class (GUN_CLASS, words) and date (GUN_ADDED) are editable (${g && g.v.gunClass})`);
  check(!!d && d.v.civilian === 1 && !!d.ed.civilian && !!d.ed.special && d.ed.special.startsWith("+"), "a draw profile's uses are editable (a use it does not draw: an edit adds it)");
  check(!!row("gunDraws", "theme|guns") && !!row("gunDraws", "place|site:police") && !!row("gunDraws", "source|trader:traders") && !row("gunDraws", "source|kit:raiders"), "theme tags', places' and sources' own draws are rows (a source drawing a profile is not)");
  check(!!s && s.v.draws === "raiders" && s.v.band === 0.6 && !!s.ed.draws && !!s.ed.band, "a source's profile and band are editable");
  check(!!n && !!n.ed.mult && !!n.ed.from, "the newness factor and its date are editable");
  const scratch2 = mkdtempSync(join(tmpdir(), "balancesheet-gd-"));
  try {
    cpSync(join(PROTO, "src", "sim"), join(scratch2, "src", "sim"), { recursive: true });
    cpSync(join(PROTO, "package.json"), join(scratch2, "package.json"));
    const P2 = {
      version: data.version, generatedFrom: data.generatedFrom,
      changes: [
        { table: "guns", key: "ou12", field: "gunClass", from: "hunting civilian coldwar", to: "hunting civilian sport modern" }, // "sport": not a use, kept as written
        { table: "guns", key: "ou12", field: "added", from: "2026-10-10", to: "2026-10-11" },
        { table: "gunDraws", key: "profile|raiders", field: "civilian", from: 1, to: 0.9 },
        { table: "gunDraws", key: "profile|raiders", field: "special", from: null, to: 0.05 },
        { table: "gunDraws", key: "theme|guns", field: "surplus", from: 0.5, to: 0.4 },
        { table: "gunDraws", key: "place|site:police", field: "police", from: 1, to: 1.2 },
        { table: "gunDraws", key: "source|trader:traders", field: "hunting", from: 1, to: 0.8 },
        { table: "gunSources", key: "kit:raiders", field: "band", from: 0.6, to: 0.5 },
        { table: "gunSources", key: "trader:raider", field: "draws", from: "raiders", to: "militia" },
        { table: "gunNewness", key: "newness", field: "mult", from: 1.5, to: 2 },
        { table: "gunNewness", key: "newness", field: "from", from: "2026-10-10", to: "2026-10-09" },
      ],
    };
    const r2 = applyPatch(P2, scratch2);
    check(r2.applied.length === P2.changes.length && !r2.refused.length, `the gun distribution's edits apply (${r2.applied.length} of ${P2.changes.length}; refused ${JSON.stringify(r2.refused)})`);
    const got2 = probe(scratch2, P2.changes.map((c) => [c.table, c.key, c.field]));
    const bad2 = P2.changes.map((c, i) => [c, got2[i]]).filter(([c, v]) => !near(v, c.to) && v !== c.to);
    check(!bad2.length, `and the game (a fresh node on the copy) has every new value${bad2.length ? `: ${JSON.stringify(bad2)}` : ""}`);
    check(/ou12: \["hunting", "civilian", "sport", "modern"\]/.test(readFileSync(join(scratch2, "src", "sim", "data-guns.js"), "utf8")), "a class is written back as a list of words");
    const again2 = applyPatch(P2, scratch2, { dry: true });
    check(again2.applied.length === 0 && again2.refused.length === P2.changes.length, "applied twice: refused (from moved on)");
  } finally {
    rmSync(scratch2, { recursive: true, force: true });
  }
}

console.log(`\n${fails ? "FAILED" : "OK"}: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
void writeFileSync;
