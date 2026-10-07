// Map notes on the map (sim/mapnotes.js holds them): a small round pin in the icon's color with its glyph, tucked into
// the upper right of the tile (side by side when a tile has several), and the note's text beside it when zoomed in
// past NOTE_TEXT_ZOOM; at any zoom the tile's hover tooltip lists the notes (noteTip). Drawn on the map's dynamic
// layer by ui/render.js, after the markers and before the names: a few calls per note on screen, nothing cached.
import { NOTE_ICONS, notesAt } from "../sim/mapnotes.js";

export const NOTE_TEXT_ZOOM = 1.3;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ctx is in world pixels (render.js's transform). o: { toPixel(tile) → [x, y], zoom, boost (sprite scale), inView(x, y) }.
export function drawMapNotes(ctx, state, o) {
  const m = state.mapNotes;
  if (!m || m.hidden || !m.list || !m.list.length) return 0;
  const s = Math.max(1, o.boost || 1);
  const r = 6.5 * s;
  const slot = new Map();
  let n = 0;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const note of m.list) {
    const [px, py] = o.toPixel(note.tile);
    if (o.inView && !o.inView(px, py)) continue;
    const k = slot.get(note.tile) || 0;
    slot.set(note.tile, k + 1);
    const x = px + 13 * s - k * (r * 2 + 1.5 * s), y = py - 15 * s;
    const ic = NOTE_ICONS[note.icon] || NOTE_ICONS.flag;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(13,15,18,0.85)";
    ctx.fill();
    ctx.lineWidth = 1.6 * s;
    ctx.strokeStyle = ic.color;
    ctx.stroke();
    ctx.font = `${Math.round(8 * s)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.fillStyle = "#fff";
    ctx.fillText(ic.glyph, x, y + 0.5 * s);
    if (o.zoom >= NOTE_TEXT_ZOOM && note.text && k === 0) {
      // The text of the tile's first note beside it (the others: hover the tile).
      ctx.font = `bold ${Math.round(9 * s)}px Segoe UI`;
      const t = note.text.length > 28 ? `${note.text.slice(0, 27)}…` : note.text;
      const w = ctx.measureText(t).width + 6 * s, h = 11 * s;
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(13,15,18,0.8)";
      ctx.fillRect(x + r + 1.5 * s, y - h / 2, w, h);
      ctx.fillStyle = "#f3e6c4";
      ctx.fillText(t, x + r + 4.5 * s, y + 0.5 * s);
      ctx.textAlign = "center";
    }
    n++;
  }
  ctx.restore();
  return n;
}

// Lines for the tile's hover tooltip (render.js tileTooltip), "" when there are none or notes are hidden.
export function noteTip(state, tile) {
  if (!state.mapNotes || state.mapNotes.hidden) return "";
  const list = notesAt(state, tile);
  return list.map((n) => `<span style="color:#f3e6c4">${(NOTE_ICONS[n.icon] || NOTE_ICONS.flag).glyph} ${esc(n.text || (NOTE_ICONS[n.icon] || NOTE_ICONS.flag).name)}</span>`).join("<br>");
}
// A cheap fingerprint for render.js's "has anything changed" check (a note added, moved or edited while paused).
export function notesHash(state) {
  const m = state.mapNotes;
  if (!m || !m.list) return 0;
  let h = m.hidden ? 7 : 1;
  for (const n of m.list) h = (h * 31 + n.tile * 13 + n.id + (n.text ? n.text.length : 0) + (n.icon ? n.icon.length * 3 : 0)) % 2147483647;
  return h;
}
