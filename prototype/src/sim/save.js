// Saving and loading a whole world. Pure simulation: no DOM, no storage, no clock (ui/saves.js stores the result).
//
// A save is the state written as a graph, not a tree: everything the sim keeps is written once, whatever shape it
// has, so nothing has to be listed by hand and a module that adds a field to the state is saved with it.
// - Plain objects and arrays as JSON. Maps, Sets, typed arrays (the timelapse's Uint16 / Uint8 frames, base64),
//   the seeded generators (Rng: their position in the sequence) and the hex grid are tagged objects.
// - An object reachable from two places is written once and referenced after that, so links survive a load:
//   an item worn by a survivor and listed at a death site, the chronicle's frames sharing one list of bases, a
//   battle's supply pools that are the team's own supplies, state.rng and the battle's rng, memorial moments.
// - The chronicle's WeakMaps / WeakSet (keyed by hordes and parties) are written as the entries for the objects
//   still in the world (exactly what a WeakMap can still answer for).
// - undefined, NaN, ±Infinity and -0 keep their values (JSON would turn them into null or 0).
// - The id counter (world.js newId) is saved, so a loaded world hands out the same ids as the original.
// What cannot be saved: an open event card. Its choices are code (closures over the moment the card was made),
// so saving waits until the card is answered (saveBlocker). Battles, raids, the deploy step, searches and trade
// windows are plain data and are saved as they are, mid-turn included.
//
// Tags (the key "$" marks one; a plain object that has its own "$" key is wrapped in an "O" tag):
//   { $: "D", i, v }  first sight of a shared object (id i, v its usual form) · { $: "R", i }  a reference to it
//   { $: "M", e: [[k, v]…] } Map · { $: "S", e: […] } Set · { $: "WM", e } WeakMap · { $: "WS", e } WeakSet
//   { $: "T", t: "Uint16Array", b: base64 } typed array · { $: "Rng", s } · { $: "Grid", w, h } · { $: "O", v }
//   { $: "u" } undefined · { $: "N", v: "NaN" | "Infinity" | "-Infinity" | "-0" }
import { Rng } from "./rng.js";
import { HexGrid } from "./hex.js";
import { peekNextId, setNextId, day, hub, alive } from "./world.js";

export const SAVE_FORMAT = "broken-state-save";
// Bump when the state changes in a way an older save cannot just be loaded into, and add a migration below.
export const SAVE_VERSION = 1;
export const GAME_VERSION = "0.1.0";

// Migrations by the version they upgrade from: MIGRATIONS[n](save) turns a version-n save into version n + 1
// (save.state is the encoded graph; decode, fix, encode again if that is easier). Version 1 is the first.
const MIGRATIONS = {};

export class SaveError extends Error {
  constructor(message, code = "error", path = "") {
    super(message);
    this.name = "SaveError";
    this.code = code;
    this.path = path;
  }
}

// Why the world cannot be saved right now (a message for the player), or "" when it can.
export function saveBlocker(state) {
  if (!state) return "There is no game to save.";
  if (state.cards && state.cards.length) {
    const c = state.cards[0];
    return `A card is waiting for an answer${c && c.title ? ` ("${c.title}")` : ""}. Answer it, then save: a card's choices cannot be written to a save.`;
  }
  return "";
}

// A short description of a world for the save list (no clock: the caller adds the time it was saved).
export function saveMeta(state) {
  const h = hub(state);
  return {
    day: day(state), hour: state.hour % 24, hub: h ? h.name : "", survivors: alive(state).length,
    seed: state.seed, groups: (state.factions || []).length, gameOver: !!state.gameOver, victory: !!state.victory,
    autopilot: !!state.autopilot,
  };
}

// The world as a JSON-safe object. opts.dropCards: write the world without its open cards (the game-over autosave;
// a run that has ended has nothing left to answer). Throws a SaveError when something in it cannot be saved.
export function serializeState(state, { dropCards = false } = {}) {
  const why = saveBlocker(state);
  if (why && !(dropCards && state && state.cards && state.cards.length)) throw new SaveError(why, "card", ".cards");
  const root = dropCards && state.cards.length ? { ...state, cards: [] } : state;
  return {
    format: SAVE_FORMAT, v: SAVE_VERSION, game: GAME_VERSION,
    nextId: peekNextId(), meta: saveMeta(state),
    state: encodeGraph(root),
  };
}

// Is this a save this version can load? { ok, why }.
export function checkSave(save) {
  if (!save || typeof save !== "object" || save.format !== SAVE_FORMAT || !save.state) return { ok: false, why: "This is not a Broken State save." };
  const v = Number(save.v);
  if (!Number.isInteger(v) || v < 1) return { ok: false, why: "This save has no version number; it cannot be loaded." };
  if (v > SAVE_VERSION) return { ok: false, why: `This save was made by a newer version of the game (save format ${v}; this version reads up to ${SAVE_VERSION}).` };
  for (let n = v; n < SAVE_VERSION; n++) if (!MIGRATIONS[n]) return { ok: false, why: `This save is too old to load (save format ${v}; this version reads ${SAVE_VERSION}).` };
  return { ok: true, why: "" };
}

// A live world from a save object (serializeState's result, after JSON.parse). Old versions are migrated first.
// Sets the id counter (world.js), so call it only for the world that is about to be played.
export function deserializeState(save) {
  const chk = checkSave(save);
  if (!chk.ok) throw new SaveError(chk.why, "version");
  let s = save;
  for (let n = Number(s.v); n < SAVE_VERSION; n++) s = MIGRATIONS[n](s);
  let state;
  try {
    state = decodeGraph(s.state);
  } catch (e) {
    throw new SaveError(`The save is damaged and cannot be loaded (${e.message}).`, "damaged");
  }
  if (!state || !Array.isArray(state.tiles) || !state.grid || !Array.isArray(state.bases)) throw new SaveError("The save is damaged and cannot be loaded (no map or bases).", "damaged");
  setNextId(Number(s.nextId));
  if (state.governor) state.governor.busy = false; // never saved mid-call, but a damaged flag would stop the autopilot for good
  return state;
}

// String forms (a save file is this JSON).
export const saveToString = (state, opts) => JSON.stringify(serializeState(state, opts));
export const loadFromString = (text) => deserializeState(JSON.parse(text));

// ---------- the graph encoder ----------
const TYPED = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
const isPlain = (v) => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };
const keyLabel = (k) => (typeof k === "string" && /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${typeof k === "string" ? JSON.stringify(k) : String(k)}]`);

export function encodeGraph(root) {
  // Pass 1: how often each object is reached, and anything that cannot be written.
  const count = new Map();
  const weaks = [];
  const path = [];
  const fail = (what) => { throw new SaveError(`${what} at state${path.join("")} cannot be saved.`, what === "Code" ? "function" : "type", path.join("")); };
  const visit = (v) => {
    const t = typeof v;
    if (t === "function") fail("Code");
    if (t === "symbol" || t === "bigint") fail(`A ${t}`);
    if (v === null || t !== "object") return;
    const n = count.get(v);
    if (n !== undefined) { count.set(v, n + 1); return; }
    count.set(v, 1);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) { path.push(`[${i}]`); visit(v[i]); path.pop(); }
      for (const k of Object.keys(v)) if (!(String(k >>> 0) === k && (k >>> 0) < v.length)) { path.push(keyLabel(k)); fail("A property on a list"); }
      return;
    }
    if (ArrayBuffer.isView(v)) { if (!TYPED[v.constructor.name]) fail(`A ${v.constructor.name}`); return; }
    if (v instanceof Rng || v instanceof HexGrid) return;
    if (v instanceof WeakMap || v instanceof WeakSet) { weaks.push(v); return; }
    if (v instanceof Map) { for (const [k, x] of v) { path.push(`{${String(k)}}`); visit(k); visit(x); path.pop(); } return; }
    if (v instanceof Set) { let i = 0; for (const x of v) { path.push(`{#${i++}}`); visit(x); path.pop(); } return; }
    if (!isPlain(v)) fail(`An object of class ${v.constructor ? v.constructor.name : "?"}`);
    for (const k of Object.keys(v)) {
      const d = Object.getOwnPropertyDescriptor(v, k);
      path.push(keyLabel(k));
      if (d && (d.get || d.set)) fail("Code (a getter)");
      visit(d.value);
      path.pop();
    }
    if (Object.getOwnPropertySymbols(v).length) fail("A symbol key");
  };
  visit(root);
  // WeakMaps and WeakSets: the entries for objects in the world. The keys become shared, so they are written once.
  const weakKeys = new Map();
  if (weaks.length) {
    const objs = [...count.keys()];
    for (const w of weaks) weakKeys.set(w, objs.filter((o) => w.has(o)));
    for (const [w, keys] of weakKeys) for (const o of keys) {
      count.set(o, count.get(o) + 1);
      if (w instanceof WeakMap) { path.length = 0; path.push(".(weak map value)"); visit(w.get(o)); }
    }
  }
  // Pass 2: the encoded tree, shared objects as D (first sight) and R (after).
  const ids = new Map();
  let next = 0;
  const enc = (v) => {
    const t = typeof v;
    if (t === "number") {
      if (Number.isFinite(v)) return v === 0 && 1 / v < 0 ? { $: "N", v: "-0" } : v;
      return { $: "N", v: String(v) };
    }
    if (v === undefined) return { $: "u" };
    if (v === null || t !== "object") return v;
    const id = ids.get(v);
    if (id !== undefined) return { $: "R", i: id };
    if (count.get(v) > 1) {
      const i = next++;
      ids.set(v, i);
      return { $: "D", i, v: body(v) };
    }
    return body(v);
  };
  const body = (v) => {
    if (Array.isArray(v)) {
      const out = new Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = enc(v[i]);
      return out;
    }
    if (ArrayBuffer.isView(v)) return { $: "T", t: v.constructor.name, b: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (v instanceof Rng) return { $: "Rng", s: v.state };
    if (v instanceof HexGrid) return { $: "Grid", w: v.width, h: v.height };
    if (v instanceof Map) { const e = []; for (const [k, x] of v) e.push([enc(k), enc(x)]); return { $: "M", e }; }
    if (v instanceof Set) { const e = []; for (const x of v) e.push(enc(x)); return { $: "S", e }; }
    if (v instanceof WeakMap) return { $: "WM", e: weakKeys.get(v).map((k) => [enc(k), enc(v.get(k))]) };
    if (v instanceof WeakSet) return { $: "WS", e: weakKeys.get(v).map((k) => enc(k)) };
    const out = {};
    for (const k of Object.keys(v)) out[k] = enc(v[k]);
    return Object.prototype.hasOwnProperty.call(v, "$") ? { $: "O", v: out } : out;
  };
  return enc(root);
}

// ---------- the graph decoder (the same walk, in the same order) ----------
export function decodeGraph(data) {
  const refs = [];
  const put = (o, k, x) => {
    if (k === "__proto__") Object.defineProperty(o, k, { value: x, enumerable: true, writable: true, configurable: true });
    else o[k] = x;
  };
  const fillObj = (src, out) => { for (const k of Object.keys(src)) put(out, k, dec(src[k])); return out; };
  const fillArr = (src, out) => { for (let i = 0; i < src.length; i++) out[i] = dec(src[i]); return out; };
  const dec = (e) => {
    if (e === null || typeof e !== "object") return e;
    if (Array.isArray(e)) return fillArr(e, new Array(e.length));
    return e.$ === undefined ? fillObj(e, {}) : tagged(e, null);
  };
  // reg: the id this value is registered under (a D tag), before anything inside it is read (cycles).
  const tagged = (e, reg) => {
    const keep = (x) => { if (reg != null) refs[reg] = x; return x; };
    switch (e.$) {
      case "u": return undefined;
      case "N": return e.v === "-0" ? -0 : Number(e.v);
      case "R":
        if (!(e.i in refs)) throw new Error(`reference ${e.i} before its object`);
        return refs[e.i];
      case "D": {
        const v = e.v;
        if (Array.isArray(v)) return fillArr(v, (refs[e.i] = new Array(v.length)));
        if (v === null || typeof v !== "object") throw new Error("a shared value that is not an object");
        if (v.$ === undefined) return fillObj(v, (refs[e.i] = {}));
        return tagged(v, e.i);
      }
      case "O": return fillObj(e.v, keep({}));
      case "M": { const m = keep(new Map()); for (const [k, x] of e.e) m.set(dec(k), dec(x)); return m; }
      case "S": { const s = keep(new Set()); for (const x of e.e) s.add(dec(x)); return s; }
      case "WM": { const m = keep(new WeakMap()); for (const [k, x] of e.e) m.set(dec(k), dec(x)); return m; }
      case "WS": { const s = keep(new WeakSet()); for (const x of e.e) s.add(dec(x)); return s; }
      case "T": {
        const C = TYPED[e.t];
        if (!C) throw new Error(`unknown array type ${e.t}`);
        const bytes = b64ToBytes(e.b);
        return keep(new C(bytes.buffer, bytes.byteOffset, bytes.byteLength / C.BYTES_PER_ELEMENT));
      }
      case "Rng": { const r = new Rng(0); r.state = e.s; return keep(r); } // the exact number: it grows past 32 bits (rng.js)
      case "Grid": return keep(new HexGrid(e.w, e.h));
      default: throw new Error(`unknown tag ${String(e.$)}`);
    }
  };
  return dec(data);
}

// ---------- base64 (no Buffer / btoa: the same in the browser and in node) ----------
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64I = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64I[B64.charCodeAt(i)] = i;
export function bytesToB64(u8) {
  const parts = [];
  const CH = 3 * 4096;
  for (let o = 0; o < u8.length; o += CH) {
    const end = Math.min(u8.length, o + CH);
    let s = "";
    for (let i = o; i < end; i += 3) {
      const a = u8[i], b = i + 1 < end ? u8[i + 1] : 0, c = i + 2 < end ? u8[i + 2] : 0;
      const n = (a << 16) | (b << 8) | c;
      s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < end ? B64[(n >> 6) & 63] : "=") + (i + 2 < end ? B64[n & 63] : "=");
    }
    parts.push(s);
  }
  return parts.join("");
}
export function b64ToBytes(s) {
  const str = String(s).replace(/[^A-Za-z0-9+/]/g, "");
  const n = Math.floor((str.length * 3) / 4);
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < str.length; i += 4) {
    const a = B64I[str.charCodeAt(i)], b = B64I[str.charCodeAt(i + 1)];
    const c = i + 2 < str.length ? B64I[str.charCodeAt(i + 2)] : 0, d = i + 3 < str.length ? B64I[str.charCodeAt(i + 3)] : 0;
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < n) out[o++] = (v >> 16) & 255;
    if (o < n) out[o++] = (v >> 8) & 255;
    if (o < n) out[o++] = v & 255;
  }
  return out;
}
