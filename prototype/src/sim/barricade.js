// Barricades on the battle maps (the user's request of 2026-10-18): furniture shoved in the way, doors and windows
// boarded up with wood and nails, and the dead crawling over half cover.
//
//   Shoving furniture (SHOVE, FURNITURE, shoveable, canShove, shoveTargets, shoveDests, shoveAct; combatAct "shove")
//     A person with their arms free, standing right next to a piece (not diagonally), moves it one tile for both
//     actions: pushed to any free open cell next to the piece, or pulled onto their own cell while they step back a
//     cell (the pull). What can be shoved: the raid maps' shelves, cabinets, counters, tables, beds, crates, lockers,
//     tall shelving, barrels, hay bales, sandbags and every piece of the furniture catalogue that is not fixed (FURNITURE,
//     data-furniture.js); never a car, a gun safe or anything fixed, a wall. A raid's container
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
//     A bundle of boards and nails (data.js GEAR.boards, crafted from wood and a scrap: crafting.js CRAFTS.boards)
//     nailed over a door (closed, barred or broken in), a doorway or a window (closed, open, broken) from either side
//     for both actions: the cell becomes "boarded" (CELL: a wall for sight and movement, full cover) with hit points
//     (BOARD.HP a layer, up to BOARD.MAX layers, on top of a closed door's own) that the dead and the human enemy
//     batter through on the siege field (distField bashA, siegeTarget, bash → breakCell → breakBoarded: a boarded
//     window ends broken, a boarded door broken in). Hammering is loud: BOARD.NOISE on the raid's noise, Heat
//     +BOARD.HEAT, the unaware within BOARD.RADIUS wake. Tearing the boards down again (teardown) takes both actions
//     from either side, is quieter, and gives the door or window back as it was (shut); the boards are spent.
//   The picks of 2026-10-18 (the user chose all seven):
//     1. A piece goes into a door frame too: onto a broken door (doorway) or an open door (odoor), the frame kept under
//        it (c.frame) and back when the piece is shoved on or smashed.
//     2. The human AI holding a building (a raid's guards, a base's defenders, the third side's people) barricades while
//        nothing is in sight to shoot (aiBarricade; combat.js aiUnit): a half-cover piece next to it shoved into a door
//        frame, or boards (u.boards, by kit: BOARD.KIT) nailed over an outer window or door.
//     3. A group's base you assault starts boarded up (preBoardBase; fort.js fortAssault): their outer windows and doors
//        nearest your side, as many bundles as their stock pays for at the player's recipe (30 wood and a scrap a
//        bundle), up to BOARD.AI.MAX.
//     4. Tearing boards down gives a bundle back BOARD.TEAR.BACK of the time a layer (hash dice), into the kit or on the
//        ground at the unit's feet.
//     5. Two people shove a piece for one action each (a helper right next to it with free arms: shoveHelpers); a tall
//        piece (full cover: lockers, tall shelving) takes two people, or one with a Strong back or Melee STRONG_MELEE+.
//     6. The dead's crawl is seen: a CRAWL tag on the cell and a log line when one of yours sees it (combat.js moveAlong).
//     7. Boards come from the team's vehicle too, from next to it (boardsOf: raidloot.js trunkVehicle). A cart's load
//        (the carts branch) when that lands.
import { CELL, unitAt, active, canVault, vaultable, clambers, VAULT, vaultCost, refitKit, say } from "./combat.js"; // call-time only: the modules load in a circle
import { handsBusy } from "./carry.js"; // the hands full of a load shove nothing (call-time only: the modules load in a circle)
import { windowOpen, smashWindow, insideOf } from "./windows.js";
import { doorBroken } from "./buildingmaps.js";
import { survivorById, factionById, skill } from "./world.js";
import { carriedSpots, lootItem, stow } from "./inventory.js";
import { dropToGround } from "./ground.js";
import { trunkVehicle, atVehicle } from "./raidloot.js";
import { hasTrait } from "./traits.js";
import { hash01 } from "./skills.js";
import { furnitureHp } from "./data-furniture.js"; // the furniture catalogue: what is shoved, its hit points
import { cartBoxes, shoveCart, cartAt } from "./carts.js"; // a parked cart is shoved as furniture is; nothing is shoved onto one (call-time only)

export const SHOVE = { AP: 2, NOISE: 1, RADIUS: 3, HELP_AP: 1, STRONG_MELEE: 6 }; // HELP_AP: each of two people; STRONG_MELEE: Melee at which one person shoves a tall piece alone (or a Strong back)
export const CRAWL = { COST: 4 };
export const BOARD = {
  AP: 2, HP: 40, MAX: 3, NOISE: 1.5, HEAT: 3, RADIUS: 6, TEAR: { ap: 2, noise: 0.5, radius: 3, BACK: 0.5 },
  KIT: { guards: 0.4, militia: 0.4, fighters: 0.3, survivalists: 0.3, preppers: 0.5, soldiers: 0.2, drifters: 0.15 }, // the chance a human of this kit carries a bundle (the AI's boards: u.boards)
  AI: { MAX: 6, WOOD: 30, SCRAP: 1 }, // a group's base boarded before an assault: at most this many bundles, each paid from their stock at the player's recipe
};
// What can be shoved, and the hit points a shoved piece gets (the dead batter it: combat.js bash, SIEGE): every piece of
// the furniture catalogue that is not fixed (data-furniture.js furnitureHp: a bathtub, a bar counter, cell bars, a safe
// are never shoved), and the sandbags.
export const FURNITURE = { ...furnitureHp(), sandbag: { hp: 20 } };
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIR_WORD = { "1,0": "east", "-1,0": "west", "0,1": "south", "0,-1": "north" };
const cellOf = (b, x, y) => (x < 0 || y < 0 || x >= b.w || y >= b.h ? null : b.cells[y * b.w + x]);
const faceAt = (u, x, y) => { u.face = [Math.sign(x - u.x), Math.sign(y - u.y)]; };
const first = (u) => String(u.name || "").split(" ")[0];
const burning = (b, x, y) => !!(b.fires && b.fires.some((f) => f.x === x && f.y === y));

// ---------- shoving ----------
export const shoveable = (c) => !!c && (!!FURNITURE[c.k] || c.k === "cart") && !c.car; // carts.js: a parked cart is shoved as furniture is (its load stays in it)
export const canShove = (u) => canVault(u) && !handsBusy(u); // on their feet, arms free (a load in the hands vaults, at double, but shoves nothing), not the dead, not carrying or dragging anyone
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
// A free cell a piece can be shoved onto: open ground or floor, or a door frame (a broken door, an open door: the
// frame is kept under the piece, c.frame), with nobody on it, not burning.
const FRAMES = new Set(["doorway", "odoor"]);
const FRAME_KEYS = ["k", "dk", "roll", "t", "tOpen", "hp", "mhp"];
export const isFrame = (c) => !!c && FRAMES.has(c.k);
const destOk = (b, x, y) => { const c = cellOf(b, x, y); return !!c && (c.k === "open" || isFrame(c)) && !unitAt(b, x, y) && !burning(b, x, y) && !cartBoxes(b).some((o) => o.x === x && o.y === y && (o.f || 0) === (b.floor || 0)); }; // carts.js: nothing is shoved onto a cart
export const freeForPiece = destOk; // furnicarry.js: where a piece is set down (the same free cell)
// Where the piece at (px, py) can go from where the unit stands: [{ x, y, pull, back, frame, word }]. A push: any free
// cell next to the piece. The pull: onto the unit's own cell, the unit stepping back to the free cell behind them.
export function shoveDests(b, u, px, py) {
  const out = [];
  if (!u || Math.abs(u.x - px) + Math.abs(u.y - py) !== 1) return out;
  for (const [dx, dy] of NEXT4) {
    const x = px + dx, y = py + dy;
    const frame = isFrame(cellOf(b, x, y)) ? " into the door frame" : "";
    if (x === u.x && y === u.y) {
      const bx = u.x + (u.x - px), by = u.y + (u.y - py);
      if (destOk(b, bx, by)) out.push({ x, y, pull: true, back: [bx, by], frame: !!frame, word: `pull it ${DIR_WORD[`${dx},${dy}`]}${frame} (${first(u)} steps back)` });
    } else if (destOk(b, x, y)) out.push({ x, y, pull: false, back: null, frame: !!frame, word: `push it ${DIR_WORD[`${dx},${dy}`]}${frame}` });
  }
  return out;
}
// Tall pieces (full cover: lockers, tall shelving) take two people, or one strong enough (a Strong back, Melee STRONG_MELEE+).
export const tallPiece = (c) => !!c && !!FURNITURE[c.k] && CELL[c.k].cover === 2;
export function strongEnough(state, u) {
  const s = state && u && u.sid != null ? survivorById(state, u.sid) : null;
  return !!s && (hasTrait(s, "strongback") || skill(s, "melee") >= SHOVE.STRONG_MELEE);
}
// The teammates who can lend a hand with the piece at (px, py): on the same side, right next to it (not diagonally),
// arms free, an action left, on their feet, not the shover.
export function shoveHelpers(b, u, px, py) {
  if (!u) return [];
  return b.units.filter((o) => o !== u && o.side === u.side && (o.f || 0) === (u.f || 0) && active(o) && canShove(o) && o.ap >= SHOVE.HELP_AP && Math.abs(o.x - px) + Math.abs(o.y - py) === 1);
}
// What a shove of this piece costs the shover, and who helps: { ap, helper, why }. With a helper HELP_AP each; alone
// SHOVE.AP, and a tall piece alone only when strong enough.
export function shovePlan(state, b, u, px, py, helperId = null) {
  const c = cellOf(b, px, py);
  const helpers = shoveHelpers(b, u, px, py);
  const helper = helperId != null ? helpers.find((o) => o.id === Number(helperId)) || null : helpers[0] || null;
  if (helper) return { ap: SHOVE.HELP_AP, helper, why: u.ap >= SHOVE.HELP_AP ? "" : "No action left." };
  if (tallPiece(c) && !strongEnough(state, u)) return { ap: SHOVE.AP, helper: null, why: `The ${pieceName(c)} are too heavy for one: a second person right next to them lends a hand (1 action each), or someone with a Strong back or Melee ${SHOVE.STRONG_MELEE}+ shoves them alone.` };
  return { ap: SHOVE.AP, helper: null, why: u.ap >= SHOVE.AP ? "" : "Shoving furniture alone takes both actions (a helper next to it: 1 each)." };
}
export function shoveRefusal(b, u, state = null) {
  if (!u || !active(u)) return "That unit cannot act.";
  if (!canShove(u)) return u.kind !== "human" ? "Only people shove furniture." : "The arms must be free to shove furniture (nothing carried, nobody dragged).";
  const list = shoveTargets(b, u);
  if (!list.length) return "Stand right next to a shelf, cabinet, counter, table, bed, crate, locker, rack, barrel, hay, sandbags or a parked cart (not diagonally).";
  if (u.ap < SHOVE.HELP_AP) return "No action left.";
  if (list.every((p) => shovePlan(state, b, u, p.x, p.y).why)) return shovePlan(state, b, u, list[0].x, list[0].y).why;
  return "";
}
// The piece on (px, py) moves to the cell d (a shoveDests entry); the frame under it kept and given back. The one
// place the cells change: shoveAct (people) and aiBarricade (the human AI).
function movePiece(b, src, p, dst, d) {
  const data = { k: src.k, hp: src.hp > 0 ? src.hp : FURNITURE[src.k].hp, mhp: src.hp > 0 ? src.mhp : FURNITURE[src.k].hp };
  pieceOff(src);
  pieceOn(dst, data.k, data.hp, data.mhp);
  // A raid's container stands on its piece: it keeps its cell (raidloot.js boxAt, searchableNear).
  if (b.raid && b.raid.containers) for (const c of b.raid.containers) if (c.x === p.x && c.y === p.y && (c.f || 0) === (b.floor || 0) && !c.cart) { c.x = d.x; c.y = d.y; } // (a cart moves by carts.js shoveCart)
  b.losCache.fill(0);
}
// The cell a piece leaves (a shove, furnicarry.js liftAct): open floor, or the door frame it stood in (c.frame).
export function pieceOff(src) {
  const back = src.frame || null;
  delete src.hp; delete src.mhp; delete src.moved; delete src.frame;
  if (back) Object.assign(src, back); else src.k = "open";
}
// The cell a piece goes to (a shove, furnicarry.js setAct): kind k with its hit points, a door frame under it kept.
export function pieceOn(dst, k, hp, mhp = hp) {
  if (isFrame(dst)) { const fr = {}; for (const key of FRAME_KEYS) if (dst[key] !== undefined) fr[key] = dst[key]; for (const key of FRAME_KEYS) delete dst[key]; dst.frame = fr; }
  dst.k = k; dst.hp = hp; dst.mhp = mhp; dst.moved = true;
}
// A shoved piece smashed (combat.js breakCell): the door frame it stood in is back, else rubble.
export function breakPiece(b, c) {
  const back = c.frame || null;
  delete c.moved; delete c.frame;
  if (back) { Object.assign(c, back); c.hp = 0; } else c.k = "rubble";
}
// act: { type: "shove", unit, x, y (the piece), tx, ty (where it goes), helper? (a teammate's unit id) }. H: { say, alertNear, fx }.
export function shoveAct(state, b, u, act, H) {
  const why = shoveRefusal(b, u, state);
  if (why) return why;
  const list = shoveTargets(b, u);
  const p = act.x != null ? list.find((o) => o.x === Number(act.x) && o.y === Number(act.y)) : list.length === 1 ? list[0] : null;
  if (!p) return list.length > 1 ? "Several pieces next to them: say which." : "Stand right next to the piece (not diagonally).";
  const plan = shovePlan(state, b, u, p.x, p.y, act.helper);
  if (plan.why) return plan.why;
  const dests = shoveDests(b, u, p.x, p.y);
  const d = act.tx != null ? dests.find((o) => o.x === Number(act.tx) && o.y === Number(act.ty)) : dests.length === 1 ? dests[0] : null;
  if (!d) return dests.length ? "Say where it goes: a free cell next to it (open floor or a door frame), or onto their own cell (the pull: room behind them)." : `Nowhere to shove the ${pieceName(p.c)}: no free cell next to it, and no room behind ${first(u)} to pull it.`;
  const src = p.c, dst = cellOf(b, d.x, d.y), name = src.k === "cart" ? cartAt(b, p.x, p.y) || "cart" : pieceName(src);
  if (src.k === "cart") shoveCart(b, p.x, p.y, d.x, d.y); // carts.js: the cart and everything in it to the new cell (a door frame too); the old cell what it was
  else movePiece(b, src, p, dst, d);
  const from = [u.x, u.y];
  if (d.pull) { u.x = d.back[0]; u.y = d.back[1]; }
  faceAt(u, d.x, d.y);
  u.ap -= plan.ap;
  u.hunker = false;
  u.movedT = b.turn;
  if (plan.helper) { plan.helper.ap -= SHOVE.HELP_AP; plan.helper.hunker = false; faceAt(plan.helper, d.x, d.y); }
  b.noise = (b.noise || 0) + SHOVE.NOISE;
  if (d.pull && H.fx) H.fx(b, { type: "move", unit: u.id, from, path: [[u.x, u.y]] });
  H.say(b, `${u.name}${plan.helper ? ` and ${plan.helper.name}` : ""} ${d.pull ? "drag" : "shove"}${plan.helper ? "" : "s"} the ${name} ${DIR_WORD[`${d.x - p.x},${d.y - p.y}`]}${d.frame ? " into the door frame" : ""}${d.pull ? `, ${first(u)} stepping back` : ""}: it scrapes across the floor${plan.helper ? " (1 action each)" : ""}.`, "info");
  H.alertNear(b, d.x, d.y, SHOVE.RADIUS, "The scrape of furniture carries: the unaware nearby turn toward it.");
  return "";
}

// ---------- crawling (the dead over half cover) ----------
// One of the dead crawls over what a person vaults, never a closed window (it batters that on a base's map, and goes
// through an open or broken one at the vault's cost).
export const crawls = (u) => clambers(u);
export const crawlable = (b, c) => !!c && c.k !== "window" && (vaultable(b, c) || c.k === "cart"); // carts.js: the dead crawl over a parked cart (the living never vault it: shove it or go round)
// The tiles over the step a cell costs the one going over it: a person's vault (a closed window crashed through
// dearer), the dead's clamber through a window, the dead's crawl over half cover.
export const overCost = (b, u, c) => (canVault(u) ? vaultCost(b, c, u) : windowOpen(c) ? VAULT.COST : CRAWL.COST); // with the hands full the crossing costs double (combat.js vaultCost)

// ---------- boards ----------
const BOARDABLE = new Set(["idoor", "bdoor", "doorway", "window", "smashed", "boarded"]);
const KEEP = ["k", "dk", "hp", "mhp", "win", "roll", "t", "tOpen", "bar", "held"]; // what a boarded cell keeps of the door or window under the boards
export const isBoarded = (c) => !!c && c.k === "boarded";
export const boardedName = (c) => (c && c.under && (c.under.k === "window" || c.under.k === "smashed") ? "Boarded window" : "Boarded door");
export const boardedUnder = (c) => (c && c.under ? (c.under.k === "window" || c.under.k === "smashed" ? "window" : c.under.k === "doorway" ? "doorway" : "door") : "");
// The boards the unit can use (a bundle an action): a carriedSpots entry of their own kit (its take() spends it), else
// a bundle in the team's vehicle when they stand next to it ({ item, where: "vehicle", take }), else null.
export function boardsOf(state, u, b = state && state.combat) {
  const s = u && u.sid != null ? survivorById(state, u.sid) : null;
  if (!s) return null;
  const own = carriedSpots(s).find((sp) => sp.item && sp.item.key === "boards");
  if (own) return own;
  if (b && atVehicle(b, u)) {
    const v = trunkVehicle(state, b);
    const i = v && v.cargo && v.cargo.gear ? v.cargo.gear.findIndex((it) => it && it.key === "boards") : -1;
    if (i >= 0) return { item: v.cargo.gear[i], where: "vehicle", loc: `vehicle:${v.id}:gear:${i}`, take: () => { const j = v.cargo.gear.indexOf(v.cargo.gear[i]); if (j >= 0) v.cargo.gear.splice(j, 1); } };
  }
  return null;
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
  if (!boardsOf(state, u, b)) return `${first(u)} carries no boards and nails (crafted from wood and a scrap: Boards and nails; a bundle in the team's vehicle counts from next to it).`;
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
  const spot = boardsOf(state, u, b);
  spot.take();
  boardCell(b, c, o.x, o.y);
  const s = survivorById(state, u.sid);
  if (s) refitKit(b, u, s);
  u.ap -= BOARD.AP;
  u.hunker = false;
  faceAt(u, o.x, o.y);
  b.noise = (b.noise || 0) + BOARD.NOISE;
  if (b.raid) b.raid.heat = Math.min(100, b.raid.heat + BOARD.HEAT);
  if (H.fx) H.fx(b, { type: "melee", from: [u.x, u.y], to: [o.x, o.y], hit: true, crit: false, dmg: 0, side: u.side, text: "BOARDED" });
  H.say(b, `${u.name} nails boards across the ${word}${c.boards > 1 ? ` (${c.boards} layers)` : ""}${spot.where === "vehicle" ? " (a bundle out of the vehicle)" : ""}: ${c.hp} hit points to batter through. The hammering is loud${b.raid ? ` (Heat +${BOARD.HEAT})` : ""}.`, "info");
  H.alertNear(b, o.x, o.y, BOARD.RADIUS, "Hammering carries: the unaware nearby turn toward it.");
  return "";
}
// A layer of boards onto the cell: the first layer turns a door or window into a "boarded" cell with what it was kept
// under it, another adds BOARD.HP. The one place the cell changes: boardAct (people), aiBarricade, preBoardBase.
export function boardCell(b, c, x, y) {
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
    for (const p of b.units) if (p.brace && p.brace[0] === x && p.brace[1] === y) delete p.brace; // nobody braces it: the boards hold it
  }
  b.losCache.fill(0);
}
// The boards torn down again (from either side): the door or window back as it was, shut. act: { type: "teardown", unit, x?, y? }.
export function tearAct(state, b, u, act, H) {
  if (!u || !active(u)) return "That unit cannot act.";
  if (u.kind !== "human") return "Only people tear boards down.";
  const list = tearTargets(b, u);
  const o = act.x != null ? list.find((t) => t.x === Number(act.x) && t.y === Number(act.y)) : list.length === 1 ? list[0] : null;
  if (!o) return list.length > 1 ? "Several boarded-up things next to them: say which." : "Stand right next to boards (not diagonally) to tear them down.";
  if (u.ap < BOARD.TEAR.ap) return "Tearing boards down takes both actions.";
  const c = o.c, name = boardedName(c).toLowerCase(), layers = c.boards || 1;
  unboard(b, c);
  u.ap -= BOARD.TEAR.ap;
  u.hunker = false;
  faceAt(u, o.x, o.y);
  b.losCache.fill(0);
  b.noise = (b.noise || 0) + BOARD.TEAR.noise;
  // Some bundles come off whole (BOARD.TEAR.BACK a layer, hash dice): back into the kit, or on the ground at their feet.
  const back = tearBack(b, o.x, o.y, layers);
  b.tears = (b.tears || 0) + 1;
  const s = u.sid != null ? survivorById(state, u.sid) : null;
  let kept = 0, down = 0;
  for (let i = 0; i < back; i++) {
    // Its condition through the roller like any other find (itemcond.js): planks pried off a wall with bent nails are
    // knocked about, a wreck's range. Hash dice of the same parts as tearBack's, so the battle's dice stay put.
    const it = lootItem("boards", "wreck", [b.turn || 0, b.tears, "tearq", o.x, o.y, i]);
    if (s && stow(s, it)) kept++;
    else { dropToGround(b, u, it); down++; }
  }
  if (s && kept) refitKit(b, u, s);
  H.say(b, `${u.name} pries the boards off the ${name.replace("boarded ", "")}: ${c.k === "window" ? "a window again, shut" : c.k === "idoor" ? "a closed door again" : c.k === "bdoor" ? "a barred door again" : c.k === "smashed" ? "an empty window frame again" : "an open doorway again"}. ${back ? `${back} of ${layers} bundle${layers === 1 ? "" : "s"} come${back === 1 ? "s" : ""} off whole${down ? ` (${kept ? `${kept} kept, ` : ""}${down} on the ground: no room)` : ""}; the rest ${layers - back === 1 ? "is" : "are"} splintered.` : `The boards are splintered${layers > 1 ? ", all of them" : ""}.`}`, "info");
  H.alertNear(b, o.x, o.y, BOARD.TEAR.radius, "The creak of nails pulled carries.");
  return "";
}
// How many of the layers torn off at (x, y) come away as a bundle again: hash dice of the turn, the cell, the layer and
// how many tear-downs the battle has seen (b.tears; the battle's own dice are not used up).
export const tearBack = (b, x, y, layers) => { let n = 0; for (let i = 0; i < layers; i++) if (hash01((b.turn || 0) * 1000003 + (b.tears || 0), "tear", x, y, i) < BOARD.TEAR.BACK) n++; return n; };
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
  else doorBroken(b, x, y);
}

// ---------- the human AI (pick 2): barricading while nothing is in sight to shoot ----------
// A bundle or none for a human of this kit (combat.js makeEnemy: u.boards; hash dice of the battle's seed and the unit).
export const kitBoards = (kind, seed, id) => (BOARD.KIT[kind] && hash01(seed, "boards", id) < BOARD.KIT[kind] ? 1 : 0);
// Is the far side of the opening at (x, y), seen from (ux, uy), outdoors? (an outer window or door: worth boarding)
const outerOpening = (b, ux, uy, x, y) => !insideOf(b, 2 * x - ux, 2 * y - uy);
// A human of the AI with both actions and nobody to shoot, holding a building (indoors on a raid's map, or inside a
// base's buildings): a half-cover piece next to it shoved into a door frame beside it, else boards nailed over an outer
// window or door next to it (one bundle a turn). True when it acted (its turn is spent). Never your own people (you
// give the orders), never the dead.
export function aiBarricade(b, u, H = { say, alertNear: () => {}, fx: null }) {
  if (!u || u.kind !== "human" || u.side === "player" || !active(u) || u.ap < SHOVE.AP || !u.aware) return false;
  if (!insideOf(b, u.x, u.y)) return false;
  // A piece into a door frame: the dead and raiders slowed at the door.
  if (canShove(u)) {
    for (const p of shoveTargets(b, u)) {
      if (tallPiece(p.c)) continue; // alone: half cover only
      const d = shoveDests(b, u, p.x, p.y).find((o) => o.frame && !o.pull);
      if (!d) continue;
      movePiece(b, p.c, p, cellOf(b, d.x, d.y), d);
      faceAt(u, d.x, d.y);
      u.ap = 0; u.hunker = false;
      b.noise = (b.noise || 0) + SHOVE.NOISE;
      H.say(b, `${u.name} shoves the ${pieceName(cellOf(b, d.x, d.y))} into the door frame.`, "info");
      return true;
    }
  }
  if (!(u.boards > 0)) return false;
  const t = boardTargets(b, u).find((o) => o.c.k !== "boarded" && outerOpening(b, u.x, u.y, o.x, o.y)) || boardTargets(b, u).find((o) => o.c.k === "boarded" && outerOpening(b, u.x, u.y, o.x, o.y));
  if (!t) return false;
  const word = targetWord(t.c).replace(/ \(\d+ layers?\)/, "");
  u.boards -= 1;
  boardCell(b, t.c, t.x, t.y);
  faceAt(u, t.x, t.y);
  u.ap = 0; u.hunker = false;
  b.noise = (b.noise || 0) + BOARD.NOISE;
  if (H.fx) H.fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: u.side, text: "BOARDED" });
  H.say(b, `${u.name} nails boards across the ${word}: hammering.`, "info");
  H.alertNear(b, t.x, t.y, BOARD.RADIUS, "Hammering carries.");
  return true;
}

// ---------- a group's base before your assault (pick 3) ----------
// Their outer windows and doors nearest your side boarded up before you arrive, each bundle paid from their stock at
// the player's recipe (BOARD.AI.WOOD wood and BOARD.AI.SCRAP scrap), at most BOARD.AI.MAX. side: the edge you come
// from (fort.js). Returns how many were boarded.
export function preBoardBase(state, b, factionId, side = "west") {
  const f = state && factionId != null ? factionById(state, factionId) : null;
  if (!f || !f.stock || !b || !b.cells) return 0;
  const W = b.w, H = b.h;
  const openings = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = b.cells[y * W + x];
    if (c.k !== "window" && c.k !== "bdoor") continue;
    if (!NEXT4.some(([dx, dy]) => insideOf(b, x + dx, y + dy)) || !NEXT4.some(([dx, dy]) => !insideOf(b, x + dx, y + dy) && cellOf(b, x + dx, y + dy) && cellOf(b, x + dx, y + dy).k !== "wall")) continue; // a wall between inside and outside
    const toward = side === "west" ? x : side === "east" ? W - 1 - x : side === "north" ? y : H - 1 - y;
    openings.push({ x, y, c, toward });
  }
  openings.sort((a, o) => a.toward - o.toward || a.y - o.y || a.x - o.x);
  const afford = Math.min(Math.floor((f.stock.wood || 0) / BOARD.AI.WOOD), Math.floor((f.stock.scrap || 0) / BOARD.AI.SCRAP));
  const n = Math.min(openings.length, afford, BOARD.AI.MAX);
  for (let i = 0; i < n; i++) {
    const o = openings[i];
    boardCell(b, o.c, o.x, o.y);
    f.stock.wood -= BOARD.AI.WOOD;
    f.stock.scrap -= BOARD.AI.SCRAP;
  }
  if (n) say(b, `${f.name} have boarded up ${n} of their windows and doors on this side.`, "info");
  return n;
}
