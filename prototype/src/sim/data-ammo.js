// @ts-check
// Calibres, ammo types and boxes of rounds (docs/weapons-overhaul-plan.md sections 1, 2, 12 and the section 20
// decision: every calibre and type is its own box, common rounds included). Plain data that imports nothing; data.js
// merges AMMO_GEAR and RELOAD_GEAR into GEAR. Owner: the ammo agent (A) for CALIBERS / AMMO_TYPES / AMMO_GEAR /
// KIT_AMMO, the economy agent (C) for RELOAD_GEAR (brass, powder, primers). The armour agent (A2) reads pen / ad.
// A box is a count stack: GEAR `count: true`, item.dur = rounds left (valuation.js / inventory.js weigh and price it
// by the share left). Box keys: a_<cal>_<type>, e.g. a_9mm_fmj, a_12ga_slug, a_50bmg_api.

// kg: a round's weight. box: rounds in a box. pen: the calibre's base penetration (its FMJ / ball / 00 buck round).
// ad: how hard its FMJ round chews armour durability (section 17). value: one FMJ round.
/** @type {Record<string, { name: string, kg: number, box: number, pen: number, ad: number, value: number, base: string, types: string[] }>} */
export const CALIBERS = {
  "22lr":   { name: ".22 LR",           kg: 0.0035, box: 100, pen: 5,  ad: 0.3, value: 0.2,  base: "fmj",  types: ["fmj", "hp", "subsonic"] },
  "9mm":    { name: "9mm",              kg: 0.012,  box: 50,  pen: 15, ad: 0.4, value: 0.5,  base: "fmj",  types: ["fmj", "hp", "ap", "plusp", "subsonic"] },
  "45acp":  { name: ".45 ACP",          kg: 0.021,  box: 50,  pen: 14, ad: 0.45, value: 0.6, base: "fmj",  types: ["fmj", "hp", "subsonic"] },
  "357":    { name: ".357 Magnum",      kg: 0.015,  box: 50,  pen: 20, ad: 0.45, value: 0.6, base: "fmj",  types: ["fmj", "hp", "plusp"] },
  "12ga":   { name: "12 gauge",         kg: 0.04,   box: 25,  pen: 8,  ad: 0.3, value: 0.8,  base: "buck", types: ["buck", "slug", "bird"] },
  "556":    { name: "5.56 NATO",        kg: 0.012,  box: 30,  pen: 30, ad: 0.8, value: 0.7,  base: "fmj",  types: ["fmj", "ap", "match", "tracer"] },
  "762x39": { name: "7.62×39",          kg: 0.016,  box: 30,  pen: 32, ad: 0.8, value: 0.7,  base: "fmj",  types: ["fmj", "sp", "ap", "tracer"] },
  "308":    { name: ".308 / 7.62 NATO", kg: 0.025,  box: 20,  pen: 38, ad: 0.9, value: 1.0,  base: "fmj",  types: ["fmj", "sp", "ap", "match", "subsonic"] },
  "3030":   { name: ".30-30",           kg: 0.020,  box: 20,  pen: 25, ad: 0.6, value: 0.8,  base: "sp",   types: ["sp", "fmj"] },
  "50bmg":  { name: ".50 BMG",          kg: 0.115,  box: 10,  pen: 70, ad: 3,   value: 6,    base: "ball", types: ["ball", "api"] },
};

// Effects of a type on its calibre's FMJ. dmg: × damage; soft: × damage on a hit location with no armour (hollow and
// soft points); pen: absolute penetration by calibre (else the calibre's pen + penAdd); aim / opt / fallMult / close:
// shot odds; noise / jam: ×; ad: armour-durability factor (null: the calibre's); value: × the calibre's round value;
// spread: buckshot and birdshot (a shotgun's spread: catches a worm swarm, carriers.js swarmArmor); overpen: chance a
// hit that gets through carries on to the next unit in line (section 20, R6; .50 always); ignite: chance to set the
// target's tile alight. Section 1 table.
/** @type {Record<string, any>} */
export const AMMO_TYPES = {
  fmj:      { name: "FMJ",            dmg: 1,    soft: 1,    penAdd: 0,  value: 1,   overpen: { "308": 0.15, "762x39": 0.1, "556": 0.05 } },
  buck:     { name: "00 buckshot",    dmg: 1,    soft: 1,    penAdd: 0,  value: 1,   spread: true },
  ball:     { name: "ball",           dmg: 1,    soft: 1,    penAdd: 0,  value: 1,   overpen: { "50bmg": 1 } },
  hp:       { name: "hollow point",   dmg: 1,    soft: 1.2,  pen: { "22lr": 2, "9mm": 8, "45acp": 8, "357": 12 }, ad: 0.3, value: 1.6 },
  sp:       { name: "soft point",     dmg: 1,    soft: 1.12, pen: { "308": 30, "762x39": 25, "3030": 25 }, ad: 0.6, value: 1.5 },
  ap:       { name: "armour-piercing", dmg: 0.92, soft: 0.92, pen: { "9mm": 30, "556": 45, "762x39": 45, "308": 55 }, ad: 1.1, value: 2.8,
              overpen: { "308": 0.45, "762x39": 0.3, "556": 0.3, "9mm": 0.1 } },
  plusp:    { name: "+P",             dmg: 1.1,  soft: 1.1,  penAdd: 3,  aim: -2, noise: 1.1, jam: 1.2, ad: 0.45, value: 1.4 },
  subsonic: { name: "subsonic",       dmg: 0.9,  soft: 0.9,  penAdd: -2, opt: -1, noise: 0.75, noiseSuppressed: 0.6, jam: 1.1, ad: 0.35, value: 1.4 },
  match:    { name: "match",          dmg: 1,    soft: 1,    penAdd: 2,  aim: 6, opt: 1, fallMult: 0.85, jam: 0.8, ad: 0.8, value: 2 },
  tracer:   { name: "tracer",         dmg: 1,    soft: 1,    penAdd: -2, aim: 4, revealsShooter: true, ad: 0.8, value: 1.4 },
  slug:     { name: "slug",           dmg: 1.15, soft: 1.15, pen: { "12ga": 22 }, opt: 4, fallMult: 0.55, close: -8, ad: 0.9, value: 1.4 },
  bird:     { name: "birdshot",       dmg: 0.55, soft: 0.55, pen: { "12ga": 2 }, aim: 8, opt: -1, close: 6, ad: 0.15, value: 0.6, spread: true, swarm: 1.3 },
  api:      { name: "API",            dmg: 1.05, soft: 1.05, pen: { "50bmg": 75 }, ad: 3.2, value: 1.7, ignite: 0.25, overpen: { "50bmg": 1 } },
};

// Penetration of a calibre + type.
export function ammoPen(cal, type) {
  const c = CALIBERS[cal], t = AMMO_TYPES[type];
  if (!c) return 0;
  if (!t) return c.pen;
  if (t.pen && t.pen[cal] != null) return t.pen[cal];
  return c.pen + (t.penAdd || 0);
}
export const ammoKey = (cal, type) => `a_${cal}_${type}`;

// The boxes: one GEAR entry per calibre and type, built from the two tables above so they always agree. A box is the
// portable form of a supply of the same key (ROUND_SUPPLIES below): a box in a survivor's pockets or pack is theirs
// (a fight draws on it first: ammo.js roundsOf); one put in a base's armory or a team's cargo is opened into the
// stock (ammo.js settleBase / settleParty). Sources: merchants' wares (ammo.js WARE_AMMO), starting colonists.
/** @type {Record<string, any>} */
export const AMMO_GEAR = {};
export function ammoBoxes() {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [cal, c] of Object.entries(CALIBERS)) {
    for (const type of c.types) {
      const t = AMMO_TYPES[type];
      out[ammoKey(cal, type)] = {
      name: `${c.name} ${t.name}`, slot: "pack", skill: null, power: 0, req: 0, noise: 0, small: true, count: true,
      dur: c.box, weight: Math.round((c.kg * c.box + 0.05) * 100) / 100, value: Math.max(1, Math.round(c.value * t.value * c.box)),
      cat: "ammo", rounds: { cal, type },
      desc: `A box of ${c.box} ${c.name} ${t.name} rounds.`,
      };
    }
  }
  return out;
}
Object.assign(AMMO_GEAR, ammoBoxes());

// Rounds as a supply (section 20, R1: full per-calibre). Every calibre and type is its own supply key, the same key as
// its box: a base's stock, a team's supplies and cargo, a battle's pools and a body's or a container's finds hold
// rounds by key ({ a_9mm_fmj: 120, a_12ga_buck: 30 }). value and weight are per round. The old generic "ammo" key
// stays only as an abstract count: the AI groups' stores (f.stock.ammo), what a plan or a deal asks for ("40 ammo":
// packed or paid as the rounds that fit, ammo.js) and the by-the-numbers figures. data.js merges these into SUPPLIES.
/** @type {Record<string, { name: string, value: number, weight: number, cat: string, round: { cal: string, type: string } }>} */
export const ROUND_SUPPLIES = {};
for (const [cal, c] of Object.entries(CALIBERS)) {
  for (const type of c.types) {
    const t = AMMO_TYPES[type];
    ROUND_SUPPLIES[ammoKey(cal, type)] = { name: `${c.name} ${t.name}`, value: Math.round(c.value * t.value * 1000) / 1000, weight: c.kg, cat: "ammo", round: { cal, type } };
  }
}

// Where rounds of which kind turn up (weights by "cal_type"). A site type or raid area uses the first theme it has
// (ammo.js mixFor: military, police, prison, guns, hunt, farm, raider, else home); an AI group's stores (f.stock.ammo,
// abstract) are offered in trade by its kind's theme (KIND_MIX). Calibres with no gun yet still turn up (trade goods).
/** @type {Record<string, Record<string, number>>} */
export const AMMO_MIX = {
  military: { "556_fmj": 44, "556_ap": 8, "556_tracer": 4, "556_match": 2, "308_fmj": 12, "308_ap": 3, "308_match": 2, "9mm_fmj": 12, "12ga_buck": 6, "762x39_fmj": 3, "45acp_fmj": 2, "50bmg_ball": 1 },
  police:   { "9mm_fmj": 30, "9mm_hp": 14, "12ga_buck": 18, "12ga_slug": 8, "556_fmj": 14, "357_fmj": 5, "45acp_fmj": 4, "45acp_hp": 2, "9mm_ap": 1 },
  prison:   { "12ga_buck": 20, "9mm_fmj": 16, "556_fmj": 8, "12ga_slug": 4, "357_fmj": 2 },
  guns:     { "9mm_fmj": 14, "9mm_hp": 6, "9mm_plusp": 2, "9mm_subsonic": 1, "45acp_fmj": 5, "45acp_hp": 2, "357_fmj": 6, "357_hp": 2, "12ga_buck": 10, "12ga_slug": 4, "12ga_bird": 5,
              "22lr_fmj": 8, "22lr_hp": 2, "308_fmj": 6, "308_sp": 5, "308_subsonic": 1, "3030_sp": 6, "556_fmj": 6, "762x39_fmj": 3, "762x39_sp": 1 },
  hunt:     { "308_sp": 14, "308_fmj": 6, "3030_sp": 14, "12ga_bird": 10, "12ga_slug": 8, "12ga_buck": 6, "22lr_fmj": 10, "357_fmj": 3 },
  farm:     { "12ga_buck": 14, "12ga_bird": 14, "12ga_slug": 5, "22lr_fmj": 14, "3030_sp": 8, "308_sp": 4, "357_fmj": 3 },
  raider:   { "9mm_fmj": 22, "9mm_hp": 6, "12ga_buck": 16, "12ga_bird": 4, "556_fmj": 10, "762x39_fmj": 8, "357_fmj": 6, "45acp_fmj": 4, "308_fmj": 3, "3030_sp": 3 },
  home:     { "9mm_fmj": 20, "12ga_buck": 14, "22lr_fmj": 10, "357_fmj": 8, "45acp_fmj": 5, "9mm_hp": 3, "308_sp": 4, "3030_sp": 3, "12ga_bird": 4, "556_fmj": 3 },
};
// The AI groups by kind (data.js FACTION_TYPES): which theme their stores look like.
export const KIND_MIX = { military: "military", fortress: "police", expansionist: "police", raider: "raider", traders: "guns", commune: "farm", zealot: "home" };

// Starting colonists (ammo.js starterLoad, section 6): by calibre, the chance of a typed load and the box that comes
// with it (rounds). Never AP, API or match. A calibre not listed starts on its common round.
export const STARTER_AMMO = {
  "9mm":   [[0.2, "hp", 20]],
  "45acp": [[0.2, "hp", 20]],
  "357":   [[0.15, "hp", 12]],
  "12ga":  [[0.15, "bird", 10], [0.15, "slug", 5]],
  "308":   [[0.4, "sp", 10]],
  "762x39": [[0.3, "sp", 10]],
  "22lr":  [[0.3, "hp", 50]],
};

/** @type {Record<string, any>} brass, powder, primers (section 12; economy agent C, wave 2) */
export const RELOAD_GEAR = {};

// Enemy loads by kit and calibre class (section 6): weights per type. A type the calibre does not have falls back to
// the calibre's base. Never shown to the player (section 20, R10).
/** @type {Record<string, { pistol: Record<string, number>, rifle: Record<string, number>, shotgun: Record<string, number> }>} */
export const KIT_AMMO = {
  soldiers:  { pistol: { fmj: 0.8, hp: 0.2 },             rifle: { fmj: 0.6, ap: 0.35, tracer: 0.05 },          shotgun: { buck: 0.7, slug: 0.3 } },
  raiders:   { pistol: { fmj: 0.55, hp: 0.35, plusp: 0.1 }, rifle: { fmj: 0.75, sp: 0.15, ap: 0.05, tracer: 0.05 }, shotgun: { buck: 0.7, slug: 0.1, bird: 0.2 } },
  guards:    { pistol: { hp: 0.8, fmj: 0.2 },             rifle: { fmj: 0.7, ap: 0.1, sp: 0.2 },                shotgun: { buck: 0.6, slug: 0.4 } },
  militia:   { pistol: { fmj: 0.7, hp: 0.3 },             rifle: { sp: 0.7, fmj: 0.3 },                          shotgun: { slug: 0.5, buck: 0.4, bird: 0.1 } },
  survivors: { pistol: { fmj: 0.8, hp: 0.2 },             rifle: { sp: 0.5, fmj: 0.5 },                          shotgun: { buck: 0.6, bird: 0.3, slug: 0.1 } },
  zealots:   { pistol: { fmj: 0.6, hp: 0.4 },             rifle: { fmj: 0.8, sp: 0.2 },                          shotgun: { buck: 0.8, bird: 0.2 } },
  fighters:  { pistol: { fmj: 0.6, hp: 0.4 },             rifle: { fmj: 0.8, sp: 0.2 },                          shotgun: { buck: 0.7, slug: 0.2, bird: 0.1 } },
};
