// Hardcore mode: the run starts on the day the State of Calder falls, not 6–12 months later.
// - You: 3 survivors on the road with whatever they grabbed as they fled, very low supplies and no hub; the first base
//   you found becomes the hub (hardcore-start.js).
// - The outbreak: 1–2 hives at the start, infection 0% away from the outbreak areas, spreading through the first year
//   (mostly in towns and cities) until the state looks like a normal game's start (hardcore-outbreak.js).
// - The other groups: bands of survivors who must found their hubs too, with more to start with depending on what they
//   will become; the military sends a strike force against the first hive (in a city) that fails and is cut off,
//   while a hive rises by its thinned base and overruns it, and what is left splits into groups of their own; no
//   raiders at first (hardcore-groups.js).
// Everything here only runs when state.mode === "hardcore"; a normal game never touches it.
import { setupHardcoreStart, hardcoreStartDaily } from "./hardcore-start.js";
import { setupHardcoreGroups, hardcoreGroupsDaily, hardcoreGroupsHour, hardcoreGroupsAfterOutbreak } from "./hardcore-groups.js";
import { setupHardcoreOutbreak, hardcoreOutbreakDaily } from "./hardcore-outbreak.js";

export const MODES = {
  normal: { label: "Normal", tip: "6–12 months after the outbreak: you start with a hub, six survivors and supplies" },
  hardcore: { label: "Hardcore", tip: "The day Calder falls: three survivors on the road with what they grabbed, no hub, and the outbreak just starting" },
};

export const isHardcore = (state) => !!state && state.mode === "hardcore";

// createWorld (world.js), in place of the normal hub, crew and groups. Your start first, so the groups can be placed
// relative to where you are (hardcore-groups.js keeps them a fair distance away).
export function hardcoreCreate(state, { factionCount, crew }) {
  setupHardcoreStart(state, crew);
  setupHardcoreGroups(state, factionCount);
}

// createWorld, after mapgen's hives exist (hives.js ensureHives): trim them to the first outbreak and reset infection.
export function hardcoreAfterHives(state) {
  setupHardcoreOutbreak(state);
  hardcoreGroupsAfterOutbreak(state); // the raiders' day, from the outbreak's era offset
}

// world.js tickHour, every hour (after the parties, hordes and outsiders move): the bands on the road.
export function hardcoreHour(state) {
  if (!isHardcore(state)) return;
  hardcoreGroupsHour(state);
}

// world.js tickHour, once a day.
export function hardcoreDaily(state) {
  if (!isHardcore(state)) return;
  hardcoreOutbreakDaily(state);
  hardcoreGroupsDaily(state);
  hardcoreStartDaily(state);
}
