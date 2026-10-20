// Base workers on the State Map (the Layers box: "Base workers"): the people of your bases out on job trips
// (sim/jobtrips.js) walking out over the base's land, working a tile (a small ring over them fills with the work:
// tracking → stalking → dressing the kill), walking home with the load (a deer across the shoulders, a bundle of logs,
// a sack, full buckets …) and a "+18 meat" rising over the base as it goes into the store; and a light version at
// the groups' bases you can see (sim/grouptrips.js groupWalkers: a couple of walkers going out and in by day).
// Cheap: every position is worked out from the trip's times (s.trip: leave, arrive, workEnd, home) and the clock's
// minutes, no state of its own beyond this frame's hit boxes; only bases near the view are looked at, and a crowd at
// one base is drawn as a few figures with a ×N tag (MAX_FIGS). Hover one: who, the job, what they are doing, and their
// route as a faint line (H.hoverSid, trips-plus #4): the way out (dashed), the spot they work, the way back with the load
// (dotted, to where they drop it: the base, or a stockpile when sim/fieldworks takes the load there). Trouble on the
// way (sim/tripevents.js base.tripAlerts): a "!" over them for a little while ("?" for a small thing, "+" a find).
import { outHaulers } from "../sim/hauling.js"; // haulers on the road between your bases
import { tripState, outWorkers } from "../sim/jobtrips.js";
import { tripRoute, TRIP_JOBS, shoreOf } from "../sim/tripland.js";
import { TRIP_EV } from "../sim/tripevents.js";
import { groupWalkers } from "../sim/grouptrips.js";
import { ROLES } from "../sim/economy.js";
import { mapWorkerCanvas, pieceBox, yawOf } from "./mapfigures.js";

export const LOADS = { wood: "logs", hunt: "game", fish: "fish", forage: "basket", scavenge: "sack", water: "buckets" };
const RING = { wood: "#d8a860", hunt: "#e07a50", fish: "#5aa8e0", forage: "#9ad06a", scavenge: "#d8c890", water: "#7ac0f0" };
const MAX_FIGS = 5;        // figures a base at most; more workers are drawn in groups with a ×N tag
const POP_LIFE = 0.45;     // game hours a deposit's "+18 food" rises over the base
const SOLO_PX = 1.2;       // world px per grid px of a worker's figure (a lone team walker is 1.25: these a touch smaller)
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const first = (s) => s.name.split(" ")[0];

let hits = []; // this frame: [{ x, y, r, html, baseId, sid }] in world px
const routes = new Map();
function routeOf(state, from, to, owner) {
  const k = `${from}:${to}:${owner}`;
  let r = routes.get(k);
  if (!r) { if (routes.size > 600) routes.clear(); r = tripRoute(state, from, to, owner); routes.set(k, r); }
  return r;
}
const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
// A point a fraction u (0..1) of the way along a polyline, the way it heads (+1 right, −1 left) and that way as a yaw
// (mapfigures.js yawOf, the figure's heading).
function along(pts, u) {
  if (pts.length < 2) return { p: pts[0], dir: 1, yaw: 315 };
  const seg = [];
  let L = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
  let want = Math.max(0, Math.min(1, u)) * L;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const f = seg[i] > 0 ? Math.min(1, want / seg[i]) : 1;
      return { p: lerp(pts[i], pts[i + 1], f), dir: pts[i + 1][0] >= pts[i][0] ? 1 : -1, yaw: yawOf(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) };
    }
    want -= seg[i];
  }
  return { p: pts[pts.length - 1], dir: 1, yaw: 315 };
}
const jitter = (k, r) => { const a = ((k * 2.399963) % (Math.PI * 2)); return [Math.cos(a) * r, Math.sin(a) * r * 0.6]; };

// The way out for a trip: [the gate, the tiles between, the spot they work at] in world px.
function tripPath(state, H, home, target, at, job, k, owner = "player") {
  const route = routeOf(state, home, target, owner);
  const c = (id) => H.toPixel(id);
  const s = H.zoom;
  const [hx, hy] = c(home);
  const gate = [hx + jitter(k, 6 * s)[0], hy + 9 * s];
  const water = TRIP_JOBS[job] && TRIP_JOBS[job].water;
  let spot;
  if (water) { // at the water's edge: from the shore tile toward the water
    const shore = job === "fish" ? at : route.length >= 2 ? route[route.length - 2] : home;
    const w = c(target), sh = c(shore === target ? shoreOf(state, home, target, owner) : shore);
    spot = lerp(sh, w, 0.45);
    const j = jitter(k, H.HEX * 0.12);
    spot = [spot[0] + j[0], spot[1] + j[1]];
  } else {
    const [ax, ay] = c(at);
    if (at === home) { // the base's own tile: out at its edge, beside the walls (left or right of the sprite)
      const side = k % 2 ? 1 : -1, a = -0.2 + ((k * 0.37) % 0.6); // beside the walls, left or right: clear of the base's sprite and name
      spot = [ax + side * (H.baseHalf + 9 * s + ((k * 5) % 7)), ay + Math.sin(a) * H.HEX * 0.5];
    } else if (state.tiles[at] && state.tiles[at].loc) { // a site: beside its building, not on it
      const side = k % 2 ? 1 : -1;
      spot = [ax + side * H.HEX * (0.55 + ((k * 3) % 5) * 0.03), ay + H.HEX * (0.2 + ((k * 7) % 5) * 0.04)];
    } else {
      const j = jitter(k, H.HEX * 0.32);
      spot = [ax + j[0], ay + j[1]];
    }
  }
  const mid = route.slice(1, water ? -1 : -1).filter((id) => id !== home && id !== at && id !== target).map(c);
  if (water && job === "fish" && at !== home) mid.push(c(at));
  return [gate, ...mid, spot];
}
// Where a worker is and how: { x, y, dir, moving, work (0..1 or null), load }.
function placeOf(path, st, reach, job, k, t) {
  if (st.phase === "work") {
    const wander = job === "hunt" || job === "forage" || job === "scavenge";
    const [x, y] = path[path.length - 1];
    if (!wander) return { x, y, dir: 1, yaw: 45, moving: false, work: st.progress }; // at it, facing the viewer
    const a = st.progress * Math.PI * 3 + k;
    const r = 7;
    return { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.5, dir: -Math.sin(a) >= 0 ? 1 : -1, yaw: yawOf(-Math.sin(a), Math.cos(a) * 0.5), moving: true, work: st.progress };
  }
  const u = st.phase === "out" ? st.f * reach : reach * (1 - st.f);
  const a = along(path, u);
  return { x: a.p[0], y: a.p[1], dir: st.phase === "out" ? a.dir : -a.dir, yaw: st.phase === "out" ? a.yaw : (a.yaw + 180) % 360, moving: true, work: null };
}

// The hovered worker's route: out (dashed), the work spot (a ring), back to the drop (dotted). Cheap: a few segments.
function drawRoute(ctx, state, H, base, x) {
  const s = H.zoom, tr = x.trip;
  const path = legs(state, H, base, tr, x.s.id).out;
  const back = legs(state, H, base, tr, x.s.id).back;
  const line = (pts, color, dash) => {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.setLineDash(dash.map((v) => v * s)); ctx.strokeStyle = color; ctx.lineWidth = 1.6 * s; ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = "round";
  line(path, x.st.phase === "out" ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.3)", [5, 4]);
  line(back, x.st.phase === "back" ? "rgba(255,217,138,0.6)" : "rgba(255,217,138,0.32)", [1.5, 3.5]);
  ctx.setLineDash([]);
  const [wx, wy] = path[path.length - 1];
  ctx.beginPath(); ctx.arc(wx, wy, 6 * s, 0, Math.PI * 2); ctx.strokeStyle = RING[tr.job] || "#fff"; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.4 * s; ctx.stroke();
  ctx.restore();
}
// A trip's two legs in world px: out (from the gate, or from the stockpile they set out from: t.from) and back (to the
// gate, or to the stockpile that takes the load: t.drop, sim/jobtrips.js planTrip).
function legs(state, H, base, tr, k) {
  const path = tripPath(state, H, base.tile, tr.tile, tr.at, tr.job, k);
  const spot = path[path.length - 1];
  const out = tr.from != null ? [H.toPixel(tr.from), spot] : path;
  const back = tr.drop != null ? [spot, H.toPixel(tr.drop)] : [...path].reverse();
  return { out, back, path };
}
// The "!" over a worker who met trouble a moment ago (or is facing it now: a card waits).
function alertMark(ctx, x, y, mark, s, live) {
  const r = 5.5 * s;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = mark === "+" ? "rgba(70,140,60,0.92)" : mark === "?" ? "rgba(90,110,140,0.92)" : "rgba(190,50,40,0.95)";
  ctx.fill();
  ctx.lineWidth = 1.2 * s; ctx.strokeStyle = live ? "#fff" : "rgba(255,255,255,0.7)"; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(8 * s)}px Segoe UI`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(mark, x, y + 0.5);
}
// A small ring over a worker at work, filling with the work done.
function workRing(ctx, x, y, f, color, s) {
  const r = 4 * s;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(10,12,16,0.6)"; ctx.fill();
  ctx.lineWidth = 2 * s;
  ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, Math.min(1, f)));
  ctx.strokeStyle = color; ctx.stroke();
}
function tag(ctx, x, y, text, s) {
  ctx.font = `bold ${Math.round(7.5 * s)}px Segoe UI`;
  const w = ctx.measureText(text).width + 4 * s, h = 9 * s;
  ctx.fillStyle = "rgba(20,24,30,0.85)";
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = "#ffd98a";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
}

// Draws them all. H: { HEX, toPixel(id) → [x, y], piece(cv, gx, gy, u, o) (mapfigures.js drawPiece), cycleFrame(k, moving, ms), stepBob(k, amp),
// zoom (the sprites' size factor), baseHalf (half a base sprite's width), near(x, y) (on screen or close), t (the clock: hours with the minutes), color (your
// teams' blue), live (tiles in view now), still (no motion) }. Returns true when someone is on the move (the map
// should be drawn again as the minutes go by).
export function drawWorkers(ctx, state, H) {
  hits = [];
  let moving = false;
  const s = H.zoom;
  ctx.save();
  ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.globalCompositeOperation = "source-over";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const base of state.bases) {
    const [bx, by] = H.toPixel(base.tile);
    if (!H.near(bx, by)) continue;
    const list = outWorkers(state, base, H.t);
    if (list.length) {
      // One figure each, or a few in groups (job and what they are at, then job alone) with a ×N tag.
      let figs = list.map((x) => ({ key: x.s.id, members: [x] }));
      for (const keyOf of [(x) => `${x.trip.job}:${x.st.phase}:${x.trip.tile}`, (x) => `${x.trip.job}:${x.st.phase}`, (x) => x.trip.job]) {
        if (figs.length <= MAX_FIGS) break;
        const m = new Map();
        for (const x of list) { const k = keyOf(x); if (!m.has(k)) m.set(k, { key: k, members: [] }); m.get(k).members.push(x); }
        figs = [...m.values()];
      }
      for (const fig of figs) {
        const hov = H.hoverSid != null ? fig.members.find((x) => x.s.id === H.hoverSid) : null;
        if (hov) drawRoute(ctx, state, H, base, hov);
        const lead = fig.members[0], tr = lead.trip, job = tr.job, k = lead.s.id;
        const L = legs(state, H, base, tr, k);
        const path = tr.from != null && lead.st.phase === "out" ? L.out : L.path;
        const pl = lead.st.phase === "back" && tr.drop != null ? placeOf(L.back.slice().reverse(), lead.st, 1, job, k, H.t) : placeOf(path, lead.st, tr.reach ?? 1, job, k, H.t);
        if (pl.moving) moving = true;
        const c = tr.carry || {};
        const load = lead.st.phase === "back" && lead.st.load ? (job === "hunt" && !c.deer && !c.hog ? "small" : LOADS[job]) : "";
        const cv = mapWorkerCanvas(job, H.color, pl.yaw, H.cycleFrame(k * 7 + 3, pl.moving, load === "logs" || load === "game" ? 520 : 380), load);
        const u = SOLO_PX * s, gy = pl.y + 6 * s, [, , w, h] = pieceBox(cv, pl.x, gy, u);
        const bob = pl.moving ? H.stepBob(k * 7 + 3, 0.7 * s) : 0;
        ctx.beginPath(); ctx.ellipse(pl.x, gy + 1 * s, 5 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fill();
        H.piece(cv, pl.x, gy + bob, u);
        if (pl.work != null) workRing(ctx, pl.x, pl.y - h * 0.5 - 5 * s, pl.work, RING[job] || "#fff", s);
        if (fig.members.length > 1) tag(ctx, pl.x + w * 0.5, pl.y - h * 0.1, `×${fig.members.length}`, s);
        // Trouble on the way (sim/tripevents.js): "!" while a card holds them, and for a little while after.
        const held = fig.members.find((x) => x.st.held);
        const al = (base.tripAlerts || []).filter((a) => fig.members.some((x) => x.s.id === a.sid) && H.t - a.t >= 0 && H.t - a.t < TRIP_EV.pop).pop();
        if (held || al) { alertMark(ctx, pl.x, pl.y - h * 0.5 - (pl.work != null ? 14 : 6) * s, held ? "!" : al.mark, s, !!held); moving = true; }
        const lines = fig.members.slice(0, 6).map((x) => `<b>${esc(x.s.name)}</b> <span class="muted">· ${esc(ROLES[x.trip.job] ? ROLES[x.trip.job].name : x.trip.job)}</span><br>${esc(x.st.text)}`);
        if (fig.members.length > 6) lines.push(`<span class="muted">and ${fig.members.length - 6} more</span>`);
        hits.push({ x: pl.x, y: pl.y, r: Math.max(6, w * 0.6), html: `<span style="color:#cfe2f7">Out from ${esc(base.name)}</span><br>${lines.join("<br>")}`, baseId: base.id, sid: lead.s.id });
      }
    }
    // Haulers (sim/hauling.js) on the road between your bases: a figure with a sack along the route, out with the load
    // and home again; at the far end, standing by its gate; "!" while trouble holds them.
    for (const x of outHaulers(state, base, H.t)) {
      const tr = x.trip, k = x.s.id;
      const pts = (tr.path || [base.tile, tr.tile]).map((id) => H.toPixel(id));
      if (pts.length < 2) continue;
      const st = x.st;
      const u = st.phase === "out" ? 0 : st.phase === "work" ? Math.max(0, Math.min(1, st.f)) : st.turned ? (st.reach ?? 0.5) * (1 - st.f) : 1 - Math.max(0, Math.min(1, st.f));
      const a = along(pts, u);
      const back = st.phase === "back";
      const yaw = back ? (a.yaw + 180) % 360 : a.yaw;
      const movingNow = !(st.phase === "out" || (st.phase === "work" && st.f >= 1)) && !st.held;
      if (movingNow) moving = true;
      const cv = mapWorkerCanvas("haul", H.color, yaw, H.cycleFrame(k * 7 + 5, movingNow, 420), st.load ? "sack" : "");
      const uu = SOLO_PX * s, gy = a.p[1] + 6 * s, [, , w, h] = pieceBox(cv, a.p[0], gy, uu);
      ctx.beginPath(); ctx.ellipse(a.p[0], gy + 1 * s, 5 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fill();
      H.piece(cv, a.p[0], gy + (movingNow ? H.stepBob(k * 7 + 5, 0.7 * s) : 0), uu);
      if (st.held) { alertMark(ctx, a.p[0], a.p[1] - h * 0.5 - 6 * s, "!", s, true); moving = true; }
      hits.push({ x: a.p[0], y: a.p[1], r: Math.max(6, w * 0.6), html: `<span style="color:#cfe2f7">Hauler from ${esc(base.name)}</span><br><b>${esc(x.s.name)}</b><br>${esc(st.text)}`, baseId: base.id, sid: k });
    }
    // Trouble where nobody walks any more (a death out there): its mark on the tile for a while.
    for (const a of base.tripAlerts || []) {
      if (a.mark !== "✝" || H.t - a.t < 0 || H.t - a.t > TRIP_EV.pop * 4) continue;
      const [ax, ay] = H.toPixel(a.tile);
      alertMark(ctx, ax, ay - 8 * s, "✝", s, false);
    }
    // Deposits: "+18 meat" rising over the base as the load goes into the store.
    let row = 0;
    for (const p of base.tripPops || []) {
      const age = H.t - p.t;
      if (age < 0 || age > POP_LIFE) continue;
      const [px, py] = H.toPixel(p.tile ?? base.tile);
      const f = age / POP_LIFE, y = py - 20 * s - f * 16 * s - row++ * 11 * s; // several at once: one above the other
      ctx.globalAlpha = Math.max(0, 1 - f * f);
      ctx.font = `bold ${Math.round(9 * s)}px Segoe UI`;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,12,16,0.9)";
      ctx.strokeText(p.text, px, y);
      ctx.fillStyle = p.job === "water" ? "#9ad0f5" : p.job === "wood" ? "#e8c890" : "#b6f0a0";
      ctx.fillText(p.text, px, y);
      ctx.globalAlpha = 1;
      moving = true;
    }
  }
  // The groups' bases you can see now: a couple of walkers going out and in (grouptrips.js).
  if (H.groups) for (const f of state.factions) {
    if (!f.alive) continue;
    for (const tile of f.bases) {
      if (!H.live.has(tile)) continue;
      const [bx, by] = H.toPixel(tile);
      if (!H.near(bx, by)) continue;
      for (const w of groupWalkers(state, f, tile, H.t)) {
        const k = tile * 13 + w.i * 5 + 1;
        const c = ((H.t - 7 + w.i * 1.4) % 3 + 3) % 3 / 3; // a three-hour round: out, at it, home
        const st = c < 0.2 ? { phase: "out", f: c / 0.2 } : c < 0.8 ? { phase: "work", f: (c - 0.2) / 0.6, progress: (c - 0.2) / 0.6 } : { phase: "back", f: (c - 0.8) / 0.2 };
        const path = tripPath(state, H, tile, w.tile, w.tile, w.job, k, f.id);
        const pl = placeOf(path, st, 1, w.job, k, H.t);
        if (pl.moving) moving = true;
        const load = st.phase === "back" ? LOADS[w.job] : "";
        const cv = mapWorkerCanvas(w.job, f.color, pl.yaw, H.cycleFrame(k, pl.moving), load);
        const u = SOLO_PX * s, gy = pl.y + 6 * s, wd = pieceBox(cv, pl.x, gy, u)[2];
        H.piece(cv, pl.x, gy + (pl.moving ? H.stepBob(k, 0.7 * s) : 0), u, { alpha: 0.92 });
        const what = TRIP_JOBS[w.job] ? TRIP_JOBS[w.job].ing.toLowerCase() : "working";
        hits.push({ x: pl.x, y: pl.y, r: Math.max(6, wd * 0.6), html: `<span style="color:${esc(f.color)}">${esc(f.known ? f.name : "A group")}</span><br>One of their people ${st.phase === "back" ? "heading home" : st.phase === "out" ? "heading out" : what} by their base`, faction: f.id });
      }
    }
  }
  ctx.restore();
  return moving;
}

// The worker under a point of the map (world px): { html, baseId, sid } or null (main.js: the tooltip, a click).
export function workerAt(wx, wy) {
  let best = null, bd = Infinity;
  for (const h of hits) {
    const d = Math.hypot(h.x - wx, h.y - wy);
    if (d <= h.r && d < bd) { best = h; bd = d; }
  }
  return best;
}
export const workerHits = () => hits; // tools
