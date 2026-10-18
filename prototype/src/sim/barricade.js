// Barricades on the battle maps (the user's request of 2026-10-18): furniture shoved in the way, doors and windows
// boarded up with wood and nails, and the dead crawling over half cover.
//
//   Shoving furniture (SHOVE, FURNITURE, shoveable, canShove, shoveTargets, shoveDests, shoveAct; combatAct "shove")
//     A person with their arms free, standing right next to a piece (not diagonally), moves it one tile for both
//     actions: pushed to any free open cell next to the piece, or pulled onto their own cell while they step back a
//     cell (the pull). What can be shoved: the raid maps' shelves, cabinets, counters, tables, beds, crates, lockers,
//     tall shelving, barrels, hay bales and sandbags (FURNITURE); never a car, a gun safe, a wall. A raid's container
//     goes with its piece (b.raid.containers keep their cell). A shoved piece gets hit points (FURNITURE[k].hp) so the
//     dead can batter it when it stands in their way (combat.js siegeTarget, bash: at 0 it is rubble). The scrape is
//     a little noise (SHOVE.NOISE on the raid's noise) and the unaware within SHOVE.RADIUS turn toward it.
//   Crawling over half cover (CRAWL, crawls, crawlable, overCost; combat.js reachable, distField, moveAlong)
//     One of the dead (any walker of one cell; a Climber goes over walls its own way, a 2 × 2 boss never fits) crawls
//     over the same half cover a person vaults (a fence, crates, a table, a shoved shelf; never a closed window: it
//     clambers through an open or broken one at the vault's cost as before) at CRAWL.COST tiles over the step, more
//     than a person's VAULT.COST: a walker (3 tiles an action) spends its whole turn getting over a table. It never
//     stops on it. Human enemies vault as people do (combat.js VAULT). Full cover (tall shelving, lockers, a wall) is
//     never crawled: the dead batter a shoved piece of it or go round.
//   Boarding up (BOARD, boardsOf, boardTargets, boardAct, tearTargets, tearAct, breakBoarded; combatAct "boardup",
//   "teardown")
//     A bundle of boards and nails (data.js GEAR.boards, crafted from firewood and a scrap: crafting.js CRAFTS.boards)
//     nailed over a door (closed, barred or broken in), a doorway or a window (closed, open, broken) from either side
//     for both actions: the cell becomes "boarded" (CELL: a wall for sight and movement, full cover) with hit points
//     (BOARD.HP a layer, up to BOARD.MAX layers, on top of a closed door's own) that the dead and the human enemy
//     batter through on the siege field (distField bashA, siegeTarget, bash → breakCell → breakBoarded: a boarded
//     window ends broken, a boarded door broken in). Hammering is loud: BOARD.NOISE on the raid's noise, Heat
//     +BOARD.HEAT, the unaware within BOARD.RADIUS wake. Tearing the boards down again (teardown) takes both actions
//     from either side, is quieter, and gives the door or window back as it was (shut); the boards are spent.
import { CELL, unitAt, active, canVault, vaultable, clambers, VAULT, vaultCost, refitKit } from "./combat.js"; // call-time only: the modules load in a circle
import { windowOpen, smashWindow } from "./windows.js";
import { doorBroken } from "./buildingmaps.js";
import { survivorById } from "./world.js";
import { carriedSpots } from "./inventory.js";
import { cartBoxes } from "./carts.js"; // a cart is not furniture: never shoved, nothing shoved onto it (call-time only)

export const SHOVE = { AP: 2, NOISE: 1, RADIUS: 3 };
export const CRAWL = { COST: 4 };
export const BOARD = { AP: 2, HP: 40, MAX: 3, NOISE: 1.5, HEAT: 3, RADIUS: 6, TEAR: { ap: 2, noise: 0.5, radius: 3 } };
// What can be shoved, and the hit points a shoved piece gets (the dead batter it: combat.js bash, SIEGE).
export const FURNITURE = {
  shelf: { hp: 25 }, cabinet: { hp: 25 }, counter: { hp: 30 }, table: { hp: 15 }, bed: { hp: 20 }, crate: { hp: 20 },
  rack: { hp: 35 }, locker: { hp: 40 }, barrel: { hp: 15 }, hay: { hp: 15 }, sandbag: { hp: 20 },
};
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIR_WORD = { "1,0": "east", "-1,0": "west", "0,1": "south", "0,-1": "north" };
const cellOf = (b, x, y) => (x < 0 || y < 0 || x >= b.w || y >= b.h ? null : b.cells[y * b.w + x]);
const faceAt = (u, x, y) => { u.face = [Math.sign(x - u.x), Math.sign(y - u.y)]; };
const first = (u) => String(u.name || "").split(" ")[0];
const burning = (b, x, y) => !!(b.fires && b.fires.some((f) => f.x === x && f.y === y));

// ---------- shoving ----------
export const shoveable = (c) => !!c && !!FURNITURE[c.k] && !c.car;
export const canShove = (u) => canVault(u); // on their feet, arms free, not the dead, not carrying or dragging anyone
export const pieceName = (c) => (c && CELL[c.k] ? CELL[c.k].name.toLowerCase() : "furniture");
// The pieces right next to the unit (not diagonally): [{ x, y, c }].
export function shoveTargets(b, u) {
  const out = [];
  if (!u) return out;
  for (const [dx, dy] of NEXT4) {
    const x = u.x + dx, y = u.y + dy, c = cellOf(b, x, y);
    if (shoveable(c)) out.push({ x, y, c });
  }
  return out;
}
// A free open cell a piece can be shoved onto: open ground or floor with nobody on it, not burning.
const destOk = (b, x, y) => { const c = cellOf(b, x, y); return !!c && c.k === "open" && !unitAt(b, x, y) && !burning(b, x, y) && !cartBoxes(b).some((o) => o.x === x && o.y === y && (o.f || 0) === (b.floor || 0)); }; // carts.js: nothing shoved onto a cart
// Where the piece at (px, py) can go from where the unit stands: [{ x, y, pull, back, word }]. A push: any free cell
// next to the piece. The pull: onto the unit's own cell, the unit stepping back to the free cell behind them.
export function shoveDests(b, u, px, py) {
  const out = [];
  if (!u || Math.abs(u.x - px) + Math.abs(u.y - py) !== 1) return out;
  for (const [dx, dy] of NEXT4) {
    const x = px + dx, y = py + dy;
    if (x === u.x && y === u.y) {
      const bx = u.x + (u.x - px), by = u.y + (u.y - py);
      if (destOk(b, bx, by)) out.push({ x, y, pull: true, back: [bx, by], word: `pull it ${DIR_WORD[`${dx},${dy}`]} (${first(u)} steps back)` });
    } else if (destOk(b, x, y)) out.push({ x, y, pull: false, back: null, word: `push it ${DIR_WORD[`${dx},${dy}`]}` });
  }
  return out;
}
export function shoveRefusal(b, u) {
  if (!u || !active(u)) return "That unit cannot act.";
  if (!canShove(u)) return u.kind !== "human" ? "Only people shove furniture." : "The arms must be free to shove furniture (nothing carried, nobody dragged).";
  if (!shoveTargets(b, u).length) return "Stand right next to a shelf, cabinet, counter, table, bed, crate, locker, rack, barrel, hay or sandbags (not diagonally).";
  if (u.ap < SHOVE.AP) return `Shoving furniture takes both actions.`;
  return "";
}
// act: { type: "shove", unit, x, y (the piece), tx, ty (where it goes) }. H: { say, alertNear, fx }.
export function shoveAct(state, b, u, act, H) {
  const why = shoveRefusal(b, u);
  if (why) return why;
  const list = shoveTargets(b, u);
  const p = act.x != null ? list.find((o) => o.x === Number(act.x) && o.y === Number(act.y)) : list.length === 1 ? list[0] : null;
  if (!p) return list.length > 1 ? "Several pieces next to them: say which." : "Stand right next to the piece (not diagonally).";
  const dests = shoveDests(b, u, p.x, p.y);
  const d = act.tx != null ? dests.find((o) => o.x === Number(act.tx) && o.y === Number(act.ty)) : dests.length === 1 ? dests[0] : null;
  if (!d) return dests.length ? "Say where it goes: a free open cell next to it, or onto their own cell (the pull: room behind them)." : `Nowhere to shove the ${pieceName(p.c)}: no free open cell next to it, and no room behind ${first(u)} to pull it.`;
  const src = p.c, dst = cellOf(b, d.x, d.y), name = pieceName(src);
  // The piece's own data goes with it: its kind, hit points, that it was moved; the cell it leaves is open floor.
  dst.k = src.k;
  if (src.hp > 0) { dst.hp = src.hp; dst.mhp = src.mhp; } else { dst.hp = dst.mhp = FURNITURE[src.k].hp; }
  dst.moved = true;
  src.k = "open";
  delete src.hp; delete src.mhp; delete src.moved;
  // A raid's container stands on its piece: it keeps its cell (raidloot.js boxAt, searchableNear).
  if (b.raid && b.raid.containers) for (const c of b.raid.containers) if (c.x === p.x && c.y === p.y && (c.f || 0) === (b.floor || 0)) { c.x = d.x; c.y = d.y; }
  const from = [u.x, u.y];
  if (d.pull) { u.x = d.back[0]; u.y = d.back[1]; }
  faceAt(u, d.x, d.y);
  u.ap -= SHOVE.AP;
  u.hunker = false;
  u.movedT = b.turn;
  b.losCache.fill(0);
  b.noise = (b.noise || 0) + SHOVE.NOISE;
  if (d.pull && H.fx) H.fx(b, { type: "move", unit: u.id, from, path: [[u.x, u.y]] });
  H.say(b, `${u.name} ${d.pull ? "drags" : "shoves"} the ${name} ${DIR_WORD[`${d.x - p.x},${d.y - p.y}`]}${d.pull ? ", stepping back" : ""}: it scrapes across the floor.`, "info");
  H.alertNear(b, d.x, d.y, SHOVE.RADIUS, "The scrape of furniture carries: the unaware nearby turn toward it.");
  return "";
}

// ---------- crawling (the dead over half cover) ----------
// One of the dead crawls over what a person vaults, never a closed window (it batters that on a base's map, and goes
// through an open or broken one at the vault's cost).
export const crawls = (u) => clambers(u);
export const crawlable = (b, c) => !!c && c.k !== "window" && vaultable(b, c);
// The tiles over the step a cell costs the one going over it: a person's vault (a closed window crashed through
// dearer), the dead's clamber through a window, the dead's crawl over half cover.
export const overCost = (b, u, c) => (canVault(u) ? vaultCost(b, c) : windowOpen(c) ? VAULT.COST : CRAWL.COST);

// ---------- boards ----------
const BOARDABLE = new Set(["idoor", "bdoor", "doorway", "window", "smashed", "boarded"]);
const KEEP = ["k", "dk", "hp", "mhp", "win", "roll", "t", "tOpen", "bar", "held"]; // what a boarded cell keeps of the door or window under the boards
export const isBoarded = (c) => !!c && c.k === "boarded";
export const boardedName = (c) => (c && c.under && (c.under.k === "window" || c.under.k === "smashed") ? "Boarded window" : "Boarded door");
export const boardedUnder = (c) => (c && c.under ? (c.under.k === "window" || c.under.k === "smashed" ? "window" : c.under.k === "doorway" ? "doorway" : "door") : "");
// The boards the unit carries (a bundle an action): the carriedSpots entry (its take() spends it), or null.
export function boardsOf(state, u) {
  const s = u && u.sid != null ? survivorById(state, u.sid) : null;
  if (!s) return null;
  return carriedSpots(s).find((sp) => sp.item && sp.item.key === "boards") || null;
}
// What can be boarded up from where the unit stands (not diagonally): [{ x, y, c, word }]; a boarded cell with room
// for another layer too.
export function boardTargets(b, u) {
  const out = [];
  if (!u) return out;
  for (const [dx, dy] of NEXT4) {
    const x = u.x + dx, y = u.y + dy, c = cellOf(b, x, y);
    if (!c || !BOARDABLE.has(c.k)) continue;
    if (c.k === "boarded" && (c.boards || 1) >= BOARD.MAX) continue;
    out.push({ x, y, c, word: targetWord(c) });
  }
  return out;
}
export const targetWord = (c) => (c.k === "boarded" ? `${boardedName(c).toLowerCase()} (${c.boards || 1} layer${(c.boards || 1) === 1 ? "" : "s"})` : c.k === "window" ? "window" : c.k === "smashed" ? "broken window" : c.k === "doorway" ? "doorway" : c.k === "bdoor" ? "barred door" : "closed door");
export const tearTargets = (b, u) => {
  const out = [];
  if (!u) return out;
  for (const [dx, dy] of NEXT4) { const x = u.x + dx, y = u.y + dy, c = cellOf(b, x, y); if (isBoarded(c)) out.push({ x, y, c }); }
  return out;
};
export function boardRefusal(state, b, u) {
  if (!u || !active(u)) return "That unit cannot act.";
  if (u.kind !== "human") return "Only people board things up.";
  if (!boardsOf(state, u)) return `${first(u)} carries no boards and nails (crafted from firewood and a scrap: Boards and nails).`;
  if (!boardTargets(b, u).length) return "Stand right next to a closed door, a doorway or a window (not diagonally); an open door is closed first.";
  if (u.ap < BOARD.AP) return "Boarding up takes both actions.";
  return "";
}
// act: { type: "boardup", unit, x?, y? }. H: { say, alertNear, fx }.
export function boardAct(state, b, u, act, H) {
  const why = boardRefusal(state, b, u);
  if (why) return why;
  const list = boardTargets(b, u);
  const o = act.x != null ? list.find((t) => t.x === Number(act.x) && t.y === Number(act.y)) : list.length === 1 ? list[0] : null;
  if (!o) return list.length > 1 ? "Several things to board up next to them: say which." : "Stand right next to a closed door, a doorway or a window (not diagonally).";
  const c = o.c, word = targetWord(c);
  const spot = boardsOf(state, u);
  spot.take();
  if (c.k === "boarded") {
    c.boards = (c.boards || 1) + 1;
    c.hp += BOARD.HP; c.mhp += BOARD.HP;
  } else {
    const under = {};
    for (const k of KEEP) if (c[k] !== undefined) under[k] = c[k];
    const door = c.k === "idoor" || c.k === "bdoor";
    const base = door && c.hp > 0 ? c.hp : 0;
    for (const k of KEEP) delete c[k];
    c.k = "boarded";
    c.under = under;
    c.boards = 1;
    c.hp = base + BOARD.HP;
    c.mhp = (base ? under.mhp : 0) + BOARD.HP;
    for (const p of b.units) if (p.brace && p.brace[0] === o.x && p.brace[1] === o.y) delete p.brace; // nobody braces it: the boards hold it
  }
  const s = survivorById(state, u.sid);
  if (s) refitKit(b, u, s);
  u.ap -= BOARD.AP;
  u.hunker = false;
  faceAt(u, o.x, o.y);
  b.losCache.fill(0);
  b.noise = (b.noise || 0) + BOARD.NOISE;
  if (b.raid) b.raid.heat = Math.min(100, b.raid.heat + BOARD.HEAT);
  if (H.fx) H.fx(b, { type: "melee", from: [u.x, u.y], to: [o.x, o.y], hit: true, crit: false, dmg: 0, side: u.side, text: "BOARDED" });
  H.say(b, `${u.name} nails boards across the ${word}${c.boards > 1 ? ` (${c.boards} layers)` : ""}: ${c.hp} hit points to batter through. The hammering is loud${b.raid ? ` (Heat +${BOARD.HEAT})` : ""}.`, "info");
  H.alertNear(b, o.x, o.y, BOARD.RADIUS, "Hammering carries: the unaware nearby turn toward it.");
  return "";
}
// The boards torn down again (from either side): the door or window back as it was, shut. act: { type: "teardown", unit, x?, y? }.
export function tearAct(state, b, u, act, H) {
  if (!u || !active(u)) return "That unit cannot act.";
  if (u.kind !== "human") return "Only people tear boards down.";
  const list = tearTargets(b, u);
  const o = act.x != null ? list.find((t) => t.x === Number(act.x) && t.y === Number(act.y)) : list.length === 1 ? list[0] : null;
  if (!o) return list.length > 1 ? "Several boarded-up things next to them: say which." : "Stand right next to boards (not diagonally) to tear them down.";
  if (u.ap < BOARD.TEAR.ap) return "Tearing boards down takes both actions.";
  const c = o.c, name = boardedName(c).toLowerCase();
  unboard(b, c);
  u.ap -= BOARD.TEAR.ap;
  u.hunker = false;
  faceAt(u, o.x, o.y);
  b.losCache.fill(0);
  b.noise = (b.noise || 0) + BOARD.TEAR.noise;
  H.say(b, `${u.name} pries the boards off the ${name.replace("boarded ", "")}: ${c.k === "window" ? "a window again, shut" : c.k === "idoor" ? "a closed door again" : c.k === "bdoor" ? "a barred door again" : c.k === "smashed" ? "an empty window frame again" : "an open doorway again"}. The boards are splintered.`, "info");
  H.alertNear(b, o.x, o.y, BOARD.TEAR.radius, "The creak of nails pulled carries.");
  return "";
}
// The door or window back from under the boards (shut, nobody bracing it).
function unboard(b, c) {
  const under = c.under || { k: "doorway" };
  delete c.under; delete c.boards; delete c.hp; delete c.mhp;
  for (const k of KEEP) delete c[k];
  Object.assign(c, under);
  delete c.held;
  if (c.win) c.win = { ...c.win, open: false };
  if (c.k === "window" && !c.win) c.win = { open: false, lock: "none" };
}
// Battered through (combat.js breakCell at 0 hit points): the boards go, and the door or window with them: a boarded
// window ends broken (the glass's crash is breakCell's), a boarded door broken in (buildingmaps.js doorBroken).
export function breakBoarded(b, c, x, y) {
  const under = c.under || { k: "doorway" };
  delete c.under; delete c.boards;
  for (const k of KEEP) delete c[k];
  Object.assign(c, under);
  delete c.held;
  c.hp = 0;
  if (c.k === "window" || c.k === "smashed") { c.k = "window"; smashWindow(b, c); }
  else { if (c.k === "doorway") c.k = "idoor"; doorBroken(b, x, y); }
}
