// @ts-check
// The gun distribution (user, 2026-10-10: "add guns to all loot pools that make sense and add to city and hive crawls
// and items that AI groups can have"): which gun a source yields, from one table.
//
// data-guns.js GUN_CLASS says what kind of gun each one is (its uses: civilian, hunting, police, military, special,
// makeshift, surplus; its era), GUN_RARITY how common, and GUN_SOURCES / PLACE_DRAWS / THEME_DRAWS what each source
// draws. A gun's weight in a source: its tier's FIND_W (× the source's tier factor) × the source's draw for the gun's
// best use (× its era factor), 0 when the gun is not of a use the source draws (or its theme tags miss a place's, or
// it is out of the source's power band or kinds).
//
// A list's gun is swapped for one of the same kind (GEAR cat: a pistol for a pistol, a rifle for a rifle) when the
// source has one, so a list still says how many pistols, shotguns, rifles and automatic weapons a place holds.
//
// The dice. Every source keeps its own odds of yielding a gun and its own dice for them. Where a source's list gave a
// gun on the world's random numbers (a site's gear list, a raid container's, a kit's weapons), swapGun picks which gun
// from a hash of the draw's position (the Rng's state after it, as itemcond.js and gunmods.js do): no extra draw, so
// the world's dice stay where they were. Where a source has dice of its own (gunfinds.js, gun safes, hashed kits),
// drawGun takes one of them.
//
// A fighter's gun (kits: band) is picked within ± band of the power of the gun the kit's list gave and within HIT_BAND
// of its hit, of the same kind when one fits, its weights leaned so the gun's power is the listed one's on the whole (tilt): each kind of fighter
// is as strong as before; its list still says how strong.
import { GEAR } from "./data.js";
import { WEAPONS } from "./combat.js"; // call time only (combat.js imports this module)
import { hash01 } from "./skills.js";
import { ITEM_TAGS, SITE_TAGS, AREA_TAGS } from "./loot.js";
import { GUN_CLASS, GUN_USES, GUN_ERAS, GUN_RARITY, GUN_SOURCES, PLACE_DRAWS, THEME_DRAWS, ARSENAL_FINDS } from "./data-guns.js";

// Off switch (tools/gunloottest.js: with it off every source yields what its own list says, on the same dice).
export const GUN_DIST = { off: false };
// The kinds of item that are guns (launchers, bows and melee are not).
export const GUN_CATS = ["pistol", "shotgun", "rifle", "automatic"];
/** @param {string} k */
export const isGun = (k) => !!(k && GEAR[k] && GEAR[k].slot === "weapon" && GUN_CATS.includes(GEAR[k].cat));
let GUNS = /** @type {string[] | null} */ (null);
// Every gun, sorted (read late: data.js GEAR is filled by the modules that load after this one).
export function allGuns() {
  if (!GUNS) GUNS = Object.keys(GEAR).filter(isGun).sort();
  return GUNS;
}

// A gun's class: { uses, era, tier, derived }. A gun with no GUN_CLASS line gets one from its theme tags (loot.js
// ITEM_TAGS: where it is kept), derived: true (tools/gunloottest.js wants every gun listed).
const THEME_USE = { military: "military", crash: "military", police: "police", prison: "police", hunt: "hunting", farm: "hunting", outdoor: "hunting",
  home: "civilian", guns: "civilian", travel: "civilian", shop: "civilian", sport: "civilian", crime: "civilian", camp: "hunting" };
/** @param {string} k */
export function gunClass(k) {
  const list = GUN_CLASS[k];
  const derived = !list;
  const tags = list || [...new Set((ITEM_TAGS[k] || []).map((t) => THEME_USE[t]).filter(Boolean))];
  const uses = tags.filter((t) => GUN_USES.includes(t));
  const era = tags.find((t) => GUN_ERAS.includes(t)) || "modern";
  if (GEAR[k] && GEAR[k].makeshift && !uses.includes("makeshift")) uses.push("makeshift");
  return { uses: uses.length ? uses : ["civilian"], era, tier: GUN_RARITY[k] || "scarce", derived };
}

// ---------- sources ----------
const SITE_THEME = { police: "police", prison: "police", military: "military", crash_mil: "military", convoy: "military", airdrop: "military" };
// The draws of a list of loot.js theme tags: the best of each use among them.
/** @param {string[]} tags */
function themeDraws(tags) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const t of tags || []) for (const [u, w] of Object.entries(THEME_DRAWS[t] || {})) out[u] = Math.max(out[u] || 0, w);
  return out;
}
// A source's definition by name: GUN_SOURCES, or a place ("site:<type>", "area:<type>", "area:<type>@<site type>").
/** @param {string} name @returns {any} */
export function sourceDef(name) {
  if (GUN_SOURCES[name]) return GUN_SOURCES[name];
  const m = /^(site|area):([^@]+)(?:@(.+))?$/.exec(name || "");
  if (!m) return null;
  const [, kind, type, site] = m;
  const theme = (kind === "site" ? SITE_TAGS : AREA_TAGS)[type];
  if (!theme) return null;
  const at = site ? SITE_THEME[site] || site : null;
  const draws = (at && PLACE_DRAWS[`${kind}:${type}@${at}`]) || PLACE_DRAWS[`${kind}:${type}`] || themeDraws(theme);
  return { draws, theme };
}
// The source name of a raid container (combat.js searchBox, citycrawl.js): its area at a site.
/** @param {string} areaType @param {string | null} [site] */
export const areaSourceName = (areaType, site = null) => (site && SITE_THEME[site] ? `area:${areaType}@${SITE_THEME[site]}` : `area:${areaType}`);

/** @param {any} def @param {string} k */
function weightIn(def, k) {
  const c = gunClass(k);
  const draw = Math.max(0, ...c.uses.map((u) => (def.draws && def.draws[u]) || 0));
  if (!(draw > 0)) return 0;
  if (def.theme && !(ITEM_TAGS[k] || []).some((t) => def.theme.includes(t))) return 0;
  if (def.cats && !def.cats.includes(GEAR[k].cat)) return 0;
  const p = GEAR[k].power || 0;
  if (def.power && (p < def.power[0] || p > def.power[1])) return 0;
  const tierW = (ARSENAL_FINDS.FIND_W[c.tier] ?? 0) * (def.tier && def.tier[c.tier] != null ? def.tier[c.tier] : 1);
  const eraW = def.era && def.era[c.era] != null ? def.era[c.era] : 1;
  return draw * tierW * eraW;
}
// A gun's hit on the battle map (combat.js WEAPONS dmg, the middle of it): a fighter's gun hits within HIT_BAND of
// the listed one's as well (a 20 gauge for a 12 gauge sawn-off would weaken a raider whose power it matches).
const HIT_BAND = 0.15;
/** @param {string} k */
const hitOf = (k) => { const w = WEAPONS[k]; return w && Array.isArray(w.dmg) ? (w.dmg[0] + w.dmg[1]) / 2 : 0; };
// A band's weights leaned (× e^(λ × (power − p0))) so the mean power of the gun picked is the listed gun's own p0 (as
// near as the band allows): a kit's fighters are as strong on the whole as with its list's guns.
/** @param {Record<string, number>} pool @param {number} p0 */
function tilt(pool, p0) {
  const ks = Object.keys(pool);
  if (ks.length < 2) return pool;
  const mean = (l) => { let s = 0, w = 0; for (const k of ks) { const x = pool[k] * Math.exp(l * ((GEAR[k].power || 0) - p0)); s += x * (GEAR[k].power || 0); w += x; } return s / w; };
  let lo = -8, hi = 8;
  if (mean(hi) <= p0) lo = hi; else if (mean(lo) >= p0) hi = lo;
  else for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (mean(m) < p0) lo = m; else hi = m; }
  const l = (lo + hi) / 2;
  return Object.fromEntries(ks.map((k) => [k, pool[k] * Math.exp(l * ((GEAR[k].power || 0) - p0))]));
}
const CACHE = new Map();
// Clears the cache (tools: after changing GUN_CLASS, GUN_SOURCES or GEAR).
export function resetGunDist() { CACHE.clear(); GUNS = null; }
// A source's guns: { key: weight }. opts.near: the gun a list gave (swapGun): only guns of its kind (GEAR cat) when the
// source has any, and for a source with a band only those within ± band of its power (of its kind when any is, else
// any kind in the band). opts.def: a definition of the caller's (cached under `name`).
/** @param {string} name @param {{ near?: string | null, def?: any }} [opts] @returns {Record<string, number>} */
export function gunsFrom(name, opts = {}) {
  const near = opts.near && isGun(opts.near) ? opts.near : null;
  const id = `${name}|${near || ""}`;
  if (CACHE.has(id)) return CACHE.get(id);
  const def = opts.def || sourceDef(name);
  /** @type {Record<string, number>} */
  let out = {};
  if (def) {
    for (const k of allGuns()) { const w = weightIn(def, k); if (w > 0) out[k] = w; }
    if (near) {
      const p0 = GEAR[near].power || 0;
      const h0 = hitOf(near);
      const inBand = def.band != null ? Object.keys(out).filter((k) => Math.abs((GEAR[k].power || 0) - p0) <= def.band + 1e-9 && (!h0 || Math.abs(hitOf(k) / h0 - 1) <= HIT_BAND)) : Object.keys(out);
      const same = inBand.filter((k) => GEAR[k].cat === GEAR[near].cat);
      const keep = same.length ? same : inBand;
      out = Object.fromEntries(keep.map((k) => [k, out[k]]));
      if (def.band != null) out = tilt(out, p0);
    }
  }
  CACHE.set(id, out);
  return out;
}
// A weighted pick with u in [0, 1): the keys in order, so the same u gives the same gun.
/** @param {Record<string, number>} pool @param {number} u @returns {string | null} */
export function pickFrom(pool, u) {
  const list = Object.keys(pool).sort().filter((k) => pool[k] > 0);
  const tot = list.reduce((a, k) => a + pool[k], 0);
  if (!(tot > 0)) return null;
  let x = u * tot;
  for (const k of list) { x -= pool[k]; if (x < 0) return k; }
  return list[list.length - 1];
}
// One gun from a source with u in [0, 1) (the source's own dice), or null.
/** @param {string} name @param {number} u @param {{ near?: string | null }} [opts] */
export const drawGun = (name, u, opts = {}) => pickFrom(gunsFrom(name, opts), u);

// The dice of a roll: an Rng (its position: no draw), a number, a string or a list of parts (as itemcond.js).
/** @param {any} roll */
const rollBase = (roll) => (roll && typeof roll === "object" && !Array.isArray(roll) && "state" in roll ? `r${roll.state}` : Array.isArray(roll) ? roll.join(":") : String(roll));
// The gun a source yields where its own list gave `key` (on whatever dice): a gun of its kind from the source's draws
// (a kit's in its band around `key`), on a hash of `roll`; anything not a gun, or a source with nothing to give, stays
// as it was.
/** @param {string} name @param {string} key @param {any} roll @returns {string} */
export function swapGun(name, key, roll) {
  if (GUN_DIST.off || !isGun(key)) return key;
  const def = sourceDef(name);
  if (!def) return key;
  return pickFrom(gunsFrom(name, { near: key }), hash01(rollBase(roll), "gunswap", name)) || key;
}
// The kit sources (combat.js KITS kinds): "kit:<kind>" when listed, else the survivors'.
/** @param {string} kind */
export const kitGunSource = (kind) => (GUN_SOURCES[`kit:${kind}`] ? `kit:${kind}` : "kit:survivors");
/** @param {string} kind */
export const bodyGunSource = (kind) => (GUN_SOURCES[`body:${kind}`] ? `body:${kind}` : "body:survivors");
