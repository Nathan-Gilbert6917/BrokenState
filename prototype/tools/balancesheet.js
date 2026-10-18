// The balance sheet (user request 2026-10-10): every gun, melee weapon, magazine, internal feed, calibre, ammo type and
// round, the box sizes and bulk containers, with their numbers and what follows from them (damage on no armour, a
// soft vest and a steel plate from src/sim/ladder.js's rules, points, box sizes and prices, find weights...), as ONE
// self-contained page: docs/balance-sheet/index.html (inline CSS, JS and data; opens from disk, no network).
// The page sorts, filters, hides columns, edits the source numbers (highlighted, undo per cell, kept in the browser)
// and exports the edits as a JSON patch that tools/applybalance.js writes back into the data files.
//
// Editable cells: a column with a source (FIELDS below: a registry of tools/balancesrc.js and a path) whose literal in
// the source equals the value the game has at run time; anything worked out by code stays read-only. Computed columns
// are recomputed live in the page by PAGE_CALC (the same rules as ladder.js, data-ammo.js, data-stacks.js and
// custompoints.js; tools/balancesheettest.js checks them against the game for every row); "after apply" columns are
// the generator's numbers (regenerate after applying a patch).
//
// Usage: node tools/balancesheet.js [--root <prototype dir>] [--out <file>]
//        node tools/balancesheet.js --probe <json file of [[table, key, field], ...]> [--root <dir>]  (prints the values)
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { SourceTree } from "./balancesrc.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROTO = resolve(HERE, "..");
export const SHEET_VERSION = 1;

// ---------- the editable fields: table → column → { reg, path(key) } ----------
const W = (...f) => ({ reg: "WEAPONS", path: (k) => [k, ...f] });
const G = (...f) => ({ reg: "GEAR", path: (k) => [k, ...f] });
const at = (reg, ...f) => ({ reg, path: (k) => [k, ...f] });
const THEMES = ["military", "police", "prison", "guns", "hunt", "farm", "raider", "home"];
// The scalars of the Globals table: key → [registry, path, label].
export const GLOBALS = {
  "LADDER.BAND.lo": ["LADDER", ["BAND", 0], "A gun's dmg: lowest share of its calibre's reference (arsenalbalancetest)"],
  "LADDER.BAND.hi": ["LADDER", ["BAND", 1], "A gun's dmg: highest share of its calibre's reference"],
  HAND_VALUE: ["HAND_VALUE", [], "A handload's worth × its factory round's"],
  "AMMO_STACK.LOOSE": ["AMMO_STACK", ["LOOSE"], "Loose rounds of one type in one inventory slot"],
  "AMMO_STACK.BOXES": ["AMMO_STACK", ["BOXES"], "Boxes of one kind in one inventory slot"],
  "BULK_FINDS.FULL.lo": ["BULK_FINDS", ["FULL", 0], "A found bulk container: lowest fill share"],
  "BULK_FINDS.FULL.hi": ["BULK_FINDS", ["FULL", 1], "A found bulk container: highest fill share"],
  "BULK_FINDS.PARTIAL": ["BULK_FINDS", ["PARTIAL"], "Share of found bulk containers part used"],
  "ARSENAL_FINDS.scav": ["ARSENAL_FINDS", ["scav"], "AI scavenging trip: arsenal gun chance factor"],
  "MAGS.AP.rig": ["MAGS", ["AP", "rig"], "Actions: reload from a rig pouch"],
  "MAGS.AP.pocket": ["MAGS", ["AP", "pocket"], "Actions: reload from a pocket"],
  "MAGS.AP.pack": ["MAGS", ["AP", "pack"], "Actions: reload from the pack"],
  "MAGS.TOPUP_AP": ["MAGS", ["TOPUP_AP"], "Actions: top up the magazine in the gun (no loaded spare)"],
  "SHELLS.START_HAND": ["SHELLS", ["START_HAND"], "Loose shells an enemy shotgunner starts a fight with (yours carry theirs)"],
  "SHELLS.GRAB": ["SHELLS", ["GRAB"], "Shells one Get shells takes out of the pack"],
  "SHELLS.HAND_MAX": ["SHELLS", ["HAND_MAX"], "Most loose shells kept at hand"],
  "SHELLS.MAX": ["SHELLS", ["MAX"], "Most shells a tube Reload puts in"],
  "CUSTOM_POINTS.VALUE": ["CUSTOM_POINTS", ["VALUE"], "Customize points: an item's worth ÷ this"],
  "CUSTOM_POINTS.POWER": ["CUSTOM_POINTS", ["POWER"], "Customize points: + power × this for weapons and armour"],
  "CUSTOM_POINTS.SUPPLY_VALUE": ["CUSTOM_POINTS", ["SUPPLY_VALUE"], "Customize points: supplies' worth ÷ this"],
  "START_GEAR.LOADS": ["START_GEAR", ["LOADS"], "A picked gun's rounds: full loads"],
};
// The gun distribution's draws table (gundist.js): a row "profile|raiders" (data-guns.js GUN_DRAWS), "theme|guns"
// (THEME_DRAWS), "place|site:police" (PLACE_DRAWS) or "source|trader:traders" (GUN_SOURCES' own draws); a column a use.
export const GUN_USE_COLS = ["civilian", "hunting", "police", "military", "special", "makeshift", "surplus"];
const DRAW_REG = { profile: "GUN_DRAWS", theme: "THEME_DRAWS", place: "PLACE_DRAWS", source: "GUN_SOURCES" };
const drawPath = (k, u) => { const [kind, name] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)]; return kind === "source" ? [name, "draws", u] : [name, u]; };
/** @type {Record<string, Record<string, { reg: string, path: (k: string) => any[], regOf?: (k: string) => string }>>} */
export const FIELDS = {
  guns: {
    rarity: at("GUN_RARITY"), dmgLo: W("dmg", 0), dmgHi: W("dmg", 1), opt: W("opt"), fall: W("fall"), aim: W("aim"), close: W("close"),
    ammo: W("ammo"), noise: W("noise"), cap: W("cap"), rel: W("rel"), pierce: W("pierce"), brace: W("brace"),
    heavyMob: W("heavy", "mob"), heavyBrace: W("heavy", "brace"),
    singleRounds: W("modes", "single", "rounds"), burstRounds: W("modes", "burst", "rounds"), burstAim: W("modes", "burst", "aim"),
    autoRounds: W("modes", "auto", "rounds"), autoAim: W("modes", "auto", "aim"),
    value: G("value"), weight: G("weight"), power: G("power"), req: G("req"), gearNoise: G("noise"), dur: G("dur"),
  },
  melee: {
    dmgLo: W("dmg", 0), dmgHi: W("dmg", 1), meleeAim: W("meleeAim"), mclass: W("mclass"), quick: W("quick"), bleed: W("bleed"),
    stagger: W("stagger"), reach: W("reach"), throw: W("throw"), takedown: W("takedown"), stab: W("stab"),
    chop: G("chop"), pry: G("pry"), value: G("value"), weight: G("weight"), power: G("power"), req: G("req"), dur: G("dur"),
  },
  parts: {
    ...Object.fromEntries(["aim", "close", "opt", "fall", "noise", "jam", "night", "nightNear", "peq", "brace", "moving", "reload", "wt", "spread"].map((f) => [f, at("ATTACH", f)])),
    value: G("value"), weight: G("weight"), dur: G("dur"),
  },
  mags: { cap: at("MAGAZINES", "cap"), kg: at("MAGAZINES", "kg"), value: at("MAGAZINES", "value"), aim: at("MAGAZINES", "aim"), jam: at("MAGAZINES", "jam") },
  feeds: { perReload: at("INTERNAL") },
  clips: { n: at("CLIPS", "n") },
  calibres: {
    kg: at("CALIBERS", "kg"), pen: at("CALIBERS", "pen"), ad: at("CALIBERS", "ad"), value: at("CALIBERS", "value"),
    refLo: at("CAL_DMG", 0), refHi: at("CAL_DMG", 1),
  },
  types: Object.fromEntries(["dmg", "soft", "penAdd", "value", "aim", "opt", "fallMult", "close", "noise", "jam", "ad", "spreadFull", "spreadDrop", "spreadMin"].map((f) => [f, at("AMMO_TYPES", f)])),
  rounds: {
    tier: at("ROUND_ECON", 0), value: at("ROUND_ECON", 1),
    penSet: { reg: "AMMO_TYPES", path: (k) => { const [cal, type] = splitRound(k); return [type, "pen", cal]; } },
  },
  themeCals: Object.fromEntries(THEMES.map((th) => [th, { reg: "THEME_CALS", path: (k) => [th, k] }])),
  themeTypes: Object.fromEntries(THEMES.map((th) => [th, { reg: "THEME_TYPES", path: (k) => [th, k] }])),
  places: { chance: { reg: "ARSENAL_FINDS", path: (k) => k.split(":") } },
  boxes: { n: at("RETAIL_BOX") },
  bulk: { cap: at("BULK", "cap"), empty: at("BULK", "empty"), weight: G("weight"), value: G("value"), kindW: { reg: "BULK_FINDS", path: (k) => ["KIND", k] } },
  bulkFinds: { chance: { reg: "BULK_FINDS", path: (k) => ["CHANCE", k] }, boxed: { reg: "BULK_FINDS", path: (k) => ["BOXED", k] } },
  rarity: { find: at("RARITY_FIND"), gunFind: { reg: "ARSENAL_FINDS", path: (k) => ["FIND_W", k] } },
  globals: { value: { reg: "", path: (k) => GLOBALS[k][1], regOf: (k) => GLOBALS[k][0] } },
  // the gun distribution (gundist.js): draws by use for a profile / a theme tag / a place / a source's own; sources'
  // profile and band; the newness factor of the extra-gun rolls
  gunDraws: Object.fromEntries(GUN_USE_COLS.map((u) => [u, { reg: "", regOf: (k) => DRAW_REG[k.split("|")[0]], path: (k) => drawPath(k, u) }])),
  gunSources: { draws: { reg: "GUN_SOURCES", path: (k) => [k, "draws"] }, band: { reg: "GUN_SOURCES", path: (k) => [k, "band"] } },
  gunNewness: { mult: { reg: "GUN_NEWNESS", path: () => ["mult"] }, from: { reg: "GUN_NEWNESS", path: () => ["from"] } },
};
FIELDS.guns.gunClass = at("GUN_CLASS");
FIELDS.guns.added = at("GUN_ADDED");
// Columns whose field may be absent in the source and added by an edit (a gun with no close-range modifier given one).
const INSERTABLE = {
  gunDraws: GUN_USE_COLS,
  guns: ["rarity", "close", "aim", "pierce", "brace", "added"],
  melee: ["meleeAim", "bleed", "stagger", "takedown", "quick", "stab", "reach", "throw"],
  mags: ["aim", "jam"],
  parts: ["aim", "close", "opt", "fall", "noise", "jam", "nightNear", "brace", "moving"],
  themeCals: THEMES, themeTypes: THEMES,
  places: ["chance"],
};
/** "12ga_slug" → ["12ga", "slug"] (calibres have no "_"; the type is the rest). */
export function splitRound(k) { const i = k.indexOf("_"); return [k.slice(0, i), k.slice(i + 1)]; }
/** The source of a cell: { reg, path } or null. */
export function fieldSrc(table, key, field) {
  const f = FIELDS[table] && FIELDS[table][field];
  if (!f) return null;
  return { reg: f.regOf ? f.regOf(key) : f.reg, path: f.path(key) };
}
export const insertable = (table, field) => !!(INSERTABLE[table] && INSERTABLE[table].includes(field));

// ---------- the page's live formulas (the game's rules over the sheet's current values) ----------
// get(table, key, field): the current (edited) value; S: static data from the generator. Defines CALC[table][column](key).
export const PAGE_CALC = String.raw`
const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
const has = (v) => typeof v === "number" && isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const avg = (lo, hi) => (num(lo) + num(hi)) / 2;
function penChance(pen, ac, cond) { return Math.max(S.AR.P_MIN, Math.min(S.AR.P_MAX, 0.5 + (pen - 10 * ac * (0.4 + 0.6 * cond)) / 20)); }
function pieceMult(pen, ac, cond) { const p = penChance(pen, ac, cond); return p * (ac >= 4 ? S.AR.THRU_HEAVY : S.AR.THRU) + (1 - p) * S.AR.BLUNT[Math.max(0, Math.min(6, Math.round(ac)))]; }
function tval(type, f) { const v = get("types", type, f); return has(v) ? v : 1; }
function ammoPen(cal, type) {
  if (S.penSet[cal + "_" + type]) return num(get("rounds", cal + "_" + type, "penSet"));
  return num(get("calibres", cal, "pen")) + num(get("types", type, "penAdd"));
}
const calRef = (cal) => avg(get("calibres", cal, "refLo"), get("calibres", cal, "refHi"));
// data-ammo.js spreadFloor / spreadMult: buckshot and birdshot lose damage past spreadFull tiles (spreadDrop a tile), down
// to spreadMin or a .22's hit over the load's own (SPREAD_FLOOR), the higher.
const refHit = (cal, type) => calRef(cal) * tval(type, "soft");
function spreadFloor(type, cal) {
  const min = get("types", type, "spreadMin"), own = cal ? refHit(cal, type) : 0, low = refHit(S.spreadFloor.cal, S.spreadFloor.type);
  return Math.min(1, Math.max(has(min) ? min : 0, own > 0 ? low / own : 0));
}
function spreadMult(type, dist, cal) {
  const full = get("types", type, "spreadFull"), drop = get("types", type, "spreadDrop");
  if (!has(full) || !(has(drop) && drop > 0) || !(dist > full)) return 1;
  return Math.max(spreadFloor(type, cal), Math.min(1, 1 - (dist - full) * drop));
}
// ladder.js hitDamage: ac null = no armour (× soft / dmg), else the piece's expected multiplier (new: condition 1);
// dist: at that range (shot that spreads).
function hitDamage(cal, type, ac, base, past, dist) {
  const d = tval(type, "dmg"), soft = tval(type, "soft");
  const b = base == null ? calRef(cal) : base;
  const rr = S.reach[cal];
  const raw = b * d * (past && rr ? rr.dmg : 1) * (dist != null ? spreadMult(type, dist, cal) : 1);
  if (ac == null) return raw * (soft / d);
  return raw * pieceMult(ammoPen(cal, type), ac, 1);
}
const tierFind = (tier) => num(get("rarity", tier, "find"));
const gunFind = (tier) => num(get("rarity", tier, "gunFind"));
const glob = (k) => num(get("globals", k, "value"));
// data-ammo.js roundValue / ROUND_SUPPLIES value (a launcher round: LAUNCH_VALUE).
function roundValue(cal, type) { const v = get("rounds", cal + "_" + type, "value"); return has(v) ? v : num(get("calibres", cal, "value")) * tval(type, "value"); }
function supplyValue(cal, type) { const lv = S.launchValue["a_" + cal + "_" + type]; return lv != null ? lv : Math.round(roundValue(cal, type) * 1000) / 1000; }
// data-stacks.js retailBox
function retailBox(cal, type) {
  const own = get("boxes", cal + "_" + type, "n"), calRow = get("boxes", cal, "n");
  if (has(own) && own) return own;
  if (has(calRow) && calRow) return calRow;
  const kg = num(get("calibres", cal, "kg")), cls = S.loadClass[cal] || "";
  if (/ga$/.test(cal) || cls === "shotgun") return type === "buck" ? 10 : type === "slug" || type === "beanbag" ? 5 : 25;
  if (kg > 0 && kg < 0.006) return 100;
  if (kg > 0.06) return 10;
  if (cls === "pistol" || (kg > 0 && kg < 0.022 && cls !== "rifle")) return type === "hp" || type === "plusp" ? 20 : 50;
  return 20;
}
// data-ammo.js boxes: a box's rounds, weight and worth.
function box(cal, type) {
  const n = retailBox(cal, type), kg = num(get("calibres", cal, "kg"));
  const lv = S.launchValue["a_" + cal + "_" + type];
  const first = S.calBox[cal];
  const same = !(n > 0) || n === first;
  const per = same ? (lv != null ? lv : roundValue(cal, type)) : supplyValue(cal, type);
  const m = same ? first : n;
  return { n: m, kg: Math.round((kg * m + 0.05) * 100) / 100, value: Math.max(1, Math.round(per * m)) };
}
function mixWeight(theme, cal, type) {
  const c = get("themeCals", cal, theme), t = get("themeTypes", type, theme);
  return Math.round(num(c) * tierFind(get("rounds", cal + "_" + type, "tier")) * (has(t) ? t : 1) * 100) / 100;
}
// custompoints.js itemPoints (a new item with its factory parts) and the picked gun with its rounds (slotPoints).
function itemPoints(table, k) {
  const v = num(get(table, k, "value")) + num(S.fitValue[k]);
  return Math.max(1, Math.round(v / glob("CUSTOM_POINTS.VALUE") + num(get(table, k, "power")) * glob("CUSTOM_POINTS.POWER")));
}
function supplyPoints(v) { return v > 0 ? Math.ceil(v / glob("CUSTOM_POINTS.SUPPLY_VALUE") - 1e-9) : 0; }
function gunKit(k) {
  const cal = S.kitCal[k];
  if (cal) return supplyPoints(supplyValue(cal, S.calBase[cal]) * Math.max(1, num(get("guns", k, "cap")) || 1) * glob("START_GEAR.LOADS"));
  return supplyPoints(num(S.extrasValue[k]));
}
const gunAvg = (k) => avg(get("guns", k, "dmgLo"), get("guns", k, "dmgHi"));
const gunHit = (k, ac, past) => { const cal = S.gunCal[k]; return cal && S.calBase[cal] ? hitDamage(cal, S.calBase[cal], ac, gunAvg(k), past) : (ac == null && !past ? gunAvg(k) : null); };
const per = (a, b) => (has(a) && b > 0 ? a / b : null);
const CALC = {
  guns: {
    findW: (k) => (get("guns", k, "rarity") ? gunFind(get("guns", k, "rarity")) : null),
    dmgAvg: (k) => gunAvg(k),
    calRef: (k) => (S.gunCal[k] && S.ladder[S.gunCal[k]] != null ? calRef(S.gunCal[k]) : null),
    band: (k) => { const c = S.gunCal[k]; return c && S.ladder[c] != null && calRef(c) > 0 ? gunAvg(k) / calRef(c) : null; },
    hitBare: (k) => { const v = gunHit(k, null, false); return v == null ? null : r1(v); },
    hitVest: (k) => { const v = gunHit(k, 2, false); return v == null ? null : r1(v); },
    hitPlate: (k) => { const v = gunHit(k, 4, false); return v == null ? null : r1(v); },
    hitPast: (k) => (S.reach[S.gunCal[k]] ? r1(gunHit(k, null, true)) : null),
    hitFar: (k) => { const cal = S.gunCal[k], t = cal && S.calBase[cal]; return t && S.ladder[cal] != null && spreadMult(t, S.far, cal) < 1 ? r1(hitDamage(cal, t, null, gunAvg(k), false, S.far)) : null; },
    shotsPerMag: (k) => { const c = get("guns", k, "cap"), a = get("guns", k, "ammo"); return has(c) && c > 0 ? Math.floor(c / Math.max(1, num(a))) : null; },
    perReload: (k) => { const n = get("feeds", k, "perReload"); return has(n) ? n : null; },
    fillReloads: (k) => { const n = get("feeds", k, "perReload"), c = get("guns", k, "cap"); return has(n) && n > 0 && has(c) ? Math.ceil(c / n) : null; },
    loadedKg: (k) => { const cal = S.gunCal[k]; const w = get("guns", k, "weight"); if (!has(w)) return null; return r2(w + (cal && S.calBase[cal] ? num(get("guns", k, "cap")) * num(get("calibres", cal, "kg")) : 0)); },
    dmgPerKg: (k) => { const h = gunHit(k, null, false); return per(h, num(get("guns", k, "weight"))); },
    valuePerDmg: (k) => { const h = gunHit(k, null, false); return h > 0 && has(get("guns", k, "value")) ? num(get("guns", k, "value")) / h : null; },
    points: (k) => (S.item[k] ? itemPoints("guns", k) : null),
    pointsKit: (k) => (S.item[k] ? itemPoints("guns", k) + gunKit(k) : null),
  },
  melee: {
    dmgAvg: (k) => avg(get("melee", k, "dmgLo"), get("melee", k, "dmgHi")),
    dmgPerKg: (k) => per(avg(get("melee", k, "dmgLo"), get("melee", k, "dmgHi")), num(get("melee", k, "weight"))),
    points: (k) => (S.item[k] ? itemPoints("melee", k) : null),
  },
  mags: {
    loadedKg: (k) => r2(num(get("mags", k, "kg")) + num(get("mags", k, "cap")) * num(get("calibres", S.magCal[k], "kg"))),
    valuePerRound: (k) => per(get("mags", k, "value"), num(get("mags", k, "cap"))),
  },
  feeds: {
    fillReloads: (k) => { const n = get("feeds", k, "perReload"), c = get("guns", k, "cap"); return has(n) && n > 0 && has(c) ? Math.ceil(c / n) : null; },
  },
  calibres: {
    refAvg: (k) => (S.ladder[k] != null ? calRef(k) : null),
    rung: (k) => (S.ladder[k] != null ? r1(hitDamage(k, S.calBase[k], null)) : null),
    vest: (k) => (S.ladder[k] != null ? r1(hitDamage(k, S.calBase[k], 2)) : null),
    plate: (k) => (S.ladder[k] != null ? r1(hitDamage(k, S.calBase[k], 4)) : null),
  },
  rounds: {
    findW: (k) => tierFind(get("rounds", k, "tier")),
    pen: (k) => { const [c, t] = S.split[k]; return ammoPen(c, t); },
    bare: (k) => { const [c, t] = S.split[k]; return S.ladder[c] != null ? r1(hitDamage(c, t, null)) : null; },
    vest: (k) => { const [c, t] = S.split[k]; return S.ladder[c] != null ? r1(hitDamage(c, t, 2)) : null; },
    plate: (k) => { const [c, t] = S.split[k]; return S.ladder[c] != null ? r1(hitDamage(c, t, 4)) : null; },
    past: (k) => { const [c, t] = S.split[k]; return S.ladder[c] != null && S.reach[c] ? r1(hitDamage(c, t, null, null, true)) : null; },
    far: (k) => { const [c, t] = S.split[k]; return S.ladder[c] != null && spreadMult(t, S.far, c) < 1 ? r1(hitDamage(c, t, null, null, false, S.far)) : null; },
    boxN: (k) => { const [c, t] = S.split[k]; return box(c, t).n; },
    boxKg: (k) => { const [c, t] = S.split[k]; return box(c, t).kg; },
    boxValue: (k) => { const [c, t] = S.split[k]; return box(c, t).value; },
    supplyValue: (k) => { const [c, t] = S.split[k]; return supplyValue(c, t); },
    valuePerDmg: (k) => { const [c, t] = S.split[k]; if (S.ladder[c] == null) return null; const h = hitDamage(c, t, null); return h > 0 ? roundValue(c, t) / h * 100 : null; },
    handValue: (k) => (S.hand[k] ? Math.round(roundValue(S.split[k][0], S.split[k][1]) * glob("HAND_VALUE") * 1000) / 1000 : null),
    mixAll: (k) => { const [c, t] = S.split[k]; let s = 0; for (const th of S.themes) s += mixWeight(th, c, t); return r2(s); },
  },
  bulk: {
    fullKg: (k) => r2(num(get("bulk", k, "empty")) + num(get("bulk", k, "cap")) * num(get("calibres", "556", "kg"))),
    fullValue: (k) => Math.round(num(get("bulk", k, "value")) + num(get("bulk", k, "cap")) * supplyValue("556", "fmj")),
  },
};
for (const th of S.themes) CALC.rounds["mix_" + th] = (k) => { const [c, t] = S.split[k]; return mixWeight(th, c, t); };
`;

// The patch the page exports and reads back (shared with tools/balancesheettest.js): edits { "table|key|field": to },
// base(table, key, field) the sheet's own value, editable(table, key, field).
export const PAGE_PATCH = String.raw`
function buildPatch(D, edits, rarityOrder, base) {
  const changes = Object.keys(edits).sort().map((id) => {
    const [table, key, field] = id.split("|");
    const from = base(table, key, field);
    return { table, key, field, from: from === undefined ? null : from, to: edits[id] };
  });
  return { version: D.version, generatedFrom: D.generatedFrom, exportedAt: new Date().toISOString(), changes, rarityOrder: rarityOrder.slice() };
}
function readPatch(D, p, editable, base) {
  if (!p || typeof p !== "object" || !Array.isArray(p.changes)) return { error: "Not a balance patch (no changes list)." };
  if (p.version !== D.version) return { error: "Patch version " + p.version + ", this sheet reads version " + D.version + "." };
  const same = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b);
  const edits = {};
  let applied = 0, skipped = 0, stale = 0;
  for (const ch of p.changes) {
    if (!ch || !editable(ch.table, ch.key, ch.field)) { skipped++; continue; }
    const b = base(ch.table, ch.key, ch.field);
    if (!same(ch.from === undefined ? null : ch.from, b === undefined ? null : b)) stale++;
    if (!same(ch.to, b)) { edits[ch.table + "|" + ch.key + "|" + ch.field] = ch.to; applied++; }
  }
  const tiers = D.rarityOrder;
  const order = Array.isArray(p.rarityOrder) && p.rarityOrder.length === tiers.length && p.rarityOrder.every((x) => tiers.includes(x)) ? p.rarityOrder.slice() : null;
  return { edits, order, applied, skipped, stale };
}
`;

// ---------- collecting ----------
const imp = (root, m) => import(pathToFileURL(join(root, "src/sim", m)).href);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const same = (a, b) => (isNum(a) && isNum(b) ? Math.abs(a - b) < 1e-9 : a === b);
const list = (a) => (Array.isArray(a) ? a.join(", ") : "");

/** Every table of the sheet, from the game's modules under `root`. */
export async function collect(root = PROTO) {
  const [{ WEAPONS, KITS }, { GEAR, SUPPLIES }, A, DG, DK, DS, DM, GM, MG, LD, AR, CP, SG, LT, GF, INV, VAL] = await Promise.all([
    imp(root, "combat.js"), imp(root, "data.js"), imp(root, "data-ammo.js"), imp(root, "data-guns.js"), imp(root, "data-kit.js"),
    imp(root, "data-stacks.js"), imp(root, "data-gunmods.js"), imp(root, "gunmods.js"), imp(root, "mags.js"), imp(root, "ladder.js"),
    imp(root, "armour.js"), imp(root, "custompoints.js"), imp(root, "startgear.js"), imp(root, "loot.js"), imp(root, "gunfinds.js"),
    imp(root, "inventory.js"), imp(root, "valuation.js"),
  ]);
  const AM = await imp(root, "ammo.js");
  const GD = await imp(root, "gundist.js"); // the gun distribution: which gun each source yields (data-guns.js GUN_CLASS, GUN_SOURCES)
  const { CALIBERS, AMMO_TYPES, CAL_DMG, LADDER, RARITY, RARITY_NAME, RARITY_FIND, ROUND_ECON, THEME_CALS, THEME_TYPES, ROUND_SUPPLIES, LAUNCH_VALUE, LOAD_CLASS, HAND_SUPPLIES, ammoKey } = A;
  const { GUN_RARITY, ARSENAL_FINDS, ARSENAL_GEAR, FACTORY_FIT, TRUCK_GEAR } = DG;
  const { MAGAZINES, INTERNAL, CLIPS } = DK;
  const { RETAIL_BOX, BULK, BULK_FINDS } = DS;
  const { PLATFORMS } = DM;
  const { SHELLS, standardMag, magFitsGun } = MG;
  const { SITE_TAGS, AREA_TAGS, ITEM_TAGS } = LT;
  const { ROUND_REACH } = GM;

  // ---- static data for the page's formulas ----
  const calOfGun = (k) => (WEAPONS[k] && WEAPONS[k].cal) || null;
  const S = {
    AR: { ...AR.AR, BLUNT: [...AR.AR.BLUNT] },
    reach: Object.fromEntries(Object.entries(ROUND_REACH).map(([c, r]) => [c, { reach: r.reach, dmg: r.dmg ?? 1 }])),
    penSet: {}, split: {}, hand: {}, launchValue: { ...LAUNCH_VALUE }, loadClass: { ...LOAD_CLASS },
    calBox: Object.fromEntries(Object.entries(CALIBERS).map(([c, d]) => [c, d.box])),
    calBase: Object.fromEntries(Object.entries(CALIBERS).map(([c, d]) => [c, d.base])),
    ladder: Object.fromEntries(LADDER.ORDER.map((c, i) => [c, i + 1])),
    far: LD.FAR, // ladder.js: the range of the "at range" columns (shot that spreads)
    spreadFloor: { ...A.SPREAD_FLOOR }, // data-ammo.js: shot never hits for less than this round
    gunCal: {}, kitCal: {}, magCal: {}, fitValue: {}, extrasValue: {}, item: {}, themes: THEMES,
  };
  const tree = new SourceTree(root);
  const tables = [];
  // Calibres in the ladder's order, then the rest (object keys like "308" would otherwise come first).
  const CAL_LIST = [...LADDER.ORDER.filter((c) => CALIBERS[c]), ...Object.keys(CALIBERS).filter((c) => !LADDER.ORDER.includes(c))];
  /** A table: rows of { key, v: { col: value } }, the editable cells worked out from FIELDS. */
  function table(id, title, cols, rows, o = {}) {
    for (const r of rows) {
      r.ed = {}; // col → "file:line" (editable) or "+file:line" (absent: an edit adds it there)
      for (const c of cols) {
        const src = fieldSrc(id, r.key, c.id);
        if (!src) continue;
        c.src = true;
        let loc = null;
        try { loc = tree.locate(src.reg, src.path); } catch { loc = null; }
        if (!loc) continue;
        if (loc.insert) { if (r.v[c.id] == null && insertable(id, c.id) && !r.noInsert) r.ed[c.id] = `+${loc.file.replace("src/sim/", "")}:${tree.lineOf(loc.file, loc.parentOpen)}`; continue; }
        if (loc.ok && same(loc.value, r.v[c.id])) r.ed[c.id] = `${loc.file.replace("src/sim/", "")}:${tree.lineOf(loc.file, loc.start)}`;
      }
    }
    tables.push({ id, title, cols, rows, ...o });
  }
  const C = (id, label, type = "num", o = {}) => ({ id, label, type, ...o });
  const live = { calc: "live" }, after = { calc: "after" }, hide = { hide: true };

  // ---- guns ----
  const kitsOf = (k) => {
    const out = [];
    for (const [kind, kit] of Object.entries(KITS)) {
      const n = ["weapons", "strong", "loot"].map((f) => (kit[f] || []).filter((x) => x === k).length);
      if (n.some((x) => x)) out.push(`${kind} ${["w", "s", "l"].map((f, i) => (n[i] ? `${f}${n[i]}` : "")).filter(Boolean).join("")}`);
    }
    return out.join("; ");
  };
  const trucksOf = (k) => Object.entries(TRUCK_GEAR).flatMap(([t, l]) => l.filter(([x]) => x === k).map(([, p]) => `${t} ${(p * 100).toFixed(1)}%`)).join("; ");
  // The extra-gun rolls (gunfinds.js): each place's chance × the gun's share of its source's pool (gundist.js:
  // site:<type>, area:<type>, trader:<type>, stash:<table>).
  const PLACE_SRC = { site: (x) => `site:${x}`, area: (x) => `area:${x}`, wares: (x) => `trader:${x}`, stash: (x) => `stash:${x}` };
  const placeRows = [];
  const gunPlaces = {};
  for (const [kind, srcOf] of Object.entries(PLACE_SRC)) {
    for (const [place, p] of Object.entries(ARSENAL_FINDS[kind])) {
      const pool = GD.gunsFrom(srcOf(place));
      const tot = Object.values(pool).reduce((a, b) => a + b, 0);
      const top = Object.entries(pool).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g, w]) => `${g} ${tot ? Math.round((w / tot) * 100) : 0}%`).join(", ");
      placeRows.push({ key: `${kind}:${place}`, v: { kind, place, chance: p, pool: Object.keys(pool).length, top } });
      for (const [g, w] of Object.entries(pool)) (gunPlaces[g] = gunPlaces[g] || []).push({ at: `${kind}:${place}`, p: tot ? (w / tot) * p : 0 });
    }
  }
  const gunKeys = Object.keys(WEAPONS).filter((k) => { const w = WEAPONS[k]; return w && !w.melee && !w.acid && Array.isArray(w.dmg); });
  const gunRows = [];
  for (const k of gunKeys) {
    const w = WEAPONS[k], d = GEAR[k] || null, cal = calOfGun(k);
    S.gunCal[k] = cal;
    if (d) {
      S.item[k] = 1;
      const it = INV.startKit(INV.newItem(k, 1));
      S.fitValue[k] = Math.round((VAL.itemValue(it) - d.value) * 1e6) / 1e6;
      const kc = AM.calOf(k); // the game's rule for a picked gun's rounds (custompoints.js gunExtras; launchers, bows: their own)
      if (kc) S.kitCal[k] = kc;
      else {
        const ex = CP.gunExtras(k);
        S.extrasValue[k] = Object.entries(ex).reduce((a, [sk, n]) => a + ((SUPPLIES[sk] ? SUPPLIES[sk].value : ROUND_SUPPLIES[sk] ? ROUND_SUPPLIES[sk].value : 0) * n), 0);
      }
    }
    const shell = SHELLS.GUNS[k];
    const internal = INTERNAL[k];
    const mags = Object.keys(MAGAZINES).filter((m) => magFitsGun(k, m));
    const std = standardMag(k);
    const clips = Object.entries(CLIPS).filter(([, c]) => c.weapons.includes(k)).map(([ck, c]) => `${ck} (${c.n})`);
    const feed = w.mount || w.mounted ? "belt (mounted)" : w.launcher ? (w.oneShot ? "one shot" : w.cap > 1 ? "cylinder" : "single") : shell ? `shells: ${shell}` : internal ? "internal" : mags.length ? "box magazine" : w.arrows ? "arrows" : "-";
    const places = (gunPlaces[k] || []).filter((x) => x.p > 0).sort((a, b) => b.p - a.p);
    const v = {
      name: (d && d.name) || w.name, cat: (d && d.cat) || (w.mount || w.mounted ? "mounted" : "-"), platform: GM.platformOf(k) || "", kind: GM.gunCategory ? GM.gunCategory(k) || "" : "",
      cal: cal || (w.arrows ? "arrows" : ""), alsoTakes: (AM.gunCalsOf ? AM.gunCalsOf(k) : []).filter((c) => c !== cal).join(", "), rarity: GUN_RARITY[k] ?? null,
      gunClass: DG.GUN_CLASS && DG.GUN_CLASS[k] ? DG.GUN_CLASS[k].join(" ") : null, added: DG.GUN_ADDED ? DG.GUN_ADDED[k] ?? null : null,
      dmgLo: w.dmg[0], dmgHi: w.dmg[1], opt: w.opt ?? null, fall: w.fall ?? null, aim: w.aim ?? null, close: w.close ?? null,
      ammo: w.ammo ?? null, noise: w.noise ?? null, cap: w.cap ?? null, rel: w.rel ?? null, pierce: w.pierce ?? null,
      brace: typeof w.brace === "number" ? w.brace : null, heavyMob: w.heavy ? w.heavy.mob : null, heavyBrace: w.heavy ? w.heavy.brace : null,
      singleRounds: w.modes && w.modes.single ? w.modes.single.rounds : null,
      burstRounds: w.modes && w.modes.burst ? w.modes.burst.rounds : null, burstAim: w.modes && w.modes.burst ? w.modes.burst.aim : null,
      autoRounds: w.modes && w.modes.auto ? w.modes.auto.rounds : null, autoAim: w.modes && w.modes.auto ? w.modes.auto.aim : null,
      reach: cal && ROUND_REACH[cal] ? ROUND_REACH[cal].reach : null,
      feed, perReload: internal ?? null, stdMag: std || "", magsFit: mags.join(", "), magCount: mags.length, clips: clips.join(", "),
      value: d ? d.value : null, weight: d ? d.weight ?? null : null, power: d ? d.power ?? null : null, req: d ? d.req ?? null : null,
      gearNoise: d ? d.noise ?? null : null, dur: d ? d.dur ?? null : null,
      slots: (() => { try { return GM.baseSlots(k).join(", "); } catch { return ""; } })(),
      allSlots: (() => { try { return GM.reachableSlots ? GM.reachableSlots(k).join(", ") : ""; } catch { return ""; } })(),
      slotParts: (() => { try { const by = GM.partsBySlot ? GM.partsBySlot(k) : {}; return Object.entries(by).map(([s, ps]) => `${s}: ${ps.filter((x) => !MAGAZINES[x]).join("/") || "magazines"}`).join("; "); } catch { return ""; } })(),
      slotRule: DM.WEAPON_SLOTS && DM.WEAPON_SLOTS[k] ? Object.entries(DM.WEAPON_SLOTS[k]).map(([f, v]) => `${f}: ${Array.isArray(v) ? v.join("/") : Object.entries(v).map(([s, l]) => `${s}=${l.join("/")}`).join(" ")}`).join("; ") : "",
      builtin: PLATFORMS[GM.platformOf(k)] && PLATFORMS[GM.platformOf(k)].builtin ? Object.values(PLATFORMS[GM.platformOf(k)].builtin).join(", ") : "",
      factory: (FACTORY_FIT[k] || []).map(([p, parts]) => `${Math.round(p * 100)}% ${parts.join("/")}`).join("; "),
      sniper: !!w.sniper, launcher: w.launcher || "",
      tags: list(ITEM_TAGS[k]), kits: kitsOf(k), trucks: trucksOf(k), arsenal: !!ARSENAL_GEAR[k],
      bestPlace: places[0] ? `${places[0].at} ${(places[0].p * 100).toFixed(2)}%` : "", places: places.length || null,
    };
    gunRows.push({ key: k, v, ...(d ? {} : { noInsert: true }) });
  }
  table("guns", "Guns", [
    C("name", "Name", "text"), C("cat", "Category", "text"), C("platform", "Platform", "text"), C("kind", "Kind", "text", { hide: true, desc: "data-gunmods.js PLATFORMS cat: its CATEGORIES row (the slots that kind never has)" }), C("cal", "Calibre", "text"),
    C("alsoTakes", "Also takes", "text", { desc: "Other calibres its chamber takes (data-ammo.js CAL_ACCEPTS, a gun's own cals): a 5.56 gun .223, a .357 .38 Special" }),
    C("rarity", "Rarity", "tier", { desc: "data-guns.js GUN_RARITY" }), C("findW", "Find weight", "num", { ...live, desc: "ARSENAL_FINDS.FIND_W of its tier (every gun source's rarity weight: gundist.js)" }),
    C("gunClass", "Class", "text", { hide: true, desc: "data-guns.js GUN_CLASS: its uses (civilian hunting police military special makeshift surplus) and era (old coldwar modern), space-separated; the gun distribution's sources draw by them" }),
    C("added", "Added", "text", { hide: true, desc: "data-guns.js GUN_ADDED (YYYY-MM-DD): on or after GUN_NEWNESS.from the extra-gun rolls weigh it × GUN_NEWNESS.mult" }),
    C("dmgLo", "Dmg lo"), C("dmgHi", "Dmg hi"), C("dmgAvg", "Dmg avg", "num", live), C("calRef", "Calibre ref", "num", { ...live, desc: "data-ammo.js CAL_DMG average" }),
    C("band", "Band", "pct", { ...live, desc: "Gun avg ÷ calibre ref (LADDER.BAND keeps it 85–115%)" }),
    C("hitBare", "Hit: none", "num", { ...live, desc: "Mean hit with the calibre's base round, no armour (ladder.js gunHit)" }),
    C("hitVest", "Hit: vest AC2", "num", live), C("hitPlate", "Hit: plate AC4", "num", live),
    C("hitPast", "Hit past reach", "num", { ...live, desc: "Light rounds beyond ROUND_REACH (× 0.85)", hide: true }), C("reach", "Round reach", "num", hide),
    C("hitFar", `Hit at ${LD.FAR} tiles`, "num", { ...live, desc: "Shot that spreads (buckshot, birdshot): the base round's hit at this range (data-ammo.js spreadMult)", hide: true }),
    C("opt", "Best range"), C("fall", "Fall-off"), C("aim", "Aim"), C("close", "Close"), C("ammo", "Rounds/shot"), C("noise", "Noise"),
    C("cap", "Capacity"), C("rel", "Jam %/shot"), C("shotsPerMag", "Shots/load", "num", live),
    C("feed", "Feed", "text"), C("perReload", "Rounds/reload", "num", { ...live, desc: "data-kit.js INTERNAL: rounds a Reload puts in (internal magazines; edit on the Magazines tab)" }),
    C("fillReloads", "Reloads to fill", "num", live), C("stdMag", "Standard mag", "text"), C("magCount", "Mags fit"), C("magsFit", "Magazines that fit", "text", hide), C("clips", "Clips", "text", hide),
    C("singleRounds", "Single rds", "num", hide), C("burstRounds", "Burst rds"), C("burstAim", "Burst aim"), C("autoRounds", "Auto rds"), C("autoAim", "Auto aim"),
    C("heavyMob", "Heavy: move", "num", hide), C("heavyBrace", "Heavy: brace", "num", hide), C("brace", "Moved penalty", "num", hide), C("pierce", "Pierce", "num", hide),
    C("value", "Value"), C("weight", "Weight kg"), C("power", "Power"), C("req", "Needs Shooting"), C("gearNoise", "Item noise", "num", hide), C("dur", "Durability"),
    C("loadedKg", "Loaded kg", "num", { ...live, desc: "Weight + capacity × the calibre's round kg" }),
    C("dmgPerKg", "Dmg/kg", "num", live), C("valuePerDmg", "Value/dmg", "num", { ...live, hide: true }),
    C("points", "Points", "num", { ...live, desc: "Customize points (custompoints.js itemPoints: worth with factory parts ÷ 6 + power × 0.5)" }),
    C("pointsKit", "Points + rounds", "num", { ...live, desc: "Picked in the hands: the gun and 3 loads of its base round (slotPoints)" }),
    C("slots", "Attachment slots", "text", { hide: true, desc: "Open on the bare gun (data-gunmods.js PLATFORMS slots, CATEGORIES never, WEAPON_SLOTS)" }),
    C("allSlots", "All slots", "text", { hide: true, desc: "With the mounts and rails that fit it (a scope mount's sight, a rail's foregrip, light and bipod)" }),
    C("slotParts", "Parts by slot", "text", { hide: true, desc: "Every part that fits, by slot (magazines: the Magazines tab)" }),
    C("slotRule", "Own slot rule", "text", { hide: true, desc: "data-gunmods.js WEAPON_SLOTS: off / on / parts for this gun" }), C("builtin", "Built in", "text", hide), C("factory", "Factory parts", "text", hide),
    C("tags", "Loot tags", "text", hide), C("kits", "AI kits (w/s/l)", "text", hide), C("trucks", "Army trucks", "text", hide),
    C("bestPlace", "Best find place", "text", { ...after, hide: true, desc: "The extra-gun rolls (gunfinds.js): place chance × the gun's share of its source's pool (gundist.js)" }), C("places", "Find places", "num", { ...after, hide: true }),
  ], gunRows, { note: "Every ranged weapon in combat.js WEAPONS (with data-guns.js, data-nonlethal.js and the turrets). Hits use the calibre's base round." });

  // ---- arsenal find places ----
  table("places", "Where an extra gun is found", [
    C("kind", "Kind", "text"), C("place", "Place", "text"), C("chance", "Chance", "num", { desc: "ARSENAL_FINDS: a search hour (site), a raid container (area), a shelf a week (wares), a safe (stash)" }),
    C("pool", "Guns in pool"), C("top", "Top of pool (share)", "text", after),
  ], placeRows, { note: "data-guns.js ARSENAL_FINDS: the chance a roll finds an extra gun; which: the place's draws in the gun distribution (gundist.js; data-guns.js GUN_CLASS, GUN_SOURCES / PLACE_DRAWS), weighted by rarity (FIND_W)." });

  // ---- the gun distribution (gundist.js) ----
  {
    const drawRows = [];
    const addDraws = (kind, name, d, by) => { if (d && typeof d === "object") drawRows.push({ key: `${kind}|${name}`, v: { ...Object.fromEntries(GUN_USE_COLS.map((u) => [u, d[u] ?? null])), kind, name, by } }); };
    const users = (prof) => Object.entries(DG.GUN_SOURCES || {}).filter(([, s]) => s.draws === prof).map(([n]) => n).concat(Object.entries(DG.PLACE_DRAWS || {}).filter(([, d]) => d === prof).map(([n]) => n));
    for (const [n, d] of Object.entries(DG.GUN_DRAWS || {})) addDraws("profile", n, d, users(n).join(", "));
    for (const [n, d] of Object.entries(DG.THEME_DRAWS || {})) addDraws("theme", n, d, "places with this loot tag (no PLACE_DRAWS line)");
    for (const [n, d] of Object.entries(DG.PLACE_DRAWS || {})) addDraws("place", n, d, n);
    for (const [n, s] of Object.entries(DG.GUN_SOURCES || {})) addDraws("source", n, s.draws, n);
    table("gunDraws", "Gun draws by use", [C("kind", "Kind", "text"), C("name", "Name", "text"), ...GUN_USE_COLS.map((u) => C(u, u[0].toUpperCase() + u.slice(1))), C("by", "Used by", "text", { hide: true })], drawRows,
      { note: "data-guns.js GUN_DRAWS (profiles), THEME_DRAWS (a place's loot tags), PLACE_DRAWS, GUN_SOURCES (a source's own): the weight a source gives a gun of each use (a gun counts its best use) × its rarity's FIND_W. Empty: that use is not drawn (an edit adds it)." });
    const srcRows = Object.entries(DG.GUN_SOURCES || {}).map(([n, s]) => {
      const pool = GD.gunsFrom(n), tot = Object.values(pool).reduce((a, b) => a + b, 0);
      return { key: n, v: { draws: typeof s.draws === "string" ? s.draws : "(own)", band: s.band ?? null, guns: Object.keys(pool).length, top: Object.entries(pool).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g, w]) => `${g} ${tot ? Math.round((w / tot) * 100) : 0}%`).join(", ") } };
    });
    table("gunSources", "Gun sources", [C("draws", "Draws (profile)", "text"), C("band", "Power band"), C("guns", "Guns"), C("top", "Top of pool (share)", "text", after)], srcRows,
      { note: "data-guns.js GUN_SOURCES: a source's draw profile (GUN_DRAWS; \"(own)\": its own, in Gun draws) and, for a fighter's gun, the ± power band around the gun its kit's list gave." });
    const N = DG.GUN_NEWNESS || {};
    table("gunNewness", "New guns in the extra rolls", [C("mult", "× weight"), C("from", "Added from", "text")], [{ key: "newness", v: { mult: N.mult ?? null, from: N.from ?? null } }],
      { note: "data-guns.js GUN_NEWNESS: a gun added on or after `from` (GUN_ADDED) is × mult as likely in the extra-gun rolls (gunfinds.js: a search hour's, a raid container's, a shelf's, a safe's, a crawl room's); never in a list's swap or a kit." });
  }

  // ---- melee ----
  const meleeRows = [];
  for (const [k, w] of Object.entries(WEAPONS)) {
    if (!w || !w.melee || k === "claws") continue;
    const d = GEAR[k] || null;
    if (d) { S.item[k] = 1; S.fitValue[k] = Math.round((VAL.itemValue(INV.startKit(INV.newItem(k, 1))) - d.value) * 1e6) / 1e6; }
    meleeRows.push({ key: k, v: {
      name: (d && d.name) || w.name, cat: d ? d.cat : "-", mclass: w.mclass ?? null, dmgLo: w.dmg[0], dmgHi: w.dmg[1], meleeAim: w.meleeAim ?? null,
      quick: w.quick ?? null, bleed: w.bleed ?? null, stagger: w.stagger ?? null, reach: w.reach ?? null, throw: w.throw ?? null, takedown: w.takedown ?? null,
      stab: w.stab ?? null, chop: d ? d.chop ?? null : null, pry: d ? d.pry ?? null : null, value: d ? d.value : null, weight: d ? d.weight ?? null : null,
      power: d ? d.power ?? null : null, req: d ? d.req ?? null : null, dur: d ? d.dur ?? null : null, tags: list(ITEM_TAGS[k]), kits: kitsOf(k),
    } });
  }
  table("melee", "Melee weapons", [
    C("name", "Name", "text"), C("cat", "Category", "text"), C("mclass", "Class", "enum", { options: ["blade", "pierce", "chop", "blunt", "heavy"] }),
    C("dmgLo", "Dmg lo"), C("dmgHi", "Dmg hi"), C("dmgAvg", "Dmg avg", "num", live), C("meleeAim", "To hit"), C("quick", "Quick", "bool"),
    C("bleed", "Bleed"), C("stagger", "Stagger"), C("reach", "Reach"), C("throw", "Throw"), C("takedown", "Takedown"), C("stab", "Stab", "bool"),
    C("chop", "Chop"), C("pry", "Pry", "bool"), C("value", "Value"), C("weight", "Weight kg"), C("power", "Power"), C("req", "Needs Melee"), C("dur", "Durability"),
    C("dmgPerKg", "Dmg/kg", "num", live), C("points", "Points", "num", live), C("tags", "Loot tags", "text", hide), C("kits", "AI kits (w/s/l)", "text", hide),
  ], meleeRows, { note: "combat.js WEAPONS melee entries (with data-guns.js WEAPON_PATCH and data-blades.js) and their GEAR items." });

  // ---- gun attachments (the Attachments tab): every part but the magazines (Magazines tab) ----
  const partRows = Object.keys(GM.ATTACH).filter((k) => !GM.ATTACH[k].magCap && GEAR[k]).map((k) => {
    const a = GM.ATTACH[k], d = GEAR[k], pc = GM.partClass ? GM.partClass(k) : null;
    const fitGuns = gunKeys.filter((g) => GM.modFits(g, k));
    const brandOf = pc && pc.brandOf;
    return { key: k, v: {
      name: d.name, slot: a.slot, tier: pc ? pc.tier : "", rarity: pc ? pc.rarity : null, brandOf: brandOf || "",
      value: d.value ?? null, weight: d.weight ?? null, dur: d.dur ?? null,
      aim: a.aim ?? null, close: a.close ?? null, opt: a.opt ?? null, fall: a.fall ?? null, noise: a.noise ?? null, jam: a.jam ?? null,
      night: a.night ?? null, nightNear: a.nightNear ?? null, peq: a.peq ?? null, brace: a.brace ?? null, moving: a.moving ?? null, reload: a.reload ?? null, wt: a.wt ?? null, spread: a.spread ?? null,
      flags: [a.can ? "suppressor" : "", a.light ? "light" : "", a.flashless ? "flashless" : "", a.thermal ? "thermal" : "", a.launcher ? "launcher" : "", a.adds ? `adds ${a.adds.join("/")}` : ""].filter(Boolean).join(", "),
      brandValue: brandOf && GEAR[brandOf] ? GEAR[brandOf].value : null,
      fits: GM.fitsText ? GM.fitsText(k) : "", gunCount: fitGuns.length, guns: fitGuns.join(", "), tags: list(ITEM_TAGS[k]),
      look: a.look || "",
    } };
  });
  table("parts", "Attachments", [
    C("name", "Name", "text"), C("slot", "Slot", "text"), C("tier", "Tier", "text", { desc: "brand (a US / European maker's), civil, budget (a Chinese clone: cheaper, worse, wears out), makeshift" }),
    C("rarity", "Rarity", "tier", { desc: "data-gunmods.js PART_INFO / OLD_PART_CLASS: the catalogue's find weight (PART_FINDS.FIND_W)" }),
    C("value", "Value"), C("weight", "Weight kg"), C("dur", "Wears out in", "num", { desc: "A budget or makeshift part: fights (a muzzle device: shots)" }),
    C("aim", "Aim"), C("close", "Close"), C("opt", "Best range +"), C("fall", "Fall-off +"), C("noise", "Noise ×"), C("jam", "Jam ×"),
    C("nightNear", "Night aim ≤6"), C("night", "Night aim", "num", hide), C("peq", "IR aim (NVG)", "num", hide), C("brace", "Rested aim"), C("moving", "Moving aim"),
    C("reload", "Shells/reload +", "num", hide), C("wt", "Fitted kg", "num", hide), C("spread", "Shot full to +", "num", { desc: "A choke: + tiles of buckshot's full damage (data-ammo.js spreadMult)" }), C("flags", "Does", "text"),
    C("brandOf", "Copies", "text", { desc: "A budget clone: the part it copies (tools/gunslottest.js: never better, always cheaper)" }), C("brandValue", "Its value", "num", hide),
    C("gunCount", "Guns fit"), C("fits", "Fits", "text", hide), C("guns", "Guns it fits", "text", hide), C("tags", "Loot tags", "text", hide), C("look", "Drawn as", "text", hide),
  ], partRows, { note: "Gun attachments: gunmods.js LEGACY and data-gunmods.js MOD_ATTACH (numbers), MOD_GEAR / PART_INFO (items). Magazines: the Magazines tab." });

  // ---- magazines, internal feeds, clips ----
  const magRows = Object.entries(MAGAZINES).map(([k, m]) => {
    S.magCal[k] = m.cal;
    const fits = gunKeys.filter((g) => magFitsGun(g, k));
    return { key: k, v: { name: m.name, cal: m.cal, holds: (m.cals || [m.cal]).join(", "), onlyGuns: (m.guns || []).join(", "), plat: list(m.plat), cap: m.cap, kg: m.kg, value: m.value, aim: m.aim ?? null, jam: m.jam ?? null, pouch: m.pouch,
      guns: fits.join(", "), gunCount: fits.length, stdFor: fits.filter((g) => standardMag(g) === k).join(", ") } };
  });
  table("mags", "Magazines", [
    C("name", "Name", "text"), C("cal", "Calibre", "text"), C("holds", "Holds", "text", { desc: "MAGAZINES cals: the calibres it holds (STANAG: 5.56, .223, .300 BLK)" }), C("plat", "Platforms", "text"),
    C("onlyGuns", "Only for", "text", { desc: "MAGAZINES guns: only these guns of its platforms" }), C("cap", "Capacity"), C("kg", "Empty kg"), C("value", "Value"),
    C("aim", "Aim"), C("jam", "Jam ×"), C("pouch", "Pouch", "text"), C("loadedKg", "Loaded kg", "num", live), C("valuePerRound", "Value/round", "num", live),
    C("gunCount", "Guns fit"), C("guns", "Guns that take it", "text"), C("stdFor", "Standard for", "text"),
  ], magRows, { note: "data-kit.js MAGAZINES (one item per platform and size). A gun's own capacity is its WEAPONS cap (Guns tab)." });
  table("feeds", "Internal magazines", [
    C("name", "Gun", "text"), C("cal", "Calibre", "text"), C("cap", "Capacity"), C("perReload", "Rounds/reload"), C("fillReloads", "Reloads to fill", "num", live),
    C("shells", "Shotgun loading", "text"), C("clips", "Clips", "text"),
  ], Object.entries(INTERNAL).filter(([k]) => WEAPONS[k]).map(([k, n]) => ({ key: k, v: {
    name: (GEAR[k] && GEAR[k].name) || WEAPONS[k].name, cal: calOfGun(k), cap: WEAPONS[k].cap, perReload: n, shells: SHELLS.GUNS[k] || "",
    clips: Object.entries(CLIPS).filter(([, c]) => c.weapons.includes(k)).map(([ck, c]) => `${ck} (${c.n})`).join(", "),
  } })), { note: "data-kit.js INTERNAL (tubes, cylinders, fixed boxes: a Reload adds this many; a shotgun loads from the shells at hand, mags.js SHELLS). Edit the capacity on the Guns tab." });
  table("clips", "Clips and speedloaders", [C("weapons", "Guns", "text"), C("n", "Rounds at once"), C("pouch", "Pouch", "text")],
    Object.entries(CLIPS).map(([k, c]) => ({ key: k, v: { weapons: list(c.weapons), n: c.n, pouch: c.pouch } })), { note: "data-kit.js CLIPS: fill an internal magazine at once, once a fight." });

  // ---- calibres, types, rounds ----
  const gunsBy = {};
  for (const k of gunKeys) { const c = calOfGun(k); if (c) (gunsBy[c] = gunsBy[c] || []).push(k); }
  table("calibres", "Calibres", [
    C("name", "Name", "text"), C("ladder", "Ladder rung"), C("base", "Base round", "text"), C("types", "Types", "text"),
    C("refLo", "Ref dmg lo", "num", { desc: "data-ammo.js CAL_DMG" }), C("refHi", "Ref dmg hi"), C("refAvg", "Ref avg", "num", live),
    C("rung", "Base round: none", "num", live), C("vest", "Base round: vest", "num", live), C("plate", "Base round: plate", "num", live),
    C("kg", "Round kg"), C("pen", "Pen"), C("ad", "Armour wear"), C("value", "Fallback value", "num", { desc: "CALIBERS value: only for a round with no ROUND_ECON row" }),
    C("reach", "Reach (light rounds)"), C("gunCount", "Guns"), C("guns", "Guns", "text", hide),
  ], CAL_LIST.map((c) => [c, CALIBERS[c]]).map(([c, d]) => ({ key: c, v: {
    name: d.name, ladder: S.ladder[c] ?? null, base: d.base, types: list(d.types), refLo: CAL_DMG[c] ? CAL_DMG[c][0] : null, refHi: CAL_DMG[c] ? CAL_DMG[c][1] : null,
    kg: d.kg, pen: d.pen, ad: d.ad, value: d.value, reach: ROUND_REACH[c] ? ROUND_REACH[c].reach : null, gunCount: (gunsBy[c] || []).length, guns: (gunsBy[c] || []).join(", "),
  } })), { note: "data-ammo.js CALIBERS and CAL_DMG (the damage ladder: LADDER.ORDER)." });
  const typeCols = ["dmg", "soft", "penAdd", "value", "aim", "opt", "fallMult", "close", "noise", "jam", "ad", "spreadFull", "spreadDrop", "spreadMin"];
  table("types", "Ammo types", [
    C("name", "Name", "text"), ...typeCols.map((f) => C(f, { dmg: "Dmg ×", soft: "Soft ×", penAdd: "Pen +", value: "Value ×", aim: "Aim", opt: "Range", fallMult: "Fall-off ×", close: "Close", noise: "Noise ×", jam: "Jam ×", ad: "Armour wear",
      spreadFull: "Spread: full to (tiles)", spreadDrop: "Spread: lost a tile", spreadMin: "Spread: floor" }[f], "num", f.startsWith("spread") ? { desc: "Shot that spreads (data-ammo.js spreadMult): full damage out to this many tiles, then − this share a tile, never under the floor nor under a .22's hit (SPREAD_FLOOR)" } : {})),
    C("penBy", "Pen by calibre", "text"), C("flags", "Flags", "text"),
  ], Object.entries(AMMO_TYPES).map(([t, d]) => ({ key: t, v: {
    name: d.name, ...Object.fromEntries(typeCols.map((f) => [f, isNum(d[f]) ? d[f] : null])),
    penBy: d.pen ? Object.entries(d.pen).map(([c, p]) => `${c} ${p}`).join(", ") : "",
    flags: ["spread", "nonlethal", "launch", "revealsShooter"].filter((f) => d[f]).join(", ") + (d.overpen ? ` overpen ${Object.entries(d.overpen).map(([c, p]) => `${c} ${p}`).join(" ")}` : "") + (d.ignite ? ` ignite ${d.ignite}` : ""),
  } })), { note: "data-ammo.js AMMO_TYPES: a type's effect on its calibre's base round (multipliers; blank = none/1)." });
  const roundRows = [];
  for (const [cal, c] of CAL_LIST.map((c) => [c, CALIBERS[c]])) for (const type of c.types) {
    const k = `${cal}_${type}`, t = AMMO_TYPES[type] || {};
    S.split[k] = [cal, type];
    const explicit = !!(t.pen && t.pen[cal] != null);
    if (explicit) S.penSet[k] = 1;
    if (HAND_SUPPLIES[`a_${cal}_${type}_hand`]) S.hand[k] = 1;
    roundRows.push({ key: k, v: {
      name: `${c.name} ${t.name || type}`, cal, type, base: type === c.base, tier: ROUND_ECON[k] ? ROUND_ECON[k][0] : A.roundTier(cal, type), value: ROUND_ECON[k] ? ROUND_ECON[k][1] : null,
      penSet: explicit ? t.pen[cal] : null, kg: c.kg, nonlethal: !!t.nonlethal, launch: !!t.launch,
    } });
  }
  table("rounds", "Rounds (calibre × type)", [
    C("name", "Name", "text"), C("cal", "Calibre", "text"), C("type", "Type", "text"), C("base", "Base", "bool"),
    C("tier", "Rarity", "tier", { desc: "data-ammo.js ROUND_ECON [tier, value]" }), C("findW", "Find weight", "num", { ...live, desc: "RARITY_FIND of its tier" }),
    C("value", "Value/round", "num", { desc: "ROUND_ECON value per round" }), C("supplyValue", "Supply value", "num", { ...live, hide: true }),
    C("penSet", "Pen (set)", "num", { desc: "AMMO_TYPES pen for this calibre (blank: calibre pen + type pen +)" }), C("pen", "Pen", "num", live),
    C("bare", "Hit: none", "num", { ...live, desc: "ladder.js hitDamage, the calibre's reference gun" }), C("vest", "Hit: vest AC2", "num", live), C("plate", "Hit: plate AC4", "num", live),
    C("past", "Hit past reach", "num", { ...live, hide: true }), C("far", `Hit at ${LD.FAR} tiles`, "num", { ...live, desc: "Shot that spreads: unarmoured at this range (ladder.js far)" }),
    C("valuePerDmg", "Value per 100 dmg", "num", live),
    C("boxN", "Box rounds", "num", { ...live, desc: "data-stacks.js retailBox (Containers tab)" }), C("boxKg", "Box kg", "num", live), C("boxValue", "Box value", "num", live),
    C("handValue", "Handload value", "num", { ...live, hide: true }), C("mixAll", "Find mix: all places", "num", { ...live, desc: "Sum of AMMO_MIX weights over the 8 place themes" }),
    ...THEMES.map((th) => C(`mix_${th}`, `Mix: ${th}`, "num", { ...live, hide: true })),
    C("kg", "Round kg", "num", hide), C("nonlethal", "Less-lethal", "bool", hide), C("launch", "Launcher", "bool", hide),
  ], roundRows, { note: "Every calibre's types: data-ammo.js ROUND_ECON (rarity tier, value a round), the damage on the ladder and where they turn up (AMMO_MIX)." });
  const allCals = CAL_LIST.filter((c) => CALIBERS[c].common !== false);
  table("themeCals", "Where rounds turn up: calibre weight by place", [C("name", "Calibre", "text"), ...THEMES.map((th) => C(th, th))],
    allCals.map((c) => ({ key: c, v: { name: CALIBERS[c].name, ...Object.fromEntries(THEMES.map((th) => [th, THEME_CALS[th][c] ?? null])) } })),
    { note: "data-ammo.js THEME_CALS: a place's share of each calibre (blank: never there). × RARITY_FIND × THEME_TYPES = AMMO_MIX." });
  table("themeTypes", "Where rounds turn up: type factor by place", [C("name", "Type", "text"), ...THEMES.map((th) => C(th, th))],
    Object.keys(AMMO_TYPES).filter((t) => !AMMO_TYPES[t].launch).map((t) => ({ key: t, v: { name: AMMO_TYPES[t].name, ...Object.fromEntries(THEMES.map((th) => [th, THEME_TYPES[th][t] ?? null])) } })),
    { note: "data-ammo.js THEME_TYPES: × a type's weight at a place (blank = 1; 0 = never there)." });

  // ---- containers ----
  const boxUse = {};
  for (const [cal, c] of Object.entries(CALIBERS)) for (const type of c.types) {
    const row = RETAIL_BOX[`${cal}_${type}`] != null ? `${cal}_${type}` : RETAIL_BOX[cal] != null ? cal : null;
    if (row) (boxUse[row] = boxUse[row] || []).push(`${cal}_${type}`);
  }
  table("boxes", "Retail box sizes", [C("n", "Rounds a box"), C("uses", "Used by", "text")],
    Object.entries(RETAIL_BOX).map(([k, n]) => ({ key: k, v: { n, uses: (boxUse[k] || []).join(", ") || "(no such rounds yet)" } })),
    { note: "data-stacks.js RETAIL_BOX: a calibre_type row wins over the calibre's own row; no row: the class default (retailBox)." });
  table("bulk", "Bulk containers", [
    C("name", "Name", "text"), C("one", "Holds", "text"), C("cap", "Capacity"), C("empty", "Empty kg (BULK)"), C("weight", "Item weight"), C("value", "Empty value"),
    C("kindW", "Find kind weight"), C("fullKg", "Full kg (5.56)", "num", live), C("fullValue", "Full value (5.56 FMJ)", "num", live),
  ], Object.entries(BULK).map(([k, b]) => ({ key: k, v: { name: GEAR[k] ? GEAR[k].name : k, one: b.one, cap: b.cap, empty: b.empty, weight: GEAR[k] ? GEAR[k].weight : null, value: GEAR[k] ? GEAR[k].value : null, kindW: BULK_FINDS.KIND[k] ?? null } })),
    { note: "data-stacks.js BULK / BULK_GEAR / BULK_FINDS.KIND." });
  table("bulkFinds", "Bulk container finds by place", [C("chance", "Chance a container"), C("boxed", "Share boxed")],
    THEMES.map((th) => ({ key: th, v: { chance: BULK_FINDS.CHANCE[th] ?? null, boxed: BULK_FINDS.BOXED[th] ?? null } })),
    { note: "data-stacks.js BULK_FINDS.CHANCE (× the round's commonness) and BOXED." });
  const globalRows = [];
  for (const [k, [reg, path, label]] of Object.entries(GLOBALS)) {
    const loc = tree.locate(reg, path);
    globalRows.push({ key: k, v: { value: loc && loc.ok ? loc.value : null, label } });
  }
  table("globals", "Other numbers", [C("value", "Value"), C("label", "What it is", "text")], globalRows, { note: "Single numbers the sheet's formulas read (box stacks, reloads, Customize points)." });

  // ---- rarity ----
  const rarityRows = RARITY.map((t) => ({ key: t, v: { name: RARITY_NAME[t] || t, find: RARITY_FIND[t] ?? null, gunFind: ARSENAL_FINDS.FIND_W[t] ?? null } }));
  table("rarity", "Rarity tiers", [C("name", "Tier", "text"), C("find", "Round find weight"), C("gunFind", "Gun find weight")], rarityRows,
    { note: "data-ammo.js RARITY (order), RARITY_FIND (rounds), data-guns.js ARSENAL_FINDS.FIND_W (guns)." });

  return {
    version: SHEET_VERSION,
    generatedFrom: gitHead(root),
    generatedAt: new Date().toISOString(),
    rarityOrder: [...RARITY],
    tabs: [
      { id: "guns", title: "Guns", tables: ["guns", "places"] },
      { id: "gundist", title: "Gun distribution", tables: ["gunSources", "gunDraws", "gunNewness"] },
      { id: "mags", title: "Magazines", tables: ["mags", "feeds", "clips"] },
      { id: "parts", title: "Attachments", tables: ["parts"] },
      { id: "ammo", title: "Calibres & rounds", tables: ["rounds", "calibres", "types", "themeCals", "themeTypes"] },
      { id: "cont", title: "Containers & boxes", tables: ["boxes", "bulk", "bulkFinds", "globals"] },
      { id: "melee", title: "Melee", tables: ["melee"] },
    ],
    tables, S,
  };
}
export function gitHead(root = PROTO) {
  try { return execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "unknown"; }
}
/** The value of each [table, key, field] in a collected sheet. */
export function valuesOf(sheet, cells) {
  const byId = Object.fromEntries(sheet.tables.map((t) => [t.id, t]));
  return cells.map(([t, k, f]) => {
    if (t === "rarityOrder") return sheet.rarityOrder;
    const row = byId[t] && byId[t].rows.find((r) => r.key === k);
    return row ? row.v[f] ?? null : undefined;
  });
}

// ---------- the page ----------
export function renderHtml(sheet) {
  const css = readFileSync(join(HERE, "balancesheet.page.css"), "utf8");
  const js = readFileSync(join(HERE, "balancesheet.page.js"), "utf8");
  const data = JSON.stringify(sheet).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Broken State balance sheet</title>
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<script id="sheet-data" type="application/json">${data}</script>
<script id="sheet-calc">
${PAGE_PATCH}
function makeCalc(get, S) {
${PAGE_CALC}
return CALC;
}
</script>
<script id="sheet-app">
${js}
</script>
</body>
</html>
`;
}

// ---------- the command line ----------
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(opt("--root") || PROTO);
  const sheet = await collect(root);
  if (opt("--probe")) {
    const cells = JSON.parse(readFileSync(opt("--probe"), "utf8"));
    process.stdout.write(JSON.stringify(valuesOf(sheet, cells)));
  } else {
    const out = resolve(opt("--out") || join(PROTO, "..", "docs", "balance-sheet", "index.html"));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, renderHtml(sheet));
    const n = sheet.tables.reduce((a, t) => a + t.rows.length, 0);
    const ed = sheet.tables.reduce((a, t) => a + t.rows.reduce((b, r) => b + Object.keys(r.ed).length, 0), 0);
    console.log(`Balance sheet: ${out}\n  ${sheet.tables.length} tables, ${n} rows, ${ed} editable cells (from ${sheet.generatedFrom})`);
    for (const t of sheet.tables) console.log(`  ${t.id}: ${t.rows.length} rows, ${t.cols.length} columns, ${t.rows.reduce((b, r) => b + Object.keys(r.ed).length, 0)} editable`);
  }
}
