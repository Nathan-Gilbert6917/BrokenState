// The small kit a team takes along from the base armory (the autopilot's trips; autopilot.js launchTrip): camp kit
// against Heat (fieldheat.js), something for morale (comforts.js) and a few throwables (stealth.js, throwables.js).
// Each kind once, into free pockets and pack slots only (nothing goes in the cargo), at most KIT_KG kg a person, so
// the trip's load and pace barely change. What is not used comes home with them.
import { GEAR } from "./data.js";
import { stow } from "./inventory.js";
import { packLights } from "./lights.js";

export const KIT_KG = 1.5;
// In order of preference: Heat first on a search trip, then morale, then the throwables.
const SEARCH_KIT = ["scentmask", "ragboots", "woodghillie", "ghillie", "tripwire", "stove", "camonet"]; // woodghillie: crafted once the Bushcraft Field Guide is read (blueprints.js)
const MORALE_KIT = ["harmonica", "cards"];
const FIGHT_KIT = ["molotov", "pipebomb", "smokegren", "flare", "firecracker", "bottle"];
// Optics (optics.js): a survey or recon takes the best the base has; other trips a pair of binoculars if there is one.
const SCOUT_KIT = ["thermal", "binoculars", "spotscope", "monocular"];
const TRIP_OPTICS = ["binoculars", "monocular"];
const OPTICS_KG = 2.5; // extra kg a survey or recon may take for its optics

// Moves kit from base.armory onto the crew for a mission. Returns the names of what went along.
export function packTripKit(state, base, crew, mission) {
  if (!base || !crew.length) return [];
  const looting = ["scavenge", "recon", "investigate", "recover", "getvehicle", "hive", "rescue"].includes(mission);
  const scouting = mission === "sweep" || mission === "recon";
  const want = [...(scouting ? SCOUT_KIT : []), ...(looting ? SEARCH_KIT : ["tripwire", "stove"]), ...MORALE_KIT, ...(mission === "trade" ? [] : FIGHT_KIT), ...(scouting || mission === "trade" ? [] : TRIP_OPTICS)];
  const budget = crew.length * KIT_KG + (scouting ? OPTICS_KG : 0);
  let kg = 0;
  const out = [];
  const taken = new Set();
  // A light each first (lights.js: the lightest that works for them), outside the kit's weight budget.
  out.push(...packLights(base, crew));
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

// Siege kit for an Assault (parties.js launchExpedition; siege.js uses it on the battle map, conquest.js by the
// numbers): from the base armory into the team's cargo, as much as the team can carry on top of what it packed
// (load.js weighs it): the battering ram with 3+ people, a ladder per 3 people (at most 2), a grenade each (frag
// grenades first, then pipe bombs; at most 4). room: kg the crew can still carry. Returns the names of what went.
export const SIEGE_PACK = { RAM_CREW: 3, LADDER_PER: 3, LADDERS: 2, GRENADES: 4 };
export function packSiegeKit(base, cargo, crew, room) {
  if (!base || !base.armory || !cargo) return [];
  const out = [];
  const take = (key) => {
    const i = base.armory.findIndex((it) => it && it.key === key);
    if (i < 0) return false;
    const w = GEAR[key].weight || 1;
    if (w > room) return false;
    room -= w;
    const it = base.armory.splice(i, 1)[0];
    cargo.gear.push(it);
    out.push(it.name);
    return true;
  };
  const n = crew.length;
  if (n >= SIEGE_PACK.RAM_CREW && !cargo.gear.some((it) => it && it.key === "ram")) take("ram");
  for (let i = cargo.gear.filter((it) => it && it.key === "ladder").length; i < Math.min(SIEGE_PACK.LADDERS, Math.floor(n / SIEGE_PACK.LADDER_PER)); i++) if (!take("ladder")) break;
  for (let i = 0; i < Math.min(SIEGE_PACK.GRENADES, n); i++) if (!take("frag") && !take("pipebomb")) break;
  return out;
}

function hasOn(s, key) {
  const g = s.gear || {};
  if (Object.values(g).some((it) => it && it.key === key)) return true;
  if ((s.pockets || []).some((it) => it && it.key === key)) return true;
  return !!(g.backpack && g.backpack.contents && g.backpack.contents.some((it) => it && it.key === key));
}
