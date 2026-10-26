// Battle map sizes by context, and what fills them. One table (SIZES) decides how big every kind of battle map is;
// the helpers below scale what goes on it (cover, rooms, containers, the dead) and where the two sides start, and
// keep big maps from becoming a slog (the "area clear enough" end, enemies that break and run off).
//
// Four size classes (W × H tiles, the iso view's diamonds): Small 24 × 18, Medium 32 × 24, Large 40 × 30,
// Extra-large 48 × 34. A context gives a scale: 0 = Small, 1 = Medium, 2 = Large, 3 = Extra-large, with fractions
// in between (dimsAt: 0.5 is 28 × 20, between Small and Medium).
//   Raids (scavenging a site, combat.js createRaid): between the run's smallest and largest raid map (worldcfg.js
//     raidMin / raidMax, tiles across; the usual 32 × 24 to 56 × 42), the site's place between them by its location
//     type (SIZES.SITE), a site-less tile by its terrain (SIZES.TERRAIN). Cities and towns (and a city crawl's
//     buildings) always the largest (RAID_RANGE.LARGEST), as are hospitals, universities, prisons, military bases,
//     malls, factories, airports and the warehouse district; supermarkets, schools, police and fire stations,
//     apartments, offices, motels, churches, farms, ranches, lodges and campgrounds a third of the way up; gas
//     stations, diners, groceries, pharmacies, clinics, cabins, barns and small shops the smallest.
//   Fights in the open (road ambushes, hordes, outsiders: combat.js createBattle with no layout of its own): Medium,
//     growing to Large with the number of people and the dead on the map (SIZES.FIELD); open plains a little bigger
//     (room to flank), forest, hills and mountains a little smaller (the cover makes up for it); at a site at least
//     the site's size less half a class.
//   A hive assault Large, a hive growth Medium (hives.js, hivetech.js).
//   A group's base you assault (conquest.js): Medium to Extra-large by how many people live there.
//   Your own bases (interior.js, the yard and buildings map; its wall map is as long, less 3 rows: deploy.js): a hub
//     Large to Extra-large, an outpost Medium to Large, by how many buildings stand there.
// Past the old Large (BIG.FROM, 40 × 30; nothing at or under it changes) the run's raid map dials can make a map far
// bigger, so what fills it grows with the ground but less than the ground: the dead (raidDeadScale, buildingDeadScale:
// more of them, and more waves), a container's loot (raidLootShare: more containers, each a little less), Heat's rise
// a turn (raidHeatRate: a longer walk, a slower clock) and a way out on each long side (combat.js genRaidMap); the
// dead that come in at Heat come in near your people (BIG.NEAR).
// Content scales with the area: more buildings, rooms, containers and scatter on a bigger map (combat.js genMap,
// genRaidMap), and every map is topped up with props (densify) until most open ground has cover within COVER.R tiles.
// The sides start CONTACT.HUMANS / CONTACT.DEAD tiles apart whatever the map's size, so the first shots come in a
// turn or two and the dead reach your people in two or three: a bigger map is room to flank, not a walk.
import { CELL, active, los, combatants } from "./combat.js";
import { smokeScreens, SMOKE } from "./throwables.js"; // a smoke grenade's cloud screens someone running away
import { raidRange, legacyRaids } from "./worldcfg.js"; // the run's dials: Raid map smallest / largest; an older save's old sizes
import { NEW_KINDS } from "./data-shops.js"; // the shops and services new as places: their raid map sizes

export const SIZE_CLASSES = {
  S: { w: 24, h: 18, name: "Small" },
  M: { w: 32, h: 24, name: "Medium" },
  L: { w: 40, h: 30, name: "Large" },
  XL: { w: 48, h: 34, name: "Extra-large" },
};
export const CLASS_KEYS = ["S", "M", "L", "XL"];
const S = 0, M = 1, L = 2, XL = 3;

export const SIZES = {
  // Raids by the site's location type (data.js LOCATIONS), then by terrain: a scale from RAID_RANGE.LO (the run's
  // smallest raid map) to RAID_RANGE.HI (its largest), raidDims.
  SITE: {
    hospital: L, univ: L, college: L, prison: L, military: L, airbase: L, mall: L, factory: L, airport: L, warehouse: L, city: L, dam: L,
    town: 1.5, supermarket: M, school: M, police: M, firestation: M, apartments: M, office: M, motel: M, church: M, truckstop: M, quarry: M,
    gas: 0.5, diner: 0.5, grocery: 0.5, pharmacy: 0.5, clinic: 0.5, cabin: 0.5, barn: 0.5, gunstore: 0.5, pawnshop: 0.5, hardware: 0.5,
    autoshop: 0.5, feedstore: 0.5, ranger: 0.5, radiotower: 0.5, airdrop: 0.5,
    farm: M, ranch: M, lodge: M, campground: M, crashsite: M, crash_mil: M, crash_cargo: M, crash_med: M, crash_news: M, convoy: M, // convoy: miltrucks.js
    // Points of interest (pois.js): small places, the neighbourhood a street of houses.
    house: 0.5, garage: 0.5, corner: 0.5, pizza: 0.5, farmstand: 0.5, shed: 0.5, blind: 0.5, campsite: 0.5, hikercamp: 0.5, mineshack: 0.5, neighbourhood: M,
  },
  TERRAIN: { city: L, suburb: M, plains: M, forest: M, hills: M, mountain: M, water: M },
  // Fights in the open: BASE, plus PER a combatant over FROM (each of the dead counts ZOMBIE: they bunch up), at most
  // MAX; OPEN on plains and by water, COVERED in forest, hills and mountains; at a site, at least its size less SITE.
  FIELD: { BASE: M, FROM: 8, PER: 1 / 16, MAX: L, ZOMBIE: 0.6, OPEN: 0.2, COVERED: -0.15, SITE: 0.5 },
  HIVE: L, GROWTH: M,
  // A group's base you assault: BASE, plus PER a person living there over FROM, at most MAX.
  ASSAULT: { BASE: M, FROM: 8, PER: 1 / 24, MAX: XL },
  // Your own base's yard map: [scale, from, per] by type: the scale grows a step from `from` buildings over `per` more.
  BASE: { hub: [L, 3, 6], outpost: [M, 1, 4] },
};
// Your own base's yard map by its tier (interior.js yardDims): a square, [from, to, structuresFrom, structuresSpan]: a
// shelter 25 × 25; an outpost 40 × 40 growing to 60 × 60 over its first 10 structures; the main hub 64 × 64 growing to
// 100 × 100 as it fills with buildings. The wall map (deploy.js) keeps its 18 columns and takes the yard's rows.
export const BASE_TIER = { shelter: [25, 25, 0, 1], outpost: [40, 60, 1, 10], hub: [64, 100, 3, 14] };
export function baseSide(base, nStructures) {
  if (!base) return BASE_TIER.outpost[0];
  const [from, to, n0, span] = BASE_TIER[base.tier === 0 ? "shelter" : base.type === "hub" ? "hub" : "outpost"];
  const side = from + (to - from) * clamp((nStructures - n0) / span, 0, 1);
  return from === to ? from : even(side);
}

// Where the two sides start (combat.js createBattle): your people within PLAYER_X columns of the west edge, the
// enemy HUMANS (people) or DEAD tiles from their middle, at most CONE off the line east (dx ≥ CONE × distance); an
// unaware group you ambush in pods POD tiles off; people who ambush you flank FLANK tiles to the side.
export const CONTACT = { PLAYER_X: 5, HUMANS: [15, 21], DEAD: [14, 20], CONE: 0.55, POD: [11, 18], FLANK: [6, 10], NEAR: 18 };
// Cover density: the share of open ground with something to hide behind within R tiles (Chebyshev) that densify tops
// a map up to (TARGET; OPEN on plains and by water, which stay more open), never more than MAX_ADD props a 100 tiles.
export const COVER = { R: 3, TARGET: 0.82, OPEN: 0.72, CITY: 0.86, MAX_ADD: 7, FAST: 80 * 60 }; // FAST: densify's quick draw past this many cells
// Raid maps (raidDims): a site's SIZES scale from LO to HI is its place between the run's smallest and largest raid
// map (worldcfg.js raidMin / raidMax: tiles across, ASPECT of that deep); LARGEST always the largest (a city's or a
// town's, a site-less city tile's too: the crawl's buildings and its street events), a bridge never under Large (its
// span: combat.js bridgeSpan).
export const RAID_RANGE = { LO: 0.5, HI: L, ASPECT: 0.75, LARGEST: ["city", "town"] };
// Raids: rooms and outdoor areas by size class (AREAS[class] = [min, max], between classes in between), containers
// a room by its floor area (one a BOX_AREA tiles, at least 2; a map past Extra-large on at the same rate), the dead scaled by the map's area over DEAD_AREA (the
// old 34 × 22 raid map) to the power DEAD_EXP, between DEAD_MIN and DEAD_MAX; late waves (spawnCap) the same way.
// DEAD_OLD: the cap on a map without the big-map scales (raidBig: an older save's neighbourhood street, 48 × 34).
export const RAID = { AREAS: [[2, 3], [3, 5], [5, 7], [6, 9]], BOX_AREA: 7, DEAD_AREA: 748, DEAD_EXP: 0.6, DEAD_MIN: 0.8, DEAD_MAX: 2.2, DEAD_OLD: 1.4, SPAWN_CAP: 12 };
// Raid maps past FROM tiles (the old Large 40 × 30; at or under it every factor is exactly 1): the dead of a building's
// map grow by (area / FROM) to the power DEAD_EXP (at most DEAD_MAX); Heat's base rise a turn falls by
// (FROM / area) to the power HEAT_EXP (at least HEAT_MIN of it); a container's find falls by (FROM / area) to the
// power LOOT_EXP (at least LOOT_MIN: there are more containers, each holds a little less); the dead that come in at
// Heat come in within NEAR tiles of your people when enough edge cells are that near.
export const BIG = { FROM: 1200, DEAD_EXP: 0.6, DEAD_MAX: 2, HEAT_EXP: 0.5, HEAT_MIN: 0.55, LOOT_EXP: 0.6, LOOT_MIN: 0.4, NEAR: 28 };
// The end of a battle whose fight is over: at most MAX_LEFT enemies left (and no more than FRAC of those it began
// with), none a boss, none outside a base's wall waiting to come in, every one of them unaware or running, FAR tiles
// or more from all your people and out of their sight. The AI ends it there; the player gets the choice (combat.js
// "callClear"). A fleeing person out of everyone's sight and GONE tiles off is gone.
export const CLEAR = { MAX_LEFT: 2, FRAC: 0.25, FAR: 10, GONE: 9 };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const even = (v) => { const r = Math.round(v); return r % 2 ? r - 1 : r; };

// W × H for a scale (0 = Small … 3 = Extra-large; in between, in between).
export function dimsAt(scale) {
  const s = clamp(Number(scale) || 0, 0, 3);
  const i = Math.min(2, Math.floor(s)), f = s - i;
  const a = SIZE_CLASSES[CLASS_KEYS[i]], b = SIZE_CLASSES[CLASS_KEYS[i + 1]];
  return [even(a.w + (b.w - a.w) * f), even(a.h + (b.h - a.h) * f)];
}
// The class a map of w × h is closest to (by area): "S", "M", "L" or "XL".
export function sizeClass(w, h) {
  let best = "S", bd = Infinity;
  for (const k of CLASS_KEYS) { const c = SIZE_CLASSES[k], d = Math.abs(Math.log((w * h) / (c.w * c.h))); if (d < bd) { bd = d; best = k; } }
  return best;
}
export const sizeName = (w, h) => SIZE_CLASSES[sizeClass(w, h)].name;
// A map in words for the panels: "Extra-large, 56 × 42", and what a map past the old Large (BIG.FROM) brings with it.
export const mapSizeText = (w, h) => `${sizeName(w, h)}, ${w} × ${h}`;
export const bigMapNote = (w, h) => (w * h > BIG.FROM ? "A big map: more rooms, containers and dead, a longer walk, and a way out on each long side of a street map. Heat climbs slower, and each container holds a little less." : "");

// ---------- by context ----------
const tileOf = (state, setup) => {
  const t = setup && setup.tile;
  return t && typeof t === "object" ? t : state && state.tiles ? state.tiles[t] : null;
};
export function siteScale(tile) {
  const t = tile || { terrain: "plains" };
  if (t.loc && SIZES.SITE[t.loc.type] != null) return SIZES.SITE[t.loc.type];
  if (t.bridge) return L; // a bridge raid: room for a 12–24 cell span with a bank either side (combat.js bridgeSpan)
  return SIZES.TERRAIN[t.terrain] ?? M;
}
// A city's or a town's raid map (and a crawl's buildings there) is always the run's largest.
export const largestRaid = (tile) => !!tile && ((tile.loc && RAID_RANGE.LARGEST.includes(tile.loc.type)) || (!tile.loc && tile.terrain === "city"));
const raidSide = (w) => [w, even(w * RAID_RANGE.ASPECT)];
// The run's smallest and largest raid maps, W × H (worldcfg.js raidRange: raidMin / raidMax in order; a world without
// them the usual).
export const raidMinDims = (state) => raidSide(even(raidRange(state)[0]));
export const raidMaxDims = (state) => raidSide(even(raidRange(state)[1]));
// A raid map's W × H: the site's place (SIZES.SITE / TERRAIN, LO to HI) between the run's smallest and largest. A save
// from before the dials (worldcfg.js legacyRaids): the old size by the site's class (28 × 20 to 40 × 30, a town 36 × 26).
export function raidDims(tile, state = null) {
  if (legacyRaids(state)) return dimsAt(siteScale(tile));
  const R = RAID_RANGE, [lo, hi] = raidRange(state);
  const f = largestRaid(tile) ? 1 : clamp((siteScale(tile) - R.LO) / (R.HI - R.LO), 0, 1);
  const [w, h] = raidSide(even(lo + (hi - lo) * f));
  if (tile && tile.bridge) return [Math.max(w, SIZE_CLASSES.L.w), Math.max(h, SIZE_CLASSES.L.h)];
  return [w, h];
}

// A fight in the open: by the people and the dead on the map, the terrain and the site.
export function fieldScale(tile, players, enemy) {
  const F = SIZES.FIELD, e = enemy || {};
  const n = Math.max(1, e.count || 1), zombies = e.kind === "zombies" ? n : e.kind === "mixed" ? Math.floor(n / 2) : 0;
  const crowd = players + (n - zombies) + zombies * F.ZOMBIE;
  let s = F.BASE + Math.max(0, crowd - F.FROM) * F.PER;
  const t = tile || { terrain: "plains" };
  if (t.terrain === "plains" || t.terrain === "water") s += F.OPEN;
  else if (t.terrain === "forest" || t.terrain === "hills" || t.terrain === "mountain") s += F.COVERED;
  if (t.bridge) s = Math.max(s, L); // a bridge: the span needs the room
  s = Math.min(F.MAX, s);
  if (t.loc && SIZES.SITE[t.loc.type] != null) s = Math.max(s, Math.min(F.MAX, SIZES.SITE[t.loc.type]) - F.SITE);
  return s;
}
export function fieldDims(state, setup) {
  const players = Math.min(8, combatants(state, setup).length || (setup.fighterIds || []).length || 3);
  return dimsAt(fieldScale(tileOf(state, setup), players, setup.enemy));
}
export const hiveDims = () => dimsAt(SIZES.HIVE);
export const growthDims = () => dimsAt(SIZES.GROWTH);
// A group's base you assault, by the people living there (conquest.js assaultForce: people, count).
export function assaultScale(enemy) {
  const A = SIZES.ASSAULT, e = enemy || {};
  const people = Math.max(e.people || 0, e.count || 0);
  return Math.min(A.MAX, A.BASE + Math.max(0, people - A.FROM) * A.PER);
}
export const assaultDims = (enemy) => dimsAt(assaultScale(enemy));
// Your own base's yard and buildings map, by its type and how many buildings stand there (interior.js).
export function baseScale(base, nStructures) {
  if (!base) return S;
  const [s0, from, per] = SIZES.BASE[base.type === "hub" && base.tier !== 0 ? "hub" : "outpost"]; // a shelter (tier 0): an outpost's small yard
  return s0 + clamp((nStructures - from) / per, 0, 1);
}

// ---------- cover ----------
const coverK = (c) => !!(CELL[c.k] && CELL[c.k].cover > 0);
const groundK = (c) => c.k === "open";
// The Chebyshev distance (capped at R + 1) from every cell to the nearest thing that gives cover.
function coverDist(cells, W, H, R) {
  const d = new Uint8Array(W * H).fill(R + 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!coverK(cells[y * W + x])) continue;
    for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx++) {
      const k = Math.max(Math.abs(xx - x), Math.abs(yy - y)), i = yy * W + xx;
      if (k < d[i]) d[i] = k;
    }
  }
  return d;
}
// The share of open ground (walkable "open" cells; with reach, only those your people can get to) with cover within
// R tiles. { share, open, covered }.
export function coverShare(cells, W, H, R = COVER.R, reach = null) {
  const d = coverDist(cells, W, H, R);
  let open = 0, covered = 0;
  for (let i = 0; i < W * H; i++) {
    if (!groundK(cells[i]) || (reach && !reach[i])) continue;
    open++;
    if (d[i] <= R) covered++;
  }
  return { share: open ? covered / open : 1, open, covered };
}
// What a prop on a floor is: rocks and trees on grass, hay on a field, rocks and boulders on dirt and gravel, wrecks,
// crates and barrels in the rubble, cars on the road, crates and counters indoors.
const PROPS = {
  grass: ["tree", "rock", "rock", "tree", "fence", "boulder"], field: ["hay", "hay", "fence", "tree"], dirt: ["rock", "rock", "boulder", "crate"],
  gravel: ["boulder", "rock", "rock"], rubble: ["crate", "rock", "barrel", "crate", "rock"], road: ["crate", "barrel"], // no single-cell cars: cars are 2 × 3–4 cells (combat.js placeCar)
  floor: ["crate", "counter", "cabinet"],
  // A hotel's grounds (hotellayout.js): a planter on the paving, never a rock in the empty pool or on a court.
  paving: ["plant"], pool: [], court: [],
};
// Tops a map up with props until COVER's share of its open ground has cover within R tiles (opts.target), placing
// each one where cover is furthest, on a cell whose eight neighbours are all open ground (so a prop never closes a
// way through), and never where opts.keep(x, y) says to keep clear. opts.props(floor) → list overrides PROPS.
// Returns how many were placed.
export function densify(cells, W, H, rng, opts = {}) {
  const R = opts.R || COVER.R, target = opts.target ?? COVER.TARGET;
  const cap = Math.round((W * H * COVER.MAX_ADD) / 100);
  const keep = opts.keep || (() => false);
  const d = coverDist(cells, W, H, R);
  const ok = (x, y) => {
    if (x < 1 || y < 1 || x > W - 2 || y > H - 2 || keep(x, y)) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!groundK(cells[(y + dy) * W + x + dx])) return false;
    return true;
  };
  let open = 0, covered = 0;
  for (let i = 0; i < W * H; i++) if (groundK(cells[i])) { open++; if (d[i] <= R) covered++; }
  let placed = 0, far = 0, cand = [];
  const fast = W * H > COVER.FAST;
  for (let guard = 0; guard < cap * 4 && placed < cap && open && covered / open < target; guard++) {
    // The open cells furthest from cover; one of them, or a cell next to it, takes a prop. A cell's distance only
    // falls and open ground only goes, so while some of the last ones are still that far they are all there is (in
    // the same order): the whole map is looked over again only when the furthest step down (interior.js
    // groundsBeyond's woodlot spent most of the yard map's making scanning it every prop: sizetest).
    // A map past COVER.FAST cells (the raid map dials past 80 across, issue #24: none an older save has): the stale ones
    // are dropped as they are drawn instead of the list filtered for every prop (that was most of a 300 × 224 map's
    // making); a smaller map keeps the filter, so its props fall where they always did.
    let i0 = -1;
    if (fast) {
      while (cand.length) { const j = rng.int(0, cand.length - 1), i = cand[j]; if (groundK(cells[i]) && d[i] === far) { i0 = i; break; } cand[j] = cand[cand.length - 1]; cand.pop(); }
    } else cand = cand.filter((i) => groundK(cells[i]) && d[i] === far);
    if (!cand.length) {
      far = 0;
      for (let i = 0; i < W * H; i++) if (groundK(cells[i]) && d[i] > far) far = d[i];
      if (far <= R) break;
      for (let i = 0; i < W * H; i++) if (groundK(cells[i]) && d[i] === far) cand.push(i);
    }
    if (i0 < 0) i0 = cand[rng.int(0, cand.length - 1)];
    const x0 = i0 % W, y0 = (i0 / W) | 0;
    let spot = null;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (ok(x0 + dx, y0 + dy)) { spot = [x0 + dx, y0 + dy]; break; }
    if (!spot) { d[i0] = 0; continue; } // no room for a prop here: leave it be
    const [x, y] = spot, c = cells[y * W + x];
    const list = (opts.props && opts.props(c.f)) || PROPS[c.f] || PROPS.grass;
    if (!list.length) { d[i0] = 0; continue; } // ground that takes no prop (an empty pool, a court)
    const was = c.k;
    c.k = list[rng.int(0, list.length - 1)];
    if (!coverK(c)) { c.k = was; d[i0] = 0; continue; }
    placed++;
    if (d[y * W + x] <= R) covered--; // the prop's own cell is no longer open ground
    open--;
    for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx++) {
      const k = Math.max(Math.abs(xx - x), Math.abs(yy - y)), j = yy * W + xx;
      if (k < d[j]) { if (d[j] > R && groundK(cells[j]) && j !== y * W + x) covered++; d[j] = k; }
    }
  }
  return placed;
}
export const coverTarget = (terrain) => (terrain === "plains" || terrain === "water" ? COVER.OPEN : terrain === "city" ? COVER.CITY : COVER.TARGET);

// ---------- where the sides start ----------
// Tests for createBattle's spawn cells, around pc (your people's middle). Every test also wants the cell east of
// your people (dx ≥ CONE × distance), so nobody starts behind them.
export function spawnRules(pc, people) {
  const C = CONTACT;
  const d = (x, y) => Math.hypot(x - pc[0], y - pc[1]);
  const ahead = (x, y, k = C.CONE) => x - pc[0] >= k * d(x, y);
  const band = ([lo, hi]) => (x, y) => { const r = d(x, y); return r >= lo && r <= hi && ahead(x, y); };
  return {
    player: (x) => x < C.PLAYER_X,
    front: (zombie) => band(zombie ? C.DEAD : C.HUMANS),
    pod: band(C.POD),
    // People who ambush you: half on the flank away from your people's side of the map, the rest ahead.
    flank: (top) => (x, y) => { const off = top ? pc[1] - y : y - pc[1]; return off >= C.FLANK[0] && off <= C.FLANK[1] && x >= pc[0] + 2 && x <= pc[0] + C.FLANK[1]; },
    ambushFront: band([C.HUMANS[0] - 3, C.HUMANS[1] - 3]),
    near: (x, y) => !people || people.some((p) => Math.hypot(p.x - x, p.y - y) <= C.NEAR),
  };
}

// ---------- the anti-slog guardrails ----------
// The fight is over in all but name (CLEAR): a couple of enemies left, far off, unaware or running, out of sight.
export function clearEnough(b) {
  if (!b || b.over || b.raid || b.phase === "deploy") return false;
  const foes = b.units.filter((u) => u.side === "enemy" && !u.dead && !u.fled && !u.left && !u.dormant); // a Sleeper lying where it is (sleepers.js) is no straggler
  if (foes.some((u) => u.off || u.boss)) return false;
  const left = foes.filter((u) => active(u));
  if (!left.length || left.length > CLEAR.MAX_LEFT || left.length > Math.max(1, Math.floor((b.enemyStart || 0) * CLEAR.FRAC))) return false;
  const mine = b.units.filter((u) => u.side === "player" && active(u));
  if (!mine.length) return false;
  return left.every((f) => (!f.aware || f.fleeing) && mine.every((p) => Math.hypot(p.x - f.x, p.y - f.y) >= CLEAR.FAR && !los(b, p.x, p.y, f.x, f.y)));
}
// A person running from the fight who is out of everyone's sight and far enough off is gone (combat.js flee). Behind
// a smoke grenade's cloud (throwables.js smokeScreens) a pursuer loses them at SMOKE.gone tiles, sight or not.
export function fledFarEnough(b, u) {
  const mine = b.units.filter((p) => p.side === "player" && active(p));
  return mine.every((p) => {
    const d = Math.hypot(p.x - u.x, p.y - u.y);
    return smokeScreens(b, p.x, p.y, u.x, u.y) ? d >= SMOKE.gone : d >= CLEAR.GONE && !los(b, p.x, p.y, u.x, u.y);
  });
}

// ---------- building maps (buildingmaps.js) ----------
// A raid into one building is the building's own floor plan (sized by its archetype) with the outside around it. A
// single-building site keeps its plan but gets at least its site's raid map (raidDims: a hospital's the largest, a gas
// station's the smallest): the outside margins grow (the parking lot and the street in front, the yard and the alley
// round the back) and densify covers the new ground. At a site with several buildings each is at least the run's
// smallest raid map; in a city or a town (a crawl's buildings) the largest.
// margins: the archetype's own; returns the grown margins.
// cap: the biggest map the building may have (mapCap), the target cut down to it (never below the building and its own
// margins: those are the archetype's, sized to it).
export function fitMargins(bw, bh, margins, [tw, th], cap = null) {
  const m = { ...margins };
  if (cap) { tw = Math.min(tw, cap); th = Math.min(th, cap); }
  const ew = Math.max(0, tw - (bw + m.left + m.right)), eh = Math.max(0, th - (bh + m.front + m.back));
  m.left += Math.floor(ew / 2); m.right += Math.ceil(ew / 2);
  m.front += Math.ceil(eh / 2); m.back += Math.floor(eh / 2);
  return m;
}
// The biggest raid map a building may have, by its kind (buildingmaps.js BUILDINGS key), W and H: MAP_CAP's, else none
// (the run's raid map dials and the building's own size decide). A hotel's 200 × 200 (issue #29, the user's request
// 2026-10-25: "add hotel 200x200 max"): the hotel and its grounds (parking, the drive, the pool, the gardens) within it
// (hotellayout.js sizes its grounds to fit).
// The civic and medical kinds (issue #49, the user's request 2026-10-26: "updating the map size of civic and medical
// buildings to be max size of 350x350"): a hospital's and a church's map up to 350 × 350 (a regional medical centre at
// real scale, a city medical centre's campus, a cathedral, a churchyard: civicsite.js sizes a site's map within it), the
// police, fire stations, city halls and courthouses 300 (a headquarters on its site), the clinics, infirmaries and vets
// the default (the dials, at most 300). The run's raid map dial goes to 300, so a cap of 300 or more never changes an older
// save's map.
export const MAP_CAP = { datacenter: 400, hotel: 200, prison: 400, jail: 130, cinema: 80, parkgarage: 80, regionalmall: 500, stripmall: 500, outlet: 500, amusement: 500, hospital: 350, church: 350, police: 300, firestation: 300, cityhall: 300, courthouse: 300 }; // a prison's complex up to the user's 400 × 400, a county jail's 130 (issue #31, prison.js); a mall's cinema and parking garage at their real size, a mall's whole map (issue #30, mall.js MALL.CAP); an amusement park's whole map, a theme park's up to 500 × 500 (issue #60, amusement.js); a data centre campus up to the user's 400 × 400 (issue #51, datacenter.js)
// Issue #55's six shops: the round's default cap (epic #39: 300 × 300); a big-box furniture showroom's map is about 90 × 80.
for (const k of ["furnstore", "laundromat", "thrift", "bakery", "butcher", "deli"]) MAP_CAP[k] = 300;
export const mapCap = (key) => MAP_CAP[key] || null;
export function buildingTarget(tile, single, state = null) {
  if (legacyRaids(state)) return single ? raidDims(tile, state) : dimsAt(S); // an older save: the old targets
  return single || largestRaid(tile) ? raidDims(tile, state) : raidMinDims(state);
}
// The outside of a building's map topped up with props (never inside the building or within a tile of it, nor in or
// next to an extraction zone).
// A shaped building (buildingmaps.js spec.shape, issue #23): within a tile of its parts, not its box (a courtyard gets cover).
export function densifyOutside(map, rng, terrain) {
  const B = map.building, zs = map.zones || [];
  const near = (r, x, y) => x >= r.x0 - 1 && x <= r.x0 + r.w && y >= r.y0 - 1 && y <= r.y0 + r.h;
  const keep = (x, y) => (B.parts ? B.parts.some((p) => near(p, x, y)) : near(B, x, y)) || zs.some((z) => x >= z.x0 - 1 && x <= z.x0 + z.w && y >= z.y0 - 1 && y <= z.y0 + z.h);
  return densify(map.cells, map.w, map.h, rng, { target: coverTarget(terrain), keep });
}

// ---------- raids ----------
// How many rooms and outdoor areas a raid map of w × h gets (between its class's range).
export function raidAreaRange(w, h) {
  const s = areaScale(w, h, true), i = Math.min(2, Math.floor(s)), f = s - i, a = RAID.AREAS[i], b = RAID.AREAS[i + 1]; // past Extra-large: on at its rate
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f)];
}
// The scale (0–3, dimsAt) a map of w × h stands at, by its area between the classes'. beyond: a map past
// Extra-large goes on past 3 at the Large–Extra-large step (a raid map up to the largest raid map dial).
export function areaScale(w, h, beyond = false) {
  const A = CLASS_KEYS.map((k) => SIZE_CLASSES[k].w * SIZE_CLASSES[k].h), a = w * h;
  if (a <= A[0]) return 0;
  for (let i = 0; i < 3; i++) if (a <= A[i + 1]) return i + (a - A[i]) / (A[i + 1] - A[i]);
  return beyond ? 3 + (a - A[3]) / (A[3] - A[2]) : 3;
}
// The area types for a raid: the site's list (combat.js AREA_SETS) shuffled, repeated if the map has room for more.
export function raidAreaTypes(rng, list, w, h) {
  const [lo, hi] = raidAreaRange(w, h);
  const n = rng.int(lo, hi), out = [];
  while (out.length < n) {
    const more = rng.shuffle(list.slice());
    for (const t of more) if (out.length < n) out.push(t);
    if (!list.length) break;
  }
  return out;
}
export const raidDeadScale = (w, h, big = true) => clamp(Math.pow((w * h) / RAID.DEAD_AREA, RAID.DEAD_EXP), RAID.DEAD_MIN, big ? RAID.DEAD_MAX : RAID.DEAD_OLD);
// Does a raid map get the big-map scales (more dead and a higher cap, slower Heat, a smaller find a container, the
// waves near your people, a way out on each long side): past the old Large, in a world made since the dials (an older
// save's maps play as they always did; combat.js keeps the answer on the raid, b.raid.big).
export const raidBig = (state, w, h) => !legacyRaids(state) && w * h > BIG.FROM;
// How much a map past the old Large has grown (1 at or under it): the factor the other scales below go by.
const bigGrowth = (w, h) => Math.max(1, (w * h) / BIG.FROM);
// The dead in a building's map (buildingmaps.js BMAP.DEAD_SCALE: [min, max] by the map's area over a Medium raid map's,
// "base" here): the base, and past the old Large more of them with the ground.
export const buildingDeadScale = (base, w, h) => Math.min(BIG.DEAD_MAX, base * Math.pow(bigGrowth(w, h), BIG.DEAD_EXP));
// The street map of a neighbourhood: its roster (STREET.DEAD) past the old Extra-large raid map (48 × 34) the same way.
export const streetDeadScale = (w, h) => clamp(Math.pow((w * h) / (SIZE_CLASSES.XL.w * SIZE_CLASSES.XL.h), RAID.DEAD_EXP), 1, RAID.DEAD_MAX);
// Heat's base rise a turn on a raid map w × h, as a share of the usual (the noise on top is not scaled).
export const raidHeatRate = (w, h) => clamp(Math.pow(1 / bigGrowth(w, h), BIG.HEAT_EXP), BIG.HEAT_MIN, 1);
// What a container holds on a raid map w × h, as a share of the usual (the loot dial and the site's reward on top).
export const raidLootShare = (w, h) => clamp(Math.pow(1 / bigGrowth(w, h), BIG.LOOT_EXP), BIG.LOOT_MIN, 1);
// The containers a room of w × h holds.
export const roomBoxes = (rng, w, h) => Math.max(2, Math.round(((w - 2) * (h - 2)) / RAID.BOX_AREA) + rng.int(0, 1));

// data-shops.js: the town's and the city's shops and services (their rows; this module's own rows win).
for (const [k, d] of Object.entries(NEW_KINDS)) if (SIZES.SITE[k] == null) SIZES.SITE[k] = d.size;
