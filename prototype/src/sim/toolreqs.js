// @ts-check
// Tools as prerequisites (data-tools.js has the items, the kinds, what each build and recipe needs, and the loot
// tables): what tools a base or a team has, what a job is missing, the wear on the makeshift ones, and where tools turn
// up (their own tables and dice, rolled last, so every find from before them comes out as it did).
//   at a base   its armory and what the people there carry (anyone out on a trip or a team took theirs along)
//   a team      what its people carry and its cargo (a field craft)
// Checked when a job is queued (buildings.js canBuild / canBuildPiece / canBuildWall and the upgrades, crafting.js
// canCraft / fieldCraftOptions): a tool that leaves afterwards does not stop the job. Nothing is used up; a makeshift
// tool (GEAR toolWear) that is the only one of its kind for a job loses a use when the job is queued (wearTools).
// AI groups build and craft by their own coarse rules (groupworks.js, arsenal.js) and need no tools.
import { GEAR } from "./data.js";
import { atBase, residents } from "./world.js";
import { hash01 } from "./skills.js";
import { allCarried, lootItem, newItem } from "./inventory.js";
import { siteSource, areaSource, traderSource } from "./itemcond.js";
import { TOOL_KINDS, TOOL_MAKESHIFT, BUILD_TOOLS, WALL_TOOLS, CRAFT_TOOLS, TOOL_FINDS, AREA_TOOLS, CAR_TOOLS, WARE_TOOLS } from "./data-tools.js";
import { wearHeld } from "./crafting.js"; // call-time only (crafting.js reads this module)
export { TOOL_KINDS, BUILD_TOOLS, WALL_TOOLS, CRAFT_TOOLS, TOOL_FINDS, AREA_TOOLS, CAR_TOOLS, WARE_TOOLS };

// ---------- what is at hand ----------
/** Everything a base has to work with: its armory and its people's things. @param {any} state @param {any} base */
export function baseToolItems(state, base) {
  return [...(base.armory || []), ...atBase(state, base.id).flatMap((s) => allCarried(s))].filter(Boolean);
}
/** A team's: its people's things and the cargo. @param {any} party @param {any[]} members */
export const partyToolItems = (party, members) => [...members.flatMap((s) => allCarried(s)), ...((party && party.cargo && party.cargo.gear) || [])].filter(Boolean);

const kindRank = (kind, key) => TOOL_KINDS[kind].items.indexOf(key);
// The item that covers a kind among these: the first by the kind's order, a real tool before one that wears.
/** @param {any[]} items @param {string} kind */
export function toolFor(items, kind) {
  let best = null, bestRank = Infinity;
  for (const it of items) {
    const r = kindRank(kind, it.key);
    if (r < 0 || (it.dur != null && it.dur <= 0)) continue;
    const rank = r + (GEAR[it.key] && GEAR[it.key].toolWear ? 100 : 0);
    if (rank < bestRank) { best = it; bestRank = rank; }
  }
  return best;
}
/** The kinds none of these items cover. @param {any[]} items @param {string[]} kinds */
export const toolsMissing = (items, kinds = []) => kinds.filter((k) => TOOL_KINDS[k] && !toolFor(items, k));
/** Does an item count as a tool for building and crafting? @param {any} item */
export const isBuildTool = (item) => !!item && Object.keys(TOOL_KINDS).some((k) => kindRank(k, item.key) >= 0);
/** The kinds an item covers ("hammer", "saw"…). @param {string} key */
export const kindsOf = (key) => Object.keys(TOOL_KINDS).filter((k) => kindRank(k, key) >= 0);

// ---------- words ----------
const and = (list) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
/** "a hammer and a saw". @param {string[]} kinds */
export const toolsText = (kinds) => and(kinds.map((k) => TOOL_KINDS[k].name));
/** "a hammer (tool kit, claw hammer or makeshift hammer)". @param {string} kind */
export const kindHelp = (kind) => `${TOOL_KINDS[kind].name} (${TOOL_KINDS[kind].items.map((k) => (GEAR[k] ? GEAR[k].name.toLowerCase() : k)).join(", ").replace(/, ([^,]*)$/, " or $1")})`;
/** The reason a job cannot be queued for its tools ("" when it has them). @param {string[]} missing @param {string} where */
export const missingText = (missing, where = "in the base's armory or on someone here") => (missing.length ? `Needs ${toolsText(missing)} ${where}` : "");

// ---------- the checks ----------
/** What a build needs (a wall piece, a gate or the Ring wall by its material: WALL_TOOLS by WALL_TIERS key). @param {string} type @param {string | null} [mat] */
export const buildTools = (type, mat = null) => (mat && WALL_TOOLS[mat] && type !== "stand1" && type !== "stand2" && type !== "stand4" ? WALL_TOOLS[mat] : BUILD_TOOLS[type] || []);
/** What a recipe needs. @param {string} key */
export const craftTools = (key) => CRAFT_TOOLS[key] || [];
/** Why a build cannot be queued here for want of tools ("" when it can). @param {any} state @param {any} base @param {string} type @param {string | null} [mat] */
export const buildToolProblem = (state, base, type, mat = null) => (buildTools(type, mat).length ? missingText(toolsMissing(baseToolItems(state, base), buildTools(type, mat))) : "");
/** Why a recipe cannot be queued here for want of tools. @param {any} state @param {any} base @param {string} key */
export const craftToolProblem = (state, base, key) => (craftTools(key).length ? missingText(toolsMissing(baseToolItems(state, base), craftTools(key))) : "");

// A job queued: each makeshift tool that is the one covering a kind it needs loses a use (a broken one is gone).
/** @param {any} state @param {string[]} kinds @param {any[]} items @param {any[]} people @param {any[][]} lists */
export function wearTools(state, kinds, items, people, lists) {
  const seen = new Set();
  for (const k of kinds) {
    const it = toolFor(items, k);
    if (!it || seen.has(it) || !(GEAR[it.key] && GEAR[it.key].toolWear)) continue;
    seen.add(it);
    wearHeld(state, it, people, lists);
  }
}
/** @param {any} state @param {any} base @param {string[]} kinds */
export const wearBaseTools = (state, base, kinds) => kinds.length && wearTools(state, kinds, baseToolItems(state, base), atBase(state, base.id), [base.armory || []]);

// The basic kit the governor keeps at a base it runs (autopilot.js planCrafts): a makeshift tool crafted for a basic kind
// nothing of the base's covers, unless one is queued. Its own people's things count wherever they are (a woodcutter out
// with the hatchet, a team it sent out with the shovel as a weapon: they bring them back). Returns the recipe, or null.
export const BASIC_KINDS = ["hammer", "saw", "dig", "axe"];
/** @param {any} state @param {any} base */
export function basicToolWanted(state, base) {
  const teams = (state.parties || []).filter((p) => p.owner === "player" && p.homeBaseId === base.id);
  const out = teams.flatMap((p) => partyToolItems(p, (p.members || []).map((id) => state.survivors.find((s) => s.id === id)).filter(Boolean)));
  const items = [...(base.armory || []), ...residents(state, base.id).flatMap((s) => allCarried(s)), ...out].filter(Boolean);
  const q = base.crafting || [];
  for (const k of BASIC_KINDS) {
    const key = TOOL_MAKESHIFT[k];
    if (!toolFor(items, k) && !q.some((j) => j.recipe === key)) return { kind: k, recipe: key };
  }
  return null;
}
/** Is a craft job one of those basic tools (made first, and staffed first: autopilot.js planCrafts, planRoles)? @param {any} job */
export const isBasicToolJob = (job) => !!job && BASIC_KINDS.some((k) => TOOL_MAKESHIFT[k] === job.recipe);

// A save from before the tools (save.js, once): the main hub gets the tool shelf a new hub starts with (world.js
// HUB_TOOLS), each one it has nothing of that kind for, so its builds do not stop the day it loads. Hardcore: nothing.
/** @param {any} state @param {string[]} shelf */
export function migrateTools(state, shelf) {
  if (state.mode === "hardcore") return;
  const base = (state.bases || []).find((b) => b.type === "hub");
  if (!base) return;
  base.armory = base.armory || [];
  const items = baseToolItems(state, base);
  for (const k of shelf) if (!kindsOf(k).every((kind) => toolFor(items, kind))) base.armory.push(newItem(k, 1));
}

// ---------- where they turn up ----------
function pick(items, u) {
  let total = 0;
  for (const w of Object.values(items)) total += w;
  let r = u * total;
  for (const [k, w] of Object.entries(items)) { r -= w; if (r < 0) return k; }
  return Object.keys(items).pop() || null;
}
// One search hour's roll at a site (loot.js rollAnyModFind, last).
/** @param {any} state @param {number} tileId */
export function rollToolFind(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? TOOL_FINDS[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "toolfind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pick(site.items, hash01(state.seed, "toolpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(t.loc.type), hash01(state.seed, "tooldur", tileId, state.hour, salt)) : null;
}
// One raid container's roll (combat.js, after the tent bag): the area's table, and a car's trunk its own (CAR_TOOLS).
/** @param {any} state @param {number} tileId @param {string} areaType @param {string} boxKind */
export function rollAreaTool(state, tileId, areaType, boxKind, salt = "") {
  const a = boxKind === "car" ? CAR_TOOLS : AREA_TOOLS[areaType];
  if (!a || hash01(state.seed, "areatool", tileId, salt) >= a.p) return null;
  const key = pick(a.items, hash01(state.seed, "areatoolpick", tileId, salt));
  const t = state.tiles[tileId];
  return key ? lootItem(key, areaSource(areaType, t && t.loc ? t.loc.type : null), hash01(state.seed, "areatooldur", tileId, salt)) : null;
}
// A trader's or merchant's table (loot.js gunmodWares).
/** @param {any} state @param {string} type @param {string} name */
export function toolWares(state, type, name, salt = "") {
  const w = WARE_TOOLS[type];
  if (!w || hash01(state.seed, "toolware", name, salt) >= w.p) return [];
  const key = pick(w.items, hash01(state.seed, "toolwarepick", name, salt));
  return key ? [lootItem(key, traderSource(type), hash01(state.seed, "toolwareq", name, salt))] : [];
}
