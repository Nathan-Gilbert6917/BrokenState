// The search box (command palette): Ctrl+K or / on the map (ui/keymap.js win.palette), over any window but a card.
// Type a few letters of anything's name: your people (opens their screen), bases and outposts (centers the map and
// opens the base), teams (their panel), the other groups (their radio panel, else the map at their base), the sites
// and towns you know (centers the map), the buildings you can build at the selected base (its Construction tab, the
// button lit up), the menu (save, load, options, controls), the diary, roster and codex, the Help topics and the
// codex entries you have opened. ↑ ↓ pick, Enter goes, Esc (or a click outside) closes. Empty, it lists the last picks.
//
// The pure parts (paletteIndex, paletteSearch, paletteGo) take the state, ui and the action table, so the headless
// tools can run them (tools/navtest.js). The box itself is plain DOM built once (initPalette) and kept apart from the
// game's own panels: its rows carry data-pal, not data-action, so main.js's click handler leaves them alone.
import { BUILDINGS, canBuild } from "../sim/buildings.js";
import { LOCATIONS, FACTION_TYPES } from "../sim/data.js";
import { siteKnown } from "../sim/discovery.js";
import { partyTile, teamName, MISSIONS } from "../sim/parties.js";
import { canRadio } from "../sim/trade.js";
import { attitude } from "../sim/factions.js";
import { baseById } from "../sim/world.js";
import { openSettings } from "./settings.js";
import { openDiary } from "./diary.js";
import { openRoster } from "./roster.js";
import { codexEntries, codexSeen, CODEX_ACTIONS, openCodex } from "./codex.js";
import { helpTopics } from "./help.js";
import { keyLabel } from "./keymap.js";
import { openLedger } from "./ledger.js"; // the Ledger and the run summary
import { guideOn, GUIDE_MENU_ACTIONS } from "./guide.js"; // the first-week guide
import { SOUND_ACTIONS } from "./audio.js";
import { undoScreen, UNDO_ACTIONS, undoCount } from "./undo.js"; // the planner's, build queue's and Work tab's undo

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MAX_RESULTS = 40;
const RECENT_MAX = 8;
const KIND_NAMES = { person: "Person", base: "Base", team: "Team", group: "Group", site: "Place", build: "Build", menu: "Menu", help: "Help", codex: "Codex" };

// Build buttons go to the selected base: the base screen open, else the base on the selected tile, else the hub.
export function selectedBase(state, ui) {
  if (ui.baseView && baseById(state, ui.baseView.id)) return baseById(state, ui.baseView.id);
  return state.bases.find((b) => b.tile === ui.selected) || state.bases[0] || null;
}
// Reasons a building can never go up at this base (it is not listed); anything else (no scrap yet) is a hint.
const NEVER = /^(Limit reached|Outposts only|Shelters only|Not at a shelter|Already built)/;

// ---------- the index ----------
// [{ id, kind, label, hint, go(state, ui, act) }] for everything the box can find right now.
// options: the machine options (the sound's mute), when main.js has them.
export function paletteIndex(state, ui, options = API && API.options) {
  const out = [];
  // match: the text the letters are matched against (the label unless given: a build button matches its building's name).
  const add = (id, kind, label, hint, go, match = label) => out.push({ id, kind, label: String(label), hint: String(hint || ""), lc: String(match).toLowerCase(), go });
  for (const s of state.survivors) {
    if (!s.alive) continue;
    const loc = s.location || {};
    const where = loc.kind === "base" ? (baseById(state, loc.baseId) || {}).name : loc.kind === "party" ? "on a team" : loc.kind || "";
    add(`person:${s.id}`, "person", s.name, [s.role, where].filter(Boolean).join(" · "), (st, u) => { u.survivor = s.id; });
  }
  state.bases.forEach((b, i) => add(`base:${b.id}`, "base", b.name, `${b.type === "hub" ? "Hub" : "Outpost"}${i < 9 && keyLabel(`base.${i + 1}`, 1) ? ` · ${keyLabel(`base.${i + 1}`, 1)}` : ""}`,
    (st, u, act) => { act.center({ tile: b.tile }); act.openbase({ id: b.id }); }));
  for (const p of state.parties) {
    if (p.owner !== "player") continue;
    let name = "";
    try { name = teamName(state, p); } catch { name = `Team ${p.id}`; }
    add(`team:${p.id}`, "team", name, `${(MISSIONS[p.mission] || { name: p.mission || "" }).name} · ${p.phase || ""}`, (st, u, act) => { act["xp-open"]({ id: p.id }); act.center({ tile: partyTile(p) }); });
  }
  for (const f of state.factions) {
    if (!f.known) continue;
    const radio = f.alive && canRadio(state, f);
    add(`group:${f.id}`, "group", f.name, `${(FACTION_TYPES[f.type] || { label: "" }).label} · ${f.alive ? attitude(f) : "collapsed"}${radio ? " · radio" : ""}`, (st, u, act) => {
      u.tab = "groups";
      if (f.bases[0] != null) act.center({ tile: f.bases[0] });
      if (radio) act["rd-open"]({ id: f.id });
    });
  }
  for (const t of state.tiles) {
    if (!t.loc || !t.loc.name || !siteKnown(state, t.id)) continue;
    add(`site:${t.id}`, "site", t.loc.name, (LOCATIONS[t.loc.type] || { name: t.loc.type }).name, (st, u, act) => act.center({ tile: t.id }));
  }
  const base = ui.started ? selectedBase(state, ui) : null;
  if (base) {
    for (const [type, def] of Object.entries(BUILDINGS)) {
      const chk = canBuild(state, base, type);
      if (!chk.ok && NEVER.test(chk.reason || "")) continue;
      add(`build:${base.id}:${type}`, "build", `Build ${def.name}`, `${base.name}${chk.ok ? "" : ` · ${chk.reason}`}`, (st, u, act) => {
        act.openbase({ id: base.id, tab: "construction" });
        u.palFocus = { action: "queuebuild", type };
      }, def.name);
    }
  }
  const menu = [
    ["save", "Save game", "Menu → Game", (st, u) => openSettings(u, "game")],
    ["load", "Load game", "Menu → Game: the save list", (st, u) => openSettings(u, "game")],
    ["options", "Options", "Menu → Options", (st, u) => openSettings(u, "options")],
    ["controls", "Controls: change the keys", "Menu → Controls", (st, u) => openSettings(u, "controls")],
    ["keys", "Key sheet", "Help → Keys (printable)", (st, u) => openSettings(u, "help", "keys")],
    ["diary", "Diary", keyLabel("win.diary"), (st, u) => openDiary(u)],
    ["roster", "Roster", keyLabel("win.roster"), (st, u) => openRoster(u)],
    ["codex", "Codex", keyLabel("win.codex"), (st, u) => openCodex(u)],
    ["ledger", "Ledger", `Production, stock, people and mood over time · ${keyLabel("win.ledger")}`, (st, u) => openLedger(u, "ledger")],
    ["summary", "Run summary", "The run so far: timeline, best people, worst day", (st, u) => openLedger(u, "summary")],
    ["guide", `${guideOn(state) ? "Hide" : "Show"} the first-week guide`, "The checklist under the alerts", (st, u) => GUIDE_MENU_ACTIONS["gd-toggle"](st, u)],
    ["sound", `Sound: ${options && options.sound && options.sound.mute ? "unmute" : "mute"}`, "Volumes are in Menu → Options", (st, u) => SOUND_ACTIONS["snd-opt"](st, u, { k: "on" })],
    ["templates", "Order templates and Repeat trip", "Help topic: saved team setups, Repeat trip, Undo", (st, u) => openSettings(u, "help", "templates-repeat-trip-and-undo")],
    ["help", "Help", "Menu → Help", (st, u) => openSettings(u, "help")],
  ];
  const undo = undoScreen(state, ui); // the screen under the box keeps an undo list: undo is one pick away
  if (undo && undoCount(state, ui, undo.kind, undo.baseId)) menu.push(["undo", "Undo the last change", `${undo.kind === "plan" ? "Planner" : undo.kind === "build" ? "Build queue" : "Work tab"} · ${keyLabel("edit.undo", 1)}`, (st, u) => UNDO_ACTIONS["undo-step"](st, u, { kind: undo.kind, base: undo.baseId })]);
  for (const [id, label, hint, go] of menu) add(`menu:${id}`, "menu", label, hint, go);
  for (const t of helpTopics()) add(`help:${t.id}`, "help", t.title, "Help topic", (st, u) => openSettings(u, "help", t.id));
  for (const e of codexEntries()) if (codexSeen(state, e.key)) add(`codex:${e.key}`, "codex", e.name, e.sub, (st, u) => CODEX_ACTIONS["cx-open"](st, u, { key: e.key }));
  return out;
}

// ---------- matching ----------
// How well q matches a name (0: not at all): the whole name, its start, a word's start, inside it, then the letters in
// order (the closer together, the better). Short kinds people look for most (people, bases, teams, groups) rank first
// on a tie.
const KIND_RANK = { person: 6, base: 6, team: 5, group: 5, build: 4, menu: 4, site: 3, codex: 2, help: 1 };
export function matchScore(lc, q) {
  if (!q) return 0;
  if (lc === q) return 1000;
  const i = lc.indexOf(q);
  if (i === 0) return 900 - lc.length;
  if (i > 0) return (/[\s(\-:'.]/.test(lc[i - 1]) ? 800 : 600) - i - lc.length / 10;
  // The letters in order: "wtbr" → "Water barrel".
  let at = -1, gaps = 0, starts = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const j = lc.indexOf(ch, at + 1);
    if (j < 0) return 0;
    if (j === 0 || /[\s(\-:'.]/.test(lc[j - 1])) starts++;
    gaps += j - at - 1;
    at = j;
  }
  return Math.max(1, 300 + starts * 30 - gaps * 4 - lc.length / 10);
}
// The results for q: the best matches first (recent picks a little ahead); q empty: the recent picks, then the menu.
export function paletteSearch(index, q, recent = []) {
  q = String(q || "").trim().toLowerCase();
  const rIdx = new Map(recent.map((id, i) => [id, i]));
  if (!q) {
    const byId = new Map(index.map((e) => [e.id, e]));
    const rec = recent.map((id) => byId.get(id)).filter(Boolean).map((e) => ({ ...e, recent: true }));
    const rest = index.filter((e) => (e.kind === "menu" || e.kind === "base") && !rIdx.has(e.id));
    return [...rec, ...rest].slice(0, MAX_RESULTS);
  }
  const out = [];
  for (const e of index) {
    let s = matchScore(e.lc, q);
    if (!s && q.length > 2 && e.hint) s = matchScore(e.hint.toLowerCase(), q) * 0.3; // "outpost", "hospital": the hint
    if (!s) continue;
    s += (KIND_RANK[e.kind] || 0) + (rIdx.has(e.id) ? 50 - rIdx.get(e.id) : 0);
    out.push({ e, s });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, MAX_RESULTS).map((r) => (rIdx.has(r.e.id) ? { ...r.e, recent: true } : r.e));
}
// Runs a result and remembers it as a recent pick (ui.paletteRecent: ids, newest first; this session only).
export function paletteGo(state, ui, entry, act) {
  if (!entry) return;
  ui.paletteRecent = [entry.id, ...(ui.paletteRecent || []).filter((id) => id !== entry.id)].slice(0, RECENT_MAX);
  ui.diary = null; ui.roster = null; ui.ledger = null; ui.codex = entry.kind === "codex" ? ui.codex : null; // a jump leaves the list windows
  entry.go(state, ui, act);
}

// ---------- the box (DOM) ----------
let API = null, root = null, input = null, resBox = null, index = [], results = [], sel = 0;
// main.js: { getState(), ui, actions, refresh() }.
export function initPalette(api) { API = api; }
export const paletteOpen = () => !!(root && !root.classList.contains("hidden"));

function build() {
  root = document.createElement("div");
  root.id = "palette";
  root.className = "palette hidden";
  root.innerHTML = `<div class="palbox" role="dialog" aria-label="Search"><input id="palq" type="text" autocomplete="off" spellcheck="false" placeholder="Search people, bases, teams, groups, places, buildings, help…">
    <div id="palres" class="palres"></div><div class="palfoot small muted">↑ ↓ pick · Enter go · Esc close</div></div>`;
  document.body.appendChild(root);
  input = root.querySelector("#palq");
  resBox = root.querySelector("#palres");
  input.addEventListener("input", () => { sel = 0; show(); });
  input.addEventListener("keydown", (e) => {
    if (e.code === "ArrowDown" || e.code === "ArrowUp") { e.preventDefault(); sel = (sel + (e.code === "ArrowDown" ? 1 : -1) + results.length) % Math.max(1, results.length); show(false); }
    else if (e.code === "Enter" || e.code === "NumpadEnter") { e.preventDefault(); pick(sel); }
    else if (e.code === "Escape") { e.preventDefault(); closePalette(); }
    else if (e.code === "Tab") e.preventDefault();
    e.stopPropagation();
  });
  root.addEventListener("mousedown", (e) => {
    const row = e.target.closest("[data-pal]");
    if (row) { e.preventDefault(); pick(Number(row.dataset.pal)); return; }
    if (!e.target.closest(".palbox")) closePalette();
  });
  root.addEventListener("mousemove", (e) => {
    const row = e.target.closest("[data-pal]");
    if (row && Number(row.dataset.pal) !== sel) { sel = Number(row.dataset.pal); show(false); }
  });
}
function show(search = true) {
  if (search) results = paletteSearch(index, input.value, API.ui.paletteRecent || []);
  if (sel >= results.length) sel = Math.max(0, results.length - 1);
  resBox.innerHTML = results.length ? results.map((r, i) => `<div class="palrow${i === sel ? " sel" : ""}" data-pal="${i}"><span class="palkind k-${r.kind}">${KIND_NAMES[r.kind] || r.kind}</span><span class="pallabel">${esc(r.label)}</span><span class="palhint small muted">${r.recent ? "recent · " : ""}${esc(r.hint)}</span></div>`).join("")
    : `<div class="muted small palnone">Nothing by that name.</div>`;
  const cur = resBox.querySelector(".palrow.sel");
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
}
export function openPalette() {
  if (!API || typeof document === "undefined") return;
  if (!root) build();
  index = paletteIndex(API.getState(), API.ui);
  input.value = "";
  sel = 0;
  root.classList.remove("hidden");
  show();
  input.focus();
}
export function closePalette() {
  if (!root) return;
  root.classList.add("hidden");
  if (document.activeElement === input) input.blur();
}
function pick(i) {
  const r = results[i];
  if (!r) return;
  closePalette();
  const state = API.getState(), ui = API.ui;
  paletteGo(state, ui, r, API.actions);
  API.refresh();
  // A build button: light it up on the Construction tab once it is drawn.
  const f = ui.palFocus;
  ui.palFocus = null;
  if (f) setTimeout(() => {
    const el = document.querySelector(`[data-action="${f.action}"][data-type="${f.type}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("palflash");
    setTimeout(() => el.classList.remove("palflash"), 2500);
  }, 0);
}
