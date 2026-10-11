// @ts-check
// Carts (carts.js): a wheelbarrow and a hand cart, pushed or pulled in the arms (the In arms slot, inventory.js
// EQUIP_SLOTS carry) by one person. Plain data that imports nothing; data.js merges CART_GEAR into GEAR, loot.js
// CART_TAGS into ITEM_TAGS.
//
// slot "pack" + bulky: never worn, never in a pack or a pocket, never stowed by itself (inventory.js stow would put an
// item of slot "carry" straight into someone's arms); only the In arms slot takes it (isCarryable: it has slots).
// slots: its own grid of items (item.contents, like a pack's; bulky things and packs go in too).
// cart: cap     kg it holds (its items, the team's supplies placed in it and lots it carries, carts.js)
//       frac    the share of what it weighs (itself and all in it) its pusher feels: their load, pace and battle band
//       terrain × the team's pace on a step off the roads onto that terrain (on foot; 1 on a road)
//       hp      a let-go cart's cell in a fight: the blows it takes before the dead shove it over (combat.js bash)
//       twoMan  a second person can help pull it (carts.js cartHelp: the felt share and the terrain penalty halved)
//       broken  a cart worn to 0 (a wheel off, carts.js cartBroken): what its pusher feels of it, the pace everywhere
//       look    its sprite (ui/ground.js drawCartIso)
// dur: wear points (crafting.js itemDur): a step off the roads wears it by the terrain (carts.js CART_WEAR), a blow on
//   its cell in a fight by CART_WEAR.bash; repaired at a workbench or with a field repair kit (repair.js "cart").
/** @type {Record<string, any>} */
export const CART_GEAR = {
  wheelbarrow: { name: "Wheelbarrow", slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, bulky: true, weight: 14, slots: 10, cat: "containers",
    dur: 60, cart: { cap: 90, frac: 0.25, terrain: { plains: 0.95, suburb: 0.95, city: 0.95, forest: 0.85, hills: 0.85, mountain: 0.7 }, hp: 10, broken: { frac: 0.75, pace: 0.5 }, look: "barrow" },
    desc: "A steel garden wheelbarrow, pushed in the arms (In arms): 10 slots of its own and up to 90 kg of things and the team's supplies (water, food, firewood, game, fuel cans). Its pusher feels a quarter of what it weighs. One wheel goes almost anywhere (off the roads ×0.95 on farmland, ×0.85 in forest and hills). Rough ground wears its wheel; a broken one drags (repair: parts at a workbench). Hands full: Let go in a fight (free) to shoot; take it back with Take cart (1 action, next to it). Left behind, it waits on the ground of the tile." },
  handcart: { name: "Hand cart", slot: "pack", skill: null, power: 0, req: 0, value: 45, noise: 0, bulky: true, weight: 22, slots: 16, cat: "containers",
    dur: 80, cart: { cap: 180, frac: 0.2, terrain: { plains: 0.85, suburb: 0.9, city: 0.9, forest: 0.6, hills: 0.6, mountain: 0.4 }, hp: 16, twoMan: true, broken: { frac: 0.75, pace: 0.5 }, look: "cart" },
    desc: "A two-wheeled pull cart with a plank bed and a T handle (In arms): 16 slots of its own and up to 180 kg of things and the team's supplies. Its puller feels a fifth of what it weighs: one person can walk off with a big haul. Best on roads; off them it drags (×0.85 on farmland, ×0.6 in forest and hills). A second person can help pull (half the felt weight and the drag). Rough ground wears its wheels; a broken one drags (repair: parts at a workbench). Hands full: Let go in a fight (free) to shoot; take it back with Take cart (1 action, next to it). Left behind, it waits on the ground of the tile." },
};
// Where they are kept (loot.js ITEM_TAGS).
/** @type {Record<string, string[]>} */
export const CART_TAGS = { wheelbarrow: ["tools", "farm", "home"], handcart: ["farm", "tools", "shop"] };
