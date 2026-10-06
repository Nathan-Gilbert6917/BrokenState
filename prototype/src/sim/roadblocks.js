// Road blockages: a car (or a team on bikes) driving a road now and then reaches a stretch it cannot take at speed:
// stalled cars, a fallen tree, debris, a pile-up, a washed-out dip. Nothing to decide: the team works its way
// through and loses the time (a delay on its progress, as a road card's delay is), and the log says so. The map shows
// "Road blocked" over the team while it is held up (ui/render.js). The fully blocked highway, with its choices, is
// still a road card (events.js "blocked").
//
// Its own dice (hash01 of the world's seed, the team, the tile and the hour), so the rest of a run draws the same
// numbers whether or not a blockage comes up.
import { log, localId } from "./world.js";
import { hash01 } from "./skills.js";

export const ROADBLOCK = {
  CHANCE: 0.06,   // a road tile entered by a car or bikes
  BIKE: 0.4,      // bikes are lifted over or round most of it: this share of the time
  KINDS: [
    { key: "stalled", w: 5, mins: [30, 60],   text: "weaves through a line of stalled cars" },
    { key: "debris",  w: 3, mins: [15, 45],   text: "picks its way through debris strewn over the road" },
    { key: "tree",    w: 3, mins: [60, 120],  text: "drags a fallen tree off the road" },
    { key: "pileup",  w: 2, mins: [90, 180],  text: "noses through a pile-up, pushing wrecks aside" },
    { key: "washout", w: 1, mins: [30, 90],   text: "inches across a washed-out dip in the road" },
  ],
};

// The blockage a vehicle meets entering `tile` by road this hour, or null. { key, mins, text }
export function rollRoadblock(state, p, tile) {
  if (state.noRoadblocks) return null; // test switch (tools/loadtest.js: the exact bike-trip ETA)
  const roll = (k) => hash01(state.seed, "roadblock", localId(state, p.id), tile, state.hour, k);
  if (roll("hit") >= ROADBLOCK.CHANCE) return null;
  const total = ROADBLOCK.KINDS.reduce((a, k) => a + k.w, 0);
  let r = roll("kind") * total, kind = ROADBLOCK.KINDS[ROADBLOCK.KINDS.length - 1];
  for (const k of ROADBLOCK.KINDS) { if ((r -= k.w) < 0) { kind = k; break; } }
  let mins = kind.mins[0] + Math.round(roll("mins") * (kind.mins[1] - kind.mins[0]) / 5) * 5;
  if (p.vehicle === "bike") mins = Math.max(5, Math.round((mins * ROADBLOCK.BIKE) / 5) * 5);
  return { key: kind.key, mins, text: kind.text };
}

// A team entering a road tile in a vehicle: rolls a blockage and, if there is one, holds the team up.
// speed: the team's pace (parties.js partySpeed): the delay is in real hours whatever the pace (events.js delay).
// name / where: the team's name and the tile's label for the log. Returns the blockage or null.
export function roadblockOnEnter(state, p, tile, speed, name, where) {
  if (!p.vehicle) return null;
  const b = rollRoadblock(state, p, tile);
  if (!b) return null;
  p.progress -= (b.mins / 60) * speed;
  p.roadblock = { key: b.key, tile, hour: state.hour, mins: b.mins };
  const t = b.mins >= 60 ? `${Math.floor(b.mins / 60)} h${b.mins % 60 ? ` ${b.mins % 60} min` : ""}` : `${b.mins} min`;
  log(state, `Road blocked near ${where}: ${name} ${b.text} (${t} lost).`, "info");
  return b;
}

// Whether the map should show the team held up by a blockage right now (it is still paying the delay off).
export const heldUp = (state, p) => !!p.roadblock && (p.progress || 0) < 0 && state.hour - p.roadblock.hour <= 4;
