// @ts-check
// Per-hit armour (docs/weapons-overhaul-plan.md sections 2 and 17, with the one-condition-field contract of section 25):
// pieces with an armour class (AC 1–6) whose durability points are the item's own dur (crafting.js itemDur / itemDurMax;
// data.js GEAR dur = the section 17 dmax), a penetration roll by the round that struck, hit locations.
//
// - A piece: GEAR key with an ARMOUR entry (or GEAR ac / mat fields: the carry-kit agent's plates and inserts). Its
//   protection reads dur / dmax (dmax: GEAR dur; a crafted piece's lower durMax shows as less). An armour item from a
//   save made before gear had durability (no dur) counts as dmax × its quality (curDur; ensureDur writes it).
// - A located hit (shots, melee, bash, bites on a person): a location (crits always the head), the piece there, the
//   penetration chance p = clamp(0.5 + (pen − T × (0.4 + 0.6 × dur / dmax)) / 20, 0.03, 0.97) with T = 10 × AC.
//   Through: × 0.9 (× 0.85 at AC ≥ 4). Stopped: the blunt share BLUNT[AC]. No piece there: the round's soft-target bonus
//   (hollow and soft points). The Tough trait stays a separate × 0.75 (u.tough).
// - Wear per hit: raw × the round's ad × the material's wear / 10, half when it went through (whole points off dur, the
//   fraction kept in item.chip). Ceramic shatters (below 30% with a pen ≥ 30 hit, or after 6 such hits: dur 0); steel
//   never does but a stopped rifle round spalls (30%: 3–6 more). A piece at dur 0 protects nothing (a plate carrier
//   keeps its soft backer for the rest of the fight) and is gone when the battle ends, like any broken gear.
// - Your people: u.pieces holds the worn items themselves (combat.js playerUnit / refitUnit: fitArmour). Everyone else:
//   plain pieces made when the unit is (enemyPieces); their body loot keeps the dur left (inventory.js enemyBody:
//   lootArmour).
// - Off the map (by the numbers: breakoff.js fightByNumbers, combat.js autoResolveCombat): absorbOffscreen wears what
//   a hurt person wears by the wound and the enemy kind's typical round; the per-fight wearSlot stays for the rest.
// The flat multiplier (inventory.js armorMult: hurt() off the map, escapes, carriers) reads the same condition.
// Dice: battleDice (hash01 on the battle's own seed and a counter), so the battle's rng stream is not shifted.
import { woundMult, TRAIT_FX } from "./traits.js"; // Tough, Frail
import { GEAR } from "./data.js";
import { CALIBERS, AMMO_TYPES, ammoPen } from "./data-ammo.js";
import { hash01 } from "./skills.js";
import { WEAPONS } from "./combat.js";
import { armorMult, ARMOR_SLOTS, isCarrier, insertsOf, migrateCarrier, stow, storageFor, personPlace } from "./inventory.js";
import { wearSlot, itemDurMax } from "./crafting.js";
import { log } from "./world.js";
import { faceOf, FACE } from "./helmets.js"; // the face zone of a head hit: the visor, the face cover
import { SURV_ARMOUR } from "./data-survival.js"; // a leather jacket, chainmail sleeves, motorcycle trousers
import { cfgOf } from "./worldcfg.js"; // the run's dials: Durability loss
export { armorMult };

// The pieces (section 17 table: AC, material; dmax is the GEAR dur, checked by tools/armortest.js). The plate carrier
// (wave 2, section 16) is a soft backer (AC 2) with two plate pockets: a hit on the torso meets the front plate (the
// back plate when it comes from behind the way the wearer faces), else the backer (carrierGuard).
/** @type {Record<string, { ac: number, dmax: number, mat: string, backer?: number, carrier?: boolean }>} */
export const ARMOUR = {
  vest:           { ac: 2, dmax: 40, mat: "soft" },
  tacvest:        { ac: 2, dmax: 45, mat: "soft" },
  softinsert:     { ac: 2, dmax: 35, mat: "soft" },
  steelplate:     { ac: 4, dmax: 80, mat: "steel" },
  ceramicplate:   { ac: 5, dmax: 45, mat: "ceramic" },
  plate:          { ac: 2, dmax: 40, mat: "soft", carrier: true },
  scrapvest:      { ac: 3, dmax: 60, mat: "steel" },
  sheetvest:      { ac: 3, dmax: 70, mat: "steel" }, // metal-sheet armour (crafting.js, 2026-10-21)
  sheetarms:      { ac: 2, dmax: 24, mat: "steel" },
  sheetlegs:      { ac: 2, dmax: 24, mat: "steel" },
  tirevest:       { ac: 1, dmax: 25, mat: "padding" },
  sportspads:     { ac: 1, dmax: 20, mat: "padding" },
  padding:        { ac: 1, dmax: 12, mat: "padding" },
  shinguards:     { ac: 1, dmax: 12, mat: "padding" },
  kneeguards:     { ac: 1, dmax: 15, mat: "hard" },
  riotarms:       { ac: 2, dmax: 20, mat: "hard" },
  riotlegs:       { ac: 2, dmax: 20, mat: "hard" },
  bikehelmet:     { ac: 1, dmax: 20, mat: "hard" },
  footballhelmet: { ac: 1, dmax: 15, mat: "hard" },
  goaliemask:     { ac: 1, dmax: 14, mat: "hard" }, // data-shops.js: the sporting goods store
  riothelmet:     { ac: 2, dmax: 25, mat: "hard" },
  milhelmet:      { ac: 3, dmax: 30, mat: "hard" },
  rivethelmet:    { ac: 2, dmax: 16, mat: "steel" }, // a crafted riveted-plate helmet (craft books)
};
Object.assign(ARMOUR, SURV_ARMOUR); // survival gear (data-survival.js)

export const AR = {
  BLUNT: [1, 0.6, 0.45, 0.35, 0.3, 0.25, 0.2], // × a stopped hit by AC
  THRU: 0.9, THRU_HEAVY: 0.85, // × a hit that goes through (AC ≥ 4: heavy)
  P_MIN: 0.03, P_MAX: 0.97,
  WEAR: { ceramic: 1.3, steel: 0.5, soft: 1, hard: 0.8, padding: 1.5 }, // × durability lost by material
  BITE_AD: { ceramic: 0.2, steel: 0.2, hard: 0.2, soft: 0.8, padding: 0.8 }, // teeth and nails
  MELEE_AD: 0.5, ARROW_AD: 0.4,
  SHATTER: { share: 0.3, pen: 30, hits: 6 },
  SPALL: { chance: 0.3, lo: 3, hi: 6 },
  BACKER_COND: 0.5,
  // Hit locations (weights). Crits always land on the head.
  LOC: { shot: { torso: 55, head: 15, arms: 15, legs: 15 }, melee: { torso: 40, arms: 35, legs: 15, head: 10 } },
  // Penetration of what is not a bullet: arrows and bolts, blows by melee class (w.mclass, else MELEE_CLASS), a gun
  // butt, teeth and nails.
  PEN: { arrow: 12, blade: 12, pierce: 20, chop: 16, blunt: 4, heavy: 10, bash: 4, claws: 6, fists: 0 },
  MELEE_CLASS: { knife: "blade", machete: "blade", sawmachete: "blade", springmachete: "blade", sheetmachete: "blade", sheethatchet: "chop", pipespear: "pierce", spear: "pierce", fireaxe: "chop", bat: "blunt", spikedbat: "blunt", nailbat: "blunt", prybar: "blunt", baton: "blunt", sledge: "heavy", fists: "fists", claws: "claws" },
  RIFLE: ["556", "762x39", "308", "3030", "50bmg", "223", "300blk"], // calibres whose stopped round spalls off steel
  TOUGH: TRAIT_FX.TOUGH, // the Tough trait (traits.js)
  // By the numbers: a wound wears what is worn by dmg × OFFSCREEN × the enemy kind's typical round ad, by location.
  OFFSCREEN: 0.6,
  KIND_AD: { soldiers: 0.85, raiders: 0.55, fighters: 0.55, guards: 0.45, militia: 0.6, survivors: 0.45, zealots: 0.45, mixed: 0.5 },
  ENEMY_DUR: [0.5, 0.9], // an enemy's body armour starts at this share of its durability (their loot keeps what is left)
};
export const SLOT_LOC = { armor: "torso", head: "head", arms: "arms", legs: "legs" };
export const LOCS = ["torso", "head", "arms", "legs"];
const r2 = (v) => Math.round(v * 100) / 100;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---------- dice ----------
// A battle's own dice: hash01 of the battle's seed (the world rng's position when first used, never advancing it) and a
// counter saved with the battle. Deterministic for the same actions; the world's rng stream does not shift.
export function battleDice(b, tag) {
  if (b.dseed == null) b.dseed = b.rng && Number.isFinite(b.rng.state) ? b.rng.state : 0;
  b.diceN = (b.diceN || 0) + 1;
  return hash01("battledice", b.dseed, tag, b.diceN);
}

// ---------- pieces ----------
/** @returns {{ ac: number, dmax: number, mat: string, backer?: number } | null} */
export function armourSpec(key) {
  const d = GEAR[key];
  const A = ARMOUR[key];
  if (d && d.ac) return { ac: d.ac, dmax: d.dur || d.dmax || (A && A.dmax) || 30, mat: d.mat || d.material || (A && A.mat) || "soft", backer: d.backer ?? (A && A.backer) };
  if (!A) return null;
  return d && d.dur ? { ...A, dmax: d.dur } : A;
}
export const isArmourPiece = (item) => !!(item && armourSpec(item.key));
// Durability points left (an item from before gear had durability: dmax × its quality).
export function curDur(item) {
  const s = armourSpec(item.key);
  if (!s) return 0;
  if (item.dur != null) return Math.max(0, item.dur - (item.chip || 0));
  return r2(s.dmax * clamp01(item.quality ?? 1));
}
// Writes the dur of an old armour item (once) and returns the item.
export function ensureDur(item) {
  if (item && item.dur == null && armourSpec(item.key)) item.dur = Math.max(1, Math.round(curDur(item)));
  return item;
}
export const armourBroken = (item) => !!(item && (item.shattered || (item.dur != null && item.dur <= 0)));
// Condition 0–1 (dur / dmax) of an armour piece; null for anything that is not one.
export function armourCond(item) {
  const s = item && armourSpec(item.key);
  if (!s) return null;
  if (armourBroken(item)) return 0;
  return clamp01(curDur(item) / s.dmax);
}

// ---------- the numbers ----------
export const penChance = (pen, ac, cond = 1) => Math.max(AR.P_MIN, Math.min(AR.P_MAX, 0.5 + (pen - 10 * ac * (0.4 + 0.6 * cond)) / 20));
export const throughMult = (ac) => (ac >= 4 ? AR.THRU_HEAVY : AR.THRU);
export const bluntMult = (ac) => AR.BLUNT[Math.max(0, Math.min(6, Math.round(ac)))];
// Expected × damage of a hit with penetration pen on a piece (AC, condition).
export const pieceMult = (pen, ac, cond = 1) => { const p = penChance(pen, ac, cond); return p * throughMult(ac) + (1 - p) * bluntMult(ac); };

const ammoType = (cal, type) => (type && AMMO_TYPES[type] && CALIBERS[cal].types.includes(type) ? type : CALIBERS[cal].base);
// What struck: { cal, type, pen, ad, soft, rifle }. A shot reads hit.cal / hit.ammo (the ammo agent), else the
// shooter's u.load, else the calibre's base round. soft: × on a location with no armour, over the type's dmg × (which
// is already in the raw damage).
export function roundOf(by, hit) {
  const w = by && WEAPONS[by.weapon];
  if (hit && hit.how === "shot" && w) {
    const cal = hit.cal || w.cal;
    if (cal && CALIBERS[cal]) {
      const type = ammoType(cal, hit.ammo ?? by.load);
      const t = AMMO_TYPES[type];
      return { cal, type, pen: hit.pen ?? ammoPen(cal, type), ad: t.ad ?? CALIBERS[cal].ad, soft: (t.soft ?? 1) / (t.dmg ?? 1), rifle: AR.RIFLE.includes(cal) };
    }
    return { cal: null, type: null, pen: hit.pen ?? w.pen ?? AR.PEN.arrow, ad: AR.ARROW_AD, soft: 1, rifle: false };
  }
  const cls = hit && hit.how === "bash" ? "bash" : by && by.kind === "zombie" ? "claws" : (w && w.mclass) || AR.MELEE_CLASS[by && by.weapon] || "blunt";
  const pen = (hit && hit.pen) ?? (cls !== "bash" && w && w.pen != null ? w.pen : AR.PEN[cls] ?? 8);
  return { cal: null, type: null, pen, ad: cls === "claws" ? "bite" : AR.MELEE_AD, soft: 1, rifle: false };
}
const roundAd = (r, mat) => (r.ad === "bite" ? AR.BITE_AD[mat] ?? 0.5 : r.ad);

// Hits that land on a body part (fire, blasts, acid, traps keep the flat multiplier).
export const locatedHit = (hit) => !!(hit && (hit.how === "shot" || hit.how === "melee" || hit.how === "bash"));
const weights = (hit) => (hit && hit.how === "shot" ? AR.LOC.shot : AR.LOC.melee);
export function rollLoc(roll, hit) {
  if (hit && hit.crit) return "head";
  const W = weights(hit);
  let tot = 0;
  for (const l of LOCS) tot += W[l] || 0;
  let x = roll * tot;
  for (const l of LOCS) { x -= W[l] || 0; if (x < 0) return l; }
  return "torso";
}

// What protects a location: { spec, cond, piece, backer, label } or null. by: who struck (a carrier: the back plate
// when the blow comes from behind the way the wearer faces, t.face). shot: a hard hat (GEAR blunt) stops no bullet.
function guardAt(t, loc, by = null, shot = false) {
  const piece = t.pieces && t.pieces[loc];
  if (!piece) return null;
  const spec = armourSpec(piece.key);
  if (!spec) return null;
  if (shot && GEAR[piece.key] && GEAR[piece.key].blunt) return null;
  if (isCarrier(piece)) return carrierGuard(t, piece, spec, by);
  if (!armourBroken(piece)) return { spec, cond: armourCond(piece), piece, backer: false };
  if (spec.backer) return { spec: { ac: spec.backer, dmax: spec.dmax, mat: "soft" }, cond: AR.BACKER_COND, piece, backer: true };
  return null;
}
// From behind: the attacker is on the far side of the way the target faces.
export const fromBehind = (t, by) => !!(t && by && Array.isArray(t.face) && (t.face[0] || t.face[1]) && Number.isFinite(by.x) && ((by.x - t.x) * t.face[0] + (by.y - t.y) * t.face[1]) < 0);
// A plate carrier: the plate on that side while it holds, else the soft backer (the carrier's own durability).
function carrierGuard(t, piece, spec, by) {
  const side = fromBehind(t, by) ? "back" : "front";
  const ins = insertsOf(piece)[side];
  const is = ins && armourSpec(ins.key);
  if (is && !armourBroken(ins)) return { spec: is, cond: armourCond(ins), piece: ins, backer: false, label: `${side} plate` };
  if (!armourBroken(piece)) return { spec, cond: armourCond(piece), piece, backer: false, label: "plate carrier" };
  return null;
}
export const wears = (t) => !!(t && t.pieces && LOCS.some((l) => t.pieces[l]));
const pieceName = (p) => (p.name || (GEAR[p.key] ? GEAR[p.key].name : p.key)).toLowerCase();

// ---------- a hit ----------
// The located hit on a person (combat.js damage): { mult, extra, loc, through, msgs }. Wears the piece hit.
export function armourHit(b, t, raw, by, hit) {
  const tough = t.tough ?? 1;
  const r = roundOf(by, hit);
  const msgs = [];
  if (!wears(t) && r.soft === 1) return { mult: tough, extra: 0, loc: null, through: true, msgs }; // nothing to roll for
  const loc = rollLoc(hit.crit ? 0 : battleDice(b, "loc"), hit);
  // The face (helmets.js; section 18.5): of the head hits on someone wearing a helmet, FACE.SHARE land on the face.
  if (loc === "head" && t.pieces && t.pieces.head && battleDice(b, "face") < FACE.SHARE) return faceHit(b, t, raw, r, hit, msgs, tough);
  const g = guardAt(t, loc, by, hit.how === "shot");
  if (!g) return { mult: tough * r.soft, extra: 0, loc, through: true, msgs };
  const through = battleDice(b, "pen") < penChance(r.pen, g.spec.ac, g.cond);
  const mult = through ? throughMult(g.spec.ac) : bluntMult(g.spec.ac);
  let extra = 0;
  if (!through && g.spec.mat === "steel" && !g.backer && r.rifle && battleDice(b, "spall") < AR.SPALL.chance) {
    extra = AR.SPALL.lo + Math.floor(battleDice(b, "spalldmg") * (AR.SPALL.hi - AR.SPALL.lo + 1));
    msgs.push([`Steel spall off ${t.name}'s ${pieceName(g.piece)} (+${extra}).`, "info"]);
  }
  if (!through && loc === "head") msgs.push([`${t.name}'s ${pieceName(g.piece)} stops it.`, "info"]);
  if (!g.backer) wearPiece(g.piece, raw, r, through, t, msgs, g.label, b.wear ?? 1); // b.wear: the run's Durability loss dial (worldcfg.js battleDials)
  return { mult: mult * tough, extra: extra * tough, loc, through, piece: g.piece, msgs };
}

// A hit on the face (armourHit): what covers it (helmets.js faceOf: nothing with the visor up). Bites and blows: × the
// cover's FACE.SOFT, a bite wears it FACE.BITE_WEAR (a built-in visor: the helmet). Shots: a ballistic visor rolls its
// AC 3 like any piece (and cracks like ceramic: cracked, it covers nothing), a riot visor AC 1, a motorcycle visor or a
// football cage nothing. Uncovered: the whole hit (a soft point's bonus too).
function faceHit(b, t, raw, r, hit, msgs, tough) {
  const f = faceOf(t);
  const bare = { mult: tough * r.soft, extra: 0, loc: "head", face: true, through: true, msgs };
  if (!f || f.cracked) return bare;
  const cover = f.item || t.pieces.head;
  if (hit.how !== "shot") {
    if (r.ad === "bite") takeDur(cover, FACE.BITE_WEAR * (b.wear ?? 1));
    else wearPiece(cover, raw, r, false, t, msgs, null, b.wear ?? 1);
    return { mult: tough * (FACE.SOFT[f.kind] ?? 0.4), extra: 0, loc: "head", face: true, through: false, piece: cover, msgs };
  }
  const ac = f.kind === "ballistic" && f.item ? armourSpec(f.item.key).ac : f.kind === "riot" ? FACE.RIOT_AC : 0;
  if (!ac) return bare;
  const cond = f.item ? armourCond(f.item) ?? 1 : 1;
  const through = battleDice(b, "facepen") < penChance(r.pen, ac, cond);
  if (f.item) {
    wearPiece(f.item, raw, r, through, t, msgs, null, b.wear ?? 1);
    if (f.kind === "ballistic" && armourBroken(f.item)) msgs.push([`Visor cracked! ${t.name} can barely see through it.`, "danger"]);
  }
  if (!through) msgs.push([`${t.name}'s visor stops it.`, "info"]);
  return { mult: tough * (through ? throughMult(ac) : bluntMult(ac)), extra: 0, loc: "head", face: true, through, piece: f.item || null, msgs };
}

// Points off a piece (fractions kept in item.chip; whole points come off dur).
function takeDur(piece, loss) {
  ensureDur(piece);
  const tot = (piece.chip || 0) + loss;
  const whole = Math.floor(tot);
  piece.chip = r2(tot - whole);
  piece.dur = Math.max(0, piece.dur - whole);
  if (piece.dur <= 0) piece.chip = 0;
}
// Durability lost by one hit (wear), ceramic shattering, broken pieces. Returns the points lost.
export function wearPiece(piece, raw, r, through, t = null, msgs = null, label = null, mult = 1) { // mult: the run's Durability loss dial (worldcfg.js)
  const s = armourSpec(piece.key);
  if (!s || armourBroken(piece)) return 0;
  const loss = (raw * roundAd(r, s.mat) * (AR.WEAR[s.mat] ?? 1)) / 10 * (through ? 0.5 : 1) * mult;
  takeDur(piece, loss);
  const who = t ? `${t.name}'s ` : "";
  if (s.mat === "ceramic" && r.pen >= AR.SHATTER.pen && piece.dur > 0) {
    piece.hits30 = (piece.hits30 || 0) + 1;
    if (curDur(piece) < AR.SHATTER.share * s.dmax || piece.hits30 >= AR.SHATTER.hits) {
      piece.shattered = true; piece.dur = 0; piece.chip = 0;
      if (msgs) msgs.push([`${who}${label || (/plate/.test(piece.key) ? "front plate" : pieceName(piece))} shatters!`, "danger"]);
      return loss;
    }
  }
  if (piece.dur <= 0 && msgs) msgs.push([`${who}${label || pieceName(piece)} is broken!`, "danger"]);
  return loss;
}

// Expected × of a hit (the AI's sense of a shot, bestShot): over the locations, no dice, no wear.
export function armourExpect(t, by, hit) {
  const tough = t.tough ?? 1;
  const r = roundOf(by, hit);
  if (!wears(t) && r.soft === 1) return tough;
  const one = (loc) => { const g = guardAt(t, loc, by, !!hit && hit.how === "shot"); return g ? pieceMult(r.pen, g.spec.ac, g.cond) : r.soft; };
  if (hit && hit.crit) return tough * one("head");
  const W = weights(hit);
  let tot = 0, sum = 0;
  for (const l of LOCS) { tot += W[l] || 0; sum += (W[l] || 0) * one(l); }
  return tough * (tot ? sum / tot : 1);
}

// ---------- units ----------
// Your person's worn pieces, the items themselves (wear lands on them).
export function wornPieces(s) {
  const g = (s && s.gear) || {};
  /** @type {Record<string, any>} */
  const out = { torso: null, head: null, arms: null, legs: null };
  for (const [slot, loc] of Object.entries(SLOT_LOC)) if (g[slot] && armourSpec(g[slot].key)) out[loc] = ensureDur(migrateCarrier(g[slot]));
  for (const p of Object.values(insertsOf(g.armor))) if (p) ensureDur(p);
  return out;
}
// Tough × AR.TOUGH, Frail × 1.25 (traits.js woundMult: the one rule for wounds, on the map and off it).
export const toughOf = (s) => (s && s.traits ? woundMult(s) : 1);
// combat.js playerUnit / refitUnit: the pieces and the Tough (or Frail) trait on the battle unit.
export function fitArmour(u, s) {
  u.pieces = wornPieces(s);
  u.tough = toughOf(s);
}
// Everyone else's pieces (combat.js enemyUnit; else on first hit): their body armour (u.armorKey) at ENEMY_DUR of its
// durability (own dice).
export function enemyPieces(b, u) {
  if (!u || u.pieces !== undefined || u.kind !== "human" || u.side === "player") return u && u.pieces;
  // Armed from a group's arsenal (arsenal.js armFromArsenal): the issued pieces themselves, with their wear (they wear
  // as they are hit, and the body drops them as they are left).
  const ars = (u.arsArmour || []).filter((it) => it && armourSpec(it.key) && GEAR[it.key]);
  if (ars.length) {
    const SLOT = { armor: "torso", head: "head", arms: "arms", legs: "legs" };
    u.pieces = { torso: null, head: null, arms: null, legs: null };
    for (const it of ars) { const k = SLOT[GEAR[it.key].slot]; if (k && !u.pieces[k]) { ensureDur(it); u.pieces[k] = it; } }
    if (u.tough == null) u.tough = 1;
    return u.pieces;
  }
  const key = u.armorKey && armourSpec(u.armorKey) ? u.armorKey : null;
  const s = key ? armourSpec(key) : null;
  const seed = b && b.dseed != null ? b.dseed : b && b.rng ? b.rng.state : 0;
  const q = AR.ENEMY_DUR[0] + (AR.ENEMY_DUR[1] - AR.ENEMY_DUR[0]) * hash01("enemyarmour", seed, u.id, u.name);
  u.pieces = { torso: s ? { key, name: GEAR[key].name, dur: Math.max(1, Math.round(s.dmax * q)) } : null, head: null, arms: null, legs: null };
  // Their helmet by kit (helmets.js kitHeadgear: u.helmKey), its own durability roll (the body drops it as it is left).
  const hs = u.helmKey && GEAR[u.helmKey] ? armourSpec(u.helmKey) : null;
  if (hs) u.pieces.head = { key: u.helmKey, name: GEAR[u.helmKey].name, dur: Math.max(1, Math.round(hs.dmax * (AR.ENEMY_DUR[0] + (AR.ENEMY_DUR[1] - AR.ENEMY_DUR[0]) * hash01("enemyhelmet", seed, u.id, u.name)))) };
  if (u.pieces.torso && isCarrier(u.pieces.torso)) { // a carrier's plates (soldiers ceramic; anyone else now and then steel), as worn as it is
    const ik = u.kit === "soldiers" || hash01("enemyinsert", seed, u.id) < 0.7 ? "ceramicplate" : "steelplate";
    const plate = () => ({ key: ik, name: GEAR[ik].name, dur: Math.max(1, Math.round(GEAR[ik].dur * q)) });
    u.pieces.torso.inserts = { front: plate(), back: plate() };
  }
  if (u.tough == null) u.tough = 1;
  return u.pieces;
}
// The looted armour of an enemy body (inventory.js enemyBody): the dur its piece had left. False: it broke (no loot).
export function lootArmour(u, item) {
  const p = u && u.pieces && u.pieces.torso;
  if (!item || !p || p.key !== item.key) return true;
  if (armourBroken(p)) return false;
  item.dur = Math.min(itemDurMax(item) ?? p.dur, p.dur);
  if (p.chip) item.chip = p.chip;
  if (p.hits30) item.hits30 = p.hits30;
  if (isCarrier(item) && p.inserts) { // its plates as they were left: a shattered one is gone
    const ins = insertsOf(item);
    for (const side of ["front", "back"]) {
      const q = p.inserts[side], it = ins[side];
      if (!q || armourBroken(q)) { ins[side] = null; continue; }
      if (!it || it.key !== q.key) continue;
      it.dur = Math.min(itemDurMax(it) ?? q.dur, q.dur);
      if (q.hits30) it.hits30 = q.hits30;
    }
  }
  return true;
}
// After a battle (combat.js wearFielded): a worn piece that broke in the fight is gone, like any broken gear.
export function dropBroken(state, s) {
  for (const slot of ARMOR_SLOTS) {
    const it = s.gear[slot];
    if (!it || !armourSpec(it.key)) continue;
    if (isCarrier(it)) { // a broken plate is gone; a broken carrier is too, its whole plates kept (on them, else in storage)
      const ins = insertsOf(it);
      for (const side of ["front", "back"]) if (ins[side] && armourBroken(ins[side])) { log(state, `${s.name.split(" ")[0]}'s ${side} plate (${ins[side].name.toLowerCase()}) ${ins[side].shattered ? "shattered" : "broke"}: it needs replacing.`, "danger"); ins[side] = null; }
      if (!armourBroken(it)) continue;
      s.gear[slot] = null;
      const st = storageFor(state, personPlace(s));
      for (const side of ["front", "back"]) { const p = ins[side]; if (p && !stow(s, p) && st) st.list.push(p); ins[side] = null; }
      log(state, `${s.name.split(" ")[0]}'s ${it.name} broke.`, "danger");
      continue;
    }
    if (!armourBroken(it)) continue;
    s.gear[slot] = null;
    log(state, `${s.name.split(" ")[0]}'s ${it.name} ${it.shattered ? "shattered" : "broke"}.`, "danger");
  }
}

// ---------- off the map ----------
// A hurt person's armour after a fight by the numbers: dmg × OFFSCREEN × the kind's typical round ad (teeth and nails
// on the dead), split by the location weights of a shot (the dead: of a bite). A piece worn to 0 is gone (state: the
// log line). Returns the durability lost.
export function absorbOffscreen(s, dmg, enemyKind, state = null) {
  if (!s || !s.gear || !(dmg > 0)) return 0;
  const bite = enemyKind === "zombies" || enemyKind === "horde" || enemyKind === "dead";
  const W = bite ? AR.LOC.melee : AR.LOC.shot;
  let tot = 0;
  for (const l of LOCS) tot += W[l];
  let lost = 0;
  for (const [slot, loc] of Object.entries(SLOT_LOC)) {
    let it = s.gear[slot];
    if (isCarrier(it)) { const f = insertsOf(it).front; if (f && armourSpec(f.key) && !armourBroken(f)) it = f; } // the front plate takes it first
    const spec = it && armourSpec(it.key);
    if (!spec || armourBroken(it)) continue;
    const ad = bite ? AR.BITE_AD[spec.mat] ?? 0.5 : AR.KIND_AD[enemyKind] ?? 0.5;
    const loss = dmg * AR.OFFSCREEN * ad * (W[loc] / tot) * cfgOf(state, "wear"); // worldcfg.js: the run's Durability loss dial
    takeDur(it, loss);
    if (spec.mat === "ceramic" && !bite && ad >= 0.8 && it.dur > 0 && curDur(it) < AR.SHATTER.share * spec.dmax) { it.shattered = true; it.dur = 0; }
    lost += loss;
  }
  if (state) dropBroken(state, s);
  return lost;
}
// After a fight by the numbers (combat.js finishCombat): weapons, tools and anything else that wears lose a use as
// before (crafting.js wearSlot); armour pieces wear by their hits instead (absorbOffscreen, per-hit wear in battle).
export function wearByNumbers(state, people) {
  for (const s of people) {
    if (!s || !s.alive) continue;
    wearSlot(state, s, "weapon");
    for (const slot of ARMOR_SLOTS) if (s.gear[slot] && !armourSpec(s.gear[slot].key)) wearSlot(state, s, slot);
  }
}
// Damage taken × on a person off the map (world.js hurt): Tough and every worn piece (the flat model).
export const battleArmor = (s) => toughOf(s) * armorMult(s);
