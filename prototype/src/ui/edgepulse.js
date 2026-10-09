// Red pulses at the screen's edge toward something off screen (shared by the State Map and the battle view: the
// sources and the hook are in ui/edgefx.js, what counts as an attack in ui/attackwatch.js).
//
//   edgePoint(x, y, rect)     where a point outside the view rect shows on its edge (null inside)
//   makePulseTracker(o)       one pulse per source: born, kept while the source lasts, fading when it ends, a cooldown
//                             before the same source pulses again, at most `cap` shown (the most urgent first)
//   makeEdgeLayer(host, fn)   the DOM: a layer over the canvas with a glow and a small badge (icon, short label) per
//                             pulse; a click on the badge calls fn(key)
// The geometry and the tracker are pure (no DOM, no clock of their own: the caller passes `now`), for the tools.

// A point (x, y) outside rect { x0, y0, x1, y1 }: the edge it shows on, seen from the middle of the rect, and where
// along it (t 0–1: left to right on the top and bottom edges, top to bottom on the sides, kept off the corners by
// `corner`), with the screen point (x, y) on the edge. Inside the rect (edges included): null.
export function edgePoint(px, py, rect, corner = 0.06) {
  const { x0, y0, x1, y1 } = rect;
  if (!(Number.isFinite(px) && Number.isFinite(py))) return null;
  if (px >= x0 && px <= x1 && py >= y0 && py <= y1) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
  const dx = px - cx, dy = py - cy;
  const kx = dx ? hw / Math.abs(dx) : Infinity, ky = dy ? hh / Math.abs(dy) : Infinity;
  let edge, t;
  if (kx <= ky) { edge = dx > 0 ? "right" : "left"; t = (cy + dy * kx - y0) / (y1 - y0 || 1); }
  else { edge = dy > 0 ? "bottom" : "top"; t = (cx + dx * ky - x0) / (x1 - x0 || 1); }
  t = Math.max(corner, Math.min(1 - corner, t));
  const x = edge === "left" ? x0 : edge === "right" ? x1 : x0 + t * (x1 - x0);
  const y = edge === "top" ? y0 : edge === "bottom" ? y1 : y0 + t * (y1 - y0);
  return { edge, t, x, y };
}

export const PULSE = { cap: 4, cooldownMs: 20000, fadeMs: 900, freshMs: 6000 };

// Sources: [{ key, pri (lower: more urgent), off (edgePoint or null when on screen), label, icon, … }]. step() keeps a
// pulse per key: a new key is born (unless it ended less than cooldownMs ago), a key gone fades for fadeMs and is
// then dropped with its cooldown started, a key back while fading is kept. A source on screen keeps its pulse (not
// shown) so looking at it and away does not start it again. Returns the pulses to show: off screen, fading last, by
// pri then age, at most cap; each { key, src, born, fading, fresh, alpha }.
export function makePulseTracker(o = {}) {
  const P = { ...PULSE, ...o };
  const live = new Map(), cool = new Map();
  return {
    get size() { return live.size; },
    cooling: (key, now) => (cool.get(key) || 0) > now,
    step(sources, now) {
      const seen = new Set();
      for (const s of sources) {
        if (!s || seen.has(s.key)) continue;
        seen.add(s.key);
        const e = live.get(s.key);
        if (e) { e.src = s; e.fading = null; continue; }
        if ((cool.get(s.key) || 0) > now) continue;
        live.set(s.key, { key: s.key, src: s, born: now, fading: null });
      }
      for (const [k, e] of live) {
        if (seen.has(k)) continue;
        if (e.fading == null) e.fading = now;
        if (now - e.fading >= P.fadeMs) { live.delete(k); cool.set(k, now + P.cooldownMs); }
      }
      for (const [k, until] of cool) if (until <= now) cool.delete(k);
      const out = [];
      for (const e of live.values()) {
        if (!e.src.off) continue;
        e.fresh = now - e.born < P.freshMs;
        e.alpha = e.fading == null ? 1 : Math.max(0, 1 - (now - e.fading) / P.fadeMs);
        out.push(e);
      }
      out.sort((a, b) => (a.fading != null) - (b.fading != null) || (a.src.pri || 0) - (b.src.pri || 0) || a.born - b.born);
      return out.slice(0, P.cap);
    },
    clear() { live.clear(); cool.clear(); },
  };
}

// ---------- the DOM layer ----------
const CSS = `
.edgepulse-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; overflow: hidden; }
.edgepulse { position: absolute; width: 0; height: 0; transition: opacity 0.3s; }
.edgepulse .ep-glow { position: absolute; width: 22rem; height: 22rem; left: -11rem; top: -11rem; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(235,40,30,0.55), rgba(220,30,25,0.22) 45%, rgba(200,20,20,0) 100%); pointer-events: none; }
.edgepulse.ep-left .ep-glow, .edgepulse.ep-right .ep-glow { transform: scale(0.42, 1); }
.edgepulse.ep-top .ep-glow, .edgepulse.ep-bottom .ep-glow { transform: scale(1, 0.42); }
.edgepulse.ep-fresh .ep-glow { animation: ep-beat 1.1s ease-in-out infinite; }
.edgepulse:not(.ep-fresh) .ep-glow { animation: ep-beat 2.6s ease-in-out infinite; opacity: 0.7; }
@keyframes ep-beat { 0%, 100% { opacity: 0.35; } 45% { opacity: 1; } }
.edgepulse .ep-badge { position: absolute; pointer-events: auto; cursor: pointer; white-space: nowrap; display: flex; align-items: center; gap: 0.35rem;
  padding: 0.2rem 0.55rem; font: 600 0.85rem/1.25 "Segoe UI", sans-serif; color: #ffe9e4; background: rgba(70,12,10,0.88);
  border: 1px solid rgba(255,110,95,0.85); border-radius: 0.9rem; box-shadow: 0 2px 10px rgba(0,0,0,0.55); max-width: 18rem; overflow: hidden; text-overflow: ellipsis; }
.edgepulse .ep-badge:hover { background: rgba(110,20,16,0.95); border-color: #ff9a8a; }
.edgepulse .ep-arrow { font-size: 0.8rem; opacity: 0.9; }
.edgepulse.ep-left .ep-badge { left: 0.7rem; transform: translateY(-50%); }
.edgepulse.ep-right .ep-badge { right: 0.7rem; transform: translateY(-50%); }
.edgepulse.ep-top .ep-badge { top: 0.7rem; transform: translateX(-50%); }
.edgepulse.ep-bottom .ep-badge { bottom: 0.7rem; transform: translateX(-50%); }
:root.calm .edgepulse .ep-glow { animation: none; opacity: 0.8; }
body.tl-on .edgepulse-layer { display: none; }
`;
const ARROW = { left: "◀", right: "▶", top: "▲", bottom: "▼" };
let styled = false;
function addStyle() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const st = document.createElement("style");
  st.id = "edgepulse-style";
  st.textContent = CSS;
  document.head.appendChild(st);
}

// Pulses on the same edge closer than GAP px along it are pushed apart (in order along the edge), so their badges do
// not cover each other. Returns key -> [x, y].
export const GAP = 34;
export function spreadOut(pulses, gap = GAP) {
  const at = new Map(), byEdge = {};
  for (const p of pulses) if (p.src.off) (byEdge[p.src.off.edge] = byEdge[p.src.off.edge] || []).push(p);
  for (const [edge, list] of Object.entries(byEdge)) {
    const side = edge === "left" || edge === "right"; // positions along y
    list.sort((a, b) => (side ? a.src.off.y - b.src.off.y : a.src.off.x - b.src.off.x));
    let prev = -Infinity;
    for (const p of list) {
      const o = p.src.off, v = Math.max(side ? o.y : o.x, prev + gap);
      prev = v;
      at.set(p.key, side ? [o.x, v] : [v, o.y]);
    }
  }
  return at;
}

// host: the element over the canvas (position: relative), onClick(key, pulse). update(pulses, w, h): pulses from a
// tracker; the layer is w × h CSS px (the canvas). hide(): nothing shown.
export function makeEdgeLayer(host, onClick) {
  if (!host || typeof document === "undefined") return { update() {}, hide() {}, el: null, count: () => 0 };
  addStyle();
  const layer = document.createElement("div");
  layer.className = "edgepulse-layer";
  host.appendChild(layer);
  const els = new Map(); // key -> { el, badge, text, edge, x, y, fresh, alpha, pulse }
  const make = (p) => {
    const el = document.createElement("div");
    const glow = document.createElement("div");
    glow.className = "ep-glow";
    const badge = document.createElement("button");
    badge.className = "ep-badge";
    badge.type = "button";
    el.append(glow, badge);
    const rec = { el, badge, text: "", edge: "", x: NaN, y: NaN, fresh: null, alpha: -1, pulse: p };
    badge.addEventListener("click", (ev) => { ev.stopPropagation(); onClick(rec.pulse.key, rec.pulse); });
    badge.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    layer.appendChild(el);
    return rec;
  };
  return {
    el: layer,
    count: () => els.size,
    update(pulses) {
      const keep = new Set();
      const at = spreadOut(pulses);
      for (const p of pulses) {
        const s = p.src, off = s.off;
        if (!off) continue;
        const [ox, oy] = at.get(p.key);
        keep.add(p.key);
        let r = els.get(p.key);
        if (!r) els.set(p.key, (r = make(p)));
        r.pulse = p;
        const text = `${s.icon || "⚠"} ${s.label}`;
        if (r.text !== text || r.edge !== off.edge) {
          r.text = text;
          r.badge.textContent = "";
          const arrow = document.createElement("span");
          arrow.className = "ep-arrow";
          arrow.textContent = ARROW[off.edge];
          const label = document.createElement("span");
          label.textContent = text;
          if (off.edge === "right" || off.edge === "bottom") r.badge.append(label, arrow); else r.badge.append(arrow, label);
          r.badge.title = s.tip || `${s.label}: click to look there`;
        }
        if (r.edge !== off.edge) { r.edge = off.edge; r.el.className = `edgepulse ep-${off.edge}${p.fresh ? " ep-fresh" : ""}`; r.fresh = p.fresh; }
        if (r.fresh !== p.fresh) { r.fresh = p.fresh; r.el.classList.toggle("ep-fresh", !!p.fresh); }
        if (!(Math.abs(r.x - ox) <= 0.5 && Math.abs(r.y - oy) <= 0.5)) { r.x = ox; r.y = oy; r.el.style.left = `${ox.toFixed(1)}px`; r.el.style.top = `${oy.toFixed(1)}px`; }
        const a = Math.round(p.alpha * 20) / 20;
        if (a !== r.alpha) { r.alpha = a; r.el.style.opacity = String(a); }
      }
      for (const [k, r] of els) if (!keep.has(k)) { r.el.remove(); els.delete(k); }
    },
    hide() { for (const r of els.values()) r.el.remove(); els.clear(); },
  };
}
