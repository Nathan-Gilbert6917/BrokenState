// The groups' outcomes as one hash, to prove a refactor of the groups' tuning changes nothing (run it before and after on
// the same seeds: the hashes must match). For each seed a world (normal, then hardcore) plays N days on the Balanced
// autopilot, and the digest takes every group's whole record (people, wounded, stock, bases, works, arsenal, vehicles,
// knowledge, jails, wars), the diplomacy and blocs, the hordes, the wanderers and every log line, with ids written as
// their offset from the world's first id (world.js newId is process-wide) and numbers rounded to 3 decimals.
// Usage: node tools/groupdigest.js [days] [seeds...]   (prints one hash a world, then "digest <hash of all>")
import { createWorld, tickHour, day, newId } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { digest, normalizeIds, roundAll } from "./digest.js";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const days = Number(args[0] || 120);
const seeds = args.length > 1 ? args.slice(1).map(Number) : [42, 7];
const ID_STEP = 1e6;
const hashOf = (s) => createHash("sha1").update(s).digest("hex");

// Everything of a group but the caches and functions (JSON drops those); sets and maps written as arrays.
const plain = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v instanceof Set ? [...v] : v instanceof Map ? [...v.entries()] : v)));

function run(seed, mode) {
  let id0 = newId();
  while (id0 % ID_STEP) id0 = newId();
  const st = createWorld({ seed, factionCount: 8, mode });
  st.started = true;
  setAutopilot(st, true, "balanced");
  const lines = st.log.slice().reverse().map((l) => `${l.hour} ${l.text}`);
  const unshift = st.log.unshift;
  st.log.unshift = function (...x) { for (const l of x) lines.push(`${l.hour} ${l.text}`); return unshift.apply(this, x); };
  while (day(st) <= days && !st.gameOver) tickHour(st);
  const id1 = newId();
  const groups = normalizeIds(roundAll(plain({ factions: st.factions, diplo: st.diplo || null, blocs: st.blocs || null, hordes: st.hordes, wanderers: st.wanderers || null, pwars: st.pwars || null })), id0, id1);
  return hashOf(digest({ st, lines, id0, id1 }) + groups);
}

const all = [];
for (const seed of seeds) for (const mode of ["normal", "hardcore"]) {
  const t = Date.now();
  const hsh = run(seed, mode);
  all.push(hsh);
  console.log(`seed ${seed} ${mode} ${days} days: ${hsh} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
}
console.log(`digest ${hashOf(all.join(","))}`);
