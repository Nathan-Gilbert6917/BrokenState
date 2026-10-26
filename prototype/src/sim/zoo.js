// @ts-check
// Zoos (issue #59 of the round-2 epic #39, the user's request 2026-10-26: "zoos"; maps up to 500 × 500). A zoo is a
// point of interest (data.js LOCATIONS zoo; placement.js PLACE_EXTRA puts it where the placement table, #42's
// data-placement.js PLACEMENT_ROWS zoo, says: the big zoos in and near a city's centre, a town's zoo, a petting zoo, a
// roadside zoo or a sanctuary out in the country) that opens one raid map of the whole site (zooMap), built on
// compound.js as a campus is (campus.js, the precedent this follows):
//
//   - The variant (ZOO_VARIANTS, registered with the shared picker: variantpick.js registerVariants("zoo"), #41; spec
//     vid / vname, #40): twelve plans, from a big city zoo of thirty exhibits to a roadside zoo of four pens. Picked by
//     pickVariant with #42's placementCtx (the tile's class and the table's size class: a huge one only on a city's
//     centre or its city blocks), or option.setting where a caller names it, or option.plan / option.layout (an id).
//   - The site, north to south: the exhibits on a grid of plots between the visitor paths (ZOO.PATH; a safari park's
//     drive is a road), the perimeter fence round them with its gates, the entrance building on the fence line (its
//     turnstile hall straight through to the zoo), the entrance plaza (a fountain or a statue, benches, planters), the
//     visitor car park, the road along the south edge; down the east side the service road behind the grounds' fence
//     (a gate onto each path) and the back of house beyond it: the keepers' block, the food prep, the vet hospital,
//     the service yard, holding pens.
//   - An exhibit (ZOO_VARIANTS' list, one a plot): an animal house (zoolayout.js: a viewing hall, the dens or terraria,
//     the keepers' passage) with its outdoor enclosure behind it, joined by the keepers' doors; a paddock (a fence or
//     a big cat's perimeter fence, never vaulted; a moat of water before the visitors' rail, trees and boulders, the
//     keepers' gate); a pool (a pond, rocks); a walk-through aviary (mesh); a building on its own (the café, the gift
//     shop, the aquarium, the vet hospital of a rescue, the research building of a university zoo) with its picnic
//     tables; a playground lawn.
//   - Every building is its own plan from its own dice (zoolayout.js ZOO_PLANS; the vet hospital laid out with #14's
//     vet rooms; the research building #28's science hall), copied onto the map (compound.js placeBuilding: its rooms
//     named after it, its containers c.house, so the POI's ledger keeps each building apart and a revisit finds each as
//     it was left). Its scenes (zoolayout.js: empty cages, the keepers' last stand, an escaped enclosure) are rolled on
//     the whole map (buildingmaps.js buildingMap → interiorscenes.js rollScenes, key "zoo").
//   - The animals (zooDead): the dead beasts of deadbeasts.js are the live hazard. The hoofed stock (antelope, deer,
//     giraffes, camels: dead stags), the pigs and tapirs (dead hogs), the wolves and wild dogs (dead dogs), the bison,
//     the buffalo and the elephants (dead cows), the petting zoo's cats: the ones the worm killed walk in their
//     enclosures (ZOO.BEASTS a paddock, by its kind), fenced in until a fence is broken (the escaped scene) or a gate
//     opened. The big cats, the primates, the birds, the reptiles and the fish have no kind among the dead: they are
//     remains and signs (the scenes' bones and collars, the empty dens), the gap noted in docs/features/combat.md.
//   - The dead (zooDead): the site's roster × ZOO.DEAD_AREA's scale, spread over the buildings by their floor area and
//     over the grounds (ZOO.OUTSIDE), at most ZOO.DEAD_MAX with the beasts (#47's turn budget: 100 aware dead a turn).
//   - Loot: a container holds what it would in its building's own map (campus.js campusLootShare, by c.house); Heat's
//     clock by the buildings searched (campusHeatDims). The food prep's meat and produce have spoiled since the power
//     failed (its freezers and cases: combat.js BOX_LOOT's cold rule, good in winter), the vet hospital holds the drugs
//     and the dart cabinet's tranquilliser darts (data-zoo.js), the keepers' rooms their radios and tools, the service
//     yard the fuel and the tools, the café and the kiosks food and drink, the gift shop sweets and souvenirs.
//   - Older saves: zoos are new places (placement.js placeExtraKind runs in a new world only), so an older save has
//     none and nothing in it changes.
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { BUILDINGS, assemble } from "./buildingmaps.js"; // call-time only (buildingmaps.js imports this module)
import { CELL, enemyUnit, setFloor } from "./combat.js";
import { compoundGrid, placeBuilding, guard, parkingLot, compoundResult, compoundVehicle } from "./compound.js"; // #30's shared multi-building code
import { registerVariants, pickVariant } from "./variantpick.js"; // the shared picker (#41)
import { placementCtx } from "./placement.js"; // #42: the tile's class and the placement table's size class
import { applyZType, siteList } from "./zombietypes.js";
import { ZOO_PLANS, ANIMALS, buildingName } from "./zoolayout.js";
import { REAL_SIZE } from "./data-buildingsize.js"; // #24's size table: a sizes row per variant (its storeys)

export const ZOO = {
  CAP: 500,            // a zoo's map is at most this many cells a side (battlesize.js MAP_CAP zoo)
  EDGE: 4,             // the ground outside the perimeter fence on the west and the north (ways out)
  SERVICE: 4,          // the service road's width
  PLAZA: [12, 16],     // the entrance plaza's depth
  LOT: [24, 28],       // the visitor car park's depth (compound.js parkingLot)
  ROAD: 5,             // the road along the south edge
  CARS: 0.35,          // the car park's bays with a car left in them
  TREES: 0.01,         // trees on a lawn plot, a share of its cells
  DENSE: { animalhouse: 1, cafe: 1.4, giftshop: 1.2, entrance: 1.3, keeper: 0.8, commissary: 0.7, vethospital: 0.9, service: 0.6, aquarium: 1.1, research: 0.9 }, // the dead per cell of a building by kind
  OUTSIDE: 0.35,       // the share of the dead on the grounds
  DEAD_AREA: 2500,     // the site's roster × (the zoo's ground-floor building area / this) ^ DEAD_EXP …
  DEAD_EXP: 0.75,
  DEAD_MAX: 100,       // … at most this many of the dead in all, the beasts with them
  BEASTS: [1, 3],      // the dead beasts a paddock with a kind of them holds (ZOO_PADDOCKS beast)
  BEAST_ODDS: 0.75,    // … on these dice (some died where they stood, or were eaten)
  SAFARI_CARS: [6, 12], // cars abandoned on a safari park's drive
};

// The paddocks, pools and aviaries: their name, what lived there, the fence, a moat, a pond, the dead beast that
// walks there (deadbeasts.js; null: none of the dead of its kind: remains only).
export const ZOO_PADDOCKS = {
  savanna:  { name: "Savanna paddock", animal: "Zebras and antelope", fence: "fence", moat: true, trees: 0.3, beast: "deadstag" },
  giraffe:  { name: "Giraffe yard", animal: "Giraffes", fence: "fence", moat: true, trees: 0.4, beast: "deadstag" },
  elephant: { name: "Elephant yard", animal: "Elephants", fence: "pfence", moat: true, trees: 0.2, pond: 0.15, beast: "deadcow" },
  bison:    { name: "Bison range", animal: "Bison", fence: "fence", trees: 0.2, beast: "deadcow" },
  deer:     { name: "Deer park", animal: "Deer", fence: "wirefence", trees: 1, beast: "deadstag" },
  boar:     { name: "Wild boar wood", animal: "Wild boar", fence: "fence", trees: 1.5, beast: "deadhog" },
  wolves:   { name: "Wolf wood", animal: "Wolves", fence: "pfence", trees: 1.5, beast: "deadhound" },
  dogs:     { name: "Painted-dog yard", animal: "African wild dogs", fence: "pfence", moat: true, trees: 0.5, beast: "deadhound" },
  bears:    { name: "Bear grotto", animal: "Bears", fence: "pfence", moat: true, trees: 0.6, boulders: 1, pond: 0.12, beast: null },
  lions:    { name: "Lion reserve", animal: "Lions", fence: "pfence", moat: true, trees: 0.5, boulders: 0.6, beast: null },
  tigers:   { name: "Tiger forest", animal: "Tigers", fence: "pfence", trees: 1.2, pond: 0.1, beast: null },
  apes:     { name: "Ape island", animal: "Chimpanzees", fence: "fence", pond: 0.45, island: true, trees: 1, beast: null },
  camels:   { name: "Camel yard", animal: "Camels", fence: "fence", trees: 0.1, beast: "deadstag" },
  goats:    { name: "Goat yard", animal: "Goats and sheep", fence: "wirefence", trees: 0.2, beast: "deadstag" },
  pigs:     { name: "Pig pen", animal: "Pigs", fence: "fence", trees: 0, beast: "deadhog" },
  ponies:   { name: "Pony paddock", animal: "Ponies", fence: "wirefence", trees: 0.3, beast: "deadcow" },
  cats:     { name: "Barn cats' yard", animal: "Barn cats", fence: "wirefence", trees: 0.2, beast: "deadcat" },
  penguins: { name: "Penguin pool", animal: "Penguins", fence: "fence", pool: true, beast: null },
  sealions: { name: "Sea lion pool", animal: "Sea lions", fence: "fence", pool: true, beast: null },
  otters:   { name: "Otter stream", animal: "Otters", fence: "fence", pool: true, trees: 0.6, beast: null },
  gators:   { name: "Alligator swamp", animal: "Alligators", fence: "pfence", pool: true, trees: 0.4, beast: null },
  flamingo: { name: "Flamingo lagoon", animal: "Flamingos", fence: "wirefence", pool: true, beast: null },
  aviary:   { name: "Walk-through aviary", animal: "Birds", fence: "wirefence", aviary: true, trees: 2, beast: null },
  raptors:  { name: "Raptor mews", animal: "Eagles and owls", fence: "wirefence", aviary: true, trees: 0.5, beast: null },
  rehab:    { name: "Rehab paddock", animal: "Injured deer", fence: "wirefence", trees: 0.8, beast: "deadstag" },
  bigcats:  { name: "Cat enclosure", animal: "Big cats", fence: "pfence", trees: 0.8, boulders: 0.5, beast: null },
  bearpit:  { name: "Bear pit", animal: "A black bear", fence: "pfence", moat: true, boulders: 1, beast: null },
};
// An exhibit: H(animal, paddock): an animal house of that kind with its paddock behind (null: its yard plain fenced);
// Pd(kind): a paddock, a pool or an aviary alone; B(key, size): a building alone on its plot (the café, the gift shop,
// the aquarium, the vet hospital, the research building) with picnic tables; LAWN: a playground lawn.
const H = (animal, paddock = null) => ({ t: "house", animal, paddock });
const Pd = (kind) => ({ t: "paddock", kind });
const B = (key, size = "m") => ({ t: "build", key, size });
const LAWN = { t: "lawn" };

// The twelve plans (issue #39's rule: a dozen distinct variants; spec.vid / spec.vname, #40). foot: the usual floor area
// of the buildings ([w, d, storeys] in metres, its product their mean floor area over the storeys as built: tools/
// zootest.js holds it to the size class; #42's sizeClassOf gives the class the placement table picks by: a city's big
// zoo and aquarium huge, the safari park, the research zoo and the primate centre large, the rest medium);
// tile: the tile classes it stands on; w: its weight by setting or class. cols, rows, plot ([w], [d] ranges), path:
// the grid; boh: the back of house (building: size); list: the exhibits (the must-haves; fill: more for the plots left).
export const ZOO_VARIANTS = registerVariants("zoo", [
  { id: "cityzoo", name: "Big city zoo", foot: [120, 100, 1], tile: ["centre", "city"], w: { centre: 1, city: 1 },
    cols: [6, 7], rows: [5, 6], plot: [[50, 56], [42, 48]], path: 4, entrance: "h", lots: 2,
    boh: ["keeper:l", "commissary:l", "vethospital:l", "service:l", "keeper:m"],
    list: [H("pachyderm", "elephant"), H("giraffe", "giraffe"), H("primate", "apes"), H("bigcat", "lions"), H("reptile"), H("nocturnal"), H("bird", "flamingo"), B("aquarium", "l"),
      Pd("savanna"), Pd("bears"), Pd("wolves"), Pd("penguins"), Pd("sealions"), Pd("tigers"), Pd("dogs"), Pd("aviary"), Pd("bison"), Pd("camels"), Pd("otters"), B("cafe", "l"), B("cafe", "m"), B("giftshop", "l"), B("cafe", "s"), B("cafe", "s"), H("barn", "goats"), LAWN],
    fill: [Pd("deer"), Pd("boar"), LAWN, Pd("aviary"), B("cafe", "s")] },
  { id: "cityaquarium", name: "City aquarium", foot: [96, 50, 3], tile: ["centre", "city", "coast"], w: { centre: 0.6, city: 0.5, coast: 0.3 },
    cols: [3, 3], rows: [2, 2], plot: [[90, 96], [60, 66]], path: 5, entrance: "l", lots: 1,
    boh: ["keeper:l", "commissary:l", "vethospital:l", "service:m"],
    list: [B("aquarium", "h"), Pd("sealions"), Pd("penguins"), Pd("otters"), B("cafe", "m"), B("giftshop", "m")],
    fill: [LAWN] },
  { id: "safari", name: "Safari park", foot: [70, 52, 1], tile: ["suburb", "highway", "rural", "scenic"], w: { suburb: 0.6, highway: 1, rural: 0.8, scenic: 1 },
    cols: [3, 4], rows: [3, 3], plot: [[80, 96], [70, 84]], path: 7, drive: true, entrance: "l", lots: 2,
    boh: ["keeper:m", "commissary:m", "vethospital:m", "service:l"],
    list: [Pd("savanna"), Pd("lions"), B("cafe", "l"), B("giftshop", "m"), H("giraffe", "giraffe"), H("primate", "apes"), Pd("bison"), Pd("wolves"), Pd("deer"), H("barn", "goats"), Pd("boar"), Pd("camels")],
    fill: [Pd("savanna"), Pd("deer"), LAWN] },
  { id: "researchzoo", name: "University research zoo", foot: [75, 30, 2], tile: ["suburb", "city", "town"], w: { suburb: 0.6, city: 0.3, town: 0.4 },
    cols: [3, 4], rows: [2, 3], plot: [[40, 46], [34, 40]], path: 3, entrance: "m", lots: 1,
    boh: ["keeper:l", "commissary:m", "vethospital:l", "service:m"],
    list: [B("research", "l"), H("primate", "apes"), H("reptile"), Pd("aviary"), Pd("deer"), Pd("wolves"), B("vethospital", "m"), B("cafe", "s")],
    fill: [Pd("boar"), LAWN, Pd("goats")] },
  { id: "primate", name: "Primate centre", foot: [70, 50, 1], tile: ["suburb", "town", "scenic"], w: { suburb: 0.6, town: 0.3, scenic: 0.4 },
    cols: [3, 3], rows: [2, 3], plot: [[42, 48], [36, 42]], path: 3, entrance: "m", lots: 1,
    boh: ["keeper:m", "commissary:m", "vethospital:m", "service:s"],
    list: [H("primate", "apes"), H("primate"), H("nocturnal"), Pd("apes"), Pd("aviary"), B("cafe", "m"), B("giftshop", "s")],
    fill: [H("primate", "apes"), LAWN] },
  { id: "townzoo", name: "Small-town zoo", foot: [45, 37, 1], tile: ["town", "suburb", "rural"], w: { town: 1, suburb: 0.4, rural: 0.2 },
    cols: [3, 3], rows: [2, 2], plot: [[34, 40], [30, 34]], path: 3, entrance: "m", lots: 1,
    boh: ["keeper:m", "commissary:s", "vethospital:s", "service:s"],
    list: [H("bigcat", "bigcats"), H("barn", "goats"), Pd("bears"), Pd("deer"), Pd("aviary"), B("cafe", "s")],
    fill: [Pd("pigs"), LAWN] },
  { id: "birdpark", name: "Bird park", foot: [44, 35, 1], tile: ["town", "coast", "suburb", "scenic"], w: { town: 0.6, coast: 1, suburb: 0.4, scenic: 0.4 },
    cols: [3, 3], rows: [2, 3], plot: [[36, 42], [30, 36]], path: 3, entrance: "m", lots: 1,
    boh: ["keeper:m", "commissary:s", "vethospital:s"],
    list: [H("bird"), Pd("aviary"), Pd("aviary"), Pd("raptors"), Pd("flamingo"), Pd("penguins"), B("cafe", "m"), B("giftshop", "s")],
    fill: [Pd("aviary"), LAWN] },
  { id: "petting", name: "Petting zoo and farm park", foot: [27, 27, 1], tile: ["town", "rural", "highway", "suburb"], w: { rural: 1, town: 0.6, highway: 0.5, suburb: 0.4 },
    cols: [2, 2], rows: [2, 2], plot: [[28, 34], [24, 28]], path: 3, entrance: "s", lots: 1,
    boh: ["keeper:s", "commissary:s", "service:s"],
    list: [H("barn", "goats"), Pd("pigs"), Pd("ponies"), Pd("cats")],
    fill: [B("cafe", "s")] },
  { id: "reptile", name: "Reptile house attraction", foot: [30, 25, 1], tile: ["highway", "rural", "town"], w: { highway: 1, rural: 0.4, town: 0.4 },
    cols: [2, 2], rows: [1, 2], plot: [[30, 36], [26, 30]], path: 3, entrance: "s", lots: 1,
    boh: ["keeper:s", "commissary:s"],
    list: [H("reptile"), Pd("gators")],
    fill: [H("nocturnal"), B("cafe", "s")] },
  { id: "rescue", name: "Wildlife rescue", foot: [28, 24, 1], tile: ["rural", "scenic", "coast"], w: { rural: 0.8, scenic: 1, coast: 0.6 },
    cols: [2, 3], rows: [2, 2], plot: [[28, 32], [24, 28]], path: 3, entrance: "s", lots: 1,
    boh: ["keeper:s", "commissary:s", "service:s"],
    list: [B("vethospital", "s"), Pd("rehab"), Pd("raptors"), Pd("boar")],
    fill: [Pd("rehab"), Pd("deer")] },
  { id: "bigcat", name: "Big-cat sanctuary", foot: [38, 28, 1], tile: ["rural", "scenic", "highway"], w: { rural: 0.6, scenic: 0.8, highway: 0.4 },
    cols: [2, 3], rows: [2, 2], plot: [[34, 40], [30, 34]], path: 3, entrance: "s", lots: 1,
    boh: ["keeper:s", "commissary:s", "vethospital:s", "service:s"],
    list: [H("bigcat", "bigcats"), Pd("lions"), Pd("tigers"), Pd("bigcats")],
    fill: [Pd("bigcats"), B("giftshop", "s")] },
  { id: "roadside", name: "Roadside zoo", foot: [30, 25, 1], tile: ["highway", "rural"], w: { highway: 1, rural: 0.6 },
    cols: [2, 2], rows: [1, 2], plot: [[26, 30], [22, 26]], path: 3, entrance: "s", lots: 1,
    boh: ["keeper:s", "commissary:s"],
    list: [H("barn", "goats"), Pd("bearpit")],
    fill: [Pd("deer"), H("primate")] },
], { missing: 0 });

const dice = (state, ...keys) => hash01(state.seed, "zoo", ...keys);
const seedOf = (state, ...keys) => Math.floor(dice(state, ...keys) * 4294967296);

/**
 * The zoo's plan at a tile: option.plan or option.layout (an id) pins it; option.setting (a caller's say) weighs it;
 * else #42's placementCtx (the tile's class and the size the placement table gives a zoo there).
 * @param {any} state @param {number} tileId @param {any} [option]
 */
export function zooVariant(state, tileId, option = {}) {
  const plan = option.plan ?? option.layout ?? null;
  const tile = state && state.tiles ? state.tiles[tileId] : null;
  const ctx = option.setting ? { setting: option.setting } : tile ? placementCtx(state, tile, "zoo") : {};
  return pickVariant("zoo", null, { ...ctx, plan, r: dice(state, "variant", tileId, option.id || "zoo") }) || ZOO_VARIANTS[0];
}

// ---------- the plan without its map (zooMap, zooBuildings) ----------
// The variant, the grid's size, the exhibits on their plots, every building's spec from its own dice.
function zooPlan(state, tileId, option) {
  const V = zooVariant(state, tileId, option);
  const rng = new Rng(seedOf(state, "map", tileId, option.id || "zoo") || 1);
  const r2 = (/** @type {number[]} */ [a, b]) => rng.int(a, b);
  let cols = r2(V.cols), rows = r2(V.rows);
  const PW = r2(V.plot[0]), PH = r2(V.plot[1]), path = V.path;
  // The exhibits: the must-haves in the plan's order (the first the most wanted: a grid too small keeps them), then the
  // fill in turn for the plots left; then shuffled over the plots.
  const fitW = (c) => ZOO.EDGE + c * PW + (c + 1) * path + 1 + ZOO.SERVICE + bohWidth(V) + ZOO.EDGE;
  while (cols > 1 && fitW(cols) > ZOO.CAP) cols--;
  const fixedH = ZOO.EDGE + ZOO.PLAZA[1] + 18 + ZOO.LOT[1] + ZOO.ROAD + 3;
  while (rows > 1 && rows * PH + (rows + 1) * path + fixedH > ZOO.CAP) rows--;
  while (cols * rows < V.list.length && rows < V.rows[1] && (rows + 1) * PH + (rows + 2) * path + fixedH <= ZOO.CAP) rows++;
  const n = cols * rows;
  const pick = V.list.slice(0, n);
  for (let i = 0; pick.length < n; i++) pick.push(V.fill[i % V.fill.length]);
  const ex = rng.shuffle(pick);
  // The buildings: the entrance first, the exhibits' in plot order, then the back of house.
  /** @type {any[]} */
  const built = [];
  const row = REAL_SIZE.zoo.sizes[V.id] || REAL_SIZE.zoo, top = row.storeys ? row.storeys[1] : 1; // the variant's storeys
  const add = (key, o, where) => {
    const k = built.length, id = `${option.id || "zoo"}#${k + 1}`;
    const hr = new Rng(seedOf(state, "bldg", tileId, id) || 1);
    o = { ...o, maxStoreys: top };
    const spec = key === "research" ? /** @type {any} */ (BUILDINGS).sciencehall.make(hr, { maxStoreys: top }) : ZOO_PLANS[key](hr, o); // #28's science hall (campuslayout.js)
    if (spec.storeys > top) spec.storeys = top;
    spec.margins = { front: 1, back: 1, left: 1, right: 1 };
    spec.ground = "none";
    const B = { k, key, o, id, hr, spec, bw: spec.bw, bh: spec.bh, storeys: Math.max(1, Math.round(spec.storeys || 1)), name: "", ...where };
    built.push(B);
    return B;
  };
  add("entrance", { size: V.entrance }, { where: "entrance" });
  const plots = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const e = ex[r * cols + c];
    const x0 = ZOO.EDGE + path + c * (PW + path), y0 = ZOO.EDGE + path + r * (PH + path);
    const P = { r, c, x0, y0, w: PW, h: PH, e, B: null };
    if (e.t === "house") {
      const maxW = PW - 6, maxH = Math.floor(PH * (e.paddock ? 0.55 : 0.8));
      P.B = add("animalhouse", { animal: e.animal, size: PW >= 46 ? "l" : PW >= 36 ? "m" : "s", maxW, maxH }, { where: "plot", plot: plots.length });
    } else if (e.t === "build") {
      P.B = add(e.key, { size: e.size, maxW: PW - 4, maxH: PH - 8 }, { where: "plot", plot: plots.length }); // never bigger than its plot
    }
    plots.push(P);
  }
  for (const s of V.boh) { const [key, size] = s.split(":"); add(key, { size }, { where: "boh" }); }
  return { V, rng, cols, rows, PW, PH, path, plots, built };
}
// The back of house's width: its deepest building turned to face the service road, and a pen beside it.
const bohWidth = (V) => Math.max(...V.boh.map((s) => { const [key, size] = s.split(":"); const S = { keeper: [16, 13], commissary: [18, 16], vethospital: [19, 17], service: [15, 14] }[key] || [14, 14]; return size === "s" ? S[1] - 3 : size === "m" ? S[1] : S[1] + 2; })) + 6;

/**
 * The map of a zoo (buildingmaps.js buildingMap, for BUILDINGS.zoo): the same every visit (its dice from the world
 * seed, the tile and the option id). Built on compound.js: the grid, the buildings copied in, the guard over the
 * dressing (nothing walkable cut off from the way in), the car park, the result.
 * @param {any} state @param {number} tileId @param {{ id: string, key: string, name: string }} option @param {any} withVehicle
 */
export function zooMap(state, tileId, option, withVehicle) {
  const { V, rng, cols, rows, PW, PH, path, plots, built } = zooPlan(state, tileId, option);
  // ---------- each building's own map ----------
  for (const Bd of built) {
    const key = Bd.key === "vethospital" ? "vet" : Bd.key === "research" ? "sciencehall" : "zoo"; // #14's vet rooms, #28's science hall
    Bd.m = assemble(Bd.hr, Bd.spec, { key, id: Bd.id, name: Bd.key === "research" ? "Research building" : buildingName(Bd.key, Bd.o) });
    Bd.storeys = Bd.m.storeys || 1;
  }
  // Names: a second of a kind numbered ("Café 2").
  const named = {};
  for (const Bd of built) {
    const base = buildingName(Bd.key, Bd.o);
    named[base] = (named[base] || 0) + 1;
    Bd.name = named[base] > 1 ? `${base} ${named[base]}` : base;
  }
  // ---------- the map's size ----------
  const gridW = cols * PW + (cols + 1) * path, gridH = rows * PH + (rows + 1) * path;
  const gx0 = ZOO.EDGE, gy0 = ZOO.EDGE;
  const fenceE = gx0 + gridW, sx0 = fenceE + 1; // the grounds' east fence, the service road east of it
  const bx0 = sx0 + ZOO.SERVICE + 1; // the back of house
  const ent = built[0];
  const plazaD = rng.int(ZOO.PLAZA[0], ZOO.PLAZA[1]), lotD = rng.int(ZOO.LOT[0], ZOO.LOT[1]);
  const fenceS = gy0 + gridH; // the grounds' south fence (the entrance building stands on it)
  const plazaY = fenceS + ent.bh, lotY = plazaY + plazaD, roadY = lotY + lotD + 1;
  const bohBs = built.filter((Bd) => Bd.where === "boh");
  const bohW = Math.max(...bohBs.map((Bd) => Bd.bh), 10) + 8;
  const W = Math.min(ZOO.CAP, bx0 + bohW + 2);
  const Hh = Math.min(ZOO.CAP, roadY + ZOO.ROAD + 2);
  const storeys = Math.max(1, ...built.map((Bd) => Bd.storeys));
  const C = compoundGrid(W, Hh, storeys, () => "grass");
  const cells = C.cells, keep = C.keep;
  const I = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < Hh;
  const paint = (x0, y0, w, h, f, mark = true) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inside(x, y)) { cells[I(x, y)].f = f; if (mark) keep[I(x, y)] = 1; } };
  // ---------- the roads and the paths ----------
  const pathF = V.drive ? "road" : "gravel";
  for (let r = 0; r <= rows; r++) paint(gx0, gy0 + r * (PH + path), gridW, path, pathF);
  for (let c = 0; c <= cols; c++) paint(gx0 + c * (PW + path), gy0, path, gridH, pathF);
  paint(0, roadY, W, ZOO.ROAD, "road");
  paint(0, roadY - 1, W, 1, "gravel"); paint(0, roadY + ZOO.ROAD, W, 1, "gravel");
  paint(sx0, gy0, ZOO.SERVICE, roadY - gy0, "road"); // the service road, down to the road
  paint(gx0, plazaY, fenceE - gx0, plazaD, "gravel", false); // the plaza
  // ---------- the buildings ----------
  const grounds = [];
  const place = (Bd, x0, y0, face) => {
    const part = placeBuilding(C, Bd.m, { x0, y0, face, k: Bd.k, name: Bd.name, key: Bd.key === "research" ? "sciencehall" : Bd.key, keepRing: Bd.where !== "plot" || Bd.key !== "animalhouse" ? undefined : false, tag: { part: { zooKind: Bd.key, ...(Bd.o && Bd.o.animal ? { animal: Bd.o.animal } : {}) } } });
    Bd.part = part;
    return part;
  };
  // The entrance on the south fence line, in the middle of the grounds; its front onto the plaza.
  const ex0 = gx0 + Math.floor((gridW - ent.bw) / 2);
  place(ent, ex0, fenceS, "s");
  // The exhibits' buildings: at the south of their plot (their front onto the path below), the yard behind.
  for (const P of plots) {
    if (!P.B) continue;
    const Bd = P.B, x0 = P.x0 + Math.floor((P.w - Bd.bw) / 2), y0 = P.y0 + P.h - Bd.bh - 1;
    place(Bd, x0, y0, "s");
    P.bx = { x0, y0, w: Bd.bw, h: Bd.bh };
  }
  // The back of house: down the east side, each facing the service road (west), a gap between them.
  let by = gy0 + 2;
  for (const Bd of bohBs) {
    const w = Bd.bh, h = Bd.bw; // turned a quarter
    if (by + h > roadY - 3) { Bd.dropped = true; continue; }
    place(Bd, bx0 + 1, by, "w");
    Bd.rect = { x0: bx0 + 1, y0: by, w, h };
    by += h + 5;
  }
  // The paths from every door to the nearest path or road (the cells between a door and the ground kept clear).
  for (const Bd of built) {
    const part = Bd.part;
    if (!part) continue;
    const doors = [...(part.front && part.front.cells ? part.front.cells.map(([x, y]) => [x, y, part.front.side]) : []), ...part.exits.flatMap((e) => e.cells.map(([x, y]) => [x, y, e.side]))];
    for (const [x, y, side] of doors) {
      const [dx, dy] = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[side] || [0, 1];
      for (let i = 1; i <= 3; i++) { const X = x + dx * i, Y = y + dy * i; if (!inside(X, Y) || C.built[I(X, Y)]) break; keep[I(X, Y)] = 1; if (cells[I(X, Y)].f === "grass") cells[I(X, Y)].f = "gravel"; }
    }
  }
  // ---------- the guard: nothing below cuts a walkable cell off from the way in ----------
  const entry0 = [1, roadY + 2];
  const G = guard(C, entry0[0], entry0[1]);
  const block = (x, y, k, extra = null) => (inside(x, y) ? G.block(x, y, k, extra) : false);
  // ---------- the perimeter fence and its gates ----------
  // Gates first (so no fence line ever closes): an exit gate beside the entrance, a service gate onto each path row
  // from the service road, a keepers' gate at the top of the west and the north fence.
  const gates = [];
  const gate = (x, y) => { if (inside(x, y) && cells[I(x, y)].k === "open" && !C.built[I(x, y)] && block(x, y, "fieldgate")) { keep[I(x, y)] = 1; gates.push([x, y]); return true; } return false; };
  for (const dx of [-3, ent.bw + 2]) gate(ex0 + dx, fenceS);
  for (let r = 0; r <= rows; r++) gate(fenceE, gy0 + r * (PH + path) + Math.floor(path / 2));
  gate(gx0 - 1, gy0 + Math.floor(path / 2)); gate(gx0 + Math.floor(path / 2), gy0 - 1);
  const fenceLine = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const c = inside(x, y) ? cells[I(x, y)] : null; if (c && c.k === "open" && !C.built[I(x, y)] && !keep[I(x, y)]) block(x, y, "fence", { hedge: true }); } };
  fenceLine(gx0 - 1, gy0 - 1, fenceE, gy0 - 1); // north
  fenceLine(gx0 - 1, gy0, gx0 - 1, fenceS); // west
  fenceLine(fenceE, gy0, fenceE, fenceS); // east, the service road beyond
  fenceLine(gx0 - 1, fenceS, fenceE, fenceS); // south, either side of the entrance
  // ---------- the exhibits ----------
  const piece = (x, y, k, w = 1, h = 1) => { // a piece of w × h: all its cells or none
    const done = [];
    for (let q = y; q < y + h; q++) for (let p = x; p < x + w; p++) { if (!inside(p, q) || keep[I(p, q)] || !block(p, q, k)) { for (const i of done) { cells[i].k = "open"; G.passAt(i); } return false; } done.push(I(p, q)); }
    for (const i of done) keep[i] = 1;
    return true;
  };
  const scatter = (x0, y0, w, h, k, n, tries = 6) => { let got = 0; for (let t = 0; t < n * tries && got < n; t++) { const x = rng.int(x0, x0 + w - 1), y = rng.int(y0, y0 + h - 1); if (cells[I(x, y)].k === "open" && !keep[I(x, y)] && block(x, y, k)) got++; } return got; };
  for (const P of plots) {
    const e = P.e;
    if (e.t === "house" || e.t === "paddock") {
      // The yard: the whole plot for a paddock, the plot behind its house for a house's.
      const top = P.y0 + 1, bottom = e.t === "house" ? P.bx.y0 - 1 : P.y0 + P.h - 2;
      const R = { x0: P.x0 + 1, y0: top, w: P.w - 2, h: bottom - top + 1 };
      const kind = e.t === "house" ? e.paddock : e.kind;
      const D = kind ? ZOO_PADDOCKS[kind] : null;
      if (R.h < 6) { if (e.t === "house") grounds.push({ kind: "yard", name: `Yard, ${P.B.name}`, x0: R.x0, y0: R.y0, w: R.w, h: R.h }); continue; }
      const name = D ? D.name : `${ANIMALS[e.animal] ? ANIMALS[e.animal].den.replace(/ \d+$/, "") : "Animal"} yard`;
      grounds.push(enclosure(R, D || { name, animal: e.animal ? ANIMALS[e.animal].name.replace(/ house$/, "s") : "Animals", fence: e.animal === "bigcat" ? "pfence" : "fence", trees: 0.6, beast: null }, e.t === "house" ? P.bx : null));
    } else if (e.t === "build") {
      // Picnic tables before it, trees round the lawn.
      const ry = P.bx ? P.bx.y0 - 1 : P.y0 + P.h - 2;
      grounds.push({ kind: "lawn", name: `Picnic lawn, ${P.B.name}`, x0: P.x0, y0: P.y0, w: P.w, h: ry - P.y0 });
      picnic(P.x0 + 2, P.y0 + 2, P.w - 4, Math.max(0, ry - P.y0 - 3));
    } else {
      grounds.push({ kind: "lawn", name: "Playground", x0: P.x0, y0: P.y0, w: P.w, h: P.h });
      const cx = P.x0 + Math.floor(P.w / 2) - 1, cy = P.y0 + Math.floor(P.h / 2) - 1;
      paint(cx - 3, cy - 3, 8, 8, "dirt", false);
      piece(cx, cy, "playplace", 2, 2) || piece(cx, cy, "statue");
      picnic(P.x0 + 2, P.y0 + 2, P.w - 4, P.h - 4);
    }
  }
  function picnic(x0, y0, w, h) {
    if (w < 4 || h < 4) return;
    const n = Math.max(1, Math.floor((w * h) / 90));
    for (let t = 0, got = 0; t < n * 8 && got < n; t++) {
      const x = rng.int(x0 + 1, x0 + w - 3), y = rng.int(y0 + 1, y0 + h - 2);
      if (piece(x, y, "patiotable")) { got++; for (const [dx, dy] of [[-1, 0], [1, 0]]) piece(x + dx, y + dy, "chair"); }
    }
    scatter(x0, y0, w, h, "tree", Math.round(w * h * ZOO.TREES));
    scatter(x0, y0, w, h, "lamp", 1, 4);
  }
  // An enclosure in rect R (its ring the fence, the gate at the top, a moat along the bottom inside the ring, a pond,
  // trees and boulders inside); bx: a house's rect below it (the ring's bottom only beside the house). Returns its ground.
  function enclosure(R, D, bx) {
    const fence = [], fk = D.fence || "fence";
    const ring = [];
    for (let x = R.x0; x < R.x0 + R.w; x++) ring.push([x, R.y0]);
    for (let y = R.y0 + 1; y < R.y0 + R.h; y++) ring.push([R.x0 + R.w - 1, y]);
    for (let x = R.x0 + R.w - 2; x >= R.x0; x--) ring.push([x, R.y0 + R.h - 1]);
    for (let y = R.y0 + R.h - 2; y > R.y0; y--) ring.push([R.x0, y]);
    const gx = R.x0 + Math.floor(R.w / 2), gtop = [gx, R.y0];
    const gateAt = gate(gtop[0], gtop[1]) ? gtop : null;
    const beside = (x, y) => bx && y === R.y0 + R.h - 1 && x >= bx.x0 && x < bx.x0 + bx.w; // the house's own back wall closes the yard there
    for (const [x, y] of ring) {
      if (gateAt && x === gateAt[0] && y === gateAt[1]) continue;
      if (beside(x, y) || C.built[I(x, y)]) continue;
      if (D.aviary && y === R.y0 + R.h - 1 && Math.abs(x - gx) <= 0) { gate(x, y); continue; } // a walk-through aviary: a gate at each end
      if (cells[I(x, y)].k === "open" && !keep[I(x, y)] && block(x, y, fk)) fence.push([x, y]);
    }
    const g = { kind: "enclosure", name: D.name, animal: D.animal, beast: D.beast || null, x0: R.x0, y0: R.y0, w: R.w, h: R.h, fence, gate: gateAt, fenceKind: fk };
    // A moat before the visitors (the bottom two rows inside the ring), never beside a house.
    if (D.moat && !bx && R.h > 10) {
      for (const yy of [R.y0 + R.h - 3, R.y0 + R.h - 2]) for (let x = R.x0 + 1; x < R.x0 + R.w - 1; x++) if (cells[I(x, yy)].k === "open" && !keep[I(x, yy)]) block(x, yy, "water");
      g.moat = true;
    }
    const iy1 = R.y0 + R.h - (g.moat ? 4 : 2);
    const iw = R.w - 4, ih = iy1 - (R.y0 + 2) + 1;
    // A pool: a pond in the middle (an island in it for the apes: the guard leaves a land bridge where it must).
    if ((D.pool || D.pond) && iw > 6 && ih > 6) {
      const share = D.pool ? 0.45 : D.pond;
      const pw = Math.max(3, Math.round(iw * Math.sqrt(share))), ph = Math.max(3, Math.round(ih * Math.sqrt(share)));
      const px = R.x0 + 2 + Math.floor((iw - pw) / 2), py = R.y0 + 2 + Math.floor((ih - ph) / 2);
      const isle = D.island ? { x0: px + Math.floor(pw / 3), y0: py + Math.floor(ph / 3), w: Math.max(2, Math.floor(pw / 3)), h: Math.max(2, Math.floor(ph / 3)) } : null;
      for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) {
        if (isle && x >= isle.x0 && x < isle.x0 + isle.w && y >= isle.y0 && y < isle.y0 + isle.h) { cells[I(x, y)].f = "grass"; continue; }
        if (cells[I(x, y)].k === "open" && !keep[I(x, y)]) block(x, y, "water");
      }
      g.pool = { x0: px, y0: py, w: pw, h: ph };
      for (let y = py - 1; y <= py + ph; y++) for (let x = px - 1; x <= px + pw; x++) if (inside(x, y) && cells[I(x, y)].k === "open" && cells[I(x, y)].f === "grass" && (y === py - 1 || y === py + ph || x === px - 1 || x === px + pw)) cells[I(x, y)].f = "dirt";
    }
    if (iw > 2 && ih > 2) {
      scatter(R.x0 + 2, R.y0 + 2, iw, ih, "tree", Math.round(iw * ih * ZOO.TREES * (D.trees ?? 0.5)));
      if (D.boulders) scatter(R.x0 + 2, R.y0 + 2, iw, ih, "boulder", Math.max(1, Math.round(iw * ih * 0.004 * D.boulders)));
      if (!D.aviary && !D.pool) { scatter(R.x0 + 2, R.y0 + 2, iw, ih, "hay", 1); scatter(R.x0 + 2, R.y0 + 2, iw, ih, "barrel", 1); }
    }
    if (!D.pool && !D.aviary) for (let y = R.y0 + 1; y < R.y0 + R.h - 1; y++) for (let x = R.x0 + 1; x < R.x0 + R.w - 1; x++) { const c = cells[I(x, y)]; if (c.k === "open" && c.f === "grass" && hash01(x, y, "zooground") < 0.35) c.f = "dirt"; }
    return g;
  }
  // ---------- the plaza: a fountain or a statue, benches, planters ----------
  const pcx = ex0 + Math.floor(ent.bw / 2) - 1, pcy = plazaY + Math.floor(plazaD / 2) - 1;
  for (let y = pcy - 1; y <= pcy + 2; y++) for (let x = pcx - 1; x <= pcx + 2; x++) if (inside(x, y)) keep[I(x, y)] = 0;
  const centre = rng.chance(0.6) ? (piece(pcx, pcy, "fountain", 2, 2) ? "fountain" : null) : piece(pcx, pcy, "statue") ? "statue" : null;
  grounds.push({ kind: "plaza", name: "Entrance plaza", x0: gx0, y0: plazaY, w: fenceE - gx0, h: plazaD, centre });
  for (let i = 0; i < 6; i++) { const x = rng.int(gx0 + 2, fenceE - 4), y = rng.int(plazaY + 2, plazaY + plazaD - 3); piece(x, y, i % 2 ? "planter" : "campusbench", i % 2 ? 1 : 2, 1); }
  // ---------- the visitor car park(s) ----------
  const lots = [];
  const lotX1 = sx0 - 2, nl = V.lots || 1, lw = Math.floor((lotX1 - gx0 + 1 - (nl - 1) * 4) / nl);
  for (let l = 0; l < nl && lw >= 16; l++) {
    const r = { x0: gx0 + l * (lw + 4), y0: lotY + 1, w: lw, h: lotD - 2 };
    const lot = parkingLot(C, G, r, rng, { name: nl > 1 ? `Car park ${String.fromCharCode(65 + l)}` : "Visitor car park", parked: ZOO.CARS });
    if (lot) { lots.push(lot); grounds.push({ kind: "lot", name: lot.name, x0: r.x0, y0: r.y0, w: r.w, h: r.h }); }
  }
  // ---------- a safari park's drive: the cars people abandoned on it ----------
  if (V.drive) {
    const area = { id: C.areas.length, type: "wreck", name: "Safari drive", outdoor: true, f: 0, x0: gx0, y0: gy0, w: gridW, h: gridH, house: null };
    let cars = 0;
    const want = rng.int(ZOO.SAFARI_CARS[0], ZOO.SAFARI_CARS[1]);
    for (let t = 0; t < want * 10 && cars < want; t++) {
      const horiz = rng.chance(0.5), k = rng.int(0, horiz ? rows : cols);
      const x = horiz ? rng.int(gx0 + 2, gx0 + gridW - 6) : gx0 + k * (PW + path) + rng.int(1, path - 3);
      const y = horiz ? gy0 + k * (PH + path) + rng.int(1, path - 3) : rng.int(gy0 + 2, gy0 + gridH - 6);
      if (keep[I(x, y)]) continue;
      const rect = G.car(x, y, horiz ? "x" : "y", rng.chance(0.3) ? 4 : 3, "car", rng.int(0, 1e6));
      if (!rect) continue;
      C.containers.push({ id: C.cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f: 0, area: area.id, kind: "car", searched: false, label: "Safari drive: car", house: null });
      cars++;
    }
    if (cars) C.areas.push(area);
  }
  // ---------- the back of house: holding pens beside the buildings, a fuel tank by the service yard ----------
  for (const Bd of bohBs) {
    if (!Bd.rect) continue;
    const R = { x0: Bd.rect.x0 + Bd.rect.w + 2, y0: Bd.rect.y0, w: Math.max(0, W - 2 - (Bd.rect.x0 + Bd.rect.w + 2)), h: Bd.rect.h };
    if (Bd.key === "service") { piece(R.x0, R.y0 + 1, "fueltank"); grounds.push({ kind: "yard", name: "Service yard", x0: R.x0, y0: R.y0, w: R.w, h: R.h }); continue; }
    if (R.w >= 7 && R.h >= 7) grounds.push(enclosure(R, { name: "Holding pen", animal: "Animals in quarantine", fence: "wirefence", trees: 0, beast: null }, null));
  }
  // ---------- trees and lamps along the paths ----------
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) {
    const y = gy0 + r * (PH + path), x0 = gx0 + c * (PW + path) + path + 2;
    for (let x = x0; x < x0 + PW - 4; x += rng.int(10, 16)) { const yy = r < rows ? y + path : y - 1; if (inside(x, yy) && !keep[I(x, yy)] && cells[I(x, yy)].k === "open") block(x, yy, rng.chance(0.7) ? "tree" : "lamp"); }
  }
  // ---------- the ways out ----------
  const Z = 3, zy = roadY + 1;
  const zones = [
    { x0: 0, y0: zy, w: Z, h: Z, side: "west", exit: "west", name: "West end of the road", vehicle: false },
    { x0: W - Z, y0: zy, w: Z, h: Z, side: "east", exit: "east", name: "East end of the road", vehicle: false },
    { x0: Math.floor(W / 2) - 1, y0: 0, w: Z, h: Z, side: "north", exit: "north", name: "North of the zoo", vehicle: false },
    { x0: 0, y0: Math.floor(fenceS / 2), w: Z, h: Z, side: "west", exit: "west", name: "West of the zoo", vehicle: false },
    { x0: W - Z, y0: Math.max(1, Math.floor(by / 2)), w: Z, h: Z, side: "east", exit: "east", name: "Behind the back of house", vehicle: false },
  ];
  for (const z of zones) for (let q = z.y0 - 1; q <= z.y0 + z.h; q++) for (let p = z.x0 - 1; p <= z.x0 + z.w; p++) if (inside(p, q)) { const c = cells[I(p, q)]; if (["tree", "fence", "lamp", "boulder", "hay", "barrel"].includes(c.k)) { c.k = "open"; delete c.hedge; G.passAt(I(p, q)); } keep[I(p, q)] = 1; }
  // ---------- the result ----------
  const vehicle = compoundVehicle(C, zones[0], withVehicle);
  const exhibits = plots.map((P) => ({ r: P.r, c: P.c, t: P.e.t, kind: P.e.kind || P.e.paddock || null, animal: P.e.animal || null, key: P.e.key || null, house: P.B ? P.B.k : null, x0: P.x0, y0: P.y0, w: P.w, h: P.h }));
  const map = compoundResult(C, { key: option.key, id: option.id, name: option.name, zones, vehicle, kind: "zoo", extra: { zoo: true, vid: V.id, vname: V.name, kindName: V.name, grounds, exhibits, gates, cols, rows } });
  for (const h of map.plan.houses) { const Bd = built[h.k]; h.zooKind = Bd.key; if (Bd.o && Bd.o.animal) h.animal = Bd.o.animal; }
  for (const r of map.plan.rooms) { const a = map.rooms[r.id]; if (a && a.zoo) r.zoo = a.zoo; if (a && a.den) r.den = true; }
  return Object.assign(map, { zoo: true });
}

// ---------- in the raid ----------
// The dead at a zoo (buildingmaps.js placeInterior for a zoo map): the site's roster × ZOO.DEAD_AREA's scale, spread
// over the buildings by their floor area × ZOO.DENSE and over the grounds (ZOO.OUTSIDE), on every floor of a building
// by its floors' share; none in an extraction zone or within 8 of the way in. The first group brings the beasts too:
// ZOO.BEASTS of the kind each enclosure's animals die as (ZOO_PADDOCKS beast), inside its fence. At most ZOO.DEAD_MAX
// in all. Returns how many were placed.
export function zooDead(state, b, map, g, pod0 = 0) {
  const rng = state.rng, R = b.raid, W = b.w, H = b.h, P = map.plan;
  const area = P.houses.reduce((a, h) => a + h.w * h.h, 0);
  const before = R.zooDead || 0;
  let left = ZOO.DEAD_MAX - before;
  if (left <= 0) return 0;
  const cellsOf = (f) => (b.floors ? b.floors[f].cells : b.cells);
  const reachOf = (f) => (b.floors ? b.floors[f].reach : b.reach);
  const entry = R.zones[0], ex = entry.x0 + 1, ey = entry.y0 + 1;
  const inZone = (x, y) => R.zones.some((z) => x >= z.x0 - 1 && x <= z.x0 + z.w && y >= z.y0 - 1 && y <= z.y0 + z.h);
  const taken = new Set(b.units.filter((u) => !u.dead).map((u) => `${u.f || 0}:${u.x},${u.y}`));
  const okAt = (f, x, y) => { const c = cellsOf(f)[y * W + x], r = reachOf(f); return !!c && CELL[c.k] && CELL[c.k].walk && !["stairs", "ladder", "idoor", "odoor", "door", "fieldgate"].includes(c.k) && (!r || r[y * W + x]) && !taken.has(`${f}:${x},${y}`); };
  let placed = 0, zn = b.units.filter((u) => u.kind === "zombie").length;
  const put = (f, c, kind) => {
    if (b.floors && (b.floor || 0) !== f) setFloor(b, f);
    const u = enemyUnit(b, rng, "zombies", g.power, ++zn);
    if (kind) applyZType(u, kind, false, g.power);
    u.aware = false; u.pod = pod0 + placed;
    u.x = c[0]; u.y = c[1]; u.home = [c[0], c[1]];
    b.units.push(u);
    taken.add(`${f}:${c[0]},${c[1]}`);
    placed++; left--;
  };
  // The beasts in their enclosures (the first group only).
  if (!R.zooBeasts) {
    R.zooBeasts = 1;
    for (const e of (P.grounds || []).filter((q) => q.kind === "enclosure" && q.beast)) {
      if (left <= 0 || !rng.chance(ZOO.BEAST_ODDS)) continue;
      const n = rng.int(ZOO.BEASTS[0], ZOO.BEASTS[1]);
      for (let i = 0; i < n && left > 0; i++) {
        let c = null;
        for (let t = 0; t < 30 && !c; t++) { const x = rng.int(e.x0 + 1, e.x0 + e.w - 2), y = rng.int(e.y0 + 1, e.y0 + e.h - 2); if (okAt(0, x, y) && !inZone(x, y)) c = [x, y]; }
        if (c) put(0, c, e.beast);
      }
    }
  }
  const n = Math.min(left, Math.max(1, Math.round((g.count || 0) * Math.max(1, Math.pow(area / ZOO.DEAD_AREA, ZOO.DEAD_EXP)))));
  const zl = siteList(rng, g.mix, n);
  const floorsN = b.floors ? b.floors.length : 1;
  const H2 = P.houses.map((h) => ({ h, w: h.w * h.h * (ZOO.DENSE[h.zooKind] ?? 1) }));
  const tot = H2.reduce((a, q) => a + q.w, 0);
  for (let i = 0; i < n; i++) {
    let f = 0, c = null;
    if (rng.chance(ZOO.OUTSIDE) || !tot) {
      for (let t = 0; t < 30 && !c; t++) {
        const x = rng.int(1, W - 2), y = rng.int(1, H - 2), cl = cellsOf(0)[y * W + x];
        if (cl.f === "floor" || inZone(x, y) || Math.hypot(x - ex, y - ey) < 8) continue;
        if (okAt(0, x, y)) c = [x, y];
      }
    } else {
      let r = rng.next() * tot, pick = H2[0];
      for (const q of H2) { r -= q.w; if (r <= 0) { pick = q; break; } }
      const h = pick.h;
      f = h.storeys > 1 && !rng.chance(0.5) ? rng.int(1, Math.min(h.storeys, floorsN) - 1) : 0;
      for (let t = 0; t < 30 && !c; t++) {
        const x = rng.int(h.x0 + 1, h.x0 + h.w - 2), y = rng.int(h.y0 + 1, h.y0 + h.h - 2);
        if (okAt(f, x, y) && cellsOf(f)[y * W + x].f === "floor") c = [x, y];
      }
    }
    if (!c) continue;
    const before0 = placed;
    put(f, c, zl[i] || null);
    if (placed === before0) break;
  }
  if (b.floors && (b.floor || 0) !== 0) setFloor(b, 0);
  R.zooDead = before + placed;
  return placed;
}
// The opening lines: the zoo, its buildings, its exhibits, the ways out.
export function zooIntro(b) {
  const R = b.raid, P = R.plan;
  const houses = P.houses.map((h) => h.name);
  const enc = (P.grounds || []).filter((g) => g.kind === "enclosure" && g.beast == null && g.name !== "Holding pen").length;
  const beasts = (P.grounds || []).filter((g) => g.kind === "enclosure" && g.beast).map((g) => g.name.toLowerCase());
  const been = P.houses.filter((h) => R.containers.some((c) => c.house === h.k && c.mine)).map((h) => h.name);
  const ways = R.zones.map((z) => (z.name || z.side).toLowerCase());
  return `${P.kindName}: ${houses.length} buildings (${houses.join(", ")}), ${(P.exhibits || []).length} exhibits round the paths.${beasts.length ? ` Something still moves in the ${beasts.slice(0, 4).join(", ")}: the animals the worm killed walk there, behind their fences.` : ""}${enc ? ` ${enc} more ${enc === 1 ? "enclosure stands" : "enclosures stand"} quiet.` : ""} The food prep and the vet hospital are behind the grounds, off the service road. Ways out: ${ways.join(", ")}.${been.length ? ` Your people have been through ${been.join(", ")} before: what you left there is as you left it.` : ""}`;
}
// How many buildings a zoo at this tile has (poicont.js poiHouses: the headless search goes through it a building at a
// time). Builds no map: the plan's own dice.
const countCache = new Map();
export function zooBuildings(state, tileId, option = { id: "zoo" }) {
  const key = `${state.seed}:${tileId}:${option.id}`;
  if (!countCache.has(key)) { if (countCache.size > 64) countCache.clear(); countCache.set(key, zooPlan(state, tileId, option).built.length); }
  return countCache.get(key);
}
// What a zoo likely holds (buildingmaps.js buildingHint): its kinds of building and its loot, without a map.
export function zooHint() {
  const sig = [{ name: "Animal house", n: 6 }, { name: "Enclosure", n: 12 }, { name: "Food prep", n: 1 }, { name: "Vet hospital", n: 1 }, { name: "Café", n: 2 }, { name: "Gift shop", n: 1 }];
  return { hint: "Likely: food (the meat has spoiled), meds and tranquilliser darts at the vet hospital, tools and fuel in the service yard. Animal houses, enclosures, the keepers' block, a café and a gift shop.", size: "huge", rooms: 60, holds: ["animalhouse", "zoofood", "zookeeper", "vet", "giftshop", "kitchen", "garage"], sig };
}
// The archetype's spec (BUILDINGS.zoo.make: the hint, the archetype tests, the crawl's storey count): one of its
// animal houses alone.
export const zooArchetype = (rng, o = {}) => ZOO_PLANS.animalhouse(rng, { animal: "primate", size: "m", ...o });
