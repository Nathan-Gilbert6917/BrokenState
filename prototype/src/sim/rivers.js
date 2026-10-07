// Frozen rivers (the ice itself is weather.js ICE: iceRow, riverFrozen, thinIce). In deep winter the rivers freeze
// from their northern reaches down and can be walked across: by your teams, other groups' parties and the dead
// (parties.js moveCost, hordes.js), so a river that kept a base safe all year is no barrier until the thaw. This
// module handles what happens when the ice comes and goes, once an hour (world.js tickHour, before anyone moves):
// - freeze: a log line for each of your bases with newly frozen river within ICE_NEAR tiles (and an alert while it
//   lasts, iceAlerts);
// - thaw: anyone standing on ice that melts scrambles ashore, and every way planned over it is planned again
//   (a team whose only way was the ice stops at the shore, as at a barricaded bridge);
// - thin ice early and late in the freeze: a team on foot may go through (thinIceStep, from parties.js).
import { iceRow, riverFrozen, thinIce, ICE, frontsApproaching, whenText, homeTile } from "./weather.js";
import { log, hurt, hub } from "./world.js";
import { planPath, partyMembers, partySpeed, tileLabel, teamName } from "./parties.js";

export const ICE_NEAR = 6; // a frozen river this close to one of your bases is news (log, alert)

// Unbridged river tiles of rows lo..hi (inclusive).
function riverTiles(state, lo, hi) {
  const out = [];
  for (const t of state.tiles) if (t.terrain === "water" && !t.bridge && t.y >= lo && t.y <= hi) out.push(t.id);
  return out;
}
// Your bases with one of these tiles within ICE_NEAR, each with the nearest such tile.
function basesBy(state, tiles) {
  const out = [];
  for (const b of state.bases) {
    let best = null, bd = Infinity;
    for (const id of tiles) { const d = state.grid.distance(b.tile, id); if (d <= ICE_NEAR && d < bd) { bd = d; best = id; } }
    if (best != null) out.push({ base: b, tile: best, dist: bd });
  }
  return out;
}

export function riversHour(state) {
  const w = state.weather;
  if (!w || !state.tiles || !state.grid) return;
  const row = iceRow(state), was = w.iceRow ?? -1;
  if (row === was) return;
  w.iceRow = row;
  if (row > was) froze(state, was + 1, row, was < 0);
  else thawed(state, row + 1, was, row < 0);
}

function froze(state, lo, hi, first) {
  if (first) log(state, `❄️ The rivers are freezing over, from the north: frozen stretches can be walked across (${ICE.walk} hours a tile, no vehicles). Other groups and the dead can cross them too.`, "info");
  for (const x of basesBy(state, riverTiles(state, lo, hi))) {
    log(state, `❄️ The river by ${x.base.name} has frozen over (${x.dist} tile${x.dist === 1 ? "" : "s"} away): the dead and other groups can walk across the ice until it thaws.`, "bad");
  }
}

function thawed(state, lo, hi, all) {
  const melted = new Set(riverTiles(state, lo, hi));
  if (!melted.size) return;
  log(state, all ? "💧 The last of the river ice has broken up: the rivers can only be crossed at bridges or by boat again." : "💧 The river ice is breaking up in the south: those stretches can no longer be walked across.", "info");
  for (const x of basesBy(state, [...melted])) log(state, `💧 The ice on the river by ${x.base.name} is breaking up: it is a barrier again.`, "good");
  for (const p of state.parties) {
    if (!Array.isArray(p.path) || !p.path.length) continue;
    const idx = Math.min(p.idx || 0, p.path.length - 1), here = p.path[idx];
    if (melted.has(here)) ashore(state, p, here, melted);
    else if (p.path.slice(idx + 1).some((id) => melted.has(id))) replan(state, p);
  }
  for (const h of state.hordes) {
    if (melted.has(h.tile)) {
      const land = state.grid.neighbors(h.tile).find((id) => state.tiles[id].terrain !== "water" || state.tiles[id].bridge || riverFrozen(state, id));
      if (land != null) h.tile = land;
    }
    if (h.path && h.path.some((id) => melted.has(id))) h.path = null; // planned again on its next step (hordes.js)
  }
}

// Someone on ice that melts gets to the nearest bank: the next land tile of its way if that is next door, else the
// one it came from, else any; then on along a new way to where it was going.
function ashore(state, p, here, melted) {
  const nb = state.grid.neighbors(here);
  const land = (id) => id != null && nb.includes(id) && !melted.has(id) && (state.tiles[id].terrain !== "water" || state.tiles[id].bridge || riverFrozen(state, id));
  const idx = Math.min(p.idx || 0, p.path.length - 1);
  const shore = [p.path[idx + 1], p.path[idx - 1], ...nb].find(land);
  if (shore == null) return;
  const end = p.path[p.path.length - 1];
  const way = end !== shore && !melted.has(end) ? planPath(state, shore, end, p.vehicle, p.owner) : null;
  p.path = way && way.path ? way.path : [shore];
  p.idx = 0;
  p.progress = Math.min(p.progress || 0, 0);
  if (p.owner === "player" && p.kind !== "convoy") log(state, `${teamName(state, p)} scrambles ashore near ${tileLabel(state, shore)} as the ice breaks up under them.`, "bad");
}

// A way that crossed ice that melted: planned again from where the party is (kept as it is when there is no other
// way: the party stops at the shore).
function replan(state, p) {
  const idx = Math.min(p.idx || 0, p.path.length - 1), from = p.path[idx], end = p.path[p.path.length - 1];
  const way = planPath(state, from, end, p.vehicle, p.owner);
  if (way && way.path && way.path.length > 1) { p.path = way.path; p.idx = 0; }
}

// A team on foot entering thin ice (early or late in the freeze) may go through: someone is hurt and the team loses
// two hours getting them out and dry. Called by parties.js for each tile a player team enters.
export function thinIceStep(state, p, tileId) {
  if (p.owner !== "player" || p.kind === "convoy" || p.vehicle || !thinIce(state, tileId)) return;
  if (!state.rng.chance(ICE.fall)) return;
  const members = partyMembers(state, p);
  if (!members.length) return;
  const s = state.rng.pick(members), dmg = state.rng.int(3, 8);
  p.progress -= 2 * partySpeed(p);
  hurt(state, s, dmg, tileId, "thin ice");
  if (s.alive) log(state, `${teamName(state, p)}: the ice gives way under ${s.name} near ${tileLabel(state, tileId)}. Pulled out soaked and freezing (−${dmg} health); two hours lost getting dry.`, "bad");
}

// ---------- alerts (ui/alerts.js) ----------
// A frozen river near one of your bases (the dead can cross), and a storm or blizzard heading for home.
export function weatherAlerts(state) {
  const out = [];
  if (!state.tiles || !state.grid) return out;
  const row = iceRow(state);
  if (row >= 0) for (const x of basesBy(state, riverTiles(state, 0, row))) {
    out.push({ key: `ice:${x.base.id}`, kind: "ice", icon: "❄️", tone: "warn", text: `River by ${x.base.name} frozen: the dead can cross`,
      tip: `The river ${x.dist} tile${x.dist === 1 ? "" : "s"} from ${x.base.name} is frozen: hordes, raiders and other groups can walk across it until the thaw (and so can you, on foot: ${ICE.walk} hours a tile, no vehicles). Click to see it.`, go: { tile: x.tile } });
  }
  const h = hub(state), home = homeTile(state);
  if (h && home === h.tile) {
    const x = frontsApproaching(state, home).find((f) => f.severe && (f.over || (f.eta != null && f.eta <= 12)));
    if (x) out.push({ key: `front:${x.f.id}`, kind: "front", icon: x.icon, tone: "info", text: x.over ? `${x.name} over ${h.name}` : `${x.name} heading for ${h.name}: here ${whenText(state, x.eta)}`,
      tip: `${x.name}: teams under it travel much slower and can be hurt on the road; boats are riskier. It moves ${x.heading}. Click to see it.`, go: { tile: frontTile(state, x.f) } });
  }
  return out;
}

// The tile under a front's middle now (for "click to see it").
function frontTile(state, f) {
  const g = state.grid, t = state.hour - f.t0;
  const y = Math.max(0, Math.min(g.height - 1, Math.round((f.y + f.vy * t) / (Math.sqrt(3) / 2))));
  const x = Math.max(0, Math.min(g.width - 1, Math.round(f.x + f.vx * t - 0.5 * (y & 1))));
  return g.id(x, y);
}
