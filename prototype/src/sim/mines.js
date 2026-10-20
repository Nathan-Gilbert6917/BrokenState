// Land mines (the user's request of 2026-10-19: "add land mines as a hub defense"): a Minefield on the main base's
// Defenses tab (buildings.js minefield: the main hub only, Mechanics 4, MINES.PER mines a field, up to two fields).
//
//   By the numbers (defences.js): a horde that attacks sets some off on the way in: each mine takes MINES.KILL of the
//   dead (minesKill), the mines spent (spendMines; a field with none left is gone, like the spike pits). A raid by the
//   numbers (factions.js) sets off MINES.RAID of them and loses a raider or two to them. While mines are left the field
//   adds to the wall tier against raids (defences.js TIERS.WALL.mines).
//   On the battle map (fort.js, interior.js, deploy.js layMines): the mines left are buried in the open ground the
//   attackers cross (c.mine on an open cell; never in the lanes to the gates, never by the wall's foot), hidden from
//   them. Your people know where they are (drawn for you, ui/isoview.js) and step round them; anyone else who steps on
//   one (raiders, outsiders, the dead) sets it off (mineStep, from combat.js moveAlong): a blast (MINES.BLAST, as a pipe
//   bomb's) on the cell, the move over. When the fight ends the base keeps the mines that did not go off
//   (settleMines, from combat.js closeCombat).
import { landEffect } from "./throwables.js"; // call-time only: the modules load in a circle
import { baseById } from "./world.js";

export const MINES = {
  PER: 12, KILL: 2, RAID: 2, RAID_DEAD: [0, 2],
  BLAST: { r: 1.5, dmg: [24, 38], impact: [40, 60], wake: 14, noise: 4, struct: [30, 50], kind: "blast" },
};
const fields = (base) => (base && base.buildings ? base.buildings.filter((b) => b.type === "minefield" && !b.broken) : []);
// Mines left at a base: every field's (a field from before the count: a full one).
export const minesLeft = (base) => fields(base).reduce((a, b) => a + (b.mines ?? MINES.PER), 0);
// Of a horde of n, how many the mines take on the way in.
export const minesKill = (base, n) => Math.min(n, minesLeft(base) * MINES.KILL);
// n mines gone off: taken from the fields in turn; a field with none left is cleared away (rebuild it).
export function spendMines(base, n) {
  let left = Math.max(0, Math.round(n));
  for (const f of fields(base)) {
    if (left <= 0) break;
    const have = f.mines ?? MINES.PER, use = Math.min(have, left);
    f.mines = have - use;
    left -= use;
  }
  base.buildings = base.buildings.filter((b) => b.type !== "minefield" || b.broken || (b.mines ?? MINES.PER) > 0);
}

// Lays the base's mines on a battle map: n of them on the cells cand gives ([x, y] open cells the attackers cross),
// picked by the battle's dice. Marks the battle so the fight's end gives the base back what is left.
export function layMines(b, base, cells, cand, rng, W) {
  const n = minesLeft(base);
  if (!n) return 0;
  const pool = cand.slice();
  let laid = 0;
  for (let i = 0; i < n && pool.length; i++) {
    const [x, y] = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    const c = cells[y * W + x];
    if (!c || c.k !== "open" || c.mine) { i--; continue; }
    c.mine = true;
    laid++;
  }
  if (b) b.mines = { baseId: base.id, laid };
  return laid;
}

// Someone steps onto a cell (combat.js moveAlong). Returns true when a mine went off under them (their move is over).
// Yours know the minefield and step round it: never set off by your side.
export function mineStep(b, u, x, y, h) {
  const c = b.cells[y * b.w + x];
  if (!c || !c.mine || u.side === "player") return false;
  delete c.mine;
  c.crater = true;
  h.say(b, `${u.name} steps on a mine!`, u.side === "enemy" ? "good" : "danger");
  const text = landEffect(b, u, { fx: "blast", blast: MINES.BLAST }, x, y);
  if (text) h.say(b, text, "info");
  return true;
}
// The fight is over (combat.js closeCombat): the base's fields keep the mines still in the ground.
export function settleMines(state, b) {
  if (!b || !b.mines) return;
  const base = baseById(state, b.mines.baseId);
  const left = b.cells.reduce((a, c) => a + (c.mine ? 1 : 0), 0);
  if (base) spendMines(base, Math.max(0, minesLeft(base) - left));
  delete b.mines;
}
// A raid by the numbers (factions.js resolveRaidOnPlayer): MINES.RAID go off under them, MINES.RAID_DEAD of theirs killed.
// Returns { used, dead } (nothing without mines).
export function raidMines(state, base) {
  const n = Math.min(MINES.RAID, minesLeft(base));
  if (!n) return { used: 0, dead: 0 };
  spendMines(base, n);
  return { used: n, dead: state.rng.int(MINES.RAID_DEAD[0], MINES.RAID_DEAD[1]) };
}
