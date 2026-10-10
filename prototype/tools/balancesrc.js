// Where each balance number lives in the source (the balance sheet's editable cells, tools/balancesheet.js, and the
// patch they export, applied by tools/applybalance.js). A tiny JS-literal reader: it finds an object literal by the
// text that opens it (`export const WEAPONS = `), walks its properties down a path (["ar", "dmg", 0]) and returns the
// text span of the value there, so one number can be swapped in place without touching anything else in the file.
//
// A table that is merged from several literals (combat.js WEAPONS: its own literal, then data-guns.js GUN_WEAPONS /
// ARSENAL_WEAPONS, WEAPON_PATCH, data-nonlethal.js, data-blades.js, the turrets) is a list of scopes in the order the
// game applies them: a "replace" scope swaps the whole entry (Object.assign(WEAPONS, X)), a "patch" scope sets the
// fields it names (WEAPON_PATCH, GEAR_PATCH, the durability tables), a "default" scope only fills a field nobody set
// (data.js GEAR_DUR). The value the game ends up with comes from the last scope that sets it: that is where an edit goes.
// The sheet checks every editable cell: the literal found must equal the value the game has at run time, else the cell
// stays read-only (a number worked out by code).
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------- the literal reader ----------
const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
/** Skips whitespace and comments. */
export function skipWs(t, i) {
  for (;;) {
    while (i < t.length && isWs(t[i])) i++;
    if (t[i] === "/" && t[i + 1] === "/") { while (i < t.length && t[i] !== "\n") i++; continue; }
    if (t[i] === "/" && t[i + 1] === "*") { const e = t.indexOf("*/", i + 2); i = e < 0 ? t.length : e + 2; continue; }
    return i;
  }
}
// Past a string literal starting at i (its quote).
function skipString(t, i) {
  const q = t[i];
  i++;
  while (i < t.length) {
    const c = t[i];
    if (c === "\\") { i += 2; continue; }
    if (q === "`" && c === "$" && t[i + 1] === "{") { i = skipExpr(t, i + 2, "}") + 1; continue; }
    if (c === q) return i + 1;
    i++;
  }
  return i;
}
// The end of an expression from i: the index of the first top-level `,` `;` or closing bracket (or `stop`).
function skipExpr(t, i, stop = null) {
  let depth = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(t, i); continue; }
    if (c === "/" && (t[i + 1] === "/" || t[i + 1] === "*")) { i = skipWs(t, i); continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { if (depth === 0) return i; depth--; }
    else if (depth === 0 && (c === "," || c === ";")) return i;
    else if (depth === 0 && stop && c === stop) return i;
    i++;
  }
  return i;
}
/** The end of a value starting at i (exclusive), trailing spaces trimmed. */
export function valueEnd(t, i) {
  let e = skipExpr(t, i);
  while (e > i && isWs(t[e - 1])) e--;
  // a trailing comment on the same line inside the span (rare: `x: 1 // note` then a newline then `}`)
  const s = t.slice(i, e);
  const cut = s.search(/\s\/\/|\s\/\*/);
  if (cut >= 0 && !/["'`]/.test(s)) { e = i + cut; while (e > i && isWs(t[e - 1])) e--; }
  return e;
}
/** The properties of the object literal whose `{` is at `open`: [{ key, keyStart, start, end }] (spreads: key null). */
export function objectProps(t, open) {
  const out = [];
  let i = open + 1;
  for (;;) {
    i = skipWs(t, i);
    if (i >= t.length || t[i] === "}") return { props: out, close: i };
    if (t.startsWith("...", i)) { const e = skipExpr(t, i); out.push({ key: null, keyStart: i, start: i, end: e }); i = e; }
    else {
      let key, ks = i;
      if (t[i] === '"' || t[i] === "'") { const e = skipString(t, i); key = t.slice(i + 1, e - 1); i = e; }
      else { const m = /^[A-Za-z_$0-9][\w$]*/.exec(t.slice(i, i + 200)); if (!m) return { props: out, close: -1 }; key = m[0]; i += key.length; }
      i = skipWs(t, i);
      if (t[i] === ":") {
        const s = skipWs(t, i + 1);
        const e = valueEnd(t, s);
        out.push({ key, keyStart: ks, start: s, end: e });
        i = skipExpr(t, s);
      } else if (t[i] === "(") { i = skipExpr(t, i); } // a method: skipped
      else out.push({ key, keyStart: ks, start: ks, end: i, shorthand: true });
    }
    i = skipWs(t, i);
    if (t[i] === ",") i++;
  }
}
/** The elements of the array literal whose `[` is at `open`: [{ start, end }]. */
export function arrayElems(t, open) {
  const out = [];
  let i = open + 1;
  for (;;) {
    i = skipWs(t, i);
    if (i >= t.length || t[i] === "]") return { elems: out, close: i };
    const e = valueEnd(t, i);
    out.push({ start: i, end: e });
    i = skipExpr(t, i);
    i = skipWs(t, i);
    if (t[i] === ",") i++;
  }
}
/** A literal's value: number, string, boolean, null; arrays and objects of them. { ok, value }. */
export function literalValue(src) {
  const s = src.trim();
  if (/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return { ok: true, value: Number(s) };
  if (s === "true" || s === "false") return { ok: true, value: s === "true" };
  if (s === "null") return { ok: true, value: null };
  if (/^"([^"\\]|\\.)*"$/.test(s)) return { ok: true, value: JSON.parse(s) };
  if (/^'([^'\\]|\\.)*'$/.test(s)) return { ok: true, value: s.slice(1, -1).replace(/\\'/g, "'") };
  // A list of words (data-guns.js GUN_CLASS: ["hunting", "civilian", "coldwar"]): read and written as "hunting civilian coldwar".
  if (/^\[\s*("[^"\\]*"\s*(,\s*"[^"\\]*"\s*)*,?)?\]$/.test(s)) return { ok: true, value: JSON.parse(s.replace(/,\s*\]$/, "]")).join(" "), words: true };
  return { ok: false, value: undefined };
}
/** Walks `path` from the value at `start`: { start, end } of the value there; or { missing, parentOpen, key } when the
 * last step is absent from an object literal (an insert point); null when the path leaves the literals. */
export function walk(t, start, path) {
  let s = start;
  for (let n = 0; n < path.length; n++) {
    const step = path[n];
    if (t[s] === "{") {
      const { props } = objectProps(t, s);
      const p = [...props].reverse().find((x) => x.key === String(step)); // the last one wins, as in JS
      if (!p) return n === path.length - 1 && !props.some((x) => x.key === null) ? { missing: true, parentOpen: s, key: String(step) } : null;
      if (p.shorthand) return null;
      s = p.start;
    } else if (t[s] === "[" && Number.isInteger(step)) {
      const { elems } = arrayElems(t, s);
      if (!elems[step]) return null;
      s = elems[step].start;
    } else return null;
  }
  return { start: s, end: valueEnd(t, s) };
}

// ---------- the scopes ----------
const SIM = "src/sim/";
/** @param {string} file under src/sim @param {RegExp} open the text just before the literal @param {string} [mode] @param {any} [o] */
const S = (file, open, mode = "replace", o = {}) => ({ file: SIM + file, open, mode, ...o });
const one = (file, name) => [S(file, new RegExp(`export const ${name} = `))];
// Each registry: the scopes a table is built from, in the order the game applies them.
export const REG = {
  WEAPONS: [
    S("combat.js", /export const WEAPONS = /),
    S("data-guns.js", /export const GUN_WEAPONS = /),
    S("data-guns.js", /export const ARSENAL_WEAPONS = /),
    S("data-guns.js", /export const AR_WEAPONS = /),
    S("data-guns.js", /export const CALIBRE_WEAPONS = /),
    S("data-guns.js", /export const WEAPON_PATCH = /, "patch"),
    S("data-nonlethal.js", /export const NL_WEAPONS = /),
    S("data-blades.js", /export const BLADE_WEAPONS = /),
    S("combat.js", /export const TURRET_WEAPONS = /),
  ],
  GEAR: [
    S("data.js", /export const GEAR = /),
    S("data.js", /Object\.assign\(GEAR, (?=\{)/g),
    S("data-guns.js", /export const GUN_GEAR = /),
    S("data-guns.js", /const ROSTER_DUR = /, "patch", { flat: true, only: "dur" }),
    S("data-guns.js", /export const ARSENAL_GEAR = /),
    S("data-guns.js", /const ARSENAL_DUR = /, "patch", { flat: true, only: "dur" }),
    S("data-guns.js", /export const AR_GEAR = /),
    S("data-guns.js", /const AR_DUR = /, "patch", { flat: true, only: "dur" }),
    S("data-guns.js", /export const CALIBRE_GEAR = /),
    S("data-guns.js", /const CALIBRE_DUR = /, "patch", { flat: true, only: "dur" }),
    S("data-guns.js", /export const LATER_GEAR = /),
    S("data-ammo.js", /export const RELOAD_GEAR = /),
    S("data-gunmods.js", /export const MOD_GEAR = /),
    S("data-kit.js", /export const KIT_GEAR = /),
    S("data-stacks.js", /export const BULK_GEAR = /),
    S("data-guns.js", /export const GEAR_PATCH = /, "patch"),
    S("data-nonlethal.js", /export const NL_GEAR = /),
    S("data-helmets.js", /export const HELMET_GEAR = /),
    S("data-blades.js", /export const BLADE_GEAR = /),
    S("data.js", /export const GEAR_DUR = /, "default", { flat: true, only: "dur" }),
  ],
  // (CALIBRE_RARITY first: its keys are its own, and a gun with no rarity yet is added to GUN_RARITY, the last scope)
  GUN_RARITY: [...one("data-guns.js", "CALIBRE_RARITY"), ...one("data-guns.js", "GUN_RARITY")],
  ARSENAL_FINDS: one("data-guns.js", "ARSENAL_FINDS"),
  // the gun distribution (gundist.js): each gun's class and date, the draws (profiles, theme tags, places, sources)
  GUN_CLASS: one("data-guns.js", "GUN_CLASS"),
  GUN_ADDED: one("data-guns.js", "GUN_ADDED"),
  GUN_NEWNESS: one("data-guns.js", "GUN_NEWNESS"),
  GUN_DRAWS: one("data-guns.js", "GUN_DRAWS"),
  THEME_DRAWS: one("data-guns.js", "THEME_DRAWS"),
  PLACE_DRAWS: one("data-guns.js", "PLACE_DRAWS"),
  GUN_SOURCES: one("data-guns.js", "GUN_SOURCES"),
  CALIBERS: one("data-ammo.js", "CALIBERS"),
  CAL_DMG: one("data-ammo.js", "CAL_DMG"),
  LADDER: one("data-ammo.js", "LADDER"),
  AMMO_TYPES: one("data-ammo.js", "AMMO_TYPES"),
  RARITY_FIND: one("data-ammo.js", "RARITY_FIND"),
  RARITY: one("data-ammo.js", "RARITY"),
  ROUND_ECON: one("data-ammo.js", "ROUND_ECON"),
  THEME_CALS: one("data-ammo.js", "THEME_CALS"),
  THEME_TYPES: one("data-ammo.js", "THEME_TYPES"),
  HAND_VALUE: one("data-ammo.js", "HAND_VALUE"),
  LAUNCH_VALUE: one("data-ammo.js", "LAUNCH_VALUE"),
  MAGAZINES: [...one("data-kit.js", "MAGAZINES"), ...one("data-kit.js", "CALIBRE_MAGS")],
  INTERNAL: [...one("data-kit.js", "INTERNAL"), ...one("data-kit.js", "CALIBRE_INTERNAL")],
  CLIPS: one("data-kit.js", "CLIPS"),
  RETAIL_BOX: one("data-stacks.js", "RETAIL_BOX"),
  AMMO_STACK: one("data-stacks.js", "AMMO_STACK"),
  BULK: one("data-stacks.js", "BULK"),
  BULK_FINDS: one("data-stacks.js", "BULK_FINDS"),
  MAGS: one("mags.js", "MAGS"),
  SHELLS: one("mags.js", "SHELLS"),
  CUSTOM_POINTS: one("custompoints.js", "CUSTOM_POINTS"),
  START_GEAR: one("startgear.js", "START_GEAR"),
};

// ---------- reading a tree of files ----------
/** A cache of the source files of one prototype root (edits go through it). */
export class SourceTree {
  /** @param {string} root the prototype folder */
  constructor(root) { this.root = root; this.files = new Map(); this.dirty = new Set(); }
  text(file) {
    if (!this.files.has(file)) this.files.set(file, readFileSync(join(this.root, file), "utf8"));
    return this.files.get(file);
  }
  set(file, text) { this.files.set(file, text); this.dirty.add(file); }
  // Where a scope's literal starts: [index of its `{` / `[` / value] for every match.
  scopeStarts(sc) {
    const t = this.text(sc.file);
    const re = new RegExp(sc.open.source, "g");
    const out = [];
    for (let m; (m = re.exec(t)); ) out.push(skipWs(t, m.index + m[0].length));
    return out;
  }
  /** Where the value of [key, ...field] of registry `reg` is set: { file, start, end, text, value, ok } (a literal),
   * { file, insert, parentOpen, key } (absent: could be added there), or null. */
  locate(reg, path) {
    const scopes = REG[reg];
    if (!scopes) throw new Error(`no registry ${reg}`);
    const [key, ...field] = path;
    let loc = null, dflt = null;
    for (const sc of scopes) {
      if (sc.only && field.join(".") !== sc.only) continue;
      for (const st of this.scopeStarts(sc)) {
        const t = this.text(sc.file);
        if (key === undefined) { loc = this.leaf(sc.file, t, { start: st, end: valueEnd(t, st) }); continue; }
        const entry = walk(t, st, [key]);
        if (!entry || entry.missing) continue;
        const hit = sc.flat ? entry : walk(t, entry.start, field);
        if (sc.mode === "default") { if (hit && !hit.missing) dflt = this.leaf(sc.file, t, hit); continue; }
        if (sc.mode === "replace") loc = !hit ? null : hit.missing ? { file: sc.file, insert: true, parentOpen: hit.parentOpen, key: hit.key } : this.leaf(sc.file, t, hit);
        else if (hit && !hit.missing) loc = this.leaf(sc.file, t, hit);
      }
    }
    if ((!loc || loc.insert) && dflt) return dflt;
    if (!loc && key !== undefined && field.length === 0) {
      // a key absent from a flat map (GUN_RARITY): insert it into the (last) scope's literal
      const sc = scopes[scopes.length - 1];
      const st = this.scopeStarts(sc).pop();
      const t = this.text(sc.file);
      if (st != null && t[st] === "{") return { file: sc.file, insert: true, parentOpen: st, key: String(key) };
    }
    return loc;
  }
  leaf(file, t, span) {
    const text = t.slice(span.start, span.end);
    const lit = literalValue(text);
    return { file, start: span.start, end: span.end, text, value: lit.value, ok: lit.ok };
  }
  // The line of a position (for the sheet's "where" hints).
  lineOf(file, pos) { return this.text(file).slice(0, pos).split("\n").length; }
}

/** A value as a literal in the source's style. */
export function literal(v) {
  if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
  if (typeof v === "boolean" || v === null) return String(v);
  return JSON.stringify(String(v));
}
const IDENT = /^[A-Za-z_$][\w$]*$/;
/** Replaces (or inserts) one value: returns the new text of its file. */
export function editAt(tree, loc, to) {
  const t = tree.text(loc.file);
  if (!loc.insert && /^\s*\[/.test(loc.text) && typeof to === "string") return t.slice(0, loc.start) + JSON.stringify(to.trim().split(/\s+/).filter(Boolean)).replace(/","/g, '", "') + t.slice(loc.end); // a list of words
  if (!loc.insert) return t.slice(0, loc.start) + literal(to) + t.slice(loc.end);
  const { props, close } = objectProps(t, loc.parentOpen);
  const k = IDENT.test(loc.key) ? loc.key : JSON.stringify(loc.key);
  const add = `${k}: ${literal(to)}`;
  if (!props.length) return t.slice(0, loc.parentOpen + 1) + ` ${add} ` + t.slice(loc.parentOpen + 1);
  const last = props[props.length - 1];
  // after the last property, on its line (a comma after it if there was none)
  let i = last.end;
  const after = skipWs(t, i);
  if (t[after] === ",") return t.slice(0, after + 1) + ` ${add},` + t.slice(after + 1);
  void close;
  return t.slice(0, i) + `, ${add}` + t.slice(i);
}
/** Rewrites an array literal of strings at registry `reg` (data-ammo.js RARITY's order). */
export function setStringArray(tree, reg, list) {
  const sc = REG[reg][0];
  const st = tree.scopeStarts(sc)[0];
  const t = tree.text(sc.file);
  if (t[st] !== "[") throw new Error(`${reg} is not an array literal`);
  const { close } = arrayElems(t, st);
  return t.slice(0, st) + "[" + list.map((x) => JSON.stringify(x)).join(", ") + "]" + t.slice(close + 1);
}
