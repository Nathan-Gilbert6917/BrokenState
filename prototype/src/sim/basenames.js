// @ts-check
// Naming your bases. A base you found (the staging camp becoming your shelter, Build outpost, one you take in an
// assault, one a group hands over) gets a name from parties.js outpostName and is queued here: the UI asks for a
// name (ui/basename.js), the suggestion filled in. Any base can be renamed later. On autopilot nobody is asked: the
// suggested name stays. Other groups' bases are named by their own code (factions.js) and never asked about.
//   askBaseName(state, base)     queue the naming popup for a base just founded (state.nameAsk: base ids)
//   pendingName(state)           the first base still waiting for a name (null: none)
//   nameDone(state, id)          drop it from the queue (named, or the suggestion kept)
//   renameBase(state, base, raw) clean and check a name, set it; returns the reason it was refused, or ""
//   nameSuggestions(state, base) a few names to pick from (the first: the suggested one)
import { log } from "./world.js";
import { outpostName } from "./parties.js";

export const NAME_MAX = 40;

/** @param {any} state */
const queue = (state) => (Array.isArray(state.nameAsk) ? state.nameAsk : (state.nameAsk = []));

/** @param {any} state @param {any} base */
export function askBaseName(state, base) {
  if (!base || state.autopilot) return;
  const q = queue(state);
  if (!q.includes(base.id)) q.push(base.id);
}
/** @param {any} state */
export function pendingName(state) {
  if (!Array.isArray(state.nameAsk) || !state.nameAsk.length) return null;
  // A base lost or gone before it was named: forget it.
  state.nameAsk = state.nameAsk.filter((id) => state.bases.some((b) => b.id === id));
  const id = state.nameAsk[0];
  return id == null ? null : state.bases.find((b) => b.id === id) || null;
}
/** @param {any} state @param {number} id */
export function nameDone(state, id) {
  if (Array.isArray(state.nameAsk)) state.nameAsk = state.nameAsk.filter((x) => x !== id);
}

/** @param {any} raw */
export const cleanName = (raw) => String(raw ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().replace(/\s+/g, " ").slice(0, NAME_MAX);

/** Why this name cannot be used for this base ("" when it can). @param {any} state @param {any} base @param {string} name */
export function nameProblem(state, base, name) {
  if (!name) return "Give it a name.";
  const lower = name.toLowerCase();
  if (state.bases.some((x) => x !== base && String(x.name).toLowerCase() === lower)) return `Another of your bases is already called ${name}.`;
  return "";
}

/** Sets the name; the founding card still waiting to be read follows it. @param {any} state @param {any} base @param {any} raw */
export function renameBase(state, base, raw) {
  const name = cleanName(raw);
  const why = nameProblem(state, base, name);
  if (why || name === base.name) return why;
  const old = base.name;
  base.name = name;
  for (const c of state.cards || []) {
    if (typeof c.title === "string") c.title = c.title.split(old).join(name);
    if (typeof c.text === "string") c.text = c.text.split(old).join(name);
  }
  log(state, `${old} is now called ${name}.`, "info");
  return "";
}

// A few names for this spot: the suggested one, then plain ones by what the base is and where it stands.
const KINDS = { hub: ["Haven", "Hold", "Refuge", "Homestead", "Stronghold"], outpost: ["Outpost", "Post", "Lookout", "Camp", "Station"] };
/** @param {any} state @param {any} base */
export function nameSuggestions(state, base) {
  const out = [];
  const add = (n) => { const c = cleanName(n); if (c && !out.includes(c) && !nameProblem(state, base, c)) out.push(c); };
  add(base.name);
  if (base.type !== "hub") add(outpostName(state, base.tile)); // "North of Dunmore Outpost": an outpost's name, not a hub's
  const t = state.tiles[base.tile] || {};
  const place = t.loc && t.loc.name ? String(t.loc.name).replace(/\s+(Outpost|Barricade)$/i, "") : null;
  const words = KINDS[base.type === "hub" ? "hub" : "outpost"];
  const start = base.tile % words.length; // no random numbers: the same spot gives the same ideas
  for (let i = 0; i < words.length && out.length < 5; i++) {
    const w = words[(start + i) % words.length];
    add(place ? `${place} ${w}` : `The ${w}`);
  }
  return out.slice(0, 5);
}
