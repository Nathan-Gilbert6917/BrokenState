// The stealth kit on the tactical map (combat.js calls in here):
//   takedowns: Subdue on an unaware (or staggering, at 30% health or less) human is an MGS-style takedown that knocks
//     them out: 30 + 2.5 × Stealth, a club +20, a blade +10, fists or a gun butt +5, from behind +15, from cover +10,
//     Brave / Tough +5 each (Coward −5), the Assassin perk +20, soldiers −15, zealots −5, an aware but staggering
//     target −15 (5–95%). A failed takedown is a blunt blow (60% damage, never lethal) and the target cries out.
//     On an aware, healthy enemy Subdue is a non-lethal blow (melee odds −10): a blow that would kill knocks out.
//     The knocked out wake after 4–6 turns unless tied up (Tie up: 1 action, next to them). After a won fight the
//     knocked out are prisoners (prisoners.js); in a raid a tied prisoner dragged into an extraction zone leaves
//     with whoever extracts there.
//   throwables: a bottle, a noise maker or firecrackers (1 action, thrown up to 7–8 tiles) pull every unaware guard
//     and the dead within 6 / 8 / 13 tiles to the spot: they walk over and look around for 3 turns (the AI's
//     "investigate" state), then go back to their beat. A noise maker keeps ringing for 3 turns; firecrackers also
//     add 6 Heat in a raid. A road flare is a lure that also lights the ground; pipe bombs, Molotovs and smoke
//     grenades are thrown the same way but blow up, burn or blind (throwables.js); a deer call is blown where the
//     unit stands (a lure on yourself, not used up). Handcuffs make tying up free.
//   bodies: a guard who sees a body or a tied-up comrade within 5 tiles (3 at night) raises the alarm for its group
//     (+6 Heat in a raid). Drag (1 action) moves a body, a knocked-out enemy or a downed teammate up to 3 tiles.
//   suppressor: fitted to the gun (gunmods.js: a 9mm or rifle suppressor, or the makeshift oil filter on the muzzle
//     mount), a shot makes the attachment's share of the noise (×0.35 / ×0.4 / ×0.5: that share of the Heat and the
//     earshot); a muzzle brake or compensator makes it louder (×1.3 / ×1.15). The oil filter wears a shot at a time (12
//     shots). An oil filter only carried (anywhere on them, a save from before attachments) still halves the shot of
//     a 9mm pistol or a rifle without anything on its muzzle. Enemies' guns count their attachments the same way.
//   night raids: enemy sight 7 (the dead 5), detection range ×0.6 (at least 2); your people see 7 too, more with a
//     light (lights.js: a headlamp 8, a flashlight or torch 9, a lantern 10, a spotlight 12; noticed 1–6 tiles further)
//     and normally with night vision goggles; a quick rummage in the dark without either is heard 2 tiles further
//     (search.js; a full search is 1 action either way).
import { GEAR } from "./data.js";
import { gunMods, unitMods, fittedSuppressor, removeMod, modLabel } from "./gunmods.js"; // gun attachments: suppressors, brakes
import { isNight, survivorById, baseById } from "./world.js";
import { EQUIP_SLOTS, packOf } from "./inventory.js";
import {
  CELL, WEAPONS, active, adjacent, unitAt, reachable, pathTo, los, coverSides, meleeOdds, zoneAt,
  say, fx, moveAlong, alertPod, notice, distField, damage, siegeTarget, bash,
} from "./combat.js";
import { landEffect, blastSpot, throwBlind, throwLanding, flashSpot, doorToss, BLAST, FRAG, FIRE } from "./throwables.js";
import { sensesAny } from "./decoys.js";
// Inside a building (buildingmaps.js): where a throw stops at a wall or a closed door, and how walls muffle a noise.
import { BMAP, throwLanding as interiorLanding, noiseDamp } from "./buildingmaps.js";
import { battleOptic } from "./optics.js";
import { LIGHTS, lightOf } from "./lights.js"; // headlamps, flashlights, torches, lanterns, spotlights

export const STEALTH = {
  NIGHT_SIGHT: 7, NIGHT_ZOMBIE_SIGHT: 5, LIGHT_SIGHT: 9, NIGHT_DETECT: 0.6, LIGHT_DETECT: 3, // LIGHT_*: a flashlight's (each light's own: lights.js LIGHTS)
  BODY_SIGHT: 5, BODY_SIGHT_NIGHT: 3, BODY_HEAT: 6, DRAG: 3, SUPPRESS: 0.5,
  INVESTIGATE_TURNS: 3, STAGGER: 0.3, BLUNT: 0.6, WAKE: [4, 6], BEHIND_DETECT: 0.5,
};
export const TAKEDOWN = { base: 30, stealth: 2.5, behind: 15, cover: 10, assassin: 20, staggering: -15, kit: { soldiers: -15, zealots: -5 } };
const CLUB = { spikedbat: 20, pipespear: 5, spear: 5, knife: 10, machete: 10, sawmachete: 10, springmachete: 10, fists: 5, bat: 20, nailbat: 15, baton: 20, prybar: 15, fireaxe: 10, sledge: 10 }; // guns: a butt stroke, +5
export const SUPPRESSIBLE = ["pistol", "huntrifle", "ar", "leverrifle", "carbine"];
// Keyed like GEAR (the item's throw field). radius / turns: the lure (unaware guards and the dead within radius go to
// look); fx: what else happens where it lands (throwables.js); self: used where the unit stands; keep: not used up.
// sense: what the dead hear or feel of it (decoys.js: each kind of dead follows its own senses); decoy: it keeps
// pulling the dead that sense it even after they have seen you (not only the unaware); people: the unaware guards
// within radius go to look where it landed ("spot", the stealth lures) or where it was thrown from ("thrower": a
// decoy does not fool people, it gives you away); none: people ignore it. scatter: + the chance it lands a tile off.
export const THROWABLES = {
  bottle:      { radius: 6,  turns: 1, heat: 0, range: 7, label: "a bottle", sense: ["noise"], people: "spot" },
  noisemaker:  { radius: 8,  turns: 3, heat: 0, range: 7, label: "a noise maker", sense: ["noise"], decoy: true, people: "spot" },
  firecracker: { radius: 13, turns: 2, heat: 6, range: 8, label: "a string of firecrackers", sense: ["noise"], decoy: true, people: "spot" },
  flare:       { radius: 10, turns: 4, heat: 2, range: 8, label: "a road flare", fx: "flare", sense: ["light", "heat"], decoy: true, people: "spot" },
  alarmclock:  { radius: 10, turns: 5, heat: 2, range: 7, label: "a wind-up alarm clock", sense: ["noise"], decoy: true, people: "thrower" },
  pocketradio: { radius: 12, turns: 6, heat: 3, range: 6, label: "a pocket radio", sense: ["noise"], decoy: true, people: "thrower" },
  handwarmer:  { radius: 5,  turns: 6, heat: 0, range: 7, label: "a pair of hand warmers", sense: ["heat"], decoy: true, people: "none" },
  heatpack:    { radius: 7,  turns: 8, heat: 0, range: 7, label: "a chemical heat pack", sense: ["heat"], decoy: true, people: "none" },
  frag:        { radius: 0, turns: 0, heat: 10, range: 8, label: "a frag grenade", fx: "frag" },
  pipebomb:    { radius: 0, turns: 0, heat: 10, range: 6, label: "a pipe bomb", fx: "blast", scatter: 10 },
  molotov:     { radius: 0, turns: 0, heat: 4, range: 6, label: "a Molotov cocktail", fx: "fire" },
  smokegren:   { radius: 0, turns: 0, heat: 0, range: 7, label: "a smoke grenade", fx: "smoke" },
  // A flashbang (throwables.js FLASH): the stun is its fx; the bang is a lure the dead turn to, the aware ones too for
  // the enemy turn after it (decoy, turns 2: stealthTurn counts one off before the enemy moves).
  flashbang:   { radius: 12, turns: 2, heat: 8, range: 7, label: "a flashbang", fx: "flash", sense: ["noise"], decoy: true, people: "spot" },
  gamecall:    { radius: 7, turns: 1, heat: 0, range: 0, label: "the deer call", self: true, keep: true, sense: ["noise"], people: "spot" },
};
// The decoys (decoys.js, the AI and the State Map's horde warning): what pulls the dead off a fight.
export const DECOY_KEYS = Object.keys(THROWABLES).filter((k) => THROWABLES[k].decoy && !THROWABLES[k].fx);
// The lures the raid bot throws to pull guards away (botStealth), in order.
const LURES = ["bottle", "noisemaker", "firecracker"];
export const THROW_KEYS = Object.keys(THROWABLES);

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const walk = (b, x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * b.w + x].k].walk;

// ---------- what people carry ----------
// Every place an item can sit on a person: { item, take() } for the first item with this key (or null).
export function findCarried(s, key) {
  if (!s || !s.gear) return null;
  for (const slot of EQUIP_SLOTS) {
    const it = s.gear[slot];
    if (it && it.key === key) return { item: it, take: () => { s.gear[slot] = null; } };
  }
  for (let i = 0; i < (s.pockets || []).length; i++) {
    const it = s.pockets[i];
    if (it && it.key === key) return { item: it, take: () => { s.pockets[i] = null; } };
  }
  const pk = packOf(s);
  for (let i = 0; pk && i < pk.length; i++) {
    const it = pk[i];
    if (it && it.key === key) return { item: it, take: () => { pk[i] = null; } };
  }
  return null;
}
const countCarried = (s, key) => {
  if (!s || !s.gear) return 0;
  let n = 0;
  for (const slot of EQUIP_SLOTS) if (s.gear[slot] && s.gear[slot].key === key) n++;
  for (const it of s.pockets || []) if (it && it.key === key) n++;
  for (const it of packOf(s) || []) if (it && it.key === key) n++;
  return n;
};
// The shared store a battle can draw on: the team's cargo, or the base's armory.
function storeOf(state, b) {
  if (b.setup.partyId != null) { const p = state.parties.find((x) => x.id === b.setup.partyId); return p && p.cargo ? p.cargo.gear : null; }
  if (b.setup.baseId != null) { const base = baseById(state, b.setup.baseId); return base ? base.armory : null; }
  return null;
}

// Throwables a unit can use: its own, then the team's cargo (or the base armory). { key: count }.
export function throwablesOf(state, b, u) {
  const out = {};
  const s = u && u.sid != null ? survivorById(state, u.sid) : null;
  const store = storeOf(state, b) || [];
  for (const k of THROW_KEYS) {
    const n = countCarried(s, k) + store.filter((it) => it && it.key === k).length;
    if (n) out[k] = n;
  }
  return out;
}
function takeThrowable(state, b, u, key) {
  const s = survivorById(state, u.sid);
  const own = findCarried(s, key);
  if (own) { own.take(); return true; }
  const store = storeOf(state, b);
  const i = store ? store.findIndex((it) => it && it.key === key) : -1;
  if (i < 0) return false;
  store.splice(i, 1);
  return true;
}

// ---------- battle setup (createBattle / createRaid) ----------
export function stealthSetup(state, b) {
  // Night counts in raids and in base battles (a break-in, a raid at the walls: deploy.js, where the floodlights light
  // the dark); other battles keep daylight sight as before.
  const ctxNight = b.setup && b.setup.context ? b.setup.context.night : undefined;
  b.night = !!b.raid ? isNight(state) : b.setup && b.setup.layout === "baseDefence" ? !!(ctxNight ?? isNight(state)) : false;
  b.lures = b.lures || [];
  const mine = b.units.filter((u) => u.side === "player");
  const cx = mine.reduce((a, u) => a + u.x, 0) / Math.max(1, mine.length), cy = mine.reduce((a, u) => a + u.y, 0) / Math.max(1, mine.length);
  for (const u of b.units) {
    if (u.side === "player") {
      const s = survivorById(state, u.sid);
      const tool = s && s.gear.tool;
      setLight(u, s);
      u.nvg = !!(tool && (tool.key === "nvg" || tool.key === "thermal")); // a thermal monocular sees in the dark like night vision (optics.js)
      const t = s ? s.traits || [] : [];
      u.str = (t.includes("tough") ? 5 : 0) + (t.includes("brave") ? 5 : 0) - (t.includes("coward") ? 5 : 0);
      setSuppressor(u, s);
      u.daySight = u.sight; // refitSenses
      if (b.night && !u.nvg) u.sight = Math.min(u.sight, nightSight(u));
      u.optic = battleOptic(s, b.night); // optics.js: binoculars and scopes see further (by day; a thermal at night too)
    } else {
      if (!u.face) u.face = [sign(Math.round(cx - u.x)), sign(Math.round(cy - u.y))];
      nightEyes(b, u);
    }
  }
}
// The light a unit carries (lights.js): u.light is its key (or null), read by the night sight, detection, the dark
// rummage (search.js) and the battle views (their beams and glows).
function setLight(u, s) {
  u.light = lightOf(s);
}
const nightSight = (u) => (u.light && LIGHTS[u.light] ? LIGHTS[u.light].sight : STEALTH.NIGHT_SIGHT);
export const lightSeen = (u) => (u.light && LIGHTS[u.light] ? LIGHTS[u.light].seen : 0);
function nightEyes(b, u) {
  if (!b.night || u.nightEyes || u.side === "player") return;
  u.nightEyes = true;
  u.sight = Math.min(u.sight, u.kind === "zombie" ? STEALTH.NIGHT_ZOMBIE_SIGHT : STEALTH.NIGHT_SIGHT);
}

// How close an unaware enemy notices one of your people. perks: Light Step and Ghost (skills.js) count (the
// enemy-turn check, combat.js detect); a wandering guard's own look around (notice) uses the plain range.
export function detectRange(b, e, mover, perks = true) {
  const range = Math.max(3, 8 - Math.floor(mover.stealth / 4));
  let r = e.kind === "zombie" ? Math.min(range, 5) : range;
  if (perks && mover.sneak) r = Math.max(1, r - mover.sneak);
  if (b.night) r = Math.max(2, Math.round(r * STEALTH.NIGHT_DETECT) + lightSeen(mover)); // a light is seen from further off
  if (b.night && mover.sparks === b.turn) r += 2; // locks.js: an angle grinder's sparks this turn (SAFE.grind.sparks)
  // A person looks the way they face: behind them only what they hear (half the range). The dead have no front.
  if (e.kind === "human" && isBehind(mover, e)) r = Math.max(1, Math.ceil(r * STEALTH.BEHIND_DETECT));
  if (perks && mover.ghost) r = Math.min(r, 2);
  return r;
}

// A full search takes 1 action, by day or in the dark (search.js). The dark now shows in the quick rummage instead:
// without a flashlight or night vision it is heard further (search.js quickRadius).
export const searchCost = () => 1;

// Noise of one shot: × the gun's attachments (gunmods.js: a suppressor cuts it, a brake adds to it), or × SUPPRESS
// for an oil filter only carried. A makeshift suppressor loses a shot of wear; worn out, it is gone.
export function shotNoise(b, a, w) {
  if (!w.noise) return 0;
  const gm = unitMods(a);
  const sup = a.suppressor && (a.supFitted ? gm.noise < 1 : a.side === "player") ? a.suppressor : null;
  const mult = gm.noise * (sup && !a.supFitted ? STEALTH.SUPPRESS : 1);
  if (sup && GEAR[sup.key] && GEAR[sup.key].dur) {
    sup.dur = Math.max(0, (sup.dur ?? GEAR[sup.key].dur) - 1);
    if (sup.dur <= 0) {
      if (a.supFitted) {
        const gun = a.item || { key: a.weapon, mods: a.modItems };
        if (gun.mods && gun.mods.muzzle === sup) removeMod(gun, "muzzle");
        if (a.modItems && a.modItems.muzzle === sup) delete a.modItems.muzzle;
        a.gm = gunMods(gun); // the rest of the gun's attachments still count
        a.weaponName = modLabel(a.item || { name: WEAPONS[a.weapon].name, mods: gun.mods });
      } else if (a.dropSuppressor) a.dropSuppressor();
      a.suppressor = null;
      say(b, `${a.name}'s suppressor is shot out.`, "danger");
    }
  }
  return w.noise * mult;
}

// ---------- takedowns ----------
// Is the attacker behind the target (the half the target is not facing)?
export function isBehind(a, t) {
  const f = t.face || [0, 0];
  if (!f[0] && !f[1]) return false;
  return (a.x - t.x) * f[0] + (a.y - t.y) * f[1] < 0;
}
const flatFooted = (t) => !t.aware || !!t.surprised;
export const staggering = (t) => t.hp <= t.maxHp * STEALTH.STAGGER;
export const canSubdue = (a, t) => !!a && !!t && t.side === "enemy" && t.kind === "human" && active(t) && adjacent(a, t);

// Odds of Subdue against an adjacent human: a takedown (knock-out roll) on the unaware or staggering, else a
// non-lethal blow. { takedown, chance, dmg, behind, cover, label }.
export function subdueOdds(b, a, t) {
  const m = meleeOdds(b, a, t);
  const dmg = [Math.round(m.dmg[0] * STEALTH.BLUNT), Math.round(m.dmg[1] * STEALTH.BLUNT)];
  const flat = flatFooted(t);
  if (!flat && !staggering(t)) {
    const chance = Math.max(10, m.chance - 10);
    return { takedown: false, chance, dmg, behind: false, cover: false, label: `Non-lethal blow: ${chance}% to hit, ${dmg[0]}–${dmg[1]} damage; knocks them out instead of killing` };
  }
  const behind = isBehind(a, t);
  const cover = coverSides(b, a.x, a.y).some((c) => c > 0);
  let c = TAKEDOWN.base + (a.stealth || 0) * TAKEDOWN.stealth + (WEAPONS[a.weapon] && WEAPONS[a.weapon].melee ? CLUB[a.weapon] ?? 5 : 5);
  if (behind) c += TAKEDOWN.behind;
  if (cover) c += TAKEDOWN.cover;
  c += a.str || 0;
  if (a.assassin) c += TAKEDOWN.assassin;
  c += TAKEDOWN.kit[t.kit] || 0;
  if (!flat) c += TAKEDOWN.staggering;
  const chance = Math.round(clamp(c, 5, 95));
  return { takedown: true, chance, dmg, behind, cover, label: `Takedown: ${chance}% to knock them out${behind ? ", from behind" : ""}${cover ? ", from cover" : ""}` };
}

// Knocked out (damage() with nonLethal, or a takedown): down, out of the fight, wakes in 4–6 turns unless tied.
export function knockOut(b, t, by) {
  t.hp = 0;
  t.down = true;
  t.ko = true;
  t.aware = false;
  t.surprised = false;
  t.ow = t.hunker = false;
  delete t.investigate;
  t.wake = b.turn + b.rng.int(STEALTH.WAKE[0], STEALTH.WAKE[1]);
  if (by && by.sid != null) (b.koBy || (b.koBy = {}))[by.sid] = ((b.koBy || {})[by.sid] || 0) + 1;
  say(b, `${t.name} is out cold.`, "good");
}

function takedown(b, a, t) {
  const rng = b.rng;
  const o = subdueOdds(b, a, t);
  a.face = [sign(t.x - a.x), sign(t.y - a.y)];
  if (a.xpT) a.xpT.melee++;
  if (o.takedown && rng.chance(o.chance / 100)) {
    say(b, `${a.name} takes ${t.name} down${o.behind ? " from behind" : ""} (${o.chance}%).`, "good");
    knockOut(b, t, a);
    if (a.xpT) a.xpT.sneak += 2; // skills.js: Stealth XP
    fx(b, { type: "melee", from: [a.x, a.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: a.side, text: "KO" });
    return;
  }
  const m = meleeOdds(b, a, t);
  const chance = o.takedown ? m.chance : o.chance;
  if (rng.chance(chance / 100)) {
    const eff = Math.round(damage(b, t, rng.int(m.dmg[0], m.dmg[1]) * STEALTH.BLUNT * (a.meleeMult || 1), a, true));
    say(b, `${a.name} ${o.takedown ? "fails the takedown but clubs" : "clubs"} ${t.name} for ${eff}.`, "good");
    fx(b, { type: "melee", from: [a.x, a.y], to: [t.x, t.y], hit: true, crit: false, dmg: eff, side: a.side });
  } else {
    say(b, `${a.name} grabs for ${t.name} and misses.`, "info");
    fx(b, { type: "melee", from: [a.x, a.y], to: [t.x, t.y], hit: false, side: a.side });
  }
  if (!t.dead && !t.down && !t.aware) alertPod(b, t.pod, `${t.name} cries out!`);
}

// ---------- player actions ----------
// subdue, tie, throw, drag. Returns an error, or "" when it happened (combat.js combatAct does the rest).
export function stealthAct(state, b, u, t, act) {
  switch (act.type) {
    case "subdue": {
      if (!canSubdue(u, t)) return "Subdue needs a person right next to you.";
      takedown(b, u, t);
      u.ap = 0;
      return "";
    }
    case "tie": {
      if (!t || t.side !== "enemy" || !t.ko || t.dead || !adjacent(u, t)) return "Tie up someone knocked out, right next to you.";
      if (t.tied) return "Already tied up.";
      t.tied = true;
      // Handcuffs (data.js cuffs) on the unit: no action, and they stay on the prisoner.
      const cuffs = findCarried(survivorById(state, u.sid), "cuffs");
      if (cuffs) { cuffs.take(); say(b, `${u.name} cuffs ${t.name} in a moment.`, "good"); return ""; }
      u.ap -= 1;
      say(b, `${u.name} ties up ${t.name}.`, "good");
      return "";
    }
    case "throw": {
      const have = throwablesOf(state, b, u);
      const key = act.item && have[act.item] ? act.item : THROW_KEYS.find((k) => have[k]);
      if (!key) return "Nothing to throw.";
      const T = THROWABLES[key];
      let x = T.self ? u.x : Number(act.x), y = T.self ? u.y : Number(act.y);
      if (!(x >= 0 && y >= 0 && x < b.w && y < b.h)) return "Throw it where?";
      // Inside a building (buildingmaps.js) a throw goes through open doorways but not through walls or closed doors:
      // it drops where it hits.
      let short = false;
      if (!T.self && b.raid && b.raid.interior) {
        const land = interiorLanding(b, u.x, u.y, x, y);
        if (!land) return "No room to throw it that way: a wall or a closed door is right in front.";
        short = land[0] !== x || land[1] !== y;
        [x, y] = land;
      }
      const d = dist(u.x, u.y, x, y);
      if (!T.self && d > T.range + 0.01) return `Too far: ${T.label} carries ${T.range} tiles.`;
      if (!T.self && d < 2 && !short) return "Throw it further away.";
      // Over a wall: something with fx needs no line of sight, only a cell someone on your side sees (throwables.js).
      let blind = T.fx && !T.self ? throwBlind(b, u, x, y) : false;
      if (blind === null && T.fx === "flash" && doorToss(b, u, x, y)) blind = true; // tossed through a doorway into a room (throwables.js)
      if (blind === null) return "Nobody can see there: a throw over a wall lands only where you or a teammate has eyes (or where an enemy was last seen).";
      if (!T.keep && !takeThrowable(state, b, u, key)) return "Nothing to throw.";
      u.ap -= 1;
      u.hunker = false;
      if (short) say(b, `${u.name}'s throw hits a wall and drops short.`, "info");
      throwAt(b, u, key, x, y, blind);
      return "";
    }
    case "drag": {
      if (!t || !dragable(t)) return "Drag a body, someone knocked out or a downed teammate.";
      if (!adjacent(u, t)) return "Move next to them first.";
      const x = Number(act.x), y = Number(act.y);
      const r = reachable(b, u, STEALTH.DRAG);
      const c = x >= 0 && y >= 0 && x < b.w && y < b.h ? r.dist[y * b.w + x] : Infinity;
      if (!isFinite(c) || c === 0) return `Dragging is slow: up to ${STEALTH.DRAG} tiles for 1 action.`;
      const from = [u.x, u.y];
      const path = pathTo(r, x, y);
      u.ap -= 1;
      u.hunker = false;
      moveAlong(b, u, path);
      const k = path.findIndex(([px, py]) => px === u.x && py === u.y);
      const spot = k > 0 ? path[k - 1] : from;
      if (!(spot[0] === u.x && spot[1] === u.y) && !unitAt(b, spot[0], spot[1])) moveBody(b, t, spot[0], spot[1]);
      say(b, `${u.name} drags ${t.dead ? `${t.name}'s body` : t.name} along.`, "info");
      return "";
    }
    default:
      return "Unknown action.";
  }
}
// A throw that is allowed and paid for (the item taken, the action spent): where it lands (a tile off now and then
// for anything with fx), the lure it leaves (b.lures, the ones that sense it go to look), what it does there.
// Shared by your people and the enemy (siege.js enemyThrow). Returns [x, y] where it came down.
export function throwAt(b, u, key, x, y, blind = false) {
  const T = THROWABLES[key];
  let lx = x, ly = y, off = false;
  if (T.fx && !T.self) [lx, ly, off] = throwLanding(b, u, T, x, y, blind);
  let n = 0;
  if (T.radius) {
    const lure = { x: lx, y: ly, key, turns: T.turns, radius: T.radius, id: b.nextId++, side: u.side, from: [u.x, u.y], sense: T.sense || ["noise"], decoy: !!T.decoy };
    b.lures.push(lure);
    n = pull(b, lure, true);
  }
  if (!T.self) fx(b, { type: "throw", from: [u.x, u.y], to: [lx, ly], item: key });
  if (T.heat && b.raid) b.raid.heat = Math.min(100, b.raid.heat + T.heat);
  const extra = T.fx ? landEffect(b, u, T, lx, ly) : "";
  const heard = T.radius ? (n ? ` ${n} of them turn toward it.` : T.fx ? "" : " Nothing seems to notice.") : ""; // fx: the bang or the flare says it
  const where = off ? " It lands a tile off." : blind ? " Thrown blind over cover." : "";
  say(b, `${u.name} ${T.self ? "blows" : "throws"} ${T.label}.${where}${heard}${extra ? ` ${extra}` : ""}${T.heat && b.raid ? " Heat rises." : ""}`, u.side === "enemy" ? "danger" : n || extra ? "good" : "info");
  return [lx, ly];
}

export const dragable = (t) => (t.side === "enemy" && t.kind === "human" && !t.off && (t.dead || t.ko)) || (t.side === "player" && t.down && !t.dead && !t.left);
function moveBody(b, t, x, y) {
  const box = b.raid ? b.raid.containers.find((c) => c.kind === "body" && c.uid === t.id) : null;
  t.x = x; t.y = y;
  if (box) { box.x = x; box.y = y; }
}

// ---------- the enemy turn ----------
// Throwables still making noise pull again, and the knocked out who were not tied up come to.
export function stealthTurn(b) {
  for (const u of b.units) nightEyes(b, u);
  for (const lure of [...(b.lures || [])]) {
    lure.turns -= 1;
    if (lure.turns <= 0) b.lures.splice(b.lures.indexOf(lure), 1);
    else pull(b, lure);
  }
  for (const u of b.units) {
    if (!u.ko || u.tied || u.dead || u.fled || u.wake == null || b.turn < u.wake) continue;
    u.down = false;
    u.ko = false;
    u.hp = Math.max(u.hp, Math.round(u.maxHp * 0.25));
    u.ap = 0;
    alertPod(b, u.pod, `${u.name} comes to and shouts for help!`);
    u.aware = true;
  }
}

// Unaware enemies within earshot of a lure go to look: people where it landed (a stealth lure) or where it was thrown
// from (a decoy: they are not fooled), or not at all (silent heat); the dead only if they sense it (decoys.js: noise,
// light, heat by their kind; nothing for a Shepherd's pack). Returns how many turned toward it; first: the throw
// itself, which also counts the aware dead a decoy pulls off (decoys.js lureTurn moves them).
// Inside a building (buildingmaps.js) walls and closed doors muffle the noise (each one between counts as
// BMAP.WALL_DAMP tiles more), and the dead already after you turn to the noise too unless one of your people is close
// and in their sight (BMAP.DIVERT_NEAR): break off, shut a door and throw something, and they go.
function pull(b, lure, first = false) {
  const T = THROWABLES[lure.key] || {};
  let n = 0;
  const inside = !!(b.raid && b.raid.interior);
  for (const e of b.units) {
    if (e.side === lure.side || e.side === "player" || !active(e)) continue;
    if (e.reinforcement && !inside) continue;
    const d = dist(e.x, e.y, lure.x, lure.y) + (inside ? noiseDamp(b, e.x, e.y, lure.x, lure.y) : 0);
    if (d > lure.radius) continue;
    if (e.kind === "human") {
      if (e.aware || T.people === "none") continue;
      const [tx, ty] = T.people === "thrower" && lure.from ? lure.from : [lure.x, lure.y];
      e.investigate = { x: tx, y: ty, turns: STEALTH.INVESTIGATE_TURNS, key: lure.key };
      n++;
      continue;
    }
    if (!sensesAny(b, e, lure.sense || T.sense || ["noise"])) continue;
    if (e.aware) {
      // Indoors the dead chasing you break off for a noise (not for a door being battered: divert false).
      if (inside && lure.divert !== false && divertable(b, e)) { e.aware = false; e.diverted = true; }
      else { if (first && lure.decoy) n++; continue; }
    }
    e.investigate = { x: lure.x, y: lure.y, turns: STEALTH.INVESTIGATE_TURNS, key: lure.key };
    n++;
  }
  return n;
}
// A sound somewhere (a door being battered, buildingmaps.js): the unaware within earshot come to look (the dead already
// after someone keep at it).
export function noiseAt(b, x, y, radius, key = "noise") {
  return pull(b, { x, y, radius, key, turns: 1, divert: false });
}
const divertable = (b, e) => !b.units.some((p) => p.side === "player" && active(p) && dist(p.x, p.y, e.x, e.y) <= BMAP.DIVERT_NEAR && los(b, e.x, e.y, p.x, p.y));

// The AI of an unaware enemy (combat.js aiUnit): bodies first, then an investigation. Returns true when the turn
// was used up; false lets the usual behaviour run (it may have just become aware).
export function stealthAI(b, u) {
  if (u.aware || !active(u)) return false;
  if (spotBodies(b, u)) return false;
  if (!u.investigate) return false;
  investigate(b, u);
  return true;
}

function investigate(b, u) {
  const inv = u.investigate;
  if (dist(u.x, u.y, inv.x, inv.y) <= 1.5) {
    inv.turns -= 1;
    if (inv.turns <= 0) { delete u.investigate; u.wp = null; }
  } else {
    const r = reachable(b, u, u.kind === "zombie" ? 3 : u.mob);
    // Inside a building the dead find their way round the walls and batter the closed doors on it (buildingmaps.js).
    const inside = !!(b.raid && b.raid.interior);
    const field = distField(b, [[inv.x, inv.y]], inside && u.kind === "zombie" ? u : null);
    let best = -1;
    for (let i = 0; i < b.w * b.h; i++) {
      if (!isFinite(r.dist[i]) || !isFinite(field[i])) continue;
      if (best < 0 || field[i] < field[best] || (field[i] === field[best] && r.dist[i] < r.dist[best])) best = i;
    }
    if (best < 0 || !isFinite(field[best])) delete u.investigate;
    else if (r.dist[best] > 0) moveAlong(b, u, pathTo(r, best % b.w, (best / b.w) | 0));
    else if (inside && u.kind === "zombie") { const door = siegeTarget(b, u, field); if (door) bash(b, u, door[0], door[1]); }
    u.face = [sign(inv.x - u.x), sign(inv.y - u.y)];
  }
  notice(b, u);
  if (!u.aware) spotBodies(b, u);
  u.ap = 0;
}

// A guard who sees a body (or a tied-up comrade) raises the alarm. Returns true when it did.
export function spotBodies(b, e) {
  if (e.kind !== "human" || e.aware || !active(e)) return false;
  const range = b.night ? STEALTH.BODY_SIGHT_NIGHT : STEALTH.BODY_SIGHT;
  for (const o of b.units) {
    if (o === e || o.side !== "enemy" || o.kind !== "human" || o.found || o.fled || o.off || !(o.dead || o.ko)) continue; // off: a body that got up (carriers.js)
    if (dist(e.x, e.y, o.x, o.y) > range || !los(b, e.x, e.y, o.x, o.y)) continue;
    o.found = true;
    if (b.raid) b.raid.heat = Math.min(100, b.raid.heat + STEALTH.BODY_HEAT);
    const what = o.dead ? `${o.name}'s body` : `${o.name}${o.tied ? " tied up" : " out cold"}`;
    alertPod(b, e.pod, `${e.name} finds ${what} and raises the alarm!`);
    e.aware = true;
    return true;
  }
  return false;
}

// ---------- after the fight ----------
// Prisoners from a finished battle: the knocked out after a win; in a raid only the tied ones lying in an
// extraction zone that someone left from.
export function battleCaptives(b, outcome) {
  const enemies = b.units.filter((u) => u.side === "enemy" && u.kind === "human" && u.ko && !u.dead && !u.reinforcement);
  if (b.raid) {
    const zones = new Set(b.units.filter((u) => u.side === "player" && u.left && !u.dead && u.exitZone != null).map((u) => u.exitZone));
    return enemies.filter((u) => u.tied && zones.has(zoneAt(b, u.x, u.y)));
  }
  return outcome === "victory" ? enemies : [];
}

// ---------- the raid bot (combat.js autoRaidTurn) ----------
// Ties up the knocked out next to it, takes down an unaware guard next to it when the odds are good, and throws
// something to pull nearby unaware guards and dead away (once per turn for the team). Returns true if it acted.
export function botStealth(state, b, u, combatAct) {
  const foes = b.units.filter((e) => e.side === "enemy" && active(e));
  const ko = b.units.find((e) => e.side === "enemy" && e.ko && !e.tied && !e.dead && adjacent(u, e));
  if (ko && u.ap > 0) return !combatAct(state, { type: "tie", unit: u.id, target: ko.id });
  const prey = foes.filter((e) => canSubdue(u, e) && (flatFooted(e) || staggering(e)) && subdueOdds(b, u, e).chance >= 50);
  if (prey.length) return !combatAct(state, { type: "subdue", unit: u.id, target: prey[0].id });
  // Stalk a lone unaware guard within 8 tiles (no comrade within 4 tiles of it): one action's move toward the cell
  // behind it, the takedown once next to it.
  if ((u.stealth || 0) >= 5) {
    const lone = foes.filter((e) => e.kind === "human" && !e.aware && dist(u.x, u.y, e.x, e.y) <= 8 && !foes.some((o) => o !== e && o.kind === "human" && dist(o.x, o.y, e.x, e.y) <= 4));
    const behind = [];
    for (const e of lone) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = e.x + dx, y = e.y + dy;
      if ((dx || dy) && walk(b, x, y) && !unitAt(b, x, y) && isBehind({ x, y }, e)) behind.push([x, y]);
    }
    if (behind.length) {
      const field = distField(b, behind);
      const r = reachable(b, u, u.mob);
      let best = -1;
      for (let i = 0; i < b.w * b.h; i++) if (isFinite(r.dist[i]) && r.dist[i] > 0 && (best < 0 || field[i] < field[best])) best = i;
      if (best >= 0 && field[best] < field[u.y * b.w + u.x]) return !combatAct(state, { type: "move", unit: u.id, x: best % b.w, y: (best / b.w) | 0 });
    }
  }
  if (b.botThrowTurn === b.turn) return false;
  const have = throwablesOf(state, b, u);
  const key = LURES.find((k) => have[k]);
  if (!key) return false;
  const near = foes.filter((e) => !e.aware && !e.investigate && dist(u.x, u.y, e.x, e.y) <= 6);
  if (!near.length) return false;
  const T = THROWABLES[key];
  let best = null;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const d = dist(u.x, u.y, x, y);
    if (d < 4 || d > T.range || !walk(b, x, y)) continue;
    let pulled = 0;
    for (const e of near) if (dist(e.x, e.y, x, y) <= T.radius && d > dist(u.x, u.y, e.x, e.y) + 2) pulled++;
    const sc = pulled + d * 0.05;
    if (pulled && (!best || sc > best.sc)) best = { x, y, sc };
  }
  if (!best) return false;
  b.botThrowTurn = b.turn;
  return !combatAct(state, { type: "throw", unit: u.id, item: key, x: best.x, y: best.y });
}

// ---------- the AI's attacks with throwables (combat.js autoPlayerTurn) ----------
// One throw a turn for the whole side: a pipe bomb, else a Molotov, on three or more aware enemies bunched within
// a tile of each other with none of yours close (throwables.js blastSpot). Returns true if the unit threw.
export function botAttackThrow(state, b, u) {
  if (b.botAttackTurn === b.turn || !active(u) || u.ap < 1) return false;
  const have = throwablesOf(state, b, u);
  for (const key of ["frag", "pipebomb", "molotov"]) {
    if (!have[key]) continue;
    const spot = blastSpot(b, u, THROWABLES[key].range, key === "frag" ? FRAG.r : key === "pipebomb" ? BLAST.r : FIRE.r, { fire: key === "molotov" });
    if (!spot) continue;
    b.botAttackTurn = b.turn;
    return !stealthAct(state, b, u, null, { type: "throw", item: key, x: spot.x, y: spot.y });
  }
  return botFlash(state, b, u);
}
// A flashbang on two or more people bunched up (throwables.js flashSpot: none of yours in its reach), once a turn for
// the side, then the rest of the turn as usual (the stunned cannot watch the way in). aware: only people who know of
// the fight count (the raid bot does not throw one into a room of sleepers). Returns true if the unit threw.
export function botFlash(state, b, u, aware = false) {
  if (b.botAttackTurn === b.turn || !active(u) || u.ap < 1) return false;
  if (!throwablesOf(state, b, u).flashbang) return false;
  const spot = flashSpot(b, u, THROWABLES.flashbang.range, { need: 2, aware });
  if (!spot) return false;
  b.botAttackTurn = b.turn;
  return !stealthAct(state, b, u, null, { type: "throw", item: "flashbang", x: spot.x, y: spot.y });
}

// Before the AI sounds the retreat: a smoke grenade over the middle of the team still off the strip (it covers
// everyone within 4 tiles of it). Returns true if one was thrown.
export function botRetreatSmoke(state, b, inEvac) {
  const mine = b.units.filter((u) => u.side === "player" && active(u));
  const out = mine.filter((u) => !inEvac(b, u.x, u.y));
  if (!out.length) return false;
  const cx = Math.round(out.reduce((a, u) => a + u.x, 0) / out.length), cy = Math.round(out.reduce((a, u) => a + u.y, 0) / out.length);
  for (const u of mine) {
    if (u.ap < 1 || !throwablesOf(state, b, u).smokegren) continue;
    const d = dist(u.x, u.y, cx, cy);
    const x = d < 2 ? Math.min(b.w - 1, u.x + 2) : cx, y = cy;
    if (dist(u.x, u.y, x, y) > THROWABLES.smokegren.range) continue;
    return !stealthAct(state, b, u, null, { type: "throw", item: "smokegren", x, y });
  }
  return false;
}

// A tool put in the off hand (or a gun changed) in the middle of a raid (raidloot.js, combat.js refitUnit): the light,
// night vision, scope and suppressor count at once. daySight: what the unit sees by day (night caps it again).
export function refitSenses(b, u, s) {
  if (!s) return;
  const tool = s.gear.tool;
  setLight(u, s);
  u.nvg = !!(tool && (tool.key === "nvg" || tool.key === "thermal"));
  if (u.daySight != null) u.sight = b.night && !u.nvg ? Math.min(u.daySight, nightSight(u)) : u.daySight;
  u.optic = battleOptic(s, b.night);
  setSuppressor(u, s);
}
// The suppressor a player unit shoots with: the one fitted to its gun (gunmods.js), else an oil filter it only carries
// (when nothing is on the gun's muzzle). u.supFitted: it is on the gun (its noise is in u.gm).
function setSuppressor(u, s) {
  const gun = u.item && u.gmWeapon === u.weapon ? u.item : null;
  const on = gun ? fittedSuppressor(gun) : null;
  if (on) { u.suppressor = on; u.supFitted = true; u.dropSuppressor = null; return; }
  const sup = s && SUPPRESSIBLE.includes(u.weapon) && !(gun && gun.mods && gun.mods.muzzle) ? findCarried(s, "suppressor") : null;
  u.suppressor = sup ? sup.item : null;
  u.supFitted = false;
  u.dropSuppressor = sup ? sup.take : null;
}
