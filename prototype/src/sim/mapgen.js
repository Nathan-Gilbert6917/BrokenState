// Procedural generation of the State of Calder: terrain, rivers, cities, towns, countryside sites, roads, infection.
//
// Settlements, from busy to quiet:
// - Cities: Calder City in the south and a smaller second city far from it. A cluster of city and suburb tiles packed
//   with urban sites, several of a kind (police precincts, pharmacies, auto shops…), named by district.
// - Towns: sparse across the state. The center tile, a police station and an auto shop next to it, 0–2 other shops,
//   and 1–2 satellites a little further out (gas station, diner, motel, church…).
// - Countryside: scattered farms, barns, ranches, cabins, lodges, campgrounds, ranger stations, radio towers, quarries,
//   crash sites, plus truck stops and gas stations on the highways. Most of them are off the road.
// - Landmarks: at least one National Guard base (off-road, away from settlements), a prison, a dam, an airport,
//   factories.
// World sizes (worldsize.js): the counts above are the original 64 × 42 map's (worldsize.js BASE_W × BASE_H, the
// density unit). Every size scales the towns, countryside sites, landmarks and highway stops by area (areaScale) and
// takes its cities, military bases, origin hives and extra hot spots (a small cluster of hives each) from its size
// def. Since 2026-10-24 the presets are 150 × 75 to 500 × 300 (Normal 250 × 150, about 14 times the original: some
// 180 towns and 17 cities), so a seed builds a far bigger map than it did; only a custom 64 × 42 map still draws
// exactly the numbers the old Normal did.
// Names (2026-10-24, the user: "Make sure when any world map is built all city and POI names are unique"): every
// city, town and site name is unique on a map (usedNames, siteNames). The pools below give plain names first, then
// a distinguishing form of one (TOWN_FORMS "North Hadley", "Hadley Crossing", "Old Hadley"; SITE_FORMS "Upper Miller
// Farm"; CITY_FORMS "Port Ashby", "New Easton"), and a roman numeral ("Hadley II") as the last resort; the forms are
// tried in a fixed order and the extra pools (MORE_SURNAMES...) are drawn from only when the first pool's tries all
// collide, so a map whose pools never run dry draws exactly the dice it did. A Huge 500 × 300 map (some 700 towns,
// 65 cities, 8,000 named sites) stays well inside them: tools/uniquenametest.js.
// A placed site is tile.loc ={ type, name, zone, settlement? }: zone = urban | town | rural | special (data.js
// SITE_ZONES); settlement = center tile id of the city or town it belongs to.
import { HexGrid, findPath } from "./hex.js";
import { LOCATIONS, TOWN_NAMES } from "./data.js";
import { HIVE } from "./hiveconst.js";
import { sizeDef, areaScale, BASE_W, BASE_H } from "./worldsize.js";
import { hash01 } from "./skills.js"; // the town rings' radius: hash dice, so the map's own dice are untouched

// The Normal map (worldsize.js has every size; a world's own size is state.grid.width × height).
export const MAP_W = BASE_W;
export const MAP_H = BASE_H;

const TOWN_COUNT = 13; // on the original 64 × 42 map; scaled by area (about 180 on the new Normal, 2026-10-24)
// Town names for Large and Huge maps once data.js TOWN_NAMES are all taken (kept apart so Normal maps draw the same).
const MORE_TOWN_NAMES = ["Thornton", "Bridgeport", "Maple Grove", "Dover Flats", "Clearwater", "Hadley", "Sawyer", "Whitmore", "Linden",
  "Carver", "Brookfield", "Iron Gap", "Winslow", "Meadowvale", "Rockport", "Garland", "Tallow Creek", "Beckett", "Norwood", "Shiloh"];
// A third pool for the new sizes (2026-10-24; a Normal map alone has some 180 towns), drawn from once the two above are taken.
const EVEN_MORE_TOWN_NAMES = ["Alder", "Barlow", "Caswell", "Dunhill", "Edgewater", "Fenwick", "Gilead", "Hartwell", "Ivydale", "Jericho",
  "Kinsley", "Lockridge", "Marlow", "Nettleton", "Orchard Park", "Pembroke", "Quarry Ridge", "Rosewood", "Selby", "Tamarack", "Ulster",
  "Verona", "Wakefield", "Yarrow", "Ashby", "Bellwood", "Coldwater", "Dale City", "Elmhurst", "Foxboro", "Greenfield", "Hemlock",
  "Ironwood", "Juniper", "Kingfield", "Lowell", "Mansfield", "Newbury", "Oriole", "Paxton", "Rutland", "Sedgwick", "Trenton", "Wyndham"];
// A town's distinguishing forms once every plain name is taken: [prefix, suffix] round a plain name ("North Hadley", "Hadley Crossing").
const TOWN_FORMS = [["North ", ""], ["South ", ""], ["East ", ""], ["West ", ""], ["Old ", ""], ["New ", ""], ["Upper ", ""], ["Lower ", ""],
  ["", " Crossing"], ["", " Junction"], ["", " Springs"], ["", " Heights"], ["", " Mills"], ["", " Station"], ["", " Corners"], ["", " Hollow"],
  ["Fort ", ""], ["Port ", ""], ["Mount ", ""], ["Lake ", ""], ["Little ", ""], ["", " Falls"], ["", " Grove"], ["", " Landing"]];
const SECOND_CITY_NAMES =["Granite City", "Fairmont", "Kingsbridge", "Port Ashby", "Easton"];
// Custom mode's extra cities (custommode.js, up to 12 in all) once those are taken (kept apart so the second city draws the same).
const MORE_CITY_NAMES = ["Harlow", "Redfield", "Marston", "Brookhaven", "Westbury", "Ashland", "Dunmore"];
// The new sizes' cities (2026-10-24: Normal 17, Huge 65), then a form of one (CITY_FORMS: "New Easton", "Marston Falls").
const EVEN_MORE_CITY_NAMES = ["Carrollton", "Dunbar", "Elkton", "Glenrock", "Haverford", "Ironbridge", "Jasper", "Kendall", "Lakeshore",
  "Monroe", "Newhaven", "Oakdale", "Pinecrest", "Rivergate", "Stanton", "Thornbury", "Underwood", "Valemont", "Westmark", "Yardley",
  "Castlegate", "Milford", "Ridgefield", "Summerton", "Brightwater", "Coalport", "Ferndale", "Halstead", "Lindenhurst", "Norcross"];
const CITY_FORMS = [["New ", ""], ["Port ", ""], ["Fort ", ""], ["", " City"], ["", " Falls"], ["North ", ""], ["South ", ""], ["East ", ""], ["West ", ""], ["", " Heights"]];
const SURNAMES = ["Miller", "Hollis", "Ostrander", "Baker", "Kline", "Rourke", "Dale", "Pruitt", "Harmon", "Whitaker", "Calloway",
  "Brandt", "Yoder", "Lindgren", "Mercer", "Tate", "Grady", "Hensley", "Pickett", "Voss", "Sorensen", "Ames", "Caldwell", "Fenn"];
// Drawn from only when eight draws of SURNAMES / PLACE_NAMES all collide (2026-10-24: the big maps' hundreds of farms and cabins).
const MORE_SURNAMES = ["Abbott", "Bishop", "Cochran", "Dawes", "Ellery", "Farrow", "Gentry", "Hatcher", "Ingram", "Jarvis", "Keller",
  "Lowry", "Maddox", "Nolan", "Oakes", "Parrish", "Quinlan", "Radford", "Sayer", "Thorne", "Upton", "Vance", "Wheeler", "Yates",
  "Abernathy", "Bowman", "Crane", "Dempsey", "Easley", "Fletcher", "Goss", "Hurley", "Irwin", "Judd", "Kimball", "Lassiter", "Marsh",
  "Nash", "Overton", "Pryor", "Rigby", "Shaw", "Talbot", "Underhill", "Vickers", "Walsh", "Wilder", "Ziegler", "Albright", "Beck",
  "Corbin", "Dutton", "Emmett", "Flood", "Garner", "Holt", "Isley", "Jessup", "Kerr", "Latham", "McCall", "Neville", "Osgood",
  "Pratt", "Reyes", "Sutton", "Tillman", "Varley", "Weston", "Yancey", "Ambrose", "Boyd", "Crowley", "Dorsey", "Ewing", "Frost"];
const PLACE_NAMES = ["Elk Ridge", "Bear Lake", "Pine Hollow", "Cedar Hollow", "Eagle Rock", "Wolf Creek", "Stony Brook", "Blue Spruce",
  "Granite Peak", "Hawk Hill", "Silver Creek", "Juniper Flats", "Bitterroot", "Lone Pine", "Deer Run", "Owl Canyon", "Raven Point",
  "Spring Meadow", "Black Rock", "Willow Bend"];
const MORE_PLACE_NAMES = ["Aspen Draw", "Badger Flat", "Birch Knoll", "Boulder Gap", "Cougar Bluff", "Crow Butte", "Dry Fork", "Fox Run",
  "Heron Marsh", "Hidden Lake", "Kestrel Ridge", "Lynx Hollow", "Moose Meadow", "Otter Creek", "Pike Bend", "Quail Hill", "Red Cliff",
  "Sable Point", "Thunder Ridge", "Trout Lake", "Vulture Peak", "Wild Rose", "Beaver Dam", "Cold Brook", "Fawn Creek", "Grouse Hill"];
// A site's distinguishing forms once every candidate name is taken ("Upper Miller Farm", "North Hadley Gas station"), then a
// numeral. Tried from a form that moves on with every site named (no dice), so the forms vary across a big map.
const SITE_FORMS = ["North", "South", "East", "West", "Upper", "Lower", "Old", "New", "Little", "Big", "High", "Far", "Twin", "Back", "Long", "Stone"];
const ROMAN = ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

// Ponds (the user's words 2026-10-23: "add pond decor to the world map when a tile has a pond in the world map generate
// a pond in the battle map"): tile.pond, a spring-fed pond on the tile (drawn on the State Map: ui/terraindeco.js; a
// hollow of water on its base, fight and raid maps: basescatter.js SPRING, relief.js, ponds.js). Open land only
// (pondLand: farmland, countryside, forest, hills; never water or a river, a mountain, a city, the suburbs or a town's
// site; a countryside site, a farm or a cabin, may have one), P[terrain] of it by hash dice of the world's seed and the
// tile (skills.js hash01: the map's own dice untouched, so a seed builds the same map under them), laid last, on the
// ground the town rings left. About 1 tile in 20 of open land: some 100 on a Normal 64 × 42 map. A save from before ponds gets
// them from its seed on load (save.js, state.worldPonds).
export const WORLD_PONDS = { P: { plains: 0.06, forest: 0.05, hills: 0.04 } };
/** Open land a pond may lie on. @param {any} t */
export const pondLand = (t) => !!t && !t.river && (WORLD_PONDS.P[t.terrain] || 0) > 0 && (!t.loc || t.loc.zone === "rural");
/** A pond on the tile by the world's dice (pondLand first). @param {number | null | undefined} seed @param {any} t */
export const pondDice = (seed, t) => pondLand(t) && hash01(seed == null ? 0 : seed, "pond", t.id) < WORLD_PONDS.P[t.terrain];
/** Marks the map's pond tiles (tile.pond), in place. skip(t): a tile left as it is (save.js: one holding a base). @param {any[]} tiles @param {number | null | undefined} seed @param {(t: any) => boolean} [skip] */
export function pondsOnMap(tiles, seed, skip = null) {
  for (const t of tiles) {
    if (skip && skip(t)) continue;
    if (pondDice(seed, t)) t.pond = true; else delete t.pond;
  }
}

// Urban sites per city, in placement order (the first rounds are the basics every city gets while there is room):
// [type, count in Calder City, count in the second city, where]. where: core = city tiles, ring = suburbs,
// edge = the outer suburbs, any.
const URBAN_SITES = [
  ["police", 1, 1, "core"], ["autoshop", 1, 1, "ring"], ["hospital", 1, 1, "any"], ["pharmacy", 1, 1, "any"],
  ["supermarket", 1, 1, "ring"], ["gunstore", 1, 1, "any"], ["hardware", 1, 1, "ring"], ["gas", 1, 1, "ring"],
  ["police", 2, 1, "ring"], ["autoshop", 1, 1, "ring"], ["pharmacy", 2, 1, "any"], ["apartments", 3, 2, "any"],
  ["office", 2, 1, "core"], ["school", 2, 1, "ring"], ["firestation", 1, 1, "any"], ["mall", 1, 1, "ring"],
  ["warehouse", 2, 1, "edge"], ["supermarket", 1, 0, "ring"], ["gunstore", 1, 0, "any"], ["gas", 1, 0, "ring"],
  ["univ", 1, 0, "ring"], ["clinic", 1, 0, "ring"], ["church", 1, 1, "ring"], ["factory", 1, 0, "edge"],
];
// Urban names: "<City> <District> <Short>" (e.g. "Calder City North Precinct", "Calder City Eastside Auto");
// one-of-a-kind sites are "<City> <Name>" (e.g. "Calder City General Hospital").
const URBAN_SHORT = {
  police: "Precinct", autoshop: "Auto", pharmacy: "Pharmacy", supermarket: "Supermarket", gunstore: "Guns", hardware: "Hardware",
  gas: "Gas", apartments: "Apartments", office: "Offices", school: "School", firestation: "Fire station", warehouse: "Warehouses",
  clinic: "Clinic", church: "Church",
};
const CITY_UNIQUE = { hospital: "General Hospital", mall: "Mall", univ: "University", factory: "Steel Works" };
const DISTRICTS = {
  core: ["Downtown", "Midtown", "Old Town", "Central"],
  n: ["North", "Northside", "Uptown", "North End"],
  s: ["South", "Southside", "South End", "Southgate"],
  e: ["Eastside", "East End", "Eastgate", "East"],
  w: ["Westside", "West End", "Westgate", "West"],
};
const STREETS = ["Main Street", "Oak Street", "Elm Street", "Maple Avenue", "Mill Road", "Station Road", "Market Street", "Fifth Avenue", "Park Avenue"];

// Towns: a police station and an auto shop always, then 0–2 extras next to the center, and 1–2 satellites 2–3 tiles out.
const TOWN_EXTRAS = ["grocery", "pharmacy", "clinic", "diner", "hardware", "gunstore", "gas", "church", "school", "motel", "feedstore"];
const TOWN_SATELLITES = ["gas", "diner", "motel", "church", "feedstore", "clinic", "farm"];

// Countryside: [type, count, terrain test]. Spread out, at least 3 tiles from other sites and towns.
const isPlains = (t) => t.terrain === "plains";
const isWoods = (t) => t.terrain === "forest" || t.terrain === "hills";
const COUNTRYSIDE = [
  ["farm", 12, isPlains], ["barn", 6, isPlains], ["ranch", 4, (t) => t.terrain === "plains" || t.terrain === "hills"],
  ["church", 3, isPlains], ["cabin", 7, isWoods], ["lodge", 3, isWoods], ["campground", 4, (t) => t.terrain === "forest"],
  ["ranger", 3, isWoods], ["radiotower", 3, (t) => t.terrain === "hills"], ["quarry", 2, (t) => t.terrain === "hills"],
  ["crashsite", 2, () => true],
];
// City blocks are richer than the same shop in a small town (town centers keep their richness).
export const ZONE_RICHNESS = { urban: 1.15, town: 0.85 }; // aiscav.js siteFull: the loot bands
// Chance that a countryside site gets a dirt road to the nearest road (the rest stay off-road).
const SPUR_CHANCE = { farm: 0.6, ranch: 0.6, church: 0.7, lodge: 0.5, campground: 0.6, ranger: 0.6, quarry: 0.7, feedstore: 1, gas: 1, diner: 1, motel: 1, clinic: 1 };

function makeNoise(rng, w, h, cell) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const g = Array.from({ length: gw * gh }, () => rng.next());
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = smooth(fx - ix), ty = smooth(fy - iy);
    const v = (a, b) => g[b * gw + a];
    const top = v(ix, iy) * (1 - tx) + v(ix + 1, iy) * tx;
    const bot = v(ix, iy + 1) * (1 - tx) + v(ix + 1, iy + 1) * tx;
    return top * (1 - ty) + bot * ty;
  };
}

// size: a worldsize.js key (Normal when left out) or a size definition (worldsize.js customDef). Counts of towns,
// sites and landmarks scale with the map's area; on a Normal map every count and every random draw is the original
// one, so old seeds build the same map. hives (optional, the new-run screen): how many hives the map starts with in
// place of what its size makes (0–10), see below. seed: the world's seed, for the town rings' hash dice (null: the
// town's own id and name).
// Custom mode (custommode.js customSizeDef, 2026-10-24, user request): def.customCounts with def.cities, def.towns and
// def.military as set; what finds no room is skipped (cities may sit closer, down to 8 tiles; bases down to 6), and the
// 50% extra military base is not added (its die is still cast).
// The map is built in two steps: landMap (the land, rivers, roads, sites, finds and infection: nearly all the time a
// build takes) and hivesOnMap (the hives as set, the town rings, the ponds). The user's request 2026-10-24: "When
// changing a setting in the start menu it loads the map each time. After generating the map cache it and only update
// the whole map on new seeds and generating new maps": the land is kept (MAP_CACHE) by what decides it (the dice's
// position, the seed and the size def: the cities, towns and military sites of Custom mode among it), so a setting
// that leaves it alone (the groups, hives, mode, people, vehicles, crew, start, World dials) builds the world on a
// copy of it, the dice set where the land left them: the very map and draws an uncached build makes.
export function generateMap(rng, size = "normal", { hives = null, seed = null } = {}) {
  const def = sizeDef(size);
  const key = mapKey(rng.state, def, seed);
  const hit = MAP_CACHE.get(key);
  let land;
  if (hit) {
    MAP_CACHE.delete(key); // the most recent last
    MAP_CACHE.set(key, hit);
    land = { ...copyData(hit.land), grid: new HexGrid(def.w, def.h) };
    rng.state = hit.rngState;
  } else {
    land = landMap(rng, def, seed);
    const { grid, ...keep } = land;
    MAP_CACHE.set(key, { land: copyData(keep), rngState: rng.state });
    while (MAP_CACHE.size > MAP_CACHE_MAX) MAP_CACHE.delete(MAP_CACHE.keys().next().value);
  }
  return hivesOnMap(land, rng, def, hives, seed);
}
// The lands built lately (oldest first), each { land: landMap's result without its grid, rngState: the dice after it }.
// A few, not one: switching between two sizes or modes and back builds neither again. A Huge land is some 150,000 tiles.
const MAP_CACHE = new Map();
const MAP_CACHE_MAX = 4; // the new-run screen's tiny preview land (world.js PREVIEW_MAP) takes one
const mapKey = (rngState, def, seed) => `${rngState}|${seed}|${JSON.stringify(def)}`;
// Whether a map with these dice, size def and seed is built from the cache (main.js: no "Generating map…" box for it).
export function mapCached(rngState, size, seed = null) { return MAP_CACHE.has(mapKey(rngState, sizeDef(size), seed)); }
export function clearMapCache() { MAP_CACHE.clear(); }
// A deep copy of plain data (objects, arrays, numbers, strings, booleans, null: what the land is made of), some five
// times faster than structuredClone on a Huge map's tiles (0.14 s against 0.77 s).
export function copyData(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) { const a = new Array(v.length); for (let i = 0; i < v.length; i++) a[i] = copyData(v[i]); return a; }
  const o = {};
  for (const k in v) o[k] = copyData(v[k]);
  return o;
}

function landMap(rng, def, seed) {
  const MAP_W = def.w, MAP_H = def.h;
  const A = areaScale(def); // land relative to Normal
  const scaled = (n) => Math.round(n * A);
  const grid = new HexGrid(MAP_W, MAP_H);
  const n1 = makeNoise(rng, MAP_W, MAP_H, 9);
  const n2 = makeNoise(rng, MAP_W, MAP_H, 4.5);
  const m1 = makeNoise(rng, MAP_W, MAP_H, 8);
  const tiles = [];
  for (let id = 0; id < grid.size; id++) {
    const [x, y] = grid.xy(id);
    const north = 1 - y / (MAP_H - 1);
    const elev = n1(x, y) * 0.65 + n2(x, y) * 0.35 + north * 0.38 - 0.12;
    const moist = m1(x, y);
    let terrain = "plains";
    if (elev > 0.78) terrain = "mountain";
    else if (elev > 0.63) terrain = "hills";
    else if (moist > 0.56) terrain = "forest";
    tiles.push({
      id, x, y, elev, terrain,
      road: false, roadLinks: [], river: false, bridge: false,
      loc: null, loot: 0, infection: 0, owner: null, hive: false,
    });
  }

  // Rivers run from the northern highlands toward the south edge, their sources spread apart.
  const riverCount = Math.round((3 + (rng.chance(0.5) ? 1 : 0)) * (MAP_W / BASE_W)); // 3–4 on a Normal map, more on a wider one
  const highs = tiles.filter((t) => t.y < MAP_H * 0.3 && (t.terrain === "hills" || t.terrain === "mountain"));
  const sources = [];
  for (let r = 0; r < riverCount && highs.length; r++) {
    const apart = highs.filter((t) => !t.river && sources.every((s) => grid.distance(s, t.id) >= 12));
    let cur = rng.pick(apart.length ? apart : highs);
    sources.push(cur.id);
    for (let step = 0; step < 100; step++) {
      cur.terrain = "water";
      cur.river = true;
      if (cur.y >= MAP_H - 1) break;
      const opts = grid.neighbors(cur.id).map((n) => tiles[n]).filter((t) => t.y >= cur.y && !t.river);
      if (!opts.length) break;
      opts.sort((a, b) => a.elev + (a.y > cur.y ? -0.08 : 0) + rng.next() * 0.08 - (b.elev + (b.y > cur.y ? -0.08 : 0) + rng.next() * 0.08));
      cur = opts[0];
    }
  }

  // ---------- placement helpers ----------
  const sites = [];                   // tiles with a location, in placement order
  const crowd = new Uint8Array(grid.size).fill(99); // distance to the nearest site (up to 8; 99 = farther)
  const usedNames = new Set();        // town and city names (every one unique on the map)
  const siteNames = new Set();        // every site's full name (the towns' and cities' among them): unique on the map
  const buildable = (t) => !t.loc && !t.river && t.terrain !== "water" && t.terrain !== "mountain";
  const urbanTile = (t) => t.terrain === "city" || t.terrain === "suburb";
  const placeLoc = (tile, type, name, zone = LOCATIONS[type].cat, settlement = null) => {
    tile.loc = { type, name, zone };
    if (settlement != null) tile.loc.settlement = settlement;
    tile.loot = LOCATIONS[type].richness * (type === "town" ? 1 : ZONE_RICHNESS[zone] || 1) * rng.range(0.7, 1.2);
    siteNames.add(name);
    sites.push(tile);
    for (const id of grid.within(tile.id, 8)) crowd[id] = Math.min(crowd[id], grid.distance(tile.id, id));
    return tile;
  };
  // First candidate name not taken yet; then a distinguishing form of one (SITE_FORMS, in order), a roman numeral, and
  // a number as the very last resort (no dice: a map whose names never collide draws exactly what it did).
  const taken = (n) => siteNames.has(n) || usedNames.has(n);
  const uniqueName = (...cands) => {
    cands = cands.filter(Boolean);
    for (const n of cands) if (!taken(n)) return n;
    const start = siteNames.size % SITE_FORMS.length;
    for (let i = 0; i < SITE_FORMS.length; i++) { const f = SITE_FORMS[(start + i) % SITE_FORMS.length]; for (const n of cands) if (!taken(`${f} ${n}`)) return `${f} ${n}`; }
    for (const r of ROMAN) if (!taken(`${cands[0]} ${r}`)) return `${cands[0]} ${r}`;
    for (let i = 2; ; i++) if (!taken(`${cands[0]} ${i}`)) return `${cands[0]} ${i}`;
  };
  // `tries` draws of make (the first pool), then as many of `more` (the wider pool) only when every one collided.
  const pickName = (make, tries = 8, more = null) => {
    const cands = Array.from({ length: tries }, make);
    if (more && cands.every(taken)) cands.push(...Array.from({ length: tries }, more));
    return uniqueName(...cands);
  };
  // A settlement name from the pools (plain names first), then a form of one (random base and form, a few tries,
  // then the first free pair in order), then a roman numeral: never the same twice on a map.
  const settlementName = (pools, forms) => {
    for (const pool of pools) {
      const left = pool.filter((n) => !taken(n));
      if (left.length) return rng.pick(left);
    }
    const all = pools.flat();
    for (let i = 0; i < 12; i++) {
      const [pre, suf] = rng.pick(forms), n = `${pre}${rng.pick(all)}${suf}`;
      if (!taken(n)) return n;
    }
    for (const [pre, suf] of forms) for (const b of all) if (!taken(`${pre}${b}${suf}`)) return `${pre}${b}${suf}`;
    const base = rng.pick(all);
    for (const r of ROMAN) if (!taken(`${base} ${r}`)) return `${base} ${r}`;
    for (let i = 2; ; i++) if (!taken(`${base} ${i}`)) return `${base} ${i}`;
  };
  const nameFor = () => { // a town's name
    const n = settlementName([TOWN_NAMES, MORE_TOWN_NAMES, EVEN_MORE_TOWN_NAMES], TOWN_FORMS);
    usedNames.add(n);
    return n;
  };
  // A city's name: the second city from SECOND_CITY_NAMES as ever (the same draw), the rest from every city pool.
  const cityName = (k) => (k === 1 ? rng.pick(SECOND_CITY_NAMES) : settlementName([SECOND_CITY_NAMES, MORE_CITY_NAMES, EVEN_MORE_CITY_NAMES], CITY_FORMS));
  // Best of a few random candidates: the one farthest from refs (keeps towns and sites spread out).
  const pickSpread = (cands, refs, samples = 6) => {
    if (!cands.length) return null;
    let best = null, bestD = -1;
    for (let i = 0; i < samples; i++) {
      const c = rng.pick(cands);
      const d = refs.reduce((m, o) => Math.min(m, grid.distance(o.id, c.id)), 999);
      if (d > bestD) { best = c; bestD = d; }
    }
    return best;
  };

  // ---------- cities ----------
  const cities = [];
  const addCity = (center, name, big) => {
    const urban = [];
    const r = big ? 4 : 3;
    for (const id of grid.within(center.id, r)) {
      const t = tiles[id];
      if (t.river) continue;
      const d = grid.distance(center.id, id);
      if (d <= 1 || (big && d === 2 && rng.chance(0.75))) t.terrain = "city";
      else if (d < r || rng.chance(0.55)) t.terrain = "suburb";
      else continue;
      if (id !== center.id) urban.push(t);
    }
    usedNames.add(name);
    placeLoc(center, "city", name, "urban", center.id);
    cities.push({ center, name, big, urban });
  };
  // Calder City sits in the south.
  const southOk = (t) => t.y > MAP_H * 0.6 && t.y < MAP_H - 5 && t.x > 10 && t.x < MAP_W - 10 && t.terrain !== "water" && t.terrain !== "mountain";
  const cityCandidates = tiles.filter(southOk);
  addCity(rng.pick(cityCandidates.length ? cityCandidates : tiles.filter((t) => t.y > MAP_H / 2 && !t.river)), "Calder City", true);
  // A second, smaller city far from it (Large and Huge maps get more of them, each far from the others).
  const main = cities[0].center;
  for (let k = 1; k < def.cities; k++) {
    for (const minD of def.customCounts ? [24, 18, 12, 8] : [24, 18, 12]) {
      const c = tiles.filter((t) => t.x >= 8 && t.x < MAP_W - 8 && t.y >= 5 && t.y < MAP_H - 5 && !t.river &&
        ["plains", "forest", "hills"].includes(t.terrain) && cities.every((o) => grid.distance(t.id, o.center.id) >= minD));
      if (!c.length) continue;
      addCity(rng.pick(c), cityName(k), false);
      break;
    }
  }
  // Fill the blocks: the basics first, then more of a kind in the big city.
  const districtOf = (city, t) => {
    if (grid.distance(city.center.id, t.id) <= 1) return "core";
    const [ax, ay] = grid.toPixel(city.center.id, 1), [bx, by] = grid.toPixel(t.id, 1);
    const dx = bx - ax, dy = by - ay;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : dy > 0 ? "s" : "n";
  };
  const urbanName = (city, type, t, first) => {
    if (first && CITY_UNIQUE[type]) return uniqueName(`${city.name} ${CITY_UNIQUE[type]}`);
    if (first && type === "police") return uniqueName(`${city.name} Police HQ`);
    const short = URBAN_SHORT[type] || LOCATIONS[type].name;
    const riverside = grid.neighbors(t.id).some((n) => tiles[n].river) ? ["Riverside"] : [];
    return uniqueName(...[...riverside, ...DISTRICTS[districtOf(city, t)], ...STREETS].map((w) => `${city.name} ${w} ${short}`));
  };
  for (const city of cities) {
    const outer = Math.max(...city.urban.map((t) => grid.distance(city.center.id, t.id)));
    const where = {
      core: (t) => t.terrain === "city", ring: (t) => t.terrain === "suburb", any: () => true,
      edge: (t) => t.terrain === "suburb" && grid.distance(city.center.id, t.id) >= outer - 1,
    };
    const placed = {};
    for (const [type, big, small, w] of URBAN_SITES) {
      for (let i = 0; i < (city.big ? big : small); i++) {
        const open = city.urban.filter((t) => !t.loc);
        if (!open.length) break;
        const fit = open.filter(where[w]);
        const pool = fit.length ? fit : open;
        const same = sites.filter((s) => s.loc.type === type && s.loc.settlement === city.center.id);
        const apart = pool.filter((t) => same.every((s) => grid.distance(s.id, t.id) >= 2));
        const t = rng.pick(apart.length ? apart : pool);
        placeLoc(t, type, urbanName(city, type, t, !placed[type]), "urban", city.center.id);
        placed[type] = (placed[type] || 0) + 1;
      }
    }
  }

  // ---------- towns ----------
  // Sparse and spread out: at least 8 tiles apart, 9 from a city center, with room for their shops around them.
  const towns = [];
  let townCands = tiles.filter((t) => buildable(t) && !urbanTile(t) && t.x >= 2 && t.x < MAP_W - 2 && t.y >= 2 && t.y < MAP_H - 2 &&
    cities.every((c) => grid.distance(c.center.id, t.id) >= 9) &&
    grid.neighbors(t.id).filter((n) => buildable(tiles[n]) && !urbanTile(tiles[n])).length >= 4);
  const townCount = def.customCounts && Number.isFinite(def.towns) ? def.towns : scaled(TOWN_COUNT); // Custom mode: as set
  for (let i = 0; i < townCount && townCands.length; i++) {
    const t = pickSpread(townCands, [...towns, ...cities.map((c) => c.center)], 8);
    placeLoc(t, "town", nameFor(), "town", t.id);
    towns.push(t);
    townCands = townCands.filter((c) => grid.distance(c.id, t.id) >= 8);
  }
  const ringAround = (center, minD, maxD) => grid.within(center.id, maxD).map((id) => tiles[id])
    .filter((t) => buildable(t) && !urbanTile(t) && grid.distance(center.id, t.id) >= minD);
  for (const town of towns) {
    const name = town.loc.name;
    const core = ["police", "autoshop", ...rng.shuffle(TOWN_EXTRAS.slice()).slice(0, rng.int(0, 2))];
    for (const type of core) {
      const near = ringAround(town, 1, 1);
      const t = rng.pick(near.length ? near : ringAround(town, 2, 2));
      if (t) placeLoc(t, type, uniqueName(`${name} ${LOCATIONS[type].name}`), "town", town.id);
    }
    const sats = rng.shuffle(TOWN_SATELLITES.filter((x) => !core.includes(x))).slice(0, rng.int(1, 2));
    for (const type of sats) {
      const t = rng.pick(ringAround(town, 2, 3));
      if (!t) continue;
      if (type === "farm") placeLoc(t, type, pickName(() => `${rng.pick(SURNAMES)} Farm`, 8, () => `${rng.pick(MORE_SURNAMES)} Farm`), "rural", town.id);
      else placeLoc(t, type, uniqueName(`${name} ${LOCATIONS[type].name}`), "town", town.id);
    }
  }

  // ---------- landmarks ----------
  const settlements = [...cities.map((c) => c.center), ...towns];
  const nearName = (t) => settlements.reduce((best, s) => (!best || grid.distance(s.id, t.id) < grid.distance(best.id, t.id) ? s : best), null).loc.name;
  // Remembered per tile (the cities and towns are all placed by now): the landmark and countryside filters ask for
  // every tile many times over, and on a 500 × 250 map (Crashlanding, 2026-10-24) the towns run to hundreds. No city at
  // all (a Custom map with no room for one): far from every city, as the empty min was (999, not Infinity, which an Int16 cannot hold).
  const cityMemo = new Int16Array(grid.size).fill(-1), townMemo = new Int16Array(grid.size).fill(-1);
  const cityDist = (t) => (cityMemo[t.id] >= 0 ? cityMemo[t.id] : (cityMemo[t.id] = cities.length ? Math.min(...cities.map((c) => grid.distance(c.center.id, t.id))) : 999));
  const townDist = (t) => (townMemo[t.id] >= 0 ? townMemo[t.id] : (townMemo[t.id] = towns.reduce((m, o) => Math.min(m, grid.distance(o.id, t.id)), 999)));
  // "At least d tiles from every tile in list", as a mask over the grid built once per call (2026-10-24: the landmark
  // filters ask it for every tile, and a Huge map has dozens of bases, prisons and dams to keep apart).
  const farFrom = (list, d) => { const m = new Uint8Array(grid.size); for (const s of list) for (const id of grid.within(s.id, d - 1)) m[id] = 1; return (t) => !m[t.id]; };
  // The first filter with any candidate wins; the last ones are fallbacks.
  const landmark = (type, filters, name, zone = "special") => {
    for (const f of filters) {
      const c = tiles.filter((t) => buildable(t) && f(t));
      if (c.length) {
        const t = rng.pick(c);
        return placeLoc(t, type, name(t), zone);
      }
    }
    return null;
  };
  // National Guard bases: always at least one, off-road in the hills or woods away from settlements (or on a city edge).
  const offRoad = new Set();
  const military = [];
  const milFilters = (extra) => [
    (t) => isWoods(t) && extra(t) && cityDist(t) >= 12 && townDist(t) >= 5 && crowd[t.id] >= 4,
    (t) => !urbanTile(t) && extra(t) && cityDist(t) >= 8 && townDist(t) >= 4 && crowd[t.id] >= 3,
    (t) => t.terrain === "suburb" && extra(t),
    (t) => extra(t),
  ];
  military.push(landmark("military", milFilters(() => true), (t) => uniqueName(`${nearName(t)} National Guard base`)));
  // Bigger maps: more bases for sure (Huge: 45), each at least 22 tiles from the others; then a 50% chance of one more.
  // Custom mode: closer when they do not fit 22 apart (12, then 6). apartBy reads the bases placed so far (built per base).
  const apartBy = (d) => farFrom(military, d);
  for (let k = 1; k < def.military; k++) {
    const more = landmark("military", def.customCounts ? [22, 12, 6].flatMap((d) => milFilters(apartBy(d))) : milFilters(apartBy(22)), (t) => uniqueName(`${nearName(t)} National Guard base`, `${nearName(t)} Army depot`));
    if (more) military.push(more);
  }
  if (rng.chance(0.5) && !def.customCounts) {
    const second = landmark("military", milFilters(apartBy(22)).slice(0, 2), (t) => uniqueName(`${nearName(t)} Army depot`));
    if (second) military.push(second);
  }
  for (const m of military) offRoad.add(m.id);
  // One prison, dam and airport on a Normal map (two on Large and Huge ones, kept apart), two factories (by area).
  const apart = (type, d) => farFrom(sites.filter((s) => s.loc.type === type), d); // the sites of that type gathered once, as a mask: the filter runs for every tile
  const perArea = (n) => Math.max(1, scaled(n));
  for (let i = 0; i < perArea(1); i++) {
    const far = apart("prison", 16);
    landmark("prison", [(t) => far(t) && isPlains(t) && cityDist(t) >= 14 && townDist(t) >= 4 && crowd[t.id] >= 4, (t) => far(t) && !urbanTile(t) && cityDist(t) >= 10 && crowd[t.id] >= 3],
      (t) => uniqueName(`${nearName(t)} State prison`));
  }
  for (let i = 0; i < perArea(1); i++) {
    const far = apart("dam", 12);
    landmark("dam", [(t) => far(t) && isWoods(t) && grid.neighbors(t.id).some((n) => tiles[n].river) && crowd[t.id] >= 3],
      (t) => uniqueName(`${nearName(t)} Dam`));
  }
  for (let i = 0; i < perArea(1); i++) {
    const city = cities[Math.min(i, cities.length - 1)].center, far = apart("airport", 12);
    landmark("airport", [(t) => far(t) && isPlains(t) && !urbanTile(t) && grid.distance(t.id, city.id) >= 5 && grid.distance(t.id, city.id) <= 12 && crowd[t.id] >= 3,
      (t) => far(t) && isPlains(t) && !urbanTile(t) && crowd[t.id] >= 3], () => uniqueName(`${city.loc.name} Regional airport`));
  }
  for (let i = 0; i < scaled(2); i++) {
    landmark("factory", [(t) => !urbanTile(t) && townDist(t) >= 2 && townDist(t) <= 4 && crowd[t.id] >= 2],
      (t) => uniqueName(`${nearName(t)} Factory`, `${nearName(t)} Mill`, `${nearName(t)} Plant`));
  }

  // ---------- countryside ----------
  const countryName = (type) => {
    const sur = () => rng.pick(SURNAMES), place = () => rng.pick(PLACE_NAMES);
    const more = () => rng.pick(MORE_SURNAMES), morePlace = () => rng.pick(MORE_PLACE_NAMES); // the wider pools, drawn from only when the first eight collide
    switch (type) {
      case "farm": return pickName(() => `${sur()} Farm`, 8, () => `${more()} Farm`);
      case "barn": case "ranch": case "cabin": return pickName(() => `${sur()} ${LOCATIONS[type].name}`, 8, () => `${more()} ${LOCATIONS[type].name}`);
      case "crashsite": return pickName(() => `${rng.pick([`Flight ${rng.int(100, 999)}`, "Medevac", "Cargo plane", "Army helicopter"])} crash site`, 8, () => `Flight ${rng.int(1000, 9999)} crash site`);
      case "truckstop": return pickName(() => `Mile ${rng.int(12, 240)} Truck stop`, 8, () => `Mile ${rng.int(241, 999)} Truck stop`);
      default: return pickName(() => `${place()} ${LOCATIONS[type].name}`, 8, () => `${morePlace()} ${LOCATIONS[type].name}`);
    }
  };
  for (const [type, n, ok] of COUNTRYSIDE) {
    let cands = tiles.filter((t) => buildable(t) && !urbanTile(t) && ok(t) && crowd[t.id] >= 3 && townDist(t) >= 3);
    for (let i = 0; i < scaled(n) && cands.length; i++) {
      const t = pickSpread(cands, sites.filter((s) => s.loc.type === type), 4);
      placeLoc(t, type, countryName(type), "rural");
      cands = cands.filter((c) => crowd[c.id] >= 3);
    }
  }

  // ---------- roads ----------
  const roadCost = (a, b) => {
    const t = tiles[b];
    if (offRoad.has(b)) return 14;
    if (t.terrain === "mountain") return 9;
    if (t.terrain === "water") return 7;
    if (t.road) return 0.4;
    return { plains: 1, suburb: 1, city: 1, forest: 2, hills: 3 }[t.terrain] || 2;
  };
  const layRoad = (path) => {
    for (let i = 0; i < path.length; i++) {
      const t = tiles[path[i]];
      t.road = true;
      if (t.terrain === "water") t.bridge = true;
      if (i > 0) {
        const prev = tiles[path[i - 1]];
        if (!prev.roadLinks.includes(t.id)) prev.roadLinks.push(t.id);
        if (!t.roadLinks.includes(prev.id)) t.roadLinks.push(prev.id);
      }
    }
  };
  const roadTo = (from, to) => {
    const res = findPath(grid, from, to, roadCost);
    if (res) layRoad(res.path);
  };
  // Highways: a minimum spanning tree over cities, towns and the big landmarks, routed by terrain cost. Prim's with
  // each pending site's nearest connected one remembered (2026-10-24: a Huge 500 × 300 map has some 900 of them, and
  // asking every pair every round was most of its build); the same tree as the pairwise scan gave: the first pending
  // site at the least distance, joined to the first connected site at that distance.
  const trunk = sites.filter((t) => t.loc.type === "city" || t.loc.type === "town" || (t.loc.zone === "special" && t.loc.type !== "military"));
  const pending = trunk.slice(1).map((p) => ({ p, c: trunk[0], d: grid.distance(p.id, trunk[0].id) }));
  while (pending.length) {
    let at = 0;
    for (let i = 1; i < pending.length; i++) if (pending[i].d < pending[at].d) at = i;
    const best = pending[at];
    roadTo(best.c.id, best.p.id);
    pending.splice(at, 1);
    for (const e of pending) { const d = grid.distance(e.p.id, best.p.id); if (d < e.d) { e.d = d; e.c = best.p; } }
  }
  // Loops: a settlement gets a direct road to its nearest neighbors when the roads between them are a long detour.
  const roadOnly = (a, b) => (tiles[a].roadLinks.includes(b) ? 1 : Infinity);
  for (const s of settlements) {
    const others = settlements.filter((o) => o !== s).sort((a, b) => grid.distance(s.id, a.id) - grid.distance(s.id, b.id)).slice(0, 2);
    for (const o of others) {
      const d = grid.distance(s.id, o.id);
      if (d <= 16 && !findPath(grid, s.id, o.id, roadOnly, d * 1.8 + 2)) roadTo(s.id, o.id);
    }
  }
  // Streets and spurs: city and town sites join the nearest road; some countryside sites get a dirt road, most do not.
  const nearestRoad = (id, maxR) => {
    for (let r = 1; r <= maxR; r++) {
      const ring = grid.within(id, r).filter((n) => tiles[n].road && grid.distance(id, n) === r);
      if (ring.length) return ring[0];
    }
    return null;
  };
  for (const t of sites) {
    if (t.road || offRoad.has(t.id)) continue;
    if (t.loc.zone === "rural" && !rng.chance(SPUR_CHANCE[t.loc.type] || 0)) continue;
    const target = nearestRoad(t.id, t.loc.zone === "rural" ? 3 : 4);
    if (target != null) roadTo(t.id, target);
  }
  // Truck stops and gas stations along the highways, away from other sites. The ground within `spacing` of a stop of
  // the kind is marked as each is placed (2026-10-24: hundreds of stops on a Huge map, each asked of every road tile).
  const highway = (type, n, spacing, name) => {
    const same = sites.filter((s) => s.loc.type === type && s.loc.zone === "rural");
    const near = new Uint8Array(grid.size);
    for (const s of same) for (const id of grid.within(s.id, spacing - 1)) near[id] = 1;
    for (let i = 0; i < n; i++) {
      const c = tiles.filter((t) => t.road && buildable(t) && !t.bridge && !urbanTile(t) && crowd[t.id] >= 3 && !near[t.id]);
      const t = pickSpread(c, same, 4);
      if (!t) break;
      placeLoc(t, type, name(t), "rural");
      same.push(t);
      for (const id of grid.within(t.id, spacing - 1)) near[id] = 1;
    }
  };
  highway("truckstop", scaled(3), 10, () => countryName("truckstop"));
  highway("gas", scaled(4), 8, (t) => uniqueName(`${nearName(t)} Gas`, `${nearName(t)} Highway Gas`, `${rng.pick(PLACE_NAMES)} Gas`));

  // Minor scavenging value everywhere else.
  for (const t of tiles) {
    if (t.loc) continue;
    t.loot = { city: 0.4, suburb: 0.3, plains: 0.12, forest: 0.08, hills: 0.08 }[t.terrain] || 0;
  }

  // Hidden finds that teams can spot while travelling: caches, wrecked cars, abandoned camps.
  for (const t of tiles) {
    t.hidden = null;
    if (t.loc || t.terrain === "water" || t.terrain === "mountain") continue;
    if (t.road && rng.chance(0.035)) t.hidden = { type: "car", known: false, taken: false };
    else if ((t.terrain === "forest" || t.terrain === "hills") && rng.chance(0.03)) t.hidden = { type: rng.chance(0.6) ? "cache" : "camp", known: false, taken: false };
    else if (rng.chance(0.012)) t.hidden = { type: rng.pick(["cache", "camp", "car"]), known: false, taken: false };
  }

  // Outbreak origin: infection is worst there and spreads from it over time. The other city has its own hot spot.
  const originCandidates = sites.filter((t) => ["city", "univ", "military", "hospital"].includes(t.loc.type));
  const origin = rng.pick(originCandidates);
  const seeds = [{ id: origin.id, peak: 1, r: 30 }];
  for (const c of cities) if (grid.distance(c.center.id, origin.id) > 10) seeds.push({ id: c.center.id, peak: 0.8, r: 12 });
  // Large and Huge maps: extra hot spots at landmarks far from the others (a lone hive each), so the hives cover the
  // state about as densely as on a Normal map.
  const spotIds = [];
  const spotTypes = new Set(["military", "prison", "airport", "factory", "dam", "quarry", "crashsite", "campground", "lodge"]);
  for (let k = 0; k < def.hotspots; k++) {
    const cands = sites.filter((t) => spotTypes.has(t.loc.type) && seeds.every((s) => grid.distance(s.id, t.id) >= (s.r >= 30 ? 22 : 14)));
    const t = pickSpread(cands, seeds.map((s) => tiles[s.id]), 6);
    if (!t) break;
    seeds.push({ id: t.id, peak: 0.75, r: 10 });
    spotIds.push(t.id);
  }
  for (const t of tiles) {
    let inf = 0;
    for (const s of seeds) inf = Math.max(inf, s.peak * (1 - grid.distance(s.id, t.id) / s.r));
    t.infection = Math.max(0.05, Math.min(1, inf + (rng.next() - 0.5) * 0.15));
    if (t.terrain === "city") t.infection = Math.min(1, t.infection + 0.15);
    else if (t.terrain === "suburb") t.infection = Math.min(1, t.infection + 0.06);
  }
  return {
    grid, tiles, mainId: main.id, originId: origin.id, seeds, spotIds,
    cityIds: cities.map((c) => c.center.id), townIds: towns.map((t) => t.id), militaryIds: military.map((m) => m.id),
  };
}

// The hives (as many as set, else the size def's), the town rings and the ponds, on landMap's land.
function hivesOnMap({ grid, tiles, mainId, originId, seeds, spotIds, cityIds, townIds, militaryIds }, rng, def, hives, seed) {
  // Infestation hives (hives.js): the size def's originHives around the origin (worldsize.js; HIVE.START_ORIGIN, four,
  // for a def without one), one around each other hot spot (HIVE.START_SPOT).
  // The extra hot spots of Large and Huge maps hold a small cluster each (worldsize.js spotHives): hive income
  // grows with the cluster (hives.js hiveIncome), so this keeps the dead per tile of land near a Normal map's.
  const originHives = def.originHives ?? HIVE.START_ORIGIN;
  const want = seeds.map((s, i) => (!i ? originHives : spotIds.includes(s.id) ? def.spotHives || HIVE.START_SPOT : HIVE.START_SPOT));
  // A set hive count (the new-run screen): fewer than the map makes are taken from the outbreak origin outward (the
  // origin keeps its cluster first, the lone hot spots go); more are added one per hot spot in turn, origin first.
  if (hives != null) {
    const total = want.reduce((a, b) => a + b, 0);
    let left = Math.max(0, Math.round(hives));
    if (left <= total) for (let i = 0; i < want.length; i++) { want[i] = Math.min(want[i], left); left -= want[i]; }
    else for (let i = 0, extra = left - total; extra > 0; i = (i + 1) % want.length, extra--) want[i]++;
  }
  for (const [i, s] of seeds.entries()) {
    const spots = rng.shuffle(grid.within(s.id, i ? 4 : 6).map((id) => tiles[id]).filter((t) => t.terrain !== "water" && !t.loc && !t.hive));
    for (const t of spots.slice(0, want[i])) t.hive = true;
  }

  // ---------- town suburb rings (pois.js: a town footprint is a known zone) ----------
  // Every town gets a ring of suburbs round its centre, radius 1 or 2 by a hash of the town (not the map's dice: every
  // draw above is the same as before the rings existed, so old seeds build the same map under them). Land only: no
  // water, rivers or mountains, and a countryside site (a farm satellite) keeps its own ground; the town's shops and
  // the centre's neighbours become suburb blocks. The ring is laid last: the shops, roads, loot, finds, infection and
  // hives above were placed on the old ground. A converted tile takes the suburbs' infection (+0.06) and, bare, at
  // least the suburbs' minor scavenging value.
  const urbanTile = (t) => t.terrain === "city" || t.terrain === "suburb";
  for (const town of townIds.map((id) => tiles[id])) {
    const r = 1 + (hash01(seed == null ? `${town.id}:${town.loc.name}` : seed, "townring", town.id) < 0.5 ? 0 : 1);
    for (const id of grid.within(town.id, r)) {
      const t = tiles[id];
      if (id === town.id || t.river || t.terrain === "water" || t.terrain === "mountain" || urbanTile(t)) continue;
      if (t.loc && t.loc.zone === "rural") continue;
      t.terrain = "suburb";
      t.infection = Math.min(1, t.infection + 0.06);
      if (!t.loc) t.loot = Math.max(t.loot, 0.3);
    }
  }

  pondsOnMap(tiles, seed);

  return { grid, tiles, cityId: mainId, originId, cityIds, townIds, militaryIds, spotIds };
}
