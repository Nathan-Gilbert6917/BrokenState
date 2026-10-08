// What to play when (ui/audio.js plays it): the game's state is read each frame and compared with what was heard
// last time, so the simulation never knows about sound. Pure functions and plain objects, no browser: the headless
// test (tools/audiotest.js) drives them with real worlds and battles.
//
//   cardUrgency(card)        routine | warning | crisis, by what the card is about
//   isBaseAttack(card)       a raid on one of your bases (the alarm instead of a chime)
//   weaponSound(key, unit)   the gunshot a weapon makes: pistol, revolver, rifle, shotgun, auto, bow, acid, suppressed
//   battleCues(b, mem)       the new battle effects (b.fx), the downed and the dead, groans: a list of { name, gain, delay }
//   worldCues(state, ui, mem) new cards, new alerts, a horde newly seen near a base or a team, a raid at a base
//   ambienceMix(...)         wind, rain, thunder, the night drone, birds and crickets for a weather and an hour
//   makeThrottle(limits)     keeps a 20-unit firefight from stacking 200 shots in one frame
import { WEAPONS } from "../sim/combat.js";
import { THROWABLES } from "../sim/stealth.js";
import { partyTile } from "../sim/parties.js";

export const HORDE_NEAR_BASE = 6; // tiles: the same distance as the horde alert (ui/alerts.js HORDE_ALERT_TILES)
export const HORDE_NEAR_TEAM = 3; // tiles from one of your teams on the map
export const MAX_BATTLE_SOUNDS = 5; // effects heard per frame in a battle; the rest of a volley is dropped
export const VOLLEY_SPREAD = 0.07;  // seconds between the shots of one frame's volley (plus a little jitter)
export const ALERT_QUIET_HOURS = 12;
// Deafened (sim/hearing.js): while the selected unit is deaf, the battle is heard at DEAF_GAIN with a ring as it starts.
// LISTEN.sel: a getter of the selected unit's id (ui/combat.js sets it; headless: none, nothing changes).
export const DEAF_GAIN = 0.3;
export const LISTEN = { sel: null }; // an alert gone for less than this and back is not heard again

// ---------- cards ----------
// Titles that mean your base is being attacked or about to be (raid warnings, a group's attack, an assault on it).
const ATTACK_RE = /heading for |are coming for |goes on the attack|^Raid defense|^Overrun|^Assault: /i;
// Crisis: losses and threats to life. Warning: trouble that wants a decision. Everything else is routine (visitors,
// finds, recruits, trade, a skill reached).
const CRISIS_RE = /has fallen|burned|^Overrun|^Outbreak|^Fire in |horde|rose$|is dead|^The worm|is falling apart|^Ambush|^The dead ahead|^Storm damage|^Cannot go home|^Held at|^Evacuees|asks for help|come for their people/i;
const WARNING_RE = /fight|^Breakdown|quarrel|missing|^Storm|^Bad footing|^Cold feet|^Ransom|^Rescue|^Pulled out|patrol|checkpoint|roadblock|raider|^Soldiers|^Tempers|^The council|^Your people at|^A hive|^Hive growth|^The hive|^Radio signal|^Heard on the radio|war$/i;

export function isBaseAttack(card) {
  return !!card && ATTACK_RE.test(String(card.title || ""));
}
export function cardUrgency(card) {
  if (!card) return "routine";
  const t = String(card.title || "");
  if (isBaseAttack(card) || CRISIS_RE.test(t)) return "crisis";
  // A conflict on the road (conflicts.js): forced (an ambush, the dead pouring out) is a crisis, the rest a warning.
  if (card.kind === "conflict" && card.conflict) {
    const c = card.conflict;
    return c.type === "ambush" || c.type === "surge" || c.caught ? "crisis" : "warning";
  }
  if (WARNING_RE.test(t)) return "warning";
  return "routine";
}
const URGENCY_RANK = { routine: 0, warning: 1, crisis: 2 };

// ---------- battle ----------
// The sound of a weapon's shot, by its key in WEAPONS (and the unit: a suppressor muffles it).
const SHOT_CLASS = {
  pistol: "pistol", revolver: "revolver", huntrifle: "rifle", leverrifle: "rifle", carbine: "rifle", ar: "auto",
  shotgun: "shotgun", pipegun: "shotgun", crossbow: "bow", compbow: "bow", xbow: "bow", pulleybow: "bow", acid: "acid",
};
export function weaponSound(key, unit) {
  const w = WEAPONS[key];
  if (!w || w.melee) return "pistol"; // a gun swung as a club never gets here; an unknown gun sounds like a pistol
  const cls = SHOT_CLASS[key] || (w.acid ? "acid" : !w.noise ? "bow" : w.ammo >= 2 ? "auto" : w.close > 0 ? "shotgun" : w.opt >= 9 ? "rifle" : "pistol");
  if (unit && unit.suppressor && w.noise && cls !== "shotgun") return "suppressed";
  return cls;
}
// The sound of a throwable landing (stealth.js THROWABLES: fx blast / frag / fire / smoke / flare, or a lure).
export function throwSound(key) {
  const T = THROWABLES[key];
  if (!T) return "glass";
  if (T.fx === "blast" || T.fx === "frag") return "blast";
  if (T.fx === "fire") return "fire";
  if (T.fx === "smoke") return "hiss";
  if (T.fx === "flare") return "flare";
  return "glass"; // a bottle, a firecracker or a noise maker: something small clatters
}

// Your base under attack: raiders, a horde breaking in, outsiders, a group freeing its people (defences.js layout).
export const isBaseDefence = (b) => !!(b && b.setup && b.setup.layout === "baseDefence");
const unitAt = (b, [x, y], side) => b.units.find((u) => u.x === x && u.y === y && !u.dead && (!side || u.side === side)) ||
  b.units.find((u) => u.x === x && u.y === y);
const rand = (mem) => (mem.rng ? mem.rng() : Math.random());

// The new things heard in battle b since the last call. mem: this battle's memory (kept by the caller; a new battle
// or a loaded one starts a fresh memory, and what was already on the field makes no sound). now: seconds.
export function battleCues(b, mem, now = 0) {
  const out = [];
  if (!b) return out;
  if (mem.battle !== b) {
    mem.battle = b;
    mem.seq = b.fxSeq || 0;
    mem.units = new Map(b.units.map((u) => [u.id, u.dead ? "dead" : u.down ? "down" : "up"]));
    mem.nextGroan = now + 2 + rand(mem) * 3;
    mem.started = true;
    out.push({ name: isBaseDefence(b) ? "alarm" : "battle" }); // a fight at one of your bases rings the alarm
    return out;
  }
  // Effects from the simulation (combat.js fx): shots, blows, throws, screams.
  const fresh = b.fx.filter((f) => f.seq > mem.seq);
  if (fresh.length) mem.seq = fresh[fresh.length - 1].seq;
  for (const f of fresh) {
    if (f.type === "shot") {
      const a = unitAt(b, f.from, f.side);
      const name = f.acid ? "acid" : weaponSound(a ? a.weapon : "pistol", a);
      out.push({ name, gain: f.side === "player" ? 1 : 0.85, mine: f.side === "player" });
      if (f.hit) out.push({ name: "hit", gain: 0.7, delay: 0.05 });
      else if (name !== "acid") out.push({ name: rand(mem) < 0.35 ? "ricochet" : "whiz", gain: 0.6, delay: 0.06 });
    } else if (f.type === "melee") {
      if (f.text === "BURN" || f.text === "FIRE") continue; // fire's damage: the flames are heard from the throw
      const a = unitAt(b, f.from, f.side);
      if (a && a.kind === "zombie" && f.hit) out.push({ name: "bite" });
      else if (f.hit) out.push({ name: f.crit || (f.dmg || 0) >= 25 ? "meleeCrit" : "melee" });
      else out.push({ name: "whoosh" });
    } else if (f.type === "throw") out.push({ name: throwSound(f.item), delay: 0.25 });
    else if (f.type === "scream") out.push({ name: "scream" });
  }
  // The selected unit deafened by a bang (sim/hearing.js): everything muffled, a ring as it starts.
  const selId = typeof LISTEN.sel === "function" ? LISTEN.sel() : null;
  const lu = selId != null ? b.units.find((u) => u.id === selId && u.side === "player") : null;
  const deaf = !!(lu && lu.deaf > 0);
  if (deaf) for (const c of out) c.gain = (c.gain ?? 1) * DEAF_GAIN;
  if (deaf && !mem.deaf) out.push({ name: "ring", gain: 0.5 });
  mem.deaf = deaf;
  // Your people going down or dying (the sim marks them; no effect is logged for it).
  for (const u of b.units) {
    const now2 = u.dead ? "dead" : u.down ? "down" : "up";
    const was = mem.units.get(u.id);
    mem.units.set(u.id, now2);
    if (was === undefined || was === now2 || u.side !== "player") continue;
    if (now2 === "down") out.push({ name: "downed", delay: 0.15 });
    else if (now2 === "dead") out.push({ name: "death", delay: 0.15 });
  }
  // The dead on the field moan now and then: more often the more of them are up and about.
  const dead = b.over ? 0 : b.units.reduce((n, u) => n + (u.kind === "zombie" && !u.dead && !u.left ? 1 : 0), 0);
  if (dead && now >= mem.nextGroan) {
    out.push({ name: "groan", gain: 0.55 + 0.45 * Math.min(1, dead / 12) });
    mem.nextGroan = now + (3 + rand(mem) * 6) / Math.min(3, 1 + dead / 8);
  }
  return volley(out, mem);
}

// One frame's sounds, cut to MAX_BATTLE_SOUNDS (the loudest kinds first, your own shots before the enemy's) and
// spread a little in time, so a volley sounds like a volley rather than one huge bang.
const PRIORITY = { alarm: 0, battle: 0, downed: 1, death: 1, blast: 2, fire: 2, scream: 3, auto: 4, shotgun: 4, rifle: 4, revolver: 4, pistol: 5, bite: 5, meleeCrit: 5 };
function volley(out, mem) {
  if (out.length <= 1) return out;
  const kept = out.map((c, i) => ({ c, i, p: (PRIORITY[c.name] ?? 8) - (c.mine ? 3 : 0) })).sort((a, b) => a.p - b.p || a.i - b.i).slice(0, MAX_BATTLE_SOUNDS).sort((a, b) => a.i - b.i);
  let shots = 0;
  return kept.map(({ c }) => {
    const step = c.name === "hit" || c.name === "whiz" || c.name === "ricochet" ? Math.max(0, shots - 1) : shots++;
    return { ...c, delay: (c.delay || 0) + step * VOLLEY_SPREAD + rand(mem) * 0.02 };
  });
}

// ---------- the State Map ----------
// mem: { state, cards: WeakSet, alerts: Map, hordes: Set } kept by the caller. A new or loaded world
// starts quiet: what is already there when it is first seen makes no sound.
export function worldCues(state, ui, mem) {
  const out = [];
  if (!state) return out;
  const fresh = mem.state !== state;
  if (fresh) {
    mem.state = state;
    mem.cards = new WeakSet();
    mem.alerts = new Map(); // alert id -> the last hour it was up
    mem.hordes = new Set();
  }
  // Cards: the most urgent new one is heard (a raid on a base is the alarm).
  let card = null;
  for (const c of state.cards || []) {
    if (!c || typeof c !== "object" || mem.cards.has(c)) continue;
    mem.cards.add(c);
    if (fresh || state.autopilot) continue; // the governor answers them at once (sim/autopilot.js)
    if (!card || URGENCY_RANK[cardUrgency(c)] > URGENCY_RANK[cardUrgency(card)] || isBaseAttack(c)) card = c;
  }
  if (card) out.push({ name: isBaseAttack(card) ? "alarm" : `card${cap(cardUrgency(card))}` });
  // Alerts (ui/alerts.js, set by renderAlerts): a new danger or warning chimes; a break-in is the alarm; the horde
  // alerts are left to the horde sting below. An alert is known by its kind and first id ("idle:3:2" and "idle:3:4"
  // are the same alert with a new count) and its tone (a warning turning into a danger is heard again); one that went
  // away for less than ALERT_QUIET_HOURS and came back is not heard again (an outlook flickering by the hour).
  const list = (ui && ui.alertList) || [];
  const hour = state.hour || 0;
  let tone = null;
  for (const a of list) {
    if (!a || !a.key) continue;
    const id = `${String(a.key).split(":").slice(0, 2).join(":")}|${a.tone}`;
    const seen = mem.alerts.get(id);
    mem.alerts.set(id, hour);
    if (fresh || (seen != null && hour - seen <= ALERT_QUIET_HOURS)) continue;
    if (a.kind === "breakin") { out.push({ name: "alarm" }); continue; }
    if (a.kind === "horde" || a.kind === "cards") continue;
    if (a.tone === "danger" || a.tone === "warn") tone = "alert";
    else if (a.tone === "good" && !tone) tone = "good";
  }
  if (tone && !card) out.push({ name: tone });
  // A horde you can see newly near a base or one of your teams: the sting, once per horde.
  let sting = false;
  for (const h of hordesNear(state)) {
    if (mem.hordes.has(h.id)) continue;
    mem.hordes.add(h.id);
    if (!fresh) sting = true;
  }
  if (sting) out.push({ name: "horde" });
  return out;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Hordes you can see now within HORDE_NEAR_BASE tiles of a base or HORDE_NEAR_TEAM of one of your teams.
export function hordesNear(state) {
  const g = state.grid;
  const live = state.live;
  if (!g || !live || !state.hordes || !state.hordes.length) return [];
  const teams = (state.parties || []).filter((p) => p.owner === "player" && p.path && p.path.length).map(partyTile);
  return state.hordes.filter((h) => live.has(h.tile) && (
    state.bases.some((b) => g.distance(h.tile, b.tile) <= HORDE_NEAR_BASE) || teams.some((t) => t != null && g.distance(h.tile, t) <= HORDE_NEAR_TEAM)));
}

// ---------- ambience ----------
// Levels (0–1) of the ambience layers for the weather wx (sim/weather.js weatherAt: key, wind, rain, snow, temp),
// the hour of the day (fractional) and the season key. Wind and rain follow the weather; the drone fades in at
// dusk and out at dawn; birds sing on dry days in the warm half of the year (a dawn chorus), crickets on warm nights.
export function ambienceMix(wx, hour, seasonKey = "summer") {
  const k = wx ? wx.key : "clear";
  const wind = wx ? Number(wx.wind) || 0 : 0.2;
  const temp = wx && Number.isFinite(wx.temp) ? wx.temp : 12;
  const h = ((hour % 24) + 24) % 24;
  // 0 by day, 1 at night: dusk 19–21, dawn 5–7.
  const night = h >= 21 || h < 5 ? 1 : h >= 19 ? (h - 19) / 2 : h < 7 ? 1 - (h - 5) / 2 : 0;
  const wet = k === "rain" || k === "storm";
  const white = k === "snow" || k === "blizzard";
  const mix = {
    wind: clamp01(k === "fog" ? 0.05 : 0.1 + wind * 0.7 + (k === "blizzard" ? 0.15 : 0)),
    windTone: 260 + wind * 420 + (white ? 160 : 0), // Hz: the whistle rises with the wind (and in snow)
    rain: wet ? clamp01(0.25 + (Number(wx.rain) || 0.5) * 0.7) : 0,
    rainLow: k === "storm" ? 0.7 : k === "rain" ? 0.25 : 0,
    thunder: k === "storm" ? 1 : 0,
    drone: 0.2 + night * 0.65,
    birds: 0,
    crickets: 0,
  };
  const singing = !wet && !white && k !== "fog" && k !== "frost" && temp > 4 && seasonKey !== "winter";
  if (singing && night < 1) {
    const dawn = h >= 5 && h < 9 ? 1.6 : 1;
    mix.birds = clamp01((1 - night) * (seasonKey === "autumn" ? 0.4 : 0.8) * dawn);
  }
  if (!wet && !white && night > 0 && temp > 13 && seasonKey !== "winter") mix.crickets = clamp01(night * (seasonKey === "summer" ? 0.8 : 0.4));
  return mix;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---------- throttle ----------
// limits: name -> { gap (s) between two starts, max playing at once }; plus a cap on everything playing.
export const DEFAULT_LIMIT = { gap: 0.03, max: 6 };
export function makeThrottle(limits = {}, total = 28) {
  const playing = []; // { name, end }
  const last = new Map();
  return {
    allow(name, t, dur) {
      for (let i = playing.length - 1; i >= 0; i--) if (playing[i].end <= t) playing.splice(i, 1);
      const L = limits[name] || DEFAULT_LIMIT;
      if (playing.length >= total) return false;
      if (last.has(name) && t - last.get(name) < L.gap) return false;
      if (playing.reduce((n, p) => n + (p.name === name ? 1 : 0), 0) >= L.max) return false;
      last.set(name, t);
      playing.push({ name, end: t + dur });
      return true;
    },
    get playing() { return playing.length; },
  };
}
