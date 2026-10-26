// @ts-check
// Hotel variants (issue #38 of the interiors epic #7, the user's requests 2026-10-25: "every building should have several
// varients"; "for buildings with no to only a few varients create a dozen varients per building type"): a dozen plans
// for each hotel kind (an inn, a business hotel, a resort, a city tower), each a plan of its own (hotellayout.js PLANS
// lays them out), each with the name the POI and the raid show.
//
// A variant: id, kind, name, w (its weight by the setting: city, suburb, town, scenic; 1 where unset), size (its own
// footprint within its kind's REAL_SIZE row: w, d, storeys, [min, max]; the kind's row where unset). A chain (data-shops.js
// FRANCHISES.hotel plan.variants) lists the variants that fit it; the dice, the chain and the setting pick one
// (hotelVariantFor); boxK: its rooms' containers × this (buildingmaps.js spec.boxScale: its loot a floor cell
// near its kind's). "classic" is #29's plan of the kind, as it was: a hotel with a chain and no variant (one made before
// the variants) keeps it.
//
// No imports: pois.js (the POI's name), hotels.js, citycrawl.js and hotellayout.js all read it.

/** @typedef {{ id: string, kind: string, name: string, w?: Record<string, number>, size?: { w?: number[], d?: number[], storeys?: number[] }, boxK?: number }} HotelVariant */
/** @type {HotelVariant[]} */
export const HOTEL_VARIANTS = [
  // ---------- the inn (21–25 × 19, 2–3 storeys) ----------
  { id: "inn-country", kind: "inn", name: "Roadside country inn" }, // #29's inn
  { id: "inn-bnb", kind: "inn", name: "Victorian B&B", w: { town: 1.4, suburb: 1.2 }, size: { w: [21, 23], storeys: [3, 3] } },
  { id: "inn-coaching", kind: "inn", name: "Coaching inn with a tavern", size: { w: [23, 25], storeys: [3, 3] } },
  { id: "inn-chalet", kind: "inn", name: "Ski chalet", w: { suburb: 0.3 }, size: { storeys: [3, 3] }, boxK: 0.92 },
  { id: "inn-lakeside", kind: "inn", name: "Lakeside lodge", w: { suburb: 0.4 }, size: { w: [23, 25], storeys: [3, 3] }, boxK: 0.9 },
  { id: "inn-mainstreet", kind: "inn", name: "Historic main-street hotel", w: { town: 1.5 }, size: { w: [23, 25], storeys: [3, 3] } },
  { id: "inn-vineyard", kind: "inn", name: "Vineyard inn", w: { suburb: 0.5 }, size: { w: [23, 25], storeys: [3, 3] } },
  { id: "inn-boarding", kind: "inn", name: "Boarding house", w: { town: 1.2, suburb: 1.3 }, size: { w: [21, 23], storeys: [3, 3] } },
  { id: "inn-fishing", kind: "inn", name: "Fishing lodge", w: { suburb: 0.3 }, size: { w: [23, 25], storeys: [3, 3] }, boxK: 0.82 },
  { id: "inn-hunting", kind: "inn", name: "Hunting lodge", w: { suburb: 0.3 }, size: { w: [23, 25], storeys: [3, 3] }, boxK: 0.7 },
  { id: "inn-seaside", kind: "inn", name: "Seaside guest house", size: { w: [21, 23], storeys: [3, 3] } },
  { id: "inn-hotspring", kind: "inn", name: "Hot-springs inn", w: { suburb: 0.4 }, size: { w: [23, 25], storeys: [3, 3] } },
  // ---------- the business hotel (40–60 × 21–23, 4–6 storeys) ----------
  { id: "biz-classic", kind: "business", name: "Business hotel" }, // #29's business hotel
  { id: "biz-airport", kind: "business", name: "Airport hotel", w: { suburb: 1.5, town: 0.5 }, size: { w: [44, 52], storeys: [4, 5] }, boxK: 0.86 },
  { id: "biz-conference", kind: "business", name: "Conference hotel", w: { city: 1.4, town: 0.5 }, size: { w: [52, 60], storeys: [5, 6] }, boxK: 1.3 },
  { id: "biz-extended", kind: "business", name: "Extended-stay hotel", size: { w: [40, 48], storeys: [4, 4] } },
  { id: "biz-allsuites", kind: "business", name: "All-suites atrium hotel", w: { city: 1.3 }, size: { w: [48, 58], storeys: [4, 6] } },
  { id: "biz-budget", kind: "business", name: "Budget business box", w: { suburb: 1.3, town: 1.3 }, size: { w: [40, 44], storeys: [4, 4] } },
  { id: "biz-boutique", kind: "business", name: "Downtown boutique hotel", w: { city: 2, suburb: 0.3, town: 0.4 }, size: { w: [40, 42], storeys: [5, 6] } },
  { id: "biz-convention", kind: "business", name: "Convention-centre hotel", w: { city: 1.5, suburb: 0.5, town: 0.2 }, size: { w: [56, 60], storeys: [6, 6] } },
  { id: "biz-highway", kind: "business", name: "Highway inn & suites", w: { city: 0.3, suburb: 1.3, town: 1.5 }, size: { w: [42, 50], storeys: [4, 5] }, boxK: 0.88 },
  { id: "biz-medical", kind: "business", name: "Medical-centre hotel", size: { w: [44, 52], storeys: [4, 5] }, boxK: 0.86 },
  { id: "biz-campus", kind: "business", name: "University inn", w: { town: 1.3 }, size: { w: [44, 50], storeys: [4, 5] }, boxK: 0.92 },
  { id: "biz-station", kind: "business", name: "Railway hotel", w: { city: 1.3, suburb: 0.4 }, size: { w: [46, 56], storeys: [4, 6] } },
  // ---------- the resort (64–90 × 21–23, 2–4 storeys) ----------
  { id: "res-classic", kind: "resort", name: "Grand resort" }, // #29's resort
  { id: "res-golf", kind: "resort", name: "Golf resort", size: { w: [72, 90] } },
  { id: "res-beach", kind: "resort", name: "Beach resort with pool wings", size: { w: [76, 90], storeys: [3, 4] } },
  { id: "res-casino", kind: "resort", name: "Casino resort", w: { suburb: 2, town: 1.5 }, size: { w: [76, 90], storeys: [3, 4] } },
  { id: "res-spa", kind: "resort", name: "Spa resort", size: { w: [68, 84], storeys: [2, 3] }, boxK: 1.08 },
  { id: "res-mountain", kind: "resort", name: "Mountain resort", size: { w: [68, 86], storeys: [3, 4] } },
  { id: "res-waterpark", kind: "resort", name: "Waterpark resort", w: { suburb: 2, town: 1.5 }, size: { w: [76, 90], storeys: [3, 4] } },
  { id: "res-ranch", kind: "resort", name: "Dude ranch", w: { suburb: 0 }, size: { w: [64, 74], storeys: [2, 2] } },
  { id: "res-cabins", kind: "resort", name: "Lakeside resort with cabins", size: { w: [70, 86], storeys: [2, 2] }, boxK: 0.92 },
  { id: "res-family", kind: "resort", name: "Family resort", size: { w: [72, 90], storeys: [3, 4] } },
  { id: "res-wellness", kind: "resort", name: "Wellness retreat", w: { suburb: 0.5 }, size: { w: [64, 76], storeys: [2, 3] }, boxK: 1.12 },
  { id: "res-wedding", kind: "resort", name: "Wedding and event resort", size: { w: [70, 86], storeys: [2, 3] }, boxK: 1.08 },
  // ---------- the city tower (36–44 × 21–23, 8–10 storeys) ----------
  { id: "tow-classic", kind: "tower", name: "Slab tower" }, // #29's tower
  { id: "tow-twin", kind: "tower", name: "Twin towers", size: { w: [42, 44] }, boxK: 1.25 },
  { id: "tow-podium", kind: "tower", name: "Podium tower over shops", size: { w: [38, 44] } },
  { id: "tow-atrium", kind: "tower", name: "Atrium tower", size: { w: [38, 44] } },
  { id: "tow-grand", kind: "tower", name: "1920s grand hotel", size: { w: [38, 44], storeys: [8, 9] } },
  { id: "tow-core", kind: "tower", name: "Round tower", size: { w: [40, 44] }, boxK: 1.15 },
  { id: "tow-mixed", kind: "tower", name: "Mixed-use tower with flats above", size: { storeys: [9, 10] }, boxK: 1.08 },
  { id: "tow-capsule", kind: "tower", name: "Capsule tower", size: { w: [36, 40] } },
  { id: "tow-casino", kind: "tower", name: "Casino tower", size: { w: [40, 44] } },
  { id: "tow-convention", kind: "tower", name: "Convention tower", size: { w: [40, 44], storeys: [9, 10] } },
  { id: "tow-deco", kind: "tower", name: "Art-deco boutique tower", size: { w: [36, 38], storeys: [8, 9] }, boxK: 1.07 },
  { id: "tow-skylobby", kind: "tower", name: "Sky-lobby tower", size: { w: [38, 44], storeys: [9, 10] } },
];
export const CLASSIC = { inn: "inn-country", business: "biz-classic", resort: "res-classic", tower: "tow-classic" };

const BY_ID = new Map(HOTEL_VARIANTS.map((v) => [v.id, v]));
/** @param {string | null | undefined} id */
export const hotelVariantById = (id) => (id ? BY_ID.get(id) || null : null);
/** @param {string} kind */
export const hotelVariantsOf = (kind) => HOTEL_VARIANTS.filter((v) => v.kind === kind);
/** The variant's name ("Victorian B&B"), "" for none. @param {string | null | undefined} id */
export const hotelVariantName = (id) => { const v = hotelVariantById(id); return v ? v.name : ""; };

/**
 * A hotel's variant by the dice (r, 0–1), its chain's list (ids: the chain's plan.variants; null: every variant of the
 * kind) and the setting ("city", "suburb", "town", "scenic"; null: none). Returns its id.
 * @param {string} kind @param {string[] | null | undefined} ids @param {string | null | undefined} setting @param {number} r
 */
export function hotelVariantFor(kind, ids, setting, r) {
  let list = (ids && ids.length ? ids.map(hotelVariantById).filter(Boolean) : hotelVariantsOf(kind)).filter((v) => v && v.kind === kind);
  if (!list.length) list = hotelVariantsOf(kind);
  const wt = (v) => (setting && v.w && v.w[setting] != null ? v.w[setting] : 1);
  const tot = list.reduce((a, v) => a + wt(v), 0);
  if (!(tot > 0)) return list[Math.floor(r * list.length) % list.length].id;
  let x = r * tot;
  for (const v of list) { x -= wt(v); if (x < 0) return v.id; }
  return list[list.length - 1].id;
}
