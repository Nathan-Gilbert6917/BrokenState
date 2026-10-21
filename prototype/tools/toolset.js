// A test helper: a base stocked with a tool for every kind a build or a recipe can need (src/sim/toolreqs.js), for
// tests about something else that build or craft at a base made by hand (a bare outpost, a camp, a hub stripped).
// Usage: import { stockTools } from "./toolset.js"; stockTools(base);
import { newItem } from "../src/sim/inventory.js";
import { TOOL_KINDS } from "../src/sim/data-tools.js";

// One real tool a kind (the first of each kind's list), none twice: a tool kit, a felling axe, a shovel, a power drill,
// a welding kit, a sewing kit.
export const FULL_SET = [...new Set(Object.values(TOOL_KINDS).map((k) => k.items[0]))];
export function stockTools(base, keys = FULL_SET) {
  base.armory = base.armory || [];
  for (const k of keys) if (!base.armory.some((it) => it && it.key === k)) base.armory.push(newItem(k, 1));
  return base;
}
