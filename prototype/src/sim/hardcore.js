// Hardcore mode: the run starts on the day the State of Calder falls, not 6–12 months later.
// - You: 1–4 survivors (the new-run screen's Starting people, START_PEOPLE; 3 by default) on the road with whatever they grabbed as they fled, very low supplies and no hub; the first base
//   you found becomes the hub (hardcore-start.js).
// - The outbreak: 1–2 hives at the start, infection 0% away from the outbreak areas, spreading through the first year
//   (mostly in towns and cities) until the state looks like a normal game's start (hardcore-outbreak.js).
// - The other groups: bands of survivors who must found their hubs too, with more to start with depending on what they
//   will become; the military sends a strike force against the first hive (in a city) that fails and is cut off,
//   while a hive rises by its thinned base and overruns it, and what is left splits into groups of their own; no
//   raiders at first (hardcore-groups.js).
// - The loot: the buildings are only half picked over (twice a normal start's loot), the surplus wearing off by the
//   normal start (hardcore-loot.js). More people are on the move in the first weeks (wanderers.js).
// Everything here only runs when state.mode === "hardcore"; a normal game never touches it.
import { setupHardcoreStart, hardcoreStartDaily } from "./hardcore-start.js";
import { setupHardcoreGroups, hardcoreGroupsDaily, hardcoreGroupsHour, hardcoreGroupsAfterOutbreak } from "./hardcore-groups.js";
import { setupHardcoreOutbreak, hardcoreOutbreakDaily } from "./hardcore-outbreak.js";
import { setupHardcoreLoot, hardcoreLootDaily } from "./hardcore-loot.js";
import { CUSTOM_RUN } from "./custommode.js"; // Custom mode: a normal start with the counts set (not a state.mode of its own)

export const MODES = {
  normal: { label: "Normal", tip: "6–12 months after the outbreak: you start with a hub, six survivors (one to eight: Starting people) and supplies" },
  hardcore: { label: "Hardcore", tip: "The day Calder falls: one to four survivors (three by default) on the road with what they grabbed, no hub, and the outbreak just starting" },
  // Custom (2026-10-24, user request): the new-run screen's mode only; the run is a normal one with state.custom (custommode.js).
  custom: { label: "Custom", tip: "A normal start (a hub, 6–12 months after the outbreak) with the counts you set: starting survivors, AI groups, starting hives, cities, towns and military sites, each 1 or more" },
};

// Starting people (the new-run screen): how many flee together on day 1 (Hardcore, START_PEOPLE), or how many hold the
// hub (a normal start, NORMAL_PEOPLE: six by default, up to eight; 2026-10-19, user request), MIN–MAX, DEF by default.
// createWorld's startPeople and state.startPeople (saved with the game). Each mode keeps its own count on the screen.
export const START_PEOPLE = { MIN: 1, MAX: 4, DEF: 3 };
export const NORMAL_PEOPLE = { MIN: 1, MAX: 8, DEF: 6 };
// Custom mode (custommode.js CUSTOM_RUN.people): 1–30 at the hub.
export const peopleRange = (mode) => (mode === "hardcore" ? START_PEOPLE : mode === "custom" ? CUSTOM_RUN.people : NORMAL_PEOPLE);
export function clampStartPeople(v, mode = "hardcore") {
  const R = peopleRange(mode);
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(R.MIN, Math.min(R.MAX, n)) : R.DEF;
}

export const isHardcore = (state) => !!state && state.mode === "hardcore";

// createWorld (world.js), in place of the normal hub, crew and groups. Your start first, so the groups can be placed
// relative to where you are (hardcore-groups.js keeps them a fair distance away).
// startPeople: how many flee together (START_PEOPLE; clamped, 3 when left out).
export function hardcoreCreate(state, { factionCount, crew, crewRoll = null, startPeople = START_PEOPLE.DEF, start = null }) {
  state.startPeople = clampStartPeople(startPeople);
  setupHardcoreStart(state, crew, crewRoll, state.startPeople, start);
  setupHardcoreGroups(state, factionCount);
}

// createWorld, after mapgen's hives exist (hives.js ensureHives): trim them to the first outbreak and reset infection.
export function hardcoreAfterHives(state) {
  setupHardcoreOutbreak(state);
  hardcoreGroupsAfterOutbreak(state); // the raiders' day, from the outbreak's era offset
  setupHardcoreLoot(state); // hardcore-loot.js: the buildings are only half picked over (twice a normal start's loot)
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
  hardcoreLootDaily(state); // hardcore-loot.js: the surplus loot wears off toward a normal start's
}
