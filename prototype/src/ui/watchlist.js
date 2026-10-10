// The Watching panel on the map (top left, under the Running orders and above the Layers box): what the player pinned
// with 📌 (sim/watchlist.js) with its live status, and the player's map notes (sim/mapnotes.js) below it.
//   person: where, health, mood, what they do · team: where, ETA, food and water, Heat · horde: size, heading, how far
//   from the nearest base · group: attitude, size and strength · base: days of food and water, threats in sight.
// Click a row to go there; a dead or gone entry greys out with ✕ to drop it. Status follows the game's own rules of
// what you know: a team out of radio contact shows its expected return, a horde out of sight where it was last seen.
// Pins: watchlistPin (the survivor screen, the team panel, the Groups and Bases tabs, the tile panel's horde row) and the
// right-click menu (ctxWatchlist: the base, group base, hordes and teams on the tile, plus Add note / Edit note).
// The note editor is a small box on the map (#noteedit), kept apart from the panels so a redraw never eats the typing.
import { watchlistOf, onWatchlist, toggleWatchlist, unpinWatchlist, WATCHLIST_MAX } from "../sim/watchlist.js";
import { mapNotes, noteById, notesAt, addNote, editNote, deleteNote, setNotesHidden, NOTE_ICONS, NOTE_KEYS, NOTE_TEXT_MAX } from "../sim/mapnotes.js";
import { survivorById, baseById, factionById, playerStrength } from "../sim/world.js";
import { partyTile, partyMembers, MISSIONS, tileLabel } from "../sim/parties.js";
import { contactable, orderStatus } from "../sim/orders.js";
import { attitude, strength } from "../sim/factions.js";
import { foodOutlook, waterOutlook, ROLES } from "../sim/economy.js";
import { waterIn } from "../sim/water.js";
import { roleOf, taskLabel } from "../sim/work.js";
import { ageText, mapLoc } from "./render.js";
import { panelHead, panelTab } from "./layout.js"; // the boxes over the map share one header and folded tab

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const first = (name) => String(name || "").split(" ")[0];
const hasDoc = () => typeof document !== "undefined" && !!document && typeof document.getElementById === "function";
export const WATCHLIST_NEAR = 6; // tiles: a horde or raiders this close to a base you watch is a threat (the alerts' horde distance)
const KIND_ICON = { person: "👤", team: "🚶", horde: "🧟", group: "🏴", base: "🏠" };
const live = (state, tile) => !!(state.live && state.live.has(tile));

// ---------- status of one entry ----------
// { gone, name, line, tone, tip, go: { surv | team | tile | group } }
const daysText = (d) => (!Number.isFinite(d) || d >= 60 ? "60+ d" : `${Math.max(0, Math.floor(d))} d`);
const COMPASS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
function heading(state, from, to) {
  if (to == null || to === from) return "";
  const g = state.grid, [ax, ay] = g.toPixel(from, 1), [bx, by] = g.toPixel(to, 1);
  return COMPASS[((Math.round(Math.atan2(by - ay, bx - ax) / (Math.PI / 4)) % 8) + 8) % 8];
}
function nearestBase(state, tile) {
  let best = null, dist = Infinity;
  for (const b of state.bases) { const d = state.grid.distance(tile, b.tile); if (d < dist) { dist = d; best = b; } }
  return best ? { b: best, dist } : null;
}
// In touch with a person: at a base, escorting a route, or on a team you have contact with (the roster's rule).
function inTouch(state, s) {
  const k = s.location && s.location.kind;
  if (k === "base" || k === "route" || k === "post") return true;
  if (k !== "party") return false;
  const p = state.parties.find((x) => x.id === s.location.partyId);
  return !!p && (p.kind === "convoy" || contactable(p));
}
function personStatus(state, it) {
  const s = survivorById(state, it.id);
  if (!s) return { gone: true, line: "gone" };
  if (!s.alive) return { gone: true, line: s.left ? "left the group" : "died" };
  const l = s.location || {};
  let where = "away", tile = null;
  if (l.kind === "base") { const b = baseById(state, l.baseId); where = b ? `at ${b.name}` : "at a base"; tile = b ? b.tile : null; }
  else if (l.kind === "party") {
    const p = state.parties.find((x) => x.id === l.partyId);
    const mission = p && MISSIONS[p.teamMission || p.mission];
    where = p && p.kind === "convoy" ? "on the road with a convoy" : mission ? `out with the ${mission.name} team` : "out on a team";
    if (p && (p.kind === "convoy" || contactable(p))) tile = partyTile(p);
  } else if (l.kind === "captive") { const f = factionById(state, l.factionId); where = `held by ${f && f.known ? f.name : "captors"}`; }
  else if (l.kind === "route") where = "escorting a trade route";
  else if (l.kind === "post") { where = "posted at a field work"; tile = l.tile ?? null; } // sim/fieldworks.js
  else if (l.kind === "errand") where = `on an errand (back ~day ${l.until})`;
  if (!inTouch(state, s)) return { name: s.name, line: `${where} · no contact`, tone: "muted", go: { surv: s.id, tile } };
  const task = s.inBed ? "in a hospital bed" : l.kind === "base" ? (taskLabel(state, s) || (roleOf(state, s) ? roleOf(state, s).name : ROLES[s.role] ? ROLES[s.role].name : "")) : "";
  const hp = n0(s.health);
  return {
    name: s.name, tone: hp < 40 || s.woundInfected ? "danger" : hp < 70 || s.mood < 30 ? "warn" : "",
    line: `${where} · HP ${hp} · mood ${n0(s.mood)}${task ? ` · ${task.toLowerCase()}` : ""}`,
    go: { surv: s.id, tile },
  };
}
function teamStatus(state, it) {
  const p = state.parties.find((x) => x.id === it.id);
  if (!p || p.owner !== "player") return { gone: true, line: "no longer out (home, disbanded or lost)" };
  const members = partyMembers(state, p);
  const name = `${p.routeKind === "supply" ? "Supply run" : MISSIONS[p.teamMission || p.mission]?.name || "Team"} (${members.map((s) => first(s.name)).join(", ")})`;
  if (!(p.kind === "convoy" || contactable(p))) {
    const oneWay = p.etaBack == null && p.etaOut != null ? (p.planStart ?? p.departed) + p.etaOut : null;
    const at = oneWay != null ? oneWay : p.departed + (p.plannedHours || 0);
    return { name, tone: "muted", line: `no contact · ${oneWay != null ? "arrives" : "back"} around day ${Math.floor(at / 24) + 1}`, go: { team: p.id } };
  }
  const st = orderStatus(state, p);
  const moving = p.phase === "out" || p.phase === "back";
  const eta = moving && st.left != null ? ` · ETA ${Math.ceil(st.left)}h` : p.phase === "task" && st.left ? ` · ${Math.ceil(st.left)}h left` : "";
  const food = n0((p.supplies.food || 0) + (p.supplies.preserved || 0)), water = n0(waterIn(p.supplies));
  const heat = p.kind !== "convoy" ? Math.round(p.heat || 0) : 0;
  const short = food < members.length || water < members.length;
  return {
    name, tone: p.phase === "waiting" ? "warn" : short || heat >= 75 ? "danger" : heat >= 50 ? "warn" : "",
    line: `${st.label}${eta} · ${tileLabel(state, partyTile(p))} · food ${food} · water ${water}${p.kind !== "convoy" ? ` · Heat ${heat}` : ""}`,
    go: { team: p.id, tile: partyTile(p) },
  };
}
function hordeStatus(state, it) {
  const h = state.hordes.find((x) => x.id === it.id);
  if (h && live(state, h.tile)) {
    it.seen = { tile: h.tile, size: h.size, hour: state.hour }; // what you saw: shown once it is out of sight
    const nb = nearestBase(state, h.tile);
    const target = state.bases.find((b) => (h.goal && h.goal.baseId === b.id) || h.target === b.tile);
    const dir = target ? `heading for ${target.name}` : h.target != null && h.target !== h.tile ? `heading ${heading(state, h.tile, h.target)}` : "drifting";
    return {
      name: `Horde of ${h.size}`, tone: target || (nb && nb.dist <= WATCHLIST_NEAR) ? "danger" : "",
      line: `${h.size}${h.bosses ? " + Wallbreaker" : ""} · ${dir}${nb ? ` · ${nb.dist} tile${nb.dist === 1 ? "" : "s"} from ${nb.b.name}` : ""}`,
      go: { tile: h.tile },
    };
  }
  const seen = it.seen;
  if (!seen) return { tone: "muted", line: "out of sight", go: null };
  if (!h && live(state, seen.tile)) return { gone: true, line: "gone from where it was (merged, scattered or destroyed)", go: { tile: seen.tile } };
  const nb = nearestBase(state, seen.tile);
  return { name: `Horde of ${seen.size}?`, tone: "muted", line: `out of sight · last seen ${ageText(state, seen)}${nb ? `, ${nb.dist} tile${nb.dist === 1 ? "" : "s"} from ${nb.b.name}` : ""}`, go: { tile: seen.tile } };
}
function groupStatus(state, it) {
  const f = factionById(state, it.id);
  if (!f) return { gone: true, line: "gone" };
  if (!f.alive) return { gone: true, name: f.name, line: "collapsed" };
  const a = attitude(f), mine = playerStrength(state), theirs = strength(f);
  const ratio = mine > 0 ? theirs / mine : 9;
  return {
    name: f.name, tone: a === "Hostile" ? "danger" : a === "Neutral" ? "" : "good",
    line: `${a} (${Math.round(f.goodwill)}) · ~${Math.round(f.pop / 5) * 5 || f.pop} people · ${f.bases.length} base${f.bases.length === 1 ? "" : "s"} · ${ratio >= 1.5 ? "much stronger than you" : ratio >= 0.9 ? "about your strength" : ratio >= 0.5 ? "weaker than you" : "much weaker"}${f.pact ? ` · ${f.pact === "trade" ? "trade pact" : "non-aggression pact"}` : ""}`,
    tip: `Strength ${Math.round(theirs)} against your ${Math.round(mine)} (people × arms).`,
    go: { group: f.id, tile: f.known && f.bases.length ? f.bases[0] : null },
  };
}
// Threats near a base that you can see: hordes within WATCHLIST_NEAR tiles or heading for it, other groups' raids.
export function baseThreats(state, b) {
  const g = state.grid, out = [];
  for (const h of state.hordes) {
    if (!live(state, h.tile)) continue;
    const d = g.distance(h.tile, b.tile), coming = (h.goal && h.goal.baseId === b.id) || h.target === b.tile;
    if (coming || d <= WATCHLIST_NEAR) out.push({ text: `horde of ${h.size} ${d} tile${d === 1 ? "" : "s"} ${heading(state, b.tile, h.tile)}${coming ? ", coming" : ""}`, danger: coming || d <= 2, size: h.size });
  }
  for (const p of state.parties) {
    if (p.owner === "player" || p.kind !== "raid" || !p.path || !live(state, partyTile(p))) continue;
    const d = g.distance(partyTile(p), b.tile);
    if (d <= WATCHLIST_NEAR) out.push({ text: `raiders ${d} tile${d === 1 ? "" : "s"} ${heading(state, b.tile, partyTile(p))}`, danger: true, size: 0 });
  }
  return out.sort((a, c) => (c.danger - a.danger) || c.size - a.size);
}
function baseStatus(state, it) {
  const b = baseById(state, it.id);
  if (!b) return { gone: true, line: "lost" };
  const fo = foodOutlook(state, b), wo = waterOutlook(state, b);
  const out = (b.hungerDays > 0 || fo.stock < 1), dry = (b.thirstDays > 0 || waterIn(b.stock) < 1);
  const th = baseThreats(state, b);
  const low = out || dry || fo.daysLeft < 3 || wo.daysLeft < 2;
  return {
    name: b.name, tone: th.some((t) => t.danger) || out || dry ? "danger" : low || th.length ? "warn" : "",
    line: `food ${out ? "OUT" : daysText(fo.daysLeft)} · water ${dry ? "OUT" : daysText(wo.daysLeft)} · ${th.length ? th.slice(0, 2).map((t) => t.text).join("; ") + (th.length > 2 ? ` +${th.length - 2}` : "") : "no threat in sight"}`,
    tip: "Days of food and water at today's rate (the Bases tab has the breakdown); threats: hordes within 6 tiles or heading for it and raiders you can see.",
    go: { tile: b.tile },
  };
}
const STATUS = { person: personStatus, team: teamStatus, horde: hordeStatus, group: groupStatus, base: baseStatus };
export function watchlistStatus(state, it) {
  const st = (STATUS[it.kind] || (() => ({ gone: true, line: "gone" })))(state, it);
  if (st.name && !st.gone) it.name = st.name; // the latest name, kept for when it is gone
  return { ...st, name: st.name || it.name || it.kind };
}

// ---------- the panel ----------
export function renderWatchlist(state, ui, opts = {}) {
  const w = state.watchList, m = state.mapNotes;
  const items = w && w.items ? w.items : [];
  const notes = m && m.list ? m.list : [];
  if (!items.length && !notes.length) return "";
  const collapsed = (w && w.collapsed) || opts.folded;
  const box = { icon: "👁", title: "Watching", count: items.length, badges: notes.length ? [{ text: `📝 ${notes.length}`, tip: "Map notes" }] : [] };
  if (collapsed) return panelTab({ ...box, action: "wl-collapse", data: { v: "0" }, tip: "Show the Watching panel: what you pinned with 📌, and your map notes" });
  const rows = items.map((it) => {
    const st = watchlistStatus(state, it);
    return `<div class="wl-row ${st.gone ? "gone" : ""}" ${st.go ? `data-action="wl-go" data-kind="${it.kind}" data-id="${it.id}"` : ""}${tip(`${st.tip ? `${st.tip} ` : ""}${st.go ? "Click to go there." : ""}`)}>
      <div class="spread"><span class="wl-name">${KIND_ICON[it.kind] || ""} ${esc(st.name)}</span><button class="mini wl-x" data-action="wl-remove" data-kind="${it.kind}" data-id="${it.id}"${tip("Stop watching (unpin)")}>✕</button></div>
      <div class="small ${st.gone ? "muted" : st.tone || ""}">${esc(st.line)}</div>
    </div>`;
  }).join("");
  const open = !w || w.notesOpen !== false;
  const hidden = !!(m && m.hidden);
  const noteRows = open ? notes.map((n) => {
    const ic = NOTE_ICONS[n.icon] || NOTE_ICONS.flag;
    const arm = ui.mnDelArm === n.id;
    return `<div class="wl-note" data-action="mn-go" data-id="${n.id}"${tip(`${ic.name} at ${tileLabel(state, n.tile)}. Click to go there.`)}>
      <span class="wl-glyph">${ic.glyph}</span><span class="wl-ntext">${esc(n.text || ic.name)}</span>
      <button class="mini" data-action="mn-edit" data-id="${n.id}"${tip("Edit this note")}>✎</button><button class="mini ${arm ? "danger" : ""}" data-action="mn-del" data-id="${n.id}"${tip(arm ? "Click again to delete the note" : "Delete this note (click twice)")}>${arm ? "Delete?" : "✕"}</button>
    </div>`;
  }).join("") : "";
  return `${panelHead({ ...box, badges: [], action: "wl-collapse", data: { v: "1" }, tip: `Fold this panel. It lists what you pinned with 📌 (up to ${WATCHLIST_MAX}): a person's screen, a team's panel, the Groups and Bases tabs, a horde in the tile panel, or right-click a tile.` })}
    ${rows || `<div class="small muted">Nothing pinned. 📌 on a person, team, horde, group or base adds it here.</div>`}
    ${notes.length ? `<div class="spread wl-head wl-sub"><b${tip("Your notes on the map. Right-click a tile → Add note.")}>📝 Notes (${notes.length})</b><span class="row"><button class="mini ${hidden ? "active" : ""}" data-action="mn-hide"${tip(hidden ? "Notes are hidden on the map: show them" : "Hide all notes on the map (they stay in this list)")}>${hidden ? "🚫 Hidden" : "👁 Shown"}</button><button class="mini" data-action="wl-notes"${tip(open ? "Fold the notes list" : "Show the notes list")}>${open ? "▾" : "▸"}</button></span></div>${noteRows}` : ""}`;
}

// A 📌 button (opts.label: with "Watch" / "Watching" after it).
export function watchlistPin(state, kind, id, name = "", opts = {}) {
  const on = onWatchlist(state, kind, id);
  return `<button class="mini wl-pin ${on ? "on" : ""}" data-action="wl-pin" data-kind="${kind}" data-id="${id}" data-name="${esc(name)}"${tip(on ? `Pinned${name ? `: ${name}` : ""}. Click to unpin it from the Watching panel` : `Pin${name ? ` ${name}` : ""} to the Watching panel on the map (its status, live)`)}>📌${opts.label ? (on ? " Pinned" : " Pin") : ""}</button>`;
}

// Extra right-click menu buttons for a tile: watch what is on it, add a note, edit its notes.
export function ctxWatchlist(state, tile) {
  const out = [];
  const pin = (kind, id, name) => {
    const on = onWatchlist(state, kind, id);
    out.push(`<button data-action="wl-pin" data-kind="${kind}" data-id="${id}" data-name="${esc(name)}" data-ctx="1"${tip(on ? "Unpin it from the Watching panel" : "Pin it to the Watching panel on the map (top left): its status, live")}>📌 ${on ? "Unpin" : "Pin"} ${esc(name)}</button>`);
  };
  const base = state.bases.find((b) => b.tile === tile);
  if (base) pin("base", base.id, base.name);
  for (const f of state.factions || []) if (f.known && f.alive && f.bases.includes(tile) && (live(state, tile) || state.knowledge[tile])) pin("group", f.id, f.name);
  for (const h of state.hordes) if (h.tile === tile && live(state, tile)) pin("horde", h.id, `horde of ${h.size}`);
  for (const p of state.parties) if (p.owner === "player" && (p.kind === "convoy" || contactable(p)) && partyTile(p) === tile) pin("team", p.id, `${MISSIONS[p.teamMission || p.mission]?.name || "team"} (${partyMembers(state, p).map((s) => first(s.name)).join(", ")})`);
  for (const n of notesAt(state, tile)) out.push(`<button data-action="mn-edit" data-id="${n.id}" data-ctx="1"${tip("Change the icon or text, or delete it")}>✎ Edit note: ${(NOTE_ICONS[n.icon] || NOTE_ICONS.flag).glyph} ${esc(n.text || NOTE_ICONS[n.icon]?.name || "")}</button>`);
  out.push(`<button data-action="mn-add" data-tile="${tile}" data-ctx="1"${tip("Your own note on this tile: an icon and a short text (bridge to clear, cache here). Listed under Notes in the Watching panel.")}>📝 Add note here</button>`);
  return out.join("");
}

// ---------- actions ----------
const hideCtx = () => { if (hasDoc()) { const c = document.getElementById("ctxmenu"); if (c) c.classList.add("hidden"); } };
// Where the right-click menu was (the note editor opens there), in pixels within the map.
function ctxSpot() {
  if (!hasDoc()) return null;
  const c = document.getElementById("ctxmenu");
  return c && c.style.left ? { x: parseFloat(c.style.left) || 0, y: parseFloat(c.style.top) || 0 } : null;
}
function goWatchlist(state, ui, it, act) {
  const st = watchlistStatus(state, it);
  const g = st.go;
  if (!g) return;
  ui.roster = null; ui.diary = null;
  if (g.team != null) { act["xp-open"]({ id: g.team }); if (g.tile != null) act.center({ tile: g.tile }); return; }
  if (g.group != null) ui.tab = "groups";
  if (g.tile != null) act.center({ tile: g.tile });
  if (g.surv != null) ui.survivor = g.surv;
}
const flash = (ui, text) => { ui.flash = { text, at: typeof performance !== "undefined" ? performance.now() : 0 }; };

export const WATCHLIST_ACTIONS = {
  "wl-pin": (state, ui, d) => {
    const r = toggleWatchlist(state, d.kind, Number(d.id), d.name || "");
    if (typeof r === "string") flash(ui, r);
    if (r === true) { const it = watchlistOf(state).items.find((x) => x.kind === d.kind && x.id === Number(d.id)); if (it) watchlistStatus(state, it); } // a horde: where it is now
    if (d.ctx) hideCtx();
  },
  "wl-remove": (state, ui, d) => { unpinWatchlist(state, d.kind, Number(d.id)); },
  "wl-go": (state, ui, d, act) => { const it = watchlistOf(state).items.find((x) => x.kind === d.kind && x.id === Number(d.id)); if (it) goWatchlist(state, ui, it, act); },
  "wl-collapse": (state, ui, d) => { const w = watchlistOf(state); w.collapsed = d.v === undefined ? !w.collapsed : d.v === "1"; },
  "wl-notes": (state) => { const w = watchlistOf(state); w.notesOpen = w.notesOpen === false; },
  // Notes: the editor (ui.noteEdit: { tile, id (null for a new one), icon, text, x, y }) and the list.
  "mn-add": (state, ui, d) => { const s = d.ctx ? ctxSpot() : null; ui.noteEdit = { tile: Number(d.tile), id: null, icon: "flag", text: "", x: s ? s.x : null, y: s ? s.y : null, st: state }; if (d.ctx) hideCtx(); },
  "mn-edit": (state, ui, d) => {
    const n = noteById(state, d.id);
    if (!n) return;
    const s = d.ctx ? ctxSpot() : null;
    ui.noteEdit = { tile: n.tile, id: n.id, icon: n.icon, text: n.text, x: s ? s.x : null, y: s ? s.y : null, st: state };
    ui.mnDelArm = null;
    if (d.ctx) hideCtx();
  },
  "mn-icon": (state, ui, d) => { if (ui.noteEdit && NOTE_ICONS[d.icon]) { ui.noteEdit.icon = d.icon; markIcon(d.icon); } },
  "mn-save": (state, ui, d) => {
    const e = ui.noteEdit;
    if (!e) return;
    const text = d.text !== undefined ? d.text : readText(e.text);
    if (e.id != null && noteById(state, e.id)) editNote(state, e.id, { icon: e.icon, text });
    else { const r = addNote(state, e.tile, e.icon, text); if (typeof r === "string") { flash(ui, r); return; } }
    mapNotes(state).hidden = false; // a note just made is shown
    ui.noteEdit = null;
  },
  "mn-cancel": (state, ui) => { ui.noteEdit = null; },
  "mn-del": (state, ui, d) => {
    const id = Number(d.id);
    if (ui.noteEdit && ui.noteEdit.id === id) { deleteNote(state, id); ui.noteEdit = null; return; } // the editor's Delete
    if (ui.mnDelArm !== id) { ui.mnDelArm = id; return; } // click twice
    deleteNote(state, id);
    ui.mnDelArm = null;
  },
  "mn-go": (state, ui, d, act) => { const n = noteById(state, d.id); if (n) act.center({ tile: n.tile }); ui.mnDelArm = null; },
  "mn-hide": (state) => { setNotesHidden(state); },
};

// ---------- on the page ----------
const readText = (fallback) => { if (!hasDoc()) return fallback; const el = document.getElementById("mn-text"); return el ? el.value : fallback; };
function markIcon(k) {
  if (!hasDoc()) return;
  for (const b of document.querySelectorAll("#noteedit .mn-ic")) b.classList.toggle("on", b.dataset.icon === k);
}
let editorFor = null; // the ui.noteEdit the editor box was built for
function editorHTML(state, e) {
  const name = (mapLoc(state, e.tile) || {}).name || tileLabel(state, e.tile);
  return `<div class="spread"><b>📝 ${e.id != null ? "Edit note" : "New note"} · ${esc(name)}</b><button class="mini" data-action="mn-cancel"${tip("Close without saving (Esc)")}>✕</button></div>
    <div class="mn-icons">${NOTE_KEYS.map((k) => `<button class="mn-ic ${e.icon === k ? "on" : ""}" data-action="mn-icon" data-icon="${k}"${tip(NOTE_ICONS[k].name)}>${NOTE_ICONS[k].glyph}</button>`).join("")}</div>
    <input id="mn-text" type="text" maxlength="${NOTE_TEXT_MAX}" placeholder="Short text: bridge to clear, cache here…" value="${esc(e.text || "")}">
    <div class="row"><button class="primary" data-action="mn-save"${tip("Save the note (Enter)")}>Save</button>${e.id != null ? `<button data-action="mn-del" data-id="${e.id}"${tip("Delete this note")}>Delete</button>` : ""}<button data-action="mn-cancel">Cancel</button></div>`;
}
// The note editor box (#noteedit) follows ui.noteEdit: built when it opens, left alone while it is open (the typing
// stays), removed when it closes. Enter saves, Esc closes.
function syncEditor(state, ui, hooks) {
  if (!hasDoc()) return;
  const wrap = document.getElementById("mapwrap");
  if (!wrap) return;
  let el = document.getElementById("noteedit");
  if (ui.noteEdit && ui.noteEdit.st !== state) ui.noteEdit = null; // another game was loaded
  const e = ui.noteEdit;
  if (!e) { if (el) el.classList.add("hidden"); editorFor = null; return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "noteedit";
    el.className = "hidden";
    wrap.appendChild(el);
    el.addEventListener("keydown", (ev) => {
      if (ev.target.id !== "mn-text") return;
      const k = ev.key === "Enter" ? "mn-save" : ev.key === "Escape" ? "mn-cancel" : null;
      ev.stopPropagation(); // typing never reaches the map keys
      if (!k || !hooks.act || !hooks.act[k]) return;
      ev.preventDefault();
      hooks.act[k]({});
      if (hooks.refresh) hooks.refresh();
    });
  }
  if (editorFor === e) return;
  editorFor = e;
  el.innerHTML = editorHTML(state, e);
  el.classList.remove("hidden");
  // Where: at the right-click, else beside the Watching panel; inside the map either way.
  const watch = document.getElementById("watchlist");
  let x = e.x, y = e.y;
  if (x == null) { x = watch && !watch.classList.contains("hidden") ? watch.offsetLeft + watch.offsetWidth + 8 : 16; y = watch && !watch.classList.contains("hidden") ? watch.offsetTop : 16; }
  x = Math.max(4, Math.min(x, wrap.clientWidth - el.offsetWidth - 4));
  y = Math.max(4, Math.min(y, wrap.clientHeight - el.offsetHeight - 4));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  const input = document.getElementById("mn-text");
  if (input) { input.focus(); input.select(); }
}
// The Watching panel goes under the Running orders (or the paused banner) and stops above the Layers box.
function placeWatchlist() {
  const el = document.getElementById("watchlist");
  if (!el || el.classList.contains("hidden") || el.classList.contains("ov-placed")) return; // moved by the player (ui/overlaydrag.js)
  const wrap = el.parentElement, banner = document.getElementById("banner");
  // The running orders (above) and the Layers box (below) count only while they are in its column, in their half of
  // the map (either can be moved elsewhere).
  const inColumn = (id, top) => {
    const b = document.getElementById(id);
    return b && b.offsetLeft < el.offsetLeft + el.offsetWidth && b.offsetLeft + b.offsetWidth > el.offsetLeft && (b.offsetTop + b.offsetHeight / 2 < wrap.clientHeight / 2) === top ? b : null;
  };
  const orders = inColumn("orders", true), legend = inColumn("legend", false);
  const gap = Math.round((parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * 0.5);
  let top = gap;
  if (orders && !orders.classList.contains("hidden") && orders.offsetHeight) top = orders.offsetTop + orders.offsetHeight + gap;
  else if (banner && !banner.classList.contains("hidden") && banner.offsetHeight) top = banner.offsetTop + banner.offsetHeight + gap;
  const bottom = legend && !legend.classList.contains("hidden") && legend.offsetHeight ? legend.offsetTop - gap : wrap.clientHeight - gap;
  el.style.top = `${top}px`;
  el.style.maxHeight = `${Math.max(64, bottom - top)}px`;
}
// After each refresh (main.js): place the panel, keep the note editor in step. hooks: { act (main.js's action
// table), refresh } for the editor's Enter and Esc keys.
export function syncWatchlist(state, ui, hooks = {}) {
  if (!hasDoc()) return;
  placeWatchlist();
  syncEditor(state, ui, hooks);
}

// Help → Watch list and map notes (ui/help.js).
export const WATCHLIST_HELP = {
  title: "Watch list and map notes",
  html: `<b>📌 Pin</b> a person (their survivor screen), a team (its panel), a group (Groups tab), a base (Bases tab or the tile panel) or a horde you can see (the tile panel's Horde row), or right-click a tile for the base, group, hordes and teams on it. They go in the <b>Watching</b> panel at the top left of the map, under the Running orders (▾ folds it; Map only folds it too), up to ${WATCHLIST_MAX} at a time, saved with the campaign. Each row keeps its status live: <i>a person</i> where they are, health, mood and what they are doing; <i>a team</i> its order, ETA, place, food, water and Heat; <i>a horde</i> its size, where it is heading and how far it is from your nearest base; <i>a group</i> its attitude and goodwill, size, bases and strength against yours; <i>a base</i> its days of food and water and the threats you can see (hordes within ${WATCHLIST_NEAR} tiles or heading for it, raiders). What you cannot know stays unknown: a team out of radio contact shows when it is due, a horde out of sight where you last saw it. Click a row to go there; the dead, the lost and the gone grey out, and ✕ drops a row. <b>📝 Map notes</b>: right-click a tile → <i>Add note here</i>, pick an icon (flag, cache, danger, bridge, target, star, question, skull) and type a short text (Enter saves, Esc closes). Notes show as small pins on the map, their text in the tile's hover description and beside the pin when zoomed in. They are listed under Notes in the Watching panel: click one to go there, ✎ to edit, ✕ twice to delete, 👁 to hide them all on the map.`,
};
