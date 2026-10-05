// Where saves live: browser storage (localStorage, one key per slot plus a small index), compressed; and save files
// (.bsave, the save's JSON) to download and to load from a file picker, for backups and moving a game between
// browsers or into the desktop app. The world itself is written and read by sim/save.js.
//
// Storage keys:  brokenstate.saves          the index: [{ id, name, auto, ts, size, raw, thumb, day, hour, hub, … }]
//                brokenstate.save.<id>      one save: "BSZ1|<bytes>|<gzip packed 15 bits a character>" or "BSJ1|<json>"
//                brokenstate.options        the Options tab (autosave, confirmations, pause on focus loss, UI size)
// Nothing here runs at import time, so the headless tools can import it with no browser around.
import { serializeState, deserializeState, checkSave, saveMeta, SaveError } from "../sim/save.js";

export const AUTOSAVE = "autosave";
const INDEX_KEY = "brokenstate.saves";
const SLOT_KEY = (id) => `brokenstate.save.${id}`;
const OPTIONS_KEY = "brokenstate.options";
export const MAX_SLOTS = 12; // manual saves; the autosave is extra

export const DEFAULT_OPTIONS = { autosave: true, autosaveDays: 1, confirmQuit: true, pauseOnBlur: false, uiScale: 1, autoOpen: true };
export const AUTOSAVE_DAYS = [1, 2, 3, 5, 7];

const storage = () => {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
};

// ---------- options ----------
export function loadOptions() {
  const o = { ...DEFAULT_OPTIONS };
  try {
    const raw = storage() && storage().getItem(OPTIONS_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (typeof v.autosave === "boolean") o.autosave = v.autosave;
      if (AUTOSAVE_DAYS.includes(v.autosaveDays)) o.autosaveDays = v.autosaveDays;
      if (typeof v.confirmQuit === "boolean") o.confirmQuit = v.confirmQuit;
      if (typeof v.pauseOnBlur === "boolean") o.pauseOnBlur = v.pauseOnBlur;
      if (typeof v.autoOpen === "boolean") o.autoOpen = v.autoOpen; // folded panels open when you pick what they show (ui/layout.js)
      if (Number.isFinite(v.uiScale) && v.uiScale >= 0.5 && v.uiScale <= 3) o.uiScale = v.uiScale;
    }
  } catch { /* unreadable: the defaults */ }
  return o;
}
export function saveOptions(o) {
  try { storage().setItem(OPTIONS_KEY, JSON.stringify(o)); return true; } catch { return false; } // blocked: this session only
}

// ---------- the index ----------
export function listSaves() {
  try {
    const raw = storage() && storage().getItem(INDEX_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === "string").sort((a, b) => (b.ts || 0) - (a.ts || 0)) : [];
  } catch { return []; }
}
const writeIndex = (list) => storage().setItem(INDEX_KEY, JSON.stringify(list));
export const latestSave = () => listSaves()[0] || null;
export const saveEntry = (id) => listSaves().find((e) => e.id === id) || null;
// Bytes the saves take in browser storage (UTF-16: two bytes a character), roughly.
export const storageUsed = () => listSaves().reduce((a, e) => a + (e.size || 0) * 2 + (e.thumb ? e.thumb.length * 2 : 0), 0);

export function deleteSave(id) {
  const st = storage();
  if (!st) return false;
  try { st.removeItem(SLOT_KEY(id)); } catch { /* ignore */ }
  try { writeIndex(listSaves().filter((e) => e.id !== id)); } catch { return false; }
  return true;
}

// A new slot id (manual saves): s1, s2, … the first free one.
export function newSlotId() {
  const used = new Set(listSaves().map((e) => e.id));
  for (let i = 1; ; i++) if (!used.has(`s${i}`)) return `s${i}`;
}
export const defaultSaveName = (state) => { const m = saveMeta(state); return `${m.hub || "Holdout"}, day ${m.day}`; };

// ---------- compression ----------
// gzip through the browser's CompressionStream (also in node 18+). Without it, saves are stored as plain JSON.
export const canCompress = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function" && typeof Blob === "function" && typeof Response === "function";
export async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}
// Bytes as characters, 15 bits each (code points 32–32799: never a surrogate, so any storage keeps them).
export function pack15(u8) {
  const parts = [];
  let codes = [], acc = 0, bits = 0;
  for (let i = 0; i < u8.length; i++) {
    acc = (acc << 8) | u8[i];
    bits += 8;
    if (bits >= 15) {
      bits -= 15;
      codes.push(32 + ((acc >> bits) & 0x7fff));
      acc &= (1 << bits) - 1;
      if (codes.length >= 8192) { parts.push(String.fromCharCode.apply(null, codes)); codes = []; }
    }
  }
  if (bits > 0) codes.push(32 + ((acc << (15 - bits)) & 0x7fff));
  parts.push(String.fromCharCode.apply(null, codes));
  return parts.join("");
}
export function unpack15(str, n) {
  const out = new Uint8Array(n);
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < str.length && o < n; i++) {
    acc = (acc << 15) | ((str.charCodeAt(i) - 32) & 0x7fff);
    bits += 15;
    while (bits >= 8 && o < n) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}
// The stored form of a save's JSON, and back.
export async function packSave(json) {
  if (!canCompress()) return `BSJ1|${json}`;
  const z = await gzip(json);
  return `BSZ1|${z.length}|${pack15(z)}`;
}
export async function unpackSave(stored) {
  const s = String(stored || "");
  if (s.startsWith("BSJ1|")) return s.slice(5);
  if (s.startsWith("BSZ1|")) {
    if (!canCompress()) throw new SaveError("This browser cannot unpack compressed saves.", "storage");
    const bar = s.indexOf("|", 5);
    const n = Number(s.slice(5, bar));
    return await gunzip(unpack15(s.slice(bar + 1), n));
  }
  if (s.startsWith("{")) return s; // plain JSON (older or hand-made)
  throw new SaveError("This save is damaged and cannot be read.", "damaged");
}

// ---------- slots ----------
// Writes the world to a slot. opts: { name, auto, thumb, dropCards }. Throws a SaveError (a card is open, the
// storage is full or blocked). Returns the index entry.
export async function writeSave(id, state, opts = {}) {
  const st = storage();
  if (!st) throw new SaveError("This browser does not allow storage here, so the game cannot be saved in it. Use Export to save to a file.", "storage");
  const save = serializeState(state, { dropCards: !!opts.dropCards }); // throws while a card is open
  const json = JSON.stringify(save);
  const packed = await packSave(json);
  try {
    st.setItem(SLOT_KEY(id), packed);
  } catch (e) {
    throw new SaveError(`Not enough browser storage for this save (${Math.round(packed.length * 2 / 1024)} KB). Delete an old save, or use Export to keep it as a file.`, "quota");
  }
  const prev = saveEntry(id);
  const entry = {
    id, name: String(opts.name || (prev && prev.name) || defaultSaveName(state)).slice(0, 60), auto: id === AUTOSAVE,
    ts: Number.isFinite(opts.ts) ? opts.ts : Date.now(), size: packed.length, raw: json.length, v: save.v, game: save.game,
    thumb: opts.thumb || "", why: opts.why || "", ...save.meta,
  };
  try {
    writeIndex([entry, ...listSaves().filter((e) => e.id !== id)]);
  } catch {
    // The index did not fit with the thumbnail: try without it.
    entry.thumb = "";
    try { writeIndex([entry, ...listSaves().filter((e) => e.id !== id)]); } catch {
      try { st.removeItem(SLOT_KEY(id)); } catch { /* ignore */ }
      throw new SaveError("Not enough browser storage to list this save. Delete an old save first.", "quota");
    }
  }
  return entry;
}

// The save's JSON text from a slot.
export async function readSaveText(id) {
  const st = storage();
  const stored = st ? st.getItem(SLOT_KEY(id)) : null;
  if (!stored) throw new SaveError("That save is gone from this browser's storage.", "missing");
  return await unpackSave(stored);
}
// A live world from a slot (sets the id counter: only for the world about to be played).
export async function readSave(id) {
  return deserializeState(parseSave(await readSaveText(id)));
}
export function parseSave(text) {
  let save;
  try { save = JSON.parse(text); } catch { throw new SaveError("This file is not a Broken State save (it is not readable JSON).", "damaged"); }
  const chk = checkSave(save);
  if (!chk.ok) throw new SaveError(chk.why, "version");
  return save;
}

// ---------- files ----------
const fileName = (entry) => `${String(entry.name || "broken-state").replace(/[^\w\- ,]+/g, "").replace(/\s+/g, "-").replace(/,/g, "") || "broken-state"}.bsave`;
// Downloads a slot as a .bsave file (the save's JSON).
export async function exportSave(id) {
  const entry = saveEntry(id);
  const text = await readSaveText(id);
  downloadText(fileName(entry || { name: id }), text);
  return entry;
}
export function downloadText(name, text) {
  if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) throw new SaveError("Files cannot be saved from here.", "storage");
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  if (document.body && document.body.appendChild) document.body.appendChild(a);
  if (a.click) a.click();
  setTimeout(() => { URL.revokeObjectURL(url); if (a.remove) a.remove(); }, 1000);
}
// A picked file (File or Blob) → the save's JSON text. Accepts the plain JSON and a gzip of it.
export async function readSaveFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (!canCompress()) throw new SaveError("This browser cannot unpack compressed save files.", "storage");
    return await gunzip(bytes);
  }
  return new TextDecoder().decode(bytes);
}
// Stores an imported save's text as a new slot (checked first). Returns the entry.
export async function importSaveText(text, name = "") {
  const save = parseSave(text);
  const st = storage();
  if (!st) throw new SaveError("This browser does not allow storage here.", "storage");
  const id = newSlotId();
  const packed = await packSave(text);
  try { st.setItem(SLOT_KEY(id), packed); } catch { throw new SaveError("Not enough browser storage for this save. Delete an old save first.", "quota"); }
  const entry = { id, name: String(name || `Imported: ${save.meta && save.meta.hub ? `${save.meta.hub}, day ${save.meta.day}` : "save"}`).slice(0, 60), auto: false, ts: Date.now(), size: packed.length, raw: text.length, v: save.v, game: save.game, thumb: "", why: "imported", ...(save.meta || {}) };
  writeIndex([entry, ...listSaves().filter((e) => e.id !== id)]);
  return entry;
}
