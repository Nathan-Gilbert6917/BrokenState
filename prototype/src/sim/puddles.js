// @ts-check
// Puddles after rain (the user's request 2026-10-23: "Add water puddles on the ground as decor when it's raining and
// after a tile has been rained on for x hours."): rain water standing on the level outdoor ground of a fight's, a
// raid's or a base's map (combat.js createBattle / createRaid, after ponds.js pondsBattle and seasonground.js
// seasonGround). Decor only: no move cost, no aim, nothing the AI reads (the cells' c.pud is drawn and named in the
// hover, nothing else).
//   - How wet the ground is (rainWater): the tile's own sky an hour at a time (weather.js skyAt: the rain belts, WAVE,
//     sweep over it and move on) over the last LOOKBACK hours to the battle's hour (the clock stands still in a
//     fight, so it is the weather of the hour the map was made). Water w: a rain hour adds 1 (a thunderstorm's
//     STORM), up to FULL; the first puddles stand once w reaches AFTER (the user's "x hours"); after that a dry hour
//     takes FULL / DRY away, so the most puddles are gone DRY hours after the rain stops, shrinking all the while,
//     fewer ones sooner. Rain again before they have dried tops them up; once dry it takes AFTER hours again.
//   - The level (puddleLevel) 0..1 is w / FULL while puddles stand, 0 otherwise; none on frozen ground (weather.js
//     frozen, or the hollows' ponds frozen: ponds.js pondIce), while snow lies (seasonground.js SNOW.MIN; b.snowLie)
//     or under the ground (a hive's caves: NO_SKY, as wxsight.js UNDERGROUND). No dice: deterministic from the seed.
//   - Where (puddlesBattle): the share of the level outdoor ground in puddles is puddleShare(level): SHARE.MIN (3%) at
//     the first, SHARE.MAX (15%) at FULL, down to none as they dry. The cells: smooth two-octave noise from the cell
//     and the tile (SCALE cells between its points; never the game's RNG) cut at the share's quantile, so the same
//     tile's puddles lie in the same low spots and spread out from them the wetter it is. Only on the flat ground
//     (puddleGround: FLOORS grass, field, dirt, gravel, road, rubble; KINDS open ground; not a pond (c.wet), a building's
//     floor, a bridge's deck, a hill, a hollow or the cells round them (drawn as the ground's column), the snow).
//     Spring's mud (c.gnd "mud") may have one: a muddy puddle.
//   - c.pud: the puddle's depth there (0.5 at its edge up to 1 in its middle: DEPTH); b.puddles { level, share, n,
//     key }: the view's ground pictures' key (ui/groundlook.js groundLookKey) changes with it, so a new level paints
//     the ground once. ui/groundlook.js puddleField / puddleTexel draw them; ui/battlewx.js rings them in the rain.
// API: rainWater(state, tileId, hour) -> { w, formed, rain, since }; puddleLevel(state, tileId, hour, b) -> 0..1;
//      waterOf(skies) (the same from a list of sky kinds, oldest first); puddleShare(level); puddleGround(c);
//      puddlesBattle(state, b, tileId) -> cells marked; puddleWord(c) (ui/combat.js hover).
import { skyAt, weatherAt } from "./weather.js";
import { pondIce } from "./ponds.js"; // call-time only (ponds.js imports combat.js, which imports this)
/** @import { State } from "./types" */

export const PUDDLE = {
  AFTER: 3,        // hours of rain before the first puddles stand (the user's "x hours")
  FULL: 10,        // hours of rain for the most puddles
  DRY: 12,         // hours with no rain until the most puddles are gone (they shrink all that time)
  LOOKBACK: 36,    // hours of the tile's sky looked back over (more than FULL + DRY)
  STORM: 1.5,      // a thunderstorm's hour counts as this many hours of rain
  SHARE: { MIN: 0.03, MAX: 0.15 }, // the share of the level outdoor ground in puddles: at the first, at FULL
  SCALE: 4,        // cells between the noise's points (puddles a cell or three across)
  DEPTH: { EDGE: 0.5, SPAN: 6 }, // c.pud: EDGE at a puddle's edge, deeper by SPAN × how far under the cut its noise is
  FLOORS: new Set(["grass", "field", "dirt", "gravel", "road", "rubble"]), // outdoors (not a building's floor or roof)
  KINDS: new Set(["open", "outline", "torn"]), // open ground (a base's building outline drawn on it too)
  SNOW_MIN: 0.15,  // snow cover from which snow lies (seasonground.js SNOW.MIN): no puddles
};
const RAIN = { rain: 1, storm: PUDDLE.STORM }; // weather.js sky kinds that are rain, and how much an hour adds
// Maps under ground (hivecrawl.js layouts; wxsight.js UNDERGROUND): no weather.
const NO_SKY = new Set(["hivechamber", "hivecore"]);

/**
 * The water on the ground after a run of skies (weather.js sky kinds, oldest first): { w (0..FULL), formed (puddles
 * standing), rain (rain hours counted), since (hours since the last rain; 0 raining now) }.
 * @param {string[]} skies
 */
export function waterOf(skies) {
  let w = 0, formed = false, rain = 0, since = PUDDLE.LOOKBACK;
  for (const k of skies) {
    const add = RAIN[k] || 0;
    if (add) {
      w = Math.min(PUDDLE.FULL, w + add); rain++; since = 0;
      if (w >= PUDDLE.AFTER) formed = true;
    } else {
      w = Math.max(0, w - PUDDLE.FULL / PUDDLE.DRY); since++;
      if (w <= 1e-9) { w = 0; formed = false; }
    }
  }
  return { w, formed, rain, since };
}
/** The tile's water from its own sky over the last LOOKBACK hours to `hour`. @param {State} state @param {number} tileId @param {number} [hour] */
export function rainWater(state, tileId, hour = state.hour) {
  const skies = [];
  for (let h = Math.max(0, hour - PUDDLE.LOOKBACK + 1); h <= hour; h++) skies.push(skyAt(state, tileId, h));
  return waterOf(skies);
}
/** The level 0..1 for a water state: w / FULL while puddles stand. @param {{ w: number, formed: boolean }} s */
export const levelOf = (s) => (s && s.formed ? Math.round((s.w / PUDDLE.FULL) * 100) / 100 : 0);
/**
 * How many puddles a tile has at an hour, 0..1: none before AFTER hours of rain, FULL's 1, drying over DRY hours; none on
 * frozen ground, while snow lies (or b.snowLie) or under the ground (b: the battle, optional).
 * @param {State} state @param {number | null} tileId @param {number} [hour] @param {any} [b]
 */
export function puddleLevel(state, tileId, hour = state.hour, b = null) {
  if (tileId == null || !state || !state.tiles) return 0;
  if (b && ((b.setup && NO_SKY.has(b.setup.layout)) || b.snowLie)) return 0;
  try {
    const wx = weatherAt(state, tileId, hour);
    if (wx.frozen || (wx.snowCover || 0) >= PUDDLE.SNOW_MIN || pondIce(state, Math.floor(hour / 24))) return 0;
    return levelOf(rainWater(state, tileId, hour));
  } catch { return 0; } // no calendar or weather (the tools' bare states)
}
/** The share of the level outdoor ground in puddles at a level: MIN at the first (AFTER), MAX at FULL, less as it dries. @param {number} level */
export function puddleShare(level) {
  if (!(level > 0)) return 0;
  const a = PUDDLE.AFTER / PUDDLE.FULL, { MIN, MAX } = PUDDLE.SHARE;
  return level >= a ? MIN + (MAX - MIN) * Math.min(1, (level - a) / (1 - a)) : MIN * (level / a);
}

function hash(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Smooth value noise in 0..1 at cell (x, y): two octaves, the points SCALE cells apart.
function noise(x, y, seed) {
  const at = (s, k) => {
    const fx = x / s, fy = y / s, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = hash(ix, iy, seed + k), b = hash(ix + 1, iy, seed + k), c = hash(ix, iy + 1, seed + k), d = hash(ix + 1, iy + 1, seed + k);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  };
  return at(PUDDLE.SCALE, 0) * 0.7 + at(PUDDLE.SCALE / 2.5, 5) * 0.3;
}
// The noise's values are bunched round the middle: the share wanted → the threshold that gives about that share.
let QUANT = null;
function below(share) {
  if (share <= 0) return -1;
  if (!QUANT) { const v = []; for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) v.push(noise(x, y, 7331)); QUANT = v.sort((a, b) => a - b); }
  return QUANT[Math.floor(Math.min(1, share) * (QUANT.length - 1))];
}

/** Can a puddle stand on this cell (the level outdoor ground)? @param {any} c */
export const puddleGround = (c) => !!c && PUDDLE.FLOORS.has(c.f) && PUDDLE.KINDS.has(c.k) && !c.wet && !c.deck && !c.spring && c.gnd !== "snow" && !(c.ter && c.h);

/**
 * Rain water standing on a battle map's level outdoor ground: c.pud (depth) on the puddles' cells, b.puddles for the
 * view. Returns the cells marked. The game's dice are not touched.
 * @param {State} state @param {any} b @param {number | null} tileId
 */
export function puddlesBattle(state, b, tileId) {
  if (!b || !b.cells || tileId == null) return 0;
  const level = puddleLevel(state, tileId, state.hour, b), share = puddleShare(level);
  if (!(share > 0)) return 0;
  const { cells, w: W, h: H } = b, cut = below(share), seed = (tileId * 7919 + 4243) | 0;
  // Not on a hill, a hollow or the ground round them (drawn as the ground's own column, ui/isoview.js terrainPrims).
  const hilly = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const c = cells[i];
    if (!c.ter || !c.h) continue;
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) hilly[ny * W + nx] = 1; }
  }
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    const c = cells[i];
    if (hilly[i] || !puddleGround(c)) continue;
    const v = noise(i % W, (i / W) | 0, seed);
    if (v >= cut) continue;
    c.pud = Math.round(Math.min(1, PUDDLE.DEPTH.EDGE + (cut - v) * PUDDLE.DEPTH.SPAN) * 20) / 20;
    n++;
  }
  if (n) b.puddles = { level, share: Math.round(share * 1000) / 1000, n, key: `p${tileId}:${share.toFixed(3)}` };
  return n;
}
// The battle's hover words (ui/combat.js previewText).
/** @param {any} c */
export function puddleWord(c) {
  if (!c || !c.pud) return "";
  return `<b>Puddles</b><span class="muted">: rain water standing on the ground (no effect on movement or aim).</span>`;
}
