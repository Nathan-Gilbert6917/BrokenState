// The screen-edge warnings in the game (main.js: initEdgeFx at start-up, edgeFrame every frame): on the State Map a
// red pulse toward a base of yours under attack, a team of yours in a fight and a raid or horde about to hit a base
// (ui/attackwatch.js) when that tile is off screen; in the isometric battle view one toward a unit of yours shot at or
// hit out of view. Clicking the badge looks there (render.js centerOn, isoview.js isoCenterOn). The pulses and their
// DOM are ui/edgepulse.js (one per source, a cooldown, at most 4). Settings → Display: Screen-edge warnings (on) and
// Heartbeat while a base is attacked (off: a soft heartbeat on the ambience bus, ui/audio.js volumes and mutes).
// Pure UI: reads the state, never changes it.
import { camera, centerOn, view, HEX } from "./render.js";
import { project, isoCenterOn } from "./isoview.js";
import { displayOptions } from "./display.js";
import { VOICES, sfx } from "./audio.js";
import { edgePoint, makePulseTracker, makeEdgeLayer } from "./edgepulse.js";
import { mapAttackSources, battleHitSources, baseUnderAttack } from "./attackwatch.js";

const SOURCE_MS = 250;   // the map's sources are looked for this often
const MARGIN = 14;       // CSS px: a point this close to the edge counts as off screen
const BEAT_MS = 950;     // the heartbeat's gap

let mapLayer = null, cbLayer = null, refreshFn = () => {};
const mapTrack = makePulseTracker(), cbTrack = makePulseTracker({ cooldownMs: 4000 });
let mapSrc = [], lastSrc = -Infinity, lastBeat = 0, curState = null, curUi = null;
const cbMem = { b: null, seq: 0, hits: new Map() };
export const edgeStats = { map: 0, battle: 0, beats: 0 };

// A soft "lub-dub" on the ambience bus (ui/audio.js sfx: the master, ambience and mute settings apply).
VOICES.heartbeat = { dur: 0.5, amb: true, play(c, out, t, o) {
  for (const [at, pk] of [[0, 0.5], [0.24, 0.32]]) {
    const g = c.createGain(), lp = c.createBiquadFilter(), osc = c.createOscillator(), s = t + at;
    lp.type = "lowpass"; lp.frequency.value = 160;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, pk * o.gain), s + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.2);
    osc.type = "sine";
    osc.frequency.setValueAtTime(68, s);
    osc.frequency.exponentialRampToValueAtTime(36, s + 0.18);
    osc.connect(g); g.connect(lp); lp.connect(out);
    osc.start(s); osc.stop(s + 0.22);
  }
} };

export function initEdgeFx(mapHost, battleHost, refresh) {
  refreshFn = refresh || (() => {});
  mapLayer = makeEdgeLayer(mapHost, (key, p) => {
    const tile = p && p.src ? p.src.tile : null;
    if (tile == null || !curState) return;
    centerOn(curState, tile);
    if (curUi) curUi.selected = tile;
    view.selected = tile;
    refreshFn();
  });
  cbLayer = makeEdgeLayer(battleHost, (key, p) => {
    const b = curState && curState.combat, u = p && p.src && p.src.unit;
    if (b && u) isoCenterOn(b, u.x, u.y);
  });
}

// The pulse sits on the canvas's own edge (the margin only decides what counts as off screen).
const snap = (off, w, h) => (!off ? null : off.edge === "left" ? { ...off, x: 0 } : off.edge === "right" ? { ...off, x: w } : off.edge === "top" ? { ...off, y: 0 } : { ...off, y: h });
const enabled = () => { const o = displayOptions(); return !o || o.edgeWarn !== false; };

// mapShown: the State Map is on screen (main.js: no battle, timelapse or title over it).
export function edgeFrame(state, ui, now, mapShown) {
  curState = state; curUi = ui;
  if (!mapLayer || !state) return;
  const on = enabled() && ui.started && !state.gameOver;
  // The map's sources (also for the heartbeat while a battle is open: none then, the battle has its own sounds).
  if (now - lastSrc >= SOURCE_MS) { lastSrc = now; mapSrc = on || heartOn() ? mapAttackSources(state) : []; }
  // The canvas sizes are read only while there is something to show (a layout read every frame would cost).
  if (on && mapShown && (mapSrc.length || mapTrack.size)) {
    const [w, h] = sizeOf("map");
    const rect = { x0: MARGIN, y0: MARGIN, x1: w - MARGIN, y1: h - MARGIN };
    const srcs = [];
    if (w && h) for (const s of mapSrc) {
      if (s.tile == null) continue;
      const [px, py] = state.grid.toPixel(s.tile, HEX);
      srcs.push({ ...s, off: snap(edgePoint((px - camera.x) * camera.zoom, (py - camera.y) * camera.zoom, rect), w, h) });
    }
    const shown = mapTrack.step(srcs, now);
    mapLayer.update(shown);
    edgeStats.map = shown.length;
  } else if (mapLayer.count()) { mapLayer.hide(); edgeStats.map = 0; }
  // The battle (isometric, the only battle view: ui/isoview.js).
  const b = state.combat;
  const hits = on && b ? battleHitSources(b, cbMem, now) : null;
  if (hits && (hits.length || cbTrack.size)) {
    const [w, h] = sizeOf("combatmap");
    const rect = { x0: MARGIN, y0: MARGIN, x1: w - MARGIN, y1: h - MARGIN };
    const srcs = hits.map((s) => {
      const [x, y] = project(s.unit.x + 0.5, s.unit.y + 0.5, 0);
      return { ...s, off: w && h ? snap(edgePoint(x, y, rect), w, h) : null };
    });
    const shown = cbTrack.step(srcs, now);
    cbLayer.update(shown);
    edgeStats.battle = shown.length;
  } else if (cbLayer.count()) { cbLayer.hide(); edgeStats.battle = 0; }
  // The heartbeat: a base of yours under attack, on the map (not over a battle or the menu).
  if (heartOn() && !state.combat && !ui.settings && ui.started && baseUnderAttack(mapSrc) && now - lastBeat >= BEAT_MS) {
    lastBeat = now;
    if (sfx("heartbeat", { gain: 0.9, pitch: 1 })) edgeStats.beats++;
  }
}
const sizeOf = (id) => { const cv = document.getElementById(id); return cv ? [cv.clientWidth, cv.clientHeight] : [0, 0]; };
const heartOn = () => { const o = displayOptions(); return !!(o && o.heartbeat); };
