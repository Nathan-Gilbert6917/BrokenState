// The music director: reads the game's state (never changes it) and says which music state should play, with
// hysteresis so the music does not flap, and which one-off phrases (stings) are due. Pure functions and plain objects:
// ui/music.js calls it every half second, tools/musictest.js drives it with real and made-up worlds.
//
//   readSituation(state, ui, mem, now)   what is going on: { mode, calm, season, level, battle, events, why }
//   direct(dir, sit, now, follow)        the music state to play: { key, stings, down, hush, changed }
//
// Situations, most pressing first:
//   game over -> gameover; the coalition's or the hive victory -> triumph; the title (or the new-run screen) -> title;
//   a battle: no contact yet -> battleQuiet, enemies in sight or aware of you -> battleSeen, shots or blows in the last
//     FIGHT_HOLD s -> battleFight (battleWin / battleLose when the tide has turned);
//   on the map: a base under siege or on alert, an ambush or a raid at the gate (a card) -> crisis; a horde you can see
//     near a base or a team, a raid party you can see heading for a base, a raid warning card, a hive newly seen, a
//     base out of food or water -> tension; the harvest festival -> festival; else day or night by the hour.
// One-offs (edges, never on the first look at a world, so a load is quiet): one of yours down in battle (the drums drop
// to a heartbeat for a few bars), a colonist dead (an elegy, then a quieter stretch), a base lost, a battle won (a
// resolving sting), lost or fled (a sombre one).
import { hordesNear, isBaseAttack, cardUrgency, isBaseDefence } from "./soundcues.js";
import { underAttack } from "../sim/buildings.js";
import { season as seasonOf } from "../sim/weather.js";
import { festivalNow } from "../sim/festival.js";
import { active, playerSees } from "../sim/combat.js";
import { partyTile } from "../sim/parties.js";
import { RANK } from "./musicscore.js";

export const DIRECTOR = {
  TICK: 0.5,        // s between two looks at the game
  UP: 0.9,          // s a harder situation must last before the music goes up (two looks)
  DOWN: { battleFight: 8, battleWin: 8, battleLose: 8, battleSeen: 10, crisis: 12, tension: 16 }, // s an easier one must last before it comes down
  LATERAL: 10,      // s for day <-> night <-> festival
  DWELL: 6,         // s at least in a state before it changes again (down or lateral)
  FIGHT_HOLD: 9,    // s after the last shot or blow a battle still counts as a firefight
  HIVE_HOLD: 75,    // s of tension after a hive is first seen
  DOWN_BARS: 4,     // bars of heartbeat after one of yours goes down
  HUSH_BARS: 10,    // bars of quiet after a death
  TIDE: 0.3,        // the gap between the two sides' strength (share still standing) that turns the tide
};
const CRISIS_CARD = /^Raid defense|^Overrun|^Assault: |^Ambush|^The dead ahead|^Outbreak|^Fire in /i;
const FIGHT_FX = new Set(["shot", "melee", "throw"]);

// ---------- what is going on ----------
// mem: kept by the caller between looks (a fresh {} starts quietly). now: seconds (wall clock).
export function readSituation(state, ui, mem, now) {
  const sit = { mode: "map", calm: "day", season: "summer", level: 0, battle: null, events: [], why: [] };
  if (!state) { sit.mode = "title"; return sit; }
  const fresh = mem.state !== state;
  if (fresh) { mem.state = state; mem.alive = null; mem.bases = null; mem.hives = null; mem.mourned = new Set(); mem.battle = null; mem.hiveAt = -1e9; }
  try { sit.season = seasonOf(state).key; } catch { /* a world with no calendar yet */ }
  const h = (((state.hour || 0) % 24) + 24) % 24;
  sit.hour = h;
  sit.calm = isNightHour(h, mem.night) ? "night" : "day";
  mem.night = sit.calm === "night";
  if (ui && ui.timelapse) { sit.mode = "hold"; return sit; } // the run's replay: whatever was playing goes on
  if (state.gameOver) { sit.mode = state.victory ? "triumph" : "gameover"; watchLosses(state, mem, sit, fresh); return sit; }
  if (!ui || ui.title || !ui.started) { sit.mode = "title"; return sit; }
  // The battle.
  const b = state.combat;
  if (b) battleSituation(b, mem, sit, now);
  watchLosses(state, mem, sit, fresh);
  if (sit.mode === "battle") return sit;
  // The map.
  const bases = state.bases || [];
  let crisis = false, tension = false;
  for (const base of bases) if (base.owner == null || base.owner === "player") { try { if (underAttack(state, base)) { crisis = true; sit.why.push(`${base.name} under attack`); break; } } catch { /* an odd base */ } }
  for (const c of state.cards || []) {
    if (!c || !c.title) continue;
    const t = String(c.title);
    if (CRISIS_CARD.test(t) || (c.kind === "conflict" && c.conflict && (c.conflict.type === "ambush" || c.conflict.type === "surge" || c.conflict.caught))) { crisis = true; sit.why.push(`card: ${t}`); }
    else if (isBaseAttack(c)) { tension = true; sit.why.push(`raid warning: ${t}`); }
  }
  try { if (hordesNear(state).length) { tension = true; sit.why.push("a horde near"); } } catch { /* no grid */ }
  if (raidSeen(state)) { tension = true; sit.why.push("a raid party seen"); }
  // A hive newly seen (a known one on a load is not news).
  const live = state.live;
  if (state.hives && live) {
    const seen = state.hives.filter((x) => x && live.has(x.tile)).map((x) => x.tile);
    if (mem.hives) { if (seen.some((t) => !mem.hives.has(t))) mem.hiveAt = now; for (const t of seen) mem.hives.add(t); }
    else mem.hives = new Set(seen);
    if (now - mem.hiveAt < DIRECTOR.HIVE_HOLD) { tension = true; sit.why.push("a hive spotted"); }
  }
  for (const a of (ui && ui.alertList) || []) {
    if (!a) continue;
    if (a.kind === "starve" || a.kind === "thirst" || ((a.kind === "food" || a.kind === "water") && a.tone === "danger") || a.kind === "breakin") { tension = true; sit.why.push(`alert: ${a.kind}`); }
  }
  sit.level = crisis ? 2 : tension ? 1 : 0;
  try { const hub = bases.find((x) => x.type === "hub"); if (hub && festivalNow(state, hub)) sit.calm = "festival"; } catch { /* no festival yet */ }
  return sit;
}
// Night from dusk to dawn, with a margin either way so the hour sitting on the line does not flip it back and forth.
export function isNightHour(h, wasNight) {
  return wasNight ? !(h >= 6 && h < 19.5) : h >= 20 || h < 5.5;
}
function raidSeen(state) {
  const live = state.live;
  if (!live) return false;
  for (const p of state.parties || []) {
    if (!p || p.owner === "player" || !p.target || p.target.kind !== "player" || !(p.kind === "raid" || p.phase === "raid" || p.phase === "siege")) continue;
    try { const t = partyTile(p); if (t != null && live.has(t)) return true; } catch { /* no path */ }
  }
  return false;
}
function battleSituation(b, mem, sit, now) {
  let B = mem.battle;
  if (!B || B.b !== b) { // a new battle (or a load): what is already on the field is no news
    B = mem.battle = { b, seq: b.fxSeq || 0, lastFight: -1e9, units: new Map(b.units.map((u) => [u.id, u.dead ? "dead" : u.down ? "down" : "up"])), start: counts(b), over: !!b.over };
  }
  // Effects since the last look: a shot, a blow or a throw is a firefight.
  if ((b.fxSeq || 0) > B.seq) {
    for (const f of b.fx || []) if (f.seq > B.seq && FIGHT_FX.has(f.type)) B.lastFight = now;
    B.seq = b.fxSeq || 0;
  }
  // Your people going down or dying.
  for (const u of b.units) {
    if (u.side !== "player") continue;
    const s = u.dead ? "dead" : u.down ? "down" : "up", was = B.units.get(u.id);
    B.units.set(u.id, s);
    if (was === undefined || was === s || s === "up") continue;
    if (!sit.events.some((e) => e.k === "down")) sit.events.push({ k: "down" });
    if (s === "dead" && u.sid != null && !mem.mourned.has(u.sid)) { mem.mourned.add(u.sid); if (!sit.events.some((e) => e.k === "death")) sit.events.push({ k: "death" }); }
  }
  if (b.over) {
    if (!B.over) { // it just ended
      B.over = true;
      const o = b.result && b.result.outcome;
      sit.events.push({ k: o === "victory" || o === "extracted" ? "victory" : "defeat", outcome: o || "?" });
    }
    return; // the result screen: back to the map's music under it
  }
  sit.mode = "battle";
  const c = counts(b);
  const seen = b.units.some((u) => u.side === "enemy" && !u.dormant && active(u) && (u.aware || safeSees(b, u)));
  const fighting = now - B.lastFight < DIRECTOR.FIGHT_HOLD;
  const phase = fighting ? "fight" : seen || isBaseDefence(b) ? "seen" : "quiet";
  // The tide: the share of each side still standing.
  const mine = B.start.p ? c.p / B.start.p : 0, theirs = B.start.e ? c.e / B.start.e : 0;
  const tide = !c.e ? "win" : mine - theirs > DIRECTOR.TIDE ? "win" : theirs - mine > DIRECTOR.TIDE || (c.p <= 1 && c.e >= 3) ? "lose" : "even";
  sit.battle = { phase, tide, mine: Math.round(mine * 100) / 100, theirs: Math.round(theirs * 100) / 100 };
  sit.why.push(`battle ${phase}, ${tide}`);
}
function counts(b) {
  let p = 0, e = 0;
  for (const u of b.units) { if (!active(u) || u.dormant) continue; if (u.side === "player") p++; else if (u.side === "enemy") e++; }
  return { p, e };
}
function safeSees(b, u) { try { return playerSees(b, u); } catch { return false; } }
// A colonist dead (not one who walked out), a base lost. The first look at a world only remembers.
function watchLosses(state, mem, sit, fresh) {
  const alive = new Set();
  for (const s of state.survivors || []) if (s && s.alive) alive.add(s.id);
  if (mem.alive && !fresh) {
    for (const id of mem.alive) {
      if (alive.has(id) || mem.mourned.has(id)) continue;
      const s = (state.survivors || []).find((x) => x && x.id === id);
      mem.mourned.add(id);
      if (s && !s.left && !sit.events.some((e) => e.k === "death")) sit.events.push({ k: "death" });
    }
  }
  mem.alive = alive;
  const bases = new Set((state.bases || []).filter((x) => x && (x.owner == null || x.owner === "player")).map((x) => x.id));
  if (mem.bases && !fresh && !state.gameOver) for (const id of mem.bases) if (!bases.has(id)) { sit.events.push({ k: "baseLost" }); break; }
  mem.bases = bases;
}

// ---------- the music state, with hysteresis ----------
// The state a situation wants, before hysteresis. follow: "Music intensity follows the action" (off: calm only).
export function wanted(sit, follow = true) {
  if (sit.mode === "title" || sit.mode === "gameover" || sit.mode === "triumph") return sit.mode;
  const calm = sit.calm || "day";
  if (!follow) return calm;
  if (sit.mode === "battle" && sit.battle) {
    const { phase, tide } = sit.battle;
    if (phase === "fight") return tide === "win" ? "battleWin" : tide === "lose" ? "battleLose" : "battleFight";
    return phase === "seen" ? "battleSeen" : "battleQuiet";
  }
  return sit.level >= 2 ? "crisis" : sit.level === 1 ? "tension" : calm;
}
const CATEGORY = (k) => (k === "title" ? "title" : k === "gameover" || k === "triumph" ? "end" : k.startsWith("battle") ? "battle" : "map");
// dir: kept by the caller ({} to start). Returns { key, stings, down, hush, changed } (down, hush: this look saw one of
// yours go down, a death or a base lost: the engine counts DIRECTOR.DOWN_BARS / HUSH_BARS from there). A change of category (the title,
// the map, a battle, the end) is at once; within one, up after DIRECTOR.UP, down after DIRECTOR.DOWN[from], sideways
// after DIRECTOR.LATERAL, and never sooner than DIRECTOR.DWELL after the last change.
export function direct(dir, sit, now, follow = true) {
  const out = { key: dir.key || null, stings: [], down: false, hush: false, changed: false };
  // The one-offs.
  for (const e of sit.events) {
    if (e.k === "down" && follow) out.down = true;
    if (e.k === "death") { out.stings.push("death"); out.hush = true; }
    if (e.k === "baseLost") { out.stings.push("baseLost"); out.hush = true; }
    if ((e.k === "victory" || e.k === "defeat") && follow) out.stings.push(e.k);
  }
  if (out.stings.length > 1) out.stings = [out.stings.includes("baseLost") ? "baseLost" : out.stings.includes("death") ? "death" : out.stings[0]]; // one phrase at a time
  if (sit.mode === "hold" && dir.key) return out;
  const want = wanted(sit, follow);
  if (!dir.key) { dir.key = want; dir.since = now; dir.cand = null; out.key = want; out.changed = true; return out; }
  if (want === dir.key) { dir.cand = null; }
  else {
    if (dir.cand !== want) { dir.cand = want; dir.candSince = now; }
    const held = now - dir.candSince, dwell = now - dir.since;
    const from = dir.key, up = (RANK[want] ?? 1) > (RANK[from] ?? 1), same = (RANK[want] ?? 1) === (RANK[from] ?? 1);
    let go;
    if (CATEGORY(want) !== CATEGORY(from)) go = true;
    else if (up && !same) go = held >= DIRECTOR.UP;
    else if (same) go = held >= (from.startsWith("battle") ? DIRECTOR.UP * 2 : DIRECTOR.LATERAL) && dwell >= DIRECTOR.DWELL;
    else go = held >= (DIRECTOR.DOWN[from] ?? DIRECTOR.LATERAL) && dwell >= DIRECTOR.DWELL;
    if (go) { dir.key = want; dir.since = now; dir.cand = null; out.changed = true; }
  }
  out.key = dir.key;
  return out;
}
