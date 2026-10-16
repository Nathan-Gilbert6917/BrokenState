// @ts-check
// Where you start, rolled again on the same map (the new-run screen's New start position, 2026-10-16, user request).
// world.js createWorld picks the hub's town, hardcore-start.js spawnTile the roadside tile; both from lists of
// candidates in order of preference (the first that has any is used). The world's die is always cast and kept out of
// it, so the map, the hives and every later draw follow the seed as before; with a start of its own
// ({ roll, not }), dice of their own pick the tile instead, away from `not` (the one on screen) when there is anywhere
// else to go, widening to the next list if the first offers nowhere new.
import { Rng } from "./rng.js";

/**
 * @template {{ id: number }} T
 * @param {Rng} rng the world's dice
 * @param {Array<() => T[]>} lists candidates, best first (worked out only when needed)
 * @param {{ roll: number, not?: number | null } | null} [start]
 * @returns {T}
 */
export function pickStart(rng, lists, start = null) {
  const seen = [];
  const get = (i) => (seen[i] ??= lists[i]());
  let rolled = null;
  for (let i = 0; i < lists.length && !rolled; i++) if (get(i).length) rolled = rng.pick(get(i));
  if (!start || start.roll == null) return rolled;
  const own = new Rng(start.roll);
  for (let i = 0; i < lists.length; i++) {
    const others = get(i).filter((t) => t.id !== start.not);
    if (others.length) return own.pick(others);
  }
  return rolled;
}
