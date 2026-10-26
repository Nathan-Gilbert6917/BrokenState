// @ts-check
// Amusement parks, fairgrounds and water parks (the user's request 2026-10-26, issue #60 of the round-2 epic #39:
// "amusement parks"): the whole park as one raid map, built on compound.js (the shared multi-building code: each
// building copied onto one grid, kept apart in the POI's ledger by c.house; #28's campuses and #30's malls use it too).
// A point of interest of kind "amusement" (data-parks.js PARK_KINDS) placed by #42's table in a new world
// (data-placement.js PLACEMENT_ROWS.amusement, placement.js PLACE_EXTRA): a destination theme park by a city's centre,
// regional parks, water parks and fun parks in the cities and suburbs, fairgrounds in the towns, a pier or a funfair on
// the coast.
//
//   - The variant (PARK_VARIANTS, registered with the shared picker: variantpick.js "amusement"; the plan by
//     spec.vid / spec.vname, #40): picked by the tile's class (placement.js placementCtx: its weight there, its size
//     class: a huge destination park only where the table says huge, by a city's centre) and the park's own dice,
//     option.plan / option.variant pins one. Thirteen plans of their own: a destination theme park, a regional park, a
//     county fairground with its exhibition halls, livestock barns and grandstand, a boardwalk pier over the water, a
//     water park (slide towers, a wave pool, a lazy river, changing rooms), a travelling carnival lot, a mini-golf and
//     go-kart park, a family fun park, an abandoned park (overgrown, boarded up, less left), a seaside funfair by the
//     beach, a holiday light park round its drive-through loop, a trampoline park (one big hall) and a western theme
//     town.
//   - The size (data-buildingsize.js REAL_SIZE.amusement.sizes, a row a variant, metres = cells), at most
//     battlesize.js MAP_CAP.amusement (500): a destination park 440–500 a side, a trampoline park 120–140.
//   - The site (compound.js): the road along the south with the parking lot, the gate's plaza (the ticket booths and
//     turnstiles, guest services and the gift shop), the park's fence all round, the midway up the middle and the paths
//     across it, the blocks between them packed with the rides (outdoor areas: a coaster's track loop with its train
//     stalled on it and its station, a Ferris wheel, a carousel, the teacups, kiddie rides, water slides, the go-kart
//     track and its karts, the mini-golf course, the light displays, a grandstand, the livestock pens) and the
//     buildings (amusementlayout.js PARK_PLANS: food stands, the games booths, gift shops, the first-aid station, the
//     arcade, a bumper-car pavilion, the exhibition halls and barns), the back of house behind a fence to the north
//     (the maintenance shop, the employee area, the generator and fuel yard) with its service gate.
//   - Loot: each building's rooms by their AREAS type (data-parks.js PARK_AREA_DEFS: snacks, prizes, the gift shop's,
//     first aid, tools and parts, fuel, the cash office's safe, the employees' lockers); the go-karts' tanks and the
//     fuel yard's drums (outdoor containers, AREAS parkfuel); the cars on the lots.
//   - The dead (PARK.DEAD: the roster × the park's area, an abandoned park's more); scenes (amusementlayout.js: a
//     stalled ride, a last stand in a ride's station) besides every building's own.
//   - The ways out: the road both ways and its middle (the team comes in there), the service gate to the north, the
//     sides.
//   - Older saves: there were no parks; a world from before the placement table (#42) has none.
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { registerVariants, pickVariant } from "./variantpick.js"; // the shared picker (issue #41)
import { assemble } from "./buildingmaps.js"; // call-time only (buildingmaps.js imports this module)
import { compoundGrid, placeBuilding, guard, parkingLot, compoundResult, compoundVehicle } from "./compound.js";
import { REAL_SIZE } from "./data-buildingsize.js";
import { mapCap } from "./battlesize.js";
import { placementCtx, sizeFor } from "./placement.js";
import { PARK_PLANS, registerParkScenes } from "./amusementlayout.js";

export const PARK = {
  KEY: "amusement",
  EDGE: 4,           // the ground outside the park's fence (the sides' ways out)
  ROAD: 6,           // the road along the south (the way in)
  LOT: 30,           // the parking lot's depth between the road and the gate
  PLAZA: 20,         // the gate's plaza inside the fence (guest services, the gift shop)
  GATE: 12,          // the main gate's width
  SERVICE: 5,        // the service gate's width (the back of house's, to the north)
  MIDWAY: 6,         // the midway's width (the main path up the middle)
  PATH: 4,           // a cross path's width
  GAP: 3,            // between two things in a block
  BOH: 24,           // the back of house's depth at least (the maintenance shop and the employee area fit it)
  DEAD: 1.1,         // the dead: the roster × this × (the park's area / DEAD_AREA) ^ DEAD_EXP …
  DEAD_AREA: 40000,
  DEAD_EXP: 0.6,
  DEAD_MAX: 4,       // … the scale at most this
  TREES: 0.004,      // trees on the grass, a share of its cells (an abandoned park's × 4, bushes too)
  LAMPS: 18,         // a lamp post every this many cells along the midway
};

// The coasters' and the rides' names (fictional).
const COASTERS = ["Thunder Run", "Cyclone", "Timber Wolf", "Comet", "Big Dipper", "Sky Screamer", "Rattler", "Wildcat", "Blue Streak", "Gold Rush", "Mine Train", "Twister"];
const HALLS = ["Agriculture Hall", "Home Arts Hall", "4-H Building", "Commerce Hall", "Floral Hall"];
const BARNS = ["Cattle Barn", "Swine Barn", "Sheep and Goat Barn", "Poultry Barn", "Horse Barn"];

// ---------- the variants ----------
// w: the weights by tile class (placement.js tileClass; the picker reads ctx.setting as the class, so coast and scenic
// land weigh as themselves); sizeClass: the table's size class it answers (#42: huge only by a city's centre). rides and
// blds: [min, max] of each; theme: the grounds' builder; boh: the back of house's depth; block: a block's depth between
// the cross paths; ground: the grass's floor; names: the buildings' own names.
export const PARK_VARIANTS = [
  { id: "themepark", name: "Destination theme park", sizeClass: "huge", w: { centre: 4, city: 1 }, theme: "grounds", boh: 30, block: [46, 56], storeys: 2,
    rides: { coaster: [3, 4], ferris: [1, 1], carousel: [1, 2], teacups: [1, 2], kiddie: [1, 2], slides: [0, 1], picnic: [2, 3], pavilion: [1, 2] },
    blds: { stand: [12, 16], booth: [14, 20], gift: [3, 4], aid: [2, 2], arcade: [1, 2] } },
  { id: "regional", name: "Regional amusement park", sizeClass: "large", w: { city: 2, suburb: 3, highway: 2, town: 0.4 }, theme: "grounds", boh: 24, block: [40, 50],
    rides: { coaster: [2, 2], ferris: [1, 1], carousel: [1, 1], teacups: [1, 1], kiddie: [1, 1], picnic: [1, 2], pavilion: [1, 1] },
    blds: { stand: [7, 10], booth: [8, 12], gift: [1, 2], aid: [1, 1], arcade: [1, 1] } },
  { id: "fairground", name: "County fairground", sizeClass: "large", w: { town: 4, rural: 3, scenic: 1, suburb: 0.5, highway: 0.5 }, theme: "grounds", boh: 18, block: [40, 48], ground: "dirt",
    rides: { ferris: [1, 1], carousel: [0, 1], teacups: [1, 1], kiddie: [1, 1], grandstand: [1, 1], pens: [1, 2] },
    blds: { stand: [6, 9], booth: [8, 12], hall: [2, 3], barn: [2, 3], aid: [1, 1] }, names: { hall: HALLS, barn: BARNS } },
  { id: "pier", name: "Boardwalk pier", sizeClass: "large", w: { coast: 5 }, theme: "pier", storeys: 2,
    rides: { coaster: [1, 1], ferris: [1, 1], carousel: [1, 1], teacups: [0, 1] },
    blds: { stand: [5, 7], booth: [6, 10], gift: [1, 2], aid: [1, 1], arcade: [1, 2] } },
  { id: "waterpark", name: "Water park", sizeClass: "large", w: { suburb: 2, city: 1, highway: 1.5, town: 1, coast: 0.6 }, theme: "grounds", boh: 20, block: [40, 48], ground: "paving",
    rides: { slides: [3, 4], wavepool: [1, 1], lazyriver: [1, 1], kiddie: [0, 1], picnic: [2, 3] },
    blds: { stand: [4, 6], gift: [1, 1], changing: [2, 3], aid: [1, 1] } },
  { id: "carnival", name: "Travelling carnival", sizeClass: "large", w: { town: 2, rural: 2, highway: 1, suburb: 0.5 }, theme: "grounds", boh: 22, block: [30, 36], ground: "gravel",
    rides: { ferris: [1, 1], teacups: [1, 1], kiddie: [1, 1], carousel: [0, 1] },
    blds: { stand: [3, 5], booth: [8, 12], aid: [1, 1] } },
  { id: "funcentre", name: "Mini-golf and go-kart park", sizeClass: "large", w: { suburb: 2, highway: 2, town: 1.5 }, theme: "grounds", boh: 14, block: [40, 46],
    rides: { gokart: [1, 1], minigolf: [1, 2], picnic: [1, 1] },
    blds: { stand: [1, 2], arcade: [1, 1], booth: [1, 3], aid: [1, 1] } },
  { id: "family", name: "Family fun park", sizeClass: "large", w: { suburb: 2, town: 1.5, city: 1 }, theme: "grounds", boh: 16, block: [36, 44],
    rides: { kiddie: [2, 3], carousel: [1, 1], teacups: [1, 1], minigolf: [1, 1], gokart: [0, 1], picnic: [1, 2] },
    blds: { stand: [3, 5], booth: [4, 6], arcade: [1, 1], gift: [1, 1], aid: [1, 1], pavilion: [0, 1] } },
  { id: "abandoned", name: "Abandoned amusement park", sizeClass: "large", w: { rural: 1, highway: 1, scenic: 2, town: 0.5, suburb: 0.5 }, theme: "grounds", boh: 22, block: [40, 50], abandoned: true,
    rides: { coaster: [1, 2], ferris: [1, 1], carousel: [0, 1], teacups: [1, 1], pavilion: [0, 1] },
    blds: { stand: [5, 8], booth: [6, 10], gift: [1, 1], aid: [1, 1], arcade: [0, 1] } },
  { id: "funfair", name: "Seaside funfair", sizeClass: "large", w: { coast: 3 }, theme: "grounds", sea: true, boh: 0, block: [34, 42],
    rides: { ferris: [1, 1], carousel: [1, 1], teacups: [1, 1], kiddie: [1, 1], coaster: [0, 1] },
    blds: { stand: [5, 8], booth: [8, 12], arcade: [1, 2], gift: [1, 1], aid: [1, 1] } },
  { id: "lights", name: "Holiday light park", sizeClass: "large", w: { suburb: 1, town: 1, rural: 1.5, scenic: 1, highway: 1 }, theme: "grounds", loop: true, boh: 14, block: [44, 52],
    rides: { lights: [4, 6], carousel: [0, 1] },
    blds: { stand: [2, 4], gift: [1, 2], aid: [1, 1] }, names: { stand: ["Cocoa hut", "Kettle corn stand", "Cider stand", "Cookie cabin"], gift: ["Santa's workshop", "Ornament shop"] } },
  { id: "trampoline", name: "Trampoline park", sizeClass: "large", w: { city: 2, suburb: 2, town: 1 }, theme: "hall", storeys: 1 },
  { id: "western", name: "Western theme town", sizeClass: "large", w: { scenic: 2, highway: 1.5, rural: 1 }, theme: "grounds", boh: 20, block: [40, 50], ground: "dirt",
    rides: { coaster: [1, 1], carousel: [0, 1], teacups: [0, 1], picnic: [1, 2], pens: [0, 1] },
    blds: { stand: [5, 7], booth: [4, 8], gift: [2, 3], aid: [1, 1] }, names: { stand: ["Saloon", "Chuckwagon", "Trading post grill", "Sarsaparilla stand"], gift: ["General store", "Assay office shop", "Leather goods"], booth: ["Shooting gallery", "Horseshoe toss", "Gold panning"] } },
];
registerVariants(PARK.KEY, PARK_VARIANTS.map((v) => {
  const S = REAL_SIZE.amusement.sizes[v.id];
  return { id: v.id, name: v.name, w: v.w, sizeClass: v.sizeClass, foot: [S.w[1], S.d[1], S.storeys[1]], src: v };
}));

const seedOf = (...k) => Math.floor(hash01(...k) * 4294967296);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/**
 * The park's variant: option.plan / option.variant pins one; else by the tile's class (option.setting: a test's or a
 * crawl's word) and its own dice. @param {any} state @param {number} tileId @param {any} option
 */
export function parkVariant(state, tileId, option = {}) {
  const pin = option.plan || option.variant || option.layout || null;
  const cls = option.setting || (state && state.tiles ? placementCtx(state, tileId, PARK.KEY).tileClass : "suburb");
  const r = hash01(state ? state.seed : 0, "parkvariant", tileId, option.id || "park");
  const e = /** @type {any} */ (pickVariant(PARK.KEY, null, { setting: cls, tileClass: cls, size: sizeFor(PARK.KEY, cls), plan: pin, r }));
  return e ? e.src : PARK_VARIANTS[1];
}

// ---------- the buildings ----------
// A building of the park (amusementlayout.js PARK_PLANS) from its own dice (the seed, the tile, the park, its number).
function buildPart(ctx, kind, o = {}) {
  const k = ctx.k++;
  const rng = new Rng(seedOf(ctx.state.seed, "parkunit", ctx.tileId, ctx.option.id, k));
  const spec = PARK_PLANS[kind](rng, o);
  if (ctx.V.abandoned) thinOut(spec.program);
  const name = o.name || defaultName(kind, o);
  const m = assemble(rng, spec, { key: PARK.KEY, id: `${ctx.option.id}#${k}`, name, legacy: false });
  return { m, name, kind, k };
}
// An abandoned park's rooms hold less (picked over for years): every leaf one container at most.
function thinOut(node) {
  if (!node) return;
  if (node.parts) { for (const [, p] of node.parts) thinOut(p); return; }
  node.maxBoxes = Math.min(node.maxBoxes || 1, 1);
}
const NAMES = { stand: "Food stand", booth: "Games booth", gift: "Gift shop", aid: "First-aid station", maint: "Maintenance shop", admin: "Guest services", staff: "Employee area", arcade: "Arcade", hall: "Exhibition hall", barn: "Livestock barn", changing: "Changing rooms", jumphall: "Trampoline hall" };
const STANDS = ["Popcorn stand", "Corn dog stand", "Funnel cake stand", "Lemonade stand", "Pizza stand", "Burger grill", "Cotton candy stand", "Ice cream stand", "Pretzel cart stand", "Fried dough stand"];
const BOOTHS = ["Ring toss", "Balloon darts", "Milk bottle pitch", "Water gun race", "Duck pond", "Basketball shoot", "Whack-a-mole", "High striker", "Shooting gallery", "Skee-ball"];
function defaultName(kind, o) { return o.ride ? `${o.ride} station` : NAMES[kind] || kind; }
function nameOf(ctx, kind) {
  const own = ctx.V.names && ctx.V.names[kind], list = own || (kind === "stand" ? STANDS : kind === "booth" ? BOOTHS : null);
  if (!list) return null;
  const n = (ctx.used[kind] = (ctx.used[kind] || 0) + 1);
  const base = list[(n - 1 + ctx.salt) % list.length];
  return n > list.length ? `${base} ${Math.ceil(n / list.length)}` : base;
}
/** Places a built part at (x, y), facing south; its doors kept clear. */
function put(ctx, b, x, y, role) {
  const { C } = ctx;
  const part = placeBuilding(C, b.m, { x0: x, y0: y, face: "s", k: C.parts.length, name: b.name, key: PARK.KEY, tag: { part: { role, kind: b.kind } } });
  part.role = role;
  ctx.units.push({ kind: b.kind, part, name: b.name, role });
  if (ctx.V.abandoned && part.front && ctx.rng.chance(0.35)) { // boarded up: its front door nailed shut
    for (const [fx, fy] of part.front.cells) { const c = C.cells[fy * C.W + fx]; if (c && (c.k === "idoor" || c.k === "odoor")) { c.k = "door"; c.dk = "wood"; c.hp = c.mhp = 40; C.lockedDoors.push({ x: fx, y: fy, f: 0, area: null, kind: "door", dk: "wood" }); } }
  }
  return part;
}

// ---------- the rides (drawn after the guard: compound.js guard keeps every walkable cell joined) ----------
let pcNo = 900000;
/** A piece of w × h cells (all or nothing), c.pc shared. */
function piece(G, x, y, k, w = 1, h = 1, fc = "s") {
  const pc = ++pcNo, done = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) { if (!G.block(x + dx, y + dy, k, { fc, pc })) { for (const [ux, uy] of done) G.unblock(ux, uy); return false; } done.push([x + dx, y + dy]); }
  return true;
}
const outArea = (C, o) => { const a = { id: C.areas.length, type: o.type ?? null, name: o.name, outdoor: true, f: 0, x0: o.x0, y0: o.y0, w: o.w, h: o.h, house: null, ...(o.ride ? { ride: o.ride } : {}) }; C.areas.push(a); return a; };
const boxIn = (C, a, x, y, kind, w = 1, h = 1) => C.containers.push({ id: C.cid++, x, y, ...(w > 1 || h > 1 ? { w, h } : {}), f: 0, area: a.id, kind, searched: false, label: `${a.name}: ${kind === "gokart" ? "go-kart" : kind === "drum" ? "fuel drum" : kind}` });
const setFloor = (C, x0, y0, w, h, f) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const c = C.cells[y * C.W + x]; if (c && c.k === "open" && !C.built[y * C.W + x]) c.f = f; } };

const RIDES = {
  // A roller coaster: its track round the plot (the guard leaves the way in), a straight across, its train stalled on it.
  coaster: { w: [54, 70], h: [34, 44], draw(ctx, G, r, name) {
    const { C, rng } = ctx, x0 = r.x0 + 1, y0 = r.y0 + 1, x1 = r.x0 + r.w - 2, y1 = r.y0 + r.h - 2, mid = Math.floor((x0 + x1) / 2);
    const loop = [];
    for (let x = mid; x <= x1; x++) loop.push([x, y1]);
    for (let y = y1 - 1; y >= y0; y--) loop.push([x1, y]);
    for (let x = x1 - 1; x >= x0; x--) loop.push([x, y0]);
    for (let y = y0 + 1; y <= y1; y++) loop.push([x0, y]);
    for (let x = x0 + 1; x < mid; x++) loop.push([x, y1]);
    for (const [x, y] of loop) G.block(x, y, "coastertrack");
    const yc = y0 + Math.floor((y1 - y0) / 3);
    for (let x = x0 + 6; x <= x1 - 6; x++) G.block(x, yc, "coastertrack");
    // The train stalled on the top straight: two to four cars where the track runs along x.
    const at = rng.int(x0 + 3, Math.max(x0 + 3, x1 - 12)), cars = rng.int(2, 4), pc = ++pcNo;
    for (let i = 0; i < cars; i++) for (let j = 0; j < 2; j++) { const c = C.cells[y0 * C.W + at + i * 2 + j]; if (c && c.k === "coastertrack") Object.assign(c, { k: "coastercar", fc: "e", pc: pc + i }); }
    pcNo += cars;
    outArea(C, { name: name || "Roller coaster", ride: "coaster", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  }, station: true },
  ferris: { w: [16, 18], h: [16, 18], draw(ctx, G, r, name) {
    const cx = r.x0 + Math.floor(r.w / 2) - 1, cy = r.y0 + Math.floor(r.h / 2) - 1;
    piece(G, cx, cy, "ferriswheel", 2, 2);
    for (let i = -3; i <= 4; i += 2) G.block(cx + i, cy + 5, "stanchion");
    G.block(cx + 4, cy + 3, "ticketbooth");
    outArea(ctx.C, { name: name || "Ferris wheel", ride: "ferris", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  } },
  carousel: { w: [12, 14], h: [12, 14], draw(ctx, G, r, name) {
    const cx = r.x0 + Math.floor(r.w / 2) - 1, cy = r.y0 + Math.floor(r.h / 2) - 1;
    piece(G, cx, cy, "carousel", 2, 2);
    for (const [dx, dy] of [[-3, 0], [4, 0], [0, -3], [0, 4]]) piece(G, cx + dx, cy + dy, "mallbench", dy ? 2 : 1, 1);
    outArea(ctx.C, { name: name || "Carousel", ride: "carousel", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  } },
  teacups: { w: [16, 18], h: [16, 18], draw(ctx, G, r, name) {
    for (const [dx, dy] of [[3, 3], [r.w - 6, 3], [3, r.h - 6], [r.w - 6, r.h - 6], [Math.floor(r.w / 2) - 1, Math.floor(r.h / 2) - 1]]) piece(G, r.x0 + dx, r.y0 + dy, "teacup", 2, 2);
    outArea(ctx.C, { name: name || "Spinning teacups", ride: "teacups", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  } },
  kiddie: { w: [14, 16], h: [12, 14], draw(ctx, G, r, name) {
    piece(G, r.x0 + 2, r.y0 + 2, "teacup", 2, 2); piece(G, r.x0 + r.w - 5, r.y0 + 2, "teacup", 2, 2);
    piece(G, r.x0 + Math.floor(r.w / 2) - 1, r.y0 + r.h - 5, "carousel", 2, 2);
    outArea(ctx.C, { name: name || "Kiddie rides", ride: "kiddie", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  } },
  slides: { w: [22, 26], h: [18, 22], draw(ctx, G, r, name) {
    const { C } = ctx;
    setFloor(C, r.x0 + 3, r.y0 + 6, r.w - 6, r.h - 9, "pool");
    piece(G, r.x0 + 3, r.y0 + 2, "waterslide", 2, 2); piece(G, r.x0 + r.w - 5, r.y0 + 2, "waterslide", 2, 2);
    for (let x = r.x0 + 3; x < r.x0 + r.w - 3; x += 3) G.block(x, r.y0 + r.h - 2, "lounger");
    outArea(C, { name: name || "Slide tower", ride: "slides", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  } },
  wavepool: { w: [40, 48], h: [28, 34], draw(ctx, G, r, name) {
    const { C } = ctx;
    setFloor(C, r.x0 + 3, r.y0 + 2, r.w - 6, r.h - 8, "pool");
    for (let x = r.x0 + 3; x < r.x0 + r.w - 3; x += 3) G.block(x, r.y0 + r.h - 3, "lounger");
    G.block(r.x0 + 1, r.y0 + Math.floor(r.h / 2), "ticketbooth");
    outArea(C, { name: name || "Wave pool", ride: "wavepool", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  } },
  lazyriver: { w: [40, 46], h: [30, 34], draw(ctx, G, r, name) {
    const { C } = ctx;
    for (let y = r.y0 + 2; y < r.y0 + r.h - 2; y++) for (let x = r.x0 + 2; x < r.x0 + r.w - 2; x++) {
      const e = Math.min(x - r.x0 - 2, r.x0 + r.w - 3 - x, y - r.y0 - 2, r.y0 + r.h - 3 - y);
      if (e < 4) { const c = C.cells[y * C.W + x]; if (c && c.k === "open") c.f = "pool"; }
    }
    for (let i = 0; i < 6; i++) G.block(r.x0 + 8 + i * 4, r.y0 + Math.floor(r.h / 2), "patiotable");
    outArea(C, { name: name || "Lazy river", ride: "lazyriver", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  } },
  // The go-kart track: a ring of asphalt, tyre walls along its inside, the karts left on it (their tanks: fuel), the pit's drums.
  gokart: { w: [60, 70], h: [34, 40], draw(ctx, G, r, name) {
    const { C, rng } = ctx;
    for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) {
      const e = Math.min(x - r.x0 - 1, r.x0 + r.w - 2 - x, y - r.y0 - 1, r.y0 + r.h - 2 - y);
      if (e < 5) { const c = C.cells[y * C.W + x]; if (c && c.k === "open" && !C.built[y * C.W + x]) c.f = "road"; }
    }
    for (let x = r.x0 + 7; x < r.x0 + r.w - 7; x += 2) { G.block(x, r.y0 + 6, "tirerack"); G.block(x, r.y0 + r.h - 7, "tirerack"); }
    const a = outArea(C, { type: "parkfuel", name: name || "Go-kart track", ride: "gokart", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
    const n = rng.int(4, 7);
    for (let i = 0, put = 0; i < 30 && put < n; i++) {
      const x = rng.int(r.x0 + 3, r.x0 + r.w - 6), y = rng.chance(0.5) ? r.y0 + rng.int(2, 4) : r.y0 + r.h - rng.int(3, 5);
      if (piece(G, x, y, "gokart", 2, 1, "e")) { boxIn(C, a, x, y, "gokart", 2, 1); put++; }
    }
    for (let i = 0; i < 3; i++) if (G.block(r.x0 + 10 + i * 2, r.y0 + Math.floor(r.h / 2), "drum")) boxIn(C, a, r.x0 + 10 + i * 2, r.y0 + Math.floor(r.h / 2), "drum");
  } },
  minigolf: { w: [40, 46], h: [26, 30], draw(ctx, G, r, name) {
    const { C, rng } = ctx;
    for (let y = r.y0 + 2; y + 5 < r.y0 + r.h; y += 8) for (let x = r.x0 + 2; x + 8 < r.x0 + r.w; x += 11) setFloor(C, x, y, 8, 5, "court");
    piece(G, r.x0 + 5, r.y0 + 3, "windmill", 2, 2);
    for (let i = 0; i < 4; i++) G.block(rng.int(r.x0 + 2, r.x0 + r.w - 3), rng.int(r.y0 + 2, r.y0 + r.h - 3), "planter");
    outArea(C, { name: name || "Mini-golf course", ride: "minigolf", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  } },
  lights: { w: [36, 44], h: [26, 32], draw(ctx, G, r, name) {
    for (let y = r.y0 + 2; y < r.y0 + r.h - 2; y += 3) for (let x = r.x0 + 2; x < r.x0 + r.w - 2; x += 3) G.block(x, y, "lightdisplay");
    outArea(ctx.C, { name: name || "Light display", ride: "lights", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  } },
  grandstand: { w: [44, 50], h: [26, 30], draw(ctx, G, r, name) {
    const { C } = ctx;
    for (let x = r.x0 + 2; x + 1 < r.x0 + r.w - 2; x += 2) piece(G, x, r.y0 + 1, "bleachers", 2, 2, "s");
    setFloor(C, r.x0 + 2, r.y0 + 6, r.w - 4, r.h - 8, "dirt");
    for (let x = r.x0 + 2; x < r.x0 + r.w - 2; x++) if ((x - r.x0) % 10) G.block(x, r.y0 + 5, "fence");
    outArea(C, { name: name || "Grandstand and arena", ride: "grandstand", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  } },
  pens: { w: [26, 30], h: [16, 18], draw(ctx, G, r, name) {
    for (let px = r.x0 + 1; px + 6 < r.x0 + r.w; px += 8) {
      for (let i = 0; i < 6; i++) { G.block(px + i, r.y0 + 2, "fence"); G.block(px + i, r.y0 + 9, "fence"); if (i < 7) { G.block(px, r.y0 + 2 + i, "fence"); if (i !== 3) G.block(px + 6, r.y0 + 2 + i, "fence"); } }
      G.block(px + 2, r.y0 + 5, "hay");
    }
    outArea(ctx.C, { name: name || "Livestock pens", ride: "pens", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  } },
  picnic: { w: [16, 20], h: [12, 14], draw(ctx, G, r, name) {
    for (let y = r.y0 + 2; y < r.y0 + r.h - 2; y += 4) for (let x = r.x0 + 2; x < r.x0 + r.w - 2; x += 4) G.block(x, y, "patiotable");
    outArea(ctx.C, { name: name || "Picnic grove", x0: r.x0, y0: r.y0, w: r.w, h: r.h });
  } },
};

// ---------- the map ----------
/** The park's whole map (buildingmaps.js buildingMap for an amusement park). */
export function parkMap(state, tileId, option, withVehicle) {
  registerParkScenes(); // amusementlayout.js: the parks' scenes, before buildingmaps.js rolls them
  const V = parkVariant(state, tileId, option);
  const rng = new Rng(seedOf(state.seed, "park", tileId, option.id));
  const S = REAL_SIZE.amusement.sizes[V.id], cap = mapCap(PARK.KEY) || 500;
  const W = clamp(rng.int(S.w[0], S.w[1]), 80, cap), H = clamp(rng.int(S.d[0], S.d[1]), 80, cap);
  const ctx = { state, tileId, option, V, rng, W, H, C: null, k: 0, units: [], rides: [], used: {}, salt: rng.int(0, 9), storeys: rng.int(S.storeys[0], S.storeys[1]) };
  const out = V.theme === "pier" ? pierPark(ctx, withVehicle) : V.theme === "hall" ? jumpPark(ctx, withVehicle) : groundsPark(ctx, withVehicle);
  // The dead: the roster × the park's area (an abandoned park's thick with them).
  out.deadScale = clamp(PARK.DEAD * Math.pow((W * H) / PARK.DEAD_AREA, PARK.DEAD_EXP) * (V.abandoned ? 1.3 : 1), 0.6, PARK.DEAD_MAX);
  return out;
}
/** How many buildings the park's map holds (poicont.js poiHouses). */
export function parkBuildings(state, tileId, option) { return parkMap(state, tileId, option, false).plan.houses.length; }

const zone = (x0, y0, side, name) => ({ x0, y0, w: 3, h: 3, side, exit: side, name, vehicle: false });
// The rides' and the buildings' list for a variant, from its dice.
function program(ctx) {
  const { V, rng } = ctx, feats = [];
  for (const [ride, n] of Object.entries(V.rides || {})) for (let i = 0, m = rng.int(n[0], n[1]); i < m; i++) {
    if (ride === "pavilion") { feats.push({ bld: "pavilion", role: "ride", o: { name: rng.chance(0.6) ? "Bumper cars" : "Carousel pavilion", ride: null } }); continue; }
    const R = RIDES[ride];
    feats.push({ ride, w: rng.int(R.w[0], R.w[1]), h: rng.int(R.h[0], R.h[1]), name: ride === "coaster" ? COASTERS[(ctx.salt + i * 5 + ctx.rides.length) % COASTERS.length] : null });
  }
  for (const [kind, n] of Object.entries(V.blds || {})) for (let i = 0, m = rng.int(n[0], n[1]); i < m; i++) feats.push({ bld: kind, role: kind, o: { name: nameOf(ctx, kind) || undefined } });
  for (const f of feats) if (f.bld === "pavilion") { f.o.ride = /Bumper/.test(f.o.name) ? "bumper" : "carousel"; f.o.name = f.o.name; }
  // Big things first, so the blocks take them; then the stands and booths in the dice's order.
  return feats.map((f, i) => ({ ...f, j: rng.next() + (f.ride ? 0 : 1) + i * 1e-6 })).sort((a, b) => a.j - b.j);
}

// A park on open grounds: the road and the lot to the south, the gate's plaza, the fence, the midway up the middle and
// the cross paths, the blocks of rides and buildings, the back of house to the north.
function groundsPark(ctx, withVehicle) {
  const { V, rng, W, H } = ctx, P = PARK;
  const lot = V.lot || P.LOT, sea = V.sea ? 18 : 0, ground = V.ground || "grass";
  const roadY = H - P.ROAD, fenceS = roadY - lot - 1, fenceN = P.EDGE + sea, fx0 = P.EDGE, fx1 = W - P.EDGE - 1;
  const C = (ctx.C = compoundGrid(W, H, Math.max(1, ctx.storeys), (x, y) => (y >= roadY ? "road" : y < sea ? (y < sea - 6 ? "water" : "dirt") : y > fenceS ? "gravel" : ground)));
  // The sea along the north of a seaside funfair: water past the beach.
  if (sea) for (let y = 0; y < sea - 6; y++) for (let x = 0; x < W; x++) C.cells[y * W + x] = { k: "water", f: "water" };
  const mx0 = Math.floor(W / 2) - Math.floor(P.MIDWAY / 2), mx1 = mx0 + P.MIDWAY - 1;
  // The fence: the main gate to the south on the midway, the service gate north (none on a seaside funfair: the beach is open).
  const gx0 = Math.floor(W / 2) - Math.floor(P.GATE / 2), sx0 = Math.floor(W / 4);
  const fence = (x, y) => { const c = C.cells[y * W + x]; if (c && c.k === "open") { c.k = "fence"; } };
  for (let x = fx0; x <= fx1; x++) { if (x < gx0 || x >= gx0 + P.GATE) fence(x, fenceS); if (!sea && (x < sx0 || x >= sx0 + P.SERVICE)) fence(x, fenceN); }
  for (let y = fenceN; y <= fenceS; y++) { fence(fx0, y); fence(fx1, y); }
  if (sea) for (let x = fx0; x <= fx1; x++) { const c = C.cells[fenceN * W + x]; if (c.k === "fence") c.k = "open"; } // open to the beach
  // The midway, the plaza and the back of house's line.
  const boh = V.boh ? Math.max(P.BOH, V.boh) : 0, bohY = fenceN + boh, plazaY = fenceS - P.PLAZA;
  const pave = (x0, y0, w, h, f = "paving") => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const c = C.cells[y * W + x]; if (c && c.k === "open") c.f = f; } };
  pave(mx0, bohY + 1, P.MIDWAY, fenceS - bohY - 1);
  pave(fx0 + 1, plazaY, fx1 - fx0 - 1, P.PLAZA);
  if (boh) for (let x = fx0 + 1; x < fx1; x++) if (x < mx0 || x > mx1) fence(x, bohY);
  // The cross paths, a block's depth apart.
  const rows = [];
  let y = bohY + 2;
  while (y < plazaY - 12) { const d = rng.int(V.block[0], V.block[1]); const y1 = Math.min(plazaY - 2, y + d); rows.push([y, y1]); if (y1 + P.PATH + 1 < plazaY - 12) pave(fx0 + 1, y1 + 1, fx1 - fx0 - 1, P.PATH); y = y1 + P.PATH + 2; }
  if (V.loop) { // a holiday light park's drive-through loop: a road ring inside the fence
    for (let yy = bohY + 2; yy < plazaY - 1; yy++) for (const xx of [fx0 + 2, fx0 + 3, fx0 + 4, fx1 - 4, fx1 - 3, fx1 - 2]) { const c = C.cells[yy * W + xx]; if (c.k === "open") c.f = "road"; }
    for (const yy of [bohY + 2, bohY + 3, bohY + 4]) for (let xx = fx0 + 2; xx <= fx1 - 2; xx++) { const c = C.cells[yy * W + xx]; if (c.k === "open") c.f = "road"; }
  }
  const side = V.loop ? 7 : 2;
  const blocks = [];
  for (const [y0, y1] of rows) { blocks.push({ x0: fx0 + side, x1: mx0 - 3, y0, y1, cx: fx0 + side, cy: y0, rh: 0 }); blocks.push({ x0: mx1 + 3, x1: fx1 - side, y0, y1, cx: mx1 + 3, cy: y0, rh: 0 }); }
  // Pack the program: each thing into the first block with room (a shelf a row), the blocks taken in turn.
  const feats = program(ctx), rides = [];
  const fit = (w, h) => {
    for (let t = 0; t < blocks.length; t++) {
      const b = blocks[(ctx.bi = ((ctx.bi || 0) + (t ? 1 : 0)) % blocks.length)];
      if (b.cx + w > b.x1) { b.cy += b.rh + P.GAP; b.cx = b.x0; b.rh = 0; }
      if (b.cx + w <= b.x1 && b.cy + h <= b.y1) { const at = [b.cx, b.cy]; b.cx += w + P.GAP; b.rh = Math.max(b.rh, h); ctx.bi = (ctx.bi + 1) % blocks.length; return at; }
    }
    return null;
  };
  for (const f of feats) {
    if (f.ride) {
      const R = RIDES[f.ride];
      const st = R.station ? buildPart(ctx, "station", { ride: f.name }) : null;
      const at = fit(f.w, f.h);
      if (!at) continue;
      const r = { x0: at[0], y0: at[1], w: f.w, h: f.h };
      if (st) { const bw = st.m.building.w, bh = st.m.building.h; put(ctx, st, r.x0 + Math.floor((r.w - bw) / 2), r.y0 + r.h - bh - 4, "station"); }
      rides.push({ ...f, r });
    } else {
      const b = buildPart(ctx, f.bld, f.o);
      const at = fit(b.m.building.w, b.m.building.h + 2);
      if (at) put(ctx, b, at[0], at[1], f.role);
    }
  }
  // The plaza: guest services and the gift shop by the gate; the back of house: the maintenance shop, the employee area.
  const plazaB = [buildPart(ctx, "admin", { storeys: Math.min(2, ctx.storeys) }), ...(V.blds && V.blds.gift ? [buildPart(ctx, "gift", { name: "Main gate gift shop" })] : [])];
  let px = fx0 + 3;
  for (const b of plazaB) { const bh = b.m.building.h; if (px + b.m.building.w < mx0 - 2 && bh < P.PLAZA - 2) { put(ctx, b, px, plazaY + 1, b.kind === "admin" ? "admin" : "gift"); px += b.m.building.w + P.GAP; } else if (bh < P.PLAZA - 2) put(ctx, b, mx1 + 4, plazaY + 1, "gift"); }
  const backB = [buildPart(ctx, "maint"), buildPart(ctx, "staff")];
  let bx = sx0 + P.SERVICE + 6;
  const by = boh ? fenceN + 2 : null;
  for (const b of backB) {
    const bw = b.m.building.w, bh = b.m.building.h;
    if (by != null && bh + 3 < boh && bx + bw < fx1 - 2) { if (bx <= mx1 + 1 && bx + bw >= mx0 - 1) bx = mx1 + 3; put(ctx, b, bx, by, b.kind); bx += bw + P.GAP; }
    else { const at = fit(bw, bh + 2); if (at) put(ctx, b, at[0], at[1], b.kind); }
  }
  // The ways out.
  const zones = [zone(Math.floor(W / 2) - 1, H - 3, "south", "The road (front)"), zone(0, roadY + 1, "west", "The road west"), zone(W - 3, roadY + 1, "east", "The road east"),
    sea ? zone(Math.floor(W / 2) - 1, sea - 5, "north", "The beach") : zone(sx0 + 1, 0, "north", "Service gate"), zone(0, Math.floor((fenceN + fenceS) / 2), "west", "West side"), zone(W - 3, Math.floor((fenceN + fenceS) / 2), "east", "East side")];
  const G = guard(C, zones[0].x0 + 1, zones[0].y0 + 1, { free: (x, yy) => x > 0 && yy > 0 && x < W - 1 && yy < H - 1 && C.cells[yy * W + x].k === "open" && !C.keep[yy * W + x] && !C.built[yy * W + x] && !zones.some((z) => x >= z.x0 - 1 && x <= z.x0 + z.w && yy >= z.y0 - 1 && yy <= z.y0 + z.h) });
  for (const f of rides) RIDES[f.ride].draw(ctx, G, f.r, f.name);
  ctx.rides = rides;
  // The gate: ticket booths at its sides, turnstiles across it every other cell.
  G.block(gx0 - 2, fenceS - 2, "ticketbooth"); G.block(gx0 + P.GATE + 1, fenceS - 2, "ticketbooth");
  for (let x = gx0 + 1; x < gx0 + P.GATE - 1; x += 2) G.block(x, fenceS, "turnstile");
  // The back of house's generator and fuel yard.
  if (boh) {
    const a = outArea(C, { type: "parkfuel", name: "Generator yard", x0: fx1 - 22, y0: fenceN + 2, w: 18, h: Math.min(12, boh - 3) });
    piece(G, a.x0 + 2, a.y0 + 2, "genset", 2, 2);
    for (let i = 0; i < rng.int(2, 4); i++) if (G.block(a.x0 + 6 + i * 2, a.y0 + 2, "drum")) boxIn(C, a, a.x0 + 6 + i * 2, a.y0 + 2, "drum");
  }
  // Lamps and bins along the midway, trees and benches on the grass (an abandoned park's overgrown).
  for (let yy = bohY + 4; yy < plazaY; yy += P.LAMPS) { G.block(mx0 - 1, yy, "lamp"); G.block(mx1 + 1, yy + 6, "lamp"); G.block(mx0 - 1, yy + 9, "mallbench"); }
  const trees = Math.round(W * H * P.TREES * (V.abandoned ? 4 : 1));
  for (let i = 0; i < trees; i++) { const x = rng.int(1, W - 2), yy = rng.int(sea + 1, fenceS - 1); if (C.cells[yy * W + x].f === ground) G.block(x, yy, V.abandoned && rng.chance(0.5) ? "bush" : "tree"); }
  // The lot between the gate and the road.
  parkingLot(C, G, { x0: 6, y0: fenceS + 2, w: W - 12, h: Math.max(10, roadY - fenceS - 3) }, rng, { name: "Parking lot", parked: V.abandoned ? 0.12 : 0.4 });
  return finish(ctx, zones, withVehicle);
}

// A boardwalk pier: the beach, the road and the lot to the south; the deck out over the water, its railings, the rides
// and the stands along it, the arcade, a coaster at the end.
function pierPark(ctx, withVehicle) {
  const { V, rng, W, H } = ctx, P = PARK;
  const roadY = H - P.ROAD, lotY = roadY - 24, beachY = lotY - 24;
  const dx0 = 10, dx1 = W - 11, deckY = 6;
  const C = (ctx.C = compoundGrid(W, H, Math.max(1, ctx.storeys), (x, y) => (y >= roadY ? "road" : y >= lotY ? "gravel" : y >= beachY ? "dirt" : "deck")));
  for (let y = 0; y < beachY; y++) for (let x = 0; x < W; x++) if (x < dx0 || x > dx1 || y < deckY) C.cells[y * W + x] = { k: "water", f: "water" };
  for (let y = deckY; y < beachY; y++) { C.cells[y * W + dx0] = { k: "rail", f: "deck" }; C.cells[y * W + dx1] = { k: "rail", f: "deck" }; }
  for (let x = dx0; x <= dx1; x++) C.cells[deckY * W + x] = { k: "rail", f: "deck" };
  const mx0 = Math.floor(W / 2) - 3, mx1 = mx0 + 5;
  for (let y = deckY + 1; y < beachY; y++) for (let x = mx0; x <= mx1; x++) C.cells[y * W + x].f = "paving";
  const blocks = [{ x0: dx0 + 2, x1: mx0 - 2, y0: deckY + 2, y1: beachY - 4, cx: dx0 + 2, cy: deckY + 2, rh: 0 }, { x0: mx1 + 2, x1: dx1 - 2, y0: deckY + 2, y1: beachY - 4, cx: mx1 + 2, cy: deckY + 2, rh: 0 }];
  const feats = program(ctx), rides = [];
  const fit = (w, h) => {
    for (const b of [...blocks].sort((p, q) => p.cy - q.cy)) {
      if (b.cx + w > b.x1) { b.cy += b.rh + P.GAP; b.cx = b.x0; b.rh = 0; }
      if (b.cx + w <= b.x1 && b.cy + h <= b.y1) { const at = [b.cx, b.cy]; b.cx += w + P.GAP; b.rh = Math.max(b.rh, h); return at; }
    }
    return null;
  };
  for (const f of feats) {
    if (f.ride) {
      const R = RIDES[f.ride], w = Math.min(f.w, mx0 - dx0 - 4), h = f.h;
      const st = R.station ? buildPart(ctx, "station", { ride: f.name }) : null;
      const at = fit(w, h);
      if (!at) continue;
      const r = { x0: at[0], y0: at[1], w, h };
      if (st && st.m.building.w < w - 4) put(ctx, st, r.x0 + Math.floor((w - st.m.building.w) / 2), r.y0 + h - st.m.building.h - 4, "station");
      rides.push({ ...f, r });
    } else {
      const b = buildPart(ctx, f.bld, f.o);
      const at = fit(b.m.building.w, b.m.building.h + 2);
      if (at) put(ctx, b, at[0], at[1], f.role);
    }
  }
  // On the beach by the road: the boardwalk's office and the maintenance shop.
  let bx = 4;
  for (const b of [buildPart(ctx, "admin", { storeys: Math.min(2, ctx.storeys) }), buildPart(ctx, "maint"), buildPart(ctx, "staff")]) {
    if (bx + b.m.building.w > W - 4 || (bx < mx1 + 2 && bx + b.m.building.w > mx0 - 2)) bx = Math.max(bx, mx1 + 3);
    if (bx + b.m.building.w > W - 4 || b.m.building.h > lotY - beachY - 2) continue;
    put(ctx, b, bx, beachY + 1, b.kind); bx += b.m.building.w + P.GAP;
  }
  const zones = [zone(Math.floor(W / 2) - 1, H - 3, "south", "The road (front)"), zone(0, roadY + 1, "west", "The road west"), zone(W - 3, roadY + 1, "east", "The road east"), zone(0, beachY + 2, "west", "The beach west"), zone(W - 3, beachY + 2, "east", "The beach east")];
  const G = guard(C, zones[0].x0 + 1, zones[0].y0 + 1, { free: (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && C.cells[y * W + x].k === "open" && !C.keep[y * W + x] && !C.built[y * W + x] && !zones.some((z) => x >= z.x0 - 1 && x <= z.x0 + z.w && y >= z.y0 - 1 && y <= z.y0 + z.h) });
  for (const f of rides) RIDES[f.ride].draw(ctx, G, f.r, f.name);
  ctx.rides = rides;
  for (let y = deckY + 6; y < beachY; y += P.LAMPS) { G.block(mx0 - 1, y, "lamp"); G.block(mx1 + 1, y + 7, "mallbench"); }
  parkingLot(C, G, { x0: 4, y0: lotY + 1, w: W - 8, h: roadY - lotY - 2 }, rng, { name: "Boardwalk parking", parked: 0.4 });
  return finish(ctx, zones, withVehicle);
}

// A trampoline park: one big hall (its courts, the café, the party room, the front desk), a maintenance shed, the lot.
function jumpPark(ctx, withVehicle) {
  const { rng, W, H } = ctx, P = PARK;
  const roadY = H - P.ROAD;
  const C = (ctx.C = compoundGrid(W, H, Math.max(1, ctx.storeys), (x, y) => (y >= roadY ? "road" : "gravel")));
  const hall = buildPart(ctx, "jumphall", { storeys: 1 });
  const hw = Math.min(hall.m.building.w, W - 12), hx = Math.floor((W - hall.m.building.w) / 2);
  put(ctx, hall, Math.max(4, hx), 6, "hall");
  const hy1 = 6 + hall.m.building.h;
  const shed = buildPart(ctx, "maint", { name: "Maintenance shed" });
  if (shed.m.building.h + hy1 + 6 < roadY - 14 && shed.m.building.w < W - 8) put(ctx, shed, W - shed.m.building.w - 4, hy1 + 3, "maint");
  const zones = [zone(Math.floor(W / 2) - 1, H - 3, "south", "The road (front)"), zone(0, roadY + 1, "west", "The road west"), zone(W - 3, roadY + 1, "east", "The road east"), zone(Math.floor(W / 2) - 1, 0, "north", "Behind the hall")];
  const G = guard(C, zones[0].x0 + 1, zones[0].y0 + 1, { free: (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && C.cells[y * W + x].k === "open" && !C.keep[y * W + x] && !C.built[y * W + x] && !zones.some((z) => x >= z.x0 - 1 && x <= z.x0 + z.w && y >= z.y0 - 1 && y <= z.y0 + z.h) });
  for (let i = 0; i < 6; i++) G.block(rng.int(2, W - 3), rng.int(2, 5), rng.chance(0.5) ? "dumpster" : "crate");
  parkingLot(C, G, { x0: 4, y0: hy1 + 3, w: Math.max(20, W - 8 - (C.parts.length > 1 ? 34 : 0)), h: Math.max(12, roadY - hy1 - 5) }, rng, { name: "Parking lot", parked: 0.35 });
  void hw;
  return finish(ctx, zones, withVehicle);
}

// The rooms the dead crowd; the plan's fields for the intro and the tests.
function finish(ctx, zones, withVehicle) {
  const { C, V } = ctx;
  for (const a of C.areas) if (a.role === "pkstand" || a.role === "pkstation") a.deadW = 1.4;
  const vehicle = compoundVehicle(C, zones[0], withVehicle);
  const count = (role) => ctx.units.filter((u) => u.role === role).length;
  const rides = (ctx.rides || []).map((f) => ({ ride: f.ride, name: f.name || null }));
  return compoundResult(C, {
    key: ctx.option.key, id: ctx.option.id, name: ctx.option.name, zones, vehicle, kind: PARK.KEY,
    extra: { park: true, vid: V.id, vname: V.name, variant: V.name, rides, stands: count("stand"), booths: count("booth"), ridesN: rides.length + count("ride"), abandoned: !!V.abandoned },
  });
}

// ---------- the hint and the intro (buildingmaps.js buildingHint, interiorIntro) ----------
export function parkHint() {
  const sig = [{ name: "Ride station", n: 2 }, { name: "Concession stand", n: 8 }, { name: "Games booth", n: 10 }, { name: "Gift shop", n: 2 }, { name: "First-aid station", n: 1 }, { name: "Maintenance shop", n: 1 }, { name: "Cash office", n: 1 }];
  return { hint: "Likely: snacks and drinks, prizes, first aid, tools and parts, fuel. Rides, food stands, a games midway, gift shops, the maintenance shop and the cash office.", size: "huge", rooms: 60, holds: ["concession", "midway", "giftshop", "parkaid", "ridemaint", "parkfuel", "cashoffice", "parkstaff"], sig };
}
/** @param {any} plan */
export function parkIntro(plan) {
  const parts = [`It is ${/^[AEIOU]/.test(plan.vname || "") ? "an" : "a"} ${(plan.vname || "amusement park").toLowerCase()}${plan.abandoned ? ", shut for years before the fall" : ""}: ${plan.ridesN} ride${plan.ridesN === 1 ? "" : "s"}, ${plan.stands} food stand${plan.stands === 1 ? "" : "s"}, ${plan.booths} games booth${plan.booths === 1 ? "" : "s"}.`];
  const coaster = (plan.rides || []).find((r) => r.ride === "coaster" && r.name);
  if (coaster) parts.push(`The ${coaster.name} stands stalled on its track.`);
  parts.push("Head for the maintenance shop (tools, parts, fuel), the cash office by the gate and the first-aid station.");
  return parts.join(" ");
}
