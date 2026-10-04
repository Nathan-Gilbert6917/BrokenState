// Dev tools: lift the fog of war and watch the world run on its own. Display only; the sim and
// the player's knowledge are never changed, so turning it off puts the map back exactly as it was.
// The exception is Autopilot, which plays for you (sim/autopilot.js): turning it off hands control back as things stand.
import { day } from "../sim/world.js";
import { FACTION_TYPES } from "../sim/data.js";
import { strength } from "../sim/factions.js";
import { hiveTracker } from "../sim/hives.js";
import { view } from "./render.js";
import { PERSONALITIES, autopilotPersonality, autopilotSummary, reserveText } from "../sim/autopilot.js";

export const DEV_SPEEDS = [10, 50, 200]; // 200×: a day in about 0.4 seconds
const INFECTED = 0.6; // a tile counts as a hotzone at this infection or more (about the worst 15% at the start)

// One sample per in-game day, so the panel can show how things changed over the last week.
const history = [];
let historyOf = null; // the world the samples belong to

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function snapshot(state) {
  const territory = new Map();
  let hot = 0, infSum = 0;
  for (const t of state.tiles) {
    if (t.owner != null && t.owner !== "player") territory.set(t.owner, (territory.get(t.owner) || 0) + 1);
    if (t.infection >= INFECTED) hot++;
    infSum += t.infection || 0;
  }
  const factions = {};
  for (const f of state.factions) factions[f.id] = { pop: f.pop, bases: f.bases.length, land: territory.get(f.id) || 0, alive: f.alive };
  const hv = hiveTracker(state);
  return {
    day: day(state), hot, infAvg: infSum / state.tiles.length, hives: hv.hives, hiveRes: hv.res, hv,
    hordes: state.hordes.length, hordeSize: state.hordes.reduce((s, h) => s + h.size, 0), factions,
  };
}

// Called every refresh; records the first look at each new day.
export function devSample(state) {
  // A new world starts a new history, also on the same seed (new campaign, group count changed).
  const d = day(state);
  if (historyOf !== state || (history.length && history[history.length - 1].day > d)) { history.length = 0; historyOf = state; }
  if (!history.length || history[history.length - 1].day < d) history.push(snapshot(state));
  if (history.length > 120) history.shift();
}

const delta = (now, then, digits = 0) => {
  if (then == null) return "";
  const v = now - then;
  if (Math.abs(v) < (digits ? 0.005 : 0.5)) return `<span class="muted">±0</span>`;
  return `<span class="${v > 0 ? "danger" : "good"}">${v > 0 ? "+" : ""}${v.toFixed(digits)}</span>`;
};

export function renderDevPanel(state, ui) {
  if (!ui.dev) return "";
  const now = snapshot(state);
  const week = history.find((h) => h.day >= now.day - 7) || null;
  const box = (key, label, on, t) => `<label title="${esc(t)}"><input type="checkbox" data-action="${key}" ${on ? "checked" : ""}> ${label}</label>`;
  const rows = state.factions
    .map((f) => ({ f, s: now.factions[f.id], w: week && week.factions[f.id] }))
    .sort((a, b) => b.s.land - a.s.land || b.s.pop - a.s.pop)
    .map(({ f, s, w }) => `<tr class="${f.alive ? "" : "muted"}">
      <td><span class="dot" style="background:${f.color}"></span>${esc(f.name)}</td>
      <td class="muted">${esc(FACTION_TYPES[f.type] ? FACTION_TYPES[f.type].label : f.type)}</td>
      <td>${f.alive ? Math.round(s.pop) : "gone"} ${w ? delta(s.pop, w.pop) : ""}</td>
      <td>${s.bases} ${w ? delta(s.bases, w.bases) : ""}</td>
      <td>${s.land} ${w ? delta(s.land, w.land) : ""}</td>
      <td>${f.alive ? Math.round(strength(f)) : "–"}</td>
    </tr>`).join("");
  return `
    <div class="row" style="justify-content:space-between"><b>Dev tools</b><button data-action="dev-toggle" title="Close (\`)">✕</button></div>
    <div class="devopts">
      ${box("dev-reveal", "Reveal map (no fog of war)", view.devReveal, "Show every tile live: other groups, their teams, hordes and hives. Display only.")}
      ${box("dev-infection", "Infection overlay", view.layers.has("infection"), "Zombie hotzones (same as the I key)")}
      ${box("dev-autopilot", "Autopilot: the AI runs your holdout (Shift+P)", !!state.autopilot, "An AI governor takes over: roles, building, crafting, medicine, trips, supply runs, outposts, every card and battle. Its moves show in the log with 🤖. Turn it off to take control back as things stand.")}
      <div class="row">Style ${Object.entries(PERSONALITIES).map(([k, p]) => `<button data-action="dev-persona" data-v="${k}" class="${autopilotPersonality(state) === k ? "active" : ""}" title="${esc(p.desc)}">${p.name}</button>`).join("")}</div>
      ${state.autopilot ? `<div class="muted small" title="${esc(reserveText(state))}">🤖 ${esc(autopilotSummary(state))}</div>` : ""}
      <div class="row">Fast forward ${DEV_SPEEDS.map((s) => `<button data-action="speed" data-speed="${s}" class="${ui.speed === s ? "active" : ""}">${s}×</button>`).join("")}</div>
      ${box("dev-fps", "Show FPS", !!ui.showFps, "A small overlay in the map's corner: frames per second and frame time (average and worst over the last second), script time per frame, and simulation ticks per second.")}
      <div class="row"><button data-action="tl-open" data-from="dev" title="Replay the game so far, sped up with the fog of war off (ui/timelapse.js). The game is paused while it plays; Close comes back here.">Timelapse so far</button></div>
    </div>
    <div class="muted small">Change over the last ${week ? now.day - week.day : 0} days${week ? "" : " (collecting)"}</div>
    <div class="devzed">
      <div>Hotzone tiles</div><div>${now.hot} ${delta(now.hot, week && week.hot)}</div>
      <div>Avg infection</div><div>${(now.infAvg * 100).toFixed(1)}% ${delta(now.infAvg * 100, week && week.infAvg * 100, 1)}</div>
      <div title="Infestation hives (sim/hives.js), their stored resources and daily income">Hives</div><div>${now.hives} ${delta(now.hives, week && week.hives)} · res ${Math.round(now.hiveRes)} (+${now.hv.income}/day)${now.hv.bossesReady ? ` · ${now.hv.bossesReady} Wallbreaker${now.hv.bossesReady === 1 ? "" : "s"} waiting` : ""}</div>
      <div>Hordes</div><div>${now.hordes} (${Math.round(now.hordeSize)} zombies) ${delta(now.hordeSize, week && week.hordeSize)}</div>
      <div title="Where the dead are gathering to build a new hive: dead gone into it of 1,000, the gathered mass and the combined score (30 starts it)">Build sites</div><div>${now.hv.sites.length ? now.hv.sites.map((x) => `${esc(x.name)}: ${x.biomass}/1000${x.started ? "" : " (gathering)"} · mass ${x.mass} · score ${x.score}`).join("<br>") : "none"}</div>
      <div>Next site / border horde</div><div>day ${now.hv.nextSiteDay} / day ${now.hv.nextBorderDay}</div>
      <div title="Over the whole game: hives destroyed and built, horde attacks on your bases held at the walls, break-ins beaten and bases overrun">Hive record</div><div>built ${now.hv.stats.built} · destroyed ${now.hv.stats.destroyed} · held ${now.hv.stats.held} · break-ins ${now.hv.stats.breakIns} (beaten ${now.hv.stats.repelled}, overrun ${now.hv.stats.overrun})</div>
    </div>
    <table class="devtable"><tr class="muted"><td>Group</td><td>Type</td><td>Pop</td><td>Bases</td><td>Land</td><td>Str</td></tr>${rows}</table>`;
}
