// @ts-check
// Carts (carts.js): a wheelbarrow and a hand cart, pushed or pulled in the arms (the In arms slot, inventory.js
// EQUIP_SLOTS carry) by one person. Plain data that imports nothing; data.js merges CART_GEAR into GEAR, loot.js
// CART_TAGS into ITEM_TAGS.
//
// slot "pack" + bulky: never worn, never in a pack or a pocket, never stowed by itself (inventory.js stow would put an
// item of slot "carry" straight into someone's arms); only the In arms slot takes it (isCarryable: it has slots).
// slots: its own grid of items (item.contents, like a pack's; bulky things and packs go in too).
// cart: cap   kg it holds (its items, the team's supplies placed in it and lots it carries, carts.js)
//       frac  the share of what it weighs (itself and all in it) its pusher feels: their load, pace and battle band
//       offroad × the team's pace on a step off the roads (on foot; 1 on a road)
//       look  its sprite (ui/ground.js drawCartIso)
/** @type {Record<string, any>} */
export const CART_GEAR = {
  wheelbarrow: { name: "Wheelbarrow", slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, bulky: true, weight: 14, slots: 10, cat: "containers",
    cart: { cap: 90, frac: 0.25, offroad: 0.9, look: "barrow" },
    desc: "A steel garden wheelbarrow, pushed in the arms (In arms): 10 slots of its own and up to 90 kg of things and the team's supplies (water, food, firewood, game, fuel cans). Its pusher feels a quarter of what it weighs. One wheel goes almost anywhere (off the roads ×0.9 pace). Hands full: Let go in a fight (free) to shoot; take it back with Take cart (1 action, next to it). Left behind, it waits on the ground of the tile." },
  handcart: { name: "Hand cart", slot: "pack", skill: null, power: 0, req: 0, value: 45, noise: 0, bulky: true, weight: 22, slots: 16, cat: "containers",
    cart: { cap: 180, frac: 0.2, offroad: 0.7, look: "cart" },
    desc: "A two-wheeled pull cart with a plank bed and a T handle (In arms): 16 slots of its own and up to 180 kg of things and the team's supplies. Its puller feels a fifth of what it weighs: one person can walk off with a big haul. Best on roads; off them it drags (×0.7 pace). Hands full: Let go in a fight (free) to shoot; take it back with Take cart (1 action, next to it). Left behind, it waits on the ground of the tile." },
};
// Where they are kept (loot.js ITEM_TAGS).
/** @type {Record<string, string[]>} */
export const CART_TAGS = { wheelbarrow: ["tools", "farm", "home"], handcart: ["farm", "tools", "shop"] };
