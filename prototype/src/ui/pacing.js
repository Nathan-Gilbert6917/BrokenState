// Pacing (main.js hooks it into the frame loop): the pause rules, the card tray and the speeds.
//  - Pause rules (Options → "Pause for…"): a card of a kind that is switched on stops the clock as before; the others
//    wait in the card tray at the top of the map while the clock runs (sim/cardrules.js says what kind each card is).
//    A death, a first contact, a group turning hostile and a horde sighted near a base stop the clock even when no
//    card comes with them (each by its switch).
//  - The tray: newest first, each chip with its icon, title and the hours left; click one to answer it. Left
//    TRAY_HOURS in-game hours, a card takes its default answer by itself (a log and diary line says so). A team whose
//    card waits holds where it is. Things that cannot wait (a battle, a search, the trade window, a city crawl, a card
//    whose answers need the map) always stop the clock.
//  - Speeds: 0.25× (key 0) and 0.5× 1× 2× 3× 5× (keys 1–5). At 3× and 5× the game drops to 1× by itself when a card (pausing or
//    tray) or a new red alert arrives (Options: "Drop to 1× when something happens", on by default).
// Nothing here runs on autopilot (the governor answers every card at once) or in the headless tools.
import { fogged } from "../sim/hardrules.js";
import { PAUSE_KINDS, KIND_BY_KEY, DEFAULT_PAUSE, TRAY_HOURS, cardKind, cardIcon, defaultChoice, autoAnswer, holdTeam, trayStale, dropCard } from "../sim/cardrules.js";
export { TRAY_HOURS };
import { attitude } from "../sim/factions.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");

// ---------- speeds (the one place the speed keys live) ----------
export const SPEEDS = [0.5, 1, 2, 3, 5];  // keys 1–5
export const SLOWEST_SPEED = 0.25;        // key 0: an hour in 80 seconds, to watch a fight or a move up close
export const MAX_SPEED = 5;               // the fastest normal speed; anything above is a dev fast-forward
export const FAST_SPEED = 3;              // from here up the game drops to 1× when something happens
export const TRAY_SHOWN = 6;              // chips in the tray before "+N more"
// The speed a key picks (Digit0–Digit5, Numpad0–Numpad5), or null.
export function speedForKey(code) {
  const m = /^(?:Digit|Numpad)([0-5])$/.exec(code || "");
  return m ? (m[1] === "0" ? SLOWEST_SPEED : SPEEDS[Number(m[1]) - 1]) : null;
}

// ---------- options ----------
// options.pacing = { pause: { combat: true, … }, drop: true } in the browser's options (ui/saves.js).
let OPTS = null, SAVE = null;
export function initPacing(options, save) {
  OPTS = options;
  SAVE = save;
  pacingOptions(options);
}
export function pacingOptions(o) {
  if (!o) return { pause: { ...DEFAULT_PAUSE }, drop: true };
  const p = o.pacing && typeof o.pacing === "object" ? o.pacing : {};
  const pause = {};
  for (const k of PAUSE_KINDS) pause[k.key] = p.pause && typeof p.pause[k.key] === "boolean" ? p.pause[k.key] : k.def;
  o.pacing = { pause, drop: typeof p.drop === "boolean" ? p.drop : true };
  return o.pacing;
}
const opts = () => (OPTS ? OPTS.pacing || pacingOptions(OPTS) : pacingOptions(null));
const pauseOn = (kind) => kind === "always" || opts().pause[kind] !== false;

// ---------- the cards ----------
// Per world: the cards seen at the last look (a card that comes back, like a city's orders card after "Not now",
// counts as new), the people alive, the groups known and hostile, the alerts seen.
let track = null;
let nextTrayId = 1;
function tracked(state) {
  if (!track || track.state !== state) track = { state, seen: new Set(state.cards || []), world: null, alerts: null, danger: null };
  return track;
}
// Each card gets { id, at (the hour it came), kind } when it first shows up. Returns the cards that are new.
function stamp(state) {
  const T = tracked(state);
  const fresh = [];
  for (const c of state.cards) {
    if (c.tray && T.seen.has(c)) continue;
    c.tray = { id: nextTrayId++, at: state.hour, kind: cardKind(state, c) };
    fresh.push(c);
  }
  T.seen = new Set(state.cards);
  return fresh;
}
export const cardPauses = (card) => !card.tray || pauseOn(card.tray.kind);
export const trayCards = (state) => (state.autopilot ? [] : (state.cards || []).filter((c) => c.tray && !cardPauses(c)));
// Cards still stopping the clock (the "N cards waiting" alert counts these).
export const pileCount = (state) => { if (state.autopilot) return state.cards.length; stamp(state); return state.cards.filter(cardPauses).length; };

// The card on screen goes to the front of state.cards (the choice buttons answer state.cards[0]): the one opened
// from the tray, else the first card that pauses. Returns it, or null when every card waits in the tray.
function arrange(state, ui) {
  if (!state.cards.length) { if (ui) ui.trayOpen = null; return null; }
  if (state.autopilot) return state.cards[0];
  stamp(state);
  let i = ui && ui.trayOpen != null ? state.cards.findIndex((c) => c.tray && c.tray.id === ui.trayOpen) : -1;
  if (i < 0) {
    if (ui) ui.trayOpen = null;
    i = state.cards.findIndex(cardPauses);
  }
  if (i < 0) return null;
  if (i > 0) state.cards.unshift(state.cards.splice(i, 1)[0]);
  return state.cards[0];
}
// A card the player just asked for (Talk to them, Call them back, a trade closed back to its card): open it at once,
// also when its kind waits in the tray. fn adds it; returns fn's result.
export function openAsked(state, ui, fn) {
  const before = new Set(state.cards || []);
  const out = fn();
  const c = (state.cards || []).find((x) => !before.has(x));
  if (c && !state.autopilot) { stamp(state); if (c.tray && !cardPauses(c)) ui.trayOpen = c.tray.id; }
  return out;
}
// Is a card on screen (ui.js pickModal, main.js blocked and Esc)? On autopilot: any card, as before.
export const cardUp = (state, ui) => !!arrange(state, ui);
// The tray's card opened over the map: Esc puts it back.
export function trayEsc(state, ui) {
  if (ui.trayOpen == null || !state.cards.length || !state.cards[0].tray || state.cards[0].tray.id !== ui.trayOpen) return false;
  ui.trayOpen = null;
  return true;
}

// ---------- the clock ----------
// Slows a fast clock to 1× (3× and 5×, by the option). why: a few words for the flash line on the map.
function slow(ui, why) {
  if (!opts().drop || ui.speed < FAST_SPEED || ui.speed > MAX_SPEED) return false;
  ui.speed = 1;
  ui.lastSpeed = 1;
  ui.flash = { text: `Slowed to 1×: ${why}`, at: typeof performance !== "undefined" ? performance.now() : 0 };
  return true;
}
// Stops the clock for something with no card (a death, a first contact…); the paused banner says why. Not while a
// card already stops it (that card says it), and not at a dev fast-forward's speed.
function stop(state, ui, why) {
  if (ui.speed === 0 || cardUp(state, ui)) { slow(ui, why); return; }
  if (ui.speed <= MAX_SPEED) ui.lastSpeed = opts().drop && ui.speed >= FAST_SPEED ? 1 : ui.speed;
  ui.speed = 0;
  ui.pauseWhy = why;
}

// Every frame, before the clock: new cards get their kind, cards out of date leave the tray, the pause's reason
// goes once the clock runs again.
export function pacingFrame(state, ui) {
  if (ui.speed > 0 || !track || track.state !== state) ui.pauseWhy = null; // a new or loaded world starts without one
  tracked(state);
  if (state.autopilot || !state.cards.length) return;
  stamp(state);
  for (const c of trayCards(state)) {
    if (ui.trayOpen === c.tray.id) continue;
    const why = trayStale(state, c);
    if (why) dropCard(state, c, why);
  }
}

// A tray card's time is up: it takes its default answer, or, with nothing it can take by itself any more (its safe
// answers greyed out), it stops the clock instead.
// A plain move's arrival card (parties.js quietArrival) opens instead: "Hold here" would leave a team out of contact
// with no way to reach it.
function expire(state, c, byPlayer = false) {
  if (!defaultChoice(state, c) || c.quietArrival || (!byPlayer && fogged(state, "autoAnswer"))) c.tray.kind = "always"; // Hardcore (sim/hardrules.js): no card answers itself
  else autoAnswer(state, c, byPlayer);
}

// Will this team hold when the coming hour runs (beforeHour: a card of its waits in the tray and is not past its time)?
// The map does not glide a held team towards its next tile (ui/render.js, sim/parties.js glideAt): it would only jump
// back when the hour ticks.
export const holdsNextHour = (state, p) => !!p && trayCards(state).some((c) => c.partyId === p.id && state.hour - c.tray.at < TRAY_HOURS);

// Before each in-game hour: tray cards past their time take their default answer; teams with a card waiting hold.
// Returns true if anything changed.
export function beforeHour(state, ui) {
  if (state.autopilot || !ui.started) return false;
  const T = tracked(state);
  T.world = worldSnap(state);
  let did = false;
  for (const c of trayCards(state)) {
    if (ui.trayOpen === c.tray.id) continue;
    if (state.hour - c.tray.at < TRAY_HOURS) continue;
    expire(state, c);
    did = true;
  }
  const held = new Set(); // one hour held per team, however many of its cards wait
  for (const c of trayCards(state)) {
    if (c.partyId == null || held.has(c.partyId)) continue;
    held.add(c.partyId);
    if (holdTeam(state, c)) did = true;
  }
  return did;
}

// After each in-game hour: the new cards (stop or slow down by the rules) and what happened without a card.
export function afterHour(state, ui) {
  if (state.autopilot || !ui.started) return;
  const fresh = stamp(state);
  if (fresh.length) {
    const c = fresh.find(cardPauses) || fresh[0];
    slow(ui, `${cardPauses(c) ? "" : "in the tray: "}${c.title}`);
  }
  const T = tracked(state);
  const before = T.world;
  T.world = null;
  if (!before || state.gameOver) return;
  const why = worldNews(state, before);
  if (why) stop(state, ui, why);
}

// What the pause rules watch without a card: who is alive, which groups are known, which are hostile.
function worldSnap(state) {
  const alive = new Set();
  for (const s of state.survivors || []) if (s.alive) alive.add(s.id);
  const known = new Set(), hostile = new Set();
  for (const f of state.factions || []) {
    if (f.known) known.add(f.id);
    if (f.known && attitude(f) === "Hostile") hostile.add(f.id);
  }
  return { alive, known, hostile };
}
function worldNews(state, before) {
  const P = opts().pause;
  const news = [];
  if (P.death) {
    const died = (state.survivors || []).filter((s) => before.alive.has(s.id) && !s.alive && !s.left);
    if (died.length) news.push(died.length === 1 ? `${died[0].name} died` : `${died.length} of your people died`);
  }
  for (const f of state.factions || []) {
    if (P.contact && f.known && !before.known.has(f.id)) news.push(`first contact with ${f.name}`);
    else if (P.hostile && f.known && f.alive !== false && attitude(f) === "Hostile" && !before.hostile.has(f.id) && before.known.has(f.id)) news.push(`${f.name} turned hostile`);
  }
  return news.slice(0, 2).join("; ");
}

// After the panels are drawn (main.js refresh): a new red alert slows the clock; a new horde or break-in alert near
// a base stops it (the "horde" switch).
export function afterRefresh(state, ui) {
  if (state.autopilot || !ui.started || state.gameOver) return;
  const T = tracked(state);
  const list = ui.alertList || [];
  const danger = new Set(list.filter((a) => a && a.tone === "danger").map((a) => a.key));
  const hordes = new Set(list.filter((a) => a && (a.kind === "horde" || a.kind === "breakin")).map((a) => a.key));
  if (T.danger && T.alerts) {
    const newHorde = list.find((a) => a && hordes.has(a.key) && !T.alerts.has(a.key));
    const newDanger = list.find((a) => a && danger.has(a.key) && !T.danger.has(a.key));
    if (newHorde && opts().pause.horde && ui.speed > 0) stop(state, ui, newHorde.text);
    else if (newDanger) slow(ui, newDanger.text);
  }
  T.danger = danger;
  T.alerts = hordes;
}

// ---------- drawing ----------
const hoursLeft = (state, c) => Math.max(0, TRAY_HOURS - (state.hour - c.tray.at));
const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// The tray: a strip of chips at the top of the map (main.js bannerHTML), newest first.
export function trayHTML(state, ui) {
  const list = trayCards(state).sort((a, b) => b.tray.id - a.tray.id);
  if (!list.length) return "";
  const chip = (c) => {
    const left = hoursLeft(state, c);
    const def = defaultChoice(state, c);
    const t = `${c.title}${c.where ? ` (near ${c.where})` : ""}. ${clip(String(c.text || ""), 160)}\n\nThe clock keeps running while it waits${c.partyId != null ? " (the team holds where it is)" : ""}. In ${left}h it takes ${def ? `“${def.label}”` : "no answer and is dropped"} by itself. Click to answer it.`;
    return `<button class="tray-chip${left <= 2 ? " soon" : ""}" data-action="tray-open" data-id="${c.tray.id}"${tip(t)}><span class="ti">${cardIcon(c, c.tray.kind)}</span>${esc(clip(String(c.title || "Card"), 34))} <span class="tl">${left}h</span></button>`;
  };
  const more = list.length > TRAY_SHOWN ? `<span class="muted"${tip(list.slice(TRAY_SHOWN).map((c) => c.title).join(" · "))}>+${list.length - TRAY_SHOWN} more</span>` : "";
  return `<div class="tray"><span class="tray-h"${tip(`Cards that do not stop the clock wait here (Options → Pause for…). Unanswered for ${TRAY_HOURS} in-game hours, a card takes its default answer and the log says so. Saving waits until the tray is empty (a card's choices cannot be saved).`)}>🃏 ${list.length}</span>` +
    list.slice(0, TRAY_SHOWN).map(chip).join("") + more +
    `<button class="mini" data-action="tray-defaults"${tip("Answer every card in the tray with its default now (the answer each would take when its time runs out)")}>✓ all</button>` +
    `<button class="mini" data-action="tray-rules"${tip("Pause rules: which cards stop the clock (Options)")}>⚙</button></div>`;
}

// The paused banner's reason (a death, a first contact…).
export const pauseWhyHTML = (ui) => (ui.pauseWhy ? ` <span class="pause-why">${esc(ui.pauseWhy)}.</span>` : "");

// A card opened from the tray gets a line on top: when it answers itself, and the way back to the tray.
export function trayCardFrame(state, ui, html) {
  const c = state.cards[0];
  if (!html || !c || !c.tray || ui.trayOpen !== c.tray.id) return html;
  const def = defaultChoice(state, c);
  const line = `<div class="tray-note">From the tray: the clock waits while this is open. Left alone, it takes ${def ? `“${esc(def.label)}”` : "no answer"} in ${hoursLeft(state, c)}h. <button class="mini" data-action="tray-close"${tip("Back to the tray, unanswered (Esc)")}>Back to the tray</button></div>`;
  return html.replace(/(<div class="box[^"]*"[^>]*>)/, `$1${line}`);
}

// Options → Pause for… (ui/settings.js optionsTab).
export function pacingOptionsHTML() {
  const o = opts();
  const box = (k, on, label, t) => `<button class="setopt ${on ? "active" : ""}" data-action="pace-opt" data-k="${k}"${tip(t)}>${on ? "✔" : "✗"} ${label}</button>`;
  return `<h3${tip("Which moments stop the clock. The others wait in the card tray at the top of the map while the clock runs.")}>Pause for…</h3><div class="setrow">
      ${PAUSE_KINDS.map((k) => box(k.key, o.pause[k.key], `${k.icon} ${k.label}`, k.tip)).join("")}
    </div>
    <div class="setrow">
      ${box("drop", o.drop, "Drop to 1× when something happens", "At 3× and 5×: a new card (one that stops the clock or one for the tray) or a new red alert puts the clock back to 1×")}
      <span class="muted small">A card that does not stop the clock waits in the tray; left ${TRAY_HOURS} in-game hours it takes its default answer. A battle, a search, the trade window, a city crawl and cards that need the map always stop it.</span>
      <button class="mini" data-action="help-open" data-sec="pause-rules-and-the-card-tray"${tip("Help: pause rules and the card tray")}>?</button>
    </div>`;
}

// ---------- actions (main.js: fn(state, ui, d)) ----------
export const PACE_ACTIONS = {
  "tray-open": (state, ui, d) => { const c = state.cards.find((x) => x.tray && x.tray.id === Number(d.id)); if (c) { ui.trayOpen = c.tray.id; arrange(state, ui); } },
  "tray-close": (state, ui) => { ui.trayOpen = null; },
  "tray-defaults": (state, ui) => { ui.trayOpen = null; for (const c of trayCards(state)) expire(state, c, true); },
  "pace-opt": (state, ui, d) => {
    const o = opts();
    if (d.k === "drop") o.drop = !o.drop;
    else if (KIND_BY_KEY[d.k]) o.pause[d.k] = !o.pause[d.k];
    else return;
    if (SAVE && OPTS) SAVE(OPTS);
  },
};

// ---------- help (ui/help.js adds it after "Time") ----------
export function pacingHelp() {
  const k = (t) => `<b>${t}</b>`;
  return `Which moments stop the clock is yours to choose: ⚙ Menu → Options → <i>Pause for…</i>. ${PAUSE_KINDS.map((x) => `${x.icon} ${esc(x.label)} (${x.def ? "on" : "off"} at first)`).join(", ")}.<br>
    A card of a kind that is switched on stops the clock as always. The others go into the <b>card tray</b>, a strip at the top of the map, newest first: each chip shows its icon, its title and the in-game hours it has left. The clock keeps running; click a chip to answer the card (the clock waits while it is open; ${k("Esc")} or <i>Back to the tray</i> puts it back unanswered). A team whose card waits holds where it is. Left ${TRAY_HOURS} in-game hours (2 min 40 s at 1×), a card takes its default answer by itself, and the log and the diary say which: the "do nothing" answer when there is one (OK, Hold here, Leave it, Not now, Decide later), else the one that steps back from trouble, else the first that is not a gamble. It never takes an answer that is greyed out or needs the map. <i>✓ all</i> answers the whole tray with its defaults; a card about a team, person, group or base that is gone leaves the tray with a log line. Saving waits until the tray is empty.<br>
    A death, a first contact with a group, a group turning hostile and a horde sighted near a base stop the clock even when no card comes with them (each by its switch); the paused banner says why. A battle, a search, the trade window, a city crawl and a card whose answers need the map always stop it.<br>
    Speeds: ${k("0")} = 0.25× (an hour takes 80 seconds), ${k("1")}–${k("5")} = 0.5× / 1× / 2× / 3× / 5× (an hour takes 40 / 20 / 10 / 7 / 4 seconds). At 3× and 5× the clock drops back to 1× by itself when a card arrives (one that stops the clock or one for the tray) or a new red alert comes up; switch that off with <i>Drop to 1× when something happens</i>.`;
}
