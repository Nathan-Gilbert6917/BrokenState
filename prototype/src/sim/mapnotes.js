// Map notes: the player's own pins on the map ("bridge to clear", "cache here"), each an icon and a short text on a
// tile (right-click a tile → Add note; listed, edited and deleted in the Watching panel's Notes, ui/watchlist.js; drawn
// by ui/mapnotes.js). Kept in state.mapNotes, so they are saved with the campaign; an older save simply has none.
// Nothing in the simulation reads them.
import { newId } from "./world.js";

// The icons to pick from (glyph on the map and in the lists, name for the tooltip, the pin's color).
export const NOTE_ICONS = {
  flag:     { glyph: "🚩", name: "Flag",     color: "#d9534f" },
  cache:    { glyph: "📦", name: "Cache",    color: "#c9a227" },
  danger:   { glyph: "⚠️", name: "Danger",   color: "#e67e22" },
  bridge:   { glyph: "🌉", name: "Bridge",   color: "#5b8fd6" },
  target:   { glyph: "🎯", name: "Target",   color: "#c0392b" },
  star:     { glyph: "⭐", name: "Star",     color: "#e0b84f" },
  question: { glyph: "❓", name: "Question", color: "#8e7cc3" },
  skull:    { glyph: "💀", name: "Skull",    color: "#7f8c8d" },
};
export const NOTE_KEYS = Object.keys(NOTE_ICONS);
export const NOTE_TEXT_MAX = 80;  // characters
export const NOTES_MAX = 200;     // notes in one campaign

export const mapNotes = (state) => {
  const m = state.mapNotes || (state.mapNotes = { list: [], hidden: false });
  if (!Array.isArray(m.list)) m.list = [];
  return m;
};
export const noteById = (state, id) => mapNotes(state).list.find((n) => n.id === Number(id)) || null;
export const notesAt = (state, tile) => mapNotes(state).list.filter((n) => n.tile === Number(tile));
export const notesHidden = (state) => !!(state.mapNotes && state.mapNotes.hidden);
const cleanText = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_TEXT_MAX);
const cleanIcon = (k) => (NOTE_ICONS[k] ? k : "flag");

// Adds a note on a tile. Returns the note, or a string saying why not.
export function addNote(state, tile, icon, text) {
  const t = Number(tile);
  if (!state.tiles || !state.tiles[t]) return "There is no such tile.";
  const m = mapNotes(state);
  if (m.list.length >= NOTES_MAX) return `You have ${NOTES_MAX} notes already: delete some first.`;
  const note = { id: newId(), tile: t, icon: cleanIcon(icon), text: cleanText(text), hour: state.hour };
  m.list.push(note);
  return note;
}
export function editNote(state, id, { icon, text } = {}) {
  const n = noteById(state, id);
  if (!n) return null;
  if (icon !== undefined) n.icon = cleanIcon(icon);
  if (text !== undefined) n.text = cleanText(text);
  return n;
}
export function deleteNote(state, id) {
  const m = mapNotes(state);
  const i = m.list.findIndex((n) => n.id === Number(id));
  if (i < 0) return false;
  m.list.splice(i, 1);
  return true;
}
export function setNotesHidden(state, v) {
  const m = mapNotes(state);
  m.hidden = v === undefined ? !m.hidden : !!v;
  return m.hidden;
}
// "🚩 Bridge to clear" (or the icon's name when there is no text).
export const noteLabel = (n) => `${(NOTE_ICONS[n.icon] || NOTE_ICONS.flag).glyph} ${n.text || (NOTE_ICONS[n.icon] || NOTE_ICONS.flag).name}`;
