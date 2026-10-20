// Test helpers for physical rounds (docs/adr/0001-ai-parity.md: a gun holds the rounds put in it, loadMag never makes
// more). fillGun(u, n): the unit's gun holds n rounds of its load (default full), as a reload from a full pocket would
// leave it; a unit that is not stacked (the dead, an old unit) is loaded the old way.
import { loadMag } from "../src/sim/combat.js";
import { calOf } from "../src/sim/ammo.js";
import { keyFor, typeFor } from "../src/sim/rounds.js";

export function fillGun(u, n = null) {
  loadMag(u);
  const cal = calOf(u && u.weapon);
  if (cal && Array.isArray(u.stack)) {
    const want = n == null ? u.magMax : Math.max(0, Math.min(u.magMax, n));
    u.stack = want > 0 ? [{ k: keyFor(cal, typeFor(cal, u.load)), n: want }] : [];
  }
  loadMag(u, n);
  return u;
}
