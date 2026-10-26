// @ts-check
// The loot share and the Heat clock of a golf course's, a campground's or an RV park's map (issue #61, outdoors.js), on
// their own so combat.js can read them without outdoors.js's imports (the scene registry is still loading then).
import { raidLootShare, raidHeatRate } from "./battlesize.js";

export const PATCH = [48, 34]; // an outdoor container's loot share: an ordinary raid map's (the old Extra-large)
// What a container holds, as a share of the usual (combat.js raidLootShare): a building's its own map's (the building
// and a margin round it), an RV's, a tent's or a cart's an ordinary raid map's.
/** @param {any} b @param {any} bx */
export function outdoorLootShare(b, bx) {
  const P = b.raid && b.raid.plan;
  const h = P && P.houses && bx && bx.house != null ? P.houses.find((q) => q.k === bx.house) : null;
  return h ? raidLootShare(h.w + 10, h.h + 10) : raidLootShare(PATCH[0], PATCH[1]);
}
// The area Heat's clock reads (combat.js raidHeatRate on these dims): the buildings your people searched in or stand in,
// and a patch round each outdoor container they opened; not the map's.
/** @param {any} b */
export function outdoorHeatRate(b) {
  const R = b.raid, P = R && R.plan;
  if (!P || !P.outdoors) return raidHeatRate(b.w, b.h);
  const ks = new Set();
  let out = 0;
  for (const c of R.containers) if (c.searched) { if (c.house != null) ks.add(c.house); else out++; }
  for (const u of b.units) if (u.side === "player" && !u.dead) { const h = P.houses.find((q) => u.x >= q.x0 && u.x < q.x0 + q.w && u.y >= q.y0 && u.y < q.y0 + q.h); if (h) ks.add(h.k); }
  const a = P.houses.filter((h) => ks.has(h.k)).reduce((s, h) => s + (h.w + 10) * (h.h + 10), 0) + out * 15 * 15;
  return raidHeatRate(Math.max(40 * 30, a), 1);
}
