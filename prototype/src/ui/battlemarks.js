// Marks that stay on a battle's ground for the rest of the fight: blood where someone was hit or fell (a spitter's
// acid green), spent brass under shooters (red shells for shotguns), scorch marks where grenades, Molotovs, rockets
// and fire went off (ash where it burned), broken glass where a window was smashed or a car was shot up, and the
// bodies themselves (isoview.js keeps every body it has seen on the ground, under the living).
// A renderer only: the marks are read off the battle's fx events (sim/combat.js fx: shots, blows, throws) and the state
// of its units and cells, on the UI side. Nothing here touches the sim's data or dice (its own hash makes the scatter).
// They live here, keyed by the battle object and its map: a new battle, a restart (the battle-start save is a new
// battle object), a loaded save or a map swap (the fall back to the yard) starts clean. At most MARK_CAP (the oldest
// brass goes first). Fog of war: a mark is drawn only once one of your people has seen its cell (blood left in the dark
// is found when someone walks up); a body likewise (knownBody).
// Drawn in map space (16 px a tile, the ground's texels: isoview.js flatGroundFor) into one canvas stretched onto the
// diamonds with the ground's transform, so turning or zooming the view never repaints it; it is repainted only when a
// mark is added, seen or dropped. A pool of blood grows for a couple of seconds first (drawn live until it has).
// Marks the map came with (a building's signs of survival, sim/interiorscenes.js: c.blood, c.brass) are read off its
// cells, every floor, when the battle's marks start (preplaced).
// Display → Battle ground marks (ui/displayopts.js battleMarks): full; light (blood, scorch and glass only, no brass or
// ash, fewer kept, no growing); off.
import { CELL, WEAPONS } from "../sim/combat.js";
import { FRAG, BLAST, FIRE } from "../sim/throwables.js";
import { ROCKET, GL_HE } from "../sim/launchers.js";
import { onForgetPictures } from "./pictures.js";

export const MARK_CAP = 600, MARK_CAP_LOW = 200;
export const MARK_TEX = 16;          // map px a tile (the ground's texels)
export const GROW_MS = 1800;         // a pool of blood spreads this long
export const MARK_LEVELS = { full: 2, low: 1, off: 0 };
export const MARKS = { level: 2 };
export function setMarksLevel(k) {
  const l = typeof k === "number" ? k : MARK_LEVELS[k] ?? 2;
  if (l !== MARKS.level) { MARKS.level = l; if (S) S.dirty = true; }
}

let mkCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export function setMarksCanvas(fn) { mkCanvas = fn; if (S) S.cv = null, S.dirty = true; }

// ---------- the marks of the battle being fought ----------
// S: { b, key, lastSeq, list: [{ k, x, y, r, a, n, seed, t0, seen, f }], dead, down, known, fires, cells, dirty, cv }
//   k: blood | acid | brass | shell | scorch | ash | glass; x, y: world tile units (a tile's middle is +0.5); r: its
//   size in tiles; a: an angle (brass, the way a spray flew); n: how many specks; t0: when it was made (ms).
let S = null;
const mapKey = (b) => `${b.w}x${b.h}:${b.tier ? b.tier.map : ""}:${b.floors ? b.floors.length : 1}`;
export function marksOf(b) {
  if (!b) return null;
  const key = mapKey(b);
  if (!S || S.b !== b || S.key !== key) S = freshState(b, key);
  return S;
}
export const clearMarks = () => { S = null; };
function freshState(b, key) {
  // The windows and cars on the map as they are now: glass when one breaks or is hit.
  const cells = new Map();
  for (let i = 0; i < b.cells.length; i++) {
    const c = b.cells[i];
    if (c.k === "window" || c.k === "car" || c.k === "truck" || c.k === "vehicle") cells.set(i, { k: c.k, hp: c.hp, wr: !!(c.car && c.car.wrecked) });
  }
  const st = { b, key, lastSeq: b.fxSeq || 0, list: [], dead: new Set(), down: new Set(), known: new Set(), fires: new Set(), cells, dirty: true, cv: null, rev: 0, unseen: 0, duds: [] };
  preplaced(st);
  return st;
}
// What the map came with (sim/interiorscenes.js): blood on the floors (c.blood { kind, amount }), spent brass
// (c.brass: cases) and a fire's scorch (c.scorch: 1–3, a restaurant kitchen's) on every floor of the building, found like any mark when someone sees the cell.
function preplaced(st) {
  const b = st.b;
  const floors = b.floors && b.floors.length ? b.floors.map((F) => F.cells) : [b.cells];
  floors.forEach((cells, f) => {
    if (!cells) return;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c || (!c.blood && !c.brass && !c.scorch)) continue;
      const x = i % b.w, y = (i / b.w) | 0;
      const put = (m) => { m.t0 = -GROW_MS; m.seen = false; m.f = f; m.cell = i; st.list.push(m); st.unseen++; };
      if (c.blood) {
        const n = Math.max(1, Math.min(3, c.blood.amount || 1));
        for (let k = 0; k < n; k++) put({ k: c.blood.kind === "zombie" ? "zblood" : "blood", x: x + 0.5 + (hash(i, k, 21) - 0.5) * 0.5, y: y + 0.5 + (hash(i, k, 22) - 0.5) * 0.5, r: 0.16 + 0.1 * n + hash(i, k, 23) * 0.08, a: hash(i, k, 24) * 6.28, n: 3 + n, seed: i * 11 + k + 5 });
      }
      if (c.scorch) { put({ k: "scorch", x: x + 0.5, y: y + 0.5, r: 0.4 + 0.1 * c.scorch, a: 0, n: 4, seed: i * 13 + 1 }); put({ k: "ash", x: x + 0.5, y: y + 0.5, r: 0.35, a: 0, n: 6, seed: i * 13 + 2 }); } // a kitchen fire's aftermath (sim/eaterylayout.js)
      for (let k = 0; k < Math.min(8, c.brass || 0); k++) put({ k: "brass", x: x + 0.2 + hash(i, k, 31) * 0.6, y: y + 0.2 + hash(i, k, 32) * 0.6, r: 0.1, a: hash(i, k, 33) * 6.28, n: 1, seed: i * 13 + k });
    }
  });
}

// ---------- small helpers ----------
function hash(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const inside = (b, x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h;
const cellH = (b, x, y) => { const c = b.cells[y * b.w + x]; return c.h ?? (CELL[c.k] && CELL[c.k].h) ?? 0; };
// Marks lie on the ground: not on a walkway, a tower, a roof or an upper floor (the brass falls where nobody sees it).
const onGround = (b, x, y) => inside(b, x, y) && !cellH(b, x, y);
const unitAt = (b, x, y) => b.units.find((u) => u.x === x && u.y === y && !u.left && !u.fled && !u.off) || null;
const bloodKind = (t) => (t && t.ztype === "spitter" ? "acid" : t && t.kind === "zombie" ? "zblood" : "blood");
// Not wounds: a blow at a wall, a ladder pushed, a shout.
const NOWOUND = /^(LADDER|PUSHED|BROKEN|SMASHED|RAM|STUN|PEPPER|HANDS UP|KO|DAZED|BURST|SCREAM|DUD|WINDS UP|RISES|WORMS)/;

function add(st, m, now) {
  const b = st.b;
  const xi = Math.floor(m.x), yi = Math.floor(m.y);
  if (!onGround(b, Math.max(0, Math.min(b.w - 1, xi)), Math.max(0, Math.min(b.h - 1, yi)))) return null;
  m.t0 = now; m.seen = false; m.f = m.f || 0;
  m.cell = Math.max(0, Math.min(b.h - 1, yi)) * b.w + Math.max(0, Math.min(b.w - 1, xi));
  st.list.push(m);
  st.unseen++;
  const cap = MARKS.level >= 2 ? MARK_CAP : MARK_CAP_LOW;
  while (st.list.length > cap) {
    let i = st.list.findIndex((q) => q.k === "brass" || q.k === "shell"); // the oldest brass first
    if (i < 0) i = 0;
    const [gone] = st.list.splice(i, 1);
    if (!gone.seen) st.unseen--;
    st.dirty = true;
  }
  return m;
}

// ---------- reading the battle ----------
// New fx events (by seq), units newly dead or down, cells newly burning, windows broken, cars hit. Cheap when nothing
// happened; called each frame (isoview.js drawIso) and after every action and enemy step (ui/combat.js), so the
// battle's short fx list (40) never drops one unread.
export function ingestMarks(b, now = 0) {
  const st = marksOf(b);
  if (!st || !MARKS.level) { if (st) st.lastSeq = b.fxSeq || 0; return st; }
  const full = MARKS.level >= 2;
  if ((b.fxSeq || 0) > st.lastSeq) {
    for (const f of b.fx) {
      if (f.seq <= st.lastSeq) continue;
      fromFx(st, f, now, full);
    }
    st.lastSeq = b.fxSeq || 0;
  }
  // Bodies: a pool under each of the fallen (once), a smaller one under the downed.
  for (const t of b.units) {
    if (t.x < 0 || t.y < 0 || t.left || t.fled) continue;
    if (t.dead && !st.dead.has(t.id)) {
      st.dead.add(t.id);
      if (t.off || t.ztype === "swarm" || t.sank || t.noPool) continue; // no body (noPool: a scene's quiet death, sim/interiorscenes.js)
      const s = hash(t.id, 7, b.turn);
      add(st, { k: bloodKind(t), x: t.x + 0.5 + (s - 0.5) * 0.2, y: t.y + 0.5 + (hash(t.id, 8, 1) - 0.5) * 0.2, r: t.ztype === "spitter" ? 0.55 : 0.42, a: s * 6.28, n: 5, seed: t.id * 31 + 7, f: t.f || 0, pool: true }, now);
    } else if (t.down && !t.dead && !t.ko && !st.down.has(t.id)) {
      st.down.add(t.id);
      add(st, { k: bloodKind(t), x: t.x + 0.5, y: t.y + 0.55, r: 0.26, a: 0, n: 3, seed: t.id * 17 + 3, f: t.f || 0, pool: true }, now);
    }
  }
  // Fire: scorched ground under every cell that burned, ash on it.
  for (const c of b.fires || []) {
    const i = c.y * b.w + c.x;
    if (st.fires.has(i)) continue;
    st.fires.add(i);
    add(st, { k: "scorch", x: c.x + 0.5, y: c.y + 0.5, r: 0.62, a: 0, n: 4, seed: i * 13 + 1, f: c.f || 0 }, now);
    if (full) add(st, { k: "ash", x: c.x + 0.5, y: c.y + 0.5, r: 0.45, a: 0, n: 10, seed: i * 13 + 2, f: c.f || 0 }, now);
  }
  // Glass: a window smashed, a car hit or blown up (sim/combat.js breakCell, vehicleBlast).
  for (const [i, o] of st.cells) {
    const c = b.cells[i];
    if (!c) continue;
    const wr = !!(c.car && c.car.wrecked);
    const broke = o.k === "window" && c.k !== "window", hit = c.hp != null && o.hp != null && c.hp < o.hp, blown = wr && !o.wr;
    if (broke || hit || blown) {
      const x = i % b.w, y = (i / b.w) | 0, s = hash(i, b.fxSeq || 0, 5);
      // A window's glass falls to both sides of it, a car's around it.
      for (let k = 0; k < (broke ? 2 : 1); k++) {
        const [dx, dy] = nearGround(b, x, y, k);
        add(st, { k: "glass", x: dx + 0.5 + (hash(i, k, 9) - 0.5) * 0.5, y: dy + 0.5 + (hash(i, k, 10) - 0.5) * 0.5, r: broke ? 0.4 : 0.3, a: s * 6.28, n: broke ? 9 : 5, seed: i * 7 + k + (b.fxSeq || 0), f: 0 }, now);
      }
      if (blown) add(st, { k: "scorch", x: x + 0.5, y: y + 0.5, r: 0.8, a: 0, n: 4, seed: i * 3 + 11, f: 0 }, now);
    }
    o.k = c.k; o.hp = c.hp; o.wr = wr;
  }
  return st;
}
// The ground next to a cell (a window's sides, a car's), the k-th found.
function nearGround(b, x, y, k) {
  const out = [];
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) if (onGround(b, x + dx, y + dy) && CELL[b.cells[(y + dy) * b.w + x + dx].k] && CELL[b.cells[(y + dy) * b.w + x + dx].k].walk) out.push([x + dx, y + dy]);
  return out.length ? out[k % out.length] : [x, y];
}

// One fx event's marks.
function fromFx(st, f, now, full) {
  const b = st.b, fl = f.f || 0;
  if (f.type === "shot" && f.from && f.to) {
    if (f.misfire) return;
    const [ax, ay] = f.from, [tx, ty] = f.to;
    const dx = tx - ax, dy = ty - ay, d = Math.hypot(dx, dy) || 1, ang = Math.atan2(dy, dx);
    if (f.rocket) { blast(st, tx, ty, ROCKET.r, f.seq, now, fl, 1.1); return; }
    // Spent brass under the shooter (a gun: not a bow, a spitter or a launcher), a few for a burst or a stream,
    // thrown out to the right of the way they fired.
    const a = !f.overpen ? unitAt(b, ax, ay) : null, w = a && WEAPONS[a.weapon];
    if (full && w && w.cal && !w.acid && !w.launcher && onGround(b, ax, ay)) {
      const rounds = Math.max(1, f.rounds || 1), n = Math.min(6, rounds <= 3 ? rounds : 3 + Math.floor((rounds - 3) / 3));
      const shell = /ga$/.test(w.cal);
      for (let k = 0; k < n; k++) {
        const s1 = hash(f.seq, k, 1), s2 = hash(f.seq, k, 2), side = ang + Math.PI / 2 + (s1 - 0.5) * 1.4, far = 0.18 + s2 * 0.32;
        add(st, { k: shell ? "shell" : "brass", x: ax + 0.5 + Math.cos(side) * far, y: ay + 0.5 + Math.sin(side) * far, r: 0.1, a: hash(f.seq, k, 3) * 6.28, n: 1, seed: f.seq * 8 + k, f: fl }, now);
      }
    }
    // Blood where it hit (none for a miss): spattered a little away from the shooter.
    if (f.hit && !f.suppress) {
      const t = unitAt(b, tx, ty);
      if (!t && !f.acid) return;
      const kind = f.acid ? "acid" : bloodKind(t), dmg = Math.max(4, f.dmg || 8);
      add(st, { k: kind, x: tx + 0.5 + (dx / d) * 0.22 + (hash(f.seq, 4, 4) - 0.5) * 0.2, y: ty + 0.5 + (dy / d) * 0.22 + (hash(f.seq, 5, 5) - 0.5) * 0.2, r: 0.14 + Math.min(40, dmg) / 40 * 0.2, a: ang, n: 3 + Math.min(3, f.hits || 1), seed: f.seq * 5 + 1, f: fl, spray: true }, now);
    }
    return;
  }
  if (f.type === "melee" && f.to) {
    const text = f.text || "";
    if (/^DUD/.test(text)) { undoBlast(st, f.to); return; }
    if (!f.hit || NOWOUND.test(text)) return;
    if (!(f.dmg > 0) && !/^(KILLED|EXECUTED|CRUSHED|ACID)/.test(text)) return;
    const t = unitAt(b, f.to[0], f.to[1]);
    if (!t) return;
    const ang = f.from ? Math.atan2(f.to[1] - f.from[1], f.to[0] - f.from[0]) : 0;
    add(st, { k: f.acid ? "acid" : bloodKind(t), x: f.to[0] + 0.5 + Math.cos(ang) * 0.15, y: f.to[1] + 0.5 + Math.sin(ang) * 0.15, r: 0.16 + Math.min(40, f.dmg || 10) / 40 * 0.18, a: ang, n: 3, seed: f.seq * 5 + 2, f: fl, spray: true }, now);
    return;
  }
  // Something in the flames that went off where it lay (sim/launchers.js fireCookOffs): a blast leaves its scorch
  // (the fire under it already left its own).
  if (f.type === "cookoff" && f.to && f.text === "BOOM") {
    const r = { frag: FRAG.r, pipebomb: BLAST.r, a_40mm_he: GL_HE.r, a_rocket_heat: ROCKET.r }[f.item] || 0.6;
    blast(st, f.to[0], f.to[1], r, f.seq, now, fl, 1);
    return;
  }
  if (f.type === "throw" && f.to) {
    const [x, y] = f.to;
    if (f.item === "frag") blast(st, x, y, Math.max(FRAG.r, GL_HE.r), f.seq, now, fl, 1);
    else if (f.item === "pipebomb") blast(st, x, y, BLAST.r, f.seq, now, fl, 1);
    else if (f.item === "molotov") {
      add(st, { k: "scorch", x: x + 0.5, y: y + 0.5, r: FIRE.r * 0.8, a: 0, n: 6, seed: f.seq * 3, f: fl, throw: f.seq }, now);
      if (full) add(st, { k: "ash", x: x + 0.5, y: y + 0.5, r: FIRE.r * 0.6, a: 0, n: 14, seed: f.seq * 3 + 1, f: fl, throw: f.seq }, now);
    } else if (f.item === "flashbang") add(st, { k: "scorch", x: x + 0.5, y: y + 0.5, r: 0.3, a: 0, n: 2, seed: f.seq * 3, f: fl, throw: f.seq }, now);
  }
}
// A blast's scorch, radius r (tiles: sim/throwables.js FRAG, BLAST; sim/launchers.js GL_HE, ROCKET). The glass of a
// window or car it breaks comes from the cells (ingestMarks).
function blast(st, x, y, r, seq, now, fl, dark) {
  add(st, { k: "scorch", x: x + 0.5, y: y + 0.5, r: r * 0.75, a: 0, n: 7, seed: seq * 3, f: fl, throw: seq, dark }, now);
}
// A launcher's round that landed too close to arm (sim/launchers.js dud): no blast after all.
function undoBlast(st, to) {
  for (let i = st.list.length - 1; i >= 0; i--) {
    const m = st.list[i];
    if (m.throw && m.k === "scorch" && Math.floor(m.x) === to[0] && Math.floor(m.y) === to[1]) { st.list.splice(i, 1); if (!m.seen) st.unseen--; st.dirty = true; return; }
  }
}

// ---------- fog of war ----------
// Marks become drawable once their cell is seen (vis: the view's visibility, 1 a tile).
export function revealMarks(b, vis) {
  const st = marksOf(b);
  if (!st || !st.unseen || !vis) return;
  const fl = b.floor || 0;
  for (const m of st.list) if (!m.seen && m.f === fl && vis[m.cell]) { m.seen = true; st.unseen--; st.dirty = true; }
}
// A body (dead or down, either side) is drawn where it lies once it has been seen there; your own always.
export function knownBody(b, t, vis) {
  const st = marksOf(b);
  if (t.side === "player") return true;
  if (vis && vis[t.y * b.w + t.x]) { st.known.add(t.id); return true; }
  return st.known.has(t.id);
}

// ---------- drawing ----------
const BLOODY = new Set(["blood", "zblood", "acid"]);
const growing = (m, now) => BLOODY.has(m.k) && now >= m.t0 && now - m.t0 < GROW_MS;
// The marks' layer: the baked canvas (map space, MARK_TEX a tile) and the pools still spreading, drawn live. ctx is
// already transformed by the caller onto the ground (isoview.js groundXform). fl: the floor in view.
export function drawMarks(ctx, b, now, fl = 0) {
  const st = marksOf(b);
  if (!st || !MARKS.level || !st.list.length) return 0;
  const live = MARKS.level >= 2 ? st.list.filter((m) => m.seen && m.f === fl && growing(m, now)) : [];
  if (st.dirty || st.fl !== fl || (st.live && st.live > live.length)) bake(st, now, fl);
  st.live = live.length;
  if (st.cv) for (const t of st.cv) ctx.drawImage(t.cv, t.x, t.y);
  for (const m of live) paintMark(ctx, m, 0.3 + 0.7 * easeOut((now - m.t0) / GROW_MS));
  return st.list.length;
}
const easeOut = (t) => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;
// Baked in tiles of TILE cells a side (issue #24: a 300 × 300 map would be one 4800 px picture), only the tiles that
// hold a mark (a mark is painted into each tile its reach touches). st.cv: [{ cv, x, y }] in map px.
const TILE = 128;
function bake(st, now, fl) {
  const b = st.b, T = TILE * MARK_TEX;
  const full = MARKS.level >= 2;
  // The ground first (scorch, ash), then glass, then blood, then the brass on top.
  const order = { scorch: 0, ash: 1, glass: 2, zblood: 3, blood: 3, acid: 3, brass: 4, shell: 4 };
  const list = st.list.filter((m) => m.seen && m.f === fl && (full || (m.k !== "brass" && m.k !== "shell" && m.k !== "ash")) && !(full && growing(m, now))).sort((p, q) => order[p.k] - order[q.k]);
  const old = new Map((st.cv || []).map((t) => [`${t.x},${t.y}`, t])), tiles = new Map();
  const tileAt = (tx, ty) => {
    const k = `${tx * T},${ty * T}`;
    let t = tiles.get(k);
    if (!t) {
      const w = Math.min(T, b.w * MARK_TEX - tx * T), h = Math.min(T, b.h * MARK_TEX - ty * T), o = old.get(k);
      t = { cv: o && o.cv.width === w && o.cv.height === h ? o.cv : mkCanvas(w, h), x: tx * T, y: ty * T };
      const c = t.cv.getContext("2d");
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, w, h);
      c.translate(-t.x, -t.y);
      tiles.set(k, t);
    }
    return t;
  };
  for (const m of list) {
    const R = (m.r * 3 + 1) / TILE; // a pool's splashes and a scorch's reach (tiles, generous)
    for (let ty = Math.max(0, Math.floor((m.y / TILE) - R)); ty <= Math.min(Math.ceil(b.h / TILE) - 1, Math.floor((m.y / TILE) + R)); ty++)
      for (let tx = Math.max(0, Math.floor((m.x / TILE) - R)); tx <= Math.min(Math.ceil(b.w / TILE) - 1, Math.floor((m.x / TILE) + R)); tx++) paintMark(tileAt(tx, ty).cv.getContext("2d"), m, 1);
  }
  st.cv = [...tiles.values()];
  st.dirty = false; st.fl = fl; st.rev++;
  st.baked = list.length;
}
const COLS = {
  blood: ["rgba(104,18,16,0.86)", "rgba(70,10,10,0.9)"],
  zblood: ["rgba(64,30,20,0.86)", "rgba(40,22,14,0.9)"],
  acid: ["rgba(122,196,52,0.8)", "rgba(78,140,30,0.85)"],
};
// One mark in map px (MARK_TEX a tile); g: how far a pool has spread (0..1).
export function paintMark(c, m, g) {
  const T = MARK_TEX, X = m.x * T, Y = m.y * T, R = m.r * T * g;
  const rnd = (k) => hash(m.seed, k, 77);
  switch (m.k) {
    case "blood": case "zblood": case "acid": {
      const [col, dark] = COLS[m.k];
      c.fillStyle = col;
      c.beginPath();
      for (let k = 0; k < m.n; k++) {
        const a = rnd(k) * 6.283, d = k ? rnd(k + 20) * R * 0.75 : 0, rr = R * (k ? 0.45 + rnd(k + 40) * 0.4 : 0.8);
        c.moveTo(X + Math.cos(a) * d + rr, Y + Math.sin(a) * d * 0.9);
        c.arc(X + Math.cos(a) * d, Y + Math.sin(a) * d * 0.9, Math.max(0.6, rr), 0, 6.283);
      }
      // Droplets thrown on the way the round or the blow went.
      if (m.spray) for (let k = 0; k < 3; k++) {
        const d = R * (1.1 + rnd(k + 60) * 1.2) * g, a = m.a + (rnd(k + 70) - 0.5) * 0.9, rr = Math.max(0.5, T * 0.035 * (1 + rnd(k + 80)));
        c.moveTo(X + Math.cos(a) * d + rr, Y + Math.sin(a) * d);
        c.arc(X + Math.cos(a) * d, Y + Math.sin(a) * d, rr, 0, 6.283);
      }
      c.fill();
      if (R > T * 0.2) { c.fillStyle = dark; c.beginPath(); c.arc(X + (rnd(90) - 0.5) * R * 0.3, Y + (rnd(91) - 0.5) * R * 0.3, R * 0.42, 0, 6.283); c.fill(); }
      return;
    }
    case "brass": case "shell": {
      c.save();
      c.translate(X, Y); c.rotate(m.a);
      if (m.k === "shell") { c.fillStyle = "#a3241c"; c.fillRect(-1.6, -0.7, 2.4, 1.4); c.fillStyle = "#c9a43e"; c.fillRect(0.8, -0.7, 0.9, 1.4); }
      else { c.fillStyle = "#b8902e"; c.fillRect(-1.2, -0.55, 2.4, 1.1); c.fillStyle = "#f0d67c"; c.fillRect(-1.2, -0.55, 1.1, 0.5); }
      c.restore();
      return;
    }
    case "scorch": {
      const dk = m.dark || 0.8;
      const gr = c.createRadialGradient(X, Y, 0, X, Y, Math.max(1, R));
      if (gr && gr.addColorStop) { gr.addColorStop(0, `rgba(8,7,6,${0.92 * dk})`); gr.addColorStop(0.45, `rgba(14,12,10,${0.72 * dk})`); gr.addColorStop(0.8, `rgba(20,16,12,${0.3 * dk})`); gr.addColorStop(1, "rgba(24,20,16,0)"); }
      c.fillStyle = gr && gr.addColorStop ? gr : `rgba(16,12,10,${0.5 * dk})`;
      c.beginPath(); c.arc(X, Y, Math.max(1, R), 0, 6.283); c.fill();
      // Ragged streaks out from the middle.
      c.fillStyle = `rgba(10,9,8,${0.6 * dk})`;
      c.beginPath();
      for (let k = 0; k < m.n; k++) {
        const a = rnd(k) * 6.283, d = R * (0.5 + rnd(k + 30) * 0.5), rr = Math.max(0.6, R * (0.12 + rnd(k + 50) * 0.14));
        c.moveTo(X + Math.cos(a) * d + rr, Y + Math.sin(a) * d);
        c.arc(X + Math.cos(a) * d, Y + Math.sin(a) * d, rr, 0, 6.283);
      }
      c.fill();
      return;
    }
    case "ash": case "glass": {
      for (let k = 0; k < m.n; k++) {
        const a = rnd(k) * 6.283, d = Math.sqrt(rnd(k + 30)) * R;
        c.fillStyle = m.k === "ash" ? (k % 3 ? "rgba(130,126,120,0.8)" : "rgba(80,76,72,0.85)") : (k % 3 ? "rgba(196,226,236,0.85)" : "rgba(255,255,255,0.95)");
        c.fillRect(Math.round(X + Math.cos(a) * d), Math.round(Y + Math.sin(a) * d * 0.9), 1, 1);
      }
      return;
    }
    default:
  }
}
onForgetPictures(() => { if (S) { S.cv = null; S.dirty = true; } }); // ui/pictures.js: the baked marks are drawn again from the list after a lost GPU context
