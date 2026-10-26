// @ts-check
// One field for every plan's id and name (issue #40 of the round-2 epic #39; the user's request 2026-10-26: "Uniform
// plans to store plan names"). A building type with a dozen named plans (its variants: buildvariants.js, shopvariants.js,
// civicvariants.js, industrylayout.js, milplans.js, prison.js, hotellayout.js, officeplans.js, bunkerlayout.js,
// campusplans.js, librarylayout.js, eaterylayout.js, mall.js, buildingmaps.js SCHOOL_VARIANTS) puts its pick on the
// spec the same way:
//   spec.vid    the plan's stable id, unique within its type ("ranch", "cold-storage-warehouse", "county/hall")
//   spec.vname  the name the game shows ("Ranch house", "Cold-storage warehouse")
// and the assembled map carries them as map.vid / map.vname (map.plan.vid / map.plan.vname too). Every reader (the POI's
// name, buildingmaps.js buildingOptions, citycrawl.js placeHint, the raid's opening line, the gallery, the tests) goes
// through planId / planName below, never a module's own field.
//
// Older fields, read here only (a save, a cached spec or another ticket's code from before #40 may still carry them):
//   spec.variant (a name: #27's offices, #26's bunkers, #28's campus types) with spec.variantId (#28's id);
//   spec.layout { id, name } (#35's shops); plan.variant (assemble's old copy of the name; still written as an alias).
// A spec with none of them has no named plan: planId and planName return null.
// buildingmaps.js re-exports planId and planName (the issue's home for them); this module is a leaf so the plan makers
// can stamp ids without importing buildingmaps.js.

/** A plan's id from its name, where its table has none (#27's office plans, #26's bunkers): "Brutalist office block" → "brutalist-office-block". @param {string} name */
export const planSlug = (name) => String(name).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** The plan's id (spec.vid; older: spec.variantId, spec.layout.id, a slug of spec.variant), or null. @param {any} spec @returns {string | null} */
export function planId(spec) {
  if (!spec) return null;
  if (spec.vid != null) return String(spec.vid);
  if (spec.variantId != null) return String(spec.variantId);
  if (spec.layout && typeof spec.layout === "object" && spec.layout.id != null) return String(spec.layout.id);
  if (typeof spec.variant === "string" && spec.variant) return planSlug(spec.variant);
  return null;
}

/** The plan's display name (spec.vname; older: spec.layout.name, spec.variant as a name), or null. @param {any} spec @returns {string | null} */
export function planName(spec) {
  if (!spec) return null;
  if (spec.vname) return spec.vname;
  if (spec.layout && typeof spec.layout === "object" && spec.layout.name) return spec.layout.name;
  if (typeof spec.variant === "string" && spec.variant) return spec.variant;
  return null;
}

/** The spec with vid and vname set from its plan (in place; returns it): a maker's stamp. @template T @param {T} spec @param {string} id @param {string} name @returns {T} */
export function stampPlan(spec, id, name) {
  const s = /** @type {any} */ (spec);
  if (s) { s.vid = id; s.vname = name; }
  return spec;
}
