// What to play when (ui/audio.js plays it): the game's state is read each frame and compared with what was heard
// last time, so the simulation never knows about sound. Pure functions and plain objects, no browser: the headless
// test (tools/audiotest.js) drives them with real worlds and battles.
//
//   cardUrgency(card)        routine | warning | crisis, by what the card is about
//   isBaseAttack(card)       a raid on one of your bases (the alarm instead of a chime)
//   weaponSound(key, unit)   the gunshot a weapon makes: pistol, revolver, rifle, shotgun, auto, bow, acid, suppressed
//   battleCues(b, mem, now, state) the new battle effects (b.fx), the downed, the dead's voices (ui/zombiesfx.js): { name, gain, delay, at | sp }
//   worldCues(state, ui, mem) new cards, new alerts, a horde newly seen near a base or a team, a raid at a base
//   ambienceMix(...)         wind, rain, thunder, the night drone, birds and crickets for a weather and an hour
//   makeThrottle(limits)     keeps a 20-unit firefight from stacking 200 shots in one frame
import { WEAPONS } from "../sim/combat.js";
import { THROWABLES } from "../sim/stealth.js";
import { partyTile } from "../sim/parties.js";
import { meleeCue } from "./sfx-melee.js"; // a blow by weapon class, armour and kill (ui/sfx-melee.js)
import { shotPlan, handCues, launched, isIndoor, OWN_VOICE } from "./gunsfx.js"; // the gun voices, the handling seen between frames
import { THROW_BLAST, THROW_HAND, THROW_CLATTER, THROW_FLIGHT, FUSE, BIG, flight, launchBlast, mergeBlasts, glassNear } from "./blastsfx.js"; // blasts and grenades
import { zombieMemory, zombieFxCue, zombieUnitCues, zombieIdleCue, listenerOf, zListener, crowdState, Z_PRIORITY, zPlace } from "./zombiesfx.js"; // the dead's voices
import { humanCues, H_PRIORITY } from "./humansfx.js"; // the people's voices
import { frameListener } from "./battlesfx.js"; // where the battle is heard from (gun-sfx's listener: the selected unit, the view, the fog)

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
export function battleCues(b, mem, now = 0, state = null) {
  const out = [];
  if (!b) return out;
  if (mem.battle !== b) {
    mem.battle = b;
    mem.seq = b.fxSeq || 0;
    mem.units = new Map(b.units.map((u) => [u.id, u.dead ? "dead" : u.down ? "down" : "up"]));
    mem.nextGroan = now + 2 + rand(mem) * 3;
    mem.zm = zombieMemory(b);
    mem.started = true;
    mem.hand = null;
    handCues(b, mem); // what each unit holds and has loaded now (later frames compare with it)
    mem.wrecked = new Set(wreckedCells(b));
    out.push({ name: isBaseDefence(b) ? "alarm" : "battle" }); // a fight at one of your bases rings the alarm
    return out;
  }
  // Effects from the simulation (combat.js fx): shots, blows, throws, screams.
  const fresh = b.fx.filter((f) => f.seq > mem.seq);
  if (fresh.length) mem.seq = fresh[fresh.length - 1].seq;
  // Where this frame's blasts land (a carried bomb going off elsewhere is a secondary blast; a car wrecked, a fireball).
  const landed = [];
  const blastAt = (to, kind) => { if (BIG.has(kind)) landed.push(to); };
  const selId = typeof LISTEN.sel === "function" ? LISTEN.sel() : null;
  const L = zListener(frameListener(state, b, LISTEN), b, selId); // where the dead are heard from (ui/zombiesfx.js: gun-sfx's listener)
  if (!mem.zm) mem.zm = zombieMemory(b);
  for (const f of fresh) {
    const zn = out.length;
    if (zombieFxCue(b, f, mem.zm, L, out)) { // the dead's own: bites, lunges, spit, shrieks, smashing, the worm
      if (f.type === "melee" && !f.hit && out.length > zn && out[out.length - 1].name === "zAttack") out.push(meleeCue(b, f, unitAt(b, f.from, f.side), mem)); // under the snarl, the claws' swipe (ui/sfx-melee.js)
      continue;
    }
    if (f.type === "shot") {
      const a = unitAt(b, f.from, f.side);
      const mine = f.side === "player", enemy = !mine;
      if (f.misfire) { out.push({ name: "dry", at: f.from, mine, unit: a ? a.id : null, hand: { kind: "dry" } }); continue; } // a dud: a click, no bang
      if (f.overpen) { out.push({ name: "hit", gain: 0.7, delay: 0.05, at: f.to }); continue; } // the same round going on through: no second bang
      const prevT = a && mem.hand && mem.hand.get(a.id);
      if (a && prevT && prevT.taser != null && a.nlTaser != null && a.nlTaser < prevT.taser) { // a taser's darts (sim/nonlethal.js)
        out.push({ name: "taser", at: f.from, mine, unit: a.id, hand: { kind: "taser" } });
        if (!f.hit) out.push({ name: "whiz", gain: 0.4, delay: 0.06, at: f.to });
        continue;
      }
      const lk = a && !f.rocket ? launched(mem, a) : null;
      const own = f.acid || f.worm ? "acid" : a && OWN_VOICE[a.weapon];
      const name = own || (f.rocket ? "rocket" : lk === "gl" ? "launcher" : weaponSound(a ? a.weapon : "pistol", a));
      const cue = { name, gain: mine ? 1 : 0.85, mine, at: f.from, enemy, indoor: isIndoor(b, f.from[0], f.from[1]) };
      if (!own) cue.gun = shotPlan(f, a, f.rocket ? "rocket" : lk);
      out.push(cue);
      if (f.rocket) { // the rocket in flight, then the warhead
        const d = Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]);
        out.push({ name: "blast", at: f.to, delay: flight("rocket", d), enemy, blast: { kind: "rocket", glass: glassNear(b, f.to[0], f.to[1]) } });
        blastAt(f.to, "rocket");
        continue;
      }
      const span = cue.gun ? cue.gun.span : 0;
      if (f.hit) out.push({ name: "hit", gain: 0.7, delay: 0.05 + span * 0.5, at: f.to });
      else if (name !== "acid") out.push({ name: rand(mem) < 0.35 ? "ricochet" : "whiz", gain: 0.6, delay: 0.06 + span * 0.5, at: f.to });
    } else if (f.type === "melee") {
      if (f.text === "BURN" || f.text === "FIRE") continue; // fire's damage: the flames are heard from the throw
      if (f.text === "BOOM") { // a blast's hit: heard as the blast (one far from this frame's blasts is a carried bomb going off)
        if (!landed.some((p) => Math.hypot(p[0] - f.to[0], p[1] - f.to[1]) <= 2.5)) {
          out.push({ name: "blast", at: f.to, delay: THROW_FLIGHT + 0.6, blast: { kind: "secondary", glass: glassNear(b, f.to[0], f.to[1]) } });
          landed.push(f.to);
        }
        continue;
      }
      if (f.text === "BACKBLAST") continue; // the launch is heard already
      const a = unitAt(b, f.from, f.side);
      if (a && a.kind === "zombie" && f.hit) out.push({ name: "bite", at: f.to });
      else out.push(meleeCue(b, f, a, mem)); // ui/sfx-melee.js: by weapon class, armour, kill (at f.to)
    } else if (f.type === "throw") {
      const a = unitAt(b, f.from);
      const lk = a ? launched(mem, a) : null;
      const d = Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]);
      const glass = glassNear(b, f.to[0], f.to[1]);
      if (lk === "gl") { // a 40 mm round: the thoonk, then what it does where it lands
        const kind = launchBlast(f.item, false);
        out.push({ name: "launcher", gain: a.side === "player" ? 1 : 0.85, mine: a.side === "player", at: f.from, enemy: a.side !== "player", gun: shotPlan(f, a, "gl") });
        out.push({ name: kind === "gl40" ? "blast" : throwSound(f.item), at: f.to, delay: flight("gl", d), blast: { kind, glass } });
        blastAt(f.to, kind);
        continue;
      }
      const kind = THROW_BLAST[f.item] || "clatter";
      const B = { kind, glass };
      if (THROW_HAND[f.item]) B.pre = { h: THROW_HAND[f.item], at: f.from }; // the pin and spoon, a fuse lit, a lighter, a flare struck
      if (THROW_CLATTER.has(f.item)) B.land = FUSE[kind] || 0; // the can clatters where it lands and rolls this long, then goes
      out.push({ name: throwSound(f.item), at: f.to, delay: THROW_FLIGHT + (FUSE[kind] || 0), blast: B });
      blastAt(f.to, kind);
    } else if (f.type === "cookoff") { // something in the flames went off where it lay (sim/launchers.js fireCookOffs): no pin, no flight
      const as = { a_40mm_he: "frag", a_rocket_heat: "pipebomb", a_40mm_smoke: "smokegren", a_40mm_illum: "flare" }[f.item] || f.item; // its throwable's sound
      const kind = f.item === "a_40mm_he" ? "gl40" : f.item === "a_rocket_heat" ? "rocket" : THROW_BLAST[as] || "secondary";
      out.push({ name: BIG.has(kind) ? "blast" : throwSound(as), at: f.to, delay: 0.05, blast: { kind, glass: glassNear(b, f.to[0], f.to[1]) } });
      blastAt(f.to, kind);
    } else if (f.type === "scream") out.push({ name: "scream", at: f.from });
  }
  // A vehicle wrecked by this frame's blasts: a fireball (combat.js vehicleBlast marks its cells wrecked).
  if (landed.length && mem.wrecked) {
    const wrecked = wreckedCells(b);
    const fresh2 = wrecked.filter((i) => !mem.wrecked.has(i));
    if (fresh2.length) out.push({ name: "blast", at: [fresh2[0] % b.w, Math.floor(fresh2[0] / b.w)], delay: THROW_FLIGHT + 0.5, blast: { kind: "vehicle", glass: true } });
    for (const j of wrecked) mem.wrecked.add(j);
  }
  // The handling seen in the units' state (a reload, a jam or its clearing, an empty magazine, a launcher reloaded);
  // a jam and an empty click come after the unit's shot of this frame.
  for (const h of handCues(b, mem)) {
    if (h.after) { const s = out.find((c) => c.gun && c.gun.unit === h.unit); h.delay = s ? s.gun.span + 0.08 : 0.08; }
    out.push(h);
  }
  // The dead noticing you, hurt, dying; now and then one of them moans (more often the more of them are up).
  zombieUnitCues(b, mem.zm, L, out);
  const idle = zombieIdleCue(b, mem, L, now, () => rand(mem));
  if (idle) out.push(idle);
  humanCues(b, mem, L, now, state, fresh, out, zPlace); // the people: hurt, down, dying, effort, panting, coughing… (ui/humansfx.js)
  // The selected unit deafened by a bang (sim/hearing.js): everything muffled, a ring as it starts.
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
  return volley(mergeAll(out), mem);
}
// The cells of wrecked cars and trucks on the map (combat.js vehicleBlast: c.car.wrecked).
function wreckedCells(b) {
  const out = [];
  if (!b.cells) return out;
  for (let i = 0; i < b.cells.length; i++) { const c = b.cells[i]; if (c && c.car && c.car.wrecked) out.push(i); }
  return out;
}
// One frame's blasts are one bigger sound (blastsfx.js mergeBlasts), and so are its fires, smokes and flares.
function mergeAll(out) {
  const groups = new Map();
  const rest = [];
  for (const c of out) {
    if (!c.blast) { rest.push(c); continue; }
    if (!groups.has(c.name)) groups.set(c.name, []);
    groups.get(c.name).push(c);
  }
  if (![...groups.values()].some((g) => g.length > 1)) return out;
  for (const g of groups.values()) rest.push(...mergeBlasts(g));
  return rest;
}
// The battle's crowd of the dead for the crowd bed (ui/zombiesfx.js crowdMix): how many are up, how near.
export const battleCrowd = (b) => crowdState(b, listenerOf(b, typeof LISTEN.sel === "function" ? LISTEN.sel() : null));

// One frame's sounds, cut to MAX_BATTLE_SOUNDS (the loudest kinds first, your own shots before the enemy's) and
// spread a little in time, so a volley sounds like a volley rather than one huge bang.
const PRIORITY = { alarm: 0, battle: 0, downed: 1, death: 1, blast: 2, fire: 2, rocket: 2, launcher: 3, scream: 3, auto: 4, shotgun: 4, rifle: 4, revolver: 4, pistol: 5, suppressed: 5, bite: 5, meleeCrit: 5, taser: 6, reload: 7, jam: 7, unjam: 7, dry: 7, ...Z_PRIORITY, ...H_PRIORITY };
function volley(out, mem) {
  if (out.length <= 1) return out;
  const kept = out.map((c, i) => ({ c, i, p: (PRIORITY[c.name] ?? 8) - (c.mine ? 3 : 0) })).sort((a, b) => a.p - b.p || a.i - b.i).slice(0, MAX_BATTLE_SOUNDS).sort((a, b) => a.i - b.i);
  let shots = 0;
  return kept.map(({ c }) => {
    const step = c.name === "hit" || c.name === "whiz" || c.name === "ricochet" || c.blast || c.hand ? Math.max(0, shots - 1) : shots++; // a blast or a handling sound keeps to its own timing
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
  let tone = null, repaired = false;
  // A repair done is news of its own (its key has the hour: each repair is heard, once).
  const alertId = (a) => (a.kind === "fixed" ? String(a.key) : `${String(a.key).split(":").slice(0, 2).join(":")}|${a.tone}`);
  // Good news hidden by Options → Good news alerts (ui/alerts.js ui.alertHidden): remembered as heard, never played, so
  // switching it back on does not chime old news.
  for (const a of (ui && ui.alertHidden) || []) if (a && a.key) mem.alerts.set(alertId(a), hour);
  for (const a of list) {
    if (!a || !a.key) continue;
    const id = alertId(a);
    const seen = mem.alerts.get(id);
    mem.alerts.set(id, hour);
    if (fresh || (seen != null && hour - seen <= ALERT_QUIET_HOURS)) continue;
    if (a.kind === "breakin") { out.push({ name: "alarm" }); continue; }
    if (a.kind === "horde" || a.kind === "cards") continue;
    if (a.kind === "fixed") { repaired = true; continue; } // its own chime (ui/audio.js repaired), not Good news as well
    if (a.tone === "danger" || a.tone === "warn") tone = "alert";
    else if (a.tone === "good" && !tone) tone = "good";
  }
  if (tone && !card) out.push({ name: tone });
  if (repaired) out.push({ name: "repaired" }); // a vehicle repaired on the road runs again: heard even with a card up (ui/alerts.js "fixed")
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
