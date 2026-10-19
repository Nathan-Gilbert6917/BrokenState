// @ts-check
// Hearing and deafening in battle (docs/weapons-overhaul-plan.md section 18.4).
//
// A bang (bangOf): a shot is its noise (stealth.js shotNoise: a suppressor, the round) × INDOOR inside a building, +AUTO
// for a full-auto stream (a single shot or a burst is one bang an action); the vehicle turret's burst TURRET; a frag
// grenade or pipe bomb BLAST.frag, a flashbang BLAST.flash (throwables.js landEffect), a launcher's shell or rocket
// (the launcher agent calls deafen with its own); a Nightmare's scream SCREAM (middead.js).
// Each living person within RANGE tiles (deafen): exposure e = bang + SHOOTER (the one who fired) − FALL a tile − the
// cut of their ear protection. e ≥ DEAF: deaf (u.deaf turns, +1, +2 at e ≥ DEAF2, at most MAX); e ≥ DAZE: dazed
// (−DAZE_AIM aim for this turn and the next: u.dazed). Both tick down at the start of the side's turn (tickEars).
// Your people hear (hearRange): BASE tiles + the helmet's muffle (helmets.js HELMETS: full shells cost hearing) + the
// ear protection's HEAR (muffs and plugs −3, electronic +2, a team headset +3); nothing while deaf. Earplugs (foam, or
// the makeshift rag plugs crafted from a scrap: cut 2) work from a pocket under any helmet and wear a pair a fight
// (isPlugsKey, settleEars). An enemy that
// moved or fired in the enemy phase, unseen, within that range of one of your people is heard: a "?" marker where it
// is (heardGhosts, b.ghosts with the heard flag; combat.js enemyGhosts).
// Enemy humans hear you sneak up from behind (stealth.js detectRange: the behind arc × hearMult): deaf 0 (they notice
// only from a tile), electronic 0.75, muffs or plugs 0.3. The dead are never deafened.
// A Nightmare's scream (middead.js): hold +0.15 with plugs or muffs, +0.2 electronic, +0.25 while deafened (earHold).
// A team headset (commset): two or more linked units of a side call out targets: +LINK_AIM at a target another linked
// unit sees (linkAim), +LINK_ESCAPE to escape odds (linkEscape). Enemies with headsets the same.
// Permanent hearing loss (HEARING.PERMANENT, off): s.hearing −LOSS for each unprotected exposure ≥ DAZE; under ONE
// −1 tile of hearing, under TWO −2 ("Hard of hearing").
// Dice: none. Everything here is arithmetic on the map.
import { WEAPONS, active, canSee, fx, say, playerSees } from "./combat.js";
import { modeOf, gunModes } from "./gunfire.js";
import { unitMods } from "./gunmods.js";
import { earGearOf, faceOf, HELMETS, syncVisorSight, helmetOf } from "./helmets.js";
import { GEAR } from "./data.js"; // isPlugsKey: which ear protection is a strip of earplugs
import { weather } from "./weather.js";
import { wear } from "./crafting.js";
import { registerHearing } from "./launchers.js"; // launcher blasts and rocket launches deafen through hearing.js (registered below, at load)
import { registerHearing as registerThrowHearing } from "./throwables.js"; // the same registry, re-exported by throwables.js

export const HEAR = {
  BASE: 6, RANGE: 4, SHOOTER: 1, FALL: 0.5, DEAF: 3.5, DEAF2: 5, DAZE: 6, MAX: 3, DAZE_AIM: 10,
  INDOOR: 1.5, AUTO: 1, TURRET: 4, SCREAM: 4,
  BLAST: { frag: 5, blast: 5, flash: 5, he40: 5, rocket: 7 },
  LINK_AIM: 5, LINK_ESCAPE: 5,
  HOLD: { plugs: 0.15, elec: 0.2, deaf: 0.25 },
  MULT: { deaf: 0, elec: 0.75, plugs: 0.3 },
  FLASH_CUT: 0.4, // ear protection alone takes at most this share off a flashbang (throwables.js flashCut: a near one still costs an action)
};
export const HEARING = { PERMANENT: false, LOSS: 0.02, ONE: 0.85, TWO: 0.7 };

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
// Inside a building (a floor cell: building maps, a raid's interiors).
export function indoors(b, x, y) {
  const c = b && b.cells && b.w ? b.cells[y * b.w + x] : null;
  return !!(c && c.f === "floor");
}
// It is this unit's side's turn now.
const ownTurn = (b, u) => (b.phase === "player" ? u.side === "player" : u.side !== "player");

// ---------- the bang ----------
// Loudness of a shot by unit a with weapon w (noise: what stealth.js shotNoise gave for it, when known; mode: the
// fire mode it was fired in).
export function bangOf(b, a, w = WEAPONS[a.weapon], noise = null, mode = null) {
  if (!w || w.melee) return 0;
  if (w.mounted) return HEAR.TURRET;
  let n = noise ?? (w.noise || 0) * (unitMods(a).noise ?? 1);
  if (!(n > 0)) return 0;
  if (indoors(b, a.x, a.y)) n *= HEAR.INDOOR;
  if ((mode ?? modeOf(a)) === "auto" && gunModes(w)) n += HEAR.AUTO;
  return n;
}
// Bang points a unit's ear protection takes off.
export const earCut = (u) => (u && u.ears ? u.ears.cut || 0 : 0);
// The exposure of a unit to a bang at (x, y).
export const exposure = (u, x, y, bang, shooter = null) => bang + (u === shooter ? HEAR.SHOOTER : 0) - HEAR.FALL * dist(u.x, u.y, x, y) - earCut(u);

// A bang at (x, y): everyone living within RANGE (on the same floor) may be deafened or dazed. shooter: who fired (a
// shot's own ears take it worst). Returns the units newly deafened. Exported for the launcher agent (throwables.js
// launcher blasts) and anything else loud.
export function deafen(b, x, y, bang, shooter = null) {
  const out = [];
  if (!b || !b.units || !(bang > 0)) return out;
  if (shooter) shooter.shotT = b.turn; // heardGhosts: it fired this turn
  const floor = shooter ? shooter.f || 0 : b.floor || 0;
  for (const u of b.units) {
    if (u.kind !== "human" || u.ztype || u.dead || u.off || u.left || u.fled || u.aboard) continue;
    if (b.floors && (u.f || 0) !== floor) continue;
    if (dist(u.x, u.y, x, y) > HEAR.RANGE) continue;
    const e = exposure(u, x, y, bang, shooter);
    if (e >= HEAR.DEAF) {
      const was = u.deaf || 0;
      u.deaf = Math.min(HEAR.MAX, was + (e >= HEAR.DEAF2 ? 2 : 1));
      if (!was) { out.push(u); if (u.side === "player") fx(b, { type: "loot", to: [u.x, u.y], text: "DEAF" }); }
    }
    if (e >= HEAR.DAZE) {
      const was = u.dazed || 0;
      u.dazed = Math.max(was, ownTurn(b, u) ? 2 : 1);
      if (!was && u.side === "player") say(b, `${u.name} is dazed by the blast of noise (−${HEAR.DAZE_AIM} aim).`, "danger");
      if (HEARING.PERMANENT && (u.side === "player" || u.who) && !u.ears) u.hearLost = Math.round(((u.hearLost || 0) + HEARING.LOSS) * 100) / 100;
    }
  }
  return out;
}
// The start of a side's turn (combat.js startPlayerTurn, endPlayerTurn for the enemy phase): deafness and the daze
// wear off a turn.
export function tickEars(b, sides) {
  for (const u of b.units) {
    if (!sides.includes(u.side)) continue;
    if (u.deaf > 0) u.deaf--;
    if (u.dazed > 0) u.dazed--;
  }
}

// ---------- what they hear ----------
// Permanent hearing loss: tiles off the range.
const lossTiles = (u) => { const h = u.hearing ?? 1; return h < HEARING.TWO ? 2 : h < HEARING.ONE ? 1 : 0; };
// Tiles a unit hears enemies it cannot see (0 while deaf).
export function hearRange(u) {
  if (!u || u.deaf > 0) return 0;
  return Math.max(0, HEAR.BASE + (u.muffle || 0) + (u.ears ? u.ears.hear || 0 : 0) - lossTiles(u));
}
// × the behind arc of an enemy's detection (stealth.js detectRange).
export function hearMult(u) {
  if (!u) return 1;
  if (u.deaf > 0) return HEAR.MULT.deaf;
  if (u.ears) return u.ears.elec ? HEAR.MULT.elec : HEAR.MULT.plugs;
  return 1;
}
// The enemies your people hear but do not see (moved or fired this turn): marked in b.ghosts with the heard flag
// (combat.js enemyGhosts: { heard: true }). Called as the enemy phase ends (combat.js startPlayerTurn), before the
// ears tick. Returns the units heard.
export function heardGhosts(b) {
  const out = [];
  if (!b || !b.units) return out;
  const ears = b.units.filter((u) => u.side === "player" && u.kind === "human" && active(u) && hearRange(u) > 0);
  if (!ears.length) return out;
  const g = b.ghosts || (b.ghosts = {});
  for (const e of b.units) {
    if (e.side !== "enemy" || !active(e)) continue;
    if (e.movedT !== b.turn && e.shotT !== b.turn) continue;
    if (playerSees(b, e)) continue;
    if (!ears.some((u) => (u.f || 0) === (e.f || 0) && dist(u.x, u.y, e.x, e.y) <= hearRange(u))) continue;
    g[e.id] = [e.x, e.y, b.turn, e.f || 0, 1]; // [x, y, turn, floor, heard]
    out.push(e);
  }
  return out;
}

// ---------- the scream, the link, the daze ----------
// A Nightmare's scream (middead.js): what ear protection and deafness add to holding one's nerve.
export function earHold(u) {
  if (!u) return 0;
  let v = u.ears ? (u.ears.elec ? HEAR.HOLD.elec : HEAR.HOLD.plugs) : 0;
  if (u.deaf > 0) v = Math.max(v, HEAR.HOLD.deaf);
  return v;
}
// Aim lost to a daze (combat.js shotOdds).
export const dazedAim = (a) => (a && a.dazed > 0 ? HEAR.DAZE_AIM : 0);
const linkedMates = (b, u) => b.units.filter((o) => o !== u && o.side === u.side && o.link && active(o));
// A team headset: + aim at a target another linked unit of the side sees (combat.js shotOdds).
export function linkAim(b, a, t) {
  if (!a || !a.link || !t || !b || !b.units) return 0;
  return linkedMates(b, a).some((o) => canSee(b, o, t)) ? HEAR.LINK_AIM : 0;
}
// A team headset: + escape odds with another linked unit still up (combat.js escapeOdds).
export const linkEscape = (b, u) => (u && u.link && b && b.units && linkedMates(b, u).length ? HEAR.LINK_ESCAPE : 0);

// ---------- your people ----------
// combat.js playerUnit / refitUnit: the ears (u.ears, the flashbang's u.earCut), the helmet's muffle, the team link,
// the visor's sight, and the hearing they have left.
export function fitHeadgear(u, s) {
  const e = earGearOf(s);
  u.ears = e ? { key: e.key, cut: e.cut, hear: e.hear, elec: e.elec, link: e.link } : null;
  u.earCut = e ? Math.min(HEAR.FLASH_CUT, e.cut / 10) : 0;
  u.link = !!(e && e.link);
  const h = helmetOf(s);
  u.muffle = h ? HELMETS[h.key].muffle : 0;
  u.hearing = s && Number.isFinite(s.hearing) ? s.hearing : 1;
  syncVisorSight(u);
}
// The battle's fog for visors (stealth.js stealthSetup, as a battle is made): freezing or wet weather.
export function hearSetup(state, b) {
  if (b.visorFog != null) return;
  let w = null;
  try { w = state && b.tileId != null ? weather(state, state.hour, b.tileId) : null; } catch { w = null; }
  b.visorFog = !!(w && (w.temp <= 0 || w.rain > 0));
}
// Earplugs: ear protection that works from a pocket or the pack (helmets.js earGearOf), a strip of pairs that wears a
// pair a fight: the foam ones (data-helmets.js) and the makeshift rag plugs (data.js ragplugs, crafting.js).
export const isPlugsKey = (key) => !!(key && GEAR[key] && GEAR[key].ears && GEAR[key].slot === "pack" && GEAR[key].dur);
// After a battle (combat.js wearFielded; arsenal.js settlePeople for a group's people): a pair of earplugs used, a person's hearing lost for good (when on).
export function settleEars(u, s, fought) {
  if (!u || !s) return;
  if (fought && u.ears && isPlugsKey(u.ears.key)) {
    const it = earGearOf(s);
    if (it && it.key === u.ears.key && it.item && wear(it.item, 1)) {
      const i = (s.pockets || []).indexOf(it.item);
      if (i >= 0) s.pockets[i] = null;
      else { const pk = s.gear.backpack && s.gear.backpack.contents; const j = pk ? pk.indexOf(it.item) : -1; if (j >= 0) pk[j] = null; }
    }
  }
  if (HEARING.PERMANENT && u.hearLost > 0) s.hearing = Math.max(0, Math.round(((s.hearing ?? 1) - u.hearLost) * 100) / 100);
}
// The status words of a unit's ears for the battle panel ("Deaf 2", "Dazed").
export function earStatus(u) {
  const out = [];
  if (u && u.deaf > 0) out.push(`Deaf ${u.deaf}`);
  if (u && u.dazed > 0) out.push(`Dazed (−${HEAR.DAZE_AIM} aim)`);
  return out;
}
export const hardOfHearing = (s) => !!(s && Number.isFinite(s.hearing) && s.hearing < HEARING.TWO);
// A unit's visor state for the panel: "" (no visor), "up", "down".
export function visorState(u) {
  const h = u && u.pieces && u.pieces.head;
  if (!h || !HELMETS[h.key]) return "";
  const f = faceOf({ ...u, visorUp: false });
  if (!f || f.kind === "cage") return "";
  return u.visorUp ? "up" : "down";
}

// Hand deafen and HEAR to the launchers (launchers.js HEARING) at load: combat.js and throwables.js import this module
// statically, so every run registers it at the same moment (no dynamic import).
registerHearing({ deafen, HEAR });
registerThrowHearing({ deafen, HEAR });
