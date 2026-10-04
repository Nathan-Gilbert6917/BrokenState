// Chronicle: a compact recording of the whole world (no fog of war) for the timelapse viewer (ui/timelapse.js).
// One frame per in-game day (every 6 hours for the first 3 days, plus a frame soon after a major event): tile
// owners and infection as changes against the previous frame (a full keyframe every KEY_EVERY frames), your
// bases, the groups' bases, hordes (with their Wallbreakers), hives and hive build sites, parties, your population
// and hub stocks, and captions for notable
// events. Pure data, no DOM. Recording only reads the world and never touches state.rng, so a run plays out the
// same with or without it. chronicleReader turns frames back into a state-like object that render() can draw.
import { hub, alive } from "./world.js";
import { vehicleById } from "./vehicles.js";

export const INF_Q = 63;     // infection stored as 0..63 (finer steps would not show in the overlay)
const KEY_EVERY = 60;        // a full keyframe every 60 frames, so seeking never replays more than 59 deltas
const EARLY_HOURS = 72;      // frames every 6 hours for the first 3 days
const EVENT_GAP = 3;         // an event frame comes at least 3 hours after the previous frame
const HEAD = 11;             // header slots in a frame's packed data (see record)
const DEDUPE_HOURS = 120;    // the same caption text is not repeated within 5 days ("X is out of food")
const BIG_HORDE = 120;       // hordes this big get a caption once

// Log lines that are routine or that the chronicle captions in its own words (with a map position).
const SKIP_LOG = /finished at|crafted at|broke\.$|clogged|wound|running again|left behind|ran out of fuel|Convoy back|is home|Not enough|no escort|from the bodies|has collapsed|was destroyed by your team|thanks your squad|trade route|refused the convoy|out of water|Every survivor is dead|extracted from|set up\./i;

// Owner codes in frames: 0 = nobody, 1 = you, 2 + i = group i in chronicle.factions.
function facIndex(c, f) {
  let i = c.facIndex.get(f.id);
  if (i == null) {
    i = c.factions.length;
    c.facIndex.set(f.id, i);
    c.factions.push({ id: f.id, name: f.name, color: f.color, type: f.type });
    c.facAlive.push(f.alive);
  }
  return i;
}
function ownerCode(c, owner) {
  if (owner == null) return 0;
  if (owner === "player") return 1;
  const i = c.facIndex.get(owner);
  return i == null ? 0 : 2 + i;
}

// Small ids for hordes and parties (sim ids can outgrow 16 bits); dead objects drop out of the WeakMap.
function keyOf(c, obj) {
  let k = c.keys.get(obj);
  if (!k) {
    k = c.nextKey;
    c.nextKey = (c.nextKey % 65535) + 1;
    c.keys.set(obj, k);
  }
  return k;
}

const clamp16 = (v) => Math.max(0, Math.min(65535, Math.round(v || 0)));

// Where a tile is, for captions: "at Millbrook" on a named site, "near Millbrook" (closest site within 4 tiles),
// otherwise "in the wilds". bare: just the site's name when there is one ("took over Millbrook").
export function placeName(state, id, bare = false) {
  const t = state.tiles[id];
  if (!t) return "somewhere";
  if (t.loc) return bare ? t.loc.name : `at ${t.loc.name}`;
  let best = null, bd = Infinity;
  for (const n of state.grid.within(id, 4)) {
    const loc = state.tiles[n].loc;
    const d = state.grid.distance(id, n);
    if (loc && (d < bd || (d === bd && (loc.type === "town" || loc.type === "city")))) { best = loc; bd = d; }
  }
  return best ? `near ${best.name}` : `in the wilds (${t.x},${t.y})`;
}

// Party look packed into 16 bits: sprite (0 walkers, 1 truck, 2 sedan, 3 raid) | people shown - 1 << 2 |
// phase (0 moving, 1 waiting, 2 working, 3 siege) << 4 | color (0 team, 1 trade convoy, 2 supply run) << 6 |
// owner code << 8.
function partyCode(state, c, p) {
  let sprite = 0;
  if (p.vehicle) {
    const v = p.vehicleId != null ? vehicleById(state, p.vehicleId) : null;
    sprite = v && v.type === "sedan" ? 2 : 1;
  } else if (p.kind === "raid") sprite = 3;
  const people = p.owner === "player" ? (p.members || []).length : Math.round((p.strength || 4) / 2);
  const phase = p.phase === "waiting" ? 1 : p.phase === "siege" ? 3 : ["task", "engaged", "helping", "holding"].includes(p.phase) ? 2 : 0;
  const color = p.kind === "convoy" && p.owner === "player" ? (p.routeKind === "supply" ? 2 : 1) : 0;
  const owner = p.owner === "player" ? 1 : ownerCode(c, p.owner); // 0 (unknown owner) is skipped on playback
  return sprite | (Math.max(0, Math.min(3, people) - 1) << 2) | (phase << 4) | (color << 6) | (Math.min(255, owner) << 8);
}

// ---------- recording ----------
export function startChronicle(state) {
  const n = state.tiles.length;
  const c = (state.chronicle = {
    v: 1, tiles: n,
    factions: [], facIndex: new Map(), facAlive: [], // groups: { id, name, color, type }, index = owner code - 2
    frames: [],   // { h, d: Uint16Array (packed, see record), full: Uint8Array | null (keyframe), bases, fb, hives, sites }
    events: [],   // captions: { h, text, kind (death | danger | good | info | world), tile, color?, major? }
    own: new Uint8Array(n), inf: new Uint8Array(n), // last recorded values; deltas are taken against these
    keys: new WeakMap(), nextKey: 1, announced: new WeakSet(), sieges: [], hordeSize: new WeakMap(),
    lastHour: -1, lastLog: state.log[0] || null, seenLog: state.log[0] || null, pending: false, nBases: state.bases.length,
    bases: null, baseSig: null, fb: null, fbSig: null, hives: null, hiveSig: null, sites: null, siteSig: null, overAt: null, said: new Map(), ms: 0,
  });
  for (const f of state.factions) facIndex(c, f);
  const h = hub(state);
  caption(c, { h: state.hour, text: `Day 1. ${h ? h.name : "Your holdout"} starts with ${alive(state).length} survivors. ${state.factions.length} other groups are out there.`, kind: "info", tile: h ? h.tile : -1, major: true });
  record(state, c);
  return c;
}

// Hourly hook (end of tickHour). Cheap unless a frame is due.
export function recordChronicle(state) {
  const c = state.chronicle;
  if (!c) return;
  // A new death in the log or a base gained or lost asks for an extra frame soon.
  if (state.log[0] !== c.seenLog) {
    for (const l of state.log) {
      if (l === c.seenLog) break;
      if (l.kind === "death") { c.pending = true; break; }
    }
    c.seenLog = state.log[0];
  }
  if (state.bases.length !== c.nBases) c.pending = true;
  const hr = state.hour;
  if (hr === c.lastHour && !(state.gameOver && c.overAt == null)) return;
  if (hr % 24 === 0 || (hr < EARLY_HOURS && hr % 6 === 0) || (state.gameOver && c.overAt == null) || (c.pending && hr - c.lastHour >= EVENT_GAP)) record(state, c);
}

// Records a last frame now if the world changed since the last one (the game can end outside the hourly tick,
// in a battle). The timelapse calls this when it opens.
export function finishChronicle(state) {
  const c = state.chronicle;
  if (!c) return null;
  if (c.lastHour !== state.hour || (state.gameOver && c.overAt == null)) record(state, c);
  return c;
}

// key: what counts as "the same caption" for the 5-day repeat check (the text by default).
function caption(c, e, key = e.text) {
  const last = c.said.get(key);
  if (last != null && e.h - last < DEDUPE_HOURS) return;
  c.said.set(key, e.h);
  c.events.push(e);
}

const now = () => (typeof performance !== "undefined" ? performance.now() : 0);

function record(state, c) {
  const t0 = now();
  const n = c.tiles, tiles = state.tiles;
  const first = !c.frames.length;
  const key = c.frames.length % KEY_EVERY === 0;
  for (const f of state.factions) facIndex(c, f);
  // Tiles: owner and infection changes, land per owner code, hives.
  const ownD = [], infD = [], land = [], hives = [];
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    const o = ownerCode(c, t.owner);
    const q = Math.round((t.infection || 0) * INF_Q);
    if (o !== c.own[i]) { ownD.push(i, o); c.own[i] = o; }
    if (q !== c.inf[i]) { infD.push(i, q); c.inf[i] = q; }
    if (o) land[o] = (land[o] || 0) + 1;
    if (t.hive) hives.push(i);
  }
  // Movers: hordes [key, tile, size | Wallbreakers << 14], parties [key, tile, look code, siege target tile].
  const hz = [], pt = [];
  for (const h of state.hordes) hz.push(keyOf(c, h), h.tile, Math.min(16383, Math.round(h.size || 0)) | (Math.min(3, h.bosses || 0) << 14));
  for (const p of state.parties) {
    const tile = p.path && p.path[p.idx];
    if (tile == null) continue;
    pt.push(keyOf(c, p), tile, partyCode(state, c, p), p.phase === "siege" && p.target && p.target.tile != null ? p.target.tile : 65535);
  }
  // Packed frame data. Header: [0] people alive, [1..4] hub food / water / ammo / meds, [5] owner changes,
  // [6] infection changes, [7] hordes, [8] parties, [9] groups, [10] your land; then per group [pop, land,
  // alive], then owner pairs [tile, code], infection pairs [tile, value], hordes and parties as above.
  const nF = c.factions.length;
  const deltas = key ? 0 : ownD.length + infD.length;
  const d = new Uint16Array(HEAD + nF * 3 + deltas + hz.length + pt.length);
  const hb = hub(state), st = hb ? hb.stock : {};
  d.set([alive(state).length, clamp16(st.food), clamp16(st.water), clamp16(st.ammo), clamp16(st.meds),
    key ? 0 : ownD.length / 2, key ? 0 : infD.length / 2, hz.length / 3, pt.length / 4, nF, land[1] || 0]);
  let o = HEAD;
  const live = new Map(state.factions.map((f) => [f.id, f]));
  c.factions.forEach((m, i) => {
    const f = live.get(m.id);
    d[o++] = clamp16(f ? f.pop : 0);
    d[o++] = land[2 + i] || 0;
    d[o++] = f && f.alive ? 1 : 0;
  });
  if (!key) { d.set(ownD, o); o += ownD.length; d.set(infD, o); o += infD.length; }
  d.set(hz, o); o += hz.length;
  d.set(pt, o);
  let full = null;
  if (key) { full = new Uint8Array(n * 2); full.set(c.own); full.set(c.inf, n); }

  // Interned parts: the same array is shared by every frame until something changes.
  const prevBases = c.bases, prevFb = c.fb, prevHives = c.hives;
  const baseSig = state.bases.map((b) => `${b.id}|${b.tile}|${b.type}|${b.name}|${+!!b.radio}${+!!b.watchtower}${+!!b.alert}|${b.buildings.map((x) => x.type).join(",")}`).join(";");
  if (baseSig !== c.baseSig) {
    c.baseSig = baseSig;
    c.bases = state.bases.map((b) => ({ id: b.id, tile: b.tile, type: b.type, name: b.name, radio: !!b.radio, watchtower: !!b.watchtower, alert: !!b.alert, bld: b.buildings.map((x) => x.type) }));
  }
  const fb = c.factions.map(() => []);
  for (const f of state.factions) if (f.alive) fb[facIndex(c, f)] = f.bases.slice();
  const fbSig = fb.map((x) => x.join(",")).join(";");
  if (fbSig !== c.fbSig) { c.fbSig = fbSig; c.fb = fb; }
  const hiveSig = hives.join(",");
  if (hiveSig !== c.hiveSig) { c.hiveSig = hiveSig; c.hives = hives; }
  // Hive build sites: [tile, biomass (in steps of 50), started].
  const sites = (state.hiveSites || []).map((x) => [x.tile, Math.floor(x.biomass / 50) * 50, x.started != null ? 1 : 0]);
  const siteSig = sites.map((x) => x.join(":")).join(",");
  if (siteSig !== c.siteSig) { c.siteSig = siteSig; c.sites = sites; }

  if (!first) {
    logCaptions(state, c);
    worldCaptions(state, c, prevBases, prevFb, prevHives);
  } else c.lastLog = state.log[0] || null;
  if (state.gameOver && c.overAt == null) {
    c.overAt = state.hour;
    const hb2 = hub(state);
    if (state.victory && state.victoryReason === "alliance") caption(c, { h: state.hour, text: `The Calder Coalition holds the state. ${hb2 ? hb2.name : "The holdout"} and its allies have won on day ${Math.floor(state.hour / 24) + 1}.`, kind: "good", tile: hb2 ? hb2.tile : -1, major: true });
    else if (state.victory) caption(c, { h: state.hour, text: `Every hive is destroyed. ${hb2 ? hb2.name : "The holdout"} has won on day ${Math.floor(state.hour / 24) + 1}.`, kind: "good", tile: hb2 ? hb2.tile : -1, major: true });
    else caption(c, { h: state.hour, text: `Every survivor is dead. ${hb2 ? hb2.name : "The holdout"} has fallen on day ${Math.floor(state.hour / 24) + 1}.`, kind: "death", tile: hb2 ? hb2.tile : -1, major: true });
  }
  c.frames.push({ h: state.hour, d, full, bases: c.bases, fb: c.fb, hives: c.hives, sites: c.sites });
  c.lastHour = state.hour;
  c.pending = false;
  c.nBases = state.bases.length;
  c.ms += now() - t0; // time spent recording (tools/timelapsetest.js reports it)
}

// Notable log lines since the last frame, with a map position when one can be found.
function logCaptions(state, c) {
  const fresh = [];
  for (const l of state.log) {
    if (l === c.lastLog) break;
    fresh.push(l);
  }
  c.lastLog = state.log[0] || null;
  for (let i = fresh.length - 1; i >= 0; i--) {
    const l = fresh[i];
    if (l.kind !== "death" && l.kind !== "danger" && l.kind !== "good") continue;
    if (l.text.startsWith("🤖")) continue; // the governor's own notes (autopilot.js) are not events
    if (l.kind !== "death" && SKIP_LOG.test(l.text)) continue;
    if (l.kind === "death" && /Every survivor is dead/.test(l.text)) continue;
    if (/^Every hive is destroyed/.test(l.text) || (/^The Calder Coalition holds/.test(l.text) && c.overAt == null)) continue; // the chronicle's own victory caption says it (a coalition victory after Keep playing is captioned from its log line)
    const major = l.kind === "death" || /founded|overran|has been lost|abandoned|joined/.test(l.text);
    caption(c, { h: l.hour, text: l.text, kind: l.kind, tile: captionTile(state, c, l.text), major });
  }
}

function captionTile(state, c, text) {
  const m = /^(.+?) (died|was taken prisoner|lost hope)/.exec(text);
  if (m) {
    const site = state.deathSites.find((d) => d.names.includes(m[1]));
    if (site) return site.tile;
  }
  for (const b of state.bases) if (text.includes(b.name)) return b.tile;
  for (const b of c.bases || []) if (text.includes(b.name)) return b.tile; // a base lost since the last frame
  // A place named in the line ("Fight near Sorensen Farm: defeat."): the longest site name it contains, or the
  // "(x,y)" of open ground as tile labels write it.
  if (!c.siteNames) c.siteNames = state.tiles.filter((t) => t.loc && t.loc.name).map((t) => [t.loc.name, t.id]).sort((a, b) => b[0].length - a[0].length);
  for (const [name, id] of c.siteNames) if (text.includes(name)) return id;
  const at = /\((\d+),(\d+)\)/.exec(text);
  if (at) {
    const t = state.tiles.find((x) => x.x === Number(at[1]) && x.y === Number(at[2]));
    if (t) return t.id;
  }
  for (const f of state.factions) if (f.bases.length && text.includes(f.name)) return f.bases[0];
  return -1;
}

// What the fog of war hid: groups taking and losing sites, collapses, sieges, hives, big hordes; plus your bases
// appearing or disappearing when the log did not already say so.
function worldCaptions(state, c, prevBases, prevFb, prevHives) {
  const h = state.hour;
  const said = (name) => c.events.some((e) => e.h > c.lastHour && e.text.includes(name));
  if (prevBases && prevBases !== c.bases) {
    const now = new Set(c.bases.map((b) => b.id)), before = new Set(prevBases.map((b) => b.id));
    for (const b of c.bases) if (!before.has(b.id) && !said(b.name)) caption(c, { h, text: `${b.name} founded.`, kind: "good", tile: b.tile, major: true });
    for (const b of prevBases) if (!now.has(b.id) && !said(b.name)) caption(c, { h, text: `${b.name} is gone.`, kind: "death", tile: b.tile, major: true });
  }
  c.factions.forEach((m, i) => {
    const was = (prevFb && prevFb[i]) || [], is = c.fb[i] || [];
    const f = state.factions.find((x) => x.id === m.id);
    const dead = !f || !f.alive;
    if (dead && c.facAlive[i]) caption(c, { h, text: `${m.name} collapsed.`, kind: "world", color: m.color, tile: was.length ? was[0] : -1, major: true });
    c.facAlive[i] = !dead;
    if (!prevFb || prevFb === c.fb || dead) return;
    for (const t of is) if (!was.includes(t)) caption(c, { h, text: `${m.name} took over ${placeName(state, t, true)}.`, kind: "world", color: m.color, tile: t });
    for (const t of was) if (!is.includes(t)) caption(c, { h, text: `${m.name} lost ${placeName(state, t, true)}.`, kind: "world", color: m.color, tile: t });
  });
  if (prevHives && prevHives !== c.hives) {
    for (const t of prevHives) if (!c.hives.includes(t)) caption(c, { h, text: `A hive ${placeName(state, t)} was destroyed.`, kind: "good", tile: t, major: true });
    for (const t of c.hives) if (!prevHives.includes(t)) caption(c, { h, text: `A new hive rose ${placeName(state, t)}.`, kind: "danger", tile: t, major: true });
  }
  for (const hd of state.hordes) {
    // A horde that lost a good part of itself on a group's base tile threw itself at that base.
    const was = c.hordeSize.get(hd);
    const f = was >= 40 && hd.size < was * 0.8 ? state.factions.find((x) => x.alive && x.bases.includes(hd.tile)) : null;
    if (f) caption(c, { h, text: `A horde of ${was} struck ${f.name} ${placeName(state, hd.tile)}.`, kind: "world", color: f.color, tile: hd.tile }, `strike:${hd.tile}`);
    c.hordeSize.set(hd, hd.size);
    if (hd.size < BIG_HORDE || c.announced.has(hd)) continue;
    c.announced.add(hd);
    caption(c, { h, text: `A horde of ${hd.size} is massing ${placeName(state, hd.tile)}.`, kind: "danger", tile: hd.tile });
  }
  for (const p of state.parties) {
    if (p.phase !== "siege" || p.owner === "player" || !p.target || c.announced.has(p)) continue;
    c.announced.add(p);
    const m = c.factions[c.facIndex.get(p.owner)];
    const base = p.target.kind === "player" ? state.bases.find((b) => b.id === p.target.baseId) : null;
    const target = base ? null : state.factions.find((f) => f.id === p.target.factionId);
    const victim = base ? base.name : target ? target.name : placeName(state, p.target.tile, true);
    caption(c, { h, text: `${victim} is under siege by ${m ? m.name : "raiders"}.`, kind: base ? "danger" : "world", color: m && !base ? m.color : undefined, tile: p.target.tile });
    if (target) c.sieges.push({ p, target, attacker: m ? m.name : "raiders", color: m ? m.color : undefined, pop: target.pop, bases: target.bases.length, tile: p.target.tile });
  }
  // Sieges between groups that ended since the last frame (yours are in the log already).
  c.sieges = c.sieges.filter((sg) => {
    if (state.parties.includes(sg.p)) return true;
    const t = sg.target, lost = sg.pop - t.pop;
    const text = !t.alive ? `${t.name} fell to ${sg.attacker}.` : lost >= Math.max(3, sg.pop * 0.15) || t.bases.length < sg.bases ? `${sg.attacker} hit ${t.name} hard (${lost} dead).` : `${t.name} held off ${sg.attacker}.`;
    caption(c, { h, text, kind: "world", color: sg.color, tile: sg.tile, major: !t.alive });
    return false;
  });
}

// Rough memory use: typed-array payload plus estimated object overhead (see tools/timelapsetest.js for a
// measured heap number).
export function chronicleSize(c) {
  let payload = 0, arrays = 0;
  const interned = new Set();
  for (const f of c.frames) {
    payload += f.d.byteLength;
    arrays++;
    if (f.full) { payload += f.full.byteLength; arrays++; }
    interned.add(f.bases).add(f.fb).add(f.hives).add(f.sites);
  }
  let internedBytes = 0;
  for (const x of interned) internedBytes += JSON.stringify(x || []).length * 2 + 64;
  const captionBytes = c.events.reduce((s, e) => s + 80 + e.text.length * 2, 0);
  const approx = payload + arrays * 140 + c.frames.length * 72 + internedBytes + captionBytes + c.own.byteLength * 2;
  return { frames: c.frames.length, keyframes: c.frames.filter((f) => f.full).length, payload, interned: interned.size, captions: c.events.length, captionBytes, approx };
}

// ---------- playback ----------
const FAKE_VEHICLES = [{ id: -1, type: "truck" }, { id: -2, type: "sedan" }];
const SPRITE_KIND = ["walkers", "truck", "sedan", "raid"];

// Reads a chronicle back: chronicleReader(state).frameState(hour) gives a state-like object for render(state)
// (every tile live, the recorded owners, infection, bases, groups, hordes and parties; hordes and parties
// step from one frame's tile toward the next one's, infection fades between frames). Also the series the
// timelapse charts use. Decoded tile layers are cached (three slots), so playing forward costs one delta per
// frame and seeking at most KEY_EVERY - 1.
export function chronicleReader(state) {
  const c = state.chronicle;
  const n = c.tiles, g = state.grid, frames = c.frames;
  const tiles = state.tiles.map((t) => Object.create(t)); // terrain, roads and sites from the real tiles
  const live = new Set(state.tiles.map((t) => t.id));
  const slots = [0, 1, 2].map(() => ({ k: -1, own: new Uint8Array(n), inf: new Uint8Array(n), used: 0 }));
  let clock = 0;
  const baseCache = new WeakMap();

  const sections = (fr) => {
    const d = fr.d;
    const fac = HEAD, own = fac + d[9] * 3, inf = own + d[5] * 2, hz = inf + d[6] * 2, pt = hz + d[7] * 3;
    return { d, fac, own, inf, hz, pt };
  };
  const applyDelta = (slot, k) => {
    const { d, own, inf } = sections(frames[k]);
    for (let i = 0; i < d[5]; i++) slot.own[d[own + i * 2]] = d[own + i * 2 + 1];
    for (let i = 0; i < d[6]; i++) slot.inf[d[inf + i * 2]] = d[inf + i * 2 + 1];
  };
  function decode(k) {
    let slot = slots.find((s) => s.k === k);
    if (slot) { slot.used = ++clock; return slot; }
    const prev = slots.find((s) => s.k === k - 1 && k > 0 && !frames[k].full);
    slot = slots.filter((s) => s !== prev).sort((a, b) => a.used - b.used)[0];
    if (prev) {
      slot.own.set(prev.own);
      slot.inf.set(prev.inf);
      applyDelta(slot, k);
    } else {
      let kk = k;
      while (kk > 0 && !frames[kk].full) kk--;
      slot.own.set(frames[kk].full.subarray(0, n));
      slot.inf.set(frames[kk].full.subarray(n));
      for (let j = kk + 1; j <= k; j++) applyDelta(slot, j);
    }
    slot.k = k;
    slot.used = ++clock;
    return slot;
  }
  // Last frame at or before hour t.
  function frameAt(t) {
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].h <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  const ownerOf = (code) => (code === 0 ? null : code === 1 ? "player" : c.factions[code - 2] ? c.factions[code - 2].id : null);
  // A tile on the straight line between two tiles (movers step tile by tile, like on the live map).
  const lerpTile = (a, b, f) => {
    if (a === b || f <= 0) return a;
    if (f >= 1) return b;
    const [ax, ay] = g.toPixel(a, 1), [bx, by] = g.toPixel(b, 1);
    const id = g.fromPixel(ax + (bx - ax) * f, ay + (by - ay) * f, 1);
    return id < 0 ? a : id;
  };
  // Small per-frame caches (hordes / parties by key, overlay info): playback asks for the same two frames ~60
  // times a second.
  const memo = new Map();
  const cached = (key, make) => {
    let v = memo.get(key);
    if (v === undefined) {
      if (memo.size > 24) memo.clear();
      memo.set(key, (v = make()));
    }
    return v;
  };
  const movers = (k, at, size) => cached(`${at}${k}`, () => {
    const out = new Map();
    const fr = frames[k], d = fr.d, count = at === "hz" ? d[7] : d[8];
    const o = sections(fr)[at];
    for (let i = 0; i < count; i++) out.set(d[o + i * size], d.subarray(o + i * size, o + (i + 1) * size));
    return out;
  });
  const baseOf = (r) => {
    let b = baseCache.get(r);
    if (!b) {
      b = { id: r.id, tile: r.tile, type: r.type, name: r.name, radio: r.radio, watchtower: r.watchtower, alert: r.alert, buildings: r.bld.map((type) => ({ type })), stock: {}, construction: [], armory: [] };
      baseCache.set(r, b);
    }
    return b;
  };

  // Everything the overlay shows for one frame.
  const frameInfo = (k) => cached(`i${k}`, () => makeInfo(k));
  function makeInfo(k) {
    const { d, fac } = sections(frames[k]);
    const groups = c.factions.map((m, i) => (i < d[9] ? { ...m, pop: d[fac + i * 3], land: d[fac + i * 3 + 1], alive: !!d[fac + i * 3 + 2], bases: (frames[k].fb[i] || []).length } : { ...m, pop: 0, land: 0, alive: false, bases: 0 }));
    let zombies = 0;
    const { hz } = sections(frames[k]);
    for (let i = 0; i < d[7]; i++) zombies += d[hz + i * 3 + 2] & 16383;
    return {
      hour: frames[k].h, pop: d[0], stock: { food: d[1], water: d[2], ammo: d[3], meds: d[4] }, land: d[10],
      bases: frames[k].bases.length, groups, hordes: d[7], zombies, hives: frames[k].hives.length, sites: (frames[k].sites || []).length,
      fallen: c.overAt != null && frames[k].h >= c.overAt && d[0] === 0,
    };
  }

  function frameState(t) {
    const k = frameAt(t), k1 = Math.min(k + 1, frames.length - 1);
    const f0 = frames[k], f1 = frames[k1];
    const span = f1.h - f0.h;
    const frac = span > 0 ? Math.max(0, Math.min(1, (t - f0.h) / span)) : 0;
    const A = decode(k), B = k1 !== k ? decode(k1) : A;
    const info = frameInfo(k);
    // Tiles. On the last frame of a lost game your land and bases are gone (graves are drawn by the viewer).
    for (let i = 0; i < n; i++) {
      const ft = tiles[i];
      const code = A.own[i];
      ft.owner = info.fallen && code === 1 ? null : ownerOf(code);
      ft.infection = (A.inf[i] + (B.inf[i] - A.inf[i]) * frac) / INF_Q;
      ft.hive = false;
    }
    for (const id of f0.hives) tiles[id].hive = true;
    const hiveSites = (f0.sites || []).map(([tile, biomass, started], i) => ({ id: -1 - i, tile, biomass, started: started ? f0.h : null, score: 0 }));
    const factions = info.groups.map((m, i) => ({ id: m.id, name: m.name, color: m.color, type: m.type, alive: m.alive, pop: m.pop, bases: m.alive ? f0.fb[i] || [] : [], goodwill: 0 }));
    const bases = info.fallen ? [] : f0.bases.map(baseOf);
    // Hordes and parties move toward their tile in the next frame; ones that vanish or appear swap at the halfway mark.
    const hordes = [];
    const h0 = movers(k, "hz", 3), h1 = movers(k1, "hz", 3);
    for (const [key, a] of h0) {
      const b = h1.get(key);
      if (b) hordes.push({ id: key, tile: lerpTile(a[1], b[1], frac), size: Math.round((a[2] & 16383) + ((b[2] & 16383) - (a[2] & 16383)) * frac), bosses: a[2] >> 14, target: null });
      else if (frac < 0.5) hordes.push({ id: key, tile: a[1], size: a[2] & 16383, bosses: a[2] >> 14, target: null });
    }
    if (frac >= 0.5) for (const [key, b] of h1) if (!h0.has(key)) hordes.push({ id: key, tile: b[1], size: b[2] & 16383, bosses: b[2] >> 14, target: null });
    const parties = [];
    const p0 = movers(k, "pt", 4), p1 = movers(k1, "pt", 4);
    const party = (key, rec, tile, next) => {
      const code = rec[2], sprite = SPRITE_KIND[code & 3], phase = ["out", "waiting", "task", "siege"][(code >> 4) & 3];
      const color = (code >> 6) & 3, owner = ownerOf(code >> 8);
      if (owner == null) return;
      const target = rec[3] !== 65535 ? (() => {
        const b = bases.find((x) => x.tile === rec[3]);
        return b ? { kind: "player", baseId: b.id, tile: rec[3] } : { kind: "faction", tile: rec[3] };
      })() : null;
      parties.push({
        id: key, owner, kind: owner === "player" ? (color ? "convoy" : "expedition") : sprite === "raid" ? "raid" : sprite === "truck" ? "convoy" : "party",
        routeKind: color === 2 ? "supply" : color === 1 ? "route" : null, phase, path: next != null && next !== tile ? [tile, next] : [tile], idx: 0,
        vehicle: sprite === "truck" || sprite === "sedan", vehicleId: sprite === "sedan" ? -2 : sprite === "truck" ? -1 : null,
        members: new Array(((code >> 2) & 3) + 1), radioLive: true, target, task: null,
      });
    };
    for (const [key, a] of p0) {
      const b = p1.get(key);
      if (b) party(key, a, lerpTile(a[1], b[1], frac), b[1]);
      else if (frac < 0.5) party(key, a, a[1], null);
    }
    if (frac >= 0.5) for (const [key, b] of p1) if (!p0.has(key)) party(key, b, b[1], null);
    return {
      timelapse: true, frame: k, frac, hour: Math.floor(t), info, fallen: info.fallen ? f0.bases.map((b) => b.tile) : [],
      seed: state.seed, grid: g, tiles, live, knowledge: [], factions, bases, hordes, hiveSites, parties, markers: [], vehicles: FAKE_VEHICLES,
      deathSites: [], survivors: [], cityId: state.cityId, cityIds: state.cityIds, originId: state.originId,
      weather: state.weather, // the same pre-rolled days (weather.js), so the map shows that day's season and weather
    };
  }

  // Time series for the charts: one point per frame.
  function series() {
    const hours = [], pop = [], land = [], groups = c.factions.map(() => ({ pop: [], land: [] }));
    for (const fr of frames) {
      const { d, fac } = sections(fr);
      hours.push(fr.h);
      pop.push(d[0]);
      land.push(d[10]);
      groups.forEach((s, i) => {
        s.pop.push(i < d[9] && d[fac + i * 3 + 2] ? d[fac + i * 3] : 0);
        s.land.push(i < d[9] ? d[fac + i * 3 + 1] : 0);
      });
    }
    return { hours, pop, land, groups };
  }

  return {
    chronicle: c, frames, events: c.events, factions: c.factions,
    h0: frames[0].h, h1: frames[frames.length - 1].h, overAt: c.overAt,
    frameAt, frameInfo, frameState, decode, series,
  };
}
