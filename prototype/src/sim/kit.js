// The small kit a team takes along from the base armory (the autopilot's trips; autopilot.js launchTrip): camp kit
// against Heat (fieldheat.js), something for morale (comforts.js) and a few throwables (stealth.js, throwables.js).
// Each kind once, into free pockets and pack slots only (nothing goes in the cargo), at most KIT_KG kg a person, so
// the trip's load and pace barely change. What is not used comes home with them.
import { GEAR } from "./data.js";
import { stow } from "./inventory.js";

export const KIT_KG = 1.5;
// In order of preference: Heat first on a search trip, then morale, then the throwables.
const SEARCH_KIT = ["scentmask", "ragboots", "ghillie", "tripwire", "stove", "camonet"];
const MORALE_KIT = ["harmonica", "cards"];
const FIGHT_KIT = ["molotov", "pipebomb", "smokegren", "flare", "firecracker", "bottle"];

// Moves kit from base.armory onto the crew for a mission. Returns the names of what went along.
export function packTripKit(state, base, crew, mission) {
  if (!base || !crew.length) return [];
  const looting = ["scavenge", "recon", "investigate", "recover", "getvehicle", "hive", "rescue"].includes(mission);
  const want = [...(looting ? SEARCH_KIT : ["tripwire", "stove"]), ...MORALE_KIT, ...(mission === "trade" ? [] : FIGHT_KIT)];
  const budget = crew.length * KIT_KG;
  let kg = 0;
  const out = [];
  const taken = new Set();
  for (const key of want) {
    if (taken.has(key) || crew.some((s) => hasOn(s, key))) continue;
    const i = base.armory.findIndex((it) => it && it.key === key);
    if (i < 0) continue;
    const it = base.armory[i];
    const w = GEAR[key].weight || 1;
    if (kg + w > budget) continue;
    const who = crew.find((s) => stow(s, it));
    if (!who) continue;
    base.armory.splice(i, 1);
    taken.add(key);
    kg += w;
    out.push(it.name);
  }
  return out;
}

function hasOn(s, key) {
  const g = s.gear || {};
  if (Object.values(g).some((it) => it && it.key === key)) return true;
  if ((s.pockets || []).some((it) => it && it.key === key)) return true;
  return !!(g.backpack && g.backpack.contents && g.backpack.contents.some((it) => it && it.key === key));
}
