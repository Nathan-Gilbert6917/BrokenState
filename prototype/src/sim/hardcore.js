// The road start (Normal and Hardcore since issue #79, 2026-10-27: roadstart.js isRoadStart; Hardcore's hard rules are
// hardrules.js): the run starts on the day the State of Calder falls, not 6–12 months later (the hub start, kept for Custom
// and Crashlanding, world.js). Normal: 1–8 survivors (NORMAL_PEOPLE, four by default); Hardcore: 1–4 (three).
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
// Everything here runs on a road start (roadstart.js isRoadStart: Normal and Hardcore since issue #79); a hub start (Custom,
// Crashlanding) never touches it. state.hardcore keeps its old name. Hardcore's own hard rules: hardrules.js.
import { setupHardcoreStart, hardcoreStartDaily } from "./hardcore-start.js";
import { setupHardcoreGroups, hardcoreGroupsDaily, hardcoreGroupsHour, hardcoreGroupsAfterOutbreak } from "./hardcore-groups.js";
import { setupHardcoreOutbreak, hardcoreOutbreakDaily } from "./hardcore-outbreak.js";
import { setupHardcoreLoot, hardcoreLootDaily } from "./hardcore-loot.js";
import { CUSTOM_RUN } from "./custommode.js"; // Custom mode: a normal start with the counts set (not a state.mode of its own)
import { CRASH_PEOPLE, CRASH } from "./crashmode.js"; // Crashlanding: a normal-mode world with state.crash (not a state.mode of its own)

export const MODES = {
  // Normal and Hardcore both open on the road (issue #79, the user's requests 2026-10-27; roadstart.js); Hardcore adds the hard rules (hardrules.js).
  normal: { label: "Normal", tip: "The day Calder falls: one to eight survivors (four by default) on the road with what they grabbed, a car and tents, no hub: set up a camp to found your first base, as the outbreak starts" },
  hardcore: { label: "Hardcore", tip: "Normal's road start made hard: one to four survivors (three by default), always Ironman, a car on fumes, scarce ammo, meds and fuel, hungrier people and faster wear, slow healing, raiders from the first days, a threat that grows with you, no forecast or threat estimates, no auto-answered cards and no Keep playing after an ending" },
  // Custom (2026-10-24, user request): the new-run screen's mode only; the run is a normal one with state.custom (custommode.js).
  custom: { label: "Custom", tip: "A normal start (a hub, 6–12 months after the outbreak) with the counts you set: starting survivors, AI groups, starting hives, cities, towns and military sites, each 1 or more" },
  // Crashlanding (2026-10-24, user request): the screen's mode only; the run is a normal one with state.crash (crashmode.js).
  // The map is shown, not set (2026-10-24, the user: "just show how many exist on the map all things are just static values").
  crash: { label: "Crashlanding", tip: `Three years after Calder fell: the sole survivor of a Guard helicopter shot down on a ${CRASH.W} × ${CRASH.H} map, no base, no vehicle, a broken radio and a fixed military kit (traits, skills and look are yours to set; the kit, the map and what is on it are not: the groups, hives, cities and sites are the map's own, shown, not set). Your unit's base is on the far side of the map` },
};

// Starting people (the new-run screen): how many flee together on day 1 (Hardcore, START_PEOPLE), or how many hold the
// hub (a normal start, NORMAL_PEOPLE: six by default, up to eight; 2026-10-19, user request), MIN–MAX, DEF by default.
// createWorld's startPeople and state.startPeople (saved with the game). Each mode keeps its own count on the screen.
export const START_PEOPLE = { MIN: 1, MAX: 4, DEF: 3 };
// Normal (issue #79, 2026-10-27): the same road start as Hardcore with more of you, 1–8, four by default. HUB_PEOPLE: a hub start's count (Custom's
// own is CUSTOM_RUN.people; a headless tool's default), 1–8, six.
export const NORMAL_PEOPLE = { MIN: 1, MAX: 8, DEF: 4 };
export const HUB_PEOPLE = { MIN: 1, MAX: 8, DEF: 6 };
// Custom mode (custommode.js CUSTOM_RUN.people): 1–30 at the hub. Crashlanding (crashmode.js CRASH_PEOPLE): the one survivor.
export const peopleRange = (mode) => (mode === "hardcore" ? START_PEOPLE : mode === "custom" ? CUSTOM_RUN.people : mode === "crash" ? CRASH_PEOPLE : mode === "hub" ? HUB_PEOPLE : NORMAL_PEOPLE);
export function clampStartPeople(v, mode = "hardcore") {
  const R = peopleRange(mode);
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(R.MIN, Math.min(R.MAX, n)) : R.DEF;
}

export { isHardcore, isRoadStart } from "./roadstart.js";
import { isRoadStart, isHardcore } from "./roadstart.js";
import { HARD } from "./hardrules.js";

// createWorld (world.js), in place of the normal hub, crew and groups. Your start first, so the groups can be placed
// relative to where you are (hardcore-groups.js keeps them a fair distance away).
// startPeople: how many flee together (START_PEOPLE; clamped, 3 when left out).
export function hardcoreCreate(state, { factionCount, crew, crewRoll = null, startPeople = null, start = null }) {
  const kind = state.mode === "hardcore" ? "hardcore" : "normal"; // Hardcore 1–4 (3), Normal 1–8 (4)
  state.startPeople = clampStartPeople(startPeople ?? peopleRange(kind).DEF, kind);
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
  if (!isRoadStart(state)) return;
  hardcoreGroupsHour(state);
}

// Hardcore (hardrules.js GOODWILL_DAILY): every group's goodwill drifts down a little a day, to a floor of -40 (a gift or a pact lifts it again).
function hardGoodwillDaily(state) {
  const drift = (g) => { if (g && Number.isFinite(g.goodwill) && g.goodwill > -40) g.goodwill = Math.max(-40, g.goodwill + HARD.GOODWILL_DAILY); };
  for (const f of state.factions || []) if (f.type !== "military") drift(f);
  for (const b of (state.hardcore && state.hardcore.groups && state.hardcore.groups.bands) || []) drift(b);
}

// world.js tickHour, once a day.
export function hardcoreDaily(state) {
  if (!isRoadStart(state)) return;
  hardcoreOutbreakDaily(state);
  hardcoreGroupsDaily(state);
  hardcoreStartDaily(state);
  hardcoreLootDaily(state); // hardcore-loot.js: the surplus loot wears off toward a normal start's
  if (isHardcore(state)) hardGoodwillDaily(state); // hardrules.js: the groups cool toward you
}
