// @ts-check
// How much of a supply stack fits where it would go, asked before a move (the stack mover, ui/stackmove.js). The
// moves themselves stay where they were: sim/raidloot.js raidMove / supplyFit (a raid's containers, people and
// vehicle), sim/inventory.js takeSupply (the bodies after a battle). Generic: nothing here is about who owns the
// team (AI parity: any team's room is counted the same way, parties.js cargoRoom).
import { SUPPLIES } from "./data.js";
import { battleBodies, storageFor, battlePlace } from "./inventory.js";
import { cargoRoom, unitsThatFit } from "./parties.js";

// A body's supply stack after a battle (takeSupply's rules): { have, n (what fits now), where (words), err }. Into a
// team's found cargo it is the team's room by weight; into a base's stores all of it.
/** @param {any} state @param {number} bi @param {string} key */
export function lootFit(state, bi, key) {
  const body = battleBodies(state)[bi];
  const have = body ? Math.floor(Math.max(0, (body.supplies && body.supplies[key]) || 0)) : 0;
  const st = /** @type {any} */ (state.combat ? storageFor(state, battlePlace(state.combat)) : null);
  if (!have || !SUPPLIES[key]) return { have: 0, n: 0, where: "", err: "Nothing there." };
  if (!st) return { have, n: 0, where: "", err: "There is nowhere to put it here." };
  if (st.o !== "cargo") return { have, n: have, where: "stores", err: "" };
  const n = Math.min(have, unitsThatFit(cargoRoom(state, st.party), key));
  return { have, n, where: "cargo", err: n ? "" : `No room in the team's cargo for ${SUPPLIES[key].name.toLowerCase()}.` };
}
