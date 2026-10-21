// Where meds are found, and how rare they are: the user's rule "meds should be semi rare to find unless hospital /
// pharmacy". Every number here; the tables they shape live with their systems:
// - The hour-by-hour search (scavenge.js searchHour, crews' searches too): a site's loot table (data.js LOCATIONS
//   loot) picks what an hour turns up. At a pharmacy, a clinic, a hospital or a medevac wreck (SITES) a meds find is
//   the full roll (4–9 × what is left); anywhere else it is a bottle or a box from a bathroom cabinet: SEARCH_SCALE of
//   the roll, 1 to SEARCH_MAX at a time. The ordinary places' meds weights in LOCATIONS are low too (a few % of
//   the hours). Groups' scavengers (aiscav.js haulFor) bring home the same share (haulMult): their meds weight is cut
//   the same way, and the share it loses goes to the site's other goods (a haul finds as much, less of it meds).
// - A raid (combat.js AREAS loot per area, AREA_SETS per site): pharmacy and clinic areas are full of meds; houses,
//   stores, offices, cabins, chapels, locker rooms a small chance of 1; a school nurse, a fire station's first-aid
//   room and a barracks' medical store ("nurse") a little more. A town's, a city centre's and a mall's street maps
//   have no pharmacy area (their Pharmacy building, buildingmaps.js, is a pharmacy). Locked things (locks.js
//   LOCK_LOOT): a drug cabinet is full, a lockbox or a safe now and then holds 1–2.
// - Bodies: one of the dead 5% (inventory.js ZBODY), a person BODY_HUMAN (combat.js searchBox, inventory.js
//   enemyBody), a dead soldier 8% (deadsoldiers.js), always 1.
// - Made: a med station (2 scrap + 1 food → 1 meds a day), boiled-rag dressings (crafting.js), herbs (foraging.js,
//   skills.js Herbalist). Traded: SUPPLIES.meds.value (data.js) sets what they cost.
// Meds are spent only on need (FIELD_CARE below, medical.js, health.js): a wound, an infection, an illness, a downed
// fighter in battle; never a flat daily drain.
export const MEDS = {
  SITES: ["pharmacy", "clinic", "hospital", "crash_med", "vet"], // vet: a veterinary clinic (data-shops.js)
  SEARCH_SCALE: 0.25, SEARCH_MAX: 2,
  BODY_HUMAN: 0.1,
};
// A team in the field (medical.js fieldCareDaily, once a day): a member whose wound is below `below` health or
// infected is patched up from the team's own meds (fieldTreat: 1 meds, +1 to clean an infection).
export const FIELD_CARE = { below: 40 };

export const medSite = (t) => !!(t && t.loc && MEDS.SITES.includes(t.loc.type));
// An hour's meds find at a tile, from the full roll qty: the full roll at a medical site, else 1 to SEARCH_MAX.
export const searchMeds = (t, qty) => (medSite(t) ? qty : Math.max(1, Math.min(MEDS.SEARCH_MAX, Math.round(qty * MEDS.SEARCH_SCALE))));
// × the meds weight of a site's table for a group's scavengers (aiscav.js haulFor: expected amounts, no dice; the
// weight it loses goes to the site's other goods).
export const haulMult = (t) => (medSite(t) ? 1 : MEDS.SEARCH_SCALE);
