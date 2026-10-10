// @ts-check
// Calibres, ammo types and boxes of rounds (docs/weapons-overhaul-plan.md sections 1, 2, 12 and the section 20
// decision: every calibre and type is its own box, common rounds included). Plain data that imports nothing; data.js
// merges AMMO_GEAR and RELOAD_GEAR into GEAR. Owner: the ammo agent (A) for CALIBERS / AMMO_TYPES / AMMO_GEAR /
// KIT_AMMO, the economy agent (C) for RELOAD_GEAR (brass, powder, primers). The armour agent (A2) reads pen / ad.
// A box is a count stack: GEAR `count: true`, item.dur = rounds left (valuation.js / inventory.js weigh and price it
// by the share left). Box keys: a_<cal>_<type>, e.g. a_9mm_fmj, a_12ga_slug, a_50bmg_api.
import { retailBox } from "./data-stacks.js"; // a box's size: typical US retail counts by calibre and load (data, no imports)

// kg: a round's weight. box: rounds in a box. pen: the calibre's base penetration (its FMJ / ball / 00 buck round).
// ad: how hard its FMJ round chews armour durability (section 17). value: one FMJ round.
// common: false = launcher rounds (40 mm grenades, rockets: section 13): their own supply keys and boxes, but never
// "ammo" in the abstract (rounds.js GENERIC_KEYS: no generic ammo settles into them, no plan or deal pays in them,
// no ammo bench makes them, an AI group's count never folds them in).
// aim: + to a shot's aim with this calibre's rounds, from any gun (.223: a lighter, more consistent load than 5.56).
/** @type {Record<string, { name: string, kg: number, box: number, pen: number, ad: number, value: number, base: string, types: string[], common?: boolean, dmg?: [number, number], aim?: number }>} */
export const CALIBERS = {
  "22lr":   { name: ".22 LR",           kg: 0.0035, box: 100, pen: 5,  ad: 0.3, value: 0.2,  base: "fmj",  types: ["fmj", "hp", "subsonic"] },
  "9mm":    { name: "9mm",              kg: 0.012,  box: 50,  pen: 15, ad: 0.4, value: 0.5,  base: "fmj",  types: ["fmj", "hp", "ap", "plusp", "subsonic", "rubber"] },
  "38spl":  { name: ".38 Special",      kg: 0.0125, box: 50,  pen: 12, ad: 0.4, value: 0.45, base: "fmj",  types: ["fmj", "hp", "plusp"] },
  "45acp":  { name: ".45 ACP",          kg: 0.021,  box: 50,  pen: 14, ad: 0.45, value: 0.6, base: "fmj",  types: ["fmj", "hp", "subsonic"] },
  "357":    { name: ".357 Magnum",      kg: 0.015,  box: 50,  pen: 20, ad: 0.45, value: 0.65, base: "fmj",  types: ["fmj", "hp", "plusp"] },
  "12ga":   { name: "12 gauge",         kg: 0.04,   box: 25,  pen: 8,  ad: 0.3, value: 0.8,  base: "buck", types: ["buck", "slug", "bird", "beanbag"] },
  "20ga":   { name: "20 gauge",         kg: 0.032,  box: 25,  pen: 6,  ad: 0.25, value: 0.6, base: "buck", types: ["buck", "slug", "bird"] },
  "223":    { name: ".223 Rem",         kg: 0.012,  box: 20,  pen: 26, ad: 0.7, value: 0.6,  base: "fmj",  types: ["fmj", "sp", "match"], aim: 3 },
  "556":    { name: "5.56 NATO",        kg: 0.012,  box: 30,  pen: 30, ad: 0.8, value: 0.7,  base: "fmj",  types: ["fmj", "ap", "match", "tracer", "rubber"] },
  "300blk": { name: ".300 Blackout",    kg: 0.015,  box: 20,  pen: 28, ad: 0.75, value: 0.95, base: "fmj", types: ["fmj", "subsonic", "hp"] },
  "762x39": { name: "7.62×39",          kg: 0.016,  box: 30,  pen: 32, ad: 0.8, value: 0.7,  base: "fmj",  types: ["fmj", "sp", "ap", "tracer"] },
  "308":    { name: ".308 / 7.62 NATO", kg: 0.025,  box: 20,  pen: 38, ad: 0.9, value: 1.0,  base: "fmj",  types: ["fmj", "sp", "ap", "match", "subsonic", "rubber"] },
  "3030":   { name: ".30-30",           kg: 0.020,  box: 20,  pen: 25, ad: 0.6, value: 0.8,  base: "sp",   types: ["sp", "fmj"] },
  "50bmg":  { name: ".50 BMG",          kg: 0.115,  box: 10,  pen: 70, ad: 3,   value: 6,    base: "ball", types: ["ball", "api"] },
  // Launcher rounds (section 13; launchers.js fires them): a box of six 40 mm grenades, one rocket a "box".
  "40mm":   { name: "40 mm",            kg: 0.23,   box: 6,   pen: 20, ad: 2,   value: 15,   base: "he",   types: ["he", "buck", "smoke", "illum"], common: false },
  "rocket": { name: "Rocket",           kg: 2.6,    box: 1,   pen: 90, ad: 5,   value: 60,   base: "heat", types: ["heat"], common: false },
};
// The damage ladder (docs/weapons-overhaul-plan.md "Balance ladder 2026-10-10"; user, 2026-10-10: ".22 is not
// outclassing any other ammo and .50 does the most damage; 5.56 is closer to .22 than .308; 12ga is the middle but
// slugs are better than .308"). A calibre's reference damage a hit, [lo, hi], its base round from a typical gun: every
// gun of that calibre has its WEAPONS dmg within LADDER.BAND of it (a long barrel a little more, a snub or a zip gun a
// little less), and a type's dmg / soft (AMMO_TYPES) move it from there. tools/arsenalbalancetest.js checks the order.
/** @type {Record<string, [number, number]>} */
export const CAL_DMG = {
  "22lr": [11, 17], "9mm": [15, 22], "38spl": [16, 23], "45acp": [18, 26], "357": [19, 29], "223": [21, 28], "20ga": [20, 30], "556": [22, 30],
  "300blk": [23, 32], "762x39": [24, 34], "12ga": [24, 36], "3030": [25, 35], "308": [34, 46], "50bmg": [62, 84],
};
for (const [cal, d] of Object.entries(CAL_DMG)) CALIBERS[cal].dmg = d;
// The ladder's order (lowest first, by the base round's damage on an unarmoured target) and the band a gun's own
// damage keeps to around its calibre's (mounted guns aside: the M2's belt is a turret's number).
export const LADDER = {
  ORDER: ["22lr", "9mm", "38spl", "45acp", "357", "223", "20ga", "556", "300blk", "762x39", "12ga", "3030", "308", "50bmg"],
  BAND: [0.85, 1.15],
};

// ---------- which rounds go in which guns (2026-10-10, user: ".223 works in 5.56 guns and magazines"; "300 blackout
// cannot be used in 223 or 556 guns"; "223 guns only take 223 and not 556"; .357 guns take .38 Special) ----------
// A gun is chambered for one calibre (WEAPONS cal) and takes the rounds of CAL_ACCEPTS[cal], its own first (a gun's
// own `cals` list overrides it: the gas-operated Magnum pistol cycles .357 only). A magazine holds the calibres of its
// `cals` (data-kit.js MAGAZINES; else CAL_ACCEPTS of its cal): a STANAG magazine holds 5.56, .223 and .300 BLK alike,
// so the gun's chamber decides (a 5.56 gun refuses .300 BLK from a STANAG magazine: CAL_REFUSE). A load of another
// calibre than the holder's own (a gun's, a magazine's) is written "<cal>:<type>" (rounds.js loadParts): a 5.56 gun
// loaded with .223 soft points has load "223:sp" and fires .223 numbers (ammo.js loadFx: its damage × CAL_DMG of .223
// over 5.56's, and .223's aim).
/** @type {Record<string, string[]>} */
export const CAL_ACCEPTS = { "556": ["556", "223"], "357": ["357", "38spl"] };
// The calibres a gun (a WEAPONS entry) takes, its own first.
/** @param {any} w @returns {string[]} */
export const gunCalList = (w) => (!w || !w.cal ? [] : Array.isArray(w.cals) && w.cals.length ? w.cals : CAL_ACCEPTS[w.cal] || [w.cal]);
// Why a gun chambered for `own` refuses a round of `cal` ("cal>own"; else ammo.js calRefusal's general words).
/** @type {Record<string, string>} */
export const CAL_REFUSE = {
  "300blk>556": "A .300 Blackout round fits the 5.56 magazine but not the barrel: chambered in a 5.56 gun it can blow the gun apart. Refused.",
  "300blk>223": "A .300 Blackout round fits the magazine but not a .223 barrel: chambered there it can blow the gun apart. Refused.",
  "556>223": "5.56 NATO runs too hot for a gun chambered in .223 Remington: the pressure can wreck it. Refused.",
  "556>300blk": "5.56 does not fit a .300 Blackout chamber. Refused.",
  "223>300blk": ".223 does not fit a .300 Blackout chamber. Refused.",
  "357>38spl": ".357 Magnum is too long for a .38 Special cylinder, and too hot. Refused.",
};
// The share of a kind of fighter's rounds that are another calibre their gun takes (ammo.js enemyLoad, AI parity):
// civilian .223 in a 5.56 rifle, .38 Special in a .357 revolver. By kit, then by the other calibre.
/** @type {Record<string, Record<string, number>>} */
export const KIT_ALT_CAL = {
  raiders:   { "223": 0.3, "38spl": 0.35 },
  militia:   { "223": 0.4, "38spl": 0.3 },
  survivors: { "223": 0.4, "38spl": 0.45 },
  zealots:   { "223": 0.3, "38spl": 0.4 },
  fighters:  { "223": 0.2, "38spl": 0.3 },
  guards:    { "223": 0.1, "38spl": 0.4 },
};

// Effects of a type on its calibre's FMJ. dmg: × damage; soft: × damage on a hit location with no armour (hollow and
// soft points); pen: absolute penetration by calibre (else the calibre's pen + penAdd); aim / opt / fallMult / close:
// shot odds; noise / jam: ×; ad: armour-durability factor (null: the calibre's); value: × the calibre's round value;
// spread: buckshot and birdshot (a shotgun's spread: catches a worm swarm, carriers.js swarmArmor); overpen: chance a
// hit that gets through carries on to the next unit in line (section 20, R6; .50 always); ignite: chance to set the
// target's tile alight. Section 1 table.
/** @type {Record<string, any>} */
export const AMMO_TYPES = {
  fmj:      { name: "FMJ",            dmg: 1,    soft: 1,    penAdd: 0,  value: 1,   overpen: { "308": 0.15, "762x39": 0.1, "300blk": 0.08, "556": 0.05, "223": 0.04 } },
  buck:     { name: "00 buckshot",    dmg: 1,    soft: 1,    penAdd: 0,  value: 1,   spread: true },
  ball:     { name: "ball",           dmg: 1,    soft: 1,    penAdd: 0,  value: 1,   overpen: { "50bmg": 1 } },
  hp:       { name: "hollow point",   dmg: 1,    soft: 1.2,  pen: { "22lr": 2, "9mm": 8, "38spl": 7, "45acp": 8, "357": 12, "300blk": 14 }, ad: 0.3, value: 1.6 },
  sp:       { name: "soft point",     dmg: 1,    soft: 1.12, pen: { "308": 30, "762x39": 25, "3030": 25, "223": 20 }, ad: 0.6, value: 1.5 },
  ap:       { name: "armour-piercing", dmg: 0.92, soft: 0.92, pen: { "9mm": 30, "556": 45, "762x39": 45, "308": 55 }, ad: 1.1, value: 2.8,
              overpen: { "308": 0.45, "762x39": 0.3, "556": 0.3, "9mm": 0.1 } },
  plusp:    { name: "+P",             dmg: 1.1,  soft: 1.1,  penAdd: 3,  aim: -2, noise: 1.1, jam: 1.2, ad: 0.45, value: 1.4 },
  subsonic: { name: "subsonic",       dmg: 0.9,  soft: 0.9,  penAdd: -2, opt: -1, noise: 0.75, noiseSuppressed: 0.6, jam: 1.1, ad: 0.35, value: 1.4 },
  match:    { name: "match",          dmg: 1,    soft: 1,    penAdd: 2,  aim: 6, opt: 1, fallMult: 0.85, jam: 0.8, ad: 0.8, value: 2 },
  tracer:   { name: "tracer",         dmg: 1,    soft: 1,    penAdd: -2, aim: 4, revealsShooter: true, ad: 0.8, value: 1.4 },
  // A slug: one heavy lead ball (the ladder: a 12 gauge slug outhits any .308 round on an unarmoured target, but its
  // soft lead goes through less armour: pen 22 against the .308's 38).
  slug:     { name: "slug",           dmg: 1.55, soft: 1.55, pen: { "12ga": 22, "20ga": 16 }, opt: 4, fallMult: 0.55, close: -8, ad: 0.9, value: 1.4 },
  bird:     { name: "birdshot",       dmg: 0.6,  soft: 0.6,  pen: { "12ga": 2, "20ga": 1 }, aim: 8, opt: -1, close: 6, ad: 0.15, value: 0.6, spread: true, swarm: 1.3 },
  // Less-lethal (the non-lethal branch reads hit.nonLethal: a knock-out, not a kill): police and prison stock only,
  // never a starting load, never common.
  beanbag:  { name: "beanbag",        dmg: 0.5,  soft: 0.5,  pen: { "12ga": 2 }, opt: -1, close: 4, ad: 0.1, value: 1.3, nonlethal: true },
  rubber:   { name: "rubber",         dmg: 0.45, soft: 0.45, pen: { "9mm": 1, "556": 2, "308": 3 }, ad: 0.1, value: 1.2, nonlethal: true },
  api:      { name: "API",            dmg: 1.05, soft: 1.05, pen: { "50bmg": 75 }, ad: 3.2, value: 1.7, ignite: 0.25, overpen: { "50bmg": 1 } },
  // Launcher rounds (launchers.js LAUNCH_ROUNDS says what each does where it lands). buck: the 40 mm canister is the
  // 12 gauge's buckshot type (a shotgun shot at a unit); its value is set below (LAUNCH_VALUE).
  he:       { name: "HE",             dmg: 1,    soft: 1,    penAdd: 0,  value: 1,   launch: true },
  smoke:    { name: "smoke",          dmg: 1,    soft: 1,    penAdd: 0,  value: 0.67, launch: true },
  illum:    { name: "illumination",   dmg: 1,    soft: 1,    penAdd: 0,  value: 0.4, launch: true },
  heat:     { name: "HEAT",           dmg: 1,    soft: 1,    penAdd: 0,  value: 1,   launch: true },
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

// What each round is worth and how common it is (user, 2026-10-10: "make ammo rarity and value based on the round";
// "5.56, .308, .22, 12ga are some of the most common rounds found; rounds that deal more damage and the rarer variants
// of each calibre are also rarer"). "cal_type": [rarity tier, value a round]. The value prices the boxes, the supply
// (trade, Customize points: custompoints.js through SUPPLIES); the tier weighs where rounds turn up (AMMO_MIX below:
// RARITY_FIND × a place's calibres × what it stocks). Handloads are HAND_VALUE of their factory round.
export const RARITY = ["common", "uncommon", "scarce", "rare", "veryrare"];
export const RARITY_NAME = { common: "common", uncommon: "uncommon", scarce: "scarce", rare: "rare", veryrare: "very rare" };
export const RARITY_FIND = { common: 1, uncommon: 0.45, scarce: 0.18, rare: 0.06, veryrare: 0.02 };
/** @type {Record<string, [string, number]>} */
export const ROUND_ECON = {
  "22lr_fmj": ["common", 0.2], "22lr_hp": ["uncommon", 0.3], "22lr_subsonic": ["uncommon", 0.28],
  "9mm_fmj": ["common", 0.5], "9mm_hp": ["uncommon", 0.75], "9mm_plusp": ["scarce", 0.7], "9mm_subsonic": ["scarce", 0.7], "9mm_rubber": ["scarce", 0.55], "9mm_ap": ["rare", 1.4],
  "45acp_fmj": ["uncommon", 0.6], "45acp_hp": ["scarce", 0.95], "45acp_subsonic": ["scarce", 0.85],
  "357_fmj": ["uncommon", 0.65], "357_hp": ["scarce", 1.0], "357_plusp": ["rare", 1.0],
  "38spl_fmj": ["common", 0.45], "38spl_hp": ["uncommon", 0.7], "38spl_plusp": ["scarce", 0.65],
  "223_fmj": ["common", 0.6], "223_sp": ["uncommon", 0.8], "223_match": ["scarce", 1.25],
  "300blk_fmj": ["scarce", 1.0], "300blk_subsonic": ["rare", 1.4], "300blk_hp": ["rare", 1.3],
  "20ga_buck": ["uncommon", 0.6], "20ga_bird": ["uncommon", 0.35], "20ga_slug": ["scarce", 1.0],
  "556_fmj": ["common", 0.7], "556_tracer": ["scarce", 0.95], "556_match": ["scarce", 1.4], "556_rubber": ["rare", 0.85], "556_ap": ["rare", 1.95],
  "762x39_fmj": ["uncommon", 0.7], "762x39_sp": ["scarce", 1.0], "762x39_tracer": ["scarce", 0.95], "762x39_ap": ["rare", 1.95],
  "12ga_buck": ["common", 0.8], "12ga_bird": ["common", 0.45], "12ga_slug": ["uncommon", 1.4], "12ga_beanbag": ["rare", 1.05],
  "3030_sp": ["uncommon", 0.8], "3030_fmj": ["scarce", 0.8],
  "308_fmj": ["common", 1.0], "308_sp": ["common", 1.3], "308_match": ["scarce", 2.0], "308_subsonic": ["rare", 1.5], "308_rubber": ["veryrare", 1.2], "308_ap": ["veryrare", 2.8],
  "50bmg_ball": ["rare", 6], "50bmg_api": ["veryrare", 10],
  "40mm_he": ["veryrare", 15], "40mm_buck": ["veryrare", 8], "40mm_smoke": ["veryrare", 10], "40mm_illum": ["veryrare", 6], "rocket_heat": ["veryrare", 60],
};
// A round's tier and value (a calibre or type missing from the table: the old rule, calibre × type value).
export const roundTier = (cal, type) => (ROUND_ECON[`${cal}_${type}`] || [])[0] || (AMMO_TYPES[type] && AMMO_TYPES[type].launch ? "veryrare" : "scarce");
export const roundValue = (cal, type) => { const e = ROUND_ECON[`${cal}_${type}`]; return e ? e[1] : CALIBERS[cal].value * ((AMMO_TYPES[type] && AMMO_TYPES[type].value) || 1); };

// The boxes: one GEAR entry per calibre and type, built from the two tables above so they always agree. A box is the
// portable form of a supply of the same key (ROUND_SUPPLIES below): a box in a survivor's pockets or pack is theirs
// (a fight draws on it first: ammo.js roundsOf); one put in a base's armory or a team's cargo is opened into the
// stock (ammo.js settleBase / settleParty). Made by starting colonists' loads (ammo.js starterLoad).
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
      dur: c.box, weight: Math.round((c.kg * c.box + 0.05) * 100) / 100, value: Math.max(1, Math.round(roundValue(cal, type) * c.box)),
      cat: "ammo", rounds: { cal, type },
      desc: `A box of ${c.box} ${c.name} ${t.name} rounds.`,
      ...(c.common === false ? { common: false } : {}),
      };
    }
  }
  return out;
}
Object.assign(AMMO_GEAR, ammoBoxes());
// The launcher rounds' own looks and prices (section 13 table: per round 40 mm HE 15, buckshot 8, smoke 10,
// illumination 6, a rocket 60): a box of 40 mm is six grenades, a rocket is one round and bulky.
/** @type {Record<string, number>} */
export const LAUNCH_VALUE = { a_40mm_he: 15, a_40mm_buck: 8, a_40mm_smoke: 10, a_40mm_illum: 6, a_rocket_heat: 60 };
const LAUNCH_DESC = {
  a_40mm_he: "Six high-explosive 40 mm grenades for a grenade launcher (an M79, an M32, an M203 under an assault rifle).",
  a_40mm_buck: "Six 40 mm canister rounds: a giant shotgun shell fired at someone close.",
  a_40mm_smoke: "Six 40 mm smoke grenades: a cloud where they land, lobbed over walls.",
  a_40mm_illum: "Six 40 mm parachute flares: light a wide patch of ground for a few turns.",
  a_rocket_heat: "A HEAT rocket for the reloadable rocket launcher (RPG). Heavy and bulky.",
};
for (const [k, v] of Object.entries(LAUNCH_VALUE)) {
  const box = AMMO_GEAR[k];
  if (!box) continue;
  box.value = Math.max(1, Math.round(v * box.dur));
  box.desc = LAUNCH_DESC[k] || box.desc;
  if (k === "a_rocket_heat") { box.small = false; box.bulky = true; }
}

// Rounds as a supply (section 20, R1: full per-calibre). Every calibre and type is its own supply key, the same key as
// its box: a base's stock, a team's supplies and cargo, a battle's pools and a body's or a container's finds hold
// rounds by key ({ a_9mm_fmj: 120, a_12ga_buck: 30 }). value and weight are per round. The old generic "ammo" key
// stays only as an abstract count: the AI groups' stores (f.stock.ammo), what a plan or a deal asks for ("40 ammo":
// packed or paid as the rounds that fit, ammo.js) and the by-the-numbers figures. data.js merges these into SUPPLIES.
/** @type {Record<string, { name: string, value: number, weight: number, cat: string, round: { cal: string, type: string, hand?: boolean }, common?: boolean, tier?: string }>} */
export const ROUND_SUPPLIES = {};
for (const [cal, c] of Object.entries(CALIBERS)) {
  for (const type of c.types) {
    const t = AMMO_TYPES[type];
    ROUND_SUPPLIES[ammoKey(cal, type)] = { name: `${c.name} ${t.name}`, value: LAUNCH_VALUE[ammoKey(cal, type)] ?? Math.round(roundValue(cal, type) * 1000) / 1000, tier: roundTier(cal, type), weight: c.kg, cat: "ammo", round: { cal, type }, ...(c.common === false ? { common: false } : {}) };
  }
}

// Where rounds of which kind turn up (weights by "cal_type"). A site type or raid area uses the first theme it has
// (ammo.js mixFor: military, police, prison, guns, hunt, farm, raider, else home); an AI group's stores (f.stock.ammo,
// abstract) are offered in trade by its kind's theme (KIND_MIX). Each weight is the place's share of a calibre
// (THEME_CALS) × the round's rarity (ROUND_ECON tier, RARITY_FIND) × what the place stocks of that type (THEME_TYPES:
// a police armoury its hollow points and beanbags, a hunting lodge its soft points and birdshot; 0: never there).
/** @type {Record<string, Record<string, number>>} */
export const THEME_CALS = {
  // (.223, .38 Special and .300 BLK, 2026-10-10: .223 as common as 5.56 but civilian, more of it in gun stores, farms
  // and homes, little in an armoury; .38 a home and police round; .300 BLK scarce everywhere)
  military: { "556": 50, "308": 16, "9mm": 12, "12ga": 6, "762x39": 3, "45acp": 3, "50bmg": 14, "300blk": 2 },
  police:   { "9mm": 34, "12ga": 26, "556": 14, "357": 8, "45acp": 9, "308": 2, "38spl": 6, "223": 3, "300blk": 1 },
  prison:   { "12ga": 30, "9mm": 18, "556": 8, "357": 3, "308": 2, "38spl": 3 },
  guns:     { "9mm": 16, "12ga": 18, "22lr": 14, "308": 14, "556": 10, "45acp": 7, "357": 8, "3030": 7, "762x39": 4, "20ga": 6, "223": 12, "38spl": 6, "300blk": 3 },
  hunt:     { "308": 26, "3030": 16, "12ga": 18, "22lr": 14, "20ga": 6, "357": 3, "762x39": 1, "223": 9, "38spl": 1, "300blk": 2 },
  farm:     { "12ga": 30, "22lr": 22, "20ga": 8, "3030": 10, "308": 6, "357": 3, "223": 8, "38spl": 3 },
  raider:   { "9mm": 26, "12ga": 18, "556": 12, "762x39": 9, "357": 6, "45acp": 5, "308": 4, "22lr": 4, "3030": 3, "223": 5, "38spl": 4, "300blk": 1 },
  home:     { "9mm": 20, "12ga": 16, "22lr": 14, "357": 8, "308": 6, "45acp": 5, "556": 4, "3030": 3, "20ga": 3, "223": 6, "38spl": 8, "300blk": 1 },
};
/** @type {Record<string, Record<string, number>>} */
export const THEME_TYPES = {
  military: { hp: 0, sp: 0, bird: 0, beanbag: 0, rubber: 0, plusp: 0, ap: 1.5, tracer: 0.5, match: 1, subsonic: 0.3, slug: 0.6 },
  police:   { hp: 2.5, beanbag: 8, rubber: 3, ap: 0.5, bird: 0.2, slug: 0.8, sp: 0.5, match: 0.5, tracer: 0, subsonic: 0.3, plusp: 0.5 },
  prison:   { beanbag: 10, rubber: 4, bird: 0.2, ap: 0.2, sp: 0.3, tracer: 0, match: 0, subsonic: 0, plusp: 0 },
  guns:     { tracer: 0.3, rubber: 0, beanbag: 0, ap: 0.3 },
  hunt:     { sp: 3, bird: 1.5, slug: 1.5, fmj: 0.5, hp: 1.5, tracer: 0, ap: 0, rubber: 0, beanbag: 0, match: 0.5, subsonic: 0.5, plusp: 0.5 },
  farm:     { bird: 1.5, sp: 2, fmj: 0.8, ap: 0, tracer: 0, match: 0, rubber: 0, beanbag: 0, subsonic: 0.3, plusp: 0 },
  raider:   { ap: 0.3, beanbag: 0, rubber: 0, match: 0.3, subsonic: 0.5 },
  home:     { ap: 0, tracer: 0, match: 0.2, rubber: 0, beanbag: 0, subsonic: 0.5, plusp: 0.5 },
};
/** @param {string} theme @param {string} cal @param {string} type */
export const mixWeight = (theme, cal, type) => {
  const tt = THEME_TYPES[theme] || {};
  return Math.round((THEME_CALS[theme][cal] || 0) * RARITY_FIND[roundTier(cal, type)] * (tt[type] ?? 1) * 100) / 100;
};
/** @type {Record<string, Record<string, number>>} */
export const AMMO_MIX = {};
for (const theme of Object.keys(THEME_CALS)) {
  /** @type {Record<string, number>} */
  const m = {};
  for (const cal of Object.keys(THEME_CALS[theme])) for (const type of CALIBERS[cal].types) { const w = mixWeight(theme, cal, type); if (w > 0) m[`${cal}_${type}`] = w; }
  AMMO_MIX[theme] = m;
}
// The AI groups by kind (data.js FACTION_TYPES): which theme their stores look like.
export const KIND_MIX = { military: "military", fortress: "police", expansionist: "police", raider: "raider", traders: "guns", commune: "farm", zealot: "home" };

// Starting colonists (ammo.js starterLoad, section 6): by calibre, the chance of a typed load and the box that comes
// with it (rounds). Never AP, API or match. A calibre not listed starts on its common round.
export const STARTER_AMMO = {
  "9mm":   [[0.2, "hp", 20]],
  "45acp": [[0.2, "hp", 20]],
  "357":   [[0.15, "hp", 12]],
  "38spl": [[0.2, "hp", 20]],
  "223":   [[0.2, "sp", 20]],
  "300blk": [[0.25, "subsonic", 20]],
  "12ga":  [[0.15, "bird", 10], [0.15, "slug", 5]],
  "20ga":  [[0.15, "bird", 10], [0.1, "slug", 5]],
  "308":   [[0.4, "sp", 10]],
  "762x39": [[0.3, "sp", 10]],
  "22lr":  [[0.3, "hp", 50]],
};

// ---------- the reloading bench (section 12; wave 2, agent C2: reloading.js) ----------
// What a reloading bench can load, by calibre class: [Mechanics needed, rounds per operator-day] (+4% a day per
// Mechanics point). .22 LR is rimfire (no primer to replace) and .50 BMG is not craftable; neither are tracers,
// +P or the less-lethal rounds. AP needs a machine shop at the base and a machine part per 20 (steel cores).
export const LOAD_CLASS = { "9mm": "pistol", "45acp": "pistol", "357": "pistol", "12ga": "shotgun", "20ga": "shotgun", "556": "rifle", "762x39": "rifle", "308": "rifle", "3030": "rifle",
  "38spl": "pistol", "223": "rifle", "300blk": "rifle" };
/** @type {Record<string, Record<string, [number, number]>>} */
export const LOADS = {
  pistol:  { fmj: [2, 40], hp: [5, 30], subsonic: [6, 25], ap: [10, 10] },
  rifle:   { fmj: [3, 25], sp: [3, 25], subsonic: [6, 25], match: [9, 15], ap: [10, 10] },
  shotgun: { buck: [1, 25], bird: [1, 25], slug: [1, 15] },
};
// Powder charges (the powder supply's unit: one pistol load; a 1 lb can holds 100) per 10 rounds by class: a can
// loads 100 pistol, 40 rifle or 60 shotgun rounds.
export const POWDER_PER10 = { pistol: 10, rifle: 25, shotgun: 100 / 6 };
// A handload's effects in a fight (gunfire.js ammoJam, combat.js shotOdds, stealth.js shotNoise): aim −AIM when loaded
// below Mechanics AIM_BELOW; black powder: jam × BLACK_JAM and BLACK_NOISE more noise a shot; match-head primers:
// misfires and jams × MATCH_JAM.
export const RELOAD_FX = { AIM_BELOW: 8, AIM: 1, BLACK_JAM: 1.5, BLACK_NOISE: 1, MATCH_JAM: 3 };
// Can this calibre and type be loaded at the bench? [min, rate] or null.
/** @param {string} cal @param {string} type */
export const loadRecipe = (cal, type) => (LOAD_CLASS[cal] && CALIBERS[cal] && CALIBERS[cal].types.includes(type) && LOADS[LOAD_CLASS[cal]][type]) || null;
// Handloads: a round loaded at the bench is a supply of its own key (a_9mm_hp_hand), so its make travels with it
// through every stock, pack, cargo, trade and pool exactly like a factory round. The base type of a calibre (FMJ,
// 00 buck) loaded with smokeless powder and factory primers goes into the factory key (quality-less, so the economy
// sees it); anything else made at the bench (a typed round, or any round with black powder or match-head primers)
// is a handload. Their make (quality, black powder, match primers) is a colony-wide average per key (reloading.js).
/** @param {string} cal @param {string} type */
export const handKey = (cal, type) => `a_${cal}_${type}_hand`;
export const HAND_VALUE = 0.75; // × the factory round's worth
/** @type {Record<string, { name: string, value: number, weight: number, cat: string, round: { cal: string, type: string, hand: true } }>} */
export const HAND_SUPPLIES = {};
/** @type {Record<string, any>} */
export const HAND_GEAR = {};
for (const [cal, c] of Object.entries(CALIBERS)) {
  for (const type of c.types) {
    if (!loadRecipe(cal, type)) continue;
    const t = AMMO_TYPES[type], k = handKey(cal, type);
    HAND_SUPPLIES[k] = { name: `${c.name} ${t.name} (handload)`, value: Math.round(roundValue(cal, type) * HAND_VALUE * 1000) / 1000, weight: c.kg, cat: "ammo", round: { cal, type, hand: true } };
    HAND_GEAR[k] = {
      name: `${c.name} ${t.name} handloads`, slot: "pack", skill: null, power: 0, req: 0, noise: 0, small: true, count: true,
      dur: c.box, weight: Math.round((c.kg * c.box + 0.05) * 100) / 100, value: Math.max(1, Math.round(roundValue(cal, type) * HAND_VALUE * c.box)),
      cat: "ammo", rounds: { cal, type, hand: true },
      desc: `A box of ${c.box} ${c.name} ${t.name} rounds loaded at a reloading bench: they jam more than factory rounds, less the better the loader.`,
    };
  }
}
Object.assign(ROUND_SUPPLIES, HAND_SUPPLIES);
Object.assign(AMMO_GEAR, HAND_GEAR);

// The bench's inputs are supplies (stock keys, like rounds; a battle's pools take brass back as they take arrows),
// counted in single cases, powder charges and primers. Their item forms (RELOAD_GEAR, count stacks: a bag, a can, a
// box) are what is found and sold loose; one that reaches a base's armory or a team's cargo is opened into the stock
// (ammo.js unbox), as a box of rounds is. Black powder and match-head primers are made at the bench (crafting.js).
/** @type {Record<string, { name: string, value: number, weight: number, cat: string, reload: true }>} */
export const RELOAD_SUPPLIES = {
  brass:        { name: "Brass and hulls",    value: 0.08,  weight: 0.008,  cat: "ammo", reload: true },
  powder:       { name: "Powder",             value: 0.2,   weight: 0.0045, cat: "ammo", reload: true },
  blackpowder:  { name: "Black powder",       value: 0.08,  weight: 0.006,  cat: "ammo", reload: true },
  primers:      { name: "Primers",            value: 0.15,  weight: 0.001,  cat: "ammo", reload: true },
  matchprimers: { name: "Match-head primers", value: 0.05,  weight: 0.001,  cat: "ammo", reload: true },
};
/** @type {Record<string, any>} brass, powder, primers (section 12; economy agent C, wave 2) */
export const RELOAD_GEAR = {
  brass:   { name: "Bag of brass",   slot: "pack", skill: null, power: 0, req: 0, noise: 0, small: true, count: true, dur: 100, weight: 0.8, value: 8, cat: "ammo", reload: true,
             desc: "A bag of 100 fired cases and shotgun hulls, picked up and sorted: a reloading bench primes, charges and seats them again. Opened into the stock at a base." },
  powder:  { name: "Can of powder",  slot: "pack", skill: null, power: 0, req: 0, noise: 0, small: true, count: true, dur: 100, weight: 0.5, value: 20, cat: "ammo", reload: true,
             desc: "A 1 lb can of smokeless powder: 100 pistol charges, enough for 40 rifle or 60 shotgun loads at a reloading bench. Opened into the stock at a base." },
  primers: { name: "Box of primers", slot: "pack", skill: null, power: 0, req: 0, noise: 0, small: true, count: true, dur: 100, weight: 0.1, value: 15, cat: "ammo", reload: true,
             desc: "A box of 100 primers: a reloading bench needs one for every round it loads. Rare now. Opened into the stock at a base." },
};

// Enemy loads by kit and calibre class (section 6): weights per type (2026-10-10: AP and slugs trimmed to their rarity:
// soldiers 35% AP to 15%, militia slugs 50% to 25%; a body drops the load it fought with). A type the calibre does not have falls back to
// the calibre's base. Never shown to the player (section 20, R10).
/** @type {Record<string, { pistol: Record<string, number>, rifle: Record<string, number>, shotgun: Record<string, number> }>} */
export const KIT_AMMO = {
  soldiers:  { pistol: { fmj: 0.8, hp: 0.2 },             rifle: { fmj: 0.75, ap: 0.15, tracer: 0.1 },          shotgun: { buck: 0.75, slug: 0.25 } },
  raiders:   { pistol: { fmj: 0.55, hp: 0.35, plusp: 0.1 }, rifle: { fmj: 0.75, sp: 0.15, ap: 0.05, tracer: 0.05 }, shotgun: { buck: 0.7, slug: 0.1, bird: 0.2 } },
  guards:    { pistol: { hp: 0.8, fmj: 0.2 },             rifle: { fmj: 0.75, ap: 0.05, sp: 0.2 },               shotgun: { buck: 0.5, slug: 0.2, beanbag: 0.3 } },
  militia:   { pistol: { fmj: 0.7, hp: 0.3 },             rifle: { sp: 0.7, fmj: 0.3 },                          shotgun: { slug: 0.25, buck: 0.6, bird: 0.15 } },
  survivors: { pistol: { fmj: 0.8, hp: 0.2 },             rifle: { sp: 0.5, fmj: 0.5 },                          shotgun: { buck: 0.6, bird: 0.3, slug: 0.1 } },
  zealots:   { pistol: { fmj: 0.6, hp: 0.4 },             rifle: { fmj: 0.8, sp: 0.2 },                          shotgun: { buck: 0.8, bird: 0.2 } },
  fighters:  { pistol: { fmj: 0.6, hp: 0.4 },             rifle: { fmj: 0.8, sp: 0.2 },                          shotgun: { buck: 0.7, slug: 0.2, bird: 0.1 } },
};

// ---------- box sizes (2026-10-10, user request: "typical US retail box counts per calibre and variant") ----------
// Every box (factory and handloads; data-stacks.js RETAIL_BOX, a calibre or load with no row by its class) holds what a
// box of that load holds off a shelf: dur, weight (its rounds and 50 g of box) and value (its rounds) follow. A slot
// holds up to five boxes of one kind, or up to 80 loose rounds (sim/itemstack.js).
for (const [k, g] of Object.entries(AMMO_GEAR)) {
  const r = g && g.rounds, c = r && CALIBERS[r.cal];
  if (!c) continue;
  const n = retailBox(r.cal, r.type, c, LOAD_CLASS[r.cal] || "");
  if (!(n > 0) || n === g.dur) continue;
  const per = ROUND_SUPPLIES[k] ? ROUND_SUPPLIES[k].value : g.value / g.dur;
  g.dur = n;
  g.weight = Math.round((c.kg * n + 0.05) * 100) / 100;
  g.value = Math.max(1, Math.round(per * n));
  if (typeof g.desc === "string") g.desc = g.desc.replace(/^A box of \d+/, `A box of ${n}`);
}
