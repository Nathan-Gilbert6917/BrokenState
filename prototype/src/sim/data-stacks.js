// @ts-check
// Stacks in an inventory slot, ammo box sizes and bulk ammo containers (2026-10-10, user requests and decisions).
// Plain data that imports nothing: data-ammo.js reads RETAIL_BOX for its boxes, data.js merges BULK_GEAR into GEAR;
// the rules that use them are sim/itemstack.js (stacks, rounds in their forms, bulk containers).
//
// Consumable stacks (item.n, one slot): the user's calls: grenades and other throwables never stack (one a slot), and
// nothing that wears down stacks (an item with uses: bandage kits, purification tablets, toiletries); the size by the
// item's size: small things 10, medium 5, larger 2–3. Only the keys listed stack.
/** @type {Record<string, number>} key → the most in one slot */
export const STACK_MAX = {
  // small (10): a pack of cigarettes, a candy bar, a pill bottle, a battery pack, a lighter
  cigarettes: 10, smokes: 10, tobacco: 10, chocolate: 10, candy: 10, tea: 10, instcoffee: 10, batteries: 10, lighters: 10, dewormer: 10,
  makeshiftpick: 10, // bent-wire lock picks (locks.js MAKESHIFT_PICK): no dur, one snaps whole off the stack
  // medium (5): a tin of coffee, a jar of honey, a box of cigars, a bag of candles, a roll pack of toilet paper
  coffee: 5, honey: 5, cigars: 5, candles: 5, toiletpaper: 5,
  // larger (3): bottles
  whiskey: 3, wine: 3, scotch: 3, vodka: 3,
};

// Rounds in a slot (an item of a round key: data-ammo.js AMMO_GEAR, a count stack, item.dur = the rounds in it):
// loose (item.loose: rounds by the handful, a pocketful) up to LOOSE rounds of one round type; boxed (the default)
// up to BOXES boxes of the same box type (a stack of boxes: its boxes are ceil(rounds / box size); the last one may be
// opened and part used).
export const AMMO_STACK = { LOOSE: 80, BOXES: 5 };

// Box sizes: typical US retail counts per calibre and load (what a box off a store shelf holds: rimfire in 100s, pistol
// practice ammo in 50s and defensive hollow points in 20s, rifle ammo in 20s, buckshot in 5s–10s, slugs in 5s, birdshot
// and target loads in 25s, .50 BMG in 10s). By "cal_type"; a calibre's own row covers its other loads; a calibre or
// load with no row (one added later) takes its class default (retailBox below).
/** @type {Record<string, number>} */
export const RETAIL_BOX = {
  // .22 LR: bulk-ish 100 boxes; premium (subsonic) 50
  "22lr": 100, "22lr_subsonic": 50,
  // 9mm: 50 practice FMJ; 20 defensive (hollow point, +P); AP and subsonic 50; less-lethal 25
  "9mm": 50, "9mm_hp": 20, "9mm_plusp": 20, "9mm_rubber": 25,
  "45acp": 50, "45acp_hp": 20,
  // .38 / .357: 50; defensive hollow points 20
  "357": 50, "357_hp": 20, "357_plusp": 20, "38spl": 50, "38spl_hp": 20,
  // .44 Magnum: 50 (jacketed), defensive / hunting hollow points 20; 5.7×28: 50 a box, either load
  "44mag": 50, "44mag_hp": 20, "44mag_sp": 20, "57x28": 50,
  // 12 gauge: buckshot 10, slugs 5, birdshot and other hunting / target loads 25, less-lethal beanbags 5
  "12ga": 25, "12ga_buck": 10, "12ga_slug": 5, "12ga_bird": 25, "12ga_beanbag": 5,
  // 20 gauge likewise (a gauge the arsenal may add)
  "20ga": 25, "20ga_buck": 10, "20ga_slug": 5, "20ga_bird": 25,
  // rifles: 20 a box
  "556": 20, "762x39": 20, "308": 20, "3030": 20, "3006": 20, "300blk": 20, "223": 20, "545x39": 20, "65cm": 20, "762x54r": 20, "243": 20, "270": 20,
  "50bmg": 10,
  // launcher rounds: a crate of six 40 mm grenades, one rocket
  "40mm": 6, "rocket": 1,
};
// A box's size for a calibre and load: its row, the calibre's row, else by class: a shotgun gauge by load (buckshot 10,
// slug 5, else 25), rimfire (a round under 6 g) 100, a heavy round (over 60 g) 10, a pistol round (LOAD_CLASS pistol,
// or under 22 g) 50 (hollow point / +P 20), else a rifle round 20.
/** @param {string} cal @param {string} type @param {{ kg?: number }} [c] the calibre's data @param {string} [cls] its reloading class */
export function retailBox(cal, type, c = {}, cls = "") {
  const own = RETAIL_BOX[`${cal}_${type}`] ?? RETAIL_BOX[cal];
  if (own) return own;
  const kg = Number(c.kg) || 0;
  if (/ga$/.test(cal) || cls === "shotgun") return type === "buck" ? 10 : type === "slug" || type === "beanbag" ? 5 : 25;
  if (kg > 0 && kg < 0.006) return 100;
  if (kg > 0.06) return 10;
  if (cls === "pistol" || (kg > 0 && kg < 0.022 && cls !== "rifle")) return type === "hp" || type === "plusp" ? 20 : 50;
  return 20;
}

// Bulk ammo containers (2026-10-10, user request): an Ammo can holds one round type (up to 500 rounds; semi heavy: the
// can and its rounds), an Ammo carton one calibre (any of its loads, up to 1000; heavy), an Ammo bag (a duffle) one or
// several kinds (up to 2000; very heavy). Its rounds are loose round items inside it (item.loads); it weighs its empty
// weight and its rounds (per-round weights: data-ammo.js CALIBERS kg) and is worth its empty value and its rounds. An
// Ammo can goes in a pack (its rounds count as the pack's in a fight: a shotgun's need Get shells); the carton and the
// bag are bulky (storage, a vehicle's cargo, a loot container). One put in a base's armory or a team's cargo is opened
// into the stock like a box (ammo.js unbox). Found now and then, partly filled at times, in the places rounds turn up:
// more often for the common rounds, rarely for special ones (sim/itemstack.js bulkChance).
// cap: rounds; one: "key" (one round type) | "cal" (one calibre) | "any".
/** @type {Record<string, { cap: number, one: "key" | "cal" | "any", empty: number }>} */
export const BULK = {
  ammocan: { cap: 500, one: "key", empty: 2.3 },
  ammocarton: { cap: 1000, one: "cal", empty: 1 },
  ammobag: { cap: 2000, one: "any", empty: 1.5 },
};
// Their catalogue entries (data.js merges them into GEAR). weight / value: empty.
/** @type {Record<string, any>} */
export const BULK_GEAR = {
  ammocan: { name: "Ammo can", slot: "pack", skill: null, power: 0, req: 0, noise: 0, weight: 2.3, value: 6, cat: "ammo", bulk: true,
    desc: "A steel ammo can holding up to 500 rounds of one kind, loose. It goes in a pack (its rounds are the pack's in a fight: a shotgun's need Get shells first); at a base or in a team's cargo it is opened into the stock. Take out a handful (up to 80) from the inventory." },
  ammocarton: { name: "Ammo carton", slot: "pack", skill: null, power: 0, req: 0, noise: 0, weight: 1, value: 2, cat: "ammo", bulk: true, bulky: true,
    desc: "A case of up to 1000 rounds of one calibre, boxed loose by the hundred. Heavy and too big for a pack: storage, a vehicle's cargo. Opened into the stock at a base or in a team's cargo." },
  ammobag: { name: "Ammo bag", slot: "pack", skill: null, power: 0, req: 0, noise: 0, weight: 1.5, value: 3, cat: "ammo", bulk: true, bulky: true,
    desc: "A duffle stuffed with up to 2000 rounds of whatever someone could grab, one kind or several. Very heavy; too big for a pack. Opened into the stock at a base or in a team's cargo." },
};
// Odds and fill of the finds (sim/itemstack.js): a raid container or a stash of a gun place may hold a bulk container
// (CHANCE by place theme × the round's commonness, 0–1: how common it is where rounds turn up, data-ammo.js AMMO_MIX,
// or a load's own rarity when the data gives one); which kind (KIND weights); FULL: the share of its cap it holds (a
// roll between these; PARTIAL of them are part used: down to the low end).
export const BULK_FINDS = {
  CHANCE: { military: 0.012, police: 0.006, guns: 0.008, prison: 0.004, hunt: 0.004, farm: 0.002, raider: 0.003, home: 0.0008 }, // a container searched
  KIND: { ammocan: 6, ammocarton: 2, ammobag: 1 },
  FULL: [0.25, 1], PARTIAL: 0.5,
  // A find's rounds, boxed or loose: of the rounds in a container (whole boxes of them), the share in boxes (the rest
  // stays loose in the find's record) by place theme.
  BOXED: { military: 0.7, police: 0.6, guns: 0.85, prison: 0.5, hunt: 0.7, farm: 0.5, raider: 0.3, home: 0.5 },
};
