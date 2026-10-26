// @ts-check
// The shared variant picker, the base tool every building type with named plans uses (issue #41 of the round-2 epic
// #39; the user's request 2026-10-26: "Implement a variant picker to be the base tool"). Epic #7's tickets each had a
// picker of their own (officeplans.js, civicvariants.js, shopvariants.js, industrylayout.js, milplans.js, prison.js,
// hotels.js / data-hotels.js, buildvariants.js, librarylayout.js, eaterylayout.js, bunkerlayout.js, mall.js,
// buildingmaps.js SCHOOL_VARIANTS, campusplans.js), each weighing the dice, the franchise, the setting, a pinned plan
// and older saves its own way. They all register their plans here and pick through pickVariant; a new type (epic #39's
// wave 2) does the same and needs nothing else.
//
// THE REGISTRY. registerVariants(key, list, opts): key a building type ("hospital", "warehouse") or a namespaced list
// ("prison:housing", "hotel:inn", "mall:strip", "library"); list its entries, in a fixed order (the dice walk it):
//   { id, name,                 the plan's id (spec.vid, unique within the key) and name (spec.vname: planname.js)
//     w?: { <setting>: n },      its weight by setting (settings.js SETTINGS: centre, city, suburb, town, rural, highway;
//                                an older table's own words where its module passes them; w.any where the setting
//                                is not named; a site's type, as #36's infirmaries "prison", see ctx.site)
//     fr?: [franchise ids],      the franchises it belongs to (a franchise narrows the pool to these)
//     size?, storeys?,           its REAL_SIZE sizes row and storeys (data-buildingsize.js; read by its maker)
//     tile?: [tile classes],     the tile classes it stands on (ctx.tileClass narrows the pool to these: #42's
//                                placement.js TILE_CLASSES, the six settings plus coast and scenic)
//     sizeClass?,                its size class (small, medium, large, huge: #42's SIZE_CLASSES; else opts.sizeClass's)
//     make?(rng, o, plan) }      its spec (the module's own maker; the picker never calls it)
// opts (how the type's table reads, so a ported module's picks stay where they were):
//   missing   the weight of an entry whose w lacks the setting (default 0; 1 for the tables where unset means 1)
//   frMin     the least weight of a franchise's entry (#36: a chain's plan in a setting it rarely stands in, 0.05)
//   le        true: the walk stops at x <= 0 (Rng.weighted's rule: #23's schools, #34's libraries), not x < 0
//   index     true: a number pins the entry at that index (#26's bunkers, #27's offices)
//   byName    true: a name pins as an id does (#27's offices: their plans were pinned by name)
//   sizeClass (entry) → its size class, for entries that do not say (#42's placement.js sizeClassOf on its size row)
//   sub       true: a plan's own sub-plans (a library variant's two plans), not a building type: varianttest's dozen-plans
//             rule skips it
//
// THE PICK. pickVariant(key, rng, ctx) → the entry, or null. ctx: { setting, site, tileClass, size, franchise, ids,
// plan, legacy, r, only } (#42's placement.js placementCtx gives setting, tileClass and size). In order:
//   1. ctx.legacy (an older save's building): null, and no dice: the caller keeps its classic plan.
//   2. The dice: ctx.r (a 0–1 number the caller drew: one rng.next() before the pin, as #35's and #36's pickers always
//      did; or a function, called only when the dice are needed: #31's prison plans draw only when not pinned); else
//      hash dice read from the building's dice as they stand (hash01(rng.state, "variant", key)): never consumed, so
//      the rest of the plan rolls as it would have, and a type's picks stay where they are when a plan is added
//      elsewhere.
//   3. A pinned plan always wins (ctx.plan: an id; with opts.index a number; with opts.byName a name).
//   4. The pool: ctx.only (a filter: #31's plans that fit a site), then the franchise (entries whose fr has
//      ctx.franchise; none: the whole pool), the chain's list (ctx.ids: a chain's plan.variants, #35 and #38), the
//      tile class (entries whose tile has ctx.tileClass), the size (entries of size class ctx.size). Each narrowing that
//      leaves nothing is skipped.
//   5. The weights: a site some of the type's entries name (w[ctx.site]) weighs by it alone; else w[ctx.setting], else
//      w[ctx.tileClass], else w[ctx.size], else w.any, else opts.missing; every entry 1 (or its w.any) when no setting,
//      tile class or size is given; a franchise's entries at least opts.frMin.
//   6. The walk: x = r × the total, take the first entry with weight that brings x below 0 (opts.le: to 0 or below);
//      a total of 0 takes the pool's floor(r × n)th.
// HELPERS. variantsOf(key) (the list, [] for none), variantFor(key, id) (an entry by id, or null), variantKeys() (the
// registered keys): varianttest.js reads the registry through them, the gallery and #42's placement table too.
// No imports, so the data tables (data-hotels.js) and the plan makers can register without a cycle. hash01: skills.js's
// deterministic roll, the same function (the same dice for the same parts).
/** @param {...any} parts @returns {number} */
function hash01(...parts) {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const str = String(part);
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    h = Math.imul(h ^ 0x9e3779b9, 16777619) >>> 0;
  }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** @typedef {{ id: string, name: string, w?: Record<string, number>, fr?: string[], size?: string, storeys?: number[] | number, tile?: string[], make?: Function, [k: string]: any }} VariantEntry */
/** @typedef {{ missing?: number, frMin?: number, le?: boolean, index?: boolean, byName?: boolean, sub?: boolean, sizeClass?: (e: any) => string | null }} VariantOpts */
/** @typedef {{ setting?: string | null, site?: string | null, tileClass?: string | null, size?: string | null, franchise?: string | null, ids?: string[] | null, plan?: string | number | null, legacy?: boolean, r?: number | (() => number), only?: (e: VariantEntry) => boolean }} VariantCtx */

/** @type {Map<string, { list: VariantEntry[], opts: VariantOpts }>} */
const REGISTRY = new Map();

/**
 * Registers a type's plans (the header's entries and opts). Registering a key again replaces it. Returns the list.
 * @template {VariantEntry} T @param {string} key @param {T[]} list @param {VariantOpts} [opts] @returns {T[]}
 */
export function registerVariants(key, list, opts = {}) {
  REGISTRY.set(key, { list, opts });
  return list;
}
/** The registered plans of a key ([] for none). @param {string} key @returns {VariantEntry[]} */
export const variantsOf = (key) => (REGISTRY.has(key) ? /** @type {any} */ (REGISTRY.get(key)).list : []);
/** A registered plan by its id, or null. @param {string} key @param {string | null | undefined} id @returns {VariantEntry | null} */
export const variantFor = (key, id) => (id == null ? null : variantsOf(key).find((e) => e.id === id) || null);
/** The registered keys, in the order they registered. */
export const variantKeys = () => [...REGISTRY.keys()];
/** A key's opts ({} for none). @param {string} key @returns {VariantOpts} */
export const variantOpts = (key) => (REGISTRY.has(key) ? /** @type {any} */ (REGISTRY.get(key)).opts : {});

/**
 * The pinned entry of a list (ctx.plan: an id; opts.index a number; opts.byName a name), or null.
 * @param {VariantEntry[]} list @param {any} plan @param {VariantOpts} opts
 */
function pinnedOf(list, plan, opts) {
  if (plan == null || plan === "") return null;
  if (typeof plan === "number") return opts.index && list[plan] ? list[plan] : null;
  return list.find((e) => e.id === plan) || (opts.byName ? list.find((e) => e.name === plan) : null) || null;
}

/**
 * The plan a building takes (the header's rules), among the entries of `key` (registered) or of `list` (pickFrom).
 * @param {string} key @param {any} rng @param {VariantCtx} [ctx] @returns {VariantEntry | null}
 */
export function pickVariant(key, rng, ctx = {}) {
  const R = REGISTRY.get(key);
  return R ? pickFrom(R.list, rng, ctx, R.opts, key) : null;
}

/**
 * pickVariant's rules on a list of entries (registered or not) and its opts.
 * @template {VariantEntry} T @param {T[]} list @param {any} rng @param {VariantCtx} [ctx] @param {VariantOpts} [opts] @param {string} [salt] @returns {T | null}
 */
export function pickFrom(list, rng, ctx = {}, opts = {}, salt = "") {
  if (ctx.legacy || !list || !list.length) return null;
  const given = ctx.r;
  let r = typeof given === "number" ? given : null; // a number the caller drew: always drawn, pinned or not
  const pinned = /** @type {T | null} */ (pinnedOf(list, ctx.plan, opts));
  if (pinned) return pinned;
  if (r == null) r = typeof given === "function" ? given() : hash01(rng && rng.state != null ? rng.state : 0, "variant", salt);
  // The pool, narrowed in turn (a narrowing that leaves nothing is skipped).
  let pool = ctx.only ? list.filter(ctx.only) : list;
  if (!pool.length) pool = list;
  const byFr = ctx.franchise ? pool.filter((e) => e.fr && e.fr.includes(/** @type {string} */ (ctx.franchise))) : [];
  if (byFr.length) pool = byFr;
  if (ctx.ids && ctx.ids.length) { const ids = ctx.ids, inIds = pool.filter((e) => ids.includes(e.id)); if (inIds.length) pool = inIds; }
  if (ctx.tileClass) { const tc = /** @type {string} */ (ctx.tileClass), onTile = pool.filter((e) => e.tile && e.tile.includes(tc)); if (onTile.length) pool = onTile; }
  if (ctx.size) { const sc = (/** @type {T} */ e) => e.sizeClass || (opts.sizeClass ? opts.sizeClass(e) : null), sized = pool.filter((e) => sc(e) === ctx.size); if (sized.length) pool = sized; }
  // The weights.
  const site = ctx.site && list.some((e) => e.w && e.w[/** @type {string} */ (ctx.site)] != null) ? ctx.site : null; // a site the type's plans name (any of them: #36's rule)
  const missing = opts.missing ?? 0, floor = byFr.length ? opts.frMin || 0 : 0;
  const wOf = (/** @type {T} */ e) => {
    const w = e.w || {};
    if (site) return w[site] || 0;
    const keys = [ctx.setting, ctx.tileClass, ctx.size].filter((k) => k != null);
    if (!keys.length) return w.any ?? 1;
    for (const k of keys) if (w[/** @type {string} */ (k)] != null) return w[/** @type {string} */ (k)];
    return w.any ?? missing;
  };
  const ws = pool.map((e) => Math.max(floor, wOf(e)));
  const tot = ws.reduce((a, b) => a + b, 0);
  if (!(tot > 0)) return pool[Math.floor(r * pool.length) % pool.length];
  let x = r * tot;
  if (opts.le) { for (let i = 0; i < pool.length; i++) { x -= ws[i]; if (x <= 0) return pool[i]; } return pool[pool.length - 1]; } // Rng.weighted's walk, exactly
  for (let i = 0; i < pool.length; i++) { x -= ws[i]; if (ws[i] > 0 && x < 0) return pool[i]; }
  for (let i = pool.length - 1; i >= 0; i--) if (ws[i] > 0) return pool[i];
  return pool[pool.length - 1];
}
