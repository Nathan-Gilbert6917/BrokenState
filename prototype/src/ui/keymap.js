// Every key the game answers, in one table (KEYMAP), and the player's own bindings over it (Menu → Controls,
// ui/controls.js). The handlers ask this module which action a key press is (keyAction / keyIs) instead of testing
// e.code themselves, so a key changed in the menu changes everywhere at once.
//
// ADDING A KEY: one line in KEYMAP below, e.g.
//     { id: "win.ledger", label: "Ledger", group: "Windows", ctx: "map", keys: ["KeyK"] },
// then, where the keys of that context are handled (main.js and ui/alerts.js mapHotkey for "map", ui/combat.js for
// "battle", ui/timelapse.js, ui/title.js), test it: `if (keyIs(e, "win.ledger")) ...` or `keyAction(e, "map") === "win.ledger"`.
// The Controls tab, the conflict check and the printable Keys sheet (Help) pick it up by themselves.
//
// A binding is a chord: the modifiers in the order Ctrl, Alt, Shift, Meta, then the key's e.code ("Shift+KeyP",
// "Ctrl+Digit4", "BracketLeft"). A key press matches a chord exactly: Shift+H is not H. ctx: where the key works
// ("map": the State Map and its panels, "queue": a selected order in the team panel's queue, "edit": the screens with
// an undo list (the planner, a build queue, the Work tab), "battle", "timelapse",
// "title": the title screen's menu, "work": a base's Work tab). Two actions of one context on the same chord are a
// conflict (the Controls tab warns; the first in the table wins). fixed: shown in the lists, not rebindable, and
// matched by its own handler (Esc, the Work tab's number keys).
//
// The player's bindings are a machine option (ui/saves.js options.keys: { actionId: [chords] }, only the changed
// actions), loaded by initKeymap at startup. Without it (the headless tools) the defaults hold.

const range = (n, from = 1) => Array.from({ length: n }, (_, i) => i + from);

export const KEY_GROUPS = ["Time", "Map", "Panels", "Windows", "Teams", "Bases", "Camera spots", "Dev", "Team queue", "Undo",
  "Battle", "Battle orders", "Battle view", "Battle units", "Timelapse", "Title menu", "Work tab", "Questions"];
export const KEY_CTX = { map: "Map", queue: "Team queue", edit: "Planner, build queue, Work tab", battle: "Battle", timelapse: "Timelapse", title: "Title menu", work: "Work tab", ask: "A question box", note: "A map note" };

export const KEYMAP = [
  // ---------- the State Map (main.js keydown, ui/alerts.js mapHotkey) ----------
  { id: "ui.close", label: "Close the top window (the menu's question, a card opened from the tray goes back to it, the Why? panel, the Ledger…); with nothing open, the menu", group: "Windows", ctx: "map", keys: ["Escape"], fixed: true },
  { id: "time.pause", label: "Pause / run", group: "Time", ctx: "map", keys: ["Space"] },
  ...[0.5, 1, 2, 3, 5].map((v, i) => ({ id: `time.speed${i + 1}`, label: `Speed ${v}×`, group: "Time", ctx: "map", keys: [`Digit${i + 1}`, `Numpad${i + 1}`] })), // ui/pacing.js SPEEDS
  { id: "map.panUp", label: "Pan up", group: "Map", ctx: "map", keys: ["KeyW", "ArrowUp"] },
  { id: "map.panDown", label: "Pan down", group: "Map", ctx: "map", keys: ["KeyS", "ArrowDown"] },
  { id: "map.panLeft", label: "Pan left", group: "Map", ctx: "map", keys: ["KeyA", "ArrowLeft"] },
  { id: "map.panRight", label: "Pan right", group: "Map", ctx: "map", keys: ["KeyD", "ArrowRight"] },
  { id: "map.hub", label: "Center on the hub", group: "Map", ctx: "map", keys: ["KeyH"] },
  { id: "map.infection", label: "Infection overlay", group: "Map", ctx: "map", keys: ["KeyI"] },
  { id: "map.fronts", label: "Weather fronts overlay", group: "Map", ctx: "map", keys: ["Shift+KeyW"] }, // ui/wxmap.js
  { id: "map.minimap", label: "Minimap: show or hide", group: "Map", ctx: "map", keys: ["KeyM"] }, // ui/display.js displayKey
  { id: "tab.bases", label: "Bases tab", group: "Panels", ctx: "map", keys: ["KeyB"] },
  { id: "tab.people", label: "People tab", group: "Panels", ctx: "map", keys: ["KeyP"] },
  { id: "tab.groups", label: "Groups tab", group: "Panels", ctx: "map", keys: ["KeyG"] },
  { id: "tab.teams", label: "Teams tab", group: "Panels", ctx: "map", keys: ["KeyT"] },
  { id: "panel.left", label: "Fold or show the left panel", group: "Panels", ctx: "map", keys: ["BracketLeft"] },
  { id: "panel.right", label: "Fold or show the right panel", group: "Panels", ctx: "map", keys: ["BracketRight"] },
  { id: "panel.log", label: "Fold or show the log", group: "Panels", ctx: "map", keys: ["KeyL"] },
  { id: "panel.orders", label: "Fold or show the running orders", group: "Panels", ctx: "map", keys: ["Shift+BracketLeft"] },
  { id: "panel.alerts", label: "Fold or show the alerts", group: "Panels", ctx: "map", keys: ["Shift+BracketRight"] },
  { id: "panel.closeLeft", label: "Close the left panel completely (again: back)", group: "Panels", ctx: "map", keys: ["Alt+BracketLeft"] },
  { id: "panel.closeRight", label: "Close the right panel completely (again: back)", group: "Panels", ctx: "map", keys: ["Alt+BracketRight"] },
  { id: "panel.closeLog", label: "Close the log completely (again: back)", group: "Panels", ctx: "map", keys: ["Alt+KeyL"] },
  { id: "panel.all", label: "Map only: fold every panel (again: back)", group: "Panels", ctx: "map", keys: ["Backslash", "IntlBackslash"] },
  { id: "win.diary", label: "Diary", group: "Windows", ctx: "map", keys: ["KeyJ"] },
  { id: "win.roster", label: "Roster", group: "Windows", ctx: "map", keys: ["KeyR"] },
  { id: "win.codex", label: "Codex", group: "Windows", ctx: "map", keys: ["KeyC"] },
  { id: "win.ledger", label: "Ledger and run summary", group: "Windows", ctx: "map", keys: ["KeyE"] }, // ui/ledger.js ledgerKey
  { id: "win.palette", label: "Search (command palette)", group: "Windows", ctx: "map", keys: ["Ctrl+KeyK", "Slash"] },
  { id: "team.next", label: "Next team waiting for orders", group: "Teams", ctx: "map", keys: ["Tab", "KeyN"] },
  { id: "team.prev", label: "Previous team waiting for orders", group: "Teams", ctx: "map", keys: ["Shift+Tab", "Shift+KeyN"] },
  ...range(9).map((n) => ({ id: `base.${n}`, label: n === 1 ? "Jump to the hub (base 1)" : `Jump to base ${n}`, group: "Bases", ctx: "map", keys: [`F${n}`] })),
  ...range(9).map((n) => ({ id: `cam.save${n}`, label: `Save camera spot ${n}`, group: "Camera spots", ctx: "map", keys: [`Ctrl+Digit${n}`, `Alt+Digit${n}`, `Ctrl+Numpad${n}`, `Alt+Numpad${n}`] })),
  ...range(9).map((n) => ({ id: `cam.go${n}`, label: `Go to camera spot ${n}`, group: "Camera spots", ctx: "map", keys: [`Shift+Digit${n}`, `Shift+Numpad${n}`] })),
  { id: "dev.tools", label: "Dev tools (with Show dev tools on, in Options → Display)", group: "Dev", ctx: "map", keys: ["Backquote"] }, // ui/display.js
  { id: "dev.autopilot", label: "Autopilot on / off (with Show dev tools on)", group: "Dev", ctx: "map", keys: ["Shift+KeyP"] },
  // A selected order in the team panel's queue (main.js; ui/expedition.js queueBlock): these come before the map's.
  { id: "queue.up", label: "Move the selected order up", group: "Team queue", ctx: "queue", keys: ["ArrowUp"] },
  { id: "queue.down", label: "Move the selected order down", group: "Team queue", ctx: "queue", keys: ["ArrowDown"] },
  { id: "queue.remove", label: "Remove the selected order", group: "Team queue", ctx: "queue", keys: ["Delete", "Backspace"] },
  // Undo on the screens that keep an undo list (ui/undo.js undoKey): the planner, a base's build queue, the Work tab. Never in battle.
  { id: "edit.undo", label: "Undo the last change (planner, build queue, Work tab)", group: "Undo", ctx: "edit", keys: ["Ctrl+KeyZ", "Meta+KeyZ"] },

  // ---------- battle (ui/combat.js combatKey; the view's keys first) ----------
  { id: "bview.panUp", label: "Pan up (held)", group: "Battle view", ctx: "battle", keys: ["KeyW", "ArrowUp"] },
  { id: "bview.panDown", label: "Pan down (held)", group: "Battle view", ctx: "battle", keys: ["KeyS", "ArrowDown"] },
  { id: "bview.panLeft", label: "Pan left (held)", group: "Battle view", ctx: "battle", keys: ["KeyA", "ArrowLeft"] },
  { id: "bview.panRight", label: "Pan right (held)", group: "Battle view", ctx: "battle", keys: ["KeyD", "ArrowRight"] },
  // Q / E turn the view (as in most games that turn a camera); , and . (the keys before) still do too.
  { id: "bview.rotLeft", label: "Turn the view left", group: "Battle view", ctx: "battle", keys: ["KeyQ", "Comma"] },
  { id: "bview.rotRight", label: "Turn the view right", group: "Battle view", ctx: "battle", keys: ["KeyE", "Period"] },
  { id: "bview.zoomIn", label: "Zoom in", group: "Battle view", ctx: "battle", keys: ["Equal", "NumpadAdd"] },
  { id: "bview.zoomOut", label: "Zoom out", group: "Battle view", ctx: "battle", keys: ["Minus", "NumpadSubtract"] },
  { id: "bview.center", label: "Center on the selected unit", group: "Battle view", ctx: "battle", keys: ["Home"] }, // V before (V is Melee now)
  { id: "bview.roofs", label: "Roofs on / off", group: "Battle view", ctx: "battle", keys: ["KeyB"] },
  { id: "bview.floorUp", label: "Show the floor above", group: "Battle view", ctx: "battle", keys: ["PageUp"] },
  { id: "bview.floorDown", label: "Show the floor below", group: "Battle view", ctx: "battle", keys: ["PageDown"] },
  { id: "battle.cancel", label: "Cancel the current action, close a question", group: "Battle", ctx: "battle", keys: ["Escape"], fixed: true },
  { id: "battle.endTurn", label: "End the turn (may ask first); close the result", group: "Battle", ctx: "battle", keys: ["Space"] },
  { id: "battle.confirm", label: "End the turn at once; start the fight; give the retreat order", group: "Battle", ctx: "battle", keys: ["Enter", "NumpadEnter"] },
  { id: "battle.next", label: "Next unit with actions", group: "Battle units", ctx: "battle", keys: ["Tab"] },
  { id: "battle.prev", label: "Previous unit with actions", group: "Battle units", ctx: "battle", keys: ["Shift+Tab"] },
  ...range(9).map((n) => ({ id: `battle.unit${n}`, label: `Select unit ${n}`, group: "Battle units", ctx: "battle", keys: [`Digit${n}`] })),
  { id: "battle.autoplay", label: "The AI plays your side (again: take back control)", group: "Battle", ctx: "battle", keys: ["Shift+KeyA"] },
  { id: "battle.retreatAll", label: "Sound the retreat (on a wall map: fall back to the yard)", group: "Battle", ctx: "battle", keys: ["Shift+KeyR"] },
  { id: "battle.clear", label: "The area is clear enough: end the fight", group: "Battle", ctx: "battle", keys: ["Shift+KeyC"] },
  { id: "bview.hud", label: "Fold or open the squad strip and the weapon panel", group: "Battle view", ctx: "battle", keys: ["Backquote"] }, // ui/battlehud.js
  { id: "battle.search", label: "Search the container or body next to the unit", group: "Battle orders", ctx: "battle", keys: ["Shift+KeyS"], v: "search" },
  { id: "battle.ground", label: "Ground: put things down, pick them up", group: "Battle orders", ctx: "battle", keys: ["Shift+KeyX"], v: "ground" },
  { id: "battle.quick", label: "Quick search (raid)", group: "Battle orders", ctx: "battle", keys: ["Shift+KeyQ"], v: "quick" },
  { id: "battle.drag", label: "Drag a body, or a downed teammate (again: put them down)", group: "Battle orders", ctx: "battle", keys: ["Shift+KeyD"], v: "drag" },
  // Medics (sim/medics.js): a med kit makes one; Finish kills a downed enemy for good (dragging a downed teammate is
  // Shift+D above). Kept clear of the wave1-int branch's Shift+F, J, O, G, I and T.
  { id: "battle.heal", label: "Heal (a medic: a med kit)", group: "Battle orders", ctx: "battle", keys: ["Shift+KeyH"], v: "heal" },
  { id: "battle.revive", label: "Revive a downed teammate (a medic)", group: "Battle orders", ctx: "battle", keys: ["Shift+KeyV"], v: "revive" },
  { id: "battle.finish", label: "Finish a downed enemy", group: "Battle orders", ctx: "battle", keys: ["Shift+KeyK"], v: "finish" },
  { id: "battle.gunner", label: "Man the vehicle's turret (again: get down)", group: "Battle orders", ctx: "battle", keys: ["Shift+KeyT"], v: "gunner" },
  { id: "battle.pullOut", label: "Pull someone downed out of a vehicle (from next to it)", group: "Battle orders", ctx: "battle", keys: ["Shift+KeyU"], v: "pullOut" },
  // The unit orders (combatAction "cb-act" with v). Melee is V and Close a door Shift+E since Q / E turn the view
  // (they were E and Q; Center, V before, went to Home).
  ...[["shoot", "Shoot", "KeyF"], ["melee", "Melee", "KeyV"], ["meds", "Meds", "KeyM"], ["overwatch", "Overwatch", "KeyO"], ["hunker", "Hunker down", "KeyH"], ["reload", "Reload the gun", "KeyI"],
    ["retreat", "Retreat (from the evac strip)", "KeyR"], ["vehicle", "Open the vehicle", "KeyN"], ["extract", "Extract (raid)", "KeyX"], ["subdue", "Subdue", "KeyC"],
    ["tie", "Tie up", "KeyT"], ["throw", "Throw", "KeyG"], ["climb", "Climb", "KeyL"], ["peek", "Peek", "KeyK"], ["close", "Close a door", "Shift+KeyE"], ["brace", "Brace a door", "KeyY"],
    ["crush", "Crush the skull of a body", "KeyU"], ["doubletap", "Double tap a body", "KeyJ"], ["pickup", "Pick up / put down a body", "KeyP"], ["stowbody", "Stow a body in the vehicle", "KeyZ"]]
    .map(([v, label, code]) => ({ id: `battle.${v}`, label, group: "Battle orders", ctx: "battle", keys: [code], v })),
  // The weapons overhaul's gun orders (ui/combat.js gunButtons): every letter is taken, so they sit on Shift.
  ...[["firemode", "Fire mode: single, burst, auto (free)", "Shift+KeyF"], ["unjam", "Clear a jam (Unjam)", "Shift+KeyJ"], ["suppress", "Suppressing fire (pick where)", "Shift+KeyO"],
    ["throwspear", "Throw the spear", "Shift+KeyG"], ["pickspear", "Pick up your thrown spear", "Shift+KeyP"], ["ammocycle", "Reload: pick the next kind of round", "Shift+KeyI"],
    ["visor", "Raise or lower the visor (free)", "Shift+KeyY"],
    ["launch", "Launch a grenade or a rocket (pick where; an empty launcher: reload it)", "Shift+KeyL"]]
    .map(([v, label, code]) => ({ id: `battle.${v}`, label, group: "Battle orders", ctx: "battle", keys: [code], v })),

  // ---------- the timelapse (ui/timelapse.js tlKey) ----------
  { id: "tl.play", label: "Play / pause", group: "Timelapse", ctx: "timelapse", keys: ["Space"] },
  { id: "tl.back", label: "One day back", group: "Timelapse", ctx: "timelapse", keys: ["ArrowLeft"] },
  { id: "tl.fwd", label: "One day on", group: "Timelapse", ctx: "timelapse", keys: ["ArrowRight"] },
  { id: "tl.start", label: "To the start", group: "Timelapse", ctx: "timelapse", keys: ["Home"] },
  { id: "tl.end", label: "To the end", group: "Timelapse", ctx: "timelapse", keys: ["End"] },
  ...[1, 2, 5, 10].map((v, i) => ({ id: `tl.speed${i + 1}`, label: `${v} day${v === 1 ? "" : "s"} a second`, group: "Timelapse", ctx: "timelapse", keys: [`Digit${i + 1}`] })),
  { id: "tl.fit", label: "Fit the map", group: "Timelapse", ctx: "timelapse", keys: ["KeyF"] },
  { id: "tl.infection", label: "Infection layer", group: "Timelapse", ctx: "timelapse", keys: ["KeyI"] },
  { id: "tl.territory", label: "Territory layer", group: "Timelapse", ctx: "timelapse", keys: ["KeyT"] },
  { id: "tl.panUp", label: "Pan up", group: "Timelapse", ctx: "timelapse", keys: ["KeyW", "ArrowUp"] },
  { id: "tl.panDown", label: "Pan down", group: "Timelapse", ctx: "timelapse", keys: ["KeyS", "ArrowDown"] },
  { id: "tl.panLeft", label: "Pan left", group: "Timelapse", ctx: "timelapse", keys: ["KeyA"] },
  { id: "tl.panRight", label: "Pan right", group: "Timelapse", ctx: "timelapse", keys: ["KeyD"] },
  { id: "tl.close", label: "Close the timelapse", group: "Timelapse", ctx: "timelapse", keys: ["Escape"], fixed: true },

  // ---------- the title screen's menu (ui/title.js titleKey); Enter presses the button (the browser's own) ----------
  { id: "title.up", label: "Previous menu button", group: "Title menu", ctx: "title", keys: ["ArrowUp"] },
  { id: "title.down", label: "Next menu button", group: "Title menu", ctx: "title", keys: ["ArrowDown"] },

  // ---------- boxes with their own Enter and Esc: fixed ----------
  // The confirmation box (ui/confirm.js askKey) and the menu's question (main.js): it takes the keyboard while it is up.
  { id: "ask.yes", label: "Yes: give the order", group: "Questions", ctx: "ask", keys: ["Enter", "NumpadEnter"], fixed: true },
  { id: "ask.no", label: "Cancel", group: "Questions", ctx: "ask", keys: ["Escape"], fixed: true },
  // A map note being written (ui/watchlist.js, its own text box).
  { id: "note.save", label: "Save the map note", group: "Questions", ctx: "note", keys: ["Enter"], fixed: true },
  { id: "note.cancel", label: "Close the note without saving", group: "Questions", ctx: "note", keys: ["Escape"], fixed: true },

  // ---------- a base's Work tab, the cell under the mouse (ui/work.js workKey): fixed, by their numbers ----------
  { id: "work.set", label: "Set the priority 1–5", group: "Work tab", ctx: "work", keys: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"], fixed: true },
  { id: "work.clear", label: "Clear the priority", group: "Work tab", ctx: "work", keys: ["Digit0", "Backspace", "Delete"], fixed: true },
  { id: "work.reset", label: "Back to the role's default", group: "Work tab", ctx: "work", keys: ["KeyR"], fixed: true },
];
export const KEY_BY_ID = new Map(KEYMAP.map((k) => [k.id, k]));

// ---------- chords ----------
const MODS = ["Ctrl", "Alt", "Shift", "Meta"];
const MOD_CODES = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight", "CapsLock", "Fn", "ContextMenu"]);
const CHORD_RE = /^((Ctrl|Alt|Shift|Meta)\+)*[A-Za-z][A-Za-z0-9]*$/;
// The chord of a key press ("" for a modifier alone). Missing modifier flags count as up (the tools' fake events).
export function chordOf(e) {
  const code = (e && e.code) || "";
  if (!code || MOD_CODES.has(code)) return "";
  return `${e.ctrlKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${e.metaKey ? "Meta+" : ""}${code}`;
}
// "Alt+Ctrl+KeyK" → "Ctrl+Alt+KeyK" (the one spelling every table uses).
export function normChord(c) {
  const parts = String(c || "").split("+").filter(Boolean);
  const code = parts.pop() || "";
  return MODS.filter((m) => parts.includes(m)).map((m) => `${m}+`).join("") + code;
}
export const chordCode = (c) => String(c || "").split("+").pop();
export const validChord = (c) => typeof c === "string" && CHORD_RE.test(c) && !MOD_CODES.has(chordCode(c));

// ---------- bindings ----------
let custom = {};    // actionId -> [chords]: the player's (options.keys)
let options = null; // the machine options object it lives in (saved by the caller)
let index = null;   // ctx -> Map(chord -> [actionIds]), rebuilt after every change

// Default keys an action was given in a later build: Q / E turn the battle view, Melee V, Close a door Shift+E, Center
// Home (they were , . E Q V). A player whose own bindings (options.keys) already put another action of the same context
// on one of these keeps theirs: the new default steps aside for them (the action keeps its other keys, or has none
// until they pick one in Menu → Controls). Saved bindings are never rewritten; Reset gives the defaults back.
export const NEW_DEFAULTS = { "bview.rotLeft": ["KeyQ"], "bview.rotRight": ["KeyE"], "bview.center": ["Home"], "battle.melee": ["KeyV"], "battle.close": ["Shift+KeyE"] };
let yielded = new Set(); // "id|chord": a new default key the player's own binding of another action holds
function findYielded() {
  yielded = new Set();
  for (const [id, list] of Object.entries(NEW_DEFAULTS)) {
    const def = KEY_BY_ID.get(id);
    if (!def || custom[id]) continue;
    for (const c of list) if (KEYMAP.some((k) => k.id !== id && k.ctx === def.ctx && custom[k.id] && custom[k.id].includes(c))) yielded.add(`${id}|${c}`);
  }
}

// The keys of an action now (the player's, else the defaults).
export const keysOf = (id) => {
  if (custom[id]) return custom[id];
  const keys = (KEY_BY_ID.get(id) || {}).keys || [];
  return yielded.size ? keys.filter((c) => !yielded.has(`${id}|${c}`)) : keys;
};
export const isCustom = (id) => !!custom[id];
// The new default keys of an action that stepped aside for the player's own binding of another: [{ chord, by }].
export function steppedAside(id) {
  if (!index) buildIndex();
  const def = KEY_BY_ID.get(id);
  return (NEW_DEFAULTS[id] || []).filter((c) => yielded.has(`${id}|${c}`)).map((c) => ({ chord: c, by: (KEYMAP.find((k) => k.id !== id && k.ctx === def.ctx && custom[k.id] && custom[k.id].includes(c)) || {}).id }));
}

function buildIndex() {
  findYielded();
  index = {};
  for (const k of KEYMAP) {
    if (k.fixed) continue;
    const m = index[k.ctx] || (index[k.ctx] = new Map());
    for (const c of keysOf(k.id)) { if (!m.has(c)) m.set(c, []); m.get(c).push(k.id); }
  }
}

// Reads the player's bindings from the machine options (ui/saves.js loadOptions keeps options.keys as it was saved).
// Bad entries are dropped; actions the table no longer has are kept (an older or newer build may know them).
export function initKeymap(opts) {
  options = opts || null;
  custom = {};
  const raw = opts && opts.keys && typeof opts.keys === "object" ? opts.keys : {};
  for (const [id, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    const def = KEY_BY_ID.get(id);
    if (def && def.fixed) continue;
    custom[id] = [...new Set(list.filter(validChord).map(normChord))];
  }
  buildIndex();
}
function store() {
  if (options) options.keys = Object.keys(custom).length ? JSON.parse(JSON.stringify(custom)) : undefined;
  buildIndex();
}

// The action a key press is in a context (the first one in the table on a conflict), or null.
export function keyAction(e, ctx) {
  if (!index) buildIndex();
  const m = index[ctx];
  const ids = m && m.get(chordOf(e));
  return ids ? ids[0] : null;
}
export const keyIs = (e, id) => { const k = KEY_BY_ID.get(id); return !!k && keyAction(e, k.ctx) === id; };
// Every action of a context bound to a key's code whatever the modifiers (keyup: a held pan key let go after Shift).
export function actionsOfCode(code, ctx) {
  if (!index) buildIndex();
  const out = new Set();
  for (const [c, ids] of index[ctx] || []) if (chordCode(c) === code) ids.forEach((id) => out.add(id));
  return [...out];
}

// Sets key i of an action (i past the end: adds one). Returns the actions it now clashes with ([] when none).
export function setBinding(id, i, chord) {
  const def = KEY_BY_ID.get(id);
  if (!def || def.fixed || !validChord(chord)) return null;
  const c = normChord(chord);
  const list = keysOf(id).slice();
  if (i == null || i >= list.length) list.push(c); else list[i] = c;
  custom[id] = [...new Set(list)];
  store();
  return clashes(id, c);
}
export function removeBinding(id, i) {
  const def = KEY_BY_ID.get(id);
  if (!def || def.fixed) return;
  const list = keysOf(id).slice();
  list.splice(i, 1);
  custom[id] = list;
  store();
}
export function resetBinding(id) { delete custom[id]; store(); }
export function resetAll() { custom = {}; store(); }

// The other actions of the same context on chord c.
export function clashes(id, c) {
  const def = KEY_BY_ID.get(id);
  if (!def) return [];
  return KEYMAP.filter((k) => k.id !== id && k.ctx === def.ctx && keysOf(k.id).includes(c)).map((k) => k.id);
}
// Every clash: [{ ctx, chord, ids }].
export function conflicts() {
  const out = [];
  for (const ctx of Object.keys(KEY_CTX)) {
    const seen = new Map();
    for (const k of KEYMAP) if (k.ctx === ctx) for (const c of keysOf(k.id)) { if (!seen.has(c)) seen.set(c, []); seen.get(c).push(k.id); }
    for (const [chord, ids] of seen) if (ids.length > 1) out.push({ ctx, chord, ids });
  }
  return out;
}

// ---------- "press a key" (the Controls tab) ----------
let capture = null; // { id, i }: the next key press becomes key i of the action
export const capturing = () => capture;
export function startCapture(id, i) { const k = KEY_BY_ID.get(id); capture = k && !k.fixed ? { id, i: i == null ? null : Number(i) } : null; }
export const stopCapture = () => { capture = null; };
// main.js keydown, before anything else. Returns null when not capturing, else { done, id, chord, clash } (Esc
// cancels: done false). A modifier alone waits for the key.
export function captureKey(e) {
  if (!capture) return null;
  const chord = chordOf(e);
  if (!chord) return { done: false, wait: true };
  const { id, i } = capture;
  capture = null;
  if (e.code === "Escape") return { done: false, id };
  const clash = setBinding(id, i, chord) || [];
  return { done: true, id, chord: normChord(chord), clash };
}

// ---------- names ----------
const CODE_NAMES = {
  Space: "Space", Enter: "Enter", NumpadEnter: "Num Enter", Escape: "Esc", Tab: "Tab", Backspace: "Backspace", Delete: "Del",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", PageUp: "PgUp", PageDown: "PgDn", Home: "Home", End: "End", Insert: "Ins",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", IntlBackslash: "\\ (ISO)", Backquote: "`", Comma: ",", Period: ".", Slash: "/",
  Semicolon: ";", Quote: "'", Equal: "=", Minus: "−", NumpadAdd: "Num +", NumpadSubtract: "Num −", NumpadMultiply: "Num *", NumpadDivide: "Num /",
  NumpadDecimal: "Num .", IntlRo: "\\ (JIS)",
};
export function codeName(code) {
  if (CODE_NAMES[code]) return CODE_NAMES[code];
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
  m = /^Digit(\d)$/.exec(code); if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code); if (m) return `Num ${m[1]}`;
  return code;
}
export const chordName = (c) => { const p = String(c).split("+"); const code = p.pop(); return [...p, codeName(code)].join("+"); };
// "J" / "Tab or N": an action's keys in words (tooltips, the palette's hints). "" when it has none.
export const keyLabel = (id, max = 2) => keysOf(id).slice(0, max).map(chordName).join(" or ");
