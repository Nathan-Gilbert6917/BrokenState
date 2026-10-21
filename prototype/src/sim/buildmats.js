// @ts-check
// Building materials and metal sheets in what is built (the user's calls 2026-10-21: "make sure all buildings require
// building materials to some degree depending on the building"; metal sheets "used for metal wall upgrades, building
// buildings and other builds that make sense to have a roof or reinforced with metal"). Plain rules that import
// nothing: buildings.js runs every building, defence and upgrade cost through withBuildmat once, power.js its generator
// tiers and reloading.js the reloading bench's upgrade; every check and payment of such a cost goes through siteCost.
//
// - Building materials (data.js buildmat: lumber, blocks, nails and fixings): every build takes some, one for each
//   BUILDMAT_SHARE.per scrap's worth of what it cost (scrapWorth: parts and electronics 4 scrap each, 40 wood a scrap),
//   at least one and at most BUILDMAT_SHARE.max, the scrap they stand for taken off its scrap (3 a building material,
//   down to none). A cost with building materials of its own already keeps them (the shed, the warehouse, the step ups).
// - Metal sheets (data.js metalsheet): the roofed, steel-clad and reinforced builds take `sheets` of them as well
//   (buildings.js SHEETS), 5 scrap off for each.
// - Made on site: what the stores lack of either, the builders make there from scrap (SITE_MAKE: a building material
//   3 scrap and 3 work-hours, as crafting.js buildmat; a metal sheet 5 scrap and 4 work-hours, a scrap more than the
//   workshop's crafting.js metalsheet), the work-hours added to the job. So a base with the scrap still builds what it
//   did (the governor and the AI groups too), and scavenged or crafted building materials and sheets save it the scrap
//   and the hours.

export const SITE_MAKE = { buildmat: { scrap: 3, hours: 3 }, metalsheet: { scrap: 5, hours: 4 } };
export const BUILDMAT_SHARE = { per: 12, max: 10 };
export const MADE_KEYS = Object.keys(SITE_MAKE);

/** A cost's worth in scrap (the share's yardstick). @param {Record<string, number>} cost */
export const scrapWorth = (cost) => (cost.scrap || 0) + 4 * (cost.parts || 0) + 4 * (cost.electronics || 0) + (cost.wood || 0) / 40;

/** A build's cost with its building materials (and `sheets` metal sheets), the scrap they stand for taken off.
 * @param {Record<string, number>} cost @param {number} [sheets] @returns {Record<string, number>} */
export function withBuildmat(cost, sheets = 0) {
  const out = { ...cost };
  const bm = cost.buildmat > 0 ? 0 : Math.max(1, Math.min(BUILDMAT_SHARE.max, Math.round(scrapWorth(cost) / BUILDMAT_SHARE.per)));
  if (bm) out.buildmat = bm;
  if (sheets > 0) out.metalsheet = (cost.metalsheet || 0) + sheets;
  if (out.scrap) {
    out.scrap = Math.max(0, out.scrap - bm * SITE_MAKE.buildmat.scrap - sheets * SITE_MAKE.metalsheet.scrap);
    if (!out.scrap) delete out.scrap;
  }
  return out;
}

/** What paying a cost from a stock takes: the stores' own building materials and sheets first, the rest made on site
 * from scrap. take: what comes out of the stock (its scrap raised by what is made), made: { key: n } made on site,
 * hours: the work-hours that adds.
 * @param {Record<string, number>} stock @param {Record<string, number>} cost */
export function siteCost(stock, cost) {
  /** @type {Record<string, number>} */
  const take = { ...cost };
  /** @type {Record<string, number>} */
  const made = {};
  let hours = 0, extra = 0;
  for (const k of MADE_KEYS) {
    const need = cost[k] || 0;
    if (!(need > 0)) continue;
    const have = Math.max(0, Math.floor(stock[k] || 0));
    const short = Math.max(0, need - have);
    if (!short) continue;
    made[k] = short;
    if (need - short > 0) take[k] = need - short; else delete take[k];
    extra += short * SITE_MAKE[k].scrap;
    hours += short * SITE_MAKE[k].hours;
  }
  if (extra) take.scrap = (take.scrap || 0) + extra;
  return { take, made, hours, extra };
}

/** What a stock lacks to pay a cost (building materials and sheets made on site from its scrap): "" when it has it,
 * else "Needs N <word>" (the scrap first when what is made is what it lacks).
 * @param {Record<string, number>} stock @param {Record<string, number>} cost @param {(k: string) => string} word */
export function siteShort(stock, cost, word) {
  const { take, made, extra } = siteCost(stock, cost);
  for (const [k, v] of Object.entries(take)) {
    if ((stock[k] || 0) >= v) continue;
    if (k === "scrap" && extra) return `Needs ${v} scrap (${extra} of it for the ${madeText(made)} made on site)`;
    return `Needs ${v} ${word(k)}`;
  }
  return "";
}

/** Pays a cost from a stock (siteShort first): returns { paid, made, hours }. @param {Record<string, number>} stock @param {Record<string, number>} cost */
export function payCost(stock, cost) {
  const c = siteCost(stock, cost);
  for (const [k, v] of Object.entries(c.take)) stock[k] = (stock[k] || 0) - v;
  return { paid: c.take, made: c.made, hours: c.hours };
}

/** "2 building materials and a metal sheet" @param {Record<string, number>} made */
export function madeText(made) {
  const bits = [];
  if (made.buildmat > 0) bits.push(`${made.buildmat} building material${made.buildmat === 1 ? "" : "s"}`);
  if (made.metalsheet > 0) bits.push(made.metalsheet === 1 ? "metal sheet" : `${made.metalsheet} metal sheets`);
  return bits.join(" and ");
}
