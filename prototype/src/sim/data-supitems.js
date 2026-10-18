// @ts-check
// Supply items (2026-10-16, user request: "Convert items in stores into items that can be held in pockets, packs and
// off hand"; "when looting these items are not put into pockets, packs; the carried section is meant for larger heavy
// objects"). Plain data that imports nothing: data.js merges supItemGear(SUPPLIES) into GEAR once SUPPLIES is whole;
// the rules are sim/supitems.js (taking them out of a stock, putting them back) and sim/itemstack.js (stacks).
//
// Every supply in a stock (a base's stores, a team's cargo, a container's or a body's finds) has a portable form: an
// item `s_<key>` (GEAR[...].supKey = the supply key), a count stack like a box of rounds (item.dur = the units in it,
// up to its stack size a slot). Rounds and the reloading bench's brass, powder and primers keep the forms they had
// (data-ammo.js: the box of the same key); the generic "ammo" count has none (it is not a thing anyone holds).
// Its weight and worth are the supply's, a unit (one can of beans, one dose of meds, one litre of water).
//
// Where one goes: a pocket if it is small, a pack slot unless it is bulky, and the off hand (EQUIP_SLOTS tool: a can
// of fuel or a bottle of water in the hand) unless it is bulky. A bulky one (building materials, car parts: big, heavy
// things) is carried loose (the raid window's Carried), in the cargo or in storage only.
// STACK: the most units in one slot; SMALL: fits a pocket; BULKY: neither pocket, pack nor hand. Keys not listed (the
// foods) go by their unit weight (supItemSpec).
/** @type {Record<string, { stack: number, small?: boolean, bulky?: boolean, word?: string }>} */
export const SUP_ITEM = {
  water:        { stack: 4,   word: "litres of purified water" },  // a few bottles
  rawwater:     { stack: 4,   word: "litres of un-purified water" },
  fuel:         { stack: 5,   word: "litres of fuel" },            // a jerrycan
  meds:         { stack: 20,  small: true, word: "doses of meds" },
  arrows:       { stack: 24,  word: "arrows" },                    // a quiver
  parts:        { stack: 3,   word: "machine parts" },
  scrap:        { stack: 4,   word: "scrap" },
  jars:         { stack: 6,   word: "jars" },
  wood:         { stack: 30,  word: "firewood" },                  // a 3 kg bundle
  carparts:     { stack: 2,   bulky: true, word: "car parts" },
  gunparts:     { stack: 10,  small: true, word: "gun parts" },
  electronics:  { stack: 10,  small: true, word: "electronics" },
  buildmat:     { stack: 5,   bulky: true, word: "building materials" },
  blackpowder:  { stack: 100, small: true, word: "charges of black powder" },
  matchprimers: { stack: 100, small: true, word: "match-head primers" },
};
// A food (or any supply not listed): up to SLOT_KG in a slot (at least one, at most MAX), small up to SMALL_KG a unit.
export const SUP_SLOT = { SLOT_KG: 3, MAX: 12, SMALL_KG: 0.5 };
// Supplies with no item form: the abstract ammo count, and the ones that already have one (rounds, the bench's bags).
export const NO_SUP_ITEM = ["ammo"];
export const supItemKey = (k) => `s_${k}`;

/** @param {string} k @param {{ weight: number }} sup */
export function supItemSpec(k, sup) {
  const own = SUP_ITEM[k];
  if (own) return { stack: own.stack, small: !!own.small, bulky: !!own.bulky };
  const w = Math.max(0.001, Number(sup.weight) || 1);
  return { stack: Math.max(1, Math.min(SUP_SLOT.MAX, Math.floor(SUP_SLOT.SLOT_KG / w + 1e-9))), small: w <= SUP_SLOT.SMALL_KG, bulky: false };
}

// The GEAR entries: one per supply that has no item of its own. gear: the GEAR built so far (a key there already, a
// box of rounds, is skipped).
/** @param {Record<string, any>} supplies @param {Record<string, any>} gear */
export function supItemGear(supplies, gear) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, s] of Object.entries(supplies)) {
    if (NO_SUP_ITEM.includes(k) || gear[k]) continue;
    const sp = supItemSpec(k, s);
    out[supItemKey(k)] = {
      name: s.name, slot: "pack", skill: null, power: 0, req: 0, noise: 0, count: true, dur: 1,
      weight: s.weight, value: s.value, cat: "supply", supKey: k, stack: sp.stack, hand: !sp.bulky,
      ...(sp.small ? { small: true } : {}), ...(sp.bulky ? { bulky: true } : {}),
      desc: `${s.name} out of the stores, to carry on you: up to ${sp.stack} in a ${sp.small ? "pocket, a pack slot or the off hand" : sp.bulky ? "pile: too big for a pocket, a pack or a hand (carry it, or put it in the cargo)" : "pack slot or the off hand (too big for a pocket)"}. Put it in a base's armory or a team's cargo and it goes back into the stock.`,
    };
  }
  return out;
}
