// The alerts stack on the right edge of the map (RimWorld style): things that want your attention now. Click one
// to jump to the place or open the right screen; 💤 snoozes it for a day, ✕ dismisses it until it clears and comes
// back. Also the map keys added with it (main.js calls mapHotkey before its own keys): tabs, next waiting team,
// bases, camera spots, the diary and the roster.
import { day, alive, residents, survivorById, baseById } from "../sim/world.js";
import { foodOutlook, waterOutlook } from "../sim/economy.js";
import * as Buildings from "../sim/buildings.js";
import { holdLimit } from "../sim/defences.js";
import { moodRisk } from "../sim/morale.js";
import { conditionsOf, autoWantsCondition, CONDITIONS } from "../sim/health.js";
import { partyTile, partyMembers, MISSIONS } from "../sim/parties.js";
import { diaryEntries, diarySync, decodeRefs } from "../sim/diary.js";
import { camera } from "./render.js";
import { brokenAt, fixtureName, jobFor, FIXTURES } from "../sim/breakdowns.js";
import { activeCrashes, CRASH_KINDS, daysLeft } from "../sim/crashes.js";
import { knownLoc } from "../sim/discovery.js";
import { openDiary } from "./diary.js";
import { openRoster } from "./roster.js";
import { visitorAlerts } from "./visitors.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const firstName = (name) => String(name || "").split(/\s+/)[0];
export const HORDE_ALERT_TILES = 6; // a horde you can see this close to a base is an alert
const SHOWN = 8;                    // alerts listed before "+N more"
const EVENT_HOURS = 24;             // "building finished" and the like stay up this long

// ---------- what needs attention ----------
// Each alert: { key, kind, icon, text, tip, tone (danger | warn | good | info), go: { team | base+tab | tile | surv } }.
const teamLabel = (state, p) => `${MISSIONS[p.teamMission || p.mission]?.name || "Team"} (${partyMembers(state, p).map((s) => firstName(s.name)).join(", ")})`;
const SECTIONS = {
  teams(state, out) {
    for (const p of state.parties) {
      if (p.owner !== "player" || p.kind === "convoy" || p.phase !== "waiting") continue;
      if (p.plan && p.plan.active === false) {
        out.push({ key: `plan:${p.id}`, kind: "plan", icon: "✅", tone: "good", text: `Plan finished: ${teamLabel(state, p)}`, tip: "This team has done every step of its plan and waits for orders. Click to open its panel.", go: { team: p.id } });
      } else {
        out.push({ key: `wait:${p.id}`, kind: "wait", icon: "❗", tone: "warn", text: `Waiting for orders: ${teamLabel(state, p)}`, tip: "This team is waiting for orders. Click to open its panel (Tab or N cycles through waiting teams).", go: { team: p.id } });
      }
    }
  },
  supplies(state, out) {
    for (const b of state.bases) {
      const n = residents(state, b.id).length;
      if (!n) continue;
      const food = (b.stock.food || 0) + (b.stock.preserved || 0);
      if (b.hungerDays > 0 || food < 1) out.push({ key: `starve:${b.id}`, kind: "starve", icon: "🍽", tone: "danger", text: `${b.name} is out of food`, tip: "Everyone there goes hungry: they lose health every day and nobody heals. Bring food (supply run, trade) or move people. Click to open the base.", go: { base: b.id, tab: "farming" } });
      else {
        const o = foodOutlook(state, b);
        if (o.daysLeft < 5) out.push({ key: `food:${b.id}`, kind: "food", icon: "🥫", tone: o.daysLeft < 2 ? "danger" : "warn", text: `${b.name}: food for ${Math.max(0, Math.floor(o.daysLeft))} day${Math.floor(o.daysLeft) === 1 ? "" : "s"}`, tip: `About ${Math.floor(o.stock)} food in store and ${Math.round(o.eat * 10) / 10} eaten a day, not counting harvests to come. Click to open the base's Farming tab.`, go: { base: b.id, tab: "farming" } });
      }
      if (b.thirstDays > 0 || (b.stock.water || 0) < 1) out.push({ key: `thirst:${b.id}`, kind: "thirst", icon: "🚱", tone: "danger", text: `${b.name} is out of water`, tip: "Thirst kills faster than hunger: everyone there loses health every day. Wells, rain catchers, filters or a supply run. Click to open the base.", go: { base: b.id, tab: "farming" } });
      else {
        const w = waterOutlook(state, b);
        if (w.daysLeft < 3) out.push({ key: `water:${b.id}`, kind: "water", icon: "💧", tone: w.daysLeft < 1.5 ? "danger" : "warn", text: `${b.name}: water for ${Math.max(0, Math.floor(w.daysLeft))} day${Math.floor(w.daysLeft) === 1 ? "" : "s"}`, tip: `${Math.floor(w.stock)} water in store, ${w.net} a day. Click to open the base's Farming tab.`, go: { base: b.id, tab: "farming" } });
      }
    }
  },
  stations(state, out) {
    const list = Buildings.stations, status = Buildings.stationStatus, B = Buildings.BUILDINGS;
    if (typeof list !== "function" || typeof status !== "function") return;
    for (const b of state.bases) {
      const idle = [];
      for (const st of list(b)) {
        const ss = status(state, b, st);
        if (ss && !ss.running) idle.push(`${(B && B[st.type] && B[st.type].name) || st.type} (${String(ss.reason || "idle").toLowerCase()})`);
      }
      if (idle.length) out.push({ key: `idle:${b.id}:${idle.length}`, kind: "idle", icon: "⚙", tone: "warn", text: `${idle.length === 1 ? "Station idle" : `${idle.length} stations idle`} at ${b.name}`, tip: `${idle.join("; ")}. Click to open the Workshops tab.`, go: { base: b.id, tab: "workshops" } });
    }
  },
  hordes(state, out) {
    const g = state.grid;
    for (const h of state.hordes) {
      if (!state.live.has(h.tile)) continue; // only hordes you can see now
      let best = null, dist = Infinity;
      for (const b of state.bases) {
        const dd = g.distance(h.tile, b.tile);
        if (dd < dist) { dist = dd; best = b; }
      }
      if (!best || dist > HORDE_ALERT_TILES) continue;
      const heading = state.bases.find((b) => (h.goal && h.goal.baseId === b.id) || h.target === b.tile);
      const target = heading || best;
      const limit = holdLimit(state, target, h.bosses || 0);
      if (heading && h.size > limit) {
        out.push({ key: `breakin:${h.id}`, kind: "breakin", icon: "🚨", tone: "danger", text: `Break-in likely at ${target.name}: horde of ${h.size}`, tip: `A horde of ${h.size}${h.bosses ? " with a Wallbreaker" : ""} is heading for ${target.name}, ${g.distance(h.tile, target.tile)} tiles out. Its defences hold about ${Math.round(limit)}: guards, barricades, pits and the decoy fire help. Click to see the horde.`, go: { tile: h.tile } });
      } else {
        out.push({ key: `horde:${h.id}`, kind: "horde", icon: "🧟", tone: heading ? "danger" : "warn", text: `Horde of ${h.size}, ${dist} tile${dist === 1 ? "" : "s"} from ${best.name}`, tip: `${heading ? `Heading for ${heading.name}. ` : ""}${target.name}'s defences hold about ${Math.round(limit)}. Click to see the horde.`, go: { tile: h.tile } });
      }
    }
  },
  sick(state, out) {
    const today = day(state);
    for (const b of state.bases) {
      const who = [];
      for (const s of residents(state, b.id)) {
        const bad = conditionsOf(s).filter((c) => autoWantsCondition(c) && (c.treatedDay ?? -99) < today - 1);
        if (bad.length || s.woundInfected) who.push(`${firstName(s.name)} (${[...bad.map((c) => (CONDITIONS[c.key] ? CONDITIONS[c.key].name : c.key).toLowerCase()), ...(s.woundInfected ? ["infected wound"] : [])].join(", ")})`);
      }
      if (who.length) out.push({ key: `sick:${b.id}:${who.length}`, kind: "sick", icon: "✚", tone: "warn", text: `${who.length} untreated at ${b.name}`, tip: `Sick or hurt and not treated for two days: ${who.join(", ")}. Meds, medics and the reserve are on the Medical tab. Click to open it.`, go: { base: b.id, tab: "medical" } });
    }
  },
  mood(state, out) {
    for (const s of alive(state)) {
      const r = moodRisk(s);
      if (!r || r.level < 2) continue;
      out.push({ key: `desert:${s.id}`, kind: "desert", icon: "🎒", tone: "danger", text: `${firstName(s.name)}: ${r.text.toLowerCase()} (mood ${Math.floor(s.mood)})`, tip: `${s.name} may walk out soon. Rest, a bed, food, a gift or a talk with the leader help. Click to open their screen.`, go: { surv: s.id } });
    }
  },
  events(state, out) {
    // From the diary: lines of the last day that are news, not a state (a building finished, a caravan arrived).
    const today = day(state);
    for (const d of [today - 1, today]) {
      if (d < 1) continue;
      for (const e of diaryEntries(state, d)) {
        const at = (d - 1) * 24 + e.hour;
        if (e.robot || state.hour - at >= EVENT_HOURS) continue;
        const ref = decodeRefs(e.refs).find((r) => r.type === "b");
        let m;
        if ((m = /^(.+?) finished at (.+)\.$/.exec(e.text)) && Buildings.BUILDINGS && Object.values(Buildings.BUILDINGS).some((x) => x && x.name === m[1])) {
          out.push({ key: `built:${at}:${e.text}`, kind: "built", icon: "🔨", tone: "good", text: `${m[1]} finished at ${m[2]}`, tip: "Construction is done. Click to open the base's Buildings tab.", go: ref ? { base: ref.id, tab: "buildings" } : null, event: true });
        } else if (/^A caravan from .+ has arrived at /.test(e.text)) {
          out.push({ key: `caravan:${at}:${e.text}`, kind: "caravan", icon: "🐎", tone: "good", text: e.text.replace(/ with the goods you agreed on/, "").replace(/\. It stays until.*$/, ""), tip: `${e.text} Click to open the base (its Trade button is on the Bases tab).`, go: ref ? { base: ref.id, tab: "overview" } : null, event: true });
        }
      }
    }
  },
  // Broken buildings (breakdowns.js) and downed aircraft (crashes.js).
  explore(state, out) {
    for (const b of state.bases) {
      const broken = brokenAt(b);
      if (!broken.length) continue;
      const idle = broken.filter((fx) => !jobFor(b, fx));
      out.push({ key: `broken:${b.id}:${broken.map((fx) => fx.id).join(",")}`, kind: "broken", icon: "🔧", tone: idle.length ? "warn" : "info", text: `${broken.length === 1 ? `${fixtureName(broken[0])} broken` : `${broken.length} things broken`} at ${b.name}${idle.length ? "" : " (being fixed)"}`, tip: `${broken.map((fx) => `${fixtureName(fx)}: ${FIXTURES[fx.type].what}${jobFor(b, fx) ? " (being fixed)" : ""}`).join("; ")}. Click to open the Repairs tab.`, go: { base: b.id, tab: "repairs" } });
    }
    for (const c of activeCrashes(state)) {
      const def = CRASH_KINDS[c.kind];
      const left = daysLeft(state, c);
      const name = c.found && state.tiles[c.tile].loc ? state.tiles[c.tile].loc.name : `Downed ${def.name.toLowerCase()}`;
      out.push({ key: `crash:${c.id}:${c.found ? 1 : 0}`, kind: "crash", icon: def.icon, tone: left < 2 ? "warn" : "info", text: `${name}: ${c.found ? "found" : `search ${c.radius} tiles around ${knownLoc(state, c.center) ? state.tiles[c.center].loc.name : "the circle"}`}, ${left.toFixed(1)} days left`, tip: `${c.found ? "The wreck is on the map: raid it before other groups strip it." : "It came down somewhere in the circle on the map. Send a team to look around there (the planner's “Search the area” step)."} It burns out in about ${left.toFixed(1)} days. Click to see it.`, go: { tile: c.found ? c.tile : c.center } });
    }
  },
  outsiders(state, out) { // raiders from outside near a base, merchants at one (ui/visitors.js)
    out.push(...visitorAlerts(state));
  },
  cards(state, out) {
    if (state.cards.length > 1) out.push({ key: `cards:${state.cards.length}`, kind: "cards", icon: "🃏", tone: "info", text: `${state.cards.length} cards waiting`, tip: "Cards are answered one at a time: these are still in the pile. Close the screens on top to see the next one.", go: { cards: true } });
  },
};
const ORDER = ["breakin", "starve", "thirst", "desert", "outsiders", "horde", "food", "water", "sick", "wait", "plan", "broken", "idle", "crash", "cards", "caravan", "built"];

export function computeAlerts(state) {
  const out = [];
  for (const [name, fn] of Object.entries(SECTIONS)) {
    try { fn(state, out); } catch (err) { // one broken kind must not take the stack down
      if (!computeAlerts.warned) { computeAlerts.warned = true; console.warn(`Broken State: the ${name} alerts failed`, err); }
    }
  }
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

// Dismissed (until the alert clears) and snoozed (for a day) keys, kept per run.
function mute(state, ui) {
  if (!ui.alertMute || ui.alertMute.state !== state) ui.alertMute = { state, dismissed: new Set(), snooze: new Map(), all: false };
  return ui.alertMute;
}

export function renderAlerts(state, ui) {
  if (!ui.started || state.gameOver || ui.timelapse) return "";
  diarySync(state);
  const m = mute(state, ui);
  const list = computeAlerts(state);
  const keys = new Set(list.map((a) => a.key));
  for (const k of [...m.dismissed]) if (!keys.has(k)) m.dismissed.delete(k); // cleared: it may come back later
  for (const [k, until] of [...m.snooze]) if (state.hour >= until || !keys.has(k)) m.snooze.delete(k);
  const shown = list.filter((a) => !m.dismissed.has(a.key) && !m.snooze.has(a.key));
  const hidden = list.length - shown.length;
  ui.alertList = shown; // for the hotkeys and tests
  const flash = ui.flash && performance.now() - ui.flash.at < 4000 ? `<div class="al-flash">${esc(ui.flash.text)}</div>` : "";
  if (!shown.length && !hidden) return flash;
  const cut = m.all ? shown : shown.slice(0, SHOWN);
  const rows = cut.map((a) => `<div class="al al-${a.tone}">
      <button class="al-go" data-action="al-go" data-key="${esc(a.key)}"${tip(a.tip)}><span class="al-ico">${a.icon}</span>${esc(a.text)}</button>
      <button class="al-btn" data-action="al-snooze" data-key="${esc(a.key)}"${tip("Snooze: hide this for a day")}>💤</button><button class="al-btn" data-action="al-dismiss" data-key="${esc(a.key)}"${tip(a.event ? "Dismiss" : "Dismiss until it clears (it comes back if it happens again)")}>✕</button>
    </div>`).join("");
  const more = shown.length > cut.length ? `<button class="al-more" data-action="al-all"${tip("Show every alert")}>+${shown.length - cut.length} more</button>` :
    m.all && shown.length > SHOWN ? `<button class="al-more" data-action="al-all"${tip("Show fewer")}>Show fewer</button>` : "";
  const restore = hidden ? `<button class="al-more" data-action="al-restore"${tip("Show the alerts you snoozed or dismissed again")}>${hidden} hidden · show</button>` : "";
  return `${flash}${rows}${more}${restore}`;
}

function goTo(state, ui, a, act) {
  const g = a && a.go;
  if (!g) return;
  ui.diary = null;
  ui.roster = null;
  if (g.team != null) {
    const p = state.parties.find((x) => x.id === g.team);
    if (!p) return;
    act["xp-open"]({ id: p.id });
    act.center({ tile: partyTile(p) });
  } else if (g.base != null) {
    if (baseById(state, g.base)) act.openbase({ id: g.base, tab: g.tab || "overview" });
  } else if (g.tile != null) act.center({ tile: g.tile });
  else if (g.surv != null) { if (survivorById(state, g.surv)) ui.survivor = g.surv; }
  else if (g.cards) { ui.baseView = null; ui.survivor = null; ui.help = false; }
}

export const ALERT_ACTIONS = {
  "al-go": (state, ui, d, act) => {
    const a = computeAlerts(state).find((x) => x.key === d.key);
    goTo(state, ui, a, act);
    if (a && a.event) mute(state, ui).dismissed.add(a.key); // seen: news alerts go once clicked
  },
  "al-dismiss": (state, ui, d) => { mute(state, ui).dismissed.add(d.key); },
  "al-snooze": (state, ui, d) => { mute(state, ui).snooze.set(d.key, state.hour + 24); },
  "al-restore": (state, ui) => { const m = mute(state, ui); m.dismissed.clear(); m.snooze.clear(); },
  "al-all": (state, ui) => { const m = mute(state, ui); m.all = !m.all; },
};

// ---------- keys ----------
// Next (or, with Shift, previous) team waiting for orders: centers on it and opens its panel.
export function nextWaitingTeam(state, ui, act, back = false) {
  const waiting = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && p.phase === "waiting");
  if (!waiting.length) { ui.flash = { text: "No team is waiting for orders.", at: performance.now() }; return null; }
  const i = waiting.findIndex((p) => p.id === ui.expedition);
  const p = waiting[(i < 0 ? (back ? waiting.length - 1 : 0) : i + (back ? waiting.length - 1 : 1)) % waiting.length];
  act["xp-open"]({ id: p.id });
  act.center({ tile: partyTile(p) });
  return p;
}

// Map keys added with the alerts (README controls). Returns true when the key was used. modal: what window is up
// (ui.js modalKind); only the diary and roster keys work with a window open (they close their own window).
export function mapHotkey(state, ui, e, act, modal) {
  const code = e.code || "";
  const mods = e.ctrlKey || e.altKey || e.metaKey;
  if (modal) {
    if (mods) return false;
    if (modal === "diary" && (code === "KeyJ" || code === "KeyR")) { ui.diary = null; if (code === "KeyR") openRoster(ui); return true; }
    if (modal === "roster" && (code === "KeyR" || code === "KeyJ")) { ui.roster = null; if (code === "KeyJ") openDiary(ui); return true; }
    return false;
  }
  if (!ui.started) return false;
  ui.flash = null;
  const dm = /^Digit([1-9])$/.exec(code) || /^Numpad([1-9])$/.exec(code);
  if (dm && (e.ctrlKey || e.altKey) && !e.metaKey) { // save a camera spot (Alt as well: some browsers keep Ctrl+1–9 for their tabs)
    (ui.camSpots || (ui.camSpots = {}))[dm[1]] = { x: camera.x, y: camera.y, zoom: camera.zoom, seed: state.seed };
    ui.flash = { text: `Camera spot ${dm[1]} saved. Shift+${dm[1]} brings you back here.`, at: performance.now() };
    return true;
  }
  if (dm && e.shiftKey && !mods) {
    const spot = ui.camSpots && ui.camSpots[dm[1]];
    if (!spot || spot.seed !== state.seed) { ui.flash = { text: `No camera spot ${dm[1]} yet: Ctrl+${dm[1]} (or Alt+${dm[1]}) saves the current view.`, at: performance.now() }; return true; }
    camera.x = spot.x; camera.y = spot.y; camera.zoom = spot.zoom;
    return true;
  }
  const fm = /^F([1-9])$/.exec(code);
  if (fm && !mods) {
    const b = state.bases[Number(fm[1]) - 1];
    if (!b) { ui.flash = { text: `You have ${state.bases.length} base${state.bases.length === 1 ? "" : "s"}: F1–F${state.bases.length}.`, at: performance.now() }; return true; }
    act.center({ tile: b.tile });
    return true;
  }
  if (mods) return false;
  const tabs = { KeyB: "bases", KeyG: "groups", KeyT: "teams" };
  if (tabs[code]) { ui.tab = tabs[code]; return true; }
  if (code === "KeyP") {
    if (e.shiftKey) act["dev-autopilot"]();
    else ui.tab = "people";
    return true;
  }
  if (code === "Tab" || code === "KeyN") { nextWaitingTeam(state, ui, act, e.shiftKey); return true; }
  if (code === "KeyJ") { openDiary(ui); return true; }
  if (code === "KeyR") { openRoster(ui); return true; }
  return false;
}
