// @ts-check
// Mines and quarries (issue #52 of the round-2 epic #39; the user's request 2026-10-26: "Add mine, quarry"). Pure data,
// no imports: the raid rooms only a mine has (combat.js AREAS through data-shops.js AREA_DEFS; loot.js AREA_TAGS from
// the tags). The plans themselves: minelayout.js. The pieces' own tables (an ore car, a cap-lamp rack, an explosives
// box): combat.js BOX_LOOT.
//   mineunder  the workings below (a drift, a stope, the shaft station, the ore pass, a refuge): ore (as stone) and
//              scrap in the cars and on the floor, a tool or a lamp left behind;
//   minedry    the dry (the bathhouse): the miners' street clothes' pockets, hard hats and lamps, a lunch left;
//   minelamp   the lamp room (a rescue station's apparatus room): lamps, batteries, the chargers' parts;
//   minemag    an explosives magazine: fuse, caps' tins, flares (the explosives themselves in its locked boxes).
// About the value per area of a workshop or a garage (tools/lootsensetest.js, tools/minetest.js).
export const MINE_AREAS = {
  mineunder: { tags: ["industry", "tools"], def: { name: "Workings", boxes: ["crate", "shelf", "crate"],
    loot: { stone: [0.55, 4, 12], scrap: [0.7, 3, 8], parts: [0.35, 1, 2] }, gear: [["pickaxe", 0.04], ["shovel", 0.04], ["sledge", 0.03], ["headlamp", 0.04], ["hardhat", 0.04], ["handdrill", 0.02], ["prybar", 0.03]] } },
  minedry: { tags: ["industry", "home"], def: { name: "The dry", boxes: ["locker", "locker", "shelf"],
    loot: { water: [0.3, 1, 2], food: [0.2, 1, 2], scrap: [0.25, 1, 2] }, gear: [["hardhat", 0.12], ["headlamp", 0.06], ["flashlight", 0.05], ["earmuffs", 0.05], ["backpack", 0.03]] } },
  minelamp: { tags: ["industry", "tools", "outdoor"], def: { name: "Lamp room", boxes: ["shelf", "locker", "counter"],
    loot: { parts: [0.35, 1, 2], electronics: [0.25, 1, 1], scrap: [0.25, 1, 2] }, gear: [["headlamp", 0.15], ["flashlight", 0.1], ["batteries", 0.15], ["lantern", 0.05], ["hardhat", 0.08]] } },
  minemag: { tags: ["industry", "outdoor"], def: { name: "Explosives magazine", boxes: ["crate", "shelf", "crate"],
    loot: { scrap: [0.4, 1, 3], parts: [0.3, 1, 2] }, gear: [["flare", 0.15]] } },
};
