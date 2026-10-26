// @ts-check
// Radio towers (issue #54 of the round-2 epic #39; the user's request 2026-10-26: "radio tower(can have a base turn it
// on with generators to extend radio communications further)"). Pure data, no imports: the numbers of the base feature
// (radiotower.js) and the tower compound's raid rooms (combat.js AREAS through data-shops.js AREA_DEFS; loot.js
// AREA_TAGS from the tags). The plans themselves: radiotowerlayout.js.
//
// TOWER (radiotower.js):
//   RANGE      a powered tower's coverage, in tiles round the tower's own tile (a station 12, a Military encrypted radio
//              24): the mast's height carries the base's set much further.
//   FUEL       fuel a day the tower's generator burns while it is on (from the base's fuel above its reserve, at the
//              day's turn or when it is switched on); a group's from its own fuel.
//   NEED       the transmitter's draw in power units (what a generator must give: any working generator does).
//   CLAIM_R    a base claims a tower within this many tiles of it (on its own tile it holds it outright).
//   REPAIR     what putting a wrecked tower back on the air takes, from the base's stores.
//   RAID       the chance a raid on the base wrecks its tower, by the raid's outcome (breakdowns.js raidDamage's).
//   SABOTAGE   the chance a day a hostile group with a base within SAB_R tiles of a powered tower sabotages it (each
//              group; at most SAB_MAX a day in all).
export const TOWER = {
  RANGE: 30,
  FUEL: 2,
  NEED: 4,
  CLAIM_R: 2,
  REPAIR: { parts: 4, electronics: 2 },
  RAID: { held: 0, won: 0.5, broken: 0.6, overrun: 1 },
  SABOTAGE: 0.03, SAB_R: 12, SAB_MAX: 0.15,
};

// The tower compound's raid rooms: the transmitter room's electronics, radios and batteries; the generator shed's fuel
// and tools; the equipment shelter's radio parts (electronics) and batteries; the cable store's copper cable (scrap)
// and connectors (parts). About the value per area of a control room or a workshop (tools/lootsensetest.js).
export const TOWER_AREAS = {
  txroom: { tags: ["tech", "tools"], def: { name: "Transmitter room", boxes: ["cabinet", "shelf", "counter"],
    loot: { electronics: [0.45, 1, 2], parts: [0.4, 1, 2], scrap: [0.35, 1, 3] }, gear: [["handradio", 0.08], ["batteries", 0.1], ["solderiron", 0.05], ["flashlight", 0.04], ["headlamp", 0.02]] } },
  genshed: { tags: ["industry", "tools"], def: { name: "Generator shed", boxes: ["crate", "locker", "shelf"],
    loot: { fuel: [0.7, 2, 6], parts: [0.4, 1, 2], scrap: [0.3, 1, 3] }, gear: [["toolkit", 0.05], ["flashlight", 0.04], ["repairkit", 0.02], ["handdrill", 0.02]] } },
  eqshelter: { tags: ["tech", "tools"], def: { name: "Equipment shelter", boxes: ["cabinet", "shelf", "locker"],
    loot: { electronics: [0.55, 1, 2], parts: [0.45, 1, 3], scrap: [0.2, 1, 2] }, gear: [["batteries", 0.12], ["solderiron", 0.04], ["handradio", 0.03]] } },
  cablestore: { tags: ["industry", "tools"], def: { name: "Cable store", boxes: ["crate", "shelf", "shelf"],
    loot: { scrap: [0.7, 2, 6], parts: [0.35, 1, 2], electronics: [0.15, 1, 1] }, gear: [["toolkit", 0.04], ["flashlight", 0.03]] } },
};
